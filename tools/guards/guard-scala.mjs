import {
  GROUND_EXPOSURE, LIGHT_SCALE, MEADOW_ALBEDO, MEADOW_FIELD, encodedLum, faceColour,
  orientationLadder, readLight, renderChain,
} from '../lighting/render-chain.mjs';
import { reporter, selfTest } from './lib.mjs';

// THE ORIENTATION LADDER, READ WHERE THE ORIENTATIONS ARE KNOWN.
//
// WHY THAT QUALIFICATION IS THE WHOLE GUARD. The ladder was being read off a
// window of meadow by clustering the region means into three families. A meadow
// does not have three populations: it has cube tops, two lit flanks and a
// scatter of white flowers, and three centres asked to hold four put the error
// wherever it fits. Measured on the target, that is not a small effect -- the
// MIDDLE rung moves by 0.11 between two windows of the same meadow while the
// bottom rung moves by 0.02. A gate on the middle rung would have been a gate on
// which window somebody cropped.
//
// So the ladder this guard reads is not clustered at all. Every rung IS a
// normal: the top face, the west flank, the south flank, each carried through
// the light seat, the meadow's own pigment, AgX and the delivered grade cube by
// tools/lighting/render-chain.mjs. Nothing is guessed, and it runs under plain
// node, which is why it can be asked at every commit instead of at every
// screenshot. The bench at the fitted camera answers the same question and needs
// a browser to do it; that reading belongs to the session gates.
//
// THE TOLERANCE IS THE ESTIMATOR'S OWN NULL, TIMES THREE. Between the two halves
// of a single window of target meadow the bottom rung moves by 0.019 -- that is
// what this estimator cannot tell apart, measured rather than assumed. Three
// times it is 0.057, and a gate tighter than three times its own instrument's
// null is a gate on noise.
//
// AND THE MIDDLE RUNG IS PRINTED, NEVER GATED. It is the witness: against the
// target's rocks, where the orientations ARE known because a grey cube's three
// faces can be identified, this render's middle rung lands within 0.003. Against
// the clustered meadow windows it appears to miss by a quarter. Both numbers are
// printed side by side every run, because that pair IS the evidence for reading
// the ladder this way and it should stay visible rather than becoming folklore.

// The estimator's null on the bottom rung, between two halves of one window.
const NULL_BOTTOM = 0.019;
const TOLERANCE = 3 * NULL_BOTTOM;

// What the day target reads. Two independent windows of open, level meadow at
// either side of the path -- the material this render is being compared with --
// and, separately, the group of grey rocks in the foreground, where the three
// faces of a cube can be told apart and no clustering is involved.
const TARGET = {
  meadow: { east: 0.360, west: 0.339, from: 'two windows of open level meadow' },
  rocks: { middle: 0.91, bottom: 0.327, from: 'the foreground rocks, orientations known' },
};
const TARGET_BOTTOM = (TARGET.meadow.east + TARGET.meadow.west) / 2;

// What the chain has to reproduce before anything it says is worth reading: the
// meadow under the light this world carried BEFORE the refit, where the render
// was measured on a live frame. An offline model of a frame that is not checked
// against a measured frame is a model of itself.
const BEFORE_THE_REFIT = {
  light: {
    elevation: 34,
    azimuth: -9.5,
    sunStrength: 0.4123,
    skyStrength: 0.0758,
    sunBeam: [1, 0.883163, 0.738496],
    skyBalance: [0.395334, 0.672855, 1],
  },
  top: [121.0, 127.4, 60.1],
  middle: 0.5470,
  bottom: 0.2237,
};

/** Whether a rung lands on the target inside the estimator's own null. */
export const lands = (rung, target, tolerance = TOLERANCE) => Math.abs(rung - target) <= tolerance;

const composite = await renderChain();

if (process.argv.includes('--self')) {
  const before = orientationLadder(composite, BEFORE_THE_REFIT.light);
  const top = composite(faceColour([0, 1, 0], BEFORE_THE_REFIT.light));
  selfTest('guard-scala', [
    {
      what: 'the chain reproduces the top face the render was measured at before the refit',
      caught: top.every((v, c) => Math.abs(v - BEFORE_THE_REFIT.top[c]) < 0.5),
    },
    {
      what: 'and the ladder it was measured at, both rungs',
      caught: Math.abs(before[1].rung - BEFORE_THE_REFIT.middle) < 5e-4
        && Math.abs(before[2].rung - BEFORE_THE_REFIT.bottom) < 5e-4,
    },
    { what: 'a bottom rung 0.06 off the target is caught', caught: !lands(TARGET_BOTTOM + 0.06, TARGET_BOTTOM) },
    { what: 'a bottom rung 0.058 off the target is caught', caught: !lands(TARGET_BOTTOM + 0.058, TARGET_BOTTOM) },
    { what: 'a bottom rung inside the null times three passes', caught: lands(TARGET_BOTTOM + 0.05, TARGET_BOTTOM) },
    {
      what: 'the tolerance is the measured null and not a round number',
      caught: Math.abs(TOLERANCE - 0.057) < 1e-9,
    },
  ]);
}

const report = reporter('guard-scala -- the orientation ladder, where the orientations are known');

const light = readLight();
report.line(`  the seat: elevation ${light.elevation}, azimuth ${light.azimuth}, `
  + `sun ${light.sunStrength}, sky ${light.skyStrength}`);
report.line(`  the material: albedo ${MEADOW_ALBEDO.join(', ')}, `
  + `exposure ${LIGHT_SCALE} (lightScale x GROUND_EXPOSURE ${GROUND_EXPOSURE})`);

const ladder = orientationLadder(composite, light);
report.line('');
for (const rung of ladder) {
  report.line(`  ${rung.name.padEnd(18)} encoded ${rung.rgb.map((v) => v.toFixed(0)).join(',').padEnd(12)}`
    + `  L ${rung.lum.toFixed(1).padStart(6)}   rung ${rung.rung.toFixed(4)}`);
}

const bottom = ladder[2].rung;
const middle = ladder[1].rung;

report.line('');
report.check(lands(bottom, TARGET_BOTTOM),
  `the bottom rung lands on the target within ${TOLERANCE.toFixed(3)} (3 x the estimator's null)`,
  `${bottom.toFixed(4)} against ${TARGET_BOTTOM.toFixed(4)} `
  + `(${TARGET.meadow.from}: ${TARGET.meadow.east} and ${TARGET.meadow.west}), `
  + `off by ${Math.abs(bottom - TARGET_BOTTOM).toFixed(4)}`);

// The same rung against the other reading of the same target, which is a check
// on the METHOD rather than on the world: two readings taken different ways
// landing in the same place is what makes either worth quoting.
report.check(lands(bottom, TARGET.rocks.bottom),
  'and on the reading taken where the target\'s own orientations are known',
  `${bottom.toFixed(4)} against ${TARGET.rocks.bottom} (${TARGET.rocks.from}), `
  + `off by ${Math.abs(bottom - TARGET.rocks.bottom).toFixed(4)}`);

// AND THE BAND THE MIDDLE OF WHICH IS BEING QUOTED. The pigment stopped being
// one triple when it became a field, so "the material" is now a DISTRIBUTION and
// the ladder is read at its median. The tone curve is not a straight line, so a
// pale column and a dark one do not compress by the same factor and the rung is
// not exactly invariant to which end of the band a column sits at. How much it
// is not is printed here rather than assumed: the two ends of the field, carried
// through the same chain. If that spread ever came to be wider than the
// estimator's own null, reading the ladder at one column would stop being an
// honest summary of the meadow -- and this is the line that would say so.
report.line('');
report.line('  WITNESS, not gated -- the field is a band and this is the middle of it:');
for (const [name, tint] of [['the darkest twentieth', MEADOW_FIELD.p05],
  ['the median column ', MEADOW_FIELD.p50], ['the palest twentieth', MEADOW_FIELD.p95]]) {
  const rung = orientationLadder(composite, light, MEADOW_ALBEDO.map((c) => c * tint / MEADOW_FIELD.p50));
  report.line(`    ${name}  tint ${tint.toFixed(4)}   top ${rung[0].rgb.map((v) => v.toFixed(0)).join(',').padEnd(12)}`
    + `  bottom rung ${rung[2].rung.toFixed(4)}`);
}
report.line(`    the band's spread on the bottom rung is `
  + `${(() => {
    const at = (t) => orientationLadder(composite, light,
      MEADOW_ALBEDO.map((c) => c * t / MEADOW_FIELD.p50))[2].rung;
    return Math.abs(at(MEADOW_FIELD.p95) - at(MEADOW_FIELD.p05)).toFixed(4);
  })()}, against an estimator null of ${NULL_BOTTOM}`);

report.line('');
report.line(`  WITNESS, not gated -- the middle rung ${middle.toFixed(4)}:`);
report.line(`    against the rocks, orientations known      ${TARGET.rocks.middle}`
  + `    off by ${Math.abs(middle - TARGET.rocks.middle).toFixed(3)}`);
report.line('    against the clustered meadow windows       0.590 and 0.700'
  + `    off by ${Math.abs(middle - 0.59).toFixed(3)} and ${Math.abs(middle - 0.70).toFixed(3)}`);
report.line('    a meadow shows four populations to three centres, so this rung says more');
report.line('    about the clustering than about the light. It is why the gate is the bottom one.');

report.end(`top face encoded ${ladder[0].rgb.map((v) => v.toFixed(0)).join(',')}, `
  + `luminance ${encodedLum(ladder[0].rgb).toFixed(1)}`);
