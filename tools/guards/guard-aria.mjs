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

const initialisers = walk('src', SHIPPED).flatMap((path) => fogInitialisers(path, read(path)));
report.line(`  ${initialisers.length} fog uniform${initialisers.length === 1 ? '' : 's'} `
  + 'written down in what ships (src/dev/ is the bench and is not asked)');
for (const uniform of initialisers) {
  report.check(bornFromSeat(uniform), `${uniform.path}:${uniform.line} ${uniform.what}`,
    `from ${uniform.from}`);
}

report.end('the air by depth reads 0.049 to 0.133 against the reference band 0.031 to 0.211; '
  + 'the near face 11.8% under on level and 11.9% over on chroma');
