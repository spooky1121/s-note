import collections
import hashlib
import html
import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE = Path(__file__).resolve().parent.parent
OUT = BASE / 'independent-audit'
targets = json.loads((BASE / 'targets.json').read_text())
frames = json.loads((BASE / 'frame-table-facts.json').read_text())['frames']
parents = json.loads((BASE / 'parent-audits-verified.json').read_text())
frame_map = {(f['parentSourceId'], f['type']): f for f in frames}
parent_map = {p['sourceId']: p for p in parents}


def norm(s):
    return re.sub(r'\s+', ' ', html.unescape(s)).strip()


def dump(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def url_keys(url):
    p = urlparse(url)
    return (p.scheme, p.netloc, p.path, parse_qs(p.query))


def cells(line):
    # Keep all empty and NBSP cells: removing them before recording offsets
    # would make rowspan-collapsed Markdown look like a rectangular HTML table.
    return [{'cellOrdinal': i + 1, 'raw': c, 'normalized': norm(c)}
            for i, c in enumerate(line['text'].split('|'))]


def compose(parent, child):
    a, b = norm(parent).split(), norm(child).split()
    for overlap in range(min(len(a), len(b)), -1, -1):
        if overlap == 0 or a[-overlap:] == b[:overlap]:
            return ' '.join(a + b[overlap:])


raw_trim_corrections = {
    ('hist-encar-a6-c7-grades', 5): 'LED 헤드램프 패키지',
    ('hist-encar-a6-c7-grades', 7): '다이나믹 LED 헤드램프 패키지',
    ('hist-encar-a6-c7-grades', 11): 'LED 헤드램프 패키지',
    ('hist-encar-a6-c7-grades', 13): '다이나믹 LED 헤드램프 패키지',
    ('hist-encar-c-w204-grades', 15): 'C250 AMG 패키지',
    ('hist-encar-c-w204-grades', 17): 'C63 AMG 에디션 507',
    ('hist-encar-e-w212-grades', 25): 'E63 AMG 4MATIC',
    ('hist-encar-g-4-grades', 1): '스마트',
    ('hist-encar-g-4-grades', 2): '프리미엄',
    ('hist-encar-g-4-grades', 3): '럭셔리',
    ('hist-encar-g-4-grades', 5): '프리미엄',
    ('hist-encar-g-4-grades', 6): '스포츠',
    ('hist-encar-g-4-grades', 7): '프리미엄',
    ('hist-encar-g-4-grades', 8): '스포츠',
}
raw_parent_reviews = {
    ('hist-encar-a6-c7-grades', 5): (4, '3.0 TFSI 콰트로'),
    ('hist-encar-a6-c7-grades', 7): (6, '3.0 TFSI 콰트로 다이나믹'),
    ('hist-encar-a6-c7-grades', 11): (10, '3.0 TDI 콰트로'),
    ('hist-encar-a6-c7-grades', 13): (12, '3.0 TDI 콰트로 다이나믹'),
}
raw_role_corrections = {
    ('hist-encar-a7-4g-grades', 7): '4.0 TFSI 콰트로',
    ('hist-encar-a7-4g-grades', 8): '4.0 TFSI 콰트로',
    ('hist-encar-q50-2014-grades', 3): '하이브리드',
}
excluded_lines = {
    # The parent audit confirmed that these two exclusions were documented in
    # the existing source accessNotes because this W205 table mixes W204 rows.
    ('hist-encar-c-w205-grades', 7): 'known_excluded_mixed_generation',
    ('hist-encar-c-w205-grades', 9): 'known_excluded_mixed_generation',
}
duplicate_lines = {
    ('hist-encar-3-6gen-grades', 17): 16,
    ('hist-encar-q5-8r-grades', 4): 3,
}
new_missing_lines = {
    ('hist-encar-5-6gen-grades', 23),
    ('hist-encar-5-6gen-grades', 24),
    ('hist-encar-5-6gen-grades', 25),
}

ledger, table_rows, source_summaries, findings, corrections = [], [], [], [], []
literal_counts = {k: collections.Counter() for k in ['rawParentLabel', 'rawTrimLabel', 'grade']}
for target in targets:
    sid = target['sourceId']
    frame = frame_map[(sid, 'CLS')]
    parent = parent_map[sid]
    usable = (frame.get('sourceMatched') is True
              and frame.get('parentSourceURLVerified') is True
              and url_keys(frame['url']) == url_keys(target['clsUrl'])
              and url_keys(frame['expectedUrl']) == url_keys(target['clsUrl'])
              and url_keys(parent['url']) == url_keys(target['historyUrl'])
              and frame.get('status') == 'read_verified_url')
    data_rows = [line for line in frame['lines']
                 if norm(line['text']) and not norm(line['text']).startswith('등급')]
    usable = usable and bool(data_rows)
    all_cells = []
    for line in data_rows:
        for c in cells(line):
            if c['normalized']:
                all_cells.append({**c, 'sourceLine': line['sourceLine'], 'lineText': line['text']})
    kept_rows = [line for line in data_rows
                 if (sid, line['sourceLine']) not in duplicate_lines
                 and (sid, line['sourceLine']) not in excluded_lines
                 and (sid, line['sourceLine']) not in new_missing_lines]
    assert len(kept_rows) == len(target['records']), (sid, len(kept_rows), len(target['records']))
    line_record = {}
    for ordinal, (record, line) in enumerate(zip(target['records'], kept_rows), 1):
        key = f'{sid}:{ordinal}'
        line_record[line['sourceLine']] = key
        pair = (sid, ordinal)
        cs = cells(line)
        nonempty = [c for c in cs if c['normalized']]
        field_checks = {}
        for field in ['rawParentLabel', 'rawTrimLabel', 'grade']:
            matches = [c for c in all_cells if c['normalized'] == norm(record[field])]
            field_checks[field] = {
                'actual': record[field],
                'status': 'observed_literal_cell' if matches and usable else
                          'not_a_literal_cell' if usable else 'source_not_verified',
                'literalEvidence': matches,
            }
            literal_counts[field][field_checks[field]['status']] += 1
        parent_for_join = record['rawParentLabel']
        child_for_join = raw_trim_corrections.get(pair, record['rawTrimLabel'])
        if pair in raw_parent_reviews:
            parent_for_join = raw_parent_reviews[pair][1]
        if sid == 'hist-encar-e-w212-grades':
            parent_for_join = parent_for_join.replace('E22 0', 'E220').replace('E25 0', 'E250')
            if parent_for_join == 'E350 (4MATIC)':
                parent_for_join = 'E350'
        computed_grade = compose(parent_for_join, child_for_join)
        grade_evidence = {
            'status': 'observed_literal_cell' if field_checks['grade']['literalEvidence'] else
                      'supported_parent_child_composition',
            'sourceLine': line['sourceLine'], 'sourceText': line['text'],
            'parent': parent_for_join, 'child': child_for_join,
            'computed': computed_grade,
        }
        if sid == 'hist-encar-g-4-grades' and ordinal in [4, 9]:
            alias = nonempty[-1]['normalized']
            computed_grade = f'{parent_for_join} 레이싱 에디션 ({alias})'
            grade_evidence.update({'computed': computed_grade, 'alias': alias,
                                   'compositionRule': 'parent + row label + year-cell alias'})
        # Literal grades can be a child/parent cell, so the composition need not
        # equal a globally literal grade. Every nonliteral one is independently
        # constrained by its same-row child and its known parent context here.
        if not field_checks['grade']['literalEvidence']:
            assert norm(computed_grade) == norm(record['grade']), (key, computed_grade, record['grade'])
        item = {
            'recordKey': key, 'sourceId': sid, 'sourceOrdinal': ordinal,
            'make': target['make'], 'model': target['model'],
            'sourceUrl': record['sourceUrl'], 'sourceURLVerified': usable,
            'frameRef': frame['ref'], 'sourceLine': line['sourceLine'],
            'sourceText': line['text'], 'cellsIncludingEmpty': cs,
            'fields': field_checks, 'gradeEvidence': grade_evidence,
            'sourceRecordFieldsAgree': record.get('sourceRecord', {}).get('trimLabel') == record['rawTrimLabel']
                and record.get('sourceRecord', {}).get('parentLabel') == record['rawParentLabel'],
            'parentRoleStatus': 'literal_presence_checked_not_HTML_rowspan_verified',
        }
        ledger.append(item)
        if pair in raw_trim_corrections or pair in raw_role_corrections:
            expected = raw_trim_corrections.get(pair, raw_role_corrections.get(pair))
            kind = 'raw_trim_not_literal' if pair in raw_trim_corrections else 'parent_cell_used_as_trim'
            correction = {
                'recordKey': key, 'sourceId': sid, 'sourceOrdinal': ordinal,
                'field': 'rawTrimLabel', 'actual': record['rawTrimLabel'], 'expected': expected,
                'sourceLine': line['sourceLine'], 'sourceText': line['text'],
                'sourceUrl': frame['url'], 'frameRef': frame['ref'],
                'kind': kind, 'gradeChangeRecommended': False,
                'selector': {k: record[k] for k in ['make', 'group', 'model', 'grade', 'subgrade', 'sourceId', 'sourceUrl', 'rawParentLabel', 'rawTrimLabel']},
                'originalSourceRecord': record.get('sourceRecord'),
                'preserveOriginalSourceRecord': True,
                'reason': 'Use the exact observed trim/year-cell label; the full composed grade remains supported.',
            }
            assert any(c['normalized'] == norm(expected) for c in cs), correction
            corrections.append(correction)
            findings.append(correction)
        if pair in raw_parent_reviews:
            pline, expected = raw_parent_reviews[pair]
            source_parent_line = next(l for l in data_rows if l['sourceLine'] == pline)
            assert expected in [c['normalized'] for c in cells(source_parent_line)]
            findings.append({
                'recordKey': key, 'sourceId': sid, 'sourceOrdinal': ordinal,
                'field': 'rawParentLabel', 'kind': 'parent_role_review',
                'status': 'needs_dom_rowspan_confirmation',
                'actual': record['rawParentLabel'], 'expectedCandidate': expected,
                'sourceLine': line['sourceLine'], 'sourceText': line['text'],
                'parentSourceLine': pline, 'parentSourceText': source_parent_line['text'],
                'sourceUrl': frame['url'], 'frameRef': frame['ref'],
                'reason': 'Stored value is not a source cell. Candidate is the preceding explicit label; exact HTML rowspan ownership is not preserved by these Markdown facts.',
            })
    for line in data_rows:
        skey = (sid, line['sourceLine'])
        row = {
            'sourceId': sid, 'sourceLine': line['sourceLine'], 'sourceText': line['text'],
            'sourceUrl': frame['url'], 'frameRef': frame['ref'],
            'cellsIncludingEmpty': cells(line),
        }
        if line['sourceLine'] in line_record:
            row.update({'coverageStatus': 'represented', 'recordKey': line_record[line['sourceLine']]})
        elif skey in duplicate_lines:
            row.update({'coverageStatus': 'repeat_same_trim_label',
                        'recordKey': line_record[duplicate_lines[skey]],
                        'sameAsSourceLine': duplicate_lines[skey]})
        elif skey in excluded_lines:
            row.update({'coverageStatus': excluded_lines[skey],
                        'exclusionEvidence': 'Parent audit reports existing source accessNotes explicitly exclude these mixed-generation rows.'})
        elif skey in new_missing_lines:
            row.update({'coverageStatus': 'new_missing_trim',
                        'expected': [c['normalized'] for c in cells(line) if c['normalized']][-1],
                        'actual': None})
        else:
            raise AssertionError(row)
        table_rows.append(row)
        if row['coverageStatus'] in ['new_missing_trim', 'known_excluded_mixed_generation']:
            findings.append(row)
    source_summaries.append({
        'sourceId': sid, 'storedRecords': len(target['records']),
        'sourceVerified': usable, 'sourceRowsObserved': len(data_rows),
        'representedRows': len(kept_rows),
        'repeatRows': sum(1 for k in duplicate_lines if k[0] == sid),
        'newMissingRows': sum(1 for k in new_missing_lines if k[0] == sid),
        'knownExcludedRows': sum(1 for k in excluded_lines if k[0] == sid),
    })

assert len(ledger) == 387
assert len(set(r['recordKey'] for r in ledger)) == 387
assert len(table_rows) == 394
assert len(corrections) == 17
assert all(s['sourceVerified'] for s in source_summaries)
summary = {
    'scope': 'Offline independent audit of supplied source-URL-verified factual CLS cells. Original 387 records retained in stable sourceId + one-based source ordinal order.',
    'sources': len(targets), 'recordsAudited': len(ledger),
    'verifiedNonemptyCLSSources': sum(s['sourceVerified'] for s in source_summaries),
    'observedCLSDataRows': len(table_rows),
    'representedUniqueRecordRows': 387, 'repeatSameTrimLabelRows': 2,
    'newMissingTrimRows': 3, 'knownExcludedMixedGenerationRows': 2,
    'fieldLiteralCounts': {k: dict(v) for k, v in literal_counts.items()},
    'gradesLiteral': 307, 'gradesSupportedByContextualComposition': 80,
    'rawTrimNonliteralCorrections': 14, 'rawTrimParentVersusChildRoleCorrections': 3,
    'rawParentNonliteralReviewCandidates': 4,
    'limitations': [
        'Whitespace and NBSP are normalized for matching; spelling, case, punctuation and lexical labels are preserved.',
        'Literal presence does not by itself prove a parent/child role or an ENG-to-CLS join.',
        'Markdown collapses rowspan cells. The four A6 rawParent candidates require HTML parent-role confirmation.',
        'Provider historical present-tense labels are not interpreted as the 2026 vehicle market.',
        'The two W205 exclusions are identified from the parent auditor\'s documented accessNotes review, not from these three supplied JSON extracts alone.',
    ],
    'sourceSpellingsPreserved': [
        {'sourceId': 'hist-encar-a4-b8-grades', 'sourceLine': 10, 'label': '2.0 TDI Quatrro 프레스티지'},
        {'sourceId': 'hist-encar-7-f01-f02-grades', 'sourceLine': 9, 'label': '740 xDrive'},
        {'sourceId': 'hist-encar-e-w212-grades', 'sourceLine': 6, 'label': 'E22 0'},
        {'sourceId': 'hist-encar-e-w212-grades', 'sourceLine': 9, 'label': 'E25 0'},
    ],
    'inputSha256': {name: hashlib.sha256((BASE / name).read_bytes()).hexdigest()
                    for name in ['targets.json', 'frame-table-facts.json', 'parent-audits-verified.json']},
}
dump('record-ledger.json', ledger)
dump('cls-table-rows.json', table_rows)
dump('source-summary.json', source_summaries)
dump('findings.json', findings)
dump('corrections-proposed.json', corrections)
dump('summary.json', summary)
(OUT / 'summary.md').write_text('''독립 CLS 대조 결과: 38개 URL 검증·비어있지 않은 표, 기존 387행 전부 추적 완료.

관측 표 394행은 기존 387행 + 같은 트림 라벨 반복 2행 + 신규 누락 3행 + 이미 제외된 세대 혼합 2행이다.
신규 누락은 BMW 5시리즈 6세대의 550i xDrive(line23), Active Hybrid 5(line24), M5(line25)다.
C W205의 C220 CDI 쿠페(line7), C63 AMG(line9)는 부모 감사자가 기존 accessNotes에서 확인한 known exclusion으로 구분했다.

원문 셀 그대로 존재: rawParentLabel 383/387, rawTrimLabel 373/387, grade 307/387.
나머지 grade 80개는 같은 행 child와 부모 맥락을 조합한 이름으로 지지된다. grade 문구 변경은 제안하지 않는다.
rawTrimLabel 14개는 원문 셀과 다르게 합성·축약되어 정확 원문 셀 교정을 제안했다.
별도로 A7 S7/RS7 및 Q50S 3개는 parent 셀을 trim으로 쓴 역할 차이가 명확해 child 셀 교정을 제안했다.
A6 rawParentLabel 4개는 비literal이다. 직전 명시 라벨 후보는 기록했으나 Markdown의 rowspan 소실 때문에 부모 역할은 검토로 둔다.

소스 자체 철자 Quatrro / 740 xDrive / E22 0 / E25 0는 원문 관측값으로 보존했다.
이 검토는 원문 과거 표의 현재 표기를 2026년 판매 현황으로 해석하지 않는다.
원장 record key는 sourceId + 1부터 시작하는 source ordinal이며 모든 원문 행·빈 셀·NBSP와 sourceLine을 추적한다.
''')
print(json.dumps(summary, ensure_ascii=False, indent=2))
