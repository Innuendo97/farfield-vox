import sharp from 'sharp';
import { join } from 'node:path';
import { REPO_ROOT } from '../grade/lib/framing.mjs';
import { pathCoord, pathRun } from '../../src/world/terrain-field.js';
import { PATH_STRIP, STRIP_REACH, pathStripUv, stripToWorld } from '../../src/world/path-strip.js';
import {
  atlasSpan, bandLimit, paveErosion, paveFrom, PLATE, slabSpace,
} from './lib/pattern.mjs';

// DOES THE STRIP MEASURE THE PAVING THE ATLAS DRAWS?
//
//   node tools/terrain/check-strip-register.mjs
//   node tools/terrain/check-strip-register.mjs --inject=turn
//   node tools/terrain/check-strip-register.mjs --inject=shift
//   node tools/terrain/check-strip-register.mjs --inject=plate
//
// THIS IS A BLOCKING GATE AND IT EXISTS BECAUSE THE FAILURE IT CATCHES IS
// SILENT. Two painters read the same lattice out of one seat, and if they ever
// stop doing so nothing downstream complains: the strip still paints, the file
// still weighs what it weighed, every guard in the repo still passes, and the
// frame draws crisp joints in places the paving has none while the paving's own
// joints stay blurred. There is no reading of a render that separates that from
// "the joints are a bit noisy".
//
// So the two are compared directly, here, against each other rather than against
// a reference — the atlas's own answer for "is there a joint at this point of the
// world", and the strip's own answer for "how far is the nearest joint edge" —
// and the delivery is refused if they come apart.
//
// AND IT IS VALIDATED IN BOTH DIRECTIONS. A gate that only ever passes is not a
// gate. `--inject` breaks the lattice on the reading side in each of the three
// ways it could really break — the twenty-seven degree turn, the two origin
// constants, the slab size — and the gate has to REFUSE all three. Run without
// it, the same gate has to accept.

const SOURCE = process.argv.find((a) => !a.startsWith('--') && a.endsWith('.png'))
  || join(REPO_ROOT, 'assets-src', 'terrain', 'terrain-path.png');
const ATLAS = 2048;
// What the frame calls a joint. Not a taste: it is the softness the shader draws
// its edge over, so it is the width of the band this gate has to agree about.
const SOFT = 0.004;
const POINTS = 600000;
// How much of the two masks must be the same mask.
//
// A NUMBER WITH BOTH ENDS MEASURED, AND THE SECOND END IS WHY IT IS NOT 0.55.
//
// In register the two agree on 94.8% of their union. Injected on the reading
// side: one degree of turn answers 20.9%, the two origin constants left out
// 12.4%, a slab two per cent wider 16.3%. A strip that said "stone everywhere"
// would answer nought and one that said "joint everywhere" about 17%.
//
// But the honest test is a strip really PAINTED out of register, and it is the
// one that set this number. A strip painted with the lattice turned by a fifth
// of one degree — which over the strip's own length walks the paving a fifth of
// a slab sideways, and which no eye would ever call a different paving — still
// agrees on 56.1%. At a floor of 0.55 that ships. So the floor is where the
// measurement puts it and not where the first guess did: 0.80 refuses the fifth
// of a degree and still leaves the delivered strip fifteen points of margin.
const FLOOR = 0.80;

const injected = process.argv.find((a) => a.startsWith('--inject='))?.slice(9) || 'none';

const raw = await sharp(SOURCE).raw().toBuffer({ resolveWithObject: true });
const W = raw.info.width;
const H = raw.info.height;
const px = raw.data;
const ch = raw.info.channels;

function sample(x, z) {
  const { u, v } = pathStripUv(x, z);
  const fx = u * W - 0.5;
  const fy = v * H - 0.5;
  const i0 = Math.max(0, Math.min(W - 1, Math.floor(fx)));
  const j0 = Math.max(0, Math.min(H - 1, Math.floor(fy)));
  const i1 = Math.min(W - 1, i0 + 1);
  const j1 = Math.min(H - 1, j0 + 1);
  const tx = Math.max(0, Math.min(1, fx - i0));
  const ty = Math.max(0, Math.min(1, fy - j0));
  const at = (i, j) => px[(j * W + i) * ch];
  const a = at(i0, j0) * (1 - tx) + at(i1, j0) * tx;
  const b = at(i0, j1) * (1 - tx) + at(i1, j1) * tx;
  return (a * (1 - ty) + b * ty) / 255 * STRIP_REACH;
}

/** The atlas's own answer, optionally broken on purpose. */
function atlasJoint(x, z) {
  if (pathRun(z) <= 0.001) return null;
  const d = Math.abs(pathCoord(x, z));
  if (d > 1.15) return null;
  const detail = bandLimit(atlasSpan(x, z, ATLAS));
  let sx = x;
  let sz = z;
  if (injected === 'turn') {
    // One degree of turn. Small enough that no eye would call the paving
    // different, large enough that a joint moves by its own width within a metre.
    const c = Math.cos(Math.PI / 180);
    const s = Math.sin(Math.PI / 180);
    sx = x * c + z * s;
    sz = z * c - x * s;
  }
  const plate = injected === 'plate' ? PLATE * 1.02 : PLATE;
  const seat = slabSpace(sx, sz, plate, detail);
  if (injected === 'shift') {
    // What a second painter that did not know about PLATE_SHIFT would ask.
    seat.fx -= 3.13;
    seat.fz -= 8.71;
  }
  return paveFrom(seat, paveErosion(x, z, d, detail), plate).inJoint;
}

const rand = (() => {
  let s = 4242;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
})();

let both = 0;
let onlyAtlas = 0;
let onlyStrip = 0;
let seen = 0;
for (let n = 0; n < POINTS; n++) {
  const { x, z } = stripToWorld(rand(), rand());
  const wanted = atlasJoint(x, z);
  if (wanted === null) continue;
  seen++;
  const got = sample(x, z) < SOFT;
  if (wanted && got) both++;
  else if (wanted) onlyAtlas++;
  else if (got) onlyStrip++;
}

const union = both + onlyAtlas + onlyStrip;
const agree = union > 0 ? both / union : 0;

process.stdout.write(`${SOURCE}\n`);
process.stdout.write(`  ${W}x${H}, ${seen} points of the paving`
  + `${injected === 'none' ? '' : `, lattice broken on purpose: ${injected}`}\n`);
process.stdout.write(`  the atlas has a joint at ${((both + onlyAtlas) / seen * 100).toFixed(2)}%`
  + ` of them, the strip at ${((both + onlyStrip) / seen * 100).toFixed(2)}%\n`);
process.stdout.write(`  agreed ${both}, atlas only ${onlyAtlas}, strip only ${onlyStrip}\n`);
process.stdout.write(`  THE TWO LATTICES AGREE ON ${(agree * 100).toFixed(1)}%`
  + ` of their union, of ${(FLOOR * 100).toFixed(0)}% required\n`);

if (injected === 'none') {
  if (agree < FLOOR) {
    process.stdout.write('\nOUT OF REGISTER: the strip is not measuring the paving the atlas draws.\n');
    process.exitCode = 1;
  } else {
    process.stdout.write('\nin register: the strip measures the paving the atlas draws.\n');
  }
} else if (agree >= FLOOR) {
  process.stdout.write(`\nTHE GATE ACCEPTS A LATTICE BROKEN BY "${injected}" and cannot be believed.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`\nrefused, as it must be: "${injected}" is caught.\n`);
}
