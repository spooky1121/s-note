import { getResidentEncryptionKeys } from '../api/customer-intake.js';
import { encryptIdentityCipher, decryptIdentityCipher } from './customer-identity-codec.js';

// Rebind encrypted identities to the destination owner, company and vehicle.
// Plaintext exists only within this server call and never enters a response,
// log, transfer job, or ordinary vehicle/customer JSON field.
const INCOME_CIPHER = /^isi1\.[a-f0-9]{24}\.[a-f0-9]{58}$/;
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g), pair => Number.parseInt(pair, 16));
const aad = scope => new TextEncoder().encode('snote-income-settlement:broker-identity:v1:' + JSON.stringify([scope.companyId, scope.ownerId, scope.carId]));
const cryptoError = () => Object.assign(new Error('TRANSFER_ENCRYPTION_REQUIRED'), { code: 'TRANSFER_ENCRYPTION_REQUIRED' });

async function incomeKeys(resident) {
  const keys = [];
  for (const raw of resident.keys || []) {
    const material = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
    keys.push(new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256',
      salt: new TextEncoder().encode('snote-income-settlement:identity:v1:hkdf-salt'),
      info: new TextEncoder().encode('snote-income-settlement:broker-identity:v1:aes-256-gcm') }, material, 256)));
  }
  return keys;
}
async function rewrapIncome(envelope, keys, source, target) {
  if (!INCOME_CIPHER.test(envelope) || !keys.length) throw cryptoError();
  const [, iv, ciphertext] = envelope.split('.');
  for (const raw of keys) {
    let identity;
    try {
      const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(iv), additionalData: aad(source), tagLength: 128 }, key, unhex(ciphertext));
      identity = new TextDecoder('utf-8', { fatal: true }).decode(decrypted);
      if (!/^\d{13}$/.test(identity)) continue;
    } catch { continue; }
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey('raw', keys[0], 'AES-GCM', false, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad(target), tagLength: 128 }, key, new TextEncoder().encode(identity));
    return 'isi1.' + hex(nonce) + '.' + hex(new Uint8Array(encrypted));
  }
  throw cryptoError();
}

export function createTransferRewrapper(env, source, target) {
  let residentPromise, incomePromise;
  const memo = new Map();
  const resident = () => residentPromise ||= getResidentEncryptionKeys(env);
  async function encrypted(value) {
    if (memo.has(value)) return memo.get(value);
    const task = (async () => {
      try {
        const keys = await resident();
        if (value.startsWith('smi1.')) {
          const plain = await decryptIdentityCipher(keys, { company: source.companyId, owner: source.ownerId }, source.carId, value);
          return await encryptIdentityCipher(keys, { company: target.companyId, owner: target.ownerId }, target.carId, plain);
        }
        incomePromise ||= incomeKeys(keys);
        return await rewrapIncome(value, await incomePromise, source, target);
      } catch { throw cryptoError(); }
    })();
    memo.set(value, task); return task;
  }
  return async function rewrap(payload) {
    let nodes = 0;
    async function walk(value, depth) {
      if (++nodes > 100000 || depth > 48) throw cryptoError();
      if (typeof value === 'string') return /^(?:smi1|isi1)\./.test(value) ? encrypted(value) : value;
      if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
      if (Array.isArray(value)) {
        const result = [];
        for (const item of value) result.push(await walk(item, depth + 1));
        return result;
      }
      if (!value || typeof value !== 'object') throw cryptoError();
      const result = Object.create(null);
      for (const [key, item] of Object.entries(value)) {
        const present = item !== null && item !== '';
        if (present && /^identityCipher$/i.test(key) && (typeof item !== 'string' || !item.startsWith('smi1.'))) throw cryptoError();
        if (present && /^privateCipher$/i.test(key) && (typeof item !== 'string' || !item.startsWith('isi1.'))) throw cryptoError();
        if (present && /^(rrnCipher|rrn_cipher)$/i.test(key)) throw cryptoError();
        result[key] = await walk(item, depth + 1);
      }
      return result;
    }
    return walk(payload, 0);
  };
}
