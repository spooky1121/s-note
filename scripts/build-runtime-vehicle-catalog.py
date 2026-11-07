#!/usr/bin/env python3
"""Build the replacement selection catalog and verify the immutable legacy backup.

All normalized research observations are included. This script never connects to
Supabase, reads company/user records, or changes vehicle registrations. Raw
source records remain available by exact JSON pointers and SHA-256 in the
committed research archive; nonduplicate source conditions are also retained.
"""
from __future__ import annotations

import argparse
import collections
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import subprocess
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / 'research/vehicle-taxonomy'
INPUT = RESEARCH / 'exports/official-research.json'
INTEGRATION = RESEARCH / 'runtime-integration'
RUNTIME = ROOT / 'assets/vehicle-catalog.json'
BACKUP = INTEGRATION / 'legacy-bundled-backup.json'
CATALOG_VERSION = 'research-20261107-v1'
EXPECTED_COUNT = 3128
CONSTANTS = ('STARTER_TAXONOMY', 'BUNDLED_CATALOG_V118',
             'HEYDEALER_PUBLIC_REFERENCES', 'ZEROCAR_ADDED_MODELS_V194')
LEGACY_FIELDS = ('make', 'group', 'model', 'grade', 'subgrade')
OFFICIAL_MARKS = {'official', 'official_price_page'}
ALIASES = {
    'model_year': 'modelYear',
    'source_url': 'sourceUrl',
    'verification': 'evidenceStatus',
    'source': 'sourceId',
    'review_note': 'notes',
}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(value, ensure_ascii=False, allow_nan=False,
                            **({'separators': (',', ':')} if compact else {'indent': 2})) + '\n'
    path.write_bytes(serialized.encode('utf-8'))


def file_meta(path):
    content = path.read_bytes()
    return {'path': str(path.relative_to(ROOT)), 'bytes': len(content),
            'sha256': digest(content)}


def legacy_identity(row):
    return tuple(str(row.get(field, '')).strip() for field in LEGACY_FIELDS)


def legacy_normalized(value):
    return re.sub('[A-Z]', lambda m: m[0].lower(),
                  re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', value).strip()))


def read_legacy(commit):
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('A full immutable legacy source commit is required')
    html_bytes = subprocess.check_output(['git', 'show', commit + ':index.html'], cwd=ROOT)
    html = html_bytes.decode('utf-8')
    decoder = json.JSONDecoder()
    arrays = {}
    for name in CONSTANTS:
        marker = re.search(r'const\s+' + re.escape(name) + r'\s*=\s*', html)
        if marker is None:
            raise ValueError('Legacy source array missing: ' + name)
        arrays[name] = decoder.raw_decode(html[marker.end():])[0]
    selected = {}
    for name in CONSTANTS[1:]:
        for row in arrays[name]:
            identity = legacy_identity(row)
            previous = selected.get(identity)
            if previous is None or (row.get('verification') in OFFICIAL_MARKS
                                    and previous.get('verification') not in OFFICIAL_MARKS):
                selected[identity] = row
    records = list(selected.values())
    domestic = {}
    for row in records:
        if row.get('market') and row['market'] not in ('KR', 'UNSPECIFIED'):
            continue
        identity = tuple(legacy_normalized(str(row.get(field, ''))) for field in LEGACY_FIELDS)
        domestic.setdefault(identity, row)
    return html_bytes, arrays, records, domestic


def verify_or_create_backup(commit):
    html_bytes, arrays, records, domestic = read_legacy(commit)
    baseline = json.loads((RESEARCH / 'baseline/catalog.json').read_text(encoding='utf-8'))
    if records != baseline['records']:
        raise ValueError('Pre-replacement selection differs from the preserved baseline')
    if len(records) != 1615 or len(domestic) != 1383:
        raise ValueError('Unexpected pre-replacement catalog counts')
    if BACKUP.exists():
        document = json.loads(BACKUP.read_text(encoding='utf-8'))
        if document['source']['commit'] != commit:
            raise ValueError('An immutable legacy backup from another commit already exists')
        if document['arrays'] != arrays or document['selectedRecords'] != records:
            raise ValueError('Existing legacy backup bytes decode to changed source records')
        if document['source']['fileSha256'] != digest(html_bytes):
            raise ValueError('Legacy source HTML checksum differs')
        expected_counts = {
            'rawArrays': {name: len(rows) for name, rows in arrays.items()},
            'selectedRecords': len(records), 'domesticSelectedRecords': len(domestic),
        }
        if document['counts'] != expected_counts:
            raise ValueError('Legacy backup counts differ from the archived arrays')
        if document.get('operationalCompanyOrUserDataIncluded') is not False:
            raise ValueError('Public static backup must exclude operational company/user data')
    else:
        document = {
            'schemaVersion': 1,
            'kind': 'immutable_pre_replacement_bundled_selection_backup',
            'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(),
            'source': {
                'repository': 'spooky1121/s-note', 'commit': commit,
                'path': 'index.html', 'fileSha256': digest(html_bytes),
                'gitBlobSha': subprocess.check_output(
                    ['git', 'rev-parse', commit + ':index.html'], cwd=ROOT, text=True).strip(),
                'workingTreeUsed': False,
            },
            'selectionPolicy': 'First five-field identity wins unless a later official/official_price_page replaces a non-official row; KR/UNSPECIFIED domestic filtering preserved. STARTER_TAXONOMY is archived separately and was not added again to the final public list.',
            'counts': {'rawArrays': {name: len(rows) for name, rows in arrays.items()},
                       'selectedRecords': len(records), 'domesticSelectedRecords': len(domestic)},
            'arrays': arrays, 'selectedRecords': records,
            'operationalCompanyOrUserDataIncluded': False,
        }
        write_json(BACKUP, document)
    return document


def source_reference(position, source_record, pointer):
    return {
        'jsonPointer': pointer,
        'sourceRecordSha256': digest(canonical(source_record)),
        'recordPosition': position,
    }


def project_record(row, archive_hash, position):
    # Preserve every normalized field, including corrections and qualifiers.
    runtime = copy.deepcopy({key: value for key, value in row.items()
                             if key not in ('sourceRecord', 'evidence')})
    runtime['id'] = row['researchId']
    for target, original in ALIASES.items():
        runtime[target] = copy.deepcopy(row.get(original, ''))
    source_record = row['sourceRecord']
    if not isinstance(source_record, dict):
        raise ValueError('Saved sourceRecord must be an object')
    pointer = f'/records/{position - 1}/sourceRecord'
    runtime['sourceRecordRef'] = source_reference(position, source_record, pointer)
    # Every saved condition is either explicitly copied or exactly reconstructible
    # from an identically named normalized field. Null versus empty stays distinct.
    conditions = {}
    for key, value in source_record.items():
        if key in runtime and value == runtime[key] and type(value) is type(runtime[key]):
            continue
        else:
            conditions[key] = copy.deepcopy(value)
    runtime['savedSourceConditions'] = conditions
    # Evidence records retain every non-body field; each original body has an
    # unambiguous JSON pointer and its own canonical hash in the original archive.
    evidence = []
    for ordinal, original in enumerate(row.get('evidence', [])):
        item = copy.deepcopy({key: value for key, value in original.items() if key != 'sourceRecord'})
        if 'sourceRecord' in original:
            item['sourceRecordRef'] = source_reference(
                position, original['sourceRecord'],
                f'/records/{position - 1}/evidence/{ordinal}/sourceRecord')
        evidence.append(item)
    runtime['evidence'] = evidence
    return runtime


def verify_projection(source, runtime, archive_hash):
    expected = source['records']
    actual = runtime['records']
    if runtime['source']['sha256'] != archive_hash:
        raise ValueError('The global source archive checksum changed')
    if len(expected) != EXPECTED_COUNT or len(actual) != len(expected):
        raise ValueError('Every one of the 3128 observations must be included')
    if [row['id'] for row in actual] != [row['researchId'] for row in expected]:
        raise ValueError('Source order or research observation identity changed')
    if len({row['id'] for row in actual}) != len(actual):
        raise ValueError('Observation IDs must remain unique')
    restored_source_records = 0
    evidence_references = 0
    for position, (original, projected) in enumerate(zip(expected, actual), 1):
        for key, value in original.items():
            if key not in ('sourceRecord', 'evidence') and projected.get(key) != value:
                raise ValueError('Normalized field changed: ' + key)
        for alias, canonical_key in ALIASES.items():
            if projected[alias] != original[canonical_key]:
                raise ValueError('Compatibility alias changed source values: ' + alias)
        reference = projected['sourceRecordRef']
        if reference['jsonPointer'] != f'/records/{position - 1}/sourceRecord':
            raise ValueError('Source reference changed')
        restored = copy.deepcopy(projected['savedSourceConditions'])
        for source_key in original['sourceRecord']:
            if source_key not in restored:
                if source_key not in projected:
                    raise ValueError('An original source condition was removed')
                restored[source_key] = copy.deepcopy(projected[source_key])
        if canonical(restored) != canonical(original['sourceRecord']):
            raise ValueError('Saved source conditions are not losslessly reconstructible')
        if digest(canonical(restored)) != reference['sourceRecordSha256']:
            raise ValueError('Source-record reference checksum differs')
        restored_source_records += 1
        if len(projected['evidence']) != len(original.get('evidence', [])):
            raise ValueError('Evidence entries were removed')
        for ordinal, (before, after) in enumerate(zip(original.get('evidence', []), projected['evidence'])):
            for key, value in before.items():
                if key != 'sourceRecord' and after.get(key) != value:
                    raise ValueError('Evidence metadata changed')
            if 'sourceRecord' in before:
                ref = after['sourceRecordRef']
                if ref['jsonPointer'] != f'/records/{position - 1}/evidence/{ordinal}/sourceRecord':
                    raise ValueError('Evidence pointer changed')
                if ref['sourceRecordSha256'] != digest(canonical(before['sourceRecord'])):
                    raise ValueError('Evidence source-record checksum differs')
                evidence_references += 1
    return {
        'sourceObservations': len(expected), 'runtimeObservations': len(actual),
        'allNormalizedFieldsExactlyPreserved': True,
        'savedSourceRecordsLosslesslyReconstructed': restored_source_records,
        'evidenceSourceReferencesVerified': evidence_references,
        'uniqueObservationIds': len({row['id'] for row in actual}),
        'fiveFieldDeduplicationApplied': False, 'recordFilteringApplied': False,
    }


def build(check=False, requested_legacy_commit=None):
    INTEGRATION.mkdir(parents=True, exist_ok=True)
    if check and not BACKUP.is_file():
        raise ValueError('The immutable legacy backup is missing; check mode does not create it')
    if requested_legacy_commit:
        commit = requested_legacy_commit
    elif BACKUP.exists():
        commit = json.loads(BACKUP.read_text(encoding='utf-8'))['source']['commit']
    else:
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    backup = verify_or_create_backup(commit)
    input_bytes = INPUT.read_bytes()
    archive_hash = digest(input_bytes)
    source = json.loads(input_bytes)
    rows = source['records']
    projected = [project_record(row, archive_hash, position) for position, row in enumerate(rows, 1)]
    markets = dict(sorted(collections.Counter(row['market'] for row in projected).items()))
    if markets != {'GLOBAL': 154, 'KR': 2974}:
        raise ValueError('The replacement must preserve both KR and GLOBAL research scopes')
    runtime = {
        'schemaVersion': 1, 'catalogVersion': CATALOG_VERSION,
        'source': {
            **file_meta(INPUT), 'asOf': source['asOf'],
            'repository': 'spooky1121/s-note',
            'researchSourceCommit': 'f18d49d4fdb2bc8becf0180ba0e9d16928b16d94',
        },
        'counts': {
            'records': len(projected), 'byMarket': markets,
            'byEvidenceStatus': dict(sorted(collections.Counter(row['evidenceStatus'] for row in projected).items())),
            'sourceIds': len({row['sourceId'] for row in projected}),
            'distinctSourceUrls': len({row['sourceUrl'] for row in projected}),
        },
        'identity': {
            'primaryKey': 'id', 'idEqualsResearchId': True,
            'fiveFieldDeduplication': False,
            'meaning': 'A source-context observation; matching make/group/model/grade/subgrade does not merge years, engines, markets or options.',
        },
        'selectionPolicy': {
            'mode': 'replace_legacy_catalog', 'allResearchObservationsIncluded': True,
            'legacyRowsIncluded': False, 'sourceCollectionAutoImportFlagsAreHistoricalProvenance': True,
            'marketAndContextLabelsRequired': True,
            'authorization': 'User explicitly requested full replacement on 2026-11-07.',
        },
        'completeOfficialMaster': False,
        'recordFilteringApplied': False,
        'rawEvidencePreservation': {
            'archivePath': str(INPUT.relative_to(ROOT)), 'archiveSha256': archive_hash,
            'perRecordReferencesUseThisGlobalArchive': True,
            'savedConditionsKey': 'savedSourceConditions',
            'sourceRecordBodyHashAlgorithm': 'SHA-256 over UTF-8 JSON with recursively sorted keys, no ASCII escaping and comma/colon separators',
            'savedSourceConditionsMeaning': 'Original saved research fields, including original collection flags. Verified normalized corrections remain in qualifiers and sourceCorrections; saved originals are not rewritten.',
        },
        'records': projected,
    }
    # The external audit descriptor is separate from the runtime JSON bytes.
    # The database RPC uses the complete UTF-8 runtime file's SHA-256.
    dataset_manifest = {
        'dataset_version': CATALOG_VERSION,
        'source_sha256': archive_hash,
        'entry_count': len(projected),
        'record_ids_sha256': digest(canonical([row['id'] for row in projected])),
        'records_sha256': digest(canonical(projected)),
    }
    verification = verify_projection(source, runtime, archive_hash)
    if check:
        if not RUNTIME.exists() or json.loads(RUNTIME.read_text(encoding='utf-8')) != runtime:
            raise ValueError('The stored runtime catalog differs from the source projection')
        manifest = json.loads((INTEGRATION / 'manifest.json').read_text(encoding='utf-8'))
        if (manifest['datasetManifest'] != dataset_manifest
                or manifest['manifestSha256'] != file_meta(RUNTIME)['sha256']):
            raise ValueError('Runtime and integration manifest metadata differ')
        for entry in manifest['files']:
            path = ROOT / entry['path']
            if file_meta(path) != entry:
                raise ValueError('Runtime integration artifact hash mismatch: ' + entry['path'])
        print(json.dumps({'ok': True, **verification}, ensure_ascii=False))
        return
    write_json(RUNTIME, runtime, compact=True)
    fields = ('make', 'group', 'model', 'grade', 'subgrade')
    manifest = {
        'schemaVersion': 1, 'catalogVersion': CATALOG_VERSION,
        'datasetManifest': dataset_manifest,
        'manifestSha256': file_meta(RUNTIME)['sha256'],
        'source': file_meta(INPUT),
        'legacyBackup': {
            **file_meta(BACKUP), 'sourceCommit': backup['source']['commit'],
            'bundledRows': backup['counts']['selectedRecords'],
            'domesticRows': backup['counts']['domesticSelectedRecords'],
            'operationalCompanyOrUserDataIncluded': False,
        },
        'counts': runtime['counts'],
        'fieldStats': {
            'maximumStringLengths': {key: max(len(row[key]) for row in projected) for key in fields},
            'emptyFieldRows': {key: sum(not row[key] for row in projected) for key in fields},
            'modelYearRawValues': dict(sorted(collections.Counter(row['modelYear'] for row in projected).items())),
            'uniqueFiveFieldLabels': len({tuple(row[key] for key in fields) for row in projected}),
            'sameFiveFieldLabelExcessObservationsRetained': len(projected) - len({tuple(row[key] for key in fields) for row in projected}),
        },
        'verification': verification,
        'runtimeCatalog': file_meta(RUNTIME),
        'files': [file_meta(path) for path in (RUNTIME, BACKUP, Path(__file__).resolve())],
        'productionCompanyBackupScope': 'Operational company taxonomy is backed up privately by the deployment migration, never copied into this public artifact.',
    }
    write_json(INTEGRATION / 'manifest.json', manifest)
    print(json.dumps({'ok': True, 'catalogVersion': CATALOG_VERSION,
                      'runtime': file_meta(RUNTIME), 'manifest': file_meta(INTEGRATION / 'manifest.json'),
                      **verification}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify all existing output values and hashes without rewriting them')
    parser.add_argument('--legacy-source-commit', help='Full pre-replacement source commit; immutable once the backup exists')
    args = parser.parse_args()
    build(args.check, args.legacy_source_commit)
