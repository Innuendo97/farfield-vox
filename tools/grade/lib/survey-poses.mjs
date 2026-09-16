import { POSE } from './framing.mjs';

// The poses a sky is surveyed from, and why there are twenty eight of them.
//
// One pose proves nothing about a sky. The reference framing is a forty five
// degree window on one bearing, and every defect this campaign has had to pay
// for was invisible from it: a seam that only opens when the walker turns, a
// cavity behind the shoulder, a ceiling that reads clean ahead and bare
// overhead. So the measures that judge weather run over a fixed set of
// viewpoints, and the set is fixed so that two deliveries can be compared
// instead of two choices of where to look.
//
// The groups are what they measure, not decoration:
//
//   * the reference framing and the wide look from the spawn — what the client
//     has approved and what a visitor sees first;
//   * eight bearings at a walker's pitch — the full turn, including the
//     quadrants behind, where coverage is easiest to leave empty;
//   * seven upward poses — overhead is a separate sky and reads nothing like
//     the horizon band. Eighty five is the engine's own pitch limit;
//   * eight close and lateral poses — the framings the client's own defect
//     reports came from, which is why they are here and not a rounder number;
//   * three poses aimed low — the stone of the path from close above, the
//     distant lakes of src/world/distant.js across the meadow, and the sheen
//     off a monolith. What a surface throws back is a different chain from what
//     stands in front of the eye and fails separately.
//
//     This group used to be described as "what the water and the stone reflect",
//     and two thirds of that has gone stale. The water in the PATH never existed
//     — the pale stretch is light on stone, ruled 2026-08-20 — and the pose that
//     looked for it is now `sentiero-a-picco`, below. The lakes are real and far
//     away, so `riflesso-laghi` keeps its name honestly. And `riflesso-pietra`
//     is not aimed down at all: it looks slightly up at a face, which is where
//     the stone's sheen actually is.
//
// Positions are metres in the world's own basis and the eye height is the
// player's, so a pose here is a place a walker can stand rather than a camera
// hung in the air.
export const SURVEY_POSES = {
  // THE REFERENCE FRAMING IS NOT WRITTEN DOWN HERE, IT IS ASKED FOR
  // (U-GRADE-1). What stood on this line was `{ x: 0, z: 14, yaw: 0, pitch:
  // 4.5, fov: 45 }` -- the five round numbers U-SENT-6 proved were never the
  // camera the picture was fitted at -- and the check at the foot of this file
  // caught it and THREW, which is what it was written to do. Nobody heard it:
  // this module is not in the guard suite, so from the day the fit landed
  // (E-SENT6) until U-GRADE-1 `check-sky-zones.mjs` and `measure-purity.mjs`
  // did not load at all. A copy that can go stale is a copy that will, so the
  // entry is now built from the fit and there is nothing left here to go stale.
  // Its `y` is written too, and is an ALTITUDE: the poses below stand a walker
  // and let the page put his eye where his feet are, this one is a lens.
  'posa-P': {
    x: POSE.position.x,
    y: POSE.position.y,
    z: POSE.position.z,
    yaw: POSE.yaw,
    pitch: POSE.pitch,
    fov: POSE.fov,
  },
  largo: { x: 0, z: 14, yaw: 0, pitch: 10, fov: 72 },

  'b-000': { x: 0, z: 14, yaw: 0, pitch: 8, fov: 72 },
  'b-045': { x: 0, z: 14, yaw: 45, pitch: 8, fov: 72 },
  'b-090': { x: 0, z: 14, yaw: 90, pitch: 8, fov: 72 },
  'b-135': { x: 0, z: 14, yaw: 135, pitch: 8, fov: 72 },
  'b-180': { x: 0, z: 14, yaw: 180, pitch: 8, fov: 72 },
  'b-225': { x: 0, z: 14, yaw: 225, pitch: 8, fov: 72 },
  'b-270': { x: 0, z: 14, yaw: 270, pitch: 8, fov: 72 },
  'b-315': { x: 0, z: 14, yaw: 315, pitch: 8, fov: 72 },

  'z60-000': { x: 0, z: 14, yaw: 0, pitch: 60, fov: 72 },
  'z60-090': { x: 0, z: 14, yaw: 90, pitch: 60, fov: 72 },
  'z60-180': { x: 0, z: 14, yaw: 180, pitch: 60, fov: 72 },
  'z60-270': { x: 0, z: 14, yaw: 270, pitch: 60, fov: 72 },
  'z75-000': { x: 0, z: 14, yaw: 0, pitch: 75, fov: 72 },
  'z85-000': { x: 0, z: 14, yaw: 0, pitch: 85, fov: 72 },
  'z85-180': { x: 0, z: 14, yaw: 180, pitch: 85, fov: 72 },

  'lat-ovest': { x: -12, z: 14, yaw: 0, pitch: 4.5, fov: 45 },
  'lat-est': { x: 12, z: 14, yaw: 0, pitch: 4.5, fov: 45 },
  'vicino-est-alto': { x: 12, z: -4, yaw: 25, pitch: 14, fov: 45 },
  'vicino-ovest-alto': { x: -12, z: -4, yaw: -30, pitch: 16, fov: 45 },
  'bordo-est-40': { x: 12, z: -4, yaw: 70, pitch: 40, fov: 45 },
  'bordo-ovest-40': { x: -12, z: -4, yaw: -70, pitch: 40, fov: 45 },
  'bordo-nord-30': { x: 0, z: -14, yaw: 0, pitch: 30, fov: 45 },
  'bordo-sud-30': { x: 0, z: 26, yaw: 180, pitch: 30, fov: 45 },

  // There was a 'riflesso-rivolo' here, looking down at a run of water along
  // the path. There is no water along the path: it was a misreading of the
  // reference and it was taken out on 2026-08-20. The standing place is kept
  // under its own name, because looking straight down at the stone from close
  // up is worth a frame whatever is on it.
  'sentiero-a-picco': { x: 0, z: 10, yaw: 0, pitch: -25, fov: 45 },
  'riflesso-laghi': { x: 0, z: 14, yaw: 0, pitch: -1, fov: 45 },
  'riflesso-pietra': { x: 3, z: 6, yaw: -8, pitch: 6, fov: 45 },
};

/** Which of these is the reference framing, so no reader has to know the name. */
export const REFERENCE_POSE = 'posa-P';

// And the one entry that is not free to be whatever this file says.
//
// `posa-P` IS the reference framing, which the runtime already declares in
// src/core/poses.js and which every offline measure reads from there through
// framing.mjs. Two copies of one camera is the defect that made an earlier
// purity reading meaningless — it measured with the reference geometry a frame
// taken at a different pitch and field of view — so the copy is checked against
// the original at import time rather than trusted to stay in step.
{
  const reference = SURVEY_POSES[REFERENCE_POSE];
  for (const key of ['yaw', 'pitch', 'fov']) {
    if (reference[key] !== POSE[key]) {
      throw new Error(`${REFERENCE_POSE} has ${key} ${reference[key]} against ${POSE[key]} in src/core/poses.js`);
    }
  }
  // And the EYE, which this check did not look at while the entry carried no
  // eye at all: a pose with the fit's three angles and the spawn's two
  // coordinates is still two cameras, and 0.599 m of it is sideways.
  for (const key of ['x', 'y', 'z']) {
    if (reference[key] !== POSE.position[key]) {
      throw new Error(`${REFERENCE_POSE} has ${key} ${reference[key]} against ${POSE.position[key]} in src/core/poses.js`);
    }
  }
}

/**
 * The pose of a given name, refusing to guess.
 *
 * A miss throws rather than falling back to the reference framing: falling back
 * is exactly how a survey ends up measuring twenty six poses with one pose's
 * geometry and reporting the result as if it meant something.
 */
export function surveyPose(name) {
  const pose = SURVEY_POSES[name];
  if (!pose) throw new Error(`no survey pose named "${name}"`);
  return pose;
}
