// Keyboard state and pointer-lock mouse deltas.
// Mouse movement is accumulated between frames and drained by the consumer, so
// a slow frame never loses look input and never applies it twice.
//
// AND IT IS TAKEN RAW WHERE THE BROWSER HAS A RAW STREAM.
//
// A mouse reports on its own clock — a hundred and twenty five times a second
// out of the box, a thousand on anything made for the hand — and `mousemove` is
// not that stream: the browser holds the reports and delivers them aligned to
// the frame, coalesced into one event, which throws away WHEN each count
// arrived. What survives is the sum, and the sum is right, so nothing was ever
// wrong with where the eye ended up. What is lost is the evenness: some frames
// carry two reports and some three, and a look built out of that turns in a
// rhythm belonging to neither the hand nor the world.
//
// `pointerrawupdate` is the same movement undelivered — every report, as it
// lands, before the frame alignment. Summing that between frames gives the
// same total from a signal that has not been bucketed, which is the half of the
// silk that no filter can put back. Where it does not exist the old path is
// exactly the old path, so nothing depends on having it.
//
// The two are never both counted. One raw event arriving is proof enough that
// the raw stream is live, and from that moment `mousemove` is ignored for the
// life of the page: feature detection says what a browser has, an event says
// what it is doing, and only the second one can be trusted about both at once.

const MOVEMENT_KEYS = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};

// AND THERE IS A SECOND HAND, WHICH HAS NO KEYS AND NO LOCK.
//
// On a screen with no mouse the two halves above are both refused: the lock is
// never granted, so `#dx` is never fed, and there are no keys, so `axis()` is
// always nought. The fingers arrive through `src/ui/touch.js`, which draws the
// stick and reads the drags and knows nothing about what they mean — it says
// only `setTouchAxis`, `addTouchLook` and `command`, and every piece of STATE
// that comes out of them lives here, next to the keyboard's own. That is what
// keeps src/core/player.js from ever learning that a finger exists: it asks the
// same three questions it always asked and gets one answer each.

export class Input {
  #element = null;
  #pressed = new Set();
  #dx = 0;
  #dy = 0;
  #locked = false;
  #engaged = false;
  // Whether this page is being walked with fingers. Set once, from the page's
  // own reading of the machine and of the address (see touchWanted() in
  // src/ui/touch.js); nothing below flips it on its own.
  #touch = false;
  // What the stick is pushing, in the same terms axis() answers in, and whether
  // it is pushed to the rim. Written by the stick and read by the walker.
  #touchX = 0;
  #touchZ = 0;
  #touchRunning = false;
  // Whether the raw stream has actually spoken. See the note at the top for why
  // this is an observation and not a feature test.
  #raw = false;
  // The right button, held. Only ever true under the lock: a click that has not
  // been given the pointer is a click asking for it, not a request to lean in.
  #zoom = false;
  // When the last report landed, on the same clock the frame is timed by. The
  // measuring harness reads it to put a number on input-to-pose; nothing in the
  // walk does.
  #lastMoveAt = 0;
  #listeners = { lockChange: [], key: [], engage: [] };
  #bound = {};

  attach(element) {
    this.#element = element;
    this.#bound = {
      down: (e) => this.#onKeyDown(e),
      up: (e) => this.#pressed.delete(e.code),
      move: (e) => this.#onMouseMove(e, false),
      rawMove: (e) => this.#onMouseMove(e, true),
      lock: () => this.#onLockChange(),
      blur: () => {
        this.#pressed.clear();
        this.#zoom = false;
        // A page that goes away under a thumb never gets the pointerup, and a
        // stick left pushed is a walker still walking behind another window.
        this.setTouchAxis(0, 0, false);
      },
      // The way in, and on a screen with no mouse it is ONLY the way in. There
      // is nothing to ask the browser for: a lock requested from a phone is
      // refused, the refusal puts the prompt back up, and the prompt back up is
      // exactly the defect this session exists to remove.
      click: () => { this.engage(); if (!this.#touch) this.requestLock(); },
      mouseDown: (e) => { if (e.button === 2 && this.#locked) this.#zoom = true; },
      mouseUp: (e) => { if (e.button === 2) this.#zoom = false; },
      // Under the lock the browser suppresses it anyway; this is for the moment
      // between letting go of the pointer and the menu taking it, where a right
      // click would otherwise open the browser's own menu over the world.
      menu: (e) => e.preventDefault(),
    };
    element.addEventListener('click', this.#bound.click);
    element.addEventListener('contextmenu', this.#bound.menu);
    document.addEventListener('keydown', this.#bound.down);
    document.addEventListener('keyup', this.#bound.up);
    document.addEventListener('mousemove', this.#bound.move);
    if ('onpointerrawupdate' in window) {
      document.addEventListener('pointerrawupdate', this.#bound.rawMove);
    }
    document.addEventListener('mousedown', this.#bound.mouseDown);
    document.addEventListener('mouseup', this.#bound.mouseUp);
    document.addEventListener('pointerlockchange', this.#bound.lock);
    window.addEventListener('blur', this.#bound.blur);
    return this;
  }

  #onKeyDown(e) {
    this.#pressed.add(e.code);
    for (const fn of this.#listeners.key) fn(e.code, e);
  }

  #onMouseMove(e, raw) {
    if (raw) this.#raw = true;
    else if (this.#raw) return;
    if (!this.#locked) return;
    this.#dx += e.movementX || 0;
    this.#dy += e.movementY || 0;
    this.#lastMoveAt = e.timeStamp;
  }

  #onLockChange() {
    this.#locked = document.pointerLockElement === this.#element;
    // Letting go of the pointer lets go of the button with it: a lean held
    // through an Escape would otherwise still be held when the pointer came
    // back, with no mouseup ever coming to say so.
    if (!this.#locked) this.#zoom = false;
    for (const fn of this.#listeners.lockChange) fn(this.#locked);
  }

  /**
   * The visitor has asked to come in.
   *
   * Marked apart from the lock because the two are not the same thing and only
   * one of them can be refused. src/core/player.js reads the axis only when
   * this is true, so a way in that took the pointer and never set this would
   * hand over a world nobody can walk in; and a way in that sets this and is
   * refused the pointer hands over a world that walks and does not look, which
   * is a degradation rather than a failure. The click path has always done both
   * at once; the opening scene has to be able to do them one at a time, because
   * its gesture may be a key press.
   */
  engage() {
    if (this.#engaged) return;
    this.#engaged = true;
    // WHO TAKES THE PROMPT DOWN WHEN THERE IS NO LOCK TO REPORT IT.
    //
    // On a mouse the way in is announced by pointerlockchange, and src/main.js
    // has always hung the prompt on that one signal. A finger never produces
    // it: the lock is neither asked for nor granted, so the page would be
    // walked from behind «Tocca per esplorare» for ever. This is the same
    // announcement made by the thing that actually happened.
    for (const fn of this.#listeners.engage) fn();
  }

  /**
   * Asks for the pointer, and HANDS BACK WHAT THE BROWSER ANSWERED.
   *
   * The newer browsers answer with a promise, and a request made from a key
   * press rather than a click is one they are entitled to reject — which with
   * nobody listening is an unhandled rejection printed in the console of a page
   * whose console is meant to be clean. The answer is returned rather than
   * swallowed here so the caller can decide what a refusal means; older
   * browsers return nothing and the caller sees nothing.
   */
  requestLock() {
    // AND IT IS NEVER ASKED FOR WITH FINGERS. Not «asked and refused»: not
    // asked. A refusal is a rejected promise, a console line and a prompt that
    // comes back up over a world the walker has already been let into, and all
    // three of those are the defect rather than a consequence of it. The one
    // seat that speaks to the browser about the pointer is here, so this is the
    // one place the rule has to be written.
    if (this.#touch || this.#locked) return undefined;
    return this.#element.requestPointerLock();
  }

  onLockChange(fn) { this.#listeners.lockChange.push(fn); return this; }
  onKey(fn) { this.#listeners.key.push(fn); return this; }
  /** Called once, when the visitor has asked to come in. */
  onEngage(fn) { this.#listeners.engage.push(fn); return this; }

  /**
   * A command that did not come from a key.
   *
   * The screen's own buttons — the interaction prompt at the foot, «Indietro»,
   * a swipe through the panels — mean exactly what E, Esc and W/S mean, and
   * they are delivered as those: one door into src/main.js's key handler and
   * into src/world/interact.js, so a gesture and a key can never come to
   * disagree about what the same thing does.
   */
  command(code) {
    for (const fn of this.#listeners.key) fn(code, { repeat: false, preventDefault() {} });
  }

  /** The stick, in the terms axis() answers in, and whether it is at the rim. */
  setTouchAxis(x, z, running) {
    this.#touchX = x || 0;
    this.#touchZ = z || 0;
    this.#touchRunning = Boolean(running);
  }

  /**
   * A drag, in the same pixels the mouse reports in.
   *
   * It is summed into the same pair drainLook() hands out, so the body sees one
   * look and never asks where it came from. The scaling from finger to frame
   * belongs to the fingers and is applied before this is called.
   */
  addTouchLook(dx, dy) {
    if (!this.#touch) return;
    this.#dx += dx;
    this.#dy += dy;
    this.#lastMoveAt = performance.now();
  }

  get touch() { return this.#touch; }

  set touch(on) {
    this.#touch = Boolean(on);
    if (!this.#touch) this.setTouchAxis(0, 0, false);
  }

  get locked() { return this.#locked; }
  // Walking survives losing the pointer lock (Esc, alt-tab): only the mouse look
  // needs the lock, and dropping the keys mid-stride feels like a malfunction.
  get engaged() { return this.#engaged; }
  // Shift, or a stick pushed to the rim: the committente's choice, and it is
  // one question with two hands answering it (E-DECISIONI27).
  get running() {
    return this.#touchRunning
      || this.#pressed.has('ShiftLeft') || this.#pressed.has('ShiftRight');
  }
  /** The right button, held under the lock: the ask to lean the lens in. */
  get zooming() { return this.#zoom; }
  /** Whether the look is being built from the raw report stream. */
  get rawPointer() { return this.#raw; }
  /** When the last report landed, for the harness that measures the delay. */
  get lastMoveAt() { return this.#lastMoveAt; }

  axis() {
    let x = 0, z = 0;
    for (const code of this.#pressed) {
      switch (MOVEMENT_KEYS[code]) {
        case 'forward': z -= 1; break;
        case 'back': z += 1; break;
        case 'left': x -= 1; break;
        case 'right': x += 1; break;
        default: break;
      }
    }
    const length = Math.hypot(x, z);
    if (length > 0) return length > 1 ? { x: x / length, z: z / length } : { x, z };
    // AND THE STICK ONLY WHERE THE KEYS SAID NOTHING. A page can have both —
    // ?tocco=1 on a desk is exactly that — and adding the two would give a
    // walker who holds W and pushes the stick forward a push of two, which is
    // the one thing the normalisation above exists to forbid. The keys win
    // because a key is unambiguous and a thumb resting on glass is not.
    return { x: this.#touchX, z: this.#touchZ };
  }

  // Returns the look delta accumulated since the previous call and clears it.
  drainLook() {
    const delta = { x: this.#dx, y: this.#dy };
    this.#dx = 0;
    this.#dy = 0;
    return delta;
  }

  dispose() {
    this.#element.removeEventListener('click', this.#bound.click);
    this.#element.removeEventListener('contextmenu', this.#bound.menu);
    document.removeEventListener('keydown', this.#bound.down);
    document.removeEventListener('keyup', this.#bound.up);
    document.removeEventListener('mousemove', this.#bound.move);
    document.removeEventListener('pointerrawupdate', this.#bound.rawMove);
    document.removeEventListener('mousedown', this.#bound.mouseDown);
    document.removeEventListener('mouseup', this.#bound.mouseUp);
    document.removeEventListener('pointerlockchange', this.#bound.lock);
    window.removeEventListener('blur', this.#bound.blur);
  }
}
