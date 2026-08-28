import { existsSync } from 'node:fs';
import sharp from 'sharp';

// IS THERE A BAND ACROSS THE PATH THAT WALKS WITH THE EYE?
// IS THERE A LINE ALONG IT THAT STANDS STILL?
//
//   node tools/terrain/check-path-bands.mjs walk-*.png
//   node tools/terrain/check-path-bands.mjs --self walk-*.png
//   node tools/terrain/check-path-bands.mjs --along steep-*.png
//   node tools/terrain/check-path-bands.mjs --along --self steep-*.png
//
// Two readings, at right angles to each other, and the definition of done wants
// both: nothing may run across the path and nothing may run along it.
//
// The frames are captures of the same bearing one metre apart along the path.
//
// A band pinned to a DISTANCE from the eye — a texture seam, a fog knee, a step
// between two mip levels, a detail tiling that switches on — stands at the same
// image row in every one of them while the ground under it moves. A feature of
// the GROUND stands at a different row in each. So the question is not "is the
// row profile smooth", which a mottled path never is and never should be: it is
// whether the WRINKLES of the row profile agree from frame to frame.
//
// Each profile is divided by its own forty-one row mean, which leaves only the
// wrinkle, and every pair of frames is correlated. Ground gives a small number
// because two frames wrinkle in different places. A band gives a large one.
//
// AND THE MEASURE HAS ITS OWN POSITIVE CONTROL, which is why `--self` exists:
// it has to find a band it is SHOWN and find none in the ground. A measure that
// cannot do the first is not sensitive, and one that cannot do the second is an
// alarm rather than a measure.
//
// THE CONTROL USED TO BE THE INTERFACE, AND THE GROUND OUTGREW IT. "E
// Interagisci" is drawn at a fixed row of every frame, which is exactly the
// signature this hunts, and while the paving was smooth it answered 0.60 against
// a ground of 0.40. The paving of 2026-08-27 carries three to four times the
// material the one that control was written on did — the row profiles wrinkle at
// 13 to 19% rms where they used to wrinkle at a few — and the same wall of text
// answered 0.423 against a ground of 0.430: BELOW it. The control failed and the
// two guards it stands behind could not be believed either way, which DEV-S3k put
// on the record as a limit of the instrument.
//
// So the control is PLANTED and the plant is SCALED TO THE GROUND IT STANDS ON: a
// band of rows dimmed by whatever depth makes its own contribution to the profile
// equal to that ground's own wrinkle. On a quiet paving that is a shallow band and
// on a loud one a deep one, and the sentence the control proves is the same
// either way — a band as loud as the ground is found, and the same frames without
// it are not. The interface is still read and still printed, as a witness of how
// far the ground has come; it is no longer what the control turns on.

const Y = [0.2126, 0.7152, 0.0722];
const lin = (v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

// The middle of the frame, which is where the path is at every one of these
// standing places, and the ground between the horizon and the interface.
const COLS = [700, 980];
const GROUND = [480, 840];
const WITH_INTERFACE = [500, 900];

// Above this two frames are saying the same thing at the same row, which is a
// band. The interface read 0.60 when this was written and open ground has never
// read above 0.44.
const LIMIT = 0.5;

// THE BAND THE CONTROL PLANTS, AND THE ONE NUMBER THAT SIZES IT.
//
// Twenty-four rows, which at these standing places is a ring of ground a metre
// or so deep — the shape of the defects this hunts, a mip step or a tiling that
// switches on, and narrow enough that the forty-one row mean the profile is
// divided by does not simply absorb it. A band much wider than that mean is
// invisible to this reading BY CONSTRUCTION, because inside it the numerator and
// the denominator are dimmed alike; that is not a weakness, it is what "wrinkle"
// means, and it is why the plant is narrow.
const BAND_ROWS = [600, 624];
// How loud the plant is made, as a share of the ground's OWN wrinkle. One means
// the planted band contributes exactly as much rms to the profile as everything
// the ground does, which is a band nobody would argue about and which stays the
// same sentence whatever the paving is made of. The depth that achieves it is
// solved on the frames in hand, not written down: on the paving of 2026-08-27 it
// comes out near seven tenths, and on the smooth one this file was written for it
// would come out near a fifth.
const BAND_MATCH = 1.0;
// A dimming cannot pass one, and a plant that needs to would be a reading with no
// sensitivity left at all rather than a plant that is too shallow. If the solve
// ever runs into this the control says so instead of quietly planting a stop.
const BAND_CAP = 0.92;

// ------------------------------------------------- the reading along the path
//
// THE OTHER AXIS, AND WHY IT NEEDED ITS OWN READING. The one above averages
// every ROW across the strip and asks whether two frames wrinkle at the same
// row: that finds anything pinned to a DISTANCE from the eye. It is blind by
// construction to the opposite defect — something pinned to a BEARING, which
// draws a line down the length of the path and averages away to nothing in a
// row profile.
//
// A steep look down the path was carrying exactly that: a hairline one to two
// pixels wide standing at the same place in two poses and two cameras, and the
// row reading called the ground clean while it was there. So this transposes
// the same idea. Every COLUMN is read at full resolution — one pixel, no
// smoothing — against the median of the columns two to six pixels away.
// Anything crossing the path wanders from column to column and averages out;
// anything running along it survives. How far down the run a column is read
// before it is judged is the whole of the second half of this file.
//
// WHERE THE MIDDLE OF THE FRAME IS THE MIDDLE OF THE WORLD. Every standing
// place this is given has the camera on x = 0 looking down the run, and a world
// line at x = 0 seen from a camera at x = 0 projects to the middle column of
// the frame at any pitch whatever, because its camera-space X is nought all the
// way along. So the two columns either side of the middle are the world's own
// axis, and they get read on their own as well as swept with the rest: that is
// the bearing the grid, the lattice of the paving and the centreline of the
// path all pass through, which is three reasons for a line to appear there and
// none for one to appear anywhere else.
const LINE_ROWS = [300, 700];
// Well inside the stone at every one of those standing places. Wider than this
// and the window reaches the verge, whose real structure two frames can agree
// about honestly.
const LINE_COLS = [796, 876];
// The rows that carry the interface, which stands at fixed COLUMNS in every
// frame and is therefore the sweep's positive control, exactly as it is the row
// reading's. What the axis takes for a control is further down, and is not this.
const LINE_CONTROL_ROWS = [845, 935];

// The sweep is three times what the ground answers with no line in it, measured
// on six steep captures at three northings of a world whose line has been
// closed: 4.02% before the stone was given its tooth and 9.75% after it. It is
// a coarse net and not a sharp instrument — a real feature of the verge answers
// 9.75% either way — so it is set to catch a line somewhere the axis is not
// looking, and only one stronger than the strongest thing the ground says on
// its own.
const SWEEP_LIMIT = 0.30;

// A LINE IS SEEN FROM EVERY PLACE ALONG THE RUN. A STONE IS SEEN FROM ONE.
//
// Averaging a column down the whole window and asking how far it stands from
// the ground either side answers with the MATERIAL as much as with the defect.
// Four hundred rows of column cross something like fourteen pieces of the bed,
// and if those pieces differ by a quarter then their count alone puts several
// per cent on the answer: 25/√14 is 6.7. Cut the paving finer, lay it rougher,
// give the stone a coarser tooth, and the number moves with no line in sight.
// A limit written as a fixed percentage is a limit on the PAVING, and it
// behaved like one: it was taken on a smoother stone than the one laid now, and
// the same arithmetic says four per cent needs pieces that differ by no more
// than a sixth, while the stone this paving is cut to match differs by a third.
// It was asking the paving to be wrong so that the reading could be right.
//
// So a column is read as a RUN OF STRETCHES instead. The window is cut into
// eight, each stretch is scored against its ring on its own, and the reading is
// the MEDIAN of the eight. A median stands away from nought only when MOST of
// the stretches say the same thing with the same SIGN, and that is exactly the
// difference between the two things this has to tell apart. A line is the same
// line at every stretch of the run. The next stretch of ground is the next
// stone, and its sign turns. Eight stones cannot agree five times over; a line
// has no choice but to.
//
// Eight and not eighty: a stretch has to be LONGER than a piece of the bed or
// it is not a vote about the ground, it is a vote about which part of one stone
// it landed on, and neighbouring stretches then agree with each other for a
// reason that has nothing to do with a line. Fifty rows is a piece or two at
// these standing places, which is the shortest a stretch can honestly be.
//
// AND WHAT IT IS WEIGHED AGAINST IS NO LONGER A NUMBER WRITTEN DOWN HERE, but
// what an ORDINARY COLUMN of the same frame says, read in exactly the same way:
// the median of the seventy-eight columns that are not the axis. On clean
// ground the axis IS an ordinary column and the answer is about one, whatever
// the stone is made of. Recut the paving and it stays about one.
//
// The two centre columns must also agree in sign, and the smaller of the two is
// what counts. The world's axis falls between them — that is where u = 0.5
// lands — so anything standing on it moves both, while something that catches
// only one of them is a stone.

// How many stretches the window is cut into.
const STRETCHES = 8;
// Three times the loudest that clean ground has answered. Twelve sets of six
// steep captures, four of them carrying the known line down the middle of the
// run and eight of them with it closed:
//
//   with the line     5.50, 9.19, 14.88, 48.40 times the ground
//   without it        0.47 … 1.33 — eight worlds and three cuts of paving,
//                     the roughest of them the one that is laid now
//
// Worth seeing what the clean answer IS: about one, on every one of the eight,
// smooth stone and rough alike. The axis of a world with no line in it is an
// ordinary column, which is the whole reason for weighing it against ordinary
// columns and the reason a percentage could not do the job.
const AXIS_TIMES = 4;
// A denominator cannot be nought. On real captures the ground has answered
// between 0.44% and 7.78%, so this never engages; it is here so that a frame
// with nothing in it cannot be made to report a line.
const GROUND_FLOOR = 0.005;
// The depth of the line the control plants on the axis, taken at the SHALLOW
// end of what the line down the middle of the run stood at when it was there:
// 18.9% on the roughest paving that carried it, 25.4% on the smoothest. A
// control planted at the deep end would prove less than the reading claims.
const PLANTED = 0.20;
// AND THE SWEEP GETS A PLANTED LINE OF ITS OWN, for the reason the row reading
// does: the interface was its control and the ground outgrew it.
//
// The sweep asks how far one column stands from the ground two to six columns
// away, and the interface is a WALL of text — it lifts the whole window
// together, so what is left of it as a per-column excursion is 9.0% against a
// bar of 30.0, and it fails a control it once passed. It is still read and
// printed as a witness.
//
// This plant is NOT scaled to the ground the way the row reading's band is, and
// the difference is in the guards and not in the taste: SWEEP_LIMIT is an
// absolute share and not a ratio to anything, so the only depth that proves
// anything is one ABOVE the bar. Half again the bar, which is a line the guard
// must refuse and therefore a line the reading must report.
const SWEEP_PLANTED = 1.5 * SWEEP_LIMIT;
// Where it is planted: a column well inside the window and well away from the
// two centre ones, which have a control of their own. Its own ring — two to six
// columns either side — is untouched, so what the reading answers is the plant
// and not a shifted surround.
const SWEEP_COLUMN = LINE_COLS[0] + 21;

/**
 * The mean of every row of the window, before anything is done to it.
 *
 * Separated from the wrinkle below so that the control can dim a band of rows at
 * one depth after another without reading the pixels again: the depth of the
 * plant is SOLVED on these frames, and a solve that re-read fourteen captures at
 * every step would cost a minute to prove a control.
 */
async function rowMeans(path, rows) {
  const { data, info } = await sharp(path).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const raw = [];
  for (let y = rows[0]; y < rows[1]; y++) {
    let s = 0;
    for (let x = COLS[0]; x < COLS[1]; x++) {
      const o = (y * info.width + x) * 3;
      s += Y[0] * lin(data[o]) + Y[1] * lin(data[o + 1]) + Y[2] * lin(data[o + 2]);
    }
    raw.push(s / (COLS[1] - COLS[0]));
  }
  return { rows, raw };
}

/** Each row over its own forty-one row mean, with the plant applied if there is one. */
function wrinkleOf({ rows, raw }, plant = null) {
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

function correlation(a, b) {
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
function strongestOf(reads, names, plant = null) {
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

async function readAll(frames, rows) {
  const out = [];
  for (const f of frames) out.push(await rowMeans(f, rows));
  return out;
}

async function strongest(frames, rows) {
  return strongestOf(await readAll(frames, rows), frames.map(name));
}

/**
 * How deep the planted band has to be to stand as loud as the ground itself.
 *
 * The wrinkle of a profile with an independent band added to it grows as the
 * root of the sum of the squares, so "the plant contributes BAND_MATCH times the
 * ground's own wrinkle" is a target on the total, and the depth that reaches it
 * is monotone in the depth. Bisected, because the forty-one row mean makes the
 * relation between the two a good deal less tidy than that argument suggests and
 * a solve costs nothing once the pixels are in hand.
 */
function plantDepth(reads, names) {
  const ground = strongestOf(reads, names).rms;
  const wanted = ground * Math.sqrt(1 + BAND_MATCH * BAND_MATCH);
  let lo = 0;
  let hi = BAND_CAP;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const got = strongestOf(reads, names, { rows: BAND_ROWS, depth: mid }).rms;
    if (got < wanted) lo = mid; else hi = mid;
  }
  return { depth: (lo + hi) / 2, ground, wanted };
}

const name = (p) => p.replace(/\\/g, '/').split('/').pop();

/** Median of the entries `lo` to `hi` columns away on either side. */
function ring(values, i, lo, hi) {
  const near = [];
  for (let k = lo; k <= hi; k++) {
    for (const j of [i - k, i + k]) if (j >= 0 && j < values.length) near.push(values[j]);
  }
  near.sort((a, b) => a - b);
  return near[near.length >> 1];
}

/** The middle of a list, which is far from nought only if most of it agrees. */
function middleOf(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
}

/**
 * Two readings of the same pixels, in one pass over them.
 *
 * `relative` is every column over the WHOLE window against the ground two to
 * six pixels away, which is what the sweep asks for. `sustained` is that same
 * comparison made inside each stretch of rows on its own and then taken at the
 * middle, which is what the axis asks for, and `ground` is what an ordinary
 * column of this frame answers to the second question.
 *
 * A median rather than a mean for the surround: a notch one or two pixels wide
 * would drag a mean of eleven columns towards itself and hide a fifth of its
 * own depth.
 */
async function columns(path, rows, plant = {}) {
  const { axis: planted = 0, at: plantedAt = -1, depth: plantedDepth = 0 } = plant;
  const { data, info } = await sharp(path).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const middle = Math.floor(info.width / 2);
  // The world's axis, as an index into the window above.
  const axis = [middle - 1 - LINE_COLS[0], middle - LINE_COLS[0]];
  const deep = Math.floor((rows[1] - rows[0]) / STRETCHES);
  const raw = [];
  const parts = [];
  for (let k = 0; k < STRETCHES; k++) parts.push([]);
  for (let x = LINE_COLS[0]; x < LINE_COLS[1]; x++) {
    let s = 0;
    const part = new Array(STRETCHES).fill(0);
    for (let y = rows[0]; y < rows[1]; y++) {
      const o = (y * info.width + x) * 3;
      const v = Y[0] * lin(data[o]) + Y[1] * lin(data[o + 1]) + Y[2] * lin(data[o + 2]);
      s += v;
      const k = Math.floor((y - rows[0]) / deep);
      if (k < STRETCHES) part[k] += v;
    }
    // The control's planted lines, which are the only thing that ever tells
    // these captures apart from the ones on disk: one on the axis, for the
    // reading that weighs the axis against ordinary columns, and one on a named
    // ordinary column, for the sweep.
    let dim = planted > 0 && axis.includes(x - LINE_COLS[0]) ? 1 - planted : 1;
    if (plantedAt === x) dim *= 1 - plantedDepth;
    raw.push((s / (rows[1] - rows[0])) * dim);
    for (let k = 0; k < STRETCHES; k++) parts[k].push((part[k] / deep) * dim);
  }
  const against = (values) => values.map((v, i) => {
    const around = ring(values, i, 2, 6);
    return around > 0 ? v / around - 1 : 0;
  });
  const perStretch = parts.map(against);
  const sustained = raw.map((_, i) => middleOf(perStretch.map((p) => p[i])));
  const ordinary = [];
  for (let i = 0; i < sustained.length; i++) {
    if (!axis.includes(i)) ordinary.push(Math.abs(sustained[i]));
  }
  return {
    axis, relative: against(raw), sustained, ground: middleOf(ordinary),
  };
}

/**
 * The axis against the ordinary columns of its own frame, and the strongest
 * agreement anywhere else.
 *
 * The sweep asks for the SECOND largest reading of each column across the
 * frames, so one standing place cannot raise an alarm on its own: a line has to
 * be seen from at least two of them, which is what makes it a line and not a
 * stone.
 */
async function alongTheRun(frames, rows, plant = {}) {
  const read = [];
  for (const f of frames) read.push(await columns(f, rows, plant));
  const { axis } = read[0];
  const n = read[0].relative.length;

  let times = -1;
  let axisFrame = '';
  let held = [0, 0];
  let ground = 0;
  read.forEach((r, k) => {
    const [a, b] = axis.map((i) => r.sustained[i]);
    // Both centre columns, and leaning the same way: the axis falls between
    // them, so a line moves the pair and a stone catches one of them.
    const line = Math.sign(a) === Math.sign(b) ? Math.min(Math.abs(a), Math.abs(b)) : 0;
    const t = line / Math.max(r.ground, GROUND_FLOOR);
    if (t > times) {
      times = t;
      axisFrame = name(frames[k]);
      held = [a, b];
      ground = r.ground;
    }
  });

  let sweep = 0;
  let sweepAt = -1;
  for (let i = 0; i < n; i++) {
    if (axis.includes(i)) continue;
    const seen = read.map((r) => Math.abs(r.relative[i])).sort((a, b) => b - a);
    if (seen[1] > sweep) { sweep = seen[1]; sweepAt = i + LINE_COLS[0]; }
  }
  return {
    times, axisFrame, held, ground, sweep, sweepAt,
    axisColumns: axis.map((i) => i + LINE_COLS[0]),
  };
}

async function along(frames) {
  const say = (r, rows) => {
    process.stdout.write(`  rows ${rows[0]}..${rows[1]}, columns ${LINE_COLS[0]}..${LINE_COLS[1]}, `
      + `${STRETCHES} stretches of ${Math.floor((rows[1] - rows[0]) / STRETCHES)} rows\n`);
    process.stdout.write(`  the world's axis, columns ${r.axisColumns.join(' and ')}: `
      + `${r.times.toFixed(2)} times the ground at worst (${r.axisFrame})\n`);
    process.stdout.write(`    it holds ${(r.held[0] * 100).toFixed(2)}% and ${(r.held[1] * 100).toFixed(2)}% `
      + `down that frame, where an ordinary column holds ${(r.ground * 100).toFixed(2)}%\n`);
    process.stdout.write(`  anywhere else, two frames or more agreeing: `
      + `${(r.sweep * 100).toFixed(2)}% at column ${r.sweepAt}\n\n`);
  };

  if (process.argv.includes('--self')) {
    // THE CONTROL FOR THE SWEEP: an ordinary column of the real captures dimmed
    // by a known depth, nothing else about them touched. Deeper than the bar the
    // guard holds, so a control that passes says the reading REPORTS a line the
    // guard would refuse — see the note over SWEEP_PLANTED for why the interface
    // stopped being able to say that.
    const drawn = await alongTheRun(frames, LINE_ROWS,
      { at: SWEEP_COLUMN, depth: SWEEP_PLANTED });
    process.stdout.write(`THE CONTROL — the same ground, with a line ${(SWEEP_PLANTED * 100).toFixed(0)}%`
      + ` deep put on column ${SWEEP_COLUMN}\n`);
    say(drawn, LINE_ROWS);
    // AND THE CONTROL FOR THE AXIS, WHICH IS A DIFFERENT READING AND NEEDS ITS
    // OWN. The axis is measured against the ordinary columns of its own frame,
    // so it is a ratio and not a share, and it takes its line on the two centre
    // columns.
    const put = await alongTheRun(frames, LINE_ROWS, { axis: PLANTED });
    process.stdout.write(`THE OTHER CONTROL — the same ground, with a line ${(PLANTED * 100).toFixed(0)}% deep put on the axis\n`);
    say(put, LINE_ROWS);
    const ground = await alongTheRun(frames, LINE_ROWS);
    process.stdout.write('THE GROUND — the same frames, nothing planted\n');
    say(ground, LINE_ROWS);
    // The interface, which used to be the sweep's control, kept as a witness.
    const seen = await alongTheRun(frames, LINE_CONTROL_ROWS);
    process.stdout.write(`  the witness — the interface in the window at rows `
      + `${LINE_CONTROL_ROWS[0]}..${LINE_CONTROL_ROWS[1]}: sweep `
      + `${(seen.sweep * 100).toFixed(2)}% at column ${seen.sweepAt}, `
      + `against a ground of ${(ground.sweep * 100).toFixed(2)}%\n\n`);
    const ok = drawn.sweep > SWEEP_LIMIT && put.times > AXIS_TIMES
      && ground.sweep <= SWEEP_LIMIT && ground.times <= AXIS_TIMES;
    process.stdout.write(ok
      ? `the reading finds both lines it is shown and neither of them in the ground: `
        + `across, ${(drawn.sweep * 100).toFixed(2)}% against ${(ground.sweep * 100).toFixed(2)}%; `
        + `along, ${put.times.toFixed(2)} against ${ground.times.toFixed(2)} times the ground.\n`
      : 'THE READING FAILS ITS OWN CONTROL and cannot be believed either way.\n');
    if (!ok) process.exitCode = 1;
    return;
  }

  const ground = await alongTheRun(frames, LINE_ROWS);
  process.stdout.write(`${frames.length} steep captures down the path\n`);
  say(ground, LINE_ROWS);
  const bad = [];
  if (ground.times > AXIS_TIMES) bad.push(`the axis stands ${ground.times.toFixed(2)} times above the ground of ${AXIS_TIMES}`);
  if (ground.sweep > SWEEP_LIMIT) bad.push(`column ${ground.sweepAt} is off by ${(ground.sweep * 100).toFixed(2)}% of ${(SWEEP_LIMIT * 100).toFixed(0)}%`);
  if (bad.length) {
    process.stdout.write(`A LINE ALONG THE PATH: ${bad.join('; ')}.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('no line: no column stands apart from the ground either side of it.\n');
  }
}

async function main() {
  const frames = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (frames.length < 2) throw new Error('give at least two captures a metre apart');
  for (const f of frames) if (!existsSync(f)) throw new Error(`no capture at ${f}`);

  if (process.argv.includes('--along')) {
    await along(frames);
    return;
  }

  const say = (label, rows, r) => {
    process.stdout.write(`${label}, rows ${rows[0]}..${rows[1]}, columns ${COLS[0]}..${COLS[1]}\n`);
    process.stdout.write(`  wrinkle of each profile, rms: ${r.wrinkle.map((v) => (v * 100).toFixed(2)).join('  ')} %\n`);
    process.stdout.write(`  strongest agreement between any two: ${r.best.toFixed(3)}  (${r.pair})\n\n`);
  };

  if (process.argv.includes('--self')) {
    const names = frames.map(name);
    const reads = await readAll(frames, GROUND);
    const solved = plantDepth(reads, names);
    const control = strongestOf(reads, names, { rows: BAND_ROWS, depth: solved.depth });
    process.stdout.write(`THE CONTROL — a band planted across rows ${BAND_ROWS[0]}..${BAND_ROWS[1]}, `
      + `${(100 * solved.depth).toFixed(1)}% deep\n`);
    process.stdout.write(`  the depth is solved and not written down: it is what makes the plant `
      + `stand ${BAND_MATCH.toFixed(2)} times\n  the ground's own wrinkle `
      + `(${(100 * solved.ground).toFixed(2)}% rms, so the two together `
      + `${(100 * solved.wanted).toFixed(2)}%)\n`);
    say('  with it in', GROUND, control);
    const ground = strongestOf(reads, names);
    say('THE GROUND — the same frames with nothing planted', GROUND, ground);
    // The interface, which used to BE this control. It is read and printed so
    // that how far the ground has come stays on the record, and it is not what
    // the control turns on: see the note at the head of this file.
    const seen = await strongest(frames, WITH_INTERFACE);
    process.stdout.write(`  the witness — the interface in the window at rows `
      + `${WITH_INTERFACE[0]}..${WITH_INTERFACE[1]}: ${seen.best.toFixed(3)}, `
      + `against a ground of ${ground.best.toFixed(3)}\n\n`);
    const ok = control.best > LIMIT && ground.best <= LIMIT && solved.depth < BAND_CAP - 1e-3;
    process.stdout.write(ok
      ? `the measure finds the band it is shown and not the ground: ${control.best.toFixed(3)} against ${ground.best.toFixed(3)}.\n`
      : 'THE MEASURE FAILS ITS OWN CONTROL and cannot be believed either way.\n');
    if (!ok) process.exitCode = 1;
    return;
  }

  const ground = await strongest(frames, GROUND);
  say(`${frames.length} captures along the path`, GROUND, ground);
  if (ground.best > LIMIT) {
    process.stdout.write('A BAND: the same wrinkle stands at the same row in two different frames.\n');
    process.exitCode = 1;
  } else {
    process.stdout.write('no band: every frame wrinkles somewhere else, which is ground and not a seam.\n');
  }
}

await main();
