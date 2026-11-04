# 모바일 화면 구성 — v2.58

2026-11-04, GitHub main `c48c75a`(v2.57)를 기준으로 적용했다. 복구된 실행 환경의 오래된 작업은 로컬 브랜치 `feat/mobile-refinement`, 체크포인트 `4071e24`에 보존했으며 운영 최신 코드를 대체하지 않았다.

## 적용 범위

- `assets/mobile-shell.css`: 모바일 글꼴·크기 변수, 메뉴/날씨/계산기/프로필과 제목을 나눈 상단, 메뉴 서랍, 로그인 및 일부 보조 입력/알림의 크기.
- `assets/mobile-workspace.css`: 매입·판매완료 차량 카드, 검색·정렬·페이지 이동, 수익/재고금융/선재고 요약과 입력, 고객 목록, 설정·경리 화면.
- `assets/mobile-documents.css`: 별도 문서인 월결산·소득정산의 요약 카드, 도구 버튼, 입력 및 표 내부 가로 스크롤.
- 메인 문서는 기존 스타일 뒤에 shell/workspace를, 월결산·소득정산은 기존 스타일 뒤에 documents를 한 번씩 불러온다. 새 자산의 버전 키는 `2.58`이다.

세 파일의 규칙은 `screen` 미디어와 모바일 너비에만 적용한다. 넓은 표는 글자를 축소하는 대신 기존 표 영역 안에서 가로로 스크롤한다. 원 단위 금액과 전체 차량명, 기존 광고·저장·서명·인쇄·문자·권한 기능은 그대로 사용한다. 서버 함수·SQL·키·DB 데이터 변경은 없다.

## 글씨와 간격

| 용도 | 기본 크기 |
| --- | --- |
| 페이지 제목 | 20px, 상단 제목은 22px / 좁은 화면 20px |
| 카드 제목 | 16px |
| 본문·차량명 | 14px |
| 라벨·보조정보 | 12px |
| 입력 글씨 | 16px 이상 |
| 주요 합계 | 22–24px |

시스템 글꼴을 우선하며 Apple SD Gothic Neo, Noto Sans KR 순으로 대체한다. 표와 숫자 표시는 원값을 보존한다. 상단·검색·정렬 등 주요 터치 버튼은 44px, 카드의 보조 동작은 40px 이상으로 정리했다. 기존 전체 높이 차량/등록 패널과 문서 출력 방식은 유지한다.

## 검증

의존성은 기존 `tests/encar` 내부에서 관리한다. 새 패키지는 없다.

```bash
npm test --prefix tests/encar
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser --prefix tests/encar
CHROMIUM_PATH=/usr/bin/chromium npm run test:mobile --prefix tests/encar
CHROMIUM_PATH=/usr/bin/chromium node tests/document-actions.browser.cjs
```

새 모바일 검사는 실제 index와 기존 합성 인증/DB/HTTP fixture를 사용한다. 320·390·430px에서 역할별 실제 메뉴, 입력/라벨 가독성, 화면 가로 넘침, 월결산·소득정산 iframe, 메뉴 이동·계산기·프로필 버튼을 확인한다. 고객·차량·직원·날씨 자료는 가상이며 실제 운영 계정이나 문자 발송을 사용하지 않는다.

최종 통과 수와 배포 커밋은 `PROJECT_HISTORY.md`의 v2.58 기록에 남긴다. Chromium 화면 검사는 실제 iPhone/Safari 및 운영 로그인 화면의 직접 검증과 구분한다.

배포 앱: `92e3e84983ba4f30f9dc36815490fed665add6df`. Cloudflare Pages: s-note 체크 `126483991511` 성공, 2026-11-04 17:55:42 KST. 서비스 https://s-note.pages.dev/?release=2.58 , 배포 https://0a4db6d5.s-note.pages.dev . 운영 주소 직접 GET은403으로 차단돼 화면 직접 검증과 구분한다.
