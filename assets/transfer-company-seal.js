/* Print-only rendering of the currently verified company image. No storage or cache. */
(()=>{'use strict';
 if(window.SnoteTransferCompanySeal)return;
 const MIN_EDGE=2048,MAX_EDGE=4096,MAX_PIXELS=8000000,MAX_SOURCE_EDGE=16384,MAX_SOURCE_PIXELS=64000000;
 const unavailable=()=>Object.assign(Error('COMPANY_STAMP_UNAVAILABLE'),{code:'COMPANY_STAMP_UNAVAILABLE'});
 const clamp=(value,minimum,maximum)=>Math.max(minimum,Math.min(maximum,value));
 function create(source){
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
   const red=data[offset],green=data[offset+1],blue=data[offset+2],minimum=Math.min(red,green,blue),maximum=Math.max(red,green,blue);
   if(minimum>=242)continue;
   let coverage=(255-minimum)/255;
   // Remove a near-white paper cast while keeping faint coloured stamp ink.
   if(minimum>215&&maximum-minimum<18){const paper=(minimum-215)/27;coverage*=Math.pow(1-paper,2);}
   const highlight=1-coverage;
   data[offset]=Math.round(184+22*highlight);
   data[offset+1]=Math.round(32+16*highlight);
   data[offset+2]=Math.round(81+23*highlight);
   alpha[pixel]=Math.round(sourceAlpha*coverage*.79);if(alpha[pixel])inkPixels++;
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
   data[pixel*4+3]=clamp(Math.round(center+.4*(center-surrounding)),0,255);
  }
  ctx.putImageData(pixels,0,0);
  const image=canvas.toDataURL('image/png');if(!image.startsWith('data:image/png;base64,'))throw unavailable();
  return Object.freeze({image,width,height,sourceWidth,sourceHeight,scale:width/sourceWidth,style:'registered-red-ink'});
 }
 window.SnoteTransferCompanySeal=Object.freeze({create});
})();
