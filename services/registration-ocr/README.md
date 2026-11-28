# 운영자 전용 자동차등록증 자체 OCR 테스트

딜러의 기존 등록증 업로드·Google Vision·자동입력·저장 기능은 변경하지 않는다. `operator.html`의 **자체 OCR 테스트**에서 사진 카드와 네 항목의 결과 카드를 비교한다. 이 화면은 차량을 저장하지 않으며 운영 전환용 설정을 자동으로 바꾸지 않는다.

Python 3.12 CPU 환경에서 실행을 검증했다. 실제 실행 모델은 **PP-OCRv6_small_det + korean_PP-OCRv5_mobile_rec**, 실행기는 **ONNX Runtime 1.23.2 CPU**다. 네이티브 PaddleOCR 설치·공식 모델 검토 후 네트워크 제한 때문에 공개 재배포 ONNX 파일을 선택했다. 패키지 버전은 `requirements.txt`, 모델 크기·SHA256·출처는 `models.lock.json`, 라이선스와 원본 체크섬을 독립 대조하지 못한 범위는 [MODEL-NOTICE.md](MODEL-NOTICE.md)에 기록했다.

## 최초 준비

저장소 루트에서 실행한다. 모델 다운로드는 이 단계에서만 수행한다. 다운로드 후 서버 재시작·분석에는 외부 OCR 서비스나 모델 다운로드가 필요 없다.

```bash
python3.12 -m venv services/registration-ocr/.venv
services/registration-ocr/.venv/bin/pip install -r services/registration-ocr/requirements.txt
services/registration-ocr/.venv/bin/python services/registration-ocr/scripts/prepare_models.py --model-dir services/registration-ocr/models
cp services/registration-ocr/local.env.example services/registration-ocr/local.env
```

`local.env`의 모델 경로를 절대 경로로 바꾸고 기존 S-NOTE 프로젝트의 공개 URL·publishable key를 넣는다. 비공개 `SNOTE_OCR_SERVICE_TOKEN`은 아래 명령으로 만든 값을 사용한다. 이 키는 Python 서비스와 로컬 중계 서버에서 동일해야 하며 브라우저에 넣지 않는다. Google API 키와 Supabase service-role 키는 필요 없다.

```bash
services/registration-ocr/.venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(32))'
```

## 실행

첫 터미널에서 설정을 읽고 CPU API를 실행한다. `--no-access-log`를 유지하며 운영 리버스 프록시에도 요청 본문·Authorization·사진을 기록하지 않는다.

```bash
set -a
. services/registration-ocr/local.env
set +a
PYTHONPATH=services/registration-ocr services/registration-ocr/.venv/bin/uvicorn snote_ocr.app:app --host 127.0.0.1 --port 8765 --workers 1 --no-access-log
```

두 번째 터미널에서 Node 24 이상의 로컬 중계 서버를 실행한다.

```bash
node --env-file=services/registration-ocr/local.env scripts/operator-ocr-dev.mjs
```

`http://127.0.0.1:3000/operator.html#ocr-lab`에 접속해 **기존에 승인된 S-NOTE 운영자 계정**으로 로그인하고 등록증 사진을 선택한다. 로컬 중계 서버도 실제 Auth 사용자 및 운영자 세션 allowlist를 확인한다. 운영자 로그인에는 기존 Supabase 연결이 필요하며 OCR 추론 자체의 오프라인 조건과 구분한다. 계정 인증을 우회하는 공개 테스트 로그인은 없다.

`SNOTE_OPERATOR_OCR_PROVIDER=self`는 이 테스트 API만 선택한다. 값이 없거나 다른 제공자를 지정하면 실패하며 Google로 자동 전송하지 않는다. 기존 딜러 Google 설정에는 영향이 없다. 운영에서는 별도의 비공개 CPU 서비스와 HTTPS 중계 주소를 준비한 뒤 검토해야 하며 `SNOTE_OCR_ALLOW_LOCALHOST=1`은 로컬 요청에만 유효하다.

## API·입력 보존

`POST /ocr/vehicle-registration`, 서버 간 Bearer 키, multipart의 `file` 한 장을 받는다. JPG/PNG/WebP, 최대 6MB/40MP이며 원본 해상도에서 EXIF 방향을 보정하고 문자 사각형을 인식한다. 응답은 `fields.plate`, `vin`, `model`, `modelYear`와 항목별 `value`, `needsReview`, `reasons`, `polygon`, `confidence`, `autoFill` 및 이미지 좌표계·처리시간이다. 전체 OCR 텍스트·주민번호·주소는 응답/일반 로그에 쓰지 않는다. 업로드 파일명은 중계 서버에서 제거하며 별도 Storage나 DB에 사진·결과를 보관하지 않는다.

확실한 값만 입력한다. VIN은 원본의 해당 영역을 재판독하고 두 판독이 다르면 확인 대상으로 남긴다. 모델연도가 없으면 최초등록연도를 대신 채우지 않는다. 차명은 인접 형식·원동기 칸과 구분한다. 원본 영역 버튼은 같은 카드에서 위치를 표시·확대한다. 사진 교체·메뉴 이동·로그아웃 후 지연 응답은 버리며 직접 수정한 값은 덮어쓰지 않는다.

## 테스트·평가

파서에 미리 작성한 토큰을 넣는 단위 시험과 실제 이미지 모델 시험은 별도다.

```bash
PYTHONPATH=services/registration-ocr services/registration-ocr/.venv/bin/pytest services/registration-ocr/tests/test_extraction.py services/registration-ocr/tests/test_evaluation.py services/registration-ocr/tests/test_api.py
services/registration-ocr/.venv/bin/python services/registration-ocr/tools/generate_synthetic.py --output /tmp/snote-registration-synthetic
PYTHONPATH=services/registration-ocr services/registration-ocr/.venv/bin/python services/registration-ocr/tools/evaluate.py /tmp/snote-registration-synthetic/ground-truth.jsonl --models services/registration-ocr/models --output /tmp/snote-ocr-evaluation.json
```

생성 자료는 개인정보 없는 정상·최초등록/모델연도 불일치·흐린 VIN·모델연도 누락 사례다. 평가 입력 JSONL은 이미지 경로와 정답 `plate`, `vin`, `model`, `modelYear`를 담는다. 실제 표본은 개인정보를 가린 파일을 별도로 준비하고 Git에 넣지 않는다. CLI는 항목별 완전 일치율, 틀린 값을 자동입력한 건수, 수동 확인 건수, 장당 처리시간을 집계한다. 차량번호·VIN은 한 글자라도 다르면 오답이며 모델연도 미기재 정답은 `null`로 남긴다.

실제 이미지·오프라인 API 검증 수치 및 브라우저 결과는 최종 [작업 보고서](../../docs/operator-self-ocr-v2258.md)에 구분해 기록한다. 합성 자료의 성능을 실제 등록증 정확도로 일반화하지 않는다.
