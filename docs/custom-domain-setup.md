# S-NOTE 도메인 연결: s-note.kr

대상 도메인은 가비아에서 구매한 `s-note.kr`이며, 연결 대상은 기존 Cloudflare Pages `s-note` 프로젝트다. 기존 Supabase 프로젝트와 차량·고객·사진 자료를 그대로 사용한다. 도메인 구매·DNS 연결은 새 웹호스팅 구매와 별개다.

## 1. Cloudflare에 기존 도메인 추가

1. `s-note` Pages 프로젝트를 운영하는 같은 Cloudflare 계정으로 로그인한다.
2. **Domains → Overview → Add domain / Onboard a domain**으로 이동한다. **Registrations → Register domain**은 새 도메인 구매 메뉴이므로 이 작업과 다르다.
3. `www` 없이 `s-note.kr`을 입력하고 **Free** 요금제를 선택한다.
4. 이 도메인에 실제 할당된 `*.ns.cloudflare.com` 네임서버 **2개**를 복사한다. 예시 주소나 다른 도메인의 주소를 대신 사용하지 않는다.

2026-11-08 사용자 Cloudflare 화면에서 확인한 `s-note.kr` 할당값은 다음과 같다. 향후 계정·구성이 바뀌면 해당 화면의 현재 값을 다시 확인한다.

```text
brady.ns.cloudflare.com
izabella.ns.cloudflare.com
```

공식 문서: [Cloudflare DNS 전체 설정](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)

## 2. 가비아에서 네임서버 변경

**My가비아 → 서비스 관리 → 도메인 통합 관리툴 → 전체 도메인 → s-note.kr 선택 → 네임서버**에서 기존 네임서버를 위에서 발급받은 2개로 교체한다. 소유자 이메일 또는 휴대폰으로 인증한 뒤 적용한다. 전파에는 최대 48시간이 걸릴 수 있다.

공식 문서: [가비아 네임서버 관리](https://customer.gabia.com/faq/detail/286/26000)

## 3. Pages와 HTTPS 연결

Cloudflare 도메인이 **Active**가 되면 **Workers & Pages → s-note → Custom domains → Set up a domain**에서 `s-note.kr`을 추가한다. `www.s-note.kr`도 사용할 경우 같은 절차로 추가한다. 새로 구매한 도메인의 주차용 DNS 레코드가 충돌하면 Pages 안내에 따라 해당 웹 레코드를 교체한다. 다른 용도의 메일·검증 레코드가 있다면 보존한다.

Pages의 도메인 연결과 인증서가 활성화된 뒤 각 HTTPS 주소를 열어 실제 최신 S-NOTE가 표시되는지 확인한다. DNS에 CNAME만 수동 추가하고 Pages 연결 절차를 생략하지 않는다. 기존 `s-note.pages.dev`는 전환 기간 동안 유지한다.

공식 문서: [Pages 사용자 지정 도메인](https://developers.cloudflare.com/pages/configuration/custom-domains/)

## 4. 이메일 인증 리다이렉트

기존 Supabase 프로젝트의 **Authentication → URL Configuration → Redirect URLs**에 기존 허용 항목을 유지하면서 다음 정확한 주소를 추가한다. 현재 가입 코드는 접속한 `location.origin + location.pathname`을 `emailRedirectTo`로 사용한다.

```text
https://s-note.kr/
https://s-note.kr/index.html
https://www.s-note.kr/
https://www.s-note.kr/index.html
```

기존 주소로 가입한 사용자의 확인 메일을 위해 `https://s-note.pages.dev/` 및 실제 사용하는 기존 경로도 유지한다. **Site URL**은 새 도메인의 HTTPS/Pages/이메일 인증 확인 후 `https://s-note.kr`로 전환한다. 설정을 읽거나 저장할 수 없는 상태에서 적용되었다고 보고하지 않는다.

공식 문서: [Supabase 인증 리다이렉트](https://supabase.com/docs/guides/auth/redirect-urls)

## 5. 고객 문자 링크

`CUSTOMER_INTAKE_PUBLIC_ORIGIN`은 Cloudflare **s-note → Settings → Variables and Secrets → Production**에 설정하는 운영 HTTPS origin이다. 이 값은 계속 유효해야 하며 누락·오류를 허용 목록으로 우회하지 않는다.

해당 값이 정확히 `https://s-note.pages.dev`, `https://s-note.kr`, `https://www.s-note.kr` 중 하나일 때만 이 세 운영 주소가 서로 호환된다. 브라우저 요청은 여전히 실제 요청 URL과 Origin이 같아야 하며 외부·비슷한 철자·임의 포트·HTTP 주소는 추가 허용하지 않는다. 문자·복사용 링크는 검증된 현재 운영 접속 주소로 만든다. 프런트의 링크 origin 검증은 그대로 유지한다. 그 외 배포 주소는 기존 단일 운영 주소 정책을 유지한다.

DNS 연결 직후에는 기존 변수 값을 유지하면서 양쪽 도메인을 검증할 수 있다. 새 주소가 안정화되면 `CUSTOMER_INTAKE_PUBLIC_ORIGIN=https://s-note.kr`로 정리하고 재배포한다. 암호화 키·문자 인증용 Secret은 도메인 변경 때문에 교체하지 않는다.

각 주소에서 `/api/customer-intake`의 `configured`, `originMatches`와 실제 판매 진행의 정보 요청·링크 복사를 확인한다. 이 진단 응답만으로 실제 문자 전송·DB 저장이 검증되지는 않는다. 실전 문자 시험은 운영자가 관리하는 시험 번호로 진행한다.

## 6. 전환 시 자료와 로그인

새 주소에서는 다시 로그인한다. 로그인 세션·브라우저 캐시·미확정 저장 복구 표식은 서로 다른 origin 간 공유되지 않는다. 기존 주소의 미저장 변경은 먼저 서버 저장을 확인한다. 이전 주소를 일괄 강제 리다이렉트하여 남아 있는 복구 캐시에 접근할 수 없게 하지 않는다.

현재 로그인한 계정으로 차량·고객·사진 목록을 확인하고, 가입 이메일 인증·고객 정보 요청·계약서/인수증·공유 링크를 점검한 뒤 주 사용 주소를 전환한다. 서버 자료의 복사·이동이나 DB 재생성은 필요하지 않다.
