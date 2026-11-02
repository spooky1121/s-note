// Offline test-only implementation of Cloudflare's native HTMLRewriter.
// The production Worker uses its own native implementation and imports no npm package.
import { HTMLRewriter } from '@worker-tools/html-rewriter/base64';

globalThis.HTMLRewriter ??= HTMLRewriter;
