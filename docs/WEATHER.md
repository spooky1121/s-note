# 상단 날씨

`GET /api/weather`는 Cloudflare의 접속 지역 좌표를 0.1도 단위로 반올림해 MET Norway Locationforecast compact API를 조회한다. 브라우저 GPS 권한, 외부 날씨 API 키, 고객 데이터 전송은 필요하지 않다. IP 지역은 사용자의 실제 현재 위치와 다를 수 있으며 표시값은 해당 지역의 가장 가까운 시간대 예보다.

- 출처: [MET Norway](https://www.met.no/en), [API](https://api.met.no/weatherapi/locationforecast/2.0/documentation), [이용 지침](https://api.met.no/doc/TermsOfService).
- 서버 요청은 S-NOTE 앱과 사이트 URL을 User-Agent에 명시한다. 화면 날씨는 출처 링크와 접속 지역 기준 예보임을 안내한다.
- 좌표별 내부 캐시는 10분, 브라우저 갱신은 10분이다. 사용자별 지역이 일반 공유 HTTP 캐시에 섞이지 않게 API 응답은 no-store로 반환한다.
- 현재와 3시간 이상 차이나는 데이터, 잘못된 온도/코드, 연결 실패에는 온도를 만들지 않고 `—°`와 조회 불가 안내를 표시한다.
- 실행 환경은 MET Norway 직접 네트워크 접근이 허용되어 있지 않아 테스트는 합성 응답으로 진행했다. 실제 서비스는 Cloudflare Functions의 외부 HTTPS 연결을 사용한다.
