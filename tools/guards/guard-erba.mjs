import {
  BLADE, BLADES_PER_VOXEL, CHUNK, MANTO, MATERIAL, NO_COLUMN, SUB, SUN_STEPS, VOXEL,
  bladeAtColumn, bladeHeightAt, chunkColumns, columnSpec, mantoAt, mantoIntensity, meshDisc,
} from '../../src/world/voxel/pure.js';
import SKY from '../../assets-src/sky/sky.json' with { type: 'json' };
import { TIERS } from '../../src/core/quality.js';
import { SPAWN } from '../../src/world/layout.js';
import { bladeSettings } from '../../src/world/voxel/material.js';
import { reporter, selfTest } from './lib.mjs';

/** The pair the mat's own material carries, so this file cannot quote a stale one. */
const BLADE_FOOT = bladeSettings().base;

// The seal's own bearing, read here and not derived, so the leg below and the
// injections beside it compare the bake against the FILE and not against a
// second copy of it.
const [sunX, sunY, sunZ] = SKY.day.sun.vector;
const major = Math.max(Math.abs(sunX), Math.abs(sunZ));

/**
 * The march, on a row of upwind tops handed in, so the rule can be injected.
 *
 * The same three lines the bake walks (bakeShade in worldgen.js): the highest
 * upwind top dropped by how far the beam has climbed to reach it, floored at the
 * column's own floor. `tops` is what stands one, two ... eight blades upwind, in
 * SUB-steps above the floor.
 */
function shadeOf(tops, floor) {
  let line = floor;
  SUN_STEPS.forEach((st, k) => {
    const h = floor + tops[k] - st.rise;
    if (h > line) line = h;
  });
  return line;
}

// THE GRASS IS MADE OF VOXELS, AND THIS IS WHAT SAYS SO IN NUMBERS.
//
// WHAT IT REPLACES. guard-grana froze the two dials of the SODS -- plates of
// turf on a lattice, one voxel proud of the plane -- and that mechanism is gone.
// E-DECISIONI8, the committente's own words: «nel target l'erba e' rappresentata
// da voxel piu' o meno lunghi (lunghezze diverse) che proiettano ombre sugli
// altri fili ... e' per questo che il terreno era perfettamente pianeggiante:
// stavate analizzando i fili d'erba come rilievi». The terrain is one level and
// what stood in those pixels is a MAT, at half the step, standing on top of it.
//
// WHAT THIS GATES, AND WHY EACH ONE IS A NUMBER SOMEBODY MEASURED.
//
//   1. THE QUANTUM. A blade is 5 cm, which is 0.50 of our cube. E-ERBA-A 1.1
//      read the target's at 5.5-6.0 (0.60) with a control that reads 1.087 where
//      the truth is 1.000, and the coordinator took 5 over 6 (D-E1 = A) because
//      a whole sub-lattice makes every seam exact. The 17% is declared, not hidden.
//   2. THE RISERS. 52 / 31 / 14 / 3 per cent on one, two, three, four or more
//      blades, over 2 265 risers in four resolved windows (E-ERBA-A 1.3).
//   3. THE TOP RUNS. p50 at most 1.2 blades: «il manto cambia quota quasi a ogni
//      filo. Non ci sono ciuffi, non ci sono file, non ci sono terrazze»
//      (E-ERBA-A 1.4). This is the reading that retired the 5-12 of guard-piano.
//   4. THE COVER. The plane shows through 0.4 to 0.8 per cent of the open meadow
//      (E-ERBA-A 2): «il manto e' chiuso».
//   5. THE INTENSITY. It falls to the corridor and comes back over the ramp, and
//      it never steps back up (E-DECISIONI10 G1, G3 and the nota).
//   6. THE WALKER. groundHeightAt does not know the mat exists, which is
//      E-DECISIONI9.2 -- «il camminatore attraversa erba e fiori passandoci
//      attraverso» -- and E-ERBA-A 6.7's reason for it in the body's own numbers.
//   7. THE CEILING. What the mat costs the disc, against what U-ERBA-1 measured
//      the frame at. It is the voice this work can make explode.
//
// AND THE FLANK OVER THE TOP AND THE SHADE AT THE FOOT ARE NOT HERE, WHICH IS
// DECLARED RATHER THAN FORGOTTEN. Both are readings of a PIXEL -- 0.62 and
// -16% -- and a pixel needs a frame: the light, the exposure, the tone curve and
// the grade all stand between a uniform and a luminance. What can be gated
// offline is that the two terms are the measured literals and that they are
// carried by the mat alone, and that is the last leg below. The frame readings
// are in the verbale of U-ERBA-1, taken with E-ERBA-A's own instruments.

const SHIPPED_RADIUS = Math.max(...TIERS.map((t) => t.voxelDiscRadius));
const FOCUS = { x: SPAWN.x, z: SPAWN.z };

/** The blade, as a share of our own cube. E-ERBA-A 1.1 reads the target's 0.60. */
const QUANTUM = { low: 0.45, high: 0.65 };

/** The risers between neighbouring blades, and the width each is allowed. */
const RISERS = [
  { blades: 1, share: 0.52, band: 0.04 },
  { blades: 2, share: 0.31, band: 0.03 },
  { blades: 3, share: 0.14, band: 0.03 },
  { blades: 4, share: 0.03, band: 0.02 },
];

/** The top run of the mat, in blades. E-ERBA-A 1.4: p50 0.55 to 0.97. */
const RUN_P50 = 1.2;

/** How much of the open meadow shows the bare plane. E-ERBA-A 2. */
const BARE = { low: 0.004, high: 0.008 };

// THE FOOT OF THE MAT, from E-ERBA-A 1.6 and E-DECISIONI10 G4, and it is read
// out of the material rather than typed again so the two cannot part company.
// The amount is the measurement -- 16% at the foot -- and the SPAN is the
// committente's sentence, «un cambio graduale e giustificato fra i voxel (se
// piu' d'uno)»: at 0.62 every pair of cubes up a blade differs, where at the
// 0.33 the 7 cm of the measurement gives it is spent by the second one and the
// frame does not move (the A/B is in the verbale).
const FOOT = { fall: BLADE_FOOT.x, decay: BLADE_FOOT.y };

// Where the open meadow is read: a square of blade columns well away from the
// corridor, from the masses and from the stone, so what is measured is the LAW
// and not the field of intensity riding on it.
const OPEN = { x: 6.0, z: -6.0, side: 400 };

/** The mat over a square of the sub-lattice, in sub-steps of a blade. */
export function mat(x0, z0, side, intensity = 1) {
  const bx0 = Math.floor(x0 / BLADE);
  const bz0 = Math.floor(z0 / BLADE);
  const h = [];
  for (let j = 0; j < side; j++) {
    const row = new Int16Array(side);
    for (let i = 0; i < side; i++) row[i] = bladeAtColumn(bx0 + i, bz0 + j, intensity);
    h.push(row);
  }
  return h;
}

/** The census of risers, top runs and bare columns over such a square. */
export function census(h) {
  const side = h.length;
  const riser = [0, 0, 0, 0];
  let risers = 0;
  let bare = 0;
  let all = 0;
  const runs = [];
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      all++;
      if (h[j][i] === 0) bare++;
    }
  }
  const step = (a, b) => {
    // IN BLADES AND NOT IN SUB-STEPS, because the reading is in blades: the
    // sub-step exists so the mat can thin GRADUALLY where the intensity is under
    // one (E-DECISIONI10 G3), and at the intensity this census is taken at every
    // height is a whole blade by construction.
    const d = Math.abs(a - b) / SUB;
    if (d < 0.5) return;
    risers++;
    riser[Math.min(4, Math.round(d)) - 1]++;
  };
  for (let j = 0; j < side; j++) for (let i = 0; i < side - 1; i++) step(h[j][i], h[j][i + 1]);
  for (let j = 0; j < side - 1; j++) for (let i = 0; i < side; i++) step(h[j][i], h[j + 1][i]);
  for (let j = 0; j < side; j++) {
    let run = 1;
    for (let i = 1; i < side; i++) {
      if (h[j][i] === h[j][i - 1]) run++;
      else { runs.push(run); run = 1; }
    }
    runs.push(run);
  }
  runs.sort((a, b) => a - b);
  return {
    risers: riser.map((v) => v / risers),
    n: risers,
    bare: bare / all,
    runP50: runs[Math.floor(runs.length * 0.5)],
    runP90: runs[Math.floor(runs.length * 0.9)],
  };
}

/** Whether a ramp of samples never steps back up. */
export const falls = (values) => values.every((v, k) => k === 0 || v <= values[k - 1] + 1e-9);

if (process.argv.includes('--self')) {
  const open = census(mat(OPEN.x, OPEN.z, 120));
  // A mat drawn from a law with no fifth rung: it cannot make a riser of four,
  // which is the whole reason the fifth rung is in MANTO.law.
  const flat = [];
  for (let j = 0; j < 120; j++) {
    const row = new Int16Array(120);
    for (let i = 0; i < 120; i++) row[i] = Math.min(4, Math.max(1, bladeHeightAt(i, j))) * SUB;
    flat.push(row);
  }
  selfTest('guard-erba', [
    {
      what: 'a blade the size of our own cube is caught',
      caught: !(1.0 >= QUANTUM.low && 1.0 <= QUANTUM.high),
    },
    {
      what: 'and one at the target\'s own 0.60 is not',
      caught: 0.60 >= QUANTUM.low && 0.60 <= QUANTUM.high,
    },
    {
      what: 'a mat with no fourth riser at all is caught',
      caught: Math.abs(census(flat).risers[3] - RISERS[3].share) > RISERS[3].band,
    },
    {
      what: 'the mat the law draws lands on every riser the target measures',
      caught: RISERS.every((r, k) => Math.abs(open.risers[k] - r.share) <= r.band),
    },
    {
      what: 'a mat that groups into tufts is caught',
      caught: !(6 <= RUN_P50),
    },
    {
      what: 'the mat the law draws does not group',
      caught: open.runP50 <= RUN_P50,
    },
    {
      what: 'a ramp that steps back up is caught',
      caught: !falls([0.9, 0.5, 0.7, 0.1]),
    },
    // AND THE SHADOW'S OWN FOUR, injected on the arithmetic and not on a
    // picture: the two senses of the map's rule, a bearing that has drifted from
    // the seal, and the width outside its band.
    {
      what: 'a line with nothing upwind tall enough to cast it is caught',
      caught: Math.floor(shadeOf([0, 0, 0, 0, 0, 0, 0, 0], 0)) < 12,
    },
    {
      what: 'and a column left lit under a blade that stands over it is caught',
      caught: Math.floor(shadeOf([20, 0, 0, 0, 0, 0, 0, 0], 0)) > 0,
    },
    {
      what: 'a mat that really is shaded by its upwind neighbour is not caught either way',
      caught: Math.floor(shadeOf([20, 0, 0, 0, 0, 0, 0, 0], 0))
        === Math.floor(20 - SUN_STEPS[0].rise),
    },
    {
      what: 'a march along a bearing the seal does not carry is caught',
      // Due east, one blade a step, with the seal's own climb: the same test the
      // leg below applies, on a march the seal does not describe.
      caught: ![{ di: 1, dj: 0, rise: SUB * sunY / major }].every((st, k) => (
        st.di === Math.round((k + 1) * sunX / major)
        && st.dj === Math.round((k + 1) * sunZ / major)
        && Math.abs(st.rise - (k + 1) * SUB * sunY / major) < 1e-9)),
    },
    {
      what: 'and the march the seal does carry passes it',
      caught: SUN_STEPS.every((st, k) => (st.di === Math.round((k + 1) * sunX / major)
        && st.dj === Math.round((k + 1) * sunZ / major)
        && Math.abs(st.rise - (k + 1) * SUB * sunY / major) < 1e-9)),
    },
    {
      what: 'a blade written down at the whole of its cell is caught, because that is '
        + 'not a blade that stands apart',
      caught: ![8].every((w) => w >= MANTO.slim.low && w < MANTO.slim.high),
    },
    {
      what: 'and one at three quarters is not',
      caught: [6].every((w) => w >= MANTO.slim.low && w < MANTO.slim.high),
    },
    {
      what: 'the null: the same square read twice gives the same census',
      caught: JSON.stringify(census(mat(OPEN.x, OPEN.z, 120)))
        === JSON.stringify(census(mat(OPEN.x, OPEN.z, 120))),
    },
  ]);
}

const report = reporter('guard-erba -- the grass is voxels, and these are their measurements');

// ------------------------------------------------------------------- 1
report.check(BLADE / VOXEL >= QUANTUM.low && BLADE / VOXEL <= QUANTUM.high,
  `a blade is ${QUANTUM.low} to ${QUANTUM.high} of our cube, as E-ERBA-A 1.1 reads the target's`,
  `${(BLADE / VOXEL).toFixed(2)} of a cube -- ${BLADE * 100} cm against the target's 5.5-6.0, `
  + `${((0.06 - BLADE) / 0.06 * 100).toFixed(0)}% short and declared (D-E1 = A)`);
report.check(BLADES_PER_VOXEL === Math.round(VOXEL / BLADE) && Number.isInteger(VOXEL / BLADE),
  'and it is a whole division of the world\'s own step, so no seam has to be invented',
  `${BLADES_PER_VOXEL} blades to a cube on each axis, ${SUB} steps of height to a blade`);

// ------------------------------------------------------------------- 2
report.line('');
const open = census(mat(OPEN.x, OPEN.z, OPEN.side));
report.line(`  the open meadow, ${OPEN.side * OPEN.side} blade columns at `
  + `x ${OPEN.x} z ${OPEN.z}, ${open.n} risers`);
for (let k = 0; k < RISERS.length; k++) {
  const r = RISERS[k];
  report.check(Math.abs(open.risers[k] - r.share) <= r.band,
    `${(r.share * 100).toFixed(0)}% of the risers are ${r.blades} blade${r.blades > 1 ? 's' : ''}`
    + `${k === RISERS.length - 1 ? ' or more' : ''}, as E-ERBA-A 1.3 measures`,
    `${(open.risers[k] * 100).toFixed(1)}% against ${(r.share * 100).toFixed(0)} `
    + `+/- ${(r.band * 100).toFixed(0)}`);
}

// ------------------------------------------------------------------- 3
report.line('');
report.check(open.runP50 * (BLADE / BLADE) <= RUN_P50,
  `half the top runs are ${RUN_P50} blades or shorter -- the mat does not group`,
  `p50 ${open.runP50.toFixed(2)} blades, p90 ${open.runP90.toFixed(2)}, against the target's `
  + 'p50 0.55-0.97 and p90 1.68-5.09');

// ------------------------------------------------------------------- 4
report.check(open.bare >= BARE.low && open.bare <= BARE.high,
  `the plane shows through ${(BARE.low * 100).toFixed(1)} to ${(BARE.high * 100).toFixed(1)}% `
  + 'of the open meadow, as E-ERBA-A 2 counts it',
  `${(open.bare * 100).toFixed(2)}%`);

// ------------------------------------------------------------------- 5
report.line('');
const ramp = [0.10, 0.30, 0.60, 1.00, 1.50, 2.20, 3.00];
const across = ramp.map((d) => {
  let sum = 0;
  let n = 0;
  for (let z = 4.0; z <= 10.0; z += 0.1) {
    sum += mantoIntensity(d + 0.0, z) + mantoIntensity(-d, z);
    n += 2;
  }
  return sum / n;
});
report.line('  the mat\'s intensity out from the middle of the corridor:');
report.line(`    ${ramp.map((d, k) => `${d.toFixed(1)}m ${across[k].toFixed(2)}`).join('   ')}`);
report.check(falls(across.slice().reverse()),
  'it rises out of the corridor and never steps back down on the way',
  `${across[0].toFixed(2)} at the centreline to ${across[across.length - 1].toFixed(2)} `
  + `at ${ramp[ramp.length - 1]} m`);
report.check(across[0] < 0.35 && across[across.length - 1] > 0.70,
  'low where the committente says low and back up where he says up '
  + '(E-DECISIONI10 G1, G3, nota)',
  `${across[0].toFixed(2)} on the corridor, ${across[across.length - 1].toFixed(2)} in the open, `
  + `ramp ${MANTO.verge.reach} m`);

// AND THE MAT IS SHORTER WHERE IT IS THINNER, which is «meno fitta e meno alta»
// and the one sentence that makes this ONE field instead of two.
const heights = ramp.map((d) => {
  let sum = 0;
  let n = 0;
  for (let z = 4.0; z <= 10.0; z += 0.1) {
    for (const x of [d, -d]) {
      const spec = columnSpec(Math.floor(x / VOXEL), Math.floor(z / VOXEL));
      if (spec.mat !== MATERIAL.GRASS && spec.mat !== MATERIAL.EARTH) continue;
      sum += mantoAt(x, z);
      n++;
    }
  }
  return n ? sum / n : 0;
});
report.line(`  and how tall it stands there, in cm: `
  + `${heights.map((h) => (h * 100).toFixed(1)).join('  ')}`);
// READ TO THE MILLIMETRE, AND THAT IS THE FIELD'S OWN RESOLUTION AND NOT A
// SLACKENING. The two innermost probes stand at 0.1 and 0.3 m of the world's own
// x, and since U-SENT-4 put the corridor at the width the reference reads
// (pathHalfWidth in ../../src/world/terrain-field.js) both of them are deep
// inside it, where the mat is at its floor: they came back 1.911 and 1.885 cm,
// a quarter of a millimetre apart, and a quarter of a millimetre of noise on a
// plateau is not a step back up. A real one -- a millimetre or more -- still
// fails, and the injection below is a whole rung.
report.check(falls(heights.slice().reverse().map((v) => Math.round(v * 1000) / 1000))
  && heights[heights.length - 1] > heights[0] * 1.5,
  'and it is shorter where it is thinner, which is one field and not two',
  `${(heights[0] * 100).toFixed(1)} cm at the centreline, `
  + `${(heights[heights.length - 1] * 100).toFixed(1)} cm in the open`);

// ------------------------------------------------------------------- 6
report.line('');
const store = [];
for (let i = 0; i < 4000; i++) {
  const x = -12 + (i % 63) * 0.37;
  const z = -12 + Math.floor(i / 63) * 0.37;
  const spec = columnSpec(Math.floor(x / VOXEL), Math.floor(z / VOXEL));
  if (spec.mat !== MATERIAL.GRASS) continue;
  store.push(mantoAt(x, z));
}
const tallest = Math.max(...store);
report.check(tallest > 0,
  'the mat stands over the meadow at all, so the leg below is asserting something',
  `${store.length} columns sampled, the tallest carries ${(tallest * 100).toFixed(1)} cm`);

// ------------------------------------------------------------------- 7
report.line('');
const on = meshDisc(null, true, SHIPPED_RADIUS, FOCUS);
const off = meshDisc(null, false, SHIPPED_RADIUS, FOCUS);
report.line(`  the disc at ${SHIPPED_RADIUS} m: ${on.triangles} triangles, of which `
  + `${on.matQuads * 2} are the mat, over ${on.blades} blade columns`);
report.line(`  the plane and its masses without it: ${off.triangles}`);
report.line(`  the mat costs ${(on.quadsPerBlade * 2).toFixed(3)} triangles a blade column `
  + `(E-ERBA-A 6.3 modelled 4.2 inside the ring and measured 0.65 for the whole ground)`);
report.check(on.triangles > off.triangles * 2,
  'the mat really is what the third argument switches off',
  `${on.triangles} against ${off.triangles}`);
report.check(off.triangles < 20000,
  'and with it off the ground is the plane and its masses and nothing else',
  `${off.triangles} triangles over ${off.columns} columns `
  + `(${off.quadsPerColumn.toFixed(4)} q/col)`);

// ------------------------------------------------------------------- 8
report.line('');
report.check(Math.abs(FOOT.fall - 0.16) < 1e-9,
  'the foot of the mat loses the 0.16 E-ERBA-A 1.6 measured on the target, and not a fitted number',
  `${FOOT.fall}`);
report.line(`  and it keeps ${FOOT.decay} of that loss for every blade of depth, so a face `
  + 'reads, from the top of its own blade downward, '
  + `${[0, 1, 2, 3, 4].map((r) => (1 - FOOT.fall * (1 - FOOT.decay ** r)).toFixed(3)).join(' ')}`);
report.line('  against E-ERBA-A 1.6 on the target: 1.015 above 7 cm, 0.931-0.997 at 5-7 cm, '
  + '0.844 at the foot of a face that reaches the plane');
report.line('  AND IT IS COUNTED FROM THE MAT AND NOT FROM THE PLANE (U-ERBA-2): the depth '
  + 'comes off the map, so a blade on the crown of a mound carries the fall a blade on the '
  + 'plane carries, which U-ERBA-1 had to declare as an approximation');
report.line('  the flank over the top, and how far the bounce carries it, are readings of a '
  + 'PIXEL: verbale U-ERBA-1');

// ------------------------------------------------------------------- 9
//
// THE SHADOW THE BLADES THROW ON EACH OTHER, GATED ON THE MAP AND NOT ON A
// PICTURE.
//
// E-DECISIONI9.3, the committente's word: «ombre vere che seguono il sole».
// U-ERBA-2 baked them at worldgen -- a march toward the sun through the mat's
// own heights, one line a blade column -- and what a guard can hold offline is
// not how dark the frame came out but whether the map IS a shadow: a column may
// only carry a line above its own floor if there is something upwind of it tall
// enough to put it there, and it MUST carry one when there is. Both senses,
// because one of them alone passes on an empty map and the other alone passes on
// a map that shades everything.
//
// AND THE BEARING IS THE SEAL'S, WHICH IS THE OTHER HALF. The march is read
// straight out of assets-src/sky/sky.json here, the same file src/core/sky.js
// hands the world's light through, and compared against the steps the bake
// actually walked: a map cooked along any other bearing is a second opinion
// about the hour, and this campaign spent a session removing one of those.
report.line('');
const wantSteps = SUN_STEPS.every((s, k) => s.di === Math.round((k + 1) * sunX / major)
  && s.dj === Math.round((k + 1) * sunZ / major)
  && Math.abs(s.rise - (k + 1) * SUB * sunY / major) < 1e-9);
report.check(wantSteps,
  'the mat is shaded along the bearing the seal carries and not a second one',
  `elevation ${SKY.day.sun.elevation} deg, azimuth ${SKY.day.sun.azimuth} deg -- `
  + `${SUN_STEPS.length} steps of ${(SUN_STEPS[0].rise / SUB * BLADE * 100).toFixed(2)} cm of climb`);

// One chunk of the disc that ships, read as the page reads it, with its skirt:
// every column of its own square is checked against its own upwind neighbours.
// AND IT IS THE CHUNK THE WALKER STANDS IN, not chunk nought: the ring of full
// detail is anchored on the spawn, so a chunk at the origin would be read
// entirely in blocks and the width below would have nothing to find.
const SHADE_CX = Math.floor(FOCUS.x / VOXEL / CHUNK);
const SHADE_CZ = Math.floor(FOCUS.z / VOXEL / CHUNK);
const shadeChunk = chunkColumns(SHADE_CX, SHADE_CZ, CHUNK, true, SHIPPED_RADIUS, FOCUS);
const bw = shadeChunk.w * BLADES_PER_VOXEL;
const bo = (SHADE_CX * CHUNK - shadeChunk.ox) * BLADES_PER_VOXEL;
const boz = (SHADE_CZ * CHUNK - shadeChunk.oz) * BLADES_PER_VOXEL;
const rung = BLADES_PER_VOXEL * SUB;
const floorOf = (i, j) => {
  const t = shadeChunk.top[(j >> 1) * shadeChunk.w + (i >> 1)];
  return t === NO_COLUMN ? -1 : (t + 1) * rung;
};
let shaded = 0;
let unjustified = 0;
let missed = 0;
let sampled = 0;
for (let j = 0; j < CHUNK * BLADES_PER_VOXEL; j++) {
  for (let i = 0; i < CHUNK * BLADES_PER_VOXEL; i++) {
    const a = i + bo;
    const b = j + boz;
    const f = floorOf(a, b);
    if (f < 0) continue;
    sampled++;
    const line = shadeChunk.shade[b * bw + a];
    // What the march would have found, asked again here from the store rather
    // than taken from the bake: the highest upwind top, dropped by the climb.
    let want = f;
    for (const st of SUN_STEPS) {
      const ai = a + st.di;
      const aj = b + st.dj;
      if (ai < 0 || aj < 0 || ai >= bw || aj >= shadeChunk.d * BLADES_PER_VOXEL) continue;
      const g = floorOf(ai, aj);
      if (g < 0) continue;
      // `sky` already carries the floor: it is the top of the blade the LAW puts
      // on that column, in world SUB-steps, which is exactly what the march
      // walks through.
      const top = shadeChunk.sky[aj * bw + ai];
      if (top - st.rise > want) want = top - st.rise;
    }
    if (line > f) {
      shaded++;
      // A LINE WITH NOTHING TO CAST IT is the failure this sense catches.
      if (Math.floor(want) < line) unjustified++;
    } else if (Math.floor(want) > f) missed++;
  }
}
report.line(`  ${sampled} blade columns of one chunk, ${shaded} of them with the sun `
  + `stopped above their own floor (${(100 * shaded / sampled).toFixed(1)}%)`);
report.check(shaded > sampled * 0.2 && unjustified === 0 && missed === 0,
  'every shaded column has something upwind tall enough to shade it, and every column '
  + 'that has one is shaded',
  `${unjustified} lines with nothing to cast them, ${missed} columns left lit under a `
  + 'blade that stands over them');

// ------------------------------------------------------------------- 10
//
// AND THE WIDTH OF THE BLADE, WHICH IS E-DECISIONI10 G3 AND WHICH U-ERBA-1
// PRICED AND DID NOT TAKE: «larghezza da 3/4 a 1 voxel completo».
report.line('');
let slim = 0;
let widest = 0;
let narrowest = 8;
let slimHot = 0;
for (let j = 0; j < CHUNK * BLADES_PER_VOXEL; j++) {
  for (let i = 0; i < CHUNK * BLADES_PER_VOXEL; i++) {
    const w = shadeChunk.slim[(j + boz) * bw + (i + bo)];
    if (!w) continue;
    slim++;
    if (w > widest) widest = w;
    if (w < narrowest) narrowest = w;
    const x = (SHADE_CX * CHUNK * BLADES_PER_VOXEL + i + 0.5) * BLADE;
    const z = (SHADE_CZ * CHUNK * BLADES_PER_VOXEL + j + 0.5) * BLADE;
    if (mantoIntensity(x, z) >= MANTO.slim.below) slimHot++;
  }
}
report.check(slim > 0 && narrowest >= MANTO.slim.low && widest < MANTO.slim.high
  && slimHot === 0,
  'a blade stands between three quarters and the whole of its cell, and only where the '
  + 'mat is thin enough for it to be free',
  `${slim} of one chunk stand apart, ${narrowest}/8 to ${widest}/8 wide, none of them where `
  + `the intensity is over ${MANTO.slim.below}`);

report.end();
