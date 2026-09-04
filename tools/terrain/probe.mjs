import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { agx } from '../grade/lib/agx.mjs';
import { linearToSrgb } from '../grade/lib/color.mjs';
import { REPO_ROOT } from '../grade/lib/framing.mjs';
import { makeLensShading } from '../grade/lib/shading.mjs';
import { meanRect, readTarget } from '../grade/lib/target.mjs';
import { PATCHES } from './sample-target.mjs';

// THE COMPOSITE OF THIS FRAME, AND ITS INVERSE.
//
// What a surface has to CARRY, in radiance, for the frame to land on a colour
// somebody measured. Grade, corner shading and tone curve are run forwards
// exactly as src/core/post.js runs them, and then inverted numerically, because
// none of the three has an inverse in closed form.
//
// IT USED TO PREDICT THE GROUND AS WELL, AND THAT HALF IS GONE AT STEP 8. This
// file walked the reference camera into a height field, found the world point
// behind every measured pixel, sampled terrain-albedo and terrain-light there
// and pushed the result through the composite as far as the encoded pixel. Both
// of the things that made that possible have been retired: the bent grid and its
// two atlases left the delivery, because nothing in src had asked for one of
// them since the meadow became cubes, and the height field became a constant
// when the walker started standing on the block store. The meadow's colour is
// now arithmetic in a SHADER -- src/world/voxel/material.js -- and nothing in
// node can sample it, so the prediction is not something to repair here: it is
// an instrument the light's own step has to build against the new ground.
//
// WHAT IS LEFT IS THE HALF THAT WAS NEVER ABOUT THE GROUND. The composite is the
// frame's, not the meadow's, and its inverse is what every session authors an
// unlit surface from: tools/monoliths/sample-stone.mjs solves the stone with it,
// and `--solve` below answers the same question for every measured patch of the
// reference. A hill carries its colour as a tint and nothing touches it
// afterwards except this arithmetic, so the tint that reproduces a measured
// patch is an answer and not a matter of taste.

// Exposure of the ground pass. It lives inside shader source, so it is named
// here rather than imported.
const EXPOSURE = 1.0;


// The corner shading, taken from the module that applies it instead of copied.
//
// There used to be a `VIGNETTE = 0.16` written out here, and it went stale
// twice over. First the term MOVED: until 2026-08-20 the composite pass darkened
// every frame from every bearing, and the committente's decision put the whole
// of this picture's corner shading into the arrival veil — src/ui/veil.js, which
// hangs over the spawn and lets go after two seconds. Then the term CHANGED: the
// fit of 2026-08-25 answered 0.42 against the 0.16 the composite used to carry,
// and the committente sealed that number in the DoD. The copy here followed
// neither, so this model was inverting a shading the frame does not apply, at a
// strength the frame never applied.
//
// Parsed out of veil.js now, through the same helper every other offline bake
// reads it with, so there is one sede for the number and this cannot drift again.
//
// WHAT IT MEANS FOR WHAT THIS ANSWERS. The inversion is exact at the SPAWN,
// which is the one moment the reference is a photograph of and the only moment
// this model is ever asked about; away from it the veil is gone and the frame
// carries no corner shading at all. S3 resamples the palettes through this
// pipeline, and it now resamples them under the veil the walker really arrives
// under rather than under a quarter of it.
const LENS = makeLensShading();

// The fitted grade, sampled exactly as the composite samples it: a cube of side
// N unrolled into a strip N*N wide, filtered bilinearly inside a slice and
// interpolated by hand across slices.
async function loadLut() {
  const path = join(REPO_ROOT, 'public', 'assets', 'grade-lut.png');
  if (!existsSync(path)) return null;
  const { data, info } = await sharp(path).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, size: info.height, data };
}

function tapLut(lut, u, v, out) {
  const x = Math.min(lut.width - 1.001, Math.max(0, u * lut.width - 0.5));
  const y = Math.min(lut.size - 1.001, Math.max(0, v * lut.size - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = Math.min(lut.width - 1, x0 + 1);
  const y1 = Math.min(lut.size - 1, y0 + 1);
  for (let c = 0; c < 3; c++) {
    const a = lut.data[(y0 * lut.width + x0) * 4 + c];
    const b = lut.data[(y0 * lut.width + x1) * 4 + c];
    const d = lut.data[(y1 * lut.width + x0) * 4 + c];
    const e = lut.data[(y1 * lut.width + x1) * 4 + c];
    out[c] = ((a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy) / 255;
  }
  return out;
}

function grade(lut, colour, out = [0, 0, 0]) {
  const n = lut.size;
  const r = Math.min(1, Math.max(0, colour[0]));
  const g = Math.min(1, Math.max(0, colour[1]));
  const b = Math.min(1, Math.max(0, colour[2]));
  const blue = b * (n - 1);
  const slice = Math.floor(blue);
  const t = blue - slice;
  const u = (0.5 + r * (n - 1)) / n;
  const v = (0.5 + g * (n - 1)) / n;
  const low = tapLut(lut, (slice + u) / n, v, [0, 0, 0]);
  const high = tapLut(lut, (Math.min(slice + 1, n - 1) + u) / n, v, [0, 0, 0]);
  for (let c = 0; c < 3; c++) out[c] = low[c] + (high[c] - low[c]) * t;
  return out;
}

/** Scene light to the encoded pixel: the composite of src/core/post.js. */
function composite(colour, px, py, lut, out = [0, 0, 0]) {
  agx([colour[0] * EXPOSURE, colour[1] * EXPOSURE, colour[2] * EXPOSURE], 1, out);
  // Same law and same arithmetic as before — linear in the squared screen
  // radius, twice the strength at the corner — with the strength read out of
  // src/ui/veil.js rather than written down again. See LENS above.
  const vignette = LENS.at(px, py);
  for (let c = 0; c < 3; c++) out[c] = linearToSrgb(Math.max(0, out[c] * vignette));
  return lut ? grade(lut, out, out) : out;
}



/**
 * The radiance a surface has to carry to land on a given colour.
 *
 * The composite is not invertible in closed form: AgX mixes the channels twice
 * through its inset and outset matrices, the vignette depends on where in the
 * frame the surface is, and the grade is a sampled cube. So it is inverted
 * numerically, one channel at a time over a few passes; the cross talk between
 * channels is weak enough that the passes converge in three or four rounds.
 *
 * This is what the unlit surfaces are authored from. A hill carries its colour
 * as a vertex tint and nothing touches it afterwards except the composite, so
 * the tint that reproduces a measured patch of the reference is an answer, not
 * a matter of taste.
 */
export function solveRadiance(wanted, px, py, lut, rounds = 5) {
  const value = [0.2, 0.2, 0.2];
  const probe = [0, 0, 0];
  for (let round = 0; round < rounds; round++) {
    for (let c = 0; c < 3; c++) {
      let lo = -14;
      let hi = 4;
      for (let k = 0; k < 34; k++) {
        const mid = (lo + hi) / 2;
        value[c] = 2 ** mid;
        composite(value, px, py, lut, probe);
        if (probe[c] < wanted[c]) lo = mid;
        else hi = mid;
      }
      value[c] = 2 ** ((lo + hi) / 2);
    }
  }
  composite(value, px, py, lut, probe);
  const error = Math.max(...[0, 1, 2].map((c) => Math.abs(probe[c] - wanted[c])));
  return { radiance: value.slice(), reached: probe.slice(), error };
}


const hex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)
  .toString(16).padStart(2, '0')).join('')}`;

/**
 * What every measured patch would have to carry, as radiance, for the frame to
 * land on the reference. Only meaningful for the surfaces that are drawn as a
 * flat colour: the hills, the giants, the standing water.
 */
async function solveAll() {
  const target = await readTarget();
  const lut = process.argv.includes('--ungraded') ? null : await loadLut();
  const only = process.argv.find((a) => a.startsWith('--kind='))?.slice(7);

  process.stdout.write(`  ${'patch'.padEnd(20)}${'kind'.padEnd(7)}${'target'.padEnd(9)}`
    + `${'radiance the surface must carry'.padStart(32)}${'err'.padStart(8)}\n`);
  for (const patch of PATCHES) {
    if (only && patch.kind !== only) continue;
    const wanted = meanRect(target, patch);
    const px = (patch.x0 + patch.x1) / 2;
    const py = (patch.y0 + patch.y1) / 2;
    const solved = solveRadiance(wanted, px, py, lut);
    process.stdout.write(`  ${patch.id.padEnd(20)}${patch.kind.padEnd(7)}`
      + `${hex(wanted).padEnd(9)}`
      + `${solved.radiance.map((v) => v.toFixed(4).padStart(10)).join('')}`
      + `${solved.error.toFixed(4).padStart(8)}\n`);
  }
}


if (process.argv[1] && process.argv[1].endsWith('probe.mjs')) await solveAll();
