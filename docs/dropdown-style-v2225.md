# 공통 드롭다운과 검색 닫기 표시 (v2.225)

차량 등록·상세·금융·목록 필터·운영자·월정산·소득정산의 단일 선택 메뉴를 같은 둥근 흰색 메뉴로 표시한다. 원래 select는 이동·숨김·복제하지 않는다. 닫힌 선택 칸의 폭·높이·글꼴·패딩·테두리 굵기·폼·검증·권한은 유지하며 표면 색상과 모서리만 맞춘다.

- 실제 option의 index를 선택하고 원래 input → change 이벤트를 각각 한 번 전달한다. 같은 옵션을 다시 선택하면 이벤트를 발생시키지 않는다.
- optgroup·숨긴 옵션·disabled 옵션·상위 fieldset 잠금·동적 옵션 교체를 반영한다. 원본이 숨겨지거나 제거되거나 값이 별도로 복원되면 열린 메뉴를 정리한다.
- 키보드·Esc·Tab·모바일 뒤로가기를 지원하고, 부모 편집창의 닫기·확인 절차를 유지한다. iframe 메뉴는 부모 브라우저에서 실제 보이는 영역을 기준으로 배치한다.
- 기존 상태 메뉴와 색상 팔레트는 재구현하지 않는다. 프로필·선재고 작업·색상 메뉴도 크기·배열을 유지하며 표면만 통일한다. 숨긴 색상 select, 자유입력 datalist와 카카오 제공 주소검색 내부 UI는 그대로 사용한다.
- 계약중 차량 줄의 강조 배경은 유지하고 상태 박스의 별도 배경색만 투명하게 한다.
- 검색창의 native cancel 버튼을 숨긴다. 검색 닫기 SVG는 공통 아이콘 자동 확대를 막아 실제 18px로 표시하며 버튼 영역 28px는 유지한다.

## 검증

가상 계정·차량·API·로컬 PGlite만 사용한다. 운영 데이터와 서비스 설정은 변경하지 않는다.

- `node tests/dropdown-style-v2225.browser.cjs`: 원본 규격·실제 분류 연동·금융 선택·원본 DOM/폼·이벤트 순서/횟수·그룹/잠금·동적 옵션·키보드·모바일·운영자 필터. 제공된 기준선이 있으면 이전 버전과 비교하며, 없으면 열기 전후 규격과 실제 기능을 검증한다.
- `node tests/mobile-popup-history.browser.cjs`, `node tests/operator-console.browser.cjs`, `node tests/normal-login.browser.cjs`.
- `node tests/monthly-workbook-ui.browser.cjs`.
- `NODE_PATH=/workspace/work/deps/node_modules:/workspace/s-note/tests/encar/node_modules CHROMIUM_PATH=/usr/bin/chromium node tests/income-settlement-ui-v2174.browser.cjs`. 기존 helper는 사진의 차명이 정산 버튼 이름에 잘못 매칭되지 않도록 정확한 이름을 사용하고, 지연 생성되는 팝업을 기다린다.
- 실제 Chromium 화면과 WebKit cancel 버튼의 UA shadow 스타일, JS 문법, `git diff --check`.

실제 Safari·모바일 OS 키보드는 별도 검증 대상이다. 운영 사이트 직접 브라우저 접속은 실행환경 제약이 있어, 배포 확인은 검증한 소스 트리와 정확한 커밋의 Cloudflare Pages `s-note` 빌드로 남긴다.
