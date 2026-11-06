# 2026년 정부 차량 기준가격 자료

사용자가 제공한 행정안전부 공식 고시 별표 사본을 보존한 자료집입니다. 현재 참조본은 `amended`입니다. 기본본과 수정본은 각각 독립된 이력으로 저장했습니다.

| 스냅샷 | 고시 | 시행일 | 차량 원문행 | 원동기·차체변경행 |
| --- | --- | --- | ---: | ---: |
| `base` | 제2025-83호 | 2026-01-01 | 105,370 | 431 |
| `amended` | 제2026-37호 | 2026-05-27 | 105,383 | 431 |

수정본 공식 웹 게시일은 2026-07-06입니다. 기본본 대비 차량 16행 추가, 3행 삭제, 2행 가격 변경을 전수 대조했습니다. 연번이 비어 있는 TESLA 1행도 수정본에 포함합니다. 2026은 자료의 적용 연도이며 차량 모델연식으로 입력하지 않습니다.

## 보존 파일

각 스냅샷 폴더의 파일은 다음과 같습니다.

- `source-original.zip`: 제공된 ZIP의 원본 바이트와 SHA-256을 그대로 보존했습니다. 차량 외 별표 파일도 원본 안에 남아 있습니다.
- `vehicle-records.raw.jsonl.gz`: 차량 전체행의 `sourceSheet`, `sourceRow`, 원문 필드, OOXML 숫자·문자 셀 자료형을 보존합니다.
- `workbook-rows.raw.jsonl.gz`: 차량 통합문서 43시트의 모든 비어 있지 않은 원문행과 셀을 보존합니다. 머리글과 원동기·차체변경 표도 포함합니다.
- `archive-manifest.json`, `vehicle-export-manifest.json`: 원본·원문 추출 파일의 해시, 시트별 행수, 단위와 범위를 기록합니다. 실행 환경의 절대경로는 스냅샷 상대경로로 정리했습니다.
- `independent-source-data-audit.json.gz`: 원문 필드·자료형·Decimal 가격·충돌 보존을 전수 대조한 독립 감사 원문입니다. 보고서가 검사한 당시 작업용 DB 해시는 보고서 안에 유지했습니다.
- 검증·품질 JSON: 빈 필드, 소수 표현, 자료형, 시트별 단위와 행수의 근거를 보존합니다.

수정본의 `complete-vehicle-and-modification-diff.json`은 두 스냅샷의 전체 대조 결과입니다. 현재 저장소 경로로 재생성한 DB의 해시와 검증 결과는 `amended/build-summary.json`, `amended/validation-log.json`, `amended/acceptance-tests.json`에 있습니다. 과거 독립 감사의 DB 해시와 현재 파생 DB의 해시는 출처 경로 메타데이터가 달라 구분하여 기록합니다.

이름 색인의 예시 참조는 항목마다 최대 3개입니다. 전체 행을 연결할 때는 원문 JSONL을 사용합니다. `name-index-scope.json`에 이 범위를 명시했습니다.

## 현재 검색·정리 결과

저장소에는 수정본의 파생 자료를 보존합니다.

- `../../artifacts/government-tax-2026-amended.sqlite.gz`
- `../../artifacts/government-tax-2026-amended.vehicles.csv.gz`
- `../../artifacts/government-tax-2026-amended.modifications.csv.gz`

SQLite에는 차량·변경내역·시트·원본 파일·동일 제작사/형식의 다차명 충돌·FTS 검색 테이블이 있습니다. 동일 제작사와 형식의 다차명 1,558그룹을 별도로 남겼고, 같은 이름·형식의 서로 다른 가격도 보존했습니다. 식별자는 원본 ZIP 해시와 시트·원문행으로 생성합니다. 고객·매입·판매·상사 분류 DB에 자동 반영하지 않습니다.

제작사, 차명, 기종명, 형식과 연료는 원문 그대로 검색할 수 있습니다. 화물 시트 안의 `특수` 차종과 비어 있는 차종을 유지합니다. 제공되지 않은 연료, 소매 세대·등급·세부등급·부모 코드는 추정하지 않습니다. 이 자료의 `market`은 `GOVERNMENT_TAX_REFERENCE_NOT_RETAIL`입니다.

## 금액

두 원본 통합문서의 43시트 모두 단위를 `천원`으로 확인했습니다. 원문 값과 단위는 별도 필드로 유지하고, 정리 결과의 `wonExact`는 Decimal로 원 환산한 정확값 문자열입니다. 정수로 정확히 환산되는 경우에만 `wonInteger`를 채웁니다.

원본의 부동소수점 표현 2행은 정규 정수값을 비워 두고 검토 상태 및 별도 반올림 후보를 남깁니다. 변경내역의 `-` 27개와 `－` 6개는 미정값으로 유지합니다. 기준가격은 지방세 행정참조 가격이며 차량 판매가·ERP 금액 계산에 사용하지 않습니다.

빌더는 레코드 → 시트 → manifest의 명시된 단위 순으로 처리합니다. `천원`은 ×1000, `원`은 ×1이며 단위를 확인하지 못하면 생성하지 않습니다. 원 단위인 별도 변경목록 PDF와 천원 단위인 전체 통합문서는 각각의 출처 단위를 유지합니다.

## 재생성

Python 표준 라이브러리와 FTS5 trigram을 지원하는 SQLite를 사용합니다. 별도 XLSX 복사는 필요하지 않습니다. 빌더가 ZIP 안의 실제 차량 XLSX를 메모리로 읽어 해시를 확인합니다. 원문 JSONL의 해시를 먼저 검사하며 입력이 달라지면 중단합니다.

저장소 루트에서 현재 참조본을 생성합니다. 기본 입력은 `amended`, 이 환경의 기본 출력은 `/workspace/work/government-tax-2026`입니다. 작업 디렉터리는 `--output-dir`로 지정할 수 있습니다.

```sh
python scripts/build-government-tax-2026.py --output-dir /workspace/work/government-tax-2026
python scripts/verify-government-tax-2026.py --database /workspace/work/government-tax-2026/government-tax-2026.sqlite --expected-vehicle-rows 105383 --output /workspace/work/government-tax-2026/acceptance-tests.json
python scripts/build-government-tax-2026.py --database /workspace/work/government-tax-2026/government-tax-2026.sqlite --search '기아 카니발'
```

기본본도 같은 빌더로 독립적으로 생성할 수 있습니다.

```sh
python scripts/build-government-tax-2026.py --input-dir research/vehicle-taxonomy/bulk/government-tax-2026/base --output-dir /workspace/work/government-tax-2026-base
```

원본 SQLite는 작업 디렉터리에만 두고 압축본을 저장소에 보관합니다. ZIP·typed JSONL과 manifest를 통해 두 버전을 모두 재현할 수 있습니다.

## 출처와 권리 근거

출처는 행정안전부의 제2025-83호·제2026-37호 고시와 각 별표입니다. 공식 고시·별표 연결 및 저작권법 제7조제2호에 관한 확인 근거는 `rights-provenance.json`에 보존했습니다. 전체 ZIP에 대한 공공누리 1유형의 포괄적 허락 표시는 확인하지 않았습니다. 사용자가 제공한 사본의 로컬 해시를 검증했으며 별도 다운로드한 원격 원본과의 해시 대조는 수행하지 않았습니다.

현재 고시 확인은 확인일의 공식 게시판·국가법령정보센터 조사 범위를 따릅니다. 한국 시장의 전체 역사·소매 5단계 분류가 완성되었다는 의미를 부여하지 않습니다.


대용량 검색 DB·차량 CSV는 GitHub 저장 시 [8MiB 이하 조각과 전체 해시](../../artifacts/storage-manifest.json)로 무손실 분할한다. 완전한 파일명은 위와 같으며 저장소 루트에서 `python scripts/restore-vehicle-research-artifacts.py --output-dir /tmp/snote-research-artifacts`로 복원한다. 내려받을 자료집에는 완전한 `.gz`를 넣는다. 원본 ZIP 및 원문 JSONL 자체는 분할하지 않는다.
