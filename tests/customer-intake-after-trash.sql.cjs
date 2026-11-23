'use strict';
// Real PostgreSQL function, RLS and recycle paths in PGlite. Synthetic rows only;
// no operating database, customer data, network or SMS provider is accessed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createContextFixture}=require('./shared-contract-contexts.sql.cjs');
const {COMPANY,FOREIGN,OWNER,RECIPIENT,UPLOADER,ID}=require('./vehicle-share-permissions-db.cjs');
const {ACCOUNTANT}=require('./recycle-bin-db.cjs');
const FILE='20261123081303_customer_intake_after_customer_trash.sql',SQL=()=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',FILE),'utf8');
const ZERO='00000000-0000-0000-0000-000000000000',PHONE='01012345678',NEXT_PHONE='01056781234';
const CIPHER='smi1.'+'1'.repeat(24)+'.'+'a'.repeat(58),SIGNATURE={version:1,strokes:[[[.1,.2],[.7,.8]]]};
const CUSTOMER={name:'합성 새 접수 고객',phone:PHONE,addressBase:'합성시 시험로 1',addressDetail:'101호',mailingBase:'',mailingDetail:'',sameAddress:true,refundBank:'',refundAccount:'',refundHolder:'',refundConsent:false};
const RECEIPT={children:'two',business:'cash',privacyConsent:true,insuranceConfirmed:true,delegationConfirmed:true,cashConfirmed:true,consentVersion:'receipt-v1'};
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');let serial=0,passed=0;const evidence={baseline:[],protectedFunctionsUnchanged:false};
const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
async function harness(){
 const f=await createContextFixture(),{db,actor,scalar}=f;
 const raw=async(sql,args=[])=>{await db.exec('reset role');return(await db.query(sql,args)).rows;};
 const value=async(sql,args=[])=>{await db.exec('reset role');return scalar(sql,args);};
 const rpc=async(user,name,args={},role='authenticated',anonymous=false)=>{await actor(user,role,anonymous);const keys=Object.keys(args);return scalar('select public.'+name+'('+keys.map((k,i)=>k+' => $'+(i+1)).join(',')+') as value',keys.map(k=>args[k]!==null&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]));};
 const service=(name,args)=>rpc(null,name,args,'service_role');
 const create=async(car,user=OWNER,phone=PHONE)=>{const token=hash('synthetic-trash-link-'+(++serial));return{...await rpc(user,'snote_intake_create',{p_car_id:car,p_phone:phone,p_token_hash:token}),hash:token,phone};};
 const saved=async(car,user=OWNER,company=COMPANY)=>(await raw('select *,updated_at::text as expected from public.zc_customers where company_id=$1 and owner_id=$2 and car_id=$3',[company,user,car]))[0];
 const request=async link=>(await raw('select * from public.snote_customer_intake where id=$1',[link.id]))[0];
 const addCar=async car=>{const data=await f.state();data.payload.push({id:car,model:'합성 테스트 차량',status:'판매중',sell:1200});await raw("update public.zc_datasets set payload=$3 where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER,JSON.stringify(data.payload)]);};
 const verify=async link=>{assert.equal(link.ok,true,JSON.stringify(link));const challenge=crypto.randomUUID(),otp=hash('synthetic-otp-'+(++serial)),session=hash('synthetic-session-'+serial);for(const[name,args]of[
  ['snote_intake_challenge_v3',{p_token_hash:link.hash,p_challenge_id:challenge,p_otp_hash:otp,p_phone:link.phone}],
  ['snote_intake_delivery',{p_id:link.id,p_kind:'otp',p_challenge_id:challenge,p_status:'sent'}],
  ['snote_intake_verify',{p_token_hash:link.hash,p_challenge_id:challenge,p_otp_hash:otp,p_session_hash:session}]])assert.equal((await service(name,args)).ok,true,name);
  return{...link,session};};
 const submit=(link,name=CUSTOMER.name)=>service('snote_intake_submit_v4',{p_token_hash:link.hash,p_session_hash:link.session,p_customer:{...CUSTOMER,name,phone:link.phone},p_consent_version:'2026-11-01',p_identity_cipher:CIPHER,p_signature:SIGNATURE,p_receipt_details:RECEIPT});
 const trash=async(car,user=OWNER,company=COMPANY)=>{const row=await saved(car,user,company);assert(row);return rpc(user,'snote_recycle_trash_customer',{p_company:company,p_owner:user,p_car_id:car,p_expected_updated_at:row.expected,p_expected_generation:row.restore_generation,p_request_id:crypto.randomUUID()});};
 const restore=(entry,user=OWNER,company=COMPANY)=>rpc(user,'snote_recycle_restore',{p_company:company,p_entry:entry.id});
 const list=(car,user=OWNER)=>rpc(user,'snote_intake_list',{p_car_id:car});
 const view=link=>service('snote_intake_view_v3',{p_token_hash:link.hash});
 const details=(link,user=OWNER)=>rpc(user,'snote_intake_details_v3',{p_id:link.id});
 const save=(car,payload,{user=OWNER,company=COMPANY,generation=ZERO,updated=null}={})=>rpc(user,'snote_customer_save',{p_company:company,p_owner:user,p_car_id:car,p_expected_updated_at:updated,p_expected_generation:generation,p_payload:payload,p_has_rrn:false});
 const apply=async()=>{await db.exec('reset role');await db.exec(SQL());};
 return{...f,raw,value,rpc,service,create,saved,request,addCar,verify,submit,trash,restore,list,view,details,save,apply};
}
async function owned(){
 const h=await harness();const {db}=h;let legacyPending,legacyDone,legacyDeleted,legacyRestored,legacyPurged,deletedEntry,restoredEntry,purgedEntry,newLink,newCustomer,newEntry,pendingRestore;
 try{
  await check('baseline reproduces deletion-blocked resend while normal explicit resend works',async()=>{
   for(const car of['legacy-pending','legacy-done','legacy-deleted','legacy-restored','legacy-purged','restore-pending','new-transaction','post-migration-purge'])await h.addCar(car);
   legacyPending=await h.create('legacy-pending');const replacement=await h.create('legacy-pending');assert.equal(replacement.ok,true);assert((await h.request(legacyPending)).revoked_at);legacyPending=replacement;
   legacyDone=await h.verify(await h.create('legacy-done'));assert.equal((await h.submit(legacyDone)).canonicalApplied,true);
   legacyDeleted=await h.verify(await h.create('legacy-deleted'));assert.equal((await h.submit(legacyDeleted,'SYNTHETIC_OLD_DELETED_CUSTOMER')).ok,true);deletedEntry=await h.trash('legacy-deleted');assert(deletedEntry.ok);assert.equal((await h.create('legacy-deleted')).code,'FORBIDDEN');
   legacyRestored=await h.verify(await h.create('legacy-restored'));assert.equal((await h.submit(legacyRestored)).ok,true);restoredEntry=await h.trash('legacy-restored');assert.equal((await h.restore(restoredEntry)).ok,true);
   legacyPurged=await h.verify(await h.create('legacy-purged'));assert.equal((await h.submit(legacyPurged,'SYNTHETIC_PURGED_CUSTOMER')).ok,true);purgedEntry=await h.trash('legacy-purged');
   // Model an already-permanently-deleted legacy tombstone, without weakening
   // the ordinary public purge API or reading an operating recycle row.
   await h.raw('delete from snote_private.recycle_requests where entry_ids @> $1::jsonb',[JSON.stringify([purgedEntry.id])]);await h.raw('delete from snote_private.recycle_bin where id=$1',[purgedEntry.id]);
  });
  const protectedSql="select oid::regprocedure::text as name,md5(pg_get_functiondef(oid)) as md5,prosecdef,proconfig,proacl::text as acl from pg_proc where oid=any(array['snote_private.recycle_blocked(uuid,uuid,text)'::regprocedure,'snote_private.customer_save_owned_v2188(uuid,uuid,text,timestamptz,uuid,jsonb,boolean)'::regprocedure,'snote_private.recycle_customer_guard()'::regprocedure,'snote_intake_private.lock_actor_car(uuid,uuid,text,boolean)'::regprocedure,'snote_intake_private.lock_actor_car_owned_v2188(uuid,uuid,text,boolean)'::regprocedure]) order by oid";
  const protectedDefinitions=await h.raw(protectedSql);
  const baselineSignatures=['public.snote_intake_create(text,text,text)','public.snote_intake_list(text)','public.snote_intake_details_v3(uuid)','public.snote_intake_revoke(uuid)','public.snote_intake_submit_v3(text,text,jsonb,text,text,jsonb)','snote_intake_private.lock_actor_car_owned_v2188(uuid,uuid,text,boolean)','snote_intake_private.lock_actor_car(uuid,uuid,text,boolean)'];
  const productionMd5=['a10650f9724720c7a7332010414b583a','456704a290b1ebcddfaa0f379732202e','6570283919d195cbac265537250a560f','2964c61574f2472a8f1e0cf66c7ce1e9','145c52d87759aad1a53d67c9d71595b1','d71aa8387f13a710763ca9d89700ad19','f6696e21157fd2849c32292190357cbf'];
  for(const[index,signature]of baselineSignatures.entries()){const md5=await h.value('select md5(pg_get_functiondef($1::regprocedure)) as value',[signature]);assert.equal(md5,productionMd5[index]);evidence.baseline.push({signature,md5,productionMd5:productionMd5[index],matches:true});}
  await h.apply();
  await check('migration preserves existing pending/completed flows but never binds revoked or deleted legacy PII',async()=>{
   const pending=await h.request(legacyPending);assert.equal(pending.customer_was_missing,true);assert.equal(pending.customer_generation,ZERO);assert.equal((await h.view(legacyPending)).ok,true);
   assert((await h.list('legacy-done')).some(x=>x.id===legacyDone.id));assert.equal((await h.details(legacyDone)).ok,true);
   for(const[car,link]of[['legacy-deleted',legacyDeleted],['legacy-restored',legacyRestored],['legacy-purged',legacyPurged]]){assert.deepEqual(await h.list(car),[]);assert.equal((await h.view(link)).ok,false);assert.equal((await h.details(link)).ok,false);assert.equal((await h.request(link)).customer_generation,null);}
   const first=await h.verify(legacyPending);assert.equal((await h.submit(first)).canonicalApplied,true);
   const after=await h.raw(protectedSql);assert.deepEqual(after,protectedDefinitions);evidence.protectedFunctionsUnchanged=true;evidence.protectedFunctions=after;
  });
  const oldSnapshot=await h.raw('select * from snote_private.recycle_bin where id=$1',[deletedEntry.id]);
  await check('post-trash explicit create emits no placeholder and keeps ordinary save blocked',async()=>{
   newLink=await h.create('legacy-deleted',OWNER,NEXT_PHONE);assert.equal(newLink.ok,true);assert.equal(await h.saved('legacy-deleted'),undefined);
   const meta=await h.request(newLink);assert.equal(meta.customer_generation,newLink.id);assert.notEqual(meta.customer_generation,ZERO);assert.equal(meta.customer_was_missing,true);assert(meta.customer_deleted_at);
   assert.equal(await h.value('select snote_private.recycle_blocked($1,$2,$3) as value',[COMPANY,OWNER,'legacy-deleted']),true);
   await assert.rejects(()=>h.save('legacy-deleted',{name:'stale draft'}),e=>e.message.includes('CUSTOMER_IN_TRASH'));
   assert.equal((await h.view(newLink)).ok,true);assert.deepEqual((await h.list('legacy-deleted')).map(r=>r.id),[newLink.id]);
   assert.equal((await h.service('snote_intake_delivery',{p_id:legacyDeleted.id,p_kind:'link',p_challenge_id:null,p_status:'sent'})).ok,false);
   assert((await h.request(legacyDeleted)).revoked_at);
  });
  await check('only the new verified submission creates a nonzero-generation canonical with new signature/receipt',async()=>{
   newLink=await h.verify(newLink);const result=await h.submit(newLink,'SYNTHETIC_REPLACEMENT_CUSTOMER');assert.equal(result.ok,true);assert.equal(result.canonicalApplied,true);newCustomer=await h.saved('legacy-deleted');
   assert.equal(newCustomer.restore_generation,newLink.id);assert.equal(newCustomer.payload.intakeSource.requestId,newLink.id);assert.equal(newCustomer.payload.name,'SYNTHETIC_REPLACEMENT_CUSTOMER');assert.equal(newCustomer.payload.phone,NEXT_PHONE);assert.equal(newCustomer.payload.identityCipher,CIPHER);assert.deepEqual(newCustomer.payload.customerSignature,SIGNATURE);assert.deepEqual(newCustomer.payload.receiptDetails,RECEIPT);
   const rows=await h.list('legacy-deleted');assert.deepEqual(rows.map(x=>x.id),[newLink.id]);assert(!JSON.stringify(rows).includes('SYNTHETIC_OLD_DELETED_CUSTOMER'));assert(!JSON.stringify(rows).includes(PHONE));assert.equal((await h.details(legacyDeleted)).ok,false);assert.equal((await h.view(legacyDeleted)).ok,false);
   assert.deepEqual(await h.raw('select * from snote_private.recycle_bin where id=$1',[deletedEntry.id]),oldSnapshot);assert.equal((await h.submit(newLink)).alreadySubmitted,true);
  });
  await check('normal repeat requests retain the current generation and explicit cancellation works',async()=>{
   const second=await h.create('legacy-deleted',OWNER,NEXT_PHONE),third=await h.create('legacy-deleted',OWNER,NEXT_PHONE);assert(second.ok&&third.ok);assert((await h.request(second)).revoked_at);assert.equal((await h.request(third)).customer_generation,newCustomer.restore_generation);
   assert.equal((await h.rpc(OWNER,'snote_intake_revoke',{p_id:third.id})).ok,true);assert.equal((await h.rpc(OWNER,'snote_intake_revoke',{p_id:third.id})).ok,true);assert.equal((await h.view(third)).code,'REVOKED');assert.equal((await h.details(newLink)).ok,true);assert(!(await h.list('legacy-deleted')).some(r=>r.id===second.id||r.id===third.id));
  });
  await check('old forms and direct DML cannot overwrite the replacement customer',async()=>{
   await assert.rejects(()=>h.save('legacy-deleted',{name:'stale zero'},{generation:ZERO,updated:newCustomer.expected}),e=>e.code==='40001');
   await h.actor(OWNER);await assert.rejects(()=>db.query('update public.zc_customers set payload=$2 where company_id=$1 and car_id=$3',[COMPANY,JSON.stringify({name:'raw stale'}),'legacy-deleted']),e=>e.code==='42501');
   const result=await h.save('legacy-deleted',{...newCustomer.payload,name:'SYNTHETIC_CURRENT_EDIT'},{generation:newCustomer.restore_generation,updated:newCustomer.expected});assert.equal(result.ok,true);assert.equal(result.restoreGeneration,newCustomer.restore_generation);
  });
  await check('second deletion and recreation invalidate every prior generation including details and service submit',async()=>{
   newEntry=await h.trash('legacy-deleted');assert.equal(newEntry.ok,true);assert.deepEqual(await h.list('legacy-deleted'),[]);const fresh=await h.verify(await h.create('legacy-deleted',OWNER,NEXT_PHONE));assert.notEqual(fresh.id,newLink.id);assert.equal((await h.submit(fresh,'SYNTHETIC_THIRD_CUSTOMER')).canonicalApplied,true);assert.equal((await h.saved('legacy-deleted')).restore_generation,fresh.id);assert.equal((await h.details(newLink)).ok,false);assert.equal((await h.view(newLink)).ok,false);assert.equal((await h.submit(newLink)).ok,false);assert.deepEqual((await h.list('legacy-deleted')).map(r=>r.id),[fresh.id]);
  });
  await check('explicit restore while a new link is pending invalidates that link without overwriting restored PII',async()=>{
   const old=await h.verify(await h.create('restore-pending'));assert.equal((await h.submit(old,'SYNTHETIC_RESTORE_SOURCE')).ok,true);const entry=await h.trash('restore-pending');pendingRestore=await h.verify(await h.create('restore-pending',OWNER,NEXT_PHONE));assert.equal((await h.view(pendingRestore)).ok,true);
   assert.equal((await h.restore(entry)).ok,true);const restored=await h.saved('restore-pending');assert.equal(restored.payload.name,'SYNTHETIC_RESTORE_SOURCE');assert.notEqual(restored.restore_generation,pendingRestore.id);assert.equal((await h.view(pendingRestore)).ok,false);assert.equal((await h.submit(pendingRestore)).ok,false);assert.deepEqual(await h.list('restore-pending'),[]);
   const after=await h.verify(await h.create('restore-pending',OWNER,NEXT_PHONE));assert.equal((await h.submit(after)).canonicalApplied,false);assert.deepEqual(await h.saved('restore-pending'),restored);assert.equal((await h.details(after)).ok,true);
  });
  await check('new request validity uses captured generation/cutoff rather than transaction-start timestamps',async()=>{
   await h.raw('begin');const link=await h.create('new-transaction');assert.equal(link.ok,true);await h.raw("update public.snote_customer_intake set created_at=created_at-interval '1 hour',expires_at=expires_at-interval '1 hour' where id=$1",[link.id]);assert.equal((await h.view(link)).ok,true);await h.raw('rollback');
   const replacement=await h.create('legacy-deleted',OWNER,NEXT_PHONE);assert(replacement.ok);const row=await h.request(replacement);await h.raw("update public.snote_customer_intake set created_at=customer_deleted_at-interval '1 minute',expires_at=customer_deleted_at+interval '1 hour' where id=$1",[replacement.id]);assert.equal((await h.view(replacement)).ok,true);assert.equal((await h.request(replacement)).customer_deleted_at.toISOString(),row.customer_deleted_at.toISOString());
  });
  await check('migration is repeatable, rejects direct metadata access and adds no public definer APIs',async()=>{
   const old=await h.verify(await h.create('post-migration-purge'));assert.equal((await h.submit(old)).ok,true);const entry=await h.trash('post-migration-purge'),pending=await h.create('post-migration-purge');assert.equal((await h.view(pending)).ok,true);await h.raw('delete from snote_private.recycle_bin where id=$1',[entry.id]);assert.deepEqual(await h.list('post-migration-purge'),[]);assert.equal((await h.view(old)).ok,false);assert.equal((await h.view(pending)).ok,false);assert.equal((await h.details(old)).ok,false);assert.equal(await h.saved('post-migration-purge'),undefined);
   const before=await h.saved('legacy-deleted');await h.apply();assert.deepEqual(await h.saved('legacy-deleted'),before);
   for(const role of['anon','authenticated','service_role'])for(const sig of['snote_intake_private.customer_deleted_at(uuid,uuid,text)','snote_intake_private.bind_customer_generation(uuid)','snote_intake_private.customer_generation_valid(public.snote_customer_intake)','snote_intake_private.lock_actor_car_restart_v2198(uuid,uuid,text,boolean)','snote_intake_private.lock_actor_car_owned_restart_v2198(uuid,uuid,text,boolean)'])assert.equal(await h.value('select has_function_privilege($1,$2,$3) as value',[role,sig,'EXECUTE']),false);
   assert.equal(await h.value("select count(*)::int as value from pg_proc where pronamespace='snote_intake_private'::regnamespace and proname in('customer_deleted_at','bind_customer_generation','customer_generation_valid') and prosecdef"),0);
   await h.actor(OWNER);await assert.rejects(()=>db.query('update public.snote_customer_intake set customer_generation=$1',[ZERO]),e=>e.code==='42501');
   assert.equal(await h.value("select position('pg_advisory_xact_lock' in pg_get_functiondef('snote_intake_private.lock_actor_car_owned_restart_v2198(uuid,uuid,text,boolean)'::regprocedure)) as value"),0);
  });
 }finally{await db.close();}
}
async function shared(){
 const h=await harness(),{db}=h;let context,sourceBaseline,old,entry,fresh;
 const access=row=>({invitationId:row.invitationId,version:row.version});
 const permission=async next=>{await h.actor(OWNER);const row=(await h.call('outgoing')).find(r=>r.id===RECIPIENT);return h.call('permissions',{target:RECIPIENT,permission:next,access:access(row)});};
 try{
  await h.apply();sourceBaseline=await h.saved(ID);await h.actor(OWNER);const invitation=await h.call('grant',{email:RECIPIENT+'@example.invalid',permission:'edit'});await h.actor(RECIPIENT);const accepted=await h.reply(invitation.invitationId,invitation.version);context=await h.rpc(RECIPIENT,'snote_shared_contract_bind',{p_company:COMPANY,p_owner:OWNER,p_car:ID,p_access:access(accepted)});
  await check('accepted shared edit contract restarts only recipient customer while source inventory/customer stay unchanged',async()=>{
   old=await h.verify(await h.create(context.carId,RECIPIENT));assert.equal((await h.submit(old,'SYNTHETIC_OLD_SHARED_CUSTOMER')).canonicalApplied,true);entry=await h.trash(context.carId,RECIPIENT,FOREIGN);assert.equal(entry.ok,true);fresh=await h.verify(await h.create(context.carId,RECIPIENT,NEXT_PHONE));assert.equal(await h.saved(context.carId,RECIPIENT,FOREIGN),undefined);assert.equal((await h.submit(fresh,'SYNTHETIC_NEW_SHARED_CUSTOMER')).canonicalApplied,true);const row=await h.saved(context.carId,RECIPIENT,FOREIGN);assert.equal(row.restore_generation,fresh.id);assert.equal(row.payload.name,'SYNTHETIC_NEW_SHARED_CUSTOMER');assert.deepEqual(await h.saved(ID),sourceBaseline);assert.deepEqual((await h.list(context.carId,RECIPIENT)).map(r=>r.id),[fresh.id]);assert.equal((await h.details(old,RECIPIENT)).ok,false);
  });
  await check('shared pending restart is invalid after explicit restore or accepted permission downgrade',async()=>{
   const removed=await h.trash(context.carId,RECIPIENT,FOREIGN),pending=await h.verify(await h.create(context.carId,RECIPIENT,NEXT_PHONE));assert.equal((await h.restore(removed,RECIPIENT,FOREIGN)).ok,true);assert.equal((await h.submit(pending)).ok,false);assert.equal((await h.view(pending)).ok,false);
   const current=await h.create(context.carId,RECIPIENT,NEXT_PHONE);assert(current.ok);await permission('read');assert.equal((await h.view(current)).ok,false);assert.equal((await h.create(context.carId,RECIPIENT,NEXT_PHONE)).code,'FORBIDDEN');assert.equal((await h.list(context.carId,RECIPIENT)).ok,false);assert.equal((await h.rpc(RECIPIENT,'snote_intake_revoke',{p_id:current.id})).ok,false);
  });
  await check('non-owner, other company, anonymous JWT, accountant and service role cannot issue/rebind requests',async()=>{
   for(const actor of[UPLOADER,ACCOUNTANT])assert.equal((await h.create(ID,actor)).ok,false);
   assert.equal((await h.rpc(OWNER,'snote_intake_create',{p_car_id:ID,p_phone:PHONE,p_token_hash:hash('anonymous')},'authenticated',true)).ok,false);
   await assert.rejects(()=>h.rpc(null,'snote_intake_create',{p_car_id:ID,p_phone:PHONE,p_token_hash:hash('service-create')},'service_role'),e=>e.code==='42501');
   assert.equal((await h.details(fresh,OWNER)).ok,false);assert.deepEqual(await h.saved(ID),sourceBaseline);
  });
  await check('vehicle tombstones apply to all customer owners and vehicle removal remains forbidden',async()=>{
   const car='synthetic-foreign-vehicle-trash';await h.addCar(car);const link=await h.create(car);assert(link.ok);const meta=await h.request(link);
   await h.raw("insert into snote_private.recycle_bin(company_id,owner_id,car_id,kind,source_id,snapshot,deleted_by,request_id,request_hash) values($1,$2,$3,'vehicle','synthetic','{}',$4,$5,'synthetic')",[COMPANY,UPLOADER,car,OWNER,crypto.randomUUID()]);
   assert.equal((await h.view(link)).ok,false);assert.deepEqual(await h.list(car),[]);assert.notEqual(await h.value('select snote_intake_private.customer_deleted_at($1,$2,$3) as value',[COMPANY,OWNER,car]),meta.customer_deleted_at);
   const data=await h.state(),covers=await h.value("select coalesce((select revision from public.zc_datasets where company_id=$1 and owner_id=$2 and dataset='covers'),0) as value",[COMPANY,OWNER]);const removed=await h.rpc(OWNER,'snote_recycle_trash_vehicle',{p_company:COMPANY,p_owner:OWNER,p_car_id:car,p_expected:data.revision,p_expected_covers:covers,p_request_id:crypto.randomUUID()});assert.equal(removed.ok,true);assert.equal((await h.create(car)).code,'FORBIDDEN');assert.equal((await h.view(link)).ok,false);
  });
 }finally{await db.close();}
}
async function run(){await owned();await shared();const receipt={suite:'customer-intake-after-trash',syntheticOnly:true,passed,...evidence,migrationSha256:hash(SQL())};if(process.env.SNOTE_INTAKE_SQL_RECEIPT)fs.writeFileSync(process.env.SNOTE_INTAKE_SQL_RECEIPT,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({suite:receipt.suite,syntheticOnly:true,passed}));return receipt;}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run,harness,FILE,SQL};
