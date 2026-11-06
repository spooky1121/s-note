# 저장된 검토 산출물

2026-11-07 한국시간 기준 조사 자료집이다. 원문별 수집 시각·시장 범위·근거 수준은 각 행과 출처 메타데이터에 있다. 전 연식·단종 트림을 망라한 완전 마스터는 아니다.

- `s-note-vehicle-taxonomy-research-2026-11-07.xlsx`: 13시트. 조사 2,903행, 기존 1,615행, 986개 대조표, 공개 모델 원문 1,858행, 글로벌 엔진 원문 30,535행 등을 구분한다.
- `s-note-classification-research.sqlite.gz`: 조사 DB의 무손실 압축본. 원문 관측·전체 출처 문맥·격리 정보·기존 자료·모델목록이 있다. `record_search`는 FTS5 검색 테이블이다.
- `global-engine-reference-ODbL.sqlite.gz`: 해외 원본 30,535개 엔진의 독립 데이터베이스. 한국 판매등급 확인 자료가 아니다. ODbL-1.0 및 출처표시·동일조건 공유 조건을 유지한다.
- `government-tax-2026-amended.sqlite.gz`: 정부 제2026-37호 현행 반영본의 별도 검색 DB. 차량 관측 105,383행·개조 431행과 43개 시트·원문 행·자료형·가격 단위·파일 해시를 연결한다. 원문 연번이 빈 TESLA 관측도 포함하며, 동일 제작사·형식의 서로 다른 차명을 합치지 않는다. [기본본·현행 원본](../bulk/government-tax-2026/)은 별도로 보존한다.
- `artifact-manifest.json`: 압축/원본 해시·바이트 수·라이선스 범위.

정부 DB와 차량 CSV는 GitHub 연결 도구의 16MiB 요청 제한 때문에 8MiB 이하의 무손실 바이트 조각으로 저장한다. [분할·전체 해시](storage-manifest.json)로 각 조각, 복원 파일, gzip 해제 내용까지 검증한다. 내려받을 자료집 ZIP에는 조각 대신 완전한 `.gz` 파일을 담는다.

저장소에서 전체 파일을 복원하려면 루트에서 실행한다. 수정본 개조 CSV는 작은 완전 파일로 별도 보관한다.

```sh
python scripts/restore-vehicle-research-artifacts.py --output-dir /tmp/snote-research-artifacts
```

압축본은 표준 gzip으로 풀 수 있다. DB는 SQLite 3/FTS5를 지원하는 도구에서 열며 운영 앱에 자동 연결하지 않는다.

```sql
SELECT id, make, model, grade, engine
FROM record_search
WHERE record_search MATCH '캐스퍼';

SELECT make, model, generation, engine_label
FROM engine_search
WHERE engine_search MATCH 'make:BMW';

-- government-tax-2026-amended.sqlite에서 실행한다.
SELECT v.manufacturer_raw, v.vehicle_name_raw, v.type_raw,
       v.sourcePriceRaw, v.sourcePriceUnitRaw, v.wonExact,
       s.sheet_name, v.source_row
FROM vehicle_fts
JOIN vehicle_records AS v ON v.record_no = vehicle_fts.rowid
JOIN sheets AS s ON s.sheet_id = v.sheet_id
WHERE vehicle_fts MATCH '캐스퍼';
```

행마다 `market`, `source_market`, `evidence_status`, `mapping_status`를 대조한다. `payload_json`은 전체 원문 필드와 근거를 보존한다. `source_contexts`에는 모델별 관계·검토·격리 원인 등이 있고 `provider_model_index`에는 공개 화면의 표시 순서와 중복 이름도 그대로 들어 있다.

정부 DB는 조사 DB·글로벌 ODbL DB와 구분한다. 정부 원가격은 명시된 **천원** 값을 보존하고 `Decimal`로 원 단위를 계산한다. 지방세 기준가격을 소매 판매가격으로 쓰지 않으며, 원문 소수 표현 오류의 확정 정수 원 값과 개조의 미정 가격은 null로 남긴다. 2026년은 자료 기준연도이며 개별 차량 모델연식·판매등급 확정값이 아니다. [정부 후보 대조 원장](../bulk/government-tax-2026/crosswalk/amended-2026-reviewed/)의 연결도 검토 후보로 유지한다.

정부 원본은 사용자가 제공한 사본이며 공식 고시·별표 출처와 로컬 해시를 기록했다. 원격 공식 파일과의 해시 대조나 전체 ZIP의 공공누리 1유형 적용을 주장하지 않는다. 자료집은 GitHub 보관용이며 운영 앱 v2.80과 별도이고 Cloudflare 앱 배포를 수행하지 않는다.
