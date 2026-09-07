import { VOXEL, stoneHash } from './voxel/pure.js';
import { groundHeightAt } from './contracts.js';
// With the attribute and not bare, which is not a style: this file has to load
// under plain node as well as through the bundler, and node refuses a JSON
// import without it. src/world/contracts.js reads its own seat the same way.
import PLAN from '../../assets-src/rocks/rocks.json' with { type: 'json' };
// Where the fountain stands, asked of the seat that decides it: the pool and
// the basin that holds it cannot be two opinions about one circle.
import { FOUNTAIN } from './monoliths.js';

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
// AND THE READING SAYS A THIRD, WHICH THIS FILE NOW TAKES. Counted on the day
// target's low right cluster (R5 SS1.8), the reference builds its piles out of
// SINGLE cubes with a slab here and there -- eleven grey components over 150 px,
// the two largest 1.08 x 0.65 m and 0.89 x 0.52 m, stepped -- where 0.62 drew a
// pile that was mostly 0.20 m plates and read as a stack of tiles.
//
// IT WAS REFUSED ONCE, BY NAME, AND THE REFUSAL IS WHAT HANDS IT OVER. The
// session that fitted the pigment wrote here that 0.35 measured +72 triangles
// on the ten piles, that its own mandate was budgeted at nought, and that "the
// SHAPE of a pile belongs to the session that has a budget for shape". This is
// that session: the loose stone carries a triangle budget, the seventy-two are
// inside it, and a refusal that named its successor is not a decision anybody
// gets to take twice.
export const SLAB_SHARE = 0.35;            // how much of a pile is laid in slabs

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
// AND IT IS 0.42 NOW, WHICH IS THE SECOND REFUSAL TAKEN OFF THE SHELF AND THEN
// STOPPED BY A WALL. R5 SS3 (S6) asks for 0.5, because a target pile is BROKEN
// where ours came out tidy -- the defect V2-DEV3 recorded in SS3.3 and left
// standing -- and 0.5 is where its prototype was measured. The triangles it
// costs are the reason the material session could not take it and they are
// inside the loose stone's budget here. What it buys is the one thing a pigment
// cannot: the silhouette.
//
// IT STOPS AT 0.42 AND THE WALL IS A MEASUREMENT, not a taste. The more a column
// may stray, the more often two columns of a pile end up touching ONLY along a
// vertical edge, with air on both of the orthogonal sides -- a pinch, where four
// faces meet at one edge and the surface is no longer a manifold. Swept against
// tools/guards/guard-avvolgimento.mjs on the ten piles of the plan:
//
//   0.34 (as delivered)   2848 faces   0 conflicting edges
//   0.40                  3026         0
//   0.42                  3032         0
//   0.44                  3040         1
//   0.50 (R5's own)       3174         1
//
// A pinched shell is a defect this campaign has a guard for and a register that
// is explicitly a ratchet rather than a carpet, so the value stops where the
// shell is still closed. 0.42 takes 184 of the 326 extra faces 0.5 was worth,
// which is most of the breaking; the rest needs the FIELD to refuse a diagonal
// contact, and that is a change to how a pile is cut rather than to how far a
// column may stray. Named here for whoever wants the last third of it.
export const WOBBLE = 0.42;

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
// AND IT STAYS AT ONE, WHICH IS A REFUSAL AND IS WRITTEN DOWN AS ONE. R5 SS3
// (S6) asks for two courses of earth under a pile, because the reference shows
// a band of brown with the grass climbing out of it; two of them measured +582
// triangles on the ten piles, and the mandate that carries this material is
// budgeted at nought. It is also the one recommendation in that section that
// SS7 of the same research says it could not measure at the fitted pose -- the
// meadow covers the foot -- so it is a change that costs a number and buys a
// reading nobody has taken. It goes with the loose stones, which have a
// triangle budget; here it would be spent blind.
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

// ------------------------------------------------- the loose stone's own law
//
// WHY THE RUINS AND THE BASIN ARE CUT FROM HERE AND DRAWN OVER THERE.
//
// Everything from this line to `looseStoneSolids` below was private to
// src/world/loose-stone.js, which is the mesh half: it turns the two laws into
// cubes with a pigment on them. What made the split necessary is that a SECOND
// reader appeared -- the camera, which has to know what a lens may not pass
// through -- and the plan alone cannot tell it: the cut rounds a 0.57 m piece up
// to three cells of 0.20 and a 0.32 m piece up to two, so a box built from the
// plan's own width and height is 30 mm narrower than the stone in one place and
// 80 mm shorter than it in another, and a box short of the stone is a hole.
//
// AND IT HAD TO COME HERE RATHER THAN STAY THERE, which is a fact about node and
// not a preference. The camera's list is published by src/world/contracts.js,
// which every measuring tool imports under plain node; contracts.js importing
// the MESH file closes a ring -- rocks -> rock-piles -> contracts -> loose-stone
// -> rocks -- whose top level cannot be evaluated in either order, and guard-fiori
// died on it. This file reaches nothing that comes back round, which is the same
// property that made it the arithmetic half of the piles.
//
// NOTHING BELOW IS NEW. It is U-PIETRA-2's law, moved, with the drawing left
// where the drawing was.

/**
 * The loose stone's own draw: one sine, folded.
 *
 * NOT stoneHash above, and they must not be merged. That one is the PILES', it
 * is hashed on three integers of the world lattice and every cube of scree in
 * this world is placed by it; this is the ruins' and the basin's, it takes
 * seeds and indices, and the two were fitted against different pictures. One
 * name for both would be a change to where every stone in the meadow lies.
 */
export const looseHash = (a, b, c) => {
  const x = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return x - Math.floor(x);
};

// --------------------------------------------------------- the ruins' law
//
// A ruin is a STEPPED STACK of dressed cubes and not a heap: the target's are
// "blocchi squadrati pallidi ... in 1-2 corsi" with hard terraces, which is the
// whole of what separates them from the scree the piles beside them draw. So
// the columns of a ruin are quantised to whole courses and the outline is a
// rectangle eaten in from its corners, rather than the profile-and-wobble a
// pile is built from.
// THE BLOCK OF A RUIN IS THE SLAB OF THIS WORLD, 0.20 m, and the number was
// argued the other way first and measured back. R5 SS7 names a 0.35 m cell, but
// it names it for the OTHER of the two things it offers -- pieces of masonry
// generated like the stair -- and the pieces here are the second offer, the
// loose stones in the same grass as the scree. What that grass actually holds,
// read at SS1.8 on the day target's own clusters, is "pile a gradoni di cubi da
// UN voxel, con lastre 2x rare": the ruins are the size of the rocks beside
// them and it is the SQUARENESS and the pallor that separate them, not the
// grain. Built at 0.35 the same stack came out with two courses in it and no
// terrace at all, which is a plate and not a ruin.
export const RUIN_CELL = 2 * VOXEL;
export const BASIN_CELL = 2 * VOXEL;
// THE MOSS ON A RUIN IS A TUFT ON TOP OF A BLOCK AND NOT A BLOCK PAINTED GREEN.
//
// The first cut of this file recoloured whole cubes, and at 0.35 m a whole cube
// of moss is a third of a metre of green on the face the walker sees -- which is
// the very reading R5 SS1.5 names as the defect on the walls: "nel target il
// muschio sta nei CIUFFI di 1-3 px agli angoli dei blocchi e nelle colature al
// piede, non in chiazze di blocchi". So a tuft is a SMALL cube standing on the
// lid of a block, one or two voxels, exactly the thing the heads of the six
// carry -- one law for moss that is geometry, in both places it appears.
export const RUIN_MOSS_SHARE = 0.34;           // how many exposed lids grow a tuft
export const RUIN_TUFT = VOXEL;                // and how big one is
// How far in from the middle a column has fallen by the time it reaches the
// rim. 1.0 would be a pyramid with no top; this leaves the terraces the target
// steps its own stacks down in.
const RUIN_TAPER = 0.60;

// ---------------------------------------------------------- the basin's law
//
// The fountain of the fifth stands in a ring of pale stone and the target draws
// it plainly: a basin 1.61 m across holding a mirror of water 1.22 m across
// (R5 SS1.10, measured by V2-DEV5 in the same reading the globe's own metres
// come from). The ring is what makes the water READ: our meadow is a field of
// grass cubes and a disc of light lying in it at 0.20 m is a disc of light
// nobody can see the edge of — which is what this branch drew before this file.
//
// Its outer radius is the target's, its inner radius is the water's, and both
// are read from src/world/monoliths.js rather than restated, because the pool
// and the basin that holds it cannot be two opinions about one circle.
// AND IT IS A RIM AND NOT A TUB. One course, one block thick, with a second
// course on about a third of the ring so the lip is broken rather than turned:
// the water this basin holds stands at 0.20 m over the grass (POOL_LIFT, V2-DEV5's
// own reading) and a rim two courses tall all the way round puts that water at
// the bottom of a well the walker cannot see into. What the target draws is a
// lip the water comes up to, not a wall it hides behind.
const BASIN_COURSES = 1;
const BASIN_SECOND = 0.35;

// ---------------------------------------------------------------- THE RUINS
//
// SQUARED PALE BLOCKS, WHERE THE TARGET PUTS THEM AND THIS WORLD PUTS NOTHING.
//
// The piles above are the target's SASSI: rounded scree on the world's lattice,
// traced through the reference camera, and R5 SS1.8 finds ours at the size the
// target's are. What it also finds, and what nothing in this world answers, is
// a second family in the same grass -- "blocchi squadrati pallidi ... la stessa
// pietra della scalinata", stepped stacks of dressed cubes rather than scree,
// beyond the fifth block and to the left of the first.
//
// WHERE THEY STAND IS MEASURED AND NOT PLACED. The detector of R5 SS1.1 (grey =
// saturation under 0.30, luma 25 to 190, not blue) was run over the day target
// and over this branch's own frame at the fitted pose in the two windows the
// research names, and every component of 150 px or more was carried back onto
// the meadow through the reference camera -- the ray against the ground the
// contract delivers, not against the plane y = 0, which is a different answer
// wherever the meadow is not flat. What is listed below is the components the
// TARGET has and this branch's frame does not: everything within a rock's own
// radius plus half a metre was struck out as a pile we already draw.
//
//   foot px        world           w x h target      what our frame has there
//   (1524, 800)    ( 4.79, 6.48)   1.09 x 0.66 m     grass; our se-big is 1.37 m west
//   (  78, 716)    (-7.18, 2.98)   1.26 x 0.85 m     grass; the nearest rock is 4.9 m off
//   ( 266, 758)    (-4.12, 5.22)   0.57 x 0.30 m     grass
//   ( 145, 894)    (-2.79, 8.80)   0.18 x 0.31 m     grass
//   (1243, 903)    ( 2.27, 8.78)   0.12 x 0.08 m     grass
//
// AND THE HEIGHT IS CAPPED AT A METRE, which is the one number here that is a
// ruling rather than a reading: the tallest component the target gives in these
// windows measures 1.27 m on a stack seen at 17 m with the first block's shadow
// behind it, where a bounding box is as much shadow as stone. The mandate that
// carries this work says a metre and the tallest below is 0.85.
//
// THEY ARE A PLAN AND NOT A MESH. This file is the arithmetic half -- nothing
// here reaches a browser -- so what it holds is where the stones are and how
// big; src/world/loose-stone.js cuts them, in the one mesh that also carries
// the turf on the heads and the fountain's basin.
// AND THE HEIGHT IS THE COMPONENT'S OWN, ROUNDED TO WHOLE COURSES, which is
// the one thing about a ruin this file will not round UP. It was tried the
// other way -- the two large pieces written half a metre over their box,
// because the grass of this world stands taller than the target's and was
// burying them -- and what that measured, at the pose, was a WALL: a stack whose
// top stands only half a metre under the eye at nine metres is a stack the
// camera sees edge on, and every lid the target draws goes to two pixels. The
// grass that hides the foot belongs to the meadow's session; making a stone
// taller than the picture's to climb out of it is drawing the wrong thing twice.
export const RUINS = [
  { name: 'rovina-se', x: 4.79, z: 6.48, width: 1.09, depth: 0.76, height: 0.66, seed: 101 },
  { name: 'rovina-so', x: -7.18, z: 2.98, width: 1.26, depth: 0.86, height: 0.85, seed: 103 },
  { name: 'rovina-s', x: -4.12, z: 5.22, width: 0.57, depth: 0.44, height: 0.40, seed: 107 },
  { name: 'rovina-s2', x: -2.79, z: 8.80, width: 0.24, depth: 0.24, height: 0.32, seed: 109 },
  { name: 'rovina-e', x: 2.27, z: 8.78, width: 0.24, depth: 0.24, height: 0.20, seed: 113 },
];

/** The ones solid enough that walking through them would be a hole in the world. */
export const ROCK_BLOCKERS = [
  ...ROCK_PILES
    .filter((rock) => rock.radius >= 0.45)
    .map((rock) => ({
      x: rock.x,
      z: rock.z,
      // A square inside the round: a blocker is a box, and one that reached the
      // full radius would stop the walker in the air beside the stone.
      halfWidth: rock.radius * 0.72,
      halfDepth: rock.radius * 0.72,
      rotationY: 0,
    })),
  // AND THE RUINS BLOCK TOO, on the same rule and by the same reasoning. A
  // squared stack of stone two thirds of a metre tall that the walker strolls
  // through is the hole in the world this list exists to close; the ones under
  // the threshold are things you step over and are left out, exactly as the
  // scree under 0.45 m is. The box is the piece's own footprint rather than a
  // square inside a circle, because a ruin IS a box.
  ...RUINS
    .filter((ruin) => ruin.height >= 0.45)
    .map((ruin) => ({
      x: ruin.x,
      z: ruin.z,
      halfWidth: ruin.width / 2,
      halfDepth: ruin.depth / 2,
      rotationY: 0,
    })),
];

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
 * Where one ruin's columns stand and how many courses high each one is.
 *
 * PULLED OUT OF THE CUT SO THAT THE CUT IS NOT THE ONLY READER. A camera has to
 * know what a lens may not pass through, and a box drawn round a ruin from the
 * PLAN's own width and height is a second opinion about where the stone is: the
 * cut rounds a 0.57 m piece UP to three cells of 0.20 and a 0.32 m piece up to
 * two, so the plan is 30 mm narrower than the stone in one place and 80 mm
 * shorter than it in another -- and a box short of the stone is a hole a lens
 * goes through. So the shape is answered once and both of them read it. Nothing
 * here is new: it is the head of the loop that was already below, moved up.
 */
export function ruinColumns(plan) {
  const foot = Math.floor(groundHeightAt(plan.x, plan.z) / VOXEL) * VOXEL;
  const across = Math.max(1, Math.round(plan.width / RUIN_CELL));
  const deep = Math.max(1, Math.round(plan.depth / RUIN_CELL));
  const tall = Math.max(1, Math.round(plan.height / RUIN_CELL));
  const columns = [];
  for (let i = 0; i < across; i++) {
    for (let k = 0; k < deep; k++) {
      // How far this column stands from the middle of the piece, nought at the
      // centre and one at a corner. The stack steps DOWN from the middle out,
      // which is the shape the target's stacks have.
      const u = across === 1 ? 0 : Math.abs((i + 0.5) / across - 0.5) * 2;
      const v = deep === 1 ? 0 : Math.abs((k + 0.5) / deep - 0.5) * 2;
      const out0 = Math.max(u, v);
      const wobble = looseHash(plan.seed, i * 31 + k, 1) - 0.5;
      columns.push({
        i,
        k,
        courses: Math.round(tall * (1 - RUIN_TAPER * out0) + wobble),
        x: plan.x + (i - (across - 1) / 2) * RUIN_CELL,
        z: plan.z + (k - (deep - 1) / 2) * RUIN_CELL,
      });
    }
  }
  return { foot, across, deep, tall, columns };
}

/**
 * Where the basin's blocks lie and how many courses each column carries.
 *
 * Same reason as the ruins': the ring is laid on the world's lattice and eaten
 * out of an annulus, so nothing outside this file can say where its stone is
 * without saying it a second time.
 */
export function basinCells() {
  if (!FOUNTAIN) return null;
  const foot = Math.floor(groundHeightAt(FOUNTAIN.x, FOUNTAIN.z) / VOXEL) * VOXEL;
  const outer = FOUNTAIN.basinDiameter / 2;
  const inner = FOUNTAIN.poolDiameter / 2;
  // Laid on the world's own lattice rather than swept round a circle, so the
  // rim is a ring of CUBES the way the target's is and not a turned bowl.
  const reach = Math.ceil(outer / BASIN_CELL);
  const cells = [];
  for (let i = -reach; i <= reach; i++) {
    for (let k = -reach; k <= reach; k++) {
      const x = (i + 0.5) * BASIN_CELL;
      const z = (k + 0.5) * BASIN_CELL;
      const r = Math.hypot(x, z);
      if (r > outer || r < inner) continue;
      cells.push({
        i,
        k,
        x: FOUNTAIN.x + x,
        z: FOUNTAIN.z + z,
        courses: BASIN_COURSES + (looseHash(97, i * 31 + k, 17) < BASIN_SECOND ? 1 : 0),
      });
    }
  }
  return { foot, cells };
}

// --------------------------------------------- what a lens may not pass through
//
// THE LOOSE STONE WAS NOT IN THE CAMERA'S LIST AT ALL. src/world/contracts.js
// published the six blocks and the rocks and nothing else, so the two ruins the
// target puts in the near grass -- one of them 1.20 m across and 0.80 m tall --
// and the whole ring of the fountain were stone a lens could swing straight
// through. They are all under a metre, and under a metre is exactly where the
// arm ends up when the look goes down.
//
// A RUIN IS ONE BOX AND THE BASIN IS SEVERAL. A stepped stack is a rectangle
// with its corners eaten in, and a rectangle round the whole of it over-claims
// by a course at the corners -- nothing a lens can be stopped by, since the
// tallest ruin's own crown stands 0.80 m over the turf. The basin is not a
// rectangle at all: it is an ANNULUS, and one box over it would claim the mirror
// of water in the middle, which is a place a walker is meant to be able to put
// the lens. So the ring is merged into runs along one axis of the lattice it is
// laid on, one box a run, which is exact.

/**
 * Every loose stone in this world as a box a camera may not enter.
 *
 * `{ name, x, z, halfWidth, halfDepth, rotationY, y0, y1 }` -- the shape
 * src/world/contracts.js publishes and src/core/avatar.js tests a segment
 * against.
 *
 * THE TUFTS ARE IN, AND THEY ARE WHY THE TOP IS IN METRES RATHER THAN COURSES.
 * A tuft of moss is one voxel standing on the lid of the column it grew on,
 * inside that column's own footprint but 0.10 m above its crown -- so a box cut
 * to whole courses leaves the moss of the tallest column outside it. It costs a
 * tenth of a metre on a stack that a lens can never reach anyway, and it buys a
 * guard with no exception in it: every vertex of this mesh from the ruins on is
 * inside a box, and guard-avatar asserts exactly that with no allowance made.
 *
 * THE TURF ON THE HEADS OF THE SIX IS THE ONE THING LEFT OUT, and it is left out
 * by the same arithmetic rather than by hand: it is laid first, so the count of
 * its cubes is where the guard starts reading. Those lids stand five to thirteen
 * metres up, well inside the block's own box for every approach a walker has.
 */
export function looseStoneSolids() {
  const out = [];
  for (const plan of RUINS) {
    const { foot, columns } = ruinColumns(plan);
    let xLo = Infinity;
    let xHi = -Infinity;
    let zLo = Infinity;
    let zHi = -Infinity;
    let top = 0;
    for (const c of columns) {
      if (c.courses <= 0) continue;
      if (c.x - RUIN_CELL / 2 < xLo) xLo = c.x - RUIN_CELL / 2;
      if (c.x + RUIN_CELL / 2 > xHi) xHi = c.x + RUIN_CELL / 2;
      if (c.z - RUIN_CELL / 2 < zLo) zLo = c.z - RUIN_CELL / 2;
      if (c.z + RUIN_CELL / 2 > zHi) zHi = c.z + RUIN_CELL / 2;
      // The same draw the cut makes, off the same three numbers, so the box and
      // the cubes cannot disagree about whether this column grew a tuft.
      const tuft = looseHash(plan.seed, c.i * 31 + c.k, 3) < RUIN_MOSS_SHARE ? RUIN_TUFT : 0;
      const crown = c.courses * RUIN_CELL + tuft;
      if (crown > top) top = crown;
    }
    if (top === 0) continue;
    out.push({
      name: plan.name,
      x: (xLo + xHi) / 2,
      z: (zLo + zHi) / 2,
      halfWidth: (xHi - xLo) / 2,
      halfDepth: (zHi - zLo) / 2,
      rotationY: 0,
      y0: foot,
      y1: foot + top,
    });
  }

  const ring = basinCells();
  if (ring) {
    const rows = new Map();
    for (const c of ring.cells) {
      const row = rows.get(c.k) || [];
      row.push(c);
      rows.set(c.k, row);
    }
    for (const [, row] of [...rows].sort((a, b) => a[0] - b[0])) {
      row.sort((a, b) => a.i - b.i);
      let run = null;
      const close = () => {
        if (!run) return;
        out.push({
          name: `vasca ${run.k},${run.i0}`,
          x: (run.xLo + run.xHi) / 2,
          z: run.z,
          halfWidth: (run.xHi - run.xLo) / 2,
          halfDepth: BASIN_CELL / 2,
          rotationY: 0,
          y0: ring.foot,
          y1: ring.foot + run.courses * BASIN_CELL,
        });
        run = null;
      };
      for (const c of row) {
        // A run is broken by a gap in the lattice or by a change of height: a
        // box has one top, and merging two heights would claim the taller of
        // them over the shorter block.
        if (run && (c.i !== run.i + 1 || c.courses !== run.courses)) close();
        if (!run) {
          run = {
            k: c.k,
            i0: c.i,
            i: c.i,
            z: c.z,
            courses: c.courses,
            xLo: c.x - BASIN_CELL / 2,
            xHi: c.x + BASIN_CELL / 2,
          };
        } else {
          run.i = c.i;
          run.xHi = c.x + BASIN_CELL / 2;
        }
      }
      close();
    }
  }
  return out;
}

// ------------------------------------------------ what a lens may not pass through
//
// THE BOX ROUND A PILE, AND THE END OF THE SECOND OPINION ABOUT WHERE A ROCK IS.
//
// There were two lists. src/world/layout.js published `rockSeats()` — the rock
// PLAN, filtered — and src/world/contracts.js built the camera's boxes out of
// it, taking their vertical extent from the plan's own `y` and `meshHeight`.
// Those two fields belong to the SMOOTH ROCK MESH V8 used to draw, cut against a
// meadow that has been rewritten twice since, and this branch does not draw that
// mesh: it cuts the piles above, on the ground contract, on this world's own
// lattice. So the camera was guarding boxes that no longer stood where the stone
// does, and the arithmetic says how far off by name:
//
//   pile           the plan's box       the stone as cut     what the lens got
//   rock-w1        0.541 .. 1.027 m     0.000 .. 0.400 m     NOTHING: the box
//                                                            and the stone do
//                                                            not touch
//   rock-e1        0.367 .. 0.996       0.000 .. 0.500       133 mm of 500
//   rock-w2        0.342 .. 0.914       0.000 .. 0.500       158 mm of 500
//   rock-sw       -0.507 .. 0.293       0.000 .. 0.700       293 mm of 700
//   rock-se-big   -0.456 .. 0.344       0.000 .. 0.700       344 mm of 700
//
// and four of the ten piles — se-round, se-small, n1, n2 — had no box at all,
// because the plan's 0.45 m filter is the WALKER's rule about what he may step
// over and was never a statement about what a lens may enter.
//
// SO THE CAMERA READS THE STONE. Not the plan: the cells the mesher actually
// fills, asked of pileField above, which is the one law that says what a pile is.
// A box built from that cannot drift from the stone, because it is measured off
// the same array the triangles come out of, and guard-avatar checks the
// containment cell by cell rather than taking this comment's word for it.
//
// IT IS THE BOUNDING BOX AND NOT A SQUARE INSIDE THE ROUND, and that reverses
// the rule the old seat carried, on a number. The old rule kept the box at 0.72
// of the radius so that the lens was not stopped in the air beside a rounded
// stone; the corners of a bounding box over a domed pile are empty by up to
// 0.23 m. But NO PILE CAN EVER SHORTEN THIS ARM: the tallest of the ten stands
// 0.70 m over its foot, the camera's own floor is the ground plus 0.25 m
// (GROUND_CLEARANCE in src/core/avatar.js), and the rig carries the lens 1.583 m
// above the walker's feet — so the segment this box is tested against passes a
// clear metre and a half over the highest stone in the list, at every pitch the
// arm survives. The corner over-claim costs nothing that can be photographed;
// the hole it replaces was 400 mm of stone with no box on it. The piles are in
// the list because the list is what the world is made of, and because a guard
// that walks a ring round every box has to be given every box.
//
// AND THE WALKER IS NOT TOUCHED. ROCK_BLOCKERS above is his, on his own 0.45 m
// threshold and his own 0.72 of the radius, both ratified with the piles; that
// square is up to 132 mm narrower than the stone this measures, which is a
// residue reported to whoever owns the scree and not a thing to change here
// while a camera is being fixed.

/** The boxes, built on first ask and kept: ten fields is not free twice. */
const PILE_BOXES = new Map();

/**
 * Where one pile really stands, as a box in world metres.
 *
 * `{ name, x, z, halfWidth, halfDepth, rotationY, y0, y1 }` — the shape
 * src/world/contracts.js publishes and src/core/avatar.js tests a segment
 * against.
 */
export function pileBox(rock) {
  const held = PILE_BOXES.get(rock.name);
  if (held) return held;
  const foot = footOf(rock);
  const field = pileField(rock, foot);
  const { cells, wide, tall, at, origin } = field;
  let i0 = Infinity; let i1 = -Infinity;
  let k0 = Infinity; let k1 = -Infinity;
  let j0 = Infinity; let j1 = -Infinity;
  for (let j = 0; j < tall; j++) {
    for (let k = 0; k < wide; k++) {
      for (let i = 0; i < wide; i++) {
        if (cells[at(i, j, k)] === 255) continue;
        if (i < i0) i0 = i; if (i > i1) i1 = i;
        if (k < k0) k0 = k; if (k > k1) k1 = k;
        if (j < j0) j0 = j; if (j > j1) j1 = j;
      }
    }
  }
  // A pile with nothing in it is not a thing a lens can enter. It cannot happen
  // — columnCells keeps at least the middle — but a box with infinities in it
  // would be, so it is answered rather than assumed.
  if (i1 < i0) return null;
  const xLo = (origin.x + i0) * VOXEL;
  const xHi = (origin.x + i1 + 1) * VOXEL;
  const zLo = (origin.z + k0) * VOXEL;
  const zHi = (origin.z + k1 + 1) * VOXEL;
  const box = {
    name: rock.name,
    x: (xLo + xHi) / 2,
    z: (zLo + zHi) / 2,
    halfWidth: (xHi - xLo) / 2,
    halfDepth: (zHi - zLo) / 2,
    rotationY: 0,
    y0: (origin.y + j0) * VOXEL,
    y1: (origin.y + j1 + 1) * VOXEL,
  };
  PILE_BOXES.set(rock.name, box);
  return box;
}

/** Every pile as a box, in the order the plan lists them. */
export function pileSolids(piles = ROCK_PILES) {
  const out = [];
  for (const rock of piles) {
    const box = pileBox(rock);
    if (box) out.push(box);
  }
  return out;
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
