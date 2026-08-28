import { agx } from './agx.mjs';

// Inverse of the AgX transform.
//
// Baking a sky "onto the reference" means solving a backwards question: which
// radiance, once the renderer has tone mapped it, lands on the colour the
// reference shows. Everything downstream of this file works in display referred
// colour, the way the reference image is authored, and only the last step turns
// it back into light.

const SRGB_TO_REC2020 = [
  [0.6274, 0.3293, 0.0433],
  [0.0691, 0.9195, 0.0113],
  [0.0164, 0.0880, 0.8956],
];

const INSET = [
  [0.856627153315983, 0.0951212405381588, 0.0482516061458583],
  [0.137318972929847, 0.761241990602591, 0.101439036467562],
  [0.11189821299995, 0.0767994186031903, 0.811302368396859],
];

const OUTSET = [
  [1.1271005818144368, -0.11060664309660323, -0.016493938717834573],
  [-0.1413297634984383, 1.157823702216272, -0.016493938717834257],
  [-0.14132976349843826, -0.11060664309660294, 1.2519364065950405],
];

const MIN_EV = -12.47393;
const MAX_EV = 4.026069;

function invert3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error('singular matrix');
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

const REC2020_TO_SRGB_INV = SRGB_TO_REC2020;      // sRGB linear -> rec2020 linear
const INSET_INV = invert3(INSET);
const OUTSET_INV = invert3(OUTSET);
const REC2020_TO_SRGB_LINEAR = invert3(SRGB_TO_REC2020);

function apply(m, v, out) {
  const [x, y, z] = v;
  out[0] = m[0][0] * x + m[0][1] * y + m[0][2] * z;
  out[1] = m[1][0] * x + m[1][1] * y + m[1][2] * z;
  out[2] = m[2][0] * x + m[2][1] * y + m[2][2] * z;
  return out;
}

function contrast(x) {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4
    - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

// The sigmoid is monotone on [0,1] but has no closed form inverse, so it is
// tabulated once and read back by binary search plus a linear step.
const TABLE_SIZE = 4096;
const TABLE = new Float64Array(TABLE_SIZE);
for (let i = 0; i < TABLE_SIZE; i++) TABLE[i] = contrast(i / (TABLE_SIZE - 1));

function contrastInverse(y) {
  if (y <= TABLE[0]) return 0;
  if (y >= TABLE[TABLE_SIZE - 1]) return 1;
  let lo = 0;
  let hi = TABLE_SIZE - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (TABLE[mid] <= y) lo = mid; else hi = mid;
  }
  const span = TABLE[hi] - TABLE[lo];
  const t = span > 1e-12 ? (y - TABLE[lo]) / span : 0;
  return (lo + t) / (TABLE_SIZE - 1);
}

const a = [0, 0, 0];
const b = [0, 0, 0];

/**
 * Display referred linear sRGB (the output of agx()) back to scene linear sRGB.
 * Values that the forward transform had already clipped cannot be recovered, so
 * the log encoded stage is held just inside its limits instead of exploding.
 */
export function agxInverse(display, exposure = 1, out = [0, 0, 0]) {
  a[0] = Math.min(1, Math.max(0, display[0]));
  a[1] = Math.min(1, Math.max(0, display[1]));
  a[2] = Math.min(1, Math.max(0, display[2]));
  apply(REC2020_TO_SRGB_INV, a, b);
  for (let i = 0; i < 3; i++) b[i] = Math.max(0, b[i]) ** (1 / 2.2);
  apply(OUTSET_INV, b, a);
  for (let i = 0; i < 3; i++) {
    const t = contrastInverse(Math.min(1, Math.max(0, a[i])));
    a[i] = 2 ** (MIN_EV + Math.min(0.9995, Math.max(0.0005, t)) * (MAX_EV - MIN_EV));
  }
  apply(INSET_INV, a, b);
  apply(REC2020_TO_SRGB_LINEAR, b, out);
  for (let i = 0; i < 3; i++) out[i] = Math.max(0, out[i]) / exposure;
  return out;
}

/** Round trip check, used by the tools to assert the two transforms agree. */
export function roundTripError(displayRgb) {
  const linear = agxInverse(displayRgb);
  const back = agx(linear, 1);
  return Math.max(
    Math.abs(back[0] - displayRgb[0]),
    Math.abs(back[1] - displayRgb[1]),
    Math.abs(back[2] - displayRgb[2]),
  );
}
