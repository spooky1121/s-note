import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {onRequest} from '../functions/api/operator.js';

// Actual Worker + actual support/operator PostgreSQL functions. Auth HTTP alone
// is synthetic; every fetch is intercepted and no outside message is sent.
// NODE_PATH=/workspace/work/deps/node_modules node tests/support-api.sql.integration.test.mjs
const require=createRequire(import.meta.url),{createSupportFixture}=require('./support-chat.sql.cjs');
const {OP,OP_SESSION}=require('./operator-core.sql.cjs');
const {COMPANY,FOREIGN,OWNER,OUTSIDER,ADMIN}=require('./recycle-bin-db.cjs');
const ENV={SUPABASE_URL:'https://support-sql-fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',SUPABASE_SERVICE_ROLE_KEY:'synthetic-unused-service-key'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const scalar=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const jwt=(user,session)=>Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user,session_id:session,role:'authenticated'})).toString('base64url')+'.synthetic-signature';

test('actual support Worker and SQL preserve scoped two-way messages, exact seen IDs, live operator authorization and zero service-key traffic',async t=>{
 const db=await createSupportFixture(),originalFetch=globalThis.fetch,sessions=new Map([[OP,OP_SESSION]]),calls=[];let revokeBeforeSupport=false,tail=Promise.resolve();
 t.after(async()=>{globalThis.fetch=originalFetch;await tail;await db.close();});
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())',[OP,'synthetic-operator@example.invalid']);
 await db.query("insert into snote_operator_private.operators(user_id,active,reason) values($1,true,'Synthetic support integration only')",[OP]);
 for(const user of[OP,OWNER,OUTSIDER,ADMIN]){const id=sessions.get(user)||randomUUID();sessions.set(user,id);await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[id,user]);}
 function scoped(user,session,fn){
  const job=tail.then(async()=>{
   await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',sub:user,session_id:session,is_anonymous:false})]);await db.exec('set role authenticated');
   try{return await fn();}finally{await db.exec('reset role');}
  });tail=job.catch(()=>{});return job;
 }
 function sqlRpc(name,args,user,session=sessions.get(user)){
  assert.match(name,/^snote_(?:operator_)?support_[a-z_]+$|^snote_operator_context$/);const entries=Object.entries(args);for(const[key]of entries)assert.match(key,/^p_[a-z_]+$/);
  return scoped(user,session,()=>scalar(db,'select public.'+name+'('+entries.map(([key],i)=>key+' => $'+(i+1)).join(',')+')',entries.map(([,value])=>value!==null&&typeof value==='object'&&!Array.isArray(value)?JSON.stringify(value):value)));
 }
 const userHistory=(user=OWNER,company=user===OUTSIDER?FOREIGN:COMPANY)=>sqlRpc('snote_support_messages',{p_expected_company_id:company,p_expected_user_id:user,p_limit:100,p_before:null},user);
 const userSend=(user,text,requestId=randomUUID())=>sqlRpc('snote_support_send',{p_expected_company_id:user===OUTSIDER?FOREIGN:COMPANY,p_expected_user_id:user,p_text:text,p_request_id:requestId},user);
 const userRead=(user,ids)=>sqlRpc('snote_support_read',{p_expected_company_id:user===OUTSIDER?FOREIGN:COMPANY,p_expected_user_id:user,p_message_ids:ids},user);
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(input),authorization=options.headers.Authorization,claims=JSON.parse(Buffer.from(authorization.replace(/^Bearer /,'').split('.')[1],'base64url').toString()),body=options.body===undefined?undefined:JSON.parse(options.body);
  assert.equal(url.origin,ENV.SUPABASE_URL);assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store');assert.equal(options.headers.apikey,ENV.SUPABASE_PUBLISHABLE_KEY,'Support must never use the service key');assert.notEqual(authorization,'Bearer '+ENV.SUPABASE_SERVICE_ROLE_KEY);
  const call={path:url.pathname,body,user:claims.sub,session:claims.session_id,service:false};calls.push(call);
  if(url.pathname==='/auth/v1/user')return json({id:claims.sub,email:claims.sub+'@example.invalid'});
  assert(url.pathname.startsWith('/rest/v1/rpc/'),'Support never calls Storage or administrative Auth APIs');const name=url.pathname.split('/').at(-1);
  if(revokeBeforeSupport&&name.startsWith('snote_operator_support_')){revokeBeforeSupport=false;await tail;await db.query('delete from auth.sessions where id=$1',[OP_SESSION]);}
  try{return json(await sqlRpc(name,body,claims.sub,claims.session_id));}
  catch(error){call.sqlError={code:error.code,message:error.message};return json({code:error.code,message:error.message},error.code==='42501'?403:error.code==='40001'?409:400);}
 };
 async function api(action,body={},user=OP){
  const response=await onRequest({env:ENV,request:new Request('https://s-note.example/api/operator',{method:'POST',headers:{Authorization:'Bearer '+jwt(user,sessions.get(user)),Origin:'https://s-note.example','Content-Type':'application/json'},body:JSON.stringify({action,...body})})});
  return{status:response.status,body:await response.json(),headers:response.headers};
 }
 async function ok(action,body={}){const result=await api(action,body);assert.equal(result.status,200,JSON.stringify({action,result:result.body,errors:calls.filter(c=>c.sqlError)}));assert.equal(result.body.ok,true);assert.match(result.headers.get('Cache-Control'),/no-store/);return result.body;}

 const empty=await userHistory();assert.equal(empty.conversation.id,null);assert.deepEqual(empty.messages,[]);assert.equal(empty.unreadCount,0);
 const requestId=randomUUID(),firstText='상담원 연결\n<b>합성 문의</b>',first=await userSend(OWNER,firstText,requestId),foreign=await userSend(OUTSIDER,'다른 상사의 합성 문의',requestId),conversation=first.conversation.id;
 assert.notEqual(conversation,foreign.conversation.id);assert.equal(first.message.sender,'user');assert.equal(first.message.text,firstText);assert.equal((await userSend(OWNER,firstText,requestId)).message.id,first.message.id);
 assert.equal((await ok('support-unread')).unreadTotal,2);
 const threads=await ok('support-threads',{query:{page:1,status:'unread',companyId:COMPANY}});assert.equal(threads.total,1);assert.equal(threads.pageSize,20);assert.equal(threads.items[0].id,conversation);assert.equal(threads.items[0].unreadCount,1);
 const visible=await ok('support-thread',{conversationId:conversation,limit:50,before:null});assert.deepEqual(visible.messages.map(m=>m.id),[first.message.id]);assert.equal(visible.messages[0].text,firstText);assert.equal((await ok('support-unread')).unreadTotal,2,'Fetching the conversation is not a read receipt');
 const incoming=await userSend(OWNER,'운영자가 읽기 전에 도착한 새 문의');assert.equal((await ok('support-unread')).unreadTotal,3);
 const seen=await ok('support-read',{conversationId:conversation,messageIds:visible.messages.map(m=>m.id)});assert.equal(seen.readCount,1);assert.equal(seen.unreadCount,1);assert.equal(seen.unreadTotal,2);assert.equal(await scalar(db,'select operator_read_at from snote_support_private.messages where id=$1',[incoming.message.id]),null);
 const mixed=await api('support-read',{conversationId:conversation,messageIds:[incoming.message.id,foreign.message.id]});assert.equal(mixed.status,403);assert.equal(await scalar(db,'select operator_read_at from snote_support_private.messages where id=$1',[incoming.message.id]),null,'A mixed-tenant read set cannot partially acknowledge valid IDs');

 const replyRequest=randomUUID(),replyText='smi1.abc123\n첫 줄 <img src=x onerror=alert(1)> · 합성 답변',reply=await ok('support-reply',{conversationId:conversation,text:'  '+replyText+'  ',requestId:replyRequest});
 assert.equal(reply.message.sender,'operator');assert.equal(reply.message.text,replyText,'Support text is not passed through vehicle cipher/identity scrubbing');assert.equal(reply.message.readAt,null);assert.equal(reply.duplicate,false);
 const repeated=await ok('support-reply',{conversationId:conversation,text:replyText,requestId:replyRequest});assert.equal(repeated.duplicate,true);assert.equal(repeated.message.id,reply.message.id);assert.equal(await scalar(db,"select count(*)::int from snote_operator_private.audit_log where action='support_reply' and request_id=$1",[replyRequest]),1);
 const history=await userHistory();assert.equal(history.unreadCount,1);assert(history.messages.some(m=>m.id===reply.message.id&&m.text===replyText));assert(!(await userHistory(OUTSIDER)).messages.some(m=>m.id===reply.message.id));
 const secondReply=await ok('support-reply',{conversationId:conversation,text:'사용자가 읽기 전에 도착한 추가 답변',requestId:randomUUID()});
 const receipt=await userRead(OWNER,history.messages.map(m=>m.id));assert.equal(receipt.readCount,1);assert.equal(receipt.unreadCount,1);assert.equal(await scalar(db,'select user_read_at from snote_support_private.messages where id=$1',[secondReply.message.id]),null,'User read acknowledges only replies actually displayed');
 await assert.rejects(()=>userRead(OUTSIDER,[secondReply.message.id]),error=>error.code==='42501');assert.equal((await userRead(OWNER,[secondReply.message.id])).unreadCount,0);assert.equal((await userRead(OWNER,[secondReply.message.id])).readCount,0);
 const page=await ok('support-thread',{conversationId:conversation,limit:2});assert.equal(page.messages.length,2);assert.equal(page.hasMore,true);assert(page.messages[0].sequence<page.messages[1].sequence);const older=await ok('support-thread',{conversationId:conversation,limit:50,before:page.nextBefore});assert.equal(new Set([...page.messages,...older.messages].map(m=>m.id)).size,4);assert.deepEqual(older.messages.map(m=>m.id),[first.message.id,incoming.message.id]);
 await ok('support-read',{conversationId:conversation,messageIds:[incoming.message.id]});assert.equal((await ok('support-unread')).unreadTotal,1,'Only the other conversation remains unread');

 const messagesBefore=(await db.query('select * from snote_support_private.messages order by seq')).rows,supportCallsBefore=calls.filter(c=>c.path.includes('/snote_operator_support_')).length;
 for(const[action,body]of[['support-unread',{}],['support-threads',{query:{}}],['support-thread',{conversationId:conversation}],['support-read',{conversationId:conversation,messageIds:[incoming.message.id]}],['support-reply',{conversationId:conversation,text:'must not send',requestId:randomUUID()}]]){
  const denied=await api(action,body,ADMIN);assert.equal(denied.status,403);assert.equal(denied.body.code,'FORBIDDEN');
 }
 assert.equal(calls.filter(c=>c.path.includes('/snote_operator_support_')).length,supportCallsBefore,'A company administrator is denied before any support RPC');assert.deepEqual((await db.query('select * from snote_support_private.messages order by seq')).rows,messagesBefore);
 await assert.rejects(()=>sqlRpc('snote_support_messages',{p_expected_company_id:COMPANY,p_expected_user_id:OWNER,p_limit:50,p_before:null},ADMIN),error=>error.code==='42501');
 revokeBeforeSupport=true;const revoked=await api('support-reply',{conversationId:conversation,text:'revoked operator must not send',requestId:randomUUID()});assert.equal(revoked.status,403);assert.equal(revoked.body.code,'FORBIDDEN');assert.deepEqual((await db.query('select * from snote_support_private.messages order by seq')).rows,messagesBefore,'Revocation between authorization and the actual SQL operation is enforced');
 assert.equal(calls.some(c=>c.service),false);assert(calls.filter(c=>c.path.includes('/snote_operator_support_')).every(c=>c.user===OP&&c.session===OP_SESSION));
});
