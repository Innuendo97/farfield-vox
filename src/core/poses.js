import { EYE_HEIGHT, SPAWN } from '../world/layout.js';
import { pathCentreX } from '../world/terrain-field.js';

// Named camera setups used to compare the running scene against the reference
// framing. POSE_TARGET reproduces that framing exactly: same eye height, same
// slight upward tilt, same vertical field of view. Its values come from the
// same fit that produced the monolith placements in layout.js.
//
// A POSE IS NOT A CONVENIENCE, IT IS THE UNIT OF EVIDENCE. Every judgement this
// campaign makes is a pair of frames at the same pose before and after a
// change, and a pose reached by hand is not the same pose twice: a pixel of
// mouse is a twentieth of a degree, and the sky is argued over in tenths. So
// they are written down, once, here.

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

// ---------------------------------------------------------------------------
// THE FOUR THE PIVOT WAS MEASURED AT, carried over verbatim from the demo that
// measured them. They are here rather than in a measuring script because they
// are what the campaign now judges cost and size on, and a pose that lives in a
// harness is a pose the next harness reinvents slightly differently.
//
// EACH ONE EARNS ITS PLACE BY BEING A WORST CASE OF SOMETHING, and none of them
// is a pretty view. That is the point: the reference pose is the one the
// picture is fitted at, and a world that is only ever measured there is a world
// whose failures all live one step to the side of it.

// Steeply down at the paving, from beside the run. The pose the campaign
// already judged the ground's near material at.
export const POSE_STEEP_60 = {
  name: 'ripido-60',
  // On the path's own centreline at that depth, taken from the one seat that
  // says where the path runs rather than from a number copied out of it.
  position: { x: pathCentreX(5), y: EYE_HEIGHT, z: 5 },
  yaw: 0,
  pitch: -60,
  fov: POSE_TARGET.fov,
};

// The ground at a metre and a half, in the middle of the frame: the first half
// of the uncomfortable proof about how big a cube reads in the first person.
// Standing on the meadow and clear of the paving, because what is measured
// there is the size of a cube and not the size of a slab.
export const POSE_HAND_15 = {
  name: 'mano-15',
  position: { x: 2.5, y: EYE_HEIGHT, z: 8 },
  yaw: 0,
  // Not a round number and not a taste: it is the depression that puts the
  // middle of the frame on ground 2.27 m away, which is a metre and a half in
  // front of the walker's own feet.
  pitch: -48.6,
  fov: POSE_TARGET.fov,
};

// The steepest a walker is allowed to look, which PITCH_LIMIT puts at eighty
// five degrees. The second half of the same proof, and the worst case for it.
export const POSE_PEAK_85 = {
  name: 'picco-85',
  position: { x: 2.5, y: EYE_HEIGHT, z: 8 },
  pitch: -85,
  yaw: 0,
  fov: POSE_TARGET.fov,
};

// THE POSE THE CAMPAIGN HAD NEVER MEASURED before the pivot, and the worst case
// for the shape of the world by construction: at the rim of the voxel ground,
// looking back across the whole hub with the distance in frame. The most cubes
// on screen at once, the shell behind them, and the join between the two in the
// middle of the picture where it cannot be missed.
export const POSE_RIM_BACK = {
  name: 'bordo-indietro',
  position: { x: 0, y: EYE_HEIGHT, z: -12.5 },
  yaw: 180,
  pitch: -6,
  fov: POSE_TARGET.fov,
};

// THE TWO THE LIGHT WILL BE FITTED AT ARE NOT HERE YET.
//
// POSE_VOX_DAY and POSE_VOX_NIGHT are the framings of the two target images,
// and they come out of fitting a camera to each picture rather than out of a
// preference. That fit belongs to the unit that refits the light, because the
// same measurement produces both -- a sun angle read off a shadow is read off a
// frame whose camera you have already had to solve.
//
// Left as a written gap rather than as a guess. A placeholder pose with plausible
// numbers in it is worse than none: it would be photographed, compared, and
// believed.
//
//   export const POSE_VOX_DAY = { ... };    // from the fit on the day target
//   export const POSE_VOX_NIGHT = { ... };  // from the fit on the night target

/**
 * Every pose that has a name, by that name.
 *
 * A register and not a list, so a harness outside the page can ask for one by
 * the same string the verbale calls it. Nothing here is discovered: adding a
 * pose above and forgetting it here is the one mistake this makes impossible,
 * because the register is built from the poses rather than written beside them.
 */
export const POSES = Object.fromEntries([
  POSE_TARGET, POSE_SPAWN, POSE_STEEP_60, POSE_HAND_15, POSE_PEAK_85, POSE_RIM_BACK,
].map((pose) => [pose.name, pose]));

export const DEFAULT_FOV = POSE_TARGET.fov;
