import { heightAt, pathCoord, pathRun, smoothstep } from '../terrain-field.js';
import { AREA_CENTER, MONOLITHS } from '../layout.js';
// The plan and not the meshes: where the boulders stand is a number in a file,
// and rocks.js -- which is where they become geometry -- reaches three.js. The
// import attribute is what lets the same line be read by node and by the
// bundler, which is the property this whole half of the engine rests on.
import ROCK_PLAN from '../../../assets-src/rocks/rocks.json' with { type: 'json' };

// The voxel field and the greedy mesher over it.
//
// Pure arithmetic and typed arrays: no three.js, no DOM. That is what lets the
// same file run inside the worker, inside the page and under plain node, and it
// is the reason the fusion number can be checked offline against the number the
// render reports. Two implementations of this would be two answers to the one
// question the whole pivot rests on.
//
// ===========================================================================
// THE TWO RULES THAT ARE NOT NEGOTIABLE, AND WHAT BREAKING EITHER COSTS.
//
// They are written here, at the top of the file that would break them, because
// both are ONE LINE either way. Neither shows up in a review as a change to the
// budget, and both were measured rather than reasoned.
//
// 1. NEVER A PER-VOXEL PROPERTY IN A VERTEX ATTRIBUTE.
//
//    The tint, the joint and the lightened arris are rebuilt in the fragment
//    out of the fragment's own position, relative to the chunk. The moment any
//    of them has to be handed over per vertex, a merged rectangle can no longer
//    stand for a hundred cubes -- the merge dies, and the geometry of the whole
//    world goes up by THREE TIMES. Measured, not feared.
//
//    It is also why the position stays in the chunk's own frame all the way to
//    the fragment: a few metres of range instead of a few hundred, which is
//    what the arithmetic needs to stay exact at medium precision.
//
// 2. ONE STEP, AND NO RING OF STEPS.
//
//    Ten centimetres, everywhere the hand can reach. A ladder of sizes anchored
//    to the world is only ever the right size in ONE PLACE: the walker wanders
//    over a disc twenty one metres across, so a ring measured for the middle of
//    the hub is wrong by an order of magnitude under their own feet at the rim.
//    Measured on the shape that tried it, the ground under the walker read 134
//    pixels a cube against the target's 12 -- wrong by eleven times.
//
//    So there is one step here, and the shell beyond it is the bent grid that
//    already exists, with its heights quantised. Anything that reintroduces a
//    second step reintroduces that defect, however it is dressed up.
// ===========================================================================

/** The one step, in metres. */
export const VOXEL = 0.10;

// How far the tuft stays correlated, in metres of world.
//
// IT IS A PERFORMANCE DIAL WEARING THE CLOTHES OF AN ART CHOICE, and that is
// the single most surprising thing measured about this field. The ground of
// this project is nearly flat at ten centimetres — voxelised bare it reads as a
// ruled plane, not as a world of cubes — so the cubic look has to be MADE, and
// making it is what the geometry is spent on. Decorrelating this number, which
// no reviewer would read as a change to the budget, multiplies the quads of the
// whole world by about three and a half.
export const TUFT_CORRELATION = 0.30;

// Columns per side of a chunk. Sixty four because that is the tiling the sweep
// over the walker's positions was measured with, including the penalty for the
// merges that die at a chunk's edge: changing it here would make the demo's
// fusion number and the world's estimate two different measurements.
export const CHUNK = 64;

// How far the ten centimetre ground reaches, in metres from the walkable
// centre — THE DEFAULT, and no longer the only answer there is.
//
// It was a frozen literal of fourteen, and fourteen was never a decision about
// the world: it was the radius the first bench could lay while the fusion
// figure was being argued, and every figure of the campaign was then measured
// against it. E-V1a settled the shape — thirty five metres by default, GOVERNED
// by quality.voxelDiscRadius, and the per tier values measured rather than
// guessed — and E-V1d authorised the rewiring here.
//
// WHAT THAT MAKES THIS NUMBER, AND WHAT IT DOES NOT. It is the default the
// engine answers with when nobody says otherwise, so a guard, an offline tool
// and a page that asks for nothing all lay the same disc. It is NOT a second
// opinion beside the tier: everything that ships takes the radius from the tier
// and hands it in, and the one place a radius may be written down is
// src/core/quality.js. A radius hardcoded anywhere else is the defect this
// constant existed to prevent, moved rather than cured.
//
// AND IT IS A PARAMETER AND NOT A SETTING. It arrives as an argument, so the
// field stays a pure function of the point and its radius: two callers asking
// for two different discs in the same process get two right answers, and no
// tool can read a number the page was not laid at. A module level dial set once
// at boot would have been fewer characters and would have made the offline
// check — the one property the whole budget rests on — unable to say WHICH disc
// it had checked.
export const DISC_RADIUS = 35;

export const CENTRE = { x: AREA_CENTER.x, z: AREA_CENTER.z };

// The six orientations, in the order the material reads them: the top first,
// because it is the one that carries the full sky and it is the family every
// other one is measured against.
export const FACE = {
  TOP: 0, NORTH: 1, SOUTH: 2, EAST: 3, WEST: 4, BOTTOM: 5,
};

// Where the block of the demo stands, so the meadow does not grow inside the
// masonry. Its own footprint, in its own frame, plus a hand of clearance.
const BLOCK = MONOLITHS.find((m) => m.id === '05');
const BLOCK_ANGLE = BLOCK.rotationY * Math.PI / 180;
const BLOCK_HALF = { x: BLOCK.size[0] / 2 + 0.12, z: BLOCK.size[2] / 2 + 0.12 };

// --------------------------------------------------------------- the tuft
//
// The same hash and the same fade as src/world/terrain-field.js, because the
// tuft has to be a field like every other field in this world: defined
// everywhere, identical wherever it is evaluated, and reproducible by a second
// implementation. It is not imported because those two are private to that
// file and exporting them would be a change to a shipped module.

function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function noise2(x, z) {
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

// Where the tuft changes state, as a share of its own signed range.
//
// It is a SECOND dial on the geometry hiding behind the same art choice as the
// correlation length, and it was found by measuring rather than by reasoning:
// at thirds the three states come out evenly and the field crosses a boundary
// roughly twice per correlation length, at halves it spends half its life flat
// and crosses far less often. The quads of the world move by a quarter between
// the two and nothing in a review would show it.
export const TUFT_GATE = 0.5;

/**
 * The tuft, in whole voxels: minus one, nought or plus one.
 *
 * Symmetric about nought so the field neither rises nor sinks on average. A
 * tuft that biased the mean would move the ground out from under the walker,
 * who is standing on the field itself and not on this.
 */
export function tuftAt(x, z, gate = TUFT_GATE) {
  const n = noise2(x / TUFT_CORRELATION + 41.7, z / TUFT_CORRELATION + 13.9) * 2 - 1;
  if (n < -gate) return -1;
  if (n > gate) return 1;
  return 0;
}

// ======================================================================
// THE CARPET, AS THE TARGET DRAWS IT -- and it is the committente's word
// and not a taste taken here (E-DECISIONI.1: «A - come il target»).
//
// WHAT THE TUFT ABOVE CANNOT DO, MEASURED RATHER THAN ARGUED. A1-bis read the
// day target's own meadow in seven windows that hold no stone at all and found
// the census of its risers to be 59 / 26 / 14 -- fourteen per cent of them are
// THREE VOXELS OR MORE. The tuft is plus or minus one voxel, so its tallest
// possible wall is two: it cannot make that fourteen per cent at any
// correlation length and at any gate. Shortening the correlation does not get
// there either; it reaches two thirds of the target's step density and then
// RESONATES, because at 0.10 m the noise's own lattice lands exactly on the
// voxel lattice. That is a wall and not a tuning problem.
//
// SO THE CARPET IS THREE TERMS, AND EACH ONE ANSWERS A READING:
//
//   THE GRAIN      a share of columns take their state from their own hash
//                  instead of from the smooth tuft, which is what
//                  "uncorrelated" means for a carpet. It carries the step
//                  density, and it keeps the amplitude at exactly one voxel
//                  either way.
//   THE MOUNDS     E-V4d: what the targets draw as "bushes" against the stone
//                  are not plants, they are the carpet PILED UP, three to six
//                  voxels of it, banked on a block's foot or a boulder's flank.
//                  The stone they lean on is V2's and is not touched here.
//   THE MEADOW     and the same pile in the OPEN meadow, which is where the
//                  three-voxel risers of the target's own census actually are.
//                  E-V1b settled the attribution: they are V1's, because V4's
//                  accents are seeded at 0.04-0.09 per square metre and cannot
//                  make fourteen per cent of the risers of anything.
//
// EVERY ONE OF THEM IS A FIELD -- a pure function of the point, defined
// everywhere, reproducible by a second implementation -- so the two rules at the
// top of this file survive intact: the step is still ONE, and nothing per voxel
// ever reaches a vertex. What changes is the arithmetic of columnTop and
// nothing else in the file.
//
// AND THE PRICE WAS PAID BEFORE THE CODE WAS WRITTEN. D3a priced this arm at
// 1.73x of the reallocated budget with the frozen engine reproducing the page
// digit for digit, the committente was asked, and the committente chose it.

/**
 * How many columns take the grain instead of the smooth tuft, as a share.
 *
 * A THIRD DIAL ON THE GEOMETRY WEARING THE CLOTHES OF AN ART CHOICE, like the
 * two above it, and the largest of the three: it is most of the difference
 * between a meadow that costs 0.53 quads a column and one that costs 1.54.
 * A1-bis swept it and 0.45 is where the field statistic lands on the target's
 * own, read by the same estimator on both. It was not fitted to a budget.
 */
export const CARPET_GRAIN = 0.45;

/** The pile: how far it reaches from the stone, how coarse it is, how tall. */
export const MOUND = {
  band: 0.85,   // how far out from the stone a mound may sit, in metres
  clump: 0.42,  // how big one clump of piled carpet is, in metres
  gate: 0.56,   // how much of that band is piled and how much stays meadow
  meadowGate: 0.70, // and how much of the OPEN meadow is, which is far less
  low: 3,       // the census E-V4d names: three voxels ...
  high: 6,      // ... to six.
};

// Where the ground already rises against the stone, which is where the piles
// are anchored: the blocks that stand in grass, and the boulders whose places
// were traced back onto the meadow off the target's own pixels. Nothing here is
// a position invented for the carpet.
const GRASS_BLOCKS = MONOLITHS.filter((m) => m.baseY === 0).map((m) => ({
  x: m.position.x,
  z: m.position.z,
  c: Math.cos(m.rotationY * Math.PI / 180),
  s: Math.sin(m.rotationY * Math.PI / 180),
  hx: m.size[0] / 2,
  hz: m.size[2] / 2,
}));
const BOULDERS = ROCK_PLAN.rocks.map((r) => ({ x: r.x, z: r.z, radius: r.radius }));

/** Distance from a point to the outside of a block's footprint, in metres. */
function toBlock(b, x, z) {
  const dx = x - b.x;
  const dz = z - b.z;
  const lx = Math.abs(dx * b.c - dz * b.s) - b.hx;
  const lz = Math.abs(dx * b.s + dz * b.c) - b.hz;
  return Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, lz), 0);
}

/** Whole voxels of pile, from a clump field read at a strength. Nought or 3..6. */
function pile(x, z, seedX, seedZ, gate, weight) {
  const n = noise2(x / MOUND.clump + seedX, z / MOUND.clump + seedZ) * weight;
  if (n <= gate) return 0;
  const t = (n - gate) / (1 - gate);
  return MOUND.low + Math.min(MOUND.high - MOUND.low,
    Math.floor(t * (MOUND.high - MOUND.low + 1)));
}

/**
 * Extra whole voxels of carpet banked against the stone. Nought almost everywhere.
 */
export function moundAt(x, z) {
  let near = Infinity;
  for (const b of GRASS_BLOCKS) {
    const d = toBlock(b, x, z);
    if (d >= 0 && d < near) near = d;
  }
  for (const r of BOULDERS) {
    const d = Math.hypot(x - r.x, z - r.z) - r.radius;
    if (d >= 0 && d < near) near = d;
  }
  if (near > MOUND.band) return 0;
  return pile(x, z, 91.3, 27.1, MOUND.gate, 1 - smoothstep(0, MOUND.band, near));
}

/**
 * And the same pile standing in the open meadow, which is where the target's
 * own three-voxel risers are. A separate seed, so the two never line up.
 */
export function meadowMoundAt(x, z) {
  return pile(x, z, 313.7, 57.9, MOUND.meadowGate, 1);
}

/**
 * The three states of the grain, drawn straight from the column's own hash.
 *
 * A HASH AND NOT A RANDOM: the same column answers the same way in every run,
 * in every implementation, forever -- which is what makes this a field and not
 * a texture that would have to be stored somewhere and handed to a vertex.
 * Symmetric about nought at the frozen gate, for the same reason the tuft is.
 */
export function grainAt(ix, iz, gate = TUFT_GATE) {
  const p = (1 - gate) / 2;
  const u = hash2(ix * 3 + 7, iz * 5 + 13);
  if (u < p) return -1;
  if (u > 1 - p) return 1;
  return 0;
}

/** Whether this column takes the grain instead of the smooth tuft. */
function takesGrain(ix, iz) {
  return hash2(ix * 11 + 3, iz * 17 + 29) < CARPET_GRAIN;
}

// ======================================================================

/** Whether a point stands on the paving, which is not voxel and never becomes one. */
export function onPaving(x, z) {
  return pathRun(z) > 0.5 && Math.abs(pathCoord(x, z)) < 1;
}

/** Whether a point stands inside the block's own footprint. */
function insideBlock(x, z) {
  const c = Math.cos(BLOCK_ANGLE);
  const s = Math.sin(BLOCK_ANGLE);
  const dx = x - BLOCK.position.x;
  const dz = z - BLOCK.position.z;
  return Math.abs(dx * c - dz * s) <= BLOCK_HALF.x
    && Math.abs(dx * s + dz * c) <= BLOCK_HALF.z;
}

/** World position of the centre of a column, from its global voxel indices. */
export function columnCentre(ix, iz) {
  return { x: (ix + 0.5) * VOXEL, z: (iz + 0.5) * VOXEL };
}

// What a column that is not there reads as. Not nought and not a negative
// height: it is a value no wall can ever be measured against, so an edge column
// raises its whole side rather than the sliver above a neighbour's shoulder.
const EMPTY = -1e9;

// How far a wall with nothing beyond it drops, in voxels. See the note in the
// side pass for why it exists at all.
//
// TWO CLOSED THE SEAM WHEN THE TALLEST THING A COLUMN COULD DO WAS STAND ONE
// STEP PROUD OF THE FIELD. The piles of the carpet stand up to six, and a
// curtain that still only reached two would leave up to forty centimetres of
// daylight under every mound that happens to sit on the rim of the disc or on
// a bank of the paving. So the drop is the pile's own height plus the two that
// closed it before.
//
// IT COSTS NOT ONE QUAD. A wall is a single rectangle whatever its height: what
// this buys is the height of four corners and nothing else. The overdraw is a
// strip along the rim and the two banks, behind ground that is already drawn.
const SKIRT = 2 + MOUND.high;

// What a missing column reads as in the handed-back height map. The smallest
// value the type holds, so no arithmetic on a real top can ever reach it.
export const NO_COLUMN = -32768;

/**
 * The top voxel of one column, as a whole number of steps.
 *
 * Rounded rather than floored so the cubes straddle the true field instead of
 * sitting a half step under it: the walker's own floor is the field itself and
 * the two must not part company by a systematic half voxel.
 *
 * WHAT `tuft` MEANS NOW IS THE WHOLE CARPET AND NOT ONLY THE TUFT, and the name
 * is kept because it is the third argument of a door four other sessions call
 * through. False is the BARE voxelised ground -- the field rounded to the step
 * and nothing added -- which is what every reader of that flag has always
 * wanted it for: it is the baseline the carpet's own cost is read against, and
 * guard-ciuffo prints exactly that difference every run.
 */
export function columnTop(ix, iz, tuft = true, radius = DISC_RADIUS) {
  const { x, z } = columnCentre(ix, iz);
  if (Math.hypot(x - CENTRE.x, z - CENTRE.z) > radius) return EMPTY;
  if (onPaving(x, z)) return EMPTY;
  if (insideBlock(x, z)) return EMPTY;
  const step = Math.round(heightAt(x, z) / VOXEL);
  if (!tuft) return step;
  // The grain REPLACES the smooth tuft on the columns it takes, it does not add
  // to it: that is what keeps the amplitude at exactly one voxel whichever of
  // the two a column drew from, and it is why the carpet's tallest wall is
  // still the field's own step plus one -- before the piles, which are the term
  // that is meant to be taller.
  const grained = takesGrain(ix, iz);
  return step + (grained ? grainAt(ix, iz) : tuftAt(x, z))
    + moundAt(x, z) + meadowMoundAt(x, z);
}

/** The whole disc, in chunk coordinates: every chunk with a column in it. */
export function chunkList(radius = DISC_RADIUS) {
  const half = Math.ceil(radius / VOXEL / CHUNK) + 1;
  const cx0 = Math.floor(CENTRE.x / VOXEL / CHUNK);
  const cz0 = Math.floor(CENTRE.z / VOXEL / CHUNK);
  const list = [];
  for (let cz = cz0 - half; cz <= cz0 + half; cz++) {
    for (let cx = cx0 - half; cx <= cx0 + half; cx++) {
      // The chunk's own square against the disc, before a single height is
      // sampled: the corners of the box nearest the centre decide it, and a
      // chunk that cannot reach the disc costs no calls to the field at all.
      const x0 = cx * CHUNK * VOXEL;
      const z0 = cz * CHUNK * VOXEL;
      const x1 = x0 + CHUNK * VOXEL;
      const z1 = z0 + CHUNK * VOXEL;
      const nx = Math.max(x0, Math.min(CENTRE.x, x1));
      const nz = Math.max(z0, Math.min(CENTRE.z, z1));
      if (Math.hypot(nx - CENTRE.x, nz - CENTRE.z) <= radius) list.push({ cx, cz });
    }
  }
  return list;
}

// ------------------------------------------------------------- the mesher
//
// Two passes, and both of them merge. The tops are grown into rectangles of one
// height; the sides are gathered into runs of one top and one floor, in each of
// the four bearings separately. What is deliberately NOT here is a merge across
// the vertical of a wall: runs are what the sweep behind the recommendation
// measured, so runs are what this counts, and the two dimensional merge stays
// on the table as headroom rather than being spent silently here.
//
// AND NOTHING PER VOXEL TOUCHES A VERTEX. The tint, the joint and the lightened
// arris are rebuilt in the fragment out of the position; the light is analytic
// on a constant normal. Every one of them is therefore constant over a merged
// rectangle in the only sense that matters — it does not have to be stored — so
// none of them can split a merge. Handing the tint to a vertex attribute
// instead costs three times the geometry of the world, which is the whole
// budget, and it is one line of shader that does it.

const QUAD_INDEX = [0, 1, 2, 0, 2, 3];

/**
 * Meshes one chunk.
 *
 * THE FOURTH ARGUMENT IS THE DISC AND NOT A NEW OPINION. The three that were
 * here are untouched in name, order and meaning, so every call site written
 * against this door keeps its exact behaviour; the radius is optional and its
 * default is the engine's own, so a caller that passes three arguments lays bit
 * for bit the disc this signature always laid. It is here rather than read off
 * a module dial because the field has to stay a pure function of the point —
 * see the note over DISC_RADIUS.
 *
 * @param {number} cx chunk index along x
 * @param {number} cz chunk index along z
 * @param {boolean} tuft whether the tuft is part of the field
 * @param {number} radius how far the disc reaches, in metres
 * @returns {object} chunk-relative geometry, its counts and its box
 */
export function meshChunk(cx, cz, tuft = true, radius = DISC_RADIUS) {
  const n = CHUNK;
  // A skirt of one column either side, so a wall on the chunk's own edge is
  // measured against the ground beyond it rather than against nothing. Without
  // it every chunk grows a full height wall around its whole rim.
  const span = n + 2;
  const top = new Float64Array(span * span);
  const ox = cx * n;
  const oz = cz * n;
  let columns = 0;
  for (let j = 0; j < span; j++) {
    for (let i = 0; i < span; i++) {
      const h = columnTop(ox + i - 1, oz + j - 1, tuft, radius);
      top[j * span + i] = h;
      // Only the chunk's own columns are counted: the skirt belongs to its
      // neighbours and counting it would divide the quads by too many columns.
      if (h !== EMPTY && i > 0 && i <= n && j > 0 && j <= n) columns++;
    }
  }
  const at = (i, j) => top[(j + 1) * span + (i + 1)];

  // The chunk's own tops, handed back with the geometry.
  //
  // The walker has to stand ON the cubes and the grass has to be planted on
  // them, and both ask far too often to call the field again — 926 ns a point
  // is a measurement, not a lookup. So the answers the mesher already has are
  // kept rather than thrown away and asked for a second time, which is also
  // what stops the floor and the picture from ever disagreeing.
  const tops = new Int16Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h = at(i, j);
      tops[j * n + i] = h === EMPTY ? NO_COLUMN : h;
    }
  }

  const quads = [];
  // How many of the walls exist only because something ends here — the rim of
  // the disc, or a bank of the paving — rather than because the field stepped.
  // Counted apart because it is the one part of this number that does NOT scale
  // to the world: a disc of fourteen metres is nearly all edge and a world is
  // nearly all middle, so a fusion figure that mixed them would understate the
  // world it is being read as evidence for.
  let rim = 0;
  const push = (face, ax, ay, az, bx, by, bz, cx2, cy, cz2, dx, dy, dz) => {
    quads.push([face, ax, ay, az, bx, by, bz, cx2, cy, cz2, dx, dy, dz]);
  };

  // ------------------------------------------------------------- the tops
  const used = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (used[j * n + i]) continue;
      const h = at(i, j);
      if (h === EMPTY) continue;
      let w = 1;
      while (i + w < n && !used[j * n + i + w] && at(i + w, j) === h) w++;
      let d = 1;
      grow: while (j + d < n) {
        for (let k = 0; k < w; k++) {
          if (used[(j + d) * n + i + k] || at(i + k, j + d) !== h) break grow;
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
      push(FACE.TOP, x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0);
    }
  }

  // ------------------------------------------------------------ the sides
  //
  // One bearing at a time. Along each one the outer loop walks the axis the
  // wall stands on and the inner loop walks the axis it runs along, so a run of
  // columns sharing a top and a floor is one rectangle whatever its length.
  const wall = (face, along, dix, diz) => {
    for (let a = 0; a < n; a++) {
      let b = 0;
      while (b < n) {
        const i = along ? b : a;
        const j = along ? a : b;
        const h = at(i, j);
        if (h === EMPTY) { b++; continue; }
        const floor = at(i + dix, j + diz);
        const bottom = floor === EMPTY ? -1e9 : floor;
        if (h <= bottom) { b++; continue; }
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
          run++;
        }
        // A wall with nothing beyond it — the rim of the disc, and both banks
        // of the paving — only has to reach the surface that is ALREADY drawn
        // underneath it, which is the bent grid at the true height of the
        // ground. The cubes stand within a step and a half of that field by
        // construction, so two steps closes the seam and anything deeper is a
        // curtain nobody can see, paid for along every metre of both banks.
        const low = floor === EMPTY ? h - SKIRT : floor;
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
          push(face, x1, yLow, z0, x1, yTop, z0, x1, yTop, z1, x1, yLow, z1);
        } else if (face === FACE.WEST) {
          push(face, x0, yLow, z1, x0, yTop, z1, x0, yTop, z0, x0, yLow, z0);
        } else if (face === FACE.SOUTH) {
          push(face, x1, yLow, z1, x1, yTop, z1, x0, yTop, z1, x0, yLow, z1);
        } else {
          push(face, x0, yLow, z0, x0, yTop, z0, x1, yTop, z0, x1, yLow, z0);
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

  return pack(quads, columns, rim, tops, cx, cz);
}

/**
 * Lays the quads down as buffers a worker can hand over without copying.
 *
 * A greedy mesh shares no vertices — every rectangle is its own four corners —
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
  // frustum throw a chunk away, so it has to exist — and computing it is the
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
 * The whole disc, meshed, and the one number the pivot is decided on first.
 *
 * Quads over columns, with the tint and the light active — which they are by
 * construction here, because neither is stored. Above 0.55 the budget for
 * geometry is nought by arithmetic and nothing further needs measuring.
 */
export function meshDisc(onChunk, tuft = true, radius = DISC_RADIUS) {
  let quads = 0;
  let columns = 0;
  let rim = 0;
  const chunks = [];
  for (const { cx, cz } of chunkList(radius)) {
    const chunk = meshChunk(cx, cz, tuft, radius);
    if (chunk.quads === 0) continue;
    quads += chunk.quads;
    columns += chunk.columns;
    rim += chunk.rim;
    chunks.push(chunk);
    if (onChunk) onChunk(chunk);
  }
  return {
    chunks,
    quads,
    columns,
    rim,
    quadsPerColumn: columns ? quads / columns : 0,
    // The same ratio with the edges of the piece taken out, which is the figure
    // that carries to a world: a disc of fourteen metres is a third edge and a
    // world is almost none.
    insidePerColumn: columns ? (quads - rim) / columns : 0,
  };
}
