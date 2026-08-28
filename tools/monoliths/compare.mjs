import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { deltaE2000, deltaE76, srgbToLab } from '../grade/lib/color.mjs';
import { FRAME, REPO_ROOT } from '../grade/lib/framing.mjs';
import { readTarget } from '../grade/lib/target.mjs';
import { BLOCKS, faceRect, facesOf } from './faces.mjs';

// Measures the stone of a render against the stone of the reference, block by
// block, and builds the pairs of crops the answer is actually judged on.
//
// The rectangles are the ones tools/monoliths/sample-stone.mjs authored the
// paint from, read the same robust way, so a round of correction is measured on
// exactly the surface it was aimed at.
//
//   node tools/monoliths/compare.mjs <render.png>

const OUT = join(REPO_ROOT, 'shots');
const DEFAULT = join(OUT, 'pose-p.png');

const BANDS = [
  ['low', 0.16, 0.26], ['lower', 0.34, 0.44], ['mid', 0.52, 0.62],
  ['upper', 0.70, 0.80], ['high', 0.87, 0.95],
];
const FRONT_STRIPS = [['left', 0.035, 0.13], ['right', 0.87, 0.965]];
const SIDE_STRIP = [0.25, 0.75];
const PERCENTILE = 0.4;

function percentileRect(image, rect) {
  const { width, height, data } = image;
  const pixels = [];
  for (let y = Math.max(0, rect.y0); y < Math.min(height, rect.y1); y++) {
    for (let x = Math.max(0, rect.x0); x < Math.min(width, rect.x1); x++) {
      const o = (y * width + x) * 3;
      pixels.push([
        0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2],
        data[o], data[o + 1], data[o + 2],
      ]);
    }
  }
  if (pixels.length === 0) return null;
  pixels.sort((a, b) => a[0] - b[0]);
  const k = Math.min(pixels.length - 1, Math.floor(pixels.length * PERCENTILE));
  return [pixels[k][1] / 255, pixels[k][2] / 255, pixels[k][3] / 255];
}

const hex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)
  .toString(16).padStart(2, '0')).join('')}`;

// One crop per block, the whole face and a little air round it, plus the places
// the reference says something the numbers cannot.
const CROPS = [
  { id: '01', x0: 120, y0: 280, x1: 420, y1: 710 },
  { id: '02', x0: 470, y0: 265, x1: 720, y1: 660 },
  { id: '03', x0: 705, y0: 105, x1: 975, y1: 650 },
  { id: '04', x0: 975, y0: 275, x1: 1220, y1: 660 },
  { id: '05', x0: 1225, y0: 300, x1: 1500, y1: 710 },
  { id: 'text-03', x0: 760, y0: 160, x1: 930, y1: 480 },
  { id: 'stairs-glow', x0: 700, y0: 540, x1: 1000, y1: 700 },
  { id: 'ring-05', x0: 1230, y0: 560, x1: 1460, y1: 720 },
  { id: 'skyline', x0: 120, y0: 90, x1: 1520, y1: 400 },
];

async function readRender(path) {
  const { data, info } = await sharp(path).removeAlpha()
    .resize(FRAME.width, FRAME.height, { fit: 'fill' }).raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: 3, data };
}

function patchesFor(monolith) {
  const { front, side } = facesOf(monolith);
  const out = [];
  for (const [band, v0, v1] of BANDS) {
    for (const [strip, u0, u1] of FRONT_STRIPS) {
      out.push({ id: `front-${strip}-${band}`, face: 'front', rect: faceRect(front, u0, v0, u1, v1) });
    }
    out.push({
      id: `${side.id}-${band}`, face: side.id,
      rect: faceRect(side, SIDE_STRIP[0], v0, SIDE_STRIP[1], v1),
    });
  }
  return out;
}

async function writeCrops(renderPath, scale) {
  mkdirSync(OUT, { recursive: true });
  const render = await sharp(renderPath).removeAlpha()
    .resize(FRAME.width, FRAME.height, { fit: 'fill' }).png().toBuffer();
  const target = join(REPO_ROOT, 'target.png');
  for (const crop of CROPS) {
    const width = crop.x1 - crop.x0;
    const height = crop.y1 - crop.y0;
    const box = { left: crop.x0, top: crop.y0, width, height };
    const zoom = crop.id === 'skyline' ? 1 : scale;
    const shape = (buffer) => sharp(buffer).extract(box)
      .resize(Math.round(width * zoom), Math.round(height * zoom), { kernel: 'nearest' })
      .png().toBuffer();
    const a = await shape(render);
    const b = await shape(target);
    await sharp({
      create: {
        width: Math.round(width * zoom) * 2 + 8, height: Math.round(height * zoom),
        channels: 3, background: { r: 20, g: 24, b: 28 },
      },
    })
      .composite([
        { input: a, top: 0, left: 0 },
        { input: b, top: 0, left: Math.round(width * zoom) + 8 },
      ])
      .png()
      .toFile(join(OUT, `stone-${crop.id}.png`));
  }
  return CROPS.length;
}

async function main() {
  const path = process.argv[2] || DEFAULT;
  if (!existsSync(path)) throw new Error(`no render at ${path}`);
  const render = await readRender(path);
  const target = await readTarget();
  const verbose = process.argv.includes('--patches');

  process.stdout.write(`${path}\n\n`);
  const overall = [];
  for (const monolith of BLOCKS) {
    const front = [];
    const flank = [];
    for (const patch of patchesFor(monolith)) {
      const from = percentileRect(render, patch.rect);
      const to = percentileRect(target, patch.rect);
      if (!from || !to) continue;
      const e = deltaE76(srgbToLab(from), srgbToLab(to));
      (patch.face === 'front' ? front : flank).push(e);
      overall.push(e);
      if (verbose) {
        process.stdout.write(`    ${patch.id.padEnd(22)}${hex(from).padEnd(9)}${hex(to).padEnd(9)}`
          + `${e.toFixed(2).padStart(7)}${deltaE2000(srgbToLab(from), srgbToLab(to)).toFixed(2).padStart(8)}\n`);
      }
    }
    const mean = (list) => (list.length
      ? list.reduce((t, v) => t + v, 0) / list.length : 0);
    process.stdout.write(`  ${monolith.id} ${monolith.key.padEnd(14)}`
      + `front ${mean(front).toFixed(2).padStart(6)}   flank ${mean(flank).toFixed(2).padStart(6)} dE76\n`);
  }
  process.stdout.write(`\n  mean over every patch ${(overall.reduce((t, v) => t + v, 0) / overall.length).toFixed(2)} dE76\n`);

  if (!process.argv.includes('--no-crops')) {
    const count = await writeCrops(path, 2);
    process.stdout.write(`  ${count} crop pairs in ${OUT}\n`);
  }
}

main();
