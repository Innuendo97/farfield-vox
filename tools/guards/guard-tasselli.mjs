import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EARTH, KERB, RELIEF, SPREAD, STONE, STONE_PALE, TUNING, apronAt, paveAt, pathPigment,
} from '../../src/world/path.js';
import {
  pathCentreX, pathHalfWidth, pathRun,
} from '../../src/world/terrain-field.js';
import { MANTO } from '../../src/world/voxel/worldgen.js';
// THE ONE CONSTANT OF LIGHT THE CORRIDOR CARRIES OF ITS OWN, read from the seat
// that ships it. U-LUCE-5 put the level of this paving where the reference's own
// frame has it, and it did it on the LIGHT because the pigment was already at
// the ceiling this file gates. A guard that kept multiplying by the ground's
// exposure alone would be weighing a corridor that no longer ships -- the ratio
// below would survive it, being a ratio, but the hue, the chroma and the joint's
// depth all run through AgX and a LUT and none of the three is linear.
import { PAVING_LIGHT } from '../../src/world/voxel/material.js';
import {
  GROUND_BOUNCE, faceColour, readLight, renderChain,
} from '../lighting/render-chain.mjs';
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

// The three stretches the reference was read in, in metres of northing, and what
// a piece of each measures across. They are R3's own bands and not this file's:
// the near apron under the walker's feet, the middle of the field, and the run
// out to where the ruler stops resolving. The reference answers 5.3 / 6.4 /
// 10.0 cm at the median of the three (R3 §1.5, fondazione/lav/tasselli.py) and
// this paving answered 6.4 / 7.6 / 18.6 before the block halved -- half a
// centimetre out at the middle and most of a hand out at the far end, which is
// where a piece is what tells a paving of tiles from a floor of slabs.
const STRETCH = [
  { name: 'near  z 7.0..9.4', z0: 7.0, z1: 9.4, size: [0.05, 0.11] },
  { name: 'mid   z 4.0..7.0', z0: 4.0, z1: 7.0, size: [0.05, 0.09] },
  { name: 'far   z 0.0..4.0', z0: 0.0, z1: 4.0, size: [0.05, 0.14] },
];

// The floor under all three, and it is the map's own rather than the picture's:
// a piece of 5 cm is six texels of the ruler and two and a half of the tone, and
// under that the maps stop being able to say where a piece ends.
const SIZE_FLOOR = 0.05;

// HOW THE STONE THINS, READ FROM THE KERB THAT IS SEEN, and every band is the
// reference's own reading rather than a shape this file likes.
//
// Measured on the day target at the fitted camera against ITS own kerb -- the
// crossing of half a share of green, found on the picture rather than assumed --
// the share of the corridor's surface that reads as stone runs 45 to 65 per cent
// at 0.60 m inside the kerb, 25 to 35 at 0.20 m, 10 to 20 at the kerb itself and
// under 8 past it, and it does that at ALL THREE stretches (R3 §1.6,
// fondazione/lav/dirad.py). What it refuses is the shape of failure this
// corridor actually had: 53 to 83 per cent of stone right up to the kerb and
// nothing after it, which is a paving that STOPS rather than one that thins.
const FALL = [
  { at: [-0.90, -0.60], low: 0.45, high: 0.65, what: 'in its core     ' },
  { at: [-0.25, -0.12], low: 0.25, high: 0.35, what: '0.2 m inside    ' },
  { at: [-0.12, 0.00], low: 0.10, high: 0.20, what: 'at the kerb     ' },
  { at: [0.12, 0.40], low: 0.00, high: 0.08, what: 'out on the brown' },
];

// THE PIGMENT, AND IT IS ASKED IN RATIOS AND IN HUE AND NOT IN LEVEL.
//
// WHY NOT IN LEVEL, WHICH IS THE FIRST THING A READER WILL WANT. The level of
// this paving is E-LUCE7's wall and it is not this file's to move: the pigment
// stands at the ceiling this world puts on a pigment -- 0.900 of red, «as red as
// a surface may be», ../../src/world/voxel/material.js -- and what it develops
// to at the fitted camera is still seven levels under the reference. Closing
// that takes a constant of the LIGHT on the paving, which is declared with its
// number in the verbale and left to the coordinator. A guard that gated the
// level would be gating a decision nobody has taken.
//
// WHAT IS GATED IS EVERYTHING A PIGMENT OWNS. The reference's stone stands 2.15
// times its own earth in linear luminance (L* 59.3 over 42.4, read on the target
// at the fitted camera); it is a warm beige at hue 80 and chroma 32 where this
// paving was a grey-olive at hue 90 to 106 and chroma 20; and its joints stand
// 9 to 10 levels of L* under the stone either side of them. None of those three
// moves when the light does, and all three were wrong before this unit.
//
// THE JOINT'S BAND IS WIDER THAN THE REFERENCE'S OWN READING, AND THE REASON IS
// THE INSTRUMENT AND NOT A TOLERANCE. What R3 read on the two pictures is the
// mean level of the runs of not-stone BETWEEN two stones on one row, at a pose
// where a slot of four centimetres covers two or three pixels -- so what it
// weighs is a slot averaged with its own lips and with the earth beside it: the
// reference answers 9.7 levels under its stone and this paving, on the same
// ruler on the delivered frame, answers 8.9. The reader below walks the slot
// exhaustively at a centimetre and therefore spends most of its samples on the
// FLOOR of the slot, which no picture at this distance ever resolves on its own;
// on that reading the same joint is 15 levels down. The band holds the shape of
// failure -- a joint no darker than the stone, or one that has become a black
// line round every piece -- and the frame's own number is in the verbale.
const PIGMENT = {
  ratio: [1.85, 2.45],
  chroma: 28,
  hue: [72, 92],
  jointUnder: [8.0, 18.0],
  spread: 5.0,
  ceiling: 0.900,
};

// The spread of the level between one piece and the next, as a share of the
// mean. E-V3d: «identita' per lastra 25% IN LIVELLO e quasi zero in tinta».
const IDENTITY = { low: 0.16, high: 0.34 };

/**
 * The share of the corridor's surface that is stone, at a distance from the
 * VISIBLE kerb, over a stretch.
 *
 * ASKED OF `paveAt` AND OF NOTHING ELSE, which is the one seat: the painter
 * bakes these same answers into the strip and the fragment reads the strip, so a
 * defect here is a defect in the picture and a defect in the picture that is not
 * here is somewhere else.
 */
export function thinning(z0, z1, bands = FALL) {
  const acc = bands.map(() => [0, 0]);
  for (let z = z0; z <= z1; z += 0.02) {
    if (pathRun(z) <= 0) continue;
    const centre = pathCentreX(z);
    const half = pathHalfWidth(z);
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < bands.length; k++) {
        for (let d = bands[k].at[0]; d < bands[k].at[1]; d += 0.01) {
          const seat = paveAt(centre + side * (half + KERB + d), z);
          acc[k][1]++;
          if (!seat.bare) acc[k][0]++;
        }
      }
    }
  }
  return acc.map((a) => (a[1] ? a[0] / a[1] : NaN));
}

/**
 * Every piece of stone the law lays over a stretch, as connected shapes, by
 * equivalent diameter in metres and sorted.
 *
 * COMPONENTS AND NOT LATTICE SEATS, because what a picture measures is what
 * touches what: two pieces whose joint is a hairline are one piece to the eye
 * and to R3's own counter, and a survey that read the lattice would report the
 * sizes the lattice was ASKED for rather than the sizes it draws. The grid is a
 * centimetre, which is finer than the finest joint that survives the map.
 */
export function pieces(z0, z1, span = 0.9) {
  const step = 0.01;
  const nz = Math.round((z1 - z0) / step);
  const nx = Math.round(2 * span / step);
  const mask = new Uint8Array(nz * nx);
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * step;
    const centre = pathCentreX(z);
    for (let i = 0; i < nx; i++) {
      const seat = paveAt(centre - span + i * step, z);
      mask[j * nx + i] = !seat.bare && !seat.inSlot ? 1 : 0;
    }
  }
  const seenCell = new Uint8Array(nz * nx);
  const out = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!mask[k] || seenCell[k]) continue;
      seenCell[k] = 1;
      const stack = [k];
      let i0 = i; let i1 = i; let j0 = j; let j1 = j;
      while (stack.length) {
        const c = stack.pop();
        const cj = Math.floor(c / nx);
        const ci = c % nx;
        if (ci < i0) i0 = ci;
        if (ci > i1) i1 = ci;
        if (cj < j0) j0 = cj;
        if (cj > j1) j1 = cj;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const nj = cj + dj; const ni = ci + di;
            if (nj < 0 || nj >= nz || ni < 0 || ni >= nx) continue;
            const k2 = nj * nx + ni;
            if (mask[k2] && !seenCell[k2]) { seenCell[k2] = 1; stack.push(k2); }
          }
        }
      }
      const d = Math.sqrt((i1 - i0 + 1) * step * (j1 - j0 + 1) * step);
      if (d > 0.03) out.push(d);
    }
  }
  return out.sort((a, b) => a - b);
}

const pct = (a, q) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : NaN);

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** L*, C*, hue and the linear luminance behind them, of an encoded triple. */
export function lch(rgb255) {
  const [r, g, b] = rgb255.map((v) => toLinear(v / 255));
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const a = 500 * (f(x) - f(y));
  const bb = 200 * (f(y) - f(z));
  return {
    L: 116 * f(y) - 16,
    C: Math.hypot(a, bb),
    h: (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360,
    Y: y,
  };
}

// The material's own warmth, which is a rotation of the pigment written in the
// fragment and not in the law (uWarmth in ../../src/world/voxel/material.js).
// Read as TEXT and never imported, for the reason tools/lighting/render-chain
// gives about its own reads: that file reaches three.
const WARMTH = /warmth: new Vector3\(([0-9.]+), ([0-9.]+), ([0-9.]+)\)/
  .exec(read('/src/world/voxel/material.js')).slice(1, 4).map(Number);

/**
 * What the pieces of a stretch develop to, through the chain the delivery ships.
 *
 * THE SAME CHAIN guard-pietra IS WEIGHED ON: the pigment through
 * src/world/face-light.js's two terms on an upward normal, through the
 * material's own warmth, through AgX and through the delivered LUT. It stands
 * about seven levels OVER the frame at the fitted camera -- measured twice, on
 * this palette and on the one before it, fondazione/lav/u7-vero.py -- which is
 * one more reason what is gated below are the ratios and the hue and not the
 * level: an offset that size is a gate on the air and on the pose, not on a
 * pigment.
 */
export async function levels(z0 = 4.0, z1 = 7.0, span = 0.6) {
  const light = readLight();
  const composite = await renderChain();
  // The paving's own scale rides on the albedo, which is exactly where a scale
  // on the light lands: faceColour is linear in its albedo, so albedo x k and
  // light x k are the same three numbers before the curve, and the curve is the
  // only thing downstream that cares.
  const dev = (albedo) => lch(composite(faceColour([0, 1, 0], light,
    albedo.map((v, i) => v * WARMTH[i] * PAVING_LIGHT), GROUND_BOUNCE)));
  const stone = []; const earth = []; const joint = [];
  for (let z = z0; z <= z1; z += 0.01) {
    const centre = pathCentreX(z);
    for (let d = -span; d <= span; d += 0.01) {
      const seat = paveAt(centre + d, z);
      const depth = seat.inSlot ? Math.max(0, (seat.gape - seat.jm) / 2) : 0;
      const c = dev(pathPigment({ tone: seat.tone, depth, apron: apronAt(z) }));
      if (seat.inSlot) joint.push(c);
      else if (seat.bare) earth.push(c);
      else stone.push(c);
    }
  }
  const sorted = (a, key) => a.map((c) => c[key]).sort((x, y) => x - y);
  const pick = (a) => {
    const ls = sorted(a, 'L');
    const mean = ls.reduce((t, v) => t + v, 0) / ls.length;
    return {
      L: pct(ls, 0.5),
      p10: pct(ls, 0.1),
      p90: pct(ls, 0.9),
      sd: Math.sqrt(ls.reduce((t, v) => t + (v - mean) ** 2, 0) / ls.length),
      C: pct(sorted(a, 'C'), 0.5),
      h: pct(sorted(a, 'h'), 0.5),
      Y: pct(sorted(a, 'Y'), 0.5),
    };
  };
  return { stone: pick(stone), earth: pick(earth), joint: pick(joint) };
}

/** The spread of the level between one piece and the next, as E-V3d states it. */
export function identity(z0 = 4.0, z1 = 7.0) {
  const tones = [];
  for (let z = z0; z <= z1; z += 0.02) {
    const centre = pathCentreX(z);
    for (let d = -0.3; d <= 0.3; d += 0.02) {
      const seat = paveAt(centre + d, z);
      if (!seat.bare) tones.push((seat.tone - 0.5) * 2);
    }
  }
  const m = tones.reduce((t, v) => t + v, 0) / tones.length;
  return Math.sqrt(tones.reduce((t, v) => t + (v - m) ** 2, 0) / tones.length) / m;
}

// The files that lay a triangle. None of them may name the relief.
const GEOMETRY = ['/src/world/voxel/worldgen.js', '/src/world/voxel/mesher.js',
  '/src/world/voxel/columns.js'];

const lifts = [];
const heights = new Set();
for (let z = -8; z <= 11; z += 0.07) {
  if (pathRun(z) <= 0) continue;
  const centre = pathCentreX(z);
  for (let d = -0.3; d <= 0.3; d += 0.05) {
    const seat = paveAt(centre + d, z);
    lifts.push(seat.lift);
    heights.add(Math.round(seat.lift * 1e6));
  }
}
const seen = STRETCH.map((s) => ({
  ...s, fall: thinning(s.z0, s.z1), d: pieces(s.z0, s.z1),
}));
const level = await levels();
const inBand = (fall) => fall.every((v, k) => v >= FALL[k].low && v <= FALL[k].high);
const ratio = level.stone.Y / level.earth.Y;
const under = level.stone.L - level.joint.L;

if (process.argv.includes('--self')) {
  // A paving that stops dead at its own edge: full stone to the last column and
  // nothing after it. This is «scomparendo di netto», written down, and it is
  // what this corridor actually drew before U-SENT-7.
  const cliff = [0.90, 0.83, 0.80, 0.00];
  // And a thinning anchored at the CENTRELINE instead of at the kerb -- the
  // window U-SENT-4 shipped, a fraction of the half width, which crossed a metre
  // of ground at one northing and half of one at another. Injected by moving the
  // window this file's own reader is asked through, so what is exercised is the
  // reader and not a table of numbers.
  const keep = { from: SPREAD.from, to: SPREAD.to };
  SPREAD.from = 0.05 * 0.6 - 0.6 - KERB;
  SPREAD.to = 1.35 * 0.6 - 0.6 - KERB;
  const nominal = thinning(4.0, 7.0);
  SPREAD.from = keep.from;
  SPREAD.to = keep.to;
  selfTest('guard-tasselli', [
    {
      what: 'a paving whose pieces all stand at one height',
      caught: !(new Set([RELIEF.high]).size > 32),
    },
    {
      what: 'a relief taller than the centimetre the committente named',
      caught: !(RELIEF.high * 1.5 <= RELIEF.high),
    },
    {
      what: 'stone that stops dead at the kerb instead of thinning',
      caught: !inBand(cliff),
    },
    {
      what: 'a thinning anchored at the centreline instead of at the visible kerb',
      caught: !inBand(nominal),
    },
    {
      what: 'and the fall this law actually draws is neither',
      caught: seen.every((s) => inBand(s.fall)),
    },
    {
      // AND IT IS THE FAR STRETCH THAT CATCHES IT, WHICH IS WHERE R3 FOUND IT.
      // At the middle the old block answered 7.6 cm, which is inside the band a
      // hand asks for; at the far end it answered 18.6 against the reference's
      // 10.0, and a piece of nineteen centimetres at eleven metres is a slab.
      what: 'the block back at 0.40 m, whose pieces read 18.6 cm at the far end',
      caught: !(0.186 <= STRETCH[2].size[1]),
    },
    {
      what: 'pieces finer than the maps can hold',
      caught: !(0.03 >= SIZE_FLOOR),
    },
    {
      what: 'the grey-olive pigment this paving used to wear',
      caught: !(20.2 >= PIGMENT.chroma) && !(106 <= PIGMENT.hue[1]),
    },
    {
      what: 'a stone and an earth that stand at the same level',
      caught: !(1.05 >= PIGMENT.ratio[0]),
    },
    {
      what: 'a joint no darker than the stone it separates',
      caught: !(1.2 >= PIGMENT.jointUnder[0]),
    },
    {
      what: 'a pigment over the ceiling, which is a light being fixed with a colour',
      caught: !([1.144, 0.949, 0.585].every((v) => v <= PIGMENT.ceiling)),
    },
    {
      what: 'the bare band written down twice and once wrongly',
      caught: !(0.18 === MANTO.verge.bare),
    },
    {
      what: 'a mesher that has learnt how tall a piece is',
      caught: /\bRELIEF\b/.test('import { RELIEF } from "../path.js";'),
    },
    {
      what: 'the delivered law is none of those',
      caught: seen.every((s) => inBand(s.fall)
        && pct(s.d, 0.5) >= s.size[0] && pct(s.d, 0.5) <= s.size[1])
        && level.stone.C >= PIGMENT.chroma
        && ratio >= PIGMENT.ratio[0] && ratio <= PIGMENT.ratio[1]
        && KERB === MANTO.verge.bare,
    },
  ]);
}

const report = reporter('guard-tasselli -- the corridor is pieces, and they thin instead of stopping');

// ------------------------------------------------------------------- 1
report.check(Math.max(...lifts) <= RELIEF.high + 1e-9,
  `no piece stands more than ${(RELIEF.high * 1000).toFixed(0)} mm proud, which is his own number`,
  `the tallest stands ${(Math.max(...lifts) * 1000).toFixed(2)} mm`);
report.check(heights.size > 32,
  'and they do not all stand at the same height -- «sporgono in maniera diversa»',
  `${heights.size} distinct heights over ${lifts.length} seats`);

// ------------------------------------------------------------------- 2
report.line('');
report.line('  the share of the surface that is STONE, by distance from the VISIBLE kerb:');
for (const s of seen) {
  report.line(`    ${s.name}   `
    + FALL.map((f, k) => `${f.at[0].toFixed(2)}..${f.at[1].toFixed(2)} `
      + `${(100 * s.fall[k]).toFixed(0)}%`).join('   '));
}
for (let k = 0; k < FALL.length; k++) {
  const f = FALL[k];
  const mid = (f.low + f.high) / 2;
  const worst = seen.reduce((w, s) => (Math.abs(s.fall[k] - mid)
    > Math.abs(w.fall[k] - mid) ? s : w), seen[0]);
  report.check(seen.every((s) => s.fall[k] >= f.low && s.fall[k] <= f.high),
    `${f.what} the stone is ${(100 * f.low).toFixed(0)} to ${(100 * f.high).toFixed(0)}% of the `
    + 'surface, in all three stretches, as the reference reads it',
    `worst ${worst.name.trim().split(' ')[0]} at ${(100 * worst.fall[k]).toFixed(1)}%`);
}
report.check(seen.every((s) => s.fall.every((v, k) => k === 0 || v <= s.fall[k - 1] + 0.02)),
  'and it falls at every band, so there is no step back up',
  seen.map((s) => s.fall.map((v) => `${(100 * v).toFixed(0)}`).join('>')).join('  '));
report.check(SPREAD.from < 0 && SPREAD.to > 0,
  'and the window straddles the kerb, so the last pieces surface out on the brown (S4)',
  `${SPREAD.from} to ${SPREAD.to} m of it`);

// ------------------------------------------------------------------- 3
report.line('');
for (const s of seen) {
  report.line(`  ${s.name}   ${s.d.length} pieces, d10/d50/d90 `
    + `${(100 * pct(s.d, 0.1)).toFixed(1)} / ${(100 * pct(s.d, 0.5)).toFixed(1)} / `
    + `${(100 * pct(s.d, 0.9)).toFixed(1)} cm`);
}
for (const s of seen) {
  const d50 = pct(s.d, 0.5);
  report.check(d50 >= s.size[0] && d50 <= s.size[1],
    `${s.name.split(' ')[0].padEnd(4)} lays pieces of ${(100 * s.size[0]).toFixed(0)} to `
    + `${(100 * s.size[1]).toFixed(0)} cm at the median, which is the reference's own hand`,
    `${(100 * d50).toFixed(1)} cm`);
}
report.check(seen.every((s) => s.size[0] >= SIZE_FLOOR),
  `and no band of it reaches under ${(100 * SIZE_FLOOR).toFixed(0)} cm, which is what the `
  + 'maps can carry: six texels of the ruler and two and a half of the tone');

// ------------------------------------------------------------------- 4
report.line('');
report.line(`  through the delivered chain, over the mid stretch: stone L* ${level.stone.L.toFixed(1)} `
  + `(p10 ${level.stone.p10.toFixed(1)}, p90 ${level.stone.p90.toFixed(1)}, sd `
  + `${level.stone.sd.toFixed(1)}) C* ${level.stone.C.toFixed(1)} h ${level.stone.h.toFixed(0)}; `
  + `earth L* ${level.earth.L.toFixed(1)} C* ${level.earth.C.toFixed(1)}; `
  + `joint L* ${level.joint.L.toFixed(1)}`);
report.check(ratio >= PIGMENT.ratio[0] && ratio <= PIGMENT.ratio[1],
  `the stone stands ${PIGMENT.ratio[0]} to ${PIGMENT.ratio[1]} times its own earth in linear `
  + "luminance, which is the reference's 2.15 and is a ratio no light can move",
  `${ratio.toFixed(2)}`);
report.check(level.stone.C >= PIGMENT.chroma,
  `and it is a warm beige at chroma ${PIGMENT.chroma} or over, not the grey-olive of 20`,
  `C* ${level.stone.C.toFixed(1)}`);
report.check(level.stone.h >= PIGMENT.hue[0] && level.stone.h <= PIGMENT.hue[1],
  `at hue ${PIGMENT.hue[0]} to ${PIGMENT.hue[1]} degrees, which is the reference's 80`,
  `${level.stone.h.toFixed(0)} degrees`);
report.check(level.stone.sd <= PIGMENT.spread,
  `and the pieces stand within ${PIGMENT.spread} levels of one another, as the reference's own `
  + '3.5 does -- the identity is in the shape and in the joint, not in the level',
  `sd ${level.stone.sd.toFixed(1)} L*`);
report.check(under >= PIGMENT.jointUnder[0] && under <= PIGMENT.jointUnder[1],
  `and a joint stands ${PIGMENT.jointUnder[0]} to ${PIGMENT.jointUnder[1]} levels under the stone `
  + 'either side of it, walked to the floor of the slot -- the reference reads 9.7 through a '
  + "picture's own ruler and this paving 8.9 on the same one",
  `${under.toFixed(1)} L*`);
report.note('the LEVEL is still not gated here, and what changed is that it is no longer OPEN. '
  + 'The pigment stands at the ceiling this world puts on a pigment (0.900 of red, «as red as a '
  + 'surface may be», gated below) and the corridor developed five levels under the reference at '
  + 'the fitted camera under it. U-LUCE-5 closed that on the LIGHT, at the x1.48 E-SENT7 measured '
  + 'offline and 13-scala.mjs then swept live in the engine -- PAVING_LIGHT in '
  + 'src/world/voxel/material.js, which THIS FILE now reads, so the levels printed above are the '
  + "corridor that ships. What is gated stays what a pigment owns: the ratio, the hue, the chroma "
  + 'and the joint, none of which a constant on the light can move. The frame itself reads L* 52.6 '
  + "against the reference's own 52.6, veil out of both");
report.note('and what that constant COSTS is a ratio between two surfaces, printed here because '
  + 'nothing else prints it: the stone of this corridor against the grass beside it rises by the '
  + "factor. On the frame that pair was already four times the reference's own before it moved, "
  + "because this world's meadow at that distance is half the level of the reference's -- which is "
  + "U-CAMPO-2's residue and not this corridor's. Owner: U-CAMPO-2");

// ------------------------------------------------------------------- 5
report.line('');
report.check(KERB === MANTO.verge.bare,
  'the bare band beside the stone is ONE number: the paving reads where the kerb is seen and the '
  + 'mat writes it, and neither file may import the other',
  `KERB ${KERB} m, MANTO.verge.bare ${MANTO.verge.bare} m`);
report.check([STONE, STONE_PALE, EARTH].every((p) => p.every((v) => v <= PIGMENT.ceiling + 1e-9)),
  `and no pigment of the paving is over ${PIGMENT.ceiling.toFixed(3)}: an albedo over one is the `
  + 'signature of a light being fixed with a colour',
  `pale ${STONE_PALE.map((v) => v.toFixed(3)).join('/')}`);

// ------------------------------------------------------------------- 6
report.line('');
const toneSd = identity();
report.check(toneSd >= IDENTITY.low && toneSd <= IDENTITY.high,
  `every piece carries its own place on the stone's own ramp, spread `
  + `${(IDENTITY.low * 100).toFixed(0)} to ${(IDENTITY.high * 100).toFixed(0)}% as E-V3d `
  + 'measures it',
  `${(toneSd * 100).toFixed(1)}%`);
report.check(TUNING.apron.bare.every((v, i) => v > TUNING.reach.bare[i]),
  "and the near apron still carries more earth than the middle stretch, which is E-V3d's own "
  + 'direction even though both numbers have moved with the reference behind them',
  `reach ${TUNING.reach.bare.join('/')}, apron ${TUNING.apron.bare.join('/')}`);

// ------------------------------------------------------------------- 7
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

report.end();
