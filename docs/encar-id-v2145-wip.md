# 외부 광고 ID 조회 — v2.145

## 동작

매입 목록·카드와 차량 상세의 Encar 버튼은 `POST /api/encar-id`에 차량번호만 전달한다. Carnect → GLOAR DATA → Trust Encar 순서로 공개 검색창을 조작한다. 검증된 광고 ID를 찾으면 즉시 종료하고 광고 ID와 확인 버튼만 표시한다. 결과가 없거나 해당 사이트가 실패하면 다음 순위로 진행한다. 사이트별 10초, 순차 검색 전체 35초, 인증·브라우저 준비를 포함한 API 45초 제한을 둔다.

한국 엔카를 방문하거나 외부 창을 열지 않는다. 가격·OCR·판매예정가 변경·차량/광고 저장을 실행하지 않는다. 기존 `cars.encarLinks` 자료는 보존한다. 이전 `/api/encar`와 `/api/encar-auto-price`는 외부 호출 없이 410을 반환한다.

## 서버 연결

기존 Cloudflare Browser Run 계정 ID와 토큰으로 요청당 브라우저를 하나만 만든다. 사이트마다 새 브라우저를 실행하지 않는다. 공개 입력창의 실제 라벨·입력 요소·폼/검색 버튼과 관찰된 상세 링크를 사용하며 검색 파라미터를 추측하지 않는다. 브라우저의 허용 호스트는 세 공급자의 도메인과 필요한 공용 CDN으로 제한한다. 한국 엔카 링크는 원본 ID를 읽는 증거로만 사용한다.

`CLOUDFLARE_ACCOUNT_ID`(32자리 계정 ID), `CLOUDFLARE_BROWSER_TOKEN`(Browser Run Edit 권한), 기존 `SUPABASE_URL`·`SUPABASE_PUBLISHABLE_KEY`가 Production에 필요하다. 토큰은 서버에서만 사용한다. 누락·인증 실패·요청 한도는 구분해서 반환한다. Browser Run의 429와 Retry-After를 존중하며 자동 재시도·클라이언트 회전·CAPTCHA 우회를 하지 않는다. 브라우저는 성공·실패·취소 후 명시적으로 종료한다.

인증은 Auth의 실제 사용자와 활성 상사 멤버십을 확인한다. 계정·차량·페이지가 바뀌면 결과를 버린다. 토큰·응답·본문 읽기와 취소는 기한을 지키며 늦은 결과가 새 팝업에 영향을 주지 않는다. 새 DB 표나 DB 변경은 없다.

## ID 대응

번호판 전체가 같은 레코드에서 확인되어야 한다. 외부 사이트의 URL에 있는 숫자를 원본 광고 ID로 추정하지 않는다. 실제 한국 엔카 원본 링크나 명시된 Encar ID, Trust의 같은 차량 레코드에 표시된 Lot을 사용한다. 입력창의 검색어·다른 추천 차량·푸터가 차량번호 증거가 되지 않도록 제한한다. 차대번호·연식·트림 일치는 요구하지 않는다.

Trust의 실제 입력 요소가 숫자 전용이거나 입력 과정에서 숫자만 남기는 경우에는 해당 형식으로 검색한다. 결과 선택 시에는 한글을 포함한 전체 번호판을 다시 대조한다. 숫자가 같고 한글이 다른 차량은 선택하지 않는다.

공개 본문에서 확인한 예시는 GLOAR의 `18허0458 ↔ 43185167`, Trust의 `293오4280 ↔ 43185559`다. 과거 Carnect 경로 `38다6738 /car/42974024`와 이전 한국 광고번호 `42974020`의 현재 대응은 미확인이므로 경로 번호만 사용하지 않는다. 과거 광고의 현재 판매 여부도 이 기능이 보장하지 않는다.

## 검증 범위와 배포 전제

이번 요청은 실제 S-NOTE에 배포한 뒤 사용자가 시험하는 범위다. 공개 검색 UI와 Cloudflare의 CDP/Workers WebSocket 지원은 공식 문서로 확인했지만 현재 실행환경에서 공급자의 실제 번호판 검색과 이 계정의 Browser Run 연결은 검증하지 못했다. 모의 테스트·빌드 성공을 실제 외부 검색 성공으로 표현하지 않는다. DOM 변경·외부 사이트 제한·Browser Run 계정 한도로 조회가 실패할 수 있으며, 실패 시 잘못된 ID를 선택하거나 저장하지 않는다.

현재 실행환경은 이전 revision 1과 허용 목록을 유지하며 Carnect 직접 요청은 실행 프록시의 CONNECT 403으로 차단된다. 사용자가 게시한 환경의 설정이 실패했다고 추정하거나 도메인 추가를 반복 요청하지 않는다. 이 작업은 환경 제한을 우회하는 디버그 프록시를 만들지 않으며, 배포할 고정 검색 기능만 연결한다. 실제 공급자 성공률·반복 조회·응답 시간은 운영 시험에서 별도로 확인해야 한다.

활성 테스트 293개, PC/모바일 목록·카드·상세의 ID 전용 팝업, Wrangler Pages 빌드, 실제 workerd의 WebSocket/CDP와 기본 API 합성 검증이 통과했다. 실제 번들에서 전송하는 검색 스크립트도 독립 DOM 환경에서 실행했다. 실행 중 발견한 Workers의 `redirect: 'error'` 미지원과 번들러의 `__name` 참조 문제를 수정했다. 네이티브 검증은 실제 외부 요청 0건이며 실제 공급자 검색 성공을 입증하지 않는다.

검증 명령과 현재 게이트는 `tests/encar/README.md`를 참고한다. 합성 테스트는 실제 계정·업무 차량·고객 자료를 사용하지 않는다. 로컬 검증 산출물은 `/workspace/work/encar-id-v2145`에 보관한다.

## 참고

- [Browser Run CDP](https://developers.cloudflare.com/browser-run/cdp/)
- [Workers WebSocket 클라이언트](https://developers.cloudflare.com/workers/examples/websockets/)
- [Browser Run 호스트 제한](https://developers.cloudflare.com/browser-run/features/guardrails/)
- [Browser Run 한도](https://developers.cloudflare.com/browser-run/limits/)
