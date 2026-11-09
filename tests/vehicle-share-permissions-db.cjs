'use strict';
// Actual PostgreSQL/RLS/share/recycle functions. Every account and row is synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const baseline=require('./vehicle-memo-sharing.sql.cjs');
const {createMemoFixture,COMPANY,FOREIGN,OWNER,RECIPIENT,UPLOADER,ADMIN,ID}=baseline;
const ROOT=path.resolve(__dirname,'..'),FILE='20261109020649_vehicle_share_permissions.sql';
const SQL=()=>fs.readFileSync(path.join(ROOT,'supabase/migrations',FILE),'utf8');
const access=value=>({invitationId:value.invitationId,version:value.version});
async function createPermissionFixture({legacy=false}={}){
 const f=await createMemoFixture(),legacyCall=f.call;
 let legacyInvitation=null;
 if(legacy){await f.actor(OWNER);legacyInvitation=await legacyCall('grant',{email:RECIPIENT+'@example.invalid'});await f.actor(RECIPIENT);await f.reply(legacyInvitation.invitationId,legacyInvitation.version);}
 await f.db.exec('reset role');await f.db.exec(SQL());
 const call=(action,args={})=>f.scalar('select public.snote_vehicle_share_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as value',[action,args.company??COMPANY,args.owner??OWNER,args.car??ID,args.email??null,args.target??null,args.expected??null,Object.hasOwn(args,'patch')?JSON.stringify(args.patch):null,Object.hasOwn(args,'permission')?args.permission:action==='grant'?'read':null,Object.hasOwn(args,'access')?JSON.stringify(args.access):null]);
 return {...f,call,legacyCall,legacyInvitation};
}
async function run(){
 const f=await createPermissionFixture({legacy:true}),{db,actor,scalar,call,legacyCall,state,notes,reply}=f;
 let passed=0,failed=0,invitation,loaded;
 const check=async(name,fn)=>{try{await fn();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name,error);}};
 const deny=(fn,codes=['42501'])=>assert.rejects(fn,error=>codes.includes(error.code));
 const privileged=async(sql,args=[])=>{await db.exec('reset role');return db.query(sql,args);};
 async function current(){await actor(RECIPIENT);return call('read');}
 async function setPermission(permission){await actor(OWNER);const row=(await call('outgoing')).find(row=>row.id===RECIPIENT);return call('permissions',{target:RECIPIENT,permission,access:access(row)});}
 try{
  await check('existing accepted grants retain edit capability; authoritative metadata identifies shared and native access',async()=>{
   await actor(RECIPIENT);loaded=await call('read');assert.equal(loaded.permission,'edit');assert.equal(loaded.apiVersion,2);assert.equal(loaded.nativeAccess,false);assert.equal(loaded.canEdit,true);assert.equal(loaded.canDelete,false);assert.equal(loaded.version,2);assert(loaded.invitationId);
   assert(!Object.hasOwn(loaded.car,'incomeSettlement'));assert(!Object.hasOwn(loaded.car,'extra'));await actor(OWNER);const native=await call('read');assert.equal(native.permission,'all');assert.equal(native.nativeAccess,true);assert.equal(native.invitationId,null);assert.equal(native.version,null);await actor(ADMIN);assert.equal((await call('read')).nativeAccess,true);
  });
  await check('old recipient edits fail closed while v2 edit remains possible at its exact accepted grant',async()=>{
   await actor(RECIPIENT);loaded=await call('read');await deny(()=>legacyCall('update',{expected:loaded.revision,patch:{vehicleMemo:'legacy denied'}}));await deny(()=>call('update',{expected:loaded.revision,patch:{vehicleMemo:'missing binding'}}));
   const saved=await call('update',{expected:loaded.revision,patch:{vehicleMemo:'versioned allowed'},access:access(loaded)});assert.equal(saved.car.vehicleMemo,'versioned allowed');assert.equal(saved.revision,loaded.revision+1);assert.equal(saved.permission,'edit');assert.deepEqual(access(saved),access(loaded));
  });
  await check('read permission permits redacted vehicle/media views and prevents both edits and deletion',async()=>{
   const changed=await setPermission('read');assert.equal(changed.permission,'read');assert.equal(changed.state,'accepted');loaded=await current();assert.equal(loaded.canEdit,false);assert.equal(loaded.canDelete,false);assert.equal(loaded.version,changed.version);assert(Array.isArray(await call('media',{access:access(loaded)})));
   await deny(()=>call('update',{expected:loaded.revision,patch:{sell:1},access:access(loaded)}));await deny(()=>call('delete',{expected:loaded.revision,patch:{requestId:randomUUID()},access:access(loaded)}));
   const events=(await notes()).items;assert(events.some(n=>n.changes.some(c=>c.field==='sharePermission'&&c.after==='read')));
  });
  await check('delete permission remains readable but cannot edit; the permission owner can later grant all',async()=>{
   await setPermission('delete');loaded=await current();assert.equal(loaded.permission,'delete');assert.equal(loaded.canDelete,true);assert.equal(loaded.canEdit,false);await deny(()=>call('update',{expected:loaded.revision,patch:{sell:1},access:access(loaded)}));
   await setPermission('all');loaded=await current();assert.equal(loaded.canEdit,true);assert.equal(loaded.canDelete,true);await call('update',{expected:loaded.revision,patch:{sell:15000001},access:access(loaded)});
  });
  await check('a stale form cannot edit after a grant version changes even when edit remains allowed',async()=>{
   const old=await current();await setPermission('edit');loaded=await current();assert.equal(loaded.revision,old.revision);assert.notEqual(loaded.version,old.version);await deny(()=>call('update',{expected:old.revision,patch:{vehicleMemo:'stale'},access:access(old)}),['40001']);
   await call('update',{expected:loaded.revision,patch:{vehicleMemo:'fresh'},access:access(loaded)});
  });
  await check('only native owner/admin can change permissions, and stale or invalid grant bindings never mutate them',async()=>{
   loaded=await current();await deny(()=>call('permissions',{target:RECIPIENT,permission:'all',access:access(loaded)}));await deny(()=>call('grant',{email:UPLOADER+'@example.invalid',permission:'all'}));
   await actor(OWNER);const out=(await call('outgoing')).find(r=>r.id===RECIPIENT);for(const permission of ['',null,'owner','EDIT'])await deny(()=>call('permissions',{target:RECIPIENT,permission,access:access(out)}),['22023']);
   for(const bad of [{},{...access(out),extra:true},{invitationId:randomUUID(),version:out.version},{invitationId:out.invitationId,version:out.version+1}])await deny(()=>call('permissions',{target:RECIPIENT,permission:'all',access:bad}),['22023','40001']);
   assert.equal((await call('outgoing')).find(r=>r.id===RECIPIENT).permission,out.permission);
  });
  await check('new invitations default to read and expose permission in notification metadata without sharing private fields',async()=>{
   await actor(OWNER);await call('revoke',{target:RECIPIENT});invitation=await call('grant',{email:RECIPIENT+'@example.invalid'});assert.equal(invitation.permission,'read');assert.equal(invitation.state,'pending');assert.equal(invitation.version,1);assert.equal(invitation.apiVersion,2);
   await actor(RECIPIENT);assert.equal((await call('incoming')).some(r=>r.carId===ID),false);await deny(()=>call('read'));await deny(()=>call('media'));await deny(()=>call('update',{expected:1,patch:{sell:1},access:access(invitation)}));
   const n=(await notes()).items.find(n=>n.invitation?.id===invitation.invitationId);assert.equal(n.invitation.permission,'read');assert.equal(n.invitation.apiVersion,2);assert(!JSON.stringify(n).includes('DO_NOT_EXPOSE_CUSTOMER'));
  });
  await check('changing a pending permission invalidates the previous accept screen and preserves recipient consent',async()=>{
   await actor(OWNER);const changed=await call('permissions',{target:RECIPIENT,permission:'delete',access:access(invitation)});assert.equal(changed.state,'pending');assert.equal(changed.version,2);
   await actor(RECIPIENT);await deny(()=>reply(invitation.invitationId,invitation.version),['40001']);const n=(await notes()).items.find(n=>n.invitation?.id===invitation.invitationId);assert.equal(n.invitation.version,2);assert.equal(n.invitation.permission,'delete');await deny(()=>call('read'));
   const accepted=await reply(changed.invitationId,changed.version);assert.equal(accepted.permission,'delete');assert.equal(accepted.version,3);assert.equal(accepted.apiVersion,2);loaded=await call('read');assert.equal(loaded.canEdit,false);assert.equal(loaded.canDelete,true);
  });
  await check('revoke and reaccept cannot revive a previous form binding even if the owner dataset revision is unchanged',async()=>{
   const old=await current();await actor(OWNER);await call('revoke',{target:RECIPIENT});const fresh=await call('grant',{email:RECIPIENT+'@example.invalid',permission:'edit'});await actor(RECIPIENT);await reply(fresh.invitationId,fresh.version);loaded=await call('read');assert.notEqual(loaded.invitationId,old.invitationId);assert.equal(loaded.revision,old.revision);await deny(()=>call('update',{expected:old.revision,patch:{vehicleMemo:'old invitation'},access:access(old)}),['40001']);await deny(()=>legacyCall('update',{expected:old.revision,patch:{vehicleMemo:'old endpoint'}}));
  });
  await check('direct dataset/customer and private function/table access remain unavailable to the recipient',async()=>{
   await actor(RECIPIENT);assert.equal((await db.query('select count(*)::int as n from public.zc_datasets')).rows[0].n,0);assert.equal((await db.query('select count(*)::int as n from public.zc_customers')).rows[0].n,0);
   await deny(()=>db.query('select * from snote_private.vehicle_shares'));await deny(()=>db.query('select snote_private.vehicle_share_access($1,$2,$3)',[COMPANY,OWNER,ID]));await deny(()=>db.query('select snote_private.shared_vehicle_trash($1,$2,$3,$4,$5,$6,$7)',[COMPANY,OWNER,ID,loaded.revision,randomUUID(),loaded.invitationId,loaded.version]));
   await assert.rejects(()=>scalar('select public.zc_write_dataset($1,$2,$3,$4,$5) as value',[COMPANY,'cars',OWNER,loaded.revision,JSON.stringify([])]),error=>error.code==='P0001'&&error.message==='저장 권한이 없습니다');
  });
  await check('native admin privileges are revalidated after a company-lock wait',async()=>{
   await actor(OWNER);const granted=await call('grant',{email:ADMIN+'@example.invalid',permission:'read'});await actor(ADMIN);const accepted=await reply(granted.invitationId,granted.version);const before=await state();
   const original=(await privileged("select pg_get_functiondef('snote_private.recycle_lock(uuid)'::regprocedure) as body")).rows[0].body;
   await privileged(`create or replace function snote_private.recycle_lock(p_company uuid) returns void language plpgsql volatile set search_path='' as $$begin perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snote-recycle:'||p_company::text,0));if auth.uid()='${ADMIN}'::uuid then update public.zc_members set role='dealer' where user_id=auth.uid();end if;end$$`);
   try{await actor(ADMIN);await deny(()=>call('update',{expected:before.revision,patch:{vehicleMemo:'stale admin role'},access:access(accepted)}));await actor(ADMIN);await deny(()=>call('outgoing'));await actor(ADMIN);await deny(()=>call('grant',{email:UPLOADER+'@example.invalid',permission:'all'}));assert.deepEqual(await state(),before);}
   finally{await privileged(original);}
  });
  await check('native privileges are rechecked after row locking before the final mutation',async()=>{
   const original=(await privileged("select pg_get_functiondef('snote_private.share_vehicle_owner(uuid,text)'::regprocedure) as body")).rows[0].body;
   const temporary=original.replace('FUNCTION snote_private.share_vehicle_owner(', 'FUNCTION snote_private.test_original_share_vehicle_owner(');await privileged(temporary);
   await privileged(`create or replace function snote_private.share_vehicle_owner(p_company uuid,p_car text) returns uuid language plpgsql volatile set search_path='' as $$begin if auth.uid()='${ADMIN}'::uuid then update public.zc_members set role='dealer' where user_id=auth.uid();end if;return snote_private.test_original_share_vehicle_owner(p_company,p_car);end$$`);
   const before=await state();
   try{await actor(ADMIN);await deny(()=>call('outgoing'));await actor(ADMIN);await deny(()=>call('update',{expected:before.revision,patch:{vehicleMemo:'late native privilege'}}));assert.deepEqual(await state(),before);}
   finally{await privileged(original);await privileged('drop function snote_private.test_original_share_vehicle_owner(uuid,text)');}
  });
  await check('active company binding and account status still gate every share mode',async()=>{
   await privileged('update public.zc_members set active=false where user_id=$1',[RECIPIENT]);await actor(RECIPIENT);await deny(()=>call('read'));await privileged('update public.zc_members set active=true,company_id=$1 where user_id=$2',[COMPANY,RECIPIENT]);await actor(RECIPIENT);await deny(()=>call('read'));await privileged('update public.zc_members set company_id=$1 where user_id=$2',[FOREIGN,RECIPIENT]);await privileged("update auth.users set banned_until=now()+interval '1 day' where id=$1",[RECIPIENT]);await actor(RECIPIENT);await deny(()=>call('read'));await privileged('update auth.users set banned_until=null where id=$1',[RECIPIENT]);await actor(RECIPIENT,'authenticated',true);await deny(()=>call('read'));await actor(null,'anon');await deny(()=>call('incoming'));
  });
  await check('null and unknown actions fail without returning an implicit vehicle view',async()=>{await actor(OWNER);for(const action of [null,'','unknown'])await deny(()=>call(action),['22023']);});
  await check('migration reapplication preserves choices, invitations, versions, data and secure ACLs',async()=>{
   await actor(OWNER);const before=await call('outgoing'),row=await state();await db.exec(SQL());await actor(OWNER);assert.deepEqual(await call('outgoing'),before);assert.deepEqual(await state(),row);
   const defs=await privileged("select n.nspname schema,p.proname,p.prosecdef,p.proconfig,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='snote_vehicle_share_v2' or(n.nspname='snote_private' and p.proname in('vehicle_share_v2','vehicle_share_access','shared_vehicle_trash'))");
   assert.equal(defs.rows.find(r=>r.proname==='snote_vehicle_share_v2').prosecdef,false);assert.equal(defs.rows.find(r=>r.proname==='vehicle_share_v2').prosecdef,true);for(const r of defs.rows)assert(r.proconfig.some(x=>x.startsWith('search_path=')));for(const r of defs.rows.filter(r=>['vehicle_share_access','shared_vehicle_trash'].includes(r.proname)))assert(!r.acl.includes('authenticated=X'));
  });
  console.log(JSON.stringify({passed,failed}));if(failed)process.exitCode=1;
 }finally{await db.close();}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
module.exports={createPermissionFixture,FILE,SQL,...Object.fromEntries(Object.entries(baseline).filter(([key])=>key!=='createMemoFixture'))};
