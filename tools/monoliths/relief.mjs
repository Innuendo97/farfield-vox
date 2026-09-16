import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { MONOLITHS } from '../../src/world/layout.js';
import { facesOf } from './faces.mjs';

// WHETHER THE BLOCKS OF A WALL ARE VOLUMES OR A DRAWING OF VOLUMES.
//
//   node tools/monoliths/relief.mjs --measure <day-target.png>   write the reference
//   node tools/monoliths/relief.mjs <render.png>                 judge a render
//
// WHY THIS IS A SECOND TOOL AND NOT A COLUMN OF spec.mjs. spec.mjs asks where a
// block ENDS -- the course, the cell, the head -- and every number it produced
// is about the LATTICE. A wall drawn as a lattice of painted lines satisfies
// every one of them and still reads, in the committente's own words, as "linee
// orizzontali e verticali ordinate che formano cubi per intersezione". What
// separates a laid wall from a ruled one is not where the lines fall: it is
// that a block STANDS OUT of the wall or sinks into it, that the joint between
// two of them is a VOID with its own shadow rather than a darker pixel, and
// that some blocks are simply GONE. None of that is a fact about the lattice,
// so none of it could be measured by the tool that measures the lattice.
//
// THE FOUR QUANTITIES, and why each one is the one a picture can actually give:
//
//   LID        A block standing proud of its neighbours shows its own TOP FACE
//              as a sliver along its upper edge. That face points at the sky,
//              so on any wall -- lit flank or shadowed front -- it is BRIGHTER
//              than the vertical face under it. A painted joint does the
//              opposite: it puts a DARKER line there. So the sign of
//              (lid - body) is the single reading that tells a volume from a
//              drawing of one, and it needs no threshold to be believed.
//
//   BODY       How far one block's face stands from the median of its own
//              course. A block set back loses part of the sky its neighbours
//              keep; a block gone entirely shows the cavity behind it, which
//              sees almost none. The three fall on one axis and the census
//              below cuts it in three.
//
//   CREST      How far the top of each column of blocks stands below the
//              highest column of the same face. A flat lid reads nought
//              everywhere; the targets step down by up to eleven courses.
//
//   HOLE       Where the gone blocks are: by tenth of the height and by how
//              many courses they stand from the face's own vertical edge.
//
// WHAT IT REFUSES TO MEASURE, AND WHY THAT IS NOT A GAP. On the fronts of 01,
// 02 and 03 the engraving's glow lifts whole blocks by twenty to thirty L*,
// which is ten times the relief signal. A dilated ink mask does not reach it --
// the bloom is a luminance lift over the entire panel and it is not blue enough
// to cut on chroma. Those three faces are therefore measured for CREST only,
// and the census of relief is taken where the stone is stone: the flanks, and
// the two fronts whose panel is small. The faces that carry a census say so in
// the file they write, so nobody can later read a number off a face that never
// gave one.
//
// THE TARGET IS NEVER CARRIED INTO THIS REPOSITORY. --measure names it by path
// and writes down what it read; what is versioned is the measurement, which is
// ours.

const DEG = Math.PI / 180;
const SPEC = new URL('../../assets-src/monoliths/masonry-spec.json', import.meta.url);

// The lattice the census is taken on, read from the spec rather than restated:
// the course the targets were measured at and the block period resolved off
// 03-front. A census taken on a different lattice from the one the wall is laid
// on measures the lattice and not the relief.
const spec = JSON.parse(readFileSync(SPEC, 'utf8'));
export const RISE = spec.course.rise;
export const CELL = spec.palette.block.periodMetres;

// WHICH FACES GIVE WHAT. `census` is whether the relief classes may be counted
// on this face; `crest` is always taken, because the skyline is above the panel
// and the glow never reaches it.
export const FACES = [
  { id: '01', key: 'front', census: false },
  { id: '01', key: 'side', census: true },
  { id: '02', key: 'front', census: false },
  { id: '03', key: 'front', census: false },
  { id: '04', key: 'front', census: true },
  { id: '05', key: 'front', census: true },
  { id: '05', key: 'side', census: true },
];

// AND EVERY FLAGGED FACE IS COUNTED, INCLUDING THE ONE THAT READS WORST.
//
// A cut on the size of a cell was written here and taken out again. 05's east
// flank gives a cell 5.0 px wide against 8.8 to 12.6 on the other three, and a
// rule that dropped it would have been defensible on its own terms -- and it
// would also have removed the single face where this render disagrees most with
// the target. An estimator too blind to see a face reads NOUGHT there; this one
// reads fifteen per cent of blocks standing proud where the target reads none,
// which is not blindness, it is a miss. It is gated with the rest and carried in
// the report.

// THE CUTS, IN L*, AND WHERE EACH COMES FROM.
//
// They are FIXED and not derived from the image's own spread, because the whole
// point of the census is that the two sides of the comparison are counted the
// same way. A cut at "one standard deviation of this face" passes any wall
// whose blocks differ from each other at all, which is the wall we already had.
//
// LID_PROUD  +6: the target's lit flank reads the lid a median 10.9 L* above
//            the body with a p75 of 15.4; its shadowed fronts read 0.3 to 0.9.
//            Six sits between the two and above the noise of a 5 px cell.
// BODY_GONE  -9: a cavity behind a missing block sees a sliver of sky through
//            the hole it stands in and almost nothing else. On the target's own
//            flank the deep tail begins near nine and runs to thirty.
// BODY_BACK  -3: a block set back by one joint depth loses a measurable corner
//            of its sky. Below three the reading is the tile's own grain.
export const LID_PROUD = 6;
export const BODY_GONE = -9;
export const BODY_BACK = -3;

// How far the engraving's own pixels are grown before a cell that touches them
// is refused. The stroke is 2.6 px and its halo is still readable at 14, so the
// radius is half the halo: further than this and the fronts lose their margins
// too, which is the half of them that has no glow on it at all.
const INK_GROW = 7;

const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((p, q) => p - q);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const share = (n, d) => (d ? (100 * n) / d : 0);

/** Linear luminance of one sRGB triple, and the level it develops to. */
function lightness([r, g, b]) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

// The three things on a wall that are not the wall, as the campaign's own
// detectors read them (R5 §1.1): sky behind the silhouette, the cyan of the
// engraving, and moss.
// AND A CLOUD IS SKY. The blue test alone reads the target's white cloud deck
// as stone -- b - r is ten there, not twenty-five -- and a face whose skyline
// happens to stand against cloud came back with a flat crest and a head made of
// weather. Anything brighter than a lit flank by half again is behind the wall.
const isSky = ([r, g, b]) => (b > r + 25 && b > 110)
  || 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
const isInk = ([r, g, b]) => b > 1.5 * r + 8 && g > 90 && b > 120;
const isMoss = ([r, g, b]) => Math.min(g - r, g - b) > 6;

/** The image, with the engraving's reach already grown into a mask. */
export async function readPlate(path) {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const ink = new Uint8Array(width * height);
  const raw = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (isInk([data[i], data[i + 1], data[i + 2]])) raw[y * width + x] = 1;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!raw[y * width + x]) continue;
      for (let dy = -INK_GROW; dy <= INK_GROW; dy++) {
        for (let dx = -INK_GROW; dx <= INK_GROW; dx++) {
          if (dx * dx + dy * dy > INK_GROW * INK_GROW) continue;
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= height || xx >= width) continue;
          ink[yy * width + xx] = 1;
        }
      }
    }
  }
  return {
    width,
    height,
    at(x, y) {
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= width || yi >= height) return null;
      const i = (yi * width + xi) * channels;
      return {
        rgb: [data[i], data[i + 1], data[i + 2]],
        ink: ink[yi * width + xi] === 1,
      };
    },
  };
}

/**
 * One face, cell by cell: what each block's face and its lid read.
 *
 * The lattice is the block's own — courses off the ground, cells across the
 * face — and every cell is sampled INSIDE itself, so a joint never enters a
 * body reading and the lid band is the block's own top and not its neighbour's
 * bottom.
 */
export function gridOf(plate, monolith, key) {
  const face = facesOf(monolith)[key];
  const courses = Math.round(face.height / RISE);
  const columns = Math.max(1, Math.round(face.width / CELL));
  const sample = (u, v) => plate.at(...(({ x, y }) => [x, y])(face.corner(u, v)));
  const cells = [];
  for (let c = 0; c < courses; c++) {
    for (let i = 0; i < columns; i++) {
      const u0 = (i * CELL) / face.width;
      const u1 = Math.min(1, ((i + 1) * CELL) / face.width);
      const v0 = (c * RISE) / face.height;
      const v1 = Math.min(1, ((c + 1) * RISE) / face.height);
      const band = (lo, hi, rows) => {
        const out = { light: [], sky: 0, ink: 0, moss: 0, n: 0 };
        for (let a = 1; a <= 4; a++) {
          for (let b = 0; b < rows; b++) {
            const s = sample(u0 + (u1 - u0) * (a / 5), v0 + (v1 - v0) * (lo + (hi - lo) * ((b + 0.5) / rows)));
            if (!s) continue;
            out.n++;
            if (isSky(s.rgb)) { out.sky++; continue; }
            if (s.ink) out.ink++;
            if (isMoss(s.rgb)) out.moss++;
            out.light.push(lightness(s.rgb));
          }
        }
        return out;
      };
      const body = band(0.15, 0.80, 4);
      const lid = band(0.86, 1.00, 2);
      cells.push({
        c,
        i,
        sky: body.n ? body.sky / body.n : 1,
        ink: body.ink + lid.ink,
        moss: body.light.length ? body.moss / (body.light.length || 1) : 0,
        body: median(body.light),
        lid: median(lid.light),
      });
    }
  }
  // How many pixels of the picture one course of this face actually covers,
  // taken up the middle of it where the projection is least foreshortened. It
  // is what decides whether this face can carry a census at all.
  const a = face.corner(0.5, 0.5);
  const b = face.corner(0.5 + CELL / face.width, 0.5);
  const cellPx = Math.hypot(a.x - b.x, a.y - b.y);
  return {
    face, courses, columns, cells, cellPx, cell: (c, i) => cells[c * columns + i],
  };
}

/**
 * The census of one face: crest, classes and holes.
 *
 * @param {object} grid what gridOf handed back
 * @param {boolean} census whether the relief classes may be counted here
 */
export function censusOf(grid, census) {
  const { courses, columns, cells, cell } = grid;
  // The skyline, column by column: the highest course still made of stone.
  const crest = [];
  for (let i = 0; i < columns; i++) {
    let top = -1;
    for (let c = 0; c < courses; c++) if (cell(c, i).sky < 0.4) top = c;
    crest.push(top);
  }
  const highest = Math.max(...crest);
  const drops = crest.filter((v) => v >= 0).map((v) => highest - v);

  const out = {
    courses,
    columns,
    crestDrops: drops,
    crestStepped: share(drops.filter((d) => d >= 1).length, drops.length),
    crestDeepest: drops.length ? Math.max(...drops) : 0,
  };
  if (!census) return out;

  // A cell enters the census when it is stone, under its own crest, off the
  // face's two vertical edges (which bleed the neighbouring face), off the
  // grassed foot, and clear of the engraving.
  const usable = cells.filter((k) => k.i > 0 && k.i < columns - 1
    && k.sky < 0.2 && k.ink === 0 && k.moss < 0.6
    && k.c <= crest[k.i] && k.c >= 2 && Number.isFinite(k.body));
  const courseMedian = {};
  for (let c = 0; c < courses; c++) {
    const v = usable.filter((k) => k.c === c).map((k) => k.body);
    if (v.length >= 3) courseMedian[c] = median(v);
  }
  const read = usable.filter((k) => courseMedian[k.c] !== undefined).map((k) => ({
    ...k,
    d: k.body - courseMedian[k.c],
    dl: k.lid - k.body,
  }));
  const proud = read.filter((k) => Number.isFinite(k.dl) && k.dl >= LID_PROUD);
  const gone = read.filter((k) => k.d <= BODY_GONE);
  const back = read.filter((k) => k.d > BODY_GONE && k.d <= BODY_BACK && !proud.includes(k));
  const flush = read.length - proud.length - gone.length - back.length;

  const tenths = new Array(10).fill(0);
  const tenthsAll = new Array(10).fill(0);
  for (const k of read) {
    const t = Math.min(9, Math.floor((k.c / Math.max(1, crest[k.i] + 1)) * 10));
    tenthsAll[t]++;
    if (k.d <= BODY_GONE) tenths[t]++;
  }
  const fromEdge = [0, 0, 0, 0];
  const fromEdgeAll = [0, 0, 0, 0];
  for (const k of read) {
    const e = Math.min(3, Math.min(k.i, columns - 1 - k.i) - 1);
    fromEdgeAll[e]++;
    if (k.d <= BODY_GONE) fromEdge[e]++;
  }
  return {
    ...out,
    read: read.length,
    proud: share(proud.length, read.length),
    flush: share(flush, read.length),
    back: share(back.length, read.length),
    gone: share(gone.length, read.length),
    lidMedian: median(read.map((k) => k.dl).filter(Number.isFinite)),
    holeTenths: tenths.map((n, t) => share(n, tenthsAll[t])),
    holeFromEdge: fromEdge.map((n, e) => share(n, fromEdgeAll[e])),
  };
}

/** Every face of the plan, measured the one way. */
export async function measure(path) {
  const plate = await readPlate(path);
  const out = {};
  for (const f of FACES) {
    const monolith = MONOLITHS.find((m) => m.id === f.id);
    const grid = gridOf(plate, monolith, f.key);
    out[`${f.id}-${grid.face.id}`] = {
      census: f.census,
      cellPx: Number(grid.cellPx.toFixed(1)),
      ...censusOf(grid, f.census),
    };
  }
  return out;
}

const round = (v, n = 1) => (Number.isFinite(v) ? Number(v.toFixed(n)) : null);

function print(name, r) {
  const head = `${name.padEnd(10)} ${String(r.courses).padStart(2)}x${String(r.columns).padStart(2)}`
    + ` cell ${String(r.cellPx).padStart(4)}px`;
  if (!r.census) {
    console.log(`${head}  crest: stepped ${round(r.crestStepped)}%  deepest ${r.crestDeepest} courses`
      + "  (no census: the engraving's glow owns this face)");
    return;
  }
  console.log(`${head}  crest: stepped ${round(r.crestStepped)}%  deepest ${r.crestDeepest}  |  read ${r.read}`
    + `  proud ${round(r.proud)}%  flush ${round(r.flush)}%  back ${round(r.back)}%  gone ${round(r.gone)}%`
    + `  lid ${round(r.lidMedian)} L*`);
  console.log(`${' '.repeat(12)}holes by tenth (foot→head): ${r.holeTenths.map((v) => round(v)).join(' ')}`);
  console.log(`${' '.repeat(12)}holes by courses from the edge: ${r.holeFromEdge.map((v) => round(v)).join(' ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const write = args[0] === '--measure';
  const path = write ? args[1] : args[0];
  if (!path) {
    console.error('usage: relief.mjs [--measure] <image.png>');
    process.exit(2);
  }
  const read = await measure(path);
  console.log(`relief, on ${path}   course ${RISE} m   block ${CELL} m\n`);
  for (const [name, r] of Object.entries(read)) print(name, r);
  if (write) {
    // WHAT A RE-MEASURE MAY NOT THROW AWAY (U-GRADE-1).
    //
    // `relief.flatWall` is the SAME estimator's reading of the wall this
    // chapter replaced, kept so that a miss this render INHERITS can be told
    // from one it caused. It is not produced here -- it was taken once, off the
    // tip this branch was cut from -- and this writer built a whole new
    // `spec.relief` object, so every run of --measure silently deleted it.
    // Found the first time anybody re-measured: guard-rilievo's own self test
    // reads it and threw on an undefined. A tool that destroys a sibling
    // reading it cannot regenerate is a tool nobody can afford to run.
    const kept = spec.relief && spec.relief.flatWall ? { flatWall: spec.relief.flatWall } : {};
    const pooled = Object.entries(read).filter(([, r]) => r.census);
    const weight = pooled.reduce((s, [, r]) => s + r.read, 0);
    const mean = (pick) => pooled.reduce((s, [, r]) => s + pick(r) * r.read, 0) / weight;
    spec.relief = {
      why: [
        'WHETHER THE BLOCKS OF THESE WALLS ARE VOLUMES, as the day target draws',
        'them. Written by tools/monoliths/relief.mjs --measure; the target is the',
        "committente's own material and is never carried here, so what is kept is",
        'the reading.',
        '',
        'proud/flush/back/gone are per cent of the blocks a face gives a census on.',
        'lidMedian is how far a block\'s own top face stands above its front face,',
        'in L*: it is the reading that tells a volume from a painted grid, and a',
        'wall of flat rectangles reads nought.',
        '',
        'RE-READ BY U-GRADE-1 (2026-09-16) THROUGH A CAMERA THAT WAS WRONG WHEN',
        'these numbers were first taken. faces.mjs projected without the fitted',
        "yaw and from the walker's eye instead of the lens, so every window below",
        'stood two to eighteen pixels west of the face it was measuring. What',
        'moved: the pooled census 498 -> 530 blocks, proud 1.4 -> 2.5 per cent,',
        'lidMedian 0.30 -> 0.40 L*, and on 05-east the lid changed SIGN, -0.1 to',
        '+0.4 -- that face was reading as a painted grid because the window was',
        "off it. 01-west's crest read three deep drops where there is one. The",
        'estimator, the cuts and the lattice are untouched: only the camera moved.',
      ],
      measuredFrom: path.split(/[\\/]/).pop(),
      camera: 'tools/monoliths/faces.mjs, which is grade/lib/framing.mjs projectTarget: the fitted camera, whole',
      lattice: { rise: RISE, cell: CELL },
      cuts: { lidProud: LID_PROUD, bodyGone: BODY_GONE, bodyBack: BODY_BACK },
      perFace: Object.fromEntries(Object.entries(read).map(([k, r]) => [k, {
        census: r.census,
        cellPx: r.cellPx,
        courses: r.courses,
        columns: r.columns,
        crestStepped: round(r.crestStepped),
        crestDeepest: r.crestDeepest,
        crestDrops: r.crestDrops,
        ...(r.census ? {
          read: r.read,
          proud: round(r.proud),
          flush: round(r.flush),
          back: round(r.back),
          gone: round(r.gone),
          lidMedian: round(r.lidMedian),
          holeTenths: r.holeTenths.map((v) => round(v)),
          holeFromEdge: r.holeFromEdge.map((v) => round(v)),
        } : {}),
      }])),
      pooled: {
        faces: pooled.map(([k]) => k),
        read: weight,
        proud: round(mean((r) => r.proud)),
        flush: round(mean((r) => r.flush)),
        back: round(mean((r) => r.back)),
        gone: round(mean((r) => r.gone)),
        lidMedian: round(mean((r) => r.lidMedian)),
      },
      ...kept,
    };
    writeFileSync(SPEC, `${JSON.stringify(spec, null, 2)}\n`);
    console.log(`\nwritten to assets-src/monoliths/masonry-spec.json under "relief"`);
  }
}
