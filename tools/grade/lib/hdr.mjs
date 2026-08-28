// Radiance RGBE (.hdr) decoder.
//
// The sky sources are shipped as Radiance files and nothing in the image
// toolchain reads them, so the format is decoded here: it is a small, frozen
// specification and a dependency for it would be heavier than the code.

function readLine(bytes, state) {
  let text = '';
  while (state.pos < bytes.length) {
    const code = bytes[state.pos++];
    if (code === 0x0a) return text;
    text += String.fromCharCode(code);
  }
  return text;
}

// One row of the adaptive run length encoding: four planes stored separately,
// each as an alternation of runs (count > 128) and literals.
function decodeRleRow(bytes, state, width, row) {
  for (let channel = 0; channel < 4; channel++) {
    let x = 0;
    while (x < width) {
      let count = bytes[state.pos++];
      if (count > 128) {
        const value = bytes[state.pos++];
        count -= 128;
        if (x + count > width) throw new Error('run overflows the scanline');
        for (let i = 0; i < count; i++) row[(x + i) * 4 + channel] = value;
      } else {
        if (count === 0) throw new Error('zero length literal');
        if (x + count > width) throw new Error('literal overflows the scanline');
        for (let i = 0; i < count; i++) row[(x + i) * 4 + channel] = bytes[state.pos++];
      }
      x += count;
    }
  }
}

/**
 * Decodes a Radiance file into linear float RGB.
 * @returns {{width:number,height:number,data:Float32Array}} row major, 3 floats per pixel
 */
export function decodeRadiance(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const state = { pos: 0 };

  const magic = readLine(bytes, state);
  if (!magic.startsWith('#?')) throw new Error('not a Radiance file');

  let exposure = 1;
  for (;;) {
    const line = readLine(bytes, state);
    if (line === '') break;
    const match = /^EXPOSURE=\s*([0-9.eE+-]+)/.exec(line);
    if (match) exposure *= Number(match[1]);
  }

  const resolution = readLine(bytes, state).trim();
  const dims = /^-Y\s+(\d+)\s+\+X\s+(\d+)$/.exec(resolution);
  if (!dims) throw new Error(`unsupported scanline order: ${resolution}`);
  const height = Number(dims[1]);
  const width = Number(dims[2]);

  const data = new Float32Array(width * height * 3);
  const row = new Uint8Array(width * 4);
  const inverseExposure = 1 / exposure;

  for (let y = 0; y < height; y++) {
    const adaptive = width >= 8 && width < 32768
      && bytes[state.pos] === 2 && bytes[state.pos + 1] === 2
      && ((bytes[state.pos + 2] << 8) | bytes[state.pos + 3]) === width;

    if (adaptive) {
      state.pos += 4;
      decodeRleRow(bytes, state, width, row);
    } else {
      for (let x = 0; x < width; x++) {
        const r = bytes[state.pos++];
        const g = bytes[state.pos++];
        const b = bytes[state.pos++];
        const e = bytes[state.pos++];
        // The old run length marker repeats the previous pixel; it never
        // appears in the sources used here, so it is rejected rather than
        // silently mis-decoded.
        if (r === 255 && g === 255 && b === 255) throw new Error('flat RLE is not supported');
        row[x * 4] = r; row[x * 4 + 1] = g; row[x * 4 + 2] = b; row[x * 4 + 3] = e;
      }
    }

    for (let x = 0; x < width; x++) {
      const e = row[x * 4 + 3];
      const scale = e === 0 ? 0 : (2 ** (e - 128)) / 256 * inverseExposure;
      const out = (y * width + x) * 3;
      data[out] = row[x * 4] * scale;
      data[out + 1] = row[x * 4 + 1] * scale;
      data[out + 2] = row[x * 4 + 2] * scale;
    }
  }

  return { width, height, data };
}
