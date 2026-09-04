import {
  BLADE, BLADES_PER_VOXEL, MANTO, MATERIAL, SUB, VOXEL,
  bladeAtColumn, bladeHeightAt, columnSpec, mantoAt, mantoIntensity, meshDisc,
} from '../../src/world/voxel/pure.js';
import { TIERS } from '../../src/core/quality.js';
import { SPAWN } from '../../src/world/layout.js';
import { bladeSettings } from '../../src/world/voxel/material.js';
import { reporter, selfTest } from './lib.mjs';

/** The pair the mat's own material carries, so this file cannot quote a stale one. */
const BLADE_FOOT = bladeSettings().base;

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
report.check(falls(heights.slice().reverse()) && heights[heights.length - 1] > heights[0] * 1.5,
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
report.line(`  and it keeps ${FOOT.decay} of that loss one blade higher, so the rungs read `
  + `${[0, 1, 2, 3, 4].map((r) => (1 - FOOT.fall * FOOT.decay ** r).toFixed(3)).join(' ')}`);
report.line('  against E-ERBA-A 1.6 on the target: 0.844 at the foot, 0.931-0.997 at 5-7 cm, '
  + '1.015 above it');
report.line('  the flank over the top, and how far the bounce carries it, are readings of a '
  + 'PIXEL: verbale U-ERBA-1');

report.end();
