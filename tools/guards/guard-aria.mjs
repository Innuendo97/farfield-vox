import { lineOf, read, reporter, selfTest, walk } from './lib.mjs';

// THE AIR IS FITTED, AND UNTIL NOW NOTHING WATCHED IT.
//
// Two numbers in src/core/sky.js decide how much of every distant surface in
// this world is haze instead of surface: the density of the air at the ground
// and the height over which it thins. They are read by one door in
// src/world/air.js and reach every material that stands in the same air, so a
// character changed in either moves the stone, the rocks, the meadow, the path
// and the water together — and moves them SILENTLY, because haze does not look
// like a bug. It looks like weather.
//
// WHAT THE TWO NUMBERS ARE FITTED TO, so that anyone who wants to move one can
// see what they would be giving up. Three readings of the reference at once,
// at the pose the campaign measures at:
//
//   * THE FRACTION OF AIR BY DEPTH. How much of a face is pure air rather than
//     face, measured by taking the air away and dividing. The reference carries
//     0.031 to 0.211 across the depths in this frame; at the density that used
//     to ship, the far stone read 0.45 — more than twice the far end of the
//     band, on a face that is barely thirty metres out. It now reads 0.049 to
//     0.133 over the four windows, inside the band at every one of them.
//
//   * THE LEVEL OF THE NEAR FACE, which the reference puts at 46.8 of coded
//     luminance; this world put it at 56.6 before the fit and puts it at 41.2
//     after.
//
//   * ITS CHROMA, 11.2 in the reference, 17.6 before and 12.6 after.
//
// The last two pull in OPPOSITE directions and the fitted value is where their
// errors meet, at 11.8 per cent under on level and 11.9 per cent over on chroma.
// That they cannot both be closed is measured and not conceded: the air this
// sky puts on a face is 37 coded levels darker than the reference's, so the
// amount of it that brings a face up to the right level brings up too much of
// its colour with it. Closing that is the low end of the sky ramp's, and this
// number must not be spent paying for it.
//
// WHAT THIS GUARD DOES NOT ASSERT, and deliberately: the COLOUR of the air.
// That is not a constant of this world — src/world/air.js derives it every
// frame from the light the sky is handing the ground, so that a different hour
// moves the air with the sky. A guard that pinned the colour would pin the hour.
//
// THE SEAT AND THE DOOR, BOTH, which is the shape of guard-lift and for the
// same reason. Holding the seat at the fitted pair while some material passed
// its own density through the uniform would be the seat kept and the fit lost,
// and a second density written down anywhere is a second opinion about how far
// away the far side of the world is.
//
// READ AS TEXT AND NOT IMPORTED: the modules that hold these numbers reach
// three.js and a JSON import, and a guard should not need a browser's worth of
// module graph to ask what a literal says.

const SEAT = 'src/core/sky.js';
const DOOR = 'src/world/air.js';
const SHIPPED = (path) => path.endsWith('.js') && !path.startsWith('src/dev/');

/** What the fit settled on, and what the suite is here to hold. */
export const FITTED = { density: 0.0059, scaleHeight: 42 };

// THE SECOND TERM, AND WHY THIS FILE NOW WATCHES TWO.
//
// U-LUCE-4 left the two numbers above exactly where E-LUCE2 measured them —
// four windows of the reference's own meadow inside sixty metres, and the walk
// does not move by a thousandth — and put the DISTANCE beside them, because
// R6 §2.3 caught the single grey fraction out on the reference's hills: the far
// veil there is PALER than the sky, its chroma passes through a maximum, and it
// is 0.25 on red where it is 0.62 on blue. None of the three is something one
// colour and one fraction can do at any density.
//
// So there are four more numbers, and they are watched here for the reason the
// first two are: they reach every material that stands in the same air through
// one door, and a character changed in any of them moves the stone, the rocks,
// the meadow, the path and the water together and SILENTLY, because haze does
// not look like a bug.
//
//   * THE CEILING on the low haze, 0.13. It is what that term is worth a little
//     past the last window it was fitted on, so E-LUCE2's fit is kept where it
//     was measured and stops where it stopped being measured.
//   * THE THREE BETAS, 0.001105 / 0.001904 / 0.002611, solved so that the two
//     terms TOGETHER land on the fractions R6 measured at the middle crest —
//     0.25 / 0.44 / 0.62, four hundred metres out, ten metres over the water.
//     Red and green come out on R6's own two numbers to three digits.
//   * THE TURN, 700 m, and the PALE END the colour turns into.
//
// AND THE ONE THING THE LINE ABOUT THE BETAS DOES NOT SAY, WHICH COST A UNIT ITS
// FIT. R6 §2.3's column is a RELATIVE scale: its near flank in shadow is
// 0 / 0 / 0 and its pale far hills are 1 / 1 / 1, so 0.25 / 0.44 / 0.62 is the
// fraction of the way from the near flank to the pale veil and not the fraction
// of air between the eye and the crest. This guard pins the ABSOLUTE fraction,
// which is what the shipped triple produces; it now PRINTS the relative one
// beside it, so that the two are never again read as the same number.
//
// AND IT PRINTS RATHER THAN GATES IT, deliberately. U-LUCE-6 refitted the triple
// on the relative reading — 0.001776 / 0.002521 / 0.003257 — and measured what
// it does: with the hill's pigment at zero the air alone stands OVER the
// reference on all three channels at the middle crest, which is a plane no
// palette can then reach, and the near flank the refit exists to clear takes
// more air rather than less. A guard that gated the relative number would gate
// a triple the picture rejects; a guard that hid it would let the confusion back
// in. So the number is on the report and the choice is the coordinator's. The
// reasoning, and what the near flank's floor is actually made of, is written
// over AIR_BETA in the door.
//
// AND WHAT THIS GUARD STILL DOES NOT ASSERT: the COLOUR of either end. The near
// end is the ramp itself, read at twenty degrees by the door in src/core/sky.js;
// the far end is kept as a ratio to the light the sky hands the ground. Both
// move with the hour on purpose, and a guard that pinned either would pin the
// hour. What is pinned is the SHAPE and the ARITHMETIC.
export const DISTANCE = {
  lowCap: 0.13,
  beta: [0.001105, 0.001904, 0.002611],
  turn: 700,
  pale: [0.1988, 0.603064, 1.196391],
};

const DOOR_NUMBER = (text, name) => {
  const found = new RegExp(`export const ${name} = (-?[0-9.]+);`).exec(text);
  return found ? Number(found[1]) : null;
};
const DOOR_TRIPLE = (text, name) => {
  const found = new RegExp(`export const ${name} = ..(-?[0-9.]+), (-?[0-9.]+), (-?[0-9.]+).;`)
    .exec(text);
  return found ? found.slice(1, 4).map(Number) : null;
};

/** What the door states about the distance, read as text like everything here. */
export function doorDistance(text) {
  return {
    lowCap: DOOR_NUMBER(text, 'FOG_LOW_CAP'),
    beta: DOOR_TRIPLE(text, 'AIR_BETA'),
    turn: DOOR_NUMBER(text, 'AIR_TURN_METRES'),
    pale: DOOR_TRIPLE(text, 'AIR_PALE'),
  };
}

/**
 * The two terms, walked here in the other language, so that the shape the
 * fragment computes can be asked a question about without a browser.
 *
 * Same arithmetic as FOG_GLSL: one height integral shared by both, the low haze
 * capped, the distance per channel, and the low haze applied LAST because it is
 * the air nearest the eye.
 */
export function airAt(distance, height, eyeHeight = 1.7, law = DISTANCE,
  fitted = FITTED) {
  const dy = height - eyeHeight;
  const a = Math.exp(-Math.max(eyeHeight, 0) / fitted.scaleHeight);
  const b = Math.exp(-Math.max(height, 0) / fitted.scaleHeight);
  const mean = Math.abs(dy) < 0.01 ? a : ((a - b) * fitted.scaleHeight) / dy;
  const g = Math.min(law.lowCap, 1 - Math.exp(-((distance * fitted.density * mean) ** 2)));
  return law.beta.map((beta) => {
    const f = 1 - Math.exp(-((distance * beta * mean) ** 2));
    return 1 - (1 - f) * (1 - g);
  });
}

// WHERE R6'S OWN COLUMN IS READ, so that the relative fraction is asked of two
// PLACES and not of two adjectives. The crest is the pair this file already asks
// airAt() at; the near flank is 227 m out and 21 m up, which is where R6's window
// on the near flank in shadow — its 0 / 0 / 0 — falls on the front this world
// builds (the shore at 180 m, the slope 0.54, the window at 4.84 degrees).
export const R6_PLANES = { near: [227, 21], crest: [400, 10] };

/**
 * The veil at one plane MEASURED FROM ANOTHER, which is the quantity R6 §2.3
 * publishes and the quantity a triple of betas is fitted on or is not.
 *
 * The low haze CANCELS out of it: past seventy metres it stands at its ceiling
 * on both planes, so the same grey leaves the numerator and the denominator.
 * That is why a refit against this column is a refit of the betas alone, and
 * also why this column can say nothing about the ceiling.
 */
export function relativeAt(from, to, eyeHeight = 1.7, law = DISTANCE, fitted = FITTED) {
  const f = airAt(...from, eyeHeight, law, fitted);
  const t = airAt(...to, eyeHeight, law, fitted);
  return t.map((v, c) => (v - f[c]) / (1 - f[c]));
}

/** The density the seat states, at the ground. */
export function seatDensity(text) {
  const found = /^const FOG_DENSITY = ([\d.]+);$/m.exec(text);
  return found ? Number(found[1]) : null;
}

/** The height over which the seat thins it. */
export function seatScaleHeight(text) {
  const found = /^\s*scaleHeight: ([\d.]+),$/m.exec(text);
  return found ? Number(found[1]) : null;
}

/** Whether the seat still hands the fitted density to the height fog. */
export const fogUsesSeat = (text) => /densityAtGround: FOG_DENSITY,/.test(text);

/**
 * Every fog uniform written down in a source, and what it is initialised from.
 *
 * A value that is not the seat's own field is a second density or a second
 * height, whatever it is spelled: the point is not that a literal is ugly, it
 * is that two of them cannot be fitted at once.
 */
export function fogInitialisers(path, text) {
  const found = [];
  const written = /\b(uFogDensity|uFogHeight):\s*\{\s*value:\s*([^},]+)/g;
  for (let m = written.exec(text); m; m = written.exec(text)) {
    found.push({
      path, line: lineOf(text, m.index), what: m[1], from: m[2].trim(),
    });
  }
  return found;
}

/** The one expression each of the two uniforms may be born from. */
export const SOURCE_OF = {
  uFogDensity: 'HEIGHT_FOG.densityAtGround',
  uFogHeight: 'HEIGHT_FOG.scaleHeight',
};
export const bornFromSeat = ({ what, from }) => from === SOURCE_OF[what];

if (process.argv.includes('--self')) {
  const text = read(SEAT);
  selfTest('guard-aria', [
    {
      what: 'a density put back to the unfitted 0.013 is caught',
      caught: seatDensity('const FOG_DENSITY = 0.013;') !== FITTED.density,
    },
    {
      what: 'a density moved by one character is caught',
      caught: seatDensity('const FOG_DENSITY = 0.0069;') !== FITTED.density,
    },
    {
      what: 'the seat as it stands carries the fitted density',
      caught: seatDensity(text) === FITTED.density,
    },
    {
      what: 'a scale height moved from 42 to 60 is caught',
      caught: seatScaleHeight('  scaleHeight: 60,') !== FITTED.scaleHeight,
    },
    {
      what: 'the seat as it stands carries the fitted scale height',
      caught: seatScaleHeight(text) === FITTED.scaleHeight,
    },
    {
      what: 'a height fog cut loose from the seat is caught',
      caught: !fogUsesSeat('  densityAtGround: 0.0059,') && fogUsesSeat(text),
    },
    {
      what: 'a material carrying its own density through the uniform is caught',
      caught: fogInitialisers('injected', 'uFogDensity: { value: 0.011 },')
        .some((u) => !bornFromSeat(u)),
    },
    {
      what: 'a material carrying its own scale height is caught',
      caught: fogInitialisers('injected', 'uFogHeight: { value: 120 },')
        .some((u) => !bornFromSeat(u)),
    },
    {
      what: 'the door as it stands is born from the seat',
      caught: fogInitialisers(DOOR, read(DOOR)).every(bornFromSeat),
    },
    {
      what: 'a ceiling taken off the low haze is caught',
      caught: doorDistance('export const FOG_LOW_CAP = 1.0;').lowCap !== DISTANCE.lowCap,
    },
    {
      what: 'a beta put back to the R6 triple, fitted without the haze under it, is caught',
      caught: doorDistance('export const AIR_BETA = [0.0011, 0.0019, 0.0023];')
        .beta.some((v, c) => v !== DISTANCE.beta[c]),
    },
    {
      what: 'the door as it stands carries the four the distance was fitted to',
      caught: (() => {
        const d = doorDistance(read(DOOR));
        return d.lowCap === DISTANCE.lowCap && d.turn === DISTANCE.turn
          && d.beta.every((v, c) => v === DISTANCE.beta[c])
          && d.pale.every((v, c) => v === DISTANCE.pale[c]);
      })(),
    },
    {
      what: 'the two terms reproduce the air the reference puts on its middle crest',
      caught: airAt(400, 10).every((v, c) => Math.abs(v - [0.25, 0.44, 0.62][c]) < 0.02),
    },
    {
      what: 'the relative reading is the RELATIVE one and not the absolute one again',
      caught: relativeAt(R6_PLANES.near, R6_PLANES.crest)
        .every((v, c) => v < airAt(...R6_PLANES.crest)[c] - 0.05),
    },
    {
      what: 'and the low haze leaves the relative reading, as the ceiling makes it',
      caught: (() => {
        const other = { ...DISTANCE, lowCap: 0.05 };
        return relativeAt(R6_PLANES.near, R6_PLANES.crest, 1.7, other)
          .every((v, c) => Math.abs(v - relativeAt(R6_PLANES.near, R6_PLANES.crest)[c]) < 1e-9);
      })(),
    },
    {
      what: 'and leave the walk of E-LUCE2 where it was measured, inside sixty metres',
      caught: Math.abs(airAt(60, 1.0)[1] - 0.11) < 0.02
        && Math.abs(airAt(35, 1.0)[1] - 0.04) < 0.02,
    },
  ]);
}

const report = reporter('guard-aria -- the air is at the two numbers it was fitted to');

const seatText = read(SEAT);
const density = seatDensity(seatText);
const scaleHeight = seatScaleHeight(seatText);

report.check(density === FITTED.density,
  `${SEAT} states FOG_DENSITY ${FITTED.density}`,
  density === null ? 'not found' : `${density}`);
report.check(scaleHeight === FITTED.scaleHeight,
  `${SEAT} states scaleHeight ${FITTED.scaleHeight} m`,
  scaleHeight === null ? 'not found' : `${scaleHeight}`);
report.check(fogUsesSeat(seatText),
  'the height fog takes its ground density from the seat and not a copy of it');

const door = doorDistance(read(DOOR));
report.line('');
report.check(door.lowCap === DISTANCE.lowCap,
  `${DOOR} caps the low haze at ${DISTANCE.lowCap}, where it was last measured`,
  door.lowCap === null ? 'not found' : `${door.lowCap}`);
report.check(door.beta !== null && door.beta.every((v, c) => v === DISTANCE.beta[c]),
  `and carries the distance per channel at ${DISTANCE.beta.join(' / ')}`,
  door.beta === null ? 'not found' : door.beta.join(' / '));
report.check(door.turn === DISTANCE.turn,
  `and turns from the sky's blue to the pale veil over ${DISTANCE.turn} m`,
  door.turn === null ? 'not found' : `${door.turn}`);
report.check(door.pale !== null && door.pale.every((v, c) => v === DISTANCE.pale[c]),
  'and the pale end develops to the 149/187/213 the reference shows on its far hills',
  door.pale === null ? 'not found' : door.pale.join(' / '));

const crest = airAt(400, 10);
const near = [35, 60].map((d) => airAt(d, 1.0)[1]);
report.line('');
report.check(crest.every((v, c) => Math.abs(v - [0.25, 0.44, 0.62][c]) < 0.02),
  'the two together put on the middle crest, FROM THE EYE, the fractions R6 tabulates',
  `${crest.map((v) => v.toFixed(2)).join(' / ')} against 0.25 / 0.44 / 0.62 at 400 m, 10 m up`);

// AND THE SAME CREST MEASURED FROM THE NEAR FLANK, which is the scale R6's
// column is actually built on. Printed and not gated: see the note over
// DISTANCE for the measurement that says why, and AIR_BETA in the door for what
// the near flank's floor is made of.
const relative = relativeAt(R6_PLANES.near, R6_PLANES.crest);
report.line(`  the same crest measured from the near flank at ${R6_PLANES.near.join(' m, ')} m up, `
  + 'which is the scale R6 §2.3 tabulates on');
report.line(`  reads ${relative.map((v) => v.toFixed(2)).join(' / ')} against its 0.25 / 0.44 / 0.62. `
  + 'A triple fitted on THAT comes to 0.001776 / 0.002521 / 0.003257 and');
report.line('  was measured and rejected: it puts the air alone over the reference on all three '
  + 'channels at the crest, which is a plane no palette then reaches, and');
report.line('  leaves more air on the near flank rather than less. The near flank\'s own floor is '
  + '37 levels of blue this term\'s and 8 the ceiling\'s. Owner: the coordinator');
report.check(Math.abs(near[1] - 0.11) < 0.02 && Math.abs(near[0] - 0.04) < 0.02,
  'and leave the walk inside sixty metres where E-LUCE2 measured it',
  `${near[0].toFixed(3)} at 35 m and ${near[1].toFixed(3)} at 60 m, `
  + 'against 0.04 and 0.11');

const initialisers = walk('src', SHIPPED).flatMap((path) => fogInitialisers(path, read(path)));
report.line(`  ${initialisers.length} fog uniform${initialisers.length === 1 ? '' : 's'} `
  + 'written down in what ships (src/dev/ is the bench and is not asked)');
for (const uniform of initialisers) {
  report.check(bornFromSeat(uniform), `${uniform.path}:${uniform.line} ${uniform.what}`,
    `from ${uniform.from}`);
}

report.end('the air by depth reads 0.049 to 0.133 against the reference band 0.031 to 0.211; '
  + 'the near face 11.8% under on level and 11.9% over on chroma');
