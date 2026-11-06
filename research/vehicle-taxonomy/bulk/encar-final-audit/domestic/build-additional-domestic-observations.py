#!/usr/bin/env python3
"""Curate only factual labels explicitly read in public Encar history CLS tables.

The table is a historical time matrix, not the current Encar search hierarchy.
All row references and raw time cells are retained; no year/engine/parent code
is synthesized. This creates research observations only, not production data.
"""
from pathlib import Path
import collections
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parent
INPUT = ROOT/'additional-22-model-classification-observations.json'

# The values below were independently read from each linked CLS table. Rows are
# bound to their public document and literal source line for a second audit.
SPECS = {
 'SM3': [('1.5',[(i,n) for i,n in enumerate(['엔트리','PE','SE','XE','FE','CE','LE','스페셜 에디션'],1)]),('1.6',[(9,'XE16'),(10,'FE16'),(11,'CE16'),(12,'LE16')])],
 'SM3 뉴 제너레이션': [('1.5',[(1,'PE')]),('1.6',[(i,n) for i,n in enumerate(['PE16','SE','SE16','SE16 플러스','XE','XE16','Neo','LE','LE16','LE 플러스','LE16 플러스','CE','CE 플러스','CE 프리미엄'],2)])],
 '뉴 SM3': [('1.6',[(i,n) for i,n in enumerate(['PE','SE','SE 블랙','SE 플러스','SE 플러스 아트','SE 블랙 썸머 에디션','LE','XE 리미티드 에디션','LE 플러스','LE 썸머 에디션','LE 익스클루시브','BOSE 스페셜 에디션','RE','RE 썸머 에디션'],1)]),('2.0',[(i,n) for i,n in enumerate(['SE 20','LE 20','LE20 썸머 에디션','LE 20 익스클루시브','BOSE 20 스페셜 에디션','RE 20','RE 20 썸머 에디션'],15)])],
 'SM3 네오': [('1.6 가솔린',[(i,n) for i,n in enumerate(['PE','SE','SE 플러스','R4U','LE','RE'],1)]),('1.5 디젤',[(7,'SE'),(8,'LE')])],
 'SM5': [('1.8',[(1,'518')]),('2.0',[(i,n) for i,n in enumerate(['520','520SE','520LE','스페셜','스페셜 플러스','520V','520V 플러스'],2)])],
 '뉴 SM5': [('2.0',[(i,n) for i,n in enumerate(['PE','SE','SE 플러스','XE','LE','LE 플러스','LE 블랙'],1)])],
 'SM5 뉴 임프레션': [('2.0 가솔린',[(i,n) for i,n in enumerate(['PE','SE','SE 플러스','SE 블랙','XE','LE','LE 익스클루시브','LE 플러스'],1)])],
 '뉴 SM5 (신형)': [('2.0',[(i,n) for i,n in enumerate(['PE','SE','SE 플러스','SE 블랙','XE','LE','LE 익스클루시브','RE','BOSE 에디션'],1)]),('2.5',[(10,'SE 플러스'),(11,'RE')])],
 '뉴 SM5 플래티넘': [('1.5',[(1,'D'),(2,'D 스페셜')]),('1.6',[(3,'TCE'),(4,'TCE S/S 컬렉션')]),('2.0',[(i,n) for i,n in enumerate(['PE','SE','SE 플러스','SE ART','SE 파노라마','SE S/S 컬렉션','LE','LE ART','LE 파노라마','LE S/S 컬렉션','RE','RE ART','RE 파노라마','RE S/S 컬렉션'],5)])],
 'SM5 노바': [('1.5',[(1,'D'),(2,'D 프리미엄')]),('1.6',[(3,'TCE')]),('2.0',[(4,'PE'),(5,'SE'),(6,'LE'),(7,'RE')])],
 'SM7': [('2.3',[(1,'SE'),(2,'XE'),(3,'LE')]),('3.5',[(4,'XE35'),(5,'LE35'),(6,'RE35'),(7,'RE35 블랙'),(8,'프리미에르')])],
 '올 뉴 SM7': [('2.5',[(i,n) for i,n in enumerate(['SE','LE','LE 아트','LE 파노라마','LE S/S 컬렉션','RE','RE 파노라마','RE S/S 컬렉션'],1)]),('3.5',[(9,'SE35'),(10,'LE35'),(11,'RE35')])],
 '제네시스 BH': [('3.3',[(1,'BH330 그랜드','기본형'),(2,'BH330 그랜드','프라임팩'),(3,'BH330 럭셔리','기본형'),(4,'BH330 럭셔리','프라임팩'),(5,'BH330 럭셔리','VIP팩'),(6,'BH330 모던','기본형'),(7,'BH330 모던','스페셜'),(8,'BH330 프리미엄','기본형'),(9,'BH330 프리미엄','스페셜'),(10,'BH330 다이나믹 에디션','기본형'),(11,'BH330 다이나믹 에디션','스페셜')]),('3.8',[(12,'BH380 럭셔리'),(13,'BH380 로얄','기본형'),(14,'BH380 로얄','VIP팩'),(15,'BH380 익스클루시브'),(16,'BH380 다이나믹 에디션','기본형'),(17,'BH380 프레스티지','기본형'),(18,'BH380 프레스티지','스페셜')]),('프라다',[(19,'GP380'),(20,'GP380 다이나믹 에디션','기본형'),(21,'GP500')])],
 '제네시스 DH': [('3.3 GDI 가솔린',[(1,'GS330 모던'),(2,'GS330 프리미엄')]),('3.8 GDI 가솔린',[(3,'GS380 익스클루시브'),(4,'GS380 프레스티지'),(5,'GS380 파이니스트 에디션')])],
 '제네시스 쿠페': [('2.0',[(1,'200 터보','터보 D'),(2,'200 터보','터보 P'),(3,'200 터보','터보 R'),(4,'200 터보','터보 Rw')]),('3.8',[(5,'380 GT','GT P'),(6,'380 GT','GT R'),(7,'380 GT','GT Rw')])],
 '더 뉴 제네시스 쿠페': [('2.0',[(1,'200 터보','터보 D'),(2,'200 터보','터보 S')]),('3.8',[(3,'380 GT','GT P'),(4,'380 GT','GT R')])],
 'EQ900': [('3.3 T-GDi',[(1,'럭셔리'),(2,'프리미엄 럭셔리'),(3,'프레스티지')]),('3.8 GDi',[(4,'럭셔리'),(5,'프리미엄 럭셔리'),(6,'프레스티지')]),('5.0 GDi',[(7,'프레스티지')])],
 'K5': [('2.0',[(1,'스마트','기본형'),(2,'스마트','스페셜'),(3,'디럭스'),(4,'트렌디'),(5,'럭셔리'),(6,'프레스티지','기본형'),(7,'프레스티지','브라운'),(8,'에코플러스 프레스티지'),(9,'노블레스'),(10,'GDI 터보','프레스티지'),(11,'GDI 터보','노블레스')]),('2.4',[(12,'프레스티지'),(13,'노블레스')])],
 '더 뉴 K5': [('2.0',[(1,'디럭스','디럭스 M/T'),(2,'디럭스','디럭스 A/T'),(3,'럭셔리','기본형'),(4,'럭셔리','트랜디'),(5,'럭셔리','W 스페셜'),(6,'럭셔리','스페셜'),(7,'프레스티지'),(8,'노블레스')]),('2.0 터보',[(9,'프레스티지'),(10,'노블레스')])],
 'K5 2세대': [('2.0 가솔린',[(i,n) for i,n in enumerate(['디럭스','럭셔리','프레스티지','노블레스','노블레스 스페셜'],1)]),('1.7 디젤',[(i,n) for i,n in enumerate(['디럭스','럭셔리','프레스티지','노블레스','노블레스 스페셜'],6)]),('1.6 T-GDi',[(11,'럭셔리'),(12,'프레스티지'),(13,'노블레스')]),('2.0 T-GDi',[(14,'노블레스 스페셜')])],
 'K5 하이브리드': [('2.0',[(1,'디럭스'),(2,'럭셔리'),(3,'프레스티지'),(4,'노블레스')])],
 'K5 하이브리드 2세대': [('2.0',[(1,'프레스티지'),(2,'노블레스'),(3,'노블레스 스페셜')])],
}


def compact(value):
    return re.sub(r'\s+','',value).casefold()


def main():
    observed=json.loads(INPUT.read_text())['records']
    sources=[];records=[];quarantined=[];checked=[]
    for observation in observed:
        model=observation['model'];doc=observation['classificationDocumentId']
        assert observation['parentHeading'].endswith(' '+model)
        assert observation['classificationUrl'].endswith('&type=CLS')
        rows={int(re.match(r'L(\d+):',x)[1]):x for x in observation['classificationRows']}
        assert rows and 0 in rows
        source_id='encar-final-domestic-'+doc
        source_make=re.sub(r'^L\d+: ### ','',observation['parentHeading']).removesuffix(' '+model)
        source={'id':source_id,'url':observation['classificationUrl'],'title':source_make+' '+model+' 역사 등급 변화 표','publisher':'엔카','retrievedAt':'2026-11-07','evidenceType':'provider_history_classification_table','parentHistoryUrl':observation['parentUrl'],'sourceMakeRaw':source_make,'sourceModelRaw':model,'modelPeriodRaw':re.sub(r'^L\d+: ','',observation['periodRaw']),'accessStatus':'fresh_parent_identity_and_linked_CLS_table_read','providerNamespace':'encar_history_not_current_search_catalog','notes':'문서표의 현재는 편집시점 표현이며2026현재판매상태로추정하지않는다. 이름/분기표 관측이며현행엔카검색5단계코드확정자료아님.'}
        sources.append(source)
        identifiers={'namespace':'encar_history','manufacturerCode':observation['providerManufacturerCode'],'modelCode':observation['providerModelCode'],'modelGroupCode':observation['providerModelGroupCode'],'documentId':doc,'gradeCode':None,'subgradeCode':None}
        used=set()
        for prefix,entries in SPECS[model]:
            for item in entries:
                line,*labels=item;raw=rows[line];used.add(line)
                # A source line can inherit a table rowspan parent; its new leaf
                # must itself appear literally on that line, not be guessed.
                assert compact(labels[-1]) in compact(raw),(model,item,raw)
                path=[prefix,*labels]
                if len(labels)==1:grade,subgrade=prefix,labels[0]
                else:grade,subgrade=' '.join([prefix,labels[0]]),labels[1]
                fuel=next((x for x in ['가솔린','디젤','LPG','전기'] if x in prefix),None)
                record={'make':observation['make'],'group':observation['group'],'model':model,'grade':grade,'subgrade':subgrade,'modelYear':None,'fuel':fuel,'engine':None,'sourceId':source_id,'sourceUrl':observation['classificationUrl'],'sourceLabel':' > '.join(path),'sourceHierarchyRaw':path,'sourceRowNumber':line,'sourceRowRaw':raw,'sourceTimeColumnsRaw':rows[0],'sourceModelRaw':model,'sourceMakeRaw':source_make,'sourceModelPeriodRaw':source['modelPeriodRaw'],'providerIdentifiers':identifiers,'parentHistoryUrl':observation['parentUrl'],'evidenceStatus':'provider_catalog_direct','retrievedAt':'2026-11-07','market':'KR','mappingStatus':'needs_parent_and_temporal_variant_match','recordType':'provider_classification_observation','retailSearchHierarchyVerified':False,'autoImport':False,'notes':'원문 명칭과 행을 보존한다. 시점별 열의 라벨은관측명이지고정부모→자식검색코드가아니다. 연식·누락연료·엔진·구동·세부분류ID를추정하지않는다.'}
                if source_make!=observation['make']:
                    record['notes']+=' 표시용제조사는기존자료의르노코리아(삼성)로분류했으며원문르노삼성명칭/코드는별도로유지;상사분류별칭자동병합없음.'
                records.append(record)
        if model=='SM5':
            used.add(9)
            quarantined.append({'make':observation['make'],'group':'SM5','model':'SM5','sourceId':source_id,'sourceUrl':observation['classificationUrl'],'sourceRowNumber':9,'sourceRowRaw':rows[9],'sourceHierarchyRaw':['2.5','525V','LE 블랙'],'reasonCode':'FIXED_GRADE_AND_TEMPORAL_CELL_LABEL_CONFLICT','decision':'525V 고정행의 시점셀 LE블랙을 하위등급으로 결합하지 않는다. 독립자료 확인전 정상등급 관측에서 제외.','eligibleForRuntimeImport':False})
        assert used==set(rows)-{0},(model,sorted(set(rows)-{0}-used))
        checked.append({'model':model,'sourceId':source_id,'physicalClassificationRows':len(rows)-1,'normalObservations':sum(r['sourceId']==source_id for r in records),'quarantinedRows':sum(r['sourceId']==source_id for r in quarantined),'everyPhysicalClassificationRowAccounted':True})
    identities=[json.dumps([r['sourceId'],r['sourceHierarchyRaw']],ensure_ascii=False)for r in records]
    assert len(identities)==len(set(identities))
    bundle={'schemaVersion':1,'researchedOn':'2026-11-07','scope':'공개 엔카 역사표 22모델의 실제 CLS 명칭·관계 관측. 현재 검색의 전세계/전연식 완전등급마스터 아님.','policy':{'automaticRuntimeImport':False,'currentSearchHierarchyVerified':False,'unknownEngineFuelYearNotInferred':True,'parentAndTemporalMatchingRequired':True,'sourceBodyProseAndPhotosCopied':False},'sources':sources,'records':records,'quarantinedRecords':quarantined}
    output=ROOT/'encar-final-domestic-expansion-20261107.json';output.write_text(json.dumps(bundle,ensure_ascii=False,indent=2)+'\n')
    summary={'sourceFile':output.name,'sourceSha256':hashlib.sha256(output.read_bytes()).hexdigest(),'models':len(sources),'normalObservations':len(records),'quarantinedRows':len(quarantined),'allPhysicalRowsAccounted':True,'uniqueEvidenceIdentities':len(set(identities)),'perModel':checked,'limitations':['Historical period and model-year are separate.','Temporal-column names do not establish a current retail search parent hierarchy.','Displayed manufacturer Renault Korea (Samsung) is a grouping alias; raw Renault Samsung identity is retained.']}
    (ROOT/'additional-22-verification.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(summary,ensure_ascii=False))


if __name__=='__main__':main()
