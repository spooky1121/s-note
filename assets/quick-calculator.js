import {createCalculator} from './quick-calculator-model.js?v=2.17';

const trigger=document.getElementById('snote-calculator-trigger');
if(trigger){
  const calculator=createCalculator();
  const panel=document.createElement('section');
  panel.id='snote-calculator-panel';
  panel.hidden=true;
  panel.inert=true;
  panel.tabIndex=-1;
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-modal','false');
  panel.setAttribute('aria-labelledby','snote-calculator-title');
  panel.setAttribute('aria-describedby','snote-calculator-help');
  panel.innerHTML=`<div class="snote-calculator-heading"><h2 id="snote-calculator-title">계산기</h2><button id="snote-calculator-close" type="button" aria-label="계산기 닫기"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8"/></svg></button></div>
    <div class="snote-calculator-screen"><p id="snote-calculator-expression"></p><output id="snote-calculator-display" aria-label="계산 결과" aria-live="polite">0</output><p id="snote-calculator-preview" aria-label="계산 미리보기"></p></div>
    <div class="snote-calculator-keys" aria-label="계산기 키패드"></div><p id="snote-calculator-help">숫자 키로 입력 · Enter로 계산 · Esc로 닫기</p>`;
  const keys=[
    ['AC','AC','모두 지우기','utility'],['SIGN','+/−','양수·음수 전환','utility'],['PERCENT','%','백분율','utility'],['/','÷','나누기','operator'],
    ['7','7','7'],['8','8','8'],['9','9','9'],['*','×','곱하기','operator'],
    ['4','4','4'],['5','5','5'],['6','6','6'],['-','−','빼기','operator'],
    ['1','1','1'],['2','2','2'],['3','3','3'],['+','+','더하기','operator'],
    ['BACKSPACE','','한 자리 지우기','backspace'],['0','0','0'],['.','.','소수점'],['=','=','계산','equals']
  ];
  const buttons=new Map();
  for(const [key,label,name,style]of keys){
    const button=document.createElement('button');
    button.type='button';button.dataset.calculatorKey=key;
    button.setAttribute('aria-label',name);
    if(style)button.className='snote-calculator-'+style;
    if(style==='operator')button.setAttribute('aria-pressed','false');
    if(key==='BACKSPACE')button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8.5 5-6 7 6 7H21V5Z"/><path d="m12 9 6 6m0-6-6 6"/></svg>';
    else button.textContent=label;
    buttons.set(key,button);panel.querySelector('.snote-calculator-keys').append(button);
  }
  document.body.append(panel);
  const display=panel.querySelector('#snote-calculator-display');
  const expression=panel.querySelector('#snote-calculator-expression');
  const preview=panel.querySelector('#snote-calculator-preview');
  const help=panel.querySelector('#snote-calculator-help');
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const presses=new Map();
  let opened=false,closeTimer=null,openingFrame=null;

  function formatted(value){
    const text=String(value??'0');
    if(!/^-?\d+(?:\.\d*)?$/.test(text))return text;
    const [whole,fraction]=text.split('.');
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction!==undefined?'.'+fraction:'');
  }
  function render(state=calculator.snapshot()){
    const text=formatted(state.display);
    display.textContent=text;
    display.dataset.size=text.length>18?'small':text.length>12?'medium':'large';
    display.dataset.error=String(!!state.error);
    expression.textContent=state.expression||'';
    preview.textContent=state.preview!==null&&state.preview!==undefined?'= '+formatted(state.preview):'';
    help.textContent=state.error||'숫자 키로 입력 · Enter로 계산 · Esc로 닫기';
    help.dataset.error=String(!!state.error);
    // Keep operation feedback in sync with the expression, without storing UI state.
    const symbol=state.expression?.trim().slice(-1);
    for(const [key,button]of buttons)if(button.hasAttribute('aria-pressed'))button.setAttribute('aria-pressed',String(!state.error&&({'+':'+','-':'−','*':'×','/':'÷'}[key]===symbol)));
  }
  function position(){
    if(!opened)return;
    const rect=trigger.getBoundingClientRect(),viewport=window.visualViewport;
    const leftEdge=viewport?.offsetLeft||0,topEdge=viewport?.offsetTop||0;
    const width=viewport?.width||innerWidth,height=viewport?.height||innerHeight;
    const cardWidth=Math.min(304,width-24);
    const left=Math.max(leftEdge+12,Math.min(rect.right-cardWidth,leftEdge+width-cardWidth-12));
    let top=rect.bottom+10;
    if(topEdge+height-top<180)top=topEdge+12;
    panel.style.width=cardWidth+'px';panel.style.left=left+'px';panel.style.top=top+'px';
    panel.style.maxHeight=Math.max(0,topEdge+height-top-12)+'px';
  }
  function close(restoreFocus=false,immediate=false){
    if(!opened&&panel.hidden)return;
    opened=false;trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-label','계산기 열기');
    cancelAnimationFrame(openingFrame);clearTimeout(closeTimer);
    if(panel.contains(document.activeElement)){
      if(restoreFocus&&trigger.getClientRects().length)trigger.focus({preventScroll:true});
      else document.activeElement.blur();
    }
    panel.inert=true;panel.classList.remove('is-open');
    for(const [key,timer]of presses){clearTimeout(timer);buttons.get(key)?.classList.remove('is-pressed');}
    presses.clear();
    if(immediate||motion.matches)panel.hidden=true;
    else closeTimer=setTimeout(()=>{if(!opened)panel.hidden=true;},190);
  }
  function open(){
    if(!trigger.getClientRects().length||trigger.disabled)return;
    window.snoteCloseProfileMenu?.();clearTimeout(closeTimer);
    opened=true;panel.hidden=false;panel.inert=false;
    trigger.setAttribute('aria-expanded','true');trigger.setAttribute('aria-label','계산기 닫기');
    render();position();
    openingFrame=requestAnimationFrame(()=>{if(opened)panel.classList.add('is-open');});
    panel.focus({preventScroll:true});
  }
  function press(key){
    const button=buttons.get(key);if(!button)return;
    render(calculator.input(key));
    clearTimeout(presses.get(key));button.classList.add('is-pressed');
    presses.set(key,setTimeout(()=>{button.classList.remove('is-pressed');presses.delete(key);},150));
  }
  trigger.addEventListener('click',()=>opened?close():open());
  panel.querySelector('#snote-calculator-close').addEventListener('click',()=>close(true));
  panel.addEventListener('click',event=>{const button=event.target.closest('[data-calculator-key]');if(button&&opened)press(button.dataset.calculatorKey);});
  document.addEventListener('pointerdown',event=>{if(opened&&!panel.contains(event.target)&&!trigger.contains(event.target))close();},true);
  document.addEventListener('focusin',event=>{if(opened&&!panel.contains(event.target)&&event.target!==trigger)close();});
  document.addEventListener('keydown',event=>{
    if(!opened||event.ctrlKey||event.metaKey||event.altKey||event.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
    if(!panel.contains(document.activeElement)&&document.activeElement!==trigger)return;
    const key=/^[0-9.+\-*/=%]$/.test(event.key)?event.key==='%'?'PERCENT':event.key:event.key==='Enter'?'=':event.key==='Backspace'?'BACKSPACE':event.key==='Delete'?'AC':null;
    if(key){event.preventDefault();event.stopPropagation();press(key);}
  },true);
  // Focus inside the monthly iframe belongs to a different document.
  window.addEventListener('blur',()=>setTimeout(()=>{if(opened&&document.activeElement?.tagName==='IFRAME')close();},0));
  window.addEventListener('resize',position);
  window.addEventListener('scroll',position,true);
  window.visualViewport?.addEventListener('resize',position);
  window.visualViewport?.addEventListener('scroll',position);
  window.addEventListener('pagehide',()=>close(false,true));
  window.snoteCloseCalculator=()=>close();
  window.snoteResetCalculator=()=>{close(false,true);render(calculator.reset());};
  trigger.disabled=false;render();
}
