/* Optional workspace tools. Authentication, policies and signature/account gates stay eager. */
(()=>{'use strict';
 if(window.SnoteFeatures)return;
 const base=new URL('.',document.currentScript.src),pending=new Map(),loaded=new Set(),files=new Map(),attempts=new Map();
 const groups=Object.freeze({
  catalog:['vehicle-catalog.js?v=2.185'],
  inspection:['vehicle-inspection-learning-data.js?v=2.236','vehicle-inspection.js?v=2.236'],
  taxonomyUI:['vehicle-taxonomy-ui.js?v=2.185'],
  taxonomyStore:['vehicle-taxonomy-store.js?v=2.20'],
  companyAssets:['company-assets.js?v=2.192'],
  information:['accountant-information-store.js?v=2.246','accountant-information.js?v=2.246'],
  accountantBusiness:['office-document-client.js?v=2.246','accountant-business-pages.js?v=2.246'],
  scanner:['scanner-client.js?v=2.247','scanner.js?v=2.247'],
  mobileDocument:['mobile-document-editor.js?v=2.184'],
  office:['transfer-document-layout.js?v=2.194','transfer-name-seal.js?v=2.192','transfer-company-seal.js?v=2.194','company-assets.js?v=2.192','contract-registration-store.js?v=2.244','contract-office.js?v=2.246']
 });
 function loadFile(file){
  const url=new URL(file,base),key=url.href;
  if(files.has(key))return files.get(key);
  const attempt=attempts.get(key)||0;
  // Chromium remembers a failed module URL. Retry only that failed file;
  // successful siblings/shared dependencies keep their original namespace.
  if(attempt)url.searchParams.set('snote_retry',String(attempt));
  const task=import(url.href).catch(error=>{if(files.get(key)===task)files.delete(key);attempts.set(key,attempt+1);throw error;});
  files.set(key,task);return task;
 }
 function load(name){
  if(!Object.hasOwn(groups,name))return Promise.reject(Error('UNKNOWN_OPTIONAL_FEATURE'));
  if(pending.has(name))return pending.get(name);
  const task=Promise.all(groups[name].map(loadFile)).then(()=>{loaded.add(name);return true;}).catch(error=>{if(pending.get(name)===task)pending.delete(name);throw error;});
  pending.set(name,task);return task;
 }
 function module(name){
  if(!Object.hasOwn(groups,name)||groups[name].length!==1)return Promise.reject(Error('UNKNOWN_OPTIONAL_MODULE'));
  return loadFile(groups[name][0]);
 }
 window.SnoteFeatures=Object.freeze({load,module,loaded:name=>loaded.has(name)});
})();
