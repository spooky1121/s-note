'use strict';
// Hydrate the shipped snapshot readers through real reload(), using synthetic RPC data.
async function hydrateFinance(f,financeRows=[],financeLimits=[['검증 금융',10000000,0]],prestockRows=[]){
 const p=f.page;
 await p.evaluate(({financeRows,financeLimits,prestockRows})=>{
  const S=__encarFixtureState,m=window.__companyMock,original=S.client.from.bind(S.client),rpc=S.client.rpc.bind(S.client),nil='00000000-0000-0000-0000-000000000000';
  const base=m?m.data.datasets.map(row=>({company_id:S.company.id,dataset:row.dataset,owner_id:row.ownerId,payload:structuredClone(row.payload),revision:row.revision})):[{company_id:S.company.id,dataset:'cars',owner_id:S.user.id,payload:structuredClone(__encarFixtureCars),revision:__encarFixtureRevision}];
  window.__financeScope={rows:[...base,{company_id:S.company.id,dataset:'finance',owner_id:nil,payload:structuredClone(financeRows),revision:4},{company_id:S.company.id,dataset:'finance_limits',owner_id:nil,payload:structuredClone(financeLimits),revision:5},{company_id:S.company.id,dataset:'prestock',owner_id:nil,payload:structuredClone(prestockRows),revision:6}],writes:[],reads:[],hold:false,held:[]};
  S.client.from=table=>{if(table!=='zc_datasets')return original(table);const filters={};let single=false;const q={select(){return q;},eq(key,value){filters[key]=value;return q;},limit(){return q;},maybeSingle(){single=true;return q;},then(resolve,reject){__financeScope.reads.push(structuredClone(filters));let rows=__financeScope.rows.filter(row=>Object.entries(filters).every(([key,value])=>row[key]===value));if(!single&&!filters.dataset)rows=rows.filter(row=>!(__financeScope.bulkOmit||[]).includes(row.dataset));const error=single&&(__financeScope.uniqueErrors||[]).includes(filters.dataset)?{code:'SYNTHETIC_SHARED_READ_FAILED',message:'SYNTHETIC_SHARED_READ_FAILED'}:null;const result={data:error?null:single?structuredClone(rows[0]??null):structuredClone(rows),error};if(__financeScope.hold)return new Promise(done=>__financeScope.held.push(()=>done(result))).then(resolve,reject);return Promise.resolve(result).then(resolve,reject);}};return q;};
  S.client.rpc=async(name,args)=>{if(name==='zc_write_dataset'&&['finance','finance_limits','prestock'].includes(args.p_dataset)){const row=__financeScope.rows.find(row=>row.company_id===args.p_company&&row.dataset===args.p_dataset&&row.owner_id===args.p_owner);if(args.p_company!==S.company.id||!row||args.p_expected!==row.revision)return{data:null,error:{code:'CONFLICT',message:'CONFLICT'}};__financeScope.writes.push(structuredClone(args));row.payload=structuredClone(args.p_payload);row.revision++;return{data:row.revision,error:null};}return rpc(name,args);};
  S.queue.clear();S.conflict=false;clearTimeout(S.timer);
 },{financeRows,financeLimits,prestockRows});
 f.answerConfirm(true,/서버에 저장된 데이터로 다시 불러올까요/);await p.evaluate(()=>zc86Cloud.reload());
}
module.exports={hydrateFinance};
