import { MONOLITHS } from '../layout.js';

// The masonry and the stone tile, as arithmetic.
//
// Pure arrays and no three.js, for the same reason the mesher is: this is where
// the block count and the tile come from, and both have to be checkable under
// plain node instead of only through a browser. src/core/sky.js cannot be
// imported outside the bundler — it reads its preset out of a bare JSON import
// — so anything that has to answer offline has to stand clear of it.
//
// THE DOOR IS WIDER THAN IT WAS AND ITS SIGNATURE IS NOT. buildMasonry(spec)
// still takes one argument and still reads spec.size and spec.rotationY; what
// is new is that it also reads spec.masonry, and everything the measurement of
// the two targets had to say about this wall travels in there AS DATA. The
// numbers themselves live in assets-src/monoliths/masonry-spec.json, which is
// V2's reading of one picture; the constants below stay exported, stay the
// DEFAULTS, and stay what anybody measures against. A spec with no masonry
// block builds the wall this file has always built.
//
// WHY THE LAW OF A COURSE CHANGED, AND IT IS NOT A TASTE. A block used to be
// drawn by walking along a course picking one of three lengths at random. That
// walk cannot be undone: to know which block a point on the wall belongs to you
// have to replay the whole course from its corner. So every block had to hand
// its own coordinate to its own four corners — a per-block property in a vertex
// attribute — and a wall of blocks could never be merged into anything.
//
// The law here is a LATTICE instead of a walk: cells of one width, a stagger
// that is a phase of that lattice, and a block that is a run of cells with the
// boundaries between them suppressed at a stated rate. Three properties fall
// out of that and all three are why it is worth the change:
//
//   1. A POINT CAN NAME ITS OWN BLOCK. floor() and a hash, in constant time, so
//      the tint and the joint are rebuilt in the fragment out of the fragment's
//      own position and NOTHING per block is ever stored. The mesh below hands
//      back positions, normals and indices and no fourth thing.
//   2. THE FACES OF A COURSE MERGE. Adjacent cells of one course are one
//      rectangle, so a wall is a handful of quads instead of two per block.
//      What breaks a run is what SHOULD break it: the head stepping down, a
//      recess, the end of the wall.
//   3. IT IS WHAT THE MEASUREMENT SAYS. A run of cells with the boundaries
//      suppressed independently gives GEOMETRIC block lengths, and the pooled
//      histogram in v2-pietra/an/out/blocchi.txt is geometric: 17% of blocks
//      wider than one cell and 3.1% wider than two, against the 17% and 2.9%
//      one rate predicts. The old uniform pick over three lengths does not
//      produce that tail, and the tail is measured.
//
// AND THE COURSES ARE NOT LINES. The same file measures a course wandering 30 mm
// across a face and the course-to-course spacing scattering by 44 mm, and those
// are ONE fact and not two: if a course line strays by s at a point, the gap
// between two of them there strays by s*sqrt(2). So there is one amplitude, and
// tools/monoliths/spec.mjs checks that it lands on both readings at once.

const DEG = Math.PI / 180;

/** Height of one course, in metres. */
export const COURSE = 0.22;

/** The three lengths a block is cut to, in metres. */
export const LENGTHS = [0.22, 0.44, 0.66];

// The chamfer, in metres, and it is REAL GEOMETRY and not a painted edge.
//
// At the distance the reference is drawn from a baked highlight would do; at
// the distance a walker stands from a block it would not, and the whole
// argument about the near ground is that geometry reads BETTER than a bake
// there rather than worse. Three centimetres is what a dressed edge on a block
// this size actually takes.
export const CHAMFER = 0.028;

/** How many metres of wall one repeat of the stone tile covers. */
export const STONE_METRES = 1.6;

// How often the boundary between two cells is a real block edge.
//
// One over the mean length of a block in cells, so a half is a mean block of
// two cells — 0.44 m, which is exactly the mean the old walk over the three
// lengths above cut. That is why it is the default and not a taste: it holds
// the block census of the six inside the band the chapter declares while the
// LAW under it changes from a walk to a lattice. The rate this wall actually
// shows is a measurement and travels in spec.masonry.runCut.
export const RUN_CUT = 0.5;

// How far the width of one cell may stray, in fractions of a cell, and how far
// a course line strays from level, in metres. Both nought by default: a wall
// nobody has measured is a ruled one, and every number that makes it stop being
// ruled comes out of a target through the spec.
export const CELL_JITTER = 0;
export const WANDER = 0;

/** How far along a wall the wander is resampled, in metres. */
export const WANDER_SPAN = 1.2;

// THE BLOCK AS A VOLUME, AND WHY EVERY NUMBER BELOW IS SMALL.
//
// The committente's reading of the six was that they "sono composti da linee
// orizzontali e verticali ordinate che formano cubi per intersezione, e cio'
// non sembra che siano cubi reali". That is an exact description of what this
// file used to cut: one rectangle a course, with the block drawn into it by the
// fragment as a darker line where two cells meet. It satisfies every
// measurement spec.mjs takes -- the course is right, the block is right, the
// joint is the right six per cent over the right two pixels -- and it is still
// a picture of masonry rather than masonry, because the thing that makes a wall
// read as laid is not where the lines fall. It is that a block STANDS OUT of
// the wall or sinks into it, that the gap between two of them is a VOID with
// its own shadow, and that some of them are simply GONE.
//
// So a block is a SLAB now: five faces standing off the joint's own floor, with
// its own top, its own soffit and its own two reveals. Nothing is painted.
//
// AND THE NUMBERS ARE SMALL BECAUSE THE TARGET'S ARE. This is the trap a first
// reading of the complaint walks into: at the framing the targets were drawn
// at, 0.19 m of block is seven to thirteen pixels, so relief a walker reads as
// unmistakable volume is ONE OR TWO PIXELS there. Measured through
// tools/monoliths/relief.mjs the day target reads its blocks' own top faces a
// median 0.3 to 0.7 L* ABOVE the faces under them -- the sign is the whole
// finding, and the magnitude is a pixel and a half of lid. A wall built to make
// that reading large would be a wall of steps a metre deep seen from the hub.
//
// STAND     0.045: one step of a block's stand-out, which at the pose the six
//           are judged from is 2.4 px on 01 and at a walker's distance from the
//           06 is eight. Two steps is as far as any block goes.
// GAP       0.022: the void ACROSS, between two blocks. The spec reads the
//           joint at 2 to 3 px on faces running 42 to 67 px per metre, which is
//           3 to 5 cm of joint INCLUDING the shadow it throws; the void itself
//           is the smaller half of that.
// SINK      0.030: how deep the void goes before it reaches the wall behind.
//           Deeper than this and a joint seen at a graze becomes a slot.
// HOLE      0.19: one block. A gone block has to show the COURSE BEHIND IT and
//           not a dent, which is what "veri e propri buchi" means.
export const STAND = 0.036;
export const GAP = 0.022;

// AND THE COURSE JOINT IS HALF THE WIDTH OF THE UPRIGHT ONE, which is a
// measurement and not a taste: the targets' strongest lattice signal is the
// COURSE (autocorrelation 0.48 at 12 px on 05-right, against no peak at all on
// the render before the tile came down), and what carries it is a tight dark
// line and not a slot. It is also what lets a block's own top edge be seen: the
// wider the gap over a block, the more of the wall behind it stands in the band
// the eye reads its lid in, and the wall behind is the darkest thing on the
// face. At 0.022 the lid of a shadowed front read 0.0 L* over its own face
// where the target reads 0.5.
export const GAP_UP = 0.012;
export const SINK = 0.030;
export const HOLE = 0.19;

// HOW MANY BLOCKS DO WHAT, as shares of the blocks of one wall.
//
// These are the UNDERLYING shares and not what a picture of the six reads back:
// at twenty to thirty metres a 4.5 cm step is under half the width of the joint
// beside it, so the estimator that judges a render recovers a fraction of them.
// The two are kept apart on purpose. What is fitted here is the wall a walker
// stands in front of; what is GATED, in tools/guards/guard-pietra.mjs, is what
// the estimator reads at the pose the target was drawn at, against what the
// same estimator reads on the target.
//
// PROUD_DEEP is two steps out, PROUD one, BACK one in. Nothing sinks two: a
// block set back further than the joint is deep stops reading as a block set
// back and starts reading as a hole that is not one.
export const PROUD_DEEP = 0.01;
export const PROUD = 0.032;
export const BACK = 0.075;

// HOW OFTEN A BLOCK IS GONE, and where the gone ones stand.
//
// The target has few and they are not scattered: spec.missingBlock found one by
// its own detector, on the WEST FLANK of 01, and the census in `relief` finds
// the rest of them on the flanks and within a course or two of a vertical edge.
// The committente said the same thing in words -- "lungo i fianchi e gli
// spigoli ci sono BUCHI". So the rate is small and it is WEIGHTED: twice as
// likely within a course of an upright edge, and again toward the crest, where
// a wall weathers from the top down.
//
// AND NEVER UNDER THE WRITING. The engraved panel is the one place on these six
// where a hole would not read as age: it would read as a missing letter. Holes
// are refused on the engraved face except in its outer two cells.
export const GONE = 0.020;
export const GONE_EDGE = 2.0;
export const GONE_CREST = 1.8;

// THE CREST, WHICH IS THE ONLY PLACE A BLOCK MAY STAND A WHOLE COURSE PROUD.
//
// Every head in this world already steps: spec.head cuts it into runs that drop
// by up to six courses, and that is measured. What it does NOT do is crenellate
// -- the top course of a run is a straight line of blocks, and the target's is
// not. On the west flank of 01 three columns of eight stand fifteen courses
// below the highest, and the skyline between them is block by block.
//
// A raised block stands one course ABOVE the head and reads as a merlon
// against the sky; a dropped one stands one course below it and reads as the
// gap between two. A crest block is never GONE, and that is a decision and not
// an oversight: the head's own cap is a rectangle over the whole run, so a hole
// in the top course would show the cap two centimetres behind it rather than
// the notch it is meant to be. From a walker's eye, five to twelve metres under
// that cap, a dropped block and a missing one draw the same silhouette anyway.
//
// These two only ever touch the TOP COURSE of a run, so nothing a foot can
// stand on moves: src/world/stone.js reads the decks, and a deck is the run's
// own head, which is where it was.
export const CREST_DROP = 0.28;
export const CREST_RAISE = 0.16;

// How high a block's top may stand and still be given a top face, in metres
// above the meadow. Nothing in this world flies: a walker's eye is 1.58 m on
// the ground and 3.0 m on the platform, so no lid above this line is ever seen
// by anybody and cutting one is a triangle spent on nothing.
export const LID_BELOW = 3.5;

// How far a block may be from the camera before its five faces are given up for
// the one rectangle a course this file used to cut.
//
// The near wall is seven times the triangles of the far one, and the swap is
// per BLOCK and not per face, so the draw count does not move -- one mesh a
// block, as it was.
//
// AND 22 IS A BUDGET AND NOT A THRESHOLD OF VISION, which is worth saying
// plainly because the number would be larger if it were only about seeing. At
// the pose the six are judged from they stand, footprint taken off, at 3.3 (06),
// 18.0 (05), 19.3 (01), 20.6 (04), 23.6 (02) and 27.9 m (03). Laid as volumes
// all six submit 88,410 triangles against the 60,000 this chapter is allowed;
// with 02 and 03 collapsed they submit 50,186. Those two are the FURTHEST and
// the narrowest in that frame -- 03's cell reads 6.9 px there and 02's 8.8 --
// and four steps toward either brings it back.
//
// THE CEILING IS MEASURED WITH NOTHING CULLED, which is why it is 22 and not
// 26. At 26 the renderer reports 54,726 at that pose and passes, but only
// because 06 stands behind the camera; walk round until all six are in frame
// and the same wall submits 62,046. A budget that depends on where a walker is
// looking is not a budget.
export const NEAR_METRES = 22;

export function hash(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// THE HASH THE WALL IS LAID ON, AND WHY IT IS NOT THE ONE ABOVE.
//
// The one above is integer arithmetic and there is no integer arithmetic in the
// shader this world compiles: three.js hands a WebGL2 context a GLSL ES 1.00
// program, which has no unsigned type and no shift. So the wall's own hash is
// the one src/world/voxel/material.js already dithers the meadow with — three
// multiplies, a dot and two fracts, all in single precision — and THE SAME
// ARITHMETIC IS DONE HERE, rounded to single precision at every step with
// Math.fround, so this file and the fragment agree bit for bit rather than
// nearly.
//
// It matters in exactly one place and it is worth saying which. The GEOMETRY
// below depends on the hash only through the wander, which is continuous: a
// disagreement of one part in a million moves a course line by a nanometre.
// What depends on a THRESHOLD — where a block ends, which tint it takes — is
// drawn in the fragment and nowhere else, so there is no second answer to
// compare against and nothing to drift.
const f = Math.fround;

function fract(v) {
  return f(v - Math.floor(v));
}

/**
 * Two decorrelated draws from three numbers, in single precision.
 *
 * @param {number} x  a whole number: a course, a cell, a lattice node
 * @param {number} y  another
 * @param {number} z  and the third
 * @returns {number[]} two values in [0, 1)
 */
export function stoneHash(x, y, z) {
  let px = fract(f(x * 0.1031));
  let py = fract(f(y * 0.1030));
  let pz = fract(f(z * 0.0973));
  const d = f(f(px * f(py + 33.33)) + f(f(py * f(pz + 33.33)) + f(pz * f(px + 33.33))));
  px = f(px + d);
  py = f(py + d);
  pz = f(pz + d);
  return [fract(f(f(px + py) * pz)), fract(f(f(py + pz) * px))];
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** One octave of value noise on a lattice that wraps at `cells`. */
function wrapValue(u, v, cells, seed) {
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  const fu = smooth(u - iu);
  const fv = smooth(v - iv);
  const at = (a, b) => hash(((a % cells) + cells) % cells, ((b % cells) + cells) % cells, seed);
  const a = at(iu, iv);
  const b = at(iu + 1, iv);
  const c = at(iu, iv + 1);
  const d = at(iu + 1, iv + 1);
  return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
}

// A handful of hairlines, laid as straight chords across the tile and wrapped,
// because a crack in stone is a straight thing at this scale and one drawn out
// of noise curves and reads as a smear.
const CRACKS = [];
for (let i = 0; i < 9; i++) {
  const a = hash(i, 3, 91) * Math.PI;
  CRACKS.push({
    nx: Math.cos(a),
    ny: Math.sin(a),
    d: hash(i, 7, 17),
    width: 0.0016 + 0.0022 * hash(i, 11, 29),
  });
}

function crackAt(u, v) {
  let most = 0;
  for (const c of CRACKS) {
    // Wrapped: the distance to the nearest COPY of the line, so a crack that
    // leaves one side of the tile comes back in on the other and the wall it
    // is repeated over has no seam to hide.
    let t = u * c.nx + v * c.ny - c.d;
    t -= Math.round(t);
    const bite = Math.max(0, 1 - Math.abs(t) / c.width);
    if (bite > most) most = bite;
  }
  return most * most;
}

/**
 * The stone tile: mottling in red, the same surface as a HEIGHT in green.
 *
 * THE ONE PLACE "EVERY VOXEL HAS A TEXTURE" IS TRUE. On grass and foliage the
 * reference has flat colour with a strong spread of tint and no texture at all;
 * on rock and stone every face carries a real albedo. So the atlas is spent
 * here and nowhere else, which is both the faithful reading and the cheap one.
 *
 * Two channels and not three, for the reason src/world/air.js gives over
 * DETAIL.relief: a height read twice a step apart IS a slope, so the little
 * shade on a chip costs one more fetch of a texture already in hand and not one
 * stored normal.
 *
 * GENERATED, NOT DELIVERED. It costs no manifest entry, no encode and no byte
 * of the first frame — a stronger answer to the weight question than a
 * dev-scoped asset would have been, and one that needs no exclusion to hold.
 */
export function stoneTileData(side = 512) {
  const data = new Uint8Array(side * side * 2);
  // AND EVERY OCTAVE OF IT IS SMALLER THAN A BLOCK, which is a correction and
  // the whole of what made this wall read as camouflage.
  //
  // The tile used to open at 4 cells over its 1.6 m, which is 0.40 m: TWO
  // BLOCKS. Forty-four per cent of the amplitude sat there, so the largest
  // thing on the surface was a patch that walked across the joint between two
  // blocks and joined them into one shape. Measured on the day target and on
  // the render through one estimator (R5 SS1.4): the target's horizontal period
  // on 03 is 7 px = 0.19 m, exactly the block, and the render's is 17 px =
  // 0.46 m -- 2.4 times over, and it is the tile that is being read as the
  // block rather than the lattice. The same reading says the course line
  // DISAPPEARS in the render (no autocorrelation peak where the target has one
  // at 0.48) because a patch that spans two blocks covers the line between
  // their courses.
  //
  // So the octaves now open at 0.10 m -- half a block -- and run down to
  // 0.025 m, which is the grain the reference shows INSIDE a block (C SS1.3:
  // 1.51 px at the framing this world is fitted to). Nothing on this surface is
  // allowed to be as large as the thing the surface is made of.
  //
  // WHAT IT COSTS: nothing. It is the same loop over the same 512 squared, one
  // octave shorter, generated in the worker where it always was. The wall's own
  // modulation of ROW brightness -- the courses, the arris, the pale top -- was
  // already at or above the target's (4.32% against 3.25%), so what this takes
  // away is chatter inside a block and not contrast between courses.
  const octaves = [
    { cells: 16, gain: 0.50 },
    { cells: 32, gain: 0.30 },
    { cells: 64, gain: 0.20 },
  ];
  let weight = 0;
  for (const o of octaves) weight += o.gain;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      let mottle = 0;
      for (let o = 0; o < octaves.length; o++) {
        const { cells, gain } = octaves[o];
        mottle += gain * wrapValue((x / side) * cells, (y / side) * cells, cells, o * 37 + 5);
      }
      mottle /= weight;
      const crack = crackAt(x / side, y / side);
      const level = Math.max(0, Math.min(1, mottle * (1 - 0.55 * crack)));
      const o2 = (y * side + x) * 2;
      data[o2] = Math.round(level * 255);
      // The height is the same surface: on this stone the pale grain stands
      // proud and the crack is the hollow, which is what a photograph of it
      // shows and what makes one field able to answer both questions.
      data[o2 + 1] = Math.round(level * 255);
    }
  }
  return data;
}

// ------------------------------------------------------------------ the law
//
// Four functions, and the fragment carries the same four. They are exported so
// that a guard, a counter or a contract can ask the wall where its blocks are
// without a second implementation of the answer.

/**
 * How far the line of course `c` strays from level at a point of the plan.
 *
 * A value noise over the block's own x and z, so the two walls that meet at a
 * corner are handed the SAME number there and a course cannot step as it turns
 * the corner. One amplitude carries both readings the targets give: the 30 mm a
 * course wanders across a face is this field's own spread, and the 44 mm the
 * spacing between two courses scatters is that spread times root two, because
 * the two lines stray independently.
 */
export function wanderAt(course, x, z, amplitude, span) {
  if (!amplitude) return 0;
  const u = x / span;
  const v = z / span;
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  // BILINEAR AND NOT SMOOTHED, and that is the one place this field is not
  // free to be pretty. The mesh follows this line as a polyline with a vertex
  // at every node of the lattice, so between two nodes the GEOMETRY is a chord;
  // a smoothed field would put the fragment's idea of where a course line is up
  // to a centimetre off the edge the geometry was actually cut at. Linear here
  // means the two are the same line exactly, along any wall that runs on one
  // axis — which is every wall there is.
  const fu = u - iu;
  const fv = v - iv;
  const at = (a, b) => stoneHash(a, b, course * 7 + 3)[0];
  const a = at(iu, iv);
  const b = at(iu + 1, iv);
  const c = at(iu, iv + 1);
  const d = at(iu + 1, iv + 1);
  const value = (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  return amplitude * (value - 0.5);
}

/** Where the line of course `c` stands at a point of the plan, in metres up. */
export function courseY(course, x, z, law) {
  if (course <= 0) return 0;
  return course * law.rise + wanderAt(course, x, z, law.wander, law.wanderSpan);
}

/** The stagger of course `c`: how far its lattice of cells is shifted along. */
export function cellPhase(course, law) {
  return stoneHash(course, 17, 5)[1] * law.cell;
}

/**
 * Where the boundary between cell `i-1` and cell `i` stands along a wall.
 *
 * The jitter is half a cell at most, so the boundaries stay in order however
 * they are drawn and a point can find its own cell by rounding and then looking
 * at the two neighbours.
 */
export function cellEdge(course, i, law) {
  const jitter = law.jitter * law.cell;
  return i * law.cell + cellPhase(course, law)
    + jitter * (stoneHash(course, i, 29)[0] - 0.5);
}

/** Whether the boundary between cell `i-1` and cell `i` is a block edge. */
export function isCut(course, i, law) {
  return stoneHash(course, i, 41)[1] < law.runCut;
}

/**
 * The blocks of one course of one wall, as the fragment finds them.
 *
 * IT IS THE FRAGMENT'S OWN WALK, WRITTEN FORWARDS. src/world/voxel/masonry.js
 * takes a point, rounds it to a cell, and then walks OUT to the nearest cut on
 * either side to find which block it is standing on. This walks the same cuts
 * from one end of the wall to the other and hands back every block once, with
 * the lattice index the fragment would have recovered for it. The two have to
 * agree or a block would be cut as a volume at one place and tinted as a block
 * at another.
 *
 * @returns {{u0: number, u1: number, first: number, cells: number}[]} in metres
 *          along the wall, with the index the block's own hash is drawn at
 */
export function blocksOf(course, span, law) {
  const phase = cellPhase(course, law);
  const from = Math.floor(-phase / law.cell) - 1;
  const to = Math.ceil((span - phase) / law.cell) + 1;
  const inside = [];
  for (let i = from; i <= to; i++) {
    const u = cellEdge(course, i, law);
    if (u > 1e-6 && u < span - 1e-6) inside.push({ u, i });
  }
  const out = [];
  let u0 = 0;
  let first = inside.length ? inside[0].i - 1 : from;
  let cells = 1;
  for (const node of inside) {
    if (isCut(course, node.i, law)) {
      out.push({ u0, u1: node.u, first, cells });
      u0 = node.u;
      first = node.i;
      cells = 1;
    } else cells += 1;
  }
  out.push({ u0, u1: span, first, cells });
  return out.filter((b) => b.u1 - b.u0 > 1e-6);
}

/**
 * What one block does: how far it stands out of its wall, and whether it is there.
 *
 * DETERMINISTIC AND PURE, off the same hash everything else on this stone is
 * drawn from, so the generator, the guard and anything that has to ask about a
 * block later all get the one answer. `wall` is a small integer per face, so
 * the west flank of a block and its front do not lay the same wall twice.
 *
 * @param {number} wall   which of the four faces, 0..3
 * @param {number} course the course, off the ground
 * @param {number} first  the lattice index the block begins at
 * @param {object} law    the wall's law, with the relief shares on it
 * @param {object} where  how near this block stands to an upright edge and to
 *                        the crest, and whether its face carries the writing
 * @returns {{out: number, gone: boolean, raise: number}} out in STEPS, not metres
 */
export function blockRelief(wall, course, first, law, where = {}) {
  if (!law.stand) return { out: 0, gone: false, raise: 0 };
  const draw = stoneHash(course * 4 + wall, first, 71);
  let out = 0;
  if (draw[0] < law.proudDeep) out = 2;
  else if (draw[0] < law.proudDeep + law.proud) out = 1;
  else if (draw[0] > 1 - law.back) out = -1;

  // The crest is its own law: on the top course of a run a block stands a whole
  // course above its neighbours or a whole course below them, which is what
  // makes a skyline out of a straight line.
  if (where.crest) {
    const crestDraw = stoneHash(course * 4 + wall, first, 83);
    if (crestDraw[0] < law.crestDrop) return { out, gone: false, raise: -1 };
    if (crestDraw[1] < law.crestRaise) return { out, gone: false, raise: 1 };
    return { out, gone: false, raise: 0 };
  }

  // Everywhere else a hole is rare, and likelier at an edge and near the top.
  // The engraved panel keeps its letters: only its outer two cells may open.
  const edge = Math.max(0, where.fromEdge ?? 9);
  const high = Math.min(1, Math.max(0, where.upFrac ?? 0));
  const weight = (1 + (law.goneEdge - 1) * Math.exp(-edge))
    * (1 + (law.goneCrest - 1) * high * high);
  const allowed = !where.engraved || edge < 2;
  return { out, gone: allowed && draw[1] < law.gone * weight, raise: 0 };
}

/**
 * The law of a wall, with every default in one place.
 *
 * @param {object} spec an entry of src/world/layout.js, optionally with a
 *                      `masonry` block of measured numbers on it
 */
export function masonryLaw(spec) {
  const m = spec.masonry || {};
  const height = spec.size[1];
  const rise = m.rise ?? COURSE;
  return {
    rise,
    courses: Math.max(1, m.courses ?? Math.round(height / rise)),
    cell: m.cell ?? LENGTHS[0],
    runCut: m.runCut ?? RUN_CUT,
    jitter: m.jitter ?? CELL_JITTER,
    wander: m.wander ?? WANDER,
    wanderSpan: m.wanderSpan ?? WANDER_SPAN,
    chamfer: m.chamfer ?? CHAMFER,
    tile: m.tile ?? STONE_METRES,
    head: m.head ?? null,
    recesses: m.recesses ?? [],

    // THE RELIEF IS OPT-IN AND THE DEFAULT IS NOUGHT, which is the same rule
    // the wander and the jitter above are written under: a wall nobody has
    // asked for volume on is the flat one this file has always cut. The six
    // blocks ask for it through src/world/stone.js; the STAIR and the PLATFORM
    // deliberately do not, because their courses are treads a foot lands on and
    // src/world/contracts.js answers for them off a deck this must not move.
    stand: m.stand ?? 0,
    gap: m.gap ?? GAP,
    gapUp: m.gapUp ?? GAP_UP,
    sink: m.sink ?? SINK,
    hole: m.hole ?? HOLE,
    proud: m.proud ?? PROUD,
    proudDeep: m.proudDeep ?? PROUD_DEEP,
    back: m.back ?? BACK,
    gone: m.gone ?? GONE,
    goneEdge: m.goneEdge ?? GONE_EDGE,
    goneCrest: m.goneCrest ?? GONE_CREST,
    crestDrop: m.crestDrop ?? CREST_DROP,
    crestRaise: m.crestRaise ?? CREST_RAISE,
    lidBelow: m.lidBelow ?? LID_BELOW,
  };
}

/**
 * The head of a block, as runs along its own width with a course count each.
 *
 * One run covering everything when the spec says nothing, which is the flat lid
 * this file has always cut.
 */
function headRuns(law, width) {
  const runs = law.head && law.head.length ? law.head : [{ from: 0, to: 1, courses: law.courses }];
  const out = [];
  let at = -width / 2;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const x1 = i === runs.length - 1 ? width / 2 : -width / 2 + run.to * width;
    out.push({
      x0: at,
      x1,
      courses: Math.max(1, Math.round(run.courses)),
      drop: run.drop || 0,
    });
    at = x1;
  }
  return out;
}


/**
 * The skin of one block, course by course, as flat arrays.
 *
 * Skin and not solid: nothing inside a wall is ever seen, and a generator that
 * filled it would pay for a hundred times the blocks to draw the same picture.
 *
 * MERGED, AND THE MERGE IS THE BUDGET. Every face of one course of one wall is
 * coplanar with the face beside it, so the run of them is ONE rectangle: what
 * is submitted for a wall is a couple of quads a course rather than two a
 * block. A run is broken where the wall is broken — the head stepping down, a
 * recess, the wall's own end — and along it by the wander, because a course
 * that strays is a polyline and a polyline is not one rectangle. That last is
 * the only place the merge is paid for, and what it buys is that the courses of
 * this wall are not ruled lines.
 *
 * NOTHING PER BLOCK LEAVES HERE. Positions, normals and indices, and no fourth
 * buffer: where a fragment stands inside its own block, which block that is and
 * how the tile lies on the wall are all rebuilt in the fragment out of the
 * fragment's own position. That is what a merged rectangle costs and what it is
 * worth.
 *
 * @param {object} spec an entry of src/world/layout.js, with an optional
 *                      `masonry` block of measured numbers on it
 */
export function buildMasonry(spec, { lod = 'near' } = {}) {
  const [width, , depth] = spec.size;
  const law = masonryLaw(spec);
  // WHICH OF THE TWO WALLS THIS IS. A wall with no relief declared has only
  // ever had one, and asking for 'far' on a wall that stands close by is how
  // the LOD is served without a second generator.
  const solid = lod !== 'far' && law.stand > 0;
  const { rise, chamfer } = law;
  const runs = headRuns(law, width);
  const courses = Math.max(...runs.map((r) => r.courses));
  const height = courses * rise;

  const positions = [];
  const normals = [];
  const indices = [];
  let quads = 0;
  let fused = 0;   // how many cell faces the merged rectangles stood for
  let laid = 0;    // how many blocks were cut as volumes of their own
  let opened = 0;  // and how many of those are sockets rather than stone

  const quad = (n, corners) => {
    const base = positions.length / 3;
    for (let i = 0; i < 4; i++) {
      positions.push(corners[i][0], corners[i][1], corners[i][2]);
      normals.push(n[0], n[1], n[2]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    quads++;
  };

  // The four walls of the skin, each with the way its own coordinate runs, so
  // that the outward normal falls out of the winding instead of being fixed up
  // afterwards: a wall is walked from (x0, z0) along (dx, dz), and that step
  // crossed with up IS the outward normal.
  const skin = [
    { key: 'front', n: [0, 0, 1], x0: -width / 2, z0: depth / 2, dx: 1, dz: 0, span: width },
    { key: 'back', n: [0, 0, -1], x0: width / 2, z0: -depth / 2, dx: -1, dz: 0, span: width },
    { key: 'right', n: [1, 0, 0], x0: width / 2, z0: depth / 2, dx: 0, dz: -1, span: depth },
    { key: 'left', n: [-1, 0, 0], x0: -width / 2, z0: -depth / 2, dx: 0, dz: 1, span: depth },
  ];

  /** The head run standing over a point of the width. */
  const runAt = (x) => {
    for (const run of runs) if (x <= run.x1 + 1e-9) return run;
    return runs[runs.length - 1];
  };

  /** Where the head of a run stands over a point of the plan, in metres up. */
  const headY = (run, x, z) => courseY(run.courses, x, z, law) - run.drop;

  /**
   * Where the cell boundaries of one course fall along a wall, in metres.
   *
   * The stagger is a PHASE of the lattice, which is what makes this masonry
   * rather than a grid: a course starts part of a cell along from the one under
   * it, so no vertical joint runs up more than a course or two. It is the same
   * phase the fragment applies, so the joint the fragment draws lands on the
   * boundary the geometry was broken at.
   */
  const edgesOf = (course, span) => {
    const phase = cellPhase(course, law);
    const first = Math.floor(-phase / law.cell) - 1;
    const last = Math.ceil((span - phase) / law.cell) + 1;
    const out = [0];
    for (let i = first; i <= last; i++) {
      const u = cellEdge(course, i, law);
      if (u > 1e-6 && u < span - 1e-6) out.push(u);
    }
    out.push(span);
    return out;
  };

  /**
   * One wall, course by course: merged along each course, split only where a
   * cell is missing or the wander asks for a new node.
   *
   * @param {object}   wall   one of the four above, or a step face of the head
   * @param {Function} topFor the head run standing at a distance u along it
   * @param {number}   from   the lowest course this wall carries
   * @param {object[]} holes  the stretches {course, u0, u1} it does not carry
   */
  const buildWall = (wall, topFor, from = 0, holes = []) => {
    const at = (u) => [wall.x0 + wall.dx * u, wall.z0 + wall.dz * u];
    let top = 0;
    for (let u = 0; u <= wall.span + 1e-9; u += Math.min(law.cell, wall.span) / 2) {
      top = Math.max(top, topFor(u).courses);
    }
    for (let c = from; c < top; c++) {
      const edges = edgesOf(c, wall.span);
      const merges = [];
      let open = null;
      for (let k = 0; k + 1 < edges.length; k++) {
        const u0 = edges[k];
        const u1 = edges[k + 1];
        if (u1 - u0 < 1e-6) continue;
        const mid = (u0 + u1) / 2;
        const stands = c < topFor(mid).courses
          && !holes.some((h) => h.course === c && mid > h.u0 && mid < h.u1);
        // GREEDY: a present cell joins the run beside it, and only what is
        // actually absent breaks one.
        if (!stands) { if (open) merges.push(open); open = null; continue; }
        if (open) { open[1] = u1; open[2] += 1; } else open = [u0, u1, 1];
      }
      if (open) merges.push(open);

      for (const run of merges) {
        fused += run[2];
        // WHICH HEAD THIS RUN STANDS UNDER, asked ONCE and at the MIDDLE of the
        // run. Asked at the ends instead it is asked exactly on a cell boundary,
        // where a head that steps down answers with the run on the other side —
        // and the top course of the wall came out as a wedge sloping from one
        // level to the next, which is what it looked like.
        const cap = topFor((run[0] + run[1]) / 2);
        // Split along the run wherever the wander is resampled, because a
        // course line that strays is a polyline. With no wander declared this
        // is one segment and the whole course is one rectangle.
        const nodes = [run[0]];
        if (law.wander) {
          // At the NODES OF THE FIELD and not at a spacing of its own: between
          // two nodes the field is linear, so a segment that starts and ends on
          // nodes is the field exactly and one that does not never is.
          const s = law.wanderSpan;
          const c0 = wall.dx ? wall.x0 + wall.dx * run[0] : wall.z0 + wall.dz * run[0];
          const c1 = wall.dx ? wall.x0 + wall.dx * run[1] : wall.z0 + wall.dz * run[1];
          for (let k = Math.ceil(Math.min(c0, c1) / s); k * s < Math.max(c0, c1); k++) {
            const u = wall.dx ? (k * s - wall.x0) * wall.dx : (k * s - wall.z0) * wall.dz;
            if (u > run[0] + 1e-6 && u < run[1] - 1e-6) nodes.push(u);
          }
          nodes.sort((a, b) => a - b);
        }
        nodes.push(run[1]);
        for (let k = 0; k + 1 < nodes.length; k++) {
          const [ax, az] = at(nodes[k]);
          const [bx, bz] = at(nodes[k + 1]);
          const y0a = courseY(c, ax, az, law);
          const y0b = courseY(c, bx, bz, law);
          const y1a = Math.min(courseY(c + 1, ax, az, law), headY(cap, ax, az));
          const y1b = Math.min(courseY(c + 1, bx, bz, law), headY(cap, bx, bz));
          quad(wall.n, [
            [ax, y0a, az], [bx, y0b, bz], [bx, y1b - chamfer, bz], [ax, y1a - chamfer, az],
          ]);
          // The dressed edge over it, lit as the facet it is, which is where
          // the reference's bright arris comes from with nothing fitted to make
          // its brightness and its blue agree.
          //
          // AND IT ONLY LEANS BACK WHERE THERE IS SOMETHING TO LEAN BACK TO,
          // which is a correction and the cause of a defect that reached a
          // judgement. It used to set its top edge a chamfer INSIDE the wall on
          // every course. Under the head that is right: the cap is inset by the
          // same chamfer and the two meet along one line. Anywhere else it is a
          // HOLE. The course above restarts at the wall plane, so at every
          // course line the skin steps out by 28 mm with nothing closing it,
          // and a skin is all there is — the inside of a block is never built,
          // by this file's own design. A line of sight rising at slope s enters
          // that step and passes over the facet's top edge for the last
          // 28*s mm of it, misses the course above, and leaves through the far
          // wall, which is back-facing and culled. What it draws there is the
          // SKY.
          //
          // That is the bright dashed line along every course of every face:
          // not the arris, not its pigment, not the law of the light, but the
          // background seen through the wall. It is brightest exactly where it
          // was reported worst — on the fronts standing in shadow, where dark
          // stone frames it, and higher up a tall block, where the eye looks up
          // more steeply and s is larger — and it cuts through the engraved
          // glyphs because the writing is painted on stone that is not there.
          // Measured: with the chamfer taken out altogether the same face reads
          // 0.95% of course-line contrast against 2.76% with it, where the day
          // target reads 1.76%; and with the facet's own material driven to
          // black it stays at 2.77%, which is how the facet was ruled out as
          // the cause.
          //
          // THE SKIN IS CLOSED WITHOUT ONE NEW TRIANGLE. The alternative was a
          // soffit under each overhang, which is +2,594 quads and +5,188
          // triangles, +50% on the masonry and a quarter of the whole budget
          // for a step nobody can see at 28 mm. Instead the band stays where
          // the wall is and keeps the NORMAL of the facet it stands for: under
          // an analytic light a face's shading is its normal and nothing else,
          // so the arris is lit exactly as before and foreshortens exactly as
          // before, because it is still held in metres of stone. What is given
          // up is 28 mm of true relief between courses, which is a silhouette
          // and a parallax at grazing range, and it is given up on purpose and
          // written down. It is the same device this world already uses for the
          // vertical arris at a block's end, for the same reason.
          const under = c + 1 >= cap.courses;
          const inx = under ? wall.n[0] * chamfer : 0;
          const inz = under ? wall.n[2] * chamfer : 0;
          quad([wall.n[0] * 0.7071, 0.7071, wall.n[2] * 0.7071], [
            [ax, y1a - chamfer, az], [bx, y1b - chamfer, bz],
            [bx - inx, y1b, bz - inz], [ax - inx, y1a, az - inz],
          ]);
        }
      }
    }
  };

  /**
   * One wall, block by block, as SLABS instead of a rectangle.
   *
   * WHAT A BLOCK IS HERE. A box, standing out of its wall by its own law: a
   * front face, its own top, its own soffit and its own two reveals, with the
   * void of the joint cut out of all four sides. Nothing on it is painted --
   * there is no joint uniform reaching this geometry -- so the line between two
   * blocks is the shadow one of them throws on the other, which is what the
   * committente could not find on the six.
   *
   * WHY THE BOX IS DEEP AND ITS DEPTH IS NEVER SEEN. Each box runs back DEEP
   * metres from its own front, which is more than any two neighbours can differ
   * by. So a block's top is only VISIBLE as far as the step to the block above
   * it -- the rest of it is inside that block -- and the depth of a joint is
   * never a number anyone has to fit: it comes out of the two blocks beside it.
   * The alternative, a floor at a fixed depth behind every block, makes every
   * flush block sit on a shelf of that depth, which is a raked joint and not a
   * laid wall.
   *
   * @param {object}   wall   one of the four of the skin
   * @param {number}   index  which of the four, so two faces do not lay alike
   * @param {Function} topFor the head run standing at a distance u along it
   * @param {number}   from   the lowest course this wall carries
   * @param {object[]} holes  the stretches {course, u0, u1} it does not carry
   */
  const buildBlockWall = (wall, index, topFor, from = 0, holes = []) => {
    const { gap } = law;
    const baseY = spec.baseY || 0;
    // WHERE EVERY BOX ENDS, and why they all end in the same place.
    //
    // Behind the proudest block by two steps and the sink, so the deepest block
    // still has stone behind it and the shallowest joint is still a joint. It
    // is COMMON to every box on the wall on purpose: with one plane behind them
    // all, the strip of wall between two blocks can be closed by ONE rectangle
    // a course instead of a rectangle a block.
    //
    // AND WITHOUT THAT RECTANGLE THE WALL LEAKS SKY, which is not a theory --
    // it is what the first cut of this did. A skin is all there is; the inside
    // of a block is never built. Two boxes 2.2 cm apart with nothing behind
    // them are a 2.2 cm window through the monolith, and a line of sight that
    // enters one goes out the far wall, which is back-facing and culled, and
    // draws the SKY. Every course of every face came back with a bright line on
    // it. It is the same defect the chamfer had, found the same way.
    const floor = -(2 * law.stand + law.sink);

    // A point of this wall in the block's own frame: `u` along it, `off` metres
    // out of its plane, `y` up.
    const at = (u, off, y) => [
      wall.x0 + wall.dx * u + wall.n[0] * off,
      y,
      wall.z0 + wall.dz * u + wall.n[2] * off,
    ];

    // THE THREE FACES OF A BOX THAT ARE NOT ITS FRONT, wound off the wall's own
    // basis. The wall is walked along (dx, dz) and that step crossed with up is
    // the outward normal, so (along, up, out) is right handed and every winding
    // below falls out of it instead of being guessed and fixed up.
    //
    // upright: one of the two reveals, at a fixed u, standing between two
    //          depths. `side` is +1 for the reveal facing along the wall.
    const upright = (u, off0, off1, y0, y1, side) => {
      const n = [wall.dx * side, 0, wall.dz * side];
      const corners = side > 0
        ? [at(u, off0, y0), at(u, off0, y1), at(u, off1, y1), at(u, off1, y0)]
        : [at(u, off0, y0), at(u, off1, y0), at(u, off1, y1), at(u, off0, y1)];
      quad(n, corners);
    };
    // flat: the top of a box or its soffit, between two depths. `up` is +1 for
    //       a face looking at the sky.
    const flat = (u0, u1, yA, yB, off0, off1, up) => {
      const n = [0, up, 0];
      const corners = up > 0
        ? [at(u0, off0, yA), at(u0, off1, yA), at(u1, off1, yB), at(u1, off0, yB)]
        : [at(u0, off0, yA), at(u1, off0, yB), at(u1, off1, yB), at(u0, off1, yA)];
      quad(n, corners);
    };
    // face: the block's own front, or the floor of the socket a gone one leaves.
    const face = (off, u0, u1, yA0, yB0, yA1, yB1) => {
      quad(wall.n, [at(u0, off, yA0), at(u1, off, yB0), at(u1, off, yB1), at(u0, off, yA1)]);
    };

    const engraved = wall.key === 'front';
    let top = 0;
    for (let u = 0; u <= wall.span + 1e-9; u += Math.min(law.cell, wall.span) / 2) {
      top = Math.max(top, topFor(u).courses);
    }

    for (let c = from; c < top; c++) {
      // The stretches of this course that carry stone, merged as they are laid,
      // so the wall behind the blocks is one rectangle a run and not one a
      // block. A socket breaks a run, because what is behind a socket is a
      // block further back and not this wall.
      const behind = [];
      let open = null;
      const close = () => { if (open) behind.push(open); open = null; };
      for (const b of blocksOf(c, wall.span, law)) {
        const mid = (b.u0 + b.u1) / 2;
        const cap = topFor(mid);
        if (c >= cap.courses) { close(); continue; }
        if (holes.some((h) => h.course === c && mid > h.u0 && mid < h.u1)) { close(); continue; }

        const r = blockRelief(index, c, b.first, law, {
          crest: c === cap.courses - 1,
          fromEdge: Math.min(b.u0, wall.span - b.u1) / law.cell,
          upFrac: c / Math.max(1, cap.courses),
          engraved,
        });

        // The block's own four bounds, with half a joint taken off each side.
        // That half is the whole of the void: two neighbours give a joint of
        // one `gap`, and the outermost block of a wall gives up half of one to
        // the corner, which is where a quoin's own shadow comes from.
        const u0 = b.u0 + gap / 2;
        const u1 = b.u1 - gap / 2;
        if (u1 - u0 < 1e-4) { close(); continue; }
        // THE COURSE LINE IS ASKED ONCE, AT THE MIDDLE OF THE BLOCK, and that is
        // what makes a block a BOX. Asked at both ends it answers two different
        // heights -- the course strays by up to 84 mm across this wall -- and a
        // rectangle whose two ends sit at different heights is not planar. Cut
        // as two triangles under ONE normal it draws a crease down its own
        // diagonal, and every face of every block on the six had one.
        //
        // What it costs is that a course line is now a staircase of blocks
        // rather than a polyline, which is what a course of laid stone is: the
        // wander survives BETWEEN blocks, where the eye reads it, and stops
        // inside one, where it was only ever a defect.
        const [mx, , mz] = at((u0 + u1) / 2, 0, 0);
        const up = law.gapUp;
        const raise = r.raise * rise;
        const base = courseY(c, mx, mz, law);
        const top = Math.min(courseY(c + 1, mx, mz, law), headY(cap, mx, mz)) + raise;
        const yA0 = base + up / 2;
        const yB0 = yA0;
        const yA1 = top - up / 2;
        const yB1 = yA1;
        if (yA1 - yA0 < 1e-4) { close(); continue; }

        laid += 1;
        if (r.gone) {
          opened += 1;
          close();
          // The socket a gone block leaves: a floor ONE BLOCK back, so what
          // shows through it is the course behind this one rather than a dent
          // in it, and four walls carrying on from where the neighbours'
          // reveals stop. Their normals point INTO the socket, because that is
          // the side of them anybody is ever going to see.
          // AT THE FULL CELL AND NOT AT THE BLOCK'S OWN BOUNDS, which is the
          // difference between a socket and a window. The wall behind stops at
          // the cell edge on either side of a gone block, so a socket cut half
          // a joint inside that leaves an 11 mm slit at each corner with
          // nothing behind it -- and a slit with nothing behind it draws the
          // SKY, because the far wall of a block is back-facing and culled.
          // Four of the holes on 04 came back with daylight in them.
          // Grown 2 mm all round, so that the socket's own walls end INSIDE the
          // blocks beside it rather than exactly on the seam with them. A seam
          // between two surfaces that meet exactly is a line of depth-buffer
          // argument, and on a socket the losing side of that argument is a
          // pixel of sky.
          const w0 = b.u0 - 0.002;
          const w1 = b.u1 + 0.002;
          const s0 = base - 0.002;
          const s1 = Math.min(courseY(c + 1, mx, mz, law), headY(cap, mx, mz)) + 0.002;
          // THE FOUR WALLS RUN FROM THE FLOOR OUTWARD and not from the wall in,
          // which is not a matter of taste: every winding in this generator is
          // taken off (along, up, out) with out POSITIVE, so a face handed its
          // two depths the other way round comes out back-facing, and a
          // back-facing face inside a skin is a hole with the SKY in it. That is
          // exactly what the first cut of the sockets drew -- daylight in every
          // one of them, on a block 2 m thick.
          face(-law.hole, w0, w1, s0, s0, s1, s1);
          // And they run PAST the wall's plane, not up to it. Ending them at the
          // floor of the joint leaves the socket closed only as far as that
          // floor, and a line of sight steep enough to pass over the top of it
          // goes on into the inside of the block and leaves through the far
          // wall, which is culled: a pixel of sky along the lintel of every
          // socket. Run out to the proudest a block can stand they end INSIDE
          // the blocks around them, where nothing can see them.
          const lip = 2 * law.stand;
          upright(w0, -law.hole, lip, s0, s1, 1);
          upright(w1, -law.hole, lip, s0, s1, -1);
          flat(w0, w1, s1, s1, -law.hole, lip, -1);
          flat(w0, w1, s0, s0, -law.hole, lip, 1);
          continue;
        }

        // THE WALL BEHIND REACHES THE FULL COURSE and not just the tops of the
        // blocks on it. A block's own top stops half a course joint short of
        // the course line; if the wall behind stopped there too, the 6 mm
        // between them would be open to the inside of the block, and anybody
        // looking into the socket next door saw daylight through that band.
        if (open) open[1] = b.u1; else open = [b.u0, b.u1, base, top];
        open[3] = Math.max(open[3], top);
        const front = r.out * law.stand;
        const back = floor;
        face(front, u0, u1, yA0, yB0, yA1, yB1);
        // THE SOFFIT ALWAYS AND THE LID ALMOST NEVER, which is the one place
        // this generator spends a triangle on where the eye is rather than on
        // what the stone is, and it is worth saying why it is allowed to.
        // Nothing in this world flies: an eye stands at 1.58 m on the meadow
        // and at 3.0 m on the platform, and these six run from 4.8 m to 13.1 m.
        // Every block above that line shows a walker its SOFFIT for as long as
        // the world exists and can never show a lid to anybody. The rule is a
        // height and not a guess -- `lidBelow`, carried on the law -- and it
        // comes off the 96,546 triangles the six cost with lids everywhere.
        // The crest keeps its lid: a merlon seen against the sky is the one
        // block whose top edge is a silhouette rather than a surface.
        if (r.raise > 0 || yA1 + baseY < law.lidBelow) flat(u0, u1, yA1, yB1, back, front, 1);
        flat(u0, u1, yA0, yB0, back, front, -1);
        upright(u0, back, front, yA0, yA1, -1);
        upright(u1, back, front, yB0, yB1, 1);
      }
      close();
      // And the wall behind them, one rectangle a run. It reaches from the
      // bottom of the course to the top of the tallest block on the run, so a
      // raised crest block never opens a window over its neighbours' heads.
      for (const run of behind) {
        const [rx0] = at(run[0], floor, 0);
        const [, , rz0] = at(run[0], floor, 0);
        const [rx1, , rz1] = at(run[1], floor, 0);
        const y0 = courseY(c, rx0, rz0, law);
        const y1 = run[3];
        if (y1 - y0 < 1e-4) continue;
        quad(wall.n, [[rx0, y0, rz0], [rx1, y0, rz1], [rx1, y1, rz1], [rx0, y1, rz0]]);
      }
    }
  };

  // Where a block is left out of a course: the targets show one, a dark socket
  // on the west flank of 01. Turned into an interval of its own wall ONCE, so
  // the run that is broken and the socket that is cut are the same stretch of
  // stone rather than two answers about where the hole is.
  const sockets = [];
  for (const r of law.recesses) {
    const wall = skin.find((w) => w.key === r.wall);
    if (!wall) continue;
    const u = wall.dx !== 0 ? (r.at - wall.x0) * wall.dx : (r.at - wall.z0) * wall.dz;
    const i = Math.round((u - cellPhase(r.course, law)) / law.cell);
    const u0 = cellEdge(r.course, i, law);
    const u1 = cellEdge(r.course, i + 1, law);
    if (u0 < 0 || u1 > wall.span) continue;
    sockets.push({ wall, course: r.course, u0, u1, depth: r.depth ?? law.cell * 0.35 });
  }

  for (let w = 0; w < skin.length; w++) {
    const wall = skin[w];
    const along = wall.dx !== 0;
    const topFor = (u) => runAt(along ? wall.x0 + wall.dx * u : wall.x0);
    const holes = sockets.filter((s) => s.wall === wall);
    if (solid) buildBlockWall(wall, w, topFor, 0, holes);
    else buildWall(wall, topFor, 0, holes);
  }

  // The steps of the head, as walls of their own. A head that drops six courses
  // over part of its width shows six courses of stone on the riser between the
  // two levels, and drawing that as one blank face would be the one place in
  // the block where the masonry stopped.
  for (let i = 0; i + 1 < runs.length; i++) {
    const a = runs[i];
    const b = runs[i + 1];
    if (a.courses === b.courses) continue;
    const high = a.courses > b.courses ? a : b;
    const low = a.courses > b.courses ? b : a;
    const east = a.courses > b.courses;
    const riser = east
      ? { key: 'step', n: [1, 0, 0], x0: a.x1, z0: depth / 2, dx: 0, dz: -1, span: depth }
      : { key: 'step', n: [-1, 0, 0], x0: a.x1, z0: -depth / 2, dx: 0, dz: 1, span: depth };
    // The riser is laid like everything else, with a seat of its own (4 + i) so
    // that a step of the head does not repeat the flank it stands beside.
    if (solid) buildBlockWall(riser, 4 + i, () => high, low.courses);
    else buildWall(riser, () => high, low.courses);
  }

  // The cap of each head run, inset all round by the same dressed edge the
  // walls carry, so the top edge of the last course IS the rim of the cap and
  // no facet is drawn twice. It follows the wander with the wall it belongs to:
  // a flat lid over a top course that strays would open a crack at the head,
  // which is the one silhouette in the frame the eye finds first.
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    // Inset where the cap has an OUTSIDE to be dressed against: the end of the
    // block, or a neighbour standing lower — which on the stair is the nosing,
    // the one thing that actually reads on a tread. Where the neighbour stands
    // higher the stone carries on up and there is no edge to dress.
    const before = r > 0 ? runs[r - 1] : null;
    const after = r + 1 < runs.length ? runs[r + 1] : null;
    const x0 = run.x0 + (!before || before.courses < run.courses ? chamfer : 0);
    const x1 = run.x1 - (!after || after.courses < run.courses ? chamfer : 0);
    const z0 = -depth / 2 + chamfer;
    const z1 = depth / 2 - chamfer;
    const cuts = [x0];
    if (law.wander) {
      const s = law.wanderSpan;
      for (let k = Math.ceil(x0 / s); k * s < x1; k++) if (k * s > x0) cuts.push(k * s);
    }
    cuts.push(x1);
    for (let s = 0; s + 1 < cuts.length; s++) {
      const a = cuts[s];
      const b = cuts[s + 1];
      // The wander is read AT THE WALL and not at the inset corner: the rim of
      // the cap and the chamfer under it have to be the same line to the last
      // micron, and a field read half a chamfer away is not the same line.
      const ya0 = headY(run, a, -depth / 2);
      const ya1 = headY(run, a, depth / 2);
      const yb0 = headY(run, b, -depth / 2);
      const yb1 = headY(run, b, depth / 2);
      quad([0, 1, 0], [
        [a, ya0, z0], [a, ya1, z1], [b, yb1, z1], [b, yb0, z0],
      ]);
    }
  }

  // And the sockets themselves, cut back rather than removed.
  for (const s of sockets) {
    const { wall } = s;
    const at = (u, back) => [
      wall.x0 + wall.dx * u - wall.n[0] * back,
      wall.z0 + wall.dz * u - wall.n[2] * back,
    ];
    const [ax, az] = at(s.u0, s.depth);
    const [bx, bz] = at(s.u1, s.depth);
    const [ox, oz] = at(s.u0, 0);
    const [px, pz] = at(s.u1, 0);
    const y0 = courseY(s.course, ax, az, law);
    const y1 = courseY(s.course + 1, ax, az, law) - chamfer;
    quad(wall.n, [[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]]);
    const side = [wall.n[2], 0, -wall.n[0]];
    quad(side, [[ox, y0, oz], [ax, y0, az], [ax, y1, az], [ox, y1, oz]]);
    quad([-side[0], 0, -side[2]], [[bx, y0, bz], [px, y0, pz], [px, y1, pz], [bx, y1, bz]]);
    quad([0, -1, 0], [[ox, y1, oz], [ax, y1, az], [bx, y1, bz], [px, y1, pz]]);
    quad([0, 1, 0], [[ox, y0, oz], [px, y0, pz], [bx, y0, bz], [ax, y0, az]]);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: indices.length > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
    blocks: countBlocks(spec),
    courses,
    rise,
    height,
    law,
    runs,
    quads,
    fused,
    lod: solid ? 'near' : 'far',
    laid,
    opened,
    vertices: positions.length / 3,
    angle: spec.rotationY * DEG,
  };
}

/**
 * The horizontal faces of a built block: what a foot can stand on top of.
 *
 * The head of a block is not a lid any more, it is one to four levels at
 * different heights, so anything that has to answer where the built stone is
 * under a point has to read the levels rather than the box. Given in the
 * block's OWN frame, in metres: whoever asks turns them.
 */
export function masonryDecks(spec) {
  const [width, , depth] = spec.size;
  const law = masonryLaw(spec);
  const runs = headRuns(law, width);
  return runs.map((run, r) => {
    const before = r > 0 ? runs[r - 1] : null;
    const after = r + 1 < runs.length ? runs[r + 1] : null;
    return {
      x0: run.x0,
      x1: run.x1,
      z0: -depth / 2,
      z1: depth / 2,
      y: run.courses * law.rise - run.drop,
      // Which of the four edges of this level is a DRESSED one. An edge with a
      // higher neighbour behind it is not an edge at all — the stone carries on
      // up — and the chamfer that a foot feels is only on the others.
      dressed: {
        x0: !before || before.courses < run.courses,
        x1: !after || after.courses < run.courses,
        z0: true,
        z1: true,
      },
      chamfer: law.chamfer,
    };
  });
}

/**
 * How many blocks the skin of one spec is laid from.
 *
 * A CENSUS AND NOT A SEAT. Where a block begins is decided in the fragment, out
 * of the fragment's own position, and this walks the same law with the same
 * arithmetic to count them. Nothing draws from it: it is here so the cost of a
 * wall can be stated in blocks as well as in triangles, and so the law can be
 * checked against the histogram the targets give.
 */
export function countBlocks(spec) {
  const [width, , depth] = spec.size;
  const law = masonryLaw(spec);
  const runs = headRuns(law, width);
  const walls = [
    { span: width, along: true, at: 0 },
    { span: width, along: true, at: 0 },
    { span: depth, along: false, at: width / 2 },
    { span: depth, along: false, at: -width / 2 },
  ];
  const runAt = (x) => runs.find((r) => x <= r.x1 + 1e-9) || runs[runs.length - 1];
  let blocks = 0;
  for (const wall of walls) {
    for (let c = 0; c < law.courses; c++) {
      // How much of this wall this course actually stands over, in metres.
      const standing = wall.along
        ? runs.filter((r) => r.courses > c).reduce((s, r) => s + (r.x1 - r.x0), 0)
        : (runAt(wall.at).courses > c ? wall.span : 0);
      const cells = Math.max(0, Math.round(standing / law.cell));
      let count = cells ? 1 : 0;
      for (let i = 1; i < cells; i++) if (isCut(c, i, law)) count += 1;
      blocks += count;
    }
  }
  return blocks;
}

/** Every block of the hub, for the estimate the demo's one block scales to. */
export function masonryCensus(specs = MONOLITHS) {
  return specs.map((spec) => {
    const built = buildMasonry(spec);
    return {
      id: spec.id, blocks: built.blocks, courses: built.courses, quads: built.quads,
    };
  });
}
