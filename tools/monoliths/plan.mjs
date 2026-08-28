import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../grade/lib/framing.mjs';
import { MONOLITHS, PLATFORM } from '../../src/world/layout.js';

// Hands the blocks to Blender, and decides where each face of each one lives in
// the shared light atlas.
//
// Their dimensions belong to src/world/layout.js and nowhere else: they are a
// least squares reconstruction of the reference framing and the silhouette they
// produce is already known to be right. Python is given the finished numbers so
// it can never hold a second opinion about how big a monolith is.
//
// The atlas is packed here rather than by Blender's own unwrapper. A block is a
// box: every face is a rectangle whose size in metres is known before anything
// is modelled, so the layout is arithmetic, and doing it here means the runtime
// and the bake read the same table instead of trusting a packer to be stable
// across versions.

const OUT_DIR = join(REPO_ROOT, 'assets-src', 'monoliths');

// Bevel of the arrises, in metres.
//
// Three centimetres is under two pixels at the reference distance, so the
// silhouette does not move; it is enough for the arris to stop being a
// mathematical line and start catching the sky, which is what makes the stone
// read as cut rather than as a primitive.
const BEVEL = 0.03;

// Quads across the widest span of a face. The faces are close to flat in the
// reference and the whole budget for six blocks is a few thousand triangles, so
// this buys the facetting and nothing else.
const FACE_QUADS = 9;

// Amplitude of the facetting, in metres, and the length scale it varies over.
// It is held away from the arrises so a displaced vertex can never push the
// outline off the pixel it was fitted to.
const FACET_AMPLITUDE = 0.024;
const FACET_SCALE = 1.9;
const FACET_MARGIN = 0.34;

// The cracks: narrow vertical grooves cut into the engraved face and the flanks.
// Their width is what forces the extra columns into the grid, so it is declared
// here where the grid is decided.
const CRACK_DEPTH = 0.016;
const CRACK_HALF_WIDTH = 0.06;

// Shared light atlas, and the padding round every island in texels. The bake
// bleeds into the padding and the bilinear filter reads into it, so without it
// each face would show its neighbour along its rim.
// A thousand and twenty four, not two thousand: what is stored here is light,
// and light on a flat face of stone varies over metres, not centimetres. Four
// times the sheet bought a third of a millimetre of detail nothing can see and
// cost four times the bake and four times the download.
const ATLAS = 1024;
const ATLAS_PAD = 4;

// Metres of stone per repeat of the tiling albedo.
export const STONE_TILE = 2.4;

// Local frame of a block, in the axes the bake works in: x across the face,
// y through the block, z up. The engraved face is -y, because the runtime turns
// its +Z towards the walker and the conversion to Blender flips that axis.
const FACES = ['+x', '-x', '+y', '-y', '+z', '-z'];

function faceExtent(face, [width, height, depth]) {
  if (face === '+x' || face === '-x') return [depth, height];
  if (face === '+y' || face === '-y') return [width, height];
  return [width, depth];
}

/**
 * Shelf packing of every face of every block into one atlas.
 *
 * Rectangles go in tallest first along rows, which is the simplest packer that
 * does not waste half the sheet. The density is searched rather than chosen:
 * the answer wanted is the finest light the sheet can hold, and that is one
 * bisection over a set of thirty six rectangles that never changes.
 */
function pack(blocks, density) {
  const boxes = [];
  for (const block of blocks) {
    for (const face of FACES) {
      const [a, b] = faceExtent(face, block.size);
      boxes.push({
        key: `${block.id}${face}`,
        w: Math.ceil(a * density) + ATLAS_PAD * 2,
        h: Math.ceil(b * density) + ATLAS_PAD * 2,
      });
    }
  }

  const order = [...boxes].sort((p, q) => q.h - p.h || q.w - p.w);
  const placed = new Map();
  let shelfY = 0;
  let shelfH = 0;
  let cursor = 0;

  for (const box of order) {
    if (box.w > ATLAS) return null;
    if (cursor + box.w > ATLAS) {
      shelfY += shelfH;
      shelfH = 0;
      cursor = 0;
    }
    if (shelfY + box.h > ATLAS) return null;
    placed.set(box.key, [
      (cursor + ATLAS_PAD) / ATLAS,
      (shelfY + ATLAS_PAD) / ATLAS,
      (cursor + box.w - ATLAS_PAD) / ATLAS,
      (shelfY + box.h - ATLAS_PAD) / ATLAS,
    ]);
    cursor += box.w;
    shelfH = Math.max(shelfH, box.h);
  }
  return placed;
}

function bestPacking(blocks) {
  let low = 8;
  let high = 200;
  let best = null;
  let bestDensity = 0;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    const attempt = pack(blocks, mid);
    if (attempt) {
      best = attempt;
      bestDensity = mid;
      low = mid;
    } else {
      high = mid;
    }
  }
  if (!best) throw new Error('the light atlas cannot hold the blocks');
  return { rects: best, density: bestDensity };
}

function main() {
  const blocks = MONOLITHS.map((m) => ({
    id: m.id,
    key: m.key,
    size: m.size,
    x: m.position.x,
    y: m.baseY,
    z: m.position.z,
    rotationY: m.rotationY,
    // Two or three cracks, at positions derived from the block's own number so
    // the same monolith is cracked the same way on every rebuild.
    cracks: Array.from({ length: 2 + (Number(m.id) % 2) }, (unused, k) => (
      0.16 + 0.68 * (((k * 3 + Number(m.id) * 2) % 7) / 6)
    )),
  }));

  const { rects, density } = bestPacking(blocks);
  for (const block of blocks) {
    block.atlas = Object.fromEntries(FACES.map((face) => [face, rects.get(`${block.id}${face}`)]));
  }

  const spec = {
    bevel: BEVEL,
    faceQuads: FACE_QUADS,
    facet: { amplitude: FACET_AMPLITUDE, scale: FACET_SCALE, margin: FACET_MARGIN },
    crack: { depth: CRACK_DEPTH, halfWidth: CRACK_HALF_WIDTH },
    atlas: { size: ATLAS, density: Number(density.toFixed(2)), pad: ATLAS_PAD },
    stoneTile: STONE_TILE,
    // The platform is not exported: it belongs to the stair. It stands in the
    // bake because the tallest block sits on it and takes light off its foot.
    platform: {
      size: [PLATFORM.width, PLATFORM.height, PLATFORM.depth],
      x: PLATFORM.x,
      y: 0,
      z: PLATFORM.z,
      rotationY: PLATFORM.rotationY,
    },
    blocks,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, 'blocks.json');
  writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  process.stdout.write(`${blocks.length} blocks, bevel ${BEVEL} m, `
    + `atlas ${ATLAS} at ${density.toFixed(1)} texels/m\n${path}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('plan.mjs')) main();
