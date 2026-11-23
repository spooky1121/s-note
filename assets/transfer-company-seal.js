/* Print-only rendering of the currently verified company image. No storage or cache. */
(()=>{'use strict';
 if(window.SnoteTransferCompanySeal)return;
 const MIN_EDGE=2048,MAX_EDGE=4096,MAX_PIXELS=8000000,MAX_SOURCE_EDGE=16384,MAX_SOURCE_PIXELS=64000000,INK=[220,55,34];
 const unavailable=()=>Object.assign(Error('COMPANY_STAMP_UNAVAILABLE'),{code:'COMPANY_STAMP_UNAVAILABLE'});
 const clamp=(value,minimum,maximum)=>Math.max(minimum,Math.min(maximum,value));
 // Smooth, deterministic pressure fields are measured in proportions of the
 // registered image, so their patches retain the same size when printed.
 function pressureField(width,height,cells,seed){
  const stride=cells+1,values=new Float32Array(stride*stride);
  for(let i=0;i<values.length;i++){let hash=Math.imul(i+seed,0x45d9f3b);hash=Math.imul(hash^(hash>>>16),0x45d9f3b);values[i]=((hash^(hash>>>16))>>>0)/4294967295;}
  const axis=(length)=>{const index=new Uint16Array(length),weight=new Float32Array(length);for(let i=0;i<length;i++){const position=(i+.5)/length*cells,cell=Math.floor(position),fraction=position-cell;index[i]=cell;weight[i]=fraction*fraction*(3-2*fraction);}return{index,weight};};
  return{stride,values,x:axis(width),y:axis(height)};
 }
 function pressureAt(field,x,y){
  const row=field.y.index[y]*field.stride+field.x.index[x],horizontal=field.x.weight[x],vertical=field.y.weight[y],values=field.values;
  const above=values[row]+(values[row+1]-values[row])*horizontal,below=values[row+field.stride]+(values[row+field.stride+1]-values[row+field.stride])*horizontal;
  return above+(below-above)*vertical;
 }
 function create(source,options){
  const sourceWidth=Number(source?.naturalWidth??source?.width),sourceHeight=Number(source?.naturalHeight??source?.height);
  if(!Number.isSafeInteger(sourceWidth)||!Number.isSafeInteger(sourceHeight)||sourceWidth<1||sourceHeight<1||sourceWidth>MAX_SOURCE_EDGE||sourceHeight>MAX_SOURCE_EDGE||sourceWidth*sourceHeight>MAX_SOURCE_PIXELS||source?.complete===false)throw unavailable();
  const longest=Math.max(sourceWidth,sourceHeight),edge=Math.min(MAX_EDGE,Math.max(MIN_EDGE,longest));
  let scale=edge/longest;
  if(sourceWidth*sourceHeight*scale*scale>MAX_PIXELS)scale=Math.sqrt(MAX_PIXELS/(sourceWidth*sourceHeight));
  let width=Math.max(1,Math.round(sourceWidth*scale)),height=Math.max(1,Math.round(sourceHeight*scale));
  if(width*height>MAX_PIXELS){const correction=Math.sqrt(MAX_PIXELS/(width*height));width=Math.max(1,Math.floor(width*correction));height=Math.max(1,Math.floor(height*correction));}
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw unavailable();
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  let pixels;
  try{ctx.drawImage(source,0,0,width,height);pixels=ctx.getImageData(0,0,width,height);}catch(_){throw unavailable();}
  const data=pixels.data,alpha=new Uint8Array(width*height);let inkPixels=0;
  for(let pixel=0;pixel<alpha.length;pixel++){
   const offset=pixel*4,sourceAlpha=data[offset+3];if(!sourceAlpha)continue;
   const red=data[offset],green=data[offset+1],blue=data[offset+2],minimum=Math.min(red,green,blue),maximum=Math.max(red,green,blue),chroma=maximum-minimum;
   if(minimum>=242&&chroma<10)continue;
   let coverage=Math.min(1,(255-minimum)/204);
   // Remove neutral paper without dropping pale coloured strokes. Density is
   // strengthened only where the registered image already contains ink.
   if(minimum>215&&chroma<10){const paper=clamp((minimum-215)/27,0,1);coverage*=Math.pow(1-paper,2);}
   data[offset]=INK[0];data[offset+1]=INK[1];data[offset+2]=INK[2];
   alpha[pixel]=Math.round(sourceAlpha*coverage*.94);if(alpha[pixel])inkPixels++;
  }
  if(!inkPixels)throw unavailable();
  // Match the edge radius to the source enlargement so fine original strokes
  // remain defined on paper. Only existing alpha is sharpened: no characters or
  // opaque pixels are reconstructed outside the registered image's ink.
  const radius=clamp(Math.round(scale*.55),1,24);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const pixel=y*width+x,center=alpha[pixel];if(!center){data[pixel*4+3]=0;continue;}
   const left=Math.max(0,x-radius),right=Math.min(width-1,x+radius),above=Math.max(0,y-radius),below=Math.min(height-1,y+radius);
   const surrounding=(alpha[y*width+left]+alpha[y*width+right]+alpha[above*width+x]+alpha[below*width+x]+alpha[above*width+left]+alpha[above*width+right]+alpha[below*width+left]+alpha[below*width+right])/8;
   data[pixel*4+3]=clamp(Math.round(center+.45*(center-surrounding)),0,data[pixel*4+3]);
  }
  const office=options?.office===true;
  if(office){
   const broad=pressureField(width,height,6,7919),medium=pressureField(width,height,23,15401),fine=pressureField(width,height,160,31337);
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const offset=(y*width+x)*4+3,coverage=data[offset];if(!coverage)continue;
    const pressure=clamp((pressureAt(broad,x,y)-.48)/.44,0,1),weakPatch=pressure*pressure*(3-2*pressure);
    const retained=clamp(.91-.17*pressureAt(medium,x,y)-.08*pressureAt(fine,x,y)-.36*weakPatch,.36,.96);
    // Actual stamping varies the ink within a stroke. Never expand, soften or
    // erase the registered glyphs: even the faintest existing pixel survives.
    data[offset]=Math.max(1,Math.round(coverage*retained));
   }
  }
  ctx.putImageData(pixels,0,0);
  const image=canvas.toDataURL('image/png');if(!image.startsWith('data:image/png;base64,'))throw unavailable();
  return Object.freeze({image,width,height,sourceWidth,sourceHeight,scale:width/sourceWidth,style:office?'registered-office-pressure-ink':'registered-red-ink'});
 }
 window.SnoteTransferCompanySeal=Object.freeze({create});
})();
