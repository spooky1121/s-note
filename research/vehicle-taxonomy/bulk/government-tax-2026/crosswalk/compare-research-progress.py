#!/usr/bin/env python3
"""Compare candidate-only government search evidence with an immutable research snapshot.
Does not change research status or promote raw tax strings into verified grades.
"""
import argparse,csv,gzip,hashlib,json,os
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path

def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for x in iter(lambda:f.read(1024*1024),b''):h.update(x)
 return h.hexdigest()

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--ledger',type=Path,required=True);p.add_argument('--research-progress',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--expected-progress-sha256');a=p.parse_args()
 inputs={k:{'path':Path(os.path.relpath(getattr(a,k).resolve(),Path.cwd())).as_posix(),'sha256':sha(getattr(a,k))} for k in ['ledger','research_progress']}
 if a.expected_progress_sha256 and a.expected_progress_sha256!=inputs['research_progress']['sha256']:raise SystemExit('research progress SHA256 mismatch')
 ledger=json.load(open(a.ledger,encoding='utf-8'));prior=json.load(open(a.research_progress,encoding='utf-8'))
 key=lambda r:(r['make'],r['group'],r['model']);lookup={key(r):r for r in prior['rows']};rows=[]
 for t in ledger['targets']:
  if not t['baselineMissingGrade']:continue
  old=lookup.get(key(t));assert old is not None,key(t)
  rows.append({k:t[k] for k in ['targetId','make','group','model']}|{'priorResearchStatus':old['researchStatus'],'priorCompletionStatus':old['completionStatus'],'governmentCandidateState':t['candidateState'],'governmentCandidateRows':t['candidateRowCount'],'governmentModelNameCandidateRows':t['modelNameCandidateRowCount'],'rawNameCandidateAddedWherePriorNotYetFound':old['researchStatus']=='not_yet_found' and t['candidateRowCount']>0,'noCandidateInEitherDeclaredSearch':old['researchStatus']=='not_yet_found' and t['candidateRowCount']==0,'completionStatus':'not_attested','complete':False,'verifiedGradesAdded':0,'note':'Candidate name evidence only. Prior research and government evidence remain separate; no retail hierarchy, grade, market, or model-year assertion.'})
 assert len(rows)==986 and len(lookup)==986
 matrix=Counter((r['priorResearchStatus'],r['governmentCandidateState']) for r in rows)
 summary={'schemaVersion':1,'generatedAt':datetime.now(timezone.utc).isoformat(),'inputs':inputs,'buildScriptSha256':sha(Path(__file__)),'researchSnapshotAsOf':prior.get('asOf'),'baselineMissingGradeTargets':986,'rawNameCandidatesAddedToPreviouslyNotYetFoundTargets':sum(r['rawNameCandidateAddedWherePriorNotYetFound'] for r in rows),'noCandidateInEitherDeclaredSearch':sum(r['noCandidateInEitherDeclaredSearch'] for r in rows),'matrix':[{'priorResearchStatus':k[0],'governmentCandidateState':k[1],'targets':n} for k,n in sorted(matrix.items())],'completeTargets':0,'verifiedRetailGradesAdded':0,'researchStatusesChanged':0,'interpretation':'Searchable evidence increased; no missing retail grade was completed. A target with no candidate remains unresolved under the declared search rules, not proven absent from the sources. The government and prior research snapshots are independently hashed.'}
 a.output_dir.mkdir(parents=True,exist_ok=True)
 (a.output_dir/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 (a.output_dir/'target-comparison.json').write_text(json.dumps({'schemaVersion':1,'inputs':inputs,'complete':False,'targets':rows},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 for name,rr in [('target-comparison.csv.gz',rows),('no-candidate-in-either-search.csv.gz',[r for r in rows if r['noCandidateInEitherDeclaredSearch']])]:
  with gzip.open(a.output_dir/name,'wt',encoding='utf-8',newline='') as f:
   w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rr)
 print(json.dumps(summary,ensure_ascii=False))
if __name__=='__main__':main()
