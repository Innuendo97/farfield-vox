import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { read, REPO_ROOT, reporter, selfTest, walk } from './lib.mjs';

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
//
// AND THE MANIFEST IS ASKED IN BOTH DIRECTIONS, which is the half this guard was
// missing until step 8 of the rifondazione.
//
//   every id a page ASKS FOR EXISTS -- a layer that waits on an id no fragment
//     declares waits for ever, and the failure is a piece of the world that is
//     simply not there, with nothing in the console to say why
//   every id that EXISTS IS ASKED FOR -- weight on the wire with no reader. This
//     is not a hypothetical: four textures of the ground were carried by every
//     visitor for the whole of two campaigns after the meadow stopped reading
//     them, 4 356 514 bytes, 70.9% of the first frame, and no gate in this
//     repository could see it. What found it was somebody reading a note.
//
// The two legs are asked of the SHIPPED entries. A dev-scope diagnostic is
// excluded for the same reason it is excluded from the first frame budget: it
// is not part of the world, and src/dev is not where the world is declared. The
// ones that are excluded are printed rather than passed over.

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
if (run.status !== 0) {
  process.stdout.write(`${run.stdout}${run.stderr}`);
  report.end();
}

// ------------------------------------------------------- the two directions

/** Every id a `needs` array in src names, with the file that names it. */
export function asked(sources) {
  const out = new Map();
  for (const [file, text] of sources) {
    for (const list of text.matchAll(/needs:\s*\[([^\]]*)\]/g)) {
      for (const id of list[1].matchAll(/['"`]([^'"`]+)['"`]/g)) {
        if (!out.has(id[1])) out.set(id[1], file);
      }
    }
  }
  return out;
}

/**
 * Whether an id is named anywhere in the sources, quoted, as an id is.
 *
 * IN APOSTROPHES OR IN DOUBLE QUOTES, AND NOT IN BACKTICKS, which is a
 * measurement rather than a style. Every id in this repository is asked for as
 * a plain string -- a `needs` array, or a lookup in the bag of arrivals -- and
 * the backtick in these files is what PROSE quotes a name with. src/world/
 * layers/v4-verde.js names `terrain-light` in a comment ABOUT an atlas it does
 * not read, and an atlas that had no reader for two campaigns would have gone
 * on passing this leg on the strength of a sentence saying so.
 */
export function named(sources, id) {
  const pattern = new RegExp(`['"]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
  return sources.some(([, text]) => pattern.test(text));
}

if (process.argv.includes('--self')) {
  const world = [['src/world/layers/x.js', "needs: ['there'],"]];
  const declared = new Set(['there']);
  selfTest('guard-assets', [
    {
      what: 'a layer asking for an id no fragment declares',
      caught: [...asked([['src/world/layers/x.js', "needs: ['there', 'nowhere'],"]]).keys()]
        .some((id) => !declared.has(id)),
    },
    {
      what: 'an id declared and delivered that nothing in src names',
      caught: !named(world, 'carried-and-unread'),
    },
    {
      what: 'and an id that IS named is not called unread',
      caught: named(world, 'there'),
    },
    {
      what: 'a name that appears only in prose, in backticks, is not a reader',
      caught: !named([['x.js', '// `terrain-light` belongs to the soil']], 'terrain-light'),
    },
    {
      what: 'an id inside a needs array over several lines is still seen',
      caught: asked([['x.js', "needs: [\n  'a',\n  'b',\n],"]]).has('b'),
    },
  ]);
}

const sources = walk('src', (path) => path.endsWith('.js')).map((path) => [path, read(path)]);
const manifest = JSON.parse(run.stdout);
const shipped = manifest.assets.filter((entry) => entry.scope !== 'dev');
const declared = new Set(manifest.assets.map((entry) => entry.id));

const wanted = asked(sources);
const missing = [...wanted].filter(([id]) => !declared.has(id));
report.check(missing.length === 0, 'every id a layer asks for is declared',
  missing.length ? missing.map(([id, file]) => `${id} (${file})`).join(', ')
    : `${wanted.size} asked, all declared`);

const unread = shipped.filter((entry) => !named(sources, entry.id));
report.check(unread.length === 0, 'every id the world carries is named in src',
  unread.length ? unread.map((entry) => entry.id).join(', ')
    : `${shipped.length} shipped, all read`);

const diagnostics = manifest.assets.filter((entry) => entry.scope === 'dev');
if (diagnostics.length) {
  report.note(`not asked of the diagnostics, which are not the world: ${diagnostics
    .map((entry) => entry.id).join(', ')}`);
}

report.end();

