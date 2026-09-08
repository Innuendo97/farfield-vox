import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Euler, Matrix4 } from 'three';

import { POSE_VOX_DAY } from '../../src/core/poses.js';
import {
  bearingGap, bearingOf, bearingOfFrameRead, bearingOfOffAxis, bearingOfYaw,
  bearingRadOf, directionOf, frameReadOfBearing, offAxisOf, turnOf, yawOfBearing,
} from '../../src/world/compass.js';
import { MONOLITHS } from '../../src/world/layout.js';
import { REPO_ROOT, read, reporter, selfTest } from './lib.mjs';

// GUARD-BUSSOLA -- THERE IS ONE NORTH, AND IT IS THE ONE THE PICTURE HAS.
//
// ===========================================================================
// WHY THIS EXISTS, AND IT IS NOT A HYPOTHETICAL.
//
// Two conventions live in this codebase and for two sessions nobody had written
// down that they were two. The engine reads a camera's yaw as `atan2(-x, -z)`;
// every law in this world asks `atan2(x, -z)`. They are exact negatives. At yaw
// nought they agree -- which is where anybody checking by eye would check --
// and they part company by TWICE THE YAW everywhere else.
//
// U-CORNICE-1 fitted a whole ring of hills through the gap between them.
// U-CORNICE-2 found it by measuring (the five monoliths land sixty-six to a
// hundred and eleven pixels from where the reference draws them under the wrong
// sign, and three to seventeen under the right one) and put ONE conversion at
// the boundary its own fit crossed. D-C2-2 = B moved the arithmetic to
// src/world/compass.js and published it through src/world/contracts.js, because
// the sign belongs to the WORLD and not to one unit. This guard is the half
// that makes that stick.
//
// WHAT IT ASSERTS, IN ORDER OF WHAT IT WOULD COST TO BE WRONG ABOUT:
//
//   1. The compass is `atan2(x, -z)`, and its inverse, its radians and its dial
//      are the same arithmetic and not four opinions.
//   2. The engine's yaw is that compass NEGATED -- against src/core/player.js's
//      own basis, which is read as TEXT as well, so that an edit to the engine
//      turns this red rather than turning the world.
//   3. THE FIVE MONOLITHS, ARITHMETIC. The direction the law computes for a
//      block is where the engine's own camera puts it, over forty corners.
//   4. THE FIVE MONOLITHS, AGAINST THE PICTURE. That same direction is where
//      the REFERENCE draws the block, to half a degree.
//   5. A reading off the frame crosses TWICE the yaw and not once, checked
//      against the one fingerprint R6's trace carries.
//   6. There is ONE SEAT: no second `atan2(x, -z)` in src/ or assets-src/.
//
// AND WHAT IT DELIBERATELY DOES NOT ASSERT. `atan2(z, x)` -- from +X,
// anticlockwise -- is a THIRD angle and a legitimate one: frustum sectors,
// angular widths, radial noise, the horizon ring of guard-orizzonte, the walker
// heading pair in player.js. Nothing is ever fitted against a photograph
// through it. Leg 6 is written by SHAPE so that it does not see those, because
// turning them would break the one agreement they exist to hold -- with a
// fragment written the same way.
//
// ===========================================================================
// WHERE THE REFERENCE COLUMNS COME FROM, BECAUSE A GUARD MAY NOT INVENT THEM.
//
// Measured on `farfield-day-voxel-target.png`, carried here as numbers. That is
// what fit-cornice.mjs does with R6's traced skyline and for the same reason:
// the picture is not in the delivery, and a gate may not depend on a file that
// is not there.
//
// AND THEY ARE MEASURED RATHER THAN READ OFF BY EYE. U-CORNICE-2 quoted the
// five at «about 295, 600, 850, 1094 and 1360» -- that is a person looking. The
// bench (fondazione/lav/u3/edges.mjs) takes each block's two silhouette edges
// as the strongest luminance gradient within twenty-five pixels of where the
// law puts it, over the band from a tenth to four tenths of the block's own
// height, which is the stretch that stands against sky and pale hill where an
// edge is a real step and not stone against stone.
//
// THE EDGES DISAGREE WITH THE MODEL AND THE CENTRES DO NOT, AND THAT IS ITSELF
// THE MEASUREMENT. Every left edge reads inside the model's and every right
// edge reads inside it too: the blocks read about fifteen pixels NARROWER than
// layout.js builds them. That is a WIDTH, it belongs to whoever owns the
// masonry, and it is not a bearing -- which is exactly why the centre is the
// statistic here and the edge is not. The centres agree to 6.3 px in the worst
// case, 0.31 of a degree, and the fit that solved this pose off these same
// blocks carries an rms of 8.02 px itself (src/core/poses.js). So half a degree
// is the FLOOR OF THIS READING and not a slack tolerance, and against it the
// wrong sign is out by seventy-three to ninety-three pixels: four degrees, and
// seven times over.
//
//   id   silhouette centre, measured      the law, at the fit
//   01   276.0                            269.7   (+6.3 px, 0.312 deg)
//   02   602.0                            600.1   (+1.9 px, 0.092)
//   03   852.0                            851.4   (+0.6 px, 0.032)
//   04   1107.0                           1110.6  (-3.6 px, 0.180)
//   05   1375.5                           1376.2  (-0.7 px, 0.035)
const REFERENCE = [
  ['01', 276.0], ['02', 602.0], ['03', 852.0], ['04', 1107.0], ['05', 1375.5],
];

/** The judging frame, and the lens the pose was fitted with. */
const FRAME_PX = { w: 1672, h: 941 };
const DEG = Math.PI / 180;
const FOCAL = (FRAME_PX.h / 2) / Math.tan((POSE_VOX_DAY.fov / 2) * DEG);

/** How close the law and the engine must agree: the mandate's third of a degree. */
const ARITHMETIC_TOL = 0.3;
/** And how close the law must stand to the picture: the floor of the reading. */
const PICTURE_TOL = 0.5;

// --------------------------------------------------------------- the engine
//
// THE ENGINE'S OWN BASIS, BUILT THE WAY src/core/player.js BUILDS IT and not
// borrowed from anything under test. player.js sets a YXZ Euler on the camera
// and states the result in words at the walk: «Yaw 0 looks north (-Z). Forward
// is (-sin, -cos) and right is (cos, -sin)». That sentence is the
// specification; this is it, written as three vectors, with the pitch a camera
// also carries. The sentence itself is checked below, as text.

function engineBasis(yawDeg, pitchDeg) {
  const y = yawDeg * DEG;
  const p = pitchDeg * DEG;
  const cy = Math.cos(y); const sy = Math.sin(y);
  const cp = Math.cos(p); const sp = Math.sin(p);
  return {
    right: [cy, 0, -sy],
    up: [sp * sy, cp, sp * cy],
    forward: [-cp * sy, sp, -cp * cy],
  };
}

/** Where a world point lands on the judging frame, through the engine's basis. */
function engineColumn(point, pose) {
  const b = engineBasis(pose.yaw, pose.pitch);
  const v = [
    point[0] - pose.position.x, point[1] - pose.position.y, point[2] - pose.position.z,
  ];
  const z = v[0] * b.forward[0] + v[1] * b.forward[1] + v[2] * b.forward[2];
  if (z <= 1e-3) return null;
  const x = v[0] * b.right[0] + v[1] * b.right[1] + v[2] * b.right[2];
  return FRAME_PX.w / 2 + FOCAL * x / z;
}

/**
 * And where the LAW puts it: a bearing and an elevation, carried onto the frame.
 *
 * THE ONLY DIFFERENCE FROM THE ONE ABOVE IS THE BRIDGE, and that is the whole
 * point of having two. This one knows nothing about the engine's basis: it asks
 * the compass which way the point lies, asks how far up it is, and turns those
 * two angles into a column the way guard-cornice already turns a skyline
 * reading into one. If the bridge is right the two agree to the last bits; if
 * it is dropped they part by twice the yaw.
 */
function lawColumn(point, pose, C) {
  const dx = point[0] - pose.position.x;
  const dy = point[1] - pose.position.y;
  const dz = point[2] - pose.position.z;
  const t = C.offAxisOf(C.bearingOf(dx, dz), pose.yaw) * DEG;
  const e = Math.atan2(dy, Math.hypot(dx, dz));
  const X = Math.sin(t) * Math.cos(e);
  const Y = Math.sin(e);
  const Z = -Math.cos(t) * Math.cos(e);
  const pitch = pose.pitch * DEG;
  const cz = -Y * Math.sin(pitch) + Z * Math.cos(pitch);
  if (cz >= 0) return null;
  return FRAME_PX.w / 2 + FOCAL * X / -cz;
}

// -------------------------------------------------------------- the blocks
//
// THE FIVE THE REFERENCE CAN SEE. The sixth stands behind the spawn on purpose
// (src/world/layout.js) and has nothing to say about a picture it is not in.

/** The eight corners of a block, in world metres. */
function cornersOf(m) {
  const a = m.rotationY * DEG;
  const c = Math.cos(a); const s = Math.sin(a);
  const out = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const sy of [0, 1]) {
        const lx = sx * m.size[0] / 2;
        const lz = sz * m.size[2] / 2;
        out.push([
          m.position.x + lx * c + lz * s,
          m.baseY + sy * m.size[1],
          m.position.z - lx * s + lz * c,
        ]);
      }
    }
  }
  return out;
}

/**
 * The middle of a block's silhouette on the frame, through a given projection.
 *
 * THE SILHOUETTE AND NOT THE CENTRE, because a column read off a picture is the
 * middle of what is drawn there. A turned box seen from off to one side is not
 * symmetric about its own middle -- on block 01, which stands twenty-seven
 * degrees west and is turned sixty-five, the two disagree by a third of a
 * degree, which is the whole tolerance of leg 3.
 */
function silhouetteCentre(m, pose, project) {
  let lo = Infinity; let hi = -Infinity;
  for (const p of cornersOf(m)) {
    const col = project(p, pose);
    if (col === null) continue;
    lo = Math.min(lo, col); hi = Math.max(hi, col);
  }
  return (lo + hi) / 2;
}

const BLOCKS = REFERENCE.map(([id]) => MONOLITHS.find((m) => m.id === id));

// ----------------------------------------------------------- the one seat
//
/**
 * Every `Math.atan2(a, -b)` in a source, with `a` not itself negated.
 *
 * THE SHAPE AND NOT THE NAME, because a second compass would not be called one.
 * Comments come out first: this file, contracts.js, compass.js and
 * fit-cornice.mjs all write the formula out in prose ON PURPOSE, and prose is
 * not a seat.
 *
 * AND `atan2(-a, -b)` IS DELIBERATELY LET THROUGH. That is player.js's own
 * heading pair -- the +X anticlockwise angle turned half a circle -- and it is
 * only ever differenced against its neighbour, so the basis cancels. Reading it
 * as a compass would be this guard making the campaign's own mistake in the
 * opposite direction.
 */
function compassShaped(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const found = [];
  for (const m of text.matchAll(/Math\.atan2\(([^;]*?)\)/g)) {
    const inner = m[1];
    let depth = 0; let i = 0;
    for (; i < inner.length; i++) {
      const c = inner[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 0) break;
    }
    if (i >= inner.length) continue;
    const first = inner.slice(0, i).trim();
    const second = inner.slice(i + 1).trim();
    if (second.startsWith('-') && !first.startsWith('-')) found.push(`atan2(${first}, ${second})`);
  }
  return found;
}

/** Every source the world and its fits are written in. */
function sourcesOf() {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(join(REPO_ROOT, rel))) {
      const path = `${rel}/${name}`;
      if (statSync(join(REPO_ROOT, path)).isDirectory()) {
        if (name !== 'node_modules') walk(path);
        continue;
      }
      if (/\.(js|mjs)$/.test(name)) out.push({ file: path, seats: compassShaped(read(path)) });
    }
  };
  walk('src');
  walk('assets-src');
  return out;
}

// -------------------------------------------------------------- the legs
//
// All six against ONE set of compass functions, so that the injection below can
// hand them a bent one and read the same verdict.

function legs(C, sources) {
  const bad = [];
  const no = (tag, detail) => bad.push({ tag, detail });

  // (1) THE COMPASS ITSELF. North is -Z and east is +X. Written as four
  // quarters and two diagonals rather than as the formula again, because
  // restating the formula would test nothing at all.
  for (const [name, x, z, want] of [
    ['north', 0, -1, 0], ['east', 1, 0, 90], ['south', 0, 1, 180], ['west', -1, 0, -90],
    ['north-east', 1, -1, 45], ['north-west', -1, -1, -45],
  ]) {
    const got = C.bearingOf(x, z);
    if (Math.abs(C.bearingGap(got, want)) > 1e-9) no('compass', `${name} reads ${got.toFixed(4)}, not ${want}`);
  }
  // and the inverse, the radians and the dial are the same arithmetic
  for (let b = -179; b < 180; b += 7) {
    const [dx, , dz] = C.directionOf(b);
    if (Math.abs(C.bearingGap(C.bearingOf(dx, dz), b)) > 1e-9) no('compass', `directionOf does not invert at ${b}`);
    if (Math.abs(C.bearingRadOf(dx, dz) / DEG - C.bearingOf(dx, dz)) > 1e-9) no('compass', `radians and degrees part at ${b}`);
    if (Math.abs(C.turnOf(dx, dz) - (b / 360 + 0.5)) > 1e-9) no('compass', `the dial parts at ${b}`);
  }

  // (2) THE ENGINE'S YAW IS THIS COMPASS NEGATED. Over a sweep of yaws and of
  // pitches, because a bridge that only holds at nought IS the defect.
  let worstYaw = 0;
  for (let yaw = -175; yaw <= 180; yaw += 5) {
    for (const pitch of [-40, -4.124, 0, 4.124, 40]) {
      const f = engineBasis(yaw, pitch).forward;
      worstYaw = Math.max(worstYaw, Math.abs(C.bearingGap(C.bearingOf(f[0], f[2]), C.bearingOfYaw(yaw))));
    }
    if (Math.abs(C.bearingGap(C.yawOfBearing(C.bearingOfYaw(yaw)), yaw)) > 1e-9) no('yaw', `it does not come back at ${yaw}`);
  }
  if (worstYaw > 1e-9) no('yaw', `worst ${worstYaw.toExponential(2)} deg over 72 yaws and 5 pitches`);

  // (3) THE FIVE BLOCKS, ARITHMETIC. The law's own two angles and the engine's
  // own basis put every corner in the same column.
  let worstCorner = 0; let corners = 0;
  for (const m of BLOCKS) {
    for (const p of cornersOf(m)) {
      const a = engineColumn(p, POSE_VOX_DAY);
      const b = lawColumn(p, POSE_VOX_DAY, C);
      if (a === null || b === null) continue;
      corners++;
      worstCorner = Math.max(worstCorner, Math.abs(Math.atan((a - b) / FOCAL) / DEG));
    }
  }
  if (worstCorner > ARITHMETIC_TOL) no('projection', `worst ${worstCorner.toFixed(3)} deg over ${corners} corners`);

  // (4) THE FIVE BLOCKS, AGAINST THE PICTURE. The law lays the silhouette out
  // on the frame by itself; the reference says which column it is centred on.
  // Nothing on either side of this comparison is borrowed from the other.
  let worstPicture = 0; const seen = [];
  for (const [id, column] of REFERENCE) {
    const m = BLOCKS.find((b) => b.id === id);
    const mid = silhouetteCentre(m, POSE_VOX_DAY, (p, pose) => lawColumn(p, pose, C));
    const off = Math.abs(Math.atan((mid - column) / FOCAL) / DEG);
    worstPicture = Math.max(worstPicture, off);
    const own = C.bearingOf(m.position.x - POSE_VOX_DAY.position.x, m.position.z - POSE_VOX_DAY.position.z);
    seen.push(`${id}  law ${own.toFixed(2).padStart(7)} deg -> column ${mid.toFixed(1).padStart(7)}`
      + `   reference ${String(column).padStart(6)}   ${(mid - column).toFixed(1).padStart(6)} px = ${off.toFixed(3)} deg`);
  }
  if (worstPicture > PICTURE_TOL) no('picture', `worst ${worstPicture.toFixed(3)} deg against ${PICTURE_TOL}`);

  // (5) A FRAME READ CROSSES TWICE THE YAW. R6's trace carries its own
  // fingerprint: it runs -34.0 to +37.6, which is the lens's two edges written
  // in that convention and in no other. So carried across, the two ends of the
  // trace must land symmetrically on the two ends of the lens.
  const yaw = POSE_VOX_DAY.yaw;
  const half = Math.atan(Math.tan((POSE_VOX_DAY.fov / 2) * DEG) * (FRAME_PX.w / FRAME_PX.h)) / DEG;
  for (const [readAt, want] of [[-34.0, -half], [37.63, half]]) {
    const got = C.offAxisOf(C.bearingOfFrameRead(readAt, yaw), yaw);
    if (Math.abs(got - want) > 0.05) {
      no('read', `R6's ${readAt} lands ${got.toFixed(3)} off the axis, the lens ends at ${want.toFixed(3)}`);
    }
  }
  for (let b = -60; b <= 60; b += 3) {
    if (Math.abs(C.bearingOfFrameRead(C.frameReadOfBearing(b, yaw), yaw) - b) > 1e-9) no('read', `it does not go both ways at ${b}`);
  }

  // (6) ONE SEAT.
  const second = sources.filter((s) => s.seats.length && !s.file.endsWith('compass.js'));
  if (second.length) no('seat', second.map((s) => `${s.file}: ${s.seats.join(', ')}`).join('; '));

  return {
    bad, worstYaw, worstCorner, worstPicture, corners, seen, half,
    has: (tag) => bad.some((b) => b.tag === tag),
    why: (tag) => bad.filter((b) => b.tag === tag).map((b) => b.detail)[0] ?? '',
  };
}

// ----------------------------------------------------------- the injection
//
// SIX BENT COMPASSES AND TWO BENT FILES, and every one of them is a thing that
// has actually been written down somewhere by somebody. The first two are the
// campaign's own defect in its two shapes; the third is the half-correction
// that looks right and is not.

const compass = {
  bearingOf, bearingRadOf, directionOf, turnOf, bearingGap,
  bearingOfYaw, yawOfBearing, offAxisOf, bearingOfOffAxis,
  bearingOfFrameRead, frameReadOfBearing,
};

const DEFECTS = {
  "the compass turned the engine's way: atan2(-x, -z)":
    (c) => ({ ...c, bearingOf: (x, z) => Math.atan2(-x, -z) / DEG }),
  'the axis taken as the yaw and not its negative: offAxis = bearing - yaw':
    (c) => ({ ...c, offAxisOf: (b, y) => b - y, bearingOfOffAxis: (o, y) => o + y }),
  'a frame read carried across ONE yaw instead of two':
    (c) => ({ ...c, bearingOfFrameRead: (r, y) => r - y }),
  'the engine yaw not negated at all':
    (c) => ({ ...c, bearingOfYaw: (y) => y, yawOfBearing: (b) => b }),
  'directionOf mirrored: north put at +Z':
    (c) => ({ ...c, directionOf: (b) => [Math.sin(b * DEG), 0, Math.cos(b * DEG)] }),
  'degrees and radians drifted apart':
    (c) => ({ ...c, bearingRadOf: (x, z) => Math.atan2(x, z) }),
};

// ==========================================================================
// THE TWO LEGS THAT USED TO GATE PROSE, AND WHAT THEY GATE NOW.
//
// U-GUARDIA-3's census found this file holding TWO SENTENCES OF COMMENT,
// punctuation included, as gates: «Yaw 0 looks north (-Z). Forward is (-sin,
// -cos) and right is (cos, -sin)» in src/core/player.js, and «A BEARING is
// `atan2(x, -z)`» with «A CAMERA'S YAW is the engine's, `atan2(-x, -z)`» in
// src/world/contracts.js. A sentence is not a gate. Rewording a comment for the
// better turned this guard red; writing the sentence over an engine that had
// stopped agreeing with it turned nothing at all -- and that second failure is
// the one this campaign has already paid for, twice, with a ring of hills.
//
// WHAT THE FIRST SENTENCE ASSERTS IS ARITHMETIC, and arithmetic is asked of a
// VALUE. `engineBasis()` above is this guard's model of the camera; the thing
// it models is a YXZ Euler built from pitch and yaw, which is three's own
// object and can be built here and read back. Over the same seventy-two yaws
// and five pitches leg 2 sweeps, the two agree TO THE BIT -- worst
// disagreement 0.000e+0, measured -- so the model is no longer bridged to a
// sentence but to the engine's own rotation. That is strictly stronger: a
// sentence goes on being true while the basis moves under it, and this cannot.
//
// WHAT REMAINS FOR THE SOURCE is the one thing three cannot answer: WHICH euler
// player.js builds, and in WHICH ORDER it feeds pitch and yaw into it. That is
// read structurally -- an order of 'YXZ', and a `.set(` whose three arguments
// name pitch, then yaw, then nought -- so renaming the private field,
// re-indenting the call or rewriting the comment above it moves nothing.
//
// WHAT THE SECOND PAIR OF SENTENCES ASSERTS is that a session entering by the
// door finds the compass there. That is a list of NAMES, and it is asked as
// one: contracts.js re-exports from './compass.js', and what it re-exports has
// to cover every reading this guard itself asks the compass for. The prose
// stays where it is, doing what prose does.
// ==========================================================================

/**
 * The engine's own rotation, built by three from a YXZ euler of pitch and yaw.
 *
 * three writes a rotation in columns: the first is the camera's right, the
 * second its up, and the third is BACK -- a camera looks down its own negative
 * Z -- which is why forward is that column negated.
 */
function threeBasis(yawDeg, pitchDeg) {
  const e = new Matrix4()
    .makeRotationFromEuler(new Euler(pitchDeg * DEG, yawDeg * DEG, 0, 'YXZ')).elements;
  return {
    right: [e[0], e[1], e[2]],
    up: [e[4], e[5], e[6]],
    forward: [-e[8], -e[9], -e[10]],
  };
}

/** How far this guard's model of the camera stands from the engine's own. */
function basisGap(model = engineBasis) {
  let worst = 0;
  for (let yaw = -175; yaw <= 180; yaw += 5) {
    for (const pitch of [-40, -4.124, 0, 4.124, 40]) {
      const mine = model(yaw, pitch);
      const theirs = threeBasis(yaw, pitch);
      for (const axis of ['right', 'up', 'forward']) {
        for (let k = 0; k < 3; k++) {
          worst = Math.max(worst, Math.abs(mine[axis][k] - theirs[axis][k]));
        }
      }
    }
  }
  return worst;
}

/** The arguments of a call, split on the commas that are not inside brackets. */
function argumentsOf(call) {
  const out = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < call.length; i++) {
    const c = call[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(call.slice(from, i).trim()); from = i + 1; }
  }
  out.push(call.slice(from).trim());
  // A trailing comma is a style and not an argument.
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

/**
 * Whether the engine still turns the camera the way leg 2 is bridged to.
 *
 * BY SHAPE AND BY NAME, never by statement: a euler whose order is YXZ, and a
 * `set` of three arguments that are pitch, yaw and nought IN THAT ORDER. What
 * is pinned is two words, and a rename is one word of this reader rather than a
 * red on a correct edit.
 */
function engineTurnsPitchThenYaw(text) {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const yxz = /new\s+Euler\s*\([^)]*['"]YXZ['"][^)]*\)/.test(bare)
    || /\.order\s*=\s*['"]YXZ['"]/.test(bare);
  const ordered = [...bare.matchAll(/\.set\(([^;()]*(?:\([^()]*\)[^;()]*)*)\)\s*;/g)].some((m) => {
    const args = argumentsOf(m[1]);
    return args.length === 3 && /pitch/i.test(args[0]) && /yaw/i.test(args[1])
      && Number(args[2]) === 0;
  });
  return yxz && ordered;
}

/** Which compass readings the door re-exports from the seat. */
function doorPublishes(text) {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const found = new Set();
  for (const m of bare.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"]\.\/compass\.js['"]/g)) {
    for (const name of m[1].split(',')) {
      const bit = name.trim().split(/\s+as\s+/).pop().trim();
      if (bit) found.add(bit);
    }
  }
  return found;
}

/** Whether the door carries every reading this guard asks the compass for. */
const doorStillCarries = (text, names) => names.every((n) => doorPublishes(text).has(n));

// --------------------------------------------------------------------- run

const sources = sourcesOf();

if (process.argv.includes('--self')) {
  const cases = Object.entries(DEFECTS).map(([what, bend]) => ({
    what, caught: legs(bend(compass), sources).bad.length > 0,
  }));
  cases.push({
    what: 'a second compass planted in another file of the world',
    caught: legs(compass, [...sources, { file: 'src/world/elsewhere.js', seats: ['atan2(dx, -dz)'] }]).bad.length > 0,
  });
  cases.push({
    what: 'the world drifting three and a half degrees: every block moved by twice the yaw',
    caught: legs({ ...compass, bearingOf: (x, z) => bearingOf(x, z) - 2 * POSE_VOX_DAY.yaw }, sources).bad.length > 0,
  });
  // ---- THE BRIDGE, ASKED OF THREE AND NOT OF A SENTENCE
  //
  // The model of the camera is bent in the two ways it can be wrong -- the yaw
  // turned the other way, and the pitch fed after the yaw instead of before --
  // and both come back through the same reader the run uses.
  cases.push({
    what: "the guard's own model of the camera turned the other way round the yaw",
    caught: basisGap((yaw, pitch) => engineBasis(-yaw, pitch)) > 1e-9 && basisGap() === 0,
  });
  cases.push({
    what: 'and the same model with pitch and yaw swapped, which is a different euler order',
    caught: basisGap((yaw, pitch) => engineBasis(pitch, yaw)) > 1e-9,
  });
  // ---- AND THE ONE THING THREE CANNOT ANSWER, READ BY SHAPE
  const player = read('src/core/player.js');
  cases.push({
    what: 'the euler order dropped from YXZ, which is pitch and yaw applied the other way about',
    caught: !engineTurnsPitchThenYaw(player.replace(/'YXZ'/g, "'XYZ'")),
  });
  cases.push({
    what: 'and the two angles fed in the wrong order, which is the same defect one line down',
    caught: !engineTurnsPitchThenYaw(
      player.replace('this.#euler.set(this.#pitchF.x, this.#yawF.x, 0)',
        'this.#euler.set(this.#yawF.x, this.#pitchF.x, 0)'),
    ),
  });
  // AND THIS IS THE CASE THAT SAYS THE PIN IS GONE: the sentence reworded, the
  // field renamed, the call re-indented and broken over three lines. What used
  // to be gated here was the sentence, so every one of these turned this guard
  // red on an edit that changed nothing about the camera.
  cases.push({
    what: 'while a comment reworded, the field renamed and the call broken over three lines still passes',
    caught: engineTurnsPitchThenYaw(player
      .replace(/Yaw 0 looks north \(-Z\)\./g, 'At yaw nought the camera faces north, which is -Z.')
      .replace(/#euler/g, '#rotation')
      .replace('this.#rotation.set(this.#pitchF.x, this.#yawF.x, 0)',
        'this.#rotation.set(\n      this.#pitchF.x,\n      this.#yawF.x,\n      0,\n    )')),
  });
  // ---- THE DOOR, AS A LIST OF NAMES
  const contracts = read('src/world/contracts.js');
  const names = Object.keys(compass);
  cases.push({
    what: 'src/world/contracts.js no longer publishing the compass at all',
    caught: !doorStillCarries(contracts.replace(/from '\.\/compass\.js'/, "from './nowhere.js'"), names),
  });
  cases.push({
    what: 'and one reading quietly dropped from the door, which is how a session writes a fourth compass',
    caught: !doorStillCarries(contracts.replace(/\boffAxisOf,\s*/, ''), names),
  });
  cases.push({
    what: 'while the same list re-indented, re-ordered and given an alias still carries them all',
    caught: doorStillCarries(contracts.replace(
      /export \{\n(?:[^}]*)\n\} from '\.\/compass\.js';/,
      `export {\n  ${[...names].reverse().join(',\n  ')},\n}\n  from "./compass.js";`,
    ), names),
  });
  selfTest('guard-bussola', cases);
}

const r = reporter("guard-bussola -- there is one north, and it is the picture's");
const out = legs(compass, sources);

r.check(!out.has('compass'),
  'the compass is atan2(x, -z): north is -Z, east is +X, and its inverse agrees',
  out.why('compass') || 'four quarters, two diagonals, and 52 bearings through directionOf, bearingRadOf and turnOf');

r.check(!out.has('yaw'),
  "and the engine's yaw is that compass NEGATED, at every angle and not only at nought",
  out.why('yaw') || `72 yaws x 5 pitches through the YXZ basis player.js states, worst ${out.worstYaw.toExponential(2)} deg`);

// AND THE BRIDGE ITSELF, AGAINST THE ENGINE AND NOT AGAINST A SENTENCE. The
// model leg 2 runs on is three's own rotation or it is a guess.
r.check(basisGap() === 0,
  "and the basis leg 2 is bridged to IS the engine's own, to the bit",
  `72 yaws x 5 pitches through three's YXZ euler of (pitch, yaw, 0), worst ${basisGap().toExponential(2)}`);
r.check(engineTurnsPitchThenYaw(read('src/core/player.js')),
  'and src/core/player.js still feeds that euler pitch, then yaw, then nought',
  "an order of 'YXZ' and a set of three, read by shape so a rename is the only thing that moves it");

r.check(!out.has('projection'),
  'the direction the law computes for a block is where the engine puts it on the frame',
  out.why('projection') || `${out.corners} corners of five blocks at the fitted pose, worst ${out.worstCorner.toExponential(2)} deg against ${ARITHMETIC_TOL}`);

r.check(!out.has('picture'),
  'and it is where the REFERENCE draws the block, in first person at the day fit',
  out.why('picture') || `worst ${out.worstPicture.toFixed(3)} deg against ${PICTURE_TOL}, the floor of the reading`);
for (const line of out.seen) r.line(`          ${line}`);

r.check(!out.has('read'),
  "a bearing read off the reference crosses TWICE the yaw, and R6's own span proves it",
  out.why('read') || `-34.0 and +37.63 land on the lens's two edges at ${out.half.toFixed(2)} deg`);

r.check(!out.has('seat'),
  'and there is ONE seat: no second atan2(x, -z) anywhere in src/ or assets-src/',
  out.why('seat') || `${sources.length} sources read; the ${sources.find((s) => s.file.endsWith('compass.js')).seats.length} readings of the compass are all in src/world/compass.js`);

// AND THE DOOR CARRIES IT, so that a session reading the contracts finds the
// compass there and does not write a fourth one.
r.check(doorStillCarries(read('src/world/contracts.js'), Object.keys(compass)),
  'and src/world/contracts.js publishes every one of those readings',
  `the door every session enters by carries all ${Object.keys(compass).length}: `
  + `${[...doorPublishes(read('src/world/contracts.js'))].length} re-exported from ./compass.js`);

r.end(`one compass, bridged to the engine at three named places; the five blocks stand within ${out.worstPicture.toFixed(2)} of a degree of where the reference draws them, against ${(2 * POSE_VOX_DAY.yaw).toFixed(3)} if the bridge is dropped`);
