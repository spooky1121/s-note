# 엔카 공개 시세검색 제조사·모델군 대조

2026-11-07 한국시간에 확인한 엔카 공개 시세 선택화면의 **표시 범위**를 보존했다. 엔카 전체 매물 분류나 전 연식·등급 마스터를 내려받았다는 뜻이 아니다. 원본 HTML 바이트가 아니라 웹 읽기 도구가 제공한 렌더링 텍스트의 사실 관측이며, 실제 관측 시각과 도구의 원문 크롤링 시점 표기를 함께 남겼다.

공식 출발점은 [제조사 선택화면](https://m.encar.com/pr/company.json?method=carList)이다. 이 화면에서 실제 제조사 링크를 따라가 도착한 URL의 `carType`·`mnfccd`만 기록했다. 제조사별 전체 출처 URL은 `manufacturer-model-group-observations.json`에 있다. 예를 들어 [현대](https://m.encar.com/pr/model.json?carType=kor&method=carList&mnfccd=001), [BMW](https://m.encar.com/pr/model.json?carType=for&method=carList&mnfccd=012), [시트로엥/DS](https://m.encar.com/pr/model.json?carType=for&method=carList&mnfccd=022) 화면이다.

## 확인한 범위

- 제조사 선택지 70개: 국산 7개·수입 63개. 여기에는 ‘기타 제조사’·‘기타 수입차’ 두 범주가 포함된다. 수입 인기 제조사 6개를 별도 제조사로 더하지 않는다. 원문 표시는 인기 중복까지 76행이다.
- 제조사별 70개 화면의 선택영역 **모든 줄 위치를 빠짐없이 보존하고 재파싱**했다. 모델군 표시는 1,334행이며 이름순 1,124행·인기 중복 210행이다.
- 이름순 1,124행 중 43행은 ‘기타’·‘미사용’·‘-’ 같은 범주/예약값이다. 나머지 이름 표시는 1,081행이다. 이 숫자를 검증된 실제 모델군·세대 수로 바꾸지 않는다.
- 제조사 코드는 70개 실제 링크의 URL에서 관측했다. 웹 읽기 도구의 링크 번호와 표시 순번을 제조사나 모델군 코드로 쓰지 않는다. 모델군 이하 코드는 관측되지 않았다.

## 기존 자료 대조

기존 제조사 표기 46개는 동일 표시 후보 39개·선언한 별칭 후보 6개·이 시세 메뉴에서 보이지 않는 1개로 구분된다. 미표시 항목은 **테슬라**다. 별도 [공개 모델 검색 목록](https://m.encar.com/ca/initString.json?method=initList&type=Is)에 테슬라 모델명은 있으므로, 이 시세 메뉴에 없다는 이유로 테슬라를 삭제하거나 엔카 전체에 없다고 결론 내리지 않는다.

기타 두 범주를 제외한 엔카 제조사 선택지 중 기존 baseline/curated 자료에 제조사 이름 후보가 없는 선택지는 27개다. 다이하쯔, 닷지, MG로버, 르노, 마이바흐, 마쯔다, 머큐리, 미쯔비시, 미쯔오까, 부가티, 북기은상, 뷰익, 사브, 사이언, 새턴, 스마트, 알파 로메오, 어큐라, 오펠, 올즈모빌, 이스즈, 코닉세그, 크라이슬러, 파가니, 포톤, 폰티악, 험머다. 이는 기존 소비자 분류 목록의 제조사 단서 보강 대상이며, 글로벌 별도 참고 DB나 정부 제작사 원문에도 자료가 전혀 없다는 뜻은 아니다.

모델군 이름순 1,124행 가운데 같은 제조사 후보·차명군 표시가 기존 baseline과 일치하는 후보는 381행이다. 일치하지 않는 743행에는 범주/예약 43행과 이름 700행이 포함된다. **700개 또는 743개가 모두 실제 누락이라고 확정한 결과가 아니다.** 세부 표기·그룹 범위·제조사 별칭과 기존 분류 구조를 검토해야 한다.

정부 수정본 차량 원문 105,383행의 제작사 표기 2,065개도 모두 비교했다. 같은 표시 또는 선언한 철자/회사명 별칭으로 연결한 원문 표기는 61개, 해당 규칙으로 후보가 없는 표기는 2,004개다. 정부 자료에는 특장업체·수입사·이륜차 제작사도 있으므로 2,004개를 소비자 자동차 제조사 누락 수로 사용하지 않는다. 원문 제작사별 행 수 합계는 105,383이며 전체 행 참조는 해시를 고정한 정부 raw JSONL에 있다. 표의 `sourceExamples`는 최대 세 사례이며 전 행 목록이 아니다.

`쉐보레(GM대우)`와 수입 `쉐보레`, `시트로엥/DS`, KG·르노 표기 등은 원문 범주를 유지한다. 연구자가 선언한 별칭 후보와 실제 공급자가 승인한 정식 매핑을 구분한다. 여러 선택지에 같은 기존 자료가 후보로 연결될 수 있으므로 후보 수를 합쳐 고유 모델 수로 세지 않는다. 자동 병합·운영 가져오기·판매 등급 확정은 모두 0개다.

## 하위 분류 확인 한계

모델군 항목들은 웹 읽기 결과에서 같은 JavaScript 동작 링크로 표시된다. BMW에서 실제 모델군 동작을 따라간 확인에서도 같은 제조사 선택 URL·목록이 반환됐다. `model-group-navigation-check.json`에 기록했으며, 웹 읽기 도구가 JavaScript 선택 상태를 진행하지 못했다는 의미다. 실제 브라우저 UI에 하위 데이터가 없다는 뜻이 아니다.

PC 검색·홈은 ‘비정상적인 트래픽’으로 이용 제한된 본문을 반환했다. 제한 응답을 매물·분류가 없다는 결과로 바꾸지 않았고 우회하지 않았다. 공개 API 경로·분류 코드를 추측해 만들어내거나 사용자 ENCAR_API_KEY를 사용하지 않았다. 원문 모델 소개 설명·사진·개별 매물·연락처는 이 자료집에 복제하지 않았다.

## 파일과 검증

- `manufacturer-model-group-observations.json`: 원문 선택 순서·중복·모델군·선택영역 줄·실제 연결 URL과 관측 코드.
- `derived/manufacturer-comparison.json`: 기존 46개 표기와 엔카 70개 선택지, 정부 제작사 2,065개 표기를 전부 포함한 대조 원장.
- `derived/model-group-comparison.json` 및 CSV: 1,334개 표시 원문과 같은 가족명 후보. 범주/예약값을 별도 표시한다.
- `derived/declared-alias-candidates.json`: 연구자가 선언한 후보 규칙. 공식 별칭 목록으로 취급하지 않는다.
- `verification.json`: 70개 화면 전체 선택영역 줄, 1,334개 표시 재파싱, URL 코드·CSV 원문·전체 수량 검증 결과.
- `manifest.json`: 최종 파일 해시. 원본 운영 DB나 기존 source 파일은 변경하지 않았다.

재생성은 네트워크 없이 원문 사실 파일과 고정된 baseline·조사·정부 JSONL을 읽는다. 아래 `SNOTE_RESEARCH_ROOT`에는 저장소의 `research/vehicle-taxonomy` 경로를 지정한다.

```sh
SNOTE_RESEARCH_ROOT=/path/to/research/vehicle-taxonomy
python build-manufacturer-audit.py --observed manufacturer-model-group-observations.json --baseline "$SNOTE_RESEARCH_ROOT/baseline/catalog.json" --research "$SNOTE_RESEARCH_ROOT/exports/official-research.json" --government "$SNOTE_RESEARCH_ROOT/bulk/government-tax-2026/amended/vehicle-records.raw.jsonl.gz" --output-dir derived
python verify-manufacturer-audit.py --output verification.json
```
