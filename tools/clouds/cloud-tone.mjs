// How light becomes picture, for a cloud that has to survive a day.
//
// WHAT THIS REPLACES. The prototype that produced these volumes shaded them
// through a RANK MATCH: it sorted a piece's illumination and laid the reference
// photograph's radiance-by-rank onto that order, so the output histogram was
// the photograph's whatever went in. Three sessions of experiments all reported
// the same L2/L50/L98, 131/197/235, which is not a coincidence, it is the
// curve. It is fatal twice over. It hides shape — the transported light at the
// production plane averages 0.15 against 0.47 front-lit, and the rank match
// erases exactly that difference, so a mass looked identical from three
// directions a hundred degrees apart. And it forbids weather — thirteen sun
// planes each matched to one histogram is a cloud equally bright at noon and at
// sunset, which is the one thing a day/night cycle may not do.
//
// WHAT IS HERE. The product's own chain and nothing else, mirroring
// src/core/post.js: radiance = EXPOSURE * illumination, then the palette's
// chromaticity, then AgX, then the sRGB encode. AgX IS the rolloff; there is no
// second curve, no per-piece fit and no per-plane fit. The whole transform has
// ONE free constant, and a plane's brightness therefore depends on the light
// rather than on the statistics of the piece it belongs to.

import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { agx } from '../grade/lib/agx.mjs';
import { linearToSrgb, srgbToLinear } from '../grade/lib/color.mjs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CLOUDS = JSON.parse(readFileSync(`${ROOT}assets-src/clouds/clouds.json`, 'utf8'));

/**
 * The exposure, fitted ONCE and then frozen.
 *
 * Deliberately poor in degrees of freedom: one number, fitted on the plane the
 * world is actually lit by, on the largest piece, against the target's own
 * display palette — and every other piece and plane rendered through it
 * untouched. Anything with more freedom starts absorbing the differences
 * between planes again, which is the failure this file exists to undo.
 *
 * At 12.0 the production plane reads L2/L50/L98 = 163/191/246 against the
 * target bank's 160/202/235 and the photographic bank's 162/214/245: in family
 * on palette, which is the criterion the committente set, and not on pixels,
 * which is the criterion he withdrew.
 */
export const EXPOSURE = 12.0;

/** The sky's own contribution: the other light, and it does not turn with the sun. */
export const AMB_BASE = 0.030;
export const AMB_RANGE = 0.175;

/**
 * Illumination of one texel under one sun plane.
 *
 * The sky term must NOT be folded into the exposure. It is what keeps the
 * darkest parts of a piece put while the lit parts move across the ring, which
 * is the difference between a cloud in changing light and a cloud on a dimmer.
 */
export function illuminate(ch, K, k, i, mix) {
  return ch.lit[i * K + k]
    + AMB_BASE + AMB_RANGE * ch.ao[i] * (0.50 + 0.50 * ch.normal[i * 3 + 1])
    + (ch.surfA ? mix.cA * ch.surfA[i * K + k] + mix.cB * ch.surfB[i * K + k] : 0);
}

let PALETTE = null;

/**
 * The chromaticity the delivered clouds live in, read off the shipped atlas:
 * for each luminance, the hue the reference material has there. This is a
 * PALETTE anchor and not a tone curve — it says what colour a cloud of a given
 * brightness is, never how bright a cloud should be.
 */
export async function palette() {
  if (PALETTE) return PALETTE;
  const { data, info } = await sharp(`${ROOT}assets-src/clouds/cloud-sprites.png`)
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const level = CLOUDS.atlas.levelScale;
  const pool = [];
  for (const t of CLOUDS.tiles) {
    const { x, y, width: w, height: h } = t.rect;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const s = ((y + j) * info.width + x + i) * 4;
        const a = data[s + 3] / 255;
        if (a < 0.5) continue;
        const u = [0, 1, 2].map((c) => srgbToLinear(data[s + c] / 255) * level / a);
        const yy = 0.2126 * u[0] + 0.7152 * u[1] + 0.0722 * u[2];
        if (yy > 1e-5) pool.push([yy, u[0] / yy, u[1] / yy, u[2] / yy]);
      }
    }
  }
  pool.sort((a, b) => a[0] - b[0]);
  const rows = [];
  for (let q = 0; q < 32; q++) {
    const lo = Math.floor(q / 32 * pool.length); const hi = Math.floor((q + 1) / 32 * pool.length);
    let s = [0, 0, 0, 0];
    for (let i = lo; i < hi; i++) s = s.map((v, c) => v + pool[i][c]);
    rows.push(s.map((v) => v / (hi - lo)));
  }
  const tint = (y, out) => {
    let i = 1;
    while (i < rows.length - 1 && y > rows[i][0]) i++;
    const a = rows[i - 1]; const b = rows[i];
    const t = Math.min(1, Math.max(0, (y - a[0]) / Math.max(1e-6, b[0] - a[0])));
    for (let c = 0; c < 3; c++) out[c] = y * (a[c + 1] + (b[c + 1] - a[c + 1]) * t);
    return out;
  };
  PALETTE = { tint };
  return PALETTE;
}

/** Scene radiance to display level, the way the frame is built: AgX then sRGB. */
export function toDisplay(rgb) {
  const t = agx(rgb, 1);
  return t.map((v) => linearToSrgb(Math.min(1, Math.max(0, v))) * 255);
}

/**
 * Premultiplied display RGBA for one sun plane — the bytes an atlas tile holds.
 *
 * This is a PREVIEW, not the delivered asset. What ships is the channels; a
 * cloud whose colour is baked cannot be relit, which is the whole point.
 */
export function render(ch, head, k, tint, mix, exposure = EXPOSURE) {
  const N = head.width * head.height; const K = head.suns.length;
  const img = new Uint8Array(N * 4);
  const c = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const a = ch.alpha[i];
    if (a <= 0.002) continue;
    tint(illuminate(ch, K, k, i, mix) * exposure, c);
    const d = toDisplay([c[0] * a, c[1] * a, c[2] * a]);
    img[i * 4] = d[0]; img[i * 4 + 1] = d[1]; img[i * 4 + 2] = d[2];
    img[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
  }
  return img;
}

/** Mean display luminance over the body: what a sun plane is worth, in one number. */
export function meanL(img, alpha) {
  let s = 0; let n = 0;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] <= 0.85) continue;
    s += 0.2126 * img[i * 4] + 0.7152 * img[i * 4 + 1] + 0.0722 * img[i * 4 + 2]; n++;
  }
  return s / Math.max(1, n);
}
