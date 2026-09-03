import {
  AREA_CENTER, PLATFORM, STAIRS,
} from './layout.js';

// The shape of the ground, as arithmetic.
//
// This is the single definition of where the ground is. The Blender scene that
// bakes the terrain reads it through tools/terrain/export-heightfield.mjs, the
// runtime mesh is built from the same numbers, and the player walks on a grid
// sampled from it. Nothing else is allowed to have an opinion about the height
// of a point, or the walker and the picture stop agreeing.
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

// Where the path runs, in metres. Both numbers are read off the reference at
// the target pose and then expressed in world space: the centreline passes
// under the walker a little west of the axis and straightens as it reaches the
// stairs, and the strip narrows with distance the way the reference shows.
const PATH_STAIR_Z = -14.3;
const PATH_NEAR_Z = 8.8;
const PATH_STAIR_X = 0.25;
const PATH_NEAR_X = -0.74;

/**
 * The centreline's four numbers, published.
 *
 * THE FRAGMENT THAT PAINTS THE PAVING HAS TO SOLVE THIS LINE, and GLSL cannot
 * call JavaScript. So the four travel as uniforms and the shader mirrors
 * pathCentreX below rather than carrying an attribute: the paving is the top of
 * a column of the meadow's own store now, and a strip coordinate baked into a
 * vertex would be a second opinion about where the centreline is, on a mesh that
 * is rebuilt every time the disc is laid.
 */
export const PATH_LINE = {
  stairZ: PATH_STAIR_Z, nearZ: PATH_NEAR_Z, stairX: PATH_STAIR_X, nearX: PATH_NEAR_X,
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
// THE OTHER NORTHING STAYS WHERE IT IS. pathCentreX reads PATH_STAIR_Z as one
// end of its ramp -- a fact about where the path POINTS -- and the two targets
// give no base for moving that line. The two were separated for that reason and
// they stay separated.
const PATH_STONE_END_Z = STAIRS.z + STAIRS.tread * STAIRS.steps;
// How quickly the run lets go at the south end, in metres.
//
// A FINGER'S WIDTH, AND IT USED TO BE 2.8 m. The fade existed because the stone
// ended in the middle of a meadow and something had to cover the join; it ends
// at a riser now, and a corridor that faded out over nearly three metres would
// take the last three metres of paving off the ground the reference shows paved.
// It is not nought only because pathRun is a smoothstep and a smoothstep of zero
// width has no value at its own edge.
const PATH_STONE_FADE = 0.10;

export function pathCentreX(z) {
  const t = smoothstep(PATH_STAIR_Z, PATH_NEAR_Z, z);
  return PATH_STAIR_X + (PATH_NEAR_X - PATH_STAIR_X) * t;
}

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
// AND IT IS HALF WIDTHS IN METRES, so pathCoord and pathEdge below are unchanged
// in shape and in every reader: what moved is the number they scale.
const PATH_WIDTH = [
  [12.0, 1.00],
  [9.1, 1.00],
  [8.1, 0.90],
  [6.0, 0.50],
  [-3.0, 0.50],
  [-5.5, 1.20],
  [PATH_STAIR_Z, 1.20],
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

/** Signed distance from the path centreline, normalised so 1 is the edge. */
export function pathCoord(x, z) {
  const s = x - pathCentreX(z);
  return s / pathEdge(z, s);
}

/**
 * How much path there is at this northing: 1 along the run, falling to 0 where
 * the stone ends and again at the south rim of the field.
 *
 * IT DOES NOT REACH THE STAIRS, AND THAT IS THE READING AND NOT AN OVERSIGHT.
 * The paving used to be run down to the bottom step at -14.3 on the assumption
 * that stone met stair. The night target puts its last stone at -9.1 and leaves
 * the five metres to the step under grass — so the run ends there, and what
 * covers the join is the meadow, which is already what grows wherever this
 * answers nought.
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

// ------------------------------------------------------------------- the grid

/**
 * The ground mesh, and the sheet of texture wrapped on it.
 *
 * One surface has to be both the floor under the walker's feet and the meadow
 * that reaches the water, which is two very different demands on resolution. It
 * is done by spacing the vertices unevenly: the grid is uniform in its own
 * index space and that space is bent by a power law on the way to metres, so
 * the rows crowd together near the walker and spread out towards the rim.
 *
 * The texture coordinate is the index, not the position, so the atlas is bent
 * the same way and spends its resolution where the eye is.
 */
export const GRID = {
  // Vertices per side. The cost is vertex work, which is not what an integrated
  // GPU runs out of; what matters is that the near ground is dense enough to
  // carry the lip along the path.
  samples: 192,
  // Half extent in metres. Far enough that the rim is already extinguished by
  // the fog rather than drawing a line across the frame.
  half: 100,
  // Above 1 crowds the vertices towards the centre. At 2.2 the walkable area
  // takes about two thirds of the grid and two thirds of the atlas.
  bend: 2.2,
  centreX: AREA_CENTER.x,
  centreZ: AREA_CENTER.z,
};

/** Normalised grid coordinate in -1..1 to metres from the centre. */
export function gridToOffset(t) {
  return Math.sign(t) * Math.abs(t) ** GRID.bend * GRID.half;
}

/** Metres from the centre back to the normalised grid coordinate. */
export function offsetToGrid(metres) {
  const t = Math.abs(metres) / GRID.half;
  return Math.sign(metres) * t ** (1 / GRID.bend);
}

/** World position of a texture coordinate, both in 0..1. */
export function uvToWorld(u, v) {
  return {
    x: GRID.centreX + gridToOffset(u * 2 - 1),
    z: GRID.centreZ + gridToOffset(v * 2 - 1),
  };
}

/** Texture coordinate of a world position, both in 0..1. */
export function worldToUv(x, z) {
  return {
    u: (offsetToGrid(x - GRID.centreX) + 1) / 2,
    v: (offsetToGrid(z - GRID.centreZ) + 1) / 2,
  };
}

/** Extent of the walker's height grid, in metres; outside it the field is flat. */
export const FIELD = {
  centreX: AREA_CENTER.x,
  centreZ: AREA_CENTER.z,
  size: 72,
  spacing: 0.28125,
};

FIELD.samples = Math.round(FIELD.size / FIELD.spacing) + 1;
FIELD.originX = FIELD.centreX - FIELD.size / 2;
FIELD.originZ = FIELD.centreZ - FIELD.size / 2;
