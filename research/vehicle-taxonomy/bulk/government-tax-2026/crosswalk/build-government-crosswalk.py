#!/usr/bin/env python3
"""Portable, stdlib-only, conservative government name candidate crosswalk.
No DB/runtime/catalog writes. Every output is research-only and incomplete.
"""
import argparse,csv,gzip,hashlib,io,json,os,re,sys,unicodedata
from collections import Counter,defaultdict
from datetime import datetime,timezone
from pathlib import Path

SCHEMA=1
RANK={'exact_model_name_text':0,'normalized_model_name_text':1,'model_name_phrase_candidate':2,'explicit_name_alias_candidate':3,'family_name_phrase_candidate':4,'configured_family_alias_candidate':5,'name_series_variant_hint':6}

def digest(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()

def norm(s):return ''.join(c for c in unicodedata.normalize('NFKC',str(s)).casefold() if c.isalnum())
def open_text(p):return gzip.open(p,'rt',encoding='utf-8') if str(p).endswith('.gz') else open(p,encoding='utf-8')
def dump(p,obj):p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def metadata_path(p):return Path(os.path.relpath(Path(p).resolve(),Path.cwd())).as_posix()

def target_key(r):return (r['make'],r['group'],r['model'])
def tid(k):return 'baseline-'+hashlib.sha256(json.dumps(k,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()[:16]

def lexical_name(s):
 # Keep original word/punctuation boundaries alongside the compact normalized text.
 # A7 3.0 must match A7 without allowing A7 to match A70; MINI Cooper Countryman
 # retains the boundary before Countryman. Camel-case boundaries are also lexical only.
 raw=unicodedata.normalize('NFKC',str(s));text=[];bounds={0};offset=0
 for i,c in enumerate(raw):
  if not c.isalnum():bounds.add(offset);continue
  prev=raw[i-1] if i else '';nxt=raw[i+1] if i+1<len(raw) else ''
  if i==0 or not prev.isalnum() or (c.isascii() and c.isupper() and prev.isascii() and (prev.islower() or (prev.isupper() and nxt.islower()))):bounds.add(offset)
  piece=c.casefold();text.append(piece);offset+=len(piece)
 bounds.add(offset)
 return ''.join(text),frozenset(bounds)

def contains(name,term):
 """Whitespace/punctuation-insensitive substring with Latin/digit guards.
 Suffix digits allowed after a letter for ES300; digits cannot extend K5 to K500.
 Non-ASCII Korean morphology remains deliberately candidate-only.
 """
 if isinstance(name,tuple):name,bounds=name
 else:bounds=frozenset()
 if len(term)<2:return False
 start=0
 while True:
  i=name.find(term,start)
  if i<0:return False
  j=i+len(term);before=name[i-1] if i else '';after=name[j] if j<len(name) else ''
  # Avoid C300 matching GLC300, A1 matching A100, 86 matching 986.
  left_bad=bool(before and term[0].isascii() and term[0].isalnum() and before.isascii() and before.isalnum())
  right_bad=bool(after and ((term[-1].isascii() and term[-1].isdigit() and after.isascii() and after.isdigit()) or (term[-1].isascii() and term[-1].isalpha() and after.isascii() and after.isalpha())))
  if (not left_bad or i in bounds) and (not right_bad or j in bounds):return True
  start=i+1

def methods_for(name_raw,name_search,model,model_norm,group_norm,explicit,family,series):
 name_norm=name_search[0]
 methods=[]
 if name_raw.strip()==model.strip():methods.append(('exact_model_name_text',model))
 elif name_norm==model_norm:methods.append(('normalized_model_name_text',model))
 elif contains(name_search,model_norm):methods.append(('model_name_phrase_candidate',model))
 for raw,t in explicit:
  if contains(name_search,t):methods.append(('explicit_name_alias_candidate',raw))
 if contains(name_search,group_norm):methods.append(('family_name_phrase_candidate',group_norm))
 for raw,t in family:
  if contains(name_search,t):methods.append(('configured_family_alias_candidate',raw))
 for raw,t in series:
  if contains(name_search,t):methods.append(('name_series_variant_hint',raw))
 return sorted(set(methods),key=lambda x:(RANK[x[0]],x[1]))

def main():
 ap=argparse.ArgumentParser(description=__doc__)
 ap.add_argument('--records',required=True,type=Path);ap.add_argument('--baseline',required=True,type=Path)
 ap.add_argument('--missing',required=True,type=Path);ap.add_argument('--aliases',type=Path,default=Path(__file__).with_name('candidate-aliases.json'))
 ap.add_argument('--output-dir',required=True,type=Path);ap.add_argument('--expected-records-sha256');ap.add_argument('--expected-baseline-sha256')
 ap.add_argument('--source-archive-sha256',required=True);ap.add_argument('--source-label',required=True)
 ap.add_argument('--expected-target-count',type=int,default=1197);ap.add_argument('--expected-missing-count',type=int,default=986)
 ap.add_argument('--omit-candidate-csv',action='store_true',help='Emit exhaustive candidate JSONL only; keep smaller target CSV exports.')
 args=ap.parse_args();out=args.output_dir;out.mkdir(parents=True,exist_ok=True)
 inputs={k:{'path':metadata_path(getattr(args,k)),'sha256':digest(getattr(args,k))} for k in ['records','baseline','missing','aliases']}
 for key,expected in [('records',args.expected_records_sha256),('baseline',args.expected_baseline_sha256)]:
  if expected and expected.lower()!=inputs[key]['sha256']:raise SystemExit(f'{key} SHA256 mismatch')
 base=json.load(open(args.baseline,encoding='utf-8'));rules=json.load(open(args.aliases,encoding='utf-8'))
 baseline=defaultdict(list)
 for r in base['records']:baseline[target_key(r)].append(r)
 with open(args.missing,encoding='utf-8-sig',newline='') as f:missing={target_key(r) for r in csv.DictReader(f)}
 assert len(baseline)==args.expected_target_count,(len(baseline),args.expected_target_count)
 assert len(missing)==args.expected_missing_count and missing<=baseline.keys()
 # All raw observations retained, including repeated name/type/tax-price rows.
 groups=defaultdict(list);raw_count=0;row_ids=set();raw_makers=Counter();source_years=Counter()
 with open_text(args.records) as f:
  for line in f:
   r=json.loads(line);raw_count+=1;rf=r['fieldsRaw'];sheet=r['sourceSheet'];row=r['sourceRow']
   rowid=(sheet,row)
   if rowid in row_ids:raise ValueError(f'duplicate sourceSheet/sourceRow {rowid}')
   row_ids.add(rowid);raw_makers[rf.get('제작사','')]+=1;source_years[str(r.get('sourceYear'))]+=1
   field='차명' if '차명' in rf else '기종명' if '기종명' in rf else None
   if field is None:raise ValueError('no raw name field')
   # Group only repeated lexical contexts; source row remains uncollapsed in links.
   name=str(rf[field]);maker=str(rf.get('제작사',''))
   groups[(maker,field,name,sheet)].append(r)
 group_list=[{'maker':k[0],'makerNorm':norm(k[0]),'field':k[1],'name':k[2],'nameNorm':norm(k[2]),'nameSearch':lexical_name(k[2]),'sheet':k[3],'rows':v} for k,v in groups.items()]
 by_maker=defaultdict(list)
 for g in group_list:by_maker[g['makerNorm']].append(g)
 recognized={norm(x) for a in rules['manufacturerCandidateLabels'].values() for x in a}
 unknown=[g for g in group_list if g['makerNorm'] not in recognized]
 manifest={'schemaVersion':SCHEMA,'generatedAt':datetime.now(timezone.utc).isoformat(),'sourceLabel':args.source_label,'sourceArchiveSha256':args.source_archive_sha256,'inputs':inputs,'buildScript':{'path':metadata_path(Path(__file__)),'sha256':digest(Path(__file__))},'baselineSource':base.get('source'),'sourceYearsObserved':dict(source_years),'policy':{'purpose':'reviewable raw name evidence candidates only','complete':False,'autoImport':False,'gradeIdsCreated':0,'modelYearsAssigned':0,'marketAssigned':False,'manufacturerLabelsMerged':False,'matchingUsesRawTypeCode':False,'matchingUsesTaxPrice':False,'allRowsPreservedBySourceSheetAndRow':True,'sourceYearIsNotModelYear':True,'rawTaxPricesRemainOriginalUnitAndString':True,'retailHierarchyVerified':False},'methodPriority':RANK,'rowReferencePolicy':'Each candidate link retains exactly one raw sourceSheet/sourceRow. Repeated names/types/tax prices are separate observations. Examples in target JSON are capped at 5; candidate-links files contain all links.'}
 jsonl=gzip.open(out/'candidate-links.jsonl.gz','wt',encoding='utf-8')
 csvfile=None if args.omit_candidate_csv else gzip.open(out/'candidate-links.csv.gz','wt',encoding='utf-8',newline='')
 cols=['targetId','make','group','model','baselineMissingGrade','matchMethod','matchedPhrase','manufacturerRelation','manufacturerRaw','vehicleNameFieldRaw','vehicleNameRaw','sourceSheet','sourceRow','originSheetContext','vehicleCategoryRaw','typeRaw','fuelRaw','taxBasePriceRaw','taxBasePriceUnitRaw','sourceYear','modelYear','market','generationVerified','gradeVerified','complete','rawRecordsSha256']
 cw=csv.DictWriter(csvfile,fieldnames=cols) if csvfile else None
 if cw:cw.writeheader()
 targets=[];method_links=Counter();candidate_makers=Counter();linked_rows=set();family_only_targets=0
 for key,br in sorted(baseline.items()):
  make,group,model=key;targetid=tid(key);modelnorm=norm(model);groupnorm=norm(group)
  explicit=[(x,norm(x)) for x in rules.get('explicitModelNameAliases',{}).get('|'.join(key),[])]
  family=[(x,norm(x)) for x in rules.get('familyNameAliases',{}).get(group,[])]
  series=[(x,norm(x)) for x in rules.get('seriesNameVariantHints',{}).get(make+'|'+group,[])]
  maker_norms={norm(x) for x in rules['manufacturerCandidateLabels'].get(make,[])}
  candidates=[]
  for mn in maker_norms:candidates.extend((g,'configured_corporate_label_candidate') for g in by_maker.get(mn,[]))
  # Unknown producer/maker may describe a base vehicle. Require a distinctive lexical family
  # (>=3 Korean chars or >=4 Latin chars, with no all-numeric terms) and flag the relation.
  strong=[t for t in [groupnorm]+[x[1] for x in family] if (sum('\uac00'<=c<='\ud7a3' for c in t)>=3 or (len(t)>=4 and any(c.isalpha() for c in t))) and not t.isdigit()]
  if strong:
   candidates.extend((g,'unmapped_producer_name_only_candidate') for g in unknown if any(contains(g['nameSearch'],s) for s in strong))
  methods_count=Counter();relations=Counter();rowcount=0;examples=[];distinct_names=set();specific=0;raw_maker_names=set()
  for g,relation in candidates:
   found=methods_for(g['name'],g['nameSearch'],model,modelnorm,groupnorm,explicit,family,series)
   if not found:continue
   method,phrase=found[0]
   # An unknown producer name cannot establish a model-generation or brand identity.
   if relation=='unmapped_producer_name_only_candidate':method='producer_name_family_hint';phrase=next(s for s in strong if contains(g['nameSearch'],s))
   for r in g['rows']:
    rf=r['fieldsRaw'];rowcount+=1;methods_count[method]+=1;relations[relation]+=1;method_links[method]+=1
    distinct_names.add((g['maker'],g['field'],g['name']));raw_maker_names.add(g['maker']);candidate_makers[g['maker']]+=1
    linked_rows.add((r['sourceSheet'],r['sourceRow']))
    if method in {'exact_model_name_text','normalized_model_name_text','model_name_phrase_candidate','explicit_name_alias_candidate'} and relation=='configured_corporate_label_candidate':specific+=1
    link={'targetId':targetid,'target':{'make':make,'group':group,'model':model},'baselineMissingGrade':key in missing,'recordType':'government_raw_name_candidate_link','matchMethod':method,'matchMethodsObserved':[x[0] for x in found],'matchedPhrase':phrase,'manufacturerRelation':relation,'manufacturerRaw':g['maker'],'vehicleNameFieldRaw':g['field'],'vehicleNameRaw':g['name'],'sourceRef':{'rawRecordsSha256':inputs['records']['sha256'],'sourceArchiveSha256':args.source_archive_sha256,'sourceSheet':r['sourceSheet'],'sourceRow':r['sourceRow']},'originSheetContext':r['sourceSheet'].split()[0],'fieldsRaw':rf,'fieldCellTypesRaw':r.get('fieldCellTypesRaw',{}),'observationMetadataRaw':{k:v for k,v in r.items() if k not in {'fieldsRaw','fieldCellTypesRaw'}},'sourceYear':r.get('sourceYear'),'sourceYearBasis':r.get('sourceYearBasis'),'taxBasePriceUnitRaw':r.get('amountUnitRaw'),'modelYear':None,'market':'UNVERIFIED','generationVerified':False,'parentHierarchyVerified':False,'gradeVerified':False,'complete':False,'autoImport':False,'uncertaintyCodes':['government_tax_name_not_retail_grade','source_year_not_model_year','raw_manufacturer_label_not_consumer_brand_identity','market_not_established_by_domestic_imported_sheet','generation_parentage_unverified','raw_type_code_not_used_for_parent_inference']+(['unmapped_producer_may_reference_base_vehicle'] if relation.startswith('unmapped') else [])}
    jsonl.write(json.dumps(link,ensure_ascii=False,separators=(',',':'))+'\n')
    flat=dict(targetId=targetid,make=make,group=group,model=model,baselineMissingGrade=key in missing,matchMethod=method,matchedPhrase=phrase,manufacturerRelation=relation,manufacturerRaw=g['maker'],vehicleNameFieldRaw=g['field'],vehicleNameRaw=g['name'],sourceSheet=r['sourceSheet'],sourceRow=r['sourceRow'],originSheetContext=link['originSheetContext'],vehicleCategoryRaw=rf.get('차종',''),typeRaw=rf.get('형식',''),fuelRaw=rf.get('연료원',''),taxBasePriceRaw=rf.get('기준가격',''),taxBasePriceUnitRaw=r.get('amountUnitRaw',''),sourceYear=r.get('sourceYear'),modelYear='',market='UNVERIFIED',generationVerified=False,gradeVerified=False,complete=False,rawRecordsSha256=inputs['records']['sha256'])
    if cw:cw.writerow(flat)
    if len(examples)<5:examples.append({'vehicleNameRaw':g['name'],'manufacturerRaw':g['maker'],'sourceSheet':r['sourceSheet'],'sourceRow':r['sourceRow'],'matchMethod':method,'manufacturerRelation':relation})
  state='model_name_candidate_found' if specific else 'family_or_series_hint_only' if rowcount else 'no_candidate_under_declared_rules'
  if state=='family_or_series_hint_only':family_only_targets+=1
  targets.append({'targetId':targetid,'make':make,'group':group,'model':model,'baselineRows':len(br),'baselineMarkets':sorted({x.get('market','') for x in br}),'baselineHasGrade':any(x.get('grade') for x in br),'baselineMissingGrade':key in missing,'candidateState':state,'candidateRowCount':rowcount,'modelNameCandidateRowCount':specific,'distinctRawNameTuples':len(distinct_names),'matchMethods':dict(methods_count),'manufacturerRelations':dict(relations),'manufacturerRawLabelsObserved':sorted(raw_maker_names),'modelNameRule':{'normalizedBaselineModel':modelnorm,'explicitNameAliases':[x[0] for x in explicit]},'familyRules':{'baselineGroup':group,'configuredFamilyAliases':[x[0] for x in family],'configuredSeriesVariantHints':[x[0] for x in series]},'examples':examples,'exampleLimit':5,'exhaustiveLinksFile':'candidate-links.jsonl.gz','complete':False,'autoImport':False,'generationVerified':False,'gradeVerified':False,'market':'UNVERIFIED','modelYear':None,'remainingWork':'Verify generation and manufacturer relation, then find independent retail engine/grade/subgrade evidence; tax names alone cannot complete this target.'})
 jsonl.close()
 if csvfile:csvfile.close()
 allstates=Counter(t['candidateState'] for t in targets);missingtargets=[t for t in targets if t['baselineMissingGrade']];missingstates=Counter(t['candidateState'] for t in missingtargets)
 make_summary=[]
 for make in sorted({t['make'] for t in targets}):
  subset=[t for t in targets if t['make']==make];ms=[t for t in subset if t['baselineMissingGrade']]
  make_summary.append({'make':make,'targets':len(subset),'missingGradeTargets':len(ms),'candidateStates':dict(Counter(t['candidateState'] for t in subset)),'missingGradeCandidateStates':dict(Counter(t['candidateState'] for t in ms)),'candidateLinks':sum(t['candidateRowCount'] for t in subset),'completeTargets':0})
 summary={'schemaVersion':SCHEMA,'sourceLabel':args.source_label,'rawInputRows':raw_count,'rawNameSheetContextGroups':len(groups),'rawManufacturerLabels':len(raw_makers),'allTargets':len(targets),'missingGradeTargets':len(missingtargets),'allTargetCandidateStates':dict(allstates),'missingGradeCandidateStates':dict(missingstates),'candidateLinks':sum(method_links.values()),'distinctRawRowsWithAnyCandidate':len(linked_rows),'candidateLinksByMethod':dict(method_links),'completeTargets':0,'newVerifiedGrades':0,'allTargetsRemainIncomplete':True,'allMissingGradeTargetsRemainMissing':True,'manufacturerCoverage':make_summary,'interpretation':'More searchable raw-name evidence is not completed taxonomy. Model-name candidates may contain a generation word explicitly; none prove generation hierarchy, retail trim, model year or market. Family/series hints intentionally recur over multiple generation targets.'}
 dump(out/'target-ledger.json',{'schemaVersion':SCHEMA,'sourceLabel':args.source_label,'inputs':inputs,'complete':False,'targets':targets})
 dump(out/'summary.json',summary)
 ledger_fields=['targetId','make','group','model','baselineMissingGrade','baselineHasGrade','baselineRows','candidateState','candidateRowCount','modelNameCandidateRowCount','distinctRawNameTuples','baselineMarkets','complete','generationVerified','gradeVerified','market','modelYear']
 for filename,rows in [('target-ledger.csv.gz',targets),('missing-grade-targets.csv.gz',missingtargets),('missing-grade-no-candidate.csv.gz',[t for t in missingtargets if not t['candidateRowCount']])]:
  with gzip.open(out/filename,'wt',encoding='utf-8',newline='') as f:
   w=csv.DictWriter(f,fieldnames=ledger_fields);w.writeheader()
   for t in rows:w.writerow({k:'|'.join(t[k]) if isinstance(t.get(k),list) else t.get(k,'') for k in ledger_fields})
 # Operational invariants: all target IDs unique, raw fields unchanged in emitted links,
 # no sourceRow discarded in grouping; no type/code/year promotion is implemented.
 assert len({t['targetId'] for t in targets})==len(targets)
 assert sum(t['candidateRowCount'] for t in targets)==sum(method_links.values())
 assert all(not t['complete'] and not t['gradeVerified'] and t['modelYear'] is None for t in targets)
 assert sum(len(g['rows']) for g in group_list)==raw_count==len(row_ids)
 manifest['candidateCsvIncluded']=not args.omit_candidate_csv
 manifest['counts']={'rawRows':raw_count,'baselineTargets':len(targets),'baselineMissingGradeTargets':len(missingtargets),'candidateLinks':sum(method_links.values())}
 manifest['outputs']=[{'path':p.name,'bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(out.iterdir()) if p.is_file() and p.name!='manifest.json']
 manifest['validation']={'uniqueRawRowRefs':len(row_ids),'rawRowsRetainedBeforeMatching':sum(len(g['rows']) for g in group_list),'targetIdsUnique':True,'baselineCountsMatchExpected':True,'allTargetsIncomplete':True,'gradeIdsCreated':0,'typeCodesUsedForMatching':0,'sourceYearsPromotedToModelYears':0}
 dump(out/'manifest.json',manifest)
 print(json.dumps({'outputDir':str(out),'allTargets':len(targets),'missingGradeTargets':len(missingtargets),'allStates':dict(allstates),'missingStates':dict(missingstates),'candidateLinks':sum(method_links.values())},ensure_ascii=False))

if __name__=='__main__':main()
