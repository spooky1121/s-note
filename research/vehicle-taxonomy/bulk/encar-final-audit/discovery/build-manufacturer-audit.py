#!/usr/bin/env python3
"""Compare complete rendered Encar price-search choices with research snapshots.

All relations are label candidates. A maker match does not verify generations,
retail grades, year/engine compatibility, or an automatic database merge.
Only pinned observed source labels/actual linked maker URLs are used.
"""
from pathlib import Path
import argparse
from collections import Counter, defaultdict
import csv
import gzip
import hashlib
import json
import re
import unicodedata


BASELINE_ALIASES = {
    'DS':['시트로엥/DS'], '시트로엥':['시트로엥/DS'],
    'KGM':['KG모빌리티(쌍용)'], '르노코리아':['르노코리아(삼성)'],
    '대우':['쉐보레(GM대우)'], '쉐보레':['쉐보레(GM대우)'],
    '토요타':['도요타'],
}

# Researcher-declared spelling/corporate-label candidates, not provider aliases.
# Original names remain separate and every multi-choice match is retained.
GOV_ALIASES = {
 '현대':['HYUNDAI','현대자동차','현대자동차(주)'],
 '제네시스':['GENESIS'],
 '기아':['KIA','기아자동차','기아자동차(주)'],
 '쉐보레(GM대우)':['쉐보레','GM대우','대우','한국지엠','지엠대우','GM DAEWOO','GMDAEWOO','한국GM','한국지엠(주)'],
 '르노코리아(삼성)':['르노코리아','르노삼성','르노코리아자동차','르노삼성자동차'],
 'KG모빌리티(쌍용)':['KG모빌리티','쌍용','KGM','쌍용자동차'],
 '벤츠':['MERCEDES-BENZ','MERCEDES BENZ','MERCEDESBENZ','MERCEDES-AMG'],
 '아우디':['AUDI'], '포르쉐':['PORSCHE'], '랜드로버':['LANDROVER','LAND ROVER'],
 '미니':['MINI'], 'BYD':['비야디'], '닛산':['NISSAN'],
 '다이하쯔':['다이하츠','DAIHATSU'], '닷지':['DODGE'],
 '도요타':['토요타','TOYOTA'], '람보르기니':['LAMBORGHINI'], '렉서스':['LEXUS'],
 'MG로버':['MG ROVER','MGROVER','로버','ROVER'], '로터스':['LOTUS'],
 '롤스로이스':['ROLLS-ROYCE','ROLLS ROYCE','ROLLSROYCE'], '르노':['RENAULT'],
 '링컨':['LINCOLN'], '마세라티':['MASERATI'], '마이바흐':['MAYBACH'],
 '마쯔다':['마쓰다','MAZDA'], '맥라렌':['MCLAREN'], '머큐리':['MERCURY'],
 '미쯔비시':['미쓰비시','MITSUBISHI'], '미쯔오까':['미쓰오카','MITSUOKA'],
 '벤틀리':['BENTLEY'], '볼보':['VOLVO'], '부가티':['BUGATTI'],
 '북기은상':['BAIC','BEIQIYINXIANG','BEIQI YINXIANG'], '뷰익':['BUICK'],
 '사브':['SAAB'], '사이언':['SCION'], '새턴':['SATURN'],
 '쉐보레':['CHEVROLET'], '스마트':['SMART'], '스바루':['SUBARU'], '스즈키':['SUZUKI'],
 '시트로엥/DS':['시트로엥','시트로엥(DS)','CITROEN','DS'],
 '알파 로메오':['알파로메오','ALFA ROMEO','ALFAROMEO'],
 '애스턴마틴':['애스턴 마틴','ASTONMARTIN','ASTON MARTIN'],
 '어큐라':['ACURA'], '오펠':['OPEL'], '올즈모빌':['OLDSMOBILE'],
 '이스즈':['ISUZU'], '인피니티':['INFINITI'], '재규어':['JAGUAR'], '지프':['JEEP'],
 '캐딜락':['CADILLAC'], '코닉세그':['KOENIGSEGG'], '크라이슬러':['CHRYSLER'],
 '파가니':['PAGANI'], '페라리':['FERRARI'], '포드':['FORD'], '포톤':['FOTON'],
 '폭스바겐':['VOLKSWAGEN'], '폰티악':['PONTIAC'], '폴스타':['POLESTAR'],
 '푸조':['PEUGEOT'], '피아트':['FIAT'], '험머':['HUMMER'], '혼다':['HONDA'],
}
GENERIC_BUCKETS = {'기타 제조사','기타 수입차'}


def key(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', str(value or '')).casefold())


def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as incoming:
        for block in iter(lambda:incoming.read(1024*1024),b''):
            h.update(block)
    return h.hexdigest()


def write(path, value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def table(path, rows, fields):
    with path.open('w',encoding='utf-8-sig',newline='') as output:
        writer=csv.DictWriter(output,fieldnames=fields,lineterminator='\r\n')
        writer.writeheader()
        for row in rows:
            values={k:row.get(k) for k in fields}
            for k,v in values.items():
                if isinstance(v,(list,dict)):
                    values[k]=json.dumps(v,ensure_ascii=False,separators=(',',':'))
                if isinstance(values[k],str) and values[k].lstrip().startswith(('=','+','-','@')):
                    values[k]="'"+values[k]
            writer.writerow(values)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--observed',type=Path,required=True)
    p.add_argument('--baseline',type=Path,required=True)
    p.add_argument('--research',type=Path,required=True)
    p.add_argument('--government',type=Path,required=True)
    p.add_argument('--output-dir',type=Path,required=True)
    p.add_argument('--expected-government-sha256',default='b725edb280b148042a461244eade9dd2d42fd2e4ebe773dbbdf238d10426cea6')
    a=p.parse_args();a.output_dir.mkdir(parents=True,exist_ok=True)
    government_sha=sha(a.government)
    assert government_sha==a.expected_government_sha256
    observed=json.loads(a.observed.read_text());pages=observed['manufacturers']
    assert len(pages)==70 and all(x['completeRenderedPageCaptured']for x in pages)
    assert len({(x['carTypeRaw'],x['manufacturerCodeObservedInLinkedUrl'])for x in pages})==70
    baseline=json.loads(a.baseline.read_text())['records']
    research=json.loads(a.research.read_text())['records']
    baseline_makes=sorted({r['make']for r in baseline})
    research_makes=sorted({r['make']for r in research})
    choices={r['manufacturerNameRaw']:r for r in pages}

    def choice_hit(page,method):
        return {'manufacturerNameRaw':page['manufacturerNameRaw'],'carTypeRaw':page['carTypeRaw'],
                'manufacturerCodeObservedInLinkedUrl':page['manufacturerCodeObservedInLinkedUrl'],
                'sourceUrl':page['sourceUrl'],'matchMethod':method,'canonicalMappingApproved':False}

    def candidates(label):
        result=[]
        for name,page in choices.items():
            if key(name)==key(label):
                result.append(choice_hit(page,'same_normalized_display_label'))
            elif name in BASELINE_ALIASES.get(label,[]):
                result.append(choice_hit(page,'researcher_declared_alias_candidate'))
        return result

    baseline_rows=[]
    for make in baseline_makes:
        hits=candidates(make)
        baseline_rows.append({'make':make,'baselineRows':sum(r['make']==make for r in baseline),
          'status':'same_label_candidate'if any(r['matchMethod']=='same_normalized_display_label'for r in hits)else'declared_alias_candidate'if hits else'not_in_price_selector',
          'candidateChoiceCount':len(hits),'candidates':hits,'canonicalMappingApproved':False,
          'note':'Absence is only from this price-search choice list, not from all Encar sales classifiers. Multiple choice candidates are never automatically merged.'})
    maker_rows=[]
    for page in pages:
        name=page['manufacturerNameRaw']
        baseline_hits=[r['make']for r in baseline_rows if any(h['manufacturerNameRaw']==name for h in r['candidates'])]
        research_hits=[m for m in research_makes if any(h['manufacturerNameRaw']==name for h in candidates(m))]
        maker_rows.append({'manufacturerNameRaw':name,'carTypeRaw':page['carTypeRaw'],
          'manufacturerCodeObservedInLinkedUrl':page['manufacturerCodeObservedInLinkedUrl'],
          'sourceUrl':page['sourceUrl'],'recordKind':'generic_selector_bucket'if name in GENERIC_BUCKETS else'manufacturer_selector_choice',
          'baselineMakeCandidates':baseline_hits,'curatedMakeCandidates':research_hits,
          'baselineCandidateRows':sum(r['make']in baseline_hits for r in baseline),
          'curatedKoreanMarketCandidateRows':sum(r['make']in research_hits and r.get('market')=='KR' for r in research),
          'curatedOtherMarketCandidateRows':sum(r['make']in research_hits and r.get('market')!='KR' for r in research),
          'modelGroupNameListRows':sum(r['displayGroupRaw']=='이름순'for r in page['rows']),
          'popularModelGroupAppearances':sum(r['displayGroupRaw']=='인기모델'for r in page['rows']),
          'canonicalMappingApproved':False})
    group_rows=[]
    for page in pages:
        make_row=next(m for m in maker_rows if m['manufacturerNameRaw']==page['manufacturerNameRaw'])
        for row in page['rows']:
            matches=sorted({(r['make'],r['group'])for r in baseline if r['make']in make_row['baselineMakeCandidates']and key(r['group'])==key(row['groupNameRaw'])})
            group_rows.append({'manufacturerNameRaw':page['manufacturerNameRaw'],
              'manufacturerCodeObservedInLinkedUrl':page['manufacturerCodeObservedInLinkedUrl'],
              'carTypeRaw':page['carTypeRaw'],'sourceUrl':page['sourceUrl'],**row,
              'baselineSameFamilyLabelCandidates':[{'make':m,'group':g}for m,g in matches],
              'sourceRowKind':'generic_other_bucket'if row['groupNameRaw']=='기타' else'reserved_or_unused_placeholder'if row['groupNameRaw']in ['-','미사용',''] else'rendered_model_group_name',
              'retailGenerationOrGradeVerified':False,'modelGroupCode':None})

    government=defaultdict(lambda:{'count':0,'examples':[]})
    with gzip.open(a.government,'rt',encoding='utf-8')as incoming:
        count=0
        for line in incoming:
            row=json.loads(line);count+=1
            raw=row['fieldsRaw'].get('제작사')
            item=government[raw];item['count']+=1
            if len(item['examples'])<3:
                item['examples'].append({'sourceSheet':row['sourceSheet'],'sourceRow':row['sourceRow'],'manufacturerRaw':raw})
    assert count==105383
    tax_rows=[]
    for label,occ in sorted(government.items(),key=lambda x:str(x[0])):
        hits=[]
        for name,page in choices.items():
            if name in GENERIC_BUCKETS:continue
            if key(name)==key(label):hits.append(choice_hit(page,'same_normalized_display_label'))
            elif key(label)in{key(value)for value in GOV_ALIASES.get(name,[])}:
                hits.append(choice_hit(page,'researcher_declared_spelling_or_corporate_label_candidate'))
        tax_rows.append({'governmentManufacturerRaw':label,'governmentObservationRows':occ['count'],
          'candidateChoiceCount':len(hits),'candidates':hits,
          'status':'label_candidates_found'if hits else'no_candidate_under_declared_label_rules',
          'sourceExamples':occ['examples'],'sourceExamplesAreExhaustive':False,
          'exhaustiveReferencesIn':{'logicalRepositoryPath':'research/vehicle-taxonomy/bulk/government-tax-2026/amended/vehicle-records.raw.jsonl.gz','sha256':government_sha},
          'canonicalMappingApproved':False,'retailGradeVerified':False})
    result={'schemaVersion':1,'checkedAtUtc':observed['checkedAtUtc'],
      'sourceScope':observed['scope'],'runtimeImportEnabled':False,'completeOfficialMaster':False,
      'counts':{'baselineMakeLabels':len(baseline_rows),'baselineLabelStates':dict(Counter(r['status']for r in baseline_rows)),
        'encarPriceManufacturerChoices':len(maker_rows),'encarGenericBuckets':sum(r['recordKind']=='generic_selector_bucket'for r in maker_rows),
        'encarChoicesWithoutBaselineCandidate':sum(not r['baselineMakeCandidates']and r['recordKind']!='generic_selector_bucket'for r in maker_rows),
        'modelGroupDisplayAppearances':len(group_rows),'modelGroupNameListRows':sum(r['displayGroupRaw']=='이름순'for r in group_rows),
        'modelGroupNameListRowsWithBaselineSameFamilyLabelCandidates':sum(r['displayGroupRaw']=='이름순' and bool(r['baselineSameFamilyLabelCandidates']) for r in group_rows),
        'modelGroupNameListRowsWithoutBaselineSameFamilyLabelCandidates':sum(r['displayGroupRaw']=='이름순' and not r['baselineSameFamilyLabelCandidates'] for r in group_rows),
        'modelGroupNameListPlaceholderOrOtherRows':sum(r['displayGroupRaw']=='이름순' and r['sourceRowKind']!='rendered_model_group_name'for r in group_rows),
        'modelGroupNameListNonPlaceholderRows':sum(r['displayGroupRaw']=='이름순' and r['sourceRowKind']=='rendered_model_group_name'for r in group_rows),
        'modelGroupNonPlaceholderNameRowsWithoutSameBaselineFamilyCandidate':sum(r['displayGroupRaw']=='이름순' and r['sourceRowKind']=='rendered_model_group_name' and not r['baselineSameFamilyLabelCandidates']for r in group_rows),
        'governmentObservationRows':count,'governmentRawMakerLabels':len(tax_rows),
        'governmentRawLabelsWithChoiceCandidates':sum(bool(r['candidates'])for r in tax_rows),
        'governmentRawLabelsWithoutChoiceCandidate':sum(not r['candidates']for r in tax_rows),
        'verifiedRetailGradesAdded':0,'automaticallyMergedMakers':0},
      'limitations':[
        'The price-search chooser is a service-specific subset; Tesla is not shown there although Tesla models occur in Encar model-name search.',
        'Government maker labels also include bodybuilders, importers and motorcycles; unmatched labels are not proof of missing retail car manufacturers.',
        'Manufacturer spelling/corporate aliases are declared review candidates, not provider-approved canonical merges.',
        'Same family display labels cannot verify generations, fuel/engine, model year, grade/subgrade or full historical availability.',
        'Popular section duplicates remain original display observations and are never counted as additional families.',
        'Other/unused/hyphen source options are preserved as generic or reserved placeholders, not real model groups.',
        'Candidate counts can overlap between differently scoped choices, notably Korean versus imported Chevrolet; do not sum them as distinct models.',
      ],
      'inputs':[{'role':role,'filename':path.name,'bytes':path.stat().st_size,'sha256':sha(path)}for role,path in[('observed',a.observed),('baseline',a.baseline),('research',a.research),('government',a.government)]],
      'baselineManufacturerComparison':baseline_rows,'encarManufacturerCoverage':maker_rows,
      'governmentMakerLabelComparison':tax_rows}
    write(a.output_dir/'manufacturer-comparison.json',result)
    write(a.output_dir/'declared-alias-candidates.json',{'baselineAliases':BASELINE_ALIASES,'governmentAliases':GOV_ALIASES,'canonicalMappingApproved':False})
    table(a.output_dir/'baseline-manufacturer-comparison.csv',baseline_rows,['make','baselineRows','status','candidateChoiceCount','candidates','canonicalMappingApproved','note'])
    table(a.output_dir/'encar-manufacturer-coverage.csv',maker_rows,list(maker_rows[0]))
    table(a.output_dir/'model-group-observations.csv',group_rows,list(group_rows[0]))
    table(a.output_dir/'government-maker-comparison.csv',tax_rows,list(tax_rows[0]))
    write(a.output_dir/'model-group-comparison.json',{'schemaVersion':1,'scope':observed['scope'],'rows':group_rows,'retailHierarchyVerified':False})
    write(a.output_dir/'summary.json',{k:v for k,v in result.items()if k not in ['baselineManufacturerComparison','encarManufacturerCoverage','governmentMakerLabelComparison']})
    print(json.dumps(result['counts'],ensure_ascii=False))


if __name__=='__main__':
    main()
