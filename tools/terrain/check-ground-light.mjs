import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { MONOLITHS, PLATFORM } from '../../src/world/layout.js';
import { heightAt, worldToUv } from '../../src/world/terrain-field.js';
import { castShadowTest } from '../lighting/cast-shadow.mjs';
import { readSun, REPO_ROOT } from '../lighting/sun.mjs';

// IS THE GROUND LIGHT MAP WOUND THE SAME WAY ROUND AS THE WORLD?
//
//   node tools/terrain/check-ground-light.mjs                 # after every bake
//   node tools/terrain/check-ground-light.mjs --pretend-flipped
//
// A light map and the albedo it multiplies are two sheets laid on the same
// mesh, and nothing in either file says which way up it is. The albedo is
// painted here, in this repository, walking rows from the first
// (paint-albedo.mjs, v = (py + 0.5) / SIZE); the light map comes out of Blender,
// which writes a PNG from the bottom up. If the texture coordinate handed to
// the bake is not turned over on the way, the two sheets disagree north to
// south, and the ground is lit by a mirror image of its own world.
//
// It is not a difference an eye catches. A meadow shaded the wrong way round is
// still a meadow with shading on it: the shadows are the right shape, the right
// softness and the right darkness, they are simply in the wrong place. This is
// therefore a thing that has to be MEASURED, and measured every time, which is
// why it stands in the chain after the bake rather than in a report.
//
// HOW IT ASKS. The shadow of a block is arithmetic and needs no bake to know:
// march from a point on the ground towards the sun of the seat and see whether
// any block is in the way. That prediction is compared against the baked sun
// term read BOTH ways up, and the winding whose darkness lands under the
// predicted shadow is the world's. A map wound correctly reads far darker under
// the prediction than on open meadow; a mirrored one reads nearly the same
// under both, because the prediction is then landing on unrelated ground.
//
// WHAT IT CANNOT DO, said out loud: it needs blocks that actually throw shadows
// onto sampled meadow. It reports its sample count for that reason, and refuses
// to pass on too few rather than passing on a number it cannot support.

const argv = process.argv.slice(2);
const PRETEND_FLIPPED = argv.includes('--pretend-flipped');

// A correctly wound map reads well under a fifth of open meadow under the
// prediction. A mirrored one reads about four fifths. The gate is set between
// them with room on both sides, and the margin below is what actually decides:
// an absolute threshold alone would also pass a map that is dark everywhere.
const RATIO_MAX = 0.45;
const MARGIN_MIN = 0.15;
const MIN_SHADOW_SAMPLES = 400;

const seat = readSun();

// Where the sun of the seat throws a shadow. Out of tools/lighting/cast-shadow.mjs
// so that this guard, the fit of the canopy and the mask of the uncontradicted
// ground all ask ONE piece of geometry instead of three copies of it. The blocks
// alone: the platform and the steps stand on levelled ground and their shadows
// are too small to read on this atlas, and a prediction that includes them only
// adds samples that say nothing.
const occluded = castShadowTest({ withBuilt: false });

// What is not meadow the shadow could have fallen on: a sample that lands on a
// block or on the platform reads the side of a solid, which is dark for a
// reason that has nothing to do with which way up the sheet is.
const near = (x, z) => MONOLITHS.some((m) => Math.hypot(x - m.position.x, z - m.position.z)
    < Math.hypot(m.size[0], m.size[2]) / 2 + 1.0)
  || Math.hypot(x - PLATFORM.x, z - PLATFORM.z)
    < Math.hypot(PLATFORM.width, PLATFORM.depth) / 2 + 1.5;

async function readMap(path) {
  const { data, info } = await sharp(join(REPO_ROOT, path)).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * The sun term at a world position, as the runtime reads it.
 *
 * Channel 0 both ways: the raw bake writes a scalar into all three, and the
 * packed delivery puts the sun in red. So one reader serves both files.
 */
function termAt(map, x, z, turned) {
  const { u, v } = worldToUv(x, z);
  const w = turned ? 1 - v : v;
  const px = Math.min(map.width - 1, Math.max(0, Math.round(u * (map.width - 1))));
  const py = Math.min(map.height - 1, Math.max(0, Math.round(w * (map.height - 1))));
  return map.data[(py * map.width + px) * map.channels] / 255;
}

/** Mean of the sun term under the predicted shadow, and on open meadow. */
function survey(map, turned) {
  let shade = 0;
  let shadeN = 0;
  let lit = 0;
  let litN = 0;
  for (let z = -26; z <= 26; z += 0.25) {
    for (let x = -20; x <= 20; x += 0.25) {
      if (near(x, z)) continue;
      // A finger above the surface, so a ray does not start inside the ground.
      const y = heightAt(x, z) + 0.02;
      const value = termAt(map, x, z, turned);
      if (occluded(x, y, z)) { shade += value; shadeN++; } else { lit += value; litN++; }
    }
  }
  return {
    shade: shade / shadeN, shadeN, lit: lit / litN, litN, ratio: shade / shadeN / (lit / litN),
  };
}

// The packed delivery is what the runtime reads and is always present; the raw
// sun term is an intermediate that only exists just after a bake, and it is
// checked when it is there because it is the term the prediction is about.
const MAPS = [
  'assets-src/terrain/terrain-light-sun-bake.png',
  'assets-src/terrain/terrain-light.png',
].filter((p) => existsSync(join(REPO_ROOT, p)));

const f = (v) => v.toFixed(4).padStart(8);
console.log(`the seat: elevation ${seat.elevation}, azimuth ${seat.azimuth} `
  + `(assets-src/sky/sky.json day.sun)`);
if (PRETEND_FLIPPED) {
  console.log('\n--pretend-flipped: reading every map turned over, to show that the '
    + 'measurement fails when the defect is present.');
}

let failed = 0;
for (const path of MAPS) {
  const map = await readMap(path);
  // The validation reads the delivered map upside down, which is byte for byte
  // what a bake with the wrong texture coordinate hands over.
  const got = survey(map, PRETEND_FLIPPED);
  const other = survey(map, !PRETEND_FLIPPED);
  const margin = other.ratio - got.ratio;

  console.log(`\n${path}  (${map.width}x${map.height})`);
  console.log(`  ${got.shadeN} samples under the predicted shadow, ${got.litN} on open meadow`);
  console.log('  reading                under the shadow   open meadow    ratio');
  console.log(`    as the runtime reads it ${f(got.shade)}   ${f(got.lit)}   ${got.ratio.toFixed(3)}`);
  console.log(`    with v turned round     ${f(other.shade)}   ${f(other.lit)}   ${other.ratio.toFixed(3)}`);

  const reasons = [];
  if (got.shadeN < MIN_SHADOW_SAMPLES) {
    reasons.push(`only ${got.shadeN} samples fall under a predicted shadow, `
      + `under the ${MIN_SHADOW_SAMPLES} this reading needs`);
  }
  if (!(got.ratio < RATIO_MAX)) {
    reasons.push(`the meadow under the predicted shadow is ${got.ratio.toFixed(3)} of open `
      + `meadow, over the ${RATIO_MAX} a map lit by this sun stays under`);
  }
  if (!(margin > MARGIN_MIN)) {
    reasons.push(`the map read the other way up scores ${other.ratio.toFixed(3)}, only `
      + `${margin.toFixed(3)} away: this map does not commit to a winding`);
  }
  if (reasons.length) {
    failed++;
    console.log('  MIRRORED, or not lit by the seat:');
    for (const r of reasons) console.log(`    - ${r}`);
  } else {
    console.log(`  OK: darkness lands under the shadow the seat predicts, and the map read `
      + `the other way up is ${margin.toFixed(3)} worse.`);
  }
}

if (PRETEND_FLIPPED) {
  if (failed === MAPS.length) {
    console.log(`\nVALIDATION OK: with the defect present all ${MAPS.length} maps are `
      + 'rejected. The measurement finds the defect it was written for.');
    process.exit(0);
  }
  console.log(`\nVALIDATION FAILED: ${MAPS.length - failed} of ${MAPS.length} maps passed `
    + 'while flipped. Either the measurement does not find the defect and must not be '
    + 'trusted, or the delivery on disk is itself mirrored — in which case turning it over '
    + 'is what makes it healthy, and the validation cannot be run until the bake is fixed. '
    + 'Run without the flag to tell the two apart.');
  process.exit(1);
}

if (failed) {
  console.log(`\n${failed} of ${MAPS.length} ground light maps are not wound like the world.`);
  process.exit(1);
}
console.log(`\nall ${MAPS.length} ground light maps are wound like the world.`);
