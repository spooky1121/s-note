// Diagnose the upstream limit; do not retry it or impose an application quota.
const MAX_BODY=4096;
function retryAfter(response,now,maximum=3600){
 const value=response.headers?.get('Retry-After')||'';
 if(/^[0-9]{1,10}$/u.test(value))return Math.max(1,Math.min(maximum,Number(value)));
 const at=Date.parse(value);return Number.isFinite(at)?Math.max(1,Math.min(maximum,Math.ceil((at-now)/1000))):20;
}
async function boundedBody(response,signal){
 let reader,timer,abort,finished=false;
 const cancel=()=>{try{void reader?.cancel().catch(()=>{});}catch{}};
 try{
  reader=response.body?.getReader();if(!reader)return '';
  const stop=new Promise(resolve=>{timer=setTimeout(()=>{cancel();resolve('');},500);abort=()=>{cancel();resolve('');};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
  const read=(async()=>{
   const chunks=[];let size=0;
   for(;;){const part=await reader.read();if(part.done){finished=true;break;}size+=part.value.byteLength;if(size>MAX_BODY)return '';chunks.push(part.value);}
   const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}return new TextDecoder().decode(bytes);
  })().catch(()=>'');
  return await Promise.race([read,stop]);
 }catch{return '';}
 finally{clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);if(!finished)cancel();try{reader?.releaseLock();}catch{}}
}
function dailyLimit(text){
 const phrase=/\bBrowser time limit exceeded for today\b/iu;
 try{
  const data=JSON.parse(text),messages=[data?.message,typeof data?.error==='string'?data.error:data?.error?.message];
  if(Array.isArray(data?.errors))for(const item of data.errors.slice(0,8))messages.push(typeof item==='string'?item:item?.message);
  return messages.some(value=>typeof value==='string'&&phrase.test(value));
 }catch{
  // The FAQ documents this exact plain exception rather than a JSON wrapper.
  return /^(?:Unable to create new browser:\s*code:\s*429:\s*message:\s*)?Browser time limit exceeded for today[.!]?$/iu.test(text.trim());
 }
}
export async function browserLimitFailure(response,{signal}={}){
 const text=await boundedBody(response,signal),now=Date.now();
 const daily=response.status===429&&dailyLimit(text),code=daily?'BROWSER_DAILY_LIMIT':'UPSTREAM_RATE_LIMITED';
 const day=new Date(now),reset=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate()+1);
 const seconds=daily?Math.max(Math.ceil((reset-now)/1000),retryAfter(response,now,86400)):retryAfter(response,now);
 return Object.assign(new Error(code),{code,retryAfter:Math.max(1,Math.min(daily?86400:3600,seconds))});
}
