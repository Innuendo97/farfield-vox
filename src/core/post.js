import {
  AlwaysDepth, ClampToEdgeWrapping, DataTexture, DepthTexture, GLSL3, HalfFloatType, LinearFilter,
  LinearSRGBColorSpace, Matrix4, Mesh, NearestFilter, NoBlending, NoToneMapping, OrthographicCamera,
  FloatType, PlaneGeometry, RGBAFormat, RGBFormat, RedFormat, Scene, ShaderMaterial, Texture,
  UnsignedByteType, UnsignedInt101111Type, UnsignedIntType, Vector2, Vector3, Vector4,
  WebGLRenderTarget,
} from 'three';

// The frame is assembled here and nowhere else.
//
// Everything the scene draws lands in a floating point buffer, still in light
// units. Bloom is taken from that buffer at half resolution, and one final pass
// turns light into picture: exposure, the AgX curve, and then a grade in two
// stages — the sky's, which is a fitted cube, and the scene's, which is a toe
// and a contrast the sky may not read — and a dither. Doing it in a single pass
// is the point. Every extra full screen pass is another read and write of the
// whole frame, which is the one resource an integrated GPU has least of.
//
// What is NOT here any more is the corner shading: it is one table, measured
// off the reference, and it lives in src/ui/veil.js.
//
// The AgX code below is the transform the reference sky was baked against; the
// same curve is mirrored in tools/grade/lib/agx.mjs and the two have to be
// changed together or the sky stops matching.

const LUT_SIZE = 32;

// How the halo is built, per quality tier.
//
// `first` is how far the chain is stepped down before the first level is drawn
// and `levels` is how many times it is halved after that, so the widest tap of
// the blur reaches first * 2^(levels-1) pixels either way -- EIGHT, at half
// resolution over three levels, and that eight is a fitted number.
//
// WHAT THE REACH DOES, AND WHY IT IS THE HALO'S ONLY HONEST HANDLE ON THE SKY.
// The up chain OVERWRITES rather than accumulates -- level i-1 is replaced by
// the widening of level i, all the way back up -- so what this chain hands the
// composite is not a core with a skirt: it is ONE blur, and `levels` is its
// width. A sky that stands over the threshold across half the frame therefore
// lays its own light that far into every silhouette standing against it, and
// the stone of the monoliths is exactly such a silhouette.
//
// MEASURED (U-LUCE-5, at the fitted pose, arrival veil off both sides, the four
// shadowed faces of masonry-spec `palette` against the offline bench that
// guard-pietra and guard-scala believe):
//
//   reach   the frame OVER the bench, on the stone in shadow   bloom, ms
//    32 px           +3.7  +4.9  +4.0  +1.5                      1.28
//    16 px           +1.9  +2.3  +1.7  +0.5                      0.95
//     8 px           +1.0  +1.8  +1.2  +0.0                      0.82
//     4 px           +1.0  +1.8  +1.2  -0.5                      0.76
//   no bloom at all  +1.0  +1.8  +1.2  -0.5                        --
//
// and at the SAME time, standing three metres and a half in front of an
// engraved face -- where the committente reads the panels and where a stroke is
// twenty pixels tall instead of three -- what the bloom adds to the stone one,
// two and three pixels out from a cyan stroke:
//
//   reach   1-2 px   2-3 px   3-4 px
//    32 px    2.4      3.1      2.7
//     8 px    1.7      1.8      0.7      <- narrower, and still there
//     4 px    1.1      0.4     -0.4      <- gone
//
// EIGHT IS WHERE THE TWO MEET. At eight the stone in shadow is back on the
// bench (the mandate's window is -1..+2 and the four faces land at +0.0..+1.8),
// and the writing still has a halo -- a TIGHTER one, which is what E-PIETRA2
// asked the ink for in the first place. At four the stone gains a level and a
// half more and the halo stops existing; at sixteen the halo is fatter and the
// stone is twice as far off the bench.
//
// AND THE THRESHOLD IS NOT THE HANDLE, which took a sweep to establish rather
// than an argument. Swept from 0.72 to 6.0 in the engine, the sky's bleed on
// the stone and the ink's halo on the panel die TOGETHER, over the same span
// (both are gone by 3.0, both are half by 2.0): in this world's units the
// engraved cyan and the drawn sky sit in the SAME band of radiance, so no
// number that keeps one keeps the other. Only the reach tells them apart, and
// it tells them apart because a stroke is thin and a sky is not.
//
// The quarter tier reaches the SAME eight pixels for a quarter of the fill, at
// the price of a coarser core to the halo. Which is why it is a tier and not
// the default -- and why its levels moved with the other's: a tier that reached
// further than the tier above it would be a different picture, not a cheaper
// one.
const BLOOM_TIERS = {
  half: { first: 2, levels: 3 },
  quarter: { first: 4, levels: 2 },
};

// Multisampling, in the order it is attempted; the first count the driver
// actually accepts is the one used.
const TARGET_ATTEMPTS = [
  { samples: 4 },
  { samples: 2 },
  { samples: 0 },
];

// THE PIXEL OF THE SCENE BUFFER, in the order it is attempted, and it is the
// single largest item in this frame on a machine whose video memory is the
// system's own memory.
//
// WHAT IS BEING BOUGHT. At 1920 by 870 with four samples, eight bytes of colour
// per sample is 53 MB of colour plus 16 of depth, cleared, written and resolved
// every frame; four bytes is 27 plus 16. That difference was measured on this
// machine as the same scene, same triangles, same everything, drawn into an
// eight byte buffer and into a four byte one: 22.4 ms against 13.7 for the
// world's stage. It is the cheapest eight milliseconds in this file and it
// costs no vertex, no draw and no term of any material.
//
// WHY THE HALF FLOAT IS NOT SIMPLY REPLACED BY EIGHT BIT COLOUR. Everything in
// this buffer is LIGHT, not picture: the exposure, the curve and both grades
// run in the composite, downstream. So the sky stands at three to five in these
// units and the sun's own disc far higher, and the bloom takes its source from
// this buffer at a threshold of 0.72 of them. A buffer that cannot hold a value
// above one does not dim the highlights, it DELETES them: the sky flattens to
// paper, and what is left above the threshold is whatever the clamp left there,
// which is not the halo this world was graded against. The two four byte
// formats that CAN hold them are the two normalised ones' opposite: a packed
// float. R11F_G11F_B10F is that format — five and six bit mantissas against the
// half float's ten, no alpha, and the same range — so the chain keeps its
// order, the bloom keeps its threshold, and what is spent is precision, which
// the dither in the composite was already there to cover.
//
// AND THE TWO NORMALISED FORMATS ARE IN THIS TABLE WITHOUT BEING IN THE LADDER,
// which is the one structural decision here. They are what the measurement that
// chose the pixel had to be able to ask for BY NAME — a bench arm cannot compare
// four bytes of clamped colour against eight bytes of light unless it can
// allocate the first — and they are exactly what no fallback may ever land on by
// itself: a driver that refuses the packed float has to fall back to the half
// float, which costs bandwidth, and never onto a buffer that would quietly
// delete every highlight in the frame. So `shipped` is the ladder and the table
// is the vocabulary, and guard-buffer holds the ladder to formats that carry
// light.
const TARGET_FORMATS = [
  {
    name: 'R11F_G11F_B10F',
    bytes: 4,
    // Renderable through EXT_color_buffer_float, which this context already
    // holds for the half float this replaces.
    highDynamicRange: true,
    shipped: true,
    options: { internalFormat: 'R11F_G11F_B10F', format: RGBFormat, type: UnsignedInt101111Type },
  },
  {
    // Asked of the driver rather than argued about: three exposes no type
    // constant that pairs with this internal format, so the resolve texture's
    // allocation is rejected and the probe falls through. It is here so that
    // the measurement could establish that, and it is not shipped.
    name: 'RGB10_A2',
    bytes: 4,
    highDynamicRange: false,
    shipped: false,
    options: { internalFormat: 'RGB10_A2', format: RGBAFormat, type: UnsignedByteType },
  },
  {
    name: 'RGBA8',
    bytes: 4,
    highDynamicRange: false,
    shipped: false,
    options: { format: RGBAFormat, type: UnsignedByteType },
  },
  {
    name: 'RGBA16F',
    bytes: 8,
    highDynamicRange: true,
    shipped: true,
    options: { format: RGBAFormat, type: HalfFloatType },
  },
];

/** The ladder a frame is allowed to fall down, in order. */
const SHIPPED_FORMATS = TARGET_FORMATS.filter((shape) => shape.shipped);

/** Every format this file knows how to ask a driver for, in ladder order. */
export const SCENE_FORMATS = TARGET_FORMATS.map((shape) => shape.name);

const FULLSCREEN_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// The same two triangles for a program written in the modern dialect, where a
// `varying` is a syntax error and the one pass that needs the dialect -- the
// ground's memory, which fetches whole texels and cannot do it with a filter in
// the way -- reads its own place off gl_FragCoord and wants no interpolant.
const FULLSCREEN_VERTEX_300 = /* glsl */`
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Everything under the threshold is removed with a soft shoulder, so a surface
// that merely approaches the threshold does not snap into glowing.
const PREFILTER_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSource;
  // The additive layer, which is drawn apart and has to be a source of the halo
  // like anything else that glows. A lamp whose halo did not bloom would be a
  // lamp fitted against a reference that blooms.
  uniform sampler2D tGlow;
  uniform float uThreshold;
  uniform float uKnee;
  void main() {
    vec3 c = texture2D(tSource, vUv).rgb + texture2D(tGlow, vUv).rgb;
    float brightness = max(c.r, max(c.g, c.b));
    float soft = clamp(brightness - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 0.0001);
    float weight = max(soft, brightness - uThreshold) / max(brightness, 0.0001);
    gl_FragColor = vec4(c * weight, 1.0);
  }
`;

// Dual filter Kawase. Five taps down, eight up: a wide, cheap blur that needs
// neither a separable pass nor a large kernel.
const DOWN_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSource;
  uniform vec2 uHalfPixel;
  void main() {
    vec4 sum = texture2D(tSource, vUv) * 4.0;
    sum += texture2D(tSource, vUv - uHalfPixel);
    sum += texture2D(tSource, vUv + uHalfPixel);
    sum += texture2D(tSource, vUv + vec2(uHalfPixel.x, -uHalfPixel.y));
    sum += texture2D(tSource, vUv - vec2(uHalfPixel.x, -uHalfPixel.y));
    gl_FragColor = sum / 8.0;
  }
`;

const UP_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSource;
  uniform vec2 uHalfPixel;
  void main() {
    vec4 sum = texture2D(tSource, vUv + vec2(-uHalfPixel.x * 2.0, 0.0));
    sum += texture2D(tSource, vUv + vec2(-uHalfPixel.x, uHalfPixel.y)) * 2.0;
    sum += texture2D(tSource, vUv + vec2(0.0, uHalfPixel.y * 2.0));
    sum += texture2D(tSource, vUv + vec2(uHalfPixel.x, uHalfPixel.y)) * 2.0;
    sum += texture2D(tSource, vUv + vec2(uHalfPixel.x * 2.0, 0.0));
    sum += texture2D(tSource, vUv + vec2(uHalfPixel.x, -uHalfPixel.y)) * 2.0;
    sum += texture2D(tSource, vUv + vec2(0.0, -uHalfPixel.y * 2.0));
    sum += texture2D(tSource, vUv + vec2(-uHalfPixel.x, -uHalfPixel.y)) * 2.0;
    gl_FragColor = sum / 12.0;
  }
`;

// How far away what was drawn at a pixel is, and how far out of focus it is.
//
// Shared verbatim between the composite and the half resolution blur the
// selective focus is built from, because the two have to agree exactly: the
// blur weights every tap by the same circle of confusion the composite then
// blends with, and a second copy of that arithmetic would be a second decision
// about where the focal plane is.
//
// The distance is RADIAL rather than along the view axis, so the metre this
// works in is the metre every fog law in this world works in.
//
// The circle of confusion is in DIOPTRES — the difference of the reciprocals —
// and that is not a flourish, it is what a lens does: a thin lens focused at f
// spreads a point at d by something proportional to |1/f - 1/d|, which is why
// the far field saturates and the near field does not. On a focal plane at
// three metres, ten metres away is a third of the blur that infinity is, and
// one metre is twice it. A difference of distances would have had to be
// retuned for every focal plane; this one is tuned once.
// AND THE UNIT IT ALL WORKS IN IS THE DIOPTRE, which the third pass made
// explicit rather than incidental. `uFocusPlane` used to be metres, handed in
// from src/core/eye.js; it is now the RECIPROCAL of metres, read out of the one
// pixel probe below, and the change is not cosmetic:
//
//   * the circle of confusion is a difference of reciprocals, so the plane
//     arrives already in the form the arithmetic wants and a divide goes;
//   * A FOCUS PULL IS EVEN IN DIOPTRES AND NOT IN METRES. Damping the plane in
//     metres from three to forty spends nearly all of its motion in the first
//     tenth of a second and then crawls, because the eye is already at optical
//     infinity by then and is still travelling. Damped in dioptres it moves at
//     one rate the whole way, which is what a focus puller's hand does and what
//     the ciliary muscle does;
//   * and clamping how near and how far the eye will accommodate becomes a
//     clamp of one number between two, instead of two cases.
// HOW FAR THE WORLD IS AT A PIXEL, AND THERE IS ONE PRODUCER OF IT.
//
// Split out of the chunk below because it stopped being the defocus's private
// arithmetic: the depth service at the foot of this file lifts the same number
// into a buffer of its own so that an additive material can read it, and a
// second copy of these five lines would be a second opinion about where the
// world is. Four readers in this file and every soft particle in the world now
// stand on this one reconstruction.
//
// The distance is RADIAL rather than along the view axis, so the metre it works
// in is the metre every fog law in this world works in — and, now, the metre a
// material compares its own `length(viewPosition)` against.
const RAY_DISTANCE_GLSL = /* glsl */`
  uniform vec2 uCameraRange;   // near and far plane
  uniform vec2 uTanHalf;       // half the field of view, as a tangent, across and down

  float rayDistance(float depth, vec2 at) {
    float ndc = depth * 2.0 - 1.0;
    float near = uCameraRange.x;
    float far = uCameraRange.y;
    float viewZ = 2.0 * near * far / (far + near - ndc * (far - near));
    vec2 plane = (at * 2.0 - 1.0) * uTanHalf;
    return viewZ * length(vec3(plane, 1.0));
  }

  /** Metres to the world at this pixel. The sky wrote no depth and is at the far plane. */
  float sceneDistanceAt(float depth, vec2 at) {
    // The sky writes no depth, so it is still standing at the far plane; read
    // literally that is the distance it is at, and an eye leaning on a stone
    // two metres off does have a soft sky behind it.
    return depth >= 0.999999 ? uCameraRange.y : rayDistance(depth, at);
  }
`;

const DEPTH_GLSL = /* glsl */`
${RAY_DISTANCE_GLSL}
  uniform float uFocusSpread;  // dioptres to circle of confusion

  /** Where this pixel is, as a reciprocal of metres. The sky is at the far plane. */
  float dioptresAt(float depth, vec2 at) {
    return 1.0 / max(sceneDistanceAt(depth, at), 0.05);
  }

  float circleOfConfusion(float dioptres, float planeDioptres) {
    return clamp(abs(dioptres - planeDioptres) * uFocusSpread, 0.0, 1.0);
  }
`;

// ------------------------------------------------------------- THE ONE PIXEL
//
// Two things about this frame that only the frame knows, reduced to a single
// texel and carried forward in time there.
//
//   R  WHERE THE GAZE IS ACCOMMODATED, in dioptres. The depth at the middle of
//      the screen, damped into a focus pull.
//   G  HOW MUCH OF THE SUN'S DISC IS UNCOVERED, 0..1. The depth AT the disc,
//      damped asymmetrically, which is the hysteresis that keeps a flare from
//      flickering as grass crosses in front of it.
//
// WHY IT IS HERE AND NOT IN src/core/eye.js, which is where every other WHEN of
// this system lives. Both numbers are readings OF THE DEPTH BUFFER, and there
// is no way to put a depth buffer on the CPU that is not a readPixels; a
// readPixels is a fence across the pipeline that just drew the frame, which is
// eight to sixteen milliseconds of stall on a machine with a frame of queue, to
// learn one float. s2-dev7/VERBALE.md named the sede for exactly this kind of
// reading — "una riduzione della scena su GPU con ping-pong 1×1" — and this is
// it. The damping is done here too, in the shader, with the frame's own delta
// handed in, so it is framerate independent in the same way and by the same
// arithmetic as everything in eye.js.
//
// PING-PONG, and it costs two draws of ONE pixel. The previous value is read
// from the other texel of the pair; on the first frame after rest the snap
// flags take the measurement whole instead of approaching it, so an eye that
// has just opened is already accommodated rather than racking in from wherever
// it was left.
//
// AND A PSEUDO-MEDIAN AND NOT AN AVERAGE, which is the one line of this that is
// about THIS world. The gaze is sampled over a small rectangle at the middle of
// the frame, the way a camera's centre-weighted autofocus area is. An average
// over it would let a single blade of grass crossing the reticle at half a
// metre drag the plane in: at nine taps, one blade at 0.5 m against a ridge at
// thirty takes the mean from 0.03 dioptres to 0.25, which is a focal plane of
// four metres and a whole picture gone soft for one blade. A median of three
// rows and then of their three medians throws it away and costs three min-max
// pairs a row, on ONE pixel.
const PROBE_FRAGMENT = /* glsl */`
  precision highp float;
  uniform sampler2D tDepth;
  uniform sampler2D tPrev;      // the same one pixel, last frame
  uniform vec2 uProbeArea;      // half the autofocus rectangle, in uv
  uniform vec2 uProbeSnap;      // 1 = take it whole, 0 = follow it
  uniform vec3 uProbeTau;       // seconds: focus pull, sun opening, sun closing
  uniform float uDt;
  uniform vec2 uSunUv;          // where the disc landed on the glass
  uniform vec2 uSunProbe;       // radius of the ring of taps round it, in uv
  uniform vec2 uPlaneRange;     // dioptres: furthest and nearest it will go
${DEPTH_GLSL}

  float med3(float a, float b, float c) { return max(min(a, b), min(max(a, b), c)); }

  float look(vec2 at) { return dioptresAt(texture2D(tDepth, at).x, at); }

  /** Whether the sky is showing at a point, and 1 for a point off the glass. */
  float openAt(vec2 at) {
    vec2 c = clamp(at, 0.0, 1.0);
    float off = step(0.5, max(abs(at.x - 0.5), abs(at.y - 0.5)) - 0.5);
    return max(off, step(0.999999, texture2D(tDepth, c).x));
  }

  void main() {
    vec2 h = uProbeArea;
    // Three rows of three, over the autofocus rectangle.
    float r0 = med3(look(vec2(0.5 - h.x, 0.5 + h.y)), look(vec2(0.5, 0.5 + h.y)),
      look(vec2(0.5 + h.x, 0.5 + h.y)));
    float r1 = med3(look(vec2(0.5 - h.x, 0.5)), look(vec2(0.5, 0.5)),
      look(vec2(0.5 + h.x, 0.5)));
    float r2 = med3(look(vec2(0.5 - h.x, 0.5 - h.y)), look(vec2(0.5, 0.5 - h.y)),
      look(vec2(0.5 + h.x, 0.5 - h.y)));
    float wantPlane = clamp(med3(r0, r1, r2), uPlaneRange.x, uPlaneRange.y);

    // How much of the disc is uncovered: the middle of it and a ring of four
    // round its rim, so a monolith taking half the sun takes half the flare
    // with it instead of all or none of it. THE ANSWER FOR A DISC THAT IS OFF
    // THE GLASS IS "OPEN": this instrument cannot see what is not in the frame,
    // and the geometric fade in src/core/eye.js is what handles that case.
    vec2 s = uSunProbe;
    float wantOpen = (openAt(uSunUv) * 2.0
      + openAt(uSunUv + vec2(s.x, 0.0)) + openAt(uSunUv - vec2(s.x, 0.0))
      + openAt(uSunUv + vec2(0.0, s.y)) + openAt(uSunUv - vec2(0.0, s.y))) / 6.0;

    vec4 prev = texture2D(tPrev, vec2(0.5));
    float kPlane = 1.0 - exp(-uDt / max(1e-4, uProbeTau.x));
    // Quicker to uncover than to cover: what a flare does when the stone slides
    // off the sun is come back at once, and what it does when the stone slides
    // onto it is die away. That asymmetry IS the anti-flicker, and it is a
    // property of the eye rather than a filter bolted on top of one.
    float tauOpen = wantOpen > prev.y ? uProbeTau.y : uProbeTau.z;
    float kOpen = 1.0 - exp(-uDt / max(1e-4, tauOpen));
    // A BRANCH AND NOT A MIX AT ONE. The very first frame after rest reads a
    // buffer nobody has written, and whatever is in it may not be a number at
    // all; mix(prev, want, 1.0) is prev*0 + want, and nought times a NaN is a
    // NaN, which would then be carried forward for the life of the page. Asked
    // this way, the previous value is never touched on the frame that has none.
    gl_FragColor = vec4(
      uProbeSnap.x > 0.5 ? wantPlane : mix(prev.x, wantPlane, kPlane),
      uProbeSnap.y > 0.5 ? wantOpen : mix(prev.y, wantOpen, kOpen),
      wantPlane, wantOpen);
  }
`;

// The defocused copy of the frame: down to a quarter of the frame in each
// direction, and then WIDENED once at that size.
//
// Every tap is weighted by its OWN circle of confusion and the weight is kept
// in alpha, and that is the whole of what stops a sharp foreground smearing
// onto a background that is in focus: a tap that is in focus carries weight
// zero into the sum, so it contributes nothing to anybody else's blur. The
// composite divides the two back out.
//
// WHY ONE PASS AND NOT THE HALO'S CHAIN. The first version of this was the
// dual filter Kawase the bloom uses — prefilter to half, down to quarter, up to
// half — and it measured 1.472 ms at the high tier against a budget of 1.5 for
// the whole effect. Two thirds of that was traffic rather than arithmetic: a
// half resolution buffer of sixteen bit float is three megabytes written and
// then read again, and the pass that wrote it read the full frame and the full
// depth to do it. Folded into one step the intermediate does not exist: five
// taps, at a quarter resolution destination, and the composite enlarges the
// result with the hardware's own bilinear filter — which is free, and which the
// old chain's up pass was paying eight taps over half the frame to do slightly
// better on an image whose entire purpose is to be soft.
//
// The five taps and their weights are the halo's down step, unchanged, because
// it is the right kernel: a centre and four diagonals, which on a bilinear
// sampler reaches further than the taps it costs.
//
// AND THEN A SECOND PASS, WHICH THE SECOND PASS OF THIS UNIT ADDED. The
// committente could not see the defocus at all, and s2-dev8/out/diagnosi.txt
// says why in one number: standing in front of a face with the focus at 0.954,
// the whole effect moved the picture by three and a half levels out of 255 —
// under the four levels the grass moves on its own between two frames. So the
// amplitude had to go up several times over, and a five tap kernel spread that
// far does not blur, it makes a five pointed star: the taps stop overlapping
// and each one starts to be visible as itself.
//
// The repair is NOT half resolution, and that is a measured choice rather than
// a preference — see the note in `render` below. It is one more pass at the
// SAME quarter resolution, over the already premultiplied buffer, using the
// halo's up kernel verbatim: eight taps over a sixteenth of the frame, which is
// half a full frame tap's worth of fill and turns the five points into a smooth
// tent. Premultiplied colour and its weight are blurred together by the same
// kernel, so the division at the end still recovers the average of the taps
// that were actually out of focus.
//
// AND THE THIRD PASS ADDED THE TWO THINGS THAT MAKE IT A DEFOCUS RATHER THAN A
// BLUR, both of which the committente's "sembra finto" was pointing at.
//
// 1. THE RING IS TURNED, PER PIXEL. Four taps on a ring at fixed bearings is a
//    cross, and a cross spread eight pixels wide draws itself into the picture
//    as a cross: that is the five pointed star the second pass papered over
//    with a widening pass. Turning the ring by an angle taken from the pixel's
//    own hash makes the tap positions a different four every pixel, which turns
//    a structured artefact into noise — and noise at the scale of one texel is
//    what the widening pass and the dither at the end of the composite are
//    both already good at. It is the same trick as the dither in the sun's
//    march and it costs one sine.
//
// 2. A TAP BEHIND THIS PIXEL HAS TO EARN ITS PLACE. Premultiplying by the tap's
//    own circle of confusion is what stops a SHARP thing smearing over a soft
//    one, and it has been here since the first delivery. What it does not stop
//    is the other one: a soft BACKGROUND gathered into a pixel that is in
//    focus, which draws a halo of the far field round every sharp edge. The
//    rule from the depth of field literature is one line — a sample further
//    away than the pixel it is being gathered into only counts to the extent
//    that it is at least as out of focus as that pixel is — and it is a
//    bilateral weight in the plainest sense: how much a neighbour is allowed to
//    say depends on how far away it is compared with here.
const FOCUS_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSource;
  uniform sampler2D tDepth;
  uniform sampler2D tProbe;
  uniform vec2 uStep;
  uniform float uInkKeep;      // 1 = the ink is held sharp, so it does not smear
  uniform vec2 uGlow;          // the bloom's threshold and knee, and no others
  // THE WAKING, AND IT IS NOT A FOCUS. Nought except while the opening scene is
  // opening a pair of eyes, and while it is, a FLOOR under every tap's weight:
  // a shut eye is not accommodated on the wrong plane, it is uniformly soft
  // over the whole picture, so what this buffer has to hold is a plain blur and
  // not a depth of field. Guarded rather than mixed, so at nought this pass is
  // arithmetically the pass it has always been — see the composite.
  uniform float uWake;
${DEPTH_GLSL}
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }
  // WHAT AN EMISSIVE IS, and it is the composite's answer read at a quarter of
  // the frame: bright, and not the sky. The threshold and the knee are the
  // bloom's own, handed in, so this pass cannot drift away from the mask the
  // composite uses to decide what stays sharp.
  float inkAt(vec3 rgb, float depth) {
    return (1.0 - step(0.999999, depth))
      * smoothstep(uGlow.x - uGlow.y, uGlow.x + uGlow.y, max(rgb.r, max(rgb.g, rgb.b)));
  }
  void main() {
    float plane = texture2D(tProbe, vec2(0.5)).x;
    float hereDepth = texture2D(tDepth, vUv).x;
    float here = dioptresAt(hereDepth, vUv);
    float cocHere = circleOfConfusion(here, plane);

    // ------------------------------------- AND THE INK DOES NOT GO IN THE POT
    //
    // The fifth pass holds the writing sharp wherever it is (see the composite),
    // and doing that in the composite ALONE leaves half the job undone — which
    // took a picture to see rather than a number. Keeping the glyph's own pixels
    // sharp does nothing about its NEIGHBOURS, and they are still taking this
    // buffer in full, and this buffer still has the glyph's light smeared
    // thirteen pixels through it. What came out was a sharp letter sitting in a
    // ring of its own glow: «un francobollo nitido dentro il blur», named in the
    // mandate before it was drawn, and the ring measured +23 levels one pixel
    // out from the letters and +39 at four.
    //
    // Widening the keep in the composite cannot reach it either, and the reason
    // is arithmetic rather than tuning: light from a glyph spread over thirteen
    // pixels of stone is under the bloom's threshold within a pixel or two of
    // the letter, so a mask taken off the blurred copy by the SAME threshold —
    // and it has to be the same threshold — is nought exactly where the ring is.
    //
    // So the light is stopped at the source. A tap that is ink contributes
    // NEITHER its colour NOR its weight, so what the division at the end
    // recovers is the average of the taps that were out of focus AND were not
    // writing. Where every tap is ink the weight goes to nought and the
    // composite's own fallback hands back the sharp scene, which is the right
    // answer for the inside of a letter that is being held sharp anyway.
    //
    // Gated by uInkKeep, so at nought this pass is what it was to the bit.
    float inkHere = inkAt(texture2D(tSource, vUv).rgb, hereDepth);
    float keepHere = cocHere * (1.0 - uInkKeep * inkHere);
    // A shut eye holds nothing sharp, the writing least of all: the floor goes
    // on AFTER the ink's keep, or the one thing the walker would see clearly
    // through closed lids would be the engravings.
    if (uWake > 0.0) keepHere = max(keepHere, uWake);

    vec4 sum = vec4(texture2D(tSource, vUv).rgb * keepHere, keepHere) * 4.0;
    // The ring, turned by this pixel's own angle.
    // A circle in PIXELS, which is an ellipse in uv: uStep already carries the
    // frame's shape, so the ring is round on the glass rather than round in a
    // coordinate nobody is looking at.
    float a = hash(vUv) * 6.2831853;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 e = dir * uStep;
    vec2 f = vec2(-dir.y, dir.x) * uStep;
    for (int i = 0; i < 4; i++) {
      vec2 off = i == 0 ? e : (i == 1 ? -e : (i == 2 ? f : -f));
      vec2 at = clamp(vUv + off, vec2(0.0), vec2(1.0));
      float depth = texture2D(tDepth, at).x;
      float there = dioptresAt(depth, at);
      float coc = circleOfConfusion(there, plane);
      // Behind this pixel, and how much further out of focus it is than here.
      float behind = step(there, here - 1e-5);
      float allow = mix(1.0, clamp(1.0 + coc - cocHere, 0.0, 1.0), behind);
      vec3 rgb = texture2D(tSource, at).rgb;
      float w = coc * allow * (1.0 - uInkKeep * inkAt(rgb, depth));
      if (uWake > 0.0) w = max(w, uWake);
      sum += vec4(rgb * w, w);
    }
    gl_FragColor = sum / 8.0;
  }
`;

// AND A BILATERAL WIDENING OF IT WAS BUILT, MEASURED, AND TAKEN BACK OUT.
//
// It is written down rather than quietly dropped, because the reasoning that
// led to it is the reasoning anybody would follow again. The blurred copy is
// widened by the bloom's own up kernel, which has no idea where the edges are:
// a silhouette texel is honestly about the sky, the widening spreads it two
// texels — eight pixels of the finished frame — into the stone and spreads its
// WEIGHT with it, so the texels it lands on come out claiming to be stone while
// carrying sky. The obvious repair is the rule the blur pass already applies
// per tap: a neighbour counts to the extent that it is talking about a surface
// at this distance. It was built in both places — a depth aware widening, and a
// joint bilateral enlargement in the composite that walked the four quarter
// texels by hand instead of taking one bilinear tap.
//
// AND THEN IT WAS PRICED, AND THE PRICE DECIDED IT (s2-dev12/out/soglia.txt and
// costo-appaiato.txt, the two trees on one clock in one window, legs alternated):
//
//   what it bought   the halo inside a silhouette, 5-8 px in:  1.35 -> 1.31
//                    the halo round the engraving:             no change at all
//   what it cost     the composite, ON EVERY FRAME:            +3.19 ms
//                    the widening, on frames that defocus:     +0.57 ms
//
// Four hundredths of a level for three and a fifth milliseconds a frame,
// including frames with no eye in them at all — the enlargement's register
// pressure is paid by the whole shader whether its branch is taken or not. It
// is not a trade, and the reason it bought so little is the finding: by the
// time a texel is contaminated the contamination is INSIDE it rather than
// between its neighbours, so no weighting of the neighbours can reach it. What
// actually removes the halo is uFocusFloor, in the composite, and it is free.

// ---------------------------------------------------------------- THE RAYS
//
// Light coming through the gaps, from the disc of the sun, in screen space.
//
// WHY THIS EXISTS AT ALL. The first delivery of this unit had a glare that was
// a VEIL — one law of the angle between a ray and the sun, laid under the whole
// picture. It was correct and it was nameless, and the committente's answer to
// it was "non ho capito cosa sia questo abbaglio direzionale, né lo percepisco".
// What he asked for instead has a name everybody already knows, and this is it.
//
// The method is the standard one and the whole of it is in three lines: march
// from this pixel towards where the sun landed on the glass, sampling as you
// go, and add up what you find, dimmer with every step. What that adds up to is
// the light that scattered along the line of sight — so a pixel whose line to
// the sun passes over open sky gets a lot of it, and a pixel whose line passes
// behind a monolith gets none.
//
// THE MASK IS THE WHOLE EFFECT, and it is made of three questions:
//
//   IS IT SKY?     the only question that needs the depth buffer, and the one
//                  that makes the rays into rays: anything that wrote depth is
//                  something standing in the light, so the monoliths and the
//                  ridge cut the beams and the beams fan out round them. This
//                  is the committente's "i raggi nascono dove il cielo e le
//                  nuvole lasciano passare".
//   IS IT NEAR THE DISC?  an analytic falloff round where the sun actually is,
//                  rather than a threshold on how bright the sky happens to be.
//                  It has to be analytic: THIS sky is over the bloom threshold
//                  almost everywhere, so a mask made of brightness alone would
//                  call the entire dome a source and the rays would come out as
//                  a wash instead of as beams.
//   AND HOW BRIGHT IS IT THERE?  which is the cloud, doing what a cloud does.
//                  A dark cloud crossing the disc takes its own light out of
//                  the sum, so the beams thin and break as it passes, with no
//                  cloud machinery here at all.
//
// AND THE COLOUR COMES FROM THE SKY ITSELF, which is the palette answered by
// construction rather than by a swatch: what is added to the frame is what was
// sampled off the dome S1 sealed, warmed a little by the tint and no more.
const SUNRAYS_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSource;
  uniform sampler2D tDepth;
  uniform vec2 uSunUv;         // where the disc landed on the glass
  uniform float uAspect;       // so "near the disc" is a circle and not an ellipse
  uniform vec4 uRay;           // density · decay · weight · disc radius squared
  uniform vec2 uRayBright;     // threshold and knee: how bright counts as light

  // TWELVE STEPS, AND A DITHER, and both numbers were bought with a measurement
  // rather than chosen.
  //
  // The march is the most expensive thing this file draws, and the first version
  // of it was 2.15 ms at the high tier — more than the whole defocus, for what
  // is a second order flourish. Taking it from a quarter of the frame to an
  // eighth barely moved it (1.94 ms), and THAT is the finding: at an eighth
  // there are twenty five thousand pixels, which is too few threads for the
  // machine to hide the latency of a dependent texture fetch behind, so this is
  // LATENCY bound and not FILL bound. Paired readings, on the same page, same
  // resolution:
  //
  //     4 steps  0.53 ms        20 steps  1.94 ms
  //
  // which is 0.088 ms a step and 0.18 ms of fixed cost. So the only lever with
  // any leverage on it is the step count — and a step count low enough to be
  // affordable BANDS, because the samples stop overlapping and each one draws
  // its own faint ring round the sun.
  //
  // The dither is what buys the steps back. Starting each pixel's march at its
  // own fraction of a step turns that banding into noise at the scale of one
  // pixel, which the eye integrates and the dither at the end of the composite
  // hides the rest of. It is the oldest trick in volumetric rendering and it
  // costs one hash.
  const int STEPS = 12;

  void main() {
    // From this pixel towards the sun, in equal steps. The march is TOWARDS the
    // disc rather than away from it, so every sample is a place the light would
    // have had to come through to arrive here.
    vec2 delta = (vUv - uSunUv) * (uRay.x / float(STEPS));
    vec2 at = vUv - delta * fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
    float decay = 1.0;
    vec3 sum = vec3(0.0);
    for (int i = 0; i < STEPS; i++) {
      at -= delta;
      // Outside the frame there is no scene to ask, and a wrapped or clamped
      // read there would smear the frame's own edge along every beam. Clamped
      // to the border and then weighted to nothing, which is the honest answer:
      // this instrument cannot see what is off the glass.
      vec2 c = clamp(at, 0.0, 1.0);
      float outside = step(0.5, max(abs(at.x - 0.5), abs(at.y - 0.5)) - 0.5) ;
      float depth = texture2D(tDepth, c).x;
      // The sky writes no depth. That is the question, and it costs one compare.
      float sky = step(0.999999, depth);
      vec3 light = texture2D(tSource, c).rgb;
      float lum = max(light.r, max(light.g, light.b));
      vec2 off = (c - uSunUv) * vec2(uAspect, 1.0);
      float disc = exp(-dot(off, off) / max(1e-5, uRay.w));
      float bright = smoothstep(uRayBright.x - uRayBright.y, uRayBright.x + uRayBright.y, lum);
      sum += light * (sky * disc * bright * decay * (1.0 - outside));
      decay *= uRay.y;
    }
    gl_FragColor = vec4(sum * (uRay.z / float(STEPS)), 1.0);
  }
`;

const COMPOSITE_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tGlow;
  uniform sampler2D tBloom;
  uniform sampler2D tLut;
  uniform sampler2D tDepth;
  uniform sampler2D tFocus;
  uniform sampler2D tRays;
  uniform sampler2D tProbe;
  uniform float uExposure;
  uniform float uBloomStrength;
  uniform float uLutIntensity;
  uniform float uLutSize;
  // bit mask: 1 bloom, 2 tone map, 4 grade, 16 dither, 32 scene grade,
  // 64 focus, 128 adaptation, 256 glare, 512 rain, 1024 the sun in view.
  // Bit 8 was the permanent vignette and is now unused: the corner shading of
  // this picture lives in src/ui/veil.js and nowhere else.
  uniform float uStages;

  // The second stage of the grade: the scene's own, which the sky may not read.
  uniform float uSceneBlack;   // the toe, in encoded levels
  uniform float uSceneGain;    // contrast about the pivot
  uniform float uScenePivot;
  uniform float uSceneKnee;    // where the curve stops being a line and bends
  uniform vec3 uShadowTint;    // what shadow is made of, as a multiply
  uniform float uShadowRange;  // and how far up the range it reaches
  uniform float uSceneAmount;  // how much of it the scene takes, at every distance
  uniform vec2 uSceneHorizon;  // metres: the correction fades out between these two
  uniform float uGlowThreshold;
  uniform float uGlowKnee;
${DEPTH_GLSL}

  // ------------------------------------------------------------- THE EYE
  //
  // Four things a body's own optics do, over the picture the grade has already
  // finished making. Every one of them is driven from src/core/eye.js and every
  // one of them is EXACTLY nothing while its own number is at rest — not a
  // multiply by one, not a mix by zero: the branch is not taken, because a
  // placed pose has to be photographable twice at the byte.
  uniform float uEyeExposure;  // the adaptation, as a factor; exactly 1.0 at rest
  uniform float uFocusAmount;  // how much of the defocus is showing, 0..1
  uniform float uFocusInkKeep; // how much of the ink refuses to defocus, 0..1
  uniform float uFocusReachPx; // how wide the blur is, in pixels of the frame
  uniform vec2 uFocusFloor;    // and the circle, in pixels, under which it is nothing
  // ------------------------------------------------------------- THE WAKING
  //
  // A SEPARATE CHANNEL, AND IT HAS TO BE. The four above are the eye's, and the
  // eye's own rule is that its effects wait for the first step — which is what
  // makes a placed pose photographable twice. These two are written by the
  // opening scene and by nothing else, and the opening scene does not exist
  // under ?dev at all, so the seal that rule protects is untouched by their
  // being here. At rest — nought and one — every branch they guard is not
  // taken, and the arithmetic of this frame is LITERALLY the arithmetic of the
  // frame before they were added.
  uniform float uWakeBlur;     // 0..1, how shut the eyes still are
  uniform float uWakeExposure; // a factor on the finished picture; exactly 1.0 at rest
  uniform vec3 uSunView;       // the sealed sun, in the frame's own axes
  uniform float uGlare;        // the veil towards it; 0 at rest
  uniform vec2 uGlareEdge;     // cosines: where the veil starts and where it is full
  uniform vec3 uGlareTint;
  // The sun IN the picture: how much of the disc is on the glass, and where.
  // Both at rest until the walker is looking at it, and the branch they guard
  // is not taken when they are.
  uniform float uSun;          // 0 at rest; the rays and the flare are its
  uniform vec2 uSunUv;         // where the disc landed, in the frame's own uv
  // Whether the one pixel is answering about the disc THIS frame. It is the
  // guard on the read and not a dose: a frame nobody ran the probe for has an
  // unbound sampler where the occlusion should be, and a veil multiplied by
  // whatever an unbound sampler returns is a veil that switches itself off for
  // a reason nobody can name. Nought means "nothing was measured", and the
  // honest answer for a disc nobody measured is UNCOVERED.
  uniform float uSunProbed;
  uniform float uRaysAmount;   // how much of the marched rays is added
  uniform vec3 uRaysTint;
  uniform vec4 uFlare;         // halo radius² · halo · streak fall · streak
  uniform float uFlareHeight;  // how tight the streak is, up and down
  uniform vec3 uFlareTint;
  uniform vec2 uStreak;        // how much the streak breathes, and its own clock
  // THE GHOSTS. Three of them, on the line from the disc through the middle of
  // the frame, because that is the line the reflections between two lens
  // elements actually land on: a ghost is the source imaged again by a pair of
  // surfaces, and a pair of spherical surfaces on a common axis can only put it
  // on the axis. x·y·z are how far along that line each one sits, as a multiple
  // of the distance from the disc to the middle.
  uniform vec3 uGhostAt;
  uniform vec3 uGhostSize;     // and how wide each one is, as a radius²
  uniform vec3 uGhostGain;     // and how much light each one carries
  uniform vec3 uGhostTint;     // the cool end; the warm end is uFlareTint
  uniform float uAspect;       // width over height, for circles that stay round
  // The drops. See rainAt below: the shape of this changed completely in the
  // second pass and the uniforms with it.
  uniform vec4 uRain;          // amount · seconds · columns · aspect
  uniform vec4 uRainDrop;      // density · size · refraction · highlight
  uniform vec4 uRainTrail;     // strength · drying · mist rows · mist density
  uniform vec4 uRainWet;       // wetness · micro streak · turn drag · what it sweeps up
  uniform vec2 uRainDrag;      // how the eye behind the glass is moving

  bool stage(float bit) { return mod(floor(uStages / bit), 2.0) == 1.0; }

  const mat3 SRGB_TO_REC2020 = mat3(
    0.6274, 0.0691, 0.0164,
    0.3293, 0.9195, 0.0880,
    0.0433, 0.0113, 0.8956);
  const mat3 REC2020_TO_SRGB = mat3(
     1.6605, -0.1246, -0.0182,
    -0.5876,  1.1329, -0.1006,
    -0.0728, -0.0083,  1.1187);
  const mat3 AGX_INSET = mat3(
    0.856627153315983, 0.137318972929847, 0.11189821299995,
    0.0951212405381588, 0.761241990602591, 0.0767994186031903,
    0.0482516061458583, 0.101439036467562, 0.811302368396859);
  const mat3 AGX_OUTSET = mat3(
     1.1271005818144368, -0.1413297634984383, -0.14132976349843826,
    -0.11060664309660323, 1.157823702216272, -0.11060664309660294,
    -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
  const float AGX_MIN_EV = -12.47393;
  const float AGX_MAX_EV = 4.026069;

  vec3 agxContrast(vec3 x) {
    vec3 x2 = x * x;
    vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4
      - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  }

  vec3 agx(vec3 colour) {
    colour = SRGB_TO_REC2020 * colour;
    colour = AGX_INSET * colour;
    colour = max(colour, 1e-10);
    colour = (log2(colour) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV);
    colour = agxContrast(clamp(colour, 0.0, 1.0));
    colour = AGX_OUTSET * colour;
    colour = pow(max(colour, 0.0), vec3(2.2));
    colour = REC2020_TO_SRGB * colour;
    return clamp(colour, 0.0, 1.0);
  }

  // The grade is a cube of size N unrolled into a strip N*N wide and N tall.
  // Sampling stays half a texel inside each slice, so the hardware filter never
  // blends across a slice boundary and only the blue axis is mixed by hand.
  vec3 grade(vec3 colour) {
    float n = uLutSize;
    vec3 c = clamp(colour, 0.0, 1.0);
    float blue = c.b * (n - 1.0);
    float slice = floor(blue);
    float t = blue - slice;
    float u = (0.5 + c.r * (n - 1.0)) / n;
    float v = (0.5 + c.g * (n - 1.0)) / n;
    vec3 low = texture2D(tLut, vec2((slice + u) / n, v)).rgb;
    vec3 high = texture2D(tLut, vec2((min(slice + 1.0, n - 1.0) + u) / n, v)).rgb;
    vec3 graded = mix(low, high, t);
    // AND THE FLOOR IS CLOSED HERE, WHICH IS NOT A TASTE.
    //
    // The cube is fitted and then written into eight bit pixels, so its answer
    // to a fragment with NO LIGHT IN IT is not exactly black: the corner texel
    // of the shipped cube rounds to (0, 0, 1) and that one level of blue is
    // what a black fragment comes out as. Measured on this machine, world
    // hidden and the buffer left at its own clear: a linear nought developed
    // through the whole chain reads (0, 0, 1), and it reads (0, 0, 0) with this
    // stage alone switched off. A grade may bend a picture; it may not put
    // light where the world put none, and the places that notice are exactly
    // the ones with none — a shadowed joint of the paving, the underside of a
    // tuft — where one level of blue and no red is a COLOUR and not a shade.
    //
    // So the cube is anchored on its own black rather than corrected by a
    // number somebody chose: what it returns for black is taken off, and the
    // remainder is stretched back over the range it left. White is unmoved
    // because the shipped cube's white corner is exactly 255 and the stretch is
    // by (1 - black); mid grey moves by half a level of blue, which is the
    // half level the round put there. It is one more tap on a texture already
    // resident and sampled twice.
    vec3 black = texture2D(tLut, vec2(0.5 / (n * n), 0.5 / n)).rgb;
    return clamp((graded - black) / max(1.0 - black, vec3(1e-4)), 0.0, 1.0);
  }

  vec3 encodeSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  /**
   * One ghost: the sun imaged again by a pair of surfaces inside the lens.
   *
   * THE COMMITTENTE ASKED FOR THESE AND THE SECOND PASS LEFT THEM OUT — "flares
   * assenti" — so the restraint that kept them out is worth restating rather
   * than abandoning. What dates a picture is a CHAIN of hard bright circles
   * down the diagonal. What a real lens makes is a few soft discs on the axis
   * through the middle of the frame, carrying the shape of the aperture: an
   * even body, a slightly brighter rim where the cone of the reflection piles
   * up at the edge of the stop, and nothing at all outside it. There are three,
   * they are dim, and they move the way a ghost moves — across the frame as the
   * sun goes the other way, which is the part that cannot be faked by a sprite.
   */
  float ghost(vec2 d, vec2 axis, float where, float size) {
    vec2 g = d - axis * where;
    float r = length(g) / max(1e-4, size);
    float body = 1.0 - smoothstep(0.45, 1.0, r);
    float rim = exp(-(r - 0.84) * (r - 0.84) * 30.0) * 0.55;
    return (body * 0.62 + rim) * (1.0 - smoothstep(1.0, 1.22, r));
  }

  // A floor the curve bends down to instead of hitting.
  //
  // Above the knee this is the identity, so the shape that was fitted is the
  // shape that is drawn; below it the line turns into an exponential with the
  // same value and the same slope at the join, and approaches zero without
  // arriving. What that buys is the reason it exists: a straight contrast about
  // a pivot puts everything under a certain level at exactly zero, and a picture
  // whose shadows are all one flat black has thrown away the part of the
  // reference that is most full of detail.
  float softFloor(float v, float knee) {
    return v >= knee ? v : knee * exp((v - knee) / max(knee, 1e-4));
  }

  // How much of the scene's own grade this pixel takes.
  //
  // Zero on the sky, and that is the whole reason this pass reads the depth
  // buffer: the curve that brings this world's ground to the reference moves the
  // sky by fifty levels (s2-analisi1/RAPPORTO.md section 4.5), and the sky is
  // sealed. The sky writes no depth, so it is still standing at the far plane
  // and reads as nothing at all.
  //
  // Then ONE ramp, and there used to be two.
  //
  // The one that is here fades the correction out towards the horizon, over the
  // same distances at which the haze finishes taking the ground: forty four per
  // cent of the way at sixty metres and ninety seven at a hundred and fifty. A
  // surface that is nearly all air has to be graded nearly like the air above
  // it, or the ridge line is a drawn line. And because it follows the air, what
  // it does as the walker moves is what the air already does as the walker
  // moves, which is a thing the reference has and nobody objects to.
  //
  // THE ONE THAT IS GONE was stronger on ground close to the eye than on ground
  // beyond it, and the measurement said to put it there: over the mask of
  // uncontradicted ground the reference wants about half the light this world
  // gives the meadow at four metres and rather more than it gives at eight. It
  // was still wrong, and the committente found it by walking — "the ground
  // further off is light, then I get closer and it goes dark, why?" A term
  // hung on the distance from the CAMERA travels with the walker, so it is not
  // a property of the meadow at all, it is a patch of shade that follows you:
  // exactly the unexplained stain this session exists to remove. The near
  // field of the reference is dark because of the arrival framing, which is in
  // src/ui/veil.js and goes when the arrival goes, and because of shadow that
  // has a cause standing in the world. Not because of a radius round the eye.
  float sceneWeight(float depth, vec2 at) {
    if (depth >= 0.999999) return 0.0;
    float d = rayDistance(depth, at);
    return uSceneAmount * (1.0 - smoothstep(uSceneHorizon.x, uSceneHorizon.y, d));
  }

  // ------------------------------------------------------------- THE DROPS
  //
  // Water on the glass in front of the eye, and there is no glass and no photo
  // of one: this is arithmetic, so the frame that never switches it on has
  // fetched no texture for it, and the frame that does still has not.
  //
  // REBUILT, TO THE COMMITTENTE'S OWN LIST. What the first delivery had was a
  // grid of a hundred and eighty small beads that slid at a constant speed and
  // vanished at the moment their cell ran out. He gave four faults and they are
  // the specification this answers, one by one:
  //
  //   "sono troppe"                 → SEVEN OR EIGHT, not a hundred and eighty.
  //                                   Two slots to a column, most of them empty,
  //                                   and each survivor several times the size.
  //   "non formano traiettorie"     → a drop does not fall at a constant speed.
  //                                   It STICKS AND SLIPS: surface tension holds
  //                                   it, weight wins, it runs, it catches
  //                                   again. That is the shape of slide() below
  //                                   and it is why the motion reads as water
  //                                   rather than as an object being moved down
  //                                   the screen. On top of it, a meander, and
  //                                   a lean from the eye's own turning.
  //   "non hanno effetto ... scivolio" → what a running drop leaves is a TRAIL,
  //                                   narrower than the head, tapering behind
  //                                   it, DRYING as it ages. The path is a
  //                                   function of how far the drop has fallen,
  //                                   so the trail is found by asking the path
  //                                   where it was when it was at this height —
  //                                   no inversion, no history, no buffer.
  //   "scompaiono all'improvviso e   → a drop ends one of two ways and neither
  //    non come farebbe l'acqua"       is a disappearance. It THINS — its radius
  //                                   is taken to nothing over the last fifth of
  //                                   its life while the trail behind it dries —
  //                                   or it MERGES, because the beads are
  //                                   combined with a smooth union, so two that
  //                                   touch become one bigger bead with a waist
  //                                   between them instead of two circles
  //                                   overlapping.
  //
  // And under all of it, the thing he asked for that is not a drop at all: the
  // WET GLASS. A fine veil of static micro beads that breathe in and out like
  // condensation, plus a low frequency refraction and a micro streak over the
  // whole frame while it is raining. That is the mist below, and uRainWet.
  //
  // Everything is scaled by the amount, so all of it fades in and out together
  // and none of it is anywhere at rest.

  // The smooth union that makes two beads one. Ordinary max gives two circles
  // with a crease where they cross; this bulges the join, which is what surface
  // tension does, and it is the whole of "merging" as a two line function.
  float smoothMax(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(a, b, h) + k * h * (1.0 - h);
  }

  // How far down a drop has run, after a time in its own life.
  //
  // NOT A STRAIGHT LINE AND NOT A PARABOLA. A bead on a vertical pane is held
  // by its own surface tension until it is heavy enough to break away, runs,
  // and catches again — so the curve is a rise with plateaus in it, made by
  // taking a slow sine out of a straight line. The subtraction is bounded under
  // one, so the result never goes backwards: a drop that ran up the glass would
  // be the one artefact this shape can have.
  // THE THIRD PASS MADE THE CATCHING HARDER AND MADE IT ITS OWN PER DROP. The
  // committente's word for the second delivery was that the drops were "troppo
  // grandi" with "traiettorie a serpente strane", and the serpent was two
  // faults at once: a lateral swing that was far too wide, and every bead
  // pausing on the same beat as its neighbour, which reads as choreography
  // rather than as water. "grip" is how completely the bead stops between runs
  // — held under one, strictly, because the derivative is 1 - grip·cos and a
  // drop that ran back UP the glass is the one artefact this shape can have —
  // and "beats" is how many times it does it, which is a different number for
  // every drop.
  float slide(float s, float grip, float beats) {
    float w = 6.2831853 * beats;
    return clamp(s - grip * sin(w * s) / w, 0.0, 1.0);
  }

  // Four numbers out of one hash, so a drop costs one sine and not four.
  vec4 seedsOf(vec2 id) {
    float h = hash(id + 0.5);
    return fract(vec4(h, h * 71.317, h * 1013.71, h * 5619.13));
  }

  // Where the bead is, across the glass, after it has fallen this far.
  //
  // A FUNCTION OF THE FALL AND OF NOTHING ELSE, which is what lets the shape it
  // leaves behind be found without remembering anything: ask it where the drop
  // was when it was at this height and it answers with a division.
  //
  // NEARLY VERTICAL, WITH A JITTER, AND NEVER A SERPENT. The second delivery
  // swung each bead by nearly twice its own radius on a clean slow sine, which
  // at the size it was drawing is fifty pixels of sideways travel in a smooth
  // wave: that was the "traiettorie a serpente strane". What a bead actually
  // does is fall down the glass and TWITCH — the contact line lets go on one
  // side before the other and it steps a fraction of its own width sideways. So:
  // a fifth of a radius, on two frequencies that do not divide into each other
  // so the path never repeats a shape, plus a fixed lean of its own because no
  // pane is exactly plumb and no drop is exactly round.
  //
  // AND THE SIZE IN HERE IS THE ONE IT WAS BORN AT, never the one it happens to
  // be drawn at. A path that narrowed as the bead dried would be a bead that
  // slid sideways while it evaporated.
  float dropX(float fall, float mid, float born, vec4 s, float lean) {
    return mid + born * 0.20 * (sin(fall * 23.0 + s.y * 6.2831853)
        + 0.6 * sin(fall * 9.7 - s.z * 6.2831853))
      + (s.y - 0.5) * 2.0 * born * fall
      + lean * fall;
  }

  // HOW WIDE THE WATER IS AT A HEIGHT, IN THE BEAD'S OWN FRAME — and what this
  // one function draws is the whole of the committente's verdict on the fourth
  // delivery:
  //
  //     «sembrano SPERMATOZOI ... la forma non assomiglia a gocce reali»
  //
  // He was right, and the shape said so in its own arithmetic. The fourth pass
  // put the water behind the bead at THREE TENTHS of the bead's width and held
  // it there for the whole length of the run, then lit it with a term that
  // peaks at the MIDDLE of the water. A small round head with a long thin
  // bright line coming out of the top of it is not a raindrop; it is the thing
  // he named, and naming it was the correct reading of what was drawn.
  //
  // ---------------------------------------------------------------------------
  // WHAT A PHOTOGRAPH OF A RAINY PANE ACTUALLY SHOWS. Two of them, measured
  // rather than recalled, by s2-dev13/riferimento.mjs — both Wikimedia Commons,
  // both free:
  //
  //   File:20160107Regen Hockenheim3.jpg — three beads that have run. Their
  //     heads come out 1.22, 1.42 and 1.84 times as long as they are wide:
  //     ROUNDISH, barely stretched. The track each has left measures, at its
  //     widest, 69%, 97% and 100% OF THE HEAD'S OWN WIDTH, and narrows from
  //     there. Not one of them carries anything a pixel wide.
  //   File:Rain drops on a glass.jpg — 384 pieces of water in one window, of
  //     which 34 — EIGHT AND NINE TENTHS PER CENT — are more than twice as tall
  //     as they are wide. The median piece is 1.44. A rainy pane is a field of
  //     STANDING DOMES with a few runners in it.
  //
  // And the literature says the same about the trace and adds the part a
  // photograph cannot. Le Grand, Daerr and Limat, "Shape and motion of drops
  // sliding down an inclined plane" (J. Fluid Mech. 541, 2005), and the review
  // of the same problem in Droplets 5(4) 2024: what a running drop leaves is a
  // film of slowly decreasing WIDTH, and its THICKNESS is far smaller than the
  // drop's diameter. That last clause is the whole reason the track must be
  // nearly invisible while being nearly as wide as the bead — a film that thin
  // bends hardly any light. Width and contrast are separate facts about it, and
  // the fourth pass had them the wrong way round on both counts.
  // ---------------------------------------------------------------------------
  //
  // So: ONE field, still, and no boundary in it — below the bead a nose, which
  // is the meniscus gravity pulls down; the bead; and above it the water it has
  // left, which leaves the head at NINE TENTHS OF THE HEAD'S WIDTH and narrows
  // in two stages, because that is what the photograph shows. All of it joined
  // by the smooth union this file already uses when two beads meet.
  //
  // thick comes back as well, and it is the second half of the repair: how
  // much of the water HERE is bead rather than film. One at the middle of the
  // head, nought out along the track. Everything the pass does with the water
  // is weighted by it, so the head refracts like a lens and the track refracts
  // like almost nothing, out of one shape and one number.
  float waterHalf(float dy, float radius, float travel, float came, float drying,
      out float thick) {
    float down = max(0.0, -dy) / max(radius * 1.24, 1e-5);
    float back = max(0.0, dy);
    float up = back / max(radius * 0.94, 1e-5);
    // The bead: an ellipse a little longer below than above, which is what
    // gravity does to a drop held on a pane — and only a LITTLE, because the
    // photograph says the median standing drop is 1.44 tall against wide and
    // the committente says «quasi quanto largo».
    float bead = sqrt(max(0.0, 1.0 - down * down)) * sqrt(max(0.0, 1.0 - up * up));
    // And the water it has left behind, which exists only as far back as the
    // bead has actually come. TWO TERMS, two pieces of water, and the numbers
    // are the photograph's rather than anybody's taste:
    //
    //   0.55 falling over a couple of radii — the MENISCUS drawn out behind the
    //     bead, which is why the track leaves the head at nearly the head's own
    //     width instead of stepping down to a line;
    //   0.36 drying with age — the WET TRACK proper, which is what is still
    //     there a whole bead-length later, narrowing as it dries.
    //
    // They come to 0.91 of the bead's width at the shoulder, inside the eighty
    // to ninety five per cent the committente asked for, and they both go to
    // NOUGHT rather than to a floor. The fourth pass had 0.70 over a THIRD of a
    // radius and 0.30 for the rest of the fall, which is a head with a thread
    // out of it: nine tenths of the length of that shape was at three tenths of
    // the width, and three tenths of a bead is a filament.
    //
    // AND IT IS NOTHING AT ALL BELOW THE BEAD, which took a picture to find in
    // the fourth pass and is kept: "back" is the distance ABOVE the head and is
    // clamped at nought, so without the step the film reads as full width all
    // the way down the nose and the drop comes out as a rounded rectangle with
    // a flat bottom.
    float age = back / max(travel, 1e-4);
    float film = step(1e-6, dy) * (0.55 * exp(-back / max(radius * 2.6, 1e-5))
        + 0.36 * exp(-age * drying))
      * (1.0 - smoothstep(came * 0.70, came + 1e-4, back));
    float here = smoothMax(bead, film, 0.10);
    thick = clamp(bead / max(here, 1e-5), 0.0, 1.0);
    return radius * here;
  }

  /**
   * The glass, at a point.
   *
   * Returns the displacement it puts on the coordinate the whole pass reads
   * from, and how much light its shoulders catch.
   */
  vec3 rainAt(vec2 at) {
    float amount = uRain.x;
    float t = uRain.y;
    float cols = uRain.z;
    float aspect = uRain.w;
    // Square on screen: x is carried in units of the frame's HEIGHT, so a bead
    // is round and stays round when the window changes shape.
    vec2 p = vec2(at.x * aspect, at.y);
    float cw = aspect / cols;

    vec2 push = vec2(0.0);
    float lit = 0.0;
    float field = 0.0;
    // THE WET TRACK, kept apart from the beads and gathered separately, because
    // it is not made of the same stuff as them: how much of the glass here is
    // under a film. Spent once, at the bottom.
    float wetIn = 0.0;

    // ------------------------------------------------ the beads on the pane
    //
    // Its own column and the two beside it: a drop leans out of its column when
    // the eye turns, and a bead cut in half by a line nobody can see is the one
    // artefact a column scheme can have.
    float home = floor(p.x / cw);
    for (int c = -1; c <= 1; c++) {
      for (int j = 0; j < 3; j++) {
        vec2 id = vec2(home + float(c), float(j) * 13.0);
        vec4 s = seedsOf(id);
        // Most slots are empty. The density is multiplied by the amount, so the
        // shower thins out as it goes rather than all of it dimming at once.
        if (s.x > uRainDrop.x * amount) continue;

        // Its own life, its own pace. Never in step with its neighbour.
        float period = 5.0 + 7.0 * s.y;
        float life = fract(t / period + s.z);
        // Born, and gone: a bead accretes over the first tenth of its life and
        // is TAKEN TO NOTHING over the last fifth. Nothing here ever ends by
        // being switched off.
        float grow = smoothstep(0.0, 0.10, life);
        // AND IT THINS ONCE IT HAS STOPPED, not while it is still going: the run
        // ends at 0.86 of the life, so a taper that started at 0.80 spent the
        // last seventh of every fall on a bead nobody could see any more.
        float dry = 1.0 - smoothstep(0.86, 1.0, life);

        // HOW BIG, AND THIS IS THE COMMITTENTE'S "goccioloni troppo grandi".
        //
        // The second delivery drew every bead somewhere between a half and one
        // and a half of one size, which is not a distribution, it is a size
        // with a wobble on it — so a frame held seven beads that were all
        // roughly the biggest thing a drop can be. Rain is not like that.
        // The size distribution of rain is exponential in the diameter
        // (Marshall and Palmer, 1948, and every measurement since): MANY SMALL
        // AND EXPONENTIALLY FEWER LARGE. A cube of a uniform seed is the
        // cheapest thing with that shape — half the beads come out under a
        // fifth of full size and one in eight over a half — and it is the whole
        // difference between a windscreen and a row of marbles.
        //
        // AND THE SIZE IT WAS BORN AT IS KEPT APART FROM THE SIZE IT IS DRAWN
        // AT, which the fourth pass had to separate and which is the whole of
        // the committente's «RISALGONO velocemente come risucchiate». See the
        // note on mobile below: this is the number, and it is a property of
        // the drop rather than of the moment it is in.
        float born = uRainDrop.y * mix(0.30, 1.0, pow(s.w, 1.9));

        // AND THE SMALL ONES DO NOT RUN. A drop on a vertical pane slides only
        // once it is heavy enough for gravity to beat the contact line holding
        // it; under that critical size it stays pinned exactly where it landed
        // and eventually evaporates. That one sentence of surface physics is
        // most of what makes a rainy window read as a rainy window: a few beads
        // running, and a field of small ones sitting perfectly still while they
        // do.
        //
        // -------------------------------------------------------------------
        // AND HERE IS THE BUG THE COMMITTENTE SAW, IN ONE WORD: born.
        //
        // «quasi tutte le gocce non arrivano a fine quadro: a un certo punto
        //  RISALGONO velocemente come risucchiate»
        //
        // The third pass asked this question of the radius the bead was being
        // DRAWN at — which already carries dry, the taper that takes a drop to
        // nothing over the last fifth of its life. So over that last fifth the
        // radius fell, mobile fell with it, travel fell with it, and the
        // height is top - fall · travel: a travel going to nought is a bead
        // being pulled back to the top of the glass. Every mobile drop in the
        // frame flew UPWARDS over its last second or two, shrinking as it went,
        // which is exactly "sucked back up". It never reached the bottom because
        // it was recalled before it could.
        //
        // Asked of the size it was BORN at, travel is a constant for the
        // life of the drop and the fall is monotone BY CONSTRUCTION: slide is
        // held under one so its derivative cannot go negative, travel cannot
        // change, and there is no other term in the height at all. There is
        // nothing left that can carry a drop upwards.
        //
        // AND THE THRESHOLD IS THE FIFTH PASS'S, because the fourth pass's let
        // half the pane run. born / size is 0.30 + 0.70·s.w^1.9, so a gate at
        // 0.36-0.60 admitted every drop over the fifty first centile: half the
        // beads on the glass were sliding, which is not what a window looks
        // like. The photograph counted 34 pieces of water out of 384 more than
        // twice as tall as wide — EIGHT AND NINE TENTHS PER CENT — so the gate
        // is moved to where it lets about a tenth through: nothing under the
        // seventy fifth centile of size moves at all, everything over the
        // ninety second moves freely, and the smoothstep between them is the
        // handful that creep.
        float mobile = smoothstep(0.70, 0.90, born / max(1e-5, uRainDrop.y));

        float run = clamp((life - 0.06) / 0.80, 0.0, 1.0);
        // Its own grip and its own beat, so no two catch together.
        float beats = 2.0 + 3.5 * s.z;
        float fallNow = slide(run, 0.72 + 0.24 * s.y, beats);

        // AND IT COLLECTS WHAT IT RUNS OVER, which is the committente's
        // «quando una goccia in corsa assorbe una statica, cresce e accelera un
        // attimo». A bead sliding down a pane sweeps up the standing drops in
        // its path and the film between them: it can only get bigger, and it is
        // the reason a windscreen ends up with a few large beads on it rather
        // than a great many equal ones.
        //
        // A STAIRCASE AND NOT A RAMP, and it is counted ON THE BEAT THE BEAD
        // ALREADY HAS. slide() stalls it wherever run·beats is a whole number —
        // that is the stick-slip, and it is its own — so the swallowing is
        // counted A TENTH OF A BEAT AFTER each stall, which is the instant the
        // contact line lets go. The order that reads is the committente's
        // sentence in the order he wrote it: the bead catches, TAKES IN what it
        // has caught up with, and goes — and the going is not a second term, it
        // is what slide() does on its own over the quarter beat that follows,
        // where its derivative climbs from 1 − grip to 1 + grip.
        //
        // The offset is written as +0.90 rather than −0.10 so the floor is
        // nought at the top of the run instead of minus one: a bead cannot
        // start its life a swallow in debt.
        //
        // Nothing about this can carry a drop upwards: the height is
        // top − fall · travel and neither of those two is touched.
        float swept = 1.0 + uRainWet.w * floor(run * beats + 0.90) * mobile;

        // HOW BIG IT IS DRAWN: born, what it has swept up, and gone. A bead
        // accretes over the first tenth of its life and is TAKEN TO NOTHING
        // over the last fifth. Nothing here ever ends by being switched off —
        // and the rebirth is a hard jump with no smoothing anywhere near it,
        // taken at the one moment the drop has no size at all, so there is
        // nothing to see it happen to.
        float radius = born * grow * dry * swept;
        if (radius < 1e-4) continue;
        // Where it started and how far it gets. Most cross the whole frame and
        // leave at the bottom, which is what a drop does; some stop partway and
        // dry where they stopped, which is also what a drop does.
        //
        // THE RANGE WAS OPENED UP IN THE FOURTH PASS, and it is the second half
        // of «non arrivano a fine quadro». The frame is 1.09 tall from the birth
        // line and the old range was 0.45 to 1.40, so even a bead that was never
        // recalled had barely a one in three chance of reaching the bottom edge
        // and most of them dried in mid air a third of the way down. One to one
        // and ninety five puts the great majority of the beads that run at all
        // off the bottom of the glass, which is what a windscreen looks like,
        // and still leaves the ones that stop where they stopped.
        //
        // AND WHERE A BEAD THAT NEVER RUNS SITS, which is the other half of
        // «la popolazione dominante sono GOCCE STATICHE a cupola» and was a
        // plain fault rather than a taste: the birth line is ABOVE the top of
        // the frame, so a bead with travel nought stayed at 1.04 forever and
        // was never once drawn. Every standing drop this system had was off the
        // screen. A pinned bead is pinned WHERE IT LANDED, so it is given a
        // resting height anywhere down the glass — out of the one seed the
        // density test has already spent, so it costs no hash — and the blend
        // is by mobile, so a bead that half runs enters half way up.
        float rest = fract(s.x * 137.13);
        float top = mix(-0.02 + 1.06 * rest, 1.04 + 0.10 * s.y, mobile);
        float travel = (1.00 + 0.95 * s.z) * mobile;
        float mid = (home + float(c)) * cw + cw * (0.2 + 0.6 * s.w);

        // HOW MUCH THE EYE'S OWN TURNING DRAGS IT, and the fourth pass's answer
        // to «muovendo la camera le gocce ballano, seguono la traiettoria della
        // camera» is that THE DROPS ARE PINNED TO THE GLASS. A pane of glass in
        // front of a face does not slide when the face turns, and the third
        // delivery pushed every bead by a tenth of the frame's height — ninety
        // odd pixels — on a fast turn, which is not a drop leaning, it is a drop
        // swimming after the camera.
        //
        // So it is nought by default and it is exposed as one number, and what
        // little of it there is is only on the beads that are SLIDING: a bead
        // held by its own contact line has nothing to lean with. The vertical
        // drag is gone outright rather than turned down — the height has to be
        // monotone by construction, and a term made of the pitch rate is the one
        // thing that could have taken that away.
        float lean = uRainDrag.x * 0.10 * uRainWet.z * mobile;

        float py = top - fallNow * travel;
        // A cheap rejection, and it pays for the shape below several times
        // over: almost every pixel is nowhere near almost every drop.
        if (p.y > top + radius || p.y < py - radius * 1.4) continue;
        if (abs(p.x - mid) > radius * 1.4 + born * 1.8 + abs(lean)) continue;

        // AND THE SIDEWAYS TWITCH IS THE SLIDING BEAD'S ALONE. Every term in
        // dropX is proportional to the fall, so a bead with travel nought would
        // still have wandered across the glass as its life ran out — pinned in
        // height and drifting in x, which is the one thing a bead held by its
        // own contact line certainly does not do. Multiplied by mobile it is
        // exactly nought for a standing drop, and untouched for a running one.
        float path = fallNow * mobile;
        float px = dropX(path, mid, born, s, lean);

        // ------------------------------------------------- ONE SHAPE, AND
        // ONE REFRACTION THROUGH IT
        //
        // How far up the water this pixel is, how far back along the path that
        // puts it, and where the bead was when it was there. No history and no
        // search: the path is a function of the fall, so this is a division.
        // A standing bead has no path to look back along and the guard is on
        // TRAVEL rather than on the height: the division below is by it.
        float dy = p.y - py;
        float cx = px;
        if (dy > 0.0 && travel > 1e-3) {
          cx = dropX((fallNow - dy / travel) * mobile, mid, born, s, lean);
        }
        float came = fallNow * travel;

        float thick;
        float wide = waterHalf(dy, radius, travel, came, uRainTrail.y, thick);
        float lat = (p.x - cx) / max(wide, 1e-5);
        if (abs(lat) < 1.0) {
          // THE SURFACE, AND WHICH WAY IT FACES. The water is a ridge of local
          // half width wide, so its height is wide · sqrt(1 - lat²) and the
          // gradient of that is two terms: one across the ridge, which is what
          // bends light everywhere, and one ALONG it, which is only anything
          // where the ridge is closing — the nose under the bead, the crown
          // over it, and the far end of the film. Which is why a bead refracts
          // like a little lens and a film refracts like a vertical ridge and
          // there is no line between the two: it is one gradient of one shape.
          float up2;
          float wUp = waterHalf(dy + born * 0.22, radius, travel, came, uRainTrail.y, up2);
          float slope = (wUp - wide) / max(born * 0.22, 1e-5);
          float dome = sqrt(max(1e-4, 1.0 - lat * lat));
          vec2 grad = vec2(-lat / dome, slope * dome);
          float gl = length(grad);
          if (gl > 1e-5) {
            // Nothing at the middle, nothing at the rim, most in between — the
            // same law the bead always had, now read off the whole shape.
            //
            // AND WEIGHTED BY HOW THICK THE WATER IS, which is the fifth pass's
            // second correction and the one the literature insists on: the
            // trace behind a running drop is a FILM, its thickness far under
            // the bead's diameter, so it bends light hardly at all however wide
            // it is. The fourth pass scaled the bend by the LOCAL WIDTH alone,
            // which made a track that was as wide as the bead refract as hard
            // as the bead — a glass rod laid down the glass. Squared, because
            // what a lens does goes with its curvature and not with its
            // footprint: full on the head, a twentieth out along the track.
            push += (grad / gl) * (sin(3.14159265 * abs(lat)) * wide * uRainDrop.z
              * mix(0.05, 1.0, thick * thick));
          }
          float body = 1.0 - lat * lat;
          // What the shoulder of the BEAD catches — and only the bead's. The
          // fourth pass gave the trail a sheen of its own that peaked at the
          // MIDDLE of the water and rose with its width: a bright line straight
          // down the spine of the tail, which is the second half of what made
          // the shape read as a tail at all. Whatever light a film catches, it
          // does not catch it there.
          lit = max(lit, thick * (1.0 - smoothstep(0.0, 0.55,
            length(vec2(p.x - px, dy) - vec2(-0.34, 0.34) * radius) / max(radius, 1e-5))));
          // And the beads MERGE rather than overlap: a smooth union of the two
          // fields, so where two of them touch there is one bigger bead with a
          // waist, and a drop can end by being absorbed instead of by vanishing.
          field = smoothMax(field, body * thick, 0.35);
          // THE WET TRACK, and it is a veil rather than a mark. Where the water
          // is film rather than bead all that is left of it is that the glass is
          // wet: a wet pane transmits a shade differently from a dry one and
          // holds its own edge, and that is the whole of what the committente
          // asked for — «un velo umido che scurisce/lucida appena il vetro».
          // Gathered here, spent once, at the bottom.
          //
          // AND IT IS FLAT ACROSS THE TRACK, which the first draft of this got
          // wrong by reusing the bead's own profile. A film of even thickness
          // takes an even shade off what comes through it: it is not a lens and
          // it has no middle. Weighted by 1 - lat² instead, only the spine of
          // the track cleared eight bits at all and what came out was a faint
          // narrow line — which is the shape being repaired, drawn quieter.
          // Flat to three quarters of the width, then a roll off, so the track
          // is a BAND with an edge rather than a ridge with a peak.
          float filmy = 1.0 - thick;
          wetIn = max(wetIn, filmy * (1.0 - smoothstep(0.75, 1.0, abs(lat))));
        }
      }
    }

    // ------------------------------------------------------ the wet glass
    //
    // A veil of STANDING DOMES, one to a cell of a much finer grid, most cells
    // empty. They do not run: they are the condensation the running drops are
    // running through, and they breathe in and out on their own slow phase so
    // that none of them ever appears or goes at an instant.
    //
    // THE FIFTH PASS MADE THEM A POPULATION INSTEAD OF A DUST. They were all
    // between six and sixteen hundredths of a head — one to three pixels, the
    // same size as each other — which is a texture rather than a field of
    // drops. The photograph says the standing beads run from a pixel across to
    // very nearly the size of the ones that slide, exponentially fewer as they
    // get bigger, so the size is drawn from the same shape as the runners' and
    // reaches four tenths of a head.
    //
    // And the centre is placed so the bead FITS ITS CELL, which is what buying
    // the bigger sizes costs: at one to sixteen hundredths a bead was small
    // enough that the old fixed inset could never cut one, and at four tenths
    // it would cut nearly all of them. Insetting by the bead's own size instead
    // keeps the whole of every bead inside the one cell this is allowed to look
    // at, and it stays one cell — nine would be nine times the arithmetic for
    // a veil.
    vec2 mistCells = vec2(uRainTrail.z * aspect, uRainTrail.z);
    vec2 m = at * mistCells;
    vec2 mid2 = floor(m);
    vec4 ms = seedsOf(mid2 + 77.0);
    if (ms.x < uRainTrail.w * amount) {
      float msize = uRainDrop.y * mix(0.05, 0.40, pow(ms.w, 2.4));
      // The bead's size as a share of the cell, in each axis, plus a little.
      vec2 fit = clamp(vec2(msize * mistCells.x / aspect, msize * mistCells.y)
        + 0.03, 0.0, 0.5);
      vec2 centre = mid2 + mix(fit, 1.0 - fit, vec2(ms.y, ms.z));
      vec2 md = (m - centre) / mistCells * vec2(aspect, 1.0);
      float mr = length(md);
      float breathe = 0.5 + 0.5 * sin(t * 0.5 + ms.w * 62.83);
      if (mr < msize) {
        push -= (md / max(mr, 1e-4)) * (sin(3.14159265 * mr / msize) * msize
          * uRainDrop.z * 0.7 * breathe);
        // AND THE LIGHT IS ON THE RIM, not in the middle. A dome on glass is a
        // lens: the middle of it passes what is straight behind it almost
        // untouched, and the RIM is where the surface is steepest and gathers
        // what is far off to the side. Measured on the photograph, over ninety
        // two standing beads: the middle sits three levels off the sky it is
        // seen against and the rim sits SEVENTY NINE off it. Whether that rim
        // comes out dark or bright is a fact about what is behind the pane and
        // not about the drop — here the refraction says which, and this is only
        // the glint that goes with it.
        lit = max(lit, breathe * 0.30 * smoothstep(0.35, 0.95, mr / msize));
      }
    }

    // ----------------------------------------------------- and the wet lens
    //
    // Not a drop at all: the whole front element is wet while it is raining, so
    // the picture through it has a slow low frequency wobble in it and a fine
    // vertical smear. Two sines and no taps — it is a fraction of a pixel, and
    // it is the difference between drops ON a photograph and a camera that is
    // out in the weather.
    push += vec2(
      sin(at.y * 31.0 + t * 0.7) + 0.6 * sin(at.y * 71.0 - t * 0.41),
      sin(at.x * 27.0 - t * 0.6) + 0.6 * sin(at.x * 63.0 + t * 0.37)) * uRainWet.x;
    push.y += sin(at.x * 220.0 + t * 0.2) * uRainWet.y;

    // AND THE WET TRACK IS SPENT HERE, ONCE, AND IT IS SIGNED. Under a film the
    // glass is a shade DARKER, and that is the whole of what a dried track is to
    // look at. «bassissimo contrasto» is not an adjective here: it is the number
    // uRainTrail.x, which is what the whole veil is worth before the highlight
    // strength multiplies it in the composite, and it comes to five per cent of
    // what is behind the glass at the very middle of the freshest track.
    //
    // AND NOTHING ON ITS EDGE, which cost a photograph to learn. A first draft
    // of this put a faint gleam along the track's rim as well — the reference
    // photograph has one, because what is in it is a rivulet of standing water
    // rather than a dried film — and what came out was TWO BRIGHT HAIRLINES
    // down the whole height of the frame: the committente's «linea sottile
    // brillante» over again, in duplicate. A veil has no edge. This is the
    // veil.
    //
    // The channel could only brighten before this pass, so it is clamped either
    // way now: there is no such thing as a wet mark that can only be lighter
    // than the dry glass beside it.
    float veil = -uRainTrail.x * wetIn;

    // Everything fades with the amount, so nothing is anywhere at rest.
    return vec3(push * amount, clamp((lit + field * 0.25 + veil) * amount, -1.0, 1.0));
  }

  // The picture, out of the light: exposure, the curve, the sky's cube and the
  // scene's own grade, in that order and no other.
  //
  // It is a function rather than a run of statements because the selective
  // focus needs it TWICE — once on what the eye is looking at and once on the
  // defocused copy of the same frame — and a blurred image graded by a
  // different arithmetic than the sharp one it is mixed with would put a seam
  // exactly along the edge where the two meet. The weight of the scene's grade
  // is worked out once, outside, from the sharp depth and the sharp light, and
  // handed to both: it is a property of what is AT this pixel, not of how
  // sharply it is drawn.
  vec3 develop(vec3 light, float w, float eyeKeep) {
    // THE ADAPTATION, and the one thing it is not allowed to touch.
    //
    // An eye that has settled darkens the sky and the clouds with everything
    // else — that is the whole of what it is for — but what GLOWS in this world
    // is sealed at a fixed distance above the bloom threshold, and a quarter of
    // a stop taken off the ink is a quarter of a stop of halo gone. So the
    // factor is mixed away over the emissives, by the same threshold and the
    // same knee that already exempt them from the scene's grade, and never by a
    // third number of its own. eyeKeep is that mask, worked out once in main.
    if (stage(128.0) && uEyeExposure != 1.0) light *= mix(1.0, uEyeExposure, eyeKeep);
    light *= uExposure;
    vec3 colour = stage(2.0) ? agx(light) : clamp(light, 0.0, 1.0);

    // No vignette here any more. There used to be one, permanent, a sixteenth
    // of the light at the corners, and it was a second place where the corner
    // shading of this picture was decided. The reference's shading is not a law
    // — at one radius it wants a fifth of the light on one side of the frame
    // and nine tenths on the other — so a law here could only ever be a wrong
    // approximation of a table that already exists in src/ui/veil.js, laid
    // underneath it. One sede, and it is the transient one: after the arrival
    // the frame is clean to its edges, which is what a walker who has left the
    // photograph behind should be looking at.
    colour = encodeSrgb(colour);

    // The grade is the last thing that touches colour, and it works on encoded
    // values: that is the space it was fitted in, against a screenshot, and it
    // is also the space where a 32 step cube has its samples spread evenly over
    // what the eye can tell apart.
    if (stage(4.0) && uLutIntensity > 0.0) {
      colour = mix(colour, grade(colour), uLutIntensity);
    }

    // THE SECOND STAGE, and it is the scene's alone.
    //
    // The grade above is the sky's: it is fitted with the sky as the only
    // weight and it is the identity everywhere else by construction. This one
    // is the other half of the pair — a toe and a contrast, on the ground and
    // on the stone, and never on the sky.
    //
    // IT SHAPES LUMINANCE AND SCALES THE CHANNELS TOGETHER, and that is a
    // repair rather than a preference. The first version of this took a toe out
    // of each channel separately, with a different depth in each so that shadow
    // would come out cold — the reference's near meadow is not merely darker
    // than this world's, it is COLDER, carrying fifteen and a half more blue
    // than red where this world carried three less. It answered the numbers and
    // it turned the rock in the lower left corner ELECTRIC BLUE, because on a
    // surface that dark a subtraction of a tenth takes red and green to zero
    // while blue survives, and what is left is not a darker rock, it is a blue
    // one. The mask the fit scored on is ground only, so the rock was in none of
    // its numbers and the defect had to be seen. So: the curve shapes the
    // luminance, the three channels are scaled by the ratio it asks for — which
    // cannot change a hue, only a brightness — and the colour of shadow is a
    // MULTIPLY that fades in as the picture goes dark. A multiply cannot drive
    // one channel to zero and leave the others standing.
    //
    // The emissives are exempted BY CONSTRUCTION rather than by a second
    // number: what glows in this world is exactly what the bloom takes as a
    // source, so the same threshold and the same knee that decide the halo
    // decide this, read off the scene buffer before anything touched it. The
    // engraved cyan, the rhombus, the hoop and the stair line therefore leave
    // this pass exactly as they entered it, and the meadow and the stone — an
    // order of magnitude below the threshold — take all of it.
    if (stage(32.0) && w > 0.0) {
      float y0 = luma(colour);
      float toed = (y0 - uSceneBlack) / max(1e-3, 1.0 - uSceneBlack);
      float y1 = min(1.0, softFloor(uScenePivot + (toed - uScenePivot) * uSceneGain, uSceneKnee));
      vec3 shaped = colour * (y1 / max(y0, 1e-4));
      float deep = 1.0 - smoothstep(0.0, uShadowRange, y1);
      shaped *= mix(vec3(1.0), uShadowTint, deep);
      // Clamped after the mix as well, because the strength is allowed past
      // one — the near band extrapolates a little beyond the curve rather
      // than stopping on it — and a value that leaves the picture has to leave
      // it at an end of the range and not by wrapping.
      colour = clamp(mix(colour, shaped, w), 0.0, 1.0);
    }
    return colour;
  }

  void main() {
    // THE DROPS COME FIRST, because they are in front of everything: what a
    // bead of water on the glass does is move where the eye is looking, so it
    // moves the coordinate the whole pass reads from rather than smearing the
    // finished picture. One consequence, and it is the right one: what is seen
    // through a drop is developed and focused like the place it came from.
    vec2 uv = vUv;
    float bead = 0.0;
    if (stage(512.0) && uRain.x > 0.0) {
      vec3 drop = rainAt(vUv);
      uv += drop.xy;
      bead = drop.z;
    }

    // THE SCENE AND WHAT WAS ADDED TO IT APART. The additive layer is
    // accumulated in a buffer of its own -- see the depth service at the foot of
    // this file -- and added here, before the exposure and before either grade,
    // which is the only place it can go: a glow added after the curve is a glow
    // fitted against a different picture. Adding is exact rather than
    // approximate, because what is in that buffer was blended additively into
    // black and addition does not care in what order it is done.
    vec3 scene = texture2D(tScene, uv).rgb + texture2D(tGlow, uv).rgb;
    vec3 halo = stage(1.0) ? texture2D(tBloom, uv).rgb * uBloomStrength : vec3(0.0);

    // How much of the scene's own grade this pixel takes, and what glows.
    // Worked out once and used by every development of this pixel below.
    float depth = texture2D(tDepth, uv).x;
    float sky = step(0.999999, depth);
    float brightness = max(scene.r, max(scene.g, scene.b));
    float glow = 1.0 - smoothstep(uGlowThreshold - uGlowKnee, uGlowThreshold + uGlowKnee, brightness);
    float w = sceneWeight(depth, uv) * glow;
    // WHAT IS AN EMISSIVE OF THIS WORLD, and it is not simply "bright".
    //
    // The threshold and the knee say what the bloom takes as a source, and over
    // the SCENE that is exactly the five glowing groups — the engraving, the
    // rhombus, the hoop, the stair line, the panels — because the meadow and
    // the stone sit an order of magnitude below it. Over the SKY it says
    // something else entirely: this sky is brighter than the threshold nearly
    // everywhere, so a mask that did not ask about depth would call the whole
    // dome an emissive and exempt it from an adaptation and a glare that are
    // meant to be over it more than over anything else. The sky writes no
    // depth; that is the question, and it costs one comparison.
    float ink = (1.0 - sky) * (1.0 - glow);

    // ------------------------------------------- THE LIGHT THAT MISSED THE FILM
    //
    // Every part of the sun system is gathered HERE, into the scene's own light
    // units, and added to the frame BEFORE the exposure and the curve. That is
    // the repair the third pass exists for, and s2-dev8/VERBALE.md names the
    // defect as residue 2 in its own words: "i raggi si aggiungono al quadro
    // CODIFICATO ... su un'area grande sposta i mezzitoni più di quanto farebbe
    // un'addizione lineare". The committente's word for what that looks like was
    // «abbaglio netto, finto».
    //
    // WHY IT LOOKED FINTO, in one sentence: light added after the tone curve
    // cannot roll off, because the curve it would have rolled off on has
    // already run. An addition of a tenth to an encoded value is a tenth, flat,
    // all the way to white and then a hard clip at it; the same light added
    // before AgX is compressed exactly like every other bright thing in the
    // frame, so it desaturates towards the light's own colour, it keeps its
    // gradient where a clip would have flattened it, and the picture goes
    // bright the way a picture goes bright rather than the way a decal does.
    // A veil of stray light IS scene light — it fell on the sensor with
    // everything else — so this is also simply where it belongs.
    //
    // The engraving keeps its own value here as everywhere else in this pass,
    // by the same threshold and the same knee, and never by a third number.
    vec3 stray = vec3(0.0);

    // ------------------------------------------ IS THERE A SUN TO COME FROM
    //
    // HOW MUCH OF THE DISC IS UNCOVERED, read ONCE and used by EVERY component
    // of this system that is drawn AT the sun rather than marched from it.
    //
    // THE FOURTH PASS EXISTS FOR THIS LINE. The third pass built the occlusion
    // — a ring of five taps on the depth buffer round where the disc landed,
    // damped asymmetrically, in one texel — and then multiplied only the halo,
    // the streak and the ghosts by it. The VEIL was left ungated, and the veil
    // is the largest thing in this system by a long way: measured at the pose
    // of the committente's screenshot, with the disc completely behind thirteen
    // metres of stone (uncovered 0.000), the halo added 0.00 levels to the
    // stone's face, the streak 0.00, the ghosts 0.00, the rays 0.00 — and the
    // veil added SEVENTY FIVE, at a hundred and twelve on its worst pixel, over
    // every pixel of the face (s2-dev12/out/alone-prima.txt). That is the
    // "grande alone chiaro SULLA faccia della pietra": one term, unasked, over
    // a cone seventy six degrees wide, painted across whatever is standing in
    // front of the sun.
    //
    // The veil IS light from the disc — it is this sky's own sunlight taken the
    // wrong way through the optics — so a stone between the disc and the front
    // element takes it away exactly as it takes the flare away. That it is a
    // law of the ANGLE rather than of a screen position does not make it a law
    // of nothing: the angle says WHERE it falls, the disc says WHETHER there is
    // any.
    //
    // WHAT IS STILL NOT MULTIPLIED BY IT, and the choice is unchanged and
    // declared: the RAYS. They ask the question themselves, once per step,
    // along the whole march — that is what cuts them into beams round a stone
    // instead of switching them off behind one — and the measurement above
    // shows they already answer nought at this pose without any help.
    float open = 1.0;
    bool sunlit = (stage(256.0) && uGlare > 0.0) || (stage(1024.0) && uSun > 0.0);
    if (sunlit) open = mix(1.0, texture2D(tProbe, vec2(0.5)).y, uSunProbed);

    // THE VEIL, which is the floor the other two stand on. It is a law of the
    // ANGLE between this pixel's own ray and the sealed sun, so it is there
    // whether or not the disc is in frame, and it is what carries the last of
    // the light as the sun leaves. Squared after the shoulder, so it comes on
    // late and softly. And gated, now, by whether there is a disc to have come
    // from: off the glass the probe answers UNCOVERED by construction, so a sun
    // that has left the frame keeps its veil and a sun behind a stone does not.
    if (stage(256.0) && uGlare > 0.0) {
      vec2 plane = (vUv * 2.0 - 1.0) * uTanHalf;
      vec3 ray = normalize(vec3(plane, -1.0));
      float veil = smoothstep(uGlareEdge.x, uGlareEdge.y, dot(ray, uSunView));
      stray += uGlareTint * (veil * veil * uGlare * open);
    }

    // AND THE SUN IN THE PICTURE: the rays that were marched, a halo, one
    // anamorphic streak, and three ghosts. All of it multiplied by uSun — how
    // much of the disc is on the glass — so when the sun is not in the frame
    // this is nothing at all, the branch is not taken, and THE SEALED DOME IS
    // EXACTLY WHAT IT WAS.
    if (stage(1024.0) && uSun > 0.0) {
      vec3 lit = texture2D(tRays, uv).rgb * uRaysAmount;
      // How far this pixel is from where the disc landed, as a circle rather
      // than as an ellipse: x is carried in units of the frame's height.
      vec2 d = (vUv - uSunUv) * vec2(uAspect, 1.0);
      float bloomHalo = exp(-dot(d, d) / max(1e-5, uFlare.x)) * uFlare.y;
      // Long across and tight up and down, which is what the anamorphic streak
      // of a real coating is. Exponential in x so it has no end to it, gaussian
      // in y so it has no edge.
      //
      // ------------------------------------------------ AND IT BREATHES.
      //
      // Asked for by the committente and confirmed in his own words, and the
      // whole of what moves is THE THICKNESS. Not the length as a scale, not
      // the brightness as a pulse: the slit, opening and closing the way a pair
      // of eyelids narrowing does.
      //
      // THE LIGHT IN IT DOES NOT PULSE, AND THAT IS AN IDENTITY RATHER THAN A
      // TASTE. The streak is an exponential across and a gaussian up and down,
      // so what it puts on the frame altogether is
      //
      //     2 · length · sqrt(pi · width²) · gain
      //
      // Move the thickness by k and the other two have to move by k^-1/4 and
      // k^-3/4 for that product to come back unchanged — and it does, exactly,
      // with no epsilon and nothing to tune. Which is why the two of them move
      // at all: when the slit narrows it gets a breath brighter and a breath
      // longer, when it widens it softens, and the total never moves. That is
      // the arithmetic saying the same thing the eyelid does.
      //
      // THE RHYTHM IS NEVER A CYCLE, and the three rates are chosen rather than
      // picked. Same anti-loop as the breath and the postural sway of
      // src/core/presence.js — incommensurate rates have no common period, so
      // the rise and fall never comes back to the same place — but with THREE
      // of them the golden ratio is the wrong constant, and the arithmetic says
      // so out loud: phi squared IS phi plus one, so 1, phi, phi² are linearly
      // dependent over the rationals and the three phases align sooner than any
      // of the pairs would suggest. Measured on the autocorrelation of the
      // thickness itself: a golden triple resembles itself by 0.87 within five
      // seconds.
      //
      // The right constant for three is the PLASTIC NUMBER, 1.324718, the root
      // of x³ = x + 1 — which is to a triple exactly what the golden ratio is to
      // a pair: the algebraic number that a set of three is worst approximable
      // by rationals in. Rates of 0.550, 0.729 and 0.965 hertz, so breaths of
      // 1.82, 1.37 and 1.04 seconds, all inside the half second to two the
      // committente asked for. Within five seconds the wander resembles itself
      // by 0.56 where a golden triple manages 0.87 and a plain sine 0.81; within
      // two minutes it never reaches 0.99, and it never reaches one at all.
      //
      // AND IT IS GATED LIKE EVERYTHING ELSE DRAWN AT THE DISC: uStreak.x
      // carries the same geometric factor and the same hysteresis the flare
      // does, open is the occlusion of the disc, and the amount is nought
      // under «riduci movimento». At nought the branch is not taken and the
      // three numbers are the delivered ones, so the streak is IDENTICAL TO THE
      // BIT — which is what keeps it out of a placed pose.
      float streakLen = uFlare.z;
      float streakWide = uFlareHeight;
      float streakGain = uFlare.w;
      if (uStreak.x > 0.0) {
        float b = uStreak.y;
        // WEIGHTED NEARLY EVENLY, and that is what stops the slowest of them
        // being the rhythm with two others laid on top of it. The first draft
        // ran 1, 0.70, 0.45 and the ten second measurement caught it at once:
        // the thickness resembled itself at a lag of 3.6 seconds by more than
        // half, which is the slow sine showing through its own accompaniment.
        float wob = (sin(b * 3.45575) + 0.85 * sin(b * 4.57799 + 1.7)
          + 0.62 * sin(b * 6.06462 + 4.1)) * (1.0 / 2.47);
        // Held well away from nought: the amplitude is exposed, and a thickness
        // that could reach zero would be a streak that vanished for an instant.
        float k = clamp(1.0 + uStreak.x * open * wob, 0.55, 1.75);
        streakWide *= k * k;              // uFlareHeight is a width SQUARED
        streakLen *= pow(k, -0.25);
        streakGain *= pow(k, -0.75);
      }
      float streak = exp(-abs(d.x) / max(1e-4, streakLen))
        * exp(-(d.y * d.y) / max(1e-6, streakWide)) * streakGain;
      // The ghosts, on the axis through the middle of the frame.
      vec2 axis = (vec2(0.5) - uSunUv) * vec2(uAspect, 1.0);
      vec3 ghosts =
        mix(uFlareTint, uGhostTint, 0.15) * (ghost(d, axis, uGhostAt.x, uGhostSize.x) * uGhostGain.x)
        + mix(uFlareTint, uGhostTint, 0.85) * (ghost(d, axis, uGhostAt.y, uGhostSize.y) * uGhostGain.y)
        + mix(uFlareTint, uGhostTint, 0.45) * (ghost(d, axis, uGhostAt.z, uGhostSize.z) * uGhostGain.z);
      stray += lit * uRaysTint * uSun
        + (uFlareTint * (bloomHalo + streak) + ghosts) * (uSun * open);
    }

    vec3 light = scene + halo + stray * (1.0 - ink);

    vec3 colour = develop(light, w, 1.0 - ink);

    // ---------------------------------------------------------- THE FOCUS
    //
    // An eye that has leaned in on something near has accommodated to it, and
    // everything that is not at that distance goes soft. The plane is where the
    // walker's own attention is — the block within reach of E, or wherever the
    // right button is leaning — and it is handed in from src/core/eye.js in
    // metres, which is the unit rayDistance already answers in.
    //
    // The defocused copy is premultiplied by its own circle of confusion, so
    // dividing the weight back out gives the average of the taps that were
    // ACTUALLY out of focus. The trace of sharp scene added underneath is what
    // answers the one degenerate case: a pixel out of focus whose whole
    // neighbourhood is in focus has no blurred colour to be given, and the
    // honest answer for it is the colour it already had.
    // The waking comes in HERE and not through a stage of its own: it wants the
    // same blurred copy, the same enlargement and the same development, and a
    // second place that mixed a soft picture into a sharp one would be a second
    // place to keep in agreement with this. At uWakeBlur nought the disjunction
    // is the condition that was here, evaluated to the same bit.
    if (stage(64.0) && (uFocusAmount > 0.0 || uWakeBlur > 0.0)) {
      float plane = texture2D(tProbe, vec2(0.5)).x;
      // THE PIXEL'S OWN CIRCLE, AT FULL RESOLUTION, and it is what everything
      // below is measured against: the enlargement asks each quarter texel how
      // far it is from THIS, and the mix is THIS. A pixel at the focal plane
      // therefore never receives the blurred buffer, by construction and not by
      // a threshold.
      float cocHere = circleOfConfusion(dioptresAt(depth, uv), plane);
      // AND A CIRCLE SMALLER THAN A PIXEL IS NOT A BLUR, IT IS THE RESOLUTION
      // OF THE FRAME. See the note over defocused(): the blurred copy is one
      // width — thirteen pixels — so a tenth of a circle comes out as a tenth
      // of THIRTEEN pixels rather than as the whole of one, and light borrowed
      // from thirteen pixels away at ten per cent is a halo and not a softness.
      // Under the floor there is nothing this buffer can honestly say, so it
      // says nothing; over it, the gradient across the depth of the frame that
      // the third pass was asked for is exactly as it was.
      cocHere *= smoothstep(uFocusFloor.x, uFocusFloor.y, cocHere * uFocusReachPx);
      // AND CLAMPED AFTER THE STRENGTH, not only inside the circle. The circle
      // itself comes back inside nought and one, but the strength is exposed on
      // params.eye and the ladder in the README offers a setting above one — and
      // a mix factor over one is not "more blurred", it is an extrapolation past
      // the blurred copy, which rings on every edge it touches.
      float coc = clamp(cocHere * uFocusAmount, 0.0, 1.0);
      // AND THE WAKING IS A FLOOR OVER ALL OF IT. Not a plane, not a distance:
      // a lid in the way is the same amount of soft at every depth of the
      // frame, so the one number is the whole of it, and taking the larger of
      // the two means an eye that is both shut and accommodating is as soft as
      // the softer of its two reasons rather than as the sum of them.
      if (uWakeBlur > 0.0) coc = max(coc, uWakeBlur);
      if (coc > 0.0) {
        // The stray light goes into BOTH developments, and it has to: it is in
        // front of the optics rather than in the world, so it is not what goes
        // soft, and a picture whose sharp half carried it and whose blurred
        // half did not would have a seam along every edge of the defocus.
        //
        vec4 soft = texture2D(tFocus, uv);
        vec3 softLight = (soft.rgb + scene * 1e-3) / (soft.a + 1e-3);
        // ------------------------------------------------- THE INK STAYS SHARP
        //
        // «i testi continuano a sfocarsi assieme al resto (i monoliti rimangono
        // definiti)» — and the committente's ruling on it is that THE INK IS
        // NEVER SOFT, anywhere. On a face outside the plane the stone has no
        // fine detail to lose, so what the defocus visibly eats is the writing
        // and nothing else, which is physically right and is not what he wants
        // to look at. The knob has been here since the first pass; this is it
        // turned on, and the only thing that had to be built is the second half
        // of the mask.
        //
        // WHY THE SHARP MASK ALONE IS NOT ENOUGH, and it is the artefact the
        // mandate names in advance. Holding the glyph's own pixels sharp leaves
        // its NEIGHBOURS taking the blurred buffer in full — and that buffer
        // carries the glyph's own light, smeared thirteen pixels wide. A sharp
        // letter sitting in a ring of its own smear is a postage stamp: the eye
        // reads the ring as an outline round the glyph rather than as softness.
        //
        // So the mask is asked of the BLURRED copy as well, and by the same
        // threshold and the same knee as the sharp one — never a third number.
        // Where the blurred buffer is bright enough to be an emissive, the
        // light there IS the glyph's, and holding those pixels sharp too shows
        // the stone that is actually behind them instead of the smear. The
        // widening is exactly as wide as the smear, because it is measured off
        // the smear, and it falls off with it: the keep is a gradient and not
        // a cut-out, which is what the mandate asks for and what a threshold
        // with a knee gives for free.
        float softBright = max(softLight.r, max(softLight.g, softLight.b));
        float inkSoft = (1.0 - sky) * smoothstep(
          uGlowThreshold - uGlowKnee, uGlowThreshold + uGlowKnee, softBright);
        coc *= 1.0 - uFocusInkKeep * max(ink, inkSoft);
        // The keep is the eye's and not the lid's: what a walker who has not
        // opened their eyes can read is nothing, so the floor goes back on
        // after it. The same line in the blur pass stops the ink's light from
        // being held out of the pot in the first place.
        if (uWakeBlur > 0.0) coc = max(coc, uWakeBlur);
        if (coc > 0.0) {
          colour = mix(colour,
            develop(softLight + halo + stray * (1.0 - ink), w, 1.0 - ink), coc);
        }
      }
    }

    // EITHER WAY: a bead's shoulder catches light and a wet track holds a shade
    // less of it, and the channel carries both signs now — see the veil at the
    // end of rainAt.
    if (bead != 0.0) colour = clamp(colour * (1.0 + uRainDrop.w * bead), 0.0, 1.0);

    // THE WAKING'S OWN LIGHT, and it is the last thing before the noise.
    //
    // An eye that has been shut opens on a world that is too bright for it, and
    // the brightness goes away as the eye takes it. It is a gain on the
    // finished picture rather than an exposure on the light, and deliberately:
    // it is not the adaptation — that one lives in develop(), is the eye's, and
    // is exempted over the emissives so the halos keep their stops. This is the
    // whole frame, glow and all, which is what a lid coming off a retina looks
    // like and what the scene's own drawing of it was measured against.
    if (uWakeExposure != 1.0) colour = clamp(colour * uWakeExposure, 0.0, 1.0);

    // Triangular noise of one least significant bit, added after the transfer
    // function: this is what keeps the sky gradient from banding once it is
    // quantised to eight bits. IT STAYS LAST. Everything above is a picture and
    // this is the noise that carries the picture through eight bits; anything
    // laid over it would simply erase it.
    if (stage(16.0)) {
      colour += (hash(gl_FragCoord.xy) - hash(gl_FragCoord.xy + 17.13)) / 255.0;
    }

    gl_FragColor = vec4(colour, 1.0);
  }
`;

const STAGES = [
  { key: 'bloom', bit: 1 },
  { key: 'toneMap', bit: 2 },
  { key: 'grade', bit: 4 },
  { key: 'dither', bit: 16 },
  { key: 'sceneGrade', bit: 32 },
  // The eye. Each is allowed rather than applied: what decides whether one is
  // in the frame is its own amount, which src/core/eye.js holds at exactly rest
  // wherever the walker was placed rather than walked.
  { key: 'focus', bit: 64 },
  { key: 'adaptation', bit: 128 },
  { key: 'glare', bit: 256 },
  { key: 'rain', bit: 512 },
  // The rays and the flare together: they are one thing to switch off, because
  // they answer one piece of feedback and they are gated on one number.
  { key: 'sun', bit: 1024 },
];

/**
 * A time to nine tenths, as the time constant of a first order approach.
 *
 * The same conversion src/core/eye.js does, and it has to be the same one: a
 * pull said to take four hundred milliseconds has to take four hundred
 * milliseconds whether the arithmetic that gets it there runs on the CPU or on
 * the GPU. A first order system is nine tenths of the way in 2.303 time
 * constants.
 */
const tauSeconds = (ms) => Math.max(1e-4, ms / 1000 / 2.302585);

function configureLutTexture(texture) {
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/** Neutral strip, used until the fitted grade arrives (and if it never does). */
function identityLut(size = LUT_SIZE) {
  const width = size * size;
  const data = new Uint8Array(width * size * 4);
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const o = (g * width + b * size + r) * 4;
        data[o] = Math.round(r / (size - 1) * 255);
        data[o + 1] = Math.round(g / (size - 1) * 255);
        data[o + 2] = Math.round(b / (size - 1) * 255);
        data[o + 3] = 255;
      }
    }
  }
  const texture = new DataTexture(data, width, size, RGBAFormat, UnsignedByteType);
  return configureLutTexture(texture);
}

// `eye` is the half resolution defocus chain, and it is timed on its own for
// the reason the prepass is: what an effect costs has to be readable apart from
// what the frame costs, or the budget it is held to cannot be checked. It is
// drawn on no frame that is not defocusing something, so on every other frame
// the clock reports it as exactly nought.
// `rays` is the march towards the sun, and it is beside `eye` for the same
// reason `eye` is beside `bloom`: the brief asks for its cost "misurato
// solo-quando-attivo", and a stage that is only OPENED on a frame that draws it
// answers that question with a nought rather than with a small number.
// `probe` is the one pixel, and it has a stage of its own rather than being
// folded into `eye` for a reason that is about the CONTRACT and not about the
// number: it runs for the sun as well as for the focus, so charging it to `eye`
// would make the defocus's stage read non-zero on a frame that is drawing no
// defocus at all, and "nought when it is off" would stop being checkable.
// `depth` is the depth service's one added pass and NOTHING ELSE: the lift, the
// full screen quad that turns the scene buffer's depth attachment into metres a
// material can read. It is beside `scene` rather than inside it because the
// whole question this service was opened on is what the extra pass costs, and a
// cost folded into the pass it stands beside is not a cost anybody can quote.
// `soft` is the layer that reads it, drawn back over the world. Those draws are
// not new — they used to happen inside `scene`, in the same frame, against the
// same buffer — but they are apart now because the split put them there anyway,
// and a consumer that can read what its own additive layer costs without
// building a bench is worth the line.
// `campo` is the field's own pass and NOTHING ELSE: the ray marched ground,
// drawn alone into a buffer of its own at a fraction of the frame's pixels. It
// stands beside `scene` for the same reason `depth` does -- the whole question
// this pass was opened on is what the GROUND costs against what the rest of the
// world costs, and a cost folded into the pass it stands beside is not a cost
// anybody can quote. On a frame drawn whole it is an exact nought, because the
// field is then drawn inside `scene`, where it always was.
// THE THRESHOLD AND THE BLUR ARE TWO STAGES AND NOT ONE. They are one pass and
// a chain of ten, they scale with different things -- the threshold with the
// frame, the chain with its own pyramid -- and read together they hid which of
// the two a post budget was actually spending. `bloom` keeps its name and now
// means the threshold alone; the down and up chain is `sfocatura`.
//
// E `tutto` E' IL DODICESIMO, CHE NON E' UNO STADIO (U-PERF-7, E-LINUX1). Il
// governatore ha bisogno di UN numero -- quanto e' costato il fotogramma -- e
// legge `total`, che e' la somma degli altri undici. Gli undici li legge solo
// il riquadro di sviluppo. Undici query sono ventidue chiamate di
// begin/endQuery e fino a undici letture sincrone per fotogramma addosso a ogni
// visitatore, per una tabella che nessun visitatore vede: fuori da `?dev` il
// fotogramma si cronometra INTERO, con una query sola, e `total` e' lei.
const CLOCK_STAGES = [
  'prepass', 'campo', 'scene', 'depth', 'soft', 'bloom', 'sfocatura', 'probe', 'eye', 'rays',
  'composite', 'tutto',
];

/**
 * The GPU's own clock, when the driver hands one out.
 *
 * Frame time read on the main thread is the time between two callbacks, which
 * on a machine that is not the bottleneck is the refresh interval and nothing
 * else. What the quality tier has to be chosen against is the time the GPU
 * spends drawing, and this is the only place it can be asked for. A query is
 * answered several frames after it is issued, so the sets are kept in a ring
 * and read when they are ready; a disjoint result means the driver preempted
 * the queue and the whole set is thrown away rather than believed.
 *
 * THE RING IS A QUEUE, AND THAT IS THE REPAIR. The version before this one kept
 * four sets and, whenever the one at the front was not back from the driver
 * yet, LEFT THE CURSOR THERE and gave up on timing the frame. On ANGLE over
 * D3D11 the driver answers several frames late, so the front was almost never
 * ready when it was asked, and the clock delivered four to eight readings every
 * ten seconds — under one per cent of the frames drawn (measured in
 * s2-analisi1/RAPPORTO.md section 7.3). Three repetitions of an identical
 * configuration then spread over 1.4 ms, which is wider than the effect anyone
 * was trying to attribute, so no budget in this project was verifiable.
 *
 * Now: sets are issued into the back of the queue and reaped from the front, so
 * a slow answer costs one slot rather than every frame; there are enough slots
 * to cover the driver's latency; and how many readings are lost, and to which
 * of the two causes, is counted rather than guessed at.
 *
 * The query objects are allocated once and reused. Creating and deleting four
 * of them per frame was the other half of the cost, and it bought nothing.
 */
function createGpuClock(gl) {
  const context = gl.getContext();
  const ext = context.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;

  // Deep enough that the driver's latency, not the ring, decides how many
  // frames go untimed. Twelve covers about a fifth of a second of frames at the
  // rate this world draws at, and an unread set costs one integer and four
  // query objects that already exist.
  const RING = 12;
  const ring = [];
  // A queue, not a cursor: `head` is the oldest set still out with the driver,
  // `live` how many are out. Timer queries on one context complete in the order
  // they were issued, so looking only at the front is not an optimisation, it
  // is the whole of what has to be looked at.
  let head = 0;
  let live = 0;
  let open = null;
  const last = {
    prepass: 0, scene: 0, depth: 0, soft: 0, bloom: 0, probe: 0, eye: 0, rays: 0,
    composite: 0, tutto: 0, total: 0,
  };
  let fresh = false;
  // Why a frame went untimed, so the answer is a number rather than a theory.
  const counts = {
    issued: 0, read: 0, disjoint: 0, ringFull: 0,
  };

  for (let i = 0; i < RING; i++) ring.push({ queries: {}, active: [] });

  function close() {
    if (open === null) return;
    context.endQuery(ext.TIME_ELAPSED_EXT);
    open = null;
  }

  /** Reads one set back, whether or not its numbers survive. */
  function collect(slot) {
    // Reading this resets it, so it is read once per set and applied to the
    // whole set: a preempted queue makes every stage in that frame a fiction.
    const disjoint = context.getParameter(ext.GPU_DISJOINT_EXT);
    let total = 0;
    for (const stage of CLOCK_STAGES) {
      const drawn = slot.active.indexOf(stage) >= 0;
      // A stage nobody drew this frame costs nothing, and has to SAY nothing
      // rather than repeat what it cost when it was last drawn: the prepass
      // comes and goes with a development key, and a stale reading left in
      // the table would be added to every frame after it was turned off.
      if (!drawn) {
        if (!disjoint) last[stage] = 0;
        continue;
      }
      // Read even when the set is being thrown away: a query object is only
      // safe to begin again once its result has been taken off it.
      const value = context.getQueryParameter(slot.queries[stage], context.QUERY_RESULT) / 1e6;
      if (!disjoint) {
        last[stage] = value;
        total += value;
      }
    }
    slot.active.length = 0;
    if (disjoint) { counts.disjoint++; return; }
    last.total = total;
    fresh = true;
    counts.read++;
  }

  /** Everything the driver has finished with, oldest first. */
  function drain() {
    while (live > 0) {
      const slot = ring[head];
      // UNA DOMANDA AL DRIVER E NON UNDICI, E LA RAGIONE E' SCRITTA VENTI RIGHE
      // PIU' SU (U-PERF-7, E-LINUX1).
      //
      // «Timer queries on one context complete in the order they were issued»:
      // e' la legge su cui questo anello e' costruito -- e' il perche' si
      // guarda solo la testa della coda -- e vale dentro un fotogramma
      // esattamente come vale fra un fotogramma e l'altro. Se l'ULTIMO stadio
      // aperto e' tornato, sono tornati tutti quelli aperti prima.
      //
      // `every` chiedeva invece uno stadio alla volta, e una domanda al driver
      // non e' una chiamata come le altre: `getQueryParameter` TORNA UN VALORE,
      // quindi svuota la coda dei comandi e aspetta il giro. Contate sotto
      // `?dev&gl`, erano 13,6 al fotogramma al tier basso, il 3,2 % di tutte le
      // chiamate GL del fotogramma e la sola famiglia che il filo paga per
      // intero anche dove c'e' glthread -- e su Firefox sotto X11, che glthread
      // non ce l'ha, tutto il resto si paga qui insieme a queste.
      //
      // E NON E' UN'OTTIMIZZAZIONE DEL CASO BUONO: quando la testa NON e'
      // pronta `every` si fermava alla prima, cioe' a una domanda; quando era
      // pronta ne faceva undici. Il caso che costava e' quello in cui il
      // fotogramma riusciva, cioe' quasi tutti.
      const lastStage = slot.active[slot.active.length - 1];
      const ready = lastStage === undefined || context.getQueryParameter(
        slot.queries[lastStage], context.QUERY_RESULT_AVAILABLE,
      );
      if (!ready) return;
      collect(slot);
      head = (head + 1) % RING;
      live--;
    }
  }

  return {
    /** Opens a stage; the previous one, if any, is closed first. */
    begin(slot, stage) {
      close();
      let query = slot.queries[stage];
      if (!query) {
        query = context.createQuery();
        slot.queries[stage] = query;
      }
      slot.active.push(stage);
      context.beginQuery(ext.TIME_ELAPSED_EXT, query);
      open = query;
    },
    end: close,
    /** A free set to time this frame with, or null while every set is out. */
    take() {
      drain();
      if (live >= RING) { counts.ringFull++; return null; }
      const slot = ring[(head + live) % RING];
      live++;
      counts.issued++;
      return slot;
    },
    /** The last complete reading, or null while none has come back yet. */
    read() {
      if (!fresh) return null;
      fresh = false;
      return { ...last };
    },
    /** How the clock is doing: issued, read back, thrown away, and why. */
    stats() {
      return { ...counts, inFlight: live, ring: RING };
    },
  };
}

/**
 * The depth of the frame, kept rather than thrown away.
 *
 * The composite has to know which pixels are sky, because the scene's half of
 * the grade may not touch them, and depth is the answer that costs nothing to
 * produce: the sky is drawn with its depth write off, so it is still standing
 * at the far plane while everything else has moved in front of it. Twenty four
 * unsigned bits rather than a float, because this is asked one question —
 * roughly how far — and half the bandwidth answers it. Nearest filtering: a
 * depth interpolated across a silhouette is a distance nothing in the world is
 * at, and the one place it would be read is exactly the edge of a monolith.
 */
function makeDepthTexture(width, height) {
  const depth = new DepthTexture(width, height, UnsignedIntType);
  depth.minFilter = NearestFilter;
  depth.magFilter = NearestFilter;
  depth.generateMipmaps = false;
  return depth;
}

function makeTarget(width, height, { samples, format }) {
  const shape = format || TARGET_FORMATS[0];
  const target = new WebGLRenderTarget(width, height, {
    ...shape.options,
    colorSpace: LinearSRGBColorSpace,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: true,
    depthTexture: makeDepthTexture(width, height),
    stencilBuffer: false,
    samples,
  });
  return target;
}

// ===================================================================== ========
//                    THE DEPTH SERVICE, FOR THE ADDITIVES
// =============================================================================
//
// WHAT IT IS FOR. An additive glow is a billboard: one quad turned to the eye,
// so every fragment of it stands at very nearly ONE distance — the emitter's.
// The world it is drawn against does not: the meadow under a lamp rises towards
// the eye pixel by pixel, and a few tenths of a metre below the lamp it has come
// nearer than the lamp is. The depth test answers that in one step, so the
// bottom of every halo is bitten off along the line where the ground crosses the
// emitter's depth, and the tufts make that line ragged. THAT is the defect
// E-V7k found by eye and named: aloni affettati dai ciuffi, tagliati a semicupole.
//
// AND THE CURE IS NOT "SWITCH THE TEST OFF", WHICH WAS REFUSED. A lamp with no
// depth test and nothing in its place is a lamp that shines through a monolith:
// a sliced halo traded for a hole in the world. What this service hands over is
// the number that makes the difference — how far the world is at this fragment's
// own pixel — and the fade built on it,
//
//   softDepthFade = clamp((worldDistance - ownDistance) / fade, 0, 1)
//
// SUBSUMES the test rather than sitting on top of it. Where the world is behind
// the fragment by more than `fade` it is one, and the glow is whole. Where the
// world comes up to meet it, it RAMPS to nothing over those few centimetres
// instead of stopping at a line — which is the sliced halo, cured. And where the
// world is in FRONT it is clamped hard at nought, over the monolith's whole
// depth: a lamp behind a monolith is exactly as dark as the depth test made it,
// and that is the case the hard cure could not answer.
//
// So a material here may put its hardware test down and let the fade do both
// jobs, which is what a sliced halo needs; or keep the test and use the fade
// only on the far side. This file does not choose. It produces the metre.
//
// WHY IT IS ONE SEAT AND NOT ONE COPY PER MATERIAL. The same reason
// src/world/face-light.js is: eight sessions will add glowing things to this
// world, and if each reconstructs the world's distance for itself they will
// disagree about where a surface is by a few centimetres — which looks like a
// fitting error in a frame and gets fitted against. There is one producer of
// the metre, in RAY_DISTANCE_GLSL above, and one buffer that carries it.
//
// WHY IT COSTS A PASS, WHICH WAS ASKED BEFORE IT WAS SPENT. The scene's own
// render target has carried a DepthTexture since the composite needed to know
// which pixels were sky, and four passes in this file already read it — so the
// obvious hope was that a material could read it too, from inside the very pass
// that writes it, for nothing. THE DRIVER SAYS NO, and it says it in two
// different ways depending on the tier, which is why this was asked of the
// driver rather than of the specification (v0-fondazione/profondita/ricircolo.*,
// on ANGLE over D3D11, AMD Radeon):
//
//   samples 0  — the texture is the bound framebuffer's own depth attachment,
//                the draw is a feedback loop, and it comes back INVALID_OPERATION
//                with a fragment carrying 1.44 m for a wall standing at 3.00;
//   samples 4  — the bound framebuffer's depth is a multisampled RENDERBUFFER
//                and the texture is only its resolve target, so the read is
//                LEGAL and SILENT — and it hands out the depth of the PREVIOUS
//                pass, because the resolve happens when the pass ends.
//
// The second is the dangerous one: no error, a plausible picture, and a frame of
// lag that only shows when the eye turns. Neither is a service anybody should
// stand on. So the depth is LIFTED out into a buffer of its own, and that lift
// is the one pass this costs.
//
// The lift earns more than legality. It hands the consumer METRES, so a material
// that wants to fade needs no near plane, no far plane, no field of view and no
// matrix — one texture, one texel size, and a distance it already has.
//
// AND WHY THE LAYER IS NOT DRAWN BACK INTO THE SCENE BUFFER, WHICH IS THE
// EXPENSIVE THING THIS UNIT FOUND. The obvious shape for all of this is to split
// the world's render in two — everything, then the lift, then the additives back
// over the same buffer with the clear off. It was built that way first, and it
// costs 2.8 MILLISECONDS on a stage that draws nothing at all. The cause is in
// three.js and is not negotiable from here: WebGLRenderer.render() resolves a
// multisampled target at the END OF EVERY CALL, so a world drawn in two calls
// pays a full 54 MB resolve of colour and depth TWICE. Measured across the tier
// with nothing on the layer (v0-fondazione/profondita/uscite/campioni.json):
//
//   samples 4 → 2.84 ms      samples 2 → 2.98 ms      samples 0 → 0.0008 ms
//
// Exactly nought where there is nothing to resolve, which is the whole of the
// proof. So the world is still drawn in ONE call, as it always was, and the
// additive layer goes into a buffer of its OWN — unmultisampled, with no depth
// attachment at all — which is then added to the frame in the two places the
// frame reads the scene: the bloom's prefilter and the composite. Additive
// blending is associative, so a glow accumulated apart and added afterwards is
// the same glow to the last bit; and the buffer standing outside the scene
// target is what keeps the resolve at one.
//
// WHICH MAKES THE FADE THE OCCLUSION, NOT AN ORNAMENT ON IT. There is no depth
// buffer on that target, so a material there has no hardware depth test to fall
// back on. It does not need one — the clamp at nought IS the test, over the
// whole depth of whatever stands in front — but it is a contract and not an
// implementation detail: a material on this layer that did not multiply by the
// fade would shine through every monolith in the world.

/**
 * The layer a material joins to be drawn AFTER the world, with the depth ready.
 *
 * `mesh.layers.set(SOFT_DEPTH_LAYER)` and nothing else. The chain takes the
 * layer off the camera for the world's own pass and draws it, and only it, into
 * a buffer of its own once the depth has been lifted; the composite adds that
 * buffer back, and the bloom takes it in as a source like any other glow.
 *
 * WHAT JOINING IT COSTS A MATERIAL, and both of these are the price of the
 * frame not paying for a second resolve:
 *
 *   NO HARDWARE DEPTH TEST. That buffer has no depth attachment. Multiply by
 *   softDepthFade or shine through the world — there is no third outcome.
 *   NO MULTISAMPLING. The scene's four samples do not reach it. What is drawn
 *   here has to be something with no geometric edge in it: a glow, a glare, a
 *   pool of light. It is the same argument this file already makes for putting
 *   the sun's rays at an eighth of the frame, and it is why this is a layer for
 *   ADDITIVES and not a general seat.
 *
 * Layer 1, because nothing in this world has ever set a layer and 0 is where
 * everything already is.
 */
export const SOFT_DEPTH_LAYER = 1;

/**
 * THE seat. Nothing else in this world may hold the world's distance.
 *
 * Shared BY REFERENCE the way src/world/face-light.js shares the sun: the chain
 * writes these two once a frame and every material that asked for them sees the
 * new value, because there is one object behind every copy. A material that
 * held its own would keep reading the buffer at the size the window used to be.
 */
/**
 * The world at rest: one texel, infinitely far away.
 *
 * WHAT THE SERVICE LOOKS LIKE WHEN IT IS NOT RUNNING, and the reason a consumer
 * needs no branch and no flag. A fade against a world that is a million metres
 * behind everything is exactly one, everywhere — so a material that multiplies
 * by `softDepthFade` draws precisely what it drew before this file had a depth
 * service, on any frame where the service is off, without knowing that it is.
 *
 * That is not a convenience, it is what makes the null honest: switching the
 * service off has to leave THE SAME PICTURE WITH THE SAME CONTENT, or the two
 * frames a measurement stands between are not two versions of one thing.
 */
const SOFT_DEPTH_REST = new DataTexture(new Float32Array([1e6]), 1, 1, RedFormat, FloatType);
SOFT_DEPTH_REST.needsUpdate = true;

/** And the layer's own buffer at rest: one black texel, adding nothing. */
const SOFT_GLOW_REST = new DataTexture(new Float32Array([0, 0, 0, 1]), 1, 1, RGBAFormat, FloatType);
SOFT_GLOW_REST.needsUpdate = true;

const SOFT_DEPTH_SEAT = {
  tSceneDepth: { value: SOFT_DEPTH_REST },
  uSceneDepthTexel: { value: new Vector2(1, 1) },
};

// How many materials have sat down. The service is not a switch somebody has to
// remember to throw: a chain nobody reads from does not allocate the buffer, does
// not lift, does not split the render, and reports its stage as exactly nought.
let softDepthSeats = 0;

/**
 * The two uniforms SOFT_DEPTH_GLSL declares, and the act of asking for them is
 * what turns the service on.
 *
 * @returns {{tSceneDepth: object, uSceneDepthTexel: object}} the chain's own,
 *   by reference — spread into a material's uniforms, never copied by value.
 */
export function softDepthUniforms() {
  softDepthSeats++;
  return { ...SOFT_DEPTH_SEAT };
}

/**
 * The vertex half: it carries the fragment's own distance down to where the
 * comparison happens.
 *
 * `carrySoftDepth` takes a VIEW SPACE position because that is the one form
 * every material already has — `(modelViewMatrix * vec4(position, 1.0)).xyz` —
 * and because a billboard may want to hand it the EMITTER'S centre rather than
 * the corner of its own quad. Which of the two is right is the material's
 * business; producing the metre is not.
 */
export const SOFT_DEPTH_VERTEX_GLSL = /* glsl */`
  varying float vSoftDistance;

  void carrySoftDepth(vec3 viewPosition) {
    vSoftDistance = length(viewPosition);
  }
`;

/**
 * The fragment half. Two lines of arithmetic and no camera at all.
 *
 * `softDepthFade(fadeM)` is one where this fragment stands `fadeM` metres clear
 * of the world, ramps to nought as the world comes up to meet it, and is CLAMPED
 * at nought for every metre the world is in front of it. That last clamp is not
 * a detail: it is the occlusion, and it is why a material that multiplies by
 * this may put its hardware depth test down without its glow appearing through a
 * monolith.
 *
 * The fade distance is the material's, not this file's. A halo of 0.13 m and a
 * pool on the grass do not want the same ramp, and a service that chose one for
 * both would be a second opinion about how big a glow is.
 */
export const SOFT_DEPTH_GLSL = /* glsl */`
  uniform sampler2D tSceneDepth;   // metres to the world, from the pass just drawn
  uniform vec2 uSceneDepthTexel;   // one over the scene buffer, across and down
  varying float vSoftDistance;

  /** How far the world is at this fragment's own pixel, in metres. */
  float softSceneDistance() {
    return texture2D(tSceneDepth, gl_FragCoord.xy * uSceneDepthTexel).x;
  }

  /** One where this fragment stands clear of the world, nought where it meets it. */
  float softDepthFade(float fadeM) {
    return clamp((softSceneDistance() - vSoftDistance) / max(fadeM, 1e-4), 0.0, 1.0);
  }
`;

// The lift itself: the scene buffer's depth attachment, read once, written out
// as metres along the eye ray. One channel, sixteen bit float, at the full
// resolution of the frame.
//
// FULL RESOLUTION AND NOT A HALF OF IT. Every other reduced buffer in this file
// is reduced because what it carries has no edges in it. This one is nothing but
// edges: it is read exactly where a silhouette crosses a glow, and a half
// resolution depth puts a halo of wrong distances one pixel wide around every
// tuft in the meadow — which is the defect this service exists to remove, drawn
// smaller.
//
// SIXTEEN BIT FLOAT, AND WHAT IT COSTS IN METRES. Half float carries about one
// part in two thousand, so the world's distance is good to 1.5 mm at three
// metres, 20 mm at forty and 150 mm at three hundred. A halo's ramp is a tenth
// of a metre wide, so the near lamps — the ones with a legible halo and a pool
// on the grass — get forty steps across their fade, and the far ones, which are
// a glare on an angular floor and a few pixels across, get a gradient no coarser
// than the pixels it is drawn into.
const SOFT_DEPTH_LIFT = /* glsl */`
${RAY_DISTANCE_GLSL}
  uniform sampler2D tDepth;
  varying vec2 vUv;

  void main() {
    gl_FragColor = vec4(sceneDistanceAt(texture2D(tDepth, vUv).x, vUv), 0.0, 0.0, 1.0);
  }
`;

// =============================================================================
//                    THE FIELD'S OWN PASS, AT ITS OWN PIXEL
// =============================================================================
//
// WHAT IT IS FOR. E-PERF5 weighed the frame draw by draw and found ONE item
// carrying two thirds of it: the ray marched ground, 16,62 ms of a 25,61 ms
// frame at the pose the campaign judges on. It is not dear because there is a
// lot of it -- it is one box, twelve triangles, one draw -- it is dear PER
// PIXEL OF EARTH, and the sweep of the resolution lever proved that to the
// second digit: at scale 0,75 the frame draws 56,3 % of the pixels and the
// field costs 55,2 % of what it cost. A cost that tracks the pixel count that
// closely has exactly one cheap lever on it, and it is the pixel count.
//
// AND THE LEVER MAY NOT BE THE FRAME'S. `setRenderScale` takes the whole
// picture down with it, and the plate 2026-09-06-perf-5-leva-risoluzione.png
// is the reason that was refused: at 0,85 the meadow holds and THE WRITING ON
// THE MONOLITH softens with it, and the writing is the portfolio. So the pixel
// is taken from the ground ALONE. The field is drawn into a buffer of its own
// at a fraction of a side, and put back at full resolution by a quad that
// carries its colour and its depth; everything else in the world -- the
// masonry, the engraving, the flowers, the walker -- is drawn at the pixel it
// has always been drawn at, in the same one pass it has always been drawn in.
//
// WHY THE RECOMPOSITION IS A MESH IN THE WORLD AND NOT A PASS IN THIS FILE.
// The field ships at renderOrder 10, last of the opaques, behind the sky and
// the skyline and in front of nothing: that is what lets a partly covered pixel
// stand against a sky that is already there, and it is what puts the whole
// meadow's depth into the buffer before the transparent flowers are drawn over
// it. A composite done here would have to be a SECOND render into the scene
// target, and a second render into a multisampled target is a second full
// resolve of it -- see the note on the one call in `render` below. Standing the
// recomposition where the field itself stood costs no resolve, no binding and
// no reordering: it IS the field's draw, with a cheaper fragment.
//
// Layer 2. Layer 1 is the depth service's, and 0 is where everything else in
// this world already is.
export const CAMPO_LAYER = 2;

/** The field at rest: one texel that covers nothing, so the resolve discards. */
const CAMPO_REST = new DataTexture(new Float32Array([0, 0, 0, 0]), 1, 1, RGBAFormat, FloatType);
CAMPO_REST.needsUpdate = true;

/** And its depth at rest: the far plane, which no fragment can be nearer than. */
const CAMPO_DEPTH_REST = new DataTexture(new Float32Array([1]), 1, 1, RedFormat, FloatType);
CAMPO_DEPTH_REST.needsUpdate = true;

/**
 * THE seat, shared by reference the way the depth service's is.
 *
 * `uCampoSize` is the reduced buffer in texels and `uCampoOn` is whether there
 * is one at all. At rest the pair says "one texel, covering nothing", and a
 * resolve that reads it discards every fragment -- which is what makes the null
 * honest: switching the pass off has to leave the same picture, drawn the way
 * it was drawn before this existed, and it does, because the field's own mesh
 * goes back into `scene` on the same frame.
 */
const CAMPO_SEAT = {
  tCampo: { value: CAMPO_REST },
  tCampoDepth: { value: CAMPO_DEPTH_REST },
  uCampoSize: { value: new Vector2(1, 1) },
  uCampoOn: { value: 0 },
};

/**
 * THE SUB-TEXEL OFFSET OF THE FIELD'S RAYS, one object behind every copy.
 *
 * The marcher declares `uJitter` and takes this by reference
 * (src/world/voxel/campo-material.js), the frame writes it once before the
 * field's pass, and NOUGHT is the world that shipped: a nought added to the
 * rotated grid's own offset leaves the same float, so the null is not a
 * near-enough but the same arithmetic, and the frame's byte is the frame's
 * byte. It is only ever moved while the memory below is accumulating, because
 * a ground sampled somewhere new every frame and never added up is a ground
 * that sparkles on purpose.
 */
export const CAMPO_JITTER = { value: new Vector2(0, 0) };

/**
 * THE GROUND'S MEMORY, as it is ASKED FOR rather than as it is spent.
 *
 * Two numbers and no buffers: `weight` is how much of the accumulated past the
 * ground keeps (nought is off, and off is what ships), `jitter` is whether the
 * ray moves under the accumulation at all. The address writes them through
 * src/world/layers/v1-suolo.js and the field's own object
 * (src/world/voxel/campo-field.js setMemory), and the frame reads them here --
 * the same seam, in the same direction, that campoScale already travels.
 *
 * WHY A PLAIN OBJECT AND NOT A SETTER ON THE RENDERER. The handle belongs to
 * the ground and the buffers belong to the frame, and the one thing that must
 * not happen is a third place that believes it knows the answer: the governor
 * settles the tier, the address may overrule it, and the pass reads whatever
 * the two of them left here on the frame it draws.
 */
export const CAMPO_MEMORY = { weight: 0, jitter: false };

// How many materials have sat down. Like the depth service: a chain nobody
// reads from allocates no buffer, splits no render, and reports nought.
let campoSeats = 0;

/**
 * The four uniforms the recomposition declares, and the act of asking for them
 * is what tells this file there is a field to draw apart.
 *
 * @returns {object} the chain's own, by reference -- spread into a material's
 *   uniforms, never copied by value.
 */
export function campoUniforms() {
  campoSeats++;
  return { ...CAMPO_SEAT };
}

// =============================================================================
//                    THE GROUND'S MEMORY, AND WHAT IT IS FOR
// =============================================================================
//
// THE DEFECT. The field asks its question ONCE PER TEXEL of a buffer that is
// three quarters of a side at the high tier and a half at the other two, so the
// ground is decided at 0.75, 0.43 and 0.38 of a screen pixel; the recomposition
// above weighs four of those texels but by design does not blend across an
// arris, so every edge of every cube lands on a step of one to three pixels.
// None of that moves while nothing moves -- and something always moves, because
// the body BREATHES (1.2 mm and 0.045 degrees, src/core/presence.js), which is
// about one pixel, which is enough to make the rim texels change sides. The
// committente reads that as «bordi a scaletta che tremano».
//
// THE CURE, and it is the oldest one there is: sample somewhere else each frame
// and add the frames up. One ray a texel is one ray a texel whatever is done
// afterwards, but eight frames of one ray, each aimed at a different eighth of
// the texel, carry eight samples of it -- so the edge stops being a step that
// snaps and becomes a gradient that stands. The two halves have to be together:
// the offset alone moves the step around (worse, and measurably), and the
// accumulation alone has nothing new to add up.
//
// WHAT IS REPROJECTED, AND WHY IT IS ALLOWED TO BE. The ground is STATIC: no
// blade of this meadow moves on its own, and everything that does move in the
// frame -- the walker, the flowers, the markers -- is drawn in the world's own
// pass and is not in this buffer at all. So a texel's world point is recovered
// from its own depth, projected with the camera the PREVIOUS frame was drawn
// with, and that is where its past is. There is no velocity buffer to keep and
// none to be wrong.
//
// AND THE THREE WAYS IT IS REFUSED, because a memory that is never refused is a
// smear:
//   1. the past has to be ON THE SCREEN it was drawn on -- outside [0,1] there
//      is nothing to read, which is the rim of the frame and a turn of the head;
//   2. the past has to be THE SAME PLACE, and the gate says so IN METRES: the
//      texel's world point, and the world point the past texel was written at,
//      have to be within about one texel's own footprint of each other. That is
//      what a disocclusion fails -- ground that was behind the ridge last frame
//      reads back a point ON the ridge, metres away -- and it is what the
//      offset does NOT fail, because an offset of less than a texel moves the
//      point it hits by less than a texel.
//
//      IT WAS FIRST BUILT AS THE RECOMPOSITION'S OWN GATE, a tolerance read off
//      the local slope of the buffer's depth, and that is MEASURED TO BE THE
//      WRONG GATE HERE, which is worth writing down. That gate compares two
//      texels of ONE frame, where the only thing between them is the slope;
//      this one compares one texel of TWO frames, where the offset has moved
//      the ray -- and at an arris the offset moves the hit onto the other
//      surface, which is a depth a slope tolerance refuses. So the memory was
//      refused exactly at the edges it exists to hold still: with the slope
//      gate the ground at rest read 2.54 levels of its own flicker and the
//      breath 6.85; with the gate in metres, 0.66 and 4.01. Both readings are
//      in the verbale;
//   3. and whatever survives both is STRETCHED INTO THE NEIGHBOURHOOD of what
//      this frame actually marched (the min and max of the nine texels around
//      it). This is the one that pays for the walk: a past that is merely close
//      enough is still a past from before the step, and a colour clamped into
//      the 3x3 of the present cannot be a trail of where the walker was.
const CAMPO_MEMORY_FRAGMENT = /* glsl */`
  precision highp float;
  precision highp int;

  out vec4 fragColour;

  uniform sampler2D tRaw;
  uniform sampler2D tRawDepth;
  uniform sampler2D tPast;
  uniform sampler2D tPastDepth;
  uniform vec2 uSize;
  uniform mat4 uInvViewProj;
  uniform mat4 uPrevViewProj;
  uniform mat4 uPrevInvViewProj;
  uniform float uWeight;
  uniform float uPast;
  // How many of a texel's OWN FOOTPRINT ON THE GROUND two world points may be
  // apart and still be the same place.
  uniform float uGate;

  /** The world point a texel of this buffer stands on, off its own depth. */
  vec3 standsOn(mat4 undo, vec2 uv, float depth) {
    vec4 p = undo * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }

  void main() {
    ivec2 lim = ivec2(uSize) - 1;
    ivec2 at = clamp(ivec2(gl_FragCoord.xy), ivec2(0), lim);
    vec4 raw = texelFetch(tRaw, at, 0);
    float d = texelFetch(tRawDepth, at, 0).x;

    // THE DEPTH IS THE MARCHER'S, CARRIED THROUGH UNTOUCHED, and that is a
    // decision and not an omission. The recomposition's gate reads the depth of
    // the buffer it is handed and clusters the four taps around it: fed a depth
    // blended between two frames it would be gating this frame's colours with
    // last frame's geometry, and at an arris that is precisely the disagreement
    // the gate exists to resolve. A place is not a quantity. Measured both
    // ways -- see the verbale -- and the carried depth is what holds the arris.
    gl_FragDepth = d;

    // THE RAW FRAME IS THE ANSWER until something has been PROVED about the
    // past, so every refusal below is a plain return.
    fragColour = raw;
    if (uPast < 0.5 || uWeight <= 0.0) return;
    // A texel no ray landed in is the sky coming through the recomposition, and
    // a past blended into it would grow the ridge by a texel: a halo, which is
    // the one thing this buffer is not allowed to do.
    if (raw.a <= 0.0) return;

    // WHERE THIS TEXEL STANDS IN THE WORLD, off its own depth and the inverse
    // of the very matrix the marcher wrote that depth with.
    vec2 uv = (vec2(at) + 0.5) / uSize;
    vec3 here = standsOn(uInvViewProj, uv, d);

    vec4 prev = uPrevViewProj * vec4(here, 1.0);
    if (prev.w <= 0.0) return;
    vec3 ndc = prev.xyz / prev.w;
    vec2 puv = ndc.xy * 0.5 + 0.5;
    if (puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) return;

    vec4 past = texture(tPast, puv);
    if (past.a <= 0.0) return;

    // THE GATE, AND IT IS IN METRES ON THE GROUND.
    //
    // Where the past texel actually STOOD, undone with the matrix it was
    // written under, against where this texel stands now. And the tolerance is
    // THIS TEXEL'S OWN FOOTPRINT, measured rather than assumed: how far the
    // world point moves when the texel moves by one, left-right and up-down,
    // taking the NEARER of the two sides each way. That last part is the whole
    // of it -- a meadow seen at a grazing angle puts metres of ground inside
    // one texel, so a tolerance figured from the distance alone refuses every
    // texel in the near field; and at an arris one side of the pair jumps the
    // height of a cube, so taking the nearer side keeps the tolerance honest
    // exactly where a disocclusion has to be refused.
    vec3 xm = standsOn(uInvViewProj, uv - vec2(1.0 / uSize.x, 0.0),
      texelFetch(tRawDepth, clamp(at - ivec2(1, 0), ivec2(0), lim), 0).x);
    vec3 xp = standsOn(uInvViewProj, uv + vec2(1.0 / uSize.x, 0.0),
      texelFetch(tRawDepth, clamp(at + ivec2(1, 0), ivec2(0), lim), 0).x);
    vec3 ym = standsOn(uInvViewProj, uv - vec2(0.0, 1.0 / uSize.y),
      texelFetch(tRawDepth, clamp(at - ivec2(0, 1), ivec2(0), lim), 0).x);
    vec3 yp = standsOn(uInvViewProj, uv + vec2(0.0, 1.0 / uSize.y),
      texelFetch(tRawDepth, clamp(at + ivec2(0, 1), ivec2(0), lim), 0).x);
    float foot = min(length(xm - here), length(xp - here))
      + min(length(ym - here), length(yp - here));
    vec3 was = standsOn(uPrevInvViewProj, puv, texture(tPastDepth, puv).x);
    if (length(was - here) > uGate * foot) return;

    // AND THE NEIGHBOURHOOD, which is what separates a memory from a trail.
    vec4 lo = raw;
    vec4 hi = raw;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec4 n = texelFetch(tRaw, clamp(at + ivec2(i, j), ivec2(0), lim), 0);
        if (n.a <= 0.0) continue;
        lo = min(lo, n);
        hi = max(hi, n);
      }
    }
    fragColour = mix(raw, clamp(past, lo, hi), uWeight);
  }
`;

// THE OFFSETS, AND THEY ARE A SEQUENCE AND NOT A RANDOM NUMBER.
//
// Halton on bases two and three: every prefix of it covers the texel evenly, so
// the frames that have arrived so far are always well spread rather than well
// spread only once the cycle has closed -- which matters because the walker
// turns their head and the accumulation restarts wherever the sequence happens
// to be. Eight of them, centred on the texel, because eight is where the
// convergence of a weight near nine tenths has settled, and a longer cycle is a
// longer wait before a disoccluded edge has its samples.
export const CAMPO_JITTER_CYCLE = 8;

function halton(index, base) {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

const CAMPO_JITTER_SEQUENCE = Array.from({ length: CAMPO_JITTER_CYCLE }, (_, i) => [
  halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5,
]);

/**
 * HOW FAR THE VIEW HAS TO MOVE, IN TEXELS, BEFORE THE OFFSET MOVES WITH IT.
 *
 * A TWO HUNDREDTH OF A TEXEL, AND EVERY DIGIT OF IT IS A READING.
 *
 * The first thing this number taught was how violent the defect is. A breathing
 * body swings the view by NINE THOUSANDTHS of a texel a frame at the low tier
 * and twenty four at the high one -- a fortieth of a screen pixel -- and that is
 * what moves the ground by six and eleven levels. Nothing about this is
 * parallax; it is one ray a texel changing its mind about which blade it is
 * looking at, which is exactly what E-SCINTILLIO1 said it was.
 *
 * The second thing is where the floor belongs. The walker who asks for less
 * movement gets the same breath at a twelfth: one and a half thousandths of a
 * texel at the low tier, two and a half at the high one. That is a view which
 * is, for this purpose, standing still -- and an offset moving under it was the
 * loudest thing left in the frame, putting 2.04 levels where the world without
 * it had 1.06. So the floor sits between the two readings, nearer the quiet one:
 * under it the offset holds, the marched frame settles and the accumulation
 * converges onto it, which is also what the perfectly still camera of a guard
 * gets, from the same rule and for the same reason.
 *
 * WHAT IT DID NOT CLOSE, because a floor of one number cannot: at the high tier
 * the reduced breath still crosses it on about a fifth of its frames (its
 * ninetieth is 0.0086 of a texel against this 0.005), and with the offset turned
 * on there the same leg reads 3.83 levels against the 2.21 of the memory alone.
 * That is one of the two readings that keep the offset opt in -- see campojitter
 * in src/world/layers/v1-suolo.js -- rather than something this floor hides. A
 * floor in texels is also a floor that means different things at the two tiers,
 * the buffer being twice the height at the high one for the same angle, and a
 * floor in degrees would not have that fault: it is written down because the
 * next session to touch this will want to know.
 */
const CAMPO_JITTER_FLOOR = 0.005;

export function createPostPipeline(gl) {
  // The scene is drawn in light units and stays that way until the composite;
  // the renderer must not apply a curve of its own on the way.
  gl.toneMapping = NoToneMapping;

  const quad = new Mesh(new PlaneGeometry(2, 2));
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(quad);

  const pass = (fragmentShader, uniforms) => new ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
  });

  /**
   * THE GROUND'S MEMORY. See CAMPO_MEMORY_FRAGMENT above for what it does.
   *
   * IT WRITES DEPTH, WHICH IS WHY IT IS NOT BUILT WITH `pass` ABOVE. The
   * recomposition is handed a colour and a depth from the same texel, and the
   * depth it is handed has to be the marcher's own -- so this pass carries it
   * through gl_FragDepth into the buffer it writes. A write to the depth
   * attachment only happens while the depth TEST is on, so the test is on and
   * set to ALWAYS: every fragment of two triangles covering the buffer, in the
   * order they are drawn, which is the order of one draw.
   */
  const campoMemory = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: FULLSCREEN_VERTEX_300,
    fragmentShader: CAMPO_MEMORY_FRAGMENT,
    uniforms: {
      tRaw: { value: null },
      tRawDepth: { value: null },
      tPast: { value: null },
      tPastDepth: { value: null },
      uSize: { value: new Vector2(1, 1) },
      uInvViewProj: { value: new Matrix4() },
      uPrevViewProj: { value: new Matrix4() },
      uPrevInvViewProj: { value: new Matrix4() },
      uWeight: { value: 0 },
      uPast: { value: 0 },
      // FOUR OF THE TEXEL'S OWN FOOTPRINT, and it is a measurement rather than
      // a taste. One and a half refuses the offset itself and the ground kept
      // 2.19 levels of flicker under the breath it should have removed; eight
      // lets a disocclusion through and the neighbourhood clamp has to catch
      // it alone. At four the breath reads 4.90 against the 6.14 of the world
      // without a memory, and nothing was seen to smear. In the verbale.
      uGate: { value: 4 },
    },
    depthTest: true,
    depthFunc: AlwaysDepth,
    depthWrite: true,
    blending: NoBlending,
  });

  // Threshold, knee and strength are set against the emissives, which are the
  // only things in this scene that exist to glow. At 1.1 the threshold sat
  // above every one of them: the engraved cyan of the reference peaks at about
  // eight tenths of a unit of radiance, so the writing was drawn with no halo
  // at all and the bloom was working only on the tops of the clouds. Lowered to
  // just under the ink and softened by the knee, it catches the letters, the
  // rhombus, the hoop and the line under each stair nosing, and it still leaves
  // the meadow and the stone — an order of magnitude darker — alone. It stops
  // at seven tenths and not lower because the water carries the sky and is the
  // next brightest thing in the frame: taking it in costs the rivulet a unit of
  // colour error and buys the letters nothing the canvas has not drawn already.
  //
  // THE SCENE'S OWN GRADE, and where its numbers come from.
  //
  // Every one of them is fitted rather than chosen — s2-dev5/adatta.mjs sweeps
  // them in the engine against the reference, over the mask of uncontradicted
  // ground that s2-dev4 declared, and the fit is recorded in s2-dev5/VERBALE.md
  // with the frame each number was read from. What is written here is what that
  // sweep returned, and it is exposed on `params` so the eye can be asked
  // whether it agrees with the arithmetic.
  //
  // `band` and `horizon` are metres. The near band is where the reference wants
  // this world's ground darker; the horizon pair is where the correction has to
  // be gone, and it is gone over the same distances at which the haze finishes,
  // so no line is drawn along the ridges.
  const params = {
    exposure: 1.0,
    bloomStrength: 0.11,
    bloomThreshold: 0.72,
    bloomKnee: 0.30,
    lutIntensity: 1.0,
    // WHERE THE CURVE SITS, AND WHY IT SITS SO CLOSE TO NOTHING.
    //
    // Swept in the engine against the reference (s2-dev5/adatta6.mjs), over the
    // percentiles of the uncontradicted ground, the named patch per channel, and
    // every zone of the checklist the committente's decision 6 has not released
    // — the last of those under a fence: no zone may move more than four levels
    // away from where the reference has it.
    //
    // The fence is what holds it here, and the fence is not a preference. The
    // reference wants its near meadow far darker than this world draws it and
    // its stone exactly where this world already has it, and the two sit at the
    // SAME LUMINANCE: sixty two levels of stone against seventy of grass. A
    // curve on luminance cannot tell them apart. A term on the distance from the
    // eye could, and it is forbidden, because it travels with the walker and
    // the committente found it by walking. A term on colour cannot, because the
    // near meadow that is too bright and the middle meadow that is too dark are
    // the same green. Measured: a gain of 1.2 buys eight levels of p1 and pays
    // thirteen on the front face of the 03, which the checklist judges by eye
    // and which was right before it.
    //
    // So the tonal gap of the lower half is not a grading gap. It is the grass
    // (S4) and the path's own level (S3), and this pass says so by declining to
    // spend the stone on it. The instrument is here, fitted, exposed on the
    // development panel and on `params`, and a ladder of stronger settings with
    // what each one costs is in s2-dev5/VERBALE.md for the committente to
    // choose from.
    sceneBlack: 0.015,
    sceneGain: 1.0,
    scenePivot: 0.43,
    // Where the straight part of the curve gives way to the bend. Nothing in
    // the picture reaches a flat zero above it.
    sceneKnee: 0.10,
    // What shadow is made of in this picture. The reference's shadow is colder
    // than this world's — its named patch carries fifteen and a half more blue
    // than red where this world carried three less — and no subtraction can
    // make a colour bluer, only darker, so it is a multiply and it fades in as
    // the frame goes dark. Held to taking a fifth of the red out of the deepest
    // fifth of the range: past that the rock in the corner starts to notice.
    shadowTint: [0.80, 1.0, 1.0],
    shadowRange: 0.30,
    // How much of it the scene takes. ONE number for every distance: there is
    // no near band, because a term hung on the distance from the camera is a
    // patch of shade that follows the walker.
    sceneAmount: 1.0,
    sceneHorizon: [60.0, 160.0],

    // ------------------------------------------------------------ THE EYE
    //
    // What the four effects of src/core/eye.js LOOK like, as against when they
    // happen, which is that file's. Both halves are live: this object is
    // reachable at renderer.post.params.eye and the timing at
    // window.farfield.eye.tuning, and a number changed in either takes on the
    // next frame — which is the only way any of them can be settled, because
    // the way to settle them is to walk.
    //
    // THE FIRST DELIVERY'S VALUES WERE DELIBERATELY SOBER, AND THE COMMITTENTE
    // WALKED IT AND COULD NOT SEE THREE OF THE FOUR. The numbers below are the
    // second pass's answer, and s2-dev8/out/diagnosi.txt is why each of them
    // moved — measured, on the committed tree, before anything was changed:
    //
    //   the defocus, standing in front of a face with the focus at 0.954,
    //   moved the picture 3.65 levels out of 255 — UNDER the 4.1 levels the
    //   grass moves on its own between two frames. Not a gate that failed to
    //   fire: an effect quieter than the noise it was laid on.
    //
    // And the arithmetic behind that one number is worth writing down, because
    // it says which of the two knobs had to move. At a focal plane of 4.4 m —
    // a face within reach — the far field is |1/22 − 1/4.4| = 0.18 dioptres,
    // and a spread of 3.0 turns that into a circle of confusion of 0.55, not 1.
    // Times a strength of 0.30, the background of that picture was getting a
    // SIXTEEN PER CENT blend of a five pixel blur. Both had to go up: the
    // spread, so that the world behind a face is actually at full circle, and
    // the strength, so that full circle is worth something.
    eye: {
      // DIOPTRES TO CIRCLE OF CONFUSION, and the third pass brought it DOWN.
      //
      // The second delivery ran 6.0, which was the right answer to the question
      // it was asked and the wrong answer to this one. With the plane pinned at
      // a block 4.4 m off, the whole far field of that picture sat at 0.18
      // dioptres and a spread of 6 was what it took to get it to a full circle.
      // With the plane at the GAZE the numbers are completely different: look at
      // a face two metres away and the ridge behind it is 0.49 dioptres off, so
      // 6.0 would take everything past three metres to a hard full circle and
      // hold it there — which is the "passaggio netto, non graduale" the
      // committente saw. At 2.6 the same picture puts the ridge at nine tenths of a circle
      // and the ground at five metres at six tenths and the stone at three at a
      // quarter: A GRADIENT ACROSS THE WHOLE DEPTH OF THE FRAME, which is what a
      // lens draws and what "graduale" means.
      focusSpread: 2.6,
      // How much of the defocused copy is mixed in at full circle. One, now, and
      // the two ways in are told apart in src/core/eye.js instead: a face being
      // read asks for three quarters of it and the lens leaning in asks for all
      // of it, which is the brief's "zoom RMB, piu' marcata".
      focusStrength: 1.0,
      // How far the defocus reaches, IN PIXELS OF THE FINISHED FRAME, over the
      // whole two pass chain rather than as one pass's tap spacing.
      focusReach: 13.0,
      // THE CIRCLE, IN PIXELS, UNDER WHICH THE BLURRED COPY SAYS NOTHING.
      // Nothing at all below the first, all of it above the second. It is not a
      // threshold on taste, it is the resolution of the instrument: this buffer
      // holds ONE width of blur, so asking it for a tenth of a circle gets a
      // tenth of thirteen pixels instead of the whole of one, and the difference
      // between those two pictures is precisely a halo. A quarter texel is four
      // pixels of the frame; under about a pixel of true circle there is nothing
      // in here that is not borrowed from too far away.
      //
      // ONE AND A HALF, AND FOUR, AND BOTH ARE STATEMENTS ABOUT THE INSTRUMENT
      // RATHER THAN ABOUT TASTE. Under a pixel and a half of true circle there
      // is nothing eight bits can carry; at four pixels the circle is finally as
      // wide as ONE TEXEL of the quarter resolution buffer this is read from, so
      // that is the first width the buffer can honestly claim to hold.
      //
      // Measured, on the walk the committente is describing — standing in front
      // of the sixth block and reading it (s2-dev12/out/soglia.txt):
      //
      //   halo round the letters, 3-4 px out    1.97 levels  ->  0.00
      //   halo inside the silhouettes, 5-8 px   1.35 levels  ->  0.25
      //   THE MEADOW AND THE RIDGE               0.82 levels  ->  0.81
      //
      // The third line is the one that makes the first two worth anything: the
      // meadow at nine metres and the ridge at two hundred and fifty are at 8.3
      // and 11.9 pixels of circle, no floor written here can reach them, and
      // they do not move. This is not the defocus turned down.
      focusFloorPx: [1.5, 4.0],
      // HOW NEAR AND HOW FAR THE EYE WILL ACCOMMODATE, in metres. Nearer than
      // the first, nothing in this world can be looked at; further than the
      // second, a lens is at infinity for every purpose this picture has —
      // forty metres and the far plane differ by a fortieth of a dioptre, which
      // is under a hundredth of a circle at this spread. The ceiling matters:
      // without it, looking at the sky would put the plane at the far plane,
      // a thousand metres, and the arithmetic would be doing sums about a
      // distance nothing is at.
      focusNearM: 0.35,
      focusFarM: 40.0,
      // How big the autofocus area is, as a fraction of the frame, half width
      // and half height. A camera's centre-weighted area, and the same size.
      focusAreaX: 0.045,
      focusAreaY: 0.055,
      // The focus pull, to nine tenths, in milliseconds — in DIOPTRES, so it is
      // the same speed racking from two metres to five as from five to
      // infinity. Slow enough to be a pull and not a cut.
      focusPullMs: 420,
      // Whether what glows refuses to defocus with the stone it is cut into.
      //
      // ON, AND IT IS THE COMMITTENTE'S RULING RATHER THAN A TUNING: «i testi
      // continuano a sfocarsi assieme al resto (i monoliti rimangono definiti)
      // ... l'inchiostro deve restare sempre nitido». The first pass left this
      // at nought and said in writing that one number would turn it round; this
      // is that number. What it costs is declared: a face outside the plane now
      // shows soft stone with sharp writing on it, which is not what a lens
      // does and IS what he asked to look at.
      //
      // On the same threshold and the same knee as everything else in this
      // pass, on BOTH the sharp frame and the blurred copy — see the composite.
      focusInkKeep: 1.0,

      // The adaptation, in stops, and the whole range either way. The timing of
      // it is the other half and it lives in src/core/eye.js: the range says
      // how far the eye opens, the tuning there says how long it takes.
      // A quarter of a stop measured 7.5 levels at the extremes; nearly a half
      // is the "si DEVE sentire l'occhio che si apre" the brief asks for.
      exposureEV: 0.45,

      // The veil towards the sun, and the two angles it lives between: nothing
      // at all beyond thirty eight degrees off the sun, full at eight. This is
      // the FLOOR of the sun system rather than the whole of it. IN LIGHT UNITS
      // NOW, like everything else the sun adds, which is the third pass's one
      // structural change: 0.12 of an encoded picture is a flat wash that
      // cannot roll off, and 0.30 of the scene's own light is a brightening
      // that goes through the curve with the sky it is over.
      glareStrength: 0.14,
      glareOuterDeg: 38,
      glareInnerDeg: 8,
      // The colour of it. Warm, because it is this sky's own sunlight taken
      // the wrong way through the optics, not a white sheet.
      glareTint: [1.0, 0.90, 0.72],

      // ------------------------------------------------- the sun in the picture
      //
      // THE RAYS. Density is how much of the way to the disc the march covers
      // in one go — under one, so the beams stay long; decay is what each step
      // keeps of the last, which is what makes them fade outward; weight is how
      // bright the sum comes back. The disc radius is in units of the frame's
      // HEIGHT, so the source is the size of a sun and not the size of a window.
      raysDensity: 0.85,
      raysDecay: 0.955,
      raysWeight: 0.80,
      raysDiscRadius: 0.24,
      // How much of the marched result reaches the picture, and its warmth. The
      // colour is the sky's own — that is what was sampled — so this is a tint
      // over it rather than a colour of its own, and the palette is S1's by
      // construction.
      raysAmount: 0.40,
      raysTint: [1.0, 0.94, 0.82],
      // What counts as light coming through, on the scene buffer before
      // anything touched it. Deliberately low: the disc falloff is what says
      // WHERE the source is, and this only has to take the dark side of a cloud
      // out of the sum so the beams thin and break as one crosses.
      raysThreshold: 0.06,
      raysKnee: 0.05,

      // THE FLARE. A halo, one streak, and three ghosts — see the notes in the
      // composite. EVERY AMPLITUDE HERE IS IN LIGHT UNITS AND NOT IN ENCODED
      // LEVELS, and that is why none of them looks like the second delivery's
      // number: what is added now goes through the exposure and the AgX curve
      // with the rest of the frame, so a tenth here is a tenth of the light the
      // meadow reflects rather than a tenth of the way to white.
      flareHalo: 0.45,        // how much light blooms round the disc
      flareRadius: 0.026,     // and how far, as a radius squared in frame heights
      flareStreak: 0.50,      // the anamorphic bar across it
      flareLength: 0.26,      // how far it runs, as an exponential fall in x
      flareHeight: 0.00022,   // and how tight it is in y, as a gaussian width²
      flareTint: [1.0, 0.93, 0.80],
      // HOW MUCH THE STREAK BREATHES, and it is the one knob the whole thing
      // has: the share by which its THICKNESS wanders either side of the value
      // above. Sixteen hundredths, and that is what the three sines are allowed
      // to add up to rather than what they reach: three rates chosen never to
      // come back into step almost never all agree, so the ten second
      // measurement turns this into a thickness that wanders by about a tenth
      // either side and never by an eighth (s2-dev12/out/respiro.txt) — inside
      // the ten to fifteen per cent the committente asked for, and under what
      // anybody would call a pulse.
      // AT NOUGHT THE BRANCH IS NOT TAKEN AND THE STREAK IS THE DELIVERED ONE
      // TO THE BIT — the value above was promoted, so it has to be reachable
      // again by one number and not by an argument.
      streakBreath: 0.16,
      // The ghosts: where each sits on the line from the disc through the middle
      // of the frame, how wide it is in frame heights, and how much light it
      // carries. One short of the middle, one just past it, one well beyond and
      // much larger and fainter — which is the arrangement a real stack makes,
      // because the pair of surfaces furthest apart gives the widest ghost.
      ghostAt: [0.38, 0.86, 1.45],
      ghostSize: [0.055, 0.030, 0.115],
      ghostGain: [0.22, 0.30, 0.12],
      // The cool end of the pair the ghosts are tinted between; the warm end is
      // flareTint. A ghost is the source seen through a different number of
      // coated surfaces, so no two of them are the same colour.
      ghostTint: [0.62, 0.80, 1.0],
      // How much of the disc has to be uncovered for the flare to be there, and
      // how quickly that number moves: quicker to uncover than to cover, which
      // is the hysteresis. Milliseconds to nine tenths.
      sunOpenMs: 90,
      sunCoverMs: 380,
      // The ring of taps round the disc that asks the question, as a radius in
      // frame heights.
      sunProbeRadius: 0.035,

      // ------------------------------------------------------------ the drops
      //
      // A preview and not the weather: see toggleRain in src/core/eye.js and
      // the key it hangs off. Rebuilt in the second pass to the committente's
      // own list of four faults — see rainAt in the composite.
      //
      // NINE COLUMNS AND THREE SLOTS EACH, where the second delivery had seven
      // and two — because the sizes are a distribution now rather than a size,
      // so most of what this draws is small. What a frame holds is two or three
      // beads worth looking at and a dozen too small to run.
      rainColumns: 9,
      rainDensity: 0.60,     // share of slots that carry a drop at all
      rainSize: 0.021,       // the LARGEST head's radius, in frame heights
      rainRefraction: 0.75,  // how far a bead moves what is behind it
      rainHighlight: 0.45,   // and how much light its shoulder catches
      // HOW MUCH THE WET TRACK SHOWS ON THE GLASS, and the name is finally the
      // thing again: the fourth pass left this uniform read by nothing at all,
      // because the trail it once scaled had been folded into the water's own
      // shape. It is now the whole worth of the veil the track leaves — the
      // shade the wet glass takes off what comes through it, and the shade its
      // own edge puts back — before rainHighlight multiplies it in the
      // composite. TWELVE HUNDREDTHS, so the deepest a track ever gets is five
      // per cent under the glass beside it: «bassissimo contrasto ... un velo
      // umido che scurisce/lucida appena il vetro», which is measured in §C of
      // s2-dev13/VERBALE.md and not hoped for.
      rainTrail: 0.12,
      // HOW QUICKLY THE TRACK DRIES, and it is the rate at which the water
      // itself narrows behind the bead.
      //
      // AND IT IS NOT WHAT WAS WRONG WITH THE FOURTH DELIVERY, which is worth
      // writing down because the fifth pass got it wrong first and a picture
      // said so. At one and three tenths the track survived the whole height of
      // the glass, and a track six hundred rows long is a line however wide it
      // starts — the crop came back with a hairline from the top of the frame
      // to the bottom of it. What made the shape a filament was the WIDTH and
      // the light on it, not the length: seven is a track that runs two or
      // three head-lengths and is gone, which is what the photograph shows.
      rainDrying: 7.0,
      // HOW MUCH A RUNNING BEAD GROWS EACH TIME IT SWALLOWS A STANDING ONE, as
      // a share of the size it was born at. A drop sliding down a pane sweeps up
      // what is in its path — that is why a windscreen ends up with a few big
      // beads rather than many equal ones — and it is counted on the beat the
      // bead already stalls on, so it catches, takes in what it has caught up
      // with, and goes. Nine hundredths over the four or five catches a run
      // holds is about a third bigger by the bottom of the glass, which is
      // measured at §D: the head this pass followed for five and a half seconds
      // went from 28 to 32 pixels across in steps, and took in a standing bead
      // outright at 8,0 s.
      rainMerge: 0.09,
      rainMistRows: 46,      // the standing domes of condensation, in cells down
      rainMistDensity: 0.16,
      // The whole front element is wet, not just where the beads are.
      rainWetness: 0.00016,  // a low frequency wobble, well under a pixel
      rainMicroStreak: 0.00009,
      // HOW MUCH THE EYE'S OWN TURNING DRAGS A BEAD ACROSS THE GLASS, and it
      // is NOUGHT, which is the fourth pass's answer to «muovendo la camera le
      // gocce ballano, seguono la traiettoria della camera». A pane of glass in
      // front of a face does not move when the face turns: the drops are
      // pinned to it, and a bead that swam after the camera was the third
      // delivery over-dosing an inertia that should barely exist. At one, a
      // hard turn leans a sliding bead by a tenth of the frame's height, which
      // is what was being drawn before; a fifth of that is a lean, and nought
      // is a windscreen. It only ever touches the beads that are SLIDING — one
      // held by its own contact line has nothing to lean with — and it never
      // touches the height, which has to stay monotone by construction.
      rainDrag: 0.0,
    },
  };
  const stages = {
    bloom: true, toneMap: true, grade: true, dither: true, sceneGrade: true,
    // Allowed, not applied: every one of these is nothing until its amount
    // leaves rest, and the rain's amount only leaves rest for a development key.
    focus: true, adaptation: true, glare: true, rain: true, sun: true,
  };

  // What the eye is doing THIS frame, written from src/core/eye.js and read
  // straight into the uniforms below. One object for the life of the page:
  // this is touched sixty times a second and a fresh one a frame is a
  // collection a minute.
  // WHERE THE PLANE USED TO BE. `plane` was here, in metres, written from
  // src/core/eye.js once a frame. It is gone, and it is gone because a focal
  // plane handed in from the CPU can only ever be a guess about what the walker
  // is looking at — the third pass's whole finding is that the guess was
  // "whatever block is nearest", and that a walker who turns away from it gets
  // a picture focused on something behind their shoulder. What replaced it is
  // the one pixel probe, which reads the answer out of the frame itself.
  const eye = {
    focus: 0,        // 0..1, how much of the defocus is showing
    exposure: 1,     // the adaptation, as a factor
    glare: 0,        // 0..1, the veil towards the sun at any angle
    sun: 0,          // 0..1, how much of the disc is on the glass
    streak: 0,       // 0..1, how much the anamorphic streak may breathe
    sunSeconds: 0,   // and the streak's own clock, in seconds
    rain: 0,         // 0..1
    seconds: 0,      // the drops' own clock
    sunView: new Vector3(0, 1, 0),
    sunNdc: new Vector2(0, 3),
    drag: new Vector2(),
  };
  // WHETHER THE MARCH IS WORTH RUNNING, with a Schmitt trigger on it.
  //
  // The amount itself is continuous — src/core/eye.js fades it over a margin
  // outside the frame rather than cutting at the border, so the picture cannot
  // snap. What would otherwise snap is this: a sun grazing the edge of the frame
  // would switch a whole render pass on and off frame by frame, which is a
  // stutter and a clock stage that reads as noise. Two thresholds, a decade
  // apart, so it comes on when there is something to see and stays on until
  // there is nothing.
  const RAYS_ON = 0.02;
  const RAYS_OFF = 0.004;
  let raysLive = false;

  // THE WAKING, AND IT IS NOT PART OF THE EYE.
  //
  // Written only by src/ui/intro.js, over the three and a half seconds between
  // the visitor's gesture and the arrival veil, and by nothing else ever. It is
  // kept apart from `eye` above for the reason the composite says at greater
  // length: the eye's contract is that it is at rest wherever a walker was
  // PLACED rather than walked, which is what makes a pose photographable twice,
  // and the opening scene is not a state of the walker's body — it does not
  // exist under ?dev at all. At rest, and it starts at rest.
  const wake = { blur: 0, exposure: 1 };

  const fallbackLut = identityLut();

  const prefilter = pass(PREFILTER_FRAGMENT, {
    tSource: { value: null },
    tGlow: { value: SOFT_GLOW_REST },
    uThreshold: { value: params.bloomThreshold },
    uKnee: { value: params.bloomKnee },
  });
  const down = pass(DOWN_FRAGMENT, { tSource: { value: null }, uHalfPixel: { value: new Vector2() } });
  const up = pass(UP_FRAGMENT, { tSource: { value: null }, uHalfPixel: { value: new Vector2() } });
  // The depth service's one pass. Compiled with everything else and never drawn
  // until a material sits down: a program that is not used costs its compile
  // once, and this file would rather pay that at start-up than in a walk.
  const lift = pass(SOFT_DEPTH_LIFT, {
    tDepth: { value: null },
    uCameraRange: { value: new Vector2(0.1, 1000) },
    uTanHalf: { value: new Vector2(1, 1) },
  });
  // The one pixel that carries the accommodation and the sun's occlusion
  // forward in time. Two draws of one fragment; see PROBE_FRAGMENT.
  const probeAf = pass(PROBE_FRAGMENT, {
    tDepth: { value: null },
    tPrev: { value: null },
    uProbeArea: { value: new Vector2(params.eye.focusAreaX, params.eye.focusAreaY) },
    uProbeSnap: { value: new Vector2(1, 1) },
    uProbeTau: { value: new Vector3(0.18, 0.04, 0.16) },
    uDt: { value: 1 / 60 },
    uSunUv: { value: new Vector2(0.5, 2) },
    uSunProbe: { value: new Vector2(0.02, 0.035) },
    uPlaneRange: { value: new Vector2(1 / 40, 1 / 0.35) },
    uCameraRange: { value: new Vector2(0.1, 1000) },
    uTanHalf: { value: new Vector2(1, 1) },
    uFocusSpread: { value: params.eye.focusSpread },
    uInkKeep: { value: params.eye.focusInkKeep },
    uGlow: { value: new Vector2(params.bloomThreshold, params.bloomKnee) },
  });
  // The defocus, at a quarter of the frame and only on the frames that ask for it.
  const defocus = pass(FOCUS_FRAGMENT, {
    tSource: { value: null },
    tDepth: { value: null },
    tProbe: { value: null },
    uStep: { value: new Vector2() },
    uCameraRange: { value: new Vector2(0.1, 1000) },
    uTanHalf: { value: new Vector2(1, 1) },
    uFocusSpread: { value: params.eye.focusSpread },
    uInkKeep: { value: params.eye.focusInkKeep },
    uGlow: { value: new Vector2(params.bloomThreshold, params.bloomKnee) },
    uWake: { value: 0 },
  });
  // The march towards the sun, at a quarter of the frame and only on the frames
  // where there is a sun on the glass to march towards.
  const sunrays = pass(SUNRAYS_FRAGMENT, {
    tSource: { value: null },
    tDepth: { value: null },
    uSunUv: { value: new Vector2(0.5, 2) },
    uAspect: { value: 1 },
    uRay: {
      value: new Vector4(params.eye.raysDensity, params.eye.raysDecay, params.eye.raysWeight,
        params.eye.raysDiscRadius * params.eye.raysDiscRadius),
    },
    uRayBright: { value: new Vector2(params.eye.raysThreshold, params.eye.raysKnee) },
  });
  const composite = pass(COMPOSITE_FRAGMENT, {
    tScene: { value: null },
    tBloom: { value: null },
    tLut: { value: fallbackLut },
    tDepth: { value: null },
    tFocus: { value: null },
    tRays: { value: null },
    tProbe: { value: null },
    tGlow: { value: SOFT_GLOW_REST },
    uExposure: { value: params.exposure },
    uBloomStrength: { value: params.bloomStrength },
    uLutIntensity: { value: params.lutIntensity },
    uLutSize: { value: LUT_SIZE },
    uStages: { value: 55 },
    uSceneBlack: { value: params.sceneBlack },
    uSceneKnee: { value: params.sceneKnee },
    uShadowTint: { value: new Vector3(...params.shadowTint) },
    uShadowRange: { value: params.shadowRange },
    uSceneGain: { value: params.sceneGain },
    uScenePivot: { value: params.scenePivot },
    uSceneAmount: { value: params.sceneAmount },
    uSceneHorizon: { value: new Vector2(...params.sceneHorizon) },
    uCameraRange: { value: new Vector2(0.1, 1000) },
    uTanHalf: { value: new Vector2(1, 1) },
    uFocusSpread: { value: params.eye.focusSpread },
    uGlowThreshold: { value: params.bloomThreshold },
    uGlowKnee: { value: params.bloomKnee },
    uEyeExposure: { value: 1 },
    uFocusAmount: { value: 0 },
    uFocusInkKeep: { value: params.eye.focusInkKeep },
    uFocusReachPx: { value: params.eye.focusReach },
    uFocusFloor: { value: new Vector2(...params.eye.focusFloorPx) },
    uWakeBlur: { value: 0 },
    uWakeExposure: { value: 1 },
    uSunView: { value: new Vector3(0, 1, 0) },
    uGlare: { value: 0 },
    uGlareEdge: { value: new Vector2(0.788, 0.990) },
    uGlareTint: { value: new Vector3(...params.eye.glareTint) },
    uSun: { value: 0 },
    uSunUv: { value: new Vector2(0.5, 2) },
    uSunProbed: { value: 0 },
    uRaysAmount: { value: params.eye.raysAmount },
    uRaysTint: { value: new Vector3(...params.eye.raysTint) },
    uFlare: {
      value: new Vector4(params.eye.flareRadius, params.eye.flareHalo,
        params.eye.flareLength, params.eye.flareStreak),
    },
    uFlareHeight: { value: params.eye.flareHeight },
    uFlareTint: { value: new Vector3(...params.eye.flareTint) },
    uStreak: { value: new Vector2(0, 0) },
    uGhostAt: { value: new Vector3(...params.eye.ghostAt) },
    uGhostSize: { value: new Vector3(...params.eye.ghostSize) },
    uGhostGain: { value: new Vector3(...params.eye.ghostGain) },
    uGhostTint: { value: new Vector3(...params.eye.ghostTint) },
    uAspect: { value: 1 },
    uRain: { value: new Vector4(0, 0, params.eye.rainColumns, 1.78) },
    uRainDrop: {
      value: new Vector4(params.eye.rainDensity, params.eye.rainSize,
        params.eye.rainRefraction, params.eye.rainHighlight),
    },
    uRainTrail: {
      value: new Vector4(params.eye.rainTrail, params.eye.rainDrying,
        params.eye.rainMistRows, params.eye.rainMistDensity),
    },
    uRainWet: {
      value: new Vector4(params.eye.rainWetness, params.eye.rainMicroStreak,
        params.eye.rainDrag, params.eye.rainMerge),
    },
    uRainDrag: { value: new Vector2() },
  });

  let sceneTarget = null;
  // The field's own buffer, and null for as long as the frame is drawn whole.
  let campoTarget = null;
  // What fraction of a SIDE the ground is drawn at. One is the world as it
  // shipped: no second buffer, no second pass, the field's own mesh back inside
  // `scene`. A half is a quarter of the pixels.
  let campoScale = 1;
  // AND HOW MANY SAMPLES THAT BUFFER RESOLVES, which is a handle for a bench
  // and NOUGHT for what ships. Multisampling is charged per triangle edge and
  // the field has twelve of them, all of them off screen: the walker stands
  // inside the box. Every edge anybody can see in the meadow -- the arris of a
  // cube, the rim of the ridge against the sky -- is decided by the ray marcher
  // in the fragment, and a coverage mask knows nothing about it. So four
  // samples here would buy a quarter of nothing at four times the bandwidth of
  // it; what the field antialiases with is `uRays`, its own sub pixel budget,
  // and the pixels this pass gives back are what pays for a second one.
  let campoSamples = 0;
  // THE PING PONG THE GROUND REMEMBERS ITSELF IN, and null for as long as
  // nobody has asked for a memory. Two targets, each colour AND depth: the
  // memory pass writes one while reading the other, the recomposition is handed
  // whichever was written, and the depth travels with the colour because the
  // gate that reads the pair has to read one frame's worth of both.
  let campoPast = [null, null];
  // Which of the two the LAST memory pass wrote. The next one reads it.
  let campoPastAt = 0;
  // Whether there is a past worth reading at all: false on the first frame of
  // an accumulation and on every frame after the buffers changed shape, because
  // a past read out of a buffer of another size is not a past.
  let campoPastReady = false;
  // Where the sequence of offsets stands. It counts frames and nothing else.
  let campoJitterAt = 0;
  // Whether the ground's camera moved ENOUGH between the last two frames it was
  // marched for. It decides whether the offset advances, and it is read a frame
  // late on purpose: the camera's matrices are only up to date once three has
  // rendered with it, and the offset has to be chosen BEFORE that render.
  let campoViewMoved = true;
  let campoViewShift = 0;
  // The point the question is asked of, ten metres in front of the eye, and the
  // two places it lands in: a rotation is what moves this ground, and a rotation
  // does not show up in a camera's position at all.
  const campoProbe = new Vector3();
  const campoProbeNow = new Vector3();
  const campoProbeWas = new Vector3();
  const campoViewProj = new Matrix4();
  const campoPrevViewProj = new Matrix4();
  const campoPrevInvViewProj = new Matrix4();
  let bloomTargets = [];
  let focusTargets = [];
  let raysTargets = [];
  // The depth service's two buffers, and null for as long as nobody reads from
  // them: the world's distance in metres, and the layer that reads it.
  let softDepthTarget = null;
  let softGlowTarget = null;
  // Which of the two forms the driver actually granted, so a reading of this
  // pass's cost can say what it was paid in.
  let softFormat = null;
  // Forced on or off by a bench or a null; null means the seats decide, which is
  // what ships.
  let softForced = null;
  // How far the service's two buffers are stepped down from the frame. ONE, and
  // it is a tier's lever rather than a default to be argued with: what is drawn
  // there has no geometric edge in it, so it takes a reduction the way the sun's
  // rays take an eighth. Measured at both, in v0-fondazione/profondita/.
  let softScale = 1;
  // How many times the lift is drawn. ONE in every frame anybody looks at. This
  // is a measuring instrument and not a proposal: the pass costs a few hundredths
  // of a millisecond, which is under the noise floor of the machine this world is
  // fitted on, so it is read as the SLOPE of frame time against this number
  // rather than as the difference of two frames. See v0-fondazione/profondita/.
  let softPasses = 1;
  // The one pixel, twice: this frame's and last frame's. Allocated once for the
  // life of the page rather than with the frame — it does not depend on the
  // size of anything, and a resize that threw away the accommodation would rack
  // the focus from scratch every time the window changed shape.
  let probeTargets = [];
  let probeAt = 0;
  // When the probe last ran, in seconds. Nought means "not running", which is
  // also how the first frame after rest is told to take its measurement whole.
  let lastProbeAt = 0;
  // Whether each of the two channels had a frame before this one to follow on
  // from. Cleared when its own effect goes back to rest, which is what makes an
  // eye that has just opened accommodate at once instead of racking in from
  // wherever it was left a minute ago.
  let probeHeld = { plane: false, sun: false };
  let quality = null;
  let width = 1;
  let height = 1;
  // What the tier asks for; what the driver granted is in `quality.samples`.
  let wantedSamples = TARGET_ATTEMPTS[0].samples;
  // And which pixel it asks for, by name. Null is the shipping ladder from the
  // top; a name is tried first and the ladder catches it, so a tier that asks
  // for a packed float on a driver that has none still gets a frame -- and gets
  // it in a buffer that still carries light. What was actually granted is in
  // `quality.format` and nowhere else: asking is not getting, and a bench arm
  // that did not read it back would publish the name it wanted rather than the
  // buffer it measured.
  let wantedFormat = null;
  const wantedFormats = () => {
    if (wantedFormat === null) return SHIPPED_FORMATS;
    const asked = TARGET_FORMATS.find((shape) => shape.name === wantedFormat);
    if (!asked) return SHIPPED_FORMATS;
    return [asked, ...SHIPPED_FORMATS.filter((shape) => shape !== asked)];
  };
  let bloomTier = 'half';

  const clock = createGpuClock(gl);
  let timing = false;
  // Se il fotogramma si cronometra per STADIO o intero. Acceso solo dove c'e'
  // qualcuno che legge la tabella, cioe' sotto `?dev`: vedi CLOCK_STAGES.
  let stageTiming = false;
  // Something to draw before the world, into a buffer of its own, timed apart
  // from the frame it stands behind. Null on every path that has not asked for
  // one, which is every path but a development key.
  let prepass = null;

  function draw(material, target) {
    quad.material = material;
    gl.setRenderTarget(target);
    gl.render(scene, camera);
  }

  // Some drivers accept the packed format and then fail to complete the
  // framebuffer. Asking the context afterwards is the only reliable answer, so
  // each combination is tried for real and kept only if it draws clean.
  function probeTarget(w, h, ceiling, formats) {
    const context = gl.getContext();
    // The format is the outer loop and the sample count the inner one, because
    // the bytes per sample buy more than the samples do: a driver that will not
    // give four samples of the packed float has to be offered two of it before
    // it is offered four of the half float.
    for (const shape of formats) {
      for (const attempt of TARGET_ATTEMPTS) {
        if (attempt.samples > ceiling) continue;
        const target = makeTarget(w, h, { samples: attempt.samples, format: shape });
        while (context.getError() !== context.NO_ERROR) { /* drain */ }
        gl.setRenderTarget(target);
        gl.clear();
        const complete = context.checkFramebufferStatus(context.FRAMEBUFFER) === context.FRAMEBUFFER_COMPLETE;
        const clean = context.getError() === context.NO_ERROR;
        gl.setRenderTarget(null);
        if (complete && clean) {
          return {
            target,
            quality: {
              samples: attempt.samples,
              format: shape.name,
              bytes: shape.bytes,
              highDynamicRange: shape.highDynamicRange,
            },
          };
        }
        target.depthTexture.dispose();
        target.dispose();
      }
    }
    throw new Error('no usable scene render target');
  }

  // The sample count is fixed when the buffer is allocated, so changing it
  // means allocating a new one. That is a hitch, which is why the governor only
  // ever asks for it standing still.
  function allocateScene() {
    if (sceneTarget) {
      // The depth attachment is a texture now, and a texture is not freed by
      // the target that carries it: the sample count is changed standing still,
      // but a leak of a full frame of twenty four bit depth per change is still
      // a leak.
      if (sceneTarget.depthTexture) sceneTarget.depthTexture.dispose();
      sceneTarget.dispose();
    }
    const probed = probeTarget(width, height, wantedSamples, wantedFormats());
    sceneTarget = probed.target;
    quality = probed.quality;
  }

  /**
   * The field's buffer: a fraction of a side, four channels, and a depth.
   *
   * FOUR CHANNELS WHERE THE SCENE HAS THREE, and that is the one place this
   * pass gains something the whole frame cannot have. R11F_G11F_B10F carries no
   * alpha, so the coverage the field already computes -- the share of a pixel's
   * rays that found ground -- has nowhere to go and is thrown away the moment
   * it is written: a pixel half covered by the ridge is drawn as if it were
   * covered whole. Here it is kept, and the recomposition spends it against the
   * sky that is already in the frame. Eight bytes of half float over a quarter
   * of the pixels is two bytes per pixel of the frame, which is half what the
   * three channels of the scene buffer cost over the same ground.
   *
   * AND IT IS SAMPLED NEAREST, always. The recomposition does its own weighing
   * -- four texels, four weights, a gate on the depth between them -- and a
   * bilinear tap underneath that would be a second filter nobody asked for,
   * smearing the very edges the gate exists to keep.
   */
  function allocateCampo() {
    const w = Math.max(1, Math.round(width * campoScale));
    const h = Math.max(1, Math.round(height * campoScale));
    if (campoTarget && campoTarget.width === w && campoTarget.height === h
      && campoTarget.samples === campoSamples) return;
    // A past kept across a change of shape is a past read out of the wrong
    // buffer, so the accumulation starts again from the frame that is drawn now.
    campoPastReady = false;
    if (campoTarget) {
      if (campoTarget.depthTexture) campoTarget.depthTexture.dispose();
      campoTarget.dispose();
    }
    campoTarget = new WebGLRenderTarget(w, h, {
      format: RGBAFormat,
      type: HalfFloatType,
      colorSpace: LinearSRGBColorSpace,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: true,
      depthTexture: makeDepthTexture(w, h),
      stencilBuffer: false,
      samples: campoSamples,
    });
  }

  /**
   * The pair the memory accumulates in, at the field buffer's own shape.
   *
   * LINEAR AND NOT NEAREST, which is the one place in this chain where that is
   * the right answer: what reads these is the memory pass's own reprojection,
   * at a place between texels that a bilinear tap is the honest reading of. The
   * recomposition reads the same texture with texelFetch, which no filter
   * touches -- so the nearest sampling it was built on is not given up.
   */
  function allocateCampoPast(w, h) {
    if (campoPast[0] && campoPast[0].width === w && campoPast[0].height === h) return;
    disposeCampoPast();
    campoPast = [0, 1].map(() => new WebGLRenderTarget(w, h, {
      format: RGBAFormat,
      type: HalfFloatType,
      colorSpace: LinearSRGBColorSpace,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
      depthTexture: makeDepthTexture(w, h),
      stencilBuffer: false,
      samples: 0,
    }));
    campoPastReady = false;
    campoViewMoved = true;
  }

  function disposeCampoPast() {
    for (const target of campoPast) {
      if (!target) continue;
      if (target.depthTexture) target.depthTexture.dispose();
      target.dispose();
    }
    campoPast = [null, null];
    campoPastReady = false;
  }

  /** Puts the seat back where a resolve reads it as "there is no field here". */
  function restCampo() {
    CAMPO_SEAT.tCampo.value = CAMPO_REST;
    CAMPO_SEAT.tCampoDepth.value = CAMPO_DEPTH_REST;
    CAMPO_SEAT.uCampoSize.value.set(1, 1);
    CAMPO_SEAT.uCampoOn.value = 0;
    // AND THE RAY GOES BACK TO THE CENTRE OF ITS TEXEL. A frame drawn whole has
    // no buffer for an offset to be accumulated in, so an offset left behind
    // here would be a ground sampled off centre and never added up -- which is
    // the sparkle this was built to remove, bought at the price of itself.
    CAMPO_JITTER.value.set(0, 0);
    campoPastReady = false;
  }

  function allocateBloom() {
    for (const target of bloomTargets) target.dispose();
    bloomTargets = [];
    const shape = BLOOM_TIERS[bloomTier] || BLOOM_TIERS.half;
    let w = Math.max(1, Math.floor(width / shape.first));
    let h = Math.max(1, Math.floor(height / shape.first));
    for (let i = 0; i < shape.levels; i++) {
      bloomTargets.push(new WebGLRenderTarget(w, h, {
        type: HalfFloatType,
        format: RGBAFormat,
        colorSpace: LinearSRGBColorSpace,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      }));
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
    }
  }

  /** A quarter of the frame, in each direction, in sixteen bit float. */
  function quarterTarget() {
    return new WebGLRenderTarget(
      Math.max(1, Math.floor(width / 4)), Math.max(1, Math.floor(height / 4)), {
        type: HalfFloatType,
        format: RGBAFormat,
        colorSpace: LinearSRGBColorSpace,
        // Linear, and it is doing real work: this is a quarter of the frame in
        // each direction and the composite reads it at full resolution, so the
        // hardware's own filter is what enlarges the result. It is a pass these
        // chains would otherwise draw by hand, for free.
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      },
    );
  }

  /**
   * The two buffers the selective focus is blurred through.
   *
   * BOTH AT A QUARTER, which is a measured choice and not a shortcut, and the
   * second pass of this unit is where it was re-decided rather than inherited.
   * The brief allowed half resolution "SOLO quando l'effetto è pieno" against a
   * budget of 1.8 ms, and the reason it is not taken is that half resolution is
   * not what buys the quality here. What the committente would have seen at the
   * old amplitude scaled up is a FIVE POINTED STAR: one pass of five taps
   * spread nine pixels apart stops overlapping, and each tap becomes visible as
   * itself. Half resolution does not fix that — it makes the same five points
   * sharper. A second pass at the SAME quarter does fix it, because it fills
   * the gaps between the taps, and it costs a sixteenth of the frame at eight
   * taps instead of a quarter of the frame at five. The measurement is in
   * s2-dev8/out/costo.txt and it is the reason the resolution did not have to
   * move.
   *
   * They are allocated with the frame rather than the first time somebody walks
   * up to a block — a megabyte and a half standing still costs nothing, and
   * allocating a render target in the middle of a walk is a hitch exactly where
   * the walker is looking.
   */
  function allocateFocus() {
    for (const target of focusTargets) target.dispose();
    focusTargets = [quarterTarget(), quarterTarget()];
  }

  /**
   * The one pixel, twice.
   *
   * Sixteen bit float and NEAREST filtering, because there is exactly one texel
   * and a linear filter over one texel is a wasted decision. Two of them
   * because the value has to be read while the next one is being written, which
   * is the whole of what "carried forward in time" costs.
   */
  function allocateProbe() {
    for (const target of probeTargets) target.dispose();
    const make = () => new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      format: RGBAFormat,
      colorSpace: LinearSRGBColorSpace,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    probeTargets = [make(), make()];
    probeAt = 0;
    probeHeld = { plane: false, sun: false };
  }

  /**
   * The buffer the sun's rays are marched into.
   *
   * AN EIGHTH OF THE FRAME IN EACH DIRECTION, which is a quarter of the fill of
   * everything else here, and it is the answer to the one budget this unit
   * actually broke. At a quarter the march measured 2.15 ms at the high tier —
   * more than the whole defocus, for an effect that is a second order flourish —
   * because twenty odd steps of two texture fetches is the most expensive thing
   * in this file per pixel, and the only lever with real leverage on it is how
   * many pixels there are.
   *
   * It can be an eighth for the same reason the defocus can be a quarter, only
   * more so: what is being made is light scattered through air. There is no edge
   * anywhere in it, the composite enlarges it with the hardware's own bilinear
   * filter, and the one thing that WOULD show a resolution — the hard silhouette
   * of a block cutting a beam — is a shadow in a glow rather than a line, so it
   * blurs into exactly what it should look like.
   */
  function allocateRays() {
    for (const target of raysTargets) target.dispose();
    const make = () => new WebGLRenderTarget(
      Math.max(1, Math.floor(width / 8)), Math.max(1, Math.floor(height / 8)), {
        type: HalfFloatType,
        format: RGBAFormat,
        colorSpace: LinearSRGBColorSpace,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      },
    );
    // TWO OF THEM, because the dither has to be taken back off again. Starting
    // every pixel's march at its own fraction of a step is what lets twelve
    // steps stand in for twenty four — but at an eighth of the frame one of
    // those pixels is eight across by the time the composite reads it, so the
    // noise that was meant to hide the banding arrives as MOTTLING in the bright
    // core instead. One smoothing at the same eighth puts it back: eight taps
    // over twenty five thousand pixels, which is under a fiftieth of the march
    // it is cleaning up after.
    raysTargets = [make(), make()];
  }

  /**
   * The buffer the world's distance is lifted into, in metres.
   *
   * ONE CHANNEL. Sixteen bit float over one channel is two bytes a pixel, a
   * quarter of what the scene buffer costs to write and a quarter of what it
   * would cost to read back — and this is a full resolution copy, so the
   * bandwidth is the whole of what the pass is. R16F is only colour renderable
   * where the driver hands out the float buffer extension; the same driver has
   * already had to hand it out for the scene's own half float target, so this
   * asks and then CHECKS, in the manner of probeTarget above, and falls back to
   * the four channel form the rest of this file uses rather than trusting that
   * the two entitlements travel together.
   *
   * NEAREST, and for the reason the depth attachment itself is nearest: a
   * distance interpolated across a silhouette is a distance nothing in the world
   * is at, and the one place this is read is exactly the edge of a tuft.
   */
  function allocateSoftDepth() {
    for (const target of [softDepthTarget, softGlowTarget]) if (target) target.dispose();
    const w = Math.max(1, Math.floor(width / softScale));
    const h = Math.max(1, Math.floor(height / softScale));
    const context = gl.getContext();
    const make = (format) => new WebGLRenderTarget(w, h, {
      type: HalfFloatType,
      format,
      colorSpace: LinearSRGBColorSpace,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    softDepthTarget = null;
    for (const format of [RedFormat, RGBAFormat]) {
      const target = make(format);
      while (context.getError() !== context.NO_ERROR) { /* drain */ }
      gl.setRenderTarget(target);
      gl.clear();
      const complete = context.checkFramebufferStatus(context.FRAMEBUFFER) === context.FRAMEBUFFER_COMPLETE;
      const clean = context.getError() === context.NO_ERROR;
      gl.setRenderTarget(null);
      if (complete && clean) {
        softDepthTarget = target;
        softFormat = format === RedFormat ? 'R16F' : 'RGBA16F';
        break;
      }
      target.dispose();
    }
    if (!softDepthTarget) throw new Error('no usable buffer for the depth service');

    // AND THE LAYER'S OWN BUFFER, WHICH IS WHERE THE ADDITIVES LAND.
    //
    // No depth attachment, because the fade is the occlusion and a depth buffer
    // here would be a second opinion about it that nothing writes. Not
    // multisampled, because it is not in the scene target and the scene target
    // is where the samples are. LINEAR, unlike the distance beside it: the
    // composite may read this at a different resolution from the one it was
    // drawn at, and what is in it is a glow, which is the one thing in this file
    // that the hardware's own filter enlarges correctly.
    softGlowTarget = new WebGLRenderTarget(w, h, {
      type: HalfFloatType,
      format: RGBAFormat,
      colorSpace: LinearSRGBColorSpace,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  return {
    /**
     * Compiles what the world is about to draw, WHILE THE DRIVER IS ALLOWED TO
     * TAKE ITS TIME OVER IT.
     *
     * ANGLE does not compile a program when it is linked, it compiles it the
     * first time something is DRAWN with it, and three.js asks for the result
     * on that same first use -- so the whole cost of a new material lands
     * inside one render(), on the main thread, at the worst possible moment:
     * the frame right after the ground is dressed or the meadow is planted.
     * Measured on the arrival, those four frames cost 0.6, 1.8, 1.0 and 0.16
     * seconds, and every one of them was renderer.render and none of them was
     * the world being built.
     *
     * compileAsync links the same programs and then POLLS
     * KHR_parallel_shader_compile instead of waiting on them, so the driver
     * compiles on its own threads and the main thread keeps handing out
     * frames. What it must be given is the render target the world is actually
     * drawn into: a program key carries the target it was made for, and one
     * compiled against the default framebuffer would be thrown away and
     * compiled again at first use, which is the stall this exists to remove.
     *
     * @param {Scene} scene
     * @param {Camera} camera
     * @returns {Promise} resolves when the driver says the programs are ready
     */
    warm(scene, camera, targetScene = null) {
      if (typeof gl.compileAsync !== 'function') return Promise.resolve();
      if (sceneTarget === null) allocateScene();
      const previous = gl.getRenderTarget();
      gl.setRenderTarget(sceneTarget);
      try {
        return gl.compileAsync(scene, camera, targetScene);
      } finally {
        gl.setRenderTarget(previous);
      }
    },

    setSize(nextWidth, nextHeight) {
      width = Math.max(1, Math.floor(nextWidth));
      height = Math.max(1, Math.floor(nextHeight));
      if (sceneTarget === null) allocateScene();
      else sceneTarget.setSize(width, height);
      allocateBloom();
      allocateFocus();
      allocateRays();
      // Only once somebody has sat down. A window that changes shape while the
      // service is idle allocates nothing at all.
      if (softDepthTarget) allocateSoftDepth();
      // And the field's, on the same rule: a frame drawn whole has no buffer
      // here to resize.
      if (campoTarget) allocateCampo();
      if (probeTargets.length !== 2) allocateProbe();
    },

    /**
     * How many samples the scene buffer is drawn with.
     *
     * Four is the identity of this picture: the meadow is alpha tested and its
     * rim is resolved by the coverage mask, so this is the last lever before
     * the water and not one of the first.
     */
    setSamples(count) {
      if (count === wantedSamples) return false;
      wantedSamples = count;
      allocateScene();
      return true;
    },

    /**
     * Which pixel the scene is drawn into, by the name the ladder gives it.
     *
     * Null puts the ladder back, which is what the tier asks for. Allocating a
     * new buffer is a hitch of a frame, the same one `setSamples` is: this is
     * asked standing still, by a bench that is about to measure the difference,
     * or once at start up.
     */
    setSceneFormat(name) {
      const next = name === null || name === undefined ? null : String(name);
      if (next === wantedFormat) return false;
      wantedFormat = next;
      allocateScene();
      return true;
    },

    setBloomTier(tier) {
      if (tier === bloomTier || !BLOOM_TIERS[tier]) return false;
      bloomTier = tier;
      allocateBloom();
      return true;
    },

    /**
     * WHAT FRACTION OF A SIDE THE GROUND IS DRAWN AT.
     *
     * One puts the field back inside the world's own pass, at the world's own
     * pixel, with no second buffer and no recomposition -- which is not a
     * fallback but the null this whole pass is measured against, and it has to
     * be reachable in the same page and the same half hour as the other arms
     * (E-V7k). A half is a quarter of the pixels of the earth.
     *
     * Asked standing still, like every other allocation on this file: a bench
     * about to measure the difference, a tier settling, or once at start up.
     */
    setCampoScale(scale) {
      const next = Math.min(1, Math.max(0.25, Number(scale) || 1));
      if (next === campoScale) return false;
      campoScale = next;
      if (campoScale >= 1) {
        if (campoTarget) {
          if (campoTarget.depthTexture) campoTarget.depthTexture.dispose();
          campoTarget.dispose();
          campoTarget = null;
        }
        disposeCampoPast();
        restCampo();
      } else if (campoTarget) {
        allocateCampo();
      }
      return true;
    },

    /** And how many samples that buffer resolves. A bench's arm; see the note. */
    setCampoSamples(count) {
      const next = Math.max(0, Number(count) || 0);
      if (next === campoSamples) return false;
      campoSamples = next;
      if (campoTarget) allocateCampo();
      return true;
    },

    /** What the field's own buffer is, for a bench that must not deduce it. */
    campoStats() {
      return {
        scale: campoScale,
        samples: campoSamples,
        on: CAMPO_SEAT.uCampoOn.value === 1,
        memory: CAMPO_MEMORY.weight,
        jitter: CAMPO_MEMORY.jitter,
        // Whether the pass actually has a past to read on the NEXT frame,
        // which is the only honest answer to "is it accumulating".
        accumulating: campoPastReady,
        jitterAt: campoJitterAt % CAMPO_JITTER_CYCLE,
        shift: campoViewShift,
        seats: campoSeats,
        width: campoTarget ? campoTarget.width : 0,
        height: campoTarget ? campoTarget.height : 0,
      };
    },

    render(worldScene, worldCamera) {
      // Counters cover the whole frame, scene and composite together, which is
      // the number that has to fit the budget.
      gl.info.autoReset = false;
      gl.info.reset();
      const slot = timing && clock ? clock.take() : null;
      // UNA QUERY SOLA QUANDO NESSUNO LEGGE LA TABELLA. Aperta qui e chiusa
      // dove si chiude l'ultimo stadio, cosi' che misuri esattamente cio' che
      // gli undici misuravano sommati.
      if (slot && !stageTiming) clock.begin(slot, 'tutto');

      if (prepass) {
        if (slot && stageTiming) clock.begin(slot, 'prepass');
        prepass(gl);
      }

      // WHETHER THE WORLD IS DRAWN IN ONE PIECE OR TWO, and it is one until a
      // material asks for the depth. Nothing below this line runs on a frame
      // nobody reads from: no buffer, no lift, no second render, and the two
      // stages of the clock come back as an exact nought rather than as a small
      // number — the same contract the defocus and the rays are held to.
      const softing = softForced === null ? softDepthSeats > 0 : softForced;
      if (softing && softDepthTarget === null) allocateSoftDepth();
      // Saved and put back rather than assumed: the camera belongs to the walker
      // and this pass is a guest in it.
      const cameraLayers = worldCamera.layers.mask;

      // ------------------------------------------------ THE FIELD'S OWN PASS
      //
      // BEFORE THE WORLD AND NOT AFTER IT, because what the world's own pass
      // does with the answer is read it: the recomposition stands in the scene
      // at the field's own place in the order, and it cannot stand there
      // reading a buffer that has not been drawn yet.
      //
      // AND WHAT IT COSTS THE FIELD IS THE ONE THING WORTH DECLARING. Drawn
      // here, the ground no longer has the monoliths' depth already written in
      // front of it. That was never a saving on the marching -- a program that
      // writes gl_FragDepth has given up its early test whatever stands in
      // front of it, so those fragments were shaded and then thrown away -- but
      // it was a saving on the write, and it is gone. What replaces it is
      // better: the recomposition IS depth tested, at full resolution, against
      // a buffer that has every monolith in it, so a field pixel still cannot
      // land on the masonry -- and now it is a whole pixel of masonry that
      // decides, not a half resolution guess at one.
      const campoing = campoScale < 1 && campoSeats > 0;
      // AND WHETHER THE GROUND IS REMEMBERING ITSELF THIS FRAME, which is a
      // question only a frame that has a buffer of its own may answer yes to:
      // at a fraction of one the ground is drawn in the world's own pass, at
      // the frame's own pixel, and there is nothing to accumulate in and
      // nothing that would be improved by it. It is DECLARED rather than
      // forced -- see campoStats, which reports it, and the handle in
      // src/world/layers/v1-suolo.js, which may ask for it anywhere.
      const remembering = campoing && CAMPO_MEMORY.weight > 0;
      if (campoing) {
        allocateCampo();
        if (slot && stageTiming) clock.begin(slot, 'campo');
        // THE OFFSET, BEFORE THE RAYS ARE AIMED.
        //
        // It moves only while there is an accumulation to add the frames up in
        // -- the offset alone is the same sparkle in another place, and it is a
        // handle of its own (`campojitter`) so that the two halves can be
        // priced apart -- AND ONLY WHILE THE VIEW ITSELF IS MOVING.
        //
        // THAT SECOND CONDITION IS THE WHOLE OF WHAT A STILL CAMERA IS OWED,
        // and it was measured before it was written. An accumulation of weight
        // w fed a signal that changes every frame does not converge: it cycles,
        // at (1 - w) of the change, and with the offset moving under a ground
        // whose detail is smaller than a texel that change is about twenty
        // levels -- so a camera holding perfectly still read ONE FULL LEVEL of
        // flicker that the world it replaces reads NOUGHT of. A ground that
        // does not move has nothing new to add up, so the offset stands where
        // it stands, the marched frame stops changing, and the accumulation
        // converges to it: the still picture is a still picture again, and the
        // sub-texel samples are spent on the frames that actually have motion
        // in them -- which is every frame the walker is in, because the body
        // breathes.
        if (remembering && CAMPO_MEMORY.jitter) {
          if (campoViewMoved) {
            const [jx, jy] = CAMPO_JITTER_SEQUENCE[campoJitterAt % CAMPO_JITTER_CYCLE];
            CAMPO_JITTER.value.set(jx, jy);
            campoJitterAt += 1;
          }
        } else {
          CAMPO_JITTER.value.set(0, 0);
        }
        worldCamera.layers.set(CAMPO_LAYER);
        // CLEARED TO NOTHING, AND IT HAS TO BE SAID OUT LOUD. The fourth channel
        // of this buffer is the field's COVERAGE, and the recomposition reads a
        // nought there as "no ray found ground in this texel, let the sky
        // through". three's own clear alpha is ONE whenever the canvas is
        // opaque -- which this one is, and should be -- so a buffer left to the
        // default arrives with every texel already claiming to be ground, and
        // the recomposition dutifully paints the whole sky black. Measured, on
        // the first frame this pass ever drew.
        const keptAlpha = gl.getClearAlpha();
        gl.setClearAlpha(0);
        gl.setRenderTarget(campoTarget);
        gl.render(worldScene, worldCamera);
        gl.setClearAlpha(keptAlpha);
        worldCamera.layers.mask = cameraLayers;
        CAMPO_SEAT.tCampo.value = campoTarget.texture;
        CAMPO_SEAT.tCampoDepth.value = campoTarget.depthTexture;
        CAMPO_SEAT.uCampoSize.value.set(campoTarget.width, campoTarget.height);
        CAMPO_SEAT.uCampoOn.value = 1;

        // ------------------------------------------------ AND WHAT IT KEEPS
        //
        // Between the marching and the recomposition, and nowhere else: the
        // pass reads the frame that was just marched and the frame it wrote
        // last time, and what the recomposition is then handed is the sum. The
        // camera's own matrix is taken AFTER the render above, where three has
        // already brought it up to date, and it is the same product the
        // marcher's uViewProjection is -- so the depth in that buffer and the
        // matrix that undoes it are one pair and not two readings.
        if (remembering) {
          allocateCampoPast(campoTarget.width, campoTarget.height);
          const write = campoPast[1 - campoPastAt];
          const read = campoPast[campoPastAt];
          campoViewProj.multiplyMatrices(
            worldCamera.projectionMatrix, worldCamera.matrixWorldInverse,
          );
          const u = campoMemory.uniforms;
          u.tRaw.value = campoTarget.texture;
          u.tRawDepth.value = campoTarget.depthTexture;
          u.tPast.value = read.texture;
          u.tPastDepth.value = read.depthTexture;
          u.uSize.value.set(campoTarget.width, campoTarget.height);
          u.uInvViewProj.value.copy(campoViewProj).invert();
          u.uPrevViewProj.value.copy(campoPrevViewProj);
          u.uPrevInvViewProj.value.copy(campoPrevInvViewProj);
          u.uWeight.value = CAMPO_MEMORY.weight;
          u.uPast.value = campoPastReady ? 1 : 0;
          draw(campoMemory, write);
          // HOW FAR THE VIEW MOVED, IN TEXELS OF THIS BUFFER, and the answer is
          // asked of a point rather than of the matrices: a quarter of a degree
          // of yaw moves this ground across the screen and moves the camera's
          // position by nothing at all.
          campoProbe.set(0, 0, -10).applyMatrix4(worldCamera.matrixWorld);
          campoProbeNow.copy(campoProbe).applyMatrix4(campoViewProj);
          campoProbeWas.copy(campoProbe).applyMatrix4(campoPrevViewProj);
          campoViewShift = Math.max(
            Math.abs(campoProbeNow.x - campoProbeWas.x) * 0.5 * campoTarget.width,
            Math.abs(campoProbeNow.y - campoProbeWas.y) * 0.5 * campoTarget.height,
          );
          campoViewMoved = campoViewShift > CAMPO_JITTER_FLOOR;
          campoPrevViewProj.copy(campoViewProj);
          campoPrevInvViewProj.copy(u.uInvViewProj.value);
          campoPastAt = 1 - campoPastAt;
          campoPastReady = true;
          CAMPO_SEAT.tCampo.value = write.texture;
          CAMPO_SEAT.tCampoDepth.value = write.depthTexture;
        } else {
          // A memory switched off is a memory that has to be BEGUN again when
          // it comes back: the buffers it kept are of a world the camera has
          // since walked out of.
          campoPastReady = false;
        }
      } else if (CAMPO_SEAT.uCampoOn.value !== 0) {
        restCampo();
      }

      if (slot && stageTiming) clock.begin(slot, 'scene');
      gl.setRenderTarget(sceneTarget);
      // Taken out of the world's pass when there is somewhere else to put it,
      // and PUT BACK INTO IT when there is not — so a material that joined the
      // layer never silently stops being drawn. With the service off it lands
      // where it always landed, in this one render, reading the world at rest.
      if (softing) worldCamera.layers.disable(SOFT_DEPTH_LAYER);
      else {
        worldCamera.layers.enable(SOFT_DEPTH_LAYER);
        SOFT_DEPTH_SEAT.tSceneDepth.value = SOFT_DEPTH_REST;
      }
      // The same contract, one layer up: taken out of the world's pass when
      // there is somewhere else to put it and PUT BACK INTO IT when there is
      // not, so a frame drawn whole is the frame that shipped -- the field's own
      // mesh, in its own place in the order, marching at the frame's own pixel.
      if (campoing) worldCamera.layers.disable(CAMPO_LAYER);
      else worldCamera.layers.enable(CAMPO_LAYER);
      // ONE CALL, AND IT STAYS ONE CALL. See the depth service's own comment:
      // a second render into this target costs a second full resolve of it.
      gl.render(worldScene, worldCamera);
      worldCamera.layers.mask = cameraLayers;

      // ------------------------------------------------- THE DEPTH SERVICE
      //
      // THE LIFT. The scene target is not bound now — this draws into the
      // service's own buffer — and that is the whole reason this pass exists:
      // the depth attachment of a BOUND framebuffer cannot be sampled by a draw
      // into it, and where the driver allows it anyway (multisampled, where the
      // attachment is a renderbuffer and the texture is only its resolve) what
      // comes back is the previous pass. Both readings are in
      // v0-fondazione/profondita/uscite/ricircolo.json.
      if (slot && stageTiming && softing) clock.begin(slot, 'depth');
      if (softing) {
        lift.uniforms.tDepth.value = sceneTarget.depthTexture;
        lift.uniforms.uCameraRange.value.set(worldCamera.near, worldCamera.far);
        const liftTanHalf = Math.tan(worldCamera.fov * Math.PI / 360);
        lift.uniforms.uTanHalf.value.set(liftTanHalf * worldCamera.aspect, liftTanHalf);
        // Once in a frame anybody looks at. See `softPasses`.
        for (let i = 0; i < softPasses; i++) draw(lift, softDepthTarget);
        SOFT_DEPTH_SEAT.tSceneDepth.value = softDepthTarget.texture;
        SOFT_DEPTH_SEAT.uSceneDepthTexel.value.set(
          1 / softDepthTarget.width, 1 / softDepthTarget.height,
        );
      }

      // AND THE LAYER, INTO A BUFFER OF ITS OWN. Cleared by the render — the
      // additives are accumulated from black and added back at the composite,
      // which is exact — and never into the scene target, which is what keeps
      // that target's resolve at one for the frame.
      if (slot && stageTiming && softing) clock.begin(slot, 'soft');
      if (softing) {
        worldCamera.layers.set(SOFT_DEPTH_LAYER);
        gl.setRenderTarget(softGlowTarget);
        gl.render(worldScene, worldCamera);
        worldCamera.layers.mask = cameraLayers;
      }
      const glowTexture = softing ? softGlowTarget.texture : SOFT_GLOW_REST;

      if (slot && stageTiming) clock.begin(slot, 'bloom');
      if (stages.bloom) {
        prefilter.uniforms.tSource.value = sceneTarget.texture;
        prefilter.uniforms.tGlow.value = glowTexture;
        prefilter.uniforms.uThreshold.value = params.bloomThreshold;
        prefilter.uniforms.uKnee.value = params.bloomKnee;
        draw(prefilter, bloomTargets[0]);

        if (slot && stageTiming) clock.begin(slot, 'sfocatura');
        for (let i = 1; i < bloomTargets.length; i++) {
          const source = bloomTargets[i - 1];
          down.uniforms.tSource.value = source.texture;
          down.uniforms.uHalfPixel.value.set(0.5 / source.width, 0.5 / source.height);
          draw(down, bloomTargets[i]);
        }
        for (let i = bloomTargets.length - 1; i > 0; i--) {
          const source = bloomTargets[i];
          up.uniforms.tSource.value = source.texture;
          up.uniforms.uHalfPixel.value.set(0.5 / source.width, 0.5 / source.height);
          draw(up, bloomTargets[i - 1]);
        }
      }

      // ------------------------------------------------------- THE DEFOCUS
      //
      // Nothing at all on a frame that is not defocusing something: no draw, no
      // buffer touched, and the driver's clock reports the stage as nought
      // rather than as the last frame that did draw it. Which is the whole of
      // "it costs nothing when it is off" said in a way that can be measured.
      // The probe is in the condition and not only the two blur buffers: the
      // plane is READ from it now, so a frame that defocused without it would
      // be reading an unbound sampler for the one number the whole effect is
      // about.
      // The waking is a second reason to draw this, and the only other one: the
      // buffer it needs is the same buffer, so a frame that is blurring for a
      // pair of shut eyes runs exactly the passes a frame accommodating on a
      // face runs. With the scene off, wake.blur is nought and this is the
      // condition it has always been.
      const focusing = stages.focus && (eye.focus > 0 || wake.blur > 0)
        && focusTargets.length === 2 && probeTargets.length === 2;

      // ------------------------------------------------------- THE ONE PIXEL
      //
      // Run only when one of the two things that read it is going to be drawn,
      // so a placed pose does not even bind it, and the seal is a seal for the
      // same reason it always was: the branch is not taken.
      //
      // ITS OWN CLOCK, and it is taken here rather than passed in. The interval
      // between two of these calls IS the interval between two composites,
      // which is exactly the step this filter has to be stepped by; asking for
      // it from src/main.js would mean a signature through src/core/
      // renderer.js, which this unit does not own. Clamped at both ends: a tab
      // that has been in the background for a minute comes back with a delta of
      // a minute, and an eye that accommodated over that would arrive already
      // finished on the first frame anybody sees.
      //
      // The Schmitt trigger that decides whether the sun's march runs at all is
      // read HERE rather than beside the march, because the probe has to know
      // the same answer: the occlusion of the disc is only worth carrying while
      // there is a disc, and a probe that kept following one that had left the
      // frame would hand the flare a number about the last place the sun was.
      if (eye.sun >= RAYS_ON) raysLive = true;
      else if (eye.sun <= RAYS_OFF) raysLive = false;
      const marching = stages.sun && raysLive && eye.sun > 0 && raysTargets.length === 2;
      // AND THE VEIL IS A THIRD READER OF IT, which is the fourth pass's one
      // change to when this runs. The veil is gated by the occlusion of the
      // disc now (see the composite), and a gate whose number is not being
      // measured is not a gate: it would be reading whatever the last frame
      // that did measure left in the texel, or an unbound sampler. The veil is
      // live for most of a walk, so in practice this means the one pixel runs
      // most frames — which costs four thousandths of a millisecond and buys
      // back the fact that the accommodation is now always warm rather than
      // racked in from scratch the moment somebody leans towards a face.
      //
      // NOTHING ABOUT REST CHANGES. A placed pose has no eye at all: glare,
      // focus and sun are exactly nought together, so this is false and the one
      // pixel is not even bound.
      const veiling = stages.glare && eye.glare * params.eye.glareStrength > 0;
      const probing = probeTargets.length === 2 && (focusing || marching || veiling);
      if (slot && stageTiming && probing) clock.begin(slot, 'probe');
      if (probing) {
        const now = (typeof performance === 'object' ? performance.now() : Date.now()) / 1000;
        const dt = lastProbeAt === 0 ? 1 / 60 : Math.min(0.25, Math.max(1e-4, now - lastProbeAt));
        lastProbeAt = now;
        const tanHalf = Math.tan(worldCamera.fov * Math.PI / 360);
        const aspect = width / Math.max(1, height);
        const e0 = params.eye;
        const prev = probeTargets[probeAt];
        const next = probeTargets[1 - probeAt];
        probeAf.uniforms.tDepth.value = sceneTarget.depthTexture;
        probeAf.uniforms.tPrev.value = prev.texture;
        probeAf.uniforms.uCameraRange.value.set(worldCamera.near, worldCamera.far);
        probeAf.uniforms.uTanHalf.value.set(tanHalf * aspect, tanHalf);
        probeAf.uniforms.uFocusSpread.value = e0.focusSpread;
        probeAf.uniforms.uProbeArea.value.set(e0.focusAreaX, e0.focusAreaY);
        // TAKE IT WHOLE ON THE FIRST FRAME THAT MEASURES IT, AND FOLLOW IT
        // AFTER THAT — and the question is now "did the probe run last frame",
        // not "did the thing that reads this channel run last frame". It has to
        // be: the occlusion has two readers with different lives (the veil,
        // which is up for most of a walk, and the flare, which comes and goes
        // with the disc), and a channel that snapped whenever the second of
        // them arrived would jerk the first one mid-fade. It is also the only
        // safe question, because what the snap is really guarding is the frame
        // whose previous value was never written by anybody.
        probeAf.uniforms.uProbeSnap.value.set(
          probeHeld.plane ? 0 : 1,
          probeHeld.sun ? 0 : 1,
        );
        probeAf.uniforms.uProbeTau.value.set(
          tauSeconds(e0.focusPullMs), tauSeconds(e0.sunOpenMs), tauSeconds(e0.sunCoverMs),
        );
        probeAf.uniforms.uDt.value = dt;
        probeAf.uniforms.uSunUv.value.set(eye.sunNdc.x * 0.5 + 0.5, eye.sunNdc.y * 0.5 + 0.5);
        probeAf.uniforms.uSunProbe.value.set(
          e0.sunProbeRadius / aspect, e0.sunProbeRadius,
        );
        probeAf.uniforms.uPlaneRange.value.set(
          1 / Math.max(0.5, e0.focusFarM), 1 / Math.max(0.05, e0.focusNearM),
        );
        draw(probeAf, next);
        probeAt = 1 - probeAt;
        probeHeld = { plane: true, sun: true };
      } else {
        probeHeld = { plane: false, sun: false };
        lastProbeAt = 0;
      }
      const probeTexture = probeTargets.length === 2 ? probeTargets[probeAt].texture : null;
      // The stage is only OPENED on a frame that draws it, so a frame that does
      // not comes back as exactly nought rather than as a very small number: the
      // clock already answers "nobody drew this" with a zero, and the difference
      // between a measured nothing and a declared nothing is the difference
      // between "cheap" and "not there".
      if (slot && stageTiming && focusing) clock.begin(slot, 'eye');
      if (focusing) {
        const tanHalf = Math.tan(worldCamera.fov * Math.PI / 360);
        defocus.uniforms.tSource.value = sceneTarget.texture;
        defocus.uniforms.tDepth.value = sceneTarget.depthTexture;
        defocus.uniforms.uCameraRange.value.set(worldCamera.near, worldCamera.far);
        defocus.uniforms.uTanHalf.value.set(tanHalf * worldCamera.aspect, tanHalf);
        defocus.uniforms.tProbe.value = probeTexture;
        defocus.uniforms.uFocusSpread.value = params.eye.focusSpread;
        defocus.uniforms.uInkKeep.value = params.eye.focusInkKeep;
        defocus.uniforms.uGlow.value.set(params.bloomThreshold, params.bloomKnee);
        defocus.uniforms.uWake.value = wake.blur;
        // The taps are spaced in FULL frame pixels, so how far the blur reaches
        // is a number of pixels of the picture somebody is looking at rather
        // than of whatever buffer happens to be underneath it. The two passes
        // split that reach between them: the first lays down the five weighted
        // taps, the second fills the gaps between them.
        const reach = params.eye.focusReach;
        defocus.uniforms.uStep.value.set(reach * 0.40 / width, reach * 0.40 / height);
        draw(defocus, focusTargets[0]);
        // The widen, at the same quarter resolution, over the already
        // premultiplied buffer. This is the HALO'S OWN up kernel, reused rather
        // than copied: eight taps in a ring, which is the right shape for this
        // and is already the shape this file trusts. Colour and its weight go
        // through it together, so the division in the composite still recovers
        // the average of the taps that were actually out of focus.
        up.uniforms.tSource.value = focusTargets[0].texture;
        up.uniforms.uHalfPixel.value.set(reach * 0.34 / width, reach * 0.34 / height);
        draw(up, focusTargets[1]);
      }

      // ----------------------------------------------------- THE SUN'S RAYS
      //
      // Same contract as the defocus, for the same reason: nothing at all on a
      // frame where there is no sun on the glass, and the stage is only opened
      // on a frame that draws it, so the clock answers "nobody drew this" with
      // an exact nought.
      //
      // The Schmitt trigger is here rather than in the amount because it is a
      // decision about a DRAW: the amount fades smoothly and the picture with
      // it, but whether a pass runs is a yes or a no, and a sun sliding along
      // the frame edge would otherwise toggle it every frame.
      if (slot && stageTiming && marching) clock.begin(slot, 'rays');
      if (marching) {
        const e2 = params.eye;
        sunrays.uniforms.tSource.value = sceneTarget.texture;
        sunrays.uniforms.tDepth.value = sceneTarget.depthTexture;
        // Where the disc landed, from normalised device coordinates into the
        // buffer's own. src/core/eye.js projected it by hand for the frame that
        // is being drawn, rather than through matrices the renderer has not
        // refreshed yet — a sun a frame behind the turn is the one way this
        // could be seen to be a screen space effect.
        sunrays.uniforms.uSunUv.value.set(eye.sunNdc.x * 0.5 + 0.5, eye.sunNdc.y * 0.5 + 0.5);
        sunrays.uniforms.uAspect.value = width / Math.max(1, height);
        sunrays.uniforms.uRay.value.set(
          e2.raysDensity, e2.raysDecay, e2.raysWeight,
          e2.raysDiscRadius * e2.raysDiscRadius,
        );
        sunrays.uniforms.uRayBright.value.set(e2.raysThreshold, e2.raysKnee);
        draw(sunrays, raysTargets[0]);
        // And the dither taken back off, with the halo's own up kernel, at the
        // same eighth. One texel of this buffer is eight pixels of the frame, so
        // the step is half a texel: enough to put the twelve steps' noise back
        // together and not enough to move where a beam is.
        up.uniforms.tSource.value = raysTargets[0].texture;
        up.uniforms.uHalfPixel.value.set(
          0.5 / raysTargets[0].width, 0.5 / raysTargets[0].height,
        );
        draw(up, raysTargets[1]);
      }

      if (slot && stageTiming) clock.begin(slot, 'composite');
      composite.uniforms.tScene.value = sceneTarget.texture;
      composite.uniforms.tGlow.value = glowTexture;
      composite.uniforms.tBloom.value = bloomTargets[0].texture;
      composite.uniforms.tDepth.value = sceneTarget.depthTexture;
      composite.uniforms.tFocus.value = focusTargets.length === 2 ? focusTargets[1].texture : null;
      composite.uniforms.tRays.value = raysTargets.length === 2 ? raysTargets[1].texture : null;
      composite.uniforms.tProbe.value = probeTexture;
      composite.uniforms.uExposure.value = params.exposure;
      composite.uniforms.uBloomStrength.value = params.bloomStrength;
      composite.uniforms.uLutIntensity.value = params.lutIntensity;
      composite.uniforms.uSceneBlack.value = params.sceneBlack;
      composite.uniforms.uSceneKnee.value = params.sceneKnee;
      composite.uniforms.uShadowTint.value.set(...params.shadowTint);
      composite.uniforms.uShadowRange.value = params.shadowRange;
      composite.uniforms.uSceneGain.value = params.sceneGain;
      composite.uniforms.uScenePivot.value = params.scenePivot;
      composite.uniforms.uSceneAmount.value = params.sceneAmount;
      composite.uniforms.uSceneHorizon.value.set(...params.sceneHorizon);
      composite.uniforms.uGlowThreshold.value = params.bloomThreshold;
      composite.uniforms.uGlowKnee.value = params.bloomKnee;
      // The camera is asked rather than remembered: a metre in the composite has
      // to be the same metre the fog law works in, and the zoom of the right
      // mouse button moves the field of view under it every frame.
      composite.uniforms.uCameraRange.value.set(worldCamera.near, worldCamera.far);
      const tanHalf = Math.tan(worldCamera.fov * Math.PI / 360);
      composite.uniforms.uTanHalf.value.set(tanHalf * worldCamera.aspect, tanHalf);

      // WHAT THE EYE IS DOING, and every one of these is at exactly rest until
      // src/core/eye.js says otherwise: one, nought, nought, nought. The
      // branches they guard are then not taken at all, which is why a placed
      // pose comes out of this pass the same twice.
      const e = params.eye;
      composite.uniforms.uEyeExposure.value = eye.exposure;
      composite.uniforms.uFocusSpread.value = e.focusSpread;
      composite.uniforms.uFocusAmount.value = focusing ? eye.focus * e.focusStrength : 0;
      composite.uniforms.uFocusInkKeep.value = e.focusInkKeep;
      composite.uniforms.uFocusReachPx.value = e.focusReach;
      composite.uniforms.uFocusFloor.value.set(...e.focusFloorPx);
      // Nought unless the blurred copy was actually drawn, for the same reason
      // the focus above is: a floor over a buffer nobody wrote this frame would
      // be a picture of the last frame that did write it, or of nothing.
      composite.uniforms.uWakeBlur.value = focusing ? wake.blur : 0;
      composite.uniforms.uWakeExposure.value = wake.exposure;
      composite.uniforms.uSunView.value.copy(eye.sunView);
      composite.uniforms.uGlare.value = eye.glare * e.glareStrength;
      composite.uniforms.uGlareEdge.value.set(
        Math.cos(e.glareOuterDeg * Math.PI / 180), Math.cos(e.glareInnerDeg * Math.PI / 180),
      );
      composite.uniforms.uGlareTint.value.set(...e.glareTint);

      // The sun in the picture. Nought unless the march actually ran: a flare
      // over a rays buffer left from the last time the sun was on screen would
      // be a ghost of a picture nobody is looking at any more.
      const aspect = width / Math.max(1, height);
      composite.uniforms.uAspect.value = aspect;
      composite.uniforms.uSun.value = marching ? eye.sun : 0;
      composite.uniforms.uSunUv.value.set(eye.sunNdc.x * 0.5 + 0.5, eye.sunNdc.y * 0.5 + 0.5);
      // Whether there is a measurement of the disc to gate anything with. Nought
      // says so rather than leaving the composite to read a texel nobody wrote.
      composite.uniforms.uSunProbed.value = probing ? 1 : 0;
      composite.uniforms.uRaysAmount.value = e.raysAmount;
      composite.uniforms.uRaysTint.value.set(...e.raysTint);
      composite.uniforms.uFlare.value.set(
        e.flareRadius, e.flareHalo, e.flareLength, e.flareStreak,
      );
      composite.uniforms.uFlareHeight.value = e.flareHeight;
      composite.uniforms.uFlareTint.value.set(...e.flareTint);
      // The streak's breath: nought unless the march ran, for the same reason
      // the flare is, and nought under «riduci movimento» because src/core/
      // eye.js holds it there. At nought the branch in the composite is not
      // taken and the streak is the one that was promoted, to the bit.
      composite.uniforms.uStreak.value.set(
        marching ? eye.streak * e.streakBreath : 0, eye.sunSeconds,
      );
      composite.uniforms.uGhostAt.value.set(...e.ghostAt);
      composite.uniforms.uGhostSize.value.set(...e.ghostSize);
      composite.uniforms.uGhostGain.value.set(...e.ghostGain);
      composite.uniforms.uGhostTint.value.set(...e.ghostTint);

      // The drops. The aspect goes in so that a bead is round rather than an
      // ellipse that changes shape when the window does — the shader carries x
      // in units of the frame's HEIGHT and this is what lets it.
      composite.uniforms.uRain.value.set(
        eye.rain, eye.seconds, Math.max(2, Math.round(e.rainColumns)), aspect,
      );
      composite.uniforms.uRainDrop.value.set(
        e.rainDensity, e.rainSize, e.rainRefraction, e.rainHighlight,
      );
      composite.uniforms.uRainTrail.value.set(
        e.rainTrail, e.rainDrying, Math.max(2, Math.round(e.rainMistRows)), e.rainMistDensity,
      );
      composite.uniforms.uRainWet.value.set(
        e.rainWetness, e.rainMicroStreak, e.rainDrag, e.rainMerge,
      );
      composite.uniforms.uRainDrag.value.copy(eye.drag);

      composite.uniforms.uStages.value = STAGES.reduce(
        (mask, s) => mask + (stages[s.key] ? s.bit : 0), 0,
      );
      draw(composite, null);
      if (slot) clock.end();
    },

    /**
     * What the eye is doing to this frame.
     *
     * Written once a frame from src/core/eye.js, which owns WHEN each of the
     * four happens; this file owns what they look like, in `params.eye`. The
     * split is the same one the body under the eye already uses: the tuning
     * lives with the thing that has to be tasted by walking, and the drawing
     * lives with the pass that draws.
     *
     * @param {object} next plane · focus · exposure · glare · sun · rain ·
     *   seconds · sunView (a Vector3 in the frame's own axes) · sunNdc · drag
     */
    setEye(next) {
      if (typeof next.focus === 'number') eye.focus = next.focus;
      if (typeof next.exposure === 'number') eye.exposure = next.exposure;
      if (typeof next.glare === 'number') eye.glare = next.glare;
      if (typeof next.sun === 'number') eye.sun = next.sun;
      if (typeof next.streak === 'number') eye.streak = next.streak;
      if (typeof next.sunSeconds === 'number') eye.sunSeconds = next.sunSeconds;
      if (typeof next.rain === 'number') eye.rain = next.rain;
      if (typeof next.seconds === 'number') eye.seconds = next.seconds;
      if (next.sunView) eye.sunView.copy(next.sunView);
      if (next.sunNdc) eye.sunNdc.copy(next.sunNdc);
      if (next.drag) eye.drag.copy(next.drag);
    },

    /** What it was last told, for the harness that has to prove it is at rest. */
    get eye() { return eye; },

    /**
     * THE WAKING, AND THE ONLY THING THE OPENING SCENE ASKS OF THIS FILE.
     *
     * Two numbers, written once a frame by src/ui/intro.js for the length of
     * the blinks and never again: how shut the eyes still are, and how much too
     * bright the world is for them. Both at rest — nought and one — mean the
     * frame this pass has always drawn, and not by a multiply by one: the
     * branches they guard are not taken.
     *
     * The blur is a FLOOR under the circle of confusion, not a plane and not a
     * distance, so it is uniform over the frame — which is what a lid is, and
     * why it costs no second buffer and no second pass. At one, the picture is
     * the whole of the defocused copy, which is params.eye.focusReach pixels
     * wide; that number is the eye's and is not moved by this.
     *
     * @param {number} blur01   0 nothing, 1 the whole of the blurred copy
     * @param {number} exposure a factor on the finished picture; 1 is nothing
     */
    setWake(blur01, exposure = 1) {
      wake.blur = Number.isFinite(blur01) ? Math.min(1, Math.max(0, blur01)) : 0;
      wake.exposure = Number.isFinite(exposure) ? Math.max(0, exposure) : 1;
    },

    /** What it was last told, for the harness that has to prove it went back. */
    get wake() { return wake; },

    /**
     * The one pixel, read back — FOR A MEASURING TOOL AND NOT FOR THE FRAME.
     *
     * This is a readPixels, which is a fence across the pipeline: it is exactly
     * the stall the probe exists to avoid, and calling it once a frame would
     * undo the whole reason the accommodation is computed on the GPU. It is
     * here because the other half of this unit's contract is that every number
     * it claims can be checked, and a focal plane that lives in a texture is a
     * number nobody can quote. A harness may stall; a walker may not.
     *
     * @returns {?{plane: number, open: number, wantPlane: number, wantOpen: number}}
     *   metres and 0..1, or null when the probe has never run.
     */
    readProbe() {
      if (probeTargets.length !== 2 || lastProbeAt === 0) return null;
      const raw = new Uint16Array(4);
      gl.readRenderTargetPixels(probeTargets[probeAt], 0, 0, 1, 1, raw);
      // Sixteen bit float, by hand: there is no DataView path to it and this is
      // four numbers on a development path.
      const half = (bits) => {
        const sign = (bits & 0x8000) ? -1 : 1;
        const exp = (bits >> 10) & 0x1f;
        const frac = bits & 0x3ff;
        if (exp === 0) return sign * frac * 2 ** -24;
        if (exp === 31) return frac ? NaN : sign * Infinity;
        return sign * (1 + frac / 1024) * 2 ** (exp - 15);
      };
      const dioptres = half(raw[0]);
      const wantDioptres = half(raw[2]);
      return {
        plane: dioptres > 1e-6 ? 1 / dioptres : Infinity,
        open: half(raw[1]),
        wantPlane: wantDioptres > 1e-6 ? 1 / wantDioptres : Infinity,
        wantOpen: half(raw[3]),
      };
    },

    /**
     * Hands the frame something to draw before the world.
     *
     * It runs inside the timed region and gets a stage of the driver's clock to
     * itself, which is the point: what a candidate layer costs has to be
     * readable apart from what the world costs, or the two are one number and
     * the comparison this exists for cannot be made.
     *
     * @param {?function(WebGLRenderer): void} fn null to take it off again
     */
    setPrepass(fn) {
      prepass = typeof fn === 'function' ? fn : null;
      return Boolean(prepass);
    },

    /**
     * Forces the depth service on or off, over what the seats asked for.
     *
     * FOR A NULL AND FOR A BENCH. What ships is `null`: the service is on
     * exactly when a material has asked for its uniforms, which is a decision no
     * caller has to remember to make. Handed `false` it draws the world in one
     * piece again, with the layer and everything on it drawn where it always
     * was — which is the null this pass has to be measured against, and the only
     * honest one, because it is the same frame with the same content.
     *
     * @param {?boolean} on true, false, or null to go back to the seats
     */
    setSoftDepth(on) {
      softForced = on === null || on === undefined ? null : Boolean(on);
      return softForced === null ? softDepthSeats > 0 : softForced;
    },

    /**
     * How many times the lift is drawn in a frame. ONE, in any frame anybody
     * looks at.
     *
     * A MEASURING INSTRUMENT, NOT A PROPOSAL, and it is here for the reason
     * setPrepass is: the pass costs a few hundredths of a millisecond and this
     * machine jitters by more than a whole one between two readings seconds
     * apart, so the difference of two frames is not a small number, it is no
     * number. Drawn k times and read as the SLOPE of milliseconds against k, the
     * marginal cost of one pass falls out of a regression that averages the
     * jitter over every point instead of standing on two of them. The k values
     * are visited in a MIXED order by whoever drives this — a monotone sweep
     * absorbs the machine's own drift into the slope and quotes it as cost.
     *
     * @param {number} k at least one
     */
    setSoftDepthPasses(k) {
      softPasses = Math.max(1, Math.round(k) || 1);
      return softPasses;
    },

    /**
     * How far the service's two buffers are stepped down from the frame.
     *
     * A TIER'S LEVER, and the same one this file already pulls twice: the
     * defocus is at a quarter and the sun's rays are at an eighth, both because
     * what is in them has no edge in it. What is in these has none either — a
     * distance, read only where a glow meets a surface, and a glow. Two halves
     * the bandwidth of the whole service and quarters the fill of the layer.
     *
     * One is what ships until a measurement says otherwise, because the one
     * thing a reduction here CAN show is a silhouette: a monolith's shoulder
     * cutting a halo is drawn at this resolution and enlarged by the composite's
     * bilinear filter.
     *
     * @param {number} divisor 1 or 2; the buffers are reallocated, which is a
     *   hitch, so this is moved standing still like the sample count is.
     */
    setSoftDepthScale(divisor) {
      const next = Math.max(1, Math.round(divisor) || 1);
      if (next === softScale) return false;
      softScale = next;
      if (softDepthTarget) allocateSoftDepth();
      return true;
    },

    /** What the depth service is doing, for a bench and for a verbale. */
    softDepth() {
      return {
        seats: softDepthSeats,
        forced: softForced,
        live: softForced === null ? softDepthSeats > 0 : softForced,
        layer: SOFT_DEPTH_LAYER,
        format: softFormat,
        width: softDepthTarget ? softDepthTarget.width : 0,
        height: softDepthTarget ? softDepthTarget.height : 0,
        scale: softScale,
        passes: softPasses,
      };
    },

    setLut(texture) {
      composite.uniforms.tLut.value = texture;
      composite.uniforms.uLutSize.value = texture.image.height;
    },

    params,
    stages,
    stageOrder: STAGES.map((s) => s.key),
    get quality() { return quality; },
    get bloomTier() { return bloomTier; },
    get hasGpuClock() { return clock !== null; },

    /**
     * Turns the driver's clock on. Off until somebody asks.
     *
     * The product asks, and it is not a development convenience: src/main.js
     * turns it on unconditionally because src/core/quality.js chooses the tier
     * from the GPU's own milliseconds, and the interval between callbacks is
     * the refresh rate on any machine that is not the bottleneck. Measured cost
     * of leaving it on, paired and alternated at the reference pose: at most
     * three tenths of a millisecond a frame, and two of the six repetitions
     * read the same either way.
     */
    setTiming(on, stages = false) {
      timing = Boolean(on) && clock !== null;
      stageTiming = timing && Boolean(stages);
      return timing;
    },

    /** The last complete reading of the driver's clock, in milliseconds. */
    timings() { return clock ? clock.read() : null; },

    /**
     * How many frames the clock actually timed, and why the rest were lost.
     *
     * A median is only a median over the frames that were read: this is how a
     * measurement declares its own sample rather than implying it.
     */
    clockStats() { return clock ? clock.stats() : null; },

    dispose() {
      if (sceneTarget) {
        if (sceneTarget.depthTexture) sceneTarget.depthTexture.dispose();
        sceneTarget.dispose();
      }
      for (const target of bloomTargets) target.dispose();
      for (const target of focusTargets) target.dispose();
      for (const target of raysTargets) target.dispose();
      for (const target of probeTargets) target.dispose();
      for (const target of [softDepthTarget, softGlowTarget]) if (target) target.dispose();
      softDepthTarget = null;
      softGlowTarget = null;
      SOFT_DEPTH_SEAT.tSceneDepth.value = SOFT_DEPTH_REST;
      if (campoTarget) {
        if (campoTarget.depthTexture) campoTarget.depthTexture.dispose();
        campoTarget.dispose();
      }
      campoTarget = null;
      disposeCampoPast();
      restCampo();
      fallbackLut.dispose();
      quad.geometry.dispose();
      for (const material of [prefilter, down, up, lift, probeAf, defocus, sunrays, composite]) {
        material.dispose();
      }
    },
  };
}

/**
 * Loads a fitted grade: a 32 cube unrolled into a horizontal strip, which is
 * the only way to move a three dimensional table through an image file without
 * losing anything on the way.
 */
export async function loadLut(url) {
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error(`grade unavailable: ${url}`));
    element.src = url;
  });
  if (image.width !== image.height * image.height) {
    throw new Error(`grade strip is ${image.width}x${image.height}, expected a square cube unrolled`);
  }
  const texture = new Texture(image);
  return configureLutTexture(texture);
}
