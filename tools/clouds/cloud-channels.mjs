// One place where a baked channel's file format is decided.
//
// WHY THIS FILE EXISTS. The convention used to live in two copies — a writer in
// the bake and a reader in whatever consumed it — and it drifted, silently,
// which is the only way a format ever drifts. The writer asked for a sixteen bit
// grayscale PNG like this:
//
//     sharp(buf, { raw: { width, height, channels: 1, depth: 'ushort' } }).png()
//
// and there is no `depth` on sharp's RAW INPUT: the buffer is taken as eight bit
// bytes whatever that option says. So the file that came out was an eight bit,
// three channel PNG holding the high and low bytes of every second sample side
// by side, and the comment above it explained at length why sixteen bits were
// necessary. Nothing complained, because the only reader in the repository read
// it back with the same wrong assumption and got a self-consistent scramble.
//
// It was found by an end-to-end check that read the shipped atlas back and
// compared it against the volumes it was made from: 18.9 display levels of error
// where every measurement of the same scheme said 2.8. When a number and every
// other number disagree, one of the instruments is lying — and this time it was
// the format underneath both.
//
// WHAT IS HERE. Sixteen bits, carried as two eight bit channels: the high byte
// in red, the low byte in green. Exact, lossless, and it survives any PNG writer
// there is, because eight bit RGB is the one thing they all agree on. The
// alternative — raw binary beside the PNGs — is smaller and would have been
// fine, but a channel that can be opened and looked at is worth the third
// channel it wastes, and the bake is not where the bytes matter.
//
// THE SHADED SIDE IS WHY. A mass turned away from the sun sits at an
// illumination near 0.03, where an eight bit step is an eighth of the value and
// stairsteps visibly in exactly the region the whole day-and-night question is
// about. That was always the reason for sixteen bits; now it is also what the
// code does.

import sharp from 'sharp';

/** Write a 0..1 channel at sixteen bits: high byte in red, low byte in green. */
export async function writeChannel(src, w, h, path) {
  const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(Math.min(1, Math.max(0, src[i])) * 65535);
    data[i * 3] = v >> 8;
    data[i * 3 + 1] = v & 255;
  }
  await sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 3 } })
    .png({ compressionLevel: 9 }).toFile(path);
  return path;
}

/** Read one back. Throws rather than guessing if the file is not one of these. */
export async function readChannel(path) {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  if (info.channels < 3 || data.length < n * 3) {
    throw new Error(`${path}: ${info.channels} channel(s) at ${info.depth}, not a 16 bit channel `
      + 'written by writeChannel — refusing to guess');
  }
  const out = new Float32Array(n);
  const s = info.channels;
  for (let i = 0; i < n; i++) out[i] = (data[i * s] * 256 + data[i * s + 1]) / 65535;
  return { data: out, width: info.width, height: info.height };
}

/** The three axis normal, biased to the middle, as eight bits an axis. */
export async function writeNormal(src, w, h, path) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round((src[i * 3 + c] * 0.5 + 0.5) * 255);
    data[i * 4 + 3] = 255;
  }
  await sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9 }).toFile(path);
  return path;
}

/**
 * Only the y axis is ever read.
 *
 * The delivered shading uses the normal in one place — the ambient term, which
 * is base + range * ao * (0.5 + 0.5 * n.y) — and touches neither x nor z. This
 * is a reader, not a licence: the other two are still written, because a normal
 * with two axes missing is not a normal and the next thing that wants one would
 * have to re-bake.
 */
export async function readNormalY(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (data[i * 4 + 1] / 255) * 2 - 1;
  return { data: out, width: info.width, height: info.height };
}
