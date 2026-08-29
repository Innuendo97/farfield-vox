import { ShaderMaterial, Vector2, Vector3 } from 'three';
import { SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS } from '../../core/sky.js';
import { FACE_LIGHT_GLSL, faceLightUniforms } from '../face-light.js';
import { FOG_GLSL, GROUND_EXPOSURE, fogUniforms } from '../air.js';
import TERRAIN from '../../../assets-src/terrain/terrain.json' with { type: 'json' };

// The material of a cube, and the five things the reference was measured to be
// made of. None of them is a texture and none of them is a byte on the wire.
//
// THE ONE RULE THE BUDGET RESTS ON: nothing that varies per voxel is ever
// stored. The tint, the joint and the lightened arris are rebuilt here out of
// the fragment's own position, and the light is an analytic term on a normal
// that is constant across a face. That is what lets a merged rectangle stand
// for a hundred cubes: if any of them had to be handed over per vertex, the
// merge could not happen and the geometry of the world triples. It is one line
// of shader either way, which is exactly why it needs a guard and not a
// comment.
//
// AND THE LIGHT IS NOT A SECOND OPINION. It goes through bakedLight() — the
// four lines in src/core/sky.js, untouched — with the two terms computed
// instead of read out of an atlas. The consumer is the same, so a night is the
// same pair of uniforms moving and nothing here has to know it happened. What
// changes is only who writes the terms, and that is not this file either: the
// pair comes from src/world/face-light.js, which is the one producer of it in
// the world.

/** The tunables, live, so a sweep costs a redraw and not a rebuild. */
export function voxelSettings() {
  return {
    // The meadow's own colour, flat, in linear light. Flat is not a saving: the
    // reference was measured flat to within three per cent across a face, and a
    // face IS constant under an analytic term on a constant normal — where a
    // baked atlas would carry the texel noise that a four tap reconstruction
    // filter had to exist to fight.
    //
    // SOLVED AGAINST THE TARGET'S OWN DISTRIBUTION, not swept and not chosen.
    // The amendment E-V4e says the target's carpet is more saturated and warmer
    // than ours; measured over cube sized regions with no clustering, on the
    // window the campaign fixed its numbers on, that is
    //
    //   the lit half     target  H 71.6  S 0.820  V 0.429
    //                    render  H 69.0  S 0.529  V 0.409
    //
    // so the WARMTH was already there -- this render was three degrees warmer
    // than the target, not colder -- and the whole of the amendment is CHROMA.
    // The same is true of the shaded half, which is the reading that prices the
    // third channel: 0.906 against 0.677. Both of the target's populations ask
    // for less blue and neither asks for more.
    //
    // THE THREE ARE SOLVED THROUGH THIS FRAME'S OWN CHAIN and the difference,
    // not the value, is what enters: tools/lighting/render-chain.mjs predicts
    // ONE top face while the measurement is a median over a whole window, and on
    // the level the two disagree by a tenth. Quoting the target's absolute value
    // at the model would have darkened the meadow to fix the instrument. So the
    // want is the model's own reading plus what the two pictures differ by --
    // the construction guard-scala's self test already uses.
    //
    // AND THE HUE AND THE LEVEL ARE WALLS, NOT TERMS. This render already lands
    // both within the estimator's own agreement; only the saturation misses. A
    // least squares over all three buys saturation by darkening a meadow whose
    // level is right, and "where the two disagree the target wins" is not "where
    // they agree, spend it".
    //
    // WHERE IT LANDS AND WHAT IT CANNOT REACH. H 70.8, V 0.520, S 0.691 against
    // a want of 0.811: four fifths of the amendment, and the last fifth is not
    // here. With the third channel at nought the chain still puts eleven per cent
    // of blue on the pixel -- AgX's own crosstalk, then the grade -- and at the
    // hue the target also demands, that floor IS the saturation ceiling. That
    // residue is the tone curve's and the grade's; neither is this file's, and
    // the frontier is declared with its measurements rather than closed.
    //
    // AND THE RED CAME DOWN A HUNDREDTH, WHICH IS THE WHOLE OF THE WARMTH.
    // The amendment handed this file a number -- the cube's red is forty per
    // cent warmer than the target's, the blue agreeing to two -- and the number
    // does not reproduce. Read again at the REFITTED poses, over cube sized
    // regions, on the four windows that are meadow in BOTH pictures, and read
    // in the CHANNELS the claim is phrased in rather than through a hue that
    // mixes the red and the blue into one number:
    //
    //     R/G   target 0.854   render 0.864     +1.1%
    //     B/G   target 0.195   render 0.404   +107.5%
    //
    // The red is right and the BLUE is the entry that is out -- and for a green
    // the saturation is one minus B/G almost exactly, so the blue and the
    // saturation gap are the same number, which is the frontier above and not a
    // second finding. The correction that survives is therefore the small one:
    // the red over the green comes down 1.1%, which is 0.282 -> 0.272 through
    // the chain with the LEVEL and the RED held as walls and the blue left where
    // the crosstalk puts it. It is the MEDIAN of the four windows and not their
    // mean, so that no window is overshot: the four disagree by 1.1 / 1.5 / 3.4
    // / 3.4 per cent and all four have the same sign, where the target's own
    // window to window spread is 1.2% and this render's is 0.3%.
    albedo: new Vector3(0.272, 0.452, 0.0),
    // How far the tint of one cube may stand from its neighbour's. This is the
    // sixty per cent of the effect and it costs a hash — the reference has no
    // texture at all on grass, it has a strong voxel to voxel spread of tint,
    // and reading the two as the same thing is what makes people ask for an
    // atlas the picture does not contain.
    //
    // 1.80 IS A CEILING AND NOT A PREFERENCE, AND IT IS THE CEILING OF FOUR
    // READINGS AT ONCE. Swept on the page against the target read the same way,
    // at the shape and the lean this file now ships:
    //
    //     tint    family sd   bottom rung   p90/p10 of a cube   in the middle
    //     target      18.7%          0.36                3.10           37.9%
    //     1.30         7.7%          0.30                5.67           21.1%
    //     1.80         8.9%          0.30                5.20           26.7%
    //     2.00         9.2%          0.29                5.56           25.1%
    //     2.40        10.5%          0.26                6.68           24.4%
    //
    // 1.80 is the last row where every column moves the right way together. Past
    // it the family sd keeps rising and NOTHING ELSE DOES: the k-means has
    // stopped cutting by orientation and started cutting by brightness, the
    // bottom rung goes with it, and the spread a cube actually has against its
    // neighbours -- which is read off the target directly and not through any
    // clustering -- turns round and runs away. Every point of sd past here is
    // bought from the ladder.
    //
    // AND THE 18.7% IS NOT REACHABLE BY A WIDER DRAW AT ALL, which is the part
    // worth writing down rather than discovering again. The target's brightest
    // family is 95 faces out of 944; ours is about 230 out of 615. The target has
    // a bright MINORITY with a wide spread inside it, and a draw that is
    // symmetric about its middle cannot make a minority however wide it is made.
    // That is a statement about the SHAPE of the population and not its width,
    // and the setting below moves the shape the other way -- toward the middle,
    // which is what the chequer needed. A bright tail is a third thing, and it is
    // not in this file yet.
    tint: 1.80,
    // THE SHAPE OF THE DRAW, WHICH IS THE HALF NOBODY HAD SWEPT.
    //
    // Every number above moves the WIDTH of the tint and none of them moves its
    // DENSITY, and the target's own reading says the density is the thing: 37.9%
    // of its cube sized regions sit inside half a standard deviation of the mean,
    // where a UNIFORM draw puts 29% there and this render measured 32.7%. That
    // column is the whole of what "reads as a chequer and not as a meadow" means
    // once it is a number both pictures can be asked for -- a uniform draw has as
    // many cubes at its extremes as at its centre, and a meadow has a middle.
    //
    // Nought is the uniform draw, bit for bit: the term below reduces to the
    // shipped one and this setting can be swept from a delivery without changing
    // what a delivery is. One is the same range and the same two ends with the
    // mass pulled to the middle.
    //
    // A BLEND AND NOT A POWER, because a power is a log and an exponent in every
    // fragment of the meadow to buy a shape a single multiply already reaches.
    // The file's other two shape knobs are blends for the same reason.
    //
    // ONE, MEASURED AND NOT PREFERRED. Swept in the browser at the four settings
    // and read at the window the campaign judges on, against the target read the
    // same way, it moves every column of that statistic the right way at once:
    //
    //                          p90/p10   sd/mean   in the middle
    //     the day target          3.10     40.5%          37.9%
    //     tintShape 0             5.77     54.5%          27.6%
    //     tintShape 1             4.65     48.7%          29.2%
    //
    // and at picco-85, where a cube is 67 px and the residue was first seen, it
    // takes the last column from 31.9% to 37.1%. It costs three tenths of a per
    // cent of the estimator's own family sd and pays for it in the joint, the
    // arris ratio and the bottom rung, all three of which improve.
    tintShape: 1.0,
    // A little of that spread in hue as well as in level, because a meadow
    // varies in both and a pure luminance jitter reads as dirt on one colour.
    hue: 0.22,
    // What a joint takes out of the face beside it, and how wide it is allowed
    // to be ON SCREEN. The reference's joint is six per cent over one or two
    // pixels — a LINE, not a well — so the width is held in pixels and the
    // whole term lets go once a cube is too small to have an inside.
    // AND THE WIDTH IS AT ITS FLOOR ALREADY, swept rather than assumed. The
    // recipe's own entry says this joint reads one pixel wider than the target's,
    // so 1.1 was tried: the frame changes and the estimator's reading does not
    // move at all -- 0.953 deep and 3 px wide on both, to three decimals, at
    // every window. What sets the width at this range is the metre cap two lines
    // below in the shader and the estimator's own edge finding, not this number.
    // It is left where it was fitted because moving it buys nothing measurable.
    joint: 0.06,
    jointPixels: 1.6,
    // The lightened upper arris, which is the strongest single signal in the
    // reference. It is not a paler colour: it is a facet leaning up, so it is
    // lit as one — which is where its brightness AND its blue both come from,
    // with nothing fitted to make them agree.
    arris: 1.0,
    arrisPixels: 2.2,
    // How far the facet leans, nought for none and one for halfway to level.
    //
    // 0.33, SWEPT ON THE PAGE AND CONFIRMED TWICE. The recipe wants a lift of
    // 1.09x and this arris was delivering 1.16x: too strong, and the lean is what
    // decides how much of the leaning facet's light is mixed in. Read against the
    // target on three windows at once it is the only setting that improves all
    // three -- 1.13 / 1.12 / 1.10 against the shipped 1.16 / 1.15 / 1.14, where
    // the target reads 1.09 on every one of them.
    //
    // AND ITS BLUE IS NOT A KNOB, which is worth writing down because it looks
    // like one. Solved offline over the whole grid of lean and blend, the lift's
    // blue over red never leaves the band 0.91 to 1.05: it is the colour of the
    // sky against the colour of the sun, and the two settings decide only how
    // MUCH of it there is. What actually moved that reading onto the target was
    // the pigment -- at the solved albedo the estimator reads B/R 0.43 against
    // the target's 0.43, where the old pigment read 0.68.
    arrisLean: 0.33,
    // THE TWO KNOBS THAT ARE NOT THE VOXEL'S. They are still reachable from
    // here, because a sweep on the page is what they exist for; what they MEAN,
    // and why a delivery ships them at one, is stated once over NEUTRAL_LIFT in
    // src/world/face-light.js, which is also where they are applied.
    sunLift: 1,
    skyLift: 1,
  };
}

// Two decorrelated draws from three whole numbers, without a transcendental.
//
// The same shape as the pair the dome and the weather dither with, and for the
// same reason: a sine of a coordinate tens of thousands of radians in spends
// its whole cost on range reduction. What is hashed is the voxel's own integer
// cell, so a cube keeps its tint however the eye moves and two chunks meeting
// cannot draw a seam.
const HASH_GLSL = /* glsl */`
  vec2 cellHash(vec3 cell) {
    vec3 p = fract(cell * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract(vec2((p.x + p.y) * p.z, (p.y + p.z) * p.x));
  }
`;

const VERTEX = /* glsl */`
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDistance;
  varying vec2 vChunk;

  uniform float uVoxel;

  void main() {
    // The position stays in the chunk's own frame all the way to the fragment,
    // which is what keeps the arithmetic that rebuilds a cube inside a few
    // metres instead of a few hundred. Where the chunk stands comes off the
    // model matrix — a whole number of voxels by construction — so it is one
    // draw's constant rather than a second attribute, and it interpolates to
    // itself exactly because it is the same at all four corners.
    vLocal = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vChunk = floor(modelMatrix[3].xz / uVoxel + 0.5);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vDistance = length(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */`
  precision highp float;

  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDistance;
  varying vec2 vChunk;

  uniform float uVoxel;
  uniform vec3 uAlbedo;
  uniform float uTint;
  uniform float uTintShape;
  uniform float uHue;
  uniform float uJoint;
  uniform float uJointPixels;
  uniform float uArris;
  uniform float uArrisPixels;
  uniform float uArrisLean;

  ${SCENE_LIGHT_GLSL}
  ${FACE_LIGHT_GLSL}
  ${HASH_GLSL}
  ${FOG_GLSL}

  void main() {
    vec3 n = normalize(vNormal);

    // WHICH CUBE THIS IS. Half a step back along the normal, so a face lands
    // inside the solid it belongs to instead of on the boundary between two —
    // on the boundary the floor below would flicker between neighbours and the
    // tint of a whole wall would crawl as the eye moved.
    vec3 p = vLocal - n * (uVoxel * 0.5);
    vec3 cell = floor(p / uVoxel) + vec3(vChunk.x, 0.0, vChunk.y);

    // How much ground one pixel covers here. Taken off the smooth position and
    // not off anything wrapped: the derivative of a fract is a cliff at every
    // boundary, and a width built on one would draw a bright ring round every
    // cube it was meant to shade.
    float pixel = max(length(fwidth(p)), 1e-6);
    // And how many pixels a whole cube is worth, which is the one number that
    // says whether an inside exists to draw at all.
    float onScreen = uVoxel / pixel;

    // ------------------------------------------------------------ the tint
    vec2 draw = cellHash(cell);
    // THE WIDTH AND THE SHAPE, and they are two things. The draw is uniform, so
    // as many cubes land at its extremes as at its centre unless it is bent:
    // multiplying by its own distance from the middle keeps both ends and the
    // range and moves the mass inward. At uTintShape nought this is the bare
    // draw, exactly, which is what lets the setting be swept against a delivery.
    float spread = draw.x - 0.5;
    spread *= mix(1.0, abs(2.0 * spread), uTintShape);
    float tint = 1.0 + uTint * spread;
    // A little of it in hue: green against the two either side of it, which is
    // the axis a meadow actually varies along.
    vec3 shift = vec3(1.0 - uHue * (draw.y - 0.5), 1.0 + uHue * (draw.y - 0.5),
                      1.0 - uHue * (draw.y - 0.5));
    vec3 albedo = uAlbedo * tint * shift;

    // ------------------------------------------ where in the face we stand
    // Distance from the middle of the cube along each axis, with the axis the
    // face looks along taken out of the running: a face has two dimensions and
    // the third would always win.
    vec3 middle = abs(fract(p / uVoxel) - 0.5);
    vec3 across = mix(middle, vec3(0.5), abs(n));
    float border = (0.5 - max(across.x, max(across.y, across.z))) * uVoxel;

    // ----------------------------------------------------------- the joint
    // A LINE AND NOT A WELL, and that is a saving as well as a fidelity: the
    // reference has six per cent over one or two pixels and no broad ambient
    // darkening anywhere, so a screen space occlusion or a wide baked one would
    // be wrong AND dear. Here the more faithful thing is the cheaper one.
    //
    // Held in pixels so it stays a line at every distance, capped in metres so
    // it can never eat the face, and let go once a cube is under a few pixels —
    // past that there is no inside left for a joint to be the edge of, and
    // keeping it would darken the whole meadow as it receded.
    float width = min(uJointPixels * pixel, uVoxel * 0.14);
    float joint = 1.0 - uJoint * (1.0 - smoothstep(0.0, width, border))
      * smoothstep(2.5, 5.0, onScreen);
    albedo *= joint;

    // ----------------------------------------------------------- the light
    vec3 light = faceLight(n);

    // ------------------------------------------------- the lightened arris
    // The single strongest signal in the reference, and it is done as what it
    // is: the top edge of a cube is not painted paler, it is a facet leaning up
    // — so it is handed the light of a facet leaning up. Its brightness and its
    // blue both fall out of that, with nothing fitted to make the two agree,
    // which is the whole reason it is built this way and not as a colour.
    //
    // Only on the flanks. On a top face there is no upper edge to catch.
    float up = fract(p.y / uVoxel);
    float band = min(uArrisPixels * pixel, uVoxel * 0.30) / uVoxel;
    float arris = smoothstep(1.0 - band, 1.0, up)
      * (1.0 - abs(n.y)) * uArris * smoothstep(2.5, 5.0, onScreen);
    if (arris > 0.0) {
      vec3 leaning = normalize(mix(n, normalize(n + vec3(0.0, 1.0, 0.0)), uArrisLean));
      light = mix(light, faceLight(leaning), arris);
    }

    vec3 colour = albedo * light;
    colour = mix(colour, uFogColour, fogAmount(vDistance, vWorld.y));
    gl_FragColor = vec4(colour, 1.0);
  }
`;

/**
 * The meadow's material, shared by every chunk.
 *
 * ONE material for the whole disc and not one per chunk, which is what keeps
 * the disc a run of draws through a single program instead of a program switch
 * a chunk. Where each chunk stands is already in its own model matrix, so
 * nothing per chunk has to be a uniform.
 *
 * @param {number} voxel the step, in metres
 * @param {object} settings from voxelSettings(), held by reference so a sweep
 *                          on the page moves the frame without a rebuild
 */
export function voxelMaterial(voxel, settings) {
  const material = new ShaderMaterial({
    uniforms: {
      uVoxel: { value: voxel },
      uAlbedo: { value: settings.albedo },
      uTint: { value: settings.tint },
      uTintShape: { value: settings.tintShape },
      uHue: { value: settings.hue },
      uJoint: { value: settings.joint },
      uJointPixels: { value: settings.jointPixels },
      uArris: { value: settings.arris },
      uArrisPixels: { value: settings.arrisPixels },
      uArrisLean: { value: settings.arrisLean },
      // The sun, the exposure and the two lifts, from the one seat that
      // produces the pair they act on. Shared by reference with the rest of the
      // world, as are the light colours and the air below: a copy here would be
      // a second answer to where the sun is, which is the defect this campaign
      // spent a session removing.
      ...faceLightUniforms(TERRAIN.lightScale * GROUND_EXPOSURE,
        [settings.sunLift, settings.skyLift]),
      ...SCENE_LIGHT_UNIFORMS,
      ...fogUniforms(),
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: false,
  });

  material.userData.refresh = () => {
    const u = material.uniforms;
    u.uAlbedo.value.copy(settings.albedo);
    u.uTint.value = settings.tint;
    u.uTintShape.value = settings.tintShape;
    u.uHue.value = settings.hue;
    u.uJoint.value = settings.joint;
    u.uJointPixels.value = settings.jointPixels;
    u.uArris.value = settings.arris;
    u.uArrisPixels.value = settings.arrisPixels;
    u.uArrisLean.value = settings.arrisLean;
    u.uLift.value.set(settings.sunLift, settings.skyLift);
  };

  return material;
}
