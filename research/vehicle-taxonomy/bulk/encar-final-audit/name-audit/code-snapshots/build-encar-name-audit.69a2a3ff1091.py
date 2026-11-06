#!/usr/bin/env python3
"""Exhaustive lexical cross-check against an Encar display-name snapshot.

This is a name audit, not a verified manufacturer/model/retail-trim crosswalk.
The Encar source must supply modelIndex.records or a plain list of display rows.
No network, production database access or source mutation occurs.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import unicodedata

NORMALIZATION = 'Unicode NFKC, casefold, collapse whitespace; retain punctuation, engine/year/generation text'
LAYOUT_RULE = 'NFKC/casefold then remove whitespace and ()[]{}._-·ㆍ/ separators only; hint, never identity proof'
MATCH_PRIORITY = {
    'literal_name_equal': 0,
    'nfkc_whitespace_casefold_equal': 1,
    'declared_alias_equal': 2,
    'presentation_folded_equal_hint': 3,
    'family_group_equal_hint': 4,
    'family_group_contained_hint': 5,
    'model_name_prefix_in_longer_tax_name_hint': 6,
}
GENERIC_NAMES = {'기타'}
CURRENT_SOURCE_YEAR = 2026


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def stable_id(prefix, values, length=20):
    raw = json.dumps(values, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()
    return prefix + hashlib.sha256(raw).hexdigest()[:length]


def nfkc(value):
    return ' '.join(unicodedata.normalize('NFKC', str(value or '')).casefold().split())


def folded(value):
    return re.sub(r'[\s()\[\]{}._\-·ㆍ/]+', '', nfkc(value))


def json_text(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def write_jsonl_gz(path, rows):
    with path.open('wb') as dest, gzip.GzipFile(filename='', fileobj=dest, mode='wb', mtime=0) as compressed:
        with io.TextIOWrapper(compressed, encoding='utf-8', newline='\n') as f:
            for row in rows:
                f.write(json_text(row) + '\n')


def csv_value(value):
    if value is None:
        return ''
    if isinstance(value, (list, dict)):
        value = json_text(value)
    if isinstance(value, bool):
        return str(value).lower()
    text = str(value)
    if text.lstrip().startswith(('=', '+', '-', '@')):
        text = "'" + text
    return text


def write_csv_gz(path, rows, fields):
    with path.open('wb') as dest, gzip.GzipFile(filename='', fileobj=dest, mode='wb', mtime=0) as compressed:
        with io.TextIOWrapper(compressed, encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fields, lineterminator='\r\n')
            writer.writeheader()
            for row in rows:
                writer.writerow({key: csv_value(row.get(key)) for key in fields})


def source_name_links(name, rows, aliases=False):
    """Enumerate every target lexical match; no search-score cutoff or hidden truncation."""
    result = []
    n, layout = nfkc(name), folded(name)
    group_patterns = {row['_groupNormalized']:row['_groupPattern'] for row in rows if row['_groupNormalized']}
    group_methods = {}
    for group,pattern in group_patterns.items():
        if n == group:
            group_methods[group] = 'family_group_equal_hint'
        elif len(group)>=2 and pattern.search(n):
            group_methods[group] = 'family_group_contained_hint'
    for row in rows:
        methods = []
        if name == row['model']:
            methods.append('literal_name_equal')
        elif n == row['_normalized']:
            methods.append('nfkc_whitespace_casefold_equal')
        if aliases and n in row['_aliases']:
            methods.append('declared_alias_equal')
        if not methods and (layout == row['_folded'] or (aliases and layout in row['_aliasFolded'])):
            methods.append('presentation_folded_equal_hint')
        if row['_groupNormalized'] in group_methods:
            methods.append(group_methods[row['_groupNormalized']])
        if not methods:
            continue
        result.append({key: row[key] for key in row['_publicKeys']} | {
            'matchMethods': sorted(set(methods), key=MATCH_PRIORITY.__getitem__),
            'bestMatchMethod': min(methods, key=MATCH_PRIORITY.__getitem__),
        })
    return result


def reverse_state(methods):
    if not methods:
        return 'not_found_under_declared_rules'
    best = min(methods, key=MATCH_PRIORITY.__getitem__)
    return {
        'literal_name_equal':'literal_name_candidate',
        'nfkc_whitespace_casefold_equal':'normalized_name_candidate',
        'declared_alias_equal':'declared_alias_candidate',
        'presentation_folded_equal_hint':'presentation_only_hint',
    }.get(best, 'family_hint_only')


def read_json(path):
    with (gzip.open(path, 'rt', encoding='utf-8') if path.suffix == '.gz' else path.open(encoding='utf-8')) as f:
        return json.load(f)


def records_from_encar(source):
    if isinstance(source, list):
        values = source
        info = {'sourceDate': None, 'sourceUrl': None, 'sourceKind': 'provided_display_row_list'}
    else:
        index = source.get('modelIndex', source)
        values = index['records']
        info = {'sourceDate': source.get('researchedOn', source.get('asOf',source.get('checkedAt'))),
                'sourceUrl': index.get('sourceUrl',source.get('sourceUrl')),
                'sourceKind': 'provider_rendered_name_index',
                'acquisitionMethod':source.get('acquisitionMethod','archived_source_record'),
                'webToolRemoteCacheFreshness':source.get('webToolRemoteCacheFreshness','not_reported'),
                'comparisonToPriorSnapshot':source.get('comparisonToPriorSnapshot')}
    rows = []
    for position, value in enumerate(values, 1):
        if isinstance(value, str):
            row = {'displayOrdinal': position, 'modelNameRaw': value}
        else:
            row = dict(value)
        if not isinstance(row.get('modelNameRaw'), str) or not row['modelNameRaw']:
            raise ValueError('Every Encar display row needs a non-empty raw name')
        if row.get('displayOrdinal') != position:
            raise ValueError('Display ordinals must be complete, in order and unique')
        rows.append(row)
    if not rows:
        raise ValueError('Empty Encar display snapshot')
    return rows, info


def build(args):
    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    paths = {'encar':args.encar_source, 'baseline':args.baseline, 'research':args.research,
             'government':args.government_records}
    inputs = {}
    for key, path in paths.items():
        sha = digest(path)
        expected = getattr(args, 'expect_' + key + '_sha256')
        if expected and sha != expected:
            raise ValueError(key + ' input hash mismatch')
        try:
            path_label = str(path.resolve().relative_to(args.repository_root.resolve()))
            base = 'repository_root'
        except ValueError:
            path_label = path.name
            base = 'external input basename; supply CLI path explicitly'
        inputs[key] = {'path':path_label, 'pathBase':base, 'bytes':path.stat().st_size, 'sha256':sha}
    encar_rows, source_info = records_from_encar(read_json(paths['encar']))
    if args.expected_encar_rows is not None and len(encar_rows) != args.expected_encar_rows:
        raise ValueError('Unexpected Encar row count')
    baseline_raw = read_json(paths['baseline'])['records']
    research_raw = read_json(paths['research'])['records']
    grouped = {}
    for position, row in enumerate(baseline_raw, 1):
        key = row['make'], row['group'], row['model']
        if key not in grouped:
            grouped[key] = {'targetId':stable_id('baseline-', key,16), 'make':key[0], 'group':key[1], 'model':key[2],
                            'baselinePositions':[], 'baselineGradeValues':[], 'baselineMarketValues':[]}
        item = grouped[key]
        item['baselinePositions'].append(position)
        for field, source in [('baselineGradeValues','grade'),('baselineMarketValues','market')]:
            if row.get(source) not in item[field]:
                item[field].append(row.get(source))
    baseline = list(grouped.values())
    research = []
    for row in research_raw:
        research.append({key:row.get(key) for key in ['researchId','make','group','model','market','sourceMarket',
                         'evidenceStatus','sourceId','sourceUrl','sourcePublicationDate','modelYear']} | {
                         'declaredModelAliases':list(row.get('sourceRecord',{}).get('modelAliasCandidates',[]))})
    patterns = {}
    for rows in [baseline, research]:
        for row in rows:
            row['_publicKeys'] = list(row)
            row['_normalized'] = nfkc(row['model'])
            row['_folded'] = folded(row['model'])
            row['_groupNormalized'] = nfkc(row['group'])
            row['_aliases'] = {nfkc(value) for value in row.get('declaredModelAliases',[]) if isinstance(value, str)}
            row['_aliasFolded'] = {folded(value) for value in row.get('declaredModelAliases',[]) if isinstance(value,str)}
            group = row['_groupNormalized']
            if group not in patterns:
                patterns[group]=re.compile(r'(?<![가-힣a-z0-9])'+re.escape(group)+r'(?![가-힣a-z0-9])')
            row['_groupPattern']=patterns[group]
    raw_counts = Counter(row['modelNameRaw'] for row in encar_rows)
    unique_names = list(dict.fromkeys(row['modelNameRaw'] for row in encar_rows))
    ordinals_by_name = defaultdict(list)
    for row in encar_rows:
        ordinals_by_name[row['modelNameRaw']].append(row['displayOrdinal'])
    by_name = {}
    for name in unique_names:
        if nfkc(name) in GENERIC_NAMES:
            baseline_matches, research_matches = [], []
        else:
            baseline_matches = source_name_links(name, baseline)
            research_matches = source_name_links(name, research, aliases=True)
        by_name[name] = {'baselineMatches':baseline_matches, 'researchMatches':research_matches,
                         'governmentMatchCounts':Counter(), 'governmentManufacturerRawLabels':set(),
                         'governmentSourceRowCount':0, 'governmentSourceRowExamples':[]}
    literal = defaultdict(set)
    normalized = defaultdict(set)
    layout = defaultdict(set)
    trie = {}
    for name in unique_names:
        if nfkc(name) in GENERIC_NAMES:
            continue
        literal[name].add(name)
        normalized[nfkc(name)].add(name)
        layout[folded(name)].add(name)
        key = folded(name)
        # Numeric and very short labels are not eligible for substring/prefix hints.
        if len(key) >= 3 and not key.isnumeric():
            node = trie
            for char in key:
                node = node.setdefault(char,{})
            node.setdefault('',set()).add(name)
    gov_links = []
    gov_total = 0
    gov_fields = Counter()
    source_rows = set()
    with gzip.open(paths['government'], 'rt', encoding='utf-8') as f:
        for raw_position, line in enumerate(f,1):
            raw = json.loads(line)
            gov_total += 1
            fields = raw['fieldsRaw']
            name_keys = [key for key in ['차명','기종명'] if key in fields]
            if len(name_keys) != 1:
                raise ValueError('Expected exactly one explicit tax name field')
            field = name_keys[0]
            gov_fields[field] += 1
            name_raw = fields[field]
            if name_raw is None:
                continue
            if not isinstance(name_raw,str):
                raise ValueError('Raw lexical name should be preserved as a string')
            n, folded_name = nfkc(name_raw), folded(name_raw)
            matched = defaultdict(list)
            for name in sorted(literal.get(name_raw,())):
                matched[name].append('literal_name_equal')
            for name in sorted(normalized.get(n,())):
                if name not in matched:
                    matched[name].append('nfkc_whitespace_casefold_equal')
            for name in sorted(layout.get(folded_name,())):
                if name not in matched:
                    matched[name].append('presentation_folded_equal_hint')
            node = trie
            for position,char in enumerate(folded_name):
                node = node.get(char)
                if node is None:
                    break
                if '' in node and position + 1 < len(folded_name):
                    for name in sorted(node['']):
                        if name not in matched:
                            matched[name].append('model_name_prefix_in_longer_tax_name_hint')
            for name, methods in matched.items():
                source_key = raw['sourceSheet'], raw['sourceRow']
                source_rows.add(source_key)
                evidence = {'governmentRawPosition':raw_position,'sourceSheet':source_key[0],'sourceRow':source_key[1],
                            'nameFieldRaw':field,'governmentNameRaw':name_raw,'manufacturerRaw':fields.get('제작사'),
                            'formRaw':fields.get('형식'),'nameCellTypeRaw':raw.get('fieldCellTypesRaw',{}).get(field),
                            'sourceYear':raw.get('sourceYear'),'sourceYearIsModelYear':False,
                            'sourceSerialRaw':fields.get('연번'),'serialMissing':raw.get('serialMissing',False),
                            'encarNameRaw':name,'encarDisplayOrdinals':ordinals_by_name[name],
                            'matchMethods':methods,'bestMatchMethod':min(methods,key=MATCH_PRIORITY.__getitem__),
                            'governmentInputSha256':inputs['government']['sha256'],
                            'manufacturerRelationVerified':False,'retailHierarchyVerified':False,'automaticRuntimeImport':False}
                evidence['linkId'] = stable_id('gov-name-link-', [name, source_key, methods])
                gov_links.append(evidence)
                item = by_name[name]
                item['governmentMatchCounts'].update(methods)
                item['governmentManufacturerRawLabels'].add(fields.get('제작사'))
                item['governmentSourceRowCount'] += 1
                if len(item['governmentSourceRowExamples']) < 5:
                    item['governmentSourceRowExamples'].append(evidence)
    if args.expected_government_rows is not None and gov_total != args.expected_government_rows:
        raise ValueError('Unexpected government input row count')
    baseline_reverse = {r['targetId']:[] for r in baseline}
    research_reverse = {r['researchId']:[] for r in research}
    for name,item in by_name.items():
        for kind, targets in [('baselineMatches',baseline_reverse),('researchMatches',research_reverse)]:
            for match in item[kind]:
                key = match.get('targetId',match.get('researchId'))
                targets[key].append({'encarNameRaw':name,'encarDisplayOrdinals':ordinals_by_name[name],
                                     'matchMethods':match['matchMethods'],'bestMatchMethod':match['bestMatchMethod']})
    ledger = []
    for original in encar_rows:
        name = original['modelNameRaw']
        item = by_name[name]
        methods = [m for row in item['baselineMatches'] + item['researchMatches'] for m in row['matchMethods']]
        name_state = reverse_state(methods)
        gov_counts = dict(item['governmentMatchCounts'])
        if nfkc(name) in GENERIC_NAMES:
            state = 'generic_label_unclassifiable'
        elif name_state != 'not_found_under_declared_rules':
            state = name_state
        elif gov_counts:
            if gov_counts.get('literal_name_equal') or gov_counts.get('nfkc_whitespace_casefold_equal'):
                state = 'government_name_only_candidate'
            else:
                state = 'government_name_hint_only'
        else:
            state = 'not_found_under_declared_rules'
        candidate_makes = sorted({str(row['make']) for row in item['baselineMatches'] + item['researchMatches']})
        entry = {'encarDisplayOrdinal':original['displayOrdinal'],'encarModelNameRaw':name,
                 'encarSourceRowRaw':original,'encarManufacturerRaw':original.get('manufacturerRaw'),
                 'encarManufacturerProvided':bool(original.get('manufacturerRaw')),
                 'sourceSnapshotDate':source_info['sourceDate'],'comparisonState':state,
                 'duplicateRawLabelCount':raw_counts[name],'duplicateRawLabelOrdinals':ordinals_by_name[name],
                 'genericLabel':nfkc(name) in GENERIC_NAMES,
                 'shortOrNumericLabel':len(folded(name)) < 3 or folded(name).isnumeric(),
                 'candidateMakeLabels':candidate_makes,'multipleCandidateMakeLabels':len(candidate_makes)>1,
                 'manufacturerRelationVerified':False,'modelGenerationRelationVerified':False,
                 'retailGradeCoverageVerified':False,'automaticRuntimeImport':False,
                 'baselineMatchCount':len(item['baselineMatches']),'researchMatchCount':len(item['researchMatches']),
                 'baselineMatches':item['baselineMatches'],'researchMatches':item['researchMatches'],
                 'governmentSourceRowCount':item['governmentSourceRowCount'],'governmentMatchCounts':gov_counts,
                 'governmentManufacturerRawLabels':sorted(str(x) for x in item['governmentManufacturerRawLabels']),
                 'governmentSourceRowExamples':item['governmentSourceRowExamples'],
                 'exhaustiveGovernmentLinksFile':'government-name-links.jsonl.gz',
                 'notes':'Name equality is a lexical observation only; Encar manufacturer/parent/grade codes are absent. Tax names/form codes cannot establish retail generations, model years or grades.'}
        ledger.append(entry)
    baseline_ledger = []
    for row in baseline:
        public = {key:row[key] for key in row['_publicKeys']}
        links = baseline_reverse[row['targetId']]
        methods = [method for link in links for method in link['matchMethods']]
        baseline_ledger.append(public | {'comparisonState':reverse_state(methods),'encarNameMatches':links,
                 'matchedDisplayRows':sum(len(link['encarDisplayOrdinals']) for link in links),
                 'encarParentVerified':False,'retailGradeCoverageVerified':False,'completionStatus':'not_attested',
                 'absenceIsNotProven':not links,'automaticRuntimeImport':False})
    research_ledger = []
    for row in research:
        public = {key:row[key] for key in row['_publicKeys']}
        links = research_reverse[row['researchId']]
        methods = [method for link in links for method in link['matchMethods']]
        research_ledger.append(public | {'comparisonState':reverse_state(methods),'encarNameMatches':links,
                 'matchedDisplayRows':sum(len(link['encarDisplayOrdinals']) for link in links),
                 'encarParentVerified':False,'retailGradeCoverageVerified':False,'completionStatus':'not_attested',
                 'absenceIsNotProven':not links,'automaticRuntimeImport':False})
    assert len(ledger) == len(encar_rows)
    assert [r['encarDisplayOrdinal'] for r in ledger] == list(range(1,len(encar_rows)+1))
    assert sum(len(r['baselinePositions']) for r in baseline_ledger) == len(baseline_raw)
    assert len({r['targetId'] for r in baseline_ledger}) == len(baseline_ledger)
    assert len({r['researchId'] for r in research_ledger}) == len(research_raw)
    assert all(r['completionStatus']=='not_attested' for r in baseline_ledger+research_ledger)
    assert len({r['linkId'] for r in gov_links}) == len(gov_links)
    for rows in [ledger,baseline_ledger,research_ledger]:
        assert all(r['retailGradeCoverageVerified'] is False and r['automaticRuntimeImport'] is False for r in rows)
    outputs = [
        ('encar-display-name-ledger',ledger,['encarDisplayOrdinal','encarModelNameRaw','comparisonState','duplicateRawLabelCount','duplicateRawLabelOrdinals','genericLabel','shortOrNumericLabel','encarManufacturerProvided','candidateMakeLabels','multipleCandidateMakeLabels','baselineMatchCount','researchMatchCount','governmentSourceRowCount','governmentMatchCounts','governmentManufacturerRawLabels','retailGradeCoverageVerified','automaticRuntimeImport']),
        ('baseline-model-ledger',baseline_ledger,['targetId','make','group','model','baselinePositions','baselineGradeValues','baselineMarketValues','comparisonState','matchedDisplayRows','encarNameMatches','completionStatus','retailGradeCoverageVerified']),
        ('research-record-ledger',research_ledger,['researchId','make','group','model','market','sourceMarket','sourceId','sourceUrl','comparisonState','matchedDisplayRows','encarNameMatches','completionStatus','retailGradeCoverageVerified']),
    ]
    for name,rows,fields in outputs:
        write_jsonl_gz(out/(name+'.jsonl.gz'),rows)
        write_csv_gz(out/(name+'.csv.gz'),rows,fields)
    write_jsonl_gz(out/'government-name-links.jsonl.gz',gov_links)
    if args.omit_government_csv:
        (out/'government-name-links.csv.gz').unlink(missing_ok=True)
    else:
        write_csv_gz(out/'government-name-links.csv.gz',gov_links,['linkId','encarNameRaw','encarDisplayOrdinals','governmentRawPosition','sourceSheet','sourceRow','nameFieldRaw','governmentNameRaw','manufacturerRaw','formRaw','nameCellTypeRaw','sourceSerialRaw','serialMissing','sourceYear','bestMatchMethod','governmentInputSha256','manufacturerRelationVerified','retailHierarchyVerified'])
    missing = [r for r in ledger if r['comparisonState']=='not_found_under_declared_rules']
    write_csv_gz(out/'encar-unmapped-display-rows.csv.gz',missing,outputs[0][2])
    ambiguous = [r for r in ledger if r['duplicateRawLabelCount']>1 or r['multipleCandidateMakeLabels'] or r['genericLabel']]
    write_csv_gz(out/'encar-ambiguous-display-rows.csv.gz',ambiguous,outputs[0][2])
    snapshot_dir = out/'input-snapshots'
    snapshot_dir.mkdir(exist_ok=True)
    # Preserve exact bytes, even when the new source CLI input is already gzip.
    for input_name in ['encar','baseline','research']:
        snapshot_path = snapshot_dir/(input_name+'-source.'+inputs[input_name]['sha256'][:12]+'.raw.gz')
        with paths[input_name].open('rb') as incoming, snapshot_path.open('wb') as dest:
            with gzip.GzipFile(filename='',fileobj=dest,mode='wb',mtime=0) as compressed:
                shutil.copyfileobj(incoming,compressed)
    def counts(rows):
        return dict(Counter(r['comparisonState'] for r in rows))
    unique_ledger = [next(r for r in ledger if r['encarModelNameRaw']==name) for name in unique_names]
    summary = {'schemaVersion':1,'auditKind':'exhaustive_lexical_display_name_comparison',
        'sourceSnapshot':source_info,'completeLiveEncarRetailHierarchyVerified':False,
        'currentWebToolRenderedListCompared':source_info.get('acquisitionMethod')=='five_overlapping_web_tool_rendered_line_windows',
        'rawOriginCacheFreshnessVerified':False,
        'allDisplayedRowsCompared':True,'normalization':NORMALIZATION,'presentationHintRule':LAYOUT_RULE,
        'manufacturerFieldAbsentInAllRows':all(not r['encarManufacturerProvided'] for r in ledger),
        'displayRows':len(ledger),'uniqueRawLabels':len(unique_names),'duplicateExcessRows':sum(n-1 for n in raw_counts.values()),
        'duplicatedRawLabels':sum(n>1 for n in raw_counts.values()),'genericDisplayRows':sum(r['genericLabel'] for r in ledger),
        'displayRowStates':counts(ledger),'uniqueRawLabelStates':counts(unique_ledger),
        'baselineRawRows':len(baseline_raw),'baselineModelTargets':len(baseline_ledger),'baselineTargetStates':counts(baseline_ledger),
        'researchRecords':len(research_ledger),'researchRecordStates':counts(research_ledger),
        'researchStatesByMarket':{market:counts([r for r in research_ledger if r['market']==market])for market in sorted({r['market'] for r in research_ledger})},
        'governmentRawRowsRead':gov_total,'governmentExplicitNameFieldRows':dict(gov_fields),
        'governmentNameLinks':len(gov_links),'governmentDistinctLinkedSourceRows':len(source_rows),
        'governmentNameMatchMethods':dict(Counter(r['bestMatchMethod'] for r in gov_links)),
        'multipleCandidateMakeLabelDisplayRows':sum(r['multipleCandidateMakeLabels'] for r in ledger),
        'confirmedRetailGradeCorrections':0,'verifiedRetailHierarchiesAdded':0,'completeOfficialMaster':False,'automaticRuntimeImport':False,
        'limitations':[
            'This run compares every row of the archived Encar display list, not every current live Encar classification node.',
            'A display-only name without manufacturer/parent codes cannot establish a complete Encar manufacturer-model-grade hierarchy.',
            'Repeated labels and corporate alias labels remain separate; candidate make labels do not assign an Encar manufacturer.',
            'Name equality and explicit source aliases are candidate relations, not verified generation, engine, year or grade links.',
            'Presentation folding and group/prefix containment are weaker lexical hints; they never close a gap.',
            'Not found means unmatched under the declared rules and input snapshot, not confirmed omission or absence from Encar.',
            'Government prices/form codes and source year are not retail selling prices, grade IDs or vehicle model years.',
            'Global-market research rows are separately counted and need not be present in a Korean-market vehicle list.',
        ]}
    write_json(out/'summary.json',summary)
    write_json(out/'duplicate-labels.json',{'sourceSnapshot':source_info,'rows':[{'modelNameRaw':name,'displayOrdinals':ordinals_by_name[name],'count':count,'manufacturerProvided':False}for name,count in raw_counts.items()if count>1]})
    write_json(out/'confirmed-corrections.json',{'confirmedCorrections':[],'confirmedCount':0,'reason':'The display index lacks manufacturer and classification-parent codes; candidate aliases/layout differences must not overwrite existing generations or trims.'})
    manifest = {'schemaVersion':1,'scope':'Research-only names audit; no source or application mutation','sourceSnapshot':source_info,
        'inputs':inputs,'builder':{'name':Path(__file__).name,'sha256':digest(Path(__file__))},
        'fixedExpectedCounts':{'encarRows':args.expected_encar_rows,'governmentRows':args.expected_government_rows},
        'allDeclaredCountsAndIdentityAssertionsPassed':True,'completeRetailHierarchy':False,
        'governmentLinksCsvIncluded':not args.omit_government_csv,
        'files':[{'path':str(p.relative_to(out)),'bytes':p.stat().st_size,'sha256':digest(p)}for p in sorted(out.rglob('*'))if p.is_file() and p.name!='manifest.json' and p.name!=Path(__file__).name and p.suffix!='.pyc']}
    write_json(out/'manifest.json',manifest)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--encar-source',type=Path,required=True)
    parser.add_argument('--baseline',type=Path,required=True)
    parser.add_argument('--research',type=Path,required=True)
    parser.add_argument('--government-records',type=Path,required=True)
    parser.add_argument('--repository-root',type=Path,default=Path.cwd())
    parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--expected-encar-rows',type=int)
    parser.add_argument('--expected-government-rows',type=int)
    parser.add_argument('--omit-government-csv',action='store_true',help='Keep full government-name JSONL only, omitting its redundant large CSV')
    for key in ['encar','baseline','research','government']:
        parser.add_argument('--expect-'+key+'-sha256')
    args = parser.parse_args()
    result = build(args)
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
