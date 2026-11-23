'use strict';
// Synthetic, renderer-only canvas probe: no accounts, requests or persisted images.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
 try{
  const page=await browser.newPage();await page.route('**/*',route=>route.abort());
  if(process.env.COMPANY_SEAL_BASELINE_PATH){await page.addScriptTag({content:fs.readFileSync(process.env.COMPANY_SEAL_BASELINE_PATH,'utf8')});await page.evaluate(()=>{window.__baselineCompanySeal=window.SnoteTransferCompanySeal;delete window.SnoteTransferCompanySeal;});}
  await page.addScriptTag({path:path.join(__dirname,'../assets/transfer-company-seal.js')});
  const result=await page.evaluate(async()=>{
   const renderer=window.SnoteTransferCompanySeal,canvas=document.createElement('canvas');canvas.width=384;canvas.height=384;
   const context=canvas.getContext('2d');context.strokeStyle='#b92333';context.lineWidth=17;context.strokeRect(18,18,348,348);
   // Original full-width and hairline strokes test broad pressure and edge support.
   context.fillStyle='#b92333';for(let y=56;y<340;y+=39){context.fillRect(48,y,288,13);context.fillRect(48,y+20,288,2);}
   context.fillStyle='rgba(185,35,51,.5)';context.fillRect(8,150,8,110);
   const normal=renderer.create(canvas),office=renderer.create(canvas,{office:true}),repeat=renderer.create(canvas,{office:true}),after=renderer.create(canvas);
   const imagePixels=async rendition=>{const image=new Image();image.src=rendition.image;await image.decode();const output=document.createElement('canvas');output.width=rendition.width;output.height=rendition.height;const c=output.getContext('2d',{willReadFrequently:true});c.drawImage(image,0,0);return c.getImageData(0,0,output.width,output.height).data;};
   const before=await imagePixels(normal),afterPixels=await imagePixels(office),ratios=[],tiles=Array.from({length:64},()=>({before:0,after:0,count:0}));
   let invented=0,lost=0,darker=0,strong=0,warm=0,colorPixels=0,visible=0,deep=0,high=0;
   for(let i=0;i<before.length;i+=4){const a=before[i+3],b=afterPixels[i+3],pixel=i/4,x=pixel%normal.width,y=Math.floor(pixel/normal.width);if(b&&!a)invented++;if(a&&!b)lost++;if(b>a)darker++;if(!b)continue;visible++;if(b>100){colorPixels++;if(Math.abs(afterPixels[i]-220)<=3&&Math.abs(afterPixels[i+1]-55)<=3&&Math.abs(afterPixels[i+2]-34)<=3)warm++;}
    if(a>=128){strong++;const ratio=b/a;if(ratio<.5)deep++;if(ratio>.85)high++;if(pixel%17===0)ratios.push(ratio);const tile=tiles[Math.floor(y/normal.height*8)*8+Math.floor(x/normal.width*8)];tile.before+=a;tile.after+=b;tile.count++;}
   }
   ratios.sort((a,b)=>a-b);const quantile=p=>ratios[Math.floor((ratios.length-1)*p)],tileMeans=tiles.filter(t=>t.count>100).map(t=>t.after/t.before);
   const baseline=window.__baselineCompanySeal?.create(canvas);
   const errors=[];for(const source of [null,{width:0,height:10},{width:16385,height:10},{width:8001,height:8000},{width:10,height:10,complete:false}]){try{renderer.create(source,{office:true});errors.push(false);}catch(e){errors.push(e.code==='COMPANY_STAMP_UNAVAILABLE');}}
   const blank=document.createElement('canvas');blank.width=blank.height=1;try{renderer.create(blank,{office:true});errors.push(false);}catch(e){errors.push(e.code==='COMPANY_STAMP_UNAVAILABLE');}
   return{defaultByteEqual:!baseline||baseline.image===normal.image,baselineCompared:!!baseline,defaultAfterOffice:normal.image===after.image,falseUnchanged:normal.image===renderer.create(canvas,{office:false}).image,nullUnchanged:normal.image===renderer.create(canvas,null).image,deterministic:office.image===repeat.image,distinct:office.image!==normal.image,frozen:Object.isFrozen(office),style:office.style,normalStyle:normal.style,dimensions:[office.width,office.height,office.sourceWidth,office.sourceHeight],invented,lost,darker,strong,warmFraction:warm/colorPixels,visible,deepFraction:deep/strong,highFraction:high/strong,ratio:{p01:quantile(.01),p10:quantile(.1),p50:quantile(.5),p90:quantile(.9),p99:quantile(.99)},tileRatio:{min:Math.min(...tileMeans),max:Math.max(...tileMeans)},errors};
  });
  assert(result.defaultByteEqual&&result.defaultAfterOffice&&result.falseUnchanged&&result.nullUnchanged,'The default round rendition is byte-identical, including after an office render');
  assert(result.deterministic&&result.distinct&&result.frozen,'Office pressure texture is deterministic and independently identifiable');assert.equal(result.style,'registered-office-pressure-ink');assert.equal(result.normalStyle,'registered-red-ink');
  assert.deepEqual(result.dimensions,[2048,2048,384,384]);assert.equal(result.invented,0);assert.equal(result.lost,0);assert.equal(result.darker,0);assert(result.strong>10000);assert(result.warmFraction>.99,'Office ink retains warm #dc3722 RGB within canvas rounding');
  assert(result.ratio.p01>.35&&result.ratio.p50>.6&&result.ratio.p50<.85,'Faint regions preserve readable glyph coverage while the typical ink is gently faded');
  assert(result.ratio.p90-result.ratio.p10>.15&&result.deepFraction>.005&&result.highFraction>.005,'Both weak pressure patches and stronger ink survive');
  assert(result.tileRatio.max-result.tileRatio.min>.12,'Fading has visible broad spatial variation');assert(result.errors.every(Boolean),'Invalid, unavailable and blank sources retain fail-closed guards');
  console.log(JSON.stringify({passed:true,syntheticOnly:true,...result},null,2));
 }finally{await browser.close();}
}
if(require.main===module)main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
