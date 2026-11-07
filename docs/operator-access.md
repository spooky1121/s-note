# 운영자 접속 기록

운영자 콘솔의 접속 관리는 Supabase Auth가 확인한 세션과 브라우저 활동 관측을 구분한다. 운영자 권한과 공용 계정의 접속 기록은 같은 권한이 아니다. 일반 로그인 계정은 본인 세션의 활동 시각만 갱신하고, 전체 목록 조회는 승인된 운영자만 할 수 있다.

## 적용 순서

1. [운영자 핵심 마이그레이션](../supabase/migrations/20261107013019_platform_operator_console.sql)
2. [접속 기록 마이그레이션](../supabase/migrations/20261107013521_platform_operator_access.sql)

두 번째 파일은 Supabase CLI `migration new platform_operator_access`로 생성했다. 접속 기록은 `snote_operator_private.access_sessions`에 보관하며 테이블 직접 접근 권한은 없다. RLS는 활성화하고 정책은 만들지 않아 기본 거절로 유지한다. 공개 RPC는 security-invoker이고, 내부 확인 함수만 빈 search path의 security-definer로 실행한다. 익명·서비스 역할에는 두 RPC를 허용하지 않는다.

## 기록과 표시

- `snote_access_ping()`는 인수를 받지 않는다. 실제 `auth.uid()`와 JWT의 `session_id`를 핵심 마이그레이션의 `verified_session`으로 대조한다. 만료·삭제·차단·보관된 계정과 실제로 존재하지 않는 세션은 거절한다.
- IP·사용자 에이전트·로그인 시각은 `auth.sessions`에서 가져온다. 클라이언트가 보내는 IP나 다른 사용자 ID는 받지 않는다. 첫 관측 당시 이름·이메일·상사도 함께 보존한다.
- `first_seen`과 `last_seen`은 서버 시각이다. 같은 세션의 반복 호출은 마지막 시각만 단조 증가시키며 다른 세션의 행을 수정하지 않는다.
- 활동 관측 기간은 마지막 관측 시각에서 첫 관측 시각을 뺀 값이다. `active`는 실제 Auth 세션이 유효하고 마지막 관측이 120초 이내일 때만 참이다. 세션이 유효한 채 관측이 멈추면 `idle`, 실제 세션이 없거나 무효면 `ended`로 구분한다. 브라우저 종료나 잠든 기기의 정확한 로그아웃 시각이라고 주장하지 않는다.
- 아직 활동 관측이 없는 과거 Auth 세션은 `durationType: auth_session`, `durationSeconds: null`, `lastSeen: null`로 표시한다. 토큰 갱신 시각을 웹페이지 활동이나 체류 시간으로 바꾸지 않는다.
- Auth 감사표에 남은 로그인·로그아웃 이벤트는 `durationType: audit_event`로 보존한다. 기존 세션과 5초 이내에 일치하는 로그인 이벤트는 중복 표시하지 않는다. 원래 세션 ID와 기간을 모르면 `null`로 남긴다. 감사표에 없는 과거 기록을 복원하거나 만들어 내지 않는다.
- 활동 관측 행은 Auth 사용자·세션에 외래키로 연결하지 않는다. 계정·세션이 나중에 삭제돼도 관측 당시 기록은 남는다. 세션이 폐기되면 이전 행의 `active`는 거짓이며 이전 JWT로 새 ping을 저장할 수 없다.

## RPC 계약

`public.snote_access_ping()`:

```json
{"ok":true,"sessionId":"<actual session UUID>","firstSeen":"<server timestamp>","lastSeen":"<server timestamp>"}
```

`public.snote_operator_access_list(p_query jsonb default '{}')`는 핵심 마이그레이션의 엄격한 운영자 검사로 보호한다. 검색은 이메일·이름·상사·IP·사용자 에이전트에 적용하고, 회사/사용자 UUID 필터도 지원한다. 페이지는 항상 20행이다. `query`, `page`, `sort`, `direction`, `status`, `companyId`, `ownerId` 외 필드는 거절한다.

정렬: `loginAt`, `lastSeen`, `durationSeconds`, `email`, `displayName`. 상태: `all`, `active`, `ended`와 기존 일반 목록을 위한 `archived` 별칭. `ended`/`archived` 필터는 활동 관측 기록이 있고 실제 Auth 세션이 종료되거나 무효인 `ended` 행만 포함한다. 세션이 유효한 `idle` 행과 기간을 모르는 `unknown` 이력은 전체 목록에서 확인한다.

목록 행은 `recordId`, `sessionId`, `userId`, `email`, `displayName`, `companyId`, `companyName`, `loginAt`, `loginIp`, `firstSeen`, `lastSeen`, `durationSeconds`, `durationType`, `eventType`, `active`, `sessionValid`, `status`, `userAgent`, `device`를 반환한다. `recordId`는 감사 이벤트와 세션을 구분하는 안정적인 화면 키다. 과거 감사 이벤트의 `sessionId`는 `null`일 수 있다. `durationSeconds: null`은 화면에서 `—`로 표시하고, 관측 기간은 약 n분으로 표시한다.

응답은 `{items,total,page,pageSize:20,observedDurationOnly:true,activityWindowSeconds:120}`다. 정렬값은 SQL 허용목록으로 매핑하고 검색값은 바인딩한다. 제한·오프셋은 JSON 직렬화 전에 적용한다.

## 검증

```sh
NODE_PATH=/workspace/work/deps/node_modules node tests/operator-access.sql.cjs
```

실제 핵심 권한 함수와 접속 마이그레이션을 격리 PostgreSQL에서 실행하는 7개 검증 묶음이다. 본인 세션/IP, 익명·일반 관리자·폐기 세션 거절, RLS/직접 테이블 권한, 관측/미관측 기간 구분, 세션 삭제 후 기록 보존, 감사 이벤트 중복 제거, IP 형식 검증, 검색·정렬 주입 방어, 20개 페이지 분할을 확인한다. 운영 DB나 외부 Auth 서비스는 수정하지 않는다.

참고: [Supabase Auth 세션](https://supabase.com/docs/guides/auth/sessions), [DB 함수 권한](https://supabase.com/docs/guides/database/functions). 접속 IP는 Auth가 기록한 IP이며 VPN·프록시 환경에서 실제 단말의 물리 위치를 보장하지 않는다.
