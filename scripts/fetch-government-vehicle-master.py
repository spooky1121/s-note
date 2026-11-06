#!/usr/bin/env python3
"""Fetch a publicly offered government ZIP; preserve bytes and inspect, without importing.

Uses the environment's existing HTTPS proxy/CA configuration. No auth keys,
proxy changes, user-agent impersonation, or access-control workarounds.
"""
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

DEST = Path(__file__).resolve().parents[1] / 'research/vehicle-taxonomy/bulk/government-tax-2026'
SOURCES = {
    'mois-2026-tax-reference': {
        'url': 'https://www.mois.go.kr/cmm/fms/FileDown.do?atchFileId=FILE_00141702OA0BHAR&fileSn=1',
        'page': 'https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000016&nttId=122833',
        'publisher': '행정안전부',
        'title': '[별표] 2026년 지방세 시가표준액 산정을 위한 기준가격',
    },
    'bupyeong-2026-tax-reference': {
        'url': 'https://www.icbp.go.kr/main/bbs/bbsMsgFileDown.do?bcd=standard&fileno=1&msg_seq=5',
        'page': 'https://www.icbp.go.kr/main/bbs/bbsMsgDetail.do?bcd=standard&msg_seq=5&pgno=1',
        'publisher': '인천광역시 부평구',
        'title': '2026년 기타물건 기준가격 목록',
        'licenseObserved': '공공누리 출처표시',
    },
}

def fetch(source_id):
    item = SOURCES[source_id]
    target = DEST / (source_id + '.zip')
    req = urllib.request.Request(item['url'])
    with urllib.request.urlopen(req, timeout=45) as response:
        raw = response.read(16 * 1024 * 1024 + 1)
        if len(raw) > 16 * 1024 * 1024:
            raise RuntimeError('Public ZIP exceeds the 16 MiB bound')
        if not raw.startswith(b'PK'):
            raise RuntimeError('Expected a ZIP file; HTML/error response was not saved as data')
        headers = {'content-type': response.headers.get('Content-Type'),
                   'content-disposition': response.headers.get('Content-Disposition')}
    DEST.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
    with zipfile.ZipFile(target) as archive:
        entries = []
        total_size = 0
        for item_info in archive.infolist():
            if item_info.is_dir():
                continue
            total_size += item_info.file_size
            if item_info.file_size > 100 * 1024 * 1024 or total_size > 250 * 1024 * 1024:
                raise RuntimeError('Uncompressed archive exceeds the inspection bounds')
            name = item_info.filename
            if not (item_info.flag_bits & 0x800):
                try:
                    name = name.encode('cp437').decode('cp949')
                except (UnicodeError, LookupError):
                    pass
            entries.append({'archiveName': item_info.filename, 'displayName': name,
                            'compressedBytes': item_info.compress_size,
                            'uncompressedBytes': item_info.file_size, 'crc32': f'{item_info.CRC:08x}'})
    metadata = {**item, 'sourceId': source_id, 'retrievedOn': '2026-11-06',
                'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                'headers': headers, 'archiveEntryCount': len(entries), 'entries': entries,
                'classificationStatus': 'tax_reference_not_retail_grade_master',
                'automaticRuntimeImport': False}
    (DEST / (source_id + '.manifest.json')).write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'sourceId': source_id, 'bytes': len(raw), 'sha256': metadata['sha256'],
                      'archiveEntryCount': len(entries), 'entries': entries}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('source', choices=list(SOURCES))
    args = parser.parse_args()
    fetch(args.source)
