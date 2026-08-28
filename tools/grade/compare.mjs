import { join } from 'node:path';
import sharp from 'sharp';
import { FRAME, REPO_ROOT } from './lib/framing.mjs';
import { writeCleanPng } from './lib/png.mjs';
import {
  deltaE2000, deltaE76, srgbToLab,
} from './lib/color.mjs';
import { meanRect, readTarget, REGIONS, TARGET_PATH } from './lib/target.mjs';

// Builds the side by side material the work is actually judged on.
//
// Numbers decide nothing here. They say where to look; the comparison strips
// are what say whether the frame is right.

const OUT_DIR = join(REPO_ROOT, 'shots');

// The four places the sky and the atmosphere have to agree, chosen because each
// one fails differently: the flat gradient at the top left, the cloud towers on
// the right, the haze behind the central monolith, and the ground meeting it.
const CROPS = [
  { id: 'cielo-alto-sinistra', x: 250, y: 10, width: 380, height: 250 },
  { id: 'torri-di-nuvole-destra', x: 1010, y: 30, width: 480, height: 300 },
  { id: 'orizzonte-dietro-il-centrale', x: 620, y: 330, width: 430, height: 250 },
  { id: 'prato-in-basso', x: 480, y: 640, width: 620, height: 290 },
];

async function loadRender(path) {
  const { data, info } = await sharp(path).removeAlpha()
    .resize(FRAME.width, FRAME.height, { fit: 'fill' }).raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: 3, data };
}

function label(text, width, height, colour = '#ffd400') {
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect x="0" y="0" width="${width}" height="26" fill="rgba(0,0,0,0.6)"/>`
    + `<text x="8" y="18" fill="${colour}" font-size="15" font-family="monospace">${text}</text></svg>`);
}

async function main() {
  const renderPath = process.argv[2] || join(OUT_DIR, 'step3-posa-target.png');
  const render = await loadRender(renderPath);
  const target = await readTarget();

  // 1. blend, straight average of the two frames
  const blend = Buffer.alloc(FRAME.width * FRAME.height * 3);
  for (let i = 0; i < blend.length; i++) {
    blend[i] = Math.round((render.data[i] + target.data[i]) / 2);
  }
  const blendPath = join(OUT_DIR, 'step3-blend-50.png');
  await writeCleanPng(blend, { width: FRAME.width, height: FRAME.height }, blendPath);

  // 2. one strip per area, render above reference
  const strips = [];
  for (const crop of CROPS) {
    const scale = Math.min(2, 640 / crop.width);
    const w = Math.round(crop.width * scale);
    const h = Math.round(crop.height * scale);
    const take = async (source) => sharp(source, source instanceof Buffer
      ? { raw: { width: FRAME.width, height: FRAME.height, channels: 3 } } : undefined)
      .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
      .resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();

    const tile = await sharp({ create: { width: w, height: h * 2 + 8, channels: 3, background: '#101418' } })
      .composite([
        { input: await take(render.data), top: 0, left: 0 },
        { input: label(`render  ${crop.id}`, w, 26), top: 0, left: 0 },
        { input: await take(TARGET_PATH), top: h + 8, left: 0 },
        { input: label(`riferimento  ${crop.id}`, w, 26, '#8fe3ff'), top: h + 8, left: 0 },
      ]).png().toBuffer();
    strips.push({ tile, w, h: h * 2 + 8, id: crop.id });
  }

  const gap = 14;
  const sheetWidth = strips.reduce((t, s) => t + s.w + gap, gap);
  const sheetHeight = Math.max(...strips.map((s) => s.h)) + gap * 2;
  let x = gap;
  const placements = strips.map((s) => {
    const at = { input: s.tile, top: gap, left: x };
    x += s.w + gap;
    return at;
  });
  const stripPath = join(OUT_DIR, 'step3-crop-affiancati.png');
  await sharp({ create: { width: sheetWidth, height: sheetHeight, channels: 3, background: '#101418' } })
    .composite(placements).png({ compressionLevel: 9 }).toFile(stripPath);

  // 3. the numbers, for the record
  process.stdout.write(`${'region'.padEnd(20)}${'kind'.padEnd(8)}${'dE76'.padStart(7)}${'dE2000'.padStart(8)}\n`);
  let total = 0;
  let skyTotal = 0;
  let skyCount = 0;
  for (const region of REGIONS) {
    const a = srgbToLab(meanRect(render, region));
    const b = srgbToLab(meanRect(target, region));
    const e76 = deltaE76(a, b);
    total += e76;
    if (region.kind === 'sky') { skyTotal += e76; skyCount++; }
    process.stdout.write(`${region.id.padEnd(20)}${region.kind.padEnd(8)}`
      + `${e76.toFixed(2).padStart(7)}${deltaE2000(a, b).toFixed(2).padStart(8)}\n`);
  }
  process.stdout.write(`${'mean'.padEnd(28)}${(total / REGIONS.length).toFixed(2).padStart(7)}\n`);
  process.stdout.write(`${'mean, sky only'.padEnd(28)}${(skyTotal / skyCount).toFixed(2).padStart(7)}\n\n`);
  process.stdout.write(`${blendPath}\n${stripPath}\n`);
}

main();
