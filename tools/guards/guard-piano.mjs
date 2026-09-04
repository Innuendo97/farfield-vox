import { createHash } from 'node:crypto';
import {
  BASE_STEP, CENTRE, CHUNK, DISC_RADIUS, FRAMED, MATERIAL, MOUND, NO_COLUMN, SOD, VOXEL,
  cellMaterialAt,
  chunkColumns, clearColumn, columnCount, columnSpec, columnTop, createColumns, depthAt,
  framedTally, matAt, meadowMoundAt, moundAt, moundCutAt, onPaving, paintTop, PATH, pathDrop,
  raise, setTop, storeBytes, topAt, underAt,
} from '../../src/world/voxel/pure.js';
// AND THE CONTRACT, because from step 6 the walker's floor is not the law any
// more: it is the store, read through a cache of tiles that only this file's
// last leg can prove answers the same thing the frame is cut from.
import { builtHeightAt, groundHeightAt, setGroundDiscRadius } from '../../src/world/contracts.js';
import { PLATFORM, STAIRS } from '../../src/world/layout.js';
import { TIERS } from '../../src/core/quality.js';
import { TUNING } from '../../src/core/presence.js';
import { reporter, selfTest } from './lib.mjs';

// The largest disc any tier lays -- for the reason written in guard-fusione.
// Nothing is injected: the corridor is columns of this disc now, so both arms
// below read the same world the page draws without being told anything.
const SHIPPED_RADIUS = Math.max(...TIERS.map((t) => t.voxelDiscRadius));

// AND THE RADIUS THE SHAPE OF A MASS IS READ AT, WHICH IS NOT THE SAME NUMBER.
//
// Everything this file gates about the FLOOR -- the plane, the runs, the risers,
// the step against the body's ceiling, the store against the walker -- is asked
// of the disc that ships, because that is the ground that exists. But the three
// readings under 3b are not about the ground that exists: «taglia 1,5-3,5 m,
// spaziatura 3-6 m, alte 2-4 voxel» is a reading of what a meadow of these
// masses TYPICALLY looks like, and that is a property of the LAW -- the lattice,
// the seats, MOUND's own dials -- and not of where the disc happens to be cut.
//
// AT FOURTEEN METRES THE SAMPLE IS EIGHT MASSES, and it is eight for a reason
// that has nothing to do with the meadow: a mass the rim cuts in half is dropped
// rather than measured (see massCensus), and at fourteen metres more than half
// of them touch the rim, the corridor or a stone. Eight objects is a p50 that
// moves a whole voxel if one of them is laid differently, and E-FOND-PIANO8
// carried «the census measures 8 whole masses» to this step as a residue for
// exactly that reason.
//
// So the shape is read over the disc the GENERATOR defines -- DISC_RADIUS, the
// engine's own default -- where the same law lays the same masses over six times
// the area. Nothing about the world changes: this is a wider window on one law,
// and the window is declared here rather than left as a number in a call.
const CENSUS_RADIUS = DISC_RADIUS;

// THE GROUND IS A PLANE WITH THINGS PUT ON IT, AND THIS IS WHAT SAYS SO.
//
// It replaces the guard that froze the tuft's two dials, and it asks a bigger
// question than that one could. The tuft was a term in a continuous field, so
// the only thing a guard could assert about the FLOOR was that the term had not
// been retuned. The floor is a block store now -- a literal height written into
// an array -- so the floor itself is assertable, and these are the four things
// the rebuilding actually claims:
//
//   1. WITH THE GRAIN OFF THE WORLD IS FLAT. Every column that is not on a mass
//      stands at exactly BASE_STEP. Not "nearly", not "within a voxel": the
//      same integer, everywhere, and any column that is not is named. This is
//      the assertion U-FOND-1 could only make about a field's own arithmetic
//      and that the store makes about the world.
//   2. THE GRAIN IS THE REFERENCE'S GRAIN. Level runs of five to twelve cubes
//      (A §1.2, E-V1j), which is the reading the committente chose at
//      E-DECISIONI7 A1 = B, measured over the disc that ships.
//   3. NOTHING ON THE OPEN MEADOW STEPS BY MORE THAN ONE VOXEL. The masses are
//      allowed their bank and nothing else is: this is the walker's number as
//      much as the eye's, and it is the property the halo round a mass exists
//      to keep.
//   4. THE LAW AND THE STORE ARE ONE ANSWER. The generator states a column two
//      ways -- as a function for the fifteen readers who still ask for a point,
//      and as four arrays for the mesher -- and the day they part company the
//      picture and the walker's floor part company with them.
//
// AND THE WRITE SIDE IS EXERCISED AND NOT ONLY DESCRIBED. Steps 4 to 7 of the
// rebuilding are edits on this store: the corridor written as columns, the
// masses moved out of the law, the contract pointed at the tops. A store whose
// edit side has never been run is a foundation nobody has stood on, so the last
// leg puts a column down, raises it, repaints it and takes it away, and reads
// back what each of those should have done.
//
// The comparison is on DATA and never on a picture (E-V5j): the fingerprint
// below is of the store's own four arrays.

/** The band the reference's level runs are read at: A §1.2, E-V1j, E-DECISIONI7 A1. */
const RUN_BAND = { low: 5, high: 12 };

// What a level run measures today, printed so a drift is seen the same
// afternoon rather than on the day it leaves the band.
const AT_TODAY = { p50: 5, p90: 12 };

/** The tallest step the open meadow is allowed, in voxels. A mass is not the meadow. */
const OPEN_STEP = 1;

// WHERE A STEP TALLER THAN ONE IS ALLOWED TO COME FROM, and it is one place.
// The reference's meadow steps by one voxel and its masses drop two or three in
// a single riser (A §1.2); nothing else in this world may. So the guard asks
// two things of every pair that steps by more than one: that both ends are on a
// mass, and that the step is no taller than the tallest bank a mass may cut.
// Between them they say «the masses wrote this, and they wrote it to size».
//
// AND THE SIZE IS THE REFERENCE'S AND NOT THE DIAL'S. Reading MOUND.scarp here
// would make this leg agree with whatever the dial was set to, which is not an
// assertion about anything. Three is what A §1.2 reads -- «un gradino di 2-3
// voxel in una volta» -- and it is also exactly TUNING.ground.maxM at this
// voxel size, so the picture and the body ask for the same ceiling.
const MASS_STEP = 3;

// AND THE BODY'S OWN CEILING, RE-DECLARED, BECAUSE IT IS NOT EXPORTED AND IT IS
// THE ONE NUMBER THIS FILE CANNOT REACH.
//
// src/core/player.js:52 refuses a step down when the drop is STRICTLY greater
// than 0.30 m and steeper than any slope could be. src/core/presence.js's
// TUNING.ground.maxM is 0.30 too and this file already gates against it -- but
// it gates the step in VOXELS times VOXEL, and the body compares METRES it read
// out of the contract. Those two are not the same number in doubles: a bank of
// three voxels reaches the walker as (2 + 1) * 0.10 = 0.30000000000000004, and
// 0.30 is 0.29999999999999999. So the world's tallest bank is over the body's
// ceiling by one unit in the last place, and the step DOWN off it is refused.
//
// AND IT IS GATED NOW, BECAUSE THE COMPARISON GREW A TOLERANCE AND THE THING IT
// COUNTED WENT TO NOUGHT. It stood here as a note with a count -- 214 pairs of
// columns the body would not step down off -- because the two levers, the dial
// of the bank and the body's ceiling, belonged to two other sessions and a
// guard that goes red on a number nobody may move is a guard that gets switched
// off. E-FOND-PIANO9 moved the third thing instead: the comparison itself takes
// a tenth of a millimetre of slack (LEDGE_EPS in src/core/player.js), which is
// four orders larger than the error of a double and smaller than anything a
// body could feel. So a step the world was built to allow is allowed, and a
// step that is genuinely over the ceiling is a defect this file may now fail on.
const BODY_MAX_DOWN = 0.30;
/** src/core/player.js:LEDGE_EPS, re-declared: it is not exported either. */
const BODY_EPS = 1e-4;

// THE REFERENCE'S OWN READING OF THE MASSES, in the units it was read in.
// A §1.2 and E-V1h: two to four voxels tall, one and a half to three and a half
// metres across, three to six metres apart, never two touching. The spacing is
// read as a TYPICAL distance -- «mai due attaccati» is a property this
// generator holds by construction, and the tails belong to the hub's own
// furniture rather than to the lattice.
const MASS = { tall: { low: 2, high: 4 }, wide: { low: 1.5, high: 3.5 }, gap: { low: 3.0, high: 6.0 } };

// HOW FAR A MASS MAY STAND FROM THE PLACE THE REFERENCE PUTS IT, in voxels.
//
// TWO, AND IT IS THE READING'S OWN REPEATABILITY AND NOT A TOLERANCE CHOSEN TO
// PASS. FRAMED in src/world/voxel/worldgen.js carries where the reference's own
// masses stand, measured through the fitted camera; swept over the estimator's
// four dials the same three seats come back within 0.2 m of each other, and 0.2
// m is two voxels. So a world that puts one of them further than that from its
// seat is further out than the picture is uncertain, which is the only thing
// that can honestly be gated here.
//
// AND IT IS THE FOOT OF THE CUT THAT IS COMPARED, at the seat's own column of x
// and nowhere else. A mass is measured off a picture by the one part of it a
// picture shows without ambiguity -- where its flank meets the floor -- and two
// seats that merge into one object have not moved any ground, so a comparison
// against a centroid would fail on a merge instead of on a displacement.
const SEAT_VOXELS = 2;

// HOW FAR EITHER SIDE OF THE EYE THE BAND THE STEP EXISTS FOR RUNS, in metres.
// U-FOND-4's residual 1: at six to nine metres the reference carries two masses
// and the lattice carried none, and that stretch is the part of the frame the
// committente's own eye lands on first.
const BAND = { near: 6, far: 9, masses: 2 };
/** Where the fitted camera stands, from the pose the whole campaign is judged on. */
const EYE = { x: 0.599, z: 14.215 };

const NO = -1e7;

/** Whether a point stands on one of the masses set down on the plane. */
function onMass(x, z) {
  return meadowMoundAt(x, z) > 0 || moundAt(x, z) > 0;
}

// AND THE CORRIDOR IS THE THIRD THING ON THE PLANE, admitted here rather than
// tolerated. It is not a mass -- it does not stand ON the floor, it is cut one
// voxel INTO it -- and it is not the meadow either: it has no grain, its runs
// are the length of the corridor and the riser at its edge is the one to two
// voxels the reference is measured at. Left in the meadow's census it would
// have moved every number this guard prints without a dial having moved, which
// is exactly the confusion a guard exists to prevent. So it is a seat of its
// own with a leg of its own, and the meadow's arms step over it.

/**
 * Walks the disc and gathers everything the four claims are read off.
 *
 * One sweep for both, because the columns cost the same to build either way and
 * two sweeps would be two chances for the arms to be laid at different radii.
 */
export function survey(radius) {
  const i0 = Math.round((CENTRE.x - radius) / VOXEL);
  const i1 = Math.round((CENTRE.x + radius) / VOXEL);
  const j0 = Math.round((CENTRE.z - radius) / VOXEL);
  const j1 = Math.round((CENTRE.z + radius) / VOXEL);

  const flat = {
    columns: 0, offPlane: 0, offPlaneOffMass: 0, worst: null,
    paving: 0, pavingOff: 0, pavingWorst: null,
  };
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const h = columnTop(i, j, false, radius);
      if (h < NO) continue;
      flat.columns++;
      const x = (i + 0.5) * VOXEL;
      const z = (j + 0.5) * VOXEL;
      if (onPaving(x, z)) {
        flat.paving++;
        // A NORTHING AND NOT A CONSTANT: over the apron at the foot of the run
        // the paving stands at the meadow's own floor, so its top face meets the
        // lowest riser instead of a voxel under it. PATH.lift in worldgen.js.
        if (h !== BASE_STEP - pathDrop(z)) {
          flat.pavingOff++;
          if (!flat.pavingWorst) flat.pavingWorst = { i, j, h };
        }
        continue;
      }
      if (h === BASE_STEP) continue;
      flat.offPlane++;
      if (!onMass(x, z)) {
        flat.offPlaneOffMass++;
        if (!flat.worst) flat.worst = { i, j, h };
      }
    }
  }

  const runs = [];
  let pairs = 0;
  let openOver = 0;
  let worstStep = 0;
  let overMass = 0;
  let worstAt = null;
  let bodyOver = 0;
  let bodyWorst = 0;
  let bodyAt = null;
  const risers = new Map();
  const sweep = (alongX) => {
    const a0 = alongX ? j0 : i0;
    const a1 = alongX ? j1 : i1;
    const b0 = alongX ? i0 : j0;
    const b1 = alongX ? i1 : j1;
    for (let a = a0; a <= a1; a++) {
      let run = 0;
      let prev = null;
      let prevAt = null;
      for (let b = b0; b <= b1; b++) {
        const i = alongX ? b : a;
        const j = alongX ? a : b;
        const h = columnTop(i, j, true, radius);
        const x = (i + 0.5) * VOXEL;
        const z = (j + 0.5) * VOXEL;
        // A missing column breaks a run, and so does the corridor: this census
        // is of the MEADOW'S grain, and the paving has none.
        if (h < NO || onPaving(x, z)) {
          if (run > 0) runs.push(run);
          run = 0; prev = null; prevAt = null;
          continue;
        }
        if (prev === null) { run = 1; prev = h; prevAt = { x, z }; continue; }
        pairs++;
        const step = Math.abs(h - prev);
        if (step === 0) run++;
        else {
          runs.push(run);
          run = 1;
          risers.set(Math.min(step, 3), (risers.get(Math.min(step, 3)) || 0) + 1);
          // The open meadow is both ends of the pair off any mass: a bank is
          // allowed its riser, and the column beside a bank is on the mass too.
          if (step > OPEN_STEP && !onMass(x, z) && !onMass(prevAt.x, prevAt.z)) openOver++;
          if (step > worstStep) { worstStep = step; worstAt = { x, z }; }
          if (step > MASS_STEP) overMass++;
          // The drop as the BODY reads it: two faces out of the contract's own
          // arithmetic, subtracted, and compared the way player.js compares it.
          const down = Math.abs((h + 1) * VOXEL - (prev + 1) * VOXEL);
          if (down > BODY_MAX_DOWN + BODY_EPS) {
            bodyOver++;
            if (down > bodyWorst) { bodyWorst = down; bodyAt = { x, z }; }
          }
        }
        prev = h; prevAt = { x, z };
      }
      if (run > 0) runs.push(run);
    }
  };
  sweep(true);
  sweep(false);
  runs.sort((p, q) => p - q);
  const at = (t) => runs[Math.floor(t * (runs.length - 1))];
  const nRisers = [...risers.values()].reduce((s, n) => s + n, 0) || 1;
  return {
    flat,
    pairs,
    openOver,
    worstStep,
    worstAt,
    overMass,
    bodyOver,
    bodyWorst,
    bodyAt,
    runs: runs.length,
    p10: at(0.10),
    p50: at(0.50),
    p90: at(0.90),
    max: at(1),
    inBand: runs.filter((r) => r >= RUN_BAND.low && r <= RUN_BAND.high).length / runs.length,
    riser: {
      one: (risers.get(1) || 0) / nRisers,
      two: (risers.get(2) || 0) / nRisers,
      three: (risers.get(3) || 0) / nRisers,
      share: nRisers / pairs,
    },
  };
}

/**
 * The masses of the meadow, gathered from the law as OBJECTS.
 *
 * A mass is a connected piece of columns the mound term raises. The four things
 * asked of it are the four the reference is read for: how tall, how wide, how
 * far from its nearest neighbour, and whether the earth it shows is its own
 * bank's height. Nothing here is a picture and nothing is a share of columns.
 */
export function massCensus(radius, only = null) {
  const i0 = Math.round((CENTRE.x - radius) / VOXEL);
  const i1 = Math.round((CENTRE.x + radius) / VOXEL);
  const j0 = Math.round((CENTRE.z - radius) / VOXEL);
  const j1 = Math.round((CENTRE.z + radius) / VOXEL);
  const on = new Map();
  let meadow = 0;
  let cutOverScarp = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const h = columnTop(i, j, true, radius);
      if (h < NO) continue;
      const x = (i + 0.5) * VOXEL;
      const z = (j + 0.5) * VOXEL;
      if (onPaving(x, z)) continue;
      meadow++;
      const m = meadowMoundAt(x, z);
      if (!m) continue;
      // A MASS THE PIECE CUTS IN HALF IS NOT A MASS, and it is dropped rather
      // than measured -- the same rule the run estimator keeps for a run that
      // touches an edge. At the rim of the disc, and where the corridor or a
      // stone's band runs through, a mass shows only the part of itself that
      // survived, and a census that kept those would report masses one voxel
      // tall and eighty centimetres wide that nobody ever built.
      const edge = columnTop(i + 1, j, true, radius) < NO || columnTop(i - 1, j, true, radius) < NO
        || columnTop(i, j + 1, true, radius) < NO || columnTop(i, j - 1, true, radius) < NO
        || onPaving((i + 1.5) * VOXEL, z) || onPaving((i - 0.5) * VOXEL, z)
        || onPaving(x, (j + 1.5) * VOXEL) || onPaving(x, (j - 0.5) * VOXEL);
      on.set(`${i},${j}`, { i, j, x, z, m, edge });
      if (moundCutAt(x, z) > MOUND.scarp.high) cutOverScarp++;
    }
  }
  const seenCell = new Set();
  const masses = [];
  let pieces = 0;
  for (const [k0, c0] of on) {
    if (seenCell.has(k0)) continue;
    const stack = [c0];
    seenCell.add(k0);
    const part = [];
    while (stack.length) {
      const p = stack.pop();
      part.push(p);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${p.i + di},${p.j + dj}`;
        const q = on.get(k);
        if (!q || seenCell.has(k)) continue;
        seenCell.add(k);
        stack.push(q);
      }
    }
    const xs = part.map((p) => p.x);
    const zs = part.map((p) => p.z);
    // A FILTER ON THE PIECE AND NOT ON ITS COLUMNS, so a mass that straddles the
    // edge of a band is counted once, where its own middle is, and never twice.
    if (only && !only({
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      z: (Math.min(...zs) + Math.max(...zs)) / 2,
    })) continue;
    pieces++;
    if (part.some((p) => p.edge)) continue;
    masses.push({
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      z: (Math.min(...zs) + Math.max(...zs)) / 2,
      w: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + VOXEL,
      h: Math.max(...part.map((p) => p.m)),
    });
  }
  if (!masses.length) {
    return { n: 0, pieces, perM2: 0, tallLow: 0, tallHigh: 0,
      w10: 0, w50: 0, w90: 0, g10: 0, g50: 0, g90: 0, cutOverScarp };
  }
  const gaps = masses.map((m) => Math.min(...masses.filter((o) => o !== m)
    .map((o) => Math.hypot(m.x - o.x, m.z - o.z)))).filter(Number.isFinite).sort((a, b) => a - b);
  const ws = masses.map((m) => m.w).sort((a, b) => a - b);
  const q = (list, t) => (list.length ? list[Math.min(list.length - 1, Math.floor(t * list.length))] : 0);
  return {
    n: masses.length,
    pieces,
    perM2: meadow * VOXEL * VOXEL / (pieces || 1),
    tallLow: Math.min(...masses.map((m) => m.h)),
    tallHigh: Math.max(...masses.map((m) => m.h)),
    w10: q(ws, 0.1), w50: q(ws, 0.5), w90: q(ws, 0.9),
    g10: q(gaps, 0.1), g50: q(gaps, 0.5), g90: q(gaps, 0.9),
    cutOverScarp,
  };
}

/**
 * The drop from the lowest tread of the run to the ground just south of it.
 *
 * ROW BY ROW ACROSS THE WHOLE WIDTH OF THE RUN, and against the floor the hub
 * itself hands the walker -- max(the meadow, the worked stone) -- because that
 * is the number the body compares. The two columns are the one under the tread
 * and the one beyond the riser, half a voxel either side of the foot, so what
 * is measured is the step a foot really takes and not a slope read over a metre.
 */
export function stairFoot() {
  const footZ = STAIRS.z + STAIRS.tread * STAIRS.steps;
  const floorAt = (x, z) => Math.max(groundHeightAt(x, z), builtHeightAt(x, z));
  let rows = 0;
  let worst = 0;
  let over = 0;
  for (let i = Math.round((STAIRS.x - STAIRS.width / 2) / VOXEL);
    i <= Math.round((STAIRS.x + STAIRS.width / 2) / VOXEL); i++) {
    const x = (i + 0.5) * VOXEL;
    const drop = floorAt(x, footZ - VOXEL / 2) - floorAt(x, footZ + VOXEL / 2);
    rows++;
    if (drop > worst) worst = drop;
    if (drop > BODY_MAX_DOWN + BODY_EPS) over++;
  }
  return { rows, worst, over };
}

/**
 * Where the built meadow puts its flank under one column of x, and how tall.
 *
 * Searched over a window round the seat's own foot, so a mass that is not there
 * reads as absent instead of as the next mass up the field.
 */
function footAt(x, zRef, radius, window = 1.5) {
  const i = Math.round(x / VOXEL - 0.5);
  for (let j = Math.round((zRef + window) / VOXEL); j >= Math.round((zRef - window) / VOXEL); j--) {
    const z = (j + 0.5) * VOXEL;
    const cx = (i + 0.5) * VOXEL;
    if (onPaving(cx, z) || columnTop(i, j, true, radius) < NO) continue;
    const m = meadowMoundAt(cx, z);
    if (m > 0) return { z, h: m };
  }
  return null;
}

/**
 * The reference's own seats against the masses the world builds on them.
 *
 * THIS IS THE LEG STEP 6 EXISTS FOR. Everything else in this file asserts that
 * the meadow has the SHAPE the reference reads -- how tall, how wide, how far
 * apart. None of it could say that a mass stands WHERE the picture has one,
 * because until this step nothing in the world claimed to.
 */
export function seatCensus(radius) {
  const rows = [];
  for (const f of FRAMED) {
    const foot = footAt(f.x, f.zFoot, radius);
    rows.push({
      f,
      foot,
      off: foot ? Math.abs(foot.z - f.zFoot) / VOXEL : Infinity,
    });
  }
  // And the band the step exists for, counted as objects the way the census
  // above counts them.
  const inBand = massCensus(radius, (m) => {
    const d = Math.hypot(m.x - EYE.x, m.z - EYE.z);
    return d >= BAND.near && d <= BAND.far;
  });
  return { rows, band: inBand.pieces, worst: Math.max(...rows.map((r) => r.off)) };
}

/** Whether the law and the store answer the same for every column of a chunk. */
export function lawAgreesWithStore(cx, cz, grain, radius) {
  const store = chunkColumns(cx, cz, CHUNK, grain, radius);
  let checked = 0;
  for (let j = -1; j <= CHUNK; j++) {
    for (let i = -1; i <= CHUNK; i++) {
      const ix = cx * CHUNK + i;
      const iz = cz * CHUNK + j;
      const spec = columnSpec(ix, iz, grain, radius);
      if (topAt(store, ix, iz) !== spec.top) return { agree: false, ix, iz, checked };
      if (matAt(store, ix, iz) !== spec.mat) return { agree: false, ix, iz, checked };
      if (spec.top !== NO_COLUMN) {
        if (underAt(store, ix, iz) !== spec.under) return { agree: false, ix, iz, checked };
        if (depthAt(store, ix, iz) !== spec.depth) return { agree: false, ix, iz, checked };
      }
      checked++;
    }
  }
  return { agree: true, checked };
}

/** The store's write side, run on a store of its own and read back. */
export function editsHold() {
  const store = createColumns(0, 0, 4, 4);
  const said = [];
  said.push(['an empty store has no columns', columnCount(store) === 0]);
  said.push(['and an absent column reads as absent', topAt(store, 1, 1) === NO_COLUMN]);

  setTop(store, 1, 1, -1, MATERIAL.GRASS);
  said.push(['a column laid down stands where it was put',
    topAt(store, 1, 1) === -1 && matAt(store, 1, 1) === MATERIAL.GRASS]);
  said.push(['and it is the only one', columnCount(store) === 1]);

  raise(store, 1, 1, 2, MATERIAL.EARTH);
  said.push(['a raise moves the top and cuts the flank',
    topAt(store, 1, 1) === 1 && underAt(store, 1, 1) === MATERIAL.EARTH
      && depthAt(store, 1, 1) === 2]);
  said.push(['the stratification reads back: the top is its own material',
    cellMaterialAt(store, 1, 1, 1) === MATERIAL.GRASS]);
  said.push(['the two voxels under it are what it is cut into',
    cellMaterialAt(store, 1, 1, 0) === MATERIAL.EARTH
      && cellMaterialAt(store, 1, 1, -1) === MATERIAL.EARTH]);
  said.push(['below that it is the earth every column stands on',
    cellMaterialAt(store, 1, 1, -2) === MATERIAL.EARTH]);
  said.push(['and above it there is air', cellMaterialAt(store, 1, 1, 2) === MATERIAL.AIR]);

  paintTop(store, 1, 1, MATERIAL.PATH);
  said.push(['a repaint changes the material and not the height',
    matAt(store, 1, 1) === MATERIAL.PATH && topAt(store, 1, 1) === 1]);

  raise(store, 2, 2, 3, MATERIAL.EARTH);
  said.push(['a raise on a column that is not there does nothing',
    topAt(store, 2, 2) === NO_COLUMN]);

  clearColumn(store, 1, 1, MATERIAL.PATH);
  said.push(['a cleared column is gone and says why',
    topAt(store, 1, 1) === NO_COLUMN && matAt(store, 1, 1) === MATERIAL.PATH]);
  said.push(['and the count knows it', columnCount(store) === 0]);

  setTop(store, 9, 9, 4, MATERIAL.GRASS);
  said.push(['a write outside the rectangle is refused rather than wrapped',
    columnCount(store) === 0]);
  return said;
}

/**
 * Whether the walker's floor is the top of the store, on every column of a disc.
 *
 * THE LEG A-3 ASKED FOR, IN BOTH DIRECTIONS. The contract used to read the LAW
 * -- columnSpec, evaluated per point -- and the leg above proved the law and the
 * store agree, which made the two the same answer by transitivity. From step 6
 * the contract reads the store through a cache of tiles of its own, so the
 * transitive proof is gone and this is what replaces it: every column, both
 * ways. Where a column stands, the contract answers its drawn face; where none
 * does, it answers the plane and NOT a column's face, so a cache that handed
 * back a stale tile would show up as a floor over a hole.
 */
export function contractReadsTheStore(radius, injected = 0) {
  setGroundDiscRadius(radius);
  const i0 = Math.round((CENTRE.x - radius) / VOXEL);
  const i1 = Math.round((CENTRE.x + radius) / VOXEL);
  const j0 = Math.round((CENTRE.z - radius) / VOXEL);
  const j1 = Math.round((CENTRE.z + radius) / VOXEL);
  let checked = 0;
  let onColumn = 0;
  let onPlane = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) * VOXEL;
      const z = (j + 0.5) * VOXEL;
      if (Math.hypot(x - CENTRE.x, z - CENTRE.z) > radius) continue;
      const top = columnTop(i, j, true, radius);
      // `injected` is the self test's own hand on the answer: nought in every
      // real run, one voxel when the file is asked to prove that it would catch
      // a floor that had drifted off the store by the smallest thing there is.
      const said = groundHeightAt(x, z) + injected;
      checked++;
      if (top > NO) {
        onColumn++;
        if (said !== (top + 1) * VOXEL) return { agree: false, i, j, said, top, checked };
      } else {
        onPlane++;
        if (said !== (BASE_STEP + 1) * VOXEL) return { agree: false, i, j, said, top, checked };
      }
    }
  }
  return { agree: true, checked, onColumn, onPlane };
}

/** A fingerprint of a chunk's four arrays: data, never a picture (E-V5j). */
export function fingerprint(cx, cz, grain, radius) {
  const store = chunkColumns(cx, cz, CHUNK, grain, radius);
  const hash = createHash('md5');
  for (const array of [store.top, store.mat, store.under, store.depth]) {
    hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest('hex').slice(0, 16);
}

if (process.argv.includes('--self')) {
  // The real disc and not a small one: the band is a property of the grain over
  // the ground that ships, and a disc of six metres is mostly rim.
  const seen = survey(SHIPPED_RADIUS);
  selfTest('guard-piano', [
    {
      what: 'a plane with a column a voxel out of it is caught',
      caught: (() => {
        const store = createColumns(0, 0, 4, 4);
        for (let k = 0; k < 16; k++) setTop(store, k % 4, Math.floor(k / 4), BASE_STEP, 1);
        raise(store, 2, 2, 1, MATERIAL.GRASS);
        let off = 0;
        for (let j = 0; j < 4; j++) {
          for (let i = 0; i < 4; i++) if (topAt(store, i, j) !== BASE_STEP) off++;
        }
        return off === 1;
      })(),
    },
    {
      what: 'the plane the store actually lays has nothing off it but the masses',
      caught: seen.flat.offPlaneOffMass === 0 && seen.flat.columns > 0,
    },
    {
      what: 'a run of three cubes -- the grain that shipped before -- is under the band',
      caught: 3 < RUN_BAND.low,
    },
    {
      what: 'a disc that is one run from rim to rim is over it',
      caught: 400 > RUN_BAND.high,
    },
    {
      what: 'the grain measured on the real disc lands inside the band',
      caught: seen.p50 >= RUN_BAND.low && seen.p50 <= RUN_BAND.high,
    },
    {
      what: 'a step of two voxels on the open meadow would be caught',
      caught: OPEN_STEP === 1 && seen.openOver === 0,
    },
    {
      what: 'a bank of three voxels read as a drop the body would refuse',
      caught: (2 + 1) * VOXEL <= BODY_MAX_DOWN + BODY_EPS,
    },
    {
      what: 'a slack so wide that a bank of four voxels would slip through it',
      caught: (3 + 1) * VOXEL > BODY_MAX_DOWN + BODY_EPS,
    },
    {
      what: 'a corridor laid a voxel under the lowest riser, so its foot is a ledge',
      caught: stairFoot().over === 0 && stairFoot().rows > 0,
    },
    {
      what: 'the shape of a mass read off eight objects instead of a hundred',
      caught: massCensus(CENSUS_RADIUS).n > 3 * massCensus(SHIPPED_RADIUS).n,
    },
    {
      what: 'the law and the store agree over a whole chunk, skirt included',
      caught: lawAgreesWithStore(0, 0, true, SHIPPED_RADIUS).agree,
    },
    {
      what: 'a store told to hand back a column it was never given says so',
      caught: topAt(createColumns(0, 0, 2, 2), 5, 5) === NO_COLUMN,
    },
    {
      what: "the contract's floor is the store's top on every column of the disc",
      caught: contractReadsTheStore(SHIPPED_RADIUS).agree,
    },
    {
      what: 'and a floor read one voxel over the store is caught on the first column',
      caught: !contractReadsTheStore(SHIPPED_RADIUS, VOXEL).agree,
    },
    {
      what: 'every seat the reference gives is laid, and none was refused',
      caught: framedTally.dropped === 0 && framedTally.laid === FRAMED.length,
    },
    {
      what: 'a seat moved half a metre off its reading would be over the tolerance',
      caught: 0.5 / VOXEL > SEAT_VOXELS,
    },
    {
      what: 'the masses in frame stand where the reference puts them',
      caught: seatCensus(SHIPPED_RADIUS).worst <= SEAT_VOXELS,
    },
    ...editsHold().map(([what, caught]) => ({ what: `the store: ${what}`, caught })),
  ]);
}

const report = reporter('guard-piano -- the ground is a plane, and what stands on it');

const seen = survey(SHIPPED_RADIUS);

// ------------------------------------------------------------------- 1
report.line(`  ${seen.flat.columns} columns on the disc that ships, at ${SHIPPED_RADIUS} m`);
report.check(seen.flat.offPlaneOffMass === 0,
  `with the grain off, every column that is not on a mass stands at BASE_STEP (${BASE_STEP})`,
  seen.flat.worst
    ? `column ${seen.flat.worst.i},${seen.flat.worst.j} stands at ${seen.flat.worst.h}`
    : `${seen.flat.offPlaneOffMass} columns are not`);
report.line(`  ${seen.flat.offPlane} of them stand over the plane, and all of them are masses`);
report.check(seen.flat.pavingOff === 0,
  `and every column of the corridor stands one voxel under it, at ${BASE_STEP - PATH.drop}`,
  seen.flat.pavingWorst
    ? `column ${seen.flat.pavingWorst.i},${seen.flat.pavingWorst.j} stands at `
      + `${seen.flat.pavingWorst.h}`
    : `${seen.flat.paving} of them, none out`);

// ------------------------------------------------------------------- 2
report.line('');
report.line(`  level runs   p10 ${seen.p10}   p50 ${seen.p50}   p90 ${seen.p90}   `
  + `max ${seen.max}   (${seen.runs} runs over ${seen.pairs} pairs)`);
report.line(`  ${(seen.inBand * 100).toFixed(1)}% of them are ${RUN_BAND.low} to `
  + `${RUN_BAND.high} cubes long`);
report.check(seen.p50 >= RUN_BAND.low && seen.p50 <= RUN_BAND.high,
  `half the level runs are ${RUN_BAND.low} to ${RUN_BAND.high} cubes, as the reference reads`,
  `p50 ${seen.p50} against ${RUN_BAND.low}-${RUN_BAND.high}`);
report.check(seen.p90 >= RUN_BAND.low && seen.p90 <= RUN_BAND.high,
  'and nine in ten are inside it too',
  `p90 ${seen.p90} against ${RUN_BAND.low}-${RUN_BAND.high}`);
report.line(`  risers: ${(seen.riser.share * 100).toFixed(2)}% of pairs step at all; of those, `
  + `${(seen.riser.one * 100).toFixed(1)}% by one voxel, `
  + `${(seen.riser.two * 100).toFixed(1)}% by two, ${(seen.riser.three * 100).toFixed(1)}% by three or more`);

// THE RISER CENSUS IS PRINTED AND NOT GATED, AND THE REASON IS ON THE RECORD.
// E-V1j read the day reference at 69.6 / 25.4 / 5.1 and E-V1k then found that
// the estimator behind it reads the reference's PAINTED grain as steps -- it
// puts the reference's own level runs at half a cube, which no reading of that
// picture supports. E-V1l withdrew the line as a number and kept it as a
// direction. So the run band above, which the eye reads and two units agreed
// on, is what this file gates; the census is printed beside it because it is
// the number a later estimator that beats its own null would gate on instead.
if (Math.abs(seen.p50 - AT_TODAY.p50) > 0 || Math.abs(seen.p90 - AT_TODAY.p90) > 0) {
  report.note(`the runs have moved from the p50 ${AT_TODAY.p50} / p90 ${AT_TODAY.p90} this `
    + `file says ships to p50 ${seen.p50} / p90 ${seen.p90}: a dial of the grain moved, or `
    + 'the ground under it did');
}

// ------------------------------------------------------------------- 3
report.line('');
report.check(seen.openOver === 0,
  `no pair of columns on the open meadow steps by more than ${OPEN_STEP} voxel`,
  `${seen.openOver} pairs do, off any mass`);
report.check(seen.overMass === 0,
  `and no pair anywhere steps by more than the ${MASS_STEP} voxels a mass may cut`,
  `${seen.overMass} pairs do`);
report.check(seen.worstStep * VOXEL <= TUNING.ground.maxM + 1e-9,
  `the worst step column against column is ${(seen.worstStep * VOXEL).toFixed(2)} m, `
  + `inside the ${TUNING.ground.maxM.toFixed(2)} m the body damps`,
  `${(seen.worstStep * VOXEL).toFixed(2)} m at (${seen.worstAt ? seen.worstAt.x.toFixed(1) : '-'}, `
  + `${seen.worstAt ? seen.worstAt.z.toFixed(1) : '-'})`);
report.check(MOUND.scarp.high <= MASS_STEP && MOUND.scarp.low >= 2,
  `and the dial itself is inside the ${2}-${MASS_STEP} voxels the reference reads`,
  `MOUND.scarp is ${MOUND.scarp.low}-${MOUND.scarp.high}`);
report.line(`  the masses keep their own bank: MOUND.scarp ${MOUND.scarp.low}-${MOUND.scarp.high} `
  + `voxels, one height to a mass, and the bank against the stone stands at ${MOUND.bank.high}`);
report.line(`  the tallest bank is (${MOUND.scarp.high - 1} + 1) * VOXEL = `
  + `${(MOUND.scarp.high * VOXEL).toPrecision(17)} m and the body's ceiling is `
  + `${BODY_MAX_DOWN.toPrecision(17)}: one unit in the last place apart, which is what `
  + `the ${BODY_EPS} m of slack in the comparison is for`);
report.check(seen.bodyOver === 0,
  'and the body refuses no step down anywhere on the disc, so a walker who climbs a mass '
  + 'comes off it on the cut side',
  `${seen.bodyOver} pairs refused, the worst ${seen.bodyWorst.toPrecision(17)} m`
  + `${seen.bodyAt ? ` at (${seen.bodyAt.x.toFixed(1)}, ${seen.bodyAt.z.toFixed(1)})` : ''}`);

// AND THE ONE PLACE THE DROP WAS NOT AN ARTEFACT OF A DOUBLE: the foot of the
// run. src/world/stairs.js draws the lowest riser from its tread down to nought
// and the corridor used to be laid a voxel under that, so the ground fell 0.3167
// m away from the stone exactly where a foot leaves it -- a third of a metre, on
// 23 of the 40 rows across the run. PATH.lift in src/world/voxel/worldgen.js
// stands the apron at the meadow's own floor, and what is left is the riser.
const foot = stairFoot();
report.line(`  at the foot of the run, over ${foot.rows} rows across its width: the lowest tread `
  + `stands ${(PLATFORM.height / STAIRS.steps).toFixed(4)} m and the ground south of it `
  + `${foot.worst.toFixed(4)} m below at worst`);
report.check(foot.over === 0,
  'and stepping off the bottom tread is a step and not a ledge, on every row of the run',
  `${foot.over} rows drop more than ${BODY_MAX_DOWN.toFixed(2)} m`);

// ------------------------------------------------------------------- 3b
//
// AND THE MASSES ARE COUNTED AS OBJECTS, because that is what the committente's
// own words call them (E-DECISIONI4: «composizioni, cumuli ben orchestrati»)
// and a share of columns cannot tell a meadow of masses from a meadow of noise.
// They are gathered from the law over the disc the generator defines -- see
// CENSUS_RADIUS above for why that and not the disc that ships -- and measured
// in the units the reference was read in.
const census = massCensus(CENSUS_RADIUS);
const shipped = massCensus(SHIPPED_RADIUS);
report.line('');
report.line(`  ${census.pieces} masses over the ${CENSUS_RADIUS} m the law lays, one to every `
  + `${census.perM2.toFixed(0)} m2 of meadow; ${census.n} of them stand whole and are the ones `
  + 'measured below');
report.line(`  on the ${SHIPPED_RADIUS} m disc that ships: ${shipped.pieces} masses, `
  + `${shipped.n} of them whole, one to every ${shipped.perM2.toFixed(0)} m2`);
report.check(census.tallLow >= MASS.tall.low && census.tallHigh <= MASS.tall.high,
  `every whole mass stands ${MASS.tall.low} to ${MASS.tall.high} voxels tall, as the reference reads`,
  `they run ${census.tallLow} to ${census.tallHigh}`);
// THE TYPICAL IS WHAT IS GATED AND THE TAILS ARE PRINTED, and that is not a
// softening. «Taglia 1,5-3,5 m, spaziatura 3-6 m» is a reading of what a meadow
// of these masses TYPICALLY looks like; the disc also carries a corridor, a
// stair, a platform and two stone bands, and a mass that happens to sit beside
// one of those has a neighbour further away than any lattice can help. Gating a
// tail here would gate the layout of the hub through the back door.
report.check(census.w50 >= MASS.wide.low && census.w50 <= MASS.wide.high,
  `and the typical one is ${MASS.wide.low} to ${MASS.wide.high} m across   `
  + `(p10 ${census.w10.toFixed(2)}  p50 ${census.w50.toFixed(2)}  p90 ${census.w90.toFixed(2)})`,
  `p50 ${census.w50.toFixed(2)} against ${MASS.wide.low}-${MASS.wide.high} m`);
report.check(census.g50 >= MASS.gap.low && census.g50 <= MASS.gap.high,
  `and stands ${MASS.gap.low} to ${MASS.gap.high} m from its nearest neighbour   `
  + `(p10 ${census.g10.toFixed(2)}  p50 ${census.g50.toFixed(2)}  p90 ${census.g90.toFixed(2)})`,
  `p50 ${census.g50.toFixed(2)} m against ${MASS.gap.low}-${MASS.gap.high}`);
report.check(census.cutOverScarp === 0,
  'and every cut bank is the riser its own mass carries and no other',
  `${census.cutOverScarp} columns are cut deeper than their mass is banked`);

// ------------------------------------------------------------------- 3c
//
// AND THE MASSES IN FRAME STAND WHERE THE REFERENCE STANDS THEM. Everything
// above is a shape; this is a composition, and it is the one thing a lattice
// could never be asked for.
const seats = seatCensus(SHIPPED_RADIUS);
report.line('');
report.line(`  the reference seats ${FRAMED.length} masses in frame `
  + `(worldgen.js FRAMED); of them ${framedTally.laid} are laid, `
  + `${framedTally.pushed} pushed off the corridor, ${framedTally.dropped} refused`);
for (const r of seats.rows) {
  report.line(`    x ${r.f.x.toFixed(2).padStart(6)}  z ${r.f.zFoot.toFixed(2).padStart(5)}  `
    + `${r.f.rise} voxel  ->  ${r.foot ? `z ${r.foot.z.toFixed(2)}  ${r.foot.h} voxel  `
      + `(${r.off.toFixed(1)} voxel out)` : 'NO MASS ON THAT COLUMN'}`);
}
report.check(framedTally.dropped === 0 && framedTally.laid === FRAMED.length,
  'every seat the reference gives is laid',
  `${framedTally.dropped} of ${FRAMED.length} were refused by the stone or the way in`);
report.check(seats.worst <= SEAT_VOXELS,
  `and each one stands within ${SEAT_VOXELS} voxels of where the picture puts it   `
  + `(worst ${seats.worst.toFixed(1)})`,
  `worst ${seats.worst.toFixed(1)} voxels against ${SEAT_VOXELS}`);
report.check(seats.band >= BAND.masses,
  `and the band the eye lands on first -- ${BAND.near} to ${BAND.far} m from the pose -- `
  + `carries ${seats.band} masses against the reference's ${BAND.masses}`,
  `${seats.band} against ${BAND.masses}`);

// ------------------------------------------------------------------- 4
const agree = lawAgreesWithStore(0, 0, true, SHIPPED_RADIUS);
report.line('');
report.check(agree.agree,
  `the law and the store answer the same for all ${agree.checked} columns of a chunk`,
  agree.agree ? '' : `they part company at ${agree.ix},${agree.iz}`);

const edits = editsHold();
const broken = edits.filter(([, ok]) => !ok);
report.check(broken.length === 0,
  `the store's write side does what it says, on all ${edits.length} counts`,
  broken.map(([what]) => what).join('; '));

const floor = contractReadsTheStore(SHIPPED_RADIUS);
report.check(floor.agree,
  `and the walker's floor is the top of that store on all ${floor.checked} columns of the disc   `
  + `(${floor.onColumn} on a column, ${floor.onPlane} on the plane under the masonry)`,
  floor.agree ? '' : `at ${floor.i},${floor.j} the contract says ${floor.said} `
    + `over a column at ${floor.top}`);

const store = chunkColumns(0, 0, CHUNK, true, SHIPPED_RADIUS);
report.line('');
report.line(`  a chunk of the store is ${storeBytes(store)} bytes over `
  + `${store.w * store.d} columns (${(storeBytes(store) / (store.w * store.d)).toFixed(1)} a column)`);
report.line(`  fingerprint of chunk 0,0   grain on ${fingerprint(0, 0, true, SHIPPED_RADIUS)}`
  + `   grain off ${fingerprint(0, 0, false, SHIPPED_RADIUS)}`);
report.line(`  SOD cell ${SOD.cell} m, density ${SOD.density}, `
  + `reach ${SOD.reach.low}-${SOD.reach.high} m, rise ${SOD.rise} voxel`);

report.end();
