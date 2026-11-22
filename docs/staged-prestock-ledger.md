# 선재고 원장의 상사 범위 검토

최신 검토 브랜치의 금융 원장 보호를 `prestock`에도 확장했다. 운영 데이터·Supabase 설정·Cloudflare 설정·NAS 연결은 변경하지 않았으며 병합·배포하지 않았다.

## 데이터와 권한

- 선재고 원본은 `zc_datasets`의 인증된 `company_id`, `dataset='prestock'`, 공용 소유자 행이다. 통장 설정은 기존 `finance_limits`의 `_snote203_meta.prestock`을 유지한다.
- 선재고 본문도 회사·사용자 객체·인증 클라이언트·카탈로그 epoch가 일치하는 메모리 스냅샷으로 읽는다. 다른 탭의 공용 브라우저 키가 바뀌어도 잔액, 차량 연결, 편집, 상환, 신규 추가와 CAS 전송에 사용하지 않는다.
- 확인되지 않은 본문은 빈 장부나 다른 회사 자료로 대체하지 않고 ‘미확인’으로 표시하며 쓰기를 막는다. 통장 설정도 확인 실패의 ‘미확인’과 인증된 빈 설정의 ‘미설정’을 구분한다. 인증된 서버 조회에서 행이 없다고 확인된 경우는 별도의 빈 스냅샷이다.
- 서버 행이 없는 회사에 로그인했다는 이유로 기존 공용 브라우저 원장이나 이전 버전 원장을 삭제하지 않는다. 출처를 증명하지 못하는 구형 캐시를 온라인 회사 장부로 자동 가져오지 않는다.
- 표시 형식으로 인식하지 못하는 기존 행도 본문에 보존한다. 화면 표시 필터와 원장 전체 저장을 분리하여 행 수정·추가·상환 때 알 수 없는 필드를 제거하지 않는다.
- 보존된 `zc_datasets_read` 정책과 `zc_can_write` 정의를 격리된 PostgreSQL에서 확인했다. 같은 상사의 활성 관리자·경리에게 원장 읽기·쓰기가 허용되고, 딜러·비활성·다른 상사·익명에는 허용되지 않는다. 정책 자체는 수정하지 않았다.
- 딜러의 원래 차량 데이터에 저장된 `isPrestock` 여부는 유지한다. 딜러가 읽을 권한이 없는 공용 원장 금액을 브라우저 캐시로 보충하지 않으며, 원장 금액은 미확인으로 구분한다.

## 저장과 복구

- 인라인 저장의 원본·저장 후 대조, 상환·삭제 확인의 계정·원본 가드, 신규 추가, 차량 연결 조정, 구형 차량 상세 저장 핸들러의 백업·취소가 같은 회사 원본을 사용한다.
- `finance`, `finance_limits`, `prestock`의 일반 flush, 응답 유실 후 재대조, idle 복구 기록·ACK·restore가 같은 스냅샷 읽기를 사용한다. 신뢰할 본문이 없는 구형 복구 기록은 임의의 공용 키로 재전송하지 않고 충돌로 남긴다.
- 현재 경리 차량 상세 UI는 대출금과 금융사만 입력한다. 보존된 선재고 상세 렌더 함수는 현재 UI에서 호출하지 않는다. 이 기능을 다시 노출하지 않았고, 해당 호환 핸들러 검증에만 테스트 DOM에 기존 렌더 함수를 장착했다.
- `hydrateWorkspace → prepareLegacyAccount`는 인증된 직원의 로컬 계정 항목을 준비하며, 금융 장부를 가져오는 함수가 아니다. 현재 활성 코드에서 `legacyDatasetPayload`나 금융 legacy import 호출은 없다.

## 검증

전부 가상 데이터이며 운영 DB 접속 없이 실행했다.

| 검증 | 결과 |
| --- | --- |
| 선재고 기본값·온라인 캐시 비채택 단위 테스트 | 7개 통과 |
| 선재고 설정 범위 단위 테스트 | 7개 통과 |
| 금융 3종 스냅샷·복구·ACK 단위 테스트 | 45개 통과 |
| 기존 idle 복구 통합 단위 테스트 | 17개 통과 |
| 보존된 실제 RLS/쓰기 함수의 PostgreSQL 테스트 | 20개 통과 |
| 실제 두 탭 브라우저, 1440/390px | 잔액·수정·상환·추가·타사 캐시 비전송·숨은 행 보존 통과 |
| 구형 상세 핸들러의 실패·취소·후속 CAS, 1440/390px | 자기 회사 원장만 복원·전송함을 확인 |
| 기존 선재고 인라인 브라우저 | 1440/390/320px 및 실패·응답 유실·회사 전환·CAS 충돌 등 9개 블록 통과 |
| 재고 시작일 브라우저 | 1440/390/320px 통과 |
| 재고 이자 브라우저 | 화면 폭·빈 번호판·지연 응답 등 6개 시나리오 통과 |

실행 명령:

```sh
node tests/prestock-public-seed.test.cjs
node tests/prestock-settings-scope.test.cjs
node tests/finance-recovery-scope.test.cjs
node tests/idle-recovery-integration.test.cjs
NODE_PATH=/workspace/work/deps/node_modules node tests/prestock-permissions.sql.cjs
CHROMIUM_PATH=/usr/bin/chromium node tests/prestock-ledger-scope.browser.cjs
CHROMIUM_PATH=/usr/bin/chromium node tests/prestock-inline.browser.cjs
CHROMIUM_PATH=/usr/bin/chromium node tests/inventory-start-date.browser.cjs
CHROMIUM_PATH=/usr/bin/chromium node tests/inventory-interest-live.browser.cjs
```

운영 DB의 현재 정책과 실데이터로는 테스트하지 않았다. 읽기 제한 때문에 bulk 조회에서 누락될 수 있는 행의 실존 확인은 후속 금융 보완과 함께 통합 검증을 마쳤다(`staged-financial-source-completeness.md`, `staged-audit-v2184.md`). 구형 복구 기록만 있고 인증된 본문을 복원할 수 없는 경우 자동 재전송하지 않는 제한을 유지한다. 과거 공개 배포본·Git 이력은 변경하지 않았다.
