import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, read, readJson, reporter, selfTest } from './lib.mjs';

// THE MEAN OF EVERY SHEET IS A HALF, AND THAT IS THE COLOUR OF THE DISTANT WORLD.
//
// WHAT THIS IS FOR, AND IT IS THE FIRST RISK THE RESEARCH NAMED. Past two screen
// pixels to a texel the sampler climbs the mip chain, and at the top of it a
// texture returns THE MEAN OF ITSELF. So a sheet's mean is not a by-product of
// how it was painted: it is the colour every face wearing it takes at range, and
// a sheet whose mean is not the neutral repaints the whole distance of the world
// in a colour nobody chose. C 3.8 put it as the design consequence of the whole
// dossier: "il colore medio di ogni tile e' una decisione di progetto, non un
// sottoprodotto -- si sceglie per primo, e la texture si dipinge attorno".
//
// The soil's fragment multiplies the pigment by `1 + gain * (grey - 0.5)`. Its
// neutral is a half exactly, and a half is what every grain sheet has to hold --
// not at level zero only, but at EVERY level of the chain, because the level a
// fragment lands on is decided by how far away it is standing.
//
// AND THERE WAS A FIFTH SHEET HERE THAT WAS NOT A GRAIN. The flower's band was a
// MASK -- nought the petal's pale pigment and one the pistil -- and this guard
// held its mean against the share src/world/vegetation.js painted its far quad
// with, so the two halves of one meadow could not come to hold two different
// flowers. E-DECISIONI15 put the pistil INSIDE the bud: there is no band on a
// face to mask, the sheet is gone from the recipe and from the delivery, and the
// two legs that read it are gone with it rather than being pointed at a file
// that is no longer written. What replaced the leg is in guard-fiori, which
// reads the lamp's share off the BOXES and off the far family's own uniform.
//
// THE OTHER DIRECTION, which is the half a guard is usually missing: --self
// injects the three ways a sheet can go wrong -- a mean a level too pale, a mean
// a level too dark, and a layer declared in the recipe that the picture does not
// carry -- and asserts that each one is caught.
//
// AND IT READS THE DELIVERED PICTURE AND NOT THE RECIPE. The recipe is checked
// too, by tools/materia/foglio.mjs --check, and that answers a different
// question: whether the sheets on disk are what the cuts produce. This answers
// whether what is on disk can be drawn.

const SRC = 'assets-src/materia';
const STRIP = `${SRC}/soil-sheets.png`;

/** The tolerance, in levels of 255, on the mean of any level of the chain. */
//
// ONE LEVEL, AND IT IS NOT A ROUND NUMBER: the byte grid has no 0.5, so a sheet
// of 256 texels whose sum is exactly 127.5 * 256 still rounds to 128 at its own
// last level -- half a level out by construction and no painting can do better.
// One level leaves that, and catches everything a level wide.
const EPS = 1.0;

/**
 * A PNG's samples, without a decoder library.
 *
 * The pictures this reads are its own project's: eight bit, no interlace, one of
 * the two colour types the deliveries use. Anything else and it says so rather
 * than guessing, because a guard that quietly mis-parses is worse than none.
 */
function pngGrey(rel) {
  const bytes = readFileSync(join(REPO_ROOT, rel));
  let pos = 8;
  let header = null;
  const idat = [];
  while (pos < bytes.length) {
    const length = bytes.readUInt32BE(pos);
    const type = bytes.toString('latin1', pos + 4, pos + 8);
    if (type === 'IHDR') {
      header = {
        width: bytes.readUInt32BE(pos + 8),
        height: bytes.readUInt32BE(pos + 12),
        depth: bytes[pos + 16],
        colour: bytes[pos + 17],
        interlace: bytes[pos + 20],
      };
    } else if (type === 'IDAT') idat.push(bytes.subarray(pos + 8, pos + 8 + length));
    pos += 12 + length;
    if (type === 'IEND') break;
  }
  if (!header) throw new Error(`${rel}: no IHDR`);
  if (header.depth !== 8 || header.interlace !== 0) {
    throw new Error(`${rel}: ${header.depth} bit, interlace ${header.interlace}`);
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colour];
  if (!channels) throw new Error(`${rel}: colour type ${header.colour}`);
  const { inflateSync } = require('node:zlib');
  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = header;
  const stride = width * channels;
  const out = new Uint8Array(width * height);
  const line = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[at];
    at += 1;
    for (let i = 0; i < stride; i++) {
      const x = raw[at + i];
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      line[i] = v & 0xff;
    }
    at += stride;
    // The red channel is the one the delivery keeps: the entries ship as R8 and
    // the encoder takes the first channel of a colour source.
    for (let x = 0; x < width; x++) out[y * width + x] = line[x * channels];
    prev.set(line);
  }
  return { width, height, data: out };
}

// node:zlib through createRequire, because this file is a module and inflateSync
// is the one synchronous decompressor the platform already has.
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);

/** The mip chain a box filter makes, which is what generateMipmap makes too. */
function chain(square, side) {
  const levels = [square];
  let cur = square; let s = side;
  while (s > 1) {
    const half = s >> 1;
    const next = new Uint8Array(half * half);
    for (let j = 0; j < half; j++) {
      for (let i = 0; i < half; i++) {
        next[j * half + i] = Math.round((cur[(j * 2) * s + i * 2]
          + cur[(j * 2) * s + i * 2 + 1]
          + cur[(j * 2 + 1) * s + i * 2]
          + cur[(j * 2 + 1) * s + i * 2 + 1]) / 4);
      }
    }
    levels.push(next); cur = next; s = half;
  }
  return levels;
}

const mean = (a) => a.reduce((t, v) => t + v, 0) / a.length;

/** The layers of the strip, as squares, in the order the array reads them. */
function slices(strip, side) {
  const out = [];
  for (let k = 0; k * side < strip.height; k++) {
    out.push(strip.data.subarray(k * side * side, (k + 1) * side * side));
  }
  return out;
}

function main() {
  const r = reporter('guard-foglio -- the mean of a sheet is the colour of the far world');
  if (!existsSync(join(REPO_ROOT, STRIP))) {
    r.skip(`no sheets yet: ${STRIP} is not on this branch`);
  }
  const recipe = readJson(`${SRC}/fogli.json`);
  const side = recipe.side;
  const strip = pngGrey(STRIP);
  r.check(strip.width === side, 'the strip is as wide as one sheet',
    `${strip.width} of ${side}`);
  const layers = slices(strip, side);
  const names = recipe.sheets.map((s) => s.id);
  r.check(layers.length === names.length, 'the strip holds the layers the recipe names',
    `${layers.length} of ${names.length}`);

  // EVERY LEVEL, AND NOT ONLY THE LAST. A sheet may hold its mean at the top and
  // lose it going down, because a box filter of an odd distribution rounds the
  // same way every time; the level a fragment lands on is decided by how far it
  // is standing, so every one of them is a level somebody sees.
  for (let k = 0; k < layers.length; k++) {
    const levels = chain(layers[k], side);
    const worst = Math.max(...levels.map((l) => Math.abs(mean(l) - 127.5)));
    const last = levels[levels.length - 1][0];
    r.check(worst <= EPS, `${(names[k] ?? `layer ${k}`).padEnd(11)} holds a half at every level`,
      `worst ${worst.toFixed(2)} of ${EPS} levels, last ${last}`);
  }

  // AND THE SHEETS ARE WHAT THE CUTS PRODUCE, which is the recipe's own leg:
  // this states where that check lives rather than repeating it, because a
  // second implementation of the derivation is a second thing to drift.
  r.line('  ----  the derivation itself: node tools/materia/foglio.mjs --check');
  r.end(`${layers.length} grain sheets, ${strip.width}x${strip.height}, `
    + `from ${SRC}/fogli.json`);
}

function self() {
  const side = readJson(`${SRC}/fogli.json`).side;
  const strip = pngGrey(STRIP);
  const first = Uint8Array.from(slices(strip, side)[0]);
  const worstOf = (square) => Math.max(
    ...chain(square, side).map((l) => Math.abs(mean(l) - 127.5)),
  );
  const bump = (by) => {
    const bad = Uint8Array.from(first);
    // Two levels spread over the whole sheet is one level of mean.
    for (let i = 0; i < bad.length; i += 2) bad[i] = Math.min(255, Math.max(0, bad[i] + by));
    return bad;
  };
  // AND A CHAIN THAT HOLDS AT THE TOP AND DRIFTS UNDER IT IS NOT INJECTED,
  // because it cannot be built: a box filter carries the mean exactly, and the
  // only thing that moves it is the rounding to a byte, which over the four
  // levels of a sixteen texel square is bounded by half a level whatever the
  // sheet holds -- checkerboard 0 and 255 is the extreme and it lands on 128.
  // That bound is why the tolerance is one level and not a tenth, and it is why
  // the leg that reads EVERY level is cheap insurance rather than the gate.
  // What IS injected in its place is the failure a session actually makes: a
  // layer added to the recipe and not to the picture, which would leave the
  // array reading a slice of nothing.
  const missing = { ...readJson(`${SRC}/fogli.json`) };
  const declared = missing.sheets.length + 1;
  selfTest('guard-foglio', [
    { what: 'a sheet two levels too pale', caught: worstOf(bump(4)) > EPS },
    { what: 'a sheet two levels too dark', caught: worstOf(bump(-4)) > EPS },
    {
      what: 'a layer declared in the recipe that the strip does not carry',
      caught: slices(strip, side).length !== declared,
    },
  ]);
}

if (process.argv.includes('--self')) self();
else main();
