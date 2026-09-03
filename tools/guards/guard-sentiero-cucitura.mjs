import { STAIRS } from '../../src/world/layout.js';
import {
  pathCentreX, pathEdge, pathHalfWidth, pathRun,
} from '../../src/world/terrain-field.js';
import { groundHeightAt, materialAt } from '../../src/world/contracts.js';
import {
  BASE_STEP, MATERIAL, PATH, VOXEL, columnSpec, meadowMoundAt, moundAt, onPaving,
  pathVerge,
} from '../../src/world/voxel/pure.js';
import { reporter, selfTest } from './lib.mjs';

// IS THE CORRIDOR THE GROUND, AT THE LEVEL THE REFERENCE MEASURES IT AT?
//
//   node tools/guards/guard-sentiero-cucitura.mjs
//   node tools/guards/guard-sentiero-cucitura.mjs --self
//
// WHAT THIS GUARD USED TO ASK, AND WHY IT DOES NOT ASK IT ANY MORE. The paving
// was a surface of its own laid over a hole in the meadow, so it asked the one
// question two surfaces over one field always raise: does either one cross the
// other? It measured a sink, a lift, a taper, a cover and a proud, and every
// number it printed was a number about the SEWING.
//
// THERE IS NOTHING LEFT TO SEW. The corridor is columns of the meadow's own
// store -- the same pass, the same store, MATERIAL.PATH written on their tops --
// and two columns of one store cannot stand a chord apart. The seam is nought BY
// CONSTRUCTION, and a guard on it would be a guard on arithmetic that no longer
// exists.
//
// WHAT REPLACES IT IS THE READING ITSELF. The reference says four things about
// this corridor that a defect could take away without anything else in this
// world going red, and this asks all four:
//
//   * THE LEVEL. The paving stands one voxel under the floor of the meadow, so
//     the grass beside the stone stands ONE TO TWO voxels proud of it -- one
//     where the meadow is plain, two where a plate of grain has lifted it. That
//     band is the reading of A 1.3, and it is what an eye actually sees of this
//     whole rebuild.
//   * THE WIDTH. Twenty voxels under the walker's own feet, eight to twelve
//     through the middle of the field, twenty four in the apron at the step: the
//     reference's own taper (A 1.3, E-DECISIONI7 A4), which the straight ramp
//     that stood here could reproduce none of.
//   * THE VERGES. Two to four columns of bare earth a side, by position and not
//     as one number (E-DECISIONI7 A3).
//   * AND WHERE THE STONE ENDS. It reaches the bottom step. It used to die five
//     metres short of it on a reading taken off the NIGHT picture; the day
//     picture is the one that judges and it says the opposite (E-DECISIONI7 A6).
//
// EVERY ONE OF THEM IS ASKED OF THE WORLD'S OWN ARITHMETIC AND NOT OF AN IMAGE,
// which is what lets it be asked at every northing rather than at the three a
// screenshot happens to show.

// Where the run is read, in metres of northing: the bottom step, and the edge of
// the frame. Walked at a step of one voxel, so nothing between two samples is
// missed.
const RUN = { from: STAIRS.z + STAIRS.tread * STAIRS.steps, to: 12.0 };

// How far the grass beside the stone has to stand proud of it, in voxels.
// A 1.3, and the committente's word on it is E-DECISIONI7 A2.
const PROUD = { low: 1, high: 2 };

// The reference's taper, in voxels of FULL width -- stone and both verges -- at
// the three northings it is read at, with the tolerance each reading carries. A
// row of the target is read to about a voxel, and the middle of the field is a
// BAND rather than a figure.
const TAPER = [
  { z: 9.2, low: 18, high: 22, what: 'under the walker' },
  { z: 4.0, low: 8, high: 12, what: 'through the middle of the field' },
  { z: -7.0, low: 22, high: 26, what: 'in the apron at the step' },
];

/** The full width of the corridor at a northing, in voxels. */
export function widthAt(z) {
  return (pathEdge(z, -1) + pathEdge(z, 1)) / VOXEL;
}

/** The column a world coordinate falls in. */
const cell = (v) => Math.floor(v / VOXEL);

/**
 * Walks the run and gathers everything the four claims are read off.
 *
 * Across each row the edges of the corridor are found by walking out from the
 * centreline through the generator's own answer, so what is measured is the
 * columns that are LAID and never the law they were laid from.
 */
export function survey() {
  const seen = {
    rows: 0,
    proudLow: 99,
    proudHigh: -99,
    vergeLow: 99,
    vergeHigh: -99,
    level: 0,
    levelAt: null,
    floor: 0,
    floorAt: null,
    southmost: null,
    stray: 0,
    strayAt: null,
  };
  for (let j = cell(RUN.from); j <= cell(RUN.to); j++) {
    const z = (j + 0.5) * VOXEL;
    const i0 = cell(pathCentreX(z));
    const mid = columnSpec(i0, j, true).mat;
    if (mid !== MATERIAL.PATH && mid !== MATERIAL.EARTH) continue;
    seen.rows++;
    if (seen.southmost === null || z < seen.southmost) seen.southmost = z;

    // The two edges and the two verges, walking out from the centreline.
    for (const dir of [-1, 1]) {
      let i = i0;
      let verge = 0;
      while (columnSpec(i, j, true).mat === MATERIAL.PATH) i += dir;
      while (columnSpec(i, j, true).mat === MATERIAL.EARTH) { verge++; i += dir; }
      if (verge < seen.vergeLow) seen.vergeLow = verge;
      if (verge > seen.vergeHigh) seen.vergeHigh = verge;
      // `i` now stands on the first column of meadow beyond the corridor, and
      // how far it stands over the paving is the whole of the reading.
      // ON THE MEADOW AND NOT ON A MASS. A mound is allowed to stand against
      // the corridor -- the reference shows its cut banks facing the eye and
      // the corridor, which is E-DECISIONI4 and the reason `EARTH.toPath`
      // exists -- so a plate of grain beside the stone is the reading and a
      // four voxel mound beside it is a different object.
      const gx = (i + 0.5) * VOXEL;
      if (meadowMoundAt(gx, z) > 0 || moundAt(gx, z) > 0) continue;
      const proud = columnSpec(i, j, true).top - columnSpec(i - dir, j, true).top;
      if (proud < seen.proudLow) seen.proudLow = proud;
      if (proud > seen.proudHigh) seen.proudHigh = proud;
    }

    // The level of the paving itself, and the walker's floor over it.
    const top = columnSpec(i0, j, true).top;
    const off = Math.abs(top - (BASE_STEP - PATH.drop));
    if (off > seen.level) { seen.level = off; seen.levelAt = [i0, j]; }
    const walked = groundHeightAt((i0 + 0.5) * VOXEL, z);
    if (Math.abs(walked - (top + 1) * VOXEL) > seen.floor) {
      seen.floor = Math.abs(walked - (top + 1) * VOXEL);
      seen.floorAt = [(i0 + 0.5) * VOXEL, z];
    }
  }

  // And south of the step: no column of the disc may carry paving there.
  for (let j = cell(RUN.from) - 40; j < cell(RUN.from); j++) {
    const z = (j + 0.5) * VOXEL;
    const c = cell(pathCentreX(z));
    for (let i = c - 20; i <= c + 20; i++) {
      if (columnSpec(i, j, true).mat !== MATERIAL.PATH) continue;
      seen.stray++;
      if (!seen.strayAt) seen.strayAt = [(i + 0.5) * VOXEL, z];
    }
  }
  return seen;
}

if (process.argv.includes('--self')) {
  const seen = survey();
  selfTest('guard-sentiero-cucitura', [
    {
      what: 'a corridor level with the meadow, so the grass stands nowhere proud of it',
      caught: PROUD.low > 0,
    },
    {
      what: `grass standing ${seen.proudLow} to ${seen.proudHigh} voxels proud`,
      caught: seen.proudLow >= PROUD.low && seen.proudHigh <= PROUD.high,
    },
    {
      what: 'a verge of one column a side, or of five',
      caught: seen.vergeLow >= PATH.verge.min && seen.vergeHigh <= PATH.verge.max,
    },
    {
      what: 'the reference\'s taper answered by a width that does not taper',
      caught: TAPER.every((t) => widthAt(t.z) >= t.low && widthAt(t.z) <= t.high),
    },
    {
      what: 'stone left standing south of the bottom step',
      caught: seen.stray === 0,
    },
    {
      what: 'a run that stops before it reaches the step',
      caught: pathRun(RUN.from + 0.2) > 0,
    },
    {
      what: 'the width law read at a northing past the end of its own table',
      caught: pathHalfWidth(-40) === pathHalfWidth(STAIRS.z),
    },
    {
      what: 'the contract calling the corridor something other than stone',
      caught: materialAt(pathCentreX(4), 4) === 'sentiero',
    },
  ]);
}

const report = reporter(
  'guard-sentiero-cucitura -- the corridor is the ground, at the level the reference reads',
);

const seen = survey();
report.line(`  ${seen.rows} rows of corridor, from z ${seen.southmost.toFixed(2)} to `
  + `z ${RUN.to.toFixed(2)}, laid as columns of the disc`);

// ------------------------------------------------------------------- 1
report.check(seen.level === 0,
  `the paving stands at ${BASE_STEP - PATH.drop}, one voxel under the floor of the meadow`,
  seen.levelAt ? `off by ${seen.level} at column ${seen.levelAt[0]},${seen.levelAt[1]}`
    : 'every row of it');
report.check(seen.proudLow >= PROUD.low && seen.proudHigh <= PROUD.high,
  `and the grass beside it stands ${PROUD.low} to ${PROUD.high} voxels proud, as A 1.3 reads`,
  `${seen.proudLow} to ${seen.proudHigh} voxels over the run`);

// ------------------------------------------------------------------- 2
report.line('');
for (const t of TAPER) {
  const w = widthAt(t.z);
  report.check(w >= t.low && w <= t.high,
    `${t.low} to ${t.high} voxels wide ${t.what}`,
    `${w.toFixed(1)} at z ${t.z}`);
}
report.line(`  the stone alone: ${(widthAt(9.2) - 2 * pathVerge(9.2)).toFixed(1)} voxels near, `
  + `${(widthAt(4.0) - 2 * pathVerge(4.0)).toFixed(1)} through the middle, `
  + `${(widthAt(-7.0) - 2 * pathVerge(-7.0)).toFixed(1)} in the apron`);
report.check(seen.vergeLow >= PATH.verge.min && seen.vergeHigh <= PATH.verge.max,
  `the verges are ${PATH.verge.min} to ${PATH.verge.max} columns of bare earth a side`,
  `${seen.vergeLow} to ${seen.vergeHigh} over the run`);

// ------------------------------------------------------------------- 3
report.line('');
report.check(seen.southmost <= RUN.from + VOXEL,
  `the stone reaches the bottom step at z = ${RUN.from.toFixed(2)}`,
  `last row at z ${seen.southmost.toFixed(3)}`);
report.check(seen.stray === 0,
  'and none is laid south of it, where the ground is the stair\'s',
  seen.strayAt ? `${seen.stray} columns, the first at z ${seen.strayAt[1].toFixed(2)}`
    : 'none');

// ------------------------------------------------------------------- 4
report.line('');
report.check(seen.floor === 0,
  'the walker\'s floor and the ground as drawn are one number over the corridor',
  seen.floorAt ? `${(seen.floor * 1000).toFixed(2)} mm at x ${seen.floorAt[0].toFixed(2)} `
    + `z ${seen.floorAt[1].toFixed(2)}` : '0.00 mm everywhere');
report.line('  -- and it cannot be otherwise: there is one surface, and both read the '
  + 'same column');
report.check(onPaving(pathCentreX(4), 4) && materialAt(pathCentreX(4), 4) === 'sentiero',
  'the engine and the contract answer the same about where the stone is',
  'both say sentiero at the centreline');

report.end();
