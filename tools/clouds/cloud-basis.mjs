// How a relightable cloud is compressed for the browser.
//
// THE PROBLEM THIS SOLVES. A piece that can be lit from any direction cannot
// bake its light into its colour, so it carries one channel per sun direction.
// The arc the light travels — from twelve degrees under the horizon, over the
// top at seventy five, and down through the other crossing — needs a sample
// every fifteen degrees to stay inside the campaign's four level net, which is
// sixteen channels; at 512 square that is a megabyte and a half a piece before
// coverage, and a sky of two dozen pieces is several times its whole budget.
//
// THE OBSERVATION. Those sixteen channels are not sixteen independent pictures.
// They are one cloud under a light that moves, and what moves is smooth: the
// matrix of texels by directions is very nearly low rank. So the piece ships a
// few SPATIAL MAPS and a COEFFICIENT CURVE per map, and the illumination at any
// direction on the arc is the maps combined with the curve read at that
// direction.
//
// What that buys is not only size. Angular resolution becomes free: a shipped
// plane buys one sun direction with a whole image, a coefficient buys one with a
// number, so the curve can be sampled as finely as anyone likes and the atlas
// does not notice. And at runtime the angular part is R uniforms and a dot
// product — no extra texture read, and no interpolation between two atlas
// planes, which is what the fifteen degree ring would have cost.
//
// WHY THE LOGARITHM. The fit is made on the log of the illumination, and this is
// the load-bearing choice. Fitted on the illumination itself, an unconstrained
// least-squares approximation of a NON-NEGATIVE quantity puts a third of a
// piece's body below zero at rank three, and the tone curve floors every one of
// those texels at black — the error in illumination was small and orderly the
// whole time, and what was not small was what the curve then did with its sign.
// In the log the reconstruction is positive by construction; AgX is a
// log-domain curve, so a least-squares fit there is very nearly a fit of display
// levels, which is what the four level net is written in; and rank one in the
// log is a PRODUCT in the linear — matter that does not change times a factor
// that does — so the separable case is the first term rather than a special one.
//
// WHY NOT SPHERICAL HARMONICS. They were tried, over the whole sphere of sun
// directions, and measured 21 to 28 levels on the self-shadowing. Three things
// differ here and each is worth an order of magnitude: the domain is a CURVE and
// not a surface, so no term is spent on directions the light never visits; the
// basis is FITTED and not assumed, so a terminator sweeping across a billow is
// described by the first components instead of defeating a fixed smooth basis;
// and the fit is weighted so that a unit of residual is priced in display levels
// wherever it falls, instead of being spent on crowns where nothing can see it.

import { agx } from '../grade/lib/agx.mjs';
import { linearToSrgb, srgbToLinear } from '../grade/lib/color.mjs';

// --------------------------------------------------------------- linear algebra

/**
 * Symmetric eigendecomposition by cyclic Jacobi, largest eigenvalue first.
 *
 * The matrix is the directions by directions Gram of the arc — sixteen by
 * sixteen at the most — so an iterative method that is short and obviously
 * correct is worth more here than a fast one.
 */
export function jacobi(Ain, n, sweeps = 60) {
  const A = Float64Array.from(Ain);
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let s = 0; s < sweeps; s++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] ** 2;
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-30) continue;
        const theta = (A[q * n + q] - A[p * n + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1); const sn = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p]; const akq = A[k * n + q];
          A[k * n + p] = c * akp - sn * akq; A[k * n + q] = sn * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k]; const aqk = A[q * n + k];
          A[p * n + k] = c * apk - sn * aqk; A[q * n + k] = sn * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p]; const vkq = V[k * n + q];
          V[k * n + p] = c * vkp - sn * vkq; V[k * n + q] = sn * vkp + c * vkq;
        }
      }
    }
  }
  const idx = [...Array(n).keys()].sort((a, b) => A[b * n + b] - A[a * n + a]);
  return {
    values: idx.map((i) => A[i * n + i]),
    vectors: idx.map((i) => Float64Array.from({ length: n }, (_, k) => V[k * n + i])),
  };
}

// ------------------------------------------------------------------ the weights

/**
 * What a unit of residual is worth, per texel, in display levels.
 *
 * Two factors, and leaving either out was measured breaking the fit.
 *
 * COVERAGE, because seven texels in ten of a piece's window are empty sky: they
 * hold an ambient computed from an `ao` and a `normal` that mean nothing where
 * there is no cloud, the fragment discards them, and fitted at weight one they
 * are the majority of the data and the basis describes THEM.
 *
 * THE SLOPE OF THE CURVE, because the chain is compressive: at the bright end an
 * extra unit of illumination buys almost no display level and at the dark end it
 * buys many. In the log the coordinate is ln S, so the price of a residual is
 * S * dL/dS; using the linear slope in a log fit would hand the whole basis to
 * the darkest texels. It is clamped, because near zero it runs away and a
 * handful of texels carrying a thousand times everyone else's weight is a fit of
 * those texels and of nothing else.
 */
export function toneWeights(M, N, K, cols, alpha, lum, clamp = 8) {
  const slopes = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    if (alpha[i] <= 0.002) continue;
    let s = 0;
    for (let a = 0; a < cols.length; a++) s += M[i * K + cols[a]];
    const mean = s / cols.length;
    const h = Math.max(1e-3, mean * 0.05);
    slopes[i] = Math.max(0, (lum(mean + h) - lum(mean - h)) / (2 * h)) * mean;
  }
  const pool = [];
  for (let i = 0; i < N; i += 7) if (slopes[i] > 0) pool.push(slopes[i]);
  pool.sort((a, b) => a - b);
  const med = pool[Math.floor(pool.length / 2)] || 1;
  const w = new Float64Array(N);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    w[i] = Math.min(1, Math.max(0, alpha[i])) * Math.min(slopes[i], clamp * med);
    sum += w[i];
  }
  const s = N / Math.max(1e-9, sum);
  for (let i = 0; i < N; i++) w[i] *= s;
  return w;
}

// -------------------------------------------------------------------- the fit

/** The floor under the logarithm: below this a texel is not lit by anything. */
export const LOG_FLOOR = 1e-4;

/**
 * The R best spatial maps of an illumination matrix and their coefficient at
 * every baked direction.
 *
 * Computed through the directions by directions Gram rather than by decomposing
 * a quarter of a million rows: the right singular vectors ARE the coefficients,
 * and the maps then come out of one more pass over the data.
 */
export function fitLogBasis(M, N, K, cols, R, w) {
  const C = cols.length;
  const G = new Float64Array(C * C);
  const L = new Float64Array(N * C);
  for (let i = 0; i < N; i++) {
    for (let a = 0; a < C; a++) L[i * C + a] = Math.log(Math.max(LOG_FLOOR, M[i * K + cols[a]]));
  }
  for (let i = 0; i < N; i++) {
    const wi = w[i];
    if (wi === 0) continue;
    const o = i * C;
    for (let a = 0; a < C; a++) {
      const va = L[o + a] * wi;
      for (let b = a; b < C; b++) G[a * C + b] += va * L[o + b] * wi;
    }
  }
  for (let a = 0; a < C; a++) for (let b = 0; b < a; b++) G[a * C + b] = G[b * C + a];
  const { values, vectors } = jacobi(G, C);
  const maps = [];
  for (let r = 0; r < R; r++) {
    const v = vectors[r];
    const m = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const o = i * C;
      let d = 0;
      for (let a = 0; a < C; a++) d += L[o + a] * v[a];
      m[i] = d;
    }
    maps.push(m);
  }
  return { maps, vectors: vectors.slice(0, R), values };
}

/**
 * The coefficient of every map at an arbitrary position along the arc.
 *
 * Catmull-Rom in the arc parameter, in its non-uniform form: the ring's two end
 * steps are 12.4 degrees where the rest are 15, and a uniform formula kinks
 * exactly at the horizon crossing, which is the part of the arc the night is
 * made of. Clamped at the ends, so a direction past the last sample holds the
 * last value instead of running away.
 *
 * It lives in the RUNTIME and is re-exported here. A curve is a contract
 * between the thing that fits it and the thing that reads it, and two copies of
 * an interpolation are two chances for the atlas to mean one thing offline and
 * another in the frame — which is a difference no screenshot would explain.
 */
export { coeffAt } from '../../src/world/cloud-relight.js';

// ------------------------------------------------------------ what ships, exactly
//
// A map is a log-domain quantity with a range of its own, stored in one eight
// bit channel as (m - lo) / (hi - lo). Eight bits and not sixteen because it was
// measured: against the float fit, eight bits cost one hundredth of a level. The
// stairstep argument that put sixteen bits in the SOURCE channels does not reach
// here — it was about a LINEAR channel near an illumination of 0.03, and this
// channel is logarithmic, which is the same argument answered by the encoding
// instead of by the depth.
//
// The scale and bias do not have to reach the shader. Illumination is
//   exp( sum_r ( lo_r + (hi_r - lo_r) * q_r ) * c_r )
//     = exp( sum_r lo_r c_r ) * exp( sum_r (hi_r - lo_r) c_r * q_r )
// so the first sum is one scalar per piece per direction and the rest is a dot
// product of the stored channels with R numbers. A piece therefore needs R + 1
// numbers per frame and no per-map constants at all — which is why they are
// emitted as a per-piece coefficient set rather than as texture metadata.

export function mapRange(map, alpha) {
  let lo = Infinity; let hi = -Infinity;
  for (let i = 0; i < map.length; i++) {
    if (alpha[i] <= 0.002) continue;
    if (map[i] < lo) lo = map[i];
    if (map[i] > hi) hi = map[i];
  }
  if (!(hi > lo)) hi = lo + 1e-6;
  return { lo, hi };
}

/** The R + 1 numbers a piece needs for one sun direction. */
export function shaderCoeffs(ranges, coeffs) {
  let offset = 0;
  const gain = coeffs.map((c, r) => {
    offset += ranges[r].lo * c;
    return (ranges[r].hi - ranges[r].lo) * c;
  });
  return { offset, gain };
}

// ------------------------------------------------------------- the chromaticity
//
// The palette says what colour a cloud of a given brightness is. It is a table
// of 32 rows, and a table is a texture, and a texture is a fetch this shader
// cannot afford. But it is a smooth, slowly varying thing — the hue of a cloud
// does not turn over between one level and the next — so it fits a cubic in the
// log of the luminance to well under a level, and a cubic is three multiplies.
//
// Only two of the three ratios are free: the triple is a chromaticity at a given
// luminance, so 0.2126 r + 0.7152 g + 0.0722 b = 1 holds by construction and the
// green ratio is whatever the other two leave.

const LUMA = [0.2126, 0.7152, 0.0722];

function polyFit(xs, ys, degree) {
  const n = degree + 1;
  const A = new Float64Array(n * n); const b = new Float64Array(n);
  for (let k = 0; k < xs.length; k++) {
    const p = [1];
    for (let d = 1; d < n; d++) p.push(p[d - 1] * xs[k]);
    for (let i = 0; i < n; i++) {
      b[i] += p[i] * ys[k];
      for (let j = 0; j < n; j++) A[i * n + j] += p[i] * p[j];
    }
  }
  // Gaussian elimination with partial pivoting; n is four.
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r * n + i]) > Math.abs(A[piv * n + i])) piv = r;
    for (let c = 0; c < n; c++) { const t = A[i * n + c]; A[i * n + c] = A[piv * n + c]; A[piv * n + c] = t; }
    { const t = b[i]; b[i] = b[piv]; b[piv] = t; }
    for (let r = i + 1; r < n; r++) {
      const f = A[r * n + i] / A[i * n + i];
      for (let c = i; c < n; c++) A[r * n + c] -= f * A[i * n + c];
      b[r] -= f * b[i];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i * n + c] * x[c];
    x[i] = s / A[i * n + i];
  }
  return Array.from(x);
}

/**
 * The palette as two polynomials in a CLAMPED ln(luminance), plus the error that
 * costs.
 *
 * The clamp is not a safety rail, it is the shape of the thing. The table is
 * built by binning the reference material by luminance, and outside the band
 * that material occupies it has nothing to say, so it holds its end value: the
 * ratios are flat below about 0.5 and flat again above about 5, with all the
 * variation in between. A polynomial fitted across the whole range has to follow
 * flat, then curved, then flat, which no cubic does — it was measured at 5.1
 * levels, and at 0.71 on the middle band alone. Clamping the argument to that
 * band reproduces the flat ends EXACTLY and leaves the polynomial only the part
 * that curves.
 *
 * The error is returned rather than asserted, and measured over the whole range
 * rather than over the band it was fitted on: a fit whose error nobody read is a
 * fit nobody validated.
 */
export function fitChromaticity(tint, band = [0.35, 8], full = [0.36, 7.2], degree = 5, samples = 512) {
  const xs = []; const rr = []; const bb = [];
  for (let s = 0; s < samples; s++) {
    const y = Math.exp(Math.log(band[0]) + (Math.log(band[1]) - Math.log(band[0])) * s / (samples - 1));
    const c = tint(y, [0, 0, 0]);
    xs.push(Math.log(y)); rr.push(c[0] / y); bb.push(c[2] / y);
  }
  const pr = polyFit(xs, rr, degree); const pb = polyFit(xs, bb, degree);
  const lo = Math.log(band[0]); const hi = Math.log(band[1]);
  const ev = (p, x0) => {
    const x = Math.min(hi, Math.max(lo, x0));
    let v = 0;
    for (let d = p.length - 1; d >= 0; d--) v = v * x + p[d];
    return v;
  };
  let worst = 0; let worstAt = 0;
  for (let s = 0; s < samples; s++) {
    const y = Math.exp(Math.log(full[0]) + (Math.log(full[1]) - Math.log(full[0])) * s / (samples - 1));
    const x = Math.log(y);
    const r = ev(pr, x); const b = ev(pb, x);
    const g = (1 - LUMA[0] * r - LUMA[2] * b) / LUMA[1];
    const want = agx(tint(y, [0, 0, 0]), 1).map((v) => linearToSrgb(Math.min(1, Math.max(0, v))) * 255);
    const got = agx([r * y, g * y, b * y], 1).map((v) => linearToSrgb(Math.min(1, Math.max(0, v))) * 255);
    const d = Math.hypot(...got.map((v, k) => v - want[k]));
    if (d > worst) { worst = d; worstAt = y; }
  }
  return {
    red: pr, blue: pb, band: [lo, hi], worstLevels: worst, worstAt,
  };
}

export { linearToSrgb, srgbToLinear };
