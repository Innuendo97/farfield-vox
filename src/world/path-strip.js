import { pathCentreX } from './terrain-field.js';

// WHERE THE PATH STRIP LIES, and it is one seat because two things read it: the
// mesh, which hands every vertex its place on the strip, and
// tools/terrain/paint-path-strip.mjs, which has to know which point of the world
// each of its texels is looking at. A strip painted against one frame and
// sampled against another is a strip that draws its joints somewhere else.
//
// WHAT THE STRIP IS FOR. The ground atlas is bent to spend its resolution near
// the walker and it still runs out: measured, four to fifteen millimetres a texel
// ACROSS the run and thirty-three to sixty-five ALONG it. A joint of the paving
// is a step in tone a few millimetres wide, and a step narrower than about two
// texels cannot be written at all — so the paving's joint has a FLOOR of two and
// a half centimetres across the run and the better part of ten along it,
// whatever the painter asks for.
//
// A distance field does not have that floor, and the reason is worth stating
// plainly because it is the whole idea: the atlas's Nyquist limits what can be
// DRAWN, not what can be SAID. Storing "how far is the nearest joint edge from
// here" and letting the frame compare that against a width costs the same eight
// bits a texel, but the number it reconstructs between two texels is a POSITION,
// and a position interpolates. The frame can then draw an edge finer than the
// texel that told it where the edge was.
//
// IT IS IN PATH SPACE AND NOT IN WORLD SPACE, for one reason: the path is a
// ribbon four metres wide and fifty long, and a square texture over the world
// would spend nine tenths of itself on meadow that has no joints in it. Laid
// along the run, every texel is on the paving.

/**
 * The frame the strip is laid in.
 *
 * `half` is HALF A METRE WIDER than the paving ever gets. pathHalfWidth() tops
 * out at 1.25 m and pathEdge() adds up to a third of a metre of wander on top,
 * so the stone can reach 1.59 m from the centreline at the wide end. At 1.8 the
 * strip's own edge always stands in grass, which is what lets the frame skip the
 * window it would otherwise need: the stone mask is already nought out there, so
 * a texel clamped at the edge cannot reach anything that would show it.
 *
 * `z0` and `z1` cover the paving and then some, and the same argument: the stone
 * begins at the bottom step (-14.3) and is gone by 30, so both ends of the strip
 * lie on ground with no joints in it. A strip that ended where the paving was
 * still live would draw a line ACROSS the run at a fixed northing, which is the
 * family of defect check-path-bands exists to reject.
 */
export const PATH_STRIP = {
  half: 1.8,
  z0: -16,
  z1: 31,
  // Texels across and along.
  //
  // THE SHAPE OF THIS IS A MEASUREMENT AND NOT AN AESTHETIC, and it is the one
  // number of the strip that had to be argued with a ruler rather than assumed.
  // See the verbale of the unit that set it: a distance field reconstructs the
  // position of an edge to a fraction of a texel, but it can only reconstruct an
  // edge it SAMPLED, and a joint narrower than the texel pitch can fall between
  // two samples and vanish entirely rather than blurring. So the pitch, and not
  // the interpolation, is what sets the finest joint the strip can carry — and
  // the pitch that matters is the one ACROSS the joint, which for a lattice
  // turned twenty-seven degrees is both axes about equally.
  size: [512, 2048],
};

/** How much ground one texel of the strip covers, in metres: across, along. */
export function stripPitch(size = PATH_STRIP.size) {
  return [
    2 * PATH_STRIP.half / size[0],
    (PATH_STRIP.z1 - PATH_STRIP.z0) / size[1],
  ];
}

/**
 * Where a world point falls on the strip, both in 0..1.
 *
 * BUILT ON pathCentreX AND NOTHING ELSE. pathCoord() would have been the obvious
 * thing to reach for — the mesh already carries it — and it is the wrong thing:
 * it divides by pathEdge(), which has a noise in it, so the frame would breathe
 * in and out with the wobble of the edge and the texture would swim along the
 * run. The centreline is fitted arithmetic with no noise anywhere in it, so this
 * mapping is smooth, and being smooth is what lets the frame interpolate it
 * across a quad and still get a defined mip.
 */
export function pathStripUv(x, z) {
  return {
    u: (x - pathCentreX(z)) / (2 * PATH_STRIP.half) + 0.5,
    v: (z - PATH_STRIP.z0) / (PATH_STRIP.z1 - PATH_STRIP.z0),
  };
}

/** The world point a strip coordinate looks at. The painter's way round. */
export function stripToWorld(u, v) {
  const z = PATH_STRIP.z0 + v * (PATH_STRIP.z1 - PATH_STRIP.z0);
  return { x: pathCentreX(z) + (u - 0.5) * 2 * PATH_STRIP.half, z };
}

// How far the field is allowed to say, in metres, and what one code is worth.
//
// SIXTY-FOUR MILLIMETRES, AND NOT SIGNED. Both halves of that are decisions with
// a failure behind them.
//
// NOT SIGNED, because a signed field averages to nothing in the middle of a
// slab. A mip level, or an anisotropic tap, is a MEAN of the field over a
// footprint; take the mean of a signed distance across two joints and the
// positive and negative halves cancel somewhere in the middle of the stone, and
// the frame draws a joint there — a joint that is not in the paving, standing at
// a fixed offset, running the length of the path. That is precisely the defect
// check-path-bands --along is built to catch, and it would have been built in
// deliberately. Unsigned, the mean of a footprint containing a joint moves AWAY
// from zero: the joint thins and softens as it gets further away and then stops
// being drawn, which is what a joint seen from further away should do.
//
// SIXTY-FOUR MILLIMETRES because past that the answer stops being used. The
// frame draws stone wherever the distance is over a joint's half width, and the
// widest joint in the paving is a hundred and five millimetres — so anything
// past about a finger's breadth from an edge is the same answer, "stone", and
// spending codes on how MUCH stone buys nothing. Clamping there is also what
// makes the file cheap: three quarters of the strip is at the clamp, and a
// constant costs a compressor almost nothing.
export const STRIP_REACH = 0.064;
