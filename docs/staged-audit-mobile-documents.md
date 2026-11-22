# 모바일 계약서·인수증 편집 검토

기준은 1·2단계 통합 게이트를 통과한 `e809967`이다. 최신 v2.183의 문서 아이콘·삭제 고객 출력 보호와 2단계의 first-use 회사 프로필·진입 actor guard를 유지한다. 운영 데이터/설정 변경, main 병합, 운영 배포는 하지 않았다.

## 변경

- 모바일 계약서·인수증을 전체 A4 축소 입력 대신 16px 글씨·44px 이상 입력칸·세로 스크롤 편집 화면으로 제공한다. 계약 종류 전환, 모든 기존 입력/체크 항목, 계약 조건·개인정보/보유기간 원문 읽기, 실제 접수된 서명/날인 미리보기를 유지한다.
- 원본 A4 입력이 유일한 기준이다. 새 화면의 입력/변경은 기존 원본 이벤트·자동 저장·식별번호/서명 보호를 그대로 통과한다. 별도 고객 저장 경로·DB·localStorage 복제는 없다. 원본은 화면 밖에서 실제 크기를 유지하므로 기존 긴 특약·주소의 A4 적합성 검사가 계속 동작한다.
- IME 조합 중에는 외부 source 갱신이 입력·caret을 덮어쓰지 않는다. 수정하지 않은 필드는 기존 비동기 고객 조회 결과를 반영한다. 전화번호/금액 구분자를 Backspace/Delete로 지울 때 커서가 같은 구분자에 갇히지 않도록 원본에 inputType·선택 범위를 전달하고 숫자 위치 기준으로 복원한다. readonly/disabled도 원본에서 확인한다.
- 실제 문서 source 준비가 끝난 view와 actor 객체·차량·route를 묶는다. 지연 import/오래된 입력은 다른 계정/차량/view/route에 적용하지 않으며, 해당 화면의 복제 입력·서명 URL을 비운다. 무효 문서의 원본도 다시 노출하지 않는다.
- 본체는 기존 선택기능 로더의 첫 사용 그룹으로 불러온다. 데스크톱과 초기 업무 진입에서는 본체를 내려받지 않는다. 모바일로 회전하면 그때 불러오며 중복 요청을 합친다. 로딩 중 작은 A4나 이전 고객 입력은 숨기고 기존 닫기/인쇄는 유지한다. 모듈 요청 실패는 안내한 뒤 기존 출력 경로를 유지하며, 문서를 다시 열면 실패한 module URL 캐시를 구분해 재시도한다.
- visualViewport 높이·offset에 맞추어 편집 frame을 배치하고 dim은 layout 전체를 덮는다. 키보드 등장으로 필드 크기를 줄이지 않는다. 닫기/인쇄는 원본 버튼·핸들러를 재사용하며 새 popup history 항목을 만들지 않는다.
- 화면용 CSS만 변경했다. 데스크톱의 오른쪽 위 세로 닫기/인쇄 아이콘, 원본 A4 문서·계약서 2부/인수증 1부·서명 위치는 유지한다. 인쇄 중 새 편집 UI는 출력하지 않는다.
- 매도/매수의 선택 버튼은 흰 글자와 `#245b9a` 배경으로 6.91:1 대비를 갖는다. 원래 닫기 그림은 그대로 두고 투명 터치 범위만 확장한다.

## 검증 명령

```bash
node tests/mobile-document-editor.browser.cjs
node tests/mobile-document-loading.browser.cjs
node tests/mobile-document-history.browser.cjs
node tests/document-viewport-v2165.browser.cjs
node tests/document-actions.browser.cjs
node tests/deleted-customer-document-print.browser.cjs
DOCUMENT_REFINEMENT_WIDTHS=1440,390 DOCUMENT_REFINEMENT_FOCUS=receipt node tests/document-refinement-v2162.browser.cjs
node tests/login-first-use.browser.cjs
```

모든 계정·회사·차량·고객·네트워크 응답은 가상 fixture다. 실제 운영 로그인/문자 발송/고객정보/DB/Cloudflare/NAS를 사용하지 않는다. 각 fixture의 외부 요청·미등록 API·uncaught error 검사도 유지한다.

- 신규 편집: 360/390/430px, 입력값 원본 연동·readonly·실제 계약서 2장/인수증 1장 PDF, 원문 읽기, 키보드 가시 영역, 실제 Backspace/Delete·중간 금액 입력·IME 조합·비동기 source·actor/car/view/route·오래된 pane·desktop 회전·닫기 개인정보 정리.
- 로딩: desktop 본체 요청 0회, mobile 회전 1회, pending 상태의 원본 인쇄, actor/car/view/route 변경 후 late import 거부, 실패 안내·기존 출력·닫기·재오픈 재시도.
- 기존 viewport: 1440×900/1366×768/1280×720/390×844/320×640의 실제 계약서 2장·인수증 1장 PDF, 색상/VIN/회사명/보유기간/서명·footer 여백을 확인한다. 모바일의 전체 A4 no-scroll 기대값만 새 편집 화면으로 분기했다. 데스크톱·A4 assertion은 완화하지 않았다.
- v2.183 삭제 고객: 현재 입력으로 출력 가능, 명시적 저장 거부, 다른 오류 차단, 지연 응답, 정상 고객의 실제 guarded bridge 자동 저장/서명 흐름을 유지한다.
- 2단계 first-use/회사 신원 9개 브라우저 회귀를 재실행한다.

독립 읽기 전용 코드 리뷰에서 구분자 삭제 커서 문제를 실제 재현해 수정했고 동일 브라우저 재현을 통과했다. 추가 중대한 actor·지연 import·readonly·인쇄 문제는 발견되지 않았다.

브라우저를 과도하게 병렬 실행한 시도에서 fixture 초기 page.goto 15초 timeout이 있었으며, 관련 suite는 한 번에 하나씩 순차 재검증해 최종 8개 suite 전부 통과했다. 초기 경합 시도는 제품 assertion 실패나 최종 통과 결과와 섞지 않았다. 마지막 회귀는 제품 소스 6개의 SHA256을 각 suite 전후 검사하며 동결 상태로 실행했고 모두 동일했다. 최종 receipt는 `/workspace/work/mobile-documents-stage3/frozen/verification.json`이다.

## 미검증과 증적

실기기 iOS Safari/Android Chrome의 실제 OS 키보드·IME·주소창 접힘·safe area·native 인쇄 대화상자는 이 환경에서 검증하지 못했다. 자동화는 Chromium의 composition 이벤트와 `visualViewport` 높이 430px/offset 20px를 모의한다. 키보드 증적은 모의 가시 영역만 잘라 저장하며 실제 키보드 캡처로 보고하지 않는다.

검증 receipt와 가상 화면/PDF는 `/workspace/work/mobile-documents-stage3/`에 보관한다. 고객정보·서명 등 가상 데이터가 든 이미지/PDF는 공개 저장소에 커밋하지 않는다.

## 최종 결과

동일 소스 해시로 순차 실행한 editor/loading/history/actions/archive/viewport/long-receipt/firstuse 8개 suite 모두 통과했다. 신규 모바일 실제 PDF 6개, 기존 viewport 실제 PDF 10개, 긴 인수증 실제 PDF 2개, 삭제 고객·정상 자동 저장·명시적 저장 보호, 실제 브라우저 Back, first-use 9개 시나리오를 포함한다. 로그인 시간의 운영 성능 수치를 새로 추정하지 않았으며 실기기 키보드는 미검증이다.
