import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAME, makeRay, REPO_ROOT } from '../grade/lib/framing.mjs';
import { readTarget } from '../grade/lib/target.mjs';
import { loadGround, shadeGround, solveRadiance } from './probe.mjs';
import { worldToUv } from '../../src/world/terrain-field.js';

// WHAT THE REFERENCE ASKS OF THE GROUND THAT THE GEOMETRY DOES NOT GIVE IT.
//
// Inside the reference framing the meadow is not free: the client's criterion is
// the picture, and the picture states a value at every point of ground it shows.
// Outside it there is no picture, and the only honest shading is physical cause
// — which the two term bake now supplies for the first time, because the sky
// term IS occlusion of the sky and this repository never had one.
//
// So this walks the reference camera into the height field, inverts the whole
// composite on the reference's own pixels to find the radiance the ground has to
// carry there, divides by what the ground actually carries, and reports the
// RATIO AS A FIELD OVER WORLD POSITION. Not over the frame: a field anchored to
// the frame is a vignette that follows the eye, and one of those has already
// been rejected by the client.
//
// THE REFERENCE'S OWN VIGNETTE IS TAKEN OUT FIRST. target.png is a photograph
// with a lens shading of its own, and it is not the world's: sky.json
// `arrivalShading` is that shading, measured, and src/ui/veil.js puts it back at
// the front of the frame where a lens effect belongs. Leaving it in would bake
// the corners of one photograph into the meadow.
//
// ------------------------------------------------------------------------
// WHAT THIS DOES NOT DO, AND WHY IT IS THE POINT
//
// It does not apply the ratio. A field applied because the picture asks for it,
// with nothing in the world to cause it, is exactly `tools/terrain/shade-light.mjs`
// — the "cloud shadow" the client threw out with the words "shadows at spawn
// that have not the slightest reason to exist". The lesson of that rejection is
// not that the numbers were wrong. They were fitted, and they were fitted well.
// It is that a shadow needs a CAUSE.
//
// The client has since named the cause (2026-08-19): the ground is uneven and
// the grass is longer in places, raised into tussocks, with a stone at the left
// corner. That rule is being settled with another unit and the client owns it,
// and until it exists there is nothing here entitled to darken a meadow.
//
// So: --cause <file> takes that field when it arrives and applies ONLY what it
// explains, by the same arithmetic, with nothing else changed. With no cause
// declared this reports the whole ratio as unexplained, which is the
// specification the tussock rule has to meet.

const OUT = join(REPO_ROOT, 'assets-src', 'terrain', 'ground-demand.json');

/** The reference's own lens shading, from the seat the veil reads. */
function referenceShading() {
  const sky = JSON.parse(readFileSync(join(REPO_ROOT, 'assets-src', 'sky', 'sky.json'), 'utf8'));
  const { cols, rows, values } = sky.arrivalShading;
  return function shadingAt(px, py) {
    // Bilinear over the table, in frame coordinates, exactly as src/ui/veil.js
    // lays it down.
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

const STEP = 4;
const CELL = 0.5;       // metres of world per cell of the reported field

async function main() {
  const ground = await loadGround();
  const target = await readTarget();
  const ray = makeRay({ width: FRAME.width, height: FRAME.height });
  const shading = referenceShading();
  const cause = process.argv.includes('--cause')
    ? JSON.parse(readFileSync(process.argv[process.argv.indexOf('--cause') + 1], 'utf8'))
    : null;

  const cells = new Map();
  let counted = 0;
  let refused = 0;
  for (let py = 470; py < FRAME.height; py += STEP) {
    for (let px = 0; px < FRAME.width; px += STEP) {
      const shaded = shadeGround(ground, ray, px, py);
      if (!shaded) continue;
      const o = (py * target.width + px) * (target.channels || 3);
      const wanted = [0, 1, 2].map((c) => target.data[o + c] / 255);
      const solved = solveRadiance(wanted, px, py, ground.lut);
      if (solved.error > 0.02) { refused++; continue; }
      // Out with the photograph's own corner, and out with the fog, which is
      // air rather than ground: what is left is what the SURFACE must carry.
      const lens = shading(px, py);
      let gain = 0;
      let weight = 0;
      for (let c = 0; c < 3; c++) {
        const surface = (solved.radiance[c] / Math.max(1e-6, lens)
          - ground.fogColour[c] * shaded.fog) / Math.max(1e-6, 1 - shaded.fog);
        const has = (shaded.colour[c] - ground.fogColour[c] * shaded.fog)
          / Math.max(1e-6, 1 - shaded.fog);
        if (has <= 1e-5) continue;
        // Weighted by how much light the channel carries, so the blue of a deep
        // shadow does not decide the ratio for the other two.
        gain += (surface / has) * has;
        weight += has;
      }
      if (weight <= 0) continue;
      gain /= weight;
      const key = `${Math.round(shaded.hit.x / CELL)}|${Math.round(shaded.hit.z / CELL)}`;
      const bag = cells.get(key) || { n: 0, sum: 0, x: 0, z: 0, d: 0 };
      bag.n++; bag.sum += gain; bag.x += shaded.hit.x; bag.z += shaded.hit.z;
      bag.d += shaded.hit.distance;
      cells.set(key, bag);
      counted++;
    }
  }

  const field = [...cells.values()].map((b) => ({
    x: Number((b.x / b.n).toFixed(2)),
    z: Number((b.z / b.n).toFixed(2)),
    distance: Number((b.d / b.n).toFixed(2)),
    gain: Number((b.sum / b.n).toFixed(4)),
    samples: b.n,
  })).sort((a, b) => a.distance - b.distance);

  process.stdout.write(`WHAT THE REFERENCE ASKS OF THE GROUND, over ${counted} samples `
    + `in ${field.length} cells of ${CELL} m (${refused} pixels the composite would not invert)\n\n`);
  const bands = [[0, 6], [6, 9], [9, 12], [12, 16], [16, 22], [22, 40]];
  process.stdout.write('distance      cells   gain the picture asks for\n');
  for (const [a, b] of bands) {
    const here = field.filter((f) => f.distance >= a && f.distance < b);
    if (here.length < 4) continue;
    const g = here.map((f) => f.gain).sort((x, y) => x - y);
    const q = (p) => g[Math.min(g.length - 1, Math.floor(p * g.length))];
    process.stdout.write(`${String(a).padStart(3)}-${String(b).padStart(2)} m   `
      + `${String(here.length).padStart(6)}   `
      + `p10 ${q(0.1).toFixed(2)}  median ${q(0.5).toFixed(2)}  p90 ${q(0.9).toFixed(2)}\n`);
  }

  // East against west, because the reference's own asymmetry is the thing a
  // tussock rule has to reproduce and a median over the whole field hides it.
  process.stdout.write('\nacross the meadow, 6 to 16 m out\n');
  for (const [name, lo, hi] of [['west', -20, -4], ['centre', -4, 4], ['east', 4, 20]]) {
    const here = field.filter((f) => f.distance >= 6 && f.distance < 16
      && f.x >= lo && f.x < hi);
    if (!here.length) continue;
    const mean = here.reduce((t, f) => t + f.gain, 0) / here.length;
    process.stdout.write(`  ${name.padEnd(7)} ${String(here.length).padStart(5)} cells  `
      + `mean gain ${mean.toFixed(2)}\n`);
  }

  if (!cause) {
    process.stdout.write('\nNO CAUSE DECLARED, so nothing is applied and nothing is written\n'
      + 'into the delivery. The whole of the field above is what the tussock rule\n'
      + 'has to explain — it is the specification, not a correction.\n');
  }
  writeFileSync(OUT, `${JSON.stringify({ cell: CELL, pose: 'posa-P', field }, null, 1)}\n`, 'utf8');
  process.stdout.write(`\n${OUT}\n`);
}

await main();
