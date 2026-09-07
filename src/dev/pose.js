import { POSES, POSE_TARGET } from '../core/poses.js';

// THE ONE DOOR A POSE IS IMPOSED THROUGH, AND THE CAMERA IT LEAVES BEHIND IT.
//
// WHY THIS FILE EXISTS. Every judgement this campaign makes is a pair of frames
// at the same pose before and after a change, and until now there were TWO ways
// to reach one: the P key, which asked which person the walker was in and placed
// the FIGURE when he was in third, and window.setDevPose, which placed the eye
// and left the person alone. In third person those two doors put the lens five
// metres apart -- the walker where the pose says, the camera on the end of the
// boom -- so a session that pressed P and a bench that called setDevPose were
// photographing two different cameras with one name between them, and the plates
// of U-LUCE-4 were taken through the wrong one (E-LUCE5: the front of block 03
// measured 178 px where the fit measures 199).
//
// SO A POSE IS A CAMERA AND IS PLACED AS ONE. The committente's answer to
// D-L5-1 is A: the dev pose is ALWAYS first person with the fitted camera. That
// is not a flag on a door, it is the door: this file places the person, then the
// pose, then the lens, and hands back what the camera actually reads. There is
// nowhere else to ask.
//
// AND FIRST PERSON IS WHAT MAKES THE READBACK EXACT. With the boom retracted the
// walker IS the camera -- src/core/player.js copies the position rather than
// arriving at it through six trigonometric calls -- so the six numbers a pose
// carries and the six numbers the camera reads are the same bits, and a
// millimetre of disagreement is a defect and not a rounding.
//
// WHAT ABOUT THE FRAMING WITH THE FIGURE IN IT. POSE_TARGET_TERZA stands the
// WALKER where the day picture draws his soles; through this door that is a
// walker standing there and looking through his own eyes, which is a true
// first person camera and not a lie. The third person framing is arithmetic --
// the rule in src/core/avatar.js carries the boom from those feet to the day fit
// to within a tenth of a millimetre -- and it is measured in tools/guards/
// guard-avatar.mjs, where a projection is exact, rather than photographed
// through a door whose whole job is to be one camera.

/**
 * Turns a quaternion into the walker's own two angles, in degrees.
 *
 * YXZ, WHICH IS THE ORDER THE WALKER TURNS IN. src/core/player.js builds the
 * camera's rotation from an Euler in that order -- yaw about the world's up,
 * then pitch about the turned right -- so this is the inverse of the one
 * statement that put it there and not a second opinion about what "yaw" means.
 *
 * Written out rather than borrowed from the renderer's own Euler because this
 * is READ-BACK: the point of it is to answer with the numbers that reached the
 * camera, and a helper that shares an object with the writer can agree with the
 * writer about a value neither of them has.
 */
function anglesOf(q) {
  const { x, y, z, w } = q;
  // The third column of the rotation matrix, which is where the lens looks.
  const m13 = 2 * (x * z + w * y);
  const m23 = 2 * (y * z - w * x);
  const m33 = 1 - 2 * (x * x + y * y);
  // Pitch first: in YXZ it is the one angle that does not depend on the other.
  const sinPitch = -m23;
  const pitch = Math.asin(Math.max(-1, Math.min(1, sinPitch)));
  const yaw = Math.atan2(m13, m33);
  return { yaw: (yaw * 180) / Math.PI, pitch: (pitch * 180) / Math.PI };
}

/**
 * What a camera reads, in the six numbers a pose is written in.
 *
 * @param {object} camera  anything with `position`, `quaternion` and `fov`
 */
export function readCamera(camera) {
  const { yaw, pitch } = anglesOf(camera.quaternion);
  return {
    x: camera.position.x,
    y: camera.position.y,
    z: camera.position.z,
    yaw,
    pitch,
    fov: camera.fov,
  };
}

/**
 * How far a camera stands from the pose it was asked for.
 *
 * Metres and degrees kept apart, because they are not comparable and a single
 * number that mixed them would hide whichever of the two was wrong.
 *
 * @returns {object} { metres, degrees, fov } -- all of them absolute
 */
export function poseMiss(read, pose) {
  const at = pose.position || pose;
  // Yaw is a bearing and the difference between 179 and -179 is two degrees.
  const turn = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  return {
    metres: Math.hypot(read.x - at.x, read.y - at.y, read.z - at.z),
    degrees: Math.max(turn(read.yaw, pose.yaw), Math.abs(read.pitch - pose.pitch)),
    fov: Math.abs(read.fov - (pose.fov || POSE_TARGET.fov)),
  };
}

/**
 * The seat the P key and window.setDevPose both go through.
 *
 * @param {object} deps  { player, camera, veil } -- the walker, the lens, and
 *                       the arrival veil, which a pose takes off the frame
 * @returns {object} { place(asked) } -> what the camera reads afterwards
 */
export function createDevPose({ player, camera, veil }) {
  return {
    /**
     * Stands the camera on a pose, in first person, with the frame clean.
     *
     * BY NAME OR BY NUMBERS. A harness that asks for 'bordo-indietro' and a
     * verbale that calls it 'bordo-indietro' cannot drift apart; a harness
     * carrying its own copy of x, z, yaw and pitch drifts the first time one of
     * them is refitted. The numbers are still accepted, for a pose being swept
     * rather than one that has a name.
     *
     * @param {string|object} asked  a name in src/core/poses.js, or a pose
     * @returns {object} the six numbers the camera reads, and its miss
     */
    place(asked) {
      const p = typeof asked === 'string' ? POSES[asked] : asked;
      if (!p) throw new Error(`no pose "${asked}" in src/core/poses.js`);
      const at = p.position || p;
      // THE PERSON FIRST, AND WITHOUT A RUN. placePerson and not setPerson: the
      // switch takes 0.35 s and a screenshot costs longer than that, so a pose
      // that started a switch would be photographed somewhere along it. The
      // first frame at a pose has to BE the pose.
      player.placePerson('prima');
      player.setPose({
        position: { x: at.x, y: at.y ?? POSE_TARGET.position.y, z: at.z },
        yaw: p.yaw,
        pitch: p.pitch,
      });
      camera.fov = p.fov || POSE_TARGET.fov;
      camera.updateProjectionMatrix();
      // AND THE FRAME IS CLEAN BEHIND IT. The arrival veil is a composition and
      // not a filter: it belongs to the two seconds a visitor arrives in, and a
      // pose imposed from outside is not an arrival. Left up it shades the
      // corners of every plate by a quarter to a half of the light, which is the
      // one thing a paired crop cannot divide out afterwards, and on a frozen
      // clock -- which is how a measurement holds the arrival still -- it never
      // comes off at all. So the pose takes it.
      if (veil) veil.dismiss();
      // NOW, AND NOT NEXT FRAME. The camera is what the caller is about to read
      // and what a shot is about to take, and a placement that only lands on the
      // next tick is a placement a still frame can miss.
      player.applyTo(camera);
      const read = readCamera(camera);
      return { ...read, miss: poseMiss(read, p), pose: p.name || 'senza nome' };
    },
  };
}
