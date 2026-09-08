// THE COMPASS OF THIS WORLD, AND THERE IS ONE OF IT.
//
// Published through src/world/contracts.js, which is the door every session
// enters by; the arithmetic sits here because it has to be a LEAF. Nothing in
// this file imports anything, so the law that lays the columns
// (src/world/voxel/confine.js), the mesher that cuts them
// (src/world/distant-mesh.js), the weather (src/world/cloud-field.js), the
// fitters under assets-src/ and the guards under tools/ can all reach the same
// four lines without any of them dragging the world in behind it -- and without
// the import cycle that putting it in the door itself would make, since the
// door imports the law and the law needs the compass.
//
// WHY IT EXISTS AT ALL. There are TWO opposite angles in this codebase and for
// two sessions they were quietly mistaken for one:
//
//   THE ENGINE'S YAW.  src/core/player.js turns the camera with a YXZ Euler
//   about the world's up, and a three.js camera looks along its own -Z. Read
//   back out of the quaternion (src/dev/pose.js) the yaw of a look direction d
//   is `atan2(-d.x, -d.z)`. It increases toward -X.
//
//   THIS COMPASS.     `atan2(x, -z)`: nought at NORTH, which is -Z, and
//   positive toward the EAST, which is +X. It increases toward +X.
//
// THEY ARE EXACT NEGATIVES -- `bearing = -yaw`, at every angle, not just near
// nought -- and that is the whole of the confusion. At yaw nought they agree,
// which is why nobody noticed; at the fitted pose's yaw of 1.818 degrees they
// are 3.636 degrees apart, which is five to six pixels of frame per degree and
// was enough to put a whole ridge in the wrong place. U-CORNICE-2 found it by
// measuring: the five monoliths, whose footings are known to the centimetre in
// src/world/layout.js, land 3 to 17 pixels from where the reference draws them
// when the two are bridged and 66 to 111 pixels away when they are not.
//
// SO EVERY DIRECTION IN THIS WORLD IS ASKED FOR HERE, and the three bridges
// below are the only places the two conventions are allowed to meet.
//
// A THIRD ANGLE EXISTS AND IS NOT A BEARING. `atan2(z, x)` -- from +X,
// anticlockwise -- turns up in frustum sectors, angular widths and radial
// noise. It is a perfectly good angle and it is NOT a compass reading: nothing
// is ever fitted against a photograph through it, and it must not be brought
// here. Where this file is not used, that is the reason, and the call site says
// so.

const DEG = Math.PI / 180;

/**
 * THE COMPASS BEARING OF A DIRECTION, IN DEGREES. Nought at north (-Z),
 * positive to the east (+X).
 *
 * The two arguments are a DIRECTION and not a place: a caller asking about a
 * point passes the offset from wherever it is looking from. A bearing without a
 * stated eye is not a measurement, and making the subtraction the caller's
 * makes it impossible to forget which eye a reading was taken at -- which is a
 * defect this campaign has already paid for once, in the fitter that corrected
 * the knot the eye looked at instead of the knot the hill stands on.
 *
 * @param {number} x  metres east, from the eye
 * @param {number} z  metres south, from the eye
 * @returns {number} degrees, in (-180, 180]
 */
export function bearingOf(x, z) {
  return Math.atan2(x, -z) / DEG;
}

/**
 * The same reading in RADIANS, for the laws that work in them.
 *
 * Not a convenience: `bearingOf(x, z) * DEG` and this differ in the last bit,
 * and the ring frontiers of the boundary are compared against a sway sampled at
 * the bearing. One arithmetic, two units, no round trip.
 *
 * @param {number} x  metres east, from the eye
 * @param {number} z  metres south, from the eye
 * @returns {number} radians, in (-pi, pi]
 */
export function bearingRadOf(x, z) {
  return Math.atan2(x, -z);
}

/**
 * The unit direction a bearing points along, as [x, y, z] with y nought.
 *
 * The inverse of bearingOf, written down so that nobody has to remember which
 * of sine and cosine takes the minus sign.
 *
 * @param {number} bearingDeg  degrees from north
 */
export function directionOf(bearingDeg) {
  const b = bearingDeg * DEG;
  return [Math.sin(b), 0, -Math.cos(b)];
}

/**
 * A bearing as a turn of the dial, nought to one, north at a half.
 *
 * What a mesher wants when it is choosing which of N sectors a quad belongs to,
 * and the one place a wrap is allowed to be silent, because the dial closes.
 *
 * @param {number} x  metres east, from the centre
 * @param {number} z  metres south, from the centre
 */
export function turnOf(x, z) {
  return (Math.atan2(x, -z) / Math.PI + 1) / 2;
}

/**
 * The shortest way round from one bearing to another, in degrees, signed.
 *
 * Every comparison of two bearings goes through this. 179 and -179 are two
 * degrees apart and a guard that subtracted them would read 358.
 *
 * @param {number} aDeg
 * @param {number} bDeg
 * @returns {number} degrees in (-180, 180], positive when a is east of b
 */
export function bearingGap(aDeg, bDeg) {
  return ((((aDeg - bDeg) % 360) + 540) % 360) - 180;
}

// ------------------------------------------- the three bridges to the engine
//
// Below this line the engine's yaw is in the room. Above it, it is not.

/**
 * THE FIRST BRIDGE: an engine yaw, on this compass.
 *
 * A camera's yaw and the bearing it is looking along are the same direction
 * written in two conventions that run in opposite directions, so the bridge is
 * a minus sign -- and it is a named minus sign, because an unnamed one in the
 * middle of a projection is exactly what was wrong for two sessions.
 *
 * @param {number} yawDeg  degrees, the engine's own
 * @returns {number} degrees from north
 */
export function bearingOfYaw(yawDeg) {
  return -yawDeg;
}

/**
 * And back: the yaw a camera must hold to look along a bearing.
 *
 * @param {number} bearingDeg  degrees from north
 * @returns {number} degrees, the engine's own
 */
export function yawOfBearing(bearingDeg) {
  return -bearingDeg;
}

/**
 * THE SECOND BRIDGE: how far right of a camera's axis a bearing stands.
 *
 * This is what a projection needs, and it is where the sign actually bites: a
 * point at bearing b is `b + yaw` degrees to the right of a camera held at
 * `yaw`, because the camera's axis is at bearing `-yaw`. Written the other way
 * round -- `b - yaw`, which is what it looks like it ought to be -- every
 * feature lands twice the yaw away, which at the fitted pose is the 3.636
 * degrees this file exists for.
 *
 * @param {number} bearingDeg  degrees from north
 * @param {number} yawDeg  the camera's engine yaw, degrees
 * @returns {number} degrees right of the camera's axis
 */
export function offAxisOf(bearingDeg, yawDeg) {
  return bearingDeg + yawDeg;
}

/**
 * And back: what bearing a given angle right of a camera's axis looks along.
 *
 * @param {number} offAxisDeg  degrees right of the axis
 * @param {number} yawDeg  the camera's engine yaw, degrees
 * @returns {number} degrees from north
 */
export function bearingOfOffAxis(offAxisDeg, yawDeg) {
  return offAxisDeg - yawDeg;
}

/**
 * THE THIRD BRIDGE, AND THE ONE THAT COST A DELIVERY: a bearing as the R6
 * reference trace wrote it down, on this compass.
 *
 * R6 traced the skyline off the judging frame and recorded every reading as
 * «the angle right of the camera's axis, PLUS the camera's engine yaw». That is
 * not an arbitrary choice, it is what a compass overlay drawn on a photograph
 * gives you when the overlay is built from the yaw; and it is checkable from
 * outside, because it is the only convention under which R6's own trace runs
 * from -34.0 to +37.6 instead of symmetrically from -35.81 to +35.81 about the
 * axis. So a reading is `offAxis + yaw`, and this compass wants `offAxis - yaw`:
 * the same feature stands at the recorded number LESS TWICE THE YAW.
 *
 * Every per-direction number that came off the reference picture crosses here
 * and nowhere else.
 *
 * @param {number} readDeg  the bearing as the reference recorded it
 * @param {number} yawDeg  the engine yaw of the pose it was read at
 * @returns {number} degrees from north, on this compass
 */
export function bearingOfFrameRead(readDeg, yawDeg) {
  return bearingOfOffAxis(readDeg - yawDeg, yawDeg);
}

/**
 * And back, for printing a law's answer next to the reference's own numbers.
 *
 * @param {number} bearingDeg  degrees from north
 * @param {number} yawDeg  the engine yaw of the pose
 */
export function frameReadOfBearing(bearingDeg, yawDeg) {
  return offAxisOf(bearingDeg, yawDeg) + yawDeg;
}
