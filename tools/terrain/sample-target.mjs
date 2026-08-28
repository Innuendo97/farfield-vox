import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { FRAME, horizonRow, REPO_ROOT } from '../grade/lib/framing.mjs';
import { agxInverse } from '../grade/lib/agx-inverse.mjs';
import { meanRect, readTarget } from '../grade/lib/target.mjs';

// Reads the ground out of the reference image.
//
// Everything the terrain is painted with has to come from measured pixels, not
// from taste: the albedo is authored offline and there is no second chance to
// nudge it once it is baked. So the patches below are measured once, converted
// back through the tone curve into the light the renderer has to produce, and
// written where the Blender scene and the runtime shaders both read them.
//
// The conversion stops at the tone curve and does not undo the grade. The grade
// is refitted against the finished frame at the end of this step, so aiming the
// ungraded render at the reference colour is the right target: what the grade
// still has to carry afterwards is exactly the error worth reporting.

const OUT_DIR = join(REPO_ROOT, 'assets-src', 'terrain');
const CROP_DIR = join(REPO_ROOT, 'shots');

// Patches of the reference, in pixels of the 1672x941 framing. Each one is a
// surface the terrain has to reproduce, chosen where nothing else overlaps it.
// The reference is a third person picture: the walker stands in the middle of
// the lower frame and the monoliths cover most of the band just under the
// horizon. Every rectangle below is placed in what is left, and --overlay draws
// them back onto the image so that placement can be checked by eye.
export const PATCHES = [
  // Grass, from the bright cuts of light down to the shaded foreground.
  { id: 'grass-lit-mid', kind: 'grass', x0: 980, y0: 640, x1: 1120, y1: 700 },
  { id: 'grass-lit-right', kind: 'grass', x0: 1250, y0: 690, x1: 1400, y1: 770 },
  { id: 'grass-shade-left', kind: 'grass', x0: 300, y0: 852, x1: 452, y1: 918 },
  { id: 'grass-fore-left', kind: 'grass', x0: 200, y0: 780, x1: 420, y1: 860 },
  { id: 'grass-fore-right', kind: 'grass', x0: 1180, y0: 760, x1: 1420, y1: 850 },
  { id: 'grass-mound-right', kind: 'grass', x0: 1140, y0: 660, x1: 1240, y1: 700 },
  { id: 'grass-band-left', kind: 'grass', x0: 60, y0: 596, x1: 170, y1: 620 },
  { id: 'grass-band-right', kind: 'grass', x0: 950, y0: 600, x1: 1005, y1: 626 },
  // The strip of grass that swallows the foot of a monolith: measured just
  // below the stone, which is where the occlusion has to happen.
  { id: 'grass-base-01', kind: 'grass', x0: 200, y0: 680, x1: 380, y1: 706 },
  { id: 'grass-base-05', kind: 'grass', x0: 1268, y0: 700, x1: 1420, y1: 730 },

  // Path: wide and near at the bottom of the frame, narrow at the stairs.
  // Kept clear of the walker, who covers the middle of the lower frame.
  { id: 'path-near', kind: 'path', x0: 780, y0: 890, x1: 866, y1: 934 },
  { id: 'path-mid', kind: 'path', x0: 806, y0: 800, x1: 892, y1: 880 },
  { id: 'path-far', kind: 'path', x0: 898, y0: 700, x1: 940, y1: 732 },
  { id: 'path-edge-left', kind: 'path', x0: 580, y0: 902, x1: 644, y1: 938 },

  // The pale stretch down the middle of the path. It was read as water and
  // sampled as water, and it is not: the committente's ruling is that this is an
  // ordinary path, lit here and shaded there by what stands around it. So these
  // three are path, and they are the brightest path the reference gives — which
  // is the whole reason the middle of the run has to come out of the light and
  // not out of a lane of pigment.
  { id: 'path-lit-far', kind: 'path', x0: 824, y0: 700, x1: 862, y1: 742 },
  { id: 'path-lit-mid', kind: 'path', x0: 780, y0: 772, x1: 825, y1: 812 },
  { id: 'path-lit-near', kind: 'path', x0: 760, y0: 836, x1: 812, y1: 872 },

  // Standing water in the middle distance, read in the gaps between monoliths.
  { id: 'lake-left', kind: 'water', x0: 424, y0: 566, x1: 516, y1: 584 },
  { id: 'lake-right', kind: 'water', x0: 944, y0: 568, x1: 1000, y1: 590 },

  // The ring of hills, from the lit green nearest the eye out to the blue
  // silhouettes the aerial perspective leaves behind.
  { id: 'hill-left-lit', kind: 'hill', x0: 40, y0: 496, x1: 170, y1: 536 },
  { id: 'hill-left-far', kind: 'hill', x0: 0, y0: 450, x1: 84, y1: 480 },
  { id: 'hill-right-lit', kind: 'hill', x0: 1490, y0: 492, x1: 1650, y1: 540 },
  { id: 'hill-right-far', kind: 'hill', x0: 1560, y0: 452, x1: 1672, y1: 484 },
  { id: 'haze-left', kind: 'hill', x0: 20, y0: 556, x1: 150, y1: 580 },
  { id: 'haze-right', kind: 'hill', x0: 1480, y0: 556, x1: 1620, y1: 580 },

  { id: 'stairs', kind: 'stone', x0: 776, y0: 600, x1: 924, y1: 652 },
];

// Crops written next to the numbers, because a mean colour cannot show whether
// an edge is hard or soft, and both have to be decided from the reference.
const CROPS = [
  { id: 'path-centre', x0: 560, y0: 620, x1: 1060, y1: 941 },
  { id: 'grass-low-left', x0: 60, y0: 620, x1: 620, y1: 941 },
  { id: 'grass-low-right', x0: 1060, y0: 620, x1: 1620, y1: 941 },
  { id: 'horizon-left', x0: 0, y0: 420, x1: 560, y1: 640 },
  { id: 'horizon-right', x0: 1120, y0: 420, x1: 1672, y1: 640 },
  { id: 'monolith-feet', x0: 140, y0: 560, x1: 1120, y1: 760 },
  { id: 'stairs-and-lakes', x0: 620, y0: 520, x1: 1120, y1: 700 },
];

const hex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)
  .toString(16).padStart(2, '0')).join('')}`;

const round = (values, digits = 5) => values.map((v) => Number(v.toFixed(digits)));

// A mean colour says nothing about whether the rectangle was on the surface it
// claims: the walker and the monoliths cover much of the lower frame. This
// draws the rectangles back onto the reference so that can be judged by eye.
const PATCH_COLOURS = {
  grass: '#00ff40', path: '#ff9000', water: '#00e0ff', hill: '#ff00c0', stone: '#ffff00',
};

async function writeOverlay() {
  mkdirSync(CROP_DIR, { recursive: true });
  const boxes = PATCHES.map((p) => {
    const colour = PATCH_COLOURS[p.kind] || '#ffffff';
    return `<rect x="${p.x0}" y="${p.y0}" width="${p.x1 - p.x0}" height="${p.y1 - p.y0}" `
      + `fill="none" stroke="${colour}" stroke-width="2"/>`
      + `<text x="${p.x0 + 3}" y="${p.y0 - 4}" font-family="sans-serif" font-size="13" `
      + `fill="${colour}">${p.id}</text>`;
  }).join('');
  const svg = Buffer.from(
    `<svg width="${FRAME.width}" height="${FRAME.height}" xmlns="http://www.w3.org/2000/svg">`
    + `${boxes}</svg>`,
  );
  await sharp(join(REPO_ROOT, 'target.png'))
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toFile(join(CROP_DIR, 'target-patches.png'));
}

async function writeCrops(scale) {
  mkdirSync(CROP_DIR, { recursive: true });
  for (const crop of CROPS) {
    const width = crop.x1 - crop.x0;
    const height = crop.y1 - crop.y0;
    await sharp(join(REPO_ROOT, 'target.png'))
      .extract({ left: crop.x0, top: crop.y0, width, height })
      .resize(Math.round(width * scale), Math.round(height * scale), { kernel: 'nearest' })
      .png()
      .toFile(join(CROP_DIR, `target-${crop.id}.png`));
  }
}

async function main() {
  const target = await readTarget();
  const rows = [];

  for (const patch of PATCHES) {
    const srgb = meanRect(target, patch);
    // Back through the tone curve: this is the radiance the scene has to carry
    // at that pixel, which is the number the bake is authored against.
    const radiance = agxInverse(srgb);
    rows.push({
      id: patch.id,
      kind: patch.kind,
      rect: [patch.x0, patch.y0, patch.x1, patch.y1],
      srgb: round(srgb, 4),
      hex: hex(srgb),
      radiance: round(radiance),
    });
  }

  const horizon = horizonRow();
  const palette = {
    frame: FRAME,
    horizonRow: Number(horizon.toFixed(2)),
    horizonFraction: Number((horizon / FRAME.height).toFixed(4)),
    patches: rows,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'palette.json'), `${JSON.stringify(palette, null, 2)}\n`, 'utf8');

  process.stdout.write(`horizon row ${horizon.toFixed(1)} of ${FRAME.height} `
    + `(${(horizon / FRAME.height * 100).toFixed(1)}% of frame)\n\n`);
  process.stdout.write(`  ${'patch'.padEnd(20)}${'kind'.padEnd(7)}${'hex'.padEnd(10)}radiance\n`);
  for (const row of rows) {
    process.stdout.write(`  ${row.id.padEnd(20)}${row.kind.padEnd(7)}${row.hex.padEnd(10)}`
      + `${row.radiance.map((v) => v.toFixed(4).padStart(8)).join('')}\n`);
  }

  if (!process.argv.includes('--no-crops')) {
    await writeCrops(2);
    await writeOverlay();
    process.stdout.write(`\ncrops: ${CROP_DIR}\n`);
  }
  process.stdout.write(`palette: ${join(OUT_DIR, 'palette.json')}\n`);
}

// Importable: other tools read PATCHES without re-running the sampling, which
// would rewrite the palette as a side effect of asking what is in it.
if (process.argv[1] && process.argv[1].endsWith('sample-target.mjs')) await main();
