import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { FRAME, makeRay, REPO_ROOT } from '../grade/lib/framing.mjs';
import { srgbToLinear } from '../grade/lib/color.mjs';
import { readTarget } from '../grade/lib/target.mjs';
import { heightAt, pathCentreX, pathCoord, pathRun } from '../../src/world/terrain-field.js';
import { EYE_HEIGHT } from '../../src/world/layout.js';
import { traceGround } from './probe.mjs';
import {
  atlasSpan, bandLimit, pave, paveErosion, PLATE, slabSpace, paveFrom,
} from './lib/pattern.mjs';

// IS THE PAVING OF THE PATH THE REFERENCE'S PAVING?
//
//   node tools/terrain/check-slabs.mjs shots/pose-p.png
//   node tools/terrain/check-slabs.mjs --close shots/close.png
//   node tools/terrain/check-slabs.mjs --self      (the measure, validated)
//
// Not "is it the same colour" — that is probe.mjs, and colour is the half of the
// path that the light of two different afternoons argues about. This asks about
// the PATTERN: how much of the surface is dark line, how deep those lines cut,
// how far apart they are, and how much grain rides on the stone between them.
// Those belong to the paving rather than to the hour, which is exactly why they
// are the half of the path that CAN be held to the reference at all.
//
// IN METRES, NOT IN PIXELS. A slab is a fixed number of centimetres and a
// varying number of pixels: near the eye it covers eighty of them and at the
// stair thirty, so a statistic gathered in image space would answer "how far
// away is this" as loudly as it answers "how big are the slabs". Every pixel is
// traced into the height field instead, which gives the world point behind it,
// and the readings are gathered into a grid of the path laid flat. Both the
// render and the photograph go through that one rectification.
//
// RELATIVE, NOT ABSOLUTE. Every cell is divided by the mean of the thirty
// centimetres around it before it is counted, because the reference's path and
// this one are not at the same level and cannot be: the reference's near stretch
// lies in a shadow this world's sealed sun does not cast, which S2 recorded as
// its sixth decision. A joint three tenths darker than the slab beside it is
// three tenths darker in sun and in shade both.
//
// AND AT ONE BAND OF SCALES, which is what makes it fair to answer this with
// paint. Everything below the local thirty centimetres is kept and everything
// above it is divided out, and across eight to sixty centimetres of flat ground
// the light has almost nothing to say: the bake is smooth at that scale and the
// sun does not draw at it. What lives there is stone — grain, grit, joints,
// cracks. So chasing these five numbers with albedo is not baking a photograph's
// light into a pigment. Chasing the LEVEL with albedo would be, and this refuses
// to look at the level.

// AND A SECOND BAND, THREE OCTAVES FINER, BECAUSE THE ONE ABOVE IS BLIND THERE.
//
// Everything else here is read on a rectified grid of eight centimetre cells,
// which cannot see anything finer than sixteen: the whole of the grit, the chips
// and the pockmarks are below its Nyquist. In the near stretch of the frame,
// though, a pixel covers about six millimetres across the run and eighteen
// along it, so the picture holds three more octaves that nothing has ever read
// — and the reference's near paving is full of them while this world's, up to
// now, was smooth.
//
// So the near stretch is read a second time WITHOUT rectifying. Each pixel is
// smoothed against its neighbours in the WORLD, with Gaussian weights over the
// distance between the points they trace to, at four millimetres, two
// centimetres and twelve. The difference of the first two over the third is how
// much of this surface lives at centimetres.
//
// In metres and not in pixels, for the same reason as everything above and with
// the same evidence: split the reference's own near band in half by distance and
// the two halves answer within 0.38 points of each other this way, against 1.6
// points when the smoothing is counted in pixels — because a pixel is worth more
// ground at nine metres than at six, and a band defined in pixels therefore
// drifts down the frame.
const GRIT = { lo: 6.0, hi: 9.6 };
const GRIT_HALF = 0.75; // of the half width
const GRIT_SIGMA = [0.004, 0.020, 0.120]; // metres
// Far enough across to reach twelve centimetres of ground either way, and no
// further: the weights beyond it are nothing and the gather is the cost here.
const GRIT_WINDOW = { x: 14, y: 5 };
// Wider than the masks above. This band runs right up against the walker and
// the interface, and the anti-aliased edge of either would read as grain.
const GRIT_MASK = [
  { x0: 590, y0: 560, x1: 750, y1: 941 },
  { x0: 762, y0: 855, x1: 928, y1: 920 },
];

const CELL = 0.08; // metres of ground per cell of the rectified map
const MIN_SAMPLES = 4; // readings a cell needs before it is a reading
const BAND = { lo: 7.5, hi: 13.5 }; // metres from the eye: the stretch worth asking about
const HALF = 0.55; // of the half width — inside the reach of the grass either side
const GRASS = 0.010; // linear green over the mean of red and blue: a blade, not a slab

// What the walker, the interface and everything from the bottom step up cover.
// A cell over any of them is a cell of something that is not paving.
const MASK = [
  { x0: 598, y0: 560, x1: 742, y1: 941 },
  { x0: 770, y0: 862, x1: 920, y1: 912 },
  { x0: 0, y0: 0, x1: FRAME.width, y1: 655 },
];
const masked = (px, py) => MASK.some((m) => px >= m.x0 && px < m.x1 && py >= m.y0 && py < m.y1);

const Y = [0.2126, 0.7152, 0.0722];

function linear(image, px, py) {
  const o = (py * image.width + px) * image.channels;
  return [srgbToLinear(image.data[o] / 255), srgbToLinear(image.data[o + 1] / 255),
    srgbToLinear(image.data[o + 2] / 255)];
}

const luminance = (rgb) => Y[0] * rgb[0] + Y[1] * rgb[1] + Y[2] * rgb[2];

/**
 * The pixels of the frame that are paving, traced once.
 *
 * WHICH ONES ARE PAVING IS DECIDED ON THE REFERENCE, for every frame. A render
 * whose verge is a different green from the photograph's would otherwise be read
 * over a different piece of ground, and the difference in the answer would be
 * the difference in the choice. So the reference names the pixels and every
 * frame is read at those same pixels.
 */
export function traceField(target) {
  const ray = makeRay();
  const cells = [];
  for (let py = 655; py < FRAME.height; py++) {
    for (let px = 0; px < FRAME.width; px++) {
      if (masked(px, py)) continue;
      const hit = traceGround(ray(px, py));
      if (!hit) continue;
      if (pathRun(hit.z) < 0.999) continue;
      if (hit.distance < BAND.lo || hit.distance >= BAND.hi) continue;
      if (Math.abs(pathCoord(hit.x, hit.z)) >= HALF) continue;
      const rgb = linear(target, px, py);
      if (rgb[1] - (rgb[0] + rgb[2]) / 2 >= GRASS) continue;
      cells.push({ px, py, x: hit.x, z: hit.z, distance: hit.distance });
    }
  }
  return { cells };
}

/**
 * The pixels of the NEAR paving, with each one's neighbours and the world
 * distance to them.
 *
 * Gathered once: every frame is read at the same pixels, so the geometry is
 * paid for a single time and the three sets of weights with it.
 */
export function gritField(target) {
  const ray = makeRay();
  const inMask = (px, py) => GRIT_MASK.some((m) => px >= m.x0 && px < m.x1
    && py >= m.y0 && py < m.y1);
  const cells = [];
  for (let py = 780; py < FRAME.height; py++) {
    for (let px = 0; px < FRAME.width; px++) {
      if (inMask(px, py)) continue;
      const hit = traceGround(ray(px, py));
      if (!hit) continue;
      if (pathRun(hit.z) < 0.999) continue;
      if (hit.distance < GRIT.lo || hit.distance >= GRIT.hi) continue;
      if (Math.abs(pathCoord(hit.x, hit.z)) >= GRIT_HALF) continue;
      const rgb = linear(target, px, py);
      if (rgb[1] - (rgb[0] + rgb[2]) / 2 >= GRASS) continue;
      cells.push({
        px, py, x: hit.x, z: hit.z, distance: hit.distance,
      });
    }
  }
  return gritWeights(cells);
}

/**
 * The neighbours and the three sets of weights, given the traced cells.
 *
 * Kept apart from the march for the reason closeRenderGeometry is: which pixels
 * are paving and where they land depends on the HEIGHT FIELD, which a coat of
 * paint does not change, so a tool that is trying twenty coats can trace once and
 * cache the answer. This half is arithmetic and costs nothing.
 */
export function gritWeights(cells) {
  const at = new Map();
  cells.forEach((c, i) => at.set(c.py * FRAME.width + c.px, i));
  for (const c of cells) {
    c.near = [];
    for (let dy = -GRIT_WINDOW.y; dy <= GRIT_WINDOW.y; dy++) {
      for (let dx = -GRIT_WINDOW.x; dx <= GRIT_WINDOW.x; dx++) {
        const i = at.get((c.py + dy) * FRAME.width + (c.px + dx));
        if (i === undefined) continue;
        const o = cells[i];
        c.near.push([i, (o.x - c.x) ** 2 + (o.z - c.z) ** 2]);
      }
    }
    c.weight = GRIT_SIGMA.map((s) => c.near.map(([, d2]) => Math.exp(-d2 / (2 * s * s))));
  }
  return cells;
}

/** How much of the near paving lives at centimetres, and how much at decimetres. */
export function gritBands(image, cells, keep = () => true) {
  const v = cells.map((c) => luminance(linear(image, c.px, c.py)));
  const smooth = [0, 1, 2].map((k) => cells.map((c) => {
    let s = 0;
    let w = 0;
    c.near.forEach(([i], j) => { s += v[i] * c.weight[k][j]; w += c.weight[k][j]; });
    return s / w;
  }));
  let grit = 0;
  let coarse = 0;
  let n = 0;
  for (let i = 0; i < v.length; i++) {
    if (smooth[2][i] <= 0 || !keep(cells[i])) continue;
    grit += ((smooth[0][i] - smooth[1][i]) / smooth[2][i]) ** 2;
    coarse += ((smooth[1][i] - smooth[2][i]) / smooth[2][i]) ** 2;
    n++;
  }
  return { grit: Math.sqrt(grit / n), coarse: Math.sqrt(coarse / n), n };
}

/** The strip laid flat: mean luminance per square of CELL metres, and the holes. */
export function rectify(image, field) {
  const { cells } = field;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const c of cells) {
    if (c.x < x0) x0 = c.x;
    if (c.x > x1) x1 = c.x;
    if (c.z < z0) z0 = c.z;
    if (c.z > z1) z1 = c.z;
  }
  const w = Math.ceil((x1 - x0) / CELL) + 1;
  const h = Math.ceil((z1 - z0) / CELL) + 1;
  const sum = new Float64Array(w * h);
  const count = new Float64Array(w * h);
  for (const c of cells) {
    const i = Math.floor((c.z - z0) / CELL) * w + Math.floor((c.x - x0) / CELL);
    sum[i] += luminance(linear(image, c.px, c.py));
    count[i] += 1;
  }
  const value = new Float64Array(w * h);
  const valid = new Uint8Array(w * h);
  // Four readings at least. A cell holding one pixel deviates from its
  // neighbours by the sensor and by the tracing, and both would be counted here
  // as grain in the stone.
  for (let i = 0; i < w * h; i++) {
    if (count[i] >= MIN_SAMPLES) { value[i] = sum[i] / count[i]; valid[i] = 1; }
  }
  return { w, h, value, valid };
}

/** Separable box mean over the valid cells only, radius in cells. */
function blur(map, radius) {
  const { w, h, value, valid } = map;
  const rowSum = new Float64Array(w * h);
  const rowCount = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= w) continue;
        const i = y * w + xx;
        if (valid[i]) { s += value[i]; n++; }
      }
      rowSum[y * w + x] = s;
      rowCount[y * w + x] = n;
    }
  }
  const out = new Float64Array(w * h);
  const on = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= h) continue;
        s += rowSum[yy * w + x];
        n += rowCount[yy * w + x];
      }
      if (n > 0) { out[y * w + x] = s / n; on[y * w + x] = 1; }
    }
  }
  return { w, h, value: out, valid: on };
}

/**
 * The five numbers that describe a paving.
 *
 * `joint` is the areal fraction of the strip sitting more than a tenth below its
 * own surroundings, and `depth` how far below those cells are: together, how
 * much dark line there is and how hard it cuts.
 *
 * `pitch` is the mean distance in metres between one dark cell and the next
 * walking up the strip — the size of whatever lies between the lines.
 *
 * `rms` is the whole relative deviation left at this band of scales, and `grain`
 * the part of it finer than a quarter metre: the grit and the mottling of the
 * stone itself, which a flat fill between joints does not have at all.
 */
export function statistic(map) {
  const coarse = blur(map, Math.round(0.30 / CELL));
  const fine = blur(map, 1);
  const { w, h, value, valid } = map;
  const relative = new Float64Array(w * h);
  const usable = new Uint8Array(w * h);
  let n = 0;
  let dark = 0;
  let depth = 0;
  let rms = 0;
  let grain = 0;
  for (let i = 0; i < w * h; i++) {
    if (!valid[i] || !coarse.valid[i] || coarse.value[i] <= 0) continue;
    usable[i] = 1;
    relative[i] = value[i] / coarse.value[i] - 1;
    const g = (value[i] - fine.value[i]) / coarse.value[i];
    n++;
    rms += relative[i] * relative[i];
    grain += g * g;
    if (relative[i] < -0.10) { dark++; depth += -relative[i]; }
  }

  let seen = 0;
  let crossings = 0;
  for (let x = 0; x < w; x++) {
    let was = false;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (!usable[i]) { was = false; continue; }
      seen++;
      const is = relative[i] < -0.10;
      if (is && !was) crossings++;
      was = is;
    }
  }

  return {
    n,
    joint: n ? dark / n : 0,
    depth: dark ? depth / dark : 0,
    rms: n ? Math.sqrt(rms / n) : 0,
    grain: n ? Math.sqrt(grain / n) : 0,
    pitch: crossings ? seen * CELL / crossings : Infinity,
  };
}

// How far each number may sit from the reference's own.
//
// EVERY ONE OF THESE IS ABOUT THREE TIMES THE SCATTER THE REFERENCE SHOWS
// AGAINST ITSELF. Split the photograph's own strip in half by distance and
// measure the two halves apart — `--self` prints exactly that — and one paving,
// differently lit and differently far away, answers within 1.3 points of joint,
// 2.4 of depth, 1.7 of rms, 0.4 of grain and a factor of 1.07 on pitch. Nothing
// tighter than three times that would be measuring the paving; nothing looser
// would be measuring anything.
export const TOLERANCE = {
  joint: 0.040,
  depth: 0.070,
  rms: 0.050,
  grain: 0.015,
  pitch: 1.60,
};

// The centimetre band answers the same way: the reference's near half and its
// far half read 8.88% and 9.26%, so 0.38 points is what one paving costs, and
// three times it is what may be spent. The decimetre band beside it is printed
// and not held: it straddles the edge of the shadow the reference's near stretch
// lies in, and the two halves of the reference disagree about it by three
// points on their own.
export const TOLERANCE_GRIT = 0.0115;

// ============================================================ THE CLOSE READ
//
// AND A SECOND REFERENCE, BECAUSE THE FIRST ONE CANNOT ANSWER THE QUESTION.
//
// target.png is a photograph of a composition: at the reference pose its nearest
// paving is six metres off, where a centimetre of grit is a fraction of a pixel.
// Everything above is therefore an honest account of a surface seen from six
// metres, and it stays exactly that. What it cannot say is what the path is made
// of when it is under the walker's feet — and that is the half the committente
// judges, so it needs its own reference: sentiero-target.png, a close view of
// the same kind of path, and the criterion for the MATERIAL.
//
// THE ONE COORDINATE BOTH FRAMES HAVE. The close reference has no camera and no
// height field, so nothing in it can be stated in metres without inventing a
// focal length, and an invented focal length would silently set the size of
// every slab painted to match it. What it does have, on every row, is the two
// edges of its own path — and so does a render, exactly, out of pathEdge. So
// every reading below is taken ALONG A ROW, in units of the path's own width: u
// runs -1 at the left edge to +1 at the right one. Across is also the one
// direction that needs no focal length even when there is one: a slab is
// foreshortened down the frame and is not foreshortened across it.
//
// Which is the form the answer is wanted in anyway. "One to three slabs to cover
// the width" is a statement about the ratio between the paving and the path, and
// a ratio is what survives having no camera.
//
// AND ONLY WHERE THE PAVING IS RESOLVED THE SAME. Rows are kept, on both frames
// alike, when the path is between CLOSE_RESOLVED.lo and .hi pixels across, and
// their samples are then averaged onto one common u grid. A band picked by
// DISTANCE would compare a photograph taken from two metres against a render
// taken from eight and call the difference material.

export const CLOSE_REFERENCE = join(REPO_ROOT, 'sentiero-target.png');

/**
 * The pose the close render has to be shot at.
 *
 * Cut to the close reference's own framing rather than chosen: its horizon sits
 * near row 55 of 1086 and its vertical field is about thirty degrees, which is
 * an eye tilted some thirteen degrees down. Standing on the path at eight metres
 * with those two numbers puts the same amount of paving in the frame at the same
 * foreshortening, so a row of one is a row of the other — which is what lets the
 * two be read by one measure.
 */
export const CLOSE_POSE = { x: 0, y: EYE_HEIGHT, z: 8, yaw: 0, pitch: -13, fov: 30 };

const CLOSE_DU = 0.005;                        // 400 samples across the width
const CLOSE_RESOLVED = { lo: 560, hi: 1150 };  // pixels across the path
const CLOSE_PAN = [0.00, 0.75];                // the pan of the path, in u
const CLOSE_VERGE = [0.45, 0.98];              // where it breaks up towards the grass
const DEG = Math.PI / 180;

export async function readImage(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: 3, data };
}

const linearAt = (img, px, py) => {
  const o = (py * img.width + px) * img.channels;
  return [srgbToLinear(img.data[o] / 255), srgbToLinear(img.data[o + 1] / 255),
    srgbToLinear(img.data[o + 2] / 255)];
};

// A BLADE AGAINST A SLAB, AND WHY THE TEST IS A RATIO HERE.
//
// Everything above names its pixels on the reference and reads every frame at
// those same pixels, so the test never has to work on two different pigments.
// The close read cannot do that — the two frames are not the same framing and
// there is no correspondence between their pixels — so the same test has to
// decide on both, and an ABSOLUTE excess of green does not: measured, this
// world's slabs carry 12% of green over their own luminance and the close
// reference's carry -2%, so a fixed threshold that keeps all of the
// photograph's paving throws away HALF of the render's. What comes back is then
// the less green half of the stone, and the reading would be a reading of the
// pigment rather than of the pattern.
//
// So the excess is taken over the luminance, where a slab of either world sits
// under a quarter and a blade of either sits over a half.
const GRASS_RELATIVE = 0.40;
const isGrass = (img, px, py) => {
  const c = linearAt(img, px, py);
  const y = Y[0] * c[0] + Y[1] * c[1] + Y[2] * c[2];
  return c[1] - (c[0] + c[2]) / 2 >= GRASS_RELATIVE * (y || 1e-6);
};

/** A row's samples averaged onto the common u grid. */
function binRow(samples) {
  const n = Math.round(2 / CLOSE_DU);
  const sum = new Float64Array(n);
  const count = new Float64Array(n);
  for (const [u, v] of samples) {
    const i = Math.floor((u + 1) / CLOSE_DU);
    if (i < 0 || i >= n) continue;
    sum[i] += v; count[i] += 1;
  }
  const out = new Array(n).fill(null);
  for (let i = 0; i < n; i++) if (count[i] > 0) out[i] = sum[i] / count[i];
  return out;
}

/**
 * The close reference's own two verges, row by row.
 *
 * Walked outwards from the middle of the row before, because the path bends and
 * a fixed column leaves it. The walk stops when eight of the last ten pixels are
 * grass, so a tuft leaning on the stone or a patch of moss does not end the path
 * early, and the ten pixels of run-up are given back.
 */
function closeReferenceRows(img) {
  const rows = [];
  let cx = Math.round(img.width / 2);
  for (let py = img.height - 1; py >= 120; py--) {
    const found = [];
    for (const dir of [-1, 1]) {
      let hits = 0;
      const ring = [];
      let x = cx;
      for (; x > 2 && x < img.width - 3; x += dir) {
        const g = isGrass(img, x, py) ? 1 : 0;
        ring.push(g); hits += g;
        if (ring.length > 10) hits -= ring.shift();
        if (ring.length === 10 && hits >= 8) break;
      }
      found.push(x - dir * 9);
    }
    const [l, r] = found;
    if (r - l < 30) continue;
    cx = Math.round((l + r) / 2);
    rows.push({ py, l, r, width: r - l, cx });
  }
  return rows.reverse();
}

export function closeReferenceLines(img) {
  const lines = [];
  for (const r of closeReferenceRows(img)) {
    if (r.width < CLOSE_RESOLVED.lo || r.width > CLOSE_RESOLVED.hi) continue;
    const half = r.width / 2;
    const samples = [];
    for (let px = r.l; px <= r.r; px++) {
      if (isGrass(img, px, r.py)) continue;
      samples.push([(px - r.cx) / half, luminance(linearAt(img, px, r.py))]);
    }
    if (samples.length > CLOSE_RESOLVED.lo * 0.6) {
      lines.push({ py: r.py, cells: binRow(samples), across: r.width });
    }
  }
  return lines;
}

/** Screen pixel to world direction for an arbitrary pose. */
function poseRay(pose, width, height) {
  const tanV = Math.tan(pose.fov * DEG / 2);
  const tanH = tanV * (width / height);
  const cp = Math.cos(pose.pitch * DEG); const sp = Math.sin(pose.pitch * DEG);
  const cy = Math.cos(pose.yaw * DEG); const sy = Math.sin(pose.yaw * DEG);
  return (px, py) => {
    const x = ((px + 0.5) / width * 2 - 1) * tanH;
    const y = (1 - (py + 0.5) / height * 2) * tanV;
    const y1 = y * cp + sp;
    const z1 = y * sp - cp;
    const x2 = x * cy + z1 * sy;
    const z2 = -x * sy + z1 * cy;
    const l = Math.hypot(x2, y1, z2);
    return [x2 / l, y1 / l, z2 / l];
  };
}

/**
 * The ground under a ray from an arbitrary eye.
 *
 * probe.mjs owns the one that starts at the spawn, and it is the right one for
 * everything read at the reference pose; this walk is the same march from
 * somewhere else, which the close pose needs and which is not probe's business.
 */
function traceFrom(eye, d, maxDistance = 120) {
  let t = 0.05;
  while (t < maxDistance) {
    const nt = t + Math.max(0.02, t * 0.02);
    if (eye.y + d[1] * nt <= heightAt(eye.x + d[0] * nt, eye.z + d[2] * nt)) {
      let lo = t; let hi = nt;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        if (eye.y + d[1] * mid <= heightAt(eye.x + d[0] * mid, eye.z + d[2] * mid)) hi = mid;
        else lo = mid;
      }
      const distance = (lo + hi) / 2;
      return { x: eye.x + d[0] * distance, z: eye.z + d[2] * distance, distance };
    }
    t = nt;
  }
  return null;
}

/**
 * Which pixel of the close frame is where across the path — the march, alone.
 *
 * Kept apart from the reading because it depends only on the height field, which
 * is not what a coat of paint changes: a tool that is tuning one wants to pay
 * for this once and then ask the same question of twenty attempts.
 */
export function closeRenderGeometry(width, height, pose = CLOSE_POSE) {
  const ray = poseRay(pose, width, height);
  const eye = { x: pose.x, y: pose.y, z: pose.z };
  const rows = [];
  for (let py = 0; py < height; py++) {
    const columns = [];
    const at = [];
    let lo = null; let hi = null;
    for (let px = 0; px < width; px++) {
      const hit = traceFrom(eye, ray(px, py));
      if (!hit || pathRun(hit.z) < 0.999) continue;
      const u = pathCoord(hit.x, hit.z);
      if (Math.abs(u) >= 1) continue;
      if (lo === null) lo = px;
      hi = px;
      columns.push(px);
      at.push(u);
    }
    const across = lo === null ? 0 : hi - lo + 1;
    if (across < CLOSE_RESOLVED.lo || across > CLOSE_RESOLVED.hi) continue;
    rows.push({ py, across, columns, at });
  }
  return rows;
}

export function closeRenderLines(img, geometry = closeRenderGeometry(img.width, img.height)) {
  const lines = [];
  for (const row of geometry) {
    const samples = [];
    for (let i = 0; i < row.columns.length; i++) {
      const px = row.columns[i];
      if (isGrass(img, px, row.py)) continue;
      samples.push([row.at[i], luminance(linearAt(img, px, row.py))]);
    }
    if (samples.length < CLOSE_RESOLVED.lo * 0.6) continue;
    lines.push({ py: row.py, cells: binRow(samples), across: row.across });
  }
  return lines;
}

/** Moving average over the valid cells of a row, radius in path widths. */
function along(cells, widths) {
  const r = Math.max(1, Math.round(widths * 2 / CLOSE_DU));
  const out = new Array(cells.length).fill(null);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === null) continue;
    let s = 0; let n = 0;
    for (let k = -r; k <= r; k++) {
      const c = cells[i + k];
      if (c === undefined || c === null) continue;
      s += c; n++;
    }
    if (n >= r) out[i] = s / n;
  }
  return out;
}

const inBand = (i, band) => {
  const u = Math.abs(-1 + (i + 0.5) * CLOSE_DU);
  return u >= band[0] && u <= band[1];
};

/**
 * HOW MUCH OF THE TONE CHANGE HAPPENS AT EDGES.
 *
 * A pan of slabs and a field of mottle carry the same deviation at the same band
 * of scales and look nothing alike, and this is the difference between them: the
 * slabs put their change in a few places and hold still between them, so the
 * surface reads as PIECES. Mottle spreads the same change evenly and reads as
 * one thing that happens to vary.
 *
 * So the slab band is taken — everything between three hundredths of the width
 * and half of it — its gradient with it, and the answer is what share of the
 * total variation the steepest tenth of the samples carries. A perfectly smooth
 * field answers a tenth of it by definition; the close reference answers a third.
 *
 * It is not an amplitude and cannot be reached by turning one up: the same paint
 * with twice the contrast answers the same number. What moves it is whether the
 * boundaries are boundaries.
 */
function edgeShare(lines, { fine = 0.03, wide = 0.50, step = 0.02, band = CLOSE_PAN } = {}) {
  const all = [];
  for (const L of lines) {
    const f = along(L.cells, fine);
    const b = along(L.cells, wide);
    const k = Math.max(1, Math.round(step * 2 / CLOSE_DU));
    for (let i = 0; i + k < f.length; i++) {
      if (f[i] === null || f[i + k] === null || b[i] === null || b[i] <= 0) continue;
      if (!inBand(i, band) || !inBand(i + k, band)) continue;
      all.push(Math.abs(f[i + k] - f[i]) / b[i]);
    }
  }
  if (all.length < 100) return 0;
  const total = all.reduce((t, x) => t + x, 0);
  all.sort((a, b2) => b2 - a);
  return all.slice(0, Math.round(all.length / 10)).reduce((t, x) => t + x, 0) / total;
}

/**
 * STONES SITTING IN THE SURFACE, COUNTED ONE BY ONE.
 *
 * Not the same question as the centimetre band above, and this is why it is a
 * separate reading: grit is a STATISTIC and answers with an amplitude, whereas
 * what the close reference shows between and beside its slabs are OBJECTS — a
 * pebble one to six centimetres across, a lit cap, and a dark foot where it
 * meets the ground. A surface can carry exactly the right amount of fine energy
 * and no pebbles at all, and that is what this world carries today.
 *
 * So a pebble is counted rather than measured: a run brighter than its
 * surroundings, of the right width, with the surface going as far DOWN as the
 * cap went up within a fiftieth of the width on both sides of it. The foot is
 * the half that matters — it is what makes a stone read as embedded rather than
 * as a bright fleck of paint — and asking for it on both sides is what keeps a
 * patch of light out of the count.
 *
 * Answered per path width of row walked, so it is a density and not a total.
 */
function pebbles(lines, { fine = 0.006, wide = 0.045, rise = 0.055, lo = 0.005, hi = 0.045,
  band = CLOSE_VERGE } = {}) {
  let caps = 0;
  let span = 0;
  const sizes = [];
  const reach = Math.max(2, Math.round(0.02 * 2 / CLOSE_DU));
  for (const L of lines) {
    const f = along(L.cells, fine);
    const b = along(L.cells, wide);
    const r = f.map((x, i) => (x === null || b[i] === null || b[i] <= 0 || !inBand(i, band)
      ? null : x / b[i] - 1));
    for (let i = 0; i < r.length; i++) if (r[i] !== null) span += CLOSE_DU / 2;
    let i = 0;
    while (i < r.length) {
      if (r[i] === null || r[i] <= rise) { i++; continue; }
      let k = i;
      while (k < r.length && r[k] !== null && r[k] > rise) k++;
      const w = (k - i) * CLOSE_DU / 2;
      let left = 0; let right = 0;
      for (let q = 1; q <= reach; q++) {
        if (r[i - q] != null) left = Math.min(left, r[i - q]);
        if (r[k + q] != null) right = Math.min(right, r[k + q]);
      }
      if (w >= lo && w <= hi && left < -rise && right < -rise) { caps++; sizes.push(w); }
      i = k + 1;
    }
  }
  sizes.sort((a, b2) => a - b2);
  return {
    density: span ? caps / span : 0,
    size: sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0,
  };
}

/** Narrow dark runs across a row: how much joint there is, how wide, how deep. */
function seams(lines, { fine = 0.015, wide = 0.10, drop = 0.10, maxWidth = 0.08,
  band = CLOSE_PAN } = {}) {
  let seam = 0;
  let total = 0;
  let depth = 0;
  let deep = 0;
  const widths = [];
  for (const L of lines) {
    const f = along(L.cells, fine);
    const b = along(L.cells, wide);
    const r = f.map((x, i) => (x === null || b[i] === null || b[i] <= 0 || !inBand(i, band)
      ? null : x / b[i] - 1));
    let i = 0;
    while (i < r.length) {
      if (r[i] === null) { i++; continue; }
      if (r[i] >= -drop) { total++; i++; continue; }
      let k = i;
      let lowest = 0;
      while (k < r.length && r[k] !== null && r[k] < -drop) { lowest = Math.min(lowest, r[k]); k++; }
      total += k - i;
      if ((k - i) * CLOSE_DU / 2 <= maxWidth) {
        seam += k - i;
        widths.push((k - i) * CLOSE_DU / 2);
        depth += -lowest; deep++;
      }
      i = k;
    }
  }
  widths.sort((a, b2) => a - b2);
  return {
    fraction: total ? seam / total : 0,
    width: widths.length ? widths[Math.floor(widths.length / 2)] : 0,
    depth: deep ? depth / deep : 0,
  };
}

// HOW FAR THE BODY OF THE PATH HOLDS TOGETHER, IN CENTIMETRES.
//
// Everything above answers with an amplitude or a count, and there is a defect
// neither of them can see. Measured on a delivered frame: the body of this
// ground carried LESS power than the photograph's at every wavelength the eye
// can still resolve from a metre, and the same stones per path width, and the
// eye threw it out all the same — what it was carrying was a bed of cells with
// one crest and one trough each, spread over a surface that a photograph shows
// smooth, and neither a power nor a count knows the difference between a bed and
// a surface.
//
// What does know is HOW FAR TWO POINTS HAVE TO BE APART BEFORE THEY STOP
// AGREEING. Take the same relative profile the counter works on, along a row,
// inside the body band; correlate it with itself at every shift; and report the
// shift at which the correlation crosses zero, in centimetres of a two metre
// path. A surface worn by weather is fine and irregular and lets go quickly; a
// bed of pieces, however faint, holds its sign across a whole piece.
//
// IT IS PRINTED AND NOT SPENT, and that is deliberate. The photograph answers
// 2.88 cm, and it answers it so steadily that there is no room to argue with:
// its near half and its far half say 2.89 and 2.87, its odd and even rows 2.88
// and 2.88 — a floor of two hundredths of a centimetre, where every other close
// reading has a floor of tenths. This ground answers 3.37 and answered 3.29
// before, twenty times that floor away in both cases, and no coat of paint on
// the repeating tile moves it: the finest bed the tile can hold is already below
// what the frame resolves at this pose (measured, a bed of half-centimetre chips
// added to it moved this by nought). What is too smooth at that scale is the
// ATLAS, and the atlas is a bake away. So the reading is delivered, with its
// number, for the unit that has that bake in hand.
const BODY_LAGS = [2, 3, 4, 5, 6, 7, 8, 10, 12, 14];

function bodyGrain(lines, band = [0.02, 0.45]) {
  const num = BODY_LAGS.map(() => 0);
  const den = BODY_LAGS.map(() => 0);
  for (const L of lines) {
    const f = along(L.cells, 0.006);
    const b = along(L.cells, 0.045);
    const r = f.map((x, i) => (x === null || b[i] === null || b[i] <= 0 || !inBand(i, band)
      ? null : x / b[i] - 1));
    for (let k = 0; k < BODY_LAGS.length; k++) {
      for (let i = 0; i + BODY_LAGS[k] < r.length; i++) {
        if (r[i] === null || r[i + BODY_LAGS[k]] === null) continue;
        num[k] += r[i] * r[i + BODY_LAGS[k]];
        // Both ends of the pair, so a shift that runs off the end of a row
        // cannot make the correlation look larger than it is.
        den[k] += (r[i] * r[i] + r[i + BODY_LAGS[k]] * r[i + BODY_LAGS[k]]) / 2;
      }
    }
  }
  const c = BODY_LAGS.map((_, k) => (den[k] ? num[k] / den[k] : 0));
  for (let k = 1; k < BODY_LAGS.length; k++) {
    if (c[k - 1] > 0 && c[k] <= 0) {
      const t = c[k - 1] / (c[k - 1] - c[k]);
      return (BODY_LAGS[k - 1] + t * (BODY_LAGS[k] - BODY_LAGS[k - 1])) * CLOSE_DU * 100;
    }
  }
  return 0;
}

// HOW FAR APART THE BIGGEST STONES AND THE MIDDLING ONES ARE.
//
// The counter above answers HOW MANY stones there are per path width and how
// wide the middling one is, and it is blind to the thing the eye threw the
// gravel out for. Measured: a bed of pieces all one size, laid at the
// photograph's own density, answers the photograph's count to within a fifth of
// a stone and its median width exactly — and reads, from above, as reptile skin.
// What the photograph has and that bed has not is a RANGE: big stones lying
// sparse in a bed of small dense ones. A count cannot say that and neither can
// a median.
//
// SO THE PIECES ARE MEASURED AS SHAPES. Every row is already rectified onto the
// path's own width, so stacking the rows gives a picture of the paving whose
// across ruler is the path and whose down ruler is the frame; the bright set of
// that picture is broken into connected pieces and each piece's AREA is taken.
//
// AND THE ANSWER IS A RATIO, WHICH IS WHAT SURVIVES HAVING NO CAMERA. An area
// in that picture is an area of ground times a factor that belongs to the frame
// — how far away the row is, how much the run is foreshortened there — and
// neither frame can state that factor. A ratio between two areas measured in the
// SAME rows does not need it: whatever the factor is, it cancels. So each piece
// is divided by the middling piece of its own block of rows, and what is
// reported is the ninetieth percentile of that: the big stone against the
// ordinary one. The photograph answers twelve.
//
// The block is sixty rows, and the evidence that sixty is short enough for the
// frame's own scale to be treated as constant inside it is in --self: split the
// reference into quarters and read alternate quarters apart, which is the split
// that keeps whole blocks, and the two answer within three tenths of a point.
const PIECE_BLOCK = 60;
const PIECE_RISE = 0.055; // the same crest the counter uses
const PIECE_LEAST = 12;   // pieces a block needs before its middling one is one
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function pieces(lines, band = CLOSE_VERGE) {
  const rows = lines.map((L) => {
    const f = along(L.cells, 0.006);
    const b = along(L.cells, 0.045);
    return f.map((x, i) => (x === null || b[i] === null || b[i] <= 0 || !inBand(i, band)
      ? null : x / b[i] - 1));
  });
  if (!rows.length) return 0;
  const h = rows.length;
  const w = rows[0].length;
  const lit = (y, x) => rows[y][x] !== null && rows[y][x] > PIECE_RISE;
  const seen = new Uint8Array(h * w);
  const blocks = new Map();
  const stack = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (seen[y * w + x] || !lit(y, x)) continue;
      stack.length = 0;
      stack.push(y * w + x);
      seen[y * w + x] = 1;
      let n = 0;
      let top = y;
      let foot = y;
      while (stack.length) {
        const at = stack.pop();
        const cy = Math.floor(at / w);
        const cx = at - cy * w;
        n++;
        if (cy < top) top = cy;
        if (cy > foot) foot = cy;
        for (const [dy, dx] of NEIGHBOURS) {
          const ny = cy + dy;
          const nx = cx + dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
          const i = ny * w + nx;
          if (seen[i] || !lit(ny, nx)) continue;
          seen[i] = 1;
          stack.push(i);
        }
      }
      // Filed under the block its middle falls in, so a piece that straddles a
      // boundary is counted once and against one middling stone.
      const k = Math.floor((top + foot) / 2 / PIECE_BLOCK);
      if (!blocks.has(k)) blocks.set(k, []);
      blocks.get(k).push(n);
    }
  }
  const scaled = [];
  for (const list of blocks.values()) {
    if (list.length < PIECE_LEAST) continue;
    const sorted = [...list].sort((a, b) => a - b);
    const middling = sorted[Math.floor(sorted.length / 2)];
    if (middling <= 0) continue;
    for (const n of list) scaled.push(n / middling);
  }
  if (!scaled.length) return 0;
  scaled.sort((a, b) => a - b);
  return scaled[Math.min(scaled.length - 1, Math.floor(scaled.length * 0.90))];
}

/**
 * HOW MUCH OF THE PATH'S OWN EDGE THE GREEN STANDS OVER.
 *
 * The committente's reading of 2026-08-26 names three things and this is the
 * third: "the path is irregular in its SHAPE as well — at the sides the grass and
 * the moss often stand OVER it". A verge like that is not a line and it is not a
 * band either: walking outwards from the middle of a row, the first green arrives
 * BEFORE the last stone, because there are tongues of turf lying across the
 * outermost stone with lit stone showing between and beyond them.
 *
 * So that is exactly what is counted. Out from the middle, on both sides of every
 * row: where does green first appear, and where is the last pixel that is not
 * green? In a strip with a ruled edge — however ragged that edge is drawn — the
 * two are the same place and the answer is nought, which is the point: this is
 * blind to how wiggly the boundary is and sees only whether the two materials
 * INTERLEAVE. `over` is the share of verges where they do; `lobe` is how deep the
 * interleaving runs, in units of the half width, at the median.
 *
 * Measured on the close reference: 93.7% of its verges, 7.5% of the half width
 * deep at the median and 21.7% at the ninetieth.
 */
export function overhangOf(img, rows) {
  let touched = 0;
  let n = 0;
  const depths = [];
  for (const r of rows) {
    if (r.width < CLOSE_RESOLVED.lo || r.width > CLOSE_RESOLVED.hi) continue;
    const half = r.width / 2;
    for (const dir of [-1, 1]) {
      const reach = Math.round(Math.abs((dir < 0 ? r.l : r.r) - r.cx) + 0.06 * half);
      let firstGreen = null;
      let lastStone = null;
      for (let k = 0; k <= reach; k++) {
        const px = r.cx + dir * k;
        if (px < 1 || px >= img.width - 1) break;
        if (isGrass(img, px, r.py)) {
          if (firstGreen === null) firstGreen = k;
        } else lastStone = k;
      }
      if (firstGreen === null || lastStone === null) continue;
      n++;
      // A twentieth of a per cent of the half width is a pixel, and a single
      // pixel of green inboard of a single pixel of stone is anti-aliasing.
      const d = (lastStone - firstGreen) / half;
      if (d > 0.005) { touched++; depths.push(d); }
    }
  }
  depths.sort((a, b) => a - b);
  return {
    over: n ? touched / n : 0,
    lobe: depths.length ? depths[Math.floor(depths.length / 2)] : 0,
    lobeP90: depths.length ? depths[Math.floor(depths.length * 0.90)] : 0,
    verges: n,
  };
}

/** The rows of a close render, in the shape overhangOf reads. */
export function closeRenderRows(geometry) {
  return geometry.map((row) => {
    const l = row.columns[0];
    const r = row.columns.at(-1);
    return { py: row.py, l, r, width: r - l, cx: Math.round((l + r) / 2) };
  });
}

export { closeReferenceRows };

export function closeStatistic(lines, edges = null) {
  return {
    ...(edges || { over: 0, lobe: 0, lobeP90: 0, verges: 0 }),
    edge: edgeShare(lines),
    pan: pebbles(lines, { band: [0.02, 0.45] }),
    verge: pebbles(lines, { band: CLOSE_VERGE }),
    big: pieces(lines),
    seam: seams(lines),
    body: bodyGrain(lines),
    lines: lines.length,
    across: lines.length ? lines.reduce((t, l) => t + l.across, 0) / lines.length : 0,
  };
}

// How far each of the three may sit from the close reference's own.
//
// THREE TIMES WHAT ONE PAVING COSTS, on the same rule as the five above, and the
// scatter is taken over TWO splits rather than one: the reference's near half
// against its far half, which is the split the tool already uses, and interleaved
// rows, which share both distance and material and so give the floor below which
// a difference is only sampling. The larger of the two sets the tolerance, so a
// reading whose halves happen to agree to a twentieth of a point cannot mint an
// impossible tolerance out of a coincidence.
//
// The four quarters are printed by --self as well, and are deliberately NOT used:
// they disagree by a great deal more, because the near quarter of the reference
// is a broken apron of pebbles and the far one is an unbroken pan. That spread is
// the material varying down the path, which is a thing to REPRODUCE and not an
// allowance to spend.
// Measured: the split by distance answers 0.61 points of edge, 1.52 stones per
// width in the pan and 0.06 at the verge; the interleaved rows answer 0.05, 0.26
// and 0.15. Three times the larger of each pair is what may be spent.
//
// AND THE SPREAD OF THE PIECES IS HELD ON THE SAME RULE, with a third split
// beside the two. The reference's near half against its far half answers 0.78 of
// a point (13.11 against 12.33), the interleaved rows 0.53 (8.80 against 9.33)
// and alternate quarters 0.30 (11.71 against 11.42). Three times the largest is
// 2.33.
//
// THE INTERLEAVED SPLIT IS THE ONE TO READ CAREFULLY HERE, and it is why the
// tolerance is taken from the split by distance rather than from it. Throwing
// away every other row cuts every piece in half, so that split answers a LEVEL
// of about nine where the whole reference answers twelve: the two halves still
// agree with each other, which is what a noise floor is, but they agree about a
// smaller number. The split by distance keeps whole shapes and is both the
// larger scatter and the honest level, so it sets the tolerance and the other
// two witness it.
// AND THE OVERHUNG VERGE ON THE SAME RULE. The reference's near half against its
// far half answers 0.36 points of `over` and 0.48 of `lobe`; its interleaved rows
// answer 0.36 and 0.15. Three times the larger of each pair is 1.08 and 1.44.
//
// `over` IS HELD ONE-SIDED, AND THAT IS A DECISION WITH A REASON. It is a SHARE
// and the reference sits at 91.3 of a hundred, so its scale is compressed near
// the top and three times a scatter measured there is not three times the same
// thing measured in the middle. What the reading exists to reject is a verge that
// does not interleave at all — a strip with an edge, however ragged the edge is
// drawn, which is what this ground had at 2.6. A verge that interleaves on more
// rows than the photograph's is still an interleaved verge, and `lobe` beside it
// is two-sided and is what stops the depth running away.
export const TOLERANCE_CLOSE = {
  edge: 0.0183, pan: 4.56, verge: 0.45, big: 2.33, over: 0.0108, lobe: 0.0144,
};
const ONE_SIDED_CLOSE = { over: 'above' };

// AND TWO OF THEM ARE NO LONGER TARGETS, WHICH IS A DECISION AND IS WRITTEN HERE
// RATHER THAN QUIETLY DONE.
//
// `peb-pan` and `peb-verge` count bright runs along a row of the close
// photograph and answer 12.47 and 14.45 per path width. Three units chased those
// two numbers, and the only surface that can answer them is one MADE of bright
// runs — so this path was covered, verge and body alike, in a bed of cobbles.
// The committente looked at it on 2026-08-26 and said, in his own words, that
// there are no cobbles in the target at all: there are irregular stone slabs and
// a few small stones here and there. Measured afterwards, he is right and the
// numbers were wrong: walking the stone counter's own smallest accepted size down
// from 25 mm to 10 mm on the plan reference takes the count from 198 to 4762, so
// most of what those two voices were counting on the photograph was its GRAIN.
//
// They are still read and still printed, because what they say about the SIZE and
// SEPARATION of bright things is true and a future unit may want it. They are not
// spent. What replaced them as the target is `peb` in the plan read, which counts
// stones as objects at a threshold that is shown, in --self, to refuse the grain.
//
// AND `big` GOES WITH THEM, for the reason its own note gives. It reads the SPREAD
// of the sizes of the bright pieces in the VERGE band — the band that, until the
// committente's reading, was a bed of gravel. There is no bed of gravel there any
// more: the verge is the same paving more broken, so what that voice now measures
// is the spread of the sizes of slab fragments seen through a camera at eight
// metres, which is a noisy shadow of a question the plan read answers directly
// and without a camera. `vary` is that question — the big piece against the
// ordinary one, measured as shapes from straight above, validated in both
// directions against a sheet and against a carpet — and it supersedes this. It is
// still read and still printed.
const RETIRED_CLOSE = ['peb-pan', 'peb-verge', 'big'];

// ============================================================= THE PLAN READ
//
// AND A THIRD REFERENCE, WHICH IS THE ONE THE PAINTER CAN BE HELD TO DIRECTLY.
//
// sentiero-texture.png is the same paving seen from straight above. That matters
// for one reason above all the others: it is THE SAME SPACE THE ATLAS IS PAINTED
// IN. The two readings above have to invert a camera — a slab is foreshortened
// down the frame, a stone is an ellipse on the ground and a circle on the screen,
// and every statistic has to be stated as a ratio to the path's own width because
// a photograph with no camera cannot be stated in metres. None of that is true
// here. A shape in a plan view is the shape, and the only thing that has to be
// assumed is the scale.
//
// WHAT THE COMMITTENTE READ OFF IT, WHICH IS WHAT THIS MEASURES (2026-08-26):
// "the path is IRREGULAR STONE SLABS — in thickness, in size — and a few small
// stones here and there". Both halves of that are numbers here: how big the
// pieces are and HOW UNEVENLY (`piece`, `vary`), and how few the stones are
// (`peb`). The two readings this replaces asked the opposite question and got an
// answer that drove three units into a carpet — see the note over PEB below.
//
// AND IT IS READ ON A REAL RENDER, NOT ON A MODEL OF ONE. A plan camera looks
// straight down from five and a quarter metres, which lands the ground at exactly
// PLAN_MM_PER_PX and inside the near material's own fade — so what is
// measured is the paving as the shader actually draws it, atlas and tile and all,
// with no second implementation of anything.
//
// A note on the projection that makes this exact: the ground under a camera
// looking straight down lies in a plane PERPENDICULAR to the optical axis, and
// the perspective image of such a plane is a plain uniform scale. There is no
// foreshortening to correct anywhere in the window, and a millimetre at the
// corner is the same number of pixels as a millimetre at the middle.

export const PLAN_REFERENCE = join(REPO_ROOT, 'sentiero-texture.png');

// HOW MUCH GROUND A PIXEL OF THAT PICTURE COVERS, AND WHY IT IS DECLARED.
//
// A plan view has no camera and therefore no scale of its own. It is the same
// paving as sentiero-target.png, so the scale is anchored on that picture, and it
// is anchored TWICE on two different features so that the two can be seen to
// agree rather than one of them being trusted:
//
//   - THE STONES. In the close reference the small stones caught at the lip of
//     the path run two to five centimetres, which is what paint-albedo.mjs
//     already carries as PEB_SIZE (three to six and a half). In the plan picture
//     they measure twelve to twenty pixels, which puts a pixel between 2.0 and
//     4.2 mm.
//   - THE SLABS. The close reference shows a slab covering a third to two thirds
//     of a path two metres and a bit across, so its longest run about a metre;
//     paint-albedo.mjs lays its lattice at 1.15 m on that reading. The largest
//     connected pieces of the plan picture run three hundred and forty pixels,
//     which puts a pixel at 3.0 mm.
//
// Three millimetres is taken and both anchors are within a third of it. At that
// scale the picture is 3.76 m square, which is a stretch of path a little wider
// than the path — which is what a texture of one should be.
export const PLAN_MM_PER_PX = 3.0;

// The window, in pixels of the frame, and the standing place that fills it.
//
// The height is solved from the scale and not chosen: a vertical field of thirty
// degrees over 941 rows puts 0.5695 mm of ground in a pixel per metre of height,
// so 3.0 mm a pixel is 5.268 m of it. That also lands the whole window inside the
// near material's own fade — the corner of it is 5.42 m from the eye against a
// ramp that starts at 5.3 and is not spent until 7.7 — so what the window holds
// is the paving at very nearly full strength.
//
// The window itself is 400 px = 1.20 m square, and the SIZE is a measurement and
// not a convenience. sentiero-texture.png is a picture of PAVING: there is no
// verge in it and no meadow, so a window of a render that reaches out to the
// path's own edge is not looking at the same subject. Measured
// (s3-dev7/spalla.mjs), the two agree about the joint to within three
// thousandths for the first two centimetres out from stone and part company
// entirely in the tail: at a 600 px window the reference had 4 371 pixels more
// than six centimetres from any stone and this ground had 52 702, and those were
// not joints at all — they were the verge, which margin() takes down by up to
// six tenths and which the photograph simply does not contain. At 400 px the
// window is inside |u| < 0.6 of the path at the standing place below, which is
// paving, which is what the reference is.
//
// It is also offset UP the frame to clear the interface: the game's own HUD is
// not hidden when a frame is shot, because target.png carries it.
export const PLAN_HEIGHT = 5.268;

// AND THE PLAN IS TWO PLACES, BECAUSE THE PAVING IS TWO TUNINGS.
//
// The corridor is one mechanism with two tunings — apron near the walker, the
// pale middle stretch north of the crossing — and apronAt() puts the whole of
// the first at z >= 4 and the whole of the second at z <= 0. A plan camera at
// z = 5 therefore stands in pure APRON: everything it reports is the near
// tuning, and the middle stretch, which is most of the corridor and the thing
// both targets are mostly a picture of, was never measured from above at all.
// That was declared as a residual and not a defect, because ONE pose cannot
// stand in two tunings; the answer is not to move the pose but to have two.
//
// SO THE PLAN DOES NOT MOVE, IT DOUBLES. The apron plan is exactly what it was,
// to the pixel, so that nothing already taken on it has to be taken again; the
// middle plan is new, and its window is smaller for a reason that is measured
// rather than chosen.
export const PLAN_APRON_Z = 5;
export const PLAN_MEDIO_Z = -1;

const planPose = (z) => ({
  x: pathCentreX(z),
  y: heightAt(pathCentreX(z), z) + PLAN_HEIGHT,
  z,
  yaw: 0,
  pitch: -90,
  fov: 30,
});
export const PLAN_POSE_APRON = planPose(PLAN_APRON_Z);
export const PLAN_POSE_MEDIO = planPose(PLAN_MEDIO_Z);

// Where each window sits is not a taste either: it is centred on the STONE and
// not on the frame, because the path bends and the camera stands on its middle
// at one northing only. Measured on the delivered render (s3-dev7/finestra.mjs),
// stone runs unbroken from x 552 to x 1171 on every row of the apron window's
// own rows, and the window is laid inside that with its middle on the stone's.
export const PLAN_WINDOW_APRON = { x: 661, y: 250, side: 400 };

// AND THE MIDDLE WINDOW IS 300 PX = 0.90 M BECAUSE 400 DOES NOT FIT THERE.
//
// The corridor narrows going north: 1.243 m across at z = 5 and 1.076 m at
// z = −1. Asked the stricter question — not what READS as stone in a render,
// where a slab standing out in the grass is opaque too, but what the corridor's
// own coverage fills on EVERY row a window would use — the apron window has
// 1.296 m to sit in and the middle northing has 1.155 m. A 400 px window is
// 1.200 m and does not fit; at 400 px the stone the rows share is only 374 px.
// That is the whole reason the plan had settled on the apron, and it is answered
// by taking a smaller square rather than by standing somewhere the tuning is
// mixed. Measured: v3-sentiero/fix1/finestra-medio.mjs.
//
// Its rows sit 20.5 px above the camera's own row, which is where the apron
// window's sit, so both clear the interface by the same margin; its middle
// column is 834, and it leaves 42 px of stone to the left and 43 to the right.
export const PLAN_WINDOW_MEDIO = { x: 684, y: 300, side: 300 };

// Where the joint is: below this much of the level around it, over a window wider
// than any slab. Read on a level smoothed at LEVEL_BLUR — a slab is full of grain
// and a good deal of that grain crosses any threshold on its own, so a mask taken
// pixel by pixel shreds every piece into lace, and the first cut of this found the
// interiors of the slabs instead of their shapes.
const PLAN_JOINT = -0.05;
const PLAN_LEVEL_BLUR = 8;
const PLAN_BASE_BLUR = 150;

// A STONE, AND THE THRESHOLD THAT KEEPS IT FROM BEING THE GRAIN OF THE STONE.
//
// THIS IS THE READING THAT REPLACES `peb-pan` AND `peb-verge` AS TARGETS, and
// the replacement is the whole reason this block exists. Those two count bright
// runs along a row of the close photograph and answer 12.5 and 14.5 per path
// width. Chasing them is what covered this path in gravel, because the runs they
// were counting on the reference were in large part its GRAIN, and a surface can
// only answer that many separated bright runs per width by being made of them.
// The committente looked at the result and said: there are no cobbles in the
// target, there are slabs and a few small stones. So the count is taken again,
// as OBJECTS in a plan view, with a threshold whose job is to refuse the speckle.
//
// The threshold is a length of GROUND and not a count of pixels, which is what
// makes it a bar against speckle rather than against resolution. Below
// twenty-five millimetres the count on the reference runs to thousands and what
// is circled is the grain of the stone; at twenty-five millimetres and a rise of
// 0.28 over the ground within a stone's reach, it falls to 221 over fourteen
// square metres — fifteen and a half a square metre — and every one of them is
// something the eye calls a stone. The drop from thousands to hundreds across
// that cut IS the evidence that the cut is the one between a stone and the grain,
// and it is printed by --self so it can be seen rather than believed.
//
// It also has to be ROUND and it has to be sitting IN something: a crack lit
// along one side passes a brightness test and is not an object, and a bright
// patch of stone is not a stone lying on stone.
const PEB = {
  size: [25, 60], rise: 0.28, round: 0.45, aspect: 0.50, reach: 35, fine: 4,
};

/** Separable box mean over a plan picture, radius in pixels, edges clamped. */
function planBox(field, w, h, r) {
  const row = new Float64Array(w * h);
  for (let j = 0; j < h; j++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += field[j * w + Math.min(w - 1, Math.max(0, i))];
    for (let i = 0; i < w; i++) {
      row[j * w + i] = s / (2 * r + 1);
      s += field[j * w + Math.min(w - 1, i + r + 1)] - field[j * w + Math.max(0, i - r)];
    }
  }
  const out = new Float64Array(w * h);
  for (let i = 0; i < w; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) s += row[Math.min(h - 1, Math.max(0, j)) * w + i];
    for (let j = 0; j < h; j++) {
      out[j * w + i] = s / (2 * r + 1);
      s += row[Math.min(h - 1, j + r + 1) * w + i] - row[Math.max(0, j - r) * w + i];
    }
  }
  return out;
}

/**
 * Exact squared euclidean distance from every set pixel to the nearest clear one.
 *
 * Felzenszwalb's lower envelope, run down the columns and then along the rows: it
 * is exact and it is linear, which matters because this is asked of every pixel of
 * every window and the answer is what says how big a piece is.
 */
function planDistance2(mask, w, h) {
  const BIG = 1e12;
  const f = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) f[i] = mask[i] ? BIG : 0;
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);
  const d = new Float64Array(Math.max(w, h));
  const line = new Float64Array(Math.max(w, h));
  const pass = (n, get, set) => {
    for (let i = 0; i < n; i++) d[i] = get(i);
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s;
      for (;;) {
        s = ((d[q] + q * q) - (d[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        if (s > z[k]) break;
        k--;
      }
      k++;
      v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      set(q, (q - v[k]) * (q - v[k]) + d[v[k]]);
    }
  };
  for (let x = 0; x < w; x++) {
    pass(h, (j) => f[j * w + x], (j, val) => { line[j] = val; });
    for (let j = 0; j < h; j++) f[j * w + x] = line[j];
  }
  for (let j = 0; j < h; j++) {
    pass(w, (i) => f[j * w + i], (i, val) => { line[i] = val; });
    for (let i = 0; i < w; i++) f[j * w + i] = line[i];
  }
  return f;
}

/** Connected components of a plan mask: a label per pixel and a record per piece. */
function planPieces(mask, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  const found = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start] >= 0) continue;
    const id = found.length;
    stack.length = 0;
    stack.push(start);
    label[start] = id;
    let n = 0; let x0 = w; let x1 = -1; let y0 = h; let y1 = -1; let sx = 0; let sy = 0;
    while (stack.length) {
      const at = stack.pop();
      n++;
      const cy = Math.floor(at / w);
      const cx = at - cy * w;
      sx += cx; sy += cy;
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
      if (cx > 0 && mask[at - 1] && label[at - 1] < 0) { label[at - 1] = id; stack.push(at - 1); }
      if (cx < w - 1 && mask[at + 1] && label[at + 1] < 0) { label[at + 1] = id; stack.push(at + 1); }
      if (cy > 0 && mask[at - w] && label[at - w] < 0) { label[at - w] = id; stack.push(at - w); }
      if (cy < h - 1 && mask[at + w] && label[at + w] < 0) { label[at + w] = id; stack.push(at + w); }
    }
    found.push({ n, x0, x1, y0, y1, cx: sx / n, cy: sy / n });
  }
  return { label, found };
}

const at = (sorted, q) => (sorted.length
  ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0);

/**
 * THE PAVING AS SHAPES, from straight above.
 *
 * `slab` is how much of the ground is quiet stone rather than the soil between
 * pieces. `piece` is how wide the ordinary piece is and `vary` how far the big
 * one stands from it — the committente's "irregular in size", as a number.
 * `peb` is how many small stones lie on a square metre. `shoulder` is how the
 * joint is shaded ACROSS ITS OWN WIDTH: dark soil in the middle of it and the
 * broken lip of the stone at its sides, which is what a joint between two pieces
 * of unequal thickness looks like from above and what a milled slot does not.
 *
 * SIZE WITHOUT HAVING TO CUT ONE PIECE FROM THE NEXT. Two slabs that touch along
 * a hairline are one connected shape to any labeller, and the reference is full of
 * them, so a size taken from connected areas answers the hairlines and not the
 * paving. The distance to the nearest joint does not care: every point of the
 * paving knows how far it is from the nearest dark ground whether or not a label
 * agrees, and twice that distance is the width of the piece it stands in.
 */
export function planStatistic({ w, h, y }) {
  const cm = (px) => px * PLAN_MM_PER_PX / 10;
  const base = planBox(y, w, h, Math.min(PLAN_BASE_BLUR, Math.floor(Math.min(w, h) / 4)));
  const level = planBox(y, w, h, PLAN_LEVEL_BLUR);

  const slab = new Uint8Array(w * h);
  let slabN = 0;
  for (let i = 0; i < w * h; i++) {
    slab[i] = level[i] / (base[i] || 1e-6) - 1 > PLAN_JOINT ? 1 : 0;
    slabN += slab[i];
  }
  const gap = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) gap[i] = slab[i] ? 0 : 1;

  const d2 = planDistance2(slab, w, h);
  const dj = planDistance2(gap, w, h);
  // Held to the window, because a paving with no joint at all in it has no piece
  // size — it has the window — and an unbounded number in a table is a number
  // nobody reads.
  const cap = Math.min(w, h);
  const widths = [];
  const gaps = [];
  for (let i = 0; i < w * h; i++) {
    if (slab[i]) widths.push(Math.min(cap, 2 * Math.sqrt(d2[i])));
    else gaps.push(Math.min(cap, 2 * Math.sqrt(dj[i])));
  }
  widths.sort((a, b) => a - b);
  gaps.sort((a, b) => a - b);

  // The joint across its own width: within a centimetre of stone against more
  // than two centimetres from any.
  const lip = [];
  const trough = [];
  const oneCm = (10 / PLAN_MM_PER_PX) ** 2;
  const twoCm = (20 / PLAN_MM_PER_PX) ** 2;
  for (let i = 0; i < w * h; i++) {
    if (slab[i]) continue;
    if (dj[i] <= oneCm) lip.push(level[i] / (base[i] || 1e-6));
    else if (dj[i] > twoCm) trough.push(level[i] / (base[i] || 1e-6));
  }
  lip.sort((a, b) => a - b);
  trough.sort((a, b) => a - b);
  const lipAt = at(lip, 0.50);
  const troughAt = at(trough, 0.50);

  const stones = planStones({ w, h, y }, slab);
  const across = planAcrossJoint(level, base, slab, d2, w, h);

  return {
    ...across,
    slab: slabN / (w * h),
    piece: cm(at(widths, 0.50)),
    pieceP90: cm(at(widths, 0.90)),
    vary: at(widths, 0.50) ? at(widths, 0.90) / at(widths, 0.50) : 0,
    joint: cm(at(gaps, 0.50)),
    shoulder: troughAt > 0 ? lipAt / troughAt - 1 : 0,
    peb: stones.perM2,
    pebOnSlab: stones.onSlab,
    pebCm: stones.median,
    pebCount: stones.count,
    mask: slab,
  };
}

// HOW MUCH OF A STEP THERE IS ACROSS A JOINT, AGAINST HOW MUCH THERE IS INSIDE A
// SLAB — WHICH IS WHETHER THE PAVING IS PIECES AT ALL.
//
// Everything else in this read describes the SHAPES: how big the pieces are, how
// varied, how much soil there is between them, how many stones. A paving can
// answer every one of those and still be wrong in the way the committente named
// on 2026-08-26: a wear painted per POINT, at fifteen to thirty centimetres, lies
// across whatever is under it, so half of a stain is on one slab and half on the
// next. His words: the smears "give the slabs CONTINUITY", when the slabs have to
// be different from one another — "the effect is spread over the whole path".
//
// Nothing above sees that. A field that crosses joints has the same shapes, the
// same sizes, the same stones. What it does not have is a STEP where a slab ends.
//
// So: pairs of points a fixed length apart, split by whether a joint lies between
// them. Pairs that cross a joint are two different pieces of stone; pairs that do
// not are two places on ONE piece. The ratio of the median jump of the first to
// the median jump of the second is how much a slab boundary is worth. A pavement
// of distinct slabs answers well above one — the reference answers 2.8 — and a
// film painted over everything answers about one, because to a film a joint is
// just more of the same.
//
// The separation is six centimetres: long enough that the level has somewhere to
// go inside a slab, short enough that a crossing pair is a pair either side of
// ONE joint and not a pair with a whole slab between them.
const CROSS_MM = 60;
const INSIDE_MM = 30;

function planAcrossJoint(level, base, slab, d2, w, h) {
  const step = Math.max(2, Math.round(CROSS_MM / PLAN_MM_PER_PX));
  // A pair that does NOT cross a joint has to be a pair on ONE PIECE OF STONE,
  // and the slab mask alone does not say that: the packed grit between the slabs
  // is above the mask's threshold as well, and it changes more over six
  // centimetres than any slab does. Taking those pairs as "inside a slab" is what
  // the first cut of this did, and it put the reading's own floor so high that a
  // film could not be told from a pavement. So both ends have to be at least this
  // far from the nearest joint, which is far enough to be past the grit.
  const clear = (INSIDE_MM / PLAN_MM_PER_PX) ** 2;
  const jumped = [];
  const held = [];
  const walk = (i, j, di, dj) => {
    const i2 = i + di * step;
    const j2 = j + dj * step;
    if (i2 < 0 || i2 >= w || j2 < 0 || j2 >= h) return;
    if (!slab[j * w + i] || !slab[j2 * w + i2]) return;
    let crossed = false;
    for (let k = 1; k < step; k++) {
      if (!slab[(j + dj * k) * w + (i + di * k)]) { crossed = true; break; }
    }
    if (!crossed && (d2[j * w + i] < clear || d2[j2 * w + i2] < clear)) return;
    const a = level[j * w + i] / (base[j * w + i] || 1e-6);
    const b = level[j2 * w + i2] / (base[j2 * w + i2] || 1e-6);
    (crossed ? jumped : held).push(Math.abs(a - b));
  };
  // Four directions, so a paving whose joints happen to favour one bearing is not
  // read along it.
  for (let j = 0; j < h; j += 2) {
    for (let i = 0; i < w; i += 2) {
      walk(i, j, 1, 0);
      walk(i, j, 0, 1);
      walk(i, j, 1, 1);
      walk(i, j, 1, -1);
    }
  }
  jumped.sort((a, b) => a - b);
  held.sort((a, b) => a - b);
  const q = (v) => (v.length ? v[Math.floor(v.length / 2)] : 0);
  const inside = q(held);
  return {
    cross: inside > 0 ? q(jumped) / inside : 0,
    crossStep: q(jumped),
    crossHeld: inside,
  };
}

/** The small stones of a plan picture, counted as objects and placed. */
export function planStones({ w, h, y }, slab, cut = PEB) {
  const px = (mm) => mm / PLAN_MM_PER_PX;
  const around = planBox(y, w, h, Math.max(2, Math.round(px(cut.reach))));
  const fine = planBox(y, w, h, Math.max(1, Math.round(px(cut.fine))));
  const lift = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) lift[i] = fine[i] / (around[i] || 1e-6) - 1;
  const bright = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bright[i] = lift[i] > cut.rise ? 1 : 0;
  const { found } = planPieces(bright, w, h);
  const areaLo = Math.PI * (px(cut.size[0]) / 2) ** 2;
  const areaHi = Math.PI * (px(cut.size[1]) / 2) ** 2;
  let count = 0;
  let onSlab = 0;
  const sizes = [];
  for (const p of found) {
    if (p.n < areaLo || p.n > areaHi) continue;
    const bw = p.x1 - p.x0 + 1;
    const bh = p.y1 - p.y0 + 1;
    if (p.n / (bw * bh) < cut.round) continue;
    if (Math.min(bw, bh) / Math.max(bw, bh) < cut.aspect) continue;
    const i = Math.round(p.cy) * w + Math.round(p.cx);
    if (lift[i] <= cut.rise) continue;
    count++;
    const r = Math.sqrt(p.n / Math.PI);
    sizes.push(2 * r * PLAN_MM_PER_PX / 10);
    // WHERE IT SITS IS ASKED OF THE GROUND AROUND IT AND NOT OF ITS OWN MIDDLE.
    // A stone is bright and the level the slab mask is taken on is smoothed over
    // less than a stone, so asked at its centre every stone stands on a slab of
    // its own making. Asked in a ring outside it, the answer is the ground the
    // stone is lying in, which is the question the committente's reading asks:
    // his stones are in the joints and in the eroded pockets, not on the slabs.
    if (!slab) continue;
    let ring = 0;
    let on = 0;
    for (let a = 0; a < 360; a += 12) {
      const qx = Math.round(p.cx + 2.2 * r * Math.cos(a * Math.PI / 180));
      const qy = Math.round(p.cy + 2.2 * r * Math.sin(a * Math.PI / 180));
      if (qx < 0 || qx >= w || qy < 0 || qy >= h) continue;
      ring++;
      on += slab[qy * w + qx];
    }
    if (ring && on / ring > 0.5) onSlab++;
  }
  sizes.sort((a, b) => a - b);
  const areaM2 = w * h * (PLAN_MM_PER_PX / 1000) ** 2;
  return {
    count,
    perM2: count / areaM2,
    onSlab: count ? onSlab / count : 0,
    median: at(sizes, 0.50),
  };
}

// How far each of the six may sit from the reference's own.
//
// SAME RULE AS EVERY TOLERANCE IN THIS FILE — three times what one paving costs
// when it is measured against itself — AND THE NULL HAS MOVED, because the one it
// was taken on is not the one this gate makes.
//
// WHAT IT WAS. Three times the RANGE of four corner windows of the reference at
// 600 px: the four scattered by 4.4 points of slab, 1.0 cm of piece, 0.29 of
// vary, 4.9 stones a square metre and 1.9 points of shoulder, which is where
// 0.132 / 3.0 / 0.87 / 3.0 / 0.057 came from.
//
// WHY IT COULD NOT STAY. The reference is not averaged on four windows of 600 px.
// planReferenceWindows() takes NINE of 400, and that is the number every render
// is weighed against — so the tolerance was derived on one reading of the
// reference and spent on another. On the nine, the same paving disperses two to
// four times as widely: slab 0.552 to 0.680, piece 4.03 to 6.46 cm, vary 2.63 to
// 3.11, shoulder 0.140 to 0.191, peb 4.9 to 18.8 a square metre. Three times the
// range of THOSE is 0.385 / 7.31 / 1.46 / 0.154, against the numbers above — the
// gate was between two and three times tighter than the reference agrees with
// itself, and a render could fail it for being exactly as varied as the
// photograph it copies.
//
// AND THREE TIMES THE NINE-WINDOW RANGE IS NOT THE ANSWER EITHER, which is the
// half of this that a straight application of the rule would have missed. At that
// slack the injected carpet — a lattice of same-sized cobbles with a crease round
// every one of them, which is the thing this reading was built to refuse — passes
// EVERY key: slab, piece, vary, peb, shoulder and cross. A measure that admits
// the defect it exists for is not a measure, and the self test says so out loud.
//
// SO THE NULL IS THE COMPARISON THE GATE REALLY MAKES. It never weighs one window
// against another. It weighs ONE window of a render against the MEAN OF NINE of
// the reference — so what a paving costs when it is measured against itself is
// the deviation of one window FROM THAT MEAN, and three times that is the house
// rule applied to the reading that is taken instead of to one nobody takes. The
// worst of the nine deviates by 0.085 of slab, 1.29 cm of piece, 0.287 of vary,
// 0.027 of shoulder, a factor 2.92 of peb and a factor 1.48 of cross.
//
// BOTH DIRECTIONS, MEASURED (v3-sentiero/fix1/e-v3f-sdoppiata.mjs, which is the
// driver of v3-sentiero/dev1/e-v3f-riderivata.mjs relaunched at both sizes):
//
//   the reference split in two and measured apart  passes on all six
//   an injected sheet                              fails on all six
//   an injected carpet                             fails on slab and on shoulder
//
// A DIFFERENCE IS TRIPLED AND A RATIO IS CUBED, which is the only sense in which
// a factor can be multiplied by three. `peb` and `cross` are ratios because both
// are counts or jumps with small means, and a difference on either admits a
// paving with none at all.
export const TOLERANCE_PLAN_APRON = {
  slab: 0.255, piece: 3.875, vary: 0.861, peb: 24.913, shoulder: 0.081, cross: 3.235,
};

// AND THE MIDDLE PLAN CARRIES ITS OWN SET, DERIVED THE SAME WAY ON ITS OWN
// WINDOW, BECAUSE A TOLERANCE BELONGS TO A WINDOW AND NOT TO A FILE.
//
// This is the whole of E-V3f said a second time and it is not a formality: the
// numbers move, and they move because the reading does. planStatistic() takes
// its base level over a box a quarter of the window across — 100 px at 400 and
// 75 at 300 — and caps a piece at the window, so nine squares of 300 are a
// different reading of the same photograph, not the same reading of less of it.
//
// ON THE NINE OF 300 the same paving disperses slab 0.564 to 0.676, piece 3.60
// to 7.20 cm, vary 2.37 to 2.86, shoulder 0.122 to 0.174 and peb 6.2 to 22.2 a
// square metre, about a mean of slab 0.614, piece 4.94 cm, vary 2.59, shoulder
// 0.152, peb 12.3. The worst of the nine deviates from that mean by 0.062 of
// slab, 2.26 cm of piece, 0.268 of vary, 0.030 of shoulder, a factor 2.00 of peb
// and a factor 1.37 of cross, and three times each of those is the set below.
//
// WHICH WAY EACH ONE MOVED, AND IT IS NOT ALL ONE WAY. `slab`, `vary` and
// `cross` come in TIGHTER than the apron's, and `peb` far tighter — 8.0 against
// 24.9, because the 3.9-fold split between two of the nine windows of 400 is not
// there at 300, which brings the stone count most of the way back to being a
// gate rather than a witness. `piece` goes the other way, 6.78 against 3.88: a
// piece is capped at the window, and a smaller window is a coarser ruler for the
// biggest slabs. That is the price of the smaller square and it is paid where it
// falls rather than averaged away.
//
// BOTH DIRECTIONS, MEASURED at 300 (same driver, same subjects):
//
//   the reference split in two and measured apart  passes on all six
//   an injected sheet                              fails on all six
//   an injected carpet                             fails on slab and on shoulder
//
// — the same signature the apron set answers with, which is what says the two
// sets are one rule applied twice and not two rules.
export const TOLERANCE_PLAN_MEDIO = {
  slab: 0.186, piece: 6.779, vary: 0.803, peb: 8.000, shoulder: 0.091, cross: 2.559,
};
// AND TWO OF THE SIX ARE WITNESSES RATHER THAN GATES, WHICH IS DECLARED AND NOT
// HIDDEN.
//
// `cross` was one already and stays one: at a factor of 3.2 it admits a pavement
// AND a film, so passing it proves little. It is held at its honest number anyway,
// because a number nobody may spend is a number nobody reads, and because the
// EVIDENCE it exists for is on the record either way — this ground read 0.56 while
// its wear was painted per point, and 0.88 against the reference's 0.87 with the
// wear quantised per slab.
//
// `peb` JOINS IT ON THE APRON PLAN, and the reason is the move above. Held as a
// difference its slack admitted no stones at all; held as a ratio on four corner
// windows it was 3.0 and a bit; held as a ratio on the nine of 400 the reference
// is actually averaged on it is 24.9, because one of those nine windows carries
// 4.9 stones a square metre where another carries 18.8 — a factor of 3.9 inside
// one photograph. At 24.9 it still refuses a paving with NO stones, which is the
// failure that mattered, and it no longer refuses much else. The reading that has
// to be looked at instead is the LADDER --self prints: the reference goes 480 a
// square metre at 8 mm to 14.0 at the cut to 1.6 at 35, and a paving made of
// cobbles does not.
//
// ON THE MIDDLE PLAN `peb` IS VERY NEARLY A GATE AGAIN, at 8.0, and that is a
// measurement and not a hope: the two windows of 400 that were 3.9 apart do not
// fall that way at 300. `cross` stays a witness at either size.

/**
 * THE TWO PLANS, EACH AS ONE RECORD.
 *
 * A northing, a pose, a window and a tolerance are not four independent choices:
 * the window is the size that fits the stone at that northing, and the tolerance
 * is the one derived on nine windows of that size. Handing them round together
 * is what makes it impossible to weigh a middle-stretch render against the
 * apron's slack, which is the mistake this record exists to prevent.
 *
 * IT IS ALSO WHAT EVERY READING PRINTS. A plan number without the tuning it was
 * taken in is the thing that went wrong here in the first place.
 */
export const PLANS = {
  apron: {
    name: 'apron',
    what: 'the near tuning, under and behind the walker',
    z: PLAN_APRON_Z,
    pose: PLAN_POSE_APRON,
    window: PLAN_WINDOW_APRON,
    tolerance: TOLERANCE_PLAN_APRON,
  },
  medio: {
    name: 'medio',
    what: 'the pale middle stretch, north of the crossing',
    z: PLAN_MEDIO_Z,
    pose: PLAN_POSE_MEDIO,
    window: PLAN_WINDOW_MEDIO,
    tolerance: TOLERANCE_PLAN_MEDIO,
  },
};

/** Which of the two plans a run of the tool is about. Apron unless told. */
export function planTuning(argv = process.argv) {
  const hit = argv.find((a) => a.startsWith('--tuning='));
  const name = hit ? hit.slice(9) : 'apron';
  if (!PLANS[name]) {
    throw new Error(`--tuning wants ${Object.keys(PLANS).join(' or ')}, not ${name}`);
  }
  return PLANS[name];
}

/** A plan's window in one line, so no reading is printed without its tuning. */
const planTitle = (p) => `the ${p.name} plan — ${p.what} — camera at z=${p.z}, `
  + `window ${p.window.side} px = ${(p.window.side * PLAN_MM_PER_PX / 1000).toFixed(2)} m `
  + `at (${p.window.x}, ${p.window.y})`;

/** A picture as linear luminance, whatever its size. */
export async function readPlanImage(path) {
  const { data, info } = await sharp(path).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const y = new Float64Array(info.width * info.height);
  for (let i = 0; i < y.length; i++) {
    const o = i * info.channels;
    y[i] = Y[0] * srgbToLinear(data[o] / 255) + Y[1] * srgbToLinear(data[o + 1] / 255)
      + Y[2] * srgbToLinear(data[o + 2] / 255);
  }
  return { w: info.width, h: info.height, y };
}

/** One square window of a plan picture. */
export function planWindow(img, x0, y0, side) {
  const y = new Float64Array(side * side);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) y[j * side + i] = img.y[(j + y0) * img.w + (i + x0)];
  }
  return { w: side, h: side, y };
}

/**
 * The nine windows of the plan reference, at the size of the reading being made.
 *
 * NINE AND NOT ONE, because the reference is a picture of a paving and not of one
 * slab: its corners hold different amounts of broken ground, and what the render
 * is held to is the average of them with three times their own scatter allowed.
 *
 * AND THE SIZE IS AN ARGUMENT AND NOT A DEFAULT, because the reference has to be
 * averaged on the SAME square the render is read on: planStatistic() takes its
 * base level over a box a quarter of the window wide and caps a piece at the
 * window, so nine windows of 400 and nine of 300 are two different readings of
 * one photograph, and a tolerance derived on either is spendable only on its own.
 */
export function planReferenceWindows(img, side) {
  const at = [0, Math.round((img.w - side) / 2), img.w - side];
  const down = [0, Math.round((img.h - side) / 2), img.h - side];
  const out = [];
  for (const y of down) for (const x of at) out.push(planStatistic(planWindow(img, x, y, side)));
  return out;
}

export const planMean = (list) => {
  const keys = ['slab', 'piece', 'pieceP90', 'vary', 'joint', 'shoulder', 'cross',
    'peb', 'pebOnSlab', 'pebCm'];
  return Object.fromEntries(keys.map((k) => [k, list.reduce((t, s) => t + s[k], 0) / list.length]));
};

/**
 * Two pavings that are NOT the reference's, made here so the measure can be seen
 * to reject as well as accept.
 *
 * A SHEET is stone with nothing in it: no joints, no stones, one level and a
 * whisper of grain. A CARPET is the opposite failure and the one this world
 * actually fell into — a lattice of same-sized cobbles with a crease round every
 * one of them, which is what chasing a count of bright runs per path width builds.
 * A measure that passes either of these is not measuring what the committente
 * read off his picture.
 */
export function planDegenerate(kind, side) {
  const y = new Float64Array(side * side);
  const hash = (a, b) => {
    let x = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  };
  const cell = 43 / PLAN_MM_PER_PX; // a cobble of four and a bit centimetres
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      let v = 0.20 + 0.004 * (hash(i * 7 + j, j * 13 + i) - 0.5);
      if (kind === 'carpet') {
        const ci = Math.floor(i / cell);
        const cj = Math.floor(j / cell);
        let best = Infinity;
        let second = Infinity;
        let id = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const jx = (ci + di + 0.15 + 0.7 * hash(ci + di, cj + dj)) * cell;
            const jz = (cj + dj + 0.15 + 0.7 * hash(ci + di + 7919, cj + dj + 104729)) * cell;
            const d = Math.hypot(i - jx, j - jz);
            if (d < best) { second = best; best = d; id = hash(ci + di + 31, cj + dj + 17); }
            else if (d < second) second = d;
          }
        }
        // Every cell lifted towards its own middle and let down into the crease
        // it meets its neighbour in: one crest and one trough per cell, which is
        // what a bed of packed gravel is and what a surface is not.
        // As loud as the tile this world actually shipped: a gain of 1.4 over a
        // field that spans a whole unit either side of its middle is a stone
        // coming back at up to 1.7 times the one beside it.
        const rim = Math.min(1, (second - best) / (0.45 * cell));
        v *= 1 + 0.70 * (0.5 + 0.5 * id) * (rim * rim * (3 - 2 * rim)) - 0.35;
      }
      y[j * side + i] = v;
    }
  }
  return { w: side, h: side, y };
}

const HEAD = `  ${'frame'.padEnd(24)}${'joint%'.padStart(8)}${'depth%'.padStart(8)}`
  + `${'rms%'.padStart(8)}${'grain%'.padStart(8)}${'pitch m'.padStart(9)}${'cells'.padStart(8)}\n`;

const CLOSE_HEAD = `\n  ${'the material, close up'.padEnd(30)}${'edge%'.padStart(8)}`
  + `${'over%'.padStart(8)}${'lobe%'.padStart(7)}${'lob90%'.padStart(8)}`
  + `${'peb-pan'.padStart(9)}${'peb-verge'.padStart(10)}${'big x'.padStart(7)}`
  + `${'pebw%'.padStart(8)}`
  + `${'seam%'.padStart(8)}${'seamw%'.padStart(8)}${'deep%'.padStart(7)}`
  + `${'body cm'.padStart(8)}${'rows'.padStart(7)}${'px/w'.padStart(7)}\n`;

const closeLine = (label, s) => `  ${label.padEnd(30)}${(s.edge * 100).toFixed(2).padStart(8)}`
  + `${(s.over * 100).toFixed(1).padStart(8)}${(s.lobe * 100).toFixed(1).padStart(7)}`
  + `${(s.lobeP90 * 100).toFixed(1).padStart(8)}`
  + `${s.pan.density.toFixed(2).padStart(9)}${s.verge.density.toFixed(2).padStart(10)}`
  + `${s.big.toFixed(2).padStart(7)}`
  + `${(s.verge.size * 100).toFixed(2).padStart(8)}`
  + `${(s.seam.fraction * 100).toFixed(2).padStart(8)}${(s.seam.width * 100).toFixed(2).padStart(8)}`
  + `${(s.seam.depth * 100).toFixed(1).padStart(7)}${s.body.toFixed(2).padStart(8)}`
  + `${String(s.lines).padStart(7)}${s.across.toFixed(0).padStart(7)}\n`;

function reportClose(reference, s, label) {
  let ok = true;
  const say = (name, got, want, slack, unit) => {
    const off = Math.abs(got - want);
    const retired = RETIRED_CLOSE.includes(name);
    const free = ONE_SIDED_CLOSE[name] === 'above' && got > want;
    const bad = off > slack && !retired && !free;
    if (bad) ok = false;
    process.stdout.write(`    ${name.padEnd(10)}${off.toFixed(2).padStart(9)} ${unit}`
      + `  of ${`${slack.toFixed(2)} ${unit}`.padEnd(12)}`
      + `${retired ? 'read, not spent' : (bad ? 'OUT' : `ok${free && off > slack ? ' (over, which is not the failure)' : ''}`)}\n`);
  };
  process.stdout.write(`  ${label}\n`);
  say('edge', s.edge * 100, reference.edge * 100, TOLERANCE_CLOSE.edge * 100, 'pts');
  // THE SHAPE OF THE VERGE, which is the third of the three things the
  // committente named and the one nothing measured until now.
  say('over', s.over * 100, reference.over * 100, TOLERANCE_CLOSE.over * 100, 'pts');
  say('lobe', s.lobe * 100, reference.lobe * 100, TOLERANCE_CLOSE.lobe * 100, 'pts');
  say('peb-pan', s.pan.density, reference.pan.density, TOLERANCE_CLOSE.pan, '/w ');
  say('peb-verge', s.verge.density, reference.verge.density, TOLERANCE_CLOSE.verge, '/w ');
  // HOW THE FOURTH ONE LIVES BESIDE THE THIRD, because they are two halves of
  // one question and neither is the other. `peb-verge` holds the NUMBER of
  // stones per path width and `big` holds the SPREAD of their sizes, and a
  // surface can have either without the other: a bed of pieces all one size at
  // the right density passes the count and fails the spread, and a bare atlas
  // with almost no stones in it at all fails the count and passes the spread,
  // because the few pieces it does have happen to differ. Both are measured, and
  // both are on the record beside this line.
  say('big', s.big, reference.big, TOLERANCE_CLOSE.big, 'x  ');
  return ok;
}

const line = (label, s) => `  ${label.padEnd(24)}${(s.joint * 100).toFixed(2).padStart(8)}`
  + `${(s.depth * 100).toFixed(1).padStart(8)}${(s.rms * 100).toFixed(2).padStart(8)}`
  + `${(s.grain * 100).toFixed(2).padStart(8)}`
  + `${(Number.isFinite(s.pitch) ? s.pitch.toFixed(2) : 'none').padStart(9)}${String(s.n).padStart(8)}\n`;

function report(reference, s, label) {
  let ok = true;
  const say = (name, got, want, slack, ratio = false) => {
    const off = ratio ? Math.max(got / want, want / got) : Math.abs(got - want);
    if (off > slack) ok = false;
    process.stdout.write(`    ${name.padEnd(8)}`
      + `${(ratio ? `x${off.toFixed(2)}` : `${(off * 100).toFixed(2)} pts`).padStart(11)}`
      + `  of ${(ratio ? `x${slack.toFixed(2)}` : `${(slack * 100).toFixed(2)} pts`).padEnd(11)}`
      + `${off > slack ? 'OUT' : 'ok'}\n`);
  };
  process.stdout.write(`  ${label}\n`);
  say('joint', s.joint, reference.joint, TOLERANCE.joint);
  say('depth', s.depth, reference.depth, TOLERANCE.depth);
  say('rms', s.rms, reference.rms, TOLERANCE.rms);
  say('grain', s.grain, reference.grain, TOLERANCE.grain);
  say('pitch', s.pitch, reference.pitch, TOLERANCE.pitch, true);
  return ok;
}

/** Half the strip by distance, so the reference can be measured against itself. */
const halve = (field, near) => ({
  cells: field.cells.filter((c) => (near
    ? c.distance < (BAND.lo + BAND.hi) / 2
    : c.distance >= (BAND.lo + BAND.hi) / 2)),
});

async function readFrame(path) {
  const { data, info } = await sharp(path).removeAlpha()
    .resize(FRAME.width, FRAME.height, { fit: 'fill' }).raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: 3, data };
}

const GRIT_HEAD = `\n  ${'the same frames, at centimetres'.padEnd(34)}`
  + `${'grit%'.padStart(8)}${'decim%'.padStart(9)}${'pixels'.padStart(9)}\n`;
const gritLine = (label, s) => `  ${label.padEnd(34)}${(s.grit * 100).toFixed(2).padStart(8)}`
  + `${(s.coarse * 100).toFixed(2).padStart(9)}${String(s.n).padStart(9)}\n`;

/** The frame named after --close, if the caller asked for the close read. */
function closeArgument() {
  const at = process.argv.indexOf('--close');
  if (at < 0) return null;
  const frame = process.argv[at + 1];
  if (!frame || frame.startsWith('--')) {
    throw new Error('--close wants the render of CLOSE_POSE that follows it');
  }
  return frame;
}

/** The frame named after --plan, if the caller asked for the plan read. */
function planArgument() {
  const i = process.argv.indexOf('--plan');
  if (i < 0) return null;
  const frame = process.argv[i + 1];
  if (!frame || frame.startsWith('--')) {
    throw new Error('--plan wants the render of a plan pose that follows it');
  }
  return frame;
}

const PLAN_HEAD = `\n  ${'the paving from above'.padEnd(32)}${'slab%'.padStart(7)}`
  + `${'piece cm'.padStart(9)}${'p90 cm'.padStart(8)}${'vary x'.padStart(8)}`
  + `${'joint cm'.padStart(9)}${'shoulder%'.padStart(10)}${'peb/m2'.padStart(8)}`
  + `${'on slab'.padStart(9)}${'peb cm'.padStart(8)}\n`;
const planLine = (label, s) => `  ${label.padEnd(32)}${(s.slab * 100).toFixed(1).padStart(7)}`
  + `${s.piece.toFixed(1).padStart(9)}${s.pieceP90.toFixed(1).padStart(8)}`
  + `${s.vary.toFixed(2).padStart(8)}${s.joint.toFixed(2).padStart(9)}`
  + `${(s.shoulder * 100).toFixed(1).padStart(10)}${s.cross.toFixed(2).padStart(9)}`
  + `${s.peb.toFixed(1).padStart(8)}`
  + `${(s.pebOnSlab * 100).toFixed(0).padStart(8)}%${s.pebCm.toFixed(1).padStart(8)}\n`;

// THE TOLERANCE IS AN ARGUMENT AND NOT A CONSTANT HERE, because there are two
// sets of it and picking the wrong one is the whole failure this fix is about.
function reportPlan(reference, s, label, tol) {
  let ok = true;
  const say = (name, got, want, slack, unit, scale = 1) => {
    const off = Math.abs(got - want) * scale;
    if (off > slack * scale) ok = false;
    process.stdout.write(`    ${name.padEnd(10)}${off.toFixed(2).padStart(9)} ${unit}`
      + `  of ${`${(slack * scale).toFixed(2)} ${unit}`.padEnd(12)}${off > slack * scale ? 'OUT' : 'ok'}\n`);
  };
  const ratio = (name, got, want, slack) => {
    const off = got > 0 && want > 0 ? Math.max(got / want, want / got) : Infinity;
    if (off > slack) ok = false;
    process.stdout.write(`    ${name.padEnd(10)}${(Number.isFinite(off) ? `x${off.toFixed(2)}` : 'none').padStart(9)}    `
      + `  of ${`x${slack.toFixed(2)}`.padEnd(12)}${off > slack ? 'OUT' : 'ok'}\n`);
  };
  process.stdout.write(`  ${label}\n`);
  say('slab', s.slab, reference.slab, tol.slab, 'pts', 100);
  say('piece', s.piece, reference.piece, tol.piece, 'cm ');
  say('vary', s.vary, reference.vary, tol.vary, 'x  ');
  // THE ONE THAT REPLACES `peb-pan` AND `peb-verge` AS A TARGET. See the note
  // over PEB: those two counted the reference's grain as stones and the paving
  // that answered them is the carpet the committente threw out.
  ratio('peb', s.peb, reference.peb, tol.peb);
  say('shoulder', s.shoulder, reference.shoulder, tol.shoulder, 'pts', 100);
  // THE ONE THAT SEES A FILM. Held as a ratio, because it IS one.
  ratio('cross', s.cross, reference.cross, tol.cross);
  return ok;
}

// ---------------------------------------------------------------------------
// WHAT CROSSES THE JOINTS.
//
//   node tools/terrain/check-slabs.mjs --weave shots/piombo.png
//   node tools/terrain/check-slabs.mjs --weave shots/piombo.png --self
//
// THE READING THAT EXISTS BECAUSE THE SAME DEFECT CAME BACK THREE TIMES. A
// carpet of cobbles, then a film spread over everything, then ghost slabs: each
// cure closed the shape the eye had named, and none of them closed what all
// three had in common, which is that something was being drawn ACROSS the
// joints. Every other reading in this file describes the SHAPES of the paving —
// how big the pieces are, how varied, how much soil lies between them, how many
// stones — and a second paving laid over the first answers every one of them and
// is still the thing the committente rejected three times.
//
// `cross` above sees a piece of this and says so, but it is a jump statistic with
// a factor 3.8 of honest slack, and at that slack it admits a film. This asks a
// sharper question, and it asks it of something that can be known exactly.
//
// IT DOES NOT ASK THE PICTURE WHERE THE JOINTS ARE. The first cut did, the way
// every shape reading above does, and it could not work: this paving's tightest
// joints are hairlines, a mask over them merges whole clusters into one blob, and
// a pair of points that "does not cross a joint" then crosses two. Measured, in
// that form the reference answered 0.99 and an injected veil answered 0.98 — no
// power at all, and for a reason that is structural rather than a parameter. So
// the joints come out of the one seat that owns them, lib/pattern.mjs, exactly as
// check-strip-register.mjs takes them, and the render is read against the paving
// it was actually painted from.
//
// THE PROJECTION IS WHAT MAKES THAT EXACT. A plan camera looks straight down, so
// the ground under it lies in a plane PERPENDICULAR to the optical axis,
// and the perspective image of such a plane is a plain uniform scale: pixel to
// world is an offset and a multiply, with nothing to invert and no foreshortening
// anywhere in the window.
//
// TWO NUMBERS, BECAUSE TWO DEFECTS WERE NAMED.
//
//   `weld`  — a structure at the SCALE OF A SLAB. Band-pass the picture there and
//             compare how much it varies over nine centimetres INSIDE one piece
//             of stone against how much it varies over nine centimetres that
//             cross a joint. A structure that belongs to the slabs is quiet
//             inside one and steps at the boundary, so the ratio is small; a veil
//             does not know the boundary is there and answers ONE. The far end of
//             that scale is not an argument, it is a measurement: read against a
//             lattice turned five degrees off this world's own, a real frame
//             answers 1.047, and that is what a pure veil is.
//
//   `speck` — the FINE band. A step will not find a stipple: fine grain
//             decorrelates inside one slab as fast as it does across a joint,
//             whatever it belongs to. What separates a grain that belongs to the
//             stone from a film sprayed over everything is its STRENGTH — a real
//             paving has smooth slabs and pitted ones, and a film has one
//             amplitude everywhere. So: the strength of the fine band over
//             ten-centimetre blocks, and its scatter as a fraction of its own
//             mean. This one is placed off the PICTURE'S own dark runs and not off
//             the lattice, which is what lets the same code answer for the
//             reference, whose lattice this side does not know.
const WEAVE_ATLAS = 2048;
// 60 mm: what is smoothed away under the slab band.
//
// IT WAS 24 mm AND THAT WAS THE WRONG BAND, which is worth writing down because
// it is lesson one of the protocol in action. At 24 mm the band ran from five
// centimetres to sixty, and five centimetres is not the scale of a slab — it is
// the scale of the MATERIAL on one, the crackle and the pockmarks and the bedded
// stones. Both populations were then dominated by the same material and the
// ratio between them barely moved when a real veil was injected. The ghosts this
// reading exists to catch stood at 15.4 and 40.0 cm and the slabs are at 74, so
// the band has to start above the material and below the piece.
const WEAVE_BAND = 20;
const WEAVE_WIDE = 100;          // 300 mm: and what is taken off it, so a band is a band
const WEAVE_REACH = 30;          // 90 mm between the two ends of a pair
const WEAVE_CLEAR = 15;          // 45 mm: how far off a joint both ends stand
const WEAVE_BLOCK = 33;          // 99 mm: the block the fine grain's strength is read over
const WEAVE_BLOCK_CLEAR = 5;

// WHERE THE BAR IS.
//
// Not three times a scatter, because this reading's two ends are known exactly
// and a scatter is not what decides it: ONE is a veil, by construction and by
// measurement, and the state rejected on 2026-08-26 answered 0.493 — half of its
// slab-band variation was living inside the slabs. The bar is set where a world
// whose slab-scale content BELONGS to the slabs sits, with room left for the
// gentle slope of its own that every real slab has.
const WEAVE_BAR = 0.30;

/** A box mean over the stone only, so a joint's own darkness stays out of it. */
function weaveBox(field, w, h, r, mask = null) {
  const run = (src) => {
    const tmp = new Float64Array(w * h);
    const out = new Float64Array(w * h);
    for (let j = 0; j < h; j++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += src[j * w + Math.min(w - 1, Math.max(0, i))];
      for (let i = 0; i < w; i++) {
        tmp[j * w + i] = acc / (2 * r + 1);
        acc += src[j * w + Math.min(w - 1, i + r + 1)] - src[j * w + Math.max(0, i - r)];
      }
    }
    for (let i = 0; i < w; i++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += tmp[Math.min(h - 1, Math.max(0, j)) * w + i];
      for (let j = 0; j < h; j++) {
        out[j * w + i] = acc / (2 * r + 1);
        acc += tmp[Math.min(h - 1, j + r + 1) * w + i] - tmp[Math.max(0, j - r) * w + i];
      }
    }
    return out;
  };
  if (!mask) return run(field);
  const fm = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) fm[i] = field[i] * mask[i];
  const num = run(fm);
  const den = run(Float64Array.from(mask));
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = den[i] > 1e-9 ? num[i] / den[i] : field[i];
  return out;
}

/** A chamfer march out of a set of pixels, in pixels. */
function weaveMarch(seed, side) {
  const d = new Float64Array(side * side).fill(1e9);
  for (let i = 0; i < side * side; i++) if (seed[i]) d[i] = 0;
  for (let pass = 0; pass < 2; pass++) {
    const step = pass === 0 ? 1 : -1;
    for (let n = 0; n < side * side; n++) {
      const k = pass === 0 ? n : side * side - 1 - n;
      const i = k % side;
      const j = (k - i) / side;
      let best = d[k];
      for (const [di, dj] of [[step, 0], [0, step], [step, step], [-step, step]]) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || a >= side || b < 0 || b >= side) continue;
        const cand = d[b * side + a] + (di && dj ? Math.SQRT2 : 1);
        if (cand < best) best = cand;
      }
      d[k] = best;
    }
  }
  return d;
}

/**
 * Where the paving stands under every pixel of a plan window.
 *
 * `turn` and `wider` are the injections: at their defaults this is the lattice
 * the atlas was painted from, and anything else is a lattice that is NOT.
 */
export function weaveLattice(x0, y0, side, { turn = 0, wider = 1, at = PLAN_APRON_Z } = {}) {
  const s = PLAN_MM_PER_PX / 1000;
  const id = new Float64Array(side * side);
  const joint = new Uint8Array(side * side);
  const cos = Math.cos(turn * Math.PI / 180);
  const sin = Math.sin(turn * Math.PI / 180);
  // WHERE THE CAMERA STOOD, AND WHY IT IS AN ARGUMENT NOW.
  //
  // This read only ever had one standing place written into it, and a paving
  // that repeats is a paving whose ONE window can be lucky — the same argument
  // `gemella-45` exists for at the committente's own pose. Given a plan frame
  // shot further up the run it predicted the joints of a place the frame is not
  // of, and answered `fits` 0.02 and `weld` 0.98: not a defect of the world, a
  // reading standing in the wrong field. It takes the northing now, and the
  // camera's own x follows from it through the one seat that owns the path's
  // middle.
  const ex = pathCentreX(at);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const ax = ex + (x0 + i - FRAME.width / 2 + 0.5) * s;
      const az = at + (y0 + j - FRAME.height / 2 + 0.5) * s;
      const x = ax * cos + az * sin;
      const z = az * cos - ax * sin;
      const detail = bandLimit(atlasSpan(x, z, WEAVE_ATLAS));
      const seat = slabSpace(x, z, PLATE, detail);
      const cell = paveFrom({ fx: seat.fx * wider, fz: seat.fz * wider },
        paveErosion(x, z, Math.abs(pathCoord(x, z)), detail), PLATE);
      id[j * side + i] = cell.id;
      joint[j * side + i] = cell.inJoint ? 1 : 0;
    }
  }
  return { id, joint };
}

/** How much of the frame's own darkness a predicted joint field explains. */
function weaveFits(rel, joint, n) {
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) { sa += rel[i]; sb += joint[i]; }
  const ma = sa / n;
  const mb = sb / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const p = rel[i] - ma;
    const q = joint[i] - mb;
    ab += p * q; aa += p * p; bb += q * q;
  }
  return ab / Math.sqrt(aa * bb || 1);
}

const weaveHash = (a, b) => {
  let x = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

/**
 * A lattice of pieces laid over the picture with no idea where the joints are —
 * which is what the near tile was — and the same amplitude handed to the PAVING'S
 * OWN pieces instead. The reading has to move one way for the first and the other
 * way for the second, or it is not reading what it says it reads.
 */
function weavePaint(y, side, lat, kind, amp, cellMm) {
  const out = Float64Array.from(y);
  const c = cellMm / PLAN_MM_PER_PX;
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      let v;
      if (kind === 'slab') v = (lat.id[j * side + i] - 0.5) * 2;
      else {
        const ci = Math.floor(i / c);
        const cj = Math.floor(j / c);
        let best = Infinity;
        let id = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const jx = (ci + di + 0.15 + 0.7 * weaveHash(ci + di, cj + dj)) * c;
            const jz = (cj + dj + 0.15 + 0.7 * weaveHash(ci + di + 7919, cj + dj + 104729)) * c;
            const d = Math.hypot(i - jx, j - jz);
            if (d < best) { best = d; id = weaveHash(ci + di + 31, cj + dj + 17); }
          }
        }
        v = (id - 0.5) * 2;
      }
      out[j * side + i] = y[j * side + i] * (1 + amp * v);
    }
  }
  return out;
}

// THE SPREAD IS AN RMS AND NOT A MEDIAN, and the reason is measured. A veil whose
// pieces are forty centimetres across puts a step under only about a fifth of the
// pairs that stand nine centimetres apart inside one slab, so the MEDIAN of those
// pairs does not move when the veil is switched on — injected at twelve per cent
// it moved by less than one part in two hundred. What a veil does is add
// VARIANCE, to the crossing pairs and to the held ones alike, and an rms is what
// counts variance.
const weaveSpread = (v) => (v.length
  ? Math.sqrt(v.reduce((t, x) => t + x * x, 0) / v.length) : 0);

export function weaveRead(frame, x0, y0, side, inject = {}) {
  let y = new Float64Array(side * side);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) y[j * side + i] = frame.y[(y0 + j) * frame.w + (x0 + i)];
  }
  const lat = inject.lattice === false
    ? { id: new Float64Array(side * side), joint: new Uint8Array(side * side) }
    : weaveLattice(x0, y0, side, inject);
  if (inject.paint) y = weavePaint(y, side, lat, inject.paint, inject.amp, inject.cell || 400);
  const base = weaveBox(y, side, side, Math.min(150, Math.floor(side / 4)));
  const rel = new Float64Array(side * side);
  for (let i = 0; i < side * side; i++) rel[i] = y[i] / (base[i] || 1e-6);

  // The slab band, smoothed over the STONE ONLY. A plain box at twenty-four
  // millimetres carries the joint's own dark line into every point within that of
  // it, and the reading would then be measuring the JOINT and not the two slabs it
  // separates: measured, `across` came out 373 against an `inside` of 169 that
  // way, and no clear distance fixes it, because the leak is in the smoothing.
  const stone = new Uint8Array(side * side);
  for (let i = 0; i < side * side; i++) stone[i] = lat.joint[i] ? 0 : 1;
  const near = weaveBox(rel, side, side, WEAVE_BAND, stone);
  const wide = weaveBox(rel, side, side, WEAVE_WIDE, stone);
  const band = new Float64Array(side * side);
  for (let i = 0; i < side * side; i++) band[i] = near[i] - wide[i];

  const off = weaveMarch(lat.joint, side);
  const held = [];
  const jumped = [];
  const walk = (i, j, di, dj) => {
    const i2 = i + di * WEAVE_REACH;
    const j2 = j + dj * WEAVE_REACH;
    if (i2 < 0 || i2 >= side || j2 < 0 || j2 >= side) return;
    const p = j * side + i;
    const q = j2 * side + i2;
    // BOTH ENDS ARE HELD THE SAME DISTANCE OFF A JOINT whether the pair crosses
    // one or not. Holding only the pairs that do NOT is what put `cross`'s own
    // floor high enough to admit a film.
    if (off[p] < WEAVE_CLEAR || off[q] < WEAVE_CLEAR) return;
    let crossed = false;
    for (let k = 1; k < WEAVE_REACH; k += 1) {
      if (lat.joint[(j + dj * k) * side + (i + di * k)]) { crossed = true; break; }
    }
    (crossed ? jumped : held).push(Math.abs(band[p] - band[q]));
  };
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      walk(i, j, 1, 0); walk(i, j, 0, 1); walk(i, j, 1, 1); walk(i, j, 1, -1);
    }
  }
  const inside = weaveSpread(held);
  const across = weaveSpread(jumped);

  // The fine band's own strength, block by block. The blocks are placed off the
  // PICTURE'S dark runs, so the same code answers for the reference as for a
  // render, and a block has to stand clear of every one of them: what is asked is
  // how far the STONE'S grain differs from one piece to the next, and the soil
  // between two pieces is not stone.
  // Its own smoothing is taken WITHOUT the joint mask, and that is not an
  // oversight: the blocks already stand clear of every dark run, and the mask is
  // a thing only this side of the comparison has. The reference has to be read by
  // the same arithmetic or the two numbers are not the same number.
  const fine = new Float64Array(side * side);
  const plain = weaveBox(rel, side, side, WEAVE_BAND);
  for (let i = 0; i < side * side; i++) fine[i] = rel[i] - plain[i];
  const level = weaveBox(rel, side, side, PLAN_LEVEL_BLUR);
  const dark = new Uint8Array(side * side);
  for (let i = 0; i < side * side; i++) dark[i] = level[i] - 1 < PLAN_JOINT ? 1 : 0;
  const away = weaveMarch(dark, side);
  const blocks = [];
  for (let by = 0; by + WEAVE_BLOCK <= side; by += WEAVE_BLOCK) {
    for (let bx = 0; bx + WEAVE_BLOCK <= side; bx += WEAVE_BLOCK) {
      let acc = 0;
      let n = 0;
      for (let j = by; j < by + WEAVE_BLOCK; j++) {
        for (let i = bx; i < bx + WEAVE_BLOCK; i++) {
          const k = j * side + i;
          if (away[k] < WEAVE_BLOCK_CLEAR) continue;
          acc += fine[k] * fine[k]; n += 1;
        }
      }
      if (n > WEAVE_BLOCK * WEAVE_BLOCK * 0.25) blocks.push(Math.sqrt(acc / n));
    }
  }
  const mean = blocks.reduce((t, v) => t + v, 0) / (blocks.length || 1);
  const sd = Math.sqrt(blocks.reduce((t, v) => t + (v - mean) ** 2, 0) / (blocks.length || 1));

  return {
    weld: across > 0 ? inside / across : 0,
    inside,
    across,
    nIn: held.length,
    nAc: jumped.length,
    speck: mean ? sd / mean : 0,
    fineRms: mean,
    blocks: blocks.length,
    fits: weaveFits(rel, lat.joint, side * side),
    jointShare: lat.joint.reduce((t, v) => t + v, 0) / (side * side),
  };
}

const WEAVE_HEAD = `\n  ${'what crosses the joints'.padEnd(36)}${'fits'.padStart(8)}`
  + `${'joint%'.padStart(8)}${'inside'.padStart(9)}${'across'.padStart(9)}`
  + `${'weld'.padStart(8)}${'speck'.padStart(8)}${'fineRms'.padStart(9)}\n`;
const weaveLine = (label, s) => `  ${label.padEnd(36)}${s.fits.toFixed(3).padStart(8)}`
  + `${(100 * s.jointShare).toFixed(1).padStart(8)}`
  + `${(1000 * s.inside).toFixed(1).padStart(9)}${(1000 * s.across).toFixed(1).padStart(9)}`
  + `${s.weld.toFixed(3).padStart(8)}${s.speck.toFixed(3).padStart(8)}`
  + `${(1000 * s.fineRms).toFixed(1).padStart(9)}\n`;

/**
 * The reference's own grain scatter, which is what `speck` is held to.
 *
 * On the SAME square the render is read on, for the reason planReferenceWindows()
 * carries: a band-pass and a block scatter taken over 300 px and over 400 are two
 * readings and not one.
 */
export function weaveReference(img, side) {
  const at = [0, Math.round((img.w - side) / 2), img.w - side];
  const down = [0, Math.round((img.h - side) / 2), img.h - side];
  const rows = [];
  for (const y0 of down) {
    for (const x0 of at) rows.push(weaveRead(img, x0, y0, side, { lattice: false }));
  }
  const mean = (k) => rows.reduce((t, r) => t + r[k], 0) / rows.length;
  const sd = (k) => Math.sqrt(rows.reduce((t, r) => t + (r[k] - mean(k)) ** 2, 0) / rows.length);
  return {
    speck: mean('speck'),
    speckScatter: sd('speck'),
    fineRms: mean('fineRms'),
    fineScatter: sd('fineRms'),
    rows,
  };
}

async function weaveMain(shot) {
  const frame = await readPlanImage(shot);
  if (frame.w !== FRAME.width || frame.h !== FRAME.height) {
    throw new Error(`--weave wants a ${FRAME.width}x${FRAME.height} render `
      + 'of a plan pose');
  }
  // WHICH PLAN THE FRAME IS OF, and it is a whole plan and not just a northing:
  // the window follows the tuning, because the stone is not the same width at
  // the two. `--at=` stays on top of it for a frame shot at neither, because the
  // lattice this read stands on is the lattice AT THAT PLACE: see the note in
  // weaveLattice().
  const plan = planTuning();
  const atFlag = process.argv.find((a) => a.startsWith('--at='));
  const at = atFlag ? Number(atFlag.slice(5)) : plan.z;
  const W = plan.window;
  process.stdout.write(`  ${shot}: ${planTitle(plan)}\n`);
  process.stdout.write(`  ${PLAN_MM_PER_PX} mm a pixel, camera at z=${at}\n`);
  process.stdout.write(WEAVE_HEAD);
  const got = weaveRead(frame, W.x, W.y, W.side, { at });
  process.stdout.write(weaveLine('this world, on its own lattice', got));

  if (existsSync(PLAN_REFERENCE)) {
    const ref = weaveReference(await readPlanImage(PLAN_REFERENCE), W.side);
    process.stdout.write(`  the reference's own grain: speck ${ref.speck.toFixed(3)}`
      + ` (scatter ${ref.speckScatter.toFixed(3)} over nine windows),`
      + ` fineRms ${(1000 * ref.fineRms).toFixed(1)}\n`);
  }

  if (process.argv.includes('--self')) {
    process.stdout.write('\n  THAT THE READING IS STANDING ON THIS WORLD\'S OWN LATTICE\n');
    process.stdout.write(WEAVE_HEAD);
    for (const [what, inj] of [['turned 1 degree', { turn: 1 }],
      ['turned 5 degrees', { turn: 5 }], ['2% wider', { wider: 1.02 }]]) {
      process.stdout.write(weaveLine(`  a lattice ${what}`,
        weaveRead(frame, W.x, W.y, W.side, { at, ...inj })));
    }
    process.stdout.write('\n  INJECTED INTO THE FRAME\n');
    process.stdout.write(WEAVE_HEAD);
    for (const [cell, amp] of [[400, 0.06], [400, 0.12], [154, 0.12]]) {
      process.stdout.write(weaveLine(`  a veil of ${cell} mm pieces, ${(100 * amp).toFixed(0)}%`,
        weaveRead(frame, W.x, W.y, W.side, { at, paint: 'veil', amp, cell })));
    }
    for (const amp of [0.06, 0.12, 0.24]) {
      process.stdout.write(weaveLine(`  the paving's own pieces, ${(100 * amp).toFixed(0)}%`,
        weaveRead(frame, W.x, W.y, W.side, { at, paint: 'slab', amp })));
    }
  }

  const ok = got.weld <= WEAVE_BAR;
  process.stdout.write(`\n  weld ${got.weld.toFixed(3)} of ${WEAVE_BAR.toFixed(2)} allowed`
    + ' (one is a veil, measured): '
    + `${ok ? 'the paving owns what is drawn on it' : 'SOMETHING IS DRAWN ACROSS THE JOINTS'}\n`);
  return ok ? 0 : 1;
}

async function main() {
  // WHAT CROSSES THE JOINTS is asked on its own and answers on its own: it needs
  // no march over the reference pose and no close reference, and a reading that
  // costs minutes it does not use is a reading nobody runs.
  const weaveAt = process.argv.indexOf('--weave');
  if (weaveAt >= 0) {
    const shot = process.argv[weaveAt + 1];
    if (!shot || shot.startsWith('--')) {
      throw new Error('--weave wants the render of a plan pose that follows it');
    }
    return weaveMain(shot);
  }
  const wantsClose = process.argv.includes('--close') || process.argv.includes('--self');
  const wantsPlan = process.argv.includes('--plan') || process.argv.includes('--self');
  let closeReference = null;
  let closeImage = null;
  let closeRows = null;
  let planNulls = null;
  if (wantsClose) {
    if (!existsSync(CLOSE_REFERENCE)) {
      throw new Error(`the close reference of the material is not here: ${CLOSE_REFERENCE}`);
    }
    closeImage = await readImage(CLOSE_REFERENCE);
    closeReference = closeReferenceLines(closeImage);
    closeRows = closeReferenceRows(closeImage);
  }
  if (wantsPlan) {
    if (!existsSync(PLAN_REFERENCE)) {
      throw new Error(`the plan reference of the paving is not here: ${PLAN_REFERENCE}`);
    }
    // ONE READING OF THE REFERENCE PER PLAN, because the nine windows are the
    // size of the square the render is read on. --self asks both; a --plan asks
    // only the one it was pointed at, and pays for only that one.
    const picture = await readPlanImage(PLAN_REFERENCE);
    const wanted = process.argv.includes('--self')
      ? Object.values(PLANS) : [planTuning()];
    planNulls = new Map(wanted.map((plan) => [plan.name,
      { plan, nine: planReferenceWindows(picture, plan.window.side) }]));
  }

  // THE MARCH IS PAID FOR ONLY WHEN IT IS ASKED FOR. Naming which pixels of the
  // reference pose are paving means tracing every one of them into the height
  // field, which is minutes; the plan read does not use a single one of them,
  // because a camera looking straight down needs no ray to know where the ground
  // is. A tool that is being used to choose a coat of paint gets asked the plan
  // question twenty times in a row, and twenty marches for an answer that does
  // not depend on them is how a measure stops being used.
  const wantsPose = process.argv.includes('--self')
    || process.argv.slice(2).some((a, i) => !a.startsWith('--')
      && process.argv[i + 1] !== '--close' && process.argv[i + 1] !== '--plan');
  let target = null;
  let field = null;
  let grit = null;
  let reference = null;
  let gritReference = null;
  if (wantsPose || wantsClose) {
    target = await readTarget();
    field = traceField(target);
    grit = gritField(target);
    process.stdout.write(`${field.cells.length} pixels of the frame are paving between `
      + `${BAND.lo} and ${BAND.hi} metres, and ${grit.length} between `
      + `${GRIT.lo} and ${GRIT.hi}\n\n`);
    reference = statistic(rectify(target, field));
    gritReference = gritBands(target, grit);
    process.stdout.write(HEAD);
    process.stdout.write(line('REFERENCE', reference));
  }

  if (process.argv.includes('--self')) {
    // THE MEASURE, ASKED TO SAY NO AS WELL AS YES.
    //
    // A statistic that flags everything is not a measure, it is an alarm. The
    // reference's near half and its far half are two pieces of one paving, seen
    // at different distances and lit differently; a measure that calls those two
    // different cannot be believed when it calls a render different.
    const near = statistic(rectify(target, halve(field, true)));
    const far = statistic(rectify(target, halve(field, false)));
    process.stdout.write(line('  reference, near half', near));
    process.stdout.write(line('  reference, far half', far));
    process.stdout.write('\n');
    let ok = report(near, far, 'one paving, split in two and measured apart');

    const mid = (GRIT.lo + GRIT.hi) / 2;
    const gritNear = gritBands(target, grit, (c) => c.distance < mid);
    const gritFar = gritBands(target, grit, (c) => c.distance >= mid);
    process.stdout.write(GRIT_HEAD);
    process.stdout.write(gritLine('REFERENCE', gritReference));
    process.stdout.write(gritLine('  reference, near half', gritNear));
    process.stdout.write(gritLine('  reference, far half', gritFar));
    const off = Math.abs(gritNear.grit - gritFar.grit);
    process.stdout.write(`    grit    ${(off * 100).toFixed(2).padStart(11)} pts`
      + `  of ${`${(TOLERANCE_GRIT * 100).toFixed(2)} pts`.padEnd(11)}`
      + `${off > TOLERANCE_GRIT ? 'OUT' : 'ok'}\n`);
    if (off > TOLERANCE_GRIT) ok = false;

    // AND THE CLOSE MEASURE, ASKED THE SAME TWO QUESTIONS.
    //
    // The near half against the far half is the same split as above. The
    // interleaved rows are the floor: they share the distance and the ground, so
    // whatever they disagree by is the measure's own noise and nothing else. The
    // quarters are printed for the reader and spend nothing.
    const middleRow = closeReference[Math.floor(closeReference.length / 2)].py;
    // The rows are split by exactly the predicate the lines are, so the verge and
    // the material of one half are the verge and the material of the same half.
    const kept = closeRows.filter((r) => r.width >= CLOSE_RESOLVED.lo && r.width <= CLOSE_RESOLVED.hi);
    const edgeOf = (pick) => overhangOf(closeImage, kept.filter(pick));
    const whole = closeStatistic(closeReference, overhangOf(closeImage, kept));
    const closeNear = closeStatistic(closeReference.filter((l) => l.py >= middleRow),
      edgeOf((r) => r.py >= middleRow));
    const closeFar = closeStatistic(closeReference.filter((l) => l.py < middleRow),
      edgeOf((r) => r.py < middleRow));
    const oddRows = closeStatistic(closeReference.filter((l, i) => i % 2 === 1),
      edgeOf((r, i) => i % 2 === 1));
    const evenRows = closeStatistic(closeReference.filter((l, i) => i % 2 === 0),
      edgeOf((r, i) => i % 2 === 0));
    process.stdout.write(CLOSE_HEAD);
    process.stdout.write(closeLine('REFERENCE (close)', whole));
    process.stdout.write(closeLine('  reference, near half', closeNear));
    process.stdout.write(closeLine('  reference, far half', closeFar));
    process.stdout.write(closeLine('  reference, odd rows', oddRows));
    process.stdout.write(closeLine('  reference, even rows', evenRows));
    for (let q = 0; q < 4; q++) {
      const lo = Math.floor(closeReference.length * q / 4);
      const hi = Math.floor(closeReference.length * (q + 1) / 4);
      const slice = closeReference.slice(lo, hi);
      process.stdout.write(closeLine(`  reference, quarter ${q + 1} (spends nothing)`,
        closeStatistic(slice, edgeOf((r, i) => i >= lo && i < hi))));
    }
    process.stdout.write('\n');
    if (!reportClose(closeNear, closeFar, 'one material, split by distance and measured apart')) ok = false;
    if (!reportClose(oddRows, evenRows, 'the same rows interleaved: the noise floor')) ok = false;

    // AND THE PLAN MEASURE, ASKED BOTH WAYS ROUND — ONCE PER PLAN.
    //
    // The nine windows are the null: one paving, read nine times in nine places,
    // and whatever they disagree by is what a paving costs. Then two pavings that
    // are NOT this one are fed to it, and it has to say so — a measure that only
    // ever agrees is not a measure. The carpet is the one that matters: it is the
    // shape this world actually took while it was chasing a count of bright runs
    // per path width.
    //
    // TWICE, BECAUSE THERE ARE TWO PLANS AND EACH HAS ITS OWN SQUARE AND ITS OWN
    // SLACK. A set of tolerances that says yes and no in the right places at 400
    // px has proved nothing whatever about 300, and the file carries both.
    for (const { plan, nine } of planNulls.values()) {
      const planRef = planMean(nine);
      process.stdout.write(`\n  ${planTitle(plan)}\n`);
      process.stdout.write(PLAN_HEAD);
      process.stdout.write(planLine('REFERENCE (plan), mean of nine', planRef));
      nine.forEach((w, k) => process.stdout.write(planLine(`  window ${k + 1} of nine`, w)));
      const spread = (key) => {
        const v = nine.map((w) => w[key]).sort((a, b) => a - b);
        return v.at(-1) - v[0];
      };
      process.stdout.write(`    the nine scatter by: slab ${(spread('slab') * 100).toFixed(1)} pts`
        + `  piece ${spread('piece').toFixed(2)} cm  vary ${spread('vary').toFixed(2)} x`
        + `  peb ${spread('peb').toFixed(1)} /m2  shoulder ${(spread('shoulder') * 100).toFixed(1)} pts\n`);
      // One paving, split in two and measured apart: alternate windows, so
      // neither half is one side of the picture.
      if (!reportPlan(planMean(nine.filter((_, k) => k % 2 === 0)),
        planMean(nine.filter((_, k) => k % 2 === 1)),
        `one paving from above at the ${plan.name} window, split in two and measured apart`,
        plan.tolerance)) ok = false;

      for (const kind of ['sheet', 'carpet']) {
        const got = planStatistic(planDegenerate(kind, plan.window.side));
        process.stdout.write(planLine(`  a ${kind}, which is not this paving`, got));
        if (reportPlan(planRef, got, `a ${kind} must NOT pass the ${plan.name} plan`,
          plan.tolerance)) {
          ok = false;
          process.stdout.write(`    THE MEASURE ACCEPTS A ${kind.toUpperCase()}\n`);
        }
      }
    }

    // The evidence that the stone threshold is the cut between a stone and the
    // grain of a stone, printed rather than asserted: what the same counter
    // answers on the same picture as the smallest thing it will call a stone is
    // walked down.
    const planWhole = await readPlanImage(PLAN_REFERENCE);
    process.stdout.write('\n    the stone threshold, walked down the sizes it will accept\n');
    for (const least of [10, 15, 20, 25, 30]) {
      const c = planStones(planWhole, null, { ...PEB, size: [least, PEB.size[1]] });
      process.stdout.write(`      at least ${String(least).padStart(2)} mm across:`
        + `${String(c.count).padStart(7)} stones over ${(planWhole.w * planWhole.h * (PLAN_MM_PER_PX / 1000) ** 2).toFixed(1)} m2`
        + ` = ${c.perM2.toFixed(1).padStart(6)} /m2${least === PEB.size[0] ? '   <- the cut' : ''}\n`);
    }

    process.stdout.write(ok
      ? '\nthe measure does not find a difference where there is none.\n'
      : '\nTHE MEASURE FAILS ITS OWN NULL: it separates one paving from itself.\n');
    if (!ok) process.exitCode = 1;
    return;
  }

  const close = closeArgument();
  const plan = planArgument();
  const frames = process.argv.slice(2)
    .filter((a, i) => !a.startsWith('--') && process.argv[i + 1] !== '--close'
      && process.argv[i + 1] !== '--plan');
  if (!frames.length && !close && !plan) {
    throw new Error('give a render of the reference pose, or --close, --plan, or --self');
  }

  let bad = 0;
  if (plan) {
    if (!existsSync(plan)) throw new Error(`no render at ${plan}`);
    const tuning = planTuning();
    const W = tuning.window;
    const shot = await readPlanImage(plan);
    // A picture that is already exactly the window is read whole. That is how a
    // plan view composed offline is checked while a coat of paint is being
    // chosen — the VERDICT is always a real render at the plan's own pose, which
    // is the only thing that carries the shader.
    const exact = shot.w === W.side && shot.h === W.side;
    if (!exact && (shot.w < W.x + W.side || shot.h < W.y + W.side)) {
      throw new Error(`${plan} is ${shot.w}x${shot.h}: too small for the `
        + `${tuning.name} plan window`);
    }
    // AND THE TUNING IS PRINTED BEFORE THE NUMBERS ARE, not after them. A plan
    // reading without the tuning it was taken in is exactly what made this file
    // measure the near paving and call it the paving.
    process.stdout.write(`  ${planTitle(tuning)}\n`);
    const reference = planMean(planNulls.get(tuning.name).nine);
    const got = planStatistic(exact ? shot : planWindow(shot, W.x, W.y, W.side));
    process.stdout.write(PLAN_HEAD);
    process.stdout.write(planLine('REFERENCE (plan), mean of nine', reference));
    const name = plan.replace(/\\/g, '/').split('/').pop();
    process.stdout.write(planLine(name, got));
    process.stdout.write('\n');
    if (!reportPlan(reference, got, `${name}, against the ${tuning.name} plan`,
      tuning.tolerance)) bad++;
    if (!frames.length && !close) {
      process.stdout.write(bad
        ? `\nthe ${tuning.name} paving from above is not the reference texture's.\n`
        : `\nthe ${tuning.name} paving from above is the reference texture's.\n`);
      if (bad) process.exitCode = 1;
      return;
    }
    process.stdout.write('\n');
  }
  if (close) {
    if (!existsSync(close)) throw new Error(`no render at ${close}`);
    const kept = closeRows.filter((r) => r.width >= CLOSE_RESOLVED.lo && r.width <= CLOSE_RESOLVED.hi);
    const reference = closeStatistic(closeReference, overhangOf(closeImage, kept));
    const shot = await readImage(close);
    const geometry = closeRenderGeometry(shot.width, shot.height);
    const got = closeStatistic(closeRenderLines(shot, geometry),
      overhangOf(shot, closeRenderRows(geometry)));
    process.stdout.write(CLOSE_HEAD);
    process.stdout.write(closeLine('REFERENCE (close)', reference));
    const name = close.replace(/\\/g, '/').split('/').pop();
    process.stdout.write(closeLine(name, got));
    process.stdout.write('\n');
    if (!reportClose(reference, got, name)) bad++;
    if (!frames.length) {
      process.stdout.write(bad
        ? '\nthe material is not the close reference\'s.\n'
        : '\nthe material is the close reference\'s.\n');
      if (bad) process.exitCode = 1;
      return;
    }
    process.stdout.write('\n');
  }

  const measured = [];
  for (const path of frames) {
    if (!existsSync(path)) throw new Error(`no render at ${path}`);
    const image = await readFrame(path);
    measured.push({
      path,
      s: statistic(rectify(image, field)),
      g: gritBands(image, grit),
    });
    process.stdout.write(line(path.replace(/\\/g, '/').split('/').pop(), measured.at(-1).s));
  }

  process.stdout.write(GRIT_HEAD);
  process.stdout.write(gritLine('REFERENCE', gritReference));
  for (const { path, g } of measured) {
    process.stdout.write(gritLine(path.replace(/\\/g, '/').split('/').pop(), g));
  }
  process.stdout.write('\n');

  for (const { path, s, g } of measured) {
    const name = path.replace(/\\/g, '/').split('/').pop();
    let ok = report(reference, s, name);
    const off = Math.abs(g.grit - gritReference.grit);
    process.stdout.write(`    grit    ${(off * 100).toFixed(2).padStart(11)} pts`
      + `  of ${`${(TOLERANCE_GRIT * 100).toFixed(2)} pts`.padEnd(11)}`
      + `${off > TOLERANCE_GRIT ? 'OUT' : 'ok'}\n`);
    if (off > TOLERANCE_GRIT) ok = false;
    if (!ok) bad++;
  }
  if (bad) {
    process.stdout.write(`\n${bad} frame(s) carry a paving the reference does not.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('\nthe paving is the reference\'s.\n');
  }
}

// Only when it is the thing being run. CLOSE_POSE is exported because whoever
// shoots the close frame has to stand exactly there, and a camera that imports
// it must not set a measurement running as a side effect of asking.
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  // --weave answers with a verdict of its own instead of setting the exit on the
  // way past, because it shares none of the machinery the other reads do.
  const code = await main();
  if (code) process.exitCode = code;
}
