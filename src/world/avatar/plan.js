// THE BODY, AS A LIST OF BOXES IN ITS OWN CELLS.
//
// This file is the only place the figure's shape is written down, and it is
// written ONCE for two readers that must never disagree: the mesher builds the
// solid from it, and the material rebuilds the COLOUR from it in the fragment.
// A body whose surface and whose palette came from two lists would drift the
// first time one of them was edited, and the drift would be invisible — a cell
// painted as jacket where the mesh has pack shows as a stain nobody can trace.
//
// WHY THE COLOUR IS NOT IN THE GEOMETRY. The recipe the world is made of has one
// architectural rule above the others: nothing that varies per voxel is ever
// stored in a vertex. It is not a style — it was measured, and the violation
// costs three times the geometry, because a per-voxel attribute is a per-voxel
// vertex and a merged rectangle cannot stand for a hundred cubes any more. The
// figure obeys it the same way the meadow does: the fragment works out which
// cell it is standing in and looks the answer up in the plan below, so a quad
// may span the seam between the jacket and the pack and still draw both.
//
// ------------------------------------------------------------- the lattice
//
// CELL (i, j, k) OCCUPIES [i, i+1) x [j, j+1) x [k, k+1) CELLS, and one cell is
// a third of the world's own step: 0.10 / 3 = 33.33 mm. That third is measured
// rather than chosen — the reference pictures put the figure's own step at 6 px
// against the 15 px a world cell spans at his distance, which is 0.40 of a cell,
// and the finest thing on him (the pack) carries it.
//
//   x   his RIGHT is positive. The spine is the PLANE x = 0, so the mirror is
//       i -> -1 - i and both halves of him are the same cells. A part that
//       straddles the spine therefore has an EVEN width; a limb has any width
//       and comes as a pair. Putting the spine on a boundary rather than
//       through the middle of a cell is what makes the two halves identical
//       instead of half a cell apart.
//   y   0 is the ground his soles stand on and 53 is the cell his crown is the
//       top of. Fifty four cells, which is 1.80 m exactly: that is what the
//       ratified height MEANS on this lattice.
//   z   negative is in FRONT of him — the frame src/core/player.js walks in has
//       forward at (-sin, -cos), so at yaw nought forward is -Z. The pack is
//       therefore at positive z, and everything the two pictures show best is
//       on that side.
//
// ---------------------------------------------------------- where it comes from
//
// EVERY ROW IS READ OFF THE TWO PICTURES ON THE FIGURE'S OWN GRID, and the
// reading is in v8-avatar/dev-b/ (mappa.mjs resamples each target onto this
// lattice; mappa.txt and the two PNGs are what was looked at). The crown and
// sole rows are the analysis unit's, measured with the campaign's tint rule:
// 575 and 934 by day, 535 and 896 by night, which makes one cell 6.65 px.
//
// WHAT IS MEASURED AND WHAT IS NOT, SAID PLAINLY. The pictures are of his BACK.
// So every height, every width, the pack and its pockets and the boots are read;
// the DEPTHS are not, and neither is his face. Depths here are the smallest
// numbers that stand a body up at the widths that were measured, and they are
// marked. The face is built because a head must have one, and it belongs
// entirely to the right hand column of the chapter's own table.
//
// THE FIGURE IS STYLISED AND THE MEASUREMENTS SAY SO. His head is nine cells
// across — 0.27 m, where a man's is 0.16 — and his shoulders and arms span
// twenty. That is not an error to be corrected towards anatomy: it is what the
// two pictures draw, and drawing something else would be building a different
// character.

/** The figure's own step, as a fraction of the world's. Exact. */
export const SUBDIVISION = 3;

/** How many cells tall he is. 54 x (0.10/3) = 1.80 m. */
export const CELLS = 54;

// ------------------------------------------------------------- the palette
//
// EACH ENTRY IS A LINEAR ALBEDO, in the same space as the meadow's own — the
// material multiplies it by the analytic face light and nothing else, exactly
// as src/world/voxel/material.js does, so a colour here means the same thing a
// colour there means.
//
// THEY ARE FITTED ON THE RENDER AND NOT PICKED OFF THE TARGET, which is the
// method the meadow's pigment was settled by and for the same reason: what the
// target shows is the end of a chain — light, tone curve, air, the arrival's own
// veil — and a number lifted out of the end of a chain and pushed in at the
// front comes out somewhere else. v8-avatar/dev-b/pigmento.mjs is the sweep: it
// lights one garment at a time to find which pixels are which, reads what the
// frame came out as, reads the reference in a window stated for that garment in
// v8-avatar/dev-b/finestre-dati.mjs, and steps. Eight rounds land every garment
// within one to three levels of what the reference reads, RMS 3.97.
//
// WHY THEY LOOK WARM FOR CLOTHES THAT ARE BLUE, and this has to be said out loud
// because it is the biggest declared residual on this delivery. The light these
// are fitted through is not yet the reference's light. At these framings the
// recipe's own meadow window reads 79,97,16 in the reference and 31,48,41 on the
// page — the blue two and a half times over, the green half under — which is the
// aerial perspective E-V5h has already measured (the page at 0.51-0.59 where the
// reference is at 0.03-0.21) plus the meadow pigment that E-V1c/E-V1e are still
// settling. Neither is this session's. A pigment fitted to come out right
// THROUGH that air has to lean warm to be heard at all, and these do.
//
// It is the campaign's own precedent and not an excuse: the meadow's pigment was
// fitted the same way, on the render, with the exposure and the two light
// colours left exactly as the campaign has them and the miss declared. The
// consequence is stated plainly: WHEN THE AIR AND THE MEADOW PIGMENT LAND, THESE
// EIGHT NUMBERS ARE REFITTED, and it is one command.
//
// NOTHING ABOVE ONE. An albedo is the fraction of the light a surface sends
// back, so a number over one is a lamp and not a colour. Skin is the one entry
// that asks for more than the ceiling and is held at it — the cost is measured
// and is 10.2 levels, the hand reading 52 where the reference reads 62. That gap
// is the air's, and it goes when the air does.
export const PALETTE = [
  // 0 — the jacket. The largest area on him, and the one the whole figure's
  //     reading rests on: 16,30,33 against the reference's 16,30,34.
  { id: 'giacca', albedo: [0.2147, 0.1985, 0.1392] },
  // 1 — the pack. What separates it from the jacket in the pictures is not that
  //     it is darker — it is barely darker — but that the blue is out of it.
  { id: 'zaino', albedo: [0.3114, 0.1503, 0.0560] },
  // 2 — the pack's outer pocket, a shade under the body of it, which is what
  //     draws the seam between them without a line being drawn.
  { id: 'tasca', albedo: [0.2658, 0.1345, 0.0579] },
  // 3 — the small dark label on that pocket, and the finest thing on the figure:
  //     four cells, seventy two pixels in the frame, and it is READ (6,10,11
  //     against 7,13,11) rather than assumed.
  { id: 'etichetta', albedo: [0.1643, 0.0938, 0.0032] },
  // 4 — the jeans. The darkest and bluest thing he wears.
  { id: 'jeans', albedo: [0.1232, 0.0859, 0.0536] },
  // 5 — the hair. Brown, and one of the two warm things on him.
  { id: 'capelli', albedo: [0.2455, 0.0963, 0.0146] },
  // 6 — the boots. The other warm thing, and the one the night lights from below
  //     in the reference — which V7 has not delivered, so tonight they are lit
  //     from above like everything else and that is declared, not simulated.
  { id: 'scarpe', albedo: [0.2290, 0.0969, 0.0044] },
  // 7 — skin: the hands, the back of the neck, and the face nobody sees. Held at
  //     the ceiling; see above.
  { id: 'pelle', albedo: [1.0000, 0.3813, 0.0372] },
];

export const PALETTE_INDEX = Object.fromEntries(PALETTE.map((p, i) => [p.id, i]));

// ---------------------------------------------------------------- the body
//
// ORDER MATTERS AND IS THE ONLY CONTROL FLOW HERE: a cell belongs to the LAST
// box that contains it. That is what lets the head be written as one solid of
// hair with a face laid into the front of it, instead of as five boxes that
// have to tile without a gap. Both readers walk the list the same way, so the
// two can no more disagree about the order than about the boxes.
//
// `solid: false` marks a box that COLOURS without FILLING — nothing here uses it
// yet, and it exists because the first thing a personalisation will want is to
// repaint a region rather than to add one.
const box = (id, x, y, z, opts = {}) => ({
  id,
  palette: PALETTE_INDEX[id],
  x0: x[0], x1: x[1], y0: y[0], y1: y[1], z0: z[0], z1: z[1],
  solid: opts.solid !== false,
});

/** The same box on the other side of the spine: i -> -1 - i. */
const mirrored = (b) => ({ ...b, x0: -1 - b.x1, x1: -1 - b.x0 });

const pair = (id, x, y, z, opts) => {
  const right = box(id, x, y, z, opts);
  return [mirrored(right), right];
};

export const BODY = [
  // --------------------------------------------------------------- the legs
  // Rows 33 to 49 of the pictures are two columns of navy with the paving
  // between them: six cells of leg either side of a two cell gap. Read on the
  // day picture at 3x, the left leg spans 6.3 cells and the right 6.5, with 1.0
  // between — a gap of one cell cannot be symmetric about the spine, so it is
  // two, and the half cell that buys goes into the legs. Above row 33 the
  // jacket covers them, so where they actually JOIN is in neither picture: the
  // seat below is what closes them, and its height is the one the jacket hides.
  ...pair('jeans', [1, 6], [4, 23], [-3, 2]),
  box('jeans', [-7, 6], [18, 24], [-3, 2]),

  // -------------------------------------------------------------- the boots
  // Five cells tall — their top edge reads at cell 48.9 — wider than the leg
  // and longer forward than back. The night picture is the one that says where
  // they stop: by day leather and stone are the same tint and the frame ends at
  // 940 before the sole does.
  ...pair('scarpe', [1, 6], [0, 4], [-6, 2]),

  // ------------------------------------------------------------- the jacket
  // The hem is at cell 32, level with the middle of his hands. Twelve cells
  // across the body and fourteen at the shoulder, which is the widest the
  // pictures put him before the arms start (12.8 read at the shoulder line).
  box('giacca', [-6, 5], [21, 43], [-4, 3]),
  box('giacca', [-7, 6], [38, 43], [-4, 3]),

  // --------------------------------------------------------------- the arms
  // Three cells thick — the sleeve reads 2.3 cells across and its outer edge at
  // cell 9.96, which is what fixes them at 7..9 rather than anywhere else.
  // Sleeve to cell 29, then four cells of hand.
  ...pair('giacca', [7, 9], [25, 42], [-3, 2]),
  ...pair('pelle', [7, 9], [21, 24], [-3, 2]),

  // ------------------------------------------------------- the neck and head
  // Nine cells of head over two of neck, and the hair reads seven to eight of
  // the nine. The head is a solid of HAIR with the face laid into the front of
  // it, because from behind that is what it is: the two pictures show the back
  // and the sides with irregular steps in them, and nothing of the face at all.
  box('pelle', [-2, 1], [43, 45], [-2, 1]),
  box('capelli', [-4, 3], [45, 53], [-4, 3]),
  box('pelle', [-3, 2], [46, 51], [-5, -4]),

  // -------------------------------------------------------------- the hood
  // Folded down on his shoulders, behind the neck: the raised mass the day
  // picture shows between the collar and the top of the pack, at cells 8 to 11.
  box('giacca', [-5, 4], [42, 45], [2, 5]),

  // --------------------------------------------------------------- the pack
  // THE FINEST DETAIL ON HIM, and the reason his cells are a third of the
  // world's rather than the same. Body, lid, one wide outer pocket with a small
  // dark label on it, a side pocket standing proud on each flank, and the two
  // straps over his shoulders.
  //
  // THE SIDE POCKETS SIT AT THE ARM'S OWN COLUMNS, which looks wrong until the
  // perspective is counted: they are five cells nearer the camera than the
  // sleeve is, so they project about three per cent wider and stand just proud
  // of it — which is exactly what the day picture shows on the near side, and
  // why the far one is hidden behind the shoulder. Put them further out in
  // BODY cells and the figure grows a pair of panniers the reference has not
  // got.
  box('zaino', [-6, 5], [24, 42], [3, 8]),
  box('zaino', [-6, 5], [39, 43], [2, 8]),
  box('tasca', [-4, 3], [27, 36], [8, 9]),
  box('etichetta', [-1, 0], [33, 34], [9, 9]),
  ...pair('zaino', [6, 9], [26, 35], [3, 7]),
  ...pair('zaino', [2, 3], [42, 44], [-5, 3]),
];

/**
 * Which palette entry a cell belongs to, or -1 for empty.
 *
 * THE ONE ANSWER, and both readers ask it: the mesher fills the lattice with it
 * and the material's fragment is generated from the same list in the same order.
 */
export function paletteAt(i, j, k) {
  let found = -1;
  for (const b of BODY) {
    if (i < b.x0 || i > b.x1 || j < b.y0 || j > b.y1 || k < b.z0 || k > b.z1) continue;
    found = b.palette;
  }
  return found;
}

/** The lattice the body needs, as whole cells, with nothing to spare. */
export function bounds() {
  const b = {
    x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity,
  };
  for (const part of BODY) {
    b.x0 = Math.min(b.x0, part.x0); b.x1 = Math.max(b.x1, part.x1);
    b.y0 = Math.min(b.y0, part.y0); b.y1 = Math.max(b.y1, part.y1);
    b.z0 = Math.min(b.z0, part.z0); b.z1 = Math.max(b.z1, part.z1);
  }
  return b;
}
