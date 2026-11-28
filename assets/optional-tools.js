/* Keep optional tool bodies off the first load; their public controls stay ready. */
(()=>{'use strict';
 if(window.SnoteOptionalTools)return;
 const trigger=document.getElementById('snote-calculator-trigger');
 let calculatorIntent=0,calculatorPending=false,tutorialIntent=0,tutorialPending=false,probeScheduled=false;
 function scope(){try{const actor=typeof currentUser==='object'?currentUser:null;return[actor,actor?.username,actor?.role,actor?.companyId,actor?.company_id,actor?.company,typeof route==='string'?route:null,window.snoteWorkspaceVisible?.()===true];}catch{return[];}}
 const same=expected=>{const now=scope();return now.length===expected.length&&now.every((value,i)=>value===expected[i]);};
 function visible(node){if(!node||node.hidden||node.closest('[hidden],[inert]'))return false;const style=getComputedStyle(node);return node.getClientRects().length>0&&style.display!=='none'&&style.visibility!=='hidden';}
 function workPopups(){return[...document.querySelectorAll('dialog[open],[role="dialog"],.overlay,.snote-profile-menu,.mobile-drawer')].filter(node=>!node.closest('#snote-chatbot,#zc-cloud-gate,#auth-shell')&&visible(node));}
 function tutorialAllowed(){return !matchMedia('(max-width:760px)').matches&&!workPopups().some(node=>node.id!=='snote-tutorial-dialog'&&!node.closest('#snote-tutorial-dialog'));}
 function notify(message,current){if(!current())return;window.snoteNotify?.(message,{tone:'error',isCurrent:current});}
 function closeCalculator(reset=false){calculatorIntent++;calculatorPending=false;trigger?.removeAttribute('aria-busy');if(reset)window.SnoteQuickCalculator?.reset();else window.SnoteQuickCalculator?.close();}
 async function calculatorClick(){
  if(!visible(trigger)||trigger.disabled||calculatorPending)return;
  if(window.SnoteQuickCalculator){window.SnoteQuickCalculator.toggle();return;}
  const expected=scope(),popups=workPopups(),intent=++calculatorIntent,current=()=>intent===calculatorIntent&&same(expected)&&visible(trigger)&&!trigger.disabled&&workPopups().every(node=>popups.includes(node));
  calculatorPending=true;trigger.setAttribute('aria-busy','true');
  try{await window.SnoteFeatures.load('calculator');if(current())window.SnoteQuickCalculator?.toggle();}
  catch{notify('계산기를 불러오지 못했습니다. 다시 눌러 주세요.',current);}
  finally{if(intent===calculatorIntent){calculatorPending=false;trigger.removeAttribute('aria-busy');}}
 }
 function closeTutorial(...args){tutorialIntent++;tutorialPending=false;return window.SnoteTutorialView?.close(...args)??false;}
 function openTutorial(options={}){
  if(!tutorialAllowed())return false;
  if(window.SnoteTutorialView)return window.SnoteTutorialView.open(options);
  const expected=scope(),intent=++tutorialIntent,current=()=>intent===tutorialIntent&&same(expected)&&tutorialAllowed();
  tutorialPending=true;
  void window.SnoteFeatures.load('tutorial').then(()=>{if(current())window.SnoteTutorialView?.open(options);}).catch(()=>notify('사용 튜토리얼을 불러오지 못했습니다. 다시 눌러 주세요.',current)).finally(()=>{if(intent===tutorialIntent)tutorialPending=false;});
  return true;
 }
 function probe(){probeScheduled=false;if(window.SnoteTaxonomyProbeUI){window.SnoteTaxonomyProbeUI.refresh();return;}let context=null;try{if(typeof route==='string'&&route!=='settings')return;context=window.snoteTaxonomyProbeBridge?.context();}catch{}if(!context||!document.querySelector('#alt-content .snote90-settings'))return;void window.SnoteFeatures.load('taxonomyProbe').catch(()=>{});}
 function scheduleProbe(){if(!probeScheduled){probeScheduled=true;requestAnimationFrame(probe);}}
 window.snoteCloseCalculator=()=>closeCalculator();window.snoteResetCalculator=()=>closeCalculator(true);
 window.SnoteTutorial=Object.freeze({open:openTutorial,close:closeTutorial});
 window.SnoteOptionalTools=Object.freeze({refresh:scheduleProbe});
 if(trigger){trigger.addEventListener('click',calculatorClick);trigger.disabled=false;}
 document.addEventListener('pointerdown',event=>{if(calculatorPending&&!trigger?.contains(event.target))closeCalculator();if(tutorialPending&&!event.target.closest?.('#snote-chatbot'))closeTutorial(false);},true);
 document.addEventListener('focusin',event=>{if(calculatorPending&&event.target!==trigger&&!document.getElementById('snote-calculator-panel')?.contains(event.target))closeCalculator();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(calculatorPending)closeCalculator();if(tutorialPending)closeTutorial(false);}},true);
 window.addEventListener('snote:route-changed',()=>{if(calculatorPending)closeCalculator();if(tutorialPending)closeTutorial(false);scheduleProbe();});
 window.addEventListener('snote:scheduler-context-changed',scheduleProbe);
 window.addEventListener('snote:auth-reset',()=>{closeCalculator(true);closeTutorial(false);});
 window.addEventListener('pagehide',()=>{closeCalculator(true);closeTutorial(false);});
 matchMedia('(max-width:760px)').addEventListener('change',event=>{if(event.matches)closeTutorial(false);});
 const host=document.getElementById('alt-content');if(host)new MutationObserver(records=>{if(records.some(record=>!record.target.closest?.('#snote-encar-taxonomy-probe')))scheduleProbe();}).observe(host,{childList:true,subtree:true});
 scheduleProbe();
})();
