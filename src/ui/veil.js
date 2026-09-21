import SKY from '../../assets-src/sky/sky.json' with { type: 'json' };
import { isClockFrozen } from './devhud.js';

// The shading the reference framing carries, drawn at the front of the frame
// for as long as the walker is arriving, and then gone.
//
// The reference darkens towards the corners of its picture. Part of that is the
// composite pass, which shades every frame from every bearing; part of it is a
// sky that really is deeper away from its sun; and the rest is the picture's,
// and the picture is one standing place looking one way. Baked into a dome that
// last part becomes a patch of dark sky pinned to a bearing, found again from
// every other standing place in the hub and never where a lens would put it.
// So tools/grade/grade-sky.mjs divides it out of the sky, and it is put back
// here — over the whole frame, where a lens effect belongs, and only while the
// arrival composition is the one the reference drew.
//
// What is put back is a table and not a law. It was a law once — one number,
// falling with the square of the radius — and the frame it drew was nineteen
// units of DeltaE from the reference at the upper left corner and three at the
// upper right, which is the whole argument against a law: at one radius the
// reference wants a fifth of the light on one side of the frame and nine tenths
// on the other. It is not a lens. It is one photograph minus one smooth fitted
// sky, and the only honest way to hold that is to have measured it, which
// tools/grade/fit-veil.mjs does and sky.json carries.
//
// It is drawn rather than declared, and the two reasons are the same reason.
// The field this has to reproduce is a fraction of the light, applied where the
// composite pass applies its own — after the tone curve and before the picture
// is encoded — and what an overlay can do is multiply the encoded value, so the
// fraction is taken to the power the transfer function would have taken it to.
// And most of the field is shallow: a tenth of the light over the whole middle
// of the frame, which is a couple of dozen steps of an eight bit channel spread
// over half a diagonal, and a visible ring every forty pixels. A gradient drawn
// by the browser has no answer to that, and neither has a gradient with a table
// behind it. Drawn here it has the same answer the sky itself has — one step of
// triangular noise, which costs nothing and cannot be seen.

// How the shading is turned into an overlay: the fraction of light the reference
// framing carries, raised to the reciprocal of the display transfer function,
// because this multiplies an encoded value and the fraction is a linear one.
const DISPLAY_GAMMA = 2.2;

// AND THE LENS SHADING IS HERE NOW TOO.
//
// src/core/post.js used to shade every frame from every bearing by a sixteenth
// of the light at the corners, permanently, and this table is the same picture's
// corner shading measured. Two sedi for one effect, and the permanent one was
// the wrong shape: the fitted table wants 0.23 at the upper left corner and
// 0.46 at the upper right, and no law of the radius can be both. So it comes
// here, unchanged in value, and it goes when the arrival goes — which is what
// the committente asked for on 2026-08-19: after the dissolve the frame is
// clean to its edges.
//
// Kept as the law it was rather than folded into the table, and the reason is
// that they are two different things standing on top of each other: the table
// is one photograph minus one smooth sky, and exists only where that photograph
// had sky; this is the lens, and it is the same everywhere.
//
// AND IT IS DEEPER THAN A SIXTEENTH, because the table cannot see the bottom of
// the frame. The committente, 2026-08-20: «Non c'è l'effetto vignettatura ai
// lati, o è poco evidente». They are right, and the reason is in how the table
// was measured: tools/grade/fit-veil.mjs reads the ratio of the reference to the
// frame ON THE SKY, because sky is the only thing whose value this project has
// already agreed on — so below the horizon there is nothing to read and every
// knot down there is the filler the smoothing pass left, near nine tenths. The
// reference is not near nine tenths down there. Measured on 168 pixel blocks,
// the fraction of the CENTRE's light each corner of the reference keeps:
//
//                    riferimento   il prodotto, con la 0,16
//   alto-sx              1.047            1.083
//   alto-dx              1.672            1.874
//   basso-sx             0.222            0.639
//   basso-dx             0.197            0.805
//
// (Above one at the top because the sky is brighter than the meadow in the
// middle of the frame; what matters is the gap between the two columns.)
//
// So the amplitude is refitted — s2-dev11/fit-lente.mjs — against the reference
// divided by the frame the world draws with no veil on it, the table divided
// back out, robustly, in |log| so that "twice as much" and "half as much" weigh
// the same. The LAW IS NOT TOUCHED: linear in the squared radius, corner value
// exactly 1 − this number. It has to stay that law because tools/grade/lib/
// shading.mjs reads this constant out of this file by name and applies
// 1 − strength · q with it, and a shape changed here and not there would be two
// bakes disagreeing about the same photograph with nothing to say so.
//
// The fit answers 0.42 (corner 0.58) with the law held, 0.46 at exponent 1.76 if
// the falloff is freed. The first is taken.
//
// WHAT THE FIT WAS NOT ALLOWED TO ANSWER. Fitted with no constraint at all the
// frame asks for 0.51, and it asks because the middle of the frame alone wants
// four fifths of the light: the reference and the product do not sit at the same
// overall level, and that is a grade, belonging to the LUT. A lens is one at the
// centre by definition, so a free gain is fitted alongside and thrown away —
// 0.79, on the record here so that the part not taken is visible. And the bottom
// eighth of the frame asks for a twentieth, in one cell for an eightieth, which
// is not a lens either: the reference's near foreground is a shadowed lawn where
// the product's is lit turf, and cells at the SAME RADIUS disagree by a factor
// of a hundred, which a lens cannot do. Carrying that here would be hanging the
// meadow's grade on an overlay that dissolves after two seconds, and the frame
// would break in half when it went. It is left where it belongs and written down
// in s2-dev11/VERBALE.md instead.
const LENS_VIGNETTE = 0.42;

// How long the arrival composition is held before it lets go, and how long it
// takes. Long enough that the greeting and the two rows of keys under it have
// been read, short enough that a walker who has already started moving is not
// waiting on it; and let go over a curve — --ui-ease, in the sheet — that is
// soft at both ends, so there is no moment at which the frame changes, the
// first one included.
//
// AND IT NEVER STARTS AT THE CLICK. The committente asked, 2026-08-20, whether
// the way in was being read as a first step. It is not, and the trace says so
// rather than the code: through a click on «Clicca per esplorare» the walker's
// speed stays at 0.00 m/s and this veil's opacity does not move — what changes
// at that instant is the start overlay coming off, which is a different sheet
// and was the whole of the complaint. The only two things that end the arrival
// are the clock below and 0.3 m/s of real speed.
//
// AND THE FIRST STEP ENDS IT EARLY. What this holds is an arrival, and a walker
// who has started walking has finished arriving: whichever comes first — this
// clock or the first step — is what lets go. The curve is the same one either
// way, so the frame never changes in a different way for having been walked out
// of rather than waited out.
const HOLD_MS = 2000;
const FADE_MS = 2500;

// And how long it takes for a walker who has asked their machine for no motion.
//
// It used to take no time at all: the sheet said `transition: none` under
// prefers-reduced-motion, so the deepest thing on the frame went from all of
// itself to nothing between two frames. That is the hardest cut in the whole
// interface, handed to exactly the people least able to take it — the setting
// exists because sudden change is what hurts. What the setting asks for is no
// MOVEMENT: nothing sliding, nothing scaling, nothing travelling across the
// frame. A short dissolve of a flat overlay moves nothing, and it is the
// difference between the arrival ending and the arrival being cut.
const REDUCED_FADE_MS = 400;

/** Whether this machine has asked for no motion, read once at the arrival. */
function wantsStill() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const FIELD = SKY.arrivalShading;

/**
 * The shading at a point of the frame, in normalised frame coordinates.
 *
 * Bilinear between the knots, which sit on the edges of the frame rather than
 * inside the cells: the corner of the table is the corner of the frame, so the
 * deepest reading the reference gave is the value that reaches the corner
 * rather than one interpolated away from it.
 *
 * @param {number} u across the frame, 0 at the left edge and 1 at the right
 * @param {number} v down the frame, 0 at the top edge and 1 at the bottom
 */
function shadingAt(u, v) {
  const x = Math.min(FIELD.cols - 1, Math.max(0, u * (FIELD.cols - 1)));
  const y = Math.min(FIELD.rows - 1, Math.max(0, v * (FIELD.rows - 1)));
  const i = Math.min(FIELD.cols - 2, Math.floor(x));
  const j = Math.min(FIELD.rows - 2, Math.floor(y));
  const tx = x - i;
  const ty = y - j;
  const top = FIELD.values[j * FIELD.cols + i] * (1 - tx) + FIELD.values[j * FIELD.cols + i + 1] * tx;
  const bottom = FIELD.values[(j + 1) * FIELD.cols + i] * (1 - tx)
    + FIELD.values[(j + 1) * FIELD.cols + i + 1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/**
 * The lens's own share, as the composite pass used to apply it.
 *
 * Identical arithmetic to the line it replaces — falling with the square of the
 * distance from the centre of the frame, twice the vignette at the corner —
 * so that the arrival composition is the frame that was measured against the
 * reference and not a new one.
 *
 * @param {number} u across the frame, 0 at the left edge and 1 at the right
 * @param {number} v down the frame, 0 at the top edge and 1 at the bottom
 */
function lensAt(u, v) {
  const dx = u - 0.5;
  const dy = v - 0.5;
  return 1 - LENS_VIGNETTE * (dx * dx + dy * dy) * 2;
}

/**
 * Hangs the arrival veil over the frame.
 *
 * It is a sibling of the interface rather than a child of it, so that hiding
 * the interface — which is what every comparison against the reference does —
 * leaves the frame carrying what the reference carried.
 *
 * @param {HTMLElement} before the interface layer this has to stay under
 */
export function createSkyVeil(before) {
  const el = document.createElement('canvas');
  el.className = 'sky-veil';
  el.setAttribute('aria-hidden', 'true');
  before.parentNode.insertBefore(el, before);

  // The one number the sheet and this file would otherwise both have to know —
  // and now the only place the reduced-motion length is decided, so the sheet
  // has no second opinion about it and the element cannot be taken off the page
  // while it is still fading.
  const fadeMs = wantsStill() ? REDUCED_FADE_MS : FADE_MS;
  let raisedFor = null;
  el.style.setProperty('--veil-fade', `${fadeMs}ms`);

  let painted = '';
  const paint = () => {
    const width = Math.max(1, Math.round(el.clientWidth));
    const height = Math.max(1, Math.round(el.clientHeight));
    const key = `${width}x${height}`;
    if (key === painted) return;
    painted = key;
    el.width = width;
    el.height = height;
    const context = el.getContext('2d');
    const image = context.createImageData(width, height);
    // Triangular noise of one least significant bit, two uniform draws
    // subtracted, exactly as the sky and the composite make theirs.
    let state = 0x2545f491;
    const rand = () => {
      state ^= state << 13; state >>>= 0;
      state ^= state >> 17;
      state ^= state << 5; state >>>= 0;
      return state / 4294967296;
    };
    for (let y = 0; y < height; y++) {
      const v = (y + 0.5) / height;
      for (let x = 0; x < width; x++) {
        const u = (x + 0.5) / width;
        const alpha = 1 - (shadingAt(u, v) * lensAt(u, v)) ** (1 / DISPLAY_GAMMA);
        image.data[(y * width + x) * 4 + 3] = Math.min(255, Math.max(0,
          Math.round(alpha * 255 + (rand() - rand()))));
      }
    }
    context.putImageData(image, 0, 0);
  };

  // Painted as soon as it exists, and not when it is started: a million pixels
  // of gradient is a few milliseconds, and the moment it would otherwise be
  // spent in is the moment the first frame of the world is being assembled.
  paint();

  const onResize = () => paint();
  let letGo = null;
  let gone = false;
  let walked = false;

  const release = () => {
    if (gone) return;
    gone = true;
    if (letGo) { clearTimeout(letGo); letGo = null; }
    el.classList.add('is-gone');
    // Taken off the page rather than left at nothing: an overlay the size of
    // the window costs the compositor a pass over every pixel of every frame
    // whether it is transparent or not, and this one has no second time.
    //
    // On its own clock rather than on the end of the transition, because a
    // transition that is interrupted — a walker who resizes the window into the
    // middle of it, a tab that goes to the background and comes back — never
    // sends its end, and an overlay waiting for one it will never get is one
    // that never leaves. The clock is the SAME LENGTH the sheet was handed, so
    // the two cannot disagree about when the last of it is gone.
    setTimeout(() => {
      window.removeEventListener('resize', onResize);
      el.remove();
    }, fadeMs);
  };

  return {
    /**
     * Starts the one time the veil is up, counted from the first frame that has
     * a world in it rather than from the page: what it is holding is the arrival
     * composition, and there is no arrival until there is somewhere to arrive.
     */
    /**
     * The frame changed size under it, so the shading has to be laid again.
     *
     * WHY IT IS NOT ENOUGH TO LISTEN FOR A RESIZE (E-DECISIONI33, point 3).
     * This veil covers the PICTURE now and not the window, and the picture can
     * change size without the window moving at all: the calibration decides the
     * framing at the end of the load and the page resizes itself once, behind
     * the opening scene, with no `resize` event anywhere. A veil that missed
     * that would spend the whole arrival laying the reference's corner shading
     * on corners that are not the picture's — which is the one composition this
     * entire campaign's grade was fitted against.
     *
     * Free when nothing moved: paint() compares the size it last drew at and
     * returns on a match.
     */
    relayout() { paint(); },

    begin(why = 'col suolo intero') {
      if (letGo || raisedFor) return;
      // WHY IT WENT UP WHEN IT DID, kept for the arrival's own guard: the veil
      // waits for the ground now (U-CAMPO-2, M5) and there is a ceiling under
      // that wait, so «col suolo intero» and «a tempo» are two different
      // arrivals and a measurement has to be able to say which one it saw.
      raisedFor = why;
      // A held clock is a held arrival. The flag exists so that the one instant
      // the reference was measured at can be photographed as many times as a
      // comparison needs, and the shading of that instant is part of it: a veil
      // that dissolves four seconds in makes the arrival the one composition
      // nobody can take a picture of, and every reading of it a race.
      if (isClockFrozen()) {
        paint();
        window.addEventListener('resize', onResize);
        return;
      }
      // Again, and free unless the window moved between the two: the first one
      // ran before the walker could have resized anything, and this one is the
      // last chance to notice that they did.
      paint();
      window.addEventListener('resize', onResize);
      letGo = setTimeout(release, HOLD_MS);
      // A walker who was already moving when the ground arrived has taken their
      // step already, and should not be handed the wait back.
      if (walked) release();
    },

    /**
     * The walker has taken their first step, so the arrival is over.
     *
     * Safe to call every frame and safe to call before begin(): a veil that was
     * never raised — a held clock, a page that is still loading — has nothing to
     * let go of, and one that has already gone stays gone.
     */
    firstStep() {
      if (walked) return;
      walked = true;
      if (letGo) release();
    },

    /**
     * A pose was imposed on the frame, so there is no arrival left to hold.
     *
     * WHY firstStep() COULD NOT DO IT. That one is the walker's, and it only
     * ever lets go of a clock that is already running: called before begin() it
     * arms a flag, and under a HELD clock — which is how every measurement in
     * this campaign stops the arrival long enough to photograph it — begin()
     * returns before the clock is ever set, so nothing is holding the veil and
     * nothing can be released. The frame then carries the arrival shading for as
     * long as the page is open, which is a quarter to a half of the light in the
     * corners of every plate taken that way, and it is one photograph minus one
     * smooth sky rather than a lens: it cannot be divided out afterwards.
     *
     * SO THIS ONE IS THE POSE'S, AND IT IS UNCONDITIONAL. src/dev/pose.js is the
     * single seat a pose is imposed through (E-LUCE5, D-L5-1 = A), and a pose
     * imposed from outside is not an arrival: nobody walked in, so there is
     * nothing to arrive from. Safe before begin(), after it, on a held clock and
     * on a running one, and safe twice — release() has its own gate, and a
     * begin() that lands afterwards finds the arrival already accounted for and
     * does not raise a second veil over a frame somebody is measuring.
     *
     * It is behind the development flag in every caller it has, because the one
     * thing that imposes a pose is behind that flag.
     */
    dismiss() {
      walked = true;
      if (!raisedFor) raisedFor = 'posa imposta';
      release();
    },

    /** Whether the veil went up on the whole ground or on the ceiling, and when. */
    get raisedFor() { return raisedFor; },
  };
}
