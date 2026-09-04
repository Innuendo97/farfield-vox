// THE BLOCK STORE, AND THE FOUR NUMBERS THE WHOLE WORLD IS MEASURED IN.
//
// This is the bottom of the engine: the step, the chunk, the disc, and the
// place the ground is KEPT. Nothing here knows what shape the world has --
// src/world/voxel/worldgen.js writes that in -- and nothing here draws
// anything. It is the one file both of those import, which is what keeps the
// dependency a line and not a ring.
//
// ===========================================================================
// WHY A STORE AT ALL, AND WHY THIS ONE.
//
// The ground used to be a FUNCTION of a point, sampled and rounded at the
// moment a cube was drawn. Every consequence the campaign spent months on
// followed from that one decision: a path could only be a deformation of the
// function because there was no cell to write a material into; a material was
// a threshold re-evaluated at meshing time rather than a property of a place;
// "put a mound here" was impossible without adding a second function; and the
// height map was the SOURCE instead of a cache derived from the blocks, so a
// feature that changed the profile was invisible to everything that asked how
// high the ground was.
//
// A grid of blocks is the truth of a voxel world and the height is a
// consequence. That is the whole of the pivot, and this file is where it lands.
//
// AND IT IS A STRATIFIED HEIGHTFIELD AND NOT A 3D ARRAY, because this world has
// no caves. A dense array over the disc at thirty five metres would be 490 000
// columns times the height of the tallest thing on them; four bytes and a
// fraction a column covers the same ground, gives an edit in constant time, and
// transfers to the worker as four typed arrays with nothing to serialise.
//
//   top      Int16Array   the topmost voxel of the column, in whole steps
//   mat      Uint8Array   what that voxel is made of
//   under    Uint8Array   what the flank below it is cut into
//   depth    Uint8Array   how many voxels `under` runs before generic earth
//
// FIVE BYTES A COLUMN, MEASURED AND NOT THE FOUR AND A HALF THE PROPOSAL
// ESTIMATED: two plus one plus one plus one. At the largest disc any tier lays
// that is 2.45 MB if every column were resident at once, and none of them is --
// the store is cut per chunk, on demand, and thrown away when its mesh is made.
// ===========================================================================

/** The one step, in metres. */
export const VOXEL = 0.10;

// ONE STEP, AND NO RING OF STEPS.
//
// Ten centimetres, everywhere the hand can reach. A ladder of sizes anchored to
// the world is only ever the right size in ONE PLACE: the walker wanders over a
// disc twenty one metres across, so a ring measured for the middle of the hub is
// wrong by an order of magnitude under their own feet at the rim. Measured on
// the shape that tried it, the ground under the walker read 134 pixels a cube
// against the target's 12 -- wrong by eleven times.
//
// So there is one step here, and the shell beyond it is the bent grid that
// already exists, with its heights quantised. Anything that reintroduces a
// second step reintroduces that defect, however it is dressed up.

// AND THE MAT OF GRASS IS NOT THAT DEFECT, WHICH IS WHY IT IS WRITTEN HERE AND
// NOT SMUGGLED IN SOMEWHERE ELSE.
//
// What the note above refuses is a LADDER of sizes anchored to the world: a
// ring measured for the middle of the hub, wrong by an order of magnitude under
// the walker's own feet at the rim. That is a second step whose relation to the
// first depends on WHERE you stand, and it is the defect that read 134 pixels a
// cube against the target's 12.
//
// The blade is the opposite of that. It is one step, the same everywhere, and
// it is a whole DIVISION of the step above -- two blades to a cube on each
// axis, four blade columns to a column of world -- so a blade boundary is
// always a cube boundary or the exact middle of one, no seam anywhere has to be
// invented, and the arithmetic stays in whole numbers. The relation between the
// two is a constant of this file and not a function of a place.
//
// AND IT IS THE TARGET'S OWN MEASUREMENT AND NOT A CONVENIENCE. E-ERBA-A read
// the blade of grass at 5.5-6.0 cm -- 0.60 of our cube, with a control that
// reads 1.087 where the truth is 1.000 -- and the coordinator took 5 cm over
// the 6 (D-E1 = A) because the 17% it costs in fidelity is bought back in every
// seam of the world. The three answers and their prices are written over MANTO
// in ./worldgen.js.

/** The step of the mat, in metres. */
export const BLADE = 0.05;

/** How many blades a column of the world is wide, on each axis. */
export const BLADES_PER_VOXEL = 2;

// AND HOW FINELY THE MAT IS MEASURED UPWARD, WHICH IS NOT THE SAME NUMBER.
//
// The blade is 5 cm wide because that is what the target's blade measures
// (E-ERBA-A 1.1) and because it is a whole division of the cube. Its HEIGHT is
// kept in quarters of that, and the reason is E-DECISIONI10 G3: «erba e steli
// possono avere altezze diverse dai voxel normali -- voxel PIU' BASSI,
// composizioni piu' minuziose dove serve (infittimento/diradamento attorno a
// creste, prominenze, pilastri, sentiero)». A mat that could only be one, two or
// three blades tall cannot thin out «in maniera GRADUALE e giustificata»; it can
// only step.
//
// FOUR AND NOT MORE, and the bound is the byte: a height in quarter blades over
// a mat that stands five blades at its tallest is twenty of the two hundred and
// fifty five a byte holds, and the rest is headroom nothing has asked for. It
// costs no triangle -- see bladeAtColumn() in ./worldgen.js.
export const SUB = 4;

// Columns per side of a chunk. Sixty four because that is the tiling the sweep
// over the walker's positions was measured with, including the penalty for the
// merges that die at a chunk's edge: changing it here would make the demo's
// fusion number and the world's estimate two different measurements.
export const CHUNK = 64;

// What a column that is not there reads as. The smallest value the type holds,
// so no arithmetic on a real top can ever reach it.
export const NO_COLUMN = -32768;

/**
 * What a cell is made of.
 *
 * A SMALL CLOSED SET AND NOT A STRING, because it is stored once per column and
 * compared once per neighbour pair in the mesher: the greedy merge asks whether
 * two cells are the same material several hundred thousand times to lay one
 * disc, and a byte compare is what makes that free.
 *
 * AIR IS NOT "NOTHING KNOWN", IT IS "NOTHING HERE ON PURPOSE". Where a column
 * is absent the material says WHY, and that is load-bearing rather than tidy:
 * the mesher has to tell the rim of the disc -- the edge of a piece, no part of
 * the world -- from the corridor's own bank, which is ground, and the two draw
 * differently. It used to ask a predicate about the world at meshing time; now
 * the generator writes the answer down where it made the decision.
 *
 * PATH AND STONE ARE SEATS AND THEY ARE EMPTY TODAY. The corridor is still
 * drawn by its own surface and the masonry by its own courses, so nothing lays
 * a column of either yet; the corridor's footprint is marked PATH so the reason
 * for the hole survives into the mesher, and STONE is written down here so that
 * the step which lays it does not have to change this file's meaning.
 */
export const MATERIAL = {
  AIR: 0,
  GRASS: 1,
  EARTH: 2,
  PATH: 3,
  STONE: 4,
};

/**
 * An empty store over a rectangle of columns.
 *
 * THE RECTANGLE IS IN GLOBAL VOXEL INDICES AND CARRIES ITS OWN ORIGIN, which is
 * what lets one chunk's store hold the SKIRT of columns beyond its own edge. A
 * wall on a chunk's boundary has to be measured against the ground past it or
 * every chunk grows a full height curtain round its whole rim; the mesher used
 * to buy that by calling the field two hundred and sixty extra times, and now
 * the generator writes those columns into the same store.
 *
 * @param {number} ox  global voxel index of the first column along x
 * @param {number} oz  global voxel index of the first column along z
 * @param {number} w   columns along x
 * @param {number} d   columns along z
 */
export function createColumns(ox, oz, w, d) {
  const top = new Int16Array(w * d);
  top.fill(NO_COLUMN);
  return {
    ox,
    oz,
    w,
    d,
    top,
    mat: new Uint8Array(w * d),
    under: new Uint8Array(w * d),
    depth: new Uint8Array(w * d),
    // AND THE MAT, AT FOUR TIMES THE RESOLUTION AND ONE BYTE A BLADE.
    //
    // A SIXTH ARRAY AND NOT A SIXTH FIELD OF A COLUMN, because it is not a
    // property of a column: there are FOUR of these to every column of the
    // world, and folding four heights into one byte of a column would be the
    // sub-lattice written down as a bit trick instead of as a grid.
    //
    // WHAT IT COSTS. Four bytes a column on top of the five the store already
    // holds -- so nine, not five -- and at the largest disc any tier lays that
    // is 4.4 MB if every column were resident at once, which none of them is:
    // the store is cut per chunk, on demand, and thrown away when its mesh is
    // made. The peak is one chunk's worth, 17 424 bytes at CHUNK 64 with the
    // skirt, and it never leaves the worker: the mat travels as TRIANGLES like
    // everything else.
    //
    // AND THE SKIRT COMES FOR FREE FOR THE MESHER, AND IS BOUGHT FOR THE SUN.
    // The blade rectangle is the column rectangle doubled, so ONE column of
    // skirt is two blades -- one more than the mesher needs to compare a blade
    // against its neighbour across a chunk's edge. The shadow below needs as
    // many blades of skirt as the sun's own march is long, and the seat that
    // widens the rectangle for it is chunkColumns in ./worldgen.js: this file
    // holds no opinion about how wide a store is, only about what one holds.
    blade: new Uint8Array(w * BLADES_PER_VOXEL * d * BLADES_PER_VOXEL),
    // AND WHERE THE SUN STOPS REACHING THE MAT, ON THE SAME LATTICE AND IN THE
    // SAME UNIT, WHICH IS THE ONE THING A BLADE CANNOT WORK OUT ON ITS OWN.
    //
    // The height of a blade is a property of its own column: one hash, no
    // neighbour (bladeHeightAt in ./worldgen.js). The SHADOW on it is the
    // opposite -- it is what the blades UPWIND of it are, along a bearing the
    // whole world shares -- so it is baked once, here, where every neighbour is
    // already in one array, and read back as a number exactly the way the
    // height is.
    //
    // WHAT ONE BYTE HOLDS: the world height of the line between light and
    // shadow on this blade column, in SUB-steps of a blade above y = 0, which
    // is the plane's own drawn surface. Nought means the sun reaches all the
    // way down to the plane. It is the SAME unit the mat's heights are kept in
    // -- a quarter of a blade, 1.25 cm -- so the line is quantised exactly as
    // finely as the thing that casts it, and one byte spans 3.19 m where the
    // tallest thing this lattice carries stands under one.
    //
    // WHY A HEIGHT AND NOT A PAIR OF FACTORS. A factor for the top and one for
    // the flank would be two bytes, and it would answer a question the fragment
    // can already answer for itself: it knows its own y. One height compared
    // against that y gives the top, the flank, the part of a flank above the
    // line and the part below it -- which is the profile E-ERBA-A 1.6 measured
    // in centimetres from the foot -- out of one read and one subtraction.
    //
    // AND IT COSTS FOUR MORE BYTES A COLUMN, so thirteen: the peak is still one
    // chunk's worth and it still never leaves the worker as an array. What
    // leaves is the chunk's own square of it, which becomes texels.
    shade: new Uint8Array(w * BLADES_PER_VOXEL * d * BLADES_PER_VOXEL),
    // AND HOW HIGH THE MAT ITSELF STANDS THERE, WHICH IS A SECOND LINE AND NOT
    // A SECOND COPY OF THE FIRST.
    //
    // The top of the blade the LAW puts on this column, in the same unit, and it
    // is not the top of the blade the mesher DRAWS: beyond the detail ring a
    // block of blades is meshed at one height, because triangles are what the
    // frame cannot afford. This line is what the mat really is, and the light of
    // a place is the light of the mat that is really there -- so it carries the
    // fall E-ERBA-A 1.6 measured inside a face, and it carries the LOD's own
    // error paid back in light instead of geometry. The bake in ./worldgen.js
    // states both in as many words.
    sky: new Uint8Array(w * BLADES_PER_VOXEL * d * BLADES_PER_VOXEL),
    // AND HOW WIDE THE BLADE IS, IN EIGHTHS OF ITS OWN CELL.
    //
    // E-DECISIONI10 G3, the committente's own words: «larghezza da 3/4 a 1 voxel
    // completo, altezza variabile». Eight is the whole cell and is what the mat
    // has always been; six and seven are the three quarters and the seven
    // eighths, and a blade that carries one of them stands APART from its
    // neighbours -- which is what a blade of grass does, and what lets the eye
    // see down between them.
    //
    // NOUGHT IS "FULL WIDTH" AND IS THE DEFAULT, so an empty store is the mat
    // that shipped before this array existed. The mesher reads it as the one
    // thing that takes a blade out of the greedy: a rectangle inset inside its
    // own cell cannot be merged with the cell beside it, and that is the whole
    // of what this costs. The seat that decides WHERE it is nought is
    // MANTO.slim in ./worldgen.js, and it is a threshold on the field of
    // intensity because that is where the width is free.
    slim: new Uint8Array(w * BLADES_PER_VOXEL * d * BLADES_PER_VOXEL),
  };
}

/** Where a global blade column sits in a store's mat, or -1 if outside it. */
export function bladeIndex(store, bx, bz) {
  const i = bx - store.ox * BLADES_PER_VOXEL;
  const j = bz - store.oz * BLADES_PER_VOXEL;
  const w = store.w * BLADES_PER_VOXEL;
  if (i < 0 || j < 0 || i >= w || j >= store.d * BLADES_PER_VOXEL) return -1;
  return j * w + i;
}

/** How many blades stand on one column of the mat. Nought outside the store. */
export function bladeAt(store, bx, bz) {
  const k = bladeIndex(store, bx, bz);
  return k < 0 ? 0 : store.blade[k];
}

/** Lays the mat on one column of the sub-lattice. */
export function setBlade(store, bx, bz, h) {
  const k = bladeIndex(store, bx, bz);
  if (k < 0) return;
  store.blade[k] = h;
}

/**
 * Where the sun stops reaching one column of the mat, in SUB-steps above y = 0.
 *
 * Nought outside the store, which reads as "lit all the way down" -- the safe
 * answer for a question asked past the edge of a piece, where there is nothing
 * to cast anything.
 */
export function shadeAt(store, bx, bz) {
  const k = bladeIndex(store, bx, bz);
  return k < 0 ? 0 : store.shade[k];
}

/** How high the mat closes over one column, in the same unit and the same way. */
export function skyAt(store, bx, bz) {
  const k = bladeIndex(store, bx, bz);
  return k < 0 ? 0 : store.sky[k];
}

/** How wide a blade stands, in eighths of its cell. Nought is the whole cell. */
export function slimAt(store, bx, bz) {
  const k = bladeIndex(store, bx, bz);
  return k < 0 ? 0 : store.slim[k];
}

/** Writes those lines on one column of the sub-lattice. */
export function setShade(store, bx, bz, sun, canopy) {
  const k = bladeIndex(store, bx, bz);
  if (k < 0) return;
  store.shade[k] = Math.max(0, Math.min(255, sun));
  store.sky[k] = Math.max(0, Math.min(255, canopy));
}

/** Where a global column sits in a store's arrays, or -1 if it is outside it. */
export function columnIndex(store, ix, iz) {
  const i = ix - store.ox;
  const j = iz - store.oz;
  if (i < 0 || j < 0 || i >= store.w || j >= store.d) return -1;
  return j * store.w + i;
}

/** The topmost voxel of a column, in whole steps, or NO_COLUMN. */
export function topAt(store, ix, iz) {
  const k = columnIndex(store, ix, iz);
  return k < 0 ? NO_COLUMN : store.top[k];
}

/** What the top of a column is made of. AIR where no column stands. */
export function matAt(store, ix, iz) {
  const k = columnIndex(store, ix, iz);
  return k < 0 ? MATERIAL.AIR : store.mat[k];
}

/** What the flank under the top of a column is cut into. */
export function underAt(store, ix, iz) {
  const k = columnIndex(store, ix, iz);
  return k < 0 ? MATERIAL.AIR : store.under[k];
}

/** How many voxels the flank material runs before generic earth. */
export function depthAt(store, ix, iz) {
  const k = columnIndex(store, ix, iz);
  return k < 0 ? 0 : store.depth[k];
}

/**
 * What the cell at a whole height is made of.
 *
 * THE STRATIFICATION IN ONE FUNCTION, and it is the only place the four arrays
 * mean anything together: the top voxel is `mat`, the `depth` voxels under it
 * are `under`, and everything below that is the earth every column in this
 * world stands on. Above the top there is air.
 *
 * @param {number} h  the height of the cell, in whole voxels
 */
export function cellMaterialAt(store, ix, iz, h) {
  const k = columnIndex(store, ix, iz);
  if (k < 0) return MATERIAL.AIR;
  const t = store.top[k];
  if (t === NO_COLUMN || h > t) return MATERIAL.AIR;
  if (h === t) return store.mat[k];
  if (t - h <= store.depth[k]) return store.under[k];
  return MATERIAL.EARTH;
}

/**
 * Lays a column: its top, and what that top is made of.
 *
 * The flank is left as it was, so a pass that only moves a column up or down
 * does not silently repaint what it is cut into.
 */
export function setTop(store, ix, iz, h, mat) {
  const k = columnIndex(store, ix, iz);
  if (k < 0) return;
  store.top[k] = h;
  store.mat[k] = mat;
}

/**
 * Raises a column by whole voxels and says what the new flank is cut into.
 *
 * THE EDIT THE WHOLE PIVOT WAS FOR. "Put a mound here" is this, once per column
 * the mound covers, in constant time each; on a field that was a function it
 * was either a second function summed into the first or an array of differences
 * -- which is this store, in a worse form.
 *
 * A raise on a column that is not there does nothing: masses are set down ON
 * the ground, and a mound that grew out of the corridor's hole would be a mound
 * standing on the paving.
 */
export function raise(store, ix, iz, n, mat) {
  const k = columnIndex(store, ix, iz);
  if (k < 0 || store.top[k] === NO_COLUMN || n <= 0) return;
  store.top[k] += n;
  store.under[k] = mat;
  store.depth[k] = Math.min(255, n);
}

/**
 * Says what the flank under a column's top is cut into, and how deep the cut
 * goes, without moving the column.
 *
 * `raise` above sets both as a side effect of lifting a column, which is what a
 * mass wants; a pass that only paints -- the corridor's earth verge, at step 4
 * -- wants to say it without lifting anything.
 */
export function setFlank(store, ix, iz, mat, depth) {
  const k = columnIndex(store, ix, iz);
  if (k < 0 || store.top[k] === NO_COLUMN) return;
  store.under[k] = mat;
  store.depth[k] = Math.min(255, Math.max(0, depth));
}

/** Repaints the top of a column without moving it. */
export function paintTop(store, ix, iz, mat) {
  const k = columnIndex(store, ix, iz);
  if (k < 0 || store.top[k] === NO_COLUMN) return;
  store.mat[k] = mat;
}

/**
 * Takes a column away, and says why it is gone.
 *
 * The reason is the material, and it is the whole point: the rim of the disc
 * and the corridor's own footprint are both "no column here", and the mesher
 * draws the ground beside them differently. AIR is the edge of the piece; PATH
 * is a seat somebody else fills.
 */
export function clearColumn(store, ix, iz, reason = MATERIAL.AIR) {
  const k = columnIndex(store, ix, iz);
  if (k < 0) return;
  store.top[k] = NO_COLUMN;
  store.mat[k] = reason;
  store.under[k] = MATERIAL.AIR;
  store.depth[k] = 0;
}

/** How many columns of a store's own rectangle actually stand. */
export function columnCount(store) {
  let n = 0;
  for (let k = 0; k < store.top.length; k++) if (store.top[k] !== NO_COLUMN) n++;
  return n;
}

/** How many bytes a store holds, so the cost of a disc can be added up. */
export function storeBytes(store) {
  return store.top.byteLength + store.mat.byteLength
    + store.under.byteLength + store.depth.byteLength + store.blade.byteLength
    + store.shade.byteLength + store.sky.byteLength + store.slim.byteLength;
}
