// Colour space helpers for the offline grading tools.
// Distances are measured in CIE Lab because the fit has to be judged the way an
// eye judges it: an equal error in linear RGB is not an equal error to look at.

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(c) {
  const v = Math.max(0, c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

const D65 = [0.95047, 1.0, 1.08883];

export function linearRgbToXyz([r, g, b]) {
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
    0.0193339 * r + 0.1191920 * g + 0.9503041 * b,
  ];
}

export function xyzToLab(xyz) {
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(xyz[0] / D65[0]);
  const fy = f(xyz[1] / D65[1]);
  const fz = f(xyz[2] / D65[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** sRGB in 0..1 (display encoded) to CIE Lab. */
export function srgbToLab([r, g, b]) {
  return xyzToLab(linearRgbToXyz([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]));
}

/** Plain euclidean Lab distance (CIE76). */
export function deltaE76(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** CIEDE2000, the distance that actually tracks perception in blues. */
export function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const kL = 1, kC = 1, kH = 1;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hp = (b, ap) => {
    if (b === 0 && ap === 0) return 0;
    const angle = Math.atan2(b, ap) * 180 / Math.PI;
    return angle < 0 ? angle + 360 : angle;
  };
  const hp1 = hp(b1, ap1);
  const hp2 = hp(b2, ap2);

  const dLp = L2 - L1;
  const dCp = Cp2 - Cp1;
  let dhp = 0;
  if (Cp1 * Cp2 !== 0) {
    dhp = hp2 - hp1;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dhp * Math.PI / 360);

  const Lbar = (L1 + L2) / 2;
  const Cpbar = (Cp1 + Cp2) / 2;
  let hbar = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > 180) hbar += hp1 + hp2 < 360 ? 360 : -360;
    hbar /= 2;
  }
  const rad = (d) => d * Math.PI / 180;
  const T = 1
    - 0.17 * Math.cos(rad(hbar - 30))
    + 0.24 * Math.cos(rad(2 * hbar))
    + 0.32 * Math.cos(rad(3 * hbar + 6))
    - 0.20 * Math.cos(rad(4 * hbar - 63));
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpbar ** 7 / (Cpbar ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const Sc = 1 + 0.045 * Cpbar;
  const Sh = 1 + 0.015 * Cpbar * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;

  return Math.sqrt(
    (dLp / (kL * Sl)) ** 2
    + (dCp / (kC * Sc)) ** 2
    + (dHp / (kH * Sh)) ** 2
    + Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh)),
  );
}
