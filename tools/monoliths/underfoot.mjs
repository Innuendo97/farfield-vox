import { readFileSync } from 'node:fs';
import { builtHeightAt, materialAt, stairHeightAt } from '../../src/world/contracts.js';
import { PLATFORM, STAIRS } from '../../src/world/layout.js';
import { builtStoneAt, stairSpecs, stoneSpecs } from '../../src/world/stone.js';

// DOES THE FLOOR THE WALKER STANDS ON AGREE WITH THE STONE THAT IS DRAWN?
//
// src/world/contracts.js says of builtHeightAt that a contract is not a
// convenience wrapper, and that nothing in it may quietly become a different
// answer from the one the frame draws. Nobody had ever asked. The two answers
// come from different files -- the contract from an arithmetic footprint, the
// picture from the geometry the runtime is handed -- and they are only the same
// answer as long as somebody keeps them so.
//
// AND THE PICTURE IT IS ASKED AGAINST HAS CHANGED TWICE, which is the whole of
// this file's history and the reason it cannot be left alone either time.
//
// THE FIRST TIME the stair stopped being a delivered mesh. This tool used to
// read stairFaces() -- the quad list src/world/stairs.js hands out -- and that
// WAS the stair while the stair was a mesh. It is not any more: the run and the
// platform are courses of masonry cut from src/world/stone.js, and the old quad
// list is no longer drawn by anything. Left as it was, the tool would have
// reported 0.0000 m against a staircase nobody can see, which is worse than
// reporting nothing: a green check on a stale reference is how a defect gets a
// certificate. So the decks are read from the SAME specs the layer builds,
// through the same masonryDecks() the mesh is cut from.
//
// THE SECOND TIME THE CONTRACT GREW, and that is this revision. builtHeightAt
// used to answer -Infinity over the footprint of a monolith -- 62,548 samples
// of drawn stone the contract was silent about, which this tool measured and
// escalated -- and it now composes builtStoneAt over the six. The reference did
// not grow with it, and a reference narrower than the contract it judges does
// not read amber, it reads RED AT THE CONTRACT'S EXPENSE: the run before this
// one reported 15,403 samples of the walker standing OVER the stone, worst
// 12.0400 m, and 1,155 samples of stone the contract invented. Every one of
// those was the tool looking at a monolith through a picture that had only the
// stair and the platform in it. The fault was here and it is fixed here: the
// drawn side is now EVERY piece of masonry the frame carries.
//
// So the two sweeps below are the two things a walker and an arm can meet: the
// ground under the run and the platform, and the footprint of each of the six.
// They overlap on 03, which stands on the platform, and that is stated rather
// than tidied away -- the samples in the overlap are judged twice by the same
// rule and agree with themselves.
//
// VALIDATED BOTH WAYS, because a checker that has never failed has never been
// shown to work: --self offsets the contract by a stated number of metres and
// the run has to catch exactly that.
//
//   node tools/monoliths/underfoot.mjs
//   node tools/monoliths/underfoot.mjs --self 0.05

const argv = process.argv.slice(2);
const selfAt = argv.indexOf('--self');
const injected = selfAt >= 0 ? Number(argv[selfAt + 1] ?? 0.05) : 0;

// A tenth of the smallest thing on the run: the tread is 0.36 m and the riser
// 0.2167, so 2 cm cannot step over a face.
const STEP = 0.02;
const out = (text = '') => process.stdout.write(`${text}\n`);

// The stair and the platform as the world builds them. The spec is read the
// way a tool reads a file, because src/world/stone.js takes it as an argument
// rather than importing it: a bare JSON import is a thing only a bundler can
// resolve, and this has to answer under plain node.
const SPEC = JSON.parse(readFileSync(
  new URL('../../assets-src/monoliths/masonry-spec.json', import.meta.url), 'utf8'));
const DECKS = stairSpecs(SPEC);
const SIX = stoneSpecs(SPEC);

// EVERY PIECE OF MASONRY THE FRAME DRAWS, and not only the two a walker climbs.
// The contract answers for all eight now, so the picture it is judged against
// has to hold all eight or the tool is judging the contract against a world
// that has three quarters of its stone missing. The same two functions the
// runtime builds its meshes from, in the same order, with no third opinion
// about where any of it stands.
const DRAWN = [...DECKS, ...SIX];

/** The highest drawn stone under a point, or -Infinity where none is drawn. */
const drawnHeightAt = (x, z) => builtStoneAt(DRAWN, x, z);

// The footprint to sweep: the whole run and the whole platform with a margin,
// so the EDGES are sampled too. A contract that is right in the middle of a
// tread and wrong at its rim is wrong where a walker actually meets it.
const MARGIN = 0.6;
const xs = [STAIRS.x - STAIRS.width / 2 - MARGIN, STAIRS.x + STAIRS.width / 2 + MARGIN];
const reach = PLATFORM.width / 2 + PLATFORM.depth / 2;
const zs = [
  Math.min(STAIRS.z - 2.5, PLATFORM.z - reach) - MARGIN,
  Math.max(STAIRS.z + STAIRS.tread * STAIRS.steps, PLATFORM.z + reach) + MARGIN,
];
const px = [PLATFORM.x - reach - MARGIN, PLATFORM.x + reach + MARGIN];

out('UNDERFOOT -- the contract against the stone the frame draws\n');
out(`  drawn       the masonry of ${DRAWN.map((s) => s.id).join(', ')}, `
  + 'through masonryDecks() -- the same law the meshes are cut from');
if (injected) out(`  INJECTED    the contract is offset by ${injected} m for this run`);
out('');

/**
 * One rectangle of ground, judged sample by sample.
 *
 * Four findings and they are not the same complaint: a walker held OVER the
 * stone floats, a walker held INSIDE it sinks, stone the contract cannot see is
 * stone an arm swings through, and stone the contract invents is a step onto
 * nothing. Only the first two have a depth, so only those two carry a worst.
 */
function sweep(x0, x1, z0, z1) {
  const found = { samples: 0, above: [], below: [], missing: [], invented: [] };
  for (let z = z0; z <= z1; z += STEP) {
    for (let x = x0; x <= x1; x += STEP) {
      const drawn = drawnHeightAt(x, z);
      const said = builtHeightAt(x, z);
      const claimed = said === -Infinity ? said : said + injected;
      found.samples++;
      if (drawn === -Infinity && claimed === -Infinity) continue;
      if (drawn === -Infinity) { found.invented.push({ x, z, claimed }); continue; }
      if (claimed === -Infinity) { found.missing.push({ x, z, drawn }); continue; }
      const delta = claimed - drawn;
      if (delta > 1e-9) found.above.push({ x, z, delta, drawn, claimed });
      else if (delta < -1e-9) found.below.push({ x, z, delta, drawn, claimed });
    }
  }
  return found;
}

const worst = (list) => list.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a),
  { delta: 0, x: 0, z: 0 });

function present(found) {
  out(`  ${found.samples} samples\n`);
  out(`  ${'finding'.padEnd(34)}${'samples'.padStart(9)}   worst`);
  const report = (what, list, extra) => out(`  ${what.padEnd(34)}${String(list.length).padStart(9)}   ${extra}`);
  const w1 = worst(found.above);
  const w2 = worst(found.below);
  report('walker stands OVER the stone', found.above,
    found.above.length ? `${w1.delta.toFixed(4)} m at (${w1.x.toFixed(2)}, ${w1.z.toFixed(2)})` : '--');
  report('walker stands INSIDE the stone', found.below,
    found.below.length ? `${w2.delta.toFixed(4)} m at (${w2.x.toFixed(2)}, ${w2.z.toFixed(2)})` : '--');
  report('stone drawn, contract says none', found.missing,
    found.missing.length ? `${found.missing[0].drawn.toFixed(3)} m at (${found.missing[0].x.toFixed(2)}, ${found.missing[0].z.toFixed(2)})` : '--');
  report('contract says stone, none drawn', found.invented,
    found.invented.length ? `${found.invented[0].claimed.toFixed(3)} m at (${found.invented[0].x.toFixed(2)}, ${found.invented[0].z.toFixed(2)})` : '--');
  return Math.max(Math.abs(w1.delta), Math.abs(w2.delta));
}

out(`  THE GROUND UNDER THE RUN AND THE PLATFORM  --  x ${Math.min(xs[0], px[0]).toFixed(2)} to `
  + `${Math.max(xs[1], px[1]).toFixed(2)}, z ${zs[0].toFixed(2)} to ${zs[1].toFixed(2)}, at ${STEP} m`);
const deck = sweep(Math.min(xs[0], px[0]), Math.max(xs[1], px[1]), zs[0], zs[1]);
const deckGap = present(deck);

// The sixth name has to answer for the run and not for the union, because the
// gait rides one and not the other. Checked here rather than assumed: the two
// footprints very nearly touch.
let runDisagrees = 0;
for (let z = zs[0]; z <= zs[1]; z += STEP) {
  for (let x = xs[0]; x <= xs[1]; x += STEP) {
    const run = stairHeightAt(x, z);
    const built = builtHeightAt(x, z);
    if (run !== -Infinity && run !== built && materialAt(x, z) !== 'piattaforma') runDisagrees++;
  }
}
out(`\n  stairHeightAt against builtHeightAt off the platform: `
  + `${runDisagrees} sample(s) apart`);

// ------------------------------------------------------------- and the six
//
// The contract used to answer -Infinity over the footprint of a monolith,
// because while the six were nothing but blockers in the hub that was the whole
// truth: a walker kept out of a footprint never asks what is under it. E-V8c
// sends V8's third person arm against builtHeightAt, and an arm swung behind a
// walker DOES pass over a footprint the walker is kept out of. The size of that
// silence was measured rather than described -- 62,548 samples, the highest
// 7.095 m on 02 -- and it is now wired, so the same footprints are swept as
// GROUND and not as a silence: the counter below is what is left of the old
// measurement and it has to read nought, and the four findings beside it are
// the same four the run and the platform are judged by.
//
// Each block's own footprint, with a margin, because the edge of a block is
// where a contract and a mesh part company if they are going to.
let sixSamples = 0;
const six = { samples: 0, above: [], below: [], missing: [], invented: [] };
let silent = 0;
let deepest = { y: -Infinity, x: 0, z: 0, id: null };
for (const spec of SIX) {
  const reach = (spec.size[0] + spec.size[2]) / 2 + 0.4;
  const found = sweep(
    spec.position.x - reach, spec.position.x + reach,
    spec.position.z - reach, spec.position.z + reach,
  );
  six.samples += found.samples;
  for (const key of ['above', 'below', 'missing', 'invented']) six[key].push(...found[key]);
  for (let z = spec.position.z - reach; z <= spec.position.z + reach; z += STEP) {
    for (let x = spec.position.x - reach; x <= spec.position.x + reach; x += STEP) {
      const drawn = builtStoneAt([spec], x, z);
      sixSamples++;
      if (drawn === -Infinity) continue;
      if (builtHeightAt(x, z) !== -Infinity) continue;
      silent++;
      if (drawn > deepest.y) deepest = { y: drawn, x, z, id: spec.id };
    }
  }
}
out(`\n  THE FOOTPRINTS OF THE SIX  --  ${SIX.map((s) => s.id).join(', ')}, `
  + `each (w+d)/2 + 0.40 m about its centre, at ${STEP} m`);
const sixGap = present(six);
out(`\n  stone drawn where the contract is SILENT: ${silent} of ${sixSamples} sample(s)`
  + `${silent ? `, the highest ${deepest.y.toFixed(3)} m on ${deepest.id}` : ''}`);
out('  (it was 62,548, the highest 7.095 m on 02, before the contract was wired)');

const gap = Math.max(deckGap, sixGap);
out(`\n${'='.repeat(66)}`);
if (injected) {
  const caught = gap >= Math.abs(injected) * 0.9;
  out(caught
    ? `  the injected ${injected} m was caught: worst gap ${gap.toFixed(4)} m.`
    : `  THE INJECTED ${injected} m WAS NOT CAUGHT (worst gap ${gap.toFixed(4)} m).`);
  process.exit(caught ? 0 : 1);
}
out(`  worst disagreement between the floor and the picture: ${gap.toFixed(4)} m`);
process.exit(0);
