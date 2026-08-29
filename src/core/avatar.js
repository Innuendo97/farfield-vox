// THE AVATAR, AND THE CAMERA THAT EXISTS BECAUSE HE DOES.
//
// Nothing here draws him — the voxel body is DEV-V8b's, and it will read its
// proportions from the block at the top of this file rather than carry a second
// copy of them. What is here is the arithmetic: how big he is, and where a
// camera behind him stands.
//
// WHY THE CAMERA LIVES WITH THE AVATAR AND NOT WITH THE OPTICS. src/core/eye.js
// is the optics in front of the eye — focus, adaptation, the sun on the glass —
// and it does not care where the eye is. This is the other half: where the eye
// STANDS, which in third person is a fact about the body it is looking at. The
// walker in src/core/player.js still owns the one door that puts the camera in
// the scene; it asks this file where to put it.

// --------------------------------------------------------------- the body
//
// H = 1.80 m, AND IT IS A DECISION RATHER THAN A READING. The two reference
// pictures cannot say how tall he is: over two metres of camera altitude the
// blocks say the same thing, so altitude and figure height trade off along a
// flat valley and the residual never picks a point on it. What the pictures DO
// say is a ratio — the figure fills 0.383 of the frame from a camera 5.9 to 6.0
// m behind — and a ratio needs one number from outside to become metres.
//
// The number from outside is the walker himself: his eye is at EYE_HEIGHT and
// his crown one world cell above it. That closes on integers in both grids at
// once, which is the check that it was not chosen for taste — 1.85 m would put
// him on half a cell of each, and a body made of voxels cannot be 55.5 voxels
// tall.
export const AVATAR = {
  /** Metres, sole to crown. */
  height: 1.80,
  /** The same, in cells of the world's own 0.10 m grid. Exact. */
  worldCells: 18,
  /** And in cells of his own, which are a third of the world's. Exact. */
  cells: 54,
  /** One of his cells, in metres: 0.0333... */
  get cell() { return this.height / this.cells; },
};

// ------------------------------------------------------------ the framing
//
// THE RULE IS IN UNITS OF H, WHICH IS WHY IT SURVIVED THE SCALE CHANGING.
// These are the mean of the two pictures, measured against the block
// silhouettes and re-derived once H was fixed at 1.80 m. The earlier numbers in
// circulation — 2.70 H behind, 1.19 H up, fov ~52 — were the same METRES
// divided by an H of 2.29 to 2.49, and they do not apply to a walker-sized
// figure. The metres barely moved; the ratios did.
//
// ONE RULE FOR BOTH PICTURES, AND THAT IS THE CLAIM BEING MADE. The two
// disagree about how steeply the camera looks down — 1.9 degrees, which is 40
// px of crown — so no single rule can sit on both readings. This one is their
// mean, and what it has to earn is landing inside the tolerance that
// disagreement itself sets: 20 px on the crown row, 2 degrees of depression.
// It does, with a pixel to spare. NOBODY TIGHTENS THOSE TOLERANCES WITHOUT
// REDOING THE RULE: the depression already diverges 1.90 of its 2 degrees.
export const RIG = {
  /** Planar distance from the avatar to the camera, in heights. */
  planar: 3.30,
  /** How far the camera's eye is above the avatar's FEET, in heights. */
  aboveFeet: 0.99,
  /** How far the avatar sits to the LEFT of the camera's axis, in heights. */
  lateral: 0.455,
  /** Vertical field of view, degrees. Half a degree off DEFAULT_FOV. */
  fov: 44.3,
  // THE PITCH THE RULE BELONGS TO, and it has to be said out loud because the
  // rule is an OFFSET and an offset only means something at a stated aim. Both
  // pictures were fitted looking slightly up — 4.124 and 4.543 degrees — so the
  // offset above is the offset AT that aim, and the boom swings from there
  // rather than from the horizontal.
  //
  // THE PICTURES CANNOT SETTLE THIS, and that is the honest position: they sit
  // four tenths of a degree apart, so they measure the boom at one aim and say
  // nothing about how it should move away from it. Reading the offset as
  // belonging to their own aim is the only one of the two readings that
  // reproduces both pictures exactly; the alternative — that the offset belongs
  // to the horizontal and the pictures already contain 4.3 degrees of swing —
  // is not excluded by anything measured. Declared as a residual, not resolved.
  pitch: 4.3335,
};

/**
 * The rule as metres, in the frame the walker faces.
 *
 * `behind` is the along-axis component and not the whole distance: the rule
 * names the PLANAR distance, and the lateral offset is one leg of it, so the
 * other leg is what a camera directly astern would have to be.
 *
 * The camera sits to the avatar's RIGHT, which is what puts the avatar to the
 * camera's LEFT — the two pictures both draw him left of the middle, at u 0.40.
 */
export function rigMetres(height = AVATAR.height) {
  const planar = RIG.planar * height;
  const lateral = RIG.lateral * height;
  return {
    behind: Math.sqrt(Math.max(0, planar * planar - lateral * lateral)),
    lateral,
    above: RIG.aboveFeet * height,
    planar,
  };
}

// ---------------------------------------------------------------- the arm
//
// THE PIVOT IS THE AVATAR'S EYE, and it is chosen rather than measured. The
// pictures fix the OFFSET — behind, beside, above — and any pivot with the same
// offset draws the same frame, so they say nothing about where along the body
// it sits. What decides it is the switch: first person is the avatar's eye, so
// an arm that retracts toward the eye arrives there with the accumulated yaw
// and pitch intact and without the world sliding sideways on the last frame.
//
// From that pivot the arm is very nearly horizontal — 5.94 m out and 0.08 m up
// — which is the shape a boom wants to be. From a pivot at half height it would
// leave at 9.5 degrees, and every degree of that is a degree the retraction has
// to give back.
//
// AND A RIGID ARM CANNOT HONOUR PITCH_LIMIT, which is why this shortens.
// PITCH_LIMIT is 85 degrees and it was written for an eye that turns on the
// spot. Swing six metres of boom through it and the camera is 7.3 m up at one
// end — over the stair platform, and inside a block if the walker is near one —
// and UNDER THE GROUND before 15 degrees at the other. The arm therefore
// retracts as the look leaves the horizontal, and the place it finishes
// retracting is first person, where there is no arm to collide with anything.
//
// THE CURVE IS PROVISIONAL AND SAYS SO. Linear in |pitch| is the simplest law
// that provably reaches zero exactly at the limit; it is not claimed to be the
// right FEEL, because feel is not something this unit measured. What is
// measured is what it does — v8-avatar/dev-a/prova-braccio.txt sweeps the whole
// range and reports clearance at every degree. E-V8c is open on purpose: it
// gets closed with those numbers in front of somebody, not by this comment.
const DEG = Math.PI / 180;

/**
 * How much of the arm is left at a given pitch: all of it at the aim the rule
 * was measured at, none of it at either limit.
 *
 * ANCHORED AT THE RULE'S OWN AIM AND NOT AT THE HORIZONTAL, which matters more
 * than it looks: the framing sits 4.33 degrees above level, so a retraction
 * measured from level would already have taken five per cent off the arm in the
 * one place the arm is supposed to be exactly right — thirty centimetres, at
 * the two poses the whole campaign is judged on.
 *
 * That makes the two halves different lengths, and they should be: there are 81
 * degrees of looking up left before the limit and 89 of looking down.
 *
 * @param {number} pitch    radians, positive looks up
 * @param {number} limit    radians; PITCH_LIMIT, passed in rather than copied
 * @param {number} rest     radians; the aim the rule belongs to
 */
export function armFraction(pitch, limit, rest = RIG.pitch * DEG) {
  if (!(limit > 0)) return 1;
  const span = pitch > rest ? limit - rest : limit + rest;
  if (!(span > 0)) return 1;
  return 1 - Math.min(1, Math.abs(pitch - rest) / span);
}

/**
 * Where the third person camera stands, in world metres.
 *
 * THE CAMERA IS NOT AIMED AT THE AVATAR AND MUST NOT BE. It carries the
 * walker's own yaw and pitch, and the avatar lands where the offset puts him —
 * left of the middle and low in the frame, which is where both pictures draw
 * him. A lookAt on the head would centre him and miss the framing by two
 * hundred pixels. This function answers WHERE ONLY; the aim stays the walker's.
 *
 * The arm swings with pitch, as a boom does: look down and the camera rises
 * behind the shoulder, look up and it drops. Both ends are governed — by the
 * retraction above, and then by the ground, because a camera that has gone
 * under the world shows the inside of it.
 *
 * @param {object} out       written into; no allocation a frame
 * @param {object} body      { x, z, stance, yaw } of the walker
 * @param {number} pitch     radians, positive looks up
 * @param {number} limit     PITCH_LIMIT in radians
 * @param {function} ground  (x, z) -> the height of anything solid there
 * @param {number} height    the avatar's height in metres
 */
export function thirdPersonEye(out, body, pitch, limit, ground, height = AVATAR.height) {
  const rig = rigMetres(height);
  // The pivot: the avatar's own eye, one crown-to-eye below the top of him.
  const pivotY = body.stance + (height - EYE_TO_CROWN);
  const k = armFraction(pitch, limit);

  // The arm at rest, from that pivot: almost flat, and its lateral leg goes
  // with it so that a retracted arm has no sideways offset left to cancel.
  const flatBehind = rig.behind * k;
  const flatLateral = rig.lateral * k;
  const rise = (body.stance + rig.above - pivotY) * k;
  const armPlanar = Math.hypot(flatBehind, flatLateral);
  const armLength = Math.hypot(armPlanar, rise);

  // Swing it. The arm leaves the pivot at its own small angle; pitching the
  // look away from the aim the rule was measured at rotates the whole boom the
  // other way, so looking down lifts the camera behind the shoulder.
  const rest = Math.atan2(rise, armPlanar);
  const swung = rest - (pitch - RIG.pitch * DEG);
  const planar = armLength * Math.cos(swung);
  const lift = armLength * Math.sin(swung);

  // Back into the world, in the walker's own frame: forward is (-sin, -cos)
  // and right is (cos, -sin), the frame src/core/player.js walks in.
  const sin = Math.sin(body.yaw);
  const cos = Math.cos(body.yaw);
  // How the planar reach divides between astern and abeam keeps the shape the
  // rule fixed, so the avatar stays put in the frame as the boom swings.
  const share = armPlanar > 1e-9 ? planar / armPlanar : 0;
  const outBehind = flatBehind * share;
  const outLateral = flatLateral * share;

  let x = body.x - outBehind * -sin + outLateral * cos;
  let z = body.z - outBehind * -cos + outLateral * -sin;
  let y = pivotY + lift;

  // AND THE GROUND HAS THE LAST WORD. Read where the camera actually is rather
  // than where the walker is: six metres astern the world has moved on. The
  // clearance is a head's worth, so the near plane never bites into the turf.
  if (ground) {
    const floor = ground(x, z) + GROUND_CLEARANCE;
    if (y < floor) y = floor;
  }

  out.x = x;
  out.y = y;
  out.z = z;
  out.arm = armLength;
  return out;
}

/**
 * How far the crown stands above the eye: one world cell, which is the stack
 * that made H = 1.80 out of EYE_HEIGHT = 1.70 in the first place.
 */
const EYE_TO_CROWN = 0.10;

/** How close to anything solid the camera is allowed to get, in metres. */
const GROUND_CLEARANCE = 0.25;

export { EYE_TO_CROWN, GROUND_CLEARANCE, DEG };
