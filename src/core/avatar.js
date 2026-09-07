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

import { EYE_HEIGHT } from '../world/layout.js';

// ------------------------------------------------------- where he is standing
//
// ONE LIVE OBJECT, ONE WRITER, READ BY WHOEVER DRAWS HIM. src/core/player.js
// fills this in the same call that puts the camera in the scene, and the layer
// that owns the voxel body reads it. It is shared by reference and never copied,
// which is the shape this world already uses for the sun, the two light colours
// and the air — for the same reason: a copy is a second answer.
//
// WHY IT IS PUBLISHED AND NOT WORKED OUT AGAIN. Everything here except the yaw
// could be had from the eye the layers are already handed — and would be WRONG
// the moment a pose names an altitude, because then the eye is not a stance plus
// a constant. That is exactly the subtraction the campaign has already had to
// unpick once. The stance is the number whose definition never moves, so the
// stance is what travels.
export const STANDING = {
  /** Where his feet are, in world metres. `y` is the ground he is standing on. */
  x: 0,
  y: 0,
  z: 0,
  /** Which way he faces, radians, the walker's own smoothed yaw. */
  yaw: 0,
  /** Whether anything should draw him: he is not in his own first person. */
  drawn: false,
  /**
   * How much of him to draw, 0 to 1, for the metre either side of the switch.
   *
   * WHY A NUMBER AND NOT A SECOND FLAG. The camera runs from the eye to five
   * metres astern in a third of a second, and for the first metre of that run
   * the body is between the near plane and the lens: drawn, it is a wall of
   * navy across the frame; cut, it appears out of nothing. So it dissolves, and
   * what carries the dissolve is a screen door in his own fragment -- no
   * blending, no sort, no second draw. The layer writes it into the material;
   * anything else that draws him reads the same number.
   */
  fade: 0,
  /** How long the boom is, in metres, so a reader can tell the switch is running. */
  arm: 0,
  /** Bumped by every write, so a reader can tell a stale frame from a still one. */
  serial: 0,
};

// --------------------------------------------------------------- the body
//
// H = 1.50 m, AND IT IS NOW A READING RATHER THAN A DECISION.
//
// It used to be 1.80, and it had to be a decision: over two metres of camera
// altitude the blocks say the same thing, so altitude and figure height traded
// off along a flat valley and no residual picked a point on it. The valley
// CLOSES the moment the plane the blocks stand on is imposed, and that plane
// was measured afterwards -- the feet of the blocks land on y = 0 to 17 px rms,
// with the paving and the verge on an exact half metre grid. On that plane the
// arithmetic has one answer: the figure's soles sit at row 934, which
// back-projects to (-0.26, 9.27) and 4.97 m in front of the fitted camera, and
// its crown sits 21 px BELOW the horizon -- 0.09 m below an eye at 1.583 -- so
// the figure is 1.49 m tall. At 1.80 the crown stands above the horizon, which
// is not what the picture draws.
//
// AND THE COMMITTENTE HAS ANSWERED THE BIVIO IT OPENED: 1.50 in third person,
// 1.70 at the eye in first. So the two are no longer one number, and the seam
// between them is named rather than hidden -- see the pivot below, which is the
// only place it shows.
//
// 1.50 closes on integers in both grids at once, which is the check that it was
// not chosen for taste: fifteen world cells, and sixty of his own at a quarter
// of the world's step -- the step the pictures themselves read on the pack.
export const AVATAR = {
  /** Metres, sole to crown, in third person. */
  height: 1.50,
  /** The same, in cells of the world's own 0.10 m grid. Exact. */
  worldCells: 15,
  /** And in cells of his own, which are a quarter of the world's. Exact. */
  cells: 60,
  /** One of his cells, in metres: 0.025 */
  get cell() { return this.height / this.cells; },
};

// ------------------------------------------------------------ the framing
//
// THE RULE IS IN UNITS OF H, WHICH IS WHY IT SURVIVED THE SCALE CHANGING TWICE.
// It has been re-derived a second time and the shape of it did not move: three
// and a third heights astern, half a height abeam, a height and a twentieth up.
// What moved is H.
//
// THESE THREE NUMBERS ARE NOT ROUNDED, AND THAT IS THE WHOLE OF THE CHANGE.
// The rule is quoted elsewhere as 3.30 / 0.48 / 1.055, which is what the metres
// come to when they are divided by 1.50 and read to two places. Written back as
// a rule those roundings move the camera 16 mm across and 73 mm along its own
// axis -- 1.5 per cent of the distance to the figure, five pixels of his height,
// most of the tolerance the framing is judged on, spent on a rounding. So they
// are carried at the precision the fit itself has: with the body at
// (-0.26, 9.27) and the camera at the day fit, the rule below reproduces that
// camera to the millimetre, and the framing is the reference's framing with the
// figure inside it.
//
// WHERE EACH ONE COMES FROM. The camera is POSE_VOX_DAY, fitted against the
// silhouettes of five blocks and untouched since. The feet are the day
// picture's own sole row back-projected onto y = 0. Everything here is the
// difference between those two, in the camera's own frame, divided by 1.50.
export const RIG = {
  /** Planar distance from the avatar to the camera, in heights. 5.019 m. */
  planar: 3.3460,
  /** How far the camera's eye is above the avatar's FEET, in heights. 1.583 m. */
  aboveFeet: 1.0553,
  /** How far the avatar sits to the LEFT of the camera's axis, in heights. 0.702 m. */
  lateral: 0.4678,
  /** Vertical field of view, degrees: the fitted framing's own. */
  fov: 44.199,
  // THE PITCH THE RULE BELONGS TO, and it has to be said out loud because the
  // rule is an OFFSET and an offset only means something at a stated aim.
  //
  // IT IS THE DAY FIT'S AIM NOW, AND NOT THE MEAN OF THE TWO. The offsets above
  // are the day picture's, measured against the day picture's camera, so the
  // aim they belong to is that camera's: anchoring them at the mean of the two
  // fits would swing the boom two tenths of a degree in the one place the whole
  // campaign is judged. The night fit sits 0.42 degrees away, which is 36 mm on
  // a five metre arm; that is the residual, and it is declared rather than
  // split.
  pitch: 4.124,
};

// -------------------------------------------------------------- the switch
//
// THE ARM IS NOT A FLAG. Both persons are the same walker with the same eye and
// the same aim; what differs is how far astern the camera has been carried. So
// the switch is that distance running from nought to all of it, and everything
// else -- the lateral offset, the rise, the collision -- is a fraction of the
// same arm and arrives with it.
export const SWITCH = {
  /** Seconds from one person to the other. */
  seconds: 0.35,
  /** Below this much arm the body is not drawn at all, in metres. */
  hideBelow: 0.35,
  /** And above this much it is drawn whole: between the two it dissolves. */
  showAbove: 1.00,
};

/**
 * The shape of the run, 0 to 1.
 *
 * A TIMER AND NOT A FILTER, AND THE REASON IS THAT IT HAS TO ARRIVE. The mouse's
 * silk is a critically damped chase because a chase never has to finish: the
 * hand keeps asking. A switch does have to finish -- the frame after it is over
 * must be first person EXACTLY, or the two persons are never bit-identical --
 * and a critically damped step is asymptotic, so it would spend the rest of the
 * session a millimetre out. Smoothstep leaves and arrives with zero slope, is
 * monotone by construction, and is over at 0.35 s to the frame.
 */
export function reachEase(t) {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}

/**
 * How much of him to draw at a given arm length: nothing on the lens, all of him
 * from a metre out.
 */
export function bodyFade(arm) {
  const t = (arm - SWITCH.hideBelow) / (SWITCH.showAbove - SWITCH.hideBelow);
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

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
// THE PIVOT IS THE WALKER'S OWN EYE, AT EYE_HEIGHT, AND THAT IS THE SEAM THE
// COMMITTENTE'S ANSWER PUTS IN THIS FILE.
//
// The pictures fix the OFFSET -- behind, beside, above -- and any pivot with the
// same offset draws the same frame, so they say nothing about where along the
// body it sits. What decides it is the switch: first person is the walker's eye,
// so an arm that retracts toward THAT arrives there with the accumulated yaw and
// pitch intact and without the world sliding sideways on the last frame. With
// one height it was also the avatar's eye, a crown-to-eye below the top of him;
// with 1.50 in third and 1.70 in first it is not, and pretending otherwise would
// buy a tidier sentence at the price of a 20 cm jump in the middle of every
// switch. So the pivot is the walker's eye, the body's crown stands 20 cm below
// it, and the boom leaves that pivot going very slightly DOWN -- 0.117 m over
// five metres, which is one and a third degrees. A boom still wants to be flat
// and this one is.
//
// AND A RIGID ARM CANNOT HONOUR PITCH_LIMIT, which is why this shortens.
// PITCH_LIMIT is 85 degrees and it was written for an eye that turns on the
// spot. Swing five metres of boom through it and the camera is over the stair
// platform at one end -- and inside a block if the walker is near one -- and
// UNDER THE GROUND before 15 degrees at the other. The arm therefore retracts as
// the look leaves the horizontal, and the place it finishes retracting is first
// person, where there is no arm to collide with anything.
//
// THE CURVE IS PROVISIONAL AND SAYS SO. Linear in |pitch| is the simplest law
// that provably reaches zero exactly at the limit; it is not claimed to be the
// right FEEL, because feel is not something this seat measured. What is measured
// is what it does -- the guard sweeps the whole range and reports clearance at
// every degree.
const DEG = Math.PI / 180;

/**
 * How much of the arm is left at a given pitch: all of it at the aim the rule
 * was measured at, none of it at either limit.
 *
 * ANCHORED AT THE RULE'S OWN AIM AND NOT AT THE HORIZONTAL, which matters more
 * than it looks: the framing sits 4.12 degrees above level, so a retraction
 * measured from level would already have taken five per cent off the arm in the
 * one place the arm is supposed to be exactly right -- a quarter of a metre, at
 * the pose the whole campaign is judged on.
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

// ------------------------------------------------------ the arm and the stone
//
// THE CAMERA MUST NOT GO INSIDE ANYTHING, and until now nothing stopped it: the
// arm knew where the ground was and nothing else, so a walker who put his back
// to a block put the camera in the masonry and looked at the inside of the hub.
// The block is five metres wide and the arm is five metres long, which is not a
// corner case -- it is what happens every time somebody walks up to a monolith
// and turns round.
//
// THE TEST IS A SEGMENT AGAINST BOXES, WHICH IS THE CHEAPEST HONEST ANSWER. The
// world already publishes what a body cannot walk through; a camera needs the
// same list with the height on it, because a rock 0.6 m tall is not in the way
// of an eye at 1.58 and a block 5.4 m tall is. Six blocks, the platform and a
// dozen rocks is twenty slab tests a frame, which is microseconds, and it is
// EXACT rather than sampled: a marched ray at any step size walks through a
// corner sooner or later, and sooner or later is a frame the walker sees.
//
// THE CAMERA IS PULLED IN ALONG THE ARM AND NOT PUSHED SIDEWAYS. Sliding it out
// of a wall would change the framing's direction, which is the one thing the fit
// fixes; shortening the arm keeps the aim, keeps the avatar where the offset
// puts him in the frame, and is what a boom operator does. What it costs is that
// the figure grows as the camera closes -- and past a metre he is dissolving
// anyway, which is the same metre the switch uses.

/**
 * How much of a segment is clear of one box, as a fraction of its length.
 *
 * The box is grown by `pad` on every side, so "clear" means the near plane never
 * gets closer to the stone than that. Slab test in the box's own frame, which is
 * where the footprint is axis aligned -- the same frame the walker's own
 * footprint test uses, so a wall cannot be solid to a body and hollow to a lens.
 *
 * @returns {number} 1 if the segment misses, otherwise the fraction at which it
 *                   first meets the box, never less than 0.
 */
export function boxClear(from, to, b, pad = 0) {
  const s = Math.sin(b.rotationY);
  const c = Math.cos(b.rotationY);
  const local = (p) => {
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    return { x: dx * c - dz * s, y: p.y, z: dx * s + dz * c };
  };
  const a = local(from);
  const e = local(to);
  const ex = b.halfWidth + pad;
  const ez = b.halfDepth + pad;
  const y0 = b.y0 - pad;
  const y1 = b.y1 + pad;
  let lo = 0;
  let hi = 1;
  const slab = (p0, p1, min, max) => {
    const d = p1 - p0;
    if (Math.abs(d) < 1e-9) return p0 >= min && p0 <= max;
    let t0 = (min - p0) / d;
    let t1 = (max - p0) / d;
    if (t0 > t1) { const swap = t0; t0 = t1; t1 = swap; }
    if (t0 > lo) lo = t0;
    if (t1 < hi) hi = t1;
    return hi >= lo;
  };
  if (!slab(a.x, e.x, -ex, ex)) return 1;
  if (!slab(a.z, e.z, -ez, ez)) return 1;
  if (!slab(a.y, e.y, y0, y1)) return 1;
  if (lo > 1) return 1;
  return Math.max(0, lo);
}

/** The same over a list: the earliest meeting wins. */
export function armClear(from, to, solids, pad = 0) {
  let f = 1;
  if (!solids) return f;
  for (const b of solids) {
    const t = boxClear(from, to, b, pad);
    if (t < f) f = t;
  }
  return f;
}

/**
 * Where the third person camera stands, in world metres.
 *
 * THE CAMERA IS NOT AIMED AT THE AVATAR AND MUST NOT BE. It carries the walker's
 * own yaw and pitch, and the avatar lands where the offset puts him -- left of
 * the middle and low in the frame, which is where both pictures draw him. A
 * lookAt on the head would centre him and miss the framing by two hundred
 * pixels. This function answers WHERE ONLY; the aim stays the walker's.
 *
 * The arm swings with pitch, as a boom does: look down and the camera rises
 * behind the shoulder, look up and it drops. Three things govern its length --
 * the retraction above, the switch's own run, and the stone -- and then the
 * ground has the last word on its height, because a camera that has gone under
 * the world shows the inside of it.
 *
 * @param {object} out       written into; no allocation a frame
 * @param {object} body      { x, z, stance, yaw } of the walker
 * @param {number} pitch     radians, positive looks up
 * @param {number} limit     PITCH_LIMIT in radians
 * @param {function} ground  (x, z) -> the height of anything solid there
 * @param {number} height    the avatar's height in metres
 * @param {object} opts      { reach, solids, eyeHeight }
 */
export function thirdPersonEye(
  out, body, pitch, limit, ground, height = AVATAR.height, opts = {},
) {
  const rig = rigMetres(height);
  const reach = opts.reach === undefined ? 1 : opts.reach;
  const eyeHeight = opts.eyeHeight === undefined ? EYE_HEIGHT : opts.eyeHeight;
  // The pivot: the WALKER's eye, which is where first person is and therefore
  // where a retracting arm has to end up.
  const pivotY = body.stance + eyeHeight;
  const k = armFraction(pitch, limit) * (reach < 0 ? 0 : reach > 1 ? 1 : reach);

  // The arm at rest, from that pivot: almost flat, and its lateral leg goes
  // with it so that a retracted arm has no sideways offset left to cancel.
  const flatBehind = rig.behind * k;
  const flatLateral = rig.lateral * k;
  const rise = (body.stance + rig.above - pivotY) * k;
  const armPlanar = Math.hypot(flatBehind, flatLateral);
  const armLength = Math.hypot(armPlanar, rise);

  // Swing it. The arm leaves the pivot at its own small angle; pitching the look
  // away from the aim the rule was measured at rotates the whole boom the other
  // way, so looking down lifts the camera behind the shoulder.
  const rest = Math.atan2(rise, armPlanar);
  const swung = rest - (pitch - RIG.pitch * DEG);
  const planar = armLength * Math.cos(swung);
  const lift = armLength * Math.sin(swung);

  // Back into the world, in the walker's own frame: forward is (-sin, -cos) and
  // right is (cos, -sin), the frame src/core/player.js walks in.
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

  // AND THE GROUND HAS ITS WORD FIRST. Read where the camera actually is rather
  // than where the walker is: five metres astern the world has moved on. The
  // clearance is a head's worth, so the near plane never bites into the turf.
  // It runs BEFORE the stone and not after: lifting a camera out of the ground
  // can carry it into a wall, and the wall is the one that must have the last
  // word.
  if (ground) {
    const floor = ground(x, z) + GROUND_CLEARANCE;
    if (y < floor) y = floor;
  }

  // THEN THE STONE. The camera comes back along its own arm to the first thing
  // it meets, which keeps the aim and the framing and only shortens the boom.
  const pivot = { x: body.x, y: pivotY, z: body.z };
  const wanted = { x, y, z };
  const f = armClear(pivot, wanted, opts.solids, GROUND_CLEARANCE);
  if (f < 1) {
    x = pivot.x + (x - pivot.x) * f;
    y = pivot.y + (y - pivot.y) * f;
    z = pivot.z + (z - pivot.z) * f;
  }

  out.x = x;
  out.y = y;
  out.z = z;
  out.arm = Math.hypot(x - pivot.x, y - pivot.y, z - pivot.z);
  return out;
}

/**
 * How far the crown stands below the walker's eye, in metres.
 *
 * IT IS NO LONGER ONE WORLD CELL, and that is the arithmetic of the two heights:
 * the eye is at 1.70 and the body is 1.50, so the crown is 0.20 m under it. It is
 * kept as a name because two files want to know it -- the switch, to decide when
 * the head is in front of the lens, and anything that wants to put something on
 * his head.
 */
const EYE_TO_CROWN = EYE_HEIGHT - AVATAR.height;

/** How close to anything solid the camera is allowed to get, in metres. */
const GROUND_CLEARANCE = 0.25;

export { EYE_TO_CROWN, GROUND_CLEARANCE, DEG };
