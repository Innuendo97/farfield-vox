import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// THE SHEETS OF THE SOIL, CUT OUT OF THE REFERENCE.
//
//   node tools/materia/foglio.mjs            write the sheets
//   node tools/materia/foglio.mjs --check    rebuild them and compare, byte for byte
//
// WHAT THIS TOOL IS FOR, AND WHY IT IS TRACKED WHILE A BENCH IS NOT. A grey
// square of two hundred and fifty six numbers is the one kind of asset nobody
// can read: shipped on its own it is a decision with no argument attached, and
// the first reviewer who asks "why is that texel dark" has nowhere to go. So the
// squares are not authored -- they are DERIVED, by this file, out of rectangles
// of the day target named in assets-src/materia/fogli.json, and the derivation
// runs again on demand and has to come back to the same bytes.
//
// THE ARITHMETIC, AND EVERY STEP OF IT IS ANSWERING SOMETHING.
//
//   1. LUMINANCE, not colour. The colour of a cube is the pigment's, and the
//      pigment is a field this campaign fitted through its own chain
//      (src/world/voxel/pigment.js). A sheet that carried colour would be a
//      second opinion about the meadow's hue, taken off a photograph, and it
//      would fight the first one everywhere.
//
//   2. THE LEAST SQUARES PLANE COMES OUT. Across one face of the reference the
//      light ramps -- the sky is brighter overhead, a face leans, the grade has
//      a corner shading -- and that ramp is LIGHT. Our own frame builds it from
//      the normal, analytically, in src/world/face-light.js. Left in the sheet
//      it would be applied twice, and it would be applied in the face's own
//      coordinate rather than the world's, so it would not even move with the
//      sun. What is left after the plane is the material.
//
//   3. RESAMPLED BY AREA. A box filter over the fractional overlap, which is
//      the same thing a mip level is, so a sheet and its own first mip are made
//      by one rule. Where a cut is smaller than sixteen the filter interpolates
//      and the entry in fogli.json says so: the reference is a photograph from
//      six to ten metres and it does not hold sixteen texels of a face at any
//      distance. What it holds -- three to four texels across a face, C 3.9 --
//      is what survives into the second mip level, which is the level the pose
//      that judges actually reads. That is the whole argument for sixteen.
//
//   4. CLOSED ON A MEAN OF A HALF, EXACTLY, IN INTEGERS. This is the one rule
//      that is not negotiable and it is C 3.8's: past two pixels a texel the
//      sampler climbs the mip chain and at the top it returns THE MEAN OF THE
//      TILE. So the mean of a tile is not a by-product, it is the colour of the
//      distant world, and it has to be the pigment and nothing else. Half is
//      the neutral of `1 + gain * (grey - 0.5)`. The rounding to bytes is done
//      so that the sum over the sheet is exactly 127.5 * 256 -- the byte grid
//      has no 0.5, so the mean is bought texel by texel and not by luck.
//
// AND ONE SHEET IS NOT A GRAIN AT ALL. The flower's is a MASK: nought is the
// pale pigment of a petal and one is the pistil, and its mean is therefore not
// a half but the share of a side face the pistil covers -- the number the far
// family reads to paint a head that has become one quad. It is rasterised from
// the two widths U-PIG-2 fitted rather than cut, because a head in the
// reference is one voxel across and there is nothing in it to cut.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SRC = join(ROOT, 'assets-src', 'materia');
const RECIPE = join(SRC, 'fogli.json');

/** Rec.709 on the coded triple, the same one the whole campaign measures with. */
const LUM = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The least squares plane over a rectangle, and what is left of it. */
function detrend(a, w, h) {
  let n = 0; let sx = 0; let sy = 0; let sxx = 0; let syy = 0; let sxy = 0;
  let sv = 0; let sxv = 0; let syv = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = a[y * w + x];
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      sv += v; sxv += x * v; syv += y * v;
    }
  }
  // Three normal equations, solved by elimination. The matrix is never singular
  // for a rectangle with more than one row and one column.
  const m = [[n, sx, sy, sv], [sx, sxx, sxy, sxv], [sy, sxy, syy, syv]];
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(m[k][i]) > Math.abs(m[p][i])) p = k;
    [m[i], m[p]] = [m[p], m[i]];
    for (let k = 0; k < 3; k++) {
      if (k === i) continue;
      const f = m[k][i] / m[i][i];
      for (let j = i; j < 4; j++) m[k][j] -= f * m[i][j];
    }
  }
  const c = [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = a[y * w + x] - (c[0] + c[1] * x + c[2] * y);
  }
  return { residual: out, plane: c };
}

/**
 * A Gaussian blur of a square field, separable, with the edges held.
 *
 * IT IS HERE TO BE SUBTRACTED, AND THAT IS THE ONE CORRECTION THIS TOOL MAKES
 * THAT IS NOT ARITHMETIC ON THE PHOTOGRAPH -- so it is the one that has to be
 * argued for.
 *
 * A cut of one face of the reference carries structure at every scale up to the
 * face itself, and the biggest single component of it is usually face-wide: a
 * bowl, a streak, a corner that is lighter. On the reference that component is
 * DIFFERENT ON EVERY FACE -- it is where that face happens to be, what is behind
 * it, which way it leans. We have one sheet. Laid on ten thousand cubes with
 * eight ways to turn it, a face-wide component is not grain: it is a STAMP, and
 * a meadow of it reads as wallpaper. Measured on the first sweep at the gain
 * that lands the reference's own per cent, that is exactly what the frame did.
 *
 * And there is nowhere for it to go missing to, because we already draw it. The
 * light and dark AT THE SCALE OF A FACE in this world is the pigment field --
 * two octaves of value noise in the world's own XZ, a function of the column, in
 * src/world/voxel/pigment.js -- and it varies from cube to cube exactly as the
 * reference's does. What the pigment cannot make, and what C measured missing,
 * is the structure INSIDE a face. So the sheet carries that and only that: the
 * cut minus its own blur at a third of a face, which is the scale below which
 * the pigment says nothing at all.
 */
function blur(a, side, sigma) {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v); sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const pass = (src) => {
    const out = new Float64Array(side * side);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        let v = 0;
        for (let i = -r; i <= r; i++) {
          const xx = Math.min(side - 1, Math.max(0, x + i));
          v += src[y * side + xx] * k[i + r];
        }
        out[y * side + x] = v;
      }
    }
    return out;
  };
  const rows = pass(a);
  const out = new Float64Array(side * side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) {
        const yy = Math.min(side - 1, Math.max(0, y + i));
        v += rows[yy * side + x] * k[i + r];
      }
      out[y * side + x] = v;
    }
  }
  return out;
}


/**
 * A field that TILES, with the reference's own spectrum and a phase of its own.
 *
 * THIS IS THE ONE PLACE THE TOOL STOPS COPYING AND STARTS SYNTHESISING, and the
 * reason is a measurement rather than a convenience.
 *
 * A cut of one face, laid on every face, is WALLPAPER. Measured: at the gain
 * that lands the reference's own per cent of grain, the near meadow read as a
 * motif stamped on ten thousand cubes, and four quarter turns and a flip do not
 * cure it -- eight copies of one blob is still one blob. The 3x3 low quartile
 * cannot see that, because it never looks at two faces at once; the eye sees
 * nothing else. Two readings of one frame, and the eye's is the one the
 * committente has.
 *
 * What the reference actually has, in C 1.1's own words, is "una chiazzatura
 * fine, senza direzione" -- a fine mottling with no direction, whose largest
 * patch is the face itself. A mottling has a SPECTRUM and it does not have a
 * phase: which texel of a face happens to be the dark one is where that face
 * stands in that photograph, and it is different on every one of them. So this
 * keeps what is measurable and throws away what is not:
 *
 *   - the AMPLITUDE at every spatial frequency is the cut's own, transformed
 *     out of the face the reference shows;
 *   - the PHASE is drawn once, from a fixed seed, and it is drawn because a
 *     phase repeated ten thousand times is precisely the thing the reference
 *     does not have.
 *
 * AND IT COMES BACK PERIODIC, WHICH IS WHAT MAKES THE OFFSET POSSIBLE. A field
 * synthesised out of its own Fourier coefficients closes on itself at every
 * edge, so the fragment may slide the sheet by a different amount on every cube
 * -- which is what actually kills the repeat -- without a seam appearing inside
 * a face. A cut cannot do that: it is not periodic, and an offset on it would
 * draw the join.
 *
 * The transform is written out longhand. Sixteen by sixteen is 65 536 products
 * and it runs once in a build tool; a library for it would be a dependency
 * bought with nothing.
 */
function spectral(field, side, seed) {
  const n = side;
  // Forward: the magnitude of every coefficient, which is the only thing kept.
  const mag = new Float64Array(n * n);
  for (let v = 0; v < n; v++) {
    for (let u = 0; u < n; u++) {
      let re = 0; let im = 0;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const a = -2 * Math.PI * ((u * x) / n + (v * y) / n);
          re += field[y * n + x] * Math.cos(a);
          im += field[y * n + x] * Math.sin(a);
        }
      }
      mag[v * n + u] = Math.hypot(re, im);
    }
  }
  // A draw with no library and no clock in it: the same seed gives the same
  // sheet on every machine and in every year, which is what lets --check be a
  // statement about the recipe rather than about the run.
  let state = seed >>> 0;
  const draw = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  // Phases, Hermitian so the field comes back real: the coefficient at (-u,-v)
  // is the conjugate of the one at (u,v).
  const phase = new Float64Array(n * n);
  for (let v = 0; v < n; v++) {
    for (let u = 0; u < n; u++) {
      const cu = (n - u) % n; const cv = (n - v) % n;
      if (cv * n + cu < v * n + u) phase[v * n + u] = -phase[cv * n + cu];
      else if (cv * n + cu === v * n + u) phase[v * n + u] = 0;
      else phase[v * n + u] = (draw() * 2 - 1) * Math.PI;
    }
  }
  // Inverse, with the mean dropped: the level is set afterwards and exactly.
  const out = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let re = 0;
      for (let v = 0; v < n; v++) {
        for (let u = 0; u < n; u++) {
          if (u === 0 && v === 0) continue;
          const a = 2 * Math.PI * ((u * x) / n + (v * y) / n) + phase[v * n + u];
          re += mag[v * n + u] * Math.cos(a);
        }
      }
      out[y * n + x] = re / (n * n);
    }
  }
  return out;
}

/** Area resample of a w x h field onto side x side: the mip rule, once. */
function resample(a, w, h, side) {
  const out = new Float64Array(side * side);
  for (let j = 0; j < side; j++) {
    const v0 = (j * h) / side; const v1 = ((j + 1) * h) / side;
    for (let i = 0; i < side; i++) {
      const u0 = (i * w) / side; const u1 = ((i + 1) * w) / side;
      let sum = 0; let area = 0;
      for (let y = Math.floor(v0); y < Math.min(h, Math.ceil(v1)); y++) {
        const fy = Math.min(v1, y + 1) - Math.max(v0, y);
        for (let x = Math.floor(u0); x < Math.min(w, Math.ceil(u1)); x++) {
          const fx = Math.min(u1, x + 1) - Math.max(u0, x);
          sum += a[y * w + x] * fx * fy; area += fx * fy;
        }
      }
      out[j * side + i] = area > 0 ? sum / area : 0;
    }
  }
  return out;
}

/**
 * Bytes whose mean is exactly the wanted one, and whose shape is the field's.
 *
 * A byte grid has no half, so a mean of 127.5 cannot be had by rounding: it is
 * bought by choosing WHICH texels round up. The ones picked are those whose own
 * rounding residue is largest, so the error is spread where it was already
 * going to be and the shape survives to the level the last mip is read at.
 */
function quantise(field, wantMean) {
  const n = field.length;
  const bytes = new Uint8Array(n);
  const want = Math.round(wantMean * 255 * n);
  const floors = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.min(255, Math.max(0, field[i] * 255));
    floors[i] = v;
    bytes[i] = Math.floor(v);
    sum += bytes[i];
  }
  // Hand out the remaining levels to the largest fractions, then trim if the
  // clamp at either end has left the sum unreachable from below.
  const order = [...bytes.keys()].sort(
    (a, b) => (floors[b] - bytes[b]) - (floors[a] - bytes[a]),
  );
  let k = 0;
  while (sum < want && k < n * 2) {
    const i = order[k % n];
    if (bytes[i] < 255) { bytes[i] += 1; sum += 1; }
    k++;
  }
  const back = [...order].reverse();
  k = 0;
  while (sum > want && k < n * 2) {
    const i = back[k % n];
    if (bytes[i] > 0) { bytes[i] -= 1; sum -= 1; }
    k++;
  }
  return { bytes, sum, want };
}

/** The mip chain a box filter makes, in bytes, down to the one texel that matters. */
export function mipChain(bytes, side) {
  const levels = [bytes];
  let cur = bytes; let s = side;
  while (s > 1) {
    const half = s >> 1;
    const next = new Uint8Array(half * half);
    for (let j = 0; j < half; j++) {
      for (let i = 0; i < half; i++) {
        const a = cur[(j * 2) * s + i * 2]; const b = cur[(j * 2) * s + i * 2 + 1];
        const c = cur[(j * 2 + 1) * s + i * 2]; const d = cur[(j * 2 + 1) * s + i * 2 + 1];
        next[j * half + i] = Math.round((a + b + c + d) / 4);
      }
    }
    levels.push(next); cur = next; s = half;
  }
  return levels;
}

/** One sheet cut out of the reference. */
function fromCut(target, entry, side, sd, sigma) {
  const [x0, y0, x1, y1] = entry.cut;
  const w = x1 - x0 + 1; const h = y1 - y0 + 1;
  const a = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = ((y0 + y) * target.width + (x0 + x)) * target.channels;
      a[y * w + x] = LUM(target.data[p], target.data[p + 1], target.data[p + 2]);
    }
  }
  let mean = 0;
  for (const v of a) mean += v;
  mean /= a.length;
  const { residual, plane } = detrend(a, w, h);
  let sdBefore = 0;
  for (const v of residual) sdBefore += v * v;
  sdBefore = Math.sqrt(sdBefore / residual.length);
  const small = resample(residual, w, h, side);
  // AND THE FACE-WIDE COMPONENT COMES OUT, for the reason written over blur().
  const low = blur(small, side, sigma);
  const fine0 = new Float64Array(side * side);
  for (let i = 0; i < fine0.length; i++) fine0[i] = small[i] - low[i];
  // AND THE PHASE GOES, so the sheet tiles and so a meadow of it is not one
  // motif ten thousand times. See the note over spectral().
  const fine = spectral(fine0, side, entry.seed);
  let m2 = 0; let s2 = 0;
  for (const v of fine) m2 += v;
  m2 /= fine.length;
  for (const v of fine) s2 += (v - m2) * (v - m2);
  s2 = Math.sqrt(s2 / fine.length);
  const field = new Float64Array(side * side);
  for (let i = 0; i < field.length; i++) field[i] = 0.5 + (sd / (s2 || 1)) * (fine[i] - m2);
  return {
    field,
    reading: {
      cut: entry.cut,
      px: [w, h],
      L: +mean.toFixed(2),
      // What the dossier calls the internal deviation of that face: the residual
      // after the light's own ramp, over the face's mean, in per cent.
      deviazioneInterna: +(100 * sdBefore / mean).toFixed(2),
      escursione: +(Math.max(...residual) - Math.min(...residual)).toFixed(1),
      pianoPerPx: [+plane[1].toFixed(3), +plane[2].toFixed(3)],
      // How much of that survives the resample to sixteen: below one, the cut
      // was smaller than the sheet and the difference is interpolation.
      quotaDopoIlRicampionamento: +(s2 / (sdBefore || 1)).toFixed(3),
      // How much of the cut's own deviation was face-wide and went to the
      // pigment, which is the one number that says whether a family's grain is
      // a texture at all or just where the cube happens to stand.
      quotaLarghaQuantoLaFaccia: +(1 - Math.sqrt(
        fine0.reduce((t, v) => t + v * v, 0) / fine0.length,
      ) / (Math.sqrt(
        small.reduce((t, v) => t + v * v, 0) / small.length
        - (small.reduce((t, v) => t + v, 0) / small.length) ** 2,
      ) || 1)).toFixed(3),
    },
  };
}

/** The flower's band, rasterised out of the two widths U-PIG-2 fitted. */
function fromBand(entry, side) {
  const { spine, top } = entry.band;
  const field = new Float64Array(side * side);
  // Softened over exactly one texel, which is what the fragment's fwidth() was
  // doing over exactly one pixel: the sheet is read with a linear filter, so
  // the softening a mip level gives it at range is the right one for free.
  const soft = (t) => Math.min(1, Math.max(0, t));
  const reach = spine * 0.5;
  for (let j = 0; j < side; j++) {
    // The face's own v runs up: row 0 of a sheet is the TOP of the picture, and
    // vFace.y is nought at the foot of the face.
    const v = (side - 0.5 - j) / side;
    for (let i = 0; i < side; i++) {
      const u = (i + 0.5) / side;
      const sp = soft((reach + 0.5 / side - Math.abs(u - 0.5)) * side);
      const lid = soft((v - (1.0 - top) + 0.5 / side) * side);
      field[j * side + i] = Math.max(sp, lid);
    }
  }
  let share = 0;
  for (const v of field) share += v;
  share /= field.length;
  return { field, reading: { spine, top, share: +share.toFixed(4) } };
}

/**
 * The four chunks a delivered picture is allowed to have, and nothing else.
 *
 * The encoder writes a pHYs -- how many pixels to a metre it thinks the picture
 * is -- and tools/grade/check-png.mjs refuses it, for the reason the whole
 * project refuses ancillary chunks: they are where a date, a machine name and a
 * colour profile ride in, and a delivery has to be a function of its source.
 */
function strip(png) {
  const keep = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);
  const parts = [png.subarray(0, 8)];
  let pos = 8;
  while (pos < png.length) {
    const length = png.readUInt32BE(pos);
    const type = png.toString('latin1', pos + 4, pos + 8);
    if (keep.has(type)) parts.push(png.subarray(pos, pos + 12 + length));
    pos += 12 + length;
    if (type === 'IEND') break;
  }
  return Buffer.concat(parts);
}

async function main() {
  const recipe = JSON.parse(readFileSync(RECIPE, 'utf8'));
  const side = recipe.side;
  const check = process.argv.includes('--check');
  const { data, info } = await sharp(recipe.target).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const target = { data, width: info.width, height: info.height, channels: info.channels };

  const soil = [];
  const report = { side, sd: recipe.sd, sheets: [] };
  let flower = null;
  for (const entry of recipe.sheets) {
    const built = entry.kind === 'banda'
      ? fromBand(entry, side)
      : fromCut(target, entry, side, recipe.sd, recipe.sigma);
    const wantMean = entry.kind === 'banda' ? built.reading.share : 0.5;
    const { bytes, sum, want } = quantise(built.field, wantMean);
    const levels = mipChain(bytes, side);
    const one = levels[levels.length - 1][0];
    report.sheets.push({
      id: entry.id,
      ...built.reading,
      mediaByte: +(sum / bytes.length).toFixed(3),
      mediaVoluta: +(want / bytes.length).toFixed(3),
      mip1x1: one,
      mip1x1Frazione: +(one / 255).toFixed(4),
    });
    if (entry.kind === 'banda') flower = bytes;
    else soil.push({ id: entry.id, bytes });
  }

  // THE ARRAY TRAVELS AS A STRIP AND IS SLICED WHERE IT LANDS. One layer under
  // the next, sixteen wide, so a layer is a contiguous run of 256 bytes and the
  // slice on the page is an offset and not a shuffle. The delivery chain has no
  // array texture in it -- ktx create takes --layers, but three's KTX2 loader
  // rebuilds a layered file only through the transcoder, and a block codec on a
  // sixteen texel square is a lossy answer to a question that has an exact one.
  // So: one uncompressed R8 picture, sliced into a DataArrayTexture by
  // src/world/voxel/sheet.js, with the mip chain built there by the same box
  // rule this file uses -- which is what makes the guard on the last level a
  // statement about what the GPU reads and not about a file.
  const sheet = Buffer.alloc(side * side * soil.length);
  soil.forEach((s, k) => Buffer.from(s.bytes).copy(sheet, k * side * side));
  report.strip = { side, layers: soil.map((s) => s.id) };

  const files = [
    ['soil-sheets.png', sheet, side, side * soil.length],
    ['flower-band.png', Buffer.from(flower), side, side],
  ];
  for (const [name, buf, w, h] of files) {
    const png = strip(await sharp(buf, { raw: { width: w, height: h, channels: 1 } })
      .png({ compressionLevel: 9, palette: false }).toBuffer());
    const path = join(SRC, name);
    if (check) {
      if (!existsSync(path)) throw new Error(`manca ${name}`);
      const on = readFileSync(path);
      if (!on.equals(png)) throw new Error(`${name} non e' quel che la ricetta produce`);
      process.stdout.write(`= ${name}\n`);
    } else {
      writeFileSync(path, png);
      process.stdout.write(`> ${name} ${png.length} B (${w}x${h})\n`);
    }
  }
  const misure = `${JSON.stringify(report, null, 1)}\n`;
  const mpath = join(SRC, 'fogli-misure.json');
  if (check) {
    if (readFileSync(mpath, 'utf8') !== misure) throw new Error('fogli-misure.json non combacia');
    process.stdout.write('= fogli-misure.json\n');
  } else {
    writeFileSync(mpath, misure);
  }
  for (const s of report.sheets) {
    process.stdout.write(`  ${s.id.padEnd(12)} media ${String(s.mediaByte).padStart(7)}`
      + `  mip 1x1 ${String(s.mip1x1).padStart(3)}`
      + (s.deviazioneInterna !== undefined
        ? `  faccia ${s.px[0]}x${s.px[1]} L ${s.L} deviazione interna ${s.deviazioneInterna}%`
          + ` quota dopo il ricampionamento ${s.quotaDopoIlRicampionamento}`
        : `  quota della banda ${s.share}`)
      + '\n');
  }
}

await main();
