// Tiling value noise.
//
// The stone is painted once and repeated over every face of every block, so the
// pattern has to close on itself: the noise lattice wraps at a period given by
// the caller, which is what stops a seam appearing down the middle of a face
// where one repeat meets the next.

export function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

const wrap = (i, period) => ((i % period) + period) % period;

/** Value noise on a lattice that repeats every `period` cells. */
export function noise(x, y, period) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const x0 = wrap(ix, period);
  const x1 = wrap(ix + 1, period);
  const y0 = wrap(iy, period);
  const y1 = wrap(iy + 1, period);
  const a = hash2(x0, y0);
  const b = hash2(x1, y0);
  const c = hash2(x0, y1);
  const d = hash2(x1, y1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** Summed octaves, each one wrapping at its own doubled period. */
export function fbm(x, y, period, octaves) {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * frequency, y * frequency, period * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

/** Ridged noise: the folded absolute value, which is what draws veins. */
export function ridge(x, y, period, octaves) {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let o = 0; o < octaves; o++) {
    const n = Math.abs(noise(x * frequency, y * frequency, period * frequency) * 2 - 1);
    sum += (1 - n) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

export const smoothstep = (a, b, t) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

export const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
