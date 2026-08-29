import { builtHeightAt, materialAt, stairHeightAt } from '../../src/world/contracts.js';
import { stairFaces } from '../../src/world/stairs.js';
import { PLATFORM, STAIRS } from '../../src/world/layout.js';

// DOES THE FLOOR THE WALKER STANDS ON AGREE WITH THE STONE THAT IS DRAWN?
//
// src/world/contracts.js says of builtHeightAt that a contract is not a
// convenience wrapper, and that nothing in it may quietly become a different
// answer from the one the frame draws. Nobody had ever asked. The two answers
// come from different files -- the contract from an arithmetic footprint, the
// picture from the quad list src/world/stairs.js hands to the runtime, to the
// painter and to the bake -- and they are only the same answer as long as
// somebody keeps them so.
//
// So this samples the built footprint and puts the two side by side. A walker
// standing above the stone floats; a walker standing below it is inside it, and
// a camera arm swung behind that walker is inside it with them.
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

/** The horizontal faces of the built stone: what a foot can be on top of. */
const decks = stairFaces()
  .filter((f) => f.kind === 'tread' || f.kind === 'platform')
  .map((f) => ({
    kind: f.kind,
    y: f.corners[0][1],
    ring: f.corners.map((c) => [c[0], c[2]]),
  }));

function inside(ring, x, z) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/** The highest drawn deck under a point, or -Infinity where none is drawn. */
function drawnHeightAt(x, z) {
  let best = -Infinity;
  for (const deck of decks) {
    if (deck.y > best && inside(deck.ring, x, z)) best = deck.y;
  }
  return best;
}

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
out(`  decks       ${decks.length} horizontal faces from stairFaces()`);
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
