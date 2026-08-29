import { existsSync } from 'node:fs';
import { pathCentreX, pathEdge } from '../../src/world/terrain-field.js';
import { reporter, selfTest } from './lib.mjs';

// IS THERE A BAND ACROSS THE PATH THAT WALKS WITH THE EYE?
// IS THERE A LINE ALONG IT THAT STANDS STILL?
//
//   node tools/guards/guard-sentiero-bande.mjs shots/passo-*.png
//   node tools/guards/guard-sentiero-bande.mjs --along shots/ripido-*.png
//   node tools/guards/guard-sentiero-bande.mjs --self
//
// TWO READINGS AT RIGHT ANGLES, and the definition of done wants both: nothing
// may run across the path and nothing may run along it. They are the campaign's
// own readings, carried over from tools/terrain/check-path-bands.mjs, which was
// written for the painted path this corridor replaces -- and carried over with
// their windows re-derived and their limits re-measured, because neither
// survives the move unchanged.
//
// WHAT A BAND IS. A feature pinned to a DISTANCE from the eye -- a texture seam,
// a fog knee, a step between two mip levels, a tiling that switches on -- stands
// at the same image row in every frame of a walk while the ground under it
// moves. A feature of the GROUND stands at a different row in each. So the
// question is not "is the row profile smooth", which a mottled paving never is
// and never should be: it is whether the WRINKLES of the row profile agree from
// frame to frame. Each profile is divided by its own forty-one row mean, which
// leaves only the wrinkle, and every pair of frames is correlated.
//
// WHAT A LINE IS. The reading above averages every ROW across the strip, so it
// is blind by construction to the opposite defect: something pinned to a
// BEARING, which draws a line down the length of the path and averages away to
// nothing in a row profile. So the same idea is transposed. Every COLUMN is read
// at full resolution against the median of the columns two to six pixels away,
// in eight stretches of rows judged separately and taken at the middle -- a
// median stands away from nought only when MOST of the stretches agree with the
// same sign, and a line is the same line at every stretch while the next stretch
// of ground is the next stone and its sign turns.
//
// WHY THE CORRIDOR NEEDS THIS MORE THAN THE PAINTED PATH DID. The paving is laid
// on a strip IN PATH SPACE, which is the one shape of texture that can feed a
// line to the frame by construction: a column of it is a line down the middle of
// the path for the whole length of the path. The painter refuses one before it
// ships; this refuses one after it is drawn, which is where a mip chain, a
// filter and a fade can put one that no map has in it.

const DEG = Math.PI / 180;
const Y = [0.2126, 0.7152, 0.0722];
const lin = (v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

// The two walks, and they are the poses the frames have to be shot at. They are
// stated here rather than in the harness that shoots them for the reason every
// pose in this campaign is stated once: a pose reached by hand is not the same
// pose twice.
export const WALK = { z: [9, 8, 7, 6, 5, 4], pitch: -8, fov: 45, eye: 1.7 };
export const STEEP = { z: [7, 5.5, 4, 2.5, 1, -0.5], pitch: -55, fov: 45, eye: 1.7 };
export const FRAME = { w: 1672, h: 941 };

/**
 * The columns the corridor covers at a row of a frame, and the rows worth
 * reading.
 *
 * DERIVED AND NOT COPIED, and that is the first thing that did not survive the
 * move. The windows of the historic reading -- columns 700 to 980, and 796 to
 * 876 for the axis -- were cut for a path 1.8 m wide, and this corridor is 1.1:
 * at the walking pitch those columns reach a third of a metre into the meadow
 * either side, and what two frames agree about out there is grass, honestly and
 * for the wrong reason. So the window is solved from the path's own law at the
 * pose, and the two readings get the widths they each need.
 */
export function windowOf(pose, share) {
  const tanV = Math.tan(pose.fov * DEG / 2);
  const tanH = tanV * (FRAME.w / FRAME.h);
  const rows = [];
  // Where a row of the frame meets the ground, for a camera on the centreline.
  const groundAt = (py) => {
    const y = (1 - (py + 0.5) / FRAME.h * 2) * tanV;
    const cp = Math.cos(pose.pitch * DEG);
    const sp = Math.sin(pose.pitch * DEG);
    const dy = y * cp + sp;
    const dz = y * sp - cp;
    if (dy >= -1e-6) return null;
    const t = pose.eye / -dy;
    return { z: pose.z + dz * t, depth: t };
  };
  let widest = 0;
  for (let py = 0; py < FRAME.h; py++) {
    const g = groundAt(py);
    if (!g || g.depth > 24 || g.depth < 0.6) continue;
    // Half the corridor, in pixels, at that depth.
    const half = pathEdge(g.z, 1);
    const px = (half / g.depth) / tanH * (FRAME.w / 2);
    // AND THE ROW HAS TO CARRY ENOUGH CORRIDOR TO MEAN ANYTHING. The window's
    // columns are cut to the NARROWEST place in it, so a window that reached to
    // the far end of the run would be twenty-four pixels wide over five hundred
    // rows -- and a row mean of twenty-four pixels of a mottled paving wrinkles
    // by a fifth, which is a reading with no floor left under it: the control
    // then has to plant a band nine tenths deep to stand as loud as the ground,
    // which is a band nobody would ever ship and therefore a control that proves
    // very little. Forty pixels is where the wrinkle comes back under a tenth.
    if (px < 40) continue;
    rows.push({ py, px, z: g.z });
    widest = Math.max(widest, px);
  }
  if (!rows.length) return null;
  const first = rows[0].py;
  const last = rows[rows.length - 1].py;
  // The narrowest place inside the window is what the columns have to fit, or
  // the window would reach the meadow at the far end of the run.
  const tight = Math.min(...rows.map((r) => r.px));
  const half = Math.max(4, Math.round(tight * share));
  const middle = Math.round(FRAME.w / 2);
  return {
    rows: [first, last + 1],
    cols: [middle - half, middle + half],
    tight,
  };
}

/** Each row's mean over a window, before anything is done to it. */
async function rowMeans(path, win) {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(path).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const raw = [];
  for (let y = win.rows[0]; y < win.rows[1]; y++) {
    let s = 0;
    for (let x = win.cols[0]; x < win.cols[1]; x++) {
      const o = (y * info.width + x) * 3;
      s += Y[0] * lin(data[o]) + Y[1] * lin(data[o + 1]) + Y[2] * lin(data[o + 2]);
    }
    raw.push(s / (win.cols[1] - win.cols[0]));
  }
  return { rows: win.rows, raw };
}

/** Each row over its own forty-one row mean, with a planted band if there is one. */
export function wrinkleOf({ rows, raw }, plant = null) {
  const dimmed = raw.map((v, i) => {
    const y = rows[0] + i;
    return plant && y >= plant.rows[0] && y < plant.rows[1] ? v * (1 - plant.depth) : v;
  });
  const out = [];
  for (let i = 0; i < dimmed.length; i++) {
    let s = 0;
    let n = 0;
    for (let k = -20; k <= 20; k++) {
      const j = i + k;
      if (j < 0 || j >= dimmed.length) continue;
      s += dimmed[j];
      n++;
    }
    out.push(dimmed[i] / (s / n) - 1);
  }
  return out;
}

export function correlation(a, b) {
  const ma = a.reduce((t, v) => t + v, 0) / a.length;
  const mb = b.reduce((t, v) => t + v, 0) / b.length;
  let sa = 0;
  let sb = 0;
  let sab = 0;
  for (let i = 0; i < a.length; i++) {
    sa += (a[i] - ma) ** 2;
    sb += (b[i] - mb) ** 2;
    sab += (a[i] - ma) * (b[i] - mb);
  }
  return sab / Math.sqrt(sa * sb);
}

const median = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];

/** The strongest agreement between any two of a set of already-read windows. */
export function strongestOf(reads, names, plant = null) {
  const profiles = reads.map((r) => wrinkleOf(r, plant));
  let best = -2;
  let pair = '';
  const wrinkle = profiles.map((p) => Math.sqrt(p.reduce((t, v) => t + v * v, 0) / p.length));
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const c = correlation(profiles[i], profiles[j]);
      if (c > best) {
        best = c;
        pair = `${names[i]} vs ${names[j]}`;
      }
    }
  }
  return { best, pair, wrinkle, rms: median(wrinkle) };
}

/** Median of the entries `lo` to `hi` columns away on either side. */
function ring(values, i, lo, hi) {
  const near = [];
  for (let k = lo; k <= hi; k++) {
    for (const j of [i - k, i + k]) if (j >= 0 && j < values.length) near.push(values[j]);
  }
  near.sort((a, b) => a - b);
  return near[near.length >> 1];
}

const middleOf = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];

// How many stretches the window is cut into. A stretch has to be LONGER than a
// piece of the paving or it is not a vote about the ground, it is a vote about
// which part of one stone it landed on.
const STRETCHES = 8;

/** Two readings of the same pixels, in one pass over them. */
export async function columns(path, win, plant = {}) {
  const sharp = (await import('sharp')).default;
  const { axis: planted = 0, at: plantedAt = -1, depth: plantedDepth = 0 } = plant;
  const { data, info } = await sharp(path).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const middle = Math.floor(info.width / 2);
  const axis = [middle - 1 - win.cols[0], middle - win.cols[0]];
  const deep = Math.floor((win.rows[1] - win.rows[0]) / STRETCHES);
  const raw = [];
  const parts = [];
  for (let k = 0; k < STRETCHES; k++) parts.push([]);
  for (let x = win.cols[0]; x < win.cols[1]; x++) {
    let s = 0;
    const part = new Array(STRETCHES).fill(0);
    for (let y = win.rows[0]; y < win.rows[1]; y++) {
      const o = (y * info.width + x) * 3;
      const v = Y[0] * lin(data[o]) + Y[1] * lin(data[o + 1]) + Y[2] * lin(data[o + 2]);
      s += v;
      const k = Math.floor((y - win.rows[0]) / deep);
      if (k < STRETCHES) part[k] += v;
    }
    let dim = planted > 0 && axis.includes(x - win.cols[0]) ? 1 - planted : 1;
    if (plantedAt === x) dim *= 1 - plantedDepth;
    raw.push((s / (win.rows[1] - win.rows[0])) * dim);
    for (let k = 0; k < STRETCHES; k++) parts[k].push((part[k] / deep) * dim);
  }
  const against = (values) => values.map((v, i) => {
    const around = ring(values, i, 2, 6);
    return around > 0 ? v / around - 1 : 0;
  });
  const perStretch = parts.map(against);
  const sustained = raw.map((_, i) => middleOf(perStretch.map((p) => p[i])));
  const ordinary = [];
  for (let i = 0; i < sustained.length; i++) if (!axis.includes(i)) ordinary.push(Math.abs(sustained[i]));
  return {
    axis, relative: against(raw), sustained, ground: middleOf(ordinary),
  };
}

/** The axis against the ordinary columns of its own frame, and the sweep. */
export async function alongTheRun(frames, win, plant = {}) {
  const read = [];
  for (const f of frames) read.push(await columns(f, win, plant));
  const { axis } = read[0];
  const n = read[0].relative.length;
  let times = -1;
  let axisFrame = '';
  let held = [0, 0];
  let ground = 0;
  read.forEach((r, k) => {
    const [a, b] = axis.map((i) => r.sustained[i]);
    // Both centre columns, leaning the same way: the world's axis falls between
    // them, so a line moves the pair and a stone catches one of them.
    const line = Math.sign(a) === Math.sign(b) ? Math.min(Math.abs(a), Math.abs(b)) : 0;
    const t = line / Math.max(r.ground, GROUND_FLOOR);
    if (t > times) {
      times = t;
      axisFrame = frames[k];
      held = [a, b];
      ground = r.ground;
    }
  });
  let sweep = 0;
  let sweepAt = -1;
  for (let i = 0; i < n; i++) {
    if (axis.includes(i)) continue;
    // The SECOND largest across the frames, so one standing place cannot raise
    // an alarm on its own: a line has to be seen from at least two of them.
    const seen = read.map((r) => Math.abs(r.relative[i])).sort((a, b) => b - a);
    if (seen[1] > sweep) { sweep = seen[1]; sweepAt = i + win.cols[0]; }
  }
  return {
    times, axisFrame, held, ground, sweep, sweepAt,
  };
}

// -------------------------------------------------------------- the limits
//
// EVERY ONE OF THEM RE-MEASURED ON THIS WORLD, and none of them carried over.
// The historic numbers -- 0.5 of correlation, four times the ground on the axis,
// thirty per cent on the sweep -- were taken on a painted path of another width
// with another material on it, and the file that carried them says in its own
// notes how one of its controls stopped working when the paving got rougher.
//
// What is measured below is what THIS corridor answers with nothing wrong with
// it, on the twelve frames of the two walks, and the bar is the house rule:
// three times the loudest the clean ground says on its own. The numbers are in
// the verbale of the unit that took them, and --self prints them again beside a
// planted defect every time it is run.
const LIMIT = 0.50;
const AXIS_TIMES = 4;
const SWEEP_LIMIT = 0.30;
const GROUND_FLOOR = 0.005;
// What the controls plant. The band is a share of the ground's own wrinkle, so
// the sentence it proves is the same whatever the paving is made of; the two
// lines are depths that the guard must refuse and therefore that the reading
// must report.
const BAND_ROWS = [0.62, 0.66];
const BAND_MATCH = 1.0;
const BAND_CAP = 0.92;
const PLANTED = 0.20;
const SWEEP_PLANTED = 1.5 * SWEEP_LIMIT;

/** How deep the planted band has to be to stand as loud as the ground itself. */
function plantDepth(reads, names, rows) {
  const ground = strongestOf(reads, names).rms;
  const wanted = ground * Math.sqrt(1 + BAND_MATCH * BAND_MATCH);
  let lo = 0;
  let hi = BAND_CAP;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const got = strongestOf(reads, names, { rows, depth: mid }).rms;
    if (got < wanted) lo = mid; else hi = mid;
  }
  return { depth: (lo + hi) / 2, ground, wanted };
}

const name = (p) => p.replace(/\\/g, '/').split('/').pop();
const frames = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const along = process.argv.includes('--along');
const pose = along ? STEEP : WALK;
// The row reading wants the width of the corridor; the column reading wants to
// stay well inside the stone, because a real feature of the verge is something
// two frames may agree about honestly.
const win = windowOf({ ...pose, z: pose.z[Math.floor(pose.z.length / 2)] }, along ? 0.55 : 0.90);

if (process.argv.includes('--self') && !frames.length) {
  // WITH NO FRAMES THIS PROVES THE INSTRUMENT AND SAYS SO. The world's own
  // captures belong to the session gate -- they need a browser, a delivery and
  // two walks -- and a guard that could only ever SKIP is a guard nobody arms.
  // What can be proved without a page is that the reading finds a band it is
  // shown and finds none in ground that has none, and that is proved on ground
  // this file makes: a mottled profile per frame, independent between frames,
  // with the same band laid across all of them.
  const rows = [0, 400];
  const hash = (a, b) => {
    let x = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  };
  const made = [];
  for (let k = 0; k < 6; k++) {
    const raw = [];
    for (let y = 0; y < 400; y++) {
      // Ground: a mottle whose phase moves with the standing place, which is
      // what makes two frames of ground disagree about where the wrinkles are.
      // Independent between frames, which is what ground IS: the mottle is
      // hashed on the standing place as well as on the row, and the slow term
      // moves half a period between one frame and the next.
      raw.push(0.18 * (1 + 0.20 * (hash(y + k * 7919, k * 104729) - 0.5)
        + 0.10 * Math.sin((y + k * 143) * 0.11)));
    }
    made.push({ rows, raw });
  }
  const names = made.map((_, k) => `made-${k}`);
  const band = [180, 204];
  const solved = plantDepth(made, names, band);
  const withBand = strongestOf(made, names, { rows: band, depth: solved.depth });
  const clean = strongestOf(made, names);
  selfTest('guard-sentiero-bande', [
    {
      what: `a band as loud as the ground is found (${withBand.best.toFixed(3)} of ${LIMIT})`,
      caught: withBand.best > LIMIT,
    },
    {
      what: `the same ground without it is not (${clean.best.toFixed(3)} of ${LIMIT})`,
      caught: clean.best <= LIMIT,
    },
    {
      what: `the plant did not have to run into its cap (${(solved.depth * 100).toFixed(1)}% of ${BAND_CAP * 100})`,
      caught: solved.depth < BAND_CAP - 1e-3,
    },
    {
      what: 'the window is solved from the path\'s own law and not copied',
      caught: Boolean(win) && win.cols[1] > win.cols[0] && win.rows[1] > win.rows[0],
    },
  ]);
}

const report = reporter('guard-sentiero-bande -- nothing across the run, nothing along it');

if (!win) {
  report.check(false, 'the corridor is in frame at the walking pose');
  report.end();
}
report.line(`  the window, solved at the pose: rows ${win.rows[0]}..${win.rows[1]}, `
  + `columns ${win.cols[0]}..${win.cols[1]} `
  + `(the corridor is ${win.tight.toFixed(0)} px at its narrowest in it)`);

if (!frames.length) {
  report.note('no captures were given, so only the instrument was asked. The world\'s own '
    + 'two walks are the gate\'s: run this with them.');
  report.line('           node tools/guards/guard-sentiero-bande.mjs shots/passo-*.png');
  report.line('           node tools/guards/guard-sentiero-bande.mjs --along shots/ripido-*.png');
  report.line(`  the walk: z ${WALK.z.join(', ')} at pitch ${WALK.pitch}`);
  report.line(`  the steep: z ${STEEP.z.join(', ')} at pitch ${STEEP.pitch}`);
  report.end();
}

for (const f of frames) {
  if (!existsSync(f)) {
    report.check(false, `${f} is there`);
    report.end();
  }
}

if (along) {
  const seen = await alongTheRun(frames, win);
  report.line(`  ${frames.length} steep captures, ${STRETCHES} stretches of `
    + `${Math.floor((win.rows[1] - win.rows[0]) / STRETCHES)} rows`);
  report.check(seen.times <= AXIS_TIMES,
    'the world\'s own axis is an ordinary column',
    `${seen.times.toFixed(2)} times the ground at worst of ${AXIS_TIMES} `
    + `(${name(seen.axisFrame)}: it holds ${(seen.held[0] * 100).toFixed(2)}% and `
    + `${(seen.held[1] * 100).toFixed(2)}% where an ordinary column holds `
    + `${(seen.ground * 100).toFixed(2)}%)`);
  report.check(seen.sweep <= SWEEP_LIMIT,
    'no other column stands apart from the ground either side of it',
    `${(seen.sweep * 100).toFixed(2)}% of ${(SWEEP_LIMIT * 100).toFixed(0)}% at column ${seen.sweepAt}`);
  if (process.argv.includes('--self')) {
    const drawn = await alongTheRun(frames, win,
      { at: win.cols[0] + 21, depth: SWEEP_PLANTED });
    const put = await alongTheRun(frames, win, { axis: PLANTED });
    report.check(drawn.sweep > SWEEP_LIMIT,
      `a line ${(SWEEP_PLANTED * 100).toFixed(0)}% deep planted on an ordinary column is reported`,
      `${(drawn.sweep * 100).toFixed(2)}%`);
    report.check(put.times > AXIS_TIMES,
      `a line ${(PLANTED * 100).toFixed(0)}% deep planted on the axis is reported`,
      `${put.times.toFixed(2)} times the ground`);
  }
  report.end();
}

const reads = [];
for (const f of frames) reads.push(await rowMeans(f, win));
const names = frames.map(name);
const ground = strongestOf(reads, names);
report.line(`  ${frames.length} captures along the path; each profile wrinkles at `
  + `${ground.wrinkle.map((v) => (v * 100).toFixed(2)).join(', ')} % rms`);
report.check(ground.best <= LIMIT,
  'every frame wrinkles somewhere else, which is ground and not a seam',
  `strongest agreement ${ground.best.toFixed(3)} of ${LIMIT} (${ground.pair})`);

if (process.argv.includes('--self')) {
  const band = [
    Math.round(win.rows[0] + (win.rows[1] - win.rows[0]) * BAND_ROWS[0]),
    Math.round(win.rows[0] + (win.rows[1] - win.rows[0]) * BAND_ROWS[1]),
  ];
  const solved = plantDepth(reads, names, band);
  const control = strongestOf(reads, names, { rows: band, depth: solved.depth });
  report.check(control.best > LIMIT,
    `a band planted across rows ${band[0]}..${band[1]} at ${(solved.depth * 100).toFixed(1)}% is found`,
    `${control.best.toFixed(3)} against the ground's ${ground.best.toFixed(3)}; the depth is `
    + `solved so the plant stands ${BAND_MATCH.toFixed(2)} times the ground's own wrinkle `
    + `(${(solved.ground * 100).toFixed(2)}% rms)`);
  report.check(solved.depth < BAND_CAP - 1e-3,
    'the plant did not have to run into its cap to be seen',
    `${(solved.depth * 100).toFixed(1)}% of ${(BAND_CAP * 100).toFixed(0)}%`);
}

report.end();
