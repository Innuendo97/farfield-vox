import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../grade/lib/framing.mjs';
import { writeCleanPng } from '../grade/lib/png.mjs';
import { linearToSrgb } from '../grade/lib/color.mjs';
import { dilate, Canvas } from './lib/canvas.mjs';

// Paints the sheet of tufts the meadow is dressed with.
//
// Same contract as the ground: this is colour with the light taken out of it.
// A card is multiplied at draw time by the light the Cycles bake put on the
// patch of meadow it stands on, so the sheet must not carry any light of its
// own — except the one kind it has to, which is the light a blade loses to its
// own neighbours. That gradient cannot come from anywhere else: the light atlas
// is a map of the ground, it knows nothing about the inside of a tuft, and a
// tuft lit flat from root to tip reads as a printed pattern rather than as
// grass. So the blade is painted dark at the root and bright at the tip, and
// the mean over a card is held at the meadow's own reflectance, which is what
// keeps a field of them from being a rug of a different green.
//
// Everything is drawn rather than photographed for the same reason the ground
// is painted: a scan carries its own sun, its own season and its own licence,
// and the one thing this sheet must agree with is a reference image.

const OUT_DIR = join(REPO_ROOT, 'assets-src', 'vegetation');
const OUT = join(OUT_DIR, 'grass-atlas.png');
const SIZE = Number(process.argv.find((a) => a.startsWith('--size='))?.slice(7) || 1024);

// The sheet is a column of wide, low cells, because that is the shape of the
// card: a tuft is broader than it is tall, and cells that match it spend their
// texels on the tuft instead of on the air above it.
const COLUMNS = 2;
const ROWS = 4;
const CELLS = COLUMNS * ROWS;

// Empty band around the art of every cell. Mip levels three and four are
// reached by the far half of the ring, and without a margin the top of one tuft
// would start bleeding into the roots of the cell below it.
const MARGIN = 10;

function palette() {
  const path = join(OUT_DIR, 'palette.json');
  const rows = JSON.parse(readFileSync(path, 'utf8')).patches;
  const by = (id) => {
    const found = rows.find((r) => r.id === id);
    if (!found) throw new Error(`patch "${id}" missing: run tools/vegetation/sample-plants.mjs`);
    return found.albedo;
  };
  return {
    lit: by('grass-lit-band'),
    near: by('grass-lit-near'),
    shade: by('grass-shade-near'),
    deep: by('grass-deep-low'),
    flower: by('flower-white'),
  };
}

const scale = (c, k) => c.map((v) => v * k);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/**
 * The five pigments a blade is drawn with, from the measured meadow.
 *
 * The root is three quarters of the reflectance of open grass and the tip three
 * times it: that spread is the shading inside a tuft, and its weighted mean
 * over a whole card is what has to come back to the meadow. It was set lower
 * and the meadow measured a unit and a half of colour error darker with the
 * cards standing on it than without — a tuft is mostly root and mostly in its
 * own shade, so a card whose pigment is centred on the ground's reflectance
 * draws darker than the ground it stands on. The dry blades are the yellow
 * green the reference shows in the cuts of light, and they are a pigment rather
 * than a light because the reference shows them in the shade too.
 */
function pigments(measured) {
  const lit = measured.lit;
  return {
    root: mix(scale(lit, 0.78), measured.shade, 0.40),
    body: scale(lit, 1.52),
    tip: scale(lit, 3.40),
    dry: [lit[0] * 1.85, lit[1] * 1.15, lit[2] * 1.05],
    // Held under one: a petal is not a mirror, and the measured tail of the
    // reference runs above unity because a flower there is two pixels wide with
    // the bloom of the composite already on it.
    flower: measured.flower.map((v) => Math.min(0.90, v)),
    flowerCore: [0.95, 0.96, 0.93],
  };
}

// Value noise on an integer lattice, shared with everything else that is
// painted offline in this project.
function hash(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Deterministic stream of numbers: the sheet has to be the same sheet twice. */
function stream(seed) {
  let n = seed;
  return () => {
    n += 1;
    return hash(n, seed * 7919 + 13);
  };
}

// How the eight cells differ. Only what changes the silhouette is listed: the
// number of blades, how far they lean, how tall they stand and how many flowers
// they carry. Three of the eight have flowers because the reference has them
// everywhere but not on every tuft.
const VARIANTS = [
  { blades: 46, lean: 0.55, height: 0.86, spread: 1.34, flowers: 3, dry: 0.10 },
  { blades: 38, lean: 0.34, height: 0.96, spread: 1.08, flowers: 0, dry: 0.05 },
  { blades: 44, lean: 0.70, height: 0.78, spread: 1.46, flowers: 9, dry: 0.16 },
  { blades: 54, lean: 0.46, height: 0.90, spread: 1.24, flowers: 5, dry: 0.08 },
  { blades: 32, lean: 0.28, height: 0.98, spread: 0.96, flowers: 6, dry: 0.02 },
  { blades: 48, lean: 0.62, height: 0.74, spread: 1.50, flowers: 0, dry: 0.22 },
  { blades: 42, lean: 0.50, height: 0.84, spread: 1.38, flowers: 10, dry: 0.30 },
  { blades: 40, lean: 0.40, height: 0.92, spread: 1.16, flowers: 4, dry: 0.12 },
];

/**
 * One blade, as a tapered arc.
 *
 * Drawn by marching the curve rather than by filling an outline: a blade is
 * two pixels wide at the top and the fill rule of a polygon that thin depends
 * on which side of a texel centre it happens to fall, which is what turns a
 * field of grass into a field of dashes.
 */
function blade(canvas, ink, spec) {
  const {
    x0, y0, x1, y1, cx, cy, width, colours, shade,
  } = spec;
  const steps = Math.max(24, Math.round((Math.abs(y0 - y1) + Math.abs(x0 - x1)) * 1.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    // Quadratic through the control point: one arc, no inflection, which is
    // what a blade of grass is.
    const px = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const py = u * u * y0 + 2 * u * t * cy + t * t * y1;
    // Tapered to a point, and never allowed to fall under a texel: a blade
    // thinner than that stops being drawn and starts flickering.
    const half = Math.max(0.55, width * (1 - t) ** 0.75);
    const colour = t < 0.5
      ? mix(colours.root, colours.body, t * 2)
      : mix(colours.body, colours.tip, (t - 0.5) * 2);
    canvas.stamp(px, py, half, scale(colour, shade), ink);
  }
}

/** A flower: a few white petals on a thin stalk, as the reference draws them. */
function flower(canvas, ink, rand, cell, colours) {
  // Kept over the clump rather than anywhere in the cell: a flower standing on
  // its own in the corner of a card has no tuft under it to belong to.
  const x = cell.x0 + cell.width / 2 + (rand() - 0.5) * (cell.width - MARGIN * 2) * 0.78;
  // Inside the blade mass, not above it: the reference shows flowers among the
  // grass, and a head standing clear on a bare stalk reads as a lollipop.
  const y = cell.y0 + MARGIN + (0.30 + rand() * 0.45) * (cell.height - MARGIN * 2);
  const foot = cell.y1 - MARGIN - rand() * 6;

  // The stalk, greener and thinner than a blade. Stepped by length rather than
  // by a fixed count, or the marks come apart into a dotted line.
  const steps = Math.max(24, Math.round(Math.abs(foot - y) * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Wide enough to survive the alpha test: a stalk drawn under a texel comes
    // back as a dotted line, which is worse than no stalk at all.
    canvas.stamp(x + (rand() - 0.5) * 0.6, foot + (y - foot) * t, 0.95,
      scale(colours.body, 0.85 + 0.3 * t), ink);
  }

  const petals = 4 + Math.floor(rand() * 3);
  const radius = 2.6 + rand() * 2.4;
  const turn = rand() * Math.PI;
  for (let p = 0; p < petals; p++) {
    const angle = turn + (p / petals) * Math.PI * 2;
    canvas.stamp(x + Math.cos(angle) * radius * 0.8, y + Math.sin(angle) * radius * 0.55,
      radius * 0.62, colours.flower, ink);
  }
  canvas.stamp(x, y, radius * 0.55, colours.flowerCore, ink);
}

function paintCell(canvas, cell, variant, colours, seed) {
  const rand = stream(seed);
  const usableWidth = cell.width - MARGIN * 2;
  const usableHeight = cell.height - MARGIN * 2;
  const root = cell.y1 - MARGIN;

  // Back to front, so the blades in front cover the ones behind and the tuft
  // has a depth the alpha channel alone could never give it.
  const blades = [];
  for (let i = 0; i < variant.blades; i++) {
    const depth = rand();
    blades.push({ depth, r: [rand(), rand(), rand(), rand(), rand(), rand()] });
  }
  blades.sort((a, b) => b.depth - a.depth);

  for (const entry of blades) {
    const [ra, rb, rc, rd, re, rf] = entry.r;
    const centre = cell.x0 + cell.width / 2;
    // The roots are gathered towards the middle and the tips fan out, which is
    // what makes a clump rather than a hedge.
    const x0 = centre + (ra - 0.5) * usableWidth * 0.40 * variant.spread;
    const lean = (rb - 0.5) * 2;
    const height = usableHeight * variant.height * (0.54 + 0.46 * rc);
    const x1 = x0 + lean * variant.lean * usableWidth * 0.52;
    const y1 = root - height;
    // The control point sits high and towards the tip: the blade leaves the
    // ground almost upright and bends over near its end.
    const cx = x0 + (x1 - x0) * (0.18 + 0.22 * rd);
    const cy = root - height * (0.72 + 0.2 * re);

    const dry = rf < variant.dry;
    const ink = {
      root: colours.root,
      body: dry ? colours.dry : colours.body,
      tip: dry ? mix(colours.dry, colours.tip, 0.5) : colours.tip,
    };
    blade(canvas, 1, {
      x0, y0: root, x1, y1, cx, cy,
      width: 1.35 + 1.75 * rc,
      colours: ink,
      // Blades at the back of the clump are in its shade. The range is wide on
      // purpose: it is the only thing that stops a tuft reading as a flat decal.
      shade: 0.74 + 0.26 * (1 - entry.depth) ** 0.7,
    });
  }

  for (let i = 0; i < variant.flowers; i++) flower(canvas, 1, rand, cell, colours);
}

function main() {
  const measured = palette();
  const colours = pigments(measured);
  const cellWidth = SIZE / COLUMNS;
  const cellHeight = SIZE / ROWS;
  const canvas = new Canvas(SIZE, SIZE);

  const cells = [];
  for (let i = 0; i < CELLS; i++) {
    const col = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);
    const cell = {
      x0: col * cellWidth,
      y0: row * cellHeight,
      x1: (col + 1) * cellWidth,
      y1: (row + 1) * cellHeight,
      width: cellWidth,
      height: cellHeight,
    };
    paintCell(canvas, cell, VARIANTS[i], colours, 101 + i * 37);
    cells.push({
      index: i,
      // Half a texel inside, so the hardware filter never reaches across the
      // margin into the neighbouring cell.
      rect: [
        (cell.x0 + 0.5) / SIZE, (cell.y0 + 0.5) / SIZE,
        (cell.x1 - 0.5) / SIZE, (cell.y1 - 0.5) / SIZE,
      ],
      flowers: VARIANTS[i].flowers,
    });
  }

  // Colour pushed out under the transparent texels. Without it the mip chain
  // averages the black of an empty texel into the rim of every blade and the
  // far half of the ring is drawn with a dark outline round each tuft.
  dilate(canvas, 12);

  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  let covered = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const alpha = canvas.alpha[i];
    if (alpha > 0.5) covered++;
    for (let c = 0; c < 3; c++) {
      const value = canvas.colour[i * 3 + c];
      pixels[i * 4 + c] = Math.round(Math.min(1, Math.max(0, linearToSrgb(value))) * 255);
    }
    pixels[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  }

  return { pixels, cells, coverage: covered / (SIZE * SIZE), colours };
}

mkdirSync(OUT_DIR, { recursive: true });
const { pixels, cells, coverage, colours } = main();
const bytes = await writeCleanPng(pixels, { width: SIZE, height: SIZE, channels: 4 }, OUT);

writeFileSync(join(OUT_DIR, 'grass.json'), `${JSON.stringify({
  size: SIZE,
  columns: COLUMNS,
  rows: ROWS,
  margin: MARGIN,
  coverage: Number(coverage.toFixed(4)),
  pigments: Object.fromEntries(Object.entries(colours)
    .map(([key, value]) => [key, value.map((v) => Number(v.toFixed(5)))])),
  cells,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${OUT} (${(bytes / 1024).toFixed(0)} kB)\n`);
process.stdout.write(`${CELLS} tufts, ${(coverage * 100).toFixed(1)}% of the sheet covered\n`);
