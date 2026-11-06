"""Verify inert, separately licensed bulk reference archives; never executes source code."""
from pathlib import Path
import csv
import gzip
import hashlib
import io
import json
from decimal import Decimal, InvalidOperation

ROOT = Path(__file__).resolve().parents[1]
BULK = ROOT / 'research/vehicle-taxonomy/bulk/global-vehicle-makes-models'


def canonical(value):
    if value is None or value == '':
        return ''
    if isinstance(value, (float, int)):
        return Decimal(str(value)).normalize()
    try:
        return Decimal(value).normalize()
    except (InvalidOperation, TypeError):
        return value


def verify():
    metadata = json.loads((BULK / 'archive-manifest.json').read_text())
    assert metadata['license'] == 'ODbL-1.0'
    assert metadata['completeForKoreanMarket'] is False
    for item in metadata.get('licenseAndDescriptionFiles', []):
        content=(BULK/item['path']).read_bytes()
        assert len(content)==item['bytes']
        assert hashlib.sha256(content).hexdigest()==item['sha256']
    originals = {}
    for item in metadata['files']:
        compressed = (BULK / item['archive']).read_bytes()
        assert len(compressed) == item['archiveBytes']
        assert hashlib.sha256(compressed).hexdigest() == item['archiveSha256']
        original = gzip.decompress(compressed)
        assert len(original) == item['original']['bytes']
        assert hashlib.sha256(original).hexdigest() == item['original']['sha256']
        originals[item['original']['path']] = original
    groups = json.loads(originals['data/json/all.json'])
    csv_rows = list(csv.DictReader(io.StringIO(originals['data/csv/engines.csv'].decode('utf-8'))))
    models_csv = list(csv.DictReader(io.StringIO(originals['data/csv/makes-models.csv'].decode('utf-8'))))
    counts = dict(groups=len(groups), makes=0, models=0, generations=0, engines=0)
    fields = {'fuel_type': 'fuelType', 'cylinders': 'cylinders', 'displacement_cc': 'displacementCc', 'power_hp': 'powerHp', 'torque_nm': 'torqueNm', 'transmission': 'transmission', 'drivetrain': 'drivetrain', 'zero_to_100_s': 'zeroToHundredKmhS', 'top_speed_kmh': 'topSpeedKmh', 'fuel_economy_combined_l100': 'fuelEconomyCombinedL100', 'length_mm': 'lengthMm', 'width_mm': 'widthMm', 'height_mm': 'heightMm', 'wheelbase_mm': 'wheelbaseMm', 'curb_weight_kg': 'curbWeightKg'}
    for group in groups:
        for make in group['makes']:
            counts['makes'] += 1
            for model in make['models']:
                counts['models'] += 1
                for generation in model['generations']:
                    counts['generations'] += 1
                    for engine in generation['engines']:
                        expected = {'make_group': group['group'], 'make': make['name'], 'model': model['name'], 'generation': generation['name'], 'gen_year_start': generation.get('yearStart'), 'gen_year_end': generation.get('yearEnd'), 'body_type': generation.get('bodyType'), 'engine_label': engine['label']}
                        expected.update({key: engine.get(source) for key, source in fields.items()})
                        actual = csv_rows[counts['engines']]
                        for field, value in expected.items():
                            assert canonical(actual[field]) == canonical(value), (counts['engines'], field, actual[field], value)
                        counts['engines'] += 1
    assert counts == metadata['counts'], (counts, metadata['counts'])
    assert len(csv_rows) == counts['engines']
    assert len(models_csv) == counts['models']
    result = {'ok': True, 'counts': counts, 'originalBytesPreserved': True, 'csvJsonEngineParity': True, 'koreanMarketClassificationVerified': False}
    print(json.dumps(result))
    return result


if __name__ == '__main__':
    verify()
