#!/usr/bin/env python3
"""Read-only completeness and preservation checks for the manufacturer audit."""
from pathlib import Path
import argparse
from collections import Counter
import csv
import hashlib
import json
import re


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory',type=Path,default=Path(__file__).resolve().parent)
    p.add_argument('--output',type=Path)
    a=p.parse_args();root=a.directory
    obs=json.loads((root/'manufacturer-model-group-observations.json').read_text())
    result=json.loads((root/'derived/manufacturer-comparison.json').read_text())
    groups=json.loads((root/'derived/model-group-comparison.json').read_text())['rows']
    pages=obs['manufacturers'];assert len(pages)==70
    assert Counter(x['displayGroupRaw']for x in obs['observations'])=={'국산차':7,'수입차 인기 제조사':6,'수입차 이름순':63}
    assert len({(x['carTypeRaw'],x['manufacturerCodeObservedInLinkedUrl'])for x in pages})==70
    reconstructed=[]
    for page in pages:
        lines=page['bodyLines']
        assert {r['sourceLine']for r in lines}==set(range(65,page['responseTotalLines']))
        parsed=[];section=None
        for row in lines:
            if row['text'].startswith('#### '):section=row['text'][5:].strip()
            m=re.fullmatch(r'\*\s+【(\d+)†([^】]+)】',row['text'])
            if m and section in ['인기모델','이름순']:
                parsed.append((row['sourceLine'],section,m.group(2),int(m.group(1))))
        assert parsed==[(r['sourceLine'],r['displayGroupRaw'],r['groupNameRaw'],r['renderedLinkId'])for r in page['rows']],page['manufacturerNameRaw']
        assert page['renderedBodyLineCoverage']['missingLineCount']==0
        assert page['completeRenderedPageCaptured']is True
        assert re.search(r'[?&]mnfccd='+page['manufacturerCodeObservedInLinkedUrl']+r'(?:&|$)',page['sourceUrl'])
        assert re.search(r'[?&]carType='+page['carTypeRaw']+r'(?:&|$)',page['sourceUrl'])
        reconstructed.extend((page['manufacturerNameRaw'],page['sourceUrl'],*r)for r in parsed)
    assert len(reconstructed)==1334
    assert reconstructed==[(r['manufacturerNameRaw'],r['sourceUrl'],r['sourceLine'],r['displayGroupRaw'],r['groupNameRaw'],r['renderedLinkId'])for r in groups]
    assert sum(r['displayGroupRaw']=='이름순'for r in groups)==1124
    assert sum(r['displayGroupRaw']=='인기모델'for r in groups)==210
    assert all(r['modelGroupCode']is None and r['retailGenerationOrGradeVerified']is False for r in groups)
    assert len(result['baselineManufacturerComparison'])==46
    assert Counter(r['status']for r in result['baselineManufacturerComparison'])=={'same_label_candidate':39,'declared_alias_candidate':6,'not_in_price_selector':1}
    assert [r['make']for r in result['baselineManufacturerComparison']if not r['candidates']]==['테슬라']
    assert len(result['governmentMakerLabelComparison'])==2065
    assert sum(r['governmentObservationRows']for r in result['governmentMakerLabelComparison'])==105383
    assert not result['runtimeImportEnabled'] and not result['completeOfficialMaster']
    valid={(x['manufacturerNameRaw'],x['sourceUrl'],x['manufacturerCodeObservedInLinkedUrl'])for x in pages}
    for row in result['baselineManufacturerComparison']+result['governmentMakerLabelComparison']:
        assert row['canonicalMappingApproved']is False
        for hit in row['candidates']:
            assert (hit['manufacturerNameRaw'],hit['sourceUrl'],hit['manufacturerCodeObservedInLinkedUrl'])in valid
            assert hit['canonicalMappingApproved']is False
    for name,expected in [('baseline-manufacturer-comparison.csv',46),('encar-manufacturer-coverage.csv',70),('model-group-observations.csv',1334),('government-maker-comparison.csv',2065)]:
        with (root/'derived'/name).open(encoding='utf-8-sig',newline='')as handle:
            rows=list(csv.DictReader(handle))
        assert len(rows)==expected,(name,len(rows),expected)
        if name=='model-group-observations.csv':
            for saved,original in zip(rows,groups):
                for key in ['manufacturerNameRaw','manufacturerCodeObservedInLinkedUrl','groupNameRaw','sourceUrl']:
                    value=original[key]
                    expected="'"+value if value.lstrip().startswith(('=','+','-','@')) else value
                    assert saved[key]==expected,(key,saved[key],expected)
    observed_meta=next(x for x in result['inputs']if x['role']=='observed')
    original=(root/'manufacturer-model-group-observations.json').read_bytes()
    assert len(original)==observed_meta['bytes'] and hashlib.sha256(original).hexdigest()==observed_meta['sha256']
    summary={'ok':True,'errors':0,'manufacturerPagesFullyRead':70,'manufacturerAppearancesPreserved':76,
      'allRenderedBodyLinePositionsPreserved':True,'groupAppearancesReparsedExactly':1334,
      'groupNameListRows':1124,'popularDuplicateAppearances':210,'baselineLabelsChecked':46,
      'governmentMakerRawLabelsChecked':2065,'governmentObservationRowsAccountedFor':105383,
      'sourceChoiceCodeAndUrlConsistency':True,'allCsvRowCountsAndGroupSourceParity':True,
      'retailGradesVerified':0,'canonicalMakersAutomaticallyMerged':0}
    if a.output:a.output.write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(summary,ensure_ascii=False))


if __name__=='__main__':
    main()
