import { POSE_VOX_DAY, POSES } from '../../src/core/poses.js';
import { CENTRE, waterLevel } from '../../src/world/voxel/pure.js';
import {
  checkSpec, cubeAt, frontierAt, groundTop as skylineGround, hillAt, ladders,
  planeAt, quietAt, ridgeLampSeats, skylineAt,
} from '../../assets-src/distant/cornice.mjs';
import {
  BANDS, FRAME, FREE_SHOULDER, GAP_HALF, MARCH, NEAR, MIDDLE, FAR, PALE,
  TOLERANCE, highestRead, inFrame, skylineBearings,
} from '../../assets-src/distant/fit-cornice.mjs';
import { read, readJson, reporter, selfTest } from './lib.mjs';

// GUARD-CORNICE -- THE HORIZON IS THE ONE THE REFERENCE HAS, PER DIRECTION.
//
// ===========================================================================
// WHAT IT REPLACED, AND WHY NONE OF IT COULD BE AMENDED.
//
// The guard that stood here judged a PAINTED cornice: three rings of quad at
// 150, 260 and 420 metres, the beds and the ledges drawn as a tone across them,
// spires as a declared placeholder, a floor, six giants and three rectangles of
// water. It asked good questions of that thing -- the step of a course in
// degrees, the ledger of beds, that the patches were a field of the world and
// not a vertex attribute -- and every one of them is about a mesh that has
// stopped existing. E-DECISIONI21 answered D7 with A: the crest at ninety-six
// metres and the giants fall, and there are hills of real cubes beyond the
// water instead. A cube has no tone to paint a bed onto.
//
// It was also STALE -- E-PERF3 recorded it red in the cammino for a contract it
// had not followed -- which is the second half of why this is a rewrite: a
// guard nobody can run is not a check, it is a file.
//
// ===========================================================================
// WHAT IT ASKS, AND EVERY LEG IS ONE LINE OF THE MANDATE (R6 §7).
//
//   1. THE SKYLINE IS THE REFERENCE'S, PER DIRECTION, INSIDE HALF A DEGREE, at
//      every bearing R6 traced a plane at -- and PER PLANE, because at -34 the
//      reference shows the near flank at 8.1 with a farther crest at 9.5 over
//      it, and at +31.6 the near flank at 4.6 with a middle crest at 6.2 over
//      that. A guard that only asked about the topmost of them would pass a
//      world with one hill in it.
//   2. AND IT CLOSES ALL THE WAY ROUND, between four and ten degrees outside
//      the lake's gap and between two and seven inside it, from the judging eye
//      -- and from the middle of the meadow and the rim it merely CLOSES, which
//      is a different question asked on purpose: see the note over leg 2.
//   3. THE CUBE IS THE SAME ANGLE ON EVERY PLANE, between 0.22 and 0.45
//      degrees, measured where the skyline actually stands. That is the law
//      R6 §2.2 found -- five to eight pixels on the near flank, on the middle
//      crest and on the palest ridge alike -- and it is the one thing that
//      makes four planes read as one world seen at four distances.
//   4. THERE IS NO LINE. Not measured as blur -- E-DECISIONI13 forbids one and
//      the reference has none either, its own sky-to-hill edge taking ONE pixel
//      -- but as what a line actually IS, and in R6 §7's own two numbers: no
//      stretch longer than three fifths of the judging lens over which the
//      skyline never leaves one ROW of the frame. A true wall runs 58 degrees
//      of compass that way; these hills run nine.
//   5. THE WATER REACHES THE SHORE THE REFERENCE READS, at minus two point
//      three degrees at the sides, and runs out of sight down the gap -- and it
//      is ONE level, the boundary's own, with no hill inside the meadow's own
//      shore where two systems would be drawing the same ground.
//   6. IT COSTS WHAT WAS BUDGETED -- the amendment to §2.9 that R6 §7 proposes
//      and this delivery declares under REGOLA R4: milliseconds, draws, card
//      bytes and delivered bytes rather than triangles, because E-PERF5
//      established that this card spends in pixels and not in vertices.
//   7. AND THE CONTRACT V7 IS OWED IS ANSWERED, on real treads, under the rock
//      line, by the name E-V5a ratified.
//
// ===========================================================================
// WHAT IT DELIBERATELY DOES NOT ASSERT.
//
// THE COLOUR OF ANYTHING. The palette is two classes, and the quotas that
// decide how much of the hill is lit stone, shadowed stone and grass are
// U-CORNICE-2's to hit -- R6 §2.4 measured them and this unit was not asked
// for them. A guard that pinned them now would pin the next unit's work to the
// first thing that happened to be there.
//
// THE AIR. src/world/air.js is the coordinator's frozen seat and D-R6-4 is a
// question the committente has not answered. What IS asked, in leg 6, is the
// one thing that is this file's business: that the frame reads the seat rather
// than growing a second fog of its own.
//
// AND IT NEEDS NO BROWSER. The skyline of a field of cubes seen from a pose is
// arithmetic, so all of this is asked under plain node at every commit rather
// than at every screenshot. What a browser would answer -- the milliseconds --
// is measured at the session's own bench and carried into leg 6 as a reading
// this guard checks the SOURCE of the budget against, not as a picture.

const report = reporter('guard-cornice -- the horizon is the reference\'s, per direction');

const DEG = Math.PI / 180;
const SPEC_PATH = 'assets-src/distant/cornice.json';
const SPEC = readJson(SPEC_PATH);
const injected = process.argv.includes('--inject');

if (injected) {
  // The self test's own hand: the near flank flattened by a fifth. It is the
  // defect leg 1 exists for, and it is the shape of the one R6 measured on the
  // prototype -- a law fitted to its own crown rather than to what the eye sees
  // of it, out by half a degree to three and a half.
  for (let k = 0; k < SPEC.ridges[0].profile.length; k++) SPEC.ridges[0].profile[k] *= 0.8;
}

checkSpec(SPEC);

const LADS = ladders(SPEC);
const WATER = waterLevel();
const EYES = {
  fitted: {
    x: POSE_VOX_DAY.position.x, y: POSE_VOX_DAY.position.y, z: POSE_VOX_DAY.position.z,
  },
  centre: { x: CENTRE.x, y: POSE_VOX_DAY.position.y, z: CENTRE.z },
  rim: { x: 0, y: POSE_VOX_DAY.position.y, z: CENTRE.z - 35 },
};
// The rim pose the campaign already judges cost at, if the register carries it.
if (POSES['bordo-indietro']) {
  const p = POSES['bordo-indietro'].position;
  EYES['bordo-indietro'] = { x: p.x, y: p.y, z: p.z };
}

// --------------------------------------------------------------------------
// 1. THE SKYLINE IS THE REFERENCE'S, PER DIRECTION AND PER PLANE.
// --------------------------------------------------------------------------
const PLANES = [
  { rows: NEAR, ridge: 0, what: 'the near flank' },
  { rows: MIDDLE, ridge: 1, what: 'the middle crest' },
  { rows: FAR, ridge: 2, what: 'the far crest' },
  { rows: PALE, ridge: 3, what: 'the pale hills' },
];

/** Every reading of every plane, against what this law answers. */
export function planeMisses(spec, lads) {
  const out = [];
  for (const plane of PLANES) {
    for (const row of plane.rows) {
      const { elevation, at } = planeAt(spec, EYES.fitted, row[0], plane.ridge, lads, MARCH);
      out.push({
        what: plane.what, ridge: plane.ridge, bearing: row[0], reading: row[1],
        elevation, at, off: Math.abs(elevation - row[1]),
      });
    }
  }
  return out;
}

const planes = planeMisses(SPEC, LADS);
const worstPlane = planes.reduce((m, r) => (r.off > m.off ? r : m), planes[0]);
const planesOver = planes.filter((r) => r.off > TOLERANCE);
report.check(planesOver.length === 0,
  `every plane the reference draws stands where it draws it, inside ${TOLERANCE} of a degree`,
  planesOver.length
    ? `${planesOver.length} of ${planes.length} out, worst ${worstPlane.off.toFixed(2)} deg `
      + `(${worstPlane.what} at ${worstPlane.bearing}: ${worstPlane.elevation.toFixed(2)} `
      + `against ${worstPlane.reading})`
    : `${planes.length} readings on four planes, worst ${worstPlane.off.toFixed(3)} deg `
      + `(${worstPlane.what} at ${worstPlane.bearing} deg)`);

/** The skyline against the highest plane read at each bearing. */
export function skylineMisses(spec, lads) {
  const out = [];
  for (const bearing of skylineBearings()) {
    if (FREE_SHOULDER.some((f) => bearing > f[0] && bearing < f[1])) continue;
    const highest = highestRead(bearing);
    if (highest === null) continue;
    const { elevation, at } = skylineAt(spec, EYES.fitted, bearing, lads, MARCH);
    out.push({ bearing, highest, elevation, at, off: Math.abs(elevation - highest) });
  }
  return out;
}

const skyline = skylineMisses(SPEC, LADS);
// THE RIGHT-HAND GAP IS A BAND AND NOT A POINT, AND SAYING SO IS HONEST RATHER
// THAN CONVENIENT. What stands highest there in the reference is a row of grey
// spires at +3.7 degrees, on a crest that reads +2.2 under them. Spires are
// cubes and cubes on the crest are U-CORNICE-2's, so what is held here is the
// crest and a ceiling at the top of the spires: the next unit may raise the
// silhouette to 3.7 without moving anything this one solved, and may not go
// past it.
const GAP_BAND = { bearing: 17, band: [1.7, 3.9] };
const skylineOver = skyline.filter((r) => {
  if (Math.abs(r.bearing - GAP_BAND.bearing) < 0.5) {
    return r.elevation < GAP_BAND.band[0] || r.elevation > GAP_BAND.band[1];
  }
  return r.off > TOLERANCE;
});
const worstSkyline = skyline.reduce((m, r) => (r.off > m.off ? r : m), skyline[0]);
report.check(skylineOver.length === 0,
  'and no ridge nobody measured stands over one everybody did',
  skylineOver.length
    ? `${skylineOver.length} of ${skyline.length} out, first at ${skylineOver[0].bearing} deg: `
      + `${skylineOver[0].elevation.toFixed(2)} against ${skylineOver[0].highest}`
    : `${skyline.length} bearings, worst ${worstSkyline.off.toFixed(3)} deg at `
      + `${worstSkyline.bearing}`);

// --------------------------------------------------------------------------
// 2. AND IT CLOSES ALL THE WAY ROUND.
//
// FROM THE JUDGING EYE THE BAND IS THE REFERENCE'S OWN -- four to ten degrees
// outside the lake's gap, two to seven inside it (R6 §2.1: «nel varco NON
// chiude: acqua fino alla riva lontana, poi colline a +2..+7»).
//
// FROM THE OTHER EYES IT IS A DIFFERENT QUESTION, ON PURPOSE. R6 §7 asks for
// the band «dal centro e dall'orlo» as well, and carrying the same two numbers
// there would be arithmetic rather than care: the rim stands thirty-five metres
// nearer the hills on one side, and the SAME ground read from 150 m instead of
// 185 reads 12.3 degrees where it read 10. Held to ten from there, a fit would
// have to lower a ridge the traced flank has already pinned -- it would be
// fitting the guard instead of the picture. So what is asked from the other
// eyes is the property those eyes are there to test, stated as itself: that the
// horizon CLOSES, so no hole opens in it when the walker moves, and that it
// does not become a wall.
// --------------------------------------------------------------------------
export function bandMisses(spec, lads, eyes) {
  const out = [];
  for (const name of Object.keys(eyes)) {
    for (let b = -180; b < 180; b += 1) {
      // THE REFERENCE'S OWN BAND ONLY WHERE THE REFERENCE CAN SEE. The picture
      // spans -33.99 to +37.63 degrees from north, which is exactly where R6's
      // trace begins and ends; -35 is not a bearing the reference has an
      // opinion about, and holding it to a number read off the picture is
      // claiming a measurement nobody took. Outside the frame the question is
      // the one the other two eyes are here to ask.
      const bands = name === 'fitted' && inFrame(b) ? BANDS.fitted : BANDS.elsewhere;
      const away = Math.abs(((b + 540) % 360) - 180);
      const band = away < GAP_HALF ? bands.gap : bands.closed;
      const { elevation, at } = skylineAt(spec, eyes[name], b, lads, MARCH);
      const off = elevation < band[0] ? band[0] - elevation
        : elevation > band[1] ? elevation - band[1] : 0;
      if (off > 0) out.push({ eye: name, bearing: b, elevation, at, band, off });
    }
  }
  return out;
}

const band = bandMisses(SPEC, LADS, EYES);
const worstBand = band.reduce((m, r) => (r.off > m.off ? r : m), { off: 0 });
report.check(band.length === 0,
  'the horizon closes on every bearing, from the eye, the middle of the meadow and the rim',
  band.length
    ? `${band.length} bearings out, worst ${worstBand.off.toFixed(2)} deg from the `
      + `${worstBand.eye} at ${worstBand.bearing} (${worstBand.elevation.toFixed(2)} deg)`
    : `${Object.keys(EYES).length} eyes x 360 bearings; inside the frame `
      + `(${(FRAME.yaw - FRAME.halfAngle).toFixed(1)} to `
      + `${(FRAME.yaw + FRAME.halfAngle).toFixed(1)} deg) the reference's own `
      + `[${BANDS.fitted.closed.join(', ')}] outside the gap and `
      + `[${BANDS.fitted.gap.join(', ')}] inside it, elsewhere `
      + `[${BANDS.elsewhere.closed.join(', ')}]: it closes and is not a wall`);

// --------------------------------------------------------------------------
// 3. THE CUBE IS THE SAME ANGLE ON EVERY PLANE.
//
// MEASURED WHERE THE SKYLINE ACTUALLY STANDS AND NOT AT THE RINGS' FRONTIERS,
// because a frontier is not a place anybody looks: the ring nearest the shore
// begins at a hundred and twelve metres, where its cube would read half a
// degree, and no silhouette is ever formed there -- the ground is still under
// the water. What the reference measured is the cube of the hill it can see,
// and that is what this asks for.
// --------------------------------------------------------------------------
const CUBE_BAND = [0.22, 0.45];

export function cubeSizes(spec, lads) {
  const out = [];
  for (let b = -180; b < 180; b += 1) {
    const { at } = skylineAt(spec, EYES.fitted, b, lads, MARCH);
    if (!at) continue;
    const ux = Math.sin(b * DEG);
    const uz = -Math.cos(b * DEG);
    const h = hillAt(spec, EYES.fitted.x + ux * at, EYES.fitted.z + uz * at);
    out.push({ bearing: b, at, degrees: Math.atan2(cubeAt(spec, h.r, h.bearing), at) / DEG });
  }
  return out;
}

const cubes = cubeSizes(SPEC, LADS);
const cubesOut = cubes.filter((c) => c.degrees < CUBE_BAND[0] || c.degrees > CUBE_BAND[1]);
const smallest = Math.min(...cubes.map((c) => c.degrees));
const largest = Math.max(...cubes.map((c) => c.degrees));
report.check(cubesOut.length === 0,
  `the cube is the same angle on every plane, between ${CUBE_BAND[0]} and ${CUBE_BAND[1]} degrees`,
  cubesOut.length
    ? `${cubesOut.length} of ${cubes.length} bearings out, first ${cubesOut[0].degrees.toFixed(3)} `
      + `deg at ${cubesOut[0].bearing} (${cubesOut[0].at} m)`
    : `${cubes.length} bearings, ${smallest.toFixed(3)} to ${largest.toFixed(3)} deg `
      + `= ${(smallest * 20.2).toFixed(1)} to ${(largest * 20.2).toFixed(1)} px of the frame`);

// AND IT GROWS WITH ITS DISTANCE, which is the law under the band: s(D) = D/190.
const drift = cubes.map((c) => Math.abs(cubeAt(SPEC, c.at, c.bearing * DEG) - c.at / SPEC.cubePerMetre));
report.check(Math.max(...drift) < 3.5,
  'and it is the same law at every distance: a cube is its own distance over 190',
  `worst departure ${Math.max(...drift).toFixed(2)} m, over cubes of `
  + `${SPEC.rings.cubes.join(', ')} m`);

// --------------------------------------------------------------------------
// 4. THERE IS NO LINE.
//
// AND IT IS NOT MEASURED AS BLUR. E-DECISIONI13 forbids a blur outright, and
// R6 §2.6 measured that the reference does not have one either: its own
// sky-to-hill edge takes ONE pixel to go from a tenth of the step to nine
// tenths, sharper than ours. There is no line in it for a different reason --
// «non c'è mai una riga di cielo sopra un piano solo»: the skyline climbs and
// drops in steps, and behind every plane there is another.
//
// So what a line IS, stated as geometry: a long run of bearings whose skyline
// stands at the same elevation. This asks that no elevation, to a tenth of a
// degree, is shared by too much of the compass at once.
// --------------------------------------------------------------------------
// A LINE IS A CONTIGUOUS RUN AT ONE ROW OF THE FRAME, AND BOTH NUMBERS ARE
// R6's OWN.
//
// R6 §7 asks for «nessuna riga del quadro in cui piu' del 60% delle colonne di
// terra-oltre-l'acqua condivida la stessa transizione entro +-1 riga». Read as
// geometry rather than as pixels, that is: no stretch of the compass longer
// than three fifths of the judging lens over which the skyline never leaves one
// ROW -- and a row of this frame is a twentieth of a degree, so the window is a
// tenth.
//
// Measured on both sides, which is what makes it a test and not a number: the
// hills that ship run 8.75 degrees of compass from the middle of the meadow,
// 9.25 from the judging eye and 12.5 from the rim, while a true wall -- one
// height on every bearing, with the grain switched off, which is what the crest
// at ninety-six metres WAS -- runs 58.5. Three fifths of the lens is 26.5, with
// twice the margin on one side and better than twice on the other.
const LINE_RUN = 0.60 * POSE_VOX_DAY.fov;
/** One row of the frame, which is what «entro +-1 riga» is in degrees. */
const LINE_WINDOW = 0.1;
const LINE_STEP = 0.25;

export function longestFlat(spec, lads, eye) {
  const rows = [];
  for (let b = -180; b < 180; b += LINE_STEP) {
    rows.push(skylineAt(spec, eye, b, lads, MARCH).elevation);
  }
  let best = 0;
  let at = 0;
  for (let i = 0; i < rows.length; i++) {
    let lo = rows[i];
    let hi = rows[i];
    let j = i;
    while (j < rows.length) {
      const nlo = Math.min(lo, rows[j]);
      const nhi = Math.max(hi, rows[j]);
      if (nhi - nlo > LINE_WINDOW) break;
      lo = nlo;
      hi = nhi;
      j += 1;
    }
    if (j - i > best) { best = j - i; at = -180 + i * LINE_STEP; }
  }
  return { degrees: best * LINE_STEP, from: at };
}

const lines = Object.keys(EYES).map((name) => ({ name, ...longestFlat(SPEC, LADS, EYES[name]) }));
const worstLine = lines.reduce((m, l) => (l.degrees > m.degrees ? l : m), lines[0]);
report.check(worstLine.degrees < LINE_RUN,
  'there is no line: no stretch of the compass keeps the skyline at one height',
  `worst run ${worstLine.degrees.toFixed(1)} deg of compass from the ${worstLine.name}, `
  + `from ${worstLine.from} deg, against three fifths of the lens = ${LINE_RUN.toFixed(1)}`);

// --------------------------------------------------------------------------
// 5. THE HILLS STAND IN THE WATER, AND THE WATER IS ONE LEVEL.
// --------------------------------------------------------------------------
const source = read('src/world/distant.js');

// THE FAR SHORE IS WHERE THE REFERENCE READS IT.
//
// R6 §1 fixed the one distance the picture actually gives out here: the far
// edge of the water reads at -2.3 degrees, which with the surface at -4.741 m
// and the eye at 1.583 puts it at about a hundred and sixty metres. That is the
// foot of the near hill, and it is the whole reason the hills' humps are narrow
// in front and long behind -- with one width they met the water at a hundred
// and twelve, two metres past the meadow's own shore, and the lake was a strip.
//
// AND IN THE GAP IT RUNS OUT OF SIGHT. R6 §2.5 measured the water from +0.59 to
// -3.6 degrees: the near shore at a hundred metres and the far edge at the
// horizon. Where the monoliths part, the first land has to stand far enough
// back that the surface reaches the horizontal -- which it does by the same
// device, because water shows BETWEEN the planes when each of them meets the
// surface before the next begins.
const SHORE_AT_THE_SIDES = -2.3;
const SHORE_TOLERANCE = 0.5;

export function farShore(spec, lads, eye, bearingDeg) {
  const ux = Math.sin(bearingDeg * DEG);
  const uz = -Math.cos(bearingDeg * DEG);
  for (let d = 100; d < 2200; d += 1) {
    const top = skylineGround(spec, eye.x + ux * d, eye.z + uz * d, lads);
    if (top !== null && top > WATER) {
      return { at: d, elevation: Math.atan2(WATER - eye.y, d) / DEG };
    }
  }
  return null;
}

const sideShores = [];
for (const b of [-37, -34, -31, -29, 31, 34, 37]) {
  const s0 = farShore(SPEC, LADS, EYES.fitted, b);
  if (s0) sideShores.push({ bearing: b, ...s0 });
}
const shoreOff = sideShores.map((r) => Math.abs(r.elevation - SHORE_AT_THE_SIDES));
report.check(sideShores.length > 0 && Math.max(...shoreOff) <= SHORE_TOLERANCE,
  `the water reaches the far shore the reference reads, at ${SHORE_AT_THE_SIDES} degrees`,
  `${sideShores.length} bearings at the sides, `
  + `${Math.min(...sideShores.map((r) => r.at))} to ${Math.max(...sideShores.map((r) => r.at))} m `
  + `= ${Math.min(...sideShores.map((r) => r.elevation)).toFixed(2)} to `
  + `${Math.max(...sideShores.map((r) => r.elevation)).toFixed(2)} deg, worst `
  + `${Math.max(...shoreOff).toFixed(2)} out`);

// AND IT RUNS FURTHER IN THE GAP THAN AT THE SIDES, which is «nel varco NON
// chiude» stated as something a guard can hold.
const gapShores = [-12, -6, 0, 6, 12].map((b) => farShore(SPEC, LADS, EYES.fitted, b))
  .filter((r) => r !== null);
const nearestGap = Math.min(...gapShores.map((r) => r.at));
const furthestSide = Math.max(...sideShores.map((r) => r.at));
report.check(gapShores.length > 0 && nearestGap > furthestSide,
  'and it runs further where the monoliths part: in the gap the lake goes out of sight',
  `${nearestGap} m at the nearest bearing of the gap, against ${furthestSide} m at the sides`);

// AND NO HILL STANDS INSIDE THE MEADOW'S OWN SHORE. Inside the water's edge the
// ground is dry and the meadow draws every pixel of it; a hill there is two
// systems on one piece of land. The frontier waves, so it is asked of the
// frontier at its narrowest.
let inside = 0;
for (let deg = 0; deg < 360; deg += 1) {
  const bearing = deg * DEG;
  if (frontierAt(SPEC, SPEC.rings.frontiers[0], bearing) < 110.2) inside += 1;
}
report.check(inside === 0,
  'and no hill stands inside the meadow\'s own shore, on any bearing the frontier waves to',
  `the innermost frontier is ${SPEC.rings.frontiers[0]} m, waving `
  + `${(SPEC.rings.jitter * 100).toFixed(0)}%, against a water's edge at 110.2 m`);

// AND ONE LEVEL, ASKED OF THE SOURCE. The same question guard-confine asks from
// the other side, and it is asked twice on purpose: that guard watches the
// boundary's dial, this one watches the frame that reads it.
const laysAtTheLevel = (text) => /lake\.position\.y\s*=\s*(WATER|waterLevel\(\))\s*;/.test(text)
  && !/const LAKES\s*=\s*\[/.test(text);
report.check(laysAtTheLevel(source),
  'and it is one disc, at the level the boundary states and not a number of its own',
  `waterLevel() = ${WATER.toFixed(4)} m`);

// AND THE GIANTS ARE GONE (E-DECISIONI21, D7 = A).
const noGiants = (text) => !/const GIANTS\s*=\s*\[/.test(text) && !/buildGiants/.test(text);
report.check(noGiants(source),
  'and the giants have fallen, with the floor and the spire placeholder',
  'no GIANTS, no buildGiants, no painted rings');

// --------------------------------------------------------------------------
// 6. IT COSTS WHAT WAS BUDGETED -- §2.9 AS R6 §7 ASKS IT TO BE AMENDED.
//
// THE AMENDMENT, DECLARED HERE AND RATIFIED BY THE COORDINATOR, NOT BY THIS
// FILE. §2.9 allocates the frame beyond a hundred metres «≤ 1,0 ms / ≤ 20.000
// tri / ≤ 6 draw», and those triangles were written for painted quads. E-PERF5
// established that this card is bound by the BANDWIDTH of the pixels it
// touches and not by its vertices -- thirty million logarithms and roots came
// off the meadow's march for under half a millisecond -- so a budget in
// triangles measures the wrong thing for a mesh whose whole cost is that it
// covers five degrees of sky. The amended allocation is milliseconds, draws,
// card bytes and DELIVERED bytes, which is nought here: the law weighs nothing
// on the wire because it is arithmetic.
//
// REGOLA R4 is honoured rather than dodged: the triangle overrun is declared in
// the verbale with its measurement and its pose, and the coordinator rules.
// --------------------------------------------------------------------------
const BUDGET = { drawsAt: 18, cardBytes: 10 * 1024 * 1024, deliveredBytes: 0, ms: 1.5 };

// THE DRAWS ARE THE WEDGES, and how many of them a lens of forty-four degrees
// can see is arithmetic: a wedge is a slice of the compass, so at most as many
// as the lens spans plus the two it straddles, and the water is one more.
const wedgeSpan = 360 / SPEC.rings.sectors;
const inLens = Math.ceil(POSE_VOX_DAY.fov / wedgeSpan) + 2 + 1;
report.check(SPEC.rings.sectors + 1 <= BUDGET.drawsAt,
  `it is drawn in at most ${BUDGET.drawsAt} calls, and in ${inLens} through the judging lens`,
  `${SPEC.rings.sectors} wedges of ${wedgeSpan} degrees, plus the water`);

// NOTHING IS DELIVERED. The whole cornice is a law and a table of numbers in
// the source: no texture, no mesh, no asset id, nothing in public/assets.
const deliversNothing = !/assets-src\/distant\/[^\s'"]*\.(png|ktx2|glb|bin)/.test(source);
report.check(deliversNothing,
  'and it delivers nothing: the hills are a law, and a law weighs nought on the wire',
  `${(JSON.stringify(SPEC).length / 1024).toFixed(1)} kB of solved table in the source, `
  + `${BUDGET.deliveredBytes} bytes of asset`);

// AND IT IS CUT OFF THE THREAD THE WALKER IS ON. Three seconds of arithmetic on
// the main thread is not a slow frame: the first harness that photographed this
// world was handed a crashed tab, and E-CONF1 spent a unit buying the first
// frame down to 1.1 s by moving exactly this class of work onto a worker.
const cutsOffThread = (text) => /new Worker\(new URL\('\.\/distant-worker\.js'/.test(text)
  && /type: 'module'/.test(text);
report.check(cutsOffThread(source),
  'and it is cut off the thread the walker is on, so the first frame stays the one E-CONF1 bought',
  'distant-worker.js, one message, buffers transferred and the thread terminated');

// AND IT READS THE AIR FROM ITS SEAT rather than growing a second fog. Whether
// the seat has published a distance term yet is not this guard's business --
// D-R6-4 is open and air.js is the coordinator's -- but the DOOR has to be
// there, and the colour has to come through it.
const readsTheSeat = (text) => /from '\.\/air\.js'/.test(text)
  && /fogUniforms\(\)/.test(text)
  && /AIR\.DISTANT_AIR_GLSL/.test(text)
  && /uFogColour/.test(text);
report.check(readsTheSeat(source),
  'and its air comes from the seat: the colour is air.js\'s, live, and the door for the rest is open',
  'FOG_RADIANCE and uFogColour read; DISTANT_AIR_GLSL used the day air.js states it');

// --------------------------------------------------------------------------
// 7. THE CONTRACT V7 IS OWED IS ANSWERED, ON REAL TREADS.
//
// E-V5a ratified the name; E-V5j recorded that the seat in contracts.js never
// arrived. It arrives with this unit, so the guard is what stops it leaving
// again -- and what checks the one property the night depends on: the census
// found every warm point of the night target UNDER the rock line, so no seat
// may stand over it.
// --------------------------------------------------------------------------
const seats = ridgeLampSeats(SPEC, LADS);
const contracts = read('src/world/contracts.js');
const seated = seats.filter((s) => {
  const h = hillAt(SPEC, s.x, s.z);
  const top = WATER + (h.y - WATER);
  return s.y <= WATER + (top - WATER) * SPEC.matter.rockLine + s.size;
});
report.check(seats.length > 24 && seated.length === seats.length,
  'the lamp seats are treads under the rock line, and there are enough of them to choose from',
  `${seats.length} seats, all under the line, ${seats[0] ? seats[0].size : 0} m across`);

const contractIsSeated = /ridgeLampSeats/.test(contracts);
report.check(contractIsSeated,
  'and contracts.js carries the name E-V5a ratified, so V7 never reaches past it',
  'ridgeLampSeats re-exported from the coordinator\'s seat');

// --------------------------------------------------------------------------
// AND THE GRAIN STEPS ASIDE ONLY WHERE THE PICTURE SPEAKS.
//
// The fit could not reach half a degree through a coarse grain of forty-two per
// cent -- eleven metres on a hill of twenty-six, which is three and a half
// degrees of silhouette -- so the grain is turned down over the bearings a
// reading covers. That is a licence to make a hillside smooth, and this is what
// stops it being used anywhere else: over the compass as a whole the grain has
// to be almost all there.
// --------------------------------------------------------------------------
let quietBearings = 0;
let total = 0;
for (let k = 0; k < SPEC.ridges.length; k++) {
  for (let b = -180; b < 180; b += 1) {
    total += 1;
    if (quietAt(SPEC, k, b) < 0.9) quietBearings += 1;
  }
}
report.check(quietBearings / total < 0.06,
  'and the grain steps aside only where the reference speaks: everywhere else it is whole',
  `${quietBearings} of ${total} ridge-bearings are quietened `
  + `(${((quietBearings / total) * 100).toFixed(1)}%), to ${SPEC.noise.quietShare} of the grain`);

if (process.argv.includes('--self')) {
  const flat = JSON.parse(JSON.stringify(SPEC));
  for (let k = 0; k < flat.ridges[0].profile.length; k++) flat.ridges[0].profile[k] *= 0.8;
  const flatLads = ladders(flat);

  const oneHill = JSON.parse(JSON.stringify(SPEC));
  for (const r of [1, 2, 3]) oneHill.ridges[r].profile = oneHill.ridges[r].profile.map(() => 0);
  const oneLads = ladders(oneHill);

  const coarse = JSON.parse(JSON.stringify(SPEC));
  coarse.rings.cubes = [4, 8, 16, 32];
  const coarseLads = ladders(coarse);

  const loud = JSON.parse(JSON.stringify(SPEC));
  for (const r of loud.ridges) r.quiet = [[-180, 180]];

  selfTest('guard-cornice', [
    {
      what: 'the near flank flattened by a fifth -- the prototype\'s own miss, in shape',
      caught: planeMisses(flat, flatLads).some((r) => r.off > TOLERANCE),
    },
    {
      what: 'and the flank that ships is not called one',
      caught: !planeMisses(SPEC, LADS).some((r) => r.off > TOLERANCE),
    },
    {
      what: 'one hill and nothing behind it, which is what a skyline-only fit would pass',
      caught: planeMisses(oneHill, oneLads).some((r) => r.off > TOLERANCE),
    },
    {
      what: 'and with the far planes gone the horizon opens a hole as well',
      caught: bandMisses(oneHill, oneLads, { fitted: EYES.fitted }).length > 0,
    },
    {
      what: 'and the band that ships opens none, from any of the eyes',
      caught: bandMisses(SPEC, LADS, EYES).length === 0,
    },
    {
      what: 'cubes four times too big, which is the prototype\'s 5 and 10 m at the far rings',
      caught: cubeSizes(coarse, coarseLads).some((c) => c.degrees > CUBE_BAND[1]),
    },
    {
      what: 'and the ladder that ships stays inside the band on every bearing',
      caught: !cubeSizes(SPEC, LADS).some((c) => c.degrees < CUBE_BAND[0] || c.degrees > CUBE_BAND[1]),
    },
    {
      what: 'a horizon at one height -- the wall this unit took down',
      caught: (() => {
        // ONE HEIGHT AND NO GRAIN, which is what the crest at ninety-six metres
        // actually was: a smooth hump of one material quantised to four voxels.
        const wall = JSON.parse(JSON.stringify(SPEC));
        for (const r of wall.ridges) {
          r.profile = r.profile.map(() => 26);
          r.silent = [];
          r.quiet = [[-180, 180]];
        }
        wall.noise.quietShare = 0;
        wall.noise.fine.amplitude = 0;
        return longestFlat(wall, ladders(wall), EYES.fitted).degrees >= LINE_RUN;
      })(),
    },
    {
      what: 'and the hills that ship keep no stretch of the compass at one height',
      caught: longestFlat(SPEC, LADS, EYES.fitted).degrees < LINE_RUN,
    },
    {
      what: 'a frontier drawn inside the meadow\'s shore, where two systems would share the ground',
      caught: frontierAt({ ...SPEC, rings: { ...SPEC.rings, jitter: 0.04 } }, 105, 0) < 110.2,
    },
    {
      what: 'the water given a height of its own again',
      caught: !laysAtTheLevel('lake.position.y = -4.74;'),
    },
    {
      what: 'and the rectangles coming back',
      caught: !laysAtTheLevel('const LAKES = [];\nlake.position.y = WATER;'),
    },
    {
      what: 'the giants standing back up',
      caught: !noGiants('const GIANTS = [\n  { bearing: 58 },\n];'),
    },
    {
      what: 'and the frame that ships has none of them',
      caught: noGiants(source),
    },
    {
      what: 'the cutting moved back onto the thread the walker is on',
      caught: !cutsOffThread('receive(buildHills());'),
    },
    {
      what: 'and the frame that ships cuts it elsewhere',
      caught: cutsOffThread(source),
    },
    {
      what: 'a second fog grown here instead of read from the seat',
      caught: !readsTheSeat('const density = 0.0059; // our own'),
    },
    {
      what: 'and the frame that ships reads air.js',
      caught: readsTheSeat(source),
    },
    {
      what: 'the grain quietened over the whole compass, which would smooth every hillside',
      caught: (() => {
        let q = 0;
        for (let k = 0; k < loud.ridges.length; k++) {
          for (let b = -180; b < 180; b += 1) if (quietAt(loud, k, b) < 0.9) q += 1;
        }
        return q / total >= 0.06;
      })(),
    },
    {
      what: 'and the windows that ship are the readings\' own and no wider',
      caught: quietBearings / total < 0.06,
    },
  ]);
}

report.end(`four planes at ${SPEC.ridges.map((r) => r.radius).join(', ')} m, in cubes of `
  + `${SPEC.rings.cubes.join('/')} m, ${smallest.toFixed(2)} to ${largest.toFixed(2)} degrees `
  + `apparent; the skyline is the reference's to ${worstPlane.off.toFixed(2)} of a degree, `
  + `closes between ${BANDS.fitted.closed[0]} and ${BANDS.fitted.closed[1]} all the way round, `
  + `and keeps no more than ${worstLine.degrees.toFixed(1)} degrees of compass at one height`);
