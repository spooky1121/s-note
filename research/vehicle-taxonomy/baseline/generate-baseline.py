#!/usr/bin/env python3
"""Audit the existing S-NOTE bundle without changing runtime data or the database."""
from __future__ import annotations

import collections
import csv
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import unicodedata

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
CONSTANTS = ['BUNDLED_CATALOG_V118', 'HEYDEALER_PUBLIC_REFERENCES', 'ZEROCAR_ADDED_MODELS_V194']
FIELDS = ['make', 'group', 'model', 'grade', 'subgrade', 'model_year', 'verification', 'source', 'source_url', 'review_note', 'market']
OFFICIAL = {'official', 'official_price_page'}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def label(value: str) -> str:
    return re.sub('[A-Z]', lambda m: m[0].lower(), re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', value).strip()))


def identity(row: dict) -> tuple:
    return tuple(str(row.get(field, '')).strip() for field in ['make', 'group', 'model', 'grade', 'subgrade'])


def generation(row: dict) -> tuple:
    return tuple(row.get(field, '') for field in ['make', 'group', 'model'])


def write_json(name: str, value: object) -> None:
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def write_csv(name: str, columns: list[str], rows: list[dict]) -> None:
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, columns, extrasaction='ignore', lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    (OUT / name).write_text(stream.getvalue())


def summarize(rows: list[dict]) -> dict:
    generations = {generation(row) for row in rows}
    with_grade = {generation(row) for row in rows if row.get('grade')}
    return {
        'records': len(rows),
        'manufacturers': len({row['make'] for row in rows}),
        'modelGroups': len({(row['make'], row['group']) for row in rows}),
        'generations': len(generations),
        'generationsWithAtLeastOneTrim': len(with_grade),
        'generationsWithoutAnyTrim': len(generations - with_grade),
        'gradeRows': sum(bool(row.get('grade')) for row in rows),
        'emptyGradeRows': sum(not row.get('grade') for row in rows),
        'subgradeRows': sum(bool(row.get('subgrade')) for row in rows),
        'legacyOfficialMarkedRows': sum(row.get('verification') in OFFICIAL for row in rows),
        'recordsWithSourceUrl': sum(bool(row.get('source_url')) for row in rows),
        'distinctSourceUrls': len({row['source_url'] for row in rows if row.get('source_url')}),
        'byVerification': dict(sorted(collections.Counter(row.get('verification', '') for row in rows).items())),
        'byMarket': dict(sorted(collections.Counter(row.get('market', '') for row in rows).items())),
    }


def main() -> None:
    html_bytes = (ROOT / 'index.html').read_bytes()
    html = html_bytes.decode('utf-8')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    arrays = {}
    decoder = json.JSONDecoder()
    for name in CONSTANTS:
        marker = 'const ' + name + ' = '
        at = html.index(marker) + len(marker)
        arrays[name] = decoder.raw_decode(html[at:])[0]
    raw = [row for name in CONSTANTS for row in arrays[name]]
    selected = {}
    duplicates = collections.defaultdict(list)
    for name in CONSTANTS:
        for index, row in enumerate(arrays[name]):
            key = identity(row)
            duplicates[key].append({'constant': name, 'arrayIndex': index, 'verification': row.get('verification'), 'market': row.get('market')})
            previous = selected.get(key)
            # Same policy as snote220PublicRows(), index.html:3974-3976.
            if previous is None or (row.get('verification') in OFFICIAL and previous.get('verification') not in OFFICIAL):
                selected[key] = row
    records = list(selected.values())
    domestic = []
    normalized_seen = set()
    for row in records:
        if row.get('market') and row['market'] not in {'KR', 'UNSPECIFIED'}:
            continue
        key = tuple(label(row.get(field, '')) for field in ['make', 'group', 'model', 'grade', 'subgrade'])
        if key not in normalized_seen:
            normalized_seen.add(key)
            domestic.append(row)
    domestic_identities = {identity(row) for row in domestic}
    source = {
        'repository': 'spooky1121/s-note',
        'commit': head,
        'path': 'index.html',
        'constant': 'BUNDLED_CATALOG_V118 after HEYDEALER_PUBLIC_REFERENCES and ZEROCAR_ADDED_MODELS_V194 pushes',
        'constants': CONSTANTS,
        'fileSha256': digest(html_bytes),
        'arrayRows': {name: len(arrays[name]) for name in CONSTANTS},
        'deduplication': 'taxonomyKey identity make/group/model/grade/subgrade; first row wins unless a later official/official_price_page replaces a non-official row, as snote220PublicRows',
    }
    catalog = {'schemaVersion': 1, 'source': source, 'records': records}
    write_json('catalog.json', catalog)
    write_csv('catalog.csv', FIELDS + ['included_in_domestic_picker'], [dict(row, included_in_domestic_picker=str(identity(row) in domestic_identities).lower()) for row in records])

    manufacturers = []
    for make in sorted({row['make'] for row in records}):
        all_rows = [row for row in records if row['make'] == make]
        picker_rows = [row for row in domestic if row['make'] == make]
        summary = summarize(picker_rows)
        manufacturers.append({'make': make, 'catalog_records': len(all_rows), 'picker_records': len(picker_rows), 'model_groups': summary['modelGroups'], 'generations': summary['generations'], 'generations_with_trim': summary['generationsWithAtLeastOneTrim'], 'generations_without_trim': summary['generationsWithoutAnyTrim'], 'grade_rows': summary['gradeRows'], 'legacy_official_marked_rows': summary['legacyOfficialMarkedRows'], 'source_urls': summary['distinctSourceUrls']})
    write_csv('manufacturer-coverage.csv', list(manufacturers[0]), manufacturers)

    graded = {generation(row) for row in domestic if row.get('grade')}
    gaps = [row for row in domestic if generation(row) not in graded]
    write_csv('missing-trims.csv', ['make', 'group', 'model', 'model_year', 'verification', 'source', 'source_url', 'review_note'], sorted(gaps, key=lambda row: generation(row)))
    sources = []
    for (source_name, url) in sorted({(row.get('source', ''), row.get('source_url', '')) for row in records}):
        associated = [row for row in records if row.get('source', '') == source_name and row.get('source_url', '') == url]
        sources.append({'source': source_name, 'source_url': url, 'records': len(associated), 'manufacturers': ' | '.join(sorted({row['make'] for row in associated})), 'legacy_verifications': ' | '.join(sorted({row.get('verification', '') for row in associated})), 'reverified_in_this_audit': 'false'})
    write_csv('sources.csv', list(sources[0]), sources)
    coverage = {
        'schemaVersion': 1,
        'auditDate': dt.datetime.now(dt.timezone.utc).date().isoformat(),
        'source': source,
        'rawArrayRecords': len(raw),
        'exactIdentityDuplicateRows': len(raw) - len(records),
        'allCatalog': summarize(records),
        'domesticPicker': summarize(domestic),
        'excludedMarketRows': len(records) - sum(not row.get('market') or row['market'] in {'KR', 'UNSPECIFIED'} for row in records),
        'domesticNormalizationDuplicates': sum(not row.get('market') or row['market'] in {'KR', 'UNSPECIFIED'} for row in records) - len(domestic),
        'existingOfficialMarksWereReverified': False,
        'completenessKnown': False,
        'manufacturerCoverage': manufacturers,
        'possibleAliasesRequiringReview': [['KGM', 'KG모빌리티(쌍용)'], ['르노코리아', '르노코리아(삼성)'], ['쉐보레', '쉐보레(GM대우)'], ['대우', '쉐보레(GM대우)']],
        'duplicateIdentities': [{'identity': list(key), 'occurrences': value} for key, value in duplicates.items() if len(value) > 1],
        'limitations': [
            'Snapshot is bundled data, not a live operational database inventory.',
            'Official verification labels and URLs are inherited metadata; this extraction does not revalidate current official prices or years.',
            'One observed trim is not evidence that all trims for that generation have been collected.',
            'The bundle has no separate nonempty subgrade rows and no provider parent classification codes.',
            'KR_REVIEW rows are excluded by the online domestic selector; do not equate allCatalog counts with picker counts.',
            'Manufacturer alias groups are review candidates only; historical brands and generations must not be merged without evidence.',
        ],
    }
    write_json('coverage.json', coverage)
    artifact_names = ['catalog.json', 'catalog.csv', 'manufacturer-coverage.csv', 'missing-trims.csv', 'sources.csv', 'coverage.json']
    write_json('manifest.json', {'schemaVersion': 1, 'repositoryCommit': head, 'sourceFileSha256': source['fileSha256'], 'files': [{'path': 'research/vehicle-taxonomy/baseline/' + name, 'bytes': (OUT / name).stat().st_size, 'sha256': digest((OUT / name).read_bytes())} for name in artifact_names]})
    assert len(records) == len({identity(row) for row in records})
    assert len(domestic) == len(domestic_identities)
    assert len(gaps) == len({generation(row) for row in gaps})
    print(json.dumps({'allCatalog': coverage['allCatalog'], 'domesticPicker': coverage['domesticPicker'], 'output': str(OUT)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
