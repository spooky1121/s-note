/* v2.210: quote-local fee names and short guides; no storage or provider requests. */
(()=>{'use strict';
 if(window.SnoteQuoteCostEditor)return;
 const definitions=[
  ['quote-stamp','증지대','이전 등록 수수료'],
  ['quote-insurance','성능보증보험료','차량 부대비용 반영'],
  ['quote-platefee','번호판 교체비','교체 시 발생'],
  ['quote-sellingfee','매도비','예시 금액 · 수정 가능'],
  ['quote-fee','수수료','발생 시 입력']
 ];
 const presets=[
  ...definitions.map(([,label,guide])=>({label,guide,aliases:[]})),
  {label:'탁송료',guide:'차량 운송에 필요한 비용',aliases:['탁송비','차량 탁송료','차량 탁송비']},
  {label:'전기차 감면',guide:'전기차 관련 감면 금액',deduction:true,aliases:['전기차 감면액','전기차 감면금액','전기차 감면 금액']},
  {label:'할인',guide:'견적 금액에서 차감되는 금액',deduction:true,aliases:['할인액','할인금액','할인 금액','차량 할인','차량 할인액','차량 할인금액']},
  {label:'수리비',guide:'차량 수리에 필요한 비용',aliases:['수리비용','차량 수리비','차량 수리비용']},
  {label:'정비',guide:'차량 점검·정비에 필요한 비용',aliases:['정비비','정비비용','차량 정비','차량 정비비']}
 ];
 const normalize=value=>String(value||'').trim().replace(/\s+/gu,'');
 const lookup=new Map();
 for(const preset of presets)for(const label of [preset.label,...preset.aliases])lookup.set(normalize(label),preset);
 const states=new Map();
 let committing=false;
 const presetFor=value=>lookup.get(normalize(value))||null;
 const canonical=value=>presetFor(value)?.label||'custom:'+normalize(value);
 const negative=value=>/^[-−]/u.test(String(value||'').trimStart());
 function bound(control,limit){
  const value=control.value.replace(/\r\n|[\r\n\t]/gu,' ').slice(0,limit);
  if(value!==control.value)control.value=value;
 }
 function sync(state){
  state.labelMirror.textContent=state.label.value;
  state.guideMirror.textContent=state.guide.value;
  state.guide.setAttribute('aria-label',`${state.label.value||state.defaultLabel} 안내`);
  state.amount.setAttribute('aria-label',state.label.value||state.defaultLabel);
 }
 function totals(){if(typeof window.updateQuoteTotals==='function')window.updateQuoteTotals();window.SnoteDocumentViewport?.refresh();}
 function commit(state){
  if(state.composing)return false;
  bound(state.label,24);bound(state.guide,60);
  if(!normalize(state.label.value)){state.label.value=state.defaultLabel;state.guide.value=state.defaultGuide;}
  const next=canonical(state.label.value),preset=presetFor(state.label.value),changed=next!==state.canonical;
  if(changed){
   const wasAutoMinus=state.autoMinus;
   if(state.autoMinus&&!preset?.deduction)state.amount.value=state.amount.value.replace(/^(\s*)[-−]/u,'$1');
   state.guide.value=preset?.guide||'';
   state.canonical=next;
   state.autoMinus=!!preset?.deduction&&(wasAutoMinus||!negative(state.amount.value));
  }else if(preset?.deduction&&!negative(state.amount.value))state.autoMinus=true;
  sync(state);
  return changed;
 }
 function commitOne(state){if(committing||state.composing)return;committing=true;try{commit(state);totals();}finally{committing=false;}}
 function field(state,cell,kind,value,limit){
  const wrapper=document.createElement('div');wrapper.className='snote-quote-cost-field';
  const mirror=document.createElement('span');mirror.className='snote-quote-cost-mirror';mirror.dataset.quoteCostMirror=kind;mirror.setAttribute('aria-hidden','true');mirror.textContent=value;
  const control=document.createElement(kind==='label'?'input':'textarea');
  control.id=state.id+'-'+kind;control.className='snote-quote-cost-control snote-quote-cost-'+kind;control.value=value;control.maxLength=limit;
  control.setAttribute('aria-label',kind==='label'?`${state.defaultLabel} 비용 항목`:`${state.defaultLabel} 안내`);
  control.setAttribute('autocomplete','off');control.setAttribute('spellcheck','false');
  if(kind==='label'){control.type='text';control.setAttribute('list','snote-quote-cost-presets');}
  else{control.rows=1;control.setAttribute('wrap','soft');control.placeholder='안내 직접 입력';}
  control.addEventListener('compositionstart',()=>{state.composing=true;});
  control.addEventListener('compositionend',()=>{state.composing=false;bound(control,limit);sync(state);});
  control.addEventListener('input',()=>{if(!state.composing)bound(control,limit);sync(state);window.SnoteDocumentViewport?.refresh();});
  control.addEventListener('keydown',event=>{
   if(event.key!=='Enter'||event.isComposing||state.composing||event.keyCode===229)return;
   event.preventDefault();commitOne(state);control.blur();
  });
  control.addEventListener('blur',()=>{if(kind==='label')commitOne(state);else{bound(control,limit);sync(state);}});
  wrapper.append(mirror,control);cell.replaceChildren(wrapper);cell.classList.add('snote-quote-cost-'+kind+'-cell');
  state[kind]=control;state[kind+'Mirror']=mirror;
 }
 function install(){
  if(states.size)return;
  const paper=document.getElementById('quote-paper');if(!paper)return;
  const list=document.createElement('datalist');list.id='snote-quote-cost-presets';
  for(const preset of presets){const option=document.createElement('option');option.value=preset.label;list.append(option);}
  document.body.append(list);
  for(const [id,label,guide]of definitions){
   const amount=document.getElementById(id),row=amount?.closest('tr');if(!row||row.cells.length<3)continue;
   const state={id,amount,defaultLabel:label,defaultGuide:guide,canonical:label,autoMinus:false,composing:false};
   field(state,row.cells[0],'label',label,24);field(state,row.cells[1],'guide',guide,60);states.set(id,state);
   amount.addEventListener('input',event=>{
    if(!presetFor(state.label.value)?.deduction){state.autoMinus=false;return;}
    if(!negative(amount.value))state.autoMinus=true;
    else if(negative(event.data)||event.inputType==='insertFromPaste')state.autoMinus=false;
   },true);
  }
 }
 function reset(){
  install();
  for(const state of states.values()){
   state.label.value=state.defaultLabel;state.guide.value=state.defaultGuide;state.canonical=state.defaultLabel;state.autoMinus=false;state.composing=false;sync(state);
  }
  window.SnoteDocumentViewport?.refresh();
 }
 function commitAll(){
  install();if(committing)return;committing=true;
  try{for(const state of states.values())commit(state);totals();}finally{committing=false;}
 }
 function isDeduction(id){install();return !!presetFor(states.get(id)?.label.value)?.deduction;}
 window.SnoteQuoteCostEditor=Object.freeze({reset,commitAll,isDeduction});
 window.addEventListener('beforeprint',()=>{if(document.getElementById('quote-overlay')?.classList.contains('open'))commitAll();});
 install();
})();
