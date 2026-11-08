/* Owner-scoped dashboard. The bridge supplies verified amounts; this view never reads or writes storage. */
(function(root,factory){
 'use strict';
 const calendar=typeof module==='object'&&module.exports?require('./sales-overview.js'):root?.SnoteSalesOverviewModel;
 if(!calendar)return;
 const model=factory(calendar);
 if(typeof module==='object'&&module.exports)module.exports=model;
 if(!root?.document)return;
 root.SnoteHomeDashboardModel=model;
 const host=document.getElementById('snote-dashboard-home');if(!host)return;
 const bridge=()=>root.snoteHomeDashboardBridge;
 let active=false,paintedKey=null,signature='',scheduled=false;
 const number=value=>Number(value).toLocaleString('ko-KR');
 const won=value=>value==null?'—':number(value)+'원';
 const node=(tag,text,cls)=>{const item=document.createElement(tag);if(text!=null)item.textContent=text;if(cls)item.className=cls;return item;};
 const svgNode=(tag,attributes)=>{const item=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[key,value]of Object.entries(attributes))item.setAttribute(key,String(value));return item;};
 const icons={capital:'M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6M3 9h18',inventory:'M4 18h16M5 18V9l3-4h8l3 4v9M5 11h14M8 14h1m6 0h1',cash:'M4 6h15v14H4zM4 6V4h13M14 12h6v5h-6z',purchase:'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',sale:'M12 16V3m-5 5 5-5 5 5M4 17v4h16v-4',profit:'M3 18 9 12l4 3 8-10M15 5h6v6',year:'M4 20V5m0 15h17M8 16v-4m5 4V9m5 7V5',arrow:'M5 12h14m-6-6 6 6-6 6',lock:'M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3'};
 function icon(name){const svg=svgNode('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.65,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'});svg.append(svgNode('path',{d:icons[name]||icons.arrow}));return svg;}
 function valid(snapshot){try{return !!snapshot&&typeof snapshot.key==='string'&&snapshot.key.length>0&&model.isMonth(snapshot.month)&&Array.isArray(snapshot.rows)&&typeof snapshot.loading==='boolean'&&typeof snapshot.locked==='boolean'&&bridge()?.current?.(snapshot.key)===true;}catch{return false;}}
 function current(key){try{return active&&paintedKey===key&&bridge()?.current?.(key)===true;}catch{return false;}}
 function action(name,value,key){if(!current(key))return;try{if(name==='unlock')bridge()?.unlock?.(key);else bridge()?.[name]?.(value,key);}catch{refresh();}}
 function clear(){host.hidden=true;host.replaceChildren();paintedKey=null;signature='';}
 function state(text,{loading=false,locked=false,key=null}={}){
  host.replaceChildren();host.dataset.state=locked?'locked':loading?'loading':'unavailable';host.setAttribute('aria-busy',String(loading));signature='';
  const panel=node('section',null,'snote-home-state');panel.append(node('h2','대시보드'),node('p',text));
  if(locked){const button=node('button','잠금 해제','snote-home-unlock');button.type='button';button.prepend(icon('lock'));button.onclick=()=>action('unlock',null,key);panel.append(button);}host.append(panel);
 }
 function kpi(label,value,{unit='원',kind='',detail='',empty='',masked=false}={}){
  const card=node('article',null,'snote-home-kpi');card.dataset.kpi=kind;card.dataset.marginHidden=String(masked);card.setAttribute('role','img');card.tabIndex=0;
  const labelLine=node('div',null,'snote-home-kpi-label');labelLine.append(node('span',label),icon(kind));
  const amount=node('strong',null,'snote-home-kpi-value');amount.append(node('span',masked?'-':value==null?'—':number(value),'snote-home-number'));if(!masked&&value!=null)amount.append(node('small',unit));
  if(!masked&&value!=null&&value<0)amount.classList.add('is-negative');
  const caption=masked?'마진 숨김':value==null?empty:detail;
  card.setAttribute('aria-label',label+' · '+(masked?'숨김':value==null?'아직 연결되지 않음':number(value)+unit)+(caption?' · '+caption:''));card.dataset.tooltip=caption||label;card.append(labelLine,amount,node('p',caption,'snote-home-kpi-caption'));return card;
 }
 function chart(data,{field,title,color,money=false}){
  const card=node('section',null,'snote-home-chart-card');card.dataset.chart=field;card.style.setProperty('--snote-home-chart-color',color);
  const head=node('header',null,'snote-home-card-head'),label=node('div');label.append(node('h2',title),node('span','최근 3개월','snote-home-period'));
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
 function header(title,count,page,key){
  const head=node('header',null,'snote-home-card-head'),heading=node('div',null,'snote-home-card-title');heading.append(node('h2',title));if(count!=null)heading.append(node('span',number(count)+'대','snote-home-count'));
  const button=node('button',null,'snote-home-card-link');button.type='button';button.setAttribute('aria-label',title+' 전체 보기');button.dataset.tooltip=title+' 전체 보기';button.append(icon('arrow'));button.onclick=()=>action('navigate',page,key);head.append(heading,button);return head;
 }
 function listCard(title,rows,count,page,key,sold=false){
  const card=node('section',null,'snote-home-list-card');card.dataset.list=page;card.append(header(title,count,page,key));
  const list=node('div',null,'snote-home-vehicle-list');
  if(!rows.length)list.append(node('p',sold?'판매 완료된 차량이 없습니다.':'등록된 매입 차량이 없습니다.','snote-home-empty'));
  for(const row of rows){
   const button=node('button',null,'snote-home-vehicle-row');button.type='button';button.dataset.vehicleId=String(row.id);button.setAttribute('aria-label',String(row.model||'차량')+' '+String(row.plate||'')+' 상세 보기');button.onclick=()=>action('openVehicle',row.id,key);
   const thumb=node('span',null,'snote-home-thumb');if(typeof row.photo==='string'&&row.photo){const image=node('img');image.src=row.photo;image.alt='';image.loading='lazy';image.addEventListener('error',()=>{image.remove();thumb.append(node('span','S','snote-home-thumb-fallback'));},{once:true});thumb.append(image);}else thumb.append(node('span','S','snote-home-thumb-fallback'));
   const info=node('span',null,'snote-home-vehicle-info');info.append(node('strong',row.model||'차량 정보 없음'),node('small',[row.plate||'',model.dateKey(sold?row.soldAt:row.purchaseAt)||'날짜 미입력'].filter(Boolean).join(' · ')));
   const price=node('span',null,'snote-home-vehicle-price');price.append(node('strong',won(sold?row.soldPrice:row.inventoryCost)),node('small',sold?'판매가':'재고 원가'));
   button.append(thumb,info,price);list.append(button);
  }
  card.append(list);return card;
 }
 function settlement(data,key,hideMargin){
  const card=node('section',null,'snote-home-settlement-card');card.append(header('수익 정산',null,'finance',key));
  const list=node('dl',null,'snote-home-settlement');
  for(const[label,value,caption,masked]of [['이번 달 마진',data.monthMargin,'이번 달 판매 완료 기준',hideMargin],['올해 마진',data.yearMargin,'올해 판매 완료 기준',hideMargin],['재고 예상마진',data.inventoryMargin,'현재 보유 차량 기준',false]]){
   const row=node('div');row.dataset.marginHidden=String(masked);row.append(node('dt',label));const amount=node('dd',masked?'-':won(value));amount.classList.toggle('is-negative',!masked&&value<0);row.append(amount,node('small',caption));list.append(row);
  }
  card.append(list);return card;
 }
 function render(data,key,hideMargin){
  host.replaceChildren();host.dataset.state='ready';host.setAttribute('aria-busy','false');
  const kpis=node('div',null,'snote-home-kpis');kpis.setAttribute('role','group');kpis.setAttribute('aria-label','대시보드 요약');
  kpis.append(kpi('총투자금',data.totalInvestment,{kind:'capital',detail:'재고금 + 현금 잔액',empty:'현금 잔액 연결 전'}),kpi('재고금',data.inventoryCapital,{kind:'inventory',detail:'재고이자 포함 · 소득세 제외'}),kpi('현금',data.cash,{kind:'cash',detail:'연결된 현금 잔액',empty:'계좌 잔액 연결 전'}),kpi('이번 달 매입 대수',data.monthPurchaseCount,{kind:'purchase',unit:'대',detail:Number(data.month.slice(5))+'월 매입 기준'}),kpi('이번 달 판매 대수',data.monthSaleCount,{kind:'sale',unit:'대',detail:Number(data.month.slice(5))+'월 판매 완료 기준'}),kpi('이번 달 마진',data.monthMargin,{kind:'profit',detail:'판매가 − 매입 원가·부대비용',masked:hideMargin}),kpi('올해 마진',data.yearMargin,{kind:'year',detail:data.month.slice(0,4)+'년 판매 완료 기준',masked:hideMargin}));
  const graphs=node('div',null,'snote-home-graphs');graphs.append(chart(data,{field:'purchases',title:'매입',color:'#4b80eb'}),chart(data,{field:'sales',title:'매도',color:'#4aa6b0'}),chart(data,{field:'margin',title:'판매수익',color:'#8a78cf',money:true}));
  const cards=node('div',null,'snote-home-details');cards.append(listCard('매입 차량',data.inventoryRecent,data.inventoryCount,'buy',key),listCard('판매 완료',data.soldRecent,data.soldCount,'sell',key,true),settlement(data,key,hideMargin));host.append(kpis,graphs,cards);
 }
 function refresh(){
  scheduled=false;if(!active){clear();return;}host.hidden=false;
  let snapshot;try{snapshot=bridge()?.snapshot();}catch{paintedKey=null;state('대시보드를 불러오지 못했습니다.');return;}
  if(!valid(snapshot)){paintedKey=null;state('대시보드를 확인하고 있습니다.',{loading:true});return;}
  if(snapshot.key!==paintedKey){host.replaceChildren();signature='';paintedKey=snapshot.key;}
  if(snapshot.loading){state('대시보드를 불러오는 중…',{loading:true});return;}
  if(snapshot.locked){state('금액 요약과 수익 정보를 보려면 잠금을 해제해 주세요.',{locked:true,key:snapshot.key});return;}
  let data;try{data=model.summarize(snapshot.rows,snapshot.month,snapshot.cash);}catch{state('대시보드 금액을 확인할 수 없습니다.');return;}
  const hideMargin=snapshot.hideMargin!==false,next=JSON.stringify([snapshot.key,hideMargin,data]);if(signature===next)return;signature=next;render(data,snapshot.key,hideMargin);
 }
 function schedule(){if(!scheduled){scheduled=true;queueMicrotask(refresh);}}
 root.addEventListener('snote:route-changed',event=>{active=event.detail?.page==='dashboard';refresh();});
 root.addEventListener('snote:sales-data-changed',schedule);
 document.addEventListener('snote:finance-lock-changed',schedule);
 document.addEventListener('snote:dashboard-display-changed',schedule);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&active)schedule();});
 // Identity, gate and day rollover checks are cheap; amounts are recalculated only when their scope changes.
 setInterval(()=>{if(!active)return;try{if(!paintedKey||bridge()?.current?.(paintedKey)!==true)refresh();}catch{refresh();}},1000);
 try{active=typeof route==='string'&&route==='dashboard';}catch{active=false;}refresh();
})(typeof window==='object'?window:globalThis,function(calendar){
 'use strict';
 const {isMonth,currentMonth,shiftMonth}=calendar,monthOf=calendar.soldMonth;
 function money(value){if(value==null)return 0;if(typeof value!=='number'||!Number.isSafeInteger(value))throw Error('INVALID_DASHBOARD_AMOUNT');return value;}
 function sum(rows,pick){let total=0;for(const row of rows){total+=money(pick(row));if(!Number.isSafeInteger(total))throw Error('INVALID_DASHBOARD_AMOUNT');}return total;}
 function dateKey(value){if(!monthOf(value))return '';const match=/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value.trim());return match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');}
 const recent=(rows,field)=>rows.slice().sort((a,b)=>dateKey(b[field]).localeCompare(dateKey(a[field]))||String(a.id||'').localeCompare(String(b.id||''))).slice(0,4);
 function summarize(rows,month=currentMonth(),cash=null){
  if(!Array.isArray(rows)||!isMonth(month)||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw Error('INVALID_DASHBOARD_DATA');
  if(cash!==null&&(typeof cash!=='number'||!Number.isSafeInteger(cash)||cash<0))throw Error('INVALID_DASHBOARD_CASH');
  const inventory=rows.filter(row=>row.status!=='판매완료'),sold=rows.filter(row=>row.status==='판매완료'),inMonth=(row,field,key)=>monthOf(row[field])===key;
  const inventoryCapital=sum(inventory,row=>row.inventoryCost),inventoryMargin=sum(inventory,row=>row.margin),monthPurchases=rows.filter(row=>inMonth(row,'purchaseAt',month)),monthSales=sold.filter(row=>inMonth(row,'soldAt',month)),yearSales=sold.filter(row=>{const key=monthOf(row.soldAt);return key&&key.slice(0,4)===month.slice(0,4)&&key<=month;});
  const totalInvestment=cash===null?null:money(inventoryCapital+cash),series=Array.from({length:3},(_,i)=>shiftMonth(month,i-2)).filter(Boolean).map(key=>{const purchases=rows.filter(row=>inMonth(row,'purchaseAt',key)),sales=sold.filter(row=>inMonth(row,'soldAt',key));return{month:key,purchases:purchases.length,sales:sales.length,margin:sum(sales,row=>row.margin)};});
  return{month,inventoryCapital,cash,totalInvestment,monthPurchaseCount:monthPurchases.length,monthSaleCount:monthSales.length,monthMargin:sum(monthSales,row=>row.margin),yearMargin:sum(yearSales,row=>row.margin),inventoryMargin,inventoryCount:inventory.length,soldCount:sold.length,series,inventoryRecent:recent(inventory,'purchaseAt'),soldRecent:recent(sold,'soldAt')};
 }
 return Object.freeze({isMonth,currentMonth,monthOf,dateKey,summarize});
});
