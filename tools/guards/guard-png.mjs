import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT, reporter } from './lib.mjs';

// NO PNG IN THIS REPOSITORY CARRIES METADATA, AND THE LIST IS NOT WRITTEN DOWN.
//
// The rule is the client's and it is absolute: every image that ships is free of
// the auxiliary chunks an editor or a camera leaves behind -- timestamps,
// colour profiles, text, the name of whatever wrote it. A gradient also has to
// be true colour rather than palettised, because 256 entries cannot hold one.
//
// THE FILE LIST COMES FROM GIT and not from an argument. A guard with a list in
// it protects the files somebody remembered, and eight sessions are about to add
// images this file has never heard of. Asking git which PNGs are tracked means
// the guard arms itself on every delivery without anyone editing it -- and the
// images that are deliberately untracked, the targets and the references, are
// out of scope for exactly the same reason they are untracked.

const CHECK = 'tools/grade/check-png.mjs';

const report = reporter('guard-png -- every tracked PNG is clean');

const files = execFileSync('git', ['ls-files', '*.png'], { cwd: REPO_ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

report.check(files.length > 0, 'git knows which images are tracked', `${files.length} PNGs`);

const run = spawnSync(process.execPath, [join(REPO_ROOT, CHECK), ...files], {
  cwd: REPO_ROOT, encoding: 'utf8',
});
const text = `${run.stdout ?? ''}${run.stderr ?? ''}`;
const dirty = text.split('\n').filter((line) => line.includes('FAIL'));

report.check(run.status === 0, `${files.length} images carry no ancillary chunk and no palette`,
  dirty.join(' | '));
if (run.status !== 0) process.stdout.write(text);

report.end();
