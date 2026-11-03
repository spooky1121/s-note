/* Server-only SOLAPI transport. No automatic retries of chargeable requests. */
export const MMS_LIMIT=190000;
export async function sha(value){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function solapi(config,path,body){
 const date=new Date().toISOString(),salt=crypto.randomUUID().replaceAll('-','');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(config.secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(date+salt)))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{const response=await fetch('https://api.solapi.com/'+path,{method:body===undefined?'GET':'POST',redirect:'manual',cache:'no-store',headers:{Authorization:`HMAC-SHA256 apiKey=${config.key}, date=${date}, salt=${salt}, signature=${signature}`,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});
  if(response.status>=300&&response.status<400)throw Error('UPSTREAM');
  const reader=response.body?.getReader();if(!reader)throw Error('UPSTREAM');let size=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>512*1024){void reader.cancel();throw Error('UPSTREAM');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error('UPSTREAM');}return{ok:response.ok,status:response.status,data};
 }finally{clearTimeout(timer);}
}
export function jpeg(base64){
 if(typeof base64!=='string'||base64.length>Math.ceil(MMS_LIMIT/3)*4||base64.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))return false;
 let raw;try{raw=atob(base64);}catch{return false;}if(raw.length<20||raw.length>MMS_LIMIT||raw.charCodeAt(0)!==255||raw.charCodeAt(1)!==216||raw.charCodeAt(raw.length-2)!==255||raw.charCodeAt(raw.length-1)!==217)return false;
 let pos=2,dimensions=false;while(pos+3<raw.length){if(raw.charCodeAt(pos++)!==255)return false;let marker=raw.charCodeAt(pos++);while(marker===255&&pos<raw.length)marker=raw.charCodeAt(pos++);if(marker===218)break;if(marker===217)break;const size=raw.charCodeAt(pos)*256+raw.charCodeAt(pos+1);if(size<2||pos+size>raw.length)return false;if([192,193,194].includes(marker)){if(size<8)return false;const h=raw.charCodeAt(pos+3)*256+raw.charCodeAt(pos+4),w=raw.charCodeAt(pos+5)*256+raw.charCodeAt(pos+6);if(!w||!h||w>2000||h>2000)return false;dimensions=true;}pos+=size;}return dimensions;
}
