# 정부 차명 후보 교차 원장

2026-37 수정본 정부 차량 기준가액 원문 **105,383행**을 기존 분류의 **1,197개 `(make, group, model)`** 및 등급 공백 **986개**와 대조한 연구 자료입니다. 소비자 판매 등급, 엔진, 연식이나 세대 계층을 완성한 자료가 아닙니다. 모든 타겟과 후보는 `complete: false`, `gradeVerified: false`, `generationVerified: false`, `modelYear: null`을 유지합니다. 애플리케이션·DB 자동 반영은 없습니다.

현재 원장은 `amended-2026-reviewed/`입니다. 후보 링크 **300,616개**, 연결된 고유 원문 행 **43,396개**를 보관합니다. 전체 타겟은 이름 후보 248개·가족/시리즈 단서 880개·후보 없음 69개이며, 등급 공백 986개는 각각 211개·721개·54개입니다. 가족 단서는 서로 다른 연식·엔진·연료·세대 타겟에 반복 연결될 수 있으므로 해당 구성의 호환 증거로 사용하면 안 됩니다. 검증된 판매 등급 추가와 완료 타겟은 모두 0개입니다.

## 보관 파일

- `amended-2026-reviewed/candidate-links.jsonl.gz`: 모든 후보 링크의 원문 필드, 셀 자료형, `sourceSheet`/`sourceRow`, 입력·ZIP SHA256. 중복 용량을 줄이기 위해 큰 후보 CSV는 만들지 않았습니다.
- `amended-2026-reviewed/target-ledger.json`, `target-ledger.csv.gz`: 전체 1,197타겟과 후보 수·방식·불확실성. JSON 예시는 타겟당 최대 5개이며 전체 참조는 JSONL에 있습니다.
- `amended-2026-reviewed/missing-grade-targets.csv.gz`, `missing-grade-no-candidate.csv.gz`: 공백 986개 전체와 정부 후보가 없는 54개.
- `amended-2026-reviewed/summary.json`, `manifest.json`: 집계, 입력·코드·출력 해시, 원본 기준연도·단위 정책.
- `research-comparison-amended-2026/`: 기존 조사와 정부 후보를 별도 열로 보존한 986행 비교. 기존 `not_yet_found` 437개 중 391개에 검색 단서가 있으며(이름 82·가족 단서 309), 양쪽 검색에서 후보가 없는 타겟은 46개입니다. 기존 조사 상태는 변경하지 않습니다.
- `input-snapshots/gap-research-progress.7f43b6967052.json`: 비교에 사용한 불변 조사 스냅샷. 이후 갱신된 `exports/gap-research-progress.json`을 대신 사용하지 않습니다.
- `candidate-aliases.json`: 검토용 유한 별칭·법인명 후보 규칙. 제조사 동일성이나 판매 계층을 확정하는 근거가 아닙니다.
- `build-government-crosswalk.py`, `compare-research-progress.py`: Python 표준 라이브러리만 사용하는 재현 코드. 입력과 코드의 메타데이터 경로는 실행 위치 기준 상대경로로 기록합니다.
- `input-snapshots/build-government-crosswalk.base-2026.10fb341f.py`, `build-government-crosswalk.amended-work.86251c35.py`: 앞선 원본·수정본 작업 당시 코드를 해당 SHA256 그대로 보존합니다. 원본·수정본 ZIP/원문은 상위 `base/`, `amended/`에 보관하며 앞선 대용량 후보는 중복 보관하지 않습니다.
- `amended-audit-notes.json`, `verification-amended.json`, `handoff-manifest.json`: 공개 산출물의 전수 감사, 단어 경계·해시 거부·빈 연번 검증, 최종 파일 해시.

## 일치 방식과 제한

검색에는 **원문 `차명` 또는 `기종명`**만 사용합니다. `형식` 코드, 기준가격, 기준연도로 판매 세대나 등급을 추정하지 않습니다. NFKC·대소문자·공백·문장부호를 정규화하되 원래 단어 경계를 함께 보존합니다. 예를 들어 `A7 3.0`은 `A7` 후보가 되며 `A70`은 되지 않습니다. 원문은 바꾸지 않습니다.

방법은 모델명 일치·포함, 명시 이름 별칭, 차명군 문구, 번역/가족 별칭, 설정된 BMW/벤츠 시리즈 번호 단서 순서입니다. `EF쏘나타`처럼 이름이 겹치는 경우에도 세대는 미검증입니다. 같은 가족 단서가 여러 타겟에 연결된 사실을 완료 모델 수로 계산하지 않습니다.

제작사 후보는 유한 목록의 전체 라벨과만 대조합니다. `현대FRP`를 `현대`로 합치지 않습니다. 일부 특장/미분류 제작사 이름에 기본 차량군 문구가 있으면 `unmapped_producer_name_only_candidate`로만 보존합니다. 소비자 브랜드·법인 승계·생산자 관계는 별도 검증이 필요합니다. 아우디와 폭스바겐 등의 제작사를 임의로 합치지 않습니다.

각 링크의 `observationMetadataRaw`와 `fieldsRaw`, `fieldCellTypesRaw`를 합치면 공급받은 원문 레코드 전체를 복원할 수 있습니다. 수정본의 연번이 비어 있는 TESLA 행도 `null`·`serialMissing: true`·원래 셀 자료형·단위 문구를 유지합니다. 같은 이름·형식에 서로 다른 기준가액이 있어도 `sourceSheet`/`sourceRow` 별로 보존합니다.

정부 `sourceYear: 2026`은 차량 모델연식이 아닙니다. `국산`/`외산`은 시트 문맥이며 한국 판매시장 확정값이 아닙니다. 기준가격은 원문 **천원** 단위의 세금 참고 값이고 판매가격이 아닙니다. 원문 금액·단위는 변환하지 않습니다. 후보 없음은 현재 규칙에서 못 찾았다는 뜻이며 원천에 없음을 입증하지 않습니다.

## 재현

저장소 최상위에서 실행합니다. 기존 결과를 보존하려면 `--output-dir`을 새 디렉터리로 바꿉니다. 원문 SHA가 다르면 스크립트가 중단됩니다.

```sh
python research/vehicle-taxonomy/bulk/government-tax-2026/crosswalk/build-government-crosswalk.py \
  --records research/vehicle-taxonomy/bulk/government-tax-2026/amended/vehicle-records.raw.jsonl.gz \
  --baseline research/vehicle-taxonomy/baseline/catalog.json \
  --missing research/vehicle-taxonomy/baseline/missing-trims.csv \
  --output-dir research/vehicle-taxonomy/bulk/government-tax-2026/crosswalk/amended-2026-reviewed \
  --expected-records-sha256 b725edb280b148042a461244eade9dd2d42fd2e4ebe773dbbdf238d10426cea6 \
  --expected-baseline-sha256 c3b3d3fc75701cf2354bd05bce7b8393e9efe1eb286670e97091454342b9e4c4 \
  --source-archive-sha256 250495924795cddd5a825f5a788d5bcd13d76de4246ae5b2e5c3f2f93e9d99d7 \
  --source-label amended-2026-37-user-upload \
  --omit-candidate-csv

python research/vehicle-taxonomy/bulk/government-tax-2026/crosswalk/compare-research-progress.py \
  --ledger research/vehicle-taxonomy/bulk/government-tax-2026/crosswalk/amended-2026-reviewed/target-ledger.json \
  --research-progress research/vehicle-taxonomy/bulk/government-tax-2026/crosswalk/input-snapshots/gap-research-progress.7f43b6967052.json \
  --expected-progress-sha256 7f43b6967052f5d0cd4172e5310e97f07de665fb8e6b0e15cb1f2ee8c4051329 \
  --output-dir research/vehicle-taxonomy/bulk/government-tax-2026/crosswalk/research-comparison-amended-2026
```

후속 정부 수정본은 새 원문·기대 SHA256·실제 ZIP SHA256·별도 출처 라벨과 출력 디렉터리를 지정하면 같은 방식으로 대조할 수 있습니다. 기본 검증 타겟 수는 1,197/986이며 기준 분류를 의도적으로 바꾼 경우에만 `--expected-target-count`, `--expected-missing-count`를 함께 조정합니다.

재현 대상은 후보 레코드 집합과 집계입니다. 제작사 후보 순회 순서와 gzip 생성 시각에 따라 출력 행 순서·압축 바이트 해시는 실행마다 달라질 수 있습니다. 각 실행의 실제 바이트 해시는 해당 manifest에 고정하며, `verification-amended.json`에는 `(targetId, sourceSheet, sourceRow)`로 정렬한 레코드별 해시 집합의 SHA256도 기록합니다.
