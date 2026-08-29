// WHO THE WALKER IS LOOKING AT, AND WHAT HE OR SHE IS WEARING.
//
// The chapter asks for a LIGHT personalisation — a body to choose and a few
// variants — and light is meant literally here: nothing below costs a triangle,
// a draw call, a byte on the wire or a rebuild. The body is a flag on one of two
// meshes that are already built; a variant is a uniform.
//
// ------------------------------------------------- no colour is invented here
//
// A VARIANT IS TWO OF THE REFERENCE'S OWN PIGMENTS, MIXED. It would have been
// quicker to type three nice blues into a table, and it would have been wrong
// three times over.
//
//   * Those numbers would be this seat's taste dressed as measurement, in a file
//     where every other number is read off a picture.
//   * They would go stale the moment R3 refits the palette against the air D5
//     owns: the base colour would move and the variants would sit where they
//     were, so a walker who had chosen one would be the only one still wearing
//     the old air. Mixing two entries of PALETTE means every variant moves in
//     the same commit that moves the pigments, with nothing here edited.
//   * They would be fitted through nothing. The eight pigments were fitted ON
//     THE RENDER, through an air that is not yet the reference's — plan.js says
//     so at length — and that is why they read warm for clothes that are blue. A
//     colour invented in albedo space and pushed through that same air comes out
//     somewhere nobody predicted. A mix of two pigments that were BOTH fitted
//     through it cannot: whatever the air does to the two ends it does to every
//     point between them.
//
// AND IT IS PUT BACK AT THE LUMINANCE IT HAD, which is the other half of the
// rule. The pigments were fitted so each garment lands within a level or three of
// what the reference reads; a variant that changed how BRIGHT the jacket is would
// walk out of that fit and take the whole figure's reading with it. So the mix is
// rescaled to the base pigment's own luminance and only the hue moves. A
// personalised figure is still the figure that was measured.
//
// FIRST A ROTATION WAS TRIED, AND IT IS WORTH SAYING WHY IT WENT. A
// luminance-preserving hue rotation is the textbook answer and it is clean in
// albedo space — but the pigments are not equally saturated, and the hair has
// almost no blue in it at all (0.0146). The render's own gain on that channel is
// therefore enormous, and a forty degree turn that looks modest in the table
// comes out as blue hair on the page. What the eye is asked to accept is the
// RENDERED colour, and the only variants whose render is predictable are the ones
// built out of pigments whose render is already known.
//
// WHAT IS THIS SEAT'S TASTE AND IS DECLARED AS SUCH: WHICH garments are offered,
// which pigment each leans towards, and how far. There is nothing in either
// picture to measure any of it against — the reference shows one man in one
// outfit — so they are choices, they are marked, and they have gone up to the
// committente as a question with options rather than being quietly settled here.
import { PALETTE, PALETTE_INDEX } from './plan.js';

/** Luminance weights, the campaign's own. */
const LUMA = [0.2126, 0.7152, 0.0722];

const luminance = (a) => LUMA[0] * a[0] + LUMA[1] * a[1] + LUMA[2] * a[2];

/**
 * `base` leaned `t` of the way towards `other`, put back at `base`'s luminance
 * times `level`.
 *
 * At t = 0 and level = 1 it is `base` to the last bit, which is what lets "the
 * one the pictures show" be an ordinary entry in the list rather than a special
 * case.
 *
 * TWO AXES, AND THE SECOND ONE IS WHY. Leaning alone gives a thin choice: the
 * jacket is the ONLY cool pigment the reference contains — every other entry has
 * more red than blue — so every jacket a mix can reach is a warmer jacket, and
 * three points on one line is not a personalisation. `level` scales the pigment
 * without touching its hue, which is a second axis that still invents nothing:
 * a lighter jacket is the measured jacket, brighter. It is offered on ONE variant
 * per garment and it does move that garment off the fitted level — deliberately,
 * because the fit describes the figure the pictures show, which is what the
 * default is for, and every measurement in this chapter is taken there.
 */
export function lean(base, other, t, level = 1) {
  if (!t && level === 1) return [...base];
  const mix = t ? base.map((v, i) => v + (other[i] - v) * t) : [...base];
  const want = luminance(base) * level;
  const got = luminance(mix);
  const out = got > 1e-6 ? mix.map((v) => (v * want) / got) : [...base];
  // AN ALBEDO IS STILL A FRACTION AFTER IT HAS BEEN MIXED. plan.js's own rule —
  // nothing above one, because a number over one is a lamp — does not stop
  // applying because the colour moved. Clamped, and whether the clamp ever bites
  // on the entries below is checked rather than hoped: it does not.
  return out.map((v) => Math.min(1, Math.max(0, v)));
}

/**
 * WHICH GARMENTS ARE OFFERED, and which pigment each one can lean towards.
 *
 * Three, and they are the three a walker reads first at this distance: the
 * jacket is the largest area on the figure, the jeans the second, the hair the
 * one thing that says which person this is. The pack is deliberately NOT here —
 * it carries the finest detail on the figure and it is what the two pictures are
 * checked against, so leaving it alone keeps every measurement in this chapter
 * comparable whatever the walker has chosen.
 *
 * The names say what the variant IS — which pigment it leans towards — and not
 * what colour it looks like. A colour word here would be a claim about the end of
 * the chain, and the end of the chain is exactly what R3 is going to move.
 */
export const VARIANTS = {
  giacca: [
    { id: 'misurata', label: 'Come nelle immagini', towards: null, t: 0 },
    { id: 'cuoio', label: 'Verso il cuoio', towards: 'scarpe', t: 0.7 },
    { id: 'chiara', label: "Piu' chiara", towards: null, t: 0, level: 1.7 },
  ],
  jeans: [
    { id: 'misurata', label: 'Come nelle immagini', towards: null, t: 0 },
    { id: 'cuoio', label: 'Verso il cuoio', towards: 'scarpe', t: 0.7 },
    { id: 'scuri', label: "Piu' scuri", towards: null, t: 0, level: 0.55 },
  ],
  capelli: [
    { id: 'misurata', label: 'Come nelle immagini', towards: null, t: 0 },
    { id: 'giacca', label: 'Verso la giacca', towards: 'giacca', t: 0.7 },
    { id: 'chiari', label: "Piu' chiari", towards: null, t: 0, level: 1.8 },
  ],
};

/** The two bodies, under the names the plan gives them. */
export const CORPI = [
  { id: 'm', label: 'Maschile' },
  { id: 'f', label: 'Femminile' },
];

/**
 * WHAT IS CHOSEN, RIGHT NOW. One object, one writer, read by the layer — the
 * same shape STANDING has in src/core/avatar.js and for the same reason: a
 * second copy of the answer is a second answer.
 */
export const LOOK = {
  corpo: 'm',
  giacca: 'misurata',
  jeans: 'misurata',
  capelli: 'misurata',
  /** Bumped by every change, so the layer can tell "still the same" for nothing. */
  revision: 0,
};

/** Set one of the choices. An unknown name or id is refused, not ignored. */
export function choose(what, id) {
  if (what === 'corpo') {
    if (!CORPI.some((c) => c.id === id)) throw new Error(`no such body: ${id}`);
  } else if (VARIANTS[what]) {
    if (!VARIANTS[what].some((v) => v.id === id)) throw new Error(`no such variant: ${what}/${id}`);
  } else {
    throw new Error(`nothing to personalise called ${what}`);
  }
  if (LOOK[what] === id) return LOOK[what];
  LOOK[what] = id;
  LOOK.revision += 1;
  return LOOK[what];
}

/**
 * The eight albedos as they are RIGHT NOW: the measured palette, with whatever
 * the walker has chosen leaned into it.
 *
 * Rebuilt from PALETTE on every call rather than cached, because it is called
 * when a choice changes and not per frame, and a cache here would be the second
 * copy this file exists to avoid.
 */
export function albedos() {
  const out = PALETTE.map((p) => [...p.albedo]);
  for (const [what, list] of Object.entries(VARIANTS)) {
    const chosen = list.find((v) => v.id === LOOK[what]);
    if (!chosen || (!chosen.towards && (chosen.level ?? 1) === 1)) continue;
    out[PALETTE_INDEX[what]] = lean(
      PALETTE[PALETTE_INDEX[what]].albedo,
      chosen.towards ? PALETTE[PALETTE_INDEX[chosen.towards]].albedo : PALETTE[PALETTE_INDEX[what]].albedo,
      chosen.t,
      chosen.level ?? 1,
    );
  }
  return out;
}
