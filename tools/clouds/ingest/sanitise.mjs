// Step one of the plate chain, and it is not optional.
//
//   node tools/clouds/ingest/sanitise.mjs <in-dir-or-file> [...] --out <dir>
//
// A reference plate arrives as a file somebody else's software wrote, and such
// a file carries more than pixels: provenance records, exposure tables, colour
// profiles, thumbnails, comments, timestamps. None of it is the photograph and
// all of it would travel into an asset the project ships.
//
// So nothing is edited out of the container. The pixels are DECODED and a new
// file is written from them, with only the four chunks a PNG needs to be a PNG,
// and the result is then read back and checked from its own bytes. What was not
// carried across cannot have survived: there is no chunk list to keep up to
// date and no format-specific knowledge of where a given standard hides things.
//
// Everything downstream reads plates through tools/clouds/ingest/lib/plate.mjs,
// which refuses a file this step has not been over.

import {
  existsSync, mkdirSync, readdirSync, statSync,
} from 'node:fs';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';
import { writeCleanPng } from '../../grade/lib/png.mjs';
import { inspectPng } from '../../grade/check-png.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1];
};
const OUT = opt('out', null);
const inputs = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!inputs.length || !OUT) {
  console.error('usage: sanitise.mjs <in-dir-or-file> [...] --out <dir>');
  process.exit(1);
}

const READABLE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.avif']);

function collect(path) {
  if (statSync(path).isDirectory()) {
    return readdirSync(path).sort()
      .filter((f) => READABLE.has(extname(f).toLowerCase()))
      .map((f) => join(path, f));
  }
  return [path];
}

const files = inputs.flatMap(collect);
if (!files.length) {
  console.error(`no readable plate under ${inputs.join(', ')}`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

let failed = false;
for (const file of files) {
  const image = sharp(file);
  const meta = await image.metadata();
  // WHETHER THE FOURTH CHANNEL IS A MATTE OR A CHANNEL OF ONES, and the file
  // itself is asked rather than the roster.
  //
  // A plate shot against sky has no transparency: its alpha, if it has one at
  // all, is a channel of ones, and carrying it would be a quarter of the file
  // for nothing. A plate delivered WITH a true alpha has the matte this chain
  // would otherwise have to estimate, and dropping it would throw away the one
  // thing about the source that cannot be recovered — so it is kept, at full
  // eight bits, with no threshold anywhere near it.
  //
  // The metadata still comes off first and it comes off the same way: the
  // pixels are decoded and a new file is written from them. Nothing about this
  // decision changes what a clean PNG is.
  const { data, info } = await image.toColourspace('srgb')
    .raw().toBuffer({ resolveWithObject: true });
  const deepSample = data.length === info.width * info.height * info.channels * 2;
  const alphaAt = (i) => {
    const at = i * info.channels + 3;
    return deepSample ? data.readUInt16LE(at * 2) >> 8 : data[at];
  };
  let opaque = true;
  let partial = 0;
  if (info.channels === 4) {
    for (let i = 0; i < info.width * info.height; i++) {
      const a = alphaAt(i);
      if (a !== 255) opaque = false;
      if (a > 0 && a < 255) partial++;
    }
  }
  const channels = info.channels === 4 && !opaque ? 4 : 3;
  // Sharp reports sixteen-bit sources as two bytes a sample; the plate is
  // written at eight because that is what the atlas carries and a second
  // requantisation later would be a second place to lose the veil.
  const deep = data.length === info.width * info.height * info.channels * 2;
  const raw = Buffer.alloc(info.width * info.height * channels);
  for (let i = 0; i < info.width * info.height; i++) {
    for (let c = 0; c < channels; c++) {
      const at = i * info.channels + c;
      raw[i * channels + c] = deep ? data.readUInt16LE(at * 2) >> 8 : data[at];
    }
  }
  const out = join(OUT, `${basename(file, extname(file))}.png`);
  const bytes = await writeCleanPng(raw, { width: info.width, height: info.height, channels }, out);

  // Read back from the bytes on disk, because what matters is what the file
  // says and not what this process meant to write.
  const checked = inspectPng(out);
  const before = existsSync(file) ? statSync(file).size : 0;
  process.stdout.write(`${file}\n`);
  process.stdout.write(`  ${info.width}x${info.height}  ${meta.format}  ${before} B`
    + `  ->  ${out}  ${bytes} B\n`);
  // WHAT THE ALPHA IS WORTH, said out loud, because a matte that arrives
  // already thresholded is the one failure this step cannot fix and the chain
  // downstream cannot see: a silhouette of nothing but zeroes and ones draws
  // the hard edge the whole sky was rebuilt to be rid of. A backlit cumulus
  // matted properly carries a fifth to a third of its own body in partial
  // coverage; a figure near nought is a mask, not a matte.
  if (info.channels === 4) {
    const share = 100 * partial / (info.width * info.height);
    process.stdout.write(`  alpha: ${opaque ? 'a channel of ones, dropped'
      : `kept, ${share.toFixed(1)}% of the frame partly covered`}\n`);
    if (!opaque && share < 2) {
      process.stdout.write('  WARNING the alpha is all but binary: this is a mask and not a '
        + 'matte, and the fringe it draws will be a step\n');
    }
  }
  // Counted rather than listed: a large image is hundreds of data chunks, and
  // what this line is for is the ones that are not data.
  const tally = new Map();
  for (const c of checked.chunks) tally.set(c.type, (tally.get(c.type) || 0) + 1);
  process.stdout.write(`  chunks: ${[...tally].map(([t, n]) => (n > 1 ? `${t}x${n}` : t)).join(' ')}\n`);
  if (checked.ancillary.length || checked.header.colourType === 3) {
    process.stdout.write(`  FAIL ${checked.ancillary.map((c) => c.type).join(' ') || 'palettised'}\n`);
    failed = true;
  } else {
    process.stdout.write('  clean: no ancillary chunk, no colour profile, no textual or timestamp metadata\n');
  }
}
if (failed) process.exitCode = 1;
