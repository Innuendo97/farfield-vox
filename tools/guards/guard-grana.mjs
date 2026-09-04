import { MANTO, meshDisc } from '../../src/world/voxel/pure.js';
import { SPAWN } from '../../src/world/layout.js';
import { TIERS } from '../../src/core/quality.js';
import { reporter, selfTest } from './lib.mjs';

// The largest disc any tier lays, for the reason written in guard-fusione.
const SHIPPED_RADIUS = Math.max(...TIERS.map((t) => t.voxelDiscRadius));

// AND THE CORRIDOR NEEDS NO TELLING: it is columns of this disc, written by the
// pipeline, and both arms below lay it identically. The difference between them
// stays a fact about the GRAIN, which is what this guard is for.


// THE TWO DIALS THAT MOVE THE GEOMETRY OF THE WORLD WHILE LOOKING LIKE TASTE.
//
// THE DIALS CHANGED TWICE AND THE JOB HAS NOT CHANGED ONCE. What this guard
// first froze was the TUFT -- a value noise thresholded to plus or minus a voxel
// -- and then the SODS, plates of turf on a lattice standing one voxel proud of
// the plane. Both are gone, and E-DECISIONI8 is why in the committente's own
// words: «e' per questo che il terreno era perfettamente pianeggiante: stavate
// analizzando i fili d'erba come rilievi». Both mechanisms were readings of the
// GRASS as terrain. The terrain is one level (guard-piano) and the grass is a
// MAT of its own at half the step, whose law is gated by guard-erba.
//
// So what is frozen here are the two numbers of the new mechanism that do
// exactly what the old two did -- decide the geometry of the whole world while
// reading as an art choice in any review:
//
//   MANTO.detail  how far from the walker the blades are drawn ONE BY ONE, in
//                 metres, before the mat is sampled in blocks. It is the single
//                 largest lever on the price of this world: E-ERBA-A 6.3
//                 measured that a field with no correlation gives the greedy
//                 mesher nothing to merge, so every metre of this ring is paid
//                 for in triangles and it grows with the square.
//   MANTO.block   how many blades share one height beyond that ring, which is
//                 what the ring's own price is divided by.
//
// AND THE VALUE IS THE ANSWER TO A MEASUREMENT AND NOT A TASTE, WHICH IS WHY IT
// IS FROZEN RATHER THAN RE-DERIVED. D-E2, the coordinator's answer to «fin dove
// arrivano i fili», is «fidelity as far as the frame holds»: U-ERBA-1 laid the
// disc at 3, 4, 6 and 8 metres on a loaded machine at the lowest tier, read the
// frame on the driver's own clock, and took the largest that keeps it inside
// 14.0 ms. The table is in the verbale; the answer is six metres, and eight is
// what fails it. A guard that re-derived the "right" value would agree with
// whatever the file said and catch nothing; what is wanted is that nobody moves
// them WITHOUT SAYING SO -- which means moving this file too, in the same
// commit, where a reviewer can see it.
//
// AND IT PRINTS WHAT THE MAT COSTS, every run. The frozen constants stop the
// dial from being turned; they say nothing about the ground underneath it
// moving, and the mat's share of the disc is the number that would show that
// first. It is printed rather than gated because the disc is V1's to rewrite
// and the total is already gated by guard-fusione: what this adds is that the
// drift is SEEN while it happens rather than found afterwards.

// The values the sweep was run at, restated here on purpose: two files have to
// change together or the guard goes red. PROPOSED by U-ERBA-1 (verbale) against
// the frame table it measured; the row that stood here was the sods' 0.60 m cell
// and 0.78 density.
const FROZEN = { detail: 6, block: 4 };

// Where the ring is anchored: the walker's own seat, which is also the pose the
// campaign judges on. See the note over `focus` in src/world/layers/v1-suolo.js.
const FOCUS = { x: SPAWN.x, z: SPAWN.z };

// What the tuft cost when the engine was promoted into the foundation, as the
// oldest yardstick the printed figure is read against.
const AT_FOUNDATION = { on: 0.5360, off: 0.1985, carpet: 0.3375 };

// And what the CARPET cost on the day the committente was shown its price and
// chose it (E-DECISIONI.1), at the radius the tiers lay: 1.5362 q/col over a
// bare field of 0.1903, measured offline and reproduced by the page digit for
// digit. THIS ROW IS A RECORD AND IS NEVER RE-BASED: it is what he approved,
// and the distance from it is printed on every run for as long as the two
// differ, in whichever direction they differ.
const AT_APPROVED = { on: 1.5362, off: 0.1903, carpet: 1.3459 };

// AND WHAT IT COST WHEN THIS ROW WAS LAST WRITTEN.
//
// U-V1-F (E-V1i) replaced the per-column grain with a floor and placed mounds;
// U-V1-F2 (E-V1k) gave each mound one earth bank, kept the floor's grain off
// its back and turned the corridor's verge to ground: 0.5334 with the carpet,
// 0.1900 bare, 0.3434 for the carpet alone. U-FOND-1 (E-FOND-PIANO2) made the
// field a plane at BASE_LEVEL: 0.3826 / 0.0215 / 0.3610.
//
// IT IS DELIBERATELY BEHIND THE WORLD AND THE NOTE BELOW IS THE POINT. U-FOND-2
// moved three things at once -- the tuft became the sods, the bank against the
// stone went to nought, and the figure started counting the bare earth's own
// mesh as well as the meadow's -- so the number this file should carry is a new
// one. Writing a yardstick is the coordinator's act and not a unit's (E-V1j,
// E-V1k: the literal is PROPOSED by the unit and committed by the coordinator),
// so the row stands where it stood and the run says out loud how far the world
// has moved from it. The proposal is in the verbale of U-FOND-2.
// U-FOND-2 (E-FOND-PIANO4): the grain replaced the tuft, the bank against the
// stone went to nought (the masses stand on the bare plane, so `off` rose) and
// bare earth entered the count: 0.3505 grained, 0.0478 bare, 0.3027 for the
// grain alone. Against the approved price (1.3459) the carpet is 1.0432 lower.
// U-FOND-3 (E-FOND-PIANO6): the corridor is a phase of the store, one voxel
// under the meadow with earth verges, so the disc lost the grain those columns
// carried: 0.3278 grained, 0.0410 bare, 0.2868 for the grain alone.
// U-FOND-4 (E-FOND-PIANO8): banks of two or three, straight cuts, lattice
// 3.8 m: 0.3290 grained, 0.0524 bare, 0.2766 for the grain alone.
// U-FOND-5 (E-FOND-PIANO9): the framed seats come from the reference and the
// stone's footprint answers the plane: 0.3335 grained, 0.0501 bare, 0.2833.
// U-ERBA-6 -- this unit, U-ERBA-1 (E-ERBA-A, E-DECISIONI8/9/10): the sods fell
// out of the terrain and the MAT went in over it, at half the step, with a field
// of intensity that thins it into the corridor and a band of bare earth that
// thins with it. The row it proposes is 1.4154 for the mat over a bare 0.1078,
// and writing it is the coordinator's act, so the row below stands where it
// stood and every run says out loud how far the world has moved from it.
// U-ERBA-1 (E-ERBA1): the sods left the terrain and the MAT of grass went in
// over it at half the step: 1.4154 with the mat over a bare 0.1078.
const AT_TODAY = { on: 1.5140, off: 0.1062, carpet: 1.4078 };

/** Whether a constant is still the frozen one. Bit for bit: these are dials. */
export const frozen = (actual, expected) => actual === expected;

if (process.argv.includes('--self')) {
  const on = meshDisc(null, true, SHIPPED_RADIUS, FOCUS);
  const off = meshDisc(null, false, SHIPPED_RADIUS, FOCUS);
  const carpet = on.quadsPerColumn - off.quadsPerColumn;
  selfTest('guard-grana', [
    { what: 'a ring widened to 8 m is caught', caught: !frozen(8, FROZEN.detail) },
    { what: 'a ring nudged to 6.0000001 is caught', caught: !frozen(6.0000001, FROZEN.detail) },
    { what: 'a block moved from 4 blades to 6 is caught', caught: !frozen(6, FROZEN.block) },
    {
      what: 'the frozen pair passes',
      caught: frozen(6, FROZEN.detail) && frozen(4, FROZEN.block),
    },
    {
      // The mechanism this guard exists for, tested on itself rather than on
      // the number of the day: a yardstick that has been left behind HAS to
      // make the run say so, whichever of the two moved.
      what: 'a yardstick left behind by a world that moved is reported',
      // Tested by INJECTION, not on the number of the day: the day the
      // yardstick agrees with the world (as it should) this case must still hold.
      caught: drifted(AT_TODAY.carpet + 0.01) !== null && drifted(AT_TODAY.carpet - 0.01) !== null,
    },
    {
      what: 'a yardstick that agrees with the world is not reported',
      caught: drifted(AT_TODAY.carpet) === null,
    },
    {
      what: 'the two yardsticks are not the same number wearing two names',
      caught: Math.abs(AT_APPROVED.carpet - AT_TODAY.carpet) >= 5e-4,
    },
    {
      what: 'the mat really is what the third argument switches off',
      caught: on.quadsPerColumn > off.quadsPerColumn * 2,
    },
  ]);
}

/** How far the carpet has moved from this file's row, or null if it has not. */
export function drifted(carpet) {
  const gap = carpet - AT_TODAY.carpet;
  return Math.abs(gap) >= 5e-4 ? gap : null;
}

const report = reporter('guard-grana -- the two dials of the grain, and what it costs today');

report.check(frozen(MANTO.detail, FROZEN.detail),
  'MANTO.detail is the radius the frame was measured at',
  `${MANTO.detail} m against ${FROZEN.detail}`);
report.check(frozen(MANTO.block, FROZEN.block),
  'MANTO.block is the block the same table was read with',
  `${MANTO.block} blades against ${FROZEN.block}`);

const on = meshDisc(null, true, SHIPPED_RADIUS, FOCUS);
const off = meshDisc(null, false, SHIPPED_RADIUS, FOCUS);
const carpet = on.quadsPerColumn - off.quadsPerColumn;
const share = carpet / off.quadsPerColumn;

report.line('');
report.line(`  the disc with the mat    ${on.quadsPerColumn.toFixed(4)} q/col`
  + `   (at the foundation ${AT_FOUNDATION.on.toFixed(4)})`);
report.line(`  the plane and its masses ${off.quadsPerColumn.toFixed(4)} q/col`
  + `   (at the foundation ${AT_FOUNDATION.off.toFixed(4)})`);
report.line(`  THE MAT ALONE            ${carpet.toFixed(4)} q/col`
  + `   (at the foundation, when it was the tuft, ${AT_FOUNDATION.carpet.toFixed(4)})`
  + `, ${(share * 100).toFixed(0)}% of the rest`);
report.line(`  and in the unit the budget gates on: ${on.triangles} triangles`
  + `   (${off.triangles} without the mat)`);
report.line(`  per BLADE column, which is the mat's own denominator: `
  + `${(on.quadsPerBlade * 2).toFixed(3)} triangles over ${on.blades} of them`);

// WHAT THE COMMITTENTE APPROVED, BESIDE WHAT IS ON THE CARD, EVERY RUN. Not a
// gate: the price is his to move and V1's to spend. What this refuses to allow
// is that the two part company QUIETLY, so the gap is printed whichever way it
// points and the direction is named, because a bill that fell and a bill that
// rose are two different conversations to have with him.
const approved = carpet - AT_APPROVED.carpet;
if (Math.abs(approved) >= 5e-4) {
  report.line(`  against the price the committente approved (${AT_APPROVED.carpet.toFixed(4)} q/col, `
    + `E-DECISIONI.1): ${approved > 0 ? '+' : ''}${approved.toFixed(4)} q/col, the bill has `
    + `${approved > 0 ? 'RISEN -- his word is needed' : 'FALLEN -- declare it, do not ask'}`);
}

const gap = drifted(carpet);
if (gap !== null) {
  report.note(`the mat's share stands ${gap > 0 ? '+' : ''}${gap.toFixed(4)} q/col from what `
    + `this file says ships (${AT_TODAY.carpet.toFixed(4)}). U-ERBA-1 took the sods out of the `
    + 'terrain and put the MAT over it, at half the step: the row proposed for this file is '
    + `${carpet.toFixed(4)} over a bare ${off.quadsPerColumn.toFixed(4)}, and writing it is `
    + "the coordinator's");
}

report.end();
