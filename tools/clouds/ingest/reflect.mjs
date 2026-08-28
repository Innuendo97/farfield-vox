// Step six: the same weather, laid down once against direction, for the water.
//
//   node tools/clouds/ingest/reflect.mjs --atlas <dir> --out <dir>
//
// The water and the wet stone reflect the sky, and the sky they can reach is
// the dome — which carries no cloud, because the cloud is drawn as bodies
// standing in front of it. Reading those bodies per reflected ray is not
// available at any price: it is a couple of dozen quads to intersect per
// fragment and the fragments in question are the whole meadow. So the field is
// laid down here into a picture indexed by direction, and every reflecting
// surface reads it with the one tap it already takes for the sky.
//
// IT IS THE SAME FIELD AND NOT A LIKENESS OF ONE. Same tiles, same placements,
// same order back to front, same relighting ratio, same level scale, same
// transfer function — because a surface compositing this over the dome has to
// arrive where a surface looking at the sprites arrives. Every one of those is
// read out of the delivered atlas and its manifest rather than restated, so
// this cannot come to disagree with what the sprites draw.
//
// Coarse on purpose: a third of a degree a texel against the atlas's twentieth,
// because a rippled surface a few pixels across does not resolve a cauliflower
// and because the whole point is that it costs one tap and a tenth of a
// megabyte.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { writeCleanPng } from '../../grade/lib/png.mjs';
import { linearToSrgb, srgbToLinear } from '../../grade/lib/color.mjs';
import { basisOf } from './lib/pieces.mjs';

const DEG = Math.PI / 180;
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1];
};
const ATLAS_DIR = opt('atlas', null);
const OUT = opt('out', null);
if (!ATLAS_DIR || !OUT) {
  console.error('usage: reflect.mjs --atlas <dir> --out <dir> [--size 1024] [--samples 3]');
  process.exit(1);
}

const SIZE = Number(opt('size', 1024));
const HEIGHT = SIZE / 2;
// Samples a texel, per axis. At one sample this picture is the sprites aliased,
// and aliasing in a reflection reads as a shimmer when the eye turns.
const SAMPLES = Number(opt('samples', 3));

const manifest = JSON.parse(readFileSync(join(ATLAS_DIR, 'clouds.json'), 'utf8'));
const imagePath = join(ATLAS_DIR, 'cloud-sprites.png');
if (!existsSync(imagePath)) throw new Error(`no atlas image at ${imagePath}`);
const { data: atlas, info } = await sharp(imagePath).raw()
  .toBuffer({ resolveWithObject: true });
const AW = info.width;
const AH = info.height;

// The atlas holds colour through the sRGB transfer against one level scale, and
// coverage linear in the fourth channel. Decoded once here rather than per
// sample: this reads every texel of every tile several times over.
const rgb = new Float32Array(AW * AH * 3);
const cover = new Float32Array(AW * AH);
for (let i = 0; i < AW * AH; i++) {
  for (let k = 0; k < 3; k++) rgb[i * 3 + k] = srgbToLinear(atlas[i * 4 + k] / 255);
  cover[i] = atlas[i * 4 + 3] / 255;
}

const tiles = new Map(manifest.tiles.map((t) => [t.id, t]));
const shade = manifest.shade;
const sun = manifest.sun.vector;

/** The shading a piece's own coverage implies — src/world/clouds.js, shadeOf. */
function shadeOf(gx, gy, c, s) {
  const n = Math.hypot(-gx, -gy, 1);
  const lambert = Math.max(0, (-gx * s[0] - gy * s[1] + s[2]) / n);
  const forward = Math.max(0, s[2]);
  const rim = 1 - Math.min(1, c);
  return shade.ambient + shade.diffuse * lambert
    + shade.forward * forward * forward * (0.35 + rim * rim);
}

/** The sun in the local frame of a bearing and a height. */
function sunLocal(azimuth, elevation) {
  const b = basisOf(azimuth, elevation);
  const dot = (v) => v[0] * sun[0] + v[1] * sun[1] + v[2] * sun[2];
  return [dot(b.right), dot(b.up), dot(b.forward)];
}

// Far first, exactly as planField orders them: a piece low in the sky is
// further away than a piece high in it, so the high one goes over the top.
const field = (manifest.placements || []).map((p) => {
  const tile = tiles.get(p.tile);
  if (!tile) throw new Error(`the composition stands "${p.tile}", which the atlas does not hold`);
  const scale = p.scale === undefined ? 1 : p.scale;
  return {
    ...p,
    tile,
    scale,
    basis: basisOf(p.azimuth, p.elevation),
    halfU: tile.halfU * scale,
    halfV: tile.halfV * scale,
    vSun: sunLocal(p.azimuth, p.elevation),
    // Per degree of sky where the sprite now stands, which is what the vertex
    // shader hands the fragment.
    slope: shade.normalSlope / (2 * tile.degPerTexel * scale),
  };
}).sort((a, b) => a.elevation - b.elevation);

/** Bilinear coverage and premultiplied colour, in the tile's own rectangle. */
function readAt(tile, u, v, out) {
  const x = Math.min(tile.rect.width - 1.001, Math.max(0, u * tile.rect.width - 0.5));
  const y = Math.min(tile.rect.height - 1.001, Math.max(0, v * tile.rect.height - 0.5));
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const fx = x - x0; const fy = y - y0;
  const w = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  const o = [
    (tile.rect.y + y0) * AW + tile.rect.x + x0,
    (tile.rect.y + y0) * AW + tile.rect.x + x0 + 1,
    (tile.rect.y + y0 + 1) * AW + tile.rect.x + x0,
    (tile.rect.y + y0 + 1) * AW + tile.rect.x + x0 + 1,
  ];
  let a = 0;
  out[0] = 0; out[1] = 0; out[2] = 0;
  for (let n = 0; n < 4; n++) {
    a += w[n] * cover[o[n]];
    for (let k = 0; k < 3; k++) out[k] += w[n] * rgb[o[n] * 3 + k];
  }
  return a;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const texel = [0, 0, 0];

/** What one placement puts in one direction, premultiplied. */
function sample(p, d, out) {
  const dz = dot(d, p.basis.forward);
  if (dz <= 1e-3) return 0;
  const a = (dot(d, p.basis.right) / dz) / p.halfU;
  const c = (dot(d, p.basis.up) / dz) / p.halfV;
  if (Math.abs(a) > 1 || Math.abs(c) > 1) return 0;
  const cos = Math.cos((p.roll || 0) * DEG);
  const sin = Math.sin((p.roll || 0) * DEG);
  const s = (a * cos + c * sin) * (p.flip || 1);
  const t = -a * sin + c * cos;
  if (Math.abs(s) > 1 || Math.abs(t) > 1) return 0;
  const u = (s + 1) / 2;
  const v = (1 - t) / 2;
  const alpha = readAt(p.tile, u, v, texel);
  if (alpha <= 0) return 0;
  out[0] = texel[0] * manifest.atlas.levelScale;
  out[1] = texel[1] * manifest.atlas.levelScale;
  out[2] = texel[2] * manifest.atlas.levelScale;
  // The relighting the fragment applies: the ratio of two shadings of the
  // surface this coverage implies, one under the sun the piece stands in and
  // one under the sun it was photographed in. Four reads of the coverage, in
  // the tile's own texels, exactly as the shader takes them.
  const du = 1 / p.tile.rect.width;
  const dv = 1 / p.tile.rect.height;
  const left = readAt(p.tile, Math.max(0, u - du), v, texel);
  const right = readAt(p.tile, Math.min(1, u + du), v, texel);
  const up = readAt(p.tile, u, Math.max(0, v - dv), texel);
  const down = readAt(p.tile, u, Math.min(1, v + dv), texel);
  const gx = (right - left) * p.slope;
  const gy = (up - down) * p.slope;
  const tx = gx * (p.flip || 1);
  const turnedX = tx * cos - gy * sin;
  const turnedY = tx * sin + gy * cos;
  const ratio = shadeOf(turnedX, turnedY, alpha, p.vSun)
    / Math.max(0.05, shadeOf(gx, gy, alpha, p.tile.sunSource));
  for (let k = 0; k < 3; k++) out[k] *= ratio;
  return alpha;
}

const acc = new Float32Array(SIZE * HEIGHT * 4);
const one = [0, 0, 0];
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0; let g = 0; let b = 0; let a = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const u = (x + (sx + 0.5) / SAMPLES) / SIZE;
        const v = (y + (sy + 0.5) / SAMPLES) / HEIGHT;
        // The convention of src/core/sky.js: u wraps about Y from +X, v is the
        // sine of the elevation, so north lands at a quarter.
        const phi = (u - 0.5) * 2 * Math.PI;
        const theta = (v - 0.5) * Math.PI;
        const d = [Math.cos(theta) * Math.cos(phi), Math.sin(theta),
          Math.cos(theta) * Math.sin(phi)];
        let cr = 0; let cg = 0; let cb = 0; let ca = 0;
        for (const p of field) {
          const alpha = sample(p, d, one);
          if (alpha <= 0) continue;
          cr = cr * (1 - alpha) + one[0];
          cg = cg * (1 - alpha) + one[1];
          cb = cb * (1 - alpha) + one[2];
          ca = ca * (1 - alpha) + alpha;
        }
        r += cr; g += cg; b += cb; a += ca;
      }
    }
    const n = SAMPLES * SAMPLES;
    const i = (y * SIZE + x) * 4;
    acc[i] = r / n; acc[i + 1] = g / n; acc[i + 2] = b / n; acc[i + 3] = a / n;
  }
}

const image = Buffer.alloc(SIZE * HEIGHT * 4);
for (let i = 0; i < SIZE * HEIGHT; i++) {
  for (let k = 0; k < 3; k++) {
    const value = Math.max(0, Math.min(1, acc[i * 4 + k] / manifest.atlas.levelScale));
    image[i * 4 + k] = Math.round(linearToSrgb(value) * 255);
  }
  image[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(acc[i * 4 + 3] * 255)));
}
mkdirSync(OUT, { recursive: true });
const path = join(OUT, 'cloud-equirect.png');
const bytes = await writeCleanPng(image, { width: SIZE, height: HEIGHT, channels: 4 }, path);
let covered = 0;
for (let i = 0; i < SIZE * HEIGHT; i++) covered += acc[i * 4 + 3] > 0.5 ? 1 : 0;
process.stdout.write(`${field.length} placement(s) -> ${SIZE}x${HEIGHT}, `
  + `${(bytes / 1024).toFixed(0)} KiB, ${(100 * covered / (SIZE * HEIGHT)).toFixed(1)} `
  + `per cent of the sphere over half coverage\n${path}\n`);
