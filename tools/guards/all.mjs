import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// EVERY GUARD IN THIS DIRECTORY, IN ONE RUN, AND THE LIST IS THE DIRECTORY.
//
//   npm run guard:all                 all of them
//   npm run guard:all -- --self       each one against a defect injected into it
//   npm run guard:all -- --integrator the flags the guards read, forwarded
//
// This file does not know what the guards are and must never learn: it globs
// guard-*.mjs and runs what it finds. That is the property the campaign needs --
// eight branches adding eight guards touch eight NEW files and never this one,
// so no session can lose another session's check to a merge. The protocol the
// guards speak is written over tools/guards/lib.mjs, beside the reporter that
// speaks it.
//
// Every guard runs even after one has failed. A run that stopped at the first
// red would hand back one defect at a time, and the point of a suite is the
// whole picture before the next commit rather than after the next four.

const HERE = dirname(fileURLToPath(import.meta.url));
const flags = process.argv.slice(2);

const guards = readdirSync(HERE)
  .filter((name) => name.startsWith('guard-') && name.endsWith('.mjs'))
  .sort();

const results = [];
for (const name of guards) {
  process.stdout.write(`\n${'-'.repeat(74)}\n`);
  const run = spawnSync(process.execPath, [join(HERE, name), ...flags], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const text = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  process.stdout.write(text);
  const lines = text.split('\n');
  results.push({
    name: name.replace(/^guard-|\.mjs$/g, ''),
    code: run.status,
    notes: lines.filter((l) => l.startsWith('NOTE ')).map((l) => l.slice(5).trim()),
    skips: lines.filter((l) => l.startsWith('SKIP ')).map((l) => l.slice(5).trim()),
  });
}

process.stdout.write(`\n${'='.repeat(74)}\n`);
let failed = 0;
for (const result of results) {
  const verdict = result.skips.length && result.code === 0 ? 'skipped'
    : result.code === 0 ? 'ok' : 'FAILED';
  if (result.code !== 0) failed++;
  process.stdout.write(`  ${verdict.padEnd(8)} ${result.name}\n`);
  for (const note of [...result.skips, ...result.notes]) {
    process.stdout.write(`           ${note}\n`);
  }
}

process.stdout.write(failed
  ? `\n${failed} of ${results.length} guards failed\n`
  : `\nall ${results.length} guards satisfied\n`);
process.exit(failed ? 1 : 0);
