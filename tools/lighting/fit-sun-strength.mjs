import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAME, makeRay } from '../grade/lib/framing.mjs';
import { airMass } from '../grade/lib/sky-model.mjs';
import { readTarget } from '../grade/lib/target.mjs';
import { heightAt } from '../../src/world/terrain-field.js';
import { turfRise } from '../../src/world/turf.js';
import { loadGround, shadeGround, solveRadiance } from '../terrain/probe.mjs';
import { REPO_ROOT } from './sun.mjs';

// HOW MUCH SUN, MEASURED WHERE THE REFERENCE AND THE SEALED SUN AGREE.
//
// The committente's decision of the two lights (SESSIONI.md, S2 decision 6) is
// PURE PHYSICS: one sun, the one S1 sealed at elevation 34 and bearing -9.5, and
// true shadows everywhere. The reference contradicts that sun over most of its
// meadow — it is 2.0 to 5.5 times BRIGHTER inside the shadows this world casts
// (s2-dev3/probe/taglio.mjs) — so the picture cannot be asked how strong the sun
// is on the open ground: it would answer "not at all", and it did
// (tools/lighting/fit-scene-light.mjs, minimum at zero).
//
// There is exactly one part of the frame where the two lights AGREE, and it is
// the reason the hummocks exist: the south flanks of the two turf hummocks in
// the foreground. They face away from a sun that stands almost due north, so
// both the photograph and the seat make them dark; there is no cast shadow
// involved, only the surface's own tilt; and the foreground carries no shadow at
// all for the two to disagree about (6-9 m has ZERO shaded samples in the same
// probe). The reference reads a flank at 0.137 and 0.141 of its own crown in
// linear surface radiance.
//
// So the strength of the sun is read off THAT, on the baked geometry of the
// hummocks, and nothing else. What the number does is set how much of the light
// is directional: with no sun a flank is as bright as its crown, and the corner
// shadow the committente asked for does not exist at all.
//
//   node tools/lighting/fit-sun-strength.mjs
//   node tools/lighting/fit-sun-strength.mjs --write
//
// The strength is a RUNTIME UNIFORM (src/core/sky.js, setSceneLight), so moving
// it costs no bake: the maps hold the two terms as fractions and the weights are
// applied at draw time.

// AND WHAT THE ANCHOR CANNOT DO, said here because it is the finding of this
// unit and not a footnote. Measured on the delivered field (the numbers are
// below, every run prints them): the reference puts a flank at 0.445 and 0.455
// of its own crown, and the darkest a flank can be made with an INFINITE sun —
// the sun term's own ratio, where the sky has stopped counting — is 0.707 and
// 0.578. The reference is BELOW THE FLOOR. No strength reaches it, the search
// runs to the edge of its grid, and a number read off that edge would be the
// edge of the grid and not a measurement.
//
// What the anchor does say, and says clearly, is the SIGN and the direction:
// every step of sun makes the flanks more right and none makes them wrong, which
// is the opposite of what the open meadow says and the reason this session has a
// sun at all.
//
// So the MAGNITUDE comes from the only other thing in this repository that is
// physics rather than a fit: the atmosphere that draws the sky. The dome is a
// single scattering model (tools/grade/lib/sky-model.mjs) whose per channel
// exposure plays the part of the extraterrestrial source and whose optical
// depths are in assets-src/sky/sky.json. The beam that survives that same
// atmosphere at the sun's own air mass is therefore known:
//
//   direct on a level patch   = exposure * exp(-tau * m) * sin(elevation)
//   diffuse on a level patch  = the dome's own irradiance, which
//                               tools/lighting/bake-environment.mjs integrates
//
// One is the sun, the other is the sky, and their ratio is what the two runtime
// weights have to carry. It needs no reference and no fit — which is exactly
// what "pure physics of the sealed sun" means.
//
// The LEVEL is a separate question and is not settled here: this writes the
// ratio and holds the light on open level ground where it stands, so the frame
// does not move by a factor of eight while the ratio is being put in. What sets
// the level against the reference is tools/lighting/fit-scene-light.mjs --ratio,
// and after it the albedo.

const SEAT = join(REPO_ROOT, 'assets-src', 'sky', 'scene-light.json');
const SKY = join(REPO_ROOT, 'assets-src', 'sky', 'sky.json');
const WRITE = process.argv.includes('--write');
const Y_WEIGHTS = [0.2126, 0.7152, 0.0722];

/**
 * The ratio of direct to diffuse irradiance on a level patch, per channel, out
 * of the sealed atmosphere and nothing else.
 *
 * The optical depths in sky.json are stored already spread over the three
 * channels; the model multiplies a scalar by its own wavelength scaling, so both
 * shapes have to be accepted or this reads a third of the extinction.
 */
function physicalSplit() {
  const day = JSON.parse(readFileSync(SKY, 'utf8')).day;
  const scene = JSON.parse(readFileSync(SEAT, 'utf8')).day;
  const spread = (value, power) => (Array.isArray(value)
    ? value
    : [630, 532, 465].map((l) => value * (550 / l) ** power));
  const tauR = spread(day.tauRayleigh, 4);
  const tauM = spread(day.tauMie, 1.3);
  const m = airMass(90 - day.sun.elevation);
  const transmitted = tauR.map((t, c) => Math.exp(-(t + tauM[c]) * m));
  const sinEl = Math.sin(day.sun.elevation * Math.PI / 180);
  const direct = transmitted.map((t, c) => day.exposure[c] * t * sinEl);
  const diffuse = scene.skyIrradiance;
  return {
    m,
    transmitted,
    direct,
    diffuse,
    sinElevation: sinEl,
    exposure: day.exposure,
    elevation: day.sun.elevation,
    perChannel: direct.map((v, c) => v / diffuse[c]),
    luminance: direct.reduce((t, v, c) => t + v * Y_WEIGHTS[c], 0)
      / diffuse.reduce((t, v, c) => t + v * Y_WEIGHTS[c], 0),
  };
}

// THE TWO HUMMOCKS, by where the field puts them and not by pixels.
//
// s2-regola-erba read the crown of each one off the photograph at rows 700-716,
// and those rows CANNOT be used against this world: what a photograph shows as
// the top of a hummock is the top of the grass on it, and the field's own
// measurement separates the two — the left crest reads 0.75 m of which 0.43 is
// ground. The bake knows the ground. Traced through the reference camera, rows
// 700-716 pass a foot over the baked crown and land three metres beyond it
// (measured: x -6.55, z 1.97, rise 0.015 m).
//
// So the patches are found in the WORLD, on the delivered field, and the
// reference is then read at whatever pixels those points project to. The crown
// is the ground within half a metre of the measured crest; the flank is the
// ground south of it that has actually tilted, between a fifth and four fifths
// of the crown's height. Both are found by tracing every pixel of a generous
// window and keeping the ones that land where they should, which is the only way
// to be sure the pixels and the geometry are talking about the same hummock.
const ANCHORS = [
  { id: 'sx', x: -5.92, z: 4.6, window: { x0: 40, y0: 690, x1: 420, y1: 880 } },
  { id: 'dx', x: 4.67, z: 4.6, window: { x0: 1280, y0: 690, x1: 1600, y1: 880 } },
];

// How steep a piece of ground has to lean away from the sun before it counts as
// the flank rather than as the shoulder of the crown. The rule builds the south
// flank at 30 degrees (tools/turf/turf-rule.mjs) and the delivered field holds
// 28.6 to 32.6 over the mesh's own step, so twenty takes the flank and leaves
// the rounded top out of it.
const FLANK_DEGREES = 20;

const Y = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * The photograph's own lens shading, which is not light in the scene.
 *
 * sky.json's arrivalShading is the darkening the reference carries in its
 * corners, fitted as "a photograph minus a smooth sky" and handed to the veil.
 * A ratio between a crown and the flank below it spans forty rows of the frame,
 * and the shading changes across them, so it is divided out before the ratio is
 * taken rather than assumed flat.
 */
function referenceShading() {
  const sky = JSON.parse(readFileSync(join(REPO_ROOT, 'assets-src', 'sky', 'sky.json'), 'utf8'));
  const { cols, rows, values } = sky.arrivalShading;
  return function shadingAt(px, py) {
    const fx = Math.min(cols - 1.001, Math.max(0, (px / FRAME.width) * (cols - 1)));
    const fy = Math.min(rows - 1.001, Math.max(0, (py / FRAME.height) * (rows - 1)));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (x, y) => values[y * cols + x];
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty)
      + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  };
}

/** Southward slope of the delivered ground at a point, in degrees. */
function southSlope(x, z) {
  const d = 0.15;
  return Math.atan((heightAt(x, z - d) - heightAt(x, z + d)) / (2 * d)) * 180 / Math.PI;
}

/**
 * Every pixel of a window sorted into crown, flank or neither, by where on the
 * delivered field it lands, with what the reference carries there.
 */
function gather(ground, ray, target, shading, anchor) {
  const peak = turfRise(anchor.x, anchor.z);
  const crown = [];
  const flank = [];
  for (let py = anchor.window.y0; py < anchor.window.y1; py += 1) {
    for (let px = anchor.window.x0; px < anchor.window.x1; px += 1) {
      const shaded = shadeGround(ground, ray, px, py);
      if (!shaded) continue;
      const { x, z } = shaded.hit;
      const rise = turfRise(x, z);
      const near = Math.hypot(x - anchor.x, z - anchor.z);
      let bag = null;
      if (near <= 0.55 && rise > 0.75 * peak) bag = crown;
      else if (near <= 2.6 && z > anchor.z && rise > 0.2 * peak && rise < 0.8 * peak
        && southSlope(x, z) >= FLANK_DEGREES) bag = flank;
      if (!bag) continue;
      const o = (py * target.width + px) * (target.channels || 3);
      const wanted = [0, 1, 2].map((c) => target.data[o + c] / 255);
      const solved = solveRadiance(wanted, px, py, ground.lut);
      if (solved.error > 0.02) continue;
      const lens = shading(px, py);
      const surface = [0, 1, 2].map((c) => (solved.radiance[c] / lens
        - ground.fogColour[c] * shaded.fog) / Math.max(1e-6, 1 - shaded.fog));
      bag.push({ ...shaded, reference: Y(surface), rise, slope: southSlope(x, z) });
    }
  }
  const bag = (samples) => ({
    samples,
    read: samples.length,
    reference: samples.length
      ? samples.reduce((t, s) => t + s.reference, 0) / samples.length : 0,
  });
  return { crown: bag(crown), flank: bag(flank) };
}

/** Mean surface radiance the world would carry there at a candidate strength. */
function predicted(bag, ground, sunStrength, skyStrength) {
  let sum = 0;
  for (const s of bag.samples) {
    const colour = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const light = s.terms[0] * ground.sunBeam[c] * sunStrength
        + s.terms[1] * ground.skyBalance[c] * skyStrength;
      colour[c] = s.albedo[c] * light * ground.lightScale;
    }
    sum += Y(colour);
  }
  return bag.samples.length ? sum / bag.samples.length : 0;
}

async function main() {
  const ground = await loadGround();
  const target = await readTarget();
  const ray = makeRay({ width: FRAME.width, height: FRAME.height });
  const shading = referenceShading();
  const seat = JSON.parse(readFileSync(SEAT, 'utf8'));
  const { skyStrength } = seat.day;
  // The two hues are derived and fixed (src/core/sky.js): only the magnitude of
  // the sun is asked for here.
  ground.sunBeam = seat.day.sunBeam;
  ground.skyBalance = seat.day.skyBalance;

  const anchors = [];
  process.stdout.write('THE ANCHOR, patch by patch\n');
  process.stdout.write(`${'patch'.padEnd(10)}${'px read'.padStart(9)}${'metres out'.padStart(12)}`
    + `${'sun term'.padStart(10)}${'sky term'.padStart(10)}`
    + `${'reference radiance'.padStart(20)}\n`);
  for (const anchor of ANCHORS) {
    const { crown, flank } = gather(ground, ray, target, shading, anchor);
    for (const [name, bag] of [['crown', crown], ['flank', flank]]) {
      const mean = (f) => bag.samples.reduce((t, s) => t + f(s), 0) / (bag.samples.length || 1);
      process.stdout.write(`${`${anchor.id}-${name}`.padEnd(10)}`
        + `${String(bag.read).padStart(9)}`
        + `${mean((s) => s.hit.distance).toFixed(1).padStart(12)}`
        + `${mean((s) => s.terms[0]).toFixed(3).padStart(10)}`
        + `${mean((s) => s.terms[1]).toFixed(3).padStart(10)}`
        + `${bag.reference.toFixed(4).padStart(20)}`
        + `   rise ${mean((s) => s.rise).toFixed(2)} m,`
        + ` south slope ${mean((s) => s.slope).toFixed(0)} deg\n`);
    }
    const wanted = crown.reference > 0 ? flank.reference / crown.reference : 0;
    anchors.push({ id: anchor.id, crown, flank, wanted });
    process.stdout.write(`  ${anchor.id}: the reference puts the flank at `
      + `${wanted.toFixed(4)} of its crown\n`);
  }

  // WHAT THE GEOMETRY CAN REACH AT ALL, before any candidate is tried.
  //
  // The two terms add, so the ratio a flank can be driven to is bounded: with no
  // sun it is the sky's own ratio, and with an infinite sun it is the sun term's
  // ratio and no lower. Printed first, because a fit that runs to the edge of
  // its own grid is not a measurement and this is the number that says so.
  process.stdout.write('\nWHAT THE BAKED GEOMETRY CAN REACH\n');
  for (const a of anchors) {
    const skyOnly = predicted(a.flank, ground, 0, 1) / predicted(a.crown, ground, 0, 1);
    const sunOnly = predicted(a.flank, ground, 1, 0) / predicted(a.crown, ground, 1, 0);
    process.stdout.write(`  ${a.id}  no sun at all: ${skyOnly.toFixed(4)}`
      + `   sun alone (the floor): ${sunOnly.toFixed(4)}`
      + `   the reference asks ${a.wanted.toFixed(4)}`
      + `   ${a.wanted < sunOnly ? 'BELOW THE FLOOR' : 'reachable'}\n`);
  }

  process.stdout.write('\nTHE FLANK AGAINST THE STRENGTH OF THE SUN\n');
  process.stdout.write(`${'sun'.padStart(6)}${'sx flank/crown'.padStart(16)}`
    + `${'dx flank/crown'.padStart(16)}${'rms of the two'.padStart(16)}`
    + `${'open ground'.padStart(13)}\n`);
  const openLight = (sun) => {
    const s = ground.sunBeam.reduce((t, v) => t + v, 0) * sun;
    const k = ground.skyBalance.reduce((t, v) => t + v, 0) * skyStrength;
    return s / (s + k);
  };
  let best = null;
  const curve = [];
  for (let i = 0; i <= 400; i++) {
    const sun = i * 0.01;
    const got = anchors.map((a) => predicted(a.flank, ground, sun, skyStrength)
      / predicted(a.crown, ground, sun, skyStrength));
    const error = Math.sqrt(got.reduce((t, g, k) => t + (g - anchors[k].wanted) ** 2, 0)
      / anchors.length);
    curve.push({ sun, got, error });
    if (!best || error < best.error) best = { sun, got, error };
  }
  for (const row of curve) {
    if (row.sun % 0.25 > 1e-9 && row.sun !== best.sun) continue;
    process.stdout.write(`${row.sun.toFixed(2).padStart(6)}`
      + `${row.got.map((g) => g.toFixed(4).padStart(16)).join('')}`
      + `${row.error.toFixed(4).padStart(16)}`
      + `${`${(100 * openLight(row.sun)).toFixed(0)}% sun`.padStart(13)}`
      + `${row.sun === best.sun ? '   <- least error' : ''}\n`);
  }

  process.stdout.write(`\nleast error at sunStrength ${best.sun.toFixed(2)}, `
    + `rms ${best.error.toFixed(4)} on the two ratios\n`);
  process.stdout.write(`  the sun is then ${(100 * openLight(best.sun)).toFixed(0)}%`
    + ' of the light on open level ground\n');

  // Is it identifiable? A minimum only means something if the cost rises away
  // from it, and this one sits against a floor the geometry cannot cross.
  const at = (sun) => curve[Math.round(sun * 100)];
  const half = at(Math.max(0, best.sun / 2));
  const twice = at(Math.min(4, best.sun * 2));
  process.stdout.write(`  half of it (${half.sun.toFixed(2)}) costs ${half.error.toFixed(4)}, `
    + `twice (${twice.sun.toFixed(2)}) costs ${twice.error.toFixed(4)}\n`);
  const bounded = best.sun >= 3.99 || anchors.every((a) => a.wanted
    < predicted(a.flank, ground, 1, 0) / predicted(a.crown, ground, 1, 0));
  if (bounded) {
    process.stdout.write('  THE ANCHOR IS A BOUND, NOT A READING: it asks for a flank darker '
      + 'than the sun term alone can make, so the cost falls all the way to the edge of the '
      + 'grid. It fixes the SIGN of the sun and not its size.\n');
  }

  // ------------------------------------------------------- and so, the physics
  const split = physicalSplit();
  process.stdout.write('\nTHE SEALED ATMOSPHERE, WHICH IS WHAT SETS THE SIZE\n');
  process.stdout.write(`  air mass at elevation ${JSON.parse(readFileSync(SKY, 'utf8')).day.sun.elevation}: `
    + `${split.m.toFixed(4)}\n`);
  process.stdout.write(`  beam transmitted   ${split.transmitted.map((v) => v.toFixed(4).padStart(9)).join('')}`
    + '   (this is exactly sunBeam, normalised on red — the seat and the model agree)\n');
  process.stdout.write(`  direct on a level patch ${split.direct.map((v) => v.toFixed(4).padStart(9)).join('')}\n`);
  process.stdout.write(`  diffuse on the same     ${split.diffuse.map((v) => v.toFixed(4).padStart(9)).join('')}\n`);
  process.stdout.write(`  direct / diffuse        ${split.perChannel.map((v) => v.toFixed(3).padStart(9)).join('')}`
    + `   in luminance ${split.luminance.toFixed(2)}\n`);

  // The two weights that carry that split. The ratio is the physics; the LEVEL
  // is held where the seat has it, measured as the luminance an open level patch
  // receives, so that putting the ratio in does not move the whole frame by a
  // factor of eight before anything has been refitted against it.
  const yOf = (hue, strength) => hue.reduce((t, v, c) => t + v * Y_WEIGHTS[c], 0) * strength;
  const level = yOf(ground.sunBeam, seat.day.sunStrength ?? 0) + yOf(ground.skyBalance, skyStrength);
  const perSun = yOf(ground.sunBeam, 1);
  const perSky = yOf(ground.skyBalance, 1);
  // The ratio of the two STRENGTHS, and it comes out as one division.
  //
  // sunBeam is the beam divided by the preset's per channel exposure and
  // normalised on red; skyBalance is the dome's irradiance divided by the same
  // exposure and normalised on blue. That division is the photograph's white
  // balance coming out, and it is the same division on both, so it cancels: for
  // the two weights to carry the physical irradiances,
  //
  //   sunStrength / skyStrength = (beam / exposure)[red] / (dome / exposure)[blue]
  //
  // and nothing else is needed. The channel by channel agreement is a check the
  // two hues are consistent with each other, and it is printed above.
  const ratio = (split.transmitted[0] * split.sinElevation)
    / (split.diffuse[2] / split.exposure[2]);
  const sky = level / (ratio * perSun + perSky);
  const sun = ratio * sky;
  process.stdout.write(`\n  sunStrength / skyStrength = ${ratio.toFixed(4)}: `
    + `the sun is ${(100 * ratio * perSun / (ratio * perSun + perSky)).toFixed(0)}%`
    + ' of the light on open level ground\n');
  process.stdout.write(`  holding that light where the seat has it (luminance ${level.toFixed(4)}):`
    + ` sunStrength ${sun.toFixed(4)}, skyStrength ${sky.toFixed(4)}\n`);
  const got = anchors.map((a) => predicted(a.flank, ground, sun, sky)
    / predicted(a.crown, ground, sun, sky));
  process.stdout.write(`  the anchor there: sx ${got[0].toFixed(4)} against `
    + `${anchors[0].wanted.toFixed(4)}, dx ${got[1].toFixed(4)} against `
    + `${anchors[1].wanted.toFixed(4)}\n`);

  if (WRITE) {
    seat.day.sunStrength = Number(sun.toFixed(4));
    seat.day.skyStrength = Number(sky.toFixed(4));
    writeFileSync(SEAT, `${JSON.stringify(seat, null, 2)}\n`, 'utf8');
    process.stdout.write(`\nwritten: ${SEAT} sunStrength ${seat.day.sunStrength} `
      + `skyStrength ${seat.day.skyStrength}\n`);
    process.stdout.write('  the LEVEL is still the old one: set it against the reference with '
      + '"node tools/lighting/fit-scene-light.mjs --ratio", then the albedo.\n');
  } else {
    process.stdout.write('\n(nothing written; pass --write)\n');
  }
}

await main();
