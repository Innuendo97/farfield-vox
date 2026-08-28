import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/framing.mjs';

// THE CYAN, AND THE SEVEN PER CENT IT LIVES ON.
//
// Five groups of this world glow: the engraving on the blocks, the rhombus
// marker, the ring at the foot of the 05, the strip under each stair nosing and
// the panels. All five are written into the HDR buffer in linear light BEFORE
// any of the post chain, and not one of them samples a light map. So a change
// made to the SCENE — a re-bake, a new sky, another way of storing the light —
// cannot reach them, and this asserts that rather than assuming it.
//
// What CAN reach them is the composite: the bloom prefilter, the tone curve,
// the grade. The engraving at rest sits at 0.772 against a bloom threshold of
// 0.72 — seven per cent — and src/world/monoliths.js says so out loud in two
// places, because past that boundary the curve rolls the channels together and
// the reference's blue outline comes out white.
//
// So this reads the constants out of the sources that own them and reports every
// group against the threshold with its margin. Read rather than restated, for
// the reason tools/lighting/sun.mjs exists: a copy of a number is a number that
// drifts.
//
// VALIDATION, per the amended protocol — it has to find the known defect and be
// quiet when the defect is absent:
//
//   node tools/grade/check-cyan.mjs                    quiet, EXIT 0
//   node tools/grade/check-cyan.mjs --pretend-ink 0.70 finds it, EXIT 1
//   node tools/grade/check-cyan.mjs --pretend-threshold 0.80   finds it, EXIT 1

/** A number out of the file that owns it, never restated here. */
function constant(file, pattern, what) {
  const source = readFileSync(join(REPO_ROOT, file), 'utf8');
  const found = pattern.exec(source);
  if (!found) throw new Error(`${what} not found in ${file}`);
  return Number(found[1]);
}

function vector(file, pattern, what) {
  const source = readFileSync(join(REPO_ROOT, file), 'utf8');
  const found = pattern.exec(source);
  if (!found) throw new Error(`${what} not found in ${file}`);
  return [1, 2, 3].map((i) => Number(found[i]));
}

const override = (flag, value) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? Number(process.argv[at + 1]) : value;
};

const INK_GAIN = override('--pretend-ink',
  constant('src/world/monoliths.js', /const INK_GAIN = ([0-9.]+);/, 'INK_GAIN'));
const FOCUS_INK = constant('src/world/monoliths.js', /const FOCUS_INK = ([0-9.]+);/, 'FOCUS_INK');
const MARKER_GAIN = constant('src/world/monoliths.js', /const MARKER_GAIN = ([0-9.]+);/, 'MARKER_GAIN');
const STAIR_GLOW = constant('src/world/monoliths.js', /export const STAIR_GLOW = ([0-9.]+);/, 'STAIR_GLOW');
const PANEL_INK = vector('src/world/panels.js', /const INK = \[([0-9.]+), ([0-9.]+), ([0-9.]+)\]/, 'INK');
const PANEL_EDGE = vector('src/world/panels.js', /const EDGE = \[([0-9.]+), ([0-9.]+), ([0-9.]+)\]/, 'EDGE');
const THRESHOLD = override('--pretend-threshold',
  constant('src/core/post.js', /bloomThreshold: ([0-9.]+),/, 'bloomThreshold'));

// The cyan the engraving is written in, and the core of the marker: the shader
// multiplies the gain by these, so the peak channel of each group is the gain
// times the largest component.
const INK_CORE = vector('src/world/monoliths.js',
  /INK_CORE = \[([0-9.]+), ([0-9.]+), ([0-9.]+)\]/, 'INK_CORE');

const groups = [
  ['engraving at rest', INK_GAIN * Math.max(...INK_CORE), 'above'],
  ['engraving, panel at focus', INK_GAIN * (1 + FOCUS_INK) * Math.max(...INK_CORE), 'above'],
  ['panel ink, marked', Math.max(...PANEL_INK) * 1.7, 'above'],
  ['panel edge', Math.max(...PANEL_EDGE), 'above'],
  ['rhombus core, crest', MARKER_GAIN * 1.45, 'above'],
  ['rhombus core, trough', MARKER_GAIN * 0.835, 'below'],
  ['stair under-glow, at focus', STAIR_GLOW * 1.64, 'below'],
  ['stair under-glow, at rest', STAIR_GLOW * 0.913, 'below'],
];

process.stdout.write('THE FIVE EMISSIVE GROUPS, IN LINEAR LIGHT, AGAINST THE BLOOM THRESHOLD\n');
process.stdout.write(`  threshold ${THRESHOLD.toFixed(3)}  (src/core/post.js bloomThreshold)\n`);
process.stdout.write(`  INK_GAIN ${INK_GAIN.toFixed(3)}  MARKER_GAIN ${MARKER_GAIN.toFixed(3)}`
  + `  STAIR_GLOW ${STAIR_GLOW.toFixed(3)}  (src/world/monoliths.js)\n\n`);
process.stdout.write(`  ${'group'.padEnd(28)}${'peak'.padStart(8)}${'margin'.padStart(10)}   wanted\n`);

const complaints = [];
for (const [name, peak, wanted] of groups) {
  const margin = (peak - THRESHOLD) / THRESHOLD;
  const is = peak >= THRESHOLD ? 'above' : 'below';
  process.stdout.write(`  ${name.padEnd(28)}${peak.toFixed(3).padStart(8)}`
    + `${`${(margin * 100).toFixed(1)}%`.padStart(10)}   ${wanted}`
    + `${is === wanted ? '' : `  <-- it is ${is}`}\n`);
  if (is !== wanted) complaints.push(`${name} is ${is} the threshold and has to be ${wanted}`);
}

// The one that is nearly on the line, named on its own because it is the number
// every change to the curve has to be checked against.
const inkMargin = (INK_GAIN * Math.max(...INK_CORE) - THRESHOLD) / THRESHOLD;
process.stdout.write(`\n  the engraving at rest clears the threshold by ${(inkMargin * 100).toFixed(1)}%.\n`);
if (inkMargin < 0.03) {
  complaints.push(`the engraving's margin is down to ${(inkMargin * 100).toFixed(1)}%`);
}

if (complaints.length) {
  process.stdout.write('\nFAILED\n');
  for (const c of complaints) process.stdout.write(`  ${c}\n`);
  process.exit(1);
}
process.stdout.write('\nevery emissive group is on the side of the threshold it was fitted for.\n');
