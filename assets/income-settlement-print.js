import {TEMPLATE,normalizeDocument,calculate} from './income-settlement-model.js?v=2.76';

const money=value=>value==null?'':new Intl.NumberFormat('ko-KR').format(value);

function position(address){
  const match=/^([A-J])(\d+)$/.exec(address);
  return {col:match[1].charCodeAt(0)-65,row:Number(match[2])-1};
}

function applyStyle(cell,style){
  cell.style.fontFamily='"Malgun Gothic","Apple SD Gothic Neo",sans-serif';
  cell.style.fontSize=`${style.font?.size||10}pt`;
  cell.style.fontWeight=style.font?.bold?'700':'400';
  cell.style.color=style.font?.color||'#000';
  if(style.fill)cell.style.backgroundColor=style.fill;
  cell.style.textAlign=style.align?.horizontal||'left';
  cell.style.verticalAlign=style.align?.vertical||'middle';
  for(const edge of ['top','right','bottom','left'])if(style.border?.[edge]){
    cell.style['border'+edge[0].toUpperCase()+edge.slice(1)]=style.border[edge];
  }
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
  const fragment=domDocument.createDocumentFragment(),covered=new Set(),merges=new Map();
  // The original notes cell is one short row. Its adjacent original blank
  // F40:J42 area keeps a longer note readable without enlarging that row.
  const extendedNote=Array.from(document.cells.J4).length>9||/[\r\n]/.test(document.cells.J4)?document.cells.J4:'';
  for(const range of TEMPLATE.merges){
    const [start,end=start]=range.split(':'),a=position(start),b=position(end);
    merges.set(start,{rows:b.row-a.row+1,cols:b.col-a.col+1});
    for(let row=a.row;row<=b.row;row++)for(let col=a.col;col<=b.col;col++){
      const id=String.fromCharCode(65+col)+(row+1);
      if(id!==start)covered.add(id);
    }
  }
  const table=domDocument.createElement('table');
  table.className='income-grid';
  table.setAttribute('aria-label','자동차별 매입매출 정산내역서');
  table.style.width=`${TEMPLATE.columnWidths.reduce((sum,width)=>sum+width,0)}px`;
  const columns=domDocument.createElement('colgroup');
  for(const width of TEMPLATE.columnWidths){
    const column=domDocument.createElement('col');column.style.width=`${width}px`;columns.append(column);
  }
  table.append(columns);
  const body=domDocument.createElement('tbody');
  for(let row=0;row<TEMPLATE.rows;row++){
    const tr=domDocument.createElement('tr');tr.style.height=`${TEMPLATE.rowHeights[row]}px`;
    for(let col=0;col<TEMPLATE.cols;col++){
      const id=String.fromCharCode(65+col)+(row+1);
      if(covered.has(id))continue;
      const cell=domDocument.createElement('td'),merge=merges.get(id);
      cell.dataset.cellAddress=id;
      if(merge){cell.rowSpan=merge.rows;cell.colSpan=merge.cols;}
      applyStyle(cell,TEMPLATE.styles[id]||{});
      const output=domDocument.createElement('span'),metadata=TEMPLATE.inputs[id];
      if(metadata){
        output.className='print-cell-value';output.dataset.cell=id;
        output.textContent=id==='J4'&&extendedNote?'하단 특이사항':inputText(document.cells[id],metadata.kind);
      }else{
        output.className='cell-output';
        output.textContent=Object.hasOwn(TEMPLATE.formulas,id)?money(result.cells[id]):TEMPLATE.labels[id]||'';
        if(Object.hasOwn(TEMPLATE.formulas,id))cell.dataset.formulaCell=id;
        if(id==='F40'&&extendedNote){
          output.classList.add('print-appendix');
          output.dataset.printNote='J4';
          output.textContent='특이사항: '+extendedNote;
          output.style.fontSize='6pt';output.style.lineHeight='1.08';
          output.style.margin='0';output.style.whiteSpace='normal';output.style.overflowWrap='anywhere';
        }
      }
      cell.append(output);tr.append(cell);
    }
    body.append(tr);
  }
  table.append(body);fragment.append(table);
  const footer=domDocument.createElement('p');footer.className='print-footer';
  footer.textContent=`첨부 원본 수식 기준 · ${stored===true&&dirty===false&&mode==='cloud'?'서버 저장 자료':'서버 미저장 작성본'} · ${date.toLocaleString('ko-KR')}`;
  if(source.inventoryInterestWon)footer.textContent+=` · 차량 부대비용에 재고금융 이자 ${source.inventoryInterestWon.toLocaleString('ko-KR')}원 포함`;
  fragment.append(footer);
  return fragment;
}
