import { createLooseStone, RUIN_ALBEDO, TURF_ALBEDO } from '../../src/world/loose-stone.js';
import { FOUNTAIN } from '../../src/world/monoliths.js';
import { RUINS } from '../../src/world/rock-piles.js';
import { stoneSpecs } from '../../src/world/stone.js';
import { stoneTileData } from '../../src/world/voxel/pure.js';
import { GROUND_BOUNCE, MEADOW_ALBEDO, readLight, renderChain } from '../lighting/render-chain.mjs';
import { sunVector } from '../lighting/sun.mjs';
import { read, readJson, reporter, selfTest } from './lib.mjs';

// THE MATERIAL OF THE SIX BLOCKS, AGAINST WHAT THE TARGET'S OWN STONE READS.
//
//   node tools/guards/guard-pietra.mjs
//   node tools/guards/guard-pietra.mjs --self
//
// WHY THERE HAS TO BE ONE. Every number this guard holds was fitted against a
// reading kept inside the tools of the session that fitted it, and three of
// those readings disagreed by a factor of three with nobody able to see that
// they did: the block tint was set to 1.4 against "26 to 33% of spread" from an
// estimator that was counting moss, dressed edges and the halo of the engraved
// text along with the stone. Run on BOTH images with one estimator that excludes
// all three, the same quantity reads 10 to 17 on the target and 11 to 36 on the
// render. So the target's side of every comparison now lives in
// assets-src/monoliths/masonry-spec.json under `palette`, this guard reads it
// from there rather than restating it, and the render's side is DERIVED here
// instead of screenshotted.
//
// AND IT RUNS UNDER PLAIN NODE, which is what makes it a guard and not a gate
// item. tools/lighting/render-chain.mjs carries a face through the seat, AgX,
// sRGB and the delivered grade cube exactly as the frame does -- it is the chain
// guard-scala already judges the light with -- so the level a face develops to
// can be asked at every commit rather than at every screenshot. The pixel
// readings that need a browser (the course's autocorrelation, the moss a
// detector can actually see) belong to the session gates, and the numbers this
// prints are what those gates are read against.
//
// WHAT IT DELIBERATELY DOES NOT GATE: the level a face develops to WITH THE AIR
// IN IT. The haze is not this material's: the density is read below and printed
// every run, because between the air at 0.0059 and the air at 0.013 the front of
// 01 develops to 12.2 or to 22.2 without one character of this material
// changing. A guard that gated the developed level would be gating whoever last
// touched src/core/sky.js. So what is gated is the BARE face -- pigment against
// the seat's terms, before the air -- and the air is printed beside it with what
// it does.
//
// AND THE SEAT'S TERMS ARE THREE, WHICH IS WHAT THIS FILE GOT WRONG.
// bareFace() below used to write out the sun term and the sky term and stop
// there. src/world/face-light.js hands every face a THIRD -- the ground of this
// world, lit by the same two terms on its own upward normal and seen again
// through the share of the hemisphere below the face -- and the built stone
// takes it like everything else, through faceLightOf(). A model of the frame
// that leaves a term of the frame out is not a model of the frame: with it
// missing, this file read the lit flanks of the six at hue 234 to 243 and
// called the miss the seat's, when the seat it was describing was a seat this
// world stopped shipping. With it in, the same faces read 114 to 134 and the
// blue on them is the AIR's, which is the one thing this guard was already
// saying it would not gate. The term is READ from the seat (via
// tools/lighting/render-chain.mjs, which lifts it out of face-light.js as text)
// and never restated here, for the reason every other number here is read.

const DEG = Math.PI / 180;

// ------------------------------------------------------------- what is read
//
// Read as text and never imported, for the reason tools/lighting/render-chain
// gives: the modules that hold these reach three.js and a JSON import, and a
// guard that needed a browser's module graph to ask about four characters would
// not be a guard anybody could run at a commit.
const MASONRY = 'src/world/voxel/masonry.js';
const ROCKS = 'src/world/rocks.js';
const COURSES = 'src/world/voxel/courses.js';
const LOOSE = 'src/world/loose-stone.js';

/** One numeric literal of a source, by the name it is declared under. */
export function literal(text, name) {
  const found = new RegExp(`${name} = (-?[0-9.]+)`).exec(text);
  return found ? Number(found[1]) : null;
}

/** One triple literal of a source, by the name it is declared under. */
export function triple(text, name) {
  const found = new RegExp(`${name} = \\[(-?[0-9.]+), (-?[0-9.]+), (-?[0-9.]+)\\]`).exec(text);
  return found ? found.slice(1, 4).map(Number) : null;
}

/**
 * The colour a stone face develops to before the air, as this material makes it.
 *
 * src/world/face-light.js faceLightOf(), in this language, with the stone's own
 * bend on the pair. The bend of the sky term is the material's own and is
 * applied here for the same reason the material is allowed to apply it: the
 * seat produces the pair and lets a material bend one it was given. uLift is
 * touched by neither, and tools/guards/guard-lift.mjs is what keeps that true.
 *
 * THE THIRD TERM IS THE SEAT'S AND IS TAKEN OFF THE BENT PAIR, exactly as the
 * shader takes it: one minus the sky term is the share of the hemisphere BELOW
 * the face, so a material that hands itself less sky is handed more of the
 * ground by construction, and the two cannot be counted twice. That is why a
 * lower sky share warms these faces instead of only darkening them.
 */
export function bareFace(normal, light, albedo, scale, skyShare, bounce = GROUND_BOUNCE) {
  const sun = sunVector(light.elevation, light.azimuth);
  const ts = Math.max(normal[0] * sun[0] + normal[1] * sun[1] + normal[2] * sun[2], 0);
  const tk = (0.5 + 0.5 * normal[1]) * skyShare;
  const gs = Math.max(sun[1], 0);
  return [0, 1, 2].map((c) => albedo[c] * scale
    * (ts * light.sunBeam[c] * light.sunStrength + tk * light.skyBalance[c] * light.skyStrength
      + bounce[c] * (1 - tk) * (gs * light.sunBeam[c] * light.sunStrength
        + light.skyBalance[c] * light.skyStrength)));
}

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** L*, C* and h of an encoded triple, which is what the readings are in. */
export function lch(rgb255) {
  const [r, g, b] = rgb255.map((v) => toLinear(v / 255));
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const a = 500 * (f(x) - f(y));
  const bb = 200 * (f(y) - f(z));
  return { L: 116 * f(y) - 16, C: Math.hypot(a, bb), h: (Math.atan2(bb, a) / DEG + 360) % 360 };
}

/**
 * LINEAR Rec.709 luminance of an encoded triple, and the word linear is the
 * point. The reference's own 4.4 is the ratio of the LUMINANCES behind two
 * CIELAB medians -- L* 31.4 over L* 13.0, which is 4.37 -- and the same two
 * faces of the same picture, weighed on the ENCODED triple, come to 2.25. This
 * file used to compute the encoded one and hold it against the linear one. Two
 * quantities that differ by a factor of two are not a tolerance.
 */
export const luminance = (rgb255) => {
  const [r, g, b] = rgb255.map((v) => toLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** How far a pigment stands from grey: the widest ratio between its channels. */
export const greyness = (rgb) => Math.max(...rgb) / Math.min(...rgb);

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------ the nine faces of the pose
//
// The placement and the turn of src/world/layout.js, and the built head of the
// spec: the same nine faces the reading in the spec was taken on, so the two
// sides of every comparison below are the same piece of stone.
const LAYOUT = {
  '01': { x: -9.32, z: -4.81, rot: 65.0, w: 3.44, d: 1.48, base: 0 },
  '02': { x: -5.29, z: -10.77, rot: 29.4, w: 3.46, d: 1.10, base: 0 },
  '03': { x: 0.05, z: -16.68, rot: 18.0, w: 5.60, d: 1.10, base: 1.30 },
  '04': { x: 5.01, z: -7.53, rot: -37.5, w: 2.99, d: 2.07, base: 0 },
  '05': { x: 8.19, z: -3.69, rot: -48.5, w: 2.90, d: 1.66, base: 0 },
};
const EYE = { x: 0.599, y: 1.583, z: 14.215 };

/** The faces the eye sees, with the normal, the span and the distance of each. */
export function facesAt(heads) {
  const out = [];
  for (const [id, b] of Object.entries(LAYOUT)) {
    const a = b.rot * DEG;
    const right = [Math.cos(a), 0, -Math.sin(a)];
    const front = [Math.sin(a), 0, Math.cos(a)];
    const height = heads[id];
    for (const [name, n, off, span] of [
      ['front', front, b.d / 2, b.w], ['back', front.map((v) => -v), b.d / 2, b.w],
      ['right', right, b.w / 2, b.d], ['left', right.map((v) => -v), b.w / 2, b.d],
    ]) {
      const c = [b.x + n[0] * off, b.base + height / 2, b.z + n[2] * off];
      const toEye = [EYE.x - c[0], EYE.y - c[1], EYE.z - c[2]];
      if (n[0] * toEye[0] + n[2] * toEye[2] <= 0) continue;
      out.push({ id, name, normal: n, span, height });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the moss
//
// The law of the fragment, walked here in the other language, because a law
// that exists only inside a shader is a law nobody can ask a question about.
// Same shape, same constants -- and the constants are READ out of the material
// rather than copied, so the two cannot drift in value. That they cannot drift
// in SHAPE is a separate assertion, at the bottom of this file.
//
// The coverage a weight comes to is exact rather than sampled, and that is the
// one line of arithmetic here the fragment does not contain. The fragment turns
// its field into `above`, the fraction of the face standing over it, which is
// uniform on nought to one BY CONSTRUCTION; it then cuts with a smoothstep from
// `cover` down to 0.35 of it. The expected share of a uniform under that cut is
// 0.35c plus half of the remaining 0.65c, which is 0.675c.
export const coverOfWeight = (moss, weight) => 0.675 * Math.min(0.9, Math.max(0, moss * weight));

/** The fragment's own weight, at a height up a face and a distance from its edge. */
export function mossWeight(law, { lit, upFrac, edgeCourses, west }) {
  const height = 1 + law.foot * smooth(law.footRise, 0, upFrac) + law.head * smooth(0.90, 1.0, upFrac);
  const edge = 1 + law.edgeGain * Math.exp(-Math.min(edgeCourses, 5) * law.reach);
  const sunTerm = law.shade + (1 - law.shade) * lit;
  return height * edge * (sunTerm + law.west * west * smooth(law.westRise, 0, upFrac));
}

/** What one whole face comes out at, walked over its own height and its width. */
export function mossOfFace(law, face, sunTerm, rise) {
  const lit = smooth(0, 0.35, Math.max(sunTerm, 0));
  const west = smooth(law.west0, law.west1, -face.normal[0]) * smooth(2.6, 1.4, face.span);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < 160; i++) {
    const upFrac = (i + 0.5) / 160;
    for (let j = 0; j < 48; j++) {
      const u = ((j + 0.5) / 48) * face.span;
      const edgeCourses = Math.min(u, face.span - u) / rise;
      sum += coverOfWeight(law.cover, mossWeight(law, { lit, upFrac, edgeCourses, west }));
      n++;
    }
  }
  return 100 * (sum / n);
}

/** The spread of one face's own pigment, from the tile and the block tint together. */
export function mottleSpread(composite, light, normal, mat, tint, gain, tile) {
  const side = Math.round(Math.sqrt(tile.length / 2));
  const levels = [];
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let b = 0; b < 300; b++) {
    const t = 1 + tint * (rnd() - 0.5);
    for (let s = 0; s < 40; s++) {
      const i = (Math.floor(rnd() * side) * side + Math.floor(rnd() * side)) * 2;
      const m = 1 + gain * (tile[i] / 255 - 0.5);
      const pigment = mat.albedo.map((v) => v * t * m);
      levels.push(lch(composite(bareFace(normal, light, pigment, mat.scale, mat.skyShare))).L);
    }
  }
  levels.sort((a, b) => a - b);
  const q = (p) => levels[Math.floor(p * levels.length)];
  return q(0.90) - q(0.10);
}

/**
 * The largest thing on the tile, as the lag at which it forgets half of itself.
 *
 * Measured on the field rather than read off the octave list, because what
 * matters is the SIZE of the feature the eye picks up and not the name of the
 * octave that carries it: an octave list with a small wavelength and a huge
 * gain on the one above it would pass a reading of the list and fail the eye.
 */
export function tileFeatureMetres(tile, metresPerTile) {
  const side = Math.round(Math.sqrt(tile.length / 2));
  const row = new Float64Array(side);
  let rows = 0;
  for (let y = 0; y < side; y += 8) {
    for (let x = 0; x < side; x++) row[x] += tile[(y * side + x) * 2];
    rows++;
  }
  let mean = 0;
  for (let x = 0; x < side; x++) { row[x] /= rows; mean += row[x]; }
  mean /= side;
  let zero = 0;
  for (let x = 0; x < side; x++) zero += (row[x] - mean) ** 2;
  for (let lag = 1; lag < side / 2; lag++) {
    let acc = 0;
    for (let x = 0; x < side; x++) acc += (row[x] - mean) * (row[(x + lag) % side] - mean);
    if (acc / zero < 0.5) return (lag / side) * metresPerTile;
  }
  return metresPerTile;
}

// ---------------------------------------------------------------- the bands
//
// Every one of these is a band and not a value, and each says where it came
// from. Where the reference cannot be reached, the band is what the material
// CAN do with the reference's own number written beside it, never the reverse.
const BAND = {
  // The bare shadowed face: the sky term and the ground's return, before any
  // air. The reference reads 11.5 to 15.4 WITH its own haze in it (20.2 on the
  // fifth, 04-right); under the air this world ships (0.0059) the delivered
  // value of this band develops at the pose to 12.2 to 19.1, measured face by
  // face on the frame rather than predicted.
  shadowBare: [3.0, 8.0],
  // The lit faces of the reference are neutral: chroma 5 to 6 at hue 134 to
  // 190. A pigment that is itself green cannot develop to that, and this is the
  // leg that would have caught the green one.
  //
  // AND IT IS THE WALL THE SKY SHARE IS FITTED AGAINST, which it was not before
  // the third term went in: the less sky a face is handed the more of the
  // GROUND it is handed, so the lit chroma climbs as the share falls -- 6.35 at
  // 0.40, 6.93 at the delivered 0.35, 7.57 at 0.30. Every other reading in this
  // file wants the share lower and this one is what stops it. The delivered
  // material stands 0.07 under this number, and that is a boundary rather than
  // a margin: it is said in src/world/voxel/masonry.js too, over the constant.
  litChroma: 7.0,
  litHue: [60, 200],
  // AND THE PIGMENT ITSELF HAS TO BE GREY, which is a separate leg from the two
  // above, and it is separate because THE VERDICT OF THE DEVELOPED COLOUR ON A
  // GREEN PIGMENT BELONGS TO THE SEAT AND HAS ALREADY CHANGED ONCE. Under the
  // seat this leg was written for, the triplet the six were drawn with -- g
  // over r 1.163 -- developed on the west flank of 01 to chroma 5.6 at hue 159,
  // INSIDE the band the reference reads, so the two legs above would have
  // passed the thing the committente saw. Under the seat this world ships it
  // develops to chroma 12.7 at hue 130 and they catch it. Nothing about the
  // pigment moved between those two sentences. A leg that asks about the
  // PIGMENT is the one that answers the same way on both days, and it is why
  // this one is not folded into the colour. The reference's own lit stone reads
  // 70 / 76 / 69, which is 1.10 between its widest pair, and that is the number.
  pigmentGrey: 1.10,
  // A shadowed face receives the sky term and the ground's return, so this is
  // the share of the sky the material takes and nothing else in a material
  // moves it. IN LINEAR LUMINANCE, which is the space the reference's 4.4 was
  // read in and not the space this file used to compute in: see luminance()
  // above, and the two numbers there.
  //
  // THIS BAND IS THE REFERENCE'S OWN NUMBER AND NO LONGER A CONSOLATION. It
  // used to be 2.6 to 3.6 with "4.4 is not reachable" written beside it, and
  // both halves of that were artefacts of the two corrections above: the
  // encoded luminance halved the render's side of the comparison, and the
  // missing third term put the shadow face at the level of a face lit by a
  // blue sky and nothing else. With the seat modelled as the seat ships and
  // both sides weighed the same way, the material reaches 4.35 against 4.37.
  // The band is the reference plus and minus a tenth of itself.
  sunOverShadow: [4.0, 4.8],
  // What one face's own pigment may spread over, from the tile and the block
  // tint together, on a shadowed face.
  //
  // RE-DERIVED, AND NOT LOOSENED. This number is an ABSOLUTE spread in L*, so
  // it moves when the level of the face it is read on moves -- and the level
  // moved by 3.8 L* when the third term was put into bareFace() above, with
  // nothing in the material changing at all. On the two-term model the
  // delivered material read 1.97 against a band of 3.6; on the seat this world
  // ships it reads 4.18. The three anchors the new band sits between, all on
  // this chain and this seat:
  //
  //   the delivered material                                      4.18
  //   the block tint at 1.4 -- the camouflage the committente saw 11.23
  //   the reference's OWN 01-front, p10 to p90 over its pixels     7.10
  //
  // The last of those is a real ceiling and not a preference: the reference's
  // whole face, with its moss and the halo of its engraving inside it, spreads
  // 7.1, so a MATERIAL that spreads more than that is drawing holes whatever
  // else is true. The band is set clear of it, and it separates the delivered
  // material from the camouflage by 1.4x on one side and 1.9x on the other,
  // where the old pair separated them by 1.1x and 1.3x.
  mottle: 6.0,
  // Nothing on the surface may be as large as the thing the surface is made of.
  tileFeature: 0.19,
  // And the lattice still has to cut a block the size the reference resolves.
  blockMetres: [0.17, 0.22],
  // The moss, by the class of face the reference separates.
  mossShadedFront: [0.0, 5.0],
  mossLitFront: [2.0, 10.0],
  mossWestFlank: [10.0, 30.0],

  // ------------------------------------------------------- THE LOOSE STONE
  //
  // The turf on the heads, the squared ruins in the grass and the fountain's
  // basin: one mesh, and the bands it answers to.
  //
  // THE TURF'S LEVEL. The target's cubes on the heads read L* 36 in its own
  // frame (R5 SS1.6). What is held here is the BARE level, for the reason every
  // level in this file is bare, and the band is the reading plus and minus six.
  turfLevel: [30.0, 42.0],
  // AND THAT IT IS THE MOSS AND NOT THE MEADOW, which is the one thing R5 says
  // twice about this green: hue 143 to 155 at chroma 7 to 13 is moss, hue 129 at
  // chroma 27.6 is grass, and a head dressed in grass is a head dressed in the
  // wrong green. The chroma is what separates them cleanly on the bare face --
  // the two hues are 15 degrees apart and the air moves hue, where 27.6 against
  // 13 is a factor of two nothing downstream closes.
  // AND IT HAS TO BE GREEN AT ALL, which is the other end of the same leg and
  // the one an upper bound alone leaves open: the wall's own stone, dressed on a
  // head with the moss tint dropped out of the product, develops at a level
  // INSIDE the band above and would go straight through. A floor under the
  // chroma and a hue band around the target's 143 to 155 is what says green
  // rather than merely says not-grass.
  turfChroma: [6.0, 20.0],
  turfHue: [110, 175],
  // How many cubes the target shows on a head. It gives 4.0% of the band over
  // the lid of the fifth, 1.4% over the second and three bright pixels on the
  // first, which at this scale is a handful and not a fringe: four is the floor
  // and it is a floor rather than a band because the law is a hash and the count
  // is what the law comes to, not what it was asked for.
  turfPerHead: 4,
  // THE RUINS. A metre is the cap the mandate sets and R5 SS1.8 measures the
  // pale squared blocks at 0.3 to 0.4 m in one or two courses; the tallest
  // component in the two windows measures 1.27 m on a stack seen at 17 m with a
  // block's shadow behind it, which is as much shadow as stone.
  ruinHeight: 1.0,
  // And they are the pale stone, held to the band the piles are already held to:
  // the target's lit ruin faces read L* 50.5 at hue 95 (R5 SS1.8).
  ruinCap: [45.0, 58.0],
  ruinCapHue: [90, 115],
  // THE BASIN. 1.61 m across on the target, holding a mirror 1.22 m across
  // (R5 SS1.10, V2-DEV5's own reading).
  basin: [1.55, 1.70],
  // AND WHAT THE WHOLE THING IS ALLOWED TO COST. One draw is what the amendment
  // to E-V2i bought (nine to ten at the pose) and it buys exactly one: a second
  // mesh or a second material in this file spends an allocation the coordinator
  // had to open the ledger for. The triangles are the mandate's own ceiling.
  looseTriangles: 3000,

  // ------------------------------------------------------------- THE INK
  //
  // WHAT IS GATED IS THE COLOUR OF THE STROKE AND NOT ITS WATTAGE, and the
  // reason is a measurement rather than a preference. R5 SS1.7 reads our core at
  // luma 124 to 136 against the target's 224 to 228 and asks for it to be
  // brightened; both sides of that comparison were taken through the campaign's
  // cyan detector (b > 1.5r + 8), and OUR core does not pass it -- swept on the
  // frame, five and a half times the gain moves that reading by four levels
  // while the share of the face the stroke covers goes from 2.8 to 14.6 per
  // cent. The detector was reading the cyan FRINGE of a white stroke. On a mask
  // that does not presume the answer the same stroke already stands at luma 197
  // / 194 / 180 and covers as much of the title as the target's does. So the
  // level gets a floor, wide, and the leg that BITES is the tint.
  inkLuma: [190, 240],
  // The developed blue over red of the core. The delivered material comes to
  // 1.39 and the triple this world wrote before it came to 1.24; the target
  // reads 1.73 to 1.90 and the rest of that is not in this file (see the note
  // at the foot of this guard, and R5 SS5).
  inkBlueOverRed: 1.35,
  // And the developed RED, which is the half of the tint a material can be held
  // to on its own: the target's core stands at 134 to 147 and a stroke redder
  // than the stone it is cut in is a stroke that comes out white whatever its
  // blue does. The delivered material develops to 158 and the one before it to
  // 177.
  inkRed: 168,
  // AND THE PIGMENT ITSELF HAS TO BE BLUE, which is a separate leg from the
  // three above for exactly the reason pigmentGrey is separate from the
  // developed colour: what the tone curve and the grade do to a bright stroke is
  // the seat's and has already changed once. Blue over red of INK_CORE:
  // delivered 28.6, and the triple before it 4.5.
  inkPigmentBlue: 10.0,
};

// --------------------------------------------------------------- the running
const spec = readJson('assets-src/monoliths/masonry-spec.json');
const masonry = read(MASONRY);
const rocksSource = read(ROCKS);
const courses = read(COURSES);

const material = {
  albedo: triple(masonry, 'STONE_ALBEDO'),
  gain: literal(masonry, 'STONE_GAIN'),
  tint: literal(masonry, 'STONE_TINT'),
  skyShare: literal(masonry, 'STONE_SKY_SHARE'),
  rim: literal(masonry, 'STONE_RIM'),
  f0: literal(masonry, 'STONE_F0'),
  arris: literal(masonry, 'STONE_ARRIS_PIGMENT'),
  scale: literal(masonry, 'STONE_LIGHT_SCALE') * literal(masonry, 'STONE_EXPOSURE'),
  mossTint: triple(masonry, 'MOSS_TINT'),
};
const rock = {
  albedo: triple(rocksSource, 'ROCK_ALBEDO'),
  skyShare: literal(rocksSource, 'ROCK_SKY_SHARE'),
};
const law = {
  cover: literal(masonry, 'MOSS_COVER'),
  shade: literal(masonry, 'MOSS_SHADE'),
  reach: literal(masonry, 'MOSS_EDGE_REACH'),
  edgeGain: literal(masonry, 'MOSS_EDGE_GAIN'),
  foot: literal(masonry, 'MOSS_FOOT'),
  footRise: literal(masonry, 'MOSS_FOOT_RISE'),
  head: literal(masonry, 'MOSS_HEAD'),
  west: literal(masonry, 'MOSS_WEST'),
  west0: literal(masonry, 'MOSS_WEST_FROM'),
  west1: literal(masonry, 'MOSS_WEST_TO'),
  westRise: literal(masonry, 'MOSS_WEST_RISE'),
};

// The uniforms the fragment's own weight is written over, in the order it
// writes them. This is the half that the constants being READ cannot cover: a
// law whose numbers are right and whose shape has been rearranged is a law this
// file would keep agreeing with while the wall drew something else.
const WEIGHT_UNIFORMS = ['uMossFoot', 'uMossFootRise', 'uMossHead', 'uMossEdgeGain',
  'uMossReach', 'uMossShade', 'uMossWest', 'uMossWest0', 'uMossWest1', 'uMossWestRise'];

/**
 * Whether the loose stone is still one mesh and one material.
 *
 * COUNTED IN THE SOURCE AND NOT IN THE SCENE, because what the amendment to
 * E-V2i bought is a DRAW and a draw is one mesh with one material submitted
 * once. Cutting the mesh here and counting objects would say nothing: three
 * meshes hung off the same layer are still three calls, and the object this
 * guard builds would report one of them.
 */
export function oneMeshOneMaterial(text) {
  const meshes = (text.match(/new Mesh\(/g) || []).length;
  const materials = (text.match(/new ShaderMaterial\(/g) || []).length;
  return meshes === 1 && materials === 1;
}

/**
 * Whether the fragment's weight still names every term this file walks.
 *
 * ANCHORED ON TWO NAMES AND NOT ON TWO SPELLINGS. This reader used to look for
 * the strings `'float west = '` and `'float weight = '`, trailing space and
 * all, which made `float  west =` or `float west=` -- both of them correct
 * GLSL, and either of them what a formatter would leave behind -- a red guard
 * with the shader untouched. It looks for the two DECLARATIONS instead,
 * whatever whitespace stands inside them, and reads the sentences between: what
 * is guarded is that the weight is still built out of these ten terms, not how
 * the two lines around them are typed.
 */
export function weightNamesEveryTerm(text, names) {
  const from = /\bfloat\s+west\b/.exec(text);
  if (!from) return false;
  const to = /\bfloat\s+weight\b/.exec(text.slice(from.index));
  if (!to) return false;
  const after = from.index + to.index;
  const end = text.indexOf(';', after);
  if (end < 0) return false;
  const body = text.slice(from.index, end + 1);
  return names.every((n) => new RegExp(`\\b${n}\\b`).test(body));
}

const heads = Object.fromEntries(Object.entries(spec.heads.perBlock).map(([k, v]) => [k, v.builtHead]));

// ---------------------------------------------------- THE LOOSE STONE, CUT
//
// Cut here rather than described: src/world/loose-stone.js is arithmetic and
// three.js buffers, and neither needs a browser, so this guard can ask the mesh
// itself how many cubes it laid on which head and how many triangles that came
// to instead of reading a law out of a source and hoping the law is what runs.
// It is the same property that lets tools/guards/guard-avvolgimento.mjs cut a
// rock pile to look at its winding.
const specs = stoneSpecs(spec);
const loose = createLooseStone(specs);

/** How many turf cubes stand on one head, counted off the mesh's own vertices. */
export function turfPerHead(specs2, built) {
  const position = built.mesh.geometry.attributes.position.array;
  const counts = {};
  // The turf is the only family laid ABOVE a block, so a cube whose foot is at
  // the height of a head and inside that head's footprint belongs to it. The
  // ruins and the basin stand on the meadow, metres below every lid.
  for (const block of specs2) {
    const m = block.masonry;
    if (!m || !m.head) continue;
    const low = block.baseY + Math.min(...m.head.map((r) => r.courses)) * m.rise - 0.01;
    const reach = Math.max(block.size[0], block.size[2]) / 2 + 0.2;
    const seen = new Set();
    for (let i = 0; i < position.length; i += 3) {
      const x = position[i]; const y = position[i + 1]; const z = position[i + 2];
      if (y < low) continue;
      if (Math.hypot(x - block.position.x, z - block.position.z) > reach) continue;
      seen.add(`${x.toFixed(3)}|${z.toFixed(3)}`);
    }
    // Four corners of one cube share a column, and a cube is five faces: what a
    // column of x and z is worth is one cube, so the corners are what is counted
    // and divided by the four a cube shows.
    counts[block.id] = Math.round(seen.size / 4);
  }
  return counts;
}

// ==========================================================================
// FOUR VERDICTS THAT WERE WRITTEN TWICE, AND ARE NOW WRITTEN ONCE.
//
// U-GUARDIA-3's census found in the self test below a handful of cases that
// were INEQUALITIES EVALUATED BY HAND -- `![0.62, 1.30, 0.58].every(v => v <
// 1)`, `!(0.125 === 0 && 0.0057 === 0)`, `1.27 > BAND.ruinHeight` -- comparing
// a number written in the case against a band, and never going through the gate
// the run uses. They are not blind (a band moved would move them) but they
// exercise a COPY of the question, so a gate rewritten below leaves them
// agreeing with the version that has stopped shipping.
//
// The four gates are named here, the run calls them, and the self test calls
// the same four with the defect handed to them as a READING: the moss lighter
// than its stone on one channel, the rim and the reflection left standing, a
// ruin at the height the target's own box measures, a basin narrower than its
// water.
// ==========================================================================

/** The moss is darker than the stone it grows on, on all three channels. */
const mossDarkerThanStone = (tint) => tint.every((v) => v < 1);
/** The stone is opaque: no sky is reflected off a still frame. */
const opaqueStone = (m) => m.rim === 0 && m.f0 === 0;
/** No ruin stands taller than the metre the reading allows one. */
const ruinsUnderTheCap = (ruins) => Math.max(...ruins.map((r) => r.height)) <= BAND.ruinHeight;
/** A basin of the size the target draws, and wider than the water it holds. */
const basinHoldsItsWater = (f) => Boolean(f) && f.basinDiameter >= BAND.basin[0]
  && f.basinDiameter <= BAND.basin[1] && f.poolDiameter < f.basinDiameter;

if (process.argv.includes('--self')) {
  const tile = stoneTileData(512);
  const light = readLight();
  const composite = await renderChain();
  const flank = facesAt(heads).find((f) => f.id === '01' && f.name === 'left');
  const front = facesAt(heads).find((f) => f.id === '01' && f.name === 'front');
  const f05 = facesAt(heads).find((f) => f.id === '05' && f.name === 'front');
  // The law as it stood when a lit front came back thirty-six per cent green:
  // one coverage, one lit ratio, a corner and a belly, and no foot at all.
  const painted = { ...law, cover: 0.33, shade: 1 / 5.5, foot: 0, head: 0, west: 0, edgeGain: 0.033, reach: 0.5 };
  const green = { ...material, albedo: [0.276, 0.321, 0.230], skyShare: 1 };
  selfTest('guard-pietra', [
    {
      what: 'the green pigment the six were drawn with is caught as a pigment',
      caught: greyness(green.albedo) > BAND.pigmentGrey,
    },
    {
      // AND THE SEAT'S VERDICT ON IT, WHICH IS NOT THE PIGMENT'S. Under the
      // seat this world ships the developed colour catches the green triplet as
      // well -- chroma 12.7 at the delivered share, 7.6 at a share of one --
      // where under the seat the leg above was written for it developed to
      // chroma 5.6 at hue 159 and went through. Both facts are stated because
      // the pair of them is the argument for keeping the two legs apart.
      what: 'the developed colour catches it too under THIS seat, which it did not under the last',
      caught: (() => {
        const c = lch(composite(bareFace(flank.normal, light, green.albedo, green.scale,
          material.skyShare)));
        return c.C > BAND.litChroma || c.h < BAND.litHue[0] || c.h > BAND.litHue[1];
      })(),
    },
    {
      what: 'a wall that takes the whole of the sky is caught by the ratio on 01',
      caught: (luminance(composite(bareFace(flank.normal, light, green.albedo, green.scale, 1)))
        / luminance(composite(bareFace(front.normal, light, green.albedo, green.scale, 1))))
        < BAND.sunOverShadow[0],
    },
    {
      // AND SO IS THE VALUE THIS FILE HELD BEFORE THE REFIT, which is the
      // injection that says the new band bites rather than accommodates: 0.55
      // was fitted under a seat with a different sky and no third term, and
      // under this one it puts the ratio at 3.76 against the reference's 4.37.
      what: 'the sky share fitted under the other seal is caught by the same leg',
      caught: (luminance(composite(bareFace(flank.normal, light, material.albedo, material.scale, 0.55)))
        / luminance(composite(bareFace(front.normal, light, material.albedo, material.scale, 0.55))))
        < BAND.sunOverShadow[0],
    },
    {
      what: 'the block tint at 1.4 is caught as a hole in the wall',
      caught: mottleSpread(composite, light, front.normal, material, 1.4, 0.62, tile) > BAND.mottle,
    },
    {
      what: 'a tile whose largest feature is two blocks wide is caught',
      caught: tileFeatureMetres(tile, 1.6 * 4) > BAND.tileFeature,
    },
    {
      what: 'the moss law that painted whole blocks green is caught on the lit front of 05',
      caught: mossOfFace(painted, f05, 0.425, spec.course.rise) > BAND.mossLitFront[1],
    },
    {
      what: 'a moss drawn lighter than its stone is caught, on any one of the three channels',
      caught: !mossDarkerThanStone([0.62, 1.30, 0.58])
        && !mossDarkerThanStone(material.mossTint.map((v, i) => (i === 2 ? 1.02 : v))),
    },
    {
      what: 'and the tint the wall ships is under one on all three',
      caught: mossDarkerThanStone(material.mossTint),
    },
    {
      what: 'a sky reflection left standing on the stone is caught, rim or reflection either one',
      caught: !opaqueStone({ rim: 0.125, f0: 0.0057 })
        && !opaqueStone({ ...material, f0: 0.0057 })
        && !opaqueStone({ ...material, rim: 0.125 }),
    },
    {
      what: 'and the stone that ships carries neither',
      caught: opaqueStone(material),
    },
    {
      what: 'a weight rewritten without one of its terms is caught',
      caught: !weightNamesEveryTerm(masonry, [...WEIGHT_UNIFORMS, 'uMossNobodyWrote']),
    },
    {
      // The case that says the anchor is a NAME and not a spelling: the same
      // two declarations typed as a formatter leaves them, and the same ten
      // terms between them, must still pass.
      what: 'and the same weight with the two declarations typed differently still passes',
      caught: weightNamesEveryTerm(
        masonry.replace(/\bfloat\s+west\s*=/, 'float  west=')
          .replace(/\bfloat\s+weight\s*=/, 'float\n        weight ='),
        WEIGHT_UNIFORMS),
    },
    {
      what: 'and a fragment that no longer declares the flank term at all is caught',
      caught: !weightNamesEveryTerm(masonry.replace(/\bfloat\s+west\b/, 'float ovest'),
        WEIGHT_UNIFORMS),
    },
    {
      // ------------------------------------------------- THE LOOSE STONE
      //
      // A HEAD DRESSED IN THE MEADOW'S GREEN instead of in the moss. R5 SS1.6
      // says outright which green the target's cubes are -- hue 143 to 155 at
      // chroma 7 to 13, "il verde del muschio, non quello del prato (h 129,
      // C* 27,6)" -- so the injection is the grass this world actually plants,
      // read out of the same census tools/lighting/render-chain.mjs takes the
      // meadow's own pigment from.
      what: 'a turf cut in the green of the meadow instead of the green of the moss is caught',
      caught: (() => {
        const c = lch(composite(bareFace([0, 1, 0], light, MEADOW_ALBEDO, material.scale,
          material.skyShare)));
        return c.C > BAND.turfChroma[1] || c.L < BAND.turfLevel[0] || c.L > BAND.turfLevel[1];
      })(),
    },
    {
      // And the other way a turf goes wrong: dressed in the stone it stands on,
      // which is what a head gets if the moss tint is dropped from the product.
      what: 'and a turf cut in the stone of the wall, with no moss in it, is caught by the level',
      caught: (() => {
        const c = lch(composite(bareFace([0, 1, 0], light, material.albedo, material.scale,
          material.skyShare)));
        return c.L > BAND.turfLevel[1] || c.C < BAND.turfChroma[0]
          || c.h < BAND.turfHue[0] || c.h > BAND.turfHue[1];
      })(),
    },
    {
      // 1.27 m is the target's own tallest component in these windows, boxed
      // WITH the shadow of a block inside the box: the piece nobody may build,
      // handed to the gate that ships rather than compared here.
      what: 'a ruin built as tall as the bounding box the target boxes one in is caught',
      caught: !ruinsUnderTheCap([...RUINS, { height: 1.27 }]),
    },
    {
      what: 'and the pieces that ship all stand under the metre',
      caught: ruinsUnderTheCap(RUINS),
    },
    {
      // A basin narrower than the water in it is the one defect of this piece
      // that no picture is needed to see, and the reason the two diameters are
      // read from one place.
      what: 'a basin narrower than its own pool is caught',
      caught: !basinHoldsItsWater({ ...FOUNTAIN, poolDiameter: FOUNTAIN.basinDiameter + 0.1 }),
    },
    {
      what: 'and one drawn at half the width the target gives it, which is a bowl and not a basin',
      caught: !basinHoldsItsWater({ ...FOUNTAIN, basinDiameter: BAND.basin[0] / 2 }),
    },
    {
      what: 'and the basin that ships holds its own water',
      caught: basinHoldsItsWater(FOUNTAIN),
    },
    {
      what: 'the loose stone cut as three meshes -- three draws for the price of one -- is caught',
      caught: !oneMeshOneMaterial('new Mesh( new Mesh( new Mesh( new ShaderMaterial('),
    },
    {
      what: 'and cut as one mesh with a material for each family, which is three draws as well',
      caught: !oneMeshOneMaterial('new Mesh( new ShaderMaterial( new ShaderMaterial('),
    },
    {
      // THE INK, AND THE TRIPLE THIS WORLD WROTE BEFORE THIS UNIT. Red 0.44
      // develops to 177 against the target's 134 and to a blue over red of 1.24
      // against 1.90: the white writing, in one number. It is the injection that
      // says the new leg bites rather than accommodates, because the level of
      // that same stroke -- luma 202 -- goes through the level leg untouched.
      what: 'the whitish ink this world wrote before is caught by the tint and not by the level',
      caught: (() => {
        const stone = bareFace(front.normal, light, material.albedo, material.scale,
          material.skyShare);
        const c = composite(stone.map((v, i) => v + [0.44, 1.60, 2.00][i] * 0.78));
        const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
        return (c[2] / c[0] < BAND.inkBlueOverRed || c[0] > BAND.inkRed)
          && lum >= BAND.inkLuma[0] && lum <= BAND.inkLuma[1];
      })(),
    },
    {
      // AND THE ANSWER THE RESEARCH ASKED FOR, which this unit did not give and
      // has to show is caught rather than merely declined: five and a half times
      // the gain, which on the frame moved the cyan reading by four levels and
      // made the white part of the stroke five times wider.
      what: 'brightening the same white stroke instead of colouring it is caught too',
      caught: (() => {
        const stone = bareFace(front.normal, light, material.albedo, material.scale,
          material.skyShare);
        const c = composite(stone.map((v, i) => v + [0.44, 1.60, 2.00][i] * 4.4));
        return c[2] / c[0] < BAND.inkBlueOverRed || c[0] > BAND.inkRed;
      })(),
    },
    {
      what: 'the delivered material passes every one of those',
      caught: opaqueStone(material)
        && mossDarkerThanStone(material.mossTint)
        && mottleSpread(composite, light, front.normal, material, material.tint, material.gain, tile) <= BAND.mottle
        && tileFeatureMetres(tile, 1.6) <= BAND.tileFeature
        && weightNamesEveryTerm(masonry, WEIGHT_UNIFORMS)
        && greyness(material.albedo) <= BAND.pigmentGrey
        && loose.triangles <= BAND.looseTriangles
        && oneMeshOneMaterial(read(LOOSE))
        && ruinsUnderTheCap(RUINS) && basinHoldsItsWater(FOUNTAIN)
        && triple(masonry, 'INK_CORE')[2] / triple(masonry, 'INK_CORE')[0] >= BAND.inkPigmentBlue,
    },
  ]);
}

const report = reporter('guard-pietra -- the material of the six, against what the target reads');
const light = readLight();
const composite = await renderChain();
const tile = stoneTileData(512);
const faces = facesAt(heads).filter((f) => spec.palette.perFace[`${f.id}-${f.name}`]);
const sun = sunVector(light.elevation, light.azimuth);
const nDotS = (n) => n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2];

const density = Number(/const FOG_DENSITY = ([0-9.]+)/.exec(read('src/core/sky.js'))[1]);
report.line('');
report.line(`  the seat   sun ${light.sunStrength} x [${light.sunBeam.map((v) => v.toFixed(3))}]`
  + `   sky ${light.skyStrength} x [${light.skyBalance.map((v) => v.toFixed(3))}]`);
report.line(`  the air    density ${density} at the ground`);
report.line(`  the stone  albedo [${material.albedo}] x ${material.scale}, sky share ${material.skyShare}`);
report.line('');

report.line('  face        n.s      bare L*/C*/h       the target, with its own air');
let shadowLow = 99;
let shadowHigh = 0;
let litOk = true;
for (const f of faces) {
  const t = spec.palette.perFace[`${f.id}-${f.name}`];
  const c = lch(composite(bareFace(f.normal, light, material.albedo, material.scale, material.skyShare)));
  const ns = nDotS(f.normal);
  if (ns < 0) { shadowLow = Math.min(shadowLow, c.L); shadowHigh = Math.max(shadowHigh, c.L); }
  else if (c.C > BAND.litChroma || c.h < BAND.litHue[0] || c.h > BAND.litHue[1]) litOk = false;
  report.line(`  ${`${f.id}-${f.name}`.padEnd(10)} ${ns.toFixed(3).padStart(6)}`
    + `   ${c.L.toFixed(1).padStart(5)} ${c.C.toFixed(1).padStart(5)} ${c.h.toFixed(0).padStart(4)}`
    + `        ${String(t.L).padStart(5)} ${String(t.C).padStart(5)} ${String(t.h).padStart(4)}`);
}
report.line('');
report.check(shadowLow >= BAND.shadowBare[0] && shadowHigh <= BAND.shadowBare[1],
  'the shadowed faces are one stone under one sky, at the level the fit put it',
  `${shadowLow.toFixed(1)} to ${shadowHigh.toFixed(1)} against ${BAND.shadowBare.join(' to ')}`);
report.check(litOk, 'the lit faces are neutral and warm, as the target reads its own',
  `chroma at or under ${BAND.litChroma}, hue inside ${BAND.litHue.join(' to ')}`);
report.check(greyness(material.albedo) <= BAND.pigmentGrey,
  'and the pigment under them is grey, which the developed colour alone cannot say',
  `${greyness(material.albedo).toFixed(3)} between its widest pair, against `
  + `${BAND.pigmentGrey} on the target's own lit stone`);

const flank = faces.find((f) => f.id === '01' && f.name === 'left');
const front = faces.find((f) => f.id === '01' && f.name === 'front');
const lum = (n) => luminance(composite(bareFace(n, light, material.albedo, material.scale, material.skyShare)));
const ratio = lum(flank.normal) / lum(front.normal);
report.check(ratio >= BAND.sunOverShadow[0] && ratio <= BAND.sunOverShadow[1],
  'the wall takes the share of the sky the ratio on 01 asks for',
  `${ratio.toFixed(2)} against ${BAND.sunOverShadow.join(' to ')}, `
  + `where the target reads ${spec.palette.sunOverShadow.target}`);

const mottle = mottleSpread(composite, light, front.normal, material, material.tint, material.gain, tile);
report.check(mottle <= BAND.mottle,
  'no block is drawn at a pigment that reads as a hole in the wall',
  `p10 to p90 of ${mottle.toFixed(2)} L* on a shadowed face, against ${BAND.mottle}`);

const feature = tileFeatureMetres(tile, 1.6);
report.check(feature <= BAND.tileFeature,
  'nothing on the surface is as large as the thing the surface is made of',
  `the tile forgets half of itself in ${feature.toFixed(3)} m, `
  + `against the ${spec.palette.block.periodMetres} m block`);

// The lattice this world is actually cut on, which is the number the tile is
// being asked to stay under. src/world/stone.js derives it from the spec --
// the cell is the target's own mean block width, and the run cut is one minus
// the fraction of blocks the target draws wider than one cell -- so this reads
// the derivation rather than a constant, and it is the cell and not the mean
// RUN that the tile has to be finer than: on 03 the target resolves 7 px at
// 36.6 px/m, which is 0.19 m, and the render's own lattice is that already.
// What made the render read 0.46 m was never the lattice.
const cellMetres = spec.block.meanWidth.inWindow;
const meanRun = cellMetres / (1 - spec.block.doubles.fraction);
report.check(cellMetres >= BAND.blockMetres[0] && cellMetres <= BAND.blockMetres[1],
  'the lattice still cuts a block the size the target resolves',
  `cell ${cellMetres.toFixed(4)} m against ${BAND.blockMetres.join(' to ')}, `
  + `mean run ${meanRun.toFixed(3)} m over a run cut of ${(1 - spec.block.doubles.fraction).toFixed(2)}`);

report.line('');
report.line('  face        class            law %    target %');
let mossOk = true;
for (const f of faces) {
  const key = `${f.id}-${f.name}`;
  const ns = nDotS(f.normal);
  const got = mossOfFace(law, f, ns, spec.course.rise);
  const narrow = f.span < 2.2;
  const westward = -f.normal[0] > law.west0;
  const kind = narrow && westward ? 'west flank'
    : narrow ? 'flank' : ns > 0 ? 'lit front' : 'shaded front';
  const band = kind === 'west flank' ? BAND.mossWestFlank
    : kind === 'lit front' ? BAND.mossLitFront
      : kind === 'shaded front' ? BAND.mossShadedFront : null;
  if (band && (got < band[0] || got > band[1])) mossOk = false;
  report.line(`  ${key.padEnd(10)}  ${kind.padEnd(14)} ${got.toFixed(1).padStart(6)}`
    + `${String(spec.palette.perFace[key]['moss%']).padStart(10)}`);
}
report.check(mossOk, 'the moss grows by the class of face the target separates',
  `shaded fronts ${BAND.mossShadedFront.join(' to ')}, lit fronts ${BAND.mossLitFront.join(' to ')}, `
  + `west flanks ${BAND.mossWestFlank.join(' to ')}`);
report.check(mossDarkerThanStone(material.mossTint),
  'the moss is darker than the stone it grows on, on all three channels',
  `[${material.mossTint}] against the target's [${spec.palette.moss.tintOverStoneBeside}]`);
report.check(weightNamesEveryTerm(masonry, WEIGHT_UNIFORMS),
  'and the fragment still writes the weight this file walks',
  `${WEIGHT_UNIFORMS.length} terms named`);

report.check(opaqueStone(material),
  'the stone is opaque: no sky is reflected off a still frame',
  `rim ${material.rim}, F0 ${material.f0}`);
report.check(material.arris > 1,
  'the dressed edge is lighter than the flat it was cut from, as the spec reads it',
  `${material.arris} against the spec's ${spec.chamfer.lighten.join(' to ')}`);

const cap = lch(composite(bareFace([0, 1, 0], light, rock.albedo, material.scale, rock.skyShare)));
report.check(rock.albedo[0] > rock.albedo[1] && rock.albedo[1] > rock.albedo[2],
  'the rock is a second stone, warm where the wall is grey',
  `[${rock.albedo}] against the wall's [${material.albedo}]`);
report.check(cap.h >= 40 && cap.h <= 130,
  'and its lit cap develops warm, not blue',
  `hue ${cap.h.toFixed(0)} against the target's ${spec.palette.rocks.litFaces.h}`);

// --------------------------------------------------------- THE LOOSE STONE
report.line('');
report.line(`  the loose stone   ${loose.cubes} cubes, ${loose.triangles} triangles, `
  + `one mesh and one material  (turf ${loose.counts.turf} / ruins ${loose.counts.ruins} `
  + `/ basin ${loose.counts.basin})`);

// (a) THE TURF ON THE HEADS. Two legs, and they are two because a green that is
// the right level and the wrong green is exactly what the target rules out.
const turf = turfPerHead(specs, loose);
const heavy = Object.entries(turf).filter(([id]) => ['01', '02', '05'].includes(id));
const turfColour = lch(composite(bareFace([0, 1, 0], light, TURF_ALBEDO, material.scale, material.skyShare)));
report.line(`  heads             ${Object.entries(turf).map(([id, n]) => `${id}:${n}`).join('  ')}`
  + `   pigment [${TURF_ALBEDO.map((v) => v.toFixed(3))}] -> L* ${turfColour.L.toFixed(1)} `
  + `C* ${turfColour.C.toFixed(1)} h ${turfColour.h.toFixed(0)}`);
report.check(heavy.every(([, n]) => n >= BAND.turfPerHead),
  'the heads the target dresses in turf are dressed in it',
  `${heavy.map(([id, n]) => `${id}:${n}`).join(', ')} cubes against ${BAND.turfPerHead} each`);
report.check(turfColour.L >= BAND.turfLevel[0] && turfColour.L <= BAND.turfLevel[1]
  && turfColour.C >= BAND.turfChroma[0] && turfColour.C <= BAND.turfChroma[1]
  && turfColour.h >= BAND.turfHue[0] && turfColour.h <= BAND.turfHue[1],
  'and it is the MOSS of the target and not the grass of its meadow',
  `L* ${turfColour.L.toFixed(1)} in ${BAND.turfLevel.join(' to ')}, chroma `
  + `${turfColour.C.toFixed(1)} in ${BAND.turfChroma.join(' to ')}, hue ${turfColour.h.toFixed(0)} `
  + `in ${BAND.turfHue.join(' to ')}: the target reads L* 36 C* 7.4 h 145 on the head of 05 `
  + 'and calls the meadow beside it C* 27.6 at h 129');

// (b) THE RUINS. Squared, pale, and under the metre the mandate caps them at.
const tallest = Math.max(...RUINS.map((r) => r.height));
const ruinCap = lch(composite(bareFace([0, 1, 0], light, RUIN_ALBEDO, material.scale, rock.skyShare)));
report.line(`  ruins             ${RUINS.length} pieces, tallest ${tallest.toFixed(2)} m, `
  + `pigment [${RUIN_ALBEDO}] -> L* ${ruinCap.L.toFixed(1)} h ${ruinCap.h.toFixed(0)}`);
report.check(ruinsUnderTheCap(RUINS),
  'no ruin stands taller than the metre the reading allows one',
  `${tallest.toFixed(2)} m against ${BAND.ruinHeight}, where the target's own tallest `
  + 'component in these windows boxes at 1.27 m with the shadow of a block inside the box');
report.check(ruinCap.L >= BAND.ruinCap[0] && ruinCap.L <= BAND.ruinCap[1]
  && ruinCap.h >= BAND.ruinCapHue[0] && ruinCap.h <= BAND.ruinCapHue[1],
  'the ruins are the pale stone of the rocks and not the grey of the wall',
  `L* ${ruinCap.L.toFixed(1)} at hue ${ruinCap.h.toFixed(0)}, against the target's `
  + `${spec.palette.rocks.litFaces.L} at ${spec.palette.rocks.litFaces.h}`);
report.check(RUIN_ALBEDO === rock.albedo || RUIN_ALBEDO.every((v, i) => v === rock.albedo[i]),
  'and it is the SAME triple and not a second copy of it',
  `[${RUIN_ALBEDO}] read from src/world/rocks.js`);

// (c) THE BASIN. It has to be wider than the water it holds, which is the one
// thing about a basin that cannot be a matter of taste.
if (FOUNTAIN) {
  report.line(`  the basin         ${FOUNTAIN.basinDiameter.toFixed(2)} m over a pool of `
    + `${FOUNTAIN.poolDiameter.toFixed(2)} m, at (${FOUNTAIN.x.toFixed(2)}, ${FOUNTAIN.z.toFixed(2)})`);
  report.check(basinHoldsItsWater(FOUNTAIN),
    'the fountain stands in a basin of the size the target draws, wider than its own water',
    `${FOUNTAIN.basinDiameter.toFixed(2)} m in ${BAND.basin.join(' to ')} over `
    + `${FOUNTAIN.poolDiameter.toFixed(2)} m of water`);
}

// (d) WHAT IT COSTS. The amendment to E-V2i bought ONE draw at the pose, and
// one mesh with one material is what one draw is.
report.check(loose.triangles <= BAND.looseTriangles,
  'and the whole of it is inside the triangle budget the mandate set',
  `${loose.triangles} against ${BAND.looseTriangles}`);
report.check(oneMeshOneMaterial(read(LOOSE)),
  'the loose stone is ONE mesh and ONE material, which is what the amended draw bought',
  'src/world/loose-stone.js builds new Mesh once and new ShaderMaterial once');

// ---------------------------------------------------------------- THE INK
report.line('');
const inkCore = triple(masonry, 'INK_CORE');
const inkGain = literal(masonry, 'INK_GAIN');
const inkOn = (n) => {
  const stone = bareFace(n, light, material.albedo, material.scale, material.skyShare);
  return composite(stone.map((v, i) => v + inkCore[i] * inkGain));
};
const ink01 = inkOn(front.normal);
const inkLuma = 0.299 * ink01[0] + 0.587 * ink01[1] + 0.114 * ink01[2];
const inkBR = ink01[2] / ink01[0];
report.line(`  the ink           core [${inkCore}] x ${inkGain} -> `
  + `${ink01.map((v) => Math.round(v)).join('/')}   luma ${inkLuma.toFixed(0)}  B/R ${inkBR.toFixed(2)}`);
report.line(`  the target's                                        134/248/254   luma 224  B/R 1.90`);
report.check(inkLuma >= BAND.inkLuma[0] && inkLuma <= BAND.inkLuma[1],
  'the writing burns at the level the target writes at',
  `${inkLuma.toFixed(0)} in ${BAND.inkLuma.join(' to ')}, against the target's 224 to 228`);
report.check(inkBR >= BAND.inkBlueOverRed && ink01[0] <= BAND.inkRed,
  'and it is CYAN and not white, which is the half of it a material owns',
  `blue over red ${inkBR.toFixed(2)} at or over ${BAND.inkBlueOverRed}, red `
  + `${Math.round(ink01[0])} at or under ${BAND.inkRed}, where the target reads 1.90 and 134`);
report.check(inkCore[2] / inkCore[0] >= BAND.inkPigmentBlue,
  'and the pigment under it is blue, which the developed colour alone cannot say',
  `${(inkCore[2] / inkCore[0]).toFixed(1)} between blue and red of INK_CORE, `
  + `against ${BAND.inkPigmentBlue}`);

report.line('');
if (Math.abs(density - 0.0059) > 1e-9) {
  report.note(`the air of this tree is ${density} where the trunk fits 0.0059. Every level above is `
    + 'BARE and unaffected, but the picture this branch draws puts the front of 01 at L* 22.2 '
    + 'where the same material under the trunk\'s air puts it at 12.2 against the target\'s 13.0. '
    + 'A crop of this branch is not a crop of this material.');
}
// THE ONE READING THIS MATERIAL CANNOT DELIVER, WITH ITS OWNER NAMED. The leg
// above is on the BARE face and it is green; the FRAME is not, and saying so
// here is the whole point of printing a residue instead of widening a band.
report.note('and on the FRAME at the fitted pose that same ratio reads 2.61, not 4.35: the air puts '
  + 'a floor under a shadowed face that no share of the sky can take off. Measured, not argued -- '
  + 'the six repainted BLACK at the same pose still develop to L* 3.3 on 01-front and 7.5 on '
  + '02-front, which is the haze alone. The two numbers that set that floor belong to the seat '
  + 'and not to this material: FOG_DENSITY in src/core/sky.js and BOUNCE_SHARE in '
  + 'src/world/face-light.js. '
  + 'Owner: E-LUCE');
report.note('same reading, same owner, on the LIT faces: bare they develop warm (hue 114 to 134 '
  + 'against 134 to 190 on the reference), and on the frame they come back at 186 to 224. The turn '
  + 'is the air and the cube, both downstream of this file, and it is the residue R5 recorded as '
  + 'sky + haze + LUT rather than pigment. Owner: E-LUCE');
report.note('the target is not consistent with one sun (masonry-spec.json, palette.why): 04-front '
  + 'and 05-front both look south-west and the target has one at 19.1 and the other at 26.3, so '
  + 'two faces miss by ten levels whatever the pigment is');
report.note('the ink reaches 1.39 of blue over red where the target reads 1.90, and the remaining '
  + 'third is not in this material: fitted offline through the delivered chain, the best any triple '
  + 'can do here is 1.38 -- at a red of 0.02, a stroke with no red in it at all -- because what sets '
  + 'the final hue is the stone the stroke is added TO and the 32-cube grade that follows it. '
  + 'R5 SS5 says the same and names the same owner. Owner: E-LUCE / D5');
report.note('the readings that need a browser -- the course under autocorrelation, the moss a '
  + 'detector can see, the block period on 03 -- belong to the session gate; what is above is '
  + 'what that gate is read against');
report.end();
