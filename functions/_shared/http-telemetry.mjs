import { API_POLICIES } from './api-security.js';
import { writeHttpTelemetry } from './service-telemetry.mjs';

// Bound background database work even for public/denied requests. This budget
// drops observations only; it never throttles or changes a business response.
export function createObservationBudget(maximum = 240, periodMs = 60000) {
  let windowStart = null, count = 0;
  return at => {
    if (windowStart === null || at < windowStart || at - windowStart >= periodMs) { windowStart = at; count = 0; }
    if (count >= maximum) return false;
    count++;return true;
  };
}
const admitObservation = createObservationBudget();

// Observe API response bodies in transit. Never clone/buffer customer documents,
// inspect a payload or query string, or perform another authentication request.
export function observeAPIResponse(context, response, startedAt, options = {}) {
  const now = options.now || Date.now, write = options.write || writeHttpTelemetry;
  let endpoint;
  try { endpoint = new URL(context.request.url).pathname; } catch { return response; }
  if (!Object.hasOwn(API_POLICIES, endpoint) || typeof context.waitUntil !== 'function' ||
      typeof context.env?.SUPABASE_SERVICE_ROLE_KEY !== 'string' || !context.env.SUPABASE_SERVICE_ROLE_KEY) return response;
  if (!(options.admit || admitObservation)(now())) return response;
  const method = context.request.method;
  let requestBytes = ['GET','HEAD'].includes(method) ? 0 : null;
  const header = context.request.headers.get('Content-Length');
  if (header !== null && /^\d{1,12}$/.test(header) && Number.isSafeInteger(Number(header))) requestBytes = Number(header);
  const requestId = crypto.randomUUID(), start = Number.isFinite(startedAt) ? startedAt : now();
  let resolve, finished = false, size = 0;
  const completion = new Promise(done => { resolve = done; });
  try { context.waitUntil(completion.then(event => event && write(context.env, event)).catch(() => {})); }
  catch { return response; }
  const finish = failed => {
    if (finished) return;
    finished = true;
    resolve({ userId: null, service: 'http', adId: null, requestId, startedAt: new Date(start).toISOString(), elapsedMs: Math.max(0, Math.min(86400000, Math.round(now() - start))),
      ok: response.ok && !failed, httpStatus: response.status, stage: failed ? 'exception' : 'response',
      endpoint, method, requestBytes, responseBytes: size });
  };
  if (!response.body) { finish(false); return response; }
  let reader;
  try { reader = response.body.getReader(); }
  catch { resolve(null); return response; }
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) { controller.close(); reader.releaseLock(); finish(false); return; }
        size += next.value.byteLength;
        controller.enqueue(next.value);
      } catch (error) { controller.error(error); try { reader.releaseLock(); } catch {} finish(true); }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); } catch {} finally { try { reader.releaseLock(); } catch {} finish(true); }
    }
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
