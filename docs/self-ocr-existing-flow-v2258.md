# 자체 등록증 OCR 테스트를 위한 기존 경로 조사

조사 기준은 `main` v2.257(`1e742a78292cc76b87fccc077db5d0f1397c2b29`)이다. 사용자의 마지막 지시에 따라 이번 자체 OCR은 **운영자 테스트 메뉴에만** 추가하고 딜러의 실사용 Google Vision·차량 저장 흐름은 바꾸지 않는다. 아래 줄 번호는 조사 시점 기준이다.

## 딜러의 현재 등록증 처리

| 단계 | 실제 코드 | 동작 |
|---|---|---|
| 진입·파일 선택 | `index.html:6333` `openAutoRegistration`, `:6360` `handleAutoRegistrationFile` | 딜러만 진입한다. JPG/PNG/WebP, 원본 15MB까지 선택하고 File·Blob URL을 미리보기에 연결한다. |
| 원본 확대·교체·삭제 | `index.html:6377`~`:6407` | 기존 원본 Blob URL을 확대 화면에서 사용한다. 삭제·닫기는 URL 회수 및 OCR serial 변경으로 늦은 결과를 무효화한다. |
| OCR용 이미지 준비 | `index.html:6413` `snote201OcrImage` | 긴 변 1800px 이상이고 6MB 이하면 원본을 그대로 전송한다. 작은 이미지는 최대 2배/긴 변 2500px로 확대·대비 조정한다. 6MB 초과 원본은 긴 변 최대 3600px에서 시작해 JPEG 품질·크기를 줄이며 최대 5번 맞춘다. 저장 원본은 바꾸지 않는다. |
| 실제 OCR 호출 | `index.html:6757` 재정의한 `zc77RunAutoRegistrationOCR` | 초기 브라우저 Tesseract 구현(`:6701`)이 현재 주 호출이 아니다. 온라인 토큰을 얻고 `:6786`의 `POST /api/ocr`로 OCR용 이미지 바이트를 보낸다. 브라우저 제한시간은 60초다. |
| 서버 인증 | `functions/api/ocr.js:623`~`:750` | 같은 출처, 이미지 형식·6MB 제한, Supabase Auth `/auth/v1/user`, 활성 `zc_members`를 확인한다. 환경변수는 `GOOGLE_VISION_API_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`다. |
| Google 전송·추출 | `functions/api/ocr.js:787`~`:867` | Google `images:annotate`의 `DOCUMENT_TEXT_DETECTION`, 언어 힌트 `ko/en`. `parseDocument(:418)`가 `plate/model/year/vin` 네 문자열을 추출해 `{ok,fields,engine:'google-vision'}`으로 반환한다. 전체 OCR 텍스트는 응답에 넣지 않는다. |
| 사용자 수정 보호 | `index.html:6487`~`:6508`, `:6763` | `zc77Touched`에 입력한 필드를 기록하고 `zc77SetField`는 해당 필드를 덮지 않는다. serial·File 동일성·열린 화면·사용자 확인으로 A 사진의 늦은 결과가 B 사진에 들어가지 않도록 한다. |
| 등록 폼 전달·저장 | `index.html:6857` `continueAutoRegistration`, `:6885` `zcAttachAutoRegistration` | 명시적으로 다음을 누르면 기존 `openAdd` 폼에 차량번호·연식·VIN을 넘기고 기존 카탈로그로 차명을 대조한다. 최종 저장은 기존 차량 저장이 담당하며 등록증 원본 첨부도 그 후 기존 경로를 따른다. |

Google 실패 시 현재 실사용 경로는 브라우저 Tesseract로 돌아가는 기존 동작을 갖는다(`index.html:6759`). 자체 OCR 테스트 경로는 이 함수를 호출하거나 실패를 Google로 우회해서는 안 된다.

### 새 추출기에 그대로 재사용하면 안 되는 부분

현재 `parseDocument`의 연도 점수는 최초등록일 120점, 모델연도 90점이고 텍스트의 최초등록연도도 110점 후보로 넣는다(`functions/api/ocr.js:505`~`:559`). 따라서 새 자체 OCR에서 요구한 **2025년 최초등록·2024년형 → 2024년식**, 모델연도 누락 시 미입력 규칙을 충족하는 별도 공간 기반 추출기가 필요하다. 이번 범위에서 기존 Google 파서를 바꾸면 실사용 동작이 바뀌므로 수정하지 않는다.

## 운영자 전용 확장 지점

- `operator.html:64`의 메뉴와 별도 화면은 `assets/operator-console.js`가 관리한다. `names(:24)`, 메뉴 클릭 처리(`:203`), `renderNavigation(:58)`를 확장하되 신규 테스트 뷰가 기존 `loadList(:64)`의 알 수 없는 목록 액션으로 흘러가지 않게 분기한다. 기존 `Google vision` 관측 메뉴는 유지한다.
- 운영자 API의 실제 인증은 `functions/api/operator.js:95` `authorize`다. 사용자 JWT로 `/auth/v1/user`를 조회하고 `snote_operator_context` RPC가 허용한 actor·session과 일치하는지 확인한다. `recheck(:102)`는 같은 actor/session을 다시 검사한다. 자체 OCR 게이트웨이는 이 권한을 재사용하고 이미지 처리 뒤에도 세션을 재확인해야 한다.
- 기존 SQL `20261107013019_platform_operator_console.sql:59`의 `verified_session`은 사용자·실제 Auth 세션을 연결하고 이메일 확인, 삭제·차단·익명 여부, `not_after`, 계정 보관 상태를 검사한다. `require_operator(:79)`는 별도의 비공개 운영자 허용 목록도 확인한다. 브라우저가 바꿀 수 있는 `user_metadata`는 권한 근거가 아니다.
- 현재 운영자 UI는 `S.epoch`, `authVersion`, actor, 세션과 읽기 세대로 늦은 응답을 차단한다. 새 이미지·판독 카드도 사진별 세대와 필드별 사용자 수정 여부를 갖고 `clearPrivate(:43)`에서 요청·이미지 URL·결과를 모두 정리한다. `pagehide`도 정리 대상이다.
- 새 Pages API는 `functions/_shared/api-security.js`의 명시 정책에 추가해야 한다. 이미지 본문 한도·허용 형식·같은 출처·인증 검사는 기존 일반 미들웨어를 유지하고, 원본/원문/주소가 일반 관측에 흘러가지 않도록 OCR용 로그 경계를 별도로 정한다. 어떤 값도 DB·Storage로 새로 보관하지 않는 테스트 흐름으로 시작한다.

## Supabase 문서 확인

2026-11-29(한국 시간) [변경 기록](https://supabase.com/changelog.md), [getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [세션 문서](https://supabase.com/docs/guides/auth/sessions)를 확인했다. 최신 CLI·분기 병합·TLS 변경은 읽었으며 이번 hosted REST 인증 재사용을 바꿀 직접 변경은 찾지 못했다. Auth 조회는 인증된 사용자 확인에 사용하되, 로그아웃 후 남아 있을 수 있는 JWT만으로 운영자 세션을 허용하지 않는다. 세션 ID의 실제 존재와 만료 상태를 기존 RPC로 다시 확인하는 구조를 유지한다. 운영 DB·Auth 설정 조회/수정과 실제 Google 요청은 이 조사에서 수행하지 않았다.

## 운영자 화면의 로컬 실행

`scripts/operator-ocr-dev.mjs`는 Node 24의 기본 HTTP 서버만 사용한다. Python OCR 서버와 같은 `SNOTE_OCR_SERVICE_TOKEN`을 환경변수로 준비한 뒤 실행한다. 이 토큰은 브라우저에 전달하지 않는다.

```bash
SUPABASE_URL=https://PROJECT.supabase.co \
SUPABASE_PUBLISHABLE_KEY=PUBLIC_PUBLISHABLE_KEY \
SNOTE_OPERATOR_OCR_PROVIDER=self \
SNOTE_SELF_OCR_URL=http://127.0.0.1:8765/ocr/vehicle-registration \
SNOTE_OCR_ALLOW_LOCALHOST=1 \
node scripts/operator-ocr-dev.mjs
```

브라우저에서 `http://127.0.0.1:3000/operator.html#ocr-lab`을 열어 기존 운영자 계정으로 로그인한다. 프런트엔드의 기존 공개 Supabase 프로젝트와 위 서버 설정은 같아야 한다. Google 키와 service-role 키는 필요하지 않는다. 운영자 로그인 확인에는 실제 Supabase Auth·운영자 세션 RPC가 필요하지만 Python 모델 로딩·추론은 외부 연결 없이 실행한다.

기본 바인딩은 `127.0.0.1:3000`이다. 필요한 경우 `SNOTE_OCR_DEV_PORT`, 명시적 미리보기 바인딩에는 `SNOTE_OCR_DEV_HOST=0.0.0.0`을 사용한다. 단, 자체 OCR의 HTTP loopback 허용은 브라우저 요청도 loopback 호스트인 경우로 제한한다.

로컬 `/api/operator`는 정확히 `{action:"context"}`인 인증 확인만 처리한다. 운영 목록·변경 액션과 다른 업무 API는 제공하지 않으며 공개 정적 파일도 운영자 HTML·manifest·허용된 assets만 제공한다. 서비스 코드·테스트·비밀 파일·PDF를 정적 경로에서 읽을 수 없다. 파일 본문은 메모리로 한도를 확인하고 access 로그나 등록증 사본을 만들지 않는다.

`node tests/operator-ocr-dev-v2258.test.mjs`는 가상 인증·OCR 응답을 사용한 로컬 서버 검사 11개다. 정적 경로·헤더, 실제 인증 도우미 연결, service-role/Google 키 불필요, live 운영자 거부, multipart 전달과 원문/파일명 차단·오류 무외부전송을 확인한다. 이는 실제 모델 추론 시험과 별개다.
