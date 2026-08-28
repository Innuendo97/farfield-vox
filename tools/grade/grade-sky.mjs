import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAME, POSE, REPO_ROOT } from './lib/framing.mjs';
import { encodeCleanPng } from './lib/png.mjs';
import { agx } from './lib/agx.mjs';
import { agxInverse } from './lib/agx-inverse.mjs';
import { linearToSrgb, srgbToLab, srgbToLinear } from './lib/color.mjs';
import {
  buildSkyMask, buildStoneMask, fitStoneToReference, readSkyReference,
} from './lib/target.mjs';
import {
  BELOW_HORIZON_SCALE, HORIZON_AIR_MASS, HORIZON_AIR_MASS_SLOPE,
  clearSkyAt, dayPreset, describeFit, domeAt, fitClearSky, readSkySamples, solarAzimuth, sunVector,
} from './lib/sky-model.mjs';
import { separateCloud } from './lib/cloud-field.mjs';
import {
  ARRIVAL_SHADING, REFERENCE_SHADING_CORNER, makeLensShading, referenceShading, screenRadius,
} from './lib/shading.mjs';

// Bakes the clear sky the world is seen against.
//
// The dome carries weather no longer. What the reference shows in front of its
// sky is cloud at a distance of kilometres, and a picture of it wrapped onto a
// sphere a metre from the eye is a picture that turns with the walker instead of
// standing still behind him; it is drawn as its own bodies elsewhere. What is
// left here is the one thing an equirect is honestly good for: the sky itself,
// which really is at infinity and really does look the same from every standing
// place in a forty metre hub.
//
// So this bake produces the sky behind the weather. Inside the reference framing
// that sky is measurement — the texels the reference shows between its clouds,
// carried over as they stand. Where a cloud was, and everywhere outside the
// framing, it is the fitted clear sky: the same air, the same sun, continued by
// a model that cannot invent a hue.
//
// Two things the reference carries are deliberately not carried with it. Its
// cloud, for the reason above. And its vignette: the darkening towards the
// corners of the frame is a property of the picture and not of the sky, it
// belongs to one standing place and one bearing, and baked into a dome it
// becomes a dark patch of sky that follows the eye. It is measured here, divided
// out, and put back at the front of the frame by the interface, which is where a
// lens effect lives.
//
// The whole bake works in scene radiance. The reference is display referred, so
// the tone curve is undone once on the way in and applied once on the way out.
// Precision is single float throughout and the only quantisation is the last
// step, where the texture is written as eight bit — flat, with no dither. The
// dither belongs in src/core/sky.js: a dithered gradient costs a block codec an
// order of magnitude in rate to store noise the shader can make for nothing.

const OUT_IMAGE_DIR = join(REPO_ROOT, 'assets-src', 'sky');
const OUT_PARAMS = join(OUT_IMAGE_DIR, 'sky.json');

// Radiance normalisation of the stored texture, unchanged: the renderer
// multiplies by this and applies the same AgX curve, so it is part of the
// agreement with src/core/sky.js and not a free number.
const SKY_INTENSITY = 8;

const DEG = Math.PI / 180;

// Window of the sphere the photographed sector lives in. Wider than the framing
// on every side, because what is measured inside it is carried a little way out.
const WINDOW_AZIMUTH = 70;
const WINDOW_ELEVATION_TOP = 50;
const WINDOW_ELEVATION_BOTTOM = -12;

// How far inside the framing the measurement comes up to full strength, in
// degrees, and it reaches no further than the framing at all.
//
// The photograph is one standing place looking one way. Everything it has to say
// about the sky it says inside its own frame, and every degree that reading is
// carried past that frame is a degree of the picture's own troubles — its grey,
// its corner, its shading — hung on the sphere at a bearing, where a walker who
// turns his head finds it standing in sky nobody photographed. Carried far it is
// a stain; carried a little it is a stain with a sharper edge. It was carried a
// little, and the client found it: a dark shape reaching up the left of his
// frame, which is this window's own upper left corner and nothing else.
//
// So the reach is inwards now. Outside the framing the sky is the model, with no
// exception and no fade; inside it the measurement comes up over this many
// degrees from the border. What that costs is a band round the edge of the
// reference pose where the correction is not at full strength, and it is
// affordable for one reason: with the shading fully divided out the correction
// is small everywhere and slow everywhere, so what the band gives up is under a
// level of colour rather than the fifty the corner used to carry.
const CARRY_HANDOVER = 12;

// Below the horizon the sky loses its bearing, over this many degrees.
//
// Nothing down there is sky the walker looks at — the ground is in the way —
// but it is what the water has to reflect, and left alone it was a row of pale
// vertical columns running to the bottom of the texture. They are the horizon's
// own azimuthal profile, extruded downwards with nothing to vary it: whatever
// the sky does along the horizon it went on doing, at full contrast, for ninety
// degrees. So the bearing is smoothed away as the sky goes under: at the
// horizon the profile is untouched, and a dozen degrees below it there is one
// haze in every direction. The blur starts at nothing and grows smoothly from
// nothing, so the horizon itself keeps its slope.
const BELOW_HORIZON_UNIFORM = -24;
const BELOW_HORIZON_SIGMA = 55;

// How much of each pole is held to a single colour, in degrees.
//
// An equirect gives a pole a whole row, and every texel of that row stands for
// the same point of the sky, so writing them all the same is not a
// simplification of the picture: it is the projection. Wide enough to swallow
// the rows the encoder damages at the size the sky ships in, and to sit entirely
// inside the latitude src/core/sky.js stops sampling at, so nothing in this band
// is ever drawn. Narrow enough to be nothing either way: below the zenith this
// bake moves two hundredths of a unit of colour over the first degree and a
// half.
const POLE_CAP_DEG = 1.4;

const size = (() => {
  const arg = process.argv.find((a) => a.startsWith('--size='));
  const width = arg ? Number(arg.slice(7)) : 4096;
  if (!Number.isInteger(width) || width % 4 !== 0) throw new Error('--size must be a multiple of four');
  return { width, height: width / 2 };
})();

// ---------------------------------------------------------------------------
// THE SEAL, AND WHY THIS BAKE IS NOT ALLOWED TO BREAK IT BY ITSELF.
//
// assets-src/sky/sky.json is the dome the committente walked through and
// approved in S1. It is a tracked file, and its content IS the seal: there is no
// hash written down anywhere, no snapshot beside it, nothing else that remembers
// what was approved. Whatever is in that file is what S1 means.
//
// And this bake rewrites it. The fit that produced the sealed numbers on
// 2026-08-16 came down a road this generator no longer walks — it was refitted
// on the target's blues by hand — so the sky this file computes today is a
// DIFFERENT sky, and it overwrites the approved one with no diff, no prompt and
// a green exit. Measured at the time (s2-dev2, PASSO 0): horizon #90b0cb becomes
// #9fbbc5, zenith #174c7d becomes #153e59, ambient 0 becomes 1.1, tauRayleigh
// and exposure move on every channel. Five verbali across this session have
// carried the same sentence as an open residual — «npm run sky:bake disfa il
// sigillo di S1 in silenzio» — and it stayed open because the failure is silent:
// the only person who finds out is whoever notices the sky changed colour.
//
// It is also an instruction someone will follow. s2-dev1 says, in good faith and
// on the old premise, that sky-equirect.png is stale and «prima della ricottura
// va rigenerato (npm run sky:bake)». That premise is wrong — the PNG regenerates
// byte for byte identical, it was never stale — but the sentence is written down
// and the command is one line.
//
// So the write is gated on its own output. This bake computes everything, then
// compares what it is about to write against what is on disk, and if a single
// byte would move it refuses, prints exactly which fields would move and stops
// having written nothing. Note what is NOT being claimed: this does not say the
// sealed sky is right and the computed one is wrong. It says the two disagree,
// that the disagreement is a decision belonging to whoever owns the seal, and
// that a decision is not something a build step gets to take in passing.
//
// --unseal is the way to take it deliberately. It writes, and it says so.
const UNSEAL = process.argv.includes('--unseal');

/** Every leaf of a nested object, as `a.b.c` → value. */
function leaves(value, prefix = '', out = new Map()) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      leaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.set(prefix, JSON.stringify(value));
  }
  return out;
}

/** What would move, between the sealed JSON on disk and the one about to be written. */
function jsonDrift(path, text) {
  let sealed;
  try {
    sealed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null; // Nothing on disk, or nothing readable: there is no seal to break.
  }
  const was = leaves(sealed);
  const now = leaves(JSON.parse(text));
  const moved = [];
  for (const [key, value] of now) {
    const before = was.get(key);
    if (before === undefined) moved.push(`    + ${key} = ${value}   (new field)`);
    else if (before !== value) moved.push(`    ~ ${key}: ${before}  ->  ${value}`);
  }
  for (const key of was.keys()) if (!now.has(key)) moved.push(`    - ${key}   (would be dropped)`);
  return moved;
}

/**
 * Refuses to put a set of files on disk if any of them would come out different.
 *
 * All of them or none of them: the PNG and the JSON are one delivery, and a run
 * that wrote the picture and then baulked at the numbers would leave the two
 * describing different skies, which is worse than either outcome.
 *
 * @param {{path: string, bytes: Buffer|string, drift: string[]|null}[]} files
 */
function writeUnderSeal(files) {
  const changed = files.filter((f) => f.drift === null ? false : f.drift.length > 0);
  const fresh = files.filter((f) => f.drift === null);

  if (changed.length && !UNSEAL) {
    const lines = ['', 'REFUSED: this would not reproduce the sealed sky.', ''];
    for (const f of changed) {
      lines.push(`  ${f.path}`);
      lines.push(...f.drift.slice(0, 24));
      if (f.drift.length > 24) lines.push(`    ... and ${f.drift.length - 24} more`);
      lines.push('');
    }
    lines.push('assets-src/sky/sky.json is the dome the committente approved in S1, and the');
    lines.push('file itself is the only record of that approval. Overwriting it loses S1, and');
    lines.push('nothing downstream would go red: the palette above is printed by sky:check but');
    lines.push('never compared against anything.');
    lines.push('');
    lines.push('Nothing has been written. If you mean to move the seal, say so:');
    lines.push('');
    lines.push('    npm run sky:bake -- --unseal');
    lines.push('');
    lines.push('and commit the result on its own, so the walk that approves the new sky has a');
    lines.push('single change to look at.');
    lines.push('');
    process.stdout.write(`${lines.join('\n')}\n`);
    process.exitCode = 1;
    return false;
  }

  mkdirSync(OUT_IMAGE_DIR, { recursive: true });
  for (const f of files) writeFileSync(f.path, f.bytes);

  if (changed.length) {
    log('');
    log('--unseal: THE SEAL HAS BEEN MOVED. What changed:');
    for (const f of changed) {
      log(`  ${f.path}`);
      for (const line of f.drift.slice(0, 24)) log(line);
      if (f.drift.length > 24) log(`    ... and ${f.drift.length - 24} more`);
    }
    log('');
    log('The sky the committente walked through in S1 is no longer the sky in this');
    log('repository. Nothing else will tell anyone: put this in a commit of its own and');
    log('get the new one walked.');
    log('');
  } else if (fresh.length) {
    for (const f of fresh) log(`${f.path} was not on disk; written, and it is the seal now`);
  } else {
    log('the sealed sky reproduces byte for byte; nothing moved');
  }
  return true;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const elevationOfRow = (row, height) => (0.5 - (row + 0.5) / height) * 180;
const rowOfElevation = (elevation, height) => (0.5 - elevation / 180) * height - 0.5;
const azimuthOfColumn = (col, width) => {
  // North sits at u = 0.25 by the equirect convention in framing.mjs.
  let a = ((col + 0.5) / width - 0.25) * 360;
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
};
const columnOfAzimuth = (azimuth, width) => ((azimuth / 360 + 0.25) * width) - 0.5;

/**
 * What is left of a radial darkening once a candidate has been divided out.
 *
 * Not the source of the number above — that question has no single answer, which
 * is why the number is a decision — but the way to see how much of one the fit
 * has since put back as sky. Quadratic in the radius and in the log of the
 * brightness, which is two numbers, because two is what a lens does and anything
 * richer starts describing the sky instead.
 *
 * @returns {{corner: number, coefficients: number[], bins: number}}
 */
function readRadialLeftover(bins, params, sun, project) {
  const model = { ...params, residual: null };
  const rgb = [0, 0, 0];
  const luma = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  // Weighted normal equations over the basis [1, q, q^2].
  const A = new Float64Array(9);
  const b = new Float64Array(3);
  let used = 0;
  for (const bin of bins) {
    const p = project(sunVector(bin.elevation, bin.azimuth));
    if (!p) continue;
    const [px, py] = p;
    if (px < 0 || py < 0 || px >= FRAME.width || py >= FRAME.height) continue;
    clearSkyAt(model, sun, bin.elevation, bin.azimuth, rgb);
    const have = luma(bin.radiance);
    const want = luma(rgb);
    if (have <= 1e-6 || want <= 1e-6) continue;
    const q = screenRadius(px, py);
    const basis = [1, q, q * q];
    const y = Math.log(have / want);
    const w = bin.count;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) A[i * 3 + j] += w * basis[i] * basis[j];
      b[i] += w * basis[i] * y;
    }
    used++;
  }
  if (used < 24) throw new Error(`only ${used} bins inside the framing to read the shading from`);
  // Gaussian elimination on three unknowns, with a ridge so a frame that never
  // reaches its own corners cannot make the system singular.
  for (let i = 0; i < 3; i++) A[i * 3 + i] *= 1.000001;
  const x = new Float64Array(3);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(A[row * 3 + col]) > Math.abs(A[pivot * 3 + col])) pivot = row;
    }
    for (let k = 0; k < 3; k++) {
      const t = A[col * 3 + k]; A[col * 3 + k] = A[pivot * 3 + k]; A[pivot * 3 + k] = t;
    }
    const t = b[col]; b[col] = b[pivot]; b[pivot] = t;
    for (let row = col + 1; row < 3; row++) {
      const f = A[row * 3 + col] / A[col * 3 + col];
      for (let k = col; k < 3; k++) A[row * 3 + k] -= f * A[col * 3 + k];
      b[row] -= f * b[col];
    }
  }
  for (let i = 2; i >= 0; i--) {
    let sum = b[i];
    for (let k = i + 1; k < 3; k++) sum -= A[i * 3 + k] * x[k];
    x[i] = sum / A[i * 3 + i];
  }
  // Only the shape matters: the constant is exposure, which the fit owns.
  return {
    coefficients: [x[1], x[2]],
    corner: Math.exp(x[1] + x[2]),
    bins: used,
  };
}

/** World direction to a pixel of the reference framing; null when behind it. */
function makeProjector() {
  const aspect = FRAME.width / FRAME.height;
  const tanV = Math.tan(POSE.fov * DEG / 2);
  const tanH = tanV * aspect;
  const cp = Math.cos(POSE.pitch * DEG);
  const sp = Math.sin(POSE.pitch * DEG);
  const cy = Math.cos(POSE.yaw * DEG);
  const sy = Math.sin(POSE.yaw * DEG);
  return function project(d) {
    const x = d[0] * cy - d[2] * sy;
    const z1 = d[0] * sy + d[2] * cy;
    const y = d[1] * cp + z1 * sp;
    const z = -d[1] * sp + z1 * cp;
    if (z >= -1e-6) return null;
    const t = -1 / z;
    return [
      ((x * t) / tanH + 1) * 0.5 * FRAME.width - 0.5,
      (1 - (y * t) / tanV) * 0.5 * FRAME.height - 0.5,
    ];
  };
}

/** A mask grown by a few pixels, chebyshev, in place of nothing subtler. */
function dilate(mask, width, height, radius) {
  const out = new Uint8Array(width * height);
  const rows = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = 0;
      for (let k = -radius; k <= radius && !hit; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        if (mask[y * width + xx]) hit = 1;
      }
      rows[y * width + x] = hit;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = 0;
      for (let k = -radius; k <= radius && !hit; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        if (rows[yy * width + x]) hit = 1;
      }
      out[y * width + x] = hit;
    }
  }
  return out;
}

/**
 * Normalised blur of a field that only exists in some places, so it can be
 * asked what it would be doing in the places it does not exist.
 *
 * Three box passes for a Gaussian, value and weight carried through both and
 * divided at the end.
 *
 * The two radii are given separately, and they are a long way apart, because
 * this is asked to bridge a gap sideways while respecting what the sky does
 * upwards. A monolith takes eleven degrees of bearing out of the sky and the
 * sky barely changes across them; over eleven degrees of height it changes by
 * half. A kernel round enough to reach across the stone is a kernel that has
 * averaged the vertical ramp into its own answer, and what it hands back is
 * the sky four degrees higher and four degrees lower, which is neither.
 */
function spreadField({
  value, weight, width, height, channels, radiusAzDeg, radiusElDeg, degPerTexel,
}) {
  const count = width * height;
  const v = new Float32Array(count * channels);
  const w = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    w[i] = weight[i];
    for (let c = 0; c < channels; c++) v[i * channels + c] = value[i * channels + c] * weight[i];
  }
  const line = new Float32Array(Math.max(width, height));
  const box = (buf, n, stride, base, radius) => {
    for (let k = 0; k < n; k++) line[k] = buf[base + k * stride];
    let sum = 0;
    for (let k = 0; k <= Math.min(n - 1, radius); k++) sum += line[k];
    for (let k = 0; k < n; k++) {
      buf[base + k * stride] = sum / (Math.min(n - 1, k + radius) - Math.max(0, k - radius) + 1);
      const enter = k + radius + 1;
      const leave = k - radius;
      if (enter < n) sum += line[enter];
      if (leave >= 0) sum -= line[leave];
    }
  };
  const radiusY = Math.max(1, Math.round(radiusElDeg / degPerTexel));
  const radiusX = Math.max(1, Math.round(radiusAzDeg / degPerTexel));
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < height; y++) {
      for (let c = 0; c < channels; c++) box(v, width, channels, y * width * channels + c, radiusX);
      box(w, width, 1, y * width, radiusX);
    }
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) box(v, height, width * channels, x * channels + c, radiusY);
      box(w, height, width, x, radiusY);
    }
  }
  const out = new Float32Array(count * channels);
  for (let i = 0; i < count; i++) {
    if (w[i] <= 1e-7) continue;
    for (let c = 0; c < channels; c++) out[i * channels + c] = v[i * channels + c] / w[i];
  }
  // The weight is handed back with the value, because how much of a
  // neighbourhood was known is what decides whether its answer is worth having.
  return { value: out, weight: w };
}

// The scale the measured sky is carried at, and how much of a neighbourhood has
// to be known before it is believed.
//
// One scale, and a broad one. This used to be four, refining down to a degree
// and a half wherever there was enough clear sky under the finer kernel, and
// what that bought was the photograph's fine structure: its veils, its grain,
// the local dimming beside every cloud it was cut around. All of it is weather
// or the picture's own, none of it is the sky behind the weather, and on a dome
// it stands still at a bearing while the weather that explains it drifts away
// from it. The fine veils this sky needs are drawn by the sprites, which move.
//
// So the carry is held above the scale at which the eye reads a shape in an open
// sky. Twenty six degrees of bearing and twelve of height is broad enough that
// nothing shorter than a dozen degrees survives it — the figure the whole of
// this unit turns on — and narrow enough to still follow the one thing the model
// cannot say for itself, which is that this sky is not the same to the left of
// its sun as to the right.
const CARRY_SCALES = [[26, 12]];
const CARRY_CONFIDENCE = 0.05;

// And the scale the HUE of the same measurement is carried at, which is not the
// same number.
//
// The level and the hue of a clear sky are not equally smooth in bearing, and
// the carry above is set by the level. Across twenty six degrees the sky's
// brightness really is one slow ramp, so a kernel that wide costs the level
// nothing; its hue is not, because the aerosol lobe whitens the sky towards its
// sun and gives it back its blue either side, and at the height of the top of
// the reference framing that turn happens inside the frame. Averaged over the
// kernel the level wants, the two sides of the turn cancel: the dome comes out
// one hue for the whole sector, too blue where the reference whitens and not
// blue enough where it deepens. Measured at the reference pose that is eight
// levels of blue too many at the upper left of the frame and six too few above
// its middle, from a dome whose LIGHTNESS is right to a level and a half.
//
// Nothing about it is fine structure. Sixteen degrees of bearing is still wider
// than the twelve the level is already carried at up the sky, so the correction
// gains no scale the dome did not already have — what it gains is the one
// gradient the reference has and the model's own bearing surface, symmetric
// about the sun by construction, cannot say: that this sky is not the same hue
// to the left of its sun as to the right.
const TINT_SCALE = [16, 12];

// How far inside the framing the hue comes up to full strength, which is also
// not the level's number.
//
// The rule outside is the level's rule exactly, and it is not negotiable:
// nothing, at any strength, past the border. Six degrees of reach outwards was
// tried, and it works on the sky and breaks the weather. The tiles are cut as
// what the photograph still owes the frame once the dome is under them, and past
// the border there is no photograph to owe it to — so a dome that has moved out
// there hands the cut a shortfall it cannot check, the colour asked for goes
// negative, and a premultiplied sprite with no colour and some coverage is a
// hole. It drew one: a soft dark patch four degrees by three, twenty levels
// deep, in the open sky beside the eastern bank, on the walker's own pose. Which
// is the client's rectangle again, arriving from the one direction left.
//
// Inside, the ramp is short where the level's is long, and for a reason the
// level does not have. The band the level gives up is a band the interface's own
// shading covers, because a level is all that shading is; there is nothing
// anywhere downstream that carries a hue. So the twelve degree ramp leaves the
// top of the reference framing — which is where the fault was — with no
// correction at all, and the fault is exactly as wide as the ramp. Two degrees
// puts it back and costs nothing visible: what climbs over those two degrees is
// under four levels of colour, which is a shallower gradient than the reference
// itself carries anywhere along that border.
const TINT_HANDOVER = 2;

/** The sparse field above, made whole, coarse answers refined by finer ones. */
function fillByScales({
  value, weight, width, height, channels, degPerTexel, scales = CARRY_SCALES,
}) {
  let filled = null;
  for (const [radiusAzDeg, radiusElDeg] of scales) {
    const level = spreadField({
      value, weight, width, height, channels, radiusAzDeg, radiusElDeg, degPerTexel,
    });
    if (!filled) { filled = level.value; continue; }
    for (let i = 0; i < width * height; i++) {
      const trust = Math.min(1, level.weight[i] / CARRY_CONFIDENCE);
      if (trust <= 0) continue;
      for (let c = 0; c < channels; c++) {
        const o = i * channels + c;
        filled[o] += (level.value[o] - filled[o]) * trust;
      }
    }
  }
  return filled;
}

// ------------------------------------------------ the sky has no blotches in it
//
// Every gate this sky has been through looked for STEPS: seams, bands, ruled
// edges, the second difference of a gradient. It passed all of them and the
// client rejected it anyway, in these words — the gradient is not uniform, there
// are darker, nearly grey zones — because what he was looking at was not a step.
// It was a blotch: a smooth, closed, low frequency hump of dimness with sky all
// round it, which every step detector reads as flat.
//
// So this is the detector that was missing. At a fixed height a clear sky has
// exactly one hump and one trough round the compass: brightest towards its sun,
// deepest away from it. Anything else that closes on itself is something the sky
// is not made of, and the size of it is what a walker turning his head sees.

// How the profile is read: one band every few degrees of height, up to where the
// sky is one colour anyway, sampled half a degree apart round the compass —
// which is far finer than the smoothing that follows, and a great deal cheaper
// than reading every texel of a four thousand column picture — and smoothed
// until only what the eye integrates over an open sky is left.
const UNIFORM_BAND_STEP = 4;
const UNIFORM_BAND_TOP = 80;
const UNIFORM_SAMPLES = 720;
const UNIFORM_SMOOTH_DEG = 14;

// How deep a closed departure from the model the dome may carry, in CIE Lab
// units, in lightness and in either axis of tint.
//
// The statistic is taken on the DIFFERENCE between the dome and the model it is
// made of, band by band and bearing by bearing, because that is what subtracts
// the pure model's own behaviour exactly rather than approximately: whatever
// shape the fitted bearing surface has, it stands in both profiles and cancels,
// and what is left to close a hump is what this bake put there. The pure model
// measured against itself gives nothing at all, so the whole of this figure is
// margin, and it has to cover three things: the eight bit floor the picture is
// written at, the smoothing of the sky as it goes under the horizon, and the one
// legitimate closed shape in this dome — the photographed sector's own
// correction, which stands over seventy odd degrees of bearing and has sky
// either side of it.
//
// Set from both ends, and both ends were measured with this reading. The dome
// this unit replaced closes 28.1 units of lightness and 27.5 of tint, at az -49
// and el 16 — a dark closed mass west of the framing and half way up the sky,
// which is the shape the client walked into and reported. The sector correction
// of this bake closes 3.2, at the horizon, and under 1.4 by twenty degrees up.
// Four sits between them with a factor of seven above and a fifth below, and it
// is the round number in that gap rather than a figure fitted to either.
const UNIFORM_LIMIT = 4;

/** Circular box blur of a profile, three passes for a gaussian. */
function smoothProfile(profile, radius) {
  let cur = Float64Array.from(profile);
  const n = cur.length;
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float64Array(n);
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += cur[((k % n) + n) % n];
    for (let i = 0; i < n; i++) {
      next[i] = sum / (2 * radius + 1);
      sum += cur[((i + radius + 1) % n) % n] - cur[(((i - radius) % n) + n) % n];
    }
    cur = next;
  }
  return cur;
}

/**
 * The deepest closed extremum of a circular profile, and how deep it is.
 *
 * Prominence rather than height: how far the extremum stands from the higher of
 * the two saddles that enclose it, which is the one measure that does not count
 * a hump for being on a slope.
 *
 * Nothing is excused here — not the sun's own hump, not the trough opposite it,
 * not the aureole — and nothing needs to be, because this is only ever read on
 * the difference between the dome and the model. Whatever the sky is entitled to
 * stands in both and has already cancelled; what is left closing a hump is not
 * entitled to anything.
 *
 * @returns {{prominence: number, at: number, kind: string}}
 */
function worstBlotch(profile) {
  const n = profile.length;
  const found = [];
  for (let i = 0; i < n; i++) {
    const before = profile[(i - 1 + n) % n];
    const here = profile[i];
    const after = profile[(i + 1) % n];
    const isMax = here > before && here >= after;
    const isMin = here < before && here <= after;
    if (!isMax && !isMin) continue;
    // Out to the first point that beats this one, both ways; the extreme
    // reached on the way there is that side's saddle, and the one nearer to
    // this extremum is the one the prominence is measured from.
    const saddles = [-1, 1].map((step) => {
      let bound = here;
      for (let k = 1; k < n; k++) {
        const v = profile[(((i + step * k) % n) + n) % n];
        if (isMax ? v > here : v < here) break;
        bound = isMax ? Math.min(bound, v) : Math.max(bound, v);
      }
      return bound;
    });
    const saddle = isMax ? Math.max(...saddles) : Math.min(...saddles);
    found.push({ at: i, kind: isMax ? 'max' : 'min', prominence: Math.abs(here - saddle) });
  }
  found.sort((a, b) => b.prominence - a.prominence);
  return found[0] || { prominence: 0, at: 0, kind: '-' };
}

/**
 * The "the clear sky has no blotches in it" invariant.
 *
 * The delivered picture and the model it is made of are read the same way, band
 * by band, and the dome may not close a hump the model does not. What comes back
 * is one line per channel for the log and a complaint per band that fails.
 *
 * @returns {{complaints: string[], report: string[]}}
 */
function checkUniformity(out, width, height, clearAt) {
  const channels = ['lightness', 'tint a', 'tint b'];
  const worst = channels.map(() => ({ depth: 0, line: 'none' }));
  const complaints = [];
  const rows = [];
  const azimuthOf = (k) => {
    let a = (k / UNIFORM_SAMPLES) * 360 - 180;
    while (a > 180) a -= 360;
    while (a < -180) a += 360;
    return a;
  };
  const radius = Math.max(1, Math.round(UNIFORM_SMOOTH_DEG / (360 / UNIFORM_SAMPLES)));
  const rgb = [0, 0, 0];
  const lift = [0, 0, 0];

  for (let elevation = 0; elevation <= UNIFORM_BAND_TOP; elevation += UNIFORM_BAND_STEP) {
    const row = Math.round(rowOfElevation(elevation, height));
    if (row < 0 || row >= height) continue;
    const baked = channels.map(() => new Float64Array(UNIFORM_SAMPLES));
    const model = channels.map(() => new Float64Array(UNIFORM_SAMPLES));
    for (let k = 0; k < UNIFORM_SAMPLES; k++) {
      const azimuthDeg = azimuthOf(k);
      // The bearing is a circle and the picture is cut open at due west, so the
      // column wraps. Clamped instead of wrapped it folds the whole western half
      // of the sky onto one column, which reads as a flat sky against a model
      // that is not flat — a blotch of the detector's own making.
      const col = ((Math.round(columnOfAzimuth(azimuthDeg, width)) % width) + width) % width;
      const o = (row * width + col) * 3;
      // Back to the light the dome hands the frame, and then through the same
      // curve the frame is shown with: a difference the eye never sees is not a
      // difference this is interested in.
      for (let c = 0; c < 3; c++) lift[c] = srgbToLinear(out[o + c] / 255) * SKY_INTENSITY;
      const here = srgbToLab(agx(lift, 1));
      clearAt(elevation, azimuthDeg, rgb);
      const ideal = srgbToLab(agx(rgb, 1));
      for (let c = 0; c < 3; c++) { baked[c][k] = here[c]; model[c][k] = ideal[c]; }
    }
    const cells = [];
    for (let c = 0; c < 3; c++) {
      const here = smoothProfile(baked[c], radius);
      const ideal = smoothProfile(model[c], radius);
      const found = worstBlotch(Float64Array.from(here, (v, k) => v - ideal[k]));
      cells.push(found.prominence.toFixed(2).padStart(6));
      if (found.prominence > worst[c].depth) {
        worst[c] = {
          depth: found.prominence,
          line: `${found.kind} at az ${azimuthOf(found.at).toFixed(0)} el ${elevation}`,
        };
      }
    }
    rows.push(`  el ${String(elevation).padStart(3)}  ${cells.join('  ')}`);
  }

  const report = [`  band  ${channels.map((n) => n.padStart(7)).join(' ')}`, ...rows,
    ...channels.map((name, c) => `  worst ${name.padEnd(9)} ${worst[c].depth.toFixed(2)} of `
      + `${UNIFORM_LIMIT} allowed (${worst[c].line})`)];
  for (let c = 0; c < 3; c++) {
    if (worst[c].depth <= UNIFORM_LIMIT) continue;
    complaints.push(`the clear sky closes a ${worst[c].depth.toFixed(2)} unit blotch of `
      + `${channels[c]} that the model has no part in (${worst[c].line}), `
      + `against ${UNIFORM_LIMIT} allowed`);
  }
  return { complaints, report };
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

const hex = (rgb) => agx(rgb, 1).map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255)).join(',');

async function main() {
  const { width, height } = size;
  const started = Date.now();
  const reference = await readSkyReference();
  const mask = await buildSkyMask();
  const stone = await buildStoneMask();
  const refitted = fitStoneToReference(stone, reference);
  // Whatever the silhouette gained is not sky, whatever the sky mask believed.
  for (let i = 0; i < mask.length; i++) if (stone[i]) mask[i] = 0;
  log(`silhouettes fitted to the reference on ${refitted.length} edges: ${refitted.join(' ') || 'none'}`);
  // One pixel, which is exactly what a bilinear tap can reach across. Two was
  // tried and takes more measured sky than it buys back.
  const nearStone = dilate(stone, FRAME.width, FRAME.height, 1);
  const project = makeProjector();

  // ------------------------------------------------------------------ sun
  const lens = makeLensShading();
  log(`lens shading of the composite pass: ${lens.strength}, divided out of the reference`);

  const total = (x, y) => lens.at(x, y) * referenceShading(screenRadius(x, y));
  log(`shading the reference carries and this bake does not: ${REFERENCE_SHADING_CORNER} at the corners, `
    + `divided out with it`);

  // The bearing of the sun is read before the shading is divided out, on the
  // reference as the rest of the project has always read it. It costs nothing —
  // the shading is symmetric about the centre of the frame and the sun is nearly
  // on that centre, so dividing it out moves the reading by a tenth of a degree —
  // and it keeps sky.json's sun the number every other bake was lit by.
  const azimuthReading = solarAzimuth(readSkySamples(reference, mask, lens.at));
  const azimuth = Math.round(azimuthReading.azimuth * 10) / 10;
  log(`solar azimuth: brightest clear sky at ${azimuthReading.brightestAt?.toFixed(1)} deg, `
    + `least blue at ${azimuthReading.whitestAt?.toFixed(1)} deg -> ${azimuth.toFixed(1)} +- ${azimuthReading.spread.toFixed(1)} deg`);

  const samples = readSkySamples(reference, mask, total);
  log(`sky samples ${samples.length}`);

  const fit = fitClearSky(samples, { azimuth });
  const sun = sunVector(fit.sun.elevation, azimuth);
  log(`clear sky fit on ${fit.bins} bins, relative rms ${(fit.errorBeforeResidual * 100).toFixed(1)}%`
    + ` -> ${(fit.error * 100).toFixed(1)}% with the local residual on ${fit.residualCells} cells`);
  log(`  solar elevation ${fit.sun.elevation} deg (within 5% of best over ${fit.elevationRange[0]}..${fit.elevationRange[1]} deg)`);
  log(`  tauRayleigh ${fit.params.tauRayleigh.toFixed(4)}  tauMie ${fit.params.tauMie.toFixed(4)}  `
    + `g ${fit.params.g.toFixed(3)}  ambient ${fit.params.ambient.toFixed(3)}`);
  log(`  exposure ${fit.params.exposure.map((v) => v.toFixed(4)).join(' ')}`);
  log('  clear sky, model against reference, as display sRGB:');
  for (const row of describeFit(fit)) {
    log(`    elev ${String(row.at).padStart(3)}  reference ${hex(row.target).padEnd(14)} model ${hex(row.model)}`);
  }
  for (const row of describeFit(fit, 'azimuth')) {
    log(`    az   ${String(row.at).padStart(3)}  reference ${hex(row.target).padEnd(14)} model ${hex(row.model)}`);
  }
  // How much radial darkening the model has credited to the sky, now that the
  // shading is out of the reference. It is not a check that can pass by
  // construction — the model is free to have found the darkening again and put it
  // back as sky — so it is worth reading rather than assuming.
  const leftover = readRadialLeftover(fit.measured, fit.params, fit.sun, project);
  log(`  radial darkening the model still carries, over ${leftover.bins} bins: `
    + `corner ${leftover.corner.toFixed(3)} of centre `
    + `(${leftover.coefficients.map((v) => v.toFixed(3)).join(' q + ')} q^2)`);

  const model = fit.params;
  // What the dome is made of, everywhere: the physical model and the bearing
  // surface fitted with it — smooth, azimuth dependent, aureole and all — and
  // NOT the local residual read off the photograph.
  //
  // That residual is a table of how far the reference departs from the model at
  // each bearing and height it reaches, carried outwards over tens of degrees
  // and faded back. It is the one part of this sky that knows where the frame
  // was, and everything it was asked to fix it fixed by putting the frame's own
  // shape into the sky: its reach is a distance from the measurement, a contour
  // of constant reach is an offset of the frame, and an offset of a frame is a
  // rectangle. Every attempt to hide that — shortening the reach, splitting it
  // in two, wandering it — moved the rectangle without removing it, because what
  // the eye reads is not the straightness of the edge but that a soft dark mass
  // the size of a photograph is standing in an open sky.
  //
  // So the dome is the clean model, and what the reference has to say about its
  // own sector is said by the carry below, inside that sector and nowhere else.
  const modelPlain = { ...model, residual: null };
  const clearAt = (elevation, azimuthDeg, out) => clearSkyAt(modelPlain, fit.sun, elevation, azimuthDeg, out);

  // ------------------------------------------------- the photographed sector
  const colLo = Math.floor(columnOfAzimuth(-WINDOW_AZIMUTH, width));
  const colHi = Math.ceil(columnOfAzimuth(WINDOW_AZIMUTH, width));
  const rowLo = Math.max(0, Math.floor(rowOfElevation(WINDOW_ELEVATION_TOP, height)));
  const rowHi = Math.min(height - 1, Math.ceil(rowOfElevation(WINDOW_ELEVATION_BOTTOM, height)));
  const winW = colHi - colLo + 1;
  const winH = rowHi - rowLo + 1;
  const winElevation = (y) => elevationOfRow(rowLo + y, height);
  const winAzimuth = (x) => azimuthOfColumn(colLo + x, width);
  const degPerTexel = 360 / width;

  const radiance = new Float32Array(winW * winH * 3);
  const covered = new Uint8Array(winW * winH);
  {
    const display = [0, 0, 0];
    const out = [0, 0, 0];
    let hits = 0;
    for (let y = 0; y < winH; y++) {
      const elevation = winElevation(y);
      const ce = Math.cos(elevation * DEG);
      const se = Math.sin(elevation * DEG);
      for (let x = 0; x < winW; x++) {
        const a = winAzimuth(x) * DEG;
        const p = project([ce * Math.sin(a), se, -ce * Math.cos(a)]);
        if (!p) continue;
        const [px, py] = p;
        if (px < 1 || py < 1 || px >= FRAME.width - 2 || py >= FRAME.height - 2) continue;
        const x0 = Math.floor(px);
        const y0 = Math.floor(py);
        // Every texel of the 2x2 the gather reads has to be sky, or a sliver of
        // stone would be carried into the sky as if it were weather.
        if (!mask[y0 * FRAME.width + x0] || !mask[y0 * FRAME.width + x0 + 1]
          || !mask[(y0 + 1) * FRAME.width + x0] || !mask[(y0 + 1) * FRAME.width + x0 + 1]) continue;
        // And it has to keep a pixel clear of the stone, which is not the same
        // test. The silhouette is the geometry's, the reference's own blocks sit
        // a pixel or two off it, and every one of them carries a lit edge that
        // is far brighter than the sky beside it. A gather that lands astride
        // that line reads a piece of stone as a piece of sky — one texel wide,
        // nine levels above its neighbours, running the whole height of the
        // silhouette without a bend. It is the straightest thing in this sky,
        // it is measurement rather than invention, and no amount of work on the
        // fill can remove it, because the fill is pinned to it.
        if (nearStone[y0 * FRAME.width + x0] || nearStone[(y0 + 1) * FRAME.width + x0 + 1]) continue;
        const fx = px - x0;
        const fy = py - y0;
        const i = y * winW + x;
        const shade = total(px, py);
        for (let c = 0; c < 3; c++) {
          const v00 = reference.data[(y0 * FRAME.width + x0) * 3 + c];
          const v10 = reference.data[(y0 * FRAME.width + x0 + 1) * 3 + c];
          const v01 = reference.data[((y0 + 1) * FRAME.width + x0) * 3 + c];
          const v01x = reference.data[((y0 + 1) * FRAME.width + x0 + 1) * 3 + c];
          display[c] = srgbToLinear(
            ((v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v01x * fx) * fy) / 255,
          ) / shade;
        }
        agxInverse(display, 1, out);
        for (let c = 0; c < 3; c++) radiance[i * 3 + c] = out[c];
        covered[i] = 1;
        hits++;
      }
    }
    log(`sector gathered: ${hits} texels of ${winW}x${winH} window (${(100 * hits / (winW * winH)).toFixed(1)}%)`);
  }

  // ---------------------------------------- which of it is sky and which cloud
  //
  // The separation is still run, and now it is run for one reason only: to know
  // which measured texels are the sky itself. Anything it reads as cloud is a
  // texel whose sky is not in the reference at any price, and the model has to
  // stand in for it.
  const { alpha } = separateCloud({
    radiance,
    covered,
    width: winW,
    height: winH,
    elevationOf: winElevation,
    azimuthOf: winAzimuth,
    model,
    modelPlain: { ...model, residual: null },
    sun,
    sunAngles: fit.sun,
  });

  // A texel beside a cloud is a texel with a little of that cloud's light in it,
  // whatever the coverage says, so the clear sky is read a short way in from
  // every rim. Half a degree: the width of the glow the reference draws round a
  // sunlit edge, and no more, because every degree given up here is a degree of
  // measured sky handed back to the model.
  const CLEAR_GUARD = 0.5;
  const clearMask = (() => {
    const cloudy = new Uint8Array(winW * winH);
    for (let i = 0; i < winW * winH; i++) if (!covered[i] || alpha[i] > 0) cloudy[i] = 1;
    const guard = Math.max(1, Math.round(CLEAR_GUARD / degPerTexel));
    const grown = dilate(cloudy, winW, winH, guard);
    const out = new Uint8Array(winW * winH);
    let n = 0;
    for (let i = 0; i < winW * winH; i++) {
      if (covered[i] && !grown[i]) { out[i] = 1; n++; }
    }
    log(`clear sky in the reference: ${n} texels of the ${winW * winH} window `
      + `(${(100 * n / Math.max(1, winW * winH)).toFixed(1)}%), read ${CLEAR_GUARD} deg clear of every cloud`);
    return out;
  })();

  // How far the reference's own clear sky departs from the model underneath it.
  //
  // Held inside a band, per channel, and the band is not a safety rail: it is
  // what keeps this a correction to a sky rather than a second way of drawing a
  // cloud. A texel the separation reads as clear can still carry a fifth of a
  // veil, and a fifth of a veil is a quarter more light than the sky under it;
  // let that through and the correction has the shape of the weather in it,
  // which is the one shape it must not have, because the weather is drawn
  // elsewhere and will not be standing where its shadow is.
  //
  // The distribution below is why the band stays where it is now that the model
  // it is measured against no longer has the photograph's own residual folded
  // into it. The median clear texel stands half a stop off that model and the
  // worst two stops, which is not a sky departing from a fit — it is veil, over
  // most of this window, and the kernel that follows would spread it into a
  // broad brightening with the weather's own footprint. Widening the band was
  // tried at two thirds of a stop and again at nearly one, across three kernels,
  // and it does exactly that: the sector's correction deepens from 3.2 units of
  // lightness to 7.9 while what it was widened to buy — how well the dome
  // reproduces the reference's own clear sky at the reference pose — moves by
  // four tenths of a unit of colour. The band is not what that costs.
  //
  // What the band was also doing, and had no business doing, is throwing the hue
  // away. Veil is grey: a fifth of a veil takes all three channels up together
  // and leaves the ratios between them alone, so a bound on how much brighter a
  // reading may be is exactly a bound on how much veil gets in. Applied to each
  // channel on its own it is not that. Three quarters of the readings here stand
  // outside it, and a reading outside it on all three comes back with all three
  // at the same number — with its colour replaced by grey. So the correction the
  // dome carried was very nearly colourless over most of the sector, and the
  // sector's hue was left to whatever the model says it is, which at the top of
  // the framing is eight levels of blue too many at the upper left and six too
  // few above the middle.
  //
  // So the level is read exactly as it was, out of the same clamped channels, and
  // the hue is read beside it from the unclamped reading and bounded on its own.
  // Its bound can be far tighter and still be everything, because the hue of a
  // clear sky is never far from the hue of a sky: a tenth of a log ratio between
  // a channel and the mean of the three is a dozen levels of blue at the
  // brightness this one runs at, which is more than the reference ever asks for
  // over the scale this is carried at. What it stops is what a bound is for — a
  // texel the separation called clear that is really the lit rim of a cloud, and
  // is coloured as well as bright.
  const DEPARTURE_LIMIT = 0.25;
  const CHROMA_LIMIT = 0.14;
  const departure = (() => {
    const flat = new Float32Array(winW * winH * 3);
    const tint = new Float32Array(winW * winH * 3);
    const weight = new Float32Array(winW * winH);
    const rgb = [0, 0, 0];
    const ratio = [0, 0, 0];
    const seen = [];
    const tinted = [];
    let n = 0;
    let held = 0;
    let heldHue = 0;
    for (let y = 0; y < winH; y++) {
      const elevation = winElevation(y);
      for (let x = 0; x < winW; x++) {
        const i = y * winW + x;
        if (!clearMask[i]) continue;
        clearAt(elevation, winAzimuth(x), rgb);
        let level = 0;
        for (let c = 0; c < 3; c++) {
          ratio[c] = Math.log(Math.max(1e-5, radiance[i * 3 + c]) / Math.max(1e-5, rgb[c]));
          if (Math.abs(ratio[c]) > DEPARTURE_LIMIT) held++;
          seen.push(Math.abs(ratio[c]));
          level += Math.min(DEPARTURE_LIMIT, Math.max(-DEPARTURE_LIMIT, ratio[c])) / 3;
        }
        const mean = (ratio[0] + ratio[1] + ratio[2]) / 3;
        for (let c = 0; c < 3; c++) {
          const hue = ratio[c] - mean;
          if (Math.abs(hue) > CHROMA_LIMIT) heldHue++;
          tinted.push(Math.abs(hue));
          flat[i * 3 + c] = level;
          tint[i * 3 + c] = Math.min(CHROMA_LIMIT, Math.max(-CHROMA_LIMIT, hue));
        }
        weight[i] = 1;
        n++;
      }
    }
    seen.sort((a, b) => a - b);
    tinted.sort((a, b) => a - b);
    log(`  measured against the model on ${n} texels, `
      + `${(100 * held / Math.max(1, n * 3)).toFixed(1)}% of them held to the band `
      + `(median ${seen[seen.length >> 1].toFixed(3)}, `
      + `95th ${seen[Math.floor(seen.length * 0.95)].toFixed(3)}, `
      + `worst ${seen[seen.length - 1].toFixed(3)} of ${DEPARTURE_LIMIT})`);
    log(`  their hue, held apart and on its own band: `
      + `${(100 * heldHue / Math.max(1, n * 3)).toFixed(1)}% held `
      + `(median ${tinted[tinted.length >> 1].toFixed(3)}, `
      + `95th ${tinted[Math.floor(tinted.length * 0.95)].toFixed(3)}, `
      + `worst ${tinted[tinted.length - 1].toFixed(3)} of ${CHROMA_LIMIT})`);
    const level = fillByScales({
      value: flat, weight, width: winW, height: winH, channels: 3, degPerTexel,
    });
    const hue = fillByScales({
      value: tint, weight, width: winW, height: winH, channels: 3, degPerTexel, scales: [TINT_SCALE],
    });
    // The hue is carried as a departure from the mean of the three and comes back
    // as one: whatever the kernel does to it, it is made to say nothing about how
    // bright this sky is, so the level the sector was passing with is untouched.
    for (let i = 0; i < winW * winH; i++) {
      const sharp = (hue[i * 3] + hue[i * 3 + 1] + hue[i * 3 + 2]) / 3;
      for (let c = 0; c < 3; c++) hue[i * 3 + c] -= sharp;
    }
    return { level, hue };
  })();

  // And how far it reaches: nothing outside the reference framing, full strength
  // well inside it, and the handover taken in the one place where there is
  // something to hide it behind.
  //
  // The border of the framing is where the walker's own frame ends at the
  // reference pose, so the ramp lives entirely under sky he is already looking
  // at from a bearing he is already at; and it is the last place in the picture
  // the eye is comparing against anything, because the reference stops there
  // too. Outside, the model, immediately: a sky that has never heard of the
  // photograph cannot carry its shape.
  const { carry, tintCarry } = (() => {
    const out = new Float32Array(winW * winH);
    const tint = new Float32Array(winW * winH);
    // Degrees of sky one pixel of the reference frame spans. Read at the centre,
    // where the projection is uniform; towards a corner a rectilinear frame
    // stretches, so this understates the distance and the ramp is a little
    // longer there than it says. Nothing depends on it to a degree.
    const degPerPixel = POSE.fov / FRAME.height;
    for (let y = 0; y < winH; y++) {
      const elevation = winElevation(y);
      const ce = Math.cos(elevation * DEG);
      const se = Math.sin(elevation * DEG);
      for (let x = 0; x < winW; x++) {
        const a = winAzimuth(x) * DEG;
        const p = project([ce * Math.sin(a), se, -ce * Math.cos(a)]);
        if (!p) continue;
        const inside = Math.min(p[0], p[1], FRAME.width - 1 - p[0], FRAME.height - 1 - p[1]);
        out[y * winW + x] = smoothstep(0, CARRY_HANDOVER, inside * degPerPixel);
        tint[y * winW + x] = smoothstep(0, TINT_HANDOVER, inside * degPerPixel);
      }
    }
    return { carry: out, tintCarry: tint };
  })();

  // ------------------------------------------------------------- composite
  const out = Buffer.alloc(width * height * 3);
  const clear = [0, 0, 0];
  let peak = 0;
  let clipped = 0;

  // One row of scene radiance at a time, because what happens to a row below
  // the horizon depends on the whole of it.
  const rowRadiance = new Float32Array(width * 3);
  const rowBlur = new Float32Array(width * 3);
  const boxBlurRow = (radius) => {
    if (radius < 1) return;
    const span = radius * 2 + 1;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += rowRadiance[(((k % width) + width) % width) * 3 + c];
      for (let col = 0; col < width; col++) {
        rowBlur[col * 3 + c] = sum / span;
        const enter = ((((col + radius + 1) % width) + width) % width) * 3 + c;
        const leave = ((((col - radius) % width) + width) % width) * 3 + c;
        sum += rowRadiance[enter] - rowRadiance[leave];
      }
    }
    rowRadiance.set(rowBlur);
  };

  for (let row = 0; row < height; row++) {
    const elevation = elevationOfRow(row, height);
    const inWindowRow = row >= rowLo && row <= rowHi;
    for (let col = 0; col < width; col++) {
      clearAt(elevation, azimuthOfColumn(col, width), clear);
      let kr = 0; let kg = 0; let kb = 0;
      if (inWindowRow && col >= colLo && col <= colHi) {
        const i = (row - rowLo) * winW + (col - colLo);
        const w = carry[i];
        const t = tintCarry[i];
        if (w > 0 || t > 0) {
          kr = departure.level[i * 3] * w + departure.hue[i * 3] * t;
          kg = departure.level[i * 3 + 1] * w + departure.hue[i * 3 + 1] * t;
          kb = departure.level[i * 3 + 2] * w + departure.hue[i * 3 + 2] * t;
        }
      }
      const o = col * 3;
      rowRadiance[o] = Math.max(0, clear[0] * Math.exp(kr));
      rowRadiance[o + 1] = Math.max(0, clear[1] * Math.exp(kg));
      rowRadiance[o + 2] = Math.max(0, clear[2] * Math.exp(kb));
    }
    if (elevation < 0) {
      const t = smoothstep(0, BELOW_HORIZON_UNIFORM, elevation);
      const sigma = BELOW_HORIZON_SIGMA * t;
      // Three box passes make a gaussian close enough for a haze; the running
      // sum makes each of them cost the same whatever the radius is.
      const radius = Math.min(Math.floor(width / 2) - 1, Math.round(sigma * 1.15 * width / 360));
      for (let pass = 0; pass < 3; pass++) boxBlurRow(radius);
    }

    for (let col = 0; col < width; col++) {
      const o = (row * width + col) * 3;
      for (let c = 0; c < 3; c++) {
        const value = rowRadiance[col * 3 + c];
        if (value > peak) peak = value;
        if (value > SKY_INTENSITY) clipped++;
        // Written flat, and rounded rather than dithered. A dithered gradient is
        // noise to a block codec and costs it an order of magnitude in rate to
        // store; the noise that keeps this gradient from banding on an eight bit
        // screen is made per fragment in src/core/sky.js, where it is free.
        const stored = linearToSrgb(Math.min(SKY_INTENSITY, value) / SKY_INTENSITY) * 255;
        out[o + c] = Math.min(255, Math.max(0, Math.round(stored)));
      }
    }
  }

  // Both poles, held to one exact colour: the mean of the band they replace.
  //
  // A band that stands for a single point has nothing to carry, and a block
  // codec has no business spending bits on it. Held flat, the band encodes
  // exactly: measured on the delivered texture, every row from the third down is
  // byte for byte the colour written here, where before it wandered by a unit;
  // and the ring the resampler leaves at the boundary, four rows before, is two
  // rows now.
  //
  // What this does not do is make the top row faithful, and that is worth
  // writing down rather than discovering twice. The encoder resamples this bake
  // down to the size it delivers and it wraps at the boundary, so the first rows
  // carry a piece of the nadir whatever is written here — measured, the top row
  // comes back six units of colour above the sky beneath it, capped or not, and
  // a flat test picture of two greys comes back with the same signature.
  // Wrapping is right for the bearing and wrong for the latitude and there is one
  // setting for both, so the answer is not to stop it wrapping, which would build
  // the western seam against a wall. The answer is not to read those rows at all,
  // which is what the clamp in src/core/sky.js does. This band is the floor under
  // that clamp rather than what it reads: it stands entirely inside it, so
  // nothing here is ever drawn, and what is left up there is one known number
  // instead of whatever the bake happened to leave.
  {
    const capRows = Math.max(1, Math.round((POLE_CAP_DEG / 180) * height));
    for (const pole of ['zenith', 'nadir']) {
      const firstRow = pole === 'zenith' ? 0 : height - capRows;
      const sum = [0, 0, 0];
      for (let row = firstRow; row < firstRow + capRows; row++) {
        for (let col = 0; col < width; col++) {
          const o = (row * width + col) * 3;
          sum[0] += out[o]; sum[1] += out[o + 1]; sum[2] += out[o + 2];
        }
      }
      const cap = sum.map((v) => Math.round(v / (capRows * width)));
      for (let row = firstRow; row < firstRow + capRows; row++) {
        for (let col = 0; col < width; col++) {
          const o = (row * width + col) * 3;
          out[o] = cap[0]; out[o + 1] = cap[1]; out[o + 2] = cap[2];
        }
      }
      log(`${pole} held flat over ${capRows} rows `
        + `(${((capRows / height) * 180).toFixed(2)} deg) at ${cap.join(',')}`);
    }
  }

  // Where the delivered dome stands against the reference's own clear sky, on
  // the texels the reference shows sky at, split into the two things that are
  // not this bake's to answer for in the same way.
  //
  // The LIGHTNESS here is meant to be large and is not a fault: those texels
  // carry the photograph's veil, the band above holds the dome out of most of
  // it on purpose, and what is left over is drawn by the weather and by the
  // arrival shading. Read it as how much of the picture is not the dome's, and
  // watch it for movement rather than for size.
  //
  // The TINT is the one this dome answers for alone, because nothing downstream
  // of it carries a colour: not the arrival shading, which is one number per
  // knot, and not the weather, which is smoothed across the bearing far harder
  // than the sky's own hue turns. If this pair walks, the sector's hue is
  // walking with it.
  {
    const lift = [0, 0, 0];
    const rgb = [0, 0, 0];
    let n = 0; let sum = 0;
    const signed = [0, 0, 0];
    for (let y = 0; y < winH; y++) {
      for (let x = 0; x < winW; x++) {
        const i = y * winW + x;
        if (!clearMask[i]) continue;
        const o = ((rowLo + y) * width + (colLo + x)) * 3;
        for (let c = 0; c < 3; c++) lift[c] = srgbToLinear(out[o + c] / 255) * SKY_INTENSITY;
        const here = srgbToLab(agx(lift, 1));
        for (let c = 0; c < 3; c++) rgb[c] = radiance[i * 3 + c];
        const want = srgbToLab(agx(rgb, 1));
        sum += Math.hypot(here[0] - want[0], here[1] - want[1], here[2] - want[2]);
        for (let c = 0; c < 3; c++) signed[c] += here[c] - want[c];
        n++;
      }
    }
    log(`the dome against the reference's own clear sky, on ${n} texels of the framing: `
      + `mean DeltaE76 ${(sum / Math.max(1, n)).toFixed(2)} `
      + `(lightness ${(signed[0] / Math.max(1, n)).toFixed(2)}, `
      + `tint ${(signed[1] / Math.max(1, n)).toFixed(2)} / ${(signed[2] / Math.max(1, n)).toFixed(2)})`);
  }

  {
    // INVARIANT — the clear sky closes no blotch the model does not.
    const uniformity = checkUniformity(out, width, height, clearAt);
    log('low frequency uniformity of the clear sky, worst closed blotch of any band:');
    for (const line of uniformity.report) log(line);
    for (const line of uniformity.complaints) log(`  FAILED  ${line}`);
    if (uniformity.complaints.length) {
      throw new Error(`${uniformity.complaints.length} channel(s) of the dome carry blotches`);
    }
  }

  const clippedFraction = clipped / (width * height * 3);
  if (clippedFraction > 0.0008) {
    throw new Error(`${(clippedFraction * 100).toFixed(3)}% of the sky exceeds SKY_INTENSITY ${SKY_INTENSITY}`
      + ` (peak ${peak.toFixed(2)})`);
  }

  // Encoded, not yet written: the seal gate below decides, and it cannot decide
  // about bytes that are already on disk. See UNSEAL at the top of this file.
  const imagePath = join(OUT_IMAGE_DIR, 'sky-equirect.png');
  const imageData = await encodeCleanPng(out, { width, height });
  const imageBytes = imageData.length;

  // What the rest of the scene needs to know about the sky without sampling it.
  const toHex = (radianceRgb) => {
    const display = agx(radianceRgb, 1);
    return `#${display.map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255)
      .toString(16).padStart(2, '0')).join('')}`;
  };
  // The day, as the dome will actually be built from it.
  //
  // Read off the same fit everything above was measured with, and stripped of
  // every table that fit produced: what crosses into src/core/sky.js is the
  // physical model and nothing that knows where the reference framing was. The
  // horizon, the zenith and the fog below are then taken from THIS rather than
  // from the fit with its surfaces on, because they are what the rest of the
  // scene is told the sky looks like, and the sky the scene will see is this
  // one.
  const day = dayPreset(fit.plainParams, fit.sun);
  const domeAtAngle = (elevation, azimuthDeg, out) => domeAt(day, elevation, azimuthDeg, out);
  log(`the dome's own preset, fitted with no surface beside it, relative rms `
    + `${(fit.plainError * 100).toFixed(1)}%:`);
  log(`  tauRayleigh ${day.tauRayleigh.map((v) => v.toFixed(4)).join(' ')}`);
  log(`  tauMie      ${day.tauMie.map((v) => v.toFixed(4)).join(' ')}`);
  log(`  g ${day.g}  ambient ${day.ambient}  exposure ${day.exposure.map((v) => v.toFixed(4)).join(' ')}`);
  log(`  aureole, measured and not chosen: wide ${day.aureole.wide.toFixed(4)} `
    + `at cos^${day.aureole.wideExponent}, narrow ${day.aureole.narrow.toFixed(4)} `
    + `at cos^${day.aureole.narrowExponent}`);
  {
    // What the pair is worth where the eye will look for it, as a fraction of
    // the sky the model alone would have put there.
    const bare = { ...day, aureole: { ...day.aureole, wide: 0, narrow: 0 } };
    const lit = [0, 0, 0];
    const plain = [0, 0, 0];
    const gains = [2, 5, 10, 15, 30, 60].map((away) => {
      domeAt(day, fit.sun.elevation - away, azimuth, lit);
      domeAt(bare, fit.sun.elevation - away, azimuth, plain);
      return `${away} deg ${(100 * (lit[1] / Math.max(1e-9, plain[1]) - 1)).toFixed(0)}%`;
    });
    log(`  what it lifts the sky by, at that angle from the sun: ${gains.join(', ')}`);
  }

  const horizon = domeAtAngle(0, azimuth, [0, 0, 0]).slice();
  const zenith = domeAtAngle(90, azimuth, [0, 0, 0]).slice();
  // Fog takes the sky just above the horizon, where the ground plane actually
  // dissolves, and it takes it behind the walker's shoulder rather than towards
  // the sun, because that is the direction most of the ground is seen against.
  const fogRadiance = domeAtAngle(1.5, azimuth + 180, [0, 0, 0]).slice();

  const params = {
    intensity: SKY_INTENSITY,
    size: { width, height },
    horizon: toHex(horizon),
    zenith: toHex(zenith),
    fog: toHex(fogRadiance),
    sun: {
      elevation: fit.sun.elevation,
      azimuth,
      elevationRange: fit.elevationRange,
      azimuthSpread: Number(azimuthReading.spread.toFixed(1)),
    },
    // THE PRESET THE DOME IS BUILT FROM, and the only thing in this file the
    // running page reads. Everything else here describes the fit or the
    // reference framing; this is the sky itself, as twelve numbers and two
    // lobes. A second preset — a dusk, a night — is another object of the same
    // shape beside this one, and the cycle is a walk between them.
    day,
    // How thick the air is along a ray, at the horizon and below it. A property
    // of the model rather than of a time of day, so it sits beside the presets
    // and not inside one; published because the shader continues the curve below
    // the horizon and would otherwise be carrying its own copy of two numbers
    // that come out of a formula in this repository.
    airMass: {
      horizon: Number(HORIZON_AIR_MASS.toFixed(6)),
      horizonSlope: Number(HORIZON_AIR_MASS_SLOPE.toFixed(6)),
      belowHorizonScale: BELOW_HORIZON_SCALE,
    },
    horizonRadiance: horizon.map((v) => Number(v.toFixed(5))),
    fogRadiance: fogRadiance.map((v) => Number(v.toFixed(5))),
    // The shading the reference carries and this bake does not, as the fraction
    // of the centre's light left at a corner of the reference framing. Published
    // rather than described, so the veil in src/ui and this bake can never
    // disagree about what was taken out.
    lensShading: REFERENCE_SHADING_CORNER,
    // And the whole of what the arrival composition carries and the dome cannot:
    // the constant above plus every departure the photograph has from the smooth
    // sky fitted here, measured over the frame by tools/grade/fit-veil.mjs. The
    // interface draws this one; it is published from the bake so that there is
    // one place the shading of the reference framing is written down.
    arrivalShading: ARRIVAL_SHADING,
  };
  const paramsText = `${JSON.stringify(params, null, 2)}\n`;

  log(`peak radiance ${peak.toFixed(3)} of ${SKY_INTENSITY}, ${(clippedFraction * 100).toFixed(4)}% clipped`);
  log(`horizon ${params.horizon}  zenith ${params.zenith}  fog ${params.fog}`);

  // THE GATE. Everything above is measurement and costs minutes; the decision it
  // arrives at is one line, and it is the only line in this file that can lose
  // S1. A refusal exits non-zero having written nothing at all.
  const wrote = writeUnderSeal([
    {
      path: OUT_PARAMS,
      bytes: paramsText,
      drift: jsonDrift(OUT_PARAMS, paramsText),
    },
    {
      path: imagePath,
      bytes: imageData,
      // Bytes rather than fields: there is nothing to name inside a PNG. It is
      // gitignored and only the JSON is under the seal proper, but it is gated
      // with it because the two describe one sky and must not come apart. Worth
      // knowing that it did NOT always differ: in S2b the picture regenerated
      // byte for byte, which is how that unit learned it had never been stale.
      // It differs now, so something in the chain behind it has moved since.
      drift: existsSync(imagePath)
        ? (readFileSync(imagePath).equals(imageData) ? [] : ['    the encoded picture differs'])
        : null,
    },
  ]);
  if (!wrote) return;

  log(`${imagePath} (${(imageBytes / 1024).toFixed(0)} kB)`);
  log(`${OUT_PARAMS}`);
  log(`total ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

main();
