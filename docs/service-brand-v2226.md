# 공식 서비스 로고 (v2.226)

제공받은 파란 S 심볼과 소문자 `snote` 이미지에서 배경과 주변 여백을 정리하고 서비스 표시용 자산으로 분리했다. 전체 그림은 `snote-brand.png`, 같은 그림의 왼쪽 심볼은 `snote-symbol.png`로 사용한다. 그림을 CSS로 늘이거나 나눠 자르지 않고 원래 비율로 표시한다. PNG 패키징은 디코딩한 RGBA 픽셀 해시를 전후 비교해 무손실임을 확인했다.

| 자산 | 규격 | 용도 |
|---|---|---|
| `assets/snote-brand.png` | 1149×301, RGBA | 전체 서비스 로고 |
| `assets/snote-symbol.png` | 320×320, RGBA | 축소 사이드바의 S 심볼 |
| `assets/snote-favicon.png`, `.svg`, `/favicon.ico` | 32×32 | 브라우저 아이콘 |
| `assets/snote-apple-touch-icon.png` | 180×180 | Apple 홈 화면 아이콘 |
| `assets/snote-icon-192.png`, `snote-icon-512.png` | 192×192, 512×512 | 웹 앱 아이콘 |

로그인·회원가입·사이드바·모바일 메뉴·고객 입력·계정 복구·운영자 로고는 `data-snote-service-brand`로 명시한다. 기존 외곽 박스·위치·링크와 버튼 동작은 유지하며 안쪽 그림만 contain으로 표시한다. 761–1120px의 축소 사이드바는 picture source로 심볼을 선택한다. 기존 S/NOTE 분할 crop은 해당 마커에 적용하지 않는다. manifest는 앱 이름·진입 URL·아이콘 정보를 담으며 첫 서비스 문서 7곳에서 참조한다.

견적서·계약서·인수증의 `snote-document-brand`는 기존 `assets/snote-logo.png`를 계속 사용한다. 기존 PNG의 SHA256은 `79b63ec954e0ddaa34be3832166d907f3f37863e26815c82c69491685dee9a8f`로 동일하다. 상사별 로고·도장·서명·양도증명서와 관련 인쇄 함수·CSS·비공개 이미지 연결 코드는 변경하지 않는다.

## 검증

가상 계정과 자료만 사용한다. 운영 데이터와 서비스 설정은 변경하지 않는다.

- `node tests/service-brand-v2226.browser.cjs`: 로그인·가입·업무·축소 사이드바 1440/1024/850/390/360px, 운영자·고객·복구 1440/390px, 기존 박스 크기·위치 비교, 이미지 로드·비율·잘림, 실제 링크/키보드 동작, 아이콘 디코딩·투명 모서리·S 심볼 전용·manifest 규격, 문서·상사 자산 보존. 기준선이 있으면 전후를 비교한다.
- `node tests/normal-login.browser.cjs`, `node tests/operator-console.browser.cjs`.
- `node tests/company-document-assets.browser.cjs`: 상사 로고·도장 로드, 상사 전환·교체·삭제·늦은 응답, 인쇄 준비 회귀.
- `node tests/document-refinement-v2160.browser.cjs`: 1440/390/320px 견적서·계약서·인수증과 실제 PDF 회귀. 고객 접수 fixture는 실제 문자 요청 성공 알림의 확인 버튼을 누른 다음 인증번호를 입력한다. 변경 전에도 있던 해당 준비 오류를 보완한 뒤 `DOCUMENT_REFINEMENT_FOCUS=intake node tests/document-refinement-v2160.browser.cjs`로 가상 접수·서명·원본 선택 회귀를 확인한다.
- JS 문법과 `git diff --check`, 실제 Chromium 화면 촬영.

실제 Safari 실기기는 별도 확인 대상이다. 운영 사이트 직접 브라우저 접근은 실행환경 제약이 있어 정확한 커밋의 Cloudflare Pages `s-note` 성공과 검증한 소스 트리 일치 여부로 배포를 확인한다.
