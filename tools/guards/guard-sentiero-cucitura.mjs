import { STAIRS } from '../../src/world/layout.js';
import {
  pathCentreX, pathEdge, pathHalfWidth, pathRun,
} from '../../src/world/terrain-field.js';
import { groundHeightAt, materialAt } from '../../src/world/contracts.js';
import {
  BASE_STEP, MANTO, MATERIAL, PATH, VOXEL, columnSpec, mantoAt, meadowMoundAt, moundAt,
  onPaving, pathDrop, pathVerge,
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
//     AND OVER THE APRON IT GIVES THAT VOXEL BACK, which is the same statement
//     and not an exception to it: the paving's top face meets what the corridor
//     arrives at, and over the last tread before the run that is the lowest
//     riser, which src/world/stairs.js draws down to nought. So the level is
//     asked against PATH.lift's own law rather than against one number, and the
//     proud is read in two bands -- one to two along the run, nought to one over
//     the apron, where the stone has come up to the meadow's own floor.
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
// A 1.3, and the committente's word on it is E-DECISIONI7 A2. It is the MAT that
// answers this now and not the terrain: see the note in survey().
const PROUD = { low: 1, high: 2 };

// WHERE THE BROWN IS COUNTED, in metres out from the edge of the paving, and it
// is the band the target's own ramp was read over (E-ERBA-A's instrument, run by
// U-ERBA-1: fondazione/lav/er-campo.py). Nothing here says how much brown there
// has to be at any one of them -- the number would be a fit against a share of
// PIXELS and this is a count of COLUMNS. What it says is that the share falls,
// which is the whole of «diradamento graduale» and the one thing about it that
// is a property of the world rather than of a frame.
const BANDS = [
  { mid: 0.15, what: 'at the kerb' },
  { mid: 0.45, what: 'half a metre out' },
  { mid: 0.90, what: 'a metre out' },
  { mid: 2.20, what: 'past the ramp' },
];

// And over the apron, where the paving has come up to the meadow's own floor:
// nought where the meadow is plain, one where a plate of grain has lifted it.
const APRON_PROUD = { low: 0, high: 1 };

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
    apronRows: 0,
    apronProudLow: 99,
    apronProudHigh: -99,
    vergeLow: 99,
    vergeHigh: -99,
    bands: BANDS.map(() => ({ earth: 0, all: 0 })),
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
      // AND HOW THE BROWN THINS PAST THAT RUN, WHICH IS THE NEW FACT ABOUT THIS
      // SEAM AND THE ONE THE COMMITTENTE ASKED FOR.
      //
      // E-DECISIONI10, nota, his words: «il sentiero sembra piu' largo nel target
      // per come si interseca al prato e all'erba: da noi ha netti confini verdi
      // ai margini -- il problema e' il diradamento/infittimento graduale». So
      // the corridor's own band of bare earth is still the two to four columns
      // PATH.verge writes, and past it a SHARE of the columns is earth as well,
      // falling to nothing over MANTO.verge.reach. Counting consecutive columns
      // cannot see that -- a run of brown that happens to be long is not a wide
      // verge, it is a draw -- so what is counted here is the share, band by
      // band, and what is asserted below is that it FALLS.
      for (let k = 0; k < BANDS.length; k++) {
        const x = (i0 + 0.5) * VOXEL + dir * (BANDS[k].mid + pathEdge(z, dir));
        const c = cell(x);
        if (meadowMoundAt(x, z) > 0 || moundAt(x, z) > 0) continue;
        const m = columnSpec(c, j, true).mat;
        if (m === MATERIAL.AIR || m === MATERIAL.STONE || m === MATERIAL.PATH) continue;
        seen.bands[k].all++;
        if (m === MATERIAL.EARTH) seen.bands[k].earth++;
      }
      // AND THE READING IS TAKEN AT THE KERB, WHICH IS A PLACE AND NOT A COLUMN
      // THE WALK HAPPENS TO STOP AT.
      //
      // It used to be «the first column of meadow beyond the corridor», and that
      // was the kerb while the brown ended at a column. It does not: past the
      // written verge a share of the columns is bare earth too, thinning out
      // over a metre and a half (E-DECISIONI10, and the bands below), so the
      // first meadow column can be anywhere in that metre and the reading would
      // be taken wherever the draw put it. The kerb is where the corridor's own
      // law puts it -- the stone, plus the verge it writes -- so that is where
      // this stands.
      i = i0;
      while (onPaving((i + 0.5) * VOXEL, z)) i += dir;
      i += dir * pathVerge(z);
      // ON THE MEADOW AND NOT ON A MASS. A mound is allowed to stand against
      // the corridor -- the reference shows its cut banks facing the eye and
      // the corridor, which is E-DECISIONI4 and the reason `EARTH.toPath`
      // exists -- so a plate of grain beside the stone is the reading and a
      // four voxel mound beside it is a different object.
      const gx = (i + 0.5) * VOXEL;
      if (meadowMoundAt(gx, z) > 0 || moundAt(gx, z) > 0) continue;
      // AND WHAT STANDS PROUD IS THE GRASS AND NOT THE GROUND, WHICH IS WHERE
      // THIS READING BELONGED ALL ALONG.
      //
      // A 1.3 reads «l'erba sporge 1-2 voxel sulla pietra» and this line used to
      // answer it out of the TERRAIN, because the terrain carried a grain of
      // sods that stood a voxel over the plane. E-DECISIONI8 retired that
      // reading and E-ERBA-A 1.2 named the identity in as many words: «che e',
      // nella vecchia unita', l'erba sporge 1-2 voxel sulla pietra -- la lettura
      // di A 1.3 ... le due letture non erano in disaccordo: erano la stessa
      // misura in due unita'». The terrain beside the stone is the PLANE now,
      // exactly one voxel over the paving and never two; what stands one to two
      // voxels proud is the mat of blades standing on it, and mantoAt is the
      // law's own word for how tall it is.
      // AND IT IS MEASURED FROM THE PAVING'S OWN LEVEL and not from whatever the
      // column before it turned out to be: with the brown thinning, the column
      // before the kerb is earth at the MEADOW's level as often as it is verge
      // at the stone's, and a difference taken against it would read nought.
      const proud = columnSpec(i, j, true).top - (BASE_STEP - pathDrop(z))
        + Math.round(mantoAt(gx, z) / VOXEL);
      if (pathDrop(z) === 0) {
        if (proud < seen.apronProudLow) seen.apronProudLow = proud;
        if (proud > seen.apronProudHigh) seen.apronProudHigh = proud;
      } else {
        if (proud < seen.proudLow) seen.proudLow = proud;
        if (proud > seen.proudHigh) seen.proudHigh = proud;
      }
    }

    // The level of the paving itself, and the walker's floor over it.
    const top = columnSpec(i0, j, true).top;
    if (pathDrop(z) === 0) seen.apronRows++;
    const off = Math.abs(top - (BASE_STEP - pathDrop(z)));
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
      what: 'a corridor that keeps its voxel of drop right up to the lowest riser',
      caught: seen.apronRows > 0,
    },
    {
      what: 'a verge of one column a side, or of five',
      caught: pathVerge(0) >= PATH.verge.min && pathVerge(0) <= PATH.verge.max,
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
  `the paving stands at ${BASE_STEP - PATH.drop} along the run and at ${BASE_STEP} over `
  + `the ${PATH.lift.toFixed(2)} m of apron, where it meets the lowest riser`,
  seen.levelAt ? `off by ${seen.level} at column ${seen.levelAt[0]},${seen.levelAt[1]}`
    : `every row of it, ${seen.apronRows} of them apron`);
report.check(seen.proudLow >= PROUD.low && seen.proudHigh <= PROUD.high,
  `and the grass beside it stands ${PROUD.low} to ${PROUD.high} voxels proud, as A 1.3 reads`,
  `${seen.proudLow} to ${seen.proudHigh} voxels over the run`);
report.check(seen.apronProudLow >= APRON_PROUD.low && seen.apronProudHigh <= APRON_PROUD.high,
  `and ${APRON_PROUD.low} to ${APRON_PROUD.high} over the apron, where the stone has come up `
  + 'to the floor the grass stands on',
  `${seen.apronProudLow} to ${seen.apronProudHigh} over ${seen.apronRows} rows`);

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
report.check(pathVerge(9.2) >= PATH.verge.min && pathVerge(9.2) <= PATH.verge.max
  && pathVerge(0) >= PATH.verge.min && pathVerge(0) <= PATH.verge.max
  && pathVerge(-7) >= PATH.verge.min && pathVerge(-7) <= PATH.verge.max,
  `the corridor writes ${PATH.verge.min} to ${PATH.verge.max} columns of bare earth a side`,
  `${pathVerge(9.2)} near, ${pathVerge(0)} through the middle, ${pathVerge(-7)} in the apron`);

// AND THE BROWN THINS PAST THAT BAND INSTEAD OF STOPPING AT IT.
report.line('');
const share = seen.bands.map((b) => (b.all ? b.earth / b.all : 0));
for (let k = 0; k < BANDS.length; k++) {
  report.line(`  bare earth ${BANDS[k].what.padEnd(18)} `
    + `${(share[k] * 100).toFixed(1)}% of ${seen.bands[k].all} columns`);
}
report.check(share.every((v, k) => k === 0 || v <= share[k - 1] + 1e-9),
  'and past it the bare earth THINS instead of stopping -- no step back up',
  share.map((v) => `${(v * 100).toFixed(1)}%`).join(' -> '));
report.check(share[0] > 0.5 && share[share.length - 1] < 0.02,
  'from most of the kerb to none of the open meadow, over the ramp MANTO states',
  `${(share[0] * 100).toFixed(1)}% at the kerb, `
  + `${(share[share.length - 1] * 100).toFixed(1)}% at ${BANDS[BANDS.length - 1].mid} m, `
  + `ramp ${MANTO.verge.reach} m`);

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
