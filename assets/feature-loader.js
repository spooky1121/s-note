/* Optional workspace tools. Authentication, policies and signature/account gates stay eager. */
(()=>{'use strict';
 if(window.SnoteFeatures)return;
 const base=new URL('.',document.currentScript.src),pending=new Map(),loaded=new Set(),attempts=new Map();
 const groups=Object.freeze({
  catalog:['vehicle-catalog.js?v=2.82'],
  companyAssets:['company-assets.js?v=2.128'],
  mobileDocument:['mobile-document-editor.js?v=2.184'],
  office:['transfer-document-layout.js?v=2.143','transfer-name-seal.js?v=2.143','transfer-company-seal.js?v=2.143','company-assets.js?v=2.128','contract-office.js?v=2.179']
 });
 function load(name){
  if(!Object.hasOwn(groups,name))return Promise.reject(Error('UNKNOWN_OPTIONAL_FEATURE'));
  if(pending.has(name))return pending.get(name);
  const attempt=attempts.get(name)||0;
  const task=Promise.all(groups[name].map(file=>{const url=new URL(file,base);if(name==='mobileDocument'&&attempt)url.searchParams.set('snote_retry',String(attempt));return import(url.href);})).then(()=>{loaded.add(name);return true;}).catch(error=>{pending.delete(name);attempts.set(name,attempt+1);throw error;});
  pending.set(name,task);return task;
 }
 window.SnoteFeatures=Object.freeze({load,loaded:name=>loaded.has(name)});
})();
