'use strict';
// Isolated PostgreSQL/RLS tests: all users, vehicles, files and identities are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const OWNER='11111111-1111-4111-8111-111111111111',RECIPIENT='22222222-2222-4222-8222-222222222222',OTHER='33333333-3333-4333-8333-333333333333',ADMIN='44444444-4444-4444-8444-444444444444';
const COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',FOREIGN='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MIGRATION='supabase/migrations/20261107041621_vehicle_share_acceptance.sql';
let db,passed=0,failed=0;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
async function actor(id,role='authenticated',anonymous=false){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role,is_anonymous:anonymous})]);await db.exec('set role '+role);}
const call=(action,args={})=>scalar('select public.snote_vehicle_share($1,$2,$3,$4,$5,$6,$7,$8)',[action,args.company||COMPANY,args.owner||OWNER,args.car||'a',args.email||null,args.target||null,args.expected??null,args.patch?JSON.stringify(args.patch):null]);
const reply=(id,expected,accept)=>scalar('select public.snote_vehicle_share_reply($1,$2,$3)',[id,expected,accept]);
const notes=(action='list',ids=[])=>scalar('select public.snote_vehicle_notifications($1,$2)',[action,ids]);
const badges=()=>scalar('select public.snote_vehicle_share_badges()');
const files=()=>db.query('select name from storage.objects order by name');
async function deny(fn,codes=['42501']){await assert.rejects(fn,error=>codes.includes(error.code));}
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name,e);}}
async function privileged(sql,args=[]){await db.exec('reset role');return db.query(sql,args);}
async function fixture(){
 db=new PGlite();await db.waitReady;
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid(),auth.jwt() to authenticated;
 create table public.zc_companies(id uuid primary key);
 create table public.zc_members(user_id uuid primary key,company_id uuid,active boolean,role text,display_name text);
 create table public.zc_datasets(company_id uuid,owner_id uuid,dataset text,payload jsonb,revision int,updated_at timestamptz,updated_by uuid,primary key(company_id,owner_id,dataset));
 create table public.zc_media(id text,company_id uuid,owner_id uuid,car_id text,group_name text,file_path text,original_name text);
 create table public.zc_audit(company_id uuid,actor_id uuid,entity text,item_key text,action text);
 create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select on storage.objects to authenticated;
 `);
 for(const name of['20261104153021_vehicle_scoped_dealer_sharing.sql','20261104155050_vehicle_change_notifications.sql','20261104160202_vehicle_notification_scope_guard.sql','20261105105113_shared_vehicle_registered_notifications.sql','20261106013856_performance_inspection_cost_notifications.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 await db.exec("create function snote_private.recycle_lock(p_company uuid) returns void language sql set search_path='' as $$select pg_advisory_xact_lock(hashtextextended('snote-recycle:'||p_company::text,0))$$;");
 const recycleSQL=fs.readFileSync('supabase/migrations/20261106113557_scoped_recycle_bin.sql','utf8');
 const uri=recycleSQL.match(/create function snote_private[.]recycle_uri_component\([\s\S]+?\$f\$;/)[0];await db.exec(uri);
 await db.exec(`alter table public.zc_media enable row level security;grant select on public.zc_media to authenticated;
 create policy fixture_media_company on public.zc_media for select to authenticated using(exists(select 1 from public.zc_members m where m.user_id=auth.uid() and m.company_id=zc_media.company_id and m.active));
 create policy fixture_storage_company on storage.objects for select to authenticated using(exists(select 1 from public.zc_members m where m.user_id=auth.uid() and m.active and(m.company_id::text=split_part(name,'/',1) or exists(select 1 from public.zc_media f where f.file_path=objects.name and f.company_id=m.company_id))));
 grant select on public.zc_members to authenticated;
 `);
 await db.query('insert into zc_companies values($1),($2)',[COMPANY,FOREIGN]);
 for(const[id,email,company,role,name]of[[OWNER,'owner@example.test',COMPANY,'dealer','소유자'],[RECIPIENT,'dealer@example.test',FOREIGN,'dealer','받은 딜러'],[OTHER,'other@example.test',FOREIGN,'dealer','다른 딜러'],[ADMIN,'admin@example.test',COMPANY,'admin','상사 관리자']]){
  await db.query('insert into auth.users values($1,$2,now(),null,null)',[id,email]);await db.query('insert into zc_members values($1,$2,true,$3,$4)',[id,company,role,name]);
 }
 const car={id:'a',model:'차량 A',plate:'12가3456',moneyUnit:'KRW',buy:12000000,sell:15000000,secretCustomer:'NEVER SHARE',incomeSettlement:{privateCipher:'NEVER SHARE'},costs:{performanceInspection:100000}};
 await db.query("insert into zc_datasets values($1,$2,'cars',$3,7,now(),$2)",[COMPANY,OWNER,JSON.stringify([car,{id:'b',model:'UNRELATED',secret:'UNCHANGED'},{...car,id:'legacy',model:'이전 공유'}])]);
 await db.query("insert into zc_media values('file-a',$1,$2,'a','registration','a/path','registration.png'),('file-b',$1,$2,'b','registration','b/path','registration.png'),('file-legacy',$1,$2,'legacy','registration','legacy/path','legacy.png')",[COMPANY,OWNER]);
 await db.exec("insert into storage.objects values('zc-vehicle-private','a/path'),('zc-vehicle-private','b/path'),('zc-vehicle-private','legacy/path')");
 await actor(OWNER);await call('grant',{car:'legacy',email:'dealer@example.test'});
 await db.exec('reset role');await db.exec(fs.readFileSync(MIGRATION,'utf8'));
}
(async()=>{try{
 await fixture();let invitation,invitation2,invitation3;
 await test('existing grants and shared notifications migrate as accepted without changing normal company-admin scope',async()=>{
  await actor(RECIPIENT);const incoming=await call('incoming');assert.equal(incoming.length,1);assert.equal(incoming[0].state,'accepted');assert.equal(incoming[0].carId,'legacy');assert.equal((await call('read',{car:'legacy'})).revision,7);assert.deepEqual((await files()).rows,[{name:'legacy/path'}]);assert((await notes()).items.some(n=>n.eventType==='shared'));
  await actor(ADMIN);assert.equal((await call('read')).car.model,'차량 A');await actor(OTHER);await deny(()=>call('read'));
 });
 await test('new grants are idempotent pending invitations and expose only a basic notification before acceptance',async()=>{
  await actor(OWNER);invitation=await call('grant',{email:'DEALER@example.test'});assert.equal(invitation.state,'pending');assert.equal(invitation.version,1);const again=await call('grant',{email:'dealer@example.test'});assert.equal(again.invitationId,invitation.invitationId);assert.equal((await call('outgoing')).find(r=>r.id===RECIPIENT).state,'pending');assert.deepEqual(await badges(),[{ownerId:OWNER,carId:'legacy',state:'accepted'}]);
  await actor(RECIPIENT);assert.equal((await call('incoming')).some(x=>x.carId==='a'),false);for(const action of['read','media','update'])await deny(()=>call(action,{expected:7,patch:{sell:1}}));assert.deepEqual((await files()).rows,[{name:'legacy/path'}]);const n=(await notes()).items.find(x=>x.eventType==='share_invitation');assert.equal(n.car,'차량 A · 12가3456');assert.equal(n.actor,'소유자');assert.equal(n.invitation.id,invitation.invitationId);assert.equal(n.invitation.version,1);assert.equal(n.invitation.state,'pending');assert.deepEqual(n.changes,[]);assert(!JSON.stringify(n).includes('12000000'));assert(!JSON.stringify(n).includes('NEVER SHARE'));await notes('read',[n.id]);assert.equal((await notes()).items.find(x=>x.id===n.id).invitation.state,'pending');
 });
 await test('pending recipients receive no vehicle-change values and strangers cannot respond or list their invitation',async()=>{
  await actor(OWNER);await call('update',{expected:7,patch:{sell:15000001}});await actor(RECIPIENT);assert.equal((await notes()).items.some(x=>x.eventType==='changed'&&x.car.startsWith('차량 A')),false);
  await actor(OTHER);assert.equal((await notes()).items.length,0);await deny(()=>reply(invitation.invitationId,1,true),['40001']);await actor(OWNER);await deny(()=>reply(invitation.invitationId,1,true),['40001']);
 });
 await test('only the invited active company-bound dealer can accept the exact invitation version',async()=>{
  await privileged('update zc_members set company_id=$1 where user_id=$2',[COMPANY,RECIPIENT]);await actor(RECIPIENT);await deny(()=>reply(invitation.invitationId,1,true));await privileged('update zc_members set company_id=$1 where user_id=$2',[FOREIGN,RECIPIENT]);await actor(RECIPIENT);await deny(()=>reply(invitation.invitationId,2,true),['40001']);const accepted=await reply(invitation.invitationId,1,true);assert.equal(accepted.state,'accepted');assert.equal(accepted.version,2);assert.equal(accepted.alreadyProcessed,false);assert.equal((await reply(invitation.invitationId,1,true)).alreadyProcessed,true);await deny(()=>reply(invitation.invitationId,1,false),['40001']);
  assert((await call('incoming')).some(x=>x.carId==='a'&&x.state==='accepted'));const read=await call('read');assert.equal(read.revision,8);assert(!Object.hasOwn(read.car,'secretCustomer'));assert(!Object.hasOwn(read.car,'incomeSettlement'));assert(!Object.hasOwn(read.car,'ownerId'));assert.equal((await call('media')).length,1);assert.deepEqual((await files()).rows,[{name:'a/path'},{name:'legacy/path'}]);await deny(()=>call('read',{car:'b'}));
 });
 await test('accepted shared edits preserve CAS/privacy, actor names, costs notifications and unrelated cars',async()=>{
  await actor(RECIPIENT);await deny(()=>call('grant',{email:'other@example.test'}));await deny(()=>call('revoke',{target:RECIPIENT}));await deny(()=>call('update',{expected:8,patch:{ownerId:RECIPIENT}}));await deny(()=>call('update',{expected:8,patch:{buy:1.1}}),['22023']);const saved=await call('update',{expected:8,patch:{model:'수정된 차명',buy:12000001}});assert.equal(saved.revision,9);await deny(()=>call('update',{expected:8,patch:{sell:1}}),['40001']);
  await actor(OWNER);const changed=(await notes()).items.find(n=>n.eventType==='changed');assert.equal(changed.actor,'받은 딜러');assert.equal(changed.changes.find(x=>x.field==='buy').after,12000001);assert(!JSON.stringify(changed).includes('NEVER SHARE'));
  await privileged("update zc_datasets set payload=jsonb_set(payload,'{0,costs,performanceInspection}','120000'),updated_by=$1,revision=revision+1 where company_id=$2",[OWNER,COMPANY]);await actor(RECIPIENT);assert((await notes()).items.some(n=>n.changes.some(x=>x.field==='costs.performanceInspection')));
  const row=(await privileged('select payload from zc_datasets')).rows[0].payload;assert.equal(row[1].model,'UNRELATED');assert.equal(row[1].secret,'UNCHANGED');assert.equal(row[0].secretCustomer,'NEVER SHARE');assert.equal(row[0].incomeSettlement.privateCipher,'NEVER SHARE');
 });
 await test('revocation and reinvitation rotate identity; stale invitation responses never authorize the new share',async()=>{
  await actor(OWNER);await call('revoke',{target:RECIPIENT});await actor(RECIPIENT);await deny(()=>call('read'));await deny(()=>reply(invitation.invitationId,1,true),['40001']);assert.deepEqual((await files()).rows,[{name:'legacy/path'}]);assert.equal((await notes()).items.some(n=>n.invitation?.id===invitation.invitationId),false);
  await actor(OWNER);invitation2=await call('grant',{email:'dealer@example.test'});assert.notEqual(invitation2.invitationId,invitation.invitationId);assert.equal(invitation2.state,'pending');await actor(RECIPIENT);await deny(()=>reply(invitation.invitationId,1,true),['40001']);await deny(()=>call('read'));assert.equal((await notes()).items.filter(n=>n.eventType==='changed'&&n.car.startsWith('수정된')).length,0);
 });
 await test('rejection remains hidden from incoming/files and duplicate grant does not override the recipient choice',async()=>{
  await actor(RECIPIENT);const rejected=await reply(invitation2.invitationId,1,false);assert.equal(rejected.state,'rejected');assert.equal((await reply(invitation2.invitationId,1,false)).alreadyProcessed,true);await deny(()=>reply(invitation2.invitationId,1,true),['40001']);await deny(()=>call('read'));assert.equal((await call('incoming')).some(x=>x.carId==='a'),false);assert.deepEqual((await files()).rows,[{name:'legacy/path'}]);assert.equal((await notes()).items.find(n=>n.invitation?.id===invitation2.invitationId).invitation.state,'rejected');await actor(OWNER);assert.equal((await call('grant',{email:'dealer@example.test'})).state,'rejected');await call('revoke',{target:RECIPIENT});invitation3=await call('grant',{email:'dealer@example.test'});assert.notEqual(invitation3.invitationId,invitation2.invitationId);
 });
 await test('inactive, moved, banned and anonymous actors cannot accept or retain shared file access',async()=>{
  await privileged('update zc_members set active=false where user_id=$1',[RECIPIENT]);await actor(RECIPIENT);await deny(()=>reply(invitation3.invitationId,1,true));await privileged('update zc_members set active=true where user_id=$1',[RECIPIENT]);await actor(RECIPIENT);await reply(invitation3.invitationId,1,true);await privileged("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[RECIPIENT]);await actor(RECIPIENT);await deny(()=>call('read'));assert.equal((await files()).rows.length,0);await privileged('update auth.users set banned_until=null where id=$1',[RECIPIENT]);await actor(RECIPIENT,'authenticated',true);await deny(()=>call('incoming'));await deny(()=>reply(invitation3.invitationId,1,true));assert.equal((await files()).rows.length,0);await actor(null,'anon');await deny(()=>call('incoming'));await deny(()=>reply(invitation3.invitationId,1,true));await deny(()=>notes());
 });
 await test('private rows/helpers have no direct client grants; migration repeat preserves decisions and IDs',async()=>{
  await actor(RECIPIENT);await deny(()=>db.query('select * from snote_private.vehicle_shares'));await deny(()=>db.query('select * from snote_private.vehicle_notifications'));await deny(()=>db.query('select snote_private.share_member($1,$2)',[OWNER,COMPANY]));await db.exec('reset role');await db.exec(fs.readFileSync(MIGRATION,'utf8'));await actor(OWNER);const same=(await call('outgoing')).find(x=>x.id===RECIPIENT);assert.equal(same.invitationId,invitation3.invitationId);assert.equal(same.state,'accepted');assert.equal(same.version,2);
 });
 await test('restrictive RLS closes same-company file bypass, preserves admin/accountant scope and uses vehicle ownership for uploaded documents',async()=>{
  await privileged('update zc_members set company_id=$1,role=$2 where user_id=$3',[COMPANY,'dealer',OTHER]);await actor(OTHER);assert.equal((await files()).rows.length,0);assert.equal(await scalar('select count(*) from public.zc_media'),0);
  await actor(OWNER);const pending=await call('grant',{email:'other@example.test'});await actor(OTHER);await deny(()=>call('read'));assert.equal((await files()).rows.length,0);await reply(pending.invitationId,1,true);assert.deepEqual((await files()).rows,[{name:'a/path'}]);
  await actor(OWNER);await call('revoke',{target:OTHER});await actor(OTHER);assert.equal((await files()).rows.length,0,'Revoking a same-company share must not restore the old broad company-wide permission');
  await privileged('update zc_members set role=$1 where user_id=$2',['accountant',OTHER]);await actor(OTHER);assert.equal((await files()).rows.length,3);await actor(ADMIN);assert.equal((await files()).rows.length,3);
  const path=COMPANY+'/'+OTHER+'/a/uploaded.png',uploadInterval=COMPANY+'/'+OTHER+'/a/unrecorded.png',branding=COMPANY+'/'+ADMIN+'/branding/logo.png';
  await privileged("insert into public.zc_media values('accountant-doc',$1,$2,'a','inspection1',$3,'uploaded.png')",[COMPANY,OTHER,path]);await privileged("insert into storage.objects values('zc-vehicle-private',$1),('zc-vehicle-private',$2),('zc-vehicle-private',$3)",[path,uploadInterval,branding]);
  await actor(OWNER);assert((await files()).rows.some(x=>x.name===path));assert((await files()).rows.some(x=>x.name===uploadInterval));assert.equal((await call('media')).length,2);
  await actor(RECIPIENT);assert((await files()).rows.some(x=>x.name===path));assert.equal((await call('media')).length,2,'Accepted shares include accountant-uploaded documents');
  await privileged('update zc_members set role=$1 where user_id=$2',['dealer',OTHER]);await actor(OTHER);assert.equal((await files()).rows.some(x=>x.name===path),false);assert.equal((await files()).rows.some(x=>x.name===uploadInterval),false);assert((await files()).rows.some(x=>x.name===branding),'Non-vehicle branding retains its existing company policy');
  await privileged("insert into zc_datasets values($1,$2,'cars','[{\"id\":\"a\",\"model\":\"AMBIGUOUS\"}]',1,now(),$2)",[COMPANY,OTHER]);await actor(RECIPIENT);assert.equal((await files()).rows.some(x=>x.name==='a/path'||x.name===path),false);await deny(()=>call('read'),['40001']);assert.equal((await call('incoming')).some(x=>x.carId==='a'),false);await actor(OWNER);assert.equal((await files()).rows.some(x=>x.name==='a/path'||x.name===path),false,'Ambiguous canonical ownership is not guessed');await actor(ADMIN);assert((await files()).rows.some(x=>x.name===path),'Company admins retain their management scope');
 });
 await test('production RLS/recycle guards preserve customer isolation, accountant uploads, accepted editing and non-resurrection after restore',async()=>{
  const fixtureModule=require('./recycle-bin-db.cjs'),saved=db,full=await fixtureModule.createFixture();
  try{db=full;const c=fixtureModule.COMPANY,o=fixtureModule.OWNER,r=fixtureModule.OUTSIDER,accountant=fixtureModule.ACCOUNTANT,id='compat-car',path=c+'/'+accountant+'/'+id+'/accountant-doc.jpg';
   await db.exec("alter table auth.users add column deleted_at timestamptz;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;");
   await db.query("insert into zc_datasets(company_id,owner_id,dataset,payload,revision,updated_by) values($1,$2,'cars',$3,1,$2)",[c,o,JSON.stringify([{id,model:'Compatibility vehicle',plate:'99가9999',moneyUnit:'KRW',buy:10000000,sell:12000000,status:'판매중'}])]);
   await db.query("insert into public.zc_media(company_id,owner_id,id,car_id,file_path,original_name,mime_type,file_size,group_name) values($1,$2,'accountant-doc',$3,$4,'accountant-doc.jpg','image/jpeg',100,'registration')",[c,accountant,id,path]);
   await db.query("insert into storage.objects(bucket_id,name) values('zc-vehicle-private',$1)",[path]);await db.query("insert into public.zc_customers(company_id,owner_id,car_id,payload) values($1,$2,$3,'{\"name\":\"PRIVATE_CUSTOMER\"}')",[c,o,id]);
   await db.exec(fs.readFileSync('supabase/migrations/20261106113557_scoped_recycle_bin.sql','utf8'));await db.exec(fs.readFileSync(MIGRATION,'utf8'));
   await actor(o);const invitation=await call('grant',{company:c,owner:o,car:id,email:r+'@example.invalid'});await actor(r);assert.equal((await files()).rows.length,0);assert.equal(await scalar('select count(*) from public.zc_customers'),0);assert.equal(await scalar('select count(*) from public.zc_datasets'),0);await reply(invitation.invitationId,1,true);
   assert.equal((await call('media',{company:c,owner:o,car:id})).length,1);assert.deepEqual((await files()).rows,[{name:path}]);assert.equal(await scalar('select count(*) from public.zc_customers'),0);assert.equal(await scalar('select count(*) from public.zc_datasets'),0);const updated=await call('update',{company:c,owner:o,car:id,expected:1,patch:{sell:12000001}});assert.equal(updated.revision,2);
   await actor(o);const trashed=await scalar('select public.snote_recycle_trash_vehicle($1,$2,$3,$4,$5,$6)',[c,o,id,2,0,'abababab-abab-4bab-8bab-abababababab']);await scalar('select public.snote_recycle_restore($1,$2)',[c,trashed.id]);await actor(r);assert.equal((await call('incoming')).length,0);assert.equal((await files()).rows.length,0);await deny(()=>reply(invitation.invitationId,1,true),['40001']);
  }finally{await full.close();db=saved;}
 });
 console.log(JSON.stringify({passed,failed}));if(failed)process.exitCode=1;
}finally{if(db)await db.close();}})().catch(e=>{console.error(e);process.exitCode=1});
