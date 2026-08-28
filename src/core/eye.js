import { Euler, Quaternion, Vector2, Vector3 } from 'three';
import { SUN_DIRECTION } from './sky.js';
import { POSE_TARGET } from './poses.js';

// The optics in front of the body.
//
// src/core/presence.js is the body under the eye: where it is, how it breathes,
// how it rides a step. This is the eye itself — the things a pair of eyes does
// that a camera on a tripod does not, laid over the picture the composite has
// already finished making:
//
//   FOCUS        lean in on something near and everything else goes soft
//   ADAPTATION   look at the sky and the picture settles down, look into the
//                near shade and it comes back up, over seconds
//   THE SUN      what happens to a picture when the sun is IN it: rays through
//                the gaps, a streak across the optics, a veil of stray light
//   RAIN         beads on the glass; a preview, until the weather is real
//
// NOTHING HERE DRAWS. It is arithmetic on a handful of numbers per frame, handed
// to src/core/post.js, and every one of them has a REST VALUE at which the pass
// does not take the branch that reads it: one, and the rest noughts. Which is
// the whole of the contract this unit was given —
//
//   at a placed pose the frame is the frame that was there before this file
//   existed, to the byte.
//
// It is held to that in two independent ways, and both are needed:
//
//   1. A PLACED POSE HAS NO EYE, off the same signal a placed pose has no body:
//      presence.state.frozen moves when — and only when — something PUT the
//      walker somewhere rather than walked them there, which covers the
//      reference pose on P, every survey pose, window.setDevPose, the
//      calibration sweep and the measuring harness, without one of them having
//      to know this file exists. Everything is put back to rest at once, not
//      ramped: a pose has to be photographable on the frame after it is asked
//      for.
//
//   2. AND THE ARRIVAL HAS NO EYE EITHER. All of them are silent until the
//      walker has taken their first step, and they start from exact rest when
//      they do. That is not caution, it is the answer to the question DEV-S2e
//      left at the end of s2-dev5/VERBALE.md: the arrival composition is a veil
//      that dissolves, and an adaptation converging over the top of it would be
//      two dissolves added together, neither of which could then be reasoned
//      about. So the eye opens when the arrival is over, on the same first step
//      that lets the veil go. A consequence worth saying out loud: the sealed
//      sun sits about thirty degrees above the middle of the reference framing,
//      so a sun system that was live during the arrival would lay light across
//      the one picture this whole campaign is judged against.
//
// ---------------------------------------------------------------------------
// SECOND PASS (DEV-S2g2). The committente walked the first delivery and could
// not see three of the four. s2-dev8/out/diagnosi.txt is the instrumented walk
// that settled why, and it settled it the same way for all three: every trigger
// fired exactly as designed, and the pictures they made were quieter than the
// grass moving one frame. So what changed is amplitude and reach, not gates —
// except for the sun, where the committente asked for something that was not
// there at all: rays and a flare, rather than a veil whose name he could not
// attach to anything he had seen.

const DEG = Math.PI / 180;

// What counts as having taken the first step, in metres a second. The same
// number src/main.js hands the veil, for the same reason and on purpose: the
// arrival ends once, not twice.
const FIRST_STEP_SPEED = 0.3;

// A first order approach, framerate independent. Same shape as the one in
// presence.js; kept here rather than imported so that the body and the eye can
// be reasoned about apart.
function damp(current, target, tau, dt) {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function clamp(value, low, high) {
  return value < low ? low : (value > high ? high : value);
}

/**
 * A time to nine tenths, as the time constant of a first order approach.
 *
 * Said in the unit anybody can feel — "it is there in three hundred
 * milliseconds" — rather than in the one the arithmetic wants. A first order
 * system is nine tenths of the way in 2.303 time constants.
 */
const tauOf = (ms) => Math.max(1e-3, ms / 1000 / 2.302585);

export const TUNING = {
  // ---------------------------------------------------------------- the focus
  //
  // THE THIRD PASS TOOK THIS APART AND PUT IT BACK THE OTHER WAY ROUND, because
  // the committente walked the second delivery and reported a picture that was
  // soft everywhere:
  //
  //   «se mi avvicino a un monolite va in focus, ma se giro la camera e mi
  //    guardo attorno vedo TUTTO sfocato; la sfocatura sparisce solo
  //    allontanandomi. Succede anche passando vicino senza guardarlo.»
  //
  // He is describing a bug and it is a bug of LOGIC rather than of amplitude,
  // and the two lines that caused it are the two lines this pass deleted. The
  // first two deliveries put the focal plane at THE DISTANCE OF THE NEAREST
  // BLOCK. Stand two metres from a face, turn ninety degrees to look across the
  // meadow, and the eye is still accommodated to two metres: everything the
  // walker is actually looking at is thirty metres away and every one of those
  // pixels is a full circle of confusion out of focus. The whole picture goes
  // soft, it comes back only by walking out of reach, and none of it has
  // anything to do with where the eye is pointed. Which is what he saw.
  //
  // So the two axes are now separated, and they were confused before:
  //
  //   WHERE the eye is accommodated is ACCOMMODATION, and accommodation follows
  //   THE GAZE: the depth at the middle of the screen, in metres, damped into a
  //   focus pull. It is never the distance to a block, because a block that is
  //   not being looked at is not what an eye accommodates to. That measurement
  //   cannot be taken here — it is in the depth buffer, and reading a frame
  //   back means stalling the pipeline that drew it — so it is taken where it
  //   lives, in a one pixel reduction on the GPU, in src/core/post.js. This is
  //   the sede s2-dev7/VERBALE.md already named for exactly this kind of
  //   reading, and it is the reason `plane` is no longer handed across.
  //
  //   HOW MUCH of it shows is ATTENTION, and attention is what is here. It is
  //   not "is a block within reach" — passing one is not looking at one. It is
  //   within reach AND being looked at, on the angle between the gaze and the
  //   face, softly; or the lens leaning in on the right button, which is asking
  //   to look at something in the plainest way this world has. Look away and it
  //   goes, over half a second, whether or not the walker is still standing
  //   there.
  focus: {
    near: 0.75,         // how much a block within reach, LOOKED AT, asks for
    zoom: 1.0,          // and how much the lens leaning in asks for: more
    // THE CONE OF ATTENTION. Nothing at all beyond the outer angle, all of it
    // inside the inner one, and a smoothstep between: an eye does not decide it
    // is looking at something on one degree of yaw. The pair straddles the
    // twenty degrees the brief names.
    lookInnerDeg: 14,
    lookOuterDeg: 36,
    attackMs: 380,      // in, to nine tenths
    releaseMs: 520,     // and out, slower: the brief's 400-600 ms
    // "Riduci movimento" does not switch the focus off — it is not a movement,
    // and a walker who asked for less motion still wants to be able to read a
    // face — but it softens it and slows it down, because a picture whose
    // sharpness changes under the eye is the part of it a sensitive inner ear
    // can object to.
    reduced: 0.5,
    reducedAttackMs: 760,
  },

  // ---------------------------------------------------------- the adaptation
  //
  // A MODEL OF WHERE THE EYE IS POINTED, and it is worth saying exactly what
  // that is and is not. It is not a light meter: nothing is read back off the
  // frame, because reading a frame back means stalling the pipeline that drew
  // it, and a metering system with a range of a quarter of a stop would cost
  // more than the quarter stop is worth. It is the two things about a gaze
  // that decide most of what falls on a retina — how much sky is in front of
  // it, and how near the sun is to the middle of it — with the sealed sun as
  // the source for the second.
  //
  // Its zero is THE REFERENCE FRAMING. Not an average, not the sky: the gaze
  // of POSE_TARGET, so that a walker who comes back to the standing place this
  // campaign is judged from is looking at exactly the graded picture, with the
  // eye adding nothing. Everything else is a departure from that, measured.
  //
  // WHAT IT CANNOT SEE, declared rather than implied: shade. Looking down at
  // ground in shadow and looking down at ground in sun are the same gaze, and
  // this returns the same number for both. What it does answer for is the pair
  // the brief named — up towards the sun and the sky, down into the near field
  // — because in this world the near field IS the shaded half of the picture.
  //
  // THE SECOND PASS OPENED IT UP, and the numbers say by how much. The first
  // delivery ran a quarter of a stop through a gain of 0.55, and the walk found
  // the whole sun-to-meadow excursion coming out at about a tenth of a stop —
  // two levels out of 255, under the grass. The committente asked to FEEL the
  // eye open. So: nearly half a stop either way, a gain that reaches it, and
  // the drift brought into the one and a half to three seconds he named.
  //
  // The neutrality is untouched by any of it, and it is untouched BY
  // CONSTRUCTION rather than by retuning: at the reference gaze the modelled
  // difference is exactly zero, so the gain multiplies zero and the range
  // clamps nothing. A bigger range cannot move a number that is not there.
  adapt: {
    maxEV: 0.45,        // the whole range, either way
    gain: 0.70,         // how much of the modelled difference is taken
    sky: 1.0,           // weight on how much sky is in front of the eye
    sun: 0.80,          // and on how near the sun is to the middle of it
    sunExponent: 4,     // which is a narrow thing: a lobe, not a hemisphere
    // Two rates, because adaptation has two. An eye handles more light quickly
    // and less light slowly, and the pair the brief asks for is inside that.
    toBrightMs: 1600,   // exposure coming down
    toDarkMs: 2600,     // and going back up
  },

  // ----------------------------------------------------------- the sun in view
  //
  // THE ONE PLACE THE SECOND PASS BUILT SOMETHING NEW, and it is there because
  // the committente's words were "non ho capito cosa sia questo abbaglio
  // direzionale, né lo percepisco". The first delivery had a VEIL — a law of the
  // angle between a ray and the sun, laid under the whole picture, correct and
  // nameless. What he asked for instead has a name everybody knows: rays through
  // the gaps, and a flare across the optics, when the sun is IN THE PICTURE.
  //
  // So there are now two things where there was one, and they are gated
  // differently on purpose:
  //
  //   `glare`  the veil, unchanged in kind. It is a function of the ANGLE to the
  //            sun, so it is there whether or not the disc is in frame, and it
  //            is what carries the last of the light as the sun leaves.
  //   `sun`    how much of the disc is in the picture. The rays and the flare
  //            are multiplied by this, so they exist only while there is a sun
  //            on screen to have come from — which is also what keeps the sealed
  //            dome exactly as it was everywhere else.
  //
  // THE HYSTERESIS, and where it actually has to be. The geometric factor is
  // continuous — it fades over a margin outside the frame rather than cutting at
  // the border — so the picture cannot snap. What CAN snap is the decision to
  // run the pass at all, and a sun grazing the frame edge would otherwise switch
  // a render pass on and off every frame. That decision gets a Schmitt trigger,
  // in post.js, with the two thresholds below; and the amount itself is damped
  // asymmetrically, quicker in than out, which is what an eye does with a bright
  // thing that has just left it.
  sun: {
    // How far outside the frame, in normalised device units, the disc still
    // counts. Rays from a sun just off the top of the picture are the rays a
    // real lens makes, so this is not slack, it is the effect.
    margin: 0.75,
    attackMs: 420,      // in, once the disc appears
    releaseMs: 1100,    // and out, slower, which is the soft hysteresis
    // AND THE STREAK BREATHES, which the committente asked for in so many
    // words. What is here is only WHEN, as always: the shape of it — a
    // thickness that wanders, and the intensity and length it trades against so
    // that the light in it never pulses — is in src/core/post.js with the rest
    // of the flare.
    //
    // It follows the disc exactly as the flare does, so it comes and goes with
    // the same geometric factor and the same hysteresis, and it is gated by the
    // occlusion of the disc in the composite like everything else drawn AT the
    // sun. What it does NOT do is survive «riduci movimento»: a thickness that
    // wanders is a movement in the plainest sense, and it is the one part of
    // this system that has no reading to lose by stopping. Damped rather than
    // switched, so the menu does not put a step in the picture.
    breathMs: 300,
  },

  // --------------------------------------------------------------- the glare
  //
  // The angular shape of it is in the shader, against the sealed uSunDir, so
  // it is one law of the angle between the ray and the sun and never a sprite
  // pinned to a screen position. What is here is only WHEN: it comes up once
  // the arrival is over, and it goes with the sun below the horizon, so the
  // night this world is being made ready for takes it away without a switch.
  glare: {
    attackMs: 700,
    // Below this much sun over the horizon there is no sun to glare at, and it
    // fades out over the last of it rather than being cut off.
    horizon: 0.06,
  },

  // ---------------------------------------------------------------- the rain
  //
  // THIS IS A PREVIEW AND IT SAYS SO. The weather of this world is S8's, and
  // this exists so the committente can see what drops on the glass will look
  // like before that machine is built. There is no path to it from the product:
  // the key is behind ?dev, and so is the query.
  //
  // It costs nothing when it is off in the strongest sense available — the
  // branch in the composite is not taken, and there is no texture to load
  // whether it is ever switched on or not, because the drops are arithmetic.
  //
  // WHAT IS HANDED OVER FROM HERE is the one thing the shader cannot know: how
  // the eye behind the glass is MOVING. A bead of water on a windscreen does not
  // fall straight down when the car turns, and the committente asked for exactly
  // that — "trascinamento con il moto della camera". So the turn rate of the
  // gaze and the walker's own speed are measured here and handed across as a
  // drag, in screen units.
  rain: {
    fadeMs: 1500,
    // How much a turn of the gaze pushes a drop sideways, and how much walking
    // pushes it up the glass. Damped rather than taken raw: a drop has mass, so
    // it leans into a turn over a moment instead of teleporting with it.
    dragTurn: 0.5,
    dragWalk: 0.06,
    dragMs: 320,
    dragLimit: 1.6,
  },
};

// The gaze this whole campaign is judged from, as a direction. Built once, at
// load, from the pose itself rather than from a copy of its numbers.
const REFERENCE_GAZE = new Vector3(0, 0, -1).applyEuler(
  new Euler(POSE_TARGET.pitch * DEG, POSE_TARGET.yaw * DEG, 0, 'YXZ'),
);

/**
 * How bright the model thinks this gaze is, in the arbitrary units the gain
 * turns into stops. Only differences of it are ever used.
 */
function facing(dir) {
  const a = TUNING.adapt;
  const sky = dir.y * 0.5 + 0.5;
  const sun = Math.max(0, dir.dot(SUN_DIRECTION));
  return a.sky * sky + a.sun * (sun ** a.sunExponent);
}

/** Whether the development flags ask for the rain preview to start switched on. */
function rainAsked() {
  try {
    const query = new URLSearchParams(window.location.search);
    return query.has('dev') && query.has('pioggia');
  } catch {
    return false;
  }
}

/**
 * The optics in front of the body.
 *
 * Driven once a frame, after the body has placed the camera, and handed to the
 * composite. Nothing downstream of here has to know it exists.
 */
export function createEye() {
  // The state, and every one of these starts at exactly rest.
  let focus = 0;
  // How much of the walker's attention the face within reach is getting, as the
  // cosine test came out. Kept only so the harness can read the two halves of
  // the gate apart: `look` is why `focus` is where it is.
  let look = 0;
  let ev = 0;
  let glare = 0;
  let sun = 0;
  // How much the anamorphic streak is allowed to breathe, and its own clock.
  // Kept apart from `sun` because it is the one part of the flare that «riduci
  // movimento» takes away entirely, and because a phase that ran while the
  // walker was somewhere else would hand a placed pose a different frame of a
  // wander nobody asked to see.
  let streak = 0;
  let sunSeconds = 0;
  let rain = 0;
  let rainSeconds = 0;
  let raining = rainAsked();
  // The arrival is over the first time the body actually walks. Latched: a
  // walker who stops has still arrived.
  let walked = false;

  const gaze = new Vector3();
  const lastGaze = new Vector3(0, 0, -1);
  const sunView = new Vector3(0, 1, 0);
  // Where the disc lands on the glass, in normalised device coordinates: the
  // rays converge on it and the streak is drawn through it, so it is handed
  // across rather than reconstructed twice.
  const sunNdc = new Vector2(0, 2);
  const drag = new Vector2();
  // The camera's rotation, undone. Read off the quaternion rather than off
  // matrixWorldInverse on purpose: the inverse world matrix is refreshed by the
  // renderer, which has not run yet when this does, so using it would hang the
  // sun a frame behind the turn — and a veil of light sliding after the eye is
  // the one way this effect could look like something drawn on the frame.
  const undo = new Quaternion();
  // Towards the face within reach, in the plane. Reused rather than allocated.
  const toTarget = new Vector2();
  const drive = {
    focus: 0, exposure: 1, glare: 0, sun: 0, rain: 0, seconds: 0,
    streak: 0, sunSeconds: 0,
    sunView, sunNdc, drag,
  };

  function rest() {
    focus = 0;
    look = 0;
    ev = 0;
    glare = 0;
    sun = 0;
    // AND THE STREAK'S CLOCK GOES BACK TO NOUGHT, not just its amount. A placed
    // pose has to be photographable twice at the byte, and a wander is only
    // reproducible if the phase it is read at is.
    streak = 0;
    sunSeconds = 0;
    rain = 0;
    drag.set(0, 0);
  }

  return {
    /** The live tuning, so it can be tasted while walking. */
    tuning: TUNING,

    /** Whether the rain preview is asking to be there. */
    get raining() { return raining; },

    /** The development key: the drops, on and off. */
    toggleRain() {
      raining = !raining;
      return raining;
    },

    /** What the last frame was actually given, for the harness that checks it. */
    get state() {
      return {
        focus, look, ev, glare, sun, streak, rain, walked, seconds: rainSeconds,
        sunSeconds,
        sunNdc: { x: sunNdc.x, y: sunNdc.y },
        drag: { x: drag.x, y: drag.y },
      };
    },

    /**
     * One frame of eye.
     *
     * @param {number} dt seconds
     * @param {object} body presence.state: frozen, speed, zoomAmount,
     *   interaction, reducedMotion
     * @param {number} targetM metres to the face within reach, or Infinity
     * @param {object} camera the frame's own camera, for the sun in its axes
     * @param {?object} targetAt where that face is, in the plane, or null
     */
    update(dt, body, targetM, camera, targetAt) {
      // A PLACED POSE HAS NO EYE. At once, not over a ramp: the frame after a
      // placement is a frame somebody is about to photograph.
      if (body.frozen) {
        rest();
        // The gaze is still remembered, so that a walker who is put somewhere
        // and then walks does not start with a turn rate made of the jump.
        lastGaze.set(0, 0, -1).applyQuaternion(camera.quaternion);
        return;
      }
      if (body.speed > FIRST_STEP_SPEED) walked = true;

      const reduced = Boolean(body.reducedMotion);

      // Where the eye is pointed. Read off the camera's quaternion, and read
      // FIRST because three of the four below are laws of it.
      gaze.set(0, 0, -1).applyQuaternion(camera.quaternion);

      // ------------------------------------------------------------- focus
      const f = TUNING.focus;
      const near = Number.isFinite(targetM)
        && (body.interaction === 'vicino' || body.interaction === 'pannelli'
          || body.interaction === 'stanza');

      // AND ARE YOU LOOKING AT IT, which is the question the first two
      // deliveries never asked and the whole of what the committente objected
      // to. Being within reach of a face is a fact about the walker's feet; a
      // pair of eyes accommodates on a fact about their head.
      //
      // The angle is taken IN THE PLANE, for the same reason src/world/
      // interact.js measures the distance in the plane: the face of the third
      // block is thirteen metres tall, so somebody standing at the foot of it
      // reading the top of the writing is looking sixty degrees up and is very
      // much looking at it.
      //
      // A SMOOTHSTEP AND NOT A THRESHOLD. Between the two angles it is a ramp,
      // so turning the head takes the picture through every intermediate state
      // instead of across a line; and the amount that comes out of it is then
      // damped again below, so there are two soft things in series and no hard
      // one anywhere.
      look = 0;
      if (near && targetAt) {
        toTarget.set(targetAt.x - camera.position.x, targetAt.z - camera.position.z);
        const reach = toTarget.length();
        const ahead = Math.hypot(gaze.x, gaze.z);
        if (reach > 1e-3 && ahead > 1e-3) {
          const cos = (gaze.x * toTarget.x + gaze.z * toTarget.y) / (reach * ahead);
          const lo = Math.cos(f.lookOuterDeg * DEG);
          const hi = Math.cos(f.lookInnerDeg * DEG);
          const t = clamp((cos - lo) / Math.max(1e-4, hi - lo), 0, 1);
          look = t * t * (3 - 2 * t);
        }
      }
      // The gate is taken RAW into the amount below rather than damped here as
      // well. One first order lag in the chain and not two: two in series is a
      // second order response, which is prettier on paper and lands outside the
      // four to six hundred milliseconds the brief asks the fade to take.
      // AND THE FOCUS WAITS FOR THE FIRST STEP TOO, which was found by walking
      // rather than by reasoning. The spawn is NOT out of reach of every block:
      // the interaction reports "vicino" at a face 4.18 m away from the moment
      // the page opens (s2-dev7/out/camminata.txt, confirmed again in
      // s2-dev8/out/diagnosi.txt), which is why the prompt is up there. So a
      // focus that only asked "is a face within reach" would defocus the
      // arrival — that is, the reference framing, the one picture this campaign
      // is judged on, softened everywhere but on one block, in the very frame
      // the greeting is read over. Everything therefore waits for the same
      // first step, and the rule is one sentence instead of four: the eye opens
      // when the arrival is over.
      //
      // TWO WAYS IN, and the lens is the stronger of them now. Leaning in on
      // the right button is the plainest statement of intent this world has —
      // there is nothing else it could mean — where a face within reach is a
      // circumstance the walker may or may not be interested in.
      const want = walked
        ? clamp(Math.max(near ? f.near * look : 0, (body.zoomAmount || 0) * f.zoom), 0, 1)
          * (reduced ? f.reduced : 1)
        : 0;
      const attack = reduced ? f.reducedAttackMs : f.attackMs;
      focus = damp(focus, want, tauOf(want > focus ? attack : f.releaseMs), dt);
      if (focus < 1e-4 && want === 0) focus = 0;   // exactly off, not nearly off

      // -------------------------------------------------------- adaptation
      //
      // Silent until the arrival is over, and starting from exact zero when it
      // is. Under reduced motion the target is zero, so it does not snap back —
      // it settles back, on its own curve.
      const a = TUNING.adapt;
      const wantEV = (walked && !reduced)
        ? clamp(-(facing(gaze) - facing(REFERENCE_GAZE)) * a.gain, -a.maxEV, a.maxEV)
        : 0;
      ev = damp(ev, wantEV, tauOf(wantEV < ev ? a.toBrightMs : a.toDarkMs), dt);
      if (Math.abs(ev) < 1e-5 && wantEV === 0) ev = 0;

      // The sealed sun, in the frame's own axes: one vector a frame instead of
      // a basis, and the composite reconstructs its ray from the field of view
      // it is already given.
      undo.copy(camera.quaternion).invert();
      sunView.copy(SUN_DIRECTION).applyQuaternion(undo);

      // ------------------------------------------------------------- glare
      const g = TUNING.glare;
      const overhead = clamp(SUN_DIRECTION.y / g.horizon, 0, 1);
      const wantGlare = walked ? overhead : 0;
      glare = damp(glare, wantGlare, tauOf(g.attackMs), dt);
      if (glare < 1e-4 && wantGlare === 0) glare = 0;

      // ------------------------------------------------------ the sun in view
      //
      // Where the disc lands on the glass, and how much of the picture it is
      // inside. The projection is done by hand rather than through the camera's
      // matrices for the same reason the rotation was undone by hand: the
      // renderer has not refreshed them yet this frame, and a sun projected
      // through last frame's matrix trails the turn.
      const s = TUNING.sun;
      const tanY = Math.tan(camera.fov * DEG * 0.5);
      const tanX = tanY * camera.aspect;
      let inView = 0;
      // Behind the eye there is no disc to project: the divide would flip the
      // sign and put the sun on the opposite side of the frame, which is the
      // one way a screen space effect can be seen to be a screen space effect.
      if (sunView.z < -1e-3) {
        sunNdc.set(sunView.x / -sunView.z / tanX, sunView.y / -sunView.z / tanY);
        // How far outside the box the disc is, as one number, and a soft ramp
        // over the margin rather than a cut at the border.
        const out = Math.max(0, Math.max(Math.abs(sunNdc.x), Math.abs(sunNdc.y)) - 1);
        inView = clamp(1 - out / s.margin, 0, 1);
        inView *= inView * (3 - 2 * inView);          // smoothstep, by hand
      } else {
        // Kept just outside everything, so a frame that reads it while the
        // amount is fading out still gets a position that is off the glass.
        sunNdc.set(0, 3);
      }
      // And it goes with the sun below the horizon, on the same ramp the veil
      // uses: one sunset, not two.
      //
      // "Riduci movimento" halves it, on exactly the reasoning that halves the
      // focus rather than the one that switches the adaptation off. A flare is
      // not a movement — but it is pinned to a point on the glass and it sweeps
      // across the frame when the head turns, which is the part of it a
      // sensitive inner ear can object to. Halved and not off, because somebody
      // who asked for less motion should still be able to see that they are
      // looking at the sun.
      const wantSun = walked ? inView * overhead * (reduced ? f.reduced : 1) : 0;
      sun = damp(sun, wantSun, tauOf(wantSun > sun ? s.attackMs : s.releaseMs), dt);
      if (sun < 1e-4 && wantSun === 0) sun = 0;

      // HOW MUCH THE STREAK IS ALLOWED TO BREATHE. It follows the disc, so it
      // comes and goes with the same geometry and the same hysteresis as the
      // rest of the flare — and it is nought under «riduci movimento», damped
      // rather than switched so the menu does not put a step in the picture.
      const wantStreak = reduced ? 0 : sun;
      streak = damp(streak, wantStreak, tauOf(s.breathMs), dt);
      if (streak < 1e-4 && wantStreak === 0) streak = 0;
      // And its own clock, which runs only while there is a streak to wander:
      // switching away from the sun and back does not show it a minute further
      // into a wander nobody was watching.
      if (streak > 0) sunSeconds += dt;

      // -------------------------------------------------------------- rain
      rain = damp(rain, raining ? 1 : 0, tauOf(TUNING.rain.fadeMs), dt);
      if (rain < 1e-4 && !raining) rain = 0;
      // The drops' own clock runs only while there are drops, so switching the
      // preview on twice does not show it a minute further down the glass.
      if (rain > 0) rainSeconds += dt;

      // HOW THE EYE BEHIND THE GLASS IS MOVING, which is the only thing the
      // shader cannot work out for itself. A turn of the gaze pushes the beads
      // across the glass and walking pushes them up it, and both are damped on
      // the way in: water has mass, so it leans into a turn over a moment
      // rather than teleporting with it.
      const r = TUNING.rain;
      if (rain > 0 && dt > 1e-6) {
        // The turn, as the part of the gaze's change that is across the frame
        // and the part that is up it, per second.
        const turnX = (gaze.x * lastGaze.z - gaze.z * lastGaze.x) / dt;
        const turnY = (gaze.y - lastGaze.y) / dt;
        drag.x = damp(drag.x, clamp(-turnX * r.dragTurn, -r.dragLimit, r.dragLimit),
          tauOf(r.dragMs), dt);
        drag.y = damp(drag.y, clamp(-turnY * r.dragTurn - (body.speed || 0) * r.dragWalk,
          -r.dragLimit, r.dragLimit), tauOf(r.dragMs), dt);
      } else {
        drag.set(0, 0);
      }
      lastGaze.copy(gaze);
    },

    /**
     * Hands the frame what the eye is doing.
     *
     * @param {?object} post the composite, or null to only refresh the numbers
     */
    applyTo(post) {
      drive.focus = focus;
      drive.exposure = ev === 0 ? 1 : 2 ** ev;
      drive.glare = glare;
      drive.sun = sun;
      drive.streak = streak;
      drive.sunSeconds = sunSeconds;
      drive.rain = rain;
      drive.seconds = rainSeconds;
      if (post) post.setEye(drive);
    },
  };
}
