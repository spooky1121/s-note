#!/usr/bin/env python3
"""Rebuild the brand source ledger from saved taxonomy research.

Run from any directory: python scripts/update-vehicle-brand-source-ledger.py
This performs no network requests. Source access results were observed on
2026-11-06 and stay dated to that day when research record counts are rebuilt.
New access checks require updating the checked source facts, not just rerunning.
"""
import json,collections
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'research/vehicle-taxonomy'
baseline=json.loads((root/'baseline/coverage.json').read_text())['manufacturerCoverage']
observedAt='2026-11-06'
saved=collections.defaultdict(list)
for p in sorted((root/'sources').glob('*.json')):
    if p.name=='brand-source-ledger.json':continue
    obj=json.loads(p.read_text())
    for row in obj.get('records',[]):
        if row.get('make'):
            saved[row['make']].append((p.name,row))

# Every URL below was opened, or is a primary URL already directly verified in a
# saved research source. Homepage discovery is not a trim extraction.
checks={
'BYD':(['https://www.bydauto.kr/brand/news-view/179','https://www.bydauto.kr/'],'KR','body_verified_news_homepage_timeout','source_found_not_extracted','공식한국뉴스 본문과한국모델 메뉴 확인. 메인은2회시간초과. 씨라이언6DM-i AWD 출시문은찾았으나등급자료행은아직추출하지않음.'),
'DS':(['https://www.dsautomobiles.co.kr/'],'KR_site_with_legacy_content','body_verified','source_found_not_extracted','한국공식페이지에모델·서비스메뉴가있으나2023표기와실제판매차량상이안내가있음. 현재판매확정및단종연식등급자료는별도확인필요.'),
'GMC':(['https://www.gmckorea.co.kr/','https://news.gmckorea.co.kr/ko/gmc/newsroom.detail.html/Pages/news/kr/ko/2026/jan/0127_GMC_ACADIA.html'],'KR','body_verified','source_found_not_extracted','정확한공식한국주소gmckorea.co.kr와아카디아국내출시문직접확인. 출시문에드날리얼티밋단일트림이있지만이원장에서는등급자료행을추출하지않음.'),
'KGM':(['https://www.kg-mobility.com/'],'KR','limited_readable_shell','source_found_not_extracted','공식KGM사이트제목확인,메인추출본문은추적태그뿐. KG모빌리티(쌍용)명의공식PDF조사자료가별도로있음. 원래제조사표기병합은보류.'),
'닛산':(['https://www.nissan.co.kr/'],'KR_service_and_legacy_support','body_verified','source_found_not_extracted','한국공식사이트는서비스센터·고객지원·서비스캠페인과국내철수계획안내중심. 현행신차전체트림원장으로사용할수없으며국내판매과거카탈로그가필요.'),
'대우':(['https://www.gm-korea.co.kr/ko/home.html'],'KR_successor_corporate_only','body_verified_successor_page_only','historical_brand_source_gap','기존레거시제조사표기를보존. 확인한GM한국기업페이지는대우차량의과거카탈로그·등급표가아니므로후속브랜드자료를대우등급으로자동매핑하지않음.'),
'람보르기니':(['https://www.lamborghini.com/ko-en'],'Korean_locale_global_specification','body_verified','source_found_not_extracted','한국어공식글로벌페이지와모델·역사메뉴확인. 사이트의사양지역은접속IP에따라달라질수있다고안내하므로한국인증·판매트림자료로자동간주하지않음.'),
'랜드로버':(['https://www.landroverkorea.co.kr/index.html'],'KR_site_with_global_specification_caution','body_verified','source_found_not_extracted','한국공식사이트와3개제품군링크확인. 사이트는유럽기준사양이한국판매사양과다를수있다고명시; 한국가격표·과거연식별브로셔를구분해야함.'),
'로터스':(['https://www.lotuscars.com/ko-KR'],'KR_locale_country_explicit','body_verified','source_found_not_extracted','페이지국가South Korea, 모델과Heritage메뉴직접확인. 모델페이지의국내판매트림및과거세대별자료추출은미완료.'),
'롤스로이스':(['https://www.rolls-roycemotorcars.com/ko_KR/home.html'],'KR_locale_global_brand_content','body_verified','source_found_not_extracted','한국어공식모델·프로비넌스메뉴확인. Bespoke구성과표준판매파생모델을분리하고과거국내판매명칭을추가확인해야함.'),
'르노코리아':(['https://www.renault.co.kr/'],'KR','homepage_forbidden_verified_pdfs_in_alias_research','source_found_not_extracted','공식메인직접요청은403. 르노코리아(삼성)명의별도자료집에는직접확인한공식가격표PDF가있음. 표기별자료행을자동합치지않음.'),
'링컨':(['https://www.lincoln-korea.com/','https://flak.co.kr/'],'KR_official_entry_redirect','redirect_to_unreadable_site','official_source_not_readable','이전공식한국진입주소가flak.co.kr로리디렉션되며현재도구에서본문0줄. 판매종료나트림없음으로해석하지않음; 과거한국브로셔및읽을수있는현행자료필요.'),
'마세라티':(['https://www.maserati.com/kr/ko'],'KR_locale','body_verified','source_found_not_extracted','공식한국지역모델·Legacy cars·문서메뉴확인. 한국판매엔진/트림별표와과거세대자료는아직추출하지않음.'),
'맥라렌':(['https://cars.mclaren.com/kr-ko','https://www.mclaren.com/cars/gl_en'],'GLOBAL_fallback_KR_path_unreadable','KR_path_unavailable_global_limited_shell','source_found_not_extracted','한국지역경로는읽기불가. 공식글로벌경로는새mclaren.com주소로연결되나소매점/뉴스레터위주의제한본문만읽힘. 글로벌모델을한국판매트림으로확정하지않음.'),
'미니':(['https://www.mini.co.kr/ko_KR/home.html'],'KR','body_verified','source_found_not_extracted','공식한국모델·제원·가격메뉴직접확인. 현재별도조사자료가생성되면동일제조사표기의기록건수에만반영.'),
'벤틀리':(['https://www.bentleymotors.com/en.html'],'GLOBAL_country_selector_includes_KR','body_verified','source_found_not_extracted','글로벌공식모델페이지와South Korea국가선택표시를확인. 한국용가격표/판매사양을직접추출한상태는아님.'),
'쉐보레':(['https://www.chevrolet.co.kr/'],'KR','body_verified','source_found_not_extracted','한국공식페이지·국내모델·카탈로그/가격표메뉴직접확인. 쉐보레(GM대우)명의조사자료와표기병합은자동수행하지않음.'),
'스바루':(['https://www.subaru.jp/'],'JP_only_KR_source_not_established','body_verified','source_found_not_extracted','일본공식모델·카탈로그·취급설명서메뉴확인. 일본내수등급을한국수입/등록차량등급으로옮기지않음; 과거한국판매및병행수입시장구분필요.'),
'스즈키':(['https://www.globalsuzuki.com/automobile/'],'GLOBAL_only_KR_source_not_established','body_verified','source_found_not_extracted','글로벌공식자동차모델목록직접확인. 국내자동차판매용모델·시장별명칭/등급은미확인. 이륜차한국사이트로자동대체하지않음.'),
'시트로엥':(['https://www.citroen-kr.com/'],'KR_service_links_with_FR_sales_template','body_verified_mixed_market','source_found_not_extracted','한국서비스/부품링크는확인됐으나판매본문은프랑스어및프랑스판매도메인으로연결됨. 이를현재한국판매모델목록으로간주하지않음; 과거국내브로셔필요.'),
'애스턴마틴':(['https://www.astonmartin.com/ko','https://www.astonmartin.com/en'],'GLOBAL_fallback_KR_path_unreadable','KR_path_unavailable_global_body_verified','source_found_not_extracted','한국어경로는읽기불가, 공식영문글로벌페이지확인. 한국시장판매사양과과거세대카탈로그는별도조사대상.'),
'인피니티':(['https://www.infiniti.co.kr/','https://www.infiniti.com/'],'GLOBAL_fallback_KR_access_failed','KR_timeout_global_body_verified','source_found_not_extracted','한국공식진입주소시간초과, 공식글로벌모델·Legacy Vehicles메뉴확인. 현재글로벌차종을과거한국판매트림에적용하지않음.'),
'재규어':(['https://www.jaguarkorea.co.kr/','https://www.jaguar.com/ko-kr/index.html'],'KR_locale_brand_and_owner_support','canonical_body_verified_original_redirect_failed','source_found_not_extracted','한국기존주소의리디렉션요청은실패했으나최종jaguar.com한국지역페이지본문을직접확인. 브랜드비전·오너지원·인증중고차중심이므로과거차종별판매트림확인필요.'),
'지프':(['https://www.jeep.co.kr/'],'KR','body_verified','source_found_not_extracted','공식한국홈페이지에국내한정판·모델·트림설명확인. 홈페이지광고만으로전세대/전연식등급원장이완성된것은아님.'),
'캐딜락':(['https://www.cadillac.co.kr/','https://news.chevrolet.co.kr/ko/chevrolet/newsroom.detail.html/Pages/news/kr/ko/2026/feb/0224_Feb_Cadillac_The-New-Escalade.html'],'KR','limited_readable_shell','source_found_not_extracted','공식한국페이지는열렸지만도구본문은전시장/견적/시승안내위주11줄. 전차종트림구성은확인되지않음; 별도공식가격표·뉴스룸필요.'),
'테슬라':(['https://www.tesla.com/ko_kr'],'KR_locale','unreadable_dynamic_shell','official_source_not_readable','공식대한민국페이지제목은확인되나본문0줄. 차량없음이나서비스장애로단정하지않음; 한국용구성기·사용설명서/과거모델자료의별도접근필요.'),
'페라리':(['https://www.ferrari.com/ko-KR/auto'],'KR_locale','javascript_verification_required','official_source_not_readable','공식한국지역페이지가자바스크립트인증화면을반환해모델본문미확인. 인증을우회하지않으며공식보도자료·과거모델아카이브를추가확인해야함.'),
'포드':(['https://www.ford.co.kr/','https://flak.co.kr/'],'KR_official_entry_redirect','redirect_to_unreadable_site','official_source_not_readable','이전공식한국진입주소가flak.co.kr로리디렉션되며현재도구본문0줄. 과거국내판매등급·현재수입사자료는미확인; 글로벌미국트림으로대체하지않음.'),
'포르쉐':(['https://www.porsche.com/korea/ko/'],'KR_locale','body_verified','source_found_not_extracted','공식한국모델페이지본문과일부모델주문불가안내확인. 현재주문·재고·단종모델과옵션/파생모델을구분한등급추출은미완료.'),
'폴스타':(['https://www.polestar.com/kr/'],'KR','body_verified','source_found_not_extracted','공식대한민국모델·주문·빠른출고메뉴확인. 배터리/모터/패키지별한국사양과연식별변경은미추출.'),
'푸조':(['https://www.epeugeot.co.kr/','https://www.peugeot.co.kr/'],'KR','canonical_body_verified_other_entry_unavailable','source_found_not_extracted','실제공식한국주소epeugeot.co.kr의국내모델·브로셔메뉴를직접확인. peugeot.co.kr경로는읽기불가. 과거디젤/전기·연식별트림추가조사필요.'),
'피아트':(['https://www.fiat.com/'],'GLOBAL_only_KR_source_not_established','body_verified','source_found_not_extracted','글로벌공식브랜드/모델안내직접확인. 현행글로벌상품명이나트림은과거국내정식판매명칭을대체하지못함. 한국판매과거카탈로그필요.'),
'혼다':(['https://auto.hondakorea.co.kr/','https://www.hondakorea.co.kr/'],'KR','auto_site_unavailable_notice_main_site_firewall','official_source_not_readable','공식자동차사이트는현재접속불가안내,기업메인과공식보관PDF요청은웹방화벽안내를반환. 검색발췌만으로과거CR-V표를현행한국전체트림으로승격하지않음.'),
}
aliases={'KGM':['KG모빌리티(쌍용)'],'KG모빌리티(쌍용)':['KGM'],'르노코리아':['르노코리아(삼성)'],'르노코리아(삼성)':['르노코리아'],'쉐보레':['쉐보레(GM대우)'],'쉐보레(GM대우)':['쉐보레','대우'],'대우':['쉐보레(GM대우)']}
out=[]
for b in baseline:
    make=b['make'];rows=saved.get(make,[])
    if make in checks:
        urls,market,status,research,note=checks[make]
    else:
        assert rows,('uncovered manufacturer',make)
        urls=[];market='KR_saved_official_research';status='verified_via_saved_research_evidence';research='current_research_available';note='같은제조사표기의공식조사자료에직접확인또는발췌등급행이있음. 출처파일의개별evidenceStatus와시장·연식범위를따라야함.'
    if rows:
        research='current_research_available' if any(r.get('market','KR')=='KR' for _,r in rows) else 'global_reference_only'
        for _,row in rows:
            if row.get('sourceUrl') and row['sourceUrl'] not in urls:urls.append(row['sourceUrl'])
        note+=' 별도자료행이있다는뜻이며브랜드전체·과거전연식자료가완료됐다는뜻은아님.'
    item={'make':make,'sourceUrls':urls,'marketScope':market,'accessStatus':status,'researchStatus':research,'notes':note,'checkedAt':observedAt,'researchRecords':len(rows),'researchFiles':sorted({name for name,_ in rows}),'evidenceCounts':dict(collections.Counter(r.get('evidenceStatus','unspecified') for _,r in rows)),'historicalCoverageComplete':False,'allTrimsComplete':False,'baselineModelGroups':b['model_groups'],'baselineGenerationsWithoutTrim':b['generations_without_trim']}
    item['initialSourceCheckNote']=note
    item['notes']='초기 자료원 접근 결과는 initialSourceCheckNote와 checkedAt에 보존한다. 아래의 현재 관측 건수는 원문의 시장·국가·근거 수준별로 해석하며, 전체 연식·등급 완성을 뜻하지 않는다.'
    item['koreanMarketResearchRecords']=sum(r.get('market','KR')=='KR' for _,r in rows)
    item['otherMarketResearchRecords']=len(rows)-item['koreanMarketResearchRecords']
    if make in aliases:item['aliasCandidates']=aliases[make];item['aliasAutoMerged']=False
    if not rows:item['nextNeeded']='한국시장별공식가격표·카탈로그·판매보도자료의모델/연식/엔진/트림연결추출. 단종세대는당시자료추가필요.'
    out.append(item)
assert len(out)==46
assert {r['make'] for r in out}=={r['make'] for r in baseline}
ledger={'schemaVersion':1,'asOf':'2026-11-06','scope':'기존번들의46개제조사표기를모두추적하는공식자료원발견·접근성원장. 별칭을포함한표기수이며46개독립법인수나전체등급수집완료를의미하지않음.','completedScope':'기존46개표기에대한자료원/접근성/추출상태기록','taxonomyCompletenessKnown':False,'autoImport':False,'statusMeaning':{'current_research_available':'동일make표기로별도자료집에구체적관측행이있음. 전체브랜드/전연식완성아님.','source_found_not_extracted':'공식자료원은찾았지만이make의등급자료행추출미완료.','official_source_not_readable':'공식진입점은있으나현재도구에서인증/스크립트/방화벽/리디렉션/접속불가로모델본문미확인.','historical_brand_source_gap':'후속회사기업자료만확인;원래레거시브랜드차량별당시자료미확보.'},'method':'2026-11-06공식사이트직접읽기. 이미동일작업에서본문을직접확인해별도자료로저장한출처는그자료파일을재사용. 홈페이지·모델메뉴만확인한경우등급데이터추출성공으로세지않음.','requirementsForCompletion':['각표기의한국정식판매·병행수입·해외내수시장을구분','단종세대및연식별엔진/트림/패키지변경의당시공식자료확인','공급자분류코드·부모관계가없으면새코드나임의단계를생성하지않음','KGM·르노코리아·쉐보레의다른표기는검토전까지자동병합금지','자료접근실패는차량/등급없음을뜻하지않음'], 'manufacturers':out,'summary':{'manufacturerLabels':len(out),'withResearchRows':sum(bool(x['researchRecords']) for x in out),'researchStatusCounts':dict(collections.Counter(x['researchStatus'] for x in out)),'allTrimsComplete':False}}
ledger['asOf']='2026-11-07'
ledger['statusMeaning']['global_reference_only']='해외 시장의 관측만 있으며, 한국 판매사양 확인 자료로 전환하지 않는다.'
ledger['summary']['withKoreanMarketRows']=sum(x['koreanMarketResearchRecords']>0 for x in out)
(root/'sources/brand-source-ledger.json').write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(ledger['summary'],ensure_ascii=False))
