import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPO_ROOT } from '../grade/lib/framing.mjs';
import { writeCleanPng } from '../grade/lib/png.mjs';
import {
  GRAIN, apronAt, grainAt, grainTone, grainUv, paveAt, pathPigment,
} from '../../src/world/path.js';

// A PLAN VIEW OF THE PAVING, PAINTED OFFLINE, AT THE REFERENCE'S OWN SCALE.
//
//   node tools/path/plan-patch.mjs --z=-4 --out=v3-sentiero/dev1/piano-medio.png
//   node tools/path/plan-patch.mjs --z=8  --out=v3-sentiero/dev1/piano-apron.png
//
// WHAT IT IS FOR AND WHAT IT IS NOT. check-slabs.mjs --plan and the shape
// reading both want a square of paving seen from straight above at 3.0 mm a
// pixel, which is what sentiero-texture.png is. Getting one out of the running
// world costs a browser, a delivery and a pose; getting one out of the generator
// costs a second. So this is the BENCH a coat of paint is chosen on, and it is
// not the verdict: check-slabs says so itself -- the verdict is always a real
// render at the plan's own pose, which is the only thing that carries the shader. The gap
// between this and that render is measured and written down rather than assumed
// to be nought.
//
// AND IT IS DELIBERATELY WIDER THAN THE CORRIDOR. The reference is a picture of
// PAVING: there is no verge in it and no meadow. The generator is a field over
// the whole plane and knows nothing about how wide the corridor is -- what cuts
// the paving to the path is the surface's own coverage, in the frame -- so a
// patch of it 3.76 m square is the same subject the reference is, taken at the
// northing whose tuning is being fitted.

const flag = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};

// The reference's own scale, and it is not free: the shape reading carries 3.0
// mm a pixel as a constant, so a patch at any other scale answers in the wrong
// centimetres everywhere.
const MM_PER_PX = Number(flag('mm', 3.0));
const SIDE = Number(flag('side', 1254));
const CZ = Number(flag('z', -4));
const CX = Number(flag('x', 0));
const OUT = join(REPO_ROOT, flag('out', 'v3-sentiero/dev1/piano.png'));

// What the pigment is developed through. A plan reading is RELATIVE -- every
// statistic in it is a level over the level around it -- so this only has to put
// the paving in the middle of the range an eight-bit picture can hold, and it is
// stated rather than fitted for exactly that reason.
const LIGHT = Number(flag('light', 1.0));

const linearToSrgb = (v) => {
  const c = Math.max(0, Math.min(1, v));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
};

/** Exact squared euclidean distance from every set pixel to the nearest clear one. */
function distance2(mask, w, h) {
  const BIG = 1e12;
  const f = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) f[i] = mask[i] ? BIG : 0;
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);
  const d = new Float64Array(Math.max(w, h));
  const line = new Float64Array(Math.max(w, h));
  const pass = (n, get, set) => {
    for (let i = 0; i < n; i++) d[i] = get(i);
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s;
      for (;;) {
        s = ((d[q] + q * q) - (d[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        if (s > z[k]) break;
        k--;
      }
      k++;
      v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      set(q, (q - v[k]) * (q - v[k]) + d[v[k]]);
    }
  };
  for (let x = 0; x < w; x++) {
    pass(h, (j) => f[j * w + x], (j, val) => { line[j] = val; });
    for (let j = 0; j < h; j++) f[j * w + x] = line[j];
  }
  for (let j = 0; j < h; j++) {
    pass(w, (i) => f[j * w + i], (i, val) => { line[i] = val; });
    for (let i = 0; i < w; i++) f[j * w + i] = line[i];
  }
  return f;
}

const metres = MM_PER_PX / 1000;
const half = SIDE * metres / 2;

process.stdout.write(`a plan patch ${SIDE}x${SIDE} at ${MM_PER_PX} mm/px `
  + `= ${(SIDE * metres).toFixed(3)} m square, centred on x ${CX} z ${CZ}\n`);
process.stdout.write(`  the apron's tuning applies at ${(apronAt(CZ) * 100).toFixed(0)}% here\n`);

const slot = new Uint8Array(SIDE * SIDE);
const tone = new Float64Array(SIDE * SIDE);
const grain = new Float64Array(SIDE * SIDE);
const stone = new Float64Array(SIDE * SIDE);
const apron = new Float64Array(SIDE * SIDE);

for (let j = 0; j < SIDE; j++) {
  // The patch's rows run north to south so that a picture of it is the ground
  // the way a walker facing north sees it, which is how the reference is laid.
  const z = CZ + half - (j + 0.5) * metres;
  for (let i = 0; i < SIDE; i++) {
    const x = CX - half + (i + 0.5) * metres;
    const k = j * SIDE + i;
    const p = paveAt(x, z);
    slot[k] = p.inSlot ? 1 : 0;
    tone[k] = p.tone;
    apron[k] = apronAt(z);
    const uv = grainUv(x, z);
    grain[k] = grainTone(uv.u - Math.floor(uv.u), uv.v - Math.floor(uv.v));
    const g = grainAt(uv.u - Math.floor(uv.u), uv.v - Math.floor(uv.v));
    stone[k] = Math.max(0, Math.min(1, 0.5 - g.d / (2 * GRAIN.reach)));
  }
}

// The depth into the slot, exactly as the painter writes it into the strip: the
// transform runs from the slots to the stone, so a point on stone is at nought.
const d2 = distance2(slot, SIDE, SIDE);

const out = new Uint8Array(SIDE * SIDE * 3);
for (let k = 0; k < SIDE * SIDE; k++) {
  const depth = Math.sqrt(d2[k]) * metres;
  const rgb = pathPigment({
    tone: tone[k], depth, apron: apron[k], grain: grain[k], stone: stone[k], near: 1,
  });
  for (let c = 0; c < 3; c++) out[k * 3 + c] = Math.round(255 * linearToSrgb(rgb[c] * LIGHT));
}

let inSlot = 0;
for (let k = 0; k < SIDE * SIDE; k++) if (slot[k]) inSlot++;
process.stdout.write(`  ${(inSlot / (SIDE * SIDE) * 100).toFixed(1)}% of the patch is inside a slot\n`);

mkdirSync(dirname(OUT), { recursive: true });
const bytes = await writeCleanPng(out, { width: SIDE, height: SIDE, channels: 3 }, OUT);
process.stdout.write(`${OUT} (${(bytes / 1024).toFixed(0)} kB)\n`);
