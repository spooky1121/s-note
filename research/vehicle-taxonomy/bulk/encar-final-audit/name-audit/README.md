# 엔카 표시 이름 전수 대조 원장

이 결과는 현재 웹 도구에서 읽은 엔카 공개 모델 표시 목록 **1,858행**을 기존 조사 자료와 대조한 **사전 점검본**이다. 입력 조사 자료는 2,903행이다. 이후 추가 수집·표기 교정을 반영한 조사 JSON은 같은 CLI로 새 출력 폴더에 다시 대조한다. 사전 점검본을 최종 조사행 수와 섞지 않는다.

현재 표시 목록의 순서·이름은 이전 2026-11-06 보관본과 모두 같다. 웹 도구 조회 시각은 `2026-11-06T16:55:45.976398+00:00`이며 원격 캐시의 신선도는 노출되지 않았다. URL 확장자가 `.json`이어도 읽힌 내용은 HTML 표시 목록이며, 제조사·부모 모델·등급 코드는 제공되지 않았다. 따라서 전 세계/전 연식 엔카 판매등급 마스터의 완전성을 확인했다는 뜻이 아니다.

## 비교 범위

- 엔카: 표시행 1,858개 / 고유 원문 문자열 1,805개. 순서와 중복 53행을 모두 유지했다.
- 중복 이름은 22개이며, 이 중 `기타`는 33행이다. 제조사 없이 같은 문자열을 하나의 차량으로 합치지 않는다.
- 기존 자료: 원문 1,615행을 제조사·차명군·모델 원문 조합 1,197개로 추적한다. `targetId`는 기존 정부 후보 대조 원장의 ID와 같다.
- 조사 자료: 개별 관측 2,903행을 모두 역방향 대조한다. 국내 2,749행과 해외시장 154행을 구분한다.
- 정부 수정본: 105,383행을 모두 읽는다. `차명` 75,819행과 `기종명` 29,564행만 이름으로 사용한다. `형식`을 차명이나 엔카 부모/등급 코드로 사용하지 않는다.
- 정부 이름 연결 29,766개, 연결된 고유 원문 행 27,333개를 전량 보관한다.

## 사전 점검 집계

| 엔카 표시행 상태 | 행 수 |
| --- | ---: |
| 기존/조사 자료에 문자 그대로 같은 이름 후보 | 393 |
| 공백·괄호·구분자 차이만 비교한 약한 후보 | 134 |
| 같은 차명군 단서만 있음 | 492 |
| 정부에 같은 이름만 있음 | 132 |
| 정부 이름 표기·접두부 단서만 있음 | 87 |
| 선언한 규칙에서 대응 항목을 찾지 못함 | 587 |
| `기타`로 분류 불가 | 33 |
| 합계 | 1,858 |

미대응 587행은 고유 이름 580개다. 이 수치를 **확정된 누락 차량 수**로 해석하면 안 된다. 제조사·부모 코드가 없고, 과세용 자료와 국내/해외 판매 자료의 범위도 다르다. 기존 모델 1,197개 중 80개, 조사 관측 2,903개 중 211개(국내 91·해외 120)는 이 표시 이름 규칙에서 대응 항목을 찾지 못했다. 이름이 달라도 실제 차량이 누락됐다고 단정하지 않는다.

108개 표시행은 연결 후보의 원문 제조사 표기가 복수다. 이것도 서로 다른 실제 제조사가 확정됐다는 뜻이 아니다. 상표·상호 별칭을 합치지 않고 원문을 보존한 결과이며, 모든 표시행의 엔카 제조사·부모 관계는 미확인이다.

## 대조 규칙

1. 원문 문자열 완전 일치를 먼저 비교한다.
2. Unicode NFKC·대소문자·연속 공백 정리는 별도 이름 후보로 기록한다. 괄호 안 세대 코드·연식·엔진 표기는 버리지 않는다.
3. 조사 원문의 `modelAliasCandidates`에 명시된 별칭만 별칭 후보로 사용한다.
4. 공백과 `()[]{}._-·ㆍ/` 구분자를 접은 비교는 표기 단서다. 이름이나 세대의 확정 일치로 취급하지 않는다.
5. 차명군의 단어 경계 포함, 정부 긴 차명 접두부 포함은 약한 단서다. 숫자만 있거나 접은 이름 길이가 3 미만이면 정부 접두부 단서에 사용하지 않는다.
6. 정부의 같은 이름/형식은 판매 세대·엔진·연식·등급 관계의 증거로 승격하지 않는다. 자료 기준연도 2026은 모델연식이 아니다.

이 대조로 확정·수정한 판매등급은 **0개**다. 모든 모델·관측은 `retailGradeCoverageVerified: false`, `completionStatus: not_attested` 또는 동등한 미확정 플래그를 유지한다. `confirmed-corrections.json`의 확정 수정 목록은 비어 있다. 이것은 기존 자료에 오류가 없다고 증명한 것이 아니다.

## 파일

- `build-encar-name-audit.py`: 네 입력 파일과 출력 폴더를 명시하는 재실행 CLI. 네 입력의 예상 SHA를 선택적으로 강제할 수 있다.
- `verify-encar-name-audit.py`: 생성기를 import하지 않는 별도 전수 검증기. 표시행·기준 모델·조사행·정부 연결과 CSV를 원문까지 대조한다.
- `preaudit-2903/encar-display-name-ledger.jsonl.gz`: 1,858 표시행과 각 행의 전체 기존/조사 후보. 제조사 미상·중복·기타·약한 연결을 구분한다.
- `preaudit-2903/baseline-model-ledger.*`: 기존 모델 1,197개에 대한 역방향 원장.
- `preaudit-2903/research-record-ledger.*`: 조사 관측 2,903개에 대한 역방향 원장.
- `preaudit-2903/government-name-links.jsonl.gz`: 정부 이름 연결 전체. 각 연결은 원문 파일 SHA·시트·행·명시 이름 필드·자료형·제작사·원문 연번과 이어진다.
- `preaudit-2903/encar-unmapped-display-rows.csv.gz`: 선언 규칙상 미대응 검토 큐.
- `preaudit-2903/encar-ambiguous-display-rows.csv.gz`: 중복 이름·기타·복수 제조사 표기 검토 큐.
- `preaudit-2903/input-snapshots/`: 현재 엔카 JSON과 **대조 당시** 기준/조사 JSON의 원본 바이트를 gzip으로 보존한다. 최종 조사 자료가 늘어나도 이 사전 점검본을 재현할 수 있다.
- `preaudit-2903/summary.json`, `manifest.json`: 집계·한계·입출력 SHA 및 바이트 수.
- `verification/exhaustive-source-audit.json`: 별도 검증 결과. 독립 agent가 실행한 검토라는 주장과 구분한다.

정부 연결 CSV는 중복 용량을 줄이기 위해 생략했다. JSONL 전체 연결은 보존하며 CLI에서 `--omit-government-csv`를 빼면 같은 내용의 CSV도 생성한다. 작은 목록 CSV는 모두 보존했다.

## 재실행

저장소 루트에서 현재 엔카 표시 JSON 경로와 출력 폴더를 지정한다. `--repository-root .`를 주면 공개 메타데이터는 저장소 상대경로만 기록한다. 저장소 밖 입력은 basename과 SHA만 기록한다.

```sh
python /path/to/build-encar-name-audit.py \
  --repository-root . \
  --encar-source /path/to/current-index.json \
  --baseline research/vehicle-taxonomy/baseline/catalog.json \
  --research research/vehicle-taxonomy/exports/official-research.json \
  --government-records research/vehicle-taxonomy/bulk/government-tax-2026/amended/vehicle-records.raw.jsonl.gz \
  --output-dir /tmp/snote-encar-name-audit \
  --expected-encar-rows 1858 \
  --expected-government-rows 105383 \
  --expect-encar-sha256 3dd05119ab0b1288c2eff48dc3c6bc7da2ac177b7b867ecba714c756339e455e \
  --omit-government-csv
```

새 표시 목록이 달라지면 새 파일과 새 건수·SHA를 지정한다. 같은 이름을 같은 제조사·같은 세대라고 단정하거나 미대응 큐를 자동 삭제하지 않는다. 이 도구는 출처 파일과 운영 DB를 수정하지 않는다.
