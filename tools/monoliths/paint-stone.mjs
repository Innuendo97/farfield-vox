import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../grade/lib/framing.mjs';
import { linearToSrgb } from '../grade/lib/color.mjs';
import { writeCleanPng } from '../grade/lib/png.mjs';
import { STONE_TILE } from './plan.mjs';
import {
  fbm, mix, noise, ridge, smoothstep,
} from './lib/noise.mjs';

// Paints the stone of the monoliths: one tiling sheet of albedo and one of
// relief, repeated over every face of every block.
//
// Same division of labour as the meadow. This is the rock with the light taken
// out of it; the light arrives from the Cycles bake on the second set of texture
// coordinates and the two are multiplied at draw time. The relief carries what
// the light map is far too coarse to hold — the weathering, the chipped arris,
// the hairline cracks — as a height field the shader turns back into a normal.
//
// Written down rather than taken from a scan. The reference stone is mottled at
// a scale of roughly a third of a metre with no bedding planes and no visible
// grain direction, which is a hard thing to find in a photographed surface and
// a very easy one to put in arithmetic; and a sheet built this way tiles
// exactly, which a photograph never does without retouching.

const OUT_DIR = join(REPO_ROOT, 'assets-src', 'monoliths');
const SIZE = Number(process.argv.find((a) => a.startsWith('--size='))?.slice(7) || 512);

// Lattice cells across the sheet. Everything is expressed in these, so the
// pattern is the same physical size whatever resolution the sheet is painted at.
const PERIOD = 8;

// Albedo of the rock, as linear reflectance.
//
// The reference blocks are a blue grey stone, and the two values below are the
// extremes of its mottling rather than a mean: the sheet spends most of its area
// between them. They are dark — the engraved faces in the reference sit at
// around a twentieth of the light they receive — and they are cool, with blue
// half again as strong as red, which is what stops the stone reading as concrete
// once the blue sky light lands on it.
//
// Fitted against the frame rather than chosen: the value below is what the
// measured radiance of the five engraved faces asks for, divided by the light
// the bake puts on them. See tools/monoliths/sample-stone.mjs.
const STONE_PALE = [0.089, 0.104, 0.129];
const STONE_MID = [0.058, 0.070, 0.092];
const STONE_DARK = [0.034, 0.042, 0.058];

// Iron staining: the reference shows a faint warm bloom on the weathered
// patches of the taller blocks. It is barely a tint, but without it the stone is
// a uniform blue and reads as painted metal.
const STAIN = [0.086, 0.076, 0.070];

/** Height field of the surface, in millimetres of relief. */
function relief(u, v) {
  const x = u * PERIOD;
  const y = v * PERIOD;

  // Broad weathering: the shallow dishing that makes a face read as worn.
  const broad = fbm(x * 0.55, y * 0.55, Math.max(1, Math.round(PERIOD * 0.55)), 3);
  // Medium break up, and a fine grain on top of it.
  const medium = fbm(x * 2.1, y * 2.1, PERIOD * 2, 3);
  const grain = noise(x * 9.0, y * 9.0, PERIOD * 9);

  let h = (broad - 0.5) * 3.4 + (medium - 0.5) * 1.5 + (grain - 0.5) * 0.5;

  // Hairline cracks. A ridged field is thresholded so only the very crest of it
  // survives, which leaves a network of thin lines rather than a field of
  // veins, and the lines are cut into the surface rather than raised on it.
  const veins = ridge(x * 1.15 + 3.5, y * 0.62 + 1.25, PERIOD, 3);
  const crack = smoothstep(0.86, 0.995, veins);
  h -= crack * 0.9;

  // Chipping, where a flake has come away and left a shallow scar.
  const chip = fbm(x * 3.3 + 11, y * 3.3 + 5, PERIOD * 3, 2);
  h -= smoothstep(0.72, 0.9, chip) * 1.1;

  return h;
}

function main() {
  const albedo = Buffer.alloc(SIZE * SIZE * 3);
  const normal = Buffer.alloc(SIZE * SIZE * 3);
  const started = Date.now();

  // Metres per texel, needed to turn the height field into a slope: a normal
  // map is a gradient, and a gradient has units.
  const metresPerTexel = STONE_TILE / SIZE;

  const height = new Float32Array(SIZE * SIZE);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      height[py * SIZE + px] = relief((px + 0.5) / SIZE, (py + 0.5) / SIZE);
    }
  }

  for (let py = 0; py < SIZE; py++) {
    const v = (py + 0.5) / SIZE;
    for (let px = 0; px < SIZE; px++) {
      const u = (px + 0.5) / SIZE;
      const x = u * PERIOD;
      const y = v * PERIOD;

      // ------------------------------------------------------------- colour
      const patch = fbm(x * 0.7 + 21, y * 0.7 + 9, Math.max(1, Math.round(PERIOD * 0.7)), 3);
      const fine = fbm(x * 3.7 + 61, y * 3.7 + 33, PERIOD * 4, 3);

      let colour = mix(STONE_DARK, STONE_MID, smoothstep(0.30, 0.66, patch));
      colour = mix(colour, STONE_PALE, smoothstep(0.58, 0.92, patch * 0.55 + fine * 0.45));
      colour = mix(colour, STAIN, smoothstep(0.66, 0.94, fine) * 0.35);

      // The rim of a weathered patch, which the reference draws as a thin pale
      // line rather than as a soft edge: where a flake has lifted, the arris it
      // leaves behind is fresh rock and catches the sky. Without it the stone
      // is a cloud of blur at any distance the walker can read it from.
      const edge = 1 - Math.min(1, Math.abs(patch - 0.62) / 0.035);
      if (edge > 0) colour = mix(colour, STONE_PALE, edge * 0.55);

      // Grit: single bright texels, sparse enough to read as mica rather than
      // as noise.
      const speck = noise(x * 27 + 5, y * 27 + 91, PERIOD * 27);
      colour = colour.map((c) => c * (1 + 1.1 * smoothstep(0.955, 0.995, speck)));

      // A crack is dark because it is a slot the sky cannot reach into, not
      // because the rock inside it is a different colour: this is the occlusion
      // of the groove, painted in because the light map cannot resolve it.
      const h = height[py * SIZE + px];
      const cavity = smoothstep(0.0, -2.2, h);
      colour = colour.map((c) => c * (1 - 0.55 * cavity));

      // And the crests catch a little more of everything.
      colour = colour.map((c) => c * (1 + 0.16 * smoothstep(0.4, 2.2, h)));

      const o = (py * SIZE + px) * 3;
      for (let c = 0; c < 3; c++) {
        albedo[o + c] = Math.round(Math.min(1, Math.max(0, linearToSrgb(colour[c]))) * 255);
      }

      // ------------------------------------------------------------- relief
      // Central differences on the wrapped field, in metres of rise per metre
      // of run: the height is stored in millimetres, hence the thousandth.
      const left = height[py * SIZE + ((px - 1 + SIZE) % SIZE)];
      const right = height[py * SIZE + ((px + 1) % SIZE)];
      const down = height[((py - 1 + SIZE) % SIZE) * SIZE + px];
      const up = height[((py + 1) % SIZE) * SIZE + px];
      const dx = (right - left) / 1000 / (2 * metresPerTexel);
      const dy = (up - down) / 1000 / (2 * metresPerTexel);
      const length = Math.hypot(-dx, -dy, 1);
      normal[o] = Math.round((-dx / length * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round((-dy / length * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
    }
  }

  process.stdout.write(`painted ${SIZE}x${SIZE} in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  return { albedo, normal };
}

mkdirSync(OUT_DIR, { recursive: true });
const { albedo, normal } = main();
const a = await writeCleanPng(albedo, { width: SIZE, height: SIZE }, join(OUT_DIR, 'stone-albedo.png'));
const n = await writeCleanPng(normal, { width: SIZE, height: SIZE }, join(OUT_DIR, 'stone-normal.png'));
process.stdout.write(`stone-albedo.png ${(a / 1024).toFixed(0)} kB, `
  + `stone-normal.png ${(n / 1024).toFixed(0)} kB, ${STONE_TILE} m per repeat\n`);
