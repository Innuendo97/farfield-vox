import { Euler, Quaternion } from 'three';
import {
  EYE_HEIGHT, PLATFORM, RUN_SPEED, STAIRS, WALK_SPEED,
} from '../world/layout.js';
import { stairHeightAt } from '../world/stairs.js';
import { pathCoord, pathRun } from '../world/terrain-field.js';

// The body under the eye.
//
// Everything in this world is drawn from one point, and until now that point
// was a number: it went where the keys sent it and it was perfectly still when
// they did not. A camera that is perfectly still is not a person standing —
// nobody has ever stood that way — and the frame reads as a photograph on a
// tripod rather than as somewhere a walker is.
//
// THE ONE PRINCIPLE THIS FILE IS BUILT ON: the eye is stabilised and the body
// is not. A head bobs and sways and rolls while it walks, and the two reflexes
// that hold the gaze — vestibulo-ocular and vestibulo-collic — cancel almost
// all of the ROTATION of it and none of the TRANSLATION. So the world a walker
// sees slides; it does not swing. Games that put the oscillation on the
// rotation make the world dance around a fixed head, which is the opposite of
// what a head does, and it is why they make people ill. Here the swing lives
// on the POSITION, and what little rotation there is is an order of magnitude
// below what the body it belongs to actually does.
//
// Nothing here is drawn. It is arithmetic on one transform per frame: no draw
// call, no uniform, no buffer, no allocation after the first frame.

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

// ------------------------------------------------------ the one filter here
//
// A critically damped approach to a moving target, taken in CLOSED FORM.
//
// Three things in this session need the same shape — the look, the zoom, and
// the weight of a stop — and the shape is: arrive, do not ring, do not sail
// past. Written as an integrator it would be conditionally stable exactly where
// it matters: at the response times the look asks for, omega*dt is close to two
// on a thirty hertz frame, and the machine that drops to thirty hertz is the
// machine this has to feel right on. Written in closed form it is exact at any
// dt, cheaper than substepping, and framerate independence is a property of the
// arithmetic rather than a claim about it.
//
// The error of a critically damped second order system, with the target held
// over the frame, is e(t) = (A + B t) e^(-w t) with A the error now and
// B = v + w A. That is the whole derivation, and both lines below are it.
//
// AND IT CANNOT OVERSHOOT. e(t) crosses zero only at t = -A/B, which is in the
// future only when A and B have opposite signs; the one line that zeroes B when
// they do is what turns "never overshoots" from a hope about the tuning into a
// property of the arithmetic. It fires only in a transient where the filter is
// travelling faster than w times the distance left — a target that reverses
// under it — never in ordinary tracking, where a chase always leaves A and B on
// the same side.
export function criticalStep(s, target, omega, dt) {
  const a = s.x - target;
  let b = s.v + omega * a;
  if (a * b < 0) b = 0;
  const decay = Math.exp(-omega * dt);
  s.x = target + (a + b * dt) * decay;
  s.v = (b - omega * a - omega * b * dt) * decay;
  return s.x;
}

// ---------------------------------------------------------------- the tuning
//
// EVERY number that decides how this feels is here and nowhere else, because
// the only way to settle any of them is to walk and it will be settled by
// walking. They are a live object on purpose: in development it hangs off
// window.farfield.presence.tuning and a value changed there takes on the next
// frame, so a session of tasting costs no reload.

export const TUNING = {
  // ------------------------------------------------------------- the look
  //
  // WHAT THE NUMBER MEANS, because a "time constant" for a second order system
  // is three different numbers depending on who is asking. responseMs is the
  // one that can be felt: it is the LAG WHILE THE HAND IS MOVING — how far
  // behind the raw mouse the eye sits during a steady sweep — which is exactly
  // what "perceived latency" is. The natural frequency follows from it,
  // w = 2/response, because a critically damped system trails a ramp by 2/w.
  //
  // Everything else follows: the step response is half done in 0.84 of it and
  // nine tenths done in 1.95 of it, so sixty milliseconds of lag is fifty
  // milliseconds to half and a hundred and seventeen to nine tenths.
  look: {
    responseMs: 60,
    // AND IT SHORTENS WITH THE HAND, which is the answer to "precision must not
    // suffer". What costs precision is not the lag in time, it is the lag in
    // DEGREES: at ten degrees a second sixty milliseconds is two thirds of a
    // degree and nobody can see it, and at five hundred it would be thirty
    // degrees and the eye would read as swimming. So the response is capped by
    // an angle instead: never let the eye sit more than lagCapDeg behind the
    // hand, and inside that, be as smooth as possible. Slow hands get the full
    // silk, fast hands get directness, and neither is a mode — it is one
    // continuous function of how fast the hand is going.
    lagCapDeg: 6,
    responseMinMs: 18,
    // The rate that drives it rises fast and falls slowly on purpose: the fall
    // is what holds the short response through the DECAY TAIL, so the residue
    // of a flick dies in two or three frames instead of being handed back to
    // the slow filter and floating.
    rateRiseTau: 0.02,
    rateFallTau: 0.12,
    // The last degrees of the pitch. The range is NOT reduced — the clamp still
    // stands at exactly where it stood — but the approach to it is cushioned:
    // inside the cushion each pixel of mouse buys less, down to floor at the
    // wall, so the eye settles into the limit instead of hitting it.
    pitchCushionDeg: 8,
    pitchCushionFloor: 0.15,
  },

  // ------------------------------------------------------------- the neck
  //
  // A head sits in FRONT of the axis its body turns about, so an eye that turns
  // also travels, and everything within a few metres shifts by more than a pure
  // rotation would move it. That parallax is most of what tells a body from a
  // tripod.
  //
  // HOW IT IS BUILT, AND WHY IT IS BUILT THAT WAY. The offset is measured from
  // the heading the TORSO has got to, not from the world: the head leads a turn
  // and the shoulders follow it over a third of a second, and the eye rides
  // that lead. Which is what a neck is. It is also the only form of this that
  // keeps the campaign's reference framing: an eye pinned nine centimetres
  // ahead of the walker's axis in absolute terms would move the reference pose
  // by nine centimetres and every paired crop of this campaign with it. This
  // way the lead is exactly zero whenever the body has caught up — which is
  // every held pose, every survey shot, every gate — and is worth up to a
  // couple of finger widths in the middle of a turn, which is where it is for.
  neck: {
    leadM: 0.09,
    followTau: 0.32,
    // How far the head is allowed to be round from the shoulders before the
    // shoulders are simply dragged with it. A neck has about this much and no
    // more, and without it a fast spin would leave the eye a lead of a hundred
    // and twenty degrees — a hand's width of the world sliding sideways, which
    // is a swim and not a parallax. It bounds a TRANSLATION and nothing else:
    // the view still turns as far as it is asked to, at any speed.
    maxLeadDeg: 45,
  },

  // -------------------------------------------------------------- standing
  breath: {
    // Resting respiration. The pair is deliberately not harmonic and the
    // amplitude wanders on a third, slower signal: three incommensurate rates
    // have no common period, so the rise and fall never comes back to the same
    // place and the ear behind the eye never hears a loop.
    hz: 0.30,
    hz2: 0.233,
    mix: 0.32,          // share of the rise the second wave carries
    riseM: 0.0040,      // peak lift of the eye; a chest, not a lift
    swayM: 0.0012,      // a breath is not purely vertical
    pitchDeg: 0.045,    // the chest carries the head a little with it
    wander: 0.30,       // how much the slow signal opens and closes the pair
  },
  drift: {
    // Postural sway: nobody holds a point. This is the slow wander of standing
    // balance, built as four incommensurate octaves weighted about one over f,
    // which is what standing sway measures like — and, unlike a random walk,
    // is bounded by construction. Stand here for an hour and the eye is still
    // orbiting the exact place it started from, which a walk that drifted off
    // its own reference frame could never claim.
    rightM: 0.0025,
    upM: 0.0015,
    forwardM: 0.0025,
  },

  // -------------------------------------------------------------- walking
  gait: {
    // Two beats to a stride. The eye falls and rises once per FOOTFALL and
    // sways once per full cycle of two, which is the two-to-one Lissajous a
    // walking head traces; cadenceHz below is the footfall rate, so the sway
    // runs at half of it.
    cadenceHz: 1.80,      // calm walking cadence, at WALK_SPEED
    cadenceExp: 0.65,     // cadence grows slower than speed does, as legs do
    cadenceMin: 0.90,
    cadenceMax: 2.80,
    verticalM: 0.012,     // amplitude, so twice this peak to peak
    lateralM: 0.005,
    // The body rolls onto the standing foot. Set so that even at a run, where
    // the swing is a sixth bigger, the roll stays under the quarter degree the
    // brief draws the line at.
    rollDeg: 0.20,
    onset: 0.35,          // fraction of walking speed at which the swing is full
    riseTau: 0.20,        // and how long it takes to arrive and to leave
    fallTau: 0.16,
    runGain: 0.30,        // how much bigger the swing gets above walking speed
  },
  weight: {
    // A body has mass, so it takes a moment to get moving and a moment to stop
    // moving, and the head reports both. One overdamped second order system,
    // driven by the ACCELERATION of the body, answers for both ends: it cannot
    // ring, so an arrest is one settle and never a spring.
    hz: 2.0,              // how quickly the settle is over
    damping: 1.0,         // critical: the impulse response has a single hump
    // The drive is scaled so that ONE unit out of the system is a standing
    // start to walking speed. That is what makes the two numbers under it read
    // as what they are: the nose dips this much and the eye sinks this much
    // when a walker leans into their first step, and proportionally less for a
    // gentler one. Without it they would be degrees per unit of an integrator
    // nobody can picture, and the walk that tunes them would be a guess.
    gain: 17.7,
    pitchDeg: 0.30,
    sinkM: 0.006,
    leanDeg: 0.40,        // steady lean into the direction of travel
    leanTau: 0.22,        // slowly, but not so slowly that it outlives the settle
    accelTau: 0.05,       // smoothing on the measured acceleration
  },
  turn: {
    // What a neck does with a turn. Both are meant to be felt and not seen: at
    // the rate the brief names, ninety degrees a second, they are a third of a
    // degree and a quarter of a degree.
    counterRollDegPerDps: 0.30 / 90,
    counterRollMaxDeg: 0.35,
    counterRollTau: 0.10,
    // A hair of rotational inertia: the eye arrives where the mouse sent it a
    // few milliseconds late. Capped hard, because a flick of the mouse is
    // thousands of degrees a second and a lag that scaled with it would read
    // as broken input rather than as a body.
    inertiaSeconds: 0.0028,
    inertiaMaxDeg: 0.35,
    inertiaTau: 0.06,
    // Sidestepping: the roll comes from the change of standing foot, so it
    // rides the gait rather than being a lean of its own.
    strafeRollDeg: 0.18,
    strafeGaitRoll: 0.30,
    strafeTau: 0.20,
  },
  stairs: {
    // The run climbs in six risers of twenty-two centimetres, and at walking
    // speed a tread goes by every eighth of a second: followed literally the
    // eye would climb the staircase in six jumps. What it follows instead is
    // the plane through the nosings — the surface a foot actually travels —
    // and the difference between that plane and the tread underfoot is this
    // offset. It is bounded by half a riser by construction and it is exactly
    // zero everywhere that is not worked stone.
    cadenceScale: 0.72,   // a climb is slower and taller than a walk
    verticalScale: 1.25,
  },
  ground: {
    // Whatever is still a step after all that — the lip of the platform, a
    // ledge taken sideways — is taken over a few frames instead of one.
    jumpM: 0.02,          // below this the ground is a slope and not a step
    tau: 0.10,
    maxM: 0.30,           // and a teleport is not a step: it is not eased at all
  },

  // ------------------------------------------------------------- the effort
  //
  // Breathing that answers to what the body has been doing. One integrator:
  // it fills towards what the current speed asks for over the best part of a
  // minute, so a stroll across the meadow raises it and a sprint raises it
  // faster, and it empties in seconds rather than in tens of seconds — which is
  // the asymmetry of the thing itself. Standing still after a run, the breath
  // is still up for the first few seconds, and that is the whole point: it is
  // the one signal in this file that remembers.
  effort: {
    walk: 0.55,           // where a steady walk settles, out of one
    riseTau: 18,          // filling takes a walk, not a step
    fallTau: 3.5,         // and is a quarter gone in five seconds, all but gone in ten
    breathAmp: 0.80,      // up to 1.8x the resting rise
    breathHz: 0.25,       // and a little quicker with it: about a quarter, at most
    // A LIGHT ENTRAINMENT TO THE STEP, not a lock. Breath and stride here are
    // about one to two and a quarter, and forcing them to exactly one to two
    // would be a metronome inside a metronome. So the phase is pulled towards
    // the stride at a rate capped to a few per cent of the breath's own — over
    // a long walk the two come into step, over a short one they only lean that
    // way, and whatever phase the walk ended on is the phase the breath keeps.
    lockGain: 0.6,
    lockMaxPull: 0.12,   // at most this much of the breath's own rate, ever
  },

  // --------------------------------------------------------------- the zoom
  //
  // The right button leans the eye in. The field of view is the only thing that
  // moves: no focus, no blur, no vignette — those belong to the composite and
  // to the unit that owns it, which reads zoomAmount from the state below.
  //
  // AND THE MOUSE SLOWS WITH IT, by the ratio of the half-angle tangents rather
  // than of the angles: what has to stay constant is how far across the SCREEN
  // a given push of the hand carries the frame, and the screen is the tangent.
  // Without it, leaning in would multiply every tremor of the hand by the
  // magnification, which is the one thing a zoom is for undoing.
  zoom: {
    fovDeg: 32,           // from 45; a lean, not a scope
    // Both ways, the same curve. CAREFUL WITH THE UNIT, because it is not the
    // one the look uses: the look tracks a ramp and its number is the lag while
    // the hand moves, this answers a STEP and its number is the time to nine
    // tenths — which is when a lens has arrived as far as an eye is concerned.
    // Written as a lag the same three hundred milliseconds would be twice the
    // ease, so the natural frequency is 3.89 over it rather than 2 over it.
    easeMs: 300,
  },

  // ---------------------------------------------------------- reduced motion
  // What "Riduci movimento" means, as multipliers on everything above. The
  // brief for it: breathing almost nothing, the step vertical only and smaller,
  // no rotation at all. The stair easing is NOT reduced — it is the one thing
  // here that exists to remove motion rather than to add it.
  // The zoom is NOT reduced: it is asked for by a held button and it is a
  // change of lens, not a movement of the body. The neck and the effort are —
  // the lead is a translation that happens during a rotation, which is the one
  // combination a sensitive inner ear objects to, and a breath that climbs is
  // still a breath that moves.
  reduced: {
    breath: 0.12,
    drift: 0,
    gaitVertical: 0.35,
    gaitLateral: 0,
    roll: 0,
    weight: 0.30,
    lean: 0,
    turn: 0,
    neck: 0,
    effort: 0,
  },
};

// The four octaves of the postural sway, and of the amplitude wander of the
// breath. Rates are about 2.19 apart rather than exactly 2, so no two of them
// share a period; weights fall as roughly one over f.
const OCTAVES = [
  { hz: 0.0170, w: 1.000 },
  { hz: 0.0372, w: 0.620 },
  { hz: 0.0815, w: 0.384 },
  { hz: 0.1783, w: 0.238 },
];
const OCTAVE_NORM = 1 / OCTAVES.reduce((sum, o) => sum + o.w, 0);

// One irrational phase step and a slight change of rate per axis, so the three
// directions of the sway are independent and never come back into step.
const AXIS_PHASE = [0, 2.3999632, 4.7999264, 1.2000184];
const AXIS_RATE = [1, 0.8713, 1.1287, 0.9411];

/** The postural noise on one axis at one instant: bounded, zero mean, no state. */
function sway(t, axis) {
  const rate = AXIS_RATE[axis];
  const phase = AXIS_PHASE[axis];
  let sum = 0;
  for (let i = 0; i < OCTAVES.length; i++) {
    sum += OCTAVES[i].w * Math.sin(TAU * OCTAVES[i].hz * rate * t + phase * (i + 1));
  }
  return sum * OCTAVE_NORM;
}

// The reduced-motion multipliers of the frame being built. One object for the
// life of the page rather than one a frame: this runs sixty times a second for
// as long as somebody is here, and a small object a frame is a collection a
// minute that shows up as a hitch and nothing else.
const GAIN = {
  breath: 1, drift: 1, gaitVertical: 1, gaitLateral: 1, roll: 1, weight: 1, lean: 1, turn: 1,
  neck: 1, effort: 1,
};

/** First order approach, framerate independent. */
function damp(current, target, tau, dt) {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function clamp(value, low, high) {
  return value < low ? low : (value > high ? high : value);
}

/**
 * How far the plane through the nosings sits above the ground under the walker.
 *
 * Zero off the worked stone. On it, the continuous companion of stepHeight() in
 * src/world/stairs.js: the same run described as a ramp instead of as six
 * boxes, clamped at both ends so that the head of the run and the platform
 * agree and the top tread does not hand the eye a step of its own.
 *
 * It is measured against where the walker's feet ACTUALLY are and not against
 * the tread they are over, and the difference matters in one direction. Going
 * up, the two are the same thing. Coming down, the body is already falling from
 * one tread to the next over a few frames of its own, and an offset that
 * assumed the tread underfoot would have fought that fall six times on the way
 * down. Against the feet, the eye rides the ramp exactly, either way.
 */
export function stairEaseAt(x, z, groundY) {
  if (stairHeightAt(x, z) === -Infinity) return 0;
  const u = (z - STAIRS.z) / STAIRS.tread;
  const k = clamp(STAIRS.steps + 0.5 - u, 0, STAIRS.steps);
  const ramp = PLATFORM.height * (k / STAIRS.steps);
  // Never more than a riser, so that a body caught mid fall cannot turn this
  // into a lift.
  const limit = PLATFORM.height / STAIRS.steps;
  return clamp(ramp - groundY, -limit, limit);
}

/**
 * What is under the feet, by name.
 *
 * For the unit that has to play a footfall, which needs to know whether the
 * foot is landing on worn stone or in grass. Nothing here is new information:
 * the platform is a rotated box in the layout, the stair run answers for itself
 * in src/world/stairs.js, and the path is the same signed distance from the
 * same fitted centreline that paints the albedo and cuts the relief — so the
 * sound and the picture can never disagree about where the stone stops.
 */
const PLATFORM_SIN = Math.sin(PLATFORM.rotationY * DEG);
const PLATFORM_COS = Math.cos(PLATFORM.rotationY * DEG);

export function surfaceAt(x, z) {
  const dx = x - PLATFORM.x;
  const dz = z - PLATFORM.z;
  if (Math.abs(dx * PLATFORM_COS - dz * PLATFORM_SIN) <= PLATFORM.width / 2
    && Math.abs(dx * PLATFORM_SIN + dz * PLATFORM_COS) <= PLATFORM.depth / 2) return 'piattaforma';
  if (stairHeightAt(x, z) !== -Infinity) return 'scalinata';
  if (pathRun(z) > 0.5 && Math.abs(pathCoord(x, z)) <= 1) return 'sentiero';
  return 'erba';
}

const STORAGE_KEY = 'farfield.motion';

/** Whether the machine itself has asked for less movement. */
export function systemAsksForLessMotion() {
  try {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

function storedChoice() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'si' || raw === 'no' || raw === 'auto' ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

function storeChoice(choice) {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // A browser that refuses storage still gets the setting, for this visit.
  }
}

/**
 * The body under the eye.
 *
 * Driven once a frame from the walker's own state and applied to the camera
 * after everything else has finished placing it, so that nothing downstream of
 * here has to know it exists.
 */
export function createPresence({ frozen = false, choice = null } = {}) {
  // ------------------------------------------------------------------ state
  let t = 0;                 // the presence clock, which only runs when it may
  let gaitPhase = 0;         // radians through the stride, two footfalls to a turn
  let gaitGain = 0;
  let speedSmooth = 0;
  let prevSpeed = 0;
  let accel = 0;
  let settleY = 0;           // the weight system: position
  let settleV = 0;           // and its velocity
  let lean = 0;
  let counterRoll = 0;
  let inertiaYaw = 0;
  let strafeRoll = 0;
  let stairEase = 0;
  let lagY = 0;
  let prevTarget = null;
  let movingFor = 0;
  let stillFor = 0;
  // The breath runs on its own phase rather than on the clock, because its rate
  // is no longer a constant: a frequency that answers to the effort, read off a
  // sine of the wall clock, would jump the phase every time the effort moved.
  let breathPhase = 0;
  let breathPhase2 = 2.4;
  let effort = 0;
  let breathAmp = 1;
  let breathRate = 1;
  // Where the shoulders have got to. Null until the first frame says which way
  // the walker is facing; see TUNING.neck for why the lead is measured from
  // here and not from the world.
  let bodyYaw = null;
  let neckR = 0;
  let neckF = 0;
  let footPhase = 0;
  let footfalls = 0;
  let foot = 0;
  let footImpact = 0;
  // The lean of the lens. Its own filter, the same shape as the look's.
  const zoomF = { x: 0, v: 0 };
  let zoomWanted = false;
  let baseFov = null;      // whatever the frame's field of view was before we took it
  let lastFov = 0;         // and the last value we wrote, so we can tell it from a pose's
  let zoomDriving = false;
  let interactionState = 'mondo';
  // Null until the first frame has told us where the walker started from. The
  // spawn is not a placement — nobody put the walker there, that is where the
  // page opens — so the body is up and breathing from the first frame of the
  // arrival, which is exactly the frame the greeting is read over.
  let poseSerial = null;
  let held = frozen;         // a held pose shows no body at all

  // The offsets of the frame, in the walker's own frame of reference.
  let offRight = 0;
  let offUp = 0;
  let offForward = 0;
  let offPitch = 0;          // degrees
  let offRoll = 0;
  let offYaw = 0;
  let yaw = 0;
  let quiet = true;          // nothing to apply: the camera is left untouched

  let motionChoice = choice || storedChoice();
  let reduced = motionChoice === 'auto' ? systemAsksForLessMotion() : motionChoice === 'si';

  const euler = new Euler(0, 0, 0, 'YXZ');
  const quaternion = new Quaternion();

  // Handed out rather than rebuilt: this is read every frame by whatever wants
  // to know what the body is doing, and a fresh object a frame is garbage.
  const state = {
    speed: 0,
    cadenceHz: 0,
    stepPhase: 0,      // 0..1 through the stride
    footPhase: 0,      // 0..1 through the current step; 0 is a footfall
    // The footfall as an EVENT, for whoever has to make a sound at it. A phase
    // that passes through zero between two frames is a phase nobody can catch
    // by watching it, so the crossing is counted here: read the counter, and if
    // it has moved since last time, a foot has landed — one sound per landing
    // however slow the frame, and none at all while the body is not walking.
    footfall: 0,
    foot: 0,           // which one; it alternates
    footImpact: 0,     // how hard, 0..1 and a little over at a run
    surface: 'erba',   // sentiero · erba · scalinata · piattaforma
    effort: 0,         // 0..1, how hard the body has been working lately
    movingFor: 0,
    stillFor: 0,
    onStairs: false,
    swing: 0,          // 0..1, how much of the walking body is showing
    zoomAmount: 0,     // 0..1, how far the right button has leaned the lens in
    fovDeg: 0,         // and what that made the field of view, 0 until it is ours
    // What the walker is standing in front of, passed through from the
    // interaction rather than worked out again: mondo · vicino · pannelli ·
    // stanza. The unit of the eye wants to know when the frame is a page being
    // read rather than a meadow being walked.
    interaction: 'mondo',
    reducedMotion: reduced,
    frozen: true,
  };

  function reset() {
    gaitPhase = 0;
    gaitGain = 0;
    speedSmooth = 0;
    prevSpeed = 0;
    accel = 0;
    settleY = 0;
    settleV = 0;
    lean = 0;
    counterRoll = 0;
    inertiaYaw = 0;
    strafeRoll = 0;
    stairEase = 0;
    lagY = 0;
    prevTarget = null;
    movingFor = 0;
    stillFor = 0;
    breathPhase = 0;
    breathPhase2 = 2.4;
    effort = 0;
    breathAmp = 1;
    breathRate = 1;
    bodyYaw = null;
    footPhase = 0;
    footImpact = 0;
    neckR = 0;
    neckF = 0;
    offRight = 0; offUp = 0; offForward = 0;
    offPitch = 0; offRoll = 0; offYaw = 0;
    // The lens goes back to where it was found, and stops being ours. It is NOT
    // written back to the camera here: whoever placed the walker owns the frame
    // it placed them in, field of view included, and a pose that asked for
    // thirty degrees would not thank us for restoring forty-five over the top
    // of it. applyTo below only undoes a value it can prove it wrote itself.
    zoomF.x = 0;
    zoomF.v = 0;
    quiet = true;
  }

  /**
   * The weight system, substepped.
   *
   * A second order system integrated at the frame rate is a second order system
   * that can be unstable at the frame rate: the loop hands out slices of up to
   * a tenth of a second and this one is stiff enough to care. Slicing it costs
   * a handful of multiplies on the worst frame and nothing on a good one.
   */
  function settle(dt) {
    const w = TAU * TUNING.weight.hz;
    const zeta = TUNING.weight.damping;
    let remaining = dt;
    while (remaining > 1e-6) {
      const h = Math.min(remaining, 1 / 240);
      settleV += (accel * TUNING.weight.gain - 2 * zeta * w * settleV - w * w * settleY) * h;
      settleY += settleV * h;
      remaining -= h;
    }
  }

  return {
    /** The live tuning, so it can be tasted while walking. */
    tuning: TUNING,

    /** What the body is doing, for whoever draws what the eye does about it. */
    get state() { return state; },

    get reduced() { return reduced; },
    get choice() { return motionChoice; },
    /** Whether "auto" currently resolves to less motion, for the menu to say so. */
    get systemReduced() { return systemAsksForLessMotion(); },

    setChoice(next) {
      motionChoice = next === 'si' || next === 'no' ? next : 'auto';
      reduced = motionChoice === 'auto' ? systemAsksForLessMotion() : motionChoice === 'si';
      state.reducedMotion = reduced;
      storeChoice(motionChoice);
      return reduced;
    },

    /**
     * One frame of body.
     *
     * @param {number} dt seconds
     * @param {object} m what the walker is doing: speed, forward, right, yaw,
     *   yawRate, x, z, and the pose serial that says whether it was placed
     *   rather than walked.
     */
    update(dt, m) {
      yaw = m.yaw;

      // A PLACED POSE HAS NO BODY. Every comparison this campaign is judged on
      // is a pair of frames taken at the same pose, and a frame with a
      // breathing body in it is a frame nobody can take twice. The serial is
      // the whole test: it moves when — and only when — something put the
      // walker somewhere rather than walked them there, which covers the
      // reference pose, the survey poses, the calibration sweep and the
      // measuring harness, without any of them having to know this exists.
      if (poseSerial === null) {
        poseSerial = m.poseSerial;
      } else if (m.poseSerial !== poseSerial) {
        poseSerial = m.poseSerial;
        held = true;
        reset();
      }
      // And it is let go of by the one thing a placement is not: a walk.
      if (held && !frozen && m.speed > 0.001) held = false;

      state.speed = m.speed;
      state.frozen = held;
      state.interaction = interactionState;
      if (held) {
        state.cadenceHz = 0;
        state.stepPhase = 0;
        state.footPhase = 0;
        state.movingFor = 0;
        state.stillFor = 0;
        state.swing = 0;
        state.onStairs = false;
        state.effort = 0;
        state.footImpact = 0;
        state.zoomAmount = 0;
        state.fovDeg = 0;
        state.surface = surfaceAt(m.x, m.z);
        quiet = true;
        return;
      }

      t += dt;
      const r = TUNING.reduced;
      const k = GAIN;
      k.breath = reduced ? r.breath : 1;
      k.drift = reduced ? r.drift : 1;
      k.gaitVertical = reduced ? r.gaitVertical : 1;
      k.gaitLateral = reduced ? r.gaitLateral : 1;
      k.roll = reduced ? r.roll : 1;
      k.weight = reduced ? r.weight : 1;
      k.lean = reduced ? r.lean : 1;
      k.turn = reduced ? r.turn : 1;
      k.neck = reduced ? r.neck : 1;
      k.effort = reduced ? r.effort : 1;

      // ------------------------------------------------------ what the body is at
      const g = TUNING.gait;
      const onStairs = stairHeightAt(m.x, m.z) !== -Infinity;
      speedSmooth = damp(speedSmooth, m.speed, 0.08, dt);
      const drive = speedSmooth / WALK_SPEED;
      const wanted = clamp(drive / g.onset, 0, 1);
      const rising = m.speed > 0.02;
      if (gaitGain < 0.02 && rising) gaitPhase = 0;   // a stride starts on a footfall
      gaitGain = damp(gaitGain, wanted, rising ? g.riseTau : g.fallTau, dt);
      const swing = gaitGain * (1 + g.runGain * Math.max(0, drive - 1));
      const idle = 1 - gaitGain;

      if (rising) { movingFor += dt; stillFor = 0; } else { stillFor += dt; movingFor = 0; }

      // Cadence follows the speed the body is actually going, not the key that
      // is held: slow down and the steps come slower, which is the whole point
      // of hanging it off the measured speed.
      let cadence = 0;
      if (drive > 1e-4) {
        cadence = clamp(g.cadenceHz * (drive ** g.cadenceExp), g.cadenceMin, g.cadenceMax);
        if (onStairs) cadence *= TUNING.stairs.cadenceScale;
      }
      gaitPhase = (gaitPhase + TAU * (cadence / 2) * dt) % TAU;

      // -------------------------------------------------------------- effort
      //
      // Filled by what the legs are doing and emptied by standing about, with
      // the two rates an order of magnitude apart because that is the asymmetry
      // of the thing: nobody gets their breath back as slowly as they lost it.
      const ef = TUNING.effort;
      const demand = clamp(ef.walk * Math.min(drive, 1) + Math.max(0, drive - 1)
        * (1 - ef.walk) / (RUN_SPEED / WALK_SPEED - 1), 0, 1);
      effort = damp(effort, demand, demand > effort ? ef.riseTau : ef.fallTau, dt);

      // ------------------------------------------------------------ standing
      const b = TUNING.breath;
      const wander = 1 + b.wander * sway(t, 3);
      // The effort rides the breath and nothing else: bigger and a little
      // quicker, from a chest that has been working. Under reduced motion the
      // gain is zero, so the breath stays at exactly the minimum it has now.
      const heave = effort * k.effort;
      breathRate = 1 + ef.breathHz * heave;
      breathAmp = 1 + ef.breathAmp * heave;
      breathPhase += TAU * b.hz * breathRate * dt;
      breathPhase2 += TAU * b.hz2 * breathRate * dt;
      // AND IT LEANS TOWARDS THE STEP.
      //
      // At the RATIO THE TWO ALREADY HAVE, rounded to a whole number of
      // footfalls to the breath — which is what a body does, and it is the only
      // form of this that a light pull can actually reach. Held to a fixed one
      // breath to two strides it would need to bend the breath by a tenth to a
      // third depending on the pace, which is not a lean, it is a leash: the
      // first draft of this did exactly that, could not close the gap at a
      // walk, and could not close it at all at a run. At the nearest whole
      // ratio the gap is a few per cent at any pace, so the cap can stay where
      // "light" means something and the lock still arrives.
      //
      // Nobody sees it happen. A walking body shows the step and not the
      // breath — idle is zero and the breath is gated all the way out — so what
      // the pull decides is WHERE the breath is when the walk ends and it comes
      // back, which is the phase caught from the rhythm of the step just
      // finished, and is the whole of what was asked for.
      if (gaitGain > 0.05 && cadence > 0) {
        const perBreath = Math.max(2, Math.round(cadence / (b.hz * breathRate)));
        const period = TAU / perBreath;
        let err = ((gaitPhase * 2) % TAU) / perBreath - breathPhase;
        err %= period;
        if (err < 0) err += period;
        if (err > period / 2) err -= period;
        const cap = ef.lockMaxPull * TAU * b.hz * breathRate;
        breathPhase += clamp(err * ef.lockGain, -cap, cap) * gaitGain * dt;
      }
      if (breathPhase > TAU) breathPhase -= TAU;
      if (breathPhase2 > TAU) breathPhase2 -= TAU;
      const breath = (Math.sin(breathPhase) * (1 - b.mix)
        + Math.sin(breathPhase2) * b.mix) * wander * breathAmp;
      const breathGain = idle * k.breath;

      const d = TUNING.drift;
      const driftGain = idle * k.drift;

      // ------------------------------------------------------------- walking
      const vertical = -Math.cos(2 * gaitPhase) * g.verticalM * swing * k.gaitVertical
        * (onStairs ? TUNING.stairs.verticalScale : 1);
      const lateral = Math.sin(gaitPhase) * g.lateralM * swing * k.gaitLateral;

      // --------------------------------------------------------------- weight
      const w = TUNING.weight;
      if (dt > 1e-6) accel = damp(accel, (m.speed - prevSpeed) / dt, w.accelTau, dt);
      prevSpeed = m.speed;
      settle(dt);
      const leanTarget = -w.leanDeg * clamp(m.forward / WALK_SPEED, -1, 1.5);
      lean = damp(lean, leanTarget, w.leanTau, dt);

      // ---------------------------------------------------------------- turns
      const turn = TUNING.turn;
      counterRoll = damp(
        counterRoll,
        clamp(-turn.counterRollDegPerDps * m.yawRate, -turn.counterRollMaxDeg, turn.counterRollMaxDeg),
        turn.counterRollTau, dt,
      );
      inertiaYaw = damp(
        inertiaYaw,
        clamp(-turn.inertiaSeconds * m.yawRate, -turn.inertiaMaxDeg, turn.inertiaMaxDeg),
        turn.inertiaTau, dt,
      );
      // THE NECK. The shoulders chase the heading the eye already has, and the
      // eye rides out on the lead between them. In the walker's own frame the
      // heading it is turning FROM sits at (sin, cos) of the lead, so the eye
      // is that much off the axis sideways and a little of it forwards — which
      // is a point travelling on a circle of leadM, exactly what it is.
      //
      // There is no clamp anywhere in here and there is not meant to be: the
      // view turns through three hundred and sixty degrees in yaw exactly as it
      // did, and all this adds is where the eye is while it does.
      const nk = TUNING.neck;
      if (bodyYaw === null) bodyYaw = m.yaw;
      bodyYaw = damp(bodyYaw, m.yaw, nk.followTau, dt);
      neckR = 0;
      neckF = 0;
      const maxLead = nk.maxLeadDeg * DEG;
      if (m.yaw - bodyYaw > maxLead) bodyYaw = m.yaw - maxLead;
      else if (bodyYaw - m.yaw > maxLead) bodyYaw = m.yaw + maxLead;
      const lead = m.yaw - bodyYaw;
      // Under a thousandth of a degree the shoulders have arrived: said exactly,
      // so that standing still adds exactly nothing rather than a micron of
      // something. At that angle the eye is nine tenths of a micrometre off the
      // axis, which is four orders of magnitude below the wavelength of the
      // light it would be seen by.
      if (Math.abs(lead) < 1e-5) bodyYaw = m.yaw;
      else {
        neckR = -nk.leadM * Math.sin(lead) * k.neck;
        neckF = nk.leadM * (1 - Math.cos(lead)) * k.neck;
      }

      const sideways = clamp(m.right / WALK_SPEED, -1, 1);
      strafeRoll = damp(strafeRoll, -turn.strafeRollDeg * sideways, turn.strafeTau, dt);
      // Sidestepping puts more of the roll on the change of standing foot,
      // which is the gait roll and not a lean.
      const strafeSwing = 1 + turn.strafeGaitRoll * Math.abs(sideways);

      // --------------------------------------------------- the ground beneath
      //
      // Not smoothed. The ease is exactly what the staircase is not, read from
      // the same position in the same frame, so the sum of the two is the ramp
      // to the last bit — and a filter on one half of an exact cancellation is
      // a filter that un-cancels it, which is six absorbed treads instead of
      // none.
      stairEase = stairEaseAt(m.x, m.z, m.eyeY - EYE_HEIGHT);
      const target = m.eyeY + stairEase;
      if (prevTarget !== null) {
        const jump = target - prevTarget;
        if (Math.abs(jump) > TUNING.ground.jumpM) lagY = clamp(lagY - jump, -TUNING.ground.maxM, TUNING.ground.maxM);
      }
      prevTarget = target;
      lagY = damp(lagY, 0, TUNING.ground.tau, dt);

      // ------------------------------------------------------------- assembly
      offUp = breath * b.riseM * breathGain
        + sway(t, 1) * d.upM * driftGain
        + vertical
        + stairEase
        + lagY
        - settleY * w.sinkM * k.weight;
      offRight = breath * b.swayM * breathGain
        + sway(t, 0) * d.rightM * driftGain
        + lateral
        + neckR;
      offForward = sway(t, 2) * d.forwardM * driftGain
        + neckF;

      offPitch = breath * b.pitchDeg * breathGain
        - settleY * w.pitchDeg * k.weight
        + lean * k.lean;
      offRoll = (Math.sin(gaitPhase) * g.rollDeg * swing * strafeSwing + strafeRoll) * k.roll
        + counterRoll * k.turn;
      offYaw = inertiaYaw * k.turn;

      quiet = false;

      // ---------------------------------------------------------------- zoom
      //
      // The same filter as the look, on a number instead of an angle, so the
      // way in and the way out are the one curve read forwards and backwards.
      // The snap at the bottom is what lets the lens be given back EXACTLY:
      // an exponential arrives at zero in the limit and the limit is not a
      // frame, and a field of view a millionth of a degree off the pose's is a
      // frame the gates cannot compare at the byte.
      criticalStep(zoomF, zoomWanted ? 1 : 0, 3890 / TUNING.zoom.easeMs, dt);
      // A tenth of a thousandth of the way in is thirteen thousandths of a
      // degree of field, which is three hundredths of a pixel of the frame it
      // is looking through: below any eye, and the only price of a lens that
      // can be handed back at exactly the number it was borrowed at.
      if (!zoomWanted && zoomF.x < 1e-4) { zoomF.x = 0; zoomF.v = 0; }
      state.zoomAmount = zoomF.x;
      state.fovDeg = baseFov === null ? 0 : baseFov + (TUNING.zoom.fovDeg - baseFov) * zoomF.x;

      // The footfall, caught on the way past. The phase runs 0 to 1 over one
      // step and a step that has wrapped is a foot that has landed; below a
      // trace of swing there is no walk and so no landing, which is what keeps
      // a walker rocking on the spot from tapping out a rhythm.
      const nextFoot = (gaitPhase * 2 / TAU) % 1;
      if (gaitGain > 0.02 && nextFoot < footPhase) {
        footfalls++;
        foot ^= 1;
        footImpact = swing;
      }
      footPhase = nextFoot;

      state.cadenceHz = cadence;
      state.stepPhase = gaitPhase / TAU;
      state.footPhase = footPhase;
      state.footfall = footfalls;
      state.foot = foot;
      state.footImpact = footImpact;
      state.surface = surfaceAt(m.x, m.z);
      state.effort = effort;
      state.movingFor = movingFor;
      state.stillFor = stillFor;
      state.onStairs = onStairs;
      state.swing = swing;
    },

    /**
     * Whether the right button is asking for the lens, and whether it may have
     * it.
     *
     * The gate is the caller's because the caller is the only one that knows:
     * a panel open on a face, a room being read, the menu up, the three seconds
     * of calibration. Inside any of those the zoom is not refused, it is
     * WITHDRAWN — the target goes to zero and the same curve takes it out — so
     * walking into a panel with the button held never snaps the frame.
     */
    setZoom(wanted) {
      zoomWanted = Boolean(wanted);
    },

    /** What the walker is standing in front of, for the state below. */
    setInteraction(next) {
      interactionState = next || 'mondo';
    },

    /**
     * How much slower the mouse should be, for the field of view it is looking
     * through. One if the lens is ours to nobody.
     */
    get lookScale() {
      if (zoomF.x === 0 || baseFov === null) return 1;
      const fov = baseFov + (TUNING.zoom.fovDeg - baseFov) * zoomF.x;
      return Math.tan(fov * DEG / 2) / Math.tan(baseFov * DEG / 2);
    },

    /**
     * Puts the body under the camera, after everything else has placed it.
     *
     * The translation is in the walker's own frame — along their right, along
     * their forward, and along world up rather than along where they are
     * looking, because a head that bobs while looking at its feet still bobs
     * vertically. The rotation is in the camera's frame, because a roll is a
     * roll about the direction of the gaze.
     *
     * A held pose leaves the camera untouched, to the bit: no add of zero, no
     * multiply by an identity that a floating point unit is entitled to round.
     */
    applyTo(camera) {
      // THE LENS FIRST, and on its own terms.
      //
      // The base is read at the moment the lens becomes ours and not before, so
      // whatever the pose, the menu or a future weather asked for is what the
      // zoom departs from and returns to. Giving it back is guarded by the last
      // value written: if the camera still holds it, it is ours to undo; if
      // something else has since set the field of view — a dev pose, a survey
      // shot — then it is theirs and we leave it exactly alone.
      if (zoomF.x !== 0) {
        if (!zoomDriving) baseFov = camera.fov;
        camera.fov = baseFov + (TUNING.zoom.fovDeg - baseFov) * zoomF.x;
        camera.updateProjectionMatrix();
        lastFov = camera.fov;
        zoomDriving = true;
      } else if (zoomDriving) {
        if (camera.fov === lastFov) {
          camera.fov = baseFov;
          camera.updateProjectionMatrix();
        }
        zoomDriving = false;
      }

      if (quiet) return;
      const s = Math.sin(yaw);
      const c = Math.cos(yaw);
      camera.position.x += offRight * c - offForward * s;
      camera.position.z += -offRight * s - offForward * c;
      camera.position.y += offUp;
      if (offPitch !== 0 || offRoll !== 0 || offYaw !== 0) {
        euler.set(offPitch * DEG, offYaw * DEG, offRoll * DEG, 'YXZ');
        quaternion.setFromEuler(euler);
        camera.quaternion.multiply(quaternion);
      }
    },

    /** What the last frame actually moved, for the measurements that check it. */
    offsets() {
      return {
        right: offRight, up: offUp, forward: offForward,
        pitch: offPitch, roll: offRoll, yaw: offYaw,
        // The neck on its own, because its whole job is to be zero when the
        // body has caught up and only then.
        neckRight: neckR, neckForward: neckF,
        effort,
        // The breath as numbers, for the harness that has to prove it climbs:
        // the phase it is at, and the two multipliers the effort put on it.
        breathPhase, breathAmp, breathRate,
        zoom: zoomF.x,
        // The weight system on its own, which is the only term whose shape —
        // one settle and not two — is a requirement rather than a taste.
        settle: settleY,
      };
    },

    /**
     * How much of the body's own rotation the eye is holding back.
     *
     * The comparison is against a head bolted rigidly to the trunk, because
     * that is what stabilisation is measured against: a walking trunk rolls
     * about five degrees and pitches about two and a half over a stride, at a
     * bob of a centimetre and a bit, so scaled to whatever bob is set above,
     * that is the rotation the same oscillation of the position would carry if
     * nothing held it back.
     *
     * Only the OSCILLATING rotation counts. The lean into the direction of
     * travel and the counter roll of a turn are posture: they follow the speed
     * and the turn rate over tenths of a second and back, and a frame that
     * tilts by four tenths of a degree over a third of a second is not a frame
     * that is swinging.
     */
    vestibular() {
      const g = TUNING.gait;
      const bob = g.verticalM / 0.012;
      const freeRollDeg = 5.0 * bob;
      const freePitchDeg = 2.5 * bob;
      // Nothing oscillates the pitch while walking: the two beat step is put on
      // the vertical, the lateral and the roll, and on nothing else.
      const pitchDeg = 0;
      return {
        rollDeg: g.rollDeg,
        pitchDeg,
        freeRollDeg,
        freePitchDeg,
        rollAttenuation: 1 - g.rollDeg / freeRollDeg,
        pitchAttenuation: 1 - pitchDeg / freePitchDeg,
      };
    },
  };
}
