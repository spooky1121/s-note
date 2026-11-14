import { createBurstLimiter, hardenAPIResponse, inspectAPIRequest, securityResponse, RequestSecurityError } from '../_shared/api-security.js';
import { needsSessionOwnership, requireSessionOwnership } from '../_shared/session-ownership.js';
const limit = createBurstLimiter();

// API-only middleware: static assets remain cacheable at the edge.
export async function onRequest(context) {
  const checked = inspectAPIRequest(context.request);
  if (checked.response) return checked.response;
  const blocked = limit(context.request, checked.path, checked.policy);
  if (blocked) return blocked;
  try {
    if (needsSessionOwnership(context.request, checked.policy)) await requireSessionOwnership(context.request, context.env);
    return hardenAPIResponse(await context.next());
  } catch (error) {
    return securityResponse(error instanceof RequestSecurityError ? error.code : 'UPSTREAM_ERROR');
  } // Never expose a stack, token or provider credential.
}
