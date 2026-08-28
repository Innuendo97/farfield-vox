import { join } from 'node:path';
import sharp from 'sharp';
import { EYE_HEIGHT, MONOLITHS, PLATFORM, SPAWN } from '../../src/world/layout.js';
import { FRAME, POSE, REPO_ROOT } from '../grade/lib/framing.mjs';

// Where the blocks end, to the pixel, and whether anything has moved them.
//
// tools/terrain/silhouette.mjs answers a different question: it takes the
// strongest luminance step near a projected edge, which is the right tool when
// the block is one flat colour, and the wrong one now. A lit block has a hard
// step down its own arris where the flank meets the engraved face, and that
// step is stronger than the one at the outline: measured that way, giving the
// stone its material looks like moving it seven pixels.
//
// So this takes the outermost step instead. For a left edge it is the smallest
// column in the window that steps at all, for a right edge the largest. Run it
// on two renders and the difference is what the change actually did to the
// outline.
//
//   node tools/monoliths/outline.mjs <render.png> [second.png]

const DEG = Math.PI / 180;
const SEARCH = 16;
const STEP = 9;
const ROWS = [180, 240, 300, 360, 420, 480, 540];

function project() {
  const aspect = FRAME.width / FRAME.height;
  const tanV = Math.tan(POSE.fov * DEG / 2);
  const tanH = tanV * aspect;
  const eye = { x: 0, y: EYE_HEIGHT, z: SPAWN.z };
  const cp = Math.cos(-POSE.pitch * DEG);
  const sp = Math.sin(-POSE.pitch * DEG);

  const boxes = MONOLITHS.filter((m) => m.id !== '06').map((m) => ({
    id: m.id, x: m.position.x, z: m.position.z, rotationY: m.rotationY,
    w: m.size[0], h: m.size[1], d: m.size[2], y0: m.baseY,
  }));
  boxes.push({
    id: 'platform', x: PLATFORM.x, z: PLATFORM.z, rotationY: PLATFORM.rotationY,
    w: PLATFORM.width, h: PLATFORM.height, d: PLATFORM.depth, y0: 0,
  });

  return boxes.map((b) => {
    const c = Math.cos(b.rotationY * DEG);
    const s = Math.sin(b.rotationY * DEG);
    const points = [];
    for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) {
      const lx = sx * b.w / 2;
      const lz = sz * b.d / 2;
      const wx = b.x + lx * c + lz * s - eye.x;
      const wy = b.y0 + sy * b.h - eye.y;
      const wz = b.z - lx * s + lz * c - eye.z;
      const cy = wy * cp - wz * sp;
      const cz = wy * sp + wz * cp;
      if (cz > -0.01) continue;
      points.push([
        (wx / -cz / tanH * 0.5 + 0.5) * FRAME.width,
        (0.5 - cy / -cz / tanV * 0.5) * FRAME.height,
      ]);
    }
    return { id: b.id, points };
  });
}

function extentAtRow(points, row) {
  let left = Infinity;
  let right = -Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[j];
      if ((ay <= row && by > row) || (by <= row && ay > row)) {
        const x = ax + (row - ay) / (by - ay) * (bx - ax);
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  return Number.isFinite(left) ? { left, right } : null;
}

function luma(image, x, y) {
  const o = (y * image.width + x) * 3;
  return 0.2126 * image.data[o] + 0.7152 * image.data[o + 1] + 0.0722 * image.data[o + 2];
}

/** Outermost column near `expected` where the frame steps by at least STEP. */
function findOutline(image, expected, row, side) {
  const centre = Math.round(expected);
  const from = side === 'left' ? centre - SEARCH : centre + SEARCH;
  const to = side === 'left' ? centre + SEARCH : centre - SEARCH;
  const direction = side === 'left' ? 1 : -1;
  for (let x = from; x !== to + direction; x += direction) {
    if (x < 2 || x >= image.width - 2) continue;
    if (Math.abs(luma(image, x + 1, row) - luma(image, x - 1, row)) >= STEP) return x;
  }
  return null;
}

async function read(path) {
  const { data, info } = await sharp(path).removeAlpha()
    .resize(FRAME.width, FRAME.height, { fit: 'fill' }).raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

async function main() {
  const first = process.argv[2] || join(REPO_ROOT, 'shots', 'pose-p.png');
  const second = process.argv[3] || null;
  const a = await read(first);
  const b = second ? await read(second) : null;
  const boxes = project();

  process.stdout.write(`${first}${second ? `  vs  ${second}` : ''}\n\n`);
  process.stdout.write(`  ${'block'.padEnd(10)}${'row'.padStart(5)}${'edge'.padStart(7)}`
    + `${'projected'.padStart(11)}${'found'.padStart(8)}${'offset'.padStart(8)}`
    + (b ? `${'other'.padStart(8)}${'moved'.padStart(8)}` : '') + '\n');

  let worstOffset = 0;
  let worstMove = 0;
  let measured = 0;
  for (const row of ROWS) {
    for (const box of boxes) {
      const extent = extentAtRow(box.points, row);
      if (!extent) continue;
      for (const side of ['left', 'right']) {
        const expected = extent[side];
        if (expected < SEARCH + 3 || expected > FRAME.width - SEARCH - 3) continue;
        const found = findOutline(a, expected, row, side);
        if (found === null) continue;
        const other = b ? findOutline(b, expected, row, side) : null;
        const offset = found - expected;
        worstOffset = Math.max(worstOffset, Math.abs(offset));
        measured++;
        let move = '';
        if (other !== null) {
          worstMove = Math.max(worstMove, Math.abs(found - other));
          move = `${String(other).padStart(8)}${(found - other).toFixed(0).padStart(8)}`;
        }
        process.stdout.write(`  ${box.id.padEnd(10)}${String(row).padStart(5)}${side.padStart(7)}`
          + `${expected.toFixed(1).padStart(11)}${String(found).padStart(8)}`
          + `${offset.toFixed(1).padStart(8)}${move}\n`);
      }
    }
  }
  process.stdout.write(`\n  ${measured} outline points, worst offset from the plan `
    + `${worstOffset.toFixed(1)} px`);
  if (b) process.stdout.write(`, worst movement between the two ${worstMove.toFixed(1)} px`);
  process.stdout.write('\n');
}

main();
