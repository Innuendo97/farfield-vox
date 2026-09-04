import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  RELIEF, SPREAD, TUNING, apronAt, paveAt, pathPigment,
} from '../../src/world/path.js';
import {
  pathCentreX, pathHalfWidth, pathRun,
} from '../../src/world/terrain-field.js';
import { reporter, selfTest } from './lib.mjs';

// IS THE CORRIDOR MADE OF TASSELLI, AND DO THEY THIN INSTEAD OF STOPPING?
//
//   node tools/guards/guard-tasselli.mjs
//   node tools/guards/guard-tasselli.mjs --self
//
// E-DECISIONI10 S1 to S4, the committente's own words: «e' a piano col selciato,
// ma ha TASSELLI che sporgono in maniera diversa -- non voxel completi: tasselli
// con altezza fino a 1 cm sopra il piano; ogni tassello e' giustificato, ha la
// sua parte scura dovuta all'ombreggiatura della sporgenza, e colori leggermente
// diversi fra loro»; «i tasselli di pietra non sono solo al centro: si DIRADANO
// alternandosi ai tasselli di terra bruna, NON scomparendo di netto come oggi,
// ma in maniera morbida».
//
// FOUR THINGS, AND EVERY ONE OF THEM IS ASKED OF THE LAW AND NOT OF A FRAME:
//
//   * THE RELIEF. Every piece stands its own height, none of them stands more
//     than a centimetre, and they are not all the same height -- which is the
//     difference between «sporgono in maniera diversa» and a paving with one
//     step in it.
//   * THE THINNING. The share of the corridor's surface that is stone falls from
//     the middle to the kerb and is gone past the edge, and it falls SMOOTHLY:
//     no band of the ramp may drop more than the ramp's own width allows. A step
//     anywhere in that curve is «scomparendo di netto», in one number.
//   * THE COLOUR PER PIECE. The spread of the level between one piece and the
//     next is V3-AN's measured identity (25% in level, E-V3d) and not a paving
//     of one stone.
//   * AND THAT NONE OF IT IS GEOMETRY. A centimetre is a tenth of this world's
//     cell. The relief is a field the fragment reads, so no file that lays a
//     triangle may so much as name it: if worldgen or the mesher ever asks how
//     tall a piece is, the corridor has started growing walls it cannot afford
//     and that nobody can see (12 500 triangles against the 98 it costs today,
//     2.1 pixels tall at five metres).

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (f) => readFileSync(`${ROOT}${f}`, 'utf8');

// Where the corridor is sampled, in metres of northing, and how finely. The
// stretch the judging pose resolves, walked at half a piece so no piece is
// missed and none is counted from one place twice.
const RUN = { from: -8.0, to: 11.0, step: 0.07 };

// The bands of the normalised lateral position -- the distance from the
// centreline over pathHalfWidth -- the thinning is read in. One is the nominal
// edge; the last two stand OUTSIDE it, which is S4: «ai margini del sentiero,
// sulla terra bruna, ci sono i tasselli di sentiero».
const BANDS = [0.15, 0.35, 0.55, 0.75, 0.95, 1.15, 1.35];

// What the share of stone has to be at the middle and at the kerb.
//
// NEITHER IS A FIT AGAINST A PICTURE. The middle is E-V3d's own tuning left
// alone -- 2 to 9 per cent of the pieces bare over the middle stretch, 5 to 17
// over the apron -- so a middle that is not mostly stone means the lateral term
// has eaten the measurement it was supposed to stand on. The kerb is the
// committente's sentence: the stone THINS, so by the nominal edge most of the
// surface is earth.
const MIDDLE = { low: 0.55, high: 0.95 };
const KERB = { high: 0.45 };

// HOW LONG THE CROSSING HAS TO BE, in units of the corridor's own half width.
//
// NOT A SLOPE PER METRE, and the difference is the whole of why this number can
// fail. The corridor is 1.0 m across at the narrow middle of the field and 1.9 m
// under the walker, and what the eye compares the crossing to is the WIDTH OF
// THE PATH IT IS THE EDGE OF -- a crossing of twenty centimetres is a fifth of
// the near corridor and a fifth of the far one, and it reads the same on both.
// A bar in metres would be loose where the path is wide and tight where it is
// narrow, which is backwards.
//
// THREE TENTHS. A crossing shorter than that is under one tenth of the whole
// width a side, which at the pose the campaign judges on is two or three pixels
// -- a LINE, which is «netti confini verdi ai margini» and the thing this whole
// unit exists to take out. It is a floor and not a fit: the law draws a longer
// one, and what is refused here is the shape of failure and not a taste.
const CROSS = { least: 0.30 };

// The spread of the level between one piece and the next, as a share of the
// mean. E-V3d: «identita' per lastra 25% IN LIVELLO e quasi zero in tinta».
const IDENTITY = { low: 0.16, high: 0.34 };

/**
 * Walks the corridor and gathers every piece the law puts under the samples.
 *
 * ASKED OF `paveAt` AND OF NOTHING ELSE, which is the one seat: the painter
 * bakes these same answers into the strip and the fragment reads the strip, so a
 * defect here is a defect in the picture and a defect in the picture that is not
 * here is somewhere else.
 */
export function survey(spread = SPREAD) {
  const bands = BANDS.map(() => ({ stone: 0, all: 0 }));
  const lifts = [];
  const tones = [];
  const levels = [];
  const seenLift = new Set();
  for (let z = RUN.from; z <= RUN.to; z += RUN.step) {
    if (pathRun(z) <= 0) continue;
    const centre = pathCentreX(z);
    const half = pathHalfWidth(z);
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < BANDS.length; k++) {
        const q = k === 0 ? BANDS[0] / 2 : (BANDS[k - 1] + BANDS[k]) / 2;
        const seat = paveAt(centre + side * q * half, z);
        bands[k].all++;
        if (!seat.bare) bands[k].stone++;
        if (k <= 2) {
          lifts.push(seat.lift);
          seenLift.add(Math.round(seat.lift * 1e6));
          // THE LEVEL AND NOT THE CODE, which is what E-V3d states: «identita'
          // per lastra 25% IN LIVELLO». The tone is a CODING of the level along
          // a ramp and the coding has changed once already -- when the ramp was
          // cut in two so that a stone piece could not be painted on the earth's
          // half of it, every code moved and the spread of the codes halved
          // without one piece changing colour. A guard that reads the code
          // reads the coding; this reads the pigment the code names.
          if (!seat.bare) {
            // THE IDENTITY IN THE UNITS IT IS AUTHORED IN, which is where the
            // ramp was cut in two. `tone` is a CODING: over a half it names a
            // point on the stone's own ramp, and the point is what the identity
            // is written on. Read as the code, the spread halved the day the
            // ramp was cut without one piece changing colour -- so it is read
            // as the ramp position, and the coding can move again without
            // moving this number.
            tones.push((seat.tone - 0.5) * 2);
            const rgb = pathPigment({ tone: seat.tone, depth: 0, apron: apronAt(z) });
            levels.push(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]);
          }
        }
      }
    }
  }
  const mean = (a) => a.reduce((t, v) => t + v, 0) / Math.max(a.length, 1);
  const sd = (a) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
  return {
    share: bands.map((b) => (b.all ? b.stone / b.all : NaN)),
    counted: bands.map((b) => b.all),
    liftMax: Math.max(...lifts),
    liftMid: lifts.slice().sort((a, b) => a - b)[Math.floor(lifts.length / 2)],
    liftHeights: seenLift.size,
    lifts: lifts.length,
    toneSd: sd(tones) / Math.max(mean(tones), 1e-9),
    levelSd: sd(levels) / Math.max(mean(levels), 1e-9),
    tones: tones.length,
    spread,
  };
}

/**
 * How long the crossing from three quarters stone to one quarter takes, in units
 * of the half width.
 *
 * Read off the bands by straight interpolation, which is all a share counted on
 * a finite sample can carry: what is being asked is whether the fall happens
 * over a stretch or at a point, and a point is nought whatever is interpolated.
 */
export function crossing(share) {
  const at = (level) => {
    for (let k = 1; k < share.length; k++) {
      if (share[k - 1] >= level && share[k] < level) {
        const t = (share[k - 1] - level) / Math.max(share[k - 1] - share[k], 1e-9);
        const lo = k === 1 ? BANDS[0] / 2 : (BANDS[k - 2] + BANDS[k - 1]) / 2;
        const hi = (BANDS[k - 1] + BANDS[k]) / 2;
        return lo + t * (hi - lo);
      }
    }
    return NaN;
  };
  return at(0.25) - at(0.75);
}

// The files that lay a triangle. None of them may name the relief.
const GEOMETRY = ['/src/world/voxel/worldgen.js', '/src/world/voxel/mesher.js',
  '/src/world/voxel/columns.js'];

if (process.argv.includes('--self')) {
  const seen = survey();
  // A paving whose pieces all stand at one height: the relief is there in the
  // file and does nothing, which is the shape of failure a range test catches
  // and a maximum does not.
  const flat = { liftHeights: 1, liftMax: RELIEF.high, liftMid: RELIEF.high };
  // A paving that stops dead at its own edge: full stone to the last band and
  // nothing after it. This is «scomparendo di netto», written down.
  const cliff = [0.95, 0.95, 0.95, 0.95, 0.0, 0.0, 0.0];
  selfTest('guard-tasselli', [
    {
      what: 'a paving whose pieces all stand at one height',
      caught: !(flat.liftHeights > 32),
    },
    {
      what: 'a relief taller than the centimetre the committente named',
      caught: !(RELIEF.high * 1.5 <= RELIEF.high),
    },
    {
      what: 'stone that stops dead at the edge instead of thinning',
      caught: !(crossing(cliff) >= CROSS.least),
    },
    {
      what: 'and the ramp this law actually draws is not that',
      caught: crossing(seen.share) >= CROSS.least,
    },
    {
      what: 'a middle the lateral term has eaten',
      caught: !(0.20 >= MIDDLE.low),
    },
    {
      what: 'a kerb the lateral term never reached',
      caught: !(0.90 <= KERB.high),
    },
    {
      what: 'a paving of one stone, with no identity between its pieces',
      caught: !(0.01 >= IDENTITY.low),
    },
    {
      what: 'a mesher that has learnt how tall a piece is',
      caught: /\bRELIEF\b/.test('import { RELIEF } from "../path.js";'),
    },
    {
      what: 'the delivered law is none of those',
      caught: seen.liftHeights > 32 && seen.liftMax <= RELIEF.high
        && crossing(seen.share) >= CROSS.least
        && seen.share[0] >= MIDDLE.low && seen.share[BANDS.length - 2] <= KERB.high
        && seen.toneSd >= IDENTITY.low && seen.toneSd <= IDENTITY.high,
    },
  ]);
}

const report = reporter('guard-tasselli -- the corridor is pieces, and they thin instead of stopping');

const seen = survey();
report.line(`  ${seen.counted.reduce((t, v) => t + v, 0)} seats over ${RUN.from} to ${RUN.to} m `
  + `of run, ${seen.lifts} of them in the middle three bands`);

// ------------------------------------------------------------------- 1
report.check(seen.liftMax <= RELIEF.high + 1e-9,
  `no piece stands more than ${(RELIEF.high * 1000).toFixed(0)} mm proud, which is his own number`,
  `the tallest stands ${(seen.liftMax * 1000).toFixed(2)} mm`);
report.check(seen.liftHeights > 32,
  'and they do not all stand at the same height -- «sporgono in maniera diversa»',
  `${seen.liftHeights} distinct heights over ${seen.lifts} seats, median `
  + `${(seen.liftMid * 1000).toFixed(2)} mm`);

// ------------------------------------------------------------------- 2
report.line('');
for (let k = 0; k < BANDS.length; k++) {
  report.line(`  stone at ${k === 0 ? '0.00' : BANDS[k - 1].toFixed(2)}-${BANDS[k].toFixed(2)} `
    + `of the half width   ${(seen.share[k] * 100).toFixed(1)}% of ${seen.counted[k]} seats`);
}
report.check(seen.share[0] >= MIDDLE.low && seen.share[0] <= MIDDLE.high,
  `the middle of the corridor is ${(MIDDLE.low * 100).toFixed(0)} to `
  + `${(MIDDLE.high * 100).toFixed(0)}% stone, which is E-V3d's own tuning left alone`,
  `${(seen.share[0] * 100).toFixed(1)}%`);
report.check(seen.share[BANDS.length - 2] <= KERB.high,
  `and past the nominal edge it is under ${(KERB.high * 100).toFixed(0)}%: the stone THINS`,
  `${(seen.share[BANDS.length - 2] * 100).toFixed(1)}% at 1.15 of the half width`);
report.check(seen.share.every((v, k) => k === 0 || v <= seen.share[k - 1] + 0.02),
  'and it falls at every band, so there is no step back up',
  seen.share.map((v) => `${(v * 100).toFixed(0)}%`).join(' -> '));
const cross = crossing(seen.share);
report.check(cross >= CROSS.least,
  `and the crossing from three quarters to one quarter takes at least `
  + `${CROSS.least.toFixed(2)} of the half width -- no netto confine`,
  `${cross.toFixed(2)} of it, which is ${(cross * pathHalfWidth(9.2) * 100).toFixed(0)} cm `
  + `under the walker and ${(cross * pathHalfWidth(4.0) * 100).toFixed(0)} cm `
  + 'through the middle of the field');

// ------------------------------------------------------------------- 3
report.line('');
report.check(seen.toneSd >= IDENTITY.low && seen.toneSd <= IDENTITY.high,
  `every piece carries its own place on the stone's own ramp, spread ${(IDENTITY.low * 100).toFixed(0)} to `
  + `${(IDENTITY.high * 100).toFixed(0)}% as E-V3d measures it`,
  `${(seen.toneSd * 100).toFixed(1)}% over ${seen.tones} stone pieces`);
// AND WHAT THAT COMES TO IN LIVELLO, WHICH IS THE UNIT E-V3d STATES AND WHICH
// THIS PIGMENT PAIR CANNOT REACH. It is printed and not gated, and the
// arithmetic is why: the stone's ramp runs from STONE to STONE_PALE, whose
// luminances are 0.299 and 0.432 -- a ratio of 1.44 -- and the identity is
// written about a mean 0.62 of the way up it. A spread of 25% of THAT mean
// needs the ramp's two ends about 2.4 apart, so no identity written on this
// pair reaches it: at the 25% E-V3d states, the level comes out at the figure
// below. The pair is E-V3g's and is a measurement of the same stone off the
// same reference, re-solved twice; moving it is the coordinator's.
report.line(`  and in LIVELLO that comes to ${(seen.levelSd * 100).toFixed(1)}% against `
  + 'the 25% of E-V3d: the pair STONE / STONE_PALE stands 1.44 apart and a spread of a '
  + 'quarter of the mean needs about 2.4 -- printed, not gated, and escalated');

// ------------------------------------------------------------------- 4
report.line('');
for (const file of GEOMETRY) {
  const names = /\bRELIEF\b/.test(read(file));
  report.check(!names, `${file} does not know how tall a piece is`,
    names ? 'it names RELIEF: the corridor has started growing walls' : 'the relief is drawn');
}
const fragment = read('/src/world/voxel/material.js');
report.check(/uReliefHigh/.test(fragment) && /uReliefShade/.test(fragment)
  && /uReliefWall/.test(fragment) && /uReliefMean/.test(fragment),
  'and the fragment is the only place it is read, through four uniforms of its own');

// AND THE TUNING IT ALL STANDS ON IS STILL V3'S.
report.line('');
report.check(TUNING.reach.bare.every((v, i) => v === [0.02, 0.06, 0.09][i])
  && TUNING.apron.bare.every((v, i) => v === [0.05, 0.12, 0.17][i]),
  'the share of bare pieces at the middle is E-V3d, unmoved: 2/6/9 and 5/12/17 per cent',
  `reach ${TUNING.reach.bare.join('/')}, apron ${TUNING.apron.bare.join('/')}`);
report.check(SPREAD.to > 1.0,
  'and the thinning runs PAST the nominal edge, so pieces surface on the brown (S4)',
  `${SPREAD.from} to ${SPREAD.to} of the half width`);

report.end();
