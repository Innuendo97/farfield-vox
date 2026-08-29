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
// AND THE PICTURE IT IS ASKED AGAINST HAS CHANGED, which is the whole of this
// revision and the reason it could not be left alone. This tool used to read
// stairFaces() -- the quad list src/world/stairs.js hands out -- and that WAS
// the stair while the stair was a delivered mesh. It is not any more: the run
// and the platform are courses of masonry cut from src/world/stone.js, and the
// old quad list is no longer drawn by anything. Left as it was, the tool would
// have reported 0.0000 m against a staircase nobody can see, which is worse
// than reporting nothing: a green check on a stale reference is how a defect
// gets a certificate. So the decks are read from the SAME specs the layer
// builds, through the same masonryDecks() the mesh is cut from.
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
const BUILT = stairSpecs(SPEC);

/** The highest drawn stone under a point, or -Infinity where none is drawn. */
const drawnHeightAt = (x, z) => builtStoneAt(BUILT, x, z);

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
out(`  decks       the masonry of ${BUILT.map((s) => s.id).join(' and ')}, `
  + 'through masonryDecks() -- the same law the mesh is cut from');
out(`  sweep       x ${Math.min(xs[0], px[0]).toFixed(2)} to ${Math.max(xs[1], px[1]).toFixed(2)}, `
  + `z ${zs[0].toFixed(2)} to ${zs[1].toFixed(2)}, at ${STEP} m`);
if (injected) out(`  INJECTED    the contract is offset by ${injected} m for this run\n`);
else out('');

let samples = 0;
const above = [];      // the contract stands the walker over the stone
const below = [];      // the contract stands the walker inside it
const missing = [];    // stone is drawn and the contract says there is none
const invented = [];   // the contract says stone and none is drawn

for (let z = zs[0]; z <= zs[1]; z += STEP) {
  for (let x = Math.min(xs[0], px[0]); x <= Math.max(xs[1], px[1]); x += STEP) {
    const drawn = drawnHeightAt(x, z);
    const said = builtHeightAt(x, z);
    const claimed = said === -Infinity ? said : said + injected;
    samples++;
    if (drawn === -Infinity && claimed === -Infinity) continue;
    if (drawn === -Infinity) { invented.push({ x, z, claimed }); continue; }
    if (claimed === -Infinity) { missing.push({ x, z, drawn }); continue; }
    const delta = claimed - drawn;
    if (delta > 1e-9) above.push({ x, z, delta, drawn, claimed });
    else if (delta < -1e-9) below.push({ x, z, delta, drawn, claimed });
  }
}

const worst = (list) => list.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a),
  { delta: 0, x: 0, z: 0 });

out(`  ${samples} samples over the built footprint\n`);
out(`  ${'finding'.padEnd(34)}${'samples'.padStart(9)}   worst`);
const report = (what, list, extra) => out(`  ${what.padEnd(34)}${String(list.length).padStart(9)}   ${extra}`);
const w1 = worst(above);
const w2 = worst(below);
report('walker stands OVER the stone', above,
  above.length ? `${w1.delta.toFixed(4)} m at (${w1.x.toFixed(2)}, ${w1.z.toFixed(2)})` : '--');
report('walker stands INSIDE the stone', below,
  below.length ? `${w2.delta.toFixed(4)} m at (${w2.x.toFixed(2)}, ${w2.z.toFixed(2)})` : '--');
report('stone drawn, contract says none', missing,
  missing.length ? `${missing[0].drawn.toFixed(3)} m at (${missing[0].x.toFixed(2)}, ${missing[0].z.toFixed(2)})` : '--');
report('contract says stone, none drawn', invented,
  invented.length ? `${invented[0].claimed.toFixed(3)} m at (${invented[0].x.toFixed(2)}, ${invented[0].z.toFixed(2)})` : '--');

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

// ------------------------------------------------- and the six, which nobody
// has ever been able to ask about
//
// The contract answers -Infinity over the footprint of a monolith, because
// while the six were blockers in the hub that was the whole truth: a walker
// kept out of a footprint never asks what is under it. E-V8c sends V8's third
// person arm against builtHeightAt, and an arm swung behind a walker DOES pass
// over a footprint the walker is kept out of. So the size of the silence is
// measured here rather than described: how much stone is drawn where the
// contract says there is none, and how deep the deepest of it is.
const SIX = stoneSpecs(SPEC);
let silent = 0;
let deepest = { y: -Infinity, x: 0, z: 0, id: null };
for (const spec of SIX) {
  const reach = (spec.size[0] + spec.size[2]) / 2 + 0.4;
  for (let z = spec.position.z - reach; z <= spec.position.z + reach; z += STEP) {
    for (let x = spec.position.x - reach; x <= spec.position.x + reach; x += STEP) {
      const drawn = builtStoneAt([spec], x, z);
      if (drawn === -Infinity) continue;
      if (builtHeightAt(x, z) !== -Infinity) continue;
      silent++;
      if (drawn > deepest.y) deepest = { y: drawn, x, z, id: spec.id };
    }
  }
}
out(`\n  the six against the contract: ${silent} sample(s) of stone drawn where the`);
out(`  contract answers none, the highest ${deepest.y.toFixed(3)} m on ${deepest.id}`
  + ` at (${deepest.x.toFixed(2)}, ${deepest.z.toFixed(2)})`);

const gap = Math.max(Math.abs(w1.delta), Math.abs(w2.delta));
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
