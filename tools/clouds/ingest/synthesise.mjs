// Plates whose answer is known, so that the chain can be measured before the
// real ones arrive.
//
//   node tools/clouds/ingest/synthesise.mjs --out <dir> [--noise 0.8]
//
// The chain that follows has no ground truth of its own: given a photograph it
// produces a coverage, and there is nothing to compare that coverage to except
// the eye. So the coverage is DECIDED here first, a plate is composited from it
// against a sky with a gradient and a halo in it, and everything downstream is
// then answering a question whose answer is on disk.
//
// What the plates are built to have, because they are the properties the chain
// is judged on:
//   — a sky that is not flat: a vertical gradient and a broad brightening round
//     the sun, which is what a clear sky with the light behind the subject does
//     and what a constant background colour cannot represent;
//   — a fringe, and a lot of it: the coverage runs smoothly to nothing over
//     tens of texels, so the share of the cloud under half thickness is in the
//     region the reference's own is, and a chain that cuts it shows up as a
//     number rather than as a disappointment three weeks later;
//   — bodies that are separate, so the separation has something to separate,
//     and one body deliberately running off the edge of the frame, so the rule
//     that discards a cut body has something to discard;
//   — grain, because a real plate has some and the coverage of a veil is the
//     first thing it eats.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeCleanPng } from '../../grade/lib/png.mjs';
import { linearToSrgb } from '../../grade/lib/color.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1];
};
const OUT = opt('out', null);
if (!OUT) { console.error('usage: synthesise.mjs --out <dir> [--noise levels]'); process.exit(1); }
// In display levels, one sigma. Not zero: the grain of a real plate is the
// floor under every coverage this chain can claim, and a validation run on a
// noiseless plate would report a floor that does not exist.
const NOISE = Number(opt('noise', 0.8)) / 255;
const WIDTH = Number(opt('width', 1536));
const HEIGHT = Number(opt('height', 1024));

mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ the noise

const hash = (x, y, seed) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const fade = (t) => t * t * (3 - 2 * t);
function value(x, y, seed) {
  const xi = Math.floor(x); const yi = Math.floor(y);
  const fx = fade(x - xi); const fy = fade(y - yi);
  const a = hash(xi, yi, seed); const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed); const d = hash(xi + 1, yi + 1, seed);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
function fbm(x, y, seed, octaves = 6) {
  let sum = 0; let amp = 0.5; let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * value(x * f, y * f, seed + o * 71);
    f *= 2.03;
    amp *= 0.52;
  }
  return sum / 0.98;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// -------------------------------------------------------------------- the sky
//
// Two terms. A vertical ramp, because a clear sky is deepest at the zenith and
// pales towards the horizon; and a broad halo round the sun, because the sun is
// behind the cloud in every one of these sources and the air near it forward
// scatters. Both are smooth and neither is a plane — which is the point: they
// are what a background estimate has to be able to follow.
function skyAt(x, y, sun) {
  const v = y / HEIGHT;
  const deep = [0.055, 0.115, 0.290];
  const pale = [0.150, 0.230, 0.400];
  const d = Math.hypot((x - sun[0]) / WIDTH, (y - sun[1]) / HEIGHT);
  const halo = 0.55 * Math.exp(-((d / 0.42) ** 2));
  return deep.map((c, i) => {
    const base = c + (pale[i] - c) * smoothstep(0, 1, v);
    return base + halo * [0.30, 0.30, 0.26][i];
  });
}

// ------------------------------------------------------------------ the cloud

/**
 * One body: a coverage that runs to nothing at its own edge, and the colour of
 * a cloud lit from behind — a warm bright rim where it is thin, a cool grey
 * belly where it is deep.
 */
function body(x, y, spec) {
  const {
    cx, cy, rx, ry, seed, scale, gain, roughness, opacity = 3.4,
  } = spec;
  const nx = (x - cx) / rx;
  const ny = (y - cy) / ry;
  // The envelope is raised to a power under one so the body is flat topped and
  // falls away over a long skirt, which is where a bank's veil lives.
  const r = Math.hypot(nx, ny);
  const envelope = Math.max(0, 1 - r ** 1.4);
  if (envelope <= 0) return { alpha: 0, colour: [0, 0, 0], depth: 0 };
  const n = fbm(x / scale, y / scale * (1 + roughness), seed);
  const warp = fbm(x / (scale * 0.37) + 13.7, y / (scale * 0.37), seed + 991) - 0.5;
  const density = Math.max(0, (n + 0.35 * warp - 0.42) * gain) * envelope ** 1.6;
  // Thickness, not a mask: the coverage of a texel is what the light loses
  // through it, and an exponential of the density is what that is.
  const alpha = 1 - Math.exp(-opacity * density);
  const depth = smoothstep(0.03, 0.55, density);
  const rim = [1.00, 0.985, 0.945];
  const belly = [0.300, 0.330, 0.395];
  const level = 1.35 * (1 - 0.80 * depth);
  return { alpha, colour: rim.map((c, i) => level * (c + (belly[i] - c) * depth)), depth };
}

const PLATES = [
  {
    id: 'sintetica-01-banco',
    // The hero shape: one bank spread across the frame, long skirts either
    // side, the sun behind its middle.
    sun: [0.50, 0.42],
    bodies: [
      {
        cx: 0.46, cy: 0.50, rx: 0.40, ry: 0.24, seed: 11, scale: 150, gain: 2.6, roughness: 0.7, opacity: 13,
      },
      {
        cx: 0.66, cy: 0.44, rx: 0.24, ry: 0.19, seed: 27, scale: 96, gain: 2.3, roughness: 0.4, opacity: 13,
      },
    ],
  },
  {
    id: 'sintetica-02-cumuli',
    // Three separated bodies — and a fourth walking off the right edge, which
    // the chain has to throw away by itself.
    sun: [0.42, 0.34],
    bodies: [
      {
        cx: 0.22, cy: 0.40, rx: 0.15, ry: 0.14, seed: 5, scale: 78, gain: 2.5, roughness: 0.3, opacity: 9,
      },
      {
        cx: 0.50, cy: 0.62, rx: 0.13, ry: 0.11, seed: 41, scale: 66, gain: 2.4, roughness: 0.5, opacity: 9,
      },
      {
        cx: 0.72, cy: 0.35, rx: 0.12, ry: 0.13, seed: 83, scale: 70, gain: 2.6, roughness: 0.2, opacity: 9,
      },
      {
        cx: 1.02, cy: 0.68, rx: 0.16, ry: 0.15, seed: 97, scale: 80, gain: 2.7, roughness: 0.4, opacity: 9,
      },
    ],
  },
  {
    id: 'sintetica-03-veli',
    // Veil almost all the way down: thin sheets whose coverage rarely reaches a
    // third. Nothing in the chain may treat this as empty sky.
    sun: [0.55, 0.30],
    bodies: [
      {
        cx: 0.40, cy: 0.45, rx: 0.42, ry: 0.16, seed: 61, scale: 210, gain: 0.85, roughness: 1.1,
      },
      {
        cx: 0.66, cy: 0.60, rx: 0.30, ry: 0.12, seed: 73, scale: 170, gain: 0.75, roughness: 0.9,
      },
    ],
  },
];

// A deterministic pair of normal draws, so two runs of this tool make the same
// plate: a validation whose input moves is a validation nobody can repeat.
function grain(i, seed) {
  const u = Math.max(1e-7, hash(i % 4096, Math.floor(i / 4096), seed));
  const v = hash(i % 4096, Math.floor(i / 4096), seed + 7717);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

for (const plate of PLATES) {
  const N = WIDTH * HEIGHT;
  const alpha = new Float32Array(N);
  const premul = new Float32Array(N * 3);
  const sky = new Float32Array(N * 3);
  const image = Buffer.alloc(N * 3);
  const sun = [plate.sun[0] * WIDTH, plate.sun[1] * HEIGHT];
  const specs = plate.bodies.map((b) => ({
    ...b, cx: b.cx * WIDTH, cy: b.cy * HEIGHT, rx: b.rx * WIDTH, ry: b.ry * HEIGHT,
  }));

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = y * WIDTH + x;
      const s = skyAt(x + 0.5, y + 0.5, sun);
      // Bodies composited over one another in order, which is what makes the
      // truth a composite rather than a sum: a texel covered twice is covered
      // once each time, and the coverage that comes out is what the light lost.
      let a = 0;
      const c = [0, 0, 0];
      for (const spec of specs) {
        const b = body(x + 0.5, y + 0.5, spec);
        if (b.alpha <= 0) continue;
        for (let k = 0; k < 3; k++) c[k] = b.alpha * b.colour[k] + (1 - b.alpha) * c[k];
        a = b.alpha + (1 - b.alpha) * a;
      }
      alpha[i] = a;
      for (let k = 0; k < 3; k++) {
        premul[i * 3 + k] = c[k];
        sky[i * 3 + k] = s[k];
        const lit = c[k] + (1 - a) * s[k];
        const display = linearToSrgb(Math.max(0, Math.min(1, lit)))
          + NOISE * grain(i * 3 + k, 5501);
        image[i * 3 + k] = Math.max(0, Math.min(255, Math.round(display * 255)));
      }
    }
  }

  const png = join(OUT, `${plate.id}.png`);
  const bytes = await writeCleanPng(image, { width: WIDTH, height: HEIGHT, channels: 3 }, png);

  // The truth, as it was BEFORE the plate was quantised and grained: what the
  // chain is asked to recover is the composite that was made, not the file it
  // was made into.
  const truth = Buffer.alloc((N + N * 3 + N * 3) * 4);
  Buffer.from(alpha.buffer).copy(truth, 0);
  Buffer.from(premul.buffer).copy(truth, N * 4);
  Buffer.from(sky.buffer).copy(truth, N * 4 + N * 12);
  writeFileSync(join(OUT, `${plate.id}.truth`), truth);
  writeFileSync(join(OUT, `${plate.id}.truth.json`), JSON.stringify({
    id: plate.id,
    width: WIDTH,
    height: HEIGHT,
    noiseLevels: NOISE * 255,
    // Where the light was, as the ingest will be told it: the sun sits behind
    // the mass, so its bearing is the plate's own and its height is the one the
    // roster declares.
    sun: { x: plate.sun[0], y: plate.sun[1] },
    layout: 'float32: alpha[N], premultiplied rgb[3N], sky rgb[3N]',
  }, null, 2));

  let veil = 0; let live = 0;
  for (let i = 0; i < N; i++) {
    if (alpha[i] <= 3 / 255) continue;
    live++;
    if (alpha[i] < 0.5) veil++;
  }
  process.stdout.write(`${plate.id}: ${WIDTH}x${HEIGHT} ${bytes} B, `
    + `${(100 * live / N).toFixed(1)}% of the frame carries cloud, `
    + `veil ${(100 * veil / live).toFixed(1)}% of it\n`);
}
