/* A small administrator-only inspection of provider data. No classification import. */
(()=>{'use strict';
 if(window.SnoteTaxonomyProbeUI)return;
 const ID='snote-encar-taxonomy-probe',MAKES=[['Hyundai','현대'],['Kia','기아'],['BMW','BMW'],['Mercedes-Benz','벤츠']];
 const ERRORS={
  API_KEY_MISSING:'API 키가 등록되어 있지 않습니다. Cloudflare에 등록한 뒤 다시 배포해 주세요.',
  API_KEY_INVALID:'등록한 API 키의 형식을 확인해 주세요.',
  API_KEY_REJECTED:'제공 업체가 API 키를 거절했습니다. 발급받은 키와 사용 상태를 확인해 주세요.',
  UPSTREAM_RATE_LIMITED:'API 호출 한도에 도달했습니다. 한도가 갱신된 뒤 다시 확인해 주세요.',
  UPSTREAM_UNAVAILABLE:'제공 업체에 연결하지 못했습니다. 잠시 후 직접 다시 확인해 주세요.',
  UPSTREAM_NOT_FOUND:'선택한 매물은 현재 제공 업체에서 조회할 수 없습니다.',
  UPSTREAM_FORBIDDEN:'공급자가 접근을 거절했습니다. 키 권한과 접근 정책을 확인해 주세요.',
  UPSTREAM_TIMEOUT:'제공 업체의 응답 시간이 초과되었습니다. 자동으로 다시 호출하지 않습니다.',
  UPSTREAM_INVALID:'제공 업체의 응답 형식을 확인하지 못했습니다.',
  UPSTREAM_REDIRECT:'제공 업체의 API 주소가 변경되어 연결을 확인하지 못했습니다.',
  UNAUTHORIZED:'온라인 계정으로 다시 로그인해 주세요.',
  AUTH_UNAVAILABLE:'관리자 인증을 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.',
  FORBIDDEN:'현재 상사의 관리자만 API 샘플을 확인할 수 있습니다.',
  SETUP_REQUIRED:'서버 연결 설정을 확인한 뒤 다시 시도해 주세요.',
  INVALID_REQUEST:'제조사와 현재 로그인 상태를 확인해 주세요.',
  INVALID_RESPONSE:'서버 응답 형식을 확인하지 못했습니다. 잠시 후 직접 다시 확인해 주세요.',
  NETWORK:'서버 응답을 확인하지 못했습니다. 호출이 이미 처리되었을 수 있으므로 잠시 후 직접 다시 확인해 주세요.'
 };
 let active=null,epoch=0,scheduled=false;
 const bridge=()=>window.snoteTaxonomyProbeBridge;
 function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
 function host(){if(typeof route!=='undefined'&&route!=='settings')return null;return document.querySelector('#alt-content .snote90-settings');}
 function valid(state){if(!state||active!==state||state.version!==epoch||!state.card.isConnected||host()!==state.host)return false;try{return !!bridge()?.current(state.context);}catch{return false;}}
 function text(value,max=160){return typeof value==='string'?value.slice(0,max):'';}
 function number(value,max=1e9){return Number.isSafeInteger(value)&&value>=0&&value<=max?value:null;}
 function checkedTime(value){const time=Date.parse(value);return Number.isFinite(time)?new Date(time).toISOString():null;}
 function safeReport(value){
  if(!value||value.ok!==true||value.provider!=='encar-api.com'||!MAKES.some(([make])=>make===value.manufacturer)||!checkedTime(value.checkedAt)||!Array.isArray(value.samples)||number(value.providerRequestCount,2)===null)throw Error('INVALID_REPORT');
  return {ok:true,provider:'encar-api.com',manufacturer:value.manufacturer,checkedAt:checkedTime(value.checkedAt),cached:value.cached===true,providerRequestCount:number(value.providerRequestCount,2)??0,
   samples:value.samples.slice(0,3).map(row=>({listingId:/^[1-9][0-9]{0,11}$/.test(String(row?.listingId||''))?String(row.listingId):null,manufacturer:text(row?.manufacturer),modelGroup:text(row?.modelGroup)||null,model:text(row?.model),badge:text(row?.badge)||null})),
   detailClassification:Array.isArray(value.detailClassification)?value.detailClassification.slice(0,60).flatMap(row=>typeof row?.path==='string'&&/^[A-Za-z][A-Za-z0-9_.-]{0,399}$/.test(row.path)&&['string','number'].includes(typeof row.value)?[{path:row.path,value:typeof row.value==='number'?(Number.isFinite(row.value)?row.value:null):text(row.value,160)}]:[]):[],
   schemaSummary:{modelGroupObserved:value.schemaSummary?.modelGroupObserved===true,separateGradeTrimObserved:value.schemaSummary?.separateGradeTrimObserved===true,classificationCodeObserved:value.schemaSummary?.classificationCodeObserved===true,requiresReview:true},
   detailStatus:['checked','skipped_no_listing','skipped_quota','unavailable'].includes(value.detailStatus)?value.detailStatus:'unavailable',
   rateLimit:{limit:number(value.rateLimit?.limit),remaining:number(value.rateLimit?.remaining),reset:number(value.rateLimit?.reset,1e15)},
   warningCodes:Array.isArray(value.warnings)?value.warnings.slice(0,8).map(row=>text(row?.code,60)).filter(code=>/^[A-Z0-9_]+$/.test(code)):[],importEnabled:false};
 }
 function errorMessage(error){const code=Object.hasOwn(ERRORS,error?.code)?error.code:'NETWORK';return {code,message:ERRORS[code],providerRequestCount:number(error?.providerRequestCount,2),retryAfter:number(error?.retryAfter,86400)};}
 function message(state,value,tone='info'){state.message.textContent=value;state.message.dataset.tone=tone;}
 function badge(state,value,tone='info'){state.badge.textContent=value;state.badge.dataset.tone=tone;}
 function controls(state){const busy=state.statusBusy||state.probeBusy;state.select.disabled=busy;state.probe.disabled=busy||!state.configured;state.retry.disabled=busy;state.copy.disabled=busy||(!state.report&&!state.failure);state.card.setAttribute('aria-busy',String(busy));}
 function clearResult(state){state.report=null;state.failure=null;state.results.replaceChildren();state.results.hidden=true;state.fallback.hidden=true;state.fallback.value='';}
 function showReport(state,report){
  state.results.replaceChildren();state.results.hidden=false;
  const stamp=new Date(report.checkedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const remaining=report.rateLimit.remaining===null?'':' · 남은 호출 '+report.rateLimit.remaining.toLocaleString('ko-KR')+'회(확인 당시)';
  state.results.append(element('p','snote-probe-meta',(report.cached?'이전 확인 결과 · 추가 호출 없음':'이번 확인 '+report.providerRequestCount+'회 호출')+remaining+' · '+stamp));
  if(report.samples.length){
   const table=element('div','snote-probe-table');table.setAttribute('role','table');table.setAttribute('aria-label','확인한 차량 분류 샘플');const head=element('div','snote-probe-row is-heading');head.setAttribute('role','row');for(const name of ['제조사','모델','등급·트림 원문']){const cell=element('div','snote-probe-cell',name);cell.setAttribute('role','columnheader');head.append(cell);}table.append(head);
   const body=element('div','snote-probe-table-body');body.setAttribute('role','rowgroup');for(const row of report.samples){const line=element('div','snote-probe-row');line.setAttribute('role','row');for(const value of [row.manufacturer||'확인 필요',[...new Set([row.modelGroup,row.model].filter(Boolean))].join(' · ')||'확인 필요',row.badge||'제공되지 않음']){const cell=element('div','snote-probe-cell',value);cell.setAttribute('role','cell');line.append(cell);}body.append(line);}table.append(body);state.results.append(table);
  }else state.results.append(element('p','snote-probe-empty','이 조건에 맞는 샘플이 없습니다. 다른 제조사를 선택해 확인할 수 있습니다.'));
  const facts=element('div','snote-probe-facts');for(const [label,found]of [['모델군 필드',report.schemaSummary.modelGroupObserved],['등급·세부등급 분리 후보',report.schemaSummary.separateGradeTrimObserved],['분류 코드 후보',report.schemaSummary.classificationCodeObserved]])facts.append(element('span',found?'is-observed':'',label+' · '+(found?'있음 · 매핑 검토 필요':'확인 필요')));state.results.append(facts);
  if(report.detailStatus==='skipped_quota')state.results.append(element('p','snote-probe-detail-note','남은 호출 한도로 상세 분류 조회를 생략했습니다.'));
  else if(report.detailStatus==='unavailable')state.results.append(element('p','snote-probe-detail-note','목록은 확인했지만 상세 분류는 확인하지 못했습니다.'));
  if(report.detailClassification.length){const details=element('details','snote-probe-detail');details.append(element('summary','','상세 분류 보기'));const list=element('dl');for(const row of report.detailClassification.slice(0,24)){list.append(element('dt','',row.path),element('dd','',String(row.value??'')));}details.append(list);if(report.detailClassification.length>24)details.append(element('p','snote-probe-detail-note','화면에는 24개까지 표시합니다. 전체 분류 근거는 진단 복사에서 확인할 수 있습니다.'));state.results.append(details);}
  state.results.append(element('p','snote-probe-detail-note','현재 매물의 샘플입니다. 전체 차종 범위와 등급 분리는 추가 확인이 필요합니다.'));
 }
 async function status(state){
  if(!valid(state)||state.statusBusy||state.probeBusy)return;state.statusBusy=true;state.configured=false;clearResult(state);badge(state,'설정 확인 중');message(state,'서버의 키 등록 여부를 확인하고 있습니다.');controls(state);
  try{const result=await bridge().status(state.context);if(!valid(state))return;if(result?.ok!==true||typeof result.configured!=='boolean'||result.provider!=='encar-api.com')throw Error('INVALID_STATUS');state.configured=result.configured;
   const invalidKey=!result.configured&&result.configurationCode==='API_KEY_INVALID';badge(state,result.configured?'등록됨 · 연결 미확인':invalidKey?'키 형식 확인':'키 미등록',result.configured?'info':'warning');message(state,result.configured?'제조사를 선택하고 샘플을 확인해 주세요.':invalidKey?ERRORS.API_KEY_INVALID:'Cloudflare s-note의 Production에 ENCAR_API_KEY를 암호화해 저장하고 새로 배포해 주세요.',result.configured?'info':'warning');
  }catch(error){if(!valid(state))return;state.failure=errorMessage(error);badge(state,'설정 확인 실패','error');message(state,state.failure.message,'error');}
  finally{if(valid(state)){state.statusBusy=false;controls(state);}}
 }
 async function probe(state){
  if(!valid(state)||!state.configured||state.statusBusy||state.probeBusy)return;state.probeBusy=true;clearResult(state);badge(state,'샘플 확인 중');message(state,'소량의 차량 분류를 확인하고 있습니다.');controls(state);
  try{const result=safeReport(await bridge().probe(state.context,{manufacturer:state.select.value}));if(!valid(state))return;state.report=result;showReport(state,result);badge(state,result.samples.length?'샘플 수신 완료':'샘플 없음',result.samples.length?'success':'info');message(state,'확인 결과이며 차량·차종 DB에는 저장하지 않았습니다.','success');}
  catch(error){if(!valid(state))return;state.failure=errorMessage(error);badge(state,'연결 확인 실패','error');message(state,state.failure.message+(state.failure.retryAfter?' '+Math.ceil(state.failure.retryAfter/60)+'분 후 다시 확인해 주세요.':''),'error');}
  finally{if(valid(state)){state.probeBusy=false;controls(state);}}
 }
 async function copy(state){
  if(!valid(state)||state.statusBusy||state.probeBusy||(!state.report&&!state.failure))return;
  const diagnostic=state.report||{provider:'encar-api.com',checkedAt:new Date().toISOString(),error:{code:state.failure.code,providerRequestCount:state.failure.providerRequestCount,retryAfter:state.failure.retryAfter},importEnabled:false};
  const value=JSON.stringify(diagnostic,null,2);
  try{if(!navigator.clipboard?.writeText)throw Error('NO_CLIPBOARD');await navigator.clipboard.writeText(value);if(valid(state))message(state,'확인 결과를 복사했습니다.');}
  catch{if(!valid(state))return;state.fallback.value=value;state.fallback.hidden=false;state.fallback.focus();state.fallback.select();message(state,'아래 내용을 선택해 복사해 주세요.');}
 }
 function destroy(){epoch++;if(active){active.results.replaceChildren();active.fallback.value='';active.card.remove();}active=null;}
 function mount(settings,context){
  const card=element('section','snote90-panel snote-taxonomy-probe');card.id=ID;card.setAttribute('aria-labelledby',ID+'-title');
  const header=element('div','snote-probe-heading'),titleBox=element('div'),title=element('h3','','차종 데이터 API');title.id=ID+'-title';titleBox.append(title,element('p','','제조사·모델·등급 정보를 소량 확인합니다.'));const tag=element('span','snote-probe-badge','설정 확인 중');header.append(titleBox,tag);
  const toolbar=element('div','snote-probe-toolbar'),label=element('label','','제조사'),select=element('select');select.id=ID+'-manufacturer';label.htmlFor=select.id;for(const [value,name]of MAKES){const option=element('option','',name);option.value=value;select.append(option);}label.append(select);const check=element('button','snote-probe-primary','샘플 확인');check.type='button';check.id=ID+'-check';toolbar.append(label,check);
  const note=element('p','snote-probe-note','한 번 확인할 때 최대 2회 호출합니다. 차량·차종 DB에는 아직 저장하지 않습니다.');
  const msg=element('p','snote-probe-message');msg.id=ID+'-message';msg.setAttribute('role','status');msg.setAttribute('aria-live','polite');
  const results=element('div','snote-probe-results');results.hidden=true;const actions=element('div','snote-probe-actions'),retry=element('button','snote-probe-text','설정 다시 확인'),copyButton=element('button','snote-probe-text','진단 복사');retry.type=copyButton.type='button';retry.id=ID+'-retry';copyButton.id=ID+'-copy';actions.append(retry,copyButton);
  const fallback=element('textarea','snote-probe-copy');fallback.readOnly=true;fallback.hidden=true;fallback.setAttribute('aria-label','API 확인 결과 복사');fallback.rows=7;
  card.append(header,toolbar,note,msg,results,actions,fallback);settings.append(card);
  const state={host:settings,card,context,version:++epoch,badge:tag,select,probe:check,retry,copy:copyButton,message:msg,results,fallback,configured:false,statusBusy:false,probeBusy:false,report:null,failure:null};active=state;
  check.addEventListener('click',()=>probe(state));retry.addEventListener('click',()=>status(state));copyButton.addEventListener('click',()=>copy(state));status(state);
 }
 function sync(){scheduled=false;const settings=host();let context=null;try{context=bridge()?.context();}catch{}
  if(!settings||!context){if(active)destroy();return;}
  if(active&&active.host===settings&&active.context.key===context.key&&valid(active))return;
  destroy();if(!document.getElementById(ID))mount(settings,context);
 }
 function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(sync);}}
 new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class','aria-hidden']});
 let timer=setInterval(sync,200);addEventListener('pagehide',()=>{clearInterval(timer);timer=null;destroy();});addEventListener('pageshow',event=>{if(event.persisted){if(!timer)timer=setInterval(sync,200);schedule();}});
 window.SnoteTaxonomyProbeUI=Object.freeze({refresh:schedule});sync();
})();
