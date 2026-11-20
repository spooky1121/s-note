import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Actual profile application and quote-prefill code; only synthetic accounts.
const source=fs.readFileSync(process.env.SNOTE_QUOTE_CONTACT_SOURCE||new URL('../index.html',import.meta.url),'utf8');
const apply=source.slice(source.indexOf('function snoteProfileApply(context,profile){'),source.indexOf('\nfunction snoteProfileAvatarPath('));
const start=source.indexOf(' const quoteDealerAccount=dealerAccounts.find('),end=source.indexOf("\n $('quote-stamp').value=",start);
assert(start>=0&&end>start,'The actual quote must provide the assigned dealer contact');
const prefill='function prefill(c){'+source.slice(start,end)+'\n}';
function fixture(role='dealer'){
 const nodes=new Map(),actor={username:'own',name:'합성 담당자',company:'합성 상사',phone:'01011112222',role};
 const context={userId:'own',companyId:'synthetic-company',actor};
 const S={members:[{user_id:'own',company_id:context.companyId,phone:'01011112222'},{user_id:'other',company_id:context.companyId,phone:'01033334444'}],company:{name:'합성 상사'}};
 const accounts=[{username:'own',name:actor.name,phone:actor.phone},{username:'other',name:'다른 합성 담당자',phone:'01033334444'}];
 const get=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',value:''});return nodes.get(id);};
 const sandbox={S,currentUser:actor,dealerAccounts:accounts,ownerAlias:id=>id,byId:get,$:get,
  snoteProfileAssert(ctx){assert.equal(ctx,context);assert.equal(ctx.actor,actor);},
  snoteProfileCheck(ctx,profile){assert.equal(profile.user_id,ctx.userId);assert.equal(profile.company_id,ctx.companyId);},
  snoteProfilePaintAvatar(){},snote95UpdateDocumentCompany(){}};
 vm.createContext(sandbox);vm.runInContext(apply+'\n'+prefill,sandbox);
 return{S,accounts,actor,context,get,apply(phone){sandbox.snoteProfileApply(context,{user_id:context.userId,company_id:context.companyId,company_name:'합성 상사',display_name:'새 합성 담당자',role,phone});},prefill(ownerId){sandbox.prefill({ownerId});return get('quote-dealer-phone').value;}};
}
test('a verified own profile contact is immediately used by a new quote without a reload',()=>{
 const f=fixture();assert.equal(f.prefill('own'),'010-1111-2222');f.apply('01055556666');
 assert.equal(f.prefill('own'),'010-5555-6666');assert.equal(f.S.members[0].phone,'01055556666');assert.equal(f.accounts[0].phone,'01055556666');
 assert.equal(f.S.members[1].phone,'01033334444');assert.equal(f.accounts[1].phone,'01033334444');
});
test('an administrator quote uses the selected owner contact and never the administrator fallback',()=>{
 const f=fixture('admin');f.apply('01055556666');assert.equal(f.prefill('other'),'010-3333-4444');assert.equal(f.prefill('missing'),'');
 f.accounts[1].phone='0212345678';assert.equal(f.prefill('other'),'','A corporate landline is not a registered mobile contact');
});
test('contact refresh does not overwrite a phone manually entered into the open quotation',()=>{
 const f=fixture();f.prefill('own');f.get('quote-dealer-phone').value='010-7777-8888';f.apply('01055556666');
 assert.equal(f.get('quote-dealer-phone').value,'010-7777-8888');assert.equal(f.prefill('own'),'010-5555-6666');
});
test('an explicit empty registered contact clears stale cache while missing profile fields preserve it',()=>{
 const f=fixture();f.apply(undefined);assert.equal(f.prefill('own'),'010-1111-2222');f.apply('');assert.equal(f.prefill('own'),'');
});
