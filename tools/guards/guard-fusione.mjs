import { meshDisc, setGroundHole } from '../../src/world/voxel/pure.js';
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

// AND THE CORRIDOR IS TOLD TO THE ENGINE, FOR THE SAME REASON AND IN THE SAME
// SENTENCE. The engine's own answer to "where is the ground not mine" is a
// straight passage it can work out without being told; the page injects the
// world's own -- groundHoleAt -- and the disc that ships is 923 columns smaller
// for it at this radius (v1-suolo/misure/d4b-buco.json). A guard left on the
// engine's default would weigh a disc nobody draws, which is the very thing the
// paragraph above exists to forbid.
setGroundHole(groundHoleAt);


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
// AND THEN IT MOVED TWICE MORE, BY THE SAME ARITHMETIC, AND THE RULE IS THE
// ARITHMETIC AND NOT THE DIRECTION. The wall is always the SAME 4.15% over what
// the disc actually ships, so it follows the ship wherever the ship goes:
//
//   clump 0.85 alone (grana 0.45)   ships 1.4442   wall 1.50
//   grana 0.53 on top of it         ships 1.5261   wall 1.59
//   the corridor's own hole         ships 1.5270   wall 1.59
//   a floor with placed mounds      ships 0.6323   wall 0.66   <- now (E-V1i)
//
// THE LAST ROW MOVED THE SHIP AND DID NOT MOVE THE WALL, and that is worth
// saying rather than leaving to be noticed. The disc stopped laying 923 columns
// that stood under the paving; a column carries roughly its own quads, so the
// RATIO barely moves -- 1.5261 to 1.5270, nine ten-thousandths -- while the
// world got 1 356 quads and 2 712 triangles cheaper. 4.15% over the new ship
// still rounds to 1.59. A fusion figure that rises while the bill falls is the
// honest reading of a ratio whose denominator lost its cheapest columns, and it
// is exactly why E-V1b retired this metric: the triangles are in
// v1-suolo/misure/d4b-buco.json and quota-disegnata.mjs is where they gate.
//
// What is forbidden by E-V1b is moving a wall SO THAT A NUMBER CAN PASS. What
// is done here is holding the margin fixed and letting the wall follow the
// measurement, in both directions, so that the wall keeps detecting the one
// thing it exists to detect: a carpet that grows when nobody asked it to. A
// wall left behind at 1.50 would now fail a world that is working as decided; a
// wall left behind at 1.60 would not notice a carpet growing a twentieth of
// itself. Neither is a gate.
//
// A NOTE ON WHAT THIS WALL IS NOT. It is not the coordinator's price ceiling.
// That ceiling is 1.73x of the reallocated triangle budget MEASURED AT A POSE
// (vox-giorno, 152 240 triangles at the buffer), and it is enforced by the
// green gate in quota-disegnata.mjs against a chunk list the page hands over.
// This wall is q/col on the whole disc, and it is about FUSION. The two once
// happened to reject the same arm -- grana 0.57 -- and that coincidence was
// briefly written into this file as a test case. It is not written here any
// more: two gates that agree by accident are one gate with a spare name, and
// the day they disagree the spare name is the one that lies.
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

/** D1's wall, at the same margin over what ships. Provisional: see above.
 * Moved with U-V1-F (E-V1i): the disc ships at 0.6323 q/col, 4.15% over is 0.66. */
const DISQUALIFY = 0.66;
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
    { what: 'a disc a hair over the wall is disqualified', caught: verdict(DISQUALIFY + 1e-7).disqualified },
    { what: 'a disc a hair under the wall is not', caught: !verdict(DISQUALIFY - 1e-7).disqualified },
    {
      // The margin is the contract, not the number: this is the assertion that
      // survives the wall moving, and it is the one that would catch a wall
      // nudged to let a particular measurement through.
      what: 'the wall stands at the declared 4.15% over what actually ships',
      caught: Math.abs(DISQUALIFY
        - Number((meshDisc(null, true, SHIPPED_RADIUS).quadsPerColumn * 1.0415).toFixed(2))) < 5e-3,
    },
    {
      what: 'a disc at 0.60 q/col passes but is declared short of the target',
      caught: !verdict(0.60).disqualified && verdict(0.60).missed,
    },
    {
      what: 'a disc at 0.44 q/col passes with nothing to declare',
      caught: !verdict(0.44).disqualified && !verdict(0.44).missed,
    },
    {
      what: 'the measurement itself still lands where the shape and grain put it',
      caught: Math.abs(meshDisc(null, true, SHIPPED_RADIUS).quadsPerColumn
        - 0.6322847189398316) < 1e-12,
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
