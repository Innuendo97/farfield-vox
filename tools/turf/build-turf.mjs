import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../grade/lib/framing.mjs';
import { writeCleanPng } from '../grade/lib/png.mjs';
import {
  BAND, FIELD, GATES, GRAIN, MAX_SLOPE, MEASURED_BLADE, MEASURED_RISE, SEED, TIDE,
  TRANSFER, meshStep, radiusFloor, riseAt, turfAt,
} from './turf-rule.mjs';

// THE SEAT OF THE TURF FIELD. Reads the rule and writes the two files everything
// else reads:
//
//   assets-src/turf/turf.png    the field. Generated, never edited by hand.
//   assets-src/turf/turf.json   its constants, its seed, and the measurement.
//
//   node tools/turf/build-turf.mjs
//   node tools/turf/build-turf.mjs --check    rebuild nothing, only measure
//
// It runs BEFORE the terrain in the chain, because the ground is built on the
// field and not the other way round.
//
// The field is 288 x 288 over the 72 m square the walker's height grid already
// covers, centred where that grid is centred, so the sheet and the floor under
// the feet cannot slide apart. A quarter of a metre per texel: the smallest
// thing it has to carry is the south flank of a hummock, about a metre and a
// half of ground, and six texels across that is enough for the normal read off
// it to hold 25 to 32 degrees without stepping.

const OUT_DIR = join(REPO_ROOT, 'assets-src', 'turf');
const CHECK = process.argv.includes('--check');

/** World position of the centre of a texel. */
function worldOf(ix, iy) {
  return {
    x: FIELD.centreX - FIELD.size / 2 + (ix + 0.5) * FIELD.metresPerTexel,
    z: FIELD.centreZ - FIELD.size / 2 + (iy + 0.5) * FIELD.metresPerTexel,
  };
}

const { texels } = FIELD;
const started = Date.now();
const rise = new Float64Array(texels * texels);
const turf = new Float64Array(texels * texels);
for (let iy = 0; iy < texels; iy++) {
  for (let ix = 0; ix < texels; ix++) {
    const { x, z } = worldOf(ix, iy);
    rise[iy * texels + ix] = riseAt(x, z);
    turf[iy * texels + ix] = turfAt(x, z);
  }
}

// AND THE SLOPE IS GUARANTEED HERE, on the sheet that actually ships.
//
// Every piece of the rule keeps itself under 32 degrees on its own -- the
// measured profile is limited along the crest, the law sizes each cap for its
// own height -- and the assembled field still broke it, at 45 degrees, where a
// measured hummock crossfades into a law one. Two things each within a bound do
// not make a sum within it, and the only place that can be settled is the
// delivery. So the field is dilated by a cone: a value may be RAISED by a
// neighbour that is higher than this slope allows, never lowered, which leaves
// every crown a fixed point and only ever widens a foot.
const cellDrop = MAX_SLOPE * FIELD.metresPerTexel;
const diagonalDrop = cellDrop * Math.SQRT2;
for (let pass = 0; pass < 64; pass++) {
  let moved = 0;
  for (let iy = 0; iy < texels; iy++) {
    for (let ix = 0; ix < texels; ix++) {
      const o = iy * texels + ix;
      let best = rise[o];
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          if (!i && !j) continue;
          const qx = ix + i;
          const qy = iy + j;
          if (qx < 0 || qy < 0 || qx >= texels || qy >= texels) continue;
          const drop = i && j ? diagonalDrop : cellDrop;
          const lift = rise[qy * texels + qx] - drop;
          if (lift > best) best = lift;
        }
      }
      if (best > rise[o] + 1e-9) { rise[o] = best; moved++; }
    }
  }
  if (!moved) break;
}

const pixels = Buffer.alloc(texels * texels * 4);
let peakRise = 0;
for (let i = 0; i < rise.length; i++) {
  if (rise[i] > peakRise) peakRise = rise[i];
  const o = i * 4;
  pixels[o] = Math.round(Math.min(1, rise[i] / TRANSFER.RISE_MAX) * 255);
  pixels[o + 1] = Math.round(Math.min(1, Math.max(0, turf[i])) * 255);
  // Reserved, and said so: nothing reads them, and a consumer that starts to
  // must come back here rather than inventing a meaning for them.
  pixels[o + 2] = 0;
  pixels[o + 3] = 255;
}

/**
 * The delivered field, read the way the world will read it.
 *
 * Every number below comes through here rather than from the rule, because the
 * rule is not what ships: after the dilation above they are not the same field,
 * and validating the one that does not ship is how a delivery passes on a
 * measurement it does not actually carry.
 */
function fieldRise(x, z) {
  const fx = (x - (FIELD.centreX - FIELD.size / 2)) / FIELD.metresPerTexel - 0.5;
  const fy = (z - (FIELD.centreZ - FIELD.size / 2)) / FIELD.metresPerTexel - 0.5;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const at = (a, b) => (a < 0 || b < 0 || a >= texels || b >= texels
    ? 0 : rise[b * texels + a]);
  return (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty)
    + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
}

// The constants that travel with the field, in one object, so that the module
// the world imports and the picture a human opens cannot describe two fields.
const META = {
  field: {
    centre: { x: FIELD.centreX, z: FIELD.centreZ },
    size: FIELD.size,
    texels,
    metresPerTexel: FIELD.metresPerTexel,
    rim: { from: FIELD.rimFrom, to: FIELD.rimTo },
    channels: {
      R: 'rise of the ground, normalised: metres = R * transfer.RISE_MAX',
      G: 'T, the canopy: blade length and sowing density from the transfer constants',
      B: 'reserved',
      A: 'reserved',
    },
  },
  transfer: TRANSFER,
  gates: GATES,
  grain: GRAIN,
  tide: TIDE,
  seed: SEED,
  law: 'C',
  lawName: 'hummocks scattered on uneven ground',
  measured: {
    band: BAND,
    rise: MEASURED_RISE,
    blade: MEASURED_BLADE,
    note: 'read off target.png at the reference pose; the crest a photograph shows is '
      + 'ground plus what grows on it, and these are the two halves separated.',
  },
};

/**
 * The field as a MODULE, not as a download.
 *
 * src/world/hub.js builds the walker's height sampler before any texture has
 * arrived, and says why: "the walker has to stand on the right height
 * immediately". A hummock that only exists once a PNG has been decoded would
 * break that promise, and would put the walker a quarter of a metre under the
 * ground he is looking at for as long as the fetch takes. So the two planes are
 * bundled, base64 in a JavaScript module, and are there on the first frame.
 *
 * A module rather than a JSON import for a second reason, which is measured
 * rather than feared: terrain-field.js reads this field, and terrain-field.js is
 * imported by tools/terrain/build-mesh.mjs, tools/terrain/probe.mjs and
 * tools/vegetation/plan-rocks.mjs under plain node, where a bare JSON import is
 * a syntax error. One artefact both sides can read costs nothing; two would be
 * two fields.
 *
 * The cost: 165 888 raw bytes, 221 184 of base64, which the wire compresses back
 * down (see the report the build prints). atob is in both runtimes.
 */
function moduleSource() {
  const planes = Buffer.alloc(texels * texels * 2);
  for (let i = 0; i < texels * texels; i++) {
    planes[i] = pixels[i * 4];
    planes[texels * texels + i] = pixels[i * 4 + 1];
  }
  return `// GENERATED by tools/turf/build-turf.mjs. Do not edit.
//
// The turf field: how far the ground rises into a hummock, and how long the
// grass stands, over every quarter metre of the meadow. The rule that made it
// lives in tools/turf/turf-rule.mjs and is not shipped; this is.
//
// Bundled rather than fetched because the walker's floor is built before any
// texture arrives (src/world/hub.js), and read through src/world/turf.js, which
// is the only door to it.

export const META = ${JSON.stringify(META, null, 2)};

// The two channels back to back: ${texels * texels} bytes of rise, then the same
// of canopy. Base64 because a module is text, and text is what both the bundler
// and node can read without a loader.
const PLANES = '${planes.toString('base64')}';

function decode() {
  const binary = atob(PLANES);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const bytes = decode();
const plane = ${texels * texels};

/** Rise of the ground, 0..255, row major, ${texels} x ${texels}. */
export const RISE = bytes.subarray(0, plane);

/** The canopy, 0..255, on the same grid. */
export const CANOPY = bytes.subarray(plane, plane * 2);
`;
}

if (!CHECK) {
  mkdirSync(OUT_DIR, { recursive: true });
  const bytes = await writeCleanPng(pixels, { width: texels, height: texels, channels: 4 },
    join(OUT_DIR, 'turf.png'));
  process.stdout.write(`turf ${texels}x${texels} over ${FIELD.size} m `
    + `(${FIELD.metresPerTexel} m/texel) in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  process.stdout.write(`  ${join(OUT_DIR, 'turf.png')} (${(bytes / 1024).toFixed(0)} kB) `
    + '— the eye\'s copy of the field; nothing reads it\n');

  const source = moduleSource();
  writeFileSync(join(OUT_DIR, 'turf-field.js'), source, 'utf8');
  const { brotliCompressSync, gzipSync } = await import('node:zlib');
  const raw = Buffer.from(source, 'utf8');
  process.stdout.write(`  ${join(OUT_DIR, 'turf-field.js')} `
    + `(${(raw.length / 1024).toFixed(1)} kB source, `
    + `${(gzipSync(raw).length / 1024).toFixed(1)} kB gzip, `
    + `${(brotliCompressSync(raw).length / 1024).toFixed(1)} kB brotli) — what ships\n`);
}

// ------------------------------------------------------------- the validation
//
// A generator that cannot be shown to reproduce the two hummocks the photograph
// actually contains is a generator nobody should believe. So it is asked, every
// run, and the answer is printed rather than filed.

process.stdout.write('\nAGAINST THE TWO HUMMOCKS THE REFERENCE SHOWS\n');
process.stdout.write(`${'x'.padStart(7)}${'measured'.padStart(10)}${'field'.padStart(9)}`
  + `${'error'.padStart(9)}\n`);
let worst = 0;
let sum = 0;
let n = 0;
for (const [x, wanted] of MEASURED_RISE) {
  const got = fieldRise(x, BAND.z);
  const error = got - wanted;
  if (Math.abs(error) > Math.abs(worst)) worst = error;
  sum += error * error;
  n++;
  process.stdout.write(`${x.toFixed(2).padStart(7)}${wanted.toFixed(3).padStart(10)}`
    + `${got.toFixed(3).padStart(9)}${error.toFixed(3).padStart(9)}\n`);
}
process.stdout.write(`  rms ${Math.sqrt(sum / n).toFixed(4)} m, worst ${worst.toFixed(4)} m`
  + ` over ${n} measured columns\n`);

process.stdout.write('\nAND THE BLADES IT MEASURED\n');
for (const [x, wanted] of MEASURED_BLADE) {
  const g = turfAt(x, BAND.z);
  const metres = TRANSFER.LEN_BARE + g * (TRANSFER.LEN_FULL - TRANSFER.LEN_BARE);
  process.stdout.write(`${x.toFixed(2).padStart(7)}${wanted.toFixed(3).padStart(10)}`
    + `${metres.toFixed(3).padStart(9)}${(metres - wanted).toFixed(3).padStart(9)}\n`);
}

// The south flank, which is the whole reason the committente named this cause:
// it has to fall between 25 and 32 degrees or it throws no corner shadow at 25
// and reads as a black silhouette at 34.
process.stdout.write('\nTHE SOUTH FLANK OF EACH MEASURED HUMMOCK\n');
for (const [label, x] of [['sx', -5.92], ['dx', 4.67]]) {
  let steepest = 0;
  let at = 0;
  for (let z = BAND.z; z < BAND.z + 3; z += 0.02) {
    const slope = (fieldRise(x, z) - fieldRise(x, z + 0.02)) / 0.02;
    if (slope > steepest) { steepest = slope; at = z; }
  }
  const degrees = Math.atan(steepest) * 180 / Math.PI;
  process.stdout.write(`  ${label}  steepest ${degrees.toFixed(1)} deg at z ${at.toFixed(2)}`
    + `   ${degrees >= 25 && degrees <= 32 ? 'in the 25-32 the reference asks for' : 'OUT OF RANGE'}\n`);
}

// And east to west, which the reference does NOT constrain -- those faces are
// seen edge on and no brightness was read off them -- but which has to be
// reported rather than assumed, because it is what the reading itself asks for
// and it is steeper than the flank.
process.stdout.write('\nEAST TO WEST ALONG THE CREST, which the reading sets and nothing checks\n');
let acrossWorst = 0;
let acrossAt = 0;
for (let x = -8; x < 8; x += 0.02) {
  const slope = Math.abs(fieldRise(x + 0.02, BAND.z) - fieldRise(x, BAND.z)) / 0.02;
  if (slope > acrossWorst) { acrossWorst = slope; acrossAt = x; }
}
process.stdout.write(`  steepest ${(Math.atan(acrossWorst) * 180 / Math.PI).toFixed(1)} deg `
  + `at x ${acrossAt.toFixed(2)}  (the reading goes 0.06 to 0.49 in 0.59 m there)\n`);

// The mesh has to be able to carry what the field asks it to carry.
process.stdout.write('\nWHAT THE MESH CAN CARRY\n');
process.stdout.write(`${'radius'.padStart(8)}${'mesh step'.padStart(11)}`
  + `${'smallest hummock'.padStart(18)}\n`);
for (const radius of [6, 12, 19.6]) {
  process.stdout.write(`${`${radius} m`.padStart(8)}${meshStep(radius).toFixed(3).padStart(11)}`
    + `${radiusFloor(radius).toFixed(2).padStart(18)}\n`);
}

// And the statistics out of frame, which is the only thing the law was for. The
// reference counts TWO hummocks across the twelve metres of meadow the frame
// covers, in a band 3.4 m deep -- one every six or seven metres. That is the
// number the law has to carry outside, and it is counted rather than asserted:
// a local maximum of the field over 0.15 m, found on a fine grid.
const STEP = 0.25;
const found = [];
for (let z = -19; z <= 19; z += STEP) {
  for (let x = -19; x <= 19; x += STEP) {
    if (Math.hypot(x - FIELD.centreX, z - FIELD.centreZ) > 19) continue;
    const h = fieldRise(x, z);
    if (h < 0.15) continue;
    let top = true;
    for (let j = -1; j <= 1 && top; j++) {
      for (let i = -1; i <= 1; i++) {
        if (!i && !j) continue;
        if (fieldRise(x + i * STEP, z + j * STEP) > h) { top = false; break; }
      }
    }
    // One crown, not the plateau of texels that share its height.
    if (top && !found.some((f) => Math.hypot(f.x - x, f.z - z) < 1.6)) found.push({ x, z, h });
  }
}
let above = 0;
let cells = 0;
for (let z = -19; z <= 19; z += 0.5) {
  for (let x = -19; x <= 19; x += 0.5) {
    if (Math.hypot(x - FIELD.centreX, z - FIELD.centreZ) > 19) continue;
    cells++;
    if (fieldRise(x, z) > 0.15) above++;
  }
}
const area = Math.PI * 19 * 19;
const inFrame = found.filter((f) => Math.abs(f.x) <= 6.6 && Math.abs(f.z - BAND.z) <= 1.7);
process.stdout.write('\nOUT OF FRAME, THE SAME STATISTICS\n');
process.stdout.write(`  ${found.length} hummocks over 0.15 m inside the walkable radius: `
  + `one every ${(area / found.length).toFixed(0)} square metres, `
  + `which is one every ${Math.sqrt(area / found.length).toFixed(1)} m of walking\n`);
process.stdout.write(`  the reference: 2 in the 12 m x 3.4 m the frame measures, `
  + `one every 6-7 m\n`);
process.stdout.write(`  and this field puts ${inFrame.length} in that same band\n`);
process.stdout.write(`  ground over 0.15 m: ${(100 * above / cells).toFixed(1)}% of the meadow\n`);
process.stdout.write(`  peak rise anywhere in the field: ${peakRise.toFixed(3)} m `
  + `(RISE_MAX ${TRANSFER.RISE_MAX}, tallest measured 0.54)\n`);
