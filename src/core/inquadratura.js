// HOW MUCH OF THE WINDOW THE WORLD IS DRAWN INTO, AND WHY IT IS AN AREA AND NOT
// A SCALE.
//
// The frame costs what it costs PER PIXEL DRAWN. Measured on the reference
// machine (U-PERF-7, E-LINUX1): 898 000 pixels read 14,2 ms and 399 000 read
// 8,6 — about four milliseconds that do not move and about ten more for every
// nine hundred thousand pixels, with the ray marched ground taking two thirds
// of them and tracking its own count to within a point.
//
// There are two ways to draw fewer pixels and they are not the same purchase.
//
//   THE SCALE draws the SAME rectangle over fewer samples and lets the display
//   engine stretch it back. It is the first lever of every tier and it is the
//   right one down to a point, because nothing leaves the picture. Past that
//   point the texel of the ground is wider than the pixel of the screen, the
//   engraved writing softens with the meadow, and the frame starts to shimmer
//   where it used to be still: it is exactly the ugliness the tiers Bassa and
//   Minima are argued over in src/core/quality.js.
//
//   THE AREA draws a SMALLER rectangle at the pixel the screen actually has.
//   Nothing softens, nothing shimmers, the multisampling is still two, the
//   ground keeps its own texel and its temporal memory, and what is paid is
//   that the picture is smaller inside the window. The committente's own words
//   (E-DECISIONI32): «un'inquadratura più piccola dentro la finestra del
//   browser, decisa una volta nel caricamento dal banco di prova in base alla
//   potenza della macchina, e poi FISSA per tutta la visita».
//
// So this module owns the second lever. It is NOT a tier: the governor never
// touches it, because a picture that changed SIZE while somebody was walking
// through it would be the one thing in all of this that a visitor cannot help
// seeing. It is decided once, in the load, behind the opening scene, and it is
// remembered with the rest of the calibration.
//
// WHAT SURROUNDS THE PICTURE is src/ui/notte.js: the night of the opening
// scene, the same one the visit began in, so the frame stands on the sky it
// arrived from rather than on a border somebody chose.

// ---------------------------------------------------------- the device ratio
//
// THESE TWO LIVED IN src/core/renderer.js AND THEY BELONG HERE, which is the
// one place in this repository whose whole subject is how many pixels the world
// is allowed. The renderer imports them back; nothing else changed about them.
//
// Above ~1.5 the extra pixels buy nothing visible on the target hardware
// (mid-range integrated GPUs) while costing fill rate linearly.
export const MIN_PIXEL_RATIO = 1.0;
export const MAX_PIXEL_RATIO = 1.5;

/** What a display's own ratio is worth here, between the two ceilings above. */
export function deviceRatio(dpr = (typeof window === 'undefined' ? 1 : window.devicePixelRatio)) {
  return Math.min(MAX_PIXEL_RATIO, Math.max(MIN_PIXEL_RATIO, dpr || 1));
}

// ------------------------------------------------------------- the two ceilings

/**
 * THE PROPORTION CEILING. «proporzioni della finestra con tetto 16:9».
 *
 * Past sixteen by nine — an ultrawide, a browser dragged out across two thirds
 * of a desk — the framing is as TALL as the fraction allows and sixteen ninths
 * of that wide, centred, and the rest is night. A world that filled a 21:9
 * window would be a world seen through a letterbox: the hub is a ring of six
 * stones around a walker, and what an ultrawide adds to it is meadow at the
 * edges at the price of every pixel of it.
 */
export const ASPECT_CEILING = 16 / 9;

/**
 * AND IT ONLY STARTS BELOW NINE TENTHS (E-DECISIONI33).
 *
 * The committente's own window is 2.239:1, which is ABOVE sixteen by nine. So
 * a proportion ceiling that applied at every fraction would make the very first
 * step away from the whole window cost WIDTH rather than size: at nine tenths
 * the picture would go from 1892 px of width to 1521 in one move, and the world
 * would lose a slice of meadow off each side for a fraction that was only ever
 * meant to make it smaller.
 *
 * The bench answers nine or nineteen twentieths on that machine (§A.4), so this
 * line is what decides what the committente actually gets: **the first step
 * keeps the shape of the window**, and the letterbox rule is held back for the
 * fractions where the picture is small enough that a 21:9 slice of it would be
 * paying for meadow nobody looks at.
 */
export const ASPECT_FROM = 0.9;

/**
 * THE ABSOLUTE CEILING, IN CSS PIXELS, AND WHY IT IS COUNTED THAT WAY.
 *
 * The committente's window — the one every plate of this campaign is taken at,
 * and the one the tiers were fitted against — is 1892 x 845, which is
 * 1 598 740 CSS pixels. This sits just above it. So the reference machine does
 * not move by a single pixel because of this line, which is the property that
 * lets every number already measured in this repository stand; and a 4K panel,
 * which would ask for 8 294 400 and five times the frame, is contained.
 *
 * CSS PIXELS AND NOT BUFFER PIXELS (E-DECISIONI33), and the difference is a
 * whole class of screens. Counted in BUFFER pixels this ceiling reads the
 * device ratio too, so the SAME window on a retina laptop counts 2.25 times
 * over and the framing shrinks to a little over three quarters — on a machine
 * that is very often the faster one, and for a picture that is physically no
 * larger. The committente asked for a ceiling on how much of the SCREEN the
 * world occupies, not a second tax on a screen that happens to be dense; and
 * the device ratio already has its own ceiling one screen up (MAX_PIXEL_RATIO,
 * 1.5), which is where that particular purchase is argued.
 *
 * WHAT THAT COSTS, DECLARED: a dense screen really does draw up to 2.25 times
 * the pixels of a coarse one at the same framing, and this line does not stop
 * it. What stops it there is the bench, which measures that machine and hands
 * back a smaller fraction if it needs one — which is the right instrument for a
 * question about a machine. This one is for a question about a window.
 *
 * IT IS PAID FOR BY REDUCING THE FRACTION AND NEVER THE SCALE. That is the
 * whole argument of this module: a big monitor gets a picture of the size the
 * machine can hold, at the pixel the monitor actually has, with night around
 * it — not the whole monitor full of a blurred one.
 */
export const PIXEL_CEILING = 1700000;

/**
 * And the floor, which is the committente's: «pavimento al 60 % del lato».
 *
 * It is a floor on WHAT THE BENCH MAY CHOOSE, not on what the ceilings above
 * may impose. A machine too slow for six tenths does not get a smaller picture;
 * it gets six tenths and the tiers do the rest, as they always did. A monitor
 * too large for the pixel ceiling does get a smaller one, because the ceiling
 * is about a number of pixels and not about a machine.
 */
export const FRACTION_FLOOR = 0.6;

/** The rungs the bench is allowed to answer with. Five hundredths apart: finer
 *  than that is a number nobody can see and a stored value nobody can read. */
export const FRACTIONS = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6];

// --------------------------------------------------------------- the geometry

/**
 * The framing, in CSS pixels, for a window and a fraction.
 *
 * ONE IS NOT A FRACTION, IT IS THE ABSENCE OF A FRAMING. At f = 1 the world
 * fills the window exactly as it did before any of this existed — no ceiling,
 * no night, no centred rectangle, the same bytes. That is what `?inquadratura=1`
 * buys a guard and what a machine fast enough gets for nothing, and it is the
 * one discontinuity in here: on a window wider than 16:9, f = 1 is the whole
 * window and f = 0.99 is sixteen ninths of it. It is declared rather than
 * smoothed, because the alternative is to change what today's page draws on
 * every ultrawide in order to make a curve continuous at a point nobody stands
 * on.
 *
 * IT TAKES NO DEVICE RATIO, and that is the second half of E-DECISIONI33: both
 * ceilings are now questions about the WINDOW, in the window's own units, so
 * the same window answers the same way on every screen that displays it. See
 * PIXEL_CEILING.
 *
 * @param {number} fraction      how much of the window's SIDE, 0..1
 * @param {number} windowWidth   the window, in CSS pixels
 * @param {number} windowHeight
 * @returns {{width:number,height:number,fraction:number,framed:boolean,held:string}}
 */
export function frameOf(fraction, windowWidth, windowHeight) {
  const w0 = Math.max(1, Math.round(windowWidth));
  const h0 = Math.max(1, Math.round(windowHeight));
  const asked = Number.isFinite(fraction) ? fraction : 1;
  if (asked >= 1) {
    return {
      width: w0, height: h0, fraction: 1, framed: false, held: 'niente',
    };
  }
  const f = Math.max(0.05, asked);

  // The fraction is of the SIDE, so it is read off the height and the width
  // follows the window's own shape — all the way, down to ASPECT_FROM, where
  // the proportion ceiling starts. See the note over ASPECT_FROM for why the
  // first step keeps the window's shape.
  let height = h0 * f;
  let width = w0 * f;
  let held = 'frazione';
  if (f < ASPECT_FROM && width > height * ASPECT_CEILING) {
    width = height * ASPECT_CEILING;
    held = 'sedici-noni';
  }

  // AND THE PIXEL CEILING LAST, because it is the only one that can overrule
  // the fraction the bench chose rather than merely shape it.
  if (Math.round(width) * Math.round(height) > PIXEL_CEILING) {
    const shrink = Math.sqrt(PIXEL_CEILING / (width * height));
    width *= shrink;
    height *= shrink;
    held = 'pixel';
    // Floored rather than rounded: rounding can put a ceiling back over itself
    // by a pixel of side, and a ceiling that is exceeded by a pixel is a
    // ceiling a guard has to be told to forgive.
    return {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
      fraction: Math.floor(height) / h0,
      framed: true,
      held,
    };
  }

  const out = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  return {
    width: out.width,
    height: out.height,
    fraction: out.height / h0,
    framed: true,
    held,
  };
}

/**
 * How many pixels of buffer a framing costs at a given fraction of side.
 *
 * Floored on each side on purpose: it is the same arithmetic drawingBuffer()
 * does in src/core/renderer.js, and a model fitted against a different rounding
 * would be a model of a frame nobody draws.
 */
export function bufferPixels(frame, ratio = 1, scale = 1) {
  const r = Math.max(0.01, ratio * scale);
  return Math.floor(frame.width * r) * Math.floor(frame.height * r);
}

// ------------------------------------------------------------- the handle

/**
 * The fraction the address asks for, or null.
 *
 * `?inquadratura=<f>` pins the framing and the bench never decides one. It is
 * how every plate of this session is taken, how the guards photograph a world
 * instead of a verdict, and how the committente can put a number on their own
 * screen and look at it.
 *
 * NOT behind ?dev, and that is deliberate: it is a visitor's switch in the same
 * sense ?intro=0 is one. What it must never become is a tuning knob for the
 * bench — it does not move the model, it replaces the answer.
 */
export function askedFraction(search = (typeof window === 'undefined' ? '' : window.location.search)) {
  const raw = new URLSearchParams(search).get('inquadratura');
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.max(FRACTION_FLOOR, Math.min(1, value));
}

// ------------------------------------------------------------- the window

/**
 * The window, in the pixels a buffer would be built out of it.
 *
 * WHAT THE CALIBRATION IS AN ANSWER ABOUT, and the reason this is not the same
 * number as the buffer. `PIXEL_TOLERANCE` in src/core/quality.js asks whether
 * the frame has changed size enough for what was measured about this machine to
 * have stopped being about this frame — and the framing is a DECISION taken on
 * that measurement, not an input to it. Compared against the buffer, a stored
 * answer would be re-asked the moment its own framing was applied, every visit,
 * for ever: the bench reads the whole window, decides on eight tenths of it,
 * and the next visit finds a buffer two thirds the size of the one it stored.
 * Against the window it is a question about the glass, which is what it always
 * meant.
 */
export function windowPixels(
  width = (typeof window === 'undefined' ? 0 : window.innerWidth),
  height = (typeof window === 'undefined' ? 0 : window.innerHeight),
  ratio = deviceRatio(),
) {
  return Math.floor(width * ratio) * Math.floor(height * ratio);
}

// ------------------------------------------------------------- the model
//
// WHAT A FRAME COSTS, AS A FUNCTION OF HOW MANY PIXELS IT IS, MEASURED.
//
// The two terms below are a least squares fit over five framings on the
// reference machine — 1892 x 845, the window every plate of this campaign is
// taken at — at the tier the calibration itself runs at (`medio`, eight and a
// half tenths of side), on the pose the calibration HOLDS (the arrival: see
// SWEEP_DEGREES in src/core/bench.js, which is nought), with the eleven stage
// timers OFF because a visitor's page has no `?dev` and the note over
// setTiming() in src/core/renderer.js says what eleven timer queries cost.
// Three rounds per framing, the order of the arms reversed on alternate rounds,
// the median of the three taken:
//
//     frazione   buffer        Mpx      p50 dei tre giri          mediana
//     1.0        1608 x 718    1.155    16.90 / 18.88 / 17.82     17.82
//     0.9        1149 x 646    0.742    12.04 / 12.40 / 12.36     12.36
//     0.8        1021 x 574    0.586    12.67 /  9.92 /  9.72      9.92
//     0.7         894 x 503    0.450     8.23 /  7.96 /  7.91      7.96
//     0.6         765 x 430    0.329     6.44 /  6.32 /  6.66      6.44
//
// The line through them misses no point by more than 0.21 ms over a range of
// two and four fifths in pixels, with an rms of 0.12 — which is to say the
// frame of this world IS a fixed cost plus a cost per pixel, and the second one
// is almost all of it. That is the whole justification for buying milliseconds
// with AREA, and it is why this file exists rather than a table of framings
// somebody tuned by eye.
//
// THE FIXED TERM IS NOT THE SAME NUMBER U-PERF-7 READ, and it should not be:
// that one was fitted at the tier `minimo`, which draws less grass, no
// multisampling and a smaller ground disc. Two tiers are two lines. This is the
// line of the tier the bench runs at, which is the only line the bench can use.
export const MODEL = { fixedMs: 1.824, msPerMegapixel: 13.914 };

/** What the model says a frame of this many pixels costs, in the reference
 *  machine's own milliseconds. It is used as a RATIO and never as an absolute:
 *  see predictMs(). */
export function modelMs(pixels) {
  return MODEL.fixedMs + MODEL.msPerMegapixel * (pixels / 1e6);
}

/**
 * What a frame of `pixels` will cost on the machine that read `benchMs` at
 * `benchPixels`.
 *
 * IT IS A RATIO AND NOT AN ABSOLUTE, which is what makes one measured line do
 * for every machine. The model above is the reference machine's; another
 * machine is taken to be some factor faster or slower than it, and the factor
 * falls out of the one reading the bench actually took. So what is trusted is
 * the SHAPE of the curve — a fixed part and a part per pixel — and never its
 * height, and the height is measured on the machine in front of us, once, in
 * three seconds.
 *
 * AND IT WORKS ON A READING THAT IS NOT MILLISECONDS AT ALL. Where there is no
 * timer query, src/core/bench.js reads the INTERVAL between frames instead of
 * their cost; a ratio of two model values is dimensionless, so the same
 * arithmetic predicts an interval from an interval. What changes is the ceiling
 * it is held to, and that is the caller's to pass.
 */
export function predictMs(benchMs, benchPixels, pixels) {
  if (!(benchMs > 0) || !(benchPixels > 0)) return null;
  return benchMs * (modelMs(pixels) / modelMs(benchPixels));
}
