import {TEMPLATE,normalizeDocument,calculate} from './income-settlement-model.js?v=2.174';

const money=value=>value==null?'':new Intl.NumberFormat('ko-KR').format(value);

function position(address){
  const match=/^([A-J])(\d+)$/.exec(address);
  return {col:match[1].charCodeAt(0)-65,row:Number(match[2])-1};
}

function inputText(value,kind){
  if(kind==='money')return money(value);
  if(kind==='identity'&&value)return String(value).replace(/^(\d{6})(\d{7})$/,'$1-$2');
  return value??'';
}

// The controller authorizes and freezes the document before calling this helper.
// This builds a detached, readonly original-form snapshot without reading live
// inputs or retaining the document (including H50) in application state/storage.
export function buildPrintSnapshot(value,{
  source={},stored=false,dirty=false,mode='cloud',printedAt=new Date(),domDocument=globalThis.document
}={}){
  const document=normalizeDocument(value),result=calculate(document,source);
  if(!domDocument?.createElement||!domDocument?.createDocumentFragment)throw new TypeError('인쇄 문서를 만들 수 없습니다.');
  const date=new Date(printedAt);
  if(!Number.isFinite(date.getTime()))throw new TypeError('인쇄 시각을 확인해 주세요.');
  const fragment=domDocument.createDocumentFragment(),paper=domDocument.createElement('article'),covered=new Set(),merges=new Map();
  paper.className='income-print-document';paper.setAttribute('aria-label','자동차별 매입매출 정산내역서');
  const header=domDocument.createElement('header');header.className='income-print-heading';
  const brand=domDocument.createElement('p');brand.className='income-print-brand';brand.textContent='S-NOTE';
  const title=domDocument.createElement('h1');title.dataset.cellAddress='A1';title.textContent=TEMPLATE.labels.A1;
  const unit=domDocument.createElement('p');unit.className='income-print-unit';unit.textContent='단위: 원';header.append(brand,title,unit);paper.append(header);
  for(const range of TEMPLATE.merges){
    const [start,end=start]=range.split(':'),a=position(start),b=position(end);
    merges.set(start,{rows:b.row-a.row+1,cols:b.col-a.col+1});
    for(let row=a.row;row<=b.row;row++)for(let col=a.col;col<=b.col;col++){
      const id=String.fromCharCode(65+col)+(row+1);if(id!==start)covered.add(id);
    }
  }
  function outputFor(id){
    const output=domDocument.createElement('span'),metadata=TEMPLATE.inputs[id];
    if(metadata){output.className='print-cell-value';output.dataset.cell=id;output.textContent=inputText(document.cells[id],metadata.kind);}
    else{output.className='cell-output';output.textContent=Object.hasOwn(TEMPLATE.formulas,id)?money(result.cells[id]):TEMPLATE.labels[id]||'';}
    return output;
  }
  function grid(first,last,className){
    const table=domDocument.createElement('table');table.className='income-grid '+className;
    const columns=domDocument.createElement('colgroup'),total=TEMPLATE.columnWidths.reduce((sum,width)=>sum+width,0);
    for(const width of TEMPLATE.columnWidths){const col=domDocument.createElement('col');col.style.width=(width/total*100)+'%';columns.append(col);}table.append(columns);
    const head=domDocument.createElement('thead'),body=domDocument.createElement('tbody');
    for(let row=first;row<=last;row++){
      // Blank spacer rows have no document values or formula results.
      if([27,34,45].includes(row))continue;
      const tr=domDocument.createElement('tr');tr.dataset.printRow=String(row);
      tr.dataset.rowKind=[6,7].includes(row)?'columns':[13,29,37,46].includes(row)?'section':[14,21,24].includes(row)?'subsection':[12,28,35,36].includes(row)?'subtotal':[44,52].includes(row)?'net':'detail';
      for(let col=0;col<TEMPLATE.cols;col++){
        const id=String.fromCharCode(65+col)+row;if(covered.has(id))continue;
        if(row===36&&['E36','G36','I36'].includes(id))continue;
        const cell=domDocument.createElement('td'),merge=merges.get(id);cell.dataset.cellAddress=id;
        if(row===36&&['D36','F36','H36'].includes(id)){
          const formula=String.fromCharCode(id.charCodeAt(0)+1)+'36',marker=outputFor(id);marker.className='income-print-total-marker';marker.dataset.cellAddress=id;
          cell.colSpan=2;cell.className='income-print-money income-print-total';cell.dataset.cellAddress=formula;cell.dataset.formulaCell=formula;cell.append(marker,outputFor(formula));tr.append(cell);continue;
        }
        if(merge){cell.rowSpan=merge.rows;cell.colSpan=merge.cols;}
        if(TEMPLATE.inputs[id]?.kind==='money'||Object.hasOwn(TEMPLATE.formulas,id))cell.className='income-print-money';
        else if(TEMPLATE.labels[id])cell.className='income-print-label';
        if(Object.hasOwn(TEMPLATE.formulas,id))cell.dataset.formulaCell=id;
        // Give the complete notes field its own full-width row instead of a narrow worksheet box.
        if(!['H4','J4'].includes(id))cell.append(outputFor(id));tr.append(cell);
      }
      (row===6||row===7?head:body).append(tr);
    }
    if(head.children.length)table.append(head);table.append(body);return table;
  }
  const metadata=grid(2,4,'income-print-metadata');metadata.setAttribute('aria-label','차량 및 거래 정보');paper.append(metadata);
  const notes=domDocument.createElement('div');notes.className='income-print-notes';const label=domDocument.createElement('span');label.className='income-print-label';label.dataset.cellAddress='H4';label.textContent=TEMPLATE.labels.H4;
  const note=outputFor('J4');note.classList.add('print-appendix');note.dataset.printNote='J4';notes.append(label,note);paper.append(notes);
  for(const[first,last,name,label]of[[6,36,'accounting','매입매출 및 비용'],[37,44,'dealer','매입딜러 사업소득'],[46,52,'broker','알선딜러 사업소득']]){const table=grid(first,last,'income-print-'+name);table.setAttribute('aria-label',label);paper.append(table);}
  const footer=domDocument.createElement('p');footer.className='print-footer';
  footer.textContent=`첨부 원본 수식 기준 · ${stored===true&&dirty===false&&mode==='cloud'?'서버 저장 자료':'서버 미저장 작성본'} · ${date.toLocaleString('ko-KR')}`;
  const automatic=[];if(source.customCostsWon)automatic.push(`추가 비용 ${source.customCostsWon.toLocaleString('ko-KR')}원`);
  if(automatic.length)footer.textContent+=` · 차량 부대비용에 ${automatic.join(' · ')} 포함`;
  paper.append(footer);fragment.append(paper);
  return fragment;
}
