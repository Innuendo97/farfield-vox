import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../grade/lib/framing.mjs';
import { writeCleanPng } from '../grade/lib/png.mjs';
import { pathCoord, pathRun } from '../../src/world/terrain-field.js';
import { PATH_STRIP, STRIP_REACH, stripPitch, stripToWorld } from '../../src/world/path-strip.js';
import { atlasSpan, bandLimit, pave, paveErosion } from './lib/pattern.mjs';

// Paints how far the nearest joint of the paving is.
//
//   node tools/terrain/paint-path-strip.mjs
//   node tools/terrain/paint-path-strip.mjs --width=512 --height=4096
//
// One channel, linear, no block codec: this is not a picture, it is a ruler. See
// src/world/path-strip.js for what the strip is and why it is laid along the run
// rather than over the world, and lib/pattern.mjs for the lattice it measures —
// THE SAME lattice tools/terrain/paint-albedo.mjs draws, out of one seat, which
// is the only reason the two land on top of each other.
//
// WHY A DISTANCE AND NOT A PICTURE OF THE JOINT. The frame already has a picture
// of the joint: it is in the ground atlas, and it is blurred to two and a half
// centimetres across the run and the better part of ten along it, because that is
// what a texel of that atlas is. Painting the same joint again, finer, into
// another texture of the same order of resolution would inherit the same floor.
// What has no floor is the POSITION of the edge: eight bits of distance
// interpolate to a position far finer than the texel that carried them, and a
// frame that knows where an edge is can draw it as sharply as it likes.

const OUT = join(REPO_ROOT, 'assets-src', 'terrain', 'terrain-path.png');

const flag = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : dflt;
};

const WIDTH = flag('width', PATH_STRIP.size[0]);
const HEIGHT = flag('height', PATH_STRIP.size[1]);

// The side of the ground atlas this strip has to agree with.
//
// It is here because the LATTICE ITSELF depends on it. slabSpace() fades its
// fine octaves out with how much ground a texel covers, and that texel is the
// ATLAS's, not this strip's: paint-albedo.mjs asks the question with the band
// limit its own footprint allows, so a strip that asked with its own — far finer
// — footprint would warp the point by a different amount and land on a different
// cell. The strip therefore reads the atlas's span at the world point it is
// looking at, which is what atlasSpan() is for.
const ATLAS = flag('atlas', 2048);

// How far across the paving may reach before this stops looking for joints, as a
// fraction of the half width. pathHalfWidth() is one and the edge wanders by up
// to a third on top, so 1.30 covers every place stone can be. Past it there is
// grass, and a joint drawn on grass would be a joint on grass — except that the
// frame masks this by the same stone mask the near material uses, so the cost of
// being generous here is nothing and the cost of being tight is a missing joint
// at the one place the eye is closest to the ground.
const PAVE_REACH = 1.30;

// How many fine cells to a texel, on each axis. ODD on both, and that is not a
// detail: a strip texel's centre is a fine cell's centre only when the factor is
// odd, and if it is not, every value in the delivered file is an interpolation
// of the thing that was actually computed rather than the thing itself.
//
// The fine grid is where the joint's EDGE gets localised, so its pitch — about
// two millimetres either way at the delivered size — is the floor on how
// accurately the strip can say where an edge is. The texel pitch is a separate
// and much coarser floor, and it is the one that decides which joints survive at
// all; see the note over PATH_STRIP.size.
const SUPER_X = flag('super-x', 3);
const SUPER_Z = flag('super-z', 9);

// Strip rows done at once. The distance is clamped, so a band only has to see
// the ground within the clamp of its own ends to be exact — the halo below is
// six times that — and doing the whole strip at once would ask for a gigabyte.
const BAND = 256;
const HALO = 64;

const BIG = 1e5;

/**
 * The lower envelope of a set of parabolas: Felzenszwalb and Huttenlocher's
 * exact distance transform in one dimension, with the sample spacing carried so
 * the answer comes back in METRES and not in cells. The strip's two axes do not
 * have the same pitch and the frame cares about ground, not texels.
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

/** Is there a drawn joint of the paving at this point of the world? */
function jointHere(x, z) {
  if (pathRun(z) <= 0.001) return false;
  const d = Math.abs(pathCoord(x, z));
  if (d > PAVE_REACH) return false;
  const detail = bandLimit(atlasSpan(x, z, ATLAS));
  return pave(x, z, detail, paveErosion(x, z, d, detail)).inJoint;
}

function main() {
  const started = Date.now();
  const [pitchX, pitchZ] = stripPitch([WIDTH, HEIGHT]);
  const nx = WIDTH * SUPER_X;
  const fineX = pitchX / SUPER_X;
  const fineZ = pitchZ / SUPER_Z;
  const out = new Uint8Array(WIDTH * HEIGHT);

  const rowsPerBand = BAND * SUPER_Z;
  const scratch = new Float64Array(nx * (rowsPerBand + 2 * HALO));
  const line = new Float64Array(Math.max(nx, rowsPerBand + 2 * HALO));
  const done = new Float64Array(line.length);
  const hull = new Int32Array(line.length);
  const cross = new Float64Array(line.length + 1);

  let painted = 0;
  for (let band = 0; band * BAND < HEIGHT; band++) {
    const firstRow = band * BAND;
    const lastRow = Math.min(HEIGHT, firstRow + BAND);
    const top = Math.max(0, firstRow * SUPER_Z - HALO);
    const bottom = Math.min(HEIGHT * SUPER_Z, lastRow * SUPER_Z + HALO);
    const rows = bottom - top;

    for (let b = 0; b < rows; b++) {
      const v = (top + b + 0.5) / (HEIGHT * SUPER_Z);
      for (let a = 0; a < nx; a++) {
        const u = (a + 0.5) / nx;
        const { x, z } = stripToWorld(u, v);
        scratch[b * nx + a] = jointHere(x, z) ? 0 : BIG;
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
      const b = j * SUPER_Z + (SUPER_Z - 1) / 2 - top;
      for (let i = 0; i < WIDTH; i++) {
        const a = i * SUPER_X + (SUPER_X - 1) / 2;
        const metres = Math.sqrt(scratch[b * nx + a]);
        const clamped = metres > STRIP_REACH ? STRIP_REACH : metres;
        out[j * WIDTH + i] = Math.round(clamped / STRIP_REACH * 255);
      }
    }
    painted = lastRow;
    process.stdout.write(`  ${painted} of ${HEIGHT} rows\r`);
  }

  process.stdout.write(`painted ${WIDTH}x${HEIGHT} in `
    + `${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  report(out, pitchX, pitchZ);
  return out;
}

/**
 * What the file says about itself, and the three things it has to be true for.
 */
function report(out, pitchX, pitchZ) {
  let atClamp = 0;
  let atZero = 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i] === 255) atClamp++;
    if (out[i] === 0) atZero++;
  }
  const perCode = STRIP_REACH / 255 * 1000;
  process.stdout.write(`  reach ${(STRIP_REACH * 1000).toFixed(0)} mm, `
    + `${perCode.toFixed(3)} mm a code, `
    + `pitch ${(pitchX * 1000).toFixed(2)} mm across x ${(pitchZ * 1000).toFixed(2)} mm along\n`);
  process.stdout.write(`  ${(atClamp / out.length * 100).toFixed(1)}% at the clamp, `
    + `${(atZero / out.length * 100).toFixed(2)}% inside a joint\n`);

  // THE FIRST THING THAT MUST BE TRUE: a joint has to have been found at all.
  // A strip of solid clamp is a strip that says "stone everywhere", which is
  // exactly what the delivery would look like if the lattice had been asked in
  // the wrong space — and it would ship silently, because a field that does
  // nothing breaks no guard downstream.
  if (atZero / out.length < 0.02) {
    throw new Error(`only ${(atZero / out.length * 100).toFixed(3)}% of the strip is joint: `
      + 'the lattice is not being found where the paving is');
  }

  // THE SECOND: nothing may be constant down the run.
  //
  // check-path-bands --along weighs the middle column of a steep frame against
  // the columns either side of it, and a strip laid IN PATH SPACE is the one
  // shape of texture that can feed it a line by construction — a column of this
  // file is a line down the middle of the path, for the whole length of the
  // path. So the across-profile of the along-mean is measured here, before any
  // of it reaches a frame, and a column that stands apart from its neighbours is
  // refused at the painter rather than found by a guard six steps later.
  const column = new Float64Array(WIDTH);
  for (let i = 0; i < WIDTH; i++) {
    let sum = 0;
    for (let j = 0; j < HEIGHT; j++) sum += out[j * WIDTH + i];
    column[i] = sum / HEIGHT;
  }
  let worst = 0;
  let where = 0;
  for (let i = 1; i < WIDTH - 1; i++) {
    const apart = Math.abs(column[i] - (column[i - 1] + column[i + 1]) / 2);
    if (apart > worst) { worst = apart; where = i; }
  }
  process.stdout.write(`  along-run mean per column: worst column stands ${worst.toFixed(2)} `
    + `codes off its neighbours, at ${where} of ${WIDTH}\n`);
  if (worst > 2.0) {
    throw new Error(`column ${where} stands ${worst.toFixed(2)} codes off its neighbours: `
      + 'the strip is drawing a line along the run');
  }
}

mkdirSync(join(REPO_ROOT, 'assets-src', 'terrain'), { recursive: true });
const bytes = await writeCleanPng(main(), { width: WIDTH, height: HEIGHT, channels: 1 }, OUT);
process.stdout.write(`${OUT} (${(bytes / 1024).toFixed(0)} kB)\n`);
