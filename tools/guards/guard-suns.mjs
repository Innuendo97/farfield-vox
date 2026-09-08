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

// WHY THIS GUARD HAS NO --self, STATED RATHER THAN LEFT BLANK.
//
// U-GUARDIA-3 went through this directory for the two shapes E-IGIENE names --
// «no stale literals, self tests by injection» -- and this is one of the two
// files with no --self at all. It is not an oversight, and it is not fixable
// from here.
//
// tools/lighting/check-suns.mjs resolves everything it reads from its OWN
// location: the seal, the roster of waivers and each consumer's manifest are
// fixed paths under the repository root. To make it say no, a defect has to be
// written into one of those files, and this unit owns tools/guards/ only.
// Copying the tree to a temporary root would do it; writing into assets-src/
// and putting it back would not -- a guard that edits the thing it measures is
// measuring the edit, and a crash between the two leaves a bent seal on disk.
//
// So the gap is printed on every run instead of being silent.
report.note("guard-suns NON HA UN --self, ed e' dichiarato: check-suns.mjs legge il sigillo, "
  + 'i condoni e i manifesti da percorsi fissi sotto la radice del deposito, quindi l\'unico '
  + 'modo di fargli dire di no e\' scrivere un difetto in un file che questa unita\' non '
  + 'possiede (tools/guards/ soltanto). Si chiude con una radice passata per argomento a '
  + 'check-suns.mjs, e allora l\'iniezione qui e\' quattro righe e una cartella temporanea. '
  + 'Proprietario: chi apre tools/lighting/. (U-GUARDIA-3, E-IGIENE.)');

for (const args of [[], ['--sources']]) {
  const run = spawnSync(process.execPath, [join(REPO_ROOT, CHECK), ...args], {
    cwd: REPO_ROOT, encoding: 'utf8',
  });
  const tail = (run.stdout ?? '').trim().split('\n').at(-1) ?? '';
  report.check(run.status === 0, `${CHECK} ${args.join(' ')}`.trim(), tail.trim());
  if (run.status !== 0) process.stdout.write(`${run.stdout}${run.stderr}`);
}

report.end();
