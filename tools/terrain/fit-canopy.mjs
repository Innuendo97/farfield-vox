import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAME, makeRay, REPO_ROOT } from '../grade/lib/framing.mjs';
import { readTarget } from '../grade/lib/target.mjs';
import { pathCoord } from '../../src/world/terrain-field.js';
import { turfCanopy } from '../../src/world/turf.js';
import { castShadowTest } from '../lighting/cast-shadow.mjs';
import { loadGround, shadeGround, solveRadiance } from './probe.mjs';

// HOW MUCH SKY A CANOPY KEEPS OFF THE SOIL UNDER IT.
//
// Cycles bakes the shadow of everything that is geometry, and in this world the
// grass is not: the meadow is a painted albedo with cards standing on it. So the
// bake hands back soil that sees the whole dome wherever the blades are longest,
// which is exactly where the reference is darkest. The correction is one
// constant — the sky term is multiplied by (1 - k * G) when the map is packed,
// tools/lighting/pack-light.mjs — and this is where k is measured.
//
// WHERE. At the edges of the path, and the reason is that it is the only place
// in the frame where the canopy changes and nothing else does. The turf field
// puts the longest blades of the whole picture there (0.34 m against 0.28 in the
// open meadow, s2-regola-erba/RAPPORTO 2.5), at the same distance from the eye,
// in the same air, on the same material, a metre apart. Anywhere else a change
// in brightness is also a change in distance or in what the surface is.
//
// HOW. Not by matching a level: the albedo of the grass is itself being refitted
// this session and the exposure of the ground is a separate constant, so an
// absolute comparison would fold three unknowns into one. Instead the logarithm
// of the reference's surface radiance is regressed on G, over grass alone, and a
// level error shared by the whole set falls out of a slope.
//
// AND ON TWO OTHER THINGS BESIDE G, because the first version of this fit was
// wrong and said so. Regressed on G alone the nearest bin came back with the
// slope the WRONG WAY UP (+0.91, correlation 0.23): in the frame, long grass
// stands at the edge of the path, which is the middle of the picture, and short
// grass stands out towards the corners, which is where the reference is dark for
// reasons that have nothing to do with the canopy. The photograph's own corner
// falloff is not fully in sky.json's arrivalShading — that table is a sky fit and
// its ground rows are flat — so it lands in the residual and G stands in for it.
//
// So the regression carries three terms: the canopy, the square of the distance
// from the centre of the frame (which is what a lens shading looks like), and
// the distance to the surface (which is what the fog and the walker's own
// occlusion look like). The coefficient on G is then what is left when the other
// two have taken what is theirs, and its own error bar is reported: a k without
// one is not a measurement.
//
//   node tools/terrain/fit-canopy.mjs
//
// The number it prints goes into TRANSFER.SKY_OCCLUSION_K of
// tools/turf/turf-rule.mjs, which is the seat of everything about the canopy,
// and then "node tools/turf/build-turf.mjs" and a repack carry it into the map.
// No bake: the correction is applied to the term after Cycles has written it.

const BINS = [[5, 8], [8, 11], [11, 15], [15, 20]];
const Y = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

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

async function main() {
  const ground = await loadGround();
  const target = await readTarget();
  const ray = makeRay({ width: FRAME.width, height: FRAME.height });
  const shading = referenceShading();

  // Grass only, and open grass at that: the path itself is stone with a
  // different albedo, and its edge is where the painted transition lives.
  //
  // AND OUTSIDE THE BELT THE REFERENCE CONTRADICTS. The committente chose pure
  // physics from the sealed sun, so the ground standing inside a block's cast
  // shadow is ground the photograph disagrees with by a factor of two to five —
  // and it happens to be exactly where the field gates the turf off, beside the
  // blocks. Left in, those samples hand the canopy the credit for the brightest
  // band in the picture, which is not the canopy's and would inflate k.
  const occluded = castShadowTest({ withBuilt: true });
  const samples = [];
  let dropped = 0;
  for (let py = 520; py < FRAME.height; py += 3) {
    for (let px = 0; px < FRAME.width; px += 3) {
      const shaded = shadeGround(ground, ray, px, py);
      if (!shaded) continue;
      const d = shaded.hit.distance;
      if (d < BINS[0][0] || d > BINS[BINS.length - 1][1]) continue;
      if (Math.abs(pathCoord(shaded.hit.x, shaded.hit.z)) < 1.25) continue;
      if (occluded(shaded.hit.x, shaded.hit.y + 0.02, shaded.hit.z)) { dropped++; continue; }
      const o = (py * target.width + px) * (target.channels || 3);
      const wanted = [0, 1, 2].map((c) => target.data[o + c] / 255);
      const solved = solveRadiance(wanted, px, py, ground.lut);
      if (solved.error > 0.02) continue;
      const lens = shading(px, py);
      const surface = [0, 1, 2].map((c) => (solved.radiance[c] / lens
        - ground.fogColour[c] * shaded.fog) / Math.max(1e-6, 1 - shaded.fog));
      const radiance = Y(surface);
      if (!(radiance > 1e-5)) continue;
      const rx = (px - FRAME.width / 2) / (FRAME.width / 2);
      const ry = (py - FRAME.height / 2) / (FRAME.height / 2);
      samples.push({
        d, g: turfCanopy(shaded.hit.x, shaded.hit.z), radiance, r2: rx * rx + ry * ry,
      });
    }
  }

  process.stdout.write(`${samples.length} samples of open grass between `
    + `${BINS[0][0]} and ${BINS[BINS.length - 1][1]} m, `
    + `${dropped} dropped for standing in the seat sun's cast shadow\n\n`);

  /**
   * Ordinary least squares of ln(radiance) on the given columns, with the
   * standard error of every coefficient. Solved by Gauss-Jordan on the normal
   * equations, which is enough at four columns and lets the inverse out for the
   * error bars.
   */
  function regress(rows, columns) {
    const p = columns.length;
    const xtx = Array.from({ length: p }, () => new Float64Array(p));
    const xty = new Float64Array(p);
    for (const row of rows) {
      const x = columns.map((c) => c.of(row));
      const y = Math.log(row.radiance);
      for (let i = 0; i < p; i++) {
        xty[i] += x[i] * y;
        for (let j = 0; j < p; j++) xtx[i][j] += x[i] * x[j];
      }
    }
    // Inverse by Gauss-Jordan with partial pivoting.
    const a = xtx.map((r, i) => [...r, ...Array.from({ length: p }, (u, j) => (i === j ? 1 : 0))]);
    for (let col = 0; col < p; col++) {
      let pivot = col;
      for (let r = col + 1; r < p; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
      [a[col], a[pivot]] = [a[pivot], a[col]];
      const d = a[col][col];
      for (let j = 0; j < 2 * p; j++) a[col][j] /= d;
      for (let r = 0; r < p; r++) {
        if (r === col) continue;
        const f = a[r][col];
        for (let j = 0; j < 2 * p; j++) a[r][j] -= f * a[col][j];
      }
    }
    const inv = a.map((r) => r.slice(p));
    const beta = inv.map((r) => r.reduce((t, v, j) => t + v * xty[j], 0));
    let rss = 0;
    for (const row of rows) {
      const x = columns.map((c) => c.of(row));
      const fitted = x.reduce((t, v, i) => t + v * beta[i], 0);
      rss += (Math.log(row.radiance) - fitted) ** 2;
    }
    const sigma2 = rss / Math.max(1, rows.length - p);
    return beta.map((b, i) => ({ name: columns[i].name, b, se: Math.sqrt(sigma2 * inv[i][i]) }));
  }

  const COLUMNS = [
    { name: 'constant', of: () => 1 },
    { name: 'canopy G', of: (s) => s.g },
    { name: 'r^2 in frame', of: (s) => s.r2 },
    { name: 'distance', of: (s) => s.d },
  ];

  process.stdout.write('THE REGRESSION OF ln(surface radiance) ON THE THREE CAUSES\n');
  process.stdout.write(`${'set'.padEnd(12)}${'n'.padStart(7)}`
    + `${COLUMNS.slice(1).map((c) => `${c.name} +- se`.padStart(24)).join('')}\n`);

  const runs = [['5-20 m, all', samples],
    ...BINS.map(([lo, hi]) => [`${lo}-${hi} m`, samples.filter((s) => s.d >= lo && s.d < hi)])];
  const readings = [];
  for (const [label, rows] of runs) {
    if (rows.length < 400) continue;
    const fit = regress(rows, COLUMNS);
    const g = fit[1];
    const mg = rows.reduce((t, s) => t + s.g, 0) / rows.length;
    // ln(1 - kG) has slope -k / (1 - k*mean G): solved for k at the set's mean.
    const k = g.b >= 0 ? 0 : -g.b / (1 - g.b * mg);
    if (label !== '5-20 m, all') readings.push({ label, k, t: g.b / g.se, n: rows.length });
    process.stdout.write(`${label.padEnd(12)}${String(rows.length).padStart(7)}`
      + `${fit.slice(1).map((f) => `${f.b.toFixed(3)} +- ${f.se.toFixed(3)}`.padStart(24)).join('')}`
      + `    k ${k.toFixed(3)}  t ${(g.b / g.se).toFixed(1)}\n`);
  }

  const whole = regress(samples, COLUMNS);
  const g = whole[1];
  const mg = samples.reduce((t, s) => t + s.g, 0) / samples.length;
  const k = g.b >= 0 ? 0 : -g.b / (1 - g.b * mg);
  const t = g.b / g.se;
  process.stdout.write('\nTHE READING\n');
  process.stdout.write(`  the canopy's own coefficient is ${g.b.toFixed(3)} +- ${g.se.toFixed(3)}`
    + ` (t = ${t.toFixed(1)}), which is k = ${k.toFixed(3)}\n`);
  const agree = readings.filter((r) => r.k > 0).length;
  process.stdout.write(`  ${agree} of the ${readings.length} distance bins agree on the sign\n`);
  if (Math.abs(t) < 4 || agree < readings.length - 1) {
    process.stdout.write('  THE REFERENCE DOES NOT MEASURE THIS. Either the coefficient is '
      + 'inside its own error bar or the distance bins disagree about its sign: a k taken '
      + 'from here would be a number with no measurement under it.\n');
  }
  process.stdout.write('\nput it in TRANSFER.SKY_OCCLUSION_K of tools/turf/turf-rule.mjs, '
    + 'then rebuild the field and repack\n');
}

await main();
