// The arc the light travels, in ONE place.
//
// Sun by day and moon by night are one light source that moves, and over a whole
// cycle it traces a circle: up one side of the sky, across, down through the
// horizon, and round. Every piece is baked along THAT CIRCLE, the runtime
// projects the world's light onto it to get a parameter, and the coefficient
// curves in the atlas are functions of that parameter. Three readers, one
// geometry.
//
// WHY THIS FILE EXISTS AT ALL, AND IT IS NOT TIDINESS. The frame used to be
// written out twice — once inside `bake-volumes.mjs` and once in the session
// scratch that produced the delivered measurements — and both copies carried a
// pole azimuth of 80.5 degrees. At 80.5 the circle DOES NOT PASS THROUGH THE
// SUN THE WORLD IS LIT BY. The production sun sits at az -9.5, el 34; the plane
// whose pole is (80.5, 15) misses it by 8.32 degrees, and the nearest baked
// direction on it is 8.86 degrees away — further than the 7.5 degree spacing the
// whole arc was made fine for. Measured on the delivered pieces, reconstruction
// at the one direction the game actually uses came out at 5.62, 4.89 and 4.92
// display levels against a net of 4, and no arithmetic at runtime could have
// recovered it: with the pole a quarter turn off the production bearing the
// out-of-plane distance is sin(90 - INC) * sin(sun elevation), which is zero
// only at an inclination of 90.
//
// The pole azimuth is therefore not a taste. It is the solution of s . p = 0 for
// the production sun s and a pole p at elevation 90 - INC, which is 90.9125
// degrees, and at that value the sun lands ON the circle — 0.0004 degrees out,
// which is rounding — at parameter 54.63, between the samples at 52.5 and 60.
// That is the interpolated case the compression was measured on.
//
// Nothing else moves: the inclination stays 75, so the circle still culminates
// at 75 degrees of elevation and crosses the horizon 180 degrees of azimuth
// apart, which is the shape of a light's path across a sky; the cut stays at
// -12, which is about as far under the horizon as a direct term survives; and
// the end parameter stays 102.43.

const DEG = Math.PI / 180;

/** Inclination of the great circle, in degrees of its highest elevation. */
export const INC = 75;

/**
 * Azimuth of the pole, and the one number this file exists to state once.
 *
 * Solved rather than chosen: the arc has to contain `PROD_SUN`, and requiring
 * the pole to be perpendicular to it fixes the azimuth exactly. If the
 * production sun ever moves, this moves with it — `poleAzimuthFor` below is the
 * solution, and `tools/clouds/check-arc.mjs` is the assertion.
 */
export const POLE_AZ = 90.9125;

/** How far below the horizon the arc is cut. */
export const CUT = -12;

/** A direction from azimuth and elevation, in the generator's convention. */
export function sunVec(azDeg, elDeg) {
  const a = azDeg * DEG; const e = elDeg * DEG;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
}

/**
 * The pole azimuth whose great circle passes through a given direction.
 *
 * s . p = 0 with p at elevation 90 - INC expands to
 *   cos(eP) * (s.x sin az + s.z cos az) + s.y sin(eP) = 0
 * which is one equation in az with two roots half a turn apart; the one nearer
 * a quarter turn from the direction's own bearing is the one that makes the arc
 * run ACROSS the production bearing rather than along it.
 */
export function poleAzimuthFor(dir) {
  const eP = (90 - INC) * DEG;
  const k = -dir[1] * Math.sin(eP) / Math.cos(eP);
  const r = Math.hypot(dir[0], dir[2]);
  const phi = Math.atan2(dir[0], dir[2]);
  return (Math.acos(Math.max(-1, Math.min(1, k / r))) + phi) / DEG;
}

/**
 * The orthonormal frame of the arc: `u` at the top, `w` a quarter turn along.
 *
 * A direction at parameter t is cos(t) * u + sin(t) * w, and the parameter of a
 * direction is atan2(d . w, d . u) — which is what the runtime needs to turn a
 * sun into a place on the curve.
 */
export function arcFrame(poleAz = POLE_AZ, inc = INC) {
  const p = sunVec(poleAz, 90 - inc);
  const d = -p[1];
  const u0 = [d * p[0], 1 + d * p[1], d * p[2]];
  const n = Math.hypot(u0[0], u0[1], u0[2]);
  const u = u0.map((c) => c / n);
  const w = [
    p[1] * u[2] - p[2] * u[1], p[2] * u[0] - p[0] * u[2], p[0] * u[1] - p[1] * u[0],
  ];
  return { u, w, p };
}

/**
 * The parameters the arc is sampled at.
 *
 * `step` degrees from -90 to 90, with the two crossing planes added at the ends.
 * The 15 degree grid steps straight from 0 to -14.5 and would skip the crossing
 * itself, which is where the light stops lighting a crown and starts lighting an
 * underside and where the fastest change per degree on the whole arc was
 * measured — so the ends land ON the crossing rather than near it.
 *
 * `fine` is the same list with the midpoint of every gap inserted, so
 * `fine[2i] === coarse[i]`. The delivered pieces are baked on `fine`.
 */
export function arcParams(step = 15, cut = CUT, inc = INC) {
  const tEnd = Math.acos(Math.sin(cut * DEG) / Math.sin(inc * DEG)) / DEG;
  const coarse = [-tEnd];
  for (let t = -90; t <= 90; t += step) coarse.push(t);
  coarse.push(tEnd);
  const fine = [];
  for (let i = 0; i < coarse.length; i++) {
    fine.push(coarse[i]);
    if (i + 1 < coarse.length) fine.push((coarse[i] + coarse[i + 1]) / 2);
  }
  return { coarse, fine, tEnd };
}

/** Named sun planes at the given arc parameters. */
export function planesFor(ts, tag = 'ring', poleAz = POLE_AZ, inc = INC) {
  const { u, w } = arcFrame(poleAz, inc);
  return ts.map((t, i) => {
    const r = t * DEG; const ct = Math.cos(r); const st = Math.sin(r);
    const v = [0, 1, 2].map((c) => ct * u[c] + st * w[c]);
    return {
      name: `${tag}-${String(i).padStart(2, '0')}`,
      t,
      az: Number((Math.atan2(v[0], v[2]) / DEG).toFixed(1)),
      el: Number((Math.asin(Math.max(-1, Math.min(1, v[1]))) / DEG).toFixed(1)),
    };
  });
}

/** Where a direction sits on the arc, in the same parameter. */
export function arcParamOf(dir, poleAz = POLE_AZ, inc = INC) {
  const { u, w } = arcFrame(poleAz, inc);
  const cu = dir[0] * u[0] + dir[1] * u[1] + dir[2] * u[2];
  const cw = dir[0] * w[0] + dir[1] * w[1] + dir[2] * w[2];
  return Math.atan2(cw, cu) / DEG;
}

/** How far a direction lies off the arc's plane, in degrees. */
export function offPlane(dir, poleAz = POLE_AZ, inc = INC) {
  const { p } = arcFrame(poleAz, inc);
  const d = dir[0] * p[0] + dir[1] * p[1] + dir[2] * p[2];
  return Math.asin(Math.max(-1, Math.min(1, Math.abs(d)))) / DEG;
}
