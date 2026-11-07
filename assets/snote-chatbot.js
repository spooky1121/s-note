/* Local Snote help: fixed FAQs, no AI/provider requests or browser storage. */
(()=>{'use strict';
 if(window.SnoteChatbot)return;
 const topics=[
  {id:'purchase',label:'차량 등록',pattern:/매입|차량\s*등록|신규|등록증.*등록/,text:'매입 관리 목록 제목 옆의 파란 + 아이콘으로 차량을 등록할 수 있어요. 자동차등록증 아이콘을 누르면 등록증으로 등록을 시작해요. 차량 정보와 매입가·판매예정가를 확인한 뒤 등록해 주세요.',route:'buy',action:'매입 관리 열기'},
  {id:'sale',label:'판매 진행',pattern:/판매|매도|고객\s*서명|싸인|사인/,text:'차량 상세 상단의 판매진행 아이콘을 눌러 주세요. 고객 정보와 판매 금액을 확인하고 저장한 뒤, 판매완료확정으로 마무리해요. 고객이 휴대전화로 제출한 서명은 계약서와 인수증의 고객 서명란에 반영돼요.',route:'buy',action:'매입 관리 열기'},
  {id:'documents',label:'서류 · 문자 공유',pattern:/서류|문자|mms|솔라피|성능|등록증.*공유/i,text:'차량 상세의 차량 서류에서 자동차등록증 또는 성능기록부를 선택해 주세요. 제목 오른쪽 공유 아이콘을 누르면 받는 번호와 첨부 사진을 확인하고 문자로 보낼 수 있어요. 등록된 딜러 번호의 발신번호 승인 상태도 확인해 주세요.'},
  {id:'print',label:'문서 인쇄',pattern:/인쇄|출력|프린트|프린터|계약서|견적서|인수증/,text:'견적서는 차량 상세 상단에서, 계약서와 인수증은 판매진행에서 열 수 있어요. 미리보기 오른쪽 위 빨간 프린터 아이콘으로 인쇄하고 X로 닫아 주세요. 계약서·인수증을 닫으면 판매진행으로 돌아와요.'},
  {id:'restore',label:'휴지통 · 복원',pattern:/휴지통|복원|삭제|지웠|지운/,text:'설정의 휴지통에서 삭제한 차량·고객 정보·개별 사진과 서류를 확인하고 복원할 수 있어요. 연결된 차량도 삭제된 상태라면 차량을 먼저 복원해 주세요.',route:'recycle',action:'휴지통 열기'},
  {id:'calculator',label:'계산기',pattern:/계산기|계산\s*방법|더하기|빼기/,text:'화면 오른쪽 위 계산기 아이콘을 눌러 주세요. 숫자와 연산을 입력하고 Enter 또는 =로 계산해요. Esc로 닫을 수 있어요.',control:'calculator',action:'계산기 열기'},
  {id:'profile',label:'계정 · 프로필',pattern:/프로필|계정|설정|연락처|전화번호.*변경|비밀번호.*변경|얼굴|사진.*프로필/,text:'오른쪽 위 프로필의 프로필 설정에서 이름·프로필 사진·비밀번호 등을 관리할 수 있어요. 개인 연락처는 전화번호 인증 후 변경해요. 이메일은 수정 항목이 아니며 주소는 상사 주소를 사용해요.',control:'profile',action:'프로필 설정 열기'},
  {id:'customer',label:'고객 검색',pattern:/고객|검색|조회|찾기/,text:'고객 관리의 통합 검색창에 이름·전화번호·차량번호·주소·차명·제조사 등을 입력해 주세요. 이 도움말은 실제 차량이나 고객 자료를 조회하지 않고 화면 사용법만 안내해요.',route:'users',action:'고객 관리 열기'},
  {id:'sharing',label:'차량 공유 · 알림',pattern:/공유|알림|다른\s*딜러/,text:'차량 상세 상단의 공유 아이콘에서 함께 볼 딜러의 가입 이메일을 입력해요. 공유받은 딜러도 차량 정보를 수정할 수 있어요. 공유 매물이 등록되거나 변경되면 프로필 안의 알림에서 수정 내용을 확인해 주세요.'},
  {id:'money',label:'금액 · 재고 이자',pattern:/금액|원단위|만원|이자|재고금융|대출|마진|수익/,text:'금액은 원 단위로 입력하며 천 단위 콤마가 표시돼요. 재고 이자는 설정된 금융사 이율과 재고대출금을 기준으로 일할 계산하며, 비용과 예상 마진 계산에 반영돼요. 금융사 이율과 매입 날짜를 함께 확인해 주세요.'},
  {id:'login',label:'로그인 도움',public:true,pattern:/로그인|접속|인증\s*메일|이메일\s*인증/,text:'가입한 이메일과 비밀번호로 로그인해 주세요. 가입 직후라면 이메일 인증을 먼저 완료해요. 메일이 보이지 않으면 스팸함과 가입 이메일을 확인하고, 계속 접속되지 않으면 상사 관리자에게 계정 상태를 확인해 달라고 요청해 주세요.'},
  {id:'signup',label:'가입 · 직원 초대',public:true,pattern:/가입|회원|직원|초대/,text:'새 상사를 개설할 때는 신규 관리자 가입을, 이미 있는 상사에 들어갈 때는 초대받은 직원 가입을 선택해 주세요. 직원은 관리자가 초대한 이메일과 초대 코드가 필요해요.'},
  {id:'password',label:'비밀번호 도움',public:true,pattern:/비밀번호|패스워드|암호/,text:'로그인할 수 있다면 프로필 설정에서 현재 비밀번호를 확인하고 새 비밀번호로 변경할 수 있어요. 비밀번호를 잊어 로그인하지 못한다면 상사 관리자에게 가입 이메일과 계정 상태를 먼저 확인해 달라고 요청해 주세요. 비밀번호나 인증번호는 이곳에 입력하지 않아도 돼요.'},
 ];
 const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 const robot='<svg viewBox="0 0 80 80" aria-hidden="true" focusable="false"><path fill="#fff" stroke="#152c50" stroke-width="3.5" stroke-linejoin="round" d="M40 5a34 34 0 0 0-29.1 51.6L6 74l18.7-7.6A34 34 0 1 0 40 5Z"/><path d="M40 19v6" fill="none" stroke="#152c50" stroke-width="3" stroke-linecap="round"/><circle cx="40" cy="17" r="3" fill="#fff" stroke="#152c50" stroke-width="2.5"/><rect x="17" y="35" width="6" height="13" rx="3" fill="#fff" stroke="#152c50" stroke-width="3"/><rect x="57" y="35" width="6" height="13" rx="3" fill="#fff" stroke="#152c50" stroke-width="3"/><rect x="23" y="26" width="34" height="31" rx="12" fill="#fff" stroke="#152c50" stroke-width="3"/><circle cx="32" cy="38" r="3" fill="#152c50"/><circle cx="48" cy="38" r="3" fill="#152c50"/><path d="M32 47q8 7 16 0" fill="none" stroke="#152c50" stroke-width="3" stroke-linecap="round"/></svg>';
 let root,launcher,panel,log,input,chips,opened=false,scheduled=false,lastScope,mode='public';
 function visible(e){if(!e||e.hidden||e.closest('[hidden],[inert]')||e.getAttribute('aria-hidden')==='true'||!e.getClientRects().length)return false;const s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&s.visibility!=='collapse';}
 function scope(){try{return typeof currentUser==='object'&&currentUser?currentUser:null;}catch{return null;}}
 function workspace(){try{return typeof window.snoteWorkspaceVisible==='function'&&window.snoteWorkspaceVisible()===true;}catch{return false;}}
 function blocked(){return [...document.querySelectorAll('dialog[open],[role="dialog"],.overlay,.snote-profile-menu,.mobile-drawer')].some(e=>!root.contains(e)&&!e.closest('#zc-cloud-gate,#auth-shell')&&visible(e));}
 function allowed(topic){if(!workspace())return false;if(topic.route)return typeof window.navigate==='function'&&typeof window.snotePageAllowed==='function'&&window.snotePageAllowed(topic.route)===true;if(topic.control==='calculator'){const trigger=document.getElementById('snote-calculator-trigger');return visible(trigger)&&!trigger.disabled;}if(topic.control==='profile')return typeof window.snoteProfileEditor?.open==='function'&&visible(document.getElementById('snote-profile-trigger'));return false;}
 function position(){
  const vv=window.visualViewport,top=vv?.offsetTop||0,height=vv?.height||innerHeight,right=Math.max(12,innerWidth-((vv?.offsetLeft||0)+(vv?.width||innerWidth))+16),edge=top+height;
  let obstruction=0;
  if(workspace())for(const nav of document.querySelectorAll('.bottom-nav,#bottom-nav'))if(visible(nav)){const r=nav.getBoundingClientRect();if(r.top<edge&&r.bottom>edge-160)obstruction=Math.max(obstruction,edge-r.top);}
  const bottom=Math.max(12,innerHeight-edge+obstruction+12),room=Math.max(120,height-obstruction-104);
  for(const [key,value]of[['--snote-chatbot-bottom',bottom+'px'],['--snote-chatbot-right',right+'px'],['--snote-chatbot-room',room+'px']])if(root.style.getPropertyValue(key)!==value)root.style.setProperty(key,value);
 }
 function message(text,kind='assistant',topic=null){
  const item=node('div','snote-chat-message is-'+kind),body=node('p',null,text);item.append(body);
  if(topic?.action&&allowed(topic)){const action=node('button','snote-chat-action',topic.action);action.type='button';action.addEventListener('click',()=>{syncScope();if(!opened)return;if(!allowed(topic)){message('현재 계정에서 사용할 수 있는 메뉴를 확인해 주세요.');return;}close(false);if(topic.route)window.navigate(topic.route);else if(topic.control==='calculator')document.getElementById('snote-calculator-trigger').click();else window.snoteProfileEditor.open();schedule();});item.append(action);}
  log.append(item);while(log.children.length>50)log.firstElementChild.remove();log.parentElement.scrollTop=log.parentElement.scrollHeight;
 }
 function choices(){chips.replaceChildren();const ids=mode==='workspace'?['purchase','sale','documents','restore','calculator','profile']:['login','signup','password'];for(const id of ids){const topic=topics.find(t=>t.id===id),button=node('button','snote-chat-chip',topic.label);button.type='button';button.addEventListener('click',()=>answer(topic.label,topic));chips.append(button);}}
 function reset(){if(!root)return;close(false);log.replaceChildren();input.value='';mode=workspace()?'workspace':'public';choices();message(mode==='workspace'?'안녕하세요. Snote 사용 방법을 안내해 드릴게요. 궁금한 메뉴를 골라 주세요.':'안녕하세요. 로그인과 가입 방법을 안내해 드릴게요. 궁금한 내용을 골라 주세요.');}
 function syncScope(){const next=scope(),nextMode=workspace()?'workspace':'public';if(next!==lastScope||nextMode!==mode){lastScope=next;reset();}}
 function answer(value,chosen){syncScope();if(!opened)return;const text=String(value||'').trim().slice(0,400);if(!text)return;message(text,'user');input.value='';const candidates=mode==='workspace'?topics:topics.filter(t=>t.public),topic=chosen&&candidates.includes(chosen)?chosen:candidates.find(t=>t.pattern.test(text));if(topic)message(topic.text,'assistant',topic);else message(mode==='workspace'?'Snote의 화면 사용법을 안내하는 도움말이에요. 차량 등록·판매 진행·서류·휴지통·계산기·설정 중 궁금한 메뉴를 적어 주세요. 실제 계정이나 자료 문제는 상사 관리자에게 문의해 주세요.':'로그인·가입·비밀번호 사용법을 안내해요. 관련 메뉴를 골라 주세요. 계정 확인이 필요한 문제는 상사 관리자에게 문의해 주세요.');}
 function close(restore=true){if(!panel)return;opened=false;panel.hidden=true;panel.inert=true;launcher.setAttribute('aria-expanded','false');launcher.setAttribute('aria-label','Snote 도움말 열기');if(restore&&visible(launcher))launcher.focus({preventScroll:true});else if(panel.contains(document.activeElement))document.activeElement.blur();}
 function open(){if(!root)return;syncScope();refresh();if(root.hidden)return;window.snoteCloseProfileMenu?.();opened=true;panel.hidden=false;panel.inert=false;launcher.setAttribute('aria-expanded','true');launcher.setAttribute('aria-label','Snote 도움말 닫기');position();(innerWidth>760?input:panel).focus({preventScroll:true});log.parentElement.scrollTop=log.parentElement.scrollHeight;}
 function refresh(){if(!root)return;syncScope();const gate=document.getElementById('zc-cloud-gate'),auth=document.getElementById('auth-shell'),host=!workspace()&&visible(gate)?gate:!workspace()&&visible(auth)?auth:document.body;if(root.parentElement!==host)host.append(root);position();const hide=blocked();if(hide&&opened)close(false);if(root.hidden!==hide)root.hidden=hide;}
 function schedule(){if(scheduled||!root)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;refresh();});}
 function mount(){
  root=node('aside');root.id='snote-chatbot';root.setAttribute('aria-label','Snote 사용 도움말');
  launcher=node('button');launcher.id='snote-chatbot-launcher';launcher.type='button';launcher.setAttribute('aria-label','Snote 도움말 열기');launcher.setAttribute('aria-expanded','false');launcher.setAttribute('aria-controls','snote-chatbot-panel');launcher.dataset.tooltip='Snote 도움말';launcher.innerHTML=robot;
  panel=node('section');panel.id='snote-chatbot-panel';panel.hidden=true;panel.inert=true;panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','false');panel.setAttribute('aria-labelledby','snote-chatbot-title');
  const header=node('header','snote-chat-header'),heading=node('div'),title=node('h2',null,'Snote 도움말'),subtitle=node('p',null,'자주 묻는 사용 방법');title.id='snote-chatbot-title';heading.append(title,subtitle);
  const dismiss=node('button','snote-chat-close');dismiss.type='button';dismiss.setAttribute('aria-label','도움말 닫기');dismiss.dataset.tooltip='닫기';dismiss.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';dismiss.addEventListener('click',()=>close(true));header.append(heading,dismiss);
  const content=node('div','snote-chat-content');log=node('div','snote-chat-log');log.setAttribute('role','log');log.setAttribute('aria-live','polite');log.setAttribute('aria-relevant','additions');log.setAttribute('aria-label','도움말 대화');chips=node('div','snote-chat-chips');chips.setAttribute('aria-label','자주 묻는 질문');content.append(chips,log);
  const form=node('form','snote-chat-form'),label=node('label','snote-chat-sr','궁금한 사용 방법');label.htmlFor='snote-chatbot-input';input=node('input');input.id='snote-chatbot-input';input.type='text';input.maxLength=400;input.autocomplete='off';input.placeholder='예: 차량 등록은 어디서 하나요?';const send=node('button','snote-chat-send','보내기');send.type='submit';form.append(label,input,send);form.addEventListener('submit',event=>{event.preventDefault();answer(input.value);});
  const foot=node('p','snote-chat-foot','대화는 이 창에서만 유지돼요.');panel.append(header,content,form,foot);root.append(panel,launcher);document.body.append(root);lastScope=scope();reset();refresh();
  launcher.addEventListener('click',()=>opened?close(true):open());
  document.addEventListener('pointerdown',event=>{if(opened&&!root.contains(event.target))close(false);},true);
  document.addEventListener('keydown',event=>{if(opened&&event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}},true);
  new MutationObserver(records=>{if(records.some(record=>!root.contains(record.target)))schedule();}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','open','class','style','aria-hidden']});
  addEventListener('resize',schedule);addEventListener('scroll',schedule,true);window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);addEventListener('pagehide',reset);
 }
 window.SnoteChatbot=Object.freeze({open,close,reset,refresh:schedule});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
