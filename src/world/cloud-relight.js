// Lighting a generated cloud from whatever direction the world's light is in.
//
// WHAT THE ATLAS HOLDS. Not colour. A cloud whose colour is baked cannot be
// relit, and the world is getting a day/night cycle and a trigger that takes it
// to night on a keystroke. What it holds is a few SPATIAL MAPS per piece, whose
// weighted sum in the LOG is the illumination — plus coverage, in the one
// channel the texture leaves alone.
//
// WHAT THE FRAGMENT COSTS. One read to know how much cloud is here before
// warping, then one per atlas at the warped point: three reads for an atlas of
// two textures, four for one of three. The photographic field takes two on a
// piece standing where it was cut and six on a piece standing anywhere else —
// the four extra are its gradient re-lighting, a trick for tilting the shading
// of a cut-out under a sun it was not photographed under, and a piece that
// carries its own light needs none of it. The angular part costs no read at
// all: the coefficients are uniforms, worked out once per frame per piece on
// the way in.
//
// WHY THE COUNT IS NOT A CONSTANT HERE. How many maps a piece was fitted with
// is a decision taken when the volumes are packed, and it is written down in
// the manifest — the atlas says how many textures it ships and what rank it
// carries, and everything below is generated from that. A rank written into
// this file would be a second copy of a number the asset already states, and
// the day the two disagreed every cloud in the sky would read a channel that
// holds a different map. So the shader is built for the atlas that arrived: an
// atlas of two textures compiles the same two samplers it always did, and pays
// nothing for a third it does not have.
//
// WHY THE EXPONENTIAL. The maps are logarithms. Fitted on the illumination
// itself, a low rank approximation of a non-negative quantity goes negative over
// a third of a cloud's body and the tone curve floors all of it at black; in the
// log the reconstruction is positive by construction, and because AgX is a
// log-domain curve the fit is very nearly a fit of display levels. See
// tools/clouds/cloud-basis.mjs for the measurements.
//
// WHY THE MAPS ARE READ WITHOUT A TRANSFER. The three channels of the first
// texture and the four of every one after it are log-domain coefficients, not
// colour: a sampler that decoded them would return a different number from the
// one the packing wrote, and the reconstruction would be of something else.
// The atlas ships with a linear transfer and the gateway must not tag it sRGB —
// tools/build-assets.mjs carries a profile of its own for exactly that reason.

const DEG = Math.PI / 180;

/**
 * The coefficient of every map at one point of the arc.
 *
 * A Catmull-Rom through the baked samples, which is what makes the angular
 * resolution free: a direction between two baked planes costs an interpolation
 * of a few numbers on the CPU, not a texture. Outside the baked range it holds
 * the end sample — under the cut the arc has nothing to say, and holding is the
 * one answer that cannot invent light.
 *
 * This is the single definition; tools/clouds/cloud-basis.mjs re-exports it, so
 * the fit and the runtime cannot come to disagree about what a curve means.
 */
export function coeffAt(ts, vectors, t) {
  const n = ts.length;
  let j = 0;
  while (j < n - 2 && ts[j + 1] < t) j++;
  const p = (a) => Math.min(n - 1, Math.max(0, a));
  const t1 = ts[j]; const t2 = ts[p(j + 1)];
  const t0 = ts[p(j - 1)]; const t3 = ts[p(j + 2)];
  const u = Math.min(1, Math.max(0, (t - t1) / Math.max(1e-9, t2 - t1)));
  return vectors.map((v) => {
    const y0 = v[p(j - 1)]; const y1 = v[j]; const y2 = v[p(j + 1)]; const y3 = v[p(j + 2)];
    const d1 = (y2 - y0) / Math.max(1e-9, t2 - t0) * (t2 - t1);
    const d2 = (y3 - y1) / Math.max(1e-9, t3 - t1) * (t2 - t1);
    const a = 2 * y1 - 2 * y2 + d1 + d2;
    const b = -3 * y1 + 3 * y2 - 2 * d1 - d2;
    return ((a * u + b) * u + d1) * u + y1;
  });
}

/**
 * The arc the pieces were baked along, read back out of the manifest.
 *
 * The bake wrote its planes as a bearing and a height each, plus the parameter
 * `t` along a great circle. This recovers the circle's own frame from those
 * samples rather than restating the two constants the bake chose, because a
 * constant restated is a constant that can drift: the day somebody re-baked on
 * a different circle, a hard-coded frame here would keep projecting onto the
 * old one and every cloud in the sky would be lit from the wrong place with
 * nothing complaining.
 *
 * The recovery is one Fourier coefficient each way — p(t) = cos(t)u + sin(t)w,
 * so u and w are the projections of the samples onto cosine and sine — followed
 * by an orthonormalisation, which is what absorbs the tenth of a degree the
 * manifest's rounded bearings cost.
 *
 * NOTE ON FRAMES. The bake states a direction as (azimuth, elevation) with
 * azimuth nought pointing along +z; the world's own convention points it along
 * −z. The two differ by the sign of one axis, which preserves every angle, so
 * `paramOf` flips z on the way in and nothing else in this file has to know.
 */
export function arcOf(manifest) {
  const vec = (az, el) => {
    const a = az * DEG; const e = el * DEG;
    return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const scale = (a, k) => a.map((c) => c * k);
  const unit = (a) => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

  let u = [0, 0, 0]; let w = [0, 0, 0];
  for (const s of manifest.arc) {
    const p = vec(s.az, s.el);
    const c = Math.cos(s.t * DEG); const n = Math.sin(s.t * DEG);
    u = [u[0] + c * p[0], u[1] + c * p[1], u[2] + c * p[2]];
    w = [w[0] + n * p[0], w[1] + n * p[1], w[2] + n * p[2]];
  }
  u = unit(u);
  const k = dot(w, u);
  w = unit([w[0] - k * u[0], w[1] - k * u[1], w[2] - k * u[2]]);
  const pole = [
    u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0],
  ];
  const ts = manifest.arc.map((s) => s.t);

  return {
    ts,
    /** Where a world direction sits along the arc, in the bake's own parameter. */
    paramOf(sun) {
      const p = [sun.x, sun.y, -sun.z];
      return Math.atan2(dot(p, w), dot(p, u)) / DEG;
    },
    /**
     * How far a world direction is from the plane of the arc, in degrees.
     *
     * The arc is a ONE parameter family: a direction off its plane has no place
     * on it, and projecting one there lights the cloud from somewhere the bake
     * never looked. This is what says so, and clouds.js refuses to be quiet
     * about it — see the note there.
     */
    offPlaneOf(sun) {
      const p = [sun.x, sun.y, -sun.z];
      const n = Math.hypot(p[0], p[1], p[2]) || 1;
      return Math.asin(Math.max(-1, Math.min(1, dot(p, pole) / n))) / DEG;
    },
  };
}

/**
 * The numbers a piece needs for one direction of the world's light.
 *
 * Called once per piece per frame — two dozen pieces times eight numbers, which
 * is nothing. The per-map range is folded in here rather than uploaded, because
 *
 *   sum_r ( lo_r + (hi_r - lo_r) * q_r ) * c_r
 *     = sum_r lo_r c_r  +  sum_r (hi_r - lo_r) c_r * q_r
 *
 * and the first sum has no texture in it. So the shader never sees a scale or a
 * bias: illumination is exp( offset + dot(stored channels, gains) ).
 *
 * @param {{curves: number[][], ranges: [number, number][]}} tile from cloud-relit.json
 * @param {number[]} ts arc parameter of each baked direction
 * @param {number} t where the light is on the arc, in the same parameter
 */
export function coeffsFor(tile, ts, t) {
  const c = coeffAt(ts, tile.curves, t);
  let offset = 0;
  const gain = c.map((cr, r) => {
    const [lo, hi] = tile.ranges[r];
    offset += lo * cr;
    return (hi - lo) * cr;
  });
  return { offset, gain };
}

/**
 * Which map lives in which channel of which texture.
 *
 * The first texture keeps its alpha for coverage — coverage is the silhouette,
 * it has to stay at full resolution and it must not go through a transfer, and
 * an sRGB format leaves alpha alone — so it carries three maps and every
 * texture after it carries four. That is the whole rule, and stating it as a
 * function of the rank is what lets one shader serve an atlas of two textures
 * and an atlas of three without a constant anywhere saying which.
 *
 * The consequence worth knowing before choosing a rank: eight channels hold
 * SEVEN maps and a coverage, so rank seven is exactly the last rank that fits
 * in two textures, and rank eight opens a third one for a single map.
 *
 * tools/clouds/pack-atlas.mjs writes the atlas to this same rule. It states it
 * in its own terms today; the day it can import from here, it should, because a
 * layout written twice is a layout that can come to mean two things.
 *
 * @param {number} rank how many spatial maps a piece was fitted with
 * @returns {number[][]} the map indices each texture carries, in channel order
 */
export function atlasLayout(rank) {
  const layout = [[]];
  for (let r = 0; r < rank; r++) {
    if (r < 3) { layout[0].push(r); continue; }
    const t = 1 + Math.floor((r - 3) / 4);
    if (!layout[t]) layout[t] = [];
    layout[t].push(r);
  }
  return layout;
}

/** The atlas's textures named the way the packing names their files: a, b, c. */
export const textureLetter = (t) => String.fromCharCode(65 + t);

/**
 * The fragment's share.
 *
 * The chromaticity is a pair of polynomials in the log of the luminance rather
 * than the table it approximates, because a table is a texture and a texture is
 * a fetch this shader is not paying for. The argument is CLAMPED to the band the
 * table has anything to say about: outside it the reference material has no
 * samples and the table holds its end value, so the clamp reproduces the ends
 * exactly instead of letting a polynomial run away past them. Only two ratios
 * are free — the triple is a chromaticity at a given luminance, so the green one
 * is whatever the other two leave.
 *
 * What comes out is scene radiance, ready for the frame's own AgX, and NOT
 * premultiplied: the caller multiplies by coverage after it has dithered, which
 * is the order that keeps a filtered edge the colour it was.
 *
 * @param {number[][]} layout what each texture of the atlas carries, from atlasLayout
 */
export const relightGlsl = (layout) => /* glsl */`
  uniform float uExposure;
  uniform vec2 uChromaBand;       // ln radiance, low and high
  uniform float uChromaR[6];
  uniform float uChromaB[6];

  float chromaPoly(float p[6], float x) {
    float v = p[5];
    v = v * x + p[4];
    v = v * x + p[3];
    v = v * x + p[2];
    v = v * x + p[1];
    v = v * x + p[0];
    return v;
  }

  /** Scene radiance of a cloud texel, from its stored maps and this frame's coefficients. */
  vec3 cloudRadiance(${[
    'vec3 mapsA',
    ...layout.slice(1).map((_, t) => `vec4 maps${textureLetter(t + 1)}`),
    ...layout.map((_, t) => `vec4 gain${textureLetter(t)}`),
  ].join(', ')}) {
    float logIllum = gainA.w + dot(mapsA, gainA.rgb)${layout.slice(1).map((maps, t) => {
    const L = textureLetter(t + 1);
    // A texture carrying one map is a multiply, not a dot: the three channels
    // beside it hold nothing and their gains are nought, so the wide form
    // would be three multiply-adds spent to add zero.
    if (maps.length === 1) return ` + maps${L}.r * gain${L}.r`;
    const swizzle = 'rgba'.slice(0, maps.length);
    return maps.length === 4
      ? ` + dot(maps${L}, gain${L})`
      : ` + dot(maps${L}.${swizzle}, gain${L}.${swizzle})`;
  }).join('')};
    float y = exp(logIllum) * uExposure;
    float x = clamp(log(y), uChromaBand.x, uChromaBand.y);
    float r = chromaPoly(uChromaR, x);
    float b = chromaPoly(uChromaB, x);
    float g = (1.0 - 0.2126 * r - 0.0722 * b) / 0.7152;
    return vec3(r, g, b) * y;
  }
`;
