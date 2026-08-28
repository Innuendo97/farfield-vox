import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { FRAME, horizonRow } from './lib/framing.mjs';
import { buildStoneMask } from './lib/target.mjs';
import { surveyPose, REFERENCE_POSE } from './lib/survey-poses.mjs';

// How pure the white of the weather is, measured in the geometry of the pose
// the frame was actually taken at.
//
//   node tools/grade/measure-purity.mjs <frame.png> [--bare <twin.png>]
//        [--pose <name>] [--label <text>] [--report <file.txt>]
//
// Cloud that has gone grey, or blue, or muddy reads as weather that is behind
// glass. The rule is the campaign's and is not restated here to be argued with:
// a pixel counts as cloud when its saturation is under 0.20 and its luminance
// over the floor, the percentiles are weighted by solid angle because a wide
// frame's pixels are not worth the same, and the low percentile is the number
// that says whether the darkest of the white is still white.
//
// WHAT THIS FILE EXISTS FOR IS THE POSE, AND IT IS NOT A DETAIL. The measure
// this replaces knew two framings and was handed frames from twenty eight. Any
// name it did not recognise silently took the reference geometry — yaw 0, pitch
// 4.5, field 45 — and several of the survey poses are taken at pitch 8 and
// field 72, or at pitch 40, or at pitch 85. The frames were right; the ruler
// was standing somewhere else.
//
// A ruler in the wrong place gets three things wrong at once, and none of them
// is harmless:
//
//   * the SOLID ANGLE per pixel comes out of the field of view, and every
//     percentile here is weighted by it;
//   * the ROW the hill floor falls on comes out of the pitch and the field;
//   * the stone mask and the four interface panels are drawn on the reference
//     framing and mean nothing on any other, so they are switched off exactly
//     where they stop applying.
//
// AND THE FLOOR ROW IS NO LONGER A CONSTANT, WHICH IS THE SAME RULE AS BEFORE
// AND NOT A NEW ONE. The measure this replaces wrote 420 for the reference
// framing and 504 for the wide look, and its own note said why: they are the
// same ELEVATION. That elevation is declared once below and the row is derived,
// so those two poses come out with their own old rows and the other twenty six
// come out with theirs.

const DEG = Math.PI / 180;
const W = FRAME.width;
const H = FRAME.height;

// The elevation of the hill floor: the thing 420 and 504 were two names for.
const FLOOR_ELEVATION = 7.0;

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const FILE = args[0];
const BARE = flag('--bare');
const POSE_NAME = flag('--pose', REFERENCE_POSE);
const LABEL = flag('--label', FILE);
const THRESHOLD = Number(flag('--threshold', '150'));
if (!FILE) throw new Error('usage: node tools/grade/measure-purity.mjs <frame.png> [--bare <twin.png>] [--pose <name>]');
const pose = surveyPose(POSE_NAME);

/** The row a given elevation falls on at this pose. The inverse of makeRay. */
const rowOfElevation = (elevation) => {
  const tanV = Math.tan(pose.fov * DEG / 2);
  const v = Math.tan((elevation - pose.pitch) * DEG);
  return H * (1 - v / tanV) / 2 - 0.5;
};
const FLOOR_ROW = Number(flag('--row', String(Math.round(rowOfElevation(FLOOR_ELEVATION)))));
const MARGIN = Number(flag('--margin', '0'));
const MX = Math.round(W * MARGIN);
const MY = Math.round(H * MARGIN);

// The stone and the interface panels hold ONLY at the reference framing. This
// is the rule the previous measure already applied to the wide look, extended
// to every pose that is not the reference one, because the reason is the same:
// a mask drawn on one camera is a mask that lands on nothing under another.
const IS_REFERENCE = POSE_NAME === REFERENCE_POSE;
const UI_RECTS = IS_REFERENCE ? [
  { x0: 0, y0: 0, x1: 288, y1: 298 },
  { x0: 0, y0: 682, x1: 248, y1: 941 },
  { x0: 752, y0: 852, x1: 948, y1: 941 },
  { x0: 1372, y0: 852, x1: 1672, y1: 941 },
] : [];

const SAT_MAX = 0.20;   // the campaign's rule, unchanged
// Not the 120 the reference metrology uses: here it only has to keep the stone
// out, and a floor high enough to judge cloud would throw away the cloud that
// is being judged.
const LUM_FLOOR = 60;

const lum = (d, i) => 0.2126 * d[i * 3] + 0.7152 * d[i * 3 + 1] + 0.0722 * d[i * 3 + 2];
const sat = (d, i) => {
  const mx = Math.max(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]);
  return mx > 0 ? (mx - Math.min(d[i * 3], d[i * 3 + 1], d[i * 3 + 2])) / mx : 0;
};
const inRect = (x, y, r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
const f = (v, n = 1) => (Number.isFinite(v) ? Number(v).toFixed(n) : '   -');

async function read(path) {
  const { data, info } = await sharp(path).removeAlpha().resize(W, H, { fit: 'fill' })
    .raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const horizon = horizonRow({ pose });
const omega = new Float32Array(W * H);
{
  const tanV = Math.tan(pose.fov * DEG / 2);
  const tanH = tanV * (W / H);
  const cell = (2 * tanH / W) * (2 * tanV / H) / (DEG * DEG);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = ((x + 0.5) / W * 2 - 1) * tanH;
      const v = (1 - (y + 0.5) / H * 2) * tanV;
      omega[y * W + x] = cell / (1 + u * u + v * v) ** 1.5;
    }
  }
}
const stone = IS_REFERENCE ? await buildStoneMask() : new Uint8Array(W * H);

const frame = await read(FILE);
const bare = BARE ? await read(BARE) : null;

// THE STONE, ON A POSE THE REFERENCE MASK DOES NOT COVER. The mask is drawn on
// the reference framing and holds on no other, but the header of the measure it
// comes from already says how to do without one: on our own frame the bare twin
// takes the stone out by itself. Where the dressed frame is identical to the
// bare one there is no cloud — it is stone, tower or hill — and that is
// geometry rather than a threshold on a tint.
//
// So the saturation mask is INTERSECTED with the bare twin when there is one.
// At the reference framing this changes nothing, because there the stone is
// already out by the mask; on every other pose it is the only thing keeping
// what is not sky out of the reading. Both readings are printed, and neither is
// hidden, because it is that agreement at the reference framing which says the
// second is not a new rule.
function bySaturation(image, twin = null) {
  const m = new Uint8Array(W * H);
  for (let y = MY; y < Math.min(H, Math.ceil(horizon), FLOOR_ROW); y++) {
    for (let x = MX; x < W - MX; x++) {
      const i = y * W + x;
      if (stone[i]) continue;
      if (UI_RECTS.some((r) => inRect(x, y, r))) continue;
      if (twin) {
        const d = Math.max(
          Math.abs(image.data[i * 3] - twin.data[i * 3]),
          Math.abs(image.data[i * 3 + 1] - twin.data[i * 3 + 1]),
          Math.abs(image.data[i * 3 + 2] - twin.data[i * 3 + 2]),
        );
        if (d < 2) continue;
      }
      if (sat(image.data, i) < SAT_MAX && lum(image.data, i) > LUM_FLOOR) m[i] = 1;
    }
  }
  return m;
}

function byDifference(image, twin) {
  const m = new Uint8Array(W * H);
  for (let y = MY; y < Math.min(H, Math.ceil(horizon), FLOOR_ROW); y++) {
    for (let x = MX; x < W - MX; x++) {
      const i = y * W + x;
      if (UI_RECTS.some((r) => inRect(x, y, r))) continue;
      const d = Math.max(
        Math.abs(image.data[i * 3] - twin.data[i * 3]),
        Math.abs(image.data[i * 3 + 1] - twin.data[i * 3 + 1]),
        Math.abs(image.data[i * 3 + 2] - twin.data[i * 3 + 2]),
      );
      if (d >= 2) m[i] = 1;
    }
  }
  return m;
}

// Weighted by solid angle rather than by pixel count: at field 72 the corner
// pixels of this frame carry barely half the sky a central one does, and a
// percentile that counted them equally would be reading the lens.
function percentiles(mask, image, ps) {
  const samples = [];
  let weight = 0;
  for (let i = 0; i < W * H; i++) {
    if (mask[i]) { samples.push([lum(image.data, i), omega[i]]); weight += omega[i]; }
  }
  samples.sort((a, b) => a[0] - b[0]);
  const out = {};
  let acc = 0;
  let k = 0;
  for (const p of ps) {
    const target = weight * p / 100;
    while (k < samples.length && acc + samples[k][1] < target) { acc += samples[k][1]; k++; }
    out[p] = samples.length ? samples[Math.min(k, samples.length - 1)][0] : NaN;
  }
  return {
    out,
    n: samples.length,
    squareDegrees: weight,
    mean: samples.reduce((t, c) => t + c[0] * c[1], 0) / (weight || 1),
  };
}

// Connected components rather than a count of dark pixels: a thousand dark
// pixels scattered through the weather is grain and a thousand in one place is
// a cavity, and only the second is a defect anybody can see.
function darkRegions(mask, image, threshold) {
  const below = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (mask[i] && lum(image.data, i) < threshold) below[i] = 1;
  const seen = new Uint8Array(W * H);
  const regions = [];
  const stack = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!below[s] || seen[s]) continue;
    let top = 0;
    stack[top++] = s;
    seen[s] = 1;
    let n = 0;
    let area = 0;
    let x0 = W;
    let x1 = 0;
    let y0 = H;
    let y1 = 0;
    let sum = 0;
    let lowest = 255;
    while (top > 0) {
      const i = stack[--top];
      const x = i % W;
      const y = (i / W) | 0;
      n++;
      area += omega[i];
      sum += lum(image.data, i);
      if (lum(image.data, i) < lowest) lowest = lum(image.data, i);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const j of [i - 1, i + 1, i - W, i + W]) {
        if (j < 0 || j >= W * H) continue;
        if (Math.abs((j % W) - x) > 1) continue;
        if (below[j] && !seen[j]) { seen[j] = 1; stack[top++] = j; }
      }
    }
    regions.push({
      n, area, x0, x1, y0, y1, mean: sum / n, lowest,
    });
  }
  return regions.sort((a, b) => b.area - a.area);
}

const lines = [];
const say = (s) => { lines.push(s); console.log(s); };

say(`  ${LABEL}`);
say(`  frame       ${FILE}${BARE ? `   bare twin ${BARE}` : ''}`);
say(`  pose        ${POSE_NAME}  (yaw ${pose.yaw} pitch ${pose.pitch} fov ${pose.fov}), horizon at row ${f(horizon, 1)}`);
say(`  rule        saturation < ${SAT_MAX}, luminance > ${LUM_FLOOR}, rows ${MY}..${FLOOR_ROW} (elevation ${FLOOR_ELEVATION} deg), margin ${MARGIN}, stone and panels ${IS_REFERENCE ? 'removed' : 'not applicable'}`);
say('');

const PS = [0.1, 0.5, 1, 2, 5, 10, 25, 50, 75, 90, 99];
const saturationMask = bySaturation(frame);
const bySat = percentiles(saturationMask, frame, PS);
say(`  SATURATION    ${bySat.n} cloud pixels, ${f(bySat.squareDegrees, 0)} square degrees, mean ${f(bySat.mean)}`);
say(`     ${PS.map((p) => `p${p}`.padStart(7)).join('')}`);
say(`     ${PS.map((p) => f(bySat.out[p]).padStart(7)).join('')}`);
if (bare) {
  const intersected = percentiles(bySaturation(frame, bare), frame, PS);
  say(`  SAT n BARE    ${intersected.n} cloud pixels, ${f(intersected.squareDegrees, 0)} square degrees, mean ${f(intersected.mean)}`);
  say(`     ${PS.map((p) => f(intersected.out[p]).padStart(7)).join('')}`);
}
{
  let low = 0;
  let total = 0;
  for (let i = 0; i < W * H; i++) {
    if (saturationMask[i]) { total += omega[i]; if (lum(frame.data, i) < 90) low += omega[i]; }
  }
  say(`     between ${LUM_FLOOR} and 90: ${f(low / total * 100, 2)} % of the cloud — near zero means the floor is not biting`);
}
say('');

if (bare) {
  const byDiff = percentiles(byDifference(frame, bare), frame, PS);
  say(`  DIFFERENCE    ${byDiff.n} cloud pixels, ${f(byDiff.squareDegrees, 0)} square degrees, mean ${f(byDiff.mean)}`);
  say(`     ${PS.map((p) => `p${p}`.padStart(7)).join('')}`);
  say(`     ${PS.map((p) => f(byDiff.out[p]).padStart(7)).join('')}`);
  say('');
}

const regions = darkRegions(saturationMask, frame, THRESHOLD);
const large = regions.filter((r) => r.area >= 0.5);
say(`  CLOUD REGIONS UNDER ${THRESHOLD} LEVELS: ${regions.length} components, ${large.length} of half a square degree or more`);
say(`     ${'area deg2'.padStart(10)} ${'px'.padStart(7)}  ${'box (x y w h)'.padEnd(24)} ${'mean'.padStart(6)} ${'min'.padStart(6)}`);
for (const r of large.slice(0, 14)) {
  say(`     ${f(r.area, 2).padStart(10)} ${String(r.n).padStart(7)}  ${`${r.x0} ${r.y0} ${r.x1 - r.x0 + 1} ${r.y1 - r.y0 + 1}`.padEnd(24)} ${f(r.mean).padStart(6)} ${f(r.lowest).padStart(6)}`);
}
say('');

const report = flag('--report');
if (report) writeFileSync(report, `${lines.join('\n')}\n`);
