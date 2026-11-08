/** Read-only production capture. Requires preconfigured credentials; never provisions access. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { devNull } from 'node:os';
import { bytesEntry, createBackup, objectEntry, inspectBackup } from './archive.mjs';

export const INVENTORY_SQL = `select json_build_object(
 'format','snote-inventory-v1',
 'serverVersion',current_setting('server_version'),
 'tables',(select coalesce(json_agg(json_build_object('schema',n.nspname,'name',c.relname) order by n.nspname,c.relname),'[]'::json)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p')
   and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'),
 'buckets',(select coalesce(json_agg(b order by id),'[]'::json) from storage.buckets b),
 'objects',(select coalesce(json_agg(o order by bucket_id,name),'[]'::json) from storage.objects o),
 'fileReferences',(select coalesce(json_agg(r order by bucket_id,name),'[]'::json) from (
   select 'zc-vehicle-private'::text bucket_id,file_path name from public.zc_media
   union select bucket_id,file_path from snote_private.recycle_files
   union select 'snote-profile-photos'::text,file_path from snote_private.profile_avatars
 ) r),
 'unsupportedBucketCount',(select count(*) from storage.buckets_analytics)+(select count(*) from storage.buckets_vectors),
 'extensions',(select coalesce(json_agg(json_build_object('name',extname,'version',extversion) order by extname),'[]'::json) from pg_extension),
 'roles',(select coalesce(json_agg(json_build_object('name',rolname,'superuser',rolsuper,'inherit',rolinherit,
   'createRole',rolcreaterole,'createDb',rolcreatedb,'canLogin',rolcanlogin,'bypassRls',rolbypassrls,'replication',rolreplication,'connectionLimit',rolconnlimit,
   'validUntil',rolvaliduntil,'config',rolconfig) order by rolname),'[]'::json) from pg_roles),
 'roleMemberships',(select coalesce(json_agg(json_build_object('role',r.rolname,'member',m.rolname,'admin',a.admin_option,
   'inherit',a.inherit_option,'set',a.set_option,'grantor',g.rolname) order by r.rolname,m.rolname),'[]'::json)
   from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member left join pg_roles g on g.oid=a.grantor),
 'roleSettings',(select coalesce(json_agg(json_build_object('database',d.datname,'role',r.rolname,'config',s.setconfig) order by s.setdatabase,s.setrole),'[]'::json)
   from pg_db_role_setting s left join pg_database d on d.oid=s.setdatabase left join pg_roles r on r.oid=s.setrole)
);`;
const fail = code => { throw new Error(code); };
export function safeEnvironment(env, projectRef) {
  if (!/^[a-z]{20}$/.test(projectRef)) fail('INVALID_PROJECT_REF');
  // Never permit implicit libpq defaults, a service file, or a transaction pooler.
  if (env.PGSERVICE || env.PGHOSTADDR || env.PGDATABASE !== 'postgres' || env.PGHOST !== `db.${projectRef}.supabase.co` || !env.PGUSER || (env.PGPORT && env.PGPORT !== '5432')) fail('EXPLICIT_DIRECT_DATABASE_TARGET_REQUIRED');
  if (env.PGSSLMODE !== 'verify-full') fail('DATABASE_TLS_VERIFY_FULL_REQUIRED');
  if (!env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY.length < 30) fail('STORAGE_READ_CREDENTIAL_REQUIRED');
  return Object.fromEntries(Object.entries(env).filter(([name]) => /^(PATH|HOME|LANG|LC_ALL|SYSTEMROOT|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGPASSFILE|PGSSLMODE|PGSSLROOTCERT|PGSSLCERT|PGSSLKEY)$/.test(name)));
}
function child(binary, args, env) {
  const proc = spawn(binary, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  // Server diagnostics can contain row data or URLs; never forward stderr.
  proc.stderr.resume(); proc.stdin.on('error', () => {});
  const deadline = setTimeout(() => proc.kill(), 3600000); deadline.unref();
  proc.once('close', () => clearTimeout(deadline));
  const done = new Promise((resolve, reject) => {
    proc.once('error', () => reject(new Error(`${binary.toUpperCase()}_UNAVAILABLE`)));
    proc.once('close', code => code === 0 ? resolve() : reject(new Error(`${binary.toUpperCase()}_FAILED`)));
  });
  done.catch(() => {}); return { proc, done };
}
export async function openSnapshot(env) {
  const { proc, done } = child('psql', ['-X', '-qAt', '-w', '-v', 'ON_ERROR_STOP=1'], env);
  const lines = createInterface({ input: proc.stdout }); const iterator = lines[Symbol.asyncIterator]();
  const nextLine = async () => {
    const result = await iterator.next(); if (result.done) { await done; fail('SNAPSHOT_RESPONSE_MISSING'); }
    if (Buffer.byteLength(result.value) > 64 * 1024 * 1024) fail('INVENTORY_TOO_LARGE');
    return result.value;
  };
  try {
    proc.stdin.write("begin isolation level repeatable read read only;\nselect pg_export_snapshot();\n" + INVENTORY_SQL + '\n');
    const snapshot = await nextLine(); if (!/^[0-9A-Fa-f-]+$/.test(snapshot)) fail('INVALID_SNAPSHOT');
    const inventory = JSON.parse(await nextLine());
    return { snapshot, inventory, close: async () => { proc.stdin.end('rollback;\n'); await done; lines.close(); }, abort: () => { proc.kill(); lines.close(); } };
  } catch (error) { proc.kill(); lines.close(); throw error; }
}
async function readCurrentInventory(env) {
  const { proc, done } = child('psql', ['-X', '-qAt', '-w', '-v', 'ON_ERROR_STOP=1', '-c', INVENTORY_SQL], env);
  proc.stdin.end(); let text = '';
  for await (const chunk of proc.stdout) { text += chunk; if (text.length > 64 * 1024 * 1024) { proc.kill(); fail('INVENTORY_TOO_LARGE'); } }
  await done; return JSON.parse(text);
}
export function validateInventory(inventory) {
  if (inventory?.format !== 'snote-inventory-v1' || !Array.isArray(inventory.tables) || !inventory.tables.length || !Array.isArray(inventory.buckets) || !Array.isArray(inventory.objects) || !Array.isArray(inventory.fileReferences)) fail('INVALID_INVENTORY');
  if (inventory.objects.length > 8000 || Buffer.byteLength(JSON.stringify(inventory)) > 64 * 1024 * 1024) fail('INVENTORY_CAPACITY_EXCEEDED');
  const buckets = new Set(inventory.buckets.map(b => b.id)), objects = new Set();
  for (const item of inventory.objects) {
    if (!buckets.has(item.bucket_id) || typeof item.name !== 'string' || !item.name || item.name.split('/').some(s => s === '.' || s === '..') || item.name.includes('\\')) fail('INVALID_STORAGE_OBJECT');
    const size = Number(item.metadata?.size);
    if (item.metadata?.size == null || !Number.isSafeInteger(size) || size < 0) fail('OBJECT_SIZE_UNKNOWN');
    const id = objectEntry(item); if (objects.has(id)) fail('DUPLICATE_STORAGE_OBJECT'); objects.add(id);
  }
  for (const reference of inventory.fileReferences) { if (!objects.has(objectEntry(reference))) fail('REFERENCED_FILE_MISSING'); }
  if (inventory.unsupportedBucketCount !== 0 || inventory.buckets.some(b => b.type && b.type !== 'STANDARD')) fail('UNSUPPORTED_BUCKET_TYPE');
  for (const table of ['zc_datasets','zc_customers','zc_media','zc_companies','zc_members']) {
    if (!inventory.tables.some(t => t.schema === 'public' && t.name === table)) fail('SNOTE_TABLE_MISSING');
  }
}
const canonical = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export function assertStorageUnchanged(before, after) {
  const material = objects => objects.map(({ last_accessed_at, ...object }) => object);
  if (canonical(before.buckets) !== canonical(after.buckets) || canonical(material(before.objects)) !== canonical(material(after.objects))) fail('STORAGE_CHANGED_DURING_BACKUP');
}
export async function downloadObject(projectRef, credential, item, fetcher = fetch) {
  const etag = item.metadata?.eTag || item.metadata?.etag;
  if (typeof etag !== 'string' || !etag.trim()) fail('OBJECT_VERSION_UNKNOWN');
  const path = [item.bucket_id, ...item.name.split('/')].map(encodeURIComponent).join('/');
  const response = await fetcher(`https://${projectRef}.supabase.co/storage/v1/object/authenticated/${path}`, {
    headers: { Authorization: `Bearer ${credential}`, apikey: credential, 'Accept-Encoding': 'identity' },
    redirect: 'error', signal: AbortSignal.timeout(120000)
  });
  if (!response.ok || !response.body) fail('STORAGE_DOWNLOAD_FAILED');
  const size = Number(item.metadata.size), length = response.headers.get('content-length');
  if (length !== null && Number(length) !== size) { await response.body.cancel(); fail('OBJECT_SIZE_MISMATCH'); }
  const normalize = value => String(value).replace(/^W\//, '').replaceAll('"', '').toLowerCase();
  const actualTag = response.headers.get('etag');
  if (etag && (!actualTag || normalize(etag) !== normalize(actualTag))) { await response.body.cancel(); fail('OBJECT_VERSION_MISMATCH'); }
  const md5 = createHash('md5');
  return { name: objectEntry(item), expectedBytes: size,
    stream: (async function* () { for await (const chunk of response.body) { md5.update(chunk); yield chunk; } })(),
    complete: () => { const checksum = md5.digest('hex'); if (etag && /^[a-f0-9]{32}$/.test(normalize(etag)) && checksum !== normalize(etag)) fail('OBJECT_CHECKSUM_MISMATCH'); }
  };
}

export async function captureBackup({ output, projectRef, passphrase, env = process.env }) {
  const pgEnv = safeEnvironment(env, projectRef);
  pgEnv.PGCONNECT_TIMEOUT = '15';
  pgEnv.PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=900000 -c idle_in_transaction_session_timeout=3600000';
  const snapshot = await openSnapshot(pgEnv); let dump, checker;
  try {
    validateInventory(snapshot.inventory);
    const source = { projectRef, database: 'full-pg-dump-custom', snapshot: snapshot.snapshot,
      storage: 'all-standard-buckets', includesExternalSecrets: false,
      excluded: ['external-configuration-and-secret-values', 'browser-only-unsynced-data', 'role-passwords', 'object-versions-not-in-storage-inventory'] };
    async function* entries() {
      yield bytesEntry('inventory.json', snapshot.inventory);
      yield bytesEntry('roles.json', { roles: snapshot.inventory.roles, memberships: snapshot.inventory.roleMemberships, databaseSettings: snapshot.inventory.roleSettings, passwordsIncluded: false, replayableSql: false });
      dump = child('pg_dump', ['-w', '--format=custom', '--lock-wait-timeout=60000', '--snapshot=' + snapshot.snapshot], pgEnv); dump.proc.stdin.end();
      // Parse every dump section into /dev/null; this validates the archive without executing SQL.
      checker = child('pg_restore', ['--file=' + devNull], pgEnv); checker.proc.stdout.resume();
      const checkedStream = (async function* () {
        for await (const chunk of dump.proc.stdout) {
          await new Promise((resolve, reject) => checker.proc.stdin.write(chunk, error => error ? reject(new Error('PG_RESTORE_VALIDATION_FAILED')) : resolve()));
          yield chunk;
        }
      })();
      yield { name: 'database.dump', stream: checkedStream, complete: async () => {
        checker.proc.stdin.end(); await dump.done; await checker.done;
      } };
      for (const item of snapshot.inventory.objects) yield await downloadObject(projectRef, env.SUPABASE_SERVICE_ROLE_KEY, item);
    }
    const manifest = await createBackup({ output, passphrase, source, entries: entries(), beforeComplete: async () => {
      assertStorageUnchanged(snapshot.inventory, await readCurrentInventory(pgEnv));
      await snapshot.close();
    } });
    await inspectBackup({ input: output, passphrase });
    return manifest;
  } finally { snapshot.abort(); if (dump) dump.proc.kill(); if (checker) checker.proc.kill(); }
}
