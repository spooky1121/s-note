/* Scoped dashboard. Owner amounts and accountant workflow counts are separate projections. */
(function(root,factory){
 'use strict';
 const calendar=typeof module==='object'&&module.exports?require('./sales-overview.js'):root?.SnoteSalesOverviewModel;
 if(!calendar)return;
 const model=factory(calendar);
 if(typeof module==='object'&&module.exports)module.exports=model;
 if(!root?.document)return;
 root.SnoteHomeDashboardModel=model;
 const host=document.getElementById('snote-dashboard-home');if(!host)return;host.dataset.homeLayout='fluid';
 const bridge=()=>root.snoteHomeDashboardBridge;
 const mobile=matchMedia('(max-width:760px)');
 let active=false,paintedKey=null,signature='',scheduled=false,selectedChart='purchases';
 const number=value=>Number(value).toLocaleString('ko-KR');
 const won=value=>value==null?'—':number(value)+'원';
 const node=(tag,text,cls)=>{const item=document.createElement(tag);if(text!=null)item.textContent=text;if(cls)item.className=cls;return item;};
 const schedulerHost=node('section');schedulerHost.id='snote-dealer-scheduler';let schedulerController=null;
 const newsHost=node('section');newsHost.id='snote-dashboard-news';newsHost.setAttribute('aria-label','자동차 칼럼');
 function announced(mode,key){root.dispatchEvent(new CustomEvent('snote:home-dashboard-rendered',{detail:{mode,key}}));}
 function scheduler(workContent=null){if(!schedulerController)schedulerController=root.SnoteDealerSchedulerUI?.mount?.(schedulerHost)||null;schedulerController?.activate?.();schedulerController?.setWork?.(workContent);return schedulerHost;}
 const svgNode=(tag,attributes)=>{const item=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[key,value]of Object.entries(attributes))item.setAttribute(key,String(value));return item;};
 const icons={arrow:'M5 12h14m-6-6 6 6-6 6',lock:'M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3'};
 function icon(name){const svg=svgNode('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.65,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'});svg.append(svgNode('path',{d:icons[name]||icons.arrow}));return svg;}
 function valid(snapshot){try{return !!snapshot&&typeof snapshot.key==='string'&&snapshot.key.length>0&&model.isMonth(snapshot.month)&&Array.isArray(snapshot.rows)&&typeof snapshot.loading==='boolean'&&typeof snapshot.locked==='boolean'&&bridge()?.current?.(snapshot.key)===true;}catch{return false;}}
 function current(key){try{return active&&paintedKey===key&&bridge()?.current?.(key)===true;}catch{return false;}}
 function action(name,value,key){if(!current(key))return;try{if(name==='unlock')bridge()?.unlock?.(key);else bridge()?.[name]?.(value,key);}catch{refresh();}}
 function clear(){schedulerController?.deactivate?.();host.hidden=true;host.replaceChildren();delete host.dataset.mode;paintedKey=null;signature='';}
 function state(text,{loading=false,locked=false,key=null}={}){
  host.replaceChildren();host.dataset.state=locked?'locked':loading?'loading':'unavailable';host.setAttribute('aria-busy',String(loading));signature='';
  const panel=node('section',null,'snote-home-state');panel.append(node('h2','대시보드'),node('p',text));
  if(locked){const button=node('button','잠금 해제','snote-home-unlock');button.type='button';button.prepend(icon('lock'));button.onclick=()=>action('unlock',null,key);panel.append(button);}host.append(panel,scheduler(locked?newsHost:null));if(locked)announced('locked',key);
 }
 function chart(data,{field,title,color,money=false,masked=false}){
  const card=node('section',null,'snote-home-chart-card');card.dataset.chart=field;card.style.setProperty('--snote-home-chart-color',color);
  const head=node('header',null,'snote-home-card-head'),label=node('div');label.append(node('h2',title));
  if(masked){head.append(label,node('strong','-','snote-home-chart-total'));card.append(head,node('p','수익 숨김','snote-home-chart-masked'));card.dataset.marginHidden='true';return card;}
  const total=data.series.reduce((sum,item)=>sum+item[field],0),summary=node('strong',money?won(total):number(total)+'대','snote-home-chart-total');if(total<0)summary.classList.add('is-negative');head.append(label,summary);card.append(head);
  const plot=node('div',null,'snote-home-chart');plot.setAttribute('role','group');plot.setAttribute('aria-label','최근 3개월 '+title+' 추이');
  const values=data.series.map(item=>item[field]),low=Math.min(0,...values),high=Math.max(0,...values),range=high-low||1;
  const y=value=>82-(value-low)/range*58,zero=y(0),points=data.series.map((item,index)=>({x:300*(index+.5)/data.series.length,y:y(item[field])}));
  const svg=svgNode('svg',{viewBox:'0 0 300 104',preserveAspectRatio:'none',class:'snote-home-chart-line','aria-hidden':'true',focusable:'false'});
  for(const at of [24,53,82])svg.append(svgNode('line',{x1:0,y1:at,x2:300,y2:at,class:'snote-home-grid-line'}));
  svg.append(svgNode('line',{x1:0,y1:zero,x2:300,y2:zero,class:'snote-home-zero-line'}));
  const coordinates=points.map(point=>point.x+','+point.y).join(' ');
  svg.append(svgNode('polygon',{points:points[0].x+','+zero+' '+coordinates+' '+points.at(-1).x+','+zero,class:'snote-home-line-area'}),svgNode('polyline',{points:coordinates,class:'snote-home-line-path'}));plot.append(svg);
  for(const[index,item]of data.series.entries()){
   const point=node('span',null,'snote-home-chart-month');point.dataset.month=item.month;point.dataset.value=String(item[field]);point.style.setProperty('--snote-home-point-y',String(points[index].y));point.tabIndex=0;point.setAttribute('role','img');point.classList.toggle('is-current',item.month===data.month);
   const text=item.month.replace('-','년 ')+'월 · '+title+' '+(money?won(item[field]):number(item[field])+'대');point.setAttribute('aria-label',text);point.dataset.tooltip=text;
   const marker=node('span',null,'snote-home-chart-marker');marker.setAttribute('aria-hidden','true');const dot=node('i',null,'snote-home-chart-dot');marker.append(dot);point.append(marker,node('span',Number(item.month.slice(5))+'월','snote-home-chart-label'));plot.append(point);
  }
  card.append(plot);return card;
 }
 function charts(data,key,hideMargin){
  const card=node('section',null,'snote-home-chart-group');card.setAttribute('aria-label','최근 3개월 실적');
  const heading=node('header',null,'snote-home-chart-group-head');heading.append(node('h2','최근 3개월 흐름'));
  const tabs=node('div',null,'snote-home-chart-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','실적 지표 선택');
  const options=[{field:'purchases',title:'매입',label:'매입 대수',color:'#3974dc'},{field:'sales',title:'판매',label:'판매 대수',color:'#25868b'},{field:'margin',title:'판매수익',label:'판매 수익',color:'#7460b6',money:true}];
  const panels=node('div',null,'snote-home-chart-panels'),buttons=[];
  function select(field,focus=false){
   selectedChart=field;
   for(const[at,option]of options.entries()){
    const chosen=option.field===field,button=buttons[at],panel=panels.children[at];button.setAttribute('aria-selected',String(chosen));button.tabIndex=chosen?0:-1;panel.hidden=!chosen;
    if(chosen&&focus)button.focus();
   }
  }
  for(const[at,option]of options.entries()){
   const button=node('button',option.label,'snote-home-chart-tab');button.type='button';button.id='snote-home-tab-'+option.field;button.setAttribute('role','tab');button.setAttribute('aria-controls','snote-home-panel-'+option.field);
   button.onclick=()=>{if(current(key))select(option.field);};
   button.onkeydown=event=>{if(!current(key))return;let next;if(event.key==='ArrowRight')next=(at+1)%options.length;else if(event.key==='ArrowLeft')next=(at+options.length-1)%options.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=options.length-1;else return;event.preventDefault();select(options[next].field,true);};
   buttons.push(button);tabs.append(button);
   const panel=chart(data,{...option,masked:option.money&&hideMargin});panel.id='snote-home-panel-'+option.field;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);panels.append(panel);
  }
  heading.append(tabs);card.append(heading,panels);select(selectedChart);return card;
 }
 function render(data,key,hideMargin){
  host.replaceChildren();host.dataset.state='ready';host.setAttribute('aria-busy','false');
  const work=node('div',null,'snote-home-work');work.append(charts(data,key,hideMargin),newsHost);
  host.append(scheduler(work));announced('owner',key);
 }
 function renderAccountant(data,key){
  host.replaceChildren();host.dataset.state='ready';host.setAttribute('aria-busy','false');
  const summary=node('section',null,'snote-accountant-summary');summary.setAttribute('role','group');summary.setAttribute('aria-label','상사 업무 현황');
  for(const[field,label]of [['totalCount','상사 차량'],['inventoryCount','보유 차량'],['contractCount','계약 진행'],['monthPurchaseCount','이번 달 매입']]){
   const card=node('article',null,'snote-accountant-count');card.dataset.workCount=field;
   const value=node('div',null,'snote-accountant-count-value');value.append(node('strong',number(data[field])),node('small','대'));
   card.append(node('span',label,'snote-accountant-count-label'),value);summary.append(card);
  }
  const work=node('section',null,'snote-accountant-work');work.append(node('h2','서류 준비'),node('p','차량별 양수인과 자동차등록증을 확인하세요.'));
  const actions=node('div',null,'snote-accountant-actions');
  for(const[page,label]of [['contractArchive','서류함'],['buy','매입 관리']]){
   const button=node('button',label);button.type='button';button.dataset.accountantPage=page;button.append(icon('arrow'));button.onclick=()=>action('navigate',page,key);actions.append(button);
  }
  work.append(actions);const workspace=node('div',null,'snote-home-work');workspace.append(work,newsHost);const schedule=scheduler(workspace);
  if(mobile.matches)host.append(schedule,summary);else host.append(summary,schedule);announced('accountant',key);
 }
 function refresh(){
  scheduled=false;if(!active){clear();return;}host.hidden=false;
  let snapshot;try{snapshot=bridge()?.snapshot();}catch{paintedKey=null;state('대시보드를 불러오지 못했습니다.');return;}
  if(!valid(snapshot)){paintedKey=null;state('대시보드를 확인하고 있습니다.',{loading:true});return;}
  if(snapshot.key!==paintedKey){host.replaceChildren();signature='';paintedKey=snapshot.key;}
  host.dataset.mode=snapshot.mode==='accountant'?'accountant':'owner';
  if(snapshot.loading){state('대시보드를 불러오는 중…',{loading:true});return;}
  if(snapshot.mode==='accountant'){
   if(snapshot.locked){state('상사 업무 현황을 확인하고 있습니다.',{loading:true});return;}
   let data;try{data=model.accountantSummary(snapshot.workSummary);}catch{state('상사 업무 현황을 확인할 수 없습니다.');return;}
   const next=JSON.stringify([snapshot.key,'accountant',mobile.matches,data]);if(signature===next)return;signature=next;renderAccountant(data,snapshot.key);return;
  }
  if(snapshot.locked){state('금액 요약과 수익 정보를 보려면 잠금을 해제해 주세요.',{locked:true,key:snapshot.key});return;}
  let data;try{data=model.summarize(snapshot.rows,snapshot.month);}catch{state('대시보드 금액을 확인할 수 없습니다.');return;}
  const hideMargin=snapshot.hideMargin!==false,next=JSON.stringify([snapshot.key,hideMargin,mobile.matches,data]);if(signature===next)return;signature=next;render(data,snapshot.key,hideMargin);
 }
 function schedule(){if(!scheduled){scheduled=true;queueMicrotask(refresh);}}
 root.addEventListener('snote:route-changed',event=>{active=event.detail?.page==='dashboard';refresh();});
 root.addEventListener('snote:sales-data-changed',schedule);
 document.addEventListener('snote:finance-lock-changed',schedule);
 document.addEventListener('snote:dashboard-display-changed',schedule);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&active)schedule();});
 mobile.addEventListener('change',schedule);
 // Identity, gate and day rollover checks are cheap; amounts are recalculated only when their scope changes.
 setInterval(()=>{if(!active)return;try{if(!paintedKey||bridge()?.current?.(paintedKey)!==true)refresh();}catch{refresh();}},1000);
 try{active=typeof route==='string'&&route==='dashboard';}catch{active=false;}refresh();
})(typeof window==='object'?window:globalThis,function(calendar){
 'use strict';
 const {isMonth,currentMonth,shiftMonth}=calendar,monthOf=calendar.soldMonth;
 function money(value){if(value==null)return 0;if(typeof value!=='number'||!Number.isSafeInteger(value))throw Error('INVALID_DASHBOARD_AMOUNT');return value;}
 function financing(value){const amount=money(value);if(amount<0)throw Error('INVALID_DASHBOARD_FINANCING');return amount;}
 function sum(rows,pick){let total=0;for(const row of rows){total+=money(pick(row));if(!Number.isSafeInteger(total))throw Error('INVALID_DASHBOARD_AMOUNT');}return total;}
 function dateKey(value){if(!monthOf(value))return '';const match=/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value.trim());return match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');}
 function currentDay(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);return ['year','month','day'].map(type=>parts.find(part=>part.type===type).value).join('-');
 }
 function inventoryTasks(rows,asOf=currentDay()){
  if(!Array.isArray(rows)||!dateKey(asOf))throw Error('INVALID_DASHBOARD_TASK_DATE');
  const today=Date.parse(dateKey(asOf)+'T00:00:00Z'),tasks=[];
  for(const row of rows){
   if(!row||row.status==='판매완료')continue;const purchased=dateKey(row.purchaseAt);if(!purchased)continue;
   const days=Math.floor((today-Date.parse(purchased+'T00:00:00Z'))/86400000);if(days>=90)tasks.push({id:row.id,model:row.model,plate:row.plate,days});
  }
  tasks.sort((a,b)=>b.days-a.days||String(a.id||'').localeCompare(String(b.id||'')));return{asOf:dateKey(asOf),count:tasks.length,rows:tasks};
 }
 function saleProgress(rows){
  if(!Array.isArray(rows))throw Error('INVALID_DASHBOARD_TASK_ROWS');
  const pending=rows.filter(row=>row&&row.status==='계약중').map(row=>({id:row.id,model:row.model,plate:row.plate}));
  return {count:pending.length,rows:pending};
 }
 const recent=(rows,field)=>rows.slice().sort((a,b)=>dateKey(b[field]).localeCompare(dateKey(a[field]))||String(a.id||'').localeCompare(String(b.id||''))).slice(0,4);
 function accountantSummary(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_ACCOUNTANT_WORK_SUMMARY');
  const result={};for(const field of ['totalCount','inventoryCount','contractCount','monthPurchaseCount']){
   const count=value[field];if(!Number.isSafeInteger(count)||count<0)throw Error('INVALID_ACCOUNTANT_WORK_SUMMARY');result[field]=count;
  }
  if(result.inventoryCount>result.totalCount||result.contractCount>result.inventoryCount||result.monthPurchaseCount>result.totalCount)throw Error('INVALID_ACCOUNTANT_WORK_SUMMARY');
  return Object.freeze(result);
 }
 function summarize(rows,month=currentMonth()){
  if(!Array.isArray(rows)||!isMonth(month)||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw Error('INVALID_DASHBOARD_DATA');
  const inventory=rows.filter(row=>row.status!=='판매완료'),sold=rows.filter(row=>row.status==='판매완료'),inMonth=(row,field,key)=>monthOf(row[field])===key;
  const inventoryCapital=sum(inventory,row=>financing(row.inventoryLoan)),inventoryMargin=sum(inventory,row=>row.margin),monthPurchases=rows.filter(row=>inMonth(row,'purchaseAt',month)),monthSales=sold.filter(row=>inMonth(row,'soldAt',month)),yearSales=sold.filter(row=>{const key=monthOf(row.soldAt);return key&&key.slice(0,4)===month.slice(0,4)&&key<=month;});
  const totalInvestment=sum(inventory,row=>row.inventoryCost),cash=money(totalInvestment-inventoryCapital),series=Array.from({length:3},(_,i)=>shiftMonth(month,i-2)).filter(Boolean).map(key=>{const purchases=rows.filter(row=>inMonth(row,'purchaseAt',key)),sales=sold.filter(row=>inMonth(row,'soldAt',key));return{month:key,purchases:purchases.length,sales:sales.length,margin:sum(sales,row=>row.margin)};});
  return{month,inventoryCapital,cash,totalInvestment,monthPurchaseCount:monthPurchases.length,monthSaleCount:monthSales.length,monthMargin:sum(monthSales,row=>row.margin),yearMargin:sum(yearSales,row=>row.margin),inventoryMargin,inventoryCount:inventory.length,soldCount:sold.length,series,inventoryRecent:recent(inventory,'purchaseAt'),soldRecent:recent(sold,'soldAt')};
 }
 function settlementRows(data,{hideMargin=false}={}){
  if(!data||typeof data!=='object'||Array.isArray(data)||typeof hideMargin!=='boolean')throw Error('INVALID_DASHBOARD_DATA');
  const fields=[['capital','총투자금','totalInvestment','원'],['inventory','재고대출금','inventoryCapital','원'],['cash','현금투자금','cash','원'],['purchase','이번 달 매입','monthPurchaseCount','대'],['sale','이번 달 판매','monthSaleCount','대'],['profit','이번 달 수익','monthMargin','원',true],['year','올해 수익','yearMargin','원',true],['forecast','재고 예상수익','inventoryMargin','원']];
  return Object.freeze(fields.map(([kind,label,field,unit,margin])=>{if(!Object.hasOwn(data,field))throw Error('INVALID_DASHBOARD_DATA');const value=money(data[field]);if((kind==='purchase'||kind==='sale')&&value<0)throw Error('INVALID_DASHBOARD_AMOUNT');const masked=margin===true&&hideMargin;return Object.freeze({kind,label,value:masked?null:value,unit,masked});}));
 }
 return Object.freeze({isMonth,currentMonth,monthOf,dateKey,currentDay,inventoryTasks,saleProgress,accountantSummary,summarize,settlementRows});
});
