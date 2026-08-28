import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { FRAME, REPO_ROOT } from '../grade/lib/framing.mjs';

// Builds the side by side material the ground is judged on: the render and the
// reference at the same crop, one above the other, plus a half and half blend
// of the whole frame. Numbers say how far apart two colours are; only these say
// whether the picture is the same picture.

const OUT = join(REPO_ROOT, 'shots');

const CROPS = [
  { id: 'grass-low-left', x0: 60, y0: 620, x1: 620, y1: 941 },
  { id: 'grass-low-right', x0: 1060, y0: 620, x1: 1620, y1: 941 },
  { id: 'path-centre', x0: 560, y0: 620, x1: 1060, y1: 941 },
  { id: 'horizon-left', x0: 0, y0: 420, x1: 560, y1: 640 },
  { id: 'horizon-right', x0: 1120, y0: 420, x1: 1672, y1: 640 },
  { id: 'monolith-feet', x0: 140, y0: 560, x1: 1120, y1: 760 },
];

async function main() {
  const renderPath = process.argv[2] || join(OUT, 'pose-p-final.png');
  const target = join(REPO_ROOT, 'target.png');
  mkdirSync(OUT, { recursive: true });

  // The viewport is a few pixels wider than the reference; everything is
  // compared at the reference size so a crop means the same thing in both.
  const render = await sharp(renderPath)
    .resize(FRAME.width, FRAME.height, { fit: 'fill' }).png().toBuffer();

  for (const crop of CROPS) {
    const width = crop.x1 - crop.x0;
    const height = crop.y1 - crop.y0;
    const extract = { left: crop.x0, top: crop.y0, width, height };
    const a = await sharp(render).extract(extract).png().toBuffer();
    const b = await sharp(target).extract(extract).png().toBuffer();
    await sharp({
      create: {
        width, height: height * 2 + 6,
        channels: 3, background: { r: 20, g: 24, b: 28 },
      },
    })
      .composite([{ input: a, top: 0, left: 0 }, { input: b, top: height + 6, left: 0 }])
      .png()
      .toFile(join(OUT, `compare-${crop.id}.png`));
  }

  // Half and half down the middle: the join is where a mismatch shows first.
  const left = await sharp(render)
    .extract({ left: 0, top: 0, width: FRAME.width / 2, height: FRAME.height })
    .png().toBuffer();
  const right = await sharp(target)
    .extract({
      left: FRAME.width / 2, top: 0, width: FRAME.width / 2, height: FRAME.height,
    })
    .png().toBuffer();
  await sharp({
    create: {
      width: FRAME.width, height: FRAME.height,
      channels: 3, background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([
      { input: left, top: 0, left: 0 },
      { input: right, top: 0, left: FRAME.width / 2 },
    ])
    .png()
    .toFile(join(OUT, 'compare-split.png'));

  // And a true blend, which is what shows a silhouette that has moved.
  //
  // The half is carried in the alpha channel of the reference rather than in an
  // opacity option: composite has no such option, and passing one silently
  // produced the reference laid over the render at full strength, which is a
  // picture of the reference and says nothing about either.
  const half = await sharp(target).ensureAlpha(0.5).png().toBuffer();
  await sharp(render)
    .composite([{ input: half, blend: 'over' }])
    .png()
    .toFile(join(OUT, 'compare-blend.png'));

  process.stdout.write(`${CROPS.length} crop pairs, split and blend in ${OUT}\n`);
}

main();
