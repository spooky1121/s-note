# 버튼으로 직접 스캔 · v2.250

사용 환경은 Windows 10/11 x64, 삼성 SL-J3560FW Wi-Fi이다. 웹 스캐너 메뉴에서 실제 Windows 스캐너를 작동시키고, 미리보기 확인 후 기존 상사 비공개 보관함에 저장한다. 기존 파일 불러오기·드롭·목록·보기·다운로드·삭제는 유지한다.

## 구성과 동작

- 웹은 첫 스캔/연결 설정 클릭에만 `scanner-device.js`를 읽는다. 로그인이나 메뉴 진입에서 PC를 탐색하거나 권한창을 띄우지 않는다.
- 연결 도우미 1.0.0은 Windows에 등록된 WIA 장치를 사용한다. 실제 STA COM 작업에서 평판/ADF 원고 한 장을 BMP로 획득하고, DPI를 보존하며 크기를 제한한 JPEG로 변환한다. 가상 장치 경로는 테스트 프로젝트에만 있고 Windows 배포 앱은 참조하지 않는다.
- `127.0.0.1:17426`의 Kestrel 서버는 고정 Host와 공식 S-NOTE Origin을 검사한다. 6자리 일회 연결 코드·시도 제한과 Origin에 묶인 메모리 capability로 승인한다. 로그인 토큰·비밀번호·Supabase 키를 도우미로 보내지 않는다.
- 중복 요청 UUID는 다시 스캔하지 않는다. 취소/만료한 UUID도 capability 수명 동안 재사용하지 못한다. 장치 작업은 전역 한 개이며 취소한 실제 WIA 작업이 끝날 때까지 busy를 유지한다. 결과는 최대 5MiB/40Mp·짧은 메모리 보관만 허용한다.
- 웹은 미리보기 후 명시적 저장 때만 기존 업로드 큐에 File을 전달한다. 로그인·상사·세션·화면 변경과 취소에는 결과/임시 URL을 폐기한다. 같은 로그인·탭의 메뉴 재진입은 연결을 재사용하되 새로고침/재로그인 시 다시 연결할 수 있다.
- 도우미의 사용자별 설치·자동 실행은 별도 Yes/No 확인 후에만 현재 Windows 사용자 폴더/HKCU에 적용된다. 관리자 권한·방화벽 변경·인증서 설치·보안 기능 비활성화를 요구하지 않는다.

DB·기존 저장 API·Cloudflare 비밀값·NAS/백업·고객/차량 자료·문서 인쇄·공식 로고·Pretendard 파일은 변경하지 않는다. 설치와 현장 확인 절차는 [Windows 연결 안내](scanner-connector-windows.md)에 있다.

## 검증

- 실제 Kestrel HTTP + 가상 장치 프로토콜 23개를 Linux와 Windows CI에서 통과했다. Origin/Host/CORS·코드·token·payload·중복·취소·만료·과대 이미지·외부 설정 바인딩·오류 후 복구를 포함한다.
- 실제 Windows CI에서 self-contained EXE publish와 생성 이미지를 이용한 native GDI 변환 `--self-test`를 통과했다. BMP 회색조/흑백·JPEG·DPI·크기 제한을 검사하며 WIA/물리 장치는 실행하지 않는다.
- 웹 신규 단위 18개와 기존 화면 모델 13개, 클라이언트 회귀, 인라인 스크립트 8개 구문 검사를 통과했다.
- 실제 경리 UI 38개(직접 스캔 14·기존 보관함 20·준비 상태 복구 4)를 1440/430/390/360px에서 통과했다. 도우미 전송만 고정 루프백의 생성 이미지 응답으로 대체했고, 저장/권한/화면은 실제 가상 앱 경로를 사용했다. 확정 제품 18개 파일 해시를 대조했다.
- 보충 실제 HTTPS 브라우저→루프백 시험은 이 환경의 Chromium 154에서 권한 override가 효과를 내지 못해 HTTP 도달 전에 차단되었다. 보안 기능을 끄거나 성공으로 처리하지 않았으며 실 LNA 허용 이후 전송은 미검증이다. 실제 Windows 브라우저의 권한 허용·SL-J3560FW 드라이버·Wi-Fi 작동은 사용자 PC에서 확인해야 한다.

Windows ZIP은 GitHub Actions가 검증한 소스에서 생성하고 SHA256·소스 커밋 영수증·Microsoft .NET 라이선스를 함께 제공한다. 기존 릴리스 파일을 덮어쓰지 않는다. 코드 서명은 포함하지 않는다. 운영 고객 문서·이미지·계정과 실제 복합기로 시험하지 않았다.

작업 증적: `/workspace/work/scanner-device-v2250/`의 `native-protocol-tests.json`, `helper-implementation-summary.json`, `browser-qa-summary.json`, `loopback-browser/blocked-receipt.json` 및 GitHub `Scanner connector` 실행 결과.
