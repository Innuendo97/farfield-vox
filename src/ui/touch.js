// THE COMMANDS ON THE GLASS.
//
// This world has always been walked with four keys and a captured mouse, and on
// a telephone it was simply not walkable: the lock is refused, «Clicca per
// esplorare» comes straight back up, and nothing on the page has ever heard of
// a finger. What follows is the other hand — a stick that appears where the
// thumb lands, a drag that turns the head, a tap that opens a stone — and it is
// deliberately the ONLY file that knows any of that.
//
// WHAT IT IS ALLOWED TO SAY, and it is three sentences:
//
//   input.setTouchAxis(x, z, running)   what the stick is pushing
//   input.addTouchLook(dx, dy)          pixels of drag, in the mouse's own terms
//   input.command(code)                 a button that means a key
//
// Every piece of state those three carry lives in src/core/input.js beside the
// keyboard's own, so src/core/player.js reads the same three questions it has
// always read and never learns that a thumb exists. This file owns pictures and
// gestures; it owns no state the world is built from.
//
// AND THE LAW IS SEPARATE FROM THE PICTURE. joystickAxis() and dragKind() below
// are arithmetic over numbers, exported and imported by
// tools/guards/guard-tocco.mjs, which measures THE LAW ITSELF rather than a
// second copy of it written in a guard.

/**
 * The four decisions of the hand, in one place.
 *
 * Every one of them is a number somebody will want to change after ten minutes
 * with a telephone in their hand, so they are here, named, and not scattered
 * through the handlers below.
 */
export const TOUCH = {
  /**
   * How far from where the thumb landed counts as a full push, in CSS pixels.
   *
   * It is the radius the ring is drawn at as well, so what the eye sees is what
   * the arithmetic uses. Fifty four pixels is about nine millimetres on a
   * telephone: a thumb rolls that far without the hand moving.
   */
  radiusPx: 54,
  /**
   * The dead zone, as a fraction of that radius.
   *
   * A thumb resting on glass is never still — a tenth of the radius of drift is
   * ordinary — and a walker who has stopped pushing must stop walking. Small,
   * because everything spent here is taken off the useful travel.
   */
  deadZone: 0.14,
  /**
   * The rim. Past this the walk is a run, which is the committente's own answer
   * (E-DECISIONI27): the running is in the push and there is no second button.
   */
  runAt: 0.80,
  /**
   * How much of the mouse's sensitivity a pixel of finger is worth.
   *
   * The brief: half a screen of drag is about a quarter turn. Measured against
   * src/core/player.js's own LOOK_SENSITIVITY of 0.0022 rad per pixel, on the
   * 915 pixel width of a telephone held sideways, half the screen is 457.5
   * pixels and a quarter turn is 1.5708 radians, so the factor wanted is
   * 1.5708 / (457.5 x 0.0022) = 1.561. Rounded to the two figures anybody would
   * tune it by.
   */
  lookScale: 1.55,
  /** Under this much movement, and this long, a touch is a TAP and not a drag. */
  tapPx: 12,
  tapMs: 320,
  /** How far a finger travels down the panels before the list takes a step. */
  swipePx: 44,
};

/**
 * Whether this page is walked with fingers.
 *
 * The address wins, both ways: `?tocco=1` puts a desk into the mode so that it
 * can be photographed and measured, `?tocco=0` takes a telephone out of it. With
 * the address silent it is the machine's own answer — a coarse pointer, or a
 * screen that reports touch points at all (E-DECISIONI27).
 */
export function touchWanted(search = window.location.search) {
  const asked = new URLSearchParams(search).get('tocco');
  if (asked === '1') return true;
  if (asked === '0') return false;
  const media = typeof window.matchMedia === 'function' ? window.matchMedia : null;
  if (media && media('(pointer: coarse)').matches) return true;
  return 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
}

/**
 * THE STICK, as arithmetic: where the thumb is against where it landed.
 *
 * Direction is the angle and intensity is the distance, exactly as the keyboard
 * hands back a unit vector and the body multiplies it by a speed — so a thumb
 * half way out walks at half pace and the same law carries both hands.
 *
 * @param {number} dx pixels right of where the thumb landed
 * @param {number} dy pixels below it
 * @returns {{x: number, z: number, push: number, running: boolean}} the axis in
 *   the walker's own terms (z is negative forward), how hard, and the rim
 */
export function joystickAxis(dx, dy) {
  const length = Math.hypot(dx, dy);
  if (length <= 0) return { x: 0, z: 0, push: 0, running: false };
  // Past the ring it is still a full push and not more than one: a thumb that
  // has left the ring has said everything it can say.
  const reach = Math.min(1, length / TOUCH.radiusPx);
  // The dead zone is REMOVED AND THE REST RESTRETCHED, rather than cut out of
  // the middle: a walker crossing it would otherwise go from nought to a tenth
  // of a pace in one pixel, and the first step of every walk would be a jump.
  const push = reach <= TOUCH.deadZone
    ? 0
    : (reach - TOUCH.deadZone) / (1 - TOUCH.deadZone);
  return {
    x: (dx / length) * push,
    z: (dy / length) * push,
    push,
    running: push > 0 && reach >= TOUCH.runAt,
  };
}

/**
 * What one finger's visit to the glass was.
 *
 * A tap is short AND small. Both, because either one alone is wrong: a finger
 * held still for a second and lifted is not a tap on anything, and a flick
 * across the screen in eighty milliseconds certainly is not one.
 *
 * @returns {'tocco'|'trascinamento'}
 */
export function dragKind(dx, dy, ms) {
  const moved = Math.hypot(dx, dy);
  return moved <= TOUCH.tapPx && ms <= TOUCH.tapMs ? 'tocco' : 'trascinamento';
}

/** The rhombus of the world's own markers, drawn small. */
function mark() {
  const el = document.createElement('span');
  el.className = 'touch-mark';
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/**
 * Hangs the commands on the interface and returns their handle.
 *
 * @param {Element}  options.root      where the rest of the interface is mounted
 * @param {Element}  options.surface   the element the fingers land on: the world
 * @param {object}   options.input     the one owner of what the fingers said
 * @param {Function} options.state     which of the four states interaction is in
 * @param {Function} options.probe     where the walker is, for the harness only
 */
export function createTouchControls({
  root, surface, input, state = () => 'mondo', probe = null,
}) {
  // ------------------------------------------------------------- the pictures
  //
  // All three are drawn in the family of the world's own markers — the outlined
  // rhombus with a lit heart at the foot of every block — and all three take no
  // pointer events except the two that are buttons.

  const stick = document.createElement('div');
  stick.className = 'touch-stick';
  stick.setAttribute('aria-hidden', 'true');
  const knob = document.createElement('span');
  knob.className = 'touch-knob';
  stick.appendChild(knob);

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'touch-back';
  back.append(mark());
  const backLabel = document.createElement('span');
  backLabel.className = 'touch-back-label';
  backLabel.textContent = 'Indietro';
  back.appendChild(backLabel);

  // The invitation to turn the telephone. Discreet, dismissable, and gone by
  // itself the moment the screen is wider than it is tall (E-DECISIONI27).
  const turn = document.createElement('div');
  turn.className = 'touch-turn';
  turn.setAttribute('role', 'status');
  const turnText = document.createElement('p');
  turnText.className = 'touch-turn-text';
  turnText.textContent = 'Gira il telefono: il mondo è più largo che alto.';
  const turnClose = document.createElement('button');
  turnClose.type = 'button';
  turnClose.className = 'touch-turn-close';
  turnClose.setAttribute('aria-label', 'Chiudi l’avviso');
  turnClose.textContent = '×';
  turn.append(turnText, turnClose);

  root.append(stick, back, turn);

  // ------------------------------------------------------------- the fingers
  //
  // One entry per pointer id, so a thumb on the stick and a finger turning the
  // head are two independent things that happen to be on the same glass. The
  // left half is the walking and the right half is the looking, decided once at
  // the moment the finger lands and never revisited: a drag that wanders across
  // the middle of the screen keeps the job it was given.
  const live = new Map();
  let stickId = null;
  let lookId = null;
  // What a swipe through the panels has accumulated since it last stepped.
  let swipe = 0;
  let dismissed = false;
  let inPortrait = false;
  let shown = null;

  const half = () => window.innerWidth / 2;

  function placeStick(x, y) {
    stick.style.left = `${x}px`;
    stick.style.top = `${y}px`;
    knob.style.transform = 'translate(-50%, -50%)';
    stick.classList.add('is-on');
  }

  function moveKnob(dx, dy) {
    const length = Math.hypot(dx, dy);
    const capped = length > TOUCH.radiusPx ? TOUCH.radiusPx / length : 1;
    knob.style.transform = `translate(calc(-50% + ${dx * capped}px), calc(-50% + ${dy * capped}px))`;
  }

  function onDown(event) {
    // THE WAY IN IS THE FIRST FINGER, said here rather than left to the click
    // the canvas listens for: preventDefault below is what keeps the page from
    // scrolling and selecting under a drag, and on a touch screen it is also
    // what stops the compatibility click ever being synthesised. So the one
    // thing that click was for is done directly. engage() is idempotent.
    // AND WHETHER THIS IS THE ONE THAT LET THEM IN, WHICH IS NOT A COMMAND.
    //
    // Measured on the plate for this session: the walker arrives 4.19 m from
    // the face of the sixth block and the reach of E is 4.20, so the world
    // hands them a stone already within reach. The tap that took «Tocca per
    // esplorare» away therefore ALSO opened it, and the first thing a visitor
    // saw of this world was a stack of panels nobody asked for. A way in is a
    // way in: it is answered by the world appearing, and by nothing else.
    const opening = !input.engaged;
    input.engage();
    const left = event.clientX < half();
    if (left && stickId === null) {
      stickId = event.pointerId;
      live.set(event.pointerId, {
        role: 'levetta', x: event.clientX, y: event.clientY,
      });
      placeStick(event.clientX, event.clientY);
    } else if (!left && lookId === null) {
      lookId = event.pointerId;
      live.set(event.pointerId, {
        role: 'sguardo',
        opening,
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        at: event.timeStamp,
      });
      swipe = 0;
    } else {
      return;
    }
    // THE POINTER IS CAPTURED, and that is what makes two fingers work at all:
    // without it a thumb that slides past the middle of the screen would have
    // its moves delivered to whatever is under it, and the stick would stick.
    try { surface.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    event.preventDefault();
  }

  function onMove(event) {
    const held = live.get(event.pointerId);
    if (!held) return;
    if (held.role === 'levetta') {
      const dx = event.clientX - held.x;
      const dy = event.clientY - held.y;
      moveKnob(dx, dy);
      const axis = joystickAxis(dx, dy);
      input.setTouchAxis(axis.x, axis.z, axis.running);
      stick.classList.toggle('is-running', axis.running);
      return;
    }
    const dx = event.clientX - held.lastX;
    const dy = event.clientY - held.lastY;
    held.lastX = event.clientX;
    held.lastY = event.clientY;
    // THE PANELS TAKE THE UP AND DOWN AND LEAVE THE SIDEWAYS ALONE.
    //
    // W and S step the list while they also walk, which is the way out the
    // concept asks for; a finger cannot do two things at once, so with a stack
    // open the vertical half of the drag belongs to the list and the horizontal
    // half still turns the head. Nothing is taken away that a walker had: the
    // stick keeps walking underneath either way.
    if (state() === 'pannelli') {
      input.addTouchLook(dx * TOUCH.lookScale, 0);
      swipe += dy;
      while (Math.abs(swipe) >= TOUCH.swipePx) {
        const up = swipe < 0;
        swipe -= (up ? -1 : 1) * TOUCH.swipePx;
        // Natural, the way a list on glass has always moved: the finger carries
        // the page, so a finger going up brings the next entry into view.
        input.command(up ? 'ArrowDown' : 'ArrowUp');
      }
      return;
    }
    input.addTouchLook(dx * TOUCH.lookScale, dy * TOUCH.lookScale);
  }

  function onUp(event) {
    const held = live.get(event.pointerId);
    if (!held) return;
    live.delete(event.pointerId);
    try { surface.releasePointerCapture(event.pointerId); } catch { /* already gone */ }
    if (held.role === 'levetta') {
      stickId = null;
      input.setTouchAxis(0, 0, false);
      stick.classList.remove('is-on', 'is-running');
      return;
    }
    lookId = null;
    swipe = 0;
    // A TAP IS E, and only where E would have done something. The prompt at the
    // foot of the frame is the other half of the same offer (E-DECISIONI27):
    // whoever sees it can press it, and whoever is already looking at the stone
    // can simply tap the stone.
    const kind = dragKind(
      event.clientX - held.x, event.clientY - held.y, event.timeStamp - held.at,
    );
    if (kind === 'tocco' && !held.opening && state() === 'vicino') input.command('KeyE');
  }

  surface.addEventListener('pointerdown', onDown);
  surface.addEventListener('pointermove', onMove);
  surface.addEventListener('pointerup', onUp);
  surface.addEventListener('pointercancel', onUp);
  back.addEventListener('click', () => input.command('Escape'));
  turnClose.addEventListener('click', () => { dismissed = true; turn.classList.remove('is-on'); });

  // ----------------------------------------------------------- the two halves
  const portrait = typeof window.matchMedia === 'function'
    ? window.matchMedia('(orientation: portrait)') : null;

  function readOrientation() {
    inPortrait = portrait ? portrait.matches : window.innerHeight > window.innerWidth;
    turn.classList.toggle('is-on', inPortrait && !dismissed);
  }
  readOrientation();
  if (portrait) {
    // The old browsers only have the listener the new ones deprecated.
    if (portrait.addEventListener) portrait.addEventListener('change', readOrientation);
    else portrait.addListener(readOrientation);
  }
  window.addEventListener('resize', readOrientation);

  const api = {
    /**
     * One frame of it, which is one string compared against the last one.
     *
     * Deliberately nothing else: this runs inside the frame loop and the cost
     * of the whole mode has to stay unmeasurable. A class written with the
     * value it already holds is still an invalidation the browser walks, so it
     * is written only when it changes — the same rule src/ui/reticle.js keeps.
     */
    update(now) {
      const wanted = now === 'pannelli';
      if (wanted === shown) return;
      shown = wanted;
      back.classList.toggle('is-on', wanted);
    },

    /** Whether the invitation to turn the telephone is up. */
    get turning() { return turn.classList.contains('is-on'); },

    dispose() {
      surface.removeEventListener('pointerdown', onDown);
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerup', onUp);
      surface.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', readOrientation);
      stick.remove();
      back.remove();
      turn.remove();
    },
  };

  // THE HANDLE THE MEASUREMENTS ARE TAKEN THROUGH, and it exists ONLY here.
  //
  // The proofs this mode has to hand over are about metres walked and degrees
  // turned on the VISITOR's page, without ?dev — which is the page a telephone
  // actually gets, and the page window.farfield is not built on. It is the same
  // arrangement window.voxsuolo and window.voxcampo already have; what is new
  // is that this one is not defined at all when the mode is off, so a desk
  // keeps exactly the page it had.
  window.voxtocco = {
    tuning: TOUCH,
    stick: () => (stickId === null ? null : { x: input.axis().x, z: input.axis().z }),
    running: () => input.running,
    portrait: () => api.turning,
    dove: probe,
  };

  return api;
}
