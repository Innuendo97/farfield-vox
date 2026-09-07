import { Quaternion, Vector3 } from 'three';
import { read, readJson, reporter, selfTest } from './lib.mjs';
import {
  AVATAR, EYE_TO_CROWN, GROUND_CLEARANCE, RIG, SWITCH, armFraction, armClear, bodyFade,
  reachEase, rigMetres, thirdPersonEye,
} from '../../src/core/avatar.js';
import { POSES, POSE_TARGET, POSE_TARGET_TERZA, POSE_VOX_DAY } from '../../src/core/poses.js';
import {
  AREA_CENTER, AREA_HARD_RADIUS, AREA_SOFT_RADIUS, EYE_HEIGHT,
} from '../../src/world/layout.js';
import { cameraSolids, groundHeightAt } from '../../src/world/contracts.js';
import {
  ROCK_PILES, RUINS, footOf, looseStoneSolids, pileField, pileSolids,
} from '../../src/world/rock-piles.js';
import { createLooseStone } from '../../src/world/loose-stone.js';
import { stoneSpecs } from '../../src/world/stone.js';
import { hillAt } from '../../assets-src/distant/cornice.mjs';
import MASONRY from '../../assets-src/monoliths/masonry-spec.json' with { type: 'json' };
import ROCK_PLAN from '../../assets-src/rocks/rocks.json' with { type: 'json' };
import { Player } from '../../src/core/player.js';
import { createDevPose } from '../../src/dev/pose.js';
import { VOXEL } from '../../src/world/voxel/pure.js';
import {
  CELLS, CYCLE, LIFT, PAINTS, STRIDE_METRES, SUBDIVISION, WALKS, bounds, paletteAt,
} from '../../src/world/avatar/plan.js';

// THE WALKER, HIS SCALE, HIS CAMERA AND HIS STEP, AGAINST THE PICTURE.
//
// WHAT THIS GUARD IS FOR. The figure is the one thing in this world that is both
// a MEASUREMENT and a MECHANISM: the two reference pictures say exactly how tall
// he is and exactly where the camera behind him stands, and four different files
// have to keep saying it -- the lattice he is built on, the rule the boom is
// written in, the pose the campaign photographs him at, and the walker who
// carries all three. Any one of them can be edited on its own and the framing
// goes quietly wrong by a dozen pixels, which is a dozen pixels nobody sees until
// the next paired crop.
//
// SO IT IS ASKED WHERE IT CAN BE ANSWERED EXACTLY. The whole of the framing is
// arithmetic -- a camera, a plane, and a list of boxes -- so the silhouette is
// PROJECTED here rather than photographed: crown row, sole row, width per row and
// the fraction of the frame he fills, computed from the same plan the mesher
// builds and the same rule the boom swings on. A screenshot would answer the same
// question with a tenth of the precision and a browser's worth of dependencies.
//
// THE PLANE IS y = 0 AND THAT IS DELIBERATE. The reference's own geometry is
// solved on it -- the feet of the blocks land there to 17 px rms, the paving and
// the verge are on an exact half metre grid, and the figure's sole row
// back-projects onto it at (-0.26, 9.27). What the terrain of any one branch
// happens to do at that point is a fact about that branch's ground session, not
// about the figure, and it is REPORTED rather than asserted: see the note at the
// end, which is how the coordinator finds out that a tree is carrying a dip the
// foundation has since levelled.
//
// AND THE CAMERA IS WALKED ROUND EVERY BLOCK. R7 photographed a walker with his
// back to the first monolith and found the lens inside the masonry -- a block is
// five metres wide and the arm is five metres long, so it was never a corner
// case. Sixteen bearings, three distances and three aims around each of the six
// blocks and each of the rocks is 1,728 placements, and it takes milliseconds,
// which is the argument for doing it exhaustively instead of at three poses
// somebody chose.
//
// AND THE LIST IS NOW CHECKED AGAINST THE STONE, WHICH IS THE HALF THAT WAS
// MISSING. Everything above asks whether the CAMERA respects the list of solids;
// none of it asks whether the LIST is the world. It was not: the boxes came off
// the rock plan's `y` and `meshHeight`, which belong to a mesh this branch does
// not draw, and one of them stood entirely in the air over the stone it named
// (E-INT-V8). So the first section below walks every cell the pile mesher fills
// and every vertex the loose stone mesh carries, and asks each one whether the
// camera's list contains it. That is exact and it is not an opinion: the cells
// come out of pileField and the vertices out of createLooseStone, which are the
// two functions the triangles themselves come out of.
//
// AND THE WALKER IS TAKEN TO THE RIM. The ring above is the middle of the hub;
// what U-CORNICE-1 put outside it is a plateau that FALLS at 35 m and hills of
// real cubes beyond that, so the other worst case for a five metre boom is a
// walker standing on the edge of the world with his back to the drop. That one
// is swept too, at every bearing and at seven aims, against the field's own
// ground contract and against the hills' own law.

const DEG = Math.PI / 180;
const FRAME = { width: 1672, height: 941 };
const PITCH_LIMIT = 85 * DEG;

// ------------------------------------------------------------- what the picture says
//
// Every one of these is a reading of the day target, quoted where it was taken.
// The crown and sole rows are the analysis unit's, measured with the campaign's
// own tint rule; the columns and the width at 0.35 H are R7's; the fraction is
// the span between the two rows over the height of the frame.
const TARGET = {
  crown: 575,      // row of the top of the head
  sole: 934,       // row where the soles meet the plane
  fraction: 0.3815,
  uFeet: 0.3986,
  wideAt35: 132,   // px, on the row 0.35 H below the crown
  widest: 152,     // px, columns 596..748
  cellPx: 6,       // the figure's own step, read on the pack
};
const TOLL = {
  crown: 6, sole: 6, fraction: 0.010, uFeet: 0.006, wideAt35: 7, widest: 8, cellPx: 1,
};

/** Where the day picture draws his feet, on the plane the blocks stand on. */
const FEET = { x: POSE_TARGET_TERZA.position.x, z: POSE_TARGET_TERZA.position.z, ground: 0 };

// ------------------------------------------------------------------- projection
//
// The same convention as v0-fondazione/luce/geom.mjs, kept identical on purpose:
// this is the projection every fit in this campaign was solved through.
function makeProject(pose, frame = FRAME) {
  const aspect = frame.width / frame.height;
  const tanV = Math.tan((pose.fov * DEG) / 2);
  const tanH = tanV * aspect;
  const cp = Math.cos(pose.pitch * DEG);
  const sp = Math.sin(pose.pitch * DEG);
  const cy = Math.cos(pose.yaw * DEG);
  const sy = Math.sin(pose.yaw * DEG);
  return function project(p) {
    const dx = p.x - pose.position.x;
    const dy = p.y - pose.position.y;
    const dz = p.z - pose.position.z;
    const x1 = dx * cy - dz * sy;
    const z1 = dx * sy + dz * cy;
    const y2 = dy * cp + z1 * sp;
    const z2 = -dy * sp + z1 * cp;
    if (z2 >= -1e-6) return null;
    return {
      px: ((x1 / (-z2) / tanH + 1) / 2) * frame.width - 0.5,
      py: ((1 - y2 / (-z2) / tanV) / 2) * frame.height - 0.5,
    };
  };
}

/**
 * The figure's outline in pixels, standing where the picture draws him.
 *
 * ONLY THE SHELL IS WALKED. A cell with six filled neighbours cannot touch the
 * outline, and skipping it takes the lattice from nine thousand tests to three.
 * Each surviving cell is projected by its eight corners and its bounding box is
 * marked -- which over-states a single cell by under a pixel and can never
 * under-state it, so an outline read this way is never narrower than the body is.
 */
function silhouette(body, { pose = POSE_VOX_DAY, feet = FEET, cell = VOXEL / SUBDIVISION } = {}) {
  const project = makeProject(pose);
  const s = Math.sin(pose.yaw * DEG);
  const c = Math.cos(pose.yaw * DEG);
  const bb = bounds(body);
  const rows = new Map();
  for (let j = bb.y0; j <= bb.y1; j++) {
    for (let k = bb.z0; k <= bb.z1; k++) {
      for (let i = bb.x0; i <= bb.x1; i++) {
        if (paletteAt(i, j, k, body) < 0) continue;
        if (paletteAt(i - 1, j, k, body) >= 0 && paletteAt(i + 1, j, k, body) >= 0
          && paletteAt(i, j - 1, k, body) >= 0 && paletteAt(i, j + 1, k, body) >= 0
          && paletteAt(i, j, k - 1, body) >= 0 && paletteAt(i, j, k + 1, body) >= 0) continue;
        let px0 = Infinity; let px1 = -Infinity; let py0 = Infinity; let py1 = -Infinity;
        for (let a = 0; a < 8; a++) {
          const lx = (i + (a & 1)) * cell;
          const ly = (j + ((a >> 1) & 1)) * cell;
          const lz = (k + ((a >> 2) & 1)) * cell;
          const q = project({
            x: feet.x + lx * c + lz * s,
            y: feet.ground + ly,
            z: feet.z - lx * s + lz * c,
          });
          if (!q) return null;
          if (q.px < px0) px0 = q.px;
          if (q.px > px1) px1 = q.px;
          if (q.py < py0) py0 = q.py;
          if (q.py > py1) py1 = q.py;
        }
        for (let y = Math.floor(py0); y <= Math.ceil(py1); y++) {
          const r = rows.get(y) || { lo: Infinity, hi: -Infinity };
          if (px0 < r.lo) r.lo = px0;
          if (px1 > r.hi) r.hi = px1;
          rows.set(y, r);
        }
      }
    }
  }
  const ys = [...rows.keys()].sort((a, b) => a - b);
  const list = ys.map((y) => ({ y, ...rows.get(y), w: rows.get(y).hi - rows.get(y).lo + 1 }));
  // THE SOLE ROW IS THE PLANE'S AND NOT THE OUTLINE'S, which is the one place
  // this could compare two different things. The picture's 934 is where the feet
  // MEET THE GROUND -- it was got by back-projecting the sole pixel onto y = 0 --
  // while the outline runs on to 940 because the toe of the boot sticks out
  // towards the camera and lands lower in the frame. Both are reported; the
  // assertion is on the pair that mean the same thing.
  const sole = project({ x: feet.x, y: feet.ground, z: feet.z }).py;
  const crown = list[0].y;
  const H = sole - crown;
  const at = (f) => list.find((r) => r.y === Math.round(crown + f * H));
  const foot = list.filter((r) => r.y > list[list.length - 1].y - 0.03 * H);
  return {
    crown,
    sole,
    outlineBottom: list[list.length - 1].y,
    heightPx: H,
    fraction: H / FRAME.height,
    uFeet: (foot.reduce((a, r) => a + (r.lo + r.hi) / 2, 0) / foot.length + 0.5) / FRAME.width,
    widest: Math.max(...list.map((r) => r.w)),
    wideAt35: at(0.35).w,
    cols: [Math.min(...list.map((r) => r.lo)), Math.max(...list.map((r) => r.hi))],
  };
}

/** How many pixels one of the figure's own cells spans, at his distance. */
function cellPixels(pose = POSE_VOX_DAY, feet = FEET) {
  const project = makeProject(pose);
  const a = project({ x: feet.x, y: feet.ground, z: feet.z });
  const b = project({ x: feet.x, y: feet.ground + 1, z: feet.z });
  return (a.py - b.py) * (VOXEL / SUBDIVISION);
}

// ------------------------------------------------------------ the imposed pose
//
// THE ONE THING THIS GUARD COULD NOT ASK BEFORE: what does the camera actually
// READ after a pose is imposed on it. Every measurement in this campaign and
// every plate the committente is shown is taken at a pose set from outside the
// page, and until U-AVATAR-2 there were two doors to it that disagreed by five
// metres in third person -- so the plates of U-LUCE-4 were of a camera nobody
// had asked for (E-LUCE5). The fix is a single seat, src/dev/pose.js, and a fix
// nothing measures is a fix that comes undone.
//
// SO THE SEAT IS RUN, NOT READ. The walker is the page's own Player, the pose is
// the page's own POSE_TARGET, and the camera is a real quaternion: what comes
// back is the six numbers a screenshot would have been taken at. A text scan
// would have told us the file says 'prima' somewhere, which is not the same
// question.

/** A camera with nothing in it but the three things a pose writes. */
function benchCamera() {
  return {
    position: new Vector3(),
    quaternion: new Quaternion(),
    fov: 0,
    projections: 0,
    updateProjectionMatrix() { this.projections++; },
  };
}

/**
 * The seat, driven once, from whichever person the walker was standing in.
 *
 * @param {string} from  the person to start in, so that 'always first' is a
 *                       claim about the door and not about the initial state
 */
function imposed(pose, from = 'terza') {
  const player = new Player();
  const camera = benchCamera();
  let dismissed = 0;
  const seat = createDevPose({ player, camera, veil: { dismiss() { dismissed++; } } });
  player.placePerson(from);
  const read = seat.place(pose);
  return {
    read, dismissed, person: player.person, camera,
  };
}

// ------------------------------------------------------ the camera against the stone

/** Is a point inside a box, allowing it to come within `pad` of the surface? */
function inside(p, b, pad = 0) {
  const s = Math.sin(b.rotationY);
  const c = Math.cos(b.rotationY);
  const dx = p.x - b.x;
  const dz = p.z - b.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) < b.halfWidth - pad
    && Math.abs(lz) < b.halfDepth - pad
    && p.y > b.y0 - pad && p.y < b.y1 + pad;
}

// ----------------------------------------------- the list against the stone
//
// EVERY CELL AND EVERY VERTEX, ASKED OF THE LIST. Not a sample and not a shape
// argument: the piles hand back the field of cells the mesher walks, the loose
// stone hands back the buffer the triangles are drawn from, and each corner of
// each of them is asked whether the camera's list contains it. A box that has
// drifted off its stone by a millimetre answers no.

/**
 * Is a point inside a box, corners counted as in?
 *
 * THE SLACK IS THE BUFFER'S AND NOT A TOLERANCE ON THE ANSWER. A cell of the
 * lattice is asked in doubles and closes exactly; a vertex of the loose stone
 * comes back out of a Float32Array, where 4.29 is 4.2899999618530273, so a
 * corner that lies ON a face of its own box reads half a micron outside it. A
 * tenth of a millimetre absorbs that and nothing else: the holes this section
 * exists to catch are four hundred millimetres deep.
 */
function within(p, b, slack = 1e-9) {
  const s = Math.sin(b.rotationY);
  const c = Math.cos(b.rotationY);
  const dx = p.x - b.x;
  const dz = p.z - b.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= b.halfWidth + slack && Math.abs(lz) <= b.halfDepth + slack
    && p.y >= b.y0 - slack && p.y <= b.y1 + slack;
}

/** What a Float32 vertex is allowed to be out by, in metres. */
const BUFFER_SLACK = 1e-4;

/**
 * How much of the piles the given list of boxes fails to contain.
 *
 * Every corner of every solid cell, which for a lattice is the whole of the
 * question: a box that contains the eight corners of an axis aligned cell
 * contains the cell.
 */
function pilesOutside(boxes) {
  let cells = 0;
  let outside = 0;
  let worst = null;
  for (const rock of ROCK_PILES) {
    const foot = footOf(rock);
    const field = pileField(rock, foot);
    const { wide, tall, at, origin } = field;
    for (let j = 0; j < tall; j++) {
      for (let k = 0; k < wide; k++) {
        for (let i = 0; i < wide; i++) {
          if (field.cells[at(i, j, k)] === 255) continue;
          cells++;
          for (let corner = 0; corner < 8; corner++) {
            const q = {
              x: (origin.x + i + (corner & 1)) * VOXEL,
              y: (origin.y + j + ((corner >> 1) & 1)) * VOXEL,
              z: (origin.z + k + ((corner >> 2) & 1)) * VOXEL,
            };
            if (boxes.some((b) => within(q, b))) continue;
            outside++;
            if (!worst) worst = { rock: rock.name, i, j, k, ...q };
            break;
          }
        }
      }
    }
  }
  return { cells, outside, worst };
}

/**
 * The loose stone the same way, off the buffer the page actually draws.
 *
 * THE TURF ON THE SIX IS SKIPPED BY COUNT AND NOT BY GUESS. createLooseStone
 * lays the heads first, then the ruins, then the basin, and reports how many
 * cubes went into each; a cube is twenty vertices, so the boundary between the
 * turf and the rest is arithmetic. The turf is declared out of the camera's list
 * -- those lids stand five to thirteen metres up, inside the block's own box --
 * and what is left has to be in it.
 */
function looseOutside(boxes) {
  const built = createLooseStone(stoneSpecs(MASONRY));
  const position = built.mesh.geometry.attributes.position;
  const first = built.counts.turf * 20;
  let checked = 0;
  let outside = 0;
  let worst = null;
  for (let v = first; v < position.count; v++) {
    const q = { x: position.getX(v), y: position.getY(v), z: position.getZ(v) };
    checked++;
    if (boxes.some((b) => within(q, b, BUFFER_SLACK))) continue;
    outside++;
    if (!worst) worst = { vertex: v, ...q };
  }
  return {
    checked, outside, worst, turf: first, counts: built.counts,
  };
}

/**
 * A full turn round one box at one distance and one aim, in sixteen bearings.
 *
 * The walker stands off the box's centre by its own half-diagonal plus the
 * distance asked for, so "half a metre away" means half a metre of clear ground
 * whatever the block's shape and whichever way it is turned.
 */
function ring(box, distance, pitch, steps = 16) {
  const out = [];
  const reach = Math.hypot(box.halfWidth, box.halfDepth) + distance;
  const solids = cameraSolids();
  const eye = {};
  for (let i = 0; i < steps; i++) {
    const bearing = (i / steps) * Math.PI * 2;
    const x = box.x + Math.sin(bearing) * reach;
    const z = box.z + Math.cos(bearing) * reach;
    // A SPOT NO WALKER COULD STAND ON IS NOT A CASE. Sixteen bearings round one
    // block will sometimes land inside ANOTHER -- the hub has six of them and
    // they are two metres apart in places -- and the walker's own footprints
    // stop a body getting there. Asking the camera to be outside every solid
    // while its pivot is inside one is asking for an answer that does not exist,
    // and it would hide the cases that do.
    const pivot = { x, y: groundHeightAt(x, z) + EYE_HEIGHT, z };
    if (solids.some((b) => inside(pivot, b, 0.01))) { out.push(null); continue; }
    // Facing the block, which is the case that puts the camera behind him and
    // therefore into it.
    const yaw = bearing + Math.PI;
    thirdPersonEye(eye, { x, z, stance: pivot.y - EYE_HEIGHT, yaw }, pitch, PITCH_LIMIT,
      groundHeightAt, AVATAR.height, { reach: 1, solids, eyeHeight: EYE_HEIGHT });
    out.push({ x: eye.x, y: eye.y, z: eye.z, arm: eye.arm, pivot });
  }
  return out;
}

// -------------------------------------------------------------- the rim
//
// THE OTHER WORST CASE FOR A FIVE METRE BOOM. The ring above walks the camera
// round the furniture in the middle of the hub; this walks the WALKER to the
// edge of the world and turns him all the way round at every aim the look
// allows. Two things can go wrong out there and neither is a solid: the plateau
// FALLS beyond 35 m, so a camera swung outward is over a slope and the ground
// clamp has to catch it against the field's own contract; and U-CORNICE-1 put
// hills of real cubes past that, which are not in cameraSolids and never will
// be -- they are a law and not a list -- so the distance to them is a
// measurement this guard has to take rather than a fact it may assume.

/** The horizon's own law, read from the spec that ships with it. */
const CORNICE = readJson('assets-src/distant/cornice.json');

/**
 * The walker taken to the edge and turned round, at every aim.
 *
 * The radii are his own perimeter's: AREA_SOFT_RADIUS is where the recall
 * begins to curve him back and AREA_HARD_RADIUS is where it stops him, and one
 * metre past the hard radius is there because a soft stop is asymptotic and a
 * guard should stand outside the place it is guarding.
 */
function rimSweep(bearings = 32, yaws = 16) {
  const pitches = [0, 30, -30, 60, -60, 85, -85].map((d) => d * DEG);
  const solids = cameraSolids();
  const eye = {};
  let placements = 0;
  let underground = 0;
  let inHill = 0;
  let lowest = Infinity;
  let nearestHill = Infinity;
  let deepest = null;
  for (const radius of [AREA_SOFT_RADIUS, AREA_HARD_RADIUS, AREA_HARD_RADIUS + 1]) {
    for (let b = 0; b < bearings; b++) {
      const bearing = (b / bearings) * Math.PI * 2;
      const x = AREA_CENTER.x + Math.sin(bearing) * radius;
      const z = AREA_CENTER.z + Math.cos(bearing) * radius;
      const stance = groundHeightAt(x, z);
      for (let a = 0; a < yaws; a++) {
        const yaw = (a / yaws) * Math.PI * 2;
        for (const pitch of pitches) {
          thirdPersonEye(eye, { x, z, stance, yaw }, pitch, PITCH_LIMIT, groundHeightAt,
            AVATAR.height, { reach: 1, solids, eyeHeight: EYE_HEIGHT });
          placements++;
          const floor = groundHeightAt(eye.x, eye.z);
          const margin = eye.y - floor;
          if (margin < lowest) { lowest = margin; deepest = { x: eye.x, y: eye.y, z: eye.z, floor }; }
          if (margin < -1e-9) underground++;
          // The hills: their own surface at the camera's own place, which is the
          // only honest way to ask whether a lens is inside one.
          const hill = hillAt(CORNICE, eye.x, eye.z);
          if (eye.y < hill.y - 1e-9) inHill++;
          const clear = eye.y - hill.y;
          if (clear < nearestHill) nearestHill = clear;
        }
      }
    }
  }
  return {
    placements, underground, inHill, lowest, nearestHill, deepest,
  };
}

// ------------------------------------------------------------------ the switch

/** The whole run of the switch at a frame rate, as the camera actually moves. */
function switchRun(fps = 60, seconds = 0.6) {
  const solids = cameraSolids();
  const x = 0;
  const z = 6;
  const stance = groundHeightAt(x, z);
  const eye = {};
  const out = [];
  const dt = 1 / fps;
  for (let n = 0; n * dt <= seconds; n++) {
    const t = Math.min(1, (n * dt) / SWITCH.seconds);
    const reach = reachEase(t);
    if (reach > 0) {
      thirdPersonEye(eye, { x, z, stance, yaw: 0 }, 0, PITCH_LIMIT, groundHeightAt,
        AVATAR.height, { reach, solids, eyeHeight: EYE_HEIGHT });
    } else {
      eye.x = x; eye.y = stance + EYE_HEIGHT; eye.z = z; eye.arm = 0;
    }
    out.push({ t: n * dt, reach, x: eye.x, y: eye.y, z: eye.z, arm: eye.arm });
  }
  return out;
}

// -------------------------------------------------------------------- the step

/** Does the union the palette is generated from answer for every pose's cells? */
function paletteAgrees(kind) {
  const paint = PAINTS[kind];
  for (let n = 0; n < WALKS[kind].length; n++) {
    const plan = WALKS[kind][n];
    const bb = bounds(plan);
    for (let j = bb.y0; j <= bb.y1; j++) {
      for (let k = bb.z0; k <= bb.z1; k++) {
        for (let i = bb.x0; i <= bb.x1; i++) {
          const mine = paletteAt(i, j, k, plan);
          if (mine < 0) continue;
          if (paletteAt(i, j, k, paint, n) !== mine) return { n, i, j, k, mine };
        }
      }
    }
  }
  return null;
}

/**
 * How high the layer stands him when he is not walking.
 *
 * THE PASSING LATTICE IS THE RIGHT SHAPE AT REST AND THE WRONG RISE. Feet
 * together and arms down is what a body standing still looks like, but it is a
 * frame of a WALK and a walk rises through it -- spent whole it leaves him
 * hovering a cell over the turf for as long as nobody moves. The layer is read
 * rather than trusted, because the two live one line apart.
 */
function restingLift() {
  const text = read('src/world/layers/v8-avatar.js');
  const idle = /speed < 0\.15\)\s*\{[\s\S]*?\}/.exec(text);
  if (!idle) return NaN;
  const set = /layer\.lift = ([^;]+);/.exec(idle[0]);
  return set ? Number(set[1]) : NaN;
}

// --------------------------------------------------------------------- the run

if (process.argv.includes('--self')) {
  const solids = cameraSolids();
  const eye = {};
  const block = solids[0];
  // A camera with the collision taken out of it, which is the world as R7 found
  // it: the arm at full length whatever is in the way.
  const naked = (from, yaw) => {
    thirdPersonEye(eye, { ...from, yaw }, 0, PITCH_LIMIT, groundHeightAt, AVATAR.height,
      { reach: 1, solids: [], eyeHeight: EYE_HEIGHT });
    return { x: eye.x, y: eye.y, z: eye.z };
  };
  // Standing just in front of the first block with his back to it.
  const bearing = 0;
  const reachOut = Math.hypot(block.halfWidth, block.halfDepth) + 0.5;
  const spot = {
    x: block.x + Math.sin(bearing) * reachOut,
    z: block.z + Math.cos(bearing) * reachOut,
  };
  spot.stance = groundHeightAt(spot.x, spot.z);
  const withCollision = ring(block, 0.5, 0).find(Boolean);
  const without = naked(spot, bearing + Math.PI);

  const shortPlan = [{ ...WALKS.m[0][0], z0: WALKS.m[0][0].z0 - 99 }];

  selfTest('guard-avatar', [
    {
      what: 'an arm let through a monolith is caught',
      caught: armClear({ x: spot.x, y: spot.stance + EYE_HEIGHT, z: spot.z }, without, solids, 0) < 1
        && armClear(withCollision.pivot, withCollision, solids, 0) >= 1 - 1e-9,
    },
    {
      what: 'a figure at the wrong height misses the crown row',
      caught: Math.abs(
        silhouette(WALKS.m[1], { feet: FEET, cell: (VOXEL / SUBDIVISION) * 1.2 }).crown
        - TARGET.crown,
      ) > TOLL.crown,
    },
    {
      what: 'a rounded rule misses the fitted camera',
      caught: (() => {
        const rounded = { planar: 3.30 * AVATAR.height, lateral: 0.48 * AVATAR.height };
        const behind = Math.sqrt(rounded.planar ** 2 - rounded.lateral ** 2);
        const s = Math.sin(POSE_VOX_DAY.yaw * DEG);
        const c = Math.cos(POSE_VOX_DAY.yaw * DEG);
        const x = FEET.x + behind * -s * -1 + rounded.lateral * c;
        const z = FEET.z + behind * -c * -1 + rounded.lateral * -s;
        return Math.hypot(x - POSE_VOX_DAY.position.x, z - POSE_VOX_DAY.position.z) > 0.001;
      })(),
    },
    {
      what: 'a switch that never arrives is caught',
      caught: (() => {
        const chase = (t) => 1 - Math.exp(-t / 0.12);
        return chase(1) !== 1 && reachEase(1) === 1;
      })(),
    },
    {
      what: 'a palette that does not answer for a pose is caught',
      caught: paletteAt(shortPlan[0].x0, shortPlan[0].y0, shortPlan[0].z0, shortPlan) >= 0
        && paletteAt(shortPlan[0].x0, shortPlan[0].y0, shortPlan[0].z0, PAINTS.m) < 0,
    },
    {
      what: 'a body that sinks at a passing frame is caught',
      caught: [0, -1, 0, 1].some((v) => v < 0) && !LIFT.some((v) => v < 0),
    },
    {
      // THE DEFECT E-INT-V8 NAMED, INJECTED BACK. These are the boxes this seat
      // published until U-AVATAR-2: the rock plan filtered at 0.45 m, with the
      // vertical extent taken from the smooth mesh's own `y` and `meshHeight`.
      what: "the camera's old boxes, off the rock plan's mesh fields, leave stone outside them",
      caught: (() => {
        const old = ROCK_PLAN.rocks
          .filter((rock) => rock.radius >= 0.45)
          .map((rock) => ({
            name: rock.name,
            x: rock.x,
            z: rock.z,
            halfWidth: rock.radius * 0.72,
            halfDepth: rock.radius * 0.72,
            rotationY: 0,
            y0: rock.y,
            y1: rock.y + (rock.meshHeight ?? rock.height),
          }));
        return pilesOutside(old).outside > 0 && pilesOutside(cameraSolids()).outside === 0;
      })(),
    },
    {
      // And the same mistake in the other file: a ruin boxed from the PLAN's own
      // width, depth and height rather than from the cut, which rounds up.
      what: "a ruin boxed from its plan instead of its cut leaves cubes outside it",
      caught: (() => {
        const planned = RUINS.map((r) => ({
          name: r.name,
          x: r.x,
          z: r.z,
          halfWidth: r.width / 2,
          halfDepth: r.depth / 2,
          rotationY: 0,
          y0: 0,
          y1: r.height,
        }));
        return looseOutside(planned).outside > 0
          && looseOutside(cameraSolids()).outside === 0;
      })(),
    },
    {
      // The over-claim, which is the mistake the other direction: one box over
      // the whole ring fills the mirror of water the ring is there to hold.
      what: 'one box over the whole basin claims the pool, and is caught',
      caught: (() => {
        const ring = looseStoneSolids().filter((b) => String(b.name).startsWith('vasca'));
        if (!ring.length) return false;
        let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
        let mid = { x: 0, z: 0 };
        for (const b of ring) {
          x0 = Math.min(x0, b.x - b.halfWidth); x1 = Math.max(x1, b.x + b.halfWidth);
          z0 = Math.min(z0, b.z - b.halfDepth); z1 = Math.max(z1, b.z + b.halfDepth);
          mid.x += b.x; mid.z += b.z;
        }
        mid = { x: mid.x / ring.length, y: 0.05, z: mid.z / ring.length };
        const lump = {
          name: 'vasca intera',
          x: (x0 + x1) / 2,
          z: (z0 + z1) / 2,
          halfWidth: (x1 - x0) / 2,
          halfDepth: (z1 - z0) / 2,
          rotationY: 0,
          y0: 0,
          y1: 0.4,
        };
        return within(mid, lump) && !ring.some((b) => within(mid, b));
      })(),
    },
    {
      // THE DEFECT E-LUCE5 FOUND IN THE PLATES OF U-LUCE-4, injected back. The
      // old door set the pose and left the person alone: asked for the day fit
      // while the walker happened to be in third, it stood the WALKER on the
      // fitted camera's own spot and swung the lens five metres astern of it.
      // Every plate taken that way is of a camera nobody asked for.
      what: 'a pose set without the person leaves the lens five metres off the fit',
      caught: (() => {
        const player = new Player();
        const camera = benchCamera();
        player.placePerson('terza');
        player.setPose(POSE_TARGET);
        camera.fov = POSE_TARGET.fov;
        player.applyTo(camera);
        const off = Math.hypot(
          camera.position.x - POSE_TARGET.position.x,
          camera.position.y - POSE_TARGET.position.y,
          camera.position.z - POSE_TARGET.position.z,
        );
        return off > 1 && imposed(POSE_TARGET).read.miss.metres <= 0.001;
      })(),
    },
    {
      what: 'a pose that leaves the arrival veil up is caught',
      caught: (() => {
        const player = new Player();
        const camera = benchCamera();
        let dismissed = 0;
        const deaf = createDevPose({ player, camera, veil: null });
        deaf.place(POSE_TARGET);
        const heard = createDevPose({
          player: new Player(), camera: benchCamera(), veil: { dismiss() { dismissed++; } },
        });
        heard.place(POSE_TARGET);
        return dismissed === 1 && imposed(POSE_TARGET).dismissed === 1;
      })(),
    },
    {
      // D-AVATAR-2 = A, injected: a rigid boom at the steepest look.
      what: 'a boom that does not shorten with the look swings under the ground',
      caught: (() => {
        const rigid = {};
        const x = AREA_CENTER.x;
        const z = AREA_CENTER.z + AREA_HARD_RADIUS;
        const stance = groundHeightAt(x, z);
        // No limit, so armFraction hands back the whole arm at every aim: the
        // world as it would be with D-AVATAR-2 answered the other way. And no
        // ground either, because the clamp is the OTHER guard -- what is being
        // injected here is the boom, and a boom that has to be rescued by a
        // floor every time the walker looks up is a boom that drags the camera
        // along the turf and loses the framing.
        thirdPersonEye(rigid, { x, z, stance, yaw: 0 }, 80 * DEG, 0, null, AVATAR.height,
          { reach: 1, solids: [], eyeHeight: EYE_HEIGHT });
        const kept = {};
        thirdPersonEye(kept, { x, z, stance, yaw: 0 }, 80 * DEG, PITCH_LIMIT, null,
          AVATAR.height, { reach: 1, solids: [], eyeHeight: EYE_HEIGHT });
        return rigid.y < groundHeightAt(rigid.x, rigid.z)
          && kept.y >= groundHeightAt(kept.x, kept.z) - 1e-9;
      })(),
    },
    {
      what: 'a pile dropped out of the list is caught',
      caught: pileSolids(ROCK_PILES.slice(1)).length !== ROCK_PILES.length
        && pileSolids().length === ROCK_PILES.length,
    },
  ]);
}

const report = reporter('guard-avatar -- the figure, his camera, and his step');

// ------------------------------------------------------------------ the lattice
const cell = VOXEL / SUBDIVISION;
report.check(Math.abs(CELLS * cell - AVATAR.height) < 1e-12,
  'the lattice is the height, exactly', `${CELLS} x ${cell} = ${(CELLS * cell).toFixed(4)} m`);
report.check(Math.abs(AVATAR.worldCells * VOXEL - AVATAR.height) < 1e-12,
  "and closes on the world's own grid too", `${AVATAR.worldCells} x ${VOXEL} m`);
report.check(Number.isInteger(SUBDIVISION) && SUBDIVISION > 0,
  "his cell is a whole subdivision of the world's", `1/${SUBDIVISION}`);

const px = cellPixels();
report.check(Math.abs(px - TARGET.cellPx) <= TOLL.cellPx,
  `one of his cells reads ${TARGET.cellPx} +-${TOLL.cellPx} px at the fitted framing`,
  `${px.toFixed(2)} px`);

// -------------------------------------------------------------- the two heights
report.check(AVATAR.height === 1.50, 'the body is 1.50 m in third person',
  `${AVATAR.height} m`);
report.check(EYE_HEIGHT === 1.70, 'the eye is 1.70 m in first', `${EYE_HEIGHT} m`);
report.check(Math.abs(EYE_TO_CROWN - (EYE_HEIGHT - AVATAR.height)) < 1e-12,
  'and the seam between them is stated rather than assumed',
  `${EYE_TO_CROWN.toFixed(2)} m of crown below the eye`);

// ------------------------------------------------------------------ the framing
//
// AND THE RULE'S RESTING AIM IS THE FIT'S OWN, NOT A NUMBER THAT LOOKS LIKE IT.
// RIG.pitch and RIG.fov are written into src/core/avatar.js as literals, and
// they are the day fit's -- the offsets above were measured against that camera,
// so an aim that drifted from it by a tenth of a degree would swing the boom in
// the one place the whole campaign is judged. Two copies of one number is where
// this campaign has already lost a pose once (POSE_TARGET, E-SENT6), so the
// copies are checked rather than trusted.
const rig = rigMetres(AVATAR.height);
report.check(RIG.pitch === POSE_VOX_DAY.pitch,
  "the boom's resting aim is the day fit's aim, to the bit",
  `${RIG.pitch} deg against the pose's ${POSE_VOX_DAY.pitch}`);
report.check(RIG.fov === POSE_VOX_DAY.fov,
  'and third person looks through the same lens the fit solved for',
  `${RIG.fov} against ${POSE_VOX_DAY.fov}`);
const placed = {};
thirdPersonEye(placed, { x: FEET.x, z: FEET.z, stance: 0, yaw: POSE_VOX_DAY.yaw * DEG },
  POSE_VOX_DAY.pitch * DEG, PITCH_LIMIT, null, AVATAR.height,
  { reach: 1, solids: [], eyeHeight: EYE_HEIGHT });
const miss = Math.hypot(
  placed.x - POSE_VOX_DAY.position.x,
  placed.y - POSE_VOX_DAY.position.y,
  placed.z - POSE_VOX_DAY.position.z,
);
report.check(miss < 0.001,
  'the rule puts the camera on the fitted framing, from the feet the picture draws',
  `${(miss * 1000).toFixed(2)} mm out`);

for (const kind of Object.keys(WALKS)) {
  const s = silhouette(WALKS[kind][1]);
  const tag = kind === 'm' ? 'corpo M' : 'corpo F';
  if (kind === 'm') {
    report.check(Math.abs(s.crown - TARGET.crown) <= TOLL.crown,
      `${tag}: crown row ${TARGET.crown} +-${TOLL.crown}`, `${s.crown}`);
    report.check(Math.abs(s.sole - TARGET.sole) <= TOLL.sole,
      `${tag}: soles on the plane at row ${TARGET.sole} +-${TOLL.sole}`, `${s.sole.toFixed(1)}`);
    report.check(Math.abs(s.fraction - TARGET.fraction) <= TOLL.fraction,
      `${tag}: fills ${TARGET.fraction} +-${TOLL.fraction} of the frame`, `${s.fraction.toFixed(4)}`);
    report.check(Math.abs(s.uFeet - TARGET.uFeet) <= TOLL.uFeet,
      `${tag}: the feet stand at u ${TARGET.uFeet} +-${TOLL.uFeet}`, `${s.uFeet.toFixed(4)}`);
    report.check(Math.abs(s.wideAt35 - TARGET.wideAt35) <= TOLL.wideAt35,
      `${tag}: ${TARGET.wideAt35} +-${TOLL.wideAt35} px wide 0.35 H below the crown`,
      `${s.wideAt35.toFixed(1)}`);
    report.check(Math.abs(s.widest - TARGET.widest) <= TOLL.widest,
      `${tag}: widest ${TARGET.widest} +-${TOLL.widest} px`, `${s.widest.toFixed(1)}`);
    report.line(`         outline ${s.crown}..${s.outlineBottom} rows, columns `
      + `${s.cols[0].toFixed(0)}..${s.cols[1].toFixed(0)} (the picture: 575..940, 596..748)`);
  } else {
    // SHE IS NOT MEASURED AND MUST NOT BE ASSERTED AGAINST A PICTURE THAT DOES
    // NOT SHOW HER. What she has to keep is his height and his framing; her
    // width is the four declared moves and is reported, not judged.
    report.check(Math.abs(s.crown - silhouette(WALKS.m[1]).crown) <= 1,
      `${tag}: stands at his crown row`, `${s.crown}`);
    report.line(`         widest ${s.widest.toFixed(1)} px against his `
      + `${silhouette(WALKS.m[1]).widest.toFixed(1)}: the four declared moves`);
  }
}

// ------------------------------------------------------------ the imposed pose
const shot = imposed(POSE_TARGET);
report.check(shot.person === 'prima',
  'the dev pose stands the camera in FIRST person, whichever person it found the walker in',
  `entered in terza, left in ${shot.person}`);
report.check(shot.read.miss.metres <= 0.001,
  'and the camera it leaves behind IS the day fit, to the millimetre',
  `${(shot.read.miss.metres * 1000).toFixed(4)} mm from `
  + `${POSE_TARGET.position.x} / ${POSE_TARGET.position.y} / ${POSE_TARGET.position.z}`);
report.check(shot.read.miss.degrees <= 0.01,
  'and looks where the fit looks, to a hundredth of a degree',
  `${shot.read.miss.degrees.toExponential(2)} deg from yaw ${POSE_TARGET.yaw} `
  + `pitch ${POSE_TARGET.pitch}`);
report.check(shot.read.fov === POSE_TARGET.fov && shot.camera.projections > 0,
  'through the lens the fit solved for, with the projection rebuilt for it',
  `fov ${shot.read.fov}`);
report.check(shot.dismissed === 1,
  'and it takes the arrival veil off the frame, which a held clock never would',
  `veil.dismiss() called ${shot.dismissed} time${shot.dismissed === 1 ? '' : 's'}`);
let posesOff = 0;
let worstPose = { name: '-', metres: 0, degrees: 0 };
for (const name of Object.keys(POSES)) {
  const one = imposed(POSES[name], 'prima');
  if (one.read.miss.metres > 0.001 || one.read.miss.degrees > 0.01) posesOff++;
  if (one.read.miss.metres >= worstPose.metres) {
    worstPose = { name, metres: one.read.miss.metres, degrees: one.read.miss.degrees };
  }
}
report.check(posesOff === 0,
  'every pose that has a name lands its camera on its own six numbers',
  `${Object.keys(POSES).length} poses, worst ${worstPose.name} at `
  + `${(worstPose.metres * 1000).toFixed(4)} mm and ${worstPose.degrees.toExponential(1)} deg`);
// AND THERE IS ONE DOOR. A seat only ends an argument while it is the only place
// the argument can be had, so the page is read for a second placement.
const mainText = read('src/main.js');
report.check(/window\.setDevPose = \(asked\) => devPose\.place\(asked\);/.test(mainText)
  && /if \(code === 'KeyP'\) devPose\.place\(POSE_TARGET\);/.test(mainText)
  && !/player\.setPose\(/.test(mainText),
  'the P key and window.setDevPose go through that seat and the page places nothing itself',
  'one door, in src/dev/pose.js');

// ----------------------------------------------- the list IS the stone
//
// The two lists E-INT-V8 named are one list now: the camera reads the piles the
// mesher cuts and the loose stone the loose stone file cuts, and this is what
// says so. It is asserted on the geometry and not on the plan, because the plan
// is what the old boxes were built from and the plan was not wrong -- the boxes
// were, about a mesh that had moved underneath them.
const boxes = cameraSolids();
const piled = pilesOutside(boxes);
report.check(piled.cells > 0 && piled.outside === 0,
  'every cell of stone the pile mesher lays is inside a box the camera is stopped by',
  `${piled.cells} cells, ${piled.outside} outside`
  + (piled.worst ? ` (${piled.worst.rock} at ${piled.worst.x.toFixed(2)}, `
    + `${piled.worst.y.toFixed(2)}, ${piled.worst.z.toFixed(2)})` : ''));
const loose = looseOutside(boxes);
report.check(loose.checked > 0 && loose.outside === 0,
  'and every corner of the ruins and of the basin, off the buffer the page draws',
  `${loose.checked} vertices, ${loose.outside} outside`
  + (loose.worst ? ` (first at ${loose.worst.x.toFixed(2)}, ${loose.worst.y.toFixed(2)}, `
    + `${loose.worst.z.toFixed(2)})` : ''));
report.check(pileSolids().length === ROCK_PILES.length,
  'no pile is left out of the list, whatever its radius',
  `${pileSolids().length} boxes for ${ROCK_PILES.length} piles`);
// AND THE MIRROR OF WATER IS NOT CLAIMED. The basin is an annulus and the one
// mistake a single box round it would make is to fill the pool with stone, which
// is where a walker is meant to be able to put the lens.
const FOUNTAIN_EYE = (() => {
  const ring = looseStoneSolids().filter((b) => String(b.name).startsWith('vasca'));
  if (!ring.length) return null;
  let x = 0;
  let z = 0;
  for (const b of ring) { x += b.x; z += b.z; }
  return { x: x / ring.length, y: 0.05, z: z / ring.length, ring: ring.length };
})();
report.check(Boolean(FOUNTAIN_EYE) && !boxes.some((b) => within(FOUNTAIN_EYE, b)),
  "the middle of the fountain is water and not stone: no box claims it",
  FOUNTAIN_EYE ? `${FOUNTAIN_EYE.ring} boxes round the rim, none over the pool` : 'no basin');
report.line(`         ${boxes.length} boxes: 6 blocks, ${pileSolids().length} piles, `
  + `${looseStoneSolids().length} of loose stone (${loose.counts.ruins} ruin cubes and `
  + `${loose.counts.basin} of basin; ${loose.counts.turf} cubes of turf on the six heads are `
  + 'declared out, being lids five to thirteen metres up)');

// ------------------------------------------------------ the camera and the stone
const solids = cameraSolids();
let entered = 0;
let crossed = 0;
let collapsed = 0;
let underground = 0;
let placements = 0;
let unreachable = 0;
let closest = Infinity;
for (const box of solids) {
  for (const distance of [0.5, 1.5, 3.0]) {
    for (const pitch of [0, 30 * DEG, -30 * DEG]) {
      for (const spot of ring(box, distance, pitch)) {
        if (!spot) { unreachable++; continue; }
        placements++;
        // THE WHOLE ARM AND NOT ONLY ITS END. A camera pulled up short of a
        // block is the answer; a camera that went THROUGH one and came out in
        // clear air on the far side is the defect, and the end of the arm cannot
        // tell them apart -- the blocks are a metre and a half deep and the arm
        // is five metres long, so passing clean through is the common case, not
        // the rare one. The segment is asked with no padding at all: the 0.25 m
        // the camera keeps is the code's margin, and a guard that asserted the
        // margin would be asserting the constant rather than the property.
        if (solids.some((b) => inside(spot, b, 0.01))) entered++;
        // AND A ZERO ARM IS NOT A CROSSING, WHICH IS A DISTINCTION THIS GUARD
        // DID NOT USED TO HAVE TO MAKE. A walker standing flush against a block
        // -- which his own footprints allow, they are the same box -- is inside
        // the 0.25 m the camera keeps, so the boom retracts the whole way and the
        // camera IS the eye. Asked of that, armClear answers on a segment of no
        // length whose single endpoint lies on the face of the block, and says
        // nought. There is no arm there to pass through anything: the case is
        // counted and reported rather than called a defect.
        else if (spot.arm <= 1e-9) collapsed++;
        else if (armClear(spot.pivot, spot, solids, 0) < 1 - 1e-9) crossed++;
        const floor = groundHeightAt(spot.x, spot.z);
        if (spot.y < floor - 0.01) underground++;
        if (spot.arm < closest) closest = spot.arm;
      }
    }
  }
}
report.check(entered === 0,
  `the camera is never inside a solid, over ${placements} placements`,
  `${entered} inside`);
report.check(crossed === 0, 'and the arm never passes through one to get there',
  `${crossed} crossings`);
report.check(underground === 0, 'and never under the ground it stands over',
  `${underground} below`);
report.line(`         sixteen bearings x three distances x three aims round each of `
  + `${solids.length} boxes; shortest arm ${closest.toFixed(2)} m of ${rig.planar.toFixed(2)}; `
  + `${unreachable} bearings skipped as ground no walker can stand on, ${collapsed} with the `
  + 'boom fully retracted against a face the walker is standing on');

// -------------------------------------------------------------------- the rim
const rim = rimSweep();
report.check(rim.underground === 0,
  'at the edge of the world the camera never goes under the field\'s own ground',
  `${rim.placements} placements, ${rim.underground} below; the lowest stands `
  + `${(rim.lowest * 1000).toFixed(0)} mm over the ground beneath it`);
report.check(rim.inHill === 0,
  'and never inside the hills that stand beyond it',
  `${rim.inHill} inside; the closest the lens comes to the horizon\'s own surface is `
  + `${rim.nearestHill.toFixed(2)} m`);
report.line(`         three radii (${AREA_SOFT_RADIUS}, ${AREA_HARD_RADIUS}, `
  + `${AREA_HARD_RADIUS + 1} m from the walker's own centre) x 32 bearings x 16 yaws x 7 aims; `
  + `the plateau is flat to 35 m and the nearest cube of hill stands 162 m out, `
  + `which is ${(162 - AREA_HARD_RADIUS - 1 - rigMetres(AVATAR.height).planar).toFixed(0)} m `
  + 'beyond anything this arm can reach');

// --------------------------------------------------- the arm and the aim
//
// D-AVATAR-2 STANDS AT A, ratified: the arm shortens with the look and goes to
// nothing at the limit, rather than swinging rigidly through the ground and the
// stair platform. src/core/avatar.js says the guard 'sweeps the whole range and
// reports clearance at every degree'; until now it did not, so the sentence was
// a promise. It is a sweep now.
const sweep = [];
for (let deg = -85; deg <= 85; deg += 1) {
  sweep.push({ deg, k: armFraction(deg * DEG, PITCH_LIMIT) });
}
const atRest = armFraction(RIG.pitch * DEG, PITCH_LIMIT);
report.check(Math.abs(atRest - 1) < 1e-12,
  'the arm is whole at the aim the rule was measured at, and only there',
  `${atRest.toFixed(6)} at ${RIG.pitch} deg`);
report.check(Math.abs(armFraction(PITCH_LIMIT, PITCH_LIMIT)) < 1e-12
  && Math.abs(armFraction(-PITCH_LIMIT, PITCH_LIMIT)) < 1e-12,
  'and gone at both limits, which is first person and has nothing to collide with',
  `${(PITCH_LIMIT / DEG).toFixed(0)} deg either way`);
let notMonotone = 0;
for (let i = 1; i < sweep.length; i++) {
  const before = sweep[i - 1];
  const now = sweep[i];
  const rising = now.deg <= RIG.pitch;
  if (rising ? now.k < before.k - 1e-12 : now.k > before.k + 1e-12) notMonotone++;
}
report.check(notMonotone === 0,
  'it comes out to the aim and goes back from it and never turns round on the way',
  `${sweep.length} degrees, ${notMonotone} reversals`);
// And the clearance the file's own comment promises, at the one place it is
// worst: on the rim, where the ground falls away behind the shoulder.
let sweptUnder = 0;
let sweptLowest = Infinity;
{
  const solids = cameraSolids();
  const eye = {};
  const x = AREA_CENTER.x;
  const z = AREA_CENTER.z + AREA_HARD_RADIUS;
  const stance = groundHeightAt(x, z);
  for (const { deg } of sweep) {
    for (let a = 0; a < 16; a++) {
      thirdPersonEye(eye, { x, z, stance, yaw: (a / 16) * Math.PI * 2 }, deg * DEG,
        PITCH_LIMIT, groundHeightAt, AVATAR.height,
        { reach: 1, solids, eyeHeight: EYE_HEIGHT });
      const margin = eye.y - groundHeightAt(eye.x, eye.z);
      if (margin < sweptLowest) sweptLowest = margin;
      if (margin < -1e-9) sweptUnder++;
    }
  }
}
report.check(sweptUnder === 0,
  'and at every degree of it the lens stays over the ground it is swinging across',
  `${sweep.length * 16} placements, lowest ${(sweptLowest * 1000).toFixed(0)} mm clear `
  + `(the code keeps ${(GROUND_CLEARANCE * 1000).toFixed(0)})`);

// ------------------------------------------------------------------ the switch
const run = switchRun();
const over = run.find((f) => f.reach >= 1 - 1e-12 || f.t >= SWITCH.seconds);
report.check(SWITCH.seconds <= 0.4, 'the switch is over inside 0.4 s',
  `${SWITCH.seconds} s`);
report.check(Boolean(over) && over.t <= 0.4 + 1e-9,
  'and the arm has actually arrived by then', `${over ? over.t.toFixed(3) : '-'} s`);
let backwards = 0;
let biggest = 0;
for (let i = 1; i < run.length; i++) {
  if (run[i].reach < run[i - 1].reach - 1e-12) backwards++;
  const jump = Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y, run[i].z - run[i - 1].z);
  if (jump > biggest) biggest = jump;
}
report.check(backwards === 0, 'the run is monotone: the arm never goes back on itself',
  `${backwards} steps back`);
report.check(biggest <= 0.5, 'and no frame of it moves the camera more than half a metre',
  `${biggest.toFixed(3)} m at 60 fps`);
report.check(bodyFade(0) === 0 && bodyFade(SWITCH.hideBelow) === 0
  && bodyFade(SWITCH.showAbove) === 1 && bodyFade(rig.planar) === 1,
  'the body is gone on the lens and whole from a metre out',
  `${SWITCH.hideBelow}..${SWITCH.showAbove} m`);

// -------------------------------------------------------------------- the step
report.check(CYCLE.length === LIFT.length && CYCLE.length >= 4,
  'the step has a frame for every rise and back', `${CYCLE.length} frames`);
report.check(new Set(CYCLE).size <= 6,
  'and no more lattices than the chapter allows', `${new Set(CYCLE).size} lattices`);
report.check(!LIFT.some((v) => v < 0),
  'no frame of it puts his soles under the ground he is standing on',
  `lift ${LIFT.join(',')} cells`);
report.check(LIFT[CYCLE.indexOf(1)] !== undefined && restingLift() === 0,
  'and a body that is not walking stands ON the ground rather than a cell over it',
  `${restingLift()} cells at rest`);
report.check(STRIDE_METRES > 0, 'the step is spent in metres', `${STRIDE_METRES} m a cycle`);
for (const kind of Object.keys(WALKS)) {
  const bad = paletteAgrees(kind);
  report.check(bad === null,
    `${kind}: the palette answers for every cell of every pose`,
    bad ? `pose ${bad.n} cell ${bad.i},${bad.j},${bad.k} is ${bad.mine} there and `
      + `${paletteAt(bad.i, bad.j, bad.k, PAINTS[kind], bad.n)} in the stamped list` : '');
}

// ---------------------------------------------------------------------- notes
//
// THE GROUND UNDER HIS FEET, PRINTED WHATEVER IT SAYS. It used to be printed
// only when it was wrong, which is the shape of note that cannot tell a reader
// that a defect has been FIXED: E-AVATAR1 recorded a 380 mm hole under the feet
// the picture draws, on V8's own ground, and the only way to find out whether
// the foundation had levelled it was to run the guard and notice a silence.
const dip = groundHeightAt(FEET.x, FEET.z);
report.note(`the ground at the feet the picture draws (${FEET.x}, ${FEET.z}) stands `
  + `${(dip * 1000).toFixed(0)} mm from the plane the framing is asserted on. E-AVATAR1 `
  + 'measured -380 mm there on V8\'s own ground; the foundation levelled it'
  + (Math.abs(dip) > 0.02
    ? ' -- AND IT IS BACK: the framing above is asserted on y = 0, where the blocks, the '
      + 'paving and the verge were measured, so a dip this size belongs to the ground session '
      + 'and goes with a rebase, not with the figure'
    : ''));
report.note(`the rule is anchored at the day fit's own aim (${RIG.pitch} deg); the night fit `
  + `sits 0.42 deg away, which is ${(rig.planar * 0.42 * DEG * 1000).toFixed(0)} mm on the arm`);

report.end(`H ${AVATAR.height} m in third and ${EYE_HEIGHT} at the eye in first; arm `
  + `${rig.planar.toFixed(3)} m planar, ${rig.lateral.toFixed(3)} abeam, `
  + `${rig.above.toFixed(3)} above the feet`);
