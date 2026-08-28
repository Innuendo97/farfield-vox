import { join } from 'node:path';
import sharp from 'sharp';
import { EYE_HEIGHT, MONOLITHS, PLATFORM, SPAWN } from '../../src/world/layout.js';
import { FRAME, POSE, REPO_ROOT } from '../grade/lib/framing.mjs';

// Where the blocks stand in the frame, to the pixel.
//
// The ground may not move a monolith. It is allowed to bury a foot in grass and
// it is allowed to change every colour in the picture, but the silhouettes come
// from a least squares fit against the reference framing and they are the one
// thing in the scene that is already known to be right. Judging that by eye
// across a change of exposure is hopeless, so it is measured: the edges are
// projected from the numbers in layout.js, and the render is searched for the
// strongest luminance step within a few pixels of each of them.
//
//   node tools/terrain/silhouette.mjs <render.png> [--rows=200,300,400]

const DEG = Math.PI / 180;

// How far either side of the projected edge the real one is looked for. Wide
// enough to find an edge that has drifted, narrow enough that it cannot lock
// onto the next block along.
const SEARCH = 14;

function project() {
  const aspect = FRAME.width / FRAME.height;
  const tanV = Math.tan(POSE.fov * DEG / 2);
  const tanH = tanV * aspect;
  const eye = { x: 0, y: EYE_HEIGHT, z: SPAWN.z };
  const cp = Math.cos(-POSE.pitch * DEG);
  const sp = Math.sin(-POSE.pitch * DEG);

  const boxes = MONOLITHS.map((m) => ({
    id: m.id,
    x: m.position.x,
    z: m.position.z,
    rotationY: m.rotationY,
    w: m.size[0],
    h: m.size[1],
    d: m.size[2],
    y0: m.baseY,
  }));
  boxes.push({
    id: 'platform',
    x: PLATFORM.x,
    z: PLATFORM.z,
    rotationY: PLATFORM.rotationY,
    w: PLATFORM.width,
    h: PLATFORM.height,
    d: PLATFORM.depth,
    y0: 0,
  });

  return boxes.map((b) => {
    const c = Math.cos(b.rotationY * DEG);
    const s = Math.sin(b.rotationY * DEG);
    const points = [];
    for (const sx of [-1, 1]) {
      for (const sy of [0, 1]) {
        for (const sz of [-1, 1]) {
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
      }
    }
    return { id: b.id, points };
  });
}

/** Left and right extent of a projected box on one row of the frame. */
function extentAtRow(points, row) {
  // The silhouette of a rotated box is the outline of its projected corners;
  // for a left and a right edge on a given row, the extremes of the corners
  // that straddle it are enough, and the box is convex so nothing is missed.
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

/** Strongest luminance step within SEARCH pixels of a column, on one row. */
function findEdge(image, expected, row) {
  const centre = Math.round(expected);
  let best = null;
  for (let x = centre - SEARCH; x <= centre + SEARCH; x++) {
    if (x < 2 || x >= image.width - 2) continue;
    const step = Math.abs(luma(image, x + 1, row) - luma(image, x - 1, row));
    if (!best || step > best.step) best = { x, step };
  }
  return best;
}

async function main() {
  const path = process.argv[2] || join(REPO_ROOT, 'shots', 'pose-p-final.png');
  const rowsArg = process.argv.find((a) => a.startsWith('--rows='));
  const rows = (rowsArg ? rowsArg.slice(7).split(',') : ['180', '260', '340', '420', '500'])
    .map(Number);

  const { data, info } = await sharp(path).removeAlpha()
    .resize(FRAME.width, FRAME.height, { fit: 'fill' }).raw()
    .toBuffer({ resolveWithObject: true });
  const image = { width: info.width, height: info.height, data };

  const boxes = project();
  process.stdout.write(`${path}\n\n`);
  process.stdout.write(`  ${'block'.padEnd(10)}${'row'.padStart(5)}${'edge'.padStart(7)}`
    + `${'projected'.padStart(11)}${'found'.padStart(8)}${'offset'.padStart(8)}${'step'.padStart(8)}\n`);

  let worst = 0;
  let measured = 0;
  for (const row of rows) {
    for (const box of boxes) {
      const extent = extentAtRow(box.points, row);
      if (!extent) continue;
      for (const side of ['left', 'right']) {
        const expected = extent[side];
        if (expected < SEARCH + 2 || expected > FRAME.width - SEARCH - 2) continue;
        const found = findEdge(image, expected, row);
        // A step of less than this is not an edge, it is the grain of a
        // surface: the block is hidden there, or it meets something the same
        // brightness as itself.
        if (!found || found.step < 6) continue;
        const offset = found.x - expected;
        worst = Math.max(worst, Math.abs(offset));
        measured++;
        process.stdout.write(`  ${box.id.padEnd(10)}${String(row).padStart(5)}${side.padStart(7)}`
          + `${expected.toFixed(1).padStart(11)}${String(found.x).padStart(8)}`
          + `${offset.toFixed(1).padStart(8)}${found.step.toFixed(0).padStart(8)}\n`);
      }
    }
  }
  process.stdout.write(`\n  ${measured} edges measured, worst offset `
    + `${worst.toFixed(1)} px\n`);
}

main();
