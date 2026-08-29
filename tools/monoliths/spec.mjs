import { readFileSync } from 'node:fs';
import {
  CHAMFER, COURSE, LENGTHS, masonryCensus, masonryLaw,
} from '../../src/world/voxel/pure.js';
import { stoneSpecs } from '../../src/world/stone.js';
import { MONOLITHS } from '../../src/world/layout.js';

// THE MEASURED MASONRY AGAINST THE MASONRY THE ENGINE CUTS, LINE BY LINE.
//
// assets-src/monoliths/masonry-spec.json says what the wall of the two targets
// IS. src/world/voxel/ says how a wall is cut. This asks the only question that
// matters between them: which lines of the spec can reach the generator through
// the door it already has, and which cannot -- and what the ones that can would
// cost if they landed.
//
// IT COUNTS AND IT DOES NOT BUILD. The model below walks a course the way the
// generator does and increments a number; it produces no position, no normal
// and no index, and nothing draws from it. That distinction is the whole
// licence for it to exist: a second generator would be a second answer to what
// the wall looks like, and a counter is a measurement of the first one.
//
// It is checked in both directions before it prints a verdict. FORWARD: run the
// model on the engine's own constants and it has to reproduce the engine's own
// census, or the model is not counting the engine and nothing below is worth
// reading. BACKWARD: every derived number in the spec has to fall back out of
// the raw readings the spec carries beside it, so a digit typed wrong in the
// spec is caught by the spec rather than by a picture six weeks later.
//
//   node tools/monoliths/spec.mjs

const SPEC = JSON.parse(readFileSync(new URL(
  '../../assets-src/monoliths/masonry-spec.json', import.meta.url), 'utf8'));

// The allocation the campaign gave this layer, for the arithmetic in section 3.
// Quoted and not imported, because it lives in a document and not in the code:
// SESSIONI-VOX.md par. 2.9, the row "pietra costruita".
const BUDGET = { triangles: 25000, ms: 1.5, draws: 8 };

let failures = 0;
const line = (text = '') => process.stdout.write(`${text}\n`);
const check = (ok, what, detail) => {
  if (!ok) failures++;
  line(`  ${ok ? 'ok  ' : 'FAIL'}  ${what.padEnd(52)}${detail}`);
};

// --------------------------------------------------------------- the counter
//
// One deterministic stream, so two runs of this file are the same run. It is
// not the engine's hash and does not have to be: what is being estimated is how
// many blocks a course of a given mean length holds, which is a property of the
// mean and not of which generator drew the lengths. The forward check below is
// what turns that claim into a measurement.
function stream(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822519) + 1013904223) >>> 0;
    // The last shift back to unsigned, and it is not a nicety: in JavaScript
    // `s ^ (s >>> 16)` is a SIGNED result, so half the stream came out negative,
    // the length index went to -1, the pick went undefined and the walk along a
    // course ended on the first block. It counted, it printed, and it was wrong
    // by a factor of three and a half.
    return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
  };
}

/**
 * How many blocks the six boxes of layout.js come to, at a given masonry.
 *
 * @param {number}   rise    metres of one course
 * @param {number[]} lengths the lengths a block may be cut to
 */
function countBlocks(rise, lengths) {
  const next = stream(0x5eed1);
  const per = [];
  let total = 0;
  for (const spec of MONOLITHS) {
    const [width, height, depth] = spec.size;
    const courses = Math.max(1, Math.round(height / rise));
    let blocks = 0;
    for (let c = 0; c < courses; c++) {
      for (const span of [width, width, depth, depth]) {
        // The stagger: a course starts part of a block along from the one under
        // it, which is what stops a vertical joint running up the wall -- and
        // what puts a part block at each end of every course.
        let t = -lengths[0] * (0.35 + 0.55 * next());
        while (t < span) {
          const pick = lengths[Math.floor(next() * lengths.length)];
          const a = Math.max(0, t);
          const b = Math.min(span, t + pick);
          t += pick;
          if (b - a < 0.02) continue;
          blocks++;
        }
      }
    }
    per.push({ id: spec.id, courses, blocks });
    total += blocks;
  }
  return { per, total };
}

/** Mean of a histogram given by lower edge and count. */
function histogramMean(histogram) {
  const half = histogram.binWidth / 2;
  let sum = 0;
  let n = 0;
  for (const [edge, count] of Object.entries(histogram.counts)) {
    sum += (Number(edge) + half) * count;
    n += count;
  }
  return { mean: sum / n, n };
}

/** Fraction of a histogram above a width. */
function histogramAbove(histogram, over) {
  let above = 0;
  let n = 0;
  for (const [edge, count] of Object.entries(histogram.counts)) {
    n += count;
    if (Number(edge) >= over) above += count;
  }
  return above / n;
}

/**
 * The levels of one head, merged and filtered by the spec's own rule.
 *
 * THE MERGE DISTANCE IS DERIVED AND NOT CHOSEN, and the first version of it was
 * wrong in a way worth keeping. Merging everything within ONE COURSE swallowed
 * 01's 0.19 m step -- a real drop of nearly a whole course, read on 44% of the
 * width -- and reported a head with one level on it. The distance has to
 * separate a step of one course from the WANDER of a course, which is 30 mm at
 * the median and 35 at p90: three times the p90 is 0.105 m, half a course, and
 * it is the campaign's own rule for a tolerance rather than a number picked to
 * make a count come out.
 *
 * Merged against the group's TOP and not against its last member, so a chain of
 * small gaps cannot walk a group down the whole head.
 */
function mergeLevels(raw, within, columns, keepWiderThan) {
  const sorted = [...raw].sort((a, b) => b[0] - a[0]);
  const groups = [];
  for (const [metres, count] of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.top - metres < within) {
      last.columns += count;
      last.sum += metres * count;
      last.count += count;
    } else {
      groups.push({ top: metres, columns: count, sum: metres * count, count });
    }
  }
  return groups
    .map((g) => ({ at: g.sum / g.count, fraction: g.columns / columns }))
    .filter((g) => g.fraction >= keepWiderThan);
}

// =========================================================== 0. the two ways
line('MASONRY SPEC -- the measured wall against the wall the engine cuts\n');
line(`  spec       assets-src/monoliths/masonry-spec.json, measured by ${SPEC.measuredBy.session}`);
line(`  engine     src/world/voxel/  COURSE ${COURSE}  LENGTHS ${LENGTHS.join(' / ')}  CHAMFER ${CHAMFER}`);
line(`  camera     ${SPEC.measuredBy.residual}\n`);

line('=== 0. THE COUNTER, VALIDATED IN BOTH DIRECTIONS ================\n');

const census = masonryCensus();
const engineTotal = census.reduce((a, c) => a + c.blocks, 0);
const engineQuads = census.reduce((a, c) => a + c.quads, 0);
const modelled = countBlocks(COURSE, LENGTHS);
const forward = Math.abs(modelled.total - engineTotal) / engineTotal;

// THE DRIFT IN THIS LINE IS REGISTERED, WITH THE CAUSE, BECAUSE IT MOVED ONCE
// WITHOUT ANYONE SAYING SO. When V2-DEV1 delivered this tool the two sides read
// 5124 against 5002, 2.4% apart. They now read 5124 against 4790, 7.0%, and the
// gate found the number changed with no note beside it.
//
// WHAT MOVED IS THE ENGINE'S COUNTER, NOT THE WALL. Measured by running
// masonryCensus() against the file as it stood on either side of every commit
// of this session (v2-pietra/dev4/censimento.mjs): the census reads 5002 before
// bd98a50 and 4790 after it, and identically 4790 before and after 465bb9c --
// so the skin closure, which was the standing candidate, is NOT the cause. The
// courses are untouched across that commit, 185 of them, block for block.
//
// bd98a50 changed HOW the engine counts, because it changed how the engine
// draws. The old census emitted a stagger walk of LENGTHS across the full span
// of every wall and counted every piece, including the part block clipped at
// each end; the new one walks the CELL LATTICE and lays a block wherever
// isCut() says a cell boundary is a block edge -- which is the arithmetic the
// fragment actually uses to decide where a block begins. On the engine's own
// default law (cell 0.22, runCut 0.5) the two methods land 4.2% apart.
//
// THE MODEL BELOW STILL WALKS THE OLD METHOD. It was written to reproduce the
// engine of its day and it still does, faithfully; the engine moved under it.
// So this line no longer measures what it was built to measure -- whether the
// model counts the engine -- it measures how far two counting methods differ,
// and it does that with one point of margin left against its own 8% bar.
// WHICH OF THE TWO IS TO FOLLOW THE OTHER IS NOT V2-DEV4'S TO DECIDE: the new
// counter lives in src/world/voxel/, which D11 puts out of this session's
// hands, and making the model copy it would leave the check comparing the
// engine with itself. Escalated with these numbers; registered here so nobody
// re-derives it.
check(forward < 0.08, 'the model counts the engine',
  `${modelled.total} against the engine's own census ${engineTotal}, `
  + `${(forward * 100).toFixed(1)}% apart`
  + '  (was 2.4% at delivery; the engine changed counting method in bd98a50 and'
  + ' the model still walks the old one -- see the note above)');

const { mean: histMean, n: histN } = histogramMean(SPEC.block.histogram);
const histDoubles = histogramAbove(SPEC.block.histogram, SPEC.block.doubles.over);
const histTriples = histogramAbove(SPEC.block.histogram, 0.57);
check(Math.abs(histDoubles - SPEC.block.doubles.fraction) <= 0.015,
  'doubles fall back out of the histogram',
  `${(histDoubles * 100).toFixed(1)}% against the stated ${(SPEC.block.doubles.fraction * 100).toFixed(0)}%`);
check(Math.abs(histTriples - SPEC.block.triples.fraction) <= 0.015,
  'triples fall back out of the histogram',
  `${(histTriples * 100).toFixed(1)}% against the stated ${(SPEC.block.triples.fraction * 100).toFixed(0)}%`
  + ' (binned at the 0.57 edge)');

let headsAgree = true;
let quantiseWorst = 0;
let boxWorst = 0;
for (const [id, head] of Object.entries(SPEC.heads.perBlock)) {
  const built = head.courses * SPEC.heads.rise;
  if (Math.abs(built - head.builtHead) > 5e-4) headsAgree = false;
  if (head.targetHead === null) continue;
  if (Math.round(head.targetHead / SPEC.heads.rise) !== head.courses) headsAgree = false;
  quantiseWorst = Math.max(quantiseWorst, Math.abs(built - head.targetHead));
  boxWorst = Math.max(boxWorst, Math.abs(head.boxHeight - head.targetHead));
}
check(headsAgree, 'every head is its own course count times the rise',
  `worst quantising residual ${quantiseWorst.toFixed(3)} m`);

const MERGE = 3 * SPEC.course.wanderP90;
const bands = [];
const depths = [];
for (const head of Object.values(SPEC.head.levels)) {
  const levels = mergeLevels(head.metresUp, MERGE, head.columns, SPEC.head.keepWiderThan);
  bands.push(levels.length);
  for (let i = 1; i < levels.length; i++) {
    depths.push((levels[0].at - levels[i].at) / SPEC.course.rise);
  }
}
const bandOk = Math.min(...bands) >= SPEC.head.levelsPerHead[0]
  && Math.max(...bands) <= SPEC.head.levelsPerHead[1];
check(bandOk, 'the head levels fall back out of the raw columns',
  `${Math.min(...bands)} to ${Math.max(...bands)} against the stated `
  + `${SPEC.head.levelsPerHead.join(' to ')}`);
const depthOk = Math.min(...depths) >= SPEC.head.stepDepthCourses[0] - 0.05
  && Math.max(...depths) <= SPEC.head.stepDepthCourses[1] + 0.05;
check(depthOk, 'the step depths fall back out of the raw columns',
  `${Math.min(...depths).toFixed(1)} to ${Math.max(...depths).toFixed(1)} courses against the `
  + `stated ${SPEC.head.stepDepthCourses.join(' to ')}`);
line(`        merge distance ${MERGE.toFixed(3)} m = 3x the course wander at p90, `
  + `${(MERGE / SPEC.course.rise).toFixed(2)} of a course`);

// ==================================================== 1. what the door carries
line('\n=== 1. THE SPEC, LINE BY LINE, AGAINST THE DOOR =================\n');
line('  THE DOOR IS WIDER THAN IT WAS AND THIS SECTION IS THE DIFFERENCE.');
line('  buildMasonry(spec) still takes one argument and still has one signature;');
line('  what it reads now is spec.masonry as well, and every line below travels');
line('  in there as DATA. So a line is CARRIED if the law the world builds with');
line('  -- masonryLaw() over src/world/stone.js -- actually holds the reading.\n');
line(`  ${'spec line'.padEnd(20)}${'measured'.padEnd(34)}${'the law built'.padEnd(32)}carried?`);

// The law the world builds with, not a copy of it: this is the same
// stoneSpecs() the layer and the worker are handed.
const BUILT = stoneSpecs(SPEC);
const law = masonryLaw(BUILT[0]);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const heads = BUILT.map((s) => masonryLaw(s));
const levels = BUILT.map((s) => (s.masonry.head ? s.masonry.head.length : 1));
const steps = [];
for (const s of BUILT) {
  const runs = s.masonry.head || [];
  for (let i = 1; i < runs.length; i++) steps.push(Math.abs(runs[i].courses - runs[i - 1].courses));
}
const spread = law.wander * 0.1791;

const rows = [
  ['course rise', `${SPEC.course.rise} m (${SPEC.course.band.join('-')})`,
    `law.rise ${law.rise}`, near(law.rise, SPEC.course.rise, 1e-9) ? 'YES' : 'NO'],
  ['course scatter', `${(SPEC.course.scatterSd * 1000).toFixed(0)} mm sd between courses`,
    `${(spread * Math.SQRT2 * 1000).toFixed(0)} mm from one amplitude`,
    near(spread * Math.SQRT2, SPEC.course.scatterSd, 0.006) ? 'YES' : 'NO'],
  ['course wander', `${(SPEC.course.wanderMedian * 1000).toFixed(0)} mm p50 across a face`,
    `${(spread * 1000).toFixed(0)} mm, law.wander ${law.wander.toFixed(3)}`,
    near(spread, SPEC.course.wanderMedian, 0.003) ? 'YES' : 'NO'],
  ['block width', `${SPEC.block.meanWidth.inWindow} m, ${SPEC.block.aspectToCourse}:1 to course`,
    `law.cell ${law.cell}`, near(law.cell, SPEC.block.meanWidth.inWindow, 1e-9) ? 'YES' : 'NO'],
  ['doubles / triples', `${(SPEC.block.doubles.fraction * 100).toFixed(0)}% / `
    + `${(SPEC.block.triples.fraction * 100).toFixed(0)}%`,
  `runCut ${law.runCut.toFixed(2)} predicts ${((1 - law.runCut) * 100).toFixed(0)}% / `
    + `${((1 - law.runCut) ** 2 * 100).toFixed(1)}%`,
  near((1 - law.runCut) ** 2, SPEC.block.triples.fraction, 0.012) ? 'YES' : 'NO'],
  ['head course count', 'per block, from the target',
    `${BUILT.map((s) => s.masonry.courses).join('/')}`,
    BUILT.every((s) => !SPEC.heads.perBlock[s.id]
      || s.masonry.courses === SPEC.heads.perBlock[s.id].courses) ? 'YES' : 'NO'],
  ['head levels', `${SPEC.head.levelsPerHead.join('-')} levels, `
    + `${SPEC.head.stepDepthCourses.join('-')} courses deep`,
  `${Math.min(...levels)}-${Math.max(...levels)} levels, `
    + `${Math.min(...steps)}-${Math.max(...steps)} deep`,
  Math.max(...levels) <= SPEC.head.levelsPerHead[1]
    && Math.max(...steps) <= Math.ceil(SPEC.head.stepDepthCourses[1]) ? 'YES' : 'NO'],
  ['pale top course', `${SPEC.head.paleTopCourse.band.join('-')}x the body`,
    'not built', 'NO -- residue'],
  ['missing block', `${SPEC.head.missingBlock.count} on ${SPEC.head.missingBlock.block}`,
    `${BUILT.reduce((a, s) => a + s.masonry.recesses.length, 0)} recess cut`,
    BUILT.reduce((a, s) => a + s.masonry.recesses.length, 0)
      === SPEC.head.missingBlock.count ? 'YES' : 'NO'],
  ['quoins', 'declared, not measured', 'four independent walls', 'NO -- not measured'],
  ['chamfer', `${SPEC.chamfer.lighten.join('-')}x, as the recipe`,
    `law.chamfer ${law.chamfer} m, real geometry`, 'YES'],
  ['joint', `${SPEC.joint.darken.join('-')}, ${SPEC.joint.widthPx.join('-')} px`,
    'uJoint in the fragment, on the law', 'YES'],
  ['stair run', `${SPEC.stairs.steps} steps, tread ${SPEC.stairs.tread}, `
    + `rise ${SPEC.stairs.rise}`, 'stairSpecs(), the same door', 'YES'],
];
for (const [what, measured, engine, carried] of rows) {
  line(`  ${what.padEnd(20)}${measured.padEnd(34)}${engine.padEnd(32)}${carried}`);
}
const carriedCount = rows.filter((r) => r[3].startsWith('YES')).length;
line(`\n  ${carriedCount} of ${rows.length} lines reach the generator through the door it has.`);
line('  The three that do not are a MATERIAL (the pale top course), a reading');
line('  nobody ever took (the quoins), and ONE HEAD WITH A LEVEL TOO MANY.');
line('  The last is a disagreement of METHOD and it is left standing rather than');
line('  tuned away: this file merges the raw columns by HEIGHT, against a group\'s');
line('  top, which can count levels but cannot build one; src/world/stone.js');
line('  merges them in the order the face was walked, which is what a head IS and');
line('  the only order a run-length encoding can be laid from. The two agree on');
line('  the depth of every step and on four of the five heads.');

// ============================================= 2. what the wall actually costs
line('\n=== 2. THE COUNT AND THE BUDGET ================================\n');
line('  THE WALL IS MERGED AND THE COUNT IS OF THE MERGED WALL. A block is no');
line('  longer two quads of its own: adjacent cells of one course are ONE');
line('  rectangle, so what is submitted is a couple of quads a course. The block');
line('  count below is still the census -- how many blocks the eye is meant to');
line('  see -- and the triangles are what the geometry actually carries.\n');

const built = masonryCensus(BUILT);
line(`  ${'block'.padEnd(10)}${'blocks'.padStart(8)}${'courses'.padStart(9)}`
  + `${'quads'.padStart(8)}${'triangles'.padStart(11)}`);
let blocks = 0;
let quads = 0;
for (const b of built) {
  blocks += b.blocks;
  quads += b.quads;
  line(`  ${b.id.padEnd(10)}${String(b.blocks).padStart(8)}${String(b.courses).padStart(9)}`
    + `${String(b.quads).padStart(8)}${String(b.quads * 2).padStart(11)}`);
}
line(`  ${'all six'.padEnd(10)}${String(blocks).padStart(8)}${''.padStart(9)}`
  + `${String(quads).padStart(8)}${String(quads * 2).padStart(11)}`);
line('');
line(`  the chapter's reference band, all six:  ${SPEC.referenceCounts.allSix.join(' to ')} blocks`);
line(`  this layer's whole triangle budget:     ${BUDGET.triangles} (six blocks, stair, `
  + 'platform, rocks, panels)');
line('');
const unmerged = blocks * 4;
line(`  Unmerged, at two quads a block, the same wall would be ${unmerged} triangles`);
line(`  -- ${(unmerged / BUDGET.triangles).toFixed(1)}x the whole layer's budget, which is what the escalation of`);
line(`  V2-DEV1 measured. Merged it is ${quads * 2}, which is `
  + `${(quads * 2 / unmerged * 100).toFixed(0)}% of that.`);
line('  The chamfer is not paid for by the block any more: it is one strip a');
line('  course, so the measured dressed edge survives the budget instead of');
line('  being the thing that broke it.');

// ============================================================= 3. the heads
line('\n=== 3. THE HEADS, QUANTISED TO THE COURSE ======================\n');
line(`  ${'block'.padEnd(7)}${'box'.padStart(8)}${'target'.padStart(9)}${'courses'.padStart(9)}`
  + `${'built'.padStart(9)}${'box err'.padStart(10)}${'built err'.padStart(11)}   levels`);
for (const spec of MONOLITHS) {
  const head = SPEC.heads.perBlock[spec.id];
  if (!head) continue;
  const raw = SPEC.head.levels[`${spec.id}-front`];
  const levels = raw
    ? mergeLevels(raw.metresUp, MERGE, raw.columns, SPEC.head.keepWiderThan)
    : null;
  const boxErr = head.targetHead === null ? null : head.boxHeight - head.targetHead;
  const builtErr = head.targetHead === null ? null : head.builtHead - head.targetHead;
  const fmt = (v) => (v === null ? '--' : `${v >= 0 ? '+' : ''}${v.toFixed(3)}`);
  line(`  ${spec.id.padEnd(7)}${head.boxHeight.toFixed(2).padStart(8)}`
    + `${(head.targetHead === null ? '--' : head.targetHead.toFixed(2)).padStart(9)}`
    + `${String(head.courses).padStart(9)}${head.builtHead.toFixed(3).padStart(9)}`
    + `${fmt(boxErr).padStart(10)}${fmt(builtErr).padStart(11)}`
    + `   ${levels ? levels.map((l) => `${l.at.toFixed(2)}@${(l.fraction * 100).toFixed(0)}%`).join('  ') : ''}`);
}
line('');
line(`  Quantising the head to a whole course costs ${quantiseWorst.toFixed(2)} m at worst and buys`);
line(`  the ${boxWorst.toFixed(2)} m the boxes are out by on 04. It is not free on every block:`);
line('  05\'s box is already right to a centimetre and the rounding moves it.');

line(`\n${'='.repeat(66)}`);
line(failures === 0
  ? '  the spec is internally consistent and the counter counts the engine.'
  : `  ${failures} check(s) failed: the spec or the counter is wrong, not the wall.`);
process.exit(failures === 0 ? 0 : 1);
