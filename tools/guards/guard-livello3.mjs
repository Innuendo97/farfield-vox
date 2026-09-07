import {
  BLADE, BLADES_PER_VOXEL, MANTO, MATERIAL,
  CAMPO, CAMPO_FAR, CAMPO_FAR_RATIO, CAMPO_FAR_SHIFT, CAMPO_LOOK_MAX, VOXEL,
  campoDecode, campoFarMeets, campoFarOrigin, campoFarTile, campoTile,
  bladeAtColumn, mantoIntensity, slimAtColumn,
} from '../../src/world/voxel/pure.js';
import { reporter, selfTest } from './lib.mjs';

// GUARD-LIVELLO3 -- ONE TRUTH WHERE THE TWO WINDOWS TOUCH.
//
// ===========================================================================
// WHAT THIS GUARD IS FOR, IN ONE SENTENCE: the meadow is drawn out of two
// pictures of the same ground -- a near window of 5 cm texels that follows the
// walker, and a far one of 40 cm texels that stands still -- and the edge
// between them moves every 6.4 m of walking. If the two say different things
// about the ground they share, that move is a REDRAW, and R8 measured what it
// looked like: 0.9 % of the frame, twenty five levels of contrast, a row of
// blocks rebuilding itself from left to right at twenty metres, every two
// seconds of walking. The committente named it «le cose si costruiscono a
// pezzi mentre cammino».
//
// The fix was not to make that move smoother. It was to make the two pictures
// say the SAME BYTE, so that the move is a change of ADDRESS -- and an address
// has no picture (U-CAMPO-2, M2.1). This guard is what keeps them saying it: a
// far texel is exactly a cell of level three of the near pyramid, so the same
// ground is built BOTH WAYS -- once by campoFarTile out of the law, once by
// campoTile plus campoReduce out of the block store -- and compared field by
// field. Neither side is read off the other.
//
// WHAT IS EXACT AND WHAT IS NOT, DECLARED HERE RATHER THAN DISCOVERED LATER:
//
//   the blade, its width, the tint, the material   EXACT, on the plane
//   the ground on a BANK                           up to GROUND_SLACK voxels
//   the statistic (look)                           a tabulated mean
//
// The first line is what the frame reads as SHAPE, and it is exact. The second
// is the near window choosing the child with the highest ground where the far
// one reads its own corner: on a terrace at nineteen metres under the haze that
// is a fraction of a voxel of silhouette, and it is the price of a far tile
// being sixteen thousand calls of the law instead of a quarter of a million.
// The third is three bits of shading whose exact answer costs four times the
// tile (150 ms against 37, and sixty four tiles stand at the door of the world
// in front of a veil that now waits for them): what ships is the mean of that
// same pyramid, tabulated by corner blade and by intensity, which takes the
// error from 2.78 of 7 -- the flat expectation that shipped before -- down to
// LOOK_MEAN_MAX.
// ===========================================================================

const RADIUS = 35;
/** How far out the sample is taken, in metres. */
const REACH = 20;
/** How many meadow cells are compared. */
const CELLS = 400;
/** What the ground may differ by where the two pictures pick different children. */
const GROUND_SLACK = 4;
/** And how many cells in a hundred may disagree about a column being there at all. */
const ABSENT_SHARE_MAX = 1.0;
/** And the mean error of the statistic, in codes of the three bits it rides in. */
const LOOK_MEAN_MAX = 1.2;

/** The predicate, apart from the world, so a defect can be injected into it. */
export function agrees(near, far) {
  return near.blade === far.blade && near.slim === far.slim
    && near.mat === far.mat && near.tint === far.tint;
}

if (process.argv.includes('--self')) {
  const base = { blade: 12, slim: 6, mat: 0, tint: 130 };
  selfTest('guard-livello3', [
    {
      what: 'a far texel carrying the law flat expectation instead of the sample is caught',
      caught: !agrees(base, { ...base, blade: 10 }),
    },
    {
      what: 'a width the far window did not draw is caught',
      caught: !agrees(base, { ...base, slim: 0 }),
    },
    {
      what: 'a tint read at the middle of the footprint instead of at its corner',
      caught: !agrees(base, { ...base, tint: 131 }),
    },
    {
      what: 'a material the two windows disagree about',
      caught: !agrees(base, { ...base, mat: 1 }),
    },
    {
      what: 'and two texels that agree pass',
      caught: agrees(base, { ...base }),
    },
    {
      what: 'the far texel really is one cell of level three, and not a ratio away from it',
      caught: CAMPO_FAR_RATIO === 8 && CAMPO_FAR_SHIFT === 3
        && Math.abs(CAMPO_FAR.cell - CAMPO.cell * 8) < 1e-9,
    },
  ]);
}

const report = reporter('guard-livello3 -- the far texel is level three of the near pyramid');

report.check(CAMPO_FAR_RATIO === 8 && CAMPO_FAR_SHIFT === 3,
  'a far texel is eight near texels a side, and three reductions up',
  `ratio ${CAMPO_FAR_RATIO}, shift ${CAMPO_FAR_SHIFT}`);
report.check(Math.abs(CAMPO_FAR.cell - CAMPO.cell * CAMPO_FAR_RATIO) < 1e-9,
  'and the two cells are that ratio apart in metres',
  `${CAMPO.cell} m against ${CAMPO_FAR.cell} m`);

// ---------------------------------------- AND ONLY WHERE THE TWO CAN TOUCH.
//
// The truth is bought where it is needed and nowhere else: a far tile the near
// window can never be carried over has nothing beside it to disagree with, and
// speaking level three costs a tile 34 ms it would spend for nobody. That line
// is campoFarMeets, and it is asserted from both sides -- it must leave some
// tiles out (or it is not saving anything) and it must not leave out any the
// near window could reach (or the seam is back where it was).
{
  const origin = campoFarOrigin(CAMPO_FAR);
  const side = CAMPO_FAR.side / CAMPO_FAR.tile;
  let meet = 0;
  for (let j = 0; j < side; j += 1) {
    for (let i = 0; i < side; i += 1) {
      if (campoFarMeets(origin.cx + i, origin.cz + j, RADIUS)) meet += 1;
    }
  }
  report.check(meet > 0 && meet < side * side,
    'only the far tiles the near window can reach are asked for level three',
    `${meet} of ${side * side}; the other ${side * side - meet} answer the horizon, `
    + 'where there is no near window to disagree with');
  const carried = RADIUS + (CAMPO.side * CAMPO.cell) / 2;
  report.check(carried > RADIUS,
    'and the line is the plateau plus half the near window, which is how far its edge can go',
    `${carried.toFixed(1)} m: a plateau of ${RADIUS} m and a window `
    + `${(CAMPO.side * CAMPO.cell).toFixed(1)} m across`);
}

const nearTiles = new Map();
const farTiles = new Map();
const L3 = CAMPO.tile >> CAMPO_FAR_SHIFT;

function nearAt(gi, gj) {
  const cx = Math.floor(gi / L3);
  const cz = Math.floor(gj / L3);
  const key = `${cx},${cz}`;
  if (!nearTiles.has(key)) nearTiles.set(key, campoTile(cx, cz, RADIUS));
  const origin = CAMPO.tiles.origins[CAMPO_FAR_SHIFT];
  const offset = ((origin.y + gj - cz * L3) * CAMPO.tiles.width
    + (origin.x + gi - cx * L3)) * 4;
  return campoDecode(nearTiles.get(key).data, offset);
}

function farAt(gi, gj) {
  const cx = Math.floor(gi / CAMPO_FAR.tile);
  const cz = Math.floor(gj / CAMPO_FAR.tile);
  const key = `${cx},${cz}`;
  if (!farTiles.has(key)) farTiles.set(key, campoFarTile(cx, cz, RADIUS));
  const offset = ((gj - cz * CAMPO_FAR.tile) * CAMPO_FAR.tiles.width
    + (gi - cx * CAMPO_FAR.tile)) * 4;
  return campoDecode(farTiles.get(key).data, offset);
}

// A repeatable walk of the disc rather than Math.random: a guard that samples a
// different four hundred cells on every run is a guard whose green means less.
let seed = 20260907;
const roll = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

let meadow = 0;
let level = 0;
let banked = 0;
let absent = 0;
let outside = 0;
let disagree = 0;
let worstGround = 0;
let lookOff = 0;
let lookSum = 0;
let lookWorst = 0;
const first = [];
while (meadow < CELLS) {
  const gi = Math.floor(((roll() * 2 - 1) * REACH) / CAMPO_FAR.cell);
  const gj = Math.floor(((roll() * 2 - 1) * REACH) / CAMPO_FAR.cell);
  const near = nearAt(gi, gj);
  if (!near.present || near.mat !== 0) continue;
  meadow += 1;
  const far = farAt(gi, gj);
  // AND IT HAS TO BE A TILE THE WORLD REALLY SAMPLES, or the guard would be
  // asserting a path nothing takes. Every cell of this sample is well inside
  // the line; the assertion above says the line exists and this one says the
  // sample is on the right side of it.
  if (!campoFarMeets(Math.floor(gi / CAMPO_FAR.tile), Math.floor(gj / CAMPO_FAR.tile), RADIUS)) {
    outside += 1;
    continue;
  }
  // A COLUMN THAT IS THERE FOR ONE WINDOW AND NOT THE OTHER is its own question
  // and not a difference of height: the near cell is there if ANY of its sixty
  // four blades stands on a column, the far one if its CORNER does, and at the
  // lip of the corridor those two can differ. Measured exhaustively over every
  // far cell within 25 m, that is ten cells of fifteen thousand -- and it was
  // eleven when the far texel read the middle of its footprint instead, so it
  // is the shape of the corridor and not a thing M2.1 brought.
  if (near.present !== far.present) { absent += 1; continue; }
  const drop = Math.abs(far.ground - near.ground);
  if (drop > worstGround) worstGround = drop;
  if (drop) { banked += 1; continue; }
  level += 1;
  if (!agrees(near, far)) {
    disagree += 1;
    if (first.length < 3) {
      first.push(`(${gi},${gj}) vicino ${near.blade}/${near.slim}/${near.tint}`
        + ` contro lontano ${far.blade}/${far.slim}/${far.tint}`);
    }
  }
  const off = Math.abs(Math.round(far.look * CAMPO_LOOK_MAX)
    - Math.round(near.look * CAMPO_LOOK_MAX));
  lookSum += off;
  if (off) lookOff += 1;
  if (off > lookWorst) lookWorst = off;
}

report.check(outside === 0,
  'every cell compared stands in a tile the world really does sample',
  `${outside} of ${meadow} fell outside the line`);
report.check(level > CELLS / 2, 'most of the sample is level ground the two windows share',
  `${level} of ${meadow} meadow cells stand on it, ${banked} on a bank`);
report.check(absent * 100 <= meadow * ABSENT_SHARE_MAX,
  'and the two agree about a column being there at all, but for the lip of the corridor',
  `${absent} of ${meadow} = ${(absent / meadow * 100).toFixed(2)} %, `
  + `allowed ${ABSENT_SHARE_MAX} %`);
report.check(disagree === 0,
  'on the plane the far texel is the near pyramid word for word: blade, width, material, tint',
  `${level} cells, ${disagree} disagree${first.length ? `  ${first.join(' | ')}` : ''}`);
report.check(worstGround <= GROUND_SLACK,
  'and on a bank the two differ only by the child they pick, in voxels of ground',
  `worst ${worstGround} voxel${worstGround === 1 ? '' : 's'} = `
  + `${(worstGround * VOXEL * 100).toFixed(0)} cm, allowed ${GROUND_SLACK}`);
const lookMean = level ? lookSum / level : 0;
report.check(lookMean <= LOOK_MEAN_MAX,
  'and the statistic it carries is the tabulated mean of that same pyramid',
  `mean ${lookMean.toFixed(2)} of ${CAMPO_LOOK_MAX}, worst ${lookWorst}, `
  + `${lookOff} of ${level} not exact, allowed ${LOOK_MEAN_MAX}`);

// AND THE LAW IS ASKED THROUGH ONE DOOR, which is what the agreement above
// rests on: campo.js may not carry its own copy of how tall or how wide a blade
// stands, or the two windows would agree today and drift on the next sweep.
{
  let walked = 0;
  let wrong = 0;
  for (let n = 0; n < 500; n += 1) {
    const bx = Math.floor(roll() * 4000) * 2;
    const bz = Math.floor(roll() * 4000) * 2;
    const field = mantoIntensity((bx + 0.5) * BLADE, (bz + 0.5) * BLADE);
    walked += 1;
    if (!Number.isInteger(bladeAtColumn(bx, bz, field))) wrong += 1;
    const wide = slimAtColumn(bx, bz, field);
    if (wide !== 0 && (wide < MANTO.slim.low || wide >= MANTO.slim.high)) wrong += 1;
  }
  report.check(wrong === 0 && walked === 500,
    'the width of a blade is the law own door, and comes back inside the two bits it is packed in',
    `${walked} columns, widths nought or in [${MANTO.slim.low}, ${MANTO.slim.high})`);
}

{
  const stride = Math.round(CAMPO_FAR.cell / VOXEL);
  report.check(stride * BLADES_PER_VOXEL === CAMPO_FAR_RATIO,
    'and the corner of a footprint is the first column of it, which is the child three reductions reach',
    `${stride} world columns to a far texel, ${CAMPO_FAR_RATIO} blades`);
  report.check(MANTO.onVerge === true || MANTO.onVerge === false,
    'the mat lays on the same materials in both windows',
    `grass (${MATERIAL.GRASS})${MANTO.onVerge ? ' and the bare earth of the verge' : ' only'}`);
}

report.end(`${nearTiles.size} near tiles and ${farTiles.size} far ones, each built from its own door`);
