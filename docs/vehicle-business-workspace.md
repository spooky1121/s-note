# 차량별 통합 업무 원장

기준 버전은 v2.180, 기준 커밋은 `7c21e340ad3ccaa0c4282cb304d99a4f62a5b80f`이다. 이번 작업은 차량 내부 ID에 거래·자금·금융·서류·고객 후속 업무를 연결한다. 운영 고객·차량을 시험 자료로 수정하거나 문자를 발송하지 않는다.

## 현재 구현 점검

| 기능 | 판정 | 현재 근거와 보완 |
| --- | --- | --- |
| 차량 등록·수정 | 충족 | `index.html`, `purchase-registration.js`, `SnoteMoney`의 원 단위 런타임, 기존 필수 입력 유지 |
| 매입·판매·취소·재판매 | 보완 필요 | 판매 ACK·취소는 존재. 같은 차량 ID의 거래 cycle과 취소 사유·과거 금융 사실은 신규 원장에 보존 |
| 비용·수익·정산 | 보완 필요 | `totals()`와 소득정산 양식 존재. 발생 비용과 지급을 분리하고 관리손익과 세무용 소득정산을 구분 |
| 재고금융 | 보완 필요 | 기존 단일 원금·금리 및 판매일 종료 계산을 신규 실행·상환·금리 사건으로 보완 |
| 실제 입출금·미수·미지급 | 신규 필요 | 계약서의 계약금·잔금 기입값과 월정산 메모는 실제 입금 확인이 아님 |
| 고객·상담·출고 | 보완 필요 | 기존 판매고객은 owner/car별 1건. 여러 문의·다음 행동은 기존 고객을 덮어쓰지 않는 별도 기록 |
| 문서·OCR·인쇄 | 충족/보완 필요 | 비공개 media·등록증 OCR·A4 양식 재사용. 첨부와 내용 확인·명의이전 상태는 별개 |
| 광고·재고·상품화 | 보완 필요 | 엔카 링크·가격·매입 경과일 존재. 입고·광고 시작·상품화·문의 추적을 구분 |
| 매입 판단 | 신규 필요 | 비교 자료·확인일·예상 비용·목표 이익·여유 금액을 저장하여 상한가 계산 |
| 권한 | 충족/추가 검증 필요 | 회사·owner 범위와 공유 권한 존재. 신규 재무·CRM은 기존 공유 권한으로 자동 개방하지 않음 |
| 대시보드·오늘 업무 | 보완 필요 | 기존 업무는 90일 재고만. 별도 lazy 원장에서 원본 상태를 파생 |
| 로그인·초기 조회 | 보완 필요 | 신규 자료는 `zc_datasets`에 추가하지 않아 전체 payload 초기 조회를 늘리지 않음 |
| 배포·백업 | 배포 충족/운영 복구 확인 불가 | Pages Git 배포·격리 테스트 존재. 중단된 외부 백업·예약·외부 연동을 활성화하지 않음 |

## 저장과 권한

- 기존 `zc_datasets` cars/covers·`zc_customers`·`zc_media`·서류함은 유지한다.
- 신규 private schema는 차량별 scope/revision, 별도 cycle, typed entries, 요청 중복방지, append-only audit, 사용자 운영 기준을 저장한다.
- 기준 키는 `companyId + ownerId(UUID) + carId(기존 내부 ID) + cycleId(UUID)`이다. 차량번호는 표시·검색 값이며 저장 FK로 쓰지 않는다.
- 소유 딜러는 자기 원장을 관리한다. 관리자·경리는 소속 상사의 재무·서류·운영 업무 범위로 접근한다. 신규 CRM 명세는 실제 차량 owner만 읽고 쓴다. 공유 상대에게 재무·고객 권한을 자동 부여하지 않는다.
- public RPC는 authenticated 전용 INVOKER wrapper다. private 함수는 실제 회원·회사·차량 단일 owner를 재검사하며 `search_path=''`, RLS 및 명시적인 ACL을 사용한다.
- 마이그레이션은 CLI가 생성한 `20261121171218_vehicle_business_workspace.sql`이다. 운영 적용 전 격리 SQL 검증과 변경 검토를 한다.

## 공통 wire

```js
workspace = {
  apiVersion: 1, companyId, ownerId, carId, revision,
  cycles: [{id, sequence, status, details, createdAt, updatedAt}],
  entries: [{id, cycleId, kind, status, amountWon, effectiveDate, dueDate,
             details, createdAt, updatedAt}],
  audit: [], capabilities: {canWrite, customerRead, customerWrite}
};
```

금액은 `amountWon` 원 정수 또는 null이다. 누락을 0원으로 바꾸지 않는다. 날짜는 ISO 한국 날짜 또는 null이며 실제 기록시각은 서버 timestamptz다. 기존 car DB wire의 만원 값은 `SnoteMoney.car()`를 한 번만 통과시키고 신규 원장에 재사용하지 않는다.

RPC:

- `snote_business_vehicle_read(p_company,p_owner,p_car_id)`
- `snote_business_vehicle_write(p_company,p_owner,p_car_id,p_expected_revision,p_request_id,p_command)`
- `snote_business_worklist(p_company,p_scope,p_page,p_page_size,p_query)`
- `snote_business_preferences(p_company,p_action,p_expected_revision,p_request_id,p_payload)`

write 명령은 `start_cycle {cycle}`, `update_cycle {id,status,details}`, `save_entry {entry}`, `reverse_entry {id,reason,date}`, `cancel_cycle {id,reason,date}`다. 정상 응답은 현재 revision과 canonical workspace다. 같은 request UUID·동일 body 재시도는 같은 결과를 반환하고 다른 body 재사용은 거부한다. 응답 유실·중복 클릭·CAS 충돌·계정 전환 시 성공을 추측하지 않는다.

## 거래와 사건

cycle 상태는 open/cancelled/closed다. details의 거래유형은 direct/joint/consignment/brokerage이며 매입·예상판매·실판매 금액과 날짜, 계약·인도일, 기존 원가 확인, 지분·수수료·상대 정산금, 잠정/확정 정산을 따로 관리한다. cycle의 closed 또는 기존 차량의 판매완료는 입금·상환·이전·사후 업무 완료가 아니다.

| kind | 상태 | 주요 details |
| --- | --- | --- |
| cash | planned/confirmed/reversed | direction, purpose, referenceId, notes. 이전비 보관·환급과 대출 원금은 차량 비용이 아님 |
| cost | estimated/incurred/unconfirmed/reversed | category, label, sourceCostKey, refundOf, evidenceMediaId/evidenceUrl, notes |
| loan | active/unconfirmed/reversed | lender, annualRate, startDate, maturityDate, notes. amountWon은 최초 실행원금 |
| loan_event | planned/confirmed/reversed | loanId, eventType(draw/repay/rate/interest_invoice/fee), annualRate, periodStart/periodEnd, notes |
| document | missing/received/verified/needs_action/done | documentType, label, assigneeId, evidenceMediaId/evidenceUrl, notes |
| transfer | not_sent/sent/received/needs_action/done | agency, assigneeId, receivedDate/completedDate, evidence, notes |
| task | todo/doing/blocked/done/cancelled | category, title, assigneeId, leadId/costId, mileage/handoverItems, notes |
| lead | inquiry/visit_booked/visited/contract/delivered/on_hold/lost | name, phone, source, budgetWon, requirements, tradeIn, nextAction, assigneeId, lostReason, existingCustomerKey |
| appraisal | draft/reviewed/bid/won/lost/cancelled | saleEstimateWon, estimatedCostsWon, targetProfitWon, reserveWon, holdingDays, comparisonUrls, checkedDate, conditionNotes, resultNotes, evidenceMediaId |
| advertising | draft/live/ended/end_unconfirmed | channel, url, receivedDate, trackingSince, assigneeId, notes, priceHistory, priceChangedDate |

확인된 금전 사실의 금액·적용일을 조용히 덮어쓰지 않는다. 오입력 취소는 원래 금액·날짜를 보존한 reversed 상태와 서버의 취소 사유·적용일·작성자·감사 기록으로 남기고 새 사실을 입력한다. 실제 환불은 별도 확인 출금으로 기록한다.

기존 원가는 사용자가 확인한 `legacyCosts` map/합계·sourceSignature로 연결한다. sourceCostKey가 있는 발생 비용은 해당 기존 항목을 대체하며 중복 입력·없는 참조는 거부하거나 미확정으로 표시한다. 기존 차량 원가가 바뀌면 확인 필요 상태로 표시한다. 소득정산의 기존 수식과 A4 세무 양식을 새 관리손익 공식으로 바꾸지 않는다.

이자는 실행·추가 실행·부분상환·금리 변경을 해당 일 시작부터 반영한 `[시작일, 종료일)` 구간으로 계산한다. 연 365일, 구간 분자 합산 후 원 단위 반올림이며 잔액이 0이어도 이전 발생 이자는 남는다. 판매일로 종료하지 않는다. 실청구 이자는 `periodStart/periodEnd` 범위를 추정 이자와 중복 차감하지 않으며 범위가 없으면 확인 필요로 남긴다.

## UI와 지연 조회

기존 차량 상세에 통합 요약과 거래·입출금·금융·서류/이전·고객/후속·광고/상품화·매입 검토를 연결한다. 새 입력은 기존 등록·견적·계약·인수증의 필수 조건을 강화하지 않는다. 기존 비공개 첨부를 확인 근거로 재사용하되 첨부 상태를 내용 검증 완료로 바꾸지 않는다.

`SnoteBusinessStore`는 새 RPC를 비차단·현재 컨텍스트에 한해 요청하고 PII를 localStorage에 저장하지 않는다. 오늘 업무는 실제 원장 상태에서 sourceId로 파생하여 별도 알림 데이터를 복제하지 않는다. 딜러는 자기 업무, 관리자는 명시적인 내 업무/상사 전체 선택, 경리는 기존 업무 첫 화면을 사용한다. 잠긴 대시보드에서는 원장·고객 정보를 조회하거나 노출하지 않는다.

운영 기준의 초기 예시는 noInquiryDays=7, priceReviewDays=30, strategyReviewDays=60, maturityDays=7, dueSoonDays=7이며 사용자가 바꿀 수 있다. 법적·업계 공통 기준으로 표시하지 않는다.

## 검증과 인계

필수 검증은 관리손익 2,200,000원, 매입 상한가 29,700,000원, 미지급 비용, 부분 입금/상환·금리 변경·판매 후 미상환, 취소·재판매와 원본 보존, 모르는 금액·날짜, 중복 요청·응답 유실·CAS, 다른 회사와 역할 경계, 모바일 입력/출력, 초기 로그인 비차단이다.

작업 중 단계와 운영 적용 영수증은 `docs/vehicle-business-progress.md`에 기록한다. 미검증 사항을 완료로 표시하지 않는다.
