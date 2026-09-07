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
// a QUARTER of the world's own step: 0.10 / 4 = 25 mm exactly.
//
// IT USED TO BE A THIRD, AND THE ARITHMETIC THAT MOVED IT IS ONE LINE. The step
// was read as 6 px in the reference and the cell it was read against was worked
// out from a figure assumed 1.80 m tall; on the framing this world is judged at,
// with the figure at the height the plane itself measures (1.50 m), a metre at
// his distance spans 241.9 px — so 6 px is 24.8 mm, and 0.10/4 is the subdivision
// that lands on it. At the old third it would draw 8.1 px, which is a third too
// coarse on the one number the pictures state about his surface. Sixty cells of
// 25 mm is 1.50 m exactly, and both grids close on integers again: 15 world cells.
//
// THE FIGURE IS THE SAME FIGURE, RE-LAID. Nothing below was read a second time.
// Every number in figure() and in the two tables is still the reading taken on
// the 54-cell lattice the two pictures were resampled onto (v8-avatar/dev-b/
// mappa.mjs), and box() carries it onto this one by scaling the PLANES between
// cells — not the indices — by CELLS / READ_CELLS. Scaling planes is what keeps
// the spine a plane and the mirror exact: a boundary at x = p goes to round(p S),
// and p S is never a half for S = 10/9, so round is exactly odd-symmetric about
// the spine and the two halves of him cannot come apart. What it costs is up to
// one cell of extent, 25 mm, on any one edge; what it would cost to re-read the
// pictures instead is a second, differently-noisy copy of the same measurement.
//
//   x   his RIGHT is positive. The spine is the PLANE x = 0, so the mirror is
//       i -> -1 - i and both halves of him are the same cells. A part that
//       straddles the spine therefore has an EVEN width; a limb has any width
//       and comes as a pair. Putting the spine on a boundary rather than
//       through the middle of a cell is what makes the two halves identical
//       instead of half a cell apart.
//   y   0 is the ground his soles stand on and 59 is the cell his crown is the
//       top of. Sixty cells, which is 1.50 m exactly: that is what the height
//       the committente decided (E-DECISIONI21 D8) MEANS on this lattice.
//   z   negative is in FRONT of him — the frame src/core/player.js walks in has
//       forward at (-sin, -cos), so at yaw nought forward is -Z. The pack is
//       therefore at positive z, and everything the two pictures show best is
//       on that side.
//
// ---------------------------------------------------------- where it comes from
//
// EVERY ROW IS READ OFF THE TWO PICTURES ON THE FIGURE'S OWN GRID, and the
// reading is in v8-avatar/dev-b/ (mappa.mjs resamples each target onto the
// 54-row lattice; mappa.txt and the two PNGs are what was looked at). The crown
// and sole rows are the analysis unit's, measured with the campaign's tint rule:
// 575 and 934 by day, 535 and 896 by night. On the framing the campaign is now
// judged at those two rows are 359 px apart, so one of THESE cells is 6.05 px,
// which is the 6 the pictures read on the pack.
//
// WHAT IS MEASURED AND WHAT IS NOT, SAID PLAINLY. The pictures are of his BACK.
// So every height, every width, the pack and its pockets and the boots are read;
// the DEPTHS are not, and neither is his face. Depths here are the smallest
// numbers that stand a body up at the widths that were measured, and they are
// marked. The face is built because a head must have one, and it belongs
// entirely to the right hand column of the chapter's own table.
//
// THE FIGURE IS STYLISED AND THE MEASUREMENTS SAY SO. His head is eight cells
// across — 0.20 m, where a man's is 0.16 — and his arms take him to twenty four
// cells at the cuff and twenty at the shoulder. That is not an error to be
// corrected towards anatomy: it is what the two pictures draw, and drawing
// something else would be building a different character.
//
// THE OUTLINE IS NOT A WALL, AND THAT COST A CORRECTION. It was first built as
// one, ten cells off the spine from the cuff to the shoulder, on a reading of two
// bands rather than of the whole side. The full profile — every row of both
// pictures, in v8-avatar/dev-c/profilo.mjs — steps IN going up, and the arms
// below are written as the staircase it found.

/** The figure's own step, as a fraction of the world's. Exact. */
export const SUBDIVISION = 4;

/** How many cells tall he is. 60 x (0.10/4) = 1.50 m. */
export const CELLS = 60;

/**
 * The lattice the two pictures were READ on, which is not the one he is built
 * on any more.
 *
 * It is kept as a number rather than folded into the boxes because it is the
 * unit every measurement below is quoted in: the comments say "row 42" and mean
 * row 42 of 54, and they will still mean it after the next time the height
 * moves. LATTICE is the only place the two lattices meet.
 */
export const READ_CELLS = 54;

/** From the reading's lattice to the built one. 60 / 54 = 10 / 9, exactly. */
export const LATTICE = CELLS / READ_CELLS;

// A BOUNDARY, NOT AN INDEX. Cell p sits between the planes p and p + 1, so what
// carries across a change of lattice is the PLANE. Rounding indices instead
// would move a box's near edge and its far edge by different amounts and hand
// back a body whose parts no longer touch.
const plane = (p) => Math.round(p * LATTICE);

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
// AND EACH ONE CARRIES ITS OWN GRAIN, which is the machinery R8 asked for — but
// NOT the numbers R8 expected, and the difference is the whole of this note.
//
// R8 was raised on readings that said the jacket varied 5.05 times the reference
// and the hair 0.27, with the mean across the garments at 0.96 hiding both. Two
// of those windows are not on the garment they name: the 'giacca' window of
// v8-avatar/dev-b/finestre-dati.mjs (day 718..728 x 692..748) falls on cells 7.3
// to 8.9 of his flank, which is the PACK'S SIDE POCKET in both pictures. Read
// again on panels this file projects itself — one flat face of one garment, a
// cell in from its own edges — the sign turns over: the page varies LESS than the
// reference nearly everywhere (day: pack 0.74, pocket 0.77, jeans 0.94, hair
// 0.38, boots 0.38), never five times more.
//
// AND THEN THE READING THAT DECIDES WHAT TO DO ABOUT IT. Per-voxel tint is drawn
// from a hash, so neighbouring cells are INDEPENDENT and their correlation is
// zero by construction. The reference's panels are correlated on every garment
// and in both pictures — +0.31 to +0.99 by day, +0.13 to +0.79 by night — while
// the page's sit at +0.09 to +0.35. So the variation the reference carries is
// STRUCTURE running across cells (straps, seams, the steps in his hair, the light
// falling down a sleeve) and the page's is independent speckle. Two panels can
// share a deviation and be different things, and this is the pair of numbers that
// tells them apart. It is also what the judge's eye said from the other side,
// calling the page dirtier than the reference while the deviation said it varied
// less: both were right.
//
// SO THE GRAINS BELOW AIM ONLY AT THE UNCORRELATED PART of what the reference
// shows — the part per-voxel tint is entitled to answer — and the rest is named
// and left to the geometry that owns it. Matching the full deviation would mean
// pouring speckle in where the reference has a strap, which is making noise stand
// for shape.
//
// `grain` is the multiplier ON the recipe's 1.30 for that garment. The two
// pictures are quoted at each entry and the day is the one that carries a
// disagreement, because the page's night is far brighter than the reference's
// (jeans mean 13.1 against 5.9) and a deviation over a mean cannot be compared
// between pictures that disagree about the mean — that mismatch is the air, and
// it belongs to R3 at docket D5, not here.
//
// THE CEILING IS ARITHMETIC AND NOT TASTE: at an amplitude of two, 1 + T(h - 0.5)
// takes a cell to albedo nought, which is a hole. Both pictures ask the hair for
// 2.2 and it is held at 1.50; the shortfall is declared, and it is the stepped
// hair the two pictures draw and this plan does not (dev-b's R4).
export const PALETTE = [
  // 0 — the jacket. The largest area on him, and the one the whole figure's
  //     reading rests on: 16,30,33 against the reference's 16,30,34.
  { id: 'giacca', albedo: [0.2147, 0.1985, 0.1392], grain: 1.00 },  // non spostata: nessun pannello pulito
  // 1 — the pack. What separates it from the jacket in the pictures is not that
  //     it is darker — it is barely darker — but that the blue is out of it.
  { id: 'zaino', albedo: [0.3114, 0.1503, 0.0560], grain: 0.90 },   // giorno 1.21, notte 1.22 a 1.05: i due concordano, e questo li centra
  // 2 — the pack's outer pocket, a shade under the body of it, which is what
  //     draws the seam between them without a line being drawn.
  { id: 'tasca', albedo: [0.2658, 0.1345, 0.0579], grain: 1.15 },   // giorno 1.18, notte 0.86: la media geometrica e' 1.01
  // 3 — the small dark label on that pocket, and the finest thing on the figure:
  //     four cells, seventy two pixels in the frame, and it is READ (6,10,11
  //     against 7,13,11) rather than assumed.
  { id: 'etichetta', albedo: [0.1643, 0.0938, 0.0032], grain: 1.00 }, // quattro celle: non misurabile
  // 4 — the jeans. The darkest and bluest thing he wears.
  { id: 'jeans', albedo: [0.1232, 0.0859, 0.0536], grain: 0.70 },   // giorno 1.01 su 40 celle, il pannello piu' pulito che la figura offra
  // 5 — the hair. Brown, and one of the two warm things on him.
  { id: 'capelli', albedo: [0.2455, 0.0963, 0.0146], grain: 1.50 }, // AL TETTO: i due target ne vogliono 2.2 e restano a 0.64/0.65. Il resto e' forma
  // 6 — the boots. The other warm thing, and the one the night lights from below
  //     in the reference — which V7 has not delivered, so tonight they are lit
  //     from above like everything else and that is declared, not simulated.
  { id: 'scarpe', albedo: [0.2290, 0.0969, 0.0044], grain: 1.45 },  // giorno 1.00, notte 0.74; solo 8 celle, e si dichiara
  // 7 — skin: the hands, the back of the neck, and the face nobody sees. Held at
  //     the ceiling; see above.
  { id: 'pelle', albedo: [1.0000, 0.3813, 0.0372], grain: 1.00 },   // mani e nuca: finestra troppo piccola
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
  x0: plane(x[0]), x1: plane(x[1] + 1) - 1,
  y0: plane(y[0]), y1: plane(y[1] + 1) - 1,
  z0: plane(z[0]), z1: plane(z[1] + 1) - 1,
  solid: opts.solid !== false,
});

/**
 * The same box on the other side of the spine: i -> -1 - i.
 *
 * IT RUNS AFTER box() AND THEREFORE AFTER THE SCALE, which is the order that
 * makes the two halves identical rather than nearly so: the scale is applied
 * once, to one side, and the other side is its exact reflection whatever the
 * rounding did.
 */
const mirrored = (b) => ({ ...b, x0: -1 - b.x1, x1: -1 - b.x0 });

const pair = (id, x, y, z, opts) => {
  const right = box(id, x, y, z, opts);
  return [mirrored(right), right];
};

// ---------------------------------------------------------------- TWO BODIES
//
// The two pictures show ONE figure and the chapter's own table puts the female
// body entirely in the right hand column: nothing measures her. So she is not
// measured here either — she is DERIVED, by a rule written down below, from the
// male profile that is, and every cell that differs is named with why.
//
// ONE CONSTRUCTION AND TWO TABLES, rather than two lists. A second list copied
// and edited drifts the first time either is touched, and the drift is exactly
// the kind nobody sees: a strap that moved on one body and not the other. So the
// boxes are written ONCE, in `figure()`, and what a body IS is a handful of
// numbers. Reading the two tables side by side IS the specification of the
// difference, and no third reader has to be trusted to keep them in step.
export function figure(d) {
  return [
    // --------------------------------------------------------------- the legs
    // Rows 33 to 49 of the pictures are two columns of navy with the paving
    // between them: six cells of leg either side of a two cell gap. Read on the
    // day picture at 3x, the left leg spans 6.3 cells and the right 6.5, with 1.0
    // between — a gap of one cell cannot be symmetric about the spine, so it is
    // two, and the half cell that buys goes into the legs. Above row 33 the
    // jacket covers them, so where they actually JOIN is in neither picture: the
    // seat below is what closes them, and its height is the one the jacket hides.
    ...pair('jeans', [1, d.leg], [4, 23], [-3, 2]),
    box('jeans', [-1 - d.hip, d.hip], [18, 24], [-3, 2]),

    // -------------------------------------------------------------- the boots
    // Five cells tall — their top edge reads at cell 48.9 — wider than the leg
    // and longer forward than back. The night picture is the one that says where
    // they stop: by day leather and stone are the same tint and the frame ends at
    // 940 before the sole does.
    ...pair('scarpe', [1, d.leg], [0, 4], [-6, 2]),

    // ------------------------------------------------------------- the jacket
    // The hem is at cell 32, level with the middle of his hands. Twelve cells
    // across the body and fourteen at the shoulder, which is the widest the
    // pictures put him before the arms start (12.8 read at the shoulder line).
    //
    // ONE BLOCK ON HIM, TWO ON THE TABLE. The male jacket is a single box from 21
    // to 43 because the pictures give it one width; it is written as a hem block
    // and a chest block so that a body whose waist differs from her hip can be
    // stated in the table instead of in a second list. On him the two carry the
    // same number and the mesher fuses them back into one surface — proved, not
    // assumed: v8-avatar/dev-c/conti-due.txt counts the same 154 quads either way.
    //
    // THE SHOULDER BLOCK STOPS AT 42 AND NOT AT 43. Above it the reference's
    // outline is down to 5.1 cells off the spine (day row 43) and 5.5 (night row
    // 42), where fourteen across would keep it at seven: that top row is the base
    // of his neck and the folded hood, not a shoulder. Left at 43 it drew a square
    // corner two cells outside the picture's.
    box('giacca', [-1 - d.chest, d.chest], [21, 28], [-4, 3]),
    box('giacca', [-1 - d.waist, d.waist], [29, 43], [-4, 3]),
    box('giacca', [-1 - d.shoulder, d.shoulder], [38, 42], [-4, 3]),

    // --------------------------------------------------------------- the arms
    //
    // THEY TAPER, AND THAT IS THE CORRECTION R1 ASKED FOR — MEASURED, NOT GUESSED.
    // They used to be one block three cells thick from 25 to 42, so the figure's
    // outline was a flat wall at ten cells off the spine over eighteen rows. The
    // width profile of both pictures (v8-avatar/dev-c/profilo.mjs, and the columns
    // read out one by one in sonda-riga.mjs) says the reference is not a wall: it
    // steps IN going up, four plateaus with the transition rows unreadable between
    // them, which is the signature of a staircase and not of noise.
    //
    //   rows 24..27   11.14 cells off the spine      here 11  (7..10)
    //   rows 29..31   10.36                          here 10  (7..9)
    //   rows 33..35    9.43                          here  9  (7..8)
    //   rows 38..40    8.64                          here  9  (7..8)
    //
    // Those are the day picture's, with the registration below taken off. The night
    // picture reads 9.21 at rows 33..34 against the day's 9.43 and 5.54 at row 42
    // against the day's 5.13 at 43: the two agree on the taper to a quarter cell.
    // Worst residual 0.43 of a cell, against 1.36 for the wall it replaces, and the
    // shoulder line — where R1 was raised — comes in by 1.27 cells a side.
    //
    // THE REGISTRATION, DECLARED. The reference's figure sits 0.21 of a cell (7 mm)
    // right of where the fit puts this spine by day and 1.11 (37 mm) by night, both
    // measured on the LEGS, where the plan is symmetric by construction and its
    // width already agrees to a quarter cell. It is inside the fit's own stated
    // uncertainty and it is taken off every edge above; nothing here is moved
    // sideways to chase it.
    //
    // Four cells at the cuff and two at the shoulder is not an arm's anatomy, and
    // it is not meant to be: it is the outline the two pictures draw, on a figure
    // whose head is already nine cells across.
    ...pair('giacca', [d.arm, d.arm + 3], [25, 28], [-3, 2]),
    ...pair('giacca', [d.arm, d.arm + 2], [29, 32], [-3, 2]),
    ...pair('giacca', [d.arm, d.arm + 1], [33, 42], [-3, 2]),
    // The armpit, which nothing outside can see and every arm needs: the one
    // column between the torso's edge and the sleeve's, and without it rows 25,
    // 36 and 37 had a slot through the figure that you could look at the meadow
    // through. It was there before the taper and the taper did not make it;
    // filling it moves no silhouette, because it is inside the outer edge on
    // every row the arm has.
    ...pair('giacca', [d.arm - 1, d.arm - 1], [25, 42], [-3, 2]),
    ...pair('pelle', [d.arm, d.arm + 2], [21, 24], [-3, 2]),

    // ------------------------------------------------------- the neck and head
    // Nine cells of head over two of neck, and the hair reads seven to eight of
    // the nine. The head is a solid of HAIR with the face laid into the front of
    // it, because from behind that is what it is: the two pictures show the back
    // and the sides with irregular steps in them, and nothing of the face at all.
    //
    // THE HEAD IS THE SAME ON BOTH BODIES, and that is a finding and not a shrug.
    // See the female table below: with the pack on, nothing below the shoulder
    // line is visible from the view both pictures are taken from, so every way of
    // making her hair LONGER draws something the judged frame cannot see. What
    // would show is a different head, and a head is the most identity-bearing
    // thing on a figure — the committente's, not this seat's.
    box('pelle', [-2, 1], [43, 45], [-2, 1]),
    box('capelli', [-4, 3], [45, 53], [-4, 3]),
    box('pelle', [-3, 2], [46, 51], [-5, -4]),

    // -------------------------------------------------------------- the hood
    // Folded down on the shoulders, behind the neck: the raised mass the day
    // picture shows between the collar and the top of the pack, at cells 8 to 11.
    box('giacca', [-1 - d.hood, d.hood], [42, 45], [2, 5]),

    // --------------------------------------------------------------- the pack
    // THE FINEST DETAIL ON HIM, and the reason the cells are a third of the
    // world's rather than the same. Body, lid, one wide outer pocket with a small
    // dark label on it, a side pocket standing proud on each flank, and the two
    // straps over the shoulders.
    //
    // THE SIDE POCKETS STAND INSIDE THE SLEEVE'S EDGE, NOT ON IT. They used to be
    // written at the arm's own columns on the argument that being five cells
    // nearer the camera made them project just proud of it. The argument is sound
    // and the columns were wrong: reading the row out
    // (v8-avatar/dev-c/sonda-riga.mjs giorno 26 and 30) the pack's own neutral
    // tint stops at 9.0 cells off the spine on row 26 and 8.3 on row 30, and
    // BEYOND it, out to 10.9 and 10.3, the picture goes back to the jacket's navy
    // — the sleeve, showing past the pocket. At the arm's columns the pocket
    // covered the sleeve entirely and that strip of navy could not exist. Three
    // per cent of ten cells is a third of a cell, which is what standing proud is
    // worth here; a whole cell of it was the error.
    //
    // AND THE LID STANDS PROUD OF THE BODY, which is the other half of R2 and the
    // half the junction term needed. Both boxes used to end at z 8, so the pack
    // was one slab with a taller top: there was no STEP anywhere on it, and the
    // shadow the day reference draws under the lid — eleven pixels, a cell and
    // two thirds, at a quarter of the luminance of the face above
    // (v8-avatar/dev-c/stacco.mjs, and the raw column in sonda-colonna.mjs) — had
    // nothing to be cast by. The junction term in material.js was measured inert
    // against exactly this and it was right to be: it only darkens what a solid
    // actually hangs over, and nothing hung over anything.
    //
    // So the BODY loses a cell of depth rather than the lid gaining one, and the
    // reason is the lid's own top face. That face is the only horizontal face of
    // the pack the camera can see, its height in pixels is its depth times the
    // sine of the depression, and the reference reads it at 5 px. Behind the
    // folded hood at z 2..5 the exposed part is z 6 upwards: ending the lid at 8
    // makes it three cells, 6 px, which is the reading plus one. Ending the BODY
    // at 8 and the lid at 9 instead would have made it four cells and 8 px, and
    // bought the same step at twice the error on the one number that measures it.
    box('zaino', [-1 - d.pack, d.pack], [24, 42], [3, 7]),
    box('zaino', [-1 - d.pack, d.pack], [39, 43], [2, 8]),
    box('tasca', [-1 - d.pocket, d.pocket], [27, 36], [8, 9]),
    box('etichetta', [-1, 0], [33, 34], [9, 9]),
    ...pair('zaino', [d.pack + 1, d.pack + 3], [26, 35], [3, 7]),
    // and the side pockets keep the body's own depth, so they read as pockets ON
    // it rather than as a second slab beside it.
    ...pair('zaino', [2, 3], [42, 44], [-5, 3]),
  ];
}

// THE MALE TABLE: every number in it is read off the two pictures, and where it
// came from is written against the boxes above.
export const DIM_M = {
  leg: 6,       // the leg's outer cell — 6.3 and 6.5 read, a two cell gap between
  hip: 6,       // the seat, which closes the legs where the jacket hides the join
  chest: 5,     // the jacket at and below the hem
  waist: 5,     // and above it: one width on him, two rows in the table so she can differ
  shoulder: 6,  // the shoulder block, fourteen across
  arm: 7,       // the sleeve's inner cell; the three plateaus run out from here
  hood: 4,      // the folded hood on the shoulders
  pack: 5,      // the pack's own outer cell
  pocket: 3,    // its front pocket
};

// THE FEMALE TABLE, AND EVERY LINE OF IT IS A DECLARED CHOICE.
//
// WHAT DECIDES IT AND WHAT DOES NOT. Nothing in either picture shows her, so
// nothing here is measured — what is inherited is the METHOD and the MATTER: the
// same lattice, the same 60 cells, the same eight pigments, the same grain per
// garment, the same construction above, the same one draw. What differs is a
// handful of cells, and the rule is stated once: FOUR MOVES OF ONE CELL A SIDE,
// no more, taken off the male profile the pictures gave.
//
//   shoulder  -1   fourteen cells across becomes twelve
//   arm       -1   the whole taper moves in with the shoulder it hangs from
//   waist     -1   twelve across becomes ten, above the hem
//   hip       +1   fourteen across becomes sixteen, at the seat
//
// and the hood, the pack and its pocket follow the shoulder they sit on, because
// a pack left at the male width would hang out over her arms.
//
// WHY ONE CELL AND NOT A RATIO. A cell is 25 mm and reads 6.05 px at the fitted
// framing; on a figure 360 px tall, two cells of shoulder is 12 px, which is
// visible. (The moves are stated on the reading's lattice, so they are one of
// ITS cells and land as one or two of these.) Half a cell does not exist on this lattice, and a ratio would land
// between cells and be rounded to exactly this — so the rounding is done in the
// open, as whole cells, rather than hidden inside a multiplication.
//
// HER HEIGHT IS HIS, and that is deliberate. H = 1.50 m is the committente's own
// answer (E-DECISIONI21 D8, «1,50 in terza e 1,70 in prima») and it is what the
// reference plane measures: the third person rule is written in units of H, and
// the framing is checked against a crown at row 59. A second height would fork
// the camera rule and every crown check in the chapter. If the committente wants
// her shorter it is one number here and a re-run of the rig — but it is not a
// thing to settle in this seat.
//
// WHAT IS NOT DECIDED HERE, and has gone up as a question with options: her hair,
// and whether she wears these clothes at all. Both are taste, both are named in
// the mandate as taste, and neither is guessed at. The wardrobe below is HIS,
// unchanged, which is the one choice that adds nothing of this seat's own.
export const DIM_F = {
  leg: 6,       // hers are his: nothing about the leg follows from the four moves
  hip: 7,       // +1 a side
  chest: 5,     // his, at the hem
  waist: 4,     // -1 a side, above the hem
  shoulder: 5,  // -1 a side
  arm: 6,       // -1 a side, and the taper with it
  hood: 3,      // follows the shoulder
  pack: 4,      // follows the shoulder
  pocket: 2,    // follows the pack
};

export const BODY_M = figure(DIM_M);
export const BODY_F = figure(DIM_F);

/** The two of them, under the names the personalisation calls them by. */
export const BODIES = { m: BODY_M, f: BODY_F };

/**
 * The male body, which is what every tool older than the second one reads. Kept
 * as a name rather than renamed everywhere: the measuring tools in v8-avatar/
 * import it, and the one they mean is his.
 */
export const BODY = BODY_M;


/**
 * Which palette entry a cell belongs to, or -1 for empty.
 *
 * THE ONE ANSWER, and both readers ask it: the mesher fills the lattice with it
 * and the material's fragment is generated from the same list in the same order.
 */
export function paletteAt(i, j, k, body = BODY_M) {
  let found = -1;
  for (const b of body) {
    if (i < b.x0 || i > b.x1 || j < b.y0 || j > b.y1 || k < b.z0 || k > b.z1) continue;
    found = b.palette;
  }
  return found;
}

/** The lattice the body needs, as whole cells, with nothing to spare. */
export function bounds(body = BODY_M) {
  const b = {
    x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity,
  };
  for (const part of body) {
    b.x0 = Math.min(b.x0, part.x0); b.x1 = Math.max(b.x1, part.x1);
    b.y0 = Math.min(b.y0, part.y0); b.y1 = Math.max(b.y1, part.y1);
    b.z0 = Math.min(b.z0, part.z0); b.z1 = Math.max(b.z1, part.z1);
  }
  return b;
}
