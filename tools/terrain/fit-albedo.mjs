import { makeRay } from '../grade/lib/framing.mjs';
import { meanRect, readTarget } from '../grade/lib/target.mjs';
import { castShadowTest } from '../lighting/cast-shadow.mjs';
import { loadGround, predictPatch, solveRadiance } from './probe.mjs';
import { PATCHES } from './sample-target.mjs';

// WHAT THE PIGMENTS HAVE TO BE UNDER THE LIGHT THIS SESSION PUT IN.
//
//   node tools/terrain/fit-albedo.mjs
//
// The meadow and the slabs of the path were fitted through a light that has
// since changed twice over: the world used to be lit by no sun at all and by a
// dome whose lower hemisphere was seven times too bright. An albedo fitted
// through a wrong light is not a reflectance, it is a reflectance times an
// error, and this is where the error is divided back out.
//
// It prints a GAIN per channel and nothing else. A gain is what a pigment error
// is: the reference's own measured patches are inverted through the whole
// composite to the radiance each has to carry, that is divided by the radiance
// the frame currently puts there, and what is left is how far the paint is out.
// A difference of LIGHT varies from patch to patch; a difference of PIGMENT is
// the same on all of them, so the spread across the set is printed beside the
// median and is the thing that says which of the two this is.
//
// AND THE SPREAD IS NOW PRINTED FOR THE HUE AS WELL, which is the half of the
// answer this tool is actually read for. The level is never applied — it goes to
// the two strengths — so the spread that used to be printed was the spread of
// the number nobody was going to move, while the number that DID get moved, the
// hue, was quoted as a bare median. That is how `fa6a744` came to multiply the
// stone's red by 0.834: one median, no spread beside it, and an inversion that
// was wrong by a factor that varies down the frame. Both halves are split out
// per patch below, so a hue can be refused for the same reason a level is.
//
// ON THE UNCONTRADICTED GROUND ONLY, and it matters more here than anywhere.
// The reference is two to five times brighter than this world inside the sealed
// sun's cast shadows; those patches ask for gains of six, eight and eleven while
// the ones beside them ask for a quarter. A median over both is a median of a
// contradiction. So the belt goes out, and it is said how many patches went
// with it.
//
// Nothing is written. The three grass constants and the three stone ones are
// declared in tools/terrain/paint-albedo.mjs and tools/terrain/lib/paint.mjs
// with the reasoning that put them there, and a tool that silently rewrote them
// would take that reasoning out of the file that carries it.

const Y_WEIGHTS = [0.2126, 0.7152, 0.0722];
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const half = sorted.length >> 1;
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
};

async function main() {
  const ground = await loadGround();
  const target = await readTarget();
  const ray = makeRay();
  const occluded = castShadowTest({ withBuilt: true });

  const rows = [];
  let contradicted = 0;
  for (const patch of PATCHES) {
    if (patch.kind !== 'grass' && patch.kind !== 'path') continue;
    const predicted = predictPatch(ground, ray, patch);
    if (!predicted) continue;
    if (occluded(predicted.x, 0.05, predicted.z)) { contradicted++; continue; }
    const measured = meanRect(target, patch);
    const wanted = solveRadiance(measured, (patch.x0 + patch.x1) / 2,
      (patch.y0 + patch.y1) / 2, ground.lut);
    const gain = wanted.radiance.map((v, c) => v / Math.max(1e-6, predicted.radiance[c]));
    const level = gain.reduce((t, v, c) => t + v * Y_WEIGHTS[c], 0);
    rows.push({
      id: patch.id,
      kind: patch.kind,
      distance: predicted.distance,
      gain,
      level,
      hue: gain.map((v) => v / level),
    });
  }

  process.stdout.write(`${rows.length} patches on ground the reference does not contradict, `
    + `${contradicted} left out for standing in the seat sun's cast shadow\n\n`);
  process.stdout.write(`${'patch'.padEnd(20)}${'kind'.padEnd(7)}${'dist'.padStart(7)}`
    + `${'gain r'.padStart(9)}${'g'.padStart(8)}${'b'.padStart(8)}${'level'.padStart(9)}`
    + `${'hue r'.padStart(9)}${'g'.padStart(8)}${'b'.padStart(8)}\n`);
  for (const row of rows) {
    process.stdout.write(`${row.id.padEnd(20)}${row.kind.padEnd(7)}`
      + `${row.distance.toFixed(1).padStart(7)}`
      + `${row.gain.map((v) => v.toFixed(2).padStart(8)).join(' ')}`
      + `${row.level.toFixed(2).padStart(9)}`
      + `${row.hue.map((v) => v.toFixed(3).padStart(8)).join('')}\n`);
  }

  for (const kind of ['grass', 'path']) {
    const set = rows.filter((r) => r.kind === kind);
    if (!set.length) continue;
    const gain = [0, 1, 2].map((c) => median(set.map((r) => r.gain[c])));
    const lo = [0, 1, 2].map((c) => Math.min(...set.map((r) => r.gain[c])));
    const hi = [0, 1, 2].map((c) => Math.max(...set.map((r) => r.gain[c])));
    process.stdout.write(`\n${kind.toUpperCase()}, ${set.length} patches\n`);
    process.stdout.write(`  median gain   ${gain.map((v) => v.toFixed(3).padStart(8)).join('')}\n`);
    process.stdout.write(`  spread        ${lo.map((v, c) => `${v.toFixed(2)}..${hi[c].toFixed(2)}`
      .padStart(8)).join('')}\n`);
    // A gain is a pigment only if the three channels move apart from each other.
    // The part they share is a LEVEL, and the level belongs to the two strengths
    // and to GROUND_EXPOSURE, not to the paint: folding it into a reflectance
    // would nail the surface to this hour.
    const level = gain.reduce((t, v, c) => t + v * Y_WEIGHTS[c], 0);
    process.stdout.write(`  of which level ${level.toFixed(3)}, `
      + `and hue ${gain.map((v) => (v / level).toFixed(3).padStart(8)).join('')}\n`);
    // And what the hue is worth, which is the spread of the hue and not of the
    // gain. A hue whose own patches disagree by a third is not a pigment either.
    const hue = [0, 1, 2].map((c) => median(set.map((r) => r.hue[c])));
    const hlo = [0, 1, 2].map((c) => Math.min(...set.map((r) => r.hue[c])));
    const hhi = [0, 1, 2].map((c) => Math.max(...set.map((r) => r.hue[c])));
    process.stdout.write(`  median hue    ${hue.map((v) => v.toFixed(3).padStart(8)).join('')}\n`);
    process.stdout.write(`  hue spread    ${hlo.map((v, c) => `${v.toFixed(2)}..${hhi[c].toFixed(2)}`
      .padStart(8)).join('')}\n`);
  }

  process.stdout.write('\nthe grass constants are GRASS_LIT, GRASS_DRY, GRASS_DEEP and SOIL in\n'
    + 'tools/terrain/paint-albedo.mjs; the slabs are STONE, STONE_DARK and STONE_WORN in\n'
    + 'tools/terrain/lib/pattern.mjs. READ THE HUE SPREAD BEFORE MOVING ANYTHING: a hue\n'
    + 'whose patches run from three quarters to one is a light this world and the\n'
    + 'photograph disagree about, not a pigment, and multiplying by its median spreads\n'
    + 'that disagreement over the whole meadow. Then "node tools/terrain/paint-albedo.mjs"\n'
    + 'and "paint-stairs.mjs" (no bake: the light and the paint are separate sheets).\n');
}

await main();
