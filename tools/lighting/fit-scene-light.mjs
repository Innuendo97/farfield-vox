import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAME, makeRay } from '../grade/lib/framing.mjs';
import { meanRect, readTarget } from '../grade/lib/target.mjs';
import { composite, loadGround, predictPatch, shadeGround } from '../terrain/probe.mjs';
import { PATCHES } from '../terrain/sample-target.mjs';
import { castShadowTest } from './cast-shadow.mjs';
import { REPO_ROOT } from './sun.mjs';

// HOW MUCH SUN, AND HOW MUCH SKY.
//
// The bake hands the ground two scalars: how much of the sun a point sees and
// how much of the sky. Turning them back into light takes two colours. The
// sky's is not a choice — it is the irradiance the dome lays on an open level
// patch, written beside the probe by tools/lighting/bake-environment.mjs, and
// the very number the sky map was divided by. The sun's HUE is not a choice
// either: it is the air's own extinction at the sun's air mass.
//
// The sun's STRENGTH is the one number in this chain that neither the sky nor
// the bake can supply, and this is where it is measured. The dome carries a
// disc, but its level was fitted so a drawn sun saturates the tone curve, not
// so it carries a sun's energy: through the disc's own solid angle it comes to
// a thirtieth of the sky's irradiance, which is no daylight at all.
//
// So it is solved against the reference, on the ground patches that were
// measured off it for exactly this kind of question
// (tools/terrain/sample-target.mjs). Two unknowns, and they are independent:
//
//   the EXPOSURE lifts both terms together, so it sets the level;
//   the SUN STRENGTH lifts one of them, so it sets how much darker the ground
//   in the blocks' shadow is than the ground beside it.
//
// The second is the one this session is about, and the reference has a strong
// opinion about it. Measured before any of this was built: on the ground of the
// framing, row matched, the meadow standing inside the seat sun's hard shadow
// is 1.347 times as BRIGHT as the meadow outside it. There is no cast shadow in
// that picture at all. Whatever this fit returns, it is returning that.

const SEAT = join(REPO_ROOT, 'assets-src', 'sky', 'scene-light.json');

/** Mean encoded colour of a patch of the reference, in nought to one. */
function reference(target, patch) {
  return meanRect(target, patch);
}

/**
 * Every measured patch reduced to what does NOT depend on the two unknowns.
 *
 * The ray march into the height field and the texture reads are the whole cost
 * of a prediction and neither moves when the sun's strength does, so they are
 * done once. What is left inside the search is the composite, which is the only
 * part that has to see the candidate.
 */
function gather(ground, ray, target, patches) {
  const bags = [];
  for (const patch of patches) {
    const samples = [];
    for (let py = patch.y0; py < patch.y1; py += 6) {
      for (let px = patch.x0; px < patch.x1; px += 6) {
        const shaded = shadeGround(ground, ray, px, py);
        if (shaded) samples.push({ ...shaded, px, py });
      }
    }
    if (samples.length) bags.push({ patch, samples, want: reference(target, patch) });
  }
  return bags;
}

/** Root mean square error over the patches, in encoded levels. */
function cost(bags, ground, sunStrength, skyStrength, hues, termScale) {
  const colour = [0, 0, 0];
  const srgb = [0, 0, 0];
  let sum = 0;
  let n = 0;
  for (const bag of bags) {
    const mean = [0, 0, 0];
    for (const s of bag.samples) {
      for (let c = 0; c < 3; c++) {
        const light = s.terms[0] * hues.sun[c] * sunStrength
          + s.terms[1] * hues.sky[c] * skyStrength;
        const lit = s.albedo[c] * light * termScale;
        colour[c] = lit * (1 - s.fog) + ground.fogColour[c] * s.fog;
      }
      composite(colour, s.px, s.py, ground.lut, srgb);
      for (let c = 0; c < 3; c++) mean[c] += srgb[c];
    }
    for (let c = 0; c < 3; c++) {
      sum += ((mean[c] / bag.samples.length - bag.want[c]) * 255) ** 2;
      n++;
    }
  }
  return n ? Math.sqrt(sum / n) : Infinity;
}

async function main() {
  const ground = await loadGround();
  const target = await readTarget();
  const ray = makeRay({ width: FRAME.width, height: FRAME.height });
  // Grass and path only. The water carries a reflected sky rather than a baked
  // light and the model here does not draw it, so it would fit the wrong thing.
  let patches = PATCHES.filter((p) => p.kind === 'grass' || p.kind === 'path');

  // AND, WITH --uncontradicted, ONLY WHERE THE REFERENCE AND THE SEALED SUN
  // AGREE. The committente's decision of the two lights makes the belt of meadow
  // inside the blocks' cast shadow something this world is no longer asked to
  // match: the photograph is two to five times brighter there. Left in a fit of
  // the LEVEL they are the brightest patches of the set against the darkest
  // patches of the render, and they would push the exposure up to close a gap
  // that has been declared open.
  if (process.argv.includes('--uncontradicted')) {
    const occluded = castShadowTest({ withBuilt: true });
    const kept = [];
    for (const patch of patches) {
      const got = predictPatch(ground, ray, patch);
      if (got && !occluded(got.x, 0.05, got.z)) kept.push(patch);
    }
    process.stdout.write(`only the uncontradicted ground: ${kept.length} of `
      + `${patches.length} patches stand outside the seat sun's cast shadow\n\n`);
    patches = kept;
  }

  // How much the sun term varies across the set decides whether its strength is
  // identifiable at all. Reported before the fit rather than after, because a
  // fitted number over a set that does not separate the two terms is a number
  // with no measurement under it.
  const spread = [];
  for (const patch of patches) {
    const got = predictPatch(ground, ray, patch);
    if (got) spread.push({ id: patch.id, sun: got.terms[0], sky: got.terms[1] });
  }
  spread.sort((a, b) => a.sun - b.sun);
  process.stdout.write(`the sun term over the ${spread.length} ground patches, `
    + `least to most:\n`);
  for (const s of spread) {
    process.stdout.write(`  ${s.id.padEnd(18)} sun ${s.sun.toFixed(3)}  sky ${s.sky.toFixed(3)}\n`);
  }
  const lo = spread[0].sun;
  const hi = spread[spread.length - 1].sun;
  process.stdout.write(`  separation: ${lo.toFixed(3)} to ${hi.toFixed(3)}\n\n`);
  if (hi - lo < 0.05) {
    process.stdout.write('  WARNING these patches barely separate the two terms: '
      + 'the strength below is not measured by them.\n\n');
  }

  // The scale the maps are stored against, so the exposure can be moved on its
  // own instead of through whatever the source constant happens to say today.
  const termScale = JSON.parse(readFileSync(
    join(REPO_ROOT, 'assets-src', 'terrain', 'terrain.json'), 'utf8')).lightScale;
  const seat = JSON.parse(readFileSync(SEAT, 'utf8')).day;
  // The two HUES are derived and fixed: the sun's is the air's own extinction
  // at its air mass, the sky's is the dome's irradiance with the reference's
  // white balance divided out. Only the two magnitudes are free.
  const hues = { sun: seat.sunBeam, sky: seat.skyBalance };
  const bags = gather(ground, ray, target, patches);
  process.stdout.write(`${bags.length} patches, `
    + `${bags.reduce((t, b) => t + b.samples.length, 0)} samples

`);

  // The share the sun carries on open level ground.
  //
  // WITHOUT the cosine of the sun's elevation, and that is a correction: this
  // used to multiply the sun by 0.559, which is sin(34). The bake divides each
  // term by what an OPEN LEVEL PATCH receives in it (tools/lighting/bake_world.py,
  // flatten), so both terms are already 1 there and the cosine is inside the
  // divisor. Left in, it reported the sun's share about ten points low.
  const share = (sun, sky) => {
    const openSun = sun * hues.sun.reduce((t, v) => t + v, 0);
    const openSky = sky * hues.sky.reduce((t, v) => t + v, 0);
    return (openSun / (openSun + openSky)) * 100;
  };

  // WITH THE RATIO HELD, which is what this session actually needs.
  //
  // The committente chose pure physics of the sealed sun, and the split between
  // the beam and the dome is then not a thing to fit: it is the atmosphere that
  // draws the sky, and tools/lighting/fit-sun-strength.mjs works it out. What is
  // left for the reference to say is the LEVEL, which is the one thing about
  // this picture the physics cannot know — it is an illustration with lifted
  // midtones, not a photometer. So --ratio holds sun/sky where the physics put
  // it and searches the level alone.
  const held = process.argv.find((a) => a.startsWith('--ratio'));
  if (held) {
    const ratio = Number(held.includes('=') ? held.split('=')[1]
      : process.argv[process.argv.indexOf(held) + 1]);
    if (!(ratio > 0)) throw new Error('--ratio wants a positive number');
    let found = null;
    for (const pass of [0, 1, 2]) {
      const step = [0.02, 0.002, 0.0002][pass];
      const from = pass === 0 ? step : found.sky - 10 * step;
      for (let i = 0; i <= (pass === 0 ? 100 : 20); i++) {
        const sky = from + i * step;
        if (sky <= 0) continue;
        const error = cost(bags, ground, ratio * sky, sky, hues, termScale);
        if (!found || error < found.error) found = { sky, error };
      }
    }
    process.stdout.write(`\nWITH THE RATIO HELD AT ${ratio.toFixed(4)}, the level alone\n`);
    process.stdout.write(`  sun strength   ${(ratio * found.sky).toFixed(4)}\n`);
    process.stdout.write(`  sky strength   ${found.sky.toFixed(4)}\n`);
    process.stdout.write('  sun as a share of the light on open level ground: '
      + `${share(ratio * found.sky, found.sky).toFixed(1)}%\n`);
    process.stdout.write(`  rms error      ${found.error.toFixed(2)} encoded levels\n`);
    if (process.argv.includes('--write')) {
      const written = JSON.parse(readFileSync(SEAT, 'utf8'));
      written.day.sunStrength = Number((ratio * found.sky).toFixed(4));
      written.day.skyStrength = Number(found.sky.toFixed(4));
      writeFileSync(SEAT, `${JSON.stringify(written, null, 2)}\n`, 'utf8');
      process.stdout.write(`  written to ${SEAT}\n`);
    }
    return;
  }

  let best = null;
  // Coarse then fine, over the two magnitudes. The grid reaches zero on the sun
  // on purpose: the reference has no cast shadow in it, so a search that could
  // not reach nothing would report its own edge as a measurement.
  for (const pass of [0, 1, 2]) {
    const step = [0.1, 0.01, 0.001][pass];
    const suns = pass === 0
      ? Array.from({ length: 41 }, (_, i) => i * step)
      : Array.from({ length: 21 }, (_, i) => best.sun + (i - 10) * step);
    const skies = pass === 0
      ? Array.from({ length: 41 }, (_, i) => 0.1 + i * step)
      : Array.from({ length: 21 }, (_, i) => best.sky + (i - 10) * step);
    for (const sun of suns) {
      if (sun < 0) continue;
      for (const sky of skies) {
        if (sky <= 0) continue;
        const error = cost(bags, ground, sun, sky, hues, termScale);
        if (!best || error < best.error) best = { sun, sky, error };
      }
    }
  }

  // How sharp the minimum is. A fitted number is a measurement only if the cost
  // rises away from it; printed rather than trusted, because this fit sits on a
  // residual the geometry of this pass cannot close, and a shallow valley under
  // a large residual is not a reading.
  process.stdout.write('\nthe cost against the sun\'s strength, '
    + 'each at its own best sky:\n');
  for (const sun of [0, 0.1, 0.2, 0.4, 0.8, 1.2, 1.6, 2.4]) {
    let bestHere = Infinity;
    let atSky = 0;
    for (let i = 0; i <= 140; i++) {
      const sky = 0.05 + i * 0.02;
      const error = cost(bags, ground, sun, sky, hues, termScale);
      if (error < bestHere) { bestHere = error; atSky = sky; }
    }
    process.stdout.write(`  sun ${sun.toFixed(2).padStart(5)}  rms ${bestHere.toFixed(2).padStart(6)}`
      + `  at sky ${atSky.toFixed(2)}  (the sun is then ${share(sun, atSky).toFixed(0)}%`
      + ' of the light on open level ground)\n');
  }

  // AND THE SAME QUESTION WITH BOTH COLOURS FREE.
  //
  // The fit above holds the sky's colour at the dome's own irradiance and the
  // sun's at the air's extinction, and lets one scalar move. That is the
  // architecture, and it is right for the night — but it is only honest if the
  // dome's colour is a LIGHT. It may not be: the preset's per channel exposure
  // was fitted against a display referred photograph, so the reference's white
  // balance is inside it, and its irradiance comes out nearly twelve to one
  // blue over red, which no daylight is.
  //
  // So the same patches are asked again with six free numbers and no model at
  // all. The gap between the two answers is the size of that problem, and it is
  // a number the orchestrator needs rather than something to quietly fix here.
  {
    const sun = [0.2, 0.2, 0.2];
    const sky = [0.2, 0.2, 0.2];
    const srgb = [0, 0, 0];
    const colour = [0, 0, 0];
    const errorOf = () => {
      let total = 0;
      let n = 0;
      for (const bag of bags) {
        const mean = [0, 0, 0];
        for (const s of bag.samples) {
          for (let c = 0; c < 3; c++) {
            const light = s.terms[0] * sun[c] + s.terms[1] * sky[c];
            colour[c] = s.albedo[c] * light * termScale * (1 - s.fog)
              + ground.fogColour[c] * s.fog;
          }
          composite(colour, s.px, s.py, ground.lut, srgb);
          for (let c = 0; c < 3; c++) mean[c] += srgb[c];
        }
        for (let c = 0; c < 3; c++) {
          total += ((mean[c] / bag.samples.length - bag.want[c]) * 255) ** 2;
          n++;
        }
      }
      return Math.sqrt(total / n);
    };
    let step = 0.5;
    let here = errorOf();
    for (let round = 0; round < 80; round++) {
      let moved = false;
      for (const bag of [sun, sky]) {
        for (let c = 0; c < 3; c++) {
          for (const d of [step, -step]) {
            const kept = bag[c];
            bag[c] = Math.max(0, kept + d);
            const there = errorOf();
            if (there < here - 1e-6) { here = there; moved = true; } else { bag[c] = kept; }
          }
        }
      }
      if (!moved) step /= 2;
      if (step < 1e-4) break;
    }
    const f = (v) => v.map((x) => x.toFixed(3)).join(' ');
    const tint = (v) => (v[2] / Math.max(1e-6, v[0])).toFixed(1);
    process.stdout.write('\nWITH BOTH COLOURS FREE, no model, same patches\n');
    process.stdout.write(`  sun  ${f(sun)}   blue over red ${tint(sun)}\n`);
    process.stdout.write(`  sky  ${f(sky)}   blue over red ${tint(sky)}\n`);
    process.stdout.write(`  the dome's own irradiance is ${f(ground.skyLight)}`
      + `   blue over red ${tint(ground.skyLight)}\n`);
    const openSun = sun.reduce((t, v) => t + v, 0) * 0.559;
    const openSky = sky.reduce((t, v) => t + v, 0);
    process.stdout.write('  sun as a share of the light on open level ground: '
      + `${((openSun / (openSun + openSky)) * 100).toFixed(1)}%\n`);
    process.stdout.write(`  rms error      ${here.toFixed(2)} encoded levels\n`);
  }

  process.stdout.write(`\nFITTED on ${patches.length} ground patches of the reference\n`);
  process.stdout.write(`  sun strength   ${best.sun.toFixed(4)}\n`);
  process.stdout.write(`  sky strength   ${best.sky.toFixed(4)}\n`);
  process.stdout.write('  sun as a share of the light on open level ground: '
    + `${share(best.sun, best.sky).toFixed(1)}%\n`);
  process.stdout.write(`  rms error      ${best.error.toFixed(2)} encoded levels\n`);

  if (process.argv.includes('--write')) {
    const written = JSON.parse(readFileSync(SEAT, 'utf8'));
    written.day.sunStrength = Number(best.sun.toFixed(4));
    written.day.skyStrength = Number(best.sky.toFixed(4));
    writeFileSync(SEAT, `${JSON.stringify(written, null, 2)}\n`, 'utf8');
    process.stdout.write(`  written to ${SEAT}\n`);
    process.stdout.write('  GROUND_EXPOSURE stays where it is: the two strengths above\n'
      + '  carry the level now, and a second exposure would be a second exposure.\n');
  }
}

await main();
