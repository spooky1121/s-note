'use strict';
// Real pages and synthetic accounts. Baseline source is pinned and kept outside
// the repository; no live authentication or business record is contacted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync,spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),ART=process.env.SNOTE_SEARCH_LAYOUT_DIR||'/workspace/work/search-refinement-v2232',BASE=path.join(ART,'baseline'),IS_BASE=process.env.SNOTE_SEARCH_LAYOUT_BASELINE==='1';
const BASE_COMMIT='1891e679c0a1673078049d79cd6735d26c7182c3';
const FILES=['index.html','assets/service-brand.css','assets/service-brand.js','assets/workspace-responsive-shell.css','assets/unified-search.css','assets/unified-search.js','assets/search-focus.js','assets/search-focus.css','assets/workspace-density.css'];
const read=fs.readFileSync;
if(IS_BASE)fs.readFileSync=function(file,...args){if(typeof file==='string'&&file.startsWith(ROOT+path.sep)){const old=path.join(BASE,'source',path.relative(ROOT,file));if(fs.existsSync(old))return read(old,...args);}return read(file,...args);};
const {chromium}=require('./encar/node_modules/playwright'),{setup}=require('./unified-search-v2228.browser.cjs');
const OUT=path.join(ART,IS_BASE?'baseline':'qa');fs.mkdirSync(OUT,{recursive:true});
const results=[];
const hashes=()=>Object.fromEntries(FILES.map(name=>[name,crypto.createHash('sha256').update(read(path.join(ROOT,name))).digest('hex')]));
async function settle(p){await p.evaluate(()=>document.fonts.ready);await p.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});}
function ensureBaseline(){
 if(IS_BASE||fs.existsSync(path.join(BASE,'results.json')))return;
 for(const name of FILES){const file=path.join(BASE,'source',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,execFileSync('git',['show',BASE_COMMIT+':'+name],{cwd:ROOT,maxBuffer:16*1024*1024}));}
 const r=spawnSync(process.execPath,[__filename],{cwd:ROOT,env:{...process.env,SNOTE_SEARCH_LAYOUT_BASELINE:'1'},stdio:'inherit'});if(r.error)throw r.error;assert.equal(r.status,0,'Pinned baseline capture succeeds');
}
async function measure(p,width){return p.evaluate(width=>{
 const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
 const side=document.querySelector(width<=760?'#mobile-drawer':'#snote-app>.sidebar'),brand=side.querySelector(width<=760?'.mobile-drawer-brand':'.brand'),slot=brand.querySelector('[data-snote-service-brand]'),img=slot.querySelector('img'),form=document.querySelector('#snote-global-search'),style=getComputedStyle(form);
 return{width,viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,sidebar:rect(side),brand:rect(brand),slot:rect(slot),image:rect(img),logo:{src:img.currentSrc||img.src,natural:[img.naturalWidth,img.naturalHeight],state:slot.dataset.snoteBrandState,objectFit:getComputedStyle(img).objectFit,opacity:getComputedStyle(img).opacity},nav:rect(side.querySelector('nav')),tagline:brand.innerText,header:rect(form.closest('.topbar')),title:rect(document.querySelector('.topbar-left')),form:rect(form),formStyle:{borderColor:style.borderColor,backgroundColor:style.backgroundColor,boxShadow:style.boxShadow},popover:form.matches(':popover-open'),vv:{height:visualViewport.height,width:visualViewport.width,top:visualViewport.offsetTop,left:visualViewport.offsetLeft},results:rect(document.querySelector('#snote-global-results'))};
 },width);}
function compareBox(a,b,label){for(const k of ['x','y','width','height'])assert(Math.abs(a[k]-b[k])<1,label+' stable '+k);}
async function run(browser,width){const f=await setup(browser,width),p=f.page;try{
 await settle(p);if(width<=760){await p.evaluate(()=>openMobileDrawer());await settle(p);}
 const menu=await measure(p,width);await p.screenshot({path:path.join(OUT,'menu-'+width+'.png')});
 if(!IS_BASE){const old=JSON.parse(read(path.join(BASE,'results.json'),'utf8')).results.find(row=>row.width===width);assert(old,'Pinned viewport baseline exists');assert(!/중고차\s*매매\s*관리\s*시스템/.test(menu.tagline),'Menu tagline removed');assert(menu.logo.natural.every(n=>n>0));assert.equal(menu.logo.objectFit,'contain');assert.equal(menu.logo.state,'ready');assert.equal(menu.logo.opacity,'1');assert(menu.image.x>=menu.slot.x-.5&&menu.image.right<=menu.slot.right+.5,'Full logo stays inside its reserved slot');for(const part of ['sidebar','slot','image'])for(const dimension of ['width','height'])if(part!=='sidebar'||dimension==='width')assert(Math.abs(menu[part][dimension]-old.menu[part][dimension])<.8,'Existing '+part+' '+dimension+' remains unchanged');}
 if(width<=760)await p.evaluate(()=>closeMobileDrawer());await settle(p);const closed=await measure(p,width);await p.screenshot({path:path.join(OUT,'closed-'+width+'.png')});
 assert(closed.pageWidth<=width+1,'Header causes no horizontal overflow');assert(closed.form.x>=0&&closed.form.right<=width+1&&closed.form.width>150,'Search fits the header');if(!IS_BASE){const old=JSON.parse(read(path.join(BASE,'results.json'),'utf8')).results.find(row=>row.width===width);compareBox(closed.form,old.closed.form,'Original header search');}
 await p.locator('#snote-global-query').fill('BMW');
 if(IS_BASE)await p.locator('#snote-global-search [type=submit]').click();
 await p.waitForFunction(()=>{const f=document.querySelector('#snote-global-search'),r=document.querySelector('#snote-global-results');return !f.hasAttribute('aria-busy')&&!r.hidden&&r.getAttribute('aria-busy')!=='true'&&r.innerText.includes('BMW iX3');});await settle(p);
 const focused=await measure(p,width);assert(focused.popover,'Search results use the existing focused popover');assert(focused.form.x>=11&&focused.form.right<=width-11,'Dropdown fits viewport');compareBox(focused.header,closed.header,'Header');compareBox(focused.title,closed.title,'Title');
 assert.equal(await p.locator('#snote-global-query').inputValue(),'BMW');assert.match(await p.locator('#snote-global-results').innerText(),/BMW iX3/);await p.screenshot({path:path.join(OUT,'results-'+width+'.png')});
 await p.keyboard.press('Escape');assert.equal(await p.locator('#snote-global-search').evaluate(e=>e.matches(':popover-open')),false);const after=await measure(p,width);compareBox(after.form,closed.form,'Closed search');
 const value={width,menu,closed,focused,after};results.push(value);console.log((IS_BASE?'BASE ':'PASS ')+'logo/search layout '+width);await f.close();
 }catch(e){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png')}).catch(()=>{});await p.context().close();throw e;}}
async function keyboardViewport(browser){const f=await setup(browser,390),p=f.page;try{
 await p.evaluate(()=>{
  const base=cars[0],owner=currentUser.username;
  cars.splice(0,cars.length,...Array.from({length:35},(_,i)=>({...base,id:'synthetic-vv-'+i,ownerId:owner,model:'가상 차량 '+i,plate:'가상'+i,status:'판매중'})));
  Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>320});visualViewport.dispatchEvent(new Event('resize'));
 });
 await p.locator('#snote-global-query').fill('가상');await p.waitForFunction(()=>{const f=document.querySelector('#snote-global-search'),r=document.querySelector('#snote-global-results');return !f.hasAttribute('aria-busy')&&!r.hidden&&r.getAttribute('aria-busy')!=='true'&&r.querySelectorAll('[data-unified-result]').length>=25;});await settle(p);
 const value=await measure(p,390),scroll=await p.locator('#snote-global-results').evaluate(e=>({client:e.clientHeight,scroll:e.scrollHeight}));
 assert.equal(value.vv.height,320,'Synthetic keyboard narrows only the visual viewport');assert(value.form.y>=11&&value.form.bottom<=value.vv.height-11,'Search and dropdown stay above a simulated keyboard');assert(scroll.client>40&&scroll.scroll>scroll.client,'Long results scroll within the available visible area');
 const edit=await p.locator('#snote-global-query').boundingBox();assert(edit.y>=12&&edit.y+edit.height<320,'Search input remains editable above the keyboard');await p.screenshot({path:path.join(OUT,'visual-viewport-keyboard-390.png')});
 results.push({kind:'simulated keyboard visualViewport 320px',value,scroll});await p.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});await p.keyboard.press('Escape');await f.close();console.log('PASS simulated visualViewport keyboard, visible input and scrolling results');
 }catch(e){await p.screenshot({path:path.join(OUT,'failure-keyboard.png')}).catch(()=>{});await p.context().close();throw e;}}
if(require.main===module)(async()=>{ensureBaseline();const before=hashes(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});try{for(const width of [1440,1024,850,390,360])await run(browser,width);if(!IS_BASE)await keyboardViewport(browser);const after=hashes();assert.deepEqual(after,before,'Product sources stay frozen during QA');fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({ok:true,baseline:IS_BASE,syntheticOnly:true,operatingWrites:0,sourceHashes:after,sourceChangedDuringRun:false,artworkHash:crypto.createHash('sha256').update(read(path.join(ROOT,'assets/snote-brand.png'))).digest('hex'),results},null,2)+'\n');}finally{await browser.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
module.exports={measure};
