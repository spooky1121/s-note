'use strict';
// Actual UI projection; synthetic verified staff and manually saved records only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../assets/accountant-information.js'),'utf8'),marker=' window.SnoteAccountantInformation=Object.freeze';
assert.equal(source.split(marker).length,2,'The module has exactly one API boundary');
const window={addEventListener(){},dispatchEvent(){}};
vm.runInNewContext(source.replace(marker,' window.__contactProjection=contactProjection;\n'+marker),{window,Event:class Event{}});
const project=window.__contactProjection,plain=value=>JSON.parse(JSON.stringify(value));
const employee=(name='가상 딜러',phone='010-0000-0001',role='dealer')=>({name,phone,role});
const manual=(overrides={})=>({id:'11111111-1111-4111-8111-111111111111',name:'가상 정비소',phone:'02-000-0001',groupId:'22222222-2222-4222-8222-222222222222',memo:'방문 전 연락',revision:2,...overrides});

test('verified employees appear read-only before saved contacts without mutating either source',()=>{
 const staff={ready:true,members:[employee(),employee('가상 경리','02-000-0002','accountant'),employee('가상 관리자','02-000-0003','admin')]},saved=[manual()],before=JSON.stringify({staff,saved}),result=project(saved,staff);
 assert.equal(result.ready,true);assert.equal(result.rows.length,4);assert.deepEqual(plain(result.rows.slice(0,3).map(row=>[row.name,row.source,row.readonly,row.groupName])),[['가상 딜러','staff',true,'직원'],['가상 경리','staff',true,'직원'],['가상 관리자','staff',true,'직원']]);assert.equal(result.rows[3].source,'manual');assert.equal(result.rows[3].readonly,false);assert.equal(result.rows[3].memo,saved[0].memo);assert.equal(result.rows[3].groupId,saved[0].groupId);assert.equal(JSON.stringify({staff,saved}),before);
});
test('shared phone numbers never merge employee identities or discard a saved memo and group',()=>{
 const phone='02-000-0000',saved=manual({phone,memo:'별도로 보관한 가상 메모'}),result=project([saved],{ready:true,members:[employee('가상 딜러 A',phone),employee('가상 딜러 B',phone)]});
 assert.equal(result.rows.length,3);assert.equal(new Set(result.rows.map(row=>row.id)).size,3);assert(result.rows.every(row=>row.phone===phone));assert.equal(result.rows[2].memo,saved.memo);assert.equal(result.rows[2].groupId,saved.groupId);assert.equal(result.rows[2].revision,2);
});
test('unverified, failed or malformed staff snapshots cannot publish a merged list',()=>{
 for(const staff of[null,undefined,{ready:false,members:[employee()]},{ready:true},{ready:true,members:null}]){const result=project([manual()],staff);assert.equal(result.ready,false);assert.deepEqual(plain(result.rows),[]);}
});
test('empty verified staff keeps manual contacts and missing phones remain explicit empty values',()=>{
 const saved=manual();assert.deepEqual(plain(project([saved],{ready:true,members:[]}).rows),[{...saved,source:'manual',readonly:false}]);const result=project([],{ready:true,members:[employee('  ','','dealer'),employee(' 이름 ',null,'accountant')]});assert.equal(result.rows[0].name,'이름 미등록');assert.equal(result.rows[0].phone,'');assert.equal(result.rows[1].name,'이름');assert.equal(result.rows[1].phone,'');
});
test('only supported current-company staff roles are accepted and unknown fields are not forwarded',()=>{
 const result=project([],{ready:true,members:[null,{},employee('다른 역할','010-0000-0000','operator'),{...employee(),email:'do-not-forward@example.invalid',companyId:'not-forwarded',accessToken:'not-forwarded'}]});assert.equal(result.rows.length,1);for(const key of['email','companyId','accessToken'])assert.equal(Object.hasOwn(result.rows[0],key),false);
});
