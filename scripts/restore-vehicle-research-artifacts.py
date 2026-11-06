#!/usr/bin/env python3
"""Split or restore large research artifacts with byte-exact SHA-256 verification.

Repository parts stay below the connector's per-request limit. Download bundles
contain complete .gz files. No network or application database access is used.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / 'research/vehicle-taxonomy/artifacts'
NAMES = ('government-tax-2026-amended.sqlite.gz', 'government-tax-2026-amended.vehicles.csv.gz')
CHUNK_SIZE = 8 * 1024 * 1024


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as incoming:
        for block in iter(lambda: incoming.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def gzip_payload(path):
    size, h = 0, hashlib.sha256()
    with gzip.open(path, 'rb') as incoming:
        for block in iter(lambda: incoming.read(1024 * 1024), b''):
            size += len(block)
            h.update(block)
    return {'uncompressedBytes': size, 'uncompressedSha256': h.hexdigest()}


def split(source_dir, artifacts):
    files = []
    for name in NAMES:
        source = source_dir / name
        folder = artifacts / (name + '.parts')
        folder.mkdir(parents=True, exist_ok=True)
        entry = {'name': name, 'bytes': source.stat().st_size, 'sha256': digest(source),
                 **gzip_payload(source), 'parts': []}
        with source.open('rb') as incoming:
            number = 0
            while block := incoming.read(CHUNK_SIZE):
                number += 1
                target = folder / f'{number:03d}.part'
                target.write_bytes(block)
                entry['parts'].append({'path': str(target.relative_to(artifacts)), 'bytes': len(block),
                                       'sha256': hashlib.sha256(block).hexdigest()})
        files.append(entry)
    manifest = {'schemaVersion': 1, 'storage': 'ordered_byte_parts', 'partSizeLimit': CHUNK_SIZE,
                'format': 'Concatenate listed parts in order; original gzip bytes are unchanged.',
                'downloadBundleContainsCompleteFiles': True, 'files': files}
    (artifacts / 'storage-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    return manifest


def restore(artifacts, output, overwrite=False):
    manifest = json.loads((artifacts / 'storage-manifest.json').read_text())
    output.mkdir(parents=True, exist_ok=True)
    results = []
    for entry in manifest['files']:
        name = entry['name']
        if name not in NAMES or Path(name).name != name:
            raise ValueError('Unexpected artifact filename')
        destination = output / name
        if destination.exists() and not overwrite:
            raise FileExistsError('Choose an empty output directory or pass --overwrite: ' + str(destination))
        temporary = destination.with_name(destination.name + '.partial')
        if temporary.exists():
            raise FileExistsError('Existing partial output must be inspected before retry: ' + str(temporary))
        try:
            with temporary.open('xb') as handle:
                complete = artifacts / name
                if complete.is_file():
                    with complete.open('rb') as incoming:
                        shutil.copyfileobj(incoming, handle)
                else:
                    for part in entry['parts']:
                        source = (artifacts / part['path']).resolve()
                        if not source.is_relative_to(artifacts.resolve()):
                            raise ValueError('Part path escapes the artifact directory')
                        if source.stat().st_size != part['bytes'] or digest(source) != part['sha256']:
                            raise ValueError('Part checksum or size mismatch: ' + part['path'])
                        with source.open('rb') as incoming:
                            shutil.copyfileobj(incoming, handle)
            if temporary.stat().st_size != entry['bytes'] or digest(temporary) != entry['sha256']:
                raise ValueError('Reassembled artifact checksum or size mismatch: ' + name)
            if gzip_payload(temporary) != {key: entry[key] for key in ('uncompressedBytes','uncompressedSha256')}:
                raise ValueError('Gzip payload mismatch: ' + name)
            temporary.replace(destination)
            results.append({'path': str(destination), 'sha256': entry['sha256'], 'verified': True})
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact-dir', type=Path, default=ARTIFACTS)
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--split-from', type=Path, help='Maintainer: generate repository parts from the original complete gzip files')
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args()
    if args.split_from:
        result = split(args.split_from, args.artifact_dir)
        print(json.dumps({'splitFiles': len(result['files']), 'bytes': sum(e['bytes'] for e in result['files'])}))
    else:
        if args.output_dir is None:
            parser.error('--output-dir is required to restore files')
        print(json.dumps(restore(args.artifact_dir, args.output_dir, args.overwrite), ensure_ascii=False))


if __name__ == '__main__':
    main()
