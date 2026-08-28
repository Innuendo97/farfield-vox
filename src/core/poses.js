import { EYE_HEIGHT, SPAWN } from '../world/layout.js';

// Named camera setups used to compare the running scene against the reference
// framing. POSE_TARGET reproduces that framing exactly: same eye height, same
// slight upward tilt, same vertical field of view. Its values come from the
// same fit that produced the monolith placements in layout.js.

export const POSE_TARGET = {
  name: 'target',
  position: { x: 0, y: EYE_HEIGHT, z: SPAWN.z },
  yaw: 0,          // degrees, 0 == north
  pitch: 4.5,      // degrees, positive looks up
  fov: 45,         // vertical, degrees
};

export const POSE_SPAWN = {
  name: 'spawn',
  position: { x: SPAWN.x, y: EYE_HEIGHT, z: SPAWN.z },
  yaw: SPAWN.yaw,
  pitch: 0,
  fov: POSE_TARGET.fov,
};

export const DEFAULT_FOV = POSE_TARGET.fov;
