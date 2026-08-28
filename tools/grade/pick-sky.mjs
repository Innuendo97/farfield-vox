import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { decodeRadiance } from './lib/hdr.mjs';
import {
  downsampleEquirect, FRAME, makeRay, projectEquirect, REPO_ROOT,
} from './lib/framing.mjs';
import { agx } from './lib/agx.mjs';
import { deltaE76, linearToSrgb, srgbToLab } from './lib/color.mjs';
import { buildSkyMask, readTarget } from './lib/target.mjs';

// Ranks the candidate sky sources against the reference image.
//
// The question is not "which sky is prettiest" but "which sky, once the colour
// is free to be corrected, still stands in the right place". So every candidate
// is drawn through the reference camera at every rotation, given the best
// per channel gain it can have, and judged on what is left: the residual is the
// structural mismatch, which grading cannot repair.

const HDRI_DIR = join(REPO_ROOT, 'assets-src', 'hdri');
const OUT_DIR = join(REPO_ROOT, 'assets-src', 'hdri', '.report');

const COARSE = { width: 152, height: 86 };
const PREVIEW = { width: 836, height: 470 };
const COARSE_STEP = 6;
const FINE_STEP = 1;
const FINE_SPAN = 8;

function toLab(linear, exposure, gain, out) {
  const scaled = [linear[0] * gain[0], linear[1] * gain[1], linear[2] * gain[2]];
  const mapped = agx(scaled, exposure, out);
  return srgbToLab([linearToSrgb(mapped[0]), linearToSrgb(mapped[1]), linearToSrgb(mapped[2])]);
}

function meanError(samples, targetLab, gain) {
  let total = 0;
  const scratch = [0, 0, 0];
  for (let i = 0; i < targetLab.length; i++) {
    const lab = toLab(samples[i], 1, gain, scratch);
    total += deltaE76(lab, targetLab[i]);
  }
  return total / targetLab.length;
}

// Pattern search over the three log gains. The surface is smooth and shallow,
// so a shrinking coordinate sweep finds the floor in far fewer evaluations than
// a generic optimiser would.
function fitGain(samples, targetLab, start = [0, 0, 0]) {
  const log = start.slice();
  let step = 0.9;
  let best = meanError(samples, targetLab, log.map(Math.exp));
  for (let round = 0; round < 14; round++) {
    let improved = false;
    for (let c = 0; c < 3; c++) {
      for (const delta of [step, -step]) {
        const trial = log.slice();
        trial[c] += delta;
        const error = meanError(samples, targetLab, trial.map(Math.exp));
        if (error < best - 1e-6) { best = error; log[c] = trial[c]; improved = true; }
      }
    }
    if (!improved) step *= 0.5;
    if (step < 0.004) break;
  }
  return { gain: log.map(Math.exp), logGain: log, error: best };
}

async function coarseTarget() {
  const full = await readTarget();
  const { data, info } = await sharp(full.data, {
    raw: { width: full.width, height: full.height, channels: 3 },
  }).resize(COARSE.width, COARSE.height, { kernel: 'lanczos3' }).raw()
    .toBuffer({ resolveWithObject: true });
  const mask = await buildSkyMask(COARSE.width, COARSE.height);
  const ray = makeRay(COARSE);
  const index = [];
  const lab = [];
  const elevation = [];
  for (let i = 0; i < COARSE.width * COARSE.height; i++) {
    if (!mask[i]) continue;
    index.push(i);
    lab.push(srgbToLab([data[i * 3] / 255, data[i * 3 + 1] / 255, data[i * 3 + 2] / 255]));
    const d = ray(i % COARSE.width, Math.floor(i / COARSE.width));
    elevation.push(Math.asin(d[1]) * 180 / Math.PI);
  }
  void info;
  return { index, lab, elevation };
}

function sampleAt(map, rotationDeg, index) {
  const frame = projectEquirect(map, { ...COARSE, rotationDeg });
  return index.map((i) => [frame[i * 3], frame[i * 3 + 1], frame[i * 3 + 2]]);
}

async function writePreview(map, rotationDeg, gain, path) {
  const frame = projectEquirect(map, { ...PREVIEW, rotationDeg });
  const out = Buffer.alloc(PREVIEW.width * PREVIEW.height * 3);
  const scratch = [0, 0, 0];
  for (let i = 0; i < PREVIEW.width * PREVIEW.height; i++) {
    const mapped = agx([frame[i * 3] * gain[0], frame[i * 3 + 1] * gain[1], frame[i * 3 + 2] * gain[2]], 1, scratch);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(linearToSrgb(mapped[c]) * 255);
  }
  await sharp(out, { raw: { width: PREVIEW.width, height: PREVIEW.height, channels: 3 } })
    .png({ compressionLevel: 9 }).toFile(path);
}

// Cloud cover by elevation band. This is the measurement that decides the
// route: colour can always be graded, but a sky whose clouds sit in a thin band
// near the horizon can never be made to stand as tall as the reference.
const BANDS = [[0, 5], [5, 10], [10, 15], [15, 20], [20, 27]];

function cloudProfile(labs, elevations) {
  const counts = BANDS.map(() => ({ cloud: 0, total: 0 }));
  for (let i = 0; i < labs.length; i++) {
    const e = elevations[i];
    const band = BANDS.findIndex(([a, b]) => e >= a && e < b);
    if (band === -1) continue;
    counts[band].total++;
    // Cloud reads as bright and near neutral; clear sky stays dark and blue.
    if (labs[i][0] > 72 && labs[i][2] > -22) counts[band].cloud++;
  }
  return counts.map((c) => (c.total > 40 ? c.cloud / c.total : null));
}

function formatProfile(profile) {
  return BANDS.map(([a, b], i) => {
    const v = profile[i];
    return `${a}-${b}deg ${v === null ? '  n/a' : `${(v * 100).toFixed(0).padStart(3)}%`}`;
  }).join('  ');
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(HDRI_DIR).filter((f) => f.endsWith('.hdr')).sort();
  if (files.length === 0) throw new Error(`no .hdr candidate in ${HDRI_DIR}`);

  const target = await coarseTarget();
  process.stdout.write(`reference: ${FRAME.width}x${FRAME.height}, ${target.index.length} sky samples at ${COARSE.width}x${COARSE.height}\n\n`);
  process.stdout.write(`cloud cover by elevation band\n  ${'reference'.padEnd(42)}${formatProfile(cloudProfile(target.lab, target.elevation))}\n`);

  const results = [];
  for (const file of files) {
    const name = basename(file, '.hdr');
    const started = Date.now();
    const full = decodeRadiance(readFileSync(join(HDRI_DIR, file)));
    const coarse = downsampleEquirect(full, 512, 256);

    let best = null;
    for (let rotation = 0; rotation < 360; rotation += COARSE_STEP) {
      const samples = sampleAt(coarse, rotation, target.index);
      const fit = fitGain(samples, target.lab, best ? best.logGain : [0, 0, 0]);
      if (!best || fit.error < best.error) best = { ...fit, rotation };
    }
    for (let d = -FINE_SPAN; d <= FINE_SPAN; d += FINE_STEP) {
      const rotation = (best.rotation + d + 360) % 360;
      const samples = sampleAt(coarse, rotation, target.index);
      const fit = fitGain(samples, target.lab, best.logGain);
      if (fit.error < best.error) best = { ...fit, rotation };
    }

    const bestSamples = sampleAt(coarse, best.rotation, target.index);
    const bestLab = bestSamples.map((s) => {
      const m = agx([s[0] * best.gain[0], s[1] * best.gain[1], s[2] * best.gain[2]], 1, [0, 0, 0]);
      return srgbToLab([linearToSrgb(m[0]), linearToSrgb(m[1]), linearToSrgb(m[2])]);
    });
    process.stdout.write(`  ${name.padEnd(42)}${formatProfile(cloudProfile(bestLab, target.elevation))}
`);
    await writePreview(coarse, best.rotation, best.gain, join(OUT_DIR, `${name}.png`));
    results.push({ name, ...best, seconds: (Date.now() - started) / 1000, size: `${full.width}x${full.height}` });
    process.stdout.write(
      `${name.padEnd(42)} dE ${best.error.toFixed(2).padStart(6)}  rot ${String(best.rotation).padStart(3)}deg  `
      + `gain ${best.gain.map((g) => g.toFixed(3)).join(' ')}  ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
    );
  }

  results.sort((a, b) => a.error - b.error);
  process.stdout.write(`\nbest: ${results[0].name} at ${results[0].rotation} deg, mean dE76 ${results[0].error.toFixed(2)}\n`);
  process.stdout.write(`previews: ${OUT_DIR}\n`);
}

main();
