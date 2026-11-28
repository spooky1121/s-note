#!/usr/bin/env node
// Local operator OCR lab only. No mock login, dealer API or persistent uploads.
import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_BODY_LIMIT = 6 * 1024 * 1024 + 65536;
const TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf'
}));
const ERRORS = {
  INVALID_REQUEST: [400, '요청 형식을 확인해 주세요.'],
  UNAUTHORIZED: [401, '운영자 로그인이 필요합니다.'],
  FORBIDDEN: [403, '서비스 운영자만 이용할 수 있습니다.'],
  NOT_FOUND: [404, '테스트 화면에서 제공하지 않는 경로입니다.'],
  METHOD_NOT_ALLOWED: [405, '지원하지 않는 요청 방식입니다.'],
  REQUEST_TIMEOUT: [408, '요청 전송 시간이 초과되었습니다. 다시 시도해 주세요.'],
  PAYLOAD_TOO_LARGE: [413, '등록증 이미지는 6MB 이하로 준비해 주세요.'],
  UNSUPPORTED_MEDIA_TYPE: [415, '요청 파일 형식을 확인해 주세요.'],
  RATE_LIMITED: [429, '잠시 후 다시 시도해 주세요.'],
  SETUP_REQUIRED: [503, '로컬 OCR 테스트 연결 설정을 확인해 주세요.'],
  DEV_CONTEXT_ONLY: [503, '로컬 서버는 운영자 인증과 자체 OCR 테스트만 제공합니다.'],
  NETWORK: [502, '운영자 권한 또는 OCR 연결을 확인하지 못했습니다.']
};
const fail = code => Object.assign(new Error(code), { code });
function failure(code) {
  if (!Object.hasOwn(ERRORS, code)) code = 'NETWORK';
  const [status, error] = ERRORS[code];
  return Response.json({ ok: false, code, error }, { status });
}
function bodyBytes(incoming, limit) {
  return new Promise((accept, reject) => {
    const chunks = []; let size = 0, settled = false;
    const timer = setTimeout(() => finish(fail('REQUEST_TIMEOUT')), 30000);
    const clear = () => {
      clearTimeout(timer); incoming.off('data', data); incoming.off('end', end);
      incoming.off('error', error); incoming.off('aborted', aborted);
    };
    const finish = problem => {
      if (settled) return; settled = true; clear();
      if (problem) { chunks.length = 0; incoming.pause(); reject(problem); }
      else accept(Buffer.concat(chunks, size));
    };
    const data = chunk => {
      size += chunk.length;
      if (size > limit) { finish(fail('PAYLOAD_TOO_LARGE')); return; }
      chunks.push(chunk);
    };
    const end = () => finish();
    const error = () => finish(fail('NETWORK'));
    const aborted = () => finish(fail('NETWORK'));
    incoming.on('data', data); incoming.once('end', end);
    incoming.once('error', error); incoming.once('aborted', aborted);
  });
}
function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return (origin === null || origin === new URL(request.url).origin) &&
    !['cross-site', 'same-site'].includes(request.headers.get('Sec-Fetch-Site'));
}
async function operatorContext(request, env) {
  if (request.method !== 'POST') return failure('METHOD_NOT_ALLOWED');
  if (!sameOrigin(request)) return failure('FORBIDDEN');
  if (new URL(request.url).search) return failure('INVALID_REQUEST');
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') return failure('UNSUPPORTED_MEDIA_TYPE');
  const authorization = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(request.headers.get('Authorization') || '');
  if (!authorization || authorization[1].length < 30 || authorization[1].length > 6000) return failure('UNAUTHORIZED');
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await request.arrayBuffer())); }
  catch { return failure('INVALID_REQUEST'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || body.action !== 'context') return failure('DEV_CONTEXT_ONLY');
  const { authorizeOperatorSession } = await import('../functions/api/operator.js');
  const verified = await authorizeOperatorSession(env, authorization[1]);
  if (verified.allowed !== true) return failure('FORBIDDEN');
  // Deliberately serialize neither the recheck closure nor arbitrary Auth data.
  return Response.json({ ok: true, actorId: verified.actorId, sessionId: verified.sessionId, email: verified.email, allowed: true });
}
async function staticFile(url, method) {
  if (!['GET', 'HEAD'].includes(method)) return failure('METHOD_NOT_ALLOWED');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return failure('INVALID_REQUEST'); }
  if (pathname === '/') return new Response(null, { status: 302, headers: { Location: '/operator.html#ocr-lab' } });
  const segments = pathname.split('/');
  if (pathname.includes('\\') || pathname.includes('\0') || segments.some(value => value.startsWith('.') || ['services', 'tests', 'scripts', 'work', 'private', 'uploads', 'attachments', 'backups'].includes(value))) return failure('NOT_FOUND');
  if (!['/operator.html', '/manifest.webmanifest'].includes(pathname) && !pathname.startsWith('/assets/')) return failure('NOT_FOUND');
  const type = TYPES.get(extname(pathname).toLowerCase());
  if (!type || extname(pathname).toLowerCase() === '.html' && pathname !== '/operator.html') return failure('NOT_FOUND');
  const root = await realpath(ROOT), candidate = resolve(ROOT, '.' + pathname);
  let file;
  try { file = await realpath(candidate); }
  catch { return failure('NOT_FOUND'); }
  if (!file.startsWith(root + sep) || pathname.startsWith('/assets/') && !file.startsWith(resolve(root, 'assets') + sep)) return failure('NOT_FOUND');
  const info = await stat(file);
  if (!info.isFile() || info.size > 25 * 1024 * 1024) return failure('NOT_FOUND');
  return new Response(method === 'HEAD' ? null : await readFile(file), { headers: { 'Content-Type': type } });
}
async function send(outgoing, response, method) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, private, max-age=0');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', "base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
  headers.set('Connection', 'close');
  headers.delete('Transfer-Encoding'); headers.delete('Content-Length');
  outgoing.writeHead(response.status, Object.fromEntries(headers));
  if (method === 'HEAD') { await response.body?.cancel(); outgoing.end(); }
  else outgoing.end(Buffer.from(await response.arrayBuffer()));
}

export function createDevelopmentServer({ env = process.env } = {}) {
  // A fresh copy avoids mutating the caller's process environment or credentials.
  const configuration = { ...env, SNOTE_OPERATOR_OCR_PROVIDER: env.SNOTE_OPERATOR_OCR_PROVIDER || 'self' };
  const server = http.createServer({ maxHeaderSize: 16384 }, async (incoming, outgoing) => {
    const controller = new AbortController();
    incoming.on('error', () => controller.abort());
    incoming.once('aborted', () => controller.abort());
    outgoing.once('close', () => { if (!outgoing.writableEnded) controller.abort(); });
    try {
      if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) throw fail('INVALID_REQUEST');
      const host = incoming.headers.host;
      if (!host || /[\s/@\\]/.test(host)) throw fail('INVALID_REQUEST');
      const url = new URL(incoming.url, 'http://' + host);
      if (url.protocol !== 'http:' || url.username || url.password) throw fail('INVALID_REQUEST');
      let response;
      if (url.pathname === '/api/operator' || url.pathname === '/api/operator-ocr') {
        if (incoming.method !== 'POST') throw fail('METHOD_NOT_ALLOWED');
        const preflight = new Request(url, { method: incoming.method, headers: incoming.headers });
        if (!sameOrigin(preflight)) throw fail('FORBIDDEN');
        if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(preflight.headers.get('Authorization') || '')) throw fail('UNAUTHORIZED');
        const limit = url.pathname === '/api/operator' ? 4096 : IMAGE_BODY_LIMIT;
        const declared = incoming.headers['content-length'];
        if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw fail('PAYLOAD_TOO_LARGE');
        if (incoming.headers['content-encoding'] && incoming.headers['content-encoding'] !== 'identity') throw fail('UNSUPPORTED_MEDIA_TYPE');
        const bytes = ['GET', 'HEAD'].includes(incoming.method) ? null : await bodyBytes(incoming, limit);
        const request = new Request(url, { method: incoming.method, headers: incoming.headers, ...(bytes ? { body: bytes } : {}), signal: controller.signal });
        if (url.pathname === '/api/operator') response = await operatorContext(request, configuration);
        else {
          const { onRequest } = await import('../functions/api/operator-ocr.js');
          response = await onRequest({ request, env: configuration });
        }
      } else if (url.pathname.startsWith('/api/')) response = failure('NOT_FOUND');
      else response = await staticFile(url, incoming.method);
      if (!outgoing.destroyed) await send(outgoing, response, incoming.method);
    } catch (error) {
      if (!outgoing.destroyed && !outgoing.headersSent) await send(outgoing, failure(error?.code), incoming.method);
      else if (!outgoing.destroyed) outgoing.end();
    }
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 15000;
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const host = process.env.SNOTE_OCR_DEV_HOST || '127.0.0.1';
  const port = Number(process.env.SNOTE_OCR_DEV_PORT || '3000');
  if (!['127.0.0.1', '::1', '0.0.0.0'].includes(host) || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    process.stderr.write('로컬 서버 주소·포트 설정을 확인해 주세요.\n'); process.exitCode = 1;
  } else {
    const server = createDevelopmentServer();
    server.on('error', () => { process.stderr.write('로컬 서버를 시작하지 못했습니다. 포트 사용 여부를 확인해 주세요.\n'); process.exitCode = 1; });
    server.listen(port, host, () => {
      const address = host === '::1' ? '[::1]' : host === '0.0.0.0' ? '127.0.0.1' : host;
      process.stdout.write('S-NOTE 자체 OCR 테스트: http://' + address + ':' + port + '/operator.html#ocr-lab\n');
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
  }
}
