# 엔카 국산 역사 분류 대조

2026-11-07 한국시간 기준 공개 `history.do`와 그 페이지가 직접 연결한 `type=CLS` 표의 분류명·관계 사실을 확인했다. 설명문·사진·개별 매물·가격표를 재배포하는 자료가 아니다. 현재 엔카 검색 전체의 등급 코드 또는 전 연식 완전성을 확인한 자료도 아니다.

기존 자료의 국산 역사표 13모델·206개 고유 CLS 관측을 대조했다. 원문 물리행은 207개이며 로체의 동일 라벨 반복 1행을 별도로 기록했다. 기존 206개 관측을 바꿀 확정 오류나 빠진 고유 경로는 발견하지 못했다. 엔진 비교표는 이전·다음 세대 열을 함께 담으므로 CLS 이름 검증과 연식별 ENG 결합 검증은 구분한다.

추가로 르노삼성 12모델, 현대 제네시스 계열 4모델, 제네시스 EQ900, 기아 K5 계열 5모델의 실제 CLS 표를 읽었다. 총 223개 물리행은 정상 명칭 관측 222개와 SM5의 상충 행 1개로 모두 보존했다. SM5 고정행 `2.5 / 525V`와 시점셀 `LE 블랙`을 부모·자식 등급으로 결합하지 않았다. 뉴 SM5 플래티넘의 ART·파노라마·S/S 등 시점별 이름도 현재 검색의 고정 하위 코드로 만들지 않았다.

`encar-final-domestic-expansion-20261107.json`은 저장소 sources와 같은 `sources/records/quarantinedRecords` 형식이다. 전체 222행은 `sourceHierarchyRaw`, 원문 행, 원문 시점 header, 원문 제조사·모델·부모 페이지 코드를 유지한다. 제조사 르노코리아(삼성)은 검토용 표시 묶음이며 원문 르노삼성과 현재 검색 코드의 자동 병합을 승인하는 의미가 아니다. 제네시스 BH·DH·쿠페는 원문 제조사 현대를 유지한다.

모델연식·엔진·미표기 연료·검색 등급 코드는 추정하지 않았다. 추가 행의 `modelYear`, `engine`, `gradeCode`, `subgradeCode`는 모두 null이다. 연료는 CLS 동력 표기에 가솔린/디젤 등이 실제 적힌 경우만 옮겼다. 역사표의 `현재`는 2026 현재 판매 상태를 뜻하지 않는다.

`additional-22-model-classification-observations.json`은 확인한 원문 분류 행과 부모 정체성의 사실 기록이다. `additional-22-verification.json`은 물리행과 새 관측 간 빠짐·중복 점검 결과다. `independent-audit/`에는 별도 검토자가 222개 행과 격리 1개, 원문·부모 코드·연료·미확인값을 전수 대조한 결과가 있다. `source-warnings.json`에는 기존 NF 쏘나타 헤더/SM5 본문 불일치의 재확인과 기간·시점열·중복 표기 주의점을 적었다.

재현:

```sh
python build-additional-domestic-observations.py
python audit-existing-domestic-observations.py --source /path/to/s-note/research/vehicle-taxonomy/sources/encar-public-catalog-expansion-20261106.json
python independent-audit/audit_new_domestic.py
```

최종 파일별 바이트·SHA-256은 `handoff-manifest.json`에 있다. 저장소와 운영 데이터베이스는 이 검토에서 수정하지 않았다.
