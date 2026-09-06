import {
  CAMPO_BEARINGS, CAMPO_BIAS, CAMPO_BLADE_CEIL, CAMPO_FAR, CAMPO_HORIZON_MARGIN,
  CAMPO_HORIZON_REACH, CENTRE, VOXEL, campoBearingOf, campoCoarseSpan, campoFarOrigin,
  campoGroundByte, campoHorizon, campoHorizonCost, columnSpec,
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
// and it asks it against the LAW -- columnSpec, sampled finer than the coarse
// cells the ring is built from -- so a mistake in the reduction, in the byte, in
// the bearing or in the padding fails here instead of in the picture.
//
// ===========================================================================
// THE LEGS
//
//   1. CONSERVATIVE, STANDING STILL. Sample the law across the far window at a
//      quarter of a coarse cell. Every sample that stands above the eye must be
//      under the ring at its own bearing.
//   2. CONSERVATIVE, HAVING WALKED. The same, for an eye moved by up to the
//      reach the ring declares -- in x, in z and in y, and in every diagonal of
//      the three -- without rebuilding the ring. This is the leg the padding
//      exists for, and the one a tidy-up would delete first.
//   3. NEVER LOOSER THAN THE ONE BOUND. The ring may only ever cut MORE than
//      the single slope did: a bearing above it would be a regression dressed
//      as a feature.
//   4. AND IT ACTUALLY CUTS. A ring that equalled the single bound everywhere
//      would pass legs 1-3 and buy nothing; the share of bearings strictly
//      under it, and by how much, is asserted rather than admired.
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
//      gated as a count -- «what you gate cannot be a clock» -- against what it
//      does today, with a ceiling that leaves room and no more.
// ===========================================================================

const report = reporter('guard-orizzonte -- a ray thrown away could not have hit');
const injected = process.argv.includes('--self');

const shape = CAMPO_FAR;
const cell = campoCoarseSpan(shape);
const origin = campoFarOrigin(shape);
const X0 = origin.cx * shape.tile * shape.cell;
const Z0 = origin.cz * shape.tile * shape.cell;
const SPAN = shape.side * shape.cell;
const N = Math.round(SPAN / cell);

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

const coarse = coarseFromLaw();
const patches = [{ x0: X0, z0: Z0, cell, n: N, top: coarse }];

/**
 * Every place the law puts ground, at a quarter of a coarse cell: the samples
 * the ring has to be true about. Held once, because the sweep runs it for eight
 * eyes and the law is not cheap.
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
const samples = lawSamples(cell / 4);

/** The single bound of campo-field.js skySlope(), written here to compare. */
function oneBound(eye) {
  let worst = -1e9;
  for (let j = 0; j < N; j += 1) {
    const az = Z0 + j * cell;
    const dz = Math.max(az - eye.z, 0, eye.z - (az + cell));
    for (let i = 0; i < N; i += 1) {
      const byte = coarse[j * N + i];
      if (!byte) continue;
      const ax = X0 + i * cell;
      const dx = Math.max(ax - eye.x, 0, eye.x - (ax + cell));
      const y = (byte - CAMPO_BIAS) * VOXEL + CAMPO_BLADE_CEIL;
      if (y <= eye.y) continue;
      const d = Math.max(1, Math.hypot(dx, dz));
      const s = (y - eye.y) / d;
      if (s > worst) worst = s;
    }
  }
  return Math.max(0, worst) + CAMPO_HORIZON_MARGIN;
}

/**
 * THE ONE QUESTION. Given a ring built for `built`, and an eye actually at
 * `eye`, the worst amount by which a sample of the law stands ABOVE what the
 * ring says can be there. Nought or less is safe; anything positive is a hole.
 */
function worstBreach(ring, built, eye, bend = null, over = null) {
  let worst = -Infinity;
  let where = null;
  for (const [x, z, y] of (over || samples)) {
    if (y <= eye.y) continue;
    const dx = x - eye.x;
    const dz = z - eye.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) continue;
    const slope = (y - eye.y) / d;
    const bin = bend ? bend(dx, dz) : campoBearingOf(dx, dz, ring.length);
    const breach = slope - ring[bin];
    if (breach > worst) { worst = breach; where = { x, z, y, slope, bin, has: ring[bin] }; }
  }
  return { worst, where, built };
}

const EYES = [];
for (const name of ['target', 'bordo-indietro']) {
  const p = POSES[name];
  if (p) EYES.push({ name, x: p.position.x, y: p.position.y, z: p.position.z });
}
EYES.push({ name: 'peggiore (-4, 16)', x: -4, y: 1.7, z: 16 });
EYES.push({ name: 'centro del mondo', x: CENTRE.x, y: 1.7, z: CENTRE.z });

const R = CAMPO_HORIZON_REACH;
// Every corner of the box the ring declares it covers, and the middle of it.
const STEPS = [
  [0, 0, 0], [R, 0, 0], [-R, 0, 0], [0, 0, R], [0, 0, -R],
  [R, R, R], [-R, R, -R], [R, R, -R], [-R, R, R],
];

if (!injected) {
  let worstStill = -Infinity;
  let worstWalked = -Infinity;
  let worstStillAt = null;
  let worstWalkedAt = null;
  let ringOverBound = -Infinity;
  const cutShare = [];
  const cutDepth = [];

  for (const eye of EYES) {
    const bound = oneBound(eye);
    const ring = campoHorizon(new Float32Array(CAMPO_BEARINGS), patches, eye,
      CAMPO_HORIZON_REACH, bound);
    // 3/4: the ring against the single bound.
    let under = 0;
    let sum = 0;
    for (let b = 0; b < CAMPO_BEARINGS; b += 1) {
      ringOverBound = Math.max(ringOverBound, ring[b] - bound);
      if (ring[b] < bound - 1e-9) under += 1;
      sum += bound - ring[b];
    }
    cutShare.push(under / CAMPO_BEARINGS);
    cutDepth.push(sum / CAMPO_BEARINGS / Math.max(bound, 1e-9));

    for (const [dx, dy, dz] of STEPS) {
      const moved = { x: eye.x + dx, y: eye.y + dy, z: eye.z + dz };
      const { worst, where } = worstBreach(ring, eye, moved);
      const still = dx === 0 && dy === 0 && dz === 0;
      if (still && worst > worstStill) { worstStill = worst; worstStillAt = { eye, where }; }
      if (!still && worst > worstWalked) { worstWalked = worst; worstWalkedAt = { eye, where }; }
    }
  }

  report.check(worstStill <= 0, '1. conservativo, da fermi',
    `il peggior campione sta ${(-worstStill).toFixed(4)} di pendenza SOTTO l'anello`
    + (worstStillAt && worstStillAt.where
      ? ` (posa ${worstStillAt.eye.name}, bidone ${worstStillAt.where.bin})` : ''));
  report.check(worstWalked <= 0, '2. conservativo, dopo un passo',
    `con l'occhio mosso di ${R} m in ogni verso il margine peggiore resta `
    + `${(-worstWalked).toFixed(4)}`
    + (worstWalkedAt && worstWalkedAt.where
      ? ` (posa ${worstWalkedAt.eye.name}, bidone ${worstWalkedAt.where.bin})` : ''));
  report.check(ringOverBound <= 1e-6, "3. mai piu' lasco del bound unico",
    `il bidone piu' alto sta ${ringOverBound.toFixed(6)} sopra la pendenza sola`);
  const share = Math.min(...cutShare);
  const depth = Math.min(...cutDepth);
  report.check(share >= 0.5 && depth >= 0.05, '4. e taglia davvero',
    `almeno ${(share * 100).toFixed(1)}% dei bidoni sta sotto il bound unico, `
    + `in media ${(depth * 100).toFixed(1)}% piu' basso`);

  // 5. THE SAME NUMBERING IN BOTH LANGUAGES.
  //
  // Asked of the SOURCE and not of the compiled numbers, because the property
  // that matters is not "these two constants happen to agree today": it is that
  // the fragment is BUILT OUT OF CAMPO_BEARINGS AND Math.PI, so the day
  // somebody moves the bin count the two cannot come apart. A shader carrying
  // 40.74366543 written out by hand would pass a numeric check and fail this
  // one, which is the right way round.
  const glsl = read('src/world/voxel/campo-material.js');
  const wants = [
    'atan(dir0.z, dir0.x)',
    '${Math.PI.toFixed(8)}',
    '${(CAMPO_BEARINGS / (Math.PI * 2)).toFixed(8)}',
    'clamp(bearing, 0, ${CAMPO_BEARINGS - 1})',
  ];
  const missing = wants.filter((w) => !glsl.includes(w));
  report.check(missing.length === 0, '5. una legge in due lingue',
    missing.length ? `manca dal frammento: ${missing.join(' | ')}`
      : "il frammento e' costruito su atan(dir0.z, dir0.x), Math.PI e CAMPO_BEARINGS, "
        + 'gli stessi tre di campoBearingOf');

  // 6. THE SHAPE OF THE UNIFORM.
  const vecs = CAMPO_BEARINGS / 4;
  const declared = glsl.includes(`uniform vec4 uSkyRing[\${CAMPO_BEARINGS / 4}]`);
  report.check(CAMPO_BEARINGS % 4 === 0 && declared, "6. l'anello e' la forma che il seggio porta",
    `${CAMPO_BEARINGS} bidoni = ${vecs} vec4, e il materiale li dichiara cosi'`);

  // 7. THE RECEIPT.
  //
  // AT_TODAY, taken at the four eyes above: writes per cell above the eye, and
  // how many cells claimed the whole ring. The ceiling is not a round number --
  // it is what today does plus a third, which is enough for the ridge V5 will
  // raise and not enough for a law that starts handing whole rings out.
  const AT_TODAY = { perAbove: 7.65, whole: 0 };
  const CEILING = { perAbove: 10.0, whole: 0 };
  let worstPer = 0;
  let worstWhole = 0;
  for (const eye of EYES) {
    campoHorizon(new Float32Array(CAMPO_BEARINGS), patches, eye, CAMPO_HORIZON_REACH,
      oneBound(eye));
    const c = campoHorizonCost();
    const per = c.writes / Math.max(1, c.above);
    if (per > worstPer) worstPer = per;
    if (c.whole > worstWhole) worstWhole = c.whole;
  }
  report.check(worstPer <= CEILING.perAbove && worstWhole <= CEILING.whole,
    '7. e non costa la camminata',
    `${worstPer.toFixed(2)} scritture per cella sopra l'occhio (oggi ${AT_TODAY.perAbove}, `
    + `tetto ${CEILING.perAbove}), ${worstWhole} anelli interi (tetto ${CEILING.whole})`);

  report.line(`  ${samples.length} campioni della legge, ${EYES.length} occhi, `
    + `${STEPS.length} passi ciascuno, ${CAMPO_BEARINGS} bidoni`);
  report.end();
}

// ---------------------------------------------------------------------------
// AND THE OTHER DIRECTION: the guard against defects put into the ring itself.
//
// Every one of these is a way the ring could plausibly be written -- three of
// them are how anybody would write it the first time -- and every one of them
// leaves a hole in the ground on a bearing nobody has walked to.
const eye = { x: POSES.target.position.x, y: POSES.target.position.y, z: POSES.target.position.z };
const bound = oneBound(eye);
const good = campoHorizon(new Float32Array(CAMPO_BEARINGS), patches, eye,
  CAMPO_HORIZON_REACH, bound);
const cases = [];

/** The ring written the way the defect writes it. */
function bent({ centreOnly = false, reach = CAMPO_HORIZON_REACH, margin = true,
  inward = false, longWay = false }) {
  const out = new Float32Array(CAMPO_BEARINGS).fill(0);
  const eyeLow = eye.y - reach;
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const byte = coarse[j * N + i];
      if (!byte) continue;
      const y = (byte - CAMPO_BIAS) * VOXEL + CAMPO_BLADE_CEIL;
      if (y <= eyeLow) continue;
      const ax = X0 + i * cell;
      const az = Z0 + j * cell;
      const dx = Math.max(ax - eye.x, 0, eye.x - (ax + cell));
      const dz = Math.max(az - eye.z, 0, eye.z - (az + cell));
      const raw = Math.hypot(dx, dz);
      const d = Math.max(1, raw - reach);
      const slope = (y - eyeLow) / d + (margin ? CAMPO_HORIZON_MARGIN : 0);
      if (centreOnly) {
        // The way anybody writes it first: the cell's CENTRE, one bearing.
        const b = campoBearingOf(ax + cell * 0.5 - eye.x, az + cell * 0.5 - eye.z);
        if (slope > out[b]) out[b] = slope;
        continue;
      }
      if (raw <= reach) { out.fill(Math.max(out[0], slope)); continue; }
      const TAU = Math.PI * 2;
      const angles = [
        Math.atan2(az - eye.z, ax - eye.x), Math.atan2(az - eye.z, ax + cell - eye.x),
        Math.atan2(az + cell - eye.z, ax - eye.x),
        Math.atan2(az + cell - eye.z, ax + cell - eye.x),
      ].sort((p, q) => p - q);
      let gap = -1; let at = 0;
      for (let k = 0; k < 4; k += 1) {
        const g = (angles[(k + 1) & 3] - angles[k] + TAU) % TAU;
        if (g > gap) { gap = g; at = (k + 1) & 3; }
      }
      const pad = Math.atan2(reach, raw);
      const lo = longWay ? angles[0] - pad : angles[at] - pad;
      const hi = longWay ? angles[3] + pad : angles[at] + (TAU - gap) + pad;
      const b0 = inward ? Math.ceil((lo + Math.PI) / TAU * CAMPO_BEARINGS) + 1
        : Math.floor((lo + Math.PI) / TAU * CAMPO_BEARINGS) - 1;
      const b1 = inward ? Math.floor((hi + Math.PI) / TAU * CAMPO_BEARINGS) - 1
        : Math.ceil((hi + Math.PI) / TAU * CAMPO_BEARINGS) + 1;
      if (b1 - b0 >= CAMPO_BEARINGS) { out.fill(Math.max(out[0], slope)); continue; }
      for (let b = b0; b <= b1; b += 1) {
        const k = ((b % CAMPO_BEARINGS) + CAMPO_BEARINGS) % CAMPO_BEARINGS;
        if (slope > out[k]) out[k] = slope;
      }
    }
  }
  return out;
}

// (a) the arc collapsed to the cell's centre bearing
cases.push({
  what: "l'arco ridotto alla direzione del CENTRO della cella",
  caught: worstBreach(bent({ centreOnly: true }), eye, eye).worst > 0,
});
// (b) no room for the walker's step: the ring is exact standing still and a
//     hole opens the moment they move
// ---------------------------------------------------------------------------
// TWO OF THE DEFECTS CANNOT BE SHOWN ON THIS WORLD, AND THAT IS ITSELF A
// FINDING RATHER THAN A GAP.
//
// The padding for the walker's step and the wrap of the arc at the back of the
// eye are both properties of the CONSTRUCTION, and on this particular plateau
// neither is load-bearing: the ridge stands sixty to a hundred metres out, so a
// step of thirty centimetres moves its bearing by a fifth of a degree and its
// slope by half a percent, and the conservatism the coarse cell already carries
// -- a MAXIMUM over 6.4 m, measured from its NEAREST corner -- swallows both.
// Take the padding out today and the picture does not break.
//
// It breaks on the world where it matters, which is a mound beside the walker
// -- and V5 is going to put ground closer to the eye than this plateau does. So
// the two are injected on GROUND MADE FOR THEM: one cell of the same size the
// real ones are, at the distance the real defect needs, and the guard is asked
// whether it says no. What is being tested is the guard's own predicate, which
// is the only thing a self test can honestly test.
// ---------------------------------------------------------------------------

/**
 * One coarse cell, wherever it is wanted, and the samples that fill it --
 * INCLUDING the point of it nearest the eye.
 *
 * That last point is the whole reason this helper exists rather than reusing
 * the law's grid. The ring measures a cell from its nearest corner and takes
 * the tallest ground anywhere in it, so a sample drawn from the middle of the
 * cell is always further away and always lower than what the ring allows: it
 * carries a slack of its own that would swallow the very defect being injected.
 * The nearest point is where the ring is TIGHT, and it is the only place a
 * missing margin can be seen.
 */
function loneCell(cx, cz, height, eyeAt) {
  const x0 = Math.floor(cx / cell) * cell;
  const z0 = Math.floor(cz / cell) * cell;
  const patch = { x0, z0, cell, n: 1, top: Uint8Array.from([campoGroundByte(height)]) };
  const y = (height + 1) * VOXEL + CAMPO_BLADE_CEIL;
  const pts = [[
    Math.min(Math.max(eyeAt.x, x0), x0 + cell),
    Math.min(Math.max(eyeAt.z, z0), z0 + cell), y,
  ]];
  for (let b = 0; b < 4; b += 1) {
    for (let a = 0; a < 4; a += 1) {
      pts.push([x0 + (a + 0.5) / 4 * cell, z0 + (b + 0.5) / 4 * cell, y]);
    }
  }
  return { patch, pts };
}

// (b) THE PADDING. A mound two metres from the eye and a metre over it: with the
//     eye held as a POINT the ring is exact, and the walker's next step opens a
//     hole in it.
const near = loneCell(eye.x + 8, eye.z, Math.round((eye.y + 5) / VOXEL) - 1, eye);
const noPad = campoHorizon(new Float32Array(CAMPO_BEARINGS), [near.patch], eye, 0, Infinity);
const padded = campoHorizon(new Float32Array(CAMPO_BEARINGS), [near.patch], eye);
cases.push({
  what: "nessun margine per il passo del camminatore (reach = 0), e l'occhio si muove",
  caught: STEPS.some(([dx, dy, dz]) => (dx || dy || dz)
    && worstBreach(noPad, eye, { x: eye.x + dx, y: eye.y + dy, z: eye.z + dz },
      null, near.pts).worst > 0)
    // and the padded ring, on the same ground and the same steps, does not.
    && STEPS.every(([dx, dy, dz]) => worstBreach(padded, eye,
      { x: eye.x + dx, y: eye.y + dy, z: eye.z + dz }, null, near.pts).worst <= 0),
});
// (c) the bearing read with the axes swapped -- the ring is right and the
//     fragment looks it up in the wrong place
cases.push({
  what: 'il frammento cerca il bidone con gli assi scambiati',
  caught: worstBreach(good, eye, eye, (dx, dz) => campoBearingOf(dx, dz) === 0
    ? 0 : campoBearingOf(dz, dx)).worst > 0,
});
// (d) the arc truncated INWARD instead of outward -- the quantisation written
//     the natural way round, which throws away the two bearings at its ends.
//     (An off-by-one of a single bearing is NOT injected here, and that is a
//     statement and not an omission: the ring is deliberately widened by one
//     bearing at each end, so it survives one, and a guard that demanded it
//     fail would be demanding the padding be taken out.)
cases.push({
  what: "l'arco troncato all'INDENTRO invece che all'infuori",
  caught: worstBreach(bent({ inward: true }), eye, eye).worst > 0,
});
// (e) a ring allowed above the single bound is a regression the other legs
//     would not see
const loose = Float32Array.from(good, (v) => v + 0.05);
cases.push({
  what: 'un bidone lasciato sopra il bound unico',
  caught: Array.from(loose).some((v) => v > bound + 1e-6),
});
// (f) the bias taken off twice -- every ground ten metres under the eye, the
//     ring collapses to nought, and every ray in the frame is thrown away
const twice = campoHorizon(new Float32Array(CAMPO_BEARINGS),
  [{ x0: X0, z0: Z0, cell, n: N, top: Uint8Array.from(coarse,
    (v) => (v ? Math.max(1, v - CAMPO_BIAS) : 0)) }], eye, CAMPO_HORIZON_REACH, bound);
cases.push({
  what: 'il bias della quota tolto due volte',
  caught: worstBreach(twice, eye, eye).worst > 0,
});
// (g) THE WRAP. A cell due west of the eye straddles the cut of atan2, so the
//     smallest and the largest of its four corner angles are on OPPOSITE sides
//     of it: taken as a range they describe the whole rest of the circle, and
//     the ring gets the height written everywhere EXCEPT where the cell is.
const west = loneCell(eye.x - 40, eye.z, Math.round((eye.y + 6) / VOXEL) - 1, eye);
function ringOf(patch, longWay) {
  const out = new Float32Array(CAMPO_BEARINGS).fill(0);
  const TAU = Math.PI * 2;
  const y = (patch.top[0] - CAMPO_BIAS) * VOXEL + CAMPO_BLADE_CEIL;
  const dx = Math.max(patch.x0 - eye.x, 0, eye.x - (patch.x0 + cell));
  const dz = Math.max(patch.z0 - eye.z, 0, eye.z - (patch.z0 + cell));
  const raw = Math.hypot(dx, dz);
  const slope = (y - (eye.y - CAMPO_HORIZON_REACH))
    / Math.max(1, raw - CAMPO_HORIZON_REACH) + CAMPO_HORIZON_MARGIN;
  const angles = [
    Math.atan2(patch.z0 - eye.z, patch.x0 - eye.x),
    Math.atan2(patch.z0 - eye.z, patch.x0 + cell - eye.x),
    Math.atan2(patch.z0 + cell - eye.z, patch.x0 - eye.x),
    Math.atan2(patch.z0 + cell - eye.z, patch.x0 + cell - eye.x),
  ].sort((p, q) => p - q);
  let gap = -1; let at = 0;
  for (let k = 0; k < 4; k += 1) {
    const g = (angles[(k + 1) & 3] - angles[k] + TAU) % TAU;
    if (g > gap) { gap = g; at = (k + 1) & 3; }
  }
  const pad = Math.atan2(CAMPO_HORIZON_REACH, raw);
  const lo = longWay ? angles[0] - pad : angles[at] - pad;
  const hi = longWay ? angles[3] + pad : angles[at] + (TAU - gap) + pad;
  const b0 = Math.floor((lo + Math.PI) / TAU * CAMPO_BEARINGS) - 1;
  const b1 = Math.ceil((hi + Math.PI) / TAU * CAMPO_BEARINGS) + 1;
  for (let b = b0; b <= b1; b += 1) {
    const k = ((b % CAMPO_BEARINGS) + CAMPO_BEARINGS) % CAMPO_BEARINGS;
    if (slope > out[k]) out[k] = slope;
  }
  return out;
}
cases.push({
  what: "l'arco preso fra il minimo e il massimo dei quattro angoli (il giro lungo)",
  caught: worstBreach(ringOf(west.patch, true), eye, eye, null, west.pts).worst > 0
    && worstBreach(ringOf(west.patch, false), eye, eye, null, west.pts).worst <= 0,
});

// (h) the swing of the walker's step measured against the CLAMPED distance
//     instead of the raw one -- which for the cells a metre away opens the arc
//     to a third of a turn each and turns the ring into a fill
const wide = new Float32Array(CAMPO_BEARINGS);
campoHorizon(wide, patches, eye, 3.0, bound);
const wideCost = campoHorizonCost();
campoHorizon(wide, patches, eye, CAMPO_HORIZON_REACH, bound);
const trueCost = campoHorizonCost();
cases.push({
  what: "il margine del passo allargato, e la ricevuta dell'anello lo dice",
  caught: wideCost.writes / Math.max(1, wideCost.above)
    > trueCost.writes / Math.max(1, trueCost.above) * 1.3,
});

selfTest('guard-orizzonte', cases);
