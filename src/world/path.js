import {
  clamp01, pathCoord, pathEdge, pathFrameX, pathHalfWidth, pathOffset, pathRun,
  smoothstep,
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
// AND THE SEED IT IS BUILT ON WAS src/world/path-strip.js, WHOLE. That file was
// the ground's and it is retired -- the corridor is columns of V1's disc and the
// strip it laid had no reader left -- but its doctrine is this one's capital:
// the atlas's Nyquist limits what can be DRAWN, not what can be SAID. A texel that holds HOW FAR the
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
// src/world/layers/v3-sentiero.js, which is the same split the ground kept
// between its own arithmetic and its own mesh for as long as it had a mesh.

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
  // Wide enough to hold the corridor wherever the axis takes it, and the number
  // is solved rather than chosen.
  //
  // IT WAS SHORT BEFORE THIS, AND THE PARAGRAPH THAT STOOD HERE SAID WHY WITHOUT
  // NOTICING. It read pathHalfWidth "tops out at 0.7751 m", which was true when
  // the seed wrote it and stopped being true when U-SENT-4 refitted the width
  // against the reference: the flare in front of the bottom step is a half width
  // of 1.20 m now, pathEdge takes it to 1.32 with its wobble, and 1.25 has been
  // clipping the outer three centimetres of that flare ever since.
  //
  // AND THE RIBBON IS NOT THE AXIS ANY MORE, which is what the other 18 cm buy.
  // The axis is a measured meander (PATH_CENTRE in ../terrain-field.js) and the
  // fragment that mirrors this mapping solves a smoothstep out of four uniforms,
  // which cannot follow one. So the ribbon is a straight-ish band that CONTAINS
  // the corridor instead of tracking it: it stands 0.51 m off the axis at its
  // worst, the paving reaches 1.32 m of easting from the axis at its worst, and
  // the two together want 1.506 m. Four centimetres of margin over that, so the
  // strip's own edge always stands in meadow -- which is what lets the frame
  // clamp at the border instead of carrying a window: nothing out there is
  // drawn.
  half: 1.55,
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
  //
  // THE COUNT ACROSS ROSE WITH THE HALF AND THE PITCH DID NOT. 320 texels over
  // 2.50 m was 7.81 mm; 400 over 3.10 m is 7.75. The pitch is what decides which
  // joints survive being sampled at all and it is the one thing here that is not
  // allowed to move, so the ribbon growing by a quarter costs a quarter more
  // texels and nothing else -- in particular the 2 cm window U-SENT-4 fitted the
  // joint's softening on is still two and a half texels wide.
  size: [400, 5120],
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
  // 160 across and not 128, for the same reason and to the same effect: 19.38 mm
  // against the 19.53 the eight-texel piece was measured at.
  toneSize: [160, 2048],
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
 * BUILT ON pathFrameX AND NOTHING ELSE. pathCoord() would have been the obvious
 * thing to reach for and it is the wrong thing: it divides by pathEdge(), which
 * has a noise in it, so the frame would breathe in and out with the wobble of
 * the edge and the paving would swim along the run. What carries the frame has
 * to be arithmetic with no noise anywhere in it, because being smooth is what
 * lets a fragment interpolate this across a quad and still get a defined mip.
 *
 * AND IT IS THE FRAME AND NOT THE AXIS, WHICH IS NEW. The two were the same
 * function while the axis was a ramp. The axis is a measured meander now and
 * the fragment that mirrors this mapping cannot solve one, so the ribbon stopped
 * being the axis and became a straight-ish band wide enough to hold the corridor
 * wherever it goes. The maps below are painted through this same seat, so the
 * painter and the fragment agree to the bit; what the corridor does inside the
 * band is carried by the CONTENT of the maps, which is sampled off the world.
 */
export function pathSkinUv(x, z) {
  return {
    u: (x - pathFrameX(z)) / (2 * PATH_SKIN.half) + 0.5,
    v: (z - PATH_SKIN.z0) / (PATH_SKIN.z1 - PATH_SKIN.z0),
  };
}

/** The world point a strip coordinate looks at. The painter's way round. */
export function skinToWorld(u, v) {
  const z = PATH_SKIN.z0 + v * (PATH_SKIN.z1 - PATH_SKIN.z0);
  return { x: pathFrameX(z) + (u - 0.5) * 2 * PATH_SKIN.half, z };
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
    //
    // AND IT IS THE FLOOR OF THE THINNING AND NOT A TRIM, WHICH IS THE READING
    // THAT MOVED IT. What stood here -- 2 / 6 / 9 per cent -- was E-V3d's, and
    // E-V3d was counting the share of pieces that read as BARE on a paving whose
    // stone was supposed to be nearly continuous. Read against the reference at
    // the fitted camera it is not: the target carries 45 to 65 per cent of EARTH
    // in the middle of its own corridor, at every one of the three stretches
    // (R3 §1.6, fondazione/lav/dirad.py) -- «le pietre sono posate nella terra,
    // non un lastricato continuo». A corridor that is nine tenths stone in its
    // core cannot thin into anything, because there is nothing between the
    // stones for the thinning to reach: it can only stop.
    //
    // SO THE TWO TUNINGS CARRY THE TWO CORES THE REFERENCE READS. The far
    // stretch keeps the more solid paving (65 to 71 per cent of stone at 0.6 m
    // inside its kerb) and the near apron the looser one (48 to 55), which is
    // the same direction the row above already had and a great deal more of it.
    bare: [0.26, 0.31, 0.36],
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
    bare: [0.41, 0.47, 0.52],
    gape: 1.05,
    // THE WARM, AND IT IS THE PIGMENT'S ROTATION AND NOT THE MEASUREMENT.
    //
    // What was measured is +0.135 of (r-b)/(r+b) between the two stretches IN
    // THE DEVELOPED FRAME, and a rotation of the pigment does not arrive there
    // unchanged: the ramp between the two tunings is not finished inside either
    // band the difference was read on -- at the middle of the near band it is
    // eight tenths of the way over -- and the light, the air and the tone curve
    // between the pigment and the pixel compress what is left. Written at 0.135
    // the frame answered +0.085 across those two bands. It is solved through the
    // chain instead, on a real render at the fitted camera, which is where the
    // number has to land.
    warm: 0.215,
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
//
// AND IT HALVES, BECAUSE A HAND IS SMALLER THAN THIS FILE MADE IT. Read on the
// day target at the fitted camera as connected pieces of the corridor's own
// surface -- the same counter on both pictures, fondazione/lav/tasselli.py --
// the reference answers an equivalent diameter of 3.4 / 6.4 / 37.7 cm at the
// deciles over the mid stretch and 7.2 / 10.0 / 27.4 over the far one, and this
// paving answered 4.7 / 7.6 / 40.1 and 5.8 / 9.7 / 48.4. The median is half a
// centimetre out at the middle and the whole distribution is a third too coarse
// at the far end, where a piece is what tells a paving of tiles from a floor of
// slabs. A block of 0.40 m cut in one, four and nine gives pieces of 40, 20 and
// 13 cm before the joints eat into them; at 0.20 it gives 20, 10 and 6.7, which
// is the hand the reference actually lays.
//
// THE PRICE IS IN THE MAPS AND NOT IN THE FRAME. Twice as many pieces to the
// metre is twice as much joint to draw, and the ruler and the tone are stored
// per texel: R3 measured +382 kB over the pair for exactly this change and no
// milliseconds at all, because the fragment reads the same three maps whatever
// is written on them.
export const BLOCK = 0.20;
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
//
// AND THE TWO WAVELENGTHS ARE HELD IN METRES WHILE THE BLOCK HALVES, which is
// the one thing about the block that does not scale with it. The lobe and the
// burr are lengths OF A PIECE -- an edge bent over its own length, a
// re-entrancy a fraction of the piece across -- and they follow the block by
// construction. These two are lengths of the MAP: 5.5 cm is the shortest ripple
// the 2.4 cm blur every shape reading is taken through leaves alone, and 2.7 cm
// is the finest the strip's 7.8 mm texel can carry. Neither of those two numbers
// knows how big a piece is, so the second figure of each pair -- which is a
// frequency in units of one over the block -- halves with the block to leave the
// wavelength where it was measured.
export const FRAY = [0.055, 3.75];
export const TATTER = [0.040, 7.5];
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

// ========================================================================
// THE TILES: WHERE THE STONE THINS INTO THE EARTH, AND HOW FAR EACH PIECE
// STANDS PROUD.
//
// E-DECISIONI10 S1 to S4, the committente's own words: «e' a piano col
// selciato, ma ha TASSELLI che sporgono in maniera diversa -- non voxel
// completi: tasselli con altezza fino a 1 cm sopra il piano; ogni tassello e'
// giustificato, ha la sua parte scura dovuta all'ombreggiatura della sporgenza,
// e colori leggermente diversi fra loro»; «i tasselli di pietra non sono solo al
// centro: si DIRADANO alternandosi ai tasselli di terra bruna, NON scomparendo
// di netto come oggi, ma in maniera morbida».
//
// NEITHER OF THE TWO IS A NEW GENERATOR. The lattice below already cuts the
// corridor into pieces a hand across and already decides, per piece, whether it
// is stone or the bare ground between the stones -- `bare`, whose share is one
// of the two tunings. What the two objects here add is a THIRD ARGUMENT to that
// share, which is where the piece stands across the run, and a HEIGHT for the
// piece, which is a number the lattice always could have said and nobody had
// asked for.

// HOW THE STONE THINS ACROSS THE RUN.
//
// MEASURED, AND THE MEASUREMENT IS THE WHOLE OF THE DEFECT. Read on the day
// target at the fitted camera and on this world's own render at the same pose,
// against the distance from the corridor's OWN kerb -- the crossing of half a
// share of green, found on each picture rather than assumed
// (fondazione/lav/se-mis.py) -- the share of the corridor's surface that reads
// as pale stone runs, over the mid stretch:
//
//     from the kerb  -0.70  -0.50  -0.35  -0.20  -0.08  +0.06 m
//     TARGET          47.6   54.9   47.8   42.9   40.3   27.5 %
//     ours            55.3   53.6   50.8   59.3   66.9   89.5 %
//
// The two curves go opposite ways, and that is the sentence. The reference's
// paving is never more than half stone even in its own middle and it gives the
// stone UP as it reaches the grass; ours is at its most stone exactly where it
// meets the grass, which is «netti confini verdi ai margini» read off the
// surface instead of off the outline.
//
// THE SHARE IS THE THING THAT MOVES, and it moves with the LATERAL POSITION
// rather than with a distance from an edge, because the corridor's own edge
// wobbles and a share tied to it would wobble with it.
//
// AND IT IS MEASURED FROM THE KERB THAT IS SEEN, WHICH IS THE WHOLE OF WHY THE
// CURVE ABOVE NEVER ARRIVED IN A PICTURE.
//
// The window used to be a fraction of the nominal half width, and a fraction of
// a half width is a distance that changes with the northing: 1.05 m of ground at
// z = 4 under the law U-SENT-4 shipped, 0.62 m under the law U-SENT-6 measured,
// and both of them ANCHORED AT THE CENTRELINE rather than at the edge. What the
// eye compares the thinning to is not the middle of the path: it is the line
// where the paving stops being paving, and that line stands at the far side of
// the bare band beside the stone (KERB below). Anchored there, the same window
// draws the same fall at every northing, which is what the reference does --
// the target's profile against ITS own kerb is one curve over all three
// stretches (R3 §1.6).
//
// THE NUMBERS ARE THE REFERENCE'S OWN, READ AGAINST ITS OWN KERB. Over the mid
// and far stretches the share of the corridor's surface that reads as stone runs
// 45 to 65 per cent at 0.60 m inside the kerb, 25 to 35 at 0.20 m, 10 to 20 at
// the kerb itself and under 8 past it (fondazione/lav/dirad.py, the same ruler
// on both pictures). The two ends below are solved for that curve against the
// share of bare pieces the tuning stands on, and the guard holds all four bands.
export const SPREAD = {
  // Where the thinning begins and where the stone has gone, in METRES from the
  // visible kerb: negative inside the paving, positive out on the brown.
  //
  // PAST ONE, WHICH IS THE POINT. `to` is beyond the nominal edge, so the last
  // stone does not fall on the last column of the corridor: a few pieces surface
  // out on the brown of the verge, which is S4 -- «ai margini del sentiero,
  // sulla terra bruna, ci sono i tasselli di sentiero» -- and it is what stops
  // the crossing being a line.
  //
  // AND THE CROSSING IS MEASURED IN PIECES AND NOT IN FRACTIONS. What the
  // committente calls «l'intersezione e' netta: una linea divide la terra bruna
  // dalla parte chiara» is arithmetic: a share that goes from nought to one over
  // 0.30 to 1.15 of a half width of 0.50 m crossed 0.42 m of ground, and BLOCK
  // is 0.40 -- the whole thinning happened across ONE piece, so it could only
  // ever be drawn as a line. Over the width this unit's own reading of the
  // reference puts on the corridor (pathHalfWidth in ../terrain-field.js, 0.78
  // at the middle of the field) the window below crosses 1.05 m, which is two
  // and a half pieces, and the reference's own curve -- 47.6 / 54.9 / 47.8 /
  // 42.9 / 40.3 per cent of stone from 0.70 m inside the kerb to the kerb, and
  // 27.5 outside it (U-SENT-2 2.1) -- is a long shallow fall and not a crossing.
  //
  // AND THE TWO ENDS ARE SET SO THE STONE CORE INSIDE THE CORRIDOR IS THE
  // REFERENCE'S OWN. The corridor is the full 1.6 m the reference reads
  // (pathHalfWidth in ../terrain-field.js); what its rows were counted at
  // before -- eight to twelve voxels through the middle of the field -- is the
  // PALE STONE inside it and not the corridor, and it is the number this window
  // now carries: the share of stone crosses a half at (from + to)/2 = 0.70 of
  // the half width, which at z = 4 is 1.14 m of stone core, eleven voxels.
  from: -0.48,
  to: 0.14,
  // How much of the thinning survives past the last stone of the run. Nought
  // would leave a ghost of the paving's composition in the ground where the
  // paving has ended; it fades with pathRun for the same reason the mat's own
  // ramp does (MANTO.verge in ../world/voxel/worldgen.js).
  fade: 1.0,
  // HOW MUCH OF ITS LEVEL THE STONE GIVES UP AT THE KERB. Measured on the day
  // target at the fitted camera, the pixels that read as stone run 130.0 at
  // 0.65 m inside the kerb and 112.8 at the kerb -- a fall of 13.2 per cent
  // (fondazione/lav/u4-terra.py) -- while the earth beside them climbs by 14.
  // A paving whose stone is as pale at the kerb as in its middle draws a bright
  // band along its own edge, which is «netti confini» read on the level.
  //
  // WRITTEN ON THE TONE AND MEASURED IN THE FRAME. The tone walks a ramp whose
  // two ends are 0.40 apart in luminance out of 0.43, so a share taken off the
  // tone arrives in the frame smaller than it left: swept through the chain at
  // the fitted camera, 0.132 on the tone moved the stone's own level by 3 per
  // cent of the 13 the reference asks for.
  dim: 0.42,
};

// HOW FAR PAST THE STONE THE VISIBLE KERB STANDS, in metres.
//
// THE BAND OF BARE EARTH BESIDE THE PAVING, AND IT IS ONE NUMBER HELD IN TWO
// PLACES BECAUSE NEITHER FILE MAY IMPORT THE OTHER. U-SENT-6 measured that the
// kerb the eye finds is not the last column of stone: it is the far side of the
// band where no blade of the mat stands (MANTO.verge.bare in
// src/world/voxel/worldgen.js), because a blade at the pose this campaign is
// judged from covers three to four times its own footprint and the ruler meets
// green at the first column that carries one. The mat's file owns the band; this
// file has to know where it ends, because the thinning of the stone is measured
// from there and because the paving's own family reaches to it.
//
// A GUARD HOLDS THE TWO TOGETHER (guard-tasselli), which is the only honest way
// to write one number twice: worldgen imports terrain-field and this file
// imports terrain-field, and an import either way round would close a ring.
export const KERB = 0.10;

// HOW FAR A PIECE STANDS PROUD OF THE CORRIDOR'S FLOOR, in metres.
//
// A CENTIMETRE AT THE TOP, WHICH IS HIS NUMBER AND NOT A FIT: «tasselli con
// altezza fino a 1 cm sopra il piano». Every piece draws its own out of its own
// name, so «sporgono in maniera diversa» is the distribution and not a jitter on
// one height.
//
// AND IT IS NOT GEOMETRY, AND THE NUMBERS SAY WHY. A centimetre is a tenth of
// this world's cell: laid as real steps it would want a sub-lattice of the
// corridor's tops with a vertical face on every piece -- about 1 250 pieces over
// the twenty eight square metres of corridor the disc carries, ten triangles
// each with the walls, so 12 500 against the 98 the whole corridor costs today,
// and every one of those walls is 2.1 pixels tall at five metres and under one
// past nine, which is a shimmer and not a stone. Painted, it is one number a
// piece in a map that already exists at the right pitch, one extra fetch, and it
// is exact at every distance because the frame draws it at the frame's own
// resolution. The measurement that decides it is in §2.3 of the verbale: at the
// pose the campaign judges on, the reference's own relief reads as a dark ring
// round each piece 1.7 cm wide and 17 levels deep, and only 4 of those 17 levels
// are directional. A tenth of a cell of true geometry cannot be bought with
// 12 400 triangles to draw four levels.
export const RELIEF = {
  // The tallest a piece stands.
  high: 0.010,
  // What a piece of BARE GROUND stands, as a share of that: the soil between and
  // over the stones is what the stones are bedded IN, so it lies lower than they
  // do and the stones read as laid on it rather than as set into it.
  earth: 0.35,
  // How much of the sun a piece's own shadow takes off the piece it falls on, at
  // a full step. ONE IS THE PHYSICS -- a shadowed patch keeps the sky and loses
  // the beam -- and it is written as a number rather than assumed so the guard
  // can hold it there.
  shade: 1.0,
  // And how much of BOTH terms the walls of a slot take, at a full step. A slot
  // between two pieces standing a centimetre proud is a groove: it sees less of
  // the sky as well as less of the sun, which is why this one multiplies the
  // pair rather than the beam. Fitted through the chain on a real render at the
  // fitted camera -- see the verbale -- against the reference's own contrast
  // inside the corridor's surface: 19.4% of the local level against our 15.2.
  //
  // AND IT COMES DOWN, ON A SWEEP THAT SAYS IT NO LONGER CARRIES WHAT IT WAS
  // FITTED TO CARRY. The 0.80 was solved through the chain when the slot's own
  // darkening entered over 3.5 mm, so `inSlot` was one over nearly the whole of
  // a slot; the darkening now eases over the slot's own two centimetres (see
  // JOINT_LIP), so the term reaches its full value only at the floor of a slot
  // and its weight at the judged pose has gone with it. Swept at the fitted
  // camera, 0.80 and 0.60 read sd 21.1 and 21.0 with the dark coda at -36.7 and
  // -36.6: the difference is under the reading's own noise. What the lower value
  // buys is the pose the committente walks at, where the term is not averaged
  // over a pixel and a groove that took four fifths of BOTH terms drew a black
  // line round every piece. Four tenths of the light at the floor of a slot one
  // centimetre deep is the ambient a groove that shape actually loses.
  //
  // AND IT RISES TO ONE, WHICH IS THE CEILING AND NOT A FIT. What the reference
  // draws round each of its pieces is a dark ring of +4.9 L* at the mid stretch
  // and +5.4 at the far one; this paving drew +3.7 and +1.9 (R3 §1.5,
  // fondazione/lav/tasselli.py). The two terms that draw that ring are this one
  // and the pigment of the slot above it, and this one is the half that is a
  // SHADOW: a groove a centimetre deep between two pieces a hand across sees
  // very little of either the beam or the sky, and one -- all of both terms at
  // the floor of the slot, nothing at its lip -- is the most a solid angle can
  // be asked for. Past one the frame would subtract light from a surface, which
  // is why the sky term is clamped where it is read (../voxel/material.js).
  // What it is worth is in the verbale, measured on the frame and not here.
  wall: 1.00,
  // AND THE MEAN THE TERM ABOVE TAKES, SO IT CANNOT MOVE THE LEVEL.
  //
  // This is the grain's own doctrine, and it is not tidiness: the level of this
  // stone was fitted against the meadow beside it and both readings E-V3g is
  // gated on are RATIOS between this surface and that one, so a contrast term
  // that also darkened the whole corridor would move a gate without moving
  // anything anybody asked for (material.js, «THE LEVEL IS A WALL»). The wall
  // term is therefore written about its OWN mean over the strip -- the share of
  // the strip that is inside a slot times the height of the piece there -- and
  // the painter prints that mean every run so this literal can be checked
  // against the map it describes.
  //
  // RE-TAKEN WITH THE EASING THE FRAGMENT ACTUALLY WRITES. The mean was the mean
  // of the binary mask, which was near enough to the term while the term entered
  // over 3.5 mm; the term now eases over the slot's own two centimetres (see
  // JOINT_LIP), so the mean of it is a third of what a mask reports. The painter
  // takes it the same way the fragment writes it and refuses the tile if this
  // literal has drifted from the map it describes.
  //
  // AND IT RISES WITH THE BLOCK HALVING AND THE FAMILY REACHING THE BARE BAND,
  // which is the whole reason the painter refuses a stale one: twice as many
  // pieces to the metre is twice as much slot for the term to live in, and the
  // surface the mean is taken over is now the paving family's own reach and not
  // the corridor alone. Re-taken by the painter over the map it actually wrote.
  mean: 0.0460,
};

/**
 * How far a piece of the paving stands over the corridor's floor, in metres.
 *
 * ASKED AT THE PIECE AND NOT AT THE POINT, like everything else about a piece:
 * a height that varied across a slab would be a slab that is not flat, and what
 * the reference shows is flat pieces at different heights.
 */
function pieceLift(id, bare) {
  const h = hash2(Math.round(id * 8191) + 1201, 5233);
  return RELIEF.high * (bare ? RELIEF.earth : 1) * h;
}

/**
 * The share of pieces that are bare ground rather than stone, at a seat.
 *
 * THE TUNING'S OWN SHARE IS THE FLOOR AND THE LATERAL TERM IS WHAT RISES: at the
 * middle of the run the answer is E-V3d's measurement unchanged (2 to 9 per cent
 * over the middle stretch, 5 to 17 over the apron -- which is the DEPTH half of
 * the thinning, already measured and already here), and toward the verge it
 * climbs to one. A term that replaced the tuning instead of standing on it would
 * be throwing away the reading that the apron carries more earth than the reach.
 */
function bareShare(base, x, z) {
  const d = kerbGap(x, z);
  if (d === null) return base;
  const out = smoothstep(SPREAD.from, SPREAD.to, d) * pathRun(z) * SPREAD.fade;
  return base + (1 - base) * out;
}

/**
 * How far a point stands from the VISIBLE kerb, in metres: negative inside the
 * paving, nought at the kerb, positive out on the brown. Null where there is no
 * corridor.
 *
 * THE NOMINAL HALF WIDTH AND NOT pathEdge, and the reason has not changed since
 * the window was a fraction: pathEdge carries the wobble, and a thinning tied to
 * a wandering edge wanders with it -- the share of stone would step up and down
 * along the run at the wobble's own three metres, which is a ripple in the
 * paving and not a kerb. The wobble belongs to where the last COLUMN falls; the
 * thinning is a property of the surface.
 */
function kerbGap(x, z) {
  const half = pathHalfWidth(z);
  if (!(half > 0)) return null;
  return Math.abs(pathOffset(x, z)) - (half + KERB);
}

/**
 * How far out across the corridor a point stands, as a fraction of the nominal
 * half width: nought on the centreline, one at the kerb, more outside it. Null
 * where there is no corridor.
 *
 * ONE SEAT, because three things now read it -- the share of bare pieces, how
 * dry the earth of a piece is and how pale its stone is -- and three copies of
 * the same division is how they come to disagree about where the kerb is.
 */
function lateral(x, z) {
  const half = pathHalfWidth(z);
  if (!(half > 0)) return null;
  return Math.abs(pathOffset(x, z)) / half;
}

/**
 * How DRY the earth of a piece is: nought for the damp trodden earth of the
 * middle of the run, one for the dry earth at the kerb, and back toward damp
 * outside it, where the reference's own earth is in the grass's shade and reads
 * 17 to 28 against the 60 it reads at the kerb (fondazione/lav/u4-terra.py).
 *
 * ASKED AT THE PIECE'S SEAT like everything else about a piece: a dryness that
 * varied across a slab of earth would be a slab with a gradient painted on it,
 * and what the reference shows is flat pieces at different levels.
 */
function earthDry(q) {
  if (q === null) return 1;
  return smoothstep(0.15, 1.0, q) * (1 - smoothstep(1.05, 1.9, q));
}

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

/**
 * The whole world point a lattice seat stands at, brought back out of the turn.
 *
 * THE WARP IS NOT UNDONE, and it does not have to be: what reads this is a SHARE
 * over a ramp a metre and a half wide, and the warp moves a seat by at most a
 * fifth of a block. Undoing it would want the inverse of a noise field, which
 * does not exist; carrying the error is 8 cm on a ramp of 150, and it is
 * declared here rather than hidden in a tolerance.
 */
function seatWorld(fx, fz) {
  const ax = fx - SHIFT[0];
  const az = fz - SHIFT[1];
  return { x: ax * TURN_COS - az * TURN_SIN, z: az * TURN_COS + ax * TURN_SIN };
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

  // THE SEAT AND NOT THE POINT, which is the same rule the tuning above is asked
  // by and for the same reason: a share evaluated per point steps across the
  // middle of a piece and leaves half a slab bare, which is the film the
  // committente threw out three times (see `tune`).
  const home = seatWorld(piece.seatX, piece.seatZ);
  const bare = hash2(Math.round(piece.id * 8191) + 53, 971)
    < bareShare(tune.bare[Math.min(3, cut) - 1], home.x, home.z);
  // THE IDENTITY OF A PIECE IS A LEVEL AND NOT A TINT, and that is a measurement
  // against the reading this chapter opened with. Between one slab and the next
  // the plan reference spreads its luminance by 25.0% of the mean and its
  // chromaticity by 1.1 to 1.3 points out of thirty -- and the spread BETWEEN
  // pieces is 0.78 of the spread WITHIN one, so the slabs are not even as
  // different from one another as each is varied inside itself. "Grey, beige and
  // rosy" is not what the material says; one stone at many levels is.
  const level = hash2(Math.round(piece.id * 8191) + 907, 4111);
  const q = lateral(home.x, home.z);
  return {
    ...piece,
    jm,
    gape,
    inSlot: jm <= gape,
    bare,
    warm: tune.warm,
    // THE RAMP IS CUT IN TWO AT A HALF AND THE TWO HALVES ARE THE TWO THINGS A
    // PIECE CAN BE, which is what the generator has always said and what the
    // pigment did not.
    //
    // WHAT WAS WRONG, MEASURED. A stone piece was written at
    // `level * (0.62 +/- 0.30)`, and with the apron's own level of 0.86 that is
    // 0.277 to 0.791 spread flat: 43 PER CENT OF THE STONE PIECES CAME OUT
    // UNDER A HALF and were drawn on the earth's side of the ramp, as a brown
    // that no stone of this paving is. That is one half of «tasselli strani,
    // forma che non rispecchia il target» -- pieces of stone painted as pieces
    // of earth, scattered through the run -- and it is why the corridor's own
    // stone reads 107 against the reference's 130 (fondazione/lav/u4-terra.py).
    //
    // Now the two halves are exclusive. Under a half is EARTH, from damp to
    // dry; over it is stone, from the worn slab to the palest. IDENTITY is
    // still the 0.25 the reference measures between one slab and the next, and
    // the tuning's own level still moves the whole ramp without touching it.
    //
    // AND THE STONE GIVES ITS LEVEL UP TOWARD THE KERB, which is the other side
    // of the same reading: the reference's stone runs 130.0 / 122.5 / 119.8 /
    // 112.8 from 0.65 m inside the kerb to the kerb, a fall of 13 per cent,
    // while the earth beside it climbs. The two converge, and that convergence
    // is the soft crossing the committente is asking for.
    tone: bare
      ? 0.5 * clamp01(earthDry(q) + 0.18 * (level - 0.5) * 2)
      : 0.5 + 0.5 * clamp01(tune.level
        * (1 - SPREAD.dim * Math.min(1, q === null ? 0 : q))
        * (0.62 + 0.25 * (level - 0.5) * 2.4)),
    // AND HOW FAR THE PIECE STANDS PROUD, which is the datum U-SENT-2 added and
    // the painter carries in the second channel of the tone strip. See RELIEF.
    lift: pieceLift(piece.id, bare),
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
// AND IT IS THE SPREAD AND NOT THE MEAN, WHICH IS THE READING THIS UNIT ADDS TO
// THE RESIDUE U-SENT-2 LEFT.
//
// Taken as percentiles of the LEVEL of every pixel of the corridor's own surface
// that is not grass -- a reading that needs no class and therefore cannot be
// moved by one (fondazione/lav/u4-terra.py) -- the mid stretch runs:
//
//                        p10     p50     p90
//     TARGET             27.9    89.0   147.5
//     ours, before       68.3    96.2   116.9
//
// The reference's paving spans a hundred and twenty levels and ours fifty five,
// and the whole of the difference is at the DARK end: its earth and its joints
// go down to a quarter of its stone and ours to two thirds. E-LUCE7's residue 3
// and U-SENT-2's residue 1 name the level of the STONE, which is a wall this
// unit does not own -- the paving is fitted against the meadow beside it and two
// gates are ratios between them. The EARTH is not that wall: it is the pigment
// of the soil between the stones, and it was authored a third too bright.
//
// AND ALL THREE OF THEM MOVE HERE, WHICH IS THE WALL OF E-LUCE7 REOPENED WITH A
// BERSAGLIO INSTEAD OF WITH A PREFERENCE.
//
// What the wall said was this: the level of this stone was fitted against the
// meadow beside it, two of the gates this chapter is weighed on are RATIOS
// between the two, and a session that raised the stone because it looked dark
// would move a gate without moving anything anybody asked for. That was the
// right rule and it is why the level stood still through U-SENT-2 and U-SENT-4.
// What it never had was a NUMBER on the far side of it, and R3 measured one:
// read on the day target at the fitted camera, piece by piece over the mid
// stretch, the reference's stone stands at L* 56.3 with a spread of 3.5 between
// pieces and a chroma of 31.7 at hue 80 -- a warm beige -- and its earth at 42.4
// with a chroma of 29.3; this paving answered L* 49.6 / C* 22.6 and L* 32.5 /
// C* 21.6 on the same instrument in the same frame. Ten levels of stone and ten
// of earth, and a hue that is grey-olive where the reference is beige.
//
// SO THE THREE PIGMENTS BELOW ARE SOLVED AGAINST THAT READING AND NOT CHOSEN.
// The bench is fondazione/lav/u7-livelli.mjs: the pigment through
// src/world/face-light.js's own two terms on an upward normal, through the
// material's own warmth, through AgX and through the delivery's LUT -- the same
// chain tools/lighting/render-chain.mjs gives guard-pietra -- read back as L*,
// C* and hue. Validated before it was believed: on the frame this world shipped
// BEFORE the fit, the bench answers stone L* 50.9 / C* 24.9 against the 49.6 /
// 22.6 the frame measures and earth L* 36.4 against 32.5, which is a level and a
// half on the stone and four on the earth, the earth's own gap being the slots
// the frame counts as earth and the bench does not.
//
// WHAT IS NOT MOVED, AND IT IS THE HALF OF THE WALL THAT STILL STANDS: not one
// constant of the LIGHT. The seal is untouched, the exposure is untouched, and
// the ratios two gates read between this surface and the meadow are moved only
// by what a PIGMENT of this surface is allowed to move. What that costs those
// gates is measured in the verbale and put to the coordinator rather than
// decided here.
export const EARTH = [0.3150, 0.2483, 0.1635];
// AND THE EARTH IS NOT ONE EARTH ACROSS THE CORRIDOR, WHICH IS THE MEASUREMENT
// THE «STACCO NETTO» IS.
//
// Read on the day target at the fitted camera against the corridor's own kerb --
// the crossing of half a share of green, found on each picture rather than
// assumed (fondazione/lav/u4-terra.py) -- over the mid stretch, the level and
// the chromaticity of the pixels that read as EARTH run:
//
//     from the kerb   -0.65   -0.37   -0.16   -0.01 m
//     level             52.6    54.8    58.6    60.1
//     (r-b)/(r+b)     +0.131  +0.162  +0.280  +0.352
//
// and ours, at the same ruler on our own render, read 76.1 / 75.3 / 74.6 / 76.5
// and +0.339 / +0.338 / +0.352 / +0.353: FLAT IN BOTH. The reference's earth
// gets brighter and warmer as it comes out from under the stone -- it is damp
// and trodden in the middle of the run and dry at the verge -- and ours is one
// brown from the middle to the grass. That is the whole of the «uno stacco
// netto» on the earth's side, and it is why the crossing reads as a line even
// where the share of stone is right.
//
// WRITTEN AS THE APRON'S WARM IS WRITTEN, and for its reason: a LEVEL and a
// CHROMATICITY off the one pigment, so the earth stays one material and the
// reading that fitted it is not re-solved twice. `level` is the damp end over
// the dry one (52.6 / 60.1) and `cool` is the rotation the frame has to arrive
// at (0.352 - 0.131), applied so it cannot move the level.
// AND THE ROTATION IS NOT THE WHOLE 0.221, WHICH IS A READING ABOUT THE READING.
// A pigment rotated by the full figure comes out with more blue in it than red
// (EARTH's own (r-b)/(r+b) is 0.111), and damp earth is not blue: what the ruler
// counts as EARTH half a metre inside the kerb is mostly the SLOT between two
// pale slabs, and a slot is lit by the sky alone, which under this seal is
// 0.133 / 0.478 / 1. So most of that 0.221 is the joint's own light and belongs
// to the light, where this material already puts it (RELIEF.wall). What is
// carried here is the part a pigment can honestly claim -- a quarter of it --
// and the rest is named rather than baked into a brown.
export const EARTH_DAMP = { level: 0.875, cool: 0.055 };
// The two ends of the stone's own ramp, and they are the pair the whole identity
// between one piece and the next is a step along.
//
// BEIGE AND NOT GREY-OLIVE, WHICH IS A CHROMATICITY AND A LEVEL AT ONCE. The
// pair that stood here was a measurement of the same stone off the same
// reference and it was taken on the LEVEL alone; read as a hue it answers 90 to
// 106 degrees at a chroma of 20, and the reference reads 80 at 31. Through the
// bench above the pair below develops to L* 57.8 / 59.1 / 62.1 at the tenth,
// fiftieth and ninetieth of the pieces this law lays over the mid stretch, at
// C* 30.7 and hue 80.
export const STONE = [0.491, 0.440, 0.327];
export const STONE_PALE = [0.900, 0.747, 0.460];
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
//
// AND THE PAIR DEEPENS WITH THE STONE THAT STANDS EITHER SIDE OF IT. The
// reference's joints run 9 to 10 levels of L* under its own stone and so did
// ours -- the relative darkness was already right and R3 says so -- but the
// stone has just risen by nine levels, and a share taken off a brighter pigment
// has to be a bigger share to arrive at the same distance below it. Measured on
// the bench above: at 0.18 / 0.21 the slot under the new stone develops to L*
// 53.9, six levels under its own piece where the reference is ten; at 0.25 /
// 0.40 it develops to 49.9, which is nine and a half.
export const JOINT_DARK = [0.25, 0.40];
// How deep into the slot the darkening is fully in, in metres, and where the lip
// gives way to the trough on the way. The two bands are the reading's own:
// within a centimetre of stone, and more than two from any.
//
// ONE EASING AND NOT TWO STEPS, AND THAT IS THE «MAPPA TOPOGRAFICA».
//
// What was here was a step 3.5 mm wide at the slot's own edge and a SECOND step
// from one centimetre in to two -- two thresholds on one distance field, so
// every joint was drawn as two closed outlines nested inside each other, with
// the relief's own wall term riding on the first of them for a third. Read at
// walking distance, where a slot 3.5 cm wide covers thirty pixels, that is a
// contour map: «l'intersezione e' netta», «linee concentriche». And the field
// the thresholds are read on is stored 7.8 mm to a texel across the run and
// 8.4 along, so a threshold 3.5 mm wide falls INSIDE one texel and the outline
// it draws is the bilinear lattice of the map rather than the edge of a stone --
// which is the staircase on every piece.
//
// So the darkening is now ONE monotone easing over the slot's own depth, with
// no knee and no plateau anywhere in it, and its narrowest feature is 2 cm --
// two and a half texels of the map that carries it. The two measured levels are
// still the two ends of it: nought on the stone, JOINT_DARK[0] where the lip
// gives way, JOINT_DARK[1] at the floor of the slot.
export const JOINT_LIP = [0.010, 0.020];
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

// Where the joints stop being drawn, in metres from the eye.
//
// MOVED HERE FROM THE LAYER THAT USED TO HANG THE CORRIDOR'S OWN SURFACE, with
// its reason unchanged: past about twenty metres a joint of three centimetres is
// under a pixel, so the tail buys no definition and costs fill. A ramp of six
// metres and not a step, because a step is a ring on the ground standing at a
// fixed distance from the eye, which is the family of defect
// guard-sentiero-bande refuses.
export const JOINT_FADE = [19, 26];
// And where the tile of grain and small stones stops. Nearer, because what it
// carries is a centimetre band: it is gone from the picture by ten metres.
export const GRAIN_FADE = [12, 18];

/**
 * THE PIGMENT OF THE PAVING, AND IT IS ONE SEAT.
 *
 * Two things read this: the frame, in the fragment of
 * src/world/layers/v3-sentiero.js, and the plan patches the shapes are fitted on
 * offline. They are two implementations of one arithmetic and that is a debt
 * rather than a design -- GLSL cannot call this -- so it is written once here in
 * the form the fragment mirrors line for line, and the two are held together at
 * the far end instead of at the near one: what check-slabs --plan gives a
 * VERDICT on is a real render at the plan's own pose, and the offline patch is only the
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
  // THE RAMP IS CUT IN TWO AT A HALF, AND THE TWO HALVES ARE THE TWO THINGS A
  // PIECE CAN BE. Under a half it is earth, walked from the damp trodden brown
  // of the middle of the run to the dry brown of the kerb; over it, stone, from
  // the worn slab to the palest. See the note on `tone` in paveAt.
  let ramp;
  if (tone < 0.5) {
    const dry = tone * 2;
    // The damp, and it is a LEVEL and a CHROMATICITY off the one pigment so the
    // earth stays one material: see EARTH_DAMP.
    const lvl = EARTH_DAMP.level + (1 - EARTH_DAMP.level) * dry;
    const cool = EARTH_DAMP.cool * (1 - dry);
    ramp = [EARTH[0] * lvl * (1 - cool), EARTH[1] * lvl, EARTH[2] * lvl * (1 + cool)];
  } else {
    ramp = STONE.map((v, i) => v + (STONE_PALE[i] - v) * ((tone - 0.5) * 2));
  }
  // The warm of the apron, and it is a CHROMATICITY and not a level: what was
  // measured between the two stretches is +0.135 of (r-b)/(r+b) inside one band
  // of the frame, where the picture's own corner shading divides out. Applied so
  // that it cannot move the level the ratios were read at.
  const warm = TUNING.apron.warm * apron;
  const tint = [1 + warm, 1, 1 - warm];
  const out = [ramp[0] * tint[0], ramp[1], ramp[2] * tint[2]];

  const bite = 1 + near * GRAIN_GAIN * (grain - 0.5);
  for (let i = 0; i < 3; i++) out[i] *= bite;

  // THE SMALL STONE TAKES THE STRETCH'S OWN WARM, and it did not.
  //
  // The pigment laid over the ground here was the bare STONE_PALE, mixed in at
  // 0.92 over an albedo that had already been through the apron's warm and the
  // family's brown -- so on the near run, where the warm is fully in, every
  // small stone was a COLD grey blot on a warm ground. That is the
  // «macchie grigie» of E-DECISIONI11 in one line: not the stones, their
  // chromaticity. They are stones of this paving and they wear what the paving
  // wears.
  const inStone = smoothstep(PEB_EDGE[0], PEB_EDGE[1], stone) * near * PEB_MIX;
  for (let i = 0; i < 3; i++) {
    const peb = STONE_PALE[i] * tint[i] * (PEB_LEVEL[0] + PEB_LEVEL[1] * grain);
    out[i] += (peb - out[i]) * inStone;
  }

  // ONE MONOTONE EASING AND NOT TWO STEPS: see JOINT_LIP.
  const eased = smoothstep(0, JOINT_LIP[1], depth);
  const dark = 1 - eased * (JOINT_DARK[0] + (JOINT_DARK[1] - JOINT_DARK[0]) * eased);
  for (let i = 0; i < 3; i++) out[i] *= dark;
  return out;
}

// ---------------------------------------------------------- WHAT DIED HERE
//
// THE SURFACE. Everything from this line to the end of the file was the corridor
// as a MESH, and it is gone because the corridor is columns of the meadow's own
// store (PATH in src/world/voxel/worldgen.js, and the family that draws them in
// src/world/voxel/material.js). It was, with the state it stood at before this:
//
//   FOOT                path.js:920   where the surface was opaque, and the four
//                                     millimetres it was lifted by
//   drawnGroundAt       path.js:994   the ground as the bent grid DREW it, which
//                                     the surface had to be laid on rather than
//                                     on the field the grid sampled
//   pathHoleAt          path.js:1025  the footprint V1's disc laid no column under
//   pathCoverAt         path.js:1038  how much of the surface was standing
//   pathHeightAt        path.js:1050  where the surface stood, lift and all
//   floorGapAt          path.js:1062  how far the walker's floor was from it
//   pathNormalAt        path.js:1073  the tilt of it, solved on the CPU
//   MESH {18, 108}      path.js:1091  and pathMesh at :1100 -- 3 638 triangles
//   holeReport          path.js:1170  what the contract said about the footprint
//   pathLightAt         path.js:1198  the pair the surface lit itself with
//   PATH_BUDGET         path.js:1210  1 draw, 3 638 triangles of a budget of 4 000
//
// AND EVERY ONE OF THEM WAS THE PRICE OF THE HOLE. A surface laid over a hole in
// another surface has to know where the other one is DRAWN and not merely where
// it is; it has to be lifted off it, and the lift is a step, so the step has to
// be tapered to nothing at an edge, and the taper needs a cover, and the cover
// needs a fade, and the walker needs a contract branch saying which of the two
// he is standing on. There is one surface now and the whole of that machinery
// has nothing left to be the price of.
//
// WHAT SURVIVES IS THE PAVING ITSELF -- the lattice, the two tunings, the joints,
// the shoulder, the small stones, the grain, the pigment, every constant above
// this line -- because it was never a fact about a mesh. It is what the painter
// in tools/path/ bakes the three maps from and what the fragment reads them
// with, and neither of those two ever asked where the triangles were.

export { pathHalfWidth, pathRun };
