// The noise the ground and the stone are painted with.
//
// Both painters need the same value noise, the same band limiting and the same
// jittered lattice, and they have to agree: the slabs of the path and the treads
// of the stair are the same rock, and a second implementation of the grain would
// make them two different rocks lit by the same sun.

import { smoothstep, uvToWorld, worldToUv } from '../../../src/world/terrain-field.js';

export function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Value noise. With a `period` it is the same noise on a TORUS instead of on
 * the plane: the lattice index wraps every `period` cells, so a field sampled
 * over [0, period) meets itself exactly at the seam and the picture tiles.
 *
 * An argument rather than a second function, because a second function would be
 * a second implementation of this noise, and the whole point of this file is
 * that there is only one. A caller that passes no period gets exactly what it
 * always got: the wrap is arithmetic on the lattice index and nothing else
 * changes.
 */
export function noise(x, z, period = 0) {
  const wrap = period > 0 ? (i) => ((i % period) + period) % period : (i) => i;
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash2(wrap(ix), wrap(iz));
  const b = hash2(wrap(ix + 1), wrap(iz));
  const c = hash2(wrap(ix), wrap(iz + 1));
  const d = hash2(wrap(ix + 1), wrap(iz + 1));
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

/**
 * Summed octaves, with the fine ones faded out by `detail`.
 *
 * A texel of the outer meadow covers metres of ground; running the fine octaves
 * there would draw a field of noise rather than a surface, so the caller passes
 * how much detail this texel can still resolve.
 */
export function fbm(x, z, octaves, detail) {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let o = 0; o < octaves; o++) {
    const keep = o < 2 ? 1 : detail;
    sum += noise(x * frequency, z * frequency) * amplitude * keep;
    total += amplitude * keep;
    amplitude *= 0.5;
    frequency *= 2.07;
  }
  return sum / (total || 1);
}

/**
 * Nearest site of a jittered lattice: the slabs, and the joints between them.
 * The distance between the nearest and the second nearest site is what draws
 * the joint, and it is zero exactly on the line between two slabs.
 *
 * IT NAMES THE JOINT AS WELL AS THE SLAB. `id` is the slab this point belongs
 * to and `id2` the one across the joint from it; `edge` is a name for the JOINT
 * ITSELF, hashed off the unordered pair, so it reads the same from either side.
 * A real pavement does not have one joint width: it has a hairline between two
 * slabs that were cut together and a finger's breadth of soil between two that
 * were not, and a width can only be given per joint if the joint has a name.
 * `id2` is what tells the two sides apart, which is how a worn lip can be put
 * on one of them instead of ringing both.
 */
export function slab(x, z, scale, period = 0) {
  const px = x / scale;
  const pz = z / scale;
  const ix = Math.floor(px);
  const iz = Math.floor(pz);
  // With a `period` the lattice lives on a torus, exactly as noise() does with
  // one: the cell index is wrapped before it is hashed, so the cell just inside
  // one edge of a tile and the cell just outside the other are the same cell and
  // the pattern closes on itself. The jitter is taken from the wrapped index and
  // laid at the UNWRAPPED site, or a site near the seam would be measured from
  // the wrong side of the tile.
  const w = period > 0 ? (i) => ((i % period) + period) % period : (i) => i;
  let best = Infinity;
  let second = Infinity;
  let bx = 0; let bz = 0; let sx = 0; let sz = 0;
  let seatX = 0; let seatZ = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cz = iz + dz;
      const hx = w(cx);
      const hz = w(cz);
      const jx = cx + 0.15 + 0.7 * hash2(hx, hz);
      const jz = cz + 0.15 + 0.7 * hash2(hx + 7919, hz + 104729);
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
  // width halfway across itself. On the WRAPPED index, so that a joint met from
  // one side of the seam and from the other is the same joint; with no period
  // the wrap is the identity and this is what it always was.
  const bwx = w(bx); const bwz = w(bz);
  const swx = w(sx); const swz = w(sz);
  const first = bwx < swx || (bwx === swx && bwz < swz);
  const ax = first ? bwx : swx;
  const az = first ? bwz : swz;
  const cx2 = first ? swx : bwx;
  const cz2 = first ? swz : bwz;
  return {
    joint: second - best,
    id: hash2(bwx + 31, bwz + 17),
    id2: hash2(swx + 31, swz + 17),
    edge: hash2(ax * 3 + cx2 * 7 + 61, az * 3 + cz2 * 11 + 149),
    // WHERE THE SLAB SITS, in the caller's own coordinates.
    //
    // It is here so that a field can be sampled ONCE PER SLAB instead of once
    // per point. A wear that is sampled per point is a wear that crosses joints,
    // and a stain that crosses a joint welds two slabs into one thing — which is
    // what the committente saw on 2026-08-26 and called a film spread over the
    // whole path. Asked at the seat, the same field gives every slab ONE value
    // and the variation lives BETWEEN the pieces, which is where a pavement's
    // variation lives.
    seatX: seatX * scale,
    seatZ: seatZ * scale,
  };
}

// ------------------------------------------------- where the paving's joints are
//
// EVERYTHING BELOW IS ONE SEAT FOR ONE QUESTION: given a point of the world, is
// there a joint at it, and how wide is that joint.
//
// It lived inside tools/terrain/paint-albedo.mjs while there was exactly one
// reader. A second painter now has to answer the SAME question about the same
// ground — tools/terrain/paint-path-strip.mjs, which writes the distance to the
// nearest joint so the frame can rebuild an edge the atlas is too coarse to
// draw — and the two answers have to be the same answer, not two answers that
// resemble each other.
//
// AND THE FAILURE THIS PREVENTS IS NOT A FINE MISALIGNMENT. The lattice is not
// asked at (x, z). It is asked at (x, z) turned twenty-seven degrees, pushed by
// two scales of noise, and shifted by two constants. A second painter that
// called slab(x, z, PLATE) directly would not draw the same paving a few
// millimetres out of register; it would draw a DIFFERENT paving, structurally
// unrelated to the first, and the two would disagree about which slab a point
// belongs to. That is why the transformation moved here whole rather than being
// written twice, and why tools/terrain/check-strip-register.mjs refuses the
// delivery if the two readers ever stop agreeing.

// The lattice of the slabs, in metres.
//
// MEASURED AS A RATIO TO THE PATH, because that is the only thing the close
// reference can say without a camera: across its own rows a slab covers a third
// to two thirds of the width, so one to three of them cover it, and this path is
// 1.2 to 2.5 metres wide over the walkable stretch. 1.15 m is two slabs across
// the middle of it.
//
// It replaces 1.9 m, which was one slab across and was chosen when the joints
// were a hairline and the slab could not be seen at all. It is NOT a return to
// the 62 cm of the honeycomb: what made that read as a net was a uniform joint
// on a lattice a fifth of this size, and the joint here is uniform in nothing.
// AND IT IS THE BLOCK NOW AND NOT THE PIECE — see cutsInto() below. A share of
// the blocks are one slab of this size and the rest are cut into four or nine,
// so the SIZES that come out of the lattice run from a third of a metre to well
// over one, which is what the committente asked for on 2026-08-28 and what a
// single pitch cannot give however hard it is jittered.
export const PLATE = 0.98;
// How far the edges of a slab wander off the lattice, as a fraction of it. Two
// scales, because one scale draws a scallop: a long lobe the size of the slab
// and a short roughness on top of it.
//
// AND THE FIRST OF THEM HAS COME DOWN HARD, WHICH IS THE COMMITTENTE'S READING
// OF 2026-08-28 AND A MEASUREMENT SAYING THE SAME THING. His words: the paving
// of the plan reference is MIXED in size, ANGULAR and irregular — not the
// rounded convex pieces this ground was delivering. A jittered lattice draws
// STRAIGHT boundaries between its sites; what curved them was this number. At
// 0.26 of a 74 cm cell the lobe is nineteen centimetres at a wavelength of
// eighty, which bends every edge into an arc over its own length; the pieces
// that come out are convex blobs and the crop says so
// (s3-dev10/look/maschera.png, the mask of both pictures side by side).
//
// It is not taken to nought, because a lattice with no warp at all is a Voronoi
// diagram and reads as one: every piece convex, every vertex three-way, no
// re-entrant corner anywhere. The reference has plenty of re-entrant corners. So
// the lobe is small enough that an edge stays nearly straight over its own
// length and large enough that a piece need not be convex, and the burr is
// raised to put a centimetre-scale ragged edge on it — which the plan reference
// has at every scale it can be measured at and this ground had at none.
export const PLATE_WARP = [0.085, 0.115];
// A third scale of push, finer than the burr, and the one that answers for the
// TATTER of the reference's edges.
//
// Measured (s3-dev10/forma.mjs, the turning of the mask boundary): at a chord of
// forty-five millimetres the reference holds its direction over 10.2% of its
// boundary and this ground over 18.7 — the reference's outline is BROKEN at the
// centimetre where ours is smooth. Its wavelength is a fifteenth of a block, so
// nothing at the scale of a piece moves, and its amplitude is a couple of
// centimetres, which is what the atlas and the strip can still carry between
// them: the strip is seven millimetres across the run and twenty-three along, so
// an edge that wanders at four centimetres survives and one that wanders at one
// does not.
export const PLATE_TATTER = [0.030, 15.0];
// Where the lattice's own origin sits, so that a seat read back out of it can be
// brought home. It used to be two numbers written straight into the call and
// nothing read them back — which was fine while nothing asked the lattice WHERE a
// slab was, and became a bug the moment something did: the seat came back in this
// shifted space, the distance from a point to its own slab's middle came out
// eight metres instead of half of one, and the gentle slope meant to run across a
// slab became a per-slab constant that took whole slabs to black and to white.
// Named here, and subtracted where the seat is used.
export const PLATE_SHIFT = [3.13, 8.71];

// The joint, in metres. A hairline between two slabs that were cut together,
// most of a finger between two that were not, and the width belongs to the
// JOINT and not to the slab — slab() above names it, so both sides of one slot
// agree about how wide they are.
// The narrowest is not a hairline: a texel of the ground atlas is fifteen
// millimetres across the run, so a joint thinner than about two of them is
// written as nothing at all and the pavement goes back to being one pan. The
// reference's tightest joints ARE hairlines, and they are the one thing about it
// that atlas cannot hold — measured, not assumed (s3-dev3, the texel footprint
// of the path: 9 to 15 mm across, 12 to 86 along). It is the floor the path
// strip exists to lower: a distance field does not draw a step, it says where an
// edge IS, and where an edge is survives a coarser texel than the edge does.
// AND BOTH HAVE COME DOWN, WHICH IS A MEASUREMENT OFF THE PLAN REFERENCE AND THE
// COMMITTENTE'S OWN WORD "SOTTILI".
//
// The gap width at deciles, over the nine windows of sentiero-texture.png against
// this ground's own plan render (s3-dev10/forma.mjs):
//
//     decile        10th   25th   50th   90th
//     REFERENCE     0.8    1.7    3.5    9.1   cm
//     this ground   1.2    2.5    5.4   14.0   cm
//
// Half again too wide at every one of them, and the crop says the same thing
// louder than the table does. Part of that is the atlas — a texel of it is 34 mm
// at this pose and a mask taken on a smoothed level reads a joint wider than it
// is painted — which is exactly the floor the strip exists to lower, and the
// strip is now in the picture. What is left is paint, and this is the paint.
export const JOINT_FINE = 0.020;
export const JOINT_WIDE = 0.045;
// How the widths are spread between the two. Above one, most pairs sit near the
// hairline and a few gape; the reference has rather more open joints than
// tight ones once the tight ones are counted at the width they really are.
export const JOINT_SKEW = 1.7;
// SIZE IS NOT A PROPERTY OF THE JOINTS, AND THE ATTEMPT TO MAKE IT ONE IS ON THE
// RECORD HERE BECAUSE IT COST A ROUND.
//
// A jittered lattice at one pitch gives pieces at one size, and both readings of
// the committente ask for the opposite — "irregular stone slabs, in thickness and
// in SIZE" (2026-08-26) and "mixed sizes, thirty centimetres to a metre and
// beyond" (2026-08-28). The cheap way to get a spread out of one lattice looked
// like LEAVING SOME JOINTS OUT: two cells with no line between them read as one
// piece, three of them as a longer one, and the sizes that come out are cluster
// sizes.
//
// It does not work, and the reason is structural. Every field of this paving that
// belongs to a piece is asked at the piece's own SEAT and therefore steps at every
// CELL boundary, whether a joint was drawn on it or not. A missing joint does not
// merge two pieces; it hides the line between two pieces that still look
// different, which is worse than either — and it is what the committente named on
// 2026-08-26 as the soft pale and dark blobs inside what reads as one slab.
// Merging them for real means naming a CLUSTER from inside one cell, and the
// one-hop version of that does not close: two cells either side of a missing joint
// do not agree about which of their neighbours is the smallest.
//
// cutsInto() below does it from the other end and closes by construction: the
// coarse cell decides how finely IT is divided, so every point knows its piece
// without walking anything, and both sides of every joint agree because they are
// in the same coarse cell. The share of joints left out is therefore nought and
// the mechanism is gone.

/**
 * How much of the atlas's own detail a texel of it can still resolve.
 *
 * A texel of the outer meadow covers metres of ground and a texel of the near
 * ground covers centimetres, so the painters fade their fine octaves out with
 * the texel's own footprint. It is stated here as a LAW over a span rather than
 * as a function of a point, because the two painters do not have the same texel:
 * paint-albedo.mjs knows its span from the loop it is already in, and the strip
 * painter has to ask what the ATLAS's span would be at a world point it reached
 * some other way. One law, two ways of measuring the span it is given.
 */
export const bandLimit = (span) => 1 - smoothstep(0.06, 0.35, span);

/**
 * The span of an atlas texel at a world point, in metres.
 *
 * For a reader that has a world point and needs the number paint-albedo.mjs
 * would have had at the same place. It goes back through the bend rather than
 * being handed the atlas coordinate, because a strip texel is not an atlas texel
 * and there is no atlas coordinate to hand it.
 */
export function atlasSpan(x, z, size) {
  const { u, v } = worldToUv(x, z);
  const here = uvToWorld(u, v).x;
  return Math.abs(uvToWorld(u + 1 / size, v).x - here) + 1e-4;
}

/**
 * Where the lattice is asked, for a point of the world.
 *
 * Returns the two numbers slab() is called with — NOT the world point, and not
 * the world point turned. See the note above for why the difference is the whole
 * of it.
 *
 * @param {number} x, z   metres, world
 * @param {number} plate  slab size in metres, normally PLATE
 * @param {number} detail how much fine octave the reader's texel can hold
 */
export function slabSpace(x, z, plate, detail) {
  // Turned twenty-seven degrees off the world's own axes. A jittered lattice
  // puts its sites in the middle seven tenths of each cell, so the joint
  // statistic has a minimum on every lattice plane; indexed straight off x and z
  // one of those planes is x = 0, which is the bearing the path runs along, and
  // a plane of extra joint parallel to the run is a faint dark line down the
  // path for its whole length. Turned, no lattice plane can run ALONG the path.
  const fx = x * 0.891 + z * 0.454;
  const fz = z * 0.891 - x * 0.454;
  const lobeA = fbm(fx * 0.92 / plate + 11, fz * 0.92 / plate + 29, 2, detail) - 0.5;
  const lobeB = fbm(fz * 0.92 / plate + 53, fx * 0.92 / plate + 7, 2, detail) - 0.5;
  const burrA = fbm(fx * 3.4 / plate + 71, fz * 3.4 / plate + 13, 2, detail) - 0.5;
  const burrB = fbm(fz * 3.4 / plate + 97, fx * 3.4 / plate + 37, 2, detail) - 0.5;
  // The tatter, at a wavelength a fifteenth of a block: the ragged centimetre of
  // a broken edge. It is a single octave of the same noise and not an fbm,
  // because an fbm here would put half its energy below what any texture in this
  // world can hold and the rest of it would only blunt what is above.
  const tatA = noise(fx * PLATE_TATTER[1] / plate + 131, fz * PLATE_TATTER[1] / plate + 59) - 0.5;
  const tatB = noise(fz * PLATE_TATTER[1] / plate + 17, fx * PLATE_TATTER[1] / plate + 191) - 0.5;
  const fine = detail * PLATE_TATTER[0];
  return {
    fx: fx + plate * (PLATE_WARP[0] * lobeA + PLATE_WARP[1] * burrA + fine * tatA)
      + PLATE_SHIFT[0],
    fz: fz + plate * (PLATE_WARP[0] * lobeB + PLATE_WARP[1] * burrB + fine * tatB)
      + PLATE_SHIFT[1],
  };
}

// HOW MANY PIECES A BLOCK IS CUT INTO, WHICH IS WHERE THE MIXTURE OF SIZES COMES
// FROM.
//
// THE COMMITTENTE, 2026-08-28, deciding that the shape of the paving follows
// sentiero-texture.png: sizes MIXED, thirty centimetres to a metre and beyond,
// the big slabs of his own frames INSIDE the mixture. A jittered lattice at one
// pitch cannot answer that: it gives pieces at one size with a jitter on it, and
// measured against the reference this ground's pieces were half again too big at
// EVERY decile — 1.7 / 3.8 / 8.4 / 25.0 cm against 1.1 / 2.3 / 5.2 / 14.6.
//
// DEV-S3k's own attempt at a spread was JOINT_MISSING, and it is on the record
// why it was taken to nought: a joint that is not drawn leaves two pieces of
// DIFFERENT TONE with no line between them, because every field of this paving is
// asked at the piece's own seat and therefore steps at every cell boundary. The
// pieces were never merged, only the line between them was hidden — which is
// worse than either.
//
// This merges them properly, from the other end. A COARSE lattice at PLATE is
// asked first, and its cell — a BLOCK — decides, off its own identity, whether it
// is one slab or is cut into four or into nine by a lattice of PLATE/2 or
// PLATE/3. Every point then belongs to exactly one piece and both sides of every
// joint agree about which piece each of them is in, because the decision depends
// only on the BLOCK, and two points either side of a fine joint are in the same
// block by construction. There is no cluster to walk and nothing to close.
//
// Shares by BLOCK and not by area, which is the point: a third of the blocks stay
// whole and they are the largest pieces in the picture, while the other two
// thirds break into four and nine and supply the small ones. At PLATE = 0.98 m
// the three sizes are about one metre, half of one, and a third.
export const CUT_SHARES = [0.30, 0.34, 0.36];
export function cutsInto(id) {
  const h = hash2(Math.round(id * 8191) + 137, 6421);
  if (h < CUT_SHARES[0]) return 1;
  if (h < CUT_SHARES[0] + CUT_SHARES[1]) return 2;
  return 3;
}
// How wide a joint INSIDE a block is against one between two blocks. Two slabs
// cut from the same stone and laid together meet along a hairline; two blocks
// laid at different times have soil between them. It is also what keeps the
// subdivision from reading as a second net over the first.
export const JOINT_CUT = 0.42;

/**
 * How far the paving has broken up at this point, nought to one.
 *
 * Shared for the same reason the lattice is: it is what OPENS the joints, so a
 * reader that has it wrong has every joint width wrong at the verge, which is
 * exactly where the paving gives out and where the widths matter most.
 */
export function paveErosion(x, z, d, detail) {
  return smoothstep(0.60, 1.00, d)
    * smoothstep(0.28, 0.74, fbm(x * 0.75 + 301, z * 0.75 + 117, 3, detail));
}

// WHICH PIECES OF THE PAVING ARE GROUND RATHER THAN STONE.
//
// Looked at from straight above, sentiero-texture.png is not slabs with channels
// between them: it is big pale slabs FLOATING IN AREAS of packed fine gravel, and
// the gravel areas are the same size as the slabs. Measured on it,
// tools/terrain/check-slabs.mjs --plan finds 59.5% of the ground is quiet stone
// and the ordinary piece is 5.2 cm from the nearest dark ground; this paving
// answered 74.1% and 11.3 cm, which is a pavement with nothing between its pieces
// but its joints. The committente's own chosen frame has the same shape as the
// photograph: pale clusters with dark broken areas between them.
//
// So a share of the pieces are ground. Off the piece's OWN identity, so the
// removal has the outline of the piece it removes and both sides of every joint
// agree about which of them is stone.
// AND THE SHARE IS PER CUT, WHICH IS WHAT KEEPS THE GROUND FROM SWALLOWING THE
// PICTURE. Read off the mask of both pictures side by side
// (s3-dev10/look/nuovo.png): the reference's areas of ground are MANY and each
// one is about the size of a slab — a tenth of a metre to a quarter — while this
// ground's were FEW and enormous, because a share taken over pieces of one size
// bares whole blocks and two bare blocks that touch are one area of a square
// metre. Baring mostly the pieces that have been CUT puts the ground back at the
// size the photograph has it and leaves the big pale slabs, which are the half of
// his direction that a share by piece cannot tell apart.
export const BARE_SHARE = [0.12, 0.34, 0.40];
export const isBare = (id, cut) => hash2(Math.round(id * 8191) + 53, 971)
  < BARE_SHARE[Math.min(BARE_SHARE.length, cut) - 1];

/**
 * The width of one joint, in metres, from its own name.
 *
 * `narrow` is how much of a block joint's width this one gets: one for a joint
 * between two blocks, JOINT_CUT for one inside a block that has been cut.
 */
export function jointWidth(edge, ero, narrow = 1) {
  return narrow * (JOINT_FINE + (JOINT_WIDE - JOINT_FINE) * edge ** JOINT_SKEW)
    * (1 + 2.4 * ero);
}

const mixId = (a, b) => hash2(Math.round(a * 8191) * 3 + 11, Math.round(b * 8191) * 7 + 29);

/**
 * THE ONE SEAT: which piece of the paving a point of the world stands on, and
 * the joint nearest to it.
 *
 * Every reader of this paving goes through here — the two painters, the register
 * gate and the anti-weave reading — because the failure a second copy produces is
 * not a fine misalignment but a DIFFERENT paving, and none of the guards
 * downstream can see it. See the long note over slabSpace().
 *
 * @returns {{jm:number, gape:number, inJoint:boolean, id:number, edge:number,
 *   seatX:number, seatZ:number, cut:number, pitch:number, step:number,
 *   lip:boolean}}
 *   `jm` is how far this point stands from the middle of the nearest joint, in
 *   metres, and `gape` how wide that joint is; `id` names the PIECE and `edge`
 *   the joint; `step` is how far apart the two pieces at that joint are and `lip`
 *   says whether this side of it is the proud one — both taken at the level the
 *   joint belongs to, so the two sides of one joint always agree.
 */
export function pave(x, z, detail, ero, plate = PLATE) {
  return paveFrom(slabSpace(x, z, plate, detail), ero, plate);
}

/**
 * The same answer, from a seat already in hand.
 *
 * It exists so that tools/terrain/check-strip-register.mjs can BREAK the seat on
 * purpose — the three injections it refuses the delivery for — without a second
 * copy of everything below, and so that the breaking happens where it belongs,
 * in the gate, rather than as a hook carried through this file.
 */
export function paveFrom(seat, ero, plate = PLATE) {
  const big = slab(seat.fx, seat.fz, plate);
  const jmBig = big.joint * plate;
  const cut = cutsInto(big.id);
  const blockJoint = () => ({
    jm: jmBig,
    gape: jointWidth(big.edge, ero, 1),
    edge: big.edge,
    step: Math.abs(big.id - big.id2),
    lip: big.id > big.id2,
  });
  let piece = {
    id: big.id, seatX: big.seatX, seatZ: big.seatZ, cut, pitch: plate,
  };
  let joint = blockJoint();
  if (cut > 1) {
    const fine = slab(seat.fx, seat.fz, plate / cut);
    piece = {
      id: mixId(big.id, fine.id),
      seatX: fine.seatX,
      seatZ: fine.seatZ,
      cut,
      pitch: plate / cut,
    };
    const jmFine = fine.joint * (plate / cut);
    if (jmFine < jmBig) {
      joint = {
        jm: jmFine,
        gape: jointWidth(mixId(big.id, fine.edge), ero, JOINT_CUT),
        edge: mixId(big.id, fine.edge),
        step: Math.abs(fine.id - fine.id2),
        lip: fine.id > fine.id2,
      };
    }
  }
  return { ...piece, ...joint, inJoint: joint.jm <= joint.gape };
}

export const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// The rock of the path and of the stair, as albedo. Measured off the worn slabs
// of the reference and divided back out of the light a flat lit surface
// receives from this sky.
//
// Refitted with the meadow: solving the path patches for the radiance they have
// to carry says the slabs are half again as bright as they were painted, and a
// shade cooler. It is a pale weathered stone, not a mid grey one.
//
// AND REFITTED AGAIN under the light of S2, where the ground is lit by a sun for
// the first time. Only the HUE moved, and only because the hue is the part of
// the measurement that holds still: tools/terrain/fit-albedo.mjs on the ground
// the reference does not contradict gives a median gain of 0.834 / 1.044 / 1.054
// with its level divided out, and the red is under one on every one of the four
// path patches (0.67, 0.86, 0.89, 0.88). The LEVEL of that gain is not applied,
// because it is not constant across the set: it runs with distance, which is a
// difference of light and not of pigment, and the light is what the two
// strengths and GROUND_EXPOSURE carry.
//
// STONE_WORN is left where it was. It is the tread of the stair, and the only
// measurement on it (probe.mjs, the "stairs" patch) reads 4.47 dE76 — the best
// in the set. Moving a constant nothing measured wrong is how a fit spreads.
//
// AND RESAMPLED A THIRD TIME, under the corner shading the frame really carries.
// The model that inverts the reference used to hold its own copy of that shading
// at 0.16; it now reads 0.42 out of the one sede that owns it, and 0.42 is not
// 0.16 evenly — the term grows with the square of the distance from the middle
// of the frame, so it moved the bottom of the picture by a seventh and the
// middle of it by a twenty-fifth. Every fit taken through the old copy therefore
// carried a false TILT down the frame, and a tilt down the frame is read by an
// inversion as a change of hue.
//
// So the whole set was solved again, and this is what it answers now
// (tools/terrain/fit-albedo.mjs, six path patches the reference does not
// contradict): median hue 0.964 / 1.006 / 1.189, and the spread beside it
// 0.76..1.05, 0.97..1.02, 0.97..1.55. The green is the one number in the set
// that is worth anything — it is tight to a fortieth and it says ONE, so the
// slabs' green is confirmed. The red is within four hundredths of one across a
// spread of a third, and the blue is not a measurement at all: it runs with the
// level patch by patch, which is the signature of two afternoons' light and not
// of a pigment.
//
// NOTHING MOVES. Not one of the three constants below is accused by a
// measurement that can hold still, and the whole reason this resampling was
// owed is that the last one moved the red by 0.834 on a median with no spread
// printed beside it. The same solve under the corrected shading asks for 0.964
// on that red: the correction that was applied was four fifths of the way to
// nothing, and it is not compounded here.
export const STONE = [0.242, 0.315, 0.313];
export const STONE_DARK = [0.158, 0.210, 0.215];
export const STONE_WORN = [0.430, 0.440, 0.430];
