// Server-only codec. The envelope and AAD are shared by manual and intake saves.
const DIGITS = /^(?:\d{10}|\d{13})$/;
const ENVELOPE = /^smi1\.[a-f0-9]{24}\.(?:[a-f0-9]{52}|[a-f0-9]{58})$/;
function hex(bytes) { return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(''); }
function unhex(value) { return Uint8Array.from(value.match(/../g), pair => Number.parseInt(pair, 16)); }
function aad(context, id) { return new TextEncoder().encode('snote-manual-identity:v1:' + JSON.stringify([context.company, context.owner, String(id)])); }
async function key(raw, usage) { return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]); }
export async function encryptIdentityCipher(keys, context, id, value) {
  if (!DIGITS.test(value) || !keys?.key) throw new Error('Identity unavailable');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(context, id), tagLength: 128 }, await key(keys.key, 'encrypt'), new TextEncoder().encode(value));
  return `smi1.${hex(iv)}.${hex(new Uint8Array(ciphertext))}`;
}
export async function decryptIdentityCipher(keys, context, id, envelope) {
  if (typeof envelope !== 'string' || !ENVELOPE.test(envelope)) throw new Error('Identity unavailable');
  const [, iv, ciphertext] = envelope.split('.');
  for (const candidate of keys.keys) {
    try {
      const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(iv), additionalData: aad(context, id), tagLength: 128 }, await key(candidate, 'decrypt'), unhex(ciphertext));
      const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (DIGITS.test(value)) return value;
    } catch { /* Bounded key candidates; do not disclose partial values. */ }
  }
  throw new Error('Identity unavailable');
}
