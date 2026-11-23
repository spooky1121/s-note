import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Exact original lookup inputs and frozen source evidence are legitimate
// compatibility boundaries. A whole file or directory is never exempted.
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const policy=JSON.parse(fs.readFileSync(new URL('./fixtures/service-brand-boundaries.json',import.meta.url),'utf8'));
const digest=value=>createHash('sha256').update(value).digest('hex');
const matcher=()=>new RegExp(policy.searchPattern,'ig');
const extensions=new Set(policy.scope.extensions);
const knownNames=new Set(policy.scope.knownNames);
assert.equal(policy.schemaVersion,1);
for(const entry of policy.allowed){
 assert.equal(path.posix.normalize(entry.path),entry.path);
 assert(!entry.path.startsWith('../'));
 assert(entry.reason);
 for(const fragment of entry.fragments){assert(fragment.source);assert(matcher().test(fragment.source));assert(Number.isSafeInteger(fragment.maximumOccurrences)&&fragment.maximumOccurrences>0);}
}

function inspect(files,configuration=policy){
 const errors=[],counts={scannedFiles:0,allowedMatches:0,archiveMatches:0,compatibilityMatches:0,protectedFiles:0};
 const protectedFiles=new Map(configuration.protected.map(entry=>[entry.path,entry]));
 for(const entry of configuration.protected){
  const value=files.get(entry.path);
  if(value===undefined||digest(value)!==entry.sha256)errors.push({path:entry.path,code:'PROTECTED_BYTES_CHANGED'});
  else counts.protectedFiles++;
 }
 for(const [name,value]of files){
  if(name===configuration.scope.policyPath||!extensions.has(path.posix.extname(name).toLowerCase())&&!knownNames.has(path.posix.basename(name)))continue;
  counts.scannedFiles++;
  if(matcher().test(name))errors.push({path:name,code:'OLD_IDENTIFIER_IN_FILENAME'});
  const text=Buffer.isBuffer(value)?value.toString('utf8'):value,matches=[...text.matchAll(matcher())];
  if(!matches.length)continue;
  // Frozen evidence is accepted only after the independent byte hash above.
  if(protectedFiles.has(name)){counts.allowedMatches+=matches.length;counts.archiveMatches+=matches.length;continue;}
  const accepted=[];
  for(const fragment of configuration.allowed.find(entry=>entry.path===name)?.fragments||[]){
   let at=0,count=0;
   while((at=text.indexOf(fragment.source,at))!==-1){accepted.push([at,at+fragment.source.length]);at+=fragment.source.length;count++;}
   if(count>fragment.maximumOccurrences)errors.push({path:name,code:'LEGACY_FRAGMENT_COUNT_INCREASED'});
  }
  for(const match of matches){
   if(accepted.some(([start,end])=>start<=match.index&&end>=match.index+match[0].length)){counts.allowedMatches++;counts.compatibilityMatches++;}
   else errors.push({path:name,line:text.slice(0,match.index).split('\n').length,code:'UNAPPROVED_OLD_IDENTIFIER'});
  }
 }
 return{errors,...counts};
}
function fixturePolicy(){
 const entry=policy.allowed.find(row=>row.path===policy.fixtures.approvedPath);
 return{...policy,allowed:[entry],protected:[]};
}

test('ordinary current code cannot introduce a previous product identifier',()=>{
 const result=inspect(new Map([[policy.fixtures.ordinaryPath,policy.fixtures.approvedSource]]),fixturePolicy());
 assert(result.errors.some(error=>error.code==='UNAPPROVED_OLD_IDENTIFIER'));
});
test('only a documented exact fragment at its original compatibility boundary is accepted',()=>{
 const result=inspect(new Map([[policy.fixtures.approvedPath,policy.fixtures.approvedSource]]),fixturePolicy());
 assert.deepEqual(result.errors,[]);assert.equal(result.allowedMatches,1);
});
test('approved modules are not blanket exemptions for new product branding',()=>{
 const source=policy.fixtures.approvedSource+'\n'+policy.fixtures.unexpectedSource;
 assert(inspect(new Map([[policy.fixtures.approvedPath,source]]),fixturePolicy()).errors.some(error=>error.code==='UNAPPROVED_OLD_IDENTIFIER'));
});
test('an approved fragment cannot silently grow into additional old-name uses',()=>{
 const source=policy.fixtures.approvedSource+'\n'+policy.fixtures.approvedSource;
 assert(inspect(new Map([[policy.fixtures.approvedPath,source]]),fixturePolicy()).errors.some(error=>error.code==='LEGACY_FRAGMENT_COUNT_INCREASED'));
});
test('historical source evidence retains its original bytes and fails after any change',()=>{
 const original=policy.fixtures.archiveSource,name=policy.fixtures.archivePath;
 const configuration={...fixturePolicy(),protected:[{path:name,sha256:digest(original)}]};
 assert.deepEqual(inspect(new Map([[name,original]]),configuration).errors,[]);
 assert(inspect(new Map([[name,original+'\n']]),configuration).errors.some(error=>error.code==='PROTECTED_BYTES_CHANGED'));
});
test('actual legal company values are preserved rather than treated as product labels',()=>{
 assert.deepEqual(inspect(new Map([[policy.fixtures.ordinaryPath,policy.fixtures.legalSource]]),fixturePolicy()).errors,[]);
});
test('tracked and newly added current code stays inside explicit legacy boundaries',()=>{
 const listed=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:ROOT,encoding:'utf8'}).split('\0').filter(Boolean);
 const required=new Set(policy.protected.map(entry=>entry.path));
 const files=new Map();
 for(const name of new Set(listed)){
  if(!extensions.has(path.posix.extname(name).toLowerCase())&&!knownNames.has(path.posix.basename(name))&&!required.has(name))continue;
  const absolute=path.join(ROOT,name);
  if(!fs.existsSync(absolute))continue;
  assert(!fs.lstatSync(absolute).isSymbolicLink(),'Source inspection does not follow repository symlinks: '+name);
  files.set(name,fs.readFileSync(absolute));
 }
 const result=inspect(files);
 assert.deepEqual(result.errors,[],JSON.stringify(result.errors,null,2));
 console.log('BRAND_BOUNDARIES '+JSON.stringify({scannedFiles:result.scannedFiles,allowedLegacyMatches:result.allowedMatches,archiveMatches:result.archiveMatches,compatibilityMatches:result.compatibilityMatches,protectedFiles:result.protectedFiles,policyDefinition:policy.scope.policyDefinitionReason,documentation:policy.scope.documentation}));
});
