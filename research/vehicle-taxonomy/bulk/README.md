# 대규모 원천 자료 보관

이 폴더는 개별 제조사 조사와 분리한 원본 스냅샷이다. 원천의 분류 목적과 시장 범위를 보존하며, 기록 수를 한국 판매등급 확인 수로 합산하지 않는다.

## 글로벌 차종·엔진 원본

`global-vehicle-makes-models/`는 [vehicle-makes-models](https://github.com/gor3a/vehicle-makes-models)의 커밋 `ee99776470a45214bf524cdfe22e5dbf4bd67f93`에서 내려받은 자료다. 상위 사실 출처는 autoevolution.com이며, 데이터 라이선스는 **ODbL 1.0**이다. [원래 라이선스와 출처](global-vehicle-makes-models/LICENSE-DATA), [라이선스 전문](https://opendatacommons.org/licenses/odbl/1-0/)을 함께 확인한다. 프로젝트의 코드 라이선스 MIT와 데이터 라이선스를 구분한다.

원문 바이트를 바꾸지 않고 gzip으로 압축했다. `archive-manifest.json`에 원래 파일 URL·커밋·바이트 수·SHA-256과 압축 파일의 해시를 기록했다. 수집본을 직접 센 결과는 제조사 164개, 모델 2,649개, 세대 7,217개, 엔진 30,535개다. 저장소 소개에 기재된 예전 수치와 다르므로 실제 저장 파일을 기준으로 삼는다.

- `all.json.gz`: 원문 JSON 전체 84,443,772바이트. 엔진별 원래 `specs`까지 보존한다.
- `engines.csv.gz`: 원문 엔진 CSV 전체 30,535행·23열.
- `makes-models.csv.gz`: 원문 모델 CSV 전체.
- `README.md`, `LICENSE-DATA`, `LICENSE`: 원천 설명과 라이선스 원문.

**해외 제원 자료이며 한국 판매 여부·국내 트림의 근거가 아니다.** 제조사·차종명 대조와 엔진 구분의 참고로만 사용한다. 전 세계 모든 차종이 들어 있다는 보증이나 한국 세부등급 전수 완성을 뜻하지 않는다. 독립된 ODbL 자료집으로 보관하며 운영 차종 DB에 자동 병합하지 않는다. 이를 바꿔 배포할 때도 원천의 출처표시·동일조건 공유 조건을 유지한다.

```sh
python scripts/verify-bulk-vehicle-references.py
# 원문을 확인할 때: gzip -dc research/vehicle-taxonomy/bulk/global-vehicle-makes-models/all.json.gz
```

## 정부 차량 형식·기준가격 자료

`government-tax-2026/`에는 사용자가 첨부한 행정안전부 2026년 기준가격 **기본본과 재산정·추가산정 반영본 전체 ZIP**을 각각 보관한다. 공식 게시물의 별표 첨부 이름과 대응하는 사본이며, 별도로 내려받은 공식 서버 파일과 해시를 비교했다고 표시하지 않는다. [기존 조사 파일](../sources/master-expansion-20261106.json)에는 파일 취득 전의 자료원·접근 조사 이력을 보존한다.

| 구분 | 원본 | 법적 기준일 | 차량 관측 | 개조 관측 |
|---|---|---|---:|---:|
| 기본본 | [base/source-original.zip](government-tax-2026/base/source-original.zip) | 제2025-83호, 2026-01-01 시행 | 105,370 | 431 |
| 현행 반영본 | [amended/source-original.zip](government-tax-2026/amended/source-original.zip) | 제2026-37호, 2026-05-27 시행 | 105,383 | 431 |

각 폴더의 원본 ZIP(내부 차량 XLSX 포함)·매니페스트·워크북 전체 비어 있지 않은 행 JSONL·차량 JSONL은 원문 문자열과 숫자/문자 자료형, 원래 시트·행을 보존한다. 43개 시트는 차량 28개와 개조 15개로 구분하며 빈 서식 행을 자료 행으로 세지 않는다. 현행 반영본의 TESLA Model 3 Premium Long Range RWD는 원문 연번이 빈 실제 관측 1행으로 포함한다.

기본본과 반영본은 연번을 제외한 내용의 다중집합으로 비교했다. 차량 신규 16행·삭제 3행·가격만 변경 2행이며, 내용이 같은 51,048행의 행·연번 이동을 추가·삭제로 세지 않는다. 반영본은 전체 대체 자료이므로 기본본 뒤에 이어 붙이지 않는다.

두 워크북의 43개 시트 단위는 모두 **천원**이다. 정리 자료는 원가격·명시 단위를 보존하고 `Decimal`로 원 단위를 계산한다. 원문 소수 표현 오류 2건의 정수 원 값과 개조 미정 가격 `-`·`－` 33건은 null로 두고 검토값을 구분한다. 세금 산정용 형식·기종명은 소매 판매트림 계층과 다르며, 지방세 기준가격을 판매가격으로 사용하거나 자료 연도 2026을 모델연식으로 복사하지 않는다.

**출처·권리 범위:** [기본 고시](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000016&nttId=122833)와 [재산정·추가산정 고시](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000016&nttId=127567)는 해당 ZIP을 `[별표]`로 공표한다. 저작권법 제7조 제2호의 국가·지방자치단체 고시 관련 근거와 공식 사실 자료의 출처를 기록하되, **전체 ZIP을 공공누리 1유형으로 선언하지 않는다.** 고시·별표에 대한 설명을 별도 제3자 이미지·상표·다른 공급자 자료의 권리로 확대하지 않는다. 현행 고시는 2026-05-27 시행, 홈페이지 게시일은 2026-07-06으로 구분한다.

[현행 후보 대조 원장](government-tax-2026/crosswalk/amended-2026-reviewed/)은 기존 1,197개 모델/세대와 등급 공백 986개에 대한 정부 차명·형식 후보를 추적한다. 연결 후보가 있다는 사실을 모델연식·엔진·판매등급 확정으로 처리하지 않는다. [기존 조사 비교](government-tax-2026/crosswalk/research-comparison-amended-2026/)도 함께 확인한다.

```sh
python scripts/build-government-tax-2026.py --input-dir research/vehicle-taxonomy/bulk/government-tax-2026/amended --output-dir /tmp/snote-government-amended
python scripts/verify-government-tax-2026.py --database /tmp/snote-government-amended/government-tax-2026.sqlite --expected-vehicle-rows 105383 --output /tmp/snote-government-amended/acceptance-checks.json
```

자료는 GitHub의 별도 조사 자료집으로 보관한다. 운영 앱 v2.80·고객·차량·상사 DB에는 자동 연결하지 않으며 이 자료 보관을 위한 Cloudflare 앱 배포는 하지 않는다.


## 엔카 최종 대조

[encar-final-audit](encar-final-audit/FINAL_REVIEW.md)에 공개 모델 표시 1,858행, 시세 제조사 70선택/모델군 표시 1,334행, 기존 역사표 593관측 재검증·신규 225관측·원문 표기 17교정을 보존한다. 대조 전·후 이름 원장, 원천 시점열, 실제 연결 주소·코드, 독립 감사와 재현 도구를 포함한다. 표시명 미대응을 등급 누락 확정으로 바꾸지 않는다.
