import { meshDisc } from '../../src/world/voxel/pure.js';
import { reporter, selfTest } from './lib.mjs';

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
//   0.55  DISQUALIFICATION. Above this the budget for geometry is nought by
//         arithmetic and nothing further needs measuring. This is a wall.
//   0.45  THE TARGET. Between the two the world still runs and the pivot still
//         stands; what is true is that a promise has not been kept yet. So the
//         number is PRINTED with the owner beside it and the guard exits green.
//
// A single threshold would have had to be one or the other, and both readings
// are wrong: at 0.55 the guard says nothing about a disc drifting towards the
// wall, and at 0.45 it is red from the day it is written -- which is how a guard
// stops being read at all.
//
// The lever on the remaining gap is named rather than left to be rediscovered:
// the two-dimensional merge of the flanks, which the mesher deliberately does
// not do (see src/world/voxel/mesher.js). Its headroom is not quantified, and
// quantifying it is V1's, not this guard's.

/** D1. */
const DISQUALIFY = 0.55;
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
    { what: 'a disc at 0.60 q/col is disqualified', caught: verdict(0.60).disqualified },
    { what: 'a disc at 0.5500001 q/col is disqualified', caught: verdict(0.5500001).disqualified },
    {
      what: 'a disc at 0.50 q/col passes but is declared short of the target',
      caught: !verdict(0.50).disqualified && verdict(0.50).missed,
    },
    {
      what: 'a disc at 0.44 q/col passes with nothing to declare',
      caught: !verdict(0.44).disqualified && !verdict(0.44).missed,
    },
    {
      what: 'the measurement itself still lands where the bench put it',
      caught: Math.abs(meshDisc(null, true).quadsPerColumn - 0.5359646284913189) < 1e-12,
    },
  ]);
}

const report = reporter('guard-fusione -- quads per column on the real field, offline');

const disc = meshDisc(null, true);
const seen = verdict(disc.quadsPerColumn);

report.line(`  ${disc.chunks.length} chunks, ${disc.quads} quads over ${disc.columns} columns`);
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
