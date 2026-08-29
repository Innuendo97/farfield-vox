import {
  BackSide, BoxGeometry, DataTexture, Mesh, RepeatWrapping,
  ShaderMaterial, Vector2, Vector3, Vector4,
} from 'three';
import SKY from '../../assets-src/sky/sky.json' with { type: 'json' };
import SCENE_LIGHT from '../../assets-src/sky/scene-light.json' with { type: 'json' };
import { rampBend } from './sky-ramp.js';

// The sky, and everything the scene takes from it.
//
// THE DOME CARRIES NO PICTURE, AND IT IS A RAMP BETWEEN TWO TINTS. One mix over
// elevation, evaluated per fragment out of sky.json's day.ramp, and no texture
// at all.
//
// It replaced a fitted physical sky — single scattering by air and by aerosol
// under one air mass — and the reason is measured rather than tasted. That dome
// could not draw these targets AT ANY IRRADIANCE, and three separate walls said
// so: the red the targets show costs a level of x0,020, which is ninety-eight
// per cent of the red irradiance; far from the sun the model is
// A*(1-exp(-tau*m)), whose steepest possible fall between two elevations is the
// ratio of their air masses, 1,764 between fourteen and twenty-six degrees,
// where the targets ask 3,69 in green and 4,90 in blue; and the last bands are
// outside what AgX can print at all. The first two are the FORM of the model and
// not its parameters, so no fit was ever going to reach them. What the targets
// draw is a vertical ramp between two tints — the two that sky.json still
// carried from before the physical dome, within a handful of levels of the two
// ends of the targets' own gradient.
//
// WHAT IS KEPT, BECAUSE IT WAS NEVER THE PHYSICS THAT EARNED IT. A SMOOTH SKY
// CANNOT HAVE BLOTCHES: every version of this dome that carried material
// measured off the photograph — the sector carry baked into an equirect, the hue
// tables, the veil composited here — put a soft closed contour somewhere in the
// sky, and every attempt to hide one moved it. A measurement has a boundary; a
// boundary carried outwards is a contour; a soft dark contour in an open sky is
// a stain, whatever arithmetic drew it and however wide the fade. A ramp is
// stronger here than the physics was: it is a function of ONE variable, so it
// has no azimuth to be blotchy in, and a band or a seam would have to be a band
// in elevation alone.
//
// The dither stays and matters more than it did, because a gradient this smooth
// magnified over a screen quantises into bands with nothing to hide them behind.
// And the sun is still drawn, because a sky with no sun in it is the one reading
// this cannot give.
//
// WHAT DIED WITH THE PHYSICS, NAMED RATHER THAN LEFT TO BE DISCOVERED: the air
// mass and its continuation below the horizon, the two optical depths, the
// Rayleigh and Henyey-Greenstein phase functions, the isotropic multiple
// scattering term, and the extinction that reddened the disc by itself. The
// aureole is kept but RE-BASED — the same lobe, at the level that reproduces the
// excess the physical dome put eight degrees from the sun — and the disc no
// longer reddens on its own, so a preset that puts the sun near the horizon has
// to say so in its own numbers. sky.json still carries the retired parameters
// because the cloud atlas standing in the tree was baked against them.

const DAY = SKY.day;

// Depth of the analytic fog, in metres, chosen so the ground plane has fully
// dissolved before its far edge could draw a false horizon across the frame,
// and so nothing inside the walkable area is tinted.
//
// AND NOW ALSO FITTED, because that first reading was of a horizon and the
// monoliths are what the frame is about. It was 0.013, and at 0.013 the stone
// thirty metres out was more than half air: the fraction of pure air in the far
// face read 0.45 against the 0.031 to 0.211 the reference carries over the same
// depths, its level 89.8 against 38.2, its chroma 19.6 against 8.5. The whole
// of the blue haze on the standing stones was this one number — switching the
// air off took that chroma to 9.9 on its own.
//
// FITTED AGAINST THREE READINGS AT ONCE, and it is the value whose WORST one is
// smallest. The fraction of air by depth now lands inside the reference's band
// at every window; the level and the chroma of the near face end 11.8 per cent
// under and 11.9 per cent over, and they are equal there because they pull
// against each other. Meeting both exactly is not possible from here: the air
// this sky puts on a face is 37 levels darker than the reference's, so the
// amount of it that brings a face up to the right level brings too much of its
// colour up with it. That difference belongs to the ramp and not to this.
//
// The density enters the integral SQUARED, so a factor here is a much larger
// factor on the haze, and it carries the whole of the shape with distance: the
// height scale beside it moves the fitted window by half a level over thirty to
// eighty metres, and the far frame past a hundred metres never reaches this at
// all, because it carries its own measured share of air per vertex.
const FOG_DENSITY = 0.0059;

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
  // The two ends of the ramp, at the horizon and at the zenith. They are tints
  // and not radiances: the exposure below multiplies both, which is what lets a
  // night be this preset with three numbers turned down rather than six.
  uSkyHorizon: { value: new Vector3() },
  uSkyZenith: { value: new Vector3() },
  // THE THIRD ANCHOR, CARRIED AS A BEND RATHER THAN AS A TINT (E-V6i).
  //
  // A preset may state a middle tint and the elevation it sits at. What the
  // fragment needs is not that tint but the one vector that puts the curve
  // through it, and the arithmetic below turns the one into the other once, on
  // the way in, so the shader never learns there is a third anchor at all: it
  // adds one term. A preset with no middle anchor — or with one that lies on
  // its own segment, which is E-V6i's soft retreat — leaves this at nought and
  // the sky is then the two-tint ramp BIT FOR BIT rather than nearly.
  uSkyBend: { value: new Vector3() },
  // What turns the ramp's tints into this frame's light.
  uSkyExposure: { value: new Vector3() },
  // x: the knee — the power the mix rises through; y: the gain that bends the
  // mix without moving either of its ends; z: the level of the aureole;
  // w: the exponent of the aureole's lobe.
  //
  // THE EXPONENT IS A UNIFORM AND NOT A LITERAL, and it used not to be (E-V7i.2).
  // It was compiled into the shader out of the DAY preset, so a night that
  // wanted a different lobe was silently given the day's while the offline twin
  // honoured its own — the frame and the model disagreeing about the sky, which
  // is the one failure this file is arranged to prevent. It costs nothing: the
  // exponent already reached pow() as a variable, because the sharpness
  // multiplies it.
  uSkyRamp: { value: new Vector4() },
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
 * @param {object} preset an entry of sky.json of the shape day has: a sun, a
 *   ramp of two tints and a shape, an exposure, and a disc
 */
export function setSkyPreset(preset) {
  const ramp = preset.ramp;
  if (!ramp) {
    throw new Error('a sky preset needs a ramp: two tints, a knee and a gain. '
      + 'Fit one with v6-cielo/fase2-dev3/21-terza.mjs');
  }
  SKY_UNIFORMS.uSunDir.value.set(...preset.sun.vector).normalize();
  SKY_UNIFORMS.uSkyHorizon.value.set(...ramp.horizon);
  SKY_UNIFORMS.uSkyZenith.value.set(...ramp.zenith);
  SKY_UNIFORMS.uSkyBend.value.set(...rampBend(ramp));
  SKY_UNIFORMS.uSkyExposure.value.set(...preset.exposure);
  SKY_UNIFORMS.uSkyRamp.value.set(
    ramp.knee, ramp.gain, ramp.glow, ramp.glowExponent,
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
// THIS ARITHMETIC HAS AN OFFLINE TWIN AND THE TWIN IS CURRENTLY THE OLD SKY.
// domeRadiance in tools/grade/lib/sky-model.mjs still evaluates the physical
// dome this replaced, and that matters rather than being tidy: the cloud bake
// SUBTRACTS what the twin returns and this ADDS BACK what this returns, so a
// difference between them lands in the frame as a halo round every piece of
// weather. tools/grade/check-dome.mjs measures the two against each other on the
// running page for exactly that reason and fails past a thousandth, and
// tools/lighting/bake-environment.mjs integrates the twin to get the irradiance
// the world is lit by.
//
// That file is not this session's to write, so the twin is not moved here. What
// the ramp needs of it is eight lines, and they are already written and used
// against the targets in v6-cielo/fase2/lib-rampa.mjs.
export const SKY_GLSL = /* glsl */`
  uniform vec3 uSunDir;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyBend;
  uniform vec3 uSkyExposure;
  uniform vec4 uSkyRamp;
  uniform vec3 uSunDisc;

  // How high a direction is, as the ramp measures height.
  //
  // The sine of the elevation is the vertical component of a unit direction, so
  // it arrives free and no arcsine is taken: the ramp is stated in that
  // variable rather than in degrees for exactly that reason.
  //
  // BELOW THE HORIZON THE MIX IS HELD AT NOUGHT, AND THAT JOIN IS SMOOTH RATHER
  // THAN CLAMPED. A clamp is what drew a line across the equator of the old
  // sky: the value matched across the join and the slope did not, and a slope
  // that changes in one row is a crease the eye finds immediately — on the one
  // row a walker looking straight ahead has in the middle of the frame. Here the
  // mix leaves the horizon through a power well above one, so its slope there is
  // nought already and meeting a constant costs nothing.
  //
  // The gain bends the ramp between its ends without moving either of them,
  // which is the one degree of freedom a straight mix of two tints has not got,
  // and it is what lets the twelve degrees the targets show be fitted without
  // the sky above them going black.
  float skyMix(float sinElevation) {
    float y = clamp(sinElevation, 0.0, 1.0);
    float s = 1.0 - pow(1.0 - y, uSkyRamp.x);
    return ((1.0 + uSkyRamp.y) * s) / (1.0 + uSkyRamp.y * s);
  }

  // The sky, and the sun standing in it.
  //
  // The sharpness is how much of the sun survives, and it is the analytic
  // equivalent of a level of a texture: one for a mirror and the dome, less for
  // a surface that scatters what it reflects. The RAMP does not blur — it is
  // smooth already, and a mix over elevation has no detail a rough face could
  // lose — so the sharpness reaches only the two things that are narrow: it
  // shortens the aureole's lobe, and it spreads the disc while taking its
  // radiance down by the same factor its solid angle goes up by, which is what a
  // coarser level does and is why a rough face shows the light of a sun rather
  // than a sun.
  vec3 skyDome(vec3 direction, float sharpness) {
    vec3 d = normalize(direction);

    // THE THIRD ANCHOR IS THIS ONE TERM (E-V6i). The preset may state a middle
    // tint and the height it sits at; what arrives here is uSkyBend, the single
    // vector that bends the segment through it, worked out once on the way in.
    // At nought — no middle anchor, or a middle anchor that lies on its own
    // segment — this is the two-tint ramp bit for bit, which is what makes the
    // client's veto on the third tint a one-line retreat rather than a rebuild.
    float m = skyMix(d.y);
    vec3 base = mix(uSkyHorizon, uSkyZenith, m) + uSkyBend * (m * (1.0 - m));

    float c = dot(d, uSunDir);
    float forward = max(0.0, c);

    // The aureole, re-based on the ramp: a lobe ADDED to the sky rather than a
    // correction to a phase function that no longer exists. Its level is the
    // excess the retired physical dome put eight degrees from the sun, so the
    // sky still whitens towards the sun by what was measured there.
    //
    // Blurring it SHORTENS IT AND DIMS IT TOGETHER. A lobe of cos^n integrates
    // to 2*pi/(n+1) over the hemisphere, so spreading one without taking its
    // peak down multiplies the light it carries by the factor it was widened by
    // — at the roughness the stone asks for that is sixty times, and what it
    // drew was every rock and every giant in the world washed to a pale slab
    // against the sky. A blur moves light about; it does not make any.
    // THE EXPONENT COMES FROM THE PRESET AND NOT FROM THE SOURCE (E-V7i.2). It
    // used to be compiled in as a literal off the DAY entry, which meant a
    // night asking for a different lobe was quietly handed the day's while the
    // offline model honoured what the file said — the frame and its twin
    // disagreeing about the sky. It is free as a uniform: the exponent already
    // reached pow() as a variable, because the sharpness multiplies it.
    float glowN = uSkyRamp.w;
    float peak = glowN * sharpness;
    float glow = uSkyRamp.z * ((peak + 1.0) / (glowN + 1.0)) * pow(forward, peak);

    float spread = inversesqrt(max(1e-4, sharpness));
    float gamma = degrees(acos(clamp(c, -1.0, 1.0)));
    float edge = uSunDisc.x * spread;
    float soft = uSunDisc.y * spread;
    float disc = (1.0 - smoothstep(edge - soft, edge + soft, gamma))
      * uSunDisc.z * sharpness;

    // The disc is scaled by the MEAN of the three exposures rather than by each
    // of them, so nothing here gives the sun a colour of its own. Per channel it
    // came out blue: the exposure carries the picture's white balance, and a
    // beam carrying that balance is a beam a third as red as it is blue — which
    // the tone curve hides on the disc, where everything saturates to white, and
    // does not hide in the bloom, where the halo is a linear copy of it.
    //
    // WHAT IS GONE WITH THE PHYSICS: the disc used to be multiplied by the air's
    // own extinction, so it reddened by itself as a preset put the sun lower.
    // Nothing does that now — a preset that wants a low sun has to say what
    // colour it is, in its own numbers, through this one door.
    float beam = dot(uSkyExposure, vec3(0.33333333));
    return uSkyExposure * (base + glow) + beam * disc;
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
