import { AREA_CENTER, MONOLITHS, PLATFORM, STAIRS } from '../layout.js';
import {
  BASE_LEVEL, pathCentreSlope, pathCentreX, pathCoord, pathEdge, pathHalfWidth,
  pathOffset, pathRun,
} from '../terrain-field.js';
import {
  BLADE, BLADES_PER_VOXEL, MATERIAL, NO_COLUMN, SUB, VOXEL,
  clearColumn, createColumns, setBlade, setFlank, setTop,
} from './columns.js';
// The plan and not the meshes: where the boulders stand is a number in a file,
// and rocks.js -- which is where they become geometry -- reaches three.js. The
// import attribute is what lets the same line be read by node and by the
// bundler, which is the property this whole half of the engine rests on.
import ROCK_PLAN from '../../../assets-src/rocks/rocks.json' with { type: 'json' };
// AND THE EDGE OF THE WORLD, WHICH IS GROUND AND THEREFORE THIS FILE'S BUSINESS
// EVEN THOUGH ITS SHAPE IS NOT. ./confine.js states the plateau, the fall
// quantised into terraces and the ridge that closes the horizon
// (E-DECISIONI13); this file lays them as COLUMNS, through the same four
// arrays and the same doors as the meadow, so that the boundary is one more
// stretch of the same store and never a second representation.
import { confineSteps } from './confine.js';
// AND THE SUN, FROM THE ONE FILE THAT IS ALLOWED TO SAY WHERE IT IS.
//
// The mat's shadow is the first thing this engine builds that depends on the
// HOUR, and the campaign spent a session removing second opinions about that.
// So the bearing is not an elevation and an azimuth typed into this file: it is
// `day.sun.vector` out of assets-src/sky/sky.json, the same object src/core/
// sky.js hands the whole world's light through, and it is under the seal that
// tools/lighting/sun-seal.json holds. A re-seal moves the shadows along with
// everything else, which is the property that makes it ONE sun, and guard-erba
// refuses a map baked along any other bearing than this file's.
//
// The same import attribute as the rocks above, and for the same reason: node
// reads this line offline and the bundler reads it inside the worker.
import SKY from '../../../assets-src/sky/sky.json' with { type: 'json' };

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
//   4. THE MAT       the blades of grass, which are NOT the ground: a second
//                    lattice at half the step, laid on whatever top is meadow,
//                    read out of the same store and drawn as a family of its
//                    own. It moves no column and the walker passes through it.
//
// AND THE ORDER IS THE MEANING. The mat comes last and lays itself on the tops
// the passes before it left, so it never has to know where a mound is; the
// seats come before the masses, so a mound cannot grow out of a hole; the base
// comes first, so there is exactly one place in this world that says how high
// the ground is.
//
// THE FOURTH PASS USED TO BE THE GRAIN -- plates of turf standing one voxel over
// the floor -- and it is gone. E-DECISIONI8: the terrain of the target is ONE
// LEVEL, and what the plates were fitted to is the mat.

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

/**
 * Value noise on the lattice above, smooth and between nought and one.
 *
 * A FIELD AND NOT A SCATTER, and that is the whole of what it is for: the mat's
 * own law is uncorrelated on purpose (E-ERBA-A 1.4, «il manto cambia quota quasi
 * a ogni filo»), so a second uncorrelated draw over it would be the same speckle
 * twice. What the committente asks for -- «ci sono punti a piu' bassa
 * intensita'» -- is a PLACE, which is a thing with a size, and a size is a
 * correlation length.
 */
function noise2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uz;
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
// AND NOT ONE OF THESE THREE MOVED WHEN THE CORRIDOR DID. They are positions on
// the plane y = 0, projected out of the picture through POSE_VOX_DAY, and the
// corridor is nowhere in that arithmetic: the centreline could be anywhere and
// these rows would read the same. What DOES follow the corridor is the clause
// below that pushes a seat off the paving -- and when the centreline moved east
// by 1.36 m at the near end, the push changed hands. The reading did not.
export const FRAMED = [
  // The right foreground mass: the one A-10 shows with its brown flank turned
  // to the corridor. Its bank reads 0.92 m of brown; its gathering of risers
  // spans 1.53 m.
  //
  // AND IT IS THE ONE THE CLEARANCE NOW HAS TO PUSH, BY 0.48 m, to x 2.62. That
  // is a bigger correction than the one it replaces and it is reported rather
  // than absorbed: what it says is that the reference draws this mass closer to
  // its own corridor than our corridor's nominal width plus this mass's reach
  // will allow -- 1.52 m of separation measured against 1.81 m demanded. Either
  // the strip is too wide here (pathHalfWidth reads 0.80 at this northing where
  // the reference's own verges read 0.69) or the mass's reach is, and both are
  // fitted numbers of other units. The seat is moved and not dropped for the
  // reason the clause already gives.
  { x: 2.14, zFoot: 8.19, width: 0.92, rise: 4 },
  // The left foreground mass. It used to be the one seat the rule had to push,
  // by 0.18 m, back when the centreline ran a metre west of where the reference
  // puts it; with the corridor in register there is 2.80 m between the two and
  // the seat stands exactly where the picture was read.
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
 * THE MAT OF GRASS, AND THE STEP IT IS MEASURED IN, WHICH IS NOT THE WORLD'S.
 *
 * WHAT THIS REPLACES. The floor used to be grained twice over: first by a TUFT
 * (a value noise thresholded to plus or minus a voxel, which put a step every
 * three or four cubes), then by the SODS -- plates of turf on a lattice, one
 * voxel proud of the plane, five to twelve columns across. Both were readings
 * of the same pixels, and both read them as GROUND. E-DECISIONI8 says in the
 * committente's own words that they are not ground: «nel target l'erba e'
 * rappresentata da voxel piu' o meno lunghi che proiettano ombre sugli altri
 * fili ... e' per questo che il terreno era perfettamente pianeggiante:
 * stavate analizzando i fili d'erba come rilievi».
 *
 * So the terrain goes back to being ONE LEVEL -- the plane, the masses set on
 * it, the corridor cut into it, and nothing else -- and what stood in the
 * pixels the sods were fitted to is this: a mat of BLADES standing on top of
 * it, which is not terrain, is not walkable, and is not measured in the
 * world's step.
 *
 * THE BLADE IS 5 CM AND THE TARGET'S IS 6, AND THE 17% IS DECLARED RATHER THAN
 * HIDDEN. E-ERBA-A measured the blade at 5.5-6.0 cm -- 0.60 of our cube -- with
 * a control that reads 1.087 where the truth is 1.000, and three earlier
 * readings on the ledger say the same number (B 1.2 «10 px against 18»,
 * E-PIG2 «20 against 12», columns.js:52 «against the target's 12»). Three
 * answers were on the table and the coordinator took the first (D-E1 = A):
 *
 *   A  5 cm, a whole sub-lattice x2 of the store -- 17% short, every seam
 *      exact, four blades to a column of world. THIS ONE.
 *   B  6 cm exactly, a lattice of its own -- faithful, and then the two grids
 *      never line up and every seam (corridor, mound, rim) becomes a case.
 *   C  10 cm, the blade IS our cube -- 67% over, and the mat would stand
 *      10-40 cm instead of 6-24.
 *
 * AND IT IS NOT THE SECOND STEP columns.js:44-56 REFUSES. That note refuses a
 * LADDER OF SIZES ANCHORED TO THE WORLD -- a ring measured for the middle of
 * the hub and wrong under the walker's feet at the rim. This is one step, the
 * same everywhere, and it is a whole division of the one that already exists:
 * two blades to a cube on each axis, so a blade boundary is never between two
 * cube boundaries and no seam has to be invented anywhere.
 */
export { BLADE, BLADES_PER_VOXEL, SUB } from './columns.js';

/**
 * The law of the mat: how tall a blade stands, and how often the plane shows.
 *
 * THE NUMBERS ARE A FIT AND THE FIT IS WRITTEN DOWN. E-ERBA-A does not measure
 * the height of a blade directly -- it says so itself (limite 10): what its
 * validated estimator measures is the RISER between neighbouring blades, over
 * 2 265 risers in four resolved windows, and it comes to
 *
 *     1 blade 52%   2 blades 31%   3 blades 14%   4 or more 3%
 *
 * plus one hand reading at the kerb of the corridor, the only true vertical
 * rule the near field offers: the mat stands 6-24 cm over the plane, median
 * 12 cm = two blades.
 *
 * For a field with no correlation between neighbours -- which is what 1.4
 * measures, top runs of 0.6-1.0 blades, «il manto cambia quota quasi a ogni
 * filo» -- those two readings are ONE distribution, and the law below is the
 * one that reproduces both. Solved on a grid over the five-way laws
 * (fondazione/lav/er-fit.mjs), it gives back
 *
 *     51.9 / 31.0 / 14.1 / 3.0   against the measured 52 / 31 / 14 / 3
 *
 * with a median of two blades. The residual is one part in a million and the
 * fit is not tuned any further, because the measurement it is fitted to has a
 * band of its own.
 *
 * AND THE FIFTH RUNG IS WHAT THE FOURTH BIN COSTS. A mat that stood 1-4 blades
 * could never draw a riser of four: the tallest riser four levels can make is
 * three. The measured 3% at «4 or more» ASKS for a fifth rung, and 5% of blades
 * at five blades is what pays for it -- 30 cm, over the 24 the kerb reading
 * brackets. It is declared here rather than trimmed, because trimming it would
 * be trimming the measurement to fit the model.
 */
export const MANTO = {
  // The share of blade columns at each height, from bare plane upward. Index is
  // the height in blades, so `law[0]` is the plane showing through.
  //
  // AND THE PLANE SHOWS AS MUCH AS THE TARGET SHOWS IT AND NOT MORE. E-ERBA-A
  // 2 counts the brown pixels in the open meadow away from the corridor at
  // 0.4-0.8%: «il manto e' chiuso: non ci sono buchi nell'erba da cui si veda
  // il piano». Six thousandths is the middle of that band.
  law: [0.006, 0.2286, 0.3280, 0.2286, 0.1590, 0.0498],
  // Where the mat stands, and the one place it does not.
  //
  // ON EVERY GRASS TOP, WHICH IS THE COMMITTENTE'S OWN ANSWER (E-DECISIONI9.4,
  // «un po' d'erba anche sui cumuli») and D-E3. E-ERBA-A 3 measures it on the
  // target: «sopra il cumulo ci sono i fili ... l'erba continua sopra il prato
  // del cumulo». So the mat is a term that lays itself on whatever top is
  // MEADOW, and the corridor's stone and the earth of its verges are exactly
  // the tops that are not.
  //
  // AND THE VERGE IS MEASURED AND NOT ASSUMED. The reading is in the verbale of
  // this unit: on the target's own verge, in the band the corridor is resolved
  // in, the brown of the bare earth runs unbroken to the stone. A blade every
  // few columns there is what the eye reads as a ragged edge, and the target's
  // is not ragged -- so the verge carries none, and the number that says so is
  // this one rather than an omission.
  // ------------------------------------------------- THE FIELD OF INTENSITY
  //
  // E-DECISIONI10 G1, his words: «l'erba copre come un MANTO piu' o meno
  // uniforme quasi tutto il prato; ci sono punti a piu' bassa INTENSITA', con
  // erba meno fitta e meno alta; il manto e' a piu' alta intensita' vicino alle
  // creste, alle prominenze e attorno ai monoliti». And G3: «puo' essere molto
  // bassa (dintorni del sentiero) e infittirsi e alzarsi in maniera GRADUALE e
  // giustificata».
  //
  // SO THERE IS ONE NUMBER AND IT MOVES BOTH, which is not a simplification but
  // his own sentence: «meno fitta E meno alta». A share of the columns carry no
  // blade at all, and the ones that do are shorter, and both fall together with
  // the same field. What it also buys, for nothing, is the SUB-BLADE height of
  // G3 -- a blade at three quarters of the intensity is three quarters of its
  // own height, which is not a whole number of blades and does not have to be.
  //
  // AND THE RAMP AT THE CORRIDOR IS MEASURED. The committente's own complaint
  // (E-DECISIONI10, nota) is «da noi ha netti confini verdi ai margini». Read on
  // the target and on the render that carried this defect, the share of green
  // pixels against the lateral distance from the edge of the paving, over the
  // stretch of corridor the pose resolves (fondazione/lav/er-campo.py):
  //
  //     from the edge   -0.2   0.0   0.12   0.30   0.55   0.90   1.45   2.4 m
  //     TARGET          22.1  42.0  50.1   56.5   60.4   63.0   76.2  75.1 %
  //     before          32.6  56.9  97.9   99.5   98.5   94.6   92.2  90.3 %
  //
  // The target climbs over a metre and a half; the meadow that shipped goes from
  // 57 to 98 per cent in FIFTEEN CENTIMETRES. That step is the «netto confine
  // verde», and it is a step because the mat used to stand on grass tops and
  // stop dead at the band of bare earth beside the stone.
  //
  // Read against its own plateau the target's ramp is 0.55 at the kerb and 1.00
  // by 1.2-1.5 m, which is the pair of numbers below.
  verge: { low: 0.10, reach: 1.80 },
  // How many of the columns still carry a blade where the intensity is nought,
  // and how tall it is there as a share of its own draw. Fitted together against
  // the ramp above, because what the picture shows is the two multiplied.
  thin: 0.34,
  short: 0.30,
  // THE THINNER PLACES OF THE OPEN MEADOW -- «ci sono punti a piu' bassa
  // intensita'» -- as a slow field over the world rather than a scatter, so what
  // it draws are PLACES and not speckle. The cell is in metres and the floor is
  // how far down the field may take the mat where it is thinnest.
  patch: { cell: 3.4, low: 0.74 },
  // AND WHERE IT IS THICKEST: «vicino alle creste, alle prominenze e attorno ai
  // monoliti». A mass and the stone both carry a halo of full intensity, so the
  // slow field cannot thin the mat out exactly where he asks for it thickest.
  //
  // AND THIS ONE IS HIS WORD AND NOT A MEASUREMENT, WHICH IS DECLARED. The same
  // instrument that measured the corridor's ramp cannot measure this one: in the
  // rings within a metre and a half of a block's foot the pixels are mostly the
  // BLOCK -- a dark navy silhouette that is not grass and not ground -- so the
  // green share there reads 28% and says nothing about the mat. The reading is
  // reported in the verbale as contaminated rather than quoted as a number.
  halo: 1.60,
  // AND THE MAT CROSSES ONTO THE BARE EARTH OF THE VERGE, WHICH IS THE HALF OF
  // THE ANSWER THE FIELD ABOVE CANNOT GIVE ON ITS OWN.
  //
  // A ramp of intensity that stopped at the last grass top would still draw a
  // hard line, because the line is not the intensity -- it is the EDGE OF THE
  // MATERIAL: the corridor writes two to four columns of MATERIAL.EARTH either
  // side of the stone (PATH.verge), and a mat that stood only on grass ended
  // exactly there, at full height, against brown. So the mat lays on the earth
  // of the verge too, at whatever intensity the ramp gives it -- which is its
  // lowest -- and what the eye gets is blades thinning and shortening INTO the
  // brown instead of a green wall standing on it.
  //
  // The stone itself carries none. The target shows a fifth of its kerb pixels
  // green, so it does carry some; that is the tessellation of E-DECISIONI10 S1
  // to S3 -- tiles of stone and brown earth thinning into each other with a
  // relief of a centimetre -- and it is U-SENT-2's, on the corridor's own
  // sub-lattice. What this unit owes it is a mat that is already fading where
  // it arrives, and that is what the ramp is.
  onVerge: true,
  // HOW MUCH OF THE GROUND BESIDE THE CORRIDOR IS STILL BARE EARTH, as a
  // multiplier on the intensity: at one, a column is earth exactly as often as
  // the mat is thin there. Fitted against the ramp of green above -- the sweep
  // and its table are in the verbale of U-ERBA-1.
  ground: 0.75,
  // ------------------------------------------------- AND HOW WIDE A BLADE IS
  //
  // E-DECISIONI10 G3: «larghezza da 3/4 a 1 voxel completo, altezza variabile».
  // U-ERBA-1 did not build it and priced it instead, and the price is the whole
  // of why this is a threshold and not a field: a blade narrower than its own
  // cell no longer merges with the cell beside it, so it becomes a box of its
  // own -- ten triangles against the 0.84 a blade column costs today.
  //
  // WHERE IT IS FREE IS WHERE THE COMMITTENTE ASKED FOR IT, and that is not a
  // coincidence. Under `below` the mat is thin (G3 again: «puo' essere molto
  // bassa, dintorni del sentiero»), so a blade there already has all four of its
  // flanks in the air -- its neighbours are absent or shorter -- and narrowing
  // it takes nothing out of the greedy that the greedy still had. Where the mat
  // is closed the same change costs a factor of two and a half on the largest
  // family in the world, against 1.72 ms of margin, so it is not made there and
  // the reason is that number and not a taste.
  //
  // AND THE WIDTH IS A DRAW AND NOT A CONSTANT, because «da 3/4 a 1» is a range
  // and a mat of blades all at three quarters is as regular as a mat of blades
  // all at one. Eighths, so the inset is a whole number of anything that has to
  // divide it, and six to eight is exactly the committente's band.
  //     soglia   fili stretti   tri del disco   sul tetto di 187 000
  //      0.00            0          183 802          0.983x
  //      0.12          809          186 670          0.998x
  //      0.20        1 172          187 862          1.005x
  //      0.30        1 543          189 382          1.013x   <- what ships
  //
  // 0.30 IS A BAND HALF A METRE WIDE FROM THE KERB and 0.12 is one column: the
  // first is «i dintorni del sentiero» and the second is a line nobody can read.
  // The disc it costs is 189 382 triangles against an allocation of 187 000, so
  // the allocation is EMENDED to the measured number and declared (R4, D-E2:
  // «l'allocazione si emenda al numero misurato»), and the gate it is actually
  // judged on is the frame -- the table is in the verbale of U-ERBA-2.
  slim: { below: 0.30, low: 6, high: 8 },
  // ------------------------------------------------------- and what it costs
  //
  // HOW FAR THE BLADES ARE DRAWN ONE BY ONE, in metres from the walker's own
  // place. E-ERBA-A 6.3 is the reason there is a number here at all: a field
  // with no correlation gives the greedy mesher nothing to merge -- 0.66
  // columns to a quad, measured -- so the mat costs 4.2 triangles a column
  // against the 0.65 the whole ground costs, and at 5 cm over the disc that
  // ships that is a million triangles against a ceiling of sixty thousand.
  //
  // THE NUMBER IS MEASURED AND NOT CHOSEN. D-E2, the coordinator's answer to
  // «fin dove arrivano i fili», is «fidelity as far as the frame holds»: the
  // unit lays the disc at 4, 6 and 8 metres on a loaded machine at the lowest
  // tier and takes the largest that keeps the frame inside 14.0 ms. The table
  // is in the verbale of U-ERBA-1 and the number below is its answer.
  detail: 6,
  // AND THE BLOCK THE MAT IS SAMPLED IN BEYOND THAT RING, in blades, and it is
  // the other half of the same measurement rather than a rounding of it.
  //
  // The ring decides the near field and the block decides EVERYTHING PAST IT,
  // which at the pose the campaign judges on is most of the frame: the band
  // E-ERBA-A reads the mat in -- 7.8 to 9.6 m -- lies outside any ring the frame
  // can afford. Benched the same way as the ring, three mixed rounds at the
  // lowest tier with the whole world standing:
  //
  //     ring/block   frame tri   gpu p50   gpu p90
  //       6 / 6       133 310      9.95     12.50
  //       6 / 4       153 942     10.22     12.28   <- what ships
  //       4 / 3       155 486     10.49     13.89
  //       5 / 3       169 074     10.56     13.87
  //       6 / 3       186 636     11.20     15.75   <- over the gate
  //
  // Four blades is 20 cm, and it is the row that buys the most fidelity for
  // nothing: at the same frame as six blades -- 12.28 against 12.50, which is
  // inside the noise of this bench -- the far field is sampled half again as
  // finely. Three blades is finer still and two arms of it hold the gate, but
  // with 0.13 ms of margin where §2.9 asks for margin, and the third (6/3) fails
  // it outright.
  block: 4,
};

// The law as a ladder, closed once at load rather than summed at every column:
// a blade column is one hash and one walk of six rungs.
const MANTO_LADDER = MANTO.law.reduce((acc, p) => {
  acc.push((acc.length ? acc[acc.length - 1] : 0) + p);
  return acc;
}, []);

// =========================================================================
// THE SUN'S MARCH THROUGH THE MAT, WHICH IS THE SHADOW THE COMMITTENTE ASKED
// FOR (E-DECISIONI9.3) AND THE ONE THING THE STAIR COULD NOT GIVE.
//
// U-ERBA-1 built the stair E-DECISIONI10 G4 relaxed to -- a fall off the height
// above the plane, three instructions, no read -- and priced the baked map at
// 313 kB and one texture read, and did not take it. The reason it is taken now
// is that the picture was then measured three ways and all three say the same
// thing (E-LUCE7 residuo 1): flank over top 0.473 against 0.617, the profile
// inside a face flat to the third figure against 1.122 -> 0.956, and a dark
// family of 5.7% at level 39 where the reference carries 46.9% AT LEVEL 50.
// HALF THE REFERENCE'S GRASS IS ITS OWN INTERNAL SHADOW, and a term that is a
// function of height alone cannot draw a population: it draws the same fall on
// every column, so it moves the whole picture a little and splits it not at all.
//
// WHAT A MARCH IS, AND WHY IT IS THE CHEAP WAY ROUND. The mat is a heightfield
// and the sun is one bearing, so "is this point in shadow" is the oldest
// question a heightfield answers: walk toward the sun a few steps, and take the
// highest thing you find, dropped by how far the beam has climbed to get there.
// The answer is a HEIGHT -- the line between light and shadow on this column --
// and it is the same for every fragment standing on that column, which is why
// it is baked once per blade column at worldgen and not solved per fragment.
//
// IT IS EIGHT STEPS AND THE BOUND IS ARITHMETIC AND NOT A TASTE. A step is one
// blade along the major axis of the bearing; at this seal the beam climbs
// 5.44 cm for each of them. The mat stands five blades at its tallest, which is
// 25 cm -- spent in under five steps -- and what the last three buy is the bank
// of a mound, which is two to five voxels and is the only other thing on this
// lattice tall enough to throw a shadow onto the mat past its own foot. Nine
// steps and beyond can only be bought by a taller world than this one has.
const SUN_MARCH = 8;

// The march itself, closed once at load: for each step, where to look and how
// far the beam has climbed by then.
//
// AND THE MAJOR AXIS IS SOLVED AND NOT ASSUMED. At this seal the bearing is
// almost due west -- 0.985 of x against 0.174 of z -- so a march that stepped
// whole blades along x would be right today and would silently sample every
// other column the day a re-seal turned the sun. Stepping along whichever axis
// is larger keeps every step exactly one blade of the lattice and never skips a
// column, whatever the bearing is.
export const SUN_STEPS = (() => {
  const [sx, sy, sz] = SKY.day.sun.vector;
  const major = Math.max(Math.abs(sx), Math.abs(sz));
  const steps = [];
  for (let k = 1; k <= SUN_MARCH; k++) {
    steps.push({
      di: Math.round(k * sx / major),
      dj: Math.round(k * sz / major),
      // How high the beam stands above this column by then, in SUB-steps of a
      // blade: the step is BLADE / major long on the ground and the beam climbs
      // sy of it, and a SUB-step is BLADE / SUB.
      rise: k * SUB * sy / major,
    });
  }
  return steps;
})();

// How many COLUMNS of skirt a store must carry for that march to stay inside it.
//
// The mesher needs one column -- two blades -- to compare a blade against its
// neighbour across a chunk's edge, and the mat's own note in ./columns.js says
// so. The sun needs as many blades as it marches, or the blades along a chunk's
// upwind edge would be shaded against nothing and every chunk would draw a
// bright seam down its own side. This is that number in columns, and it is the
// only thing in this file that decides how wide a store is.
export const SUN_SKIRT = Math.max(1, Math.ceil(SUN_MARCH / BLADES_PER_VOXEL));

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
    && Math.abs(pathOffset(x, z))
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
 * How tall the blade standing on one column of the sub-lattice is, in blades.
 *
 * ONE HASH AND A WALK OF SIX RUNGS, and it is the whole of the mat's law. There
 * is no seat, no reach and no lean here, and their absence is the measurement
 * rather than a saving: E-ERBA-A 1.4 read the top runs of the target's mat at
 * p50 0.55-0.97 BLADES over four windows from 5 to 15 metres -- «non ci sono
 * ciuffi, non ci sono file, non ci sono terrazze» -- against the plates of turf
 * this replaces, which existed precisely to make runs five to twelve columns
 * long. A field with no correlation draws a run of one 76% of the time, which
 * is that reading; anything with a seat in it draws longer ones.
 *
 * SO THE THING THE SODS WERE BUILT TO DO IS THE THING THE TARGET DOES NOT DO,
 * and the mechanism goes with the reading. What survives of that work is its
 * negative: the 5-12 the guard held was the run of a mat that steps every 6 cm
 * read with the ruler of the TERRAIN, and it is the same measurement in another
 * unit rather than a wrong one (E-ERBA-A 1.4).
 *
 * @param {number} bx  global blade index along x
 * @param {number} bz  global blade index along z
 * @returns {number} 0 for the bare plane, 1 to 5 blades otherwise
 */
export function bladeHeightAt(bx, bz) {
  const r = hash2(bx * 1973 + 7717, bz * 3413 + 15083);
  for (let h = 0; h < MANTO_LADDER.length - 1; h++) if (r < MANTO_LADDER[h]) return h;
  return MANTO_LADDER.length - 1;
}

/** How far a point stands from the edge of the paving, in metres. Negative on it. */
function pathEdgeGap(x, z) {
  if (pathRun(z) <= 0) return Infinity;
  const s = pathOffset(x, z);
  return Math.abs(s) - pathEdge(z, s >= 0 ? 1 : -1);
}

/**
 * HOW THICK AND HOW TALL THE MAT IS AT A POINT, as one number between nought
 * and one.
 *
 * The committente's own field (E-DECISIONI10 G1 and G3), in three terms and no
 * fourth. Every one of them is a MULTIPLIER on the same number, so a point that
 * is both beside the corridor and beside a mass gets the lower of the two
 * rather than an argument between them.
 */
export function mantoVerge(x, z) {
  // THE CORRIDOR, and it is the term the committente named the defect of.
  // Nought at the edge of the stone, one by `reach` metres out, and smooth the
  // whole way: a linear ramp would have a corner at each end and the corner is
  // the thing being removed.
  //
  // AND IT IS A FUNCTION OF ITS OWN, because two callers want THIS and not the
  // whole field: the mat's own thinning, which wants all three terms, and the
  // BROWN of the verge in columnSpec step 3b, which wants the corridor and
  // nothing else. E-SENT3 residuo 1 is what separated them -- see the note
  // there. It is a pure function of the gap to the stone, so where the corridor
  // goes the verge goes with it, in every register it is ever fitted to.
  const gap = pathEdgeGap(x, z);
  if (gap >= MANTO.verge.reach) return 1;
  const t = Math.min(1, Math.max(0, gap / MANTO.verge.reach));
  const smooth = t * t * (3 - 2 * t);
  // FADED WITH THE PAVING ITSELF. Past the last stone there is no corridor to
  // thin the mat beside, so the ramp goes with it rather than leaving a ghost
  // of a path in the grass where the path has ended.
  return 1 - pathRun(z) * (1 - (MANTO.verge.low + (1 - MANTO.verge.low) * smooth));
}

export function mantoIntensity(x, z) {
  // 1. THE CORRIDOR, above, on its own.
  const i = mantoVerge(x, z);

  // 2. THE THINNER PLACES OF THE OPEN MEADOW. A slow field, so what it draws is
  //    a place and not a speckle; the blades' own law is already uncorrelated
  //    and a second uncorrelated term would only be the same draw twice.
  const c = 1 / MANTO.patch.cell;
  let patch = MANTO.patch.low + (1 - MANTO.patch.low) * noise2(x * c + 311.7, z * c + 47.3);

  // 3. AND WHERE IT IS THICKEST. A mass, the hem round one, and the band round
  //    the stone: «piu' alta intensita' vicino alle creste, alle prominenze e
  //    attorno ai monoliti».
  //
  //    IT LIFTS THE SLOW FIELD AND NOT THE CORRIDOR, AND THE ORDER IS THE
  //    MEANING. Written as a floor under the whole answer it would put a mat at
  //    full height against the paving wherever a boulder happened to stand
  //    within a metre and a half of it -- measured, that is where the grass
  //    beside the stone stood four voxels proud where the reference reads one to
  //    two. The two sentences are about two different things: one says where the
  //    mat is thickest in the OPEN MEADOW, the other says how it crosses into
  //    the corridor, and the crossing wins because it is the thing the
  //    committente named the defect of.
  if (patch < 1 && (underMass(x, z) || toStone(x, z).near <= MANTO.halo)) patch = 1;
  return Math.min(1, Math.max(0, i * patch));
}

/**
 * The mat on one column of the sub-lattice, in SUB-steps of a blade.
 *
 * WHY THE UNIT IS A QUARTER OF A BLADE AND NOT A BLADE. E-DECISIONI10 G3 asks
 * for «erba e steli con altezze diverse dai voxel normali -- voxel PIU' BASSI,
 * composizioni piu' minuziose dove serve», so that the mat can thin and thicken
 * «in maniera GRADUALE e giustificata» instead of in steps of a whole blade.
 * The horizontal step does not move -- a blade is 5 cm wide wherever it stands,
 * which is the measurement of E-ERBA-A 1.1 -- and what gains a finer unit is the
 * HEIGHT, which is the axis the gradualness is on.
 *
 * AND IT COSTS NOT ONE TRIANGLE. The mesher merges on the LEVEL of a top; a
 * level counted in quarters of a blade merges exactly as often as one counted
 * in blades wherever the intensity is one, because a quarter times four is a
 * blade. Where the intensity is under one the mat is also thinner, so the
 * columns that would have failed to merge are largely not there at all.
 *
 * @returns {number} 0 where no blade stands, else its height in SUB-steps
 */
export function bladeAtColumn(bx, bz, intensity) {
  // WHICH COLUMNS ARE BARE IS ITS OWN DRAW AND NOT THE HEIGHT'S. Thinning a mat
  // by rounding its shortest blades to nothing would take the SHORT ones away
  // first and leave the tall ones standing alone, which is a mat of spikes; the
  // committente asked for «meno fitta e meno alta», which is two things.
  const cover = MANTO.thin + (1 - MANTO.thin) * intensity;
  if (hash2(bx * 6151 + 401, bz * 769 + 8887) >= cover) return 0;
  const h = bladeHeightAt(bx, bz);
  if (h === 0) return 0;
  const tall = MANTO.short + (1 - MANTO.short) * intensity;
  return Math.max(1, Math.round(h * SUB * tall));
}

/** Where the middle of a blade column stands, in metres. */
export function bladeCentre(bx, bz) {
  return { x: (bx + 0.5) * BLADE, z: (bz + 0.5) * BLADE };
}

/**
 * How tall the mat is at a point, in METRES, and nought where it does not lay.
 *
 * THE DOOR FOR EVERYTHING THAT IS NOT THE MESHER: the flowers have to be set on
 * the top of the blade under them (E-ERBA-A 4, «i fiori stanno su colonne
 * d'erba di altezza diversa»), and asking that question of the mesh would be
 * asking it of a picture. THE WALKER IS NOT ONE OF THESE READERS and must never
 * become one: groundHeightAt is the plane, by the committente's own word
 * (E-DECISIONI9.2, «il camminatore attraversa erba e fiori passandoci
 * attraverso»), and E-ERBA-A 6.7 says why in the body's own numbers -- the mat
 * puts 1 to 5 blades over EVERY column including the mounds, and a step of
 * 0.30 m is already exactly the ceiling the body has.
 */
export function mantoAt(x, z) {
  const bx = Math.floor(x / BLADE);
  const bz = Math.floor(z / BLADE);
  return bladeAtColumn(bx, bz, mantoIntensity(x, z)) * (BLADE / SUB);
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
//   the core     `top` at the floor, `mat` PATH -- PATH.drop is nought
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
  // NOUGHT, AND THE COMMITTENTE SAID SO IN AS MANY WORDS. E-DECISIONI10 S1: «e'
  // a piano col selciato, ma ha TASSELLI che sporgono in maniera diversa -- non
  // voxel completi: tasselli con altezza fino a 1 cm sopra il piano». The
  // corridor is LEVEL with the meadow's floor and what stands proud of it is a
  // centimetre of tile, which is a tenth of a cell and therefore not a cell.
  //
  // WHAT THE ONE WAS, AND WHY IT WENT. It was a measurement, and a sound one:
  // the reference reads its grass one to two voxels over the line the paving
  // falls on (A §1.1 and §1.3), and a corridor level with the floor would put
  // the nearest grass at NOUGHT voxels proud wherever nothing had lifted it. The
  // reading is unchanged and the thing that lifts the grass is no longer the
  // corridor being sunk: E-DECISIONI8 made the grass a MAT of blades standing on
  // the plane, and E-ERBA1 built it -- one to five blades over every meadow
  // column, median two, which is exactly the one to two voxels the reading asks
  // for and is now bought by the blades that are there rather than by a step in
  // the ground under them. Sinking the stone as well would count the same
  // centimetres twice.
  //
  // AND IT GIVES BACK THE APRON'S OWN EXCEPTION. With the corridor a voxel down,
  // the last stretch of it had to be lifted back to the floor or the ground fell
  // 0.3167 m away from the lowest tread of the stair against a body that will
  // not take a step down of more than 0.30 (src/core/player.js) -- so there was
  // a `lift` of one tread, a northing where the drop changed, and a rule in
  // every guard that reads the corridor's height. Level, the step from the
  // lowest tread to the stone is the riser itself, 0.2167 m, which is a step and
  // not a ledge, and the whole of that machinery has nothing left to be the
  // price of. STATE: CAMBIA -- src/world/voxel/worldgen.js:PATH.drop, and
  // `pathDrop` with it.
  drop: 0,
  // The bare earth either side of the stone, in columns per side.
  //
  // TWO TO FOUR, BY POSITION AND NOT ONE NUMBER, which is the committente's own
  // answer (E-DECISIONI7 A3: «orli come misurati dove sono misurati»). The
  // reference gives 0.20-0.35 m a side over the stretch it can be read on
  // (A §1.3) and this unit's own bench reads three columns a side at the near
  // rows. So it is tied to the width: the narrow middle of the field carries
  // the narrow verge and the two wide ends carry the wide one, which is what a
  // band of trodden ground does and what a constant cannot be.
  //
  // AND SINCE U-SENT-2 IT IS NO LONGER A LINE. The verge still writes
  // MATERIAL.EARTH -- the mat of grass stands on earth and not on stone, and
  // that is what those columns are for -- but its TOP is drawn by the paving's
  // own material now (see ./mesher.js), where the share of pieces that are bare
  // ground climbs to one across the same band. So what the eye is given at the
  // crossing is pieces of stone thinning out among pieces of earth, and the
  // column boundary the verge is counted in is not a boundary of anything drawn.
  verge: { min: 2, max: 4, at: 0.5, per: 0.7 },
  // The most the two noises in pathEdge can push an edge past the nominal half
  // width, in metres: 0.105 of wobble and 0.0434 of wander, both at their own
  // full swing. Published so a reader that has to stay CLEAR of the corridor
  // can do it without evaluating either of them.
  wander: 0.105 + 0.0434,
};

/**
 * How far under the meadow's floor the corridor lies at a northing, in voxels.
 *
 * NOUGHT, EVERYWHERE, and it is kept as a function of the northing because the
 * fifteen readers that ask it are asking the right question and the answer is
 * this file's to change. See PATH.drop for why the answer is what it is.
 */
export function pathDrop(z) {
  return PATH.drop;
}

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
  // THE ROW'S TWO ENDS ARE IN EASTING AND THE HALF WIDTHS ARE ACROSS, so the
  // two are not the same number once the axis turns: a corridor of one width
  // crossing a row at an angle covers sec(slope) times as much of that row.
  // Without this the verges would still be counted in whole columns -- the
  // point of solving the ends -- but the corridor they are counted off would
  // pinch at every turn.
  const slope = pathCentreSlope(z);
  const sec = Math.sqrt(1 + slope * slope);
  const left = centre - pathEdge(z, -1) * sec;
  const right = centre + pathEdge(z, 1) * sec;
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
  laid: 0, overlapping: 0, dropped: 0, cells: 0, refused: 0,
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
    // AND THE CORRIDOR NO LONGER MOVES IT, WHICH IS A DECISION AND IS E-SENT3.2.
    //
    // The clearance below is real and it is the LATTICE's: a seat drawn by this
    // world's own arithmetic may not overlap the paving, because the paving is
    // laid first and returns, so a mass that reached it would be CUT by it at
    // whatever height its profile had where the stone began -- the half metre of
    // cliff U-FOND-4 measured on one mound at the west verge.
    //
    // THESE FOUR SEATS ARE NOT DRAWN BY THIS WORLD'S ARITHMETIC. They are read
    // off the reference's own pixels, in the reference's own coordinates, and
    // that is the whole of what FRAMED is for. When U-SENT-3 put the corridor on
    // the target's register the right-hand seat came out 0.48 m inside this
    // clause and was pushed 0.48 m, which is 86 px in frame: the reference draws
    // that mass 1.52 m from its own axis and the clause demands 1.81 (half width
    // 0.795 + wander 0.148 + the mass's long radius 0.865). Two of those three
    // are numbers fitted by other units, so what the push was really doing was
    // moving a DATUM to fit a FIT. E-SENT3 put the fork to the coordinator with
    // those numbers and the answer is this: the reference's seats are data and
    // they do not move; the clause holds for the lattice, where it belongs.
    //
    // What it costs is measured rather than assumed and it is in the verbale of
    // U-ERBA-2: the overlap is counted here, and the worst riser the corridor
    // cuts into that mass is read on the disc that ships.
    const clear = pathHalfWidth(z) + PATH.wander + along;
    const x = f.x;
    if (pathRun(z) > 0 && Math.abs(pathOffset(x, z)) < clear) framedTally.overlapping++;
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
 * @param {number} radius  how far the PLATEAU reaches, in metres
 * @param {boolean} beyond  whether there is ground past the plateau at all.
 *          FALSE is the disc of cubes -- a rim, and air outside it -- and it is
 *          what every greedy reader has always asked for. TRUE is the WORLD:
 *          past the rim the columns keep coming, terraced, out of ./confine.js
 *          (E-DECISIONI13). One law, two reaches, and the two agree column for
 *          column everywhere both of them lay one.
 * @returns {{top: number, mat: number, under: number, depth: number}} the
 *          column, with `top` at NO_COLUMN and `mat` saying why where none
 *          stands
 */
export function columnSpec(ix, iz, grain = true, radius = DISC_RADIUS, beyond = false) {
  const { x, z } = columnCentre(ix, iz);
  const gone = (why) => ({ top: NO_COLUMN, mat: why, under: MATERIAL.AIR, depth: 0 });

  // 2. THE SEATS. The rim of the plateau first, because it is the cheapest test
  //    and because what stands outside it is a different stretch of ground.
  //
  //    AND OUTSIDE IT THERE IS GROUND NOW, WHICH IS THE ONE SENTENCE OF THIS
  //    FUNCTION E-DECISIONI13 REWROTE. It used to be air -- «a column outside
  //    it is not this engine's ground at all» -- because everything past the
  //    disc was a sheet somebody else drew. The sheet is gone: past the rim the
  //    world falls away in terraces towards the water and climbs into the ridge
  //    that closes the horizon, and every one of those is a column of this
  //    store like any other. The `beyond` argument is what lets the greedy disc
  //    keep its rim while the field takes the world, and NOT a second law: both
  //    branches leave through the same door with the same four fields.
  if (Math.hypot(x - CENTRE.x, z - CENTRE.z) > radius) {
    if (!beyond) return gone(MATERIAL.AIR);
    return {
      // The plateau's own floor, plus however many steps the boundary has
      // fallen or climbed. The base is the SAME literal the meadow stands on,
      // so the first terrace is one cube under the last column of the meadow
      // and there is no seam at the rim to measure.
      top: BASE_STEP + confineSteps(x, z, CENTRE),
      mat: MATERIAL.GRASS,
      // AND THE RISERS ARE EARTH, WHICH IS THE TARGET'S OWN READING OF A
      // TERRACE: green treads on brown walls. The mesher already splits a cut
      // wall one voxel from its top and lays that cube as meadow (E-DECISIONI8.3,
      // «due voxel di TERRA + un voxel di PRATO»), so writing the flank as soil
      // here is the whole of what a terraced hillside needs.
      under: MATERIAL.EARTH,
      depth: 1,
    };
  }
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
      // THE MEADOW'S OWN FLOOR: see PATH.drop, which is nought.
      top: top - pathDrop(z),
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
      // AND THE EARTH STOPS ONE VOXEL SHORT OF THE TOP, WHICH IS THE WHOLE OF
      // WHAT THE COMMITTENTE ASKED FOR ON THE MOUNDS.
      //
      // E-DECISIONI8.3, his words: «nel target si vedono circa due voxel di
      // TERRA + un voxel di PRATO; nel dopo tre voxel terra con la faccia
      // superiore del terzo verde». E-ERBA-A 3 put a rule on it: 11 +/- 2 cm of
      // brown under 7 +/- 2 cm of green, in the unit of the BLADE, on a bank
      // 18 cm tall in all.
      //
      // In our step that is one cube of earth under one cube of meadow whose
      // FOUR SIDES are green, and that is what this line writes: the cut runs
      // one voxel shallower than the wall it stands in, so the top cube of a
      // bank keeps the meadow's own flank. The mesher splits the wall at that
      // boundary (see `cap` in ./mesher.js) -- the store has always been able
      // to say it, `cellMaterialAt` reads it back today, and what could not say
      // it was the pass that drew one rectangle for a whole wall.
      //
      // THE QUANTISATION IS DECLARED. The target's is 11 cm of earth and 7 of
      // grass; ours is 10 and 10, because our step is 10 and a bank of two
      // cubes is the size E-ERBA-A 6.6 reads for it («la taglia c'e' gia'»).
      // What moves is which material the top cube's sides are cut in, and that
      // costs no triangle in the store and one in the mesh.
      depth = Math.max(1, moundCutAt(x, z) - 1);
    }
  }

  // 3b. AND THE BROWN OF THE VERGE DOES NOT END AT A COLUMN.
  //
  //    THE DEFECT THE COMMITTENTE NAMED, AND WHY THINNING THE MAT ALONE COULD
  //    NOT CLOSE IT. E-DECISIONI10, nota: «il sentiero sembra piu' largo nel
  //    target per come si interseca al prato e all'erba: da noi ha netti confini
  //    verdi ai margini -- il problema e' il diradamento/infittimento graduale».
  //
  //    The mat thins beside the corridor now, and MEASURED it changed almost
  //    nothing: taking blades away over a floor that is MEADOW uncovers green,
  //    so the share of green pixels at the kerb went 97.9 to 96.7 against the
  //    target's 50.1. What the target puts between its blades there is BROWN --
  //    and it puts it a long way out, thinning as it goes:
  //
  //        from the edge   0.12   0.30   0.55   0.90   1.45   2.4 m
  //        TARGET green    50.1   56.5   60.4   63.0   76.2  75.1 %
  //        before          97.9   99.5   98.5   94.6   92.2  90.3 %
  //
  //    So the band of bare earth beside the stone does not END at its last
  //    column: past it, a share of the columns are still earth, and that share
  //    falls with the same field the mat's own thickness falls with. One number
  //    moves the ground and the grass together, which is what «la terra si
  //    interseca con il prato e l'erba che man mano si infittisce e si alza»
  //    (E-DECISIONI10 S2) is a description of.
  //
  //    AND THE TILES ARE NOT THIS UNIT'S. S1 to S3 ask for the corridor to be
  //    TESSELLATED -- stone and brown earth in tiles standing up to a centimetre
  //    proud, each with its own shade and its own colour, the stone thinning
  //    into the earth instead of stopping. That is U-SENT-2's, on the corridor's
  //    own sub-lattice, and nothing here anticipates it: what this line does is
  //    make the MATERIAL of the ground fade where the mat fades, which is the
  //    half of the crossing the mat cannot do by itself.
  if (mass === 0 && !underMass(x, z)) {
    const gap = pathEdgeGap(x, z);
    if (gap >= 0 && gap < MANTO.verge.reach) {
      // THE SHARE OF EARTH IS WHAT IS MISSING FROM THE INTENSITY, and it has to
      // be written that way round: a threshold on the intensity itself leaves
      // brown standing where the field has already come back to one, which is a
      // second hard edge a metre further out instead of no hard edge at all.
      // Measured before the sign was fixed, the share of bare columns ran
      // 87 / 78 / 56 / 32 per cent over the four bands, where the last one is
      // open meadow and has to be nought.
      // AND IT IS THE CORRIDOR'S RAMP AND NOT THE MEADOW'S FIELD, WHICH IS
      // RESIDUO 1 OF E-SENT3 AND THE REASON THIS LINE MOVED.
      //
      // It used to ask `mantoIntensity`, which is the ramp MULTIPLIED by the
      // slow field of the open meadow -- and that field is a noise in WORLD
      // coordinates. So how much brown stood beside the stone was partly a
      // property of where the corridor happened to run: when U-SENT-3 moved the
      // corridor onto the target's own register, the band 0.35 to 0.85 m out
      // went from 7.9% to 2.3% at the middle distance without a line of this
      // file changing, and the gain U-SENT-2 measured turned out never to have
      // been anchored. The verge is the CORRIDOR's, so it is asked of the
      // corridor: `mantoVerge` is term one of the field on its own, a function
      // of the gap and of nothing else, and the brown now goes where the stone
      // goes.
      if (hash2(ix * 3319 + 55, iz * 7717 + 91) < (1 - mantoVerge(x, z)) * MANTO.ground) {
        under = MATERIAL.EARTH;
        depth = 1;
        return { top, mat: MATERIAL.EARTH, under, depth };
      }
    }
  }

  // 4. AND NOTHING AFTER THE MASSES, WHICH IS THE POINT OF THIS STEP.
  //
  //    A fourth pass used to stand here and raise a column by one voxel where a
  //    plate of turf lay over it. It is gone, and E-DECISIONI8 is why: the
  //    plates were a reading of the target's BLADES as terrain, and the terrain
  //    of the target is one level. What the plates were fitted to is the mat,
  //    which is not a height of this column at all -- it stands ON the column,
  //    in a step of its own, and ./columns.js keeps it in an array of its own.
  //
  //    So `grain` no longer reaches this function's answer, and the argument is
  //    kept because it has not stopped meaning what it meant: it says whether
  //    the SECOND LAYER is part of the world, and the layer it switches is the
  //    mat now. guard-piano's bare arm and guard-grana's off arm both ask for
  //    exactly what they asked for before -- the plane and the masses set on
  //    it, with nothing grown over them.

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
export function columnTop(ix, iz, grain = true, radius = DISC_RADIUS, beyond = false) {
  const spec = columnSpec(ix, iz, grain, radius, beyond);
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
export function chunkColumns(
  cx, cz, n, grain = true, radius = DISC_RADIUS, focus = CENTRE, beyond = false,
) {
  // THE SKIRT IS AS WIDE AS THE SUN MARCHES, AND ONLY WHEN THE SUN MARCHES.
  //
  // See SUN_SKIRT above: a chunk that could not look upwind past its own edge
  // would shade its upwind blades against nothing and draw a bright seam down
  // its own side. But that is the MAT's need, and a caller that does not ask for
  // the mat is not asking for its shadow either -- the walker's floor is one of
  // those, and it cuts a tile of sixteen columns dozens of times a lap
  // (src/world/contracts.js). For it the skirt is the one column the mesher's
  // own comparison across an edge needs, and the tile stays the 18 x 18 it has
  // always been instead of becoming 24 x 24 for a mat nobody reads.
  const skirt = grain ? SUN_SKIRT : 1;
  const span = n + 2 * skirt;
  const store = createColumns(cx * n - skirt, cz * n - skirt, span, span);
  for (let j = 0; j < span; j++) {
    for (let i = 0; i < span; i++) {
      const ix = store.ox + i;
      const iz = store.oz + j;
      const spec = columnSpec(ix, iz, grain, radius, beyond);
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
  if (grain) layMat(store, focus);
  return store;
}

/**
 * The fourth pass: the mat of grass, laid over the tops the three before it left.
 *
 * IT ASKS THE STORE AND NOT THE LAW, which is what makes «erba anche sui cumuli»
 * cost nothing. A blade stands wherever the column under it is MEADOW -- the
 * plane, the crown of a mound, the flank's own grass cap -- and stands nowhere
 * the column under it is stone or the bare earth of the corridor's verge. This
 * pass never asks where a mound is, because the pass that put the mound there
 * already wrote the answer down.
 *
 * AND THE SHAPE HAS A LOD, WHICH IS THE ONE LEVER THIS COSTS ANYTHING ON.
 * E-ERBA-A 6.3 measured the price: a field with no correlation between its
 * neighbours gives the greedy mesher NOTHING to merge -- 0.66 columns to a
 * quad -- so the mat costs 4.2 triangles a column against the 0.65 the whole
 * ground costs today, and at 5 cm over the disc that ships it is a million
 * triangles against a ceiling of sixty thousand.
 *
 * So the blades are drawn one by one where the eye resolves one -- a blade is
 * 15 px at 5 m and 5 px at 14 -- and in BLOCKS where it does not: an N by N
 * patch of the sub-lattice sharing one height, which is one prism to the
 * mesher instead of N squared. The shape of the mat is the same law either
 * way; what changes is how finely it is sampled.
 */
function layMat(store, focus) {
  const b = BLADES_PER_VOXEL;
  const bw = store.w * b;
  const bd = store.d * b;
  const bx0 = store.ox * b;
  const bz0 = store.oz * b;
  // HOW FAR THE RING REACHES IS THE FOCUS'S AND NOT ONLY THE DIAL'S, and it is
  // the same shape of handle `radius` already is: a number the page can be
  // MEASURED at before it is written into a constant. What ships is MANTO's.
  const reach = focus.detail ?? MANTO.detail;
  const detail = reach * reach;
  const block = focus.block ?? MANTO.block;
  // AND THE MAT AS THE LAW WOULD HAVE DRAWN IT, WHICH IS NOT ALWAYS THE MAT
  // THIS PASS LAYS, AND IS WHAT THE SUN IS MARCHED THROUGH.
  //
  // Beyond the ring a block of N by N blades stands at one height, because that
  // is the only lever the triangle budget has (see the note over MANTO.block).
  // What that costs is not fidelity of SHAPE alone: a plateau of four blades has
  // no blade taller than itself within four blades, so nothing on it can shade
  // anything, and the far field -- which at the pose the campaign judges on is
  // most of the frame -- loses its shadow along with its steps.
  //
  // The shadow is a TEXTURE and not triangles, so it does not have to pay that
  // lever. The march below walks the mat the LAW draws, at the blade, wherever
  // the geometry stands; what the eye then gets on a plateau is the light and
  // shade of the blades that would have been there, which is the high frequency
  // the budget took away, handed back for one hash a column and no triangle. It
  // is declared as exactly that in the verbale, and it is not an invention: the
  // law is the same one the near field is drawn from.
  const fine = new Uint8Array(bw * bd);
  for (let j = 0; j < bd; j++) {
    for (let i = 0; i < bw; i++) {
      const bx = bx0 + i;
      const bz = bz0 + j;
      // The column under this blade, and the one question asked of it.
      //
      // THE MAT LAYS ON MEADOW AND ON THE BARE EARTH OF THE VERGE, AND ON
      // NOTHING ELSE. Grass is the plane, the crown of a mound and the cap of
      // its bank; earth is the two to four columns the corridor writes either
      // side of its stone. Letting it onto the second is what takes the «netto
      // confine verde» out of the picture -- see MANTO.onVerge -- and the field
      // of intensity is what makes the crossing gradual rather than a change of
      // material. The stone carries none: the tiles are U-SENT-2's.
      const k = ((bz >> 1) - store.oz) * store.w + ((bx >> 1) - store.ox);
      const on = store.mat[k];
      if (store.top[k] === NO_COLUMN) continue;
      if (on !== MATERIAL.GRASS && !(MANTO.onVerge && on === MATERIAL.EARTH)) continue;
      const x = (bx + 0.5) * BLADE;
      const z = (bz + 0.5) * BLADE;
      const near = (x - focus.x) * (x - focus.x) + (z - focus.z) * (z - focus.z) <= detail;
      // Beyond the ring the whole block answers with its own first blade, so a
      // patch of N by N stands at one height and the mesher merges it.
      const ax = near ? bx : Math.floor(bx / block) * block;
      const az = near ? bz : Math.floor(bz / block) * block;
      // The field of intensity is asked ONCE and both answers take it: it is
      // the expensive half of this loop -- a noise, a mass and the stone -- and
      // the two heights differ only in WHICH blade column the law is drawn at.
      const i0 = mantoIntensity(x, z);
      const h = bladeAtColumn(ax, az, i0);
      store.blade[j * bw + i] = h;
      fine[j * bw + i] = near ? h : bladeAtColumn(bx, bz, i0);
      // AND HOW WIDE IT STANDS, WHICH IS DRAWN ONLY WHERE IT IS FREE (MANTO.slim)
      // AND ONLY WHERE THE BLADE IS DRAWN ONE BY ONE. Inside a block of the LOD
      // the mesher is merging a patch of blades into one rectangle on purpose;
      // insetting them there would be paying the block's whole saving back to
      // undo the block.
      if (h && near && i0 < MANTO.slim.below) {
        const r = hash2(bx * 2699 + 131, bz * 5077 + 617);
        const w = MANTO.slim.low
          + Math.min(MANTO.slim.high - MANTO.slim.low,
            Math.floor(r * (MANTO.slim.high - MANTO.slim.low + 1)));
        if (w < MANTO.slim.high) store.slim[j * bw + i] = w;
      }
    }
  }
  bakeShade(store, fine);
}

/**
 * The fifth pass: where the sun stops reaching the mat, one byte a blade column.
 *
 * THE SHADOW E-DECISIONI9.3 ASKED FOR, AND IT IS A MARCH AND NOT A RENDER. See
 * SUN_MARCH above for why it exists at all and why it is eight steps; this is
 * the loop.
 *
 * IT RUNS AFTER THE MAT AND NOT INSIDE IT, and that is not tidiness: a blade
 * needs the heights of the blades UPWIND of it, and inside the laying loop half
 * of those have not been laid yet. Two passes over one array is the cheapest
 * shape this can have, and the second one touches nothing but bytes.
 *
 * EVERY HEIGHT IN HERE IS AN INTEGER OF ONE UNIT -- a SUB-step of a blade above
 * y = 0 -- and that is what keeps the whole march whole-number arithmetic: the
 * floor of a column is (top + 1) voxels, a voxel is SUB * BLADES_PER_VOXEL
 * SUB-steps, and the mat's own height is already kept in them. The one number
 * that is not an integer is how far the beam has climbed, and it is floored once
 * at the end rather than at every step.
 *
 * AND WHAT IT ASKS OF A COLUMN IS ITS TOP AND NOT ITS FAMILY. A mound's bank, a
 * paving stone and a blade of grass all block the sun the same way, so what the
 * march takes is the highest thing standing on the column it looks at, mat
 * included. Where no column stands at all -- the rim of the disc, the corridor's
 * own hole before the paving fills it -- there is nothing to cast and the step
 * passes.
 *
 * @param {Uint8Array} fine the mat as the LAW draws it, blade by blade, which
 *                          beyond the ring is not the mat that is MESHED: see
 *                          the note in layMat for why the sun walks the first
 *                          and the triangles are cut from the second.
 */
function bakeShade(store, fine) {
  const b = BLADES_PER_VOXEL;
  const bw = store.w * b;
  const bd = store.d * b;
  // How many SUB-steps of a blade one voxel of the world is worth.
  const rung = b * SUB;
  // The top of the ground under a blade column, in SUB-steps above y = 0, or
  // -1 where no column stands under it.
  const floorOf = (i, j) => {
    const t = store.top[((j >> 1)) * store.w + (i >> 1)];
    return t === NO_COLUMN ? -1 : (t + 1) * rung;
  };
  const cap = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let j = 0; j < bd; j++) {
    for (let i = 0; i < bw; i++) {
      const f = floorOf(i, j);
      if (f < 0) continue;
      // Both lines start at the floor, which is the honest starting answer and
      // also the one an empty world gives: the sun reaches down to the ground
      // and there is no canopy over it.
      let sun = f;
      let canopy = f;
      for (const s of SUN_STEPS) {
        const ai = i + s.di;
        const aj = j + s.dj;
        // OFF THE STORE IS "NOTHING THERE" AND NOT "STOP", because a store's
        // edge is an edge of THIS pass and not of the world: inside the disc the
        // skirt is as wide as the march, so this only ever happens in the skirt
        // itself, whose own bytes nobody reads.
        if (ai < 0 || aj < 0 || ai >= bw || aj >= bd) continue;
        const g = floorOf(ai, aj);
        if (g < 0) continue;
        const top = g + fine[aj * bw + ai];
        // THE SUN'S LINE: the neighbour's top dropped by how far the beam has
        // climbed to get here. It moves when the sun moves.
        const h = top - s.rise;
        if (h > sun) sun = h;
      }
      // AND THE SECOND LINE IS THIS COLUMN'S OWN CANOPY: the top of the blade
      // the LAW puts here, which beyond the ring is NOT the top of the blade the
      // mesher draws.
      //
      // It carries two things at once and both are the same sentence -- the
      // light of a place is the light of the mat that is really there.
      //
      //   * THE FALL E-ERBA-A 1.6 MEASURED, against the variable its own
      //     instrument uses. That instrument reads the profile INSIDE a face,
      //     from its top down to its foot, and it separates tall faces (dark at
      //     the foot) from short ones (not dark at all) -- which is exactly
      //     "how far below the top of this blade" and not "how high above the
      //     plane". U-ERBA-1 wrote the second because on a plane with a closed
      //     mat the two agree; they part on a mound, and the second was declared
      //     an approximation there. This is the first, so there is nothing left
      //     to approximate.
      //   * AND THE LOD'S OWN ERROR, PAID BACK IN LIGHT INSTEAD OF TRIANGLES.
      //     Beyond the ring a block of blades is drawn at one height because the
      //     frame cannot afford the steps; the light does not have to be raised
      //     with the surface. A fragment standing above the blade the law puts
      //     under it is lit as that blade's top is lit -- in sun or in shade,
      //     and with the fall of its own depth -- so the plateau carries the
      //     light and shade of the mat it stands for, at the blade, for one
      //     hash a column and not one triangle.
      canopy = f + fine[j * bw + i];
      // Floored and not rounded: a line half a quarter-blade high is a line the
      // quarter-blade below it is still lit at, and rounding up would darken a
      // cube the sun does reach.
      store.shade[j * bw + i] = cap(Math.floor(sun));
      store.sky[j * bw + i] = cap(Math.floor(canopy));
    }
  }
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
