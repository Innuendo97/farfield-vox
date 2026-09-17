import {
  GAP, INK_CLEAR, INK_REACH, INK_STANDOFF, INK_THICKNESS, STAND,
} from '../../src/world/voxel/pure.js';
import { cameraSolids } from '../../src/world/contracts.js';
// THE THREE SHARES ARE IMPORTED AND NOT READ OUT OF THE SOURCE WITH A REGULAR
// EXPRESSION, which is E-GUARDIA4's own rule: cure at the VALUE where a value
// can be reached. src/world/engraving.js does import three, and three imports
// under plain node -- tools/guards/lib/popolazioni.mjs has been loading this
// world's meshes that way all along. What is still read as TEXT below is
// SHAPE and not a number: whether the mesher cuts flanks in four directions at
// all, which is not a value anybody can import.
import { INK_FACE } from '../../src/world/engraving.js';
import { MONOLITHS } from '../../src/world/layout.js';
import { read, reporter, selfTest } from './lib.mjs';

// WHETHER THE WRITING ON THE SIX CAN BE READ, AND WHETHER A JOINT CAN STILL CUT IT.
//
//   node tools/guards/guard-inchiostro.mjs
//   node tools/guards/guard-inchiostro.mjs --self
//   node tools/guards/guard-inchiostro.mjs --plate <posa-P.png> [--sei <06-a-3.5m.png>]
//
// WHAT IT IS FOR. The committente sent the delivered hub back with one
// sentence: «il testo e i simboli dei monoliti soffrono le linee scure dove i
// cubi si separano, e questo rende complicata la lettura». The writing was an
// engraving PROJECTED onto the stone in metres, which was right while a course
// of that wall was one flat rectangle and became wrong the day the wall was
// laid as boxes: a projection lands on a block's reveals and soffits as
// happily as on its front, so every upright joint and every course line ran
// straight through a glyph. The answer (E-DECISIONI24) is that the letters are
// BODIES standing clear of the wall.
//
// AND THAT IS WHY MOST OF THIS GUARD NEEDS NO PICTURE. «Nessun giunto taglia un
// glifo» is not a threshold to be tuned, it is a CLEARANCE to be proved: a
// block may stand two steps out of its wall, the letters stand further out than
// that, and the two cannot meet. That is arithmetic and it is checked at every
// commit, under plain node, off the same constants the generator and the camera
// read. What needs a picture is the other half of the complaint -- «rende
// complicata la lettura» -- and legibility is a contrast, measured on the
// render and on the target through one estimator
// (tools/monoliths/inchiostro.mjs) at the pose the target was drawn at.
//
// WHY IT IS NOT A LEG OF guard-pietra. That guard derives the stone's COLOURS
// through the delivered chain and never opens a picture; this one is about
// where a thing STANDS and how it reads against what is behind it. They went
// wrong independently: on the day the committente could not read the writing,
// guard-pietra's ink legs were green -- and they were right to be, because the
// ink's triple had not moved. It was the wall under it that had.

const COURSES_SOURCE = read('src/world/voxel/courses.js');
const MASONRY_SOURCE = read('src/world/voxel/masonry.js');
const ENGRAVING_SOURCE = read('src/world/engraving.js');
const CONTRACTS_SOURCE = read('src/world/contracts.js');

const args = process.argv.slice(2);
const plate = args.includes('--plate') ? args[args.indexOf('--plate') + 1] : null;
const sei = args.includes('--sei') ? args[args.indexOf('--sei') + 1] : null;

// THE TARGET'S OWN READING, MEASURED AND WRITTEN DOWN.
//
// tools/monoliths/inchiostro.mjs on farfield-day-voxel-target.png, 2026-09-17,
// the five fronts the reference framing shows. The target is never carried into
// this repository (the rule tools/monoliths/relief.mjs states), so what is
// versioned is the reading.
//
// IT BELONGS IN assets-src/monoliths/masonry-spec.json AND IS NOT THERE YET,
// which is declared rather than hidden: U-PIETRA-4 is refitting `relief` in
// that same file in a parallel worktree at this moment, and a second unit
// adding a key to it would be a merge conflict over a measurement neither of
// them disputes. Residue, with its owner: whoever integrates the two.
const TARGET = {
  '01-front': { contrast: 0.475, core: 0.603, halo1: 0.307, bites: 0.278 },
  '02-front': { contrast: 0.426, core: 0.578, halo1: 0.326, bites: 0.249 },
  '03-front': { contrast: 0.431, core: 0.584, halo1: 0.345, bites: 0.286 },
  '04-front': { contrast: 0.347, core: 0.486, halo1: 0.352, bites: 0.194 },
  '05-front': { contrast: 0.254, core: 0.428, halo1: 0.482, bites: 0.202 },
};

const BAND = {
  // How far under the target's own edge contrast a face may read. The
  // mandate's number, on the mandate's own reading -- «il contrasto locale dei
  // glifi (Michelson sul bordo del glifo contro la parete)», which is the
  // stroke's EDGE against the stone. The estimator also hands back the same
  // Michelson taken at the stroke's FACE, and that one is reported and not
  // gated: what the brightest pixel of a stroke comes to is set by the 32-cube
  // grade downstream of everything this unit owns, and E-PIETRA2 escalated it
  // with its numbers. Gating a unit on a number whose owner is another unit is
  // how a chapter stalls.
  contrastShare: 0.90,
  // And how much clear of the proudest block a letter has to stand, in metres.
  // Not nought: two surfaces that meet exactly are a line of depth-buffer
  // argument, and on a wall that argument is a pixel of stone through a letter.
  clear: 0.004,
  // What counts as «qualche centimetro» for the thickness of a letter and for
  // how far it stands off, in metres. A floor and a ceiling on both, because
  // the mandate asks for a few centimetres of each and a letter half a metre
  // off its wall is a sign hanging in front of a monolith.
  thickness: [0.015, 0.060],
  standoff: [0.040, 0.150],
  // On the sixth block at three and a half metres -- the committente's own
  // reading distance, and the one the defect was reported from. There is no
  // target for it: the sixth stands behind the spawn and is outside both
  // framings on purpose. So what is gated is the contrast the five fronts reach
  // at thirty metres, which the same writing at a tenth of the distance may
  // certainly not fall under.
  //
  // AND THE ONE THAT IS ACTUALLY GATED THERE IS THE BITE AND NOT THE CONTRAST,
  // because at three and a half metres a letter's FLANK is three pixels wide
  // and the edge reading charges the body for having one -- the delivered,
  // cut-about writing reads 0.171 and the cured one 0.265, which is the right
  // direction and a third of the margin the same pair shows at thirty metres.
  // What a joint leaves is a HOLE in a stroke, and a hole is what MORSI counts:
  // the delivered sixth block is at 8.0 per cent and the cured one at 3.5, so
  // six is a ceiling the defect fails and the cure clears.
  seiContrast: 0.20,
  seiBites: 0.06,
};

// ------------------------------------------------------- the named gates
//
// Each of these is ONE expression with a name, and the self test below calls
// the same function the run does. A gate the self test reimplements is a gate
// that can pass here and fail there.

/** Nothing the masonry can do reaches the plane the letters stand in. */
export function clearOfTheStone(standoff, stand) {
  return standoff - 2 * stand >= BAND.clear;
}

/** The wall draws the light the letters throw and never the letters. */
export function nothingPaintedOnTheWall(source) {
  if (/uInkCore/.test(source.replace(/\/\/[^\n]*/g, ''))) return false;
  return /colour \+= uInkHalo \* texture2D\(tInk, ink\)\.r/.test(source);
}

/** A letter has a front, four flanks and a back, and the flanks are darker. */
export function cutAsABody(face, source) {
  if (!face) return false;
  if (!(face.front === 1 && face.side < face.front * 0.4 && face.back < face.side)) return false;
  return /const runs = \[0, 1, 2, 3\]\.map\(\(dir\) => edgeRuns\(/.test(source)
    && /const faces = greedyRects\(/.test(source);
}

/** A camera can never stand between a letter and the wall behind it. */
export function cameraKeptOut(solids) {
  return MONOLITHS.every((m) => {
    const box = solids.find((s) => s.name === `monolite ${m.id}`);
    return box && box.halfDepth >= m.size[2] / 2 + INK_REACH
      && box.halfWidth >= m.size[0] / 2 + INK_REACH;
  });
}

/** And the box is grown off the one file that states the reach. */
export function boxAsksForTheReach(source) {
  return /INK_REACH/.test(source) && /Math\.max\(2 \* STAND, INK_REACH\)/.test(source);
}

/** A face reads at least nine tenths of the contrast the target reads. */
export function readsLikeTheTarget(got, want) {
  return got >= want * BAND.contrastShare;
}

// --------------------------------------------------------------- self test

if (args.includes('--self')) {
  const solids = cameraSolids();
  const shrunk = solids.map((s) => (s.name.startsWith('monolite')
    ? { ...s, halfDepth: s.halfDepth - 0.05 } : s));
  const painted = MASONRY_SOURCE
    .replace('colour += uInkHalo * texture2D(tInk, ink).r',
      'colour += mix(uInkHalo, uInkCore, q) * texture2D(tInk, ink).r');
  const flat = { front: 1.0, side: 1.0, back: 1.0 };
  const noFlanks = ENGRAVING_SOURCE.replace(
    'const runs = [0, 1, 2, 3].map((dir) => edgeRuns(',
    'const runs = [].map((dir) => edgeRuns(',
  );
  const oldBox = CONTRACTS_SOURCE.replace('Math.max(2 * STAND, INK_REACH)', '2 * STAND');

  selfTest('guard-inchiostro', [
    {
      what: 'a letter hung nearer than the proudest block can reach is caught',
      caught: !clearOfTheStone(2 * STAND, STAND),
    },
    {
      what: 'and one hung exactly on the proudest block, where the depth buffer argues',
      caught: !clearOfTheStone(2 * STAND, STAND),
    },
    {
      what: 'the delivered standoff clears it',
      caught: clearOfTheStone(INK_STANDOFF, STAND),
    },
    {
      what: 'a wall that paints the core of the stroke back onto itself is caught',
      caught: !nothingPaintedOnTheWall(painted),
    },
    {
      what: 'and the delivered wall draws the halo alone',
      caught: nothingPaintedOnTheWall(MASONRY_SOURCE),
    },
    {
      what: 'a body whose flanks burn at the core\'s level is caught -- it is a bolder letter, not a thicker one',
      caught: !cutAsABody(flat, ENGRAVING_SOURCE),
    },
    {
      what: 'a body cut with no flanks at all is caught',
      caught: !cutAsABody(INK_FACE, noFlanks),
    },
    {
      what: 'and the delivered body has a front, flanks darker than it, and a back',
      caught: cutAsABody(INK_FACE, ENGRAVING_SOURCE),
    },
    {
      what: 'a camera box that did not grow by the letters\' own reach is caught',
      caught: !cameraKeptOut(shrunk),
    },
    {
      what: 'and one that grew by the stone alone, which is shorter than the writing',
      caught: !boxAsksForTheReach(oldBox),
    },
    {
      what: 'the delivered box keeps a lens out of the gap behind a letter',
      caught: cameraKeptOut(solids) && boxAsksForTheReach(CONTRACTS_SOURCE),
    },
    {
      what: 'a face reading a fifth under the target\'s contrast is caught',
      caught: !readsLikeTheTarget(0.475 * 0.8, 0.475),
    },
    {
      what: 'and one a twentieth under is not, which is the band the mandate set',
      caught: readsLikeTheTarget(0.475 * 0.95, 0.475),
    },
    {
      what: 'a thickness of nothing is caught',
      caught: !(0 >= BAND.thickness[0]),
    },
    {
      what: 'a letter hanging half a metre off its block is caught',
      caught: !(0.5 <= BAND.standoff[1]),
    },
    {
      what: 'the delivered standoff and thickness are both a few centimetres',
      caught: INK_THICKNESS >= BAND.thickness[0] && INK_THICKNESS <= BAND.thickness[1]
        && INK_STANDOFF >= BAND.standoff[0] && INK_STANDOFF <= BAND.standoff[1],
    },
  ]);
}

const report = reporter('guard-inchiostro -- the writing as bodies, clear of the joints');

// ---------------------------------------------------------------- the clearance
report.line('');
const proud = 2 * STAND;
report.check(clearOfTheStone(INK_STANDOFF, STAND),
  'NO JOINT CAN CUT A GLYPH, and it is a clearance and not a threshold',
  `the letters stand ${(INK_STANDOFF * 1000).toFixed(0)} mm off the wall, the proudest block `
  + `reaches ${(proud * 1000).toFixed(0)} mm: ${((INK_STANDOFF - proud) * 1000).toFixed(0)} mm `
  + `clear, and the joint itself is a void ${(GAP * 1000).toFixed(0)} mm across BEHIND them`);

report.check(INK_STANDOFF >= BAND.standoff[0] && INK_STANDOFF <= BAND.standoff[1]
  && INK_THICKNESS >= BAND.thickness[0] && INK_THICKNESS <= BAND.thickness[1],
  'and both are the «qualche centimetro» the mandate asks for',
  `standoff ${(INK_STANDOFF * 100).toFixed(1)} cm (band ${BAND.standoff.map((v) => v * 100).join(' to ')}), `
  + `thickness ${(INK_THICKNESS * 100).toFixed(1)} cm (band ${BAND.thickness.map((v) => v * 100).join(' to ')})`);

report.check(/INK_STANDOFF = 2 \* STAND \+ INK_CLEAR/.test(COURSES_SOURCE),
  'the standoff is DERIVED from the wall and not chosen beside it',
  `2 x STAND + ${(INK_CLEAR * 1000).toFixed(0)} mm, so a refit of the wall carries the writing `
  + 'with it and nothing here has to be re-measured');

// --------------------------------------------------------------- the bodies
report.line('');
report.check(cutAsABody(INK_FACE, ENGRAVING_SOURCE),
  'every glyph, icon, rule and bar is cut as a SOLID: a front, four flanks and a back',
  `front at the core's own level, flanks at ${INK_FACE.side}, back at ${INK_FACE.back} -- `
  + 'the flanks are the «ombra propria» and are lit as the stone they are cut from');

report.check(nothingPaintedOnTheWall(MASONRY_SOURCE),
  'and NOTHING of the writing is painted on the stone: the wall draws the halo and the shadow',
  'src/world/voxel/masonry.js has no uInkCore left to read, and the groove died with the groove');

report.check(/uInkDepth/.test(MASONRY_SOURCE) && /uInkShade/.test(MASONRY_SOURCE),
  'the wall takes the SHADOW the bodies throw on it, walked to the plane they stand in',
  'so it moves with the sun instead of being a drop shadow at an angle somebody liked');

// --------------------------------------------------------------- the camera
report.line('');
const solids = cameraSolids();
report.check(cameraKeptOut(solids) && boxAsksForTheReach(CONTRACTS_SOURCE),
  'a camera can never stand between a letter and the wall behind it',
  `every box grown by ${(INK_REACH * 1000).toFixed(0)} mm a side -- the standoff plus the `
  + 'thickness, asked of the file that states them');

// ---------------------------------------------------------------- the plates
report.line('');
if (!plate) {
  report.note('no --plate given, so the reading against the target did not run. It is the half of '
    + 'this guard that needs a picture: tools/monoliths/inchiostro.mjs, on the render at the '
    + 'fitted pose and on the day target through one estimator. Everything above is a clearance '
    + 'and runs under plain node at every commit.');
} else {
  const { measure, readPlate, readRect } = await import('../monoliths/inchiostro.mjs');
  const got = await measure(plate);
  report.line(`  the writing on ${plate}`);
  report.line('  face          bordo  target   floor  |  faccia  target  |  alone  target  |  morsi');
  let worst = 1;
  let worstCore = 1;
  for (const [name, want] of Object.entries(TARGET)) {
    const r = got[name];
    if (!r || r.contrast === null) continue;
    const floor = want.contrast * BAND.contrastShare;
    worst = Math.min(worst, r.contrast / want.contrast);
    worstCore = Math.min(worstCore, r.coreContrast / want.core);
    report.line(`  ${name.padEnd(12)}${r.contrast.toFixed(3).padStart(7)}`
      + `${want.contrast.toFixed(3).padStart(8)}${floor.toFixed(3).padStart(8)}  |`
      + `${r.coreContrast.toFixed(3).padStart(8)}${want.core.toFixed(3).padStart(8)}  |`
      + `${r.halo[0].toFixed(3).padStart(7)}${want.halo1.toFixed(3).padStart(8)}  |`
      + `${`${(r.bites * 100).toFixed(1)}%`.padStart(7)}`
      + `${r.contrast < floor ? '   <-- under' : ''}`);
  }
  report.check(worst >= BAND.contrastShare,
    'every face reads at least nine tenths of the contrast the target reads at its own edge',
    `worst ${(worst * 100).toFixed(1)}% of the target's, band ${BAND.contrastShare * 100}%`);
  report.note('read at the stroke\'s FACE instead of its edge -- the second pair of columns -- '
    + `the same five faces stand at ${(worstCore * 100).toFixed(0)} to `
    + `${(100 * Math.max(...Object.entries(TARGET).map(([n, wnt]) => (got[n] && got[n].coreContrast ? got[n].coreContrast / wnt.core : 0)))).toFixed(0)}`
    + ' per cent of the target, against 62 to 72 for the delivered writing. That reading is NOT '
    + 'gated and the reason is its owner: what the brightest pixel of a stroke comes to is the '
    + '32-cube grade, which E-PIETRA2 measured, escalated and parked. Owner: E-LUCE / D5.');
  report.note('the halo is measured as the level one pixel out from a stroke against that '
    + 'stroke\'s own level, and the far end of the same profile -- fourteen pixels out, which is '
    + 'the STONE -- agrees with the target to within a hundredth on every face. What is compared '
    + 'above is therefore the glow and not the exposure.');

  if (sei) {
    // The sixth block at three and a half metres: the committente's own view,
    // named as a rectangle because 06 stands outside the reference framing and
    // there is no projection of it to ask.
    const near = await readPlate(sei);
    const r = readRect(near, { x0: 420, y0: 260, x1: 1180, y1: 820 });
    report.line('');
    report.check(r.bites <= BAND.seiBites && r.contrast >= BAND.seiContrast,
      'and the sixth block, at the three and a half metres the defect was reported from',
      `morsi ${(r.bites * 100).toFixed(1)}% against a ceiling of ${BAND.seiBites * 100}% `
      + `(the delivered writing is at 8.0), contrasto ${r.contrast.toFixed(3)}/`
      + `${r.coreContrast.toFixed(3)} against 0.171/0.306 delivered, `
      + `${r.pieces} pieces of ink against 53`);
  } else {
    report.note('no --sei given, so the sixth block at three and a half metres was not read. It '
      + 'is the one view the committente actually reported the defect from.');
  }
}

report.line('');
report.note('the writing is not judged for its TINT here and must not be: the core and the halo '
  + 'are E-PIETRA2\'s triples at E-PIETRA2\'s gain, unmoved, and guard-pietra derives what they '
  + 'come to through the delivered chain. What this unit moved is where the stroke STANDS, and '
  + 'the blue over red of the core is still 1.3 against the target\'s 1.9 for the reason '
  + 'E-PIETRA2 named and escalated: the 32-cube grade. Owner: E-LUCE / D5.');
report.note('a body standing off a wall is DISPLACED on that wall when the wall is seen at an '
  + 'angle, and that is not compensated for anywhere. At the fitted pose it comes to 0.9 px on '
  + '03, 2.1 on 05 and 2.6 on 01 -- the parallax of eight centimetres at seventeen to '
  + 'thirty-eight degrees off the face normal, against a camera fit whose own rms is 8.02 px. '
  + 'Hiding it would be drawing a decal again.');
report.end();
