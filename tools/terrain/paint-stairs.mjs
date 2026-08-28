import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../grade/lib/framing.mjs';
import { writeCleanPng } from '../grade/lib/png.mjs';
import { linearToSrgb } from '../grade/lib/color.mjs';
import { ATLAS, stairMesh } from '../../src/world/stairs.js';
import {
  fbm, mix, noise, slab, STONE, STONE_DARK, STONE_WORN,
} from './lib/pattern.mjs';

// Paints the stair and the platform, into the atlas the geometry declares.
//
// Same rock as the path, and painted from the same lattice so that the slabs of
// one run into the treads of the other without a change of material. What makes
// it read as worked stone rather than as more path is the wear: the nose of a
// tread is walked on for decades and comes up pale and rounded, the back of it
// keeps its grain, and the joint between two slabs holds dirt.
//
// The atlas is walked face by face rather than texel by texel across the sheet,
// because a texel only has a world position through the quad it belongs to.

const OUT = join(REPO_ROOT, 'assets-src', 'terrain', 'stairs-albedo.png');

// Dirt in the joints and in the angle where a riser meets a tread.
const GRIME = [0.062, 0.058, 0.049];

function bilinear(corners, s, t) {
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const top = corners[0][c] + (corners[1][c] - corners[0][c]) * s;
    const bottom = corners[3][c] + (corners[2][c] - corners[3][c]) * s;
    out[c] = top + (bottom - top) * t;
  }
  return out;
}

/**
 * Colour of one point of one face.
 * @param {object} face  the quad, for what kind of surface this is
 * @param {number[]} p   world position
 * @param {number} s     across the face, 0..1
 * @param {number} t     down the face, 0..1
 */
function shade(face, p, s, t) {
  const [x, y, z] = p;

  // Grain, from the same lattice the path is cut on: the two surfaces are one
  // quarry. The vertical faces are sampled on x and y so the grain does not
  // smear down them.
  const vertical = face.kind === 'riser' || face.kind === 'cheek'
    || face.kind === 'platform-side';
  const gz = vertical ? y * 2.4 + z * 0.15 : z;

  const cell = slab(x, gz, face.kind === 'platform' ? 1.15 : 0.72);
  let colour = mix(STONE_DARK, STONE, 0.30 + 0.70 * cell.id);
  const grain = fbm(x * 2.6 + 61, gz * 2.6 + 7, 4, 1);
  colour = colour.map((c) => c * (0.84 + 0.30 * grain));

  // The joint between two slabs, and the dirt that collects in it.
  const joint = 1 - Math.min(1, cell.joint / 0.055);
  colour = mix(colour, GRIME, joint * 0.55);

  // Wear. On a tread it is the nose and the middle of the run, where feet land;
  // on a riser and a cheek it is the top edge, which is what gets kicked.
  //
  // The nose is the one part of this that carries the picture. In the reference
  // every step is read as a pale line along its front edge and nothing else,
  // because the tall block puts the whole run in shadow and only the rounded,
  // polished nosing is bright enough to come back out of it. So the nose is
  // taken almost the whole way to the worn colour, and the noise that breaks up
  // the rest of the wear is floored on it: a nosing that fades in and out along
  // its length stops reading as an edge.
  let wear = 0;
  let floor = 0;
  if (face.kind === 'tread') {
    const nose = 1 - Math.min(1, Math.abs(t - 1) / 0.20);
    const middle = 1 - Math.min(1, Math.abs(s - 0.5) / 0.42);
    wear = Math.max(nose, middle * 0.5);
    floor = nose * 0.85;
  } else if (face.kind === 'riser') {
    wear = 1 - Math.min(1, t / 0.20);
    floor = wear * 0.85;
  } else if (face.kind === 'cheek') {
    wear = 1 - Math.min(1, t / 0.18);
  } else {
    const rim = Math.min(s, 1 - s, t, 1 - t);
    wear = 1 - Math.min(1, rim / 0.06);
  }
  // Broken up, so no edge is worn evenly along its whole length.
  wear *= 0.45 + 0.85 * fbm(x * 5.1 + 13, gz * 5.1 + 41, 3, 1);
  wear = Math.max(wear, floor);
  colour = mix(colour, STONE_WORN, Math.min(1, wear) * 0.86);

  // Grime where a riser meets the tread below it, and along the foot of the
  // platform: the angle a broom never reaches.
  if (!vertical) {
    const back = 1 - Math.min(1, t / 0.10);
    colour = mix(colour, GRIME, back * 0.35);
  } else {
    const foot = 1 - Math.min(1, (1 - t) / 0.18);
    colour = mix(colour, GRIME, foot * 0.30);
  }

  // Fine speckle, so the flat faces are never a single value across a tread.
  const speckle = noise(x * 26 + 77, gz * 26 + 21);
  return colour.map((c) => c * (0.94 + 0.13 * speckle));
}

function main() {
  const pixels = Buffer.alloc(ATLAS * ATLAS * 3);
  const mesh = stairMesh();
  const started = Date.now();

  mesh.faces.forEach((face, f) => {
    const { px } = mesh.rects[f];
    // Painted one texel past the rectangle on every side: the bilinear filter
    // and the bake margin both read there, and an unpainted texel would show up
    // as a black hairline along the edge of the face.
    const bleed = 2;
    for (let y = px.y0 - bleed; y < px.y1 + bleed; y++) {
      if (y < 0 || y >= ATLAS) continue;
      const t = Math.min(1, Math.max(0, (y + 0.5 - px.y0) / (px.y1 - px.y0)));
      for (let x = px.x0 - bleed; x < px.x1 + bleed; x++) {
        if (x < 0 || x >= ATLAS) continue;
        const s = Math.min(1, Math.max(0, (x + 0.5 - px.x0) / (px.x1 - px.x0)));
        const world = bilinear(face.corners, s, t);
        const colour = shade(face, world, s, t);
        const o = (y * ATLAS + x) * 3;
        for (let c = 0; c < 3; c++) {
          pixels[o + c] = Math.round(Math.min(1, Math.max(0, linearToSrgb(colour[c]))) * 255);
        }
      }
    }
  });

  process.stdout.write(`painted ${mesh.faces.length} faces into ${ATLAS}x${ATLAS} `
    + `in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  return pixels;
}

mkdirSync(join(REPO_ROOT, 'assets-src', 'terrain'), { recursive: true });
const bytes = await writeCleanPng(main(), { width: ATLAS, height: ATLAS }, OUT);
process.stdout.write(`${OUT} (${(bytes / 1024).toFixed(0)} kB)\n`);
