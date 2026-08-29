import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../grade/lib/framing.mjs';
import { writeCleanPng } from '../grade/lib/png.mjs';
import {
  GRAIN, PATH_SKIN, PEB_EDGE, SKIN_REACH,
  grainAt, grainTone, paveAt, skinPitch, skinToWorld,
} from '../../src/world/path.js';

// Paints the three maps the corridor is drawn from.
//
//   node tools/path/paint-path.mjs
//   node tools/path/paint-path.mjs --width=256 --height=4096 --grain=512
//
// None of them is a picture. The first is a RULER -- how deep inside the nearest
// slot of the paving a point stands -- the second is the LEVEL of the piece
// under it, and the third a field of small stones and of the grain of the stone,
// laid over the world rather than along the run. See src/world/path.js for what
// each is and why; nothing here decides anything about the paving, it only
// writes down what that one seat answers.
//
// WHY A DISTANCE AND NOT A PICTURE OF THE JOINT. A joint of this paving is three
// and a half centimetres at the median and eight millimetres at the tenth, and
// what an eight-bit picture of one gives back between two texels is a blur the
// width of a texel. What has no such floor is the POSITION of the edge: eight
// bits of distance interpolate to a position far finer than the texel that
// carried them, and a frame that knows where an edge is can draw it as sharply
// as it likes. The edge here is where the depth crosses nought.
//
// AND THE DISTANCE IS EXACT AND NOT ANALYTIC. The lattice can be asked how far a
// point is from the bisector between its two nearest sites, and that answer is
// wrong wherever three pieces meet -- which is at every vertex of the paving,
// which is where the shoulder of the joint is widest. So the mask is built at
// three times the delivered pitch on both axes and an exact euclidean distance
// transform is run over it, which costs a minute once and is right everywhere.
//
// WHY THREE FILES AND NOT ONE. The ruler and the tone want different pitches and
// compress in opposite ways, and carried together each pays for the other: at
// the delivered settings the pair interleaved costs 1 407 kB, the ruler alone
// 630, and the tone at a quarter of the pitch 101. The tone can afford it
// because it is piecewise constant on pieces a hand across; the ruler cannot,
// because its pitch is what decides which joints survive being sampled at all.

const OUT_DIR = join(REPO_ROOT, 'assets-src', 'path');

const flag = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : dflt;
};

const WIDTH = flag('width', PATH_SKIN.size[0]);
const HEIGHT = flag('height', PATH_SKIN.size[1]);
const TONE_W = flag('tone-width', PATH_SKIN.toneSize[0]);
const TONE_H = flag('tone-height', PATH_SKIN.toneSize[1]);
const GRAIN_SIDE = flag('grain', GRAIN.side);

// How many fine cells to a texel, on each axis. ODD on both, and that is not a
// detail: a texel's centre is a fine cell's centre only when the factor is odd,
// and if it is not, every value in the delivered file is an interpolation of the
// thing that was computed rather than the thing itself.
const SUPER = 3;

// Strip rows done at once, and how far past the band the halo reaches. The
// distance is clamped at SKIN_REACH, so a band only has to see the ground within
// the clamp of its own ends to be exact; the halo below is three times that.
const BAND = 256;
const HALO = 64;
const BIG = 1e5;

/**
 * The lower envelope of a set of parabolas: an exact distance transform in one
 * dimension, with the sample spacing carried so the answer comes back in METRES
 * and not in cells. The strip's two axes do not have the same pitch and the
 * frame cares about ground, not texels.
 */
function dt1d(f, n, step2, out, hull, cross) {
  let k = 0;
  hull[0] = 0;
  cross[0] = -Infinity;
  cross[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + step2 * q * q) - (f[hull[k]] + step2 * hull[k] * hull[k]))
      / (2 * step2 * (q - hull[k]));
    while (s <= cross[k]) {
      k--;
      s = ((f[q] + step2 * q * q) - (f[hull[k]] + step2 * hull[k] * hull[k]))
        / (2 * step2 * (q - hull[k]));
    }
    k++;
    hull[k] = q;
    cross[k] = s;
    cross[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (cross[k + 1] < q) k++;
    const d = q - hull[k];
    out[q] = step2 * d * d + f[hull[k]];
  }
}

/** THE RULER: how deep inside the nearest slot a point stands, in metres. */
function paintJoint() {
  const started = Date.now();
  const [pitchX, pitchZ] = skinPitch([WIDTH, HEIGHT]);
  const nx = WIDTH * SUPER;
  const fineX = pitchX / SUPER;
  const fineZ = pitchZ / SUPER;
  const out = new Uint8Array(WIDTH * HEIGHT);

  const rowsPerBand = BAND * SUPER;
  const scratch = new Float64Array(nx * (rowsPerBand + 2 * HALO));
  const line = new Float64Array(Math.max(nx, rowsPerBand + 2 * HALO));
  const done = new Float64Array(line.length);
  const hull = new Int32Array(line.length);
  const cross = new Float64Array(line.length + 1);

  for (let band = 0; band * BAND < HEIGHT; band++) {
    const firstRow = band * BAND;
    const lastRow = Math.min(HEIGHT, firstRow + BAND);
    const top = Math.max(0, firstRow * SUPER - HALO);
    const bottom = Math.min(HEIGHT * SUPER, lastRow * SUPER + HALO);
    const rows = bottom - top;

    for (let b = 0; b < rows; b++) {
      const v = (top + b + 0.5) / (HEIGHT * SUPER);
      for (let a = 0; a < nx; a++) {
        const u = (a + 0.5) / nx;
        const { x, z } = skinToWorld(u, v);
        // The transform runs from the SLOTS to the STONE, so the seed set is the
        // stone: a point on stone is at nought and a point in a slot is as far
        // in as the nearest stone is away.
        scratch[b * nx + a] = paveAt(x, z).inSlot ? BIG : 0;
      }
    }

    // Across first, then along: the transform is separable, so two exact
    // one-dimensional passes are the exact two-dimensional answer.
    for (let b = 0; b < rows; b++) {
      for (let a = 0; a < nx; a++) line[a] = scratch[b * nx + a];
      dt1d(line, nx, fineX * fineX, done, hull, cross);
      for (let a = 0; a < nx; a++) scratch[b * nx + a] = done[a];
    }
    for (let a = 0; a < nx; a++) {
      for (let b = 0; b < rows; b++) line[b] = scratch[b * nx + a];
      dt1d(line, rows, fineZ * fineZ, done, hull, cross);
      for (let b = 0; b < rows; b++) scratch[b * nx + a] = done[b];
    }

    for (let j = firstRow; j < lastRow; j++) {
      const b = j * SUPER + (SUPER - 1) / 2 - top;
      for (let i = 0; i < WIDTH; i++) {
        const a = i * SUPER + (SUPER - 1) / 2;
        const metres = Math.sqrt(scratch[b * nx + a]);
        const clamped = metres > SKIN_REACH ? SKIN_REACH : metres;
        out[j * WIDTH + i] = Math.round(clamped / SKIN_REACH * 255);
      }
    }
    process.stdout.write(`  ${lastRow} of ${HEIGHT} rows\r`);
  }

  process.stdout.write(`painted ${WIDTH}x${HEIGHT} of ruler in `
    + `${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  process.stdout.write(`  reach ${(SKIN_REACH * 1000).toFixed(0)} mm, `
    + `${(SKIN_REACH / 255 * 1000).toFixed(3)} mm a code, `
    + `pitch ${(pitchX * 1000).toFixed(2)} mm across x ${(pitchZ * 1000).toFixed(2)} mm along\n`);

  let inSlot = 0;
  let atClamp = 0;
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    if (out[i] > 0) inSlot++;
    if (out[i] === 255) atClamp++;
  }
  const n = WIDTH * HEIGHT;
  process.stdout.write(`  ${(inSlot / n * 100).toFixed(1)}% of the strip is inside a slot, `
    + `${(atClamp / n * 100).toFixed(2)}% at the clamp\n`);
  // THE FIRST THING THAT MUST BE TRUE: a slot has to have been found at all. A
  // strip of solid nought says "stone everywhere", which is exactly what the
  // delivery would look like if the lattice had been asked in the wrong space --
  // and it would ship silently, because a field that does nothing breaks no
  // guard downstream.
  if (inSlot / n < 0.10) {
    throw new Error(`only ${(inSlot / n * 100).toFixed(2)}% of the strip is slot: `
      + 'the lattice is not being found where the paving is');
  }
  noLineAlongTheRun(out, WIDTH, HEIGHT, 'the ruler', 1);
  return out;
}

/** THE LEVEL of the piece under a point, at its own coarser pitch. */
function paintTone() {
  const out = new Uint8Array(TONE_W * TONE_H);
  let lo = 255;
  let hi = 0;
  for (let j = 0; j < TONE_H; j++) {
    const v = (j + 0.5) / TONE_H;
    for (let i = 0; i < TONE_W; i++) {
      const u = (i + 0.5) / TONE_W;
      const { x, z } = skinToWorld(u, v);
      // NOT SUPERSAMPLED, and that is the point of a piecewise constant field:
      // averaging over a texel's own footprint would blur the boundary between
      // two pieces, and the boundary between two pieces is the one place this
      // map has any structure at all. A piece is eight texels across here, so
      // there is nothing finer for a mean to protect against.
      const code = Math.round(paveAt(x, z).tone * 255);
      out[j * TONE_W + i] = code;
      lo = Math.min(lo, code);
      hi = Math.max(hi, code);
    }
  }
  const [px, pz] = skinPitch([TONE_W, TONE_H]);
  process.stdout.write(`painted ${TONE_W}x${TONE_H} of tone, pitch `
    + `${(px * 1000).toFixed(2)} x ${(pz * 1000).toFixed(2)} mm; runs ${lo}..${hi}\n`);
  // THE SECOND THING THAT MUST BE TRUE: the paving is pieces and not one stone.
  if (hi - lo < 60) {
    throw new Error(`the tone runs only ${hi - lo} codes: the pieces are all one stone`);
  }
  noLineAlongTheRun(out, TONE_W, TONE_H, 'the tone', 1);
  return out;
}

/**
 * THE THIRD THING THAT MUST BE TRUE OF ANYTHING LAID IN PATH SPACE: nothing may
 * be constant down the run.
 *
 * A strip laid in path space is the one shape of texture that can feed a line to
 * the frame by construction -- a column of it is a line down the middle of the
 * path, for the whole length of the path. So the across profile of the along
 * mean is measured here, before any of it reaches a frame, and a column standing
 * apart from its neighbours is refused at the painter rather than found by a
 * guard six steps later.
 */
// How far outside its OWN scatter a column has to stand before it is a line.
//
// NOT A NUMBER OF CODES, and the first cut of this was one -- which refused the
// tone map for standing 3.24 codes off its neighbours against a limit of 3.0
// that nobody had measured anything to get. A limit in codes is a limit on the
// PAVING: a column of the tone map averages a few hundred pieces, not a few
// thousand texels, so the mean of one column scatters by a couple of codes for
// no reason at all, and a map with bigger pieces or a longer run would trip it
// while a map with a real line in it and finer pieces would not.
//
// So the bar is the map's own scatter, five times over. What a line down the run
// looks like on this reading is ONE column standing away from a population that
// is otherwise tight, which is exactly what a multiple of the population's own
// spread catches -- and what it costs is stated every run, in sigmas, so that a
// map creeping towards the bar can be seen before it reaches it.
const LINE_SIGMAS = 5;
// AND HOW DEEP IT HAS TO BE BEFORE ANYBODY COULD SEE IT, as a share of the map's
// own range.
//
// A sigma test alone is a test on the STATISTICS and not on the picture: the
// tone map's columns scatter by half a code, so a column three codes out is five
// sigma and is also one and a third per cent of a field whose whole range the
// frame spends on the difference between soil and pale stone -- under a
// thousandth of the pigment, which is a fifth of a code in the frame and cannot
// be seen at any exposure. Refusing it would be refusing the map for being a
// finite sample of itself.
//
// Two per cent, and there is room to spare in that: the line down the middle of
// the run, when this world had one, stood at 18.9% on the roughest paving that
// carried it and 25.4% on the smoothest. Anything worth the name is ten times
// this bar.
const LINE_SHARE = 0.02;

function noLineAlongTheRun(map, w, h, name, stride) {
  const column = new Float64Array(w);
  for (let i = 0; i < w; i++) {
    let sum = 0;
    for (let j = 0; j < h; j++) sum += map[(j * w + i) * stride];
    column[i] = sum / h;
  }
  const apart = [];
  for (let i = 1; i < w - 1; i++) {
    apart.push(Math.abs(column[i] - (column[i - 1] + column[i + 1]) / 2));
  }
  const mean = apart.reduce((t, v) => t + v, 0) / apart.length;
  const sd = Math.sqrt(apart.reduce((t, v) => t + (v - mean) ** 2, 0) / apart.length);
  const worst = Math.max(...apart);
  const where = apart.indexOf(worst) + 1;
  const sigmas = sd > 0 ? (worst - mean) / sd : 0;
  let lo = 255;
  let hi = 0;
  for (let k = 0; k < w * h; k++) {
    const v = map[k * stride];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const share = worst / Math.max(1, hi - lo);
  process.stdout.write(`  along-run mean per column, ${name}: worst column stands `
    + `${worst.toFixed(2)} codes off its neighbours at ${where} of ${w}, `
    + `where the columns scatter by ${sd.toFixed(2)} about ${mean.toFixed(2)} `
    + `-- ${sigmas.toFixed(1)} sigma, ${(share * 100).toFixed(2)}% of the map's range\n`);
  if (sigmas > LINE_SIGMAS && share > LINE_SHARE) {
    throw new Error(`column ${where} of ${name} stands ${sigmas.toFixed(1)} sigma off the `
      + `population of columns AND ${(share * 100).toFixed(2)}% of its range: `
      + 'the map is drawing a line along the run');
  }
}

/** THE SMALL STONES and the grain of the stone, over the world. */
function paintGrain() {
  const side = GRAIN_SIDE;
  const out = new Uint8Array(side * side * 3);
  const reach = GRAIN.reach;
  let inside = 0;
  let sumTone = 0;
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      let stone = 0;
      let tone = 0;
      for (let sj = 0; sj < SUPER; sj++) {
        for (let si = 0; si < SUPER; si++) {
          const tu = (i + (si + 0.5) / SUPER) / side;
          const tv = (j + (sj + 0.5) / SUPER) / side;
          // A half AT the rim, above it inside, below it out on the ground, and
          // clamped so the codes are spent on the rim and not on the empty
          // ground between one stone and the next.
          stone += Math.max(0, Math.min(1, 0.5 - grainAt(tu, tv).d / (2 * reach)));
          tone += grainTone(tu, tv);
        }
      }
      const o = (j * side + i) * 3;
      const s = stone / (SUPER * SUPER);
      const t = tone / (SUPER * SUPER);
      out[o] = Math.round(s * 255);
      out[o + 1] = Math.round(t * 255);
      if (s > PEB_EDGE[1]) inside++;
      sumTone += t;
    }
  }
  const area = GRAIN.metresPerRepeat ** 2;
  process.stdout.write(`painted ${side}x${side} of grain over `
    + `${GRAIN.metresPerRepeat.toFixed(4)} m of ground `
    + `(${(GRAIN.metresPerRepeat / side * 1000).toFixed(2)} mm a texel)\n`);
  process.stdout.write(`  small stones cover ${(inside / (side * side) * 100).toFixed(2)}% of `
    + `${area.toFixed(3)} m2, at ${GRAIN.perM2.toFixed(1)} a square metre\n`);
  const mean = sumTone / (side * side);
  process.stdout.write(`  the grain has mean ${mean.toFixed(4)}\n`);
  // THE ONE THING THAT MUST BE TRUE OF THE GRAIN: it has mean a half, because
  // the frame multiplies the pigment by one plus a gain times this either side
  // of its middle. A grain with a different mean is a grain that moves the LEVEL
  // of the paving, and the level is the fitted pigment.
  if (Math.abs(mean - 0.5) > 0.002) {
    throw new Error(`the grain has mean ${mean.toFixed(4)} and not a half: `
      + `GRAIN.bias is ${GRAIN.bias} and wants to be `
      + `${(GRAIN.bias + 0.5 - mean).toFixed(4)}`);
  }
  // AND IT HAS TO CLOSE. A tile whose two edges do not meet draws a line across
  // the ground every repeat, in both directions, for ever.
  let seam = 0;
  for (let k = 0; k < side; k++) {
    seam = Math.max(seam,
      Math.abs(out[(k * side) * 3] - out[(k * side + side - 1) * 3]),
      Math.abs(out[k * 3] - out[((side - 1) * side + k) * 3]));
  }
  process.stdout.write(`  the seam between one repeat and the next stands ${seam} codes apart\n`);
  if (seam > 40) {
    throw new Error(`the tile does not close: its two edges are ${seam} codes apart`);
  }
  return out;
}

mkdirSync(OUT_DIR, { recursive: true });

const written = [];
for (const [name, map, w, h, channels] of [
  // ONE CHANNEL WHERE THERE IS ONE NUMBER, and it is not tidiness. A ruler
  // written into the red of an RGB file leaves the encoder to decide what R8
  // means -- take the red, or take the luminance of a picture that is red and
  // nothing else, which is the same number times 0.2126. Neither is written
  // down anywhere and the delivery does not say which it did. A grey file has
  // one channel and one meaning.
  ['path-joint', paintJoint(), WIDTH, HEIGHT, 1],
  ['path-tone', paintTone(), TONE_W, TONE_H, 1],
  ['path-grain', paintGrain(), GRAIN_SIDE, GRAIN_SIDE, 3],
]) {
  const path = join(OUT_DIR, `${name}.png`);
  const bytes = await writeCleanPng(map, { width: w, height: h, channels }, path);
  written.push(`${name} ${(bytes / 1024).toFixed(0)} kB`);
  process.stdout.write(`${path} (${(bytes / 1024).toFixed(0)} kB)\n`);
}
process.stdout.write(`${written.join(', ')}\n`);
