// THE PICTURE IS A MEMORY AND NOT A WINDOW: WHERE ITS EDGE IS, AND WHAT IT IS
// MADE OF.
//
// src/core/inquadratura.js decides HOW BIG the world is drawn. It leaves the
// world a rectangle with a cut edge — the canvas simply stops — and the
// committente looked at that and said what it is (E-DECISIONI35, point 3):
//
//   «È quadrata, netta, poco bella esteticamente. Rendiamo gli angoli
//   arrotondati, e l'intero bordo sfumato. Come se fosse un sogno/ricordo.
//   L'effetto che deve risultare è una specie di vibrazione di ciò che c'è
//   dentro l'area esplorabile, che si riflette/estende al di fuori,
//   mischiandosi armoniosamente con il colore del wrapping.»
//
// So this module owns four numbers and the arithmetic that turns them into a
// canvas, a picture inside it, and a distance field the composite can read.
//
// WHAT IS DRAWN, AND WHERE. The canvas is LARGER than the picture by a margin.
// Inside the picture the world is exactly the world src/core/post.js has always
// assembled — the same buffers, the same grade, the same pixel. In the margin
// there is no world at all: the composite draws the blurred copy of the bloom
// it already has, enlarged outward and blurred again, falling to nothing at the
// edge of the canvas. That is the «vibrazione di ciò che c'è dentro che si
// estende al di fuori»: it is not a second picture and not an effect over the
// first, it is the frame's OWN light, spilt.
//
// WHY THE MASK IS IN THE COMPOSITE AND NOT IN THE SHEET. A `mask-image` or a
// `border-radius` on the canvas makes the browser recompose a layer the size of
// the frame on every frame of the visit — which is the cost the night around
// the world was measured paying (U-INQUADRATURA-1, §B.3: a full window layer
// recomposed per frame lands on the SAME fill the world is drawn with, +1.44 ms
// of the driver's own clock). The composite already visits every pixel of the
// canvas once; a signed distance and a smoothstep in that visit are free, and
// there is no second layer. The canvas carries alpha instead, and what shows
// through the soft edge is whatever is behind it: the night around the picture,
// or the page's own ground where there is none.
//
// THE FOUR NUMBERS ARE FRACTIONS OF THE PICTURE'S SHORT SIDE, never pixels: a
// corner radius that is a number of pixels is a different corner on a telephone
// and on a desk, and this is one shape and not two.

/**
 * THE CORNER, as a fraction of the short side of the picture.
 *
 * Big enough that it is unmistakably a rounded corner at a glance and not a cut
 * one that has been apologised for; small enough that the picture is still a
 * rectangle and not a lozenge. On the committente's window at eight tenths
 * (1514 x 676) it is thirty pixels.
 *
 * DECLARED AS A TASTE AND HELD TO BE CONFIRMED. The three of them together are
 * the plate `2026-09-21-inquadratura-2-cornice-varianti.png`, which is discreet,
 * middle and dreaming side by side; this is the middle one.
 */
export const RADIUS = 0.045;

/**
 * THE FEATHER: how wide the band is over which the world stops being there.
 *
 * «L'intero bordo sfumato» is this number and nothing else. It is measured
 * INWARDS from the edge of the picture, so the rectangle the arithmetic of
 * src/core/inquadratura.js hands over is still the outermost pixel the world
 * reaches — the framing has not quietly shrunk, it has become soft.
 *
 * Under about two hundredths it reads as an out-of-focus cut rather than as a
 * dissolve; over about five it eats visible meadow. Twenty pixels at eight
 * tenths of the committente's window.
 */
export const FEATHER = 0.030;

/**
 * THE MARGIN: how much canvas there is around the picture for the halo to live
 * in, as a fraction of the picture's short side.
 *
 * IT IS PAID IN COMPOSITE PIXELS AND NOT IN WORLD PIXELS, which is the whole
 * reason it can be this generous. The world is still drawn into the picture and
 * only into it — every buffer in src/core/post.js is the picture's size — and
 * what the margin adds is one more visit of the FINAL pass over pixels that
 * take a single texture tap and a fall-off. At seven and a half hundredths on
 * the committente's window at eight tenths that is a quarter more pixels for
 * the last pass of eleven.
 */
export const MARGIN = 0.075;

/**
 * HOW BRIGHT THE HALO IS, as a multiplier on the bloom's own light.
 *
 * One is «as bright as the blurred copy of the bloom actually is», which is
 * where this was set by eye: the halo has to be a reflection of the picture and
 * not a lamp behind it. The knob is here because it is the one of the four that
 * the committente is most likely to want moved, and because a plate of three
 * variants that did not move it would be three pictures of the same amount of
 * light.
 */
export const HALO = 1.0;

/**
 * AND THE THIN MARGIN, FOR A PICTURE THAT IS ALREADY THE WHOLE WINDOW.
 *
 * «A f = 1 (telefoni, macchine veloci): sì, con margine sottile»
 * (E-DECISIONI35, point 3). At the whole window there is nowhere to PUT a
 * margin: the canvas cannot grow past the glass. So the margin is taken out of
 * the picture instead, and it has to be a different number for it — a
 * seven-and-a-half-hundredths margin taken out of both sides of the window
 * would cost the world a sixth of its height, which is a framing decision taken
 * by a decoration.
 *
 * Two hundredths of the short side is nineteen pixels on the committente's
 * window and about eight on a telephone held upright: a hair of night around
 * the glass, which is what «sottile» means, and the corners and the feather do
 * the rest.
 *
 * THE BYTE AT f = 1 THEREFORE CHANGES, by the committente's own decision, and
 * the comparison against `main` moves to `?cornice=0` — which is this module
 * switched off entirely and the cut edge of sito-4, to the pixel.
 */
export const MARGIN_WHOLE = 0.022;

/** Nothing at all: the cut edge of sito-4. What `?cornice=0` answers, what
 *  every guard that photographs the WORLD opens the page at, and what the byte
 *  comparison stands on. */
export const OFF = {
  on: false, radius: 0, feather: 0, margin: 0, halo: 0,
};

const DEFAULTS = {
  on: true, radius: RADIUS, feather: FEATHER, margin: MARGIN, halo: HALO,
};

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/**
 * What the address asks the frame to be.
 *
 * `?cornice=r,s,m,a` — corner, feather, margin, halo, in that order, each a
 * fraction of the picture's short side except the last, which is a gain. A
 * shorter list leaves the rest at their defaults, so `?cornice=0.08` is «the
 * same frame with a bigger corner» and nothing else.
 *
 * `?cornice=0` is the one value that is not a corner radius: it is the frame
 * switched OFF, cut edge and all, which is what the byte comparison and every
 * guard that photographs the world are opened at. It is spelled as a zero
 * radius because a frame with no corner, no feather and no margin IS no frame,
 * and a second word for it would be a second thing to keep true.
 *
 * NOT behind ?dev, for the same reason `?inquadratura=` is not: it is a
 * visitor's switch and a plate's switch, and what it must never become is
 * something the bench can write.
 */
export function askedCornice(search = (typeof window === 'undefined' ? '' : window.location.search)) {
  const raw = new URLSearchParams(search).get('cornice');
  if (raw === null) return { ...DEFAULTS };
  const parts = raw.split(',').map((p) => Number(p.trim()));
  if (parts.length === 1 && parts[0] === 0) return { ...OFF };
  const pick = (i, fallback, hi) => (Number.isFinite(parts[i]) ? clamp(parts[i], 0, hi) : fallback);
  const out = {
    on: true,
    radius: pick(0, RADIUS, 0.5),
    feather: pick(1, FEATHER, 0.25),
    margin: pick(2, MARGIN, 0.35),
    halo: pick(3, HALO, 6),
  };
  // A frame with no corner AND no feather AND no margin is the cut edge, and
  // saying so here is what keeps the composite from carrying a branch that
  // computes a distance field in order to multiply by one.
  if (out.radius === 0 && out.feather === 0 && out.margin === 0) return { ...OFF };
  return out;
}

/**
 * The canvas, the picture inside it, and the four numbers in pixels.
 *
 * ONE RULE COVERS BOTH CASES, and there are only two: a picture smaller than
 * the window, where the margin is ADDED around it, and a picture that is
 * already the window, where it is taken OUT of it.
 *
 *   the canvas never leaves the window:  tela = min(quadro + 2m, finestra)
 *   the picture never fills the canvas:  quadro = min(quadro, tela - 2 sottile)
 *
 * At a framing of eight tenths the first line does nothing — there is room —
 * and the second does nothing either, because the margin is already wider than
 * the thin one. At the whole window the first clamps the canvas to the glass
 * and the second takes the thin margin out of the picture. In between, on a
 * framing large enough that the margin would spill off the window, the two
 * meet smoothly: the canvas stops growing and the picture starts shrinking.
 *
 * THE TWO MARGINS ARE NOT ALWAYS EQUAL, and that is not an accident. When the
 * canvas is clamped on one axis and not the other — an ultrawide window with a
 * picture nearly as tall as the glass — the picture keeps the margin it can
 * have on each side, and the distance field below is the distance to a
 * rectangle inside a rectangle, which does not care.
 *
 * @param {{width:number,height:number}} frame   the framing, in CSS pixels
 * @param {object} knobs                         what askedCornice() answered
 * @param {number} windowWidth                   the glass, in CSS pixels
 * @param {number} windowHeight
 */
export function corniceOf(frame, knobs, windowWidth, windowHeight) {
  const fw = Math.max(1, Math.round(frame.width));
  const fh = Math.max(1, Math.round(frame.height));
  if (!knobs || !knobs.on) {
    return {
      on: false,
      tela: { width: fw, height: fh },
      quadro: { width: fw, height: fh },
      marginX: 0, marginY: 0, radius: 0, feather: 0, halo: 0, reach: 0,
    };
  }
  const ww = Math.max(1, Math.round(windowWidth));
  const wh = Math.max(1, Math.round(windowHeight));
  const short = Math.min(fw, fh);
  const wanted = Math.round(knobs.margin * short);
  const thin = Math.max(1, Math.round(MARGIN_WHOLE * short));

  const telaW = Math.min(fw + 2 * wanted, ww);
  const telaH = Math.min(fh + 2 * wanted, wh);
  const quadroW = Math.max(1, Math.min(fw, telaW - 2 * thin));
  const quadroH = Math.max(1, Math.min(fh, telaH - 2 * thin));
  const marginX = (telaW - quadroW) / 2;
  const marginY = (telaH - quadroH) / 2;

  // The corner and the feather are fractions of the PICTURE's short side, and
  // the picture is what came out above rather than what was asked for: on a
  // window where the thin margin bit, a radius read off the framing would be a
  // radius of a rectangle that is not on the page.
  const shortOut = Math.min(quadroW, quadroH);
  return {
    on: true,
    tela: { width: telaW, height: telaH },
    quadro: { width: quadroW, height: quadroH },
    marginX,
    marginY,
    radius: Math.min(0.5 * shortOut, knobs.radius * shortOut),
    // The feather cannot eat more than half the picture, and it cannot be
    // wider than the corner is deep either — a feather that reached past the
    // corner's own centre would round the corner twice.
    feather: Math.min(0.4 * shortOut, knobs.feather * shortOut),
    halo: knobs.halo,
    // How far out the halo has room to reach before the canvas ends. Where the
    // two margins differ it is the larger, so the halo reaches the canvas edge
    // on the side that has room and is simply cut short on the other — which is
    // what the eye expects of a glow that ran out of paper.
    reach: Math.max(1, Math.max(marginX, marginY)),
  };
}

/**
 * The signed distance from a point to the picture's own outline, in pixels.
 *
 * Written here as well as in the composite's fragment — the two are the same
 * five lines — because this is the one that a guard can call. A rule about the
 * shape of the frame that could only be checked by photographing it would be a
 * rule nobody can run on a commit.
 *
 * @param {number} x  from the middle of the picture, in CSS pixels
 * @param {number} y
 * @param {{quadro:{width:number,height:number},radius:number}} shape
 */
export function distanceTo(x, y, shape) {
  const hx = shape.quadro.width / 2 - shape.radius;
  const hy = shape.quadro.height / 2 - shape.radius;
  const ex = Math.abs(x) - hx;
  const ey = Math.abs(y) - hy;
  const outside = Math.hypot(Math.max(ex, 0), Math.max(ey, 0));
  const inside = Math.min(Math.max(ex, ey), 0);
  return outside + inside - shape.radius;
}

/**
 * How much of the world a point keeps: one well inside, nought at the outline.
 *
 * The ramp is Hermite and it is laid INSIDE the outline — from one feather's
 * width in, to the outline itself — so the last pixel of the world is the last
 * pixel of the framing and the softness is paid for out of the picture rather
 * than added around it.
 */
export function coverAt(x, y, shape) {
  if (!shape.on) return 1;
  const d = distanceTo(x, y, shape);
  if (shape.feather <= 0) return d <= 0 ? 1 : 0;
  const t = clamp((d + shape.feather) / shape.feather, 0, 1);
  return 1 - t * t * (3 - 2 * t);
}
