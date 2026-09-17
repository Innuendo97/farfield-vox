// HOW LEGIBLE THE WRITING ON THE SIX IS, READ OFF A PICTURE.
//
// WHY IT EXISTS. The committente sent the delivered hub back with one sentence:
// «il testo e i simboli dei monoliti soffrono le linee scure dove i cubi si
// separano, e questo rende complicata la lettura». That is a claim about
// PIXELS, and every claim about pixels in this campaign has to be readable by
// something other than an opinion — otherwise the cure is judged by the same
// eye that asked for it, at a different hour.
//
// WHAT IT MEASURES, AND WHY THESE THREE. The complaint has two halves — the
// strokes are BROKEN, and what is left is HARDER TO READ — so there is one
// number for each and one that crosses them.
//
//   CONTRASTO   Michelson at the edge of a stroke: the stroke against the stone
//               one pixel outside it. It is the quantity legibility actually
//               depends on and it is scale free, so the same number can be read
//               on a face 31 m away and on one at 3.5 m without either of them
//               being converted into the other.
//   PEZZI       connected pieces of ink per thousand pixels of ink. A stroke a
//               joint has cut in two is two pieces where the composition drew
//               one, so this rises with exactly the defect and with nothing
//               else. Normalised by the ink, because a face with more writing
//               on it has more letters on it.
//   MORSI       the share of a stroke that is MISSING: the ink mask closed over
//               a disc a little wider than a joint, less the ink itself. A
//               closing joins a stroke back across a gap of two or three pixels
//               and does not close the counter of an «o», so what it recovers is
//               the bite and not the letter.
//
// THE MASK IS THE HONEST ONE AND NOT THE CAMPAIGN'S OLD CYAN DETECTOR.
// `b > 1.5r + 8` is what R5 read the ink through, and E-PIETRA2 measured that
// it does not pass our own core at all -- it was reading the cyan FRINGE of a
// white stroke and calling it the stroke. Swept from a gain of 0.78 to 4.4 it
// moved four levels while the share of face it covered went from 2.8% to 14.6%.
// So the mask here is the one E-PIETRA2 measured on: bluer than red by a clear
// margin, and bright. It passes the target's strokes and ours, which is the
// only thing a mask used on both has to do.
//
// AND A FOURTH READING WAS BUILT AND THROWN AWAY, which is worth writing down
// so that nobody builds it again. The obvious way to measure «un giunto taglia
// un glifo» is to look INSIDE a stroke for the dark bar the joint leaves. It
// cannot be done on these pictures, and for two reasons that are both the
// cure's own doing. Where a joint really bites, the pixels it darkens fall out
// of the ink mask altogether -- they are a HOLE and not dark ink -- so the
// inside of what is left is clean and the reading comes back low on exactly the
// picture the committente sent back (3.9% on the delivered sixth block against
// 6.5% on the cured one). And the dark pixels that ARE inside the cured stroke
// are its FLANKS, which are dark by design: they are the «ombra propria» a body
// has and a decal has not. A measurement that calls the cure the disease is not
// a measurement. What a bitten stroke actually shows is holes, and holes are
// what PEZZI and MORSI count.
//
// AND THE TARGET IS NEVER CARRIED INTO THIS REPOSITORY. It is named by path,
// the same rule tools/monoliths/relief.mjs states: what is versioned is the
// reading, which is ours.
import { createRequire } from 'node:module';
import { facesOf, faceRect } from './faces.mjs';
import { MONOLITHS } from '../../src/world/layout.js';

const require = createRequire(import.meta.url);

// What counts as a stroke. Bluer than red by twenty levels and over a hundred
// and twenty of blue: E-PIETRA2's mask, which does not presume its answer.
const isInk = ([r, , b]) => b > r + 20 && b > 120;

/** Rec.709 luminance, on the levels as stored. */
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// How far a closing reaches, in pixels. A joint on these faces is two to three
// pixels of dark including the shadow it throws (E-PIETRA3), so three is what
// it takes to bridge one; the counter of a capital at the size the titles are
// set at is eight to ten, so it is not bridged.
const CLOSE = 3;

/** The plate, as levels. */
export async function readPlate(path) {
  const sharp = require('sharp');
  const { data, info } = await sharp(path).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  return {
    width,
    height,
    at(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      const o = (y * width + x) * channels;
      return [data[o], data[o + 1], data[o + 2]];
    },
  };
}

/** A rectangle of a plate, as an ink mask and a luminance field. */
function fieldOf(plate, rect) {
  const x0 = Math.max(0, Math.floor(rect.x0));
  const y0 = Math.max(0, Math.floor(rect.y0));
  const x1 = Math.min(plate.width, Math.ceil(rect.x1));
  const y1 = Math.min(plate.height, Math.ceil(rect.y1));
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const ink = new Uint8Array(w * h);
  const light = new Float32Array(w * h);
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = plate.at(x0 + x, y0 + y);
      const i = y * w + x;
      if (!px) continue;
      light[i] = luma(px);
      rgb[i * 3] = px[0];
      rgb[i * 3 + 1] = px[1];
      rgb[i * 3 + 2] = px[2];
      ink[i] = isInk(px) ? 1 : 0;
    }
  }
  return { w, h, ink, light, rgb, x0, y0 };
}

/** A disc of the given radius, as offsets. */
function disc(radius) {
  const out = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) out.push([dx, dy]);
    }
  }
  return out;
}

function dilate(mask, w, h, offsets) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[ny * w + nx] = 1;
      }
    }
  }
  return out;
}

function erode(mask, w, h, offsets) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let whole = 1;
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny * w + nx]) { whole = 0; break; }
      }
      out[y * w + x] = whole;
    }
  }
  return out;
}

/** How many pieces a mask falls into, four-connected. */
function pieces(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let count = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    count += 1;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const at = stack[--top];
      const x = at % w;
      const y = (at - x) / w;
      const near = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of near) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const i = ny * w + nx;
        if (mask[i] && !seen[i]) { seen[i] = 1; stack[top++] = i; }
      }
    }
  }
  return count;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * The three numbers, over one rectangle of one plate.
 *
 * @param {object} plate what readPlate() handed back
 * @param {object} rect  { x0, y0, x1, y1 } in pixels of the plate
 */
export function readRect(plate, rect) {
  const f = fieldOf(plate, rect);
  const { w, h, ink, light } = f;
  let area = 0;
  for (let i = 0; i < ink.length; i++) area += ink[i];
  if (area < 40) return { ink: area, contrast: null, pieces: null, bites: null };

  // CONTRASTO. Every ink pixel with a neighbour that is not ink, against the
  // stone one step further out than that -- two pixels, not one, because the
  // pixel immediately outside a stroke is the antialiased edge of the stroke
  // and putting it in the denominator would be measuring the stroke against
  // itself.
  const edges = [];
  const levels = [];
  const blueOverRed = [];
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (!ink[i]) continue;
      levels.push(light[i]);
      blueOverRed.push((f.rgb[i * 3 + 2] + 1) / (f.rgb[i * 3] + 1));
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (ink[(y + dy) * w + (x + dx)]) continue;
        const outer = light[(y + 2 * dy) * w + (x + 2 * dx)];
        const inner = light[i];
        if (inner + outer > 1) edges.push((inner - outer) / (inner + outer));
        break;
      }
    }
  }

  // THE HALO, AS A PROFILE OUTWARD FROM A STROKE. E-PIETRA2 read the
  // reference's glow as blue over red 64 at one or two pixels out and still 35
  // at eight to fourteen, and what it did NOT publish is how much LIGHT is out
  // there -- which is the quantity that sets the contrast above, because it is
  // the denominator. Walked along the outward normal of the mask, in rings, and
  // quoted as a share of the stroke's own level so that two pictures at two
  // exposures can be compared.
  const rings = [1, 2, 4, 8, 14].map(() => []);
  const ringBr = [1, 2, 4, 8, 14].map(() => []);
  const reach = [1, 2, 4, 8, 14];
  for (let y = 16; y < h - 16; y++) {
    for (let x = 16; x < w - 16; x++) {
      const i = y * w + x;
      if (!ink[i]) continue;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (ink[(y + dy) * w + (x + dx)]) continue;
        for (let k = 0; k < reach.length; k++) {
          const j = (y + reach[k] * dy) * w + (x + reach[k] * dx);
          if (ink[j]) continue;
          rings[k].push(light[j]);
          ringBr[k].push((f.rgb[j * 3 + 2] + 1) / (f.rgb[j * 3] + 1));
        }
        break;
      }
    }
  }

  // PEZZI, on the ink as it stands.
  const parts = pieces(ink, w, h);

  // MORSI. The closing, less the ink: what a stroke is missing.
  const ball = disc(CLOSE);
  const closed = erode(dilate(ink, w, h, ball), w, h, ball);
  let body = 0;
  let missing = 0;
  for (let i = 0; i < closed.length; i++) {
    if (!closed[i]) continue;
    body += 1;
    if (!ink[i]) missing += 1;
  }

  const strokeLevel = median(levels);
  return {
    ink: area,
    contrast: median(edges),
    edges: edges.length,
    halo: rings.map((ring) => (ring.length && strokeLevel
      ? median(ring) / strokeLevel : null)),
    haloBlueOverRed: ringBr.map((ring) => (ring.length ? median(ring) : null)),
    haloAt: reach,
    pieces: parts,
    piecesPerThousand: (parts * 1000) / area,
    bites: body ? missing / body : 0,
    luma: median(levels),
    blueOverRed: median(blueOverRed),
  };
}

/**
 * The writing of the five blocks the reference framing shows, face by face.
 *
 * The engraved face and nothing else: the writing is on the front, and a
 * rectangle that took a flank in with it would be measuring stone.
 *
 * @param {string} path a plate at the fitted pose, 1672 x 941
 */
export async function measure(path) {
  const plate = await readPlate(path);
  const out = {};
  for (const monolith of MONOLITHS) {
    if (monolith.id === '06') continue;
    const face = facesOf(monolith).front;
    // The writing runs down the top nine tenths of a face and across all of it;
    // the foot of a block carries the rhombus, which is cyan and is not writing.
    const rect = faceRect(face, 0.02, 0.18, 0.98, 0.99);
    out[`${monolith.id}-front`] = readRect(plate, rect);
  }
  return out;
}

// --------------------------------------------------------------------- cli

async function main() {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) {
    process.stdout.write('uso: node tools/monoliths/inchiostro.mjs <plate.png> [--rect=x0,y0,x1,y1]\n');
    process.exit(1);
  }
  const rectFlag = args.find((a) => a.startsWith('--rect='));
  if (rectFlag) {
    const [x0, y0, x1, y1] = rectFlag.slice(7).split(',').map(Number);
    const plate = await readPlate(path);
    process.stdout.write(`${JSON.stringify(readRect(plate, { x0, y0, x1, y1 }), null, 1)}\n`);
    return;
  }
  const read = await measure(path);
  for (const [name, r] of Object.entries(read)) {
    if (r.contrast === null) { process.stdout.write(`${name}  (no ink)\n`); continue; }
    process.stdout.write(
      `${name}  ink ${String(r.ink).padStart(6)}  contrasto ${r.contrast.toFixed(3)}`
      + `  pezzi/1000 ${r.piecesPerThousand.toFixed(2)}  morsi ${(r.bites * 100).toFixed(1)}%`
      + `  luma ${r.luma.toFixed(0)}  B/R ${r.blueOverRed.toFixed(2)}\n`
      + `             alone ${r.halo.map((v) => (v === null ? '  -  ' : v.toFixed(3))).join(' ')}`
      + `   (a ${r.haloAt.join('/')} px)`
      + `   B/R ${r.haloBlueOverRed.map((v) => (v === null ? ' - ' : v.toFixed(1))).join(' ')}\n`,
    );
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
}
