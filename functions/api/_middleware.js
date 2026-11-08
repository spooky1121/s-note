import { createBurstLimiter, hardenAPIResponse, inspectAPIRequest, securityResponse } from '../_shared/api-security.js';
const limit = createBurstLimiter();

// API-only middleware: static assets remain cacheable at the edge.
export async function onRequest(context) {
  const checked = inspectAPIRequest(context.request);
  if (checked.response) return checked.response;
  const blocked = limit(context.request, checked.path, checked.policy);
  if (blocked) return blocked;
  try { return hardenAPIResponse(await context.next()); }
  catch { return securityResponse('UPSTREAM_ERROR'); } // Never expose a stack or a provider credential.
}
