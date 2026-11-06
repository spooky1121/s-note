import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const research=join(root,'research/vehicle-taxonomy');
const outDir=join(research,'exports');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const text=value=>value==null?'':String(value).normalize('NFC').trim();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const csvCell=value=>{let valueText=text(typeof value==='object'?JSON.stringify(value):value);if(/^[=+\-@]/.test(valueText))valueText="'"+valueText;return '"'+valueText.replaceAll('"','""')+'"';};
const csv=(rows,columns)=>'\ufeff'+[columns,...rows.map(row=>columns.map(key=>row[key]??''))].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
const url=value=>{const parsed=new URL(value);if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw new Error('Invalid source URL: '+value);return parsed.href;};
const writeJSON=(name,value)=>writeFileSync(join(outDir,name),JSON.stringify(value,null,2)+'\n');
const identity=row=>[row.make,row.group,row.model,row.grade,row.subgrade,row.modelYear,row.fuel,row.engine,row.drivetrain,row.transmission,row.market,row.recordType,row.optionPackage,row.powertrainChoice,row.seatLayout,row.seatingCapacity,row.bodyStyle,row.batteryRange].map(text);
const statuses=new Set(['official_direct','official_search_excerpt','candidate']);

export function normalizeResearchRecord(row,file,sources){
  const sourceId=text(row.sourceId);
  const source=sources.find(source=>source.id===sourceId);
  if(!source)throw new Error(file+': missing source '+sourceId);
  const sourceUrl=url(row.sourceUrl||source.url);
  const record={make:text(row.make),group:text(row.group),model:text(row.model),grade:text(row.grade),subgrade:text(row.subgrade),modelYear:text(row.modelYear),fuel:text(row.fuel),engine:text(row.engine),drivetrain:text(row.drivetrain||row.drive),transmission:text(row.transmission),market:text(row.market)||'KR',recordType:text(row.recordType)||'source_label',optionPackage:text(row.optionPackage),powertrainChoice:text(row.powertrainChoice),seatLayout:text(row.seatLayout),seatingCapacity:text(row.seatingCapacity??row.seats),bodyStyle:text(row.bodyStyle),batteryRange:text(row.batteryRange),availability:text(row.availability),sourceLabel:text(row.sourceLabel||row.trimLabel),sourceId,sourceUrl,retrievedAt:text(source.retrievedAt),evidenceStatus:text(row.evidenceStatus),mappingStatus:text(row.mappingStatus)||'needs_parent_match',notes:text(row.notes),sourceFile:file,sourceRecord:row};
  if(!record.make||!record.group||!record.model)throw new Error(file+': make/group/model required');
  if(!statuses.has(record.evidenceStatus))throw new Error(file+': invalid evidenceStatus '+record.evidenceStatus);
  if(record.modelYear&&!/^\d{4}(?:\.\d{1,2})?(?:[–-]\d{4}(?:\.\d{1,2})?)?$/.test(record.modelYear))throw new Error(file+': year must be explicitly supported, not publication date');
  if(!/^\d{4}-\d{2}-\d{2}/.test(record.retrievedAt))throw new Error(file+': retrieval date required');
  return {researchId:'research-'+hash(identity(record)).slice(0,24),...record};
}

export function build(){
  mkdirSync(outDir,{recursive:true});
  const baseline=read(join(research,'baseline/catalog.json'));
  if(!Array.isArray(baseline.records)||baseline.records.length<1000)throw new Error('Baseline catalog missing');
  const sourceFiles=readdirSync(join(research,'sources')).filter(name=>name.endsWith('.json')).sort();
  const sources=[],records=[],otherEvidence=[],certifications=[],referenceDocuments=[],sourceFileContexts=[];
  for(const name of sourceFiles){
    const path=join(research,'sources',name),data=read(path),file=relative(root,path);
    if(!Array.isArray(data.records)){referenceDocuments.push({sourceFile:file,data});otherEvidence.push({path:file,kind:data.kind||data.scope||'source_survey'});continue;}
    sourceFileContexts.push({sourceFile:file,metadata:Object.fromEntries(Object.entries(data).filter(([key])=>!['records','sources'].includes(key)))});
    if(data.records.length&&data.records.every(row=>row.evidenceStatus==='certification_observed')){certifications.push(...data.records.map(row=>({...row,sourceFile:file})));otherEvidence.push({path:file,kind:'certification_observed',records:data.records.length});continue;}
    if(!Array.isArray(data.sources))throw new Error(name+': source registry missing');
    for(const source of data.sources){
      if(sources.some(row=>row.id===source.id))throw new Error('Duplicate source id '+source.id);
      sources.push({...source,url:url(source.url),sourceFile:file});
    }
    for(const row of data.records)records.push(normalizeResearchRecord(row,file,data.sources));
  }
  const unique=new Map();
  for(const row of records){
    const key=JSON.stringify(identity(row)),previous=unique.get(key);
    if(previous){
      previous.evidence.push({sourceId:row.sourceId,sourceUrl:row.sourceUrl,evidenceStatus:row.evidenceStatus,sourceFile:row.sourceFile,sourceRecord:row.sourceRecord});
      if(row.evidenceStatus==='official_direct'&&previous.evidenceStatus!=='official_direct')Object.assign(previous,row);
    }else unique.set(key,{...row,evidence:[{sourceId:row.sourceId,sourceUrl:row.sourceUrl,evidenceStatus:row.evidenceStatus,sourceFile:row.sourceFile,sourceRecord:row.sourceRecord}]});
  }
  const normalized=[...unique.values()].sort((a,b)=>JSON.stringify(identity(a)).localeCompare(JSON.stringify(identity(b)),'ko'));
  const observations=[];
  const observationFiles=readdirSync(join(research,'observations')).filter(name=>name.endsWith('.json')).sort();
  for(const name of observationFiles){
    const report=read(join(research,'observations',name));
    if(report.provider!=='encar-api.com'||report.importEnabled!==false)throw new Error('Invalid observation archive');
    for(const sample of report.samples)observations.push({observationId:'listing-'+hash([report.provider,sample.listingId,report.checkedAt]).slice(0,24),provider:report.provider,listingId:sample.listingId,manufacturer:sample.manufacturer,modelGroup:sample.modelGroup,model:sample.model,badge:sample.badge,checkedAt:report.checkedAt,evidenceStatus:'listing_observed',mappingStatus:'needs_review',sourceFile:'research/vehicle-taxonomy/observations/'+name});
  }
  const baselineRecords=baseline.records.map(row=>({...row,evidenceStatus:'baseline_not_reverified'}));
  const makeSet=new Set(baselineRecords.map(row=>row.make));
  const baselineModels=new Map();
  for(const row of baselineRecords){const key=JSON.stringify([row.make,row.group,row.model]);if(!baselineModels.has(key))baselineModels.set(key,[]);baselineModels.get(key).push(row);}
  const missing=[...baselineModels.values()].filter(rows=>!rows.some(row=>text(row.grade))).map(rows=>({make:rows[0].make,group:rows[0].group,model:rows[0].model,reason:'no_grade_in_baseline',status:'needs_model_year_and_powertrain_match',researchCandidates:normalized.filter(row=>row.make===rows[0].make&&row.group===rows[0].group).length}));
  const byMake=[...new Set([...makeSet,...normalized.map(row=>row.make)])].sort((a,b)=>a.localeCompare(b,'ko')).map(make=>({make,baselineRows:baselineRecords.filter(row=>row.make===make).length,baselineModels:[...baselineModels.values()].filter(rows=>rows[0].make===make).length,baselineModelsMissingGrade:missing.filter(row=>row.make===make).length,newOfficialDirectRecords:normalized.filter(row=>row.make===make&&row.evidenceStatus==='official_direct').length,newSearchExcerptRecords:normalized.filter(row=>row.make===make&&row.evidenceStatus==='official_search_excerpt').length}));
  const pickerCoverage=read(join(research,'baseline/coverage.json')).domesticPicker;
  const dataset={schemaVersion:1,asOf:'2026-11-06',scope:'Korean-market vehicle classification reference research; not a complete official master',runtimeImportEnabled:false,baseline:{...baseline,records:baselineRecords},officialResearch:{records:normalized,sources,sourceFileContexts},listingObservations:observations,certificationObservations:certifications,referenceDocuments,otherEvidence};
  const coverage={schemaVersion:1,asOf:'2026-11-06',complete:false,runtimeImportEnabled:false,baseline:{rows:baselineRecords.length,makes:makeSet.size,models:baselineModels.size,modelsWithoutGrade:missing.length,domesticPicker:pickerCoverage,verification:'Existing labels are preserved, not reverified by this research.'},newResearch:{sourceFiles:sourceFiles.length,sources:sources.length,rawRecords:records.length,uniqueRecords:normalized.length,officialDirectRecords:normalized.filter(row=>row.evidenceStatus==='official_direct').length,searchExcerptRecords:normalized.filter(row=>row.evidenceStatus==='official_search_excerpt').length,candidateRecords:normalized.filter(row=>row.evidenceStatus==='candidate').length},listingObservations:observations.length,certificationObservations:certifications.length,otherEvidence,byMake,limitations:['No source establishes all historical Korean-market model years, engines and discontinued trims.','New official records retain their original model-year and powertrain scope; matching a baseline family alone does not fill a generation gap.','Listing Badge observations are not promoted to grade/subgrade or assigned parent codes.','A publication month is not a model year.','No existing company taxonomy, customer, vehicle or financial data is modified.']};
  writeJSON('catalog-reference.json',dataset);
  writeJSON('official-research.json',{schemaVersion:1,asOf:'2026-11-06',records:normalized,sources,sourceFileContexts});
  writeJSON('api-observations.json',{schemaVersion:1,observations});
  writeJSON('certification-observations.json',{schemaVersion:1,observations:certifications});
  writeJSON('coverage.json',coverage);
  writeFileSync(join(outDir,'official-research.csv'),csv(normalized,['researchId','make','group','model','grade','subgrade','modelYear','fuel','engine','drivetrain','transmission','market','recordType','optionPackage','powertrainChoice','seatLayout','seatingCapacity','bodyStyle','batteryRange','availability','sourceLabel','evidenceStatus','mappingStatus','sourceUrl','retrievedAt','notes']));
  writeFileSync(join(outDir,'api-observations.csv'),csv(observations,['observationId','provider','listingId','manufacturer','modelGroup','model','badge','checkedAt','evidenceStatus','mappingStatus','sourceFile']));
  writeFileSync(join(outDir,'certification-observations.csv'),csv(certifications,['certificateHolder','vehicleName','typeCode','fuelRaw','certificationNumber','certificationDate','sourceUrl','observedOn','evidenceStatus','acquisitionMethod','directFetchStatus','sourceFile']));
  writeFileSync(join(outDir,'review-queue.csv'),csv(missing,['make','group','model','reason','status','researchCandidates']));
  writeFileSync(join(outDir,'manufacturer-coverage.csv'),csv(byMake,['make','baselineRows','baselineModels','baselineModelsMissingGrade','newOfficialDirectRecords','newSearchExcerptRecords']));
  const inputs=[join(research,'baseline/catalog.json'),join(research,'baseline/coverage.json'),...sourceFiles.map(name=>join(research,'sources',name)),...observationFiles.map(name=>join(research,'observations',name))];
  const fileMeta=path=>{const data=readFileSync(path);return {path:relative(root,path),bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};};
  const manifest={schemaVersion:1,asOf:'2026-11-06',inputs:inputs.map(fileMeta),files:readdirSync(outDir).filter(name=>name!=='manifest.json').sort().map(name=>fileMeta(join(outDir,name)))};
  writeJSON('manifest.json',manifest);
  process.stdout.write(JSON.stringify({baseline:coverage.baseline,newResearch:coverage.newResearch,listingObservations:observations.length,output:relative(root,outDir)},null,2)+'\n');
  return coverage;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))build();
