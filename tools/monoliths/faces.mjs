import { MONOLITHS } from '../../src/world/layout.js';
import { POSE, projectTarget } from '../grade/lib/framing.mjs';

// Where each face of each block lands in the reference framing.
//
// Every question this step has to answer about the stone — what colour a lit
// face is, how the light falls down it, whether an edge has moved — is a
// question about a rectangle of the reference image. That rectangle is not
// chosen by eye: it is the projection of a face the layout already fixes, so a
// measurement can never quietly land on the sky or on the block next door.

const DEG = Math.PI / 180;

// THE CAMERA, AND IT IS THE FITTED ONE, WHOLE (U-GRADE-1).
//
// THE HEADER ABOVE THIS USED TO SAY the yaw arrived "through framing.mjs". It
// did not: this file built its own projection out of POSE's pitch and fov and
// dropped the yaw on the floor, which is the same statement as "the camera
// looks north" and is false by 1.818 degrees -- 36.8 px of frame at this
// focal. It also stood the eye at the WALKER's sentinel, (0, floor + 1.70,
// SPAWN.z), where the fit stands the lens at (0.599, 1.583, 14.215): 0.599 m
// west, 0.117 m up and 0.215 m short. The two errors ran in opposite
// directions and PARTLY cancelled -- the silhouette centres of the five blocks
// came out 23.3, 15.0, 15.3, 0.5 and 1.8 px from the reference's own, where the
// missing yaw alone would have been 36.8 -- which is why this survived three
// sessions of people looking straight at it.
//
// Both are gone in one statement, because half of this correction is worse
// than none: with the yaw put back and the walker's eye left in place the near
// block moves the wrong way. The projection is now framing.mjs's
// projectTarget, which is the ONLY one in the campaign's tools, and this file
// has no arithmetic of its own to disagree with it.
//
// WHAT WENT WITH IT. ./lib/pose.mjs and its floorAt are no longer imported
// here: the sentinel rule is about standing a WALKER somewhere, and this file
// no longer stands one -- it uses the lens the picture was fitted with, whose
// y is an altitude and not a body. outline.mjs still owns that rule and still
// needs it, for the poses that really are walkers.
const EYE = POSE.position;

/** Reference camera projection: world metres to pixels of the framing. */
export const project = projectTarget;

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
