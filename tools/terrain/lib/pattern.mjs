// The noise the stone is painted with.
//
// It was written for two painters -- the ground's atlas and the stair's -- and
// it says the same value noise, the same jittered lattice and the same pigment
// to both, because the slabs of the path and the treads of the stair are the
// same rock and a second implementation of the grain would make them two
// different rocks lit by the same sun. ONE of those painters is left,
// tools/terrain/paint-stairs.mjs, and the argument is unchanged: what it draws
// still has to be the rock the rest of the world is made of.

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

// WHERE THE PAVING'S JOINTS WERE, AND WHY THEY ARE NOT HERE ANY MORE.
//
// Four hundred lines stood between the lattice above and the pigment below: the
// turned and warped seat of the slabs, the share of blocks cut into four or
// nine, the width of a joint per joint, the erosion at the verge, and the band
// limit that told a painter how much of all that a texel of the ground atlas
// could carry. Three readers asked for it -- paint-path-strip.mjs, which wrote
// terrain-path.png, check-strip-register.mjs, which refused the delivery if the
// two painters ever fell out of register, and check-slabs.mjs, which held the
// pattern to the reference.
//
// ALL THREE PAINTED OR MEASURED THE GROUND'S ATLAS, and the ground has none: at
// step 8 terrain-albedo, terrain-light, terrain-detail and terrain-path left the
// delivery, because nothing in src had asked for one of them since the meadow
// became cubes. The corridor that is left has its OWN seat, src/world/path.js,
// with its own lattice and its own three maps written by tools/path/
// paint-path.mjs; a second lattice describing a paving nobody draws is not a
// spare, it is a second answer to a question with one.
//
// `atlasSpan` went with them and took the last import of the bend --
// uvToWorld and worldToUv, deleted from src/world/terrain-field.js at step 7 --
// so this file now asks src for nothing at all.

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
// the measurement that holds still: tools/terrain/fit-albedo.mjs (retired at
// step 8 with the atlas it fitted) on the ground
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
// (tools/terrain/fit-albedo.mjs before it was retired, six path patches the
// reference does not
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
