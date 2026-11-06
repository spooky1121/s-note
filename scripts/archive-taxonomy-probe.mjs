import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const scalar=(value,max=160)=>typeof value==='string'?value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max):null;
const integer=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const containers=new Set(['data','result','results','car','vehicle','details','category','classification','listing','item','payload','en','de']);
const classFields=new Set();
for(const name of ['manufacturer','brand','modelgroup','modelgrp','model','generation','badge','badgedetail','grade','gradedetail','subgrade','trim','subtrim'])for(const suffix of ['','id','code','cd','name','nm'])classFields.add(name+suffix);
const labels=new Set(['id','code','cd','name','nm','label','value','text']);
export function allowedDetailPath(path){
  if(typeof path!=='string'||!/^[A-Za-z][A-Za-z0-9_.-]{0,399}$/.test(path))return false;
  const parts=path.split('.');if(parts.length>8)return false;
  let selected=false,leaf=false;
  for(const part of parts){const name=part.toLowerCase().replace(/[_-]/g,''),classification=classFields.has(name),inherited=selected&&labels.has(name);if(!classification&&!inherited&&!containers.has(name))return false;leaf=classification||inherited;selected=leaf;}
  return leaf;
}
const detailStatuses=new Set(['checked','skipped_no_listing','skipped_quota','unavailable']);
const warningCodes=new Set(['UPSTREAM_UNAUTHORIZED','UPSTREAM_FORBIDDEN','UPSTREAM_RATE_LIMITED','UPSTREAM_UNAVAILABLE','UPSTREAM_NOT_FOUND','UPSTREAM_INVALID','UPSTREAM_REDIRECT','UPSTREAM_TIMEOUT']);

/** Save classification evidence only. Unknown input keys are never archived. */
export function sanitizeProbe(input){
  if(!input||input.ok!==true||input.provider!=='encar-api.com')throw new Error('Successful encar-api.com diagnostic required');
  if(typeof input.checkedAt!=='string'||!Number.isFinite(Date.parse(input.checkedAt)))throw new Error('Valid checkedAt required');
  if(!Array.isArray(input.samples)||input.samples.length>3)throw new Error('Expected 0–3 samples');
  const samples=input.samples.map(row=>{
    if(!/^\d{1,20}$/.test(String(row.listingId||'')))throw new Error('Invalid listingId');
    const manufacturer=scalar(row.manufacturer),model=scalar(row.model);
    if(!manufacturer||!model)throw new Error('Manufacturer and model required');
    return {listingId:String(row.listingId),manufacturer,modelGroup:scalar(row.modelGroup),model,badge:scalar(row.badge)};
  });
  const detailClassification=(Array.isArray(input.detailClassification)?input.detailClassification:[]).filter(row=>row&&allowedDetailPath(row.path)&&typeof row.value==='string').slice(0,60).map(row=>({path:row.path,value:scalar(row.value,400)}));
  return {
    schemaVersion:1,
    acquisitionMethod:'user_provided_deployed_probe_diagnostic',
    sourceUrl:'https://www.encar-api.com/docs',
    ok:true,provider:input.provider,manufacturer:scalar(input.manufacturer,45),
    checkedAt:new Date(input.checkedAt).toISOString(),
    cached:input.cached===true,providerRequestCount:integer(input.providerRequestCount),samples,detailClassification,
    schemaSummary:{modelGroupObserved:input.schemaSummary?.modelGroupObserved===true,separateGradeTrimObserved:input.schemaSummary?.separateGradeTrimObserved===true,classificationCodeObserved:input.schemaSummary?.classificationCodeObserved===true,requiresReview:true},
    detailStatus:detailStatuses.has(input.detailStatus)?input.detailStatus:'not_confirmed',
    rateLimit:{limit:integer(input.rateLimit?.limit),remaining:integer(input.rateLimit?.remaining),reset:integer(input.rateLimit?.reset)},
    warningCodes:(Array.isArray(input.warningCodes)?input.warningCodes:[]).filter(code=>warningCodes.has(code)).slice(0,3),
    importEnabled:false,
    evidenceStatus:'listing_observed',
    notes:(input.cached===true?'The current response is cached. ':'The current response is not marked cached. ')+'checkedAt identifies the source fetch. A listing Badge is preserved as an observation, without inferred grade, engine, model year or parent codes.'
  };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const inputPath=process.argv[2];
  if(!inputPath)throw new Error('Usage: node scripts/archive-taxonomy-probe.mjs diagnostic.json [output-directory]');
  const archive=sanitizeProbe(JSON.parse(readFileSync(inputPath,'utf8')));
  const outDir=resolve(process.argv[3]||'research/vehicle-taxonomy/observations');
  const path=resolve(outDir,archive.provider+'-'+archive.checkedAt.replace(/[:.]/g,'-')+'.json');
  const content=JSON.stringify(archive,null,2)+'\n';
  mkdirSync(dirname(path),{recursive:true});
  if(existsSync(path)){
    if(!isDeepStrictEqual(JSON.parse(readFileSync(path,'utf8')),archive))throw new Error('Existing evidence differs; archive will not be overwritten');
  }else writeFileSync(path,content,{flag:'wx'});
  process.stdout.write(path+'\n');
}
