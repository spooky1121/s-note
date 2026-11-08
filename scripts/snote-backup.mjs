#!/usr/bin/env node
/** Local operator CLI. Never automatically restores a database or uploads files. */
import { captureBackup } from './backup/capture.mjs';
import { inspectBackup, extractBackup } from './backup/archive.mjs';

const args = process.argv.slice(2), command = args.shift();
const help = `S-NOTE encrypted backup (Node 20+; POSIX output; capture requires PostgreSQL 17 client tools)
  node scripts/snote-backup.mjs capture --project-ref REF --output /private/path/run.snbak
  node scripts/snote-backup.mjs verify --input /private/path/run.snbak
  node scripts/snote-backup.mjs extract --input /private/path/run.snbak --output /private/path/new-directory

Passphrase: SNOTE_BACKUP_PASSPHRASE environment variable, minimum 20 characters.
Capture uses preconfigured libpq TLS credentials and SUPABASE_SERVICE_ROLE_KEY.
The output parent must already exist with owner-only access. No automatic retention,
remote uploads, schedules, key generation, permission changes, or database restores.
Extract writes sensitive plaintext to a NEW private directory after verification.
See docs/backup-recovery.md before use. Never put credentials in command arguments.`;
if (!command || ['--help','help','-h'].includes(command)) { console.log(help); process.exit(0); }
try {
  const options = {};
  while (args.length) {
    const name = args.shift(); if (!['--project-ref','--output','--input'].includes(name) || !args.length || options[name]) throw new Error('INVALID_ARGUMENTS');
    options[name] = args.shift();
  }
  const passphrase = process.env.SNOTE_BACKUP_PASSPHRASE;
  let manifest;
  if (command === 'capture' && options['--project-ref'] && options['--output'] && !options['--input']) manifest = await captureBackup({ projectRef: options['--project-ref'], output: options['--output'], passphrase });
  else if (command === 'verify' && options['--input'] && !options['--output'] && !options['--project-ref']) manifest = await inspectBackup({ input: options['--input'], passphrase });
  else if (command === 'extract' && options['--input'] && options['--output'] && !options['--project-ref']) manifest = await extractBackup({ input: options['--input'], output: options['--output'], passphrase });
  else throw new Error('INVALID_ARGUMENTS');
  // Never print source identifiers, object paths, filenames, credentials, or row data.
  console.log(JSON.stringify({ status: command === 'extract' ? 'verified-local-extraction' : 'verified-encrypted-archive',
    entryCount: manifest.entries.length, totalBytes: manifest.entries.reduce((n,e) => n + e.bytes, 0),
    completedAt: manifest.completedAt, databaseRestorePerformed: false, offsiteCopyVerified: false }));
} catch (error) {
  const code = /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : 'BACKUP_OPERATION_FAILED';
  console.error(JSON.stringify({ status: 'failed', code })); process.exitCode = 1;
}
