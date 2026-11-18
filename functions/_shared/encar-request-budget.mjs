// Each factory belongs to one operation. No I/O object, token, result, timer,
// pending promise or mutable counter is shared between incoming requests.
export const DEFAULT_REQUEST_BUDGET = 44;
export const REQUEST_BUDGET_STAGES = Object.freeze([
  'auth', 'member', 'search', 'detail', 'catalog', 'model_catalog',
  'external', 'price', 'capture', 'vision'
]);

const STAGES = new Set(REQUEST_BUDGET_STAGES);
const ERROR_CODES = new Set([
  'REQUEST_BUDGET_EXCEEDED', 'DEADLINE_EXCEEDED',
  'INVALID_REQUEST_BUDGET_CONFIG', 'INVALID_REQUEST_BUDGET_STAGE'
]);

export class EncarRequestBudgetError extends Error {
  constructor(code) {
    const safeCode = ERROR_CODES.has(code) ? code : 'INVALID_REQUEST_BUDGET_CONFIG';
    super(safeCode);
    this.name = 'EncarRequestBudgetError';
    this.code = safeCode;
  }
}

/**
 * Account for every actual outbound fetch, including Auth and membership.
 * Call consume immediately before fetch, even when that fetch later fails.
 * A per-operation memo hit may call reuse instead; it never restores capacity.
 * Caller-owned cancellation and the existing operation deadline remain in force.
 */
export function createEncarRequestBudget({ deadline, limit = DEFAULT_REQUEST_BUDGET, now = Date.now } = {}) {
  if (!Number.isSafeInteger(deadline) || deadline < 0 || typeof now !== 'function'
      || !Number.isSafeInteger(limit) || limit < 1 || limit > DEFAULT_REQUEST_BUDGET) {
    throw new EncarRequestBudgetError('INVALID_REQUEST_BUDGET_CONFIG');
  }
  let requestCount = 0, reusedCount = 0;
  function check(stage) {
    if (!STAGES.has(stage)) throw new EncarRequestBudgetError('INVALID_REQUEST_BUDGET_STAGE');
    const current = now();
    if (!Number.isSafeInteger(current) || current < 0) throw new EncarRequestBudgetError('INVALID_REQUEST_BUDGET_CONFIG');
    if (current >= deadline) throw new EncarRequestBudgetError('DEADLINE_EXCEEDED');
  }
  return Object.freeze({
    consume(stage) {
      check(stage);
      if (requestCount >= limit) throw new EncarRequestBudgetError('REQUEST_BUDGET_EXCEEDED');
      return limit - ++requestCount;
    },
    reuse(stage) {
      check(stage);
      reusedCount = Math.min(Number.MAX_SAFE_INTEGER, reusedCount + 1);
      return reusedCount;
    },
    remaining() { return limit - requestCount; },
    diagnostics() {
      return Object.freeze({ requestCount, reusedCount, budgetLimit: limit, remaining: limit - requestCount });
    }
  });
}
