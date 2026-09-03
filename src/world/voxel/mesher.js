import {
  CHUNK, MATERIAL, NO_COLUMN, VOXEL, matAt, topAt, underAt,
} from './columns.js';
import {
  BASE_STEP, DISC_RADIUS, EARTH, EMPTY, FACING, chunkColumns, chunkList as genChunkList,
  columnCentre, earthFacing,
} from './worldgen.js';

// THE GREEDY MESHER OVER THE BLOCK STORE.
//
// Pure arithmetic and typed arrays: no three.js, no DOM. That is what lets the
// same file run inside the worker, inside the page and under plain node, and it
// is the reason the geometry of the disc can be checked offline against the
// number the render reports. Two implementations of this would be two answers
// to the one question the whole pivot rests on.
//
// AND IT READS THE STORE AND NOTHING ELSE. It used to round a continuous field
// at the moment it drew a cube, which made the picture and the walker's floor
// two samplings of one function rather than one answer; ./worldgen.js writes
// the world down now, and everything below is a function of those four arrays.
// Nothing here evaluates a height, a noise or a threshold. The only question it
// still asks about the world is which of a column's four sides turns its cut
// face toward the eye, and that is a property of a FACE: the same column shows
// earth on one side and grass on the other three, so it cannot be a byte in a
// column and must not become one.
//
// ===========================================================================
// NEVER A PER-VOXEL PROPERTY IN A VERTEX ATTRIBUTE.
//
// It is written here, at the top of the file that would break it, because it is
// ONE LINE either way. It does not show up in a review as a change to the
// budget, and it was measured rather than reasoned.
//
// The tint, the joint and the lightened arris are rebuilt in the fragment out
// of the fragment's own position, relative to the chunk. The moment any of them
// has to be handed over per vertex, a merged rectangle can no longer stand for
// a hundred cubes -- the merge dies, and the geometry of the whole world goes
// up by THREE TIMES. Measured, not feared.
//
// It is also why the position stays in the chunk's own frame all the way to the
// fragment: a few metres of range instead of a few hundred, which is what the
// arithmetic needs to stay exact at medium precision.
//
// SO WHERE DOES THE MATERIAL GO. Greedy meshing over a store with a material
// per cell means merging only cells that agree on BOTH -- the height and the
// material -- and then handing each family to its own mesh. The family is which
// MESH a rectangle ends up in and never a number on a vertex, so the rule holds
// bit for bit and the cost is one draw call for the whole world.
//
// AND THERE IS NO AMBIENT OCCLUSION, WHICH IS A MEASUREMENT AND NOT AN
// OMISSION. Per-vertex ambient occlusion is the canonical thing to add here and
// the structure research proposed it; the light research then measured both
// references and found the edge profile FLAT to within 1.2% out to six pixels,
// where the four levels of that algorithm impose a ramp of about 28% over the
// same distance. The reference is roughly twenty eight times flatter than the
// technique allows, so the technique is not in it. What carries the shape
// instead is the constant per face term the orientation gives, which
// src/world/face-light.js already owns.
// ===========================================================================

// AND topAt AND matAt WITH THEM, because src/world/contracts.js reads the STORE
// now and not the law: the walker's floor and the material under his foot are
// two questions about the four arrays, and the seat that answers them may not
// reach past this door to ask.
export { VOXEL, CHUNK, NO_COLUMN, MATERIAL, matAt, topAt } from './columns.js';
export {
  BASE_STEP, CENTRE, DISC_RADIUS, EARTH, FRAMED, MOUND, PATH, SOD, bareRaisedAt, chunkColumns,
  columnCentre, columnSpec, columnTop, earthFacing, framedTally, meadowMoundAt, moundAt,
  moundBankAt, moundCutAt, onPaving, pathVerge, sodAt,
} from './worldgen.js';

// The six orientations, in the order the material reads them: the top first,
// because it is the one that carries the full sky and it is the family every
// other one is measured against.
export const FACE = {
  TOP: 0, NORTH: 1, SOUTH: 2, EAST: 3, WEST: 4, BOTTOM: 5,
};

// The generator states the four lateral bearings by number, so that the arrow
// between the two files runs one way and the thing that fills the world does
// not have to import the thing that draws it. If the two ever parted company
// the world would show its bare earth on the wrong side of every mound, and
// nothing would say so -- so the restatement is checked at load rather than
// trusted.
if (FACING.NORTH !== FACE.NORTH || FACING.SOUTH !== FACE.SOUTH
  || FACING.EAST !== FACE.EAST || FACING.WEST !== FACE.WEST) {
  throw new Error('worldgen and the mesher disagree about which bearing is which');
}

// How far a wall with nothing beyond it drops, in voxels.
//
// A wall with nothing beyond it -- the rim of the disc, and both verges of the
// paving -- only has to reach the surface that is ALREADY drawn underneath it,
// which is the bent grid at the height of the plane. The cubes stand within a
// step and a half of that surface by construction, so two steps closes the seam
// and anything deeper is a curtain nobody can see, paid for along every metre
// of both verges.
//
// TWO AND NOT EIGHT, AND THE DIFFERENCE IS A DECISION AND NOT A TIDY-UP. It was
// two plus the tallest bank the meadow could pile against the stone, because a
// bank standing on the rim of the disc would otherwise have left forty
// centimetres of daylight under it. That bank is nought now -- see MOUND.bank
// in ./worldgen.js -- so the term it was carrying goes with it.
//
// IT COSTS NOT ONE QUAD. A wall is a single rectangle whatever its height: what
// this buys is the height of four corners and nothing else.
const SKIRT = 2;

/** The whole disc, in chunk coordinates: every chunk with a column in it. */
export function chunkList(radius = DISC_RADIUS) {
  return genChunkList(CHUNK, radius);
}

const QUAD_INDEX = [0, 1, 2, 0, 2, 3];

/**
 * Meshes one chunk.
 *
 * THE DOOR DID NOT MOVE. Four arguments, in the same order and with the same
 * meaning as the signature four other sessions call through; what changed is
 * where the third one bites. `grain` is what `tuft` was: false is the BARE
 * ground -- the plane and the masses set on it, with no sods -- which is the
 * baseline the grain's own cost is read against, and it is what guard-piano
 * asks for to assert that the store reproduces the plane.
 *
 * @param {number} cx chunk index along x
 * @param {number} cz chunk index along z
 * @param {boolean} grain whether the sods are part of the ground
 * @param {number} radius how far the disc reaches, in metres
 * @returns {object} chunk-relative geometry, its counts and its box
 */
export function meshChunk(cx, cz, grain = true, radius = DISC_RADIUS) {
  const n = CHUNK;
  // The chunk and a skirt of one column either side, so a wall on the chunk's
  // own edge is measured against the ground beyond it rather than against
  // nothing. The generator writes the skirt into the same store, so this pass
  // never has to ask for a column a second time.
  const store = chunkColumns(cx, cz, n, grain, radius);
  const ox = cx * n;
  const oz = cz * n;

  const at = (i, j) => {
    const h = topAt(store, ox + i, oz + j);
    return h === NO_COLUMN ? EMPTY : h;
  };
  const material = (i, j) => matAt(store, ox + i, oz + j);
  const flank = (i, j) => underAt(store, ox + i, oz + j);

  // The chunk's own tops, handed back with the geometry.
  //
  // The walker has to stand ON the cubes and the grass has to be planted on
  // them, and both ask far too often to build the column again. So the answers
  // the store already holds are copied out rather than thrown away and asked
  // for a second time, which is also what stops the floor and the picture from
  // ever disagreeing.
  const tops = new Int16Array(n * n);
  let columns = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h = topAt(store, ox + i, oz + j);
      tops[j * n + i] = h;
      if (h !== NO_COLUMN) columns++;
    }
  }

  const quads = [];
  // The same, for the faces that are bare earth rather than grass. Kept apart
  // from the first list all the way down so that neither family can merge into
  // the other, which is the whole of what makes them two families.
  const earth = [];
  // AND A THIRD, FOR THE PAVING. The corridor is columns of this disc now and
  // its tops are a material of their own: a stone with a grain finer than the
  // cell, painted from the three maps V3 measured, where the meadow and the
  // bare earth are flat pigments with a hash on them. Three families, three
  // meshes, three draws for the whole disc -- and the corridor gives back the
  // draw its own surface used to cost.
  const paving = [];
  // How many of the walls exist only because something ends here -- the rim of
  // the disc, or a verge of the paving -- rather than because the ground
  // stepped. Counted apart because it is the one part of this number that does
  // NOT scale to a world: a disc of fourteen metres is nearly all edge and a
  // world is nearly all middle.
  let rim = 0;
  // Which of the three a rectangle belongs to. A number and not two booleans,
  // because a face is in exactly one family and a pair of flags can say
  // otherwise.
  const MEADOW = 0;
  const SOIL = 1;
  const STONE = 2;
  const push = (face, ax, ay, az, bx, by, bz, cx2, cy, cz2, dx, dy, dz, family = MEADOW) => {
    (family === SOIL ? earth : family === STONE ? paving : quads).push(
      [face, ax, ay, az, bx, by, bz, cx2, cy, cz2, dx, dy, dz],
    );
  };

  // ------------------------------------------------------------- the tops
  //
  // Grown into rectangles of one height AND one material. Two cells of two
  // materials cannot be one rectangle, and pretending otherwise is how a family
  // becomes a stripe -- so the material is part of the key here rather than a
  // second pass over the same ground. On a meadow whose tops are all grass it
  // costs one byte compare a cell and changes nothing; the day the corridor is
  // laid as columns of stone it is what keeps the paving out of the meadow.
  const used = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (used[j * n + i]) continue;
      const h = at(i, j);
      if (h === EMPTY) continue;
      const mat = material(i, j);
      const same = (a, b) => !used[b * n + a] && at(a, b) === h && material(a, b) === mat;
      let w = 1;
      while (i + w < n && same(i + w, j)) w++;
      let d = 1;
      grow: while (j + d < n) {
        for (let k = 0; k < w; k++) {
          if (!same(i + k, j + d)) break grow;
        }
        d++;
      }
      for (let b = 0; b < d; b++) for (let a = 0; a < w; a++) used[(j + b) * n + i + a] = 1;
      const y = (h + 1) * VOXEL;
      const x0 = i * VOXEL;
      const z0 = j * VOXEL;
      const x1 = (i + w) * VOXEL;
      const z1 = (j + d) * VOXEL;
      // Wound so the face looks up: seen from above the corners run clockwise
      // in x and z, which is counter-clockwise about +Y.
      push(FACE.TOP, x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0,
        mat === MATERIAL.EARTH ? SOIL : mat === MATERIAL.PATH ? STONE : MEADOW);
    }
  }

  // ------------------------------------------------------------ the sides
  //
  // One bearing at a time. Along each one the outer loop walks the axis the
  // wall stands on and the inner loop walks the axis it runs along, so a run of
  // columns sharing a top, a floor and a family is one rectangle whatever its
  // length. What is deliberately NOT here is a merge across the vertical of a
  // wall: runs are what the sweep behind the recommendation measured, so runs
  // are what this counts, and the two dimensional merge stays on the table as
  // headroom rather than being spent silently here.
  const wall = (face, along, dix, diz) => {
    // Whether the wall this column raises toward this bearing is bare earth.
    //
    // THREE CONDITIONS AND EACH ONE IS A SENTENCE OF THE READING. It has to
    // stand on ground that is CUT -- the store says what the flank under a top
    // is made of, and a plate of turf standing one voxel over the floor is
    // meadow and stays meadow. It has to be STEEP: a flank that climbs one
    // voxel is a step in a meadow, one that climbs `minStep` is a cut bank and
    // shows what it is cut into. And it has to FACE the eye or the corridor,
    // which is where the reference shows its bare ground and nowhere else.
    const bare = (i, j, h, floor) => {
      // THE VERGE RULE IS GONE, AND WHAT REPLACED IT IS THE THING ITSELF. It
      // used to say: a wall with nothing beyond it whose neighbour is marked as
      // the corridor's hole is the verge of the paving, so paint it earth. That
      // was a wall standing at the lip of a hole, painted to stand in for a band
      // of ground that was not there. The band IS there now -- two to four
      // columns of MATERIAL.EARTH either side of the stone, written by the
      // generator (PATH.verge in ./worldgen.js) -- so what is left with nothing
      // beyond it is only the rim of the disc, which is the edge of a piece and
      // no part of the world.
      if (floor === EMPTY) return false;
      if (flank(i, j) !== MATERIAL.EARTH) return false;
      if (h - floor < EARTH.minStep) return false;
      const centre = columnCentre(ox + i, oz + j);
      return earthFacing(face, centre.x, centre.z);
    };
    for (let a = 0; a < n; a++) {
      let b = 0;
      while (b < n) {
        const i = along ? b : a;
        const j = along ? a : b;
        const h = at(i, j);
        if (h === EMPTY) { b++; continue; }
        const floor = at(i + dix, j + diz);
        if (floor !== EMPTY && h <= floor) { b++; continue; }
        // The family of the whole run. A wall raised by a column of paving is
        // paving -- it happens only at the rim of the disc, where the corridor
        // runs out of the piece, and a skirt of grass under a stone floor is
        // the one place that would show.
        const fam = material(i, j) === MATERIAL.PATH ? STONE
          : bare(i, j, h, floor) ? SOIL : MEADOW;
        // How far this exact pair of levels carries. A neighbour that is not
        // there ends the run: its floor is not a number this can be compared
        // against and a wall built to it would have no bottom.
        let run = 1;
        while (b + run < n) {
          const i2 = along ? b + run : a;
          const j2 = along ? a : b + run;
          const h2 = at(i2, j2);
          if (h2 !== h) break;
          const f2 = at(i2 + dix, j2 + diz);
          if ((f2 === EMPTY) !== (floor === EMPTY)) break;
          if (f2 !== EMPTY && f2 !== floor) break;
          // AND THE FAMILY ENDS A RUN. Two rectangles of two materials cannot
          // be one rectangle. It is the only thing that can split a merge here
          // which is not a difference of height, and what it costs is measured
          // rather than assumed.
          const fam2 = material(i2, j2) === MATERIAL.PATH ? STONE
            : bare(i2, j2, h2, f2) ? SOIL : MEADOW;
          if (fam2 !== fam) break;
          run++;
        }
        // AND A SKIRT IS MEASURED FROM THE PLANE AND NOT FROM THE COLUMN.
        // Taken from the column, a rim wall standing on a four voxel mass ends
        // two voxels ABOVE the floor the sheet is drawn at, and what is between
        // them is daylight under the edge of the piece: measured over the rim
        // that ships, 82 walls of 1260 ended over the plane, the worst by 0.20 m
        // -- ten of 1260 by 0.10 m before the masses grew their own bank. Taken
        // from the plane it cannot happen whatever stands on the column, and it
        // costs not one quad: a wall is a rectangle whatever its height.
        const low = floor === EMPTY ? Math.min(h - SKIRT, BASE_STEP - SKIRT) : floor;
        if (floor === EMPTY) rim++;
        const yTop = (h + 1) * VOXEL;
        const yLow = (low + 1) * VOXEL;
        const x0 = (along ? b : a) * VOXEL;
        const z0 = (along ? a : b) * VOXEL;
        const x1 = x0 + (along ? run * VOXEL : VOXEL);
        const z1 = z0 + (along ? VOXEL : run * VOXEL);
        // The face sits on the boundary the neighbour is across, and the two
        // corners are taken so the winding turns the front of it outwards.
        if (face === FACE.EAST) {
          push(face, x1, yLow, z0, x1, yTop, z0, x1, yTop, z1, x1, yLow, z1, fam);
        } else if (face === FACE.WEST) {
          push(face, x0, yLow, z1, x0, yTop, z1, x0, yTop, z0, x0, yLow, z0, fam);
        } else if (face === FACE.SOUTH) {
          push(face, x1, yLow, z1, x1, yTop, z1, x0, yTop, z1, x0, yLow, z1, fam);
        } else {
          push(face, x0, yLow, z0, x0, yTop, z0, x1, yTop, z0, x1, yLow, z0, fam);
        }
        b += run;
      }
    }
  };

  // +x and -x stand on the x axis and run along z; +z and -z the other way.
  wall(FACE.EAST, false, 1, 0);
  wall(FACE.WEST, false, -1, 0);
  wall(FACE.SOUTH, true, 0, 1);
  wall(FACE.NORTH, true, 0, -1);

  const packed = pack(quads, columns, rim, tops, cx, cz);
  packed.earth = packFaces(earth);
  packed.paving = packFaces(paving);
  return packed;
}

/**
 * The bare earth's own three buffers: corners, an orientation, an index.
 *
 * The same shape as a chunk's and deliberately no more than that. Nothing here
 * is per voxel and nothing here says what the family IS -- the family is which
 * MESH the rectangles end up in, and that is the page's to hang.
 */
function packFaces(quads) {
  const count = quads.length;
  const positions = new Float32Array(count * 12);
  const normals = new Int8Array(count * 12);
  const indices = count * 4 > 65535
    ? new Uint32Array(count * 6) : new Uint16Array(count * 6);
  for (let q = 0; q < count; q++) {
    const it = quads[q];
    const face = it[0];
    const nx = face === FACE.EAST ? 127 : face === FACE.WEST ? -127 : 0;
    const ny = face === FACE.TOP ? 127 : face === FACE.BOTTOM ? -127 : 0;
    const nz = face === FACE.SOUTH ? 127 : face === FACE.NORTH ? -127 : 0;
    for (let v = 0; v < 4; v++) {
      const o = q * 12 + v * 3;
      positions[o] = it[1 + v * 3];
      positions[o + 1] = it[2 + v * 3];
      positions[o + 2] = it[3 + v * 3];
      normals[o] = nx;
      normals[o + 1] = ny;
      normals[o + 2] = nz;
    }
    for (let k = 0; k < 6; k++) indices[q * 6 + k] = q * 4 + QUAD_INDEX[k];
  }
  return { positions, normals, indices, quads: count };
}

/**
 * Lays the quads down as buffers a worker can hand over without copying.
 *
 * A greedy mesh shares no vertices -- every rectangle is its own four corners --
 * so this is four vertices and six indices a quad and no welding pass. That is
 * the cost the recommendation prices in vertex invocations, and it is stated
 * here rather than discovered later.
 */
function pack(quads, columns, rim, tops, cx, cz) {
  const count = quads.length;
  const positions = new Float32Array(count * 12);
  // The one thing besides the corner that a vertex carries, and it is a
  // property of the ORIENTATION and not of a voxel: six values in the whole
  // world, constant over any rectangle a merge could produce, so it can never
  // split one. A byte a component rather than a float: what the frame is short
  // of here is vertex fetch, and three bytes read the same as twelve.
  const normals = new Int8Array(count * 12);
  // Kept beside it for the offline statistics, and NOT uploaded: the material
  // separates the top from the flanks off the normal it already has.
  const faces = new Uint8Array(count);
  const indices = count * 4 > 65535
    ? new Uint32Array(count * 6) : new Uint16Array(count * 6);
  // The box, gathered here rather than left for three.js to walk the vertices
  // for a second time on the thread the walker is on. It is what lets the
  // frustum throw a chunk away, so it has to exist -- and computing it is the
  // single longest thing the main thread was doing while the disc landed.
  let lo = Infinity;
  let hi = -Infinity;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let q = 0; q < count; q++) {
    const it = quads[q];
    const face = it[0];
    faces[q] = face;
    const nx = face === FACE.EAST ? 127 : face === FACE.WEST ? -127 : 0;
    const ny = face === FACE.TOP ? 127 : face === FACE.BOTTOM ? -127 : 0;
    const nz = face === FACE.SOUTH ? 127 : face === FACE.NORTH ? -127 : 0;
    for (let v = 0; v < 4; v++) {
      const o = q * 12 + v * 3;
      positions[o] = it[1 + v * 3];
      positions[o + 1] = it[2 + v * 3];
      positions[o + 2] = it[3 + v * 3];
      if (positions[o] < x0) x0 = positions[o];
      if (positions[o] > x1) x1 = positions[o];
      if (positions[o + 1] < lo) lo = positions[o + 1];
      if (positions[o + 1] > hi) hi = positions[o + 1];
      if (positions[o + 2] < z0) z0 = positions[o + 2];
      if (positions[o + 2] > z1) z1 = positions[o + 2];
      normals[o] = nx;
      normals[o + 1] = ny;
      normals[o + 2] = nz;
    }
    for (let k = 0; k < 6; k++) indices[q * 6 + k] = q * 4 + QUAD_INDEX[k];
  }
  return {
    cx,
    cz,
    positions,
    normals,
    faces,
    indices,
    tops,
    quads: count,
    columns,
    rim,
    sphere: count ? {
      x: (x0 + x1) / 2,
      y: (lo + hi) / 2,
      z: (z0 + z1) / 2,
      radius: 0.5 * Math.hypot(x1 - x0, hi - lo, z1 - z0),
    } : null,
    minY: lo,
    maxY: hi,
  };
}

/**
 * The whole disc, meshed, and the numbers the budget is read off.
 *
 * ALL THREE FAMILIES ARE COUNTED, AND THE ONE THAT WAS MISSING WAS DECLARED
 * MISSING. The fusion figure used to leave the bare earth out, which understated
 * the disc by the whole of it -- E-V1k names the gap, 0.5334 against 0.5409 with
 * both. Every rectangle any of the three meshes carries is geometry the card
 * draws, so all of them are in `quads` here, and `earthQuads` and `pavingQuads`
 * keep the split readable.
 *
 * AND THE PAVING ENTERS THIS NUMBER WHILE IT LEAVES ANOTHER. The corridor cost
 * 3 638 triangles and one draw in a budget of its own (E-V3g, §2.9); it is part
 * of the disc now and it is priced with the disc.
 */
export function meshDisc(onChunk, grain = true, radius = DISC_RADIUS) {
  let quads = 0;
  let earthQuads = 0;
  let pavingQuads = 0;
  let columns = 0;
  let rim = 0;
  const chunks = [];
  for (const { cx, cz } of chunkList(radius)) {
    const chunk = meshChunk(cx, cz, grain, radius);
    if (chunk.quads === 0 && chunk.earth.quads === 0 && chunk.paving.quads === 0) continue;
    quads += chunk.quads + chunk.earth.quads + chunk.paving.quads;
    earthQuads += chunk.earth.quads;
    pavingQuads += chunk.paving.quads;
    columns += chunk.columns;
    rim += chunk.rim;
    chunks.push(chunk);
    if (onChunk) onChunk(chunk);
  }
  return {
    chunks,
    quads,
    earthQuads,
    pavingQuads,
    columns,
    rim,
    triangles: quads * 2,
    quadsPerColumn: columns ? quads / columns : 0,
    // The same ratio with the edges of the piece taken out, which is the figure
    // that carries to a world: a disc of fourteen metres is a third edge and a
    // world is almost none.
    insidePerColumn: columns ? (quads - rim) / columns : 0,
  };
}
