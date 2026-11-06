"""Build searchable local research databases; never connects to production.

Global engine facts remain in a separately attributed ODbL database. No source
observation is promoted to a verified Korean retail classification.
"""
from pathlib import Path
import csv
import gzip
import hashlib
import io
import json
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'research/vehicle-taxonomy'


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def database(path):
    temp = path.with_suffix(path.suffix + '.tmp')
    if temp.exists():
        temp.unlink()
    db = sqlite3.connect(temp)
    db.execute('pragma foreign_keys=on')
    db.execute('create table metadata(key text primary key, value text not null)')
    return db, temp


def finish(db, temp, destination, expected_counts):
    db.commit()
    assert db.execute('pragma integrity_check').fetchone()[0] == 'ok'
    assert not db.execute('pragma foreign_key_check').fetchall()
    for table, count in expected_counts.items():
        assert db.execute('select count(*) from ' + table).fetchone()[0] == count
    db.close()
    temp.replace(destination)
    return {'path': str(destination), 'bytes': destination.stat().st_size, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'tables': expected_counts}


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/workspace/work/vehicle-research-databases')
    out.mkdir(parents=True, exist_ok=True)
    data = json.loads((DATA / 'exports/catalog-reference.json').read_text())
    official = data['officialResearch']
    curated = out / 's-note-classification-research.sqlite'
    db, temp = database(curated)
    db.executemany('insert into metadata values (?,?)', [('as_of', data['asOf']), ('scope', data['scope']), ('complete_official_master', 'false'), ('runtime_import_enabled', 'false'), ('global_reference_is_separate', 'true'), ('government_reference_is_separate', 'true')])
    db.execute('create table external_reference_components(position integer primary key,payload_json text not null)')
    db.executemany('insert into external_reference_components values (?,?)', [(i,dump(row)) for i,row in enumerate(data.get('bulkReferences',[]),1)])
    db.execute('create table sources(id text primary key, url text not null, publisher text, evidence_type text, payload_json text not null)')
    db.executemany('insert into sources values (?,?,?,?,?)', [(s['id'], s['url'], s.get('publisher'), s.get('evidenceType'), dump(s)) for s in official['sources']])
    db.execute('create table records(id text primary key, make text not null, model_group text not null, model text not null, grade text, subgrade text, model_year text, fuel text, engine text, drivetrain text, transmission text, market text, source_market text, evidence_status text not null, mapping_status text not null, source_id text not null references sources(id), payload_json text not null)')
    db.executemany('insert into records values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [(r['researchId'], r['make'], r['group'], r['model'], r['grade'], r['subgrade'], r['modelYear'], r['fuel'], r['engine'], r['drivetrain'], r['transmission'], r['market'], r['sourceMarket'], r['evidenceStatus'], r['mappingStatus'], r['sourceId'], dump(r)) for r in official['records']])
    db.execute('create index records_classification on records(make,model_group,model,grade,subgrade)')
    db.execute('create index records_evidence on records(market,evidence_status,source_id)')
    db.execute('create virtual table record_search using fts5(id unindexed,make,model_group,model,grade,engine)')
    db.executemany('insert into record_search values (?,?,?,?,?,?)', [(r['researchId'],r['make'],r['group'],r['model'],r['grade'],r['engine']) for r in official['records']])
    db.execute('create table baseline(position integer primary key,payload_json text not null)')
    db.executemany('insert into baseline values (?,?)', [(i,dump(row)) for i,row in enumerate(data['baseline']['records'],1)])
    for table, rows in [('api_observations',data['listingObservations']),('government_certifications',data['certificationObservations']),('reference_documents',data['referenceDocuments'])]:
        db.execute('create table '+table+'(position integer primary key,payload_json text not null)')
        db.executemany('insert into '+table+' values (?,?)', [(i,dump(row)) for i,row in enumerate(rows,1)])
    contexts=official.get('sourceFileContexts',[])
    db.execute('create table source_contexts(source_file text primary key,payload_json text not null)')
    db.executemany('insert into source_contexts values (?,?)',[(row['sourceFile'],dump(row['metadata'])) for row in contexts])
    db.execute('create table provider_model_index(source_id text not null references sources(id),display_ordinal integer not null,model_name_raw text not null,payload_json text not null,primary key(source_id,display_ordinal))')
    model_rows=[]
    for context in contexts:
        index=context['metadata'].get('modelIndex',{})
        if isinstance(index,dict):
            for row in index.get('records',[]):
                model_rows.append((index['sourceId'],row['displayOrdinal'],row['modelNameRaw'],dump(row)))
    db.executemany('insert into provider_model_index values (?,?,?,?)',model_rows)
    search_rows=db.execute('select id,make,model from record_search where record_search match ? limit 5',('캐스퍼',)).fetchall()
    assert search_rows and all(row[0] and row[1] and row[2] for row in search_rows)
    for identifier,make,model in search_rows:
        assert db.execute('select make,model from records where id=?',(identifier,)).fetchone()==(make,model)
    counts = {'external_reference_components':len(data.get('bulkReferences',[])),'sources':len(official['sources']),'records':len(official['records']),'baseline':len(data['baseline']['records']),'api_observations':len(data['listingObservations']),'government_certifications':len(data['certificationObservations']),'reference_documents':len(data['referenceDocuments']),'source_contexts':len(contexts),'provider_model_index':len(model_rows)}
    results = [finish(db,temp,curated,counts)]

    bulk = DATA / 'bulk/global-vehicle-makes-models'
    if (bulk / 'archive-manifest.json').exists():
        manifest = json.loads((bulk / 'archive-manifest.json').read_text())
        rows = list(csv.DictReader(io.StringIO(gzip.decompress((bulk / 'engines.csv.gz').read_bytes()).decode('utf-8'))))
        global_path = out / 'global-engine-reference-ODbL.sqlite'
        db,temp = database(global_path)
        db.executemany('insert into metadata values (?,?)', [('license','ODbL-1.0'),('license_uri',manifest['licenseUrl']),('attribution',dump(manifest['attribution'])),('source_commit',manifest['commit']),('market','GLOBAL_UNVERIFIED_FOR_KR'),('automatic_korean_grade_mapping','false'),('original_archive_manifest',dump(manifest))])
        columns = list(rows[0])
        assert len(columns) == 23
        assert all(column.replace('_','').isalnum() for column in columns)
        db.execute('create table engines(id integer primary key,'+','.join(column+' text' for column in columns)+')')
        db.executemany('insert into engines values ('+','.join('?' for _ in range(24))+')', [(i,*[row[column] for column in columns]) for i,row in enumerate(rows,1)])
        db.execute('create index engines_classification on engines(make,model,generation,engine_label)')
        db.execute('create virtual table engine_search using fts5(make,model,generation,engine_label,fuel_type)')
        db.executemany('insert into engine_search values (?,?,?,?,?)', [(row['make'],row['model'],row['generation'],row['engine_label'],row['fuel_type']) for row in rows])
        hits=db.execute('select rowid,make,model,engine_label from engine_search where engine_search match ? limit 5',('make:BMW',)).fetchall()
        assert hits
        for position,make,model,label in hits:
            expected=rows[position-1]
            assert (make,model,label)==(expected['make'],expected['model'],expected['engine_label'])
        results.append(finish(db,temp,global_path,{'engines':manifest['counts']['engines']}))
    (out / 'artifact-manifest.json').write_text(json.dumps({'asOf':data['asOf'],'completeKoreanMaster':False,'databases':results},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(results,ensure_ascii=False))


if __name__ == '__main__':
    main()
