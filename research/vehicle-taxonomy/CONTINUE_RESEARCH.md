# 차종 조사 계속하기

사용자 목표는 국내 유통 차량의 모델·세대·연식·엔진·등급·세부등급 자료를 빠짐없이 수집·정리·보관하는 것이다. 2026-11-07 저장본은 관측 3,128행·출처 원장 563개 URL과 공개 모델목록 1,858행, 별도 글로벌 엔진 30,535행을 보존한다. 정부 기본본·현행 반영본 ZIP도 모두 사용자 첨부로 수신해 전량 정리했다. 이 자료들을 전수 판매등급 마스터로 확인한 것은 아니다. 운영 앱은 v2.80이며 차량·고객·상사 DB와 비밀값을 변경하지 않았고, 이번 자료집은 GitHub 보관용으로 Cloudflare 앱 배포를 수행하지 않는다.

## 엔카 대조 완료 범위

[최종 검토](bulk/encar-final-audit/FINAL_REVIEW.md)를 먼저 읽는다. 공개 모델 표시 1,858행 전체, 시세 제조사 70선택·모델군 표시 1,334행, 기존 엔카 51모델·593개 관측을 대조했고 새 225개 관측과 표기 교정 17개를 반영했다. 대조 전 2,903행은 별도 gzip 스냅샷으로, 최종 3,128행은 양방향 대조 원장으로 보존한다. SM5 충돌 1행은 격리했으며, 모델명 미대응 584행은 확정 누락이 아닌 후속 검토 큐다.

## 바로 이어갈 작업

1. [현행 정부 후보 원장](bulk/government-tax-2026/crosswalk/amended-2026-reviewed/target-ledger.json)과 [요약](bulk/government-tax-2026/crosswalk/amended-2026-reviewed/summary.json)을 읽고 기존 1,197개 모델/세대·등급 공백 986개별 근거를 확인한다. 후보 개수는 최신 산출물을 기준으로 하며 정부 차명·형식의 연결을 등급 확정으로 승격하지 않는다.
2. [기존 조사와의 비교](bulk/government-tax-2026/crosswalk/research-comparison-amended-2026/)를 바탕으로 양쪽 모두 단서가 없는 46개부터 세대·적용시점·엔진·판매등급 근거를 보강한다. 정부 자료에만 새 단서가 생긴 391개도 연결 후보를 검토한다. 기존 조사만의 [986개 진행 원장](exports/gap-research-progress.json)은 별도로 보존한다. 모델명이 직접 같거나 같은 차명군 자료가 있어도 전 연식·엔진·트림 확보로 처리하지 않는다.
3. [최종 미대응 원장](bulk/encar-final-audit/name-audit/final-3128/encar-unmapped-display-rows.csv.gz)과 제조사 후보를 검토하고, m.encar.com 정상 공개 화면에서 모델군 이하의 실제 부모 코드를 추가 확인한다. 공개 화면의 1,858행/고유 이름 1,805개에는 동명과 일반 ‘기타’가 있다. 행 순서로 제조사나 부모를 추정하지 않는다.
4. 서울시 차량 CSV 등 독립 원천이 추가로 확보되면 동일 기준일·차명·형식·원가격 단위를 구분해 대조한다. 정부 현행 고시 제2026-37호 이후의 추가·정정 고시도 출처와 시행일을 확인한 뒤 별도 스냅샷으로 보존한다.
5. 명칭이 비슷해도 국내/해외·연식·엔진·변속기·좌석·캡·옵션을 임의 통합하지 않는다. 모델 파생형에 별도 트림이 공개되지 않은 경우 없는 단계를 만들지 않는다.

## 수신·검증을 마친 정부 원본

- [기본본 ZIP](bulk/government-tax-2026/base/source-original.zip): 제2025-83호, 2026-01-01 시행. 차량 관측 105,370행·개조 431행.
- [현행 반영본 ZIP](bulk/government-tax-2026/amended/source-original.zip): 제2026-37호, 2026-05-27 제정·시행, 홈페이지 게시 2026-07-06. 차량 관측 105,383행·개조 431행.
- [기본 공식 게시물](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000016&nttId=122833) · [재산정·추가산정 공식 게시물](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000016&nttId=127567).
- [원본·원문·해시 설명](bulk/README.md) · [현행 검색 DB](artifacts/storage-manifest.json).

두 ZIP은 사용자가 제공한 사본을 그대로 보존했다. 공식 공고에 표시된 별표 제목·출처는 확인했으나, 별도로 내려받은 원격 공식 파일과 바이트·해시가 일치한다고 표시하지 않는다. `sources/master-expansion-20261106.json`에는 파일 취득 전의 자료원·접근 조사 이력을 보존한다.

현행 후보 원장의 기존 1,197개 대상은 이름 후보 248개·가족/시리즈 단서 880개·해당 후보 없음 69개다. 등급 공백 986개는 각각 211개·721개·54개로 구분한다. 후보 연결 300,616건은 검토용 연결 수이며 확정 판매등급·전수 완료는 각각 0개다.

차량 28개·개조 15개, 전체 43개 시트를 읽어 원문 문자열·자료형·시트·행을 보존했다. 반영본은 전체 대체 자료이며 기본본과의 전수 비교는 차량 **신규 16행·삭제 3행·가격만 변경 2행**이다. 내용이 같고 연번·행만 이동한 51,048행은 추가·삭제로 세지 않는다. TESLA Model 3 Premium Long Range RWD의 원문 빈 연번도 유지하여 차량 관측 105,383행에서 빠뜨리지 않는다.

43개 시트 단위는 모두 **천원**이다. 원가격·단위를 남기고 `Decimal`로 원 단위를 계산한다. 소수 표현 오류가 있는 가격 2행의 확정 정수 원 값과 개조의 미정 가격 `-`·`－` 33건은 null로 보존한다. 지방세 기준가격을 소매 판매가격으로 쓰거나 자료 연도 2026을 모델연식으로 복사하지 않는다. 제작사 표기에는 수입·특장 업체 등이 포함되므로 소비자 브랜드로 일괄 치환하지 않는다.

고시가 해당 ZIP을 별표로 공표했다는 사실과 저작권법 제7조의 고시 관련 근거·출처를 기록한다. ZIP 전체를 공공누리 1유형으로 선언하지 않으며 다른 공급자 자료나 제3자 이미지·상표에 같은 권리 설명을 확대하지 않는다.

저장된 원문에서 별도 검색 DB·정리 CSV를 재생성한다. XLSX는 데이터로만 읽고 매크로나 원문 수식을 실행하지 않는다.

```sh
python scripts/build-government-tax-2026.py --input-dir research/vehicle-taxonomy/bulk/government-tax-2026/amended --output-dir /tmp/snote-government-amended
python scripts/verify-government-tax-2026.py --database /tmp/snote-government-amended/government-tax-2026.sqlite --expected-vehicle-rows 105383 --output /tmp/snote-government-amended/acceptance-checks.json
```

[후보 원장 재생성 도구](bulk/government-tax-2026/crosswalk/build-government-crosswalk.py)와 [조사 비교 도구](bulk/government-tax-2026/crosswalk/compare-research-progress.py)는 같은 폴더의 별칭 후보·원문 버전을 함께 사용한다. 모델명 일치와 판매등급의 직접 근거를 구분하는 검토 상태를 유지한다.

## 검증·보존 원칙

- 기존 번들 기준 `baseline/`은 원래 1,615개 객체와 해시를 보존한다. 현재 국내 선택 목록은 1,383행이다.
- `sources/`는 수정되지 않은 기존 조사와 추가 조사 파일을 독립 보관한다. 전체 원문 필드는 통합 JSON의 `sourceRecord`와 `evidence`에 남는다.
- 카위키 자동화 응답은 합성·변형 가능성이 명시돼 44행을 격리했고, 추가 SM5 충돌 1행도 격리했다. 엔카 NF쏘나타 헤더/SM520 본문 충돌 1건도 격리했다. 원천의 오류를 정상 등급으로 승격하지 않는다.
- 웹 도구의 turn... 참조가 동시 에이전트 사이에 다른 페이지로 해석된 일이 있었다. 가능한 전체 URL로 요청하고 반환 URL·제목·본문을 대조한다.
- `bulk/global-vehicle-makes-models/`에는 글로벌 JSON 84,443,772바이트를 무손실 gzip으로 보존했다. 164제조사/2,649모델/7,217세대/30,535엔진은 원본을 실제로 센 수다. 별도 ODbL-1.0 자료이며 한국 판매 근거로 합치지 않는다.
- 테스트: `node tests/vehicle-taxonomy-research.test.mjs`, bulk 원문 해시/CSV·JSON 일치, 조사·글로벌·정부 SQLite의 무결성·FK·실제 FTS 결과, 엑셀 재열람을 확인한다. 정부 기본본·반영본은 입력 ZIP 내부 XLSX 해시와 전체 raw/typed 필드·정확한 원 환산·빈 연번·형식 충돌 보존도 검증한다. 자료 변경 후에만 관련 검증을 다시 한다.
- 수집 자료는 고객/차량/상사 차종 DB와 분리한다. 원문의 완전성과 분류 연결이 증명되기 전에는 `completeOfficialMaster`나 자동 DB 가져오기를 켜지 않는다.
