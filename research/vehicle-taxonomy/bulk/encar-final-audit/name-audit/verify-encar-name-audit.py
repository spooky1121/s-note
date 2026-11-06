#!/usr/bin/env python3
"""Read-only exhaustive source-reference, relation, CSV and hash verification.

Deliberately does not import the producer. Predicate reconstruction follows the
published audit rules and checks every emitted row, not samples.
"""
from pathlib import Path
from collections import Counter, defaultdict
import csv
import gzip
import hashlib
import io
import json
import re
import sys
import unicodedata
from functools import lru_cache

def load(p):
    return json.loads(Path(p).read_text())

def rows(p):
    with gzip.open(p,'rt',encoding='utf-8') as f:
        return [json.loads(line) for line in f]

def h(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

@lru_cache(maxsize=None)
def norm(s):
    return ' '.join(unicodedata.normalize('NFKC',str(s or '')).casefold().split())

@lru_cache(maxsize=None)
def flat(s):
    return re.sub(r'[\s()\[\]{}._\-·ㆍ/]+','',norm(s))

@lru_cache(maxsize=None)
def group_pattern(group):
    return re.compile(r'(?<![가-힣a-z0-9])'+re.escape(group)+r'(?![가-힣a-z0-9])')

@lru_cache(maxsize=None)
def group_occurs(group,name):
    return bool(group_pattern(group).search(name))

def tabvalue(v):
    if v is None:return ''
    if isinstance(v,bool):return str(v).lower()
    if isinstance(v,(dict,list)):v=json.dumps(v,ensure_ascii=False,separators=(',',':'))
    result=str(v)
    return "'"+result if result.lstrip().startswith(('=','+','-','@')) else result

def verify(out, repo, source, builder, output):
    out,repo,source,builder,output=map(Path,[out,repo,source,builder,output])
    summary=load(out/'summary.json');manifest=load(out/'manifest.json')
    source_data=load(source);index=source_data['modelIndex']['records'];old=load(repo/'research/vehicle-taxonomy/sources/encar-public-catalog-expansion-20261106.json')['modelIndex']['records']
    assert index==old
    assert len(index)==1858 and len({r['modelNameRaw']for r in index})==1805
    assert h(builder)==manifest['builder']['sha256']
    for e in manifest['files']:
        p=out/e['path'];assert p.stat().st_size==e['bytes'] and h(p)==e['sha256'],str(p)
    snapshot=next((out/'input-snapshots').glob('encar-source.*.raw.gz'))
    assert hashlib.sha256(gzip.decompress(snapshot.read_bytes())).hexdigest()==h(source)==manifest['inputs']['encar']['sha256']
    frozen_inputs={}
    for key in ['encar','baseline','research']:
        snapshot=out/'input-snapshots'/(key+'-source.'+manifest['inputs'][key]['sha256'][:12]+'.raw.gz')
        payload=gzip.decompress(snapshot.read_bytes());assert hashlib.sha256(payload).hexdigest()==manifest['inputs'][key]['sha256']
        if payload.startswith(b'\x1f\x8b'):payload=gzip.decompress(payload)
        frozen_inputs[key]=json.loads(payload)
    assert frozen_inputs['encar']==source_data
    base_raw=frozen_inputs['baseline']['records']
    research_raw=frozen_inputs['research']['records']
    government_path=repo/'research/vehicle-taxonomy/bulk/government-tax-2026/amended/vehicle-records.raw.jsonl.gz'
    assert h(government_path)==manifest['inputs']['government']['sha256']
    government=rows(government_path)
    assert len(government)==105383
    display=rows(out/'encar-display-name-ledger.jsonl.gz')
    base=rows(out/'baseline-model-ledger.jsonl.gz')
    research=rows(out/'research-record-ledger.jsonl.gz')
    links=rows(out/'government-name-links.jsonl.gz')
    assert len(display)==1858 and len(base)==1197 and len(research)==len(research_raw) and len(links)==29766
    raw_by_name=defaultdict(list)
    for r in index:raw_by_name[r['modelNameRaw']].append(r['displayOrdinal'])
    b_source=defaultdict(list)
    for i,r in enumerate(base_raw,1):b_source[(r['make'],r['group'],r['model'])].append((i,r))
    b_map={r['targetId']:r for r in base};r_map={r['researchId']:r for r in research};r_source={r['researchId']:r for r in research_raw}
    prior_b=load(repo/'research/vehicle-taxonomy/bulk/government-tax-2026/crosswalk/amended-2026-reviewed/target-ledger.json')['targets']
    prior_ids={(r['make'],r['group'],r['model']):r['targetId']for r in prior_b}
    for row in base:
        key=(row['make'],row['group'],row['model']);raw=b_source[key]
        assert row['targetId']==prior_ids[key]
        assert row['baselinePositions']==[i for i,_ in raw]
        assert row['baselineGradeValues']==list(dict.fromkeys(r.get('grade')for _,r in raw))
        assert row['baselineMarketValues']==list(dict.fromkeys(r.get('market')for _,r in raw))
    for row in research:
        source_row=r_source[row['researchId']]
        for key in ['make','group','model','market','sourceMarket','sourceId','sourceUrl','evidenceStatus','sourcePublicationDate','modelYear']:
            assert row[key]==source_row.get(key),(row['researchId'],key)
        assert row['declaredModelAliases']==source_row.get('sourceRecord',{}).get('modelAliasCandidates',[])
    expected_reverse_b=defaultdict(list);expected_reverse_r=defaultdict(list)
    priority={'literal_name_equal':0,'nfkc_whitespace_casefold_equal':1,'declared_alias_equal':2,'presentation_folded_equal_hint':3,'family_group_equal_hint':4,'family_group_contained_hint':5,'model_name_prefix_in_longer_tax_name_hint':6}
    distinct_display={}
    edge_count=Counter()
    for position,row in enumerate(display,1):
        original=index[position-1];name=original['modelNameRaw']
        assert row['encarDisplayOrdinal']==position and row['encarModelNameRaw']==name and row['encarSourceRowRaw']==original
        assert row['duplicateRawLabelOrdinals']==raw_by_name[name] and row['duplicateRawLabelCount']==len(raw_by_name[name])
        assert row['encarManufacturerProvided']is False and row['manufacturerRelationVerified']is False and row['modelGenerationRelationVerified']is False
        assert row['retailGradeCoverageVerified']is False and row['automaticRuntimeImport']is False
        assert row['genericLabel']==(norm(name)=='기타')
        assert row['baselineMatchCount']==len(row['baselineMatches']) and row['researchMatchCount']==len(row['researchMatches'])
        if name in distinct_display:
            prior=distinct_display[name]
            for key in row:
                if key not in ['encarDisplayOrdinal','encarSourceRowRaw']:assert row[key]==prior[key],(name,key)
            continue
        distinct_display[name]=row
        for kind,target_map,reverse,key_name in [('baselineMatches',b_map,expected_reverse_b,'targetId'),('researchMatches',r_map,expected_reverse_r,'researchId')]:
            assert len({m[key_name]for m in row[kind]})==len(row[kind])
            actual={m[key_name]:m for m in row[kind]}
            # Reconstruct all target match predicates; generic names never acquire model relations.
            for target_id,target in target_map.items():
                methods=[]
                if norm(name)!='기타':
                    if name==target['model']:methods.append('literal_name_equal')
                    elif norm(name)==norm(target['model']):methods.append('nfkc_whitespace_casefold_equal')
                    aliases=target.get('declaredModelAliases',[])
                    if kind=='researchMatches' and norm(name)in{norm(v)for v in aliases}:methods.append('declared_alias_equal')
                    if not methods and (flat(name)==flat(target['model']) or (kind=='researchMatches'and flat(name)in{flat(v)for v in aliases})):
                        methods.append('presentation_folded_equal_hint')
                    group=norm(target['group'])
                    if group:
                        if norm(name)==group:methods.append('family_group_equal_hint')
                        elif len(group)>=2 and group_occurs(group,norm(name)):
                            methods.append('family_group_contained_hint')
                if methods:
                    match=actual.pop(target_id)
                    assert match['matchMethods']==sorted(set(methods),key=priority.__getitem__)
                    assert match['bestMatchMethod']==min(methods,key=priority.__getitem__)
                    for key in ['make','group','model']:assert match[key]==target[key]
                    reverse[target_id].append({'encarNameRaw':name,'encarDisplayOrdinals':raw_by_name[name],'matchMethods':match['matchMethods'],'bestMatchMethod':match['bestMatchMethod']})
                    edge_count[kind]+=1
            assert not actual
    for target_map,reverse in [(b_map,expected_reverse_b),(r_map,expected_reverse_r)]:
        for target_id,row in target_map.items():
            assert row['encarNameMatches']==reverse[target_id]
            assert row['matchedDisplayRows']==sum(len(x['encarDisplayOrdinals'])for x in reverse[target_id])
            assert row['completionStatus']=='not_attested' and row['retailGradeCoverageVerified']is False and row['encarParentVerified']is False and row['automaticRuntimeImport']is False
    gov_map={(r['sourceSheet'],r['sourceRow']):(i,r)for i,r in enumerate(government,1)}
    assert len(gov_map)==105383
    gov_pairs={};gov_counts=defaultdict(Counter);gov_makers=defaultdict(set);gov_source_rows=defaultdict(set)
    for link in links:
        position,raw=gov_map[(link['sourceSheet'],link['sourceRow'])];fields=raw['fieldsRaw'];name=link['encarNameRaw'];field=link['nameFieldRaw']
        assert field in ['차명','기종명'] and field in fields
        for left,right in [('governmentNameRaw',fields[field]),('governmentRawPosition',position),('manufacturerRaw',fields.get('제작사')),('formRaw',fields.get('형식')),('nameCellTypeRaw',raw.get('fieldCellTypesRaw',{}).get(field)),('sourceSerialRaw',fields.get('연번')),('serialMissing',raw.get('serialMissing',False)),('sourceYear',raw.get('sourceYear'))]:
            assert link[left]==right,(link['linkId'],left)
        assert link['governmentInputSha256']==manifest['inputs']['government']['sha256']
        assert link['encarDisplayOrdinals']==raw_by_name[name] and link['manufacturerRelationVerified']is False and link['retailHierarchyVerified']is False and link['sourceYearIsModelYear']is False and link['automaticRuntimeImport']is False
        raw_name=fields[field]
        if name==raw_name:method='literal_name_equal'
        elif norm(name)==norm(raw_name):method='nfkc_whitespace_casefold_equal'
        elif flat(name)==flat(raw_name):method='presentation_folded_equal_hint'
        else:
            assert len(flat(name))>=3 and not flat(name).isnumeric() and flat(raw_name).startswith(flat(name)) and len(flat(raw_name))>len(flat(name))
            method='model_name_prefix_in_longer_tax_name_hint'
        assert link['matchMethods']==[method] and link['bestMatchMethod']==method
        key=(name,position);assert key not in gov_pairs;gov_pairs[key]=method
        gov_counts[name][method]+=1;gov_makers[name].add(str(fields.get('제작사')));gov_source_rows[name].add(position)
    # Independent brute lexical completeness scan, indexed by first folded character;
    # no producer trie or emitted candidate subset is reused.
    raw_idx=defaultdict(set);norm_idx=defaultdict(set);fold_idx=defaultdict(set);prefix_idx=defaultdict(list)
    for name in raw_by_name:
        if norm(name)=='기타':continue
        raw_idx[name].add(name);norm_idx[norm(name)].add(name);fold_idx[flat(name)].add(name)
        if len(flat(name))>=3 and not flat(name).isnumeric():prefix_idx[flat(name)[0]].append((flat(name),name))
    expected_pair_count=0
    for position,raw in enumerate(government,1):
        fields=raw['fieldsRaw'];field=next(k for k in ['차명','기종명']if k in fields);name=fields[field];n=norm(name);f=flat(name)
        matches=set(raw_idx.get(name,()))|set(norm_idx.get(n,()))|set(fold_idx.get(f,()))
        if f:
            matches.update(label for prefix,label in prefix_idx.get(f[0],[])if len(f)>len(prefix)and f.startswith(prefix))
        for label in matches:assert (label,position)in gov_pairs
        expected_pair_count+=len(matches)
    assert expected_pair_count==len(links)
    for name,row in distinct_display.items():
        assert row['governmentMatchCounts']==dict(gov_counts[name])
        assert row['governmentSourceRowCount']==len(gov_source_rows[name])
        assert row['governmentManufacturerRawLabels']==sorted(gov_makers[name])
    assert Counter(r['comparisonState']for r in display)==Counter(summary['displayRowStates'])
    assert Counter(r['comparisonState']for r in distinct_display.values())==Counter(summary['uniqueRawLabelStates'])
    assert Counter(r['comparisonState']for r in base)==Counter(summary['baselineTargetStates'])
    assert Counter(r['comparisonState']for r in research)==Counter(summary['researchRecordStates'])
    assert summary['governmentNameLinks']==len(links) and summary['governmentRawRowsRead']==105383
    assert summary['completeOfficialMaster']is False and summary['automaticRuntimeImport']is False and summary['verifiedRetailHierarchiesAdded']==0 and summary['confirmedRetailGradeCorrections']==0
    csv_fields=0
    for stem,json_rows in [('encar-display-name-ledger',display),('baseline-model-ledger',base),('research-record-ledger',research),('government-name-links',links)]:
        if not (out/(stem+'.csv.gz')).exists():
            assert stem=='government-name-links' and manifest['governmentLinksCsvIncluded']is False
            continue
        with gzip.open(out/(stem+'.csv.gz'),'rt',encoding='utf-8-sig',newline='')as f:
            csv_rows=list(csv.DictReader(f))
        assert len(csv_rows)==len(json_rows)
        for actual,expected in zip(csv_rows,json_rows):
            for key,value in actual.items():assert value==tabvalue(expected.get(key)),(stem,key);csv_fields+=1
    report={'ok':True,'producerImported':False,'allSourceNamesAndPositionsMatch':True,'oldAndCurrentIndexOrderAndNamesIdentical':True,'displayRowsVerified':len(display),'baselineTargetsVerified':len(base),'researchRecordsVerified':len(research),'sourceTargetLinksVerified':dict(edge_count),'governmentRowsScannedForCompleteness':len(government),'governmentNameLinksVerified':len(links),'csvCellsVerified':csv_fields,'allInputOutputManifestHashesMatch':True,'allParentAndGradeVerificationDisabled':True,'allLedgerRowsIncomplete':True,'errors':0}
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':verify(*sys.argv[1:])
