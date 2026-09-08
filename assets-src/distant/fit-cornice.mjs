// HOW THE HILLS WERE SOLVED, AND WHY IT IS A SOLVE AND NOT A CHOICE.
//
//   node assets-src/distant/fit-cornice.mjs            solve and write cornice.json
//   node assets-src/distant/fit-cornice.mjs --report    solve, print, write nothing
//   node assets-src/distant/fit-cornice.mjs --polish    refine the table that ships
//
// THE POLISH IS NOT A SHORTCUT AND IT IS NOT A SECOND SOLVER. It is the same
// constraints and the same passes, started from the table already in
// cornice.json instead of from the seed, and run only at the two narrow spans.
// A full solve spends its first hundred passes travelling three degrees; when
// what is left is nine hundredths of one, on two bearings, those hundred passes
// are a hundred chances to land somewhere else. Started where it already is, it
// moves what is wrong and leaves alone what is right.
//
// The unit was ordered against one criterion -- «IDENTICO al target» -- and the
// only part of the target that says anything about the shape of a hill is the
// skyline R6 traced by hand off it: an elevation per bearing, at three quarters
// of a degree, on three stretches the picture shows, plus two readings taken
// down the columns of the gaps between the monoliths. Everything else about
// these hills is invented, and this file is the line between the two.
//
// ===========================================================================
// WHY THE PROTOTYPE'S FIT DID NOT SURVIVE BEING MEASURED.
//
// R6 fitted the near ridge's CROWN to the trace: a table of heights per bearing
// handed to the law as an amplitude. Then it computed what the law's own
// skyline does and the two disagree by 0.5 to 3.7 degrees, seven times the
// tolerance the mandate sets. Two reasons, and neither is a mistake:
//
//   1. A SILHOUETTE IS A MAXIMUM, NOT A VALUE. The eye sees the highest angle
//      along the whole ray, and the roughness that stops a hump being a dome
//      lifts that maximum above the crown by a fifth to a quarter of the
//      height. Setting the crown to the traced elevation therefore overshoots
//      it by exactly the roughness.
//
//   2. AT HALF THE BEARINGS IT IS NOT THAT RIDGE AT ALL. Measured, the
//      prototype's own silhouette at -30 degrees stands at eight hundred and
//      fifty metres and at -34 at fifteen hundred: the far rings, which nothing
//      fitted, standing clear over the shoulder of the near one, which
//      everything fitted.
//
// So this file fits the OUTPUT. It asks the law for its skyline, compares that
// with the trace, and moves the height of whichever ridge is CARRYING the
// silhouette at that bearing until the two agree. That converges in a handful
// of passes because the map from a ridge's height to its own elevation is
// monotone; where it does not converge it says so and the guard fails, which is
// the correct outcome and not one to paper over.
//
// ===========================================================================
// WHAT IS FITTED, WHAT IS BOUNDED, AND WHAT IS FREE.
//
// FITTED -- each PLANE to its own reading, at half a degree:
//   the near flank, 250 m    -34 .. -29 and +31.6 .. +37.6, thirty-three
//                            readings traced by hand
//   the middle crest, 400 m  +31.4 .. +33.6 traced, and read down both gaps
//                            at -18 (+1.9) and +17 (+2.2)
//   the far crest, 820 m     -34, standing nine to ten degrees over the near
//                            left flank
//   the pale hills, 1550 m   -18, the palest ridge down the left gap at +6.5
//
// BOUNDED -- to the band the reference holds everywhere it does not draw a
// number, which is R6 §2.1's own reading of the whole turn:
//   outside the lake's gap   +4 .. +10 degrees, from the eye, the middle and
//                            the rim, on every bearing
//   inside it                +2 .. +7, which is «nel varco NON chiude»
//
// FREE -- and declared free: the shape between two knots, the phase of every
// wave, the grain. The reference cannot see behind the walker and does not
// distinguish one hillside from another at nine hundred metres; a fit that
// claimed to would be fitting noise.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CENTRE, DEG, cubeAt, hillAt, ladders, planeAt, ridgeCeiling, skylineAt, tracedAt,
  waterLine,
} from './cornice.mjs';

/** The one level the profiles are heights above, asked for rather than typed. */
const WATER = waterLine();

const OUT = fileURLToPath(new URL('./cornice.json', import.meta.url));

// --------------------------------------------------------------- the readings
//
// R6-03, `fondazione/r6/out/tavolozza.json` → skyline → «profilo ogni 10 px»,
// carried here as [bearing, elevation] rather than re-read at solve time: the
// research tree is a scratch copy with a junction in it and this delivery may
// not depend on one. Every number below appears in R6 §2.1's table.

// THE FOUR PLANES, EACH READ SEPARATELY.
//
// The reference does not show a skyline: it shows three and four EDGES stacked
// on each other, and R6 read them apart. Fitting the topmost of them would put
// the near hill where the far crest is on the bearings where the far crest
// wins, so what is fitted here is each PLANE against the ridge that carries it.
// `planeAt` in ./cornice.mjs is the question; this is the answer sheet.
//
//   plane 0   the near flank, 250 m      R6-03 sx-vicina and dx-vicina
//   plane 1   the middle crest, 400 m    R6-03 dx-media, and the blue-teal
//                                        crest read down both gaps
//   plane 2   the far crest, 820 m       the crest standing 9-10 degrees over
//                                        the near left flank (rows 345-395)
//   plane 3   the pale hills, 1550 m     the palest ridge down the left gap
//
// Every number is R6 §2.1, §2.2 or §2.5, and nothing here was chosen.

/** The near flank, traced by hand (R6-03: sx-vicina, dx-vicina). */
export const NEAR = [
  [-34.0, 8.10], [-33.7, 8.10], [-33.3, 7.85], [-33.0, 7.16], [-32.7, 6.37],
  [-32.3, 5.34], [-32.0, 5.04], [-31.6, 5.38], [-31.3, 5.38], [-31.0, 4.99],
  [-30.6, 4.64], [-30.3, 4.15], [-29.9, 4.15], [-29.5, 3.65], [-29.2, 3.85],
  [31.6, 4.59], [32.0, 4.35], [32.4, 4.99], [32.7, 4.94], [33.1, 5.04],
  [33.5, 5.68], [33.8, 5.63], [34.2, 6.03], [34.5, 6.37], [34.9, 6.82],
  [35.2, 6.67], [35.6, 7.16], [35.9, 7.95], [36.2, 8.10], [36.6, 8.64],
  [36.9, 8.93], [37.2, 9.47], [37.6, 9.47],
];

/** The middle crest, traced on the right (R6-03: dx-media) and read down both gaps. */
export const MIDDLE = [
  [31.4, 6.18], [31.8, 6.37], [32.2, 5.98], [32.5, 6.03], [32.9, 6.37],
  [33.3, 6.08], [33.6, 5.83],
  // R6 §2.1: «−18 (varco 01-02): cresta blu-teal +1,9» and
  //          «+17 (varco 04-05): cresta blu +2,2».
  [-18, 1.90], [17, 2.20],
];

/** The far crest that stands over the near left flank (R6 §2.1, §2.6). */
export const FAR = [[-34, 9.50]];

/** The palest hills, seen down the left gap (R6 §2.1: «colline pallide +6,5»). */
export const PALE = [[-18, 6.50]];

/**
 * WHAT THIS UNIT DELIBERATELY DOES NOT REACH, said once and guarded as a band.
 *
 * In the right-hand gap the highest thing the reference shows is a row of grey
 * spires at +3.7, on a crest that reads +2.2 under them. A spire is cubes and
 * cubes on the crest are U-CORNICE-2's; so the crest is fitted here and the
 * skyline in that gap is held in a band that reaches the top of the spires,
 * which lets the next unit raise it to +3.7 without moving anything solved now.
 */
export const SKYLINE_BANDS = [
  { bearing: 17, band: [1.7, 3.9], what: 'the right gap, under the spires still to come' },
];

/**
 * The band the whole turn is held in, and WHY IT IS NOT THE SAME BAND FROM
 * EVERY EYE.
 *
 * R6 read «+4..+10 fuori dal varco, +2..+7 nel varco» off the picture, and a
 * picture has one camera in it. The mandate asks for the band from the middle
 * of the meadow and from the rim as well, and carrying the same two numbers
 * there would be arithmetic and not care: the rim stands thirty-five metres
 * nearer the hills on one side and thirty-five further on the other, and the
 * SAME ground read from 150 m instead of 185 reads 12.3 degrees where it read
 * 10. Held to ten from the rim, the fit would have to lower a ridge the traced
 * flank has already fixed -- it would be fitting the guard, not the picture.
 *
 * So what is held from the other two eyes is the property those eyes are there
 * to test, stated as itself: the horizon CLOSES -- there is land above the
 * horizontal on every bearing outside the gap, so no hole opens when the walker
 * moves -- and it does not become a wall.
 */
/**
 * WHERE THE FAR CREST GOES BEHIND THE NEAR FLANK, WHICH NOTHING MEASURED.
 *
 * At the frame's left edge the reference shows a crest at nine and a half
 * degrees standing over a near flank at eight point one, and three tenths of a
 * degree to the right of that the near flank at seven point eight five is the
 * highest land there is. Somewhere between the two the far crest passes behind
 * the near one, and the picture does not say where: the trace is one edge and
 * the window that read the far crest is one column. So the skyline is left free
 * over that stretch -- declared, and narrow -- rather than pinned to a shoulder
 * nobody measured and turned into a cliff to satisfy it.
 */
export const FREE_SHOULDER = [[-33.9, -33.0]];

/**
 * THE BEARINGS THE REFERENCE CAN ACTUALLY SEE, AND HOW THAT WAS FOUND OUT.
 *
 * At the fitted camera -- fov 44.199 vertical, on a frame of 1672 by 941 -- the
 * horizontal half-angle is atan(tan(fov/2) * aspect) = 35.81 degrees, and the
 * yaw is 1.818. So the picture spans -33.99 to +37.63 degrees from north.
 *
 * R6 TRACED FROM -34.0 TO +37.6. Those are not two numbers that happen to be
 * close to the frame's edges: they ARE the frame's edges, which is why the near
 * flank's trace stops where it stops on both sides.
 *
 * It follows that the reference says nothing whatever about -35, and holding it
 * to a band read off the picture is claiming a measurement that does not exist.
 * That was a real over-claim in this guard and it cost a delivery: the law read
 * 10.09 degrees at -35 against a ceiling of 10, on two bearings out of a
 * thousand and eighty, and no amount of solving could move it because there was
 * nothing wrong with it. Outside the frame what can honestly be asked is what
 * is asked from the other two eyes -- that the horizon CLOSES and is not a
 * wall.
 */
export const FRAME = { yaw: 1.818, halfAngle: 35.81 };

/**
 * A BEARING READ OFF THE FRAME, IN THE COMPASS THE LAW TURNS ON -- and the two
 * are three and a half degrees apart, which was inherited and is measured here.
 *
 * The engine's yaw and this world's compass run in OPPOSITE directions.
 * src/main.js reads a camera's yaw as `atan2(-d.x, -d.z)`, so a camera at +1.818
 * is looking three hundredths of a radian WEST of north; `hillAt` asks
 * `atan2(dx, -dz)`, which calls that same direction MINUS 1.818. Every bearing
 * R6 traced is `the angle right of the camera's axis, plus the camera's engine
 * yaw` -- which is why its trace runs from -34.0 to +37.6 and not symmetrically
 * from -35.81 to +35.81 -- so on the law's compass the same feature stands at
 * that number less twice the yaw.
 *
 * MEASURED, AND THE MEASUREMENT IS THE FIVE MONOLITHS. Their footings are known
 * to the centimetre in src/world/layout.js; projected onto the judging frame at
 * `bearing - yaw` they land in columns 184, 524, 779, 1033 and 1284, and the
 * reference draws them at about 295, 600, 850, 1094 and 1360. At
 * `bearing + yaw` they land at 278, 601, 852, 1110 and 1371 -- three to
 * seventeen pixels, against sixty-six to a hundred and eleven.
 *
 * SO THE HILLS U-CORNICE-1 FITTED FACE THREE AND A HALF DEGREES OFF, and every
 * per-direction reading of this unit and that one was registered through the
 * wrong sign. It is one conversion and it lives here, at the one boundary
 * between what was read off a picture and what the law is asked about.
 */
export const onCompass = (read) => read - 2 * FRAME.yaw;

/** Whether a bearing READ OFF THE FRAME is inside the picture. */
export function inFrame(bearingDeg) {
  const away = Math.abs(((bearingDeg - FRAME.yaw + 540) % 360) - 180);
  return away <= FRAME.halfAngle;
}

export const BANDS = {
  // THREE POINT SIX AND NOT FOUR, AND THE HALF DEGREE IS R6's OWN DATA AGAINST
  // R6's OWN ROUNDING. §2.1 summarises the sides as «+4..+10» and §0.1 states
  // the same thing as «fra +3,7 e +9,5»; the trace it is drawn from carries
  // 3.65 at -29.5 degrees. A floor of four is therefore stricter than the
  // picture, and measured, it is stricter by exactly the amount that matters:
  // held to four, the solve lifts the end of the near flank to 4.33 and misses
  // its own reading by seven tenths. The floor is the lowest land the reference
  // actually shows, rounded down to the nearest twentieth.
  fitted: { closed: [3.6, 10.0], gap: [1.7, 7.5] },
  elsewhere: { closed: [1.0, 13.0], gap: [-4.0, 9.0] },
};

/** Where the lake's gap ends, in degrees from north. */
export const GAP_HALF = 22;

/** Half a degree, which is the mandate's own tolerance and the trace's. */
export const TOLERANCE = 0.5;

/**
 * HOW FAR A MEASURED RUN IS TAKEN TO REACH PAST ITS OWN LAST READING.
 *
 * A degree and a half, and it exists because a plane does not stop existing
 * where somebody stopped measuring it. The middle crest was traced from +31.4
 * to +33.6; at +33.8 it is still there, and holding the skyline at +33.8 down
 * to the NEAR flank's 5.63 -- because the middle crest's window happened to end
 * two tenths of a degree earlier -- is guarding the edge of a measurement
 * rather than the picture. Held for a degree and a half at its last value, the
 * ceiling says what the reading actually supports and no more.
 */
export const HOLD = 1.5;

/** One plane's reading at a bearing, linearly between its own knots, or null. */
export function readAt(table, bearing, hold = 0) {
  // ASCENDING, ALWAYS. The middle crest's readings are written in the order
  // they were taken -- a traced run on the right, then the two taken down the
  // gaps at -18 and +17 -- and a run is found here by the GAP between one
  // bearing and the next. Read unsorted, the end of the traced run and the
  // reading at -18 look like one continuous stretch fifty-one degrees wide and
  // the hold never fires, which is measured: it left the skyline at +33.8
  // guarded against the near flank when the middle crest is what stands there.
  const rows = table.slice().sort((x, y) => x[0] - y[0]);
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    // Only inside a CONTINUOUS stretch: the middle crest carries a traced run
    // on the right and two isolated readings down the gaps, and interpolating
    // across the fifty degrees between them would invent a ridge.
    if (b[0] - a[0] > 1.5) continue;
    if (bearing >= a[0] && bearing <= b[0]) {
      const t = (bearing - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * t;
    }
    if (hold > 0 && bearing > b[0] && bearing <= b[0] + hold
      && (i + 2 >= rows.length || rows[i + 2][0] - b[0] > 1.5)) return b[1];
    if (hold > 0 && bearing < a[0] && bearing >= a[0] - hold
      && (i === 0 || a[0] - rows[i - 1][0] > 1.5)) return a[1];
  }
  for (const row of rows) if (Math.abs(row[0] - bearing) < 1e-9) return row[1];
  return null;
}

/** The highest plane read at a bearing, or null where nothing was read. */
export function highestRead(bearing, hold = HOLD) {
  let best = null;
  for (const rows of [NEAR, MIDDLE, FAR, PALE]) {
    const v = readAt(rows, bearing, hold);
    if (v !== null && (best === null || v > best)) best = v;
  }
  return best;
}

/** Every bearing at which any plane was read, once each, ascending. */
export function skylineBearings() {
  const seen = new Set();
  for (const rows of [NEAR, MIDDLE, FAR, PALE]) for (const row of rows) seen.add(row[0]);
  return Array.from(seen).sort((a, b) => a - b);
}

// ------------------------------------------------------------------ the eyes
//
// THREE, AND THE FIT IS ONLY EVER AGAINST THE FIRST. The trace was read through
// the fitted camera, so that is the only eye a reading can be compared at. The
// other two are where the BAND is held, because a frame that closes correctly
// from one spot and opens a hole in the horizon from the middle of the meadow
// is not a horizon, and the walker goes to both.

export const EYES = {
  // POSE_VOX_DAY / POSE_TARGET of src/core/poses.js, the campaign's one camera.
  fitted: { x: 0.599, y: 1.583, z: 14.215 },
  centre: { x: CENTRE.x, y: 1.583, z: CENTRE.z },
  rim: { x: 0, y: 1.583, z: CENTRE.z - 35 },
};

// ------------------------------------------------------------------ the seed
//
// WHERE THE SOLVE STARTS, WHICH IS THE LAW R6 PROTOTYPED, and it starts there
// rather than at zero so that everything the fit does NOT touch -- the shape
// between knots, the grain, the radii -- is the shape R6 measured and argued
// for, and so that a reader can diff the solved table against the seed and see
// exactly how much of the picture the fit is responsible for.

// A KNOT WHEREVER A READING IS, AND NO KNOT WHERE THERE IS NONE.
//
// Both numbers were measured rather than chosen, by running the solve and
// reading what it could not reach:
//
//   at 5 degrees   the solve stalls at 1.4 degrees of miss -- the right flank
//                  climbs five degrees of elevation over six of bearing and two
//                  readings four degrees apart pull the same knot both ways;
//   at 1.5         it stalls at 0.84 on the LEFT flank, where five readings
//                  spanning 1.7 degrees of elevation fall inside one knot
//                  interval: a straight line between two numbers is all the
//                  table can say there, and the trace is convex;
//   at 0.75        which is the grid the trace was read on, it closes.
//
// So the near flank carries 480 knots and the three ridges behind it carry what
// their own readings ask. Two hundred and forty on the middle crest, which was
// traced on the right and read down both gaps, and two hundred and forty on the
// palest, which was read once down the left gap and has no feature narrower
// than itself.
//
// AND FOUR HUNDRED AND EIGHTY ON THE FAR CREST, for a reason that is not the
// number of its readings -- it has one -- but the SHOULDER underneath it. It
// has to stand at nine and a half degrees at -34 and be gone under the near
// flank by -33, and at a knot of a degree and a half those two bearings share
// one interval: solved, the knot on the far side of it has to carry two hundred
// and five metres, which is twelve and three quarter degrees, and the band that
// holds the whole turn under ten fails half a degree from the reading. It is
// not the solver that cannot do it, it is the table -- with a knot every three
// quarters of a degree there is a rung between the two and both land.
//
// AND NINE HUNDRED AND SIXTY ON THE NEAR FLANK ONCE THE CROWN MOVED OUT TO 250.
// A profile is indexed by the bearing from the middle of the world, and once
// the corrections stopped being written at the EYE's bearing (see `carrier`)
// the trace's own spacing showed through: the readings are a third of a degree
// apart at the eye, which past thirty degrees is under three tenths of a degree
// of the ridge's own compass, and two of them fell inside one knot at 0.75.
// Measured, that is the whole of the residue -- 0.55 at -33.3 and 0.51 at -31.3,
// where the trace falls seven tenths of a degree in three tenths of bearing --
// and at 0.375 it closes.
const KNOTS = { near: 960, middle: 240, shoulder: 480, pale: 240 };

/** Whether a ridge is absent at a bearing, by its own `silent` windows. */
export function isSilent(ridge, bearingDeg) {
  if (!ridge.silent) return false;
  const bd = ((bearingDeg + 540) % 360) - 180;
  return ridge.silent.some((w) => bd >= w[0] && bd <= w[1]);
}

/** The seed's height for one ridge at one bearing, in metres over the plateau. */
function seedHeight(ridge, bearingDeg) {
  if (isSilent(ridge, bearingDeg)) return 0;
  const bd = ((bearingDeg + 540) % 360) - 180;
  const waves = [[3, 0.31, 1], [7, 1.94, 0.44], [13, 4.1, 0.23]];
  let s = 0;
  let w = 0;
  for (const [turns, phase, weight] of waves) {
    s += weight * Math.sin(bd * DEG * turns + phase + ridge.seed);
    w += weight;
  }
  let amp = ridge.amplitude * (1 + ridge.spread * (s / w));
  if (ridge.front !== undefined) {
    const t = (Math.abs(bd) - 12) / 20;
    const g = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
    amp *= ridge.front + (1 - ridge.front) * g;
  }
  return Math.max(0, amp);
}

/**
 * The spec before a single reading has been looked at.
 *
 * The four radii, the four widths and the ladder of cubes are R6 §4.1's and
 * §2.2's; the frontiers are the ones that put the band of apparent cube inside
 * 0.22 to 0.45 degrees at every crest, which is the arithmetic written over
 * `cubeAt` in ./cornice.mjs.
 */
export function seedSpec() {
  // `quiet` is where a reading covers this ridge, and therefore where its coarse
  // grain steps aside for the trace: see quietAt() in ./cornice.mjs. The windows
  // are the readings' own spans with a degree of margin, and nothing else.
  const ridges = [
    {
      // TWO HUNDRED AND FIFTY, AND WHAT MOVED IS THE FRONT (D-C1-1 = B).
      //
      // At 185 m, with the far shore where the picture puts it at about 170,
      // the front of this ridge climbs thirty metres over fifteen: a slope of
      // two. Measured, that is a wall in stripes -- the skyline's treads came
      // out at fifteen pixels against the reference's three, because a face
      // that steep leaves the silhouette on the crown alone and the crown is a
      // smooth fitted table. The reference's near right hill is a flight of
      // terraces whose skyline steps every three pixels, and a terrace can only
      // read as one if its tread is wide enough to be seen.
      //
      // So the shore stays at the reading (-2.3 degrees) and the crown goes out
      // to 250: eighty metres of climb instead of fifteen, a slope of one half.
      // The cube grows with it -- 250 / 190 = 1.32, so 1.3 m, which is the ring
      // ladder below -- and the height follows the angle, because the same
      // eight degrees at 250 m is forty-three metres where it was thirty-one at
      // 185. The inner width is what puts the foot at 170: with an amplitude of
      // forty-three, exp(-2.2 t^2) reaches the surface at t = 1.29, which is
      // eighty metres of front at widthIn 62.
      radius: 250, width: 81, widthIn: 62, amplitude: 43, spread: 0.45, seed: 0.0, reach: 0.03,
      knots: KNOTS.near, quiet: [[-35, -28], [30.5, 38.5]],
      // WHERE THE NEAR HILL IS NOT. The reference shows no near flank at all
      // between the monoliths: water to the far shore and then the pale hills
      // beyond it, «nel varco NON chiude». R6's own table pins the near ridge
      // to nought from -22 to +22 for the same reason, and the fit may not
      // raise it there -- if it could, the lake would end at a hundred and
      // twenty metres in the one place the reference lets the eye out.
      silent: [[-22, 22]],
    },
    {
      radius: 400, width: 120, widthIn: 62, amplitude: 46, spread: 0.45, seed: 1.3, reach: 0.10,
      front: 0.5, knots: KNOTS.middle, quiet: [[-19.5, -16.5], [15.5, 18.5], [30.5, 34.5]],
    },
    {
      radius: 820, width: 250, widthIn: 125, amplitude: 100, spread: 0.40, seed: 2.6, reach: 0.10,
      front: 0.85, knots: KNOTS.shoulder, quiet: [[-35.5, -28.5]],
    },
    {
      radius: 1550, width: 430, widthIn: 225, amplitude: 175, spread: 0.40, seed: 3.9, reach: 0.10,
      front: 1.0, knots: KNOTS.pale, quiet: [[-19.5, -16.5]],
    },
  ];
  return {
    fittedBy: 'assets-src/distant/fit-cornice.mjs',
    basinHold: 130,
    cubePerMetre: 190,
    waves: [
      { turns: 3, phase: 0.31, weight: 1.00 },
      { turns: 7, phase: 1.94, weight: 0.44 },
      { turns: 13, phase: 4.10, weight: 0.23 },
    ],
    rings: {
      // THE INNERMOST FRONTIER STANDS OUTSIDE THE WATER'S OWN EDGE, and that
      // is the seam between two systems rather than a taste. The meadow draws
      // the fall in terraces out to 204.8 m and the water's edge is at 110.16;
      // inside that edge the ground is DRY and the meadow owns every pixel of
      // it. At 112, with the frontier waving four per cent, the hills' lattice
      // reached 107.5 and put cells at 108 to 110 m -- a sliver of hill inside
      // the shore, on ground the meadow was already drawing. Outside the edge
      // the two never fight: the meadow's ground there is under the surface and
      // the water is in front of it, and the hills only exist where they are
      // above it.
      // AND THE FRONTIERS STAND BETWEEN THE CRESTS, WHICH IS WHERE THEY MOVED
      // WHEN THE NEAR CREST DID. A frontier is put at the geometric mean of the
      // two crowns it separates -- 250 and 400 give 316, 400 and 820 give 573,
      // 820 and 1550 give 1128 -- so that each ring carries its own crest with
      // as much room on one side of it as on the other, in the ratio the band
      // of apparent cube is a ratio in. At the old frontier of 270 the near
      // crown at 250, waving three per cent, crossed into the ring behind it on
      // part of the compass and was built of two-metre cubes: 0.44 degrees,
      // against a band that stops at 0.45.
      frontiers: [118, 320, 575, 1130, 2150],
      // 1.3 AND NOT 1: the near crest stands at 250 m now, and a cube is its own
      // distance over a hundred and ninety.
      cubes: [1.3, 2, 4, 8],
      jitter: 0.04,
      jitterSeed: 5.5,
      sectors: 16,
    },
    beds: { weights: [6, 3, 1], seed: 1 },
    // THE BROKEN ROCK ON TOP OF THE TERRACE. See crownAt() in ./cornice.mjs for
    // what it is for; these are the two numbers, and both were swept against
    // the reference's own risers and treads rather than chosen.
    //
    // Three cells in ten above the rock line, one to three cubes, weighted as
    // V5's own bed draw is. Measured over the sweep, on the two windows R6-05
    // read, against the reference's 2 / 5 / 11 with treads of 2 on the left and
    // 3 / 7 / 12 with treads of 3 on the right:
    //
    //   no crown at all       right treads 13.5 px -- the residue itself
    //   0.13 [8,3,1]          right 2.6 / 7 / 13.4, treads 6
    //   0.18 [6,3,1]          right 2.8 / 7 / 15.4, treads 4
    //   0.30 [6,3,1]          right 2 / 7 / 13.2,   treads 4      <- this
    //   0.15 [24,12,6,2,1,1,1]  right 3 / 8 / 22.4 -- a ladder that reaches
    //                         seven courses spikes the ninetieth percentile
    //
    // So the tall end of it is THREE courses and not the seven the painted
    // placeholder drew: measured on the picture, the reference's own biggest
    // step on this hill is twelve pixels, which is two cubes.
    //
    // AND THE SEED IS NOT A DIAL, WHICH TOOK TWO SOLVES TO ESTABLISH. Read over
    // eight seeds on the same fitted table, the ninetieth percentile of the
    // risers ranges from 9.1 to 13 pixels on the left flank and 8.1 to 15 on
    // the right: two or three pixels of spread on a window that carries thirty
    // to forty risers, which is the reading's own noise floor and not a
    // property of the world. The one seed that looked best on that sweep was
    // solved in full and came back WORSE than this one on four of the six
    // numbers, because the fit moves under the sweep. So the seed is left where
    // it is and the floor is declared.
    crown: {
      seed: 7,
      rings: [
        { share: 0.30, courses: [6, 3, 1] },
        // The spires of the gap: rare and tall, five courses of two metres at
        // four hundred, which is the degree and a half the reference reads
        // between its crest and the pinnacles standing on it.
        { share: 0.02, courses: [2, 2, 2, 1, 1] },
        { share: 0, courses: [1] },
        { share: 0, courses: [1] },
      ],
    },
    noise: {
      coarse: { metres: 55, growth: 0.06, amplitude: 0.42, nearShare: 0.6 },
      fine: { courses: 11, amplitude: 0.06 },
      // Where the coarse grain is damped, which is the near ridge's own reach:
      // it moved out with the crown.
      nearRadius: 350,
      // How much of the coarse grain is left where a reading covers the ridge,
      // and over how many degrees it comes back. See quietAt() in cornice.mjs.
      quietShare: 0.15,
      quietTaper: 2,
    },
    matter: {
      rockSlope: 0.75,
      rockLine: 0.55,
      grain: 23,
      grainShare: 0.35,
      // THE SUN THE CAMPAIGN FITTED, AND NOT THE ONE R6 GUESSED AT.
      //
      // R6 §4.1 carried az 255 el 60 and flagged it as inherited from R4/R5
      // rather than measured -- «bivio già aperto». E-LUCE4 closed it: fitted
      // against every reading at once, each held to its own error bar, the
      // minimum is az 274, el 51, and az 255 costs six bars against the scale
      // of luminance by orientation. The reference's own sky says the same
      // thing from a fifth direction (sky.json's top-level `sun`, az 280 ±
      // 10.3). So the hills stand in the world's own light: the risers facing
      // the eye go into shadow and the rock on the tops takes the warm side.
      sun: { azimuth: 274, elevation: 51 },
    },
    seats: { everyDegrees: 1.5 },
    // AND THE WINDOWS GO ONTO THE LAW'S COMPASS HERE, ONCE.
    //
    // `quiet` and `silent` above are written where the READINGS are, because
    // that is what they are for -- the grain steps aside where the picture
    // speaks, and the near ridge is absent where the picture shows water. But
    // `quietAt` and `isSilent` are asked by `hillAt`, which turns on the law's
    // own compass, so the two edges of every window are carried across the same
    // three and a half degrees the readings are. See onCompass().
    ridges: ridges.map((r) => ({
      radius: r.radius,
      width: r.width,
      widthIn: r.widthIn,
      seed: r.seed,
      reach: r.reach,
      knots: r.knots,
      quiet: r.quiet.map((w) => w.map(onCompass)),
      silent: r.silent ? r.silent.map((w) => w.map(onCompass)) : undefined,
      profile: Array.from({ length: r.knots }, (_, k) => +seedHeight(r, (k * 360) / r.knots).toFixed(3)),
    })),
    // R6 §2.3 and §4.4, carried as data rather than as code because the law
    // that eats them is the coordinator's (src/world/air.js) and this is the
    // measurement it will be fitted against, not a second fog.
    air: {
      beta: [0.0011, 0.0019, 0.0023],
      turn: 700,
      deep: [0.0066, 0.0795, 0.3453],
      pale: [0.1951, 0.6129, 1.2216],
      measured: {
        'cresta media 400 m': [0.25, 0.44, 0.62],
        'velo pallido 900 m': [1, 1, 1],
      },
    },
    // LE MATERIE, RISOLTE ATTRAVERSO LA CATENA VERA E CON L'ARIA SPENTA.
    //
    // R6 §2.3 ha invertito tre materie dal bersaglio con una ricostruzione
    // della catena del quadro, e U-CORNICE-1 le ha messe qui tali e quali.
    // Misurato sul quadro DELIVERED, con la stessa posa e senza velo d'angolo
    // da nessuna delle due parti, quelle radianze escono sedici livelli troppo
    // scure sull'erba e trentuno sulla roccia: fra una radianza e un pixel ci
    // sono AgX, l'sRGB e il cubo del grade consegnato, e una ricostruzione non
    // e' la catena.
    //
    // Cosi' sono risolte dove accadono (fondazione/lav/c2-tavolozza.mjs): la
    // pagina aperta una volta, la sola uniform `uPalette` mossa, e ogni classe
    // confrontata con il BERSAGLIO DENTRO LA PROPRIA MASCHERA -- dove la nostra
    // legge dice «roccia in ombra», che colore mostra il target li'. Le
    // maschere sono esatte e non stimate: si accende una classe per volta a
    // radianza alta e si guarda dove il quadro cambia (c2-classi.mjs).
    //
    // E CON L'ARIA SPENTA, CHE E' LA META' DELLA MISURA. R6 §2.3 definisce il
    // fianco vicino come lo ZERO della propria scala d'aria; con l'aria accesa
    // il quadro legge gia' 98-101 di verde e 151-155 di blu li' dove il
    // bersaglio ne legge 90-119 e 80-103, e un solve per canale sopra quel
    // pavimento chiede al pigmento un rosso doppio del proprio verde -- cioe'
    // scrive un'erba rossa per compensare la legge di un altro file. Spenta,
    // i tre canali tornano del pigmento. Il residuo con l'aria accesa e' nel
    // verbale, con la sua attribuzione.
    //
    // Risolte: roccia in ombra 74/104/103 contro 74/104/103 del bersaglio,
    // roccia lit 96/120/107 contro 94/119/103, erba lit 75/104/83 contro
    // 86/105/80. Le due CIME non sono misurate -- il taglio non costruisce una
    // pedata sopra i cinque metri, quindi ce ne sono seicento pixel in tutto il
    // quadro -- e restano derivate: una cima d'erba e' il suo fianco al sole
    // diviso quattro quinti, come U-CORNICE-1 la scriveva, e una cima di roccia
    // e' il suo fianco un ventesimo piu' chiara.
    palette: {
      grassTop: [0.4494,  0.3068,  0.0527],
      grassLit: [0.3595,  0.2455,  0.0422],
      grassShade: [0.0021,  0.0248,  0.0293],
      rockTop: [0.1214,  0.2094,  0.2006],
      rockLit: [0.1156,  0.1994,  0.191],
      rockShade: [0.0498,  0.1092,  0.104],
      water: [0.0245, 0.1629, 0.1687],
      skyShare: 0.28,
    },
  };
}

// ------------------------------------------------------------------ the solve

/**
 * The step the ray is marched at, everywhere.
 *
 * ONE METRE, AND IT IS THE SAME NUMBER IN THE FIT, THE VERDICT AND THE GUARD.
 * A silhouette is the largest angle along a ray through a field of cubes, and
 * what a march finds depends on where it lands: at two metres it can walk past
 * the one column that is the peak. Solving at two and judging at one is then
 * fitting one question and answering another, and it showed -- readings the
 * solve called satisfied came back three tenths of a degree out.
 */
export const MARCH = 1;

/**
 * Which ridge forms an edge along a bearing, AND AT WHICH BEARING OF ITS OWN.
 *
 * A PROFILE IS INDEXED FROM THE MIDDLE OF THE WORLD AND A READING IS TAKEN FROM
 * AN EYE THAT IS NOT THERE, and the difference between the two is not a
 * rounding. The judging eye stands twelve and a half metres off centre, so the
 * hill it sees at plus thirty-two degrees is at plus twenty-nine of its own; the
 * rim stands thirty-five off, and at plus forty-eight it is looking at the ridge
 * at plus forty-two. Corrections were being written into the knot the EYE was
 * facing, which past thirty-five degrees is six knots away from the ground that
 * was measured.
 *
 * Measured: the band from the rim stalled at 1.37 degrees over its ceiling for
 * a hundred and fifty-six passes -- every one of them lowering a piece of
 * hillside nobody was looking at, six degrees round the compass from the one
 * standing too tall. Asked at the hill's own bearing it comes down in eight.
 *
 * @returns {{ridge: number, bearingDeg: number, at: number}|null}
 */
function carrier(spec, eye, bearingDeg, lads, ridge, at) {
  // Where the edge actually stands, or -- for a plane that is not there at all
  // and has no silhouette to point at -- where its own crown would cross the ray.
  const reach = at || (ridge >= 0 ? spec.ridges[ridge].radius : 0);
  if (!reach) return null;
  const ux = Math.sin(bearingDeg * DEG);
  const uz = -Math.cos(bearingDeg * DEG);
  const h = hillAt(spec, eye.x + ux * reach, eye.z + uz * reach);
  const which = ridge === null || ridge === undefined ? h.ridge : ridge;
  if (which < 0) return null;
  return { ridge: which, bearingDeg: h.bearingDeg, at: reach };
}

/**
 * The corrections one pass wants, gathered before any of them is applied.
 *
 * ONE PASS IS ONE SIMULTANEOUS STEP AND NOT A HUNDRED SEQUENTIAL ONES, and that
 * is the cure for the instability this solve actually had. Measured: applying
 * each reading's correction the moment it is computed -- so the next reading is
 * judged against a profile the last one has already moved -- diverges at a knot
 * of three quarters of a degree, from 1.2 degrees of worst miss to 9.3, with
 * the near flank standing at 12.2 degrees at one bearing and BELOW THE WATER a
 * degree and a third away. The readings there are three tenths of a degree
 * apart and each correction tapers over a degree and a half, so every one of
 * them lands on knots the next three are about to be judged on: the loop chases
 * its own tail into a comb.
 *
 * Gathered first and applied once, with two corrections on one knot AVERAGED
 * rather than multiplied together, the same schedule converges. Averaged in the
 * logarithm because these are ratios: two corrections asking for a half and a
 * double should cancel, and 0.5 * 2 does that while (0.5 + 2) / 2 does not.
 */
function gather(spec) {
  return spec.ridges.map((ridge) => ({
    sum: new Float64Array(ridge.profile.length),
    weight: new Float64Array(ridge.profile.length),
  }));
}

/** Ask, over `span` degrees, for one ridge's profile to be scaled at a bearing. */
function want(basket, spec, ridge, bearingDeg, factor, span) {
  const profile = spec.ridges[ridge].profile;
  const step = 360 / profile.length;
  const reach = Math.max(1, Math.round(span / step));
  const centre = Math.round(bearingDeg / step);
  const log = Math.log(factor);
  const into = basket[ridge];
  for (let d = -reach; d <= reach; d++) {
    const k = ((centre + d) % profile.length + profile.length) % profile.length;
    const away = Math.abs(d) / (reach + 1);
    const weight = 1 - away * away * (3 - 2 * away);
    into.sum[k] += log * weight;
    into.weight[k] += weight;
  }
}

/** Apply everything one pass asked for, at once, inside the ceiling. */
function apply(basket, spec, gain) {
  for (let r = 0; r < spec.ridges.length; r++) {
    const ridge = spec.ridges[r];
    const profile = ridge.profile;
    const ceiling = ridgeCeiling(spec, r);
    const step = 360 / profile.length;
    const { sum, weight } = basket[r];
    for (let k = 0; k < profile.length; k++) {
      // A SILENT BEARING STAYS SILENT. It is nought because the reference shows
      // nothing there, and a solve free to raise it would close the one gap the
      // picture lets the eye through -- and a profile at nought is one nothing
      // can scale off anyway, so this is where it has to be said.
      if (isSilent(ridge, k * step)) { profile[k] = 0; continue; }
      if (!weight[k]) continue;
      const factor = Math.exp(gain * (sum[k] / weight[k]));
      profile[k] = Math.max(0, Math.min(ceiling, profile[k] * factor));
    }
  }
}

/**
 * How much taller a ridge has to be for its edge to move from one elevation to
 * another, as a factor on its height OVER THE WATER.
 *
 * Over the water and not over the eye, because that is what the profile is a
 * height above once the basin is added under it: scaling by heights over the
 * eye would ask for a factor that does not exist whenever the edge is below the
 * eye, which down in the gap it is. Clamped, because one reading may not decide
 * a hillside on its own.
 */
function factorFor(elevation, target, reach, eyeY, water) {
  const now = eyeY + Math.tan(elevation * DEG) * reach - water;
  const then = eyeY + Math.tan(target * DEG) * reach - water;
  if (!(now > 0.5)) return 1;
  return Math.max(0.55, Math.min(2.2, then / now));
}

/**
 * One pass of the solve.
 *
 * @returns {{worst: number, over: number}} the worst miss in degrees, and HOW
 *          MANY constraints are outside their band at all -- which is the tie
 *          breaker, and it is not a refinement. The keeper compares passes by
 *          their worst miss alone, so two specs that both peak at 0.181 score
 *          the same however many OTHER readings one of them has out: measured,
 *          a run sat at a worst of 0.181 with the band nine hundredths over on
 *          two bearings, and no amount of polishing could move it, because
 *          moving it did not improve the number being compared.
 */
function pass(spec, wants, span, gain) {
  const lads = ladders(spec);
  const basket = gather(spec);
  let worst = 0;
  let over = 0;
  for (const w of wants) {
    const eye = EYES[w.eye];
    // A READING IS READ THE WAY IT WAS DRAWN AND A BAND IS HELD ON EVERY RAY.
    // See tracedAt() in ./cornice.mjs: the trace is a hand-drawn line at three
    // quarters of a degree and the band is a property of the world.
    // ON THE LAW'S COMPASS, ALWAYS. Everything in `wants` is a bearing read off
    // the frame; see onCompass() for the three and a half degrees between the
    // two and for the measurement that found them.
    const at = onCompass(w.bearing);
    const read = w.traced
      ? tracedAt(spec, eye, at, w.ridge, lads, MARCH)
      : skylineAt(spec, eye, at, lads, MARCH);
    const lo = w.solveFrom === undefined ? w.band[0] : w.solveFrom;
    const hi = w.band[1];
    const elevation = read.elevation;
    if (elevation >= lo && elevation <= hi) continue;
    over += 1;
    const target = elevation < lo ? lo : hi;
    // A plane that is not there at all reads -90. That is not a miss of ninety
    // degrees, it is a ridge that has to be raised until it appears, so it is
    // asked for a fixed step and left out of the worst.
    if (elevation > -80) worst = Math.max(worst, Math.abs(elevation - target));
    const carried = carrier(spec, eye, at, lads, w.ridge, read.at);
    if (!carried) continue;
    // THE DISTANCE TO THE EDGE AND NOT THE RIDGE'S NOMINAL RADIUS. The eye is
    // off centre and the crowns wave, so the two differ by up to a fifth out
    // here; a factor solved at the wrong reach asks for a height that lands
    // somewhere else.
    const factor = elevation > -80
      ? factorFor(elevation, target, carried.at, eye.y, WATER)
      : 1.35;
    want(basket, spec, carried.ridge, carried.bearingDeg, factor, span);
  }
  apply(basket, spec, gain);
  return { worst, over };
}

/**
 * Every constraint the solve is run against.
 *
 * `ridge: null` means the skyline -- the highest of the four -- and any other
 * value means that plane's own edge.
 */
export function constraints() {
  const wants = [];
  // Six tenths of the tolerance, so the guard's own half degree has room for
  // the finer march it reads the answer back with.
  const TOL = TOLERANCE * 0.6;
  const plane = (rows, ridge, tol) => {
    for (const row of rows) {
      wants.push({
        eye: 'fitted', ridge, bearing: row[0], reading: row[1], traced: true,
        band: [row[1] - tol, row[1] + tol],
        what: `plane ${ridge} at ${row[0]}`,
      });
    }
  };
  plane(NEAR, 0, TOL);
  plane(MIDDLE, 1, TOL);
  // The same six tenths the others get, and for the same reason: a plane solved
  // to the edge of the tolerance is a plane the guard fails at exactly the
  // tolerance, which is measured -- the far crest came back 0.57 degrees out
  // while its own constraint reported itself satisfied.
  plane(FAR, 2, TOL);
  plane(PALE, 3, TOL);

  // THE SKYLINE IS THE HIGHEST PLANE THAT WAS READ AT THAT BEARING, AND THE
  // PLANES WERE NOT READ AT THE SAME BEARINGS.
  //
  // This is the constraint the prototype had no way to write and the one that
  // was actually failing: a ridge nobody measured standing in front of one
  // everybody did. It has to interpolate, because the near flank was traced
  // every third of a degree and the middle crest every four tenths, on their
  // own grids: comparing them bearing by bearing finds the near flank alone at
  // +32.0 and calls 4.35 the skyline, when the middle crest stands at 6.2 four
  // tenths of a degree either side of it.
  for (const bearing of skylineBearings()) {
    const highest = highestRead(bearing);
    if (highest === null) continue;
    if (SKYLINE_BANDS.some((b) => Math.abs(b.bearing - bearing) < 0.5)) continue;
    if (FREE_SHOULDER.some((f) => bearing > f[0] && bearing < f[1])) continue;
    wants.push({
      eye: 'fitted', ridge: null, bearing, reading: highest, traced: true,
      // Solved to six tenths of the tolerance and judged at the whole of it, the
      // same margin the planes are given. Solved to the tolerance itself, the
      // ceiling is satisfied the instant it is exactly half a degree out, which
      // is the number the guard fails at.
      band: [highest - TOLERANCE, highest + TOLERANCE * 0.6],
      // A CEILING WHILE SOLVING AND A BAND WHEN JUDGING, and the asymmetry is
      // the cure for the one thing that made this solve oscillate.
      //
      // Where the planes were read, the skyline is not an independent fact: it
      // is the highest of them. A skyline reading LOW therefore means some
      // measured plane has not got there yet, and that plane's own constraint
      // is already pushing it. Letting the skyline push too made the two pull
      // the same knot in opposite directions -- at -34 the near flank is pinned
      // at 8.1 and the skyline wants 9.5, so one raised the near ridge and the
      // other lowered it, pass after pass, and the run diverged from 1.2
      // degrees of worst miss to 9.1. Held as a ceiling, the skyline says the
      // one thing it alone knows: that NO ridge nobody measured may stand over
      // the ones everybody did.
      solveFrom: highest - TOLERANCE - 90,
      what: `the skyline at ${bearing}`,
    });
  }
  for (const b of SKYLINE_BANDS) {
    wants.push({
      eye: 'fitted', ridge: null, bearing: b.bearing, band: b.band, traced: true, what: b.what,
    });
  }

  // And the band, on the whole turn, from all three eyes.
  const spoken = skylineBearings();
  for (const eye of ['fitted', 'centre', 'rim']) {
    // A DEGREE FROM THE JUDGING EYE AND THREE FROM THE OTHERS, and the first
    // number is the guard's. A profile carries a knot every three quarters of a
    // degree, so between two bearings three degrees apart it has three knots to
    // wander in -- and it does: held at three and read at one, the band came
    // back 0.65 degrees over its own ceiling on twelve bearings the solve had
    // never looked at. Where the band is tight it is asked at the step it is
    // judged at. The other two eyes hold a band four degrees wide and are asked
    // at three, which costs a third of the passes and leaves nothing to wander.
    // ONE DEGREE FROM EVERY EYE, AND THE THREE WAS MEASURED WRONG. It used to
    // be three for the middle and the rim, on the argument that a band four
    // degrees wide leaves nothing to wander in. With the crown on the crest it
    // does: a crown is up to three cubes, which at the near ridge is nine
    // tenths of a degree, so between two bearings three apart the skyline can
    // stand over its ceiling on the one nobody asked. Measured, that is the rim
    // at -38 reading 13.59 against a ceiling of 13 while the solve reported the
    // band satisfied. The guard reads every eye at one degree; so does this.
    const step = 1;
    for (let b = -180; b < 180; b += step) {
      // ONLY WHERE A READING ACTUALLY SITS, WHICH IS SIX TENTHS OF A DEGREE.
      //
      // The band and a reading may not ask the same bearing for two things --
      // the near flank drops to 3.65 at -29.5, which is under the band's own
      // floor, so on a traced bearing the trace wins and the band stands aside.
      // Anywhere else the band holds, and «anywhere else» has to mean it: at a
      // degree and a half of exclusion the frame's own left edge went unheld
      // and the far crest ran to 10.36 against a ceiling of ten, and at four
      // degrees to 12.95 against a picture whose highest land is 9.5. The
      // readings on the flanks are three tenths of a degree apart, so six
      // tenths covers each of them and nothing between two of them.
      if (eye === 'fitted' && spoken.some((t) => Math.abs(t - b) < 0.6)) continue;
      const away = Math.abs(((b + 540) % 360) - 180);
      // The reference's own band only where the reference can see: inside the
      // frame, from the camera the frame was taken with. Everywhere else, the
      // question is whether the horizon closes at all.
      const bands = eye === 'fitted' && inFrame(b) ? BANDS.fitted : BANDS.elsewhere;
      wants.push({
        eye, ridge: null, bearing: b,
        band: away < GAP_HALF ? bands.gap : bands.closed,
        what: `the band from the ${eye} at ${b}`,
      });
    }
  }
  return wants;
}

/**
 * The stages a POLISH runs: the two narrow ones, damped.
 *
 * Started from the table already in cornice.json rather than from the seed. A
 * full solve spends its first hundred passes travelling three degrees; when
 * what is left is nine hundredths of one, on two bearings, those hundred passes
 * are a hundred chances to land somewhere else instead. Same constraints, same
 * arithmetic, different starting point.
 */
export const POLISH = [
  { span: 1.5, gain: 0.35, passes: 24 },
  { span: 0.75, gain: 0.25, passes: 24 },
];

/**
 * Solve, in passes of narrowing reach, KEEPING THE BEST ANSWER SEEN.
 *
 * THE DAMPING AND THE KEEPING ARE BOTH MEASURED CURES. Undamped at a knot of
 * three quarters of a degree the solve DIVERGES -- readings four tenths of a
 * degree apart smear onto each other's knots through the taper and each pass
 * overcorrects the last, and the run this replaces went from 1.2 degrees of
 * worst miss to 4.9 and then asked for a ridge tall enough to break the bed
 * ladder. Halving the gain on the two fine stages stops the oscillation; taking
 * a copy of the best pass stops a single bad one from being what ships. A
 * solver that can only be trusted to have improved is not one to write a
 * delivery out of.
 */
export function solve(spec, log = () => {}, schedule = null) {
  const wants = constraints();
  const stages = schedule || [
    { span: 18, gain: 0.9, passes: 8 },
    { span: 9, gain: 0.9, passes: 10 },
    { span: 4.5, gain: 0.9, passes: 14 },
    { span: 3, gain: 0.9, passes: 18 },
    { span: 3, gain: 0.6, passes: 30 },
    { span: 2.25, gain: 0.5, passes: 30 },
    // A KNOT WIDE AND HEAVILY DAMPED, for the one feature the wider spans
    // cannot make. The far crest has to stand at nine and a half degrees at -34
    // and be gone under the near flank by -33: at eight hundred and seventy
    // metres that is twenty-nine metres of fall over fifteen of arc, and a
    // correction that tapers over three degrees cannot cut a gradient a degree
    // and a half wide. It is the last stage and the gain is a third, because a
    // narrow correction is also the one that oscillates.
    { span: 1.5, gain: 0.35, passes: 34 },
    { span: 3, gain: 0.3, passes: 12 },
  ];
  const run = stages;
  let best = { worst: Infinity, over: Infinity };
  let kept = spec.ridges.map((r) => r.profile.slice());
  // Lexicographic: fewer readings out first when the peaks tie, and a lower
  // peak always wins. A tenth of a degree of tie is the width of the plateau
  // this solve ends on, and something has to choose inside it.
  const better = (a, b) => a.worst < b.worst - 1e-9
    || (Math.abs(a.worst - b.worst) <= 1e-9 && a.over < b.over);
  for (const stage of run) {
    let worst = Infinity;
    for (let i = 0; i < stage.passes; i++) {
      // THE COPY IS TAKEN BEFORE THE PASS AND NOT AFTER IT, and the difference
      // is a whole tenth of a degree of delivery. A pass MEASURES the spec it
      // is handed and then moves it; keeping the moved one and labelling it
      // with the score of the one before is keeping a spec nobody scored. It
      // showed as a reading at 0.55 in a run whose own best was 0.18 -- the
      // solve was right and the bookkeeping was not.
      const before = spec.ridges.map((r) => r.profile.slice());
      const scored = pass(spec, wants, stage.span, stage.gain);
      worst = scored.worst;
      if (better(scored, best)) { best = scored; kept = before; }
    }
    log(`  span ${String(stage.span).padStart(4)} deg -- last ${worst.toFixed(3)}, `
      + `best so far ${best.worst.toFixed(3)} deg with ${best.over} out`);
  }
  spec.ridges.forEach((r, k) => { r.profile = kept[k].map((v) => +v.toFixed(3)); });
  return best.worst;
}

/** What the solved spec answers, against every constraint. */
export function verdict(spec) {
  const lads = ladders(spec);
  const rows = [];
  for (const want of constraints()) {
    const eye = EYES[want.eye];
    const at = onCompass(want.bearing);
    const read = want.traced
      ? tracedAt(spec, eye, at, want.ridge, lads, MARCH)
      : skylineAt(spec, eye, at, lads, MARCH);
    const miss = read.elevation < want.band[0] ? want.band[0] - read.elevation
      : read.elevation > want.band[1] ? read.elevation - want.band[1] : 0;
    rows.push({
      eye: want.eye, ridge: want.ridge, bearing: want.bearing, band: want.band,
      what: want.what, elevation: read.elevation, at: read.at, miss,
      // What the guard will measure: the distance from the number the reference
      // was read at, and not from the edge of the band the solve worked to.
      off: want.reading === undefined ? miss : Math.abs(read.elevation - want.reading),
    });
  }
  return rows;
}

/** The apparent cube on the skyline, every three degrees, from the fitted eye. */
export function cubeSweep(spec) {
  const lads = ladders(spec);
  const rows = [];
  for (let b = -180; b < 180; b += 3) {
    const seen = skylineAt(spec, EYES.fitted, b, lads, MARCH);
    if (!seen.at) continue;
    const ux = Math.sin(b * DEG);
    const uz = -Math.cos(b * DEG);
    const h = hillAt(spec, EYES.fitted.x + ux * seen.at, EYES.fitted.z + uz * seen.at);
    rows.push({ bearing: b, at: seen.at, degrees: Math.atan2(cubeAt(spec, h.r, h.bearing), seen.at) / DEG });
  }
  return rows;
}

// ------------------------------------------------------------------- the run

if (process.argv[1] && process.argv[1].endsWith('fit-cornice.mjs')) {
  const polishing = process.argv.includes('--polish');
  const { readFileSync } = await import('node:fs');
  const spec = polishing ? JSON.parse(readFileSync(OUT, 'utf8')) : seedSpec();
  process.stdout.write(polishing
    ? 'polishing the table that ships\n'
    : 'fitting the hills against the traced skyline\n');
  const worst = solve(spec, (line) => process.stdout.write(`${line}\n`),
    polishing ? POLISH : null);
  const rows = verdict(spec);
  const worstOf = (set) => set.reduce((m, r) => Math.max(m, r.miss), 0);
  process.stdout.write('\n');
  for (const k of [0, 1, 2, 3]) {
    const set = rows.filter((r) => r.ridge === k);
    process.stdout.write(`  plane ${k}, ${String(spec.ridges[k].radius).padStart(4)} m   ${String(set.length).padStart(3)} readings, worst miss ${worstOf(set).toFixed(3)} deg\n`);
  }
  const sky = rows.filter((r) => r.ridge === null && r.what.indexOf('the band') !== 0);
  const band = rows.filter((r) => r.what.indexOf('the band') === 0);
  process.stdout.write(`  the skyline read   ${String(sky.length).padStart(3)} bearings, worst miss ${worstOf(sky).toFixed(3)} deg\n`);
  process.stdout.write(`  the band, 3 eyes   ${String(band.length).padStart(3)} bearings, worst miss ${worstOf(band).toFixed(3)} deg\n`);
  const read = rows.filter((r) => r.off !== undefined && r.band[1] - r.band[0] < 1.5);
  const worstOff = read.reduce((m, r) => Math.max(m, r.off), 0);
  const over = read.filter((r) => r.off > TOLERANCE);
  process.stdout.write(`\n  AGAINST THE MANDATE'S HALF DEGREE: ${read.length} readings, worst ${worstOff.toFixed(3)} deg, ${over.length} over\n`);
  for (const row of over) {
    process.stdout.write(`    OVER ${row.off.toFixed(2)} deg  ${row.what}  reads ${row.elevation.toFixed(2)} at ${row.at} m\n`);
  }
  const cubes = cubeSweep(spec).map((r) => r.degrees);
  process.stdout.write(`  apparent cube     ${Math.min(...cubes).toFixed(3)} .. ${Math.max(...cubes).toFixed(3)} deg\n`);
  process.stdout.write(`  worst overall     ${worst.toFixed(3)} deg\n`);

  if (!process.argv.includes('--report')) {
    writeFileSync(OUT, `${JSON.stringify(spec, null, 2)}\n`);
    process.stdout.write(`\n  written to assets-src/distant/cornice.json\n`);
  }
}
