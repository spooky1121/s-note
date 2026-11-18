/* S-NOTE: server-verified Encar links. No seller-account lookup. */
(() => {
  'use strict';
  if (window.SnoteEncarLink) return;

  const ENDPOINT = '/api/encar';
  const CLIENT_RELEASE = '2.137';
  const CACHE_PREFIX = 'snote.encar.candidate.v1:';
  const CACHE_AGE = 7 * 24 * 60 * 60 * 1000;
  const REQUEST_TIMEOUT = 75000;
  const AUTO_PRICE_TIMEOUT = 65000;
  const MAX_RETRY_AFTER_SECONDS = 86400;
  const MAX_AUTO_RETRY_WAIT_SECONDS = 30;
  const RETRY_STATUSES = new Set([429, 502, 503, 504]);
  const ENDPOINTS = new Set(['encar', 'encar-auto-price']);
  const DETERMINISTIC_EDGE_CODES = new Set([1010,1020,1102]);
  const STAGES = new Set(['input','auth','member','search','detail','catalog','model_catalog','external','price','verify','capture','vision']);
  const NETWORK_STAGES = new Set(['request','response','body','timeout','abort','connect','fetch','auth_user','membership',
    'CONFIG_INVALID','RPC_NETWORK_ERROR','RPC_TIMEOUT','RPC_HTTP_ERROR','RPC_INVALID_RESPONSE','RPC_RESPONSE_INVALID','AUTH_NETWORK_ERROR','MEMBERSHIP_NETWORK_ERROR']);
  const AUTO_SERVER_CODES = new Set(['VERIFY_UNAVAILABLE','CAPTURE_AUTH_FAILED','CAPTURE_RATE_LIMITED','CAPTURE_UNAVAILABLE','CAPTURE_INVALID','CAPTURE_TIMEOUT',
    'OCR_AUTH_FAILED','OCR_RATE_LIMITED','OCR_UNAVAILABLE','OCR_INVALID','OCR_TIMEOUT','CAPTURE_BLOCKED','VEHICLE_UNVERIFIED','PRICE_NOT_FOUND','PRICE_AMBIGUOUS','REQUEST_TIMEOUT','REQUEST_ABORTED']);
  const NON_RETRY_CODES = new Set(['AUTH_REQUIRED','AUTH_FAILED','AUTH_UNAVAILABLE','SESSION_UNAVAILABLE','SESSION_CONTEXT_CHANGED','UNAUTHORIZED','FORBIDDEN','STAFF_REQUIRED',
    'SUPABASE_NOT_CONFIGURED','SEARCH_NOT_CONFIGURED','SEARCH_AUTH_FAILED','SEARCH_QUOTA_EXCEEDED','CATALOG_CONFIG_INVALID','CATALOG_FORM_UNSUPPORTED','CATALOG_PARSER_UNAVAILABLE',
    'METHOD_NOT_ALLOWED','NOT_FOUND','INVALID_REQUEST','INVALID_RESPONSE','UNSUPPORTED_MEDIA_TYPE','REQUEST_TOO_LARGE','PAYLOAD_TOO_LARGE','PLATE_MISMATCH','AD_INACTIVE','DETAIL_NOT_FOUND','DETAIL_BLOCKED','DETAIL_PARSE_FAILED','AD_STATUS_UNKNOWN','CATALOG_BLOCKED','CATALOG_PARSE_FAILED','CATALOG_INCOMPLETE','CATALOG_LIMIT_EXCEEDED',
    'REQUEST_BUDGET_EXCEEDED','CAPTURE_INVALID','OCR_INVALID','AUTO_PRICE_NOT_CONFIGURED','AUTO_PRICE_SETUP_REQUIRED','AUTO_PRICE_AUTH_REQUIRED','AUTO_PRICE_PLATE_MISMATCH','AUTO_PRICE_BLOCKED',
    'SETUP_REQUIRED','CAPTURE_AUTH_FAILED','OCR_AUTH_FAILED','CAPTURE_BLOCKED','VEHICLE_UNVERIFIED','PRICE_API_KEY_MISSING','PRICE_API_AUTH_FAILED']);
  const MAX_PRICE_WON = 1000000000000;
  const PRICE_SOURCES = new Set(['encar.com', 'encar-api.com', 'encar.com-ocr']);
  const REQUEST_MESSAGES = Object.freeze({
    SESSION_CONTEXT_CHANGED: '로그인 정보가 변경되었습니다. 다시 로그인한 뒤 광고를 확인해 주세요.',
    UNAUTHORIZED: '로그인이 필요합니다. 다시 로그인해 주세요.',
    FORBIDDEN: '허용되지 않은 요청입니다. S-NOTE에서 다시 시도해 주세요.',
    AUTH_REQUIRED: '로그인이 필요합니다. 다시 로그인해 주세요.',
    AUTH_FAILED: '로그인 인증을 다시 확인해 주세요.',
    STAFF_REQUIRED: '이 기능을 사용할 수 있는 직원 권한을 확인해 주세요.',
    RATE_LIMITED: '요청이 많습니다. 잠시 후 다시 시도해 주세요.'
  });
  const PRICE_MESSAGES = Object.freeze({
    PRICE_API_KEY_MISSING:'가격 API 키 설정을 확인해 주세요.',PRICE_API_AUTH_FAILED:'가격 API 인증 설정을 확인해 주세요.',PRICE_API_RATE_LIMITED:'가격 API 요청 한도를 확인해 주세요.',
    PRICE_API_TIMEOUT:'가격 API 응답이 지연됐습니다.',PRICE_API_INVALID:'가격 API 응답에서 일치하는 가격을 확인하지 못했습니다.',
    AUTO_PRICE_NOT_CONFIGURED:'자동 가격 인식 서비스 설정을 확인해 주세요.',AUTO_PRICE_AUTH_REQUIRED:'다시 로그인한 뒤 자동 가격을 확인해 주세요.',
    AUTO_PRICE_BLOCKED:'엔카 화면의 자동 가격 인식 요청이 제한됐습니다.',AUTO_PRICE_TIMEOUT:'광고 화면 가격 확인이 지연됐습니다.',
    AUTO_PRICE_AMBIGUOUS:'광고 화면에서 가격을 하나로 확인하지 못했습니다.',AUTO_PRICE_UNAVAILABLE:'광고 화면에서 가격을 자동 확인하지 못했습니다.',
    AUTO_PRICE_PLATE_MISMATCH:'자동으로 연 광고 화면의 차량번호를 확인하지 못했습니다.',AUTO_PRICE_NOT_FOUND:'광고 화면에서 판매가격을 확인하지 못했습니다.',
    SETUP_REQUIRED:'자동 가격 인식 서비스 연결 설정이 필요합니다.',AUTO_PRICE_SETUP_REQUIRED:'자동 가격 인식 서비스 연결 설정이 필요합니다.',
    AUTO_PRICE_RATE_LIMITED:'자동 가격 확인 요청이 많습니다. 잠시 후 다시 시도해 주세요.'
  });
  const UNVERIFIED_MESSAGES = Object.freeze({
    SEARCH_NO_RESULTS: '검색에서 광고 후보를 찾지 못했습니다. 광고 주소를 알고 있다면 아래에서 확인해 주세요.',
    SEARCH_NO_CANDIDATES: '검색 결과에서 확인할 광고 주소를 찾지 못했습니다. 광고 주소로 다시 확인할 수 있습니다.',
    PLATE_MISMATCH: '확인한 광고의 차량번호가 현재 차량과 일치하지 않습니다. 광고 주소를 다시 확인해 주세요.',
    AD_INACTIVE: '확인한 광고에서 현재 게시 중인 매물을 확인하지 못했습니다. 광고 주소를 다시 확인해 주세요.',
    DETAIL_NOT_FOUND: '광고 주소의 상세 페이지를 찾지 못했습니다. 주소를 다시 확인해 주세요.',
    CATALOG_NO_MATCH: '공개 차량 목록에서 전체 차량번호가 일치하는 후보를 확인하지 못했습니다. 광고 주소로 다시 확인할 수 있습니다.',
    NO_VERIFIED_LISTING: '확인한 후보에서 현재 차량번호와 일치하는 광고를 검증하지 못했습니다.'
  });
  const ERROR_MESSAGES = Object.freeze({
    SERVER_UNAVAILABLE: '광고 확인 서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.',
    SEARCH_NOT_CONFIGURED: '광고 검색 서비스 설정을 확인해 주세요. 관리자에게 문의해 주세요.',
    SUPABASE_NOT_CONFIGURED: '온라인 계정 연결 설정을 확인해 주세요. 관리자에게 문의해 주세요.',
    SEARCH_AUTH_FAILED: '광고 검색 서비스 인증에 실패했습니다. 관리자에게 문의해 주세요.',
    SEARCH_RATE_LIMITED: '광고 검색 요청이 많습니다. 잠시 후 다시 확인해 주세요.',
    SEARCH_QUOTA_EXCEEDED: '광고 검색 서비스의 이용 한도를 확인해 주세요. 관리자에게 문의해 주세요.',
    SEARCH_UNAVAILABLE: '광고 검색 서비스에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.',
    DETAIL_BLOCKED: '엔카에서 광고 확인 요청을 제한했습니다. 잠시 후 다시 확인해 주세요.',
    DETAIL_PARSE_FAILED: '광고 페이지의 정보를 읽지 못했습니다. 잠시 후 다시 확인해 주세요.',
    DETAIL_UNAVAILABLE: '광고 상세 페이지에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.',
    AD_STATUS_UNKNOWN: '광고 상태를 확인하지 못했습니다. 진단 정보를 복사해 관리자에게 전달해 주세요.',
    CATALOG_BLOCKED: '공개 차량 목록의 접속이 제한됐습니다. 잠시 후 다시 확인해 주세요.',
    CATALOG_UNAVAILABLE: '공개 차량 목록에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.',
    CATALOG_FORM_UNSUPPORTED: '공개 차량 목록의 검색 방식을 지원하지 못했습니다. 관리자에게 문의해 주세요.',
    CATALOG_PARSE_FAILED: '공개 차량 목록의 정보를 읽지 못했습니다. 관리자에게 문의해 주세요.',
    CATALOG_INCOMPLETE: '공개 차량 목록의 일부 조회를 마치지 못했습니다. 잠시 후 다시 확인해 주세요.',
    CATALOG_TIMEOUT: '공개 차량 목록 확인이 지연됐습니다. 광고 주소로 다시 확인할 수 있습니다.',
    CATALOG_CONFIG_INVALID: '공개 차량 목록의 서버 설정을 확인해 주세요. 관리자에게 문의해 주세요.',
    CATALOG_PARSER_UNAVAILABLE: '공개 차량 목록의 처리 기능을 사용할 수 없습니다. 관리자에게 문의해 주세요.',
    CATALOG_LIMIT_EXCEEDED: '공개 차량 목록의 확인 범위를 초과했습니다. 관리자에게 문의해 주세요.',
    UPSTREAM_TIMEOUT: '광고 검색 또는 상세 확인 응답이 지연됐습니다. 잠시 후 다시 확인해 주세요.',
    DEADLINE_EXCEEDED: '광고 확인 시간이 초과됐습니다. 잠시 후 다시 확인해 주세요.',
    REQUEST_BUDGET_EXCEEDED: '한 번에 확인할 수 있는 광고 조회 범위에 도달했습니다. 잠시 후 다시 확인해 주세요.',
    SESSION_UNAVAILABLE: '로그인 확인 서버에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.',
    AUTH_UNAVAILABLE: '계정 확인 서버에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.'
  });
  const SAFE_CODES = new Set([...Object.keys(UNVERIFIED_MESSAGES), ...Object.keys(ERROR_MESSAGES),
    'METHOD_NOT_ALLOWED', 'AUTH_REQUIRED', 'AUTH_FAILED', 'STAFF_REQUIRED', 'AUTH_UNAVAILABLE','UPSTREAM_ERROR','NOT_FOUND','PAYLOAD_TOO_LARGE',
    'INVALID_REQUEST', 'UNSUPPORTED_MEDIA_TYPE', 'REQUEST_TOO_LARGE',
    'HTTP_ERROR', 'UNVERIFIED', 'CLIENT_TIMEOUT', 'NETWORK_ERROR', 'INVALID_RESPONSE', ...AUTO_SERVER_CODES, ...Object.keys(PRICE_MESSAGES), ...Object.keys(REQUEST_MESSAGES)]);
  const CATALOG_FAILURES = new Set(Object.keys(ERROR_MESSAGES).filter(code => code.startsWith('CATALOG_')));
  let active = null;
  let contextKey = '';
  let contextActor = null;
  let contextReady = false;
  let contextCar = null;
  let contextStorageKey = '', contextSavedKey = '';
  let bar, button, note, results, manual, manualInput, manualButton, manualError;
  let copyButton, copyStatus, copyFallback, saveStatus, saveRetry;
  let retryRecord = null, saveVersion = 0;
  let diagnosticSnapshot = null, feedbackVersion = 0;
  let displayedRecord = null, displayedSaved = false, applyJob = null, applyVersion = 0, directPriceRetry = null;
  let priceDialog, priceDialogBody, priceDialogStatus, priceDialogConfirm, priceDialogCancel;
  let pendingPriceOffer = null, priceOffer = null, priceOfferEpoch = 0;
  const cooldowns = [];
  let cooldownView = null, cooldownTimer = null;

  function sameLookup(job, context) {
    return !!job && !!context?.ready && job.key === context.key && job.actor === context.actor && job.car === context.car &&
      (job.storage?.key || '') === (context.storage?.key || '');
  }

  function retryAfter(value) {
    if (Number.isInteger(value) && value >= 0) return Math.min(MAX_RETRY_AFTER_SECONDS, value);
    if (typeof value !== 'string' || value.length > 128) return null;
    const text=value.trim();
    if (/^\d{1,10}$/.test(text)) return Math.min(MAX_RETRY_AFTER_SECONDS, Number(text));
    if(!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/i.test(text))return null;
    const date=Date.parse(text);
    if(!Number.isFinite(date)||new Date(date).toUTCString().toLowerCase()!==text.toLowerCase())return null;
    return Math.max(0, Math.min(MAX_RETRY_AFTER_SECONDS, Math.ceil((date-Date.now())/1000)));
  }

  function cooldownFor(context, endpoint) {
    if (!context) return null;
    for (let i=cooldowns.length-1;i>=0;i--) if (cooldowns[i].until<=Date.now()) cooldowns.splice(i,1);
    return cooldowns.find(item=>item.actor===context.actor&&item.companyId===(context.storage?.company?.id||context.storage?.companyId||'')&&item.userId===(context.storage?.user?.id||context.storage?.userId||context.actor?.username||'')&&item.endpoint===endpoint)||null;
  }

  function rememberCooldown(context, endpoint, seconds, status) {
    if (![429,500,502,503,504].includes(status)||!seconds) return;
    let value=cooldownFor(context,endpoint);
    if (!value) {value={actor:context.actor,companyId:context.storage?.company?.id||context.storage?.companyId||'',userId:context.storage?.user?.id||context.storage?.userId||context.actor?.username||'',endpoint,until:0};cooldowns.push(value);}
    value.until=Math.max(value.until,Date.now()+seconds*1000);
    if(cooldowns.length>16)cooldowns.splice(0,cooldowns.length-16);
  }

  function clearCooldownView() { cooldownView=null;clearTimeout(cooldownTimer);cooldownTimer=null; }

  function showCooldown(context, endpoint, message) {
    const value=cooldownFor(context,endpoint);if(!value)return false;
    clearCooldownView();cooldownView={context,endpoint,message};
    const tick=()=>{
      const view=cooldownView,now=currentContext();if(!view||!sameLookup(view.context,now)){clearCooldownView();return;}
      const pending=cooldownFor(now,view.endpoint),seconds=pending?Math.ceil((pending.until-Date.now())/1000):0;
      if(!active){const message=view.message+(seconds?' · '+seconds+'초 후 다시 확인할 수 있습니다.':' · 다시 확인해 주세요.');if(note.textContent!==message)setNote(message,true);if(view.endpoint==='encar')button.disabled=!!seconds||!now.ready;}
      if(seconds)cooldownTimer=setTimeout(tick,Math.max(100,Math.min(1000,pending.until-Date.now())));else clearCooldownView();
    };tick();return true;
  }

  function waitRetry(milliseconds, signal) {
    return new Promise((resolve,reject)=>{
      let timer;const stop=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);reject(new DOMException('요청이 취소되었습니다.','AbortError'));};
      if(signal.aborted){stop();return;}signal.addEventListener('abort',stop,{once:true});timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},milliseconds);
    });
  }

  function retryCode(data) {
    const value=data?.diagnostics?.code||data?.code;
    return typeof value==='string'?value:'';
  }

  function canRetry(status, code, attempt, job, seconds=0) {
    return attempt===1&&RETRY_STATUSES.has(status)&&!NON_RETRY_CODES.has(code)&&!job.controller.signal.aborted&&
      seconds<=MAX_AUTO_RETRY_WAIT_SECONDS&&stillCurrent(job)&&job.deadline-Date.now()>Math.max(seconds*1000,850)+1000;
  }

  function responseRetryAfter(response,data) {
    const header=retryAfter(response?.headers?.get?.('retry-after'));
    return header??retryAfter(data?.retryAfterSeconds)??retryAfter(data?.diagnostics?.retryAfterSeconds)??0;
  }

  function diagnosticsInput(value) {
    const top=value&&typeof value==='object'&&!Array.isArray(value)?value:{},nested=top.diagnostics&&typeof top.diagnostics==='object'&&!Array.isArray(top.diagnostics)?top.diagnostics:{};
    const result={...nested};
    for(const key of ['code','stage','networkStage','endpoint','attempt','retryAfterSeconds','fromCache','priceCacheHit','upstreamStatus','requestId','responseType','rayId','ray_id','error_code','cloudflareErrorCode','requestCount','reusedCount','budgetLimit','budgetRemaining','budgetExhausted'])if(!Object.hasOwn(result,key)&&Object.hasOwn(top,key))result[key]=top[key];
    if(typeof top.diagnosticCode==='string'&&SAFE_CODES.has(top.diagnosticCode))result.code=top.diagnosticCode;
    return result;
  }

  function discardResponse(response) {try{void response.body?.cancel().catch(()=>{});}catch(_) {}}

  async function readHttpResponse(response,{signal,endpoint}={}) {
    const evidence=responseEvidence(response),json=evidence.responseType==='json',maximum=json?128*1024:16384;
    let data=null,parseError=null,text='';const aborted=()=>{if(signal?.aborted)throw new DOMException('요청이 취소되었습니다.','AbortError');};
    const wait=value=>signal?abortable(value,signal):Promise.resolve(value);
    try{
      aborted();
      if(response.body?.getReader&&(json||response.status>=400)){
        const reader=response.body.getReader(),chunks=[];let length=0;
        try{for(;;){const next=await wait(reader.read());aborted();if(next.done)break;const available=maximum-length;if(next.value.byteLength>available){if(json)throw Object.assign(lookupError('응답 크기를 확인하지 못했습니다.','INVALID_RESPONSE'),{responseTooLarge:true});chunks.push(next.value.subarray(0,Math.max(0,available)));length=maximum;break;}chunks.push(next.value);length+=next.value.byteLength;if(!json&&length===maximum)break;}
          const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}text=new TextDecoder('utf-8',{fatal:json}).decode(bytes);
        }finally{try{void reader.cancel().catch(()=>{});}catch(_){}try{reader.releaseLock();}catch(_) {}}
        if(json)data=JSON.parse(text);
      }else if(json&&typeof response.json==='function'){
        data=await wait(response.json());aborted();if(JSON.stringify(data).length>maximum)throw Object.assign(lookupError('응답 크기를 확인하지 못했습니다.','INVALID_RESPONSE'),{responseTooLarge:true});
      }else discardResponse(response);
    }catch(error){aborted();parseError=error?.message==='SESSION_CONTEXT_CHANGED'||NON_RETRY_CODES.has(error?.code)?error:lookupError('광고 응답을 확인하지 못했습니다.','INVALID_RESPONSE');if(error?.responseTooLarge)parseError.responseTooLarge=true;}
    if(!json&&evidence.responseType==='html'){
      const match=/<[^>]{0,200}\bclass\s*=\s*["'][^"']*\bcf-error-code\b[^"']*["'][^>]*>\s*(1\d{3})\s*</i.exec(text)||/<title[^>]*>\s*(?:error\s*)?(1\d{3})(?:\s*[:|–-]|\s*<\/title)/i.exec(text);
      if(match)evidence.cloudflareErrorCode=Number(match[1]);
    }
    addEdgeEvidence(evidence,data);const seconds=responseRetryAfter(response,data),diagnostics=sanitizeDiagnostics(diagnosticsInput(data),response.status,parseError?.responseTooLarge?'INVALID_RESPONSE':json?'HTTP_ERROR':'SERVER_UNAVAILABLE',{endpoint,retryAfterSeconds:seconds});Object.assign(diagnostics,evidence);
    const requestId=response.headers.get('x-request-id'),release=response.headers.get('x-encar-resolver-release');
    if(!diagnostics.requestId&&typeof requestId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)&&requestId.length===36)diagnostics.requestId=requestId;
    if(!diagnostics.resolverRelease&&typeof release==='string'&&release.length<=32&&release===release.trim()&&/^[0-9]{1,3}\.[0-9]{1,6}(?:\.[0-9]{1,6})?$/.test(release))diagnostics.resolverRelease=release;
    return{data,json,parseError,httpStatus:response.status,diagnostics,retryAfterSeconds:seconds,...evidence};
  }

  async function retryPause(job, seconds) {
    const milliseconds=Math.max(seconds*1000,600+Math.floor(Math.random()*251)),until=Date.now()+milliseconds;let timer;
    const pulse=()=>{if(stillCurrent(job)&&!job.controller.signal.aborted){const message='일시적인 응답 지연으로 '+Math.max(1,Math.ceil((until-Date.now())/1000))+'초 후 한 번 다시 확인합니다.';if(note.textContent!==message)setNote(message);timer=setTimeout(pulse,250);}};
    pulse();try{await waitRetry(milliseconds,job.controller.signal);}finally{clearTimeout(timer);}
  }

  async function requestLookup(job, payload, token) {
    for(let attempt=1;attempt<=2;attempt++){
      if(!stillCurrent(job)||job.controller.signal.aborted)throw new DOMException('요청이 취소되었습니다.','AbortError');
      job.lookupAttempts=attempt;job.clientRequestCount++;
      const response=await abortable(fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:'Bearer '+token},body:payload,signal:job.controller.signal,cache:'no-store',credentials:'same-origin'}),job.controller.signal);
      if(!stillCurrent(job)){discardResponse(response);throw new DOMException('요청이 취소되었습니다.','AbortError');}
      job.httpStatus=response.status;job.responseEvidence=responseEvidence(response);
      const parsed=await readHttpResponse(response,{signal:job.controller.signal,endpoint:'encar'}),{data,parseError,json}=parsed;
      job.httpStatus=response.status;job.responseEvidence={responseType:parsed.responseType,observedAt:parsed.observedAt,...(parsed.rayId?{rayId:parsed.rayId}:{}),...(parsed.cloudflareErrorCode?{cloudflareErrorCode:parsed.cloudflareErrorCode}:{})};
      const diagnostic=parsed.diagnostics,edge=diagnostic.cloudflareErrorCode;
      const seconds=parsed.retryAfterSeconds||(edge===1102||retryCode(data)==='REQUEST_BUDGET_EXCEEDED'?5:0);job.retryAfterSeconds=seconds;
      rememberCooldown(job,'encar',seconds,response.status);
      const requestCode=retryCode(data)||(parseError?.message==='SESSION_CONTEXT_CHANGED'?'SESSION_CONTEXT_CHANGED':parseError?.code);
      if(canRetry(response.status,requestCode,attempt,job,seconds)&&!parseError?.responseTooLarge&&data?.autoRetry!==false&&!DETERMINISTIC_EDGE_CODES.has(Number(edge))){
        addEdgeEvidence(job.responseEvidence,data);setDiagnostics(diagnostic,response.status,json?'HTTP_ERROR':'SERVER_UNAVAILABLE',{endpoint:'encar',attempt,retryAfterSeconds:seconds,clientRequestCount:job.clientRequestCount});Object.assign(diagnosticSnapshot,job.responseEvidence);
        await retryPause(job,seconds);continue;
      }
      return{response,data,parseError,json,diagnostics:parsed.diagnostics};
    }
  }

  async function requestAutoPrice(job, context, record, listingId) {
    const pending=cooldownFor(context,'encar-auto-price');
    if(pending)throw Object.assign(new Error('자동 가격 확인 대기 중'),{code:'AUTO_PRICE_RATE_LIMITED',httpStatus:429,retryAfterSeconds:Math.ceil((pending.until-Date.now())/1000)});
    for(let attempt=1;attempt<=2;attempt++){
      job.priceAttempts=attempt;job.clientRequestCount++;
      try{return await abortable(window.snoteEncarLinksBridge.autoPrice(context.storage,record,{signal:job.controller.signal,listingId,deadline:job.deadline,attempt}),job.controller.signal);}
      catch(error){
        const data=diagnosticsInput(error),edge=Number(data.cloudflareErrorCode??data.error_code),seconds=retryAfter(error?.retryAfterSeconds)||retryAfter(data.retryAfterSeconds)||(edge===1102||data.code==='REQUEST_BUDGET_EXCEEDED'?5:0),status=error?.httpStatus;
        rememberCooldown(context,'encar-auto-price',seconds,status);job.priceRetryAfterSeconds=seconds;
        if(canRetry(status,retryCode(data),attempt,job,seconds)&&error?.autoRetry!==false&&!DETERMINISTIC_EDGE_CODES.has(Number(data.cloudflareErrorCode??data.error_code))){await retryPause(job,seconds);continue;}
        throw error;
      }
    }
  }

  function normalizePlate(value) {
    return String(value || '').normalize('NFKC').replace(/[\s-]+/g, '');
  }

  function validId(value) {
    return /^[1-9][0-9]{0,11}$/.test(String(value ?? ''));
  }

  function currentContext() {
    const overlay = document.getElementById('vehicle-overlay');
    if (!overlay?.classList.contains('open')) return null;
    if (typeof activeCarId === 'undefined' || typeof cars === 'undefined') return null;
    if (typeof currentUser === 'undefined' || !currentUser) return null;
    const car = cars.find(item => item.id === activeCarId);
    if (!car) return null;
    const plate = normalizePlate(car.plate);
    let storage = null;
    try { storage = window.snoteEncarLinksBridge?.context(String(car.id)) || null; } catch (_) {}
    return { car, storage, plate, key: String(car.id) + ':' + plate + ':' + String(car.ownerId || ''), actor: currentUser, ready: !!window.zc86Cloud?.ready };
  }

  function stillCurrent(job) {
    const now = currentContext();
    return active === job && now?.ready && now.key === job.key && now.actor === job.actor && now.car === job.car &&
      (now.storage?.key || '') === (job.storage?.key || '');
  }

  function readCandidates(plate) {
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_PREFIX + plate) || 'null');
      if (!saved || saved.plate !== plate || !Number.isFinite(saved.at)) return [];
      if (Date.now() - saved.at > CACHE_AGE || saved.at > Date.now() + 60000) return [];
      return [...new Set((saved.ids || []).map(String).filter(validId))].slice(0,6);
    } catch (_) { return []; }
  }

  function saveCandidates(plate, listings) {
    const ids = [...new Set(listings.map(item => String(item.id)))].filter(validId);
    if (!ids.length) return;
    try {
      localStorage.setItem(CACHE_PREFIX + plate, JSON.stringify({plate, ids: ids.slice(0,6), at: Date.now()}));
    } catch (_) { /* Storage is optional; every candidate is verified by the server. */ }
  }

  function detailUrl(value, id) {
    if (!validId(id)) return null;
    const expected = 'https://fem.encar.com/cars/detail/' + String(id);
    return value === expected ? expected : null;
  }

  function externalHost(host) {
    return ['encar.spb.ru', 'encar.msk.ru', 'encar.cbg.ru', 'trust-encar.ru'].includes(host) ||
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+trust-encar\.ru$/.test(host) && !host.split('.').some(label => label.startsWith('xn--'));
  }

  function manualExternalSource(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f-\u009f\\]/.test(value)) return null;
    const text = value.trim();
    if (/[\u0000-\u0020\u007f-\u009f\\?#]/.test(text)) return null;
    try {
      const url = new URL(text), detail = /^\/auto\/([1-9][0-9]{0,11})\/?$/.exec(url.pathname);
      if (!externalHost(url.hostname) || url.protocol !== 'https:' || url.username || url.password || url.port ||
          url.href !== text || !detail) return null;
      return {id: detail[1], sourceUrl: url.href};
    } catch (_) { return null; }
  }

  function discoveryLabel(value) {
    if (typeof value !== 'string' || value.length > 80 || /[\u0000-\u001f\u007f-\u009f\\/<>]/.test(value)) return null;
    const label = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    return label && label.length <= 80 && !/[\u0000-\u001f\u007f-\u009f\\/<>]/.test(label) ? label : null;
  }

  function discoveryHints(car) {
    const make = discoveryLabel(car.make);
    if (!make) return null;
    const model = discoveryLabel(car.group), grade = discoveryLabel(car.grade);
    return {make, ...(model ? {model} : {}), ...(grade ? {grade} : {})};
  }

  function externalVerification(value, id, verifiedAt) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => !['source', 'sourceUrl', 'checkedAt', 'advertisedAt', 'modifiedAt', 'method'].includes(key)) ||
        (Object.hasOwn(value, 'method') && value.method !== 'search-index') ||
        value.source !== 'trust-encar' || typeof value.sourceUrl !== 'string' || value.sourceUrl.length > 2048 ||
        /[\u0000-\u0020\u007f-\u009f\\]/.test(value.sourceUrl) || typeof value.checkedAt !== 'string') return null;
    const searchIndex = Object.hasOwn(value, 'method');
    let source;
    try {
      source = new URL(value.sourceUrl);
      if (!externalHost(source.hostname) || source.protocol !== 'https:' || source.username || source.password || source.port || source.hash ||
          source.href !== value.sourceUrl || source.pathname.includes('%')) return null;
      const detail = /^\/auto\/([1-9][0-9]{0,11})\/?$/.exec(source.pathname);
      if (detail ? detail[1] !== String(id) || !!source.search : !/^\/catalog(?:\/[a-z0-9-]+)*\/?$/.test(source.pathname)) return null;
      if (/(?:^|\/)(?:admin|account|auth|login|logout|sign[-_]?in|sign[-_]?out|signup|register|delete|remove|destroy|create|save|update|edit|submit|checkout|payment|purchase|booking|subscribe|contact|message|send|inquiry|enquiry)(?:[./_-]|$)/i.test(source.pathname)) return null;
      for (const [key, text] of source.searchParams) {
        if (/[\u0000-\u001f\u007f-\u009f]/.test(key + text) ||
            /^(?:_?method|action|cmd|command|operation|task|do)$/i.test(key) && /^(?:post|put|patch|delete|remove|destroy|create|save|update|edit|submit|logout|login|checkout|pay)$/i.test(text)) return null;
      }
    } catch (_) { return null; }
    const checked = new Date(value.checkedAt);
    if (!Number.isFinite(checked.getTime()) || checked.toISOString() !== value.checkedAt || checked.getTime() > Date.now() + 60000 ||
        checked.getTime() > Date.parse(verifiedAt) + 60000) return null;
    const day = input => {
      if (input === null) return null;
      if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return false;
      const date = new Date(input + 'T00:00:00.000Z');
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === input ? input : false;
    };
    const advertisedAt = day(value.advertisedAt), modifiedAt = day(value.modifiedAt);
    if (advertisedAt === false || modifiedAt === false) return null;
    if (searchIndex && (advertisedAt !== null || modifiedAt !== null)) return null;
    return {source: 'trust-encar', sourceUrl: source.href, checkedAt: checked.toISOString(), advertisedAt, modifiedAt,
      ...(searchIndex ? {method: 'search-index'} : {})};
  }

  function isExternal(item) { return !!item?.externalVerification; }

  function externalStatus(item) {
    const evidence = item.externalVerification, searchIndex = evidence.method === 'search-index';
    const label = document.createElement('span');
    label.className = 'snote-encar-external-status'; label.textContent = searchIndex ? '검색 결과 확인' : '외부 광고 확인'; label.tabIndex = 0;
    const checked = new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(evidence.checkedAt));
    const tooltip = [searchIndex && '검색 자료에서 차량번호와 제조사를 확인했습니다.',
      searchIndex && '외부 광고 원문 HTML은 확인하지 못했습니다.',
      '한국 엔카의 현재 광고 상태는 확인하지 못했습니다.', (searchIndex ? '검색 확인 ' : '확인 ') + checked,
      evidence.advertisedAt && '외부 광고 추가일 ' + evidence.advertisedAt,
      evidence.modifiedAt && '외부 수정일 ' + evidence.modifiedAt, '출처 ' + evidence.sourceUrl].filter(Boolean).join('\n');
    label.dataset.tooltip = tooltip; label.dataset.snoteIconHelp = tooltip; label.setAttribute('aria-label', tooltip);
    return label;
  }

  function priceFields(item, verifiedAt) {
    if (!['priceWon', 'priceCheckedAt', 'priceSource', 'priceStatus'].some(key => Object.hasOwn(item, key))) return {};
    const time = typeof item.priceCheckedAt === 'string' ? Date.parse(item.priceCheckedAt) : NaN;
    if (['verified','review'].includes(item.priceStatus) && !(item.priceSource==='encar.com-ocr'&&item.priceStatus!=='review') && Number.isSafeInteger(item.priceWon) && item.priceWon > 0 && item.priceWon <= MAX_PRICE_WON &&
        PRICE_SOURCES.has(item.priceSource) && Number.isFinite(time) && new Date(time).toISOString() === item.priceCheckedAt && time <= Date.now() + 60000 && time <= Date.parse(verifiedAt) + 60000) {
      return {priceWon: item.priceWon, priceCheckedAt: new Date(time).toISOString(), priceSource: item.priceSource, priceStatus: item.priceStatus};
    }
    return {priceWon: null, priceCheckedAt: null, priceSource: null, priceStatus: 'unavailable'};
  }

  function savedRecord(value, plate) {
    if (!value || value.version !== 1 || value.plate !== plate || !Array.isArray(value.listings) ||
        !value.listings.length || value.listings.length > 12 || typeof value.verifiedAt !== 'string' ||
        !Number.isFinite(Date.parse(value.verifiedAt)) || Date.parse(value.verifiedAt) > Date.now() + 60000) return null;
    const listings = [];
    for (const item of value.listings) {
      if (!item || !detailUrl(item.sellerUrl, item.id)) return null;
      const hasExternal = Object.hasOwn(item, 'externalVerification');
      const evidence = hasExternal ? externalVerification(item.externalVerification, item.id, value.verifiedAt) : null;
      if (hasExternal && (!evidence || item.trustedId != null || item.trustedUrl != null)) return null;
      const trusted = String(item.trustedId) !== String(item.id) ? detailUrl(item.trustedUrl, item.trustedId) : null;
      listings.push({id: String(item.id), model: String(item.model || '').slice(0, 200),
        sellerUrl: detailUrl(item.sellerUrl, item.id), trustedId: trusted ? String(item.trustedId) : null, trustedUrl: trusted,
        ...(evidence ? {externalVerification: evidence, priceWon: null, priceCheckedAt: null, priceSource: null, priceStatus: 'unavailable'} : priceFields(item, value.verifiedAt))});
    }
    if (new Set(listings.map(item => item.id)).size !== listings.length) return null;
    return {version: 1, plate, verifiedAt: value.verifiedAt, listings};
  }

  function restoreSaved(context) {
    if (!context?.ready || !context.storage) return;
    const record = savedRecord(context.car.encarLinks, context.plate);
    if (!record) return;
    if(JSON.stringify(record)===JSON.stringify(displayedRecord))return;
    showListings(record, true, true);
    saveStatus.textContent = '';
    setNote('');
  }

  async function persistListings(context, record) {
    const bridge = window.snoteEncarLinksBridge;
    if (!bridge?.save || !context.storage) return false;
    if (!context.storage.canWrite) {
      saveStatus.textContent = '광고는 확인했습니다. 서버 저장은 담당 딜러 또는 관리자가 할 수 있습니다.';
      return false;
    }
    const version = ++saveVersion;
    retryRecord = record;
    if (JSON.stringify(displayedRecord) === JSON.stringify(record)) displayedSaved = false;
    saveRetry.hidden = true;
    saveStatus.textContent = '광고 링크를 서버에 저장 중…';
    refreshPriceControls();
    const current = () => {
      const now = currentContext();
      return version === saveVersion && now?.key === context.key && now.actor === context.actor && now.ready &&
        now.car === context.car && (now.storage?.key || '') === (context.storage?.key || '');
    };
    try {
      const saved = await bridge.save(context.storage, record);
      if (!current()) return false;
      if (saved?.ok !== true) throw new Error('SAVE_NOT_CONFIRMED');
      retryRecord = null;
      saveStatus.textContent = '광고 링크를 서버에 저장했습니다.';
      if (JSON.stringify(displayedRecord) === JSON.stringify(record)) displayedSaved = true;
      refreshPriceControls();
      refreshSavedList(context);
      maybeOpenPriceConfirmation();
      return true;
    } catch (_) {
      if (current()) {
        saveStatus.textContent = '광고는 확인했지만 서버 저장을 확인하지 못했습니다.';
        saveRetry.hidden = false;
        refreshPriceControls();
      }
      return false;
    }
  }

  function candidateFromUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return null;
    const external = manualExternalSource(value);
    if (external) return external.id;
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
      if (url.hostname === 'fem.encar.com') {
        const match = /^\/cars\/detail\/([1-9][0-9]{0,11})\/?$/.exec(url.pathname);
        return match?.[1] || null;
      }
      if (!['www.encar.com', 'encar.com', 'm.encar.com'].includes(url.hostname)) return null;
      if (url.hostname !== 'm.encar.com' && url.pathname !== '/dc/dc_cardetailview.do') return null;
      const ids = [...url.searchParams].filter(([key]) => key.toLowerCase() === 'carid').map(([, id]) => id);
      return ids.length === 1 && validId(ids[0]) ? ids[0] : null;
    } catch (_) { return null; }
  }

  function resetFeedback() {
    clearCooldownView();
    closePriceConfirmation(true);
    pendingPriceOffer = null;
    ++feedbackVersion;
    ++saveVersion;
    retryRecord = null;
    ++applyVersion; applyJob = null; directPriceRetry = null; displayedRecord = null; displayedSaved = false;
    saveStatus.textContent = ''; saveRetry.hidden = true; saveRetry.disabled = false;
    diagnosticSnapshot = null;
    results.replaceChildren();
    setNote('');
    manual.hidden = true; manual.open = false; manualInput.value = ''; manualError.textContent = '';
    copyButton.hidden = true; copyButton.disabled = false; copyStatus.textContent = '';
    copyFallback.hidden = true; copyFallback.value = '';
  }

  // Transport evidence is request-local and never includes raw headers/body text.
  function responseEvidence(response) {
    const mediaType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    const responseType = mediaType === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(mediaType) ? 'json' :
      mediaType === 'text/html' ? 'html' : mediaType === 'text/plain' ? 'text' : 'other';
    const evidence = {responseType, observedAt: new Date().toISOString()};
    const ray = safeRay(response.headers.get('cf-ray'));
    if (ray) evidence.rayId = ray;
    return evidence;
  }

  function safeRay(value) {
    // Exact length check also rejects a trailing newline (JS $ accepts one).
    return typeof value === 'string' && (value.length === 16 || value.length === 20) &&
      /^[0-9a-f]{16}(?:-[A-Z]{3})?$/i.test(value) ? value.toLowerCase() : null;
  }

  function addEdgeEvidence(evidence, data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    // A valid response header wins over a conflicting JSON ray_id.
    const ray = safeRay(data.ray_id);
    if (!evidence.rayId && ray) evidence.rayId = ray;
    const code = data.error_code;
    if (Number.isInteger(code) && code >= 1000 && code <= 1999) evidence.cloudflareErrorCode = code;
    else if (typeof code === 'string' && code.length === 4 && /^1[0-9]{3}$/.test(code)) evidence.cloudflareErrorCode = Number(code);
  }

  function sanitizeDiagnostics(raw, httpStatus, fallbackCode, extra = {}) {
    const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const code = typeof data.code === 'string' && SAFE_CODES.has(data.code) ? data.code : SAFE_CODES.has(fallbackCode) ? fallbackCode : 'HTTP_ERROR';
    const safe = { service: 'snote-encar', clientRelease: CLIENT_RELEASE, code, httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null };
    const endpoint=extra.endpoint||data.endpoint;if(ENDPOINTS.has(endpoint))safe.endpoint=endpoint;
    for(const key of ['stage','networkStage'])if(STAGES.has(data[key])||NETWORK_STAGES.has(data[key]))safe[key]=data[key];
    const attempt=extra.attempt??data.attempt;if(Number.isInteger(attempt)&&attempt>=1&&attempt<=2)safe.attempt=attempt;
    const after=extra.retryAfterSeconds??data.retryAfterSeconds;if(Number.isInteger(after)&&after>=0&&after<=MAX_RETRY_AFTER_SECONDS)safe.retryAfterSeconds=after;
    if(typeof data.fromCache==='boolean')safe.fromCache=data.fromCache;
    if(typeof data.priceCacheHit==='boolean'){safe.priceCacheHit=data.priceCacheHit;if(!Object.hasOwn(safe,'fromCache'))safe.fromCache=data.priceCacheHit;}
    if(Number.isInteger(extra.clientRequestCount)&&extra.clientRequestCount>=1&&extra.clientRequestCount<=4)safe.clientRequestCount=extra.clientRequestCount;
    if(['json','html','text','other'].includes(data.responseType))safe.responseType=data.responseType;
    const ray=safeRay(data.rayId)||safeRay(data.ray_id);if(ray)safe.rayId=ray;
    const edge=data.cloudflareErrorCode??data.error_code;if(Number.isInteger(edge)&&edge>=1000&&edge<=1999)safe.cloudflareErrorCode=edge;else if(typeof edge==='string'&&/^1\d{3}$/.test(edge)&&edge.length===4)safe.cloudflareErrorCode=Number(edge);
    if(Number.isInteger(data.upstreamStatus)&&data.upstreamStatus>=100&&data.upstreamStatus<=599)safe.upstreamStatus=data.upstreamStatus;
    if (typeof data.resolverRelease === 'string' && data.resolverRelease.length <= 32 && data.resolverRelease === data.resolverRelease.trim() && /^[0-9]{1,3}\.[0-9]{1,6}(?:\.[0-9]{1,6})?$/.test(data.resolverRelease)) safe.resolverRelease = data.resolverRelease;
    if (typeof data.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.requestId)) safe.requestId = data.requestId;
    for (const key of ['requestCount', 'reusedCount', 'budgetLimit', 'budgetRemaining', 'searchCount', 'resultCount', 'candidateCount', 'checkedCount', 'plateMatchedCount', 'resultPlateMatchCount', 'rawResultCount', 'recognizedSourceCount', 'catalogRequestCount', 'catalogPageCount', 'catalogRecordCount', 'catalogExactMatchCount', 'catalogFormCount', 'catalogPlateFieldCount', 'catalogLinkCount', 'modelCatalogRequestCount', 'modelCatalogPageCount', 'modelCatalogRecordCount', 'modelCatalogExactMatchCount', 'externalRequestCount', 'externalMatchCount', 'modelBranchPageCount', 'externalSkippedCount', 'searchEvidenceCount', 'searchEvidenceAcceptedCount']) {
      if (Number.isInteger(data[key]) && data[key] >= 0 && data[key] <= 1000) safe[key] = data[key];
    }
    for (const key of ['searchConfigured', 'discoveryProvided','budgetExhausted']) if (typeof data[key] === 'boolean') safe[key] = data[key];
    if (['input', 'saved_candidates', 'explicit_source', 'catalog_form', 'model_catalog', 'search_exact', 'search_targeted', 'known_candidates'].includes(data.discoveryStage)) safe.discoveryStage = data.discoveryStage;
    const parseReasonCounts = {};
    if (data.parseReasonCounts && typeof data.parseReasonCounts === 'object' && !Array.isArray(data.parseReasonCounts)) {
      for (const key of ['MODEL_HTML_PARSE_FAILED', 'EXTERNAL_HTML_PARSE_FAILED', 'SEARCH_MANUFACTURER_MISMATCH', 'SEARCH_PLATE_AMBIGUOUS', 'SEARCH_ID_MISSING', 'SEARCH_ID_AMBIGUOUS', 'SEARCH_SOURCE_ID_MISMATCH']) {
        if (Number.isInteger(data.parseReasonCounts[key]) && data.parseReasonCounts[key] > 0 && data.parseReasonCounts[key] <= 1000) parseReasonCounts[key] = data.parseReasonCounts[key];
      }
    }
    if (Object.keys(parseReasonCounts).length) safe.parseReasonCounts = parseReasonCounts;
    const rejected = {};
    if (data.rejected && typeof data.rejected === 'object' && !Array.isArray(data.rejected)) {
      for (const key of ['plateMismatch', 'notAdvertising', 'notFound']) {
        if (Number.isInteger(data.rejected[key]) && data.rejected[key] >= 0 && data.rejected[key] <= 1000) rejected[key] = data.rejected[key];
      }
    }
    if (Object.keys(rejected).length) safe.rejected = rejected;
    return safe;
  }

  function setDiagnostics(raw, httpStatus, fallbackCode, extra = {}) {
    diagnosticSnapshot = sanitizeDiagnostics(raw,httpStatus,fallbackCode,extra);
    copyButton.hidden = false;
    return diagnosticSnapshot.code;
  }

  function providerPriceDiagnostics(raw,httpStatus,mainCode=null){
    if(!raw||typeof raw!=='object'||!Array.isArray(raw.codes)||raw.codes.length>30)return null;
    const mapping={KEY_MISSING:'PRICE_API_KEY_MISSING',KEY_INVALID:'PRICE_API_AUTH_FAILED',AUTH_FAILED:'PRICE_API_AUTH_FAILED',RATE_LIMITED:'PRICE_API_RATE_LIMITED',TIMEOUT:'PRICE_API_TIMEOUT',INSUFFICIENT_BUDGET:'PRICE_API_TIMEOUT',
      LIMIT_SKIPPED:'PRICE_API_INVALID',REDIRECT:'PRICE_API_INVALID',SCHEMA_INVALID:'PRICE_API_INVALID',UNAVAILABLE:'PRICE_API_INVALID',RESPONSE_LIMIT:'PRICE_API_INVALID',ID_MISMATCH:'PRICE_API_INVALID',
      CONTEXT_MISMATCH:'PRICE_API_INVALID',CURRENCY_UNSUPPORTED:'PRICE_API_INVALID',NON_CASH_PRICE:'PRICE_API_INVALID',PRICE_INVALID:'PRICE_API_INVALID',PAGE_TEXT_LIMIT:'PRICE_API_INVALID',PAGE_PARSER_UNAVAILABLE:'PRICE_API_INVALID',PAGE_AMBIGUOUS:'AUTO_PRICE_AMBIGUOUS',PAGE_EMPTY:'PRICE_API_INVALID',PAGE_PARSE_FAILED:'PRICE_API_INVALID'};
    const codes=raw.codes.filter(item=>item&&Object.hasOwn(mapping,item.code)&&Number.isInteger(item.count)&&item.count>0&&item.count<=1000&&
      (item.httpStatus===null||Number.isInteger(item.httpStatus)&&item.httpStatus>=100&&item.httpStatus<=599)).map(item=>({code:item.code,httpStatus:item.httpStatus,count:item.count}));
    if(!codes.length)return null;const code=mapping[codes[0].code];if(!mainCode||diagnosticSnapshot?.endpoint!=='encar-auto-price')setDiagnostics({code:mainCode||code},httpStatus,mainCode||code,{endpoint:'encar'});
    const price={codes};for(const key of['providerRequests','pageReviewCount'])if(Number.isInteger(raw[key])&&raw[key]>=0&&raw[key]<=1000)price[key]=raw[key];diagnosticSnapshot.price=price;return code;
  }

  async function copyDiagnostics() {
    syncContext();
    if (!diagnosticSnapshot) return;
    const version = feedbackVersion, context = currentContext(), content = JSON.stringify(diagnosticSnapshot, null, 2);
    const current = () => version === feedbackVersion && currentContext()?.actor === context?.actor && currentContext()?.key === context?.key && currentContext()?.ready;
    copyButton.disabled = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(content);
      if (current()) copyStatus.textContent = '진단 정보를 복사했습니다.';
    } catch (_) {
      if (current()) {
        copyFallback.value = content; copyFallback.hidden = false; copyFallback.focus(); copyFallback.select();
        copyStatus.textContent = '선택된 진단 정보를 복사해 주세요.';
      }
    } finally { if (current()) copyButton.disabled = false; }
  }

  function lookupError(message, code = 'INVALID_RESPONSE') {
    const error = new Error(message); error.userMessage = message; error.diagnosticCode = code; return error;
  }

  function renderLookupButton(busy = false) {
    button.setAttribute('aria-label', '엔카광고보기');
    button.removeAttribute('title');
    button.setAttribute('data-tooltip', '엔카광고보기');
    button.setAttribute('aria-busy', String(busy));
    button.classList.toggle('is-loading', busy);
    if (button.childElementCount === 1 && button.querySelector('span.snote-encar-wordmark')) return;
    const wordmark = document.createElement('span');
    wordmark.className = 'snote-encar-wordmark';
    wordmark.setAttribute('aria-hidden', 'true');
    wordmark.style.cssText = 'font:normal 800 14px/17px Arial,sans-serif;letter-spacing:-.6px;color:#e52534;white-space:nowrap;pointer-events:none';
    wordmark.textContent = 'Encar';
    button.replaceChildren(wordmark);
  }

  function closeWaitingTab(job) {
    if (!job?.waitingTab) return;
    try { if (!job.waitingTab.closed) job.waitingTab.close(); } catch (_) {}
    job.waitingTab = null;
  }

  function cancel() {
    if (active) {
      active.controller.abort();
      closeWaitingTab(active);
    }
    active = null;
    resetFeedback();
  }

  function setNote(message, isError = false) {
    note.textContent = message;
    note.dataset.error = isError ? 'true' : 'false';
  }

  function abortable(promise, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener('abort', abort);
        reject(new DOMException('요청이 취소되었습니다.', 'AbortError'));
      };
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, {once:true});
      Promise.resolve(promise).then(value => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      }, error => {
        signal.removeEventListener('abort', abort);
        reject(error);
      });
    });
  }

  function syncContext() {
    const context = currentContext();
    if(button)button.hidden=context?.car.status==='판매완료';
    const savedKey=JSON.stringify(savedRecord(context?.car.encarLinks,context?.plate));
    const nextKey = context?.key || '';
    let changed=false;
    if (nextKey !== contextKey || (context?.actor || null) !== contextActor || !!context?.ready !== contextReady || (context?.car || null) !== contextCar || (context?.storage?.key || '') !== contextStorageKey) {
      changed=true;
      cancel();
      contextKey = nextKey;
      contextActor = context?.actor || null;
      contextReady = !!context?.ready;
      contextCar = context?.car || null;
      contextStorageKey = context?.storage?.key || '';
      contextSavedKey = savedKey;
      button.disabled = !context?.plate || !context?.ready;
      renderLookupButton();
      restoreSaved(context);
    }
    if(!active&&savedKey!==contextSavedKey){contextSavedKey=savedKey;if(savedKey!=='null')restoreSaved(context);else {results.replaceChildren();displayedRecord=null;displayedSaved=false;}}
    refreshPriceControls();
    if (directPriceRetry && !directPriceCurrent(directPriceRetry)) directPriceRetry = null;
    if (priceOffer && !priceOfferCurrent(priceOffer)) closePriceConfirmation(true);
    maybeOpenPriceConfirmation();
    if(changed&&!active&&context&&!button.hidden&&cooldownFor(context,'encar'))showCooldown(context,'encar','광고 조회 요청을 잠시 기다리고 있습니다.');
  }

  function resetContext() {
    cancel();
    contextKey = '';
    contextActor = null;
    contextReady = false;
    contextCar = null;
    contextStorageKey = '';contextSavedKey='';
    button.disabled = true;
    renderLookupButton();
  }

  function prepareTab() {
    // Open during the user's click; do not use the noopener feature here,
    // because that would discard the handle required for later navigation.
    let tab;
    try { tab = window.open('about:blank', '_blank'); } catch (_) { return null; }
    if (!tab) return null;
    try {
      tab.opener = null;
      tab.document.title = '엔카 광고 확인 중';
      const viewport=tab.document.createElement('meta');viewport.name='viewport';viewport.content='width=device-width, initial-scale=1';tab.document.head.append(viewport);
      const style=tab.document.createElement('style');style.textContent=`
       *{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:28px;background:#f6f8fb;color:#253449;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif}
       main{text-align:center;width:min(100%,620px)}.scene{position:relative;margin:0 auto 28px;width:230px;height:130px;overflow:hidden}.road{position:absolute;left:0;right:0;bottom:20px;height:1px;background:#dae2eb}.car{position:absolute;left:42px;top:35px;width:135px;height:64px;color:#567a9e;animation:drive 2.6s ease-in-out infinite}.scan{position:absolute;width:55px;height:55px;border:3px solid #ed6372;border-radius:50%;left:140px;top:15px;animation:scan 2.6s ease-in-out infinite}.scan:after{content:'';position:absolute;width:24px;height:3px;background:#ed6372;right:-18px;bottom:-8px;transform:rotate(45deg);border-radius:4px}
       h1{font-size:clamp(20px,4.5vw,28px);font-weight:700;letter-spacing:-1px;line-height:1.5;margin:0 0 12px;word-break:keep-all}p{font-size:14px;color:#8c98a8;line-height:1.7;margin:0}.dots{display:flex;justify-content:center;gap:7px;margin-top:25px}.dots i{width:6px;height:6px;border-radius:50%;background:#9eb2c8;animation:pulse 1.3s ease-in-out infinite}.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
       @keyframes drive{0%,100%{transform:translateX(-9px)}50%{transform:translateX(9px)}}@keyframes scan{0%,100%{transform:translateX(-40px)}50%{transform:translateX(4px)}}@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}
      `;tab.document.head.append(style);
      const content=tab.document.createElement('main');content.setAttribute('role','status');content.setAttribute('aria-live','polite');
      content.innerHTML='<div class="scene" aria-hidden="true"><div class="road"></div><svg class="car" viewBox="0 0 140 65" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 43v-17l19-4 14-15h42l17 20 17 5v14H15zM37 22h58M53 8l-9 14M86 8l9 14M112 33h8"/><circle cx="38" cy="45" r="10" fill="#f6f8fb"/><circle cx="103" cy="45" r="10" fill="#f6f8fb"/></svg><div class="scan"></div></div><h1>해당 차량의 엔카 광고를 찾고 있어요!</h1><p>차량번호와 광고 정보를 확인하고 있어요.<br>확인이 끝나면 광고 페이지로 이동합니다.</p><div class="dots" aria-hidden="true"><i></i><i></i><i></i></div>';
      tab.document.body.replaceChildren(content);
    } catch (_) { /* The result links remain available in S-NOTE. */ }
    return tab;
  }

  function priceApplyAllowed(context, record, item) {
    return !!context?.ready && !!context.storage?.canWrite && context.car.status !== '판매완료' && displayedSaved &&
      !active && !retryRecord && !applyJob && !priceOffer && !isExternal(item) && ['verified','review'].includes(item?.priceStatus) &&
      document.getElementById('vehicle-overlay')?.getAttribute('aria-busy') !== 'true' &&
      (!priceWritePending() || directPriceRetry.listingId === item.id) &&
      (typeof window.snoteEncarLinksBridge?.changePrice === 'function' || typeof window.snoteEncarLinksBridge?.applyPrice === 'function') &&
      JSON.stringify(record) === JSON.stringify(savedRecord(context.car.encarLinks, context.plate));
  }

  function currentSalePrice(context) {
    const value = Number(context?.car.sell ?? 0);
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_PRICE_WON) return null;
    const input = document.getElementById('detail-sell');
    if (input) {
      const raw = input.value.replaceAll(',', '').trim();
      if (input.disabled || input.readOnly || !/^\d*$/.test(raw) || Number(raw || 0) !== value) return null;
    }
    return value;
  }

  function directPriceCurrent(job) {
    const context = currentContext();
    return !!job && !!context?.ready && context.storage?.canWrite && context.car.status !== '판매완료' &&
      context.actor === job.context.actor && context.car === job.context.car && context.key === job.context.key &&
      (context.storage?.key || '') === (job.context.storage?.key || '') &&
      JSON.stringify(job.record) === JSON.stringify(displayedRecord) &&
      JSON.stringify(job.record) === JSON.stringify(savedRecord(context.car.encarLinks, context.plate));
  }

  function refreshSavedList(context) {
    try { window.snoteEncarLinksBridge?.refreshList?.(context.storage); } catch (_) { /* A list repaint cannot undo an acknowledged save. */ }
  }

  function priceToast(message) {
    try { if (typeof window.toast === 'function') window.toast(message); } catch (_) { /* A notice cannot undo an acknowledged save. */ }
  }

  function priceWritePending() {
    return directPriceRetry && directPriceCurrent(directPriceRetry) && Number(currentContext()?.car.sell) === directPriceRetry.priceWon;
  }

  function priceOfferCurrent(offer) {
    const context = currentContext();
    return !!offer && offer.epoch === priceOfferEpoch && !!context?.ready && context.storage?.canWrite &&
      context.car.status !== '판매완료' && context.actor === offer.context.actor && context.car === offer.context.car &&
      context.key === offer.context.key && (context.storage?.key || '') === (offer.context.storage?.key || '') &&
      JSON.stringify(offer.record) === JSON.stringify(displayedRecord) &&
      JSON.stringify(offer.record) === JSON.stringify(savedRecord(context.car.encarLinks, context.plate)) &&
      (offer.saving || currentSalePrice(context) === offer.expectedSellWon ||
       offer.retryStagedPrice && currentSalePrice(context) === offer.selected?.priceWon);
  }

  function closePriceConfirmation(force = false) {
    if (priceOffer?.saving && !force) return;
    ++priceOfferEpoch;
    if (priceOffer?.timer) clearInterval(priceOffer.timer);
    priceOffer = null;
    if (priceDialog?.open) priceDialog.close();
    if (priceDialogBody) priceDialogBody.replaceChildren();
    if (priceDialogStatus) priceDialogStatus.textContent = '';
    refreshPriceControls();
  }

  function queuePriceConfirmation(context, record, preferredId = null) {
    if (!context?.ready || !context.storage?.canWrite || context.car.status === '판매완료' ||
        typeof window.snoteEncarLinksBridge?.changePrice !== 'function') return false;
    const expectedSellWon = currentSalePrice(context);
    if (expectedSellWon === null) return false;
    const choices = record.listings.filter(item => !isExternal(item) && ['verified','review'].includes(item.priceStatus) && item.priceWon !== expectedSellWon);
    if (!choices.length || preferredId && !choices.some(item => item.id === preferredId)) return false;
    pendingPriceOffer = {context, record, choices, preferredId, expectedSellWon};
    return true;
  }

  function maybeOpenPriceConfirmation() {
    const pending = pendingPriceOffer, context = currentContext();
    if (!pending || active || retryRecord || applyJob || priceOffer || !displayedSaved) return;
    const item = pending.choices[0];
    if (!priceApplyAllowed(context, pending.record, item) || context.actor !== pending.context.actor || context.car !== pending.context.car ||
        context.key !== pending.context.key || (context.storage?.key || '') !== (pending.context.storage?.key || '') ||
        currentSalePrice(context) !== pending.expectedSellWon) { pendingPriceOffer = null; return; }
    if ([...document.querySelectorAll('dialog[open]')].some(dialog => dialog !== priceDialog)) return;
    pendingPriceOffer = null;
    const offer = {...pending, epoch: ++priceOfferEpoch, saving: false, selected: null};priceOffer = offer;
    const single = pending.preferredId ? pending.choices.find(entry => entry.id === pending.preferredId) :
      pending.record.listings.length === 1 && pending.choices.length === 1 ? pending.choices[0] : null;
    priceDialogBody.replaceChildren();priceDialogStatus.textContent = '';priceDialogConfirm.disabled = !single;priceDialogCancel.disabled = false;
    const car = document.createElement('p');car.className = 'snote-encar-price-confirm-car';car.textContent = [context.car.model, context.car.plate].filter(Boolean).join(' · ');
    const current = document.createElement('p');current.className = 'snote-encar-price-confirm-current';current.textContent = '현재 판매예정가 ' + offer.expectedSellWon.toLocaleString('ko-KR') + '원';
    const original=document.createElement('a');original.className='snote-encar-price-confirm-original';original.textContent='원본 광고 보기';original.target='_blank';original.rel='noopener noreferrer';original.hidden=true;
    const selectOriginal=choice=>{if(choice){original.href=choice.sellerUrl;original.hidden=false;}else{original.removeAttribute('href');original.hidden=true;}};
    priceDialogBody.append(car, current);
    if (single) {
      offer.selected = single;
      const amount = document.createElement('strong');amount.className = 'snote-encar-price-confirm-amount';amount.textContent = '엔카 광고가 ' + single.priceWon.toLocaleString('ko-KR') + '원';priceDialogBody.append(amount);selectOriginal(single);
    } else {
      const help = document.createElement('p');help.textContent = '확인된 광고가 여러 개입니다. 반영할 광고 가격을 선택하세요.';priceDialogBody.append(help);
      for (const choice of offer.choices) {
        const label = document.createElement('label'),radio = document.createElement('input'),text = document.createElement('span');radio.type = 'radio';radio.name = 'snote-encar-confirm-listing';radio.value = choice.id;
        text.textContent = [choice.model || '광고', choice.id, choice.priceWon.toLocaleString('ko-KR') + '원'].join(' · ');label.append(radio, text);priceDialogBody.append(label);
        radio.onchange = () => {if (!offer.saving && priceOfferCurrent(offer)) {offer.selected = radio.checked ? choice : null;priceDialogConfirm.disabled = !offer.selected;selectOriginal(offer.selected);}};
      }
    }
    priceDialogBody.append(original);priceDialog.showModal();priceDialogCancel.focus();refreshPriceControls();
    offer.timer = setInterval(() => {if (priceOffer !== offer || !priceOfferCurrent(offer)) closePriceConfirmation(true);},250);
  }

  async function confirmPriceChange() {
    const offer = priceOffer;
    if (!offer || offer.saving || !offer.selected || !priceOfferCurrent(offer)) return;
    offer.saving = true;priceDialogConfirm.disabled = true;priceDialogCancel.disabled = true;priceDialogStatus.textContent = '판매예정가를 변경하고 있습니다…';
    try {
      const result = await window.snoteEncarLinksBridge.changePrice(offer.context.storage, offer.record, offer.selected.id, {expectedSellWon:offer.expectedSellWon});
      if (priceOffer !== offer || !priceOfferCurrent(offer)) return;
      if (result?.ok !== true || result.priceWon !== offer.selected.priceWon || result.saved !== true) throw Error('PRICE_SAVE_NOT_CONFIRMED');
      closePriceConfirmation(true);priceToast('저장 되었습니다.');refreshSavedList(offer.context);
    } catch (_) {
      if (priceOffer === offer && priceOfferCurrent(offer)) {
        // A failed server acknowledgement may leave only this price staged by
        // the persistence bridge. Keep its explicit retry available; the
        // bridge still checks its own pending write and expected-price CAS.
        offer.retryStagedPrice = currentSalePrice(currentContext()) === offer.selected.priceWon;
        priceDialogStatus.textContent = '변경을 확인하지 못했습니다. 현재 가격과 저장 상태를 확인한 뒤 다시 시도해 주세요.';offer.saving = false;priceDialogConfirm.disabled = false;priceDialogCancel.disabled = false;
      }
    }
  }

  function refreshPriceControls() {
    if (!results) return;
    const context = currentContext();
    for (const control of results.querySelectorAll('.snote-encar-price-apply')) {
      const item = displayedRecord?.listings.find(entry => entry.id === control.dataset.listingId);
      control.hidden = !context?.storage?.canWrite || context.car.status === '판매완료' || isExternal(item) || !['verified','review'].includes(item?.priceStatus) ||
        !(typeof window.snoteEncarLinksBridge?.changePrice === 'function' || typeof window.snoteEncarLinksBridge?.applyPrice === 'function');
      control.disabled = !priceApplyAllowed(context, displayedRecord, item);
    }
  }

  async function applyPrice(record, item) {
    const context = currentContext();
    if (!priceApplyAllowed(context, record, item) || JSON.stringify(displayedRecord) !== JSON.stringify(record)) return;
    if (typeof window.snoteEncarLinksBridge?.changePrice === 'function') {
      const price = currentSalePrice(context), retry = directPriceRetry && directPriceCurrent(directPriceRetry) &&
        directPriceRetry.listingId === item.id && directPriceRetry.priceWon === item.priceWon ? directPriceRetry : null;
      if (price === null || retry && price !== retry.expectedSellWon && price !== retry.priceWon) {
        priceToast('입력 중인 판매가를 확인해 주세요.');return;
      }
      if (!retry && price === item.priceWon) {priceToast('현재 판매가와 같은 금액입니다.');return;}
      const job = {version: ++applyVersion, context, record, listingId:item.id, priceWon:item.priceWon,
        expectedSellWon: retry ? retry.expectedSellWon : price};applyJob = job;pendingPriceOffer = null;
      button.disabled = true;refreshPriceControls();
      try {
        const result = await window.snoteEncarLinksBridge.changePrice(context.storage,record,item.id,{expectedSellWon:job.expectedSellWon});
        if (applyJob !== job || job.version !== applyVersion || !directPriceCurrent(job)) return;
        if (result?.ok !== true || result.priceWon !== item.priceWon || result.saved !== true) throw Error('PRICE_SAVE_NOT_CONFIRMED');
        directPriceRetry = null;priceToast('저장 되었습니다.');
        refreshSavedList(context);
      } catch (_) {
        if (applyJob === job && job.version === applyVersion && directPriceCurrent(job)) {
          directPriceRetry = job;priceToast('저장 확인이 필요합니다.');
        }
      } finally {
        if (applyJob === job) {applyJob = null;button.disabled = !currentContext()?.plate || !currentContext()?.ready;refreshPriceControls();}
      }
      return;
    }
    const job = {version: ++applyVersion, context, record}; applyJob = job;
    const current = () => applyJob === job && job.version === applyVersion && currentContext()?.actor === context.actor &&
      currentContext()?.car === context.car && currentContext()?.key === context.key && currentContext()?.ready &&
      (currentContext()?.storage?.key || '') === (context.storage?.key || '') && JSON.stringify(displayedRecord) === JSON.stringify(record);
    button.disabled = true; refreshPriceControls();
    try {
      const result = await window.snoteEncarLinksBridge.applyPrice(context.storage, record, item.id);
      if (!current()) return;
      if (result?.ok !== true || result.priceWon !== item.priceWon || result.saved !== false) throw Error('UNCONFIRMED_PRICE_DRAFT');
      priceToast('입력했습니다. 저장을 눌러 주세요.');
    } catch (_) {
      if (current()) priceToast('가격을 입력하지 못했습니다.');
    } finally {
      if (applyJob === job) {
        applyJob = null;
        button.disabled = !currentContext()?.plate || !currentContext()?.ready;
        refreshPriceControls();
      }
    }
  }

  function showListings(record, recheck = false, confirmed = false) {
    const listings = record.listings;
    displayedRecord = record; displayedSaved = confirmed;
    results.classList.toggle('snote-encar-external-results', listings.some(isExternal));
    results.replaceChildren();
    for (const item of listings) {
      const seller = detailUrl(item.sellerUrl, item.id);
      const trusted = String(item.trustedId) !== String(item.id) ? detailUrl(item.trustedUrl, item.trustedId) : null;
      if (!seller) continue;
      const row = document.createElement('div');
      row.className = 'snote-encar-result';
      const label = document.createElement('span');
      if (listings.length > 1) { label.textContent = String(item.model || '') + ' · ' + item.id; row.append(label); }
      if (isExternal(item)) row.append(externalStatus(item));
      for (const [text, url] of [['판매자 광고', seller], ['엔카 믿고', trusted]]) {
        if (!url) continue;
        const anchor = document.createElement('a');
        anchor.textContent = text;
        anchor.href = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        const selectedAutomaticPrice = !isExternal(item) && listings.length > 1 && !['verified','review'].includes(item.priceStatus) &&
          currentContext()?.storage?.canWrite && currentContext()?.car.status !== '판매완료' &&
          typeof window.snoteEncarLinksBridge?.autoPrice === 'function';
        if (!isExternal(item) && (recheck || selectedAutomaticPrice)) anchor.addEventListener('click', event => {
          event.preventDefault();
          if (active) return;
          const id = text === '엔카 믿고' ? String(item.trustedId) : String(item.id);
          lookup([...new Set([String(item.id), id])], {sellerId: String(item.id), id, trusted: text === '엔카 믿고'});
        });
        row.append(anchor);
      }
      if (!isExternal(item) && Object.hasOwn(item, 'priceStatus')) {
        const info = document.createElement('div'); info.className = 'snote-encar-price-info';
        const price = document.createElement('strong'); price.className = 'snote-encar-price-value';
        price.textContent = ['verified','review'].includes(item.priceStatus) ? '엔카 광고가 ' + item.priceWon.toLocaleString('ko-KR') + '원' : '광고 가격 확인 불가';
        info.append(price);
        if (['verified','review'].includes(item.priceStatus)) {
          const checked = document.createElement('time'); checked.className = 'snote-encar-price-checked'; checked.dateTime = item.priceCheckedAt;checked.hidden = true;
          checked.textContent = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(new Date(item.priceCheckedAt)) + ' 확인';
          price.dataset.tooltip = checked.textContent;
          const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'snote-encar-price-apply'; apply.dataset.listingId = item.id;
          apply.setAttribute('aria-label', '판매가 변경');apply.textContent = '판매가 변경';
          apply.onclick = () => applyPrice(record, item);
          info.append(checked, apply);
        }
        row.append(info);
      }
      results.append(row);
    }
    refreshPriceControls();
  }

  function lookup(manualIds = null, selectedLink = null, options = {}) {
    syncContext();
    const existing=currentContext();
    if(active&&sameLookup(active,existing)){button.disabled=true;renderLookupButton(true);return active.promise;}
    if (applyJob || priceOffer?.saving || priceWritePending() || document.getElementById('vehicle-overlay')?.getAttribute('aria-busy') === 'true') return;
    const context = currentContext();
    if (!context || !/^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/.test(context.plate)) {
      setNote('차량번호를 확인해 주세요.', true);
      return;
    }
    if (!window.zc86Cloud?.ready) {
      setNote('S-NOTE 온라인 로그인 후 사용할 수 있습니다.', true);
      return;
    }
    if(cooldownFor(context,'encar')){showCooldown(context,'encar','광고 조회 요청을 잠시 기다리고 있습니다.');return Promise.resolve(false);}
    cancel();
    restoreSaved(context);
    const job = {...context, controller: new AbortController(), waitingTab: prepareTab(), timedOut: false,deadline:Date.now()+REQUEST_TIMEOUT,lookupAttempts:0,priceAttempts:0,clientRequestCount:0};
    active = job;
    refreshPriceControls();
    button.disabled = true;
    renderLookupButton(true);
    setNote('차량번호와 광고 상태를 확인하고 있습니다.');
    const timeout = setTimeout(() => { job.timedOut = true; job.controller.abort(); }, REQUEST_TIMEOUT);
    let resolve,reject;job.promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    performLookup(job,context,manualIds,selectedLink,options,timeout).then(resolve,reject);
    return job.promise;
  }

  async function performLookup(job,context,manualIds,selectedLink,options,timeout) {
    try {
      const token = await abortable(window.zc86Cloud.getAccessToken(), job.controller.signal);
      if (!stillCurrent(job)) { closeWaitingTab(job); return; }
      if (!token) throw lookupError('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.', 'AUTH_REQUIRED');
      const discovery = discoveryHints(context.car);
      const sourceUrls = Array.isArray(options.sourceUrls) ? options.sourceUrls.map(manualExternalSource).filter(Boolean)
        .filter(source => manualIds?.includes(source.id)).map(source => source.sourceUrl).slice(0, 3) : [];
      const payload=JSON.stringify({plate: context.plate, candidateIds: manualIds === null ?
          [...new Set([...(savedRecord(context.car.encarLinks, context.plate)?.listings.map(item => item.id) || []), ...readCandidates(context.plate)])].slice(0, 12) : manualIds,
          ...(discovery ? {discovery} : {}), ...(sourceUrls.length ? {sourceUrls} : {})});
      const outcome=await requestLookup(job,payload,token),{response,data,parseError,json}=outcome;
      if (!stillCurrent(job)) { closeWaitingTab(job); return; }
      diagnosticSnapshot=null;copyButton.hidden=true;copyFallback.hidden=true;copyFallback.value='';copyStatus.textContent='';
      if (!json) {
        setDiagnostics(outcome.diagnostics,response.status,response.status>=500?'SERVER_UNAVAILABLE':'HTTP_ERROR',{endpoint:'encar',attempt:job.lookupAttempts,retryAfterSeconds:job.retryAfterSeconds,clientRequestCount:job.clientRequestCount});
        if (response.status >= 500) throw lookupError(ERROR_MESSAGES.SERVER_UNAVAILABLE, 'SERVER_UNAVAILABLE');
        throw lookupError('엔카 조회 기능이 아직 연결되지 않았습니다. 관리자에게 문의해 주세요.');
      }
      if(parseError){const error=parseError;
        const requestError = typeof error?.code === 'string' && Object.hasOwn(REQUEST_MESSAGES, error.code) ||
          error?.message === 'SESSION_CONTEXT_CHANGED';
        if (response.status >= 500 && !job.controller.signal.aborted && stillCurrent(job) && !requestError) {
          setDiagnostics({...outcome.diagnostics,code:parseError.responseTooLarge?'INVALID_RESPONSE':'SERVER_UNAVAILABLE'},response.status,'SERVER_UNAVAILABLE',{endpoint:'encar',attempt:job.lookupAttempts,retryAfterSeconds:job.retryAfterSeconds,clientRequestCount:job.clientRequestCount});
          throw lookupError(ERROR_MESSAGES.SERVER_UNAVAILABLE, 'SERVER_UNAVAILABLE');
        }
        throw error;
      }
      if (!stillCurrent(job)) { closeWaitingTab(job); return; }
      if (!response.ok || data?.status === 'error') {
        addEdgeEvidence(job.responseEvidence, data);
        const messages = {
          401: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.',
          403: '이 기능을 사용할 수 있는 직원 권한을 확인해 주세요.',
          503: ERROR_MESSAGES.SERVER_UNAVAILABLE
        };
        const code = setDiagnostics(outcome.diagnostics, response.status, 'HTTP_ERROR',{endpoint:'encar',attempt:job.lookupAttempts,retryAfterSeconds:job.retryAfterSeconds,clientRequestCount:job.clientRequestCount});
        if (response.status >= 500 && CATALOG_FAILURES.has(code)) manual.hidden = false;
        throw lookupError(REQUEST_MESSAGES[code] || ERROR_MESSAGES[code] || messages[response.status] || '지금은 광고를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.');
      }
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.plate !== context.plate || !Array.isArray(data.listings) || !['found','multiple','unverified'].includes(data.status)) {
        throw lookupError('광고 확인 응답이 올바르지 않습니다. 다시 시도해 주세요.');
      }
      const listings = data.listings;
      if (data.status === 'unverified') {
        if (listings.length) throw lookupError('광고 확인 응답이 올바르지 않습니다. 다시 시도해 주세요.');
        closeWaitingTab(job);
        if (manualIds === null) { try { localStorage.removeItem(CACHE_PREFIX + context.plate); } catch (_) {} }
        const code = setDiagnostics(data.diagnostics, response.status, 'UNVERIFIED',{endpoint:'encar',attempt:job.lookupAttempts,clientRequestCount:job.clientRequestCount});
        setNote(UNVERIFIED_MESSAGES[code] || '일치하는 현재 광고를 확인하지 못했습니다. 나중에 다시 확인해 주세요.');
        manual.hidden = false;
        return;
      }
      if (!listings.length || listings.some(item => !item || !detailUrl(item.sellerUrl, item.id)) ||
          (data.status === 'found' && listings.length !== 1) || (data.status === 'multiple' && listings.length < 2) ||
          !data.verifiedAt || !Number.isFinite(Date.parse(data.verifiedAt))) {
        throw lookupError('광고 검증 결과를 확인할 수 없습니다. 다시 시도해 주세요.');
      }
      saveCandidates(context.plate, listings);
      let record = savedRecord({version: 1, plate: context.plate, verifiedAt: data.verifiedAt, listings}, context.plate);
      if (!record) throw lookupError('광고 검증 결과를 확인할 수 없습니다. 다시 시도해 주세요.');
      const automaticId=selectedLink?.sellerId||(record.listings.length===1?record.listings[0].id:null),automaticItem=record.listings.find(item=>item.id===automaticId);
      if (automaticItem && !isExternal(automaticItem) && !['verified','review'].includes(automaticItem.priceStatus) &&
          context.storage?.canWrite && context.car.status!=='판매완료' && typeof window.snoteEncarLinksBridge?.autoPrice==='function') {
        setNote('광고 화면에서 가격을 자동 확인하고 있습니다.');
        const priceTimeout=setTimeout(()=>{job.priceTimedOut=true;job.controller.abort();},Math.max(1,Math.min(AUTO_PRICE_TIMEOUT,job.deadline-Date.now())));
        try {
          const quoted=await requestAutoPrice(job,context,record,automaticId);
          if(!stillCurrent(job)){closeWaitingTab(job);return;}
          const revised=savedRecord(quoted,context.plate),links=value=>value.listings.map(item=>[item.id,item.sellerUrl,item.trustedId,item.trustedUrl]);
          if(!revised||JSON.stringify(links(revised))!==JSON.stringify(links(record)))throw Error('AUTO_PRICE_INVALID');
          record=revised;
        } catch(error) {
          if(!stillCurrent(job)){closeWaitingTab(job);return;}
          const code=job.timedOut||job.priceTimedOut?'AUTO_PRICE_TIMEOUT':error?.code==='AUTH_REQUIRED'?'AUTO_PRICE_AUTH_REQUIRED':typeof error?.code==='string'&&Object.hasOwn(PRICE_MESSAGES,error.code)?error.code:'AUTO_PRICE_UNAVAILABLE';
          job.priceMessage=PRICE_MESSAGES[code];job.priceCode=code;setDiagnostics(diagnosticsInput(error),error?.httpStatus??null,code,{endpoint:'encar-auto-price',attempt:job.priceAttempts||undefined,retryAfterSeconds:job.priceRetryAfterSeconds??retryAfter(error?.retryAfterSeconds)??0,clientRequestCount:job.clientRequestCount});
          record={...record,listings:record.listings.map(item=>item.id===automaticId&&!['verified','review'].includes(item.priceStatus)?{...item,priceWon:null,priceCheckedAt:null,priceSource:null,priceStatus:'unavailable'}:item)};
        }finally{clearTimeout(priceTimeout);}
      }
      if(record.listings.some(item=>!isExternal(item))&&!record.listings.some(item=>!isExternal(item)&&['verified','review'].includes(item.priceStatus))){
        const provider=providerPriceDiagnostics(data.priceDiagnostics,response.status,job.priceCode),code=provider||(typeof data.priceDiagnostics?.code==='string'&&Object.hasOwn(PRICE_MESSAGES,data.priceDiagnostics.code)?data.priceDiagnostics.code:null);
        if(code&&!job.priceMessage){job.priceMessage=PRICE_MESSAGES[code];if(!provider)setDiagnostics({code},response.status,code);}
      }
      showListings(record);
      const willConfirmPrice = queuePriceConfirmation(context, record, selectedLink?.sellerId || null);
      if (record) void persistListings(context, record);
      if (willConfirmPrice) {
        closeWaitingTab(job);
        setNote('엔카 광고가격을 확인했습니다. 저장 확인 후 변경 여부를 선택해 주세요.');
        return;
      }
      if (selectedLink) {
        const selected = listings.find(item => String(item.id) === selectedLink.sellerId);
        const selectedUrl = selected && (selectedLink.trusted ?
          (String(selected.trustedId) === selectedLink.id && detailUrl(selected.trustedUrl, selectedLink.id)) : detailUrl(selected.sellerUrl, selectedLink.id));
        if (!selectedUrl) {
          closeWaitingTab(job);
          setNote('저장된 광고의 상태가 변경되었습니다. 확인된 링크를 선택해 주세요.');
        } else if (job.waitingTab && !job.waitingTab.closed) {
          job.waitingTab.location.replace(selectedUrl); job.waitingTab = null;
          setNote('저장된 광고를 다시 확인해 열었습니다.');
        } else setNote('광고를 확인했습니다. 링크를 눌러 열어 주세요.');
        return;
      }
      if (data.status === 'multiple' || listings.length !== 1) {
        closeWaitingTab(job);
        setNote('같은 차량번호의 광고가 여러 개입니다. 열 광고를 선택해 주세요.');
        return;
      }
      const url = detailUrl(listings[0].sellerUrl, listings[0].id);
      if (job.waitingTab && !job.waitingTab.closed) {
        job.waitingTab.location.replace(url);
        job.waitingTab = null;
        setNote('차량번호가 일치하는 광고를 열었습니다.');
      } else {
        setNote('광고를 확인했습니다. 링크를 눌러 열어 주세요.');
      }
    } catch (error) {
      closeWaitingTab(job);
      if (!stillCurrent(job)) return;
      const requestCode = typeof error?.code === 'string' && Object.hasOwn(REQUEST_MESSAGES, error.code) ? error.code :
        error?.message === 'SESSION_CONTEXT_CHANGED' ? error.message : null;
      if (!diagnosticSnapshot||job.timedOut) setDiagnostics(job.timedOut?{...diagnosticSnapshot,code:'CLIENT_TIMEOUT'}:null, job.httpStatus ?? error?.httpStatus, job.timedOut ? 'CLIENT_TIMEOUT' : requestCode || error?.diagnosticCode || 'NETWORK_ERROR',{endpoint:'encar',attempt:job.lookupAttempts||undefined,retryAfterSeconds:job.retryAfterSeconds||0,clientRequestCount:job.clientRequestCount});
      if (job.responseEvidence) Object.assign(diagnosticSnapshot, job.responseEvidence);
      setNote(job.timedOut ? '확인이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.' : REQUEST_MESSAGES[requestCode] || error?.userMessage || '광고 확인에 실패했습니다. 연결 상태를 확인하고 다시 시도해 주세요.', true);
    } finally {
      clearTimeout(timeout);
      if (active === job) {
        active = null;
        button.disabled = !currentContext()?.ready;
        renderLookupButton();
        syncContext();
        if(job.priceMessage)setNote((note.textContent?note.textContent+' ':'')+job.priceMessage,true);
        if(!showCooldown(context,'encar',note.textContent||'광고 조회 요청을 잠시 기다리고 있습니다.')&&job.priceMessage)showCooldown(context,'encar-auto-price',job.priceMessage);
      }
    }
  }

  function verifyManual(event) {
    event.preventDefault();
    syncContext();
    if (manual.hidden || active || applyJob) return;
    const id = candidateFromUrl(manualInput.value);
    if (!id) {
      manualError.textContent = '엔카·외부 광고의 HTTPS 주소를 확인해 주세요.';
      manualInput.focus();
      return;
    }
    const source = manualExternalSource(manualInput.value);
    manualError.textContent = '';
    lookup([id], null, source ? {sourceUrls: [source.sourceUrl]} : {});
  }

  function lookupCurrent(carId, listingId) {
    syncContext();
    const context = currentContext(), id = String(listingId ?? '');
    if (!context?.ready || !context.storage || String(context.car.id) !== String(carId ?? '') || !validId(id)) return false;
    const record = savedRecord(context.car.encarLinks, context.plate), listing = record?.listings.find(item => item.id === id);
    if (!listing) return false;
    if(active&&sameLookup(active,context)){void lookup([id],{sellerId:id,id,trusted:false});return true;}
    if(applyJob || retryRecord || priceOffer?.saving || priceWritePending() ||document.getElementById('vehicle-overlay')?.getAttribute('aria-busy') === 'true')return false;
    if (isExternal(listing)) {
      const tab = prepareTab();
      if (tab && !tab.closed) tab.location.replace(listing.sellerUrl);
      else setNote('저장된 외부 확인 광고의 링크를 눌러 열어 주세요.');
      return true;
    }
    // Keep the user's window-opening gesture synchronous with the list click.
    void lookup([id], {sellerId:id, id, trusted:false});
    return true;
  }

  function mount() {
    const overlay = document.getElementById('vehicle-overlay');
    const meta = document.getElementById('vehicle-meta');
    if (!overlay || !meta) return;
    const style = document.createElement('style');
    style.textContent = '.snote-encar-tools{margin-top:12px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;font-size:12px;line-height:1.6}.snote-encar-button,.snote-encar-manual button{border:1px solid #bae1f5;background:#eef9ff;color:#187bac;padding:7px 12px;border-radius:9px;font:inherit;font-weight:700;cursor:pointer}.snote-encar-button:disabled{opacity:.6;cursor:wait}.snote-encar-note,.snote-encar-copy-status{color:#63758a}.snote-encar-note[data-error=true],.snote-encar-manual-error{color:#b54747}.snote-encar-results{flex-basis:100%;display:grid;gap:6px}.snote-encar-result{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.snote-encar-result span{color:#64748b}.snote-encar-result a{color:#187bac;font-weight:700;text-decoration:underline;text-underline-offset:3px}.snote-encar-manual{flex-basis:100%;min-width:0;max-width:100%}.snote-encar-manual summary{cursor:pointer;color:#187bac;font-weight:700}.snote-encar-manual form{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;min-width:0}.snote-encar-manual label,.snote-encar-manual-error{flex-basis:100%}.snote-encar-manual input{flex:1 1 180px;min-width:0;max-width:100%;border:1px solid #d6e2ee;border-radius:8px;padding:8px;font:inherit;background:white;color:#334155}.snote-encar-save-status{flex-basis:100%;color:#64748b;font-size:11px}.snote-encar-save-status:empty{display:none}.snote-encar-save-retry{border:1px solid #d6e2ee;border-radius:8px;background:#fff;color:#187bac;padding:5px 10px;font:inherit;cursor:pointer}.snote-encar-save-retry:disabled{opacity:.6;cursor:wait}.snote-encar-copy{padding:2px 0;border:0;background:transparent;color:#63758a;font:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer}.snote-encar-copy-fallback{flex-basis:100%;min-width:0;max-width:100%;box-sizing:border-box;height:120px;padding:8px;border:1px solid #d6e2ee;border-radius:8px;font:11px/1.5 monospace;overflow-wrap:anywhere;white-space:pre-wrap}.snote-encar-tools [hidden]{display:none!important}.snote-encar-tools :is(button,a,input,summary,textarea):focus-visible{outline:2px solid #38bdf8;outline-offset:3px}';
    style.textContent += '.snote-encar-button{display:inline-grid;place-items:center;width:44px;height:44px;padding:0;border-radius:12px;color:#d52c3b}.snote-encar-button svg{display:block;width:22px;height:22px}.snote-encar-button.is-loading{cursor:wait;opacity:.6}';
    style.textContent += '.snote-encar-result .snote-encar-price-info{display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px 8px;min-width:0;max-width:100%}.snote-encar-result .snote-encar-price-value{font-size:12px;font-weight:650;color:#334155;font-variant-numeric:tabular-nums}.snote-encar-price-checked{font-size:10px;color:#8792a2;font-variant-numeric:tabular-nums}.snote-encar-result .snote-encar-price-apply{display:inline-flex;align-items:center;justify-content:center;min-height:28px;margin:0;padding:4px 8px;border:0;border-radius:6px;background:#edf5ff;color:#176ce8;font:inherit;font-size:11px;font-weight:600;white-space:nowrap;cursor:pointer}.snote-encar-price-apply:disabled{opacity:.35;cursor:default}.snote-encar-results [hidden]{display:none!important}';
    style.textContent += '.snote-encar-result .snote-encar-external-status{font-size:11px;color:#6b8094;white-space:nowrap;cursor:help}.snote-encar-external-status:focus-visible{outline:2px solid #38bdf8;outline-offset:3px;border-radius:3px}#vehicle-overlay .vehicle-name-links .snote-encar-external-results{flex-basis:100%;width:100%}';
    document.head.append(style);
    priceDialog = document.createElement('dialog');priceDialog.id = 'snote-encar-price-confirm';priceDialog.setAttribute('aria-labelledby','snote-encar-price-confirm-title');
    priceDialog.innerHTML = '<button type="button" class="snote-popup-close" aria-label="판매예정가 변경 닫기">×</button><h2 id="snote-encar-price-confirm-title">판매예정가 변경</h2><p class="snote-encar-price-confirm-question">이 금액으로 변경하시겠습니까?</p><div class="snote-encar-price-confirm-body"></div><p class="snote-encar-price-confirm-status" role="status" aria-live="polite"></p><footer><button type="button" class="snote-encar-price-confirm-cancel">취소</button><button type="button" class="snote-encar-price-confirm-save">변경</button></footer>';
    document.body.append(priceDialog);priceDialogBody = priceDialog.querySelector('.snote-encar-price-confirm-body');priceDialogStatus = priceDialog.querySelector('[role=status]');priceDialogConfirm = priceDialog.querySelector('.snote-encar-price-confirm-save');priceDialogCancel = priceDialog.querySelector('.snote-encar-price-confirm-cancel');
    priceDialogConfirm.onclick = confirmPriceChange;priceDialogCancel.onclick = () => closePriceConfirmation();priceDialog.querySelector('.snote-popup-close').onclick = () => closePriceConfirmation();priceDialog.addEventListener('cancel',event => {event.preventDefault();closePriceConfirmation();});
    document.addEventListener('keydown',event => {if(event.key === 'Escape' && priceDialog.open) {event.preventDefault();event.stopImmediatePropagation();closePriceConfirmation();}},true);
    document.addEventListener('close',() => maybeOpenPriceConfirmation(),true);
    style.textContent += '#snote-encar-price-confirm{box-sizing:border-box;width:min(460px,calc(100vw - 32px));max-height:calc(100dvh - 48px);margin:auto;padding:30px 24px 22px;border:1px solid #e5e9ef;border-radius:18px;background:#fff;color:#263348;box-shadow:0 20px 70px #172b4d24;overflow:auto;font-family:inherit}#snote-encar-price-confirm::backdrop{background:#23334842;backdrop-filter:blur(4px)}#snote-encar-price-confirm>.snote-popup-close{position:absolute;right:10px;top:10px}#snote-encar-price-confirm h2{margin:0 28px 10px 0;font-size:19px}#snote-encar-price-confirm p{font-size:13px;line-height:1.6}#snote-encar-price-confirm .snote-encar-price-confirm-car{color:#7b8798;font-size:12px}#snote-encar-price-confirm .snote-encar-price-confirm-current{margin:18px 0 6px;color:#718096}#snote-encar-price-confirm .snote-encar-price-confirm-amount{display:block;font-size:21px;color:#176ce8;font-variant-numeric:tabular-nums}#snote-encar-price-confirm label{display:flex;align-items:center;gap:9px;margin:8px 0;padding:10px;border:1px solid #e6ebf3;border-radius:9px;font-size:13px}#snote-encar-price-confirm [role=status]{color:#64748b;min-height:20px;margin:14px 0 0}#snote-encar-price-confirm footer{display:flex;justify-content:flex-end;gap:9px;margin-top:16px}#snote-encar-price-confirm footer button{min-height:36px;padding:8px 15px;border:0;border-radius:8px;background:#f1f4f8;color:#526075;font:inherit;font-size:13px;cursor:pointer}#snote-encar-price-confirm .snote-encar-price-confirm-save{background:#176ce8;color:#fff}#snote-encar-price-confirm button:disabled{opacity:.45;cursor:wait}@media(prefers-reduced-motion:no-preference){#snote-encar-price-confirm[open]{animation:snote-encar-price-in .18s ease-out}@keyframes snote-encar-price-in{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}}';
    bar = document.createElement('div');
    style.textContent += '#snote-encar-price-confirm .snote-encar-price-confirm-original{color:#176ce8;font-size:12px;text-decoration:underline;text-underline-offset:3px;margin-top:10px}#snote-encar-price-confirm [hidden]{display:none!important}';
    bar.className = 'snote-encar-tools';
    // Keep the header control in the page itself, so slow asset loading never
    // removes the action. Reuse it here; older pages still get the same fallback.
    button = document.getElementById('vehicle-encar-check') || document.createElement('button');
    button.id = 'vehicle-encar-check';
    button.type = 'button';
    button.className = 'snote-encar-button vehicle-header-action';
    renderLookupButton();
    button.disabled = true;
    button.addEventListener('click', () => lookup());
    note = document.createElement('span');
    note.className = 'snote-encar-note';
    note.setAttribute('role','status');
    note.setAttribute('aria-live','polite');
    results = document.createElement('div');
    results.className = 'snote-encar-results';
    saveStatus = document.createElement('span'); saveStatus.className = 'snote-encar-save-status'; saveStatus.setAttribute('role', 'status');
    saveRetry = document.createElement('button'); saveRetry.type = 'button'; saveRetry.className = 'snote-encar-save-retry'; saveRetry.textContent = '링크 저장 다시 시도'; saveRetry.hidden = true;
    saveRetry.addEventListener('click', async () => {
      const context = currentContext(), record = retryRecord;
      if (!context || !record || active) return;
      saveRetry.disabled = true;
      await persistListings(context, record);
      if (currentContext()?.key === context.key && currentContext()?.actor === context.actor) saveRetry.disabled = false;
    });
    manual = document.createElement('details'); manual.className = 'snote-encar-manual'; manual.hidden = true;
    const summary = document.createElement('summary'); summary.textContent = '광고 주소로 확인';
    const form = document.createElement('form'); form.noValidate = true; form.addEventListener('submit', verifyManual);
    const label = document.createElement('label'); label.htmlFor = 'snote-encar-manual-url'; label.textContent = '엔카·외부 광고 주소';
    manualInput = document.createElement('input'); manualInput.id = 'snote-encar-manual-url'; manualInput.type = 'url'; manualInput.inputMode = 'url'; manualInput.maxLength = 2048; manualInput.autocomplete = 'off'; manualInput.spellcheck = false; manualInput.placeholder = '엔카·외부 광고 주소';
    manualButton = document.createElement('button'); manualButton.type = 'submit'; manualButton.textContent = '주소 확인';
    manualError = document.createElement('span'); manualError.className = 'snote-encar-manual-error'; manualError.setAttribute('role', 'status');
    form.append(label, manualInput, manualButton, manualError); manual.append(summary, form);
    copyButton = document.createElement('button'); copyButton.type = 'button'; copyButton.className = 'snote-encar-copy'; copyButton.textContent = '진단 정보 복사'; copyButton.hidden = true; copyButton.addEventListener('click', copyDiagnostics);
    copyStatus = document.createElement('span'); copyStatus.className = 'snote-encar-copy-status'; copyStatus.setAttribute('role', 'status');
    copyFallback = document.createElement('textarea'); copyFallback.className = 'snote-encar-copy-fallback'; copyFallback.readOnly = true; copyFallback.hidden = true; copyFallback.setAttribute('aria-label', '복사할 진단 정보');
    bar.append(note, saveStatus, saveRetry, manual, copyButton, copyStatus, copyFallback);
    meta.insertAdjacentElement('afterend', bar);
    const title = document.getElementById('vehicle-title');
    if (title) title.insertAdjacentElement('afterend', results);
    else bar.append(results);
    const headerActions = document.getElementById('vehicle-header-actions');
    if (headerActions) headerActions.prepend(button);
    else bar.prepend(button);
    new MutationObserver(syncContext).observe(overlay, {attributes:true,attributeFilter:['class','aria-busy']});
    new MutationObserver(syncContext).observe(meta, {childList:true,subtree:true,characterData:true});
    for (const id of ['zc-cloud-gate', 'zc86-topbar']) {
      const element = document.getElementById(id);
      if (element) new MutationObserver(syncContext).observe(element, {attributes:true,attributeFilter:['hidden']});
    }
    const cloudStatus = document.getElementById('zc-cloud-status');
    if (cloudStatus) new MutationObserver(syncContext).observe(cloudStatus, {
      attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true, characterData: true
    });
    window.addEventListener('pagehide', resetContext);
    window.addEventListener('pageshow', syncContext);
    window.SnoteEncarLink = Object.freeze({refresh: syncContext, lookupCurrent,readHttpResponse});
    syncContext();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true});
  else mount();
})();
