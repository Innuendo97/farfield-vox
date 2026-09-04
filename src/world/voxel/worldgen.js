import { AREA_CENTER, MONOLITHS, PLATFORM, STAIRS } from '../layout.js';
import {
  BASE_LEVEL, pathCentreX, pathCoord, pathEdge, pathHalfWidth, pathRun,
} from '../terrain-field.js';
import {
  MATERIAL, NO_COLUMN, VOXEL, clearColumn, createColumns, setFlank, setTop,
} from './columns.js';
// The plan and not the meshes: where the boulders stand is a number in a file,
// and rocks.js -- which is where they become geometry -- reaches three.js. The
// import attribute is what lets the same line be read by node and by the
// bundler, which is the property this whole half of the engine rests on.
import ROCK_PLAN from '../../../assets-src/rocks/rocks.json' with { type: 'json' };

// HOW THE GROUND IS BUILT, IN AN ORDER THAT IS DECLARED.
//
// The world is a store of blocks now (./columns.js) and this is what fills it.
// Everything is a WRITE, in a stated sequence, each pass laying over the one
// before it -- which is how every engine that generates a voxel world does it,
// and it is the thing a field of summed terms cannot be:
//
//   1. THE BASE      one literal. Every column of the disc at the same height,
//                    grass on top. Not a noise, not an octave, not a fit.
//   2. THE SEATS     where this engine lays no column at all, and WHY: the rim
//                    of the disc, the footprints of the built stone, and the
//                    corridor -- whose hole is marked as the corridor's rather
//                    than as nothing, because the mesher draws the ground
//                    beside the two differently.
//   3. THE MASSES    the mounds of the meadow, PLACED on a lattice and raised
//                    into the store: a flat crown of grass and one cut bank of
//                    bare earth. The same arithmetic that was approved as a
//                    field, doing the same thing as an edit.
//   4. THE GRAIN     the sods: plates of five to twelve cubes standing one voxel
//                    over the floor, on a lattice of their own.
//
// AND THE ORDER IS THE MEANING. The grain comes last and stops at the hem of a
// mass, so a bank stays ONE riser instead of a saw; the seats come before the
// masses, so a mound cannot grow out of a hole; the base comes first, so there
// is exactly one place in this world that says how high the ground is.

/** Where the disc is centred. */
export const CENTRE = { x: AREA_CENTER.x, z: AREA_CENTER.z };

// How far the ten centimetre ground reaches, in metres from the walkable
// centre -- THE DEFAULT, and no longer the only answer there is.
//
// It was a frozen literal of fourteen, and fourteen was never a decision about
// the world: it was the radius the first bench could lay while the fusion
// figure was being argued, and every figure of the campaign was then measured
// against it. E-V1a settled the shape -- thirty five metres by default, GOVERNED
// by quality.voxelDiscRadius, and the per tier values measured rather than
// guessed -- and E-V1d authorised the rewiring here.
//
// WHAT THAT MAKES THIS NUMBER, AND WHAT IT DOES NOT. It is the default the
// engine answers with when nobody says otherwise, so a guard, an offline tool
// and a page that asks for nothing all lay the same disc. It is NOT a second
// opinion beside the tier: everything that ships takes the radius from the tier
// and hands it in, and the one place a radius may be written down is
// src/core/quality.js. A radius hardcoded anywhere else is the defect this
// constant existed to prevent, moved rather than cured.
//
// AND IT IS A PARAMETER AND NOT A SETTING. It arrives as an argument, so the
// generator stays a pure function of the column and its radius: two callers
// asking for two different discs in the same process get two right answers, and
// no tool can read a number the page was not laid at.
export const DISC_RADIUS = 35;

/**
 * The height every column of the plane starts at, in whole voxels.
 *
 * IT IS BASE_LEVEL AND NOT A SECOND LITERAL, read from the one file that is
 * allowed to say how high the walkable ground is. The derivation is there: the
 * reference puts the surface of the meadow at y = 0, the mesher draws the top
 * face of a column at (top + 1) * VOXEL, so the step whose drawn face lands
 * exactly on nought is one below it. A number typed here would be that
 * derivation copied, and a copy is what goes stale.
 */
export const BASE_STEP = Math.round(BASE_LEVEL / VOXEL);

// Value noise and its hash, which every lattice in this file draws its seats
// from. Hashed rather than tabulated so a seat is defined everywhere, identical
// wherever it is evaluated, and reproducible by a second implementation.

function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

// ======================================================================
// THE MEADOW IS A FLOOR WITH MOUNDS PUT ON IT, and that is the committente's
// own reading of the target rather than a taste taken here (E-DECISIONI4):
//
//   «UN CAMPO PIANEGGIANTE DI BASE con voxel d'erba e fiori qua e la'» and
//   «PICCOLE E MEDIE ALTURE SPARSE ... composizioni, cumuli ben orchestrati
//   che risultano veri e belli», against what stood here before it, which he
//   named too: «voxel ingiustificati come se ognuno dovesse avere per forza
//   una differenza di altezza con quelli accanto».
//
// THE FLOOR IS NOW A LITERAL AND THE MASSES ARE NOW EDITS, and that is the only
// thing this pass lost in the move. The shape is the one E-V1k built and E-V1l
// promoted, number for number: a lattice with one seat to a cell, a flat crown,
// one cut bank toward the eye or the corridor, single terraces behind it.
//
// AND THE LATTICE IS WHAT MAKES «MAI DUE ATTACCATI» A PROPERTY AND NOT A HOPE.
// A seat's whole reach is bounded to stay inside its own cell -- the jitter it
// is allowed is the cell's half minus the largest reach it can draw -- so a
// point belongs to at most ONE seat, finding it is a single cell lookup rather
// than a search over nine, and two masses can never meet.

/**
 * The mounds, and the bank against the stone: every number the shape has.
 *
 * THE THREE THE COMMITTENTE WAS ASKED ABOUT LIVE HERE AS DATA, which is the
 * whole reason this object has the fields it has. His word on any of the three
 * is a number in this object and not a change of mechanism:
 *
 *   D-F1  how many mounds there are           `density`
 *   D-F2  which flanks show bare earth        `EARTH` below
 *   D-F3  how tall they are in the open       `height`, and `bank` at the stone
 */
export const MOUND = {
  // THE LATTICE A SEAT MAY STAND IN, AND IT IS SET BY THE SPACING THE REFERENCE
  // IS READ AT AND NOT BY A COUNT. A 1.2 and E-V1h both read the target's
  // masses as standing THREE TO SIX METRES apart, never two touching. Measured
  // over the meadow the fitted camera actually looks at, the nearest neighbour
  // of every mass in frame:
  //
  //   cell 4.5 m   p10 3.76   p50 4.50   p90 7.72   -- p90 1.72 m outside
  //   cell 4.0 m   p10 1.99   p50 3.80   p90 4.73
  //   cell 3.8 m   p10 2.47   p50 3.75   p90 5.48
  //   cell 3.6 m   p10 2.86   p50 3.46   p90 5.36
  //
  // AND THE SECOND BAND DECIDES BETWEEN THE LAST THREE. The level runs of the
  // meadow are read at five to twelve cubes and that band is GATED
  // (guard-piano); a mass carries a flat crown, so more masses is more long
  // run, and at 3.6 the ninetieth run leaves the band at thirteen. At 3.8 it
  // stands at twelve, the nearest neighbour keeps its p90 inside three to six,
  // and the meadow carries one mass to every thirty one square metres --
  // E-V1h's own near field reading is seven masses in about two hundred.
  //
  // The share of cells that carry a mass at all is a SEPARATE dial and is the
  // committente's own answer (E-DECISIONI7 A5): it is not touched here.
  cell: 3.8,
  // How many of those cells carry a mass at all. D-F1, and E-DECISIONI7 A5
  // confirmed the measured value on a plane that is now really a plane.
  density: 0.62,
  // How far one mass reaches, in metres, before the lean below is applied.
  //
  // THE SMALL END IS THE COMMITTENTE'S OWN WORD AND WAS MISSING. E-DECISIONI4
  // asks for «piccole e medie alture sparse»; at a low reach of 0.80 the
  // narrowest mass this lattice can seat is 1.95 m across and there are no
  // small ones at all -- measured in frame, the sizes ran 2.00 to 2.90 m
  // against the 1.5 to 3.5 the reference is read at. At 0.60 the band is
  // 1.46 to 3.54 m, which is that reading, and a small mass fits beside the
  // corridor where a medium one has to be kept away from it.
  reach: { low: 0.60, high: 1.45 },
  // HOW FAR FROM ROUND IT IS ALLOWED TO BE, and it is not a decoration: a
  // circle is the one shape a meadow never draws, and a field of circles reads
  // as a field of circles at the first glance from any pose. The mass is
  // stretched along its own bearing and squeezed across it, which costs one
  // rotation and keeps the area it covers the same.
  lean: 0.22,
  // How much of the reach is flat top. The target's masses have a CROWN --
  // «cima piatta o a due terrazze» -- and a cone has none. E-DECISIONI7 A7.
  plateau: 0.40,
  // HOW DEEP THE STRAIGHT CUT IS TAKEN INTO THE MASS, as a share of its reach,
  // and it is what makes the cut flank ONE FLANK instead of a picket.
  //
  // THE PICKET WAS MEASURED AND IT WAS THE SHAPE'S OWN FAULT. A mesher merges a
  // wall into one rectangle only where the top, the floor and the family run on
  // together; round the rim of an elliptical mass the top changes every column
  // or two, so twenty masses in frame drew 368 separate cuts of a MEDIAN OF ONE
  // COLUMN -- the «stecche» E-V1j named, back under another cause. The
  // reference draws the opposite: «un fianco solo che scende in un gradino di
  // 2-3 voxel in una volta», five to fifteen columns long (A §1.2).
  //
  // So the side that faces the eye is not the shape's curve, it is a STRAIGHT
  // CHORD: the southern cap of the footprint is taken off at a line of constant
  // z, and along that line the whole flank stands at one height over one floor.
  // A tenth of the reach puts the chord where the ellipse is 0.9 to 1.6 metres
  // wide -- nine to sixteen columns -- which is the reference's own reading,
  // and it costs the mass a twentieth of its area.
  cut: 0.10,
  // HOW MUCH OF A MASS'S OWN RIM TURNS THE FULL BANK, as a share of its
  // perimeter, and it is the dial that says how much bare earth the meadow
  // shows without saying anything new about its shape.
  bankArc: 0.70,
  // HOW WIDE A HEM ROUND A MASS THE GRAIN STOPS IN, in metres, and it is the
  // walker's number rather than a look. The grain belongs to the FLOOR, a mass
  // is set down on the floor, and letting the one run over the other turns a
  // clean bank into a saw and a 0.30 m step into a 0.50 m one.
  halo: 0.25,
  // Whole voxels, in the open field. D-F3 = A: three to four is what the fork
  // read in the foreground.
  height: { low: 2, high: 4 },
  // HOW TALL THE ONE RISER OF THE STEEP FLANK IS, in whole voxels, and it is
  // the number that makes a mound an OBJECT rather than a patch of the floor's
  // own noise. TWO OR THREE, ONE OR THE OTHER FOR A WHOLE MASS, which is what
  // A 1.2 reads: «un fianco solo che scende in un gradino di 2-3 voxel in una
  // volta». Never a mix inside one mass -- a bank that changed height along
  // itself would be two banks, and the eye counts objects.
  //
  // THREE IS ADMISSIBLE ONLY BECAUSE THE GROUND IS A PLANE NOW. E-V1k measured
  // a bank of three at 0.40 m of worst edge and settled on two; that reading
  // was taken on the rolling field, where a mass stood ON relief and the two
  // added. On the plane a bank of three is 0.30 m of column against column,
  // which is exactly TUNING.ground.maxM in src/core/presence.js, and the grain
  // is held off the hem round a mass so nothing can add to it. Re-measured
  // here: worst step 0.30 m, no edge over it.
  scarp: { low: 2, high: 3 },
  // HOW THE CROWN IS FINISHED. Nought is a flat top, which is how the target
  // reads under the compass and is the default; one puts a second terrace a
  // voxel below it over the outer half of the crown.
  crownStep: 0,
  // ------------------------------------------------- and against the stone
  // How far out from a block or a boulder the bank reaches, in metres.
  band: 1.15,
  // HOW TALL THE MEADOW STANDS WHERE IT MEETS THE STONE, AND IT IS NOUGHT.
  //
  // THE READING IT REPLACES WAS TAKEN ON A WORLD THAT WAS NOT FLAT. E-V4d read
  // three to six voxels of meadow piled against the stone off the targets, and
  // E-V1k built it; on the rolling field of the day the piles sat on top of the
  // relief and nobody could see which of the two was doing the lifting. With
  // the ground a plane the term stands alone and it is measurable, and the
  // measurement refutes it: projected through the fitted camera, on all four
  // blocks that stand in grass the target's turf meets the foot ON the y = 0
  // line and not one of the four stands on a rise. Kept at six, the same four
  // feet stood 0.60 m proud of a meadow that is otherwise flat -- the single
  // largest excursion left in the world after the plane, and the one the
  // reference contradicts most plainly.
  //
  // SO IT IS DATA AT NOUGHT AND NOT A MECHANISM DELETED. The ramp is still
  // written below and still reads these two numbers; the band still keeps the
  // mounds off the stone, which is a separate job and still wanted. His word,
  // or a later reading of a picture that shows the foot of a block without
  // ambiguity, is a number in this object.
  bank: { low: 0, high: 0 },
};

/**
 * THE MASSES THE REFERENCE PUTS IN FRAME, AS A DATUM READ OFF IT.
 *
 * WHY A TABLE AND NOT A DIAL. Five steps of this rebuilding put the meadow's
 * masses on a lattice, and a lattice is the right law for ground nobody has
 * looked at: it gives a spacing, a size band and a density that are all
 * measured, and it answers everywhere. What it cannot do is put a mass WHERE
 * THE PICTURE HAS ONE. Measured at step 5: in the wedge of meadow the fitted
 * camera looks at from six to nine metres, the reference carries TWO masses and
 * the lattice had TWO CELLS there -- the corridor takes one, the other rolled
 * nought -- so the part of the frame that decides carried none at all. Three
 * dials would have moved it and every one of the three would have been a single
 * picture's fit, which is the one thing this architecture exists not to do.
 *
 * So the composition IN FRAME is a datum, read off the reference, written down,
 * and stated with its provenance. The lattice stays the LAW everywhere it is
 * still the only thing there is: out of frame, and in frame wherever a cell is
 * free of these seats.
 *
 * THE PROVENANCE, WHICH IS THE WHOLE OF WHY THESE NUMBERS MAY BE HERE.
 * `fondazione/lav/sedi.mjs`, on farfield-day-voxel-target.png, through
 * POSE_VOX_DAY of src/core/poses.js -- the fit of the frame on the silhouettes
 * of the five blocks -- read against the plane y = 0, which is where A 1.1
 * measures the reference's own walkable surface and where U-FOND-1 put ours.
 * Two signals, and each is one the reference itself names:
 *
 *   THE RISER. Every step of two and a half voxels or more the resolved windows
 *   find, placed on that plane and gathered by single link at 0.75 m. This is
 *   the reading U-FOND-4 0.3 already took and reported -- it is what found the
 *   two foreground masses in the first place -- carried to the end instead of
 *   stopping at a pair of half-metre buckets.
 *   THE BANK. A patch of bare brown off the corridor, which is what A 1.2 says
 *   a mass shows: one flank that drops two or three voxels in one go, and that
 *   flank is bare brown earth. Filtered by two measurements and nothing else:
 *   1.5 m from the corridor's edge, because 83.2 % of the reference's own earth
 *   risers stand inside that (0.3) and belong to the verge; and 2.5 m from a
 *   block, because NONE of its risers stand inside that (0.3, E-FOND-PIANO2.1).
 *
 * AND IT REACHES AS FAR AS THE INSTRUMENT DOES AND NOT ONE ROW FURTHER. Both
 * signals stop where one voxel stops reading fourteen rows, which is the
 * boundary every measurement of this campaign is taken at and the one E-V1k
 * showed the painted grain wins past. That is why this table is FOUR seats and
 * not the dozen the frame holds: the rest of the reference's meadow is drawn at
 * a scale where a step and a brush stroke are the same size, and a seat put out
 * there would be a position nobody measured. Out there the lattice answers,
 * which is what a law is for.
 *
 * AND ONLY WHAT THE ESTIMATOR AGREES WITH ITSELF ABOUT IS WRITTEN DOWN. Swept
 * over its own dials -- the riser floor at 2.0 and at 2.5 voxels, the link at
 * 0.75 and at 1.0 m, the bank's smallest area and smallest width, the
 * corridor's own exclusion at 1.0 and at 1.5 m -- it returns three or four
 * seats, and THREE of them are in every run within 0.2 m of these positions.
 * The fourth is not one seat: at the default it reads at (1.77, 5.92) with
 * twelve risers behind it, at a looser link it is absorbed into the first, and
 * at a lower riser floor it is not there at all and a different one appears at
 * (-2.32, 7.09). A position the instrument moves by two metres when a dial of
 * its own moves is not a position, so it is reported and NOT carried -- and
 * what carrying it did was measured before it was dropped: seated, it merged
 * with the first mass and made one object 3.50 m across, at the very top of the
 * 1.5-3.5 m the reference reads.
 *
 * EACH ROW IS WHAT WAS MEASURED AND NOT WHAT WAS DERIVED. `zFoot` is where the
 * cut flank stands on the floor -- the eye is at z 14 and looks north, so the
 * flank it meets is the one at the largest z, and its foot is the one part of a
 * mass a picture shows without ambiguity. `rise` is how many voxels of mass
 * stand over the floor. The seat's centre, its reach and its bank are worked out
 * from those by the shape's own arithmetic, so that a re-reading of the picture
 * lands here and nowhere else.
 *
 * AND `width` IS THE BANK'S OWN WIDTH WHERE THERE IS A BANK, AND THAT CHOICE
 * WAS MADE ON A NUMBER. Two things in this reading can be called the width of a
 * mass: the patch of brown, which is the flank itself and nothing else, and the
 * span of the gathering of risers, which is at least the flank and may be more
 * -- a riser two courses back up the crown belongs to the same gathering and
 * widens it. Taken from the gathering, the first seat comes to 3.51 m across,
 * which is the very top of the 1.5-3.5 m A 1.2 reads and half again what E-V1i
 * measured the reference's typical mass at (p50 2.1 m); taken from the bank it
 * comes to 2.11 m. And the two readings are separable by a measurement neither
 * of them is: run the campaign's own riser census over the resolved band, the
 * gathering's widths put our 3+ risers at 19.6 % of the strip against the
 * reference's 3.0 %, and the banks' put them at a figure this file's own
 * verbale carries. So the bank is what is written, and the gathering is what
 * says WHERE. Where the colour signal found no bank the gathering's span is all
 * there is, and it is used, clamped.
 */
export const FRAMED = [
  // The right foreground mass: the one A-10 shows with its brown flank turned
  // to the corridor. Its bank reads 0.92 m of brown; its gathering of risers
  // spans 1.53 m.
  { x: 2.14, zFoot: 8.19, width: 0.92, rise: 4 },
  // The left foreground mass, and it stands closest of the four to the
  // corridor: 0.61 m of clear ground between its centre and the paving's
  // nominal edge. It is the one seat the rule below has to push, and the push
  // is 0.18 m -- which lands it at x -2.36, where the same estimator reads it
  // when its link is loosened to a metre. The correction and the measurement
  // agree to two centimetres.
  { x: -2.18, zFoot: 7.77, width: 0.21, rise: 3 },
  // The right field, found by its bank rather than by its risers -- the one
  // seat of the three the colour signal contributes on its own, and the one
  // whose width was never in question.
  { x: 5.08, zFoot: 5.92, width: 1.14, rise: 3 },
];

/**
 * Which faces of a mound show bare earth rather than grass.
 *
 * D-F2, AS DATA. The default is A -- what the target draws and what the fork
 * read: earth only where the ground rises MORE THAN ONE VOXEL AT ONCE, and only
 * on the flanks that face the eye or the corridor. Grass everywhere else, and
 * grass on every crown.
 */
export const EARTH = {
  // How tall a flank has to be, in voxels, before it shows what it is cut into.
  //
  // TWO, RE-MEASURED ON THE WORLD THAT SHIPS AND NOT ON THE ONE IT WAS SET ON.
  // The reading that put it here -- «two draws 9.66% of the ground against the
  // target's 9.3%, and one draws 37.4%» -- was taken on a rolling field with a
  // six voxel bank against every block, and neither of those exists any more.
  // Taken again, on the plane, with the bank at nought and the masses cut at
  // two or three: the number is no longer a dial at all. A flank shows earth
  // only where the ground is CUT (bareRaisedAt), and a cut is the outermost
  // riser of a mass, which is two or three voxels by construction -- so one and
  // two draw the same picture, measured, and what the literal does today is
  // state that a step of ONE is never a bank. That is the reading of A 1.2 and
  // it is why it stays; the share it used to govern is governed by the size and
  // the spacing of the masses now, and both are measured over MOUND above.
  minStep: 2,
  // Toward the eye, which in this world is south: the reference camera stands
  // at z 14 and looks north, so a face whose outward bearing is +z is a face
  // the picture is of. And toward the corridor, which is the other thing the
  // target shows earth against -- read off pathCoord's own sign, so the two
  // sides of the path answer opposite ways and neither is a number typed here.
  toEye: true,
  toPath: true,
  // THE VERGE OF THE CORRIDOR IS BARE GROUND: stone giving way to brown earth
  // at the level of the slabs, and not a shadow. E-V1j's answer C.
  //
  // ITS READER MOVED WITH THE THING IT DESCRIBES. It used to be the permission
  // for a rule in the mesher that painted a wall at the lip of the corridor's
  // hole; the hole died at step 4 and the rule with it, and for one delivery
  // this was a datum nobody asked. The band it describes is written by the
  // generator now -- PATH.verge columns of MATERIAL.EARTH either side of the
  // stone -- so this is read there, and answering it `false` gives the corridor
  // back its plain stone edge instead of leaving a dial that decides nothing.
  verge: true,
};

/**
 * The grain of the meadow: the sods, and every number they have.
 *
 * WHAT THIS REPLACES, AND WHY THE THING IT REPLACES COULD NOT BE MADE TO WORK.
 * The floor used to be grained by a TUFT: a value noise correlated over 0.30 m
 * -- three columns -- thresholded to plus or minus one voxel, evaluated once
 * per column. It put a step every three or four cubes in every direction, which
 * is the committente's own complaint in his own words: «voxel ingiustificati
 * come se ognuno dovesse avere per forza una differenza di altezza con quelli
 * accanto». U-V1-F2 swept it in both directions -- longer correlation, and a
 * second field gating it into patches -- and reported that NEITHER brings the
 * level runs anywhere near the target's. A noise per column cannot: what
 * decides how long a run is, is how far the noise stays on one side of its own
 * threshold, and that is the correlation length again under another name.
 *
 * SO THE GRAIN IS A FEATURE AND NOT A NOISE, which is what the structure
 * research recommends and what E-DECISIONI7 A1 = B asks for. A lattice of
 * seats, one to a cell, each carrying a PLATE of five to twelve columns raised
 * by one voxel: an object with a seed and a law, the same shape of arithmetic
 * the mounds already use, three sizes down. A run of level cubes is then as
 * long as a plate or as long as the floor between two of them, and both are
 * set by numbers that say what they mean.
 *
 * AND IT RISES AND NEVER SINKS, WHICH IS A MEASUREMENT AND NOT A SIMPLIFICATION.
 * The tuft was symmetric about nought so it would not move the mean height of a
 * field the walker stood on. The floor is a literal now, and the reference says
 * what the two levels beside the paving are: the corridor's surface lies on the
 * plane and the grass beside it stands ONE TO TWO voxels proud of the stone
 * (A §1.3). One is the bare plane, two is a sod; a sod that sank would draw
 * nought, which the target never shows anywhere along the run.
 */
export const SOD = {
  // The lattice a plate may be seated in, in metres. Six columns.
  cell: 0.60,
  // How many of those cells carry a plate at all. High, and it is the number
  // that decides how much of the meadow stands a voxel over the rest: at this
  // value 53.9% of the columns in frame are on a plate and the other 46.1% are
  // the plane itself, which is the balance the reference shows beside the
  // paving -- both of its two levels present in about equal measure.
  density: 0.78,
  // How far a plate reaches from its seat, in metres, before the lean below:
  // four to eight columns across. A PLATE IS SMALLER THAN A RUN, and that is
  // the mechanism rather than a shortfall -- the jitter is a whole cell wide,
  // so neighbouring plates at the same level overlap and READ AS ONE, and what
  // carries a level run past the size of a single plate is that merging.
  // Measured on the meadow in frame: level runs p10 2, p50 5, p90 12, against
  // the 5 to 12 the reference is read at (A 1.2, E-V1j).
  reach: { low: 0.20, high: 0.40 },
  // HOW FAR FROM ROUND A PLATE IS ALLOWED TO BE. A sod of turf is not a disc,
  // and a meadow of discs reads as a meadow of discs; stretched along its own
  // bearing and squeezed across it, the plate keeps its area and loses its
  // circle.
  lean: 0.30,
  // How high a plate stands, in whole voxels.
  rise: 1,
};

// ------------------------------------------------------------- the seats
//
// One cell of a lattice, answered from its own indices and nothing else, so the
// same cell answers the same way in every run and in every implementation.

/** The mass a mound cell carries, or null where it carries none. */
function moundSeat(cx, cz) {
  if (hash2(cx * 7 + 19, cz * 13 + 5) >= MOUND.density) return null;
  const reach = MOUND.reach.low
    + hash2(cx * 53 + 811, cz * 97 + 43) * (MOUND.reach.high - MOUND.reach.low);
  // THE BOUND THAT MAKES TWO MASSES UNABLE TO TOUCH. Whatever the jitter draws,
  // the mass stays inside its own cell, so a point is inside at most one of
  // them. It is why this term is one cell lookup rather than nine.
  const jitter = MOUND.cell / 2 - reach * (1 + MOUND.lean);
  const ang = 2 * Math.PI * hash2(cx * 71 + 17, cz * 5 + 907);
  const rise = MOUND.height.low + Math.min(MOUND.height.high - MOUND.height.low,
    Math.floor(hash2(cx * 3 + 101, cz * 29 + 61)
      * (MOUND.height.high - MOUND.height.low + 1)));
  // AND ITS OWN BANK, ONE HEIGHT FOR THE WHOLE MASS. The reference reads the
  // cut flank at two OR three voxels in one go; a mass that changed height
  // along its own bank would read as two objects. Never taller than the mass.
  const scarp = Math.min(rise, MOUND.scarp.low + Math.min(MOUND.scarp.high - MOUND.scarp.low,
    Math.floor(hash2(cx * 11 + 233, cz * 89 + 17)
      * (MOUND.scarp.high - MOUND.scarp.low + 1))));

  const x = (cx + 0.5) * MOUND.cell + (hash2(cx * 17 + 3, cz * 23 + 71) * 2 - 1) * jitter;
  const z = (cz + 0.5) * MOUND.cell + (hash2(cx * 41 + 59, cz * 19 + 13) * 2 - 1) * jitter;

  // AND A MASS MAY NOT REACH THE CORRIDOR EITHER, for the same reason it may
  // not reach another mass, and it is a measurement rather than a tidy-up.
  //
  // The corridor is laid BEFORE the masses and it returns, so a mound that
  // reached it was not laid over it -- it was CUT OFF by it, at whatever height
  // its profile happened to have where the paving began. Measured on the disc
  // that ships, one mound standing on the west verge at z = 11 made fourteen
  // column-to-column steps of three, four and FIVE voxels, where the whole rest
  // of this world steps by at most two: half a metre of cliff in one object,
  // out of an arithmetic where every riser is supposed to be the shape's.
  //
  // A mound BESIDE the corridor is wanted -- the reference shows the cut banks
  // facing the eye and the corridor, which is what EARTH.toPath is for -- so
  // what is kept away is the OVERLAP and not the neighbourhood. The test is on
  // the nominal half width plus the most the edge's two noises can add, so it
  // is one smoothstep and a table lookup: no noise is evaluated to decide it,
  // which is what keeps a mound's seat as cheap as it was.
  //
  // AND THE HEM IS NOT PART OF THAT TEST, which it was and should not have
  // been. `halo` is the width the GRAIN stops in round a mass, so that a plate
  // of turf cannot saw a clean bank; the corridor is laid before the masses and
  // returns, so it carries no grain and there is nothing for a hem to hold off.
  // What it cost is the near field: the meadow the camera sees at six to nine
  // metres is a narrow wedge with the corridor down the middle of it, and a
  // quarter of a metre of hem on each side is the difference between a mass
  // standing beside the paving -- which is what the reference shows, and what
  // EARTH.toPath exists to paint -- and no mass there at all.
  if (pathRun(z) > 0
    && Math.abs(x - pathCentreX(z))
      < pathHalfWidth(z) + PATH.wander + reach * (1 + MOUND.lean)) return null;

  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  // HOW FAR SOUTH THE MASS ACTUALLY REACHES, which is not `reach` and not
  // `reach * (1 + lean)`: the ellipse is stretched along its OWN bearing, so
  // its extent along the world's z axis is the support of that ellipse in that
  // direction. Written here because it is a property of the seat and the chord
  // above has to be a line the shape really touches -- taken from the wrong
  // half width, the cut either misses the mass or eats it.
  const along = reach * (1 + MOUND.lean);
  const across = reach / (1 + MOUND.lean);
  return {
    x,
    z,
    c,
    s: sn,
    reach,
    rise,
    scarp,
    zHalf: Math.hypot(along * sn, across * c),
  };
}

/**
 * The plate a sod cell carries, or null where it carries none.
 *
 * THE JITTER IS NOT BOUNDED HERE AND THAT IS THE DIFFERENCE FROM A MOUND. Two
 * mounds may never touch, because a mound is an object the eye is meant to
 * point at one at a time; two plates of turf at the same level ARE one plate,
 * and letting them meet is how a run gets longer than a single cell of the
 * lattice can make it. So a point is tested against the nine seats round it
 * rather than against one, and the cost of the grain is nine hashes a column
 * instead of three.
 */
function sodSeat(cx, cz) {
  if (hash2(cx * 29 + 311, cz * 61 + 137) >= SOD.density) return null;
  const reach = SOD.reach.low
    + hash2(cx * 83 + 29, cz * 11 + 503) * (SOD.reach.high - SOD.reach.low);
  const ang = 2 * Math.PI * hash2(cx * 13 + 401, cz * 47 + 67);
  const jitter = SOD.cell / 2;
  return {
    x: (cx + 0.5) * SOD.cell + (hash2(cx * 37 + 7, cz * 5 + 199) * 2 - 1) * jitter,
    z: (cz + 0.5) * SOD.cell + (hash2(cx * 3 + 89, cz * 73 + 41) * 2 - 1) * jitter,
    c: Math.cos(ang),
    s: Math.sin(ang),
    reach,
  };
}

/** Whether a point stands on a plate of turf. */
export function sodAt(x, z) {
  const cx = Math.floor(x / SOD.cell);
  const cz = Math.floor(z / SOD.cell);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const seat = sodSeat(cx + dx, cz + dz);
      if (!seat) continue;
      const px = x - seat.x;
      const pz = z - seat.z;
      const u = (px * seat.c + pz * seat.s) / (1 + SOD.lean);
      const w = (-px * seat.s + pz * seat.c) * (1 + SOD.lean);
      if (u * u + w * w < seat.reach * seat.reach) return true;
    }
  }
  return false;
}

// Where the stone stands, which is the one thing in this world a mound may not
// grow on and the one thing it used to lean against. The blocks that stand in
// grass and the boulders whose places were traced back onto the meadow off the
// target's own pixels: nothing here is a position invented for the meadow.
const GRASS_BLOCKS = MONOLITHS.filter((m) => m.baseY === 0).map((m) => ({
  x: m.position.x,
  z: m.position.z,
  c: Math.cos(m.rotationY * Math.PI / 180),
  s: Math.sin(m.rotationY * Math.PI / 180),
  hx: m.size[0] / 2,
  hz: m.size[2] / 2,
  band: MOUND.band,
  peak: MOUND.bank.high,
  // AND THE MASONRY KEEPS ITS GRASS. The target draws the meadow BITING the
  // blocks -- «erba che morde la pietra» -- and bare ground only under the two
  // stone compositions, which stand on boulders.
  bare: false,
}));
const BOULDERS = ROCK_PLAN.rocks.map((r) => ({
  x: r.x,
  z: r.z,
  radius: r.radius,
  // A block is metres of masonry and a boulder is half a metre across, so the
  // band round one is no wider than the boulder itself.
  band: Math.min(MOUND.band, r.radius * 2.2),
  peak: MOUND.bank.low,
  bare: true,
}));

// AND THE WAY IN STAYS CLEAR. The committente's reading names it twice -- the
// seven steps are all in view in the target and none of them in ours -- so the
// stair run and the platform are not a place a mound may stand. They are boxes
// in the layout and they are read from there rather than restated.
const PLATFORM_ANGLE = PLATFORM.rotationY * Math.PI / 180;
const CLEAR = [
  {
    x: PLATFORM.x,
    z: PLATFORM.z,
    c: Math.cos(PLATFORM_ANGLE),
    s: Math.sin(PLATFORM_ANGLE),
    hx: PLATFORM.width / 2,
    hz: PLATFORM.depth / 2,
  },
  {
    x: STAIRS.x,
    z: STAIRS.z,
    c: 1,
    s: 0,
    hx: STAIRS.width / 2,
    hz: STAIRS.steps * STAIRS.tread,
  },
];

/** Distance from a point to the outside of a block's footprint, in metres. */
function toBlock(b, x, z) {
  const dx = x - b.x;
  const dz = z - b.z;
  const lx = Math.abs(dx * b.c - dz * b.s) - b.hx;
  const lz = Math.abs(dx * b.s + dz * b.c) - b.hz;
  return Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, lz), 0);
}

/**
 * How near the nearest stone is, and WHICH stone it is.
 *
 * The name comes back with the distance because the bank's height is the
 * STONE'S and not the point's: one block, one bank, the same all the way round
 * it. A height drawn from the point would speckle a single mass into a dozen.
 */
function toStone(x, z) {
  let near = Infinity;
  let anchor = null;
  for (const b of GRASS_BLOCKS) {
    const d = toBlock(b, x, z);
    if (d < near) { near = d; anchor = b; }
  }
  for (const r of BOULDERS) {
    const d = Math.hypot(x - r.x, z - r.z) - r.radius;
    if (d < near) { near = d; anchor = r; }
  }
  return { near, anchor };
}

/** One evaluation of a mound at a point: how high it stands, and on what. */
function moundProfile(x, z) {
  const none = { height: 0, bank: false, halo: false, cut: 0 };
  const seat = seatAt(x, z);
  if (!seat) return none;
  const dx = x - seat.x;
  const dz = z - seat.z;
  // Stretched along its own bearing and squeezed across it: the same area, and
  // not a circle.
  const u = (dx * seat.c + dz * seat.s) / (1 + MOUND.lean);
  const w = (-dx * seat.s + dz * seat.c) * (1 + MOUND.lean);
  const d = Math.hypot(u, w);
  if (d >= seat.reach) return none;
  // THE CUT, AND IT IS A STRAIGHT LINE IN THE GRID THE MESHER MERGES ON. The
  // reason is over MOUND.cut. South is the eye's own bearing and the one the
  // reference banks its earth on, so the chord is a line of constant z: every
  // column along it stands at the same height over the same floor, and the
  // flank is one rectangle instead of a row of slivers.
  if (z > seat.z + seat.zHalf * (1 - MOUND.cut)) return none;
  // Nothing grows on the way in, on the stone, or inside a stone's own band --
  // and the test is on the SEAT and not on the point, so a mass is either
  // wholly there or wholly not and never sliced in half. A seat read off the
  // reference was asked all of this once, where it was built, and carries the
  // answer: see buildFramed.
  if (!seat.framed) {
    for (const box of CLEAR) {
      if (toBlock(box, seat.x, seat.z) < seat.reach * (1 + MOUND.lean)) return none;
    }
    if (toStone(seat.x, seat.z).near
      < MOUND.band + seat.reach * (1 + MOUND.lean) * 0.4) return none;
  }
  const flat = seat.reach * MOUND.plateau;
  if (d <= flat) {
    // The crown. Flat by default; the second terrace of answer B takes the
    // outer half of it and never the middle, so a crown is never a point.
    if (!MOUND.crownStep) return { height: seat.rise, bank: false, halo: true, cut: 0 };
    return {
      height: d <= flat / 2 ? seat.rise : Math.max(1, seat.rise - MOUND.crownStep),
      bank: false,
      halo: true,
      cut: 0,
    };
  }
  // WHICH WAY THIS POINT LOOKS OUT, as a share: one due south, nought due
  // north. South is the eye -- the pose the campaign judges on stands at z 14
  // and looks north -- and it is the bearing the target banks its earth on.
  const out = Math.hypot(dx, dz) || 1;
  const southness = 0.5 * (1 + dz / out);
  // The first riser, which is the one the eye meets: the seat's whole scarp
  // where the mass faces the camera, one voxel where it faces away, and never
  // more than the mass is tall.
  const arc = southness >= 1 - MOUND.bankArc ? 1 : 0;
  const first = Math.min(seat.rise, Math.max(1, 1 + (seat.scarp - 1) * arc));
  // Everything above that first riser is spent one voxel at a time.
  const bands = 1 + (seat.rise - first);
  const t = (seat.reach - d) / (seat.reach - flat);
  const band = Math.min(bands - 1, Math.floor(t * bands));
  return {
    height: Math.min(seat.rise, first + band),
    bank: band === 0,
    halo: true,
    // How tall the riser under this point is, which is what the store has to
    // write down: a flank of earth has to reach as far down as the wall it is
    // the face of, and the wall is this mass's own bank and not a constant.
    cut: band === 0 ? first : 0,
  };
}

/** Whole voxels of mound standing on the floor at a point. */
export function meadowMoundAt(x, z) {
  return moundProfile(x, z).height;
}

/**
 * Whether a point stands on a mound's own BANK: the outermost riser, the one
 * the eye meets, and the only place a mound is cut rather than grown.
 *
 * The family is the BANK and not the mass: on a crown, which is flat, a wall
 * that climbs two voxels is never the mound, it is the floor borrowing the
 * mound's permission for a step it built itself. Measured on the disc that is
 * where nine bands in ten came from.
 */
export function moundBankAt(x, z) {
  return moundProfile(x, z).bank;
}

/**
 * How tall the cut bank standing at a point is, in whole voxels, and nought
 * where the ground is not cut.
 *
 * IT IS A NUMBER AND NOT A CONSTANT BECAUSE THE BANK IS NOT ONE. Every mass
 * carries its own riser of two or three voxels (MOUND.scarp), so the depth the
 * store has to write under a cut top is the mass's and not the dial's: written
 * short, the earth would run out half way down its own wall and the bottom
 * voxel of a three-voxel bank would draw meadow.
 */
export function moundCutAt(x, z) {
  return moundProfile(x, z).cut;
}

/** Whether a point is on a mass, or inside the hem the grain leaves round one. */
function underMass(x, z) {
  const seat = seatAt(x, z, MOUND.halo);
  if (seat && insideSeat(seat, x, z, MOUND.halo)) return true;
  if (!MOUND.bank.high && !MOUND.bank.low) return false;
  const { near, anchor } = toStone(x, z);
  return Boolean(anchor && near <= anchor.band + MOUND.halo);
}

/**
 * Whether the ground here is RAISED and of the kind that shows what it is made
 * of: a mound of the open meadow, or the bank under a boulder.
 *
 * The floor never is, however it steps: a one-voxel plate of turf in a meadow
 * is a meadow. Neither is a block's own bank, for the reason written over the
 * blocks.
 */
export function bareRaisedAt(x, z) {
  if (moundBankAt(x, z)) return true;
  const { near, anchor } = toStone(x, z);
  return Boolean(anchor && anchor.bare && anchor.peak > 0 && near >= 0 && near <= anchor.band);
}

/**
 * Whole voxels of meadow banked against the stone, and nought away from it.
 *
 * NOUGHT EVERYWHERE TODAY, and the reason is over MOUND.bank: the reference
 * puts all four block feet on the plane. The ramp survives because the reading
 * that set it to nought is a reading of a picture, and a picture can be read
 * again; what it costs while the peak is nought is one comparison.
 */
export function moundAt(x, z) {
  const { near, anchor } = toStone(x, z);
  if (!anchor || anchor.peak <= 0 || near > anchor.band) return 0;
  // Under the stone the bank stays at its own top rather than falling away.
  // Nobody sees those columns -- the masonry is drawn over them -- but the
  // walker's own floor is read there, and a bank that dropped to nothing at the
  // footprint would put a cliff along every block in the world.
  if (near < 0) return anchor.peak;
  // Ramped and not piled: one voxel a terrace, from nothing at the band's own
  // edge up to the stone.
  const t = 1 - near / anchor.band;
  return Math.min(anchor.peak, Math.max(1, Math.ceil(t * anchor.peak)));
}

/**
 * Whether a flank of this bearing, standing here, shows bare earth.
 *
 * TWO BEARINGS AND NEITHER IS A NUMBER TYPED HERE. South is the eye: the pose
 * the whole campaign judges on stands at z 14 and looks north, so a face whose
 * outward bearing is +z is a face the picture is OF, and it is the one the
 * target draws its bare banks on. The other is the corridor, and which lateral
 * face turns toward it is read off pathCoord's OWN SIGN -- so the two sides of
 * the path answer opposite ways, the answer follows the path where the path
 * wanders, and nothing here has to know where it runs.
 *
 * IT IS A PROPERTY OF A FACE AND NOT OF A CELL, which is why it stays a
 * question the mesher asks rather than a byte in the store: the same column
 * shows earth on one of its four sides and grass on the other three.
 *
 * @param {number} face  one of FACE, from ./mesher.js
 * @param {number} x
 * @param {number} z
 */
export function earthFacing(face, x, z) {
  // FACE.SOUTH is 2 and FACE.WEST/EAST are 4 and 3; the numbers are the
  // mesher's and are taken as arguments rather than imported, because the
  // generator must not depend on the thing that draws it.
  if (EARTH.toEye && face === FACING.SOUTH) return true;
  if (!EARTH.toPath) return false;
  const side = pathCoord(x, z);
  return (side > 0 && face === FACING.WEST) || (side < 0 && face === FACING.EAST);
}

/**
 * The four lateral bearings, by the numbers the mesher uses for them.
 *
 * They are stated here and asserted there rather than imported, so the arrow
 * between these two files runs one way: the generator fills the store, the
 * mesher reads it, and neither has to load the other to build.
 */
export const FACING = { NORTH: 1, SOUTH: 2, EAST: 3, WEST: 4 };

// ======================================================================
// THE CORRIDOR, AND IT IS COLUMNS.
//
// WHAT WAS HERE. A SEAT that cut the ground away. The paving was a surface of
// its own laid over a hole in the meadow, so this generator's whole part in it
// was to lay no column where the other one drew -- and because the disc is cut
// in a worker, which is a module graph no function can be posted into, that
// answer had to arrive as data and be rebuilt here out of two numbers. A seat,
// an injector, two admissible argument shapes and a pinned re-statement, for a
// hole.
//
// WHY IT IS GONE. The reference was read wrong, and the reading was a good one
// read as the wrong kind of statement (A §1.3). The paving of the target has no
// vertical face anywhere on it and its pieces are four to ten centimetres, which
// is under the cell -- so the SURFACE is textured at a scale below the voxel,
// and the campaign took that for a statement about the GEOMETRY. But the same
// crops show the corridor's own edge following the grid: cubes of grass bite
// into it at right angles of ten centimetres, and the side face each of them
// shows -- visible because the cube stands higher -- rests ON the level of the
// paving. Both readings are true at once and they say one thing: THE CORRIDOR IS
// COLUMNS OF VOXEL AT ONE LEVEL, whose top material is a paved stone with a
// grain finer than the cell.
//
// SO IT IS A PASS OF THIS PIPELINE, laid after the base and before the masses:
//
//   the core     `top` at the floor less PATH.drop, `mat` PATH
//   the verges   the same top, `mat` EARTH, two to four columns a side
//   the masses   never on it -- a mound cannot grow out of the corridor
//   the grain    never on it -- the paving is flat, and the meadow beside it is
//                what stands one to two voxels proud
//
// AND WHAT THAT BUYS IS EVERY DEFECT THE HOLE HAD. There is no seam, because
// there are no longer two surfaces to sew: 923 columns of ten centimetre cube
// standing under the stone at fourteen metres, a lift tapered to nothing at an
// edge, a cover ramp, a floor gap, a contract with a branch for "somebody else
// owns this column" -- all of them were the price of the hole and none of them
// has anything left to be the price of.

/**
 * The corridor, as the four numbers the pass has.
 *
 * THE WIDTH IS NOT HERE, and that is deliberate: it is pathHalfWidth and
 * pathEdge in src/world/terrain-field.js, where it has always been and where the
 * reference's taper was re-measured into it. This object holds only what the
 * corridor is made OF once its footprint is known.
 */
export const PATH = {
  // How far below the floor of the meadow the paving lies, in voxels.
  //
  // ONE, AND IT IS THE MEASUREMENT AND NOT A SETTING. The reference is read
  // twice on this and the two readings are the same: at the block feet the mat
  // of grass stands ON the line at y = 0 with its blades one or two voxels over
  // it (A §1.1), and along the corridor the line falls on the PAVING with the
  // grass cubes beside it standing between one and two voxels above (A §1.3).
  // A corridor level with the floor would put the nearest grass at NOUGHT
  // voxels proud wherever the grain has not lifted it, and the reading never
  // reads nought. One voxel down, the plain meadow beside the stone stands one
  // proud and a grained plate stands two -- which is the band, by construction,
  // with no term written to buy it.
  drop: 1,
  // The bare earth either side of the stone, in columns per side.
  //
  // TWO TO FOUR, BY POSITION AND NOT ONE NUMBER, which is the committente's own
  // answer (E-DECISIONI7 A3: «orli come misurati dove sono misurati»). The
  // reference gives 0.20-0.35 m a side over the stretch it can be read on
  // (A §1.3) and this unit's own bench reads three columns a side at the near
  // rows. So it is tied to the width: the narrow middle of the field carries
  // the narrow verge and the two wide ends carry the wide one, which is what a
  // band of trodden ground does and what a constant cannot be.
  verge: { min: 2, max: 4, at: 0.5, per: 0.7 },
  // The most the two noises in pathEdge can push an edge past the nominal half
  // width, in metres: 0.105 of wobble and 0.0434 of wander, both at their own
  // full swing. Published so a reader that has to stay CLEAR of the corridor
  // can do it without evaluating either of them.
  wander: 0.105 + 0.0434,
};

/** How many columns of bare earth line each side of the stone at a northing. */
export function pathVerge(z) {
  const v = PATH.verge;
  const n = Math.round(v.min + (v.max - v.min) * (pathHalfWidth(z) - v.at) / v.per);
  return n < v.min ? v.min : n > v.max ? v.max : n;
}

/**
 * Where a column stands in the corridor: -1 nowhere near it, 0 on the stone,
 * 1 on a verge.
 *
 * THE FOOTPRINT IS pathRun AND pathCoord AND NOTHING ELSE -- the field's own
 * two, read and never copied -- and the crossing from stone to verge is a whole
 * number of columns off the edge, because a verge measured in columns is what
 * the reference shows and a fraction of a normalised coordinate is not.
 */
function corridorAt(x, z) {
  if (pathRun(z) <= 0) return -1;
  const centre = pathCentreX(z);
  const left = centre - pathEdge(z, -1);
  const right = centre + pathEdge(z, 1);
  if (x < left || x > right) return -1;
  // AND THE VERGE IS COUNTED IN COLUMNS AND NOT IN METRES, which is the whole
  // reason this row's two ends are solved rather than a distance being
  // thresholded. A band `n * VOXEL` metres wide, sampled at the centres of
  // columns that fall wherever the wobble of the edge puts them, comes out n
  // plus or minus one -- and a verge of one column where the law says three is
  // a thin brown line the eye reads as a mistake. Here the first and last
  // column of the row ARE the row's ends, and the n beyond each of them is the
  // verge, exactly, at every northing.
  const i = Math.floor(x / VOXEL);
  const first = Math.ceil(left / VOXEL - 0.5);
  const last = Math.floor(right / VOXEL - 0.5);
  const n = pathVerge(z);
  return i - first < n || last - i < n ? 1 : 0;
}

/** Whether a point stands on the corridor at all, stone or verge. */
export function onPaving(x, z) {
  return corridorAt(x, z) >= 0;
}

// ======================================================================
// THE SEATS THE PICTURE HAS, TURNED INTO SEATS THE MEADOW'S OWN ARITHMETIC
// UNDERSTANDS.
//
// FRAMED above is a READING -- where a flank stands, how wide it runs, how tall
// it is. A seat is what moundProfile evaluates: a centre, a bearing, a reach, a
// rise and a bank. This is the one place the first becomes the second, and
// every step of it is the shape's own arithmetic rather than a number written
// down twice.
//
// AND IT IS NOT ONE SEAT TO A CELL, WHICH IS WHY THIS IS NOT THE LATTICE. A
// lattice seat is bounded to stay inside its own cell, so a point belongs to at
// most one and a single lookup finds it. The reference does not lay its masses
// on a lattice of 3.8 m: three of these four fall in ONE cell. So the store
// below keeps a LIST to a cell, a seat is registered in every cell its
// footprint touches, and the cells around them are registered as REFUSALS so
// the lattice cannot seat a mass that would touch one. The lookup stays O(1) in
// the size of the table and costs, where a cell is empty, one map miss.
//
// AND IT IS BUILT LAZILY BECAUSE OF THE ORDER OF THIS FILE AND NOT ITS COST:
// the clearance below reads PATH, which is declared under the corridor, and a
// module that built this at load would read a constant before its own line ran.

/** Cell key to what the reference says about that cell, or nothing. */
let framedCells = null;

/** What became of the reference's seats, so a table that misses is not silent. */
export const framedTally = {
  laid: 0, pushed: 0, dropped: 0, cells: 0, refused: 0,
};

/**
 * The half width of a mass's cut chord, as a share of its reach.
 *
 * READ OFF THE SHAPE AND NOT MEASURED ANYWHERE. moundProfile takes the southern
 * cap off the footprint at a line of constant z, `MOUND.cut` of the way in from
 * its southern extent; the flank a picture then shows is the ellipse's own
 * width at that line. So a flank measured `width` metres across belongs to a
 * mass of `width / (2 * CHORD)` of reach, and the reading and the shape are
 * tied together by the dials rather than by a factor.
 */
const CHORD = (1 + MOUND.lean) * Math.sqrt(1 - (1 - MOUND.cut) * (1 - MOUND.cut));

function buildFramed() {
  framedCells = new Map();
  const cellAt = (cx, cz) => {
    const k = `${cx},${cz}`;
    let c = framedCells.get(k);
    if (!c) { c = { seats: [] }; framedCells.set(k, c); }
    return c;
  };
  for (const f of FRAMED) {
    // THE SIZE. Clamped into the band the campaign already ratified off this
    // same reference (MOUND.reach), and the clamp is not a tidy-up: what was
    // measured is the width of the piece of the flank the instrument RESOLVED,
    // which is a floor on the flank and not the flank. Two of these four read
    // under the smallest mass this world can build, and a mass narrower than
    // that is a picket rather than an object.
    const reach = Math.min(MOUND.reach.high, Math.max(MOUND.reach.low, f.width / (2 * CHORD)));
    // THE BEARING IS ALONG X, and that is a reading and not a default: the
    // census measures a flank ACROSS the frame and the eye stands due south of
    // it, so the axis the picture resolves is the one the mass is long on.
    const across = reach / (1 + MOUND.lean);
    const along = reach * (1 + MOUND.lean);
    // The centre, from the foot of the cut: the chord stands `MOUND.cut` of the
    // way in from the southern extent, so the centre is that much further north.
    const z = f.zFoot - across * (1 - MOUND.cut);
    // AND THE CORRIDOR STILL EXCLUDES IT. The paving is laid before the masses
    // and returns, so a mass that reached it would not be laid over it -- it
    // would be CUT by it, at whatever height its profile had where the stone
    // began, which is the half metre of cliff U-FOND-4 measured on one mound at
    // the west verge. The reference puts this mass beside the corridor and the
    // corridor is where our own fit put it, so the seat is moved OFF the paving
    // by exactly the overlap rather than dropped: the picture's composition is
    // kept and the corridor's one invariant with it.
    const centre = pathCentreX(z);
    const clear = pathHalfWidth(z) + PATH.wander + along;
    let x = f.x;
    if (pathRun(z) > 0 && Math.abs(x - centre) < clear) {
      x = centre + Math.sign(x - centre || 1) * clear;
      framedTally.pushed++;
    }
    // AND NOTHING GROWS ON THE WAY IN OR THROUGH THE MASONRY. The way in is the
    // committente's own reading named twice -- the seven steps are all in view
    // in the reference and none in ours -- and a mound rising through a block is
    // a mound inside a wall. A seat this table puts in either is refused here,
    // counted, and never half drawn.
    const buried = CLEAR.some((box) => toBlock(box, x, z) < reach * (1 + MOUND.lean))
      || GRASS_BLOCKS.some((b) => toBlock(b, x, z) < b.band + reach * (1 + MOUND.lean) * 0.4);
    if (buried) { framedTally.dropped++; continue; }
    // AND THE BOULDERS DO NOT REFUSE IT, WHICH IS THE ONE CLEARANCE A FRAMED
    // SEAT DOES NOT KEEP -- AND THE REASON IS A MEASUREMENT. The lattice keeps
    // its masses a stone's band away from every stone, boulders included,
    // because a mass that reached a bank would ADD to it. There is no bank:
    // MOUND.bank stands at nought on the reference's own evidence
    // (E-FOND-PIANO2.1), so round a boulder that clearance protects nothing.
    // And the boulders' places were themselves traced back off this same
    // picture's pixels, so a rock inside one of these seats is a rock the
    // reference draws STANDING ON the mass. Refusing the mass would be reading
    // one half of a picture against the other half.
    const seat = {
      x,
      z,
      c: 1,
      s: 0,
      reach,
      rise: f.rise,
      // ONE HEIGHT TO A MASS, AND NEVER TALLER THAN THE MASS. The reference
      // reads the cut at two or three voxels in one go (A 1.2), and this table
      // carries how tall the whole mass stands, so the bank is the taller of
      // the two the dial admits, capped by the mass itself.
      scarp: Math.min(f.rise, MOUND.scarp.high),
      zHalf: across,
      // The clearances above were answered once, here, where the reading is.
      framed: true,
    };
    framedTally.laid++;
    // Every cell the footprint touches carries the seat; every cell out to the
    // largest mass the lattice can draw is closed to the lattice, which is how
    // "mai due attaccati" survives a seat the lattice did not choose.
    const pad = MOUND.reach.high * (1 + MOUND.lean) + MOUND.halo;
    const grid = (v) => Math.floor(v / MOUND.cell);
    for (let cz = grid(z - across - pad); cz <= grid(z + across + pad); cz++) {
      for (let cx = grid(x - along - pad); cx <= grid(x + along + pad); cx++) {
        const c = cellAt(cx, cz);
        if (cx >= grid(x - along) && cx <= grid(x + along)
          && cz >= grid(z - across) && cz <= grid(z + across)) c.seats.push(seat);
      }
    }
  }
  for (const c of framedCells.values()) {
    if (c.seats.length) framedTally.cells++; else framedTally.refused++;
  }
}

/** Whether a point is inside a seat's own ellipse, grown by `pad` metres. */
function insideSeat(seat, x, z, pad) {
  const dx = x - seat.x;
  const dz = z - seat.z;
  const u = (dx * seat.c + dz * seat.s) / (1 + MOUND.lean);
  const w = (-dx * seat.s + dz * seat.c) * (1 + MOUND.lean);
  const r = seat.reach + pad;
  return u * u + w * w < r * r;
}

/**
 * The seat a point belongs to: the reference's where the reference has one, the
 * lattice's everywhere else.
 *
 * THE ONE DOOR, so that the mass, its hem and the guard all ask the same
 * question. Where the reference has spoken the lattice is silent -- a cell this
 * table touches answers null rather than rolling its own hash -- which is what
 * keeps a mound of the law from growing into a mound of the picture.
 *
 * @param {number} pad  metres of hem to grow a framed seat by, so that the
 *                      grain's own question and the mass's ask the same one
 */
function seatAt(x, z, pad = 0) {
  if (!framedCells) buildFramed();
  const cell = framedCells.get(`${Math.floor(x / MOUND.cell)},${Math.floor(z / MOUND.cell)}`);
  if (cell) {
    for (const seat of cell.seats) if (insideSeat(seat, x, z, 0)) return seat;
    if (pad) for (const seat of cell.seats) if (insideSeat(seat, x, z, pad)) return seat;
    return null;
  }
  return moundSeat(Math.floor(x / MOUND.cell), Math.floor(z / MOUND.cell));
}

// Where the block of the demo stands, so the meadow does not grow inside the
// masonry. Its own footprint, in its own frame, plus a hand of clearance.
const BLOCK = MONOLITHS.find((m) => m.id === '05');
const BLOCK_ANGLE = BLOCK.rotationY * Math.PI / 180;
const BLOCK_HALF = { x: BLOCK.size[0] / 2 + 0.12, z: BLOCK.size[2] / 2 + 0.12 };

/** Whether a point stands inside the block's own footprint. */
function insideBlock(x, z) {
  const c = Math.cos(BLOCK_ANGLE);
  const s = Math.sin(BLOCK_ANGLE);
  const dx = x - BLOCK.position.x;
  const dz = z - BLOCK.position.z;
  return Math.abs(dx * c - dz * s) <= BLOCK_HALF.x
    && Math.abs(dx * s + dz * c) <= BLOCK_HALF.z;
}

/** World position of the centre of a column, from its global voxel indices. */
export function columnCentre(ix, iz) {
  return { x: (ix + 0.5) * VOXEL, z: (iz + 0.5) * VOXEL };
}

// ------------------------------------------------------------ the pipeline

/**
 * One column of the world, as the four passes leave it.
 *
 * THIS IS THE LAW, AND THE STORE IS THE TRANSPORT. There is exactly one
 * statement in this project of what stands at a point, and it is here; what
 * `chunkColumns` below does is run it over a rectangle and write the answers
 * down. A second, faster copy of it for the walker or for a tool would be a
 * second opinion about the floor, which is the defect the whole engine is built
 * to make impossible.
 *
 * @param {number} ix  global voxel index along x
 * @param {number} iz  global voxel index along z
 * @param {boolean} grain  whether the sods are part of the ground
 * @param {number} radius  how far the disc reaches, in metres
 * @returns {{top: number, mat: number, under: number, depth: number}} the
 *          column, with `top` at NO_COLUMN and `mat` saying why where none
 *          stands
 */
export function columnSpec(ix, iz, grain = true, radius = DISC_RADIUS) {
  const { x, z } = columnCentre(ix, iz);
  const gone = (why) => ({ top: NO_COLUMN, mat: why, under: MATERIAL.AIR, depth: 0 });

  // 2. THE SEATS. The rim of the disc first, because it is the cheapest test
  //    and because a column outside it is not this engine's ground at all.
  if (Math.hypot(x - CENTRE.x, z - CENTRE.z) > radius) return gone(MATERIAL.AIR);
  if (insideBlock(x, z)) return gone(MATERIAL.STONE);

  // 1. THE BASE. One literal, and it is the only place a height is decided.
  let top = BASE_STEP;
  let under = MATERIAL.GRASS;
  let depth = 0;

  // 2. THE CORRIDOR, and it is the second thing that happens rather than a hole
  //    cut before anything else. It sets its own level and its own two
  //    materials and it RETURNS: nothing after this line may touch it, which is
  //    how the paving stays flat and how the meadow beside it keeps the one to
  //    two voxels the reference measures.
  const on = corridorAt(x, z);
  if (on >= 0) {
    return {
      top: top - PATH.drop,
      // THE VERGE IS EARTH BECAUSE EARTH.verge SAYS SO, and it is read here
      // rather than assumed. The dial is E-V1j's answer C -- the lembo is bare
      // ground and not a shadow -- and it lost its reader at step 4 when the
      // rule that used to consult it, a wall painted at the lip of a hole, died
      // with the hole. The band it described is real now and this is where it
      // is decided, so the reading is a dial again instead of a datum nobody
      // asks.
      mat: on === 0 || !EARTH.verge ? MATERIAL.PATH : MATERIAL.EARTH,
      // What is under the paving is soil, and it is written down rather than
      // left at the meadow's default: the corridor is the lowest ground in the
      // world, so the only wall it ever raises is at the rim of the disc, and
      // a rim of grass under a stone floor would be the one place this shows.
      under: MATERIAL.EARTH,
      depth: 1,
    };
  }

  // 3. THE MASSES. THE TALLEST THING THAT CLAIMS A COLUMN, AND NOT THE SUM OF
  //    THEM: a mound that reached into a bank used to ADD to it, which put a
  //    mass ten voxels tall against a stone. Neither term is a quantity of
  //    earth to be totalled -- each says how high the ground stands here, and
  //    where two say it the answer is the higher.
  const mass = Math.max(moundAt(x, z), meadowMoundAt(x, z));
  if (mass > 0) {
    top += mass;
    // What the flank is cut into. The BANK is the one riser the shape puts
    // there on purpose, and it is the only place a mass shows what it is made
    // of; everything else about a mass is meadow and keeps its grass.
    if (bareRaisedAt(x, z)) {
      under = MATERIAL.EARTH;
      // As deep as the wall this column raises, and no deeper: the mass's own
      // bank, not the dial's widest reading.
      depth = Math.max(1, moundCutAt(x, z));
    }
  }

  // 4. THE GRAIN, last, and never over a mass or the hem round one: the grain
  //    belongs to the floor, a mass is set on the floor, and letting the one
  //    run over the other is what turned a bank into a saw and a 0.30 m step
  //    into a 0.50 m one.
  if (grain && mass === 0 && !underMass(x, z) && sodAt(x, z)) top += SOD.rise;

  return { top, mat: MATERIAL.GRASS, under, depth };
}

/**
 * The top voxel of one column, as a whole number of steps.
 *
 * THE DOOR FIFTEEN READERS COME THROUGH, kept by name and by argument. It is a
 * thin reading of `columnSpec` and not a second law -- see the note there --
 * and it hands back the engine's own sentinel for "no column" rather than the
 * store's, because src/world/contracts.js recognises that value by its
 * MAGNITUDE and a two-byte sentinel would read there as a column sixty five
 * metres underground.
 *
 * THE DAY THE FIRST EDIT LANDS THAT IS NOT PART OF THE PIPELINE -- the corridor
 * written as columns at step 4, a mass moved by hand -- this has to be pointed
 * at the store instead, or it and the picture will part company. Today the
 * pipeline is the whole of the world and the two agree by construction.
 */
export function columnTop(ix, iz, grain = true, radius = DISC_RADIUS) {
  const spec = columnSpec(ix, iz, grain, radius);
  return spec.top === NO_COLUMN ? EMPTY : spec.top;
}

/**
 * What `columnTop` hands back where no column stands.
 *
 * Not nought and not a small negative: it is a value no wall can ever be
 * measured against, so an edge column raises its whole side rather than the
 * sliver above a neighbour's shoulder, and it is a decade clear of anything the
 * contract could mistake for a height.
 */
export const EMPTY = -1e9;

/**
 * One chunk of the world, written into a store, with a skirt of one column.
 *
 * THE SKIRT IS NOT A DETAIL. A wall on a chunk's own edge has to be measured
 * against the ground BEYOND it or every chunk grows a full height curtain round
 * its whole rim -- so the store this hands back spans CHUNK + 2 columns a side
 * and its origin is one column back. The mesher then never asks anything but
 * this store: no field, no predicate, no second opinion.
 *
 * @param {number} cx  chunk index along x
 * @param {number} cz  chunk index along z
 * @param {number} n   columns per side of a chunk
 * @param {boolean} grain
 * @param {number} radius
 */
export function chunkColumns(cx, cz, n, grain = true, radius = DISC_RADIUS) {
  const span = n + 2;
  const store = createColumns(cx * n - 1, cz * n - 1, span, span);
  for (let j = 0; j < span; j++) {
    for (let i = 0; i < span; i++) {
      const ix = store.ox + i;
      const iz = store.oz + j;
      const spec = columnSpec(ix, iz, grain, radius);
      // Through the store's own door and not into its arrays, so that the
      // write side steps 4 and 5 will edit through is the one this pass
      // already uses, and a defect in it is a defect the disc shows today.
      if (spec.top === NO_COLUMN) clearColumn(store, ix, iz, spec.mat);
      else {
        setTop(store, ix, iz, spec.top, spec.mat);
        setFlank(store, ix, iz, spec.under, spec.depth);
      }
    }
  }
  return store;
}

/** The whole disc, in chunk coordinates: every chunk with a column in it. */
export function chunkList(n, radius = DISC_RADIUS) {
  const half = Math.ceil(radius / VOXEL / n) + 1;
  const cx0 = Math.floor(CENTRE.x / VOXEL / n);
  const cz0 = Math.floor(CENTRE.z / VOXEL / n);
  const list = [];
  for (let cz = cz0 - half; cz <= cz0 + half; cz++) {
    for (let cx = cx0 - half; cx <= cx0 + half; cx++) {
      // The chunk's own square against the disc, before a single column is
      // built: the corners of the box nearest the centre decide it, and a chunk
      // that cannot reach the disc costs no work at all.
      const x0 = cx * n * VOXEL;
      const z0 = cz * n * VOXEL;
      const x1 = x0 + n * VOXEL;
      const z1 = z0 + n * VOXEL;
      const nx = Math.max(x0, Math.min(CENTRE.x, x1));
      const nz = Math.max(z0, Math.min(CENTRE.z, z1));
      if (Math.hypot(nx - CENTRE.x, nz - CENTRE.z) <= radius) list.push({ cx, cz });
    }
  }
  return list;
}
