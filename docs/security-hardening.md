# S-NOTE API 보안 보강과 운영 점검

이 변경은 애플리케이션 코드의 방어 계층을 추가합니다. 보안 설정을 자동으로 변경하거나 대규모 DDoS 차단을 보장하지 않습니다. 운영 데이터·계정·키·권한·Cloudflare 설정은 변경하지 않았습니다.

## 코드에 추가한 보호

- `functions/api/_middleware.js`: 기존 10개 API에 공통 검사를 적용합니다. 다른 Origin 및 다른 사이트/하위 도메인의 브라우저 요청, 지원하지 않는 메서드·인코딩·콘텐츠 형식, 잘못된 인증 헤더와 선언된 초과 본문을 처리 전에 거절합니다. Origin 헤더가 없는 비브라우저 요청은 기존 인증·권한 검사를 계속 통과해야 합니다. Origin 검사는 인증 수단이 아닙니다.
- API 응답에 `no-store`, `nosniff`, 프레임 차단, 외부 출처 읽기 제한, 제한적인 CSP를 일관되게 적용합니다. 예외의 상세 오류·스택·키를 응답하지 않습니다.
- OCR은 실제 수신 바이트를 세어 6 MiB에서 중단합니다. Content-Length가 없거나 거짓으로 작아도 적용됩니다. 느린 업로드는 55초, 전체 공급자 처리는 58초로 제한하여 기존 브라우저의 60초 제한을 유지합니다. 업로드·인증·OCR 공급자 응답의 크기를 제한하고, 인증 키를 가진 요청이 리디렉션을 따라가지 않도록 합니다.
- 운영자 API 본문은 기존 1 MiB 한도를 유지하고 수신 시간 제한을 추가합니다. 기존 운영자 허용 목록·활성 세션·테넌트 권한 검사를 변경하지 않습니다.
- 정적 페이지에는 외부 프레임 삽입, object/embed 및 외부 base 변경을 제한하는 CSP를 추가합니다. 운영자 페이지는 외부 스크립트와 연결 대상을 필요한 CDN/Supabase로 좁힙니다. 고객·주소검색·월정산·소득정산 페이지의 더 엄격한 정책은 유지합니다.
- `index.html`의 저장 로직과 화면 코드는 수정하지 않습니다. 메인 화면은 기존 인라인 스크립트/이벤트를 사용하므로 아직 엄격한 script-src 기반 XSS 차단을 적용하지 않습니다. 이번 CSP만으로 XSS가 해결된 것은 아닙니다.

## 짧은 시간의 반복 요청 제한

Cloudflare가 제공하는 `CF-Connecting-IP`와 API 경로를 기준으로, 실행 인스턴스 내부에서 60초 동안 아래 횟수를 초과하면 429와 `Retry-After`를 반환합니다. 쿼리 문자열이나 JWT만 바꿔서 같은 인스턴스의 카운터를 초기화할 수 없습니다.

| API | 60초당 IP/경로 한도 |
| --- | ---: |
| OCR, 차량 분류 조회 | 30 |
| 엔카, 날씨, 프로필 휴대전화, 서류 MMS | 60 |
| 고객 입력 | 120 |
| 고객 신원정보, 소득정산, 운영자 | 240 |

이 한도는 회사 공유 IP 이용을 고려한 **보조 방어**입니다. 실행 인스턴스 교체·여러 데이터센터·회전 IP는 카운터를 공유하지 않습니다. `CF-Connecting-IP`가 없는 로컬 환경이나 해당 헤더가 제거된 구성에서는 횟수 제한을 건너뛰며, `X-Forwarded-For`로 대신 신뢰하지 않습니다. 인증·본문 제한은 계속 적용됩니다.

카운터는 최대 4,096개만 유지하고 만료 항목을 정리합니다. 가득 차면 오래된 항목을 교체하여 신규 정상 사용자를 일괄 차단하지 않습니다. 따라서 분산 공격, 전역 비용 한도, 계정별 지속적인 제한을 이 코드로 해결했다고 볼 수 없습니다. 운영 트래픽과 공유 IP 규모를 보고 한도를 조정해야 합니다. 고객 문자/MMS의 기존 DB 횟수 제한과 중복 전송 방지는 그대로 유지합니다.

## 운영 점검 원칙

운영의 계정·테이블·버킷별 보안 점검 결과와 설정 상태는 공개 소스에 기록하지 않습니다. 운영 담당자는 비공개 기록에서 RLS, 익명 접근, 직원·상사 범위, 비공개 Storage, 고정 search_path와 함수 권한, 인증 보강 설정을 확인해야 합니다.

정책에서 사용자 수정 가능한 user_metadata를 권한의 근거로 사용하지 않는지 확인하고, 기존 RLS가 호출하는 보조 함수의 권한을 일괄 제거하지 않습니다. 코드 검사와 합성 테스트는 전체 침투 시험이나 모든 권한 경로의 안전성을 보증하지 않습니다.

## 별도 운영 승인과 설정이 필요한 부분

1. Cloudflare의 실제 요금제·도메인 구성을 확인하고 WAF/속도 제한/봇 방어를 적용합니다. 일반 JSON API에 HTML CAPTCHA 응답을 강제하면 정상 기능이 깨질 수 있으므로 API에는 적절한 차단/429 방식을 검토합니다. 공유 IP를 고려한 관찰 기간과 예외 처리도 필요합니다.
2. 사용자 소유 도메인에 규칙을 적용하더라도 `pages.dev` 대체 경로로 우회되지 않는지 확인합니다. 공개 주소나 접근 권한을 임의로 바꾸지 않습니다.
3. 브라우저가 직접 사용하는 Supabase Auth/REST/Storage는 Pages API 미들웨어 밖입니다. Supabase 인증 속도 제한, 유출 비밀번호 보호, 필요한 CAPTCHA/MFA, DB/RPC의 계정별 한도를 별도로 검토합니다. RLS는 데이터 접근 권한이며 트래픽 비용 제한은 아닙니다.
4. Google Vision, 문자/MMS 및 외부 조회 공급자의 비용 한도와 경보를 설정하고, 필요하면 인증 완료된 사용자 기준의 영속적 서버 할당량을 추가합니다.
5. 실제 배포 후 루트/운영자/고객/팝업 헤더, 로그인, 서류 업로드, API의 429 복구 동작을 확인합니다. 과도한 부하를 주는 운영 시험은 별도 계획 없이 실행하지 않습니다.

## 검증 명령

외부 도구는 저장소에 설치하지 않고 별도 테스트 디렉터리의 고정 버전 의존성을 사용합니다. 모든 API 테스트의 외부 통신은 합성 응답이며 SQL 통합 테스트는 로컬 PGlite입니다.

- `node --test tests/api-security.test.mjs tests/ocr-security.test.mjs`
- `NODE_PATH=/path/to/test-tools/node_modules node --test tests/*.test.mjs`
- 기존 일부 인쇄 테스트는 `tests/encar/node_modules/jsdom` 경로를 요구하므로 테스트 실행 시만 해당 로컬 의존성 경로를 준비합니다.
- `wrangler pages functions build functions --outdir /tmp/snote-security-bundle --output-routes-path /tmp/snote-security-routes.json --compatibility-date 2026-11-01`
- `NODE_PATH=/path/to/test-tools/node_modules node tests/api-security.workerd.cjs /tmp/snote-security-bundle/index.js`

Wrangler가 생성한 경로가 `/api/*`뿐인지 확인합니다. 정적 파일은 API 미들웨어를 거치지 않아 캐시를 유지합니다. 실제 workerd 검증은 정적 파일 분리, Pages 라우팅, 출처 차단, 정상 OCR, 공급자 호출 전 초과 요청 거절, 반복 호출 429, 응답 헤더를 확인합니다.

## 참고 자료

- [Cloudflare Pages 응답 헤더](https://developers.cloudflare.com/pages/configuration/headers/): `_headers`는 정적 응답에 적용되며 Functions 응답에는 코드에서 헤더를 추가해야 합니다.
- [Cloudflare Pages 미들웨어](https://developers.cloudflare.com/pages/functions/middleware/)
- [Cloudflare 속도 제한 규칙](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Supabase API 보호](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase 비밀번호 보호](https://supabase.com/docs/guides/auth/password-security)

### 이번 변경의 검증 결과

- 최종 단위/회귀/합성 SQL 통합 테스트: 357개 통과, 실패·생략 없음.
- Wrangler 4.158.0 Pages Functions 빌드와 실제 workerd 라우터 검증 통과.
- Wrangler의 실제 정적 자산 처리기로 헤더 규칙 8개를 파싱하고, HTML 경로 6개의 공통/개별 CSP 병합 및 nosniff 적용 확인.
- 변경 함수 JavaScript 구문 검사와 `git diff --check` 통과.
- 브라우저 화면/정상 로그인 시나리오는 이번 실행 환경에서 검증하지 못함. Chromium이 로컬 소켓을 생성하지 못하는 환경 제한으로 시작에 실패했으며, 애플리케이션 오류로 판정하지 않음. 배포 후 화면 검증을 완료한 것으로 간주하지 않음.
