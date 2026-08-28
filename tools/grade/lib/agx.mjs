// AgX tone mapping, mirrored from the transform the renderer applies.
//
// Grading a sky offline only means anything if the offline picture goes through
// exactly the same curve as the shipped frame. Both sides are kept in step by
// hand, so any change to the shader has to be repeated here.

const SRGB_TO_REC2020 = [
  [0.6274, 0.3293, 0.0433],
  [0.0691, 0.9195, 0.0113],
  [0.0164, 0.0880, 0.8956],
];

const REC2020_TO_SRGB = [
  [1.6605, -0.5876, -0.0728],
  [-0.1246, 1.1329, -0.0083],
  [-0.0182, -0.1006, 1.1187],
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
  return 15.5 * x4 * x2
    - 40.14 * x4 * x
    + 31.96 * x4
    - 6.868 * x2 * x
    + 0.4298 * x2
    + 0.1191 * x
    - 0.00232;
}

const scratchA = [0, 0, 0];
const scratchB = [0, 0, 0];

/** Linear sRGB in, display referred linear sRGB out (still pre gamma encode). */
export function agx(rgb, exposure = 1, out = [0, 0, 0]) {
  scratchA[0] = rgb[0] * exposure;
  scratchA[1] = rgb[1] * exposure;
  scratchA[2] = rgb[2] * exposure;
  apply(SRGB_TO_REC2020, scratchA, scratchB);
  apply(INSET, scratchB, scratchA);
  for (let i = 0; i < 3; i++) {
    const l = Math.log2(Math.max(scratchA[i], 1e-10));
    scratchA[i] = contrast(Math.min(1, Math.max(0, (l - MIN_EV) / (MAX_EV - MIN_EV))));
  }
  apply(OUTSET, scratchA, scratchB);
  for (let i = 0; i < 3; i++) scratchB[i] = Math.max(0, scratchB[i]) ** 2.2;
  apply(REC2020_TO_SRGB, scratchB, out);
  for (let i = 0; i < 3; i++) out[i] = Math.min(1, Math.max(0, out[i]));
  return out;
}
