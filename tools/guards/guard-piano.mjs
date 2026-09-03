import { createHash } from 'node:crypto';
import {
  BASE_STEP, CENTRE, CHUNK, MATERIAL, MOUND, NO_COLUMN, SOD, VOXEL, cellMaterialAt,
  chunkColumns, clearColumn, columnCount, columnSpec, columnTop, createColumns, depthAt,
  matAt, meadowMoundAt, moundAt, paintTop, raise, setGroundHole, setTop, storeBytes,
  topAt, underAt,
} from '../../src/world/voxel/pure.js';
import { groundHoleAt } from '../../src/world/contracts.js';
import { TIERS } from '../../src/core/quality.js';
import { reporter, selfTest } from './lib.mjs';

// The largest disc any tier lays, and the corridor as the world answers it --
// for the reasons written in guard-fusione. Both arms below are read with it.
const SHIPPED_RADIUS = Math.max(...TIERS.map((t) => t.voxelDiscRadius));
setGroundHole(groundHoleAt);

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

const NO = -1e7;

/** Whether a point stands on one of the masses set down on the plane. */
function onMass(x, z) {
  return meadowMoundAt(x, z) > 0 || moundAt(x, z) > 0;
}

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

  const flat = { columns: 0, offPlane: 0, offPlaneOffMass: 0, worst: null };
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const h = columnTop(i, j, false, radius);
      if (h < NO) continue;
      flat.columns++;
      if (h === BASE_STEP) continue;
      flat.offPlane++;
      const x = (i + 0.5) * VOXEL;
      const z = (j + 0.5) * VOXEL;
      if (!onMass(x, z)) {
        flat.offPlaneOffMass++;
        if (!flat.worst) flat.worst = { i, j, h };
      }
    }
  }

  const runs = [];
  let pairs = 0;
  let openOver = 0;
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
        if (h < NO) {
          if (run > 0) runs.push(run);
          run = 0; prev = null; prevAt = null;
          continue;
        }
        const x = (i + 0.5) * VOXEL;
        const z = (j + 0.5) * VOXEL;
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
      what: 'the law and the store agree over a whole chunk, skirt included',
      caught: lawAgreesWithStore(0, 0, true, SHIPPED_RADIUS).agree,
    },
    {
      what: 'a store told to hand back a column it was never given says so',
      caught: topAt(createColumns(0, 0, 2, 2), 5, 5) === NO_COLUMN,
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
report.line(`  the masses keep their own bank: MOUND.scarp ${MOUND.scarp} voxels, `
  + `and the bank against the stone stands at ${MOUND.bank.high}`);

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

const store = chunkColumns(0, 0, CHUNK, true, SHIPPED_RADIUS);
report.line('');
report.line(`  a chunk of the store is ${storeBytes(store)} bytes over `
  + `${store.w * store.d} columns (${(storeBytes(store) / (store.w * store.d)).toFixed(1)} a column)`);
report.line(`  fingerprint of chunk 0,0   grain on ${fingerprint(0, 0, true, SHIPPED_RADIUS)}`
  + `   grain off ${fingerprint(0, 0, false, SHIPPED_RADIUS)}`);
report.line(`  SOD cell ${SOD.cell} m, density ${SOD.density}, `
  + `reach ${SOD.reach.low}-${SOD.reach.high} m, rise ${SOD.rise} voxel`);

report.end();
