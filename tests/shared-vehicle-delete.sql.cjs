'use strict';
// Real PostgreSQL/RLS functions; isolated synthetic data only. No production connection or messages.
// NODE_PATH=/workspace/work/deps/node_modules node tests/shared-vehicle-delete.sql.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createMemoFixture,COMPANY,FOREIGN,OWNER,RECIPIENT,UPLOADER,ADMIN,ID}=require('./vehicle-memo-sharing.sql.cjs');
const ROOT=path.join(__dirname,'..'),MIGRATION='supabase/migrations/20261109020649_vehicle_share_permissions.sql';
function helperSQL(){const source=fs.readFileSync(process.env.SHARE_DELETE_SQL||path.join(ROOT,MIGRATION),'utf8'),start=source.indexOf('create or replace function snote_private.shared_vehicle_trash('),end=source.indexOf('revoke all on function snote_private.shared_vehicle_trash(',start);assert(start>=0&&end>start,'The actual permission migration must include the shared trash helper');return source.slice(start,source.indexOf(';',end)+1);}
async function createDeleteFixture(){
 const f=await createMemoFixture(),{db,actor}=f;
 await db.exec("alter table snote_private.vehicle_shares add column if not exists permission text not null default 'edit' check(permission in('read','edit','delete','all'));");
 await db.exec(helperSQL());
 // Test-only public adapter executes the same private helper as the real versioned dispatcher.
 await db.exec(`create function public.test_shared_vehicle_trash(p_company uuid,p_owner uuid,p_car text,p_expected integer,p_request uuid,p_invitation uuid,p_version integer)
 returns jsonb language sql security definer set search_path='' as $$select snote_private.shared_vehicle_trash(p_company,p_owner,p_car,p_expected,p_request,p_invitation,p_version)$$;
 revoke all on function public.test_shared_vehicle_trash(uuid,uuid,text,integer,uuid,uuid,integer) from public,anon;
 grant execute on function public.test_shared_vehicle_trash(uuid,uuid,text,integer,uuid,uuid,integer) to authenticated;`);
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
 const media=[{company_id:COMPANY,owner_id:OWNER,id:'shared-delete-photo',car_id:ID,file_path:COMPANY+'/'+OWNER+'/'+ID+'/shared-delete-photo.png',original_name:'photo.png',mime_type:'image/png',file_size:123,group_name:'photos'},{company_id:COMPANY,owner_id:UPLOADER,id:'shared-delete-registration',car_id:ID,file_path:COMPANY+'/'+UPLOADER+'/'+ID+'/shared-delete-registration.png',original_name:'registration.png',mime_type:'image/png',file_size:123,group_name:'registration'}];
 await db.query("insert into public.zc_datasets(company_id,owner_id,dataset,payload,revision,updated_by) values($1,$2,'covers',$3,1,$2)",[COMPANY,OWNER,JSON.stringify({[ID]:media[0].id,sibling:'KEEP_COVER'})]);
 for(const owner of [OWNER,UPLOADER]){
  await db.query("insert into public.zc_customers(company_id,owner_id,car_id,payload,has_rrn,updated_by) values($1,$2,$3,$4,true,$2)",[COMPANY,owner,ID,JSON.stringify({name:'CUSTOMER_SECRET_'+owner,address:'PRIVATE_ADDRESS',customerSignature:{secret:'SIGNATURE_SECRET'}})]);
  await db.query("insert into zc_private.rrn_secrets(company_id,owner_id,car_id,cipher,expires_at) values($1,$2,$3,decode('aabbccdd','hex'),now()+interval '1 day')",[COMPANY,owner,ID]);
 }
 for(const m of media){await db.query("insert into public.zc_media(company_id,owner_id,id,car_id,file_path,original_name,mime_type,file_size,group_name) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",[m.company_id,m.owner_id,m.id,m.car_id,m.file_path,m.original_name,m.mime_type,m.file_size,m.group_name]);await db.query("insert into storage.objects(bucket_id,name) values('zc-vehicle-private',$1)",[m.file_path]);}
 await db.query("insert into public.snote_customer_intake(id,company_id,owner_id,car_id,car_snapshot,company_name,phone,token_hash,expires_at) values($1,$2,$3,$4,$5,'Synthetic company','01000000000',$6,now()+interval '30 minutes')",[randomUUID(),COMPANY,OWNER,ID,JSON.stringify({model:'Synthetic car',plate:'TEST'}),'d'.repeat(64)]);
 const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.value;
 const raw=async(sql,args=[])=>{await db.exec('reset role');return db.query(sql,args);};
 const trash=(options={})=>scalar('select public.test_shared_vehicle_trash($1,$2,$3,$4,$5,$6,$7) as value',[options.company??COMPANY,options.owner??OWNER,options.car??ID,options.expected??1,options.request??randomUUID(),options.invitation??null,options.version??null]);
 return{...f,scalar,raw,trash,media};
}
async function run(){
 const f=await createDeleteFixture(),{db,actor,call,reply,scalar,raw,trash}=f;let passed=0,failed=0,invite,accepted,access,request;
 const test=async(name,fn)=>{try{await fn();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name,error.stack);}};
 const deny=async(fn,codes=['42501'])=>assert.rejects(fn,error=>codes.includes(error.code));
 const setPermission=async(permission,version)=>{await raw('update snote_private.vehicle_shares set permission=$1'+(version?',version=$2':'')+' where company_id=$'+(version?'3':'2')+' and car_id=$'+(version?'4':'3'),version?[permission,version,COMPANY,ID]:[permission,COMPANY,ID]);};
 const exactAck=(ack,alreadyProcessed=false)=>{assert.deepEqual(Object.keys(ack).sort(),['alreadyProcessed','carId','deleted','ok','requestId']);assert.equal(ack.ok,true);assert.equal(ack.deleted,true);assert.equal(ack.carId,ID);assert.equal(ack.alreadyProcessed,alreadyProcessed);assert.equal(ack.requestId,request);assert(!JSON.stringify(ack).includes('CUSTOMER_SECRET'));assert(!JSON.stringify(ack).includes('UNRELATED'));};
 try{
  await actor(OWNER);invite=await call('grant',{email:RECIPIENT+'@example.invalid'});access={invitation:invite.invitationId,version:invite.version};
  await test('private helper is not directly executable by any authenticated recipient',async()=>{await actor(RECIPIENT);await deny(()=>scalar('select snote_private.shared_vehicle_trash($1,$2,$3,1,$4,$5,$6) as value',[COMPANY,OWNER,ID,randomUUID(),access.invitation,access.version]));});
  await test('pending invitations cannot delete; reading and editing permissions cannot delete after acceptance',async()=>{
   await actor(RECIPIENT);await deny(()=>trash(access));accepted=await reply(access.invitation,access.version);access.version=accepted.version;
   for(const permission of ['read','edit']){await setPermission(permission);await actor(RECIPIENT);await deny(()=>trash(access));}
   const row=(await raw("select payload,revision from zc_datasets where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER])).rows[0];assert.equal(row.revision,1);assert.equal(row.payload.length,2);
  });
  await test('missing, wrong or stale share generations never authorize deletion',async()=>{
   await setPermission('delete');await actor(RECIPIENT);await deny(()=>trash());await deny(()=>trash({...access,invitation:randomUUID()}),['40001']);await deny(()=>trash({...access,version:access.version-1}),['40001']);
   await setPermission('delete',access.version+1);await actor(RECIPIENT);await deny(()=>trash(access),['40001']);access.version++;
  });
  await test('wrong actor, changed company, banned and anonymous recipients cannot use a delete grant',async()=>{
   await actor(UPLOADER);await deny(()=>trash(access));
   await raw('update zc_members set company_id=$1 where user_id=$2',[COMPANY,RECIPIENT]);await actor(RECIPIENT);await deny(()=>trash(access));await raw('update zc_members set company_id=$1 where user_id=$2',[FOREIGN,RECIPIENT]);
   await raw("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[RECIPIENT]);await actor(RECIPIENT);await deny(()=>trash(access));await raw('update auth.users set banned_until=null where id=$1',[RECIPIENT]);
   await actor(RECIPIENT,'authenticated',true);await deny(()=>trash(access));
  });
  await test('stale car revision and revoked grants fail before archiving or modifying any vehicle',async()=>{
   await actor(RECIPIENT);await deny(()=>trash({...access,expected:2}),['40001']);
   await raw("update snote_private.vehicle_shares set state='rejected' where company_id=$1 and car_id=$2",[COMPANY,ID]);await actor(RECIPIENT);await deny(()=>trash(access));await raw("update snote_private.vehicle_shares set state='accepted' where company_id=$1 and car_id=$2",[COMPANY,ID]);
   assert.equal((await raw('select count(*)::int n from snote_private.recycle_bin')).rows[0].n,0);
  });
  await test('delete grant archives every linked record atomically, preserves files and unrelated data, and returns only a small ACK',async()=>{
   request=randomUUID();await actor(RECIPIENT);exactAck(await trash({...access,request}));
   const row=(await raw("select payload,revision from zc_datasets where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER])).rows[0];assert.equal(row.revision,2);assert.deepEqual(row.payload,[f.sibling]);
   const archive=(await raw('select * from snote_private.recycle_bin where company_id=$1 and car_id=$2',[COMPANY,ID])).rows[0];assert.equal(archive.owner_id,OWNER);assert.equal(archive.deleted_by,RECIPIENT);assert.deepEqual(archive.snapshot.car,f.car);assert.equal(archive.snapshot.customers.length,2);assert.equal(archive.snapshot.rrn.length,2);assert.equal(archive.snapshot.media.length,2);
   for(const table of ['public.zc_customers','zc_private.rrn_secrets','public.zc_media'])assert.equal((await raw('select count(*)::int n from '+table+' where company_id=$1 and car_id=$2',[COMPANY,ID])).rows[0].n,0);
   assert.equal((await raw('select count(*)::int n from snote_private.vehicle_shares where company_id=$1 and car_id=$2',[COMPANY,ID])).rows[0].n,0);assert.equal((await raw('select count(*)::int n from storage.objects')).rows[0].n,f.media.length);
   assert((await raw('select revoked_at from public.snote_customer_intake where company_id=$1 and car_id=$2',[COMPANY,ID])).rows.every(x=>x.revoked_at));
   assert.deepEqual((await raw("select payload from zc_datasets where company_id=$1 and owner_id=$2 and dataset='covers'",[COMPANY,OWNER])).rows[0].payload,{sibling:'KEEP_COVER'});
  });
  await test('lost-response replay remains scoped and redacted after the share has been removed',async()=>{
   await actor(RECIPIENT);exactAck(await trash({...access,request}),true);await deny(()=>trash({...access,request,car:'memo-sibling'}),['22023']);await deny(()=>trash({...access,request,expected:2}),['22023']);
   await actor(UPLOADER);await deny(()=>trash({...access,request}));assert.equal((await raw('select count(*)::int n from snote_private.recycle_bin')).rows[0].n,1);
  });
  await test('recipient cannot list, read or restore owner recycle/private data, while owner restore is recoverable and grants do not revive',async()=>{
   const entry=(await raw('select id from snote_private.recycle_bin where company_id=$1 and car_id=$2',[COMPANY,ID])).rows[0].id;
   await actor(RECIPIENT);await deny(()=>scalar('select public.snote_recycle_list($1) as value',[COMPANY]));await deny(()=>scalar('select public.snote_recycle_restore($1,$2) as value',[COMPANY,entry]));await deny(()=>db.query('select snapshot from snote_private.recycle_bin'));await deny(()=>db.query('select * from zc_private.rrn_secrets'));
   await actor(OWNER);const restored=await scalar('select public.snote_recycle_restore($1,$2) as value',[COMPANY,entry]);assert.equal(restored.ok,true);const row=(await raw("select payload from zc_datasets where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER])).rows[0];assert(row.payload.some(x=>x.id===ID));assert.equal((await raw('select count(*)::int n from snote_private.vehicle_shares')).rows[0].n,0);
   await actor(RECIPIENT);await deny(()=>trash({...access,request}),['40001']);await deny(()=>trash({...access,request:randomUUID(),expected:3}));await deny(()=>call('read'));
  });
  await test('a new all-permission grant can delete restored data but a reused old request cannot target the new grant',async()=>{
   await actor(OWNER);const again=await call('grant',{email:RECIPIENT+'@example.invalid'});await actor(RECIPIENT);const consent=await reply(again.invitationId,again.version);const fresh={invitation:again.invitationId,version:consent.version,expected:3};await setPermission('all');await actor(RECIPIENT);await deny(()=>trash({...fresh,request}),['22023']);request=randomUUID();exactAck(await trash({...fresh,request}));
  });
  await test('native company admin management remains independent from recipient sharing',async()=>{
   const entry=(await raw('select id from snote_private.recycle_bin where company_id=$1 and car_id=$2 and restored_at is null',[COMPANY,ID])).rows[0].id;await actor(ADMIN);await scalar('select public.snote_recycle_restore($1,$2) as value',[COMPANY,entry]);const current=(await raw("select revision from zc_datasets where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER])).rows[0].revision;await actor(ADMIN);request=randomUUID();exactAck(await trash({expected:current,request}));
  });
  if(failed)throw Error(failed+' shared vehicle delete cases failed');console.log('PASS '+passed+' shared vehicle delete PostgreSQL/RLS cases');
 }finally{await db.close();}
}
module.exports={createDeleteFixture,helperSQL};
if(require.main===module)run().catch(error=>{console.error(error.stack);process.exitCode=1;});
