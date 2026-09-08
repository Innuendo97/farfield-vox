import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { REPO_ROOT, reporter, selfTest } from './lib.mjs';

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

/** The checker's own verdict on a list of images: what the run and the self test both ask. */
const inspect = (paths) => spawnSync(process.execPath, [join(REPO_ROOT, CHECK), ...paths],
  { cwd: REPO_ROOT, encoding: 'utf8' });

const files = execFileSync('git', ['ls-files', '*.png'], { cwd: REPO_ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

// --------------------------------------------------------------- self-test
//
// THIS GUARD HAD NO --self AT ALL, which is the plainest form of the gap
// E-IGIENE names: a wrapper nobody has ever seen say no. It says no now, and
// against a real image with a real ancillary chunk in it rather than against a
// story about one -- a tracked PNG of this repository with a tEXt chunk spliced
// in after its IHDR, put through the very checker the run spawns.
// (U-GUARDIA-3.)

/** One PNG chunk, length and CRC and all. */
function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0,
    data.length + 8);
  return out;
}

/** A tracked image with the metadata an editor leaves behind put back into it. */
function withMetadata(source) {
  const bytes = readFileSync(join(REPO_ROOT, source));
  const ihdrEnd = 8 + 12 + bytes.readUInt32BE(8);      // signature + the IHDR chunk
  const text = chunk('tEXt', Buffer.from('Software\0an editor nobody declared', 'latin1'));
  return Buffer.concat([bytes.subarray(0, ihdrEnd), text, bytes.subarray(ihdrEnd)]);
}

if (process.argv.includes('--self')) {
  const cases = [];
  if (!files.length) {
    cases.push({ what: 'git knows which images are tracked', caught: false });
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'guard-png-'));
    try {
      const clean = join(dir, 'clean.png');
      const dirty = join(dir, 'dirty.png');
      writeFileSync(clean, readFileSync(join(REPO_ROOT, files[0])));
      writeFileSync(dirty, withMetadata(files[0]));
      cases.push({
        what: `a tracked image copied out of the tree still passes (${files[0]})`,
        caught: inspect([clean]).status === 0,
      });
      cases.push({
        what: 'and the same image with a tEXt chunk spliced in after its IHDR does not',
        caught: inspect([dirty]).status !== 0,
      });
      cases.push({
        what: 'the checker names the chunk rather than only refusing',
        caught: /tEXt/.test(`${inspect([dirty]).stdout ?? ''}${inspect([dirty]).stderr ?? ''}`),
      });
      cases.push({
        what: 'and one dirty image among clean ones is enough to fail the batch',
        caught: inspect([clean, dirty, clean]).status !== 0,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  selfTest('guard-png', cases);
}

const report = reporter('guard-png -- every tracked PNG is clean');

report.check(files.length > 0, 'git knows which images are tracked', `${files.length} PNGs`);
const run = inspect(files);
const text = `${run.stdout ?? ''}${run.stderr ?? ''}`;
const dirty = text.split('\n').filter((line) => line.includes('FAIL'));

report.check(run.status === 0, `${files.length} images carry no ancillary chunk and no palette`,
  dirty.join(' | '));
if (run.status !== 0) process.stdout.write(text);

report.end();
