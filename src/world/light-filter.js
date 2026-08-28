// HOW A TEXEL OF BAKED LIGHT IS READ. Not what it means — src/core/sky.js says
// that, once, in bakedLight() — but how the value between two texels is found.
//
// THE DEFECT THIS EXISTS FOR, measured with tools/lighting/penumbra.mjs on the
// delivered ground atlas before anything was changed:
//
//   the 10-90 width of a shadow edge is 1.65 TEXELS at the median, and one
//   texel or less on a third of them
//
// A texel of the ground atlas is about five centimetres. A shadow edge crossing
// that grid at any angle other than square to it is therefore quantised to the
// grid, and bilinear reconstruction rebuilds it as a chain of straight ramps
// with a corner at every texel centre: a staircase whose steps are the atlas.
// At the near ground one of those steps covers tens of screen pixels. That is
// what the committente called PIXELLATE, and it is a reconstruction defect —
// the map is not wrong, the way it is read between samples is.
//
// The cure is the standard one and it is not new: a cubic B-spline kernel,
// evaluated with FOUR bilinear taps instead of sixteen point taps, after Sigg
// and Hadwiger, "Fast Third-Order Texture Filtering", GPU Gems 2 chapter 20.
// The trick is that a bilinear tap placed at a fractional offset already
// computes a weighted pair, so choosing the offset chooses the weight ratio.
// Bakery, the GPU lightmapper, ships this for exactly this complaint and says
// so: it "fixes many jagged edges of low resolution lightmaps pretty well".
//
// WHAT IT DOES AND DOES NOT DO. The B-spline is APPROXIMATING, not
// interpolating: at a texel centre it returns that texel blended 1:4:1 with its
// neighbours, so the whole field is smoothed by about one texel and the corners
// go away. It does not invent a penumbra and it must not be asked to — a
// shadow's edge widens with the throw from the thing that casts it, and a
// filter that widened every edge by the same amount would soften the foot of a
// block by as much as the tip of a shadow eight metres out. The width belongs
// to the bake and to tools/lighting/pack-light.mjs; this only stops the grid
// from showing through.
//
// THE GUTTER. The kernel reaches texels i-1 to i+2, so two texels past the one
// asked for. Every atlas it is used on bleeds further than that: the ground and
// the stair are baked with a margin of 8 pixels (tools/terrain/build-terrain.py)
// and the stone with 6 (tools/monoliths/build-monoliths.py,
// tools/vegetation/build-rocks.py), which is the condition for a wider kernel
// and it is met with room to spare. The ground atlas has no islands at all — it
// is one square of meadow — so only the outer border can be reached, and that
// clamps.
//
// THE SIZE HAS TO ARRIVE AS A UNIFORM. textureSize() is GLSL ES 3.00 and this
// renderer still compiles some materials as 1.00, so the caller states the
// atlas size beside the sampler. lightFilterUniforms() builds it from the
// texture itself so that nobody can state a size the texture does not have.

import { Vector2 } from 'three';

/**
 * The two forms, so a caller can choose by cost and the choice is visible.
 *
 * SMOOTH is one tap: it bends the bilinear ramp into a smoothstep so the corner
 * at each texel centre goes away, and costs nothing at all. It leaves the edge
 * exactly as wide as it was, which on a one texel edge means the staircase is
 * smoothed but still there.
 *
 * BICUBIC is four taps and is the one that actually removes the grid.
 */
export const LIGHT_FILTER = { BILINEAR: 'bilinear', SMOOTH: 'smooth', BICUBIC: 'bicubic' };

/**
 * The uniforms a material needs beside its light sampler.
 * @param {import('three').Texture} light
 */
export function lightFilterUniforms(light) {
  const image = light && (light.image || (light.source && light.source.data));
  const width = image && image.width;
  const height = image && image.height;
  // Loud rather than silent. A wrong size does not draw a wrong-looking
  // picture, it draws a picture whose light is read a texel or two off
  // everywhere — which is exactly the class of defect this repository keeps
  // finding months later, so it refuses to start instead.
  if (!width || !height) {
    throw new Error('light-filter: the light map states no size, so the filter '
      + 'cannot place its taps; the texture has to be loaded before the material is built');
  }
  return { uLightSize: { value: new Vector2(width, height) } };
}

const BICUBIC_GLSL = /* glsl */`
  uniform vec2 uLightSize;

  // The four cubic B-spline basis functions. They sum to one everywhere.
  float lfW0(float a) { return (1.0 / 6.0) * (a * (a * (-a + 3.0) - 3.0) + 1.0); }
  float lfW1(float a) { return (1.0 / 6.0) * (a * a * (3.0 * a - 6.0) + 4.0); }
  float lfW2(float a) { return (1.0 / 6.0) * (a * (a * (-3.0 * a + 3.0) + 3.0) + 1.0); }
  float lfW3(float a) { return (1.0 / 6.0) * (a * a * a); }

  // The weight of each of the two taps on an axis, and where to put it. The
  // offset is what makes the hardware's own lerp produce the w0:w1 ratio, which
  // is the whole reason this costs four taps and not sixteen.
  float lfG0(float a) { return lfW0(a) + lfW1(a); }
  float lfG1(float a) { return lfW2(a) + lfW3(a); }
  float lfH0(float a) { return -1.0 + lfW1(a) / (lfW0(a) + lfW1(a)); }
  float lfH1(float a) { return  1.0 + lfW3(a) / (lfW2(a) + lfW3(a)); }

  // The stored pair of terms, read with a cubic B-spline.
  //
  // WHAT IS IN THE TEXTURE: the sun term as GREY in rgb, and the sky term in
  // ALPHA as the square root of its linear value. tools/lighting/pack-light.mjs
  // carries the measurement that put it there — an ETC1S block holds one coarse
  // chroma, and a shadow edge is exactly where the two terms disagree, so the
  // old red-and-green pair cost 16.67 levels on every edge against 4.14 this
  // way. bakedLight() in src/core/sky.js is unchanged and still says what a
  // texel MEANS; this only says how one is fetched and unpacked.
  //
  // rgb carries an sRGB transfer, so those come back from the sampler already
  // in linear light and the hardware's own blend inside each tap happened there
  // too; summing them with linear weights is a sum of light. ALPHA CARRIES NO
  // TRANSFER — it comes back raw — which is why it holds a square root, squared
  // here. The squaring is after the filter and not before, which is right for a
  // term this smooth and wrong for one with an edge in it; the sky term has
  // none, by its own definition.
  vec3 lightTerms(sampler2D tex, vec2 uv) {
    vec2 t = uv * uLightSize + 0.5;
    vec2 i = floor(t);
    vec2 f = t - i;

    float gx0 = lfG0(f.x);
    float gx1 = lfG1(f.x);
    float hx0 = lfH0(f.x);
    float hx1 = lfH1(f.x);
    float hy0 = lfH0(f.y);
    float hy1 = lfH1(f.y);

    vec2 p0 = (vec2(i.x + hx0, i.y + hy0) - 0.5) / uLightSize;
    vec2 p1 = (vec2(i.x + hx1, i.y + hy0) - 0.5) / uLightSize;
    vec2 p2 = (vec2(i.x + hx0, i.y + hy1) - 0.5) / uLightSize;
    vec2 p3 = (vec2(i.x + hx1, i.y + hy1) - 0.5) / uLightSize;

    vec4 s = lfG0(f.y) * (gx0 * texture2D(tex, p0) + gx1 * texture2D(tex, p1))
           + lfG1(f.y) * (gx0 * texture2D(tex, p2) + gx1 * texture2D(tex, p3));
    return vec3(s.r, s.a * s.a, s.a * s.a);
  }
`;

const SMOOTH_GLSL = /* glsl */`
  uniform vec2 uLightSize;

  // One tap. The fractional part of the texel coordinate is put through a
  // smoothstep before the hardware blends, so the ramp arrives at each texel
  // centre with zero slope instead of a corner.
  vec3 lightTerms(sampler2D tex, vec2 uv) {
    vec2 t = uv * uLightSize - 0.5;
    vec2 i = floor(t);
    vec2 f = t - i;
    f = f * f * (3.0 - 2.0 * f);
    vec4 s = texture2D(tex, (i + f + 0.5) / uLightSize);
    return vec3(s.r, s.a * s.a, s.a * s.a);
  }
`;

const BILINEAR_GLSL = /* glsl */`
  uniform vec2 uLightSize;
  vec3 lightTerms(sampler2D tex, vec2 uv) {
    vec4 s = texture2D(tex, uv);
    return vec3(s.r, s.a * s.a, s.a * s.a);
  }
`;

/**
 * The GLSL for one filter. Declares uLightSize in every form, including the one
 * that does not read it, so a material can be switched between them without its
 * uniform list changing underneath it.
 *
 * @param {string} kind one of LIGHT_FILTER
 */
export function lightFilterGlsl(kind = LIGHT_FILTER.BICUBIC) {
  if (kind === LIGHT_FILTER.BILINEAR) return BILINEAR_GLSL;
  if (kind === LIGHT_FILTER.SMOOTH) return SMOOTH_GLSL;
  return BICUBIC_GLSL;
}
