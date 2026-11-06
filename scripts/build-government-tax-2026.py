#!/usr/bin/env python3
"""Build a read-only research index from the 2026 government tax-reference snapshot.

Default input: ROOT/research/vehicle-taxonomy/bulk/government-tax-2026/amended.
Default output: /workspace/work/government-tax-2026 when available, otherwise the system temporary directory.
Original workbook can be read and SHA-256 checked directly inside source-original.zip; a standalone XLSX is optional.
  python build-government-tax-2026.py --input-dir bulk/government-tax-2026 --output-dir derived
  python build-government-tax-2026.py --search '기아 카니발' --database derived/government-tax-2026.sqlite
No network, dependency installation, Excel macros, or source formulas are executed.
Prices are administrative tax-reference observations, never vehicle selling prices.
"""
from __future__ import annotations
import argparse
import collections
import csv
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
import gzip
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import sys
import unicodedata
import zipfile

SCHEMA_VERSION = 1
SOURCE_YEAR = 2026
DATABASE_NAME = 'government-tax-2026.sqlite'
SOURCE_NOTICE = '행정안전부고시 제2025-83호 (2025-12-29 개정, 2026-01-01 시행)'
NUMERIC = re.compile(r'^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$')
INT64_MIN, INT64_MAX = -(2**63), 2**63 - 1


def json_text(value, *, sort_keys=False):
    return json.dumps(value, ensure_ascii=False, sort_keys=sort_keys, separators=(',', ':'))


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for data in iter(lambda: f.read(1024 * 1024), b''):
            h.update(data)
    return h.hexdigest()


def stable_hash(kind, archive_hash, **values):
    payload = {'namespace': 'government-local-tax-2026', 'kind': kind,
               'archiveSha256': archive_hash, **values}
    return hashlib.sha256(json_text(payload, sort_keys=True).encode('utf-8')).hexdigest()


def decimal_text(value):
    text = format(value, 'f')
    if '.' in text:
        text = text.rstrip('0').rstrip('.')
    return text if text not in ('', '-0') else '0'


def parse_price(raw, cell_type, unit='천원', unit_source='explicit_unit_argument'):
    """Preserve raw text; exact Decimal arithmetic; never truncate or replace missing with 0."""
    if unit not in ('천원', '원'):
        raise ValueError('Unknown or unsupported source amount unit: ' + repr(unit))
    result = {'sourcePriceRaw': raw, 'sourcePriceUnitRaw': unit, 'unitSource': unit_source,
              'sourcePriceThousandsRaw': raw if unit == '천원' else None,
              'sourcePriceWonRaw': raw if unit == '원' else None, 'priceCellTypeRaw': cell_type,
              'wonExact': None, 'wonInteger': None, 'wonRoundingCandidate': None,
              'amountParseStatus': 'missing', 'requiresReview': 1, 'reviewReasons': []}
    if raw is None or not str(raw).strip():
        result['reviewReasons'] = ['source_price_missing']
        return result
    cleaned = unicodedata.normalize('NFKC', str(raw)).strip()
    if cleaned == '-':
        result['amountParseStatus'] = 'undetermined_marker'
        result['reviewReasons'] = ['source_price_undetermined_not_zero']
        return result
    cleaned = cleaned.replace(',', '')
    if not NUMERIC.fullmatch(cleaned):
        result['amountParseStatus'] = 'unparsed_text'
        result['reviewReasons'] = ['source_price_is_not_a_numeric_literal']
        return result
    try:
        with localcontext() as ctx:
            ctx.prec = max(64, len(cleaned) + 12)
            price = Decimal(cleaned)
            won = price * (Decimal(1000) if unit == '천원' else Decimal(1))
            result['wonExact'] = decimal_text(won)
            if won == won.to_integral_value():
                integer = int(won)
                if INT64_MIN <= integer <= INT64_MAX:
                    result['wonInteger'] = integer
                    result['amountParseStatus'] = 'exact_integer_won'
                    result['requiresReview'] = 0
                else:
                    result['amountParseStatus'] = 'integer_out_of_sqlite_range'
                    result['reviewReasons'] = ['exact_won_exceeds_signed_64_bit_integer']
            else:
                result['amountParseStatus'] = 'non_integer_won_requires_review'
                result['wonRoundingCandidate'] = decimal_text(won.to_integral_value(rounding=ROUND_HALF_UP))
                result['reviewReasons'] = ['exact_source_value_produces_fractional_won']
                if cell_type == 'n' and price.as_tuple().exponent < -8:
                    result['amountParseStatus'] = 'source_float_artifact_requires_review'
                    result['reviewReasons'].append('long_fractional_numeric_representation_in_source')
            return result
    except (InvalidOperation, ValueError, OverflowError):
        result['amountParseStatus'] = 'invalid_numeric_literal'
        result['reviewReasons'] = ['numeric_literal_could_not_be_evaluated_exactly']
        return result


def typed_fields_json(fields, cell_types):
    """JSON number/string types plus exact XML lexical value retained separately in fields_raw_json."""
    pairs = []
    for key, raw in fields.items():
        kind = cell_types.get(key)
        if raw is None:
            encoded = 'null'
        elif kind == 'n' and NUMERIC.fullmatch(str(raw)):
            with localcontext() as ctx:
                ctx.prec = max(64, len(str(raw)) + 8)
                encoded = decimal_text(Decimal(str(raw)))
        elif kind == 'b':
            encoded = 'true' if raw == '1' else 'false'
        else:
            encoded = json_text(raw)
        pairs.append(json_text(key) + ':' + encoded)
    result = '{' + ','.join(pairs) + '}'
    json.loads(result)  # ensure the emitted JSON is valid; do not replace exact numeric lexical data
    return result


def typed_key(raw, kind):
    if raw is None:
        return None
    if kind == 'n' and NUMERIC.fullmatch(str(raw)):
        return ('n', decimal_text(Decimal(str(raw))))
    return (kind or 'unknown', raw)


def decoded_zip_name(info):
    if info.flag_bits & 0x800:
        return info.filename
    try:
        return info.filename.encode('cp437').decode('cp949')
    except (UnicodeError, LookupError):
        return info.filename


def input_files(input_dir):
    archive_path = input_dir / 'archive-manifest.json'
    export_path = input_dir / 'vehicle-export-manifest.json'
    for path in (archive_path, export_path):
        if not path.is_file():
            raise ValueError('Required input manifest missing: ' + path.name)
    archive = json.loads(archive_path.read_text(encoding='utf-8'))
    export = json.loads(export_path.read_text(encoding='utf-8'))
    declared_year = archive.get('claimedYear', export.get('sourceYear'))
    if not isinstance(declared_year, int) or not 1900 <= declared_year <= 2100:
        raise ValueError('Input manifests must explicitly declare a valid sourceYear/claimedYear')
    expected = {Path(x['path']).name: x for x in export['exportFiles']}
    verified = []
    for name in ('vehicle-records.raw.jsonl.gz', 'workbook-rows.raw.jsonl.gz'):
        path = input_dir / name
        item = expected.get(name)
        if not item or not path.is_file():
            raise ValueError('Required raw input missing or unlisted in manifest: ' + name)
        actual = sha256_file(path)
        if actual != item['sha256'] or path.stat().st_size != item['bytes']:
            raise ValueError('Raw input SHA-256/size mismatch: ' + name)
        verified.append({'relativePath': name, 'sha256': actual, 'bytes': path.stat().st_size,
                         'role': 'required_raw_input', 'hashVerified': True})
    declared_archive_name = Path(archive.get('archivePath', 'source-original.zip')).name
    archive_candidates = [input_dir / declared_archive_name, input_dir / 'source-original.zip']
    archive_candidates += sorted(input_dir.glob('*.zip'))
    archive_file = None
    seen = set()
    for candidate in archive_candidates:
        if candidate.name in seen or not candidate.is_file():
            continue
        seen.add(candidate.name)
        actual = sha256_file(candidate)
        if actual == archive['sha256']:
            archive_file = candidate
            break
        if candidate.name in (declared_archive_name, 'source-original.zip'):
            raise ValueError('Original archive SHA-256 mismatch: ' + candidate.name)
    if archive_file is not None:
        verified.append({'relativePath': archive_file.name, 'sha256': archive['sha256'],
                         'bytes': archive_file.stat().st_size, 'role': 'original_user_supplied_archive', 'hashVerified': True})
        with zipfile.ZipFile(archive_file) as z:
            entries = z.infolist()
            if len(entries) > 1000 or sum(i.file_size for i in entries) > 250 * 1024 * 1024 or any(i.file_size > 100 * 1024 * 1024 for i in entries):
                raise ValueError('Original archive exceeds bounded inspection limits')
            if z.testzip() is not None:
                raise ValueError('Original archive CRC check failed')
            declared_member = archive.get('vehicleWorkbook', {}).get('archiveMember')
            suffix = '1. 차량/' + str(declared_year) + ' 차량.xlsx'
            matching = [i for i in entries if (decoded_zip_name(i) == declared_member if declared_member else decoded_zip_name(i).endswith(suffix))]
            if len(matching) != 1:
                raise ValueError('Exactly one vehicle workbook archive member must match the declared source')
            info = matching[0]
            if info.file_size > 30 * 1024 * 1024:
                raise ValueError('Vehicle workbook exceeds bounded in-memory read limit')
            data = z.read(info)
            actual_workbook = hashlib.sha256(data).hexdigest()
            if actual_workbook != export['workbookSha256']:
                raise ValueError('Vehicle workbook archive-member SHA-256 mismatch')
            member = decoded_zip_name(info)
            verified.append({'relativePath': archive_file.name + '!' + member, 'sha256': actual_workbook,
                             'bytes': len(data), 'role': 'original_vehicle_workbook_archive_member', 'hashVerified': True,
                             'containerRelativePath': archive_file.name, 'archiveMember': member})
    workbook_name = Path(export.get('workbookPath', export.get('workbookFilename', '2026-vehicles.xlsx'))).name
    workbook_file = input_dir / workbook_name
    if workbook_file.is_file():
        actual = sha256_file(workbook_file)
        if actual != export['workbookSha256']:
            raise ValueError('Standalone vehicle workbook SHA-256 mismatch')
        verified.append({'relativePath': workbook_file.name, 'sha256': actual, 'bytes': workbook_file.stat().st_size,
                         'role': 'original_vehicle_workbook', 'hashVerified': True})
    for path in (archive_path, export_path):
        verified.append({'relativePath': path.name, 'sha256': sha256_file(path),
                         'bytes': path.stat().st_size, 'role': 'input_manifest', 'hashVerified': False})
    if not export['sheets'] or not isinstance(export.get('vehicleDataRows'), int):
        raise ValueError('Input manifest must declare its actual sheet and vehicle row counts')
    return archive, export, verified


def read_jsonl(path):
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        for line_number, line in enumerate(f, 1):
            if line.strip():
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f'{path.name}:{line_number}: invalid JSON') from exc


def modification_records(input_dir, sheet_map):
    """Read all 15 source modification sheets, retaining blank header column positions."""
    headers, header_rows = {}, {}
    for r in read_jsonl(input_dir / 'workbook-rows.raw.jsonl.gz'):
        sheet = r['sheet']
        if not sheet.startswith('5-'):
            continue
        stat = sheet_map[sheet]
        if sheet not in headers:
            first = next((c for c in r['cells'] if c['column'] == 'A'), None)
            if first and first['valueRaw'] == '연번':
                bycol = {c['column']: c for c in r['cells']}
                # Include all original header columns, even blank or duplicated ones.
                width = max(column_number(c['column']) for c in r['cells'])
                headers[sheet] = [bycol.get(column_name(i), {}).get('valueRaw') for i in range(1, width + 1)]
                header_rows[sheet] = r['row']
            continue
        bycol = {c['column']: c for c in r['cells']}
        serial = bycol.get('A', {}).get('valueRaw')
        if serial is None or not re.fullmatch(r'\d+(?:\.0+)?', str(serial)) or Decimal(serial) < 1:
            continue
        fields, kinds = {}, {}
        for i, header in enumerate(headers[sheet], 1):
            key = str(header) if header is not None else '__column_' + column_name(i)
            if key in fields:
                key += '__column_' + column_name(i)
            cell = bycol.get(column_name(i), {})
            fields[key] = cell.get('valueRaw')
            kinds[key] = cell.get('cellType')
        yield {'sourceSheet': sheet, 'sourceRow': r['row'], 'fieldsRaw': fields,
               'fieldCellTypesRaw': kinds, 'headerRaw': headers[sheet], 'headerRow': header_rows[sheet]}


def column_number(label):
    result = 0
    for char in label:
        result = result * 26 + ord(char) - 64
    return result


def column_name(number):
    result = ''
    while number:
        number, rem = divmod(number - 1, 26)
        result = chr(65 + rem) + result
    return result


SCHEMA_SQL = '''
PRAGMA foreign_keys=ON;
CREATE TABLE metadata(key TEXT PRIMARY KEY, value_json TEXT NOT NULL CHECK(json_valid(value_json)));
CREATE TABLE source_files(file_id INTEGER PRIMARY KEY, relative_path TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL CHECK(length(sha256)=64), bytes INTEGER NOT NULL, role TEXT NOT NULL,
 hash_verified INTEGER NOT NULL CHECK(hash_verified IN (0,1)));
CREATE TABLE sheets(sheet_id INTEGER PRIMARY KEY, sheet_key TEXT NOT NULL UNIQUE,
 sheet_name TEXT NOT NULL UNIQUE, sheet_group TEXT NOT NULL, header_row INTEGER,
 header_raw_json TEXT CHECK(header_raw_json IS NULL OR json_valid(header_raw_json)),
 raw_dimension TEXT, blank_rows_in_declared_range INTEGER NOT NULL,
 workbook_file_id INTEGER REFERENCES source_files(file_id));
CREATE TABLE vehicle_records(
 record_no INTEGER PRIMARY KEY, record_id TEXT NOT NULL UNIQUE CHECK(length(record_id)=64),
 row_hash TEXT NOT NULL CHECK(length(row_hash)=64), sheet_id INTEGER NOT NULL REFERENCES sheets(sheet_id),
 source_row INTEGER NOT NULL CHECK(source_row>0), source_year INTEGER NOT NULL CHECK(source_year BETWEEN 1900 AND 2100),
 model_year INTEGER CHECK(model_year IS NULL), original_serial_raw TEXT,
 origin_raw TEXT, sheet_vehicle_group_raw TEXT, table_kind_raw TEXT,
 declared_vehicle_category_raw TEXT, manufacturer_raw TEXT,
 vehicle_name_raw TEXT, type_model_name_raw TEXT, type_raw TEXT, fuel_raw TEXT,
 sourcePriceRaw TEXT, sourcePriceUnitRaw TEXT NOT NULL, unitSource TEXT NOT NULL,
 sourcePriceThousandsRaw TEXT, sourcePriceWonRaw TEXT, priceCellTypeRaw TEXT, wonExact TEXT,
 wonInteger INTEGER, wonRoundingCandidate TEXT, amountParseStatus TEXT NOT NULL,
 requiresReview INTEGER NOT NULL CHECK(requiresReview IN (0,1)), review_reasons_json TEXT NOT NULL CHECK(json_valid(review_reasons_json)),
 fields_raw_json TEXT NOT NULL CHECK(json_valid(fields_raw_json)),
 field_cell_types_raw_json TEXT NOT NULL CHECK(json_valid(field_cell_types_raw_json)),
 fields_typed_json TEXT NOT NULL CHECK(json_valid(fields_typed_json)),
 has_type_name_conflict INTEGER NOT NULL DEFAULT 0 CHECK(has_type_name_conflict IN (0,1)),
 UNIQUE(sheet_id,source_row));
CREATE TABLE modification_records(
 record_no INTEGER PRIMARY KEY, record_id TEXT NOT NULL UNIQUE CHECK(length(record_id)=64),
 row_hash TEXT NOT NULL CHECK(length(row_hash)=64), sheet_id INTEGER NOT NULL REFERENCES sheets(sheet_id),
 source_row INTEGER NOT NULL CHECK(source_row>0), source_year INTEGER NOT NULL CHECK(source_year BETWEEN 1900 AND 2100),
 original_serial_raw TEXT, modification_kind_raw TEXT,
 sourcePriceRaw TEXT, sourcePriceUnitRaw TEXT NOT NULL, unitSource TEXT NOT NULL,
 sourcePriceThousandsRaw TEXT, sourcePriceWonRaw TEXT, priceCellTypeRaw TEXT, wonExact TEXT,
 wonInteger INTEGER, wonRoundingCandidate TEXT, amountParseStatus TEXT NOT NULL,
 requiresReview INTEGER NOT NULL CHECK(requiresReview IN (0,1)), review_reasons_json TEXT NOT NULL CHECK(json_valid(review_reasons_json)),
 fields_raw_json TEXT NOT NULL CHECK(json_valid(fields_raw_json)),
 field_cell_types_raw_json TEXT NOT NULL CHECK(json_valid(field_cell_types_raw_json)),
 fields_typed_json TEXT NOT NULL CHECK(json_valid(fields_typed_json)),
 search_text_raw TEXT NOT NULL, UNIQUE(sheet_id,source_row));
CREATE TABLE type_name_conflicts(
 conflict_id TEXT PRIMARY KEY CHECK(length(conflict_id)=64), manufacturer_raw TEXT NOT NULL,
 manufacturer_cell_type_raw TEXT, type_raw TEXT NOT NULL, type_cell_type_raw TEXT,
 distinct_name_count INTEGER NOT NULL CHECK(distinct_name_count>1), source_record_count INTEGER NOT NULL,
 names_with_types_raw_json TEXT NOT NULL CHECK(json_valid(names_with_types_raw_json)),
 requiresReview INTEGER NOT NULL DEFAULT 1 CHECK(requiresReview=1));
CREATE TABLE type_name_conflict_members(
 conflict_id TEXT NOT NULL REFERENCES type_name_conflicts(conflict_id),
 vehicle_record_no INTEGER NOT NULL REFERENCES vehicle_records(record_no),
 PRIMARY KEY(conflict_id,vehicle_record_no));
CREATE INDEX vehicle_manufacturer_type ON vehicle_records(manufacturer_raw,type_raw);
CREATE INDEX vehicle_name ON vehicle_records(vehicle_name_raw);
CREATE INDEX vehicle_type_model_name ON vehicle_records(type_model_name_raw);
CREATE INDEX vehicle_fuel ON vehicle_records(fuel_raw);
CREATE INDEX vehicle_sheet_source_row ON vehicle_records(sheet_id,source_row);
CREATE VIRTUAL TABLE vehicle_fts USING fts5(manufacturer_raw,vehicle_name_raw,type_model_name_raw,type_raw,fuel_raw,
 content='vehicle_records',content_rowid='record_no',tokenize='trigram');
CREATE VIRTUAL TABLE modification_fts USING fts5(search_text_raw,
 content='modification_records',content_rowid='record_no',tokenize='trigram');
'''


def insert(connection, table, data):
    keys = list(data)
    connection.execute('INSERT INTO ' + table + '(' + ','.join(keys) + ') VALUES(' +
                       ','.join('?' for _ in keys) + ')', [data[k] for k in keys])


def resolve_unit(raw, sheet, manifest, fallback=None):
    candidates = [(raw.get('amountUnitRaw'), 'record.amountUnitRaw'),
                  (sheet.get('amountUnitRaw'), 'sheet.amountUnitRaw'),
                  (manifest.get('originalAmountUnit'), 'manifest.originalAmountUnit'),
                  (fallback, 'cli.source-price-unit')]
    for value, source in candidates:
        if value is None:
            continue
        if value not in ('천원', '원'):
            raise ValueError('Unknown/unsupported explicit price unit at ' + source + ': ' + repr(value))
        return value, source
    raise ValueError('No explicit source price unit: ' + raw['sourceSheet'])


def common_record(raw, archive_hash, sheet_id, kind, source_year, unit, unit_source):
    fields = raw['fieldsRaw']
    cell_types = raw['fieldCellTypesRaw']
    # Source headers may contain spaces; preserve them and look up price without modifying originals.
    price_key = next((k for k in fields if k.replace(' ', '') == '기준가격'), '기준가격')
    amount = parse_price(fields.get(price_key), cell_types.get(price_key), unit, unit_source)
    record = {'record_id': stable_hash(kind, archive_hash, sourceSheet=raw['sourceSheet'], sourceRow=raw['sourceRow']),
              'row_hash': hashlib.sha256(json_text({'fieldsRaw': fields, 'fieldCellTypesRaw': cell_types}, sort_keys=True).encode()).hexdigest(),
              'sheet_id': sheet_id, 'source_row': raw['sourceRow'], 'source_year': source_year,
              'original_serial_raw': fields.get('연번'),
              **{key: amount[key] for key in ('sourcePriceRaw', 'sourcePriceUnitRaw', 'unitSource', 'sourcePriceThousandsRaw', 'sourcePriceWonRaw', 'priceCellTypeRaw', 'wonExact', 'wonInteger',
                                             'wonRoundingCandidate', 'amountParseStatus', 'requiresReview')},
              'review_reasons_json': json_text(amount['reviewReasons']),
              'fields_raw_json': json_text(fields), 'field_cell_types_raw_json': json_text(cell_types),
              'fields_typed_json': typed_fields_json(fields, cell_types)}
    return record


CSV_FIELDS = ['record_id', 'row_hash', 'source_sheet', 'source_row', 'source_year', 'model_year',
              'origin_raw', 'sheet_vehicle_group_raw', 'table_kind_raw', 'declared_vehicle_category_raw',
              'manufacturer_raw', 'vehicle_name_raw', 'type_model_name_raw', 'type_raw', 'fuel_raw',
              'modification_kind_raw', 'sourcePriceRaw', 'sourcePriceUnitRaw', 'unitSource', 'sourcePriceThousandsRaw', 'sourcePriceWonRaw', 'priceCellTypeRaw', 'wonExact', 'wonInteger',
              'wonRoundingCandidate', 'amountParseStatus', 'requiresReview', 'review_reasons_json',
              'has_type_name_conflict', 'fields_raw_json', 'field_cell_types_raw_json', 'fields_typed_json']


def export_csv(connection, output, table, filename):
    query = connection.execute('SELECT r.*,s.sheet_name AS source_sheet FROM ' + table + ' r JOIN sheets s USING(sheet_id) ORDER BY r.record_no')
    with open(output / filename, 'wb') as f, gzip.GzipFile(filename='', fileobj=f, mode='wb', mtime=0) as g, \
            __import__('io').TextIOWrapper(g, encoding='utf-8', newline='') as text:
        writer = csv.writer(text)
        writer.writerow(CSV_FIELDS)
        for row in query:
            writer.writerow([row[key] if key in row.keys() else None for key in CSV_FIELDS])


def search(connection, query, limit=20):
    terms = [x for x in re.split(r'\s+', query.strip()) if x]
    if not terms:
        return []
    if all(len(term) >= 3 for term in terms):
        match = ' AND '.join('"' + term.replace('"', '""') + '"' for term in terms)
        rows = connection.execute('''SELECT r.record_id,s.sheet_name,r.source_row,r.manufacturer_raw,
          r.vehicle_name_raw,r.type_model_name_raw,r.type_raw,r.fuel_raw
          FROM vehicle_fts f JOIN vehicle_records r ON r.record_no=f.rowid JOIN sheets s USING(sheet_id)
          WHERE vehicle_fts MATCH ? ORDER BY r.record_no LIMIT ?''', (match, limit))
    else:
        # Trigram FTS has no 1/2-character tokens: literal LIKE handles Korean short names safely.
        columns = ['manufacturer_raw', 'vehicle_name_raw', 'type_model_name_raw', 'type_raw', 'fuel_raw']
        clauses, args = [], []
        for term in terms:
            escaped = term.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
            clauses.append('(' + ' OR '.join("r." + c + " LIKE ? ESCAPE '\\'" for c in columns) + ')')
            args.extend(['%' + escaped + '%'] * len(columns))
        rows = connection.execute('''SELECT r.record_id,s.sheet_name,r.source_row,r.manufacturer_raw,
          r.vehicle_name_raw,r.type_model_name_raw,r.type_raw,r.fuel_raw
          FROM vehicle_records r JOIN sheets s USING(sheet_id) WHERE ''' + ' AND '.join(clauses) +
          ' ORDER BY r.record_no LIMIT ?', [*args, limit])
    return [dict(r) for r in rows]


def validate(connection):
    checks = {}
    expected = json.loads(connection.execute("SELECT value_json FROM metadata WHERE key='expectedSourceCounts'").fetchone()[0])
    checks['expectedSourceCounts'] = expected
    checks['vehicleRows'] = connection.execute('SELECT count(*) FROM vehicle_records').fetchone()[0]
    checks['modificationRows'] = connection.execute('SELECT count(*) FROM modification_records').fetchone()[0]
    checks['sheetCount'] = connection.execute('SELECT count(*) FROM sheets').fetchone()[0]
    checks['typeNameConflictGroups'] = connection.execute('SELECT count(*) FROM type_name_conflicts').fetchone()[0]
    checks['typeNameConflictMembers'] = connection.execute('SELECT count(*) FROM type_name_conflict_members').fetchone()[0]
    checks['foreignKeyViolations'] = [list(x) for x in connection.execute('PRAGMA foreign_key_check')]
    checks['integrityCheck'] = [r[0] for r in connection.execute('PRAGMA integrity_check')]
    assert checks['vehicleRows'] == expected['vehicleRows'], checks
    assert checks['modificationRows'] == expected['modificationRows'], checks
    assert checks['sheetCount'] == expected['sheetCount'] and checks['typeNameConflictGroups'] == expected['typeNameConflictGroups'], checks
    assert not checks['foreignKeyViolations'] and checks['integrityCheck'] == ['ok'], checks
    checks['vehicleUnknownFuelRows'] = connection.execute('SELECT count(*) FROM vehicle_records WHERE fuel_raw IS NULL').fetchone()[0]
    checks['vehicleModelYearPopulatedRows'] = connection.execute('SELECT count(*) FROM vehicle_records WHERE model_year IS NOT NULL').fetchone()[0]
    checks['sourceFloatArtifactRows'] = connection.execute("SELECT count(*) FROM vehicle_records WHERE amountParseStatus='source_float_artifact_requires_review'").fetchone()[0]
    checks['floatArtifactsHaveNullCanonicalInteger'] = connection.execute("SELECT count(*) FROM vehicle_records WHERE amountParseStatus='source_float_artifact_requires_review' AND wonInteger IS NOT NULL").fetchone()[0] == 0
    checks['undeterminedModificationPrices'] = connection.execute("SELECT count(*) FROM modification_records WHERE amountParseStatus='undetermined_marker'").fetchone()[0]
    checks['undeterminedPricesAreNullNotZero'] = connection.execute("SELECT count(*) FROM modification_records WHERE amountParseStatus='undetermined_marker' AND (wonInteger IS NOT NULL OR wonExact IS NOT NULL)").fetchone()[0] == 0
    checks['numericSourceVehicleNames'] = connection.execute("SELECT count(*) FROM vehicle_records WHERE json_extract(field_cell_types_raw_json,'$.차명')='n'").fetchone()[0]
    checks['numericSourceTypeCodes'] = connection.execute("SELECT count(*) FROM vehicle_records WHERE json_extract(field_cell_types_raw_json,'$.형식')='n'").fetchone()[0]
    checks['specialCategoryInTruckSheetsPreserved'] = connection.execute("SELECT count(*) FROM vehicle_records WHERE sheet_vehicle_group_raw='화물' AND declared_vehicle_category_raw='특수'").fetchone()[0]
    assert checks['vehicleUnknownFuelRows'] == expected['vehicleUnknownFuelRows'] and checks['vehicleModelYearPopulatedRows'] == 0
    assert checks['sourceFloatArtifactRows'] == expected['sourceFloatArtifactRows'] and checks['floatArtifactsHaveNullCanonicalInteger']
    assert checks['undeterminedModificationPrices'] == expected['undeterminedModificationPrices'] and checks['undeterminedPricesAreNullNotZero']
    assert checks['numericSourceVehicleNames'] == expected['numericSourceVehicleNames']
    assert checks['numericSourceTypeCodes'] == expected['numericSourceTypeCodes']
    assert checks['specialCategoryInTruckSheetsPreserved'] == expected['specialCategoryInTruckSheetsPreserved']
    checks['searchExamples'] = {}
    queries = [r[0] for r in connection.execute("SELECT DISTINCT manufacturer_raw FROM vehicle_records WHERE length(manufacturer_raw)>=3 ORDER BY record_no LIMIT 2")]
    first_type = connection.execute("SELECT type_raw FROM vehicle_records WHERE length(type_raw)>=3 ORDER BY record_no LIMIT 1").fetchone()
    if first_type: queries.append(first_type[0])
    first_short = connection.execute("SELECT manufacturer_raw FROM vehicle_records WHERE length(manufacturer_raw) BETWEEN 1 AND 2 ORDER BY record_no LIMIT 1").fetchone()
    if first_short: queries.append(first_short[0])
    for query in queries:
        results = search(connection, query, 3)
        assert results, 'Search unexpectedly returned no rows: ' + query
        checks['searchExamples'][query] = results
    # Verify external-content FTS indexes actually match their source tables.
    connection.execute("INSERT INTO vehicle_fts(vehicle_fts,rank) VALUES('integrity-check',1)")
    connection.execute("INSERT INTO modification_fts(modification_fts,rank) VALUES('integrity-check',1)")
    checks['ftsExternalContentIntegrityCheck'] = 'ok'
    checks['passed'] = True
    return checks


def build(input_dir, output_dir, overwrite=False, fallback_unit=None, snapshot_notice=None, snapshot_version=None):
    archive, export, verified = input_files(input_dir)
    source_year = archive.get('claimedYear', export.get('sourceYear'))
    source_notice = snapshot_notice or export.get('snapshotNotice') or archive.get('snapshotNotice') or 'not_declared_in_input_manifest'
    source_version = snapshot_version or export.get('snapshotVersion') or archive.get('snapshotVersion') or archive['sha256'][:16]
    upstream_amended = archive.get('snapshotKind') == 'full_replacement_annex'
    builder_hash = sha256_file(Path(__file__))
    output_dir.mkdir(parents=True, exist_ok=True)
    db_path = output_dir / DATABASE_NAME
    if db_path.exists() and not overwrite:
        raise ValueError('Output database already exists; use --overwrite for a deliberate rebuild')
    temporary = output_dir / (DATABASE_NAME + '.building')
    if temporary.exists():
        temporary.unlink()
    connection = sqlite3.connect(temporary)
    connection.row_factory = sqlite3.Row
    try:
        connection.executescript(SCHEMA_SQL)
        archive_hash = archive['sha256']
        source_ids = {}
        for number, item in enumerate(verified, 1):
            insert(connection, 'source_files', {'file_id': number, 'relative_path': item['relativePath'],
                   'sha256': item['sha256'], 'bytes': item['bytes'], 'role': item['role'], 'hash_verified': int(item['hashVerified'])})
            source_ids[item['relativePath']] = number
        sheet_ids, sheet_map = {}, {}
        for number, stat in enumerate(export['sheets'], 1):
            name = stat['name']; sheet_ids[name] = number; sheet_map[name] = stat
            insert(connection, 'sheets', {'sheet_id': number, 'sheet_key': stable_hash('sheet', archive_hash, sourceSheet=name),
                   'sheet_name': name, 'sheet_group': 'vehicle' if stat['vehicleClassificationSheet'] else 'modification',
                   'header_row': stat['headerRow'], 'header_raw_json': json_text(stat['headerRaw']) if stat['headerRaw'] is not None else None,
                   'raw_dimension': stat['dimensionRaw'], 'blank_rows_in_declared_range': stat['blankRowsThroughDeclaredMax'],
                   'workbook_file_id': source_ids.get('2026-vehicles.xlsx')})
        conflicts = collections.defaultdict(lambda: {'names': {}, 'members': [], 'raw': None})
        expected = collections.Counter({'vehicleRows': export['vehicleDataRows'], 'sheetCount': len(export['sheets'])})
        original_workbook_id = next((source_ids[x['relativePath']] for x in verified if x['role'].startswith('original_vehicle_workbook')), None)
        connection.execute('UPDATE sheets SET workbook_file_id=?', (original_workbook_id,))
        for number, raw in enumerate(read_jsonl(input_dir / 'vehicle-records.raw.jsonl.gz'), 1):
            fields, types = raw['fieldsRaw'], raw['fieldCellTypesRaw']; sheet = raw['sourceSheet']
            unit, unit_source = resolve_unit(raw, sheet_map[sheet], export, fallback_unit)
            record = common_record(raw, archive_hash, sheet_ids[sheet], 'vehicle', source_year, unit, unit_source)
            category = next(value for value in ('승용', '승합', '화물', '이륜') if value in sheet)
            record.update({'record_no': number, 'model_year': None, 'origin_raw': '국산' if sheet.startswith('국산') else '외산',
                           'sheet_vehicle_group_raw': category, 'table_kind_raw': '형식' if '형식' in sheet else '기종',
                           'declared_vehicle_category_raw': fields.get('차종'), 'manufacturer_raw': fields.get('제작사'),
                           'vehicle_name_raw': fields.get('차명'), 'type_model_name_raw': fields.get('기종명'),
                           'type_raw': fields.get('형식'), 'fuel_raw': fields.get('연료원'), 'has_type_name_conflict': 0})
            insert(connection, 'vehicle_records', record)
            expected['vehicleUnknownFuelRows'] += fields.get('연료원') is None
            expected['sourceFloatArtifactRows'] += record['amountParseStatus']=='source_float_artifact_requires_review'
            expected['numericSourceVehicleNames'] += types.get('차명')=='n'
            expected['numericSourceTypeCodes'] += types.get('형식')=='n'
            expected['specialCategoryInTruckSheetsPreserved'] += category=='화물' and fields.get('차종')=='특수'
            if record['table_kind_raw'] == '형식' and fields.get('형식') is not None:
                key = (typed_key(fields.get('제작사'), types.get('제작사')), typed_key(fields.get('형식'), types.get('형식')))
                namekey = typed_key(fields.get('차명'), types.get('차명'))
                conflicts[key]['names'][namekey] = {'valueRaw': fields.get('차명'), 'cellTypeRaw': types.get('차명')}
                conflicts[key]['members'].append(number)
                conflicts[key]['raw'] = {'manufacturer_raw': fields.get('제작사'), 'manufacturer_cell_type_raw': types.get('제작사'),
                                         'type_raw': fields.get('형식'), 'type_cell_type_raw': types.get('형식')}
        for number, raw in enumerate(modification_records(input_dir, sheet_map), 1):
            sheet = raw['sourceSheet']
            unit, unit_source = resolve_unit(raw, sheet_map[sheet], export, fallback_unit)
            record = common_record(raw, archive_hash, sheet_ids[sheet], 'modification', source_year, unit, unit_source)
            expected['modificationRows'] += 1
            expected['undeterminedModificationPrices'] += record['amountParseStatus']=='undetermined_marker'
            record.update({'record_no': number, 'modification_kind_raw': sheet,
                           'search_text_raw': ' '.join(str(v) for v in raw['fieldsRaw'].values() if v is not None)})
            insert(connection, 'modification_records', record)
            # Modification header rows were not classified as vehicle headers in the raw export manifest.
            connection.execute('UPDATE sheets SET header_raw_json=?,header_row=COALESCE(header_row,?) WHERE sheet_id=?',
                               (json_text(raw['headerRaw']), raw['headerRow'], sheet_ids[sheet]))
        group_count = 0
        for key, group in conflicts.items():
            if len(group['names']) < 2:
                continue
            group_count += 1
            conflict_id = stable_hash('same-maker-type-multiple-names', archive_hash, typedKey=key)
            names = [group['names'][k] for k in sorted(group['names'], key=repr)]
            insert(connection, 'type_name_conflicts', {'conflict_id': conflict_id, **group['raw'],
                   'distinct_name_count': len(names), 'source_record_count': len(group['members']),
                   'names_with_types_raw_json': json_text(names), 'requiresReview': 1})
            connection.executemany('INSERT INTO type_name_conflict_members VALUES(?,?)', [(conflict_id, n) for n in group['members']])
            connection.executemany('UPDATE vehicle_records SET has_type_name_conflict=1 WHERE record_no=?', [(n,) for n in group['members']])
        expected['typeNameConflictGroups'] = group_count
        metadata = {'schemaVersion': SCHEMA_VERSION, 'sourceYear': source_year, 'sourceYearIsModelYear': False,
                    'snapshotNotice': source_notice, 'snapshotVersion': source_version, 'expectedSourceCounts': dict(expected), 'laterNoticesApplied': upstream_amended, 'all2026NoticesComplete': False,
                    'sourceScope': 'Only exact rows from this user-supplied archive snapshot; no blind union with other snapshots and not a retail taxonomy.',
                    'retailHierarchyVerified': False, 'automaticRuntimeImport': False, 'applicationCalculationUse': False,
                    'pricesAreRetailSellingPrices': False, 'sourcePriceUnit': export.get('originalAmountUnit'), 'derivedWonUnit': '원',
                    'amountPolicy': 'Exact Decimal(raw)*1000 only for explicit 천원; Decimal(raw)*1 for explicit 원; fractional won canonical integer stays null, ROUND_HALF_UP candidate is separate and non-authoritative; undetermined markers stay null.',
                    'requiresReviewScope': 'Amount conversion review only; type/name ambiguities are separately retained in type_name_conflicts and has_type_name_conflict.',
                    'fuelPolicy': 'Missing fuel field remains null; counts are recorded per snapshot; no fuel inferred.',
                    'nameTypePolicy': 'raw lexical fields + OOXML cell types + typed JSON preserved separately from text search fields.',
                    'sameMakerTypePolicy': 'A manufacturer/type code is not unique to one model name; all observed ambiguity groups and source members retained.',
                    'upstreamSnapshotKind': archive.get('snapshotKind'), 'patchesAppliedByBuilder': False,
                    'builderScriptSha256': builder_hash,
                    'stableIdentityPolicy': 'SHA-256 of dataset namespace + original archive SHA-256 + kind + exact source sheet + source row; row_hash separately covers original fields and cell types.',
                    'sourceArchiveSha256': archive_hash, 'sourceWorkbookSha256': export['workbookSha256'],
                    'sourceArchiveHashVerifiedLocally': any(x['role']=='original_user_supplied_archive' for x in verified),
                    'sourceWorkbookHashVerifiedFromArchive': any(x['role']=='original_vehicle_workbook_archive_member' for x in verified),
                    'acquisitionMethod': 'user_supplied_copy_of_public_government_attachment',
                    'remoteBytesCompared': False, 'remoteHashCompared': False,
                    'searchPolicy': 'FTS5 trigram for >=3-character terms, literal escaped LIKE fallback for shorter Korean terms.',
                    'sqliteVersion': sqlite3.sqlite_version}
        connection.executemany('INSERT INTO metadata VALUES(?,?)', [(k, json_text(v)) for k, v in sorted(metadata.items())])
        connection.execute("INSERT INTO vehicle_fts(vehicle_fts) VALUES('rebuild')")
        connection.execute("INSERT INTO modification_fts(modification_fts) VALUES('rebuild')")
        connection.commit()
        checks = validate(connection)
        export_csv(connection, output_dir, 'vehicle_records', 'vehicle-records.organized.csv.gz')
        export_csv(connection, output_dir, 'modification_records', 'modification-records.organized.csv.gz')
        connection.commit()
        connection.execute('VACUUM')
        connection.close()
        temporary.replace(db_path)
        (output_dir / 'schema.sql').write_text(SCHEMA_SQL, encoding='utf-8')
        (output_dir / 'validation-log.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        outputs = [DATABASE_NAME, 'vehicle-records.organized.csv.gz', 'modification-records.organized.csv.gz', 'schema.sql', 'validation-log.json']
        summary = {'schemaVersion': SCHEMA_VERSION, 'sourceYear': source_year, 'sourceYearIsModelYear': False,
                   'inputFiles': verified, 'sourceArchiveSha256': archive_hash, 'sourceWorkbookSha256': export['workbookSha256'],
                    'sourceArchiveHashVerifiedLocally': any(x['role']=='original_user_supplied_archive' for x in verified),
                    'sourceWorkbookHashVerifiedFromArchive': any(x['role']=='original_vehicle_workbook_archive_member' for x in verified),
                   'snapshotNotice': source_notice, 'snapshotVersion': source_version, 'laterNoticesApplied': upstream_amended, 'all2026NoticesComplete': False,
                   'vehicleRows': checks['vehicleRows'], 'modificationRows': checks['modificationRows'],
                   'typeNameConflictGroups': checks['typeNameConflictGroups'], 'validationPassed': checks['passed'],
                   'builderScriptSha256': builder_hash, 'patchesAppliedByBuilder': False,
                   'outputs': [{'relativePath': name, 'bytes': (output_dir / name).stat().st_size,
                                'sha256': sha256_file(output_dir / name)} for name in outputs]}
        (output_dir / 'build-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        return summary
    except Exception:
        connection.close()
        if temporary.exists():
            temporary.unlink()
        raise


def main():
    repo_root = Path(__file__).resolve().parents[1]
    default_input = repo_root / 'research/vehicle-taxonomy/bulk/government-tax-2026/amended'
    work_root = Path('/workspace/work') if Path('/workspace/work').is_dir() else Path(__import__('tempfile').gettempdir())
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--input-dir', type=Path, default=default_input,
                        help='Directory containing raw JSONL.gz and original input manifests; no hardcoded workspace path')
    parser.add_argument('--output-dir', type=Path, default=work_root / 'government-tax-2026')
    parser.add_argument('--overwrite', action='store_true')
    parser.add_argument('--source-price-unit', choices=('천원','원'), help='Fallback only when raw record/sheet/manifest has no explicit unit; never overrides one')
    parser.add_argument('--snapshot-notice', help='Evidence-backed notice identifier for this snapshot')
    parser.add_argument('--snapshot-version', help='Snapshot label, e.g. base-2025-83 or amended-upload; not a model year')
    parser.add_argument('--search', metavar='QUERY', help='Search an existing database without rebuilding')
    parser.add_argument('--database', type=Path)
    parser.add_argument('--validate', action='store_true', help='Validate an existing database (requires a writable research copy for FTS integrity command)')
    args = parser.parse_args()
    if args.search is not None or args.validate:
        db = args.database or args.output_dir / DATABASE_NAME
        connection = sqlite3.connect(db)
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA foreign_keys=ON')
        result = validate(connection) if args.validate else search(connection, args.search)
        connection.close()
    else:
        result = build(args.input_dir.resolve(), args.output_dir.resolve(), args.overwrite, args.source_price_unit, args.snapshot_notice, args.snapshot_version)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
