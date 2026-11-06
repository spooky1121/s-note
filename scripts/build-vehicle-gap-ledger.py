"""Track every baseline model without a grade; evidence matching is never approval.

An empty grade may describe a named model variant. Family-level evidence and
publisher model indexes are leads, not proof of a complete retail hierarchy.
"""
from pathlib import Path
from collections import Counter, defaultdict
import csv
import json
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'research/vehicle-taxonomy'


def normalized(value):
    return ' '.join(unicodedata.normalize('NFKC', str(value or '')).casefold().split())


def main():
    baseline = json.loads((DATA / 'baseline/catalog.json').read_text())['records']
    research = json.loads((DATA / 'exports/official-research.json').read_text())['records']
    by_model = defaultdict(list)
    for row in baseline:
        by_model[(row['make'], row['group'], row['model'])].append(row)
    targets = [key for key, rows in by_model.items() if not any(row.get('grade') for row in rows)]
    government_path = DATA / 'bulk/government-tax-2026/crosswalk/amended-2026-reviewed/target-ledger.json'
    government = {}
    if government_path.exists():
        ledger = json.loads(government_path.read_text())
        government = {(row['make'],row['group'],row['model']):row for row in ledger['targets']}
    output = []
    for make, group, model in targets:
        family = [r for r in research if r['market'] == 'KR' and normalized(r['make']) == normalized(make) and normalized(r['group']) == normalized(group)]
        exact = [r for r in family if normalized(r['model']) == normalized(model)]
        aliases = [r for r in family if any(normalized(value) == normalized(model) for value in r['sourceRecord'].get('modelAliasCandidates', []) if isinstance(value, str))]
        matches = exact or aliases
        status = 'exact_model_label_evidence' if exact else 'declared_alias_candidate' if aliases else 'family_evidence_only' if family else 'not_yet_found'
        variants = [r for r in matches if r.get('recordType') == 'named_model_variant']
        output.append({'make':make,'group':group,'model':model,'researchStatus':status,'completionStatus':'not_attested','separateGradeRequirement':'not_established' if variants else 'needs_source_review','exactLabelRecords':len(exact),'aliasCandidateRecords':len(aliases),'familyRecords':len(family),'sourceUrls':sorted({r['sourceUrl'] for r in matches}),'researchIds':[r['researchId'] for r in matches],'notes':'Matching a model label does not prove complete model-year, engine, trim and subtrim coverage. No automatic mapping or gap removal.'})
    assert len(output) == 986
    for row in output:
        candidate=government.get((row['make'],row['group'],row['model']))
        if candidate is not None:
            row.update(governmentCandidateState=candidate['candidateState'],
                       governmentCandidateRows=candidate['candidateRowCount'],
                       governmentNameCandidateRows=candidate['modelNameCandidateRowCount'],
                       governmentTargetId=candidate['targetId'],
                       governmentGradeVerified=False)
            assert candidate['complete'] is False and candidate['gradeVerified'] is False
    assert len({(r['make'],r['group'],r['model']) for r in output}) == 986
    counts = Counter(row['researchStatus'] for row in output)
    result = {'schemaVersion':1,'asOf':'2026-11-07','baselineTargets':len(output),'allBaselineTargetsTracked':True,'completeOfficialMaster':False,'automaticRuntimeImport':False,'counts':dict(counts),'rows':output}
    if government:
        assert all(row.get('governmentTargetId') for row in output)
        result['governmentCandidateCounts']=dict(Counter(row['governmentCandidateState'] for row in output))
        result['governmentCrosswalkPath']=str(government_path.relative_to(ROOT))
        result['governmentNamesEstablishRetailGrades']=False
    target = DATA / 'exports/gap-research-progress.json'
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    fields = ['make','group','model','researchStatus','completionStatus','separateGradeRequirement','exactLabelRecords','aliasCandidateRecords','familyRecords','sourceUrls']
    if government:
        fields+=['governmentCandidateState','governmentCandidateRows','governmentNameCandidateRows','governmentTargetId','governmentGradeVerified']
    with (DATA / 'exports/gap-research-progress.csv').open('w',encoding='utf-8-sig',newline='') as file:
        writer=csv.DictWriter(file,fieldnames=fields,lineterminator='\r\n');writer.writeheader()
        for row in output:
            item={key:row[key] for key in fields};item['sourceUrls']=' | '.join(item['sourceUrls']);writer.writerow(item)
    print(json.dumps({'tracked':len(output),'counts':dict(counts),'completeOfficialMaster':False}))


if __name__ == '__main__':
    main()
