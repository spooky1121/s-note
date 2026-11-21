'use strict';
// PostgreSQL function/RLS regression tests. All users and vehicle payloads are synthetic.
// NODE_PATH=/workspace/work/deps/node_modules node tests/shared-vehicle-detail-compat.sql.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createPermissionFixture,COMPANY,OWNER,RECIPIENT,UPLOADER,ADMIN,ID}=require('./vehicle-share-permissions-db.cjs');
const FILE='20261121023339_shared_vehicle_detail_compat.sql';
const SQL=fs.readFileSync(path.join(__dirname,'../supabase/migrations',FILE),'utf8');
const binding=value=>({invitationId:value.invitationId,version:value.version});

async function run(){
 const f=await createPermissionFixture(),{db,actor,scalar,call,state,reply}=f;
 let passed=0,failed=0;
 const test=async(name,fn)=>{try{await fn();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name,error);}};
 const deny=(fn,codes=['42501'])=>assert.rejects(fn,error=>codes.includes(error.code));
 const privileged=async(sql,args=[])=>{await db.exec('reset role');return db.query(sql,args);};
 const metadata=async()=>{await db.exec('reset role');return(await db.query("select n.nspname schema,p.proname,p.prosecdef,p.proconfig,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='snote_private' and p.proname='vehicle_share_v2') or(n.nspname='public' and p.proname='snote_vehicle_share_v2') order by n.nspname,p.proname")).rows;};
 const counts=async()=>{await db.exec('reset role');return(await db.query("select (select count(*)::int from public.zc_audit where entity='vehicle_share' and action='edit') edits,(select count(*)::int from snote_private.vehicle_notifications where event_type='changed') notices")).rows[0];};
 const rawCar=changes=>({...structuredClone(f.car),...changes});
 async function seed(car){await privileged("update public.zc_datasets set payload=$3::jsonb,revision=revision+1 where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER,JSON.stringify([car,structuredClone(f.sibling)])]);}
 async function recipientRead(){await actor(RECIPIENT);return call('read');}
 async function permission(mode){await actor(OWNER);const row=(await call('outgoing')).find(x=>x.id===RECIPIENT);return call('permissions',{target:RECIPIENT,permission:mode,access:binding(row)});}
 async function edit(patch,loaded){loaded??=await recipientRead();await actor(RECIPIENT);return call('update',{expected:loaded.revision,patch,access:binding(loaded)});}
 try{
  await test('migration preserves records, existing function ACLs, security mode and search_path',async()=>{
   const before=await state(),access=await metadata(),count=await counts();await db.exec(SQL);
   assert.deepEqual(await state(),before);assert.deepEqual(await metadata(),access);assert.deepEqual(await counts(),count);
   const privateFn=access.find(x=>x.schema==='snote_private'),publicFn=access.find(x=>x.schema==='public');
   assert.equal(privateFn.prosecdef,true);assert.equal(publicFn.prosecdef,false);
   assert(privateFn.acl.includes('authenticated=X'));assert(!privateFn.acl.includes('anon=X'));
   assert(privateFn.proconfig.some(x=>x.startsWith('search_path=')));
   await actor(OWNER);const grant=await call('grant',{email:RECIPIENT+'@example.invalid',permission:'edit'});
   await actor(RECIPIENT);await deny(()=>call('read'));await reply(grant.invitationId,grant.version);
  });
  await test('km-only owner records expose bounded basic labels and canonical aliases without a database rewrite',async()=>{
   const source=rawCar({km:'43,200',group:'승용',generation:'3세대',grade:'롱레인지',subgrade:'AWD',extra:'차량 옵션 안내',inventoryStartedAt:'2026-11-01',inventoryInterestSnapshot:{annualRate:4.5,privateTag:'OWNER_SNAPSHOT'}});delete source.mileage;
   await seed(source);const before=await state(),count=await counts(),loaded=await recipientRead();
   for(const key of ['group','generation','grade','subgrade','extra'])assert.equal(loaded.car[key],source[key]);
   assert.equal(loaded.car.km,43200);assert.equal(loaded.car.mileage,43200);assert.equal(loaded.canEdit,true);
   for(const key of ['ownerId','secretCustomer','incomeSettlement','inventoryStartedAt','inventoryInterestSnapshot'])assert(!Object.hasOwn(loaded.car,key),key);
   assert(!JSON.stringify(loaded).includes('DO_NOT_EXPOSE_CUSTOMER'));assert(!JSON.stringify(loaded).includes('OWNER_SNAPSHOT'));
   assert.deepEqual(await state(),before);assert.deepEqual(await counts(),count);
  });
  await test('canonical mileage prefers valid km including zero, and falls back to legacy mileage for empty or malformed km',async()=>{
   const cases=[
    [{km:0,mileage:999},0], [{km:'0',mileage:999},0], [{km:23456,mileage:999},23456],
    [{km:' 12,345 ',mileage:999},12345], [{km:'',mileage:5678},5678], [{km:'   ',mileage:'5,678'},5678],
    [{km:null,mileage:5678},5678], [{km:'12,34',mileage:5678},5678], [{km:'123 km',mileage:5678},5678],
    [{km:-1,mileage:5678},5678], [{km:1.5,mileage:5678},5678], [{km:{private:123},mileage:5678},5678],
    [{km:900000000001,mileage:5678},5678], [{km:'9'.repeat(40),mileage:5678},5678],
    [{mileage:12345},12345], [{mileage:'12,345'},12345], [{km:900000000000,mileage:1},900000000000]
   ];
   for(const [fields,expected]of cases){await seed(rawCar(fields));const before=await state(),loaded=await recipientRead();assert.equal(loaded.car.km,expected,JSON.stringify(fields));assert.equal(loaded.car.mileage,expected);assert.deepEqual(await state(),before);}
   await seed(rawCar({km:'',mileage:{secret:true}}));const invalid=await recipientRead();assert(!Object.hasOwn(invalid.car,'km'));assert(!Object.hasOwn(invalid.car,'mileage'));
  });
  await test('new basic labels never expose structured, null, numeric or oversized owner metadata',async()=>{
   await seed(rawCar({group:{secret:'DO_NOT_EXPOSE_GROUP'},generation:['DO_NOT_EXPOSE_GENERATION'],grade:100,subgrade:null,extra:'x'.repeat(201)}));
   const loaded=await recipientRead();for(const key of ['group','generation','grade','subgrade','extra'])assert(!Object.hasOwn(loaded.car,key));assert(!JSON.stringify(loaded).includes('DO_NOT_EXPOSE_GROUP'));
   await seed(rawCar({group:'x'.repeat(200),generation:'',grade:'품목',subgrade:'옵션',extra:'일반 차량 옵션'}));const good=await recipientRead();assert.equal(good.car.group.length,200);assert.equal(good.car.generation,'');
  });
  await test('custom owner costs and labels are readable in original integer-KRW units across both vehicle money modes',async()=>{
   const customCosts={'custom-11111111-1111-4111-8111-111111111111':123456},customCostLabels={'custom-11111111-1111-4111-8111-111111111111':'차량 운송비'};
   for(const moneyUnit of ['KRW',undefined]){const source=rawCar({customCosts,customCostLabels});if(!moneyUnit)delete source.moneyUnit;await seed(source);const before=await state(),loaded=await recipientRead();assert.deepEqual(loaded.car.customCosts,customCosts);assert.deepEqual(loaded.car.customCostLabels,customCostLabels);assert.deepEqual(await state(),before);await edit({vehicleMemo:'사용자 비용 보존'},loaded);const after=await state();assert.deepEqual(after.payload,[{...source,vehicleMemo:'사용자 비용 보존'},f.sibling]);}
  });
  await test('accepted mileage edit synchronizes km/mileage once while preserving every unrelated owner value and car',async()=>{
   const source=rawCar({km:'43,200',mileage:12345,group:'승용',generation:'3세대',extra:'차량 옵션',inventoryLoan:7000000,inventoryLender:'소유자 금융사',inventoryStartedAt:'2026-11-01',inventoryInterestSnapshot:{version:1,annualRate:4.5,amountWon:8765},customCosts:{'custom-11111111-1111-4111-8111-111111111111':98765},customCostLabels:{'custom-11111111-1111-4111-8111-111111111111':'차량 운송비'},unknownFutureField:{keep:['a',1]}});
   await seed(source);const before=await state(),count=await counts(),loaded=await recipientRead(),saved=await edit({mileage:55555},loaded),after=await state();
   assert.equal(saved.car.km,55555);assert.equal(saved.car.mileage,55555);assert.equal(saved.revision,before.revision+1);assert.deepEqual(binding(saved),binding(loaded));
   assert.deepEqual(after.payload,[{...source,km:55555,mileage:55555},f.sibling]);assert.equal(after.revision,before.revision+1);
   const afterCount=await counts();assert.equal(afterCount.edits,count.edits+1);assert.equal(afterCount.notices,count.notices+1);
  });
  await test('legacy-only mileage records gain km only when mileage is explicitly edited, with zero supported',async()=>{
   const source=rawCar({mileage:12345});delete source.km;await seed(source);const saved=await edit({mileage:0}),after=await state();
   assert.equal(saved.car.km,0);assert.equal(saved.car.mileage,0);assert.deepEqual(after.payload,[{...source,km:0,mileage:0},f.sibling]);
  });
  await test('partial memo/price edits preserve original divergent or formatted mileage and financial data byte-for-byte',async()=>{
   const source=rawCar({km:'43,200',mileage:12345,inventoryLoan:1000000,inventoryStartedAt:'2026-11-01',inventoryInterestSnapshot:{version:1,amountWon:12345},unknownFutureField:{must:'remain'}});
   await seed(source);const before=await state(),saved=await edit({vehicleMemo:'새 메모',sell:15000001}),after=await state();
   assert.equal(saved.car.km,43200);assert.equal(saved.car.mileage,43200);assert.equal(after.revision,before.revision+1);
   assert.deepEqual(after.payload,[{...source,vehicleMemo:'새 메모',sell:15000001},f.sibling]);
  });
  await test('direct km, classification, financial and private patches stay forbidden, including mixed valid/invalid input',async()=>{
   for(const field of ['km','group','generation','grade','subgrade','extra','inventoryLoan','inventoryStartedAt','inventoryInterestSnapshot','costs','customCosts','customCostLabels','repairItems','ownerId','secretCustomer','incomeSettlement','moneyUnit']){
    const before=await state(),count=await counts(),loaded=await recipientRead();await deny(()=>edit({mileage:8765,[field]:123},loaded));assert.deepEqual(await state(),before);assert.deepEqual(await counts(),count);
   }
  });
  await test('invalid mileage values are rejected atomically before generated km can be merged',async()=>{
   for(const mileage of [null,'12345','12,345',-1,1.5,900000000001,{},[],true]){
    const before=await state(),loaded=await recipientRead();await deny(()=>edit({vehicleMemo:'must not save',mileage},loaded),['22023']);assert.deepEqual(await state(),before);
   }
   const saved=await edit({mileage:900000000000});assert.equal(saved.car.km,900000000000);
  });
  await test('KRW integer and legacy manwon precision rules remain unchanged and never convert stored units',async()=>{
   for(const moneyUnit of ['KRW',undefined]){
    const source=rawCar({km:'1,000',mileage:500,buy:moneyUnit?12000000:1200,sell:moneyUnit?15000000:1500});
    if(!moneyUnit)delete source.moneyUnit;await seed(source);
    let loaded=await recipientRead(),before=await state();await deny(()=>edit({buy:moneyUnit?1.5:1.00001},loaded),['22023']);assert.deepEqual(await state(),before);
    const expected=moneyUnit?12000001:1200.1234,saved=await edit({buy:expected}),after=await state();
    assert.equal(saved.car.buy,expected);assert.deepEqual(after.payload,[{...source,buy:expected},f.sibling]);
   }
  });
  await test('read-only and delete-only shares remain readable but cannot update canonical mileage',async()=>{
   for(const mode of ['read','delete']){await permission(mode);const loaded=await recipientRead(),before=await state();assert.equal(loaded.permission,mode);assert.equal(loaded.canEdit,false);assert.equal(loaded.canDelete,mode==='delete');await deny(()=>edit({mileage:1234},loaded));assert.deepEqual(await state(),before);}
   await permission('edit');
  });
  await test('stale dataset revision or invitation version cannot update mileage or any owner data',async()=>{
   let loaded=await recipientRead();await actor(OWNER);await call('update',{expected:loaded.revision,patch:{vehicleMemo:'concurrent owner edit'}});
   const before=await state();await deny(()=>edit({mileage:1234},loaded),['40001']);assert.deepEqual(await state(),before);
   loaded=await recipientRead();await permission('all');const changed=await state();await deny(()=>edit({mileage:1234},loaded),['40001']);assert.deepEqual(await state(),changed);await permission('edit');
  });
  await test('uninvited, revoked and replacement invitations cannot reuse previous access or direct owner datasets',async()=>{
   await actor(UPLOADER);await deny(()=>call('read'));const loaded=await recipientRead(),before=await state();
   await actor(OWNER);await call('revoke',{target:RECIPIENT});await actor(RECIPIENT);await deny(()=>call('read'));await deny(()=>edit({mileage:1234},loaded));
   await actor(OWNER);const newGrant=await call('grant',{email:RECIPIENT+'@example.invalid',permission:'edit'});await actor(RECIPIENT);await deny(()=>call('read'));await reply(newGrant.invitationId,newGrant.version);await deny(()=>edit({mileage:1234},loaded),['40001']);
   await actor(RECIPIENT);assert.equal((await db.query('select count(*)::int n from public.zc_datasets')).rows[0].n,0);await deny(()=>db.query('select * from snote_private.vehicle_shares'));assert.deepEqual(await state(),before);
  });
  await test('native owner and admin mileage writes use the same validated alias contract',async()=>{
   for(const id of [OWNER,ADMIN]){const before=await state();await actor(id);const loaded=await call('read');assert.equal(loaded.nativeAccess,true);const saved=await call('update',{expected:loaded.revision,patch:{mileage:id===OWNER?4321:9876}}),after=await state();assert.equal(saved.car.km,saved.car.mileage);assert.equal(after.payload[0].km,saved.car.km);assert.equal(after.payload[0].mileage,saved.car.km);assert.equal(after.revision,before.revision+1);assert.deepEqual(after.payload[1],f.sibling);}
  });
  await test('migration reapplication preserves grants, aliases, data, audits, notices and secure function metadata',async()=>{
   await actor(OWNER);const outgoing=await call('outgoing'),before=await state(),access=await metadata(),count=await counts();await db.exec(SQL);
   assert.deepEqual(await state(),before);assert.deepEqual(await metadata(),access);assert.deepEqual(await counts(),count);await actor(OWNER);assert.deepEqual(await call('outgoing'),outgoing);assert.equal((await recipientRead()).car.km,before.payload[0].km);
  });
  console.log(JSON.stringify({passed,failed}));assert.equal(failed,0);
 }finally{await db.close();}
}
if(require.main===module)run().catch(error=>{console.error(error.stack);process.exitCode=1;});
module.exports={FILE,SQL};
