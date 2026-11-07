# 차량 공유 수락

`20261107041621_vehicle_share_acceptance.sql`은 기존 공유를 `accepted`로 보존한다. 이후 새 공유는 `pending` 초대이며 받은 딜러가 알림에서 수락해야 차량 목록·상세·수정·사진·서류에 접근할 수 있다. 고객정보는 공유하지 않는다.

기존 `snote_vehicle_share` 인수는 유지한다.

- `grant`: `{ok, recipientId, invitationId, version, state}`. 중복 요청은 기존 상태를 유지한다. 거부된 초대를 다시 보내려면 기존 공유를 해제하고 새로 초대한다.
- `outgoing`: 기존 행에 `invitationId`, `version`, `state`, `respondedAt`을 추가한다.
- `incoming` 및 `snote_vehicle_share_badges`: 수락된 행만 반환하며 `state: "accepted"`를 명시한다.
- `snote_vehicle_share_reply(p_invitation uuid, p_expected integer, p_accept boolean)`: 초대받은 본인만 응답한다. `{ok, invitationId, version, state, alreadyProcessed}`를 반환한다. 같은 응답 재시도는 멱등 처리하고, 반대 응답·오래된 버전·회수 후 재초대의 옛 ID는 거부한다.

새 알림의 `eventType`은 `share_invitation`이며 `invitation`은 `{id, version, state, companyId, ownerId, carId}`다. 수락 전에는 차명·차량번호·보낸이와 초대 식별자만 제공하고 변경 내용은 빈 배열이다. 알림을 읽어도 응답 전까지 목록에서 다시 열 수 있다. 기존 `shared`·`changed` 알림은 유지하며 새 차량 변경 알림은 현재 수락된 상대에게만 보낸다. 회수·재초대 시 이전 요청의 변경 이력이 새 권한으로 되살아나지 않는다.

공유 전용 함수 외에 기존 상사 전체 조회 정책도 검토했다. 일반 딜러의 차량 파일 조회는 실제 차량 소유자 또는 수락한 공유로 제한하는 restrictive RLS를 적용한다. 관리자·경리는 기존 상사 내 파일 관리 범위를 유지하며 비차량 로고·프로필 파일은 기존 정책을 따른다. 경리가 업로드한 등록증은 업로더가 아닌 차량 소유자를 기준으로 판단한다. 동일 상사에 같은 차량 ID가 중복되어 소유자가 모호하면 공유 접근을 거부한다.

차량 보관·이전·복원은 기존 공유 권한을 복원하지 않는다. 모든 상태는 비공개 공유 테이블에 저장하며 일반 클라이언트의 직접 조회·수정을 허용하지 않는다. 새 공개 RPC는 invoker wrapper이고 실제 권한 검사는 비공개 definer 함수에서 고정된 인증 사용자와 저장된 상대 상사로 수행한다.

검증: `NODE_PATH=/workspace/work/deps/node_modules node tests/vehicle-sharing-db.cjs`. 합성 데이터로 수락 전 접근 차단, 수락/거부/CAS, 재초대, 알림, 관리자·경리 보존, 모호한 소유권, 실제 운영 RLS·휴지통 가드와의 호환성을 확인한다. 운영 DB에는 이 테스트를 실행하지 않는다.
