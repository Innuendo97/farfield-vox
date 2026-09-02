import { heightAt, pathCoord, pathRun, smoothstep } from '../terrain-field.js';
import { AREA_CENTER, MONOLITHS, PLATFORM, STAIRS } from '../layout.js';
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
 * The patches the tuft is allowed on, and the length of a course between them.
 *
 * TWO NUMBERS AND BOTH ARE DATA. `correlation` is how big a patch is, in
 * metres; `share` is how much of the meadow carries one. At `share` = 1 the
 * gate admits everything and this object does nothing at all, which is the
 * state the previous delivery shipped in and the state this file returns to if
 * the committente says the floor was better before.
 */
export const TUFT_PATCH = { correlation: 1.20, share: 1.00 };

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

/**
 * Where the tuft is admitted at all: the patches, and the courses between them.
 *
 * WHY A SECOND FIELD AND NOT A SECOND DIAL ON THE FIRST. The tuft's own two
 * numbers say how OFTEN the floor changes state and how MUCH of its range it
 * spends changing; neither of them can say that the changes should stand
 * TOGETHER. At a correlation of 0.30 m -- three columns -- a bump lands every
 * three or four cubes in every direction, which is the committente's own
 * complaint in his own words: «voxel ingiustificati come se ognuno dovesse
 * avere per forza una differenza di altezza con quelli accanto». The target
 * does the opposite: long courses of cubes at one level, and the steps it does
 * take gathered into the hems and flanks of something.
 *
 * SO THE GATE IS OVER THE TUFT AND NOT INSIDE IT. A second field, four times
 * longer, decides whether this patch of meadow is tufted at all; where it says
 * no the floor is the quantised field and nothing else, and a course runs until
 * the patch does. It is a DATUM and not a mechanism -- at `share` one it admits
 * the tuft everywhere and the floor is bit for bit the one that shipped -- and
 * it leaves both of the engine's own dials frozen where the sweep set them.
 *
 * AND IT DOES NOT MOVE THE GROUND UNDER THE WALKER. The tuft is symmetric about
 * nought, so a patch of meadow with no tuft on it sits at the same mean height
 * as one with: what changes is where the steps are, never where the floor is.
 */
export function tuftPatchAt(x, z) {
  if (TUFT_PATCH.share >= 1) return true;
  return noise2(x / TUFT_PATCH.correlation + 907.3, z / TUFT_PATCH.correlation + 311.5)
    < TUFT_PATCH.share;
}

// ======================================================================
// THE MEADOW IS A FLOOR WITH MOUNDS PUT ON IT, and that is the committente's
// own reading of the target rather than a taste taken here (E-DECISIONI4):
//
//   «UN CAMPO PIANEGGIANTE DI BASE con voxel d'erba e fiori qua e la'» and
//   «PICCOLE E MEDIE ALTURE SPARSE ... composizioni, cumuli ben orchestrati
//   che risultano veri e belli», against what stood here before it, which he
//   named too: «voxel ingiustificati come se ognuno dovesse avere per forza
//   una differenza di altezza con quelli accanto».
//
// WHAT THAT REPLACES, AND WHY THE READING IT REPLACES WAS NOT WRONG SO MUCH AS
// BLIND. The carpet this file used to lay was a STATISTIC. A share of columns
// took their step from their own hash -- the grain -- and piles three to six
// voxels tall were drawn from a noise over the whole meadow. It was fitted to
// a census of RISERS read off the day target, fourteen per cent of them three
// voxels or more, and that census is true: it was read correctly, twice, by
// two units. What a census of risers CANNOT say is whether those risers stand
// apart, one column at a time, or together, as the flanks of a few masses. It
// said so about itself in the verbale of D3b. They stand together.
//
// SO THE ARITHMETIC IS A PLACEMENT AND NOT A DISTRIBUTION. It is still a FIELD
// -- a pure function of the point, defined everywhere, identical wherever it is
// evaluated, reproducible by a second implementation -- so the two rules at the
// top of this file survive whole: nothing per voxel ever reaches a vertex, and
// the step is one everywhere except where a mound means it not to be.
//
//   THE FLOOR    the field, quantised, and the smooth tuft. Measured over the
//                whole disc: 99.36% of neighbouring pairs stand within ONE
//                voxel of each other and not one column in the meadow stands
//                two proud of all four of its neighbours.
//   THE MOUNDS   discrete masses on a lattice, one seat to a cell, jittered
//                inside it: a flat top, terraced flanks, two to four voxels.
//   THE BANK     E-V4d: what the targets draw as "bushes" against the stone is
//                the meadow PILED UP against it. One mass to a block and to a
//                boulder, PLACED and terraced, where a noise used to be.
//
// AND THE LATTICE IS WHAT MAKES «MAI DUE ATTACCATI» A PROPERTY AND NOT A HOPE.
// A seat's whole reach is bounded to stay inside its own cell -- the jitter it
// is allowed is the cell's half minus the largest reach it can draw -- so a
// point belongs to at most ONE seat, finding it is a single cell lookup rather
// than a search over nine, and two masses can never meet. None of that came out
// of a sweep: it is arithmetic, and it is the same arithmetic that makes the
// term cost three hashes.

/**
 * The mounds, and the bank against the stone: every number the shape has.
 *
 * THE THREE THE COMMITTENTE WAS ASKED ABOUT LIVE HERE AS DATA, which is the
 * whole reason this object has the fields it has. His word on any of the three
 * is a number in this object and not a change of mechanism:
 *
 *   D-F1  how many mounds there are           `density`
 *   D-F2  which flanks show bare earth        `EARTH` below
 *   D-F3  how tall they are in the open       `height`, and `bank` at the stone
 *
 * The defaults are how the target reads (F.1), and they are in force until he
 * says otherwise.
 */
export const MOUND = {
  // The lattice a seat may stand in. Five metres holds one mass to about
  // forty-five square metres at the density below, which is the target's own
  // spacing: F.1 counts its masses at three to six metres apart and the fork's
  // eye read one to every thirty to fifty square metres of meadow in frame.
  cell: 4.5,
  // How many of those cells carry a mass at all. D-F1: the same everywhere,
  // which is the default because it is how the target reads and because a
  // meadow that thinned with distance would be a decision about ground the
  // picture never shows.
  density: 0.62,
  // How far one mass reaches, in metres, before the lean below is applied.
  // 1.7 to 3.8 metres across, against the 1.5 to 3.5 the fork read.
  reach: { low: 0.80, high: 1.45 },
  // HOW FAR FROM ROUND IT IS ALLOWED TO BE, and it is not a decoration: a
  // circle is the one shape a meadow never draws, and a field of circles reads
  // as a field of circles at the first glance from any pose. The mass is
  // stretched along its own bearing and squeezed across it, which costs one
  // rotation and keeps the area it covers the same.
  lean: 0.22,
  // How much of the reach is flat top. The target's masses have a CROWN --
  // «cima piatta o a due terrazze» -- and a cone has none.
  plateau: 0.40,
  // HOW MUCH OF A MASS'S OWN RIM TURNS THE FULL BANK, as a share of its
  // perimeter, and it is the dial that says how much bare earth the meadow
  // shows without saying anything new about its shape.
  //
  // Half is the least it can be and still mean «the side that faces the eye»:
  // below that the bank is a lip rather than a flank. Above it the bank wraps
  // round toward the sides, which is what the target draws on the masses that
  // stand across the corridor from the camera -- their bare ground carries on
  // past the point where the eye stops being square to them.
  bankArc: 0.70,
  // HOW WIDE A HEM ROUND A MASS THE FLOOR STOPS TEXTURING ITSELF IN, in metres,
  // and it is the walker's number rather than a look.
  //
  // The tuft is the FLOOR's own grain, and a mass set down on the floor is not
  // grained by it: where a mound or a bank stands, and for this much ground
  // round it, the floor is the quantised field and nothing else. Two things
  // follow and both are measured. The bank stays ONE riser instead of a saw --
  // a tuft that steps along a rim turns a clean two-voxel bank into a run of
  // one, two and three, which is what the fork's eye read as a picket of
  // sticks. And the worst step in the world stays the bank's OWN height: with
  // the grain still running over the rim, a scarp of three and a tuft that fell
  // the other way made a single edge of 0.50 m, which is 0.20 m past
  // TUNING.ground.maxM and a step the body cannot damp.
  halo: 0.25,
  // Whole voxels, in the open field. D-F3 = A: three to four is what the fork
  // read in the foreground, and six is only allowed against the stone.
  height: { low: 2, high: 4 },
  // HOW TALL THE ONE RISER OF THE STEEP FLANK IS, in whole voxels, and it is
  // the number that makes a mound an OBJECT rather than a patch of the floor's
  // own noise.
  //
  // What stood here was `terraces`: two or three terraces down the flank, which
  // on a mass three voxels tall is three steps of one -- the same step the tuft
  // takes all round it, so nothing separated the mass from the meadow and the
  // eye could not point at a single mound in frame. The target draws the other
  // shape: one bank of two or three voxels AT ONCE, of bare earth, running five
  // to fifteen columns, with a flat crown of grass over it. The single terraces
  // survive on the GENTLE side, which is what the target draws there too.
  //
  // AND THE HEIGHT IS THE WALKER'S AND NOT A TASTE, WHICH IS WHY IT IS TWO AND
  // NOT THREE. The bank is not the only thing under his foot at the rim: the
  // quantised field steps there too, and where the two agree the edge is the
  // bank PLUS one. Measured over the 113 358 edges of the shipped disc
  // (v1-suolo/analisi/d4-passo.mjs): at a bank of three the worst edge in the
  // world is 0.40 m on six of them, which is 0.10 m past TUNING.ground.maxM in
  // src/core/presence.js and a step his body does not damp; at two it is
  // 0.30 m, which is exactly maxM, on eighteen. Three is inside the fork's
  // «2-3 voxel» and it is what the committente's word would buy at the price
  // of those six edges -- so the number lives here and the price is declared.
  scarp: 2,
  // HOW THE CROWN IS FINISHED. Nought is a flat top, which is how the target
  // reads under the compass and is the default; one puts a second terrace a
  // voxel below it over the outer half of the crown. It is the taste question
  // the fork raised and it lives here as a number, not as a mechanism.
  crownStep: 0,
  // ------------------------------------------------- and against the stone
  // How far out from a block or a boulder the bank reaches, in metres. Wider
  // than the old band because this one has to RAMP: the meadow climbs to the
  // stone in one-voxel steps instead of standing up in a wall at the band's
  // edge, which is what a pile drawn from a noise did.
  band: 1.15,
  // How tall it stands where it meets the stone. E-V4d's own census.
  bank: { low: 3, high: 6 },
};

/**
 * Which faces of a mound show bare earth rather than grass.
 *
 * D-F2, AS DATA. The default is A -- what the target draws and what the fork
 * read: earth only where the ground rises MORE THAN ONE VOXEL AT ONCE, and only
 * on the flanks that face the eye or the corridor. Grass everywhere else, and
 * grass on every crown.
 *
 * `minStep` is the whole of "steep": a flank that climbs one voxel is a step in
 * a meadow and keeps its grass; one that climbs two is a cut bank and shows
 * what it is cut into. Setting it to one is answer B, all the flanks.
 */
export const EARTH = {
  // How tall a flank has to be, in voxels, before it shows what it is cut into.
  //
  // TWO, AND THE ROUND TRIP IS THE MEASUREMENT AND NOT A PREFERENCE.
  //
  // The fork read the target's bare banks as standing where the ground «sale
  // piu' di un voxel di colpo», which is two. Counted in QUADS that looked far
  // too little -- two draws 1.05% of the disc's faces where the target shows
  // bare ground over 9.3% of the ground it draws outside the corridor -- so it
  // was moved to one, and then the same share was counted in PIXELS, which is
  // what a share of a picture actually means. Read as the difference between
  // the frame with the second mesh and the frame without it, at the pose the
  // campaign judges on:
  //
  //     minStep 1     150 508 px    37.4% of the ground drawn
  //     minStep 2      38 819 px     9.66%
  //     the day target                9.3%   (F.1, corridor taken out)
  //
  // A quad is not a pixel and at this camera it is nowhere near one: a flank
  // near the eye is twenty rows tall and a top is three, so a family that lives
  // ONLY on flanks takes several times its share of the faces. The first count
  // was the wrong unit for the question, the reading it overturned was right,
  // and it is back. D-F2's answer B is this at one.
  minStep: 2,
  // Toward the eye, which in this world is south: the reference camera stands
  // at z 14 and looks north, so a face whose outward bearing is +z is a face
  // the picture is of. And toward the corridor, which is the other thing the
  // target shows earth against -- read off pathCoord's own sign, so the two
  // sides of the path answer opposite ways and neither is a number typed here.
  toEye: true,
  toPath: true,
};


/**
 * Whether a flank of this bearing, standing here, shows bare earth.
 *
 * TWO BEARINGS AND NEITHER IS A NUMBER TYPED HERE. South is the eye: the pose
 * the whole campaign judges on stands at z 14 and looks north, so a face whose
 * outward bearing is +z is a face the picture is OF, and it is the one the
 * target draws its bare banks on. The other is the corridor, and which lateral
 * face turns toward it is read off pathCoord's OWN SIGN -- so the two sides of
 * the path answer opposite ways, the answer follows the path where the path
 * wanders, and nothing here has to know where it runs.
 *
 * @param {number} face one of FACE
 * @param {number} x
 * @param {number} z
 */
export function earthFacing(face, x, z) {
  if (EARTH.toEye && face === FACE.SOUTH) return true;
  if (!EARTH.toPath) return false;
  const side = pathCoord(x, z);
  return (side > 0 && face === FACE.WEST) || (side < 0 && face === FACE.EAST);
}

// ------------------------------------------------------------- the seats
//
// One cell of the lattice, answered from its own indices and nothing else, so
// the same cell answers the same way in every run and in every implementation.

/** The mass a lattice cell carries, or null where it carries none. */
function moundSeat(cx, cz) {
  if (hash2(cx * 7 + 19, cz * 13 + 5) >= MOUND.density) return null;
  const reach = MOUND.reach.low
    + hash2(cx * 53 + 811, cz * 97 + 43) * (MOUND.reach.high - MOUND.reach.low);
  // THE BOUND THAT MAKES TWO MASSES UNABLE TO TOUCH. Whatever the jitter draws,
  // the mass stays inside its own cell, so a point is inside at most one of
  // them. It is why this term is one cell lookup rather than nine.
  const jitter = MOUND.cell / 2 - reach * (1 + MOUND.lean);
  const ang = 2 * Math.PI * hash2(cx * 71 + 17, cz * 5 + 907);
  const rise = MOUND.height.low + Math.min(MOUND.height.high - MOUND.height.low,
    Math.floor(hash2(cx * 3 + 101, cz * 29 + 61)
      * (MOUND.height.high - MOUND.height.low + 1)));

  return {
    x: (cx + 0.5) * MOUND.cell + (hash2(cx * 17 + 3, cz * 23 + 71) * 2 - 1) * jitter,
    z: (cz + 0.5) * MOUND.cell + (hash2(cx * 41 + 59, cz * 19 + 13) * 2 - 1) * jitter,
    c: Math.cos(ang),
    s: Math.sin(ang),
    reach,
    rise,
  };
}

// Where the stone stands, which is the one thing in this world a mound may not
// grow on and the one thing it is meant to lean against. The blocks that stand
// in grass and the boulders whose places were traced back onto the meadow off
// the target's own pixels: nothing here is a position invented for the carpet.
const GRASS_BLOCKS = MONOLITHS.filter((m) => m.baseY === 0).map((m) => ({
  x: m.position.x,
  z: m.position.z,
  c: Math.cos(m.rotationY * Math.PI / 180),
  s: Math.sin(m.rotationY * Math.PI / 180),
  hx: m.size[0] / 2,
  hz: m.size[2] / 2,
  // HOW BIG A BANK A STONE EARNS, and it is the stone's own size that says so.
  // E-V4d's three to six voxels was read against the BLOCKS, which are metres
  // of masonry; a boulder is half a metre across, and the same bank drawn round
  // one would bury it. So a block gets the census's own top and a boulder gets
  // its floor, over a band no wider than the boulder itself.
  band: MOUND.band,
  peak: MOUND.bank.high,
  // AND THE MASONRY KEEPS ITS GRASS. The target draws the meadow BITING the
  // blocks -- «erba che morde la pietra» -- and bare ground only under the two
  // stone compositions, which stand on boulders. So a block's bank is grass to
  // the last cube and a boulder's is not.
  bare: false,
}));
const BOULDERS = ROCK_PLAN.rocks.map((r) => ({
  x: r.x,
  z: r.z,
  radius: r.radius,
  band: Math.min(MOUND.band, r.radius * 2.2),
  peak: MOUND.bank.low,
  bare: true,
}));

// AND THE WAY IN STAYS CLEAR. The committente's reading names it twice -- the
// seven steps are all in view in the target and none of them in ours -- so the
// stair run and the platform are not a place a mound may stand. They are boxes
// in the layout and they are read from there rather than restated.
const PLATFORM_ANGLE = PLATFORM.rotationY * Math.PI / 180;
const CLEAR = [
  {
    x: PLATFORM.x,
    z: PLATFORM.z,
    c: Math.cos(PLATFORM_ANGLE),
    s: Math.sin(PLATFORM_ANGLE),
    hx: PLATFORM.width / 2,
    hz: PLATFORM.depth / 2,
  },
  {
    x: STAIRS.x,
    z: STAIRS.z,
    c: 1,
    s: 0,
    hx: STAIRS.width / 2,
    hz: STAIRS.steps * STAIRS.tread,
  },
];

/** Distance from a point to the outside of a block's footprint, in metres. */
function toBlock(b, x, z) {
  const dx = x - b.x;
  const dz = z - b.z;
  const lx = Math.abs(dx * b.c - dz * b.s) - b.hx;
  const lz = Math.abs(dx * b.s + dz * b.c) - b.hz;
  return Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, lz), 0);
}

/**
 * How near the nearest stone is, and WHICH stone it is.
 *
 * The name comes back with the distance because the bank's height is the
 * STONE'S and not the point's: one block, one bank, the same all the way round
 * it. A height drawn from the point would speckle a single mass into a dozen.
 */
function toStone(x, z) {
  let near = Infinity;
  let anchor = null;
  for (const b of GRASS_BLOCKS) {
    const d = toBlock(b, x, z);
    if (d < near) { near = d; anchor = b; }
  }
  for (const r of BOULDERS) {
    const d = Math.hypot(x - r.x, z - r.z) - r.radius;
    if (d < near) { near = d; anchor = r; }
  }
  return { near, anchor };
}

/**
 * Whole voxels of mound standing on the floor at a point. Nought almost
 * everywhere, and never anything at all where somebody else owns the ground.
 *
 * THE CROWN IS FLAT, THE FLANK THE EYE SEES IS ONE BANK, AND THE FAR SIDE IS
 * TERRACED. That asymmetry is the whole of what makes a mound READ as an
 * object, and it is read off the target rather than chosen: the masses in
 * frame turn a continuous bare bank of two or three voxels toward the camera
 * and fall away in single steps behind, so the side the picture is OF has one
 * hard edge and the side it is not has none.
 *
 * HOW THE TWO SIDES ARE ONE FUNCTION AND NOT TWO. The bank is not a sector
 * pasted onto a cone: what the bearing chooses is the height of the FIRST
 * riser, from one voxel due north to the seat's own scarp due south, and the
 * rest of the mass's height is spent in single terraces above it. Two
 * neighbouring bearings therefore differ by at most one voxel anywhere on the
 * flank -- there is no seam down the east and west sides, which a pasted
 * sector would have left, and which the walker would have had to climb.
 *
 * Every terrace is a whole number of voxels and the tallest riser in the world
 * is `scarp.high` = 0.30 m = TUNING.ground.maxM, so every step is one his body
 * already damps.
 */
export function meadowMoundAt(x, z) {
  return moundProfile(x, z).height;
}

/**
 * Whether a point stands on a mound's own BANK: the outermost riser, the one
 * the eye meets, and the only place a mound is cut rather than grown.
 *
 * WHY THE FAMILY NEEDED THIS AND WHY A HEIGHT COULD NOT SAY IT. Bare earth used
 * to be «anywhere on a raised mass», and the mesher then kept whichever of those
 * faces happened to climb two voxels. On a crown, which is flat, that is never
 * the mound: it is the FIELD underneath -- the quantised terrain slopes, the
 * tuft steps -- borrowing the mound's permission for a wall it built itself.
 * Measured on the disc that is where nine bands in ten came from: 313 bands of
 * which 280 were one or two columns, sprinkled over the tops and the far sides
 * of masses, which is exactly the picket of sticks the fork's eye reported and
 * the exact opposite of the target's continuous bank.
 *
 * So the family is the BANK and not the mass: the outermost band of the flank,
 * which is the one riser the shape puts there on purpose. What the mesher does
 * with it is unchanged -- it still has to be steep and still has to face the
 * eye or the corridor -- but it can no longer be lent to the floor.
 */
export function moundBankAt(x, z) {
  return moundProfile(x, z).bank;
}

/** One evaluation of a mound at a point: how high it stands, and on what. */
function moundProfile(x, z) {
  const none = { height: 0, bank: false, halo: false };
  const seat = moundSeat(Math.floor(x / MOUND.cell), Math.floor(z / MOUND.cell));
  if (!seat) return none;
  const dx = x - seat.x;
  const dz = z - seat.z;
  // Stretched along its own bearing and squeezed across it: the same area, and
  // not a circle.
  const u = (dx * seat.c + dz * seat.s) / (1 + MOUND.lean);
  const w = (-dx * seat.s + dz * seat.c) * (1 + MOUND.lean);
  const d = Math.hypot(u, w);
  if (d >= seat.reach) return none;
  // Nothing grows on the way in, on the stone, or where a stone's own bank is
  // already doing this job -- and the test is on the SEAT and not on the point,
  // so a mass is either wholly there or wholly not and never sliced in half.
  for (const box of CLEAR) {
    if (toBlock(box, seat.x, seat.z) < seat.reach * (1 + MOUND.lean)) return none;
  }
  if (toStone(seat.x, seat.z).near < MOUND.band + seat.reach * (1 + MOUND.lean) * 0.4) return none;
  const flat = seat.reach * MOUND.plateau;
  if (d <= flat) {
    // The crown. Flat by default; the second terrace of answer B takes the
    // outer half of it and never the middle, so a crown is never a point.
    if (!MOUND.crownStep) return { height: seat.rise, bank: false, halo: true };
    return {
      height: d <= flat / 2 ? seat.rise : Math.max(1, seat.rise - MOUND.crownStep),
      bank: false,
      halo: true,
    };
  }
  // WHICH WAY THIS POINT LOOKS OUT, as a share: one due south, nought due
  // north. South is the eye -- the pose the campaign judges on stands at z 14
  // and looks north -- and it is the bearing the target banks its earth on.
  const out = Math.hypot(dx, dz) || 1;
  const southness = 0.5 * (1 + dz / out);
  // The first riser, which is the one the eye meets: the seat's whole scarp
  // where the mass faces the camera, one voxel where it faces away, and never
  // more than the mass is tall.
  const arc = southness >= 1 - MOUND.bankArc ? 1 : 0;
  const first = Math.min(seat.rise, Math.max(1, 1 + (MOUND.scarp - 1) * arc));
  // Everything above that first riser is spent one voxel at a time.
  const bands = 1 + (seat.rise - first);
  const t = (seat.reach - d) / (seat.reach - flat);
  const band = Math.min(bands - 1, Math.floor(t * bands));
  return { height: Math.min(seat.rise, first + band), bank: band === 0, halo: true };
}

/** Whether a point is on a mass, or inside the hem the floor leaves round one. */
function underMass(x, z) {
  const seat = moundSeat(Math.floor(x / MOUND.cell), Math.floor(z / MOUND.cell));
  if (seat) {
    const dx = x - seat.x;
    const dz = z - seat.z;
    const u = (dx * seat.c + dz * seat.s) / (1 + MOUND.lean);
    const w = (-dx * seat.s + dz * seat.c) * (1 + MOUND.lean);
    if (Math.hypot(u, w) < seat.reach + MOUND.halo) return true;
  }
  const { near, anchor } = toStone(x, z);
  return Boolean(anchor && near <= anchor.band + MOUND.halo);
}

/**
 * Whether the ground here is RAISED and of the kind that shows what it is made
 * of: a mound of the open meadow, or the bank under a boulder.
 *
 * The floor never is, however it steps: a one-voxel terrace in a meadow is a
 * meadow. Neither is a block's own bank, for the reason written over the blocks.
 */
export function bareRaisedAt(x, z) {
  if (moundBankAt(x, z)) return true;
  const { near, anchor } = toStone(x, z);
  return Boolean(anchor && anchor.bare && near >= 0 && near <= anchor.band);
}

/**
 * Whole voxels of meadow banked against the stone, and nought away from it.
 *
 * E-V4d, AS A PLACEMENT. It used to be a noise inside a band, which put a wall
 * three voxels tall at the band's own edge and speckled the rest; this ramps,
 * one voxel at a time, from the edge of the band up to the stone. How tall it
 * gets is the stone's own, drawn once from where the stone stands, so a block
 * has ONE bank and not a different one on each of its sides.
 */
export function moundAt(x, z) {
  const { near, anchor } = toStone(x, z);
  if (!anchor || near > anchor.band) return 0;
  // Under the stone the bank stays at its own top rather than falling away.
  // Nobody sees those columns -- the masonry is drawn over them -- but the
  // walker's own floor is read there, and a bank that dropped to nothing at the
  // footprint would put a six voxel cliff along every block in the world.
  if (near < 0) return anchor.peak;
  // Ramped and not piled: one voxel a terrace, from nothing at the band's own
  // edge up to the stone. What stood here before put a wall three voxels tall
  // at that edge, which is a thing no meadow does and no walker can climb.
  const t = 1 - near / anchor.band;
  return Math.min(anchor.peak, Math.max(1, Math.ceil(t * anchor.peak)));
}

// ======================================================================
// WHERE THE GROUND IS CUT AWAY, AND WHO IS ENTITLED TO SAY SO.
//
// The corridor is not this engine's. Where it runs, the ground belongs to the
// session that draws the paving, and the disc lays no column under it -- which
// is a fact the disc has to KNOW and has never been told. What it used a
// straight passage for instead: half a metre of run and one half width either
// side, which is a corridor drawn with a ruler over one that wanders.
//
// MEASURED, THAT APPROXIMATION LEAVES COLUMNS STANDING UNDER FULL STONE. The
// world's own answer is groundHoleAt in src/world/contracts.js -- pathHoleAt,
// which reaches out to 1.28 half widths and lives wherever there is any paving
// at all rather than only where there is half of it. Between the two predicates
// the disc lays 923 columns at the fourteen metres three tiers ship and 2 091 at
// thirty five, and 277 of the fourteen stand under paving that is fully opaque,
// up to 72 cm proud of the stone drawn over them (v1-suolo/misure/d4b-buco.json).
//
// AND THEY ARE NOT ALL INVISIBLE, WHICH IS MEASURED AND NOT ASSUMED. The 277
// under opaque stone are; the other 646 stand between 1.10 and 1.28 half widths,
// where the corridor's own surface is already fading, so what they were was a
// cubic kerb along both verges of the paving. Taking them out is seen: 2.64% of
// the frame at vox-giorno against a null control of 0.13%, nothing at all at
// picco-85, and the changed pixels are the two verges and nothing else
// (v1-suolo/misure/d4b-visibile.json, and the crops beside it).
//
// SO WHY IS IT A SEAT AND NOT AN IMPORT. Because the import is a ring: contracts
// reads columnTop from this file to answer for the walker's floor, and the path
// reads the contract. A mesher that imported the contract back would close it,
// and it would drag the corridor's whole file into the worker -- which is the
// one module graph in this world that is kept to arithmetic on purpose.
//
// So the engine keeps a SEAT and its own approximation sits in it until someone
// who can see the whole world says otherwise. That is setGroundDiscRadius's
// shape exactly, and it buys the same property: three arguments to meshChunk
// still lay bit for bit the disc they always laid, and what ships is what the
// page injected.

/**
 * The corridor's footprint, as a FORM and not as one pair of numbers.
 *
 * Both answers in this world have this shape -- some of the run, some of the
 * half width -- so the shape is written once and the numbers are the argument.
 * `pathRun` and `pathCoord` are the field's own, read and never copied.
 *
 * @param {number} run  how much paving there has to be at a northing to count
 * @param {number} coord  how many half widths off the centreline it reaches
 */
function corridorHole(run, coord) {
  return (x, z) => pathRun(z) > run && Math.abs(pathCoord(x, z)) < coord;
}

// The engine's own answer: a straight passage, and the only one it can give
// without being told. It is what sits in the seat below when nobody has spoken.
const PAVING = corridorHole(0.5, 1);

/** Whether a point stands on the paving, which is not voxel and never becomes one. */
export function onPaving(x, z) {
  return PAVING(x, z);
}

// Who answers for the hole. The engine's own approximation until it is told.
let groundHole = onPaving;

/**
 * Who says where the ground is cut away, told to the engine that lays no column
 * under it.
 *
 * AN ADDITION AND NOT A CHANGE OF DOOR. meshChunk, meshDisc, columnTop and
 * chunkList keep their names, their arguments and their meaning; a caller that
 * never comes here lays the disc this file has always laid.
 *
 * TWO ADMISSIBLE ARGUMENTS, AND THE SECOND ONE IS A THREAD.
 *
 *   A FUNCTION is the honest form and the one every caller that can reach the
 *   contract uses: src/world/layers/v1-suolo.js hands over groundHoleAt itself,
 *   so the disc and the walker's floor are one answer and not two that agree.
 *
 *   THE TWO NUMBERS exist because the disc is cut in a WORKER, and a worker is
 *   a module graph of its own that no function can be posted into. The corridor
 *   travels there as data -- exactly as the radius does -- and is rebuilt here,
 *   through the same pathRun and pathCoord the contract's own predicate calls.
 *   That reconstruction is a RE-STATEMENT and it is pinned rather than trusted:
 *   over every column of the disc, at all three radii the world can lay, it
 *   answers the contract's own groundHoleAt with ZERO disagreements
 *   (v1-suolo/misure/d4b-buco.json), and the day it stopped, the page would draw
 *   a different disc from the engine and the green gate in
 *   v1-suolo/analisi/quota-disegnata.mjs would say so.
 *
 * @param {Function|{run: number, coord: number}} hole  the predicate, or the
 *        corridor's two numbers for a thread that cannot be handed one
 * @returns {Function} what now sits in the seat
 */
export function setGroundHole(hole) {
  if (typeof hole === 'function') groundHole = hole;
  else if (hole && Number.isFinite(hole.run) && Number.isFinite(hole.coord)) {
    groundHole = corridorHole(hole.run, hole.coord);
  } else groundHole = onPaving;
  return groundHole;
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
// STEP PROUD OF THE FIELD. The tallest thing on this meadow is the bank against
// the stone, and a curtain that still only reached two would leave up to forty
// centimetres of daylight under any of it that happens to sit on the rim of the
// disc or on a bank of the paving. So the drop is that height plus the two that
// closed it before -- and it is read off the object rather than copied, because
// a number copied here is a number that stays behind when the shape moves.
//
// IT COSTS NOT ONE QUAD. A wall is a single rectangle whatever its height: what
// this buys is the height of four corners and nothing else. The overdraw is a
// strip along the rim and the two banks, behind ground that is already drawn.
const SKIRT = 2 + MOUND.bank.high;

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
 * WHAT `tuft` MEANS IS THE WHOLE CARPET AND NOT ONLY THE TUFT, and the name
 * is kept because it is the third argument of a door four other sessions call
 * through. False is the BARE voxelised ground -- the field rounded to the step
 * and nothing added -- which is what every reader of that flag has always
 * wanted it for: it is the baseline the carpet's own cost is read against, and
 * guard-ciuffo prints exactly that difference every run.
 */
export function columnTop(ix, iz, tuft = true, radius = DISC_RADIUS) {
  const { x, z } = columnCentre(ix, iz);
  if (Math.hypot(x - CENTRE.x, z - CENTRE.z) > radius) return EMPTY;
  // THE SEAT AND NOT THE APPROXIMATION, which is the whole of this line's
  // history: until somebody injects, the two are the same function.
  if (groundHole(x, z)) return EMPTY;
  if (insideBlock(x, z)) return EMPTY;
  const step = Math.round(heightAt(x, z) / VOXEL);
  if (!tuft) return step;
  // THE FLOOR FIRST AND THEN WHAT STANDS ON IT, in that order and as two
  // separate terms, because that is what the committente is looking at: the
  // field with the smooth tuft is the floor he calls «pianeggiante», and the
  // two after it are the masses he calls «alture sparse». Not one of the three
  // is a height drawn per column against its neighbours, which is the whole of
  // what he named as wrong.
  // THE TALLEST THING THAT CLAIMS A COLUMN, AND NOT THE SUM OF THEM. A mound
  // that reached into a bank used to ADD to it, which put a mass ten voxels
  // tall against a stone and a step the walker's body cannot damp beside it.
  // Neither term is a quantity of earth to be totalled: each one says how high
  // the ground stands here, and where two say it the answer is the higher.
  const mass = Math.max(moundAt(x, z), meadowMoundAt(x, z));
  // AND THE GRAIN STOPS AT THE HEM OF A MASS. See MOUND.halo: the tuft belongs
  // to the floor, the mass is set on the floor, and letting the one run over the
  // other is what turned a bank into a saw and a 0.30 m step into a 0.50 m one.
  const grain = underMass(x, z) || !tuftPatchAt(x, z) ? 0 : tuftAt(x, z);
  return step + grain + mass;
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
//
// SO WHERE DOES THE SECOND MATERIAL GO. The target's mounds show BARE EARTH on
// their steep flanks and grass on their crowns (E-DECISIONI4.3), which is a
// second family and not a second tint -- and a family per face is exactly the
// per-voxel property the rule above forbids putting in a vertex.
//
// IT GOES IN A SECOND MESH, and that is the cheapest honest place there is. The
// earth quads are gathered here, into their own three buffers -- corners, an
// orientation, an index, and nothing else, so the rule holds bit for bit -- and
// the page hangs the whole disc's worth of them as ONE mesh with the earth's
// own material. The cost is one draw call for the whole world and a merge that
// stops at the boundary between the two families, which is a boundary the
// picture has anyway.
//
// The alternative was a field the fragment could evaluate for itself, which
// costs no draw and cannot be exact: the mound field is thresholded, and a
// threshold decided in float64 on this thread and in float32 on the card
// disagrees on the columns that sit on it. Here the mesher decides once.

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

  // Which of the chunk's own columns stand on raised ground that shows what it
  // is made of, sampled once. The bearing is not in here: a column is on such a
  // mass or it is not, and WHICH of its four faces turns its bare side to the
  // picture is the bearing's own question, asked once per bearing below.
  const raised = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const { x, z } = columnCentre(ox + i, oz + j);
      raised[j * n + i] = bareRaisedAt(x, z) ? 1 : 0;
    }
  }

  const quads = [];
  // The same, for the faces that are bare earth rather than grass. Kept apart
  // from the first list all the way down so that neither family can merge into
  // the other, which is the whole of what makes them two families.
  const earth = [];
  // How many of the walls exist only because something ends here — the rim of
  // the disc, or a bank of the paving — rather than because the field stepped.
  // Counted apart because it is the one part of this number that does NOT scale
  // to the world: a disc of fourteen metres is nearly all edge and a world is
  // nearly all middle, so a fusion figure that mixed them would understate the
  // world it is being read as evidence for.
  let rim = 0;
  const push = (face, ax, ay, az, bx, by, bz, cx2, cy, cz2, dx, dy, dz, bare = false) => {
    (bare ? earth : quads).push(
      [face, ax, ay, az, bx, by, bz, cx2, cy, cz2, dx, dy, dz],
    );
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
    // Whether the wall this column raises toward this bearing is bare earth.
    //
    // THREE CONDITIONS AND EACH ONE IS A SENTENCE OF THE READING. It has to
    // stand on a mass -- the floor's own one-voxel terraces are meadow and stay
    // meadow. It has to be STEEP: a flank that climbs one voxel is a step in a
    // meadow, one that climbs `minStep` is a cut bank and shows what it is cut
    // into. And it has to FACE the eye or the corridor, which is where the
    // target shows its bare ground and nowhere else.
    const bare = (i, j, h, floor) => {
      if (raised[j * n + i] !== 1) return false;
      if (floor === EMPTY || h - floor < EARTH.minStep) return false;
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
        const bottom = floor === EMPTY ? -1e9 : floor;
        if (h <= bottom) { b++; continue; }
        const soil = bare(i, j, h, floor);
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
          // be one rectangle, and pretending otherwise is how a family becomes
          // a stripe. It is the only new thing that can split a merge here, and
          // what it costs is measured rather than assumed.
          if (bare(i2, j2, h2, f2) !== soil) break;
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
          push(face, x1, yLow, z0, x1, yTop, z0, x1, yTop, z1, x1, yLow, z1, soil);
        } else if (face === FACE.WEST) {
          push(face, x0, yLow, z1, x0, yTop, z1, x0, yTop, z0, x0, yLow, z0, soil);
        } else if (face === FACE.SOUTH) {
          push(face, x1, yLow, z1, x1, yTop, z1, x0, yTop, z1, x0, yLow, z1, soil);
        } else {
          push(face, x0, yLow, z0, x0, yTop, z0, x1, yTop, z0, x1, yLow, z0, soil);
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
    const nz = face === FACE.SOUTH ? 127 : face === FACE.NORTH ? -127 : 0;
    for (let v = 0; v < 4; v++) {
      const o = q * 12 + v * 3;
      positions[o] = it[1 + v * 3];
      positions[o + 1] = it[2 + v * 3];
      positions[o + 2] = it[3 + v * 3];
      normals[o] = nx;
      normals[o + 1] = 0;
      normals[o + 2] = nz;
    }
    for (let k = 0; k < 6; k++) indices[q * 6 + k] = q * 4 + QUAD_INDEX[k];
  }
  return { positions, normals, indices, quads: count };
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
