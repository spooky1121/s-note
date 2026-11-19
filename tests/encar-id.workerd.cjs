'use strict';
// Actual compiled Pages API in workerd. All Auth/Tavily replies are synthetic.
// NODE_PATH=/path/to/tools/node_modules node tests/encar-id.workerd.cjs /tmp/pages.js
const assert=require('node:assert/strict'),fs=require('node:fs');
const{Miniflare,Response:WorkerResponse,convertV4MiniflareOptions}=require('miniflare');
const ORIGIN='https://native-id-api.example',USER='11111111-1111-4111-8111-111111111111',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JWT='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl';
const ENV={SUPABASE_URL:'https://native-id-auth.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',TAVILY_API_KEY:'synthetic-search-token'};
const PLATE='12가3456',REAL_PLATE='66너7230',ID='43123456',REAL_ID='43138217',HOSTS=['carnect.biz','gloar-data.com','encar.spb.ru'];
const fixture=`
let mode='carnect',stats;const reset=()=>{stats={auth:0,members:0,searches:[],extracts:[],unexpected:[]};};reset();
const detail=(host,plate,id)=>({url:'https://'+host+(host==='carnect.biz'?'/car/43999999':host==='gloar-data.com'?'/en/lot/synthetic-car-'+id:'/auto/'+id+'/'),title:host==='encar.spb.ru'?'Synthetic vehicle — лот '+id:'Synthetic vehicle',content:'',raw_content:host==='encar.spb.ru'?'# Synthetic vehicle\\nЛот\\n'+id+'\\nНомер автомобиля\\n'+plate:'# Synthetic vehicle\\nLicense plate: '+plate+'\\nEncar ID: '+id,id:'opaque-search-document-0001'});
export default{async fetch(request){
 const url=new URL(request.url);
 if(url.hostname==='fixture.internal'){if(url.pathname==='/reset'){mode=url.searchParams.get('mode')||'carnect';reset();}return Response.json(stats);}
 if(url.origin==='https://native-id-auth.supabase.co'){
  if(request.method!=='GET'||request.headers.get('Authorization')!=='Bearer ${JWT}'||request.headers.get('apikey')!=='synthetic-public-key')throw Error('Synthetic Auth contract mismatch');
  if(url.pathname==='/auth/v1/user'){stats.auth++;return Response.json({id:'${USER}'});}
  if(url.pathname==='/rest/v1/zc_members'){stats.members++;return Response.json(mode==='denied'?[]:[{user_id:'${USER}',company_id:'${COMPANY}',role:'dealer',active:true}]);}
 }
 if(url.origin==='https://api.tavily.com'){
  if(request.method!=='POST'||request.headers.get('Authorization')!=='Bearer synthetic-search-token'||request.headers.get('Content-Type')!=='application/json')throw Error('Unsafe search authentication');
  const body=await request.json();
  if(url.pathname==='/search'){
   const hosts=body.include_domains,host=hosts?.[0];
   if(!Array.isArray(hosts)||hosts.length!==1||!${JSON.stringify(HOSTS)}.includes(host)||body.include_domains_mode!=='restrict'||body.exact_match!==true||body.search_depth!=='basic'||body.auto_parameters!==false||body.include_answer!==false||body.include_raw_content!=='markdown'||body.max_results!==6)throw Error('Unsafe or speculative search request');
   const plate=body.query?.includes('"${REAL_PLATE}"')?'${REAL_PLATE}':'${PLATE}';if(body.query!=='"'+plate+'" site:'+host)throw Error('Query must be the exact plate and provider');stats.searches.push({host,plate});
   if(mode==='search_auth')return Response.json({detail:'PRIVATE_AUTH'},{status:401});
   if(mode==='search_limit')return Response.json({detail:'PRIVATE_LIMIT'},{status:429,headers:{'Retry-After':'31'}});
   if(mode==='search_quota')return Response.json({detail:'PRIVATE_QUOTA'},{status:432,headers:{'Retry-After':'32'}});
   if(mode==='search_unavailable')return Response.json({detail:'PRIVATE_FAILURE'},{status:503});
   if(mode==='search_invalid')return new Response('{broken',{headers:{'Content-Type':'application/json'}});
   const wanted=mode==='real_66'?'encar.spb.ru':mode==='extract'?'carnect.biz':({carnect:'carnect.biz',gloar:'gloar-data.com',trust:'encar.spb.ru'})[mode];
   if(mode==='not_found'||!['mismatch','related','path_only','foreign_result'].includes(mode)&&host!==wanted)return Response.json({results:[]});
   const id=plate==='${REAL_PLATE}'?'${REAL_ID}':'${ID}',record=detail(host,plate,id);
   if(mode==='mismatch')record.raw_content=detail(host,'34나5678',id).raw_content;
   if(mode==='related'){Object.assign(record,detail(host,'34나5678','43111111'));record.raw_content+='\\n## Похожие автомобили\\nЛот\\n'+id+'\\nНомер автомобиля\\n'+plate;}
   if(mode==='path_only'){record.raw_content='# Synthetic vehicle\\nLicense plate: '+plate;record.id=id;record.content=plate;}
   if(mode==='extract'){record.raw_content=null;record.content='License plate: '+plate;}
   if(mode==='foreign_result')record.url='https://foreign.invalid/auto/'+id+'/';
   return Response.json({results:[record]});
  }
  if(url.pathname==='/extract'){
   if(!Array.isArray(body.urls)||body.urls.length<1||body.urls.length>3||body.extract_depth!=='basic'||body.format!=='markdown'||body.include_images!==false)throw Error('Unsafe extraction request');
   for(const value of body.urls){const target=new URL(value);if(target.protocol!=='https:'||!${JSON.stringify(HOSTS)}.includes(target.hostname)||!/^(?:\\/car\\/|\\/en\\/lot\\/|\\/auto\\/)/.test(target.pathname))throw Error('Unsafe extraction target');}
   stats.extracts.push([...body.urls]);return Response.json({results:body.urls.map(value=>({url:value,raw_content:mode==='extract'?'# Synthetic vehicle\\nLicense plate: ${PLATE}\\nEncar ID: ${ID}':'# Synthetic vehicle\\nLicense plate: ${PLATE}'})),failed_results:[]});
  }
 }
 stats.unexpected.push({origin:url.origin,path:url.pathname,method:request.method});return new Response('Unexpected request',{status:502});
}};`;
async function loadScript(path){let script=fs.readFileSync(path,'utf8');if(script.startsWith('--')){const boundary=script.split('\r\n')[0].slice(2),form=await new Response(script,{headers:{'Content-Type':'multipart/form-data; boundary='+boundary}}).formData(),metadata=JSON.parse(form.get('metadata'));script=await form.get(metadata.main_module).text();}return script;}
(async()=>{
 const script=await loadScript(process.argv[2]);let outbound=0;assert(!script.includes('/browser-run/devtools/browser'),'The compiled lookup must not import the browser search transport');
 const withoutKey={...ENV};delete withoutKey.TAVILY_API_KEY;
 const options={workers:[
  ...[['api',ENV],['no-key-api',withoutKey]].map(([name,bindings])=>({name,modulesRoot:'/native-id-api',modules:[{type:'ESModule',path:'/native-id-api/'+name+'.mjs',contents:script}],compatibilityDate:'2026-10-01',bindings,serviceBindings:{ASSETS:()=>new WorkerResponse('synthetic-static')},outboundService:'id-fixture'})),
  {name:'id-fixture',modulesRoot:'/native-id-api',modules:[{type:'ESModule',path:'/native-id-api/fixture.mjs',contents:fixture}],compatibilityDate:'2026-10-01'}
 ],cf:false,outboundService:()=>{outbound++;return new WorkerResponse('Outbound forbidden',{status:502});}};
 const runtime=new Miniflare(typeof convertV4MiniflareOptions==='function'?{...convertV4MiniflareOptions(options),telemetry:{enabled:false}}:options),reports=[];
 try{
  const upstream=await runtime.getWorker('id-fixture'),noKey=await runtime.getWorker('no-key-api');
  const optionsFor=(plate=PLATE)=>({method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',Authorization:'Bearer '+JWT},body:JSON.stringify({plate})});
  const call=(plate=PLATE)=>runtime.dispatchFetch(ORIGIN+'/api/encar-id',optionsFor(plate));
  const stats=async()=>{const state=await(await upstream.fetch('https://fixture.internal/stats')).json();assert.deepEqual(state.unexpected,[],'No browser, provider, Korean Encar, price or database-write call is allowed');return state;};
  const reset=mode=>upstream.fetch('https://fixture.internal/reset?mode='+mode);
  await reset('carnect');
  for(const[worker,configured]of[[null,true],[noKey,false]]){const response=worker?await worker.fetch(ORIGIN+'/api/encar-id'):await runtime.dispatchFetch(ORIGIN+'/api/encar-id');assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,configured,provider:'tavily',release:'2.147'});}
  let state=await stats();assert.equal(state.auth,0);assert.equal(state.members,0);assert.equal(state.searches.length,0);reports.push({mode:'public-configuration',externalCalls:0});
  for(const[kind,status]of[['foreign-origin',403],['extra-url',400],['missing-auth',401]]){const options=optionsFor();if(kind==='foreign-origin')options.headers.Origin='https://foreign.invalid';if(kind==='extra-url')options.body=JSON.stringify({plate:PLATE,url:'https://foreign.invalid'});if(kind==='missing-auth')delete options.headers.Authorization;const response=await runtime.dispatchFetch(ORIGIN+'/api/encar-id',options);assert.equal(response.status,status);}
  state=await stats();assert.equal(state.auth,0);assert.equal(state.members,0);assert.equal(state.searches.length,0);reports.push({mode:'request-boundaries',externalCalls:0});
  for(const mode of['carnect','gloar','trust','real_66','not_found','mismatch','related','path_only','foreign_result','extract']){
   await reset(mode);const plate=mode==='real_66'?REAL_PLATE:PLATE,response=await call(plate),body=await response.json();state=await stats();assert.equal(state.auth,1);assert.equal(state.members,1);assert.match(response.headers.get('Cache-Control'),/no-store/);assert.equal(response.headers.get('X-Snote-Release'),'2.147');assert(!JSON.stringify(body).includes('opaque-search-document'));
   if(['not_found','mismatch','related','path_only','foreign_result'].includes(mode)){assert.equal(body.ok,false,JSON.stringify({mode,body}));assert(!('id'in body));assert.equal(state.searches.length,3);if(['path_only','foreign_result'].includes(mode))assert.equal(response.status,502);else{assert.equal(response.status,200);assert.equal(body.status,'not_found');}if(mode==='foreign_result')assert.equal(state.extracts.length,0);}
   else{const provider=mode==='real_66'?'trust':mode==='extract'?'carnect':mode,id=mode==='real_66'?REAL_ID:ID;assert.equal(response.status,200,JSON.stringify({mode,body}));assert.deepEqual(body,{ok:true,status:'found',plate,id,provider});const expected=provider==='carnect'?1:provider==='gloar'?2:3;assert.equal(state.searches.length,expected);if(mode==='extract')assert.equal(state.extracts.length,1);}
   assert.deepEqual(state.searches.map(item=>item.host),HOSTS.slice(0,state.searches.length));reports.push({mode,status:response.status,searches:state.searches.length,extracts:state.extracts.length});
  }
  for(const[mode,status,code,retry]of[['search_auth',502,'SEARCH_AUTH_FAILED'],['search_limit',429,'SEARCH_RATE_LIMITED','31'],['search_quota',429,'SEARCH_RATE_LIMITED','32'],['search_unavailable',502,'SEARCH_UNAVAILABLE'],['search_invalid',502,'SEARCH_UNAVAILABLE']]){
   await reset(mode);const response=await call(),body=await response.json();state=await stats();assert.equal(response.status,status,JSON.stringify({mode,body}));assert.equal(body.code,code);assert.equal(state.searches.length,1,'Common service/auth/quota failure must stop immediately');assert.equal(state.extracts.length,0);assert(!JSON.stringify(body).includes('PRIVATE'));if(retry)assert.equal(response.headers.get('Retry-After'),retry);reports.push({mode,status,searches:1});
  }
  await reset('carnect');const noKeyOptions=optionsFor();delete noKeyOptions.headers.Origin;let response=await noKey.fetch(ORIGIN+'/api/encar-id',noKeyOptions),body=await response.json();state=await stats();assert.equal(response.status,503,JSON.stringify(body));assert.equal(body.code,'SEARCH_NOT_CONFIGURED');assert.equal(state.auth,1);assert.equal(state.members,1);assert.equal(state.searches.length,0);reports.push({mode:'missing-key',searches:0});
  await reset('denied');response=await call();state=await stats();assert.equal(response.status,403);assert.equal(state.searches.length,0);assert.equal(state.extracts.length,0);reports.push({mode:'denied',searches:0});
  assert.equal(outbound,0);console.log('PASS native Pages v2.147: indexed search only, full-plate/primary-ID proof, 66너7230→43138217, ordered early exit, bounded extraction, configuration/auth/quota distinctions; no Browser Run/provider/Korean/price/database requests; synthetic only, actual external outbound=0.');console.log(JSON.stringify(reports));
 }finally{await runtime.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
