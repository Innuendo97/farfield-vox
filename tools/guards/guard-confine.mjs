import {
  CAMPO_BIAS, CAMPO_FAR, CENTRE, CONFINE, NO_COLUMN, PLATEAU, VOXEL,
  basinProfile, campoGroundByte, columnSpec, confineSteps, crestRise,
} from '../../src/world/voxel/pure.js';
import { POSE_VOX_DAY } from '../../src/core/poses.js';
import { TUNING } from '../../src/core/presence.js';
import { reporter, selfTest } from './lib.mjs';

// GUARD-CONFINE -- THE EDGE OF THE WORLD IS GROUND, AND IT IS THE RIGHT GROUND.
//
// ===========================================================================
// WHAT IT REPLACED, AND WHY THE OLD ONE COULD NOT BE AMENDED.
//
// guard-guscio stood here. It asked four things of a SHEET -- that its faces
// looked up, that it met the cubes at the rim, that nothing showed under that
// rim, and that it was one draw -- and every one of those questions is about a
// mesh that no longer exists. E-DECISIONI13 replaced the sheet with GROUND:
// «oltre, il terreno scende a gradoni voxel verso il lago tutt'intorno, con le
// creste terrazzate a chiudere l'orizzonte ai lati e dietro lo spawn; il
// camminatore si ferma dove comincia l'acqua e dove le terrazze superano il
// passo; NESSUNA staccionata; NESSUNA sfocatura». A ray has no winding to get
// wrong and there is no rim to meet, so the four questions are gone with the
// thing they were about.
//
// What took their place is this, and every leg is one clause of that decision:
//
//   1. THE PLATEAU IS LEVEL and the boundary starts exactly at its edge. The
//      playable ground is the thing the whole campaign is measured on; a
//      boundary that leaked one voxel inside it would move every reading.
//   2. THE FALL IS WALKABLE. Every riser between the plateau and the water is
//      inside the body's own step, so a walker can go down to the shore and is
//      stopped by the WATER and not by a wall.
//   3. AND THE RIDGE IS NOT. Its risers are over that step, which is the other
//      half of the same sentence: the walker is stopped by the ground.
//   4. THE RIDGE CLOSES THE HORIZON at the sides and behind the spawn, measured
//      as an ELEVATION from the eye at the pose the campaign is judged at: on
//      those bearings the skyline is ground and not sky.
//   5. AND IT IS NOT A CIRCUMFERENCE. Both the height of the crown and the
//      radius it stands at have to move with the bearing, or the boundary is
//      the very ring E-DECISIONI13 forbids, wearing terraces.
//   6. THE WHOLE WORLD FITS IN THE BYTE THE PICTURE HOLDS IT IN. The field
//      keeps a ground in one biased byte of voxels; the day the ridge is raised
//      past what that holds, the crown would go FLAT and nothing else would
//      say so. This sweeps the law over the far window and asserts it.
//   7. NOTHING IS QUANTISED TWICE. Every height out there is a whole number of
//      voxels, which is what makes the terraces terraces.
//   8. AND THE BASIN IS STILL THE FITTED ONE. It moved seat into confine.js;
//      the numbers it answers are pinned here against the readings E-V5f took,
//      so a move of seat can never have been a change of shape.
// ===========================================================================

const report = reporter('guard-confine -- the edge of the world is ground');

const DEG = Math.PI / 180;
const injected = process.argv.includes('--inject');

// THE BODY'S OWN STEP, read from a seat and not written here.
//
// E-DECISIONI13 names it -- «dove le terrazze superano il passo (0,30 m)» --
// and the world carries it TWICE: src/core/presence.js says how far a change of
// floor may be eased in one go (TUNING.ground.maxM, read here) and
// src/core/player.js carries MAX_STEP_DOWN for the ledge itself, which is the
// same 0.30 and is NOT exported. The two agreeing is V8's business and it is
// declared in the verbale rather than gated here, because this guard is about
// the ground and reaching into another session's private literal to prove a
// point about it would be the second opinion it exists to prevent.
const STEP = TUNING.ground.maxM;

if (injected) {
  // The self test's own hand: a ridge twice as tall as the one that ships. It
  // is the defect the byte leg exists for -- nothing about the picture would
  // look broken, the crown would simply stop climbing.
  CONFINE.crest.height *= 2.4;
}

// --------------------------------------------------------------------------
// 1. THE PLATEAU IS LEVEL, AND THE BOUNDARY BEGINS AT ITS EDGE.
// --------------------------------------------------------------------------
let insideMoved = 0;
let firstOutside = Infinity;
for (let deg = 0; deg < 360; deg += 1) {
  const a = deg * DEG;
  const ux = Math.sin(a);
  const uz = -Math.cos(a);
  for (let r = 0; r <= PLATEAU; r += 0.25) {
    if (confineSteps(CENTRE.x + ux * r, CENTRE.z + uz * r, CENTRE) !== 0) insideMoved += 1;
  }
  for (let r = PLATEAU; r < PLATEAU + 12; r += VOXEL) {
    if (confineSteps(CENTRE.x + ux * r, CENTRE.z + uz * r, CENTRE) !== 0) {
      if (r < firstOutside) firstOutside = r;
      break;
    }
  }
}
report.check(insideMoved === 0,
  'the plateau is level: the boundary moves no column inside it',
  insideMoved ? `${insideMoved} columns moved` : `${PLATEAU} m, on 360 bearings`);
report.check(firstOutside > PLATEAU && firstOutside < PLATEAU + 6,
  'and the first terrace stands just outside it, on every bearing',
  `the nearest moved column is at ${firstOutside.toFixed(2)} m`);

// --------------------------------------------------------------------------
// 2 and 3. THE FALL IS WALKABLE AND THE RIDGE IS NOT.
//
// A riser is asked COLUMN TO COLUMN, which is how a body meets one: the walker
// steps ten centimetres at a time and what stops him is the tallest single
// riser on his way, not the mean slope.
// --------------------------------------------------------------------------
function worstRiser(deg, from, to) {
  const a = deg * DEG;
  const ux = Math.sin(a);
  const uz = -Math.cos(a);
  let worst = 0;
  let at = 0;
  for (let r = from; r < to; r += VOXEL) {
    const h0 = confineSteps(CENTRE.x + ux * r, CENTRE.z + uz * r, CENTRE);
    const h1 = confineSteps(CENTRE.x + ux * (r + VOXEL), CENTRE.z + uz * (r + VOXEL), CENTRE);
    const jump = Math.abs(h1 - h0) * VOXEL;
    if (jump > worst) { worst = jump; at = r; }
  }
  return { worst, at };
}

// TOWARD THE WATER, which is north: the lake's own bearings, where the gate
// holds the ridge down and the ground does nothing but fall.
let worstToWater = 0;
for (let deg = -12; deg <= 12; deg += 1) {
  const r = worstRiser((deg + 360) % 360, PLATEAU, 100);
  if (r.worst > worstToWater) worstToWater = r.worst;
}
report.check(worstToWater <= STEP + 1e-9,
  'a body can walk the fall to the water: no riser on it is over its own step',
  `worst riser ${(worstToWater * 100).toFixed(0)} cm against a step of ${(STEP * 100).toFixed(0)}`);

// AND ON THE RIDGE, where the walker has to be STOPPED by the ground.
let ridgeStops = 0;
let ridgeBearings = 0;
let worstRidge = 0;
for (let deg = 60; deg <= 300; deg += 5) {
  ridgeBearings += 1;
  const r = worstRiser(deg, CONFINE.crest.foot, CONFINE.crest.peak);
  if (r.worst > STEP) ridgeStops += 1;
  if (r.worst > worstRidge) worstRidge = r.worst;
}
report.check(ridgeStops === ridgeBearings,
  'and the ridge stops him: every one of its bearings carries a riser over the step',
  `${ridgeStops} of ${ridgeBearings} bearings, worst ${(worstRidge * 100).toFixed(0)} cm`);

// --------------------------------------------------------------------------
// 4. THE RIDGE CLOSES THE HORIZON, AS AN ELEVATION FROM THE EYE.
//
// «le creste terrazzate a chiudere l'orizzonte ai lati e dietro lo spawn». What
// that means at a pose is that the SKYLINE on those bearings is ground: the
// highest thing the eye sees along the bearing stands above the horizontal, so
// there is no band of sky between the meadow and the far hills.
// --------------------------------------------------------------------------
const EYE = { x: POSE_VOX_DAY.position.x, y: POSE_VOX_DAY.position.y, z: POSE_VOX_DAY.position.z };

function skyline(deg) {
  const a = deg * DEG;
  const ux = Math.sin(a);
  const uz = -Math.cos(a);
  let best = -90;
  for (let d = 5; d < 240; d += 0.5) {
    const x = EYE.x + ux * d;
    const z = EYE.z + uz * d;
    const h = confineSteps(x, z, CENTRE) * VOXEL;
    const angle = Math.atan2(h - EYE.y, d) / DEG;
    if (angle > best) best = angle;
  }
  return best;
}

let closed = 0;
let openBearings = 0;
let lowest = 90;
for (let deg = 0; deg < 360; deg += 3) {
  const away = Math.min(deg, 360 - deg);
  const line = skyline(deg);
  if (away < CONFINE.crest.gateTo) { openBearings += 1; continue; }
  if (line > 0) closed += 1;
  if (line < lowest) lowest = line;
}
const shouldClose = Math.round(360 / 3) - openBearings;
report.check(closed === shouldClose,
  'the ridge closes the horizon on every bearing outside the lake gate',
  `${closed} of ${shouldClose} bearings stand over the eye, lowest `
  + `${lowest.toFixed(2)} degrees; ${openBearings} bearings are left open to the water`);

// --------------------------------------------------------------------------
// 5. AND IT IS NOT A CIRCUMFERENCE.
// --------------------------------------------------------------------------
const crowns = [];
for (let deg = 0; deg < 360; deg += 2) {
  const a = deg * DEG;
  let best = 0;
  let at = 0;
  for (let r = 40; r < 190; r += 1) {
    const rise = crestRise(r, a);
    if (rise > best) { best = rise; at = r; }
  }
  crowns.push({ deg, height: best, radius: at });
}
const ridge = crowns.filter((c) => Math.min(c.deg, 360 - c.deg) >= CONFINE.crest.gateTo);
const hs = ridge.map((c) => c.height);
const rs = ridge.map((c) => c.radius);
const spread = (a) => (Math.max(...a) - Math.min(...a)) / (a.reduce((s, v) => s + v, 0) / a.length);
report.check(spread(hs) > 0.15 && spread(rs) > 0.05,
  'the crown is not a circle: its height and its radius both move with the bearing',
  `height ${(spread(hs) * 100).toFixed(0)}% of its own mean over the ridge, `
  + `radius ${(spread(rs) * 100).toFixed(0)}%; crown `
  + `${Math.min(...hs).toFixed(1)} to ${Math.max(...hs).toFixed(1)} m at `
  + `${Math.min(...rs)} to ${Math.max(...rs)} m`);

// --------------------------------------------------------------------------
// 6. THE WHOLE WORLD FITS IN THE BYTE THE PICTURE HOLDS IT IN.
//
// The field keeps a ground as ONE byte of voxels, biased by CAMPO_BIAS. The day
// V5 raises the ridge past what that holds, the crown goes flat and the picture
// says nothing at all -- so the law is swept over the far window's own footprint
// and every answer is asked to come back out unchanged.
// --------------------------------------------------------------------------
const REACH = CAMPO_FAR.side * CAMPO_FAR.cell / 2;
let clipped = 0;
let deepest = 0;
let highest = 0;
let notVoxel = 0;
for (let x = -REACH; x <= REACH; x += 2) {
  for (let z = -REACH; z <= REACH; z += 2) {
    if (Math.hypot(x - CENTRE.x, z - CENTRE.z) > REACH) continue;
    const steps = confineSteps(x, z, CENTRE);
    if (!Number.isInteger(steps)) notVoxel += 1;
    const top = -1 + steps;
    if (campoGroundByte(top) !== top + 1 + CAMPO_BIAS) clipped += 1;
    if (steps < deepest) deepest = steps;
    if (steps > highest) highest = steps;
  }
}
report.check(clipped === 0,
  'every height the boundary draws fits in the byte the picture holds it in',
  clipped ? `${clipped} are clipped` : `${(deepest * VOXEL).toFixed(2)} m to `
    + `${(highest * VOXEL).toFixed(2)} m inside a byte that spans `
    + `${(-CAMPO_BIAS * VOXEL).toFixed(1)} to ${((255 - CAMPO_BIAS) * VOXEL).toFixed(1)}`);

// --------------------------------------------------------------------------
// 7. NOTHING IS QUANTISED TWICE.
// --------------------------------------------------------------------------
report.check(notVoxel === 0,
  'and every one of them is a whole number of voxels, which is what makes a terrace',
  notVoxel ? `${notVoxel} are not` : '');

// --------------------------------------------------------------------------
// 8. THE BASIN IS STILL THE FITTED ONE. It changed seat and not shape.
// --------------------------------------------------------------------------
const pinned = [
  [35, 0], [60, -2.026367], [110, -4.741367], [200, -9.628367],
];
let basinOff = 0;
for (const [r, want] of pinned) {
  if (Math.abs(basinProfile(r) - want) > 0.0005) basinOff += 1;
}
report.check(basinOff === 0 && basinProfile(20) === 0,
  'the basin answers what E-V5f fitted, to the half millimetre, from its new seat',
  pinned.map(([r]) => `${r} m: ${basinProfile(r).toFixed(3)}`).join('  '));

// --------------------------------------------------------------------------
// AND THE LAW LAYS IT AS COLUMNS, which is the one thing that turns all of the
// above into ground somebody can stand on.
// --------------------------------------------------------------------------
const probe = columnSpec(Math.round(90 / VOXEL), Math.round(CENTRE.z / VOXEL), false, PLATEAU, true);
const rimmed = columnSpec(Math.round(90 / VOXEL), Math.round(CENTRE.z / VOXEL), false, PLATEAU);
report.check(probe.top !== NO_COLUMN && rimmed.top === NO_COLUMN,
  'columnSpec lays the boundary when asked for the world and air when asked for the disc',
  `at 90 m east: top ${probe.top} with, ${rimmed.top} without`);

if (process.argv.includes('--self')) {
  selfTest('guard-confine', [
    {
      what: 'a ridge raised past what the picture byte can hold',
      caught: injected ? clipped > 0 : true,
    },
  ]);
}

report.end(`the plateau is ${PLATEAU} m; the fall reaches `
  + `${(deepest * VOXEL).toFixed(1)} m and the ridge ${(highest * VOXEL).toFixed(1)} m over it, `
  + `both inside ${REACH} m of far window`);
