/* Sold vehicle counts. Date-only sales stay independent from list/search filters. */
(function(root,factory){
 const model=factory();
 if(typeof module==='object'&&module.exports)module.exports=model;
 if(!root?.document)return;
 root.SnoteSalesOverviewModel=model;
 const host=document.getElementById('snote-sales-overview');if(!host)return;
 const bridge=()=>root.snoteSalesOverviewBridge;
 let active=false,paintedKey=null,signature='',lastMonth='',scheduled=false;
 const number=value=>Number(value).toLocaleString('ko-KR');
 const node=(tag,text,cls)=>{const item=document.createElement(tag);if(text!=null)item.textContent=text;if(cls)item.className=cls;return item;};
 const svgNode=(tag,attributes)=>{const item=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[key,value]of Object.entries(attributes))item.setAttribute(key,String(value));return item;};
 function valid(snapshot){try{return !!snapshot&&typeof snapshot.key==='string'&&snapshot.key.length>0&&model.isMonth(snapshot.month)&&Array.isArray(snapshot.cars)&&typeof snapshot.loading==='boolean'&&bridge()?.current?.(snapshot.key)===true;}catch{return false;}}
 function state(text,loading=false){host.replaceChildren();host.dataset.state=loading?'loading':'unavailable';host.setAttribute('aria-busy',String(loading));const box=node('div',null,'sales-overview-state');box.append(node('h2','판매 현황'),node('p',text));host.append(box);signature='';}
 function select(month,key){if(!active||paintedKey!==key)return;try{const snapshot=bridge()?.snapshot();if(!valid(snapshot)||snapshot.loading||snapshot.key!==key)return;bridge().selectMonth(month);}catch{refresh();}}
 function metric(label,value,detail,tone){const item=node('div',null,'sales-overview-metric');item.append(node('dt',label),node('dd',value,tone?'is-'+tone:''),node('p',detail));return item;}
 function comparison(delta){return delta.change===0?'0대':(delta.change>0?'+':'−')+number(Math.abs(delta.change))+'대';}
 function detail(delta,label,count){return label+' '+number(count)+'대 · '+(delta.percent==null?'기준 0대':(delta.change>0?'+':delta.change<0?'−':'')+number(Math.abs(delta.percent))+'%');}
 function render(data,key){
  host.replaceChildren();host.dataset.state='ready';host.setAttribute('aria-busy','false');
  const heading=node('div',null,'sales-overview-head');heading.append(node('h2','판매 현황'),node('span',data.series[0].month.replace('-','.')+' — '+data.month.replace('-','.'),'sales-overview-period'));
  const metrics=node('dl',null,'sales-overview-metrics');metrics.append(metric('이번 달',number(data.current)+'대',Number(data.month.slice(5))+'월 판매 완료'),metric('전월 대비',comparison(data.previousDelta),detail(data.previousDelta,'전월',data.previous),data.previousDelta.tone),metric('전년 대비',comparison(data.yearDelta),detail(data.yearDelta,'전년 동월',data.lastYear),data.yearDelta.tone),metric('최근 6개월',number(data.total)+'대','월평균 '+number(Math.round(data.total/6*10)/10)+'대'));
  const body=node('div',null,'sales-overview-body'),chart=node('div',null,'sales-overview-chart');chart.setAttribute('role','group');chart.setAttribute('aria-label','최근 6개월 월별 판매 대수 선 그래프. 월을 선택하면 차량 목록을 볼 수 있습니다.');
  const max=Math.max(1,...data.series.map(item=>item.count));
  const points=data.series.map((item,index)=>({x:600*(index+.5)/data.series.length,y:84-item.count/max*64}));
  const svg=svgNode('svg',{viewBox:'0 0 600 100',preserveAspectRatio:'none',class:'sales-overview-line','aria-hidden':'true',focusable:'false'});
  for(const y of [20,52,84])svg.append(svgNode('line',{x1:0,y1:y,x2:600,y2:y,class:'sales-overview-grid-line'}));
  const coordinates=points.map(point=>point.x+','+point.y).join(' ');
  svg.append(svgNode('polygon',{points:points[0].x+',84 '+coordinates+' '+points.at(-1).x+',84',class:'sales-overview-line-area'}),svgNode('polyline',{points:coordinates,class:'sales-overview-line-path'}));
  chart.append(svg);
  for(const[index,item]of data.series.entries()){
   const button=node('button',null,'sales-overview-month');button.type='button';button.dataset.month=item.month;button.dataset.count=String(item.count);button.classList.toggle('is-current',item.month===data.month);button.setAttribute('aria-label',item.month.replace('-','년 ')+'월 · '+number(item.count)+'대 판매 · 차량 목록 보기');button.dataset.tooltip=item.month.replace('-','년 ')+'월 · '+number(item.count)+'대';
   const plot=node('span',null,'sales-overview-plot'),dot=node('span',null,'sales-overview-line-dot');dot.setAttribute('aria-hidden','true');plot.style.setProperty('--sales-point-y',String(points[index].y));plot.append(dot,node('strong',number(item.count)));button.append(plot,node('span',Number(item.month.slice(5))+'월','sales-overview-month-label'));button.onclick=()=>select(item.month,key);chart.append(button);
  }
  const footer=node('div',null,'sales-overview-foot');footer.append(node('span','월 선택 → 차량 목록 보기'));
  if(data.undated){const warning=node('button','판매일 확인 '+number(data.undated)+'대','sales-overview-undated');warning.type='button';warning.dataset.tooltip='판매일이 없거나 올바르지 않은 차량은 월별 집계에서 제외됩니다.';warning.setAttribute('aria-label','판매일 확인이 필요한 차량 '+number(data.undated)+'대 보기');warning.onclick=()=>select('undated',key);footer.append(warning);}
  body.append(metrics,chart);host.append(heading,body,footer);
 }
 function refresh(){
  scheduled=false;if(!active){host.hidden=true;host.replaceChildren();paintedKey=null;signature='';return;}host.hidden=false;
  let snapshot;try{snapshot=bridge()?.snapshot();}catch{paintedKey=null;state('판매 현황을 불러오지 못했습니다.');return;}
  if(!valid(snapshot)){paintedKey=null;state('판매 현황을 확인하고 있습니다.',true);return;}
  if(snapshot.key!==paintedKey){host.replaceChildren();signature='';paintedKey=snapshot.key;}
  if(snapshot.loading){state('판매 현황을 불러오는 중…',true);return;}
  const data=model.summarize(snapshot.cars,snapshot.month),next=JSON.stringify([snapshot.key,data]);
  lastMonth=snapshot.month;if(signature===next)return;signature=next;render(data,snapshot.key);
 }
 function schedule(){if(!scheduled){scheduled=true;queueMicrotask(refresh);}}
 root.addEventListener('snote:route-changed',event=>{active=event.detail?.page==='sell';refresh();});
 root.addEventListener('snote:sales-data-changed',schedule);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&active)schedule();});
 // The bridge is synchronous; this also removes the prior account's counts if auth changes without a render event.
 setInterval(()=>{if(!active)return;let snapshot;try{snapshot=bridge()?.snapshot();}catch{return refresh();}if(!valid(snapshot)||snapshot.key!==paintedKey||snapshot.loading||snapshot.month!==lastMonth)refresh();},1000);
 try{active=typeof route==='string'&&route==='sell';}catch{active=false;}refresh();
})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const isMonth=value=>typeof value==='string'&&/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(value);
 function shiftMonth(value,amount){if(!isMonth(value)||!Number.isInteger(amount))throw Error('INVALID_MONTH');const[year,month]=value.split('-').map(Number),absolute=year*12+month-1+amount,y=Math.floor(absolute/12),m=absolute-y*12+1;return y>=1&&y<=9999?String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0'):null;}
 function currentMonth(date=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).formatToParts(date);return parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;}
 function soldMonth(value){if(typeof value!=='string')return null;const match=/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value.trim());if(!match||match[1]==='0000')return null;const key=match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0'),time=Date.parse(key+'T00:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===key?key.slice(0,7):null;}
 function compare(current,baseline){const change=current-baseline;return{change,percent:baseline===0?null:Math.round(change/baseline*1000)/10,tone:change>0?'up':change<0?'down':'same'};}
 function summarize(cars,month=currentMonth()){
  if(!isMonth(month)||!Array.isArray(cars))throw Error('INVALID_SALES_DATA');
  const counts=new Map();let undated=0;
  for(const car of cars){if(car?.status!=='판매완료')continue;const key=soldMonth(car.soldAt);if(key)counts.set(key,(counts.get(key)||0)+1);else undated++;}
  const series=Array.from({length:6},(_,i)=>shiftMonth(month,i-5)).filter(Boolean).map(key=>({month:key,count:counts.get(key)||0})),current=counts.get(month)||0,previous=counts.get(shiftMonth(month,-1))||0,lastYear=counts.get(shiftMonth(month,-12))||0;
  return{month,series,current,previous,lastYear,previousDelta:compare(current,previous),yearDelta:compare(current,lastYear),total:series.reduce((sum,item)=>sum+item.count,0),undated};
 }
 return Object.freeze({isMonth,shiftMonth,currentMonth,soldMonth,compare,summarize});
});
