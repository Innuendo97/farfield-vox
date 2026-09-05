// THE FIELD: THE SAME GROUND, KEPT AS A PICTURE INSTEAD OF AS TRIANGLES.
//
// A texel a blade -- five centimetres near the walker, forty out to the ridge
// -- holding the four numbers a fragment needs to rebuild the mat and the floor
// under it, plus a pyramid so a ray can skip the empty air over them. This file
// is the ARITHMETIC of that picture and nothing else: no three.js, no texture,
// no upload. It is reachable from ./pure.js, which is what lets a guard lay the
// same texel offline and compare it against the block store, and it is the
// reason the field can never become a second opinion about where the ground is
// -- every byte below is written out of the store the greedy mesher reads, or
// out of the one law that store is filled from.
//
// WHY A TEXEL AND NOT A VERTEX. The rule at the head of ./mesher.js is that
// nothing per voxel may ride on a vertex attribute, because that is what lets a
// merged rectangle stand for a hundred cubes. The field takes the rule to its
// end: NOTHING rides on a vertex at all. There are no vertices. What a fragment
// needs comes out of one texture read at the cell the ray stopped in.
//
// ---------------------------------------------------------------------------
// TWO WINDOWS, AND WHY THE SECOND ONE HAD TO EXIST (phase two, E-DECISIONI14).
//
// Phase one drew the field over the DISC and left everything past it to a sheet
// that ran to a hundred metres. E-DECISIONI13 retired that sheet: past the
// plateau the ground falls in terraces to the water and climbs into a ridge
// that closes the horizon, and all of it is columns. A field that only reached
// the walker's own fifty metres would therefore end in mid air.
//
// So there are two pictures and one program:
//
//   THE NEAR WINDOW  5 cm a texel, 51.2 m across, FOLLOWING THE WALKER, updated
//                    toroidally as they walk. It is the meadow blade by blade.
//   THE FAR WINDOW   40 cm a texel, 409.6 m across, STANDING STILL over the
//                    middle of the world. It is the boundary: the terraces, the
//                    ridge, and the same meadow read eight times coarser.
//
// AND THE FAR ONE DOES NOT MOVE, WHICH IS THE WHOLE OF WHY IT IS CHEAP. The
// walker never leaves the plateau -- thirty five metres of a four hundred metre
// picture -- so a window centred on the WORLD covers everything they can ever
// see, is built once, and is never updated again. A far window that followed
// the eye would pay a toroidal update for a view that does not change.
//
// The two are exactly a factor of EIGHT apart, which is not a taste: it makes a
// far texel line up with level three of the near pyramid, so the same traversal
// walks both with one level counter and the seam between them is a change of
// which texture answers and nothing else.
//
// ---------------------------------------------------------------------------
// WHAT ONE TEXEL HOLDS, AND WHY EACH CHANNEL IS THE ONE IT IS.
//
//   R  the BLADE standing on this column, measured from the ground under it, in
//      SUB-steps of a blade -- a quarter of a blade, 1.25 cm, which is the unit
//      ./columns.js already keeps the mat in, so nothing is quantised twice.
//      One byte spans 3.19 m, over ten times the tallest blade the law draws.
//   G  the top of the GROUND, in whole VOXELS, biased by CAMPO_BIAS so that a
//      byte can hold ground BELOW the plateau as well as above it. The pair is
//      what makes a mound a piece of the field instead of a second
//      representation: the ray sees one solid up to G and a blade over it.
//   B  what the column is made of, how narrow its blade stands, whether it is
//      there at all, and whether its WALL is soil -- packed, because the
//      plateau's own column reads a blade of nought and would otherwise be
//      indistinguishable from a hole.
//   A  the tint of the COLUMN, which is the pigment's own field sampled at the
//      integer column exactly as the fragment of ./material.js samples it. It
//      is written here rather than hashed in the shader for the reason §2.4 of
//      the performance dossier gives: the producer of a texel should be one
//      thread, and the tint arrives in the same fetch as the height for
//      nothing. The hue rides the slow octave and is still drawn in the
//      fragment, because it is a second field and not this one.
//
// WHY THE HEIGHT IS TWO UNITS AND NOT ONE, WHICH IS THE CHANGE PHASE TWO FORCED.
// Phase one kept both R and G as the ABSOLUTE height in quarter-blades: one
// byte, 3.19 m, and every ground in the world stood between nought and the
// tallest mound. The boundary breaks that in both directions at once -- the
// basin falls ten metres and the ridge climbs fifteen -- and a quarter-blade
// byte cannot hold twenty five metres. Splitting the pair is what makes it fit
// WITHOUT losing a millimetre of either: the ground is always a whole number of
// voxels, so counting it in voxels loses nothing at all and buys 25.5 m of
// range; and the blade, which is the thing that needs the fine unit, keeps it,
// measured from the ground it stands on instead of from y = 0.
//
// WHAT IS NOT IN A TEXEL, ON PURPOSE. The line where the sun stops reaching a
// column -- ./worldgen.js bakes it into store.shade -- is NOT stored. It is a
// march over the tops along the seal's own bearing, and the field can walk it
// at the moment it shades, out of the very same heights, for eight fetches that
// the measurement says are free. A stored copy would be a second answer to a
// question the picture already contains, and it would stop following the sun.
// ---------------------------------------------------------------------------

import {
  BLADE, BLADES_PER_VOXEL, CHUNK, MATERIAL, NO_COLUMN, SUB, VOXEL,
} from './columns.js';
import { CENTRE, MANTO, chunkColumns, columnSpec } from './worldgen.js';
import { PIGMENT, pigTint } from './pigment.js';

/** How many SUB-steps of a blade one voxel of the world is worth. */
export const CAMPO_RUNG = BLADES_PER_VOXEL * SUB;

/**
 * How far below y = 0 a ground byte can reach, in VOXELS.
 *
 * A HUNDRED, AND IT IS THE BOUNDARY'S OWN NUMBER AND NOT A ROUND ONE. The basin
 * falls 9.85 m at the far window's own edge (204.8 m) and the ridge crowns at
 * 15.4 m over the plateau at its tallest bearing; a bias of a hundred voxels
 * puts the byte's range at -10.0 m to +15.5 m, which holds both with the
 * boundary's dials at their delivered values and little to spare either way.
 * THE GUARD ASSERTS THAT, sweeping the law rather than trusting this comment --
 * the day V5 raises the ridge, it fails there instead of drawing a flat crown.
 *
 * What is outside it is the DIAGONAL CORNERS of the far window, past 207 m,
 * where the basin has fallen past ten metres. They are clamped, they stand
 * behind the ridge or under three quarters of the air's own haze at every pose
 * a walker can reach, and they are declared here rather than found later.
 */
export const CAMPO_BIAS = 100;

/**
 * Where each level of the pyramid stands in the one texture that carries them
 * all, and why they are in ONE texture rather than in a mip chain.
 *
 * A mip chain is the natural home for a pyramid and it is the wrong one here.
 * The window moves toroidally, so a tile's write has to land at level L at a
 * position that is level L's own; three.js reaches a mip level of a data
 * texture only through a full re-upload of the image, and the raw path needs
 * the texture object out of the renderer's private properties. Laid side by
 * side in one level-nought image, every write is the SAME call at a different
 * rectangle, the sampler needs no mip filtering at all (every fetch is a
 * texelFetch at level nought, which is what the DDA wants anyway), and the
 * shader's own addressing is one offset it is handed.
 *
 * What it costs is the space between the levels: 1536 x 1024 against the
 * 1365 x 1024 the levels themselves come to, so 1.5 MB of the six is padding.
 */
function campoAtlas(shape) {
  const origins = [{ x: 0, y: 0 }];
  let x = shape.side;
  let y = 0;
  for (let level = 1; level < shape.levels; level++) {
    const size = shape.side >> level;
    // Two columns: the first level of the strip is half the field and starts a
    // column of its own; the rest stack under it until they would run past the
    // bottom, then step right by the width of the level that just filled up.
    if (y + size > shape.side) {
      x += shape.side >> (level - 1);
      y = 0;
    }
    origins.push({ x, y });
    y += size;
  }
  const width = origins.reduce((w, o, level) => Math.max(w, o.x + (shape.side >> level)), 0);
  return { width, height: shape.side, origins };
}

/** Where each level of ONE TILE stands inside the tile's own image. */
function campoTileLayout(shape) {
  const origins = [{ x: 0, y: 0 }];
  let x = 0;
  const y = shape.tile;
  for (let level = 1; level < shape.levels; level++) {
    origins.push({ x, y });
    x += shape.tile >> level;
  }
  return { width: shape.tile, height: shape.tile + (shape.tile >> 1), origins };
}

/**
 * The shape of one picture, and every number in it is a power of two on
 * purpose.
 *
 * THE SIDE AND THE TILE ARE THE WHOLE OF WHY THE TOROIDAL UPDATE IS TRIVIAL. A
 * tile is 128 texels and the picture is 1024, so exactly eight tiles a side. A
 * tile's square therefore lands on a multiple of its own size at EVERY level of
 * the pyramid and can never straddle the wrap -- which turns "update a moving
 * window" into seven sub-rectangle writes with no clipping and no split. A side
 * that was not a whole number of tiles would need four writes a level and a
 * case analysis for each.
 *
 * @param {object} options
 * @param {number} options.cell   metres a texel of the finest level covers
 * @param {number} options.side   texels a side of the finest level
 * @param {number} options.levels how many levels the pyramid has, finest first
 * @param {number} options.tile   texels a side of one tile
 * @param {boolean} options.still whether the window stands over the world
 *                                instead of following the walker
 */
export function campoShape({
  cell, side = 1024, levels = 7, tile = CHUNK * BLADES_PER_VOXEL, still = false, name = '',
}) {
  const shape = {
    name,
    /** Metres a texel of the finest level covers. */
    cell,
    /** Texels a side of the finest level. */
    side,
    /** Texels a side of one tile. */
    tile,
    /** Metres one tile covers a side. */
    span: tile * cell,
    /** Metres one level of a GROUND byte is worth. */
    unitGround: VOXEL,
    /** Metres one level of a BLADE byte is worth. */
    unitBlade: BLADE / SUB,
    /**
     * How many levels the pyramid has, finest first.
     *
     * SEVEN, AND THE BOUND IS THE TILE AND NOT A TASTE. Level 6 is a cell of 64
     * texels, so a tile's square is 2 x 2 of them and its reduction is entirely
     * inside the tile that produced it. Level 7 would be a cell of 128 -- still
     * inside -- but level 8 spans four tiles, and a level whose cell straddles
     * two producers cannot be written by either of them alone.
     */
    levels,
    /** Whether this window stands over the world rather than over the walker. */
    still,
  };
  shape.atlas = campoAtlas(shape);
  shape.tiles = campoTileLayout(shape);
  shape.tileBytes = shape.tiles.width * shape.tiles.height * 4;
  shape.bytes = shape.atlas.width * shape.atlas.height * 4;
  return shape;
}

/**
 * THE NEAR WINDOW: five centimetres a texel, 51.2 m across, following the eye.
 *
 * The name is kept from phase one because two dozen readers -- the guard, the
 * material, the window -- spell it, and because it is still the field the
 * meadow is drawn from. What is new beside it is CAMPO_FAR.
 */
export const CAMPO = campoShape({ cell: BLADE, name: 'vicino' });

/**
 * How many near cells a far cell is worth.
 *
 * EIGHT, AND IT IS A POWER OF TWO BECAUSE THE TRAVERSAL IS ONE LOOP. A far
 * texel is then exactly a cell of level three of the near pyramid: the ray
 * keeps ONE level counter, in near units, and crossing out of the near window
 * is a change of which texture answers and of nothing else. Any other ratio
 * would need two counters and a conversion at the seam, which is where a seam
 * would then be visible.
 */
export const CAMPO_FAR_RATIO = 8;

/** The shift from a near level to the same span in the far pyramid. */
export const CAMPO_FAR_SHIFT = Math.round(Math.log2(CAMPO_FAR_RATIO));

/**
 * THE FAR WINDOW: forty centimetres a texel, 409.6 m across, standing still.
 *
 * It covers 204.8 m in every direction from the middle of the world, which
 * carries the whole of the boundary -- the terraces, the crown of the ridge at
 * 96 m and its outer flank to 168 -- and every metre of ground the two arms of
 * standing water are laid over. Past that is V5's frame, which is drawn by
 * src/world/distant.js and has never been ground.
 */
export const CAMPO_FAR = campoShape({
  cell: BLADE * CAMPO_FAR_RATIO, still: true, name: 'lontano',
});

/** What a texel's material code means, and it is not MATERIAL's numbering. */
export const CAMPO_MATERIAL = {
  GRASS: 0,
  EARTH: 1,
  PATH: 2,
};

/** Bit 4 of B: a column stands here at all. */
export const CAMPO_PRESENT = 16;

/**
 * Bit 5 of B: the WALL of this column is soil.
 *
 * WHY A BIT AND NOT A GUESS, and it closes a defect the affiancato of phase one
 * found. The mesher lays a cut wall as TWO rectangles -- soil from the floor to
 * one voxel under the top, meadow for that last cube (E-DECISIONI8.3, «due
 * voxel di TERRA + un voxel di PRATO») -- and the field had no way to know it:
 * it read the family off the column's TOP and painted the whole flank of every
 * mound bank, of every halo round a boulder and of every terrace of the
 * boundary in one material. On the frame that was «cime sabbia e fianchi
 * grigio-azzurri attorno ai massi». The store has always said it, in `under`;
 * one spare bit of B is the whole of what it cost to carry.
 */
export const CAMPO_SOIL_WALL = 32;

/**
 * The material of a column as the field spells it, or -1 where the field draws
 * none.
 *
 * The corridor's own stone is a material the field CARRIES and does not DRAW:
 * the paving is three baked maps and a law of slabs (src/world/path.js), and
 * E-SENT4 keeps it where it is. The texel still says PATH, so the ray stops on
 * the stone's own top at the right height and the fragment stands aside for the
 * family that owns it, instead of drawing grass over it.
 */
export function campoMaterialCode(mat) {
  if (mat === MATERIAL.GRASS) return CAMPO_MATERIAL.GRASS;
  if (mat === MATERIAL.EARTH) return CAMPO_MATERIAL.EARTH;
  if (mat === MATERIAL.PATH) return CAMPO_MATERIAL.PATH;
  return -1;
}

/**
 * The width of a blade, packed into two bits and unpacked again.
 *
 * The store keeps it in EIGHTHS of a cell, nought for the whole cell, and only
 * ever writes a value under MANTO.slim.high (see layMat). Two bits hold the
 * whole range that law can draw, and the guard asserts that they still do
 * rather than trusting this comment.
 */
export function campoSlimCode(w8) {
  return w8 ? w8 - MANTO.slim.low + 1 : 0;
}

export function campoSlimEighths(code) {
  return code ? code + MANTO.slim.low - 1 : 0;
}

/** The tint of a column as one byte, and the value that byte stands for. */
export function campoTintByte(ix, iz) {
  const t = pigTint(ix, iz);
  const v = Math.round((t - PIGMENT.tintFloor) / (PIGMENT.tintCeil - PIGMENT.tintFloor) * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export function campoTintOf(byte) {
  return PIGMENT.tintFloor + (byte / 255) * (PIGMENT.tintCeil - PIGMENT.tintFloor);
}

/** The ground byte for a column whose top voxel is `top`. */
export function campoGroundByte(top) {
  const v = top + 1 + CAMPO_BIAS;
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** The voxel step a ground byte stands for: the inverse of campoGroundByte. */
export function campoTopStep(texel) {
  return texel.ground - CAMPO_BIAS - 1;
}

/** What a texel says, as numbers, for a guard and for a bench. */
export function campoDecode(data, offset) {
  const b = data[offset + 2];
  return {
    present: (b & CAMPO_PRESENT) !== 0,
    soilWall: (b & CAMPO_SOIL_WALL) !== 0,
    blade: data[offset],
    ground: data[offset + 1],
    mat: b & 3,
    slim: campoSlimEighths((b >> 2) & 3),
    tint: data[offset + 3],
  };
}

/** What one texel means as METRES, for a guard that has to compare the two. */
export function campoHeights(texel) {
  const ground = (texel.ground - CAMPO_BIAS) * VOXEL;
  const blade = texel.blade * (BLADE / SUB);
  return { ground, blade, top: ground + blade };
}

const cap = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Whether the wall of a column is soil, out of the store's own two fields.
 *
 * The mesher's rule and not a second one: `under` is what a wall is cut in and
 * `depth` is how far down it runs, and a wall is soil when the two say so.
 */
function soilWall(under, depth) {
  return under === MATERIAL.EARTH && depth > 0;
}

/**
 * ONE TILE OF THE NEAR PICTURE, LEVELS AND ALL, OUT OF THE BLOCK STORE.
 *
 * THE STORE AND NOT THE LAW, WHICH IS THE WHOLE POINT OF THIS FUNCTION. Every
 * number below is read off the arrays chunkColumns() filled: the top the four
 * passes of ./worldgen.js left, the material they wrote, the blade layMat laid
 * and the width it gave it. There is no second sampling of the field here and
 * there must never be one -- the moment this asked columnSpec() a question of
 * its own, the picture and the cubes would be two answers about the floor.
 *
 * AND THE MAT IS ASKED FOR AT THE BLADE AND NOT IN BLOCKS. layMat draws the mat
 * one blade at a time inside a ring round the walker and in blocks of N beyond
 * it, because the greedy mesher has to be given something to merge. The field
 * merges nothing, so it takes the law everywhere -- `detail: Infinity` -- and
 * the level of detail it draws is chosen per PIXEL from the footprint instead.
 *
 * AND THE WORLD DOES NOT STOP AT THE PLATEAU ANY MORE (E-DECISIONI13): the
 * store is cut with `beyond` set, so a tile that reaches past the rim carries
 * the terraces rather than a hole.
 *
 * @param {number} cx  tile index along x, in tiles of CHUNK columns
 * @param {number} cz  tile index along z
 * @param {number} radius  how far the plateau reaches, the layer's own
 * @returns {{data: Uint8Array, bx: number, bz: number, ms: number}}
 */
export function campoTile(cx, cz, radius) {
  const started = performance.now();
  const store = chunkColumns(cx, cz, CHUNK, true, radius, {
    x: 0,
    z: 0,
    // The law everywhere: see the note above.
    detail: Infinity,
    block: MANTO.block,
  }, true);
  const shape = CAMPO;
  const data = new Uint8Array(shape.tiles.width * shape.tiles.height * 4);
  const b = BLADES_PER_VOXEL;
  const storeW = store.w * b;
  // Where the tile's first blade stands in the store's own blade rectangle: the
  // store carries a skirt of SUN_SKIRT columns and the tile does not.
  const skirt = (cx * CHUNK - store.ox) * b;
  const bx0 = cx * CHUNK * b;
  const bz0 = cz * CHUNK * b;
  let lowest = 255;
  let tallest = 0;
  for (let j = 0; j < shape.tile; j++) {
    for (let i = 0; i < shape.tile; i++) {
      const o = (j * shape.tile + i) * 4;
      const k = (j + skirt) * storeW + (i + skirt);
      const ck = ((j + skirt) >> 1) * store.w + ((i + skirt) >> 1);
      const top = store.top[ck];
      if (top === NO_COLUMN) continue;
      const code = campoMaterialCode(store.mat[ck]);
      if (code < 0) continue;
      const ground = campoGroundByte(top);
      const blade = code === CAMPO_MATERIAL.PATH ? 0 : cap(store.blade[k]);
      data[o] = blade;
      data[o + 1] = ground;
      data[o + 2] = CAMPO_PRESENT | (campoSlimCode(store.slim[k]) << 2) | code
        | (soilWall(store.under[ck], store.depth[ck]) ? CAMPO_SOIL_WALL : 0);
      // The pigment's own column, which is the WORLD's ten centimetre column and
      // not the blade: a zone of the world is one zone whichever family stands
      // in it, and the fragment of ./material.js reads it at exactly this index.
      data[o + 3] = campoTintByte((bx0 + i) >> 1, (bz0 + j) >> 1);
      if (ground > tallest) tallest = ground;
      if (ground < lowest) lowest = ground;
    }
  }
  campoReduce(data, shape);
  return {
    data,
    coarse: campoCoarse(data, shape),
    bx: bx0,
    bz: bz0,
    tallest,
    lowest,
    ms: performance.now() - started,
    columns: store.w * store.d,
  };
}

/**
 * The mean height of the mat, in SUB-steps, from the law that draws it.
 *
 * WHAT THE FAR WINDOW PUTS ON A COLUMN INSTEAD OF A BLADE. A far texel is forty
 * centimetres across and a blade is five: sixty four of them stand under one
 * texel, and no picture at that resolution can say which. So it carries the
 * mat's own EXPECTATION -- the height the law would draw on average -- which is
 * the honest prefilter and is exactly what E-DECISIONI13 asks for out there
 * («oltre il disco e' a blocchi sotto la foschia»).
 *
 * It is derived from MANTO.law and not written down, so a sweep that moves the
 * ladder moves the far meadow with it.
 */
/**
 * The tallest blade the mat's own law can draw, in metres.
 *
 * IT IS THE PYRAMID'S BOUND AND NOT A DECORATION: see campoReduce for why a
 * coarse cell carries a SAMPLED blade over a MAXIMUM ground, and why that is
 * conservative only because this number exists. It is derived from MANTO.law
 * rather than written down, so a ladder with a sixth rung moves it.
 */
export const CAMPO_BLADE_CEIL = (MANTO.law.length - 1) * BLADE;

export const CAMPO_FAR_BLADE = (() => {
  let mean = 0;
  for (let h = 0; h < MANTO.law.length; h++) mean += h * MANTO.law[h];
  return Math.round(mean * SUB);
})();

/**
 * ONE TILE OF THE FAR PICTURE, OUT OF THE LAW ITSELF, AND THE DIFFERENCE IS
 * DECLARED RATHER THAN HIDDEN.
 *
 * The near tile is read off a STORE, because a store is what the greedy meshes
 * and the two have to be one answer. Out here there is no greedy and there
 * never will be: the boundary is drawn by the ray and by nothing else. So the
 * far tile reads `columnSpec` -- THE LAW, the same single statement the store
 * is filled from, through the same door and with the same arguments -- at its
 * own stride of four columns. What it does NOT do is invent a second law, and
 * the guard proves that texel by texel against columnSpec rather than against
 * this file.
 *
 * WHY IT CANNOT GO THROUGH A STORE. A far tile is 51.2 m of world; a store of
 * it at the world's own ten centimetre step is 512 x 512 columns, a quarter of
 * a million calls of a law whose answer this picture then throws fifteen
 * sixteenths of away. Sampled at the stride it is sixteen thousand, and the
 * tile costs six milliseconds instead of ninety.
 *
 * AND THE MAT IS THE LAW'S OWN MEAN, not a sample of it: see CAMPO_FAR_BLADE.
 *
 * @param {number} cx  tile index along x, in tiles of the far picture
 * @param {number} cz  tile index along z
 * @param {number} radius  how far the plateau reaches, the layer's own
 */
export function campoFarTile(cx, cz, radius) {
  const started = performance.now();
  const shape = CAMPO_FAR;
  const data = new Uint8Array(shape.tiles.width * shape.tiles.height * 4);
  // How many world columns one far texel spans, and the column it is read at:
  // the MIDDLE of its own footprint, so a texel is a sample of the ground it
  // stands for and not of its corner.
  const stride = Math.round(shape.cell / VOXEL);
  const half = stride >> 1;
  const tx0 = cx * shape.tile;
  const tz0 = cz * shape.tile;
  let lowest = 255;
  let tallest = 0;
  for (let j = 0; j < shape.tile; j++) {
    for (let i = 0; i < shape.tile; i++) {
      const o = (j * shape.tile + i) * 4;
      const ix = (tx0 + i) * stride + half;
      const iz = (tz0 + j) * stride + half;
      const spec = columnSpec(ix, iz, false, radius, true);
      if (spec.top === NO_COLUMN) continue;
      const code = campoMaterialCode(spec.mat);
      if (code < 0) continue;
      const ground = campoGroundByte(spec.top);
      data[o] = code === CAMPO_MATERIAL.PATH ? 0 : CAMPO_FAR_BLADE;
      data[o + 1] = ground;
      data[o + 2] = CAMPO_PRESENT | code
        | (soilWall(spec.under, spec.depth) ? CAMPO_SOIL_WALL : 0);
      data[o + 3] = campoTintByte(ix, iz);
      if (ground > tallest) tallest = ground;
      if (ground < lowest) lowest = ground;
    }
  }
  campoReduce(data, shape);
  return {
    data,
    coarse: campoCoarse(data, shape),
    bx: tx0,
    bz: tz0,
    tallest,
    lowest,
    ms: performance.now() - started,
    columns: shape.tile * shape.tile,
  };
}

/**
 * The pyramid over a tile that already holds its finest level.
 *
 * THE CHILD WITH THE HIGHEST GROUND, WHOLE -- AND NOT THE HIGHEST TOP.
 *
 * Tevs 2008's hierarchical ray-stepping needs one thing from a coarse cell: a
 * bound it can trust. Taking the child with the highest TOP gives one, and it
 * is what phase two was first written with -- and it draws a FLAT MEADOW. The
 * mat's ladder tops out at five blades with a probability of a twentieth, so
 * the tallest of the sixteen children of a level-two cell is at the top of the
 * ladder more than half the time: coarsen a meadow by taking maxima and every
 * cell of it stands at the same height. On the frame that is the difference
 * between the chunky voxel grass of the target and a sheet of flat plates.
 *
 * THE GREEDY NEVER DID THAT. Beyond its detail ring layMat draws a block of N
 * by N blades at the height of the block's OWN first blade -- a SAMPLE of the
 * law, not a maximum of it -- which is exactly why the cubes read as cubes at
 * distance. So this takes a sample too, and the sample is the child with the
 * highest GROUND, first one wins: over the plateau, where every child stands on
 * the same ground, that is a fixed corner and the blade heights stay as varied
 * as the law drew them; over a mound or a terrace, it is the child that sticks
 * up, which is what a pixel looking at a bank is looking at.
 *
 * AND THE SKIP STAYS CONSERVATIVE BECAUSE THE BLADE IS BOUNDED. The ground is a
 * true maximum, and no blade the law draws is taller than CAMPO_BLADE_CEIL, so
 * `ground + ceiling` is a bound nothing under the cell reaches past -- looser
 * than the exact top by at most a quarter of a metre, which costs a few cells
 * entered and left again and buys the whole look back.
 */
export function campoReduce(data, shape = CAMPO) {
  const width = shape.tiles.width;
  for (let level = 1; level < shape.levels; level++) {
    const size = shape.tile >> level;
    const src = shape.tiles.origins[level - 1];
    const dst = shape.tiles.origins[level];
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        let best = -Infinity;
        let bo = -1;
        for (let dj = 0; dj < 2; dj++) {
          for (let di = 0; di < 2; di++) {
            const s = ((src.y + j * 2 + dj) * width + (src.x + i * 2 + di)) * 4;
            // The top of this child in SUB-steps, and a column that is THERE
            // beats one that is not: an absent texel reads nought on both
            // heights and would otherwise win every tie on bare ground.
            const rank = data[s + 2] ? data[s + 1] : -Infinity;
            if (rank > best) { best = rank; bo = s; }
          }
        }
        const o = ((dst.y + j) * width + (dst.x + i)) * 4;
        if (bo < 0) continue;
        data[o] = data[bo];
        data[o + 1] = data[bo + 1];
        data[o + 2] = data[bo + 2];
        data[o + 3] = data[bo + 3];
      }
    }
  }
}

/**
 * ONE LEVEL OF A TILE, AS GROUND BYTES, FOR THE THREAD THE WALKER IS ON.
 *
 * The picture lives on the card and the main thread never reads it back. But
 * one question about it has to be answered on the CPU every frame -- how steep
 * a ray has to leave the eye before it can no longer reach any ground at all,
 * which is what takes the whole sky out of the march (see skySlope in
 * ./campo-field.js) -- and answering it needs the tallest ground in each PIECE
 * of a tile rather than in the tile as a whole: a far tile is 51.2 m across and
 * mixes the level plateau with the crown of the ridge, so its single maximum
 * says the ridge is right here.
 *
 * Level four of the pyramid is that piece: a cell of sixteen texels, 6.4 m of
 * far window, and the reduction has already taken the highest ground in each.
 * Eight by eight numbers a tile, which travel with it and cost nothing.
 */
export function campoCoarse(data, shape, level = 4) {
  const size = shape.tile >> level;
  const src = shape.tiles.origins[level];
  const out = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const o = ((src.y + j) * shape.tiles.width + (src.x + i)) * 4;
      out[j * size + i] = data[o + 2] ? data[o + 1] : 0;
    }
  }
  return out;
}

/** How many metres a side one cell of campoCoarse covers. */
export function campoCoarseSpan(shape, level = 4) {
  return shape.cell * (1 << level);
}

/**
 * Where a tile lands in the picture, at one level, and the address is TOROIDAL:
 * a tile owns the same square for ever, and walking out of the field on one
 * side walks back into it on the other. This is Losasso-Hoppe's own update and
 * the whole of why the window has no border and no re-mesh.
 */
export function campoSlot(bx, bz, level, shape = CAMPO) {
  const size = shape.side >> level;
  const tile = shape.tile >> level;
  const wrap = (v) => (((v >> level) % size) + size) % size;
  return { x: wrap(bx), y: wrap(bz), size: tile };
}

/** The texel a metre coordinate falls in, as the window counts it. */
export function campoColumnOf(metres, shape = CAMPO) {
  return Math.floor(metres / shape.cell);
}

/**
 * The corner tile of the FAR window, which stands over the middle of the world.
 *
 * The far picture does not follow anybody: it is centred once, on the world, so
 * that the boundary is in it from whichever corner of the plateau the walker
 * looks out.
 */
export function campoFarOrigin(shape = CAMPO_FAR) {
  const tiles = shape.side / shape.tile;
  return {
    cx: Math.floor(Math.floor(CENTRE.x / shape.cell) / shape.tile) - tiles / 2,
    cz: Math.floor(Math.floor(CENTRE.z / shape.cell) / shape.tile) - tiles / 2,
  };
}

/**
 * WHERE THE LINE BETWEEN THE TWO REPRESENTATIONS RUNS, as one plane in the
 * world's own XZ, compiled into BOTH programs out of this one seat.
 *
 * PHASE TWO KEPT IT, AND IT CHANGED JOB. In phase one it was how the field and
 * the cubes were put side by side in ONE frame for the committente. The field
 * is the ground now, so the line is no longer a comparison anybody looks at --
 * it is the only way the two can still be MEASURED against each other inside a
 * single opening of the page, which is the one condition under which a
 * before-and-after is a reading about a change and not about the machine
 * (E-V7k). `uCut.w` at nought is the world that ships: the cubes draw nothing
 * and the field draws everything.
 *
 * uCut is (nx, nz, d, on): the field draws where the half-space is positive and
 * the cubes draw where it is not. At `on` nought the cubes discard nothing,
 * which is the world the field owns whole.
 */
export const CAMPO_CUT_GLSL = /* glsl */`
  uniform vec4 uCut;
  uniform vec4 uCutDisc;

  // Which side of the line a point stands on. Positive is the field's.
  float campoSide(vec2 xz) {
    return dot(uCut.xy, xz) + uCut.z;
  }

  // Inside the disc of cubes, one voxel of margin past its rim, because the rim
  // is decided on a column's centre and this is asked at a pixel.
  bool campoInDisc(vec2 xz) {
    vec2 r = xz - uCutDisc.xy;
    return dot(r, r) <= uCutDisc.z * uCutDisc.z;
  }

  // TRUE WHERE THE FIELD OWNS THIS PIXEL, which is what the CUBES read: they
  // discard where it is true and the field draws exactly there, so the two can
  // never both claim a pixel and never both leave one empty. The line itself
  // goes to the field.
  bool campoOwns(vec2 xz) {
    return uCut.w >= 0.5 && campoSide(xz) >= 0.0 && campoInDisc(xz);
  }

  // AND TRUE WHERE THE FIELD MUST STAND ASIDE, which is what the FIELD reads:
  // the complement of the above INSIDE the disc, because outside it there are
  // no cubes to stand aside for and the ground would simply be missing.
  //
  // IT IS ASKED AT EVERY STEP OF THE MARCH AND NOT SOLVED AS AN INTERVAL, and
  // that is the change phase two forced. In phase one the field was a window
  // over the disc and the line was a PLANE, so a ray crossed it once and the
  // crossing could be solved for. The field is the world now, so a ray that
  // stands aside for the cubes over the disc has to come BACK -- the terraces
  // and the ridge behind them are still the field's -- and an interval cannot
  // say that. A test on the cell the ray is in can, exactly, for two ALU on a
  // branch that is uniformly false in the world that ships.
  bool campoYields(vec2 xz) {
    return uCut.w >= 0.5 && campoSide(xz) < 0.0 && campoInDisc(xz);
  }
`;

/** The two uniforms every program that reads the line above is handed. */
export function campoCutUniform() {
  return { uCut: { value: [0, 0, 0, 0] }, uCutDisc: { value: [0, 0, 0, 0] } };
}

export { VOXEL, BLADE, SUB, CHUNK };
