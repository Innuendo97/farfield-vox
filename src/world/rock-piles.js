import { VOXEL, stoneHash } from './voxel/pure.js';
import { groundHeightAt } from './contracts.js';
// With the attribute and not bare, which is not a style: this file has to load
// under plain node as well as through the bundler, and node refuses a JSON
// import without it. src/world/contracts.js reads its own seat the same way.
import PLAN from '../../assets-src/rocks/rocks.json' with { type: 'json' };

// THE ROCKS, AS PILES OF CUBES. The arithmetic half, with nothing a browser
// owns in it.
//
// NO three.js AND NO DOM, for the same reason src/world/voxel/pure.js has
// none: what this file produces is a COUNT as much as a shape — how many cells
// a pile is, how many faces survive the merge — and a number the budget rests
// on has to be askable offline, under plain node, without a running page.
// src/world/rocks.js is the page's half and builds the material.
//
// WHAT A ROCK OF THIS WORLD IS NOW. It used to be a decimated sphere out of a
// modeller, delivered as a glTF scene with a Cycles bake of the light on it and
// a hand-inverted albedo taken off a palette. Every one of those three is gone.
// A rock is a PILE OF CUBES on the same 0.10 m lattice as everything else that
// stands on this ground, generated from the plan the reference camera traced —
// and the plan is the only thing about it that is still a file.
//
// AND THE PILE IS WHY, not a saving. The one place in either target where three
// orientations of ONE material can be told apart by geometry rather than by
// brightness is the stone cluster east of the eye: the fitted camera puts +X at
// 117.6 px per metre there and +Z at (63.7, 41.3), so a cube's top lies above
// its own centre, its west face to the left at half the width and its south
// face to the right at twice it. A decimated sphere has no such faces. A pile
// of cubes is nothing but such faces, and at that range a 0.20 m face is
// twenty-three pixels across — which is what makes the orientation of a rock
// READABLE instead of merely present.

// ------------------------------------------------------------- the two sizes
//
// A PILE IS LAID IN TWO SIZES AND THAT IS THE WHOLE OF ITS GRAIN. The slab is
// two cells on a side and the cube is one, and a pile that used only the first
// reads as a staircase while one that used only the second reads as gravel.
// The targets' cluster shows both: large flat faces carrying the orientation,
// with a smaller broken course at the shoulders and the foot.
export const SLAB = 2;                     // cells on a side, so 0.20 m
export const SLAB_SHARE = 0.62;            // how much of a pile is laid in slabs

// How far up a pile the slabs reach, and over how many metres the share falls
// away. Declared and not measured, and declared because it is the shape of a
// scree pile rather than a reading: big pieces settle low and the broken stuff
// rides on top, so the share falls with height rather than being uniform.
//
// IN METRES ABOVE THE FOOT AND NOT IN A FRACTION OF THE PILE, which is the one
// decision in this law that is about the fragment rather than about the rock. A
// fraction would need the pile's own height down in the shader, and the whole
// point of the architecture is that the fragment rebuilds what it needs from
// its own position and the two numbers a pile carries. 0.62 m is the tallest
// pile in the plan, so over the piles that have a shoulder the two forms differ
// by nothing worth a third uniform.
export const SLAB_FALLOFF = 0.55;
export const SLAB_REACH = 0.62;

// ------------------------------------------------------------- the profile
//
// A ROUNDED PYRAMID AND NOT A DOME. `1 - d` is a cone and its silhouette is a
// straight line no stepping can hide; `sqrt(1 - d^2)` is a dome and its
// shoulders fall away too fast to carry a slab. Between the two is the shape
// the cluster actually draws: a broad shoulder that turns over near the rim.
export const PROFILE_POWER = 2.4;
export const PROFILE_ROOT = 0.62;

// How much of its own height a column may stray from the profile. This is what
// makes a pile STEPPED rather than turned on a lathe, and it is the only place
// randomness reaches the silhouette.
export const WOBBLE = 0.34;

// ------------------------------------------------------------ what a cell is
//
// Three families, and every one of them is a fact about WHERE the cell is
// rather than a property stored on it — which is what lets the whole pile merge
// and lets the fragment rebuild the answer from its own position.
export const STONE = 0;
export const EARTH = 1;
export const GRASS = 2;

// The brown cubes at the boundary with the grass. In both targets the rocks do
// not sit ON the meadow, they sit IN it: there is a course of bare earth where
// the stone breaks the turf, and without it a pile reads as a prop dropped on a
// lawn. It is one cell deep, which is the depth the picture shows at this
// range — a second course of it reads as a plinth.
export const EARTH_COURSE = 1;

// And the green cube on top of some piles. The reference shows turf that has
// climbed the low rocks and stopped; it is on SOME of them, which is the fact,
// so it is a hash on the pile and not a rule about all of them.
export const GRASS_SHARE = 0.45;

/**
 * The piles, as the rest of the world needs to know them.
 *
 * The plan is read and not copied: the pixels these occupy were traced back
 * through the reference camera onto the meadow, and moving one of them here
 * would be a second opinion about where a rock is.
 */
export const ROCK_PILES = PLAN.rocks.map((rock) => ({
  name: rock.name,
  role: rock.role,
  x: rock.x,
  z: rock.z,
  radius: rock.radius,
  height: rock.height,
  seed: rock.seed,
}));

/** The ones solid enough that walking through them would be a hole in the world. */
export const ROCK_BLOCKERS = ROCK_PILES
  .filter((rock) => rock.radius >= 0.45)
  .map((rock) => ({
    x: rock.x,
    z: rock.z,
    // A square inside the round: a blocker is a box, and one that reached the
    // full radius would stop the walker in the air beside the stone.
    halfWidth: rock.radius * 0.72,
    halfDepth: rock.radius * 0.72,
    rotationY: 0,
  }));

/**
 * Where a pile's foot is, in metres.
 *
 * ON THE GROUND CONTRACT AND NOT ON THE PLAN'S OWN `ground` FIELD, which is the
 * one number of the old plan this deliberately does not read. That field was
 * sampled off a meadow that has since been rewritten twice; the contract is the
 * height the walker stands at and the height the grass is planted at, and a
 * rock floating a centimetre over its own shadow is the shape that disagreement
 * comes in.
 *
 * SNAPPED DOWN TO THE LATTICE, so the bottom face of a pile is a plane of the
 * same grid every other cube in this world sits on, and the earth course meets
 * the turf instead of hovering over it.
 */
export function footOf(rock) {
  return Math.floor(groundHeightAt(rock.x, rock.z) / VOXEL) * VOXEL;
}

/** How many cells across and up a pile is allowed to be. */
export function extentOf(rock) {
  return {
    half: Math.max(1, Math.round(rock.radius / VOXEL)),
    tall: Math.max(2, Math.round((rock.height + EARTH_COURSE * VOXEL) / VOXEL)),
  };
}

/**
 * How tall the pile stands over one column of its footprint, in whole cells.
 *
 * The profile, then the wobble, then the QUANTISING — and the order matters.
 * Wobbling a height that has already been rounded moves it by whole cells and
 * the pile comes out as a field of spikes; wobbling first and rounding after is
 * what makes a step a step.
 */
export function columnCells(rock, di, dk) {
  const { half, tall } = extentOf(rock);
  const d = Math.hypot(di, dk) / half;
  if (d > 1) return 0;
  const profile = (1 - d ** PROFILE_POWER) ** PROFILE_ROOT;
  const draw = stoneHash(di + rock.seed, dk - rock.seed, rock.seed)[0];
  const cells = tall * profile * (1 + WOBBLE * (draw - 0.5) * 2);
  const whole = Math.max(0, Math.min(tall, Math.round(cells)));
  // AND A COLUMN OF ONE CELL IS NOT A COLUMN, it is the taper — and the taper
  // is what turns a pile into a pancake with a rock on it. Worse, the bottom
  // cell of every column is EARTH, so a rim of one-cell columns comes out as a
  // flat brown plate laid all round the stone: a doormat, which is precisely
  // the plinth this law's own comment says not to build. So the rim is cut and
  // the earth is a collar under stone rather than a mat beside it.
  return whole < 2 ? 0 : whole;
}

/**
 * Whether the slab covering a cell is laid whole.
 *
 * A slab is a 2x2x2 super-cell of the lattice and it is ALL OR NOTHING: laid,
 * it is one 0.20 m piece of stone and its faces are what carry the orientation;
 * not laid, its eight cells answer to the column height one at a time and what
 * is left is the broken grain. The draw is on the super-cell, so the eight
 * agree without anything being stored.
 *
 * ON THE WORLD'S OWN SUPER-CELLS AND NOT ON THE PILE'S, which is what lets this
 * law be written twice — here as geometry and in the fragment as a joint and a
 * tint — off the same three numbers. A pile-local index would need the pile's
 * origin down in the shader and the two would drift the day a radius changed.
 *
 * @param {number} si  the super-cell of the WORLD lattice, floor(cell / SLAB)
 * @param {number} sk  and the third
 * @param {number} up  metres above the pile's foot
 * @param {number} seed the pile's own, which is what keeps two piles apart
 */
export function slabAt(si, sj, sk, up, seed) {
  const share = SLAB_SHARE
    * (1 - SLAB_FALLOFF * Math.max(0, Math.min(1, up / SLAB_REACH)));
  return stoneHash(si * 3 + seed, sj * 5, sk * 7 - seed)[1] < share;
}

/** Whether a pile carries a cube of turf on its head. */
export function hasGrassCap(rock) {
  return stoneHash(rock.seed, 101, 7)[0] < GRASS_SHARE;
}

/** Where a pile's cells sit on the WORLD lattice, which is what the slabs hash on. */
export function originOf(rock, foot) {
  const { half } = extentOf(rock);
  return {
    x: Math.round(rock.x / VOXEL) - half,
    y: Math.round(foot / VOXEL),
    z: Math.round(rock.z / VOXEL) - half,
  };
}

/**
 * The pile as a field of cells, and what family each cell belongs to.
 *
 * @returns {object} the field, its origin in cells and its extent
 */
export function pileField(rock, foot = footOf(rock)) {
  const { half, tall } = extentOf(rock);
  const wide = half * 2 + 1;
  const origin = originOf(rock, foot);
  const cells = new Uint8Array(wide * wide * tall).fill(255);
  const at = (i, j, k) => (j * wide + k) * wide + i;

  // The column heights first, then the slabs over them: a slab that is laid
  // FILLS its eight cells even where the column under it stopped, which is what
  // puts a shelf on the side of a pile instead of a smooth taper.
  const column = new Int16Array(wide * wide);
  for (let k = 0; k < wide; k++) {
    for (let i = 0; i < wide; i++) {
      column[k * wide + i] = columnCells(rock, i - half, k - half);
    }
  }

  for (let j = 0; j < tall; j++) {
    for (let k = 0; k < wide; k++) {
      for (let i = 0; i < wide; i++) {
        let solid = j < column[k * wide + i];
        if (!solid) {
          // The slab reaches out over a column that stopped short, but only
          // where MOST of what it covers is stone: a slab hanging off the rim
          // of a pile on one corner is a diving board.
          const si = Math.floor((origin.x + i) / SLAB);
          const sj = Math.floor((origin.y + j) / SLAB);
          const sk = Math.floor((origin.z + k) / SLAB);
          if (slabAt(si, sj, sk, j * VOXEL, rock.seed)) {
            let under = 0;
            let seen = 0;
            for (let b = 0; b < SLAB; b++) {
              for (let a = 0; a < SLAB; a++) {
                // Back into the pile's own indices: the super-cell is the
                // world's, and the columns are this pile's.
                const ii = si * SLAB + a - origin.x;
                const kk = sk * SLAB + b - origin.z;
                if (ii < 0 || kk < 0 || ii >= wide || kk >= wide) continue;
                seen++;
                if (sj * SLAB - origin.y < column[kk * wide + ii]) under++;
              }
            }
            solid = seen > 0 && under * 2 > seen;
          }
        }
        if (solid) cells[at(i, j, k)] = j < EARTH_COURSE ? EARTH : STONE;
      }
    }
  }

  // The cube of turf, on the highest column of a pile that carries one. The
  // highest and not a random one: turf climbs to the crown and stops, and a
  // green cube halfway down a flank reads as a mistake rather than as moss.
  let cap = null;
  if (hasGrassCap(rock)) {
    let best = -1;
    let bi = half;
    let bk = half;
    for (let k = 0; k < wide; k++) {
      for (let i = 0; i < wide; i++) {
        const h = column[k * wide + i];
        if (h > best) { best = h; bi = i; bk = k; }
      }
    }
    for (let j = tall - 1; j >= 0; j--) {
      if (cells[at(bi, j, bk)] !== 255) {
        cells[at(bi, j, bk)] = GRASS;
        // In WORLD cells, because that is the only frame the fragment has: it
        // knows where it is and it knows the pile's foot, and from those two it
        // can ask whether this cell is the one carrying the turf.
        cap = { x: origin.x + bi, y: origin.y + j, z: origin.z + bk };
        break;
      }
    }
  }

  return { cells, wide, tall, half, at, origin, cap };
}

// The six directions a face can look, as the mesher walks them: the axis, the
// side, and the two axes that span the slice.
const FACES = [
  { axis: 0, sign: 1 }, { axis: 0, sign: -1 },
  { axis: 1, sign: 1 }, { axis: 1, sign: -1 },
  { axis: 2, sign: 1 }, { axis: 2, sign: -1 },
];

/**
 * One pile, greedily merged.
 *
 * THE MERGE IS THE BUDGET AND NOT A TIDINESS. Ten piles at two triangles a cell
 * face is thousands of triangles for a shape that covers a twentieth of the
 * frame; merged, the flat side of a pile is ONE rectangle however many cells it
 * spans. The count both ways is reported by pileCensus() so that the saving is
 * a measurement rather than a claim.
 *
 * AND NOTHING PER CELL IS HANDED OVER. Positions, normals and indices, and that
 * is the whole of it: a rectangle standing for forty cells cannot say which of
 * the forty a corner belongs to, so which family a fragment is in, which piece,
 * and how the tile lies are all rebuilt in the fragment out of its own
 * position. It is the same architecture as the meadow's and the wall's, for the
 * same reason.
 *
 * SO THE FAMILIES ARE MERGED SEPARATELY. Earth and turf are not stone and a
 * rectangle may not span two of them: the merge runs once per family, which
 * costs a handful of rectangles and buys a boundary the fragment does not have
 * to guess at.
 *
 * @param {object} rock  an entry of ROCK_PILES
 * @param {number} foot  the height its bottom face sits at, in metres
 */
export function meshPile(rock, foot = footOf(rock)) {
  const { cells, wide, tall, at, origin, cap } = pileField(rock, foot);
  const originX = origin.x;
  const originZ = origin.z;
  const originY = origin.y;
  const size = [wide, tall, wide];

  const positions = [];
  const normals = [];
  const indices = [];
  let quads = 0;
  let faces = 0;

  const family = (i, j, k) => {
    if (i < 0 || j < 0 || k < 0 || i >= wide || j >= tall || k >= wide) return 255;
    return cells[at(i, j, k)];
  };

  for (const { axis, sign } of FACES) {
    // The two axes that span a slice of this direction, in a fixed order so
    // that a rectangle's winding is the same on every face of the pile.
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const step = [0, 0, 0];
    step[axis] = sign;

    for (let slice = 0; slice < size[axis]; slice++) {
      // The mask of this slice: which family owns a face here, or 255 for none.
      const mask = new Uint8Array(size[u] * size[v]).fill(255);
      const cell = [0, 0, 0];
      for (let b = 0; b < size[v]; b++) {
        for (let a = 0; a < size[u]; a++) {
          cell[axis] = slice; cell[u] = a; cell[v] = b;
          const here = family(cell[0], cell[1], cell[2]);
          if (here === 255) continue;
          const outside = family(cell[0] + step[0], cell[1] + step[1], cell[2] + step[2]);
          if (outside !== 255) continue;
          mask[b * size[u] + a] = here;
          faces++;
        }
      }

      // And the greedy sweep over it: grow a rectangle as far along u as one
      // family runs, then as far along v as the whole row repeats.
      for (let b = 0; b < size[v]; b++) {
        for (let a = 0; a < size[u]; a++) {
          const kind = mask[b * size[u] + a];
          if (kind === 255) continue;
          let w = 1;
          while (a + w < size[u] && mask[b * size[u] + a + w] === kind) w++;
          let h = 1;
          grow: while (b + h < size[v]) {
            for (let c = 0; c < w; c++) {
              if (mask[(b + h) * size[u] + a + c] !== kind) break grow;
            }
            h++;
          }
          for (let d = 0; d < h; d++) {
            for (let c = 0; c < w; c++) mask[(b + d) * size[u] + a + c] = 255;
          }

          // The rectangle, in metres, on the face of the slice the normal
          // points out of.
          const low = [0, 0, 0];
          low[axis] = slice + (sign > 0 ? 1 : 0);
          low[u] = a;
          low[v] = b;
          const du = [0, 0, 0]; du[u] = w;
          const dv = [0, 0, 0]; dv[v] = h;
          const corner = (fu, fv) => [
            (originX + low[0] + fu * du[0] + fv * dv[0]) * VOXEL,
            (originY + low[1] + fu * du[1] + fv * dv[1]) * VOXEL,
            (originZ + low[2] + fu * du[2] + fv * dv[2]) * VOXEL,
          ];
          const base = positions.length / 3;
          const quad = sign > 0
            ? [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)]
            : [corner(0, 0), corner(0, 1), corner(1, 1), corner(1, 0)];
          for (const p of quad) {
            positions.push(p[0], p[1], p[2]);
            normals.push(step[0], step[1], step[2]);
          }
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          quads++;
        }
      }
    }
  }

  return { positions, normals, indices, quads, faces, origin, cap };
}

/**
 * What the piles cost, both ways, without a browser.
 *
 * The number the merge is argued on is faces-over-quads, and it is claimed by a
 * running page in a HUD. This is where it can be checked.
 */
export function pileCensus(piles = ROCK_PILES) {
  const rows = [];
  let quads = 0;
  let faces = 0;
  let cells = 0;
  for (const rock of piles) {
    const foot = footOf(rock);
    const field = pileField(rock, foot);
    let solid = 0;
    for (const c of field.cells) if (c !== 255) solid++;
    const built = meshPile(rock, foot);
    rows.push({
      name: rock.name,
      role: rock.role,
      cells: solid,
      wide: field.wide,
      tall: field.tall,
      faces: built.faces,
      quads: built.quads,
      grass: hasGrassCap(rock),
    });
    quads += built.quads;
    faces += built.faces;
    cells += solid;
  }
  return {
    rows,
    cells,
    faces,
    quads,
    triangles: quads * 2,
    unmergedTriangles: faces * 2,
    fusion: faces ? quads / faces : 0,
  };
}
