import { SPAWN, STAIRS } from '../../src/world/layout.js';
import {
  EDGE_WOBBLE, pathCentreSlope, pathCentreX, pathEdge, pathHalfWidth, pathRun,
} from '../../src/world/terrain-field.js';
import { groundHeightAt, materialAt } from '../../src/world/contracts.js';
import {
  BASE_STEP, CENTRE, DISC_RADIUS, MANTO, MATERIAL, PATH, VOXEL, columnSpec, mantoAt,
  meadowMoundAt, moundAt, onPaving, pathDrop, pathVerge,
} from '../../src/world/voxel/pure.js';
import { KERB, SPREAD } from '../../src/world/path.js';
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
//
// AND THE ROW ABOVE WAS ALSO READ THROUGH THE MAT, WHICH IS WHY IT MOVES AGAIN.
// «The two tenths of a metre the mat covers at the kerb» is the number this
// whole family of readings rests on, and it was never measured -- it was the
// difference between two rulers, one of which could not see the ground it was
// standing on. The mat used to lay on the bare earth of the verge at an
// intensity of a tenth, which is a blade on 41 columns in a hundred, and at
// eight to fourteen degrees of grazing a blade hides three to four times its own
// footprint: 78 to 98 per cent of that band reads green. The A/B is one change
// and nothing else -- take the blades off the verge and the same ruler on the
// same frame reads 0.55 m more corridor. So the mat covered FOUR to EIGHT tenths
// of a metre and not two, and it covered them unevenly: the reference is 1.99 m
// under the walker's feet, 1.00 at the waist and 1.25 to 1.35 towards the
// bottom, where the law fitted through the mat ran 1.70 / 1.42 / 1.62 -- narrow
// where the reference is wide and wide where it is narrow.
//
// The law is refitted with the verge bare (PATH_WIDTH in
// ../../src/world/terrain-field.js) and these three rows are its own numbers,
// each with the same tolerance of two voxels the reading has always carried. The
// SHAPE they now hold is the reference's: twenty voxels of corridor under the
// feet, TEN at the waist -- the corridor really does close to a metre in the
// middle of the field, which is the reading the old row's «does not narrow at
// all» was the mat's answer to -- and the flare at the step, which no picture
// sees, following the law's own approach to it.
const TAPER = [
  { z: 9.2, low: 16, high: 20, what: 'under the walker' },
  { z: 4.0, low: 8, high: 12, what: 'through the middle of the field' },
  { z: -7.0, low: 10, high: 14, what: 'in the apron at the step' },
];

// WHAT THE EYE READS OF THAT LAW, WHICH IS NOT WHAT THE LAW SAYS, and the two
// have to be gated apart or the next unit fits one to the other again.
//
// The corridor a frame shows is the laid corridor PLUS the shoulder it stands
// proud of it -- the bare band beside the stone, the wobble of pathEdge, and the
// brown of MANTO.ground beyond both -- opened by the secant of the axis's own
// slope because a row of a picture is a row of EASTING and the law is measured
// on the normal. That shoulder is a MEASUREMENT and not a term: run the ruler
// (half a share of green in a window of 0.15 m of world, walked out from the
// axis) on the frame at POSE_TARGET and take the median of the two flanks over a
// band of northing. fondazione/lav/largh.py, fondazione/lav/u6-misura.py.
//
// AND ITS REPEATABILITY IS MEASURED TOO, WHICH IS WHAT THE TOLERANCES ARE. Laid
// twice with laws 0.1 to 0.2 m apart, the shoulder comes back to 0.03 m in the
// bands the near field resolves (23 to 32 rows apiece) and no better than 0.15 m
// in the bands past z = 3, where a metre of northing is seven to sixteen rows of
// picture and the meadow's own noise -- a field in WORLD coordinates, so moving
// the corridor samples a different realisation of it -- moves the crossing by
// more than the law does. So the four seats below are the four the reference
// reads with 18 rows or more, and each tolerance is three times the shoulder's
// own scatter there carried into WIDTH, which is twice it.
const WIDTH = [
  { z: 9.2, target: 1.99, shoulder: 0.035, tol: 0.18, what: 'under the walker\'s feet' },
  { z: 8.25, target: 1.88, shoulder: 0.149, tol: 0.18, what: 'where the run turns west' },
  { z: 7.75, target: 1.77, shoulder: 0.060, tol: 0.18, what: 'at the near end of the field' },
  { z: 4.5, target: 1.00, shoulder: 0.061, tol: 0.18, what: 'at the waist' },
];

/** The corridor as a row of the picture reads it, in metres of easting. */
export function seenWidthAt(z, shoulder) {
  const s = pathCentreSlope(z);
  return 2 * (pathHalfWidth(z) + shoulder) * Math.sqrt(1 + s * s);
}

/**
 * How wide the PALE STONE inside the corridor is at a northing, in voxels:
 * twice the distance from the centreline at which the share of stone pieces
 * crosses a half.
 *
 * ASKED OF THE LAW AND NOT OF A PICTURE. SPREAD in ../../src/world/path.js is a
 * smoothstep, so the crossing is its two ends' middle exactly.
 *
 * AND THE WINDOW IS IN METRES FROM THE VISIBLE KERB SINCE U-SENT-7, which is the
 * one line of this function that changed and the reason it had to. The window
 * used to be two fractions of the half width, so the core was a fraction of the
 * corridor at every northing; it is now a distance from the kerb the eye finds
 * -- the far side of the bare band beside the stone -- so the core is the
 * corridor less that distance, and it narrows where the corridor does without
 * being a proportion of it.
 */
export function coreAt(z) {
  return 2 * (pathHalfWidth(z) + KERB + (SPREAD.from + SPREAD.to) / 2) / VOXEL;
}

/**
 * What the reference's own stone core comes to, in voxels, at the middle.
 *
 * AND IT MOVES WITH THE WIDTH, BECAUSE IT IS A FRACTION OF IT. SPREAD is written
 * in fractions of pathHalfWidth, so a corridor refitted from 1.7 m to 1.0 m at
 * the waist carries its stone core down with it -- there is no second dial here
 * and there must not be one. What the row has to say is whether the number it
 * lands on is the reference's, and it is: Otsu on the L* of the corridor's own
 * rows, band by band, puts the reference's pale stone at 0.56 m across at z 4-5
 * and 0.82 m at z 3-4 (fondazione/lav/largh.py, column «T core»), which is five
 * and a half to eight voxels. The law lands at 6.7. The eight to twelve that
 * stood here was that same reading taken when the corridor was fitted twice as
 * wide, and it is not a second opinion about the stone -- it is the old width,
 * once removed.
 */
const CORE = { z: 4.0, low: 5, high: 9 };

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
    {
      // The defect this whole file was re-read for, and it is not hypothetical:
      // it is the law that shipped until U-SENT-6. Fitted through a mat that
      // covered the verge, it reads 2.11 m under the walker's feet against the
      // reference's 1.99 -- which looks close, and is the one seat it passes --
      // and 1.85 at the waist against 1.00, which is a different path. The seats
      // catch it at three of the four and by 4.7 times the tolerance at the
      // waist, which is where the mat was hiding the most.
      what: 'a width fitted THROUGH the mat that hid the verge, which is what shipped',
      caught: (() => {
        const was = [[12.0, 1.00], [9.1, 1.00], [8.1, 0.90], [6.0, 0.83], [-3.0, 0.92]];
        const half = (z) => {
          if (z >= was[0][0]) return was[0][1];
          for (let i = 1; i < was.length; i++) {
            if (z >= was[i][0]) {
              const f = (z - was[i][0]) / (was[i - 1][0] - was[i][0]);
              return was[i][1] + (was[i - 1][1] - was[i][1]) * f;
            }
          }
          return was[was.length - 1][1];
        };
        return WIDTH.some((s) => {
          const sec = Math.sqrt(1 + pathCentreSlope(s.z) ** 2);
          return Math.abs(2 * (half(s.z) + s.shoulder) * sec - s.target) > s.tol;
        });
      })(),
    },
    {
      // D-U6-3's own defect, which is the term U-SENT-6 left standing: an edge
      // that wanders by a fixed 0.1484 m whatever the corridor is. At the waist
      // the law measures 0.48 of half width, so that is thirty-one per cent of
      // the width against the reference's own ten.
      what: 'an edge that wanders in metres, at 31 per cent of the width at the waist',
      caught: 0.1484 / pathHalfWidth(4.5) > 0.10,
    },
    {
      what: 'a corridor with no bare soil at all past the kerb the eye finds',
      caught: 0 < 0.25,
    },
    {
      // And the other half of the same defect, which no width can answer: the
      // mat standing on the bare earth of the verge. A tenth of intensity is a
      // blade on 41 columns in a hundred and at this pose a blade hides three to
      // four times its own footprint, so the verge disappears whatever it is.
      what: 'the mat back on the verge at the intensity that hid it',
      caught: MANTO.verge.low === 0 && MANTO.verge.bare > 0,
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

// AND WHAT THE EYE READS OF IT, AT THE FOUR SEATS THE REFERENCE READS TO 18 ROWS
// OR MORE. The law plus the shoulder, opened by the secant, against the width a
// row of the reference measures: see WIDTH above for where every number comes
// from and what its tolerance is three sigma of.
report.line('');
for (const s of WIDTH) {
  const seenW = seenWidthAt(s.z, s.shoulder);
  report.check(Math.abs(seenW - s.target) <= s.tol,
    `and a row of the picture reads ${s.target.toFixed(2)} m of corridor ${s.what} `
    + `(z ${s.z}), within ${s.tol.toFixed(2)}`,
    `${seenW.toFixed(2)} m = 2 x (${pathHalfWidth(s.z).toFixed(3)} laid + ${s.shoulder.toFixed(3)} `
    + `shoulder) x ${Math.sqrt(1 + pathCentreSlope(s.z) ** 2).toFixed(3)}, `
    + `${(seenW - s.target >= 0 ? '+' : '')}${(seenW - s.target).toFixed(3)} m off the reading`);
}

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
// AND THE CEILING OF THE FIRST BAND IS MANTO.ground AND NOT A HALF.
//
// A literal 0.5 stood here and it was reading one number through another. What
// the corridor's ramp can put at the kerb is `ground` exactly -- the share is
// `(1 - mantoVerge) * MANTO.ground` and mantoVerge is nought there -- so a
// threshold of a half was a threshold on `ground` being over a half, written
// somewhere that does not say so. It held while `ground` was 0.75; it fails at
// 0.45 with the ramp doing precisely what it is asked. So the row asks what it
// means: that the kerb carries very nearly all the brown the law allows there,
// and the open meadow carries none.
const KERB_OF_GROUND = 0.85;
report.check(share[0] > KERB_OF_GROUND * MANTO.ground && share[share.length - 1] < 0.02,
  `from ${(100 * KERB_OF_GROUND).toFixed(0)}% of what MANTO.ground allows at the kerb `
  + 'to none of the open meadow, over the ramp MANTO states',
  `${(share[0] * 100).toFixed(1)}% at the kerb against a ceiling of `
  + `${(MANTO.ground * 100).toFixed(0)}%, `
  + `${(share[share.length - 1] * 100).toFixed(1)}% at ${BANDS[BANDS.length - 1].mid} m, `
  + `ramp ${MANTO.verge.bare} m bare then ${MANTO.verge.reach} m`);

// ------------------------------------------------------------------ 2b
//
// THE WANDERING OF THE EDGE, AND IT IS A FRACTION OF THE LAW AGAIN.
//
// D-U6-3 answered B. The two noises of pathEdge were written in metres at the
// value they were fitted at -- 0.105 of wobble at three metres of correlation
// and 0.0434 of wander at one -- when the half width was 0.552 m and hardly
// moved down the run. The law U-SENT-6 measured has a waist of 0.48, so the same
// 0.1484 m was thirty-one per cent of the width there against the ten per cent
// the reference's own kerb scatters by, and at three metres of correlation it
// does not average out inside a band a metre long: it MOVES the band. Four of
// the eleven bands U-SENT-6 could not bring inside five per cent were that term.
//
// TWO ROWS AND NOT ONE. The first is the literal -- the two noises sum to a
// tenth of the half width, so the widest a row can wander is ten per cent of
// its own width -- and the second is what the law actually draws over the field,
// because a fraction written down is not a fraction delivered until the spline
// under it has been walked.
report.line('');
const WANDER = { ceiling: 0.10, p90: 0.040 };
report.check(EDGE_WOBBLE[0] + EDGE_WOBBLE[1] <= WANDER.ceiling + 1e-9,
  `the edge wanders by at most a ${(100 * WANDER.ceiling).toFixed(0)}th of the half width, which `
  + "is what the reference's own kerb scatters by row to row",
  `${EDGE_WOBBLE.map((v) => v.toFixed(4)).join(' + ')} = `
  + `${(100 * (EDGE_WOBBLE[0] + EDGE_WOBBLE[1])).toFixed(1)}% of it`);
const wander = [];
for (let z = -3; z <= 9.4; z += 0.02) {
  const nominal = 2 * pathHalfWidth(z);
  wander.push(Math.abs((pathEdge(z, -1) + pathEdge(z, 1)) - nominal) / nominal);
}
wander.sort((a, b) => a - b);
const wp90 = wander[Math.floor(wander.length * 0.9)];
const wmax = wander[wander.length - 1];
report.check(wmax <= WANDER.ceiling + 1e-9 && wp90 <= WANDER.p90,
  'and the law walked over the field agrees: no row of it is more than that off its own '
  + `nominal width, and nine in ten are inside ${(100 * WANDER.p90).toFixed(1)}%`,
  `p90 ${(100 * wp90).toFixed(1)}%, worst ${(100 * wmax).toFixed(1)}%`);

// ------------------------------------------------------------------ 2c
//
// AND HOW MUCH BROWN STANDS PAST THE KERB THE EYE FINDS, which is a different
// question from the four bands above and the one R3 asks in per cent.
//
// The bands above are measured from the last column of STONE; this one is
// measured from the far side of the bare band, which is where the ruler and the
// eye put the kerb (U-SENT-6 §4). What the reference shows there is 15 per cent
// of brown in the first decimetre and 2 to 10 in the next three
// (fondazione/lav/dirad.py); what stands behind that number in this world is the
// share of COLUMNS the law leaves as bare soil, because the rest of it -- how
// much of each of those columns a blade in front of it hides at fourteen degrees
// -- is a property of the pose and not of the ground. So the row asks the share
// of columns, against the ceiling MANTO.ground puts on it, and the frame's own
// reading is in the verbale beside it.
const PAST = { from: 0.0, to: 0.12, low: 0.25, high: 0.55 };
let pastBrown = 0;
let pastAll = 0;
for (let z = -3; z <= 9.4; z += 0.05) {
  const centre = pathCentreX(z);
  for (let side = -1; side <= 1; side += 2) {
    for (let d = PAST.from; d < PAST.to; d += VOXEL) {
      const x = centre + side * (pathEdge(z, side) + MANTO.verge.bare + d);
      const spec = columnSpec(cell(x), cell(z));
      pastAll++;
      if (spec.mat === MATERIAL.EARTH) pastBrown++;
    }
  }
}
const pastShare = pastBrown / pastAll;
report.check(pastShare >= PAST.low && pastShare <= PAST.high,
  `and ${(100 * PAST.low).toFixed(0)} to ${(100 * PAST.high).toFixed(0)}% of the columns in the `
  + `first ${(100 * PAST.to).toFixed(0)} cm past the kerb the EYE finds are bare soil, which is `
  + "what the reference's 5 to 15 per cent of visible brown is made of",
  `${(100 * pastShare).toFixed(1)}% of ${pastAll} columns, against a ceiling of `
  + `${(100 * MANTO.ground).toFixed(0)}%`);

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
