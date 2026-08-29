import {
  BackSide, BoxGeometry, DataTexture, Mesh, RepeatWrapping,
  ShaderMaterial, Vector2, Vector3, Vector4,
} from 'three';
import SKY from '../../assets-src/sky/sky.json' with { type: 'json' };
import SCENE_LIGHT from '../../assets-src/sky/scene-light.json' with { type: 'json' };

// The sky, and everything the scene takes from it.
//
// THE DOME CARRIES NO PICTURE. It is evaluated, per fragment, from the physical
// model tools/grade/lib/sky-model.mjs fitted against the reference: single
// scattering by air and by aerosol under one air mass, plus an isotropic term
// for everything scattered more than once. Twelve numbers and two lobes, folded
// into the bundle out of sky.json, and no texture at all.
//
// That is not an economy, though it is one — three hundred and sixteen
// kilobytes and a dependent fetch per sky fragment. It is the one property the
// committente asked for and nothing else could give: A SMOOTH ANALYTIC SKY
// CANNOT HAVE BLOTCHES. Every version of this dome that carried material
// measured off the photograph — the sector carry baked into an equirect, the
// hue tables, the veil composited here — put a soft closed contour somewhere in
// the sky, and every attempt to hide one moved it. A measurement has a
// boundary; a boundary carried outwards is a contour; a soft dark contour in an
// open sky is a stain, whatever arithmetic drew it and however wide the fade.
// There is nothing to find here because there is nothing in it that could draw
// one: a few exponentials of one monotone variable and one phase angle.
//
// Three things are given up with it, and they are named rather than discovered.
// The reference's own sector no longer matches texel for texel — what is asked
// of the eye now is family, not difference. The dither has to stay and matters
// more than it did, because a gradient this smooth magnified over a screen
// quantises into bands with nothing to hide them behind. And the sun has to be
// drawn, because a physical sky with no sun in it is the one reading this model
// cannot give — which is the other half of what was asked for.

const DAY = SKY.day;
const AIR = SKY.airMass;

/** A number as a GLSL literal, so a constant here cannot drift from the shader's. */
const glsl = (value, digits = 8) => value.toFixed(digits);

// Depth of the analytic fog, in metres, chosen so the ground plane has fully
// dissolved before its far edge could draw a false horizon across the frame,
// and so nothing inside the walkable area is tinted.
const FOG_DENSITY = 0.013;

// ------------------------------------------------------------- the preset
//
// WHERE A DAY AND A NIGHT HOOK ON.
//
// The whole sky is these six uniforms. They are shared by the dome, by every
// surface that reflects it and by the weather that is lit by it, so there is
// exactly one answer in the frame to where the sun is and what the air is doing
// — which is the property a cycle needs and the reason this is a uniform block
// rather than a set of literals folded into each shader.
//
// A dusk or a night is another sky.json preset of the same shape: a sun near or
// under the horizon, a larger aerosol depth, a lower exposure. The cycle is
// setSkyPreset called with the two presets mixed by the hour, and nothing else
// in this file, in the materials, or in the weather has to know it happened.
// What must NOT be done instead is a second code path — the moment two skies
// are drawn by two pieces of arithmetic, the dome and the water start
// disagreeing about where the sun is.
export const SKY_UNIFORMS = {
  // Where the sun is. Also what relights the weather in src/world/clouds.js and
  // what the aureole is drawn around, which is the whole point of it being one
  // uniform and not three constants.
  uSunDir: { value: new Vector3() },
  // Optical depth of the air and of the haze, per channel. The wavelengths are
  // in the bake and nowhere else; what arrives here is already three numbers.
  uSkyRayleigh: { value: new Vector3() },
  uSkyMie: { value: new Vector3() },
  // What turns the model's radiance into this frame's light.
  uSkyExposure: { value: new Vector3() },
  // x: how far forward the haze throws what it scatters; y: everything
  // scattered more than once; z and w: the two lobes of the aureole.
  uSkyShape: { value: new Vector4() },
  // x: the disc's angular radius in degrees; y: how far its edge is let go over;
  // z: how bright, as a multiple of the exposure above.
  uSunDisc: { value: new Vector3() },
};

/**
 * Hands the sky its numbers.
 *
 * THE DOOR, AND THE CONTRACT BETWEEN THE TWO SESSIONS EITHER SIDE OF IT. The
 * OPTICS — what a bearing is worth, how the air scatters, how the disc and its
 * aureole are drawn — are V6's, and they live below in SKY_GLSL and in the
 * model that fitted them. The VALUES of a preset are V7's, because a night is
 * this function called with another entry of the same shape and nothing else in
 * this file, in the materials or in the weather has to know it happened.
 *
 * So this is the only place the six uniforms are WRITTEN. Reading them is
 * anybody's; a second writer is two hands on one sky, and the two would drift
 * into a frame as a halo or a wrong blue rather than as an error anything could
 * catch. tools/guards/guard-luce-sigillo.mjs holds the door shut.
 *
 * @param {object} preset as tools/grade/lib/sky-model.mjs dayPreset writes it
 */
export function setSkyPreset(preset) {
  SKY_UNIFORMS.uSunDir.value.set(...preset.sun.vector).normalize();
  SKY_UNIFORMS.uSkyRayleigh.value.set(...preset.tauRayleigh);
  SKY_UNIFORMS.uSkyMie.value.set(...preset.tauMie);
  SKY_UNIFORMS.uSkyExposure.value.set(...preset.exposure);
  SKY_UNIFORMS.uSkyShape.value.set(
    preset.g, preset.ambient, preset.aureole.wide, preset.aureole.narrow,
  );
  SKY_UNIFORMS.uSunDisc.value.set(
    preset.disc.radiusDeg, preset.disc.softDeg, preset.disc.level,
  );
  return SKY_UNIFORMS;
}

setSkyPreset(DAY);

/** Where the sun is, for everything that is lit by it rather than drawing it. */
export const SUN_DIRECTION = SKY_UNIFORMS.uSunDir.value;

// ------------------------------------------------- what the world is lit BY
//
// THE SECOND PLACE A DAY AND A NIGHT HOOK ON, and the one that moves the
// ground rather than the sky.
//
// Every baked surface in this world carries two scalars instead of one colour:
// how much of the SUN it sees, and how much of the SKY. What turns those two
// numbers back into light is these two uniforms, so a night is this pair
// changed and nothing else — no re-bake, no second set of maps, no second code
// path. It is the shape the client's night trigger asked for before this
// session began, and the reason the light was split at all.
//
// Both are a DERIVED HUE times a FITTED MAGNITUDE, and the split matters: the
// hue moves with the preset, so a night gets its own for nothing, and only two
// numbers in the whole chain were ever fitted.
//
// uSkyLight is the dome's own irradiance WITH THE PICTURE'S WHITE BALANCE
// DIVIDED OUT. The raw irradiance cannot be used as a light: it comes to twelve
// to one blue over red, because the preset's per channel exposure was fitted so
// the DRAWN sky lands on the reference's pixels and the photograph's balance is
// inside it — the same reason the disc above is scaled by the mean of the three
// exposures rather than by each. Divided out, what is left is air: two and a
// half to one, which is a sky. Measured on the reference's own ground patches,
// that division alone takes the fit's error from 44.8 encoded levels to 38.4.
//
// uSunLight is the beam's colour times its strength. The colour is the air's
// own extinction at the sun's air mass, so it reddens by itself as a preset
// puts the sun lower. Both strengths are FITTED against the reference — see
// tools/lighting/fit-scene-light.mjs — because the dome's disc level was chosen
// to make a drawn sun saturate the tone curve and carries no sun's energy.
export const SCENE_LIGHT_UNIFORMS = {
  uSunLight: { value: new Vector3() },
  uSkyLight: { value: new Vector3() },
};

/** Hands the ground, the stone and the rocks the two colours of the hour. */
export function setSceneLight(entry) {
  for (const key of ['sunStrength', 'skyStrength']) {
    if (typeof entry[key] !== 'number') {
      throw new Error(`assets-src/sky/scene-light.json has no ${key}: `
        + 'run "node tools/lighting/fit-scene-light.mjs --write"');
    }
  }
  SCENE_LIGHT_UNIFORMS.uSunLight.value.set(...entry.sunBeam)
    .multiplyScalar(entry.sunStrength);
  SCENE_LIGHT_UNIFORMS.uSkyLight.value.set(...entry.skyBalance)
    .multiplyScalar(entry.skyStrength);
  return SCENE_LIGHT_UNIFORMS;
}

setSceneLight(SCENE_LIGHT.day);

// How a stored pair of terms becomes light. Shared by every baked material, so
// that the ground, the stair, the stone and the rocks cannot disagree about
// what a texel of a light map means.
//
// One read, not two. The two terms live in the red and the green of one
// texture, so the two term world costs the frame exactly what the one term
// world cost it. The blue carries a copy of the green and is not read: a
// channel left at nought drags a block's luma down and spends the codec's
// resolution saying nothing.
export const SCENE_LIGHT_GLSL = /* glsl */`
  uniform vec3 uSunLight;
  uniform vec3 uSkyLight;

  vec3 bakedLight(vec3 terms) {
    return terms.r * uSunLight + terms.g * uSkyLight;
  }
`;

// Drawn as a box the size of nothing, pinned to the eye: the translation is
// stripped from the view matrix in the vertex shader, so the box is always
// centred on the camera whatever the camera does, and its depth is forced to
// the far plane so every piece of the world is in front of it.
const SKY_VERTEX = /* glsl */`
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    mat4 view = modelViewMatrix;
    view[3].xyz = vec3(0.0);
    vec4 clip = projectionMatrix * view * vec4(position, 1.0);
    gl_Position = clip.xyww;
  }
`;

// How a direction becomes sky. Shared with every surface that reflects it, so
// that the dome and the water can never disagree about what a bearing is worth.
//
// This is the same arithmetic as domeRadiance in tools/grade/lib/sky-model.mjs,
// written twice — which is a thing worth being uncomfortable about, because the
// cloud bake SUBTRACTS what that returns and this ADDS BACK what this returns,
// so any difference between them lands in the frame as a halo round every piece
// of weather. tools/grade/check-dome.mjs measures the two against each other on
// the running page for exactly that reason, and fails on a disagreement of more
// than a thousandth.
export const SKY_GLSL = /* glsl */`
  uniform vec3 uSunDir;
  uniform vec3 uSkyRayleigh;
  uniform vec3 uSkyMie;
  uniform vec3 uSkyExposure;
  uniform vec4 uSkyShape;
  uniform vec3 uSunDisc;

  // Kasten and Young relative air mass, and the two constants that continue it
  // below the horizon with the slope it arrives with.
  //
  // Clamping it at the horizon instead is what drew a line across the equator of
  // the sky: above the horizon it falls steeply and below it, clamped, it falls
  // by nothing. The value matched across the join and the slope did not, and a
  // slope that changes in one row is a crease the eye finds immediately — on the
  // one row a walker looking straight ahead has in the middle of the frame.
  //
  // The cosine of the zenith angle is the sine of the elevation, which is the
  // vertical component of a unit direction, so it arrives free: the only trig
  // here is the one arcsine the correction term needs, and 96.07995 minus the
  // zenith angle is 6.07995 plus the elevation.
  const float SKY_HORIZON_MASS = ${glsl(AIR.horizon, 6)};
  const float SKY_HORIZON_SLOPE = ${glsl(AIR.horizonSlope, 6)};
  const float SKY_BELOW_TAU = ${glsl(AIR.belowHorizonScale, 4)};

  float skyAirMass(float sinElevation, float elevationDeg) {
    if (elevationDeg >= 0.0) {
      return 1.0 / (sinElevation + 0.50572 * pow(6.07995 + elevationDeg, -1.6364));
    }
    return SKY_HORIZON_MASS + SKY_HORIZON_SLOPE * SKY_BELOW_TAU
      * (1.0 - exp(elevationDeg / SKY_BELOW_TAU));
  }

  // The clear sky, and the sun standing in it.
  //
  // The sharpness is how much of the sun survives, and it is the analytic
  // equivalent of a level of a texture: one for a mirror and the dome, less for
  // a surface that scatters what it reflects. It shortens the narrow lobe —
  // an exponent scales with the inverse square of the angular width, so the
  // sharpness IS that scale — and it spreads the disc while taking its radiance
  // down by the same factor its solid angle goes up by, which is what a coarser
  // level does and is why a rough face shows the light of a sun rather than a
  // sun. The wide lobe is forty degrees across and has nothing to blur.
  vec3 skyDome(vec3 direction, float sharpness) {
    vec3 d = normalize(direction);
    float elevation = degrees(asin(clamp(d.y, -1.0, 1.0)));
    float m = skyAirMass(d.y, elevation);
    float c = dot(d, uSunDir);
    float forward = max(0.0, c);

    // Rayleigh, which is symmetric, and Henyey-Greenstein, which is not.
    float pr = 0.05968310 * (1.0 + c * c);
    float g = uSkyShape.x;
    float gg = g * g;
    float denom = max(1e-4, 1.0 + gg - 2.0 * g * c);
    float pm = ((1.0 - gg) * 0.07957747) / (denom * sqrt(denom));

    // And the circumsolar peak one asymmetry cannot reach, added to the SAME
    // aerosol coefficient: it is a correction to the phase function rather than
    // a light of its own, so it carries the haze's wavelength dependence and
    // the haze's air mass and can invent neither a colour nor a horizon.
    //
    // Blurring the narrow lobe SHORTENS IT AND DIMS IT TOGETHER. A lobe of
    // cos^n integrates to 2*pi/(n+1) over the hemisphere, so spreading one
    // without taking its peak down multiplies the light it carries by the
    // factor it was widened by — at the roughness the stone asks for that is
    // sixty times, and what it drew was every rock and every giant in the world
    // washed to a pale slab against the sky. A blur moves light about; it does
    // not make any.
    const float NARROW_N = ${glsl(DAY.aureole.narrowExponent, 1)};
    float peak = NARROW_N * sharpness;
    float extra = uSkyShape.z * pow(forward, ${glsl(DAY.aureole.wideExponent, 1)})
      + uSkyShape.w * ((peak + 1.0) / (NARROW_N + 1.0)) * pow(forward, peak);

    float spread = inversesqrt(max(1e-4, sharpness));
    float gamma = degrees(acos(clamp(c, -1.0, 1.0)));
    float edge = uSunDisc.x * spread;
    float soft = uSunDisc.y * spread;
    float disc = (1.0 - smoothstep(edge - soft, edge + soft, gamma))
      * uSunDisc.z * sharpness;

    vec3 tau = uSkyRayleigh + uSkyMie;
    vec3 source = (uSkyRayleigh * pr + uSkyMie * (pm + extra)
      + uSkyShape.y * tau * 0.07957747) / tau;
    // One exponential, read twice: what the air has scattered into the ray is
    // one minus what it has let through, and the disc is what it has let
    // through. Which is also why the sun would redden on its own in a preset
    // that put it near the horizon — nothing here has to be told to.
    vec3 through = exp(-tau * m);
    // The disc is scaled by the MEAN of the three exposures rather than by each
    // of them, so the only thing that gives the sun a colour is what the air
    // takes out of it. Per channel it came out blue: the fit folded the
    // reference's white balance into the exposure, and a beam carrying that
    // balance is a beam a third as red as it is blue — which the tone curve
    // hides on the disc, where everything saturates to white, and does not hide
    // in the bloom, where the halo is a linear copy of it. What is left after
    // this is extinction alone: neutral overhead, warm near the horizon.
    float beam = dot(uSkyExposure, vec3(0.33333333));
    return uSkyExposure * source * (1.0 - through) + beam * disc * through;
  }

  vec3 skyRadiance(vec3 direction, float widen) {
    return skyDome(direction, exp2(-2.0 * widen));
  }

  vec3 skyRadiance(vec3 direction) {
    return skyDome(direction, 1.0);
  }
`;

// The same sky, with the weather in it, for the surfaces that reflect it.
//
// The dome carries no cloud — the cloud is bodies standing in front of it — so
// until this existed the water and the stone reflected an empty sky, while the
// reference shows the bank lying in the run and on the lakes. Intersecting the
// sprites per reflected ray is not available at any price: thirty five quads a
// fragment, over the whole meadow. So tools/clouds/bake-sprites.mjs lays the
// same composition down once as an equirect and this composites it over the
// dome, which costs one tap on top of a dome that now takes none.
//
// The drift arrives as a shift along the first axis, and that is exact rather
// than approximate: the field turns rigidly about the vertical, and a rotation
// about the vertical is a translation in bearing.
//
// Kept apart from the block above so that the dome, which is the one surface
// that must NOT draw the cloud twice, cannot accidentally be given it.
export const SKY_REFLECTION_GLSL = /* glsl */`
  uniform sampler2D tCloudSky;
  // x: the level the picture is stored against, nought until it has arrived;
  // y: how far the field has turned, in turns of the compass.
  uniform vec2 uCloudSky;

  // Equirect convention shared with tools/grade/lib/framing.mjs: the bearing
  // wraps from +X and north lands a quarter of the way along the texture.
  //
  // Only the cloud layer is read this way now. The sky underneath it is
  // evaluated, so the pole margin, the footprint and the seam below are the
  // weather's problem alone.
  vec2 cloudUv(vec3 direction, out float cosElevation) {
    cosElevation = length(direction.xz);
    return vec2(
      atan(direction.z, direction.x) * 0.15915494 + 0.5,
      1.0 - (atan(direction.y, cosElevation) * 0.31830989 + 0.5));
  }

  // How near a pole the weather is read, as a fraction of the picture's height.
  // A degree and a half short of it, because a pole is one point and an equirect
  // gives that one point a whole row: every texel of that row stands for the
  // same direction, reading one of them is arbitrary, and no resampler handles
  // them well, because a resampler wraps at the boundary and the wrap at the top
  // of a picture is the bottom of it.
  const float CLOUD_POLE_MARGIN = 0.009;

  // How wide one screen pixel is on the picture, told to the sampler rather than
  // measured by it, because this projection misstates it in two places.
  //
  // The bearing is a circle cut open at due west: across that cut two
  // neighbouring pixels differ by a whole turn, which the sampler reads as a
  // footprint the width of the texture and answers with the coarsest level it
  // has — a column of flat grey down the western sky, appearing and
  // disappearing as the eye turns. Nothing in this frame moves half a texture
  // between two pixels, so a step of about one whole turn is the cut.
  //
  // The poles are the other place, and the step there is real: the bearing does
  // turn, a whole revolution of it crossing a few pixels of screen. But a width
  // in u is not a width in the world — the meridians close in towards the pole,
  // and the piece of sky a texel of them covers narrows with the cosine of the
  // elevation. Scaling by that cosine states the footprint in angle, which is
  // what a level has to be chosen from.
  //
  // The order is not free. The cut is a whole turn wide at every elevation, so
  // it has to come out first: scaled by the cosine, a turn no longer rounds to
  // one and the western column comes back above sixty degrees.
  void cloudFootprint(vec2 uv, float cosElevation, float widen, out vec2 ddx, out vec2 ddy) {
    ddx = dFdx(uv);
    ddy = dFdy(uv);
    ddx.x -= round(ddx.x);
    ddy.x -= round(ddy.x);
    vec2 scale = vec2(cosElevation, 1.0) * exp2(widen);
    ddx *= scale;
    ddy *= scale;
  }

  vec3 skyReflection(vec3 direction, float widen) {
    vec3 base = skyRadiance(direction, widen);
    float cosElevation;
    vec2 uv = cloudUv(direction, cosElevation);
    vec2 ddx, ddy;
    // The footprint is measured on the direction the fragment actually looks
    // in, and the clamp applied after: the derivative of a clamped value is
    // zero, and a level chosen from zero would change across the edge of the
    // clamp instead of across the sky.
    cloudFootprint(uv, cosElevation, widen, ddx, ddy);
    uv.y = clamp(uv.y, CLOUD_POLE_MARGIN, 1.0 - CLOUD_POLE_MARGIN);
    vec4 cloud = texture2DGradEXT(tCloudSky, vec2(uv.x - uCloudSky.y, uv.y), ddx, ddy);
    // Premultiplied, exactly as the sprites are blended into the frame.
    return base * (1.0 - cloud.a) + cloud.rgb * uCloudSky.x;
  }

  vec3 skyReflection(vec3 direction) {
    return skyReflection(direction, 0.0);
  }
`;

// A picture of no weather at all, so that every surface which reflects the sky
// has something to sample from the first frame: a sampler bound to nothing reads
// whatever the driver left.
const NO_CLOUD = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
NO_CLOUD.needsUpdate = true;

// One set of uniforms, shared by every material that reflects the sky.
//
// Shared and not copied: the drift is one number about the whole field, and
// four materials reading four copies of it is four places it can be forgotten.
export const SKY_REFLECTION = {
  tCloudSky: { value: NO_CLOUD },
  uCloudSky: { value: new Vector2(0, 0) },
};

/**
 * Hands the weather to everything that reflects the sky.
 *
 * @param {Texture} texture equirect, as delivered by the asset gateway
 * @param {number}  level   the scale the picture's colour is stored against
 */
export function setCloudSky(texture, level) {
  if (!texture) return;
  // The bearing wraps, so the picture has to as well, or the levels either side
  // of due west are built against a wall instead of against the sky.
  texture.wrapS = RepeatWrapping;
  texture.needsUpdate = true;
  SKY_REFLECTION.tCloudSky.value = texture;
  SKY_REFLECTION.uCloudSky.value.x = level;
}

/** How far the field has turned since it was laid, in turns of the compass. */
export function setCloudDrift(turns) {
  SKY_REFLECTION.uCloudSky.value.y = turns;
}

// How the cloud atlas is dithered.
//
// It lives here rather than in src/world/clouds.js because the dome dithers too
// and the two are blended over one another: two noises drawn from the same
// number are one noise of twice the amplitude, so the pair has to be chosen
// together, in one place, and be seen to be different.
export const CLOUD_DITHER_GLSL = /* glsl */`
  // Two decorrelated draws from a screen position, without a transcendental.
  // The same arithmetic the dome dithers with and a different pair of steps
  // round the unit interval, because what this dithers is blended over what the
  // dome dithered.
  vec2 cloudNoisePair(vec2 p) {
    float k = fract(dot(p, vec2(0.05831577, 0.07231941)));
    return fract(vec2(43.3271893, 27.6431177) * k);
  }
`;

const SKY_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec3 vDirection;

  ${SKY_GLSL}

  // Two decorrelated draws from a screen position, without a transcendental.
  //
  // The hash the composite pass uses takes a sine of the position, and the
  // position of a pixel of this frame is tens of thousands of radians in: the
  // range reduction that costs is the most expensive thing in an otherwise
  // trivial shader, and measured over the sky this frame keeps it was most of a
  // millisecond. This is the same idea in arithmetic only — a large irrational
  // step round the unit interval — and it is drawn twice from one dot product,
  // which is what makes the pair cheaper than either of the sines was.
  vec2 skyNoisePair(vec2 p) {
    float k = fract(dot(p, vec2(0.06711056, 0.00583715)));
    return fract(vec2(52.9829189, 19.1233149) * k);
  }

  void main() {
    vec3 colour = skyDome(vDirection, 1.0);
    // Triangular noise of one step of an eight bit channel, and it matters more
    // here than it ever did.
    //
    // The dome used to be a picture, and a picture can be dithered where it is
    // written. This is a function, magnified: the sky crosses a step of the
    // display over tens of pixels of screen, which quantises into bands, and
    // the sky is the one surface in this world with nothing to hide them
    // behind. The step is taken in the display's own units — the frame is
    // encoded through the sRGB transfer function after the tone curve, so a
    // least significant bit up there is the slope of that function at the value
    // read, which over the range this sky occupies is within a tenth of two
    // roots of the radiance over two hundred and fifty five. Per channel,
    // because the deep blue of this sky carries a tenth as much red as green and
    // a band in the red is a band whatever the green is doing.
    //
    // The generator is not the one the composite pass in post.js uses, and that
    // is the point of it: two noises drawn from the same number are one noise of
    // twice the amplitude — visible grain, where two independent ones stay under
    // the level either of them was chosen at.
    vec2 draws = skyNoisePair(gl_FragCoord.xy);
    vec3 quantum = sqrt(max(colour, 0.0)) * (2.0 / 255.0);
    gl_FragColor = vec4(max(colour + (draws.x - draws.y) * quantum, 0.0), 1.0);
  }
`;

/**
 * Hangs the sky behind the scene.
 *
 * It costs no asset and waits for nothing, so it goes up with the scene rather
 * than with a delivery: the walker's first frame has the finished sky in it.
 *
 * @param {Scene} scene
 */
export function applySky(scene) {
  if (scene.getObjectByName('sky')) return scene;

  const mesh = new Mesh(new BoxGeometry(2, 2, 2), new ShaderMaterial({
    // Shared rather than copied: one sky, one set of numbers, and a cycle that
    // moves them moves them everywhere at once.
    uniforms: { ...SKY_UNIFORMS },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: BackSide,
    // Tested against the world rather than laid down under it.
    //
    // The vertex shader forces every fragment of the dome to the far plane, so
    // the test asks exactly one question — is anything already in front of this
    // — and the answer is no for the sky the frame shows and yes for the sky it
    // does not. Drawn first and untested, the whole dome would be shaded and the
    // world then painted over the greater part of it; at the reference framing
    // that part is well over half the frame.
    //
    // It still writes no depth of its own. The dome is behind everything and has
    // nothing to say about what is in front of what, and a far plane in the
    // depth buffer would only cost the surfaces drawn after it a test they
    // cannot fail.
    depthTest: true,
    depthWrite: false,
    fog: false,
  }));
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  // Last of the opaque surfaces: above every one of them, the highest being the
  // grass at one, so the world is wholly in the depth buffer by the time the
  // dome is asked for. It does not have to clear the transparent surfaces as
  // well — the water, the open panels — because those are a separate list and
  // are drawn after every opaque one whatever their order, which is also what
  // keeps them blending against the sky as they did before.
  mesh.renderOrder = 10;

  scene.background = null;
  scene.add(mesh);
  return scene;
}

// There was an applyFog(scene) here, which hung a THREE.FogExp2 on the scene.
// Nothing read it: every material in this world carries its own height fog and
// declares fog: false, and a scene fog is only consulted by materials that ask
// for it. So it was a fourth colour of air that could never appear, sitting
// beside three that do, and it went on 2026-08-20 with the rest of the haze
// hygiene. What replaced it is one seat in src/world/air.js.

/**
 * Height fog hook.
 *
 * The reference shows the haze pooling low and thinning with altitude, which
 * distance alone cannot express. Doing it properly means the fog integral has
 * to be evaluated per fragment against the camera height, and that belongs in
 * the material shaders that arrive with the real terrain and stone. Until then
 * this records the shape those shaders will be given, so the value is fitted
 * once and read from one place.
 */
export const HEIGHT_FOG = {
  // Density at the horizon plane, falling off exponentially with altitude.
  densityAtGround: FOG_DENSITY,
  // Metres over which the haze thins by a factor of e.
  scaleHeight: 42,
  colour: SKY.fog,
  /** Fog density at a given altitude, for the shaders to come. */
  densityAt(metres) {
    return this.densityAtGround * Math.exp(-Math.max(0, metres) / this.scaleHeight);
  },
};
