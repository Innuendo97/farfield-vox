import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Shared geometry between the reference image and the running scene.
//
// The reference framing is a real camera: eye height, a small upward tilt and a
// vertical field of view, all fixed in src/core/poses.js. Reproducing that
// projection offline is what makes it possible to ask "what is the sky doing in
// this exact direction" on both the reference image and a candidate sky, and to
// compare the two without ever guessing.

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const DEG = Math.PI / 180;

// Parsed rather than imported: poses.js belongs to the runtime and pulls the
// world layout with it, which has no business running inside a build tool.
//
// AND IT FOLLOWS A SPREAD, WHICH IS THE PRICE OF PARSING RATHER THAN IMPORTING.
// POSE_TARGET is the day fit now (U-SENT-6, R3 S5: the five round numbers that
// stood there were assembled out of the walker's body and the spawn point and
// were never the camera the reference was fitted at), and the fit is written
// once under a name of its own so the two poses that ARE that camera cannot
// drift apart. A reader that only knows how to find `fov:` inside a brace sees
// nothing there; so when a key is missing this follows the `...NAME` in the
// block to the object that holds it. One level, which is all there is: the
// alternative is either a copy of six numbers or importing the runtime.
function readPose() {
  const source = readFileSync(new URL('../../../src/core/poses.js', import.meta.url), 'utf8');
  const blockOf = (name) => {
    const hit = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`).exec(source);
    if (!hit) throw new Error(`${name} not found in src/core/poses.js`);
    return hit[1];
  };
  const block = blockOf('POSE_TARGET');
  const spread = /\.\.\.([A-Za-z_$][\w$]*)/.exec(block);
  const from = spread ? blockOf(spread[1]) : null;
  const number = (key) => {
    const find = (text) => new RegExp(`${key}:\\s*(-?[0-9.]+)`).exec(text);
    const found = find(block) || (from ? find(from) : null);
    if (!found) throw new Error(`${key} not found in POSE_TARGET`);
    return Number(found[1]);
  };
  return { yaw: number('yaw'), pitch: number('pitch'), fov: number('fov') };
}

export const POSE = readPose();

// The reference image is the authority on the aspect ratio: the viewport is
// matched to it, not the other way round.
export const FRAME = { width: 1672, height: 941 };

/**
 * Screen pixel to world direction, using the reference pose.
 * World basis matches src/world/layout.js: +Y up, north is -Z.
 */
export function makeRay({ width = FRAME.width, height = FRAME.height, pose = POSE } = {}) {
  const aspect = width / height;
  const tanV = Math.tan(pose.fov * DEG / 2);
  const tanH = tanV * aspect;
  const cp = Math.cos(pose.pitch * DEG);
  const sp = Math.sin(pose.pitch * DEG);
  const cy = Math.cos(pose.yaw * DEG);
  const sy = Math.sin(pose.yaw * DEG);

  return function ray(px, py) {
    const ndcX = (px + 0.5) / width * 2 - 1;
    const ndcY = 1 - (py + 0.5) / height * 2;
    let x = ndcX * tanH;
    let y = ndcY * tanV;
    let z = -1;
    // pitch about X, then yaw about Y
    const y1 = y * cp - z * sp;
    const z1 = y * sp + z * cp;
    const x2 = x * cy + z1 * sy;
    const z2 = -x * sy + z1 * cy;
    const length = Math.hypot(x2, y1, z2);
    return [x2 / length, y1 / length, z2 / length];
  };
}

/** Row of the horizon in the reference framing, in pixels. */
export function horizonRow({ width = FRAME.width, height = FRAME.height, pose = POSE } = {}) {
  const tanV = Math.tan(pose.fov * DEG / 2);
  const ndcY = -Math.tan(pose.pitch * DEG) / tanV;
  void width;
  return (1 - ndcY) / 2 * height;
}

// Equirectangular convention, identical to the one three.js samples with:
// u wraps around Y starting from +X, v is the sine of the elevation. North
// (-Z) therefore lands at u = 0.25.
export function directionToUv(dir) {
  const u = Math.atan2(dir[2], dir[0]) / (2 * Math.PI) + 0.5;
  const v = Math.asin(Math.max(-1, Math.min(1, dir[1]))) / Math.PI + 0.5;
  return [u, v];
}

/**
 * Draws an equirect map through the reference camera.
 * rotationDeg spins the map about the vertical axis, so a chosen part of the
 * sky can be brought behind the framing.
 * @returns {Float32Array} linear RGB, three floats per pixel
 */
export function projectEquirect(map, { width, height, rotationDeg = 0, pose = POSE } = {}) {
  const ray = makeRay({ width, height, pose });
  const turn = rotationDeg * DEG;
  const ct = Math.cos(turn);
  const st = Math.sin(turn);
  const out = new Float32Array(width * height * 3);
  const rgb = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = ray(x, y);
      const dx = d[0] * ct + d[2] * st;
      const dz = -d[0] * st + d[2] * ct;
      const [u, v] = directionToUv([dx, d[1], dz]);
      sampleEquirect(map, u, v, rgb);
      const o = (y * width + x) * 3;
      out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2];
    }
  }
  return out;
}

/** Box filtered downscale of an equirect map, for the coarse passes. */
export function downsampleEquirect(map, width, height) {
  const data = new Float32Array(width * height * 3);
  const sx = map.width / width;
  const sy = map.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let j = y0; j < y1; j++) {
        for (let i = x0; i < x1; i++) {
          const o = (j * map.width + i) * 3;
          r += map.data[o]; g += map.data[o + 1]; b += map.data[o + 2]; n++;
        }
      }
      const o = (y * width + x) * 3;
      data[o] = r / n; data[o + 1] = g / n; data[o + 2] = b / n;
    }
  }
  return { width, height, data };
}

/** Bilinear sample of a float RGB equirect map, wrapping in u and clamping in v. */
export function sampleEquirect(map, u, v, out = [0, 0, 0]) {
  const { width, height, data } = map;
  const x = (u - Math.floor(u)) * width - 0.5;
  const y = (1 - v) * height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const y1 = Math.max(0, Math.min(height - 1, y0 + 1));
  const fx = x - x0;
  const fy = y - Math.floor(y);
  const xa = ((x0 % width) + width) % width;
  const xb = (xa + 1) % width;

  for (let c = 0; c < 3; c++) {
    const a = data[(y0 * width + xa) * 3 + c];
    const b = data[(y0 * width + xb) * 3 + c];
    const d = data[(y1 * width + xa) * 3 + c];
    const e = data[(y1 * width + xb) * 3 + c];
    out[c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
  }
  return out;
}
