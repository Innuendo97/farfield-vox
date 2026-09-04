import {
  ClampToEdgeWrapping, RepeatWrapping, ShaderMaterial, Vector2, Vector3, Vector4,
} from 'three';
import { SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS } from '../../core/sky.js';
import { FACE_LIGHT_GLSL, faceLightUniforms } from '../face-light.js';
import { FOG_GLSL, GROUND_EXPOSURE, fogUniforms } from '../air.js';
import TERRAIN from '../../../assets-src/terrain/terrain.json' with { type: 'json' };
import { PATH_LINE } from '../terrain-field.js';
import { VOXEL } from './columns.js';
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
  JOINT_SOFT, PATH_SKIN, PEB_EDGE, PEB_LEVEL, PEB_MIX, RELIEF, SKIN_REACH, TUNING,
  EARTH as PATH_EARTH, STONE as PATH_STONE, STONE_PALE as PATH_STONE_PALE,
} from '../path.js';
// THE GRAIN INSIDE A FACE, AND ITS SEAT IS A FILE OF ITS OWN because three
// materials read it -- the meadow, the bare earth and the corridor -- and a
// face coordinate spelled out three times is three chances for two families to
// disagree about where the middle of a face is. src/world/voxel/sheet.js holds
// the array, the coordinate and the one line of arithmetic that puts them
// together, and it holds the analytic sheen beside them, off, for the stone
// that is not this unit's to light.
import {
  FAMILY_LAYERS, LAYER, PAVING_SHEET_METRES, SHEEN_GLSL, SHEET_GLSL, STONE_SHINE,
  sheetArray, sheetUniforms,
} from './sheet.js';

// The material of a cube, and the six things the reference was measured to be
// made of. Five of them are arithmetic and none of those is a byte on the wire;
// the sixth is one sheet of sixteen grey texels a face, which is 1 247 bytes
// delivered for the whole world and one texture read a fragment.
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

// HOW MUCH OF ITS OWN HEMISPHERE THE MAT GIVES BACK TO ITS FLANKS, as one
// literal, so the sweep that fitted it and the guard that holds it read the same
// character. See bladeSettings() below for what it is and what measured it.
//
// SWEPT ON THE LIVE FRAME, IN ONE RUN OF THE BROWSER, with E-ERBA-A 1.5's own
// instrument -- pairs across the fall that marks a top, two pixels above and
// three below, so the two samples are on one blade under one air with one
// pigment. Four windows from 5 to 15 m, the median of the four
// (fondazione/lav/er-lift.mjs):
//
//     bounce      0.00   0.20   0.32   0.44   0.56      the target
//     flank/top   0.417  0.487  0.523  0.551  0.563     0.617-0.648
//
// AND IT SATURATES, WHICH IS THE PHYSICS AND NOT THE SWEEP RUNNING OUT. A flank
// carries a sky term of exactly a half -- half a hemisphere is what a vertical
// plane sees -- so a bounce of 0.50 is the point where it sees the WHOLE sky and
// the term clamps. Past that the curve buys 0.012 for 0.12 of bounce because it
// is buying nothing: 0.56 would be claiming a vertical face sees more sky than
// there is. 0.44 leaves the flank at 0.94 of a hemisphere, under that ceiling,
// and it is the last value on the table that is still a statement about light.
//
// WHAT IS LEFT IS NOT THIS TERM'S AND IS DECLARED: 0.551 against 0.62 closes
// three fifths of the gap, and the rest is the THIRD TERM of the light --
// E-LUCE1 measured this world's sky weight at 0.259 where the target asks 0.362,
// E-V4g read the same thing as a ladder 3.73x against our 8.51x, and E-TEX1-bis
// read it a third time as an ombra 38% too steep. That is fit 2 of the light's
// own window, it moves the paving and the stone with it, and E-ERBA-A 6.7 puts
// it at step 7 -- «al passo 9 della luce, non prima». Three readings and this
// one point at the same seat, and it is the coordinator's.
export const BLADE_BOUNCE = 0.44;

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
    // ------------------------------------------------------------------------
    // THE GRAIN INSIDE THE FACE, WHICH IS THE ONE THING THIS FRAGMENT HAD NONE
    // OF -- not a little of, none.
    //
    // C 0 measured it on the same window with the same instrument on both
    // pictures: the near meadow carries 1.16% of luminance inside a face on the
    // reference and 0.43% here, the middle distance 2.57 against 1.17. Its map
    // of the detector says the rest without a number -- on the reference it is
    // lit everywhere, on ours only along the seams between cubes, and inside a
    // face it is black. That is not a shortfall of variation: measured over the
    // same window the TOTAL spread is the same on both pictures, 25.7-28.1%
    // there against 28.6-33.5% here. It is variation at the wrong SCALE. Ours
    // is all between the cubes and none of it is inside them, which is exactly
    // the reading the committente gave in his own words.
    //
    // So: a sixteen texel grey square a face, mean a half, multiplying the
    // pigment and not replacing it, out of an array indexed by family and
    // orientation. The whole arithmetic and the whole argument for its shape
    // are in src/world/voxel/sheet.js; these are the knobs it takes.
    //
    // THE ARRAY ITSELF ARRIVES FROM OUTSIDE. It is a delivered asset and this
    // file has no loader; the layer that declares the need hands it over. Left
    // at nought the material builds a neutral array of its own and turns the
    // term off, so a world with no sheet is the world that shipped yesterday
    // rather than a black one.
    sheet: null,
    // WHICH SLICE A TOP FACE AND A FLANK READ.
    sheetLayers: new Vector2(...FAMILY_LAYERS.meadow),
    // AND HOW MUCH EACH IS WORTH, WHICH IS THE FITTED NUMBER.
    //
    // It is fitted on OUR frame through OUR chain and not computed from the
    // reference's per cent, for the reason this campaign has now paid for
    // twice: a per cent read off a photograph has the reference's light, its
    // exposure and its tone curve in it, and the same modulation of an albedo
    // arrives at our own pixel as a different per cent. So the sheet carries
    // the shape at a fixed deviation and this pair carries the amount, swept at
    // the pose that judges and read with C's own instrument.
    //
    // 1.6, AND IT IS THE READING AND NOT A PREFERENCE. Swept at the pose that
    // judges over the meadow's own window -- 200 by 50 pixels chosen on the
    // FAMILY'S MASK, so that every pixel in it is grass and none of it is a
    // flower or a bank -- and read with the 3x3 low quartile:
    //
    //     gain      0     1.4    1.6    1.8    2.0    3.0
    //     grain  0.36    1.17   1.32   1.48   1.63   2.39   (reference 1.33)
    //
    // The pair is one number twice, and that is a limit declared rather than a
    // saving: a window big enough to measure holds both tops and flanks, so the
    // instrument cannot say which of the two carries more, and a difference
    // between them would be invented. The seat for two is here the moment a
    // reading separates them.
    sheetGain: new Vector2(1.6, 1.6),
    // THE TWO KNOBS THAT ARE NOT THE VOXEL'S. They are still reachable from
    // here, because a sweep on the page is what they exist for; what they MEAN,
    // and why a delivery ships them at one, is stated once over NEUTRAL_LIFT in
    // src/world/face-light.js, which is also where they are applied.
    sunLift: 1,
    skyLift: 1,
    // The two terms the mat of grass is the only family to carry. NOUGHT here,
    // and the ground and the bare earth draw exactly the picture they drew
    // before either existed: see matLight() and the foot of the mat in the
    // fragment for what they are and what measured them.
    bounce: 0,
    base: new Vector2(0, 1),
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
    // AND ITS OWN SHEET, WHICH IS THE WIDEST GAP IN THE WHOLE DOSSIER: bare
    // earth carries 2.40% of grain inside a face on the reference against our
    // 0.51%, four point seven times. One slice serves both orientations here
    // and the reason is a measurement rather than a saving: at the pose that
    // judges, the eye is a degree above the horizon and the bare family in the
    // reference shows FLANKS -- there is no top face of naked earth in the
    // picture wide enough to cut a second sheet out of, and inventing one would
    // be the one thing this unit is not allowed to do.
    sheetLayers: new Vector2(...FAMILY_LAYERS.earth),
    // AND ITS GAIN IS HALF AGAIN THE MEADOW'S, which is the reference's own
    // ordering: C 0 reads 2.40% of grain on bare earth against 1.16 to 1.33 on
    // grass, and the widest gap in the whole dossier is this family's.
    //
    // Swept on two windows of the bare family's own mask, both chosen LIT so
    // that they stand where the reference's own window stands (L 82 and 86
    // against its 92.5). That constraint is not tidiness. A first pair was
    // taken on the mask alone, one of them landed in shadow at L 42, and there
    // 2.4% of luminance is nine tenths of ONE LEVEL: two runs of the same
    // state, differing nowhere by more than six levels on a channel, read it as
    // 1.76 and as 1.37. A grain measured under a level is not measured.
    //
    //     gain             0     2.2    2.6    3.0
    //     grain 60x20    0.47   2.01   2.33   2.59
    //     grain 44x16    0.45   1.89   2.20   2.46
    //
    // 2.7 puts the first window on the reference's 2.40 and the second within
    // six per cent of it.
    sheetGain: new Vector2(2.7, 2.7),
  };
}

/**
 * The mat of grass, which is the same material with three numbers moved.
 *
 * THE PIGMENT DOES NOT MOVE, AND THAT IS A MEASUREMENT. E-ERBA-A 5 read the
 * chroma of both pictures scaled by scaled by L*, and up to L* 40 the two
 * curves lie on top of each other -- 34.8 against 33.6, 42.2 against 41.3.
 * «Il nostro slavato non e' saturazione»: the committente's «piu' acceso»
 * (E-DECISIONI8.2) is LUMINANCE in both directions -- the flank falls too far
 * and the top never rises -- and the pigment of E-PIG1 is doing its work. So
 * this family carries the meadow's own albedo, the meadow's own field and the
 * meadow's own zones, and it must: a mat drawing a second field over the ground
 * it stands on would put a seam under every blade.
 *
 * WHAT MOVES IS THE TWO TERMS OF THE LIGHT E-ERBA-A MEASURED ON GRASS AND ONLY
 * ON GRASS -- the bounce into the flanks and the shade at the foot -- and both
 * are written where they were measured, in the fragment above.
 */
export function bladeSettings() {
  return {
    ...voxelSettings(),
    // HOW MUCH OF ITS OWN HEMISPHERE THE MAT GIVES BACK TO ITS FLANKS.
    //
    // Fitted on the live frame with E-ERBA-A's own instrument -- pairs across
    // the fall that marks a top, at the pose the campaign judges on -- because
    // what the reading is of is a PIXEL and the road from a sky term to a pixel
    // runs through the light, the exposure, the tone curve and the grade, none
    // of which is linear. The sweep and its table are in the verbale of
    // U-ERBA-1.
    bounce: BLADE_BOUNCE,
    // AND THE SHADE AT THE FOOT: how much the lowest cube of a stack loses, and
    // how much of that is left one cube higher. Straight off E-ERBA-A 1.6 -- 16%
    // at nought, home by 7 cm -- and the reason it is these two numbers and not
    // a fitted curve is that the measurement is these two numbers.
    base: new Vector2(0.16, 0.62),
    // AND ITS OWN SLICE OF THE GRAIN, which is the one thing E-TEX1 leaves this
    // family. The sheet of «grass, top» was cut for the top face of the TERRAIN
    // and E-DECISIONI8.4 retired that reading; what it is grain FOR is this --
    // the inside of the face of a blade -- and the seat, the slice and the
    // guard all survive the move unchanged (E-TEX1's own closing note).
    sheetLayers: new Vector2(...FAMILY_LAYERS.meadow),
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
  uniform float uBounce;
  uniform vec2 uBase;
  uniform float uCellRatio;

  ${SCENE_LIGHT_GLSL}
  ${FACE_LIGHT_GLSL}
  ${PIGMENT_GLSL}
  ${SHEET_GLSL}
  // THE ANALYTIC SHEEN, COMPILED HERE AND CALLED BY NOTHING, WHICH IS THE WHOLE
  // OF WHAT IT IS FOR TODAY.
  //
  // C 1.3 measured what it answers, and it is a fact about STONE: the sunlit
  // flank of monolith 03 stands at saturation 0.107 where its own shaded front,
  // the same stone under the sky alone, stands at 0.667. A face that has lost
  // its pigment and taken the light's colour has a specular term on it. The
  // reference shows nothing of the kind on grass or on earth -- their sunlit
  // faces keep their colour -- so no material in this file calls it, and there
  // is deliberately no knob here that would let one.
  //
  // It stands in the program anyway so that it is COMPILED: a chunk written and
  // never put through a compiler is a chunk that does not build on the day it is
  // wanted, and the campaign has paid for a shader that failed silently once
  // already. An uncalled function is stripped before a single instruction is
  // issued, so it stands here for nothing. The stone is V2's, on another branch,
  // and this is the seat it inherits -- the exponent, the dielectric F0 and the
  // normalisation are in src/world/voxel/sheet.js beside it, with the readings
  // they came from. Exponent ${STONE_SHINE.toFixed(0)}, which is C's own Q2b.
  ${SHEEN_GLSL}
  ${FOG_GLSL}

  // WHAT A FACE OF THIS FAMILY IS WORTH, AND WHY IT IS A BEND AND NOT A LIFT.
  //
  // E-ERBA-A 1.5 measured the orientation ladder on the target's GRASS, in
  // pairs on the same column of pixels -- two above the fall that marks the top
  // and three below it, so the two samples are on one blade, under one air,
  // with one pigment, and everything cancels but the orientation. Five windows
  // from 5 to 15 metres:
  //
  //     target  0.643  0.648  0.634  0.617  0.624   (deviation 0.013)
  //     ours    0.477  0.397  0.518  0.500  0.505
  //
  // The committente's «una tonalita' leggermente piu' scura» is 0.62, and our
  // flank is a third too dark. src/world/face-light.js carries 1.00 / 0.947 /
  // 0.336, which B 1.1 verified on the target's STONE and the fit closed; the
  // grass of the same picture does not use it -- 1.00 / 0.71 / 0.41.
  //
  // TWO READINGS FIT AND THE TARGET DOES NOT SEPARATE THEM (E-ERBA-A 6.5): the
  // mat has a BOUNCE the stone has not -- light entering between the blades and
  // coming back out of their flanks, which is what a dense mat physically does
  // -- or the side of a blade is a paler albedo than its top. This is written as
  // the first, because the first is a thing a mat does and the second is a
  // number that would have to be invented.
  //
  // AND IT IS THE DOOR src/world/face-light.js OPENS, NOT THE ONE guard-lift
  // SHUTS. The seat's own note says it: «a material may bend the sun term
  // between the two -- the masonry does, for its own relief -- and that is why
  // faceLightOf() takes the pair rather than the normal: bending it is a
  // material's business, producing it is not». So the pair is produced by the
  // one producer and bent HERE, for one family, in the sky term, which is the
  // term a bounce moves. uLift is untouched and stays at one everywhere in the
  // world, because what it exists to stop -- a session quietly giving the world
  // a second opinion about the HOUR -- is a different thing from a material
  // saying what its own surface does with the light it gets.
  //
  // Nought for the ground and the bare earth, so those two draw exactly the
  // picture they drew before this term existed.
  //
  // AND IT HANDS BACK A PAIR AND NOT A LIGHT, WHICH IS THE RULE AND NOT A STYLE.
  // guard-sentiero-luce refuses any line in this file that assigns to the light
  // without naming the producer, and it is right to: the light of this world is
  // made in ONE place, and a material that computed its own would be the second
  // opinion about the hour that the campaign spent a session removing. What a
  // material may do -- what src/world/face-light.js says in as many words -- is
  // bend the pair it was GIVEN. So this bends a pair, and every line that makes
  // a light out of one still names faceLightOf.
  vec2 matTerms(vec3 nn, float shade) {
    vec2 pair = faceTerms(nn);
    pair.y = min(1.0, pair.y + uBounce * (1.0 - abs(nn.y)));
    return pair * shade;
  }

  void main() {
    vec3 n = normalize(vNormal);

    // WHICH CUBE THIS IS. Half a step back along the normal, so a face lands
    // inside the solid it belongs to instead of on the boundary between two —
    // on the boundary the floor below would flicker between neighbours and the
    // tint of a whole wall would crawl as the eye moved.
    vec3 p = vLocal - n * (uVoxel * 0.5);
    vec3 cell = floor(p / uVoxel) + vec3(vChunk.x, 0.0, vChunk.y);

    // AND WHICH COLUMN OF THE WORLD THAT CUBE STANDS IN, WHICH IS NOT THE SAME
    // QUESTION ONCE A FAMILY IS DRAWN AT HALF THE STEP.
    //
    // Everything this fragment rebuilds out of the cell falls into two kinds,
    // and the mat of grass is what forced them apart:
    //
    //   the CUBE's own -- the joint at its edges, the lightened arris along its
    //   upper one, which slice of the sheet is laid on it. A blade is a cube of
    //   five centimetres and those are its edges, so they are drawn on ITS
    //   lattice, and drawing them on the world's would put a joint straight
    //   through the middle of every blade and cut its top in two. Measured: the
    //   estimator of E-ERBA-A 1.1 read our blade at 0.20 of a cube where the
    //   truth is 0.50, because it was counting those false edges.
    //
    //   the COLUMN's -- the pigment, which is a field over the world in zones of
    //   half a metre and more. A zone of the world is one zone whichever family
    //   stands in it (the note over the bare earth's own hue says so), and a mat
    //   that drew the field at twice the frequency would put a change of scale
    //   between the grass and the ground it stands on.
    //
    // So the ratio is what the material is drawn at over the step the world is
    // kept in: ONE for every family that is a cube of the world, a half for the
    // mat. At one it is a floor of a whole number and cannot move a pixel of
    // what shipped.
    vec2 column = floor(cell.xz * uCellRatio);

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
    vec3 albedo = pigmentOf(column.x, column.y);

    // ------------------------------------------------------------ the grain
    // ONE READ, AND IT MULTIPLIES THE PIGMENT RATHER THAN REPLACING IT: the
    // sheet is grey and has mean a half, so it moves nothing about the colour
    // of this cube and nothing about the colour of the world at range. Which
    // slice, and how much of it, comes off the normal that is already here and
    // off a constant of the material -- no attribute, no varying, no draw.
    //
    // THE LAY OF THE SQUARE IS DRAWN OFF THE CELL, one of eight, so a meadow of
    // ten thousand cubes is not ten thousand copies of one stamp. The hash is
    // the pigment's own -- there is no second one in this program -- asked a
    // question no other term asks, so the tint of a cube and the way its sheet
    // is turned are independent draws.
    albedo *= sheetGrain(p, n, uVoxel, pixel, vec2(
      pigHash(cell.x + 131.0, cell.z + cell.y * 17.0 + 57.0),
      pigHash(cell.z + 401.0, cell.x + cell.y * 29.0 + 233.0)));

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

    // -------------------------------------------------- the foot of the mat
    // THE ONE TERM E-ERBA-A CALLS THE MOST IMPORTANT THING IN ITS DOSSIER FOR
    // WHOEVER HAS TO BUILD IT, AND IT COSTS TWO INSTRUCTIONS.
    //
    // The committente read it as «i bordi di quella faccia sono piu' scuri»
    // (E-DECISIONI8.1) and asked which it was, an artefact of the zoom or an
    // ambient occlusion. It is neither, and the measurement that separates them
    // is in E-ERBA-A 1.6: the profile inside a face, read in CENTIMETRES FROM
    // THE GROUND instead of in fractions of the face, splits the two readings
    // apart. A face more than one blade tall reaches the plane and is 16% dark
    // there; a face of a single blade, which stands HIGHER in the mat because it
    // rests on other blades, has no darkening at all. A painted gradient would
    // scale with its face and the two rows would coincide as fractions; they
    // coincide in centimetres instead.
    //
    //     target, tall faces (>= 11 cm), n 100, by cm from the foot
    //     0.844  0.833  0.850  0.898  0.904  0.931  0.997  1.015
    //     target, short faces (4-9 cm),  n 345
    //     0.951  0.967  0.990  1.000  1.018  1.055  1.114  1.077
    //     ours, over the whole face
    //     1.007  1.011  1.002  1.001  1.000  1.000  0.996  1.000
    //
    // So it is a function of the HEIGHT ABOVE THE PLANE and of nothing else --
    // no neighbour, no attribute, no read, no pass -- and the plane of this
    // world is a plane, which is what makes the two the same quantity.
    //
    // AND IT IS A STAIR AND NOT A GRADIENT, WHICH IS THE COMMITTENTE'S OWN WORD
    // AND ALSO WHAT PAYS FOR THE SHADOWS. E-DECISIONI10 G4: «la base dello stelo
    // e dell'erba e' leggermente piu' scura della parte finale: non una sfumatura
    // ma un CAMBIO GRADUALE E GIUSTIFICATO fra i voxel (se piu' d'uno); questa
    // regola puo' andare bene anche per le PERFORMANCE rispetto alle ombre». So
    // every cube of a stack of blades carries ONE level, darkest at the foot,
    // and the levels this geometric fall gives are
    //
    //     rung   0      1      2      3      4
    //     ours   0.840  0.901  0.938  0.962  0.977
    //     target 0.844   --    1.015   --     --     (it has 0-7 cm of data)
    //
    // THE AMOUNT IS THE MEASUREMENT AND THE SPAN IS HIS SENTENCE, and the two
    // came from two places on purpose. E-ERBA-A 1.6 measures 16% at the foot and
    // the fall SPENT by 7 cm, and built exactly that way -- 0.840, 0.947, 0.983,
    // spent by the second cube -- it is invisible in the frame: measured by A/B
    // in one run of the browser, one uniform apart, it moves the low decile of
    // the near meadow by 0.2 to 3.0 per cent where the target's own instrument
    // reads 16 (fondazione/lav/er-base.mjs, er-ab.py; the sky control moves by
    // 0.0000). The cause is geometry and E-ERBA-A 1.6 named the risk itself: at
    // a pose a degree above the horizon a closed mat HIDES ITS OWN FEET, so the
    // cubes the term darkens most are the ones the mat in front covers.
    //
    // What the committente asked for is not a fall spent in 7 cm, it is a step
    // between the voxels: «un CAMBIO GRADUALE E GIUSTIFICATO fra i voxel (se
    // piu' d'uno)». At 0.62 every pair of cubes up a blade differs -- 6.1, 3.7,
    // 2.4, 1.5 per cent -- and the A/B reads it: -2.9% in the near field, -6.1%
    // at eleven metres, the sky still at 0.0000. The deficit at the foot is left
    // at E-ERBA-A's own 0.16 and NOT raised to make the frame move more: 0.26
    // was on the same table and it reads 4.7 and 9.5, and it would be answering
    // a measurement in a currency the measurement does not use.
    //
    // AND ON A MOUND IT IS AN APPROXIMATION AND IS DECLARED AS ONE. The foot of
    // a blade standing on a mound is not at y = 0, so the term counts the rungs
    // from the plane and leaves the crown of a mass unshaded. The mound is
    // 0.20 m where the fall is spent in 0.10, so what is lost is a fringe on the
    // back of a mass; E-ERBA-A 6.4 proposes it in exactly this shape and
    // E-DECISIONI9.4 -- grass on the mounds too -- is what makes the case exist.
    //
    // AND IT IS TAKEN OFF THE PAIR AND NOT OFF THE LIGHT, which is the same
    // arithmetic in the honest seat: what the foot of a blade has less of is the
    // SKY IT CAN SEE and the sun that reaches it, and both of those are terms.
    // Taken off the light afterwards it would be a material bending a light it
    // did not make; taken here it is a face saying how much of the world it can
    // see, which is what a pair of terms is.
    float rung = max(0.0, floor(vWorld.y / uVoxel));
    float shade = 1.0 - uBase.x * pow(uBase.y, rung);
    vec3 light = faceLightOf(matTerms(n, shade));

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
      light = mix(light, faceLightOf(matTerms(leaning, shade)), arris);
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
  // THE ARRAY IS BUILT ONCE PER MATERIAL AND SHARED BY REFERENCE when a sheet
  // was handed over; where none was, sheetArray() answers with a neutral one --
  // every texel a half -- and the gain below is what actually turns the term
  // off. A neutral array rather than a null sampler because a null sampler is
  // a different program on some drivers and the same program on others, and a
  // world that draws differently depending on which is the defect this campaign
  // spends its guards on.
  const sheet = settings.sheet ?? sheetArray(null);
  const material = new ShaderMaterial({
    uniforms: {
      uVoxel: { value: voxel },
      uAlbedo: { value: settings.albedo },
      ...pigmentUniforms(settings),
      ...sheetUniforms(sheet, settings.sheetLayers, settings.sheetGain),
      uJoint: { value: settings.joint },
      uJointPixels: { value: settings.jointPixels },
      uArris: { value: settings.arris },
      uArrisPixels: { value: settings.arrisPixels },
      uArrisLean: { value: settings.arrisLean },
      uBounce: { value: settings.bounce },
      uBase: { value: settings.base },
      uCellRatio: { value: voxel / VOXEL },
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
    u.uSheetLayer.value.copy(settings.sheetLayers);
    u.uSheetGain.value.copy(settings.sheetGain);
    u.uJoint.value = settings.joint;
    u.uJointPixels.value = settings.jointPixels;
    u.uArris.value = settings.arris;
    u.uArrisPixels.value = settings.arrisPixels;
    u.uArrisLean.value = settings.arrisLean;
    u.uBounce.value = settings.bounce;
    u.uBase.value.copy(settings.base);
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
    // THE RELIEF OF THE TASSELLI, live like everything else in this record, so a
    // sweep on the shadow costs a redraw and not a rebuild.
    reliefHigh: RELIEF.high,
    reliefShade: RELIEF.shade,
    reliefWall: RELIEF.wall,
    reliefMean: RELIEF.mean,
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
    // AND THE AMOUNT IS RE-SOLVED WHERE THE COMPOSITION MOVED IT, on the same
    // instrument, at the same window, against the same number.
    //
    // The exponent above was 2.9 and the paving it was fitted on was nearly all
    // stone. U-SENT-2 thinned the stone into earth across the corridor
    // (E-DECISIONI10 S3, SPREAD in ../path.js), and earth is the WARM end of the
    // very ramp this rotation acts on -- so the same rotation on a browner
    // paving arrives warmer. Read on V3's own bench at V3's own window
    // (fondazione/lav/tinta.py, the mid run C 1.5 names) the corridor came back
    // at R/B 1.913 where the reference reads 1.730 and where the fit had landed
    // 1.719. Swept live at the judging pose, the exponent that puts it back is
    // 2.4: 1.529 / 1.629 / 1.733 / 1.913 at 1.8 / 2.1 / 2.4 / 2.9.
    //
    // THE DIRECTION IS UNTOUCHED, which is the whole reason the fit was written
    // as an exponent on a measured ratio rather than as three numbers: what
    // moved is how much of a measurement the chain lets through when the surface
    // under it changed, and that is the thing the method above says is fitted.
    warmth: new Vector3(1.3506, 0.9643, 0.3207),
    // ------------------------------------------------------------------------
    // AND HERE IS THAT OTHER HALF, WITH WHAT IT COULD AND COULD NOT TAKE.
    //
    // The corridor is the one family of the soil that already had textures --
    // three of them, 982 347 bytes, sixteen per cent of the whole first frame --
    // and it still reads 2.7 times smoother than the reference. C 4.2's own
    // proposal for it was to TAKE AWAY rather than add: rebuild the three maps
    // more contrasted, with bigger slabs and the brown they lack, and possibly
    // fold them into two slices of this array.
    //
    // TWO THIRDS OF THAT ARE NOT THIS UNIT'S TO DO, and saying so is more use
    // than half-doing it. The lattice of slabs and the level of each slab are
    // POSITION along a hundred and eight metres of run -- a ruler whose eight
    // bits interpolate to a place, not a picture -- and they are baked by
    // tools/path/ out of the law in src/world/path.js. Neither file is open to
    // this unit, and a sixteen texel square cannot hold a slab lattice in any
    // case: the reference's slabs are 20 to 40 px at six metres, which is two
    // to four voxels, so what tiles at voxel scale is the grain INSIDE a slab
    // and never the slabs. The other lever, raising GRAIN_GAIN, would put a
    // number in this file that contradicts path.js -- which is the one thing
    // the note at the head of this section forbids.
    //
    // SO WHAT ENTERS IS THE ONE PIECE THAT IS THIS UNIT'S: the grain inside a
    // slab, off the same array the meadow reads, laid over the ground on the
    // corridor's own turn. It is a FOURTH read on this material and that is
    // stated rather than hidden -- the corridor is 2.8% of the frame's pixels
    // (44 482 of 1 572 952, measured on the family's own mask) and the bench
    // says what the fourth read costs there.
    sheetLayers: new Vector2(LAYER.paving, LAYER.paving),
    // 2.9, AND ITS SCALE AND ITS LAY WITH IT, because the corridor is the one
    // family whose sheet has no face to sit on: it inherits neither a scale nor
    // an orientation and both had to be swept. Over the two windows of the
    // paving's own mask, against the two figures C 1.5 publishes (2.27 near,
    // 3.20 at the mid run):
    //
    //     gain / repeat   0     2.9/0.25   2.9/0.40
    //     near          1.11     2.76        2.48
    //     mid run       1.22     3.15        3.05
    //
    // At forty centimetres the near window runs twelve per cent over and the
    // mid run five under, which is the narrowest pair of the sweep.
    //
    // AND THE LAY IS PER SLAB, which is not a refinement: laid straight over the
    // run this sheet reads as CORRUGATION, and 25, 55 and 90 cm all read the
    // same way. The paving's own tone map says which piece a fragment is in and
    // is already fetched, so a turn off it costs nothing -- see the fragment.
    sheetGain: new Vector2(2.9, 2.9),
    sheetMetres: PAVING_SHEET_METRES,
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
  uniform float uReliefHigh;
  uniform float uReliefShade;
  uniform float uReliefWall;
  uniform float uReliefMean;

  ${SCENE_LIGHT_GLSL}
  ${FACE_LIGHT_GLSL}
  ${SHEET_GLSL}
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
    // TWO FIELDS OUT OF THE SECOND FETCH AND NOT TWO FETCHES. Red is the level
    // of the piece, green is HOW FAR IT STANDS PROUD -- nought at the corridor's
    // floor and one at uReliefHigh. See RELIEF in ../path.js: a centimetre is a
    // tenth of this world's cell, so the relief is drawn and never built.
    vec2 piece = texture2D(tTone, skin).rg;
    float tone = piece.x;
    float lift = piece.y;

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

    // AND THE GRAIN OF THE REFERENCE'S OWN SLAB, off the array the meadow
    // reads, on the same turn as the tile above it. It has mean a half like
    // everything else in this file that multiplies, so the level the pigment
    // was fitted at does not move -- and unlike the tile it does NOT fade with
    // distance, because the reading it answers is at ten metres: the reference
    // carries 3.20% of grain inside a face at the mid run against our 1.22%,
    // and a term that let go at twelve would have answered the near window and
    // left the far one where it was.
    // AND A DIFFERENT LAY OF IT ON EVERY SLAB, which is the difference between
    // stone and corrugated iron. Laid straight over the run the sheet reads as
    // a ripple: what a cut of one slab of the reference holds is the streaking
    // ALONG that slab, and a streak tiled over a hundred metres of corridor is
    // a ripple at every repeat that was tried -- 25, 55 and 90 cm all read the
    // same way, so it is the content and not the period. In the reference the
    // grain of a stone runs with the STONE IT IS IN and turns at every joint.
    //
    // The draw is the slab's own level, which is already in hand: the tone is
    // piecewise constant on pieces a hand across, so it is a per-slab number
    // that costs no read, no varying and no attribute.
    // AND THE DRAW IS THE TONE ROUNDED TO A BUCKET, which is not tidiness: the
    // level arrives through a linear filter and carries a little variation
    // inside a piece, and a fraction of thirty times it turns that variation
    // into a different lay at every pixel -- measured, and the corridor came
    // back as speckle at 4.6% where the reference reads 2.2. Rounded to
    // sixteen buckets the draw is constant on a piece, which is what it is for.
    float slab = floor(tone * 16.0);
    float footprint = max(length(fwidth(vWorld.xz)), 1e-6) * uSheetPerMetre;
    albedo *= sheetOver(sheetLay(turned * uSheetPerMetre,
      vec2(fract(slab * 0.2135), fract(slab * 0.5077))),
      uSheetLayer.x, uSheetGain.x, footprint);

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

    // THE RELIEF OF THE TASSELLI, AND IT IS THE LIGHT AND NOT THE PIGMENT.
    //
    // E-DECISIONI10 S1: «ogni tassello e' giustificato, ha la sua parte scura
    // dovuta all'ombreggiatura della sporgenza». A shadow is not a colour, and a
    // shadow written into the albedo would be a stone that is dark at midnight
    // as well as at noon. src/world/face-light.js exists in the shape it does
    // for exactly this -- «a material may bend the sun term between the two, the
    // masonry does, for its own relief» -- so the pair is asked for once and
    // bent, and where the sun is stays the one producer's business.
    //
    // ONE FETCH, AND IT IS THE PIECE ONE SHADOW-LENGTH TOWARD THE SUN. A piece
    // standing h proud lays h * cot(elevation) of shadow on the ground away from
    // the beam; so the question "am I in a neighbour's shadow" is "does the
    // piece one shadow-length sunward stand higher than mine", and it is asked
    // of the LIVE sun rather than of a baked bearing. The offset is in strip
    // coordinates because the strip is the only place the answer is written.
    vec2 sunFlat = uSunDir.xz;
    float sunRun = max(length(sunFlat), 1e-4);
    float castLen = uReliefHigh * sunRun / max(uSunDir.y, 1e-3);
    vec2 castUv = (sunFlat / sunRun) * castLen
      * vec2(1.0 / (2.0 * uSkinHalf), 1.0 / (uSkinZ.y - uSkinZ.x));
    float sunward = texture2D(tTone, skin + castUv).y;

    vec2 terms = faceTerms(normalize(vNormal));
    // The cast shadow keeps the sky and loses the beam, which is what a shadow
    // IS. Deeper by the step the two pieces stand apart, and nought where the
    // neighbour is no higher.
    terms.x *= 1.0 - uReliefShade * max(0.0, sunward - lift);
    // AND THE WALL OF THE SLOT, WHICH IS THE HALF THE CAST SHADOW CANNOT DRAW. A
    // slot between two pieces that stand a centimetre proud is a groove, and a
    // groove sees less of the SKY as well as less of the sun -- which is why
    // this one multiplies the pair. It is what the reference's own tessellation
    // reads as at the pose the campaign judges on: a dark ring round every
    // piece, of which only a fifth is directional (verbale U-SENT-2 §2.3).
    // ABOUT ITS OWN MEAN, so the term is contrast and not a dimmer: see
    // RELIEF.mean in ../path.js. The mean fades with the slot itself, or the
    // far corridor would come back BRIGHTER than the near one where the joints
    // have stopped being drawn.
    terms *= 1.0 - uReliefWall * (inSlot * lift - uReliefMean * far);
    vec3 light = faceLightOf(terms);

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
      // The array is the disc's, shared by reference with the two families
      // beside this one: one upload for the whole soil.
      ...sheetUniforms(settings.sheet ?? sheetArray(null),
        settings.sheetLayers, settings.sheetGain, 1 / settings.sheetMetres),
      // The centreline and the strip's own frame, so the fragment can solve
      // what the old surface carried in two attributes.
      uLine: {
        value: new Vector4(PATH_LINE.stairZ, PATH_LINE.nearZ,
          PATH_LINE.stairX, PATH_LINE.nearX),
      },
      uSkinZ: { value: new Vector2(PATH_SKIN.z0, PATH_SKIN.z1) },
      uSkinHalf: { value: PATH_SKIN.half },
      // The relief of the pieces: how tall the tallest stands, and what its
      // shadow and the wall of its slot take off the light. See RELIEF in
      // ../path.js -- these three are read from there and never restated.
      uReliefHigh: { value: settings.reliefHigh },
      uReliefShade: { value: settings.reliefShade },
      uReliefWall: { value: settings.reliefWall },
      uReliefMean: { value: settings.reliefMean },
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
    u.uSheetLayer.value.copy(settings.sheetLayers);
    u.uSheetGain.value.copy(settings.sheetGain);
    u.uSheetPerMetre.value = 1 / settings.sheetMetres;
    u.uReliefHigh.value = settings.reliefHigh;
    u.uReliefShade.value = settings.reliefShade;
    u.uReliefWall.value = settings.reliefWall;
    u.uReliefMean.value = settings.reliefMean;
  };

  return material;
}
