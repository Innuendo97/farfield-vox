import { meshDisc } from '../../src/world/voxel/pure.js';
import { TIERS } from '../../src/core/quality.js';
import { reporter, selfTest } from './lib.mjs';

// The largest disc any tier lays. The reach is governed by
// quality.voxelDiscRadius (E-V1a, E-V1d), so the disc a guard weighs is the
// disc the world puts on a screen -- not the one the engine answers with when
// nobody asks.
const SHIPPED_RADIUS = Math.max(...TIERS.map((t) => t.voxelDiscRadius));

// The radius the allocation of §2.9 was written at, before the tiers governed
// the reach. Nothing ships it; it is meshed and PRINTED because an allocation
// written for a disc nobody lays is a fact somebody should be able to see
// without re-deriving it.
const ALLOCATION_RADIUS = 35;

// AND NOTHING IS TOLD TO THE ENGINE ANY MORE. The disc used to be smaller than
// it looked, because the corridor was a hole in it and where that hole ran had
// to be injected; a guard left on the engine's own straight passage weighed a
// disc nobody drew. The corridor is COLUMNS of this disc now -- it is weighed
// here, with its own family counted -- so there is one disc and it is this one.


// WHAT THE DISC COSTS, IN THE UNIT THE BUDGET IS WRITTEN IN.
//
// THIS GUARD CHANGED ITS QUESTION, AND E-V1b IS WHY. What stood here gated
// QUADS PER COLUMN against a wall, and E-V1b retired that metric with the
// reason spelled out: it rewards the wrong move. Taking the radius from
// fourteen metres to thirty five IMPROVES q/col by 19% while multiplying the
// triangles by more than four, because a bigger disc is proportionally less
// rim. A figure that gets happier as the bill grows is not a gate.
//
// The re-derivation E-V1b asked for is the one below: a hard gate on the
// TRIANGLES the disc hands the card, against the allocation the campaign wrote
// for it, and the fusion figure kept as a PRINTED number because it is still
// the right thing to read when asking WHY the triangles moved.
//
// THE ALLOCATION IS §2.9's OWN ROW AND NOT A NUMBER CHOSEN HERE:
//
//     disco voxel 10 cm    V1    <= 1,5 ms    <= 60.000 tri    <= 22 draw
//
// It is the coordinator's to amend and nobody else's (§2.9, and rule R4: a
// layer over its allocation ESCALATES rather than quietly taking another
// session's margin). The wall that stood here instead FOLLOWED the measurement
// -- a fixed margin over whatever shipped, moved four times -- and a wall that
// moves with the world cannot catch a world that grows. This one does not move.
//
// AND ALL THREE FAMILIES ARE IN THE COUNT NOW. The disc hands the card three
// meshes -- the meadow, its bare earth and the PAVING -- and the retired figure
// counted only the first; E-V1k declared the gap and left it, 0.5334 against
// 0.5409 with both. A gate on what the card draws has to count what the card
// draws.
//
// AND THE CORRIDOR HAS NO ALLOCATION OF ITS OWN ANY MORE. §2.9 gave it a row --
// «sentiero V3 <= 0,4 ms, <= 4.000 tri, <= 2 draw», against which it shipped
// 3 638 triangles and 1 draw (E-V3g) -- because it was a surface somebody else
// hung. It is columns of this disc now: its triangles are in the number gated
// below and its draw is one of the disc's. The row that says otherwise is the
// coordinator's to strike, and this guard names it rather than assuming it.

/** §2.9's allocation for the voxel disc, in triangles. The coordinator's. */
const ALLOCATION = 60000;

// What the disc measures today, kept as a tripwire on the MEASUREMENT rather
// than as a second threshold. A gate at sixty thousand says nothing about a
// disc that doubles from forty to eighty thousand in one commit until the day
// it lands over the line; a declared figure beside it says so the same
// afternoon. It is printed, with the distance, and it never gates.
const AT_TODAY = 40038;

const OWNER = 'V1';

/** Whether a triangle count is inside the allocation. */
export function verdict(triangles) {
  return { over: triangles > ALLOCATION };
}

if (process.argv.includes('--self')) {
  const disc = meshDisc(null, true, SHIPPED_RADIUS);
  selfTest('guard-fusione', [
    { what: 'a disc at 90 000 triangles is caught', caught: verdict(90000).over },
    {
      what: 'a disc one triangle over the allocation is caught',
      caught: verdict(ALLOCATION + 1).over,
    },
    { what: 'a disc exactly at the allocation is not', caught: !verdict(ALLOCATION).over },
    {
      // The allocation is the coordinator's number, and this is the assertion
      // that would catch it being edited to let a measurement through -- which
      // is the one thing E-V1b forbids doing to this file.
      what: 'the allocation is still the 60 000 triangles §2.9 gives the disc',
      caught: ALLOCATION === 60000,
    },
    {
      what: 'the measurement itself still lands where the shape and the grain put it',
      caught: Math.abs(disc.triangles - AT_TODAY) <= 200,
    },
    {
      what: 'the count is of both families and not of the meadow alone',
      caught: disc.earthQuads > 0 && disc.triangles === disc.quads * 2,
    },
  ]);
}

const report = reporter('guard-fusione -- what the voxel disc costs, offline, in triangles');

const disc = meshDisc(null, true, SHIPPED_RADIUS);
const seen = verdict(disc.triangles);

report.line(`  ${disc.chunks.length} chunks, ${disc.columns} columns, `
  + `at the ${SHIPPED_RADIUS} m the tiers lay`);
report.line(`  triangles               ${disc.triangles}`
  + `   (${disc.quads} quads, of which ${disc.earthQuads} are the bare earth`
  + ` and ${disc.pavingQuads} the paving)`);
report.line(`  quads per column        ${disc.quadsPerColumn.toFixed(4)}`
  + '   (printed and not gated: E-V1b retired it as a threshold)');
report.line(`  with the rim taken out  ${disc.insidePerColumn.toFixed(4)}`
  + `   (${disc.rim} of the walls exist because something ends there)`);

report.check(!seen.over,
  `the disc stands inside its allocation of ${ALLOCATION} triangles`,
  `${disc.triangles} against ${ALLOCATION}`);

const drift = disc.triangles - AT_TODAY;
if (Math.abs(drift) > 200) {
  report.note(`the disc has moved ${drift > 0 ? '+' : ''}${drift} triangles from the `
    + `${AT_TODAY} this file says ships -- ${drift > 0 ? 'declare it before it is found'
      : 'a bill that fell, and the yardstick here is behind it'}, owner ${OWNER}`);
} else {
  report.line(`  against what this file says ships (${AT_TODAY}): `
    + `${drift >= 0 ? '+' : ''}${drift} triangles`);
}

// AND THE ROW THE ALLOCATION WAS WRITTEN FOR, SO THAT NOBODY READS THE GREEN
// ABOVE AS A STATEMENT ABOUT IT. §2.9 names the disc at r = 35 and the tiers
// lay twelve to fourteen: the allocation and the world have never been the same
// disc, and the gap is arithmetic rather than an opinion.
const wide = meshDisc(null, true, ALLOCATION_RADIUS);
report.line('');
report.line(`  the same disc at the ${ALLOCATION_RADIUS} m §2.9's row names: `
  + `${wide.triangles} triangles over ${wide.columns} columns, `
  + `${(wide.triangles / ALLOCATION).toFixed(2)}x the allocation`);
report.note(`the allocation of §2.9 is written at r = ${ALLOCATION_RADIUS} m and no tier `
  + `lays more than ${SHIPPED_RADIUS} m: the gate above is on the disc that ships, and `
  + 'the row and the world have never been the same disc. The row is the coordinator\'s');

report.end();
