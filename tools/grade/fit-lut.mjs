import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { FRAME, REPO_ROOT } from './lib/framing.mjs';
import { writeCleanPng } from './lib/png.mjs';
import {
  deltaE2000, deltaE76, linearToSrgb, srgbToLab, srgbToLinear,
} from './lib/color.mjs';
import { meanRect, readTarget, REGIONS } from './lib/target.mjs';

// Fits the grade that sits at the end of the composite.
//
// The method is deliberately blunt: render the reference pose with the grade
// switched off, read the same patches out of that render and out of the
// reference, and solve for the smooth colour transform that carries one to the
// other. Then bake that transform into a lookup cube so the renderer pays a
// texture fetch instead of arithmetic.
//
// The grade is fitted on the sky and on nothing else, and it is held to the
// identity everywhere the sky does not reach.
//
// It used to be fitted on the ground as well, at a low weight, and that was the
// mistake. Every sky sample in this frame is bright, so the dark end of the cube
// was an extrapolation with no data under it: the constant term of the fit ran
// away and the cube lifted black from nothing to #3b3e52. The reference has its
// own black at about #1b232c, so the deepest greens and the shaded stone of the
// reference stopped being reachable by any radiance at all — no albedo and no
// bake could have produced them, because the last stage of the frame refused to
// go that dark. A grade that makes part of the reference unreachable is not a
// grade, whatever it does for the rest of the frame.
//
// So the sample set is the sky, and a lattice of anchors that say the transform
// must leave a colour alone unless there is evidence to move it. The ground and
// the stone are still measured and still reported, but only as observation:
// their identity comes from the albedo and the bake, which is where a surface
// colour belongs.
//
// HOW shots/grade-input.png HAS TO BE TAKEN, and it changed on 2026-08-20.
//
// This fit reads the same rectangles out of the render and out of the reference
// and solves for what carries one to the other, so anything that darkens one of
// them and not the other is silently folded into the cube. The corner shading
// used to be applied inside the composite, so a read of the drawing buffer
// carried it and the two sides agreed. It is now applied by the arrival veil
// (src/ui/veil.js), which is a DOM overlay: a read of the drawing buffer does
// NOT carry it, and target.png does.
//
// So the input frame must be a PICTURE OF THE PAGE at the spawn, with the veil
// up — ?dev&t0 holds it — and not a canvas.toDataURL(). Taken the old way, the
// render is up to nineteen per cent brighter than the reference at the corners
// for a reason that has nothing to do with colour, and the cube fitted from it
// would try to answer a position with a tint. s2-dev5/shoot.mjs takes frames
// the right way and says why.

const OUT_DIR = join(REPO_ROOT, 'assets-src', 'grade');
const PUBLIC_LUT = join(REPO_ROOT, 'public', 'assets', 'grade-lut.png');
const RENDER = join(REPO_ROOT, 'shots', 'grade-input.png');

const LUT_SIZE = 32;

// Only the sky pulls. Everything else is observed and reported.
const WEIGHTS = { sky: 1.0 };

// How far the sky is allowed to move from where the bake put it, in dE76.
// It is the acceptance test of the whole sweep, not a preference.
const SKY_TOLERANCE = 3.0;

// How far the transform may carry a colour it has no evidence about, measured
// in the encoded space the cube is sampled in. Twelve levels of 255 is a look;
// anything more is the grade deciding what a surface is.
const ANCHOR_DRIFT = 0.047;

// How far any region that is not sky may be allowed to get worse, in dE76.
// This is the rule, not a preference: a grade that improves one part of the
// frame by spoiling another is refused, whatever the arithmetic mean says. Half
// a unit is under the threshold at which two colours are told apart at all.
const COLLATERAL = 0.5;

// Lattice of colours the transform is asked to leave where they are, spread
// over the whole cube so that the corners the sky never visits are held to the
// identity instead of being invented. Deliberately dense at the bottom: that is
// where the ground lives and where an unconstrained fit does its damage.
const ANCHOR_LEVELS = [0, 0.02, 0.05, 0.12, 0.25, 0.5, 0.75, 1];

function identityAnchors() {
  const anchors = [];
  for (const r of ANCHOR_LEVELS) {
    for (const g of ANCHOR_LEVELS) {
      for (const b of ANCHOR_LEVELS) {
        anchors.push([r, g, b]);
      }
    }
  }
  return anchors;
}

function solve(matrix, rhs) {
  const n = rhs.length;
  const m = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    if (Math.abs(m[col][col]) < 1e-12) continue;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row][col] / m[col][col];
      for (let k = col; k <= n; k++) m[row][k] -= factor * m[col][k];
    }
  }
  return m.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

/**
 * Weighted least squares fit of one output channel against the basis.
 * Ridge regularised towards the identity: with a handful of patches an
 * unconstrained 3x3 will happily invent a colour rotation that fits them and
 * ruins everything between them.
 */
function fitChannel(rows, targets, weights, prior, lambda) {
  const n = rows[0].length;
  const ata = Array.from({ length: n }, () => new Array(n).fill(0));
  const atb = new Array(n).fill(0);
  for (let s = 0; s < rows.length; s++) {
    const w = weights[s];
    for (let i = 0; i < n; i++) {
      atb[i] += w * rows[s][i] * targets[s];
      for (let j = 0; j < n; j++) ata[i][j] += w * rows[s][i] * rows[s][j];
    }
  }
  for (let i = 0; i < n; i++) {
    ata[i][i] += lambda;
    atb[i] += lambda * prior[i];
  }
  return solve(ata, atb);
}

// Basis of the transform: linear in the three channels, plus a constant, plus a
// square term per channel so the fit can bend the response rather than only
// tilt it. Smooth by construction, which is what keeps the baked cube free of
// banding.
function basis([r, g, b]) {
  return [r, g, b, 1, r * r, g * g, b * b];
}

const IDENTITY_PRIOR = [
  [1, 0, 0, 0, 0, 0, 0],
  [0, 1, 0, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 0, 0],
];

function applyFit(fit, rgb) {
  const row = basis(rgb);
  return fit.map((coefficients) => {
    let total = 0;
    for (let i = 0; i < row.length; i++) total += coefficients[i] * row[i];
    return Math.min(1, Math.max(0, total));
  });
}

async function readRender() {
  if (!existsSync(RENDER)) {
    throw new Error(`missing ungraded render: ${RENDER}\n`
      + '  produce it first by capturing the reference pose with the grade stage off');
  }
  const { data, info } = await sharp(RENDER).removeAlpha()
    .resize(FRAME.width, FRAME.height, { fit: 'fill' }).raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: 3, data };
}

function report(label, rows) {
  process.stdout.write(`\n${label}\n`);
  process.stdout.write(`  ${'region'.padEnd(20)}${'kind'.padEnd(8)}${'dE76'.padStart(7)}${'dE2000'.padStart(8)}\n`);
  for (const row of rows) {
    process.stdout.write(`  ${row.id.padEnd(20)}${row.kind.padEnd(8)}`
      + `${row.e76.toFixed(2).padStart(7)}${row.e2000.toFixed(2).padStart(8)}\n`);
  }
  const mean = (key) => rows.reduce((t, r) => t + r[key], 0) / rows.length;
  const skyRows = rows.filter((r) => r.kind === 'sky');
  process.stdout.write(`  ${'mean'.padEnd(28)}${mean('e76').toFixed(2).padStart(7)}${mean('e2000').toFixed(2).padStart(8)}\n`);
  process.stdout.write(`  ${'mean, sky only'.padEnd(28)}`
    + `${(skyRows.reduce((t, r) => t + r.e76, 0) / skyRows.length).toFixed(2).padStart(7)}`
    + `${(skyRows.reduce((t, r) => t + r.e2000, 0) / skyRows.length).toFixed(2).padStart(8)}\n`);
  return { e76: mean('e76'), e2000: mean('e2000') };
}

async function main() {
  const render = await readRender();
  const target = await readTarget();

  const samples = REGIONS.map((region) => ({
    id: region.id,
    kind: region.kind,
    weight: WEIGHTS[region.kind] ?? 0,
    from: meanRect(render, region),
    to: meanRect(target, region),
  }));

  const before = samples.map((s) => ({
    id: s.id,
    kind: s.kind,
    e76: deltaE76(srgbToLab(s.from), srgbToLab(s.to)),
    e2000: deltaE2000(srgbToLab(s.from), srgbToLab(s.to)),
  }));
  report('before grading', before);

  // Solved in display referred linear light: the grade has to be smooth in the
  // space the cube is sampled in, and a fit done on encoded values bends
  // hardest exactly where the eye is most sensitive.
  const toLinear = (rgb) => rgb.map(srgbToLinear);
  const anchors = identityAnchors();
  const pulling = samples.filter((s) => s.weight > 0);
  const rows = [
    ...pulling.map((s) => basis(toLinear(s.from))),
    ...anchors.map((a) => basis(a)),
  ];

  // Two knobs are swept together: how hard the fit is held towards the identity
  // as a matrix, and how hard the anchors hold it to the identity as a
  // transform. The chosen pair is the one that carries the sky furthest, so
  // long as it also leaves everything the sky does not cover where it found it,
  // which is what the anchor error measures.
  let best = null;
  for (const lambda of [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1]) {
    for (const hold of [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25]) {
      const weights = [
        ...pulling.map((s) => s.weight),
        ...anchors.map(() => hold),
      ];
      const fit = [0, 1, 2].map((c) => fitChannel(
        rows,
        [...pulling.map((s) => toLinear(s.to)[c]), ...anchors.map((a) => a[c])],
        weights, IDENTITY_PRIOR[c], lambda,
      ));
      const after = samples.map((s) => {
        const graded = applyFit(fit, toLinear(s.from)).map(linearToSrgb);
        return {
          id: s.id,
          kind: s.kind,
          e76: deltaE76(srgbToLab(graded), srgbToLab(s.to)),
          e2000: deltaE2000(srgbToLab(graded), srgbToLab(s.to)),
        };
      });
      const sky = after.filter((r) => r.kind === 'sky');
      const skyMean = sky.reduce((t, r) => t + r.e76, 0) / sky.length;
      if (skyMean >= SKY_TOLERANCE) continue;

      // How far the transform moves a colour it was told nothing about, in the
      // encoded space the cube is sampled in. Held under a bound rather than
      // minimised: some drift is the whole point of a look, a lot of it is the
      // grade deciding what the ground looks like.
      const drift = anchors.reduce((worst, a) => {
        const moved = applyFit(fit, a).map(linearToSrgb);
        const from = a.map(linearToSrgb);
        return Math.max(worst, ...moved.map((v, c) => Math.abs(v - from[c])));
      }, 0);
      if (drift > ANCHOR_DRIFT) continue;

      // Nothing outside the sky may be left worse than it was found.
      let collateral = 0;
      for (let i = 0; i < after.length; i++) {
        if (after[i].kind === 'sky') continue;
        collateral = Math.max(collateral, after[i].e76 - before[i].e76);
      }
      if (collateral > COLLATERAL) continue;

      const mean = after.reduce((t, r) => t + r.e76, 0) / after.length;
      if (!best || skyMean < best.skyMean) {
        best = { lambda, hold, fit, after, mean, skyMean, drift, collateral };
      }
    }
  }
  if (!best) {
    throw new Error(`no fit kept the sky within ${SKY_TOLERANCE} dE76, the untouched `
      + `colours within ${ANCHOR_DRIFT} and every other region within ${COLLATERAL} dE76 `
      + 'of where it started');
  }

  const after = report(`after grading (regularisation ${best.lambda}, identity hold ${best.hold}, `
    + `worst untouched drift ${best.drift.toFixed(3)}, `
    + `worst collateral ${best.collateral.toFixed(2)} dE76)`, best.after);

  // Bake the cube. The strip is size*size wide by size tall, blue along the
  // strip and green down it, which is what post.js samples.
  const width = LUT_SIZE * LUT_SIZE;
  const pixels = Buffer.alloc(width * LUT_SIZE * 3);
  for (let b = 0; b < LUT_SIZE; b++) {
    for (let g = 0; g < LUT_SIZE; g++) {
      for (let r = 0; r < LUT_SIZE; r++) {
        const input = [r, g, b].map((v) => srgbToLinear(v / (LUT_SIZE - 1)));
        const output = applyFit(best.fit, input);
        const o = (g * width + b * LUT_SIZE + r) * 3;
        for (let c = 0; c < 3; c++) {
          pixels[o + c] = Math.round(Math.min(1, Math.max(0, linearToSrgb(output[c]))) * 255);
        }
      }
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(join(REPO_ROOT, 'public', 'assets'), { recursive: true });
  const bytes = await writeCleanPng(pixels, { width, height: LUT_SIZE }, PUBLIC_LUT);

  const record = {
    size: LUT_SIZE,
    regularisation: best.lambda,
    identityHold: best.hold,
    anchorLevels: ANCHOR_LEVELS,
    worstUntouchedDrift: Number(best.drift.toFixed(4)),
    worstCollateral: Number(best.collateral.toFixed(3)),
    collateralLimit: COLLATERAL,
    skyTolerance: SKY_TOLERANCE,
    anchorDrift: ANCHOR_DRIFT,
    weights: WEIGHTS,
    basis: ['r', 'g', 'b', '1', 'r2', 'g2', 'b2'],
    coefficients: best.fit.map((row) => row.map((v) => Number(v.toFixed(6)))),
    deltaE: {
      before: Object.fromEntries(before.map((r) => [r.id, Number(r.e76.toFixed(2))])),
      after: Object.fromEntries(best.after.map((r) => [r.id, Number(r.e76.toFixed(2))])),
      meanBefore: Number((before.reduce((t, r) => t + r.e76, 0) / before.length).toFixed(2)),
      meanAfter: Number(after.e76.toFixed(2)),
    },
  };
  writeFileSync(join(OUT_DIR, 'lut.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  process.stdout.write(`\n${PUBLIC_LUT} (${(bytes / 1024).toFixed(1)} kB)\n`);
  process.stdout.write(`${join(OUT_DIR, 'lut.json')}\n`);
}

main();
