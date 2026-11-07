# 차량정보 선택 DB 교체 자료

2026-11-07 사용자가 최근 조사한 차종 DB로 기존 선택 목록 전체를 교체하도록 요청한 결과다. 운영 UI·Supabase 적용은 별도 변경으로 연결하며, 이 디렉터리의 공개 백업에는 기존 상사·직원·등록 차량·고객 자료가 없다.

## 새 선택 원천

[`assets/vehicle-catalog.json`](../../../assets/vehicle-catalog.json)은 [최종 조사 JSON](../exports/official-research.json)의 정상 관측 **3,128행 전체**를 포함한다. 한국시장 문맥 2,974행과 해외시장 문맥 154행, 검토 후보를 포함한 원래 근거 수준을 그대로 보존한다. 문서·검색 표시명만 있는 후보나 격리 관측, 정부 과세 기준가격 105,383행, 별도 글로벌 엔진 참고 자료 30,535행은 이 3,128개 조사 관측과 서로 다른 자료집이다.

- `id`와 `researchId`는 같은 관측 ID다. 제조사·모델군·모델·등급·세부등급 5필드가 같아도 연식·엔진·시장·발표 시점·옵션이 다르면 원래 관측을 병합하지 않는다.
- 모든 정규화 필드와 `qualifiers`, `sourceCorrections`, 출처·기준 시점·기록 종류를 유지한다. `verification`은 원래 `evidenceStatus`의 호환 별칭이며, 조사 기록을 기존 `official` 상태로 승격하지 않는다.
- `model_year`는 명시된 `modelYear`의 호환 별칭이다. 미상값과 `2025.5` 같은 원문 표기는 그대로 남는다. 역사 문서의 발행일·출시기간·`현재`를 차량 연식으로 변환하지 않는다.
- `savedSourceConditions`는 원래 저장한 조사 기록의 추가 조건이다. 같은 이름·같은 값의 정규화 필드와 중복되는 값만 덜어내며, 미상 `null`과 빈 문자열의 차이도 보존한다. 여기의 이전 수집 단계 `autoImport:false` 등은 원천 메타데이터다. 이번 사용자의 전체 교체 승인은 최상위 `selectionPolicy`에 별도로 기록한다.
- 원래 `sourceRecord` 본문은 전역 `rawEvidencePreservation.archivePath`·`archiveSha256`와 각 행의 JSON 포인터·원문 SHA로 연결한다. 각 `evidence`의 원문도 독립 포인터·SHA로 보존한다. 정규화가 교정된 17행도 원래 입력을 지우지 않는다.

전체 관측을 선택용 자료로 배포한다는 것은 공급자의 모든 분류 코드·전 연식 판매등급이 확정됐다는 뜻이 아니다. `completeOfficialMaster:false`, 근거 수준, 시장·조건 구분을 유지하며 임의의 부모 코드나 없는 등급을 만들지 않는다.

## 무결성 계약

`catalogVersion`은 `research-20261107-v1`이다. 서버 RPC의 `manifest_sha256`는 `assets/vehicle-catalog.json` 파일 전체의 실제 UTF-8 바이트 SHA-256이다. 클라이언트는 정적 파일의 응답 원문을 같은 방식으로 해시해 서버 데이터셋과 비교한다. runtime JSON 안에는 자기 파일의 SHA를 넣지 않는다.

[manifest.json](manifest.json)의 `manifestSha256`와 `runtimeCatalog.sha256`가 이 runtime 파일 SHA다. 이 외부 감사 파일의 `datasetManifest`는 데이터 버전·원본 조사 SHA·행 수·순서 있는 관측 ID 및 전체 runtime payload의 canonical SHA를 추가 기록한다. Python canonical JSON은 재귀 키 정렬, UTF-8, ASCII 이스케이프 없음, 쉼표/콜론 구분을 사용한다. Postgres의 `jsonb::text` 직렬화 결과와 같은 문자열이라고 가정하지 않는다.

## 기존 선택 목록 백업

[legacy-bundled-backup.json](legacy-bundled-backup.json)은 교체 전 커밋 `42768526991496f7ef049d5ba73bbb28b902ed1e`의 불변 `index.html` Git 객체에서 추출했다. 현재 작업 중인 HTML은 읽지 않는다.

| 보존 항목 | 행 수 |
|---|---:|
| `STARTER_TAXONOMY` 원문 배열 | 232 |
| `BUNDLED_CATALOG_V118` 원문 배열 | 1,493 |
| `HEYDEALER_PUBLIC_REFERENCES` 원문 배열 | 33 |
| `ZEROCAR_ADDED_MODELS_V194` 원문 배열 | 90 |
| 기존 실제 공개 선택 결합 결과 | 1,615 |
| 기존 국내 선택 필터 결과 | 1,383 |

세 배열 결합의 기존 우선순위와 5필드 identity를 그대로 적용한 1,615개 객체는 기존 `baseline/catalog.json`과 전부 같은 값이다. STARTER는 별도 원본으로 보존하고 실제 결합 목록에 중복해서 더하지 않는다. 백업은 새 선택 목록에 다시 합치지 않는다. 기존 상사 공용 추가분은 배포 마이그레이션의 비공개 DB 백업 대상으로, 이 공개 JSON에 포함하지 않는다.

## 재생성·검증

저장소 루트에서 실행한다.

```sh
python scripts/build-runtime-vehicle-catalog.py
python scripts/build-runtime-vehicle-catalog.py --check
```

생성기는 기존 백업의 고정 커밋을 다시 확인한다. 따라서 runtime HTML에서 과거 대형 배열을 제거한 뒤에도 백업·새 자료를 재현할 수 있다. `--check`는 출력 파일을 다시 쓰지 않고, 3,128개 ID·전체 정규화 필드·원문 조건 복원·근거 포인터·입출력 SHA·시장별 건수를 전수 검증한다.
