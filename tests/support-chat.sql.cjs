'use strict';
// Isolated real PostgreSQL permission/read-receipt regression. No network or live writes.
// NODE_PATH=/workspace/work/deps/node_modules node tests/support-chat.sql.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createOperatorFixture,OP,OP_SESSION}=require('./operator-core.sql.cjs');
const {COMPANY,FOREIGN,OWNER,OUTSIDER,ADMIN,ACCOUNTANT,INACTIVE}=require('./recycle-bin-db.cjs');
const ROOT=path.join(__dirname,'..'),FILE='20261107042252_scoped_support_conversations.sql';
const SQL=fs.readFileSync(path.join(ROOT,'supabase/migrations',FILE),'utf8');
async function createSupportFixture(){
 const db=await createOperatorFixture();
 await db.exec(fs.readFileSync(path.join(ROOT,'supabase/migrations/202611010005_vehicle_taxonomy.sql'),'utf8'));
 await db.exec(SQL);return db;
}
let db,passed=0;const sessions=new Map();
const q=(sql,args=[])=>db.query(sql,args);
const scalar=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
async function as(role,user,fn){
 await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);
 await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,sub:user||undefined,session_id:sessions.get(user),is_anonymous:false})]);
 await db.exec('set role '+role);try{return await fn();}finally{await db.exec('reset role');}
}
async function rpc(name,args={},actor=OWNER,role='authenticated'){
 const entries=Object.entries(args);return as(role,actor,()=>scalar('select public.'+name+'('+entries.map(([key],i)=>key+' => $'+(i+1)).join(',')+')',entries.map(([,v])=>v&&typeof v==='object'&&!Array.isArray(v)?JSON.stringify(v):v)));
}
const history=(actor=OWNER,company=actor===OUTSIDER?FOREIGN:COMPANY,limit=50,before=null)=>rpc('snote_support_messages',{p_expected_company_id:company,p_expected_user_id:actor,p_limit:limit,p_before:before},actor);
const send=(actor,text,request=randomUUID(),company=actor===OUTSIDER?FOREIGN:COMPANY,expected=actor)=>rpc('snote_support_send',{p_expected_company_id:company,p_expected_user_id:expected,p_text:text,p_request_id:request},actor);
const read=(actor,ids,company=actor===OUTSIDER?FOREIGN:COMPANY,expected=actor)=>rpc('snote_support_read',{p_expected_company_id:company,p_expected_user_id:expected,p_message_ids:ids},actor);
const op=(name,args={},actor=OP)=>rpc('snote_operator_support_'+name,args,actor);
const denied=(fn,code='42501')=>assert.rejects(fn,e=>e.code===code);
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
async function main(){
 db=await createSupportFixture();
 try{
  await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())',[OP,'operator@example.invalid']);
  await q("insert into snote_operator_private.operators(user_id,active,reason) values($1,true,'synthetic explicit owner approval')",[OP]);
  for(const user of[OP,OWNER,OUTSIDER,ADMIN,ACCOUNTANT,INACTIVE]){const id=user===OP?OP_SESSION:randomUUID();sessions.set(user,id);await q("insert into auth.sessions(id,user_id,ip,user_agent) values($1,$2,'192.0.2.13','Synthetic support test')",[id,user]);}
  const originalMembers=(await q('select * from public.zc_members order by user_id')).rows;
  await db.exec(SQL);
  await test('schema reapply and empty history create no conversation or message and preserve memberships',async()=>{
   const h=await history();assert.equal(h.conversation.id,null);assert.deepEqual(h.messages,[]);assert.equal(h.hasMore,false);assert.equal(h.nextBefore,null);assert.equal(h.unreadCount,0);
   assert.equal(await scalar('select count(*)::int from snote_support_private.conversations'),0);assert.equal(await scalar('select count(*)::int from snote_support_private.messages'),0);assert.deepEqual((await q('select * from public.zc_members order by user_id')).rows,originalMembers);
  });
  let a,b;
  await test('two actual signed-in users send isolated conversations; retries preserve one canonical message',async()=>{
   const request=randomUUID();a=await send(OWNER,'상담원 연결',request);assert.equal(a.duplicate,false);assert.equal(a.message.sender,'user');assert.equal(a.conversation.companyId,COMPANY);
   const again=await send(OWNER,'상담원 연결',request);assert.equal(again.duplicate,true);assert.equal(again.message.id,a.message.id);assert.equal(again.message.sequence,a.message.sequence);
   await denied(()=>send(OWNER,'changed payload',request),'22023');
   b=await send(OUTSIDER,'다른 상사 문의',request);assert.notEqual(a.conversation.id,b.conversation.id);assert.notEqual(a.message.id,b.message.id);assert.equal(b.duplicate,false);
   assert.deepEqual((await history()).messages.map(m=>m.text),['상담원 연결']);assert.deepEqual((await history(OUTSIDER)).messages.map(m=>m.text),['다른 상사 문의']);
   assert.equal((await op('unread')).unreadTotal,2);
  });
  await test('expected identities, ordinary tenant admins, inactive users and revoked sessions cannot cross scope',async()=>{
   const count=await scalar('select count(*)::int from snote_support_private.messages');
   await denied(()=>send(OUTSIDER,'must not be Alice',randomUUID(),COMPANY,OWNER));await denied(()=>read(OUTSIDER,[a.message.id],COMPANY,OWNER));
   await denied(()=>rpc('snote_support_messages',{p_expected_company_id:COMPANY,p_expected_user_id:OWNER,p_limit:50,p_before:null},ADMIN));
   for(const name of['unread','threads'])await denied(()=>op(name,name==='threads'?{p_query:{}}:{},ADMIN));
   await denied(()=>send(INACTIVE,'inactive'));await q("update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id=$1",[sessions.get(OWNER)]);await denied(()=>send(OWNER,'expired'));await q('update auth.sessions set not_after=null where id=$1',[sessions.get(OWNER)]);
   assert.equal(await scalar('select count(*)::int from snote_support_private.messages'),count);
  });
  await test('operator unread badge counts incoming messages rather than conversations and reading history alone never clears it',async()=>{
   const second=await send(OWNER,'추가 문의');assert.equal((await op('unread')).unreadTotal,3);
   const list=await op('threads',{p_query:{}});assert.equal(list.total,2);assert.equal(list.pageSize,20);assert.equal(list.unreadTotal,3);assert.equal(list.items.find(c=>c.id===a.conversation.id).unreadCount,2);
   const h=await op('messages',{p_conversation_id:a.conversation.id,p_limit:50,p_before:null});assert.equal(h.messages.length,2);assert.equal(h.unreadTotal,3);assert.equal((await op('unread')).unreadTotal,3);
   assert.equal(h.messages.at(-1).id,second.message.id);
  });
  await test('operator ACK marks only displayed IDs; messages arriving after the read stay unread',async()=>{
   const visible=await op('messages',{p_conversation_id:a.conversation.id,p_limit:50,p_before:null});const newer=await send(OWNER,'배지 갱신 중 새 문의');
   const ack=await op('read',{p_conversation_id:a.conversation.id,p_message_ids:visible.messages.map(m=>m.id)});assert.equal(ack.readCount,2);assert.equal(ack.unreadCount,1);assert.equal(ack.unreadTotal,2);
   assert.equal(await scalar('select operator_read_at from snote_support_private.messages where id=$1',[newer.message.id]),null);
   assert.equal((await op('read',{p_conversation_id:a.conversation.id,p_message_ids:visible.messages.map(m=>m.id)})).readCount,0);
   await denied(()=>op('read',{p_conversation_id:a.conversation.id,p_message_ids:[newer.message.id,b.message.id]}));assert.equal(await scalar('select operator_read_at from snote_support_private.messages where id=$1',[newer.message.id]),null);
  });
  await test('a delayed lower-sequence incoming message is not acknowledged by an unrelated higher-sequence view',async()=>{
   const reserved=await scalar("select nextval(pg_get_serial_sequence('snote_support_private.messages','seq'))::text");
   const higher=await send(OWNER,'먼저 표시된 높은 순번');const visible=await op('messages',{p_conversation_id:a.conversation.id,p_limit:100,p_before:null});
   const late=randomUUID();await q("insert into snote_support_private.messages(id,seq,conversation_id,sender_id,sender_kind,client_request_id,body,user_read_at) overriding system value values($1,$2,$3,$4,'user',$5,'나중 커밋된 낮은 순번',clock_timestamp())",[late,reserved,a.conversation.id,OWNER,randomUUID()]);
   assert(Number(reserved)<higher.message.sequence);await op('read',{p_conversation_id:a.conversation.id,p_message_ids:visible.messages.map(m=>m.id)});
   assert.equal(await scalar('select operator_read_at from snote_support_private.messages where id=$1',[late]),null);assert.equal((await op('messages',{p_conversation_id:a.conversation.id,p_limit:100,p_before:null})).unreadCount,1);
  });
  let reply1,reply2;
  await test('operator replies are plain text, idempotent and privately delivered to the correct user',async()=>{
   const request=randomUUID(),body='<img src=x onerror=alert(1)>\n상담원이 확인했습니다.';reply1=await op('reply',{p_conversation_id:a.conversation.id,p_text:body,p_request_id:request});
   assert.equal(reply1.message.sender,'operator');assert.equal(reply1.message.text,body);assert.equal(reply1.message.readAt,null);assert.equal(reply1.duplicate,false);
   const duplicate=await op('reply',{p_conversation_id:a.conversation.id,p_text:body,p_request_id:request});assert.equal(duplicate.duplicate,true);assert.equal(duplicate.message.id,reply1.message.id);
   await denied(()=>op('reply',{p_conversation_id:b.conversation.id,p_text:body,p_request_id:request}),'22023');assert((await history()).messages.some(m=>m.id===reply1.message.id));assert(!(await history(OUTSIDER)).messages.some(m=>m.id===reply1.message.id));
   assert.equal((await history()).unreadCount,1);assert.equal(await scalar("select count(*)::int from snote_operator_private.audit_log where action='support_reply' and request_id=$1",[request]),1);
  });
  await test('user reply ACK does not swallow a concurrent operator reply and cannot acknowledge another user thread',async()=>{
   const visible=await history();reply2=await op('reply',{p_conversation_id:a.conversation.id,p_text:'표시 후 추가 답변',p_request_id:randomUUID()});
   const ack=await read(OWNER,visible.messages.map(m=>m.id));assert.equal(ack.readCount,1);assert.equal(ack.unreadCount,1);assert.equal(await scalar('select user_read_at from snote_support_private.messages where id=$1',[reply2.message.id]),null);
   await denied(()=>read(OUTSIDER,[reply2.message.id]));assert.equal((await history()).unreadCount,1);assert.equal((await read(OWNER,[reply2.message.id])).unreadCount,0);
  });
  await test('text limits, controls and read-ID validation fail before any partial message or receipt change',async()=>{
   const count=await scalar('select count(*)::int from snote_support_private.messages');
   for(const text of['','   ','가'.repeat(2001),'bad\u0001control',null])await denied(()=>send(OWNER,text),'22023');
   await denied(()=>send(OWNER,'no id',null),'22023');await denied(()=>read(OWNER,null),'22023');await denied(()=>read(OWNER,[reply1.message.id,reply1.message.id]),'22023');await denied(()=>read(OWNER,Array.from({length:101},()=>randomUUID())),'22023');
   assert.equal(await scalar('select count(*)::int from snote_support_private.messages'),count);
   const max=await send(OWNER,'가'.repeat(2000));assert.equal(max.message.text.length,2000);
   const accountant=await send(ACCOUNTANT,'경리도 본인 문의만');assert.equal(accountant.message.sender,'user');await denied(()=>op('unread',{},ACCOUNTANT));
  });
  await test('history has a bounded chronological page with older cursors and no duplicates',async()=>{
   for(let i=0;i<56;i++)await send(OUTSIDER,'기록 '+String(i).padStart(2,'0'));
   const newest=await history(OUTSIDER);assert.equal(newest.messages.length,50);assert.equal(newest.hasMore,true);assert.equal(newest.nextBefore,newest.messages[0].sequence);
   assert(newest.messages.every((m,i)=>i===0||newest.messages[i-1].sequence<m.sequence));const older=await history(OUTSIDER,FOREIGN,50,newest.nextBefore);assert.equal(older.messages.length,7);assert.equal(older.hasMore,false);assert.equal(older.nextBefore,null);
   assert.equal(new Set([...newest.messages,...older.messages].map(m=>m.id)).size,57);assert.equal((await history(OUTSIDER,FOREIGN,100)).messages.length,57);
   await denied(()=>history(OUTSIDER,FOREIGN,101),'22023');await denied(()=>history(OUTSIDER,FOREIGN,0),'22023');await denied(()=>history(OUTSIDER,FOREIGN,50,-1),'22023');
  });
  await test('company reassignment and stale actor retries cannot send to or read the previous scope',async()=>{
   await q('update public.zc_members set company_id=$2 where user_id=$1',[OWNER,FOREIGN]);await denied(()=>send(OWNER,'stale company',randomUUID(),COMPANY));await denied(()=>history(OWNER,COMPANY));
   const empty=await history(OWNER,FOREIGN);assert.equal(empty.conversation.id,null);assert.deepEqual(empty.messages,[]);const fresh=await send(OWNER,'새 소속에서 상담',randomUUID(),FOREIGN);assert.notEqual(fresh.conversation.id,a.conversation.id);
   await denied(()=>read(OWNER,[reply1.message.id],FOREIGN));await q('update public.zc_members set company_id=$2 where user_id=$1',[OWNER,COMPANY]);assert((await history()).messages.some(m=>m.id===reply1.message.id));
  });
  await test('operator search, fixed twenty-thread paging and all-company scope require the allowlist',async()=>{
   for(let i=0;i<21;i++){const user=randomUUID(),sid=randomUUID();await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())',[user,'support-page-'+i+'@example.invalid']);await q("insert into public.zc_members(user_id,company_id,role,active) values($1,$2,'dealer',true)",[user,COMPANY]);sessions.set(user,sid);await q('insert into auth.sessions(id,user_id) values($1,$2)',[sid,user]);await send(user,'페이지 문의 '+i);}
   const page1=await op('threads',{p_query:{query:'support-page-',page:1}}),page2=await op('threads',{p_query:{query:'support-page-',page:2}});assert.equal(page1.total,21);assert.equal(page1.items.length,20);assert.equal(page2.items.length,1);assert(!page1.items.some(a=>page2.items.some(b=>a.id===b.id)));
   assert.equal((await op('threads',{p_query:{query:"' OR TRUE --"}})).total,0);await denied(()=>op('threads',{p_query:{status:'invalid'}}),'22023');await denied(()=>op('threads',{p_query:{extra:true}}),'22023');
   await q('update snote_operator_private.operators set active=false where user_id=$1',[OP]);await denied(()=>op('unread'));await q('update snote_operator_private.operators set active=true where user_id=$1',[OP]);
  });
  await test('public wrappers are invokers; anonymous/service/direct access and accidental SELECT remain blocked',async()=>{
   for(const role of['anon','service_role']){await denied(()=>rpc('snote_support_send',{p_expected_company_id:COMPANY,p_expected_user_id:OWNER,p_text:'blocked',p_request_id:randomUUID()},OWNER,role));await denied(()=>rpc('snote_operator_support_unread',{},OP,role));}
   for(const table of['conversations','messages']){
    for(const role of['anon','authenticated','service_role'])for(const permission of['SELECT','INSERT','UPDATE','DELETE'])assert.equal(await scalar('select has_table_privilege($1,$2,$3)',[role,'snote_support_private.'+table,permission]),false);
    assert.equal(await scalar('select relrowsecurity from pg_class where oid=$1::regclass',['snote_support_private.'+table]),true);
    await denied(()=>as('authenticated',OWNER,()=>q('select * from snote_support_private.'+table)));
    await db.exec('grant select on snote_support_private.'+table+' to authenticated');try{assert.equal(await as('authenticated',OP,()=>scalar('select count(*)::int from snote_support_private.'+table)),0);}finally{await db.exec('revoke select on snote_support_private.'+table+' from authenticated');}
   }
   const fns=(await q("select prosecdef,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('snote_support_messages','snote_support_send','snote_support_read','snote_operator_support_threads','snote_operator_support_messages','snote_operator_support_read','snote_operator_support_reply','snote_operator_support_unread')")).rows;assert.equal(fns.length,8);for(const fn of fns){assert.equal(fn.prosecdef,false);assert(fn.proconfig.includes('search_path=""'));}
   await denied(()=>q("update snote_support_private.messages set body='rewritten' where id=$1",[a.message.id]),'55000');
  });
  await test('migration reapply preserves messages, exact read receipts and idempotent responses',async()=>{
   const rows=(await q('select * from snote_support_private.messages order by seq')).rows,threads=(await q('select * from snote_support_private.conversations order by id')).rows;await db.exec(SQL);assert.deepEqual((await q('select * from snote_support_private.messages order by seq')).rows,rows);assert.deepEqual((await q('select * from snote_support_private.conversations order by id')).rows,threads);assert.equal((await op('messages',{p_conversation_id:a.conversation.id,p_limit:100,p_before:null})).conversation.id,a.conversation.id);
  });
  console.log(`${passed} support chat SQL groups passed`);
 }finally{await db.close();}
}
module.exports={createSupportFixture,SQL,FILE};
if(require.main===module)main().catch(error=>{console.error({code:error.code,message:error.message,where:error.where,position:error.position});process.exitCode=1;});
