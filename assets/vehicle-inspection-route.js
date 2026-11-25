/* The guide is optional. Only the verified workspace context owns its session notes. */
(()=>{'use strict';
 if(window.SnoteInspectionRoute)return;
 const host=document.getElementById('vehicle-inspection-screen'),app=document.getElementById('snote-app');
 if(!host||!app)return;
 let intent=0,bound=null,loading=null,styleJob=null,watched=null;
 function context(){
  if(host.hidden||app.hidden||app.inert||app.getAttribute('aria-hidden')==='true')return null;
  const bridge=window.snoteCompanyPurchaseBridge;
  try{const value=bridge?.context?.();return value?.ready===true&&['admin','dealer','accountant'].includes(value.role)&&bridge.current(value)===true?value:null;}catch{return null;}
 }
 const current=expected=>{const now=context();return !!now&&now.key===expected?.key&&now.userId===expected.userId&&now.companyId===expected.companyId&&now.role===expected.role;};
 const scope=value=>JSON.stringify([value.companyId,value.userId,value.role]);
 function styles(){
  if(styleJob)return styleJob;
  styleJob=new Promise((resolve,reject)=>{
   const link=document.createElement('link');link.rel='stylesheet';link.href='assets/vehicle-inspection.css?v=2.235';
   const fail=()=>{clearTimeout(timer);link.remove();styleJob=null;reject(Error('INSPECTION_STYLE_UNAVAILABLE'));},timer=setTimeout(fail,12000);
   link.onload=()=>{clearTimeout(timer);resolve(true);};link.onerror=fail;document.head.append(link);
  });return styleJob;
 }
 function message(text,retry=false){
  host.replaceChildren();const box=document.createElement('div');box.className='panel';box.style.padding='24px';box.setAttribute('role','status');box.textContent=text;
  if(retry){const button=document.createElement('button');button.type='button';button.className='btn-ghost';button.textContent='다시 불러오기';button.style.marginLeft='12px';button.addEventListener('click',refresh);box.append(button);}host.append(box);
 }
 function reset(){
  intent++;bound=null;loading=null;window.SnoteVehicleInspection?.clear?.();window.SnoteVehicleInspection?.unmount?.();host.replaceChildren();host.removeAttribute('aria-busy');
 }
 function refresh(){
  const expected=context();
  watched=expected?.key||null;
  if(!expected){
   intent++;loading=null;bound=null;window.SnoteVehicleInspection?.unmount?.();host.replaceChildren();host.removeAttribute('aria-busy');
   if(!host.hidden)message('계정과 상사 정보를 확인하고 있습니다.');return;
  }
  if(bound&&current(bound)&&window.SnoteVehicleInspection)return;
  if(loading&&current(loading.context))return;
  const request=++intent;bound=null;window.SnoteVehicleInspection?.unmount?.();message('차량 검수 도우미를 준비하고 있습니다.');host.setAttribute('aria-busy','true');
  let timer;const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('INSPECTION_LOAD_TIMEOUT')),15000);});
  const job=Promise.race([Promise.all([styles(),Promise.resolve().then(()=>window.SnoteFeatures.load('inspection'))]),deadline]);loading={context:expected,job};
  void job.then(()=>{
   if(request!==intent||!current(expected))return;
   if(!window.SnoteVehicleInspection)throw Error('INSPECTION_MODULE_UNAVAILABLE');
   window.SnoteVehicleInspection.mount(host,{scopeKey:scope(expected),actorLabel:'내 검수 체크',isCurrent:()=>current(expected),learningData:window.SnoteVehicleInspectionLearning});bound=expected;
  }).catch(()=>{if(request===intent&&current(expected))message('검수 도우미를 불러오지 못했습니다.',true);}).finally(()=>{clearTimeout(timer);if(request===intent){loading=null;host.removeAttribute('aria-busy');}});
 }
 window.SnoteInspectionRoute=Object.freeze({refresh,reset});
 for(const name of ['snote:route-changed','snote:company-cars-ready','snote:workspace-order-context','pageshow'])window.addEventListener(name,refresh);
 for(const name of ['snote:auth-reset','pagehide'])window.addEventListener(name,reset);
 // A late account/company transition must also invalidate a pending module load.
 new MutationObserver(refresh).observe(app,{attributes:true,attributeFilter:['hidden','inert','aria-hidden']});
 new MutationObserver(refresh).observe(host,{attributes:true,attributeFilter:['hidden']});
 const gate=document.getElementById('zc-cloud-gate');if(gate)new MutationObserver(refresh).observe(gate,{attributes:true,attributeFilter:['hidden','class','style']});
 // Context changes do not always change the route or the DOM (e.g. company switching).
 // This is only an identity check; it never performs a network request or repeats a failed load.
 setInterval(()=>{const value=context(),key=value?.key||null;if(key!==watched){watched=key;refresh();}},500);
 refresh();
})();
