'use strict';
// Real PostgreSQL engine, synthetic tenants only. Uses PGlite physical export/import,
// NOT pg_dump/pg_restore and NOT an end-to-end hosted Supabase recovery claim.
// NODE_PATH=/tmp/snote-qa-deps/node_modules node tests/backup-recovery.sql.cjs
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {PGlite}=require('@electric-sql/pglite');
const {createFixture,COMPANY,FOREIGN,OWNER,OUTSIDER}=require('./recycle-bin-db.cjs');
(async()=>{
 const {createBackup,extractBackup,bytesEntry,objectEntry}=await import('../scripts/backup/archive.mjs');
 const {INVENTORY_SQL,validateInventory}=await import('../scripts/backup/capture.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'snote-db-recovery-'));let db,restored;
 try{
  db=await createFixture();
  await db.exec(await fs.readFile(path.join(__dirname,'../supabase/migrations/20261106113557_scoped_recycle_bin.sql'),'utf8'));
  await db.exec("create table storage.buckets_analytics(id text);create table storage.buckets_vectors(id text);create table snote_private.profile_avatars(file_path text);create table storage.buckets(id text primary key,public boolean not null default false);insert into storage.buckets values('zc-vehicle-private',false),('snote-profile-photos',false);");
  const vehicle={id:'recovery-car',ownerId:OWNER,plate:'SYNTHETIC',status:'판매완료',incomeSettlement:{version:1,document:{cells:{C10:12345678,D15:234567}}}};
  const book={type:'snote-monthly-workbook',version:1,month:'2026-11',rows:[{id:'fixture',deposit:2345678}]};
  for(const [dataset,owner,payload] of [['cars',OWNER,[vehicle]],['monthly','00000000-0000-0000-0000-000000000000',[book]]])await db.query('insert into public.zc_datasets(company_id,dataset,owner_id,payload) values($1,$2,$3,$4)',[COMPANY,dataset,owner,JSON.stringify(payload)]);
  const customer={name:'Synthetic customer',phone:'00000000000',contractData:{price:12345678,signature:'synthetic signature'},identityCipher:'synthetic ciphertext, not an identifier'};
  await db.query('insert into public.zc_customers(company_id,owner_id,car_id,payload) values($1,$2,$3,$4)',[COMPANY,OWNER,vehicle.id,JSON.stringify(customer)]);
  await db.query('insert into zc_private.rrn_keys(company_id,secret) values($1,$2)',[COMPANY,'synthetic-encryption-key-not-real']);
  const mediaBytes=Buffer.from('SYNTHETIC registration and photo bytes');
  const object={bucket_id:'zc-vehicle-private',name:`${COMPANY}/${OWNER}/recovery-car/registration.pdf`,metadata:{size:mediaBytes.length}};
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[object.bucket_id,object.name,JSON.stringify(object.metadata)]);
  await db.query("insert into public.zc_media(company_id,owner_id,id,car_id,file_path,original_name,mime_type,file_size,group_name) values($1,$2,'registration',$3,$4,'fixture.pdf','application/pdf',$5,'registration')",[COMPANY,OWNER,vehicle.id,object.name,mediaBytes.length]);
  await db.query("insert into snote_private.recycle_bin(company_id,owner_id,car_id,kind,source_id,snapshot,deleted_by,request_id,request_hash) values($1,$2,'archived-car','vehicle','fixture','{\"fixture\":true}',$2,gen_random_uuid(),'synthetic')",[COMPANY,OWNER]);
  const row=(await db.query(INVENTORY_SQL)).rows[0],inventory=Object.values(row)[0];validateInventory(inventory);
  const tables=inventory.tables.filter(t=>!['pg_catalog','information_schema'].includes(t.schema));
  const quote=s=>'"'+s.replaceAll('"','""')+'"';
  const allRows=async instance=>{const result={};for(const table of tables){const name=quote(table.schema)+'.'+quote(table.name);result[name]=(await instance.query('select row_to_json(t)::text as row from '+name+' t order by row_to_json(t)::text')).rows.map(x=>x.row);}return result;};
  const before=await allRows(db),pgdata=await db.dumpDataDir();
  const output=path.join(dir,'synthetic.snbak'),passphrase='synthetic-local-drill-passphrase-only';
  await createBackup({output,passphrase,source:{database:'pglite-physical-synthetic-fixture',production:false},entries:[bytesEntry('inventory.json',inventory),bytesEntry('roles.json',{roles:inventory.roles,memberships:inventory.roleMemberships}),bytesEntry('database.dump',Buffer.from(await pgdata.arrayBuffer())),bytesEntry(objectEntry(object),mediaBytes)]});
  // Simulated loss is restricted to this in-memory synthetic instance.
  await db.exec("delete from public.zc_datasets where dataset='monthly';");assert.equal((await db.query("select * from public.zc_datasets where dataset='monthly'")).rows.length,0);
  const recovered=path.join(dir,'recovered');await extractBackup({input:output,passphrase,output:recovered});
  restored=new PGlite({loadDataDir:new Blob([await fs.readFile(path.join(recovered,'database.dump'))])});await restored.waitReady;
  assert.deepEqual(await allRows(restored),before);
  assert.deepEqual(await fs.readFile(path.join(recovered,objectEntry(object))),mediaBytes);
  assert.deepEqual((await restored.query("select payload from public.zc_datasets where dataset='cars'")).rows[0].payload,[vehicle]);
  assert.deepEqual((await restored.query("select payload from public.zc_datasets where dataset='monthly'")).rows[0].payload,[book]);
  assert.deepEqual((await restored.query('select payload from public.zc_customers')).rows[0].payload,customer);
  const policies=(await restored.query("select count(*)::int n from pg_policies where schemaname in('public','storage','snote_private')")).rows[0].n;assert(policies>0);
  await restored.query("select set_config('request.jwt.claim.sub',$1,false)",[OUTSIDER]);await restored.exec('set role authenticated');
  assert.equal((await restored.query('select * from public.zc_customers where company_id=$1',[COMPANY])).rows.length,0);
  await assert.rejects(restored.query('select * from snote_private.recycle_bin'),error=>error.code==='42501');await restored.exec('reset role');
  console.log(JSON.stringify({status:'PASS',syntheticOnly:true,databaseEngine:'PGlite PostgreSQL',tablesCompared:tables.length,policiesPreserved:policies,verified:['all fixture rows','vehicles','customers and signatures','monthly and income settlement','private recycle data','attachment bytes','role permissions and tenant isolation'],hostedPgDumpRestoreTested:false,productionBackupCreated:false}));
 }finally{if(db&&!db.closed)await db.close();if(restored&&!restored.closed)await restored.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
