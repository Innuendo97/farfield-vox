import {
  ClampToEdgeWrapping, RepeatWrapping, ShaderMaterial, Vector2, Vector3, Vector4,
} from 'three';
import { SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS } from '../../core/sky.js';
import { FACE_LIGHT_GLSL, faceLightUniforms } from '../face-light.js';
import { FOG_GLSL, GROUND_EXPOSURE, fogUniforms } from '../air.js';
import TERRAIN from '../../../assets-src/terrain/terrain.json' with { type: 'json' };
import { PATH_LINE } from '../terrain-field.js';
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
    // THE PALE MINORITY -- HOW MUCH BRIGHTER IT IS, AND HOW MUCH OF IT THERE IS.
    //
    // `pale` is the whole of the switch: at nought the term is exactly nought
    // and the meadow is the one the previous delivery ships, bit for bit, so
    // this can be swept against a delivery the way tintShape was.
    //
    // WHAT IT IS FOR, in the two numbers that say it. The estimator reads the
    // spread inside its brightest family at 18.7% on the target and at 8.1%
    // here, and the last unit measured that no width can close the gap. The
    // reason is in the other column of the same reading: the target's brightest
    // family is a TENTH of its faces and ours is a third. Read across the four
    // windows that are meadow in both pictures the target traces the relation
    // out on its own --
    //
    //     window          the target's bright family      its spread
    //     prato-est                 4.7% of faces             15.7%
    //     finestra-demo            10.1%                      18.7%
    //     prato-ovest              21.9%                      15.3%
    //     fascia-8-15              42.2%                      10.5%
    //
    // -- where it is a minority the spread is wide, and where it is nearly half
    // the faces the spread falls to 10.5%, which is where ours already stands.
    // So the lever is the SHARE and not the width, and this is the share.
    //
    // BOTH ARE SWEPT ON THE PAGE AND NEITHER IS CHOSEN. Twenty arms through one
    // browser, the shipped meadow taken first and again last as the harness's
    // own null, read by the estimator on the four windows at once. At the window
    // the campaign judges on:
    //
    //     pale  share   family sd   its share   middle rung   bottom rung
    //     0.00   --          8.2%       33.8%          0.74          0.34
    //     1.20  0.08        10.4%       35.2%          0.72          0.34
    //     1.50  0.08        10.9%       35.0%          0.72          0.34
    //     1.75  0.08        11.4%       35.2%          0.72          0.34
    //     2.00  0.08        11.5%       30.5%          0.75          0.33
    //     1.50  0.12        10.0%       18.6%          0.77          0.31
    //     2.00  0.10        11.0%       18.3%          0.76          0.31
    //     3.00  0.10        12.9%       16.2%          0.74          0.30
    //     the target        18.7%       10.1%          0.65          0.36
    //
    // 1.50 AT A TWELFTH IS THE LAST ROW WHERE EVERY WINDOW MOVES THE RIGHT WAY
    // TOGETHER: the spread rises on all four -- 8.2 to 10.9, 7.5 to 9.4, 7.7 to
    // 9.0, 8.0 to 8.1 -- and no bottom rung moves at the judged window or in the
    // far band. Past 1.75 the far band's spread turns round and goes back down,
    // and past 2.00 something else happens that looks like a win and is not: the
    // estimator's brightest family CHANGES IDENTITY. It stops being the top of
    // the tint's own draw and becomes this minority, so the share falls to 18%
    // -- the right direction, read off a different population -- and the bottom
    // rung goes with it, 0.34 to 0.31 to 0.30, against a target of 0.36 and an
    // entry this file already lands.
    //
    // SO THE GAP IS NOT CLOSED AND THAT IS REPORTED RATHER THAN PAID FOR: 8.2 to
    // 10.9 is a third of the way to 18.7 and the rest is not reachable from this
    // knob without the ladder. What the knob DOES close is the other column, on
    // the windows where the target's own family is a minority: 41.6% to 23.5%
    // against a target of 21.9% at prato-ovest, and 37.9% to 18.0% at prato-est.
    pale: 1.50,
    paleShare: 0.08,
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
    albedo: new Vector3(0.900, 0.580, 0.240),
    // NO PALE MINORITY ON THE EARTH. The bright family the meadow needed is a
    // reading of the target's GRASS -- a tenth of its faces carrying a spread
    // of 18.7% inside themselves -- and nothing in the target says bare ground
    // has one. A term switched on where it was not measured is decoration.
    pale: 0,
    // And less of the hue jitter, for the same reason: what a meadow varies
    // along is green against the two either side of it, and earth does not.
    hue: 0.10,
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
  uniform float uPale;
  uniform float uPaleShare;

  // The height the pale family's draw is taken at, and it is not a taste: the
  // disc's cube tops straddle the field from five centimetres under it to
  // twenty five over, so every cell of this carpet has a whole-number height
  // within a couple of voxels of nought. Any plane well clear of that band
  // makes the column's draw a different call from the cube's with certainty
  // rather than with luck, and the hash is measured decorrelated at it.
  const float PALE_PLANE = 512.0;

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

    // ------------------------------------------------- the pale minority
    // WHY A SECOND DRAW AND NOT A WIDER FIRST ONE, which is the whole of why
    // this term exists. The target's brightest family is 95 faces out of 944
    // and carries a spread of 18.7% INSIDE ITSELF; the draw above, opened as
    // far as its own ceiling allows, hands the estimator 418 out of 1258 and
    // 8.1%. A draw that is symmetric about its middle cannot make a minority
    // however wide it is made -- that is a statement about the SHAPE of a
    // population and not about its width -- so the minority is drawn as one.
    //
    // AND THE TARGET'S IS MEADOW, taken apart before it was chased: inside that
    // family the regions that are a CUBE'S OWN SIZE are 61 of the 95 and carry
    // 20.5% on their own, so the spread is not the white flowers of C9 and not
    // three pixel slivers of arris. It is V1's to build.
    //
    // DRAWN PER COLUMN. A pale patch of meadow is pale from its top face to its
    // foot; a per cube draw would pale the top of a stack and leave its flank,
    // which is a stripe and not a family. The column is this cell with its
    // height taken out, hashed on a plane no cube of this carpet can stand at,
    // so this draw and the tint's are never the same call on the same argument.
    vec2 paleDraw = cellHash(vec3(cell.x, PALE_PLANE, cell.z));
    // The membership is a STEP and not a ramp, because a family has an edge and
    // because a step is one instruction. What varies inside it is the LIFT,
    // taken from the second component of the same draw: that is what makes this
    // a minority with a spread rather than a second flat level, and the spread
    // inside is the half of the target's reading a plain brightening misses.
    // At uPale nought the term is exactly nought and this is the shipped meadow
    // bit for bit, which is what lets the setting be swept against a delivery.
    tint *= 1.0 + step(paleDraw.x, uPaleShare) * uPale * (0.5 + paleDraw.y);
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
      uPale: { value: settings.pale },
      uPaleShare: { value: settings.paleShare },
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
    u.uPale.value = settings.pale;
    u.uPaleShare.value = settings.paleShare;
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
    // WHERE IT LANDS: R/B 0.95 x 1.1444 / 0.6288 = 1.729, against the 1.73 the
    // reference is read at.
    //
    // WHAT IT IS NOT. It is not the texture, and the texture is the other half
    // of the same finding: the reference carries 3.20% of grain inside a face
    // where this render carries 1.18%, which is a question of contrast, of the
    // size of a slab and of the pitch of three maps. That half is phase C's and
    // it is NOT attempted here -- what is here is the one part of the reading
    // that is a pigment.
    warmth: new Vector3(1.1444, 0.9946, 0.6288),
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
