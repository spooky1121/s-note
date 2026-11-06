# 수입차 Encar 원문 재검증

2026-11-07 한국시간 기준으로 기존 수입차 자료의 엔카 히스토리 38개 모델과 각 모델의 ENG·CLS 76개 연결 표를 재확인했다. 부모를 새로 연 직후 실제 링크를 따라가고, 매 응답의 실제 URL·제조사/모델 코드·문서 ID·표 종류를 대조했다. 저장한 내용은 분류·엔진 제원의 사실 셀 및 근거 메타데이터이며 기사 본문·사진·광고·고객정보는 제외했다.

- 기존 관측 387행을 모두 유지하고 원문 등급의 literal 또는 부모·child 조합 근거를 확인했다.
- CLS의 관측 행 394개는 기존 행 387개, 동일 이름의 반복 표시 2개, 신규 누락 3개, 기존에 제외한 세대 혼합 2개로 구분된다.
- BMW 5시리즈 6세대 표의 `550i xDrive`, `Active Hybrid 5`, `M5`를 신규 파일에 보완했다. 이름만 보완하며 엔진·연료·연식·검색 leaf 코드를 임의 생성하지 않는다.
- `rawTrimLabel`의 원문 셀 표기 17개를 교정 제안한다. 기존의 조합된 `grade`와 원본 JSON·`sourceRecord`·근거는 보존한다.
- A6의 상위 셀 후보 4개는 Markdown에서 rowspan이 없어졌으므로 자동 교정하지 않는다. W205의 `C220 CDI 쿠페`, `C63 AMG`는 알려진 세대 혼합 제외를 유지한다.
- ENG 숫자·연료의 확정 모순은 발견되지 않았다. 변속기 42개와 i-VTEC 한정어 5개의 추가 근거는 부모 히스토리에서 확인했다. 남은 10개 필드 단서와 모든 연식·등급 연결은 검토 상태다. 표에 단어가 없다는 이유만으로 기존 값을 삭제하지 않는다.
- 원문 `Quatrro`, `E22 0`, `E25 0` 등의 표기는 원문값을 보존하고 별도 주의 대상으로 남긴다.

`encar-import-additions-20261107.json`은 새 sources/records 파일이다. `encar-import-errata-20261107.json`은 root 빌더의 exact-match 교정 원장이다. `targets.json`은 기존 원문 387행의 고정 입력, `frame-table-facts.json`·`parent-audits-verified.json`은 재조회 사실, `field-review-resolution.json`은 추가 근거와 남은 검토 사항이다.

독립 검증은 이 디렉터리를 보존한 상태에서 실행한다.

```sh
python independent-audit/audit_cls.py
python independent-audit/audit_engine.py
```

이 검증 범위는 기존 수입차 히스토리 38개다. 엔카 현행 검색 전체 제조사·모델·등급·세부등급의 완전성, 개별 공식 수입 사양 또는 모델연식별 계층을 확인했다는 뜻이 아니다. 자료를 운영 DB나 선택지에 자동 반영하지 않는다.
