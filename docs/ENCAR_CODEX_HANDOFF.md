# S-NOTE 웹: 차량번호로 엔카 광고 열기 — Codex 인계

## 2026-11-03 v2.28 — 실제 미확인 증상과 검색 누락 보완

**운영 주소는 사용자가 확인한 `https://s-note.pages.dev`다.** 사용자가 `snote`라고 부른 대상의 실제 URL을 재확인해 `Cloudflare Pages: s-note` 체크와 연결했다. `zerocar-office`는 이번 운영 대상이 아니다. 사용자가 `0bf4637` 배포와 Tavily 키 등록·재배포도 확인했다.

사용자 화면의 `일치하는 현재 광고를 확인하지 못했습니다`는 HTTP 오류가 아닌 `200 / unverified` 응답이다. 기존 코드에서는 검색 결과 없음, 후보 추출 누락, 번호 불일치, 광고 비게시, 404/410을 모두 같은 안내로 표시했다. 공유 대화와 실제 공개 페이지는 프록시 CONNECT 403으로 읽지 못했고, 사용자가 성공 사례의 검색 방법·원본/믿고 링크를 텍스트로 제공했다. 이 과거 사례만으로 현재 광고 상태나 Tavily 검색 결과가 동일하다고 단정하지 않는다.

이번 수정은 직접 결과 URL 우선 수집, 제목의 명시적 매물 번호·공식 모바일 주소 인식, 최대 2회 기본 검색, 35초 서버 전체 제한, 원인별 안전한 진단과 선택적인 광고 주소 재검증을 포함한다. 첫 검색은 따옴표로 감싼 차량번호, 보완 검색은 따옴표 없는 차량번호만 사용한다. 판매자 계정을 사용하지 않으며 실제 차량·광고 ID를 코드나 테스트에 고정하지 않는다.

`광고 주소로 확인`은 검색이 광고를 검증하지 못한 경우에만 접힌 상태로 표시한다. 주소를 직접 열지 않고 후보 ID로 서버 검증을 다시 수행한다. 차량 변경·로그아웃·시간 초과 시 이전 응답과 입력 내용을 폐기한다. 검색/상세 오류는 매물 없음으로 바꾸지 않는다.

### 운영에서 원인 확인하기

1. 로그인 화면 하단 `v2.28`을 확인하고 차량 상세에서 자동 조회한다.
2. 미확인 또는 오류가 계속되면 `진단 정보 복사`를 사용한다. 복사 내용은 정해진 코드·요청 ID·조회 개수만 포함하며 키·토큰·차량번호·광고 주소·원문을 포함하지 않는다.
3. `SEARCH_NO_RESULTS`는 검색 서비스 결과가 없음, `SEARCH_NO_CANDIDATES`는 결과에 해석 가능한 후보가 없음이다. 둘 다 엔카에 광고가 없다는 증거가 아니다.
4. `PLATE_MISMATCH`, `AD_INACTIVE`, `DETAIL_NOT_FOUND`는 각각 읽은 후보의 번호 불일치, 현재 광고 상태가 아님, 페이지 삭제 응답이다. 차단·파싱 실패·시간 초과는 별도의 오류다.
5. 알려진 엔카 광고 주소가 있다면 `광고 주소로 확인`에서 재검증할 수 있다. 원본과 믿고 모두 실제 엔카 상세의 번호·연결·광고 상태를 확인한 경우만 표시한다.
6. 운영 주소 `s-note.pages.dev`에 연결된 Cloudflare 프로젝트의 로그 수집/실시간 로그를 켜고 다시 조회한 뒤 복사한 요청 ID로 단계와 개수를 확인한다. 로그에 키·토큰·차량번호·광고 ID·URL·상세 HTML을 남기지 않는다.

배포 성공과 실차 검색 성공은 별개다. 현재 실행 환경에서 운영 비밀값·로그·로그인 세션에 접근할 수 없으므로, 모의 회귀 검사 및 빌드 결과와 실제 운영 확인 결과를 구분해서 기록한다. `/api/encar`는 POST 전용이며 GET의 405는 설정 장애를 의미하지 않는다.

### v2.28 검증 결과

- 지정된 독립 `npm ci` 재실행 후 **140/140 통과**: 서버 79 + 화면 58 + 실제 화면/서버 함수 통합 3. 테스트 의존성은 기존 `tests/encar` 내부만 사용하며 신규 패키지는 없다.
- 실제 Chromium **9개 검증 묶음 통과**: PC 1440px, 모바일 390px·320px, 긴 광고 주소·진단 복사 대안의 넘침 없음, 검증 전 직접 이동 없음, 기존 차량 편집 보호 유지.
- Pages Functions 로컬 빌드, 기존 OCR 회귀 **6/6**, JS 구문·diff·단일 최종 body 연결 검사 통과.
- 화면에는 `v2.28`이 표시되고 엔카 스크립트는 `?v=2.28`로 한 번만 로드한다. 주소 입력 때문에 가짜 미저장 경고가 생기지 않도록 기존 draft 감지에서 조회 영역만 제외했다.
- 실제 차량번호 검색·현재 엔카 광고 상태·운영 로그의 직접 열람은 미검증이다. 배포 후 안전한 진단 복사 결과로 운영 단계와 검색 결과 개수를 확인한다.

## 2026-11-03 배포 승인과 v2.27

사용자가 웹페이지 미반영을 확인한 뒤 원격 업데이트와 배포 완료를 명시적으로 요청했다. 최초 인계 결과가 로컬 브랜치에만 있었기 때문에 운영 웹에 기능이 나타나지 않았다. 최신 `origin/main`(`488d8d2`)과 충돌이 없음을 확인했으며, 준비된 엔카 기능과 로그인 버전 `v2.27`을 기존 GitHub/Cloudflare 배포 경로로 반영한다.

이전 절의 원격 반영·배포 대기는 이번 사용자 요청으로 해제되었다. 키 공개, 유료 API 가입, 데이터 삭제는 승인 범위에 포함하지 않는다. 운영 반영 후에는 공개 HTML의 단일 스크립트 연결, 실제 JS 제공, `/api/encar` 함수 응답을 확인한다. 실차 조회의 성공 여부는 서버 키·로그인 세션·실제 광고 검증 결과를 확인했을 때만 완료로 기록한다.

### 배포 완료와 현재 검증 범위

- 릴리스 `d540f3e31a9ea32c3079083d8f9c9c7f10a23635`를 기존 main에 정상 push했다. 강제 push나 다른 작업 초기화는 하지 않았다.
- 2026-11-03 00:17 KST에 정확한 릴리스 SHA의 **s-note Pages 성공**을 [체크 125359432770](https://github.com/spooky1121/s-note/runs/125359432770)에서 확인했다. 배포 URL은 https://25c23a0d.s-note.pages.dev 이다.
- 같은 SHA의 **zerocar-office Pages 성공**도 [체크 125359241058](https://github.com/spooky1121/s-note/runs/125359241058)에서 확인했다. 배포 URL은 https://7a57da1d.zerocar-office.pages.dev 이다.
- 별도 Workers Build의 실패는 Pages 결과와 구분한다. 실패 원문과 Workers 설정은 접근하지 못했고 변경하지 않았다.
- 배포 전 **66개 테스트와 Chromium 8개 검증 묶음이 재통과**했다. 실제 운영 HTML·JS·API 읽기는 실행 환경 프록시의 CONNECT 403으로 차단되어 직접 검증하지 못했다. 이는 서비스 자체의 오류 응답을 확인한 것이 아니다.
- **실제 검색 API 및 배포 환경 설정 연동은 미검증 상태다.** 운영 비밀값을 읽거나 변경하지 않았으며 실제 차량 조회도 하지 않았다. Production의 `TAVILY_API_KEY` 등록 여부와 기존 OCR Supabase 설정을 확인한 뒤 로그인 상태에서 실차 검증이 남아 있다.
- 기록 커밋은 문서만 변경하고 `[skip ci]`로 main에 남긴다. 현재 애플리케이션 배포 기준은 `d540f3e`이며, 이후에는 최신 커밋의 checks 목록을 다시 읽어 완료 run을 확인한다. 예전 Building run만 추적하면 완료 결과를 놓칠 수 있다.

## 최초 로컬 적용 상태

- 작업 브랜치: `feat/encar-ad-link-handoff`.
- 실제 적용 기준: `488d8d2cef3352195fde37206a745be2e7db5624` — 판매 완료 월별 조회까지 포함된 현재 프로젝트.
- 시작 작업 트리는 깨끗했으며 적용되는 `AGENTS.md`와 `PROJECT_HISTORY.md`는 없었다. 이번 결과는 새 `PROJECT_HISTORY.md`에도 기록했다.
- 첨부 `SNOTE_ENCAR_CODEX_HANDOFF.patch`의 SHA-256: `09da1b19e5abf1fdea36cf186e1909e61e1936c1a2cd5ee02d175b350995de66`.
- `git apply --check` 통과 후 실제 적용했고, 적용 직후 `git apply --reverse --check`도 통과했다. 충돌이나 부분 적용은 없었다.
- 기존 `index.html`은 실제 문서의 마지막 `</body>` 바로 앞에 스크립트 한 줄만 추가했다. 연결 횟수 1회를 별도 검사했다. 기존 인쇄 템플릿·디자인·로그인·월별 조회·소득정산·OCR 코드는 덮어쓰지 않았다.
- 로컬 코드 적용, 모의 테스트, 실제 Chromium 검증과 Pages Functions 로컬 빌드는 완료했다. **실제 검색 API 및 배포 환경 연동은 미검증 상태다.**
- **이번 작업에서는 push, 원격 브랜치 생성, main 병합, 운영 배포, 운영 설정 변경을 하지 않았다. 이후 원격 반영과 배포에는 사용자의 새 확인이 필요하다.**

### 적용하면서 보완한 실제 연동 문제

1. 서버가 허용하는 매물 ID는 첫 자리가 0이 아닌 1~12자리지만 기존 화면은 7~10자리만 허용했다. 화면의 URL·후보 캐시 검증 범위를 서버와 일치시켰다.
2. 기존 클라우드 새로고침은 상세정보를 그릴 때 `ready=false`였다가 마지막에 `ready=true`로 복귀한다. `#zc-cloud-status` 변경도 관찰해 열린 상세의 버튼이 잠긴 채 남지 않도록 했다. 기존 로그인 함수와 `index.html` 본문은 수정하지 않았다.
3. 네트워크나 JSON Promise가 취소 신호에 응답하지 않아도 45초 제한에 대기 탭을 닫고, 늦게 도착한 결과가 광고를 열지 않도록 요청·응답 해석에도 취소 가능한 대기를 적용했다.

### 현재 검증 결과

| 항목 | 결과 |
| --- | --- |
| Node.js / npm | `v24.19.0` / `11.9.0` |
| 첨부 원본 검사 | 서버 39 + 화면 24 = **63/63 통과** |
| 보완 후 최종 검사 | 서버 39 + 화면 27 = **66/66 통과**, 실패 0 |
| 실제 Chromium | **8개 검증 묶음 통과** — 데스크톱 1440px, 모바일 390px·320px |
| 팝업/전환 | 실제 대기 탭, 단일 광고 열기, 복수 선택, 믿고 링크, 팝업 차단 대체 링크, 차량 교체·로그아웃·새로고침 검증 |
| Pages Functions | Wrangler `4.152.0` 로컬 번들 빌드 성공; 배포 명령은 실행하지 않음 |
| 기존 OCR 회귀 | 등록증 파서 **6/6 통과** |
| 실제 외부 조회 | **미실행** — 테스트 HTTP·차량·인증 응답은 합성 데이터 |

테스트 의존성은 `tests/encar/package.json`과 lock 파일에서만 관리한다. `jsdom 30.1.3`, `playwright 1.57.0`은 개발 의존성이며, 루트 `package.json`이나 운영 의존성을 추가하지 않았다. `tests/encar/node_modules/`는 Git에서 제외한다.

```bash
npm ci --prefix tests/encar --include=dev --ignore-scripts --no-audit --no-fund
npm test --prefix tests/encar
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser --prefix tests/encar
```

위 명령은 현재 작업 환경에서 실행해 통과했다. 기본 샌드박스의 npm registry 접속은 `EPERM`으로 막혀 동일 설치 명령을 네트워크 접근이 허용된 실행으로 재시도했다. 설치 스크립트는 실행하지 않았다. Chromium이 별도로 설치된 환경에서는 `CHROMIUM_PATH`를 해당 실행 파일로 지정한다. Playwright의 Chromium을 쓰려면 `node tests/encar/node_modules/playwright/cli.js install chromium`으로 설치한 뒤 `CHROMIUM_PATH` 없이 브라우저 명령을 실행할 수 있다. 이번 작업은 기존 `/usr/bin/chromium`을 사용했다.

### 아직 확인하지 않은 환경과 다음 작업

- 현재 실행 환경에는 `TAVILY_API_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`가 주입되어 있지 않고 로컬 `.dev.vars`도 없었다. 값은 출력하거나 소스에 추가하지 않았다. **이 결과가 기존 운영 OCR의 Supabase 설정이 없다는 뜻은 아니다.** 운영 설정을 읽거나 변경하지 않았다.
- 사용자가 승인한 테스트 환경에 Tavily 키와 기존 OCR의 Supabase 설정을 서버 전용 설정으로 연결한 뒤 실제 차량번호 검색을 확인한다. `ENCAR_CACHE`는 선택 사항이며 사용하려면 해당 환경의 KV 바인딩을 연결한다.
- 실제 Tavily 응답 범위·검색 성공률, 실제 Encar HTML 형식·차단 응답, Cloudflare 외부 통신과 비밀값 바인딩은 검증하지 않았다. 실제 운영 차량번호로 검색하거나 API 크레딧을 사용하지 않았다.
- 외부 호출별 제한은 10초, 화면 전체 대기는 45초다. 서버는 여러 검증 단계를 수행하므로 실제 환경에서 전체 소요 시간과 플랫폼 실행 제한을 확인할 필요가 있다. 화면의 45초 제한과 늦은 응답 차단은 모의 검사로 검증했다.
- 공개 push, main 병합과 운영 배포는 위 결과를 사용자가 검토하고 확인한 뒤 진행한다.

## 첨부 인계 당시의 배경

2026-11-02 사용자가 이 대화에서 준비한 기능을 Codex의 S-NOTE 웹 프로젝트로 옮겨 달라고 요청했다.

- 대상: 이 S-NOTE 웹 저장소. Android 및 별도 차량 서류 공유 앱은 이번 작업 대상이 아니다.
- 첨부 패치 작성 기준 커밋: `4b93bcbb173190c23950847ba9d4563203418cd1`.
- 첨부 패치 작성 기준 `index.html` blob: `f5b97aabb609aa780e094fc1adf13cf8eb9d3baf`. 실제 적용은 위의 최신 `488d8d2` 위에서 수행했다.
- 인계 당시의 권장 브랜치는 `codex-encar-link-handoff-20261102`였지만, 이번 로컬 작업은 `feat/encar-ad-link-handoff`에서 수행했다. 원격 인계 브랜치는 만들지 않았다.
- 아래는 전달받은 구현 방식과 배경이다. 실제 검색과 배포 환경 검증은 현재도 남아 있다.
- GitHub 파일 쓰기가 승인 단계에서 거절되어 원격 저장소 반영은 완료되지 않았다. 첨부 패치를 Codex의 S-NOTE 웹 프로젝트에 적용하는 방식으로 전달한다.
- 이 인계는 운영 배포, 비밀값 설정, DB 변경 또는 기존 프로젝트 삭제를 수행하지 않는다.
- 사용자는 기존 기능과 데이터 보존, 승인 없는 외부 공개 금지를 요청했다. 후속 작업도 이 조건을 지킨다.

## 사용자 목표

S-NOTE 차량 상세화면에 저장된 차량번호로 해당 차량의 엔카 광고를 정확하게 연다. 조회 과정에서 엔카 판매자 계정 ID를 사용하지 않는다. 사용자가 매물 ID를 입력할 필요가 없도록 한다.

번호판 문자열을 숫자로 해독해 매물 ID를 계산하는 규칙은 확인되지 않았다. 검색 결과에서 실제 후보 ID를 얻고, 엔카 공개 상세페이지의 차량번호와 광고 상태를 검증하는 방식이다.

## 포함된 변경

| 경로 | 내용 |
| --- | --- |
| `assets/snote-encar-link.js` | 차량 상세에 ‘엔카 광고 보기’ 버튼과 검증 결과 링크 추가 |
| `functions/api/encar.js` | `POST /api/encar` 서버 함수 |
| `index.html` | 맨 마지막 `</body>` 앞에 위 화면 스크립트 한 줄 추가 |
| `tests/encar/` | 원본 63개와 추가 화면 회귀 3개, 실제 브라우저 검사 및 독립된 테스트 의존성 |
| `docs/ENCAR_CODEX_HANDOFF.md` | 이 인계 문서 |

`index.html`에는 문서 인쇄 템플릿 안의 `</body>`도 있으므로 전역 문자열 치환을 사용하지 않는다. 기존 화면 코드 전체를 오래된 파일로 덮어쓰지 않는다.

## 조회 흐름

1. 브라우저는 현재 차량의 번호판을 읽고 `zc86Cloud.getAccessToken()`으로 S-NOTE 로그인 토큰을 얻는다.
2. `/api/encar`는 기존 OCR 서버와 같은 Supabase 사용자 및 활성 직원 검증을 수행한다.
3. 브라우저/선택적 KV에 저장된 후보 ID가 있으면 실제 엔카 상세페이지를 먼저 다시 검증한다.
4. 유효한 후보가 없으면 Tavily에 따옴표로 감싼 정확한 차량번호를 검색한다.
5. 알려진 URL 패턴 또는 명시된 lot 번호에서 최대 6개 후보 ID를 읽는다. 검색 결과의 임의 숫자를 ID로 취급하지 않는다.
6. 고정된 `https://fem.encar.com/cars/detail/{ID}`에서 공개 HTML을 읽는다. 외부 검색 결과 URL 자체를 임의로 fetch하지 않는다.
7. `__PRELOADED_STATE__`의 JSON에서 차량번호가 정확히 일치하고 광고 상태가 `ADVERTISE`인지 확인한다.
8. 원본 매물 ID로 중복을 제거한다. 연결된 믿고 ID도 별도 페이지에서 같은 번호판·원본 ID·광고 상태를 확인한 경우에만 제공한다.

### 읽는 엔카 필드

```text
cars.base.vehicleNo
cars.base.vehicleId
cars.base.queryCarId
cars.base.advertisement.status
cars.base.manage.dummy
cars.base.manage.dummyVehicleId
cars.base.category.manufacturerName / modelName / gradeName / gradeDetailName
cars.base.category.yearMonth / formYear
cars.base.spec.mileage
```

스크립트는 실행하지 않으며 JSON으로만 파싱한다. 믿고 ID를 원본 ID에 상수를 더하는 방식으로 만들지 않는다. 앞선 조사에서 검색 API의 차단 응답이 관찰되었으므로 비공개/차단 API로 전환하거나 로그인 제한을 우회하지 않는다.

### 요청과 응답

```json
{"plate":"12가3456","candidateIds":[]}
```

`candidateIds`는 선택적인 재검증 힌트다. 사용자 입력은 차량번호만 있으면 된다.

응답 필드는 `plate`, `verifiedAt`, `listings`, `status`이며, `status`는 `found`, `multiple`, `unverified`, `error` 중 하나다. 각 listing은 `id`, `trustedId`, `sellerUrl`, `trustedUrl`, `model`, `yearMonth`, `formYear`, `mileage`만 포함한다.

- 확인된 원본 광고가 한 개면 판매자 광고를 연다.
- 여러 개면 사용자가 선택할 수 있도록 링크를 표시한다.
- `unverified`는 일치하는 현재 광고를 확인하지 못했다는 뜻이며, 엔카에 광고가 전혀 없다는 증명이 아니다.
- 차단·시간 초과·파싱 실패는 오류다. 이를 매물 없음으로 표시하지 않는다.
- 일부 후보 검증만 실패해도 서버는 HTTP 502와 `error`를 반환할 수 있다. 확인된 listing이 응답에 남아 있어도 현재 화면은 자동 이동하지 않는다.

## S-NOTE 연결 지점

화면 스크립트는 기존 전역 `cars`, `activeCarId`, `currentUser`, `window.zc86Cloud`와 `#vehicle-overlay`, `#vehicle-meta`를 사용한다.

버튼 클릭 중 대기 탭을 먼저 확보하고, 검증된 정확한 엔카 URL로만 이동한다. 팝업이 차단되면 화면 안의 링크를 제공한다. 차량 교체·로그아웃·사용자 변경·시간 초과 때 이전 응답으로 페이지가 열리지 않도록 처리한다. localStorage에는 차량번호별 후보 ID를 저장하고 매번 서버에서 재검증한다.

## 서버 설정

Cloudflare Pages의 서버 환경에 다음 이름이 필요하다. 실제 값이나 토큰을 소스·인계 문서·채팅에 기록하지 않는다.

| 이름 | 용도 |
| --- | --- |
| `TAVILY_API_KEY` | 신규 검색 공급자 키. 아직 설정하거나 호출하지 않았다. |
| `SUPABASE_URL` | 기존 OCR과 동일한 Supabase 프로젝트 URL |
| `SUPABASE_PUBLISHABLE_KEY` | 기존 OCR과 동일한 공개 API 키. `service_role` 키를 사용하지 않는다. |
| `ENCAR_CACHE` | 선택적인 Cloudflare KV 바인딩. 없어도 동작한다. |

직원 권한은 서버에서 `/auth/v1/user`와 `zc_members`의 `user_id`, `active=true`로 확인한다. DB 스키마 추가는 필요하지 않다. `ENCAR_CACHE`를 사용하는 경우 값에는 후보 ID만 1시간 저장하며, 캐시 결과도 다시 검증한다.

## 테스트 실행

Node.js 24 환경에서 검증했다. 테스트용 jsdom과 Playwright는 `tests/encar` 안에만 설치하며 운영 코드에는 추가 패키지가 필요 없다.

```bash
npm ci --prefix tests/encar --include=dev --ignore-scripts --no-audit --no-fund
npm test --prefix tests/encar
```

첨부 원본은 서버 39개 + 화면 24개 = 총 63개 테스트이며, 이번 보완 후에는 화면 회귀 3개를 추가해 총 66개다. 테스트의 차량번호와 매물 ID는 모의 데이터다. 실제 검색 API·Supabase·엔카 네트워크 호출 없이 모의 응답으로 동작한다. 전달받은 문서에는 과거 실제 공개 HTML의 원본/믿고 쌍을 파싱한 기록이 있지만, 그 HTML은 이번 프로젝트에 없으므로 이번 작업에서 재현한 실연동 검증 결과로 취급하지 않는다.

모의 DOM 테스트는 실제 브라우저의 팝업 정책 및 Cloudflare의 외부 네트워크 동작을 보증하지 않는다.

## Codex에서 이어 할 일

1. **완료:** 현재 기준 `488d8d2`에서 작업 브랜치를 만들고 적용·역방향 검사를 마쳤다. 다시 시작할 때는 `PROJECT_HISTORY.md`, 현재 브랜치와 작업 트리를 먼저 확인하고 패치를 중복 적용하지 않는다. 기존 트리를 강제로 초기화하지 않는다.
2. **완료:** 원본 63개와 보완 후 66개 테스트, 실제 Chromium 8개 검증 묶음, 기존 OCR 6개 회귀, 로컬 Functions 빌드를 확인했다. 코드 수정 시 기록된 명령으로 다시 검증한다.
3. 사용자가 발급한 Tavily 키를 승인된 서버 비밀값 설정 경로로 연결한다. 새 계정 가입·유료 이용·키 공개를 대신 결정하지 않는다.
4. 외부 공개가 허용된 것으로 간주하지 말고, 승인된 비공개 미리보기 환경에서 실제 차량번호 검색과 엔카 HTML 접근을 확인한다.
5. 검색 공급자가 기존 수동 검색에서 찾은 결과를 같은 범위로 제공하는지 확인한다. 아직 이 검증은 하지 않았으므로 검색 성공률과 소요 시간을 보장하지 않는다.
6. 오류와 미확인을 구분하고, 번호판이 다른 차량으로 이동하지 않는지 실브라우저에서도 확인한다.
7. 운영 반영은 검증 결과를 사용자에게 제시한 후 기존 배포 승인 범위에 따라 진행한다.

### 배포 상태 주의

로컬 인계 커밋과 브랜치의 최신 상태는 `git log -1`과 `git status`로 확인한다. 코드 인계용 로컬 커밋은 `[skip ci]`로 시작하지만, 이 표시는 push나 외부 공개에 대한 사용자 승인을 대신하지 않는다. 원격 push와 main 병합·운영 배포는 이번 작업에서 수행하지 않았으며, 사용자의 확인 전에는 진행하지 않는다. 운영 데이터·사진·고객정보·기존 프로젝트를 삭제하거나 대체하지 않는다.

## 참고 문서

- Tavily Search: https://docs.tavily.com/documentation/api-reference/endpoint/search
- Tavily credits: https://docs.tavily.com/documentation/api-credits
- Cloudflare Pages Functions: https://developers.cloudflare.com/pages/functions/get-started/
- Cloudflare server bindings: https://developers.cloudflare.com/pages/functions/bindings/
- Cloudflare commit별 배포 생략: https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/
