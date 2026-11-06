"""Create a review workbook from the frozen research JSON, without database access.

Requires the existing review environment's openpyxl package. This is an optional
artifact generator; the Node build and CSV/JSON outputs have no dependencies.
"""
from pathlib import Path
import json
import sys
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
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "/workspace/work/s-note-vehicle-taxonomy-research-2026-11-06.xlsx")
    target.parent.mkdir(parents=True, exist_ok=True)
    data = read(EXPORTS / "catalog-reference.json")
    coverage = read(EXPORTS / "coverage.json")
    official = data["officialResearch"]["records"]
    book = Workbook()
    book.remove(book.active)
    summary = [
        {"item": "기준일", "value": "2026-11-06"},
        {"item": "조사 범위", "value": "국내 유통 차종 참고자료. 전 연식·단종 트림을 망라한 공식 마스터는 아님."},
        {"item": "기존 자료 보존", "value": coverage["baseline"]["rows"]},
        {"item": "제조사 표기", "value": coverage["baseline"]["makes"]},
        {"item": "기존 국내 선택 레코드", "value": coverage["baseline"]["domesticPicker"]["records"]},
        {"item": "새 조사 고유 기록", "value": len(official)},
        {"item": "본문·PDF 직접 확인", "value": coverage["newResearch"]["officialDirectRecords"]},
        {"item": "검색 발췌 확인", "value": coverage["newResearch"]["searchExcerptRecords"]},
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
    sheet(book, "새 공식 조사", official, official_fields)
    sheet(book, "API 원문 관측", data["listingObservations"], [("manufacturer", "제조사 원문"), ("modelGroup", "모델군 원문"), ("model", "모델 원문"), ("badge", "Badge 원문"), ("listingId", "공개 매물 ID"), ("checkedAt", "원본 조회 시각"), ("mappingStatus", "분류 연결 상태"), ("sourceFile", "별도 원문 파일")])
    sheet(book, "정부 인증 관측", data["certificationObservations"], [("certificateHolder", "인증 보유자"), ("vehicleName", "차명 원문"), ("typeCode", "형식"), ("fuelRaw", "연료 원문"), ("certificationNumber", "인증번호"), ("certificationDate", "인증일"), ("evidenceStatus", "관측 종류"), ("acquisitionMethod", "취득 방식"), ("directFetchStatus", "직접 조회 상태"), ("sourceUrl", "출처")])
    sheet(book, "기존 자료 보존", data["baseline"]["records"], [("make", "제조사"), ("group", "차명군"), ("model", "모델·세대"), ("grade", "등급"), ("subgrade", "세부등급"), ("model_year", "기존 연식"), ("market", "기존 시장 구분"), ("verification", "기존 확인 표시"), ("source_url", "기존 출처"), ("review_note", "기존 메모")])
    sheet(book, "제조사 범위", coverage["byMake"], [("make", "제조사"), ("baselineRows", "기존 자료 행"), ("baselineModels", "기존 모델·세대"), ("baselineModelsMissingGrade", "기존 등급 미확인"), ("newOfficialDirectRecords", "새 직접 확인"), ("newSearchExcerptRecords", "새 검색 확인")])
    sheet(book, "공식 자료 출처", data["officialResearch"]["sources"], [("id", "출처 ID"), ("publisher", "제공 기관"), ("title", "제목"), ("url", "주소"), ("retrievedAt", "확인일"), ("evidenceType", "확인 방식"), ("sourcePeriod", "자료 기준 시점"), ("notes", "메모")])
    ledger = DATA / "sources/brand-source-ledger.json"
    if ledger.exists():
        sheet(book, "46제조사 조사 원장", read(ledger)["manufacturers"], [("make", "기존 제조사 표기"), ("sourceUrls", "자료원 주소"), ("marketScope", "시장 범위"), ("accessStatus", "접근 상태"), ("researchStatus", "조사 상태"), ("notes", "메모")])
    book.save(target)
    saved = load_workbook(target, read_only=True, data_only=False)
    assert saved["새 공식 조사"].max_row == len(official) + 1
    assert saved["기존 자료 보존"].max_row == 1616
    assert saved["API 원문 관측"].max_row == 4
    assert saved["정부 인증 관측"].max_row == 21
    print(json.dumps({"path": str(target), "sheets": saved.sheetnames, "officialRecords": len(official), "bytes": target.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
