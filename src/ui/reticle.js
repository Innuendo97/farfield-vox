// The mark at the centre of the frame: where E is going to act.
//
// It is drawn in the family the world's own markers are drawn in — the outlined
// rhombus with a lit heart that hangs at the foot of every block — and it says
// exactly one thing beyond being there: when a face comes within reach of E,
// the heart comes up to full and the outline comes out around it. That is the
// same moment the prompt rises at the foot of the frame, said again at the
// point the walker is actually looking at.
//
// IT IS NOT IN THE REFERENCE FRAMING, and every gate of this campaign
// photographs the whole page at a placed pose and compares it byte for byte, so
// a mark of our own invention in the middle of that frame would break every
// comparison there is. Two things keep it out, and the second needs nobody to
// remember it:
//
//   the class is its own, so a harness hides `.reticle` exactly as it already
//   hides `.dev-hud` and `.dev-panel`;
//
//   and it takes itself out the moment somebody PLACES the walker rather than
//   walks them, off the same serial the body model watches for the same reason.
//   The reference pose on P, the survey poses, `window.setDevPose` and the
//   calibration sweep all go through `Player.setPose`, and none of them has to
//   know this file exists. It comes back at the first real step.

// Where the mark has nothing to point at, because something else has the frame:
// a stack standing open in front of a stone, or a room being read.
const AWAY_STATES = new Set(['pannelli', 'stanza']);

// What counts as having walked out of a placed pose, in metres a second. The
// same threshold the body model releases on: a pose is let go of by the one
// thing a placement is not.
const WALKING = 0.001;

/**
 * Hangs the reticle on the interface and returns its handle.
 *
 * @param {Element} root where the rest of the interface is mounted
 */
export function createReticle(root) {
  const el = document.createElement('div');
  el.className = 'reticle';
  // There is nothing here for a reader: the offer is written in the prompt at
  // the foot of the frame, which is a live region and says it in words.
  el.setAttribute('aria-hidden', 'true');
  root.appendChild(el);

  let serial = null;
  let placed = false;
  let shown = null;
  let live = null;

  return {
    /**
     * One frame of it.
     *
     * @param {object}  motion what the walker is doing, as `motionInto` fills
     *   it: `speed` and the pose serial are the two fields read here.
     * @param {string}  state  which of the four states the interaction is in
     * @param {boolean} away   whether the menu or the way-in prompt has the
     *   mouse, in which case the frame is being read and not aimed
     */
    update(motion, state, away) {
      if (serial === null) {
        serial = motion.poseSerial;
      } else if (motion.poseSerial !== serial) {
        serial = motion.poseSerial;
        placed = true;
      }
      if (placed && motion.speed > WALKING) placed = false;

      const wantShown = !placed && !away && !AWAY_STATES.has(state);
      // "vicino" is the state that lights the prompt because a face is inside
      // the reach of E, and it is the whole of what lighting the mark means.
      const wantLive = wantShown && state === 'vicino';

      // Written only when it changes. This runs every frame for as long as the
      // page is open, and a class written with the value it already holds is
      // still an invalidation the browser has to walk.
      if (wantShown !== shown) {
        shown = wantShown;
        el.classList.toggle('is-on', wantShown);
      }
      if (wantLive !== live) {
        live = wantLive;
        el.classList.toggle('is-live', wantLive);
      }
    },
  };
}
