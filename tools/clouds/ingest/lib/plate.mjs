import sharp from 'sharp';
import { inspectPng } from '../../../grade/check-png.mjs';
import { srgbToLinear } from '../../../grade/lib/color.mjs';

// A reference plate is a photograph, and a photograph is a file with a history
// in it. Everything downstream of the sanitiser reads plates through here, so
// that there is ONE door and the door is locked: a file that still carries what
// the camera, the editor or the transport left behind cannot be read at all,
// let alone packed into an atlas the project ships.
//
// The rule is the repository's own and the check is the repository's own —
// tools/grade/check-png.mjs, imported rather than restated, because a second
// copy of "what a clean PNG is" is a second answer waiting to disagree.

/**
 * Why this file may not be read, if it may not.
 *
 * @returns {string[]} empty when the plate is clean
 */
export function plateComplaints(path) {
  const info = inspectPng(path);
  const out = [];
  if (info.ancillary.length > 0) {
    out.push(`carries ${info.ancillary.map((c) => c.type).join(' ')}`);
  }
  // A palettised plate is 256 colours, and a sky is a gradient: what would come
  // back is the banding, not the photograph.
  if (info.header.colourType === 3) out.push('is palettised');
  return out;
}

/**
 * A sanitised plate, in linear light.
 *
 * Linear because every measurement past this point is about MIXTURE — a texel
 * of veil is so much cloud in front of so much sky — and mixture is linear in
 * radiance and is not linear in a stored display value. Matting through the
 * transfer function is the classic way to get a dark fringe round everything.
 *
 * @returns {{width: number, height: number, lin: Float32Array}} rgb, row major
 */
export async function readPlate(path) {
  const complaints = plateComplaints(path);
  if (complaints.length) {
    throw new Error(`${path} ${complaints.join(' and ')}: run the sanitiser first — `
      + 'nothing that has not been through it may reach the atlas');
  }
  const image = sharp(path);
  const meta = await image.metadata();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  // Sixteen bits a sample come back as two bytes a sample, and the plate is
  // read the same way whichever it is: the transfer function is the same curve
  // and the extra bits only make the sky's own gradient smoother.
  const deep = data.length === width * height * channels * 2;
  const lin = new Float32Array(width * height * 3);
  // THE FOURTH CHANNEL IS NOT A COLOUR AND DOES NOT GO THROUGH THE TRANSFER.
  //
  // A coverage is a fraction of a fragment: half covered is half, at every
  // brightness, and putting it through the curve a display uses for light would
  // turn a half into 0.21 and every fringe in the delivery with it. Only the
  // three colour channels are decoded.
  const alpha = channels === 4 ? new Float32Array(width * height) : null;
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) {
      const at = (i * channels + c);
      const v = deep ? data.readUInt16LE(at * 2) / 65535 : data[at] / 255;
      lin[i * 3 + c] = srgbToLinear(v);
    }
    if (alpha) {
      const at = i * channels + 3;
      alpha[i] = deep ? data.readUInt16LE(at * 2) / 65535 : data[at] / 255;
    }
  }
  return {
    width, height, lin, alpha, bitDepth: meta.depth === 'ushort' ? 16 : 8,
  };
}

/**
 * Whether a plate's colour is already multiplied by its own coverage.
 *
 * BOTH CONVENTIONS ARRIVE AND NEITHER IS LABELLED. A renderer that writes an
 * RGBA cloud usually writes it premultiplied — colour over black, scaled by the
 * coverage — and an editor that cuts a mask usually leaves the colour alone
 * behind it. The two differ by a factor of the coverage, which on a fringe is
 * the whole of the fringe, so guessing wrong makes every soft edge either black
 * or twice as bright as it should be.
 *
 * The question the pixels can answer is whether the colour ever stands above
 * the coverage. Premultiplied colour cannot: c = a·C with C in [0,1] means
 * c <= a everywhere. Straight colour over a light cloud does, constantly. A few
 * texels over the line are rounding; a body of them is the answer.
 *
 * @returns {{premultiplied: boolean, above: number, tested: number}}
 */
export function premultiplicationOf(lin, alpha, width, height) {
  let above = 0;
  let tested = 0;
  for (let i = 0; i < width * height; i++) {
    const a = alpha[i];
    // Only where there is a fringe to judge: a texel at nought carries no
    // colour under either convention and a texel at one is the same number
    // under both.
    if (a <= 0.02 || a >= 0.98) continue;
    tested++;
    const c = Math.max(lin[i * 3], lin[i * 3 + 1], lin[i * 3 + 2]);
    if (c > a + 1 / 255) above++;
  }
  return { premultiplied: tested > 0 && above < 0.02 * tested, above, tested };
}

/** Luminance of a linear triple, in the coefficients the rest of the project uses. */
export const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * How blue a colour is, as a share of its own total.
 *
 * The one measurement that separates this sky from this cloud reliably. A
 * backlit cumulus runs from a warm white rim to a grey belly and its brightness
 * covers the whole range the sky's does — a belly against a bright horizon is
 * DARKER than the sky beside it — so brightness cannot be the discriminator.
 * Chromaticity can: the sky is blue everywhere, and the only thing that makes a
 * cloud texel blue is the sky still showing through it.
 */
export const blueness = (r, g, b) => b / Math.max(1e-6, r + g + b);
