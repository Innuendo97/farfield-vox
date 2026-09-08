import {
  CAMPO_BEARINGS, CAMPO_BIAS, CAMPO_BLADE_CEIL, CAMPO_FAR, CAMPO_HORIZON_MARGIN,
  CAMPO_HORIZON_REACH, CENTRE, VOXEL, campoBearingOf, campoCoarseSpan, campoFarOrigin,
  campoGroundByte, campoHorizon, campoHorizonCost, campoSkyBound, columnSpec,
} from '../../src/world/voxel/pure.js';
import { POSES } from '../../src/core/poses.js';
import { read, reporter, selfTest } from './lib.mjs';

// GUARD-ORIZZONTE -- A RAY THIS THROWS AWAY COULD NOT HAVE HIT ANYTHING.
//
// ===========================================================================
// WHAT IS BEING GUARDED, AND WHY IT NEEDS A GUARD OF ITS OWN.
//
// The field does not march a ray that leaves the eye steeper than the steepest
// ground it could reach: it discards the fragment on one compare. That test is
// the largest single lever this renderer has -- U-PERF-3 measured it at 12.6 ms
// of a 33 ms frame -- and until U-PERF-5 it asked ONE question for the whole
// frame: the steepest ground ANYWHERE, whichever way the eye was looking.
//
// It is now a RING of 256 bearings (campoHorizon in src/world/voxel/campo.js),
// so a pixel looking at the gentle side of the world is bounded by the gentle
// side of the world. That buys back 15.0% of the frame at the pose the campaign
// judges on -- and it turns a bound that was true by brute force into one that
// is true by an ARGUMENT: a cell is written into every bearing its own angular
// extent can be seen from, widened by the step the walker may take before the
// ring is counted again.
//
// AN ARGUMENT IS EXACTLY THE KIND OF THING THAT ROTS. Every failure mode of it
// is a HOLE IN THE GROUND -- a ray thrown away that would have hit something,
// which draws sky where the world is -- and none of them is visible at the pose
// anybody looks at. A ring narrowed by one bearing shows nothing at the spawn
// and cuts the crest of the ridge off on a bearing nobody has walked to; the
// padding for the walker's step shows nothing standing still and opens a
// flickering gap the moment they move. So the guard does not ask whether the
// picture looks right. It asks the only question that matters:
//
//   FOR EVERY COLUMN OF THE WORLD, AND EVERY EYE THE RING WAS BUILT TO COVER,
//   IS THE RING AT THAT COLUMN'S BEARING AT LEAST AS STEEP AS THE COLUMN IS?
//
// ===========================================================================
// U-GUARDIA-3: WHY THIS FILE WAS REWRITTEN, AND WHAT THE DEFECT WAS.
//
// This guard shipped four legs and eight injections and, on the tip it was
// asked on, HALF THE INJECTIONS WENT THROUGH -- E-PERF5's own residue, carried
// forward through E-LUCE5 and E-CORNICE3 as «guard-orizzonte --self 4/8».
// Diagnosed here, and it is one cause and not four:
//
//   THE WORLD IT MEASURED ITSELF ON HAS NO GROUND ABOVE THE EYE ANY MORE.
//   Over the whole far window -- 409.6 m square, sampled at a quarter of a
//   coarse cell -- the law returns 198 columns and the tallest of them stands
//   at 0.650 m, against an eye at 1.583. The crest at 96 m fell with
//   U-CORNICE-1 (R6 §3: «cadono cresta a 96 m»), and the plateau that is left
//   is flat.
//
// Every leg of this guard filters its samples by `y <= eye.y` and every
// injection is a way of writing the ring WRONG FOR GROUND THAT STANDS OVER THE
// EYE. With no such ground the filter empties the set, `worst` stays at
// -Infinity, and `worst <= 0` is true. The guard was printing «il peggior
// campione sta Infinity di pendenza SOTTO l'anello» and going green on
// nothing: legs 1, 2, 4 and 7 were all VACUOUS, and the four injections that
// went through were the four that need a hill.
//
// THE CURE IS NOT A LOWER THRESHOLD, IT IS GROUND. The property being guarded
// is a property of the CONSTRUCTION -- of an arc, a bearing, a bias and a
// padding -- and not of this month's terrain, so the guard now brings its own
// terrain. A BANCO is a piece of ground made for the question: coarse cells of
// the size the real ones are, at chosen bearings and distances, standing over
// the eye, together with the law samples that fill them (their nearest point,
// their four CORNERS, and a grid across them). Every leg and every injection
// runs on every banco AND on the world, and what is asserted is what a self
// test can honestly assert: the guard's own predicate says no to the defect,
// and yes to the correct ring, on the same ground.
//
// Two things follow, and both are deliberate:
//
//   THE WORLD IS STILL MEASURED, and it is the terrain that ships -- but the
//   legs that need a hill say out loud how much they had to bite on. A run
//   where the world offers nothing NOTEs it instead of going quietly green,
//   which is the whole of what went wrong here. The world's own emptiness is
//   not gated: it is not this guard's to move.
//
//   THE BANCHI ARE GATED, and they are what makes the guard non-vacuous for
//   ever after. V5 will put ground back above the eye and the world's legs will
//   bite again; until then the banchi are the only reason to believe any of it.
//
// ===========================================================================
// THE LEGS
//
//   0. THE MODEL IS THE ENGINE'S. Every injection below is the ring written
//      with one thing wrong, which means there is a second implementation of
//      campoHorizon in this file. If it drifted, the self test would be putting
//      defects through a strawman. So the model with NOTHING wrong is compared
//      against the engine's own ring, bin for bin, on every terrain.
//   1. CONSERVATIVE, STANDING STILL. Every sample that stands above the eye
//      must be under the ring at its own bearing.
//   2. CONSERVATIVE, HAVING WALKED. The same, for an eye moved by up to the
//      reach the ring declares -- in x, in z and in y, and in every diagonal of
//      the three -- without rebuilding the ring. This is the leg the padding
//      exists for, and the one a tidy-up would delete first. It is asked of the
//      ring as campoHorizon BUILDS it.
//   2b. THE SAME STEP, ON THE RING THE FRAGMENT READS -- campoHorizon clamped
//      to the single bound campo-field.js hands it. U-GUARDIA-3 found the two
//      were not the same ring: the ceiling was taken at the exact eye and the
//      clamp cut off the padding leg 2 exists for, so this was gated on the
//      world (where nothing stands above the eye to break on) and only measured
//      on the banchi. U-CAMPO-4 gave the ceiling the same padded eye the ring
//      takes -- campoSkyBound -- and this is now GATED ON EVERY TERRAIN.
//   3. NEVER LOOSER THAN THE ONE BOUND. The ring may only ever cut MORE than
//      the single slope did: a bearing above it would be a regression dressed
//      as a feature.
//   4. AND IT ACTUALLY CUTS. A ring that equalled the single bound everywhere
//      would pass legs 1-3 and buy nothing; the share of bearings strictly
//      under it, and by how much, is asserted rather than admired -- on ground
//      that is not the same in every direction, because on ground that is, the
//      right answer is a ring that cuts nothing.
//   5. ONE LAW IN TWO LANGUAGES. The fragment finds its bearing with its own
//      arithmetic and campoBearingOf finds it with JavaScript. The two literals
//      that decide it are read out of the shader's source and compared with the
//      ones this file computes: a ring written in one numbering and read in
//      another is a hole in the ground that no picture at the spawn would show.
//   6. THE RING IS THE SHAPE THE UNIFORM CARRIES. 256 bearings, a multiple of
//      four, and the material declares exactly that many vec4s.
//   7. AND IT DOES NOT COST THE WALK. This is written on the thread the walker
//      is on, four times a second, and E-PERF4's whole finding was that the
//      spikes of a walk are exactly that shape. So the work is COUNTED and
//      gated as a count -- «what you gate cannot be a clock» -- with a ceiling
//      that leaves room and no more. The ceiling bites on the far banco, whose
//      cells stand at the distance the world's own ridge used to.
// ===========================================================================

const injected = process.argv.includes('--self');

const shape = CAMPO_FAR;
const cell = campoCoarseSpan(shape);
const origin = campoFarOrigin(shape);
const X0 = origin.cx * shape.tile * shape.cell;
const Z0 = origin.cz * shape.tile * shape.cell;
const SPAN = shape.side * shape.cell;
const N = Math.round(SPAN / cell);

// The tallest ground a byte can carry: campoGroundByte saturates at 255, so a
// banco cannot ask for a hill higher than this and must not silently get a
// shorter one.
const BYTE_CEILING = (255 - CAMPO_BIAS) * VOXEL;

/**
 * The coarse square, as the worker lays it: the tallest ground in each piece,
 * as the BYTE campoCoarse writes. Built here from the law rather than taken
 * from a worker, which is the whole point -- the guard's ground and the
 * renderer's ground have to be the same ground for a different reason than
 * "they came from the same array".
 */
function coarseFromLaw() {
  const top = new Uint8Array(N * N);
  const fine = 4;                        // sub-samples a side inside a cell
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      let best = -1e9;
      for (let b = 0; b < fine; b += 1) {
        for (let a = 0; a < fine; a += 1) {
          const wx = X0 + (i + (a + 0.5) / fine) * cell;
          const wz = Z0 + (j + (b + 0.5) / fine) * cell;
          const spec = columnSpec(Math.floor(wx / VOXEL), Math.floor(wz / VOXEL),
            true, undefined, true);
          if (!spec || spec.top < 0) continue;
          if (spec.top > best) best = spec.top;
        }
      }
      // campoCoarse's own nought: a piece with no column casts nothing. And the
      // byte is campoGroundByte's, which carries the +1: the number is the TOP
      // SURFACE of the column and not the index of its last voxel.
      top[j * N + i] = best < -1e8 ? 0 : campoGroundByte(best);
    }
  }
  return top;
}

/**
 * Every place the law puts ground, at a quarter of a coarse cell: the samples
 * the ring has to be true about. Held once, because the sweep runs it for four
 * eyes and nine steps each, and the law is not cheap.
 */
function lawSamples(step) {
  const out = [];
  for (let z = Z0 + step * 0.5; z < Z0 + SPAN; z += step) {
    for (let x = X0 + step * 0.5; x < X0 + SPAN; x += step) {
      const spec = columnSpec(Math.floor(x / VOXEL), Math.floor(z / VOXEL), true, undefined, true);
      if (!spec || spec.top < 0) continue;
      out.push([x, z, (spec.top + 1) * VOXEL + CAMPO_BLADE_CEIL]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE TERRAINS. A terrain is ground the ring has to answer for -- the coarse
// patches campoHorizon reads, the law samples that fill them, and the eyes it
// is asked about. The world is one of them and is not privileged.

const EYES = [];
for (const name of ['target', 'bordo-indietro']) {
  const p = POSES[name];
  if (p) EYES.push({ name, x: p.position.x, y: p.position.y, z: p.position.z });
}
EYES.push({ name: 'peggiore (-4, 16)', x: -4, y: 1.7, z: 16 });
EYES.push({ name: 'centro del mondo', x: CENTRE.x, y: 1.7, z: CENTRE.z });

const WORLD = {
  name: 'il mondo, dalla legge',
  world: true,
  patches: [{ x0: X0, z0: Z0, cell, n: N, top: coarseFromLaw() }],
  samples: lawSamples(cell / 4),
  eyes: EYES,
};

/**
 * One coarse cell, wherever it is wanted, and the samples that fill it.
 *
 * WHICH POINTS, AND WHY THOSE. The ring measures a cell from its NEAREST corner
 * and takes the tallest ground anywhere in it, so a sample drawn from the
 * middle is always further away and always lower than what the ring allows: it
 * carries a slack of its own that would swallow the very defect being injected.
 * The nearest point is where the ring is TIGHT IN DISTANCE and the four CORNERS
 * are where it is tight IN BEARING -- the arc is built out of exactly those
 * four angles, so a quantisation that truncates it inward is only visible from
 * them. The interior grid is there so that a defect which spares the rim has
 * nowhere to hide either.
 *
 * The corners are drawn a hair inside the cell: a sample exactly on the shared
 * edge of two cells belongs to both, and this guard is about one.
 */
function loneCell(cx, cz, top, eyeAt) {
  const x0 = Math.floor(cx / cell) * cell;
  const z0 = Math.floor(cz / cell) * cell;
  const patch = { x0, z0, cell, n: 1, top: Uint8Array.from([campoGroundByte(top)]) };
  const y = (top + 1) * VOXEL + CAMPO_BLADE_CEIL;
  const in0 = 1e-6;
  const in1 = cell - 1e-6;
  const pts = [
    // the nearest point of the cell to the eye
    [Math.min(Math.max(eyeAt.x, x0), x0 + cell), Math.min(Math.max(eyeAt.z, z0), z0 + cell), y],
    // and its four corners, which are the four angles the arc is built from
    [x0 + in0, z0 + in0, y], [x0 + in1, z0 + in0, y],
    [x0 + in0, z0 + in1, y], [x0 + in1, z0 + in1, y],
  ];
  for (let b = 0; b < 4; b += 1) {
    for (let a = 0; a < 4; a += 1) {
      pts.push([x0 + (a + 0.5) / 4 * cell, z0 + (b + 0.5) / 4 * cell, y]);
    }
  }
  return { patch, pts };
}

/**
 * A BANCO: cells placed by bearing and distance from one eye, at a height over
 * it. The bearing is the ring's own -- atan2(dz, dx) -- so that a banco can be
 * written to straddle the cut of atan2 on purpose.
 */
function banco(name, eye, places) {
  const patches = [];
  const samples = [];
  for (const { bearing, distance, rise } of places) {
    if (eye.y + rise > BYTE_CEILING) {
      throw new Error(`banco ${name}: ${(eye.y + rise).toFixed(1)} m `
        + `is over the ground byte's own ceiling of ${BYTE_CEILING.toFixed(1)} m`);
    }
    const a = bearing * Math.PI / 180;
    const one = loneCell(eye.x + Math.cos(a) * distance, eye.z + Math.sin(a) * distance,
      Math.round((eye.y + rise) / VOXEL) - 1, eye);
    patches.push(one.patch);
    samples.push(...one.pts);
  }
  return { name, patches, samples, eyes: [{ ...eye, name: 'la posa fittata' }] };
}

const AT = { x: POSES.target.position.x, y: POSES.target.position.y, z: POSES.target.position.z };

const spread = (from, to, step) => {
  const out = [];
  for (let b = from; b <= to; b += step) out.push(b);
  return out;
};

// THE THREE BANCHI, and each one is written for a different half of the
// argument. Together they carry ground above the eye at wide arcs, at narrow
// ones, across the cut of atan2, and on one side of the walker only.
const BANCHI = [
  // WIDE ARCS AND ONE SIDE ONLY. Cells eleven metres out subtend most of thirty
  // degrees each, which is twenty bearings: this is where an arc collapsed to a
  // centre, truncated inward, or looked up with the axes swapped leaves a hole.
  // And it is a quadrant and not a ring, so leg 4 has something to cut.
  banco('banco vicino -- una cresta di lato, ad archi larghi', AT,
    spread(20, 160, 20).map((bearing) => ({ bearing, distance: 11, rise: 4 }))),
  // NARROW ARCS, ACROSS THE CUT OF atan2. A hundred and twenty metres out a
  // cell is three bearings wide, which is where the receipt of leg 7 is a real
  // ceiling; and bearing 180 is where atan2 wraps, which is the defect that
  // writes the height into the whole ring EXCEPT where the cell is.
  banco('banco lontano -- la cresta oltre il taglio di atan2', AT,
    spread(150, 210, 5).map((bearing) => ({ bearing, distance: 120, rise: 9 }))),
  // ONE MOUND BESIDE THE WALKER. Close and high, which is the only geometry the
  // padding for the step is load-bearing on -- and the geometry V5 is going to
  // put back beside the eye.
  banco('banco del monticello -- uno solo, vicino e alto', AT,
    [{ bearing: 0, distance: 8, rise: 5 }]),
];

const TERRAINS = [WORLD, ...BANCHI];

const shortName = (terrain) => terrain.name.split(' --')[0];

// ---------------------------------------------------------------------------
// THE ARITHMETIC THE LEGS ARE WRITTEN IN.

/**
 * THE SINGLE BOUND campo-field.js HANDS campoHorizon AS ITS CEILING.
 *
 * IT IS THE ENGINE'S OWN AND NOT A COPY. It used to be written out here, and
 * this file already carries one second implementation (ringOf) that leg 0 has
 * to spend a whole leg keeping honest; a second one, with nothing to compare it
 * against, is how leg 2b below could go green on a ceiling the field does not
 * actually pass. Since U-CAMPO-4 the arithmetic is campoSkyBound in
 * src/world/voxel/campo.js and skySlope() is four words that call it, so what
 * this leg clamps with is what the fragment reads.
 */
const oneBound = (patches, eye) => campoSkyBound(patches, eye, CAMPO_HORIZON_REACH);

/**
 * AND THE CEILING AS IT WAS BEFORE U-CAMPO-4: taken at the EXACT eye, with no
 * padding for the walker's step. This is a DEFECT and it is here to be
 * injected -- case (j) of the self test puts it under leg 2b and requires the
 * leg to say no to it on ground nearer than reach/margin. It is the shape the
 * field shipped for three sessions, so it is written out rather than described.
 */
function exactBound(patches, eye) {
  let worst = -1e9;
  for (const patch of patches) {
    const { x0, z0, cell: c, n, top } = patch;
    for (let j = 0; j < n; j += 1) {
      const az = z0 + j * c;
      const dz = Math.max(az - eye.z, 0, eye.z - (az + c));
      for (let i = 0; i < n; i += 1) {
        const byte = top[j * n + i];
        if (!byte) continue;
        const ax = x0 + i * c;
        const dx = Math.max(ax - eye.x, 0, eye.x - (ax + c));
        const y = (byte - CAMPO_BIAS) * VOXEL + CAMPO_BLADE_CEIL;
        if (y <= eye.y) continue;
        const d = Math.max(1, Math.hypot(dx, dz));
        const s = (y - eye.y) / d;
        if (s > worst) worst = s;
      }
    }
  }
  return Math.max(0, worst) + CAMPO_HORIZON_MARGIN;
}

/**
 * THE ONE QUESTION. Given a ring, and an eye actually at `eye`, the worst
 * amount by which a sample of the law stands ABOVE what the ring says can be
 * there. Nought or less is safe; anything positive is a hole.
 *
 * `tested` is the half this guard did not have, and the whole of why it went
 * green on nothing: how many samples the question was actually asked of. A
 * verdict of «safe» over nought samples is not a verdict.
 */
function worstBreach(ring, eye, samples, bend = null) {
  let worst = -Infinity;
  let where = null;
  let tested = 0;
  for (const [x, z, y] of samples) {
    if (y <= eye.y) continue;
    const dx = x - eye.x;
    const dz = z - eye.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) continue;
    tested += 1;
    const slope = (y - eye.y) / d;
    const bin = bend ? bend(dx, dz) : campoBearingOf(dx, dz, ring.length);
    const breach = slope - ring[bin];
    if (breach > worst) { worst = breach; where = { x, z, y, slope, bin, has: ring[bin] }; }
  }
  return { worst, where, tested };
}

/**
 * THE RING, MODELLED -- the engine's own construction, with one thing wrong.
 *
 * This is a second implementation of campoHorizon and it is dangerous for
 * exactly that reason, so leg 0 compares it against the engine on every terrain
 * with no defect set. Each flag is one way the ring could plausibly be written,
 * and three of them are how anybody would write it the first time.
 *
 *   centreOnly  the arc collapsed to the bearing of the cell's centre
 *   reach       how far the eye may wander; 0 is «no padding for the step»
 *   margin      the slope margin the single bound has always carried
 *   inward      the quantisation rounded INTO the arc instead of out of it
 *   longWay     the arc taken between the smallest and the largest of the four
 *               corner angles, which straddles the cut of atan2
 *   halfBias    the ground byte with CAMPO_BIAS taken off a second time
 */
function ringOf(terrain, eye, {
  centreOnly = false, reach = CAMPO_HORIZON_REACH, margin = true,
  inward = false, longWay = false, halfBias = false,
} = {}) {
  const bins = CAMPO_BEARINGS;
  const out = new Float32Array(bins).fill(0);
  const TAU = Math.PI * 2;
  const eyeLow = eye.y - reach;
  for (const patch of terrain.patches) {
    const { x0, z0, cell: c, n, top } = patch;
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const shipped = top[j * n + i];
        if (!shipped) continue;
        const byte = halfBias ? Math.max(1, shipped - CAMPO_BIAS) : shipped;
        const y = (byte - CAMPO_BIAS) * VOXEL + CAMPO_BLADE_CEIL;
        if (y <= eyeLow) continue;
        const ax = x0 + i * c;
        const az = z0 + j * c;
        const dx = Math.max(ax - eye.x, 0, eye.x - (ax + c));
        const dz = Math.max(az - eye.z, 0, eye.z - (az + c));
        const raw = Math.hypot(dx, dz);
        const d = Math.max(1, raw - reach);
        const slope = (y - eyeLow) / d + (margin ? CAMPO_HORIZON_MARGIN : 0);
        if (centreOnly) {
          // The way anybody writes it first: the cell's CENTRE, one bearing.
          const b = campoBearingOf(ax + c * 0.5 - eye.x, az + c * 0.5 - eye.z, bins);
          if (slope > out[b]) out[b] = slope;
          continue;
        }
        if (raw <= reach) {
          for (let b = 0; b < bins; b += 1) if (slope > out[b]) out[b] = slope;
          continue;
        }
        const a = [
          Math.atan2(az - eye.z, ax - eye.x), Math.atan2(az - eye.z, ax + c - eye.x),
          Math.atan2(az + c - eye.z, ax - eye.x), Math.atan2(az + c - eye.z, ax + c - eye.x),
        ];
        let lo;
        let hi;
        if (longWay) {
          const sorted = [...a].sort((p, q) => p - q);
          lo = sorted[0];
          hi = sorted[3];
        } else {
          // The engine's own: offsets from the first corner, each wrapped into
          // (-pi, pi], so an arc narrower than half a turn cannot straddle the
          // cut and the smallest and largest offsets are its two ends.
          let lowOff = 0;
          let highOff = 0;
          for (let k = 1; k < 4; k += 1) {
            let d0 = a[k] - a[0];
            if (d0 > Math.PI) d0 -= TAU;
            else if (d0 < -Math.PI) d0 += TAU;
            if (d0 < lowOff) lowOff = d0;
            if (d0 > highOff) highOff = d0;
          }
          lo = a[0] + lowOff;
          hi = a[0] + highOff;
        }
        const swing = Math.atan2(reach, raw);
        lo -= swing;
        hi += swing;
        const b0 = inward ? Math.ceil((lo + Math.PI) / TAU * bins) + 1
          : Math.floor((lo + Math.PI) / TAU * bins) - 1;
        const b1 = inward ? Math.floor((hi + Math.PI) / TAU * bins) - 1
          : Math.ceil((hi + Math.PI) / TAU * bins) + 1;
        if (b1 - b0 >= bins) {
          for (let b = 0; b < bins; b += 1) if (slope > out[b]) out[b] = slope;
          continue;
        }
        for (let b = b0; b <= b1; b += 1) {
          const k = ((b % bins) + bins) % bins;
          if (slope > out[k]) out[k] = slope;
        }
      }
    }
  }
  return out;
}

/** The engine's own ring for a terrain and an eye, unclamped unless asked. */
const engineRing = (terrain, eye, reach = CAMPO_HORIZON_REACH, ceiling = Infinity) =>
  campoHorizon(new Float32Array(CAMPO_BEARINGS), terrain.patches, eye, reach, ceiling);

const R = CAMPO_HORIZON_REACH;

// EVERY EYE THE RING DECLARES IT ANSWERS FOR, AND NOT ONE MORE.
//
// THIS IS A DEFECT THIS UNIT FOUND IN THE GUARD RATHER THAN IN THE RING, and it
// was invisible for the same reason the other four were: with no ground above
// the eye there was nothing for an over-strict step to break on. The steps
// shipped here were the corners of a CUBE of half-side `reach` -- (±R, ±R, ±R)
// -- which is 0.424 m of horizontal travel where campoHorizon pads by 0.300.
// Put on ground that stands over the eye, that asks the ring to be true about
// an eye it never promised to cover, and leg 2 goes red on a correct ring.
//
// WHAT THE RING ACTUALLY PROMISES, read off its own arithmetic: the slope is
// taken from an eye lowered by `reach` (eyeLow) and nearer by `reach` (d = raw
// - reach), and the arc is widened by atan2(reach, raw). Those three are
// simultaneous, so what is covered is a CYLINDER: horizontal travel up to
// `reach` in any direction, together with a rise or a fall up to `reach`.
//
// So the steps are that cylinder -- its axis, its rim at eight bearings, and
// both lids -- and the horizontal ones are scaled to a RADIUS of R rather than
// laid on a square. src/world/voxel/campo-field.js rebuilds the ring when the
// eye has travelled 0.25 m horizontally or 0.25 m in height, so the 0.30 the
// ring pads by covers the travel it will actually see by a fifth; that coupling
// lives in a file this guard cannot import offline and is NOTEd rather than
// gated (owner: the field, U-CAMPO).
const STEPS = [[0, 0, 0]];
for (let k = 0; k < 8; k += 1) {
  const a = k * Math.PI / 4;
  for (const dy of [-R, 0, R]) STEPS.push([Math.cos(a) * R, dy, Math.sin(a) * R]);
}
STEPS.push([0, R, 0], [0, -R, 0]);

// ---------------------------------------------------------------------------
// LEGS 5 AND 6 AS PREDICATES, so the self test can put a defect through the
// same code the run uses rather than through a story about it.

const GLSL_SOURCE = 'src/world/voxel/campo-material.js';

// Asked of the SOURCE and not of the compiled numbers, because the property
// that matters is not "these two constants happen to agree today": it is that
// the fragment is BUILT OUT OF CAMPO_BEARINGS AND Math.PI, so the day somebody
// moves the bin count the two cannot come apart. A shader carrying 40.74366543
// written out by hand would pass a numeric check and fail this one, which is
// the right way round -- and the self test injects exactly that shader.
const WANTS = [
  'atan(dir0.z, dir0.x)',
  '${Math.PI.toFixed(8)}',
  '${(CAMPO_BEARINGS / (Math.PI * 2)).toFixed(8)}',
  'clamp(bearing, 0, ${CAMPO_BEARINGS - 1})',
];

/** What the fragment is missing of the terms campoBearingOf is written in. */
const twoLanguages = (glsl) => WANTS.filter((w) => !glsl.includes(w));

/** Whether the material declares the ring as the vec4s the fragment reads. */
const ringShape = (glsl) => CAMPO_BEARINGS % 4 === 0
  && glsl.includes('uniform vec4 uSkyRing[${CAMPO_BEARINGS / 4}]');

// ===========================================================================

if (!injected) {
  const report = reporter('guard-orizzonte -- a ray thrown away could not have hit');

  // LEG 0 -- the model the injections go through is the engine's.
  let modelGap = 0;
  for (const terrain of TERRAINS) {
    for (const eye of terrain.eyes) {
      const mine = ringOf(terrain, eye, {});
      const theirs = engineRing(terrain, eye);
      for (let b = 0; b < CAMPO_BEARINGS; b += 1) {
        modelGap = Math.max(modelGap, Math.abs(mine[b] - theirs[b]));
      }
    }
  }
  report.check(modelGap === 0, "0. il modello delle iniezioni e' l'anello del motore",
    `su ${TERRAINS.length} terreni il divario peggiore fra i due anelli e' ${modelGap}`);

  // LEGS 1-4, terrain by terrain, and every one of them says how much it bit on.
  let banchiTested = 0;
  const benchExposure = [];
  for (const terrain of TERRAINS) {
    let worstStill = -Infinity;
    let worstWalked = -Infinity;
    let worstClamped = -Infinity;
    let stillAt = null;
    let walkedAt = null;
    let clampedAt = null;
    let ringOverBound = -Infinity;
    let tested = 0;
    const cutShare = [];
    const cutDepth = [];

    for (const eye of terrain.eyes) {
      const bound = oneBound(terrain.patches, eye);
      // TWO RINGS, AND THE DIFFERENCE BETWEEN THEM IS A FINDING OF THIS UNIT.
      // `read` is what the fragment actually reads: campoHorizon clamped to the
      // single bound campo-field.js hands it. `free` is what campoHorizon
      // BUILDS, before the clamp. See the note under leg 2b.
      const read = engineRing(terrain, eye, CAMPO_HORIZON_REACH, bound);
      const free = engineRing(terrain, eye, CAMPO_HORIZON_REACH);
      // 3/4: the ring against the single bound.
      let under = 0;
      let sum = 0;
      for (let b = 0; b < CAMPO_BEARINGS; b += 1) {
        ringOverBound = Math.max(ringOverBound, read[b] - bound);
        if (read[b] < bound - 1e-9) under += 1;
        sum += bound - read[b];
      }
      cutShare.push(under / CAMPO_BEARINGS);
      cutDepth.push(sum / CAMPO_BEARINGS / Math.max(bound, 1e-9));

      for (const [dx, dy, dz] of STEPS) {
        const moved = { x: eye.x + dx, y: eye.y + dy, z: eye.z + dz };
        const still = dx === 0 && dy === 0 && dz === 0;
        if (still) {
          const seen = worstBreach(read, moved, terrain.samples);
          tested += seen.tested;
          if (seen.worst > worstStill) { worstStill = seen.worst; stillAt = { eye, where: seen.where }; }
          continue;
        }
        const walked = worstBreach(free, moved, terrain.samples);
        if (walked.worst > worstWalked) { worstWalked = walked.worst; walkedAt = { eye, where: walked.where }; }
        const clamped = worstBreach(read, moved, terrain.samples);
        if (clamped.worst > worstClamped) { worstClamped = clamped.worst; clampedAt = { eye, where: clamped.where }; }
      }
    }
    if (!terrain.world) banchiTested += tested;

    const margin = (v) => (Number.isFinite(v) ? `${(-v).toFixed(4)} di pendenza SOTTO l'anello`
      : "NESSUN CAMPIONE SOPRA L'OCCHIO: non e' un verdetto");
    report.line('');
    report.line(`  ${terrain.name}`);
    report.line(`    ${terrain.patches.length} riquadri, ${terrain.samples.length} campioni, `
      + `${terrain.eyes.length} occhi, ${tested} campioni sopra l'occhio`);
    report.check(worstStill <= 0, '1. conservativo, da fermi',
      `il peggior campione sta ${margin(worstStill)}`
      + (stillAt && stillAt.where ? ` (posa ${stillAt.eye.name}, bidone ${stillAt.where.bin})` : ''));
    report.check(worstWalked <= 0, "2. conservativo, dopo un passo (l'anello come campoHorizon lo costruisce)",
      `con l'occhio mosso di ${R} m in ogni verso il peggiore sta ${margin(worstWalked)}`
      + (walkedAt && walkedAt.where ? ` (posa ${walkedAt.eye.name}, bidone ${walkedAt.where.bin})` : ''));

    // LEG 2b -- THE SAME STEP, ON THE RING THE FRAGMENT ACTUALLY READS.
    //
    // GATED ON EVERY TERRAIN SINCE U-CAMPO-4, and the banchi are the half that
    // means anything. It was gated on the world alone and only MEASURED on the
    // banchi, because when U-GUARDIA-3 wrote it the exposure was real and the
    // cure sat in a file that unit did not own: the ceiling campo-field.js
    // handed campoHorizon was taken at the EXACT eye, so the clamp on the ring's
    // last line cut off the whole 0.30 m of padding leg 2 exists for, and the
    // banchi went +0.0988 and +0.0841 THROUGH the ring. The world has no ground
    // above the eye, so it read as a pass there and the gate bit on nothing.
    // The ceiling now carries the same padded eye the ring does (campoSkyBound),
    // the exposure is gone, and the leg is asserted where it can actually fail.
    const exposed = worstClamped > 0;
    report.check(!exposed, '2b. e anche col soffitto del bound unico addosso',
      `${margin(worstClamped)}`
      + (clampedAt && clampedAt.where ? ` (posa ${clampedAt.eye.name}, bidone ${clampedAt.where.bin})` : ''));
    if (exposed && !terrain.world) benchExposure.push({ terrain, worst: worstClamped, at: clampedAt });

    report.check(ringOverBound <= 1e-6, "3. mai piu' lasco del bound unico",
      `il bidone piu' alto sta ${ringOverBound.toFixed(6)} sopra la pendenza sola`);

    // LEG 4 ONLY WHERE IT MEANS ANYTHING. On ground that stands nowhere -- or
    // that stands equally in every direction -- the correct ring cuts nothing,
    // and a gate that demanded otherwise would be demanding a hole.
    const share = Math.min(...cutShare);
    const depth = Math.min(...cutDepth);
    if (tested > 0 && !terrain.world) {
      report.check(share >= 0.5 && depth >= 0.05, '4. e taglia davvero',
        `almeno ${(share * 100).toFixed(1)}% dei bidoni sta sotto il bound unico, `
        + `in media ${(depth * 100).toFixed(1)}% piu' basso`);
    } else {
      report.line(`    4. taglia il ${(share * 100).toFixed(1)}% dei bidoni, `
        + `${(depth * 100).toFixed(1)}% piu' basso -- non gateato su questo terreno`);
    }
  }

  if (WORLD.samples.every(([, , y]) => y <= WORLD.eyes[0].y)) {
    const tallest = Math.max(...WORLD.samples.map((s) => s[2]), 0);
    report.note("IL MONDO NON HA PIU' TERRA SOPRA L'OCCHIO, e questo e' il numero: su "
      + `${WORLD.samples.length} campioni della legge nella finestra lontana (${SPAN} m di `
      + `lato, passo ${(cell / 4).toFixed(2)} m) ZERO stanno sopra l'occhio -- la piu' alta `
      + `e' a ${tallest.toFixed(3)} m contro ${WORLD.eyes[0].y.toFixed(3)} della posa `
      + 'fittata. La cresta a 96 m e\' caduta con U-CORNICE-1 (R6 §3) e l\'altopiano che '
      + 'resta e\' piatto: su QUESTO terreno le gambe 1, 2, 4 e 7 non hanno nulla da '
      + 'mordere, ed e\' esattamente perche\' nessuno se ne accorgeva che questa guardia '
      + 'lasciava passare quattro iniezioni su otto (E-PERF5, E-LUCE5, E-CORNICE3). I '
      + 'banchi qui sopra sono la terra che il guard si porta. Non e\' gateato: la terra '
      + 'del mondo non e\' di questa guardia. Proprietari: U-CORNICE (le colline oltre '
      + 'l\'acqua) e U-CAMPO (l\'altopiano).');
  }

  report.check(banchiTested > 0, "e i banchi hanno terra sopra l'occhio da mordere",
    `${banchiTested} campioni sopra l'occhio sui ${BANCHI.length} banchi`);

  // THE FINDING OF U-GUARDIA-3, CLOSED BY U-CAMPO-4 -- AND THE ALARM THAT STAYS.
  //
  // campoHorizon takes a padding for the walker's step: it lowers the eye by
  // `reach` and brings it `reach` nearer. campo-field.js used to hand it a
  // CEILING taken at the EXACT eye, and the last line of campoHorizon clamps
  // the ring down to it, so on the steepest bearing the padding was thrown
  // straight back away and all that was left to carry the step was the 0.02 the
  // single bound adds by hand.
  //
  // WHERE THAT STOPPED BEING ENOUGH IS A DIVISION. A walker who drops by
  // `reach` raises the slope to ground at distance d by reach/d, with no help
  // from the horizontal at all, so the margin covers the drop only while
  // d >= reach / margin. Both numbers are the engine's own, so the distance is
  // computed here rather than stated: 0.30 / 0.02 = 15.0 m. The banchi that sit
  // inside it went +0.0988 and +0.0841 THROUGH the ring the fragment reads.
  //
  // THE CEILING IS NOW campoSkyBound, of the same padded eye, so it is a
  // maximum OF the ring's own slopes and the clamp cannot cut one of them. What
  // follows is kept as an ALARM and not as a diagnosis: it prints only if a
  // banco breaches again, which is the shape a regression here would take.
  const CROSS = CAMPO_HORIZON_REACH / CAMPO_HORIZON_MARGIN;
  if (benchExposure.length) {
    report.note('IL SOFFITTO DEL BOUND UNICO BUTTA VIA IL MARGINE DEL PASSO, di nuovo: '
      + `campoHorizon si prende ${CAMPO_HORIZON_REACH} m di margine per il passo del `
      + 'camminatore, e il soffitto che gli arriva non se lo porta. Un soffitto preso '
      + `all'occhio ESATTO lascia solo il ${CAMPO_HORIZON_MARGIN} del bound unico, e quello `
      + `copre una discesa di ${CAMPO_HORIZON_REACH} m soltanto oltre `
      + `${CAMPO_HORIZON_REACH}/${CAMPO_HORIZON_MARGIN} = ${CROSS.toFixed(1)} m dall'occhio `
      + '(il termine di quota da solo, reach/d). Sui banchi con terra piu\' vicina di cosi\' '
      + `il campione peggiore SFONDA l'anello: `
      + benchExposure.map(({ terrain, worst }) => `${shortName(terrain)} +${worst.toFixed(4)}`).join(', ')
      + '. E\' la regressione di U-CAMPO-4: campoSkyBound (src/world/voxel/campo.js) deve '
      + 'prendere lo stesso occhio imbottito che campoHorizon prende, e skySlope() in '
      + 'src/world/voxel/campo-field.js deve restare le quattro parole che lo chiamano. '
      + 'Radice: E-PERF5 «margine dell\'anello da rimisurare quando V5 mette terra vicino '
      + 'all\'occhio». Proprietario: U-CAMPO (il campo).');
  }

  // LEG 5 -- the same numbering in both languages.
  report.line('');
  const glsl = read(GLSL_SOURCE);
  const missing = twoLanguages(glsl);
  report.check(missing.length === 0, '5. una legge in due lingue',
    missing.length ? `manca dal frammento: ${missing.join(' | ')}`
      : "il frammento e' costruito su atan(dir0.z, dir0.x), Math.PI e CAMPO_BEARINGS, "
        + 'gli stessi tre di campoBearingOf');

  // LEG 6 -- the shape of the uniform.
  report.check(ringShape(glsl), "6. l'anello e' la forma che il seggio porta",
    `${CAMPO_BEARINGS} bidoni = ${CAMPO_BEARINGS / 4} vec4, e il materiale li dichiara cosi'`);

  // LEG 7 -- THE RECEIPT.
  //
  // Writes per cell above the eye, and how many cells claimed the whole ring.
  // The ceiling is not a round number -- it is what a cell at the distance of a
  // real crest costs, plus room, and not enough for a law that starts handing
  // whole rings out. It is gated on the FAR banco because that is where the
  // world's own ridge stood and where this number is a ceiling rather than a
  // triviality; every terrain's reading is printed beside it.
  const CEILING = { perAbove: 10.0, whole: 0 };
  const receipts = [];
  for (const terrain of TERRAINS) {
    let worstPer = 0;
    let worstWhole = 0;
    let above = 0;
    for (const eye of terrain.eyes) {
      engineRing(terrain, eye, CAMPO_HORIZON_REACH, oneBound(terrain.patches, eye));
      const c = campoHorizonCost();
      above += c.above;
      const per = c.writes / Math.max(1, c.above);
      if (per > worstPer) worstPer = per;
      if (c.whole > worstWhole) worstWhole = c.whole;
    }
    receipts.push({ terrain, worstPer, worstWhole, above });
  }
  const far = receipts.find((r) => shortName(r.terrain) === 'banco lontano');
  report.check(far.worstPer <= CEILING.perAbove && far.worstWhole <= CEILING.whole,
    '7. e non costa la camminata',
    `${far.worstPer.toFixed(2)} scritture per cella sopra l'occhio sul banco lontano `
    + `(tetto ${CEILING.perAbove}), ${far.worstWhole} anelli interi (tetto ${CEILING.whole})`);
  // AND NO TERRAIN MAY HAND OUT A WHOLE RING while the eye stands outside every
  // cell of it: one of those is 256 writes, and a law that starts producing
  // them shows up here before it shows up in a walk.
  report.check(receipts.every((r) => r.worstWhole === 0),
    "e nessun terreno regala l'anello intero",
    receipts.map((r) => `${shortName(r.terrain)} ${r.worstWhole}`).join(', '));
  for (const r of receipts) {
    report.line(`    ${shortName(r.terrain).padEnd(22)} ${r.worstPer.toFixed(2)} scritture `
      + `per cella sopra l'occhio, ${r.above} celle sopra`);
  }

  report.line('');
  report.line(`  ${TERRAINS.length} terreni, ${CAMPO_BEARINGS} bidoni, `
    + `${STEPS.length} passi per occhio`);
  report.end();
}

// ---------------------------------------------------------------------------
// AND THE OTHER DIRECTION: the guard against defects put into the ring itself.
//
// Every one of these is a way the ring could plausibly be written, and every
// one of them leaves a hole in the ground on a bearing nobody has walked to.
//
// THE FORM OF EVERY CASE IS THE SAME, and it is the form that makes a self test
// worth anything: the guard's predicate must say NO to the defect and YES to
// the correct ring, ON THE SAME GROUND. A case that only showed the defect
// failing would not distinguish a working instrument from one that says no to
// everything -- and a case that had no ground to say it on is what this file
// used to ship. `inject` walks the terrains and names the one where both halves
// hold, so a defect that is load-bearing on no ground this guard has says so
// out loud instead of being quietly dropped.

const cases = [];

/** Is the correct ring safe on this terrain, at this eye, over these steps? */
function safe(terrain, eye, steps) {
  const ring = engineRing(terrain, eye);
  return steps.every(([dx, dy, dz]) => worstBreach(ring,
    { x: eye.x + dx, y: eye.y + dy, z: eye.z + dz }, terrain.samples).worst <= 0);
}

/**
 * A defect, put on every terrain, and caught when SOME terrain both breaks
 * under it and is safe without it.
 *
 * @param {string} what   the defect, in words
 * @param {(terrain, eye) => Float32Array} build  the ring as the defect writes it
 * @param {{bend: Function, steps: number[][]}} how  a wrong bearing lookup, and
 *        which eyes to ask from
 */
function inject(what, build, { bend = null, steps = [[0, 0, 0]] } = {}) {
  let on = null;
  for (const terrain of TERRAINS) {
    for (const eye of terrain.eyes) {
      const ring = build(terrain, eye);
      const breaks = steps.some(([dx, dy, dz]) => worstBreach(ring,
        { x: eye.x + dx, y: eye.y + dy, z: eye.z + dz }, terrain.samples, bend).worst > 0);
      if (breaks && safe(terrain, eye, steps)) { on = shortName(terrain); break; }
    }
    if (on) break;
  }
  cases.push({ what: `${what}${on ? `  [${on}]` : ''}`, caught: Boolean(on) });
}

// (a) the arc collapsed to the cell's centre bearing
inject("l'arco ridotto alla direzione del CENTRO della cella",
  (t, eye) => ringOf(t, eye, { centreOnly: true }));

// (b) THE PADDING. No room for the walker's step: the ring is exact standing
//     still and a hole opens the moment they move.
inject("nessun margine per il passo del camminatore (reach = 0), e l'occhio si muove",
  (t, eye) => ringOf(t, eye, { reach: 0 }), { steps: STEPS });

// (c) the bearing read with the axes swapped -- the ring is right and the
//     fragment looks it up in the wrong place
inject('il frammento cerca il bidone con gli assi scambiati',
  (t, eye) => engineRing(t, eye), { bend: (dx, dz) => campoBearingOf(dz, dx) });

// (d) the arc truncated INWARD instead of outward -- the quantisation written
//     the natural way round, which throws away the bearings at its ends. (An
//     off-by-one of a SINGLE bearing is not injected, and that is a statement
//     and not an omission: the ring is deliberately widened by one bearing at
//     each end, so it survives one, and a guard that demanded it fail would be
//     demanding the padding be taken out. This one rounds in by two.)
inject("l'arco troncato all'INDENTRO invece che all'infuori",
  (t, eye) => ringOf(t, eye, { inward: true }));

// (e) THE WRAP. A cell straddling the cut of atan2 has its smallest and its
//     largest corner angle on OPPOSITE sides of it: taken as a range they
//     describe the whole rest of the circle, and the ring gets the height
//     written everywhere EXCEPT where the cell is. The far banco is written
//     across that cut on purpose.
inject("l'arco preso fra il minimo e il massimo dei quattro angoli (il giro lungo)",
  (t, eye) => ringOf(t, eye, { longWay: true }));

// (f) the bias taken off twice -- every ground ten metres under the eye, the
//     ring collapses to nought, and every ray in the frame is thrown away
inject('il bias della quota tolto due volte',
  (t, eye) => ringOf(t, eye, { halfBias: true }));

// THE SLOPE MARGIN IS NOT INJECTED, AND THAT IS A FINDING RATHER THAN A GAP.
//
// CAMPO_HORIZON_MARGIN cannot be load-bearing, structurally: the ring's own
// slope is taken from an eye lowered by `reach` and a distance shortened by
// `reach`, so it is STRICTLY above the true slope of any sample from the exact
// eye before the margin is added at all. Measured on the three banchi, the
// worst sample stands under the ring by 0.0721 / 0.0028 / 0.1041 with the
// margin taken out and 0.0921 / 0.0228 / 0.1241 with it in. So it is slack on
// top of slack -- worth having (at 120 m it is 89% of what is left), and a
// guard that claimed to catch its removal would be claiming something false.
// It is stated here instead, which is what the campaign's own method asks for.

// (g) A RING ALLOWED ABOVE THE SINGLE BOUND, which is a regression the legs
//     above would not see: it is not a hole, it is the ring buying nothing.
//     Put through leg 3's own predicate rather than through a breach.
{
  let on = null;
  for (const terrain of TERRAINS) {
    for (const eye of terrain.eyes) {
      const bound = oneBound(terrain.patches, eye);
      const good = engineRing(terrain, eye, CAMPO_HORIZON_REACH, bound);
      const loose = Float32Array.from(good, (v) => v + 0.05);
      const over = (ring) => Array.from(ring).some((v) => v > bound + 1e-6);
      if (over(loose) && !over(good)) { on = shortName(terrain); break; }
    }
    if (on) break;
  }
  cases.push({ what: `un bidone lasciato sopra il bound unico  [${on}]`, caught: Boolean(on) });
}

// (h) the swing of the walker's step measured against the CLAMPED distance
//     instead of the raw one -- which for the cells a metre away opens the arc
//     to a third of a turn each and turns the ring into a fill. Caught on the
//     RECEIPT, which is leg 7's own instrument.
{
  const t = BANCHI[0];
  const eye = t.eyes[0];
  engineRing(t, eye, 3.0);
  const wide = campoHorizonCost();
  engineRing(t, eye, CAMPO_HORIZON_REACH);
  const tight = campoHorizonCost();
  cases.push({
    what: "il margine del passo allargato, e la ricevuta dell'anello lo dice",
    caught: wide.writes / Math.max(1, wide.above)
      > tight.writes / Math.max(1, tight.above) * 1.3,
  });
}

// (i) THE DEFECT THIS FILE SHIPPED: a verdict read off nought samples. Every
//     leg above filters by «above the eye», so a terrain with no such ground
//     makes all of them true of the empty set -- which is how four injections
//     went through for three sessions. The predicate that has to say no is
//     worstBreach's own count, and it is asserted here so that no rewrite can
//     quietly go back to calling an empty set a pass.
{
  const t = BANCHI[0];
  const eye = t.eyes[0];
  const overhead = { ...eye, y: 400 };          // an eye above every hill there is
  const empty = worstBreach(engineRing(t, overhead), overhead, t.samples);
  const full = worstBreach(engineRing(t, eye), eye, t.samples);
  cases.push({
    what: "un terreno senza terra sopra l'occhio, e il verdetto letto lo stesso",
    caught: empty.tested === 0 && empty.worst === -Infinity && full.tested > 0,
  });
}

// (j) LEG 2b ITSELF, AND IT IS THE REGRESSION TEST OF U-CAMPO-4. The defect is
//     a ceiling taken at the EXACT eye -- what campo-field.js handed
//     campoHorizon for three sessions -- and the leg has to say NO to it on
//     ground nearer than reach/margin, YES to it past that distance (where the
//     0.02 of the single bound still covers a 0.30 m drop on its own), and YES
//     to the padded ceiling the field hands today. Three halves, because two
//     would let a leg that says no to everything pass, and a leg that is right
//     about the defect but wrong about the cure is how the repair gets undone.
{
  const clampedWalk = (t, ceilingOf) => {
    const eye = t.eyes[0];
    const read = engineRing(t, eye, CAMPO_HORIZON_REACH, ceilingOf(t.patches, eye));
    return STEPS.some(([dx, dy, dz]) => worstBreach(read,
      { x: eye.x + dx, y: eye.y + dy, z: eye.z + dz }, t.samples).worst > 0);
  };
  const near = BANCHI.find((t) => shortName(t) === 'banco del monticello');
  const far = BANCHI.find((t) => shortName(t) === 'banco lontano');
  cases.push({
    what: "il soffitto preso all'occhio esatto, e la terra vicina che ci sfonda dentro",
    caught: clampedWalk(near, exactBound)
      && !clampedWalk(far, exactBound)
      && !clampedWalk(near, oneBound),
  });
}

// (k) THE MODEL DRIFTING FROM THE ENGINE. Leg 0 is what keeps every injection
//     above honest, so it gets an injection of its own: the model with one
//     thing wrong must not read as the engine's ring.
{
  const t = BANCHI[0];
  const eye = t.eyes[0];
  const gapOf = (ring) => {
    const theirs = engineRing(t, eye);
    let worst = 0;
    for (let b = 0; b < CAMPO_BEARINGS; b += 1) worst = Math.max(worst, Math.abs(ring[b] - theirs[b]));
    return worst;
  };
  cases.push({
    what: "il modello delle iniezioni scostato dal motore",
    caught: gapOf(ringOf(t, eye, { inward: true })) > 0 && gapOf(ringOf(t, eye, {})) === 0,
  });
}

// (l), (m), (n) the two legs read off the shader's source, injected INTO THE
//     TEXT the run reads rather than described beside it.
{
  const glsl = read(GLSL_SOURCE);
  const clean = twoLanguages(glsl).length === 0;
  cases.push({
    what: 'il frammento che cerca il bidone con atan(dir0.x, dir0.z)',
    caught: clean
      && twoLanguages(glsl.replace('atan(dir0.z, dir0.x)', 'atan(dir0.x, dir0.z)')).length > 0,
  });
  cases.push({
    what: 'il numero dei bidoni scritto a mano nel frammento invece che interpolato',
    caught: clean && twoLanguages(glsl.replace('${(CAMPO_BEARINGS / (Math.PI * 2)).toFixed(8)}',
      (CAMPO_BEARINGS / (Math.PI * 2)).toFixed(8))).length > 0,
  });
  cases.push({
    what: "il seggio dell'anello dichiarato con una taglia sua",
    caught: ringShape(glsl) && !ringShape(glsl.replace(
      'uniform vec4 uSkyRing[${CAMPO_BEARINGS / 4}]', 'uniform vec4 uSkyRing[64]')),
  });
}

selfTest('guard-orizzonte', cases);
