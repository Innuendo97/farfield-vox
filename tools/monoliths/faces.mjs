import { EYE_HEIGHT, MONOLITHS, SPAWN } from '../../src/world/layout.js';
import { FRAME, POSE } from '../grade/lib/framing.mjs';
import { floorAt } from './lib/pose.mjs';

// Where each face of each block lands in the reference framing.
//
// Every question this step has to answer about the stone — what colour a lit
// face is, how the light falls down it, whether an edge has moved — is a
// question about a rectangle of the reference image. That rectangle is not
// chosen by eye: it is the projection of a face the layout already fixes, so a
// measurement can never quietly land on the sky or on the block next door.

const DEG = Math.PI / 180;

// THE EYE, AT THE HEIGHT THE PAGE PUTS IT (E-V8i).
//
// This said `y: EYE_HEIGHT` and meant 1.70. EYE_HEIGHT is not an altitude: it
// is how far a walker's eye sits above his own FEET, and the pose these
// rectangles are drawn for -- POSE_TARGET, whose yaw, pitch and fov arrive
// through framing.mjs -- stands a walker at (0, SPAWN.z), where the floor is
// -0.1842. So the page's eye is at 1.5158 and this file's was 184 mm above it,
// which is 6.5 to 12 px of vertical mis-registration over the five blocks in
// frame. Every rectangle this file hands out is a window a colour is measured
// in, and on the flanks of 02 and 03 -- nine and ten pixels wide -- a slip that
// size is wider than the strip itself.
//
// The rule has one implementation and it is ./lib/pose.mjs, so this file and
// outline.mjs cannot drift into agreeing with each other while disagreeing with
// the frame.
const EYE = { x: 0, y: floorAt(0, SPAWN.z) + EYE_HEIGHT, z: SPAWN.z };

/** Reference camera projection: world metres to pixels of the framing. */
export function project(wx, wy, wz) {
  const aspect = FRAME.width / FRAME.height;
  const tanV = Math.tan(POSE.fov * DEG / 2);
  const tanH = tanV * aspect;
  const cp = Math.cos(-POSE.pitch * DEG);
  const sp = Math.sin(-POSE.pitch * DEG);
  const x = wx - EYE.x;
  const y = wy - EYE.y;
  const z = wz - EYE.z;
  const cy = y * cp - z * sp;
  const cz = y * sp + z * cp;
  return {
    x: (x / -cz / tanH * 0.5 + 0.5) * FRAME.width,
    y: (0.5 - cy / -cz / tanV * 0.5) * FRAME.height,
    depth: -cz,
  };
}

/**
 * The two faces of a block that the reference pose can see.
 *
 * Each is returned as a corner function taking face coordinates: s runs across
 * the face from its left screen edge, t runs up it from the ground. Which of
 * the east and west sides is visible follows from the yaw, so the caller never
 * has to know which way a block was turned.
 */
export function facesOf(monolith) {
  const [w, h, d] = monolith.size;
  const c = Math.cos(monolith.rotationY * DEG);
  const s = Math.sin(monolith.rotationY * DEG);
  const { x, z } = monolith.position;
  const at = (lx, lz, ly) => project(x + lx * c + lz * s, monolith.baseY + ly, z - lx * s + lz * c);

  // The engraved face is the local +Z one, and the visible flank is whichever
  // of +X and -X still turns toward the eye once the block is yawed.
  const toEye = [EYE.x - x, EYE.z - z];
  const east = (c * toEye[0] - s * toEye[1]) > 0 ? 1 : -1;

  return {
    front: {
      id: 'front',
      corner: (u, v) => at((u - 0.5) * w, d / 2, v * h),
      width: w,
      height: h,
    },
    side: {
      id: east > 0 ? 'east' : 'west',
      corner: (u, v) => at(east * w / 2, (0.5 - u) * east * d, v * h),
      width: d,
      height: h,
    },
  };
}

/** Screen rectangle covered by a patch of face coordinates. */
export function faceRect(face, u0, v0, u1, v1) {
  const points = [
    face.corner(u0, v0), face.corner(u1, v0), face.corner(u1, v1), face.corner(u0, v1),
  ];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    x0: Math.round(Math.min(...xs)),
    y0: Math.round(Math.min(...ys)),
    x1: Math.round(Math.max(...xs)),
    y1: Math.round(Math.max(...ys)),
  };
}

export const BLOCKS = MONOLITHS.filter((m) => m.id !== '06');
