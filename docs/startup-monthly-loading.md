# 월정산 최초 사용 로딩 점검

기준은 최신 main `8835e793dc666ca6f725048fd8e8ffde6150537d`이다. 이 문서는 제품 코드를 고치기 전에 현재 흐름과 검증 범위를 먼저 기록한다. 별도 worktree/브랜치에서만 작업하며 운영 데이터·DB·설정·배포는 변경하지 않는다.

## 현재 흐름

1. `index.html`의 `#monthly-ledger-frame`은 숨겨진 `#monthly-screen` 안에 있지만 `src="monthly.html?v=2.135"`가 이미 있다. 따라서 로그인/첫 업무 화면에서도 child HTML과 월정산 JS/model/CSS·공통 팝업/글꼴/아이콘 자산을 내려받고 실행한다.
2. child는 준비되면 `SNOTE_MONTHLY_WORKBOOK_READY`를 보내고, parent의 iframe load/READY handler가 `snote216InitMonthly()`를 호출한다. parent는 초기 hydrate/restore/reload/navigation에서도 같은 함수를 호출한다.
3. 초기화 함수는 frame-ready와 admin/accountant 권한을 확인하지만 현재 route가 월정산인지 제한하지 않는다. 이미 숨은 iframe이 준비되었으므로 권한 있는 계정의 로그인 뒤 월정산 cloud module 및 장부 읽기까지 시작될 수 있다.
4. 저장은 원래 scoped context nonce, same-origin/source-window 검사, clientSeq/requestId/month/baseVersion, `createMonthlyStore`의 직렬 저장·revision CAS·재읽기 및 actor/company 검증을 따른다. child는 미저장 입력을 scoped draft로 보관하고 새 ACK가 현재 입력을 덮어쓰지 않도록 보호한다.
5. 인쇄는 실제 child의 현재 book을 snapshot으로 만들고 원래 A4 가로 양식으로 출력한다. 공통 메시지/뒤로가기/닫기·크기 조절 모듈과 parent 높이 메시지를 사용한다.
6. logout/회사 변경/재연결은 `snote216ResetMonthly()`로 context를 폐기하고 child에 RESET을 보낸다. 현재 child 자체는 계속 로드되어 있어 준비 신호를 반복한다.

## 변경 목표와 제한

- 초기에는 iframe URL을 설정하지 않는다. 실제 권한이 확인된 첫 월정산 메뉴 진입에서만 한번 로드한다.
- 중복 첫 진입은 같은 pending을 공유하고, 네트워크/초기화 실패는 원래 내용·권한을 보존하며 다시 열기/재시도로 복구한다.
- source-window와 계정/회사/session 경계가 바뀌면 이전 child의 메시지와 늦은 응답을 새 workbook에 적용하지 않는다. 로그아웃 후에는 이전 입력이 보이지 않아야 한다.
- 같은 계정의 메뉴 왕복에서는 기존 저장 큐·미저장 입력·인쇄·새 행/수정 중 ACK 경합 보호를 유지한다.
- `monthly.html`의 공통 popup/readable/icon 파일은 parent와 query 버전이 일부 다르다. 파일명만 보고 삭제하거나 무조건 query를 통일하지 않는다. 이 작업은 우선 iframe 전체를 최초 사용으로 미루며 실제 계약·모바일·저장/인쇄 검증을 거친 뒤 필요할 때만 버전을 정리한다.
- parent index 수정은 iframe markup과 월정산 진입/reset/message 흐름에 한정한다. 로그인/대시보드/금융·카탈로그 동작은 다른 담당자가 관리한다.

## 검증 계획

가상 인증·가상 계정/회사·가상 장부/HTTP만 사용한다. 초기 요청에 monthly HTML/자산/장부 읽기가 없는지 딜러·경리·관리자 및 PC/모바일에서 확인한다. 권한 있는 첫 진입, 중복 진입, 실패/다시 열기, 메뉴 왕복/뒤로가기, logout/relogin 및 actor/company 교체, 위조 source/key 메시지 거부, 기존 save/print와 새 행/ACK 경합을 확인한다. 실제 운영 로그인 속도나 실데이터 수치를 추정하지 않는다.

기존 관련 검증은 `monthly-workbook-model.test.mjs`, `monthly-workbook-cloud.test.mjs`, `monthly-workbook-print.test.mjs`, `monthly-workbook-ui.browser.cjs`, `monthly-workbook.browser.cjs`이다. 원래 전체 HTML과 관련 자산을 사용하고 테스트 실패 시 fixture 부재와 제품 문제를 구분한다.

## 적용한 흐름

- `#monthly-ledger-frame`은 `data-src`만 갖고 시작한다. 활성 상사·회원 역할·현재 actor 및 Auth user 객체가 확인되고 route가 `monthly`인 경우에만 실제 URL을 설정한다. 딜러의 직접 진입 시도도 iframe을 로드하지 않는다.
- 첫 HTML과 workbook READY handshake는 하나의 pending을 공유한다. route가 바뀌면 늦은 최초 초기화 결과를 버리고, 같은 계정이 다시 월정산에 들어오면 준비된 frame을 재사용한다. 기존에 열린 장부는 메뉴 왕복 중에도 저장 큐와 ACK를 유지한다.
- 실패 시 오류 안내와 ‘다시 불러오기’를 제공한다. iframe의 HTTP 오류와 READY 미완료, cloud module 및 그 model 의존 모듈의 503, 데이터 읽기 오류를 각각 복구 시험했다. ESM 실패 캐시 때문에 같은 URL의 재시도가 영구 실패하지 않도록 명시적 재시도 번호만 import URL에 전달한다. 오류 후 child READY가 반복돼도 자동 서버 읽기를 반복하지 않는다.
- logout·회사/actor 변경·명시적 reset은 scoped context를 폐기하고 iframe browsing context를 교체한다. 이전 창의 메시지·늦은 읽기/ACK와 그 창이 연 메시지 팝업을 새 계정에 적용하지 않는다. 기존 same-origin, source-window, context nonce, clientSeq/requestId/month/baseVersion, revision CAS 및 scoped draft 보호를 유지한다.
- `monthly.html`의 popup-controls/readable-type/icon-sizing 3개 JS query만 main과 맞췄다. 해당 자산 본문 SHA는 변경하지 않았다. 기존 주소 상태의 UI 10그룹을 먼저 통과한 뒤 query를 정렬하고 같은 UI 10그룹, 실제 Auth 및 PGlite 저장·인쇄를 다시 검증했다. 나머지 공통 자산은 제거하거나 버전을 일괄 변경하지 않았다.

## 검증 결과

| 검증 | 결과 |
| --- | --- |
| model/cloud/print 단위 suite | 3/3 통과 |
| 원래 공통 query의 실제 월정산 UI | 10개 그룹 통과 |
| 공통 query 정렬 후 실제 월정산 UI | 10개 그룹 통과 |
| 실제 Auth·parent HTML 첫 사용 | 15개 시나리오 통과 |
| 최초 HTML resource 기록을 포함한 cold trace | PC/모바일 × 세 역할 6개 조합 통과 |
| 실제 parent/child + 격리 PostgreSQL CAS | 6개 그룹 통과, 실제 write 13회/CAS conflict 1회/외부 요청 0/pageerror 0 |
| 실제 생성 snapshot의 인쇄 | A4 가로 1페이지, 한글·금액 text 추출 및 화면 확인 통과 |

실제 Auth 시험은 1440/390px × 딜러/경리/관리자, 최초 사용 공유·저장·인쇄·재진입, 모바일 native dialog Back, pending route 변경, HTML/cloud/model 503, read 실패의 명시적 재시도, 늦은 actor/route 결과, pending module 중 logout 및 저장 후 logout/relogin을 포함한다. UI 시험은 새 행 ACK 경합, 새 양식의 행 수·분류 유지 및 이름·금액·메모 초기화, 실제 부모 확인 팝업의 취소·source/target 편집·계정 변경 보호도 확인한다. 기존 PGlite 시험은 lost ACK, 실패 저장 재시도, conflict LOAD 중 새 입력, 다른 월 병합/같은 월 충돌, scoped draft, 회사 변경 중 늦은 ACK, 위조 source 및 standalone 거부를 유지한다.

이전 시험 fixture의 누락은 제품 오류와 구분해 보완했다. PGlite SELECT에 현재 금융 검증에 필요한 `company_id`를 반환하고, pinned 인증이 요구하는 가상 `getUser`를 제공했다. 최신 SnoteMessages 안내/정해진 복구 확인을 실제 버튼으로 처리한다. Auth 재로그인도 기존 ‘로그아웃되었습니다’ 팝업의 확인을 먼저 누른다. 어떤 인증·권한 검증도 우회하거나 원래 자산을 빼지 않았고 시간 제한도 늘리지 않았다.

재현 명령은 다음과 같다. Playwright와 PGlite가 설치된 별도 의존 경로를 `NODE_PATH`에 사용한다.

```bash
node --test tests/monthly-workbook-{model,cloud,print}.test.mjs
CHROMIUM_PATH=/usr/bin/chromium node tests/monthly-workbook-ui.browser.cjs
CHROMIUM_PATH=/usr/bin/chromium node tests/monthly-first-use.browser.cjs
CHROMIUM_PATH=/usr/bin/chromium node tests/monthly-workbook.browser.cjs
```

검증은 가상 Auth/장부와 차단된 네트워크에서만 수행했다. 운영 로그인 시간·실기기·실제 서버 상태는 측정하지 않았다. 초기 회사 전체 dataset bulk에 monthly가 포함되는 기존 저장/복구 구조는 유지했다. 이번 변경의 초기 미로딩은 monthly HTML/자산/cloud import/월정산 전용 query에 대한 것이며, bulk payload의 monthly까지 제거했다는 의미가 아니다. 운영 DB·설정·데이터·배포와 main 병합은 변경하지 않았다.
