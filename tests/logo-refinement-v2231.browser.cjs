'use strict';
// Real service markup and synthetic Auth only. Pixel checks use actual browser
// screenshots, in addition to decoded-image geometry; no production calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync,spawnSync}=require('node:child_process');
const {chromium}=require('./encar/node_modules/playwright');
const ROOT=path.resolve(__dirname,'..'),ART=process.env.SNOTE_LOGO_ARTIFACT_DIR||'/workspace/work/logo-refinement-v2231',BASE=path.join(ART,'baseline'),IS_BASE=process.env.SNOTE_LOGO_BASELINE==='1';
const BASE_COMMIT='b3936b08ea8e3a54b26c1687091c7f5c449cf1cb';
const BASE_FILES=['index.html','assets/service-brand.css','assets/service-brand.js','assets/workspace-responsive-shell.css','assets/workspace-refine.css','assets/workspace-density.css','assets/document-print.css','assets/snote-brand.png','assets/snote-symbol.png'];
const read=fs.readFileSync;
if(IS_BASE)fs.readFileSync=function(file,...args){if(typeof file==='string'&&file.startsWith(ROOT+path.sep)){const old=path.join(BASE,'source',path.relative(ROOT,file));if(fs.existsSync(old))return read(old,...args);}return read(file,...args);};
const {backend,boot,dashboardReady}=require('./normal-login.browser.cjs');
const OUT=path.join(ART,IS_BASE?'baseline':'qa');fs.mkdirSync(OUT,{recursive:true});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function settle(page){await page.evaluate(()=>document.fonts.ready);await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});}
async function capture(page,width){return page.evaluate(async width=>{
 const mobile=width<=760,menu=document.querySelector(mobile?'#mobile-drawer':'#snote-app>.sidebar'),brand=menu.querySelector(mobile?'.mobile-drawer-brand':'.brand'),button=brand.querySelector('.snote-brand-home'),slot=button.querySelector('[data-snote-service-brand]'),img=slot.querySelector('img');
 const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};},b=rect(img),style=getComputedStyle(img);
 const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;let alpha=null,paint=null;
 if(img.complete&&canvas.width&&canvas.height){const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels[(y*canvas.width+x)*4+3]>8){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}alpha={x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1};const scale=Math.min(b.width/canvas.width,b.height/canvas.height),left=b.x+(b.width-canvas.width*scale)/2,top=b.y+(b.height-canvas.height*scale)/2;paint={x:left+alpha.x*scale,y:top+alpha.y*scale,width:alpha.width*scale,height:alpha.height*scale};}
 return{width,mobile,viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,menu:rect(menu),brand:rect(brand),button:rect(button),slot:rect(slot),image:b,paint,alpha,natural:[img.naturalWidth,img.naturalHeight],source:img.currentSrc||img.src,state:slot.dataset.snoteBrandState,opacity:Number(style.opacity),objectFit:style.objectFit,filter:style.filter,description:rect(brand.querySelector(mobile?'small':'.branddesc')),nav:rect(menu.querySelector('nav')),close:rect(menu.querySelector('.mobile-drawer-close')),login:rect(document.querySelector('#zc-cloud-gate .snote-wordmark'))};
 },width);}
async function paintedPixels(page,png,value){return page.evaluate(async({data,box})=>{
 const img=new Image();img.src=data;await img.decode();const ratio=img.naturalWidth/innerWidth,c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const x=Math.max(0,Math.floor(box.x*ratio)),y=Math.max(0,Math.floor(box.y*ratio)),w=Math.min(c.width-x,Math.ceil(box.width*ratio)),h=Math.min(c.height-y,Math.ceil(box.height*ratio));const d=ctx.getImageData(x,y,w,h).data;let blue=0,dark=0;for(let i=0;i<d.length;i+=4){const r=d[i],g=d[i+1],b=d[i+2];if(r<100&&g>80&&b>140)blue++;if(r<90&&g<110&&b<135)dark++;}return{blue,dark,width:w,height:h};
 },{data:'data:image/png;base64,'+png.toString('base64'),box:value.slot});}
function near(a,b,label,tolerance=.8){assert(Math.abs(a-b)<=tolerance,label+': '+JSON.stringify({actual:a,expected:b}));}
function ensureBaseline(){
 if(IS_BASE||fs.existsSync(path.join(BASE,'results.json')))return;
 // Materialize only the relevant original files in the artifact directory.
 // A subprocess keeps the baseline's read override out of the current run.
 const manifest={commit:BASE_COMMIT,files:[]};
 for(const name of BASE_FILES){const body=execFileSync('git',['show',BASE_COMMIT+':'+name],{cwd:ROOT,maxBuffer:16*1024*1024}),target=path.join(BASE,'source',name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,body);manifest.files.push({name,sha256:crypto.createHash('sha256').update(body).digest('hex')});}
 fs.writeFileSync(path.join(BASE,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const result=spawnSync(process.execPath,[__filename],{cwd:ROOT,env:{...process.env,SNOTE_LOGO_BASELINE:'1'},stdio:'inherit'});
 if(result.error)throw result.error;assert.equal(result.status,0,'Synthetic baseline browser run succeeds');
}
function verify(value,old){
 assert(value.natural.every(v=>v>0),'Official logo decodes');assert.equal(value.state,'ready');assert.equal(value.opacity,1);assert.equal(value.objectFit,'contain');assert.equal(value.filter,'none');assert(value.pixels.blue>4,'Actual screenshot contains the blue official symbol');
 if(value.width>1120||value.mobile)assert(value.pixels.dark>4,'Actual screenshot contains the complete dark snote wordmark');
 else assert(/snote-symbol\.png/.test(value.source),'Compact sidebar retains the S symbol');
 assert(value.paint&&old.paint);near(value.paint.width/old.paint.width,.7,'Painted logo is 30% narrower',.015);near(value.paint.height/old.paint.height,.7,'Painted logo is 30% shorter',.015);
 const center=value.mobile?value.brand:value.menu;near(value.paint.x+value.paint.width/2,center.x+center.width/2,'Logo is centered in its menu branding area');near(value.paint.y+value.paint.height/2,value.slot.y+value.slot.height/2,'Logo is vertically centered in the unchanged slot');
 near(value.slot.width,old.slot.width,'Logo slot width unchanged');near(value.slot.height,old.slot.height,'Logo slot height unchanged');near(value.slot.y,old.slot.y,'Logo slot vertical position unchanged');
 for(const key of ['menu','brand','button','nav','description','close']){if(!value[key]||!old[key])continue;for(const field of ['y','width','height'])near(value[key][field],old[key][field],key+' '+field+' remains unchanged');}
 assert(value.paint.x>=value.slot.x-.5&&value.paint.y>=value.slot.y-.5&&value.paint.x+value.paint.width<=value.slot.right+.5&&value.paint.y+value.paint.height<=value.slot.bottom+.5,'Artwork is fully inside the fixed logo slot');
 assert(value.pageWidth<=old.pageWidth+1,'No new horizontal overflow');
}
async function run(browser,width,previous){const f=await boot(browser,backend(),'logo-'+width,{width}),p=f.page;
 try{
  await settle(p);const login=await p.locator('#zc-cloud-gate .snote-wordmark').evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});
  await f.login();await dashboardReady(f);await settle(p);if(width<=760){await p.evaluate(()=>openMobileDrawer());await settle(p);}
  const scope=width<=760?'#mobile-drawer':'#snote-app>.sidebar';await p.waitForFunction(()=>!!window.SnoteServiceBrand);await p.evaluate(async scope=>{SnoteServiceBrand.refresh();await Promise.race([SnoteServiceBrand.whenReady(document.querySelector(scope)),new Promise(r=>setTimeout(r,2000))]);},scope);await delay(190);
  const value=await capture(p,width),png=await p.screenshot({path:path.join(OUT,'sidebar-'+width+'.png')});value.pixels=await paintedPixels(p,png,value);value.login=login;
  if(!IS_BASE){const old=previous.find(row=>row.width===width);assert(old,'Baseline exists');verify(value,old);for(const field of ['x','y','width','height'])near(login[field],old.login[field],'Login logo '+field+' unchanged');}
  fs.writeFileSync(path.join(OUT,'sidebar-'+width+'.json'),JSON.stringify(value,null,2)+'\n');console.log((IS_BASE?'BASE ':'PASS ')+'sidebar '+width+' paint='+JSON.stringify(value.paint)+' pixels='+JSON.stringify(value.pixels));return value;
 }finally{await f.finish();}
}
module.exports={run,capture,paintedPixels};
if(require.main===module)(async()=>{ensureBaseline();const before=['assets/snote-brand.png','assets/snote-symbol.png'].map(n=>[n,crypto.createHash('sha256').update(read(path.join(ROOT,n))).digest('hex')]),previous=IS_BASE?[]:JSON.parse(read(path.join(BASE,'results.json'),'utf8')).results,b=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}),results=[];try{for(const w of [1440,1280,1024,850,390])results.push(await run(b,w,previous));fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({ok:true,baseline:IS_BASE,baselineCommit:BASE_COMMIT,syntheticOnly:true,operatingWrites:0,imageHashes:before,results},null,2)+'\n');}finally{await b.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
