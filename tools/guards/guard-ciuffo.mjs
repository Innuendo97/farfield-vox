import { TUFT_CORRELATION, TUFT_GATE, meshDisc } from '../../src/world/voxel/pure.js';
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
// AND IT PRINTS WHAT THE TUFT COSTS, every run. The frozen constants stop the
// dial from being turned; they say nothing about the field underneath it moving,
// and the tuft's share of the disc is the number that would show that first. It
// is printed rather than gated because the disc is V1's to rewrite and the total
// is already walled by guard-fusione: what this adds is that the drift is SEEN
// while it happens rather than found afterwards.

// The values the sweep was run at, restated here on purpose: two files have to
// change together or the guard goes red.
const FROZEN = { TUFT_CORRELATION: 0.30, TUFT_GATE: 0.5 };

// What the tuft cost when the engine was promoted into the foundation, as the
// yardstick the printed figure is read against.
const AT_FOUNDATION = { on: 0.5360, off: 0.1985, tuft: 0.3375 };

/** Whether a constant is still the frozen one. Bit for bit: these are dials. */
export const frozen = (actual, expected) => actual === expected;

if (process.argv.includes('--self')) {
  selfTest('guard-ciuffo', [
    { what: 'a correlation length moved to 0.42 is caught', caught: !frozen(0.42, FROZEN.TUFT_CORRELATION) },
    { what: 'a correlation length nudged to 0.3000001 is caught', caught: !frozen(0.3000001, FROZEN.TUFT_CORRELATION) },
    { what: 'a gate moved from thirds to halves is caught', caught: !frozen(0.3333, FROZEN.TUFT_GATE) },
    { what: 'the frozen pair passes', caught: frozen(0.30, FROZEN.TUFT_CORRELATION) && frozen(0.5, FROZEN.TUFT_GATE) },
    {
      what: 'the tuft still costs what it cost when the engine was promoted',
      caught: Math.abs((meshDisc(null, true, SHIPPED_RADIUS).quadsPerColumn
        - meshDisc(null, false, SHIPPED_RADIUS).quadsPerColumn) - 0.3359) < 5e-4,
    },
  ]);
}

const report = reporter('guard-ciuffo -- the two dials, and what the tuft costs today');

report.check(frozen(TUFT_CORRELATION, FROZEN.TUFT_CORRELATION),
  'TUFT_CORRELATION is the value the sweep was run at',
  `${TUFT_CORRELATION} against ${FROZEN.TUFT_CORRELATION}`);
report.check(frozen(TUFT_GATE, FROZEN.TUFT_GATE),
  'TUFT_GATE is the value the sweep was run at',
  `${TUFT_GATE} against ${FROZEN.TUFT_GATE}`);

const on = meshDisc(null, true, SHIPPED_RADIUS);
const off = meshDisc(null, false, SHIPPED_RADIUS);
const tuft = on.quadsPerColumn - off.quadsPerColumn;
const share = tuft / off.quadsPerColumn;

report.line('');
report.line(`  the disc with the tuft   ${on.quadsPerColumn.toFixed(4)} q/col`
  + `   (at the foundation ${AT_FOUNDATION.on.toFixed(4)})`);
report.line(`  the disc without it      ${off.quadsPerColumn.toFixed(4)} q/col`
  + `   (at the foundation ${AT_FOUNDATION.off.toFixed(4)})`);
report.line(`  THE TUFT ALONE           ${tuft.toFixed(4)} q/col`
  + `   (at the foundation ${AT_FOUNDATION.tuft.toFixed(4)}), ${(share * 100).toFixed(0)}% of the rest`);

const drift = Math.abs(tuft - AT_FOUNDATION.tuft);
if (drift >= 5e-4) {
  report.note(`the tuft's share has moved ${drift.toFixed(4)} q/col from the foundation reading `
    + '-- the constants are frozen, so what moved is the field under them');
}

report.end();
