import { lineOf, read, readJson, reporter, selfTest, walk } from './lib.mjs';
import { rampBend, rampTint } from '../../src/core/sky-ramp.js';

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
// What it does assert, since U-LUCE-7, is that the near end of that colour is
// DERIVED and where it is read from: see THE NEAR END OF THE COLOUR below.
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
//   * THE CEILING on the low haze, 0.110874, and it is DERIVED and not written
//     down: it is the haze itself at sixty metres on the meadow a metre up, seen
//     from the walking eye -- the furthest window E-LUCE2 fitted it on, on that
//     window's own ray. So the fit is kept exactly where it was measured and
//     stops exactly where it stopped being measured, with no metres of
//     extrapolation past it. It stood at 0.13 -- "a little past the last window"
//     -- and "a little past" is the whole of the difference between a fit and a
//     number somebody picked. This guard RECOMPUTES it from the density and the
//     scale height in the seat, so it is watched by injection and not by
//     comparison: move either of those two and the ceiling has to follow, which
//     a literal could not. And it is the window's ray and not a level one
//     because a ceiling is a scalar clamp on a term of distance AND height, so
//     it has to be the LARGEST value the haze took on any ray the fit covers, or
//     the clamp reaches back into the fit: the level reading, 0.109143, cuts the
//     last window by 0.23 of an L* and buys 0.13 of rms. D-L8-1.
//   * THE THREE BETAS, 0.001653 / 0.003331 / 0.005559, which are R6 §2.3's own
//     published column — 0.25 / 0.44 / 0.62 — inverted through Beer-Lambert over
//     the path between the two planes it is measured between.
//   * THE ORIGIN of that path, 175 m, and the PALE END the colour turns into.
//
// AND THE ONE THING THE LINE ABOUT THE BETAS USED TO GET WRONG, WHICH COST TWO
// UNITS THEIR FIT. R6 §2.3's column is a RELATIVE scale: its near flank in
// shadow is 0 / 0 / 0 and its pale far hills are 1 / 1 / 1, so 0.25 / 0.44 / 0.62
// is the fraction of the way from the near flank to the pale veil and not the
// fraction of air between the eye and the crest. This guard used to pin the
// ABSOLUTE fraction and merely PRINT the relative one, because under the old
// shape a triple fitted on the relative reading lost the middle crest (U-LUCE-6
// measured it and the coordinator refused to ship it).
//
// THAT IS THE OTHER WAY ROUND NOW, AND THE REASON IS THE SHAPE. Since U-LUCE-8
// the distance term's path has its ORIGIN at the near flank — which is where the
// column has its zero, and where the cornice's palette was measured — so the
// relative column and the law's own fraction are the same number and there is
// nothing left to convert. So the RELATIVE reading is what is gated here, at
// R6's three published figures, and the absolute one is what is printed beside
// it. A guard that gated the absolute one now would be gating a quantity the
// reference never published.
//
// AND WHAT THIS GUARD STILL DOES NOT ASSERT: the two ends as COLOURS. The near
// end is the ramp itself, read at a declared elevation by the door in
// src/core/sky.js; the far end is kept as a ratio to the light the sky hands
// the ground. Both move with the hour on purpose, and a guard that pinned
// either as a triple would pin the hour. What is pinned is the SHAPE, the
// ARITHMETIC, and — since U-LUCE-7, below — that the near end is DERIVED from
// whatever preset arrives and read where it was measured to be read.
export const DISTANCE = {
  lowCap: 0.110874,
  beta: [0.001653, 0.003331, 0.005559],
  origin: 175,
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
    origin: DOOR_NUMBER(text, 'AIR_PATH_ORIGIN'),
    pale: DOOR_TRIPLE(text, 'AIR_PALE'),
  };
}

// AND THE SHAPE ITSELF, WHICH IS THE THING A TRIPLE CANNOT BE CHECKED WITHOUT.
//
// Two units moved numbers inside a shape that was wrong and measured that the
// numbers could not pay for it. So the shape is now asserted where the fragment
// states it, in the four characters that decide it: that the distance's path
// starts at the origin and not at the eye, that what runs over it is
// Beer-Lambert and not a square, and that the pale end is reached as the square
// of the veil rather than over a length in metres. Read as text, because a guard
// should not need a browser's worth of module graph to ask what a shader says.
export const SHAPE = {
  path: /float path = max\(distance \* airMean\(fragmentHeight\) - uAirLaw\.y, 0\.0\);/,
  beer: /return 1\.0 - exp\(-uAirBeta \* path\);/,
  second: /return mix\(uAirNear, uAirPale, veil\.g \* veil\.g\);/,
  haze: /return min\(uAirLaw\.x, 1\.0 - exp\(-depth \* depth\)\);/,
};

/** Whether the door's own shader states the law this guard is fitted to. */
export const doorShape = (text) => Object.fromEntries(
  Object.entries(SHAPE).map(([k, re]) => [k, re.test(text)]),
);

/**
 * The two terms, walked here in the other language, so that the shape the
 * fragment computes can be asked a question about without a browser.
 *
 * Same arithmetic as FOG_GLSL: one height integral shared by both, the low haze
 * capped and gaussian, the distance per channel and Beer-Lambert over the path
 * beyond the origin, and the low haze applied LAST because it is the air
 * nearest the eye.
 */
export function airAt(distance, height, eyeHeight = 1.7, law = DISTANCE,
  fitted = FITTED) {
  const dy = height - eyeHeight;
  const a = Math.exp(-Math.max(eyeHeight, 0) / fitted.scaleHeight);
  const b = Math.exp(-Math.max(height, 0) / fitted.scaleHeight);
  const mean = Math.abs(dy) < 0.01 ? a : ((a - b) * fitted.scaleHeight) / dy;
  const g = Math.min(law.lowCap, 1 - Math.exp(-((distance * fitted.density * mean) ** 2)));
  const path = Math.max(distance * mean - law.origin, 0);
  return law.beta.map((beta) => {
    const f = 1 - Math.exp(-beta * path);
    return 1 - (1 - f) * (1 - g);
  });
}

// THE CEILING, RECOMPUTED FROM THE SEAT rather than compared to a literal.
//
// E-LUCE2's furthest window is at sixty metres on the reference's own meadow,
// and the haze there is what the ceiling is. It is that window's OWN ray -- a
// metre up, from the walking eye -- and not a level one, because a ceiling is a
// scalar clamp on a term of distance and height and so has to be the largest
// value the haze takes on any ray inside the fit. A level ray reads 0.109143 and
// clips the last window; the difference is 0.23 of an L* on the meadow and 0.13
// of rms on the three planes, measured before it was chosen.
export const LAST_WINDOW = [60, 1.0];
export const WALKING_EYE = 1.7;
export function ceilingFrom(fitted = FITTED, window = LAST_WINDOW, eye = WALKING_EYE) {
  const [distance, height] = window;
  const dy = height - eye;
  const a = Math.exp(-Math.max(eye, 0) / fitted.scaleHeight);
  const b = Math.exp(-Math.max(height, 0) / fitted.scaleHeight);
  const mean = Math.abs(dy) < 0.01 ? a : ((a - b) * fitted.scaleHeight) / dy;
  return 1 - Math.exp(-((distance * fitted.density * mean) ** 2));
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

// ------------------------------------------------- THE NEAR END OF THE COLOUR
//
// AND NOW THE COLOUR IS WATCHED AFTER ALL — one END of it, and not as a triple.
//
// The note above says a guard that pinned the air's colour would pin the hour,
// and that is still true: the near end is the sky's own ramp and it must move
// when the preset moves. What is pinned here is that it IS the ramp — that the
// door in src/core/sky.js DERIVES it, at a declared elevation, from whatever
// preset it is handed, rather than carrying a triple of its own. A written-down
// near end is not a wrong colour today; it is a distance still drawing noon on
// the night the client asked for, and nothing else in the suite would see it.
//
// SO THE LEG IS AN INJECTION AND NOT A COMPARISON. A second preset — another
// ramp, another exposure — is put through the same arithmetic the door runs, and
// the near end has to follow it. A constant cannot.
//
// AND THE ELEVATION IS GATED, because it is the one number in the derivation
// that is a CHOICE. U-LUCE-7 measured what moving it costs, under the coordinator's
// D-L6-1 C: the hills are geometrically seen against two to five degrees of sky
// and not twenty, and reading the ramp down there loses the middle crest — the
// air alone stands over the reference on green and blue — while the near flank
// it exists to clear takes MORE air, its floor's blue going 148 to 163 against a
// reference at 103. The error is monotone in the elevation over the whole ramp
// and bottoms at the zenith, so the reference is not naming an elevation at all.
// The measurement is printed below the gate; the reasoning is over AIR_NEAR in
// the seat.
export const NEAR_ELEVATION = 20;

/** The elevation the seat declares the near end is read at. */
export function seatNearElevation(text) {
  const found = /^export const AIR_NEAR_ELEVATION = ([\d.]+);$/m.exec(text);
  return found ? Number(found[1]) : null;
}

/** Whether the door DERIVES the near end from the preset it was handed. */
export const seatDerivesNear = (text) => (
  /AIR_NEAR\.set\(\.\.\.rampTint\(ramp, Math\.sin\(AIR_NEAR_ELEVATION \* DEG\), rampBend\(ramp\)\)/
    .test(text) && /\.map\(\(v, c\) => v \* preset\.exposure\[c\]\)\);/.test(text));

/**
 * The same arithmetic, in this file, so a second preset can be put through it.
 *
 * @param {object} preset an entry of sky.json of the shape day has
 * @param {number} elevationDeg where on the ramp the near end is read
 */
export function nearEnd(preset, elevationDeg = NEAR_ELEVATION) {
  const sin = Math.sin((elevationDeg * Math.PI) / 180);
  return rampTint(preset.ramp, sin, rampBend(preset.ramp))
    .map((v, c) => v * preset.exposure[c]);
}

/** Another hour, for the injection: a ramp and an exposure that are not the day's. */
export const OTHER_HOUR = (preset) => ({
  ...preset,
  ramp: {
    ...preset.ramp,
    horizon: preset.ramp.horizon.map((v) => v * 0.3 + 0.02),
    zenith: preset.ramp.zenith.map((v) => v * 0.1),
    mid: preset.ramp.mid ? preset.ramp.mid.map((v) => v * 0.2 + 0.01) : undefined,
  },
  exposure: preset.exposure.map((v) => v * 0.4),
});

/**
 * Every `uAirNear` written down in a source, and what it is initialised from.
 *
 * One hop is resolved: the door names a module-level object so that every
 * material shares one Vector3, and what has to be true is that the object's
 * value is the SEAT's AIR_NEAR and not a new one.
 */
export function nearInitialisers(path, text) {
  const found = [];
  const written = /\buAirNear:\s*([^\n]+)/g;
  for (let m = written.exec(text); m; m = written.exec(text)) {
    let from = m[1].trim().replace(/,$/, "");
    if (/^[A-Za-z_$][\w$]*$/.test(from)) {
      const hop = new RegExp(`const ${from} = (\\{[^;]*\\});`).exec(text);
      if (hop) from = hop[1].trim();
    }
    found.push({ path, line: lineOf(text, m.index), from });
  }
  return found;
}

/** The one thing a `uAirNear` may be born from: the seat's own vector. */
export const nearBornFromSeat = ({ from }) => from === '{ value: AIR_NEAR }';

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
      what: 'and the ceiling put back to the 0.13 that was a little PAST the last window',
      caught: doorDistance('export const FOG_LOW_CAP = 0.13;').lowCap !== DISTANCE.lowCap,
    },
    {
      what: 'THE CEILING IS THE HAZE AT E-LUCE2 own last window, recomputed from the seat',
      caught: Math.abs(ceilingFrom() - DISTANCE.lowCap) < 5e-4,
    },
    {
      what: 'INJECTION: a denser air moves the ceiling with it, which a literal could not',
      caught: (() => {
        const denser = { ...FITTED, density: FITTED.density * 1.2 };
        return Math.abs(ceilingFrom(denser) - DISTANCE.lowCap) > 0.02;
      })(),
    },
    {
      what: 'and so does a thinner column, which is the seat other half',
      caught: (() => {
        const thinner = { ...FITTED, scaleHeight: FITTED.scaleHeight * 0.6 };
        return Math.abs(ceilingFrom(thinner) - DISTANCE.lowCap) > 0.005;
      })(),
    },
    {
      what: 'and the ceiling does not cut into the windows the haze was fitted on',
      caught: [20, 35, 50, 60].every((d) => ceilingFrom(FITTED, [d, 1.0]) <= DISTANCE.lowCap),
    },
    {
      what: 'and a ceiling read on a LEVEL ray, which would clip the last of them, is caught',
      caught: Math.abs(ceilingFrom(FITTED, [60, 1.7]) - DISTANCE.lowCap) > 1e-3,
    },
    {
      what: 'a beta put back to the triple the old gaussian shape asked for is caught',
      caught: doorDistance('export const AIR_BETA = [0.001105, 0.001904, 0.002611];')
        .beta.some((v, c) => v !== DISTANCE.beta[c]),
    },
    {
      what: 'the door as it stands carries the four the distance was fitted to',
      caught: (() => {
        const d = doorDistance(read(DOOR));
        return d.lowCap === DISTANCE.lowCap && d.origin === DISTANCE.origin
          && d.beta.every((v, c) => v === DISTANCE.beta[c])
          && d.pale.every((v, c) => v === DISTANCE.pale[c]);
      })(),
    },
    {
      what: 'an origin put back to the eye is caught',
      caught: doorDistance('export const AIR_PATH_ORIGIN = 0;').origin !== DISTANCE.origin,
    },
    {
      what: 'and one moved by a single metre',
      caught: doorDistance('export const AIR_PATH_ORIGIN = 176;').origin !== DISTANCE.origin,
    },
    {
      what: 'THE SHAPE: a path taken from the eye instead of from the origin is caught',
      caught: !doorShape('float path = distance * airMean(fragmentHeight);').path,
    },
    {
      what: 'and a square put back over the path, which is the haze fit lent to this term',
      caught: !doorShape('return 1.0 - exp(-uAirBeta * path * path);').beer,
    },
    {
      what: 'and a turn put back on a length in metres instead of on the veil',
      caught: !doorShape('return mix(uAirNear, uAirPale, 1.0 - exp(-distance / uAirLaw.y));')
        .second,
    },
    {
      what: 'and the low haze losing the gaussian of E-LUCE2, which this unit did NOT touch',
      caught: !doorShape('return min(uAirLaw.x, 1.0 - exp(-depth));').haze,
    },
    {
      what: 'the door as it stands states all four characters of the law',
      caught: Object.values(doorShape(read(DOOR))).every(Boolean),
    },
    {
      what: 'the RELATIVE column is the one R6 published, on the scale R6 published it on',
      caught: relativeAt(R6_PLANES.near, R6_PLANES.crest)
        .every((v, c) => Math.abs(v - [0.25, 0.44, 0.62][c]) < 0.01),
    },
    {
      what: 'and it is the relative one and not the absolute one wearing its name',
      caught: airAt(...R6_PLANES.crest)
        .some((v, c) => Math.abs(v - [0.25, 0.44, 0.62][c]) > 0.05),
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
      what: 'the near flank carries NO distance air, which is what the origin is for',
      caught: airAt(...R6_PLANES.near).every((v) => Math.abs(v - DISTANCE.lowCap) < 1e-9),
    },
    {
      what: 'and leave the walk of E-LUCE2 where it was measured, inside sixty metres',
      caught: Math.abs(airAt(60, 1.0)[1] - 0.11) < 0.02
        && Math.abs(airAt(35, 1.0)[1] - 0.04) < 0.02,
    },
    {
      what: 'the near end read down where the hills stand is caught',
      caught: seatNearElevation('export const AIR_NEAR_ELEVATION = 5;') !== NEAR_ELEVATION,
    },
    {
      what: 'and so is one moved by half a degree',
      caught: seatNearElevation('export const AIR_NEAR_ELEVATION = 20.5;') !== NEAR_ELEVATION,
    },
    {
      what: 'the seat as it stands reads it where it was measured',
      caught: seatNearElevation(text) === NEAR_ELEVATION,
    },
    {
      what: 'a near end WRITTEN DOWN instead of derived is caught',
      caught: !seatDerivesNear('  AIR_NEAR.set(0.0015, 0.1124, 0.5932);'),
    },
    {
      what: 'and one derived from the ramp but not carrying the exposure of the preset',
      caught: !seatDerivesNear(
        '  AIR_NEAR.set(...rampTint(ramp, Math.sin(AIR_NEAR_ELEVATION * DEG), rampBend(ramp)));',
      ),
    },
    {
      what: 'the door as it stands derives it from the preset it was handed',
      caught: seatDerivesNear(text),
    },
    {
      what: 'INJECTION: another hour moves the near end, which a constant could not',
      caught: (() => {
        const day = readJson('assets-src/sky/sky.json').day;
        const other = nearEnd(OTHER_HOUR(day));
        return nearEnd(day).some((v, c) => Math.abs(v - other[c]) > 0.01);
      })(),
    },
    {
      what: 'and the elevation is what selects it: twenty and five are not the same colour',
      caught: (() => {
        const day = readJson('assets-src/sky/sky.json').day;
        return nearEnd(day, 5).some((v, c) => Math.abs(v - nearEnd(day)[c]) > 0.01);
      })(),
    },
    {
      what: 'a material holding a blue of its own instead of the sky object is caught',
      caught: nearInitialisers('injected', 'uAirNear: { value: new Vector3(0, 0.11, 0.59) },')
        .some((u) => !nearBornFromSeat(u)),
    },
    {
      what: 'and one that copies the vector instead of sharing it',
      caught: nearInitialisers('injected',
        'const MINE = { value: AIR_NEAR.clone() };\n  uAirNear: MINE,')
        .some((u) => !nearBornFromSeat(u)),
    },
    {
      what: 'the door as it stands shares the vector the seat writes',
      caught: nearInitialisers(DOOR, read(DOOR)).every(nearBornFromSeat),
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
const ceiling = ceilingFrom();
report.check(door.lowCap === DISTANCE.lowCap,
  `${DOOR} caps the low haze at ${DISTANCE.lowCap}, where it was last measured`,
  door.lowCap === null ? 'not found' : `${door.lowCap}`);
report.check(Math.abs(ceiling - DISTANCE.lowCap) < 5e-4,
  `and that IS the haze at ${LAST_WINDOW[0]} m, which is the furthest window E-LUCE2 fitted it on`,
  `recomputed from the seat's own density and scale height: ${ceiling.toFixed(6)}. `
  + 'It stood at 0.13, which was that term a little PAST its last window; a little past is '
  + 'where a fit stops and a choice starts. D-L8-1');
report.check([20, 35, 50, 60].every((d) => ceilingFrom(FITTED, [d, 1.0]) <= DISTANCE.lowCap),
  'and the ceiling reaches down to no window E-LUCE2 fitted, so the walk keeps its own fit',
  `the haze is ${[20, 35, 50, 60].map((d) => ceilingFrom(FITTED, [d, 1.0]).toFixed(4)).join(' / ')} `
  + 'at 20 / 35 / 50 / 60 m on the meadow, all at or under it; the furthest one is not touched '
  + 'because it IS it');
report.check(door.beta !== null && door.beta.every((v, c) => v === DISTANCE.beta[c]),
  `and carries the distance per channel at ${DISTANCE.beta.join(' / ')}`,
  door.beta === null ? 'not found' : door.beta.join(' / '));
report.check(door.origin === DISTANCE.origin,
  `and measures that path from ${DISTANCE.origin} m of it, which is where the near flank stands`,
  door.origin === null ? 'not found' : `${door.origin}`);
const shape = doorShape(read(DOOR));
report.check(Object.values(shape).every(Boolean),
  'and the fragment states the law in the four characters that decide it',
  `path from the origin ${shape.path ? 'yes' : 'NO'}, Beer-Lambert over it `
  + `${shape.beer ? 'yes' : 'NO'}, the pale end as the square of the veil `
  + `${shape.second ? 'yes' : 'NO'}, the gaussian of E-LUCE2 still on the low haze `
  + `${shape.haze ? 'yes' : 'NO'}`);
report.check(door.pale !== null && door.pale.every((v, c) => v === DISTANCE.pale[c]),
  'and the pale end develops to the 149/187/213 the reference shows on its far hills',
  door.pale === null ? 'not found' : door.pale.join(' / '));

// ------------------------------------------------- THE NEAR END OF THE COLOUR
const nearElevation = seatNearElevation(seatText);
const day = readJson('assets-src/sky/sky.json').day;
report.line('');
report.check(nearElevation === NEAR_ELEVATION,
  `${SEAT} reads the near end of the colour off the ramp at ${NEAR_ELEVATION} degrees`,
  nearElevation === null ? 'not found' : `${nearElevation}`);
report.check(seatDerivesNear(seatText),
  'and DERIVES it from the preset it was handed, with that preset\'s own exposure',
  'a triple written down here is a distance still drawing noon after the hour has moved');
const shipped = nearEnd(day, nearElevation ?? NEAR_ELEVATION);
const injected = nearEnd(OTHER_HOUR(day), nearElevation ?? NEAR_ELEVATION);
report.check(shipped.some((v, c) => Math.abs(v - injected[c]) > 0.01),
  'and a second preset put through the same arithmetic moves it, which a constant could not',
  `${shipped.map((v) => v.toFixed(4)).join(' / ')} against `
  + `${injected.map((v) => v.toFixed(4)).join(' / ')} for another hour`);
const nearUniforms = walk('src', SHIPPED).flatMap((path) => nearInitialisers(path, read(path)));
report.line(`  ${nearUniforms.length} \`uAirNear\` written down in what ships`);
for (const uniform of nearUniforms) {
  report.check(nearBornFromSeat(uniform), `${uniform.path}:${uniform.line} uAirNear`,
    `from ${uniform.from}`);
}

// AND WHAT READING IT LOWER COSTS, printed and not gated, for the reason the
// relative triple below is printed: the geometry that asks for it is right and
// the picture refuses it, and both halves have to stay on the report.
const lower = nearEnd(day, 5);
report.line(`  read at five degrees — which is where the near flank at 227 m actually stands, `
  + `1.21 at the middle crest — it would be`);
report.line(`  ${lower.map((v) => v.toFixed(4)).join(' / ')} against `
  + `${shipped.map((v) => v.toFixed(4)).join(' / ')}: measured through the delivered chain that `
  + `loses the middle crest (the air`);
report.line('  alone reads 84 / 147 / 199 against the 83 / 139 / 180 of the reference) and put more '
  + 'air on the near flank rather than less. The error is');
report.line('  monotone in the elevation and bottoms at the zenith: no elevation is named by the '
  + 'reference. D-L6-1. The measurement was taken under the OLD');
report.line('  shape, whose distance term reached the near flank at all; under the origin of '
  + 'U-LUCE-8 it does not, so the near end no longer touches that');
report.line('  plane and the floor there is the low haze alone, 16 / 76 / 111 of blue against the '
  + '103 the reference reads. The lever moved planes, not size');

const crest = airAt(400, 10);
const near = [35, 60].map((d) => airAt(d, 1.0)[1]);
const relative = relativeAt(R6_PLANES.near, R6_PLANES.crest);
report.line('');
report.check(relative.every((v, c) => Math.abs(v - [0.25, 0.44, 0.62][c]) < 0.02),
  'the crest measured FROM THE NEAR FLANK carries the column R6 tabulates, on the scale it '
  + 'tabulates it on',
  `${relative.map((v) => v.toFixed(3)).join(' / ')} against 0.25 / 0.44 / 0.62, `
  + `from ${R6_PLANES.near.join(' m, ')} m up to ${R6_PLANES.crest.join(' m, ')} m up`);
report.check(airAt(...R6_PLANES.near).every((v) => Math.abs(v - DISTANCE.lowCap) < 1e-9),
  'and the near flank itself carries no distance air at all, which is what the origin is for',
  'the air of those 227 m is already inside the pigment U-CORNICE-2 solved against that plane');

// AND THE SAME CREST MEASURED FROM THE NEAR FLANK, which is the scale R6's
// column is actually built on. Printed and not gated: see the note over
// DISTANCE for the measurement that says why, and AIR_BETA in the door for what
// the near flank's floor is made of.
report.line('  the same crest measured FROM THE EYE reads '
  + `${crest.map((v) => v.toFixed(3)).join(' / ')}, which is a different quantity and is printed `
  + 'rather than gated:');
report.line('  the reference never published it. Under the old gaussian this guard gated THAT and '
  + 'printed the relative one, and two units spent themselves');
report.line('  refitting a triple inside a shape whose zero stood at the eye. What is left over the '
  + 'reference at the near flank, measured on the pigment,');
report.line('  is 5 / 16 / 33 and ALL of it the low haze ceiling: E-LUCE2, frozen. Owner of what '
  + 'remains: the coordinator, D-L8-1');
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
