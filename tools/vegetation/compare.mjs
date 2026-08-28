import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { FRAME, REPO_ROOT } from '../grade/lib/framing.mjs';
import { deltaE76, srgbToLab } from '../grade/lib/color.mjs';
import { meanRect, readTarget } from '../grade/lib/target.mjs';
import { PATCHES } from './sample-plants.mjs';

// The side by side material the vegetation is judged on.
//
// Numbers say how far apart two colours are, and there are numbers here too,
// but for grass they are close to worthless on their own: a mean over a
// rectangle cannot tell a meadow from a green rug, and a meadow is exactly what
// this step has to produce. So every round writes the render and the reference
// at the same crop, one above the other, at twice size — the only way to answer
// whether the near ground reads as matter with a texture in it or as a set of
// cards somebody can count.

const OUT = join(REPO_ROOT, 'shots');

const CROPS = [
  // The two corners the rocks frame the picture from.
  { id: 'rock-low-left', x0: 0, y0: 730, x1: 420, y1: 941, zoom: 2 },
  { id: 'rock-low-right', x0: 1120, y0: 700, x1: 1672, y1: 941, zoom: 2 },
  // The lip of the path, where the tufts have to lean over the last slab.
  { id: 'path-edge', x0: 560, y0: 700, x1: 1060, y1: 941, zoom: 2 },
  // The two bases the grass has to close over, the second of which is the ring.
  { id: 'base-01', x0: 150, y0: 600, x1: 550, y1: 780, zoom: 2 },
  { id: 'base-05', x0: 1180, y0: 620, x1: 1580, y1: 800, zoom: 2 },
  // And the middle band, where a tuft is two pixels tall and the grass has to
  // stop being cards and become a surface.
  { id: 'meadow-mid', x0: 420, y0: 600, x1: 1020, y1: 760, zoom: 2 },
];

async function main() {
  const renderPath = process.argv[2] || join(OUT, 'pose-p.png');
  const label = process.argv.find((a) => a.startsWith('--label='))?.slice(8) || '';
  const suffix = label ? `-${label}` : '';
  mkdirSync(OUT, { recursive: true });

  // The viewport is not always the reference size to the pixel; everything is
  // compared at the reference size so a crop means the same thing in both.
  const render = await sharp(renderPath)
    .resize(FRAME.width, FRAME.height, { fit: 'fill' }).png().toBuffer();
  const target = join(REPO_ROOT, 'target.png');

  for (const crop of CROPS) {
    const width = crop.x1 - crop.x0;
    const height = crop.y1 - crop.y0;
    const extract = {
      left: crop.x0, top: crop.y0, width, height,
    };
    const a = await sharp(render).extract(extract).png().toBuffer();
    const b = await sharp(target).extract(extract).png().toBuffer();
    const stacked = await sharp({
      create: {
        width, height: height * 2 + 6, channels: 3, background: { r: 20, g: 24, b: 28 },
      },
    })
      .composite([{ input: a, top: 0, left: 0 }, { input: b, top: height + 6, left: 0 }])
      .png().toBuffer();
    await sharp(stacked)
      .resize(Math.round(width * crop.zoom), Math.round((height * 2 + 6) * crop.zoom),
        { kernel: 'nearest' })
      .png()
      .toFile(join(OUT, `veg-${crop.id}${suffix}.png`));
  }

  // And the numbers, over the rectangles the palette was measured from.
  const targetImage = await readTarget();
  const renderImage = await sharp(render).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => ({ width: info.width, height: info.height, channels: 3, data }));

  const hex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16).padStart(2, '0')).join('')}`;

  process.stdout.write(`${renderPath}\n\n`);
  process.stdout.write(`  ${'patch'.padEnd(18)}${'kind'.padEnd(8)}`
    + `${'render'.padEnd(10)}${'target'.padEnd(10)}${'dE76'.padStart(7)}\n`);
  const byKind = new Map();
  for (const patch of PATCHES) {
    if (patch.high) continue;
    const from = meanRect(renderImage, patch);
    const to = meanRect(targetImage, patch);
    const e = deltaE76(srgbToLab(from), srgbToLab(to));
    if (!byKind.has(patch.kind)) byKind.set(patch.kind, []);
    byKind.get(patch.kind).push(e);
    process.stdout.write(`  ${patch.id.padEnd(18)}${patch.kind.padEnd(8)}`
      + `${hex(from).padEnd(10)}${hex(to).padEnd(10)}${e.toFixed(2).padStart(7)}\n`);
  }
  process.stdout.write('\n');
  let all = 0;
  let count = 0;
  for (const [kind, values] of byKind) {
    const mean = values.reduce((t, v) => t + v, 0) / values.length;
    all += values.reduce((t, v) => t + v, 0);
    count += values.length;
    process.stdout.write(`  mean ${kind.padEnd(10)}${mean.toFixed(2).padStart(7)} dE76\n`);
  }
  process.stdout.write(`  mean ${'overall'.padEnd(10)}${(all / count).toFixed(2).padStart(7)} dE76\n`);
  process.stdout.write(`\n${CROPS.length} crop pairs in ${OUT}\n`);
}

main();
