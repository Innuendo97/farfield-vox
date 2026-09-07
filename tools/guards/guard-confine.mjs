import {
  CAMPO_BIAS, CAMPO_FAR, CENTRE, CONFINE, NO_COLUMN, PLATEAU, VOXEL,
  basinProfile, campoGroundByte, columnSpec, confineSteps, crestRise, waterLevel,
} from '../../src/world/voxel/pure.js';
import { POSE_VOX_DAY } from '../../src/core/poses.js';
import { TUNING } from '../../src/core/presence.js';
import { read, reporter, selfTest } from './lib.mjs';

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
//   3. AND IT IS WALKABLE ALL THE WAY ROUND, so the water is what stops him on
//      every bearing there is. That is the first clause of the same sentence,
//      and it is TRUE OF MORE OF THE WORLD THAN IT USED TO BE: this leg once
//      asked the opposite of the ridge's own bearings -- that the terraces
//      there were too tall to climb -- and there is no ridge now.
//   4. AND THE WALL IS GONE, MEASURED. E-DECISIONI21, D7 = A: the crest at
//      ninety-six metres falls and hills stand beyond the water instead. What
//      that has to mean at the judging eye is that NOTHING the boundary draws
//      stands over the horizontal any more, on any of the three hundred and
//      sixty bearings -- where it used to close five to seven degrees of them
//      on eighty-five. The horizon belongs to src/world/distant.js now, and
//      guard-cornice is what holds it there.
//   5. AND THE LAW OF THE RIDGE IS STILL HERE, AT NOUGHT. `crestRise` answers
//      exactly nothing everywhere, and the dial that makes it do so is a
//      HEIGHT -- so the self test can raise it and watch the whole ridge come
//      back, crown, sway, radius and all, which is what proves the thing that
//      fell was turned off rather than quietly broken.
//   6. THE WHOLE WORLD FITS IN THE BYTE THE PICTURE HOLDS IT IN. The field
//      keeps a ground in one biased byte of voxels; the day the ridge is raised
//      past what that holds, the crown would go FLAT and nothing else would
//      say so. This sweeps the law over the far window and asserts it.
//   7. NOTHING IS QUANTISED TWICE. Every height out there is a whole number of
//      voxels, which is what makes the terraces terraces.
//   8. AND THE BASIN IS STILL THE FITTED ONE. It moved seat into confine.js;
//      the numbers it answers are pinned here against the readings E-V5f took,
//      so a move of seat can never have been a change of shape.
//   9. AND THE WATER LIES IN IT (E-DECISIONI19). «Il camminatore si ferma dove
//      comincia l'ACQUA» is only a boundary if the water is where the ground
//      says it is: a lake fitted against a framing, in a file that knows
//      nothing about the fall, floated four and a half metres over its own bed
//      for as long as nobody asked it. So this asks twice -- of the SOURCE,
//      that src/world/distant.js reads its level off the boundary instead of
//      carrying a number of its own, and of the GROUND, that the terraces come
//      down and meet that level with neither a void under the last dry tread
//      nor a step over it that a body could not take.
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
  // THE SELF TEST'S OWN HAND, AND IT HAD TO CHANGE WITH THE DIAL. It used to be
  // `CONFINE.crest.height *= 2.4` -- a ridge two and a half times the one that
  // shipped, which is the defect the byte leg exists for, because nothing about
  // the picture would look broken: the crown would simply stop climbing. With
  // the dial at nought that multiplication is nought, and a self test that
  // injects nothing catches nothing while reporting that it did. So the defect
  // is now a height, and it is the one the byte cannot hold.
  CONFINE.crest.height = 26.4;
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

// TOWARD THE WATER, which is north: the lake's own bearings.
let worstToWater = 0;
for (let deg = -12; deg <= 12; deg += 1) {
  const r = worstRiser((deg + 360) % 360, PLATEAU, 100);
  if (r.worst > worstToWater) worstToWater = r.worst;
}
report.check(worstToWater <= STEP + 1e-9,
  'a body can walk the fall to the water: no riser on it is over its own step',
  `worst riser ${(worstToWater * 100).toFixed(0)} cm against a step of ${(STEP * 100).toFixed(0)}`);

// AND ON EVERY OTHER BEARING TOO, WHICH IS NEW.
//
// The water used to be reachable on forty-one bearings out of three hundred and
// sixty and a hillside stood on the rest. With the crest gone the lake is all
// the way round at a hundred and ten metres and the fall is the whole of the
// ground everywhere, so «il camminatore si ferma dove comincia l'ACQUA» is now
// true of the whole compass rather than of the gap the reference happens to
// look through. That is a bigger promise than the old leg made, and it is
// cheaper to keep: nothing out here climbs.
let walkableBearings = 0;
let worstAnywhere = 0;
let worstAt = 0;
for (let deg = 0; deg < 360; deg += 1) {
  const r = worstRiser(deg, PLATEAU, 108);
  if (r.worst <= STEP + 1e-9) walkableBearings += 1;
  if (r.worst > worstAnywhere) { worstAnywhere = r.worst; worstAt = deg; }
}
report.check(walkableBearings === 360,
  'and so can he on every other bearing: the water is what stops him, all the way round',
  walkableBearings === 360
    ? `360 bearings, worst riser anywhere ${(worstAnywhere * 100).toFixed(0)} cm`
    : `${walkableBearings} of 360; worst ${(worstAnywhere * 100).toFixed(0)} cm at ${worstAt} deg`);

// --------------------------------------------------------------------------
// 4. AND THE WALL IS GONE, WHICH IS A MEASUREMENT AND NOT AN ASSERTION.
//
// This leg used to read the other way: «le creste terrazzate a chiudere
// l'orizzonte ai lati e dietro lo spawn» was E-DECISIONI13's own clause, and
// what shipped for it was a smooth green hump at ninety-six metres that closed
// five to seven degrees of the frame on eighty-five bearings out of a hundred
// and eight -- one material, risers all alike, chroma four and a half against
// the reference's seventeen. E-OCCHIO1 called it a wall and R6 measured it as
// one. E-DECISIONI21 answered D7 with A and it falls.
//
// The clause is still kept, by somebody else: the hills of
// src/world/distant.js close the horizon between four and ten degrees all the
// way round, fitted per direction, and guard-cornice is what holds them to it.
// What is asked HERE is the other half -- that this file has genuinely stopped
// drawing a horizon of its own, and does not merely draw a shorter one. So the
// skyline of the boundary ALONE, from the eye the campaign judges at, must lie
// under the horizontal on every bearing there is.
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

let overTheEye = 0;
let highestLine = -90;
let highestAt = 0;
for (let deg = 0; deg < 360; deg += 1) {
  const line = skyline(deg);
  if (line > 0) overTheEye += 1;
  if (line > highestLine) { highestLine = line; highestAt = deg; }
}
report.check(injected ? overTheEye > 0 : overTheEye === 0,
  injected
    ? 'raised, the wall comes back and closes the horizon again'
    : 'the boundary draws no horizon of its own: nothing it lays stands over the eye',
  `${overTheEye} of 360 bearings stand over the eye; the highest line the boundary `
  + `draws is ${highestLine.toFixed(2)} degrees, at ${highestAt}`);

// --------------------------------------------------------------------------
// 5. AND THE LAW OF THE RIDGE IS STILL HERE, AT NOUGHT.
//
// TURNED OFF AND NOT TORN OUT, and the difference is worth a leg of its own.
//
// The crown is counted from the PLATEAU while the ridge grows out of the BASIN,
// so `crestRise` adds back the four and three quarter metres the fall has
// already dropped by the time it reaches the peak. With the dial at nought and
// nothing else changed, that expression does not answer nought: it answers a
// FIVE-METRE DOME on every bearing outside the gate -- the wall at half height,
// wearing the same four-voxel riser, with the dial reading zero and nobody the
// wiser. So the law carries a line saying that a crown of nothing is no ridge,
// and this asks that the line holds at every point of the world.
//
// And when the self test raises the dial, this leg becomes the one it replaced
// and asks the ridge that comes back to be no circumference -- crown and radius
// both moving with the bearing, «NESSUNA circonferenza visibile». That is what
// proves the thing that fell was switched off and not quietly broken.
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
const standing = crowns.filter((c) => c.height !== 0).length;
report.check(injected ? (spread(hs) > 0.15 && spread(rs) > 0.05) : standing === 0,
  injected
    ? 'and the crown that comes back is not a circle: height and radius both move with it'
    : 'and the crest answers nothing everywhere, rather than the dome a bare nought would leave',
  injected
    ? `height ${(spread(hs) * 100).toFixed(0)}% of its own mean over the ridge, `
      + `radius ${(spread(rs) * 100).toFixed(0)}%; crown `
      + `${Math.min(...hs).toFixed(1)} to ${Math.max(...hs).toFixed(1)} m at `
      + `${Math.min(...rs)} to ${Math.max(...rs)} m`
    : `crest.height = ${CONFINE.crest.height}; 180 bearings x 150 m of law all answer 0`);

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
// 9. AND THE WATER LIES IN THE BASIN, AND THE TERRACES REACH IT.
//
// TWO QUESTIONS, AND THE FIRST IS ABOUT THE SOURCE ON PURPOSE. The defect
// E-DECISIONI19 named was not a wrong height, it was an UNTIED one:
// src/world/distant.js carried `y: 0.30`, read off the framing by V5 when the
// world past the disc was a flat shell, and no measurement anywhere could
// notice that the ground had since dropped out from under it. A guard that only
// checked the NUMBER would go green again the day somebody typed -4.74 into
// that file by hand -- and drift the day the basin was refit. So the first leg
// reads the file and asks that both sheets take their height from waterLevel(),
// which is the boundary's own answer and cannot be typed wrong.
//
// AND THE OTHER TWO ASK THE GROUND.
//
// Every height out there is a whole number of voxels (leg 7), so a level laid
// through the world lands in one of two places. INSIDE a riser: the water laps
// the face of a step, that face is the shore, and the clearance to the tread
// above and to the tread below add up to one riser. Or ON a tread: a whole
// annulus of ground and a plane share a single height and fight for every pixel
// of it, on every bearing at once. The first of the two legs asks that it is
// the former, and it asks it of the number alone, which is why it holds
// everywhere and not only where somebody looked.
//
// The second walks it out, ON EVERY BEARING THERE IS. It used to be only the
// forty-one the ridge stood aside for: further out the crest waded in, the
// ground climbed back over the level and met it a second time on a riser of
// four voxels, which is not a shore and was not a defect. With the crest gone
// the lake is all the way round at a hundred and ten metres, so the sweep is
// too, and «il camminatore si ferma dove comincia l'ACQUA» is now a fact about
// the whole compass rather than about the gap the reference looks through.
// --------------------------------------------------------------------------
const WATER = waterLevel();
const RISER = CONFINE.riser * VOXEL;

/**
 * Every height the standing water is laid at, as WRITTEN in the source.
 *
 * IT USED TO LOOK FOR `const LAKES = [`, AND THERE IS NO SUCH LIST NOW. The
 * water was rectangles read off the framing, and this walked the block
 * collecting each one's `y:`. R6-06 showed what that looks like from the rim --
 * their corners are visible as edges in the water, because each lay at the
 * basin's depth at its OWN radius -- and a basin holds one lake. It is a disc.
 *
 * THE QUESTION IS UNCHANGED, and it is the reason this leg reads a file instead
 * of a number. The defect E-DECISIONI19 named was not a wrong height, it was an
 * UNTIED one: `y: 0.30`, fitted by V5 when everything past the disc was a flat
 * shell, which nothing anywhere could notice had been left four and a half
 * metres in the air the day the ground dropped out from under it. A guard that
 * checked the NUMBER would go green again the moment somebody typed -4.74 into
 * that file by hand, and drift the next time the basin was refit. So what is
 * asked is that every height the water is laid at is SPELLED as the boundary's
 * own answer, which cannot be typed wrong.
 */
function sheetHeights(text) {
  const found = [];
  for (const m of text.matchAll(/\blake\.position\.y\s*=\s*([^;\n]+);/g)) {
    found.push(m[1].trim());
  }
  const open = text.indexOf('const LAKES = [');
  if (open >= 0) {
    const body = text.slice(open, text.indexOf('];', open));
    for (const m of body.matchAll(/\by:\s*([^,}\n]+)/g)) found.push(m[1].trim());
  }
  return found;
}
const distantSource = read('src/world/distant.js');
const heightsAsWritten = sheetHeights(distantSource);
// One name for the level, however the file spells the local it keeps it in;
// what may not appear is a literal.
const BOUNDARY_NAMES = new Set(['waterLevel()', 'WATER']);
const readsTheBoundary = (hs) => hs.length > 0 && hs.every((h) => BOUNDARY_NAMES.has(h));
report.check(readsTheBoundary(heightsAsWritten),
  'the standing water takes its level from the boundary and carries no number of its own',
  `${heightsAsWritten.length} sheet${heightsAsWritten.length === 1 ? '' : 's'}, laid at `
  + `${[...new Set(heightsAsWritten)].join(' and ')} = ${WATER.toFixed(4)} m`);

// AND THERE IS ONE OF THEM (E-DECISIONI21, and R6 §4.5). Sheets at three radii
// of one basin stand at three heights and show their corners; one disc cannot.
const hasRectangles = (text) => /const LAKES = \[/.test(text);
report.check(!hasRectangles(distantSource) && heightsAsWritten.length === 1,
  'and it is one sheet: a basin holds one lake, and one lake has no corners in it',
  hasRectangles(distantSource) ? 'the rectangles are back'
    : `${heightsAsWritten.length} disc at ${WATER.toFixed(4)} m`);

// AND THE LEVEL ITSELF LIES INSIDE A RISER, which is a fact about one number
// and therefore true on every bearing there is.
const clearAbove = (Math.ceil(WATER / VOXEL) * VOXEL) - WATER;
const clearBelow = WATER - (Math.floor(WATER / VOXEL) * VOXEL);
const insideARiser = (level) => {
  const above = (Math.ceil(level / VOXEL) * VOXEL) - level;
  const below = level - (Math.floor(level / VOXEL) * VOXEL);
  return above > 0.001 && below > 0.001;
};
report.check(insideARiser(WATER),
  'and it lies inside a riser and not on a tread, so no annulus of ground shares its plane',
  `${(clearAbove * 100).toFixed(2)} cm under the tread above it and `
  + `${(clearBelow * 100).toFixed(2)} cm over the one below, of a `
  + `${(RISER * 100).toFixed(0)} cm riser`);

/**
 * Where the fall meets a level, on one bearing.
 *
 * @param {number} deg    bearing from north
 * @param {number} level  metres, the surface of the water
 * @returns {?object} the last dry tread, the first drowned one, and how far
 *                    each stands from the surface; null if the fall never
 *                    reaches it at all
 */
function shore(deg, level) {
  const a = deg * DEG;
  const ux = Math.sin(a);
  const uz = -Math.cos(a);
  let dry = null;
  for (let r = PLATEAU; r < REACH; r += VOXEL) {
    const h = confineSteps(CENTRE.x + ux * r, CENTRE.z + uz * r, CENTRE) * VOXEL;
    if (h > level) { dry = h; continue; }
    return { r, dry, wet: h, over: dry === null ? 0 : dry - level, under: level - h };
  }
  return null;
}

// EVERY BEARING THERE IS, WHICH IS THE OTHER THING D7 CHANGED.
//
// This used to be the forty-one bearings the ridge stood aside for -- `gate()`
// is nought at gateFrom and inwards -- because on all the rest the crest waded
// in, the ground climbed back over the level and met it a SECOND time on a
// riser of four voxels, which is not a shore. There is no crest, so there is no
// second meeting: the fall is the whole of the ground on the whole compass and
// the shore is a shore everywhere. Sweeping the old forty-one now would be
// looking at an eighth of the water and calling it the lake.
const OPEN = [];
for (let d = 0; d < 360; d += 1) OPEN.push(d);

function shoreFaults(level) {
  const bad = [];
  for (const deg of OPEN) {
    const s = shore(deg, level);
    if (s === null) { bad.push({ deg, why: 'the fall never reaches the water' }); continue; }
    if (s.dry === null) { bad.push({ deg, why: 'the water stands over the plateau itself' }); continue; }
    if (!(s.over > 0 && s.over < RISER)) {
      bad.push({ deg, why: `${(s.over * 100).toFixed(1)} cm of dry tread over the surface` });
      continue;
    }
    if (!(s.under > 0 && s.under < RISER)) {
      bad.push({ deg, why: `${(s.under * 100).toFixed(1)} cm of drowned tread under it` });
      continue;
    }
    if (Math.abs(s.over + s.under - RISER) > 1e-9) {
      bad.push({ deg, why: 'the step at the shore is not one riser' });
    }
  }
  return bad;
}

const faults = shoreFaults(WATER);
const north = shore(0, WATER);
report.check(faults.length === 0,
  'and the terraces come down and meet it: no void under the last dry tread, no step over it',
  faults.length
    ? `${faults.length} of ${OPEN.length} bearings, first at ${faults[0].deg} deg: ${faults[0].why}`
    : `${OPEN.length} bearings open on the water; due north the shore is at `
      + `${north.r.toFixed(2)} m, with the last dry tread ${(north.over * 100).toFixed(1)} cm `
      + `over the surface and the first drowned one ${(north.under * 100).toFixed(1)} cm under `
      + `it -- one riser of ${(RISER * 100).toFixed(0)} cm between them`);

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
    {
      what: 'a sheet of water given a height of its own again',
      caught: !readsTheBoundary(['waterLevel()', '0.30']),
    },
    {
      what: 'and one that reads the boundary is not called a defect',
      caught: readsTheBoundary(['waterLevel()']),
    },
    {
      what: 'the rectangles coming back, corners and all',
      caught: hasRectangles('const LAKES = [{ x: -37, y: waterLevel() }];'),
    },
    {
      what: 'and one disc is not mistaken for them',
      caught: !hasRectangles(distantSource),
    },
    {
      what: 'the level V5 fitted before the world had a basin (+0.30 m)',
      caught: shoreFaults(0.30).length > 0,
    },
    {
      what: 'a level quantised onto a tread, which would fight it for every pixel',
      caught: !insideARiser(Math.round(WATER / VOXEL) * VOXEL),
    },
    {
      what: 'and the level that ships is not itself called one',
      caught: insideARiser(WATER),
    },
    {
      what: 'and a lake sunk under the bed of the world, which the terraces never reach',
      caught: shoreFaults(-12).length > 0,
    },
    {
      what: 'while the level that ships is met on every one of those bearings',
      caught: shoreFaults(WATER).length === 0,
    },
  ]);
}

report.end(`the plateau is ${PLATEAU} m; the fall reaches `
  + `${(deepest * VOXEL).toFixed(1)} m and the boundary climbs `
  + `${(highest * VOXEL).toFixed(1)} m over it -- the crest fell (E-DECISIONI21, D7 = A) and `
  + `the horizon is guard-cornice's now -- all inside ${REACH} m of far window, with the water `
  + `at ${WATER.toFixed(4)} m in it and reachable on all 360 bearings`);
