// Server-only, read-only provider status for the authenticated operator route.
// SOLAPI paths are fixed: this helper never sends messages, creates files,
// probes paid OCR, or forwards credentials to a browser-supplied destination.
const SOLAPI_ORIGIN = 'https://api.solapi.com/';
// Official read API contracts:
// https://solapi.com/developers/api/getBalance
// https://solapi.com/developers/api/pricing-getMessagePricing
// https://solapi.com/developers/api/msg-getList
const SOLAPI_PATHS = Object.freeze({
  balance: 'cash/v1/balance',
  pricing: 'pricing/v1/messaging?countryId=82&serviceMethod=MT',
  messages: 'messages/v4/list?limit=20'
});
const MAX_RESPONSE = 512 * 1024, TIMEOUT_MS = 12000;
const REASONS = Object.freeze({
  configuration: '문자 서비스 연결 설정을 확인해 주세요.',
  permission: '문자 서비스의 조회 인증과 권한을 확인해 주세요.',
  limited: '문자 서비스에서 조회 요청을 일시적으로 제한했습니다.',
  timeout: '문자 서비스의 조회 응답 시간이 초과되었습니다.',
  unavailable: '문자 서비스의 조회 응답을 받지 못했습니다.',
  invalid: '문자 서비스의 조회 응답 형식을 확인하지 못했습니다.'
});
const SMS_METRICS = Object.freeze([
  ['balance', '잔액', 'balance', 'balance', 'SOLAPI'],
  ['points', '포인트', 'balance', 'point', 'SOLAPI'],
  ['smsUnitPrice', 'SMS 단가', 'pricing', 'sms', 'SOLAPI 계정 적용 단가'],
  ['lmsUnitPrice', 'LMS 단가', 'pricing', 'lms', 'SOLAPI 계정 적용 단가'],
  ['mmsUnitPrice', 'MMS 단가', 'pricing', 'mms', 'SOLAPI 계정 적용 단가'],
  ['alimtalkUnitPrice', '알림톡 단가', 'pricing', 'ata', 'SOLAPI 계정 적용 단가']
]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const credential = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 4096 && /^[\x21-\x7e]+$/u.test(value.trim()) ? value.trim() : '';
const cancel = response => { try { void response?.body?.cancel().catch(() => {}); } catch {} };
const MESSAGE_TYPES = new Set(['SMS', 'LMS', 'MMS', 'ATA', 'CTA', 'CTI', 'NSA', 'RCS_SMS', 'RCS_LMS', 'RCS_MMS', 'RCS_TPL', 'RCS_LTPL', 'RCS_ITPL', 'FAX', 'VOICE']);

function recentMessages(result) {
  if (!record(result.data?.messageList)) return { items: [], reason: result.reason || REASONS.invalid };
  const items = [];
  for (const [messageId, value] of Object.entries(result.data.messageList)) {
    if (!/^[a-z0-9_-]{1,128}$/iu.test(messageId) || !record(value) || value.messageId !== messageId) continue;
    const date = typeof value.dateCreated === 'string' && value.dateCreated.length <= 50 && /^\d{4}-\d\d-\d\dT/u.test(value.dateCreated) ? Date.parse(value.dateCreated) : NaN;
    const state = ['PENDING', 'SENDING', 'COMPLETE'].includes(value.status) ? value.status : '';
    const code = typeof value.statusCode === 'string' && /^\d{3,6}$/u.test(value.statusCode) ? value.statusCode : '';
    // No text, subject, customFields, provider reason, images or token-bearing
    // URLs ever leave this helper. Provider metadata cannot identify an app user.
    items.push({ messageId, at: Number.isFinite(date) ? new Date(date).toISOString() : null,
      destination: typeof value.to === 'string' && /^\+?\d{7,16}$/u.test(value.to) ? value.to : '미확인',
      type: MESSAGE_TYPES.has(value.type) ? value.type : '미확인',
      status: state && code ? `${state} (${code})` : state || code || '미확인' });
  }
  items.sort((a, b) => (b.at || '').localeCompare(a.at || '') || a.messageId.localeCompare(b.messageId));
  return { items: items.slice(0, 20), reason: null };
}

function timestamp(now) {
  try { const value = Number(now()); return Number.isFinite(value) ? new Date(value).toISOString() : new Date().toISOString(); }
  catch { return new Date().toISOString(); }
}

async function boundedJson(response) {
  const length = Number(response.headers?.get('Content-Length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE) { cancel(response); throw new Error('invalid'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('invalid');
  const chunks = []; let size = 0, complete = false;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > MAX_RESPONSE) throw new Error('invalid');
      chunks.push(next.value);
    }
    complete = true;
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!record(value)) throw new Error('invalid');
    return value;
  } catch { throw new Error('invalid'); }
  finally {
    if (!complete) { try { void reader.cancel().catch(() => {}); } catch {} }
    reader.releaseLock();
  }
}

async function readSolapi(config, kind, { fetchImpl, at }) {
  // Same HMAC-SHA256 scheme as document-mms.solapi. A narrow GET transport
  // allows injected fetch tests without changing the chargeable-send helper.
  const controller = new AbortController(); let timeout;
  const operation = async () => {
    const salt = crypto.randomUUID().replaceAll('-', '');
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(config.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(at + salt));
    const signature = Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, '0')).join('');
    const response = await fetchImpl(SOLAPI_ORIGIN + SOLAPI_PATHS[kind], {
      method: 'GET', redirect: 'manual', cache: 'no-store', signal: controller.signal,
      headers: { Authorization: `HMAC-SHA256 apiKey=${config.key}, date=${at}, salt=${salt}, signature=${signature}`, Accept: 'application/json' }
    });
    if (!response?.ok) {
      cancel(response);
      if ([401, 403].includes(response?.status)) throw new Error('permission');
      if (response?.status === 429) throw new Error('limited');
      throw new Error('unavailable');
    }
    return boundedJson(response);
  };
  const deadline = new Promise((resolve, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, TIMEOUT_MS);
  });
  try { return { data: await Promise.race([operation(), deadline]), reason: null }; }
  catch (error) {
    const known = typeof error?.message === 'string' && Object.hasOwn(REASONS, error.message);
    return { data: null, reason: known ? REASONS[error.message] : error?.name === 'AbortError' ? REASONS.timeout : REASONS.unavailable };
  }
  finally { clearTimeout(timeout); controller.abort(); }
}

async function smsStatus(env, options) {
  const config = { key: credential(env.SOLAPI_API_KEY), secret: credential(env.SOLAPI_API_SECRET) };
  // Reject HMAC header delimiters in server configuration, too.
  if (!/^[a-z0-9_-]{1,256}$/iu.test(config.key)) config.key = '';
  let results;
  if (!config.key || !config.secret || typeof options.fetchImpl !== 'function') {
    results = { balance: { reason: REASONS.configuration }, pricing: { reason: REASONS.configuration }, messages: { reason: REASONS.configuration } };
  } else {
    const [balance, pricing, messages] = await Promise.all([
      readSolapi(config, 'balance', options), readSolapi(config, 'pricing', options), readSolapi(config, 'messages', options)
    ]);
    results = { balance, pricing, messages };
  }
  const metrics = SMS_METRICS.map(([key, label, endpoint, field, source]) => {
    const result = results[endpoint], value = result.data?.[field];
    const matchingPrice = endpoint !== 'pricing' || String(result.data?.countryId) === '82' && result.data?.serviceMethod === 'MT';
    // Missing values are unknown. In particular, never coerce null/"" to 0.
    const valid = matchingPrice && typeof value === 'number' && Number.isFinite(value) && (endpoint !== 'pricing' || value >= 0);
    return { key, label, value: valid ? value : null, unit: '원', source,
      asOf: valid ? options.at : null, unavailableReason: valid ? null : result.reason || REASONS.invalid };
  });
  const available = metrics.filter(metric => metric.value !== null).length;
  const history = recentMessages(results.messages);
  const notes = [
    '현재 문자 서비스 계정에서 조회한 잔액·포인트와 계정 적용 단가입니다. 조회할 수 없는 항목은 미확인으로 표시합니다.',
    '고객 입력 안내는 LMS, 인증번호는 SMS, 사진 서류는 MMS로 발송합니다.',
    '알림톡 단가는 계정 조회 기준이며 현재 고객 입력 링크는 문자로 보냅니다. 알림톡 발송에는 채널·승인 템플릿 연결이 필요합니다.'
  ];
  if (history.reason) notes.push(`SOLAPI 최근 발송 내역을 조회하지 못했습니다. ${history.reason}`);
  else {
    notes.push(history.items.length ? 'SOLAPI 계정의 최근 발송 내역 최대 20건입니다. 서비스 계정 전체 내역이며 S-NOTE 고객 입력 내역과 별도로 표시합니다.' : 'SOLAPI 계정에서 조회된 최근 발송 내역이 없습니다.');
    notes.push('발송 내역은 제공사의 처리 상태와 상태 코드를 표시합니다. 처리 완료 상태만으로 수신 성공을 판단하지 않습니다.');
  }
  return {
    status: available === metrics.length && !history.reason ? 'ok' : available ? 'degraded' : 'unavailable', metrics,
    notes, providerItems: history.items
  };
}

export async function operatorProviderStatus(env = {}, { service, fetchImpl = fetch, now = Date.now } = {}) {
  env = record(env) ? env : {};
  const at = timestamp(now);
  if (service === 'sms') return smsStatus(env, { fetchImpl, at });
  if (service === 'vision') {
    const configured = !!(credential(env.GOOGLE_VISION_API_KEY) && credential(env.SUPABASE_URL) && credential(env.SUPABASE_PUBLISHABLE_KEY));
    return { status: configured ? 'ok' : 'unavailable', metrics: [], notes: [
      configured ? '이미지 인식 사용 설정이 등록되어 있습니다.' : '이미지 인식 서비스 연결 설정을 확인해 주세요.',
      '실제 이용량은 S-NOTE에서 관측한 요청 기준입니다. 제공사 전체 과금·할당량 조회는 연결되지 않았습니다.'
    ] };
  }
  if (service === 'encar') {
    const configured = /^[a-f0-9]{32}$/iu.test(credential(env.CLOUDFLARE_ACCOUNT_ID)) && !!credential(env.CLOUDFLARE_BROWSER_TOKEN);
    return { status: configured ? 'ok' : 'unavailable', metrics: [], notes: [
      configured ? '광고 검색 브라우저 사용 설정이 등록되어 있습니다.' : '광고 검색 브라우저 연결 설정을 확인해 주세요.',
      '검색 성공·오류·소요 시간은 S-NOTE에서 관측한 요청 기준입니다. 브라우저 제공사 전체 과금·할당량 조회는 연결되지 않았습니다.'
    ] };
  }
  if (service === 'server') return { status: 'unavailable', metrics: [], notes: [
    '트래픽은 S-NOTE API 응답에서 관측한 요청·응답량 기준입니다. 정적 파일·캐시를 포함한 클라우드 계정 전체 트래픽·과금 조회는 연결되지 않았습니다.'
  ] };
  return { status: 'unavailable', metrics: [], notes: ['지원하지 않는 서비스입니다.'] };
}
