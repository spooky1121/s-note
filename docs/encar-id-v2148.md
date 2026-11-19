# GLOAR 차량번호 검색 v2.148

차량 상세·매입 목록·카드의 기존 Encar 버튼은 이제 GLOAR DATA의 실제 검색창을 사용한다. 검색엔진 색인, Carnect/Trust 순차 검색, 추측한 검색 URL은 운영 경로에서 제외했다.

화면 v2.150은 찾은 ID 아래에 `https://fem.encar.com/cars/detail/{ID}` 전체 링크를 표시한다. 사용자가 링크를 누를 때만 새 탭으로 열리며 자동 탭 열기·탭 예약은 없다. 검색 중·실패·닫기·계정 변경 시 링크를 숨기고 주소도 제거한다. 검색 서버는 v2.148 그대로 유지한다.

## 동작

1. 기존 S-NOTE 로그인과 활성 상사 멤버십을 검증한다.
2. 서버 Browser Run에서 `https://gloar-data.com/en`을 연다.
3. 정확한 `#headerSearchInput`에 전체 차량번호를 입력하고 입력 적용·포커스를 확인한 뒤 Enter를 보낸다. 같은 placeholder를 사용하는 별도의 VIN 조회창은 건드리지 않는다.
4. 실제 이동한 상세 주소 또는 새로 나타난 결과 링크를 확인한다. 상세의 차량번호가 일치하고 원본 엔카 링크/명시된 엔카 ID가 확인될 때만 반환한다.
5. 기존 팝업에 광고 ID·수동 링크·확인 버튼을 표시한다. 원본 엔카 페이지를 자동으로 열지 않으며 가격 확인·변경, 차량·광고 정보 저장은 하지 않는다.

구현은 `functions/_shared/encar-id-gloar.mjs`, 서버 인증·응답은 `functions/api/encar-id.js`, 화면은 `assets/encar-id.js`에 있다. 이전 공급자 검색 모듈은 과거 테스트/백업이며 운영 API가 가져오지 않는다.

## 판독과 제한

- 차량번호 전체를 대조한다. 제조사·차대번호·연식은 필수 일치 조건이 아니다.
- GLOAR 상세 주소에는 VIN 또는 원본 광고 ID 뒤에 GLOAR UUID가 올 수 있다. UUID·VIN·임의의 주소 숫자를 엔카 ID로 추측하지 않는다.
- 같은 차량의 명시된 원본 엔카 링크/ID만 사용하고, 추천 매물·검색창의 입력값으로 일치를 증명하지 않는다.
- 미검색, 입력창 문제, 원본 ID 미확인, 브라우저 인증·한도를 서로 구분한다. 차단 응답이나 불완전한 검색을 광고 없음으로 처리하지 않는다.
- 요청당 독립 브라우저 컨텍스트를 사용하고 성공·실패·취소 시 정리한다. GLOAR 전용 세션과 이전 공급자 세션의 재사용 캐시를 구분한다. 공급자의 차단·인증·실행 한도는 우회하지 않는다.

## 서버 설정

기존 Production의 `CLOUDFLARE_ACCOUNT_ID`, 암호화된 `CLOUDFLARE_BROWSER_TOKEN`을 사용한다. 토큰에는 해당 계정의 Browser Run Edit 권한이 필요하다. 클라이언트에서 키를 입력하거나 전송하지 않는다. 로그인 검증용 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`는 기존대로 유지한다. 이 경로는 `TAVILY_API_KEY`를 사용하지 않는다.

`GET /api/encar-id`는 키 존재 여부만 `{ok,configured,provider:"gloar",release:"2.148"}`로 알린다. 실제 인증·검색 성공을 뜻하지 않는다. POST는 `{plate}`만 허용하며 임의 URL·코드·자격증명을 받지 않는다.

## 검증 범위

자동 검사는 합성 GLOAR 화면과 CDP/인증 응답으로 입력·Enter·검색 결과 이동·원본 ID 판독·잘못된 번호판/UUID 거부·요청 취소·세션 정리·저장 호출 없음을 확인한다. Chromium으로 기존 PC·모바일 목록/카드/상세 팝업도 검사한다. 실제 Pages 빌드의 Workers 런타임 검사와 명령은 `tests/encar/README.md`에 정리한다.

현재 실행환경의 실제 GLOAR 접속은 CONNECT 403으로 차단된다. 따라서 실제 검색 이벤트/API 계약과 운영 Browser Run을 통한 실차 검색 성공은 이 환경에서 최종 검증하지 못했다. 자동 검사 통과를 실제 GLOAR 검색 성공으로 표시하지 않는다.

공식 Browser Run 세션 자료: https://developers.cloudflare.com/browser-run/cdp/session-management/
