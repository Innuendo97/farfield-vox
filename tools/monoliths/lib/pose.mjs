import { EYE_HEIGHT } from '../../../src/world/layout.js';
import { builtHeightAt, groundHeightAt } from '../../../src/world/contracts.js';

// A NAMED POSE, RESOLVED THE WAY THE PAGE RESOLVES IT.
//
// `y === EYE_HEIGHT` IS A SENTINEL AND NOT AN ALTITUDE. E-V8h.3 settled it and
// src/core/player.js implements it: EYE_HEIGHT is how far a walker's eye sits
// above his own FEET, so a pose that writes it is standing a walker somewhere
// and how high that puts the eye is the ground's business. Every other y is an
// absolute height and is obeyed to the millimetre.
//
// SIX OF THE EIGHT NAMED POSES CARRY THE SENTINEL -- target, spawn, ripido-60,
// mano-15, picco-85, bordo-indietro -- and every offline tool that projected
// from one of them put the eye at 1.70 while the page put it at ground + 1.70.
// At POSE_TARGET the ground is -0.1842, so the page's eye is at 1.5158 and the
// tools' was 184 mm above it. That is not a rounding: measured over five
// monolith corners at that pose it is 6.5 to 12 px of vertical registration,
// against a stone mask whose whole safety margin is ten.
//
// SO THE RULE HAS ONE IMPLEMENTATION AND THE TOOLS READ IT. Written twice it
// would drift, and the drift would be invisible -- the tools would go on
// agreeing with each other and disagreeing with the frame, which is exactly the
// shape the defect already came in.
//
// AND THE FLOOR IS THE COMPOSED ONE, because that is the floor the walker
// stands on: src/world/hub.js takes the greater of the meadow and the worked
// stone, so a pose standing on the platform resolves onto the platform. At
// POSE_TARGET the two agree -- there is no built stone at (0, 14) and
// builtHeightAt answers -Infinity there -- so nothing about the numbers below
// depends on the composition; it is there so that a pose put on the stair does
// not quietly resolve into it.

/** The floor under a point, as the page composes it. */
export function floorAt(x, z) {
  return Math.max(groundHeightAt(x, z), builtHeightAt(x, z));
}

/**
 * Whether a pose is standing a walker rather than naming an altitude.
 *
 * Identity against EYE_HEIGHT and not a tolerance: the sentinel is the CONSTANT
 * itself, written into the pose by name, and a pose that happens to want an
 * absolute 1.70 m would be a different statement with the same number. That is
 * the price of a sentinel and src/core/player.js pays it in the same coin.
 */
export const isSentinel = (pose) => pose.position.y === EYE_HEIGHT;

/**
 * A pose with its y resolved: the walker's law where the sentinel is written,
 * the altitude as given everywhere else.
 *
 * @param {object} pose one of src/core/poses.js
 * @returns {object} a copy, never the seat itself
 */
export function resolvePose(pose) {
  if (!pose) return pose;
  const { x, z } = pose.position;
  const y = isSentinel(pose) ? floorAt(x, z) + EYE_HEIGHT : pose.position.y;
  return { ...pose, position: { x, y, z } };
}

/** What the resolution did, for a tool that has to say so in its own print. */
export function poseNote(pose) {
  if (!pose) return '';
  if (!isSentinel(pose)) {
    return `y ${pose.position.y.toFixed(4)} is an altitude and is obeyed as one`;
  }
  const floor = floorAt(pose.position.x, pose.position.z);
  return `y is the sentinel: floor ${floor.toFixed(4)} + eye ${EYE_HEIGHT} `
    + `= ${(floor + EYE_HEIGHT).toFixed(4)}, not ${EYE_HEIGHT}`;
}
