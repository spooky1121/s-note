#!/usr/bin/env python3
"""Read-only independent lineage audit; writes only this audit directory."""
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import collections
import hashlib
import json
import re

BASE=Path(__file__).resolve().parents[1]
OUT=Path(__file__).resolve().parent

def normalized(value):
    return re.sub(r'\s+', ' ', value).strip()

def run():
    raw_path=BASE/'additional-22-model-classification-observations.json'
    source_path=BASE/'encar-final-domestic-expansion-20261107.json'
    raw=json.loads(raw_path.read_text())['records']
    data=json.loads(source_path.read_text())
    observations={r['classificationDocumentId']:r for r in raw}
    sources={s['id']:s for s in data['sources']}
    errors=[];ledger=[];counts=collections.Counter();seen=collections.Counter()
    def check(condition, code, **detail):
        if not condition: errors.append({'code':code,**detail})
    check(len(raw)==22 and len(observations)==22,'raw_model_document_count')
    check(len(sources)==22,'source_registry_count')
    check(len(data['records'])==222 and len(data['quarantinedRecords'])==1,'record_counts')
    for record in data['records']:
        doc=record['providerIdentifiers']['documentId'];obs=observations[doc];source=sources[record['sourceId']]
        row_number=record['sourceRowNumber'];rows={int(re.match(r'L(\d+):',x)[1]):x for x in obs['classificationRows']}
        row=rows[row_number]
        check(record['sourceRowRaw']==row,'source_row_copy',model=record['model'],line=row_number)
        check(record['sourceTimeColumnsRaw']==rows[0],'time_columns_copy',model=record['model'])
        check(record['model']==obs['model']==source['sourceModelRaw'],'model_identity',doc=doc)
        check(record['sourceUrl']==obs['classificationUrl']==source['url'],'frame_identity',doc=doc)
        check(record['parentHistoryUrl']==obs['parentUrl']==source['parentHistoryUrl'],'parent_identity',doc=doc)
        query=parse_qs(urlsplit(obs['parentUrl']).query)
        for field,key in [('manufacturerCode','mnfccd'),('modelCode','mdlcd'),('modelGroupCode','mdlgroupcd')]:
            check(record['providerIdentifiers'][field]==query.get(key,[None])[0],'parent_code',doc=doc,field=field)
        frame_query=parse_qs(urlsplit(record['sourceUrl']).query)
        check(frame_query.get('bbsno')==[doc] and frame_query.get('type')==['CLS'],'frame_document_type',doc=doc)
        check(record['providerIdentifiers']['namespace']=='encar_history','history_namespace',doc=doc)
        check(record['providerIdentifiers']['gradeCode'] is None and record['providerIdentifiers']['subgradeCode'] is None,'no_invented_leaf_codes',doc=doc)
        check(record['modelYear'] is None and record['engine'] is None,'unknown_year_engine',doc=doc)
        check(record['fuel'] is None or record['fuel'] in record['sourceHierarchyRaw'][0],'literal_fuel_only',doc=doc)
        check(record['retailSearchHierarchyVerified'] is False and record['autoImport'] is False,'no_retail_promotion',doc=doc)
        check(record['mappingStatus']=='needs_parent_and_temporal_variant_match','review_state',doc=doc)
        check(record['evidenceStatus']=='provider_catalog_direct','evidence_status',doc=doc)
        check(record['sourceMakeRaw']==source['sourceMakeRaw'],'raw_manufacturer_copy',doc=doc)
        check(record['sourceModelPeriodRaw']==source['modelPeriodRaw'],'raw_period_copy',doc=doc)
        # Require a complete literal cell, or the same cell with a source date
        # annotation. This is stronger than arbitrary substring matching.
        leaf=normalized(record['sourceHierarchyRaw'][-1])
        cells=[normalized(c) for c in re.sub(r'^L\d+:\s*','',row).split('|')]
        supports=[c for c in cells if c==leaf or c.startswith(leaf+' ') and re.match(r'\d{2}년',c[len(leaf)+1:])]
        check(bool(supports),'literal_leaf_cell',model=record['model'],line=row_number,leaf=leaf,cells=cells)
        check(not any(k in record for k in ['price','sellingPrice','customer','phone','email']),'no_personal_or_price_data',doc=doc)
        counts[record['model']]+=1;seen[(doc,row_number)]+=1
        ledger.append({'model':record['model'],'sourceId':record['sourceId'],'sourceRowNumber':row_number,'sourceHierarchyRaw':record['sourceHierarchyRaw'],'literalSupportingCells':supports,'lineageVerified':True,'retailHierarchyVerified':False})
    for record in data['quarantinedRecords']:
        doc=parse_qs(urlsplit(record['sourceUrl']).query)['bbsno'][0];row=record['sourceRowNumber'];seen[(doc,row)]+=1
        check(record['eligibleForRuntimeImport'] is False,'quarantine_not_importable')
        check(doc=='135424' and row==9 and record['sourceHierarchyRaw']==['2.5','525V','LE 블랙'],'exact_quarantine_identity')
    expected={(doc,int(re.match(r'L(\d+):',row)[1]))for doc,o in observations.items()for row in o['classificationRows']if not row.startswith('L0:')}
    check(set(seen)==expected,'physical_rows_accounted',expected=len(expected),actual=len(seen))
    check(all(n==1 for n in seen.values()),'physical_rows_exactly_once')
    identities=[(r['sourceId'],tuple(r['sourceHierarchyRaw']))for r in data['records']]
    check(len(identities)==len(set(identities)),'unique_evidence_paths')
    # Independent manual inspection of the inherited source group boundaries.
    manual={
        'SM3':[('1.5',1,8),('1.6',9,12)],'SM3 뉴 제너레이션':[('1.5',1,1),('1.6',2,15)],
        '뉴 SM3':[('1.6',1,14),('2.0',15,21)],'SM3 네오':[('1.6 가솔린',1,6),('1.5 디젤',7,8)],
        'SM5':[('1.8',1,1),('2.0',2,8)],'뉴 SM5':[('2.0',1,7)],'SM5 뉴 임프레션':[('2.0 가솔린',1,8)],
        '뉴 SM5 (신형)':[('2.0',1,9),('2.5',10,11)],'뉴 SM5 플래티넘':[('1.5',1,2),('1.6',3,4),('2.0',5,18)],
        'SM5 노바':[('1.5',1,2),('1.6',3,3),('2.0',4,7)],'SM7':[('2.3',1,3),('3.5',4,8)],
        '올 뉴 SM7':[('2.5',1,8),('3.5',9,11)],'제네시스 BH':[('3.3',1,11),('3.8',12,18),('프라다',19,21)],
        '제네시스 DH':[('3.3 GDI 가솔린',1,2),('3.8 GDI 가솔린',3,5)],'제네시스 쿠페':[('2.0',1,4),('3.8',5,7)],
        '더 뉴 제네시스 쿠페':[('2.0',1,2),('3.8',3,4)],'EQ900':[('3.3 T-GDi',1,3),('3.8 GDi',4,6),('5.0 GDi',7,7)],
        'K5':[('2.0',1,11),('2.4',12,13)],'더 뉴 K5':[('2.0',1,8),('2.0 터보',9,10)],
        'K5 2세대':[('2.0 가솔린',1,5),('1.7 디젤',6,10),('1.6 T-GDi',11,13),('2.0 T-GDi',14,14)],
        'K5 하이브리드':[('2.0',1,4)],'K5 하이브리드 2세대':[('2.0',1,3)]}
    for record in data['records']:
        matching=[g for g,a,b in manual[record['model']]if a<=record['sourceRowNumber']<=b]
        check(matching==[record['sourceHierarchyRaw'][0]],'raw_group_boundary',model=record['model'],line=record['sourceRowNumber'])
    result={'pass':not errors,'normalObservations':len(data['records']),'quarantinedRows':len(data['quarantinedRecords']),'sourceModels':len(sources),'physicalRowsAccounted':len(expected),'allPhysicalRowsExactlyOnce':all(n==1 for n in seen.values()),'sourceSha256':hashlib.sha256(source_path.read_bytes()).hexdigest(),'rawObservationSha256':hashlib.sha256(raw_path.read_bytes()).hexdigest(),'countsByModel':dict(counts),'errors':errors,'scope':'Independent full audit against captured public CLS facts; does not independently re-fetch all websites or attest current retail search taxonomy','manualReviewNotes':['Temporal-column label variants remain observations, never canonical current search hierarchy.','SM5 525V/LE black row remains quarantined.','Prada in Genesis BH remains a source product-line label, not an inferred engine.','Renault current display alias retains raw Renault Samsung identity and pending parent matching.']}
    OUT.mkdir(exist_ok=True)
    (OUT/'record-ledger.json').write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
    (OUT/'summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':run()
