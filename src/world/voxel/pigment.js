// THE COLOUR OF ONE CUBE, AS ARITHMETIC BOTH SIDES CAN RUN.
//
// WHY THIS FILE EXISTS AT ALL, AND IT IS NOT TIDINESS. The offline chain that
// solves the orientation ladder -- tools/lighting/render-chain.mjs -- takes a
// material's pigment and carries it through the light, the tone curve and the
// grade cube to a pixel, under plain node, so a guard can ask at every commit
// what previously needed a screenshot. It could do that while the pigment was
// ONE albedo: a regular expression over the text of material.js lifted the
// triple out and the chain went on. The moment the pigment became a FIELD --
// a number that depends on where the cube stands -- that stopped working, and
// with it stopped the only offline reading of the meadow's own colour.
//
// So the pigment is a pure function here, and the fragment shader below is the
// same arithmetic in another language. Both are in this file, side by side, for
// the one reason that matters: two copies in two files drift, and the drift is
// invisible -- the page keeps drawing and the guard keeps passing, each on its
// own idea of what the meadow is. Kept together, a change that misses one is a
// change a reader can see missing.
//
// AND IT RUNS UNDER NODE, which is why nothing here reaches three.js, the DOM
// or a JSON import: the albedos are plain arrays and the shader is a string.
// src/world/voxel/pure.js re-exports it, and that is the door every offline
// tool comes through.
//
// THE PROOF IS MEASURED, NOT ASSERTED. fondazione/lav/pg-gemello.mjs samples ten
// thousand columns off the live page with the light switched to one and compares
// the pixel against this function's own answer; the maximum error it reports is
// what "the same arithmetic" is worth here.
//
// THE ONE RULE THE BUDGET RESTS ON IS UNTOUCHED. Nothing per voxel is stored:
// the field is rebuilt in the fragment from the cube's own integer cell, so a
// merged rectangle still stands for a hundred cubes and the greedy fusion keeps
// the 2.3-3.3x it is worth. Zero texture reads, zero vertex attributes, zero
// extra draws.

/**
 * THE FIELD IS A FUNCTION OF X AND Z AND NOT OF HEIGHT, and that is a finding
 * rather than a simplification.
 *
 * A patch of meadow that reads pale reads pale from its top face down to its
 * foot: the target's bright family is COMPACT (its boundary touches its own
 * kind 57 points above the shuffle null, where ours managed 33), and a draw
 * taken per cube paints the top of a stack and leaves its flank, which is a
 * stripe and not a family.
 *
 * It also closes the dark floor for nothing. The deepest rung the estimator
 * finds -- a cube top against the darkest pixel under it -- was reading 0.201
 * against the target's 0.365 because the top and the flank under it were two
 * INDEPENDENT draws from a multiplier that covered 62 to 1. With the tint a
 * function of the column, that pair shares one tint exactly, the rung goes back
 * to being the orientation ladder alone, and no clamp had to buy it.
 */

/** How the two octaves and the residue are laid out, in cubes and in amplitude. */
export const PIGMENT = {
  // THE ZONES. Five cubes is half a metre, and it is the wavelength the target
  // asks for rather than one that looked right: the slow field of the target
  // carries half of the meadow's whole spread (a variance share of 0.516 above
  // three cubes, against our 0.151) and its plaques correlate at Moran +0.310.
  // A single octave at a few cubes is the shape both of the references the
  // research found -- Minecraft's per-biome colormap, which is a field with
  // autocorrelation near one inside a region, and SpeedTree's world-space hue
  // variation, which is a continuous field and not a random() per element. The
  // target sits between the two, so we sit between the two.
  slowCubes: 11.0,
  // AND THE OCTAVE THAT MAKES TWO NEIGHBOURS DIFFERENT. Without it the zones
  // are smooth and the meadow loses the reading the target has MORE of than we
  // do: the ratio between two cube tops a cube apart is 1.92 at its ninetieth
  // percentile on the target and was 1.40 here. A cube and a half is short
  // enough that two neighbours sample it two thirds of a lattice step apart,
  // and short enough that a blur at three cubes takes it away again -- which is
  // what keeps it from spending the slow field's own share.
  midCubes: 2.5,
  // The residue, so that two cubes inside one zone are never identical. It is
  // the only term that is a draw per cube, and it is the smallest.
  slow: 2.60,
  mid: 0.75,
  grain: 0.18,
  // THE BAND, AND IT IS A FLOOR BEFORE IT IS A CEILING. What shipped covered
  // 0.10 to 6.18 -- sixty two to one between the palest and the darkest cube of
  // ONE material under ONE light -- and that is where the chequerboard came
  // from. The target never lets a face fall below 0.365 of a top.
  tintFloor: 0.72,
  tintCeil: 1.72,
  // A little of the spread in hue as well as in level, because a meadow varies
  // in both and a pure luminance jitter reads as dirt on one colour. It rides
  // the SLOW field, so the hue moves by zones like the level does.
  hue: 0.22,
};

/**
 * The four lattices are offset from one another so that two of them never ask
 * the hash the same question at the same place. The numbers are arbitrary and
 * are written here once: the shader below reads them from this object, so the
 * two languages cannot come to hold different ones.
 *
 * THE GRAIN'S PAIR IS WHOLE AND THE OTHERS ARE NOT, and that is the twin's
 * doing rather than a taste. pigHash multiplies its argument up past five
 * thousand before taking a fraction of it, so a float's last bit at that
 * magnitude is worth about half a thousandth of the draw -- and where a draw
 * lands across a wrap, two languages that round one operation differently do
 * not return neighbouring numbers, they return unrelated ones. The noise's own
 * calls hand the hash a floor(), which is whole by construction. The grain's did
 * not, and now does.
 */
export const PIGMENT_SEEDS = {
  zone: [3.7, 61.1], mid: [19.7, 4.3], grain: [57.0, 91.0], hue: [11.9, 73.4],
};

/**
 * The two families, in linear light. Grass first, and it does not move: the
 * research measured its hue at 116-117 degrees and its chroma at 39.0 in both
 * pictures, and what was wrong with the meadow was the SHAPE of its draw.
 */
export const ALBEDO = {
  meadow: [0.272, 0.452, 0.0],
  // BARE EARTH, SOLVED THROUGH THE CHAIN AND NOT QUOTED FROM THE TARGET.
  //
  // The target's bare ground reads 121/105/77 where the grass beside it reads
  // 71.5/86.8/23.0. Quoting the first triple at this material would be quoting
  // the target's light and the target's grade as well as its earth. What
  // travels is the RATIO, taken in linear light, and it is carried through this
  // frame's own chain by tools/lighting/render-chain.mjs -- the method E-V7i put
  // on the campaign's table and U-LUCE-1 used on the paving.
  //
  // AND THE RAW RATIO DOES NOT TRAVEL -- tried and thrown away rather than
  // assumed. On the ground band of the two pictures the target's earth is 3.18
  // times its own grass and ours is 1.47 times ours, and asking for the first
  // here solves to an albedo of 4.12: an albedo over one is the signature of a
  // light being repaired with a pigment. The cause is measured and it is not the
  // earth -- in that same band the target's grass reads 38 and ours reads 83,
  // because the target shows far more face in shade than we do. That is the
  // relief, it is unit A's, and B named it as risk 6 before this pass began.
  //
  // WHAT TRAVELS IS THE DISTANCE IN CIELAB between the two families, which the
  // research published read with one estimator on both pictures: the target's
  // earth stands 9.7 L* ABOVE its own grass, at chroma 25.3 and hue 82 degrees.
  // Re-read here on the same window that is 10.5 L*, chroma 26.2, hue 82. That
  // distance does not depend on either picture's own level, which is what makes
  // it a bridge, and it is the same form as the meadow's albedo above:
  // difference, not value.
  //
  // AND THE DISTANCE DOES NOT CLOSE EITHER, WHICH IS THE HONEST LANDING. Solved
  // through the chain for our own grass plus 10.5 L*, the first answer overshot
  // downwards: the family the estimator SELECTS moves with the albedo, because
  // "earth" is whichever pixels are warm and saturated enough to be called earth,
  // and a darker albedo drops the shaded flanks out of the band and takes the
  // bright tops with them. Two frames of fit later the response is measured
  // rather than modelled -- 0.504 of red reads L* 35.3 and 0.696 reads 40.7 --
  // and reaching 50.2 from there extrapolates to a red albedo above one. An
  // albedo over one is the signature of a light being repaired with a pigment,
  // and this file will not sign that.
  //
  // WHAT IT LANDS ON INSTEAD IS THE TARGET'S EARTH ITSELF, and it lands almost
  // exactly:
  //
  //                          L*     chroma    hue
  //     the day target      42.4      26.2     82
  //     before this pass    59.4      17.3     84   -- washed beige
  //     after               40.7      24.6     82
  //
  // The hue was already right, as the research said. What was wrong was that the
  // earth stood seventeen levels too light and a third short of its chroma, and
  // both closed together because both are the same albedo.
  //
  // THE RESIDUE IS THE MEADOW'S LEVEL AND NOT THE EARTH'S. The distance between
  // the two families still reads +1.1 L* here against the target's +10.5, and
  // the reason is in the same table read one row up: our grass sits at 39.6
  // where the target's sits at 31.9. The earth is on its mark; the ground it is
  // measured against is seven and a half levels high, and that is the tone
  // curve's ceiling of E-V1c.2, parked at the light's own window.
  earth: [0.696, 0.423, 0.119],
  // THE STALK OF A FLOWER, AND IT IS THE MEADOW'S OWN GREEN MOVED BY THE THREE
  // WORDS THE COMMITTENTE USED AND BY NOTHING ELSE.
  //
  // E-DECISIONI9.1: <<il colore degli STELI e' un verde piu' intenso, leggermente
  // piu' scuro, MAI MARRONE, che varia un poco di gradazione per zona>>.
  //
  // It is DERIVED and not quoted, for the same reason the bare earth above is
  // derived: a triple read off the target's stalk would be quoting the target's
  // light and the target's grade along with its stem, and E-ERBA-A 9 declares
  // that its own reading of the stalk is a hand reading on two exemplars rather
  // than a census -- <<il rilevatore automatico dello stelo non regge, e l'ho
  // lasciato nel banco rotto e dichiarato invece di pubblicarne i numeri>>. So
  // what enters is the DIFFERENCE, which is what the committente actually said:
  //
  //   piu' intenso        the green is pulled further from the two either side
  //                       of it: the red comes down by a fifth, and the blue
  //                       stays where the meadow's is, which is nought.
  //   leggermente piu'    the whole triple is taken down 12%, which is one step
  //   scuro               of the ladder and reads as <<leggermente>>.
  //   MAI MARRONE         the constraint, and it is the one this file can hold
  //                       by construction rather than by a number: brown is red
  //                       over green, and this triple's green is 2.0 times its
  //                       red where the meadow's is 1.66 and the bare earth's is
  //                       0.61. A stalk drawn from here cannot go brown however
  //                       the light moves, because there is no red in it to go
  //                       brown with.
  //
  //     meadow   0.272 / 0.452 / 0.000    green over red 1.66
  //     stalk    0.191 / 0.398 / 0.000    green over red 2.08, level 0.88x
  //     earth    0.696 / 0.423 / 0.119    green over red 0.61
  stalk: [0.191, 0.398, 0.0],
};

/** Per-family overrides. Bare earth does not carry the meadow's hue jitter:
 *  what a meadow varies along is green against the two either side of it, and
 *  earth does not. */
export const FAMILY = {
  meadow: {},
  earth: { hue: 0.10 },
  // The mat of grass is the meadow: same albedo, same field, same zones. It is an
  // entry and not an omission, because a family that is deliberately identical to
  // another has to say so somewhere -- a mat drawing its own field over the
  // ground it stands on would put a seam under every blade (see bladeSettings()
  // in ./material.js for the measurement that says the pigment is not what is
  // wrong with our grass).
  blade: {},
  // AND THE STALK CARRIES NO FIELD AT ALL TODAY, WHICH IS DECLARED HERE BECAUSE
  // THIS IS WHERE A READER LOOKS FOR IT. <<Varia un poco di gradazione per zona>>
  // (E-DECISIONI9.1) is the two slow octaves above, rebuilt in a fragment out of
  // a cube's own cell; a flower is an INSTANCE and its fragment has no cell, so
  // the field would have to arrive as an attribute per instance or as a second
  // copy of this arithmetic in the flower's own shader. The colour is here, the
  // field is a step, and the step is priced in the verbale of U-ERBA-1.
  stalk: { hue: 0 },
};

// ------------------------------------------------------------------ the twin
//
// EVERY STEP GOES THROUGH Math.fround, and that is the whole point of writing it
// this way. The shader runs in highp, which is a 32 bit float; a double here
// would agree with it to six or seven digits and disagree in the last, and the
// disagreement would be invisible until a guard's literal sat on the boundary.
// Rounding each operation to a float makes this the SAME arithmetic rather than
// a good approximation of it.
const f = Math.fround;
const fract = (x) => f(x - Math.floor(x));
// mix() IS SPELLED THE WAY THE SPECIFICATION SPELLS IT, x*(1-a) + y*a, and not
// the algebraically equal x + a*(y-x). The first version of this twin used the
// second and read a systematic two parts in a thousand against the GPU on every
// single sample -- the signature of a different rounding, not of noise -- and at
// the six hundredths of a per cent of columns where the hash's own draw sits on
// a wrap, that rounding was the difference between two neighbouring numbers and
// two unrelated ones.
const mix = (a, b, t) => f(f(a * f(1.0 - t)) + f(b * t));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The hash of one lattice point. The same shape as the pair the dome and the
 * weather dither with -- a sine of a coordinate tens of thousands of radians in
 * spends its whole cost on range reduction, so there is no transcendental.
 *
 * IT IS KEPT SMALL BETWEEN THE TWO FRACTIONS, and that is the twin's doing and
 * a measurement rather than a preference. The version this started from added
 * a dot with 33.33 in it and then took a fraction of a product near five
 * thousand. A float's last bit at five thousand is worth half a thousandth of
 * the argument, and where an argument lands within that of a whole number, two
 * languages that round ONE operation differently -- a compiler contracting a
 * multiply and an add into one instruction is enough -- do not return
 * neighbouring draws, they return unrelated ones. Measured against the GPU over
 * ten thousand columns, that shape disagreed on 0.2% of channels, by as much as
 * 0.19 of an albedo. Wrapping the sum back under one and taking the last
 * fraction of a product near sixty four leaves the same hash, and the
 * disagreement with it: the figure the verbale carries is what this version
 * reads.
 */
export function pigHash(x, z) {
  let qx = fract(f(x * 0.1031));
  let qy = fract(f(z * 0.1030));
  let qz = fract(f(x * 0.0973));
  // dot(q, q.yzx + 3.33), summed left to right the way a compiler unrolls it.
  const d = f(f(f(qx * f(qy + 3.33)) + f(qy * f(qz + 3.33))) + f(qz * f(qx + 3.33)));
  qx = fract(f(qx + d)); qy = fract(f(qy + d)); qz = fract(f(qz + d));
  return fract(f(f(f(qx + qy) * qz) * 32.0));
}

/** Value noise on that lattice: four corners and a smoothstep between them. */
export function pigNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = f(x - ix);
  const fz = f(z - iz);
  const ux = f(f(fx * fx) * f(3.0 - f(2.0 * fx)));
  const uz = f(f(fz * fz) * f(3.0 - f(2.0 * fz)));
  const a = pigHash(ix, iz);
  const b = pigHash(ix + 1, iz);
  const c = pigHash(ix, iz + 1);
  const d = pigHash(ix + 1, iz + 1);
  return mix(mix(a, b, ux), mix(c, d, ux), uz);
}

/**
 * The field itself, before the band closes on it.
 *
 * THE SLOW TERM IS TWO OCTAVES AND NOT ONE, and that is measured rather than
 * ornamental. The statistic the whole pass is judged on -- what survives a blur
 * at three cubes -- attenuates a wavelength by exp(-2 pi^2 sigma^2 / lambda^2),
 * so a single octave at five cubes keeps a fifth of its own variance through
 * that blur and one at twelve keeps three quarters. A field with only the short
 * octave cannot move the number however loud it is made; a field with only the
 * long one moves it, and reads as a gradient across a window rather than as
 * zones, AND its reading swings by a third from one crop to the next because a
 * window of meadow holds barely one period of it. Both octaves together are the
 * shape that is stable on the number and legible to the eye, and the second is
 * the first halved: one more call, no new uniform.
 */
export function pigField(x, z, tune = PIGMENT) {
  const slowScale = f(1.0 / tune.slowCubes);
  const midScale = f(1.0 / tune.midCubes);
  const zoneA = f(pigNoise(f(x * slowScale), f(z * slowScale)) - 0.5);
  const zoneB = f(pigNoise(f(f(f(x * slowScale) * 2.0) + PIGMENT_SEEDS.zone[0]),
    f(f(f(z * slowScale) * 2.0) + PIGMENT_SEEDS.zone[1])) - 0.5);
  const zone = f(zoneA + f(0.5 * zoneB));
  const mid = f(pigNoise(f(f(x * midScale) + PIGMENT_SEEDS.mid[0]),
    f(f(z * midScale) + PIGMENT_SEEDS.mid[1])) - 0.5);
  const grain = f(pigHash(f(x + PIGMENT_SEEDS.grain[0]), f(z + PIGMENT_SEEDS.grain[1])) - 0.5);
  return f(f(f(tune.slow * zone) + f(tune.mid * mid)) + f(tune.grain * grain));
}

/** The multiplier one column's pigment carries, with the band closed on it. */
export function pigTint(x, z, tune = PIGMENT) {
  return clamp(f(1.0 + pigField(x, z, tune)), tune.tintFloor, tune.tintCeil);
}

/**
 * THE PIGMENT OF ONE CUBE: a family and a column, in, an albedo out.
 *
 * @param {string|number[]} family  'meadow', 'earth', or a base albedo triple
 * @param {number} x  the cube's own integer cell along X, in the world's frame
 * @param {number} z  and along Z
 * @param {object} tune  the tunables, so a sweep is an argument and not an edit
 * @returns {number[]} the albedo, in linear light
 */
export function pigmentOf(family, x, z, tune = PIGMENT) {
  const base = Array.isArray(family) ? family : ALBEDO[family];
  const settings = Array.isArray(family) ? tune : { ...tune, ...FAMILY[family] };
  const t = pigTint(x, z, settings);
  const slowScale = f(1.0 / settings.slowCubes);
  const h = f(pigNoise(f(f(x * slowScale) + PIGMENT_SEEDS.hue[0]),
    f(f(z * slowScale) + PIGMENT_SEEDS.hue[1])) - 0.5);
  const warm = f(1.0 - f(settings.hue * h));
  const green = f(1.0 + f(settings.hue * h));
  return [f(f(base[0] * t) * warm), f(f(base[1] * t) * green), f(f(base[2] * t) * warm)];
}

/**
 * WHAT THE FIELD COMES TO, over a square of columns: the tint's own quantiles
 * and the albedo at each of them.
 *
 * A GUARD NEEDS THIS AND CANNOT GUESS IT. The orientation ladder is a ratio
 * between three faces of ONE material, and while the pigment was a single
 * triple there was one material to carry through the chain. A field has a
 * DISTRIBUTION, and the ladder is not quite invariant to which end of it a
 * column sits at -- the tone curve is not a straight line, so a pale column and
 * a dark one do not compress by the same factor. So the gate reads the ladder at
 * the field's own median and PRINTS it at the two ends, which is the honest
 * shape of the question rather than one arbitrary column.
 *
 * The square is deterministic and the sampling is every column of it, so two
 * runs return the same numbers to the last digit.
 *
 * @param {string|number[]} family  as pigmentOf takes it
 * @param {object} tune
 * @param {number} side  how many columns on a side
 */
export function pigmentCensus(family, tune = PIGMENT, side = 256) {
  const settings = Array.isArray(family) ? tune : { ...tune, ...FAMILY[family] };
  const tints = [];
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) tints.push(pigTint(x, z, settings));
  tints.sort((a, b) => a - b);
  const at = (q) => tints[Math.floor(q * (tints.length - 1))];
  const mean = tints.reduce((s, v) => s + v, 0) / tints.length;
  const dev = Math.sqrt(tints.reduce((s, v) => s + (v - mean) ** 2, 0) / tints.length);
  const base = Array.isArray(family) ? family : ALBEDO[family];
  const albedoAt = (t) => base.map((c) => c * t);
  return {
    n: tints.length,
    mean: +mean.toFixed(4),
    sd: +dev.toFixed(4),
    p05: +at(0.05).toFixed(4),
    p50: +at(0.50).toFixed(4),
    p95: +at(0.95).toFixed(4),
    atFloor: +(tints.filter((v) => v <= settings.tintFloor + 1e-6).length / tints.length).toFixed(4),
    atCeil: +(tints.filter((v) => v >= settings.tintCeil - 1e-6).length / tints.length).toFixed(4),
    albedo: { p05: albedoAt(at(0.05)), p50: albedoAt(at(0.50)), p95: albedoAt(at(0.95)) },
  };
}

// ------------------------------------------------------------------ the GLSL
//
// The seeds come from the object above rather than being typed again, which is
// the one thing that could still let the two halves drift while both looked
// right. Everything else is the twin's body, line for line.
const g = (v) => (Number.isInteger(v) ? `${v}.0` : String(v));

export const PIGMENT_GLSL = /* glsl */`
  uniform vec3 uAlbedo;
  uniform float uSlowCubes;
  uniform float uMidCubes;
  uniform float uSlow;
  uniform float uMid;
  uniform float uGrain;
  uniform float uTintFloor;
  uniform float uTintCeil;
  uniform float uHue;

  float pigHash(float x, float z) {
    vec3 q = fract(vec3(x, z, x) * vec3(0.1031, 0.1030, 0.0973));
    q = fract(q + dot(q, q.yzx + 3.33));
    return fract((q.x + q.y) * q.z * 32.0);
  }

  float pigNoise(float x, float z) {
    float ix = floor(x);
    float iz = floor(z);
    float fx = x - ix;
    float fz = z - iz;
    float ux = fx * fx * (3.0 - 2.0 * fx);
    float uz = fz * fz * (3.0 - 2.0 * fz);
    float a = pigHash(ix, iz);
    float b = pigHash(ix + 1.0, iz);
    float c = pigHash(ix, iz + 1.0);
    float d = pigHash(ix + 1.0, iz + 1.0);
    return mix(mix(a, b, ux), mix(c, d, ux), uz);
  }

  float pigField(float x, float z) {
    float slowScale = 1.0 / uSlowCubes;
    float midScale = 1.0 / uMidCubes;
    float zoneA = pigNoise(x * slowScale, z * slowScale) - 0.5;
    float zoneB = pigNoise(x * slowScale * 2.0 + ${g(PIGMENT_SEEDS.zone[0])},
                           z * slowScale * 2.0 + ${g(PIGMENT_SEEDS.zone[1])}) - 0.5;
    float zone = zoneA + 0.5 * zoneB;
    float mid = pigNoise(x * midScale + ${g(PIGMENT_SEEDS.mid[0])},
                         z * midScale + ${g(PIGMENT_SEEDS.mid[1])}) - 0.5;
    float grain = pigHash(x + ${g(PIGMENT_SEEDS.grain[0])},
                          z + ${g(PIGMENT_SEEDS.grain[1])}) - 0.5;
    return uSlow * zone + uMid * mid + uGrain * grain;
  }

  // The level of one column, band closed.
  float pigTintOf(float x, float z) {
    return clamp(1.0 + pigField(x, z), uTintFloor, uTintCeil);
  }

  // AND THE TURN OF ITS COLOUR, WHICH IS A SEAT OF ITS OWN FOR A READER AND NOT
  // FOR TIDINESS. The hue rides the slow octave so the colour moves by zones
  // exactly as the level does. The ray-marched field of ./campo-material.js
  // takes its LEVEL out of a texel the worker wrote -- one producer for a texel
  // -- and still has to draw this, so the two programs call ONE function
  // instead of spelling one pair of seeds twice, which is the same argument as
  // the one over this file's own head. The amount is an argument because the
  // families differ in it (a meadow varies along green and bare earth does
  // not), and a uniform read in here would tie the seat to whichever family
  // happened to own the program.
  vec3 pigHueOf(float x, float z, float amount) {
    float slowScale = 1.0 / uSlowCubes;
    float h = pigNoise(x * slowScale + ${g(PIGMENT_SEEDS.hue[0])},
                       z * slowScale + ${g(PIGMENT_SEEDS.hue[1])}) - 0.5;
    return vec3(1.0 - amount * h, 1.0 + amount * h, 1.0 - amount * h);
  }

  // The albedo of one column: the two above, in the order they were fitted in.
  vec3 pigmentOf(float x, float z) {
    return uAlbedo * pigTintOf(x, z) * pigHueOf(x, z, uHue);
  }
`;

/** The uniforms the shader above needs, from one tune object. */
export function pigmentUniforms(settings) {
  return {
    uSlowCubes: { value: settings.slowCubes },
    uMidCubes: { value: settings.midCubes },
    uSlow: { value: settings.slow },
    uMid: { value: settings.mid },
    uGrain: { value: settings.grain },
    uTintFloor: { value: settings.tintFloor },
    uTintCeil: { value: settings.tintCeil },
    uHue: { value: settings.hue },
  };
}

/** And the same list on a live material, so a sweep costs a redraw. */
export function refreshPigment(uniforms, settings) {
  uniforms.uSlowCubes.value = settings.slowCubes;
  uniforms.uMidCubes.value = settings.midCubes;
  uniforms.uSlow.value = settings.slow;
  uniforms.uMid.value = settings.mid;
  uniforms.uGrain.value = settings.grain;
  uniforms.uTintFloor.value = settings.tintFloor;
  uniforms.uTintCeil.value = settings.tintCeil;
  uniforms.uHue.value = settings.hue;
}
