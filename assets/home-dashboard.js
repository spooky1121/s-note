/* Owner-scoped dashboard. The bridge supplies verified amounts; this view never reads or writes storage. */
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
 function scheduler(workContent=null){if(!schedulerController)schedulerController=root.SnoteDealerSchedulerUI?.mount?.(schedulerHost)||null;schedulerController?.activate?.();schedulerController?.setWork?.(workContent);return schedulerHost;}
 const svgNode=(tag,attributes)=>{const item=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[key,value]of Object.entries(attributes))item.setAttribute(key,String(value));return item;};
 const icons={capital:'M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6M3 9h18',inventory:'M4 18h16M5 18V9l3-4h8l3 4v9M5 11h14M8 14h1m6 0h1',cash:'M4 6h15v14H4zM4 6V4h13M14 12h6v5h-6z',purchase:'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',sale:'M12 16V3m-5 5 5-5 5 5M4 17v4h16v-4',profit:'M3 18 9 12l4 3 8-10M15 5h6v6',year:'M4 20V5m0 15h17M8 16v-4m5 4V9m5 7V5',arrow:'M5 12h14m-6-6 6 6-6 6',lock:'M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3'};
 function icon(name){const svg=svgNode('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.65,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'});svg.append(svgNode('path',{d:icons[name]||icons.arrow}));return svg;}
 function valid(snapshot){try{return !!snapshot&&typeof snapshot.key==='string'&&snapshot.key.length>0&&model.isMonth(snapshot.month)&&Array.isArray(snapshot.rows)&&typeof snapshot.loading==='boolean'&&typeof snapshot.locked==='boolean'&&bridge()?.current?.(snapshot.key)===true;}catch{return false;}}
 function current(key){try{return active&&paintedKey===key&&bridge()?.current?.(key)===true;}catch{return false;}}
 function action(name,value,key){if(!current(key))return;try{if(name==='unlock')bridge()?.unlock?.(key);else bridge()?.[name]?.(value,key);}catch{refresh();}}
 function clear(){schedulerController?.deactivate?.();host.hidden=true;host.replaceChildren();paintedKey=null;signature='';}
 function state(text,{loading=false,locked=false,key=null}={}){
  host.replaceChildren();host.dataset.state=locked?'locked':loading?'loading':'unavailable';host.setAttribute('aria-busy',String(loading));signature='';
  const panel=node('section',null,'snote-home-state');panel.append(node('h2','대시보드'),node('p',text));
  if(locked){const button=node('button','잠금 해제','snote-home-unlock');button.type='button';button.prepend(icon('lock'));button.onclick=()=>action('unlock',null,key);panel.append(button);}host.append(panel,scheduler());
 }
 function kpi(label,value,{unit='원',kind='',detail='',empty='',masked=false}={}){
  const card=node('article',null,'snote-home-kpi');card.dataset.kpi=kind;card.dataset.marginHidden=String(masked);card.setAttribute('role','img');card.tabIndex=0;
  const labelLine=node('div',null,'snote-home-kpi-label');labelLine.append(node('span',label),icon(kind));
  const amount=node('strong',null,'snote-home-kpi-value');amount.append(node('span',masked?'-':value==null?'—':number(value),'snote-home-number'));if(!masked&&value!=null)amount.append(node('small',unit));
  if(!masked&&value!=null&&value<0)amount.classList.add('is-negative');
  const caption=masked?'수익 숨김':value==null?empty:detail;
  card.setAttribute('aria-label',label+' · '+(masked?'숨김':value==null?'아직 연결되지 않음':number(value)+unit)+(caption?' · '+caption:''));card.dataset.tooltip=caption||label;card.append(labelLine,amount);return card;
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
 function header(title,count,page,key){
  const head=node('header',null,'snote-home-card-head'),heading=node('div',null,'snote-home-card-title');heading.append(node('h2',title));if(count!=null)heading.append(node('span',number(count)+'대','snote-home-count'));
  const button=node('button',null,'snote-home-card-link');button.type='button';button.setAttribute('aria-label',title+' 전체 보기');button.dataset.tooltip=title+' 전체 보기';button.append(icon('arrow'));button.onclick=()=>action('navigate',page,key);head.append(heading,button);return head;
 }
 function settlement(data,key,hideMargin){
  const card=node('section',null,'snote-home-settlement-card');card.append(header('수익 정산',null,'finance',key));
  const list=node('dl',null,'snote-home-settlement');
  for(const[label,value,masked]of [['이번 달 수익',data.monthMargin,hideMargin],['올해 수익',data.yearMargin,hideMargin],['재고 예상수익',data.inventoryMargin,false]]){
   const row=node('div');row.dataset.marginHidden=String(masked);row.append(node('dt',label));const amount=node('dd',masked?'-':won(value));amount.classList.toggle('is-negative',!masked&&value<0);row.append(amount);list.append(row);
  }
  card.append(list);return card;
 }
 function render(data,key,hideMargin){
  host.replaceChildren();host.dataset.state='ready';host.setAttribute('aria-busy','false');
  const kpis=node('div',null,'snote-home-kpis');kpis.setAttribute('role','group');kpis.setAttribute('aria-label','대시보드 요약');
  kpis.append(kpi('총투자금',data.totalInvestment,{kind:'capital',detail:'현재 보유 차량 원가'}),kpi('재고대출금',data.inventoryCapital,{kind:'inventory',detail:'재고금융 등록금액'}),kpi('현금투자금',data.cash,{kind:'cash',detail:'총투자금 − 재고금융'}),kpi('이번 달 수익',data.monthMargin,{kind:'profit',detail:'판매가 − 매입 원가·부대비용',masked:hideMargin}));
  kpis.append(kpi('이번 달 매입',data.monthPurchaseCount,{kind:'purchase',unit:'대',detail:Number(data.month.slice(5))+'월 매입 기준'}),kpi('이번 달 판매',data.monthSaleCount,{kind:'sale',unit:'대',detail:Number(data.month.slice(5))+'월 판매 완료 기준'}),kpi('올해 수익',data.yearMargin,{kind:'year',detail:data.month.slice(0,4)+'년 판매 완료 기준',masked:hideMargin}));
  const insights=node('div',null,'snote-home-insights');insights.append(charts(data,key,hideMargin),settlement(data,key,hideMargin));
  const schedule=scheduler(insights);
  if(mobile.matches)host.append(schedule,kpis);else host.append(kpis,schedule);requestKpiFit();
 }
 function refresh(){
  scheduled=false;if(!active){clear();return;}host.hidden=false;
  let snapshot;try{snapshot=bridge()?.snapshot();}catch{paintedKey=null;state('대시보드를 불러오지 못했습니다.');return;}
  if(!valid(snapshot)){paintedKey=null;state('대시보드를 확인하고 있습니다.',{loading:true});return;}
  if(snapshot.key!==paintedKey){host.replaceChildren();signature='';paintedKey=snapshot.key;}
  if(snapshot.loading){state('대시보드를 불러오는 중…',{loading:true});return;}
  if(snapshot.locked){state('금액 요약과 수익 정보를 보려면 잠금을 해제해 주세요.',{locked:true,key:snapshot.key});return;}
  let data;try{data=model.summarize(snapshot.rows,snapshot.month);}catch{state('대시보드 금액을 확인할 수 없습니다.');return;}
  const hideMargin=snapshot.hideMargin!==false,next=JSON.stringify([snapshot.key,hideMargin,mobile.matches,data]);if(signature===next)return;signature=next;render(data,snapshot.key,hideMargin);
 }
 let fitting=false,lastFitWidth=null;
 function requestKpiFit(){if(fitting)return;fitting=true;requestAnimationFrame(()=>{fitting=false;const grid=host.querySelector('.snote-home-kpis');if(!grid||!current(paintedKey))return;grid.classList.remove('has-wide-values');delete grid.dataset.valueColumns;let required=0,overflow=false;for(const card of grid.children){const value=card.querySelector('.snote-home-kpi-value'),style=getComputedStyle(card),range=document.createRange();range.selectNodeContents(value);const width=range.getBoundingClientRect().width;required=Math.max(required,Math.ceil(width+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth)+4));if(value.scrollWidth>value.clientWidth+1)overflow=true;}if(overflow){const gap=parseFloat(getComputedStyle(grid).columnGap)||0,fit=Math.floor((grid.clientWidth+gap)/(required+gap));grid.dataset.valueColumns=String(fit>=7?7:fit>=4?4:fit>=2?2:1);grid.classList.add('has-wide-values');}});}
 if(typeof ResizeObserver==='function')new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width;if(width!==lastFitWidth){lastFitWidth=width;requestKpiFit();}}).observe(host);
 document.fonts?.ready.then(requestKpiFit);root.addEventListener('snote-fonts-enlarged',requestKpiFit);
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
 function summarize(rows,month=currentMonth()){
  if(!Array.isArray(rows)||!isMonth(month)||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw Error('INVALID_DASHBOARD_DATA');
  const inventory=rows.filter(row=>row.status!=='판매완료'),sold=rows.filter(row=>row.status==='판매완료'),inMonth=(row,field,key)=>monthOf(row[field])===key;
  const inventoryCapital=sum(inventory,row=>financing(row.inventoryLoan)),inventoryMargin=sum(inventory,row=>row.margin),monthPurchases=rows.filter(row=>inMonth(row,'purchaseAt',month)),monthSales=sold.filter(row=>inMonth(row,'soldAt',month)),yearSales=sold.filter(row=>{const key=monthOf(row.soldAt);return key&&key.slice(0,4)===month.slice(0,4)&&key<=month;});
  const totalInvestment=sum(inventory,row=>row.inventoryCost),cash=money(totalInvestment-inventoryCapital),series=Array.from({length:3},(_,i)=>shiftMonth(month,i-2)).filter(Boolean).map(key=>{const purchases=rows.filter(row=>inMonth(row,'purchaseAt',key)),sales=sold.filter(row=>inMonth(row,'soldAt',key));return{month:key,purchases:purchases.length,sales:sales.length,margin:sum(sales,row=>row.margin)};});
  return{month,inventoryCapital,cash,totalInvestment,monthPurchaseCount:monthPurchases.length,monthSaleCount:monthSales.length,monthMargin:sum(monthSales,row=>row.margin),yearMargin:sum(yearSales,row=>row.margin),inventoryMargin,inventoryCount:inventory.length,soldCount:sold.length,series,inventoryRecent:recent(inventory,'purchaseAt'),soldRecent:recent(sold,'soldAt')};
 }
 return Object.freeze({isMonth,currentMonth,monthOf,dateKey,currentDay,inventoryTasks,saleProgress,summarize});
});
