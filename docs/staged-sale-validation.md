# 판매 확정 검증 변경 (1단계 검토용)

운영 DB·설정은 변경하지 않았다. 이 변경의 SQL migration은 **미적용 상태**로 검토한다.

- 상태 드롭다운의 새 판매 확정에서는 실제 판매가를 비워 두며, 판매예정가/이전 가격은 입력칸의 참고값으로만 보여 준다. 재판매도 사용자가 실제 금액을 입력한 뒤 `판매 완료 확정`을 눌러야 한다.
- 판매완료 상세에서 실제 판매가를 바꾸면 금액을 표시한 확인 팝업을 거친다. 취소하거나 차량/사용자/입력값이 달라지면 저장하지 않는다.
- 날짜는 실제 달력상 존재하는 `YYYY-MM-DD`인지 확인하며, 유효한 매입일보다 이른 판매일은 거부한다. 대기 중 상세 저장 후에도 현재 매입일로 다시 검증한다.
- 차량 최종 저장 함수에서도 새/변경된 판매 사실(상태·판매일·실제판매가·매입일)을 검증한다. 과거에 잘못 입력된 거래는 자동 정정하지 않고, 해당 판매 사실을 바꾸지 않는 메모·비용 저장은 허용한다.
- DB migration의 `BEFORE INSERT/UPDATE` trigger는 기존 데이터셋 RPC를 포함한 최종 쓰기 경계에서도 같은 날짜·금액 검증을 수행한다. 원장 데이터 형태는 `cars` 배열이며, 기존 만원 wire 형식과 `moneyUnit: KRW` 형식 모두 처리한다. 다른 데이터셋에는 적용하지 않는다.
- 과거 잘못된 거래의 정상 휴지통 복원은 기존 복원 RPC 내부 context 및 같은 상사·소유자·차량의 보관본 전체 JSON 동일성을 모두 확인한 경우에만 허용한다. 임의 내부 flag만으로 변형 판매기록을 저장할 수 없다.
- 서버 ACK가 실패한 상세 편집의 취소는 해당 pending write 객체와 원본 판매사실의 동일성을 확인한 경우에만 원본 이력으로 되돌린다. 임의 rollback 옵션이나 다른 차량/사용자 컨텍스트는 예외가 되지 않는다.
- 권한/RLS/RPC 서명/CAS 규칙과 기존 금액·금융 정보는 바꾸지 않는다. 함수는 `SECURITY INVOKER`, 빈 search_path이며 외부 실행 권한을 주지 않는다.

검증은 전부 가상 데이터로 실행한다.

```sh
node tests/sale-validation.test.cjs
NODE_PATH=/workspace/work/deps/node_modules node tests/sale-validation.sql.cjs
SALE_GUARD_SQL=supabase/migrations/20261122052042_sale_completion_validation.sql NODE_PATH=/workspace/work/deps/node_modules node tests/recycle-bin-db.cjs
node tests/sale-validation.browser.cjs
node tests/sale-completion.browser.cjs
node tests/sale-cancellation.test.cjs
```

새 SQL 검증 27개 및 기존 휴지통 검증 74개 통과. 실제 Chromium의 1440/390px에서 판매가 직접 입력, 매입일 전 판매 거부, 변경금액 확인/취소를 검증했다. 승인 전 운영 DB/기존 모바일 클라이언트의 실제 최종 쓰기 검증은 미실시다. 서버 보호는 migration이 별도로 검토·적용된 후 활성화된다.
