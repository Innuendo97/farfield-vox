import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT, reporter, walk } from './lib.mjs';

// THE MANIFEST STILL CONCATENATES, AND IT IS ASKED WITHOUT BUILDING ANYTHING.
//
// assets-src/assets.json became a fragment per session so that eight branches
// could add assets without eight of them editing one file. The cost of that is a
// new way to be broken: two fragments claiming one id, no fragment claiming the
// budget, or a fragment that is not valid JSON at all -- none of which shows up
// until somebody runs a build that takes minutes and writes binaries.
//
// --dry-run is the same concatenation with nothing written, so the round can ask
// the question at every commit. It is also what makes guard-no-delivery
// enforceable rather than merely stated: a session can check its own fragment
// without ever producing the delivery it is forbidden to commit.

const BUILD = 'tools/build-assets.mjs';

const report = reporter('guard-assets -- the fragments still concatenate, without building');

const fragments = walk('assets-src/assets.d', (path) => path.endsWith('.json'));
report.check(fragments.length > 0, 'the fragments are where the build looks for them',
  fragments.map((path) => path.split('/').at(-1)).join(', '));

const run = spawnSync(process.execPath, [join(REPO_ROOT, BUILD), '--dry-run'], {
  cwd: REPO_ROOT, encoding: 'utf8',
});
const entries = (run.stdout ?? '').match(/"id":/g)?.length ?? 0;

report.check(run.status === 0, `${BUILD} --dry-run`,
  run.status === 0 ? `${entries} entries, nothing written`
    : (run.stderr ?? '').trim().split('\n')[0]);
if (run.status !== 0) process.stdout.write(`${run.stdout}${run.stderr}`);

report.end();
