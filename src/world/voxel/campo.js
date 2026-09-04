// THE FIELD: THE SAME GROUND, KEPT AS A PICTURE INSTEAD OF AS TRIANGLES.
//
// A texel a blade -- five centimetres -- holding the four numbers a fragment
// needs to rebuild the mat and the floor under it, plus a pyramid of MAXIMA so
// a ray can skip the empty air over them. This file is the ARITHMETIC of that
// picture and nothing else: no three.js, no texture, no upload. It is reachable
// from ./pure.js, which is what lets a guard lay the same texel offline and
// compare it against the block store, and it is the reason the field can never
// become a second opinion about where the ground is -- every byte below is
// written out of the store the greedy mesher reads, through the same
// columnSpec/layMat that cut the disc.
//
// WHY A TEXEL AND NOT A VERTEX. The rule at the head of ./mesher.js is that
// nothing per voxel may ride on a vertex attribute, because that is what lets a
// merged rectangle stand for a hundred cubes. The field takes the rule to its
// end: NOTHING rides on a vertex at all. There are no vertices. What a fragment
// needs comes out of one texture read at the cell the ray stopped in.
//
// ---------------------------------------------------------------------------
// WHAT ONE TEXEL HOLDS, AND WHY EACH CHANNEL IS THE ONE IT IS.
//
//   R  the TOP of the column including its blade, in SUB-steps of a blade above
//      y = 0. That is the unit ./columns.js already keeps the mat and its
//      shadow in -- a quarter of a blade, 1.25 cm -- so a voxel is exactly
//      eight of them and nothing is quantised twice. One byte spans 3.19 m,
//      over the tallest thing this lattice carries.
//   G  the top of the GROUND under the blade, same unit. The pair is what makes
//      a mound a piece of the field instead of a second representation: the
//      ray sees one solid up to G and a blade from G to R.
//   B  what the column is made of, how narrow its blade stands, and whether it
//      is there at all -- packed, because the plane's own column reads R = 0
//      and G = 0 (BASE_STEP + 1 is nought) and would otherwise be
//      indistinguishable from a hole in the disc.
//   A  the tint of the COLUMN, which is the pigment's own field sampled at the
//      integer column exactly as the fragment of ./material.js samples it. It
//      is written here rather than hashed in the shader for the reason §2.4 of
//      the performance dossier gives: the producer of a texel should be one
//      thread, and the tint arrives in the same fetch as the height for
//      nothing. The hue rides the slow octave and is still drawn in the
//      fragment, because it is a second field and not this one.
//
// WHAT IS NOT IN A TEXEL, ON PURPOSE. The line where the sun stops reaching a
// column -- ./worldgen.js bakes it into store.shade -- is NOT stored. It is a
// march over R along the seal's own bearing, and the field can walk it at the
// moment it shades, out of the very same heights, for eight fetches that the
// measurement says are free. A stored copy would be a second answer to a
// question the picture already contains, and it would stop following the sun.
// ---------------------------------------------------------------------------

import {
  BLADE, BLADES_PER_VOXEL, CHUNK, MATERIAL, NO_COLUMN, SUB, VOXEL,
} from './columns.js';
import { MANTO, chunkColumns } from './worldgen.js';
import { PIGMENT, pigTint } from './pigment.js';

/** How many SUB-steps of a blade one voxel of the world is worth. */
export const CAMPO_RUNG = BLADES_PER_VOXEL * SUB;

/**
 * The shape of the picture, and every number in it is a power of two on
 * purpose.
 *
 * THE SIDE AND THE TILE ARE THE WHOLE OF WHY THE TOROIDAL UPDATE IS TRIVIAL. A
 * chunk is 64 columns, so 128 texels; the field is 1024, so exactly eight
 * chunks a side. A chunk's square therefore lands on a multiple of its own size
 * at EVERY level of the pyramid and can never straddle the wrap -- which turns
 * "update a moving window" into seven sub-rectangle writes with no clipping and
 * no split. A side that was not a whole number of chunks would need four writes
 * a level and a case analysis for each.
 */
export const CAMPO = {
  /** Texels a side of the finest level: 1024 at 5 cm is 51.2 m of world. */
  side: 1024,
  /** Metres a texel of the finest level covers. */
  cell: BLADE,
  /** Metres one level of a height byte is worth. */
  unit: BLADE / SUB,
  /** Texels a side of one chunk's square. */
  tile: CHUNK * BLADES_PER_VOXEL,
  /**
   * How many levels the pyramid has, finest first.
   *
   * SEVEN, AND THE BOUND IS THE CHUNK AND NOT A TASTE. Level 6 is a cell of 64
   * texels, so a chunk's square is 2 x 2 of them and its reduction is entirely
   * inside the chunk that produced it. Level 7 would be a cell of 128 -- still
   * inside -- but level 8 spans four chunks, and a level whose cell straddles
   * two producers cannot be written by either of them alone. The measurement
   * says nothing above four is reached anyway (the prototype's own default top
   * was level 4, a cell of 80 cm).
   */
  levels: 7,
};

/** What a texel's material code means, and it is not MATERIAL's numbering. */
export const CAMPO_MATERIAL = {
  GRASS: 0,
  EARTH: 1,
  PATH: 2,
};

/** Bit 4 of B: a column stands here at all. */
export const CAMPO_PRESENT = 16;

/**
 * Where each level of the pyramid stands in the one texture that carries them
 * all, and why they are in ONE texture rather than in a mip chain.
 *
 * A mip chain is the natural home for a pyramid and it is the wrong one here.
 * The window moves toroidally, so a chunk's write has to land at level L at a
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
export const CAMPO_ATLAS = (() => {
  const origins = [{ x: 0, y: 0 }];
  let x = CAMPO.side;
  let y = 0;
  for (let level = 1; level < CAMPO.levels; level++) {
    const size = CAMPO.side >> level;
    // Two columns: the first level of the strip is half the field and starts a
    // column of its own; the rest stack under it until they would run past the
    // bottom, then step right by the width of the level that just filled up.
    if (y + size > CAMPO.side) {
      x += CAMPO.side >> (level - 1);
      y = 0;
    }
    origins.push({ x, y });
    y += size;
  }
  const width = origins.reduce((w, o, level) => Math.max(w, o.x + (CAMPO.side >> level)), 0);
  return { width, height: CAMPO.side, origins };
})();

/** Where each level of ONE CHUNK'S tile stands inside the tile's own image. */
export const CAMPO_TILE = (() => {
  const origins = [{ x: 0, y: 0 }];
  let x = 0;
  const y = CAMPO.tile;
  for (let level = 1; level < CAMPO.levels; level++) {
    origins.push({ x, y });
    x += CAMPO.tile >> level;
  }
  return { width: CAMPO.tile, height: CAMPO.tile + (CAMPO.tile >> 1), origins };
})();

/** The bytes one chunk's tile costs on the wire, padding included. */
export const CAMPO_TILE_BYTES = CAMPO_TILE.width * CAMPO_TILE.height * 4;

/** The bytes the whole picture costs on the card, padding included. */
export const CAMPO_BYTES = CAMPO_ATLAS.width * CAMPO_ATLAS.height * 4;

/**
 * The material of a column as the field spells it, or -1 where the field draws
 * none.
 *
 * The corridor's own stone is a material the field CARRIES and does not DRAW:
 * the paving is three baked maps and a law of slabs (src/world/path.js), and
 * E-SENT4 keeps it where it is for this step. The texel still says PATH, so the
 * ray stops on the stone's own top at the right height and the fragment stands
 * aside for the family that owns it, instead of drawing grass over it.
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

/** What a texel says, as numbers, for a guard and for a bench. */
export function campoDecode(data, offset) {
  const b = data[offset + 2];
  return {
    present: (b & CAMPO_PRESENT) !== 0,
    top: data[offset],
    ground: data[offset + 1],
    mat: b & 3,
    slim: campoSlimEighths((b >> 2) & 3),
    tint: data[offset + 3],
  };
}

const cap = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * One chunk's square of the picture, levels and all, out of the block store.
 *
 * THE STORE AND NOT THE LAW, WHICH IS THE WHOLE POINT OF THIS FILE. Every
 * number below is read off the arrays chunkColumns() filled: the top the four
 * passes of ./worldgen.js left, the material they wrote, the blade layMat laid
 * and the width it gave it. There is no second sampling of the field here and
 * there must never be one -- the moment this file asked columnSpec() a question
 * of its own, the picture and the cubes would be two answers about the floor.
 *
 * AND THE MAT IS ASKED FOR AT THE BLADE AND NOT IN BLOCKS. layMat draws the mat
 * one blade at a time inside a ring round the walker and in blocks of N beyond
 * it, because the greedy mesher has to be given something to merge. The field
 * merges nothing, so it takes the law everywhere -- `detail: Infinity` -- and
 * the level of detail it draws is chosen per PIXEL from the distance instead.
 * That difference is exactly what the seam between the two representations is
 * measured on, and it is declared here rather than hidden by matching the
 * blocks.
 *
 * @param {number} cx  chunk index along x
 * @param {number} cz  chunk index along z
 * @param {number} radius  how far the disc reaches, the layer's own
 * @returns {{data: Uint8Array, bx: number, bz: number, ms: number, top: number}}
 */
export function campoTile(cx, cz, radius) {
  const started = performance.now();
  const store = chunkColumns(cx, cz, CHUNK, true, radius, {
    x: 0,
    z: 0,
    // The law everywhere: see the note above.
    detail: Infinity,
    block: MANTO.block,
  });
  const data = new Uint8Array(CAMPO_TILE.width * CAMPO_TILE.height * 4);
  const b = BLADES_PER_VOXEL;
  const storeW = store.w * b;
  // Where the tile's first blade stands in the store's own blade rectangle: the
  // store carries a skirt of SUN_SKIRT columns and the tile does not.
  const skirt = (cx * CHUNK - store.ox) * b;
  const bx0 = cx * CHUNK * b;
  const bz0 = cz * CHUNK * b;
  let tallest = 0;
  for (let j = 0; j < CAMPO.tile; j++) {
    for (let i = 0; i < CAMPO.tile; i++) {
      const o = (j * CAMPO.tile + i) * 4;
      const k = (j + skirt) * storeW + (i + skirt);
      const ck = ((j + skirt) >> 1) * store.w + ((i + skirt) >> 1);
      const top = store.top[ck];
      if (top === NO_COLUMN) continue;
      const code = campoMaterialCode(store.mat[ck]);
      if (code < 0) continue;
      const ground = cap((top + 1) * CAMPO_RUNG);
      const blade = code === CAMPO_MATERIAL.PATH ? 0 : store.blade[k];
      const height = cap(ground + blade);
      data[o] = height;
      data[o + 1] = ground;
      data[o + 2] = CAMPO_PRESENT | (campoSlimCode(store.slim[k]) << 2) | code;
      // The pigment's own column, which is the WORLD's ten centimetre column and
      // not the blade: a zone of the world is one zone whichever family stands
      // in it, and the fragment of ./material.js reads it at exactly this index.
      data[o + 3] = campoTintByte((bx0 + i) >> 1, (bz0 + j) >> 1);
      if (height > tallest) tallest = height;
    }
  }
  campoReduce(data);
  return {
    data,
    bx: bx0,
    bz: bz0,
    tallest,
    ms: performance.now() - started,
    columns: store.w * store.d,
  };
}

/**
 * The pyramid of maxima over a tile that already holds its finest level.
 *
 * MAXIMA ON THE TWO HEIGHTS AND THE TALLEST CHILD'S OWN WORD ON THE REST.
 * Tevs 2008's hierarchical ray-stepping needs one thing from a coarse cell: a
 * bound it can trust -- nothing under it reaches higher than this -- so R and G
 * are maxima and the skip is conservative by construction. B and A are not
 * bounds and cannot be maxima of anything; they come from whichever child is
 * TALLEST, because a coarse cell is only ever SHADED where the level of detail
 * has decided a pixel is smaller than the cell, and what such a pixel is
 * looking at is the thing that sticks up.
 */
export function campoReduce(data) {
  for (let level = 1; level < CAMPO.levels; level++) {
    const size = CAMPO.tile >> level;
    const src = CAMPO_TILE.origins[level - 1];
    const dst = CAMPO_TILE.origins[level];
    const srcSize = size << 1;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        let r = 0;
        let g = 0;
        let best = -1;
        let bestB = 0;
        let bestA = 0;
        for (let dj = 0; dj < 2; dj++) {
          for (let di = 0; di < 2; di++) {
            const s = ((src.y + j * 2 + dj) * CAMPO_TILE.width + (src.x + i * 2 + di)) * 4;
            const sr = data[s];
            const sg = data[s + 1];
            const sb = data[s + 2];
            if (sr > r) r = sr;
            if (sg > g) g = sg;
            // The tallest child, and a column that is THERE beats one that is
            // not at the same height: an absent texel reads nought on both
            // heights and would otherwise win every tie on the bare plane.
            const rank = sb ? sr * 2 + 1 : -1;
            if (rank > best) {
              best = rank;
              bestB = sb;
              bestA = data[s + 3];
            }
          }
        }
        const o = ((dst.y + j) * CAMPO_TILE.width + (dst.x + i)) * 4;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = bestB;
        data[o + 3] = bestA;
        if (srcSize === 0) break;
      }
    }
  }
}

/**
 * Where a chunk's tile lands in the picture, at one level, and the address is
 * TOROIDAL: a chunk owns the same square for ever, and walking out of the field
 * on one side walks back into it on the other. This is Losasso-Hoppe's own
 * update and the whole of why the window has no border and no re-mesh.
 */
export function campoSlot(bx, bz, level) {
  const size = CAMPO.side >> level;
  const tile = CAMPO.tile >> level;
  const wrap = (v) => (((v >> level) % size) + size) % size;
  return { x: wrap(bx), y: wrap(bz), size: tile };
}

/** The blade column a metre coordinate falls in, as the whole world counts it. */
export function campoColumnOf(metres) {
  return Math.floor(metres / BLADE);
}

/**
 * WHERE THE LINE BETWEEN THE TWO REPRESENTATIONS RUNS, as one plane in the
 * world's own XZ, compiled into BOTH programs out of this one seat.
 *
 * The field and the greedy have to be judged in one frame, side by side, at one
 * pose: that is the whole of what this step is for. A frame that showed them
 * one after the other would be two frames of two machines' weather. So the mat
 * is cut in half by a plane and each half is drawn by one of them -- and the
 * plane is written ONCE, here, because a boundary spelled out in two programs
 * is two boundaries the moment one of them is edited.
 *
 * uCut is (nx, nz, d, on): the field draws where the half-space is positive and
 * the cubes draw where it is not. At `on` nought neither cuts anything, which
 * is the world that ships.
 */
export const CAMPO_CUT_GLSL = /* glsl */`
  uniform vec4 uCut;
  uniform vec4 uCutDisc;

  // Which side of the line a point stands on. Positive is the field's.
  float campoSide(vec2 xz) {
    return dot(uCut.xy, xz) + uCut.z;
  }

  // TRUE WHERE THE FIELD OWNS THIS PIXEL, AND THE SECOND TEST IS NOT A
  // FLOURISH. The field is a window over the DISC in this step -- outside it
  // there is no column and no texel -- while the cubes' own material is shared
  // by reference with the sheet that runs from the rim of the disc out to a
  // hundred metres, deliberately, so that the two cannot drift apart under a
  // sweep. A half-space alone would therefore cut the sheet as well as the
  // cubes and leave the far ground as sky. So what the field claims is the
  // half-space INSIDE the disc, and one voxel of margin past the rim, because
  // the rim is decided on a column's centre and this is asked at a pixel.
  //
  // The cubes discard where this is true and the field draws exactly there:
  // the line itself goes to the field, so the two can never both claim a pixel
  // and never both leave one empty.
  bool campoOwns(vec2 xz) {
    if (uCut.w < 0.5 || campoSide(xz) < 0.0) return false;
    vec2 r = xz - uCutDisc.xy;
    return dot(r, r) <= uCutDisc.z * uCutDisc.z;
  }
`;

/** The two uniforms every program that reads the line above is handed. */
export function campoCutUniform() {
  return { uCut: { value: [0, 0, 0, 0] }, uCutDisc: { value: [0, 0, 0, 0] } };
}

/** What one texel means as METRES, for a guard that has to compare the two. */
export function campoHeights(texel) {
  return {
    ground: texel.ground * CAMPO.unit,
    top: texel.top * CAMPO.unit,
    blade: (texel.top - texel.ground) * CAMPO.unit,
  };
}

/** The voxel the field says a column's ground stands at, back in whole steps. */
export function campoTopStep(texel) {
  return texel.ground / CAMPO_RUNG - 1;
}

export { VOXEL, BLADE, SUB };
