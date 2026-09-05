import {
  AREA_CENTER, PLATFORM, STAIRS,
} from './layout.js';

// The shape of the ground, as arithmetic.
//
// WHAT IS LEFT OF IT, AND WHAT IT IS STILL FOR. This was the single definition
// of where the ground is: a mesh was built from these numbers and the walker
// walked on a grid sampled from them. The world is a store of blocks now
// (src/world/voxel/worldgen.js) and the height of a point is answered by
// groundHeightAt in src/world/contracts.js out of that store. What survives here
// is the two things the store is written FROM -- the one literal the base of the
// disc stands at, and where the corridor runs and how wide -- read by the
// generator and never copied.
//
// THE GROUND IS A PLANE, AND IT IS THE REFERENCE THAT SAYS SO.
//
// What stood here said the opposite -- that the feet of the monoliths are
// swallowed by ground, that the path runs in a shallow trench between two
// raised lips, and that the meadow has to roll to catch light on one flank and
// lose it on the other. All three were read off the picture without a ruler,
// and all three fail when one is held up: the feet are swallowed by tall GRASS
// and stand on ground at nought; the corridor's own relief is half a voxel, so
// what put it in a hollow was the meadow around it and never the corridor; and
// the light on a cube comes from the bearing of its face, which a plane gives
// exactly as well as a hill.
//
// THE MEASUREMENT is in per-il-committente/ricerca/A-STRUTTURA-DEL-MONDO.md
// §1.1. Projected through the fitted camera, the reference's ground meets a two
// metre grid at y = 0 across the whole frame; over the eleven seats it shows
// without occlusion -- four block feet, the foot of the stair, three stretches
// of meadow and three of corridor -- its excursion is WITHIN ONE VOXEL. The
// field that stood here made NINE over the same eleven, and sixteen over the
// disc in frame.
//
// So the height of the walkable ground is a LITERAL. What stands above it --
// the masses of the meadow and the banks against the stone -- is placed on it
// in src/world/voxel/mesher.js, and is not a shape of this field.

// Value noise. Hashed rather than tabulated so the field is defined everywhere
// and identical wherever it is evaluated; the operations are the ones that
// survive being written twice, in case a second implementation is ever needed.
function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

// Smootherstep: zero first and second derivative at both ends, so summed
// octaves never leave a crease along a cell boundary.
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function noise2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

// Signed, so an octave neither lifts nor sinks the mean height.
function snoise(x, z) {
  return noise2(x, z) * 2 - 1;
}

export function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

// ------------------------------------------------------------------ the path

// WHERE THE PATH RUNS, AS A CURVE READ OFF THE REFERENCE AND NOT AS A SHAPE.
//
// THE RAMP HAS FALLEN, AND IT WAS SEEN TO FALL BEFORE THE RULER SAID SO. What
// stood here was a smoothstep between two northings, fitted by HOLDING that
// shape and moving one of its two ends; the 0.20 m rms it could not account for
// was written off as the wander of a hand-drawn verge. It was not wander.
// Measured row by row with no shape assumed, the reference's corridor MEANDERS:
// four turns over the thirteen metres the frame resolves, 1.33 m of lateral
// travel end to end, and one single stretch 0.75 m long that a ruler would call
// straight. Against that reading the old ramp is 0.45 m rms out and 1.12 m out
// at its worst -- and its worst is at the NEAR end, under the walker's feet,
// where the reference puts the corridor 1.14 m west of where the ramp put it,
// on the other side of the eye. That end had never been measured: the rows that
// would measure it are the rows the walker stands in, and the ramp reached them
// by extrapolation.
//
// THE RULER IS U-SENT-3's, WITH TWO MORE LEGS. Per row of the picture, the two
// crossings of half a share of greenness either side of the corridor -- smoothed
// over 15 cm along the row, found on the image being measured and on no number
// of this world -- taken to the plane y = 0 through POSE_VOX_DAY; and inside
// that pair, the spatial centroid of the pale stone and the spatial centroid of
// stone and earth together. Three estimates of one axis that fail in different
// ways, and their disagreement is the reading's own error bar.
// fondazione/lav/s5-asse.py.
//
// WHAT THE PICTURE CAN AND CANNOT SEE. North of z = -3.6 the reference's own
// staircase is in the way: projected on the ground plane its lowest riser meets
// the earth at z = -4.0, eight metres south of where layout.js puts ours, so
// every row past that reads worked stone and not corridor. Nine of the 42 rows
// the old fit stood on were those rows, which is why its far end landed where it
// did. South of z = +9.35 there is no more picture. Inside that window the
// walker hides the west verge over two short stretches and the panel hides the
// east verge under itself; those rows are read past or skipped, and which is
// which is written in the bench.
//
// THE ERROR BAR IS MEASURED AND NOT POSTULATED. The same ruler turned on a
// render of THIS world, where the axis is arithmetic and not a reading, comes
// back 0.092 m rms per row -- the 0.101 U-SENT-3 measured, reproduced -- and no
// better than 0.04 m on a band however many rows go into it, because the verge
// wanders over a whole block of grass at a time and that does not average away.
// Those two numbers weight the reading below, and they are why the curve is the
// STIFFEST one that stays within two sigma of every measured point rather than
// the one that runs through them: at chi squared per degree of freedom of one
// the curve chases seven-centimetre humps, which is one sigma of the reading,
// and a law that carries those writes noise into a source file.
//
// THE FOUR TURNS, with where they sit and how tight they are:
//
//     z = -2.00   x = +0.665   R 1.90 m   round to the east
//     z = +0.75   x = +0.102   R 1.35 m   round to the west
//     z = +4.00   x = +0.757   R 1.79 m   round to the east
//     z = +8.25   x = -0.556   R 2.30 m   round to the west
//
// and the arcs between them are 0.56, 0.66 and 1.14 m of travel over 2.75, 3.25
// and 2.75 m of northing. The steepest the axis ever runs is 0.84 m of easting
// per metre of northing, at z = +6.9; the tightest radius anywhere is 0.91 m.
//
// THE TABLE IS THE MEASUREMENT AND THE TWO TAILS ARE NOT, and which is which is
// marked. Between z = -3.75 and +9.25 the entries are the measured curve sampled
// at the metre, and a natural cubic through them repeats that curve to 0.054 m
// -- half a voxel, and inside the reading's own error, so the sampling costs
// nothing the reading could have told apart.
const PATH_CENTRE = [
  // NOT MEASURED. The staircase covers these rows. The far end is held at
  // STAIRS.x -- E-SENT3's anchor, and the one number here this unit did not
  // read -- and what runs between it and the first measured row is a straight
  // line between the two, which the spline rounds off at both ends.
  [-14.30, 0.250],
  [-12.14, 0.250],
  [-8.00, 0.375],
  // MEASURED, off farfield-day-voxel-target.png through the fitted camera:
  // 217 rows gathered into 32 bins of 0.4 m of northing. fondazione/lav has the
  // bench: s5-asse.py reads a row, s5-curva.py makes the curve, s5-tavola.py
  // samples it here.
  [-3.75, 0.504],
  [-2.75, 0.529],
  [-1.75, 0.678],
  [-0.75, 0.415],
  [0.25, 0.211],
  [1.25, 0.168],
  [2.25, 0.454],
  [3.25, 0.589],
  [4.25, 0.771],
  [5.25, 0.570],
  [6.25, 0.475],
  [7.25, -0.259],
  [8.25, -0.556],
  [9.25, -0.427],
  // NOT MEASURED. Past the bottom of the frame, and it is the arc the last
  // measured rows are in, continued and let go: the slope at the last knot,
  // +0.203 m per metre, relaxed over the 3.5 m of northing the reference's own
  // arcs run for. The corridor finishes the turn it is in and settles at +0.33
  // rather than ruling off in a straight line or stopping dead at a kink. The
  // spawn in layout.js stands on it.
  [11.00, -0.129],
  [13.00, 0.072],
  [16.00, 0.222],
  [22.00, 0.313],
];

/**
 * The second derivatives of the natural cubic through PATH_CENTRE, solved once
 * at load and never again.
 *
 * A NATURAL CUBIC AND NOT A CATMULL-ROM. Three readers care about this line's
 * CURVATURE and not only its position -- how far off the axis a point stands,
 * which is a foreshortening by the local normal; how wide the strip's frame has
 * to reach; and the eye, at a turn -- and a Catmull-Rom's second derivative
 * jumps at every knot it passes. This one is continuous everywhere, has no cusp
 * anywhere, and passes THROUGH the measured values rather than near them.
 *
 * AND THE NATURAL END CONDITION IS WHAT MAKES THE OUTSIDE BEHAVE. The second
 * derivative is nought at both ends of the table, so the curve is already
 * straight when it arrives there and the linear continuation below joins it with
 * the same value, the same slope AND the same curvature. Nothing built from this
 * line meets a kink at either end.
 */
const PATH_CENTRE_D2 = (() => {
  const n = PATH_CENTRE.length;
  const h = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) h[i] = PATH_CENTRE[i + 1][0] - PATH_CENTRE[i][0];
  const m = new Float64Array(n);
  const c = new Float64Array(n);
  const d = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const a = h[i - 1];
    const b = 2 * (h[i - 1] + h[i]);
    const rhs = 6 * ((PATH_CENTRE[i + 1][1] - PATH_CENTRE[i][1]) / h[i]
      - (PATH_CENTRE[i][1] - PATH_CENTRE[i - 1][1]) / h[i - 1]);
    const den = b - a * c[i - 1];
    c[i] = h[i] / den;
    d[i] = (rhs - a * d[i - 1]) / den;
  }
  for (let i = n - 2; i >= 1; i--) m[i] = d[i] - c[i] * m[i + 1];
  return m;
})();

/** Which span of PATH_CENTRE a northing falls in, clamped to the two ends. */
function pathSpan(z) {
  let lo = 0;
  let hi = PATH_CENTRE.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (z >= PATH_CENTRE[mid][0]) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** How fast the axis moves east per metre of northing. */
export function pathCentreSlope(z) {
  const i = pathSpan(z);
  const z0 = PATH_CENTRE[i][0];
  const z1 = PATH_CENTRE[i + 1][0];
  const h = z1 - z0;
  const zc = z < z0 ? z0 : z > z1 ? z1 : z;
  const a = (z1 - zc) / h;
  const b = (zc - z0) / h;
  return (PATH_CENTRE[i + 1][1] - PATH_CENTRE[i][1]) / h
    + ((1 - 3 * a * a) * PATH_CENTRE_D2[i] + (3 * b * b - 1) * PATH_CENTRE_D2[i + 1]) * h / 6;
}

/**
 * Where the corridor's axis stands at a northing, in metres of easting.
 *
 * Beyond the table it continues in a straight line with the slope it arrives
 * at, which is the curve's own continuation and not a second law: the natural
 * end condition has already brought its curvature to nought there.
 */
export function pathCentreX(z) {
  const last = PATH_CENTRE.length - 1;
  if (z < PATH_CENTRE[0][0] || z > PATH_CENTRE[last][0]) {
    const end = z < PATH_CENTRE[0][0] ? 0 : last;
    const ze = PATH_CENTRE[end][0];
    return PATH_CENTRE[end][1] + pathCentreSlope(ze) * (z - ze);
  }
  const i = pathSpan(z);
  const z0 = PATH_CENTRE[i][0];
  const z1 = PATH_CENTRE[i + 1][0];
  const h = z1 - z0;
  const a = (z1 - z) / h;
  const b = (z - z0) / h;
  return a * PATH_CENTRE[i][1] + b * PATH_CENTRE[i + 1][1]
    + ((a * a * a - a) * PATH_CENTRE_D2[i] + (b * b * b - b) * PATH_CENTRE_D2[i + 1])
    * h * h / 6;
}

/**
 * How far a point stands from the axis, in metres, measured ALONG THE LOCAL
 * NORMAL and not along a row of the world. Signed: east of the axis is positive.
 *
 * WHY IT IS NOT (x - centre), WHICH IS WHAT EVERY READER USED TO ASK FOR. On a
 * straight axis the two are the same number. On a curved one they are not: at
 * the steepest turn the axis runs 0.84 m of easting per metre of northing, and a
 * corridor whose EASTING extent is held constant there has a perpendicular width
 * of 0.77 of it -- so a path of one width would draw itself a quarter narrower
 * at exactly the four places the eye is watching it turn. Dividing by the secant
 * of the local slope holds the width across the whole run and lets the easting
 * extent open where the corridor runs diagonally, which is what a path of
 * constant width does.
 *
 * It is the first-order perpendicular distance and not the exact one, and what
 * the difference costs is set by the radius of curvature: at the tightest turn,
 * R = 0.91 m, a point one half width out lands 3 cm from where the exact foot of
 * the normal would put it -- a third of a voxel, on a corridor whose own edge is
 * allowed to wander fourteen centimetres.
 */
export function pathOffset(x, z) {
  const s = pathCentreSlope(z);
  return (x - pathCentreX(z)) / Math.sqrt(1 + s * s);
}

// THE STRIP'S FRAME, WHICH IS NOT THE AXIS AND NO LONGER PRETENDS TO BE.
//
// The paving is drawn out of two maps carried in a ribbon along the run, and the
// fragment that reads them has to solve where a point falls ACROSS that ribbon.
// It cannot call this file, so it mirrors a smoothstep between two northings out
// of four uniforms -- which is exactly the shape that has just fallen, and a
// meander is not in its reach. Rewriting that mirror to carry a twenty-one knot
// spline puts a spline in a fragment shader; the other way is to stop asking the
// ribbon to BE the axis and ask it only to CONTAIN the corridor, which costs
// texels and no arithmetic at all.
//
// AND THE TEXELS ARE CHEAPER HERE THAN THEY LOOK, BECAUSE THE RIBBON HAD TO
// GROW ANYWAY. Measuring the offset along the normal opens the corridor's
// EASTING extent by the secant of the slope -- 1.31 at z = +6.9 -- so a ribbon
// that followed the axis exactly would already need a half of 1.32 m against the
// 1.25 it has, and 1.25 was short even before this unit: pathHalfWidth reaches
// 1.20 in the flare at the stair, pathEdge 1.32 with its wobble, and the strip
// has been clipping the outer three centimetres of the flare since the width was
// refitted. What the straight frame costs on top of that is 18 cm.
//
// The four numbers are fitted to the curve above by minimising the worst case of
// |curve - frame| plus the paving's own reach in easting, over the whole
// northing the paving lives on (fondazione/lav/s5-telaio.mjs, s5-tel3.mjs): the
// frame runs 0.51 m from the axis at its worst and the ribbon needs a half of
// 1.506 m. See PATH_SKIN in src/world/path.js.
//
// The field names in PATH_LINE below are the ones the uniform is built out of
// and they are historical: they were the two ends of the centreline back when
// the centreline was a ramp between them.
const PATH_FRAME_Z0 = 0.5;
const PATH_FRAME_Z1 = 8.5;
const PATH_FRAME_X0 = 0.55;
const PATH_FRAME_X1 = -0.05;

/** Where the strip's frame stands. The painter's line, and the fragment's. */
export function pathFrameX(z) {
  const t = smoothstep(PATH_FRAME_Z0, PATH_FRAME_Z1, z);
  return PATH_FRAME_X0 + (PATH_FRAME_X1 - PATH_FRAME_X0) * t;
}

/**
 * The frame's four numbers, published for the fragment that mirrors it.
 *
 * GLSL cannot call JavaScript, so the four travel as a uniform and the shader
 * solves the same smoothstep rather than carrying a strip coordinate on a
 * vertex: a coordinate baked into a vertex would be a second opinion about where
 * the frame is, on a mesh that is rebuilt every time the disc is laid.
 */
export const PATH_LINE = {
  stairZ: PATH_FRAME_Z0, nearZ: PATH_FRAME_Z1, stairX: PATH_FRAME_X0, nearX: PATH_FRAME_X1,
};

// Where the STONE stops, and it is now the bottom of the run.
//
// IT WAS FIVE METRES SHORT OF THE STEP, ON A READING OF THE NIGHT PICTURE. The
// paving died at z = -9.1 and the meadow covered the join; the northing was
// marched against the night target, where the last stone reads there. The DAY
// target says the opposite and says it plainly (A §1.3, crop A-04): the paving
// arrives at the bottom step. The committente's word on the two readings is
// E-DECISIONI7 A6 -- the day picture is the one that judges -- so the stone runs
// to the stair.
//
// AND IT IS DERIVED AND NOT TYPED. The bottom riser's south face is where the
// last tread ends, which is the run's own arithmetic in src/world/stairs.js:
// STAIRS.z is the north end of the top tread and each of the six is one tread
// deep. A literal here would be that sum copied, and a copy is what goes stale
// the day the run is refitted.
//
// AND THIS NORTHING IS NOW THE ONE THE AXIS IS ANCHORED AT. The paragraph that
// stood here said the axis POINTED at the stair through the far end of a ramp,
// and that the free fit of that ramp landed 1.5 cm from where the stair stands.
// The ramp is gone and so is that agreement: the nine rows that carried the far
// end of the fit were reading the reference's own staircase, which is eight
// metres nearer the eye than ours (see PATH_CENTRE above). What survives is the
// ANCHOR and not the corroboration -- the axis is held at STAIRS.x from here
// north because a corridor has to arrive at the steps, and the picture cannot
// see that stretch to say otherwise.
//
// AND IT IS PUBLISHED NOW, because the generator needs this same northing and
// must not sum it again: the paving stands at the meadow's own floor over the
// last stretch before this line, so the stone a walker steps off meets the
// lowest riser instead of a tenth of a metre under it. See PATH.lift in
// src/world/voxel/worldgen.js.
export const PATH_STONE_END_Z = STAIRS.z + STAIRS.tread * STAIRS.steps;
// How quickly the run lets go at the south end, in metres.
//
// A FINGER'S WIDTH, AND IT USED TO BE 2.8 m. The fade existed because the stone
// ended in the middle of a meadow and something had to cover the join; it ends
// at a riser now, and a corridor that faded out over nearly three metres would
// take the last three metres of paving off the ground the reference shows paved.
// It is not nought only because pathRun is a smoothstep and a smoothstep of zero
// width has no value at its own edge.
const PATH_STONE_FADE = 0.10;

// THE CORRIDOR HAS NO RELIEF OF ITS OWN, and the four centimetre-sized numbers
// that gave it one are gone rather than tuned to nought.
//
// They were a pan of 0.05 m and a swell of 0.06 m over the width of the strip:
// half a voxel and six tenths of one, which after quantising to the ten
// centimetre step barely exist. Marched against the reference (A §2.2), of the
// 0.914 m between the corridor under the walker's feet and the foot of the
// nearest block, this relief could move AT MOST 0.05 m -- five per cent. The
// other ninety five was the meadow. The corridor never was a trench, and the
// numbers that pretended it was could not have made one.
//
// What the reference does show is the stone level with the ground and the grass
// standing one to two voxels proud of it (A §1.3), and that is now a
// consequence of the plane rather than a term: the corridor's surface is laid
// on this field, the meadow's cubes stand one step above it, and neither of
// them is tilted by anything.

// The axis the turf's long blades are measured from: the path's centreline,
// shifted a third of a metre.
//
// AND WHAT IT IS FOR HAS BEEN DECIDED. It was cut here as a groove for a
// rivulet, on a reading of the reference the committente has since ruled wrong:
// the pale stretch down the middle of the path is light on stone, not water. The
// groove, the ribbon and the damp band went with that ruling and the pan of the
// path is one surface across its whole width. The offset survived, with one
// reader — the turf law in tools/turf/turf-rule.mjs — and no reason, waiting for
// whoever owns the S3/S4 contract to say what the long grass was for.
//
// It is for the verges of the path. The longest blades in the whole frame are
// where the meadow meets the stone, and that is a MEASUREMENT off the reference,
// taken before any story was told about why: the band was fitted to the picture,
// and it kept fitting after the water it was attributed to turned out not to
// exist. So the line stays exactly where the fit put it and the number does not
// move — what changes is only the reason written beside it. Note what it is and
// is not: a line PARALLEL to the path's axis, a third of a metre off it, which
// is inside the stone; the band the turf law hangs on it is several metres wide
// and reaches well out into the meadow either side. It is the axis the verges are
// symmetric about, not the edge of anything.
//
// Re-cutting it would still be a change to that contract rather than a tidy-up —
// the canopy is baked into the sky term and the hummocks are what the sun's
// weight was anchored on — which is the other reason the number is untouched.
export const VERGE_OFFSET = 0.34;

// THE WIDTH OF THE CORRIDOR IS THE REFERENCE'S OWN TAPER, MEASURED, and it is
// a table of northings rather than a slope with two coefficients.
//
// WHAT WAS HERE, AND WHY IT COULD NOT STAY. A straight ramp, 0.3844 + 0.013949
// per metre of northing, clamped at both ends: one width at the stair and a
// wider one at the near edge of the frame, monotone all the way. Marched across
// the reference row by row on the plane the fitted camera puts at nought, the
// corridor does not do that at all. It is TWENTY VOXELS wide under the walker's
// own feet, closes hard to eight or ten in the middle of the field, and opens
// again to TWENTY FOUR in an apron in front of the bottom step. A monotone slope
// can reproduce none of those three, and the one it came closest to was the
// middle.
//
// THE READING, in metres of full width -- stone and the bare verges either side
// of it -- with the voxels it comes to at the ten centimetre step:
//
//     z = +9.3   1.97 m   20      z = +4.2   1.19 m   12
//     z = +9.1   1.95 m   20      z = +1.5   0.83 m    8
//     z = +8.1   1.61 m   16-18   z = -1.5   0.98 m   10
//     z = +7.4   1.66 m   17-19   z = -5.5   2.43 m   24
//     z = +5.9   0.77 m    8
//
// Re-taken here with a bench of this unit's own (fondazione/lav/largh2.py), on
// the same camera and the same greenness that separates meadow from ground: the
// near rows come back 1.97 m and 1.97 m -- the same two figures to the
// centimetre -- and the apron reads wider still. The middle of the field is
// where a row is hardest to read and where the two benches scatter most, and the
// reading there is a BAND and not a curve.
//
// SO THE LAW CARRIES THE SHAPE AND THE EDGE CARRIES THE SCATTER. Ten voxels
// through the middle, with pathEdge's own nineteen per cent of wobble either
// side of it, IS eight to twelve -- the band the reference is read at, arriving
// as the irregularity it was measured as rather than as a curve fitted through
// noise. Nothing was added to buy it.
//
// AND IT IS HALF WIDTHS IN METRES, MEASURED ACROSS THE CORRIDOR. They were the
// same thing as half widths in easting while the axis ran north; they are not
// any more, and pathCoord below divides an offset taken along the local normal
// by these, so the corridor keeps this width through a turn instead of drawing
// itself narrower there.
//
// AND THE WAIST IS GONE, WHICH IS THE COMMITTENTE'S OWN READING AND A
// MEASUREMENT (E-DECISIONI11.4: «ancora troppo stretto: misurando in lontananza
// la prospettiva lo stringe, ma la larghezza resta piu' o meno la stessa per
// tutto il sentiero: verifica»).
//
// VERIFIED, AND HE IS RIGHT. The width above was read as a count of voxels along
// rows of the picture -- a reading in PIXELS that the perspective is still in.
// Taken instead in metres of world on the plane the fitted camera puts at
// nought, with the ruler the two units before this one settled on -- the two
// crossings of half a share of green on each flank of the corridor, found on the
// picture being measured and not assumed (fondazione/lav/u4-largh.py) -- the
// reference and this world read:
//
//     z          +7.50   +6.15   +3.94   +1.89
//     TARGET      1.19    1.22    1.46    1.57 m
//     ours        1.13    0.95    0.79    0.80 m
//     the law     1.57    1.06    1.00    1.00 m
//
// The reference does not narrow down the run at all: it holds 1.2 m through the
// middle of the field and OPENS toward the far end. Ours halves. The eight to
// twelve voxels the reading above found in the middle of the field are the
// STONE CORE and not the corridor -- U-SENT-2 measured that the reference's
// paving is never more than half stone even in its own middle and that its earth
// runs a metre and a half past the kerb -- so a ruler that stops at the pale
// stone stops inside the corridor, and it did.
//
// WHAT MOVES IS THE WAIST AND NOTHING ELSE. The near end (the apron the walker
// stands on) and the flare in front of the bottom step are both read where the
// reference shows them and both stay. The middle of the field goes from 0.50 to
// 0.78 of a half width and the far stretch to 0.86, which puts the law at 1.56
// and 1.72 m -- the reference's own 1.2 and 1.5 plus the two tenths of a metre
// the mat of grass covers at the kerb, measured on our own render at the same
// ruler. The stone core inside it is still eight to twelve voxels, because
// SPREAD in ../path.js is a fraction of THIS number and the crossing moves out
// with it.
const PATH_WIDTH = [
  [12.0, 1.00],
  [9.1, 1.00],
  [8.1, 0.90],
  [6.0, 0.83],
  [-3.0, 0.92],
  [-5.5, 1.20],
  // The far end is the stair's own northing, read from layout.js rather than
  // typed: PATH_STAIR_Z used to hold this number as one end of a ramp, and the
  // ramp is gone.
  [STAIRS.z, 1.20],
];

export function pathHalfWidth(z) {
  const t = PATH_WIDTH;
  if (z >= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (z >= t[i][0]) {
      const f = (z - t[i][0]) / (t[i - 1][0] - t[i][0]);
      return t[i][1] + (t[i - 1][1] - t[i][1]) * f;
    }
  }
  return t[t.length - 1][1];
}

/**
 * Half width including the irregularity of the edge, per side.
 * The centreline is fitted and stays put; only the edges wander, which is what
 * makes them bite into the grass instead of ruling a line across it.
 *
 * AND THE WOBBLE IS IN METRES NOW, WHICH IS THE SAME EDGE AND NOT A NEW ONE.
 * It was nineteen per cent of the half width, fitted when that half width was
 * 0.552 m and barely moved down the run. The width is the reference's own taper
 * now and it runs from ten voxels in the middle of the field to twenty four in
 * the apron: a fraction of it would have made the edge of the apron wander by a
 * quarter of a metre, which is a ragged edge on the corridor's widest stretch
 * and not the one that was measured. So the term is stated in the ground's own
 * units at the value it was fitted at -- 0.19 x 0.552 = 0.105 m -- and through
 * the middle of the field, where it was fitted, it is the function it was to
 * within a millimetre.
 */
export function pathEdge(z, side) {
  const wobble = snoise(z * 0.33 + (side >= 0 ? 51.7 : 7.3), 3.1);
  return pathHalfWidth(z) + 0.105 * wobble + 0.0434 * snoise(z * 0.91 + side * 13.0, 8.4);
}

/**
 * Signed distance from the corridor's axis, normalised so 1 is the edge.
 *
 * IT ASKS pathOffset AND NOT (x - centre), and the difference is the whole of
 * what a curved axis costs its readers: the numerator is now a distance along
 * the local normal, so what this returns is a fraction of the corridor's
 * PERPENDICULAR half width at every northing and not only where the axis
 * happens to run north.
 */
export function pathCoord(x, z) {
  const s = pathOffset(x, z);
  return s / pathEdge(z, s);
}

/**
 * How much path there is at this northing: 1 along the run, falling to 0 where
 * the stone ends and again at the south rim of the field.
 *
 * IT REACHES THE BOTTOM STEP, AND THE PARAGRAPH THAT SAID OTHERWISE WAS STALE.
 * The run used to be stopped at z = -9.1 on a reading of the NIGHT picture,
 * which leaves five metres of grass between the last stone and the stair. The
 * day picture says the paving arrives at the step, the day picture is the one
 * that judges, and PATH_STONE_END_Z above has been that step since -- so what
 * this function has actually answered for several steps now is a run that ends
 * at the lowest riser. The old reason was left written beside the new number,
 * which is the drift a comment is most dangerous for.
 */
export function pathRun(z) {
  return smoothstep(PATH_STONE_END_Z, PATH_STONE_END_Z + PATH_STONE_FADE, z)
    * (1 - smoothstep(23, 30, z));
}

// ------------------------------------------------------------- the meadow

/**
 * The one height of the walkable ground, in metres.
 *
 * WHY IT IS BELOW NOUGHT AND NOT AT IT, which is the whole of the derivation.
 * The reference puts the surface of the meadow at y = 0: the line falls on a
 * nosing at the foot of the stair to within 0.07 m, and the grass at the four
 * block feet stands on it with its blades one or two voxels over (A §1.1). What
 * the eye is given is not this field, though: columnTop in
 * src/world/voxel/mesher.js rounds it to a step and draws the TOP FACE of that
 * step, at (step + 1) * VOXEL. A field at nought would therefore hand the eye a
 * meadow a voxel high, standing over the feet of blocks that are pinned to
 * nought in layout.js and over the bottom riser of the stair.
 *
 * One voxel below nought is the value whose drawn face lands exactly on y = 0,
 * so the built stone meets the grass instead of wading in it.
 *
 * AND IT BUYS THE SECOND MEASUREMENT AT NO COST. The corridor's surface is laid
 * on this field and the meadow's cubes stand on the face above it, so the grass
 * beside the stone stands one voxel proud of it -- which is what the reference
 * measures along the whole run (A §1.3), and which used to be asked of two
 * centimetre-sized terms that could not deliver it.
 */
export const BASE_LEVEL = -0.10;

// The stairs and the platform are the one built thing on this ground, and the
// meadow has to keep clear of them. It no longer takes levelling to do that --
// the ground under them is the plane, as it is everywhere -- but WHERE the
// built run stands is still a fact the turf rule reads off this file, so the
// extent stays and only the levelling has gone.
export const APPROACH = {
  x: STAIRS.x,
  // Between the bottom step and the back of the platform, so the whole built
  // run is covered and the meadow closes in again well before it reaches the
  // blocks either side.
  z: (PLATFORM.z + STAIRS.z) / 2 - 0.1,
  inner: 4.2,
  outer: 9.0,
};

/**
 * Height of the ground at a point, in metres.
 *
 * A CONSTANT, AND THE SIGNATURE IS KEPT ON PURPOSE. Fifteen files in src and
 * tools ask this question, and they are moved to the block store one at a time
 * rather than all at once; a function that still answers for a point is what
 * lets them be moved without any of them changing today.
 *
 * WHAT USED TO BE HERE, so that nobody looks for it: three octaves of value
 * noise summed to +/-0.65 m, four mounds of 0.44 to 0.95 m, a ridge and a seat
 * at each of the four blocks standing in grass, a 0.25 m rise around the rim of
 * the disc, the pan and the swell of the corridor, two passes that lifted the
 * ground to meet a block and levelled it under the stair, and the turf's own
 * hummocks. Every one of them was relief the reference does not have.
 */
export function heightAt() {
  return BASE_LEVEL;
}

// ------------------------------------------------------------- what is gone
//
// THE BENT GRID AND THE WALKER'S OWN SHEET, AND NEITHER LEFT A READER BEHIND.
//
// GRID, gridToOffset, offsetToGrid, uvToWorld and worldToUv described a square
// of 192 by 192 vertices bent by a power law so the rows crowded near the
// walker, and the atlas of the ground was bent with it. The mesh that used them
// was src/world/terrain.js and it is retired at this step: the meadow is cubes
// out to the tier's radius, a sheet from there to a hundred metres, and the
// corridor is columns of the disc. Nothing in src reads the bend now.
//
// FIELD was a 72 m square sampled every 0.28125 m for the walker to stand on. It
// lost its last reader when the contract began reading the block store, and
// A 2.6 had already recorded that it had none.
//
// THE SEVEN TOOLS THAT STILL ASK FOR THE BEND are the outer chain, and they are
// step 8's by A 4.6: tools/terrain/build-mesh.mjs:8, tools/terrain/lib/
// pattern.mjs:8, tools/terrain/ground-shading.mjs:6, tools/lighting/
// shadow-bearing.mjs:4, tools/lighting/staircase.mjs:5, tools/terrain/probe.mjs:5
// and tools/turf/turf-rule.mjs:5. Every one of them paints or measures the atlas
// the meadow no longer wears. They are listed here so that the day one of them
// is run, what is missing has a name and a reason.
