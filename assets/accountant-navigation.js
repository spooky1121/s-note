/* Accountant workspace presentation only. Authorization and data reads belong to the host bridge. */
(()=>{'use strict';
 if(window.SnoteAccountantNavigation)return;
 const freeze=Object.freeze;
 const definitions=freeze({
  dashboard:freeze({label:'대시보드',icon:'home'}),
  contractArchive:freeze({label:'차량서류',icon:'car'}),
  contractOffice:freeze({label:'양식지',icon:'form'}),
  buy:freeze({label:'매입·매도',icon:'trade'}),
  sell:freeze({label:'매입·매도',icon:'trade'}),
  acctCustomers:freeze({label:'매입·매도',icon:'trade'}),
  acctOperations:freeze({label:'운영 서류함',icon:'folder'}),
  acctBank:freeze({label:'은행',icon:'bank'}),
  acctTax:freeze({label:'세금',icon:'receipt'}),
  inventoryFinance:freeze({label:'재고금융',icon:'wallet'}),
  prestock:freeze({label:'재고금융',icon:'wallet'}),
  acctLookup:freeze({label:'조회',icon:'search'}),
  acctDealerIncome:freeze({label:'딜러소득',icon:'income'}),
  monthly:freeze({label:'운영정산',icon:'calendar'}),
  acctInfo:freeze({label:'정보',icon:'info'}),
  acctAccounts:freeze({label:'계좌',icon:'account'}),
  acctPhones:freeze({label:'전화번호',icon:'phone'}),
  acctStaff:freeze({label:'직원',icon:'people'})
 });
 const basicPages=freeze(['acctOperations','acctBank','acctTax','acctLookup','acctDealerIncome','acctAccounts','acctPhones','acctStaff']);
 const leaf=(page,aliases=[])=>freeze({page,aliases:freeze(aliases)});
 const menu=freeze([
  leaf('dashboard'),
  freeze({group:'documents',label:'서류함',icon:'folder',children:freeze([leaf('contractArchive'),leaf('contractOffice'),leaf('buy',['sell','acctCustomers']),leaf('acctOperations')])}),
  leaf('acctBank'),leaf('acctTax'),leaf('inventoryFinance',['prestock']),leaf('acctLookup'),
  freeze({group:'settlement',label:'정산',icon:'income',children:freeze([leaf('acctDealerIncome'),leaf('monthly')])}),
  leaf('acctInfo',['acctAccounts','acctPhones','acctStaff'])
 ]);
 const paths=freeze({
  home:'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  car:'m4 10 2-5h12l2 5M3 10h18v8H3zM6 18v3m12-3v3M6 14h2m8 0h2',
  form:'M14 3H5v18h14V8zM14 3v5h5M8 12h8m-8 4h6',
  trade:'M4 7h15l-4-4m4 4-4 4M20 17H5l4 4m-4-4 4-4',
  folder:'M3 7V4h7l2 3h9v13H3z',
  bank:'m3 9 9-6 9 6H3m2 3v6m5-6v6m4-6v6m5-6v6M3 21h18',
  receipt:'M5 3h14v18l-3-2-4 2-4-2-3 2V3m3 5h8m-8 4h8m-8 4h5',
  wallet:'M3 6h17v15H3zM3 6V3h15v3m-3 6h6v5h-6z',
  search:'M16.5 16.5 21 21M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',
  income:'M4 21V10m6 11V3m6 18v-8m5 8H2m2-15 6-4 6 7 5-4',
  calendar:'M4 5h16v16H4zM8 3v4m8-4v4M4 10h16m-12 4h2m4 0h2m-8 4h2',
  account:'M3 5h18v14H3zM3 9h18M6 15h5m5 0h2',
  phone:'M7 3 4 4c-2 1 0 7 4 11s10 6 11 4l1-3-5-3-2 2-4-4 2-2z',
  people:'M10 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0m10 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0M2 21v-3a5 5 0 0 1 10 0v3m2-7a5 5 0 0 1 8 4v3',
  info:'M12 10v7m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  chevron:'m8 10 4 4 4-4',arrow:'M4 12h15m-5-5 5 5-5 5'
 });
 let hosts=new WeakMap(),sequence=0;
 const motions=new Map(),reducedMotion=window.matchMedia('(prefers-reduced-motion:reduce)');
 function finishMotion(children){
  const motion=motions.get(children);if(!motion)return;
  motions.delete(children);children.hidden=!motion.open;children.classList.remove('is-sliding');motion.animation.cancel();
 }
 function finishMotions(host){for(const children of motions.keys())if(!host||host.contains(children))finishMotion(children);}
 function disclose(trigger,children,open){
  const hidden=children.hidden,style=getComputedStyle(children);
  const start={height:hidden?'0px':children.getBoundingClientRect().height+'px',opacity:hidden?'0':style.opacity,marginTop:hidden?'0px':style.marginTop,marginBottom:hidden?'0px':style.marginBottom};
  finishMotion(children);
  trigger.setAttribute('aria-expanded',String(open));children.inert=!open;children.setAttribute('aria-hidden',String(!open));
  if(!open&&children.contains(document.activeElement))trigger.focus({preventScroll:true});
  if(reducedMotion.matches||typeof children.animate!=='function'){children.hidden=!open;return;}
  children.hidden=false;
  const natural=getComputedStyle(children),end=open?{height:children.getBoundingClientRect().height+'px',opacity:natural.opacity,marginTop:natural.marginTop,marginBottom:natural.marginBottom}:{height:'0px',opacity:'0',marginTop:'0px',marginBottom:'0px'};
  children.classList.add('is-sliding');
  const animation=children.animate([start,end],{duration:280,easing:'cubic-bezier(.22,.75,.2,1)',fill:'both'});
  motions.set(children,{animation,open});
  animation.finished.then(()=>{if(motions.get(children)?.animation===animation)finishMotion(children);},()=>{});
 }
 reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches)finishMotions();});
 function node(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
 function icon(name){const e=document.createElementNS('http://www.w3.org/2000/svg','svg'),p=document.createElementNS(e.namespaceURI,'path');e.setAttribute('viewBox','0 0 24 24');e.setAttribute('aria-hidden','true');e.setAttribute('fill','none');e.setAttribute('stroke','currentColor');e.setAttribute('stroke-width','1.7');e.setAttribute('stroke-linecap','round');e.setAttribute('stroke-linejoin','round');p.setAttribute('d',paths[name]||paths.form);e.append(p);return e;}
 function label(page){return definitions[page]?.label||'';}
 function selected(item,route){return item.page===route||item.aliases?.includes(route);}
 function renderMenu(host,{route,navigate}={}){
  if(!(host instanceof Element))return false;
  finishMotions(host);
  let state=hosts.get(host);if(!state){state={id:++sequence,closed:new Set(menu.filter(item=>item.group).map(item=>item.group)),route:null};hosts.set(host,state);}
  const first=state.route===null,changed=state.route!==route;state.route=route;
  const go=typeof navigate==='function'?navigate:()=>false;
  const fragment=document.createDocumentFragment();
  function button(item,child=false){
   const info=definitions[item.page],e=node('button','snote-acct-nav-button'+(selected(item,route)?' active':''));
   e.type='button';e.dataset.page=item.page;e.dataset.navLabel=info.label;e.setAttribute('aria-label',info.label);e.title=info.label;
   if(selected(item,route))e.setAttribute('aria-current','page');
   if(child)e.dataset.accountantChild='true';
   e.append(icon(info.icon),node('span','snote-nav-label',info.label));e.addEventListener('click',()=>go(item.page));return e;
  }
  for(const item of menu){
   if(!item.group){const wrap=node('div','snote-acct-nav-entry');wrap.append(button(item));fragment.append(wrap);continue;}
   const active=item.children.some(child=>selected(child,route));if(!first&&changed&&active)state.closed.delete(item.group);
   const wrap=node('div','snote-acct-nav-group'),trigger=node('button','snote-acct-nav-group-trigger'+(active?' contains-current':'')),children=node('div','snote-acct-nav-children');
   wrap.dataset.accountantGroup=item.group;trigger.type='button';trigger.dataset.accountantGroupToggle=item.group;trigger.dataset.navLabel=item.label;trigger.title=item.label;trigger.setAttribute('aria-label',item.label);
   children.id='snote-acct-nav-'+state.id+'-'+item.group;trigger.setAttribute('aria-controls',children.id);
   const expanded=!state.closed.has(item.group);trigger.setAttribute('aria-expanded',String(expanded));children.hidden=!expanded;children.inert=!expanded;children.setAttribute('aria-hidden',String(!expanded));
   const chevron=icon('chevron');chevron.classList.add('snote-acct-nav-chevron');trigger.append(icon(item.icon),node('span','snote-nav-label',item.label),chevron);
   trigger.addEventListener('click',()=>{const open=trigger.getAttribute('aria-expanded')!=='true';if(open)state.closed.delete(item.group);else state.closed.add(item.group);disclose(trigger,children,open);});
   for(const child of item.children)children.append(button(child,true));wrap.append(trigger,children);fragment.append(wrap);
  }
  host.dataset.accountantNavigation='true';host.replaceChildren(fragment);return true;
 }
 function renderTabs(host,{route,navigate}={}){
  if(!(host instanceof Element))return false;
  const tabs=['buy','sell','acctCustomers'].includes(route)?[['buy','매입 관리'],['sell','판매 완료'],['acctCustomers','고객']]:['inventoryFinance','prestock'].includes(route)?[['inventoryFinance','재고금융 관리'],['prestock','선재고 관리']]:null;
  host.replaceChildren();host.hidden=!tabs;if(!tabs)return false;
  host.classList.add('snote-acct-page-tabs');host.setAttribute('aria-label',['buy','sell','acctCustomers'].includes(route)?'매입·매도 화면':'재고금융 화면');
  for(const[page,text]of tabs){const e=node('button',route===page?'active':'',text);e.type='button';e.dataset.accountantTab=page;e.dataset.page=page;if(route===page)e.setAttribute('aria-current','page');e.addEventListener('click',()=>typeof navigate==='function'&&navigate(page));host.append(e);}return true;
 }
 const content=freeze({
  acctOperations:freeze({description:'상사 운영에 필요한 문서를 모아보는 공간입니다.',empty:'운영 문서 보관 기능을 준비하고 있습니다.',link:'저장된 매입·매도 문서 보기',page:'contractArchive'}),
  acctBank:freeze({description:'은행 업무와 입출금 내역을 정리하는 공간입니다.',empty:'은행 업무 기능을 준비하고 있습니다.',link:'선재고 계좌·거래 내역 보기',page:'prestock'}),
  acctTax:freeze({description:'상사 세금 업무를 정리하는 공간입니다.',empty:'세금 업무 기능을 준비하고 있습니다.'}),
  acctLookup:freeze({description:'차량과 업무 자료를 확인하는 공간입니다.',empty:'조회 기능을 준비하고 있습니다.',link:'차량서류 조회',page:'contractArchive'}),
  acctDealerIncome:freeze({description:'딜러별 소득 정산을 확인하는 공간입니다.',empty:'판매완료 차량에서 기존 소득정산을 확인할 수 있습니다.',link:'판매완료 차량 보기',page:'sell'}),
  acctAccounts:freeze({description:'업무에 필요한 계좌 정보를 확인하는 공간입니다.',empty:'계좌 정보 모아보기를 준비하고 있습니다.',link:'선재고 계좌 보기',page:'prestock'}),
  acctPhones:freeze({description:'같은 상사 직원의 업무 연락처를 확인하세요.'}),
  acctStaff:freeze({description:'같은 상사 직원의 정보를 확인하세요.'})
 });
 function memberTable(host,page,members){
  if(!Array.isArray(members)){host.append(node('p','snote-acct-basic-empty','직원 정보를 확인한 뒤 표시합니다.'));return;}
  const rows=members.filter(row=>row&&typeof row==='object'&&typeof row.name==='string'&&row.name.trim()).slice(0,1000);
  if(!rows.length){host.append(node('p','snote-acct-basic-empty','등록된 직원 정보가 없습니다.'));return;}
  const wrap=node('div','snote-acct-info-scroll'),table=node('table','snote-acct-info-table'),head=node('thead'),header=node('tr'),body=node('tbody');
  for(const text of(page==='acctPhones'?['직원명','전화번호']:['직원명','직책','상태'])){const e=node('th','',text);e.scope='col';header.append(e);}head.append(header);
  for(const row of rows){const tr=node('tr'),name=String(row.name).slice(0,100),role=({admin:'대표·관리자',accountant:'경리',dealer:'딜러'})[row.role]||'직원';
   for(const text of(page==='acctPhones'?[name,String(row.phone||'미등록').slice(0,40)]:[name,role,row.active===false?'비활성':'활성']))tr.append(node('td','',text));body.append(tr);
  }
  table.append(head,body);wrap.append(table);host.append(wrap);
 }
 function mountPage(host,page,{members,ready=false,navigate}={}){
  if(!(host instanceof Element)||!basicPages.includes(page))return false;
  const info=content[page],section=node('section','snote-acct-basic-page');section.dataset.accountantPage=page;section.setAttribute('aria-label',label(page));
  if(page==='acctPhones'||page==='acctStaff')memberTable(section,page,ready===true?members:undefined);
  else{const empty=node('div','snote-acct-basic-state');empty.append(icon(definitions[page].icon),node('p','',info.empty));section.append(empty);}
  if(info.page&&typeof navigate==='function'){const link=node('button','snote-acct-basic-link',info.link);link.type='button';link.dataset.accountantLink=info.page;link.append(icon('arrow'));link.addEventListener('click',()=>navigate(info.page));section.append(link);}
  host.replaceChildren(section);return true;
 }
 function reset(){finishMotions();hosts=new WeakMap();}
 window.SnoteAccountantNavigation=freeze({definitions,menu,menuPages:freeze(Object.keys(definitions)),basicPages,isPage:page=>basicPages.includes(page),label,renderMenu,renderTabs,mountPage,reset});
 window.addEventListener('snote:auth-reset',reset);
 window.dispatchEvent(new Event('snote:accountant-navigation-ready'));
})();
