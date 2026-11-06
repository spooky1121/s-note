#!/usr/bin/env python3
"""Summarize the frozen Encar comparison; no network or production writes."""
from pathlib import Path
import json

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'research/vehicle-taxonomy'
AUDIT=DATA/'bulk/encar-final-audit'


def read(path):
    return json.loads(path.read_text())


def main():
    names=read(AUDIT/'name-audit/final-3128/summary.json')
    pricing=read(AUDIT/'discovery/derived/summary.json')['counts']
    domestic=read(AUDIT/'domestic/handoff-manifest.json')
    imports=read(AUDIT/'imports/handoff-manifest.json')
    verification=read(AUDIT/'name-audit/final-3128/verification.json')
    assert verification['ok'] and verification['errors']==0
    observations=read(DATA/'exports/official-research.json')['records']
    corrections=read(AUDIT/'errata.json')['records']
    assert len(observations)==3128 and len(corrections)==17
    assert sum(bool(row.get('sourceCorrections'))for row in observations)==17
    counts={
        'modelDisplayRows':names['displayRows'],'uniqueRawModelLabels':names['uniqueRawLabels'],
        'duplicateExcessDisplayRows':names['duplicateExcessRows'],'genericModelDisplayRows':names['genericDisplayRows'],
        'priceManufacturerChoices':pricing['encarPriceManufacturerChoices'],
        'priceManufacturerNames':68,'priceManufacturerGenericBuckets':2,
        'priceModelGroupDisplayRows':pricing['modelGroupDisplayAppearances'],
        'priceModelGroupNameSectionRows':pricing['modelGroupNameListRows'],
        'existingHistoryModelsAudited':domestic['existingModelsAudited']+imports['modelParentsRechecked'],
        'existingEncarClassObservationsAudited':domestic['existingUniqueObservationsAudited']+imports['originalProviderRecords'],
        'additionalHistoryModelsRead':domestic['newModelsRead'],
        'newHistoryObservations':domestic['newNormalObservations']+imports['newMissingRows'],
        'confirmedPreviouslyOmittedSourceTableRows':imports['newMissingRows'],
        'rawLabelCorrections':len(corrections),'newConflictingSourceRowsQuarantined':domestic['newQuarantinedRows'],
        'curatedRecordsBefore':2903,'curatedRecordsAfter':len(observations),
        'baselineModelTargetsCompared':names['baselineModelTargets'],
        'governmentRawRowsCompared':names['governmentRawRowsRead'],
        'unmatchedDisplayRowsUnderDeclaredRules':names['displayRowStates']['not_found_under_declared_rules'],
    }
    assert counts['existingEncarClassObservationsAudited']==593 and counts['newHistoryObservations']==225
    component={
        'schemaVersion':1,'component':'encar-final-audit','asOf':'2026-11-07',
        'market':'ENCAR_PUBLIC_DISPLAY_PRICE_CHOICES_AND_EDITORIAL_HISTORY',
        'license':'Source-attributed classification facts; descriptions, photos and listings are not republished.',
        'completeForKoreanMarket':False,'completeCurrentEncarRetailHierarchy':False,
        'runtimeImportEnabled':False,'allRenderedModelNamesCompared':True,
        'allPreviouslySavedEncarClassObservationsAudited':True,
        'counts':counts,'displayNameComparisonStates':names['displayRowStates'],
        'normalizationPolicy':'Keep saved sourceRecord/evidence unchanged; verified exact-match errata alter only normalized research fields.',
        'coverageLimit':'The 1858-entry model-label list lacks manufacturer/parent codes. Price choices are a service subset. History matrices do not establish all current or historical retail grade nodes.',
        'freshnessLimit':'Web-tool read time is recorded; origin cache generation timestamps are not exposed.',
        'paths':{
            'report':'research/vehicle-taxonomy/bulk/encar-final-audit/FINAL_REVIEW.md',
            'currentIndex':'research/vehicle-taxonomy/bulk/encar-final-audit/current-index/current-index.json',
            'finalNameLedger':'research/vehicle-taxonomy/bulk/encar-final-audit/name-audit/final-3128/',
            'beforeComparison':'research/vehicle-taxonomy/bulk/encar-final-audit/name-audit/preaudit-2903/',
            'errata':'research/vehicle-taxonomy/bulk/encar-final-audit/errata.json',
            'fileManifest':'research/vehicle-taxonomy/bulk/encar-final-audit/component-file-manifest.json',
        },
    }
    (AUDIT/'archive-manifest.json').write_text(json.dumps(component,ensure_ascii=False,indent=2)+'\n')
    states=names['displayRowStates']
    report=f'''# 엔카 대조 최종 검토

2026-11-07 한국시간 기준. 엔카 공개 화면·연결된 역사 등급표와 저장 자료를 대조했다. 조사 관측은 **2,903행 → 3,128행**이다. 기존 번들 1,615행과 정부 기본본·수정본 원본은 유지한다.

| 검토 대상 | 확인 범위·결과 |
|---|---|
| 공개 모델 표시 목록 | 1,858행 전부 대조. 고유 문자열 1,805개, 중복 초과 53행. 이전 보존본과 순서·이름 변경 0 |
| 기존 엔카 역사 등급 관측 | 51모델의 593행 전부 재검토. 수입차 38모델의 ENG/CLS 76개 실제 응답 URL도 확인 |
| 확정된 표 내 누락 | BMW F10의 550i xDrive·Active Hybrid 5·M5 3행 보완. 편집 표의 문맥이며 현재 검색의 5시리즈/M5 계층으로 자동 합치지 않음 |
| 추가 원천 관측 | 국산 22모델의 정상 222행 추가. 신규 표의 물리 223행 중 SM5 상충 1행은 격리 |
| 원문 표기 교정 | rawTrimLabel 17건 교정. 원래 sourceRecord/evidence는 유지. grade 명칭 변경 0 |
| 시세 제조사 선택 | 70선택 전부 확인: 제조사명 68 + 기타 범주 2. 인기 중복 6표시는 별도 |
| 시세 모델군 표시 | 1,334행 = 이름순 1,124 + 인기 중복 210. 이름순에는 기타·미사용·하이픈 등 예약 43행 포함 |
| 정부 자료 대조 | 차량 105,383행 전체 이름 필드 대조. 세금 가격·형식을 판매등급 코드로 사용하지 않음 |

## 모델명 전수 대조 결과

| 상태 | 표시 행 수 |
|---|---:|
| 문자 그대로 같은 이름 후보 | {states['literal_name_candidate']} |
| 공백·괄호 등 표기 차이 단서 | {states['presentation_only_hint']} |
| 같은 차명군 단서만 있음 | {states['family_hint_only']} |
| 정부 이름의 같은 문자열 후보만 있음 | {states['government_name_only_candidate']} |
| 정부 이름의 약한 표기 단서만 있음 | {states['government_name_hint_only']} |
| 선언한 규칙에서 미대응 | {states['not_found_under_declared_rules']} |
| 일반 기타 표시 | {states['generic_label_unclassifiable']} |

**584행은 확정 누락 수가 아니다.** 제조사·부모 코드가 없는 전역 이름 목록과의 미대응 상태다. 동명이거나 비슷한 이름만으로 다른 제조사·세대·엔진·연식을 합치지 않는다. [미대응 검토 목록](name-audit/final-3128/encar-unmapped-display-rows.csv.gz)과 [전체 양방향 대조](name-audit/final-3128/)에 원문·후보·근거를 보존했다. 기존 1,197개 모델과 최종 3,128개 관측도 각각 전부 역방향 대조했다.

## 원천의 불확실성

- 시세 화면의 70개 선택은 엔카 전체 판매 제조사 범위가 아니다. 테슬라는 이 시세 메뉴에 없지만 전역 모델 검색에는 있다.
- 시세 이름순 1,124행 중 예약 항목 43행을 제외한 이름은 1,081행이다. 기존 가족명과 미대응인 이름 700행·제조사 선택 27개는 추가 검토 후보이며, 현재 검색의 모든 세대가 빠졌다는 뜻은 아니다.
- SM5의 고정 525V와 시점 셀 LE 블랙 충돌은 격리했다. SM7·뉴 SM5 플래티넘의 시점별 이름 변화도 원문 시간 열과 분리해 보관한다.
- 기존 NF 쏘나타 제목/SM5 본문 충돌은 재현되어 격리 유지. 수입 W205 혼합 2행도 기존 제외 상태를 유지한다.
- A6의 상위 셀 4개와 추가 필드 검토 10건은 보류 상태를 명시했다. 엔진 표의 이전·다음 세대 비교 열을 현재 모델의 사양으로 일괄 합치지 않는다.
- 문서의 `현재`·출시기간은 모델연식이 아니다. 모델군 이하 공급자 코드와 전 연식·모든 판매 등급의 완전성은 아직 확인되지 않았다.

## 재현·보존

[파일 해시](component-file-manifest.json), [모델명 전수 검증](name-audit/final-3128/verification.json), [국산 원문 검증](domestic/additional-22-verification.json), [수입 원문 감사](imports/independent-audit/summary.json), [제조사·모델군 검증](discovery/verification.json)을 함께 저장한다. 고객·차량·상사 운영 DB 변경이나 유료 API 추가 호출은 수행하지 않았다. 이번 대조가 증명하는 범위는 위에 실제로 읽고 비교한 공개 자료이며, **현행 엔카 전체 분류 마스터의 완성으로 표시하지 않는다.**
'''
    (AUDIT/'FINAL_REVIEW.md').write_text(report)
    (AUDIT/'README.md').write_text('# 엔카 대조 자료\n\n[최종 검토 결과](FINAL_REVIEW.md) · [범위·건수](archive-manifest.json) · [파일 SHA](component-file-manifest.json)\n\n기존 입력·대조 전/후 원장·검증·확정 교정과 미해결 후보를 각각 보존한다. 원문이 뒷받침하지 않는 제조사·부모·연식·엔진·판매등급 연결은 만들지 않는다.\n')
    print(json.dumps(counts,ensure_ascii=False))


if __name__=='__main__':main()
