# 고객 문자 입력의 인수증 확인 항목 v2.160

새 고객 입력 화면은 기존 인증·서명 위저드의 `customer.receiptDetails`에 인수증 항목을 함께 전송한다. 일반 개인정보 수집 동의(`body.consent`)와 독립된 고객의 선택이며 기존 고객에게 새 동의를 추정하거나 소급 적용하지 않는다.

```json
{
  "children": "two",
  "business": "cash",
  "privacyConsent": true,
  "insuranceConfirmed": true,
  "delegationConfirmed": true,
  "cashConfirmed": true,
  "consentVersion": "receipt-v1"
}
```

- `children`: `null`, `none`, `two`, `three`. `business`: `null`, `invoice`, `cash`.
- 모든 키가 필요하며 네 동의·확인 값은 엄격한 boolean이다. 미선택은 `null` 또는 `false`로 보관하고 일반 동의 값으로 채우지 않는다. `privacyConsent:false`는 체크하지 않았다는 뜻이며 인수증의 ‘동의하지 않음’을 선택했다는 뜻은 아니다.
- 원본 서명·확인 항목은 동일한 제출 시각·접수 원본에 연결한다. 다른 고객이나 다른 접수의 서명을 가져와 새 선택을 확인한 것으로 표시하지 않는다.

## 저장과 호환

`20261120152546_customer_intake_receipt_details.sql`은 `snote_intake_private.receipt_details(jsonb)`와 `public.snote_intake_submit_v4`를 추가한다. 새 테이블·컬럼은 없으며 마이그레이션 실행으로 기존 고객 행의 동의 값을 채우지 않는다. `v4`는 기존 `v3`의 담당 차량·활성 직원·유효 링크·휴대전화 인증 세션·서명·암호화 식별번호 검증을 그대로 호출하고, 같은 트랜잭션에서 원본 접수와 새로 생성한 고객 레코드에 확인 항목을 보관한다. 기존 고객 레코드가 있으면 덮어쓰지 않고 접수 원본에만 저장한다. 딜러가 해당 접수를 선택해 가져오는 경우에만 화면의 선택 원본을 변경한다.

`v4` 실행은 `service_role`만 허용하며 브라우저·일반 인증 계정이 직접 호출할 수 없다. private helper에도 PUBLIC·anon·authenticated·service_role EXECUTE를 허용하지 않는다. 공개 API는 기존 토큰/OTP 검증과 서버 자격증명을 유지한다. 기존 `receiptDetails` 없는 위저드 요청은 `v3`로 처리하므로 열린 구버전 화면과 기존 링크를 유지한다. 새 항목이 있는데 `v4`가 없으면 필드를 버려 저장하지 않고 설정 오류로 종료한다.

완료된 접수는 변경하지 않는다. 같은 인수증 항목의 재시도는 기존 완료 결과를 읽으며, 값이 달라지거나 기존 v3 제출에 나중에 동의를 붙이려는 시도는 거절한다. 새 고객 레코드와 원본 접수 중 하나의 저장이 실패하면 전체 제출을 롤백한다. 목록 API는 서명·시각·위저드 버전과 엄격하게 검증한 항목만 노출하고 암호문·서버 문맥을 숨긴다.

## 화면과 고객 저장

견적서는 보증보험료를 0으로 시작하고, 차량 정보·항목별 비용·입금 안내를 카드로 분리한다. 입금 계좌 정보 아래에 금액을 표시하며, 지정 차량의 담당 딜러명을 사용한다. 출력 서류는 왼쪽 S-NOTE와 오른쪽 현재 상사 로고·명칭을 통일하고, 인수증의 기본 인수 시각은 열 때의 한국 시각으로 입력한다. 판매 진행의 주소는 내용에 따라 높이를 조절하되 최대 180px 이후 스크롤을 제공한다.

판매 화면은 고객이 제출한 인수증 정보를 읽기 전용으로 보여준다. 선택한 원본의 서명·접수 시각·인수증 항목을 한 묶음으로 저장하며, 저장 대기 중 창 닫기·초기화·다른 접수 선택으로 원본이 달라지면 저장 요청 전에 거절한다. 일반 수정에서 명시한 `receiptDetails:null`은 기존 확인 항목을 지우며, 주민번호만 변경하는 저장은 기존 항목을 유지한다. 기존 부분 저장이 원본 필드를 생략한 경우 원본 메타데이터를 임의로 바꾸지 않는다.

## 검증

- `node --test --test-isolation=none tests/customer-intake.test.mjs`: 45개 통과. 새 원자적 경로, 잘못된 필드/형식, 미선택 보존, SQL 누락 시 fail-closed, 기존 요청 호환과 목록 정제를 포함한다.
- `NODE_PATH=/workspace/work/deps/node_modules node tests/customer-intake-receipt.sql.cjs`: 실제 마이그레이션과 로컬 PGlite로 9개 시나리오 통과. 권한, 정상 저장, 미선택, SQL 독립 검증, 동일 재시도, 과거 접수 소급 방지, 두 번째 제출, 무효 세션/비활성 직원, 실패 롤백을 확인한다.
- `node --test --test-isolation=none tests/customer-receipt-save-race.test.mjs`: 실제 고객 저장 함수를 실행해 원본 선택·닫기·초기화·동일 이름의 다른 접수·식별번호만 변경·일반 부분 저장 등 14개 시나리오를 확인한다.
- `NODE_PATH=/workspace/work/deps/node_modules CHROMIUM_PATH=/usr/bin/chromium node tests/customer-intake-wizard.cjs`: 기존 SQL 26개와 실제 390·320px 공개 위저드 → Pages API → 원자적 DB 저장 → 딜러 가져오기 → 인수증 항목 표시가 통과했다. 마스터 체크의 전체 선택·해제, 미선택 보존, 다른 접수 선택 및 같은 이름의 두 번째 원본과 확인 항목 교체, 원본 서명과 A4 계약서 2부 출력도 확인했다. 은행 기능의 독립 검증과 구분하여 이 위저드 fixture는 인증한 합성 딜러의 정상적인 빈 계좌 읽기만 제공한다.
- 테스트는 합성 계정·고객·차량만 사용하며 운영 DB 쓰기나 실제 문자 발송을 하지 않는다. 단일 PGlite 연결이므로 다중 세션의 동시 잠금 자체를 검증하는 검사는 아니다.

구현 전 2026-11-21 기준 Supabase changelog와 Database Functions/RLS 공식 문서를 확인했다. 최근 CLI v3의 로컬 기본 대상/호스팅 확인 변경을 반영하여 기존 캐시 CLI의 도움말을 확인한 뒤 `migration new`로 로컬 파일만 생성했다. 이번 변경은 새 인증·RLS 우회나 client library 업그레이드를 추가하지 않는다.
