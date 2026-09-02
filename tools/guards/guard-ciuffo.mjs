import { TUFT_CORRELATION, TUFT_GATE, meshDisc, setGroundHole } from '../../src/world/voxel/pure.js';
import { groundHoleAt } from '../../src/world/contracts.js';
import { TIERS } from '../../src/core/quality.js';
import { reporter, selfTest } from './lib.mjs';

// The largest disc any tier lays. The reach is governed by
// quality.voxelDiscRadius now (E-V1a, E-V1d), so the disc a guard weighs is the
// disc the world puts on a screen -- not the one the engine answers with when
// nobody asks. It matters to the FIGURE and not only to the run time: q/col
// FALLS as the radius grows, because a bigger disc is proportionally less rim,
// so a guard reading the default while the tiers laid something smaller would
// report a number flattering to a world nobody draws.
const SHIPPED_RADIUS = Math.max(...TIERS.map((t) => t.voxelDiscRadius));

// AND THE CORRIDOR IS TOLD TO THE ENGINE, for the same reason as the radius: the
// page injects the world's own answer for where the ground is cut away
// (groundHoleAt), and the disc that ships is 923 columns smaller for it
// (v1-suolo/misure/d4b-buco.json). BOTH ARMS BELOW ARE MESHED WITH IT, which is
// what keeps the difference between them a fact about the CARPET: the bare field
// lost the same columns the carpeted one did.
setGroundHole(groundHoleAt);


// THE TWO DIALS THAT MOVE THE GEOMETRY OF THE WORLD WHILE LOOKING LIKE TASTE.
//
// The ground of this project is nearly flat at ten centimetres, so the cubic
// look has to be MADE, and the tuft is what makes it. Which means the two
// numbers that shape the tuft are a performance budget wearing the clothes of an
// art choice: decorrelating the length multiplies the quads of the world by
// about three and a half, and moving the gate from thirds to halves moves them
// by another quarter. Neither would read as a change to the budget in any
// review, and both are one character to type.
//
// SO THIS GUARD DOES NOT RE-MEASURE THEM. It asserts that they are still the
// values the sweep behind the recommendation was run at. A guard that re-derived
// the "right" value would agree with whatever the file said and catch nothing;
// what is wanted is that nobody moves them WITHOUT SAYING SO -- which means
// moving this file too, in the same commit, where a reviewer can see it.
//
// AND IT PRINTS WHAT THE CARPET COSTS, every run. The frozen constants stop the
// dial from being turned; they say nothing about the field underneath it moving,
// and the tuft's share of the disc is the number that would show that first. It
// is printed rather than gated because the disc is V1's to rewrite and the total
// is already walled by guard-fusione: what this adds is that the drift is SEEN
// while it happens rather than found afterwards.
//
// WHAT THE `tuft` FLAG NOW SEPARATES, and it is more than it was. It used to be
// the tuft alone; the ground it switches off is now the whole CARPET the
// committente chose (E-DECISIONI.1) -- the tuft, the grain that replaces it on
// 45% of the columns, and the piles of three to six voxels against the stone and
// in the open meadow. So the figure below jumped, and it jumped because the
// meadow changed and not because anything drifted. The foundation reading is
// kept beside it as the record of where it came from.

// The values the sweep was run at, restated here on purpose: two files have to
// change together or the guard goes red.
const FROZEN = { TUFT_CORRELATION: 0.30, TUFT_GATE: 0.5 };

// What the tuft cost when the engine was promoted into the foundation, as the
// yardstick the printed figure is read against.
const AT_FOUNDATION = { on: 0.5360, off: 0.1985, tuft: 0.3375 };

// And what the CARPET cost on the day the committente was shown its price and
// chose it (E-DECISIONI.1), at the radius the tiers lay: 1.5362 q/col over a
// bare field of 0.1903, measured offline and reproduced by the page digit for
// digit. THIS ROW IS A RECORD AND IS NEVER RE-BASED: it is what he approved,
// and the distance from it is printed on every run for as long as the two
// differ, in whichever direction they differ.
const AT_APPROVED = { on: 1.5362, off: 0.1903, carpet: 1.3459 };

// AND WHAT IT COSTS NOW, WHICH IS LESS.
//
// The orchestrator judged the crops and passed everything except the SHAPE of
// the carpet: our three-and-over stood as single column towers with their
// flanks in shadow where the target lifts broad shouldered masses. The dial
// that answers that is in mesher.js -- MOUND.clump 0.42 -> 0.85, a clump as
// wide as the band a mound stands in -- and it PILES NO LESS MEADOW, it gathers
// the same meadow into half as many masses twice as broad. That is cheaper
// geometry for the same ground, so the bill went DOWN: 1.72x of the reallocated
// budget at vox-giorno became 1.62x. A price that falls is declared and
// shipped; one that rose would have needed the committente's word before a line
// was written, and one did -- see the note over MOUND.meadowGate, which went to
// 0.80 and came back when the eye and the estimator both said the tail had gone
// past the target rather than onto it.
//
// AND THEN THE CHANGE THAT WAS ASKED FOR RATHER THAN DECLARED. Neither shape
// dial moves the DOUBLE STEP -- the second bucket of the target's own
// distribution, and the one this carpet stands furthest from. CARPET_GRAIN is
// the only dial that does. 0.45 -> 0.53 buys 16.50% -> 17.31% of it and costs
// 1.62x -> 1.71x: a bill that ROSE. So it was priced first, REFUSED at the
// value proposed (0.57 drew 154 220 triangles at vox-giorno, 1.752x against a
// ceiling of 1.73x, measured on the page and not modelled), and taken only at
// the largest value that fits under the ceiling, with the word given for it.
// That is the whole difference between this line and the one above it.
//
// This is the yardstick a DRIFT is read against, because a drift is something
// nobody meant. The line above is the yardstick a DECISION is read against.
//
// AND IT WAS RE-BASED ONCE MORE, BY A DECISION AND NOT BY A DRIFT. The disc
// stopped laying the 923 columns that stood under the corridor's own paving --
// authorised at E-V1g, measured in v1-suolo/misure/d4b-buco.json -- so both arms
// of this row are 923 columns lighter than they were: 1.5261 -> 1.5270 with the
// carpet, 0.1903 -> 0.1919 bare, and the CARPET ALONE 1.3358 -> 1.3351. The
// carpet fell by seven ten-thousandths and the two full discs ROSE, because the
// columns that went were the flattest and cheapest in the world -- ground under
// stone -- and a ratio that loses its cheapest denominator goes up while the
// bill goes down. The bill is 1 356 quads and 2 712 triangles, in the same file.
// A row left behind at 1.3358 would have called a decided change a drift.
// U-V1-F (E-V1i) replaced the per-column grain with a floor and placed
// mounds: the carpet now costs 0.4404 q/col over the bare field, and the full
// disc reads 0.6323. The approved row above stays as the ceiling it became.
const AT_TODAY = { on: 0.6323, off: 0.1919, carpet: 0.4404 };

/** Whether a constant is still the frozen one. Bit for bit: these are dials. */
export const frozen = (actual, expected) => actual === expected;

if (process.argv.includes('--self')) {
  selfTest('guard-ciuffo', [
    { what: 'a correlation length moved to 0.42 is caught', caught: !frozen(0.42, FROZEN.TUFT_CORRELATION) },
    { what: 'a correlation length nudged to 0.3000001 is caught', caught: !frozen(0.3000001, FROZEN.TUFT_CORRELATION) },
    { what: 'a gate moved from thirds to halves is caught', caught: !frozen(0.3333, FROZEN.TUFT_GATE) },
    { what: 'the frozen pair passes', caught: frozen(0.30, FROZEN.TUFT_CORRELATION) && frozen(0.5, FROZEN.TUFT_GATE) },
    {
      what: 'the carpet still costs what this file says it ships at',
      caught: Math.abs((meshDisc(null, true, SHIPPED_RADIUS).quadsPerColumn
        - meshDisc(null, false, SHIPPED_RADIUS).quadsPerColumn) - AT_TODAY.carpet) < 5e-4,
    },
    {
      what: 'a yardstick left behind by a dial that moved is caught',
      caught: Math.abs(1.3459 - AT_TODAY.carpet) >= 5e-4,
    },
    {
      what: 'the two yardsticks are not the same number wearing two names',
      caught: Math.abs(AT_APPROVED.carpet - AT_TODAY.carpet) >= 5e-4,
    },
  ]);
}

const report = reporter('guard-ciuffo -- the two dials, and what the carpet costs today');

report.check(frozen(TUFT_CORRELATION, FROZEN.TUFT_CORRELATION),
  'TUFT_CORRELATION is the value the sweep was run at',
  `${TUFT_CORRELATION} against ${FROZEN.TUFT_CORRELATION}`);
report.check(frozen(TUFT_GATE, FROZEN.TUFT_GATE),
  'TUFT_GATE is the value the sweep was run at',
  `${TUFT_GATE} against ${FROZEN.TUFT_GATE}`);

const on = meshDisc(null, true, SHIPPED_RADIUS);
const off = meshDisc(null, false, SHIPPED_RADIUS);
const carpet = on.quadsPerColumn - off.quadsPerColumn;
const share = carpet / off.quadsPerColumn;

report.line('');
report.line(`  the disc with the carpet ${on.quadsPerColumn.toFixed(4)} q/col`
  + `   (at the foundation ${AT_FOUNDATION.on.toFixed(4)})`);
report.line(`  the bare voxelised field ${off.quadsPerColumn.toFixed(4)} q/col`
  + `   (at the foundation ${AT_FOUNDATION.off.toFixed(4)})`);
report.line(`  THE CARPET ALONE         ${carpet.toFixed(4)} q/col`
  + `   (at the foundation, when it was only the tuft, ${AT_FOUNDATION.tuft.toFixed(4)})`
  + `, ${(share * 100).toFixed(0)}% of the rest`);

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

const drift = Math.abs(carpet - AT_TODAY.carpet);
if (drift >= 5e-4) {
  report.note(`the carpet's share has moved ${drift.toFixed(4)} q/col from what this file says `
    + 'ships -- either a dial in mesher.js moved without this file moving with it, or the '
    + 'field underneath the dials moved on its own');
}

report.end();
