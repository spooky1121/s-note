/* Source-context catalog. IDs remain distinct even when the five names match. */
(function(root){'use strict';
 if(root.SnoteVehicleCatalog)return;
 const URL='./assets/vehicle-catalog.json?v=2.82',COUNT=3128,VERSION='research-20261107-v1';
 const ID=/^research-[a-f0-9]{24}$/,HEX=/^[a-f0-9]{64}$/;
 const requiredStrings=['make','group','model','grade','subgrade','modelYear','fuel','engine','drivetrain','transmission','market','sourceId','sourceUrl','evidenceStatus','recordType'];
 const referenceFields=['make','group','model','grade','subgrade','market','modelYear','fuel','engine','drivetrain','transmission','source','sourceId','evidenceStatus','sourceUrl','recordType','qualifiers','optionPackage','powertrainChoice','seatLayout','seatingCapacity','bodyStyle','batteryRange','availability','sourceMarket','sourceTimelineYear','sourcePeriod','sourcePublicationDate','trimStatus','launchStatus','sourceLabel','mappingStatus','retrievedAt','sourceFile','sourceRecordRef','savedSourceConditions','sourceCorrections','notes'];
 const proofQualifiers=new Set(['parentHistoryUrl','supportingSourceIds','marketEvidence','publisherVehicleModelId','retailSearchHierarchyVerified','requiresSourceAuthenticationReview','thirdPartyArchive','independentCorroboration','specificationLocator','eligibleForAutomaticRuntimeImport']);
 const contextValues={model_only:'차명만 확인',model_and_engine_only:'차명·엔진만 확인',powertrain_only:'동력계만 확인',model_level_label:'모델명 자료',option_package_variant:'선택품목 사양',official_line_and_package:'라인·패키지',single_trim_explicitly_stated_for_this_release:'해당 발표의 단일 트림'};
 const statusLabels={availability:{prelaunch:'출시 전 자료',announced_KR_lineup:'국내 라인업 발표',published_KR_brand_page:'국내 브랜드 페이지',published_authorized_KR_dealer_model_list:'국내 공식 딜러 목록',published_KR_dealer_document_not_delivery_confirmation:'국내 딜러 자료 · 인도 여부 미확인',announced_2018_02_sale:'2018년 2월 판매 발표',published_KR_launch_not_current_sale_confirmation:'국내 출시 자료 · 현재 판매 미확인',announced_KR_2025_04_02_launch:'2025년 4월 2일 국내 출시 발표',explicitly_not_currently_sold_in_KR:'자료 기준 국내 미판매',published_KR_configurator_not_sale_confirmation:'국내 구성표 · 판매 여부 미확인',source_mentions_KR_prelaunch:'국내 출시 예정 언급',published_KR_specification:'국내 제원 자료'},trimStatus:{not_published_on_source:'원문에 등급 미공개',engine_option_only_trim_mapping_not_published:'엔진 선택만 공개 · 등급 연결 미공개'},launchStatus:{prelaunch_announced:'출시 전 발표',announced_production_pending:'생산 예정 발표'}};
 const qualifierNames={catalogYearLabel:'자료 연도',publicationDate:'발표',effectiveMonth:'적용 시점',generationLabel:'세대',generationCode:'세대 코드',generation:'세대',rawGenerationLabel:'원문 세대',displacementCC:'배기량 cc',transmissionOptions:'변속기 선택',driveOptions:'구동 선택',optionPackageNames:'선택품목',motorPowerKW:'모터 kW',motorPowerKw:'모터 kW',electricMotorPowerKW:'전기모터 kW',batteryKWh:'배터리 kWh',batteryKwh:'배터리 kWh',batteryCapacityKWh:'배터리 kWh',batteryChemistry:'배터리',usage:'용도',publishedCategory:'원문 분류',projectCode:'모델 코드',gradeFamily:'등급군',manufacturerTypeCode:'제작사 형식',manufacturerOptionCode:'선택코드',manufacturerOptionCodes:'선택코드',configurationKind:'사양 구분',variantLabel:'사양',introductionDate:'소개 시점',introductionYear:'소개 연도',idleStopStart:'스톱·스타트',baseGrade:'기준 등급',rawLine:'원문 라인',rawPackage:'원문 패키지',optionalDrivetrain:'선택 구동',edition:'에디션',cab:'캡',wheelbaseLabel:'축거',seatOptions:'좌석 선택',observedListingYear:'관측 연식',coverageLevel:'자료 범위',rangeVariant:'주행거리 사양',AWDOptionIncludes:'AWD 선택품목',limitedKoreanUnits:'국내 한정 수량',powertrain:'동력계',observedPeriod:'관측 시점',optionalTransmission:'선택 변속기',basedOnTrim:'기준 트림',trimScope:'트림 범위',rawParentLabel:'원문 상위명',rawTrimLabel:'원문 트림',officialImportStatus:'공식 수입'};
 let list=Object.freeze([]),byId=new Map(),labels=new Map(),datasetVersion=null,manifestHash=null;
 const pendingKeys=new Map(),verifiedKeys=new Map(),pendingFunctions=new WeakMap(),verifiedFunctions=new WeakMap();
 const invalid=code=>Object.assign(new Error(code),{code});
 const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.prototype.toString.call(value)==='[object Object]';
 function jsonSafe(value,depth=0){
  if(depth>64)throw invalid('CATALOG_INVALID_DATA');
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'&&Number.isFinite(value))return;
  if(Array.isArray(value)){for(const item of value)jsonSafe(item,depth+1);return;}
  if(isObject(value)){for(const item of Object.values(value))jsonSafe(item,depth+1);return;}
  throw invalid('CATALOG_INVALID_DATA');
 }
 function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(isObject(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
 }
 function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
 const clone=value=>JSON.parse(JSON.stringify(value));
 const text=value=>value===null||value===undefined?'':String(value).trim();
 const contextLabel=(field,value)=>statusLabels[field]&&Object.prototype.hasOwnProperty.call(statusLabels[field],value)?statusLabels[field][value]:value;
 function record(value){
  const id=typeof value==='string'?value:isObject(value)?value.id||value.researchId:null;
  if(isObject(value)&&value.id&&value.researchId&&value.id!==value.researchId)return null;
  return typeof id==='string'?byId.get(id)||null:null;
 }
 function checkRow(row){
  if(!isObject(row)||!ID.test(row.id)||row.id!==row.researchId)throw invalid('CATALOG_INVALID_ID');
  for(const field of requiredStrings)if(typeof row[field]!=='string')throw invalid('CATALOG_INVALID_DATA');
  for(const field of ['make','group','model','market','sourceId','sourceUrl','evidenceStatus','recordType'])if(!row[field].trim())throw invalid('CATALOG_INVALID_DATA');
  if(row.model_year!==row.modelYear||row.source_url!==row.sourceUrl||row.verification!==row.evidenceStatus||row.source!==row.sourceId)throw invalid('CATALOG_INVALID_DATA');
  if(!isObject(row.qualifiers))throw invalid('CATALOG_INVALID_DATA');
  jsonSafe(row);
 }
 function checkDocument(data){
  if(!isObject(data)||data.schemaVersion!==1||data.catalogVersion!==VERSION||!isObject(data.counts)||data.counts.records!==COUNT||!Array.isArray(data.records)||data.records.length!==COUNT)throw invalid('CATALOG_INVALID_DATA');
  if(data.selectionPolicy?.mode!=='replace_legacy_catalog'||data.selectionPolicy.allResearchObservationsIncluded!==true||data.recordFilteringApplied!==false||data.identity?.idEqualsResearchId!==true||data.identity.fiveFieldDeduplication!==false)throw invalid('CATALOG_INVALID_DATA');
  const seen=new Set(),markets=Object.create(null);
  for(const row of data.records){checkRow(row);if(seen.has(row.id))throw invalid('CATALOG_DUPLICATE_ID');seen.add(row.id);markets[row.market]=(markets[row.market]||0)+1;}
  if(canonical(markets)!==canonical(data.counts.byMarket))throw invalid('CATALOG_INVALID_MARKET_COUNTS');
  return data;
 }
 function valueLabel(value){
  if(Array.isArray(value))return value.map(valueLabel).filter(Boolean).join('/');
  if(isObject(value))return Object.keys(value).sort().map(key=>key+': '+valueLabel(value[key])).join(', ');
  if(value===true)return '있음';if(value===false)return '없음';return text(value);
 }
 function baseLabel(row){
  const base=row.grade||row.subgrade?[row.grade,row.subgrade].filter(Boolean).join(' · '):'트림명 미기재';
  const context=[],seen=new Set([base]);
  const add=value=>{value=text(value);if(value&&!seen.has(value)){seen.add(value);context.push(value);}};
  if(row.modelYear)add('연식 '+row.modelYear);
  for(const field of ['fuel','engine','drivetrain','transmission'])add(row[field]);
  if(row.market!=='KR')add(row.market==='GLOBAL'?'해외 참고':'시장 '+row.market);
  if(row.sourceMarket)add('원문 시장 '+row.sourceMarket);
  for(const [field,label]of [['optionPackage','선택품목'],['powertrainChoice','동력계 선택'],['seatLayout','좌석'],['seatingCapacity','인승'],['bodyStyle','차체'],['batteryRange','배터리 사양'],['availability','판매 정보'],['sourcePeriod','자료 시점'],['sourcePublicationDate','발행'],['sourceTimelineYear','소개 연도'],['trimStatus','등급 상태'],['launchStatus','출시 상태']])if(text(row[field]))add(label+' '+contextLabel(field,row[field]));
  for(const key of Object.keys(row.qualifiers).sort()){
   if(proofQualifiers.has(key))continue;
   const value=row.qualifiers[key];if(value===null||value===''||(Array.isArray(value)&&value.length===0))continue;
   if(key==='publicationDate'&&value===row.sourcePublicationDate)continue;
   if(key==='officialImportStatus'&&value==='not_confirmed'){add('공식 수입 미확인');continue;}
   const rendered=typeof value==='string'&&Object.prototype.hasOwnProperty.call(contextValues,value)?contextValues[value]:valueLabel(value);if(!rendered)continue;
   if(typeof value==='string'&&(base.includes(rendered)||row.model.includes(rendered)))continue;
   add((qualifierNames[key]||key)+' '+rendered);
  }
  if(['engine_option','published_powertrain_option','powertrain_option_variant'].includes(row.recordType))add('동력계 선택 자료');
  if(row.recordType==='named_model_variant')add('차명 사양 자료');
  return base+(context.length?' — '+context.join(' · '):'');
 }
 function buildLabels(rows){
  const result=new Map(),collisions=new Map();
  for(const row of rows){const label=baseLabel(row),key=JSON.stringify([row.make,row.group,row.model,label]);result.set(row.id,label);if(!collisions.has(key))collisions.set(key,[]);collisions.get(key).push(row.id);}
  // This groups display collisions only. No source row or ID is merged.
  for(const ids of collisions.values())if(ids.length>1)ids.forEach((id,index)=>result.set(id,result.get(id)+' · 관측 자료 '+(index+1)));
  return result;
 }
 function reference(value){
  const row=record(value);if(!row)return null;
  const result={datasetVersion,researchId:row.researchId};
  for(const field of referenceFields)if(Object.prototype.hasOwnProperty.call(row,field))result[field]=clone(row[field]);
  return result;
 }
 async function load(){
  let response,raw,data;
  try{response=await root.fetch(URL,{credentials:'same-origin',cache:'no-cache',headers:{Accept:'application/json'}});if(!response?.ok)throw invalid('CATALOG_LOAD_FAILED');raw=await response.text();data=checkDocument(JSON.parse(raw));}
  catch(error){if(error?.code)throw error;throw invalid('CATALOG_LOAD_FAILED');}
  if(!root.crypto?.subtle||typeof root.TextEncoder!=='function')throw invalid('CATALOG_INTEGRITY_UNAVAILABLE');
  const digest=await root.crypto.subtle.digest('SHA-256',new root.TextEncoder().encode(raw));
  const hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  const next=freeze(data.records);byId=new Map(next.map(row=>[row.id,row]));list=next;labels=buildLabels(next);datasetVersion=data.catalogVersion;manifestHash=hash;
  if(root.document?.dispatchEvent&&typeof root.CustomEvent==='function')root.document.dispatchEvent(new root.CustomEvent('snote:catalog-ready',{detail:freeze({datasetVersion,version:datasetVersion,entryCount:list.length,manifestSha256:manifestHash})}));
  return api;
 }
 function checkServer(data){
  if(!isObject(data)||data.dataset_version!==datasetVersion||data.manifest_sha256!==manifestHash||!HEX.test(data.manifest_sha256)||data.entry_count!==list.length||!Array.isArray(data.entries)||data.entries.length!==list.length)throw invalid('CATALOG_SERVER_MISMATCH');
  const seen=new Set();
  for(const row of data.entries){
   try{checkRow(row);}catch(_){throw invalid('CATALOG_SERVER_MISMATCH');}const original=byId.get(row.id);
   if(!original||seen.has(row.id)||canonical(row)!==canonical(original))throw invalid('CATALOG_SERVER_MISMATCH');seen.add(row.id);
  }
  if(seen.size!==list.length)throw invalid('CATALOG_SERVER_MISMATCH');
  return freeze({datasetVersion,manifestSha256:manifestHash,entryCount:list.length,source:'server-verified'});
 }
 function refreshFromServer(readFn,contextKey){
  if(typeof readFn!=='function')return Promise.reject(invalid('CATALOG_INVALID_READER'));
  const keyed=contextKey!==undefined&&contextKey!==null;
  if(keyed&&(typeof contextKey!=='string'||!contextKey))return Promise.reject(invalid('CATALOG_INVALID_CONTEXT'));
  const key=keyed?contextKey:readFn,pending=keyed?pendingKeys:pendingFunctions,verified=keyed?verifiedKeys:verifiedFunctions;
  if(verified.has(key))return Promise.resolve(verified.get(key));if(pending.has(key))return pending.get(key);
  const task=ready.then(async()=>checkServer(await readFn()));pending.set(key,task);
  task.then(result=>{pending.delete(key);verified.set(key,result);if(keyed&&verifiedKeys.size>32)verifiedKeys.delete(verifiedKeys.keys().next().value);},()=>pending.delete(key));
  return task;
 }
 const api={rows:()=>list.slice(),get:record,record,version:()=>datasetVersion,manifestSha256:()=>manifestHash,choiceLabel:value=>{const row=record(value);return row?labels.get(row.id):'';},reference,refreshFromServer};
 const ready=load();api.ready=ready;root.SnoteVehicleCatalog=Object.freeze(api);
 // Consumers can await the original rejecting promise without an early global
 // unhandled-rejection event while the remaining deferred scripts initialize.
 ready.catch(()=>{});
})(typeof window!=='undefined'?window:globalThis);
