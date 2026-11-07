import {TEMPLATE} from './income-settlement-template.js?v=2.41';

const icons={
 transaction:'M4 8h16M4 16h16M8 4 4 8l4 4m8 0 4 4-4 4',
 receipt:'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
 sliders:'M4 7h16M4 17h16M9 4v6m6 4v6',
 vehicle:'m5 8 2-4h10l2 4M4 9h16v9H4zM7 18v3m10-3v3M7 13h.01M17 13h.01',
 person:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM5 21v-3a7 7 0 0 1 14 0v3',
 wallet:'M3 6h17v15H3zM3 6l14-3v3M16 11h5v5h-5z',
 plus:'M12 5v14M5 12h14',chevron:'m8 10 4 4 4-4',check:'m5 12 4 4L19 6'
};
const number=new Intl.NumberFormat('ko-KR');
function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;}
function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',icons[name]||icons.receipt);svg.append(path);return svg;}
const filled=value=>value!==null&&value!==undefined&&value!==''&&value!==0;

export function buildForm({onInput=()=>{},onBlur=()=>{}}={}){
 const mount=document.getElementById('income-sheet'),summaryMount=document.getElementById('income-live-summary');
 const inputNodes=new Map(),fieldNodes=new Map(),formulaNodes=new Map(),detailsNodes=new Map(),expenseRows=[];
 let editable=false,visibleRows=1,hasBrokerData=false;
 function field(id,{label,help,large=false,placeholder}={}){
  const meta=TEMPLATE.inputs[id],wrap=el('div','income-field'+(large?' income-field--large':''));wrap.dataset.inputCell=id;
  const caption=el('label','income-field-label',label||meta.label);caption.htmlFor=`income-cell-${id}`;
  const shell=el('div','income-input-shell'),input=el(id==='J4'?'textarea':'input','income-input');input.id=`income-cell-${id}`;input.dataset.cell=id;input.disabled=true;input.autocomplete='off';input.spellcheck=false;input.setAttribute('aria-label',label||meta.label);if(meta.maxLength)input.maxLength=meta.maxLength;
  if(meta.kind==='money'){input.inputMode='text';input.placeholder=placeholder||'금액 입력';shell.classList.add('income-input-shell--money');}else if(meta.kind==='identity'){input.inputMode='numeric';input.placeholder='생년월일 6자리와 뒤 7자리';}else if(meta.kind==='date'){input.type='text';input.inputMode='text';input.maxLength=10;input.placeholder='YYYY-MM-DD';}else if(id==='J3'){input.inputMode='numeric';input.placeholder='연식';}else input.placeholder=placeholder||'';
  if(id==='J4'){input.rows=3;input.placeholder='필요한 내용을 남겨 주세요.';}
  input.addEventListener('input',()=>onInput(id,input));input.addEventListener('blur',()=>onBlur(id));shell.append(input);if(meta.kind==='money')shell.append(el('span','income-input-unit','원'));
  wrap.append(caption,shell);if(help){const note=el('p','income-field-help',help);note.id=`income-help-${id}`;input.setAttribute('aria-describedby',note.id);wrap.append(note);}inputNodes.set(id,input);fieldNodes.set(id,wrap);return wrap;
 }
 function computed(id,label,{hero=false,unit=true}={}){
  const wrap=el('div',hero?'income-summary-hero':'income-result-row');wrap.dataset.formulaCell=id;
  const caption=el(hero?'p':'span',hero?'income-summary-label':'income-result-label',label),value=el('span','income-result-value'),output=el('span','cell-output','—');value.append(output);if(unit)value.append(el('span','income-result-unit','원'));wrap.append(caption,value);
  if(!formulaNodes.has(id))formulaNodes.set(id,[]);formulaNodes.get(id).push({output,wrap});return wrap;
 }
 function sectionHeader(title,description,name){const header=el('div','income-section-header'),badge=el('span','income-section-icon');badge.append(icon(name));const text=el('div','income-section-title');text.append(el('h2','',title));if(description)text.append(el('p','',description));header.append(badge,text);return header;}
 function card(key,title,description,name){const node=el('section','income-card income-section');node.dataset.section=key;node.append(sectionHeader(title,description,name));return node;}
 function disclosure(key,title,description,name){const node=el('details','income-card income-section income-disclosure');node.dataset.section=key;node.dataset.incomeDetails=key;const summary=el('summary'),badge=el('span','income-section-icon');badge.append(icon(name));const text=el('span','income-disclosure-title');text.append(el('strong','',title));if(description)text.append(el('span','',description));const chevron=icon('chevron');chevron.classList.add('income-chevron');summary.append(badge,text,chevron);node.append(summary);const body=el('div','income-disclosure-body');node.append(body);detailsNodes.set(key,node);return{node,body};}
 function fields(ids,options={}){const grid=el('div','income-fields');for(const id of ids)grid.append(field(id,options[id]||{}));return grid;}
 function subgroup(parent,title,ids,options={}){const group=el('div','income-subgroup');group.append(el('h3','',title),fields(ids,options));parent.append(group);return group;}

 const transaction=card('transaction','거래 금액','차량의 매입·매출 금액을 확인해 주세요.','transaction');
 const kind=el('div','income-kind-control'),kindLabel=el('label','','매입 방식');kindLabel.htmlFor='income-purchase-kind';const select=el('select');select.id='income-purchase-kind';select.disabled=true;for(const[value,label]of[['recycled','재활용매입'],['invoice','세금계산서 매입'],['manual','금액 직접 구분']]){const option=el('option','',label);option.value=value;select.append(option);}kind.append(kindLabel,select);
 transaction.append(kind,fields(['D8','D11','D10'],{D8:{label:'매출금액',large:true},D11:{label:'매입금액',help:'재활용매입 기준',large:true},D10:{label:'세금계산서 매입금액',large:true}}));
 const transactionFoot=el('div','income-card-footnote');transactionFoot.append(icon('check'),el('span','','입력한 금액으로 정산 결과가 바로 계산됩니다.'));transaction.append(transactionFoot);

 const expenses=card('invoice-costs','증빙 비용','세금계산서를 받은 비용','receipt');const expenseHeading=expenses.querySelector('.income-section-header');const addButton=el('button','income-add-cost');addButton.id='income-add-cost';addButton.type='button';addButton.disabled=true;addButton.append(icon('plus'),el('span','','항목 추가'));expenseHeading.append(addButton);
 const expenseList=el('div','income-expense-list');for(let row=15;row<=20;row++){const index=row-14,line=el('div','income-expense-row');line.dataset.expenseRow=String(index);line.hidden=index>1;line.append(el('span','income-expense-index',String(index)),field('B'+row,{label:`비용 항목 ${index}`,placeholder:'예: 상품화 비용'}),field('D'+row,{label:`금액 ${index}`}));expenseRows.push(line);expenseList.append(line);}expenses.append(expenseList);
 const expenseTotal=el('div','income-expense-total');expenseTotal.append(el('span','','세금계산서 비용 합계'));const invoiceTotal=el('strong','','—');invoiceTotal.id='income-invoice-total';expenseTotal.append(invoiceTotal);expenses.append(expenseTotal);
 addButton.addEventListener('click',()=>{if(!editable||visibleRows>=expenseRows.length)return;visibleRows++;showRows();inputNodes.get('B'+(14+visibleRows)).focus();});

 const other=disclosure('other-costs','추가 비용·정산 조정','영수증, 사무실 차감, 손익 조정','sliders');
 subgroup(other.body,'영수증·공과금',['D22','D23','D25','D26'],{D22:{label:'영수증 · 건당 30,000원 이하'},D23:{label:'영수증 · 건당 30,000원 초과'},D25:{label:'벌금 등'},D26:{label:'공과금 등'}});
 const penalty=computed('D33','증빙불비가산세 · 자동 계산');penalty.classList.add('income-inline-result');other.body.append(penalty);
 subgroup(other.body,'사무실 차감',['D30','D31','D32'],{D30:{label:'판매입금 차감',help:'원본 양식의 사무실 차감 항목입니다.'},D31:{label:'취득세'},D32:{label:'성능보험료'}});
 subgroup(other.body,'손익 조정·참고',['D40','I39'],{D40:{label:'타차량 손익 조정',help:'차감할 금액은 음수로 입력해 주세요.'},I39:{label:'매입비차액 · 기록용',help:'자동 계산에는 포함되지 않는 참고 금액입니다.'}});

 const vehicle=disclosure('vehicle','차량·상사 정보','차량, 거래일, 담당자와 상사','vehicle');vehicle.body.append(fields(['C3','F3','J3','C2','G2','C4','F4'],{C3:{label:'차량명'},F3:{label:'차량번호'},J3:{label:'연식'},C2:{label:'담당자'},G2:{label:'상사명'},C4:{label:'매입일'},F4:{label:'매도일'}}),field('J4',{label:'메모'}));
 const broker=disclosure('broker','알선딜러 정산','알선 거래가 있는 경우 입력','person');broker.body.append(fields(['D47','H49','H50','H51'],{D47:{label:'알선 사업소득 결정액'},H49:{label:'알선딜러 성명'},H50:{label:'알선딜러 주민등록번호',help:'서버에 별도로 암호화해 저장합니다.'},H51:{label:'딜러소득세 · 기록용',help:'자동 계산에는 포함되지 않는 참고 금액입니다.'}}));const brokerInline=computed('D52','알선 정산 실지급액');brokerInline.classList.add('income-inline-result','income-inline-result--blue');broker.body.append(brokerInline);
 const mobileSummary=el('div','income-mobile-summary');mobileSummary.setAttribute('aria-label','매입 정산 실지급액 요약');mobileSummary.append(computed('D44','매입 정산 실지급액'));mount.replaceChildren(mobileSummary,transaction,expenses,other.node,vehicle.node,broker.node);

 const summary=el('section','income-summary-card');const summaryHead=el('div','income-summary-heading');summaryHead.append(icon('wallet'),el('h2','','정산 결과'));const live=el('span','income-live-badge','자동 계산');summaryHead.append(live);summary.append(summaryHead,computed('D44','매입 정산 실지급액',{hero:true}),el('p','income-summary-caption','정산 조정과 세액을 반영한 금액입니다.'));
 const mainResults=el('div','income-summary-results');mainResults.append(computed('D41','사업소득'),computed('D42','소득세'),computed('D43','지방소득세'),computed('I36','부가세 차액'));summary.append(mainResults);
 const breakdown=el('details','income-breakdown');const breakdownTitle=el('summary','','계산 내역 보기');breakdownTitle.append(icon('chevron'));breakdown.append(breakdownTitle);const breakdownBody=el('div','income-breakdown-body');for(const[id,label]of[['D12','매출·매입 차액'],['D28','차량 부대비용'],['D35','사무실 차감 합계'],['E36','비용 차감 후 금액'],['D39','정산 전 사업소득'],['I38','부가세·원천세 합계']])breakdownBody.append(computed(id,label));breakdown.append(breakdownBody);summary.append(breakdown);
 const brokerSummary=el('section','income-summary-card income-broker-summary');brokerSummary.id='income-broker-summary';brokerSummary.hidden=true;brokerSummary.append(el('h2','','알선딜러 정산'),computed('D52','알선 정산 실지급액',{hero:true}));const brokerResults=el('div','income-summary-results');for(const[id,label]of[['D48','부가세 공제액'],['D49','알선 사업소득'],['D50','소득세'],['D51','지방소득세']])brokerResults.append(computed(id,label));brokerSummary.append(brokerResults);summaryMount.replaceChildren(summary,brokerSummary);
 broker.node.addEventListener('toggle',()=>brokerVisibility());
 function brokerVisibility(){brokerSummary.hidden=!hasBrokerData&&!broker.node.open;}
 function showRows(){for(let i=0;i<expenseRows.length;i++)expenseRows[i].hidden=i>=visibleRows;addButton.disabled=!editable||visibleRows>=expenseRows.length;addButton.querySelector('span').textContent=visibleRows>=expenseRows.length?'6개 항목 사용 중':'항목 추가';}
 function purchaseVisibility(doc){const kind=doc?.purchaseKind||'recycled';fieldNodes.get('D10').hidden=kind==='recycled'&&!filled(doc?.cells?.D10);fieldNodes.get('D11').hidden=kind==='invoice'&&!filled(doc?.cells?.D11);transaction.dataset.purchaseKind=kind;}
 const interestNote=el('p','income-interest-note');interestNote.hidden=true;summary.append(interestNote);
 function updateCalculation(result,doc,source={}){
  const automatic=[];if(source?.inventoryInterestWon)automatic.push(`재고금융 이자 ${number.format(source.inventoryInterestWon)}원`);if(source?.customCostsWon)automatic.push(`추가 비용 ${number.format(source.customCostsWon)}원`);
  interestNote.hidden=!automatic.length;interestNote.textContent=`${automatic.length?automatic.join(' · '):'재고금융 이자 0원'} 자동 반영 (차량 부대비용 포함)`;
  for(const[id,nodes]of formulaNodes){const value=result?.cells?.[id];for(const{output,wrap}of nodes){output.textContent=Number.isFinite(value)?number.format(value):'—';wrap.dataset.negative=String(Number.isFinite(value)&&value<0);}}
  let total=0;for(let row=15;row<=20;row++)total+=Number.isFinite(result?.cells?.['D'+row])?result.cells['D'+row]:0;invoiceTotal.textContent=result?`${number.format(total)}원`:'—';
  purchaseVisibility(doc);hasBrokerData=['D47','H49','H50','H51'].some(id=>filled(doc?.cells?.[id]));brokerVisibility();
 }
 function syncDocument(doc){
  purchaseVisibility(doc);let highest=1;for(let i=0;i<expenseRows.length;i++){const row=15+i;if(doc?.cells?.['B'+row]||doc?.cells?.['D'+row]!=null)highest=i+1;}visibleRows=Math.max(visibleRows,highest);showRows();
  if(['D22','D23','D25','D26','D30','D31','D32','D40','I39'].some(id=>filled(doc?.cells?.[id])))other.node.open=true;
  hasBrokerData=['D47','H49','H50','H51'].some(id=>filled(doc?.cells?.[id]));if(hasBrokerData)broker.node.open=true;brokerVisibility();
 }
 function revealField(id){const input=inputNodes.get(id);if(!input)return;let parent=input.parentElement;while(parent&&parent!==mount){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}const row=input.closest('[data-expense-row]');if(row){visibleRows=Math.max(visibleRows,Number(row.dataset.expenseRow));showRows();}if(id==='D10'||id==='D11')fieldNodes.get(id).hidden=false;}
 function setEditable(value){editable=!!value;showRows();}
 function reset(){visibleRows=1;hasBrokerData=false;for(const details of detailsNodes.values())details.open=false;breakdown.open=false;updateCalculation(null,null);showRows();}
 reset();
 return {inputNodes,updateCalculation,syncDocument,reset,revealField,setEditable};
}
