/* Purchase-date counts include sold vehicles and remain independent from inventory filters. */
(function(root,factory){
 const calendar=typeof module==='object'&&module.exports?require('./sales-overview.js'):root?.SnoteSalesOverviewModel;
 if(!calendar)return;
 const model=factory(calendar);
 if(typeof module==='object'&&module.exports)module.exports=model;
 if(!root?.document)return;
 root.SnotePurchaseOverviewModel=model;
 const host=document.getElementById('snote-purchase-overview');if(!host)return;
 const bridge=()=>root.snotePurchaseOverviewBridge;
 let active=false,paintedKey=null,signature='',lastMonth='',scheduled=false;
 const number=value=>Number(value).toLocaleString('ko-KR');
 const node=(tag,text,cls)=>{const item=document.createElement(tag);if(text!=null)item.textContent=text;if(cls)item.className=cls;return item;};
 const svgNode=(tag,attributes)=>{const item=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[key,value]of Object.entries(attributes))item.setAttribute(key,String(value));return item;};
 function valid(snapshot){try{return !!snapshot&&typeof snapshot.key==='string'&&snapshot.key.length>0&&model.isMonth(snapshot.month)&&Array.isArray(snapshot.cars)&&typeof snapshot.loading==='boolean'&&bridge()?.current?.(snapshot.key)===true;}catch{return false;}}
 function state(text,loading=false){host.replaceChildren();host.dataset.state=loading?'loading':'unavailable';host.setAttribute('aria-busy',String(loading));const box=node('div',null,'sales-overview-state');box.append(node('h2','매입 현황'),node('p',text));host.append(box);signature='';}
 function metric(label,value,detail,tone){const item=node('div',null,'sales-overview-metric');item.append(node('dt',label),node('dd',value,tone?'is-'+tone:''),node('p',detail));return item;}
 function comparison(delta){return delta.change===0?'0대':(delta.change>0?'+':'−')+number(Math.abs(delta.change))+'대';}
 function detail(delta,label,count){return label+' '+number(count)+'대 · '+(delta.percent==null?'기준 0대':(delta.change>0?'+':delta.change<0?'−':'')+number(Math.abs(delta.percent))+'%');}
 function render(data){
  host.replaceChildren();host.dataset.state='ready';host.setAttribute('aria-busy','false');
  const heading=node('div',null,'sales-overview-head');heading.append(node('h2','매입 현황'),node('span',data.series[0].month.replace('-','.')+' — '+data.month.replace('-','.'),'sales-overview-period'));
  const metrics=node('dl',null,'sales-overview-metrics');metrics.append(metric('이번 달',number(data.current)+'대',Number(data.month.slice(5))+'월 매입'),metric('전월 대비',comparison(data.previousDelta),detail(data.previousDelta,'전월',data.previous),data.previousDelta.tone),metric('전년 대비',comparison(data.yearDelta),detail(data.yearDelta,'전년 동월',data.lastYear),data.yearDelta.tone),metric('최근 6개월',number(data.total)+'대','월평균 '+number(Math.round(data.total/6*10)/10)+'대'));
  const body=node('div',null,'sales-overview-body'),chart=node('div',null,'sales-overview-chart');chart.setAttribute('role','group');chart.setAttribute('aria-label','최근 6개월 월별 매입 대수 선 그래프. 판매 완료된 본인 차량도 포함합니다.');
  const max=Math.max(1,...data.series.map(item=>item.count));
  const points=data.series.map((item,index)=>({x:600*(index+.5)/data.series.length,y:84-item.count/max*64}));
  const svg=svgNode('svg',{viewBox:'0 0 600 100',preserveAspectRatio:'none',class:'sales-overview-line','aria-hidden':'true',focusable:'false'});
  for(const y of [20,52,84])svg.append(svgNode('line',{x1:0,y1:y,x2:600,y2:y,class:'sales-overview-grid-line'}));
  const coordinates=points.map(point=>point.x+','+point.y).join(' ');
  svg.append(svgNode('polygon',{points:points[0].x+',84 '+coordinates+' '+points.at(-1).x+',84',class:'sales-overview-line-area'}),svgNode('polyline',{points:coordinates,class:'sales-overview-line-path'}));
  chart.append(svg);
  for(const[index,item]of data.series.entries()){
   const point=node('span',null,'sales-overview-month');point.tabIndex=0;point.setAttribute('role','img');point.dataset.month=item.month;point.dataset.count=String(item.count);point.classList.toggle('is-current',item.month===data.month);point.setAttribute('aria-label',item.month.replace('-','년 ')+'월 · '+number(item.count)+'대 매입');point.dataset.tooltip=item.month.replace('-','년 ')+'월 · '+number(item.count)+'대 매입';
   const plot=node('span',null,'sales-overview-plot'),dot=node('span',null,'sales-overview-line-dot');dot.setAttribute('aria-hidden','true');plot.style.setProperty('--sales-point-y',String(points[index].y));plot.append(dot,node('strong',number(item.count)));point.append(plot,node('span',Number(item.month.slice(5))+'월','sales-overview-month-label'));chart.append(point);
  }
  const footer=node('div',null,'sales-overview-foot');
  if(data.undated){const warning=node('span','매입일 확인 '+number(data.undated)+'대','sales-overview-undated');warning.tabIndex=0;warning.dataset.tooltip='매입일이 없거나 올바르지 않은 차량은 월별 집계에서 제외됩니다.';warning.setAttribute('role','img');warning.setAttribute('aria-label','매입일 확인이 필요한 차량 '+number(data.undated)+'대');footer.append(warning);}
  body.append(metrics,chart);host.append(heading,body);if(data.undated)host.append(footer);
 }
 function refresh(){
  scheduled=false;if(!active){host.hidden=true;host.replaceChildren();paintedKey=null;signature='';return;}host.hidden=false;
  let snapshot;try{snapshot=bridge()?.snapshot();}catch{paintedKey=null;state('매입 현황을 불러오지 못했습니다.');return;}
  if(!valid(snapshot)){paintedKey=null;state('매입 현황을 확인하고 있습니다.',true);return;}
  if(snapshot.key!==paintedKey){host.replaceChildren();signature='';paintedKey=snapshot.key;}
  if(snapshot.loading){state('매입 현황을 불러오는 중…',true);return;}
  const data=model.summarize(snapshot.cars,snapshot.month),next=JSON.stringify([snapshot.key,data]);
  lastMonth=snapshot.month;if(signature===next)return;signature=next;render(data);
 }
 function schedule(){if(!scheduled){scheduled=true;queueMicrotask(refresh);}}
 root.addEventListener('snote:route-changed',event=>{active=event.detail?.page==='buy';refresh();});
 root.addEventListener('snote:sales-data-changed',schedule);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&active)schedule();});
 // The bridge is synchronous; this also removes the prior account's counts if auth changes without a render event.
 setInterval(()=>{if(!active)return;let snapshot;try{snapshot=bridge()?.snapshot();}catch{return refresh();}if(!valid(snapshot)||snapshot.key!==paintedKey||snapshot.loading||snapshot.month!==lastMonth)refresh();},1000);
 try{active=typeof route==='string'&&route==='buy';}catch{active=false;}refresh();
})(typeof window==='object'?window:globalThis,function(calendar){
 'use strict';
 // Use the same Korean calendar, complete-date validation and comparison rules as sales.
 const {isMonth,shiftMonth,currentMonth,compare}=calendar,purchaseMonth=calendar.soldMonth;
 function summarize(cars,month=currentMonth()){
  if(!isMonth(month)||!Array.isArray(cars))throw Error('INVALID_PURCHASE_DATA');
  const counts=new Map();let undated=0;
  for(const car of cars){const key=purchaseMonth(car?.purchaseAt);if(key)counts.set(key,(counts.get(key)||0)+1);else undated++;}
  const series=Array.from({length:6},(_,i)=>shiftMonth(month,i-5)).filter(Boolean).map(key=>({month:key,count:counts.get(key)||0})),current=counts.get(month)||0,previous=counts.get(shiftMonth(month,-1))||0,lastYear=counts.get(shiftMonth(month,-12))||0;
  return{month,series,current,previous,lastYear,previousDelta:compare(current,previous),yearDelta:compare(current,lastYear),total:series.reduce((sum,item)=>sum+item.count,0),undated};
 }
 return Object.freeze({isMonth,shiftMonth,currentMonth,purchaseMonth,compare,summarize});
});
