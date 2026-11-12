'use strict';
// Metadata-only rollback smoke in an already populated, explicitly labelled,
// network-isolated disposable PostgreSQL fixture. No cloud URL is accepted.
// SNOTE_SESSION_POSTGRES_CONTAINER=snote-session-race-* node tests/single-session-rollback.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const ROOT=path.join(__dirname,'..'),ARTIFACTS=path.resolve(ROOT,'../work/single-session-rollout');
const container=process.env.SNOTE_SESSION_POSTGRES_CONTAINER;
assert(/^snote-session-race-[a-z0-9-]+$/.test(container||''),'Use a dedicated snote-session-race-* local test container');
const env={...process.env};for(const key of['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const docker=['--host=unix:///var/run/docker.sock'];
function run(args,input){const result=spawnSync('docker',[...docker,...args],{env,input,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();}
assert.equal(run(['inspect','--format','{{index .Config.Labels "snote.session-test"}} {{.HostConfig.NetworkMode}}',container]),'true none','Refuse any unlabelled or network-connected container');
const sql=statement=>run(['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],statement);
const json=statement=>JSON.parse(sql(statement));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const rollbackFile=path.join(ARTIFACTS,'rollback.sql'),metadataFile=path.join(ARTIFACTS,'metadata-before.json');
const metadata=JSON.parse(fs.readFileSync(metadataFile,'utf8'));
// Only add synthetic Auth fixture identities. No business rows are added or changed.
const user='55555555-0000-4000-8000-000000000005',old='55555555-0000-4000-8000-000000000051',pending='55555555-0000-4000-8000-000000000052';
sql(`insert into auth.users(id,email,email_confirmed_at) values('${user}','rollback-fixture@example.invalid',now());
 insert into auth.sessions(id,user_id,created_at) values('${old}','${user}','2026-01-01'),('${pending}','${user}','2026-01-02');`);
function claim(sid){return sql(`begin;select set_config('request.jwt.claim.sub','${user}',true);select set_config('request.jwt.claims','${JSON.stringify({role:'authenticated',sub:user,session_id:sid,is_anonymous:false})}',true);select set_config('request.method','POST',true);set local role authenticated;select public.snote_session_claim();commit;`);}
assert.match(claim(old),/"active": true/);assert.match(claim(pending),/CONFIRMATION_REQUIRED/);
function snapshot(){return json(`select jsonb_build_object(
 'fences',(select count(*) from snote_session_private.primary_sessions),
 'pending',(select count(*) from snote_session_private.pending_claims),
 'fenceHash',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by user_id)::text,'[]')) from snote_session_private.primary_sessions t),
 'pendingHash',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by session_id)::text,'[]')) from snote_session_private.pending_claims t),
 'signalsHash',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by user_id)::text,'[]')) from public.snote_session_signals t),
 'authSessionsHash',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from auth.sessions t),
 'businessHash',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by user_id)::text,'[]')) from public.zc_data_sets t));`);}
const before=snapshot();assert(before.fences>0);assert(before.pending>0);
sql(fs.readFileSync(rollbackFile,'utf8'));
const after=snapshot();assert.deepEqual(after,before,'Rollback must preserve fences, candidates, Auth and business rows');
const checks=json(`select jsonb_build_object(
 'hookReset',not exists(select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) setting where setting like 'pgrst.db_pre_request=%'),
 'remainingPolicies',(select count(*) from pg_policies where policyname in('snote_primary_session_guard','snote_primary_session_storage','snote_session_signal_own')),
 'claimGranted',has_function_privilege('authenticated','public.snote_session_claim(boolean,bigint)','execute'),
 'statusGranted',has_function_privilege('authenticated','public.snote_session_status()','execute'),
 'publishedSignals',(select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='snote_session_signals'),
 'privateAppFunctionGrants',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join (values('anon'),('authenticated'),('service_role')) roles(name) where n.nspname='snote_session_private' and has_function_privilege(roles.name,p.oid,'execute')));`);
assert.deepEqual(checks,{hookReset:true,remainingPolicies:0,claimGranted:false,statusGranted:false,publishedSignals:0,privateAppFunctionGrants:0});
const restored=sql("select pg_get_functiondef('snote_operator_private.verified_session(uuid,uuid)'::regprocedure)");
assert.equal(restored,metadata.operator_verified_session_definition.trim(),'Restore the captured operator function exactly');
const migration=fs.readdirSync(path.join(ROOT,'supabase/migrations')).filter(name=>name.endsWith('_single_active_account_session.sql')).sort().at(-1);
const result={verifiedAt:new Date().toISOString(),scope:'Isolated labelled local PostgreSQL only; no production apply',container,postgresVersion:sql('select version()'),...checks,operatorRestored:true,retainedFences:after.fences,retainedPending:after.pending,allRowHashesUnchanged:true,before,after,sourceHashes:{migration:{file:migration,sha256:hash(path.join(ROOT,'supabase/migrations',migration))},rollback:{file:rollbackFile,sha256:hash(rollbackFile)},test:{file:'tests/single-session-rollback.cjs',sha256:hash(__filename)}}};
fs.writeFileSync(path.join(ARTIFACTS,'rollback-test-result.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
