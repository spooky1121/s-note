import { createBurstLimiter, hardenAPIResponse, inspectAPIRequest, securityResponse } from '../_shared/api-security.js';
import { observeAPIResponse } from '../_shared/http-telemetry.mjs';
const limit = createBurstLimiter();

// API-only middleware: static assets remain cacheable at the edge.
export async function onRequest(context) {
  const startedAt = Date.now(), observed = response => observeAPIResponse(context, response, startedAt);
  const checked = inspectAPIRequest(context.request);
  if (checked.response) return observed(checked.response);
  const blocked = limit(context.request, checked.path, checked.policy);
  if (blocked) return observed(blocked);
  try { return observed(hardenAPIResponse(await context.next())); }
  catch { return observed(securityResponse('UPSTREAM_ERROR')); } // Never expose a stack or a provider credential.
}
