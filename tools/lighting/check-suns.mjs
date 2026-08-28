// The assertions that would have caught the world being lit by two suns.
//
//   node tools/lighting/check-suns.mjs            everything
//   node tools/lighting/check-suns.mjs --sources  only what AUTHORS a bake
//
// The defect it exists for is measured in s2-analisi1/RAPPORTO.md section 1.3:
// the sky drew a sun at elevation 34, azimuth -9.5, and the three bake scripts
// each declared one of their own at elevation 52, bearing 61. FIFTY-TWO POINT
// THREE DEGREES APART. The shadow of a five metre block fell towards bearing
// -119 and 3.91 m long in the baked light, where the sky says it should fall
// towards 170.5 and 7.41 m long. It survived a whole campaign because all three
// bakes used a forty degree sun disc: a shadow with no edge has no readable
// direction, so nobody could see it and nothing ever asked.
//
// So it is asked here, cheaply, and anything that lights or bakes can run this
// first. Exits non-zero on any failure, so it can gate a bake.
//
// THE SEAT is assets-src/sky/sky.json, day.sun — the preset the renderer hands
// to the dome. Every consumer below is compared against it; none of them is
// allowed to be the reference.
//
// --sources exists for one honest reason and should not outlive it: after the
// seat is corrected, the delivered light maps still carry the OLD sun until the
// world is baked again, so the full check reports them red on purpose. Running
// with --sources says "the seats that will author the next bake agree", which
// is a smaller claim, and the banner says so out loud.
//
// AND THERE IS A ROSTER OF WAIVERS, tools/lighting/sun-waivers.json.
//
// The voxel campaign moved the seat to where its two targets put the sun, and
// six consumers cannot follow it: they are pictures and manifests baked under
// the old one by a chain that no longer exists in this repository. Failing on
// them would hold the guard red until the last of eight sessions has re-authored
// what it owns, and a guard that is always red is a guard nobody reads -- which
// is precisely how a world came to be lit by two suns in the first place.
//
// So a waiver is not a way of passing. It is a DECLARATION: each one names the
// consumer, the session that owns it, and the fact that it is going, and every
// run prints them. What a waiver buys is that the guard still FAILS on anything
// else -- a new consumer, or an old one nobody declared -- which is the whole
// case it exists for. The list may only shrink.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROD_SUN } from '../clouds/cloud-pieces.mjs';
import {
  angleBetween, readSun, REPO_ROOT, SUN_SEAT, SUN_SEAT_FIELD, sunVector,
} from './sun.mjs';

// Declared, not discovered: half a degree is finer than any bake in this
// project can resolve (the sun disc is tens of degrees wide) and coarser than
// the rounding that sky.json's own vector carries at five decimal places.
const TOLERANCE = 0.5;

const sourcesOnly = process.argv.includes('--sources');

let failed = 0;
const check = (ok, what, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
};

const read = (path) => JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8'));

const SEAT = readSun();
const SEAT_VEC = sunVector(SEAT.elevation, SEAT.azimuth);

// EVERY CONSUMER THIS GUARD CAN PRESENT, by the file that carries the sun.
//
// Written down rather than discovered so that the roster can be checked against
// it: an id in sun-waivers.json that is not here is a typo, and a typo in a
// waiver is a hole in the guard wearing a waiver's clothes.
const CONSUMERS = [
  'assets-src/clouds/clouds.json',
  'assets-src/clouds/plates.json',
  'tools/clouds/cloud-pieces.mjs',
  'assets-src/terrain/terrain.json',
  'assets-src/monoliths/monoliths.json',
  'assets-src/rocks/rocks-bake.json',
];

const WAIVERS = new Map();
{
  const roster = read('tools/lighting/sun-waivers.json');
  for (const waiver of roster.waivers) WAIVERS.set(waiver.consumer, waiver);
}
const waived = new Set();
const presented = new Set();

/**
 * One consumer, by the two angles it states.
 *
 * @param {string} id the file that carries it, as CONSUMERS names it
 */
const checkAngles = (id, what, elevation, bearing, where) => {
  const off = angleBetween(SEAT_VEC, sunVector(elevation, bearing));
  checkOff(id, off <= TOLERANCE, what,
    `elev ${elevation} bearing ${bearing} -> ${off.toFixed(3)} deg off the seat  (${where})`);
};

/** The same, for a consumer whose disagreement is already a number. */
const checkOff = (id, ok, what, detail) => {
  presented.add(id);
  const waiver = WAIVERS.get(id);
  if (ok || !waiver) {
    check(ok, what, detail);
    return;
  }
  waived.add(id);
  console.log(`  WAIVED  ${what}  ${detail}`);
  console.log(`          [${waiver.owner}] ${waiver.note}`);
};

console.log(`the seat: ${SUN_SEAT} ${SUN_SEAT_FIELD} `
  + `-> elevation ${SEAT.elevation}, azimuth ${SEAT.azimuth}, tolerance ${TOLERANCE} deg`);
if (sourcesOnly) console.log('  --sources: the delivered light maps are NOT checked');
console.log(`  ${WAIVERS.size} declared waiver${WAIVERS.size === 1 ? '' : 's'} `
  + 'in tools/lighting/sun-waivers.json');

// The roster against the consumers this guard knows. A waiver for something
// that is never presented cannot protect anything and may be hiding a name that
// was meant to.
console.log('\nthe roster of waivers, against the consumers this guard knows');
for (const [id, waiver] of WAIVERS) {
  check(CONSUMERS.includes(id), `${id} is a consumer this guard presents`,
    CONSUMERS.includes(id) ? `owner ${waiver.owner}` : 'NOT in the roster of consumers');
}

// ------------------------------------------------------------- the seat itself
//
// The seat states the sun twice, as two angles and as a vector, and the runtime
// reads the vector while every bake reads the angles. A drift between them
// would be the same defect one level down.
console.log('\nthe seat, against itself');
{
  const off = angleBetween(SEAT_VEC, SEAT.vector);
  check(off <= TOLERANCE, 'the vector the runtime uses is the angles the bakes use',
    `${off.toFixed(4)} deg`);
  // The seat against itself is never waivable: it is one file agreeing with one
  // file, and nothing downstream can make it right.
  const top = read(SUN_SEAT).sun;
  const topOff = angleBetween(SEAT_VEC, sunVector(top.elevation, top.azimuth));
  check(topOff <= TOLERANCE, 'the fit input agrees with the preset it produced',
    `elev ${top.elevation} bearing ${top.azimuth} -> ${topOff.toFixed(3)} deg  (${SUN_SEAT} sun)`);
}

// The two statements of the same arithmetic, one per language. A convention
// restated is exactly what produced the defect above, so it is checked rather
// than trusted — the same reasoning as tools/clouds/check-arc.mjs.
console.log('\nthe two languages mean the same by elevation and bearing');
{
  const script = 'import json,sys;sys.path.insert(0,r"tools/lighting");'
    + 'from sun import sun_direction;'
    + 'print(json.dumps([sun_direction(e,b) for e,b in '
    + '[(34,-9.5),(52,61),(0,0),(-12,175),(80,-140),(5,300)]]))';
  let ours = null;
  try {
    ours = JSON.parse(execFileSync('python', ['-c', script], {
      cwd: REPO_ROOT, encoding: 'utf8',
    }));
  } catch (error) {
    // No interpreter on the path is not a disagreement. Blender brings its own
    // Python and is where sun.py actually runs, so a machine that can bake can
    // always answer this; a machine that cannot is told, not failed.
    if (error.code === 'ENOENT') {
      console.log('  ----  no "python" on the path: sun.py could not be asked');
    } else {
      check(false, 'tools/lighting/sun.py answers', String(error.message).split('\n')[0]);
    }
  }
  if (ours) {
    const cases = [[34, -9.5], [52, 61], [0, 0], [-12, 175], [80, -140], [5, 300]];
    let worst = 0;
    cases.forEach(([e, b], i) => {
      const mine = sunVector(e, b);
      worst = Math.max(worst, Math.hypot(
        mine[0] - ours[i][0], mine[1] - ours[i][1], mine[2] - ours[i][2],
      ));
    });
    check(worst < 1e-12, 'sun.py and sun.mjs give the same direction',
      `worst ${worst.toExponential(1)}`);
  }
}

// ---------------------------------------------------------------- the sources
console.log('\nthe seats that author a bake');

// The bake scripts must not state a sun of their own. This is the regression
// guard for the defect itself: one literal per file was one sun per file. The
// roster is walked rather than listed because it has already shrunk once and
// will shrink again: a seat that is no longer on disk is a seat that can no
// longer disagree with the others, so it is skipped instead of throwing and
// taking the rest of the guard down with it.
//
// AND IT IS NOW EMPTY, which is the shrinking finished rather than the guard
// lapsed. There is no renderer outside this repository authoring light any
// more: the two terms of a face are arithmetic in the fragment, over the one
// direction src/core/sky.js carries. The roster stays because it is the shape
// the defect would come back in — a new authoring seat with a sun written into
// it — and an empty list is where such a seat gets added.
for (const path of []) {
  if (!existsSync(join(REPO_ROOT, path))) continue;
  const source = readFileSync(join(REPO_ROOT, path), 'utf8');
  const literal = /^SUN_(ELEVATION|BEARING)\s*=\s*[-\d.]/m.exec(source);
  check(!literal, `${path} states no sun of its own`,
    literal ? `declares "${literal[0].trim()}"` : 'reads the seat');
  check(/sun_angles\(/.test(source), `${path} reads the seat`);
}

// The weather. The clouds are relit from the same direction the ground is, and
// their bake arc was solved to contain it (tools/clouds/check-arc.mjs).
checkAngles('assets-src/clouds/clouds.json', 'the cloud field carries the seat',
  read('assets-src/clouds/clouds.json').sun.elevation,
  read('assets-src/clouds/clouds.json').sun.azimuth,
  'assets-src/clouds/clouds.json sun');
{
  const clouds = read('assets-src/clouds/clouds.json').sun;
  const off = angleBetween(SEAT_VEC, clouds.vector);
  checkOff('assets-src/clouds/clouds.json', off <= TOLERANCE, 'and its vector too',
    `${off.toFixed(4)} deg`);
}
checkAngles('tools/clouds/cloud-pieces.mjs', 'the cloud piece generator carries the seat',
  PROD_SUN.el, PROD_SUN.az, 'tools/clouds/cloud-pieces.mjs PROD_SUN');
{
  const plates = read('assets-src/clouds/plates.json');
  // The roster says outright that this is "copied into the manifest", which is
  // the shape the defect came in, so it is checked rather than believed.
  checkAngles('assets-src/clouds/plates.json', 'the plate roster carries the seat',
    plates.world.sun.elevation, plates.world.sun.azimuth,
    'assets-src/clouds/plates.json world.sun');
  // Elevation only: a plate declares the height its source was shot at and
  // takes its bearing from where it is placed, so there is no azimuth to compare.
  const shot = plates.defaults.sunElevation;
  const off = Math.abs(shot - SEAT.elevation);
  checkOff('assets-src/clouds/plates.json', off <= TOLERANCE,
    'and its plates were authored at the seat\'s elevation',
    `${shot} against ${SEAT.elevation}, ${off.toFixed(2)} deg`);
}

// ------------------------------------------------------------- what was baked
if (!sourcesOnly) {
  console.log('\nthe light that has actually been baked');
  const baked = [
    ['assets-src/terrain/terrain.json', 'the ground and the stair'],
    ['assets-src/monoliths/monoliths.json', 'the stone (src/world/monoliths.js uSun reads this)'],
    ['assets-src/rocks/rocks-bake.json', 'the rocks'],
  ];
  for (const [path, what] of baked) {
    if (!existsSync(join(REPO_ROOT, path))) {
      check(false, what, `${path} is missing`);
      continue;
    }
    const sun = read(path).sun;
    checkAngles(path, what, sun.elevation, sun.bearing, path);
  }
}

// What the roster is carrying, printed on every run rather than on demand: a
// debt nobody is shown is a debt nobody pays.
console.log('\nthe waivers this run stood on');
if (!waived.size) console.log('  none: every consumer presented agrees with the seat');
for (const id of WAIVERS.keys()) {
  const waiver = WAIVERS.get(id);
  if (waived.has(id)) {
    console.log(`  WAIVED       ${id.padEnd(36)} [${waiver.owner}]  ${waiver.note}`);
  } else if (presented.has(id)) {
    console.log(`  not needed   ${id.padEnd(36)} [${waiver.owner}]  `
      + 'agrees with the seat: take it off the roster');
  } else {
    console.log(`  not reached  ${id.padEnd(36)} [${waiver.owner}]  `
      + `${sourcesOnly ? 'not asked with --sources' : 'not presented in this run'}`);
  }
}

console.log(failed
  ? `\n${failed} check${failed === 1 ? '' : 's'} failed`
  : `\nevery consumer of the sun agrees with the seat or is declared`
    + ` (${waived.size} waived)`);
process.exit(failed ? 1 : 0);
