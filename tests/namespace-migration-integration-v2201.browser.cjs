'use strict';
// Real Chromium/IndexedDB and shipped app functions. All accounts, files and
// HTTP responses are synthetic; every outbound request is intercepted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const app=require('./encar/browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'..'),ORIGIN='https://encar-smoke.example';
const OUT=process.env.NAMESPACE_MIGRATION_ARTIFACT_DIR||'/workspace/work/namespace-v2201/integration';
const OWNER='namespace_dealer',OLD_CAR='namespace-legacy-car';
const PASSWORD='SyntheticOnly!42',SALT='00112233445566778899aabbccddeeff',IDENTITY='9001011234567';
const PASSWORD_HASH=crypto.pbkdf2Sync(PASSWORD,Buffer.from(SALT,'hex'),180000,32,'sha256').toString('hex');
const LEGACY_CRYPTO_SALT='ZEROCAR-RRN-v180:';
const PRIMARY={files:'s-note-office-v12-files',accounts:'s-note-office-v12-accounts',customers:'s-note-office-v172-customers'};
const LEGACY={files:'zerocar-office-v12-files',accounts:'zerocar-office-v12-accounts',customers:'zerocar-office-v172-customers'};
const OLD_CACHE={cars:'zerocar-office-v12-cars-'+OWNER,covers:'zerocar-office-v12-covers-'+OWNER,
 companyOptions:'zerocar-office-v12-company-options',session:'zerocar-office-v12-session',finance:'zerocar-office-v182-inventory-finance-ledger'};
const results=[];fs.mkdirSync(OUT,{recursive:true});

async function seed(page,kinds=['files','accounts','customers']){
 await page.evaluate(async({kinds,owner,car,legacy,password,salt,passwordHash,identity,legacyCryptoSalt})=>{
  const open=(name,version,upgrade)=>new Promise((resolve,reject)=>{const r=indexedDB.open(name,version);r.onupgradeneeded=()=>upgrade(r.result);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const write=(db,stores,fill)=>new Promise((resolve,reject)=>{const tx=db.transaction(stores,'readwrite');fill(tx);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>{};});
  let oldCipher=null;
  if(kinds.includes('customers')){
   const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
   const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:new TextEncoder().encode(legacyCryptoSalt+owner+':'+salt),iterations:220000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
   const iv=crypto.getRandomValues(new Uint8Array(12)),encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(identity));
   const b64=value=>btoa(String.fromCharCode(...new Uint8Array(value)));
   oldCipher={alg:'AES-256-GCM',v:1,iv:b64(iv),data:b64(encrypted)};
  }
  for(const kind of kinds){
   const db=await open(legacy[kind],kind==='files'?2:1,db=>{
    if(kind==='files'){const media=db.createObjectStore('media',{keyPath:'id'});media.createIndex('carId','carId');media.createIndex('ownerId','ownerId');const model=db.createObjectStore('modelPhotos',{keyPath:'key'});model.createIndex('ownerId','ownerId');}
    if(kind==='accounts')db.createObjectStore('users',{keyPath:'username'});
    if(kind==='customers'){const customers=db.createObjectStore('customers',{keyPath:'id'});customers.createIndex('ownerId','ownerId');}
   });
   if(kind==='files')await write(db,['media','modelPhotos'],tx=>{
    const blob=new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#2364a5"/></svg>'],{type:'image/svg+xml'});
    tx.objectStore('media').put({id:'legacy-media',carId:car,ownerId:owner,group:'photo',filename:'synthetic.svg',blob,createdAt:1});
    tx.objectStore('media').put({id:'same-media',carId:car,ownerId:owner,group:'registration',filename:'older.svg',blob,createdAt:1});
    tx.objectStore('modelPhotos').put({key:'legacy-model',keySuffix:'synthetic-model',ownerId:owner,filename:'reference.svg',blob,createdAt:1});
   });
   if(kind==='accounts')await write(db,['users'],tx=>tx.objectStore('users').put({username:owner,name:'보존할 합성 딜러',company:'보존할 합성 상사',role:'dealer',salt,passwordHash,createdAt:1}));
   if(kind==='customers')await write(db,['customers'],tx=>tx.objectStore('customers').put({id:owner+':'+car,ownerId:owner,carId:car,name:'보존할 합성 고객',address:'합성 주소',createdAt:1,updatedAt:1,rrnCipher:oldCipher}));
   db.close();
  }
 },{kinds,owner:OWNER,car:OLD_CAR,legacy:LEGACY,password:PASSWORD,salt:SALT,passwordHash:PASSWORD_HASH,identity:IDENTITY,legacyCryptoSalt:LEGACY_CRYPTO_SALT});
}

async function seedCaches(page){
 await page.evaluate(({old,owner,car})=>{
  const cars=[{id:car,ownerId:owner,model:'이전 저장 차량',plate:'00가0000',year:2026,km:'100',buy:1000,sell:1200,status:'판매중',purchaseAt:'2026-01-01'},
   {id:'namespace-historical-sale',ownerId:owner,model:'보존할 과거 판매',plate:'00가0001',buy:500,sell:600,status:'판매완료',purchaseAt:'2026-01-01',soldAt:'',soldPrice:0}];
  localStorage.setItem(old.cars,JSON.stringify(cars));localStorage.setItem(old.covers,JSON.stringify({[car]:'legacy-media','namespace-historical-sale':'same-media'}));
  localStorage.setItem(old.companyOptions,JSON.stringify(['보존할 합성 상사','두 번째 합성 상사']));
  localStorage.setItem(old.finance,JSON.stringify([{id:'foreign-scope-must-not-import',loan:999999999}]));
 },{old:OLD_CACHE,owner:OWNER,car:OLD_CAR});
}

async function moduleFixture(browser,kinds=['files','accounts','customers']){
 const context=await browser.newContext(),page=await context.newPage(),external=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.origin!==ORIGIN){external.push(u.href);return route.abort();}
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><script src="/assets/snote-idb-compat.js"></script></head><body>가상 저장소 이관 시험</body></html>'});
  if(u.pathname==='/assets/snote-idb-compat.js')return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(ROOT,'assets/snote-idb-compat.js'))});
  return route.fulfill({status:404,body:''});
 });
 await page.goto(ORIGIN);await page.waitForFunction(()=>!!window.SnoteIdbCompat);
 await seed(page,kinds);
 return{context,page,async close(){assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}};
}

async function nativeRead(page,name,store){
 return page.evaluate(async({name,store})=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result.map(row=>({...row,...(row.blob?{blobType:row.blob.type,blobSize:row.blob.size,blob:undefined}:{})})));r.onerror=()=>reject(r.error);});}finally{db.close();}
 },{name,store});
}

async function schemaAndNoEarlyCopy(browser){
 const f=await moduleFixture(browser);
 try{
  const state=await f.page.evaluate(async({primary,legacy})=>{
   const before=await indexedDB.databases();const opened=[];
   for(const kind of ['files','accounts','customers']){const db=await SnoteIdbCompat.open(kind,{migrate:false});opened.push({kind,name:db.name,stores:[...db.objectStoreNames]});db.close();}
   const after=await indexedDB.databases();return{before,after,opened};
  },{primary:PRIMARY,legacy:LEGACY});
  for(const row of state.opened)assert.equal(row.name,PRIMARY[row.kind]);
  for(const kind of Object.keys(LEGACY))assert.equal(state.before.find(db=>db.name===LEGACY[kind]).version,state.after.find(db=>db.name===LEGACY[kind]).version,'An ordinary first open must not fence/read a legacy store');
  for(const row of state.opened){const store=row.kind==='accounts'?'users':row.kind==='customers'?'customers':'media';assert.deepEqual(await nativeRead(f.page,row.name,store),[]);}
  results.push({case:'startup opens only new empty schemas without touching legacy versions/data',passed:true});
 }finally{await f.close();}
}

async function copyDeleteAndReopen(browser){
 const f=await moduleFixture(browser);
 try{
  const copied=await f.page.evaluate(async({primary})=>{
   const target=await SnoteIdbCompat.open('files',{migrate:false});
   await new Promise((resolve,reject)=>{const tx=target.transaction('media','readwrite');tx.objectStore('media').put({id:'same-media',ownerId:'new-owner',carId:'new-car',group:'photo',filename:'current.txt',blob:new Blob(['current-row'],{type:'text/plain'}),createdAt:2});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});target.close();
   const states=[];for(const kind of ['files','accounts','customers']){const db=await SnoteIdbCompat.open(kind,{migrate:true});states.push({kind,name:db.name,version:db.version,stores:[...db.objectStoreNames]});db.close();}
   const db=await SnoteIdbCompat.open('files',{migrate:true});
   const read=await new Promise((resolve,reject)=>{const r=db.transaction('media').objectStore('media').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const bytes=await Promise.all(read.map(async row=>({id:row.id,text:await row.blob.text(),type:row.blob.type})));
   await new Promise((resolve,reject)=>{const tx=db.transaction('media','readwrite');tx.objectStore('media').delete('legacy-media');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
   const reopened=await SnoteIdbCompat.open('files',{migrate:true});const after=await new Promise((resolve,reject)=>{const r=reopened.transaction('media').objectStore('media').getAll();r.onsuccess=()=>resolve(r.result.map(row=>row.id));r.onerror=()=>reject(r.error);});reopened.close();
   return{states,bytes,after};
  },{primary:PRIMARY});
  assert.equal(copied.states.length,3);for(const row of copied.states)assert.equal(row.name,PRIMARY[row.kind]);
  assert.equal(copied.bytes.find(row=>row.id==='same-media').text,'current-row','A newer canonical row must not be overwritten by a legacy row');
  assert.match(copied.bytes.find(row=>row.id==='legacy-media').text,/<svg/);assert.equal(copied.bytes.find(row=>row.id==='legacy-media').type,'image/svg+xml');
  assert.deepEqual(copied.after,['same-media'],'Deleting a migrated record must not revive its retained legacy copy');
  const old=await nativeRead(f.page,LEGACY.files,'media');assert.equal(old.length,2);assert(old.some(row=>row.id==='legacy-media'),'The retained source must not be destructively emptied');
  const accounts=await nativeRead(f.page,PRIMARY.accounts,'users');assert.equal(accounts[0].salt,SALT);assert.equal(accounts[0].passwordHash,PASSWORD_HASH);
  const customers=await nativeRead(f.page,PRIMARY.customers,'customers'),originalCustomers=await nativeRead(f.page,LEGACY.customers,'customers');assert.deepEqual(customers[0].rrnCipher,originalCustomers[0].rrnCipher);assert.equal(customers[0].name,'보존할 합성 고객');
  results.push({case:'Blob/account/customer migration preserves canonical rows and deletion after close/reopen',passed:true});
 }finally{await f.close();}
}

async function blockedWriterAndRetry(browser){
 const f=await moduleFixture(browser,['files']);
 try{
  const blocked=await f.page.evaluate(async({legacy})=>{
   const target=await SnoteIdbCompat.open('files',{migrate:false});target.close();
   window.__namespaceOldWriter=await new Promise((resolve,reject)=>{const r=indexedDB.open(legacy,2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   __namespaceOldWriter.onversionchange=()=>{window.__namespaceVersionChange=true;};
   const result=await SnoteIdbCompat.open('files',{migrate:true}).then(db=>{db.close();return{ok:true};},error=>({ok:false,code:error.code||error.name,message:error.message}));
   return{result,changed:window.__namespaceVersionChange};
  },{legacy:LEGACY.files});
  assert.equal(blocked.result.ok,false,'An uncooperative old writer must not permit a split copy');assert.equal(blocked.result.code,'IDB_OTHER_TAB_OPEN');assert.equal(blocked.changed,true);
  assert.equal((await nativeRead(f.page,PRIMARY.files,'media')).length,0);
  await f.page.evaluate(()=>__namespaceOldWriter.close());
  const retry=await f.page.evaluate(async()=>{const db=await SnoteIdbCompat.open('files',{migrate:true});const name=db.name;db.close();return name;});assert.equal(retry,PRIMARY.files);
  assert.equal((await nativeRead(f.page,PRIMARY.files,'media')).length,2);
  results.push({case:'blocked legacy writer cannot split data; explicit retry migrates after it closes',passed:true});
 }finally{await f.close();}
}

async function quotaFailureAndRetry(browser){
 const f=await moduleFixture(browser,['files']);
 try{
  const failure=await f.page.evaluate(async({primary})=>{
   const db=await SnoteIdbCompat.open('files',{migrate:false});db.close();let injected=0;
   const originals={};for(const method of ['add','put']){originals[method]=IDBObjectStore.prototype[method];IDBObjectStore.prototype[method]=function(value,...rest){if(this.transaction.db.name===primary&&this.name==='media'&&value?.id==='legacy-media'){injected++;throw new DOMException('Synthetic quota failure','QuotaExceededError');}return originals[method].call(this,value,...rest);};}
   try{const outcome=await SnoteIdbCompat.open('files',{migrate:true}).then(db=>{db.close();return{ok:true};},error=>({ok:false,code:error.code||error.name,message:error.message}));return{outcome,injected};}
   finally{for(const method of ['add','put'])IDBObjectStore.prototype[method]=originals[method];}
  },{primary:PRIMARY.files});
  assert(failure.injected>0,'The browser fault must reach an actual canonical write');assert.equal(failure.outcome.ok,false);
  assert.equal((await nativeRead(f.page,PRIMARY.files,'media')).length,0,'A failed migration cannot leave a partial destination');
  assert.equal((await nativeRead(f.page,LEGACY.files,'media')).length,2,'A failed migration must preserve every old source record');
  await f.page.evaluate(async()=>{const db=await SnoteIdbCompat.open('files',{migrate:true});db.close();});assert.equal((await nativeRead(f.page,PRIMARY.files,'media')).length,2);
  results.push({case:'native quota failure is atomic and retry retains the original source',passed:true});
 }finally{await f.close();}
}

async function actualAppPaths(browser){
 app.setBrowser({async newContext(options){
  const context=await browser.newContext(options),seedPage=await context.newPage();
  const handler=route=>route.request().url()===ORIGIN+'/__namespace_seed'?route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"></head><body>가상 자료 준비</body></html>'}):route.abort();
  await context.route('**/*',handler);await seedPage.goto(ORIGIN+'/__namespace_seed');await seed(seedPage);await seedCaches(seedPage);await seedPage.close();await context.unroute('**/*',handler);return context;
 }});
 const f=await app.fixture(1440,null,{lookupUnavailable:true}),p=f.page;
 try{
  const state=await p.evaluate(async({owner,car,oldCache,password})=>{
   await closeVehicle({discard:true});window.SnoteIdleSession?.reset();const S=__encarFixtureState;S.ready=false;S.loading=false;S.user=null;S.company=null;S.queue.clear();clearTimeout(S.timer);
   const accounts=await SnoteIdbCompat.open('accounts',{migrate:true});accountDB=accounts;
   const account=await getAccount(owner);if(!account)throw Error('A migrated local account must be available to the shipped lookup');await enterWorkspace(account);
   const oldCars=localStorage.getItem(oldCache.cars),oldCovers=localStorage.getItem(oldCache.covers),loaded=dealerCars(owner);cars=loaded;loadCovers();
   const covered=structuredClone(covers),companies=getOrgs('company');cars.find(row=>row.id===car).extra='새 이름으로 저장';const savedCars=persistCars();
   covers[car]='new-media';saveCover();
   const files=await SnoteIdbCompat.open('files',{migrate:true});fileDB=files;await refreshMedia();
   const original=mediaByCar[car]?.find(row=>row.id==='legacy-media');const blobText=original?await original.blob.text():null;
   let localDeleteCode;try{await updateDB([],['legacy-media']);}catch(error){localDeleteCode=error.code;}
   await updateDB([{id:'new-media',ownerId:owner,carId:car,group:'photo',filename:'new.txt',blob:new Blob(['new-native-write'],{type:'text/plain'}),createdAt:2}]);
   // The existing online-only recycle guard is intentionally retained. A native
   // test deletion verifies namespace isolation without bypassing that UI guard.
   await new Promise((resolve,reject)=>{const tx=fileDB.transaction('media','readwrite');tx.objectStore('media').delete('legacy-media');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
   const customer=await zc72ReadCar(owner,car);await zc72Write({...customer,name:'새로 저장한 합성 고객',updatedAt:2});const saved=await zc72ReadCar(owner,car);
   return{account:{username:account.username,salt:account.salt,passwordHash:account.passwordHash,passwordMatches:await hashPassword(password,account.salt)===account.passwordHash},fileName:fileDB.name,blobText,customerName:customer.name,savedName:saved.name,cipher:customer.rrnCipher,
    loadedIds:loaded.map(row=>row.id),covered,companies,savedCars,localDeleteCode,newCars:JSON.parse(localStorage.getItem(carsStoreKey(owner))),newCovers:JSON.parse(localStorage.getItem(SnoteStorageCompat.keys.coversPrefix+owner)),oldCarsUnchanged:localStorage.getItem(oldCache.cars)===oldCars,oldCoversUnchanged:localStorage.getItem(oldCache.covers)===oldCovers,financeImported:localStorage.getItem(SnoteStorageCompat.keys.finance)};
  },{owner:OWNER,car:OLD_CAR,oldCache:OLD_CACHE,password:PASSWORD});
  assert.equal(state.account.username,OWNER);assert.equal(state.account.salt,SALT);assert.equal(state.account.passwordHash,PASSWORD_HASH);assert.equal(state.fileName,PRIMARY.files);assert.match(state.blobText,/<svg/);
  assert.equal(state.account.passwordMatches,true);assert.deepEqual(state.loadedIds,[OLD_CAR,'namespace-historical-sale']);assert.equal(state.covered[OLD_CAR],'legacy-media');assert.equal(state.covered['namespace-historical-sale'],'same-media');assert.deepEqual(state.companies,['보존할 합성 상사','두 번째 합성 상사']);
  assert.equal(state.savedCars,true,'A namespace cutover cannot revalidate unchanged historical sale facts as a new sale');assert.equal(state.newCars.find(row=>row.id===OLD_CAR).extra,'새 이름으로 저장');assert.equal(state.newCars.find(row=>row.id==='namespace-historical-sale').soldAt,'');
  assert.equal(state.newCovers[OLD_CAR],'new-media');assert.equal(state.newCovers['namespace-historical-sale'],'same-media');assert.equal(state.oldCarsUnchanged,true);assert.equal(state.oldCoversUnchanged,true);assert.equal(state.financeImported,null,'An unscoped old finance cache is never assigned to a current user/company');
  assert.equal(state.customerName,'보존할 합성 고객');assert.equal(state.savedName,'새로 저장한 합성 고객');const originalCustomers=await nativeRead(p,LEGACY.customers,'customers');assert.deepEqual(state.cipher,originalCustomers[0].rrnCipher);
  assert.equal(state.localDeleteCode,'RECYCLE_ONLINE_REQUIRED','The prior online-only media recycle boundary must remain intact');
  const fileRows=await nativeRead(p,PRIMARY.files,'media');assert(!fileRows.some(row=>row.id==='legacy-media'));assert(fileRows.some(row=>row.id==='new-media'));
  assert.equal((await nativeRead(p,LEGACY.files,'media')).length,2);
  await p.screenshot({path:path.join(OUT,'actual-app-local-migration.png')});
  results.push({case:'actual app account/media/customer read and write paths use the new native databases',passed:true});
  const encrypted=await p.evaluate(async({owner,car,password,identity,oldPrefix})=>{
   const account=await getAccount(owner),record=await zc72ReadCar(owner,car),old=JSON.stringify(record.rrnCipher);
   const original=crypto.subtle.deriveKey;let oldDerivations=0,totalDerivations=0;
   crypto.subtle.deriveKey=function(...args){totalDerivations++;if(new TextDecoder().decode(args[0].salt).startsWith(oldPrefix))oldDerivations++;return original.apply(this,args);};
   let read,newCipher,secondCipher,roundtrip,foreignDenied,tamperRejected=false,wrongPasswordRejected=false,unknownVersionRejected=false;
   try{
    await zc80RememberLogin(password,account);
    const afterLogin={total:totalDerivations,legacy:oldDerivations};
    read=await Promise.all([zc80DecryptRrn(record),zc80DecryptRrn(record)]);
    const afterReads={total:totalDerivations,legacy:oldDerivations};
    newCipher=await zc80EncryptRrn(identity);secondCipher=await zc80EncryptRrn(identity);
    roundtrip=await zc80DecryptRrn({...record,rrnCipher:newCipher});
    foreignDenied=await zc80DecryptRrn({...record,ownerId:'different-synthetic-owner'});
    const bytes=Uint8Array.from(atob(newCipher.data),c=>c.charCodeAt(0));bytes[0]^=1;
    try{await zc80DecryptRrn({...record,rrnCipher:{...newCipher,data:btoa(String.fromCharCode(...bytes))}});}catch(_){tamperRejected=true;}
    try{await zc80DecryptRrn({...record,rrnCipher:{...newCipher,v:99}});}catch(_){unknownVersionRejected=true;}
    await zc80RememberLogin('WrongSyntheticPassword!99',account);
    try{await zc80DecryptRrn(record);}catch(_){wrongPasswordRejected=true;}
    await zc80RememberLogin(password,account);
    // Decrypt the new wire format independently, with a fixed specified salt,
    // rather than trusting an encrypt/decrypt pair with the same potential bug.
    const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
    const key=await original.call(crypto.subtle,{name:'PBKDF2',salt:new TextEncoder().encode('s-note-rrn-v2:'+owner+':'+account.salt),iterations:220000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(newCipher.iv),c=>c.charCodeAt(0))},key,Uint8Array.from(atob(newCipher.data),c=>c.charCodeAt(0)));
    return{read,newCipher,secondCipher,roundtrip,foreignDenied,tamperRejected,wrongPasswordRejected,unknownVersionRejected,afterLogin,afterReads,independentPlain:new TextDecoder().decode(plain),unchanged:JSON.stringify((await zc72ReadCar(owner,car)).rrnCipher)===old};
   }finally{crypto.subtle.deriveKey=original;}
  },{owner:OWNER,car:OLD_CAR,password:PASSWORD,identity:IDENTITY,oldPrefix:LEGACY_CRYPTO_SALT});
  assert.deepEqual(encrypted.afterLogin,{total:1,legacy:0},'Ordinary login must not derive the old key');
  assert.deepEqual(encrypted.afterReads,{total:2,legacy:1},'Concurrent old records must share a single lazy legacy derivation');
  for(const value of encrypted.read)assert.equal(value.replace(/\D/g,''),IDENTITY);assert.equal(encrypted.newCipher.v,2);assert.notEqual(encrypted.newCipher.iv,encrypted.secondCipher.iv);
  assert.equal(encrypted.roundtrip.replace(/\D/g,''),IDENTITY);assert.equal(encrypted.independentPlain,IDENTITY);assert.equal(encrypted.foreignDenied,'');assert.equal(encrypted.tamperRejected,true);assert.equal(encrypted.unknownVersionRejected,true);assert.equal(encrypted.wrongPasswordRejected,true);assert.equal(encrypted.unchanged,true);
  results.push({case:'actual local crypto reads old AES-GCM, writes independently verified v2, rejects tamper and other owners',passed:true});
  const restored=await p.evaluate(async({owner,car})=>{
   const S=__encarFixtureState,key=SnoteStorageCompat.keys.session;
   currentUser=null;cars=[];zc80SensitiveLock();await snote201RestoreLocalSession();
   const local={user:currentUser?.username,ids:cars.map(row=>row.id),keyLocked:zc80SensitiveKey===null};
   currentUser=null;cars=[];sessionStorage.setItem(key,'cld_111111111111411181');await snote201RestoreLocalSession();const hostedHintDenied=currentUser===null;
   sessionStorage.setItem(key,owner);S.user={id:'11111111-1111-4111-8111-111111111111'};await snote201RestoreLocalSession();const authenticatedDenied=currentUser===null;
   S.user=null;S.busy=true;await snote201RestoreLocalSession();const authenticatingDenied=currentUser===null;
   S.busy=false;await snote201RestoreLocalSession();return{local,hostedHintDenied,authenticatedDenied,authenticatingDenied,resumed:currentUser?.username};
  },{owner:OWNER,car:OLD_CAR});
  assert.deepEqual(restored.local,{user:OWNER,ids:[OLD_CAR,'namespace-historical-sale'],keyLocked:true});assert.equal(restored.hostedHintDenied,true);assert.equal(restored.authenticatedDenied,true);assert.equal(restored.authenticatingDenied,true);assert.equal(restored.resumed,OWNER);
  results.push({case:'actual local session restoration preserves local work while hosted aliases and active authentication take precedence',passed:true});
  const staleEntries=await p.evaluate(async({owner})=>{
   const S=__encarFixtureState,account=await getAccount(owner),findings=[];
   for(const change of ['actor','hosted-user','hosted-busy']){
    let release,signal;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>signal=resolve);
    const locks=window.SnoteFinanceLock,readAccounts=getAllAccounts;
    if(change==='actor')window.SnoteFinanceLock={...locks,async load(value){const policy=await locks.load(value);signal();await gate;return policy;}};
    else getAllAccounts=async function(){const accounts=await readAccounts();signal();await gate;return accounts;};
    let outcome;
    try{
     const pending=enterWorkspace(account).then(()=>({ok:true}),error=>({ok:false,message:error.message}));
     await Promise.race([started,pending.then(value=>{throw Error('The real entry did not reach its held dependency: '+JSON.stringify(value));})]);
     if(change==='actor')currentUser={username:'next_dealer',name:'다음 합성 딜러',role:'dealer',company:'다음 합성 상사'};
     if(change==='hosted-user')S.user={id:'22222222-2222-4222-8222-222222222222'};
     if(change==='hosted-busy')S.busy=true;
     const nextActor=currentUser;cars=[{id:'next-scope-sentinel',ownerId:nextActor.username}];
     sessionStorage.setItem(SnoteStorageCompat.keys.session,'next-scope-session');document.getElementById('profile-name').textContent='다음 화면 프로필';
     release();outcome=await pending;
     findings.push({change,outcome,sameActor:currentUser===nextActor,session:sessionStorage.getItem(SnoteStorageCompat.keys.session),profile:document.getElementById('profile-name').textContent,carIds:cars.map(row=>row.id)});
    }finally{release();window.SnoteFinanceLock=locks;getAllAccounts=readAccounts;S.user=null;S.busy=false;}
    currentUser=null;await enterWorkspace(account);
   }
   return findings;
  },{owner:OWNER});
  assert.equal(staleEntries.length,3);for(const stale of staleEntries){assert.equal(stale.outcome.ok,false,stale.change+' must cancel the pending local entry');assert.equal(stale.sameActor,true);assert.equal(stale.session,'next-scope-session');assert.equal(stale.profile,'다음 화면 프로필');assert.deepEqual(stale.carIds,['next-scope-sentinel']);}
  results.push({case:'actual local entry rejects actor or hosted-auth changes during lock/account waits without overwriting the next scope',passed:true});
  const locked=await p.evaluate(async({owner,password,oldSession})=>{
   const account=await getAccount(owner),original=crypto.subtle.deriveKey;let release,entered;
   const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
   crypto.subtle.deriveKey=async function(...args){entered();const key=await original.apply(this,args);await gate;return key;};
   let outcome;
   try{const pending=zc80RememberLogin(password,account).then(()=>({ok:true}),error=>({ok:false,message:error.message}));await started;zc80SensitiveLock();release();outcome=await pending;}
   finally{crypto.subtle.deriveKey=original;}
   const keyStayedLocked=zc80SensitiveKey===null&&zc80SensitiveUser===null&&snote201SensitiveMaterial===null;
   sessionStorage.setItem(oldSession,owner);const newBefore=sessionStorage.getItem(SnoteStorageCompat.keys.session);
   const confirm=window.snoteConfirm;window.snoteConfirm=async()=>true;
   try{await logout();}finally{window.snoteConfirm=confirm;}
   const after={old:sessionStorage.getItem(oldSession),primary:sessionStorage.getItem(SnoteStorageCompat.keys.session),user:currentUser,key:zc80SensitiveKey};
   // A cached old script writing the hint again still cannot restore it.
   sessionStorage.setItem(oldSession,owner);const staleRead=snote201SessionStorage.readLocal(SnoteStorageCompat.keys.session,{mode:'local',validate:value=>value===owner});await snote201RestoreLocalSession();
   return{outcome,keyStayedLocked,newBefore,after,staleRead,staleUser:currentUser};
  },{owner:OWNER,password:PASSWORD,oldSession:OLD_CACHE.session});
  assert.equal(locked.outcome.ok,false,'Locking while PBKDF2 is pending must prevent key resurrection');assert.equal(locked.keyStayedLocked,true);assert.equal(locked.newBefore,OWNER);assert.deepEqual(locked.after,{old:null,primary:null,user:null,key:null});assert.equal(locked.staleRead,null);assert.equal(locked.staleUser,null);
  results.push({case:'actual lock cancels pending key derivation and logout invalidates old/new session hints',passed:true});
  await app.finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'actual-app-failure.png')}).catch(()=>{});await f.context.close();throw error;}
}

async function main(){
 const moduleOnly=process.env.NAMESPACE_MIGRATION_MODULE_ONLY==='1',expected=moduleOnly?4:9;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
 try{await schemaAndNoEarlyCopy(browser);await copyDeleteAndReopen(browser);await blockedWriterAndRetry(browser);await quotaFailureAndRetry(browser);if(!moduleOnly)await actualAppPaths(browser);}
 finally{await browser.close();fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({passed:results.length===expected,completeSuite:!moduleOnly,syntheticOnly:true,operationalRequests:0,operationalDatabaseChanges:0,results},null,2)+'\n');}
 assert.equal(results.length,expected);for(const result of results)console.log('PASS '+result.case);
}
if(require.main===module)main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
