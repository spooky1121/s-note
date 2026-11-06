"""Create a review workbook from the frozen research JSON, without database access.

Requires the existing review environment's openpyxl package. This is an optional
artifact generator; the Node build and CSV/JSON outputs have no dependencies.
"""
from pathlib import Path
import json
import sys
import csv
import gzip
import io
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "research/vehicle-taxonomy"
EXPORTS = DATA / "exports"


def read(path):
    return json.loads(path.read_text())


def sheet(book, title, records, fields):
    page = book.create_sheet(title)
    page.append([label for key, label in fields])
    for record in records:
        values = []
        for key, label in fields:
            value = record.get(key)
            if isinstance(value, (list, dict)):
                value = json.dumps(value, ensure_ascii=False)
            values.append("" if value is None else value)
        page.append(values)
    page.freeze_panes = "A2"
    page.auto_filter.ref = page.dimensions
    page.sheet_view.showGridLines = False
    page.row_dimensions[1].height = 26
    for cell in page[1]:
        cell.font = Font(name="Aptos", size=11, bold=True, color="253858")
        cell.fill = PatternFill("solid", fgColor="EAF0F8")
        cell.alignment = Alignment(vertical="center")
    for column, (key, label) in enumerate(fields, 1):
        page.column_dimensions[get_column_letter(column)].width = 48 if key in ["sourceUrl", "notes", "url"] else 24
    for row in page.iter_rows(min_row=2):
        for cell in row:
            cell.font = Font(name="Aptos", size=11, color="394150")
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            if isinstance(cell.value, str):
                cell.data_type = "s"
    return page


def main():
    data = read(EXPORTS / "catalog-reference.json")
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "/workspace/work/s-note-vehicle-taxonomy-research-" + data['asOf'] + ".xlsx")
    target.parent.mkdir(parents=True, exist_ok=True)
    coverage = read(EXPORTS / "coverage.json")
    official = data["officialResearch"]["records"]
    book = Workbook()
    book.remove(book.active)
    summary = [
        {"item": "자료집 갱신 기준일", "value": data['asOf']},
        {"item": "조사 범위", "value": "국내 유통 차종 참고자료. 전 연식·단종 트림을 망라한 공식 마스터는 아님."},
        {"item": "기존 자료 보존", "value": coverage["baseline"]["rows"]},
        {"item": "제조사 표기", "value": coverage["baseline"]["makes"]},
        {"item": "기존 국내 선택 레코드", "value": coverage["baseline"]["domesticPicker"]["records"]},
        {"item": "새 조사 고유 기록", "value": len(official)},
        {"item": "본문·PDF 직접 확인", "value": coverage["newResearch"]["officialDirectRecords"]},
        {"item": "검색 발췌 확인", "value": coverage["newResearch"]["searchExcerptRecords"]},
        {"item": "공개 업체 분류표 관측", "value": coverage['newResearch'].get('providerCatalogDirectRecords', 0)},
        {"item": "자동차 참고자료 본문 관측", "value": coverage['newResearch'].get('referenceDirectRecords', 0)},
        {"item": "검토 후보", "value": coverage['newResearch'].get('candidateRecords', 0)},
        {"item": "한국시장 표기 관측", "value": coverage['newResearch'].get('koreanMarketRecords', 0)},
        {"item": "해외시장 표기 관측", "value": coverage['newResearch'].get('otherMarketRecords', 0)},
        {"item": "API 매물 관측", "value": coverage["listingObservations"]},
        {"item": "정부 인증 관측", "value": coverage["certificationObservations"]},
        {"item": "기존 등급 미확인 세대", "value": coverage["baseline"]["modelsWithoutGrade"]},
        {"item": "운영 DB 자동 반영", "value": "비활성화. 확인한 이름을 기존 세대·엔진·연식에 임의 연결하지 않음."},
        {"item": "연식 주의", "value": "가격표 발행일과 모델연식은 별개. 비어 있는 연식·엔진은 미확인값."},
        {"item": "선택품목 주의", "value": "engine_option/optionPackage는 기본 트림과 구분. 구동·좌석·변속기 차이는 별도 기록."},
        {"item": "기존 공식 표시", "value": "baseline의 공식 표시는 과거 코드의 분류이며 이번 조사에서 재검증했다는 뜻이 아님."},
    ]
    front = sheet(book, "읽어주세요", summary, [("item", "항목"), ("value", "내용")])
    front.column_dimensions["B"].width = 100
    official_fields = [("make", "제조사"), ("group", "차명군"), ("model", "모델·세대 표기"), ("grade", "등급 표기"), ("subgrade", "세부등급"), ("modelYear", "명시 모델연식"), ("fuel", "연료"), ("engine", "엔진"), ("drivetrain", "구동"), ("transmission", "변속기"), ("recordType", "기록 종류"), ("optionPackage", "선택품목"), ("powertrainChoice", "동력계통 선택"), ("seatingCapacity", "좌석 수"), ("evidenceStatus", "근거 확인 수준"), ("mappingStatus", "기존 분류 연결 상태"), ("sourceUrl", "출처"), ("retrievedAt", "확인일"), ("notes", "메모")]
    official_fields[10:10] = [('market','시장 구분'),('sourceMarket','원문 국가'),('sourcePeriod','자료 적용·발행 시점'),('sourcePublicationDate','원문 발표일(MY아님)'),('sourceTimelineYear','역사 소개 연도'),('availability','판매 상태'),('launchStatus','발표·출시 상태'),('trimStatus','별도 등급 공개 상태'),('qualifiers','캡·용도·추가 조건')]
    sheet(book, "차종 조사", official, official_fields)
    sheet(book, "API 원문 관측", data["listingObservations"], [("manufacturer", "제조사 원문"), ("modelGroup", "모델군 원문"), ("model", "모델 원문"), ("badge", "Badge 원문"), ("listingId", "공개 매물 ID"), ("checkedAt", "원본 조회 시각"), ("mappingStatus", "분류 연결 상태"), ("sourceFile", "별도 원문 파일")])
    sheet(book, "정부 인증 관측", data["certificationObservations"], [("certificateHolder", "인증 보유자"), ("vehicleName", "차명 원문"), ("typeCode", "형식"), ("fuelRaw", "연료 원문"), ("certificationNumber", "인증번호"), ("certificationDate", "인증일"), ("evidenceStatus", "관측 종류"), ("acquisitionMethod", "취득 방식"), ("directFetchStatus", "직접 조회 상태"), ("sourceUrl", "출처")])
    sheet(book, "기존 자료 보존", data["baseline"]["records"], [("make", "제조사"), ("group", "차명군"), ("model", "모델·세대"), ("grade", "등급"), ("subgrade", "세부등급"), ("model_year", "기존 연식"), ("market", "기존 시장 구분"), ("verification", "기존 확인 표시"), ("source_url", "기존 출처"), ("review_note", "기존 메모")])
    sheet(book, "제조사 범위", coverage["byMake"], [("make", "제조사"), ("baselineRows", "기존 자료 행"), ("baselineModels", "기존 모델·세대"), ("baselineModelsMissingGrade", "기존 등급 미확인"), ("newOfficialDirectRecords", "새 직접 확인"), ("newSearchExcerptRecords", "새 검색 확인")])
    sheet(book, "공식 자료 출처", data["officialResearch"]["sources"], [("id", "출처 ID"), ("publisher", "제공 기관"), ("title", "제목"), ("url", "주소"), ("retrievedAt", "확인일"), ("evidenceType", "확인 방식"), ("sourcePeriod", "자료 기준 시점"), ("notes", "메모")])
    ledger = DATA / "sources/brand-source-ledger.json"
    if ledger.exists():
        sheet(book, "46제조사 조사 원장", read(ledger)["manufacturers"], [("make", "기존 제조사 표기"), ("sourceUrls", "자료원 주소"), ("marketScope", "시장 범위"), ("accessStatus", "접근 상태"), ("researchStatus", "조사 상태"), ("notes", "메모")])
    gap_path = EXPORTS / 'gap-research-progress.json'
    if gap_path.exists():
        sheet(book,'기존 공백 대조',read(gap_path)['rows'],[('make','제조사'),('group','차명군'),('model','기존 모델'),('researchStatus','근거 대조 상태'),('completionStatus','전수 확인 상태'),('separateGradeRequirement','별도 등급 필요성'),('exactLabelRecords','같은 모델명 관측'),('aliasCandidateRecords','별칭 검토 후보'),('familyRecords','같은 차명군 참고'),('governmentCandidateState','정부 이름 후보 상태'),('governmentCandidateRows','정부 후보 원문 행 수'),('governmentGradeVerified','정부로 등급 확정 여부'),('sourceUrls','관련 출처')])
    index_path = DATA / 'sources/encar-public-catalog-expansion-20261106.json'
    if index_path.exists():
        model_index=read(index_path).get('modelIndex',{}).get('records',[])
        sheet(book,'공개 모델목록 원문',model_index,[('displayOrdinal','표시 순서'),('modelNameRaw','원문 모델 이름')])
    bulk = DATA / 'bulk/global-vehicle-makes-models'
    if (bulk/'archive-manifest.json').exists():
        bulk_meta=read(bulk/'archive-manifest.json')
        summary_page=book['읽어주세요']
        summary_page.append(['글로벌 별도 참고',str(bulk_meta['counts']['engines'])+'개 엔진. 한국 판매등급 확인 자료가 아니며 ODbL-1.0 독립 자료집.'])
        raw=gzip.decompress((bulk/'engines.csv.gz').read_bytes()).decode('utf-8')
        global_rows=list(csv.DictReader(io.StringIO(raw)))
        sheet(book,'글로벌 엔진 원문',global_rows,[(key,key) for key in global_rows[0]])
    government = DATA / 'bulk/government-tax-2026'
    if (government/'archive-manifest.json').exists():
        government_meta = read(government/'archive-manifest.json')
        facts = [
            {'item':'현재 정부 자료','value':'재산정·추가산정 반영본: 차량 105,383행 + 원동기·차체 개조 431행'},
            {'item':'보존한 기본본','value':'차량 105,370행 + 개조 431행. 현재본과 중복 합산하지 않음.'},
            {'item':'기본본 대비 변경','value':'추가 16행 / 삭제 3행 / 가격 변경 2행. 연번 재배열은 별도.'},
            {'item':'원문 보존','value':'두 ZIP의 전체 바이트, 차량 43시트의 전체 비어있지 않은 행·셀 자료형, 차량 원문 JSONL'},
            {'item':'금액 처리','value':'원문 천원 보존 + Decimal 원 환산. 소수 원 2건은 확정 정수값 없음. 미정 표시 33건은 null.'},
            {'item':'분류 주의','value':'과세용 차명·형식이며 판매 등급·세대·모델연식 증거가 아님. 과세가격은 판매가격이 아님.'},
            {'item':'검색 DB','value':'artifacts/government-tax-2026-amended.sqlite.gz'},
            {'item':'정부 원본·검증·출처','value':'bulk/government-tax-2026/archive-manifest.json'},
            {'item':'메타데이터','value':government_meta},
        ]
        sheet(book,'정부 전체자료 안내',facts,[('item','항목'),('value','내용')])
        book['읽어주세요'].append(['정부 차량 전체자료','현재 105,383행 / 개조 431행. 정부 전체자료 안내 시트 및 별도 검색 DB 참조.'])
        target_path = government/'crosswalk/amended-2026-reviewed/target-ledger.json'
        if target_path.exists():
            targets=read(target_path)
            if isinstance(targets,dict):
                targets=targets.get('rows',targets.get('targets',[]))
            sheet(book,'정부 이름 후보 대조',targets,[('targetId','대상 ID'),('make','제조사'),('group','차명군'),('model','기존 모델'),('baselineMissingGrade','기존 등급 공백'),('candidateState','이름 후보 상태'),('candidateRowCount','원문 후보 행 수'),('modelNameCandidateRowCount','모델 이름 후보 행 수'),('complete','완료 여부'),('generationVerified','세대 확인'),('gradeVerified','판매 등급 확인'),('remainingWork','남은 확인')])
    audit=DATA/'bulk/encar-final-audit'
    if (audit/'archive-manifest.json').exists():
        metadata=read(audit/'archive-manifest.json')
        sheet(book,'엔카 최종 검증',[{'item':key,'value':value}for key,value in metadata.items()],[('item','항목'),('value','내용')])
        with gzip.open(audit/'name-audit/final-3128/encar-display-name-ledger.jsonl.gz','rt',encoding='utf-8')as f:
            names=[json.loads(line)for line in f]
        sheet(book,'엔카 모델명 대조',names,[('encarDisplayOrdinal','표시 순서'),('encarModelNameRaw','엔카 모델명 원문'),('comparisonState','대조 상태'),('duplicateRawLabelCount','동명 표시 수'),('candidateMakeLabels','기존 제조사 후보'),('multipleCandidateMakeLabels','복수 제조사 후보'),('baselineMatchCount','기존 모델 후보 수'),('researchMatchCount','조사 기록 후보 수'),('governmentSourceRowCount','정부 원문 후보 수'),('retailGradeCoverageVerified','판매등급 완전성 확인')])
        makers=read(audit/'discovery/manufacturer-model-group-observations.json')['manufacturers']
        sheet(book,'엔카 제조사 원문',makers,[('manufacturerNameRaw','제조사 선택 원문'),('carTypeRaw','차종 풀 원문'),('manufacturerCodeObservedInLinkedUrl','공개 시세 코드'),('sourceUrl','공개 선택 주소'),('modelGroupCodesObserved','모델군 코드 확인'),('completeRenderedPageCaptured','해당 화면 전체 읽음')])
        corrections=read(audit/'errata.json')['records']
        sheet(book,'엔카 원문 표기 교정',corrections,[('id','교정 ID'),('sourceId','기존 출처 ID'),('match','원래 기록 식별'),('changes','확인한 원문 표기'),('evidenceUrl','재확인 출처'),('evidenceLine','원문 행'),('reason','교정 이유'),('status','근거 상태')])
        book['읽어주세요'].append(['엔카 최종 대조','공개 모델표시 1,858행·시세 제조사 70선택·기존593행 재검증. 신규225관측·표기17교정. 전체 현재 검색 등급 트리의 완전성은 미확인.'])
    book.save(target)
    saved = load_workbook(target, read_only=True, data_only=False)
    assert saved["차종 조사"].max_row == len(official) + 1
    assert saved["기존 자료 보존"].max_row == 1616
    assert saved["API 원문 관측"].max_row == 4
    assert saved["정부 인증 관측"].max_row == 21
    print(json.dumps({"path": str(target), "sheets": saved.sheetnames, "officialRecords": len(official), "bytes": target.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
