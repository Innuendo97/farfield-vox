import { read, reporter, selfTest } from './lib.mjs';
import {
  AVATAR, EYE_TO_CROWN, RIG, SWITCH, armClear, bodyFade, reachEase, rigMetres, thirdPersonEye,
} from '../../src/core/avatar.js';
import { POSE_TARGET_TERZA, POSE_VOX_DAY } from '../../src/core/poses.js';
import { EYE_HEIGHT } from '../../src/world/layout.js';
import { cameraSolids, groundHeightAt } from '../../src/world/contracts.js';
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
const rig = rigMetres(AVATAR.height);
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

// ------------------------------------------------------ the camera and the stone
const solids = cameraSolids();
let entered = 0;
let crossed = 0;
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
  + `${unreachable} bearings skipped as ground no walker can stand on`);

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
const dip = groundHeightAt(FEET.x, FEET.z);
if (Math.abs(dip) > 0.02) {
  report.note(`this tree's ground stands ${(dip * 1000).toFixed(0)} mm from the plane at the `
    + `feet the picture draws (${FEET.x}, ${FEET.z}): the framing above is asserted on y = 0, `
    + 'which is where the blocks, the paving and the verge were measured -- the dip belongs to '
    + 'the ground session and goes with a rebase, not with the figure');
}
report.note(`the rule is anchored at the day fit's own aim (${RIG.pitch} deg); the night fit `
  + `sits 0.42 deg away, which is ${(rig.planar * 0.42 * DEG * 1000).toFixed(0)} mm on the arm`);

report.end(`H ${AVATAR.height} m in third and ${EYE_HEIGHT} at the eye in first; arm `
  + `${rig.planar.toFixed(3)} m planar, ${rig.lateral.toFixed(3)} abeam, `
  + `${rig.above.toFixed(3)} above the feet`);
