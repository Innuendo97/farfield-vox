import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT, reporter } from './lib.mjs';

// ONE SUN, INHERITED INTO THE ROUND.
//
// tools/lighting/check-suns.mjs is older than this directory and is the guard
// that would have caught a world lit by two suns fifty two degrees apart for a
// whole campaign. It stays where it is -- everything that bakes or lights runs
// it first, and it has to be reachable without the suite -- so this is a wrapper
// and not a copy. A second implementation of it would be a second opinion about
// where the sun is, which is the defect it exists for.
//
// BOTH RUNS, because they make different claims. The plain run asks every
// consumer, including the delivered light maps that still carry the old sun
// under a declared waiver. --sources asks only the seats that will AUTHOR the
// next bake, which is the smaller claim and the one that has to stay true while
// eight sessions re-author what they own.

const CHECK = 'tools/lighting/check-suns.mjs';

const report = reporter('guard-suns -- one sun, and every consumer of it declared');

for (const args of [[], ['--sources']]) {
  const run = spawnSync(process.execPath, [join(REPO_ROOT, CHECK), ...args], {
    cwd: REPO_ROOT, encoding: 'utf8',
  });
  const tail = (run.stdout ?? '').trim().split('\n').at(-1) ?? '';
  report.check(run.status === 0, `${CHECK} ${args.join(' ')}`.trim(), tail.trim());
  if (run.status !== 0) process.stdout.write(`${run.stdout}${run.stderr}`);
}

report.end();
