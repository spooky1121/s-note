# S-NOTE 프로젝트 작업 기록

## 2026-11-03 — 엔카 기능 원격 반영·운영 배포 승인

사용자가 “확인후 업데이트 하고 배포까지 완료”를 명시적으로 요청했다. 이전 로컬 인계 단계의 원격 반영 대기는 이 요청으로 해제되었다. 이번 승인 범위는 준비된 엔카 기능의 기존 S-NOTE GitHub 저장소 반영과 기존 Cloudflare Pages 운영 배포이며, 계정 가입·유료 서비스 신청·기존 데이터 삭제를 포함하지 않는다.

- 원인: 엔카 기능 커밋 `bba2de2`는 로컬 `feat/encar-ad-link-handoff`에만 있었고, 확인 시 원격 `main`은 `488d8d2`였다. 운영 웹에 엔카 스크립트가 없는 상태였다.
- 최신 `origin/main`을 받아 충돌과 추가 변경이 없음을 확인했다. 기존 월별 판매 조회와 모든 운영 기능을 보존한다.
- 로그인 화면 버전을 `v2.27`로 올리고 정상 배포 커밋으로 반영한다. 이전 인계 커밋의 `[skip ci]`를 배포 트리거로 사용하지 않는다.
- 배포 전 독립 테스트 66개를 다시 실행해 모두 통과했다. 실제 Chromium 검증과 배포 후 HTML·스크립트·API 응답을 확인한다.
- 기존 OCR·Supabase 비밀값은 공개하거나 덮어쓰지 않는다. 실제 검색 검증 여부와 배포 결과는 확인된 사실만 후속 기록에 남긴다.

### 배포 완료 결과 — 2026-11-03 00:17 KST 확인

- 릴리스 커밋: `d540f3e31a9ea32c3079083d8f9c9c7f10a23635` — `Release Encar advertisement lookup in S-NOTE v2.27`.
- `git push origin HEAD:main` 성공: 기존 `488d8d2`에서 강제 갱신 없이 정상 반영했다. 원격 main의 정확 SHA도 별도로 확인했다.
- **s-note Pages 성공:** [Cloudflare GitHub 체크 125359432770](https://github.com/spooky1121/s-note/runs/125359432770), `succeeded` / `Deployed successfully` / `Deploy successful!`, Latest commit `d540f3e`. 배포 URL: https://25c23a0d.s-note.pages.dev .
- **zerocar-office Pages 성공:** [체크 125359241058](https://github.com/spooky1121/s-note/runs/125359241058), 같은 릴리스 SHA 배포 성공. 배포 URL: https://7a57da1d.zerocar-office.pages.dev .
- 별도 `Workers Builds: zerocar-office` 체크 125360240513은 실패했다. 공개 체크에 실패 원문은 없었으며 이번 웹 Pages 배포 성공과 구분한다. Workers 설정은 변경하지 않았다.
- 배포 전 재검증: 독립 테스트 **66/66**, 실제 Chromium 검증 **8개 묶음** 통과. 서버·화면 JS 구문 검사와 `git diff --check`도 통과했다.
- **검증 제한:** 운영 도메인과 Pages 주소로 보내는 읽기 요청은 현재 실행 환경의 HTTPS 프록시 CONNECT 단계에서 `403 Forbidden`으로 차단됐다. 네트워크 접근 허용 후 재시도도 동일했고 직접 접속은 DNS 해석에 실패했다. 서비스 자체의 403으로 해석하지 않는다. 따라서 공개 HTML·JS·API의 실제 HTTP 응답 및 로그인 후 운영 화면은 직접 확인하지 못했다.
- **실제 검색 API 및 배포 환경 설정 연동은 미검증 상태다.** 서버 키의 값을 읽거나 변경하지 않았으며 실제 차량번호 검색·유료 크레딧 사용·데이터 변경을 하지 않았다. 사용자가 Production의 `TAVILY_API_KEY` 등록 여부를 확인하면 기존 Supabase 설정과 함께 실연동을 점검한다.
- 이 배포 결과 기록 커밋은 문서만 변경하며 `[skip ci]`로 원격 기록한다. 배포된 애플리케이션 코드의 기준 SHA는 위 `d540f3e`다.

아래 절은 최초 로컬 인계 당시의 기록이다. 당시의 “배포하지 않음”은 그 단계의 결과이며, 현재 배포 요청을 취소하거나 새 승인을 요구하는 지침이 아니다.

## 엔카 광고 연결 패치 — 로컬 적용·검증 완료, 원격 공개 대기

- 대상: `spooky1121/s-note` 웹 프로젝트.
- 시작 브랜치: `work`, 시작 작업 트리 변경 없음.
- 적용 기준: `488d8d2cef3352195fde37206a745be2e7db5624` — 판매 완료 월별 조회 기능을 포함한 상태.
- 현재 작업 브랜치: `feat/encar-ad-link-handoff`.
- 원본: 사용자 첨부 `SNOTE_ENCAR_CODEX_HANDOFF.patch`, SHA-256 `09da1b19e5abf1fdea36cf186e1909e61e1936c1a2cd5ee02d175b350995de66`.
- 적용 전 `AGENTS.md`와 이전 `PROJECT_HISTORY.md`는 없었다.

### 실제 변경과 보존 범위

`git apply --check`를 통과한 패치를 적용하고, 적용 직후 역방향 검사도 통과했다. 오래된 `index.html`로 덮어쓰거나 작업 트리를 초기화하지 않았다. 기존 화면에는 실제 마지막 `</body>` 직전 `assets/snote-encar-link.js?v=1` 로딩 한 줄만 추가했다. 기존 인쇄 템플릿 안에 연결하지 않았고 중복 로딩도 없다.

차량 상세의 **엔카 광고 보기**는 저장된 차량번호로 후보를 찾고 공개 상세의 차량번호·광고 상태를 다시 확인한다. 원본 광고 한 개는 새 탭으로, 복수 광고는 선택 링크로 표시한다. 엔카 믿고 링크는 해당 페이지도 따로 확인한 경우만 표시한다. 실패·차단·시간 초과를 매물 없음으로 표시하지 않는다. 후보 ID 캐시는 재검증 힌트로만 사용한다.

현재 프로젝트에 맞춰 화면 ID 검증을 서버의 1~12자리 규칙으로 통일하고, 클라우드 새로고침 완료 시 버튼 복구, 취소를 무시하는 비동기 응답의 시간 초과 차단을 보완했다. 기존 전역 로그인·차량·OCR 함수를 덮어쓰거나 감싸지 않았다. DB·차량·고객·사진·운영 설정은 변경하지 않았다.

### 재현과 검증

```bash
npm ci --prefix tests/encar --include=dev --ignore-scripts --no-audit --no-fund
npm test --prefix tests/encar
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser --prefix tests/encar
```

- Node.js `24.19.0`, npm `11.9.0`.
- 첨부 원본 테스트 **63/63 통과**.
- 보완 후 최종 테스트 **66/66 통과**: 서버 39, 화면 27, 실패 0.
- 실제 Chromium **8개 검증 묶음 통과**: PC 1440px, 모바일 390px·320px, 실제 팝업과 차단 대체 링크, 광고 선택, 차량 전환·로그아웃·새로고침.
- Pages Functions 로컬 번들 빌드 성공(Wrangler `4.152.0`); 배포는 하지 않았다.
- 기존 자동차등록증 OCR 파서 회귀 **6/6 통과**.
- 모든 기능 테스트의 차량·인증·조회 HTTP 응답은 합성 데이터이며 실제 Supabase·Tavily·Encar·문자 서비스 호출은 하지 않았다.
- 테스트 의존성은 `tests/encar` 내부에서 고정한다. 루트·운영 의존성 추가 없음, `node_modules`는 Git 제외.

### 남은 작업과 사용자 확인 경계

**실제 검색 API 및 배포 환경 연동은 미검증 상태다.** 현재 실행 환경에서 Tavily와 Supabase 서버 환경변수는 확인되지 않았으며 실제 키를 소스·Git·채팅에 추가하지 않았다. 기존 운영 OCR 설정은 읽거나 변경하지 않았다.

다음 작업은 사용자 승인 환경의 `TAVILY_API_KEY`, 기존 `SUPABASE_URL`·`SUPABASE_PUBLISHABLE_KEY` 연결과 실제 차량번호·광고 상태·응답 시간 확인이다. `ENCAR_CACHE` KV 바인딩은 선택 사항이다. 검증 결과를 확인한 후에만 원격 반영을 진행한다.

**이번 작업의 push·원격 브랜치 생성·main 병합·운영 배포는 0회다. 사용자의 명시적 확인 없이 진행하지 않는다.** 로컬 기록용 커밋은 `[skip ci]`로 시작하며, 이후 작업의 기준과 상세 절차는 [엔카 인계 문서](docs/ENCAR_CODEX_HANDOFF.md)를 먼저 읽는다.
