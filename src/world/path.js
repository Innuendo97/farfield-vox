import { groundHeightAt, groundHoleAt, groundLightAt } from './contracts.js';
import {
  GRID, clamp01, gridToOffset, heightAt, offsetToGrid, pathCentreX, pathCoord,
  pathEdge, pathHalfWidth, pathRun, smoothstep,
} from './terrain-field.js';

// THE CORRIDOR, AND IT IS A SURFACE OF ITS OWN FROM HERE ON.
//
// WHAT THIS REPLACES. The path used to be painted into the ground's albedo and
// lit by the ground's baked atlas: one mesh, one material, the stone and the
// meadow inseparable. That could not survive two of the things this chapter is
// judged on. The atlas is a legacy bake under a sun that has since moved, so the
// paving was lit by yesterday's afternoon; and the atlas is BENT, so a texel of
// it under the walker's own feet is four to fifteen millimetres of ground across
// the run and thirty-three to sixty-five along it -- which is why the middle of
// the path read as strokes rather than as stones. Both are properties of an
// atlas, and neither is a property of the paving.
//
// So the corridor is its own surface, with its own maps, lit ANALYTICALLY: the
// two terms of a flat face, computed by src/world/face-light.js from the normal
// this file already knows, and nothing fetched. There is no texel grid in a
// cosine.
//
// AND THE SEED IT IS BUILT ON IS src/world/path-strip.js, WHOLE. That file is
// the ground's, and its doctrine is this one's capital: the atlas's Nyquist
// limits what can be DRAWN, not what can be SAID. A texel that holds HOW FAR the
// nearest joint edge is reconstructs a POSITION between two samples, and a
// position interpolates -- so the frame draws an edge finer than the texel that
// told it where the edge was. Everything about the joints below is that idea, on
// a strip of the corridor's own.
//
// WHAT IS NOT HERE, DELIBERATELY.
//
// Where the path RUNS is not this file's: pathCentreX, pathHalfWidth, pathEdge
// and pathRun live in terrain-field.js and are read, never copied and never
// moved. The two targets draw the corridor at the same place in the FRAME and a
// metre apart in the WORLD, so they cannot say where the centreline goes, and a
// session that moved it on that evidence would be fitting the world to one
// picture. The stone dies at z = -9.1 because the field says so and the night
// target measured it, and this file inherits that rather than restating it.
//
// AND NEITHER IS THE MESH OR THE MATERIAL. Nothing here imports three, the sky
// or the air, and that is a property worth keeping rather than an accident: the
// painter that writes the maps and the guards that judge them are Node scripts,
// and the moment this file reaches src/core/sky.js it stops being readable
// outside a browser -- which would mean the shapes of the paving could only be
// measured through a render. What hangs the surface on the scene is
// src/world/layers/v3-sentiero.js, the same split the ground already has between
// path-strip.js and terrain.js.

// ---------------------------------------------------------------- the frame
//
// WHERE THE CORRIDOR'S STRIP LIES, and it is one seat because two things read
// it: the mesh, which hands every vertex its place on the strip, and the painter
// in tools/path/, which has to know which point of the world each of its texels
// is looking at. A strip painted against one frame and sampled against another
// is a strip that draws its joints somewhere else.
//
// IT IS IN PATH SPACE AND NOT IN WORLD SPACE, and it is worth saying why once
// more because the corridor is now a third of the width the strip that carried
// it before was cut for: the paving is a ribbon a metre across and forty long,
// and a square texture over the world would spend all but a fortieth of itself
// on meadow that has no joints in it. Laid along the run, every texel is on or
// beside the paving.
export const PATH_SKIN = {
  // Half a metre wider than the stone ever gets, and the half metre is spent
  // rather than rounded up to. pathHalfWidth() tops out at 0.7751 m, pathEdge()
  // adds up to 19% of that plus 4.34 cm of wander, so the paving can reach
  // 0.966 m from the centreline; the slabs that surface in the grass beyond the
  // verge reach a quarter of a metre past that. At 1.25 the strip's own edge
  // always stands in meadow, which is what lets the frame clamp at the border
  // instead of carrying a window: nothing out there is drawn.
  half: 1.25,
  // Both ends stand on ground with no paving drawn on it. The stone begins at
  // -9.1 and pathRun() has let go of it by 30, so a strip that stopped while the
  // paving was still live would draw a line ACROSS the run at a fixed northing
  // -- the family of defect guard-sentiero-bande exists to reject.
  z0: -12,
  z1: 31,
  // Texels across and along, and the SHAPE of this is a measurement.
  //
  // A distance field reconstructs the position of an edge to a fraction of a
  // texel, but it can only reconstruct an edge it SAMPLED: a joint narrower than
  // the texel pitch falls between two samples and vanishes rather than blurring.
  // So the pitch, and not the interpolation, sets the finest joint the strip can
  // carry. The joints of the reference run 0.8 / 1.7 / 3.5 / 9.1 cm at the
  // deciles (an/piombo.txt), and the pitch this size comes to -- 7.81 mm across
  // by 8.40 mm along -- holds everything from the first decile up.
  //
  // AND IT IS VERY NEARLY ISOTROPIC, which the seed's was not. The lattice is
  // turned off the world's axes, so its joints run at every bearing and the
  // pitch that matters is the same on both; the seed shipped 7.0 mm across and
  // 22.9 along because its strip had to cover fifty metres of a path twice this
  // wide. A narrower corridor buys the along axis back.
  size: [320, 5120],
  // AND THE TONE TRAVELS SEPARATELY, AT A QUARTER OF THAT.
  //
  // The two fields on this strip do not want the same pitch and they do not
  // compress the same way, and carrying them in one two-channel texture made
  // both pay for the other: measured with the delivery's own encoder, the pair
  // interleaved costs 1 407 kB, the ruler alone 630 and the tone alone 523, and
  // the tone reduced by four on each axis costs 101.
  //
  // The ruler's pitch is set by the finest joint that has to SURVIVE being
  // sampled -- 8 mm at the first decile -- and cannot come down. The tone is
  // PIECEWISE CONSTANT on pieces a hand across: what its pitch has to be finer
  // than is a piece and not a joint, and at 19.5 by 21.0 mm a piece of 15 cm is
  // eight texels across and the ramp a bilinear tap draws at a piece boundary is
  // half the width of the median joint drawn over it. Below that the ramp gets
  // wider than the joint and two pieces start borrowing each other's level,
  // which is the one thing the identity between slabs cannot survive.
  toneSize: [128, 2048],
};

/** How much ground one texel of a strip map covers, in metres: across, along. */
export function skinPitch(size = PATH_SKIN.size) {
  return [
    2 * PATH_SKIN.half / size[0],
    (PATH_SKIN.z1 - PATH_SKIN.z0) / size[1],
  ];
}

/**
 * Where a world point falls on the strip, both in 0..1.
 *
 * BUILT ON pathCentreX AND NOTHING ELSE, exactly as the seed is. pathCoord()
 * would have been the obvious thing to reach for and it is the wrong thing: it
 * divides by pathEdge(), which has a noise in it, so the frame would breathe in
 * and out with the wobble of the edge and the paving would swim along the run.
 * The centreline is fitted arithmetic with no noise anywhere in it, so this
 * mapping is smooth, and being smooth is what lets the frame interpolate it
 * across a quad and still get a defined mip.
 */
export function pathSkinUv(x, z) {
  return {
    u: (x - pathCentreX(z)) / (2 * PATH_SKIN.half) + 0.5,
    v: (z - PATH_SKIN.z0) / (PATH_SKIN.z1 - PATH_SKIN.z0),
  };
}

/** The world point a strip coordinate looks at. The painter's way round. */
export function skinToWorld(u, v) {
  const z = PATH_SKIN.z0 + v * (PATH_SKIN.z1 - PATH_SKIN.z0);
  return { x: pathCentreX(z) + (u - 0.5) * 2 * PATH_SKIN.half, z };
}

// How far the field is allowed to say, in metres, and what one code is worth.
//
// NOT SIGNED, and the reason is the seed's and is repeated here because it is
// the one property the whole strip rests on. A signed field averages to nothing
// in the middle of a slab; a mip level, or an anisotropic tap, is a MEAN of the
// field over a footprint, and the mean of a signed distance across two joints
// cancels somewhere inside the stone. The frame would draw a joint there -- a
// joint that is not in the paving, at a fixed offset, running the length of the
// run, which is precisely what guard-sentiero-bande --along is built to catch.
// Unsigned, the mean of a footprint containing a slot moves AWAY from nought:
// the joint thins and softens with distance and then stops being drawn, which is
// what a joint seen from further away should do.
//
// AND IT IS MEASURED INTO THE SLOT AND NOT OUT OF IT, which is the one place
// this departs from the seed, and it is a departure with a measurement behind
// it. The seed stores how far the nearest joint EDGE is: nought over the whole
// inside of a slot, growing into the stone. The frame then knows where the edge
// is and nothing at all about what is inside -- which was enough while the
// INSIDE of the joint came out of the ground's albedo atlas. This corridor has
// no atlas, so the one field it stores has to carry the joint's own cross
// section as well as its edge; and the cross section is a reading, not a
// decoration. Across its own width the reference's joint stands 16.7% brighter
// within a centimetre of stone than more than two centimetres from any
// (`shoulder`, an/piombo.txt). That is the broken lip of the two pieces at the
// sides and dark soil in the middle, which is what a joint between slabs of
// unequal thickness looks like from above and what a milled slot does not.
//
// Every property the seed argued for survives the flip -- unsigned, clamped, a
// mean over a footprint that moves away from nought so a joint thins with
// distance, and an edge that is the crossing of nought and therefore lands where
// the interpolation puts it rather than where a texel does -- and the lip and
// the trough come for nothing.
//
// FORTY-EIGHT MILLIMETRES. The widest joint of the paving is 91 mm at the
// ninetieth decile, so the deepest a point can be inside one is 46 mm; past that
// there is nothing left to say and a code spent on it buys nothing. A code is
// 0.188 mm.
export const SKIN_REACH = 0.048;

// ------------------------------------------------------------- the two tunings
//
// ONE MECHANISM, TWO TUNINGS, AND THAT IS A MEASUREMENT AND NOT A CONVENIENCE.
//
// The near apron was read off the close crop as cobbles -- small round brown
// stones bedded in earth -- and it is not. Enlarged (an/z-apron.png, from the
// day target at 380,800), it is FLAT ANGULAR SLABS in a nearly regular lattice
// with brown EARTH between and over them: the brown is the soil, not the stone.
// It is the same mechanism as the middle stretch with other parameters -- pieces
// smaller, more earth, warmer -- so this file has one generator and two settings
// of it rather than two generators that would have to be kept in step.
//
// WHAT IS MEASURED ABOUT THE DIFFERENCE, AND WHAT IS NOT. Taken in the same band
// of the frame, so at the same image radius and therefore under the same corner
// shading, the apron is +0.135 warmer in (r-b)/(r+b) and its stone stands at
// 1.70 times the grass beside it against the middle stretch's 3.41
// (an/composizione.txt). Those two are cancels: they are ratios inside one band,
// and the frame's own shading divides out of them. The LEVEL step between the
// two -- 24% -- is NOT measured in safety, because 16.4% of it is the frame's
// own shading between the two ends of the run and the vignette could not be
// reproduced on these two pictures. So the level below is a WITNESS and the warm
// and the ratios are the GATES, and this file says so rather than letting a
// reader assume all three carry the same weight.
export const TUNING = {
  // The middle stretch: pale worn slabs, earth in the joints and little more.
  reach: {
    // Share of blocks left whole, cut into four, cut into nine.
    cuts: [0.30, 0.22, 0.48],
    // Share of the PIECES that are bare ground rather than stone, per cut.
    bare: [0.02, 0.06, 0.09],
    // What a joint's width is multiplied by.
    gape: 1.0,
    // The warm shift, in (r-b)/(r+b), against this stretch's own zero.
    warm: 0,
    // What the paving's own level comes to. WITNESS, not a gate: see above.
    level: 1.0,
  },
  // The near apron: the same slabs, smaller, with more earth between and over.
  apron: {
    cuts: [0.10, 0.26, 0.64],
    bare: [0.05, 0.12, 0.17],
    gape: 1.05,
    warm: 0.135,
    level: 0.86,
  },
};

// Where the apron gives way to the middle stretch, in metres of northing.
//
// The two bands the difference was read on are z 2..4 and z -2..0, so the
// crossing lies between them and the ramp is written to cover both: nought at
// z = 0 and one at z = 4, which puts each band wholly inside the tuning it was
// measured as. North of the crossing the paving is the pale middle stretch all
// the way to where the stone dies; south of it, under and behind the walker, it
// is apron, which is what the near ground of both targets shows.
export const APRON = [0.0, 4.0];

/** How much of the apron's tuning applies at a northing: nought to one. */
export function apronAt(z) {
  return smoothstep(APRON[0], APRON[1], z);
}

/** The tuning at a northing, as one record with the two ends mixed. */
export function tuningAt(z) {
  const t = apronAt(z);
  const mix = (a, b) => a + (b - a) * t;
  const pair = (key) => TUNING.reach[key].map((v, i) => mix(v, TUNING.apron[key][i]));
  return {
    t,
    cuts: pair('cuts'),
    bare: pair('bare'),
    gape: mix(TUNING.reach.gape, TUNING.apron.gape),
    warm: mix(TUNING.reach.warm, TUNING.apron.warm),
    level: mix(TUNING.reach.level, TUNING.apron.level),
  };
}

// ------------------------------------------------------------- the generator
//
// THE PAVING, AS SHAPES, AND IT IS ONE SEAT.
//
// Everything that draws or measures this paving comes through paveAt(): the
// painter that writes the strip, the plan patches the shapes are fitted on, and
// the guards. A second copy would not be a fine misalignment -- the lattice is
// asked at a point that has been turned, pushed by three scales of noise and
// shifted, so a second reader that called the lattice directly would draw a
// DIFFERENT paving, structurally unrelated to the first, and no guard downstream
// could see it.

function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function noise(x, z) {
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

function fbm2(x, z) {
  return 0.667 * noise(x, z) + 0.333 * noise(x * 2.07, z * 2.07);
}

// The block, in metres, and it is the one number the whole size distribution
// hangs off.
//
// MEASURED, AND SMALLER THAN THIS WORLD BELIEVED. The paving that was here laid
// its lattice at 0.98 m on a reading of the close reference -- a slab covering a
// third to two thirds of a path two metres across -- and then had to BARE two
// pieces in five to reach the reference's 59.5% of quiet stone, because a
// pavement of metre slabs with three-centimetre joints is over ninety per cent
// stone whatever else is done to it. Read as SHAPES instead of as a width, the
// plan reference answers an equivalent diameter of 10.1 / 15.0 / 32.3 cm at the
// deciles and a long axis of 13.0 / 21.6 / 45.2 (an/forma.txt, over the 153
// pieces whose boundary is true joint for at least two thirds of itself). The
// pieces of this paving are a hand across, not a stride, and at that size the
// joints alone carry most of the forty per cent that is not stone.
export const BLOCK = 0.40;
// How far the edges of a piece wander off the lattice, as a fraction of the
// block. Three scales, and each answers for one of the numbers the shapes are
// fitted on.
//
//   the LOBE bends an edge over its own length. A jittered lattice draws
//   STRAIGHT boundaries between its sites and therefore CONVEX pieces; the
//   reference's solidity is 0.83, which is not convex, and its angularity is
//   0.537 against a disc's 0.512 and a square's 0.972 -- its outline turns
//   smoothly and is not made of straight segments meeting at corners. The lobe
//   is what takes the polygon out of it.
//
//   the BURR is the centimetre-scale roughness that makes a piece re-entrant,
//   which is what carries solidity down from a convex 0.97 to the measured 0.83.
//
//   the TATTER is finer than the burr and is what the strip can just carry: at
//   7.8 mm across and 8.4 along, an edge that wanders at three centimetres
//   survives and one that wanders at one does not.
export const WARP = [0.22, 0.160];
// The FRAY, between the burr and the tatter, and it is the scale the mask is
// actually read at.
//
// IT IS HERE BECAUSE THE FIRST TRY PUT ITS RAGGEDNESS WHERE NOBODY COULD SEE IT.
// The mask every shape reading is taken on -- the reference's own and this
// paving's -- is cut on a level smoothed over 2.4 cm, so anything finer than
// that is averaged off the outline before it is measured: raising the tatter
// from 1.1 cm to 1.6 cm moved circularity by four hundredths in the WRONG
// direction, which is noise. The reference's outline is 24% longer than this
// one's for the same area, and 24% of extra boundary has to be put in at a
// wavelength the blur leaves alone. Five and a half centimetres is the shortest
// one that does.
export const FRAY = [0.055, 7.5];
export const TATTER = [0.040, 15.0];
// Where the lattice's own origin sits, so a seat read back out of it can be
// brought home.
export const SHIFT = [3.13, 8.71];
// The bearing the lattice is asked on, in degrees off the world's own axes.
//
// NOT A DECORATION. A jittered lattice puts its sites in the middle seven tenths
// of each cell, so the joint statistic has a minimum on every lattice plane, and
// indexed straight off x and z one of those planes is x = 0 -- the bearing the
// path runs along. A plane of extra joint parallel to the run is a faint dark
// line down the whole length of the paving. Turned, no lattice plane can run
// along it. Thirty-one and not the ground's own twenty-seven, so the two
// lattices cannot stack while the old painted paving is still under this one.
export const TURN = 31;
const TURN_COS = Math.cos(TURN * Math.PI / 180);
const TURN_SIN = Math.sin(TURN * Math.PI / 180);

// The joint, in metres, before the tuning multiplies it.
//
// FITTED ON THE DECILES AND NOT ON THE MEDIAN. The reference's gap runs 0.8 /
// 1.7 / 3.5 / 9.1 cm at the tenth, twenty-fifth, fiftieth and ninetieth, which
// is a distribution with a long tail and not a width with a jitter on it: most
// pairs meet along something near a hairline and a few gape. The skew is what
// puts the mass at the tight end while leaving the tail room to reach the
// ninetieth.
export const JOINT_FINE = 0.006;
export const JOINT_WIDE = 0.078;
export const JOINT_SKEW = 2.4;
// How wide a joint INSIDE a block is against one between two blocks. Two pieces
// cut from one stone and laid together meet along a hairline; two blocks laid at
// different times have soil between them. It is also what keeps the subdivision
// from reading as a second net over the first.
export const JOINT_CUT = 0.46;

// THE CRACKS, WHICH ARE AN ACCENT AND NOT A TEXTURE.
//
// The reference has them and it barely has them: from 0.1 to 0.7 a square metre
// on every cut that was tried, never more than ten in the whole 14.2 m2 quadrat,
// and the count has no knee -- it is noise rather than a threshold
// (an/forma.txt). So a share of the pieces carry ONE hairline across themselves,
// and it is written into the joint field rather than into the tone: a crack is a
// slot in a piece of stone, which is exactly what the ruler already says, and
// both sides of it keep the same tone because they ARE the same piece. That is
// the difference between a crack and a joint, and it is the whole of it.
export const CRACK = { share: 0.05, width: 0.0045, wander: 0.16 };

/** Nearest site of a jittered lattice, and the joint between the two nearest. */
function lattice(px, pz) {
  const ix = Math.floor(px);
  const iz = Math.floor(pz);
  let best = Infinity;
  let second = Infinity;
  let bx = 0; let bz = 0; let sx = 0; let sz = 0;
  let seatX = 0; let seatZ = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cz = iz + dz;
      const jx = cx + 0.15 + 0.7 * hash2(cx, cz);
      const jz = cz + 0.15 + 0.7 * hash2(cx + 7919, cz + 104729);
      const d = Math.hypot(px - jx, pz - jz);
      if (d < best) {
        second = best; sx = bx; sz = bz;
        best = d; bx = cx; bz = cz;
        seatX = jx; seatZ = jz;
      } else if (d < second) {
        second = d; sx = cx; sz = cz;
      }
    }
  }
  // Ordered before it is hashed, or the joint would have two names and change
  // width halfway across itself.
  const first = bx < sx || (bx === sx && bz < sz);
  const ax = first ? bx : sx;
  const az = first ? bz : sz;
  const cx2 = first ? sx : bx;
  const cz2 = first ? sz : bz;
  return {
    joint: second - best,
    id: hash2(bx + 31, bz + 17),
    edge: hash2(ax * 3 + cx2 * 7 + 61, az * 3 + cz2 * 11 + 149),
    seatX,
    seatZ,
  };
}

/**
 * Where the lattice is asked, for a point of the world.
 *
 * Returns the two numbers the lattice is called with -- NOT the world point, and
 * not the world point turned. See the note over TURN for why the difference is
 * the whole of it: a reader that called the lattice on (x, z) directly would not
 * draw the same paving a few millimetres out of register, it would draw a
 * different paving.
 */
export function paveSpace(x, z) {
  const fx = x * TURN_COS + z * TURN_SIN;
  const fz = z * TURN_COS - x * TURN_SIN;
  const lobeA = fbm2(fx * 0.92 / BLOCK + 11, fz * 0.92 / BLOCK + 29) - 0.5;
  const lobeB = fbm2(fz * 0.92 / BLOCK + 53, fx * 0.92 / BLOCK + 7) - 0.5;
  const burrA = fbm2(fx * 3.4 / BLOCK + 71, fz * 3.4 / BLOCK + 13) - 0.5;
  const burrB = fbm2(fz * 3.4 / BLOCK + 97, fx * 3.4 / BLOCK + 37) - 0.5;
  const frayA = noise(fx * FRAY[1] / BLOCK + 211, fz * FRAY[1] / BLOCK + 83) - 0.5;
  const frayB = noise(fz * FRAY[1] / BLOCK + 149, fx * FRAY[1] / BLOCK + 307) - 0.5;
  const tatA = noise(fx * TATTER[1] / BLOCK + 131, fz * TATTER[1] / BLOCK + 59) - 0.5;
  const tatB = noise(fz * TATTER[1] / BLOCK + 17, fx * TATTER[1] / BLOCK + 191) - 0.5;
  return {
    fx: fx + BLOCK * (WARP[0] * lobeA + WARP[1] * burrA + FRAY[0] * frayA
      + TATTER[0] * tatA) + SHIFT[0],
    fz: fz + BLOCK * (WARP[0] * lobeB + WARP[1] * burrB + FRAY[0] * frayB
      + TATTER[0] * tatB) + SHIFT[1],
  };
}

/** The northing a lattice seat stands at, brought back out of the turn. */
function seatNorthing(fx, fz) {
  const ax = fx - SHIFT[0];
  const az = fz - SHIFT[1];
  return az * TURN_COS + ax * TURN_SIN;
}

/** How many pieces a block is cut into, from its own name and its tuning. */
function cutsInto(id, cuts) {
  const h = hash2(Math.round(id * 8191) + 137, 6421);
  if (h < cuts[0]) return 1;
  if (h < cuts[0] + cuts[1]) return 2;
  return 3;
}

/** The width of one joint, in metres, from its own name. */
function jointWidth(edge, gape, narrow) {
  return narrow * gape * (JOINT_FINE + (JOINT_WIDE - JOINT_FINE) * edge ** JOINT_SKEW);
}

const mixId = (a, b) => hash2(Math.round(a * 8191) * 3 + 11, Math.round(b * 8191) * 7 + 29);

/**
 * How wide a crack of the piece a point stands on is here, in the lattice's own
 * units of width. Infinite for a piece with no crack, which is nine in ten.
 *
 * A straight line through the piece's own seat, at a bearing taken from its
 * name, with a slow wander on it so it is not a ruled line.
 *
 * DOUBLED, and that is not a fudge: everything else on this ruler is `second
 * minus best` of a jittered lattice, which for a bisector is twice the distance
 * to it, and `gape` is the FULL width of a slot. A crack measured as a plain
 * perpendicular distance would be compared against a width in the wrong units
 * and would come out twice as wide as it was asked for.
 */
function crackDistance(piece, fx, fz) {
  if (hash2(Math.round(piece.id * 8191) + 613, 2287) >= CRACK.share) return Infinity;
  const angle = hash2(Math.round(piece.id * 8191) + 41, 7717) * Math.PI;
  const dx = fx - piece.seatX;
  const dz = fz - piece.seatZ;
  const across = dx * Math.cos(angle) - dz * Math.sin(angle);
  const along = dx * Math.sin(angle) + dz * Math.cos(angle);
  return 2 * Math.abs(across
    + CRACK.wander * BLOCK * (noise(along * 6.1 + 3.7, piece.id * 97) - 0.5));
}

/**
 * THE ONE SEAT: which piece of the paving a point of the world stands on, and
 * whether the point is in a slot at all.
 *
 * @param {number} x, z  metres, world
 * @returns {{jm:number, gape:number, inSlot:boolean, id:number, tone:number,
 *   bare:boolean, cut:number, warm:number, seatX:number, seatZ:number}}
 *   `jm` is how far this point stands from the middle of the nearest slot and
 *   `gape` how wide that slot is, both in the lattice's own units; `tone` is the
 *   piece's own level, nought for earth and one for the palest slab.
 */
export function paveAt(x, z) {
  const seat = paveSpace(x, z);
  const big = lattice(seat.fx / BLOCK, seat.fz / BLOCK);
  // The tuning is asked at the BLOCK's own seat and not at the point, so a block
  // is one size and one earth share over the whole of itself. Asked per point,
  // the shares would step across the middle of a piece and half a slab would be
  // earth -- which is the film the committente threw out three times, arriving
  // by a different road.
  const tune = tuningAt(seatNorthing(big.seatX * BLOCK, big.seatZ * BLOCK));
  const cut = cutsInto(big.id, tune.cuts);

  let piece = {
    id: big.id, seatX: big.seatX * BLOCK, seatZ: big.seatZ * BLOCK, cut,
  };
  let jm = big.joint * BLOCK;
  let gape = jointWidth(big.edge, tune.gape, 1);
  if (cut > 1) {
    const fine = lattice(seat.fx / (BLOCK / cut), seat.fz / (BLOCK / cut));
    piece = {
      id: mixId(big.id, fine.id),
      seatX: fine.seatX * (BLOCK / cut),
      seatZ: fine.seatZ * (BLOCK / cut),
      cut,
    };
    const jmFine = fine.joint * (BLOCK / cut);
    if (jmFine < jm) {
      jm = jmFine;
      gape = jointWidth(mixId(big.id, fine.edge), tune.gape, JOINT_CUT);
    }
  }

  // The crack, last, because it competes with the joints on the same ruler and
  // loses wherever a joint is nearer: a hairline that reached across a joint
  // would be drawing the piece next door's slot.
  const crack = crackDistance(piece, seat.fx, seat.fz);
  if (crack < jm) {
    jm = crack;
    gape = CRACK.width;
  }

  const bare = hash2(Math.round(piece.id * 8191) + 53, 971)
    < tune.bare[Math.min(3, cut) - 1];
  // THE IDENTITY OF A PIECE IS A LEVEL AND NOT A TINT, and that is a measurement
  // against the reading this chapter opened with. Between one slab and the next
  // the plan reference spreads its luminance by 25.0% of the mean and its
  // chromaticity by 1.1 to 1.3 points out of thirty -- and the spread BETWEEN
  // pieces is 0.78 of the spread WITHIN one, so the slabs are not even as
  // different from one another as each is varied inside itself. "Grey, beige and
  // rosy" is not what the material says; one stone at many levels is.
  const level = hash2(Math.round(piece.id * 8191) + 907, 4111);
  return {
    ...piece,
    jm,
    gape,
    inSlot: jm <= gape,
    bare,
    warm: tune.warm,
    // Nought is earth and one is the palest slab. IDENTITY is the 0.25: the
    // measured spread of the level between one piece and the next. The tuning's
    // own level moves the whole ramp without touching that spread.
    tone: bare ? 0 : clamp01(tune.level * (0.62 + 0.25 * (level - 0.5) * 2.4)),
  };
}

// ------------------------------------------------------------ the small stones
//
// FOURTEEN TO A SQUARE METRE, AND THEY ARE SCATTERED RATHER THAN PLACED.
//
// The plan reference carries 198 stones over 14.2 m2 at the cut that separates a
// stone from the grain of a stone -- 14.2 a square metre, median 2.83 cm -- and
// 55.5% of them are lying on a slab against a paving that is 59.5% slab
// (an/piombo.txt). Within the noise of a count that size those two numbers are
// the same number: the stones do not know where the joints are. So they are not
// generated from the lattice at all. They are a field over the WORLD, repeated
// and turned, which is the one shape of texture with no Nyquist of its own --
// the mip chain of a tile does the right thing with it at every distance for
// free, and a 2.8 cm stone written into the strip would come out three texels
// long and read as a stroke down the run, which is the defect this whole file
// exists to close.
//
// THE PERIOD AND THE TURN. Stepping down the run by d moves the tile coordinate
// by d*sin(turn) across and d*cos(turn) along, so the pattern only returns when
// BOTH are whole repeats -- which for a bearing whose tangent is not a fraction
// never happens at all. Nineteen degrees, so it stacks neither with the paving's
// thirty-one nor with the ground's forty.
export const GRAIN = {
  turn: 19,
  // How many to a square metre. The reference counts 198 stones over 14.2 m2 at
  // the cut that separates a stone from the grain of a stone.
  perM2: 14.2,
  // How many seats of that count fit across one repeat of the tile.
  //
  // AND THE REPEAT IS DERIVED FROM IT RATHER THAN CHOSEN, because a tile has to
  // close on itself: the lattice wraps every `cells` cells, so the repeat is
  // exactly `cells` seats wide and the seam is a cell boundary like any other. A
  // repeat picked as a round number of metres would leave a fraction of a cell
  // at the edge, and the tile would carry a line down two of its own sides --
  // which, repeated over the ground, is a grid the length of the path.
  cells: 6,
  // How far outside a stone the field still says something, in metres. Short,
  // because what is wanted is a round rim and not a halo.
  reach: 0.020,
  // The stones themselves, in metres. The median of the reference is 2.83 cm and
  // the counter that measured it accepts 2.5 to 6.0 cm, so this is the same
  // window with the same middle.
  size: [0.024, 0.048],
  // The three octaves of the grain, in WHOLE cycles per repeat -- whole, so the
  // noise lattice wraps and the tile closes.
  // The side of the delivered tile, in texels. 384 over 1.592 m is 4.15 mm, so
  // the finest octave below is 4.6 texels to a cycle -- above Nyquist with the
  // mip chain to spare, and it is what the tile costs that decides it: the fine
  // grain is very nearly incompressible (302 kB of the 358 the pair cost at 512,
  // against 23 for the field of stones beside it), so its side is the one number
  // in this file that the first-frame budget writes rather than the picture.
  side: 384,
  octaves: [84, 32, 12],
  weights: [0.56, 0.28, 0.16],
  spread: 1.55,
  // WHAT THE TILE'S OWN MEAN COMES TO, AND WHY IT IS A CONSTANT AND NOT NOUGHT.
  //
  // The field is odd about its middle by construction -- summed octaves of value
  // noise, compressed by a tanh -- so its mean SHOULD be exactly a half, and
  // over the tile it is not: measured on the delivered sampling it comes out
  // 0.4876. That is not a mistake in the arithmetic, it is a small sample. The
  // coarsest octave has only twelve cells a side, so the tile holds 144
  // independent draws of it, and the mean of 144 draws is not the mean of the
  // distribution -- it is that mean plus a few thousandths of scatter, and this
  // tile is ONE draw and always will be.
  //
  // It matters because the frame multiplies the pigment by one plus a gain times
  // this either side of its middle: a mean a hundredth low is the whole paving
  // drawn 0.8% dark, on a level that was fitted rather than chosen. So the one
  // draw that ships is measured and its offset published here, where the painter
  // and the offline bench both read it and land on the same stone. Re-measured
  // by the painter, which refuses the tile if the correction has not landed.
  bias: 0.0124,
};
/** Metres of ground to one repeat of the tile, derived from the count. */
GRAIN.metresPerRepeat = GRAIN.cells / Math.sqrt(GRAIN.perM2);

/** Value noise on a torus of `period` cells, so a tile built on it closes. */
function ringNoise(x, z, period) {
  const w = (i) => ((i % period) + period) % period;
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash2(w(ix), w(iz));
  const b = hash2(w(ix + 1), w(iz));
  const c = hash2(w(ix), w(iz + 1));
  const d = hash2(w(ix + 1), w(iz + 1));
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

/**
 * The grain of the stone itself, mean a half by construction.
 *
 * WHAT IT IS FOR, AND IT IS THE HALF OF THE MATERIAL NOBODY EXPECTS. The plan
 * reference spreads its level BETWEEN one piece and the next by 0.0695 and
 * WITHIN one piece by 0.0888 -- a ratio of 0.78, so the slabs are less different
 * from one another than each is varied inside itself (an/forma.txt). A paving
 * that put all its variation on the piece would answer that reading upside down,
 * and it would look it: uniform stones of different tones, which is a mosaic.
 * This carries the other side of it, and it is a tile over the world rather than
 * a field on the strip for the same reason the small stones are.
 *
 * MEAN A HALF: the frame multiplies the pigment by one plus a gain times this
 * either side of its middle, so it adds material to the stone without moving how
 * bright the stone is -- and how bright it is is the fitted pigment.
 */
export function grainTone(tu, tv) {
  let sum = 0;
  for (let k = 0; k < GRAIN.octaves.length; k++) {
    const p = GRAIN.octaves[k];
    sum += GRAIN.weights[k] * (ringNoise(tu * p + 0.31 * k, tv * p + 0.77 * k, p) - 0.5);
  }
  // Compressed and NOT clipped, and the difference is the mean. A clamp at
  // nought and one is one-sided wherever the field is not symmetric about its
  // own middle, and it measured 0.474 instead of 0.500 -- which is a quarter of
  // a per cent taken off the level of the whole paving by a limiter. tanh is odd
  // about nought, so whatever it does to one tail it does to the other and the
  // mean survives exactly.
  return 0.5 + 0.5 * Math.tanh(2 * sum * GRAIN.spread) + GRAIN.bias;
}

/**
 * How far a point of the tile is from the rim of the nearest small stone, in
 * metres -- negative inside it -- and how bright that stone is.
 *
 * `tu` and `tv` are the tile's own coordinates, nought to one. The stones are
 * seated on a lattice of exactly GRAIN.cells seats a side, so the number a
 * square metre is a parameter and not an outcome AND the tile closes.
 */
export function grainAt(tu, tv) {
  const n = GRAIN.cells;
  const pitch = GRAIN.metresPerRepeat / n;
  const px = tu * n;
  const pz = tv * n;
  const ix = Math.floor(px);
  const iz = Math.floor(pz);
  const w = (i) => ((i % n) + n) % n;
  let best = Infinity;
  let level = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cz = iz + dz;
      const hx = w(cx);
      const hz = w(cz);
      // The jitter is taken from the WRAPPED index and laid at the UNWRAPPED
      // seat, or a stone near the seam would be measured from the wrong side of
      // the tile.
      const jx = cx + 0.12 + 0.76 * hash2(hx + 313, hz + 577);
      const jz = cz + 0.12 + 0.76 * hash2(hx + 1583, hz + 2069);
      const r = 0.5 * (GRAIN.size[0]
        + (GRAIN.size[1] - GRAIN.size[0]) * hash2(hx + 61, hz + 89) ** 1.6);
      // Not a circle: a stone seen from above is an ellipse with a broken rim,
      // and a field of discs reads as a field of discs at any amplitude.
      const ex = (px - jx) * pitch;
      const ez = (pz - jz) * pitch;
      const angle = hash2(hx + 179, hz + 233) * Math.PI;
      const ax = ex * Math.cos(angle) - ez * Math.sin(angle);
      const az = ex * Math.sin(angle) + ez * Math.cos(angle);
      const squash = 0.68 + 0.32 * hash2(hx + 401, hz + 449);
      const rim = 1 + 0.32 * (hash2(hx + 907, hz + 1013) - 0.5)
        * Math.cos(3 * Math.atan2(az, ax) + hash2(hx + 53, hz + 59) * 6.283);
      const d = Math.hypot(ax, az / squash) - r * rim;
      if (d < best) {
        best = d;
        level = hash2(hx + 733, hz + 811);
      }
    }
  }
  return { d: best, level };
}

/**
 * The tile's own coordinate for a point of the world, before it is wrapped.
 *
 * ONE SEAT, because the frame and the offline bench both have to land on the
 * same stone: the turn is applied to the world BEFORE the division, so a tile
 * coordinate is not a scaled world coordinate and a reader that scaled first
 * would be reading a different tile.
 */
export function grainUv(x, z) {
  const c = Math.cos(GRAIN.turn * Math.PI / 180);
  const s = Math.sin(GRAIN.turn * Math.PI / 180);
  return {
    u: (x * c + z * s) / GRAIN.metresPerRepeat,
    v: (z * c - x * s) / GRAIN.metresPerRepeat,
  };
}

// ---------------------------------------------------------------- the pigment
//
// THE TWO PIGMENTS OF THE PAVING, and the whole of the colour is a ramp between
// them.
//
// Earth is the brown ground between and over the pieces; stone is the pale worn
// slab. The piece's own tone walks the ramp, and the identity between one piece
// and the next is a step ALONG it rather than a hue of its own -- which is what
// the plan reference measures and what "grey, beige and rosy" is not.
//
// STONE is the constant the ground's own paving was fitted to and it is carried
// over unchanged: it is a measurement of the SAME stone off the SAME reference,
// re-solved twice already, and re-solving it a third time here on a new surface
// would be inventing a second answer to a settled question.
export const EARTH = [0.336, 0.269, 0.192];
export const STONE = [0.242, 0.315, 0.313];
export const STONE_PALE = [0.418, 0.436, 0.428];
// What a slot takes out of the pigment, at its lip and at its trough.
//
// TWO NUMBERS AND NOT ONE, because the joint is not one tone across its own
// width: the reference stands 16.7% brighter within a centimetre of stone than
// more than two centimetres from any, which is the broken lip of the two pieces
// at the sides and the soil in the middle. One number answers nought on that
// reading, which is what a milled slot answers and what a sheet answers.
//
// It is a PIGMENT and never the light. The soil in a slot is darker than the
// stone it separates; putting the darkening on the terms would make a joint a
// function of the hour and would reach the one pair of numbers every guard in
// this world is weighed on.
export const JOINT_DARK = [0.18, 0.21];
// Where the lip gives way to the trough, in metres of depth into the slot. The
// two bands are the reading's own: within a centimetre of stone, and more than
// two from any.
export const JOINT_LIP = [0.010, 0.020];
// How quickly the darkening rises from the slot's own edge, in metres. The edge
// itself is where the stored depth crosses nought, and that crossing is a
// POSITION and interpolates; this is only how hard the frame is allowed to draw
// it, and a step with no ramp at all would alias on the near paving.
export const JOINT_SOFT = 0.0035;
// Where the rim of a small stone is, in the tile's own coding: the field is a
// half AT the rim, above it inside the stone and below it out on the ground, so
// the crossing is a position and the rim is drawn as round as the frame likes
// rather than as round as the tile is.
export const PEB_EDGE = [0.46, 0.54];
// How much of a small stone's own pigment is laid over the ground it lies on,
// and what that pigment comes to.
//
// SET AGAINST THE COUNT ITSELF AND NOT BY EYE. The counter that measured the
// reference wants a stone to stand 28% above the ground within a stone's reach
// of it before it will call it a stone -- and it is the same counter, on the
// same cut, that answered 14.2 a square metre on the reference. So a stone laid
// too gently is a stone the count does not see, and the paving would have to
// plant twice as many as the reference has to report as many as the reference
// does. These two are what make the planted count and the counted count the
// same number.
export const PEB_MIX = 0.92;
export const PEB_LEVEL = [0.98, 0.40];
// How hard the grain bites, as a fraction of the pigment either side of its
// middle.
export const GRAIN_GAIN = 0.62;

/**
 * THE PIGMENT OF THE PAVING, AND IT IS ONE SEAT.
 *
 * Two things read this: the frame, in the fragment of
 * src/world/layers/v3-sentiero.js, and the plan patches the shapes are fitted on
 * offline. They are two implementations of one arithmetic and that is a debt
 * rather than a design -- GLSL cannot call this -- so it is written once here in
 * the form the fragment mirrors line for line, and the two are held together at
 * the far end instead of at the near one: what check-slabs --plan gives a
 * VERDICT on is a real render at PLAN_POSE, and the offline patch is only the
 * bench a coat of paint is chosen on. The gap between the two is measured and
 * declared rather than assumed to be nought.
 *
 * @param {object} f  the fields at a point
 * @param {number} f.tone   the piece's own level, nought earth, one palest slab
 * @param {number} f.depth  metres into the nearest slot, nought on stone
 * @param {number} f.apron  how much of the apron's tuning applies here
 * @param {number} f.grain  the grain of the stone, mean a half
 * @param {number} f.stone  the small stone's field, a half at its rim
 * @param {number} f.near   how much of the near material is alive, nought to one
 * @returns {number[]} linear rgb
 */
export function pathPigment({
  tone, depth, apron = 0, grain = 0.5, stone = 0, near = 1,
}) {
  const ramp = tone < 0.5
    ? EARTH.map((v, i) => v + (STONE[i] - v) * (tone * 2))
    : STONE.map((v, i) => v + (STONE_PALE[i] - v) * ((tone - 0.5) * 2));
  // The warm of the apron, and it is a CHROMATICITY and not a level: what was
  // measured between the two stretches is +0.135 of (r-b)/(r+b) inside one band
  // of the frame, where the picture's own corner shading divides out. Applied so
  // that it cannot move the level the ratios were read at.
  const warm = TUNING.apron.warm * apron;
  const out = [ramp[0] * (1 + warm), ramp[1], ramp[2] * (1 - warm)];

  const bite = 1 + near * GRAIN_GAIN * (grain - 0.5);
  for (let i = 0; i < 3; i++) out[i] *= bite;

  const inStone = smoothstep(PEB_EDGE[0], PEB_EDGE[1], stone) * near * PEB_MIX;
  for (let i = 0; i < 3; i++) {
    out[i] += (STONE_PALE[i] * (PEB_LEVEL[0] + PEB_LEVEL[1] * grain) - out[i]) * inStone;
  }

  const inSlot = smoothstep(0, JOINT_SOFT, depth);
  const trough = smoothstep(JOINT_LIP[0], JOINT_LIP[1], depth);
  const dark = 1 - inSlot * (JOINT_DARK[0] + (JOINT_DARK[1] - JOINT_DARK[0]) * trough);
  for (let i = 0; i < 3; i++) out[i] *= dark;
  return out;
}

// ---------------------------------------------------------------- the surface
//
// WHERE THE CORRIDOR OWNS THE COLUMN, which is the footprint V1's disc has to
// stop laying ground under.
//
// It is published HERE rather than written into the contract, because
// src/world/contracts.js is the foundation's file and this session owns none of
// it. What a session may do is say, in its own seat, exactly where its surface
// is, so that the one line which turns groundHoleAt() on has something true to
// read. The contract is asked below and its answer reported rather than assumed:
// today it is false everywhere, which is the truth while the ground under the
// corridor is still the painted meadow, and the corridor is opaque over every
// metre of that meadow the old paving ever reached.
export const FOOT = {
  // Where the surface is opaque whatever the paving does, as a fraction of the
  // path's own half width. Everything the ground atlas ever painted as stone is
  // inside 1.05, so at 1.10 the corridor covers the old paving completely and
  // nothing of it can show at the seam.
  solid: 1.10,
  // Where it stops entirely, and it is CAPPED BY THE STRIP and not chosen.
  //
  // The mesh is laid across the strip, so the surface can never reach further
  // than the strip's own half. pathEdge() tops out at 0.9657 m, so a footprint
  // stated at 1.42 half-widths would want 1.37 m of ground at the wide end
  // against a strip that offers 1.25 -- and what that produces is not a missing
  // sliver, it is a HARD ALPHA EDGE at a fixed fraction of the width, running
  // the length of the paving, which is exactly the line guard-sentiero-bande
  // --along exists to catch. At 1.28 the widest the surface ever reaches is
  // 1.236 m and the strip's border is still in meadow.
  edge: 1.28,
  // How far the surface stands above the ground it is laid on, in metres.
  //
  // FOUR MILLIMETRES, AND THE SMALLNESS OF IT IS THE POINT. What a lift has to
  // clear is not the ground but the DISAGREEMENT about where the ground is, and
  // that disagreement is answered below rather than paid for here: laid on the
  // higher of the two answers, all a lift is still for is keeping two surfaces
  // out of one plane so they cannot fight over the depth buffer.
  //
  // A LIFT ALONE COULD NOT HAVE DONE IT, and the number says so. Measured over
  // this footprint, the meadow's triangles stand up to 25.1 mm above the height
  // the walker's own contract gives -- so a corridor laid on the contract needs
  // an inch of lift not to be pierced, and an inch of stone standing proud of
  // the grass is a kerb, where the reference has slabs bedded a finger BELOW the
  // turf.
  lift: 0.004,
  // Where the lift starts letting go, as a fraction of the half width. It is the
  // solid edge and not a number of its own: wherever the surface is opaque the
  // lift is whole, and it lets go only across the band where the surface is
  // already fading, so the taper can never show as a step.
  taper: 1.10,
};

/**
 * The height of the ground AS IT IS DRAWN, at a point.
 *
 * THE SECOND ANSWER, AND IT IS NOT THE SAME AS THE FIRST. groundHeightAt() is
 * the walker's floor: a grid of the field sampled every 0.28 m and read back
 * bilinearly. The meadow is drawn from a DIFFERENT sampling of the same field --
 * a grid bent to crowd its vertices near the eye -- and what the frame puts on
 * the screen is the flat triangle between three of those samples. Two samplings
 * of one field are two surfaces, and over this corridor's own footprint they
 * stand up to 25.1 mm apart (v3-sentiero/dev1/eccesso.mjs; the worst of it is at
 * z = 1, where the meadow's rows are 13 cm and the contract's grid is 28 -- so
 * it is not the meadow being coarse, it is the two being coarse in different
 * places).
 *
 * That gap is a fact about the ground and not about the corridor, and it belongs
 * to whoever owns the two samplings -- but the corridor has to be laid on ONE of
 * them and the choice is not free. Laid on the contract it is pierced by the
 * meadow, 23.6 mm at the worst, and the meadow is then drawn THROUGH the stone
 * in a ragged line that moves with the walker. Laid on the HIGHER of the two it
 * is pierced nowhere and stands up to 32.8 mm above the grass beside it, which
 * is a kerb where the reference has slabs bedded a finger BELOW the turf. Laid
 * on the DRAWN ground it is neither: it sits exactly where the meadow it touches
 * sits, four millimetres up, and the only thing left disagreeing is the walker's
 * own floor -- which already disagreed with the meadow by those same three
 * centimetres before this corridor existed, and does so under every square metre
 * of the world and not only here. That is where it is laid, and the gap is
 * reported rather than absorbed: guard-sentiero-cucitura prints it every run.
 *
 * It reads the FIELD's own grid and not src/world/terrain.js, which is the
 * ground session's file; the triangulation is the one that file lays. If the
 * ground is ever re-tessellated this stops being the drawn surface -- and it
 * stops MATTERING at the same moment, because the day V1's disc arrives
 * groundHoleAt() turns on over this footprint and there is no meadow drawn under
 * the corridor to be pierced by.
 */
export function drawnGroundAt(x, z) {
  const n = GRID.samples;
  const u = (offsetToGrid(x - GRID.centreX) + 1) / 2;
  const v = (offsetToGrid(z - GRID.centreZ) + 1) / 2;
  const fi = Math.min(n - 2, Math.max(0, Math.floor(u * (n - 1))));
  const fj = Math.min(n - 2, Math.max(0, Math.floor(v * (n - 1))));
  const seat = (i, j) => {
    const gx = GRID.centreX + gridToOffset((i / (n - 1)) * 2 - 1);
    const gz = GRID.centreZ + gridToOffset((j / (n - 1)) * 2 - 1);
    return { gx, gz, y: heightAt(gx, gz) };
  };
  const a = seat(fi, fj);
  const b = seat(fi + 1, fj);
  const c = seat(fi, fj + 1);
  const d = seat(fi + 1, fj + 1);
  const s = (x - a.gx) / (b.gx - a.gx);
  const t = (z - a.gz) / (c.gz - a.gz);
  // The diagonal of the quad runs from a to d, so which side of it the point
  // falls on decides which of the two triangles carries it.
  return s <= t
    ? a.y + (d.y - c.y) * s + (c.y - a.y) * t
    : a.y + (b.y - a.y) * s + (d.y - b.y) * t;
}

/**
 * Whether the corridor owns the ground at a point.
 *
 * WHAT V3 HANDS groundHoleAt(). It is the footprint of the surface and nothing
 * else: inside it the corridor is the floor, so a disc that laid a column there
 * would put two opinions about one floor under the walker.
 */
export function pathHoleAt(x, z) {
  return pathRun(z) > 0.001 && Math.abs(pathCoord(x, z)) < FOOT.edge;
}

/**
 * How much of the corridor there is at a point, nought to one.
 *
 * One inside the solid footprint, letting go over the last quarter of a metre,
 * and nought where the stone has died. It is a fraction of a SURFACE and not of
 * a material: what is drawn on the surface out past the verge is decided in the
 * frame, off the paving's own tone, so a slab standing in the grass is opaque
 * where the earth around it is not.
 */
export function pathCoverAt(d, z) {
  return pathRun(z) * (1 - smoothstep(FOOT.solid, FOOT.edge, d));
}

/**
 * The corridor's own height at a point, in metres.
 *
 * IT READS THE CONTRACT AND NOT THE FIELD. groundHeightAt() is the one answer
 * the walker's feet, the meadow's triangles and this surface all come off, and a
 * corridor built on terrain-field.js directly would be a second reader of the
 * ground that stops following V1 the day V1 rewrites it.
 */
export function pathHeightAt(x, z, d = Math.abs(pathCoord(x, z))) {
  return drawnGroundAt(x, z) + FOOT.lift * (1 - smoothstep(FOOT.taper, FOOT.edge, d));
}

/**
 * How far the walker's own floor stands from the ground as it is drawn, at a
 * point. Positive where the walker is above the picture.
 *
 * PUBLISHED BECAUSE IT IS NOT NOUGHT AND IT IS NOT THIS SESSION'S. It is the
 * same number under the meadow as under the corridor; what makes it visible here
 * is only that a second surface had to choose which of the two to sit on.
 */
export function floorGapAt(x, z) {
  return groundHeightAt(x, z) - drawnGroundAt(x, z);
}

// How far apart the two samples of the height are when the normal is taken, in
// metres. A tenth of a metre: shorter and it reads the bilinear cells of the
// height grid, longer and it stops being the tilt of the ground under the foot
// and becomes the roll of the meadow.
const NORMAL_STEP = 0.10;

/** The corridor's own normal at a point, as three numbers. */
export function pathNormalAt(x, z) {
  const e = NORMAL_STEP;
  const dx = (groundHeightAt(x + e, z) - groundHeightAt(x - e, z)) / (2 * e);
  const dz = (groundHeightAt(x, z + e) - groundHeightAt(x, z - e)) / (2 * e);
  const len = Math.hypot(dx, 1, dz);
  return [-dx / len, 1 / len, -dz / len];
}

// The corridor's mesh, and what it costs.
//
// The budget of a layer is four thousand triangles, and this spends 3 638 of
// them on 18 columns and 108 rows: 14.7 cm across the strip and 40 cm along it.
// BOTH NUMBERS ARE ARGUED. Across, the lip of the path is spread over 0.47 to
// 0.78 m of ground, which is four to five columns, and the chord error of the
// lip's own sine at this spacing is 3 mm. Along, the finest thing in the height
// under the paving is an octave of 6 cm at a wavelength of 3.2 m -- the turf's
// hummocks are nought over the path by construction -- whose chord error at
// 40 cm is 4.6 mm. The lift above is three times the larger of them.
export const MESH = { across: 18, along: 108 };

/**
 * The corridor, as buffers.
 *
 * No three and no material: this is arithmetic, and the file that hangs it on a
 * scene is the layer's. The same shape src/world/stairs.js hands back, for the
 * same reason.
 */
export function pathMesh({ across = MESH.across, along = MESH.along } = {}) {
  const nx = across;
  const nz = along;
  const positions = new Float32Array(nx * nz * 3);
  const normals = new Float32Array(nx * nz * 3);
  const skin = new Float32Array(nx * nz * 2);
  const ground = new Float32Array(nx * nz * 2);
  // How far across the paving this vertex stands, one at the verge, and how much
  // surface there is here. Both are carried rather than solved in the shader:
  // pathCoord() is the one seat for the shape of the path and it has a noise in
  // it, so a copy of it in GLSL would be a second opinion about where the stone
  // stops.
  const verge = new Float32Array(nx * nz * 2);

  for (let j = 0; j < nz; j++) {
    const z = PATH_SKIN.z0 + (j / (nz - 1)) * (PATH_SKIN.z1 - PATH_SKIN.z0);
    const centre = pathCentreX(z);
    for (let i = 0; i < nx; i++) {
      const u = i / (nx - 1);
      // The columns are laid across the STRIP and not across the paving, so the
      // mesh's own edge is the strip's edge and the paving's ragged one lives
      // inside it. A mesh cut to the paving would put a silhouette on a noise.
      const x = centre + (u - 0.5) * 2 * PATH_SKIN.half;
      const d = Math.abs(pathCoord(x, z));
      const o = (j * nx + i) * 3;
      positions[o] = x;
      positions[o + 1] = pathHeightAt(x, z, d);
      positions[o + 2] = z;
      const n = pathNormalAt(x, z);
      normals[o] = n[0];
      normals[o + 1] = n[1];
      normals[o + 2] = n[2];
      const t = (j * nx + i) * 2;
      skin[t] = u;
      skin[t + 1] = (z - PATH_SKIN.z0) / (PATH_SKIN.z1 - PATH_SKIN.z0);
      ground[t] = x;
      ground[t + 1] = z;
      verge[t] = d;
      verge[t + 1] = pathCoverAt(d, z);
    }
  }

  const quads = (nx - 1) * (nz - 1);
  const indices = quads * 6 > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      indices[k++] = a; indices[k++] = a + nx; indices[k++] = a + nx + 1;
      indices[k++] = a; indices[k++] = a + nx + 1; indices[k++] = a + 1;
    }
  }

  return {
    positions, normals, skin, ground, verge, indices, triangles: quads * 2,
  };
}

/**
 * What the ground contract says about the corridor's own footprint, asked rather
 * than assumed.
 *
 * groundHoleAt() is the seat where a session declares that something else owns a
 * column, and it answers false everywhere today -- which is the truth and not a
 * placeholder: the ground under the corridor is still the painted meadow, and
 * the corridor is opaque over every metre of it the old paving ever reached. The
 * day the disc arrives, one line in the contract turns this on and nothing in
 * this file changes. It is reported instead of being quietly ignored so that the
 * gap between what V3 draws and what V1 is told is a number somebody has seen.
 */
export function holeReport() {
  let disagree = 0;
  let sampled = 0;
  for (let z = PATH_SKIN.z0; z <= PATH_SKIN.z1; z += 0.5) {
    for (let d = -1.3; d <= 1.3; d += 0.1) {
      const x = pathCentreX(z) + d * pathEdge(z, d);
      sampled++;
      if (pathHoleAt(x, z) !== Boolean(groundHoleAt(x, z))) disagree++;
    }
  }
  return { sampled, disagree, contractAnswers: Boolean(groundHoleAt(0, 0)) };
}

/**
 * The two terms of the ground's own light under the corridor, or the analytic
 * pair where nobody can yet say.
 *
 * WHAT THIS IS FOR. groundLightAt() is the contract a card of grass reads so
 * that a blade standing on the paving is lit by the paving and not by a second
 * opinion about the hour. It answers null today, and null is honest: there is no
 * CPU-side copy of anything, because there is no bake left to copy. What the
 * corridor hands back instead is the pair it draws ITSELF with -- the cosine the
 * face turns to the beam and the share of the hemisphere it can see -- which is
 * not an approximation of the light on this surface, it IS the light on this
 * surface, computed by the same arithmetic the fragment computes it by.
 *
 * @param {number[]} sun  the sun's direction, from the one seat that holds it
 */
export function pathLightAt(x, z, sun = null) {
  const said = groundLightAt(x, z);
  if (said) return said;
  const n = pathNormalAt(x, z);
  return {
    sun: sun ? Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]) : null,
    sky: 0.5 + 0.5 * n[1],
    normal: n,
  };
}

/** What one corridor costs, for the development panel and for the budget. */
export const PATH_BUDGET = {
  triangles: (MESH.across - 1) * (MESH.along - 1) * 2,
  draws: 1,
};

export { pathHalfWidth, pathRun };
