import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

// Writes PNGs the project is allowed to ship.
//
// Two things have to be true of every image produced here. It must be true
// colour: the encoder happily palettises a smooth sky into 256 entries, which
// destroys exactly the gradient the sky exists for. And it must carry no
// auxiliary chunk at all, so nothing about the machine, the software or the
// moment of creation travels with the file. The encoder still emits a physical
// dimensions chunk, so the stream is rebuilt here keeping only what a PNG
// needs to decode.

const KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

/** Drops every chunk that is not required to decode the image. */
export function stripAncillaryChunks(bytes) {
  const out = [bytes.subarray(0, 8)];
  let pos = 8;
  while (pos < bytes.length) {
    const length = bytes.readUInt32BE(pos);
    const type = bytes.toString('latin1', pos + 4, pos + 8);
    const end = pos + 12 + length;
    if (KEEP.has(type)) out.push(bytes.subarray(pos, end));
    pos = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}

/**
 * The bytes a clean PNG of this raster would have, without putting them on disk.
 *
 * Split out of writeCleanPng so a caller that has to decide WHETHER to write can
 * look at what it would be writing first. A bake whose output is under a seal
 * cannot answer "would this change anything?" after the fact.
 *
 * @param {Buffer} raw  8 bit RGB, row major
 */
export async function encodeCleanPng(raw, { width, height, channels = 3 }) {
  const pipeline = sharp(raw, { raw: { width, height, channels } });
  // One channel in has to be one channel out. Left alone the encoder promotes a
  // single band to three identical ones, which is a third more file for nothing
  // and, worse, stops a downstream tool that asked for a one channel format from
  // being able to say it got what it asked for.
  const encoded = await (channels === 1 ? pipeline.toColourspace('b-w') : pipeline)
    .png({ palette: false, compressionLevel: 9, effort: 10 })
    .toBuffer();
  return stripAncillaryChunks(encoded);
}

/**
 * @param {Buffer} raw  8 bit RGB, row major
 */
export async function writeCleanPng(raw, { width, height, channels = 3 }, path) {
  const cleaned = await encodeCleanPng(raw, { width, height, channels });
  writeFileSync(path, cleaned);
  return cleaned.length;
}
