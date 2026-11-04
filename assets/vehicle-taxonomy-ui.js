import {createVehicleTaxonomyStore,normalizeTaxonomyEntry,taxonomyEntryFromCar,taxonomyIdentity} from './vehicle-taxonomy-store.js?v=2.20';

const bridge=()=>window.snoteVehicleTaxonomyBridge;
let scope=null,store=null,entries=[],pending=[],loading=null,busy=false,activeSaves=0,activeRetries=0,epoch=0,status='';
const notices=[];
function error(code,message){return Object.assign(new Error(message),{code});}
function current(captured=scope){return !!captured&&captured.uiEpoch===epoch&&scope?.key===captured.key&&bridge()?.context()?.key===captured.key;}
function check(captured){if(!current(captured))throw error('CONTEXT_CHANGED','로그인 또는 상사가 변경되었습니다.');}
function key(context){return 'snote-company-taxonomy-pending:v1:'+context.company_id+':'+context.user_id;}
function persist(){
  if(!current())return;
  try{if(pending.length)localStorage.setItem(key(scope),JSON.stringify(pending));else localStorage.removeItem(key(scope));}
  catch(_){status='이 브라우저에 재시도 내용을 보관하지 못했습니다. 화면을 닫기 전에 저장 상태를 확인해 주세요.';}
}
function readPending(context){
  try{
    const rows=JSON.parse(localStorage.getItem(key(context))||'[]');if(!Array.isArray(rows))return [];
    return rows.slice(0,200).flatMap(row=>{try{
      if(!row||typeof row.carId!=='string'||!row.carId||row.carId.length>200)return [];
      return [{carId:row.carId,entry:normalizeTaxonomyEntry(row.entry),vehicleSaved:row.vehicleSaved===true}];
    }catch(_){return [];}});
  }catch(_){return [];}
}
function addNotice(host,inline=false){
  if(!host)return;
  const box=document.createElement('div');box.className='snote220-taxonomy-notice';
  box.id=inline?'snote220-taxonomy-inline':'snote220-taxonomy-notice';box.hidden=true;box.setAttribute('role','status');
  const text=document.createElement('span');if(!inline)text.id='snote220-taxonomy-status';
  const actions=document.createElement('div');actions.className='snote220-taxonomy-actions';
  const retry=document.createElement('button');retry.type='button';retry.textContent='목록 저장 다시 확인';retry.dataset.vehicleTaxonomyRetry='';
  if(!inline)retry.id='snote220-taxonomy-retry';
  retry.addEventListener('click',()=>retryPending());
  const sql=document.createElement('a');sql.href='supabase/migrations/202611010005_vehicle_taxonomy.sql';sql.download='202611010005_vehicle_taxonomy.sql';sql.textContent='설정 SQL 받기';
  actions.append(retry,sql);box.append(text,actions);host.append(box);notices.push({box,text,retry,sql});
}
const content=document.querySelector('#snote-app .content');
if(content){const anchor=document.getElementById('zc-cloud-banner');const holder=document.createElement('div');if(anchor)anchor.after(holder);else content.prepend(holder);addNotice(holder);}
const form=document.querySelector('#overlay form');
if(form){const holder=document.createElement('div');form.querySelector('.modal-top')?.after(holder);addNotice(holder,true);}
let stateCode='';
function render(){
  const visible=current(),message=status||(pending.length?'차종 목록에 서버 저장을 확인할 항목 '+pending.length+'건이 있습니다.':'');
  const tip=document.querySelector('#overlay .formtip');
  if(tip){tip.textContent='';tip.hidden=true;}
  for(const item of notices){
    item.box.hidden=!visible||(!message&&!item.box.id.endsWith('-inline'));
    if(visible&&!message&&item.box.id.endsWith('-inline')){item.box.hidden=true;item.text.textContent='';}
    else item.text.textContent=message;
    item.box.dataset.state=stateCode;
    item.retry.hidden=!pending.length&&stateCode!=='SETUP_REQUIRED'&&stateCode!=='NETWORK';
    item.retry.disabled=busy||!!loading;
    item.sql.hidden=stateCode!=='SETUP_REQUIRED';
  }
}
function refreshOptions(){
  window.refreshTaxonomyWidget?.();
  // A background refresh must never clear an OCR selection or typed manual input.
  const modal=document.getElementById('overlay');
  if(modal?.classList.contains('open')&&['make','group','generation','grade'].every(field=>!document.getElementById('new-'+field)?.value&&!document.getElementById('snote98-'+field+'-input')?.value.trim()))window.fillVehicleSelect?.('make');
}
function reset(){epoch++;scope=null;store=null;entries=[];pending=[];loading=null;busy=false;activeSaves=0;activeRetries=0;status='';stateCode='';render();}
function session(){
  const next=bridge()?.context();if(!next)throw error('CONTEXT_CHANGED','온라인 로그인과 상사 연결을 확인해 주세요.');
  if(scope?.key===next.key)return scope;
  reset();scope={...next,uiEpoch:epoch};pending=readPending(scope);
  const captured=scope;
  store=createVehicleTaxonomyStore({
    currentKey:()=>current(captured)?captured.key:null,
    companyId:()=>captured.company_id,
    read:()=>bridge().read(captured),upsert:entry=>bridge().upsert(captured,entry),
    onLoaded(rows){check(captured);entries=rows;refreshOptions();},
    onSaved(row){check(captured);const identity=taxonomyIdentity(row);entries=entries.filter(item=>taxonomyIdentity(item)!==identity).concat(row);refreshOptions();}
  });render();return scope;
}
function messageFor(failure,vehicleSaved){
  if(failure?.code==='SETUP_REQUIRED')return (vehicleSaved?'차량은 서버에 저장되었습니다. ':'')+'상사 공용 차종 목록은 DB 설정이 필요합니다. 설정 SQL 전체를 실행한 뒤 다시 확인해 주세요.';
  if(failure?.code==='CAR_NOT_SAVED')return '차량의 서버 저장을 확인하지 못했습니다. 차량 저장 상태를 확인한 뒤 목록 저장을 다시 시도해 주세요.';
  if(failure?.code==='FORBIDDEN')return '차종 목록을 저장할 권한이 없습니다. 소속과 계정 상태를 확인해 주세요.';
  return (vehicleSaved?'차량은 서버에 저장되었지만 차종 목록 저장은 확인하지 못했습니다. ':'차량과 차종 목록의 서버 저장을 확인하지 못했습니다. ')+'입력한 분류를 보관했습니다. 연결을 확인한 뒤 다시 시도해 주세요.';
}
async function load(){
  const captured=session();if(loading)return loading;
  const task=(async()=>{try{
    await store.load();check(captured);
    if(!pending.length){status='';stateCode='';}render();return true;
  }catch(failure){if(current(captured)){stateCode=failure.code||'NETWORK';status=messageFor(failure,false);render();}throw failure;}
  finally{if(current(captured)&&loading===task){loading=null;render();}}})();
  loading=task;render();return task;
}
async function commit(item,captured){
  check(captured);
  await bridge().confirmVehicle(captured,item.carId,item.entry);check(captured);
  item.vehicleSaved=true;persist();
  const result=await store.save(item.entry);check(captured);
  const identity=taxonomyIdentity(result.entry);
  pending=pending.filter(row=>taxonomyIdentity(row.entry)!==identity);persist();
  return result;
}
async function saveCar(car){
  const captured=session(),entry=taxonomyEntryFromCar(car);
  const item={carId:String(car.id||''),entry,vehicleSaved:false};
  if(!item.carId||item.carId.length>200)throw error('INVALID_DATA','차량 식별자를 확인해 주세요.');
  const existing=pending.find(row=>row.carId===item.carId);if(existing)pending[pending.indexOf(existing)]=item;else pending.push(item);
  persist();activeSaves++;busy=true;stateCode='saving';status='차량과 직접 입력 분류의 서버 저장을 확인하고 있습니다.';render();
  try{
    await commit(item,captured);check(captured);stateCode='saved';status='직접 입력한 분류를 상사 공용 DB에 저장했습니다. 다음 등록에서 선택할 수 있습니다.';
    return {state:'saved',vehicleSaved:true};
  }catch(failure){
    check(captured);stateCode=failure.code||'NETWORK';status=messageFor(failure,item.vehicleSaved);persist();
    return {state:'pending',vehicleSaved:item.vehicleSaved,code:stateCode};
  }finally{if(current(captured)){activeSaves--;busy=activeSaves>0||activeRetries>0;if(busy){stateCode='saving';status='다른 분류 저장을 이어서 확인하고 있습니다.';}render();}}
}
async function retryPending(){
  if(busy)return;
  let captured;try{captured=session();}catch(_){return;}
  activeRetries++;busy=true;stateCode='saving';status='서버 저장 상태를 다시 확인하고 있습니다.';render();
  try{
    // A successful server read also verifies that a newly applied migration is ready.
    await store.load();check(captured);
    for(const item of [...pending]){if(!pending.includes(item))continue;await commit(item,captured);}
    check(captured);stateCode='saved';status='상사 공용 차종 목록을 확인했습니다. 다음 차량 등록에서 선택할 수 있습니다.';
  }catch(failure){if(current(captured)){stateCode=failure.code||'NETWORK';status=messageFor(failure,pending.length>0&&pending.every(row=>row.vehicleSaved));persist();}}
  finally{if(current(captured)){activeRetries--;busy=activeSaves>0||activeRetries>0;if(busy){stateCode='saving';status='다른 분류 저장을 이어서 확인하고 있습니다.';}render();}}
}
window.snoteResetVehicleTaxonomy=reset;
window.snoteVehicleTaxonomyRows=()=>current()?entries.map(row=>({...row})):[];
window.snoteLoadVehicleTaxonomy=load;
window.snoteSaveVehicleTaxonomyForCar=saveCar;
window.snotePrepareVehicleTaxonomyCar=taxonomyEntryFromCar;
window.snoteRetryVehicleTaxonomy=retryPending;
window.snoteVehicleTaxonomyOnOpen=()=>{if(bridge()?.context())void load().catch(()=>{});else render();};
if(bridge()?.context())void load().catch(()=>{});else render();
