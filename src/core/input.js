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

export class Input {
  #element = null;
  #pressed = new Set();
  #dx = 0;
  #dy = 0;
  #locked = false;
  #engaged = false;
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
  #listeners = { lockChange: [], key: [] };
  #bound = {};

  attach(element) {
    this.#element = element;
    this.#bound = {
      down: (e) => this.#onKeyDown(e),
      up: (e) => this.#pressed.delete(e.code),
      move: (e) => this.#onMouseMove(e, false),
      rawMove: (e) => this.#onMouseMove(e, true),
      lock: () => this.#onLockChange(),
      blur: () => { this.#pressed.clear(); this.#zoom = false; },
      click: () => { this.#engaged = true; this.requestLock(); },
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
  engage() { this.#engaged = true; }

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
    if (this.#locked) return undefined;
    return this.#element.requestPointerLock();
  }

  onLockChange(fn) { this.#listeners.lockChange.push(fn); return this; }
  onKey(fn) { this.#listeners.key.push(fn); return this; }

  get locked() { return this.#locked; }
  // Walking survives losing the pointer lock (Esc, alt-tab): only the mouse look
  // needs the lock, and dropping the keys mid-stride feels like a malfunction.
  get engaged() { return this.#engaged; }
  get running() { return this.#pressed.has('ShiftLeft') || this.#pressed.has('ShiftRight'); }
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
    return length > 1 ? { x: x / length, z: z / length } : { x, z };
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
