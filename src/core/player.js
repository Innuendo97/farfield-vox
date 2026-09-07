import { Euler, Vector3 } from 'three';
import {
  AREA_CENTER, AREA_HARD_RADIUS, AREA_SOFT_RADIUS,
  EYE_HEIGHT, RUN_SPEED, SPAWN, WALK_SPEED,
} from '../world/layout.js';
import { criticalStep, TUNING } from './presence.js';
import { AVATAR, STANDING, SWITCH, bodyFade, reachEase, thirdPersonEye } from './avatar.js';

// THE LOOK IS TWO ANGLES, NOT ONE.
//
// The target is the raw sum of everything the mouse has said, to the last
// count, and it is what decides how far a gesture turns the world: it is
// untouched arithmetic and the sensitivity below is exactly the sensitivity it
// always was. The pose is a critically damped chase of that target, and it is
// what the frame is drawn from. Between the two sits every millisecond of silk
// and no degree of authority: the pose always arrives at the target, so the
// same gesture turns the same amount, and nothing here can drift, float, or
// hand back less rotation than was asked for.
//
// What it removes is the QUANTISATION. A mouse reports in whole counts on its
// own clock and a frame samples whatever has arrived by the time it looks: at
// a hundred and twenty five reports a second against sixty frames, some frames
// get two counts and some get three, and the eye turns in a rhythm that belongs
// to neither the hand nor the world. Src/core/input.js now takes the raw stream
// where the browser has one, so the sum is right to the report rather than to
// the frame; this makes the sum SMOOTH as well as right.
//
// The tuning lives with the rest of the body, in src/core/presence.js: it is
// the same thing being tuned — how this world feels to be inside — and one
// live object on window.farfield.presence.tuning is worth more at three in the
// morning than two tidy ones.

const DEG = Math.PI / 180;
const PITCH_LIMIT = 85 * DEG;
const LOOK_SENSITIVITY = 0.0022;   // radians per pixel of raw mouse movement
const ACCEL_TAU = 0.09;            // seconds; short enough to feel direct, long enough to weigh
const RECALL_TURN_RATE = 22 * DEG; // radians per second of steering back toward the centre
const PLAYER_RADIUS = 0.45;

// The ledge rule.
//
// The stair run is a flat topped box a metre and a third tall at its head, and
// nothing was stopping a walker from leaving it sideways: one step off the top
// tread and the ground under the eye fell the whole height of the platform
// between two frames. Everything else in this world that a body cannot pass
// through has a footprint, but the run has to be walked along, so its sides
// cannot be one — the rule has to be about the drop and not about the shape.
//
// A step is refused when it would fall further than a stride can fall. The
// second test is what keeps that from turning a hillside into a wall: a drop
// only counts as a ledge if it is steeper than anything a slope could be, so a
// long stride taken on a slow machine still walks downhill.
const MAX_STEP_DOWN = 0.30;
const LEDGE_SLOPE = 2.0;

// And whatever is still a drop after that is taken over a few frames rather
// than in one. Short: this is a step down, not a fall, and a body that floats
// down a tread reads as a body on a lift.
const FALL_TAU = 0.07;

/** First order approach, framerate independent. */
function damp(current, target, tau, dt) {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

// Smooth 1 -> 0 ramp used for the invisible perimeter. Cubic so the onset is
// not felt as a step and the stop at the hard radius is asymptotic.
function falloff(value, start, end) {
  const t = (value - start) / (end - start);
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  return 1 - t * t * (3 - 2 * t);
}

export class Player {
  // Where the mouse has asked to be, exactly, and where the eye has got to.
  #yawTarget = SPAWN.yaw * DEG;
  #pitchTarget = 0;
  #yawF = { x: SPAWN.yaw * DEG, v: 0 };
  #pitchF = { x: 0, v: 0 };
  // The target as it was last frame, which is the only honest way to ask how
  // fast the hand is going.
  #yawAsked = SPAWN.yaw * DEG;
  #pitchAsked = 0;
  // How fast the hand is going, in degrees a second, smoothed: it rises fast
  // and falls slowly, so a flick keeps its short response through its own tail.
  #handRate = 0;
  // How much of the mouse a leaned-in lens is allowed to have. One until
  // somebody says otherwise, and never zero.
  #lookScale = 1;
  #velocity = new Vector3();
  #euler = new Euler(0, 0, 0, 'YXZ');
  #groundHeight = () => 0;
  #blockers = [];
  // Where the feet are, which follows the ground down rather than jumping to
  // it. Null until the first frame has somewhere to stand.
  #stance = null;
  // Where a placement put the EYE, when the placement named an altitude for it
  // rather than standing a walker somewhere; null whenever the walker's own law
  // is the one in force. See setPose, which is the only thing that sets it, and
  // update, which is the only thing that hands it back.
  #placedEye = null;
  // Which person the frame is drawn in, and where the boom put the camera last
  // time it was asked. 'prima' | 'terza'.
  //
  // THE ARRIVAL IS THIRD PERSON, which is the committente's answer and also the
  // only one of the two the reference pictures show. The walker who wants his
  // own eyes presses V.
  #person = 'terza';
  // How much of the arm is out, and how much of the way through the switch we
  // are. The person above is where we are GOING; this is where we have got to,
  // and between the two of them is the third of a second the camera takes to
  // leave the eye.
  #reach = 1;
  #reachFrom = 1;
  #reachT = 1;
  #rigEye = { x: 0, y: 0, z: 0, arm: 0 };
  // What the camera cannot pass through. Not the same list as #blockers: that
  // one is a footprint, and a camera also has to know how TALL a thing is --
  // a rock a knee high is not in the way of an eye at a metre and a half.
  #solids = [];
  #lookRate = 0;
  // Which way the eye is turning and how fast, in degrees a second. lookRate
  // above is unsigned and includes the pitch, because what reads it is a
  // governor that only cares how much of the frame is changing; a body that
  // banks into a turn has to know which turn.
  #yawRate = 0;
  // How many times the walker has been PLACED rather than walked. The reference
  // pose, the survey poses and the calibration sweep all go through setPose,
  // and everything downstream that has to tell a placement from a walk can tell
  // them apart by watching this instead of being told by each caller.
  #poseSerial = 0;

  position = new Vector3(SPAWN.x, EYE_HEIGHT, SPAWN.z);

  setGroundSampler(fn) { this.#groundHeight = fn; return this; }

  // Footprints the player cannot walk into: { x, z, halfWidth, halfDepth, rotationY }
  setBlockers(list) { this.#blockers = list; return this; }

  /**
   * Boxes the third person camera cannot pass through, with their heights:
   * { x, z, halfWidth, halfDepth, rotationY, y0, y1 }.
   *
   * A SECOND LIST AND NOT A SECOND OPINION. It is built beside the walker's
   * footprints, from the same plan, in the one seat that knows what this hub is
   * made of -- see src/world/hub.js. What it adds is the vertical extent, which
   * a body walking on the floor never needs and a lens on a five metre arm
   * always does.
   */
  setSolids(list) { this.#solids = list || []; return this; }

  /**
   * How far a leaned-in lens has slowed the mouse, as a plain multiplier.
   *
   * It is a ratio of tangents and not of angles, so what stays constant is how
   * far across the SCREEN a push of the hand carries the frame. See TUNING.zoom
   * in src/core/presence.js, which is where the number comes from.
   */
  setLookScale(scale) {
    this.#lookScale = scale > 0 ? scale : 1;
    return this;
  }

  setPose(pose) {
    this.position.set(pose.position.x, pose.position.y, pose.position.z);
    // A placement is not a turn. Target and pose are set to the same angle and
    // the filter's velocity is thrown away, so the very first frame at a pose
    // is already exactly the pose — which is the whole of the determinism rail
    // this campaign's paired crops stand on, and it would be undone by a
    // smoother that arrived a frame later.
    this.#yawTarget = pose.yaw * DEG;
    this.#pitchTarget = pose.pitch * DEG;
    this.#yawF.x = this.#yawTarget;
    this.#pitchF.x = this.#pitchTarget;
    this.#yawF.v = 0;
    this.#pitchF.v = 0;
    this.#yawAsked = this.#yawTarget;
    this.#pitchAsked = this.#pitchTarget;
    this.#handRate = 0;
    this.#lookRate = 0;
    this.#yawRate = 0;
    this.#velocity.set(0, 0, 0);
    // A pose is a placement, not a walk: whatever it stands on, it stands on
    // from the first frame.
    this.#stance = null;
    // AND A POSE THAT NAMES AN ALTITUDE IS OBEYED AT IT, TO THE MILLIMETRE.
    //
    // Two different things get written into a pose's y and they were being read
    // as one. EYE_HEIGHT is not an altitude — it is how far a walker's eye sits
    // above his own feet — so a pose that writes it is standing a WALKER
    // somewhere, and how high that puts his eye is the ground's business and
    // not the pose's. The two framings fitted against the reference pictures
    // write no such constant: they write the altitude the fit solved for, and
    // the ground beneath them is 87 mm below zero by day and 173 mm by night,
    // so the two readings are nowhere near each other.
    //
    // Until this line existed the walker's law was applied to both, and the
    // first update after any placement put the eye back at stance + EYE_HEIGHT.
    // At the two fitted framings that is three centimetres above the fit by day
    // and twenty by night — outside the tolerance those framings are judged on,
    // in every live frame the campaign has ever taken at them. The offline fits
    // never came through here, which is the whole reason the page and the
    // measurements could disagree for this long without either looking wrong.
    //
    // So an altitude is honoured literally, and deriving the eye from the
    // stance goes back to being what it always was: the WALKER's law, and his
    // alone. He gets it back the moment he walks, in update below.
    this.#placedEye = pose.position.y === EYE_HEIGHT ? null : pose.position.y;
    this.#poseSerial++;
    return this;
  }

  /**
   * Everything the mouse has said since the last frame, into the target.
   *
   * The pitch keeps the limit it always had, to the degree. What changes is the
   * last few degrees before it: inside the cushion a pixel of mouse buys less
   * and less, down to a floor, so the eye eases into the ceiling of the sky
   * instead of being stopped against it. The clamp is still there underneath —
   * the floor is a floor and not a zero, so the limit is reachable, and it is
   * the same limit.
   */
  look(delta) {
    const sensitivity = LOOK_SENSITIVITY * this.#lookScale;
    this.#yawTarget -= delta.x * sensitivity;
    let dp = -delta.y * sensitivity;
    if (dp !== 0) {
      const cushion = TUNING.look.pitchCushionDeg * DEG;
      const headroom = dp > 0 ? PITCH_LIMIT - this.#pitchTarget : PITCH_LIMIT + this.#pitchTarget;
      if (headroom < cushion) {
        const floor = TUNING.look.pitchCushionFloor;
        dp *= floor + (1 - floor) * (headroom / cushion);
      }
      this.#pitchTarget = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.#pitchTarget + dp));
    }
  }

  /**
   * One frame of the chase, and the two rates that come out of it.
   *
   * The response is chosen by how fast the hand is going, and it is chosen by
   * an ANGLE: never let the pose sit more than lagCapDeg behind the target. At
   * a slow, aiming hand that cap is never reached and the full smoothing
   * applies — sixty milliseconds at ten degrees a second is two thirds of a
   * degree of lag, which is a fifth of what the mouse itself quantises to. At a
   * sweep it tightens continuously, and at a flick it sits at the floor. There
   * is no threshold and there are no modes: one division, clamped.
   */
  #chase(dt) {
    if (dt <= 0) return;
    const look = TUNING.look;
    // What the HAND is doing, read off what the target moved and not off how
    // far behind the pose is. The two are not the same number and the
    // difference is not small: the pose trails the target by the response, so
    // the gap divided by the frame is the rate multiplied by the response over
    // the frame — seven times the truth on a fast machine, and a response that
    // shrank because the machine was quick.
    const dYaw = this.#yawTarget - this.#yawAsked;
    const dPitch = this.#pitchTarget - this.#pitchAsked;
    this.#yawAsked = this.#yawTarget;
    this.#pitchAsked = this.#pitchTarget;
    // One rate for both axes, so a diagonal sweep is not smoothed differently
    // from a flat one.
    const asked = Math.hypot(dYaw, dPitch) / DEG / dt;
    this.#handRate = damp(
      this.#handRate, asked,
      asked > this.#handRate ? look.rateRiseTau : look.rateFallTau, dt,
    );
    const response = Math.min(
      look.responseMs / 1000,
      Math.max(look.responseMinMs / 1000, look.lagCapDeg / Math.max(this.#handRate, 1e-6)),
    );
    const omega = 2 / response;
    const wasFacing = this.#yawF.x;
    const wasPitch = this.#pitchF.x;
    criticalStep(this.#yawF, this.#yawTarget, omega, dt);
    criticalStep(this.#pitchF, this.#pitchTarget, omega, dt);
    // Both rates are read off the POSE and not off the target: what a quality
    // governor wants to know is how much of the frame is changing, and what a
    // body wants to bank into is the turn the eye is actually making.
    this.#yawRate = ((this.#yawF.x - wasFacing) / DEG) / dt;
    this.#lookRate = (Math.abs(this.#yawF.x - wasFacing) + Math.abs(this.#pitchF.x - wasPitch)) / DEG / dt;
  }

  update(dt, input) {
    if (input.locked) this.look(input.drainLook());
    this.#chase(dt);
    this.#run(dt);

    const axis = input.engaged ? input.axis() : { x: 0, z: 0 };
    const speed = input.running ? RUN_SPEED : WALK_SPEED;
    const sin = Math.sin(this.#yawF.x);
    const cos = Math.cos(this.#yawF.x);

    // Yaw 0 looks north (-Z). Forward is (-sin, -cos) and right is (cos, -sin);
    // axis.z is negative when walking forward, so it multiplies the backward
    // vector (sin, cos).
    let wishX = (axis.x * cos + axis.z * sin) * speed;
    let wishZ = (-axis.x * sin + axis.z * cos) * speed;

    const perimeter = this.#perimeter();
    if (perimeter.damping < 1) {
      // Only the component that leaves the area is damped; sliding along the
      // boundary and walking back in stay at full speed.
      const outward = wishX * perimeter.nx + wishZ * perimeter.nz;
      if (outward > 0) {
        const removed = outward * (1 - perimeter.damping);
        wishX -= removed * perimeter.nx;
        wishZ -= removed * perimeter.nz;
      }
    }

    const blend = 1 - Math.exp(-dt / ACCEL_TAU);
    this.#velocity.x += (wishX - this.#velocity.x) * blend;
    this.#velocity.z += (wishZ - this.#velocity.z) * blend;

    if (perimeter.damping < 1) this.#recall(dt, perimeter);

    const fromX = this.position.x;
    const fromZ = this.position.z;
    this.position.x += this.#velocity.x * dt;
    this.position.z += this.#velocity.z * dt;

    this.#resolveBlockers();
    this.#refuseLedges(fromX, fromZ);

    // A PLACEMENT LASTS UNTIL THE BODY WALKS OUT OF IT. Held still at a named
    // altitude this is a camera on a tripod and the altitude is the whole of
    // the point; one step and it is a walker again, and a walker's eye rides
    // over his own feet. Read off the ground actually covered rather than off
    // the keys, so that a body leaning into a wall keeps its placement and one
    // pushed out of a footprint does not — the same epsilon the ledge rule
    // calls standing still.
    if (this.#placedEye !== null
      && Math.hypot(this.position.x - fromX, this.position.z - fromZ) > 1e-6) {
      this.#placedEye = null;
    }

    // The stance is followed either way, because it is where the FEET are, and
    // at a named altitude those are the avatar's feet with the camera up on its
    // own arm above them. Keeping it warm under a placement is also what lets
    // the walker have his law back without a step in the picture.
    const ground = this.#groundHeight(this.position.x, this.position.z);
    if (this.#stance === null || ground >= this.#stance) this.#stance = ground;
    else this.#stance += (ground - this.#stance) * (1 - Math.exp(-dt / FALL_TAU));
    this.position.y = this.#placedEye === null ? this.#stance + EYE_HEIGHT : this.#placedEye;
  }

  /**
   * One frame of the switch.
   *
   * The clock runs from wherever the arm was when the key was pressed, so a key
   * pressed halfway through a switch turns the run round from where it is rather
   * than snapping back to an end. What it never does is overshoot or hang: the
   * timer is clamped, the easing is monotone, and at 0.35 s it is exactly there.
   */
  #run(dt) {
    const want = this.#person === 'terza' ? 1 : 0;
    if (this.#reach === want) return;
    this.#reachT = Math.min(1, this.#reachT + dt / SWITCH.seconds);
    this.#reach = this.#reachFrom + (want - this.#reachFrom) * reachEase(this.#reachT);
    if (this.#reachT >= 1) this.#reach = want;
  }

  /**
   * Undoes whichever half of the step walked off a ledge.
   *
   * The two axes are tried on their own so that a walker pressed against the
   * side of the stair run still walks along it: only the component that leaves
   * the stone is given back, exactly as the perimeter and the footprints do.
   */
  #refuseLedges(fromX, fromZ) {
    const toX = this.position.x;
    const toZ = this.position.z;
    const start = this.#groundHeight(fromX, fromZ);
    const moved = Math.hypot(toX - fromX, toZ - fromZ);
    if (moved <= 1e-6) return;
    const isLedge = (x, z) => {
      const drop = start - this.#groundHeight(x, z);
      return drop > MAX_STEP_DOWN && drop > moved * LEDGE_SLOPE;
    };
    if (!isLedge(toX, toZ)) return;
    if (!isLedge(toX, fromZ)) this.position.z = fromZ;
    else if (!isLedge(fromX, toZ)) this.position.x = fromX;
    else this.position.set(fromX, this.position.y, fromZ);
  }

  // A barely perceptible curve of the walking direction back toward the centre,
  // so leaving the area feels like drifting rather than hitting something.
  #recall(dt, perimeter) {
    const speed = Math.hypot(this.#velocity.x, this.#velocity.z);
    if (speed < 0.05) return;
    const strength = 1 - perimeter.damping;
    const heading = Math.atan2(this.#velocity.z, this.#velocity.x);
    const inward = Math.atan2(-perimeter.nz, -perimeter.nx);
    let diff = ((inward - heading + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    const step = Math.max(-1, Math.min(1, diff)) * RECALL_TURN_RATE * strength * dt;
    const turned = heading + step;
    this.#velocity.x = Math.cos(turned) * speed;
    this.#velocity.z = Math.sin(turned) * speed;
  }

  #perimeter() {
    const dx = this.position.x - AREA_CENTER.x;
    const dz = this.position.z - AREA_CENTER.z;
    const r = Math.hypot(dx, dz) || 1e-6;
    return {
      radius: r,
      nx: dx / r,
      nz: dz / r,
      damping: falloff(r, AREA_SOFT_RADIUS, AREA_HARD_RADIUS),
    };
  }

  #resolveBlockers() {
    for (const b of this.#blockers) {
      const s = Math.sin(b.rotationY);
      const c = Math.cos(b.rotationY);
      const dx = this.position.x - b.x;
      const dz = this.position.z - b.z;
      // Into the box's local frame, where the footprint is axis aligned.
      let lx = dx * c - dz * s;
      let lz = dx * s + dz * c;
      const ex = b.halfWidth + PLAYER_RADIUS;
      const ez = b.halfDepth + PLAYER_RADIUS;
      if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;
      // Push out along the shallowest axis of penetration.
      if (ex - Math.abs(lx) < ez - Math.abs(lz)) lx = Math.sign(lx || 1) * ex;
      else lz = Math.sign(lz || 1) * ez;
      this.position.x = b.x + lx * c + lz * s;
      this.position.z = b.z - lx * s + lz * c;
    }
  }

  /**
   * First person or third, and it is one door rather than two.
   *
   * The walker does not change: this.position stays the AVATAR's eye in both,
   * which is what lets the switch be continuous and what keeps every pose, the
   * survey and the measuring harness meaning the same thing in either. What
   * changes is where applyTo puts the camera.
   *
   * THE FIELD OF VIEW IS THE CALLER'S, as it already is for every pose: third
   * person asks for RIG.fov, and whoever owns the camera applies it the same
   * way src/main.js applies a pose's own fov today.
   *
   * AND THE TWO FITTED FRAMINGS STAY FIRST PERSON. Their y is where the CAMERA
   * stood in the reference pictures, not where the avatar stood; placing one of
   * them in third person would stand the avatar at the camera's altitude and
   * swing the boom back from there, which is a different picture. They are
   * camera placements and they are photographed as camera placements.
   */
  setPerson(which) {
    const next = which === 'terza' ? 'terza' : 'prima';
    if (next !== this.#person) {
      this.#person = next;
      this.#reachFrom = this.#reach;
      this.#reachT = 0;
    }
    return this;
  }

  /**
   * The switch, with no run at all: the person a placement arrives in.
   *
   * A POSE IS A PLACEMENT AND NOT A GESTURE, which is the same rule setPose
   * keeps for the look: the very first frame at a pose has to BE the pose, and
   * a camera still sliding out of the walker's head is not. Every paired crop
   * this campaign judges anything on stands on that.
   */
  placePerson(which) {
    this.#person = which === 'terza' ? 'terza' : 'prima';
    this.#reach = this.#person === 'terza' ? 1 : 0;
    this.#reachFrom = this.#reach;
    this.#reachT = 1;
    return this;
  }

  get person() { return this.#person; }

  /** How far out the boom is, 0 to 1, for anything that has to wait for it. */
  get reach() { return this.#reach; }

  /** Where the boom put the camera last frame, for anything that draws a body. */
  get rigEye() { return this.#rigEye; }

  applyTo(camera) {
    // WHERE HIS FEET ARE, ONCE, FOR BOTH OF THE THINGS THAT NEED IT. The boom
    // swings from the stance and the body stands on it, and until now only the
    // boom asked: a body that worked it out for itself would be a second
    // opinion about one floor, which is the defect this campaign has already
    // spent a session removing from the camera.
    const stance = this.#stance === null
      ? this.position.y - EYE_HEIGHT
      : this.#stance;

    // ZERO REACH IS FIRST PERSON, AND IT IS THE COPY AND NOT THE ARITHMETIC.
    // The boom does arrive at the eye exactly -- every leg of it is multiplied by
    // the same fraction -- but "exactly" through six trigonometric calls is a few
    // parts in 10^16 away from the position itself, and first person is required
    // to be bit-identical rather than nearly so. So the branch is on the arm
    // being out at all, not on which person was asked for: mid-switch the camera
    // is on the arm, and at the end of it, it is the eye.
    if (this.#reach > 0) {
      thirdPersonEye(
        this.#rigEye,
        { x: this.position.x, z: this.position.z, stance, yaw: this.#yawF.x },
        this.#pitchF.x, PITCH_LIMIT, this.#groundHeight, AVATAR.height,
        { reach: this.#reach, solids: this.#solids, eyeHeight: EYE_HEIGHT },
      );
      camera.position.set(this.#rigEye.x, this.#rigEye.y, this.#rigEye.z);
    } else {
      camera.position.copy(this.position);
      this.#rigEye.x = this.position.x;
      this.#rigEye.y = this.position.y;
      this.#rigEye.z = this.position.z;
      this.#rigEye.arm = 0;
    }

    // AND THE BODY IS TOLD, in the same call rather than in a second pass: this
    // is the one place a frame decides where the walker is and which way he
    // looks, so it is the one place that can say it without being asked twice.
    // See STANDING in src/core/avatar.js for why it travels instead of being
    // rebuilt from the eye.
    STANDING.x = this.position.x;
    STANDING.y = stance;
    STANDING.z = this.position.z;
    STANDING.yaw = this.#yawF.x;
    // AND HOW MUCH OF HIM. For the first metre of the arm he is between the near
    // plane and the lens; the fade is what carries him in and out over exactly
    // that metre, and `drawn` is still the flag the layer switches a mesh with,
    // so a body nobody can see costs nothing at all.
    // AND HOW FAST HE IS GOING, because the step is spent in METRES and not in
    // seconds: a walk and a run have to put the same foot on the same patch of
    // ground, or the figure skates. The walker is the one seat that knows.
    STANDING.speed = Math.hypot(this.#velocity.x, this.#velocity.z);
    STANDING.arm = this.#rigEye.arm;
    STANDING.fade = bodyFade(this.#rigEye.arm);
    STANDING.drawn = STANDING.fade > 0;
    STANDING.serial++;
    // THE AIM IS THE WALKER'S IN BOTH, and in third person that is the whole
    // of the framing: the camera does not look AT the avatar, it looks where
    // the walker looks and the boom's offset puts him low and to the left of
    // the middle, which is where both reference pictures draw him.
    this.#euler.set(this.#pitchF.x, this.#yawF.x, 0);
    camera.quaternion.setFromEuler(this.#euler);
  }

  /**
   * Everything a body model needs from this one, into an object it already has.
   *
   * One call rather than eight getters, and no allocation a frame: this is read
   * every frame for as long as the page is open.
   */
  motionInto(out) {
    const sin = Math.sin(this.#yawF.x);
    const cos = Math.cos(this.#yawF.x);
    out.speed = Math.hypot(this.#velocity.x, this.#velocity.z);
    // Signed along the walker's own axes: forward is (-sin, -cos) and right is
    // (cos, -sin), the same frame the step above walks in.
    out.forward = this.#velocity.x * -sin + this.#velocity.z * -cos;
    out.right = this.#velocity.x * cos + this.#velocity.z * -sin;
    out.yaw = this.#yawF.x;
    out.yawRate = this.#yawRate;
    out.x = this.position.x;
    out.z = this.position.z;
    out.eyeY = this.position.y;
    // AND WHERE THE FEET ARE, SAID RATHER THAN RECONSTRUCTED. Everything
    // downstream that wants the stance used to get it by taking EYE_HEIGHT off
    // the eye, which was the same number right up until a placement was allowed
    // to name an altitude the eye stands at. It still is at every pose that
    // stands a walker; it is not at the two fitted framings, and it will not be
    // for a third person camera on the end of an arm. One of the two has to be
    // published rather than derived from the other, and this is the one whose
    // definition never moves.
    out.stance = this.#stance === null ? this.position.y - EYE_HEIGHT : this.#stance;
    out.poseSerial = this.#poseSerial;
    return out;
  }

  get speed() { return Math.hypot(this.#velocity.x, this.#velocity.z); }
  get yawDegrees() { return (this.#yawF.x / DEG) % 360; }
  get pitchDegrees() { return this.#pitchF.x / DEG; }
  /** How fast the eye is turning, in degrees a second. */
  get lookRate() { return this.#lookRate; }
}
