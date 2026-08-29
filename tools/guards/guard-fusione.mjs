import { meshDisc } from '../../src/world/voxel/pure.js';
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


// HOW WELL THE GREEDY MESHER FUSES THE FIELD, MEASURED AND NOT CLAIMED.
//
// Quads over columns is the one number the whole pivot was argued on, and until
// now it was reported by a running page, in a HUD, at one moment, on one
// machine. This lays the same disc under plain node, through the same
// arithmetic the worker and the page run, and gets the same number -- which is
// what turns a screenshot into a measurement. It is also why
// src/world/voxel/pure.js must never gain an import a browser is needed for.
//
// TWO THRESHOLDS, AND THEY MEAN DIFFERENT THINGS.
//
//   the WALL   above it the allocation the campaign has agreed is spent by
//              arithmetic and nothing further needs measuring. It stands just
//              over what ships, so a disc drifting towards it is caught before
//              it arrives. It has MOVED -- see the block below.
//   the TARGET between the two the world still runs and the pivot still stands;
//              what is true is that a promise has not been kept. So the number
//              is PRINTED with the owner beside it and the guard exits green.
//
// A single threshold would have had to be one or the other, and both readings
// are wrong: at the wall the guard says nothing about a disc drifting towards
// it, and at the target it is red from the day it is written -- which is how a
// guard stops being read at all.
//
// The lever on the remaining gap is named rather than left to be rediscovered:
// the two-dimensional merge of the flanks, which the mesher deliberately does
// not do (see src/world/voxel/mesher.js). Its headroom is not quantified, and
// quantifying it is V1's, not this guard's.

// ------------------------------------------------------------------------
// THE WALL MOVED, AND IT MOVED BECAUSE THE COMMITTENTE MOVED IT.
//
// 0.55 WAS NOT A LAW, IT WAS AN ALLOCATION WRITTEN AS A RATIO. Its arithmetic:
// at the radius the campaign priced, the disc holds 58 046 columns, so 0.55
// q/col is 31 925 quads and 63 850 triangles -- the 60 000 the disc was
// allocated, plus the rounding. Nothing about greedy meshing says 0.55; what it
// said was "this many triangles".
//
// THE ALLOCATION IS NOT 60 000 ANY MORE. A1-bis measured that the day target's
// own meadow puts 14% of its risers at three voxels or more and that no tuft of
// plus or minus one can make them; D3a re-priced the three answers on the page
// with the frozen engine reproducing it digit for digit; the question went to
// the committente as a price, and the committente chose (E-DECISIONI.1, the
// carpet as the target draws it) at 1.73x of the reallocated budget. Measured
// here and on the page, that arm is 1.5362 q/col.
//
// SO THE WALL IS PUT BACK WHERE IT WAS, RELATIVE TO WHAT SHIPS. E-V1b records
// the old margin exactly: 0.55 against a shipped 0.5262 is 4.3%. The same
// margin over the approved 1.5362 is 1.602, and the wall was 1.60 -- 4.15%. It
// is the same guard doing the same job against a different decision, and it is
// NOT a wall raised to let a change through: the change was priced, put to the
// committente in three arms, and chosen before a line of it was written.
//
// AND THEN IT CAME DOWN, BY THE SAME ARITHMETIC AND IN THE OTHER DIRECTION.
// The orchestrator's eye passed everything of that arm except the SHAPE of the
// carpet -- towers where the target lifts broad masses -- and the two dials
// that answer it (MOUND.clump 0.42 -> 0.85, MOUND.meadowGate 0.70 -> 0.80)
// both pile LESS meadow: the disc ships at 1.4129 q/col, not 1.5362. A wall
// left at 1.60 would sit 13% above what ships and would not notice the carpet
// growing a tenth of itself back. So the SAME 4.15% margin is taken over the
// new figure -- 1.4715 -- and the wall is 1.47. Lowering a wall to follow a
// bill that fell is the opposite of the move E-V1b warns about, and it is
// written here rather than left implicit precisely because the two look alike
// from a distance: what is forbidden is moving the wall so a number can pass,
// and what is done here is moving it so a number could no longer hide.
//
// AND THE METRIC ITSELF IS ALREADY RETIRED, WHICH IS WHY THIS IS PROVISIONAL.
// E-V1b: q/col rewards the wrong move -- taking the radius from 14 to 35
// IMPROVES it by 19% while multiplying the triangles by 4.27 -- so the
// re-derivation is U-V0-GUARDIA's: a bell on the figure at a declared radius,
// and a gate on the TRIANGLES AT vox-giorno against the allocation. That is not
// taken here, because it is not this unit's to take. What is done here is the
// least that keeps the guard true: the same arithmetic, the same shape of
// threshold, moved to the number the campaign now decides by. When U-V0-GUARDIA
// lands, this whole block is replaced rather than adjusted.
// ------------------------------------------------------------------------

/** D1's wall, at the same margin over what ships. Provisional: see above. */
const DISQUALIFY = 1.47;
// D1's target. E-V1b retired it as an imposed number -- the absolute floor
// under any partition of this field is 0.5035, so 0.45 is unreachable in any
// world and the target's own meadow reads 1.54 -- but it is left printing,
// because a number that was promised and not kept is worth saying out loud.
const TARGET = 0.45;
const OWNER = 'V1';

/** What a fusion figure is worth, as the two thresholds see it. */
export function verdict(perColumn) {
  return {
    disqualified: perColumn > DISQUALIFY,
    missed: perColumn > TARGET,
  };
}

if (process.argv.includes('--self')) {
  selfTest('guard-fusione', [
    { what: 'a disc at 1.70 q/col is disqualified', caught: verdict(1.70).disqualified },
    { what: 'a disc at 1.4700001 q/col is disqualified', caught: verdict(1.4700001).disqualified },
    {
      what: 'the arm the committente approved would no longer pass this wall',
      caught: verdict(1.5362).disqualified,
    },
    {
      what: 'a disc at 1.45 q/col passes but is declared short of the target',
      caught: !verdict(1.45).disqualified && verdict(1.45).missed,
    },
    {
      what: 'a disc at 0.44 q/col passes with nothing to declare',
      caught: !verdict(0.44).disqualified && !verdict(0.44).missed,
    },
    {
      what: 'the measurement itself still lands where the shape correction put it',
      caught: Math.abs(meshDisc(null, true, SHIPPED_RADIUS).quadsPerColumn
        - 1.4128966681597355) < 1e-12,
    },
  ]);
}

const report = reporter('guard-fusione -- quads per column on the real field, offline');

const disc = meshDisc(null, true, SHIPPED_RADIUS);
const seen = verdict(disc.quadsPerColumn);

report.line(`  ${disc.chunks.length} chunks, ${disc.quads} quads over ${disc.columns} columns, `
  + `at the ${SHIPPED_RADIUS} m the tiers lay`);
report.line(`  quads per column        ${disc.quadsPerColumn.toFixed(4)}`);
report.line(`  with the rim taken out  ${disc.insidePerColumn.toFixed(4)}`
  + `   (${disc.rim} of the walls exist because something ends there)`);

report.check(!seen.disqualified,
  `the disc fuses inside the wall of ${DISQUALIFY} q/col`,
  `${disc.quadsPerColumn.toFixed(4)} against ${DISQUALIFY}`);

if (seen.missed && !seen.disqualified) {
  report.note(`fusione ${disc.quadsPerColumn.toFixed(4)} q/col is over the target `
    + `${TARGET} by ${(disc.quadsPerColumn - TARGET).toFixed(4)}: target missed, owner ${OWNER}`);
} else if (!seen.missed) {
  report.check(true, `and it is inside the target of ${TARGET} q/col`);
}

report.end();
