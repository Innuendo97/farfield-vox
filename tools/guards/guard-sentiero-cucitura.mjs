import { SPAWN, STAIRS } from '../../src/world/layout.js';
import {
  pathCentreX, pathEdge, pathHalfWidth, pathRun,
} from '../../src/world/terrain-field.js';
import { groundHeightAt, materialAt } from '../../src/world/contracts.js';
import {
  BASE_STEP, CENTRE, DISC_RADIUS, MANTO, MATERIAL, PATH, VOXEL, columnSpec, mantoAt,
  meadowMoundAt, moundAt, onPaving, pathDrop, pathVerge,
} from '../../src/world/voxel/pure.js';
import { SPREAD } from '../../src/world/path.js';
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
//   * THE LEVEL. CHANGED BY U-SENT-2, and the committente's own words are why:
//     E-DECISIONI10 S1, «e' a piano col selciato, ma ha TASSELLI che sporgono in
//     maniera diversa -- non voxel completi». The paving stands at the meadow's
//     OWN floor at every northing, so the corridor raises no wall at its kerb at
//     all, and the apron's exception -- a northing where the drop changed, to
//     keep the ground from falling away from the lowest riser -- goes with it.
//     What stands proud of the stone is the MAT: A 1.3's «l'erba sporge 1-2
//     voxel sulla pietra» is answered by the blades, and it is answered where
//     the mat is at full intensity, because beside the stone the mat is at its
//     THINNEST by law and that ramp is the defect E-DECISIONI10 asked to have.
//     So the proud is read twice -- at the kerb and past the ramp -- and what is
//     gated is that it RISES between them.
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

// WHERE THE CORRIDOR STANDS ACROSS THE FRAME, AND IT IS A READING OFF THE DAY
// REFERENCE RATHER THAN A COPY OF THE LAW IT GATES.
//
// This is the one thing about the corridor that no other leg here can miss:
// every reading above is taken ACROSS the centreline, so a centreline in the
// wrong place answers all of them and draws the path through the meadow anyway.
// It is not a hypothetical -- it is what shipped until U-SENT-3, a metre and a
// third east of where the reference puts the stone at the front of the frame.
//
// THE READING. For every row of farfield-day-voxel-target.png, the two crossings
// of half a share of greenness either side of the corridor, taken to the plane
// y = 0 through POSE_VOX_DAY, and inside them the centroids of the pale stone
// and of stone and earth together; 217 rows gathered into 32 bins of 0.4 m of
// northing (fondazione/lav/s5-asse.py, s5-curva.py).
//
// AND IT IS FOUR SEATS ALONG THE RUN AND NOT ONE AT THE FRONT OF IT, WHICH IS
// THE LEG THAT WAS MISSING. What stood here asked the centreline for ONE number,
// at one northing, against one fitted end -- and one number is a test a straight
// line passes. The reference's corridor is not straight: it turns four times
// over the thirteen metres the frame resolves. So the register is read at the
// two crests, at the trough between them and at the near end, and a corridor
// that runs anywhere between those four without going through them fails here.
//
//     z = -1.75   +0.672 +/- 0.034 m     the crest to the east
//     z = +0.75   +0.128 +/- 0.032       the trough to the west
//     z = +4.25   +0.769 +/- 0.028       the second crest
//     z = +7.80   -0.502 +/- 0.049       the near end, under the walker
//
// THE TOLERANCES ARE THREE OF THOSE SIGMAS AND NOTHING ELSE. A band chosen for
// comfort would be a band that admits whatever is written today; a band at three
// times the reading's own error is a band the reading can defend. Each sigma is
// that seat's own -- the bins within 0.6 m of it, weighted -- so the near end,
// where the walker hides a verge and the reading is thinnest, is allowed the
// widest band and the middle of the field the narrowest.
//
// AND THE STAIR LEG IS AN ANCHOR NOW AND NOT A CORROBORATION. It used to be
// reported as two independent measurements agreeing to 1.5 cm: the ruler's own
// far end and STAIRS.x. That agreement is withdrawn -- the rows that carried the
// ruler's far end were reading the reference's own staircase, which projects
// eight metres nearer the eye than ours (PATH_CENTRE in terrain-field.js). What
// the leg still asks is the thing it was always sharpest at: that the corridor
// ARRIVES at the built stair rather than walking past it.
const REGISTER = {
  seats: [
    { z: -1.75, x: 0.672, tol: 0.101 },
    { z: 0.75, x: 0.128, tol: 0.097 },
    { z: 4.25, x: 0.769, tol: 0.084 },
    { z: 7.80, x: -0.502, tol: 0.147 },
  ],
  stairTol: 0.250,
};

// How far the grass has to stand proud of the stone, in voxels, PAST THE RAMP --
// where the mat is at full intensity. A 1.3, and the committente's word on it is
// E-DECISIONI7 A2. It is the MAT that answers this and not the terrain: see the
// note in survey().
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

// And AT THE KERB, one column past the verge, where the mat is at its thinnest
// because the corridor's own ramp put it there (MANTO.verge in
// ../../src/world/voxel/worldgen.js). Nought is allowed here and nowhere else:
// what this band exists to refuse is a mat that arrives at the stone at full
// height, which is «il netto confine verde» in one number.
const KERB_PROUD = { low: 0, high: 1 };
// Where the mat is read at full intensity, in metres out from the kerb. Past
// MANTO.verge.reach, so the corridor's own ramp has finished.
const PLATEAU = 2.20;

// The reference's taper, in voxels of FULL width -- stone and both verges -- at
// the three northings it is read at, with the tolerance each reading carries. A
// row of the target is read to about a voxel, and the middle of the field is a
// BAND rather than a figure.
//
// AND THE MIDDLE BAND HAS CHANGED, BECAUSE IT WAS COUNTING THE WRONG THING.
// «Eight to twelve» came from counting voxels along rows of the reference, and
// a row of the reference stops at the pale stone: U-SENT-2 measured that the
// reference's paving is never more than half stone even in its own middle and
// that its earth runs a metre and a half past the kerb, so a count that stops at
// the stone stops INSIDE the corridor. Taken instead in metres of world on the
// plane the fitted camera puts at nought -- the two crossings of half a share of
// green on each flank, found on the picture being measured
// (fondazione/lav/u4-largh.py) -- the reference holds 1.19 / 1.22 / 1.46 / 1.57
// m from z 7.5 to z 1.9 and does not narrow at all. With the two tenths of a
// metre the mat covers at the kerb that is fifteen to nineteen voxels of laid
// corridor, and the eight to twelve is now the STONE CORE, gated below.
const TAPER = [
  { z: 9.2, low: 18, high: 22, what: 'under the walker' },
  { z: 4.0, low: 15, high: 19, what: 'through the middle of the field' },
  { z: -7.0, low: 22, high: 26, what: 'in the apron at the step' },
];

/**
 * How wide the PALE STONE inside the corridor is at a northing, in voxels:
 * twice the distance from the centreline at which the share of stone pieces
 * crosses a half.
 *
 * ASKED OF THE LAW AND NOT OF A PICTURE. SPREAD in ../../src/world/path.js is a
 * smoothstep between two fractions of the half width, so the crossing is their
 * middle exactly, and the number below is that middle carried into metres by
 * the width beside it. It is the reading the middle band above used to carry.
 */
export function coreAt(z) {
  return 2 * ((SPREAD.from + SPREAD.to) / 2) * pathHalfWidth(z) / VOXEL;
}

/** What the reference's own stone core comes to, in voxels, at the middle. */
const CORE = { z: 4.0, low: 8, high: 12 };

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
    kerbProud: [],
    plateauProud: [],
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
      // misura in due unita'». The terrain beside the stone is the PLANE, and
      // since U-SENT-2 the paving is at that same plane, so the ground raises
      // nothing at all at the kerb; the whole of what stands proud is the mat of
      // blades standing on it, and mantoAt is the law's own word for how tall it
      // is.
      // AND IT IS MEASURED FROM THE PAVING'S OWN LEVEL and not from whatever the
      // column before it turned out to be: with the brown thinning, the column
      // before the kerb is earth at the MEADOW's level as often as it is verge
      // at the stone's, and a difference taken against it would read nought.
      // TWICE, AND THE TWO READINGS ARE THE RAMP. At the kerb the mat is at its
      // thinnest by law, so the band there admits nought; past the ramp it is at
      // full intensity, and that is where A 1.3's one to two has to land.
      const proud = columnSpec(i, j, true).top - (BASE_STEP - pathDrop(z))
        + Math.round(mantoAt(gx, z) / VOXEL);
      seen.kerbProud.push(proud);
      const px = gx + dir * PLATEAU;
      if (meadowMoundAt(px, z) === 0 && moundAt(px, z) === 0
        && !onPaving(px, z) && Math.hypot(px - CENTRE.x, z - CENTRE.z) < DISC_RADIUS - 1) {
        const pi = cell(px);
        const far = columnSpec(pi, j, true).top - (BASE_STEP - pathDrop(z))
          + Math.round(mantoAt((pi + 0.5) * VOXEL, z) / VOXEL);
        seen.plateauProud.push(far);
      }
    }

    // The level of the paving itself, and the walker's floor over it.
    const top = columnSpec(i0, j, true).top;
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
  // AND THE PROUD IS A MEDIAN AND NOT AN EXTREMUM, which is what A 1.3 is: «l'erba
  // sporge 1-2 voxel sulla pietra» is a typical blade and not a promise about
  // every column. The mat's own law leaves 0.6% of the plane bare and puts five
  // blades on one column in twenty (MANTO.law), so a band on the extremes would
  // be a band on the tails of a distribution nobody measured the tails of.
  const median = (a) => (a.length
    ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
  seen.kerbProudMid = median(seen.kerbProud);
  seen.proudMid = median(seen.plateauProud);
  return seen;
}

if (process.argv.includes('--self')) {
  const seen = survey();
  selfTest('guard-sentiero-cucitura', [
    {
      what: 'a corridor sunk under the meadow, which is what U-SENT-2 took out',
      caught: PATH.drop === 0,
    },
    {
      what: `grass standing ${seen.proudMid} voxels proud past the ramp`,
      caught: seen.proudMid >= PROUD.low && seen.proudMid <= PROUD.high,
    },
    {
      what: 'a mat that arrives at the stone at full height -- the netto confine verde',
      caught: seen.kerbProudMid < seen.proudMid,
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
    {
      what: 'the centreline a metre out of the reference\'s register, which is what shipped',
      caught: REGISTER.seats.every((r) => Math.abs(pathCentreX(r.z) - r.x) <= r.tol),
    },
    {
      // The defect the committente named in E-DECISIONI14: a corridor that
      // arrives at both ends and ignores everything between them. The single
      // seat this register used to carry could not see it, and a straight line
      // through the two outermost seats misses the two in the middle by four and
      // by six times their own tolerance.
      what: 'a corridor ruled straight between the two ends the register pins',
      caught: (() => {
        const a = REGISTER.seats[0];
        const b = REGISTER.seats[REGISTER.seats.length - 1];
        const line = (z) => a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z);
        return REGISTER.seats.some((r) => Math.abs(line(r.z) - r.x) > r.tol);
      })(),
    },
    {
      what: 'a corridor that walks past the staircase instead of arriving at it',
      caught: Math.abs(pathCentreX(RUN.from) - STAIRS.x) <= REGISTER.stairTol,
    },
    {
      what: 'a walker put down beside his own path',
      caught: onPaving(SPAWN.x, SPAWN.z),
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
report.check(seen.level === 0 && PATH.drop === 0,
  `the paving stands at ${BASE_STEP}, the meadow's own floor, at every northing`,
  seen.levelAt ? `off by ${seen.level} at column ${seen.levelAt[0]},${seen.levelAt[1]}`
    : `every one of ${seen.rows} rows, and PATH.drop is ${PATH.drop}`);
report.check(seen.proudMid >= PROUD.low && seen.proudMid <= PROUD.high,
  `and past the ramp the grass stands ${PROUD.low} to ${PROUD.high} voxels proud of it, `
  + 'as A 1.3 reads',
  `median ${seen.proudMid} over ${seen.plateauProud.length} readings at ${PLATEAU} m out`);
report.check(seen.kerbProudMid >= KERB_PROUD.low && seen.kerbProudMid <= KERB_PROUD.high
  && seen.kerbProudMid < seen.proudMid,
  `and ${KERB_PROUD.low} to ${KERB_PROUD.high} at the kerb itself, where the corridor's own `
  + 'ramp has the mat at its thinnest, and it is LOWER there than past the ramp',
  `median ${seen.kerbProudMid} at the kerb against ${seen.proudMid} past the ramp, `
  + `over ${seen.kerbProud.length} readings`);

// ------------------------------------------------------------------- 2
report.line('');
report.check(coreAt(CORE.z) >= CORE.low && coreAt(CORE.z) <= CORE.high,
  `and the PALE STONE inside it is ${CORE.low} to ${CORE.high} voxels through the middle `
  + 'of the field, which is what the rows of the reference were counted at',
  `${coreAt(CORE.z).toFixed(1)} at z ${CORE.z}`);
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

// ------------------------------------------------------------------- 5
report.line('');
for (const seat of REGISTER.seats) {
  const off = pathCentreX(seat.z) - seat.x;
  report.check(Math.abs(off) <= seat.tol,
    `the centreline stands within ${seat.tol.toFixed(3)} m of where the reference's own `
    + `corridor stands at z ${seat.z.toFixed(2)} (${seat.x >= 0 ? '+' : ''}${seat.x.toFixed(3)} m)`,
    `${pathCentreX(seat.z).toFixed(3)} written, ${off >= 0 ? '+' : ''}`
    + `${off.toFixed(3)} m off the reading`);
}
const stairOff = pathCentreX(RUN.from) - STAIRS.x;
report.check(Math.abs(stairOff) <= REGISTER.stairTol,
  `and it arrives at the staircase, within ${REGISTER.stairTol} m of the run's own axis`,
  `${pathCentreX(RUN.from).toFixed(3)} at the bottom step against STAIRS.x ${STAIRS.x}, `
  + `${stairOff >= 0 ? '+' : ''}${stairOff.toFixed(3)} m`);
const spawnOff = SPAWN.x - pathCentreX(SPAWN.z);
report.check(onPaving(SPAWN.x, SPAWN.z),
  'and the walker is put down ON it, which is what makes the first step a step on stone',
  `spawn at x ${SPAWN.x}, ${Math.abs(spawnOff).toFixed(3)} m `
  + `${spawnOff >= 0 ? 'east' : 'west'} of the centreline, `
  + `edge at ${pathEdge(SPAWN.z, spawnOff >= 0 ? 1 : -1).toFixed(3)} m`);

report.end();
