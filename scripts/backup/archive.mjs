/** Streaming authenticated backups. No network access and no plaintext temp files. */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, link, unlink, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const MAGIC = Buffer.from('SNOTEBA1');
const HEADER_SIZE = 48;
const CHUNK_SIZE = 1024 * 1024;
const MAX_FRAME = 2 * CHUNK_SIZE;
const pathOK = name => /^(database\.dump|inventory\.json|roles\.json|objects\/[a-f0-9]{64}\.blob)$/.test(name);
const fail = code => { throw new Error(code); };
const digest = value => createHash('sha256').update(value).digest('hex');
export const objectEntry = object => `objects/${digest(JSON.stringify([object.bucket_id, object.name]))}.blob`;

function keyFor(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 20) fail('PASSPHRASE_MINIMUM_20_CHARACTERS');
  return scryptSync(passphrase, salt, 32, { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
}
function nonceFor(header, sequence) {
  if (sequence >= 0xffffffff) fail('ARCHIVE_FRAME_LIMIT');
  const nonce = Buffer.alloc(12); header.copy(nonce, 0, 40, 48); nonce.writeUInt32BE(sequence, 8); return nonce;
}
function validateSummary(summary) {
  if (!summary || summary.format !== 'snote-backup-v1' || !Array.isArray(summary.entries) || !summary.source) fail('INVALID_MANIFEST');
  for (const required of ['database.dump', 'inventory.json', 'roles.json']) {
    if (!summary.entries.some(entry => entry.name === required)) fail('REQUIRED_ENTRY_MISSING');
  }
}
async function secureParent(output) {
  if (process.platform === 'win32') fail('POSIX_PRIVATE_OUTPUT_REQUIRED');
  const parent = await stat(dirname(resolve(output)));
  if (!parent.isDirectory() || (process.platform !== 'win32' && ((parent.mode & 0o077) || parent.uid !== process.getuid()))) fail('OUTPUT_PARENT_MUST_BE_PRIVATE');
}

export async function createBackup({ output, passphrase, source, entries, beforeComplete = async () => {} }) {
  await secureParent(output);
  const header = Buffer.concat([MAGIC, randomBytes(32), randomBytes(8)]);
  const key = keyFor(passphrase, header.subarray(8, 40));
  const partial = `${output}.${randomBytes(8).toString('hex')}.partial`;
  let handle, sequence = 0;
  const manifest = { format: 'snote-backup-v1', source, startedAt: new Date().toISOString(), entries: [] };
  async function frame(type, bytes) {
    const plaintext = Buffer.concat([Buffer.from([type]), bytes]);
    if (plaintext.length + 16 > MAX_FRAME) fail('ARCHIVE_FRAME_TOO_LARGE');
    const cipher = createCipheriv('aes-256-gcm', key, nonceFor(header, sequence++));
    cipher.setAAD(header);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    const length = Buffer.alloc(4); length.writeUInt32BE(encrypted.length);
    await handle.writeFile(Buffer.concat([length, encrypted]));
  }
  try {
    handle = await open(partial, 'wx', 0o600); await handle.writeFile(header);
    const names = new Set();
    for await (const entry of entries) {
      if (!pathOK(entry.name) || names.has(entry.name)) fail('INVALID_OR_DUPLICATE_ENTRY');
      names.add(entry.name);
      await frame(1, Buffer.from(JSON.stringify({ name: entry.name })));
      const hash = createHash('sha256'); let bytes = 0;
      for await (const input of entry.stream) {
        const buffer = Buffer.from(input);
        for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
          const chunk = buffer.subarray(i, i + CHUNK_SIZE); hash.update(chunk); bytes += chunk.length;
          if (!Number.isSafeInteger(bytes)) fail('FILE_TOO_LARGE');
          await frame(2, chunk);
        }
      }
      if (entry.complete) await entry.complete();
      if (entry.expectedBytes != null && bytes !== entry.expectedBytes) fail('OBJECT_SIZE_MISMATCH');
      const record = { name: entry.name, bytes, sha256: hash.digest('hex') };
      manifest.entries.push(record); await frame(3, Buffer.from(JSON.stringify(record)));
    }
    validateSummary(manifest);
    await beforeComplete();
    manifest.completedAt = new Date().toISOString();
    await frame(4, Buffer.from(JSON.stringify(manifest)));
    await handle.sync(); await handle.close(); handle = null;
    await inspectBackup({ input: partial, passphrase });
    // Hard-link publication never overwrites an earlier backup, even in a race.
    await link(partial, output); await unlink(partial);
    const parent = await open(dirname(resolve(output)), 'r');
    try { await parent.sync(); } finally { await parent.close(); }
    return manifest;
  } finally {
    key.fill(0); if (handle) await handle.close();
    await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function readExactly(handle, length, eofAllowed = false) {
  const buffer = Buffer.alloc(length); let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, null);
    if (!bytesRead) { if (eofAllowed && !offset) return null; fail('TRUNCATED_ARCHIVE'); }
    offset += bytesRead;
  }
  return buffer;
}

export async function inspectBackup({ input, passphrase, onStart, onChunk, onEnd }) {
  const handle = await open(input, 'r'); let key;
  try {
    const header = await readExactly(handle, HEADER_SIZE);
    if (!header.subarray(0, 8).equals(MAGIC)) fail('INVALID_ARCHIVE_HEADER');
    key = keyFor(passphrase, header.subarray(8, 40));
    let sequence = 0, current = null, manifest = null, inventory = null, dumpPrefix = Buffer.alloc(0);
    const entries = [], names = new Set();
    while (true) {
      const length = await readExactly(handle, 4, true); if (!length) break;
      if (manifest) fail('TRAILING_ARCHIVE_DATA');
      const size = length.readUInt32BE(); if (size < 17 || size > MAX_FRAME) fail('INVALID_FRAME_LENGTH');
      const data = await readExactly(handle, size);
      const decipher = createDecipheriv('aes-256-gcm', key, nonceFor(header, sequence++));
      decipher.setAAD(header); decipher.setAuthTag(data.subarray(-16));
      let plain;
      try { plain = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]); }
      catch { fail('AUTHENTICATION_FAILED'); }
      const type = plain[0], bytes = plain.subarray(1);
      if (type === 1) {
        const entry = JSON.parse(bytes.toString());
        if (current || !pathOK(entry.name) || names.has(entry.name)) fail('INVALID_ENTRY_ORDER');
        names.add(entry.name); current = { name: entry.name, bytes: 0, hash: createHash('sha256'), chunks: [] };
        await onStart?.(entry.name);
      } else if (type === 2) {
        if (!current) fail('INVALID_ENTRY_ORDER');
        current.hash.update(bytes); current.bytes += bytes.length;
        if (current.name === 'inventory.json') {
          if (current.bytes > 64 * 1024 * 1024) fail('INVENTORY_TOO_LARGE');
          current.chunks.push(bytes);
        }
        if (current.name === 'database.dump' && dumpPrefix.length < 5) dumpPrefix = Buffer.concat([dumpPrefix, bytes]).subarray(0, 5);
        await onChunk?.(bytes);
      } else if (type === 3) {
        if (!current) fail('INVALID_ENTRY_ORDER');
        const record = { name: current.name, bytes: current.bytes, sha256: current.hash.digest('hex') };
        if (JSON.stringify(record) !== bytes.toString()) fail('CHECKSUM_MISMATCH');
        if (current.name === 'inventory.json') inventory = JSON.parse(Buffer.concat(current.chunks).toString());
        entries.push(record); current = null; await onEnd?.(record);
      } else if (type === 4) {
        if (current) fail('INCOMPLETE_ENTRY'); manifest = JSON.parse(bytes.toString()); validateSummary(manifest);
        if (JSON.stringify(manifest.entries) !== JSON.stringify(entries)) fail('MANIFEST_MISMATCH');
      } else fail('INVALID_FRAME_TYPE');
    }
    if (!manifest || current) fail('INCOMPLETE_BACKUP');
    if (inventory?.format !== 'snote-inventory-v1' || !Array.isArray(inventory.objects)) fail('INVALID_INVENTORY');
    const expected = new Map();
    for (const object of inventory.objects) {
      const name = objectEntry(object), size = Number(object.metadata?.size);
      if (expected.has(name) || object.metadata?.size == null || !Number.isSafeInteger(size) || size < 0) fail('INVALID_INVENTORY');
      expected.set(name, size);
    }
    const actual = entries.filter(entry => entry.name.startsWith('objects/'));
    if (actual.length !== expected.size || actual.some(entry => expected.get(entry.name) !== entry.bytes)) fail('STORAGE_COVERAGE_MISMATCH');
    const database = entries.find(entry => entry.name === 'database.dump');
    if (!database.bytes || (manifest.source.database === 'full-pg-dump-custom' && dumpPrefix.toString() !== 'PGDMP')) fail('INVALID_DATABASE_DUMP');
    return manifest;
  } finally { key?.fill(0); await handle.close(); }
}

export async function extractBackup({ input, passphrase, output }) {
  // A verification pass writes nothing. Existing directories are never reused.
  const manifest = await inspectBackup({ input, passphrase });
  await secureParent(output); await mkdir(output, { mode: 0o700 });
  let file;
  try {
    await mkdir(join(output, 'objects'), { mode: 0o700 });
    await inspectBackup({ input, passphrase,
      onStart: async name => { file = await open(join(output, name), 'wx', 0o600); },
      onChunk: async bytes => { await file.writeFile(bytes); },
      onEnd: async () => { await file.sync(); await file.close(); file = null; }
    });
    const report = await open(join(output, 'verified-manifest.json'), 'wx', 0o600);
    try { await report.writeFile(JSON.stringify(manifest, null, 2)); await report.sync(); } finally { await report.close(); }
    return manifest;
  } catch (error) {
    if (file) await file.close(); await rm(output, { recursive: true, force: true }); throw error;
  }
}

export const bytesEntry = (name, value) => ({ name, stream: [Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))] });
export const fileEntry = (name, path) => ({ name, stream: createReadStream(path) });
