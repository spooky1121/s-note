/* Current-name print artwork only. No storage, network, signatures or consent state. */
(()=>{'use strict';
 if(window.SnoteTransferNameSeal)return;
 const WIDTH=384,HEIGHT=600,FONT='"Noto Serif KR","Noto Serif CJK KR","Batang","바탕",serif';
 function normalize(value){
  const name=String(value||'').trim().replace(/\s+/g,' ');
  if(!name||name.length>100||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(name))throw Error('NAME_SEAL_UNAVAILABLE');
  return name;
 }
 function randomFor(name){
  let state=2166136261;
  for(const char of name){state^=char.codePointAt(0);state=Math.imul(state,16777619);}
  state>>>=0;if(!state)state=0x6d2b79f5;
  return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};
 }
 function outline(ctx,rx,ry,width,random){
  ctx.beginPath();
  for(let step=0;step<=160;step++){
   const angle=step/160*Math.PI*2,wobble=(random()-.5)*1.7;
   const x=Math.cos(angle)*(rx+wobble),y=Math.sin(angle)*(ry+wobble);
   if(step===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  }
  ctx.closePath();ctx.lineWidth=width;ctx.stroke();
 }
 function letters(ctx,name){
  const chars=typeof Intl.Segmenter==='function'?Array.from(new Intl.Segmenter('ko',{granularity:'grapheme'}).segment(name),part=>part.segment):Array.from(name);
  ctx.textAlign='center';ctx.textBaseline='middle';
  if(chars.length<=4&&!name.includes(' ')){
   const size=chars.length===1?187:chars.length===2?163:chars.length===3?135:107;
   const step=chars.length===2?190:chars.length===3?142:chars.length===4?110:0;
   ctx.font='700 '+size+'px '+FONT;
   ctx.save();ctx.scale(chars.length===1?1.1:1.38,1);
   chars.forEach((char,index)=>ctx.fillText(char,0,(index-(chars.length-1)/2)*step));
   ctx.restore();return;
  }
  // Longer registered names retain every grapheme rather than substituting initials.
  let size=94,lines=[];
  for(;size>=8;size-=2){
   ctx.font='700 '+size+'px '+FONT;lines=[];let line='';
   for(const char of chars){if(line&&ctx.measureText(line+char).width>247){lines.push(line);line=char;}else line+=char;}
   if(line)lines.push(line);
   if(lines.length*size*1.17<=418)break;
  }
  const step=size*1.17;
  lines.forEach((line,index)=>ctx.fillText(line,0,(index-(lines.length-1)/2)*step));
 }
 function create(value){
  const name=normalize(value),canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('NAME_SEAL_UNAVAILABLE');
  const random=randomFor(name);
  ctx.save();ctx.translate(WIDTH/2,HEIGHT/2);ctx.rotate(-.052);
  ctx.strokeStyle='#b22643';ctx.fillStyle='#ad1f3a';ctx.lineJoin='round';
  outline(ctx,163,267,10.5,random);outline(ctx,151,254,3.8,random);
  ctx.save();ctx.beginPath();ctx.ellipse(0,0,142,243,0,0,Math.PI*2);ctx.clip();letters(ctx,name);ctx.restore();ctx.restore();
  // Four broad, gently faded pressure marks sit beneath the small paper grain.
  // A separate seed keeps the original lettering and fine texture in place.
  const pressureRandom=randomFor(name+'\u241fpressure'),patches=[[104,164],[278,282],[129,444],[282,88]].map(([x,y])=>({x:x+(pressureRandom()-.5)*44,y:y+(pressureRandom()-.5)*40,rx:42+pressureRandom()*24,ry:50+pressureRandom()*28,depth:.13+pressureRandom()*.06}));
  const pixels=ctx.getImageData(0,0,WIDTH,HEIGHT),data=pixels.data,mask=new Uint8ClampedArray(data);
  for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
   const i=(y*WIDTH+x)*4;if(!data[i+3])continue;
   const grain=random(),broad=Math.sin(x*.017+y*.009),paper=Math.sin(x*.061-y*.038),rose=(1+Math.sin(x*.014-y*.011))*.125;
   data[i]=Math.round(173+rose*46+broad*4);data[i+1]=Math.round(28+rose*35+grain*3);data[i+2]=Math.round(55+rose*63+broad*5);
   let impression=.98;
   for(const patch of patches){const dx=(x-patch.x)/patch.rx,dy=(y-patch.y)/patch.ry;impression*=1-patch.depth*Math.exp(-.5*(dx*dx+dy*dy));}
   const pressure=.735+.075*broad+.025*paper+.045*grain;
   data[i+3]=Math.round(data[i+3]*pressure*impression*(grain<.024?.22:1));
  }
  // A one-pixel, low-alpha fringe suggests ink absorbed by paper. It does not
  // redraw or displace a glyph, and cannot fill the grain cut into real strokes.
  for(let y=1;y<HEIGHT-1;y++)for(let x=1;x<WIDTH-1;x++){
   const i=(y*WIDTH+x)*4;if(mask[i+3])continue;
   const near=Math.max(mask[i-1],mask[i+7],mask[i-WIDTH*4+3],mask[i+WIDTH*4+3]);
   if(near<64)continue;
   data[i]=187;data[i+1]=42;data[i+2]=76;data[i+3]=Math.round(near*.043);
  }
  ctx.putImageData(pixels,0,0);ctx.globalCompositeOperation='destination-out';
  for(let n=0;n<760;n++){
   const x=25+random()*(WIDTH-50),y=22+random()*(HEIGHT-44),radius=.35+random()*1.2;
   ctx.globalAlpha=.25+random()*.6;ctx.beginPath();ctx.ellipse(x,y,radius,radius*(.55+random()),random()*Math.PI,0,Math.PI*2);ctx.fill();
  }
  ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
  // A half-pixel ink edge suggests absorption into paper while retaining the
  // full name and the intentional small gaps in its impression.
  const softened=ctx.getImageData(0,0,WIDTH,HEIGHT),softData=softened.data,originalAlpha=new Uint8Array(WIDTH*HEIGHT),horizontal=new Float32Array(WIDTH*HEIGHT),side=.1065,center=1-side*2;
  for(let pixel=0;pixel<originalAlpha.length;pixel++)originalAlpha[pixel]=softData[pixel*4+3];
  for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){const pixel=y*WIDTH+x;horizontal[pixel]=originalAlpha[pixel]*center+(x?originalAlpha[pixel-1]:0)*side+(x+1<WIDTH?originalAlpha[pixel+1]:0)*side;}
  for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
   const pixel=y*WIDTH+x,i=pixel*4,alpha=Math.round(horizontal[pixel]*center+(y?horizontal[pixel-WIDTH]:0)*side+(y+1<HEIGHT?horizontal[pixel+WIDTH]:0)*side);
   if(alpha&&!originalAlpha[pixel]){softData[i]=187;softData[i+1]=42;softData[i+2]=76;}
   softData[i+3]=alpha;
  }
  ctx.putImageData(softened,0,0);
  const image=canvas.toDataURL('image/png');if(!image.startsWith('data:image/png;base64,'))throw Error('NAME_SEAL_UNAVAILABLE');
  return Object.freeze({name,image,width:WIDTH,height:HEIGHT,style:'oval-ink'});
 }
 window.SnoteTransferNameSeal=Object.freeze({create});
})();
