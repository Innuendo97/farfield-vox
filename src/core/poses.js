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

// THE TWO THE CAMPAIGN IS JUDGED AT: the framings of the two target pictures.
//
// FITTED, NOT CHOSEN. Five numbers -- where the eye stands on the plane, where
// it looks, how wide it sees -- were solved against the SILHOUETTES of the five
// blocks in each picture. The blocks themselves did not move: they are the least
// squares reconstruction layout.js already carried, and letting them move would
// have been fitting the world to the camera instead of the camera to the world.
//
// The residual is part of the pose and is written down with it. It is not small
// because these pictures are not renders of this world: block 04 is drawn
// narrower than it is built and block 02 is drawn wider, so a few points on
// each carry twenty pixels that no camera can take out. What the fit reproduces
// is the FRAMING -- which block stands where, how big, how far apart -- and that
// is what these two poses are for. The CONTENT will differ; that is the
// campaign's work and not the pose's.
//
// THE SIXTH NUMBER IS NOT FITTED, BECAUSE IT CANNOT BE. The blocks stand fifteen
// to thirty metres out, and over two metres of camera altitude they say the same
// thing: lower the eye and the camera walks backwards and narrows its field to
// match, and the residual does not move. So the pictures cannot say how high the
// camera was; and since the figure in front of it is only ever measured against
// that camera, they cannot say how tall the figure is either.
//
// SO THE FIGURE IS FIXED FROM OUTSIDE, AT 1.80 m, AND IT PINS THE CAMERA. It is
// the walker's own body: his eye is at EYE_HEIGHT and his crown one world cell
// above it, which is eighteen cells to the top of the head and fifty four of the
// finer cells the figure itself is built from. First and third person are the
// same body, which is why the height is a decision taken once and not a reading
// taken twice.
//
// With the figure held there the altitude is no longer free: it is the one that
// makes the span between the crown row and the sole row of each picture measure
// 1.80 m. It is read off the TREND of figure height against camera altitude
// across a swept window rather than off any single fit, because the residual is
// flat along that window and the difference between neighbouring fits is the
// search's own noise -- which leaves the altitude good to about a centimetre by
// day and two and a half by night, and no better. A 1.80 m box standing where
// each pose puts the figure then spans 0.381 (day) and 0.384 (night) of the
// frame, against the 0.383 both pictures draw.

export const POSE_VOX_DAY = {
  name: 'vox-giorno',
  // rms 8.02 px, median 6.4 px, over 81 silhouette points on the five blocks
  position: { x: 0.599, y: 1.583, z: 14.215 },
  yaw: 1.818,
  pitch: 4.124,
  fov: 44.199,
};

export const POSE_VOX_NIGHT = {
  name: 'vox-notte',
  // rms 6.78 px, median 3.9 px, over 82 points. Fitted with its own thresholds:
  // the night target's sky reads 10 to 30 where the day's reads 70 to 200, so a
  // silhouette there is a step of a dozen levels and not of a hundred.
  position: { x: -1.750, y: 1.330, z: 14.921 },
  yaw: -2.854,
  pitch: 4.543,
  fov: 44.462,
};

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
  POSE_VOX_DAY, POSE_VOX_NIGHT,
].map((pose) => [pose.name, pose]));

export const DEFAULT_FOV = POSE_TARGET.fov;
