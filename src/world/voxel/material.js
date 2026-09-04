import {
  ClampToEdgeWrapping, RepeatWrapping, ShaderMaterial, Vector2, Vector3, Vector4,
} from 'three';
import { SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS } from '../../core/sky.js';
import { FACE_LIGHT_GLSL, faceLightUniforms } from '../face-light.js';
import { FOG_GLSL, GROUND_EXPOSURE, fogUniforms } from '../air.js';
import TERRAIN from '../../../assets-src/terrain/terrain.json' with { type: 'json' };
import { PATH_LINE } from '../terrain-field.js';
// THE PIGMENT'S OWN SEAT, AND IT IS A FILE OF ITS OWN FOR ONE REASON: the
// offline chain has to be able to ask what colour a cube is without a browser.
// While the pigment was a single albedo, render-chain.mjs lifted the triple out
// of this file's text with a regular expression and went on; the moment it
// became a FIELD -- a colour that depends on where the cube stands -- that
// stopped working, and with it the only offline reading of the meadow's colour.
// src/world/voxel/pigment.js holds the field as a pure function AND the shader
// that reproduces it, side by side, so the two cannot drift apart unseen.
import {
  ALBEDO, PIGMENT, PIGMENT_GLSL, pigmentUniforms, refreshPigment,
} from './pigment.js';
// THE PAVING'S LAW, READ AND NOT COPIED. src/world/path.js is where the corridor
// IS -- the lattice, the joints, the pigment, the small stones -- and it holds
// none of three, the sky or the air on purpose, so the painter that bakes the
// three maps and the frame that reads them can never disagree about a number.
// What this file adds is the seat those numbers are painted from.
import {
  APRON, GRAIN, GRAIN_GAIN, GRAIN_FADE, JOINT_DARK, JOINT_FADE, JOINT_LIP,
  JOINT_SOFT, PATH_SKIN, PEB_EDGE, PEB_LEVEL, PEB_MIX, SKIN_REACH, TUNING,
  EARTH as PATH_EARTH, STONE as PATH_STONE, STONE_PALE as PATH_STONE_PALE,
} from '../path.js';

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
    // THE MEADOW'S OWN COLOUR, in linear light, and it is the one entry of this
    // pigment that DID NOT move.
    //
    // The research measured both pictures for it and they agree: the grass of
    // the target reads hue 116 degrees and chroma 39.0, ours 117 and 39.0. What
    // was wrong with this meadow was never the colour -- it was the SHAPE of the
    // draw the colour was multiplied by, and that is what the field below is.
    //
    // The triple itself was solved THROUGH this frame's own chain and the
    // difference, not the value, is what entered: tools/lighting/render-chain.mjs
    // predicts one top face while a measurement is a median over a window, and
    // on the level the two disagree by a tenth, so quoting the target's absolute
    // value at the model would have darkened a meadow whose level is right. The
    // last correction it took was the red over the green coming down 1.1% --
    // 0.282 to 0.272 -- as the median of the four windows that are meadow in
    // BOTH pictures. Its own note is in src/world/voxel/pigment.js, beside the
    // arithmetic, so the value and the field that rides it cannot part company.
    //
    // WHAT THIS ALBEDO CANNOT REACH, still declared rather than closed: with the
    // third channel at nought the chain still puts eleven per cent of blue on
    // the pixel -- AgX's own crosstalk, then the grade -- and at the hue the
    // target also asks for, that floor IS the saturation ceiling. The frontier
    // is E-V1c.2's and it is parked at the light's own window, not here.
    albedo: new Vector3(...ALBEDO.meadow),
    // ------------------------------------------------------------------------
    // THE FIELD, AND WHY THE DRAW IT REPLACES WAS THE WHOLE OF THE COMPLAINT.
    //
    // What shipped drew a tint PER CUBE out of an uncorrelated hash at full
    // width. Read on the picture, the multiplier between the palest and the
    // darkest cube of one material under one light covered 0.10 to 6.18 -- SIXTY
    // TWO TO ONE -- drawn independently for every cube, and a second draw per
    // column brightened a twelfth of them again on top of that.
    //
    // The measurement that condemns it is not a matter of taste. Blurring a
    // window of meadow at three cubes and asking how much of the light and dark
    // survives, the target keeps 0.516 of its variance and this meadow kept
    // 0.151 -- against 0.066 for the TARGET WITH ITS OWN CUBES SHUFFLED, which
    // is the absolute floor of having no organisation at all. We were nearer the
    // shuffle than the picture. On the plaque graph the target correlates at
    // Moran +0.310 and we read +0.197; and the semivariogram of our own meadow
    // crosses its sill, which is the signature of ANTI-correlation -- pale, dark,
    // pale, dark. That is the chequerboard, and it is a frequency and not a
    // quantity.
    //
    // AND THE QUANTITY GOES UP, NOT DOWN, WHICH IS THE PART THAT SURPRISES. The
    // target varies between neighbouring cube tops MORE than we do: the ratio
    // between two tops a cube apart is 1.92 at its ninetieth percentile there
    // and 1.40 here. The prescription from the block-world literature -- keep the
    // variation inside a material under the smallest orientation step -- is
    // calibrated on a ladder covering 1.67x. Ours and the target's cover 3.06x.
    // Both of us are already UNDER the target's own ratio of variation to ladder.
    // What is missing is the low frequency.
    //
    // So: two octaves of value noise in the world's own XZ, plus a residue, and
    // a band closed on the result. Nothing is stored per voxel, nothing is read
    // from a texture, no vertex attribute is added and no draw call is: the
    // field is rebuilt in the fragment from the cube's integer cell, which is
    // what lets a merged rectangle go on standing for a hundred cubes. The whole
    // arithmetic, and its twin that runs under plain node, are in
    // src/world/voxel/pigment.js; these are the knobs it takes.
    //
    // THE ZONES, in cubes. Five is half a metre.
    slowCubes: PIGMENT.slowCubes,
    // The octave that keeps two neighbours from agreeing, short enough that a
    // blur at three cubes takes it away again and it does not spend the slow
    // field's own share.
    midCubes: PIGMENT.midCubes,
    // Their three amplitudes, dominant to residue. The last one is the only
    // draw that is still per cube, and it is the smallest of the three.
    slow: PIGMENT.slow,
    mid: PIGMENT.mid,
    grain: PIGMENT.grain,
    // AND THE BAND, WHICH IS A FLOOR BEFORE IT IS A CEILING. The target never
    // lets a face fall below 0.365 of a cube top; this meadow was reaching 0.201,
    // and the pigment owned the stretch from 0.292 to 0.201 of that. Two things
    // close it and only one of them is here: the field is a function of the
    // COLUMN, so a top and the flank under it now share one tint exactly instead
    // of drawing twice, and the band underneath refuses the rest.
    tintFloor: PIGMENT.tintFloor,
    tintCeil: PIGMENT.tintCeil,
    // A little of the spread in hue as well as in level, because a meadow varies
    // in both and a pure luminance jitter reads as dirt on one colour. It rides
    // the SLOW octave, so the colour moves by zones as the level does -- which is
    // the half of the reading the research says the target does NOT move onto
    // tint alone: measured between adjacent plaques of the bright family, 0.455
    // of the target's own difference is colour and 0.545 is level.
    hue: PIGMENT.hue,
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

/**
 * THE SECOND FAMILY: BARE EARTH, and the whole of it is a colour.
 *
 * WHY THERE IS A SECOND SETTINGS OBJECT AND NOT A SECOND SHADER. What separates
 * earth from grass in the targets is the pigment and nothing else: the same
 * cubes, the same joint, the same lightened arris, the same analytic light on
 * the same constant normal. So the earth is this file's own material asked for
 * twice with two albedos -- one program, one extra draw, and every term of the
 * recipe reaching both families by construction rather than by being copied.
 *
 * AND THE COLOUR IS A RESIDUE ON A LOCAL GROUND, NOT AN ABSOLUTE. The target's
 * bare ground reads 121/105/77 where the grass BESIDE IT reads 71.5/86.8/23.0
 * (F.1, 27 925 pixels outside the corridor, v1-suolo/forma/f1/f1.json). Quoting
 * the first triple at this material would be quoting the target's light and the
 * target's grade as well as its earth, and this render's grass does not stand
 * where the target's does. What travels is the RATIO -- the method E-V7i put on
 * the campaign's table -- so it is the ratio that is carried, taken in LINEAR
 * light rather than in the coded values it was read in:
 *
 *              coded            linear          this albedo
 *     red     121 / 71.5        x 3.12          0.272 -> 0.849
 *     green   105 / 86.8        x 1.51          0.452 -> 0.683
 *     blue     77 / 23.0        x 14.3          0.000 -> see below
 *
 * THE BLUE CANNOT BE A RATIO, because the grass's own is nought: the meadow's
 * eleven per cent of blue on the pixel is the tone curve's crosstalk and not an
 * albedo (see the note over `albedo` above). So the earth's blue is taken from
 * the TARGET'S OWN earth, as its blue over its green in linear light -- 0.506 --
 * applied to the green solved on the line above. Bare ground is not a green with
 * more red in it; it is a colour, and this is the one place its third channel
 * can come from.
 *
 * AND THE FIRST VALUE DID NOT SURVIVE ITS OWN RENDER, which is worth writing
 * down rather than quietly correcting. Solved straight off those ratios the
 * albedo comes out at 0.849 / 0.683 / 0.346, and on the frame that produces it
 * the bare family reads 61.8 / 70.0 / 55.4 -- GREENER THAN IT IS RED, where the
 * target's earth reads 1.153 red over green. The cause is not the pigment and
 * is measurable: this family lives ONLY on flanks that face the eye, the sun in
 * this world stands at bearing -9.5 degrees, and a south face therefore takes
 * almost nothing from it and is lit by the sky alone -- which is blue. Chasing
 * the target's warmth from here asks for a red albedo of 1.52, and an albedo
 * over one is the signature of a light being fixed with a pigment.
 *
 * SO THE RED GOES TO THE TOP OF ITS OWN RANGE AND THE REST IS DECLARED. 0.900
 * is as red as a surface may be; the green and the blue come down with it so
 * the level holds and the hue turns. Read on the frame, over the 38 490 pixels
 * this family actually draws:
 *
 *                        red / green    blue / green
 *     solved off ratios      0.883          0.792
 *     this albedo            0.965          0.718
 *     the day target         1.153          0.728
 *
 * The blue arrives. The red closes half of what it was short by and stops,
 * and the rest of it is E-LUCE1's fourth finding -- the third term of
 * face-light.js, 0.259 against the target's 0.362 -- which is FIT 2 of the
 * window and belongs to the coordinator, not here.
 *
 * FIRST VALUE AND NOT A FIT. The pigment pass is D5 and the light's third term
 * is fit 2 of the window; both come AFTER the shape, by the committente's own
 * order of work (E-DECISIONI4). What is here is the honest first reading, with
 * the pixels it was read on named, so that the fit has somewhere to start.
 */
export function earthSettings() {
  return {
    ...voxelSettings(),
    albedo: new Vector3(...ALBEDO.earth),
    // And less of the hue jitter than the meadow carries: what a meadow varies
    // along is green against the two either side of it, and earth does not. The
    // slow field itself is the SAME field, which is the point -- a zone of the
    // world is one zone whichever family is standing in it, and two families
    // that drew their own would put a seam down every bank.
    hue: 0.10,
  };
}

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
  uniform float uJoint;
  uniform float uJointPixels;
  uniform float uArris;
  uniform float uArrisPixels;
  uniform float uArrisLean;

  ${SCENE_LIGHT_GLSL}
  ${FACE_LIGHT_GLSL}
  ${PIGMENT_GLSL}
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

    // ----------------------------------------------------------- the pigment
    // ONE CALL, AND WHAT IT IS NOT ASKED IS THE POINT: the cube's height. The
    // field is a function of the COLUMN, so a top face and the flank under it
    // carry the same tint by construction instead of drawing twice -- which is
    // both how the bright family becomes compact instead of speckled and how
    // the deepest rung goes back to being the orientation ladder alone. The
    // arithmetic is src/world/voxel/pigment.js, and the same file's pure twin
    // answers this call under plain node for the offline chain.
    vec3 albedo = pigmentOf(cell.x, cell.z);

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
      ...pigmentUniforms(settings),
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
    refreshPigment(u, settings);
    u.uJoint.value = settings.joint;
    u.uJointPixels.value = settings.jointPixels;
    u.uArris.value = settings.arris;
    u.uArrisPixels.value = settings.arrisPixels;
    u.uArrisLean.value = settings.arrisLean;
    u.uLift.value.set(settings.sunLift, settings.skyLift);
  };

  return material;
}

// ======================================================================
// THE PAVING: THE MATERIAL OF A CORRIDOR THAT IS COLUMNS.
//
// WHAT MOVED, AND WHAT DID NOT. V3 measured a paving and built it: a lattice of
// slabs with two tunings down the run, a joint of 3.5 cm, a shoulder, fourteen
// small stones to the square metre, a grain inside each piece that carries more
// variation than the difference between one piece and the next, and three maps
// baked from that law by the painter in tools/path/. Every one of those numbers
// SURVIVES, character for character, in src/world/path.js and in the three
// delivered assets. What changed is the surface they are painted ON: a mesh of
// its own laid over a hole in the meadow, and now the top faces of the columns
// the meadow itself lays.
//
// SO THIS FRAGMENT IS V3'S, MOVED. It is the same arithmetic in the same order,
// with three differences and no fourth:
//
//   * the two strip coordinates are SOLVED from the world position instead of
//     arriving as attributes -- the corner of a greedy rectangle is not a vertex
//     of the corridor and has nowhere to carry them, and the centreline is
//     smooth arithmetic with no noise in it, which is what makes the solve exact
//     rather than interpolated;
//   * there is no alpha and no verge fade. The old surface had to let go at its
//     own edge because the meadow was drawn under it; this IS the ground, and
//     what is beside it is a column of grass standing one voxel higher;
//   * and the family carries the WARMTH the reference was measured to have,
//     which is the one number this file adds.
//
// THREE TEXTURE READS A FRAGMENT, AND THEY ARE THE THREE V3 ALREADY PAID. The
// ruler and the level cannot be one texture -- measured with the delivery's own
// encoder, interleaved they cost 1 407 kB against 731 apart -- and the field of
// small stones is over the WORLD rather than along the run, so it could not have
// shared a coordinate with either at any price. What changed is how many
// fragments pay them: the corridor was 3 638 triangles of a surface of its own
// and it is fifty two rectangles of the disc.

/** The paving's tunables, live, so a sweep costs a redraw and not a rebuild. */
export function pavingSettings() {
  return {
    earth: new Vector3(...PATH_EARTH),
    stone: new Vector3(...PATH_STONE),
    stonePale: new Vector3(...PATH_STONE_PALE),
    jointDark: new Vector2(...JOINT_DARK),
    jointLip: new Vector2(...JOINT_LIP),
    jointSoft: JOINT_SOFT,
    skinReach: SKIN_REACH,
    apronWarm: TUNING.apron.warm,
    apron: new Vector2(...APRON),
    jointFade: new Vector2(...JOINT_FADE),
    grainFade: new Vector2(...GRAIN_FADE),
    grainGain: GRAIN_GAIN,
    pebEdge: new Vector2(...PEB_EDGE),
    pebLevel: new Vector2(...PEB_LEVEL),
    pebMix: PEB_MIX,
    // THE BROWN, AND IT IS A MEASUREMENT AND NOT A TASTE.
    //
    // Read on the reference and on this render at the same two distances, over
    // the corridor in both (C 1.5):
    //
    //     mid run (~10 m)   target 137/125/79   R/B 1.73
    //                       render 101/106/106  R/B 0.95
    //     near    (~6 m)    target  95/ 80/51   R/B 1.86
    //                       render  97/ 98/94   R/B 1.03
    //
    // The reference's paving is a warm khaki and ours is a neutral grey. Both
    // readings say the same thing with the same sign, and the mid-run pair is
    // the one the whole frame is judged at, so it is the one that enters.
    //
    // AND IT IS A CHROMATICITY WITH THE LEVEL HELD, exactly as the apron's own
    // warm term is. The two triples are normalised by their own means and
    // divided -- (1.245, 1.082, 0.684) -- and that ratio is divided again by its
    // OWN luminance, so what is left moves the colour and cannot move how bright
    // the stone is. The level was fitted against the meadow beside it (both
    // readings E-V3g is gated on are RATIOS between this surface and that one),
    // and buying a hue by darkening a level that was solved would be answering
    // one measurement in another measurement's currency.
    //
    // AND IT IS SOLVED THROUGH THIS FRAME'S OWN CHAIN, which is the whole
    // difference between a number that is right and a number that is right on
    // paper. The ratio above moves the ALBEDO by 1.82; put through the light,
    // the exposure, the tone curve and the grade it reaches the PIXEL as 1.17,
    // because AgX's crosstalk spends most of it. That is the same frontier the
    // meadow's own saturation hit two chapters ago and it was met the same way
    // there: solve against the target THROUGH the chain, and let the difference
    // rather than the value be what enters.
    //
    // So the direction is the measurement and the amount is fitted on the live
    // frame: the ratio raised to 2.9 and re-normalised by its own luminance
    // again. Swept at the judging pose and read the way C 1.5 reads it, over the
    // corridor at the two distances it names (fondazione/lav/tinta.py):
    //
    //                       mid run          near
    //     albedo x1         R/B 1.171        1.088   <- the reading on paper
    //     albedo x2         R/B 1.442          --
    //     albedo x2.9       R/B 1.719        1.912   <- what ships
    //     the target        R/B 1.730        1.863
    //
    // Fitted on the mid run alone -- the window the whole frame is judged at --
    // and the NEAR window, which nothing was fitted to, lands within 2.6% of its
    // own target. Two readings from one number is what says the direction was
    // the right one.
    //
    // AND THE INSTRUMENT IS VALIDATED BEFORE IT IS BELIEVED: read on the frame
    // this world shipped before the fit, the same bench answers R/B 0.921 where
    // C 1.5 measured 0.95, which is three per cent.
    //
    // THE LEVEL IS A WALL AND IT IS NOT REACHED. The target's paving is brighter
    // as well as warmer -- 137/125/79 against the 119/107/69 this lands -- and
    // that difference is NOT taken, because the level of this stone was fitted
    // against the meadow beside it and both readings E-V3g is gated on are
    // ratios between the two. Buying a level here would move a gate without
    // moving anything anybody asked for.
    //
    // WHAT IT IS NOT. It is not the texture, and the texture is the other half
    // of the same finding: the reference carries 3.20% of grain inside a face
    // where this render carries 1.18%, which is a question of contrast, of the
    // size of a slab and of the pitch of three maps. That half is phase C's and
    // it is NOT attempted here -- what is here is the one part of the reading
    // that is a pigment.
    warmth: new Vector3(1.4256, 0.9491, 0.2511),
  };
}

const PAVING_FRAGMENT = /* glsl */`
  precision highp float;

  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDistance;
  varying vec2 vChunk;

  uniform sampler2D tJoint;
  uniform sampler2D tTone;
  uniform sampler2D tGrain;
  uniform vec3 uEarth;
  uniform vec3 uStone;
  uniform vec3 uStonePale;
  uniform vec3 uWarmth;
  uniform vec2 uJointDark;
  uniform vec2 uJointLip;
  uniform float uJointSoft;
  uniform float uSkinReach;
  uniform float uApronWarm;
  uniform vec2 uApron;
  uniform vec2 uJointFade;
  uniform vec2 uGrainFade;
  uniform float uGrainGain;
  uniform vec2 uPebEdge;
  uniform vec2 uPebLevel;
  uniform float uPebMix;
  uniform vec4 uLine;
  uniform vec2 uSkinZ;
  uniform float uSkinHalf;

  ${SCENE_LIGHT_GLSL}
  ${FACE_LIGHT_GLSL}
  ${FOG_GLSL}

  void main() {
    // WHERE THIS POINT FALLS ON THE STRIP, solved and not carried. It is
    // pathCentreX out of src/world/terrain-field.js and pathSkinUv out of
    // src/world/path.js, mirrored: a smoothstep between two northings for the
    // line, then the offset from it over the strip's own width. Built on the
    // CENTRELINE and on nothing else, which is the seed's own rule and the
    // reason it holds -- pathCoord divides by an edge with a noise in it, and a
    // frame that used it would breathe with the wobble and swim the paving
    // along the run.
    float t = clamp((vWorld.z - uLine.x) / (uLine.y - uLine.x), 0.0, 1.0);
    float centre = uLine.z + (uLine.w - uLine.z) * (t * t * (3.0 - 2.0 * t));
    vec2 skin = vec2((vWorld.x - centre) / (2.0 * uSkinHalf) + 0.5,
      (vWorld.z - uSkinZ.x) / (uSkinZ.y - uSkinZ.x));

    // TWO FETCHES OFF ONE COORDINATE, and they are two textures because they
    // want two pitches. The first is how deep inside the nearest slot this point
    // stands: a RULER and not a picture, because eight bits of distance
    // interpolate to a POSITION, so the edge of the joint lands where the
    // interpolation puts it and not where a texel does. The second is the level
    // of the piece under the point, piecewise constant on pieces a hand across,
    // which needs a quarter of the pitch to say so.
    float depth = texture2D(tJoint, skin).r * uSkinReach;
    float tone = texture2D(tTone, skin).r;

    float apron = smoothstep(uApron.x, uApron.y, vWorld.z);

    // THE PIGMENT. One ramp, earth to pale stone, walked by the piece's tone.
    // Below the knee it is the soil between and over the pieces and above it the
    // slab, and the crossing is the eroded lip where the two meet.
    vec3 albedo = tone < 0.5
      ? mix(uEarth, uStone, tone * 2.0)
      : mix(uStone, uStonePale, (tone - 0.5) * 2.0);

    // The warm of the apron: a chromaticity and not a level, +0.135 of
    // (r-b)/(r+b) measured inside one band of the frame, where the picture's own
    // corner shading divides out.
    float warm = uApronWarm * apron;
    albedo *= vec3(1.0 + warm, 1.0, 1.0 - warm);
    // And the family's own, which is the reference's brown. See pavingSettings.
    albedo *= uWarmth;

    // The small stones and the grain, from a tile repeated over the WORLD and
    // turned, because 2.8 cm written into a strip 8 mm a texel comes back a
    // stroke down the run. The turn is what costs the repeat its period along
    // the walk.
    vec2 turned = vec2(
      vWorld.x * ${Math.cos(GRAIN.turn * Math.PI / 180).toFixed(6)}
    + vWorld.z * ${Math.sin(GRAIN.turn * Math.PI / 180).toFixed(6)},
      vWorld.z * ${Math.cos(GRAIN.turn * Math.PI / 180).toFixed(6)}
    - vWorld.x * ${Math.sin(GRAIN.turn * Math.PI / 180).toFixed(6)});
    vec2 grain = texture2D(tGrain,
      turned * ${(1 / GRAIN.metresPerRepeat).toFixed(6)}).rg;
    float near = 1.0 - smoothstep(uGrainFade.x, uGrainFade.y, vDistance);

    // The grain of the stone itself, which has mean a half by construction, so
    // it adds material without moving the level -- and the level is the fitted
    // pigment. The reference wants more variation inside a piece than between
    // one piece and the next: the spread between slabs is 0.78 of the spread
    // within one.
    albedo *= 1.0 + near * uGrainGain * (grain.g - 0.5);

    // The stone lying on the ground, drawn from its own field so its rim is as
    // round as the frame likes rather than as round as the tile is.
    float inStone = smoothstep(uPebEdge.x, uPebEdge.y, grain.r) * near * uPebMix;
    albedo = mix(albedo, uStonePale * (uPebLevel.x + uPebLevel.y * grain.g), inStone);

    // THE SLOT, ACROSS ITS OWN WIDTH. The depth is nought over all the stone and
    // grows into the joint, so this needs no width of its own: where the joint
    // ENDS is where the depth returns to nought, which is the paving's answer
    // and not the frame's.
    float far = 1.0 - smoothstep(uJointFade.x, uJointFade.y, vDistance);
    float inSlot = smoothstep(0.0, uJointSoft, depth) * far;
    float trough = smoothstep(uJointLip.x, uJointLip.y, depth);
    albedo *= 1.0 - inSlot * (uJointDark.x + (uJointDark.y - uJointDark.x) * trough);

    // THE LIGHT, AND THERE IS NO ATLAS IN IT. The same two terms of a flat face
    // the meadow beside it is lit by, from the one producer of them in
    // src/world/face-light.js, on this face's own normal.
    vec3 light = faceLight(normalize(vNormal));

    vec3 colour = albedo * light;
    colour = mix(colour, uFogColour, fogAmount(vDistance, vWorld.y));
    gl_FragColor = vec4(colour, 1.0);
  }
`;

/**
 * The paving's material, one for the whole corridor.
 *
 * @param {number} voxel the step, in metres
 * @param {object} settings from pavingSettings(), held by reference
 * @param {object} maps the three the painter baked: joint, tone, grain
 */
export function pavingMaterial(voxel, settings, maps) {
  for (const map of [maps.joint, maps.tone]) {
    // CLAMPED, and it is not a formality: these do NOT repeat. They are laid
    // once along the run, so a wrap would fetch the far end of the paving for
    // ground just off the near end of it.
    map.wrapS = ClampToEdgeWrapping;
    map.wrapT = ClampToEdgeWrapping;
    // FOUR. What anisotropy buys is resolution along the long axis of a
    // footprint, and these textures' long axis is the run.
    map.anisotropy = 4;
    map.needsUpdate = true;
  }
  // EIGHT for the tile: where this is alive the paving is seen close to and
  // steeply foreshortened, so a pixel covers a few millimetres across the frame
  // and several times that down it.
  maps.grain.wrapS = RepeatWrapping;
  maps.grain.wrapT = RepeatWrapping;
  maps.grain.anisotropy = 8;
  maps.grain.needsUpdate = true;

  const material = new ShaderMaterial({
    uniforms: {
      uVoxel: { value: voxel },
      tJoint: { value: maps.joint },
      tTone: { value: maps.tone },
      tGrain: { value: maps.grain },
      uEarth: { value: settings.earth },
      uStone: { value: settings.stone },
      uStonePale: { value: settings.stonePale },
      uWarmth: { value: settings.warmth },
      uJointDark: { value: settings.jointDark },
      uJointLip: { value: settings.jointLip },
      uJointSoft: { value: settings.jointSoft },
      uSkinReach: { value: settings.skinReach },
      uApronWarm: { value: settings.apronWarm },
      uApron: { value: settings.apron },
      uJointFade: { value: settings.jointFade },
      uGrainFade: { value: settings.grainFade },
      uGrainGain: { value: settings.grainGain },
      uPebEdge: { value: settings.pebEdge },
      uPebLevel: { value: settings.pebLevel },
      uPebMix: { value: settings.pebMix },
      // The centreline and the strip's own frame, so the fragment can solve
      // what the old surface carried in two attributes.
      uLine: {
        value: new Vector4(PATH_LINE.stairZ, PATH_LINE.nearZ,
          PATH_LINE.stairX, PATH_LINE.nearX),
      },
      uSkinZ: { value: new Vector2(PATH_SKIN.z0, PATH_SKIN.z1) },
      uSkinHalf: { value: PATH_SKIN.half },
      // THE EXPOSURE IS THE GROUND'S, TO THE FACTOR, and it is not a copy of a
      // taste. The corridor stands in the ground's air and is read against the
      // grass beside it: the two readings this material is gated on -- stone
      // against grass, 1.70 near and 3.41 far -- are RATIOS between this surface
      // and that one, so a second exposure here would move them both without
      // moving anything anybody can see.
      ...faceLightUniforms(TERRAIN.lightScale * GROUND_EXPOSURE),
      ...SCENE_LIGHT_UNIFORMS,
      ...fogUniforms(),
    },
    vertexShader: VERTEX,
    fragmentShader: PAVING_FRAGMENT,
    fog: false,
  });

  material.userData.refresh = () => {
    const u = material.uniforms;
    u.uEarth.value.copy(settings.earth);
    u.uStone.value.copy(settings.stone);
    u.uStonePale.value.copy(settings.stonePale);
    u.uWarmth.value.copy(settings.warmth);
    u.uGrainGain.value = settings.grainGain;
    u.uApronWarm.value = settings.apronWarm;
  };

  return material;
}
