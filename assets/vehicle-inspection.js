/* Loaded on first use. Checklist/notes stay in memory and never enter a vehicle record. */
(()=>{'use strict';
 if(window.SnoteVehicleInspection)return;
 const sources=[
  {name:'자동차365 · 구매 가이드',url:'https://www.car365.go.kr/ccpt/schdcar/trde/prchsGuide.do'},
  {name:'소비자원 · 구매 전 확인',url:'https://www.kca.go.kr/kca/sub.do?cate=00000051&menukey=5293&mode=view&no=1003690788'},
  {name:'TS · 침수정보 조회 범위',url:'https://main.kotsa.or.kr/portal/bbs/report_view.do?bbscSeqn=18656&menuCode=05010200'},
  {name:'카히스토리 · 조회 한계',url:'https://www.carhistory.or.kr/guide/sample.page'},
  {name:'현대 · 타이어 점검',url:'https://ownersmanual.hyundai.com/full_webhelp/AX/2026/ko_KR/id23C5GI0A04Y.html'},
  {name:'기아 · 냉각수 안전',url:'https://ownersmanual.kia.com/full_webhelp/TK1/2026/ko_KR/topics/t00933.html'},
  {name:'기아 · 고전압 안전',url:'https://ownersmanual.kia.com/full_webhelp/DL3KH/2026/ko_KR/topics/chapter1_3_1.html'},
  {name:'현대 · 경고등 안내',url:'https://ownersmanual.hyundai.com/full_webhelp/GN7/2026/ko_KR/warning_indicator_lights.html'}
 ];
 // Original observation sequence, paraphrased from the official references above.
 // An observed item never certifies roadworthiness, accident history or flood history.
 const stages=[
  {id:'records',name:'기본 정보',caption:'서류 · 이력',title:'차량과 서류부터 맞춰보세요',intro:'차량을 보기 전, 확인할 자료를 한곳에 모으세요.',hint:'숫자나 내용이 다르면 이유와 증빙을 확인한 뒤 결정을 진행하세요.',drawing:'records',points:[
   {id:'identity',title:'차량번호 · 차대번호',how:'등록증·성능점검기록부의 번호와 실차를 비교하세요. 차대번호 위치는 차종 매뉴얼에서 확인해요.',review:'번호가 다르거나 원본을 확인할 수 없으면 설명과 증빙을 요청하세요.'},
   {id:'mileage',title:'주행거리 · 점검 기록',how:'계기판 주행거리와 점검·정비 기록을 나란히 비교하고, 기록의 날짜도 살펴보세요.',review:'주행거리나 기록이 맞지 않으면 변경 이유를 먼저 확인하세요.'},
   {id:'history',title:'등록원부 · 사고 · 침수 이력',how:'압류·저당, 점검일, 보증 범위·기간을 확인하고 조회 이력과 실차를 함께 보세요.',review:'조회 내역이 없다고 무사고·무침수가 보장되지는 않아요.'}
  ]},
  {id:'body',name:'외관',caption:'차체 · 유리',title:'차체를 한 바퀴 둘러보세요',intro:'밝은 곳에서 양쪽을 같은 순서로 살펴보세요.',hint:'색 차이나 한 가지 흔적만으로 사고를 단정하지 마세요. 기록과 함께 확인해요.',drawing:'body',points:[
   {id:'surface',title:'차체 표면 · 유리',how:'도장 색 차이, 흠집·찌그러짐, 유리의 균열을 보이는 위치별로 기록하세요.',review:'균열이나 눈에 띄는 손상이 있으면 수리 여부와 상태를 확인받으세요.'},
   {id:'opening',title:'문 · 보닛 · 트렁크',how:'무리한 힘 없이 열고 닫아보고, 좌우 틈과 닫히는 느낌을 비교하세요.',review:'잘 닫히지 않거나 좌우 차이가 크면 원인을 확인받으세요.'},
   {id:'record-match',title:'교환 · 수리 표기와 대조',how:'점검기록부에 교환·수리가 표시된 부위를 실차에서 찾아 비교하세요.',review:'기록과 다르거나 설명이 어려운 부위는 전문점 확인을 요청하세요.'}
  ]},
  {id:'tires',name:'타이어 · 하부',caption:'마모 · 흔적',title:'네 바퀴를 비교해보세요',intro:'직접 보이는 부분에서 시작하세요.',hint:'차량 아래로 들어가지 말고, 보이지 않는 곳은 전문점에서 확인하세요.',drawing:'tires',points:[
   {id:'rubber',title:'타이어 표기 · 마모 · 손상',how:'네 바퀴의 옆면 규격·제조 표기, 마모 상태와 좌우 차이를 비교하세요.',review:'심한 마모, 찢김, 부풀음이 보이면 시운전 전에 정비점 판단을 받으세요.'},
   {id:'wheel-floor',title:'휠 · 주차 바닥',how:'휠 손상과 차량을 세워둔 바닥의 액체 자국을 사진으로 남기세요.',review:'액체의 종류나 원인은 사진만으로 확정하지 말고 확인받으세요.'},
   {id:'underbody',title:'안 보이는 하부는 점검 의뢰',how:'하부 누유·부식·구조와 배터리 하우징 등은 정비소 리프트에서 확인받으세요.',review:'잭만 받친 차량 밑으로 들어가거나 손을 넣지 마세요.'}
  ]},
  {id:'engine',name:'엔진룸',caption:'정차 · 냉간',title:'충분히 식은 상태에서 살펴보세요',intro:'손대거나 분해하지 않고 눈으로 확인하세요.',hint:'뜨거운 냉각수 캡을 열지 마세요. 팬·벨트와 전기차 고전압 장치에 손대지 마세요.',drawing:'engine',points:[
   {id:'visible',title:'눈에 보이는 흔적 · 파손',how:'식은 차량의 보닛을 열고 액체 흔적, 파손과 경고 표기를 사진으로 남기세요.',review:'수증기·연기·강한 연료 냄새가 나면 접근과 시동을 멈추고 지원을 요청하세요.'},
   {id:'coolant',title:'냉각수 보조탱크 표시선',how:'차종 매뉴얼에서 위치를 찾고, 차가운 상태에서 탱크 밖의 표시선만 보세요.',review:'캡을 열거나 보충하지 마세요. 확인이 어렵거나 수위가 다르면 정비점에 문의하세요.'},
   {id:'high-voltage',title:'전기차 · 하이브리드',how:'해당 차량이면 경고 표시, 충전 관련 기록과 정비 진단자료를 확인하세요.',review:'주황색 고전압 케이블·부품은 만지지 마세요. 손상이 보이면 점검을 맡기세요.'}
  ]},
  {id:'cabin',name:'실내 · 전장',caption:'조작 · 작동',title:'자주 쓰는 기능을 하나씩 확인하세요',intro:'안전하게 정차한 상태에서 조작하세요.',hint:'기능이 있는 차량인지 먼저 확인하고, 작동은 차종 매뉴얼을 따르세요.',drawing:'cabin',points:[
   {id:'controls',title:'벨트 · 잠금 · 창문 · 좌석',how:'안전벨트, 문잠금, 창문, 미러, 좌석과 공조를 하나씩 작동해보세요.',review:'미작동하거나 걸리는 부분이 있으면 위치와 조건을 남겨 확인받으세요.'},
   {id:'electric',title:'등화 · 와이퍼 · 화면',how:'등화, 방향지시등, 와이퍼와 장착된 카메라·화면을 확인하세요. 주변 사람의 위치도 살펴요.',review:'깜빡임·미작동·화면 오류가 반복되면 점검을 요청하세요.'},
   {id:'interior',title:'냄새 · 습기 · 오염',how:'실내 냄새, 습기, 부식이나 오염을 기록하고 차량 이력과 함께 확인하세요.',review:'냄새나 부식 하나로 침수를 단정하지 말고 추가 점검을 받으세요.'}
  ]},
  {id:'start',name:'시동 · 계기판',caption:'경고등 · 반응',title:'시동 전후의 상태를 나눠보세요',intro:'계기판 표시와 소리, 반응을 함께 기록하세요.',hint:'경고등 의미와 정상 점등 순서는 차종마다 달라요. 해당 매뉴얼을 함께 확인하세요.',drawing:'start',points:[
   {id:'before-after',title:'시동 전후 표시',how:'정차한 상태에서 시동 전후의 계기판과 주행거리를 촬영해 비교하세요.',review:'경고가 반복되면 어떤 조건에서 켜지는지 기록해 진단을 요청하세요.'},
   {id:'warning',title:'지속되는 안전 관련 경고',how:'꺼지지 않는 경고는 모양과 내용을 차종 매뉴얼에서 찾아 확인하세요.',review:'브레이크·오일압력 등 운행 안전 관련 경고가 지속되면 시운전을 보류하세요.'},
   {id:'reaction',title:'소음 · 진동 · 냄새',how:'평소와 다르게 느껴지는 소리·진동·냄새를 발생 조건과 함께 적어두세요.',review:'경고를 지우거나 배터리를 분리해 숨기지 말고 정비점에서 확인받으세요.'}
  ]},
  {id:'finish',name:'주행 · 정리',caption:'안전 · 재확인',title:'기록을 모으고 확인을 마무리하세요',intro:'주행 확인이 필요하면 적법하고 안전한 조건부터 확인하세요.',hint:'운전 중에는 이 화면을 조작하지 말고, 안전하게 정차한 뒤 기록하세요.',drawing:'finish',points:[
   {id:'permission',title:'시운전 전 조건',how:'판매자 허락, 면허·보험·차량 경고를 확인하고 합법적이고 안전한 경로에서만 진행하세요.',review:'안전 조건을 확인하지 못했다면 시운전하지 말고 동승·점검을 문의하세요.'},
   {id:'driving',title:'출발 · 정지 · 조향 · 변속',how:'평상 조작 범위에서 확인하세요. 쏠림·진동·소음은 안전하게 정차한 뒤 기록해요.',review:'제동·조향 이상, 경고·과열·연기가 있으면 안전하게 멈추고 정비 지원을 요청하세요.'},
   {id:'handover',title:'미확인 항목 · 약정 정리',how:'미확인 항목과 점검 증빙·정비견적을 모으고, 합의한 내용은 계약서에 적어두세요.',review:'고속·급제동·핸들 놓기 시험은 하지 마세요. 체크 완료도 무결함 보증은 아니에요.'}
  ]}
 ];
 const states=[{id:'pending',label:'미확인'},{id:'checked',label:'확인'},{id:'review',label:'추가 확인'}];
 let host=null,scope='',selected=0,focused=0,notes=Object.create(null),checks=Object.create(null),controller=null,sequence=0,resizeObserver=null;
 let learning=[],learningSignature='',learningMode='check',photoFilter='all',lessonId='',photoZoom=null;
 const icons={car:'M4 16V9l3-5h10l3 5v7M4 10h16M4 16H2v3h4v-3m12 0v3h4v-3h-2M7 13h1m8 0h1M4 16h16',check:'m6 12 4 4 8-8',chevron:'m7 10 5 5 5-5',back:'m14 6-6 6 6 6',next:'m10 6 6 6-6 6',info:'M12 8h.01M12 11v6M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0',warn:'m12 3 10 18H2L12 3Zm0 5v6m0 3h.01',external:'M14 3h7v7m0-7L11 13M10 5H3v16h16v-7'};
 const svgNS='http://www.w3.org/2000/svg';
 const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;return el;};
 const svgNode=(tag,attrs={})=>{const el=document.createElementNS(svgNS,tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,String(v));return el;};
 function icon(name){const svg=svgNode('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.6,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'});svg.append(svgNode('path',{d:icons[name]||icons.info}));return svg;}
 const pointKey=(stage,point)=>stage.id+':'+point.id;
 const pointState=(stage,point)=>checks[pointKey(stage,point)]||'pending';
 const count=()=>{let checked=0,review=0,total=0;for(const stage of stages)for(const point of stage.points){total++;const value=pointState(stage,point);if(value==='checked')checked++;if(value==='review')review++;}return{checked,review,total,done:checked+review};};
 const live=()=>!!host?.isConnected&&!!scope;
 function currentScope(value){if(typeof value==='function'){try{return String(value()||'');}catch{return'';}}return String(value||'');}
 function allowed(){if(!live())return false;try{if(controller?.isCurrent&&controller.isCurrent(scope)!==true){clear();return false;}}catch{clear();return false;}return true;}
 const usable=element=>allowed()&&host.contains(element);
 function orientation(){const tabs=host?.querySelector('.snote-inspection-steps');if(tabs)tabs.setAttribute('aria-orientation',host.clientWidth<=740?'horizontal':'vertical');}
 const plain=(value,max)=>typeof value==='string'&&value.trim()&&value.trim().length<=max?value.trim():'';
 const localPhoto=value=>typeof value==='string'&&/^\/?assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp|avif)$/i.test(value)?value:'';
 function learningLessons(value){
  if(value?.version!==1||!Array.isArray(value.lessons))return[];const seen=new Set(),valid=[];
  for(const lesson of value.lessons.slice(0,120)){
   if(!lesson||typeof lesson!=='object')continue;
   const id=plain(lesson.id,80),stageId=plain(lesson.stageId,30),label=plain(lesson.label,120),description=plain(lesson.description,1600),src=localPhoto(lesson.image?.src),alt=plain(lesson.image?.alt,240),width=lesson.image?.width,height=lesson.image?.height,title=plain(lesson.source?.title,200);
   if(!/^[a-z0-9][a-z0-9-]*$/.test(id)||seen.has(id)||!stages.some(stage=>stage.id===stageId)||!label||!description||!src||!alt||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>20000||height>20000||!title||!Array.isArray(lesson.observations))continue;
   const observations=[];
   for(const point of lesson.observations.slice(0,12)){const name=plain(point?.label,100),text=plain(point?.description,800);if(!name||!text)continue;const x=point.x,y=point.y,position=Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&x<=100&&y>=0&&y<=100?{x,y}:{};observations.push({label:name,description:text,...position});}
   if(!observations.length)continue;
   let url='';try{const candidate=new URL(lesson.source?.url);if(candidate.protocol==='https:'&&!candidate.username&&!candidate.password)url=candidate.href;}catch{}
   const page=Number.isInteger(lesson.source?.page)&&lesson.source.page>0?lesson.source.page:null;
   seen.add(id);valid.push({id,stageId,label,description,image:{src,alt,width,height},observations,source:{title,url,page}});
  }
  return valid;
 }
 function closePhoto(){const lease=photoZoom;photoZoom=null;const replaced=!!lease?.monitor?.takeRecords().length;lease?.monitor?.disconnect();if(lease&&!replaced&&document.getElementById('zoom-image')?.getAttribute('src')===lease.src)window.SnoteVehicleImageViewer?.close?.({restoreFocus:false});}
 function photoView(){
  if(!allowed()||!learning.length||learningMode!=='photos')return;const view=host.querySelector('[data-inspection-photo-view]');if(!view)return;closePhoto();view.replaceChildren();
  const available=photoFilter==='all'?learning:learning.filter(lesson=>lesson.stageId===photoFilter);if(!available.length){photoFilter='all';return photoView();}
  let lesson=available.find(item=>item.id===lessonId)||available[0];lessonId=lesson.id;
  const filters=node('div',null,'snote-inspection-photo-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','사진 확인 단계');
  for(const option of[{id:'all',name:'전체'},...stages.filter(stage=>learning.some(item=>item.stageId===stage.id))]){const button=node('button',option.name);button.type='button';button.dataset.inspectionPhotoFilter=option.id;button.setAttribute('aria-pressed',String(photoFilter===option.id));button.onclick=()=>{if(!usable(button))return;photoFilter=option.id;photoView();};filters.append(button);}
  const layout=node('div',null,'snote-inspection-photo-layout'),list=node('div',null,'snote-inspection-photo-list');list.setAttribute('role','group');list.setAttribute('aria-label','학습 사진 선택');
  for(const[itemAt,item]of available.entries()){const button=node('button',null,'snote-inspection-photo-thumb');button.type='button';button.dataset.inspectionPhoto=item.id;button.setAttribute('aria-pressed',String(item.id===lesson.id));const image=node('img');image.src=item.image.src;image.alt='';image.width=item.image.width;image.height=item.image.height;image.loading='lazy';image.decoding='async';image.onerror=()=>{if(usable(image))image.hidden=true;};button.append(image,node('span',item.label));const selectPhoto=id=>{if(!usable(button))return;lessonId=id;photoView();view.querySelector('[data-inspection-photo="'+id+'"]')?.focus({preventScroll:true});};button.onclick=()=>selectPhoto(item.id);button.onkeydown=event=>{let to;if(event.key==='ArrowRight'||event.key==='ArrowDown')to=(itemAt+1)%available.length;else if(event.key==='ArrowLeft'||event.key==='ArrowUp')to=(itemAt+available.length-1)%available.length;else if(event.key==='Home')to=0;else if(event.key==='End')to=available.length-1;else return;event.preventDefault();selectPhoto(available[to].id);};list.append(button);}
  const detail=node('article',null,'snote-inspection-photo-detail'),title=node('h3',lesson.label),description=node('p',lesson.description,'snote-inspection-photo-description');title.id='snote-inspection-photo-label';
  const figure=node('figure',null,'snote-inspection-photo-figure'),imageArea=node('div',null,'snote-inspection-photo-image'),expand=node('button',null,'snote-inspection-photo-expand');imageArea.style.maxWidth=Math.min(780,Math.round(520*lesson.image.width/lesson.image.height))+'px';expand.type='button';expand.setAttribute('aria-label',lesson.label+' 사진 확대');
  const image=node('img');image.src=lesson.image.src;image.alt=lesson.image.alt;image.width=lesson.image.width;image.height=lesson.image.height;image.decoding='async';expand.append(image);imageArea.append(expand);
  const observationList=node('ol',null,'snote-inspection-photo-observations');let chosen=0;
  function choose(index){if(!usable(imageArea))return;chosen=index;for(const item of observationList.children)item.classList.toggle('is-focused',Number(item.dataset.inspectionObservation)===index);for(const button of imageArea.querySelectorAll('[data-inspection-photo-point]'))button.setAttribute('aria-pressed',String(Number(button.dataset.inspectionPhotoPoint)===index));}
  for(const[index,point]of lesson.observations.entries()){
   const item=node('li');item.dataset.inspectionObservation=String(index);const button=node('button',null,'snote-inspection-photo-observation');button.type='button';button.append(node('span',String(index+1)),node('strong',point.label));button.onclick=()=>{if(usable(button))choose(index);};item.append(button,node('p',point.description));observationList.append(item);
   if(point.x!=null&&point.y!=null){const hotspot=node('button',String(index+1),'snote-inspection-photo-point');hotspot.type='button';hotspot.dataset.inspectionPhotoPoint=String(index);hotspot.style.left=point.x+'%';hotspot.style.top=point.y+'%';hotspot.setAttribute('aria-label',point.label+' 설명 보기');hotspot.setAttribute('aria-pressed',String(chosen===index));hotspot.onclick=()=>{if(usable(hotspot))choose(index);};imageArea.append(hotspot);}
  }
  expand.onclick=()=>{if(!usable(expand))return;const viewer=window.SnoteVehicleImageViewer;if(viewer?.open){closePhoto();const lease={src:lesson.image.src,monitor:null};photoZoom=lease;void viewer.open({src:lease.src,origin:expand,alt:lesson.image.alt,isCurrent:()=>photoZoom===lease&&usable(expand)&&learningMode==='photos'&&lessonId===lesson.id,download:()=>{if(photoZoom!==lease||!usable(expand))return;const anchor=node('a');anchor.href=lease.src;anchor.download=lease.src.split('/').at(-1);document.body.append(anchor);anchor.click();anchor.remove();}});const picture=document.getElementById('zoom-image');if(picture&&photoZoom===lease){lease.monitor=new MutationObserver(()=>{lease.monitor.disconnect();if(photoZoom===lease)photoZoom=null;});lease.monitor.observe(picture,{attributes:true,attributeFilter:['src']});}}else{const expanded=figure.classList.toggle('is-expanded');expand.setAttribute('aria-expanded',String(expanded));expand.setAttribute('aria-label',lesson.label+' 사진 '+(expanded?'축소':'확대'));}};
  expand.onkeydown=event=>{if(event.key!=='Escape'||!usable(expand)||!figure.classList.contains('is-expanded'))return;event.preventDefault();event.stopPropagation();figure.classList.remove('is-expanded');expand.setAttribute('aria-expanded','false');expand.setAttribute('aria-label',lesson.label+' 사진 확대');};
  const caption=node('figcaption','사진을 누르면 확대해서 볼 수 있어요.');figure.append(imageArea,caption);
  image.onerror=()=>{if(!usable(expand))return;closePhoto();imageArea.replaceChildren();const status=node('div',null,'snote-inspection-photo-error');status.setAttribute('role','status');status.append(node('p','사진을 불러오지 못했습니다.'));const retry=node('button','다시 불러오기');retry.type='button';retry.onclick=()=>{if(usable(retry))photoView();};status.append(retry);imageArea.append(status);caption.textContent='다시 불러오기를 눌러 원본 사진을 확인하세요.';};
  const source=node('div',null,'snote-inspection-photo-source'),sourceTitle=lesson.source.title+(lesson.source.page?' · '+lesson.source.page+'쪽':'');if(lesson.source.url){const link=node('a',sourceTitle);link.href=lesson.source.url;link.target='_blank';link.rel='noopener noreferrer';source.append(link);}else source.textContent=sourceTitle;
  detail.append(title,description,figure,observationList,source);layout.append(list,detail);view.append(filters,layout);choose(0);
 }
 function photoModes(checkView){
  if(!learning.length)return;const tabs=node('div',null,'snote-inspection-modes');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','검수 학습 방식');const photos=node('section');photos.dataset.inspectionPhotoView='';photos.id='snote-inspection-photo-view';photos.setAttribute('role','tabpanel');photos.setAttribute('aria-labelledby','snote-inspection-mode-photos');checkView.id='snote-inspection-check-view';checkView.setAttribute('role','tabpanel');checkView.setAttribute('aria-labelledby','snote-inspection-mode-check');
  function select(mode,focus=false){if(!allowed())return;closePhoto();learningMode=mode;checkView.hidden=mode!=='check';photos.hidden=mode!=='photos';for(const button of tabs.children){const active=button.dataset.inspectionMode===mode;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;if(active&&focus)button.focus();}if(mode==='photos')photoView();}
  for(const[id,label]of[['check','검수 체크'],['photos','사진으로 배우기']]){const button=node('button',label);button.type='button';button.dataset.inspectionMode=id;button.id='snote-inspection-mode-'+id;button.setAttribute('role','tab');button.setAttribute('aria-controls',id==='check'?checkView.id:photos.id);button.onclick=()=>{if(usable(button))select(id);};button.onkeydown=event=>{if(!usable(button)||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();select(event.key==='Home'?'check':event.key==='End'?'photos':id==='check'?'photos':'check',true);};tabs.append(button);}
  host.prepend(tabs);host.append(photos);select(learningMode);
 }
 function shape(parent,tag,attrs){const el=svgNode(tag,attrs);parent.append(el);return el;}
 function art(kind){
  const svg=svgNode('svg',{viewBox:'0 0 330 230',fill:'none','aria-label':'위치 안내용 '+stages.find(s=>s.drawing===kind)?.name+' 도식',role:'group'});
  const lines=shape(svg,'g',{stroke:'#92abc0','stroke-width':2,'stroke-linecap':'round','stroke-linejoin':'round'});
  const wheels=()=>{for(const x of[80,246]){shape(lines,'circle',{cx:x,cy:162,r:23,fill:'#f7fbfe'});shape(lines,'circle',{cx:x,cy:162,r:12,fill:'#e5eff7'});}};
  const car=()=>{shape(lines,'path',{d:'M37 157v-30l15-15 32-8 38-39h85l43 39 34 10 14 18v25h-29a25 25 0 0 0-48 0H105a25 25 0 0 0-48 0H37Z',fill:'#e4f2fc'});shape(lines,'path',{d:'m102 103 29-28h68l31 28H102Z',fill:'#fff'});shape(lines,'path',{d:'M165 76v78m-48-38h16m48 0h16M39 133h13m231 0h13M109 145h110'});wheels();};
  let spots=[[82,83],[170,104],[259,123]];
  if(kind==='records'){
   shape(lines,'rect',{x:71,y:39,width:146,height:150,rx:9,fill:'#fff'});shape(lines,'path',{d:'M97 67h90M97 84h64M97 120h57M97 139h71M97 157h48',stroke:'#b6c9d9'});shape(lines,'rect',{x:96,y:97,width:91,height:16,rx:4,fill:'#e4f2fc',stroke:'#80bfe8'});shape(lines,'rect',{x:170,y:130,width:96,height:56,rx:9,fill:'#f3f9fd'});shape(lines,'path',{d:'M185 149h64M185 165h41'});spots=[[198,58],[220,154],[97,151]];
  }else if(kind==='tires'){
   shape(lines,'ellipse',{cx:160,cy:115,rx:57,ry:80,fill:'#e5eff7'});shape(lines,'ellipse',{cx:179,cy:115,rx:46,ry:78,fill:'#f9fcff'});shape(lines,'ellipse',{cx:179,cy:115,rx:27,ry:49});shape(lines,'path',{d:'m172 76 15 77m8-74-31 70m-9-36h50M129 47l-10 17 8 11-13 19 10 13-15 18 13 11-10 16 12 12m17-124-8 22 8 12-12 19 9 13-12 18 10 11-9 19 10 12',stroke:'#aac1d3'});shape(lines,'path',{d:'M54 198h222',stroke:'#d6e5ef'});spots=[[122,80],[204,139],[245,190]];
  }else if(kind==='engine'){
   shape(lines,'path',{d:'m66 74 22-39h155l23 39M56 80h219l15 122H40L56 80Z',fill:'#e4f2fc'});shape(lines,'rect',{x:113,y:107,width:100,height:68,rx:9,fill:'#f9fcff'});shape(lines,'path',{d:'M131 99v-9h65v9m-57 32h50m-50 15h50M58 181h214'});shape(lines,'rect',{x:62,y:104,width:36,height:48,rx:6,fill:'#f9fcff'});shape(lines,'path',{d:'M70 98v12m18-12v12M235 112h30v44h-30z',fill:'#f9fcff'});spots=[[80,125],[165,143],[251,130]];
  }else if(kind==='cabin'){
   shape(lines,'path',{d:'M44 134V90l22-37h195l26 37v44M44 97h243M79 60l-12 31h196l-15-31',fill:'#e4f2fc'});shape(lines,'rect',{x:154,y:111,width:69,height:39,rx:5,fill:'#fff'});shape(lines,'path',{d:'M166 120h46m-46 8h31m-31 9h46M183 160v38m-30 0h60M47 170l11 30h63l9-30-13-24H64l-17 24Zm183 0-11 30h63l9-30-13-24h-31l-17 24Z',fill:'#f9fcff'});shape(lines,'circle',{cx:95,cy:125,r:25,fill:'#f9fcff'});shape(lines,'path',{d:'M71 122h48m-25 2v25'});spots=[[94,124],[189,126],[249,182]];
  }else if(kind==='start'){
   shape(lines,'path',{d:'M44 149c0-60 44-98 121-98s121 38 121 98v26H44v-26Z',fill:'#e4f2fc'});shape(lines,'circle',{cx:109,cy:120,r:37,fill:'#fff'});shape(lines,'circle',{cx:222,cy:120,r:37,fill:'#fff'});shape(lines,'path',{d:'m109 120 19-19m94 19-14-25M86 119h5m18-25v5m19 18h5m65 0h5m19-25v5m20 20h5'});shape(lines,'rect',{x:151,y:143,width:32,height:18,rx:4,fill:'#fff'});shape(lines,'path',{d:'M153 97h27m-22 12h16'});spots=[[78,82],[167,103],[244,143]];
  }else{car();if(kind==='finish'){shape(lines,'path',{d:'M22 203h286m-225 0h32m47 0h32m46 0h32',stroke:'#cbdde9'});spots=[[80,125],[172,64],[266,161]];}}
  const guide=shape(svg,'path',{d:'M52 208h226',stroke:'#80caff','stroke-width':1.5,'stroke-dasharray':'3 7',class:'inspection-observation-line'});guide.setAttribute('aria-hidden','true');
  const layer=shape(svg,'g',{});const stage=stages.find(s=>s.drawing===kind);
  for(let i=0;i<stage.points.length;i++){
   const[x,y]=spots[i]||spots[2],group=shape(layer,'g',{'data-inspection-hotspot':i,role:'button',tabindex:0,'aria-label':(i+1)+'. '+stage.points[i].title,'aria-pressed':String(focused===i)});
   shape(group,'circle',{cx:x,cy:y,r:15});const label=shape(group,'text',{x,y});label.textContent=String(i+1);
  }
  return svg;
 }
 function setPointFocus(index,{scroll=false}={}){
  if(!allowed())return;focused=index;
  host.querySelectorAll('[data-inspection-check]').forEach(el=>el.classList.toggle('is-focused',Number(el.dataset.inspectionCheck)===index));
  host.querySelectorAll('[data-inspection-hotspot]').forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.inspectionHotspot)===index)));
  if(scroll)host.querySelector('[data-inspection-check="'+index+'"]')?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});
 }
 function progress(){
  if(!allowed())return;const result=count(),bar=host.querySelector('[data-inspection-progress]'),text=host.querySelector('[data-inspection-count]');
  if(bar){bar.style.width=(result.total?result.done/result.total*100:0)+'%';bar.parentElement.setAttribute('aria-valuenow',String(result.done));bar.parentElement.setAttribute('aria-valuemax',String(result.total));bar.parentElement.setAttribute('aria-valuetext',result.done+'개 기록, 추가 확인 '+result.review+'개');}
  if(text)text.textContent=result.done+' / '+result.total;
  for(const[index,stage]of stages.entries()){
   const values=stage.points.map(point=>pointState(stage,point)),dot=host.querySelector('[data-inspection-status="'+index+'"]');
   if(dot){dot.classList.toggle('is-done',!!values.length&&values.every(v=>v==='checked'));dot.classList.toggle('is-review',values.includes('review'));}
   const caption=host.querySelector('[data-inspection-step-count="'+index+'"]');if(caption)caption.textContent=stage.caption+' · '+values.filter(v=>v!=='pending').length+'/'+values.length;
  }
  const stage=stages[selected],stageText=host.querySelector('[data-inspection-stage-count]');if(stageText)stageText.textContent=stage.points.filter(point=>pointState(stage,point)!=='pending').length+' / '+stage.points.length+' 기록';
  const output=host.querySelector('[data-inspection-results]');if(!output)return;output.replaceChildren();
  const title=node('div',null,'snote-inspection-results-title');title.append(node('strong','다시 확인할 부분'),node('span',result.review+'개'));output.append(title);
  if(result.review){const list=node('ul',null,'snote-inspection-review-list');for(const[index,item]of stages.entries())for(const[pointAt,point]of item.points.entries())if(pointState(item,point)==='review'){const li=node('li'),button=node('button',item.name+' · '+point.title);button.type='button';button.onclick=()=>{if(!usable(button))return;selectStage(index,true);setPointFocus(pointAt,{scroll:true});};li.append(button);list.append(li);}output.append(list);}
  else output.append(node('p','판단하기 어려운 항목은 ‘추가 확인’으로 남겨두세요.'));
 }
 function selectStage(index,focus=false){
  if(!allowed()||index<0||index>=stages.length)return;selected=index;focused=0;
  for(const[at,button]of Array.from(host.querySelectorAll('[data-inspection-step]')).entries()){const isSelected=at===index;button.setAttribute('aria-selected',String(isSelected));button.tabIndex=isSelected?0:-1;if(isSelected&&focus){button.focus();button.scrollIntoView({block:'nearest',inline:'nearest',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});}}
  const panel=host.querySelector('[data-inspection-panel]');panel.replaceChildren();panel.classList.remove('snote-inspection-panel');void panel.offsetWidth;panel.classList.add('snote-inspection-panel');panel.setAttribute('aria-labelledby','snote-inspection-tab-'+selected);
  const stage=stages[index],header=node('header',null,'snote-inspection-stage-header'),heading=node('div');heading.append(node('span',String(index+1).padStart(2,'0')+' / '+String(stages.length).padStart(2,'0'),'snote-inspection-stage-kicker'),node('h3',stage.title),node('p',stage.intro));const stageCount=node('span','','snote-inspection-stage-count');stageCount.dataset.inspectionStageCount='';header.append(heading,stageCount);
  const body=node('div',null,'snote-inspection-stage-body'),visual=node('div',null,'snote-inspection-visual'),drawing=node('div',null,'snote-inspection-diagram');drawing.append(art(stage.drawing));
  drawing.addEventListener('click',event=>{if(!usable(drawing))return;const target=event.target.closest('[data-inspection-hotspot]');if(target)setPointFocus(Number(target.dataset.inspectionHotspot));});
  drawing.addEventListener('keydown',event=>{if(!usable(drawing)||!['Enter',' '].includes(event.key))return;const target=event.target.closest('[data-inspection-hotspot]');if(target){event.preventDefault();setPointFocus(Number(target.dataset.inspectionHotspot));}});
  const caption=node('p','위치 안내용 도식','snote-inspection-visual-caption');caption.prepend(icon('info'));visual.append(drawing,caption,node('p',stage.hint,'snote-inspection-hint'));
  const checkList=node('div',null,'snote-inspection-checks');
  for(const[pointAt,point]of stage.points.entries()){
   const check=node('section',null,'snote-inspection-check'+(pointAt===focused?' is-focused':''));check.dataset.inspectionCheck=String(pointAt);check.id='snote-inspection-point-'+stage.id+'-'+point.id;
   const title=node('h4',null,'snote-inspection-check-title');title.append(node('span',String(pointAt+1)),node('strong',point.title));check.append(title,node('p',point.how));
   const caution=node('div',null,'snote-inspection-caution');caution.append(icon('warn'),node('span',point.review));check.append(caution);
   const options=node('div',null,'snote-inspection-state');options.setAttribute('role','radiogroup');options.setAttribute('aria-label',point.title+' 확인 상태');
   const choose=(value,focusButton=false)=>{if(!usable(options))return;checks[pointKey(stage,point)]=value;for(const button of options.children){const chosen=button.dataset.state===value;button.setAttribute('aria-checked',String(chosen));button.tabIndex=chosen?0:-1;if(chosen&&focusButton)button.focus();}setPointFocus(pointAt);progress();};
   for(const[stateAt,state]of states.entries()){
    const button=node('button',state.label);button.type='button';button.dataset.state=state.id;button.setAttribute('role','radio');button.setAttribute('aria-checked',String(pointState(stage,point)===state.id));button.tabIndex=pointState(stage,point)===state.id?0:-1;button.onclick=()=>choose(state.id);
    button.onkeydown=event=>{let to;if(event.key==='ArrowRight'||event.key==='ArrowDown')to=(stateAt+1)%states.length;else if(event.key==='ArrowLeft'||event.key==='ArrowUp')to=(stateAt+states.length-1)%states.length;else if(event.key==='Home')to=0;else if(event.key==='End')to=states.length-1;else return;event.preventDefault();choose(states[to].id,true);};options.append(button);
   }
   check.append(options);checkList.append(check);
  }
  body.append(visual,checkList);const note=node('div',null,'snote-inspection-note'),label=node('label',null);label.htmlFor='snote-inspection-note';label.append(node('strong','확인 메모'),node('span','선택 · 현재 접속에서만 유지'));
  const textarea=node('textarea');textarea.id='snote-inspection-note';textarea.maxLength=1200;textarea.placeholder='다시 볼 위치나 전문점에 물어볼 내용을 적어두세요.';textarea.value=notes[stage.id]||'';textarea.addEventListener('input',()=>{if(usable(textarea))notes[stage.id]=textarea.value;});note.append(label,textarea);
  const footer=node('footer',null,'snote-inspection-panel-footer'),previous=node('button','이전');previous.type='button';previous.disabled=index===0;previous.prepend(icon('back'));previous.onclick=()=>{if(usable(previous))selectStage(selected-1,true);};const next=node('button',index===stages.length-1?'확인할 부분 보기':'다음 · '+stages[index+1].name,'snote-inspection-next');next.type='button';next.append(icon('next'));next.onclick=()=>{if(!usable(next))return;if(index===stages.length-1)host.querySelector('[data-inspection-results]')?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});else selectStage(selected+1,true);};footer.append(previous,next);
  panel.append(header,body,note,footer);progress();
 }
 function render(){
  if(!live())return;closePhoto();host.classList.add('snote-inspection');host.replaceChildren();host.dataset.inspectionReady='true';
  const checkView=node('section');checkView.dataset.inspectionCheckView='';host.append(checkView);
  const overview=node('section',null,'snote-inspection-overview');overview.setAttribute('aria-label','검수 진행 상황');const progressCopy=node('div',null,'snote-inspection-progress-copy');progressCopy.append(node('strong','한 단계씩, 빠짐없이'),node('small','‘확인’은 관찰 기록이며 정상 판정은 아니에요.'));const progressArea=node('div',null,'snote-inspection-progress-area'),progressBar=node('div',null,'snote-inspection-progress');progressBar.setAttribute('role','progressbar');progressBar.setAttribute('aria-label','확인한 항목');progressBar.setAttribute('aria-valuemin','0');const progressFill=node('span');progressFill.dataset.inspectionProgress='';progressBar.append(progressFill);const progressCount=node('strong','','snote-inspection-progress-count');progressCount.dataset.inspectionCount='';progressArea.append(progressBar,progressCount);overview.append(progressCopy,progressArea);
  const layout=node('div',null,'snote-inspection-layout'),nav=node('div',null,'snote-inspection-steps');nav.setAttribute('role','tablist');nav.setAttribute('aria-label','차량 확인 단계');nav.setAttribute('aria-orientation',matchMedia('(max-width:760px)').matches?'horizontal':'vertical');
  for(const[index,stage]of stages.entries()){
   const button=node('button',null,'snote-inspection-step');button.type='button';button.dataset.inspectionStep=String(index);button.id='snote-inspection-tab-'+index;button.setAttribute('role','tab');button.setAttribute('aria-controls','snote-inspection-panel');button.setAttribute('aria-selected',String(selected===index));button.tabIndex=selected===index?0:-1;
   const text=node('span',null,'snote-inspection-step-copy'),caption=node('small',stage.caption);caption.dataset.inspectionStepCount=String(index);text.append(node('strong',stage.name),caption);const status=node('span',null,'snote-inspection-step-status');status.dataset.inspectionStatus=String(index);status.setAttribute('aria-hidden','true');button.append(node('span',String(index+1).padStart(2,'0'),'snote-inspection-step-index'),text,status);button.onclick=()=>{if(usable(button))selectStage(index);};
   button.onkeydown=event=>{if(!usable(button))return;let to;if(event.key==='ArrowRight'||event.key==='ArrowDown')to=(index+1)%stages.length;else if(event.key==='ArrowLeft'||event.key==='ArrowUp')to=(index+stages.length-1)%stages.length;else if(event.key==='Home')to=0;else if(event.key==='End')to=stages.length-1;else return;event.preventDefault();selectStage(to,true);};nav.append(button);
  }
  const main=node('div',null,'snote-inspection-main'),panel=node('section',null,'snote-inspection-panel');panel.id='snote-inspection-panel';panel.dataset.inspectionPanel='';panel.setAttribute('role','tabpanel');main.append(panel);layout.append(nav,main);
  const bottom=node('div',null,'snote-inspection-bottom'),results=node('section',null,'snote-inspection-results');results.dataset.inspectionResults='';results.setAttribute('aria-live','polite');const preparation=node('details',null,'snote-inspection-preparation'),summary=node('summary','시작 전에 확인하세요');summary.append(icon('chevron'));const precautions=node('ul');for(const text of['밝고 평평한 곳에 안전하게 정차하고, 차종별 매뉴얼을 준비하세요.','뜨거운 냉각수 캡, 고전압 장치, 안전하게 지지하지 않은 차량 아래는 직접 확인하지 마세요.','한 가지 흔적만으로 사고·침수·고장을 판단하지 말고, 서류와 관찰 결과를 함께 확인하세요.','이 체크는 법정 성능·상태점검이나 전문 진단을 대신하지 않아요.'])precautions.append(node('li',text));preparation.append(summary,precautions);bottom.append(results,preparation);
  checkView.append(overview,layout,bottom);
  if(sources.length){const reference=node('details',null,'snote-inspection-sources'),referenceSummary=node('summary','자료 및 확인 경로');referenceSummary.append(icon('chevron'));const list=node('ul',null,'snote-inspection-source-links');for(const source of sources){const li=node('li'),a=node('a',source.name);a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';a.append(icon('external'));li.append(a);list.append(li);}reference.append(referenceSummary,list,node('p','공개 자료 확인: 2026.11.25 · 해당 차량의 최신 매뉴얼을 함께 확인하세요. 도식은 실제 차량의 구조·상태를 나타내지 않습니다.','snote-inspection-source-note'));checkView.append(reference);}
  checkView.append(node('p','체크와 메모는 현재 접속에서만 유지되며 차량 정보에 저장되지 않습니다. 새로고침·로그아웃·계정 또는 상사 변경 시 초기화됩니다.','snote-inspection-session-note'));
  selectStage(selected);orientation();photoModes(checkView);
 }
 function unmount(){closePhoto();resizeObserver?.disconnect();resizeObserver=null;if(host){host.replaceChildren();host.classList.remove('snote-inspection');delete host.dataset.inspectionReady;}host=null;controller=null;sequence++;}
 function clear(){unmount();scope='';selected=0;focused=0;notes=Object.create(null);checks=Object.create(null);learning=[];learningSignature='';learningMode='check';photoFilter='all';lessonId='';}
 function mount(container,options={}){
  const target=typeof container==='string'?document.querySelector(container):container,newScope=currentScope(options.scopeKey);
  if(!target?.replaceChildren)return null;
  if(!newScope){clear();target.replaceChildren(node('p','로그인 상태를 확인한 뒤 다시 열어주세요.','snote-inspection-empty'));return null;}
  if(scope&&newScope!==scope)clear();else if(host&&host!==target)unmount();
  const data=learningLessons(options.learningData),signature=JSON.stringify(data),changed=signature!==learningSignature,mounted=host===target&&target.dataset.inspectionReady==='true';
  learning=data;learningSignature=signature;if(!learning.length){learningMode='check';photoFilter='all';lessonId='';}
  scope=newScope;host=target;controller=options;sequence++;if(!allowed())return null;if(!mounted||changed)render();if(!resizeObserver&&typeof ResizeObserver==='function'){resizeObserver=new ResizeObserver(orientation);resizeObserver.observe(host);}
  const token=sequence;return Object.freeze({unmount:()=>{if(sequence===token)unmount();},clear:()=>{if(sequence===token)clear();},refresh:()=>{if(sequence===token&&allowed())render();}});
 }
 window.SnoteVehicleInspection=Object.freeze({mount,unmount,clear,version:'2.235'});
})();
