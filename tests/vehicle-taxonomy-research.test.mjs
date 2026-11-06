import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {sanitizeProbe,allowedDetailPath} from '../scripts/archive-taxonomy-probe.mjs';
import {normalizeResearchRecord,csvCell} from '../scripts/build-vehicle-taxonomy-research.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const dir=join(root,'research/vehicle-taxonomy');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const archive=read(join(dir,'observations/encar-api.com-2026-11-06T13-57-31-629Z.json'));

test('archived live diagnostic keeps all three samples and eleven classification facts without inferring grades',()=>{
  const roundtrip=sanitizeProbe(archive);
  assert.deepEqual(roundtrip,archive);
  assert.equal(roundtrip.samples.length,3);
  assert.equal(roundtrip.detailClassification.length,11);
  assert.equal(roundtrip.checkedAt,'2026-11-06T13:57:31.629Z');
  assert.deepEqual(roundtrip.rateLimit,{limit:100,remaining:98,reset:null});
  assert.equal(roundtrip.cached,true);
  assert.equal(roundtrip.providerRequestCount,0);
  assert.equal(roundtrip.importEnabled,false);
  assert.equal(roundtrip.samples[0].modelGroup,null);
  assert.equal('grade' in roundtrip.samples[0],false);
});

test('future valid nested codes survive archive while seller fields and secrets are omitted',()=>{
  const paths=['data.classification.Manufacturer.Code','ModelGrpCd','BrandId','GradeDetail.Nm','generationCode'];
  for(const path of paths)assert.equal(allowedDetailPath(path),true,path);
  const result=sanitizeProbe({...archive,apiKey:'sensitive-placeholder',authorization:'private',seller:{phone:'01000000000'},detailClassification:[...paths.map(path=>({path,value:'example-code'})),{path:'seller.phone',value:'01000000000'},{path:'Manufacturer.secret',value:'sensitive-placeholder'}]});
  assert.deepEqual(result.detailClassification.map(row=>row.path),paths);
  assert.doesNotMatch(JSON.stringify(result),/sensitive-placeholder|01000000000|authorization/);
});

test('noncached empty result, detail status, quota reset and static warning code are preserved',()=>{
  const result=sanitizeProbe({...archive,cached:false,samples:[],detailClassification:[],detailStatus:'skipped_no_listing',rateLimit:{limit:100,remaining:0,reset:1794000000},warningCodes:['UPSTREAM_RATE_LIMITED','untrusted arbitrary text']});
  assert.equal(result.detailStatus,'skipped_no_listing');
  assert.equal(result.rateLimit.reset,1794000000);
  assert.deepEqual(result.warningCodes,['UPSTREAM_RATE_LIMITED']);
  assert.match(result.notes,/not marked cached/);
});

const sources=[{id:'test-source',url:'https://example.com/official',retrievedAt:'2026-11-06',sourcePeriod:'2026-10'}];
const row={make:'제조사',group:'차명군',model:'모델',grade:'캘리그래피',sourceId:'test-source',evidenceStatus:'official_direct'};
test('unknown engine, year and child trim remain empty; original evidence is retained',()=>{
  const result=normalizeResearchRecord(row,'test.json',sources);
  for(const key of ['modelYear','fuel','engine','subgrade'])assert.equal(result[key],'');
  assert.equal(result.mappingStatus,'needs_parent_match');
  assert.deepEqual(result.sourceRecord,row);
  assert.equal(result.researchId.startsWith('research-'),true);
  assert.equal(normalizeResearchRecord({...row,modelYear:'2025.5'},'test.json',sources).modelYear,'2025.5');
  assert.throws(()=>normalizeResearchRecord({...row,modelYear:'2026-10 가격표'},'test.json',sources),/year/);
});

test('year, fuel, engine, drive, market, option, seat and body variants never share a research identity',()=>{
  const variants=[{}, {modelYear:'2025'}, {modelYear:'2026'}, {fuel:'디젤'}, {engine:'1.6'}, {drivetrain:'AWD'}, {transmission:'6단 수동'}, {transmission:'7단 DCT'}, {market:'EU'}, {recordType:'engine_option'}, {optionPackage:'액티브 II'}, {powertrainChoice:'터보 선택'}, {seats:7}, {seats:6}, {bodyStyle:'밴'}, {batteryRange:'롱레인지'}];
  const ids=variants.map(variant=>normalizeResearchRecord({...row,...variant},'test.json',sources).researchId);
  assert.equal(new Set(ids).size,variants.length);
});

test('CSV protects spreadsheet formula execution without changing JSON text',()=>{
  for(const value of ['=HYPERLINK("https://example.com")','+SUM(1,1)','-1+2','@SUM(1,1)','\t=1+1'])assert.match(csvCell(value),/^"'/);
  assert.equal(csvCell('인스퍼레이션'),'"인스퍼레이션"');
  assert.equal(csvCell('a,"b"'),'"a,""b"""');
});

test('all source records retain original fields and every evidence reference in consolidated JSON',()=>{
  const output=read(join(dir,'exports/official-research.json'));
  const allEvidence=output.records.flatMap(row=>row.evidence);
  let inputCount=0;
  for(const file of readdirSync(join(dir,'sources')).filter(name=>name.endsWith('.json'))){
    const data=read(join(dir,'sources',file));
    if(!data.records?.length||data.records[0].evidenceStatus==='certification_observed')continue;
    for(const record of data.records){
      inputCount++;
      const matches=allEvidence.filter(item=>item.sourceFile==='research/vehicle-taxonomy/sources/'+file&&item.sourceId===record.sourceId&&JSON.stringify(item.sourceRecord)===JSON.stringify(record));
      assert.equal(matches.length,1,file+' '+record.model+' '+record.grade);
    }
  }
  assert.equal(allEvidence.length,inputCount);
  assert.equal(new Set(output.records.map(row=>row.researchId)).size,output.records.length);
});

test('baseline is unmodified; API and government evidence are not promoted to sales classification',()=>{
  const output=read(join(dir,'exports/catalog-reference.json'));
  const baseline=read(join(dir,'baseline/catalog.json'));
  assert.equal(baseline.records.length,1615);
  assert.deepEqual(output.baseline.records.map(({evidenceStatus,...record})=>record),baseline.records);
  assert.equal(output.runtimeImportEnabled,false);
  assert.equal(output.listingObservations.length,3);
  assert.equal(output.certificationObservations.length,20);
  for(const observation of output.listingObservations)assert.equal(observation.mappingStatus,'needs_review');
  for(const observation of output.certificationObservations){assert.equal(observation.canonicalGrade,null);assert.equal(observation.modelYear,null);assert.equal(observation.eligibleForAutomaticRuntimeImport,false);}
});

test('manifest hashes match every research input and exported artifact',()=>{
  const manifest=read(join(dir,'exports/manifest.json'));
  for(const entry of [...manifest.inputs,...manifest.files]){
    const bytes=readFileSync(join(root,entry.path));
    assert.equal(bytes.length,entry.bytes,entry.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.path);
  }
  const coverage=read(join(dir,'exports/coverage.json'));
  assert.equal(coverage.complete,false);
  assert.equal(coverage.baseline.modelsWithoutGrade,986);
});
