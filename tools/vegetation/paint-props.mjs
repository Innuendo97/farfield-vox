import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../grade/lib/framing.mjs';
import { writeCleanPng } from '../grade/lib/png.mjs';
import { linearToSrgb } from '../grade/lib/color.mjs';
import { Canvas, dilate } from './lib/canvas.mjs';

// Paints the second, small sheet: the bushes and the loose flowers.
//
// It is a separate file from the grass rather than four more cells of it
// because the two are read at completely different sizes. A tuft is a third of
// a metre across and is seen from twelve metres; a flower head is eight
// centimetres and is only ever drawn within four. Sharing a sheet would make
// one of the two spend its texels on the other's mip levels.

const OUT_DIR = join(REPO_ROOT, 'assets-src', 'vegetation');
const OUT = join(OUT_DIR, 'props-atlas.png');
const SIZE = 512;
const COLUMNS = 2;
const ROWS = 2;
const MARGIN = 8;

// The order the cells are in, and what the runtime asks for by name. The bushes
// come first because they are the ones placed by hand.
const BUSH_FROM = 0;
const BUSH_COUNT = 2;
const FLOWER_FROM = 2;
const FLOWER_COUNT = 2;

function palette() {
  const rows = JSON.parse(readFileSync(join(OUT_DIR, 'palette.json'), 'utf8')).patches;
  const by = (id) => {
    const found = rows.find((r) => r.id === id);
    if (!found) throw new Error(`patch "${id}" missing: run tools/vegetation/sample-plants.mjs`);
    return found.albedo;
  };
  return { lit: by('grass-lit-band'), shade: by('grass-shade-near'), flower: by('flower-white') };
}

const scale = (c, k) => c.map((v) => v * k);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function hash(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function stream(seed) {
  let n = seed;
  return () => {
    n += 1;
    return hash(n, seed * 7919 + 13);
  };
}

/**
 * A bush: a dome of short leaves, dark and barely broken up.
 *
 * The reference gives these almost no internal detail — they read as masses
 * rather than as plants — so what matters is the silhouette and the fall of
 * tone from a lit crown to a foot in its own shade.
 */
function paintBush(canvas, cell, colours, seed, spec) {
  const rand = stream(seed);
  const cx = cell.x0 + cell.width / 2;
  const foot = cell.y1 - MARGIN;
  const radiusX = (cell.width - MARGIN * 2) / 2 * spec.width;
  const radiusY = (cell.height - MARGIN * 2) * spec.height;

  const leaves = [];
  for (let i = 0; i < spec.leaves; i++) leaves.push([rand(), rand(), rand(), rand(), rand()]);
  // Back to front by height, so the crown covers the mass under it.
  leaves.sort((a, b) => b[1] - a[1]);

  for (const [ra, rb, rc, rd, re] of leaves) {
    // Points inside a half ellipse, gathered towards the middle.
    const angle = ra * Math.PI * 2;
    const reach = Math.sqrt(rb);
    const px = cx + Math.cos(angle) * radiusX * reach;
    const py = foot - Math.abs(Math.sin(angle)) * radiusY * reach - radiusY * 0.06;
    if (py > foot) continue;

    // The crown catches the sky, the foot sits in the bush's own shade. It is
    // the only shading in the cell and it is what stops the mass reading as a
    // cut out.
    const lift = 1 - (py - (foot - radiusY)) / Math.max(radiusY, 1);
    const colour = mix(colours.dark, colours.crown, Math.min(1, lift * 1.15) ** 1.4);
    const size = spec.leaf * (0.6 + 0.8 * rc);

    // Each leaf is a short stroke rather than a dot: a bush drawn with dots
    // reads as gravel.
    const tilt = (rd - 0.5) * 1.4;
    const steps = Math.max(4, Math.round(size * 1.6));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      canvas.stamp(px + Math.sin(tilt) * size * t, py - Math.cos(tilt) * size * t,
        size * 0.30 * (1 - t * 0.55), scale(colour, 0.82 + 0.34 * re), 1);
    }
  }
}

/** A head of white petals on a short stalk. */
function paintFlowers(canvas, cell, colours, seed, count) {
  const rand = stream(seed);
  const cx = cell.x0 + cell.width / 2;
  const foot = cell.y1 - MARGIN;
  const usable = cell.height - MARGIN * 2;

  for (let i = 0; i < count; i++) {
    const x = cx + (rand() - 0.5) * (cell.width - MARGIN * 2) * 0.66;
    const y = cell.y0 + MARGIN + (0.16 + rand() * 0.26) * usable;

    const steps = Math.max(24, Math.round(Math.abs(foot - y) * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      canvas.stamp(x + (rand() - 0.5) * 0.5, foot + (y - foot) * t, 1.5,
        scale(colours.stem, 0.8 + 0.4 * t), 1);
    }

    const petals = 5 + Math.floor(rand() * 3);
    const radius = 19 + rand() * 11;
    const turn = rand() * Math.PI;
    for (let p = 0; p < petals; p++) {
      const angle = turn + (p / petals) * Math.PI * 2;
      // Petals are drawn as short strokes out of the middle, which is what
      // gives the head an edge instead of a blur.
      const steps2 = 10;
      for (let s = 1; s <= steps2; s++) {
        const t = s / steps2;
        canvas.stamp(x + Math.cos(angle) * radius * t, y + Math.sin(angle) * radius * t * 0.8,
          radius * 0.30 * (1 - t * 0.4), mix(colours.petal, colours.rim, t), 1);
      }
    }
    canvas.stamp(x, y, radius * 0.34, colours.core, 1);
  }
}

const BUSHES = [
  { leaves: 260, leaf: 16, width: 1.0, height: 0.94 },
  { leaves: 210, leaf: 20, width: 0.86, height: 1.0 },
];

function main() {
  const measured = palette();
  const canvas = new Canvas(SIZE, SIZE);
  const cellWidth = SIZE / COLUMNS;
  const cellHeight = SIZE / ROWS;

  // The bush is the meadow's own green taken down and cooled: the reference
  // shows these as dark masses with the blue of the sky in their shade, not as
  // a different plant.
  const bushColours = {
    crown: scale(measured.lit, 0.56),
    dark: mix(scale(measured.shade, 0.55), [0.02, 0.03, 0.035], 0.35),
  };
  const flowerColours = {
    stem: scale(measured.lit, 1.1),
    petal: measured.flower.map((v) => Math.min(0.90, v)),
    rim: mix(measured.flower.map((v) => Math.min(0.90, v)), scale(measured.lit, 1.6), 0.35),
    core: [0.95, 0.96, 0.93],
  };

  const cells = [];
  for (let i = 0; i < COLUMNS * ROWS; i++) {
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
    if (i < BUSH_FROM + BUSH_COUNT) {
      paintBush(canvas, cell, bushColours, 401 + i * 53, BUSHES[i - BUSH_FROM]);
      cells.push({ index: i, kind: 'bush' });
    } else {
      paintFlowers(canvas, cell, flowerColours, 601 + i * 71, i === FLOWER_FROM ? 3 : 1);
      cells.push({ index: i, kind: 'flower' });
    }
  }

  dilate(canvas, 10);

  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  let covered = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const alpha = canvas.alpha[i];
    if (alpha > 0.5) covered++;
    for (let c = 0; c < 3; c++) {
      pixels[i * 4 + c] = Math.round(
        Math.min(1, Math.max(0, linearToSrgb(canvas.colour[i * 3 + c]))) * 255,
      );
    }
    pixels[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  }
  return { pixels, cells, coverage: covered / (SIZE * SIZE) };
}

mkdirSync(OUT_DIR, { recursive: true });
const { pixels, cells, coverage } = main();
const bytes = await writeCleanPng(pixels, { width: SIZE, height: SIZE, channels: 4 }, OUT);

writeFileSync(join(OUT_DIR, 'props.json'), `${JSON.stringify({
  size: SIZE,
  columns: COLUMNS,
  rows: ROWS,
  margin: MARGIN,
  bushFrom: BUSH_FROM,
  bushCount: BUSH_COUNT,
  flowerFrom: FLOWER_FROM,
  flowerCount: FLOWER_COUNT,
  coverage: Number(coverage.toFixed(4)),
  cells,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${OUT} (${(bytes / 1024).toFixed(0)} kB)\n`);
process.stdout.write(`${BUSH_COUNT} bushes, ${FLOWER_COUNT} flower cells, `
  + `${(coverage * 100).toFixed(1)}% of the sheet covered\n`);
