import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { domeRadiance } from '../grade/lib/sky-model.mjs';
import { REPO_ROOT, SUN_SEAT } from './sun.mjs';

// THE WORLD THE BAKES ARE LIT BY, and it is the dome the renderer draws.
//
// The bake scripts hang an equirect behind the scene and call it the sky. The
// one they used to hang, assets-src/sky/sky-equirect.png, is a different object
// from the dome: tools/grade/grade-sky.mjs fits the clear sky TWICE, once
// against the reference's own texels for the picture it writes and once "with no
// surface beside it" for the preset it writes into sky.json, and the renderer
// draws the second one. Measured, on a level patch, upper hemisphere:
//
//   equirect the bakes used   R 0.076  G 0.221  B 0.507   luminance 0.211
//   the dome the renderer draws  0.068     0.263     0.806             0.261
//
// A quarter of the light and a whole step of blue apart. Which means the world
// was baked under a sky nobody ever sees. It is the same family of defect as
// the two suns, one layer further out: not a second direction this time, a
// second sky.
//
// So the world is written here instead, straight out of the preset, by the same
// arithmetic src/core/sky.js draws it with — tools/grade/lib/sky-model.mjs
// domeRadiance, which tools/grade/check-dome.mjs already holds the shader to.
// Nothing is fitted here and nothing is chosen: the file is a picture of the
// seat, and --check reads it back and says so.
//
// THE DISC IS LEFT OUT, and only the disc. The sun stands in the bake as a sun
// lamp of the seat's own angular size, because a bake needs it as a light that
// casts rather than as a bright texel that cannot; putting it in both places
// would count it twice. The AUREOLE stays, and it matters more than it looks:
// it is the one part of this sky that was measured rather than modelled, it
// carries 47% of lift at two degrees from the sun and none by thirty, and it is
// what makes a shadow boundary in this world arrive soft without anybody having
// to widen a sun to make it so.

// Radiance, not PNG, and the reason is measured. Written as eight bit through
// an sRGB transfer the dimmest channel of the dimmest sky — red, high up, away
// from the sun, where the dome is about a hundredth of a unit — comes back
// eleven per cent out, because there are four codes left to say it in. A light
// probe is a float quantity and this is the one file in the repository that has
// no reason to be anything else: it is authoring input, never shipped, and
// Blender reads Radiance natively.
const OUT = join(REPO_ROOT, 'assets-src', 'sky', 'sky-environment.hdr');

// The two weights the runtime and the bakes both read. Small, tracked, and
// beside the probe rather than inside sky.json: sky.json is the sealed dome of
// S1 and grade-sky.mjs rewrites it whole.
const FACTS = join(REPO_ROOT, 'assets-src', 'sky', 'scene-light.json');

// A smooth dome needs no more than this. The sharpest thing left in it once the
// disc is out is the narrow aureole lobe, cos^40, which is some thirteen
// degrees across: forty texels here.
const WIDTH = 2048;
const HEIGHT = 1024;

/** The preset, with the disc taken out and everything else as the seat has it. */
export function environmentPreset(root = REPO_ROOT) {
  const sky = JSON.parse(readFileSync(join(root, SUN_SEAT), 'utf8'));
  const day = sky.day;
  if (!day) throw new Error(`${SUN_SEAT} carries no day preset`);
  return {
    preset: { ...day, disc: { ...day.disc, level: 0 } },
    intensity: Number(sky.intensity),
  };
}

/**
 * Direction of a texel, in the convention build_world hands Blender.
 *
 * Equirect as three.js and the bake scripts read it: u wraps about Y starting
 * from +X, v is the sine of the elevation with the top row at the zenith.
 */
function directionAt(u, v) {
  const phi = (u - 0.5) * 2 * Math.PI;
  const el = (v - 0.5) * Math.PI;
  const c = Math.cos(el);
  return [c * Math.cos(phi), Math.sin(el), c * Math.sin(phi)];
}

// The darkest thing the format says anything about. Below it a quadruple of
// noughts is the honest answer, and it is named rather than repeated because
// the check below has to skip exactly the texels the encoder gives up on.
export const RGBE_ZERO = 1e-32;

/** One RGBE quadruple: Radiance's shared exponent, the same one Blender reads. */
export function toRgbe(r, g, b, out, o) {
  const peak = Math.max(r, g, b);
  if (peak < RGBE_ZERO) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; return; }
  const e = Math.ceil(Math.log2(peak));
  const scale = 256 / (2 ** e);
  out[o] = Math.min(255, Math.floor(r * scale));
  out[o + 1] = Math.min(255, Math.floor(g * scale));
  out[o + 2] = Math.min(255, Math.floor(b * scale));
  out[o + 3] = e + 128;
}

export function fromRgbe(bytes, o) {
  if (bytes[o + 3] === 0) return [0, 0, 0];
  const f = 2 ** (bytes[o + 3] - 128 - 8);
  return [(bytes[o] + 0.5) * f, (bytes[o + 1] + 0.5) * f, (bytes[o + 2] + 0.5) * f];
}

// BELOW THE HORIZON THE WORLD IS THE GROUND, AND THE GROUND IS IN THE SCENE.
//
// This dome is a model of the whole sphere and it continues under the horizon,
// where it is very bright: measured, the lower hemisphere of it carries SEVEN
// TIMES the irradiance of the upper one, because the air mass grows and every
// downward ray is looking through all of it. That is what a sky does; it is not
// what a scene does. In a scene there is a meadow down there, it is modelled,
// and it is a twelfth as bright as the sky.
//
// Left in, it leaks. The ground mesh reaches a hundred metres, so from the top
// of a block every direction within about three degrees below the horizontal
// clears its rim and sees that light — and a block is lit by a band of sky
// pretending to be a band of earth. It is worth measuring rather than assuming:
// see the report for what it did to the stone.
//
// So the probe is cut at the horizon, with one degree of ease so no ring is
// drawn, and the ground below it is the ground.
const HORIZON_EASE_DEG = 1.0;

function belowHorizon(elevationDeg) {
  const t = (elevationDeg + HORIZON_EASE_DEG) / (2 * HORIZON_EASE_DEG);
  return Math.min(1, Math.max(0, t));
}

export function render(preset, bend = null) {
  // Flat scanlines: no run length coding, which is a form Radiance has always
  // allowed and every reader takes, and a file nobody ships is not worth an
  // encoder that could be subtly wrong.
  const header = Buffer.from(
    `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${HEIGHT} +X ${WIDTH}\n`, 'latin1',
  );
  const body = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rgb = [0, 0, 0];
  let peak = 0;
  for (let y = 0; y < HEIGHT; y++) {
    const v = 1 - (y + 0.5) / HEIGHT;
    for (let x = 0; x < WIDTH; x++) {
      const u = (x + 0.5) / WIDTH;
      domeRadiance(preset, directionAt(u, v), rgb);
      const open = belowHorizon((v - 0.5) * 180);
      for (let c = 0; c < 3; c++) rgb[c] *= open;
      // The one door a self test needs: a bake that is deliberately NOT the
      // dome, so that the check below can be shown to refuse one. Nothing on
      // the writing path passes anything here.
      if (bend) bend(rgb);
      peak = Math.max(peak, rgb[0], rgb[1], rgb[2]);
      toRgbe(rgb[0], rgb[1], rgb[2], body, (y * WIDTH + x) * 4);
    }
  }
  return { bytes: Buffer.concat([header, body]), peak };
}

/**
 * The scanlines of a Radiance file, past its header.
 *
 * Stated once and handed to the two readings below, so that they measure the
 * SAME bytes: they used to open the file twice, and two reads of one path is
 * one read too many for a check whose whole business is that two things agree.
 * It also lets the self test measure bytes that were never written to disk.
 */
export function bodyOf(bytes) {
  const head = bytes.indexOf('\n-Y ');
  const start = bytes.indexOf('\n', head + 1) + 1;
  return bytes.subarray(start);
}

// ===========================================================================
// HOW FAR THE FILE IS ALLOWED TO BE FROM THE DOME, AND WHERE THE NUMBER COMES
// FROM.
//
// It comes from the encoder above, in four lines. It is a ceiling and not a
// tolerance: nothing is chosen here and nothing is fitted.
//
//     e    = ceil(log2 P)      the exponent toRgbe picks, P the texel's
//                              largest channel
//     q    = 2^e / 256         what one code of the quadruple is worth
//     byte = floor(v / q)      what is written
//     read = (byte + 0.5) q    what fromRgbe hands back
//
// so every channel comes back within HALF A CODE of where it went in,
//
//     |read - v| <= q/2        every channel, every texel, always,
//
// and since ceil leaves P in (2^(e-1), 2^e],
//
//     q/2 = 2^(e-1)/256 < P/256.
//
// That inequality is the whole of the error in this file, and it is not a
// bound that sits comfortably above what happens: measured over this sky the
// worst reading is at 0.999996 of it, and under the physical dome 0.999999.
// The format is being used to the last bit it has.
//
// THE OLD GATES ASKED FOR SOMETHING THE FORMAT CANNOT GIVE, and it took a
// change of sky to notice. They read the error of every channel RELATIVE TO
// THAT CHANNEL and refused past eight per cent. Under the physical dome, whose
// light is twelve to one blue over red, red still holds nearly ten codes of
// the byte at its darkest and the worst reading in the whole file is five per
// cent: the gate passed with room to spare and looked like a statement about
// the bake. It was not. It was a statement about the COLOUR of that sky.
//
// Under the ramp the light is thirty five to one, and between ten and forty
// degrees of elevation — where the quadratic takes red below both the anchors
// it runs between — a texel reaches a hundred and thirty seven to one. Red is
// down to 0.45 of ONE code in that band, and a channel below one code is
// written as no code at all and handed back as half a code. Which is worst not
// where red is smallest but just under a whole code, where half of it is fifty
// per cent of it: that is the 49.897% the old gate refused, on 18339 of 346281
// readings, every single one of them red.
//
// NOTHING BROKE IN BETWEEN. The encoder is at the floor of the format for both
// skies: the channel that carries the texel never falls below 128.006 codes
// and never reaches 256, which is the top octave of the byte and the whole of
// what a shared exponent has to give. There is no mantissa to move — a lower
// exponent clips the peak, a higher one halves every channel — and no float
// format to move it to, since what reads this file is Blender and nothing in
// this tree consumes one. The weak channel of a dark, saturated sky is not
// something Radiance can carry, and a gate that fails a bake for it is
// measuring the sky's colour and calling it a defect.
//
// SO THE GATES ARE STATED IN THE UNIT THE ERROR IS MADE OF, and each of them
// is the inequality above, read once.
//
//  1. THE TEXEL. |read - v| / (q/2) <= 1, on every channel. The ruler is q out
//     of the DOME's own peak and never out of the file's exponent byte, so a
//     file that wrote the wrong exponent cannot widen the ruler it is judged
//     by. This holds a weak channel to an absolute distance that the texel's
//     own scale sets, which is what a weak channel can be held to and the only
//     thing it can be held to.
//  2. THE CHANNEL THAT CARRIES THE TEXEL. Its error relative to itself is
//     (q/2)/P, which the same inequality puts under 1/256 = 0.390625% for
//     every sky there is. It is implied by the first, and it is gated anyway,
//     because it is the one sentence here a reader can check by hand — and
//     because it is what the eight per cent used to be. Twenty times tighter
//     is the answer to whether any of this is a widening.
//  3. THE LIGHT. The same half code, integrated: E_HALF is the irradiance of a
//     sky whose radiance is everywhere that texel's own half code, taken
//     through the SAME cosine integral as the light itself. The triangle
//     inequality carries the per texel bound straight into it —
//
//         |E_file - E_dome| <= E_half   on each channel
//
//     — so the light is measured in half codes too, and refused past one.
//
// AND THE FIGURE THE BAKE FEELS IS PRINTED BESIDE IT: the drift of each
// channel WEIGHTED BY THE SHARE OF THE LIGHT THAT CHANNEL IS. Red carries 2.5%
// of the luminance of this sky, so a red reading 0.671% out moves the light by
// 0.017% and is written down as 0.017%. Its ceiling is the same E_half over
// the luminance of the irradiance, so it is implied by gate 3 and is not a
// fourth gate; it is the line the bake is read by.
//
// None of these ceilings is a number carried over from a run. Two of them are
// 1/256 and 1, which are the format itself; the third is computed from the
// dome being baked at the moment it is baked, so it moves with the preset and
// cannot be measured on one sky and inherited by another. That is exactly what
// went wrong here once.
// ===========================================================================

/** Rec.709, the same weights post.js reads the frame's own luminance with. */
const LUMA = [0.2126, 0.7152, 0.0722];
const luminance = (v) => LUMA[0] * v[0] + LUMA[1] * v[1] + LUMA[2] * v[2];

/** Half of one code of the quadruple a texel of this peak is written with. */
export function halfCode(peak) {
  return 2 ** Math.ceil(Math.log2(peak)) / 512;   // the 512 is toRgbe's 256, halved
}

/**
 * The gates are ceilings that the arithmetic reaches exactly — a channel
 * sitting on a code boundary is a full half code out — so the comparison is
 * eased by a billionth. That is ten million times the last bit of a double,
 * which is where the only rounding in the measurement lives, and a billionth
 * of a code below anything that could be a defect.
 */
const FLOAT_EASE = 1e-9;
export const TEXEL_CEILING = 1;
export const DOMINANT_CEILING = 1 / 256;
export const LIGHT_CEILING = 1;

/** Reads the file back and asserts it is the dome, texel by texel. */
export function check(preset, body) {
  const rgb = [0, 0, 0];
  let worst = 0;
  let worstAt = '';
  let dominant = 0;
  let dominantAt = '';
  let relative = 0;
  let relativeAt = '';
  let n = 0;
  let sum = 0;
  for (let y = 0; y < HEIGHT; y += 3) {
    const v = 1 - (y + 0.5) / HEIGHT;
    for (let x = 0; x < WIDTH; x += 3) {
      const u = (x + 0.5) / WIDTH;
      const elevation = (v - 0.5) * 180;
      if (elevation < HORIZON_EASE_DEG) continue;   // the ground's half, cut on purpose
      domeRadiance(preset, directionAt(u, v), rgb);
      const peak = Math.max(rgb[0], rgb[1], rgb[2]);
      // Where the encoder gives up and writes noughts there is nothing to hold
      // the file to. It does not happen above this horizon in any sky yet
      // baked; it is skipped rather than assumed away.
      if (peak < RGBE_ZERO) continue;
      const half = halfCode(peak);
      const got = fromRgbe(body, (y * WIDTH + x) * 4);
      const at = `el ${elevation.toFixed(0)} az ${((u - 0.25) * 360).toFixed(0)}`;
      for (let c = 0; c < 3; c++) {
        const off = Math.abs(got[c] - rgb[c]);
        const codes = off / half;
        sum += codes; n++;
        if (codes > worst) { worst = codes; worstAt = `${at} channel ${c}`; }
        if (rgb[c] === peak && off / peak > dominant) {
          dominant = off / peak;
          dominantAt = `${at} channel ${c}`;
        }
        // The old figure, kept because it is the one that looks alarming and
        // therefore the one worth printing: what a channel is out by relative
        // to itself. It says how dark that channel is against its texel, and
        // it says nothing at all about whether the file is the dome.
        const rel = off / Math.max(1e-6, rgb[c]);
        if (rel > relative) { relative = rel; relativeAt = `${at} channel ${c}`; }
      }
    }
  }
  return { worst, worstAt, mean: sum / n, dominant, dominantAt, relative, relativeAt, n };
}

/**
 * What the probe actually hands a surface: cosine weighted irradiance on a
 * level patch, out of the file and out of the dome, per channel.
 *
 * This is the figure that matters and the per texel one above is only its
 * context: a shared exponent spends its mantissa on the largest channel, so the
 * red of a deep blue zenith is the worst read in the file and also the least of
 * the light. If these two agree, the bake is lit by the dome whatever the
 * weakest texel says.
 *
 * `half` is the third thing this integral carries and it is what the light is
 * judged by: the same sum, over a sky whose radiance is everywhere that texel's
 * own half code. It is the irradiance of the format's own floor, and no channel
 * of a file that IS the dome can be further from it than that.
 */
export function irradiance(preset, body) {
  const fromFile = [0, 0, 0];
  const fromDome = [0, 0, 0];
  const rgb = [0, 0, 0];
  let half = 0;
  let weight = 0;
  for (let y = 0; y < HEIGHT / 2; y++) {
    const v = 1 - (y + 0.5) / HEIGHT;
    const el = (v - 0.5) * Math.PI;
    const w = Math.cos(el) * Math.sin(el);
    if (w <= 0) continue;
    weight += w * WIDTH;
    for (let x = 0; x < WIDTH; x++) {
      const u = (x + 0.5) / WIDTH;
      const elevation = (v - 0.5) * 180;
      if (elevation < HORIZON_EASE_DEG) continue;   // the ground's half, cut on purpose
      domeRadiance(preset, directionAt(u, v), rgb);
      const got = fromRgbe(body, (y * WIDTH + x) * 4);
      const peak = Math.max(rgb[0], rgb[1], rgb[2]);
      if (peak >= RGBE_ZERO) half += halfCode(peak) * w;
      for (let c = 0; c < 3; c++) { fromFile[c] += got[c] * w; fromDome[c] += rgb[c] * w; }
    }
  }
  return {
    file: fromFile.map((s) => (s * Math.PI) / weight),
    dome: fromDome.map((s) => (s * Math.PI) / weight),
    half: (half * Math.PI) / weight,
  };
}

/**
 * The whole verdict, in one place, so that the bake and the self test below
 * judge with the same arithmetic rather than with two readings of it.
 *
 * Everything it returns is in the units of the derivation above: `texel`,
 * `dominant` and `light` are fractions of a ceiling and refuse at one, and
 * `weighted` is the figure the bake is read by with its own ceiling beside it.
 */
export function judge(preset, body) {
  const texel = check(preset, body);
  const e = irradiance(preset, body);
  const drift = e.file.map((v, c) => Math.abs(v - e.dome[c]));
  const light = drift.map((d) => d / e.half);
  const worstLight = Math.max(...light);
  const lightAt = light.indexOf(worstLight);
  const lit = luminance(e.dome);
  return {
    texel,
    e,
    drift,
    light,
    worstLight,
    lightAt,
    // What each channel is worth to the light, and the drift weighted by it:
    // a channel carrying two per cent of the luminance moves the light by two
    // per cent of what it is out by.
    share: e.dome.map((v, c) => (LUMA[c] * v) / lit),
    weighted: drift.reduce((s, d, c) => s + LUMA[c] * d, 0) / lit,
    weightedCeiling: e.half / lit,
    refused: [
      texel.worst > TEXEL_CEILING * (1 + FLOAT_EASE)
        ? `a texel is ${texel.worst.toFixed(3)} half codes from the dome (${texel.worstAt})` : null,
      texel.dominant > DOMINANT_CEILING * (1 + FLOAT_EASE)
        ? `the channel that carries a texel is ${(texel.dominant * 100).toFixed(3)}% out`
          + ` (${texel.dominantAt})` : null,
      worstLight > LIGHT_CEILING * (1 + FLOAT_EASE)
        ? `the light is ${worstLight.toFixed(3)} half codes out on channel ${lightAt}` : null,
    ].filter(Boolean),
  };
}

/**
 * The two colours the runtime weighs the two baked terms with.
 *
 * SKY is physical and nothing here chooses it: it is the irradiance the dome
 * lays on an open level patch, which is also what the sky map was divided by,
 * so the product of the two is the light itself.
 *
 * SUN cannot be taken from the same preset, and saying why matters. The dome's
 * disc carries `level: 100`, a number fitted so the drawn sun saturates the
 * tone curve, not so it carries a sun's energy: through the disc's own solid
 * angle it comes to a thirtieth of the sky's irradiance, which no daylight is.
 * So its HUE is taken from here — the beam the air lets through, which reddens
 * on its own as a preset puts the sun lower — and its STRENGTH is fitted
 * against the reference and kept in `sunStrength` of this file, which is the one
 * number of this chain that is neither measured off the sky nor derived from it.
 *
 * WHAT DID THE FITTING HAS BEEN RETIRED. tools/lighting/fit-scene-light.mjs
 * predicted a patch of the reference by sampling the ground's two atlases and
 * pushing the result through the composite; both atlases left the delivery at
 * step 8, because the meadow has been cubes with their colour in a shader since
 * the rifondazione, and the tool went with them. The two magnitudes stand where
 * that fit left them and a rebake of the probe keeps them; the instrument that
 * moves them next has to read the ground this world actually draws.
 */
function sceneLight(preset, previous, body) {
  const e = irradiance(preset, body);
  // What the air lets through to the ground, per channel, at the sun's own air
  // mass: the same `through` the dome multiplies its disc by.
  const el = preset.sun.elevation;
  const m = 1 / (Math.sin((el * Math.PI) / 180) + 0.50572 * (el + 6.07995) ** -1.6364);
  const beam = [0, 1, 2].map((c) => Math.exp(-(preset.tauRayleigh[c] + preset.tauMie[c]) * m));
  const peak = Math.max(...beam);
  const strength = previous?.day?.sunStrength;
  // THE SKY'S HUE, WITH THE PICTURE'S WHITE BALANCE TAKEN OUT OF IT.
  //
  // The dome's irradiance is what the bake divided the sky map by, and as a
  // LIGHT it is unusable: measured, 0.068 red against 0.806 blue, twelve to one.
  // No daylight is twelve to one. The reason is in tools/grade/lib/sky-model.mjs
  // and it is not a mistake there — the preset's per channel `exposure` was
  // fitted so the DRAWN sky lands on the reference's own pixels, so the
  // photograph's white balance is inside it, and src/core/sky.js says as much
  // where it scales the disc by the MEAN of the three rather than by each.
  //
  // Dividing it out leaves the part that is air: extinction and scattering per
  // channel, which comes to about two and a half to one blue over red — a sky.
  // It is derived and not chosen, it moves with the preset, and so a night gets
  // its own by the same arithmetic.
  const balance = e.dome.map((v, c) => v / preset.exposure[c]);
  const balancePeak = Math.max(...balance);
  return {
    day: {
      // Cosine weighted irradiance of the dome on an open level patch, disc
      // out. The sky map is stored as a fraction of THIS, so it is kept here as
      // the record of what the bake divided by, even though the light the
      // runtime weighs the map with is the balance below.
      skyIrradiance: e.dome.map((v) => Number(v.toFixed(6))),
      // Hue of the sky as a light, unit peak.
      skyBalance: balance.map((v) => Number((v / balancePeak).toFixed(6))),
      // Hue of the sun as a light: the air's own extinction at its air mass,
      // unit peak, so it reddens by itself as a preset puts the sun lower.
      sunBeam: beam.map((v) => Number((v / peak).toFixed(6))),
      // And the two magnitudes, which are the only fitted numbers in the chain.
      // Nothing writes them today -- see the note above -- and a rebake of the
      // probe keeps whatever they are.
      skyStrength: typeof previous?.day?.skyStrength === 'number'
        ? previous.day.skyStrength : null,
      sunStrength: typeof strength === 'number' ? strength : null,
    },
  };
}

function main() {
  const { preset } = environmentPreset();
  if (!process.argv.includes('--check')) {
    const { bytes, peak } = render(preset);
    mkdirSync(join(REPO_ROOT, 'assets-src', 'sky'), { recursive: true });
    writeFileSync(OUT, bytes);
    let previous = null;
    try { previous = JSON.parse(readFileSync(FACTS, 'utf8')); } catch { previous = null; }
    const facts = sceneLight(preset, previous, bodyOf(bytes));
    writeFileSync(FACTS, `${JSON.stringify(facts, null, 2)}\n`, 'utf8');
    const d = facts.day;
    const tint = (v) => (v[2] / v[0]).toFixed(1);
    process.stdout.write(`  ${FACTS}\n`);
    process.stdout.write(`    sky irradiance ${d.skyIrradiance.join(' ')}`
      + ` (blue over red ${tint(d.skyIrradiance)}) — what the sky map was divided by\n`);
    process.stdout.write(`    sky as a light ${d.skyBalance.join(' ')}`
      + ` (blue over red ${tint(d.skyBalance)}) — the picture's white balance taken out\n`);
    process.stdout.write(`    sun as a light ${d.sunBeam.join(' ')}\n`);
    process.stdout.write(`    strengths: sky ${d.skyStrength ?? 'not fitted yet'}`
      + `, sun ${d.sunStrength ?? 'not fitted yet'}\n`);
    process.stdout.write(`the world of the bakes, out of ${SUN_SEAT} day, disc left out\n`);
    process.stdout.write(`  ${WIDTH}x${HEIGHT} radiance, peak ${peak.toFixed(3)}\n`);
    process.stdout.write(`  ${OUT} (${(bytes.length / 1024).toFixed(0)} kB)\n`);
  }
  report(judge(preset, bodyOf(readFileSync(OUT))));
}

/** Everything the verdict has to say, in the units it was derived in. */
function report(v) {
  const pc = (x) => `${(x * 100).toFixed(3)}%`;
  const f = (a) => a.map((x) => x.toFixed(4)).join(' ');
  process.stdout.write(`  read back against the dome on ${v.texel.n} readings, in half codes`
    + ` of the format's own floor: worst ${v.texel.worst.toFixed(6)},`
    + ` mean ${v.texel.mean.toFixed(6)} (${v.texel.worstAt})\n`);
  process.stdout.write(`    the channel that carries the texel: ${pc(v.texel.dominant)}`
    + ` of ${pc(DOMINANT_CEILING)} (${v.texel.dominantAt})\n`);
  process.stdout.write(`    the weakest channel, against itself: ${pc(v.texel.relative)}`
    + ` (${v.texel.relativeAt}) — the sky's colour, not the bake's error\n`);
  process.stdout.write(`  irradiance on a level patch, from the file  ${f(v.e.file)}\n`);
  process.stdout.write(`                              from the dome  ${f(v.e.dome)}\n`);
  process.stdout.write(`  the light, in half codes: worst ${v.worstLight.toFixed(4)}`
    + ` on channel ${v.lightAt}; each channel carries ${v.share.map(pc).join(' ')} of it\n`);
  process.stdout.write(`  what the light itself moves, weighted by what each channel carries:`
    + ` ${pc(v.weighted)} of ${pc(v.weightedCeiling)}\n`);
  if (v.refused.length) {
    throw new Error(`the environment is not the dome: ${v.refused.join('; ')}`);
  }
}

// ===========================================================================
// THE THREE DIRECTIONS THE GATES ARE VALIDATED IN.
//
// A gate derived from a ceiling passes everything that is under the ceiling,
// which is a fine property and a useless test on its own: it has to be shown
// refusing something as well, and shown not to have got looser on the sky it
// was tightened away from. So the three verses are run here rather than
// described anywhere —
//
//   1. THE RAMP PASSES. The seat as it stands, rendered and judged.
//   2. A BAKE THAT IS NOT THE DOME IS REFUSED. One channel moved by five per
//      cent of the texel's own luminance, each of the three in turn. It is
//      stated as a fraction of the luminance rather than of the channel so that
//      it is the same defect on red as on blue — a per cent of red is nothing
//      and a per cent of blue is the sky. Measured, it lands nine to eleven
//      half codes out, which is what a defect looks like beside a ceiling of
//      one, and it moves the light four and a half half codes.
//   3. THE PHYSICAL DOME IS NOT ACCEPTED ANY MORE LOOSELY THAN IT WAS. It is
//      still exported by tools/grade/lib/sky-model.mjs and it is what a preset
//      with no ramp is drawn by, so the sky the old gates were written against
//      can be baked and judged here: the OLD figures are computed beside the
//      new ones, both sets pass, and a corrupted dome is refused too.
//
// Nothing here writes, and nothing here reads the probe on disk: every sky is
// rendered into memory and read back out of it. Six of them, twenty seconds.
// ===========================================================================
function selfTest() {
  const { preset } = environmentPreset();
  // A preset with no ramp is drawn by the retired physical model — see
  // domeRadiance. Nothing else has to be said to reach it.
  const physical = { ...preset };
  delete physical.ramp;
  const bakeOf = (p, bend = null) => judge(p, bodyOf(render(p, bend).bytes));
  const corrupt = (c) => (rgb) => { rgb[c] += 0.05 * luminance(rgb); };
  const cases = [];
  const put = (what, ok, said) => {
    cases.push({ what, ok, said });
    process.stdout.write(`  ${ok ? 'holds ' : 'FAILS '} ${what}\n            ${said}\n`);
  };
  const seen = (v) => `texel ${v.texel.worst.toFixed(6)}, dominant `
    + `${(v.texel.dominant * 100).toFixed(3)}%, light ${v.worstLight.toFixed(4)}, `
    + `weighted ${(v.weighted * 100).toFixed(3)}% of ${(v.weightedCeiling * 100).toFixed(3)}%`;

  process.stdout.write('bake-environment --self\n');
  const ramp = bakeOf(preset);
  put('the bake under the ramp passes', ramp.refused.length === 0, seen(ramp));
  put('and the reading that used to fail it is still there, and still the sky\'s colour',
    ramp.texel.relative > 0.08,
    `the weakest channel is ${(ramp.texel.relative * 100).toFixed(3)}% from itself`
    + ` at ${ramp.texel.relativeAt}, which the old gate refused at 8%`);

  for (let c = 0; c < 3; c++) {
    const bent = bakeOf(preset, corrupt(c));
    put(`a bake with channel ${c} moved by five per cent of the luminance is refused`,
      bent.refused.length > 0, `${seen(bent)} — ${bent.refused.length} gate(s) refused`);
  }

  const dome = bakeOf(physical);
  // The old gates, exactly as they were: the worst channel of any texel against
  // itself past eight per cent, and any channel of the light past two parts in
  // a thousand of itself.
  const oldTexel = dome.texel.relative;
  const oldLight = Math.max(...dome.drift.map((d, c) => d / dome.e.dome[c]));
  put('under the physical dome the OLD gates passed',
    oldTexel <= 0.08 && oldLight <= 0.002,
    `worst texel ${(oldTexel * 100).toFixed(3)}% of 8%, light ${(oldLight * 100).toFixed(3)}% of 0.200%`);
  put('and the new ones accept it too, with nothing widened',
    dome.refused.length === 0 && DOMINANT_CEILING < 0.08,
    `${seen(dome)}; the channel that carries the texel is now held to `
    + `${(DOMINANT_CEILING * 100).toFixed(3)}% where it was held to 8.000%`);
  const bentDome = bakeOf(physical, corrupt(0));
  put('a corrupted dome bake is refused as well, so the dome did not get looser',
    bentDome.refused.length > 0, `${seen(bentDome)} — ${bentDome.refused.length} gate(s) refused`);

  const bad = cases.filter((c) => !c.ok);
  process.stdout.write(`  ${cases.length - bad.length}/${cases.length} hold\n`);
  if (bad.length) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith('bake-environment.mjs')) {
  if (process.argv.includes('--self')) selfTest();
  else main();
}
