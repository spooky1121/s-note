#!/usr/bin/env python3
"""Package local research exports with checksums; no production or network access.

Run the Node research build, database exporter and workbook exporter first.
Government artifacts are built separately from their archived source snapshots.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'research/vehicle-taxonomy'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for part in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(part)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database-dir', type=Path, required=True)
    parser.add_argument('--workbook', type=Path, required=True)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--complete-artifact-dir', type=Path, help='Complete government gzip files for the download bundle; repository stores ordered parts')
    args = parser.parse_args()
    artifacts = DATA / 'artifacts'
    artifacts.mkdir(parents=True, exist_ok=True)
    for name in ('s-note-classification-research.sqlite', 'global-engine-reference-ODbL.sqlite'):
        source = args.database_dir / name
        with source.open('rb') as incoming, (artifacts / (name + '.gz')).open('wb') as output:
            with gzip.GzipFile(filename='', fileobj=output, mode='wb', mtime=0) as compressed:
                shutil.copyfileobj(incoming, compressed)
    shutil.copyfile(args.workbook, artifacts / args.workbook.name)
    entries = []
    paths = [path for path in sorted(artifacts.iterdir()) if path.suffix in ('.gz','.xlsx')]
    storage_path = artifacts/'storage-manifest.json'
    storage = json.loads(storage_path.read_text()) if storage_path.exists() else {'files':[]}
    split_files = {}
    for entry in storage['files']:
        if args.complete_artifact_dir is None:
            parser.error('--complete-artifact-dir is required when repository parts are present')
        path = args.complete_artifact_dir/entry['name']
        if path.stat().st_size != entry['bytes'] or digest(path) != entry['sha256']:
            raise ValueError('Complete artifact differs from repository parts: '+entry['name'])
        paths.append(path)
        split_files[entry['name']]=entry
    for path in sorted(paths):
        if path.suffix not in ('.gz', '.xlsx'):
            continue
        logical_path=artifacts/path.name
        entry = {'path': str(logical_path.relative_to(ROOT)), 'bytes': path.stat().st_size, 'sha256': digest(path)}
        if path.name in split_files:
            entry['repositoryStorage']={'manifest':str(storage_path.relative_to(ROOT)), 'parts':split_files[path.name]['parts']}
            entry['downloadBundleStorage']='complete_file'
        if path.name.endswith('.sqlite.gz'):
            h = hashlib.sha256()
            size = 0
            with gzip.open(path, 'rb') as incoming:
                for part in iter(lambda: incoming.read(1024 * 1024), b''):
                    h.update(part)
                    size += len(part)
            entry.update(uncompressedBytes=size, uncompressedSha256=h.hexdigest())
        if path.name.startswith('global-'):
            entry['license'] = 'ODbL-1.0; global reference, Korean-market retail classifications unverified'
        elif path.name.startswith('government-'):
            entry['sourceScope'] = '2026-37 amended government tax-reference snapshot; not retail prices or grade master'
            entry['rightsNote'] = 'Attributed government public-notice factual material; no blanket KOGL license asserted for the user-supplied ZIP'
        else:
            entry['licenseNote'] = 'Retain individual source attribution; global engine worksheet is a separate ODbL-1.0 reference'
        entries.append(entry)
    manifest = {'schemaVersion': 1, 'asOf': '2026-11-07', 'completeKoreanMaster': False,
                'runtimeImportEnabled': False, 'artifacts': entries}
    (artifacts / 'artifact-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    args.bundle.parent.mkdir(parents=True, exist_ok=True)
    scripts = [path for path in (ROOT / 'scripts').iterdir()
               if any(word in path.name for word in ('vehicle-taxonomy', 'vehicle-research', 'vehicle-gap', 'vehicle-brand', 'government', 'bulk-vehicle', 'archive-taxonomy-probe'))
               and path.is_file()]
    with zipfile.ZipFile(args.bundle, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for path in sorted(DATA.rglob('*')) + sorted(scripts) + [ROOT/'tests/vehicle-taxonomy-research.test.mjs']:
            if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.part':
                bundle.write(path, str(path.relative_to(ROOT)))
        for name in split_files:
            bundle.write(args.complete_artifact_dir/name, str((artifacts/name).relative_to(ROOT)))
        bundle.writestr('BUNDLE_CONTENTS.json',json.dumps({'largeArtifacts':'Complete gzip files included; redundant repository byte-part files omitted.', 'allOriginalGovernmentZipsIncluded':True},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'bundle': str(args.bundle), 'bytes': args.bundle.stat().st_size,
                      'sha256': digest(args.bundle), 'artifacts': len(entries)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
