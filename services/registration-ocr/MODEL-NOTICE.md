# OCR 모델·실행 코드 출처

이 테스트 서비스는 PaddleOCR의 문자 검출·한국어 인식 모델을 CPU의 ONNX Runtime으로 실행한다. Google 또는 다른 외부 OCR 서버로 보내는 폴백은 없다.

| 구성 | 고정 항목 | 라이선스·출처 |
|---|---|---|
| 문자 검출 | PP-OCRv6_small_det ONNX | PaddlePaddle/PaddleOCR, Apache-2.0 |
| 한국어·영문·숫자 인식 | korean_PP-OCRv5_mobile_rec ONNX | PaddlePaddle/PaddleOCR, Apache-2.0 |
| 실행 엔진 | onnxruntime 1.23.2 CPUExecutionProvider | Microsoft, MIT |
| 이미지 처리 | OpenCV headless 4.10.0.84 / Pillow 13.0.0 | Apache-2.0 / MIT-CMU |
| 수치·다각형·설정 | NumPy 2.5.5 / pyclipper 1.4.0 / PyYAML 6.0.2 | BSD-3-Clause 등 / MIT / MIT |

공식 PaddleOCR 3.3.2의 한국어 모델 문서를 먼저 검토했고 PaddlePaddle 3.2.2·PaddleOCR 3.3.2를 설치했다. 이 실행 환경의 허용 출처 정책이 공식 원본 모델 호스트를 차단해 해당 네이티브 모델 파일로는 추론하지 않았다. 최종 실행 의존성은 네이티브 Paddle 패키지 대신 `requirements.txt`에 고정한 ONNX Runtime이다. 모델 구조는 PaddleOCR이며 자체 학습 모델이라고 표시하지 않는다.

현재 모델 배포 파일은 [Patchy의 공개 모델 전용 릴리스 ai-models-4](https://github.com/SethRobinson/Patchy/releases/tag/ai-models-4)에서 일반 HTTPS 다운로드로 준비한다. 배포자는 PaddlePaddle의 ONNX 파일과 인식 설정을 수정 없이 파일명만 바꾸었다고 명시하며 원본 모델 저장소 리비전을 공개한다. 검출 원본 리비전은 `28fe5895c24fd108c19eb3e8479f4ab385fbfc62`, 인식 원본 리비전은 `5c6f574b8e2230adf4287b33e736d71b9fabd28e`이다. 배포자의 SHA256SUMS와 일치하는 파일 크기·SHA256을 `models.lock.json`에 고정했다. **원본 제공처의 독립적인 모델 체크섬과는 대조하지 못했으므로 배포자의 원본 동일 주장까지 독립 검증했다고 표시하지 않는다.**

모델의 Apache-2.0 전문은 준비 파일 `ppocr_LICENSE.txt`에 그대로 보존한다. 배포 앱의 소스·실행 파일은 사용하지 않으며 앱 전체의 라이선스와 모델 라이선스를 혼동하지 않는다. 원본 코드 라이선스: [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.3.2/LICENSE), [PaddlePaddle](https://github.com/PaddlePaddle/Paddle/blob/v3.2.2/LICENSE), [ONNX Runtime](https://github.com/microsoft/onnxruntime/blob/v1.23.2/LICENSE).

사전 처리·DB 텍스트 검출 후처리·CTC 디코딩은 공개 모델의 입출력 규격에 맞춘 S-NOTE 구현이다. 참조 규격은 [PaddleOCR OCR 사용법](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.3.2/docs/version3.x/pipeline_usage/OCR.en.md), [DB 후처리](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.3.2/ppocr/postprocess/db_postprocess.py), 모델 자체 `inference.yml`이다. 원본 고해상도 이미지에서 검출 사각형을 원근 보정한 후 인식하며 자동으로 트림·등록연도를 추측하지 않는다.
