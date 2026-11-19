# 검색 브라우저 사용 제한 처리 v2.151

S-NOTE의 `/api/encar-id` 정책은 이미 `limit: null`이다. 자체 분당 검색 제한을 추가하거나 제거할 항목은 없다. 기존 `UPSTREAM_RATE_LIMITED` 안내는 Cloudflare Browser Run의 생성/접속 요청이 HTTP 429를 반환할 때 발생한다.

## 수정

- Cloudflare 응답 본문을 최대 4 KiB·500ms만 읽고 공식 문구 `Browser time limit exceeded for today`가 확인된 429만 `BROWSER_DAILY_LIMIT`로 구분한다. 그 밖의 429는 원인이 확정되지 않은 Cloudflare 요청 제한으로 유지하고 사용량·요금제를 안내한다. 공급자 원문·키는 응답에 노출하지 않는다.
- 하루 한도에 ‘잠시 후 재시도’를 안내하지 않는다. 하루 한도의 Retry-After는 다음 UTC 날짜보다 짧지 않게 하고, 공급자가 더 긴 대기를 요구하면 존중한다. 이는 응답 안내이며 S-NOTE에 별도 대기 제한을 부과하지 않는다.
- 실제 Cache API 저장이 느린 경우 전체 저장 Promise를 요청의 `waitUntil`로 유지한다. 전경 캐시 I/O 기한은 250→750ms로 조정하되, 브라우저 유지 30초·메타데이터 만료 25초는 유지한다. 늦은 저장이 세션 만료를 연장하지 않는다.
- 계정 간 세션 대여, 무차별 재시도, 토큰 교체, 서비스 제한 우회는 없다. 요금제·결제 설정도 변경하지 않는다. ID 팝업과 수동 엔카 링크를 유지한다.

캐시와 생성 요청 중복 억제는 지역/실행 인스턴스 단위이므로 모든 지역에서 브라우저 재사용을 보장하지 않는다. 이 보완은 불필요한 재실행을 줄일 수 있지만 실제 Cloudflare 한도를 없애지는 않는다.

## 확인된 공급자 정책과 미확인 사항

공식 문서 기준 Workers Free는 하루 10분, 동시 브라우저 3개, 신규 생성 20초당 1개다. 일일 한도는 다음 UTC 날짜에 초기화된다(한국 시간 오전 9시). Paid의 브라우저 시간에는 해당 일일 하드캡이 없지만 사용량 과금과 생성/동시 실행 제한은 존재한다. 브라우저가 대기 중인 시간도 사용량에 포함되므로 `keep_alive`를 늘려 해결하지 않는다.

현재 운영 계정의 요금제·사용량·실제 429 본문은 연결 도구로 확인할 수 없다. 기존 일반 문구만으로 일일 한도 소진을 단정하지 않는다. 새 오류 분류와 Cloudflare 대시보드에서 구분해야 한다.

- [공식 제한](https://developers.cloudflare.com/browser-run/limits/)
- [공식 일일 한도 오류 설명](https://developers.cloudflare.com/browser-run/faq/)
- [과금](https://developers.cloudflare.com/browser-run/pricing/)
- [Workers 요금제](https://dash.cloudflare.com/?to=/:account/workers/plans)
- [Browser Run 사용량](https://dash.cloudflare.com/?to=/:account/workers/browser-run)

검증은 합성 응답의 일반/일일 429 구분, 짧은 Retry-After 보정, 느린 캐시 저장·만료·요청 종료, 생성/접속의 추가 재시도 없음, 실제 컴파일된 Workers와 PC·모바일 오류 표시를 포함한다. 운영 한도 해제나 실사용량 검증을 뜻하지 않는다.
