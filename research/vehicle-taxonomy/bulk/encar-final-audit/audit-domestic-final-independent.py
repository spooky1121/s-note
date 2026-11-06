#!/usr/bin/env python3
"""Independent reader of the domestic frozen observations and generated rows.

Does not import the domestic builder, execute its SPECS, fetch the network or
change any supplied source/normalization files.
"""
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from collections import Counter, defaultdict
import argparse
import hashlib
import json
import re


def n(value):
    return re.sub(r'\s+', ' ', str(value)).strip()


def compact(value):
    return re.sub(r'\s+', '', str(value)).casefold()


def row_cells(raw):
    return [n(c) for c in re.sub(r'^L\d+:\s*', '', raw).split('|')]


def split_time_note(cell):
    # Name is retained before an explicit year note. Never create a model year.
    match = re.match(r'^(.*?)\s+(\d{2,4}년\s*.*)$', cell)
    return (match.group(1), match.group(2)) if match else (cell, None)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input-dir', type=Path, default=Path(__file__).resolve().parent/'domestic')
    ap.add_argument('--output', type=Path, default=Path(__file__).resolve().parent/'domestic-independent-audit.json')
    args = ap.parse_args()
    base = args.input_dir
    names = ['additional-22-model-classification-observations.json',
             'encar-final-domestic-expansion-20261107.json',
             'build-additional-domestic-observations.py', 'additional-22-verification.json']
    observed = json.loads((base/names[0]).read_text())['records']
    bundle = json.loads((base/names[1]).read_text())
    verification = json.loads((base/names[3]).read_text())
    handoff = json.loads((base/'handoff-manifest.json').read_text())
    errors, warnings, ledger = [], [], []

    def check(ok, code, **context):
        if not ok:
            errors.append({'code':code, **context})

    for entry in handoff['files']:
        path = base/entry['path']
        check(path.is_file() and path.stat().st_size == entry['bytes'] and digest(path) == entry['sha256'],
              'frozen_handoff_hash_mismatch', path=entry['path'])
    check(handoff.get('frozen') is True, 'handoff_not_frozen')
    check(verification['sourceSha256'] == digest(base/names[1]), 'verification_source_hash_mismatch')
    check(bundle['policy']['automaticRuntimeImport'] is False, 'bundle_auto_import_not_false')
    check(bundle['policy']['currentSearchHierarchyVerified'] is False, 'retail_search_hierarchy_not_false')
    check(len(observed) == len(bundle['sources']) == 22, 'source_or_model_count')
    check(len(bundle['records']) == 222 and len(bundle['quarantinedRecords']) == 1, 'normal_or_quarantine_count')

    sources = {x['id']:x for x in bundle['sources']}
    all_physical, output_physical = set(), set()
    per_model, leaf_classes, fuel_counts = [], Counter(), Counter()
    seen_identities = set()
    for obs in observed:
        model = obs['model']
        doc = obs['classificationDocumentId']
        sid = 'encar-final-domestic-'+doc
        source = sources.get(sid, {})
        parent_q = parse_qs(urlparse(obs['parentUrl']).query)
        cls_q = parse_qs(urlparse(obs['classificationUrl']).query)
        raw_make = re.sub(r'^L\d+: ### ', '', obs['parentHeading']).removesuffix(' '+model)
        rows = {int(re.match(r'^L(\d+):',raw).group(1)):raw for raw in obs['classificationRows']}
        check(len(rows) == len(obs['classificationRows']) and 0 in rows, 'duplicate_or_missing_source_lines', model=model)
        check(cls_q.get('bbsno') == [doc] and cls_q.get('type') == ['CLS'], 'document_or_type_mismatch', model=model)
        check(parent_q.get('mnfccd') == [obs['providerManufacturerCode']], 'manufacturer_code_mismatch', model=model)
        check(parent_q.get('mdlcd') == [obs['providerModelCode']], 'model_code_mismatch', model=model)
        check(obs['providerModelGroupCode'] == (parent_q.get('mdlgroupcd') or [None])[0], 'model_group_code_mismatch', model=model)
        check(obs['parentHeading'].endswith(' '+model), 'parent_heading_model_mismatch', model=model)
        check(source.get('url') == obs['classificationUrl'] and source.get('parentHistoryUrl') == obs['parentUrl'], 'source_url_or_parent_mismatch', model=model)
        check(source.get('sourceMakeRaw') == raw_make and source.get('sourceModelRaw') == model, 'source_raw_identity_mismatch', model=model)
        check(source.get('providerNamespace') == 'encar_history_not_current_search_catalog', 'provider_namespace_mismatch', model=model)

        rs = sorted([r for r in bundle['records'] if r['sourceId'] == sid], key=lambda x:x['sourceRowNumber'])
        qs = [r for r in bundle['quarantinedRecords'] if r['sourceId'] == sid]
        prefix_names = {r['sourceHierarchyRaw'][0] for r in rs}
        middle_names = {r['sourceHierarchyRaw'][1] for r in rs if len(r['sourceHierarchyRaw']) == 3}
        current_prefix, current_middle = None, None
        for line in set(rows)-{0}:
            all_physical.add((doc,line))
        for r in rs:
            line = r['sourceRowNumber']
            key = (doc,line)
            check(key not in output_physical, 'duplicate_physical_row_output', model=model, line=line)
            output_physical.add(key)
            check(r['sourceRowRaw'] == rows.get(line), 'row_bytes_not_preserved', model=model, line=line)
            cells = row_cells(rows[line])
            basic_cells = [split_time_note(c)[0] for c in cells]
            prefix_seen = next((c for c in basic_cells if c in prefix_names), None)
            if prefix_seen is not None:
                if prefix_seen != current_prefix:
                    current_middle = None
                current_prefix = prefix_seen
            middle_seen = next((c for c in basic_cells if c in middle_names), None)
            if middle_seen is not None:
                current_middle = middle_seen
            path = r['sourceHierarchyRaw']
            check(path[0] == current_prefix, 'prefix_not_observed_or_illegal_carry', model=model, line=line)
            if len(path) == 3:
                check(path[1] == current_middle, 'middle_not_observed_or_illegal_carry', model=model, line=line)
            leaf = path[-1]
            if leaf in cells:
                leaf_class = 'exact_whitespace_normalized_literal_cell'
            elif leaf in basic_cells:
                leaf_class = 'literal_name_with_explicit_time_annotation_removed'
            else:
                leaf_class = 'unverified'
                check(False, 'leaf_not_literal_or_annotated_name', model=model, line=line, leaf=leaf, cells=cells)
            leaf_classes[leaf_class] += 1
            check(r['sourceTimeColumnsRaw'] == rows[0], 'time_header_not_preserved', model=model, line=line)
            check(r['sourceModelPeriodRaw'] == re.sub(r'^L\d+: ', '', obs['periodRaw']), 'period_not_preserved', model=model, line=line)
            check(r.get('modelYear') is None and r.get('engine') is None, 'unknown_year_or_engine_filled', model=model, line=line)
            check(not r.get('drivetrain') and not r.get('transmission'), 'unknown_drive_or_transmission_filled', model=model, line=line)
            expected_fuel = next((x for x in ['가솔린','디젤','LPG','전기'] if x in current_prefix), None)
            check(r.get('fuel') == expected_fuel, 'fuel_not_explicit_in_verified_prefix', model=model, line=line)
            fuel_counts[r.get('fuel') or 'unknown'] += 1
            identifiers = r['providerIdentifiers']
            for name, expected in [('namespace','encar_history'),('manufacturerCode',obs['providerManufacturerCode']),
                                   ('modelCode',obs['providerModelCode']),('modelGroupCode',obs['providerModelGroupCode']),
                                   ('documentId',doc),('gradeCode',None),('subgradeCode',None)]:
                check(identifiers.get(name) == expected, 'provider_identifier_mismatch', model=model, line=line, field=name)
            check(r['autoImport'] is False and r['retailSearchHierarchyVerified'] is False, 'row_retail_or_import_flag', model=model, line=line)
            check(r['mappingStatus'] == 'needs_parent_and_temporal_variant_match', 'mapping_review_flag_missing', model=model, line=line)
            check(r['make'] == obs['make'] and r['group'] == obs['group'] and r['model'] == model and
                  r['sourceMakeRaw'] == raw_make and r['sourceModelRaw'] == model and
                  r['sourceUrl'] == obs['classificationUrl'] and r['parentHistoryUrl'] == obs['parentUrl'],
                  'record_model_or_manufacturer_block_mixture', model=model, line=line)
            expected_grade, expected_subgrade = (path[0],path[1]) if len(path) == 2 else (' '.join(path[:2]),path[2])
            check(r['grade'] == expected_grade and r['subgrade'] == expected_subgrade, 'observation_path_encoding_mismatch', model=model, line=line)
            identity = (sid,tuple(path))
            check(identity not in seen_identities, 'duplicate_observation_identity', model=model, line=line)
            seen_identities.add(identity)
            ledger.append({'sourceId':sid,'model':model,'sourceLine':line,'sourceHierarchyRaw':path,
                           'leafEvidence':leaf_class,'powertrainPrefixLiteralOrVerifiedCarry':current_prefix,
                           'middleLiteralOrVerifiedCarry':current_middle if len(path) == 3 else None,
                           'modelYear':None,'engine':None,'fuel':r.get('fuel'),'sourceTimeHeaderPreserved':True,
                           'currentRetailHierarchyVerified':False,'automaticRuntimeImport':False})
        for q in qs:
            line = q['sourceRowNumber']
            check((doc,line) not in output_physical, 'quarantine_duplicates_normal_row', model=model, line=line)
            output_physical.add((doc,line))
            check(q['sourceRowRaw'] == rows.get(line) and q['sourceUrl'] == obs['classificationUrl'], 'quarantine_source_mismatch', model=model, line=line)
            check(q.get('eligibleForRuntimeImport') is False, 'quarantine_import_flag', model=model, line=line)
            check(model == 'SM5' and line == 9 and q['sourceHierarchyRaw'] == ['2.5','525V','LE 블랙'], 'unexpected_quarantined_row', model=model, line=line)
        per_model.append({'model':model,'sourceId':sid,'physicalRows':len(rows)-1,'normalRows':len(rs),
                          'quarantinedRows':len(qs),'manufacturerCode':obs['providerManufacturerCode'],
                          'modelCode':obs['providerModelCode'],'allRowsAccounted':len(rs)+len(qs)==len(rows)-1})

    check(all_physical == output_physical and len(all_physical) == 223, 'physical_row_accounting_not_exact')
    check(len(seen_identities) == 222, 'normal_identity_count_mismatch')
    warnings.append({'code':'SM7_FIXED_LABEL_AND_TEMPORAL_CELL_VARIATION','model':'SM7',
                     'sourceLine':7,'sourceRowRaw':'L7: RE35 블랙  |    | RE35',
                     'interpretation':'The fixed row-name RE35 블랙 is a literal observation; temporal cell RE35 is retained in sourceRowRaw. Do not treat the historical matrix as a single current retail hierarchy or infer time validity. Not a confirmed wrong observation.'})
    result = {'schemaVersion':1,'independentReader':True,'inputBuilderNotImportedOrExecuted':True,
              'networkCalls':0,'sourceOrRepositoryFilesModified':False,'status':'PASS' if not errors else 'FAIL',
              'counts':{'models':len(observed),'normalObservations':len(bundle['records']),
                        'quarantinedRows':len(bundle['quarantinedRecords']),'physicalRows':len(all_physical),
                        'normalUniquePhysicalRows':len(ledger),'uniqueEvidenceIdentities':len(seen_identities),
                        'leafEvidence':dict(leaf_classes),'fuel':dict(fuel_counts),'errors':len(errors)},
              'allPhysicalRowsExactlyAccounted':all_physical==output_physical,
              'sourceFrozenManifestHashesMatch':not any(e['code']=='frozen_handoff_hash_mismatch'for e in errors),
              'inputSha256':{name:digest(base/name)for name in names},
              'domesticHandoffSha256':digest(base/'handoff-manifest.json'),
              'limitations':['This is an independent audit of supplied factual observations, not a fresh website fetch.',
                             'A historical time-matrix path is not evidence of current Encar five-stage search codes.',
                             'Year-note removal is confined to display-name extraction; source rows and time headers are preserved.'],
              'warnings':warnings,'errors':errors,'perModel':per_model,'recordLedger':ledger}
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({key:result[key] for key in ['status','counts','allPhysicalRowsExactlyAccounted','sourceFrozenManifestHashesMatch']},ensure_ascii=False))
    if errors:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
