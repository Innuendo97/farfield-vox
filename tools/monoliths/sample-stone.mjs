import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { FRAME, REPO_ROOT } from '../grade/lib/framing.mjs';
import { readTarget } from '../grade/lib/target.mjs';
import { solveRadiance } from '../terrain/probe.mjs';
import { BLOCKS, faceRect, facesOf } from './faces.mjs';

// Reads the stone out of the reference image, face by face.
//
// The blocks are the one surface in the frame that carries writing, so a mean
// over a rectangle is not safe: a single stroke of the engraving pulls a patch
// several units toward cyan. Every patch below is therefore read as a low
// percentile of its own luminance, which is the stone between the letters, and
// the strips are placed in the margins of the face where the reference leaves
// the rock bare anyway.
//
// The numbers that come out are radiance, not pixels: the whole composite is
// inverted at the patch's own position in the frame, so what is written down is
// the light the surface has to send, which is what the paint and the bake are
// authored against.

const OUT = join(REPO_ROOT, 'assets-src', 'monoliths', 'stone.json');
const CROP_DIR = join(REPO_ROOT, 'shots');

// Height bands, as a fraction of the block. The lowest is above the grass that
// swallows every foot in the reference, the highest below the lit rim, which is
// measured separately because it is two or three pixels tall.
const BANDS = [
  ['low', 0.16, 0.26],
  ['lower', 0.34, 0.44],
  ['mid', 0.52, 0.62],
  ['upper', 0.70, 0.80],
  ['high', 0.87, 0.95],
];

// Vertical strips of the engraved face that the writing never reaches: the
// reference sets its text block well inside both margins.
const FRONT_STRIPS = [['left', 0.035, 0.13], ['right', 0.87, 0.965]];

// The flank is narrow and bare, so it is read whole.
const SIDE_STRIP = [0.25, 0.75];

/**
 * Robust colour of a rectangle: the pixels are ranked by luminance and the
 * value at PERCENTILE is returned. Bright writing and the bright rim both sit
 * at the top of that ranking and are discarded by construction.
 */
const PERCENTILE = 0.4;

function percentileRect(image, rect) {
  const { width, height, data } = image;
  const x0 = Math.max(0, rect.x0);
  const x1 = Math.min(width, rect.x1);
  const y0 = Math.max(0, rect.y0);
  const y1 = Math.min(height, rect.y1);
  const pixels = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
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

function patchesFor(monolith) {
  const { front, side } = facesOf(monolith);
  const out = [];
  for (const [band, v0, v1] of BANDS) {
    for (const [strip, u0, u1] of FRONT_STRIPS) {
      out.push({ id: `front-${strip}-${band}`, face: 'front', band, rect: faceRect(front, u0, v0, u1, v1) });
    }
    out.push({
      id: `${side.id}-${band}`,
      face: side.id,
      band,
      rect: faceRect(side, SIDE_STRIP[0], v0, SIDE_STRIP[1], v1),
    });
  }
  return out;
}

async function writeOverlay(all) {
  mkdirSync(CROP_DIR, { recursive: true });
  const boxes = all.map(({ patch }) => {
    const colour = patch.face === 'front' ? '#ff9000' : '#00e0ff';
    const { x0, y0, x1, y1 } = patch.rect;
    return `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" `
      + `fill="none" stroke="${colour}" stroke-width="1"/>`;
  }).join('');
  const svg = Buffer.from(
    `<svg width="${FRAME.width}" height="${FRAME.height}" xmlns="http://www.w3.org/2000/svg">`
    + `${boxes}</svg>`,
  );
  await sharp(join(REPO_ROOT, 'target.png'))
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toFile(join(CROP_DIR, 'stone-patches.png'));
}

async function main() {
  const target = await readTarget();
  const blocks = [];
  const all = [];

  for (const monolith of BLOCKS) {
    const rows = [];
    for (const patch of patchesFor(monolith)) {
      const srgb = percentileRect(target, patch.rect);
      if (!srgb) continue;
      const px = (patch.rect.x0 + patch.rect.x1) / 2;
      const py = (patch.rect.y0 + patch.rect.y1) / 2;
      // No grade: the fit is rerun at the end of this step, so the stone is
      // authored against the ungraded frame exactly as the ground was.
      const solved = solveRadiance(srgb, px, py, null);
      const row = {
        id: patch.id,
        face: patch.face,
        band: patch.band,
        rect: [patch.rect.x0, patch.rect.y0, patch.rect.x1, patch.rect.y1],
        hex: hex(srgb),
        radiance: solved.radiance.map((v) => Number(v.toFixed(5))),
      };
      rows.push(row);
      all.push({ patch, row });
    }
    blocks.push({ id: monolith.id, key: monolith.key, patches: rows });
  }

  mkdirSync(join(REPO_ROOT, 'assets-src', 'monoliths'), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({ frame: FRAME, blocks }, null, 2)}\n`, 'utf8');

  process.stdout.write(`  ${'patch'.padEnd(24)}${'hex'.padEnd(10)}`
    + `${'radiance r'.padStart(11)}${'g'.padStart(10)}${'b'.padStart(10)}\n`);
  for (const block of blocks) {
    process.stdout.write(`  -- ${block.id} ${block.key}\n`);
    for (const row of block.patches) {
      process.stdout.write(`  ${row.id.padEnd(24)}${row.hex.padEnd(10)}`
        + `${row.radiance.map((v) => v.toFixed(4).padStart(10)).join(' ')}\n`);
    }
  }

  if (!process.argv.includes('--no-overlay')) {
    await writeOverlay(all);
    process.stdout.write(`\noverlay: ${join(CROP_DIR, 'stone-patches.png')}\n`);
  }
  process.stdout.write(`stone: ${OUT}\n`);
}

main();
