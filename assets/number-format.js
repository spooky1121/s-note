/* String grouping preserves integer precision, decimal input and the digit-relative caret. */
const bound=new WeakSet();
export function formatNumberInput(input){
 if(!bound.has(input)){bound.add(input);input.addEventListener('beforeinput',event=>{
  const start=input.selectionStart,end=input.selectionEnd;if(start!==end||event.isComposing)return;
  if(event.inputType==='deleteContentBackward'&&input.value[start-1]===','){event.preventDefault();input.setRangeText('',Math.max(0,start-2),start,'end');input.dispatchEvent(new Event('input',{bubbles:true}));}
  else if(event.inputType==='deleteContentForward'&&input.value[start]===','){event.preventDefault();input.setRangeText('',start,start+2,'end');input.dispatchEvent(new Event('input',{bubbles:true}));}
 });}
 const raw=input.value;if(!/^-?\d[\d,]*(?:\.\d*)?$/.test(raw))return;
 const start=input.selectionStart??raw.length,end=input.selectionEnd??start;
 const count=p=>raw.slice(0,p).replaceAll(',','').length;
 const [whole,fraction]=raw.replaceAll(',','').split('.');
 const formatted=whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction===undefined?'':'.'+fraction);
 if(raw===formatted)return;const position=n=>{let seen=0;for(let i=0;i<formatted.length;i++)if(formatted[i]!==','&&++seen===n)return i+1;return n?formatted.length:0;};
 input.value=formatted;input.setSelectionRange(position(count(start)),position(count(end)));
}
