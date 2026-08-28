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

/** One RGBE quadruple: Radiance's shared exponent, the same one Blender reads. */
function toRgbe(r, g, b, out, o) {
  const peak = Math.max(r, g, b);
  if (peak < 1e-32) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; return; }
  const e = Math.ceil(Math.log2(peak));
  const scale = 256 / (2 ** e);
  out[o] = Math.min(255, Math.floor(r * scale));
  out[o + 1] = Math.min(255, Math.floor(g * scale));
  out[o + 2] = Math.min(255, Math.floor(b * scale));
  out[o + 3] = e + 128;
}

function fromRgbe(bytes, o) {
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

function render(preset) {
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
      peak = Math.max(peak, rgb[0], rgb[1], rgb[2]);
      toRgbe(rgb[0], rgb[1], rgb[2], body, (y * WIDTH + x) * 4);
    }
  }
  return { bytes: Buffer.concat([header, body]), peak };
}

/** Reads the file back and asserts it is the dome, texel by texel. */
function check(preset) {
  const file = readFileSync(OUT);
  const head = file.indexOf('\n-Y ');
  const start = file.indexOf('\n', head + 1) + 1;
  const body = file.subarray(start);
  const rgb = [0, 0, 0];
  let worst = 0;
  let worstAt = '';
  let n = 0;
  let sum = 0;
  for (let y = 0; y < HEIGHT; y += 3) {
    const v = 1 - (y + 0.5) / HEIGHT;
    for (let x = 0; x < WIDTH; x += 3) {
      const u = (x + 0.5) / WIDTH;
      const elevation = (v - 0.5) * 180;
      if (elevation < HORIZON_EASE_DEG) continue;   // the ground's half, cut on purpose
      domeRadiance(preset, directionAt(u, v), rgb);
      const got = fromRgbe(body, (y * WIDTH + x) * 4);
      for (let c = 0; c < 3; c++) {
        // Relative, because the sky spans two orders of magnitude between the
        // zenith and the air beside the sun and an absolute figure would only
        // ever report the brightest texel.
        const err = Math.abs(got[c] - rgb[c]) / Math.max(1e-6, rgb[c]);
        sum += err; n++;
        if (err > worst) {
          worst = err;
          worstAt = `el ${((v - 0.5) * 180).toFixed(0)} az ${((u - 0.25) * 360).toFixed(0)} channel ${c}`;
        }
      }
    }
  }
  return { worst, worstAt, mean: sum / n, n };
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
 */
function irradiance(preset) {
  const file = readFileSync(OUT);
  const head = file.indexOf('\n-Y ');
  const start = file.indexOf('\n', head + 1) + 1;
  const body = file.subarray(start);
  const fromFile = [0, 0, 0];
  const fromDome = [0, 0, 0];
  const rgb = [0, 0, 0];
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
      for (let c = 0; c < 3; c++) { fromFile[c] += got[c] * w; fromDome[c] += rgb[c] * w; }
    }
  }
  return {
    file: fromFile.map((s) => (s * Math.PI) / weight),
    dome: fromDome.map((s) => (s * Math.PI) / weight),
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
 * against the reference by tools/lighting/fit-scene-light.mjs and kept in
 * `sunStrength` of this file, which is the one number of this chain that is
 * neither measured off the sky nor derived from it.
 */
function sceneLight(preset, previous) {
  const e = irradiance(preset);
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
      // tools/lighting/fit-scene-light.mjs writes them; a rebake of the probe
      // keeps them.
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
    const facts = sceneLight(preset, previous);
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
  const verdict = check(preset);
  process.stdout.write(`  read back against the dome on ${verdict.n} readings: `
    + `mean ${(verdict.mean * 100).toFixed(3)}%, worst ${(verdict.worst * 100).toFixed(3)}% `
    + `(${verdict.worstAt})\n`);
  const e = irradiance(preset);
  const f = (v) => v.map((x) => x.toFixed(4)).join(' ');
  process.stdout.write(`  irradiance on a level patch, from the file  ${f(e.file)}\n`);
  process.stdout.write(`                              from the dome  ${f(e.dome)}\n`);
  const drift = Math.max(...e.file.map((v, c) => Math.abs(v - e.dome[c]) / e.dome[c]));
  process.stdout.write(`  worst channel of the light itself: ${(drift * 100).toFixed(3)}%\n`);
  // A shared exponent carries eight bits of mantissa on the largest channel and
  // fewer on any channel below it, so a texel of deep blue sky reads its red a
  // few per cent out. What that costs the LIGHT is the figure below, and it is
  // the one the bake feels.
  if (verdict.worst > 0.08 || drift > 0.002) {
    throw new Error(`the environment is not the dome: worst texel `
      + `${(verdict.worst * 100).toFixed(2)}%, light ${(drift * 100).toFixed(3)}%`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('bake-environment.mjs')) main();
