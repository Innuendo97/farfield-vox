import {
  AREA_CENTER, MONOLITHS, PLATFORM, SPAWN, STAIRS,
} from './layout.js';
import { turfRise } from './turf.js';

// The shape of the ground, as arithmetic.
//
// This is the single definition of where the ground is. The Blender scene that
// bakes the terrain reads it through tools/terrain/export-heightfield.mjs, the
// runtime mesh is built from the same numbers, and the player walks on a grid
// sampled from it. Nothing else is allowed to have an opinion about the height
// of a point, or the walker and the picture stop agreeing.
//
// The ground cannot be flat, and the reason is visible in the reference: the
// feet of the monoliths are swallowed by grass, the path runs in a shallow
// trench between two raised lips, and the meadow rolls enough to catch light on
// one flank and lose it on the other. A plane cannot do any of that.

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

// Where the STONE stops, which is not where the stairs are.
//
// These were one number, and they are two facts. The paving was run down to the
// bottom step because nothing had been measured about where it ends; marched
// against the night target it ends at z = -9.1, five metres short of the step,
// and it is the meadow that covers the join. So the northing the centreline's
// ramp is anchored at — a fact about where the path POINTS — and the northing
// the stone dies at are stated separately.
//
// They have to be, and not only for tidiness: pathCentreX reads PATH_STAIR_Z as
// one end of its ramp, and the two targets give no base for moving that line —
// they put the corridor at the same place in the FRAME and a metre apart in the
// WORLD. Spending PATH_STAIR_Z on where the stone ends would have moved the
// centreline as a side effect of a measurement that says nothing about it.
const PATH_STONE_END_Z = -9.1;
// The length of the fade out, carried over unchanged from when it hung on the
// stair: what moved is where the stone ends, not how quickly it lets go.
const PATH_STONE_FADE = 2.8;

export function pathCentreX(z) {
  const t = smoothstep(PATH_STAIR_Z, PATH_NEAR_Z, z);
  return PATH_STAIR_X + (PATH_NEAR_X - PATH_STAIR_X) * t;
}

// Relief of the path, in metres. Everything here is centimetres on purpose:
// these five numbers are the whole difference between stone bedded in a meadow
// and a gully with the stone at the bottom of it.
//
// PATH_LIP_FROM/TO are in units of the half width, so the swell is always
// proportional to the strip — and the strip has just been divided by 1.613 to
// land on the width the targets measure, which means the swell came with it.
// AND THAT IS A REAL CONSEQUENCE, NOT A ROUNDING. Over the live run the lip is
// now spread over 0.47 to 0.78 m of ground where it used to have 0.75 to 1.25,
// so the steepest part of the side of the path — the pan coming back up and the
// lip going over, crossed at right angles — went from about 40% to about 64% at
// the middle of the run (v0-fondazione/campo/camminata.mjs, measured on the
// path's own relief with the turf's hummocks held out of it). Eleven
// centimetres of sink and swell over a fifth of a metre is a kerb rather than a
// bank, and it is only ever crossed sideways: nothing along the run moved, and
// the walk down the centreline is the same walk to the millimetre. It is
// written down here rather than tuned away because PATH_SINK and PATH_LIP are
// measured centimetres and this unit was given the width, not the relief.
const PATH_SINK = 0.05;
const PATH_LIP = 0.06;
const PATH_LIP_FROM = 0.95;
const PATH_LIP_TO = 2.05;

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

// EVERY NUMBER BELOW IS THE ONE THAT WAS HERE DIVIDED BY 1.613, AND THAT FACTOR
// IS A MEASUREMENT AND NOT A TASTE.
//
// Marched down the run on both targets, the full width of the corridor has a
// median of 1.14 m (day, 75 valid rows) and 1.10 m (night, 161 rows); over
// exactly those rows this law's own weighted mean was 1.807 m. The strip was
// 1.6 times wider than the picture it copies, which is the whole of what the
// measurement says.
//
// AND THE SCALE IS ALSO ALL IT SAYS. Over the seven metres of run the targets
// can be read on, the measured width scatters by a third of a metre from row to
// row and carries no trend at all — so the SHAPE of this law is neither
// supported nor refuted there, and moving it would be inventing. The taper it
// keeps was fitted against the close reference of the paving, which nothing in
// this measurement touches: at twelve metres out the stone reaches further from
// the centreline than the near end of the old slope allowed, and that reading
// still stands, one sixth of a metre narrower.
//
// WHERE IT LANDS, at the two rows the day target reads with every sample valid:
// half width 0.552 m at z = 0 and 0.566 m at z = 1, which is the 0.55-0.57 the
// median asks for.
export function pathHalfWidth(z) {
  const w = 0.3844 + 0.013949 * (z + 12);
  return w < 0.3596 ? 0.3596 : w > 0.7751 ? 0.7751 : w;
}

/**
 * Half width including the irregularity of the edge, per side.
 * The centreline is fitted and stays put; only the edges wander, which is what
 * makes them bite into the grass instead of ruling a line across it.
 *
 * THE SECOND TERM WAS DIVIDED BY THE SAME 1.613 AS THE WIDTH, and it had to be:
 * it is the one part of the edge stated in metres of ground rather than as a
 * fraction of the strip, so leaving it at seven centimetres on a strip a third
 * narrower would have made the ragged edge half again as ragged. Divided, this
 * function is the old one over one factor at every z — the same shape of edge,
 * on a narrower path — and pathCoord, which divides by it, is unchanged.
 */
export function pathEdge(z, side) {
  const wobble = snoise(z * 0.33 + (side >= 0 ? 51.7 : 7.3), 3.1);
  return pathHalfWidth(z) * (1 + 0.19 * wobble) + 0.0434 * snoise(z * 0.91 + side * 13.0, 8.4);
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

// --------------------------------------------------------------- the meadow

function mound(x, z, cx, cz, radius, height) {
  const d = Math.hypot(x - cx, z - cz) / radius;
  if (d >= 1) return 0;
  const t = 1 - d * d;
  return height * t * t;
}

// Ridges that swallow the feet of the monoliths.
//
// The reference shows grass cutting across every base, and that is the whole
// reason this terrain exists. It is done by raising the ground a couple of
// metres in front of each block rather than by sinking the block: the fitted
// silhouettes in layout.js are pinned to the reference framing, and moving one
// of them down would move its top edge with it.
const EYE = { x: SPAWN.x, z: SPAWN.z };

// The central block is left out: it stands on a platform at the head of the
// stairs, not in the grass, and burying its foot would bury the platform with
// it.
const GRASS_STANDING = MONOLITHS.filter((m) => m.baseY === 0);

const BASE_RIDGES = GRASS_STANDING.map((m) => {
  const dx = EYE.x - m.position.x;
  const dz = EYE.z - m.position.z;
  const length = Math.hypot(dx, dz) || 1;
  const depth = Math.max(m.size[0], m.size[2]) / 2;
  return {
    // Just in front of the block, on the side the walker sees.
    x: m.position.x + dx / length * (depth + 1.5),
    z: m.position.z + dz / length * (depth + 1.5),
    // Under the block itself, so it stands on a swell rather than on a table.
    seatX: m.position.x,
    seatZ: m.position.z,
    radius: depth + 3.4,
  };
});

// A block must meet the grass, never hover over it. The meadow dips below zero
// in places and the blocks are pinned to it by the reference fit, so the ground
// under each one is lifted to meet its foot rather than the other way round.
const SEATS = GRASS_STANDING.map((m) => ({
  x: m.position.x,
  z: m.position.z,
  radius: Math.max(m.size[0], m.size[2]) / 2 + 3.0,
  floor: 0.06,
}));

// The stairs and the platform are the one built thing on this ground, and all
// six steps have to stay legible. The meadow is levelled under them.
export const APPROACH = {
  x: STAIRS.x,
  // Between the bottom step and the back of the platform, so the whole built
  // run sits on level ground while the meadow closes in again well before it
  // reaches the blocks either side.
  z: (PLATFORM.z + STAIRS.z) / 2 - 0.1,
  inner: 4.2,
  outer: 9.0,
  floor: 0.02,
};

export function heightAt(x, z) {
  // Rolling meadow: three octaves, the longest carrying almost all of it. The
  // reference ground is barely modelled at all, it only has to stop reading as
  // a plane.
  let h = 0.42 * snoise(x * 0.055 + 17.3, z * 0.055 + 5.1);
  h += 0.17 * snoise(x * 0.13 + 11.3, z * 0.13 + 4.7);
  h += 0.06 * snoise(x * 0.31 + 3.1, z * 0.31 + 9.2);

  // Grassy swells on the east flank, where the reference puts them in front of
  // the rocks that arrive with the vegetation.
  h += mound(x, z, 11.0, 2.0, 5.2, 0.95);
  h += mound(x, z, 8.6, 7.6, 3.8, 0.52);
  h += mound(x, z, 14.2, -3.0, 5.6, 0.72);
  h += mound(x, z, -12.4, 3.6, 5.0, 0.44);

  for (const ridge of BASE_RIDGES) {
    h += mound(x, z, ridge.x, ridge.z, ridge.radius, 0.46);
    h += mound(x, z, ridge.seatX, ridge.seatZ, ridge.radius * 0.8, 0.22);
  }

  // The path: laid on the meadow, not cut into it.
  //
  // The reference shows stone almost level with the grass either side of it —
  // slabs bedded into the field, with the turf standing a finger's width proud
  // of them and nothing more. So the relief here is centimetres, not the
  // quarter metre a walkable trench would want: the pan drops by PATH_SINK, the
  // turf rises by PATH_LIP, and the lip is spread over more than half a metre
  // of ground so that it reads as a swell rather than as a bank.
  //
  // It exists only between the stairs and the south rim: north of the bottom
  // step the ground is meadow, and cutting the path through there would run it
  // straight under the central platform.
  const run = pathRun(z);
  if (run > 0) {
    const s = x - pathCentreX(z);
    const edge = pathEdge(z, s);
    const d = Math.abs(s) / edge;
    h -= run * PATH_SINK * (1 - smoothstep(0.70, 1.02, d));
    if (d > PATH_LIP_FROM && d < PATH_LIP_TO) {
      const t = (d - PATH_LIP_FROM) / (PATH_LIP_TO - PATH_LIP_FROM);
      h += run * PATH_LIP * Math.sin(Math.PI * t);
    }
  }

  // Beyond the walkable area the detail fades out and the ground settles, so
  // the transition ring welds onto the far plane without a seam. The rise is
  // deliberately slight: the reference shows flat meadow all the way to the
  // water, and anything more would lift the horizon.
  const radius = Math.hypot(x - AREA_CENTER.x, z - AREA_CENTER.z);
  h *= 1 - smoothstep(24, 34, radius);
  h += 0.25 * smoothstep(20, 32, radius);

  // Everything that stands on this ground has to keep meeting it. These two
  // passes come last, so nothing added above can sink a block or drown a step.
  for (const seat of SEATS) {
    const w = 1 - smoothstep(seat.radius * 0.45, seat.radius, Math.hypot(x - seat.x, z - seat.z));
    if (w > 0) h += w * Math.max(0, seat.floor - h);
  }

  const approach = 1 - smoothstep(APPROACH.inner, APPROACH.outer,
    Math.hypot(x - APPROACH.x, z - APPROACH.z));
  h += approach * (APPROACH.floor - h);

  // And the hummocks, last of all.
  //
  // Last because the field already holds its own gates: it is nought over the
  // path, nought against anything built, and faded out under the stair's apron,
  // so nothing here can be undone by it. Added rather than blended because a
  // hummock IS ground: the walker climbs it, the mesh carries it, and Cycles
  // casts the corner shadow the committente named off the same triangles. One
  // sheet, one height, three consumers — see src/world/turf.js.
  h += turfRise(x, z);
  return h;
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
