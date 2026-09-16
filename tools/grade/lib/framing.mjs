import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { bearingOf, offAxisOf } from '../../../src/world/compass.js';

// Shared geometry between the reference image and the running scene.
//
// The reference framing is a real camera: an EYE, a yaw, a small upward tilt
// and a vertical field of view, all fixed in src/core/poses.js. Reproducing
// that projection offline is what makes it possible to ask "what is the sky
// doing in this exact direction" on both the reference image and a candidate
// sky, and to compare the two without ever guessing.
//
// AND THERE IS ONE PROJECTION OF IT NOW, WHICH IS projectorFor() BELOW.
// Until U-GRADE-1 there were four. makeRay() here carried the yaw; the three
// tools that project world METRES onto the frame did not, and each of them
// stood the eye somewhere else as well -- the stone mask both sky bakes read
// (target.mjs buildStoneMask), the face rectangles every stone colour is
// measured in (monoliths/faces.mjs) and the silhouette reader
// (terrain/silhouette.mjs). Two errors that partly cancel are still two
// errors; what this file owes the campaign is that there is now nowhere left
// to write a fifth.
//
// WHY THE COMPASS IS IMPORTED AND poses.js IS NOT, which looks inconsistent
// and is not: src/world/compass.js is a LEAF (E-CORNICE3) with no imports at
// all, so a build tool reaching it drags nothing in behind it, while poses.js
// pulls the whole world layout. And the bridge from an engine yaw to a bearing
// is exactly the minus sign this campaign has already paid for twice, so it is
// asked for by name rather than written out here for a fifth time.

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
//
// AND THE POSITION COMES WITH IT, WHICH IS THE OTHER HALF OF U-GRADE-1. Three
// angles are not a camera. While this file handed out only yaw, pitch and fov,
// every tool that needed an EYE had to invent one, and three of them invented
// the same wrong one -- the walker's sentinel resolved at (0, SPAWN.z), which
// is 0.599 m west, 0.117 m up and 0.215 m south of where the fit put the lens.
// So the six numbers travel together or they do not travel.
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
  // The position is read out of its own braces and not off the loose keys,
  // because `x:`, `y:` and `z:` are three of the commonest two-character
  // strings in a source file and a regex that hunts them across a whole block
  // will one day find a comment instead of a camera.
  //
  // POSE_TARGET's own braces say `{ ...DAY_FIT.position }` -- a copy and not a
  // camera -- so a body that does not carry all three axes is not an answer,
  // it is the spread again, and the reader follows it exactly as `number` does.
  const position = (() => {
    const axesOf = (text) => {
      const body = /position:\s*\{([^}]*)\}/.exec(text || '');
      if (!body) return null;
      const out = {};
      for (const key of ['x', 'y', 'z']) {
        const hit = new RegExp(`\\b${key}:\\s*(-?[0-9.]+)`).exec(body[1]);
        if (!hit) return null;
        out[key] = Number(hit[1]);
      }
      return out;
    };
    const found = axesOf(block) || axesOf(from);
    if (!found) throw new Error('position not found in POSE_TARGET');
    return found;
  })();
  return { position, yaw: number('yaw'), pitch: number('pitch'), fov: number('fov') };
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

/**
 * THE PROJECTION OF THE REFERENCE CAMERA: world metres to the frame.
 *
 * The inverse of makeRay above, and the one place a world POINT is turned into
 * a column and a row. Everything this campaign measures on the reference
 * picture -- the stone mask both sky bakes subtract, the rectangles the stone's
 * colours are read in, the edges the silhouette reader hunts for -- is a
 * rectangle chosen by this function, so the day it is wrong every one of those
 * readings is wrong together and none of them can catch it.
 *
 * WHAT IT IS, IN WORDS. A point's direction is a BEARING (compass.js: nought at
 * north, positive east) and the camera's axis is at the bearing `-yaw`, so the
 * point stands `offAxisOf(bearing, yaw)` degrees right of the axis. That named
 * bridge is the whole of what was missing: written without it -- or not written
 * at all, which is the same thing as writing `yaw = 0` -- a feature lands twice
 * the yaw away, and at 1.818 degrees on a 1158.5 px focal that is 36.8 px of
 * frame. Then the distance out of the picture and the height above the eye
 * finish the camera, and the pitch tips it up.
 *
 * THE UNITS ARE CONTINUOUS FRAME COORDINATES, not pixel indices: pixel i spans
 * [i, i+1) and its centre is i + 0.5. A caller that wants the index of the
 * pixel a point falls in takes the floor; a caller comparing against a pixel
 * CENTRE subtracts a half. Said here because the tools were split between the
 * two conventions and a half pixel is not worth a second argument about which.
 *
 * @param {object} [pose]  a camera with position/yaw/pitch/fov; the fit by default
 * @param {number} [width] frame width in pixels
 * @param {number} [height] frame height in pixels
 * @returns {(wx:number, wy:number, wz:number) => ({x:number,y:number,depth:number}|null)}
 *   null when the point is behind the lens
 */
export function projectorFor({ pose = POSE, width = FRAME.width, height = FRAME.height } = {}) {
  if (!pose || !pose.position) throw new Error('a projection needs a pose with a position');
  const tanV = Math.tan(pose.fov * DEG / 2);
  const tanH = tanV * (width / height);
  const cp = Math.cos(pose.pitch * DEG);
  const sp = Math.sin(pose.pitch * DEG);
  const eye = pose.position;

  return function project(wx, wy, wz) {
    const dx = wx - eye.x;
    const dy = wy - eye.y;
    const dz = wz - eye.z;
    // THE BRIDGE, ASKED FOR BY NAME. An unnamed minus sign in the middle of a
    // projection is exactly what was wrong for three sessions.
    const off = offAxisOf(bearingOf(dx, dz), pose.yaw) * DEG;
    const out = Math.hypot(dx, dz);
    const x = out * Math.sin(off);
    const along = -out * Math.cos(off);
    const y = dy * cp + along * sp;
    const z = -dy * sp + along * cp;
    if (z > -1e-6) return null;
    return {
      x: (x / -z / tanH * 0.5 + 0.5) * width,
      y: (0.5 - y / -z / tanV * 0.5) * height,
      depth: -z,
    };
  };
}

/** The reference camera's own projection, for the callers that want no options. */
export const projectTarget = projectorFor();

/**
 * THE EXACT INVERSE OF makeRay: a world DIRECTION back to the pixel it came out
 * of, in pixel indices -- `makePixel()(makeRay()(px, py))` returns (px, py).
 *
 * A direction and not a point, because the sky has no distance: the bakes that
 * cut the reference into cloud tiles and the one that fits the dome work
 * entirely in directions, and handing them projectorFor would make them invent
 * a radius to put the sky at.
 *
 * IT IS A SEPARATE FUNCTION AND THE SAME LAW. Both were written out by hand in
 * three places before U-GRADE-1, and in one of them -- bake-sprites.mjs, which
 * cuts the cloud atlas -- the ray carried the yaw and the projection back did
 * not, so a direction did not return to the pixel it came from: 36.8 px out at
 * the middle of the frame and 58.8 at the corner, measured. The two halves of a
 * round trip belong in one file, next to each other, where that cannot be true
 * and go unnoticed.
 *
 * @returns {(d:number[]) => (number[]|null)} [px, py], or null behind the lens
 */
export function makePixel({ width = FRAME.width, height = FRAME.height, pose = POSE } = {}) {
  const tanV = Math.tan(pose.fov * DEG / 2);
  const tanH = tanV * (width / height);
  const cp = Math.cos(pose.pitch * DEG);
  const sp = Math.sin(pose.pitch * DEG);

  return function pixel(d) {
    // The same named bridge as projectorFor, on a direction instead of an
    // offset: a direction IS an offset, from an eye at the origin.
    const off = offAxisOf(bearingOf(d[0], d[2]), pose.yaw) * DEG;
    const out = Math.hypot(d[0], d[2]);
    const x = out * Math.sin(off);
    const along = -out * Math.cos(off);
    const y = d[1] * cp + along * sp;
    const z = -d[1] * sp + along * cp;
    if (z >= -1e-6) return null;
    return [
      (x / -z / tanH * 0.5 + 0.5) * width - 0.5,
      (0.5 - y / -z / tanV * 0.5) * height - 0.5,
    ];
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
