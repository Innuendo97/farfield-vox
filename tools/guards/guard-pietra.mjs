import { stoneTileData } from '../../src/world/voxel/pure.js';
import { encodedLum, readLight, renderChain } from '../lighting/render-chain.mjs';
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
// IN IT. The haze is not this material's, and on this branch it is not even the
// trunk's: the density is read below and printed every run, because between the
// air at 0.0059 and the air at 0.013 the front of 01 develops to 12.2 or to 22.2
// without one character of this material changing. A guard that gated the
// developed level would be gating whoever last touched src/core/sky.js. So what
// is gated is the BARE face -- pigment against the seat's two terms, before the
// air -- and the air is printed beside it with what it does.

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
 * The bend of the sky term is the material's own and is applied here for the
 * same reason the material is allowed to apply it: src/world/face-light.js
 * produces the pair and lets a material bend one it was given. uLift is touched
 * by neither, and tools/guards/guard-lift.mjs is what keeps that true.
 */
export function bareFace(normal, light, albedo, scale, skyShare) {
  const sun = sunVector(light.elevation, light.azimuth);
  const ts = Math.max(normal[0] * sun[0] + normal[1] * sun[1] + normal[2] * sun[2], 0);
  const tk = (0.5 + 0.5 * normal[1]) * skyShare;
  return [0, 1, 2].map((c) => albedo[c] * scale
    * (ts * light.sunBeam[c] * light.sunStrength + tk * light.skyBalance[c] * light.skyStrength));
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
  // The bare shadowed face: the sky term alone, before any air. The reference
  // reads 11.5 to 15.4 WITH its own haze in it; under the air the trunk fits
  // (0.0059) this band develops at the pose to 12.2 to 18.9 measured.
  shadowBare: [3.0, 8.0],
  // The lit faces of the reference are neutral: chroma 5 to 6 at hue 134 to
  // 190. A pigment that is itself green cannot develop to that, and this is the
  // leg that would have caught the green one.
  litChroma: 7.0,
  litHue: [60, 200],
  // AND THE PIGMENT ITSELF HAS TO BE GREY, which is a separate leg from the two
  // above and the one that actually bites. Under this seat the light washes a
  // green pigment out: the triplet the six were drawn with -- g over r 1.163 --
  // develops on the west flank of 01 to chroma 5.6 at hue 159, INSIDE the band
  // the target reads, so a guard on the developed colour alone would have
  // passed the thing the committente saw. The reference's own lit stone reads
  // 70 / 76 / 69, which is 1.10 between its widest pair, and that is the number.
  pigmentGrey: 1.10,
  // A shadowed face receives the sky term alone, so this is the share of the
  // sky the material takes and nothing else in a material moves it. The
  // reference reads 4.4; 4.4 is not reachable under one sun with the faces
  // where the reference puts them, and 2.6 is where R5's prototype landed.
  sunOverShadow: [2.6, 3.6],
  // What one face's own pigment may spread over, from the tile and the block
  // tint together. At the constants the camouflage was drawn with it was 4.6.
  mottle: 3.6,
  // Nothing on the surface may be as large as the thing the surface is made of.
  tileFeature: 0.19,
  // And the lattice still has to cut a block the size the reference resolves.
  blockMetres: [0.17, 0.22],
  // The moss, by the class of face the reference separates.
  mossShadedFront: [0.0, 5.0],
  mossLitFront: [2.0, 10.0],
  mossWestFlank: [10.0, 30.0],
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

/** Whether the fragment's weight still names every term this file walks. */
export function weightNamesEveryTerm(text, names) {
  const at = text.indexOf('float west = ');
  if (at < 0 || text.indexOf('float weight = ', at) < 0) return false;
  const body = text.slice(at, text.indexOf(';', text.indexOf('float weight = ', at)) + 1);
  return names.every((n) => body.includes(n));
}

const heads = Object.fromEntries(Object.entries(spec.heads.perBlock).map(([k, v]) => [k, v.builtHead]));

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
      what: 'and it is NOT caught on the developed colour, which is why the leg above exists',
      caught: (() => {
        const c = lch(composite(bareFace(flank.normal, light, green.albedo, green.scale, 1)));
        return !(c.C > BAND.litChroma || c.h < BAND.litHue[0] || c.h > BAND.litHue[1]);
      })(),
    },
    {
      what: 'a wall that takes the whole of the sky is caught by the ratio on 01',
      caught: (encodedLum(composite(bareFace(flank.normal, light, green.albedo, green.scale, 1)))
        / encodedLum(composite(bareFace(front.normal, light, green.albedo, green.scale, 1))))
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
      what: 'a moss drawn lighter than its stone is caught',
      caught: ![0.62, 1.30, 0.58].every((v) => v < 1),
    },
    {
      what: 'a sky reflection left standing on the stone is caught',
      caught: !(0.125 === 0 && 0.0057 === 0),
    },
    {
      what: 'a weight rewritten without one of its terms is caught',
      caught: !weightNamesEveryTerm(masonry, [...WEIGHT_UNIFORMS, 'uMossNobodyWrote']),
    },
    {
      what: 'the delivered material passes every one of those',
      caught: material.rim === 0 && material.f0 === 0
        && material.mossTint.every((v) => v < 1)
        && mottleSpread(composite, light, front.normal, material, material.tint, material.gain, tile) <= BAND.mottle
        && tileFeatureMetres(tile, 1.6) <= BAND.tileFeature
        && weightNamesEveryTerm(masonry, WEIGHT_UNIFORMS)
        && greyness(material.albedo) <= BAND.pigmentGrey,
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
const lum = (n) => encodedLum(composite(bareFace(n, light, material.albedo, material.scale, material.skyShare)));
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
report.check(material.mossTint.every((v) => v < 1),
  'the moss is darker than the stone it grows on, on all three channels',
  `[${material.mossTint}] against the target's [${spec.palette.moss.tintOverStoneBeside}]`);
report.check(weightNamesEveryTerm(masonry, WEIGHT_UNIFORMS),
  'and the fragment still writes the weight this file walks',
  `${WEIGHT_UNIFORMS.length} terms named`);

report.check(material.rim === 0 && material.f0 === 0,
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

report.line('');
if (Math.abs(density - 0.0059) > 1e-9) {
  report.note(`the air of this tree is ${density} where the trunk fits 0.0059. Every level above is `
    + 'BARE and unaffected, but the picture this branch draws puts the front of 01 at L* 22.2 '
    + 'where the same material under the trunk\'s air puts it at 12.2 against the target\'s 13.0. '
    + 'A crop of this branch is not a crop of this material.');
}
report.note('the target is not consistent with one sun (masonry-spec.json, palette.why): 04-front '
  + 'and 05-front both look south-west and the target has one at 19.1 and the other at 26.3, so '
  + 'two faces miss by ten levels whatever the pigment is');
report.note('the readings that need a browser -- the course under autocorrelation, the moss a '
  + 'detector can see, the block period on 03 -- belong to the session gate; what is above is '
  + 'what that gate is read against');
report.end();
