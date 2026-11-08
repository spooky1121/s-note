import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, stat, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createBackup, inspectBackup, extractBackup, bytesEntry, objectEntry } from '../scripts/backup/archive.mjs';
import { validateInventory, safeEnvironment, assertStorageUnchanged, downloadObject } from '../scripts/backup/capture.mjs';

const password = 'synthetic-fixture-passphrase-not-a-secret';
const ref = 'abcdefghijklmnopqrst';
const contents = Buffer.from('SYNTHETIC PRIVATE REGISTRATION DOCUMENT');
const item = { bucket_id: 'zc-vehicle-private', name: 'fixture/customer/서류 %.pdf', metadata: { size: contents.length, eTag: createHash('md5').update(contents).digest('hex') } };
const inventory = () => ({ format: 'snote-inventory-v1', tables: ['zc_datasets','zc_customers','zc_media','zc_companies','zc_members'].map(name => ({schema:'public',name})), buckets: [{ id: 'zc-vehicle-private', public: false }], objects: [item], fileReferences: [{bucket_id:item.bucket_id,name:item.name}], unsupportedBucketCount: 0 });
const source = { projectRef: 'synthetic', database: 'full-pg-dump-custom' };
const entries = () => [bytesEntry('inventory.json', inventory()), bytesEntry('roles.json', { passwordsIncluded: false }), bytesEntry('database.dump', Buffer.from('PGDMP synthetic fixture only')), bytesEntry(objectEntry(item), contents)];
async function temp(t) { const dir = await mkdtemp(join(tmpdir(),'snote-backup-test-')); t.after(() => rm(dir,{recursive:true,force:true})); return dir; }
async function backup(dir, changes = {}) { return createBackup({ output: join(dir,'backup.snbak'), passphrase: password, source, entries: entries(), ...changes }); }

test('encrypted archive verifies and extracts all DB, inventory and file bytes to a new directory', async t => {
 const dir=await temp(t), output=join(dir,'backup.snbak'); const created=await backup(dir);
 const stored=await readFile(output);
 for(const privateText of ['PRIVATE REGISTRATION','서류','zc-vehicle-private','PGDMP']) assert.equal(stored.includes(Buffer.from(privateText)),false);
 assert.equal((await stat(output)).mode & 0o777,0o600);
 const checked=await inspectBackup({input:output,passphrase:password}); assert.deepEqual(checked,created);
 await extractBackup({input:output,passphrase:password,output:join(dir,'recovered')});
 assert.deepEqual(await readFile(join(dir,'recovered',objectEntry(item))),contents);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'recovered','inventory.json'))),inventory());
 assert.equal((await stat(join(dir,'recovered'))).mode & 0o777,0o700);
 await assert.rejects(extractBackup({input:output,passphrase:password,output:join(dir,'recovered')}),/EEXIST/);
});

test('wrong passphrase and header/ciphertext tampering fail authentication without extraction',async t=>{
 const dir=await temp(t);await backup(dir);const input=join(dir,'backup.snbak');
 await assert.rejects(inspectBackup({input,passphrase:password+'wrong'}),/AUTHENTICATION_FAILED/);
 for(const position of [9,41,70]) {const tampered=Buffer.from(await readFile(input));tampered[position]^=1;const bad=join(dir,`bad-${position}.snbak`);await writeFile(bad,tampered);
  await assert.rejects(extractBackup({input:bad,passphrase:password,output:join(dir,`bad-${position}`)}));
  assert(!((await readdir(dir)).includes(`bad-${position}`)));
 }
});

test('truncation, missing terminal marker, appended data, reordered and oversized frames are rejected',async t=>{
 const dir=await temp(t);await backup(dir);const good=await readFile(join(dir,'backup.snbak'));
 const firstSize=good.readUInt32BE(48)+4, secondStart=48+firstSize, secondSize=good.readUInt32BE(secondStart)+4;
 const swapped=Buffer.concat([good.subarray(0,48),good.subarray(secondStart,secondStart+secondSize),good.subarray(48,secondStart),good.subarray(secondStart+secondSize)]);
 const oversized=Buffer.from(good);oversized.writeUInt32BE(0xffffffff,48);
 for(const [i,bad] of [good.subarray(0,20),good.subarray(0,-1),good.subarray(0,secondStart),Buffer.concat([good,Buffer.alloc(4)]),swapped,oversized].entries()) {
  const file=join(dir,`bad${i}.snbak`);await writeFile(file,bad);await assert.rejects(inspectBackup({input:file,passphrase:password}));
 }
});

test('failed source stream leaves no final archive or partial; no overwrite of a valid backup',async t=>{
 const dir=await temp(t);const failed=entries();failed[2]={name:'database.dump',stream:(async function*(){yield Buffer.from('PGDMP');throw Error('SOURCE_FAILED');})()};
 await assert.rejects(backup(dir,{entries:failed}),/SOURCE_FAILED/);assert.deepEqual(await readdir(dir),[]);
 await backup(dir);const first=await readFile(join(dir,'backup.snbak'));await assert.rejects(backup(dir),/EEXIST/);
 assert.deepEqual(await readFile(join(dir,'backup.snbak')),first);assert.deepEqual(await readdir(dir),['backup.snbak']);
});

test('backup is refused on missing storage bytes, wrong size, duplicate entries, path traversal and empty dump',async t=>{
 const dir=await temp(t);
 const variants=[entries().slice(0,3),[...entries(),bytesEntry(objectEntry(item),contents)],entries().map(e=>e.name.startsWith('objects/')?bytesEntry(e.name,Buffer.from('short')):e),entries().map(e=>e.name==='database.dump'?bytesEntry('../escape',Buffer.from('x')):e),entries().map(e=>e.name==='database.dump'?bytesEntry(e.name,Buffer.alloc(0)):e)];
 for(const invalid of variants) {await assert.rejects(backup(dir,{entries:invalid}));assert.deepEqual(await readdir(dir),[]);}
});

test('post-capture storage change and source process failure prevent final publication',async t=>{
 const dir=await temp(t);
 await assert.rejects(backup(dir,{beforeComplete:()=>{throw Error('STORAGE_CHANGED_DURING_BACKUP');}}),/STORAGE_CHANGED/);
 const bad=entries();bad[2].complete=()=>{throw Error('PG_DUMP_FAILED');};await assert.rejects(backup(dir,{entries:bad}),/PG_DUMP_FAILED/);
 assert.deepEqual(await readdir(dir),[]);
});

test('multi-chunk and zero-length objects round-trip with exact hashes',async t=>{
 const dir=await temp(t),big=Buffer.alloc(2*1024*1024+37,123),zero={bucket_id:'zc-vehicle-private',name:'empty',metadata:{size:0}},large={...item,name:'large',metadata:{size:big.length}};
 const inv={...inventory(),objects:[zero,large]};
 await backup(dir,{entries:[bytesEntry('inventory.json',inv),...entries().slice(1,3),bytesEntry(objectEntry(zero),Buffer.alloc(0)),bytesEntry(objectEntry(large),big)]});
 const manifest=await inspectBackup({input:join(dir,'backup.snbak'),passphrase:password});assert.equal(manifest.entries.at(-1).sha256,createHash('sha256').update(big).digest('hex'));
});

test('short passphrase and non-private parent are refused',async t=>{
 const dir=await temp(t);await assert.rejects(backup(dir,{passphrase:'short'}),/PASSPHRASE/);
 await mkdir(join(dir,'shared'),{mode:0o755});await assert.rejects(backup(dir,{output:join(dir,'shared','backup.snbak')}),/PRIVATE/);
});

test('source binding rejects implicit target, TLS downgrade, service config and credential leakage to children',()=>{
 const good={PATH:'/usr/bin',PGHOST:`db.${ref}.supabase.co`,PGDATABASE:'postgres',PGUSER:'postgres',PGSSLMODE:'verify-full',SUPABASE_SERVICE_ROLE_KEY:'x'.repeat(50),SNOTE_BACKUP_PASSPHRASE:password,UNRELATED_SECRET:'secret'};
 const child=safeEnvironment(good,ref);assert(!child.SUPABASE_SERVICE_ROLE_KEY);assert(!child.SNOTE_BACKUP_PASSPHRASE);assert(!child.UNRELATED_SECRET);
 for(const override of [{PGHOST:'other'},{PGDATABASE:''},{PGSSLMODE:'require'},{PGHOSTADDR:'127.0.0.1'},{PGSERVICE:'default'},{PGPORT:'6543'},{SUPABASE_SERVICE_ROLE_KEY:''}])assert.throws(()=>safeEnvironment({...good,...override},ref));
});

test('inventory validates all file sizes and supported buckets, and material storage changes fail',()=>{
 validateInventory(inventory());assertStorageUnchanged(inventory(),structuredClone(inventory()));
 for(const patch of [{objects:Array(8001).fill(item)},{fileReferences:[{bucket_id:item.bucket_id,name:'missing.pdf'}]},{unsupportedBucketCount:1},{objects:[{...item,metadata:{}}]},{objects:[item,item]},{objects:[{...item,name:'../secret'}]},{buckets:[{id:item.bucket_id,type:'VECTOR'}]},{tables:[]}])assert.throws(()=>validateInventory({...inventory(),...patch}));
 assert.throws(()=>assertStorageUnchanged(inventory(),{...inventory(),objects:[]}),/STORAGE_CHANGED/);
 assert.throws(()=>assertStorageUnchanged(inventory(),{...inventory(),buckets:[{id:item.bucket_id,public:true}]}),/STORAGE_CHANGED/);
});

test('private file download is exact-host, encoded, non-redirecting and size/version/hash checked',async()=>{
 let request;
 const good=async(url,options)=>{request={url,options};return new Response(contents,{headers:{'content-length':String(contents.length),etag:'"'+item.metadata.eTag+'"'}});};
 await assert.rejects(downloadObject(ref,'synthetic-secret',{...item,metadata:{size:contents.length}},good),/VERSION_UNKNOWN/);
 const downloaded=await downloadObject(ref,'synthetic-secret',item,good);const chunks=[];for await(const bytes of downloaded.stream)chunks.push(bytes);await downloaded.complete();assert.deepEqual(Buffer.concat(chunks),contents);
 assert.equal(new URL(request.url).hostname,`${ref}.supabase.co`);assert(request.url.includes('%EC%84%9C%EB%A5%98%20%25.pdf'));assert.equal(request.options.redirect,'error');
 await assert.rejects(downloadObject(ref,'synthetic-secret',item,async()=>new Response('no',{status:404})),/DOWNLOAD_FAILED/);
 await assert.rejects(downloadObject(ref,'synthetic-secret',item,async()=>new Response(contents,{headers:{etag:'wrong'}})),/VERSION_MISMATCH/);
 await assert.rejects(downloadObject(ref,'synthetic-secret',item,async()=>new Response(contents,{headers:{'content-length':'1'}})),/SIZE_MISMATCH/);
 const corrupt=await downloadObject(ref,'synthetic-secret',item,async()=>new Response(Buffer.alloc(contents.length),{headers:{etag:item.metadata.eTag}}));for await(const _ of corrupt.stream){}await assert.rejects(async()=>corrupt.complete(),/CHECKSUM_MISMATCH/);
});

test('CLI failure does not log supplied secrets, row data or local paths',()=>{
 const result=spawnSync(process.execPath,['scripts/snote-backup.mjs','verify','--input','/does/not/exist/private-customer'],{cwd:new URL('..',import.meta.url),encoding:'utf8',env:{PATH:process.env.PATH,SNOTE_BACKUP_PASSPHRASE:password}});
 assert.equal(result.status,1);assert(!result.stderr.includes(password));assert(!result.stderr.includes('private-customer'));assert.match(result.stderr,/BACKUP_OPERATION_FAILED/);
});

test('capture coordinates a held read-only snapshot, full dump parser and storage, with mocked local clients only',async t=>{
 const {captureBackup}=await import('../scripts/backup/capture.mjs');
 const dir=await temp(t),bin=join(dir,'bin');await mkdir(bin,{mode:0o700});
 const pglog=join(dir,'psql-input.log'),dumplog=join(dir,'dump-args.log'),restorelog=join(dir,'restore-args.log');
 const inv={...inventory(),roles:[],roleMemberships:[]};
 async function executable(name,body){await writeFile(join(bin,name),`#!${process.execPath}\n${body}`,{mode:0o700});}
 await executable('psql',`const fs=require('node:fs'); const value=${JSON.stringify(JSON.stringify(inv))};
 if(process.argv.includes('-c')){process.stdout.write(value+'\\n');process.exit(0);}
 let sent=false;process.stdin.on('data',chunk=>{const text=String(chunk);fs.appendFileSync(${JSON.stringify(pglog)},text);if(!sent){sent=true;process.stdout.write('00000001-00000001-1\\n'+value+'\\n');}});`);
 await executable('pg_dump',`require('node:fs').writeFileSync(${JSON.stringify(dumplog)},JSON.stringify(process.argv));process.stdout.write('PGDMP synthetic capture pipeline fixture');`);
 await executable('pg_restore',`require('node:fs').writeFileSync(${JSON.stringify(restorelog)},JSON.stringify(process.argv));let body='';process.stdin.on('data',c=>body+=c);process.stdin.on('end',()=>{if(!body.startsWith('PGDMP'))process.exitCode=1;});`);
 const oldFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=oldFetch;});globalThis.fetch=async()=>new Response(contents,{headers:{etag:item.metadata.eTag,'content-length':String(contents.length)}});
 const env={PATH:bin,PGHOST:`db.${ref}.supabase.co`,PGDATABASE:'postgres',PGUSER:'postgres',PGSSLMODE:'verify-full',SUPABASE_SERVICE_ROLE_KEY:'synthetic-storage-credential-for-test-only'};
 const output=join(dir,'capture.snbak');await captureBackup({output,projectRef:ref,passphrase:password,env});
 const log=await readFile(pglog,'utf8');assert.match(log,/begin isolation level repeatable read read only/);assert.match(log,/pg_export_snapshot/);assert.match(log,/rollback/);
 const args=await readFile(dumplog,'utf8');assert.match(args,/--snapshot=00000001-00000001-1/);assert(!args.includes('--schema'));assert(!args.includes('--exclude'));
 assert.match(await readFile(restorelog,'utf8'),/--file=\/dev\/null/);
 const checked=await inspectBackup({input:output,passphrase:password});assert.equal(checked.entries.length,4);
 // A parser failure must not leave a final archive, even when pg_dump exits 0.
 await executable('pg_restore',`process.stdin.resume();process.stdin.on('end',()=>{process.exitCode=1;});`);
 await assert.rejects(captureBackup({output:join(dir,'invalid.snbak'),projectRef:ref,passphrase:password,env}),/PG_RESTORE_FAILED/);
 assert(!(await readdir(dir)).includes('invalid.snbak'));assert(!(await readdir(dir)).some(name=>name.endsWith('.partial')));
});
