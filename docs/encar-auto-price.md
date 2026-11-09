# 엔카 광고가격 자동 확인

v2.112의 [광고가·직접 변경 버튼과 목록 비교](vehicle-price-and-interest.md)를 함께 참고한다. 상세의 `판매가 변경`은 확인창 없이 해당 금액만 저장하고, Encar 재조회에서 다른 금액을 찾았을 때는 기존 변경 확인창을 사용한다.

차량 상세의 Encar 버튼으로 광고를 확인하면 가격을 함께 조회한다. 가격을 찾으면 S-NOTE에서 **현재 판매예정가 → 찾은 금액**과 `이 금액으로 변경하시겠습니까?` 확인창을 표시한다. `변경`은 판매예정가만 서버에 저장하고 `취소`는 기존 금액을 유지한다. 작성 중인 메모와 추가비용 등 다른 입력은 함께 저장하지 않는다.

## 조회 순서

1. 차량번호·원본 광고 ID·광고 중 상태를 먼저 확인한다.
2. 기존 `ENCAR_API_KEY`로 공급자 가격을 조회한다. 원본 광고 HTML의 안전하게 추출한 텍스트도 확인하며, 출처가 다른 가격은 구분해서 표시한다.
3. 가격이 없으면 서버에서 같은 광고를 다시 검증한 후 Cloudflare Browser Run으로 엔카 화면을 열고 Google Vision으로 금액을 읽는다. 사용자가 캡처하거나 파일을 올릴 필요가 없다.
4. 화면에서 읽은 가격은 검토가 필요한 후보로 표시한다. 다른 차량번호·광고 종료·보안 차단·여러 금액·불명확한 단위는 자동 선택하지 않는다. 광고가 여러 개면 사용자가 선택한 광고만 확인한다.

만원은 **10,000원**이다. `5,490만원`은 `54,900,000원`으로 환산한다. 월납·할부·보험료·신차가 등 부가 금액은 제외한다. 실제 엔카 화면이 자동 접속을 제한하거나 표시 방식이 바뀌면 금액을 찾지 못할 수 있다. 이때 검증된 광고 링크는 유지한다.

기존 링크를 복원할 때마다 확인창을 띄우지 않는다. 판매예정가를 직접 수정 중이면 그 입력을 우선하며 자동 변경을 제안하지 않는다. 판매 완료·읽기 전용·다른 계정/차량·저장 충돌도 변경을 허용하지 않는다. 저장 응답이 지연되면 기존 저장 확인·재시도 경로로 확인한다.

## Cloudflare 운영 설정

기존 Google Vision 키 외에 서버 자동 촬영을 위한 계정 ID와 토큰이 필요하다. 토큰은 브라우저나 채팅에 전달하지 않는다.

1. Cloudflare의 **My Profile → API Tokens → Create Token → Create Custom Token**을 연다.
2. Permissions에서 해당 계정의 **Browser Run – Edit** 권한을 지정한다. 이전 화면에서는 **Browser Rendering – Edit**로 표시될 수 있다. Account Resources는 S-NOTE를 운영하는 해당 계정으로 제한한다.
3. **Compute → Workers & Pages → s-note → Settings → Variables and Secrets**에서 Production에 다음을 등록한다.

| 이름 | 종류 | 값 |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | 텍스트 | S-NOTE Cloudflare 계정의 32자리 Account ID |
| `CLOUDFLARE_BROWSER_TOKEN` | 암호화 Secret | 위에서 발급한 API 토큰 |
| `GOOGLE_VISION_API_KEY` | 기존 암호화 Secret 유지 | Google Vision 키 |

4. 저장 후 새 Production 배포를 실행한다. 환경변수 변경은 이미 실행 중인 배포에 자동 적용되지 않는다.
5. `https://s-note.pages.dev/api/encar-auto-price`를 열어 `configured:true`를 확인한다. 이는 설정값 존재 여부이며 실제 촬영·인증 성공을 보장하지 않는다. 로그인한 뒤 유효한 본인 차량의 Encar 버튼으로 실제 금액 확인까지 시험한다.

설정 확인 GET은 외부 링크에서 최상위 문서로 여는 탐색도 허용한다. 반환값은 `ok`·`configured`뿐이며 외부 서비스 호출이나 장부 변경을 하지 않는다. 교차 출처 스크립트 요청·iframe·POST 및 다른 API의 출처 제한은 유지한다. 설정 등록 뒤의 배포·확인 범위는 [운영 설정 확인 기록](encar-auto-price-activation.json)에 남긴다.

공식 안내: [스크린샷 API](https://developers.cloudflare.com/browser-run/quick-actions/screenshot-endpoint/). 사용 중인 계정의 Browser Run 제공 범위와 이용 한도가 적용된다.

## 저장·보호 범위

`POST /api/encar-auto-price`는 로그인·활성 계정·동일 출처를 확인하고 `{plate,id}`만 받는다. 사용자가 보낸 URL·쿠키·실행 스크립트는 받지 않는다. 고정 엔카 URL을 최대 한 번 촬영하고 Google Vision을 최대 한 번 호출한다. 요청 시간·응답 크기를 제한하며 토큰·캡처 이미지·OCR 원문은 응답이나 장부에 저장하지 않는다.

가격 메타데이터는 기존 소유자별 `cars.encarLinks` JSON에 정수 원으로 저장한다. 공급자 가격은 `verified/encar-api.com`, 정적 페이지 후보는 `review/encar.com`, 자동 촬영 후보는 `review/encar.com-ocr`로 구분한다. 판매예정가 변경은 기존 장부 revision 확인을 거치며 다른 차량·소유자 자료를 보존한다. 새 DB 표·스키마·RLS 변경은 없다.

기존 [수동 캡처 OCR 시험](encar-price-ocr.md)은 별도의 보조 기능으로 유지한다. 자동 가격 경로의 검증·운영 연결 여부는 [검증 기록](encar-auto-price-verification.json)에 구분한다.
