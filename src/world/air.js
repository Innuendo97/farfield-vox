import { ShaderMaterial, Vector3 } from 'three';
import { HEIGHT_FOG, SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS } from '../core/sky.js';

// THE SEAT OF THE AIR, and of the surface that stands in it.
//
// WHY THIS FILE EXISTS AT ALL. Every one of these names used to live in
// src/world/terrain.js, and six other modules imported them from there:
// distant.js, monoliths.js, rocks.js, vegetation.js and both halves of the
// voxel engine. That made the ground's own file a dependency of five other
// people's work — so the session that rewrites the ground could not touch it
// without stopping four sessions that have nothing to do with the ground. The
// air is not the ground's property. It is what every surface in this world
// stands in, and it is now stated once, here, where nobody owns it.
//
// THE FILE HAS TWO HALVES AND THEY ARE NOT THE SAME KIND OF THING.
//
// PART ONE — THE AIR ITSELF: FOG_RADIANCE, LOW_SKY, GROUND_EXPOSURE, FOG_GLSL,
// setAir and fogUniforms. FROZEN IN THE FOUNDATION. These are the fitted
// constants of the picture and the one integral that puts a surface into the
// distance; two materials that disagree about any of them do not stand in the
// same world, and the join between them is a line. Nothing outside the
// coordinator moves these.
//
// PART TWO — THE BAKED SURFACE: createBakedMaterial, and the two shaders it
// compiles. PARKED HERE, NOT FROZEN. It travelled with the air for one reason:
// the stair belongs to the stone session and the ground to the soil session,
// and leaving the factory in the ground's file would have kept exactly the
// collision this move exists to end. Said out loud so that nobody reads
// "frozen" over the whole file and stops.
//
// IT IS ONE SURFACE NOW AND NOT TWO. This part also held DETAIL and STRIP, the
// near material of the paving and the joints of it as a distance -- both
// written for the bent grid, both without a caller since that mesh went, both
// retired at step 8 with the maps they read. What is left is the STAIR: a
// painted albedo times a Cycles bake, in the air the meadow stands in, which is
// what this factory was before either was added to it and what the one surface
// that still calls it passes. The whole argument for the retirement is written
// where the two used to be.

// Colour the ground fades into, carried as radiance because that is what the
// frame is built in.
//
// It is the air the distance in distant.js is drawn in, and for the same
// reason: the meadow has to arrive at the horizon as the identical colour the
// distance already carries, or the join between them is a line.
//
// REFITTED AGAINST THE TARGETS' OWN AIR, AND THE OLD NUMBER WAS FIFTEEN LEVELS
// TOO RED AND TWENTY-TWO TOO LITTLE BLUE. What was measured is a PIXEL and not
// a radiance: 499 px of clear sky within half a degree of the horizon of the
// day target, with the frame's corner shading divided out of every sample,
// reading 115.1 / 169.7 / 204.2 in eight bits. So the constant is not that
// reading -- it is the radiance that DEVELOPS to that reading through the same
// chain the frame develops everything through, and it was solved by driving
// tools/lighting/render-chain.mjs, which is the chain the guards already judge
// the light with, until the developed air landed on those three numbers.
//
// THE RESIDUAL, DECLARED. Rounded to the four decimals this file carries, the
// constant develops to 115.11 / 169.70 / 204.20: a hundredth of a level on red
// and under a thousandth on the other two. The measurement it is being fitted
// to is worth far less than that, and the honest error bar is the one on the
// two chains rather than on the solve -- the analysis read its pixels through
// the FITTED POLYNOMIAL of the grade and this reads them through the DELIVERED
// cube, and on the constants they both had in hand the two disagree by 0.01 to
// 0.40 of a level. That is the real precision here.
//
// AND IT LANDS NEAR A NUMBER NOBODY FITTED IT TO. The sky bake records the
// dome's own air a degree and a half above the horizon opposite the sun --
// fogRadiance in assets-src/sky/sky.json, 0.14509 / 0.39725 / 0.85856 -- and
// this agrees with it to 2% on green and 4% on blue while standing at 45% of
// its red. The ground's air and the sky's air were a level and a tint apart on
// two channels of three; they are now apart on one, and the one they are apart
// on is the one the targets are emphatic about.
export const FOG_RADIANCE = [0.0648, 0.3903, 0.8946];

// The pale air the stone and the rocks hand back where they are seen almost
// edge on. Solved off the brightest stretch of the reference's path, which is
// the brightest thing in the lower half of the frame.
//
// It lives on here for the stone alone: the grazing gain in monoliths.js was
// fitted against the five flanks of the reference with this colour behind it,
// and the two cannot be separated without re-solving the fit.
//
// AND THAT IS WHY IT DID NOT MOVE WITH THE AIR ABOVE, WITH THE NUMBER SAID OUT
// LOUD. Driven through the same chain it develops to 142.4 / 167.3 / 186.6,
// against the targets' air at 115.1 / 169.7 / 204.2 -- twenty-seven levels too
// red and eighteen too little blue, a wider gap than the one just closed. The
// reason it stays is not that the gap is small. It is that this is not the air:
// it is a grazing return, and in the fragment it stands MULTIPLIED by a gain
// fitted against five flanks with this very colour behind it. Refitting one
// half of a product against a measurement of something else is how a fit gets
// lost, and the other half is already spoken for -- the grazing term's own
// refit is assigned to the stone session, with its night half waiting on the
// night session. So this moves when that fit is re-solved, by whoever re-solves
// it, and until then it is a declared debt and not an oversight.
export const LOW_SKY = [0.22, 0.40, 0.63];

// Exposure of the ground.
//
// It was four, and four was wrong. The number came from a reading of the
// reference that fed encoded pixels to an inverse tone curve expecting linear
// ones, which overstates a mid green by about the factor it was set to. Reading
// the same patch properly — tools/terrain/probe.mjs, which inverts the curve,
// the vignette and the grade together — says the reference wants a fifth of a
// unit of radiance on lit grass, not two thirds of one, and that the ground was
// being drawn three times brighter than the picture it is copying.
//
// It is not one, because the bake is a physical render and the reference is an
// illustration with lifted midtones. It is fitted, against the whole set of
// ground patches at once, and it is declared here rather than folded into the
// bake, where it would silently become part of the light.
export const GROUND_EXPOSURE = 1.25;

// Shared by every surface that has to sit in the same air. Distance fog alone
// puts as much haze on a hilltop as on the grass at its foot; the reference
// pools it low and thins it with height, which is what the second term does.
export const FOG_GLSL = /* glsl */`
  uniform vec3 uFogColour;
  uniform float uFogDensity;
  uniform float uFogHeight;
  uniform float uEyeHeight;

  // Mean density along a ray that climbs from the eye to the fragment, for a
  // density that falls exponentially with altitude. The difference of the two
  // exponentials is the closed form of the integral; the limit is taken by hand
  // when the ray is level, where that difference cancels.
  float fogAmount(float distance, float fragmentHeight) {
    float dy = fragmentHeight - uEyeHeight;
    float a = exp(-max(uEyeHeight, 0.0) / uFogHeight);
    float b = exp(-max(fragmentHeight, 0.0) / uFogHeight);
    float mean = abs(dy) < 0.01 ? a : (a - b) * uFogHeight / dy;
    float depth = distance * uFogDensity * mean;
    return 1.0 - exp(-depth * depth);
  }
`;

// HOW A TEXEL OF A BAKED ATLAS IS UNPACKED. Part two, and it dies with the
// atlases: what is stored is a bake, and a face of the voxel world computes its
// two terms instead of fetching them.
//
// It is one seat and not one copy per material because it is a STORAGE FORMAT
// and not a taste. The sun term is grey in rgb, which the sampler brings back
// to linear light on its own; the sky term is in ALPHA, which carries no
// transfer at all, as the square root of its linear value — tools that no
// longer exist put it there because an ETC1S block holds one coarse chroma and
// a shadow edge is exactly where the two terms disagree, so the old
// red-and-green pair cost 16.67 levels on every edge against 4.14 this way.
// Four materials read these atlases and all four have to unpack them the same
// way; bakedLight() in src/core/sky.js is what says what the pair MEANS, and
// this only says how one is fetched.
//
// AND IT IS ONE TAP. There used to be a cubic B-spline over four bilinear taps
// here, and it existed for one measured defect: a shadow edge in the delivered
// ground atlas is 1.65 texels wide at the median, so bilinear rebuilt it as a
// staircase on the texel grid, and at the near ground one of those steps
// covered tens of screen pixels. That defect belongs to the atlas, and the
// atlas is going: a face of the voxel world is lit by an analytic term on a
// constant normal, which has no texel grid to show through and nothing to
// reconstruct between samples. Keeping a four tap filter for a picture with no
// texels in it would be paying the fill for a defect that cannot occur.
export const BAKED_TERMS_GLSL = /* glsl */`
  vec3 bakedTerms(sampler2D tex, vec2 uv) {
    vec4 s = texture2D(tex, uv);
    return vec3(s.r, s.a * s.a, s.a * s.a);
  }
`;

const TERRAIN_VERTEX = /* glsl */`
  varying vec2 vUv;
  varying float vDistance;
  varying float vHeight;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vHeight = world.y;
    vDistance = length(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// WHAT WAS BETWEEN HERE AND THE FRAGMENT SHADER, AND WHY IT IS NOT.
//
// THREE HUNDRED AND FIFTY LINES OF TWO TERMS THAT NOTHING COULD REACH. DETAIL
// was the grit and the bedded stones of the paving under the walker's own feet,
// repeated over the world out of a two channel tile because the ground atlas
// could not write a three centimetre stone at any amplitude. STRIP was the
// joints of that paving as a DISTANCE rather than as a picture of them, so the
// frame could draw an edge finer than the texel that told it where the edge
// was. Both were measured, both were argued, and both were correct.
//
// AND NEITHER WAS EVER REACHED. The only surface that ever passed `detail` or
// `strip` to createBakedMaterial was the bent grid of src/world/terrain.js;
// that mesh was deleted at step 7, and the corridor has been columns of V1's
// disc with a material of its own since step 4. Step 7 declared the two inert
// where they stood rather than taking them, because this file is the
// coordinator's PART TWO -- parked, not frozen -- and the retirement belonged
// to whoever took the baked surface out of here.
//
// STEP 8 IS THAT DAY, and the two maps they read went with it: terrain-detail
// and terrain-path left the delivery in the same hour, with terrain-albedo and
// terrain-light beside them. A branch with no caller, reading a map that is no
// longer built, from a source that is no longer in the repository, is not a
// spare. What survives of the argument is where it is now made: the corridor's
// own lattice and its three maps are src/world/path.js and tools/path/
// paint-path.mjs, and the joint solved as a position rather than drawn as a
// picture is src/world/voxel/material.js.
//
// STRIP_REACH came here from src/world/path-strip.js at step 7 for the shader
// that was the only thing left reading it. Nothing reads it now. What is left
// in this file is the AIR, which is frozen, and the baked material with the two
// maps it always had: an albedo and a light.

const TERRAIN_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  varying float vDistance;
  varying float vHeight;

  uniform sampler2D tAlbedo;
  uniform sampler2D tLight;
  uniform float uLightScale;
  ${SCENE_LIGHT_GLSL}
  ${BAKED_TERMS_GLSL}
  ${FOG_GLSL}

  void main() {
    // Both textures carry an sRGB transfer function, so the sampler has already
    // brought them back to linear light by the time they arrive here.
    vec3 albedo = texture2D(tAlbedo, vUv).rgb;

    // Red is how much of the sun this texel sees, green how much of the sky,
    // each stored divided down to fit eight bits.
    //
    // ONE TAP, and it used to be four: see the note over BAKED_TERMS_GLSL for
    // why the cubic reconstruction went with the atlas it was reconstructing.
    vec3 terms = bakedTerms(tLight, vUv);

    // Where the pair becomes light again -- and where an evening would become a
    // different light off the same two numbers.
    vec3 light = bakedLight(terms) * uLightScale;

    vec3 colour = albedo * light;
    colour = mix(colour, uFogColour, fogAmount(vDistance, vHeight));
    gl_FragColor = vec4(colour, 1.0);
  }
`;

/**
 * The material every baked surface uses: a painted albedo, a Cycles bake, and
 * the same air as the ground.
 *
 * Shared rather than copied because the stair has to sit in the meadow, not on
 * top of it: one fog, one exposure, one way of turning a stored map back into
 * light. Two materials with the same intent drift apart on the first change.
 */
export function createBakedMaterial({ albedo, light, lightScale }) {
  return new ShaderMaterial({
    uniforms: {
      tAlbedo: { value: albedo },
      tLight: { value: light },
      uLightScale: { value: lightScale * GROUND_EXPOSURE },
      ...SCENE_LIGHT_UNIFORMS,
      ...fogUniforms(),
    },
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
    fog: false,
  });
}

// ONE SEAT FOR THE AIR, and two reasons it is one rather than a copy per
// material.
//
// The first is the eye. `uEyeHeight` was the literal 1.7 in every material and
// nobody ever wrote to it, so the height integral believed the walker was
// standing on flat ground at all times — on the platform, at the top of the
// stair, on a hummock, at three metres up, it still integrated from one metre
// seventy. The camera moves now, and it climbs, so this is written every frame
// and it has to reach every material that stands in the same air.
//
// The second is the hour. The colour of the air is not a constant of this world,
// it is what the sky puts on a level patch, and there is going to be a night.
// So it is DERIVED from the light the sky is already handing the ground —
// `uSkyLight`, which src/core/sky.js sets from the preset — rather than written
// down a second time. What was measured off the reference is kept as the RATIO
// between the two, so today it reproduces the fitted radiance exactly and a
// different preset moves the air with the sky instead of leaving it at noon.
//
// What the ratio does NOT carry is the change in the SHAPE of the scattering
// with the sun's height: it carries level and tint, which is what the join
// between the meadow and the distance is made of, and not the way the aureole
// swings round. Written down rather than implied.
const AIR = {
  uFogColour: { value: new Vector3(...FOG_RADIANCE) },
  uEyeHeight: { value: 1.7 },
};
const AIR_PER_SKY = new Vector3(...FOG_RADIANCE).divide(
  new Vector3().copy(SCENE_LIGHT_UNIFORMS.uSkyLight.value),
);

/**
 * Tells the air where the eye is, and what hour it is.
 *
 * Called once a frame from the hub, which is the one place that knows both.
 *
 * @param {number} eyeHeight  metres above the world's zero
 */
export function setAir(eyeHeight) {
  AIR.uEyeHeight.value = eyeHeight;
  AIR.uFogColour.value.copy(SCENE_LIGHT_UNIFORMS.uSkyLight.value).multiply(AIR_PER_SKY);
  return AIR;
}

export function fogUniforms() {
  return {
    // Shared by reference, not copied: see AIR above.
    uFogColour: AIR.uFogColour,
    uFogDensity: { value: HEIGHT_FOG.densityAtGround },
    uFogHeight: { value: HEIGHT_FOG.scaleHeight },
    uEyeHeight: AIR.uEyeHeight,
  };
}
