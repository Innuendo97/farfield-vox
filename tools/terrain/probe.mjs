import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { EYE_HEIGHT, SPAWN } from '../../src/world/layout.js';
import { heightAt, worldToUv } from '../../src/world/terrain-field.js';
import { agx } from '../grade/lib/agx.mjs';
import { deltaE76, linearToSrgb, srgbToLab, srgbToLinear } from '../grade/lib/color.mjs';
import { makeRay, REPO_ROOT } from '../grade/lib/framing.mjs';
import { makeLensShading } from '../grade/lib/shading.mjs';
import { meanRect, readTarget } from '../grade/lib/target.mjs';
import { PATCHES } from './sample-target.mjs';
import SCENE_LIGHT from '../../assets-src/sky/scene-light.json' with { type: 'json' };

// Predicts what the ground will look like, without drawing it.
//
// Fitting the meadow through the browser costs a page load, a screenshot and a
// resize for every attempt, and the attempts run into the dozens: what the
// albedo and the weather have to be is a numerical question, and the answer is
// reachable offline. This walks the reference camera into the height field,
// finds the world position behind every measured pixel, samples the two ground
// textures there and pushes the result through the same arithmetic the frame
// uses, as far as the encoded pixel. The remaining difference against the
// reference is the error the eye will see.
//
// It is a model of the ground pass and of the composite, not of the renderer:
// it is checked against a real screenshot each round, and the check is reported
// so a drift between the two is never silent. Everything the frame does that
// this does not (bloom below its threshold, the dither, multisampling) moves a
// mean by well under one unit of error.

const DIR = join(REPO_ROOT, 'assets-src', 'terrain');
const ALBEDO = join(DIR, 'terrain-albedo.png');
const LIGHT = join(DIR, 'terrain-light.png');

// Mirrors of the runtime constants. They are read from the modules that own
// them wherever that is possible; this one lives inside shader source, so it is
// named here and asserted against the bake report below.
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

const EYE = { x: 0, y: EYE_HEIGHT, z: SPAWN.z };

async function readImage(path, { keepAlpha = false } = {}) {
  const pipeline = sharp(path);
  const { data, info } = await (keepAlpha ? pipeline : pipeline.removeAlpha()).raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data, channels: info.channels };
}

/**
 * Bilinear sample of the fourth channel, RAW.
 *
 * Raw and not through the transfer, because alpha carries none: what is stored
 * there is the square root of a linear term, and the caller squares it.
 */
function sampleAlpha(image, u, v) {
  const { width, height, data, channels } = image;
  if (channels < 4) return 0;
  const x = Math.min(width - 1.001, Math.max(0, u * width - 0.5));
  const y = Math.min(height - 1.001, Math.max(0, v * height - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const at = (a, b) => data[(b * width + a) * channels + 3] / 255;
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy)
    + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

/** Bilinear sample of an 8 bit sRGB map, returned as linear light. */
function sampleLinear(image, u, v, out) {
  const { width, height, data } = image;
  const x = Math.min(width - 1.001, Math.max(0, u * width - 0.5));
  const y = Math.min(height - 1.001, Math.max(0, v * height - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const n = image.channels || 3;
  for (let c = 0; c < 3; c++) {
    const a = data[(y0 * width + x0) * n + c];
    const b = data[(y0 * width + x1) * n + c];
    const d = data[(y1 * width + x0) * n + c];
    const e = data[(y1 * width + x1) * n + c];
    const mix = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
    out[c] = srgbToLinear(mix / 255);
  }
  return out;
}

/**
 * First hit of a ray on the height field.
 *
 * Marched rather than solved: the field is a sum of noise octaves and mounds
 * with no closed form, and the step is kept short near the eye where a metre of
 * ground covers many pixels.
 */
export function traceGround(direction, { maxDistance = 260 } = {}) {
  let t = 0.15;
  let previous = t;
  let below = false;
  while (t < maxDistance) {
    const x = EYE.x + direction[0] * t;
    const z = EYE.z + direction[2] * t;
    const y = EYE.y + direction[1] * t;
    if (y <= heightAt(x, z)) { below = true; break; }
    previous = t;
    t += Math.max(0.04, t * 0.025);
  }
  if (!below) return null;

  let lo = previous;
  let hi = t;
  for (let k = 0; k < 28; k++) {
    const mid = (lo + hi) / 2;
    const y = EYE.y + direction[1] * mid;
    if (y <= heightAt(EYE.x + direction[0] * mid, EYE.z + direction[2] * mid)) hi = mid;
    else lo = mid;
  }
  const distance = (lo + hi) / 2;
  return {
    x: EYE.x + direction[0] * distance,
    z: EYE.z + direction[2] * distance,
    y: EYE.y + direction[1] * distance,
    distance,
  };
}

/** The height fog of src/world/air.js, evaluated on the CPU. */
export function fogAmount(distance, fragmentHeight, fog) {
  const dy = fragmentHeight - EYE.y;
  const a = Math.exp(-Math.max(EYE.y, 0) / fog.height);
  const b = Math.exp(-Math.max(fragmentHeight, 0) / fog.height);
  const mean = Math.abs(dy) < 0.01 ? a : (a - b) * fog.height / dy;
  const depth = distance * fog.density * mean;
  return 1 - Math.exp(-depth * depth);
}

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

export function grade(lut, colour, out = [0, 0, 0]) {
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
export function composite(colour, px, py, lut, out = [0, 0, 0]) {
  agx([colour[0] * EXPOSURE, colour[1] * EXPOSURE, colour[2] * EXPOSURE], 1, out);
  // Same law and same arithmetic as before — linear in the squared screen
  // radius, twice the strength at the corner — with the strength read out of
  // src/ui/veil.js rather than written down again. See LENS above.
  const vignette = LENS.at(px, py);
  for (let c = 0; c < 3; c++) out[c] = linearToSrgb(Math.max(0, out[c] * vignette));
  return lut ? grade(lut, out, out) : out;
}

// Read out of the runtime sources rather than imported: both modules pull a
// JSON asset the bundler resolves and node does not, and duplicating the
// numbers here would let the model and the frame drift apart in silence.
function constant(file, pattern, what) {
  const source = readFileSync(join(REPO_ROOT, file), 'utf8');
  const found = pattern.exec(source);
  if (!found) throw new Error(`${what} not found in ${file}`);
  return found;
}

export async function loadGround() {
  for (const path of [ALBEDO, LIGHT]) {
    if (!existsSync(path)) throw new Error(`missing ${path}: run "npm run terrain" first`);
  }
  const terrain = JSON.parse(readFileSync(join(DIR, 'terrain.json'), 'utf8'));
  const fogColour = constant(
    'src/world/air.js',
    /FOG_RADIANCE = \[([-0-9.]+), ?([-0-9.]+), ?([-0-9.]+)\]/, 'FOG_RADIANCE',
  ).slice(1, 4).map(Number);
  const exposure = Number(constant(
    'src/world/air.js', /GROUND_EXPOSURE = ([0-9.]+)/, 'GROUND_EXPOSURE',
  )[1]);
  const density = Number(constant(
    'src/core/sky.js', /FOG_DENSITY = ([0-9.]+)/, 'FOG_DENSITY',
  )[1]);
  const scaleHeight = Number(constant(
    'src/core/sky.js', /scaleHeight: ([0-9.]+)/, 'scaleHeight',
  )[1]);

  // With --raw the two terms are read straight out of the bake instead of out
  // of the packed map, so a fit costs no re-encode. There is no weather field
  // to apply on the way any more: it was retired with
  // tools/terrain/shade-light.mjs.
  const raw = process.argv.includes('--raw');

  return {
    albedo: await readImage(ALBEDO),
    light: raw
      ? { sun: await readImage(join(DIR, 'terrain-light-sun-bake.png')),
        sky: await readImage(join(DIR, 'terrain-light-sky-bake.png')) }
      : { packed: await readImage(LIGHT, { keepAlpha: true }) },
    lut: process.argv.includes('--ungraded') ? null : await loadLut(),
    lightScale: terrain.lightScale * exposure,
    // The two colours the terms are weighed with, out of the seat the runtime
    // reads: a derived hue times a fitted magnitude each. Handed in rather than
    // fixed, because fitting a magnitude means moving one of them and asking
    // what the ground looks like then.
    sunLight: SCENE_LIGHT.day.sunBeam.map((v) => v * (SCENE_LIGHT.day.sunStrength ?? 0)),
    skyLight: SCENE_LIGHT.day.skyBalance.map((v) => v * (SCENE_LIGHT.day.skyStrength ?? 1)),
    fogColour,
    fog: { density, height: scaleHeight },
  };
}

/** The two terms at a point of the ground, sun first, whichever road they came by. */
function termsAt(ground, u, v, out) {
  if (ground.light.packed) {
    // The packed map is the sun as GREY in rgb and the sky in ALPHA as the
    // square root of its linear value — see tools/lighting/pack-light.mjs for
    // the measurement that put it there. So the sky term is read out of the
    // fourth channel and squared, not out of the green.
    const packed = sampleLinear(ground.light.packed, u, v, [0, 0, 0]);
    out[0] = packed[0];
    out[1] = sampleAlpha(ground.light.packed, u, v) ** 2;
  } else {
    out[0] = sampleLinear(ground.light.sun, u, v, [0, 0, 0])[0];
    out[1] = sampleLinear(ground.light.sky, u, v, [0, 0, 0])[0];
  }
  return out;
}

/** Encoded colour the ground pass will put at one pixel of the framing. */
export function shadeGround(ground, ray, px, py) {
  const hit = traceGround(ray(px, py));
  if (!hit) return null;
  const { u, v } = worldToUv(hit.x, hit.z);
  const albedo = sampleLinear(ground.albedo, u, v, [0, 0, 0]);
  const terms = termsAt(ground, u, v, [0, 0]);
  const f = fogAmount(hit.distance, hit.y, ground.fog);
  const colour = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const light = terms[0] * ground.sunLight[c] + terms[1] * ground.skyLight[c];
    const lit = albedo[c] * light * ground.lightScale;
    colour[c] = lit * (1 - f) + ground.fogColour[c] * f;
  }
  // The albedo and the fog travel with the answer, so a fit that moves the two
  // light colours can reuse the ray march instead of paying for it again.
  return { hit, terms, albedo, fog: f, colour, srgb: composite(colour, px, py, ground.lut) };
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

const STEP = 4;

/** Mean predicted colour and mean world position over one measured rectangle. */
export function predictPatch(ground, ray, patch) {
  let r = 0, g = 0, b = 0, n = 0, sx = 0, sz = 0, sd = 0;
  const light = [0, 0, 0];
  const terms = [0, 0];
  for (let py = patch.y0; py < patch.y1; py += STEP) {
    for (let px = patch.x0; px < patch.x1; px += STEP) {
      const shaded = shadeGround(ground, ray, px, py);
      if (!shaded) continue;
      r += shaded.srgb[0]; g += shaded.srgb[1]; b += shaded.srgb[2];
      for (let c = 0; c < 3; c++) light[c] += shaded.colour[c];
      terms[0] += shaded.terms[0]; terms[1] += shaded.terms[1];
      sx += shaded.hit.x; sz += shaded.hit.z; sd += shaded.hit.distance;
      n++;
    }
  }
  if (n === 0) return null;
  return {
    srgb: [r / n, g / n, b / n],
    radiance: light.map((v) => v / n),
    terms: terms.map((v) => v / n),
    x: sx / n,
    z: sz / n,
    distance: sd / n,
    coverage: n,
  };
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

async function main() {
  const ground = await loadGround();
  const target = await readTarget();
  const ray = makeRay();
  const only = process.argv.find((a) => a.startsWith('--kind='))?.slice(7);

  process.stdout.write(`  ${'patch'.padEnd(20)}${'kind'.padEnd(7)}`
    + `${'x'.padStart(8)}${'z'.padStart(8)}${'dist'.padStart(7)}  `
    + `${'predicted'.padEnd(10)}${'target'.padEnd(10)}${'dE76'.padStart(7)}`
    + `${'gain r'.padStart(8)}${'g'.padStart(7)}${'b'.padStart(7)}\n`);

  const rows = [];
  for (const patch of PATCHES) {
    if (only && patch.kind !== only) continue;
    const predicted = predictPatch(ground, ray, patch);
    const measured = meanRect(target, patch);
    if (!predicted) {
      process.stdout.write(`  ${patch.id.padEnd(20)}${patch.kind.padEnd(7)}`
        + `${'sky'.padStart(31)}\n`);
      continue;
    }
    const e = deltaE76(srgbToLab(predicted.srgb), srgbToLab(measured));
    rows.push({ kind: patch.kind, e });
    // How far the surface is from where it has to be, as a ratio on the light.
    // A colour difference says the patch is wrong; this says by how much and in
    // which direction to move the weather or the paint, which is the number a
    // fitting round is actually steered by.
    const wanted = solveRadiance(measured, (patch.x0 + patch.x1) / 2,
      (patch.y0 + patch.y1) / 2, ground.lut);
    const gain = wanted.radiance.map((v, c) => v / Math.max(1e-6, predicted.radiance[c]));
    process.stdout.write(`  ${patch.id.padEnd(20)}${patch.kind.padEnd(7)}`
      + `${predicted.x.toFixed(1).padStart(8)}${predicted.z.toFixed(1).padStart(8)}`
      + `${predicted.distance.toFixed(1).padStart(7)}  `
      + `${hex(predicted.srgb).padEnd(10)}${hex(measured).padEnd(10)}${e.toFixed(2).padStart(7)}`
      + `${gain.map((v) => v.toFixed(2).padStart(7)).join('')}\n`);
  }

  const byKind = new Map();
  for (const row of rows) {
    if (!byKind.has(row.kind)) byKind.set(row.kind, []);
    byKind.get(row.kind).push(row.e);
  }
  process.stdout.write('\n');
  for (const [kind, values] of byKind) {
    const mean = values.reduce((t, v) => t + v, 0) / values.length;
    process.stdout.write(`  mean ${kind.padEnd(12)}${mean.toFixed(2).padStart(7)} dE76\n`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('probe.mjs')) {
  if (process.argv.includes('--solve')) await solveAll();
  else await main();
}
