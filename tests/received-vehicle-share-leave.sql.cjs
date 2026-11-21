'use strict';
// Real PostgreSQL functions/RLS with isolated synthetic accounts and vehicle data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createPermissionFixture,COMPANY,FOREIGN,OWNER,RECIPIENT,UPLOADER,ADMIN,ID}=require('./vehicle-share-permissions-db.cjs');
const FILE='20261121132251_received_vehicle_share_leave.sql',SQL=fs.readFileSync(path.join(__dirname,'../supabase/migrations',FILE),'utf8');
async function run(){
 const f=await createPermissionFixture(),{db,actor,scalar,call,reply}=f;let passed=0,failed=0;
 const test=async(name,fn)=>{try{await fn();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name,error);}};
 const deny=(fn,codes=['42501'])=>assert.rejects(fn,error=>codes.includes(error.code));
 const privileged=async(sql,args=[])=>{await db.exec('reset role');return db.query(sql,args);};
 const snapshot=async()=>{await db.exec('reset role');return Object.fromEntries(await Promise.all(['public.zc_datasets','public.zc_media','storage.objects','snote_private.vehicle_notifications','snote_private.vehicle_shares','public.zc_audit'].map(async table=>[table,(await db.query('select to_jsonb(t) as row from '+table+' t order by to_jsonb(t)::text')).rows.map(x=>x.row)])));};
 const leave=(grant,extra={})=>scalar('select public.snote_vehicle_share_leave($1,$2,$3,$4,$5,$6) as value',[Object.hasOwn(extra,'company')?extra.company:COMPANY,Object.hasOwn(extra,'owner')?extra.owner:OWNER,Object.hasOwn(extra,'car')?extra.car:ID,Object.hasOwn(extra,'recipientCompany')?extra.recipientCompany:FOREIGN,Object.hasOwn(extra,'invitation')?extra.invitation:grant.invitationId,Object.hasOwn(extra,'expected')?extra.expected:grant.version]);
 const grant=async(permission='read',recipient=RECIPIENT)=>{await actor(OWNER);await call('revoke',{target:recipient});const pending=await call('grant',{email:recipient+'@example.invalid',permission});await actor(recipient);await reply(pending.invitationId,pending.version);await actor(OWNER);return(await call('outgoing')).find(x=>x.id===recipient);};
 try{
  const before=await snapshot();await db.exec(SQL);assert.deepEqual(await snapshot(),before);
  await test('migration exposes only authenticated invoker wrapper and checked private definer with empty search paths',async()=>{
   const rows=(await privileged("select n.nspname,p.proname,p.prosecdef,p.proconfig,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname='snote_vehicle_share_leave') or(n.nspname='snote_private' and p.proname='vehicle_share_leave')")).rows;
   assert.equal(rows.length,2);for(const row of rows){assert.equal(row.prosecdef,row.nspname==='snote_private');assert(row.proconfig.some(x=>x==='search_path=""'));assert.equal(row.authenticated,true);assert.equal(row.anon,false);assert.equal(row.service,false);}
   await actor(RECIPIENT);await deny(()=>db.query('select * from snote_private.vehicle_shares'));
  });
  await test('read-only recipient leaves only their exact accepted grant and loses read/media access',async()=>{
   const own=await grant('read'),other=await grant('all',UPLOADER);await actor(RECIPIENT);const read=await call('read');assert.equal(read.canEdit,false);assert.equal(read.canDelete,false);const before=await snapshot();await actor(RECIPIENT);const result=await leave(own);const after=await snapshot();
   assert.deepEqual(result,{apiVersion:2,ok:true,left:true,companyId:COMPANY,ownerId:OWNER,carId:ID,recipientCompanyId:FOREIGN,invitationId:own.invitationId,version:own.version+1,state:'rejected',alreadyProcessed:false});
   for(const table of ['public.zc_datasets','public.zc_media','storage.objects','snote_private.vehicle_notifications'])assert.deepEqual(after[table],before[table]);
   assert.deepEqual(after['snote_private.vehicle_shares'].filter(x=>x.recipient_id!==RECIPIENT),before['snote_private.vehicle_shares'].filter(x=>x.recipient_id!==RECIPIENT));
   const changed=after['snote_private.vehicle_shares'].find(x=>x.recipient_id===RECIPIENT);assert.equal(changed.state,'rejected');assert.equal(changed.version,own.version+1);assert.equal(changed.permission,'read');assert.equal(after['public.zc_audit'].length,before['public.zc_audit'].length+1);
   await actor(RECIPIENT);assert.deepEqual(await call('incoming'),[]);await deny(()=>call('read'));await deny(()=>call('media'));assert.equal((await db.query('select * from storage.objects')).rows.length,0);
   await actor(OWNER);assert.equal((await call('read')).nativeAccess,true);assert.equal((await call('outgoing')).find(x=>x.id===UPLOADER).invitationId,other.invitationId);await actor(UPLOADER);assert.equal((await call('read')).permission,'all');
  });
  await test('lost acknowledgement retry is idempotent and adds no second audit or version change',async()=>{
   const own=await grant();await actor(RECIPIENT);await leave(own);const before=await snapshot();await actor(RECIPIENT);const result=await leave(own);assert.equal(result.alreadyProcessed,true);assert.equal(result.version,own.version+1);assert.deepEqual(await snapshot(),before);
  });
  await test('foreign company/owner/car/version/invitation and other recipients fail without changes',async()=>{
   const own=await grant();for(const extra of[{company:FOREIGN},{owner:UPLOADER},{car:ID+'-other'},{recipientCompany:COMPANY},{expected:own.version-1},{expected:own.version+1},{invitation:'99999999-9999-4999-8999-999999999999'}]){const before=await snapshot();await actor(RECIPIENT);await deny(()=>leave(own,extra),['40001']);assert.deepEqual(await snapshot(),before);}
   for(const id of[OWNER,UPLOADER,ADMIN]){const before=await snapshot();await actor(id);await deny(()=>leave(own),['40001']);assert.deepEqual(await snapshot(),before);}
  });
  await test('pending and original rejected invitation cannot masquerade as a completed leave',async()=>{
   await actor(OWNER);await call('revoke',{target:RECIPIENT});const pending=await call('grant',{email:RECIPIENT+'@example.invalid'});let before=await snapshot();await actor(RECIPIENT);await deny(()=>leave(pending),['40001']);assert.deepEqual(await snapshot(),before);await actor(RECIPIENT);await reply(pending.invitationId,pending.version,false);before=await snapshot();await actor(RECIPIENT);await deny(()=>leave(pending),['40001']);assert.deepEqual(await snapshot(),before);
  });
  await test('permission-version changes and replacement invitations cannot reuse old acceptance',async()=>{
   let own=await grant();await actor(OWNER);await call('permissions',{target:RECIPIENT,permission:'all',access:{invitationId:own.invitationId,version:own.version}});let before=await snapshot();await actor(RECIPIENT);await deny(()=>leave(own),['40001']);assert.deepEqual(await snapshot(),before);
   own=await grant();await actor(RECIPIENT);await leave(own);const replacement=await grant('read');before=await snapshot();await actor(RECIPIENT);await deny(()=>leave(own),['40001']);assert.deepEqual(await snapshot(),before);await actor(RECIPIENT);assert.equal((await call('read')).invitationId,replacement.invitationId);
  });
  await test('inactive/moved/banned/anonymous/anon/service-role actors cannot leave a grant',async()=>{
   const own=await grant();
   for(const [setup,restore]of [
    [()=>privileged('update public.zc_members set active=false where user_id=$1',[RECIPIENT]),()=>privileged('update public.zc_members set active=true where user_id=$1',[RECIPIENT])],
    [()=>privileged('update public.zc_members set company_id=$1 where user_id=$2',[COMPANY,RECIPIENT]),()=>privileged('update public.zc_members set company_id=$1 where user_id=$2',[FOREIGN,RECIPIENT])],
    [()=>privileged("update auth.users set banned_until=now()+interval '1 day' where id=$1",[RECIPIENT]),()=>privileged('update auth.users set banned_until=null where id=$1',[RECIPIENT])],
    [()=>privileged('update public.zc_members set active=false where user_id=$1',[OWNER]),()=>privileged('update public.zc_members set active=true where user_id=$1',[OWNER])]
   ]){await setup();const before=await snapshot();await actor(RECIPIENT);await deny(()=>leave(own));assert.deepEqual(await snapshot(),before);await restore();}
   for(const [id,role,anonymous]of[[RECIPIENT,'authenticated',true],[null,'anon',false],[RECIPIENT,'service_role',false]]){const before=await snapshot();await actor(id,role,anonymous);await deny(()=>leave(own));assert.deepEqual(await snapshot(),before);}
  });
  await test('null/malformed arguments are atomic and migration reapplication preserves all records and ACLs',async()=>{
   const own=await grant();for(const extra of[{company:null},{owner:null},{car:''},{car:'x'.repeat(201)},{recipientCompany:null},{invitation:null},{expected:null},{expected:0},{expected:2147483647}]){const before=await snapshot();await actor(RECIPIENT);await deny(()=>leave(own,extra),['22023']);assert.deepEqual(await snapshot(),before);}
   const before=await snapshot(),acls=(await privileged("select n.nspname,p.proname,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in('vehicle_share_leave','snote_vehicle_share_leave') order by 1,2")).rows;await db.exec(SQL);assert.deepEqual(await snapshot(),before);assert.deepEqual((await privileged("select n.nspname,p.proname,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in('vehicle_share_leave','snote_vehicle_share_leave') order by 1,2")).rows,acls);
  });
  console.log(JSON.stringify({passed,failed}));assert.equal(failed,0);
 }finally{await db.close();}
}
if(require.main===module)run().catch(error=>{console.error(error.stack);process.exitCode=1;});
module.exports={FILE,SQL};
