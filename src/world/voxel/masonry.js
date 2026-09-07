import {
  BufferAttribute, BufferGeometry, DataTexture, LinearMipmapLinearFilter, Mesh,
  RGFormat, RepeatWrapping, ShaderMaterial, UnsignedByteType, Vector2, Vector3,
} from 'three';
import {
  SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS, SKY_GLSL, SKY_REFLECTION,
  SKY_REFLECTION_GLSL, SKY_UNIFORMS,
} from '../../core/sky.js';
import { FOG_GLSL, LOW_SKY, fogUniforms } from '../air.js';
import { faceLightGlsl, faceLightUniforms } from '../face-light.js';
import { MONOLITHS } from '../layout.js';
import { buildMasonry, masonryLaw } from './courses.js';

// The block, built as masonry instead of delivered as a mesh.
//
// This is the half of the pivot that has nothing to do with the meadow: a
// monolith stops being a baked model and becomes courses of blocks generated
// from the plan in src/world/layout.js, which is where the collapse in the cost
// of iteration actually comes from. The plan is read and not copied — the size,
// the placement and the turn come from it — so this block stands exactly where
// the reference fit put it and its head is on the same pixels.
//
// WHAT IT IS HERE TO PROVE, above everything else: that
// src/world/engraving.js survives the pivot with NOT ONE LINE CHANGED. The
// writing is laid in METRES OF STONE — the projection below is the same
// arithmetic src/world/monoliths.js uses, off the block's own centre and its
// own two axes — so it cannot tell whether the surface under it is a baked mesh
// or a wall of generated courses. Arguing that would have been cheaper than
// proving it and worth far less.
//
// AND THE RULE ABOUT VERTICES BINDS HERE AFTER ALL, which is a correction to
// what this file used to say. It used to argue that nothing in this mesh was
// merged, so a per-block coordinate in a vertex cost no merge — true of the
// mesh it described, and an exemption bought by the defect rather than by a
// measurement. The mesh IS merged now: the faces of one course of one wall are
// one rectangle, and a rectangle that stands for eleven blocks cannot carry
// which of the eleven a corner belongs to. So the geometry hands over
// POSITIONS, NORMALS AND INDICES and nothing else, and everything that varies
// per block — which block this is, where in it we stand, how the tile lies, what
// tint it took — is rebuilt below out of the fragment's own position. It is the
// same architecture as the meadow's, for the same reason, and the price of the
// exemption was measured before it was given up: 9,720 cell faces come back as
// 1,486 rectangles.

const DEG = Math.PI / 180;

// AND THE NUMBERS BELOW ARE EXPORTED, WHICH IS NEW AND IS THE SEAT BEING NAMED
// RATHER THAN MOVED. Nothing here changed value: what changed is that the ROCKS
// of this world are stone now too — piles of cubes on the same lattice, drawn
// by src/world/rocks.js — and every one of these is a number some reading of
// the targets was taken against. A second copy of one in the rock material
// would be two answers about one material, which is the defect this file
// already spent its first paragraph on when the engraved cyan was copied into
// src/world/monoliths.js. One stone, one seat.
//
// The rocks do NOT take the wall's shape: no courses, no wander, no head. They
// take its PIGMENT, its grain, its joint, its dressed edge, its sky and its
// exposure — the things a material is — and their own law for the rest.

// The stone's own colour and how hard the tile bites it.
//
// THE PIGMENT IS 2.4 TIMES WHAT THE PIVOT DELIVERED, and the reason is the same
// reason it had already come up by three and a half times before that: at a
// dark albedo the GRAZING TERM is most of what a face hands back, so the stone
// was not merely dark, it was a picture of sky in stone rather than stone. The
// value below is the recipe's own reading of the target's lit stone carried
// into linear pigment, and it is the half of the refit that puts the material
// back inside the material.
//
// AND THE TRIPLET IS DIVIDED BY WHAT THE RENDER ACTUALLY SHOWED, which is a
// correction to the delivered number and not a disagreement with the fit. The
// fit reads the pigment as albedo x gain x exposure and quotes 0.62 as the
// gain; the gain in this shader is not a multiplier — it is the depth of the
// tile's modulation, `1 + uGain * (tile - 0.5)`, whose mean is one — so the
// triplet arrived here already multiplied by a factor the shader then did not
// apply. Measured face by face against the day target through one estimator
// (v2-pietra/dev2b/materia.mjs, and the numbers are in its output): 04-front
// read 96.0 / 114.9 / 126.4 against the target's 77.3 / 90.7 / 95.0, and
// 05-front 76.3 / 93.9 / 102.3 against 62.6 / 74.8 / 74.9 — 1.23, 1.26 and 1.35
// times over, agreeing between the two faces to a few per cent. Divided by
// those three the stone is the target's stone, and the blue that came off with
// them was the third of the excess that made it read as sky.
// AND IT IS GREY NOW, WHICH IS THE CORRECTION AND NOT A TASTE.
//
// The triplet above was 0.276 / 0.321 / 0.230 -- green dominant, g over r 1.16
// -- and it is what made the six read "greenish grey" to the eye that judged
// them. The target does not: measured through one estimator on the faces this
// camera can identify (R5 SS1.3), its LIT stone is NEUTRAL. The west flank of 01
// reads 70 / 76 / 69 in eight bits, hue 142, chroma 5.6; the lit front of 05
// reads hue 190 at chroma 5.2. A stone whose own pigment is green cannot
// develop to chroma five under any light, so the green was ours.
//
// The level goes with it. Divided down to the triple below the developed face
// lands inside the target's own band for its orientation -- shadow faces at
// L* 12 to 16, lit faces at 26 to 32 -- through tools/lighting/render-chain.mjs,
// which is the chain the guards judge the light with and the one
// tools/guards/guard-pietra.mjs re-derives this from at every commit.
//
// AND THE GAIN COMES DOWN WITH THE TILE. 0.62 was the depth of a modulation
// whose largest feature was two blocks wide; at 0.10 m and under, the same
// depth reads as noise on the stone rather than as shape in it. 0.45 is what
// the sweep behind R5 SS3 (S2) ran at and what the crops were taken with.
export const STONE_ALBEDO = [0.230, 0.232, 0.215];
export const STONE_GAIN = 0.45;

// Reflectance of the stone face on, how much of the sky the grazing term
// carries, and how sharply it is confined to the very edge.
//
// AND THE GRAZING GAIN COMES DOWN BY TWELVE TIMES, which is the other half of
// the refit and the number this file used to say it owed. 5.9 was FITTED
// against five baked flanks whose grazing angle sweeps across a curved surface:
// on a curved flank only a sliver is ever near ninety degrees, so a large gain
// buys a bright rim and nothing else. A wall of FLAT faces presents ONE angle
// over a whole face, so the same 5.9 lights the entire face at that angle and
// the stone reads as sky. Half is what a flat face can carry at the eighth
// power, and the term is not deleted: at the true grazing edge — the flanks
// seen at seventy-seven degrees, which is where the reference's bright rim
// actually is — it is still the whole of the effect.
// AND THE NODE TAKEN IS THE BEST NODE OF THE GRID AND NOT THE TOP OF THE BAND.
// The sweep over eight exponents and four gains costs 12.97 at RIM nought for
// every exponent and 12.83 at its best node — POWER 4, RIM 0.125, F0 0.0057 —
// which is one per cent, and the historic 5.9 costs 35.17. Half at the eighth
// power was the CEILING the mandate allows; this is what the fit actually
// prefers, and on a wall of flat faces the difference between the two is a
// blue wash over every face turned even slightly away.
// AND BOTH ARE NOUGHT NOW: THIS STONE IS OPAQUE.
//
// Not a retreat from the fit above -- a reading that the fit had no way to
// take. At the framing this world is judged at, the reference shows NO specular
// on stone at all (C SS1.3, Q2: at rest the two are indistinguishable), and what
// the term actually buys is measured on the ROCKS, which are the only stone
// this camera sees from above and at a graze: it carries up to twelve per cent
// of the sky onto their tops, and that is why the render reads them at hue 122
// where the target reads 95 -- a beige cap with a blue wash on it. The wall
// pays the same in kind if less in degree, on every face turned away from the
// eye.
//
// So the whole grazing term is set aside, with its exponent left standing so
// that the shape of it survives the decision. It is D-R5-4 of the research,
// answered at its default (A, opaque); if the committente wants the veil back
// it comes back as a veil that lights when you WALK -- exponent near eighty,
// F0 0.04 -- and not as a wash that stands on a still frame.
//
// The two numbers the fit produced are kept here in the open, because a term
// deleted without its measurement is a term nobody can put back: F0 0.0057 and
// RIM 0.125 at power 4 were the best node of a sweep over eight exponents and
// four gains (12.83 against 12.97 at nought -- one per cent), and the historic
// 5.9 cost 35.17.
export const STONE_F0 = 0.0;
export const STONE_RIM = 0.0;
export const STONE_RIM_POWER = 4.0;
export const SKY_BLUR = 3.0;

// HOW FAR THE TINT OF ONE BLOCK MAY STAND FROM ITS NEIGHBOUR'S. This is the
// sixty per cent of what makes a wall read as laid rather than printed, and it
// costs a hash: the targets read 26 to 33% of spread between the means of
// neighbouring blocks on one face, against nothing at all in a wall drawn from
// one albedo and a tile.
//
// IT IS A CEILING AND NOT A PREFERENCE, by the same rule the meadow's tint is:
// past about here the multiplier reaches through nought at one end while the
// tone curve flattens the other, and what the render measures stops moving. The
// gap between what is asked for and what a render can show is stated in the
// verbale rather than closed by turning this up.
//
// AND THE FRONTIER IS MEASURED RATHER THAN ASSERTED, because D2 says a ceiling
// that bites has to be shown biting. At 1.0 the multiplier spans 0.5 to 1.5 and
// the render reads 12.3% of spread between neighbouring block means against the
// 22.2% the same estimator reads on the target. 1.4 spans 0.30 to 1.70 — the
// widest this can go before a block is drawn at under a third of its
// neighbour's pigment, which is a hole in a wall and not a paler block. What
// that buys is in the verbale beside what it does not.
//
// AND IT COMES DOWN BY THREE TIMES, WHICH IS THE OTHER HALF OF THE CAMOUFLAGE.
//
// The two estimators above ("26 to 33%", "22.2%") counted moss, arris and the
// halo of the engraving along with the stone, and 1.4 was fitted to them. Run
// on BOTH images with one estimator that excludes all three (R5 SS1.3), the
// spread inside a face reads p10-p90 of L* 10 to 17 on the target and 11 to 36
// on the render: the tint is not sixty per cent short, it is three times over.
// At 1.4 the multiplier spans 0.30 to 1.70, which is not a paler block beside a
// darker one -- it is a hole in a wall.
//
// 0.45 spans 0.775 to 1.225, and it is the value R5's prototype was measured
// at: the wall still reads as laid, the course line comes back (the target's
// own autocorrelation at the course is 0.48 and the render had no peak at all),
// and the dispersion inside a shadow face lands inside the target's band.
export const STONE_TINT = 0.45;

// The joint between blocks, as the campaign's own estimator reads it on stone:
// 0.949 to 0.959 of the face beside it, over two or three pixels. It is the
// same six per cent over the same one or two pixels the meadow carries, which
// is the finding — the joint fitted on grass holds on stone without a change.
//
// AND IT IS THE STONE'S OWN JOINT NOW AND NOT THE GRASS'S. The finding above
// held while the tint was three times too wide: with a block drawn anywhere
// between 0.30 and 1.70 of its neighbour there was nothing for a six per cent
// line to do. With the tint at 0.45 the joint is what has to carry the lattice,
// and the target carries it plainly -- the course reads at 12 to 13 px with an
// autocorrelation of 0.48 on the clean flank of 05, which a line six per cent
// deep over one and a half pixels does not produce. 0.14 over two pixels is
// what R5's prototype was measured at and what brought the course peak back.
export const STONE_JOINT = 0.14;
export const STONE_JOINT_PIXELS = 2.0;

// And the dressed edge, at the 1.072 to 1.091 four windows of stone measure —
// the same brightness as the recipe's on grass and a different colour, about
// twice the blue. Both come out of the facet rather than being painted: what is
// set here is only how wide the vertical one is allowed to be on screen, since
// the horizontal one is real geometry and has no width to set.
export const STONE_ARRIS = 1.0;
export const STONE_ARRIS_PIXELS = 2.2;

// AND THE DRESSED EDGE IS A MATERIAL AS WELL AS A SHAPE. THE FACET IS NOT
// TOUCHED AND NEITHER IS THE LAW OF THE LIGHT.
//
// A cut edge on weathered stone is freshly broken face — denser, less bleached,
// darker than the weathered flat it was cut from — so a pigment belongs on it,
// by the same doctrine as painted occlusion: the material carries what the
// material knows, and the light stays whoever's it is.
//
// FITTED AND NOT ARGUED, against the day target through one estimator
// (v2-pietra/dev2b/materia.mjs, run on the target and on the render with the
// same lines) on the two lit fronts it resolves cleanly. 04 reads 1.244 on the
// target and 05 reads 1.163; the render's pair runs 1.309 at one, 1.250 at
// 0.85, 1.223 at 0.75, 1.174 at 0.63 and 1.118 at 0.5, so the pair lands on the
// target's 1.204 at the value below. 01 is left out of the fit and not out of
// the verbale: it is the face the target reads 12.3% mossy, its arris comes
// back 0.718 there — under one, which a median of maxima cannot mean — and
// fitting to a reading that broken would be fitting to the moss.
//
// AND IT IS NOT WHAT CURED THE BRIGHT COURSE LINES, which is worth saying here
// because the number is close enough to the one the diagnosis predicted to look
// like a confirmation of it. It is not: the lines were a HOLE in the skin, they
// are cured in src/world/voxel/courses.js where the hole is, and the sweep that
// ruled the material out is written there. This is the material being right
// about itself, measured after the hole was closed.
//
// AND THE NIGHT SCALES WITH IT, stated because it cannot be checked here: the
// night thread of the recipe is the same dressed edge seen by the same
// material, so it comes down by this same factor in the same proportion. There
// is no night seat in this world yet — it is V7's — so this is an implication
// written down, not a reading taken.
//
// AND THE SIGN OF IT IS WRONG, WHICH THE SAME ESTIMATOR SAYS WHEN IT IS RUN ON
// BOTH IMAGES INSTEAD OF ON THE RENDER ALONE. The fit above read 1.244 and
// 1.163 on the target's two lit fronts -- those are ratios ABOVE one, which is
// a dressed edge LIGHTER than the flat beside it, and 0.70 draws it darker. The
// arris of the reference is a fresh break catching the sky on a weathered face,
// not a shadow: assets-src/monoliths/masonry-spec.json carries it as
// chamfer.lighten and reads it at 1.07 to 1.09 over four windows of stone.
//
// So the pigment stands just above one and the brightness is left to the facet,
// which is where it belongs: the edge is lit as the geometry it is, and the
// material only says that a broken face is not a bleached one.
export const STONE_ARRIS_PIGMENT = 1.05;

// HOW MUCH PALER THE TOP COURSE OF A WALL IS THAN THE STONE UNDER IT, and over
// how many courses it comes back.
//
// A weathering fact and a reading, not a taste: assets-src/monoliths/
// masonry-spec.json carries head.paleTopCourse, which is the top course against
// the courses three down ON THE SAME FACE, over six faces. The median of those
// six is what is used, and the band is declared rather than averaged away,
// because one law over one wall cannot be both ends of it. The fade is the
// measurement's own baseline and not a shape chosen to look right — the reading
// compares the top course TO THE COURSES THREE DOWN, so three courses is where
// it has to be back to one.
//
// AND THE MEDIAN BELOW IS THE ERRATA'S AND NOT THE FIRST READING'S. The spec
// used to take its band under the lid of the BOX layout.js declares and now
// takes it under the stone the picture actually DRAWS — the two differ by up to
// 0.435 m, and on 04 a third of the old band was sky, which is the whole of the
// 2.370 it used to publish. The six are 1.051, 1.161, 1.119, 1.103, 1.096 and
// 1.008: median 1.103, band [1.008, 1.161]. The old median was 1.175 and this
// file shipped it.
//
// THE RETUNE IS SMALL AND IS STATED RATHER THAN QUIETLY TAKEN: 1.175 to 1.103
// is 6% of an effect this estimator cannot separate from face to face at the
// seat anyway — the render moves 0.028 over the whole sweep against a
// face-to-face scatter of 0.15 — so what changes on screen is under the noise
// of the reading. What changes in the ledger is that the constant and the spec
// state the same number again.
const STONE_PALE_TOP = 1.103;
const STONE_PALE_COURSES = 3.0;

// The most head levels this world's masonry is cut into, which is the stair's
// six treads; the six blocks run to five. It is a fixed size because a uniform
// array has to be one, and it is stated here so that a head deeper than this
// is a thing somebody has to come and change rather than a thing that quietly
// paints the wrong course pale at the far end of a wall.
const MAX_HEAD_RUNS = 8;

// ------------------------------------------------------------------ the moss
//
// THE LAW OF IT, AS THE TARGETS GIVE IT, and every one of the four numbers is a
// reading rather than a taste (v2-pietra/an/out/muschio.txt, section 2 to 4):
//
//   - it is on the LIT faces and not the dark ones, by 5.5 to 1. That is the
//     opposite of what a first guess says about moss and it is what the picture
//     shows, on eight faces, at every threshold the sweep tried.
//   - it is BIMODAL up a face: 2.7% in the second tenth, 0.8% in the middle,
//     2.6% in the top tenth. Wet at the foot and weathered at the head.
//   - it is on the VERTICAL EDGES: 4.6% within one course of an edge against
//     0.5% five courses in, which is a factor of nine.
//   - and it is a PIGMENT and never a light. At night the target's moss goes
//     dark with the stone it is on; anything drawn as an emissive would come up
//     out of a night frame as the one green thing in it.
// THE THREE ARE RATIOS AND NOT MULTIPLIERS, and telling those apart is the
// whole of what this law had wrong. 5.5, 9 and 2.6 are what one CONDITION
// reads against another — a lit face against a dark one, a corner against a
// centre, an end of a face against its belly — and multiplying all three onto
// a coverage gave 0.14 x 5.5 x 9 x 2.6, which is eighteen: every face came out
// green to the clamp. Measured on the render it read 12.6% of moss against the
// target's 6.1% under the same estimator, and by eye the stone was moss with
// stone in it.
//
// So each factor is carried with a MEAN OF ONE over the face it applies to,
// and the coverage below is what the pooled reading actually is on a lit face.
// The ratios are then exactly the ratios the targets give, and the level is
// the level they give, which two multiplied factors cannot both be.
// AND THE LAW IS RE-READ FACE BY FACE, WHICH MOVED EVERY ONE OF THOSE FOUR.
//
// The readings above were pooled over windows of stone. Read instead on the
// faces this camera can identify, one estimator on both images (R5 SS1.5), the
// reference says something the pooled numbers could not:
//
//   - it is not five and a half times as much on a lit face. The lit west flank
//     of 01 carries 17.9% and its shadowed front 1.4%, but the SHADOWED east
//     flank of 04 carries 17.0% and the LIT front of 05 carries 3.7%. What
//     separates them is not the sun, it is the FOOT and the NARROW FACE.
//   - it is not bimodal about the belly, it CLIMBS TO THE GROUND. On the west
//     flank of 01 the tenths from head to foot read 0 / 3 / 5 / 2 / 7 / 14 / 21
//     / 16 / 31 / 71 per cent. That is a colonnade of runs coming down the wall,
//     not a band at either end.
//   - the corner term survives, at a third of its old strength: 2.7 / 2.7 / 2.4
//     / 1.1 / 0.0 per cent at nought to one, one to two, two to three, three to
//     five and past five courses from a vertical edge, on the front of 01.
//   - and the PATCH is a sixth of what it was. In the reference the moss sits in
//     tufts of one to three pixels at the corners of blocks; ours was drawn at
//     0.42 m, a block and a half, so it arrived as whole blocks painted green.
//     Measured: 36.0% of the front of 05 against the target's 3.7%, uniform from
//     head to foot.
//
// So the law is written the way the tenths are written: a level, a lit ratio, a
// foot, a head, a corner, and one term for the narrow flanks that face west,
// which is where the reference puts its large moss and the only one of the six
// that is proposed rather than measured (R5 SS3, S3, and the residual is
// declared there).
const MOSS_SHADE = 0.30;
// How far a corner reaches, in courses, and how much it adds at the corner
// itself: 2.7% within a course of a vertical edge against 0.0% past five.
const MOSS_EDGE_REACH = 1.2;
const MOSS_EDGE_GAIN = 0.6;
// Wet at the foot and weathered at the head, and the foot is six times the
// middle where the head is not quite twice it.
const MOSS_FOOT = 5.0;
const MOSS_FOOT_RISE = 0.45;
const MOSS_HEAD = 0.8;
// AND THE NARROW FLANKS THAT FACE WEST, which is the one term of the six that
// no reading of ours produced: the reference carries 17.9% on the 1.48 m west
// flank of 01 and 21.9% on the 1.10 m one of 02, both climbing to the foot,
// against 1 to 4% on every wide front. It is held to faces under about two
// metres across so that it cannot reach the fronts of 04 and 05, which face
// west as well and carry 9.5% and 3.7%.
const MOSS_WEST = 5.0;
// And which faces count as facing west, as a band on the world normal rather
// than a threshold: 0.42 of west is the flank of 01, 0.87 is the flank of 02,
// and both are mossy. A hard cut at 0.7 -- which is where the research put it
// -- takes 01 out, and 01 is the face the reading was taken on.
const MOSS_WEST_FROM = 0.15;
const MOSS_WEST_TO = 0.42;
// And how far up the wall the flank term reaches: the reference's own tenths on
// the west flank of 01 are still at 5% three tenths down from the head.
const MOSS_WEST_RISE = 0.80;
// How much of a LIT face is moss, pooled, and how coarse a patch of it is in
// metres. The scale is a block, which is what the crops show — moss sits on
// blocks and not across them.
//
// THE SIX PER CENT IS THE READING AND THIS IS NOT SIX PER CENT, and the gap
// between the two is arithmetic rather than a fudge. The three factors above
// average 0.89 and 0.65 over a face, and the soft rim of the patch covers about
// six tenths of what it is asked for; 0.060 divided by all three is 0.173. It
// is written as the number the law is driven by, with the reading it is driven
// TO stated beside it, because a constant that silently means something other
// than the measurement beside it is how this law went wrong the first time.
const MOSS_COVER = 0.055;
const MOSS_SCALE = 0.13;
// The spread of the patch field about its own middle, sampled two hundred
// thousand times off the same hash the fragment draws it with. It is here so
// that a coverage asked for is a coverage got: see the cut in the fragment.
const MOSS_SPREAD = 0.2144;
// And what it does to the pigment. Green against the two either side of it,
// which is the axis the detector itself is written on: min(g-r, g-b) over six
// codes.
//
// AND IT IS DARKER THAN THE STONE, ON ALL THREE, which is the sign the old
// triplet had wrong. Sampled beside the stone it grows on (R5 SS1.5), the
// reference's moss on the west flank of 01 reads 59 / 70 / 58 against 70 / 76 /
// 69 of the stone next to it: 0.84 / 0.93 / 0.83, L* 27.5 against 31.4. 1.30 on
// green drew it BRIGHTER, which is a lichen and not moss, and it is half of why
// the six read greenish at the framing the judgement was made from.
export const MOSS_TINT = [0.55, 0.80, 0.50];

// The engraved cyan of the reference, from the core of a stroke out to the halo
// around it, and the light it gives off.
//
// EXPORTED, because the rhombus that hangs in front of a block and the hoop at
// the fifth are the same light as the writing cut into it — that is why they are
// cyan at all — and src/world/monoliths.js used to carry its own copy of all
// three. One colour, one seat.
//
// RE-ANCHORED TO THE TARGETS, WITH THE MEASUREMENT AND WITH ITS CEILING.
//
// Sampled on both targets through v2-pietra/dev2t/inchiostro.mjs, by quantile
// of luminance inside the stone the picture actually draws — the campaign's own
// b > 1.5r + 8 does not partition a SHADED face, where the red sits at 15 to 25
// and ordinary blue-grey stone passes it, and measured that way 99% of 01's
// front came back "ink". What an additive stroke governs is its EXCESS over the
// stone under it, so that is what is quoted. Pooled over five fronts:
//
//   day target     core - stone   +102.6 / +182.9 / +186.9    1 : 1.78 : 1.82
//   night target   core - stone   +136.0 / +198.9 / +203.5    1 : 1.46 : 1.50
//   render, before core - stone    +72.4 /  +61.4 /  +52.3    1 : 0.85 : 0.72
//
// The render was adding MORE RED THAN BLUE where both targets add nearly twice
// as much blue as red. That is the whitish ink in one number, and the green and
// the blue are what it is short of.
//
// AND THE RED IS NOT RAISED, WHICH IS WHERE THE CEILING BITES. On 03 — the face
// the judgement names — the target's core stands at 132.1 / 238.4 / 247.2 and
// the render's red already lands there: 121.7 before, 131.4 after. Doubling the
// green and the blue is the direction the measurement asks for and it is where
// this stops, because the mandate says the writing is never boosted and pushing
// the stroke's red past the target's is what boosting would look like.
//
// WHAT IT BUYS AND WHAT IT CANNOT. On 03 the core goes 121.7 / 151.8 / 166.6 to
// 131.4 / 171.2 / 183.8 against the target's 132.1 / 238.4 / 247.2, and the
// delivered blue-over-red of the excess goes 0.77 to 0.87 against 1.71. The
// rest is NOT in these three numbers and it was measured rather than assumed:
// across a 4.4x change in the red primary the delivered hue moves 0.78 to 0.84,
// and across a 5x change in the gain it moves 0.72 to 0.74. Two things
// downstream of this material govern it, both escalated with their numbers in
// the verbale: the height fog of src/world/air.js, which at 03's 28 m carries
// half the blue on that face (with it off the stone reads 26.8 / 45.8 / 49.8
// against the target's 18.1 / 42.3 / 52.5, and the hue recovers to 1.16), and
// the 32-cube grade LUT of src/core/post.js, which flattens a bright stroke
// towards white. Neither is V2's, and neither is worked around here.
export const INK_CORE = [0.44, 1.60, 2.00];
export const INK_HALO = [0.25, 0.96, 1.44];
export const INK_GAIN = 0.78;

export const STONE_EXPOSURE = 1.25;

// How much light the stone is given before its own exposure, and it is the LAST
// thing the retired bake was still being asked for.
//
// assets-src/monoliths/monoliths.json was the manifest of a Cycles bake: an
// atlas, a sample count, a triangle count and the sun the bake was lit by. Every
// one of those went with the mesh when the six became masonry — except this
// number, which the material was still importing the whole file to read. A
// retired bake that one line still imports is not retired: its sun stayed on the
// roster of consumers that disagree with the seat, and the waiver covering it
// stayed with it. So the number is written here, with where it came from, and
// the file is gone.
export const STONE_LIGHT_SCALE = 1.5;

// HOW MUCH OF THE SKY A WALL OF THIS STONE ACTUALLY TAKES, and it is the one
// number here that is about the LIGHT and not about the material.
//
// WHAT IT ANSWERS. Read face by face against the day target through one
// estimator (R5 SS1.3), the reference's shadow faces stand at L* 11.5 to 15.4
// and its lit ones at 26 to 31, and the ratio between the two on 01 is 4.4 in
// luminance. Ours reads 2.0. A shadow face receives the sky term alone, so a
// wall that is too bright in shadow and right in the sun is a wall taking too
// much sky -- and no albedo can fix that, because albedo divides both faces by
// the same number and leaves the ratio exactly where it was. The four other
// numbers in this file move the level; only this one moves the RATIO.
//
// WHY IT IS A MATERIAL AND NOT A LIFT. src/world/face-light.js is explicit that
// producing the pair belongs to the seat and BENDING it belongs to the
// material -- this file already bends the sun term for the stone's own relief,
// two dozen lines below. This bends the other term, for a reason of the same
// kind: a wall stands among grass, and half a hemisphere of what a vertical
// face of it can see is the meadow rather than the dome. It is NOT uLift, it
// never touches uLift, and tools/guards/guard-lift.mjs keeps the seat at one
// with this in the file.
//
// WHERE 0.55 COMES FROM. It is the value R5's prototype was measured at, and it
// is the number carried forward rather than refitted here for a reason that is
// declared and not hidden: the light this branch draws under is not the light
// the reading was taken under. See the note over the guard in
// tools/guards/guard-pietra.mjs, which prints the seat and the air it finds and
// says what they do to the level.
//
// WHAT IT IS NOT ALLOWED TO BE. Greater than one. A material may take less of
// what the seat hands it; taking MORE is a lift by another name, and that is
// the shortcut this campaign spent a session removing from the light.
export const STONE_SKY_SHARE = 0.55;

/**
 * The stone tile as a texture, from bytes the worker has already generated.
 *
 * The generating is not done here any more and the reason is a measurement:
 * five hundred and twelve squared of four-octave noise is 93.6 ms, which is a
 * tenth of a second of held frame for a texture nobody is waiting on. It is
 * pure arithmetic over a typed array, so it belongs where the disc is built.
 */
export function stoneTile(data, side = 512) {
  const texture = new DataTexture(data, side, side, RGFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

const VERTEX = /* glsl */`
  varying vec3 vLocal;
  varying vec3 vFace;
  varying vec3 vWorld;
  varying float vDistance;

  void main() {
    // The position stays in the BLOCK's own frame all the way to the fragment,
    // which is what lets the wall be rebuilt down there: a course, a cell and a
    // joint are all facts about this block and not about the world it stands
    // in. It interpolates to itself exactly, because it is the same arithmetic
    // at all four corners of a rectangle however big the rectangle is.
    vLocal = position;
    // AND SO DOES THE NORMAL, which is the half of it that is easy to get
    // wrong: the block is TURNED, so a world normal cannot say which of the
    // four walls a fragment is on. Turned once here it read the same wall for
    // the whole block and every joint on it disappeared. The turn is done in
    // the fragment instead, off uTurn — one varying rather than two, and the one
    // that arrives is the one the wall's own arithmetic is written in.
    vFace = normal;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vDistance = length(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// The wall's own law, as the fragment has to know it.
//
// EVERY LINE OF THIS IS THE SAME ARITHMETIC AS src/world/voxel/courses.js, and
// that is the point of it being written twice rather than a defect: the mesh is
// merged, so where a block begins CANNOT be handed over per vertex, and the only
// two places it can live are the generator and the fragment. They are kept in
// step by a shared shape and by tools/monoliths/spec.mjs, which walks the law
// offline and checks it against both the histogram of the targets and the
// geometry the generator hands back.
//
// The hash is the one src/world/voxel/material.js dithers the meadow with — no
// transcendental, no integer type, so it costs nothing and it can be reproduced
// exactly in JavaScript with Math.fround. What depends on it here is a
// THRESHOLD (where a block ends) and a CONTINUOUS field (how far a course
// strays), and only the second reaches the geometry.
const LAW_GLSL = /* glsl */`
  uniform vec3 uHalf;        // half the block, in its own frame
  uniform float uRise;       // metres of one course
  uniform float uCell;       // metres of one cell of the lattice
  uniform float uRunCut;     // how often a cell boundary is a block edge
  uniform float uJitter;     // how far a cell boundary strays, in cells
  uniform float uWander;     // how far a course line strays, in metres
  uniform float uWanderSpan; // and over how many metres of plan it is resampled

  vec2 stoneHash(float x, float y, float z) {
    vec3 p = fract(vec3(x, y, z) * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract(vec2((p.x + p.y) * p.z, (p.y + p.z) * p.x));
  }

  float wanderAt(float course, float x, float z) {
    if (uWander == 0.0) return 0.0;
    vec2 uv = vec2(x, z) / uWanderSpan;
    vec2 cell = floor(uv);
    // BILINEAR AND NOT SMOOTHED: the mesh follows this line as a polyline with a
    // vertex at every node of the lattice, so between two nodes the geometry is
    // a chord. Smoothing here would put the joint this fragment draws up to a
    // centimetre off the edge the geometry was cut at.
    vec2 t = uv - cell;
    float seed = course * 7.0 + 3.0;
    float a = stoneHash(cell.x, cell.y, seed).x;
    float b = stoneHash(cell.x + 1.0, cell.y, seed).x;
    float c = stoneHash(cell.x, cell.y + 1.0, seed).x;
    float d = stoneHash(cell.x + 1.0, cell.y + 1.0, seed).x;
    return uWander * (mix(mix(a, b, t.x), mix(c, d, t.x), t.y) - 0.5);
  }

  float courseY(float course, float x, float z) {
    if (course <= 0.0) return 0.0;
    return course * uRise + wanderAt(course, x, z);
  }

  float cellPhase(float course) { return stoneHash(course, 17.0, 5.0).y * uCell; }

  float cellEdge(float course, float i) {
    return i * uCell + cellPhase(course)
      + uJitter * uCell * (stoneHash(course, i, 29.0).x - 0.5);
  }

  bool isCut(float course, float i) {
    return stoneHash(course, i, 41.0).y < uRunCut;
  }
`;

const FRAGMENT = /* glsl */`
  precision highp float;

  varying vec3 vLocal;
  varying vec3 vFace;
  varying vec3 vWorld;
  varying float vDistance;

  uniform sampler2D tStone;
  uniform sampler2D tInk;
  uniform vec3 uAlbedo;
  uniform float uGain;
  uniform float uTile;
  uniform float uJoint;
  uniform float uJointPixels;
  uniform float uTint;
  uniform float uMoss;
  uniform float uMossScale;
  uniform float uMossShade;
  uniform float uMossReach;
  uniform float uMossEdgeGain;
  uniform float uMossFoot;
  uniform float uMossFootRise;
  uniform float uMossHead;
  uniform float uMossWest;
  uniform float uMossWest0;
  uniform float uMossWest1;
  uniform float uMossWestRise;
  uniform float uMossSpread;
  uniform vec3 uMossTint;
  uniform float uSkyShare;
  uniform float uArris;
  uniform float uArrisPixels;
  uniform float uArrisPigment;

  uniform vec2 uHead[${MAX_HEAD_RUNS}];  // (the run's far edge in x, its courses)
  uniform int uHeadRuns;
  uniform float uPaleTop;
  uniform float uPaleCourses;
  uniform float uF0;
  uniform float uRim;
  uniform float uRimPower;
  uniform float uSkyBlur;
  uniform vec3 uLowSky;
  uniform float uRelief;

  // The block's own turn, as its cosine and its sine.
  //
  // NOT modelMatrix, and that is not a preference: three.js declares that
  // uniform in the VERTEX stage only, so a fragment that reads it does not
  // compile and the whole wall silently fails to draw. A block is turned about
  // one axis by an angle known before the material exists, so two numbers carry
  // the whole of it and there is nothing here a matrix would say better.
  uniform vec2 uTurn;

  uniform vec3 uCentre;
  uniform vec3 uRight;
  uniform vec3 uFront;
  uniform vec2 uFace;
  uniform float uInk;
  uniform float uInkOn;
  uniform vec3 uInkCore;
  uniform vec3 uInkHalo;

  ${SCENE_LIGHT_GLSL}
  ${SKY_GLSL}
  // After SKY_GLSL and not before it: that chunk is what declares uSunDir in
  // this program, and a uniform has to be declared above the line that reads it.
  ${faceLightGlsl({ sunDeclared: true })}
  ${SKY_REFLECTION_GLSL}
  ${FOG_GLSL}
  ${LAW_GLSL}

  void main() {
    // The face in the BLOCK's own frame, and the same face in the world. The
    // first says which wall this is; the second is what the light, the sky and
    // the writing are all computed against.
    vec3 f = normalize(vFace);
    vec3 n = normalize(vec3(
      f.x * uTurn.x + f.z * uTurn.y, f.y, f.z * uTurn.x - f.x * uTurn.y));

    // ------------------------------------------------- where on the wall we are
    //
    // Which wall, from the block's own normal. The chamfer over a course leans
    // up and out, so it keeps the sign of the wall it caps and is read as part
    // of it — which is right: the dressed edge belongs to the block under it.
    float sx = abs(f.x);
    float sz = abs(f.z);
    bool lid = abs(f.y) > 0.9;
    // AND THE DRESSED FACET IS NAMED HERE, off the same normal, because it is
    // the only thing on a block that leans: a wall stands at nought, a lid and
    // the floor of a socket at one, and the chamfer over a course at 0.7071
    // exactly. Named this early because what it changes is the LIGHT, and the
    // light is settled long before the joint and the arris are drawn.
    float facet = step(0.30, abs(f.y)) * (1.0 - step(0.90, abs(f.y)));
    // u along the wall from its own near corner, and span, in the same
    // direction the generator walked it. Where the two disagreed, a joint would
    // not land on the break the geometry was cut at.
    float u;
    float span;
    if (lid) {
      u = vLocal.x + uHalf.x;
      span = 2.0 * uHalf.x;
    } else if (sx > sz) {
      u = f.x > 0.0 ? uHalf.z - vLocal.z : vLocal.z + uHalf.z;
      span = 2.0 * uHalf.z;
    } else {
      u = f.z > 0.0 ? vLocal.x + uHalf.x : uHalf.x - vLocal.x;
      span = 2.0 * uHalf.x;
    }
    float up = lid ? vLocal.z + uHalf.z : vLocal.y;

    // ------------------------------------------------------------ the course
    //
    // Rounded to the nominal lattice and then settled against the two
    // neighbours, because the line of a course strays by up to half its own
    // rise and a floor() alone would put a whole band of one course into the
    // one under it.
    float course = floor(up / uRise);
    if (!lid) {
      for (int k = -1; k <= 1; k++) {
        float c = floor(up / uRise) + float(k);
        if (c < 0.0) continue;
        if (up >= courseY(c, vLocal.x, vLocal.z) && up < courseY(c + 1.0, vLocal.x, vLocal.z)) {
          course = c;
        }
      }
    }

    // -------------------------------------------------------------- the block
    //
    // Which cell, then which run of cells: a block begins at a cell whose lower
    // boundary was not suppressed, so the block this fragment stands in is
    // found by walking back to the first boundary that was kept. Five steps is
    // the bound and it is not arbitrary — a run longer than five cells happens
    // to one block in twenty thousand at the measured rate, and what it would
    // cost is a tint that changes halfway along one very long block.
    float phase = cellPhase(course);
    float index = floor((u - phase) / uCell);
    for (int k = -1; k <= 1; k++) {
      float i = floor((u - phase) / uCell) + float(k);
      if (u >= cellEdge(course, i) && u < cellEdge(course, i + 1.0)) index = i;
    }
    float first = index;
    for (int k = 0; k < 5; k++) {
      if (isCut(course, first) || cellEdge(course, first) <= 0.0) break;
      first -= 1.0;
    }
    float last = index + 1.0;
    for (int k = 0; k < 5; k++) {
      if (isCut(course, last) || cellEdge(course, last) >= span) break;
      last += 1.0;
    }
    float blockFrom = max(cellEdge(course, first), 0.0);
    float blockTo = min(cellEdge(course, last), span);

    // THE TILE, and the one shade taken off it. The tile is a height as well as
    // a shade, so a second fetch a step up-sun differs from the first by the
    // slope along the only direction a sun cares about: one more read of a map
    // already in hand, and not one byte of a stored normal.
    vec2 tile = vec2(u, up) * uTile;
    vec2 pair = texture2D(tStone, tile).rg;
    vec3 albedo = uAlbedo * (1.0 + uGain * (pair.r - 0.5));
    vec2 upSun = normalize(vec2(uSunDir.x, uSunDir.z) + 1e-5) * (0.012 * uTile);
    float above = texture2D(tStone, tile + upSun).g;

    // ---------------------------------------------------------- the block tint
    //
    // The sixty per cent of what makes a wall read as laid rather than printed,
    // and it costs a hash. Seeded on the cell the block BEGINS at, so every
    // fragment of one block draws the same number however long the block is and
    // however the eye moves.
    vec2 draw = stoneHash(course, first, 11.0);
    albedo *= 1.0 + uTint * (draw.x - 0.5);

    // ------------------------------------------------- the pale top course
    //
    // The head of a wall is bleached and the stone three courses down is not,
    // and the targets read the difference on six faces. It is a PIGMENT, like
    // everything else about this stone that is not a shape.
    //
    // WHICH COURSE IS THE TOP ONE IS A FACT ABOUT THE HEAD AND NOT ABOUT THE
    // BLOCK, which is why the head arrives as a uniform. A head steps down over
    // part of its width — one to four levels on the six, six treads on the
    // stair — so a wall has no single top course, and a law written off the
    // block's own height would paint a pale band across the middle of every
    // level that steps down. The runs come in the same order and with the same
    // edges the generator cut them at, and this walks them exactly the way
    // src/world/voxel/courses.js walks them: the first run whose far edge
    // covers this point, and the last one for anything past the end.
    //
    // A LID IS THE TOP COURSE'S OWN SURFACE, so it takes the whole of it. No
    // upper face of any of the six is in the reference framing — the eye is
    // below every head — but the treads of the stair are, and a tread is the
    // top of the course it caps.
    float top = uHead[0].y;
    for (int i = 0; i < ${MAX_HEAD_RUNS}; i++) {
      if (i >= uHeadRuns) break;
      top = uHead[i].y;
      if (vLocal.x <= uHead[i].x) break;
    }
    float below = lid ? 0.0 : top - 1.0 - course;
    albedo *= 1.0 + (uPaleTop - 1.0) * clamp(1.0 - below / uPaleCourses, 0.0, 1.0);

    // The same two analytic terms as the meadow, because they come from the
    // same place: src/world/face-light.js is the one producer of the pair, and
    // this file used to write out a second copy of it. A block and the grass at
    // its foot cannot disagree about the hour if neither of them owns the
    // arithmetic.
    //
    // The pair is BENT before it becomes light, which is what faceLightOf()
    // exists to allow: the relief of the stone takes sun off a face that leans
    // out of the beam, and bending a pair you were given is a material's
    // business. Producing one is not.
    vec2 terms = faceTerms(n);
    terms.x *= clamp(1.0 - uRelief * (above - pair.g), 0.45, 1.9);
    // AND THE SKY TERM IS BENT TOO, WHICH IS NEW AND IS THE OTHER HALF OF THE
    // SAME PERMISSION. The line above takes sun off a face that leans out of the
    // beam; this takes sky off a face that stands in grass rather than under an
    // open dome. Both bend a pair this material was GIVEN, neither writes a
    // second opinion about where the sun is, and uLift is untouched by either --
    // the seat is still one, and the ratio between a lit face and a shaded one
    // is the number this moves. See STONE_SKY_SHARE.
    terms.y *= uSkyShare;
    // AND THE SKY TERM IS LEFT ALONE ON THE DRESSED EDGE, which is a decision
    // and not an omission. A facet leaning at the sky is handed 0.854 by
    // faceTerms against the wall's 0.5 — 1.71x, of sky alone — and this file
    // escalated that against the targets' 1.072 to 1.091. Occluding it here was
    // tried and MEASURED: with the skin closed, driving the facet's share of
    // the sky from 1.00 to 0.20 moves the arris the estimator reads from 1.150
    // to 1.117 pooled, and the render is already AT the target without it (04
    // and 05 read 1.083 and 1.173 against 1.244 and 1.163). A knob that ships
    // at the value the measurement asks for is not a knob, and the 1.71x stays
    // parked at D5 with its number rather than being quietly spent here.
    vec3 light = faceLightOf(terms);

    // ------------------------------------------------------------- the moss
    //
    // A PIGMENT AND NEVER A LIGHT, which is the one thing about it that is not
    // negotiable: the night target's moss goes dark with the stone it sits on,
    // and anything drawn as an emissive would come out of a night frame as the
    // only green thing in it. So it multiplies the albedo, above the joint and
    // under the light, and a night puts it out with everything else.
    //
    // Where it grows is the law of section 4 of muschio.txt and not a scatter:
    // five and a half times as much on a LIT face as on a dark one, nine times
    // as much within a course of a vertical edge as five courses in, and
    // bimodal up the face — wet at the foot, weathered at the head, thin in the
    // middle.
    if (uMoss > 0.0) {
      // A LIT FACE IS THE ONE THE COVERAGE IS QUOTED ON, so the lit face takes
      // it whole and the dark face takes it divided by the ratio between them.
      // Written the other way round — the dark face at the quoted level and the
      // lit one multiplied up — the two conditions cannot both be the
      // measurement.
      float lit = smoothstep(0.0, 0.35, terms.x);
      // HELD AT FIVE COURSES, WHICH IS AS FAR AS ANYBODY LOOKED. The reading
      // runs from 4.6% within one course of a vertical edge to 0.5% five
      // courses in, and that is a factor of nine; letting the exponential carry
      // on to the middle of a three metre face makes it sixteen, which is a
      // number nothing measured. Past the last bin the law is flat.
      float edge = min(min(u, span - u) / uRise, 5.0);
      float upFrac = clamp(up / (2.0 * uHalf.y), 0.0, 1.0);
      // THE LAW, IN THE ORDER THE TENTHS ARE READ IN. A level for the sun, a
      // climb to the foot, a little at the head, a corner, and the narrow west
      // flank. Every factor is one where its condition is absent, so the
      // coverage asked for is the coverage a plain face in the middle of a wall
      // gets and the rest are what the reference reads ABOVE that.
      //
      // The west term is held to narrow faces by the face's own span, which the
      // wall already knows: it is 1.10 to 1.48 m on the flanks the reference
      // mosses and 2.90 to 3.44 on the fronts it does not, and the two do not
      // overlap. Without that hold it reaches the fronts of 04 and 05, which
      // face west and carry a twentieth of what their flanks do.
      float west = smoothstep(uMossWest0, uMossWest1, -n.x) * smoothstep(2.6, 1.4, span);
      // AND THE FLANK TERM IS ADDED TO THE SUN TERM AND NOT MULTIPLIED INTO IT,
      // which is the one place this law disagrees with itself on purpose. The
      // sun ratio says a shaded face carries less; the east flank of 04 is
      // shaded and carries 17.0% -- more than any lit front in the picture. A
      // flank that runs with water carries moss whether or not the sun reaches
      // it, so it stands beside the sun's own term rather than under it, and
      // the two agree again on a wide front, where the flank term is nought.
      float weight = (1.0 + uMossFoot * smoothstep(uMossFootRise, 0.0, upFrac)
                          + uMossHead * smoothstep(0.90, 1.0, upFrac))
        * (1.0 + uMossEdgeGain * exp(-edge * uMossReach))
        * (mix(uMossShade, 1.0, lit) + uMossWest * west * smoothstep(uMossWestRise, 0.0, upFrac));
      vec2 spot = vec2(u, up) / uMossScale;
      vec2 base = floor(spot);
      vec2 t = spot - base;
      t = t * t * (3.0 - 2.0 * t);
      float a0 = stoneHash(base.x, base.y, 61.0).x;
      float b0 = stoneHash(base.x + 1.0, base.y, 61.0).x;
      float c0 = stoneHash(base.x, base.y + 1.0, 61.0).x;
      float d0 = stoneHash(base.x + 1.0, base.y + 1.0, 61.0).x;
      float field = mix(mix(a0, b0, t.x), mix(c0, d0, t.x), t.y);
      // A THRESHOLD AND NOT A WASH. Patches with hard-ish rims and bare stone
      // between them is what the crops show; a smooth green multiply over the
      // whole face is what a wash looks like, and the estimator that measured
      // 1 to 14% coverage would read it as a hundred.
      //
      // AND THE THRESHOLD IS CUT ON THE FIELD'S OWN QUANTILE, which is the
      // difference between asking for six per cent and getting it. A cut at
      // one minus the cover treats the field as flat over nought to one; a
      // bilinear value noise is nothing of the sort — sampled two hundred
      // thousand times
      // it has a mean of 0.4996 and a spread of 0.2144, so its ninety-fourth
      // percentile is 0.837 and a cut at 0.94 takes almost nothing. Asked for
      // six per cent that way the render measured 0.1. So the field is turned
      // into the fraction of the face standing above it, by the logistic that
      // stands in for a normal tail (checked against the field's own quantiles:
      // 0.064 asked 0.06, 0.105 asked 0.12), and the cut is made on THAT.
      float cover = clamp(uMoss * weight, 0.0, 0.9);
      float above = 1.0 / (1.0 + exp(1.702 * (field - 0.5) / uMossSpread));
      albedo *= mix(vec3(1.0), uMossTint, smoothstep(cover, cover * 0.35, above));
    }

    // ----------------------------------------------------------- the joint
    //
    // The same six per cent over the same one or two pixels as the meadow's,
    // because it is the same thing seen on stone. Held in PIXELS off the
    // block's own edges, so it is a line at every distance and never a band,
    // and let go once a block is too small to have an inside.
    float pixel = max(length(fwidth(vLocal)), 1e-6);
    float across = min(u - blockFrom, blockTo - u);
    float down = up - courseY(course, vLocal.x, vLocal.z);
    float border = lid ? across : min(across, down);
    float width = min(uJointPixels * pixel, uCell * 0.14);
    float onScreen = uCell / pixel;
    albedo *= 1.0 - uJoint * (1.0 - smoothstep(0.0, width, border))
      * smoothstep(2.5, 5.0, onScreen);

    // ------------------------------------------------- the arris on its ends
    //
    // The horizontal one is real geometry — the chamfer over every course is a
    // facet leaning up and out, and it is lit as one. The VERTICAL one is not:
    // a facet at every block edge would be two more quads a block and the merge
    // with it. So the ends of a block turn their normal out of the wall by the
    // angle the chamfer stands at, in a band held in pixels, and take the light
    // of a facet that leans. Its brightness and its blue both come off that,
    // which is the whole reason it is not painted paler.
    float endBand = min(uArrisPixels * pixel, uCell * 0.30);
    float end = 1.0 - smoothstep(0.0, endBand, across);
    float leaned = 0.0;
    if (!lid && end > 0.0) {
      vec3 sideways = normalize(vec3(-n.z, 0.0, n.x)) * sign(u - 0.5 * (blockFrom + blockTo));
      vec3 leaning = normalize(mix(n, normalize(n + sideways), 0.7071));
      leaned = end * uArris * smoothstep(2.5, 5.0, onScreen);
      light = mix(light, faceLightOf(faceTerms(leaning)), leaned);
    }

    // AND WHAT THE DRESSED STONE IS MADE OF, which is this file's half of the
    // arris and the half that was missing.
    //
    // Both edges take it and they have to, because they are one edge: the
    // horizontal one is the real facet the geometry carries over every course,
    // the vertical one is the same facet at a block's end, turned in the
    // fragment because a quad there would cost the merge. A pigment on one and
    // not the other would draw a block dressed along the top and raw down the
    // side.
    //
    // AND IT IS THE SMALLER HALF OF THIS CURE AND IS KEPT ANYWAY, which is
    // worth saying plainly rather than shipping a knob that looks decisive. A
    // cut edge on weathered stone is freshly broken face, denser and less
    // bleached than the flat it was cut from, so the pigment belongs on it; but
    // what drew the line along every course was the sky, and the sweep that
    // proved it is in the verbale. This is the material being right about
    // itself, not the cure.
    float dressed = max(facet, leaned);
    albedo *= mix(1.0, uArrisPigment, dressed);

    // ------------------------------------------------------------ engraving
    //
    // NOT ONE LINE OF src/world/engraving.js CHANGED, and this is the whole
    // reason the block is in the demo. The writing is projected off the block's
    // own centre and its own two axes, in METRES OF STONE — the same arithmetic
    // the delivered material uses — so what is under it can be a baked mesh or
    // a wall of generated courses and the type lands on the same stone.
    vec3 offset = vWorld - uCentre;
    vec2 ink = vec2(
      dot(offset, uRight) / uFace.x + 0.5,
      0.5 - offset.y / uFace.y);
    float facing = smoothstep(0.55, 0.90, dot(n, uFront)) * uInkOn;
    float inside = step(0.0, ink.x) * step(ink.x, 1.0) * step(0.0, ink.y) * step(ink.y, 1.0);
    vec2 cut = texture2D(tInk, ink).rg * (facing * inside);
    // Nothing is cut where nothing is drawn, so the groove term falls back to
    // one rather than to the half grey the map stores.
    float groove = mix(1.0, 0.42 + 1.16 * cut.g, facing * inside);

    vec3 colour = albedo * light * groove;

    // --------------------------------------------------------- the sky in it
    vec3 view = normalize(vWorld - cameraPosition);
    vec3 mirrored = reflect(view, n);
    vec3 sky = skyReflection(mirrored, uSkyBlur);
    sky = mix(uLowSky, sky, smoothstep(0.12, 0.38, mirrored.y));
    float fresnel = uF0 + uRim * pow(1.0 - clamp(dot(-view, n), 0.0, 1.0), uRimPower);
    colour += sky * fresnel;

    colour += mix(uInkHalo, uInkCore, cut.r) * cut.r * uInk;

    colour = mix(colour, uFogColour, fogAmount(vDistance, vWorld.y));
    gl_FragColor = vec4(colour, 1.0);
  }
`;

/**
 * The block: its courses, its material and the seat the engraving hangs on.
 *
 * @param {object|string} entry which block to build: an id of
 *                        src/world/layout.js, or a whole spec with the measured
 *                        `masonry` block already on it
 * @param {Texture} tile  the stone atlas
 * @param {object}  ready the courses, if the worker has already cut them
 * @param {boolean} engraved whether anything is ever written on this stone
 */
export function createMasonry(entry, tile, ready = null, engraved = true) {
  const spec = typeof entry === 'string' ? MONOLITHS.find((m) => m.id === entry) : entry;
  const built = ready || buildMasonry(spec);
  const law = built.law || masonryLaw(spec);
  const angle = spec.rotationY * DEG;
  const height = built.height ?? spec.size[1];
  // THE ENGRAVING HANGS ON THE BOX AND NOT ON THE BUILT HEAD, and that is the
  // way round it has to be. The writing was laid out against the box the fit
  // produced — src/world/engraving.js draws a texture whose shape is the box's
  // — so hanging it on a head that is a tenth of a metre lower would move every
  // line of type on every block by that tenth. The head follows the target; the
  // writing follows the fit that put it there.
  const centre = new Vector3(
    spec.position.x, spec.baseY + spec.size[1] / 2, spec.position.z,
  );

  // The head levels, as the fragment reads them: where each run ends along the
  // block's own x, and how many courses stand under it. Padded to the fixed
  // size a uniform array has to have, with the padding standing at the last
  // real run so that nothing past the end can name a course that was never cut.
  const runs = built.runs || [{ x1: spec.size[0] / 2, courses: built.courses ?? 1 }];
  const head = [];
  for (let i = 0; i < MAX_HEAD_RUNS; i++) {
    const run = runs[Math.min(i, Math.min(runs.length, MAX_HEAD_RUNS) - 1)];
    head.push(new Vector2(run.x1, run.courses));
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(built.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(built.normals, 3));
  geometry.setIndex(new BufferAttribute(built.indices, 1));
  geometry.computeBoundingSphere();

  const material = new ShaderMaterial({
    uniforms: {
      tStone: { value: tile },
      tInk: { value: null },
      uAlbedo: { value: new Vector3(...STONE_ALBEDO) },
      uGain: { value: STONE_GAIN },
      uTile: { value: 1 / law.tile },
      ...faceLightUniforms(STONE_LIGHT_SCALE * STONE_EXPOSURE),
      uJoint: { value: STONE_JOINT },
      uJointPixels: { value: STONE_JOINT_PIXELS },
      uTint: { value: STONE_TINT },
      uArris: { value: STONE_ARRIS },
      uArrisPixels: { value: STONE_ARRIS_PIXELS },
      uArrisPigment: { value: STONE_ARRIS_PIGMENT },
      // The head as the fragment has to walk it, from the runs the GENERATOR
      // cut — not from the spec it was cut out of. Between the two there is a
      // rounding to whole courses and a fusing of narrow levels, and the pale
      // course has to land on the course the geometry actually stops at.
      uHead: { value: head },
      uHeadRuns: { value: Math.min(runs.length, MAX_HEAD_RUNS) },
      uPaleTop: { value: STONE_PALE_TOP },
      uPaleCourses: { value: STONE_PALE_COURSES },
      uMoss: { value: MOSS_COVER },
      uMossScale: { value: MOSS_SCALE },
      uMossShade: { value: MOSS_SHADE },
      uMossReach: { value: MOSS_EDGE_REACH },
      uMossEdgeGain: { value: MOSS_EDGE_GAIN },
      uMossFoot: { value: MOSS_FOOT },
      uMossFootRise: { value: MOSS_FOOT_RISE },
      uMossHead: { value: MOSS_HEAD },
      uMossWest: { value: MOSS_WEST },
      uMossWest0: { value: MOSS_WEST_FROM },
      uMossWest1: { value: MOSS_WEST_TO },
      uMossWestRise: { value: MOSS_WEST_RISE },
      uMossSpread: { value: MOSS_SPREAD },
      uSkyShare: { value: STONE_SKY_SHARE },
      uMossTint: { value: new Vector3(...MOSS_TINT) },
      uRelief: { value: 2.2 },
      uF0: { value: STONE_F0 },
      uRim: { value: STONE_RIM },
      uRimPower: { value: STONE_RIM_POWER },
      uSkyBlur: { value: SKY_BLUR },
      uLowSky: { value: new Vector3(...LOW_SKY) },
      // The wall's own law, as the fragment has to know it. Every one of them
      // is a number the spec carried in as data, so nothing here is a second
      // opinion about the wall — it is the same opinion, on the other side of
      // the merge.
      uHalf: { value: new Vector3(spec.size[0] / 2, height / 2, spec.size[2] / 2) },
      uRise: { value: law.rise },
      uCell: { value: law.cell },
      uRunCut: { value: law.runCut },
      uJitter: { value: law.jitter },
      uWander: { value: law.wander },
      uWanderSpan: { value: law.wanderSpan },
      uTurn: { value: new Vector2(Math.cos(angle), Math.sin(angle)) },
      uCentre: { value: centre.clone() },
      uRight: { value: new Vector3(Math.cos(angle), 0, -Math.sin(angle)) },
      uFront: { value: new Vector3(Math.sin(angle), 0, Math.cos(angle)) },
      uFace: { value: new Vector2(spec.size[0], spec.size[1]) },
      // Whether anything is ever written on this stone. The stair and the
      // platform are the same masonry and carry no writing, and a face that
      // sampled an unbound map would read it as a groove over its whole front.
      uInkOn: { value: engraved ? 1 : 0 },
      uInk: { value: INK_GAIN },
      uInkCore: { value: new Vector3(...INK_CORE) },
      uInkHalo: { value: new Vector3(...INK_HALO) },
      // All four shared by reference and not copied: one sun, one weather in
      // what reflects it, one pair of light colours, one body of air. A copy
      // here would be a second answer to where the sun is.
      ...SKY_UNIFORMS,
      ...SKY_REFLECTION,
      ...SCENE_LIGHT_UNIFORMS,
      ...fogUniforms(),
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: false,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = `masonry-${spec.id}`;
  mesh.position.set(spec.position.x, spec.baseY, spec.position.z);
  mesh.rotation.y = angle;

  return {
    mesh,
    spec,
    material,
    blocks: built.blocks,
    courses: built.courses,
    rise: built.rise,
    height,
    quads: built.quads,
    fused: built.fused,
    vertices: built.vertices,
    setEngraving(texture) { material.uniforms.tInk.value = texture; },
  };
}
