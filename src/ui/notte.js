// THE NIGHT, AND IT IS DRAWN IN TWO PLACES OUT OF ONE TEXT.
//
// The opening scene (src/ui/intro.js) is a long exposure of the northern sky:
// a dithered gradient about a pole, a field of far grains over it, and five
// hundred and twenty arcs turning rigidly on the compositor. Everything in
// here was written there, for that, and it has moved here UNCHANGED so that a
// second place can draw the same sky out of the same numbers.
//
// THE SECOND PLACE IS AROUND THE PICTURE. When the bench decides that this
// machine gets a framing smaller than its window (src/core/inquadratura.js),
// what surrounds the world cannot be a border somebody chose: it is the night
// the visit BEGAN in, on the same window, about the same pole, at the same
// radius — so that when the opening scene dissolves, the sky behind it does
// not move by a pixel and the world simply arrives inside it, like a
// photograph laid on the night it was taken in.
//
// WHY THAT IS AN EXTRACTION AND NOT A SECOND COPY. Two skies fitted by hand to
// look alike is two skies that stop looking alike the first time one of the
// eleven knobs below is turned. The scene keeps every decision it ever had —
// where the pole sits, how many arcs, how long a turn takes, what the quiet
// is — and this file is where those decisions live now. The scene draws the
// same bytes it drew before: the pixels come out of the same loops, seeded
// with the same constants, over the same geometry.
//
// WHAT IS *NOT* IN HERE is everything the scene alone has: the name, the
// sentence, the orbit and its comet, the lids of the waking, the progress
// ledger, the gesture. Those are the SCENE, and a night that knew about them
// would be a scene with the ceremony switched off rather than a sky.

// ------------------------------------------------------- the knobs of taste
//
// Each with the reason it is what it is, exactly as it was written in the
// scene. Tuning the picture is a line of arithmetic and not an excavation.

/** Where the pole sits down the frame. High, because the sky has to have room
 *  to turn UNDER the name — a pole at the middle puts half the rotation off the
 *  bottom of the screen and the picture stops reading as a vortex. */
export const POLE_Y = 0.32;

/** How many arcs. Under four hundred the sky reads as scattered marks; over six
 *  hundred the outer ring closes into a wash and the individual streak — the
 *  thing that says "long exposure" — is gone. */
export const TRAILS = 520;

/** The angular length of one streak, in degrees, with jitter. This is the
 *  exposure time made visible and it is the SAME for every star: that constancy
 *  is what empties the middle. Nine to fifteen degrees is a long-ish exposure,
 *  around half an hour of sky. */
export const ARC_MIN_DEG = 9;
export const ARC_MAX_DEG = 15;

/** The brightest a streak's head is allowed to be, as an alpha over the night.
 *  The design asked for 0.55, and 0.55 is what a LONE head would need to sit
 *  exactly on the committente's ceiling of 55% of white. But heads cross: at
 *  0.55 the crossings reached 67%, at 0.44 they still reached 59% and at 0.40
 *  one pixel in a million still reached 58%. This is the value at which NOT
 *  ONE pixel is over the ceiling at any of the four framings measured — the
 *  brightest is 54.0% — with the trails' own median at 18% and their 99.9th
 *  at 46%, and every pixel behind the type at four and a half. */
export const TRAIL_PEAK_ALPHA = 0.37;

/** And the floor, at the edge of the quiet: not nought, or the band where the
 *  trails begin would have a visible rim. */
export const TRAIL_FLOOR_ALPHA = 0.1;

/** Where the bell of brightness is full, in ρ = r / R_out. Inside 0.55 the sky
 *  is fading into the quiet; past 0.92 it is falling into the corners, which is
 *  what keeps the frame from having a lit edge. */
export const RHO_FULL_IN = 0.55;
export const RHO_FULL_OUT = 0.92;
export const RHO_DARK = 1.06;

/** The colours of the sky, from style.css. The heads are the near-white the
 *  engravings are cut in; the bodies are the three teals the whole interface is
 *  already lit with, so the scene is the same world as the menu behind it. */
export const TRAIL_TINTS = ['158,236,249', '127,212,245', '217,248,255'];
export const TRAIL_HEAD = '238,246,251';

/** One turn of the sky. 400 s is 0.9°/s — fast enough that a visitor sees the
 *  motion within a second of arriving, slow enough that it never becomes the
 *  thing they are looking at. ANTICLOCKWISE: the northern sky. */
export const SPIN_MS = 400000;

/** The night itself, as three stops in ρ. Darkest at the pole (the type has to
 *  sit on something), opening at 0.7 where the trails are brightest, and deep
 *  again at the corners so the frame closes rather than bleeding off. */
export const SKY = [
  [0.00, [4, 7, 15]],
  [0.70, [11, 22, 38]],
  [1.00, [6, 11, 20]],
];

/** Grains of far-off light in the static field. Not stars — stars have trails
 *  in this sky — but the dust that keeps a flat gradient from looking printed. */
export const DUST = 220;

/** The absolute ceiling on the turning bitmap's backing store, so an ultrawide
 *  cannot ask for one the size of a texture atlas. */
export const CAP_PX = 2800;

/** The glints: the one layer of this sky that runs on the main thread, and
 *  therefore the one layer that stops when the thread stops. Twenty-six points
 *  cannot be missed for a second and a half. */
export const SPARKS = 26;
export const SPARK_MS = 100;
export const SPARK_KEEP_OUT = 1.25;

/** AND THE SLOW ONE, WHICH IS THIS FILE'S OWN AND NOT THE SCENE'S.
 *
 *  A night that has been told it cannot afford to turn is not a night that has
 *  been told to die. What it keeps is the one thing a still sky still does:
 *  the stars BREATHE. Three times a second is under the rate at which a
 *  redrawing of twenty-six sub-pixel squares is worth measuring, and over the
 *  rate at which an eye reads a change of brightness as a step.
 *
 *  THE PERIODS ARE ALREADY DIFFERENT PER STAR — 1400 to 4000 ms out of the
 *  seeded draw in seedGlints — so nothing in here pulses together, which is
 *  what separates a sky from an indicator. */
export const SPARK_STILL_MS = 320;

// ---------------------------------------------------------------- arithmetic

export const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));

/** Hermite between two edges: the only shape used for every ramp in here, so
 *  nothing in the picture has a corner the eye can find. */
export function smoothstep(edge0, edge1, x) {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * The one source of chance in this sky, and it is a fixed one.
 *
 * Every arc, every grain of dust and every glint comes out of this, seeded with
 * a constant. A resize therefore REDRAWS THE SAME SKY at the new size instead
 * of dealing a new one: a walker who drags the window edge is meant to see the
 * picture stretch, not the picture change. It is also what makes the night
 * around the world and the night of the opening scene the SAME sky rather than
 * two skies that look alike.
 *
 * xorshift32, the same generator the veil and the sky bake already use.
 */
export function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

// ---------------------------------------------------------------- the geometry

/**
 * Where the sky turns and how far it reaches, for a window of this size.
 *
 * THE QUIET IS AN ARGUMENT AND NOT A MEASUREMENT HERE, which is the one way
 * this differs from the scene. The scene measures the block of type it has to
 * leave room for and puts the quiet outside it; around the world there is no
 * type, and what stands at the middle is the picture itself. So the caller says
 * what the quiet is, and the night around the world passes the scene's OWN
 * FLOOR — three tenths of the shorter side — which on the committente's window
 * is 253 px and is the number the scene itself settles on there.
 *
 * It is deliberately NOT the picture's half-diagonal. That looks like the
 * faithful translation and is the opposite of one: the quiet decides where the
 * bell of brightness starts, so a quiet the size of the picture would put the
 * whole ramp outside the frame and leave the visible band lit differently from
 * the band the scene lights. The sky is drawn WHOLE and the picture is laid on
 * top of the middle of it — which costs the arcs nobody sees one paint, once,
 * and buys a handover in which nothing moves.
 */
export function nightGeometry(width, height, quiet = null) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const poleX = Math.round(w / 2);
  const poleY = Math.round(h * POLE_Y);
  // The furthest corner from the pole, whichever it is: on a tall window that
  // is the bottom one, on a short one it can be the top.
  const rOut = Math.hypot(Math.max(poleX, w - poleX), Math.max(poleY, h - poleY));
  const rQuiet = quiet === null ? 0.30 * Math.min(w, h) : quiet;
  return {
    width: w, height: h, poleX, poleY, rOut, rQuiet,
  };
}

// --------------------------------------------------------------- the ground
//
// A THOUSAND PIXELS OF BLUE IS EIGHT LEVELS, SO THE RAMP IS DITHERED. A ramp
// over a thousand pixels crosses maybe eight levels of blue, so the browser's
// own gradient lays down eight visible rings — the exact banding the arrival
// veil already answers, and it is answered here the same way: the ramp is
// computed per pixel and dithered with one least significant bit of triangular
// noise, two uniform draws subtracted. Painted at CSS resolution like the veil,
// because a dither is a property of the image grid and an image the browser
// upscales still carries it.

export function paintField(field, geom) {
  const { poleX, poleY, rOut, rQuiet } = geom;
  // ROUNDED HERE AND NOWHERE ELSE, which is where the scene rounded it. A
  // window is allowed a fractional width under zoom, and moving the rounding
  // one function further out would change the sky by a pixel on exactly those
  // machines -- which is a byte the extraction does not get to spend.
  const w = Math.max(1, Math.round(geom.width));
  const h = Math.max(1, Math.round(geom.height));
  field.width = w;
  field.height = h;
  field.style.width = `${w}px`;
  field.style.height = `${h}px`;
  const ctx = field.getContext('2d');
  const image = ctx.createImageData(w, h);
  const rand = seeded(0x2545f491);
  for (let y = 0; y < h; y++) {
    const dy = y + 0.5 - poleY;
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - poleX;
      const rho = Math.min(1, Math.sqrt(dx * dx + dy * dy) / rOut);
      let i = 1;
      while (i < SKY.length - 1 && rho > SKY[i][0]) i++;
      const [r0, c0] = SKY[i - 1];
      const [r1, c1] = SKY[i];
      const t = (rho - r0) / (r1 - r0);
      // ONE triangular sample for all three channels: the ramp is very nearly
      // monochrome, so shared noise is a luma dither and leaves the hue where
      // it was, where three independent draws would speckle it.
      const d = rand() - rand();
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        image.data[o + c] = Math.round(c0[c] + (c1[c] - c0[c]) * t + d);
      }
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  // And the dust, over the top and outside the quiet: sub-pixel points, so
  // the browser's own antialiasing gives them their softness for nothing.
  ctx.fillStyle = '#cfeeff';
  for (let i = 0; i < DUST; i++) {
    const r = rQuiet * SPARK_KEEP_OUT + rand() * (rOut - rQuiet * SPARK_KEEP_OUT);
    const a = rand() * Math.PI * 2;
    const x = poleX + r * Math.cos(a);
    const y = poleY + r * Math.sin(a);
    if (x < 0 || y < 0 || x > w || y > h) continue;
    ctx.globalAlpha = 0.04 + rand() * 0.11;
    ctx.fillRect(x, y, 0.9, 0.9);
  }
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------- the trails
//
// ONE DRAWING, and then the compositor turns it. That is the whole anti-stall
// argument of this sky: during the arrival the main thread is not free — frames
// two and a third seconds apart were measured on this world — and anything
// redrawn per frame simply stops. A rigid rotation about the pole IS the star
// trail, so nothing is lost by giving it away to the compositor.

export function paintTrails(trails, geom) {
  const { poleX, poleY, rOut, rQuiet } = geom;
  const side = 2 * rOut;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Two ceilings: the device's, halved at two because past that the picture
  // is not better and the memory is real; and the absolute one, so an
  // ultrawide cannot ask for a backing store the size of a texture atlas.
  const scale = Math.min(dpr, CAP_PX / side);
  trails.width = Math.max(1, Math.round(side * scale));
  trails.height = trails.width;
  trails.style.width = `${side}px`;
  trails.style.height = `${side}px`;
  trails.style.left = `${poleX - rOut}px`;
  trails.style.top = `${poleY - rOut}px`;

  const ctx = trails.getContext('2d');
  // Drawing coordinates are CSS pixels with the origin ON THE POLE, whatever
  // the backing store turned out to be. Every number below is therefore the
  // number the design says, and the resolution is somebody else's problem.
  ctx.setTransform(scale, 0, 0, scale, trails.width / 2, trails.height / 2);
  ctx.clearRect(-rOut, -rOut, side, side);
  ctx.lineCap = 'round';

  const rand = seeded(0x9e3779b9);
  const rhoQ = rQuiet / rOut;
  // Never thinner than one physical pixel: a hairline that falls between two
  // pixels of the backing store is a hairline the eye reads as flicker when
  // the whole thing turns.
  const thinnest = 1 / scale;

  for (let i = 0; i < TRAILS; i++) {
    // Uniform per unit AREA — r = R·√u — so a ring's share of the stars is
    // its share of the sky, which is what makes the density rise with r on
    // its own. Then the quiet gate, by rejection: near the pole almost
    // nothing survives it, and the emptiness is a fact about the sampling
    // rather than a mask laid over the result.
    let r = 0;
    let rho = 0;
    for (let tries = 0; tries < 64; tries++) {
      rho = Math.sqrt(rand());
      r = rho * rOut;
      if (rand() <= smoothstep(rhoQ, RHO_FULL_IN, rho)) break;
    }

    // The bell: a floor at the edge of the quiet so the band has no rim, full
    // through the ring the eye is meant to land on, and down again into the
    // corners so the frame closes.
    const peak = TRAIL_FLOOR_ALPHA + (TRAIL_PEAK_ALPHA - TRAIL_FLOOR_ALPHA)
      * smoothstep(rhoQ, RHO_FULL_IN, rho)
      * (1 - smoothstep(RHO_FULL_OUT, RHO_DARK, rho));

    const len = ((ARC_MIN_DEG + rand() * (ARC_MAX_DEG - ARC_MIN_DEG)) * Math.PI) / 180;
    const a0 = rand() * Math.PI * 2;
    const tint = TRAIL_TINTS[(rand() * TRAIL_TINTS.length) | 0];
    const width = Math.max(thinnest, 0.9 + rand() * 1.1);

    // The head is the LEADING end, and the sky turns anticlockwise on the
    // screen, which in a coordinate system whose y points down is the
    // direction of decreasing angle. So the head is at a0 and the tail
    // trails behind it at a0 + len.
    //
    // The ramp is laid along the CHORD rather than along the arc: over
    // fifteen degrees the two differ by less than a hundredth of the radius,
    // and one stroke with one gradient costs what a dozen stitched
    // sub-segments cost, without the seam where two round caps overlap.
    const hx = r * Math.cos(a0);
    const hy = r * Math.sin(a0);
    const ramp = ctx.createLinearGradient(hx, hy, r * Math.cos(a0 + len), r * Math.sin(a0 + len));
    ramp.addColorStop(0, `rgba(${TRAIL_HEAD},${peak.toFixed(3)})`);
    ramp.addColorStop(0.18, `rgba(${tint},${(peak * 0.82).toFixed(3)})`);
    ramp.addColorStop(1, `rgba(${tint},0)`);
    ctx.strokeStyle = ramp;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(0, 0, r, a0, a0 + len);
    ctx.stroke();
  }
}

// --------------------------------------------------------------- the glints

export function seedGlints(spark, geom) {
  const {
    width: w, height: h, poleX, poleY, rOut, rQuiet,
  } = geom;
  // AND HERE THE WIDTH IS *NOT* ROUNDED, which is also what the scene did: the
  // bounds test below reads the window as it is and only the backing store is
  // rounded. The two are the same number on every machine that is not zoomed,
  // and where they differ this keeps the scene's own answer.
  const rand = seeded(0x27d4eb2f);
  const glints = [];
  const floor = rQuiet * SPARK_KEEP_OUT;
  for (let i = 0; i < SPARKS * 4 && glints.length < SPARKS; i++) {
    const r = floor + Math.sqrt(rand()) * Math.max(1, rOut - floor);
    const a = rand() * Math.PI * 2;
    const x = poleX + r * Math.cos(a);
    const y = poleY + r * Math.sin(a);
    if (x < 4 || y < 4 || x > w - 4 || y > h - 4) continue;
    glints.push({
      x, y, phase: rand(), period: 1400 + rand() * 2600, size: 1 + rand() * 1.4,
    });
  }
  spark.width = Math.max(1, Math.round(w));
  spark.height = Math.max(1, Math.round(h));
  spark.style.width = `${w}px`;
  spark.style.height = `${h}px`;
  return glints;
}

export function twinkle(spark, glints) {
  const ctx = spark.getContext('2d');
  const now = performance.now();
  ctx.clearRect(0, 0, spark.width, spark.height);
  ctx.fillStyle = `rgba(${TRAIL_HEAD},1)`;
  for (const g of glints) {
    const s = 0.5 - 0.5 * Math.cos(2 * Math.PI * ((now / g.period + g.phase) % 1));
    ctx.globalAlpha = 0.06 + 0.34 * s * s * s;
    ctx.fillRect(g.x - g.size / 2, g.y - g.size / 2, g.size, g.size);
  }
  ctx.globalAlpha = 1;
}

// ==========================================================================
// THE NIGHT AROUND THE PICTURE

// The colour the page is under all of it, and the colour the opening scene's
// cover is laid down in: they have to be the same number or the handover from
// the scene to the world is also a change of ground.
export const NIGHT = '#050b13';

/** How long a window has to stop being dragged before the sky is redrawn.
 *
 *  A field of a million and a half pixels is a per-pixel loop, and a drag of a
 *  window edge is fifty of them. The scene has the same guard — it asks the sky
 *  to notice sixteen pixels of quiet and not one — and this has the other half
 *  of it, because around the world a drag can change the framing on every
 *  frame while the scene's block never moves at all. */
const REDRAW_SETTLE_MS = 160;

const LAYER_STYLE = 'position:absolute;left:0;top:0;pointer-events:none';

/**
 * The night the world stands on, when the world is smaller than the window.
 *
 * @param {object} how
 * @param {HTMLElement} how.root      where it is hung. It is put FIRST, before
 *                                    the canvas, so the two are siblings in
 *                                    tree order and neither can clip or
 *                                    composite the other.
 * @param {boolean} how.animated      whether the sky turns. It is the BENCH's
 *                                    answer and not a preference: see
 *                                    src/core/quality.js.
 * @param {boolean} how.reduced       whether the visitor asked their machine
 *                                    for no motion. A DIFFERENT stillness from
 *                                    the one above, and the stronger of the
 *                                    two: a machine that cannot afford to turn
 *                                    still lets its stars breathe, and a
 *                                    visitor who asked for stillness gets it
 *                                    whole.
 */
export function createNight({ root = document.body, animated = true, reduced = null } = {}) {
  const still = reduced === null
    ? (typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    : reduced;

  const el = document.createElement('div');
  el.className = 'notte';
  el.setAttribute('aria-hidden', 'true');
  // WRITTEN HERE AND NOT IN A STYLESHEET, and the reason is the one that
  // governs this whole session: a page at the whole window must not differ from
  // the page this campaign has measured by so much as a rule that matches
  // nothing. A sheet would be bytes on the wire and a selector in the cascade
  // on every visit, including the ones that never build any of this.
  //
  // `overflow:hidden` because the turning square is two radii on a side and
  // hangs off every edge of the window on purpose — a trail must not end where
  // the frame does — and that overhang must not become a scrollbar.
  el.setAttribute('style', [
    'position:fixed',
    'inset:0',
    'overflow:hidden',
    'pointer-events:none',
    `background:${NIGHT}`,
  ].join(';'));
  el.innerHTML = '<canvas class="notte-field"></canvas>'
    + '<canvas class="notte-trails"></canvas>'
    + '<canvas class="notte-spark"></canvas>';

  const field = el.querySelector('.notte-field');
  const trails = el.querySelector('.notte-trails');
  const spark = el.querySelector('.notte-spark');
  for (const layer of [field, trails, spark]) layer.setAttribute('style', LAYER_STYLE);
  // The turning bitmap is a square centred on the pole, so its own middle IS
  // the pole and the rotation needs no correction.
  trails.style.transformOrigin = '50% 50%';
  trails.style.willChange = 'transform';

  root.insertBefore(el, root.firstChild);

  let geom = null;
  let key = '';
  let glints = [];
  let spin = null;
  let sparkTimer = null;
  let settleTimer = null;

  /** ONE ANIMATION FOR THE WHOLE VISIT, and it is never restarted.
   *
   *  The scene has to restart its own — it is a CSS animation on an element
   *  whose bitmap is repainted, and a restart with a negative delay is how it
   *  puts the phase back. Here the animation is an object rather than a
   *  declaration, so a repaint of the canvas underneath it is invisible to it:
   *  the sky keeps turning through a resize instead of going back to noon.
   *
   *  On the compositor, like the scene's: a transform and nothing else. */
  function turn() {
    if (spin || still || !animated) return;
    if (typeof trails.animate !== 'function') return;
    spin = trails.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-360deg)' }],
      { duration: SPIN_MS, iterations: Infinity, easing: 'linear' },
    );
  }

  function repaint() {
    paintField(field, geom);
    paintTrails(trails, geom);
    glints = seedGlints(spark, geom);
    if (sparkTimer) twinkle(spark, glints);
  }

  function measure() {
    geom = nightGeometry(window.innerWidth, window.innerHeight);
    // Sixteen pixels of quiet and not one, the same grain the scene asks for:
    // a repaint of a million and a half pixels is not worth a radius that moved
    // by three.
    return `${geom.width}x${geom.height}|${Math.round(geom.rQuiet / 16)}`;
  }

  const api = {
    /** The element, so a guard can find it and a caller can take it away. */
    get element() { return el; },

    /**
     * WHAT WAS ASKED FOR, AND WHAT CAME OUT, AND THEY ARE NOT THE SAME QUESTION.
     *
     * `asked` is the bench's verdict as it was handed in. `turning` is whether
     * this sky is actually moving, which is the verdict AND the visitor's own
     * setting: somebody who asked their machine for no motion gets a still sky
     * whatever the bench found.
     *
     * A caller deciding whether to REBUILD must read `asked`. Reading `turning`
     * would mean that, for exactly the visitors who asked for stillness, every
     * resize found a night that disagreed with the verdict and tore it down to
     * build the identical thing again.
     */
    get asked() { return animated; },
    get turning() { return animated && !still; },
    get still() { return still; },

    /** Drawn, hung, and turning. */
    start() {
      key = measure();
      repaint();
      turn();
      // THE STARS BREATHE EITHER WAY, and at two rates. Turning, they keep the
      // scene's own ten a second; held still by the bench, they are redrawn
      // three times a second, which is the whole of what a still night does.
      // A visitor who asked for no motion gets neither.
      if (!still) {
        sparkTimer = setInterval(() => twinkle(spark, glints),
          animated ? SPARK_MS : SPARK_STILL_MS);
      }
      return api;
    },

    /**
     * The window changed shape.
     *
     * Deferred, and only if the sky it asks for is a different sky: a drag of a
     * window edge is dozens of these and the field is a per-pixel loop.
     */
    relayout() {
      const next = measure();
      if (next === key) return;
      key = next;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => { settleTimer = null; repaint(); }, REDRAW_SETTLE_MS);
    },

    dispose() {
      if (sparkTimer) { clearInterval(sparkTimer); sparkTimer = null; }
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      if (spin) { spin.cancel(); spin = null; }
      el.remove();
    },
  };

  return api;
}
