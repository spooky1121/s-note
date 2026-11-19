# 광고 ID 웹 검색 v2.147

## 조회 방식

기존 S-NOTE는 외부 카탈로그 검색창을 브라우저로 조작했다. 대화에서 수동으로 찾을 때는 공개 웹 검색으로 개별 외부 광고 페이지를 발견했다. 두 경로가 달라 수동으로 보이는 광고를 앱에서 놓칠 수 있었다.

현재 운영 API는 `TAVILY_API_KEY`로 공개 웹 검색 결과를 받는다. Carnect → GLOAR DATA → Trust 순서로 차량번호 전체를 따옴표로 검색하고 해당 출처 도메인으로 제한한다. 첫 번째 검증 결과를 반환하면 나머지 검색을 하지 않는다. 검색 원문이 부족한 경우에만 관찰된 같은 출처의 상세 URL 최대 3개를 한 번 Extract 요청으로 읽는다.

- 순차 조회: `functions/_shared/encar-id-lookup.mjs`
- 검색·제한된 원문 추출: `functions/_shared/encar-id-search.mjs`
- 번호판·원본 ID 판독: `functions/_shared/encar-id-search-parser.mjs`
- 인증·응답: `functions/api/encar-id.js`

이 API는 Cloudflare Browser Run·카탈로그 필터 클릭·한국 엔카 접속을 실행하지 않는다. v2.146 브라우저 모듈은 이전 방식의 백업으로 남아 있지만 운영 API에서 가져오지 않는다. 따라서 새 조회의 실패를 Browser Run 실행 한도로 처리하지 않는다. 검색 공급자 자체의 인증·요청 한도는 별도로 구분한다.

## 판독 기준

개별 외부 상세 주소와 전체 차량번호, 그 상세의 명시된 원본 광고 ID를 확인한다. 외부 URL에 있는 숫자와 Tavily 검색 문서의 `id`를 광고 ID로 사용하지 않는다. 제조사·연식·트림·차대번호는 필수 조건이 아니다.

원문은 주 차량의 필드에서 읽고 추천 차량·별도 매물·코드 예제를 제외한다. 원문이 있으면 검색 요약으로 불일치를 덮어쓰지 않는다. 원문이 없을 때는 같은 검색 본문 안에 완전한 차량번호/광고 ID 필드 쌍이 있을 때만 사용하며, 제목에 명시된 번호와 충돌하면 거부한다. 불충분한 내용은 제한된 원문 추출로 다시 확인한다. 숨겨진 HTML에서 증거를 읽지 않으며 처음 HTML 태그 이후의 내용은 판독 대상에서 제외한다.

`66너7230 → 43138217`은 Trust Encar의 공개 표기 `Лот / 43138217`, `Номер автомобиля / 66너7230` 형태를 재구성한 회귀 사례다. 업무 코드에 차량별 정답표를 넣지 않았다. 이 테스트의 성공이 실제 Tavily 운영 요청의 성공을 의미하지 않는다.

## 운영 설정과 진단

기존 진단의 `searchConfigured:true`는 당시 `TAVILY_API_KEY`가 비어 있지 않았다는 기록이다. 현재 키의 유효성·잔여 사용량까지 보장하지 않는다. Production의 기존 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `TAVILY_API_KEY`를 사용하며 새 브라우저 토큰은 필요하지 않다. 키 값은 응답·클라이언트·문서에 넣지 않는다.

`GET /api/encar-id`는 검색 키의 존재 여부만 `{ok,configured,provider,release}`로 반환한다. Auth·검색·원문 추출·차량 조회를 하지 않고 키 값이나 계정 자료를 노출하지 않는다. `POST`는 동일 출처·실제 Auth 사용자·활성 멤버십을 확인한 뒤 `{plate}`만 처리한다. 설정 누락·검색 인증·검색 한도·검색 실패·검색 결과 없음은 구분한다.

한 출처의 Search/Extract 전체 8초, 응답 512 KiB, 검색 결과 최대 6개, 원문 추출 최대 한 번으로 제한한다. 공통 인증·한도 실패에서는 다른 출처로 같은 API 요청을 반복하지 않는다. 로그인 검증을 포함한 전체 API 기한은 45초다. 광고 팝업은 ID와 확인 버튼을 유지하며 가격/OCR·차량/광고 저장·DB 변경은 없다.

## 검증

검증 명령은 `tests/encar/README.md`에 정리한다. 신규 순차 함수·검색 전송·원문 판독과 실제 Pages/workerd 기본 API를 합성 응답으로 검증한다. 인증/검색 키 분리, `66너7230` 사례, 첫 결과 중단, 한도/인증 실패 중단, 원문 추출, 추천 차량 제외와 저장·브라우저 호출 0을 확인한다.

현재 실행환경은 실제 공급자와 검색 API에 접속할 수 없으므로 운영 Tavily 키의 인증·실제 검색 성공률은 직접 검증하지 못했다. 로컬 산출물은 `/workspace/work/encar-id-v2147`에 보관한다.

## 공식 자료

- [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Tavily Extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract)
- [차량번호·광고 ID 확인 출처](https://encar.spb.ru/auto/43138217/)
