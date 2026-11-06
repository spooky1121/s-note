"""Offline, manually scoped candidate-row audit. No generic trim substring joins."""
import json,re,collections,hashlib
from pathlib import Path
B=Path(__file__).resolve().parent.parent;O=B/'independent-audit'
targets=json.loads((B/'targets.json').read_text());facts=json.loads((B/'frame-table-facts.json').read_text())
frames={x['parentSourceId']:x for x in facts['frames'] if x['type']=='ENG'}
# The associations below are review candidates explicitly read in each frame.
# Every tuple: (record ordinals, ENG sourceLine start, ENG sourceLine end, fuel sourceLine).
# They preserve ordinal identity; they do not prove a CLS trim-to-ENG join.
M={}
def put(short,groups): M['hist-encar-'+short+'-grades']=groups
def g(ids,start,end,fuel):return(ids,start,end,fuel)
def rr(a,b):return list(range(a,b+1))
put('3-5gen',[g(rr(1,3),1,12,1),g([4],13,17,1),g(rr(5,8),21,27,21),g([9,10],28,31,21),g([11,12,13,17],32,36,21),g([14],37,39,21),g([15,16,18],40,42,21),g([19],43,47,21)])
put('3-6gen',[g(rr(1,4)+rr(7,11)+rr(15,19),1,8,1),g([5,6],9,11,1),g(rr(12,14),12,14,1),g(rr(20,24),15,19,15),g(rr(25,27),23,26,15),g([28],35,37,35)])
put('5-6gen',[g(rr(1,7),1,4,1),g([8,9],5,8,5),g([11],9,14,9),g([13],15,19,15),g([14,15],20,24,20),g(rr(16,20),28,31,28),g([21,22],36,38,36)])
put('5-e60',[g([1],1,6,1),g([2],7,11,1),g([3],15,20,1),g([4],24,32,24),g([5],33,38,24),g([6],43,48,24),g([7],49,53,24),g([8],54,61,24),g([9],62,66,24),g([10],67,71,24),g([11],75,81,75)])
put('7-f01-f02',[g(rr(1,7),1,5,1),g([8]+rr(10,12),6,11,1),g(rr(13,21),17,20,12),g(rr(22,27),21,24,12),g(rr(28,30),25,28,12),g([31,32],29,31,29)])
put('a4-b8',[g([1],22,25,16),g(rr(2,5),26,30,16),g([6,7],1,7,1),g([8,9,10],10,13,1),g([11,12],8,9,1),g(rr(13,15),14,15,1)])
put('a6-c7',[g([1,2,3],24,31,24),g(rr(4,7),44,50,24),g([8,9],1,3,1),g(rr(10,13),10,19,1),g([14,15],4,7,1),g([16],32,35,24),g([17,18],51,54,24),g([19,20],20,23,1)])
put('a7-4g',[g([1,2,3],1,1,1),g([4,5,6],8,8,8),g([7],6,6,1),g([8],7,7,1),g([9,10],13,13,8),g([11,12,13],2,5,1),g([14,15],9,12,8)])
put('accord-8',[g([1,2],1,5,1),g([3],8,11,1)])
put('altima-l33',[g([1,2,3],1,3,1),g([4,5],4,8,1)])
put('c-w204',[g([1,2],3,6,3),g(rr(3,6),7,11,7),g(rr(7,12),12,17,12),g([13],21,25,21),g([14,15],29,30,29),g([16,18],34,35,34),g([17],36,39,36),g([19],40,43,40)])
put('c-w205',[g([3],10,11,10)])
put('camry-xv40',[g([1],5,11,1),g([2],23,30,23)])
put('camry-xv50',[g([1],2,3,1),g([2],4,4,1),g([3],7,7,5)])
put('crv-3',[g([1,3],1,4,1),g([2,4,5],5,8,1)])
put('e-w211',[g([1],1,4,1),g([2],10,12,10),g([3],13,15,13),g([5,6],24,31,24),g([7],32,35,32),g([8],36,39,36)])
put('e-w212',[])
put('es-5',[g([1,2],5,7,1)])
put('es-6',[g([1,2,3],1,3,1),g([4,5,6],4,5,4)])
put('g-4',[g(rr(1,4),1,4,1),g([5,6],5,8,1),g([7,8,9],9,12,1)])
put('glk-x204',[g([1,2,3],1,5,1)])
put('golf-mk6',[g([1],6,6,6),g([2,3],1,1,1),g([4,5],2,2,1),g([6],5,5,1),g([7],8,8,6),g([8],3,3,1)])
put('golf-mk7',[g([1],1,5,1),g([2,3,4],6,9,1),g([5],23,27,18),g([6],13,17,1),g([7,8],18,22,18)])
put('gs-l10',[g([1],1,2,1),g([2,3,4],5,9,1),g([5],16,21,16)])
put('passat-7',[g([1],1,2,1),g([2],7,7,3)])
put('q5-8r',[g([1,2],1,4,1),g([3],9,12,1),g([5,6],5,8,1),g([7,8,9],13,16,1)])
put('q50-2014',[g([1,2],14,15,14),g([3],12,13,12)])
put('qashqai-2',[g([1,2,3],1,2,1)])
put('rx-al10',[g([1,2,5,6,7],3,6,1),g([3,4,8,9,10],10,12,7)])
put('s-w221',[g([1],3,5,3),g([2,3,4],10,14,10),g([5,6,7],6,9,6),g([8],15,16,15),g([9,10],19,27,19),g([11],28,31,28),g([12],35,41,32)])
put('s80-2',[g([1,2],23,24,1),g([3],25,27,1),g([4,5],28,29,1),g([7,8,9],18,22,1),g([10,11],39,44,30),g([12],33,35,30),g([13,14],36,38,30),g([15],30,32,30)])
put('tiguan-5n',[g([1,2],1,1,1),g(rr(3,7),2,3,2)])
put('v60-1',[g([1],1,3,1),g([2,3],4,5,1),g([4],6,8,1),g([5,6],9,12,1)])
put('x1-e84',[g([1,2,3],1,3,1),g([4],4,7,1),g([5],8,9,1),g([6,7,8],10,13,1)])
put('x3-e83',[g([1],1,7,2),g([2],19,21,19),g([3],25,28,19),g([4],8,15,2)])
put('x3-f25',[g(rr(1,4),1,8,1),g([5,6,7],9,17,1),g([8,9,10],18,20,1),g([11],24,26,21)])
put('x5-e70',[g([1],19,21,16),g([2],22,24,16),g([3],35,37,16),g([4],38,40,16),g([5],1,9,1),g([6],10,13,1),g([7],41,44,16)])
put('xc60-1',[g([1],1,2,1),g([2],3,4,1),g([3,4,5,6],5,9,1),g([7,8],10,14,10)])
assert set(M)==set(frames)

def clean(s):return re.sub(r'\s+',' ',s.replace('\xa0',' ')).strip()
def specs(lines):
 out=[]
 for z in lines:
  # Tight paired numeric-displacement + architecture token. R/I/L/l here
  # explicitly mean inline; Hyb remains Hyb and is never equated to I4.
  for p in re.finditer(r'(?<![\d.])(\d\.\d)\s*(?:L\s*)?\(?\s*(Hyb\s*4|[lLIRV]\s*\d{1,2})\s*\)?',z['text']):
   disp=p.group(1);arch=re.sub(r'\s','',p.group(2));canon=('I'+arch[1:] if arch[0] in 'lLIR' else arch)
   out.append({'liters':disp,'architecture':canon,'literal':p.group(0),'sourceLine':z['sourceLine'],'sourceText':z['text']})
 return out

def stored_spec(s):
 disp=re.search(r'(\d\.\d)\s*L',s)
 inline=re.search(r'직렬\s*(\d+)기통',s);arch=re.search(r'(?<![A-Za-z])([lLIV]\d{1,2}|Hyb4)(?!\d)',s)
 a=('I'+inline.group(1)) if inline else (arch.group(1) if arch else None)
 if a and a[0] in 'lL':a='I'+a[1:]
 return {'liters':disp.group(1) if disp else None,'architecture':a}

def fuel_value(s):
 for c in [clean(x) for x in s.split('|')]:
  if c in ['가솔린','디젤','하이브리드','하이 브리드','가솔린+전기','가솔린 + 전기']:return c
 return None

def fuel_norm(s):
 return '하이브리드' if clean(s).replace(' ','') in ['하이브리드','가솔린+전기'] else clean(s)

ledger=[];candidates=[]
for source in targets:
 sid=source['sourceId'];fr=frames[sid];lines=fr['lines'];byline={z['sourceLine']:z for z in lines}
 verified=fr.get('sourceMatched') is True and fr.get('parentSourceURLVerified') is True and fr.get('status')=='read_verified_url' and fr.get('url')==source['engUrl'] and len(lines)>0
 amap={}
 for ids,a,b,fl in M[sid]:
  for i in ids:
   assert i not in amap,(sid,i)
   amap[i]=(a,b,fl)
 for i,r in enumerate(source['records'],1):
  key=sid+':'+str(i);stored={k:r.get(k,'') for k in ['engine','fuel','transmission']};scope=amap.get(i)
  ent={'recordKey':key,'sourceId':sid,'sourceOrdinal':i,'grade':r['grade'],'rawParentLabel':r.get('rawParentLabel'),'rawTrimLabel':r.get('rawTrimLabel'),'sourceUrl':source['engUrl'],'frameVerified':verified,'stored':stored,'joinStatus':'review_required','joinReason':'ENG family/year row and CLS literal trim have no machine-readable direct key; candidate scope is manually identified, and does not confirm every trim/year combination.'}
  scoped=[z for z in lines if scope and scope[0]<=z['sourceLine']<=scope[1]]
  ent['candidateEngRow']={'sourceLineStart':scope[0],'sourceLineEnd':scope[1],'text':[z for z in scoped]} if scope else None
  if not verified:
   ent['engine']={'status':'frame_unverified'};ent['fuel']={'status':'frame_unverified'};ent['transmission']={'status':'frame_unverified'};ledger.append(ent);continue
  esp=specs(scoped);fs=specs(lines)
  if not stored['engine']: ent['engine']={'status':'not_stored','observedCandidateSpecs':esp}
  else:
   e=stored_spec(stored['engine']);match=[x for x in esp if x['liters']==e['liters'] and x['architecture']==e['architecture']];frame_match=[x for x in fs if x['liters']==e['liters'] and x['architecture']==e['architecture']]
   ent['engine']={'status':'candidate_row_unit_tuple_observed' if match else 'frame_only_unit_tuple_observed' if frame_match else 'unit_tuple_not_observed','normalizedStored':e,'evidence':match or frame_match,'observedCandidateSpecs':esp}
   extras=[x for x in ['i-VTEC','트윈터보','터보'] if x in stored['engine']]
   if '트윈터보' in extras and '터보' in extras:extras.remove('터보')
   ent['engine']['qualifiers']=[{'literal':q,'status':'candidate_row_literal_observed' if any(q in z['text'] for z in scoped) else 'not_observed_in_candidate_row','evidence':[z for z in scoped if q in z['text']]} for q in extras]
   if not match:
    candidates.append({'recordKey':key,'field':'engine','kind':'mapping_review' if frame_match else 'value_not_observed','expected':stored['engine'],'actualCandidateRowSpecs':esp,'evidence':scoped,'reason':'Unit tuple observed elsewhere in frame only; row join requires review.' if frame_match else 'Paired displacement/architecture token absent from frame.'})
   for q in ent['engine']['qualifiers']:
    if q['status']=='not_observed_in_candidate_row':candidates.append({'recordKey':key,'field':'engine','kind':'additional_qualifier_not_observed','expected':q['literal'],'actual':'No literal qualifier in candidate ENG row','evidence':scoped,'reason':'Base unit tuple may match; added qualifier needs another explicit supporting source.'})
  if not stored['fuel']:ent['fuel']={'status':'not_stored'}
  elif scope:
   fline=byline[scope[2]];fv=fuel_value(fline['text'])
   status='candidate_rowspan_fuel_observed' if fv==stored['fuel'] else 'candidate_rowspan_fuel_normalized_equivalent' if fuel_norm(fv or '')==fuel_norm(stored['fuel']) else 'candidate_fuel_mismatch'
   ent['fuel']={'status':status,'observedLiteral':fv,'evidence':[fline],'rowspanPolicy':'Fuel anchor explicitly assigned after reading table; blank markdown cells do not create a new fuel.'}
   if status=='candidate_fuel_mismatch':candidates.append({'recordKey':key,'field':'fuel','kind':'literal_or_normalized_mismatch','expected':stored['fuel'],'actual':fv,'evidence':[fline]})
  else:
   fmatches=[z for z in lines if (v:=fuel_value(z['text'])) and fuel_norm(v)==fuel_norm(stored['fuel'])]
   ent['fuel']={'status':'frame_only_fuel_observed' if fmatches else 'fuel_not_observed','evidence':fmatches}
   candidates.append({'recordKey':key,'field':'fuel','kind':'mapping_review','expected':stored['fuel'],'actual':'Observed in frame but no explicit family row candidate' if fmatches else 'Not observed in frame','evidence':fmatches,'reason':'No source-line family join was established for this literal CLS trim.'})
  if not stored['transmission']:ent['transmission']={'status':'not_stored'}
  else:
   # These three stored values all have no equivalent gearbox mention in ENG.
   # Treat as ENG evidence gaps, not false values; parent history may support them.
   tl=[z for z in lines if re.search(r'변속|자동|수동|CVT|DSG|트로닉|ZF',z['text'],re.I)]
   ent['transmission']={'status':'not_observed_in_eng','evidence':tl,'limitation':'Parent history prose was outside this offline ENG-table audit.'}
   candidates.append({'recordKey':key,'field':'transmission','kind':'eng_evidence_gap','expected':stored['transmission'],'actual':'No matching transmission fact in ENG frame','evidence':tl,'reason':'May originate in parent history prose; do not classify as a false value from this ENG-only audit.'})
  ledger.append(ent)
assert len(ledger)==387 and len({x['recordKey'] for x in ledger})==387
cnt=lambda k:dict(collections.Counter(x[k]['status'] for x in ledger))
summary={'scope':'Offline independent ENG numeric unit, architecture, fuel literal/rowspan, and transmission evidence audit. No live fetches, no repository changes.','records':len(ledger),'sources':len(targets),'verifiedNonemptyEngFrames':sum(x.get('sourceMatched') is True and len(x['lines'])>0 for x in frames.values()),'engineStatus':cnt('engine'),'fuelStatus':cnt('fuel'),'transmissionStatus':cnt('transmission'),'joinStatus':dict(collections.Counter(x['joinStatus'] for x in ledger)),'candidateKinds':dict(collections.Counter(x['kind'] for x in candidates)),'confirmedRawEngineOrFuelContradictions':sum(x['kind'] in ['value_not_observed','literal_or_normalized_mismatch'] for x in candidates),'interpretation':'Candidate-row unit tuple match is only a source observation. All trim/year joins stay review_required. Frame-only matches and missing qualifiers are not verified joins; absence from ENG does not prove a value false.','normalization':['Whitespace/NBSP normalized only for typed fuel comparisons.','I/L/l/R architecture letters explicitly converted to inline I, preserving cylinder count and displacement numeric token.','Hyb4 remains Hyb4; no architecture inference from the word hybrid.','Fuel 하이브리드 and 가솔린+전기 treated as normalized broad equivalents, never literal equivalents.','Added engine qualifiers independently checked against candidate row.'],'inputSha256':{n:hashlib.sha256((B/n).read_bytes()).hexdigest() for n in ['targets.json','frame-table-facts.json']}}
(O/'engine-audit.json').write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
(O/'engine-candidates.json').write_text(json.dumps(candidates,ensure_ascii=False,indent=2)+'\n')
(O/'engine-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
