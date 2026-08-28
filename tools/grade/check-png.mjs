import { readFileSync, statSync } from 'node:fs';

// Reports what a PNG actually contains: colour type, bit depth and the full
// chunk list. Every image the project ships has to be free of the auxiliary
// chunks a camera or an editor leaves behind, and a smooth gradient has to be
// true colour rather than palettised, so both are checked from the bytes.

const CRITICAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);
const COLOUR_TYPES = {
  0: 'greyscale', 2: 'truecolour', 3: 'indexed', 4: 'greyscale+alpha', 6: 'truecolour+alpha',
};

export function inspectPng(path) {
  const bytes = readFileSync(path);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== signature[i]) throw new Error(`${path} is not a PNG`);
  }

  const chunks = [];
  let pos = 8;
  let header = null;
  while (pos < bytes.length) {
    const length = bytes.readUInt32BE(pos);
    const type = bytes.toString('latin1', pos + 4, pos + 8);
    chunks.push({ type, length });
    if (type === 'IHDR') {
      header = {
        width: bytes.readUInt32BE(pos + 8),
        height: bytes.readUInt32BE(pos + 12),
        bitDepth: bytes[pos + 16],
        colourType: bytes[pos + 17],
        interlace: bytes[pos + 20],
      };
    }
    pos += 12 + length;
    if (type === 'IEND') break;
  }

  const ancillary = chunks.filter((c) => !CRITICAL.has(c.type));
  return { path, bytes: statSync(path).size, header, chunks, ancillary };
}

function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) throw new Error('usage: node tools/grade/check-png.mjs <file.png> [...]');
  let failed = false;
  for (const path of paths) {
    const info = inspectPng(path);
    const { header } = info;
    process.stdout.write(`${path}\n`);
    process.stdout.write(`  ${header.width}x${header.height}  ${header.bitDepth} bit  `
      + `${COLOUR_TYPES[header.colourType] ?? header.colourType}  `
      + `${header.interlace ? 'interlaced' : 'progressive'}  ${info.bytes} B\n`);
    process.stdout.write(`  chunks: ${info.chunks.map((c) => c.type).join(' ')}\n`);
    if (info.ancillary.length > 0) {
      process.stdout.write(`  FAIL carries ${info.ancillary.map((c) => c.type).join(' ')}\n`);
      failed = true;
    } else {
      process.stdout.write('  clean: no ancillary chunk, no colour profile, no textual or timestamp metadata\n');
    }
    if (header.colourType === 3) {
      process.stdout.write('  FAIL palettised: a gradient cannot survive 256 entries\n');
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith('check-png.mjs')) main();
