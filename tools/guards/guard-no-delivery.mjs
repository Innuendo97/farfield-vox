import { execFileSync } from 'node:child_process';
import { REPO_ROOT, reporter, selfTest } from './lib.mjs';

// THE SESSIONS DO NOT COMMIT DELIVERIES.
//
// public/assets/** is BUILT. Its contents are the output of tools/build-assets.
// mjs over the fragments in assets-src/assets.d/, and eight branches building it
// eight times means eight sets of binaries that differ by encoder version, by
// machine and by the hour -- conflicting in a form no merge can resolve and no
// review can read. A session owns assets-src/<its own>/ and a fragment of the
// manifest; the build is the integrator's, once, at the end.
//
// It is also the shape a delivery hides in: a binary that nobody diffs is a
// binary nobody notices carrying the world back to a state a session had fixed.
//
// TWO LEGS, because there are two ways in. What is in the working tree or the
// index right now, and what the branch has already committed. The second is the
// one that matters after the fact: a delivery committed on Tuesday is invisible
// to a status check on Friday, and it is still in the merge.
//
// --integrator IS THE WAY THROUGH, and it is a declaration rather than a hole.
// V9 and the coordinator build the world on purpose; they say so on the command
// line, the guard prints what they are carrying, and it goes green. What is NOT
// available is a session getting past this quietly.

const DELIVERY = 'public/assets';
const INTEGRATION_BRANCH = 'main';

const git = (...args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

/** What the two legs found, as the flag sees it. */
export function verdict({ dirty, committed, integrator }) {
  return {
    fails: !integrator && (dirty.length > 0 || committed.length > 0),
    carrying: [...dirty, ...committed],
  };
}

if (process.argv.includes('--self')) {
  const dirty = [' M public/assets/manifest.json'];
  const committed = ['public/assets/textures/terrain-light.ktx2'];
  selfTest('guard-no-delivery', [
    {
      what: 'a delivery sitting in the working tree fails',
      caught: verdict({ dirty, committed: [], integrator: false }).fails,
    },
    {
      what: 'a delivery already committed on the branch fails too',
      caught: verdict({ dirty: [], committed, integrator: false }).fails,
    },
    {
      what: 'a clean tree on a clean branch passes',
      caught: !verdict({ dirty: [], committed: [], integrator: false }).fails,
    },
    {
      what: '--integrator carries both through, and still names what it carries',
      caught: !verdict({ dirty, committed, integrator: true }).fails
        && verdict({ dirty, committed, integrator: true }).carrying.length === 2,
    },
    {
      what: 'the working tree really is being asked about public/assets',
      caught: git('status', '--porcelain', '--', DELIVERY) !== undefined,
    },
  ]);
}

const integrator = process.argv.includes('--integrator');
const report = reporter(`guard-no-delivery -- nothing under ${DELIVERY} is a session's to commit`);

const dirty = git('status', '--porcelain', '--', DELIVERY).split('\n').filter(Boolean);
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');

let committed = [];
if (branch === INTEGRATION_BRANCH) {
  report.line(`  on ${INTEGRATION_BRANCH}: this is where a built delivery belongs, `
    + 'so there is no branch to compare against');
} else {
  committed = git('diff', '--name-only', `${INTEGRATION_BRANCH}...HEAD`, '--', DELIVERY)
    .split('\n').filter(Boolean);
  report.line(`  on ${branch}: ${committed.length} delivered file`
    + `${committed.length === 1 ? '' : 's'} in the commits this branch adds`);
}

const seen = verdict({ dirty, committed, integrator });

if (integrator) {
  report.check(true, '--integrator: this run is allowed to carry a built delivery');
  if (seen.carrying.length) {
    report.note(`--integrator is carrying ${seen.carrying.length} delivered `
      + `path${seen.carrying.length === 1 ? '' : 's'}`);
    for (const path of seen.carrying) report.line(`         ${path}`);
  }
  report.end();
}

report.check(dirty.length === 0, `the working tree and the index are clean under ${DELIVERY}`,
  dirty.length ? dirty.join(' | ') : '');
report.check(committed.length === 0, `this branch commits nothing under ${DELIVERY}`,
  committed.length ? committed.join(' | ') : '');

if (dirty.length || committed.length) {
  report.line('');
  report.line('  A session owns assets-src/<its own>/ and one fragment of assets-src/assets.d/.');
  report.line('  The build belongs to the integrator, once. If this run IS the integrator:');
  report.line('');
  report.line('      npm run guard:all -- --integrator');
}

report.end();
