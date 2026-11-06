# 차종 마스터 원천 조사 — 2026-11-06

이번 조사는 이름 관측 자료, 제원 인증 자료, 판매 분류표를 구분한다. 전체 제조사와 과거 세대·등급·세부등급의 전수성을 보장하는 무료 공개 원천은 이번 조사에서 확인하지 못했다. 확보하지 못한 영역을 임의 이름 조합으로 채우지 않는다.

| 원천 | 확인한 범위 | 자료집에서의 용도 |
| --- | --- | --- |
| [encar-api.com 문서](https://www.encar-api.com/docs) | 매물 목록·개별 상세·건수 API | 확인한 한국어 제조사/모델/Badge 관측 보관 |
| [Encar 검색 UI](https://www.encar.com/dc/dc_carsearchlist.do?carType=kor&searchType=model&TG.R=A) | 5단계 검색 UI의 존재, 현재 접속 제한 | 현재 수집 원천으로 사용하지 않음 |
| [Encar 카탈로그](https://www.encar.com/dc/dc_catalog.do?company=&method=catalog) | 제조사/모델 선택 UI | 과거 카탈로그 보조 탐색 |
| [별도 EnCarAPI 공급자 문서](https://encarapi.com/documentation)·[공개 OpenAPI](https://api.encarapi.com/openapi.json) | 제조사/모델/배지 CSV의 문서화 | 향후 도입 시 검토할 별도 유료 자료 경로 |
| [TS 신규등록 통계](https://www.data.go.kr/data/15059401/openapi.do) | 차명코드·연료·배기량 범주의 등록 통계 | 차명 범위 교차 확인 |
| [국토교통부 자동차종합정보](https://www.data.go.kr/data/15071233/openapi.do) | 개별 차량 제원과 이력의 별도 연계 서비스 | 개별 차량 제원 검증용 |
| [한국에너지공단 연비 검색](https://min24.energy.or.kr/trans_hp/AHP/HP_03/HP_03_01_010.do) | 제조사·동력원·출시년도·모델명 검색 UI | 제원 대조 후보 원천 |
| [국립환경과학원 KENCIS](https://kencis.me.go.kr/new_kencis/hms/cs01/hmscs01ev.do) | 업체·차명·형식·인증일·인증번호 20행 | 별도 전기차 인증 관측 자료 |
| [다나와 자동차백과](https://auto.danawa.com/auto/) | 국산/수입 브랜드와 모델 백과 | 공식 제조사 자료를 찾는 보조 탐색 |

세부 상태·확인한 URL·스키마·한계는 [master-source-survey.json](master-source-survey.json)에 10개 조사 경로로 기록했다. API 호스트가 같다는 추정으로 사용자 키를 공유하지 않았고 새 구독·가입·외부 연락을 하지 않았다.

## 실제 저장한 인증 관측 자료

[government-certification-observations.json](government-certification-observations.json)에 공식 KENCIS 검색 색인에서 읽은 20행, 서로 다른 차명 19개를 보관했다. 원래 표의 업체명·차명·형식·연료·인증 구분·번호·일자와 페이지 URL을 유지한다. 공개 목록에 119페이지가 표시됐지만 전수 순회는 하지 않았다. 직접 원문 재조회는 502/시간 초과로 끝났다는 취득 한계도 각 자료에 기록했다.

인증명은 판매 등급이 아니다. 인증일을 모델연도로 바꾸지 않으며, 인증이 있다는 이유로 국내 판매 중이라고 표시하지 않는다. 인증 업체 BMW Korea와 차량 브랜드 Rolls-Royce처럼 법인과 브랜드가 다른 사례도 원문을 유지한다. 신규·변경 인증은 별도 행으로 남기고 분류의 중복이나 새로운 판매트림으로 자동 계산하지 않는다.

## 전체 분류로 승격할 기준

제조사→모델군→세대→동력원/등급→세부등급의 연결을 출처가 직접 증명해야 한다. 연식·국내 사양·연료·구동방식이 확인되지 않은 `Badge` 한 단어는 관측 이름으로만 보관한다. 무료 현매물 API와 대체 공급자의 활성 매물 CSV 모두 매물이 없는 희귀/단종 등급의 존재 여부를 판정하는 자료로 쓰지 않는다.

공식 제조사 가격표·카탈로그로 검증한 국내 사양을 먼저 반영하고, 판매가 종료된 세대는 당시 연도별 자료로 보완한다. 이때 각 출처의 검증 범위를 기록하고 전체 완성 여부와 개별 모델의 검증 여부를 별도로 관리한다.
