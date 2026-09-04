import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { FRAME, REPO_ROOT } from '../grade/lib/framing.mjs';
import { deltaE76, srgbToLab } from '../grade/lib/color.mjs';
import { meanRect, readTarget } from '../grade/lib/target.mjs';

// The side by side material the vegetation is judged on.
//
// Numbers say how far apart two colours are, and there are numbers here too,
// but for grass they are close to worthless on their own: a mean over a
// rectangle cannot tell a meadow from a green rug, and a meadow is exactly what
// this step has to produce. So every round writes the render and the reference
// at the same crop, one above the other, at twice size — the only way to answer
// whether the near ground reads as matter with a texture in it or as a set of
// cards somebody can count.

// THE PATCHES OF THE REFERENCE, WHICH LIVE HERE NOW.
//
// They were the table of tools/vegetation/sample-plants.mjs, which solved a
// pigment out of each of them by dividing the reference's radiance by the light
// a Cycles bake of the ground put under it. That bake and the two atlases that
// carried it left the delivery at step 8, so the division has no divisor and the
// tool went with it; E-V4f.3 had already recorded that the reading itself was
// wrong -- sampled off a photorealistic reference through the light of a bake,
// with its blue 3.7x out. What survives is the MEASUREMENT of where each thing
// is in the frame, which is a set of rectangles and owes nothing to any bake,
// and this file is the only thing that still reads it.
//
// assets-src/vegetation/palette.json therefore has no seat any more, and it is a
// DELIVERED file that src/world/rocks.js reads: it stays in the repository as
// the rock mesh and its light map already do, and the pigment that replaces it
// is V4's to solve on the meadow the cubes draw.
//
// "surface" and "high" are kept as they were written: the first says what the
// patch stands on, the second takes the brightest tail of a rectangle instead of
// its mean, which is the only way to measure a flower two pixels across.

const PATCHES = [
  // The meadow, from the lit band under the blocks down to the shaded
  // foreground. The tuft has to agree with these four or it will not belong to
  // the ground it stands on.
  { id: 'grass-lit-band', kind: 'grass', surface: 'ground', x0: 1180, y0: 690, x1: 1330, y1: 730 },
  { id: 'grass-lit-near', kind: 'grass', surface: 'ground', x0: 1200, y0: 760, x1: 1340, y1: 800 },
  { id: 'grass-shade-near', kind: 'grass', surface: 'ground', x0: 300, y0: 800, x1: 460, y1: 870 },
  { id: 'grass-deep-low', kind: 'grass', surface: 'ground', x0: 1180, y0: 880, x1: 1380, y1: 936 },
  // The lit crown of a tuft, against the mean of the grass around it. This
  // ratio is what the blade tips are painted with.
  { id: 'grass-crown', kind: 'grass', surface: 'ground', high: 0.02, x0: 1150, y0: 700, x1: 1400, y1: 790 },
  // The white flowers: the brightest half per cent of a patch of meadow that is
  // full of them, because that is what a flower is in this image.
  { id: 'flower-white', kind: 'flower', surface: 'ground', high: 0.005, x0: 1180, y0: 700, x1: 1460, y1: 800 },
  { id: 'flower-shade', kind: 'flower', surface: 'ground', high: 0.01, x0: 260, y0: 760, x1: 520, y1: 860 },

  // The hero rocks in the bottom right corner: the lit crown of the big one is
  // weathered stone catching the sun, the moss is the olive on its shoulder.
  { id: 'rock-lit-crown', kind: 'rock', surface: 'rock', x0: 1330, y0: 772, x1: 1420, y1: 806 },
  { id: 'rock-lit-right', kind: 'rock', surface: 'rock', x0: 1455, y0: 795, x1: 1530, y1: 820 },
  { id: 'rock-moss-rim', kind: 'moss', surface: 'rock', x0: 1290, y0: 796, x1: 1345, y1: 822 },
  { id: 'rock-moss-top', kind: 'moss', surface: 'rock', x0: 1436, y0: 800, x1: 1500, y1: 828 },
  { id: 'rock-shade-face', kind: 'rock', surface: 'rock', x0: 1300, y0: 830, x1: 1400, y1: 870 },
  // The mass in the bottom left corner, which the reference leaves almost in
  // silhouette.
  { id: 'rock-left-dark', kind: 'rock', surface: 'rock', x0: 40, y0: 850, x1: 180, y1: 920 },

  // The low bushes between the blocks: dark, cool, barely broken up.
  { id: 'bush-behind-01', kind: 'bush', surface: 'ground', x0: 470, y0: 596, x1: 540, y1: 624 },
];

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
