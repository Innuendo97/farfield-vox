// The way in. Pointer lock can only be asked for from a user gesture, so the
// scene always starts behind this prompt; it carries the same face and the same
// tracking as the rest of the interface, over the lightest scrim that still
// keeps the words readable against the sky.
//
// AND IT DISSOLVES, both ways. What this covers is the whole frame, so taking
// it off is the largest single change of light in the whole arrival: measured at
// the click, from the compositor, the middle of the frame went up by 38 levels
// and the corners by 21 between two delivered frames. The sheet declared a
// transition and could never run it, because the element was hidden with
// `hidden` — which is `display: none`, and a box that stops being generated
// interpolates nothing. So the opacity is what carries it, and `hidden` is put
// back only once there is nothing left to see.

// How long it takes, in one place, handed to the sheet rather than written
// twice. The sheet's own default is the same length; this is here so the clock
// that puts `hidden` back cannot disagree with the fade it is waiting for.
const FADE_MS = 560;

// And for a walker who has asked their machine for no motion. Not nothing: this
// covers the whole frame, and nothing is the hard cut the setting exists to
// spare them. Short enough to be over before it is noticed, long enough that
// the frame changes rather than jumps.
const REDUCED_FADE_MS = 160;

/**
 * The way in.
 *
 * @param {Element} root
 * @param {boolean} options.touch whether this page is walked with fingers, in
 *   which case the invitation names the gesture that works and the second line
 *   names the two halves of the screen instead of four keys and a lock.
 */
export function createStartOverlay(root, { touch = false } = {}) {
  const el = document.createElement('div');
  el.className = 'overlay-start';
  el.innerHTML = touch ? `
    <h1>Farfield</h1>
    <p>Tocca per esplorare</p>
    <p class="overlay-keys">Pollice a sinistra per camminare · Trascina a destra per guardare</p>
  ` : `
    <h1>Farfield</h1>
    <p>Clicca per esplorare</p>
    <p class="overlay-keys">WASD per muoverti · Shift per correre · Esc per liberare il mouse</p>
  `;
  const still = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fadeMs = still ? REDUCED_FADE_MS : FADE_MS;
  el.style.setProperty('--overlay-fade', `${fadeMs}ms`);
  root.appendChild(el);
  // It is up from the first frame — nothing calls setVisible until the pointer
  // is first taken or given back, so this is the state the walker arrives in —
  // but it is up by ARRIVING. Appended transparent, looked at once so the
  // browser has a value to come from, and then lit: the title and the two rows
  // under it fade up over the sky instead of being stamped on it.
  void el.offsetWidth;
  el.classList.add('is-on');

  let wanted = true;
  let putAway = null;

  const api = {
    setVisible(visible) {
      if (visible === wanted) return;
      wanted = visible;
      if (putAway) { clearTimeout(putAway); putAway = null; }
      if (visible) {
        el.hidden = false;
        // The browser has to have SEEN the transparent state before the lit one
        // is asked for, or there are no two values to interpolate between and
        // the element simply appears. Read a layout property to make it look:
        // a synchronous flush rather than a frame's wait, because during the
        // arrival a frame's wait can be two seconds long — the frames the
        // compositor delivered during one measured arrival came up to 2339 ms
        // apart — and an entrance that waits for one lands after the moment it
        // was for.
        void el.offsetWidth;
        el.classList.add('is-on');
        return;
      }
      el.classList.remove('is-on');
      // Out of the box tree once it is invisible and not before: while it is
      // fading it is still part of the picture. Nothing under it is missed in
      // the meantime — the interface layer takes no pointer events and this
      // never asked for any.
      putAway = setTimeout(() => { el.hidden = true; putAway = null; }, fadeMs);
    },
    /** Whether the way in is being offered — asked for, not finished arriving. */
    get visible() { return wanted; },
  };
  return api;
}
