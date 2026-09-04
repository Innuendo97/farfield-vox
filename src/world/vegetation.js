import {
  BufferAttribute, ClampToEdgeWrapping, DataTexture, DoubleSide, DynamicDrawUsage,
  InstancedBufferAttribute, InstancedBufferGeometry, LinearFilter,
  LinearMipmapLinearFilter, Mesh, RedFormat, RGBAFormat, ShaderMaterial, Sphere,
  SRGBColorSpace, UnsignedByteType, Vector2, Vector3,
} from 'three';
import { SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS, SUN_DIRECTION } from '../core/sky.js';
import { BAKED_TERMS_GLSL, FOG_GLSL, fogUniforms, GROUND_EXPOSURE } from './air.js';
import { faceLightGlsl, faceLightUniforms } from './face-light.js';
import {
  clamp01, pathCoord, pathRun, smoothstep,
} from './terrain-field.js';
import { MONOLITHS, PLATFORM, STAIRS } from './layout.js';
import { ROCKS } from './rocks.js';
import { ALBEDO, voxelSettings } from './voxel/index.js';
import { columnTop, DISC_RADIUS, EMPTY, mantoAt } from './voxel/worldgen.js';
import { VOXEL } from './voxel/columns.js';
import TERRAIN from '../../assets-src/terrain/terrain.json' with { type: 'json' };
import GRASS from '../../assets-src/vegetation/grass.json' with { type: 'json' };

// The accents of the meadow: rare sprays of blades, and the loose flowers.
//
// WHAT THIS FILE STOPPED BEING, AND IT IS THE LARGEST FACT ABOUT IT. It used to
// be the meadow. A ring of cards sown four to a cell out to twelve metres, a
// second sparse ring out to twenty, a skirt of eighty four around every block
// and three bushes: that was how grass got drawn, and every lever in here --
// the thinning towards the rim, the extra thinning when the eye goes level, the
// tier's own density -- existed because a stack of transparent quads over the
// bottom third of the screen cost two and a fifth milliseconds of a twelve and
// a half millisecond frame.
//
// THE MASS OF THE MEADOW IS CUBES. Measured on both targets, in eight declared
// windows of open meadow: the share of meadow pixels that no cube face could
// have drawn is 0.70% against an instrument floor of 0.20%, and all sixty two
// candidates, looked at one by one at four times, were cube corners, scraps of
// stone and flower stalks. Not one was a blade. The ground of this world draws
// its own grass, and a carpet of cards over it is a second, paler meadow laid
// on the first -- which is exactly what the delivered sheet measured as.
//
// SO WHAT IS LEFT HERE IS AN ACCENT, and the night target is the one picture
// that shows it: inside the pool of a lamp there are four to six SPRAYS of fine
// blades over a hundred and six square metres of ground, twenty five by fifteen
// centimetres, and the day target's meadow census cannot find even one. Three of
// the five families are gone with the mass they were drawing:
//
//  - the FAR RING (10.5 to 20 m, cards two pixels tall) existed to stop the
//    meadow ending in a line. The meadow no longer ends: the cubes run to the
//    rim of the disc, and an accent twenty metres out is a quarter of a metre
//    of blade under a pixel.
//  - the SKIRTS (84 cards around each of six footprints) existed because the
//    reference had grass cutting across every base. It still does, and E-V4d
//    ratified whose grass it is: the green climbing the stone is the ground's
//    own tuft standing three to six voxels higher where it meets built stone,
//    which is V1's. Five hundred sprays crowded onto the bases would be the
//    opposite of rare.
//  - the BUSHES were three fixed cards placed by hand against the reference,
//    and the same ratification says a bush in these targets is that same raised
//    carpet and not an object. V4 does not draw one.
//
// What that leaves is the near ring, which is the accent, and the FLOWERS,
// which are the other half of this file and are not cards at all: a cube head
// on a sub-voxel stalk, built below against a census redone at the poses as
// they stand. Two draws where there were five.
//
// The colour of a card is the GROUND'S colour, and now it is the ground's own
// number rather than a second measurement of it: the sheet is painted at the
// reflectance src/world/voxel/material.js publishes, and the light is the pair
// src/world/face-light.js produces for a face that points up. Nothing here
// carries a light of its own.

const DEG = Math.PI / 180;

// How far the ring reaches, and over how much of its outer edge the cards are
// shrunk away. Twelve metres is where a spray of this size stops being
// resolvable at this framing; the band is wide enough that a card is already
// under a pixel of height by the time it is dropped.
const RING_RADIUS = 12.0;
const RING_FADE = 3.4;

// How far the ring is ever allowed to reach. The lattice and its buffers are
// built for this once, and the tier moves a uniform inside it: growing a ring
// by reallocating it would mean a hitch on the one machine that can afford the
// extra grass and none on the machines that cannot.
const RING_RADIUS_MAX = 16.0;

// How long a change of density takes to become true, in seconds, and how wide
// the shrinking band is while it does.
//
// A card leaves by shrinking, exactly as it does at the rim of the ring, and
// the band is a bump: nought at both ends of the sweep, widest in the middle.
// That is what makes a tier change invisible rather than merely gradual — at
// rest the cut is a hard threshold and the meadow is precisely the meadow the
// tier asks for, and no card is ever caught halfway.
const DENSITY_FADE_SECONDS = 1.0;
const DENSITY_FADE_BAND = 0.12;

// HOW MANY SPRAYS STAND ON A SQUARE METRE, AND IT IS BRACKETED BY TWO TARGETS.
//
// The night target counts 4 to 6 legible sprays over the 106 m² of ground its
// lamp window sees, which is 0.04 to 0.06 per square metre if they are spread
// over the whole window and more if they only ever stand in the pools. The day
// target bounds it from the other side, and harder: its meadow census read
// 0.17% of oblique slivers over 93,380 px of meadow -- about eleven square
// metres -- against an instrument floor of 0.09%, and attributed every one of
// them to something that is not a blade. One spray of this size at eight metres
// is about 170 px of blade, so fewer than one spray fits in those eleven square
// metres before the census would have caught it: under 0.09 per square metre.
//
// The two brackets overlap between 0.04 and 0.09, and this is the middle of the
// overlap. It is a READING of two pictures and not a measurement of one, and it
// is the number in this file most likely to be moved by somebody looking at a
// crop: it is written here alone, in sprays per square metre, so that moving it
// is one edit and not a search.
const ACCENT_PER_M2 = 0.06;

// The lattice the sprays stand on. Cells are anchored in the world, so a spray
// is always in the same place: the ring is the set of cells around whichever
// cell the walker is standing in, and it is refilled only when that cell
// changes.
//
// TWO METRES AND ONE CANDIDATE, WHICH IS SIZED FOR WHAT IS SOWN. The lattice
// was 0.72 m with four candidates a cell, because it was sowing a carpet: that
// is 7.7 candidates per square metre, and putting six hundredths of a spray
// through the placement loop for each of them means six thousand rolls of the
// dice per rebuild to stand about twenty seven sprays, four times a second.
// A lattice one candidate to four square metres puts about a hundred and ten
// through the same loop and stands the same sprays, and it is refilled a third
// as often because the walker crosses its cells a third as rarely.
const CELL = 2.0;
const PER_CELL = 1;

// What share of the candidates stands, before the ground's own density and the
// tier are applied: the sowing above, expressed as this lattice sees it.
const ACCENT = (ACCENT_PER_M2 * CELL * CELL) / PER_CELL;

// Three quads at sixty degrees: eight triangles a card counting both faces.
// Three and not four because the fourth adds a third more fill for a silhouette
// the eye cannot separate from the other three, and not two because two crossed
// quads read as a cross when the walker looks straight down at them.
const QUADS = 3;

// How much the scale of a spray varies, and how far the top of a card is
// carried over from its root, in metres.
const CARD_SCALE = { min: 0.68, max: 1.15 };
const CARD_LEAN = 0.05;

// Where the alpha channel is cut. Low, because the sheet is dilated under its
// transparent texels and the mip chain thins a blade with distance: a cut at a
// half erases the far half of the ring.
const ALPHA_CUTOFF = 0.34;

// =========================================================================
// THE FLOWERS, AND EVERY NUMBER BELOW WAS RE-MEASURED AT THE POSES AS THEY
// STAND. The census this file used to be built from ran the target's pixels
// through the camera in assets-src/materia/ricetta.json -- eye 2.733 m, fov
// 51.342 deg -- and the poses were refitted under a 1.80 m walker (E-V8f):
// the eye dropped 1.15 m, the focal length went from 978.9 to 1158.7 px, the
// horizon moved 66.3 px on a 941 px frame. Every centimetre and every square
// metre that census published is a number about a camera that no longer frames
// this world, and the shifts are NOT small.
//
//   quantity            old census        re-derived here
//   head, white         13-15 cm          8.2 cm  (p25-75 6.7-8.7, n=16)
//   head, cyan          8-11 cm           7.3 cm  (n=4: not separable from white)
//   stalk               2-3 cm x 10 cm    1-2 cm x ~7 cm (still sub-voxel)
//   heads per m2        2.35              3.0
//   head height         0.17 m            0.111 m
//
// The camera was not taken on trust either: drawn on the target at six times,
// the square the refitted pose says a 10 cm face spans lands on the meadow's
// cubes and the recipe's square is two thirds of one (v4-verde/dev3/righello.py).
//
// AND THE HEAD SHRINKING BY FORTY PER CENT RECONCILES V4 WITH V7. E-V7e measured
// the night lamp's core at 0.103 m -- one voxel exactly -- against a day flower
// the old census called 0.13 to 0.15. A lamp cannot be smaller than the flower
// it is hung in. At 0.082 the two measurements are the same object again.

// AND THE HEAD CAME DOWN AGAIN, BY A TENTH, ON A THIRD READING. The census above
// re-derived 8.2 cm from the pixels the old finder called heads. Read this
// session through the SAME fitted camera, on the twenty-five heads the
// research's own detector marks in its own window and with the voxel measured
// where each head stands, the target's median comes to 7.0 cm; hand-read on the
// two best-resolved heads of that window -- the ones where three faces can be
// told apart -- it comes to 8.5. The pair of them brackets 7.5, and the
// committente's B3 asks for the smaller of two readings that agree this closely.
//
// IT WIDENS THE GAP WITH V7 AND THAT IS SAID HERE. E-V7e measured the night
// lamp's core at 0.103 m; at 8.2 the two were the same object, at 7.5 the lamp
// is a third bigger than the flower it hangs in. That is the night's number and
// this is the day's reading of the day target, so the reading stands and the
// gap goes to the coordinator.
/** The head, in metres. Drawn per flower between the two, uniformly. */
const HEAD_MIN = 0.060;
const HEAD_MAX = 0.090;
/** The size everything below is authored at; a flower scales from it. */
const HEAD_NOMINAL = (HEAD_MIN + HEAD_MAX) / 2;
/** And the cyan head is a tenth smaller: 7.3 cm measured against 8.2. */
const CYAN_SCALE = 0.90;

// THE STALK, AND THE NOTE THAT USED TO STAND HERE CLOSED ITSELF.
//
// It said: <<it is the one thing in this meadow a cube face cannot draw -- two
// centimetres against a lattice of ten>>, and it was right about the lattice it
// had. The mat of grass is a lattice of FIVE now, and E-ERBA-A 6.6 saw the
// consequence before the mat existed: <<con un reticolo da 6 cm lo stelo E' un
// voxel, e la nota si chiude da se'>>.
//
// THE TWO NUMBERS ARE MEASURED. E-ERBA-A 4, on the ritaglio at 16x: the stalk is
// <<una colonna verde piu' stretta della testa -- circa META' della sua
// larghezza, cioe' 4-5 cm -- alta 1-2 fili (6-12 cm)>>. Half of the nominal head
// is 3.75 cm and one and a half blades is 7.5 cm, which is what these two say.
//
// AND THE CORRELATION THE COMMITTENTE ASKED FOR IS ALREADY IN THE FILE, which is
// the whole reason this is two literals and not a law. E-DECISIONI9.1:
// <<DIMENSIONE DELLO STELO E DEL FIORE SONO CORRELATE: la larghezza dello stelo
// varia fra UN QUARTO e MEZZO cubo secondo la dimensione del fiore -- piu'
// grande il bocciolo, piu' spesso lo stelo; anche l'altezza del fiore cambia: un
// fiore piu' basso ha il bocciolo piu' piccolo e lo stelo piu' stretto>>. A
// flower is ONE geometry authored at the nominal head and scaled uniformly per
// instance by size / HEAD_NOMINAL, so the stalk's width and its height already
// follow the head's own draw, exactly and for nothing:
//
//     head 6.0 cm (scale 0.80)   stalk 3.0 cm wide, 6.0 cm tall   1.2 blades
//     head 7.5 cm (scale 1.00)   stalk 3.8 cm wide, 7.5 cm tall   1.5 blades
//     head 9.0 cm (scale 1.20)   stalk 4.5 cm wide, 9.0 cm tall   1.8 blades
//
// which is his <<un quarto a mezzo cubo>> (2.5 to 5 cm) and E-ERBA-A's <<1-2
// fili>>, both, out of one draw.
const STALK_WIDE = HEAD_NOMINAL / 2;
const STALK_TALL = 0.075;

// HOW MUCH LOWER THE HEAD IS THAN IT IS WIDE, from the census of nineteen heads.
//
// E-ERBA-A 4 measured the head at 8.2 cm across and 6.3 cm tall: p50 to p50, the
// bud of the target is NOT a cube, it is squat by a quarter. The committente read
// the same thing from the other side (E-DECISIONI9.1): <<il bocciolo e' un cubo
// che varia di scala (i fiorellini piccoli) ma puo' variare anche SOLO IN ALTEZZA
// (non piu' un cubo: i fiori piu' aperti)>>.
//
// WHAT IS BUILT IS THE CENSUS AND WHAT IS NOT IS DECLARED. 6.3 over 8.2 is the
// number below and it is a constant of the geometry, so it costs nothing: the
// head that ships is the median head of the target. Making the squat vary from
// flower to flower is a SECOND per-instance attribute -- the scale is the one
// there is -- and the census of nineteen heads does not resolve its spread, so
// the number given to it would be invented. It is carried to the coordinator as
// a proposal in the verbale rather than taken here.
const HEAD_SQUAT = 6.3 / 8.2;

// AND THE SMALL ONES STAND ROUND THE BIG ONES. E-DECISIONI9.1: <<spesso i fiori
// grandi sono circondati da qualche fiorellino piu' piccolo>>.
//
// A cell of the sowing holds up to FLOWER_PER_CELL candidates. The first of them
// draws its size freely; the others are pulled DOWN by however big the first one
// came out, so a cell that seated a large head seats small companions and a cell
// that seated a small one is unchanged. It is one hash -- the first candidate's
// own draw, recomputed, which is deterministic -- and no state.
const COMPANION = 0.55;

// HOW MANY HEADS STAND ON A SQUARE METRE. Two measurements that agree:
//   - counted by eye, head by head, on a window of open meadow blown up five
//     times: 8 heads over 2.62 m2 of ground = 3.05/m2;
//   - a finder whose recall was checked against that same count (7 of 8 = 0.88)
//     over 4.95 m2 of open meadow in the band where it resolves: 2.8/m2, which
//     is 3.2 once the recall is taken out.
// The old census read 2.35, and the whole of that difference is the two
// corrections above: the same eight heads, at the head height the anatomy gives
// rather than an assumed 0.30 m, over the ground the refitted pose puts under
// those pixels.
const FLOWER_PER_M2 = 3.0;

// HOW FAR THE SOLID FLOWERS REACH, AND WHERE THE SECOND FAMILY TAKES OVER.
//
// A solid flower is EIGHTEEN triangles: five faces of a head and four of a
// stalk. At three heads a square metre that is 54 triangles of meadow per
// square metre, and the cost of a ring grows with the SQUARE of its reach.
// E-V4c leaves V4 ten to twelve thousand triangles and the hub's trees have
// taken 3,808, so:
//
//   6.5 m   392 heads   7,056 tri   <- what one family alone could afford
//   8.0 m   570 heads  10,260 tri
//  10.0 m   925 heads  16,650 tri   <- where the top tier's lever reaches
//    18 m  ~2,600 heads ~47,000 tri <- what the target's own reach would cost
//
// The first three are MEASURED in the running frame at these radii
// (v4-verde/dev3/portata.mjs), not extrapolated; the last is the same law
// carried out to where the target's census still counts heads.
//
// THE TARGET SHOWS HEADS OUT TO EIGHTEEN METRES, and a single family of solids
// stops at six and a half -- which is not a visibility limit (an 8 cm head
// still reads nine pixels at eighteen metres and the census counts them there)
// but the allocation. E-V4h ratified the answer: a SECOND family for the far
// half, one camera-facing quad a head, priced below and charged to the
// campaign's margin. So this radius is no longer where the meadow ends. It is
// where the meadow CHANGES REPRESENTATION -- the exchange ring -- and past it
// FAR_REACH carries on.
const FLOWER_RADIUS = 6.5;
const FLOWER_RADIUS_MAX = 10.0;
/** Never nought: a ring inside its own fade band has nothing left to draw. */
const FLOWER_RADIUS_MIN = 2.1;

// THE LATTICE, AND IT IS SIZED BY WHAT THE SOWING HAS TO LOOK LIKE. A cell and
// a candidate count fix the SHARE of candidates that stand, and that share is
// what decides whether a meadow reads as a scatter or as a grid: at four fifths
// of a metre and two candidates the share comes to 0.96, which stands almost
// every candidate and puts almost exactly two heads in every square of the
// lattice -- no clumps and no clearings, which is the one thing the target's
// meadow certainly is not. At this cell the share is 0.45, so a cell holds
// nought, one or two, and the clumping is the binomial's rather than a
// designer's. What it costs is a refill every 0.55 m of walking instead of
// every 0.80, and the refill is measured in the verbale.
const FLOWER_CELL = 0.55;
const FLOWER_PER_CELL = 2;
const FLOWER_SHARE = (FLOWER_PER_M2 * FLOWER_CELL * FLOWER_CELL) / FLOWER_PER_CELL;
const FLOWER_SEED = 1049;


// HOW FAR THE SECOND FAMILY CARRIES THE MEADOW, AND WHERE IT STOPS.
//
// Eighteen metres is the target's own reach, read off its census: at that range
// an 8 cm head is nine pixels and the finder still resolves it. Past it the
// heads the target shows are under the instrument floor, so drawing them would
// be drawing a claim nothing measured.
//
// The rim is the one place the far family keeps the trim the solids gave up: a
// quad leaves by shrinking over the last metres, because there is nothing
// beyond it to take over and a meadow that ended in a line at eighteen metres
// would read as an edge.
const FAR_REACH = 18.0;
const FAR_REACH_MAX = 20.0;
const FAR_FADE = 2.5;

// AND HOW FAR IT CARRIES THE CYAN ONES, WHICH IS A NEARER EDGE AND A DIFFERENT
// READING. A cyan head is a tenth smaller than a white one and it stands on
// meadow three times darker -- the law under CYAN_IN_SHADE, in linear luminance
// 0.054 against 0.162 -- so it leaves the target's census sooner. Past eight
// metres the census resolves thirteen white heads against a SINGLE cyan, at
// 10.34 m on the edge of the west middle window; inside eight it resolves three
// in the two near windows alone, at 6.64, 6.83 and 6.92 m.
//
// So the rule is cyan to here and whites beyond, and it FOLLOWS THE TARGET
// RATHER THAN THE RING. Both the exchange and the tier are this machine's
// affordances, and a reading of the target does not get shorter because a
// laptop is slower: a tier that pulls the exchange in to 4.11 m simply hands
// this family more of the cyan to carry, and the meadow keeps its composition.
const CYAN_REACH = 8.0;

// WHAT THE FAR LATTICE IS FILLED WITH, AND WHY IT IS NOT REFILLED AS OFTEN AS
// THE SOLIDS ARE. The far ring holds five to six times the candidates the solid
// ring does -- eighteen metres against six and a half -- and refilling it on
// the solids' own 0.55 m cell would put that whole sweep into one frame every
// half metre of walking. It does not have to: WHERE a quad stands is a fact
// about the lattice and not about the walker, and both of the far family's
// trims -- the exchange ring at the near edge and the shrink at the rim -- are
// worked out in the SHADER against the walker's live position. So the buffer
// only has to HOLD every quad the two trims might want, and it is refilled when
// the walker leaves a coarse cell, filled with this much slack past the rim so
// that everything the trims can ask for is already in it.
// HOW THE REFILL IS PAID FOR, AND IT IS THE ONE PIECE OF ENGINEERING IN THIS
// FAMILY. The far ring holds five to six times the candidates the solid ring
// does -- eighteen metres against six and a half -- and swept whole it MEASURED
// 14.6 ms on this machine against the solid ring's 2.1: a dropped frame every
// half metre of walking, which is worse than the 9.50 ms DEV3 found and cured
// in the solids and would be a plain regression.
//
// It is not swept whole. The sweep is cut into slices, one a frame, writing
// into a shadow buffer that is published only when it is complete. WHAT MAKES
// THAT SAFE is that the buffer holds a SUPERSET and both trims are the shader's:
// while a sweep is in flight the live buffer is the previous one, centred where
// the walker was a fifth of a second ago, and the exchange ring and the rim are
// still worked out against the walker's live position. So a stale fill costs
// coverage at the edges and never correctness -- which is what FAR_SLACK is
// sized for.
const FAR_STEP = FLOWER_CELL;
const FAR_SLICE = 340;
// How far INSIDE the exchange the buffer is filled, and it is sized against the
// WALL CLOCK rather than against a frame count. A candidate can stand up to a
// cell from its own cell and the walker up to 0.39 m from the centre of the
// cell the fill was anchored at, but the term that dominates is the walker
// moving while the sweep is in flight -- and a sweep is fourteen frames, which on
// this machine and this frame is most of a SECOND, not a sixth. Measured
// (sweepMs in the stats, put there for exactly this): at the run speed of
// layout.js that is four metres. Widening the fill INWARDS is cheap -- the
// circle it adds is small and near -- so it is widened past what is needed,
// which is what keeps a slow frame from opening a bare ring just outside the
// exchange.
const FAR_SLACK = 5.0;
// AND THE CYAN EDGE IS FILLED WITH THE SAME SLACK, FOR THE SAME REASON AND AT A
// PRICE THAT IS DECLARED. What the shader trims cyan at is CYAN_REACH of the
// walker's LIVE position, so the buffer has to hold every cyan head that could
// come inside it before the next sweep lands -- which is the same walker moving
// during the same second, so it is the same five metres. Filled any tighter and
// the cyan of the judged band would come and go once a sweep at walking pace,
// because at 3 m/s the fill is already three metres behind by the time it
// lands: a flicker of the three heads this rule exists to draw, which is worse
// than the buffer it saves. What it costs is cyan candidates between eight and
// thirteen metres that collapse in the vertex shader and draw no pixel, counted
// and charged with the rest of the scroll in the verbale.
const CYAN_FILL = CYAN_REACH + FAR_SLACK;
// AND THE OTHER EDGE IS NOT WIDENED AT ALL, because out there the same slack
// would be a ring three metres wide at eighteen metres out -- five hundred
// quads of buffer that never draw a pixel. What is done instead is to draw only
// as far as the buffer is KNOWN to reach: the rim is pulled in by however far
// the walker has moved from the fill it is currently drawing. The whole of that
// movement is inside the rim's own fade band, so it is a slow swell of the
// faintest heads in the frame rather than a bite out of the meadow.

// WHERE THE CYAN ONES ARE, AND IT IS A FACT ABOUT THE GROUND RATHER THAN ABOUT
// THE FRAME. The analysis verbale states this law as a table of SECTORS of the
// day target -- east near 10:1, west near 2:1 -- and a generator cannot use
// that: a meadow whose composition depends on where somebody stood stops being
// a meadow the moment the walker turns round.
//
// Asked of the GROUND instead, the same finds answer cleanly. The meadow under
// a cyan head reads 0.054 in linear luminance; the meadow under a white head
// reads 0.162 -- three times brighter -- and the cyan share falls monotonically
// with it: 0.50 on the darkest meadow, 0.21, then 0.10 and 0.10 on the two
// brightest bands. That is a curve, and a curve can be implemented.
//
// WHAT THIS WORLD DOES NOT HAVE, SAID PLAINLY. The thing driving that curve in
// the target is a soft shade bank across the near west, and there is no such
// thing here: the ground of a voxel world is flat topped, every top face makes
// the same two terms, and the light this file hands a card is FOUR TEXELS
// precisely because there is nothing for it to vary over. So the shade cannot
// be read -- it has to be stood in for, and it is stood in for by patches of
// the same value noise the ground's own density uses, at the scale the target's
// bank measures. The day V1 or V7 give the disc a shadow, this is the one
// function that has to change and it is written to be that function.
const CYAN_IN_LIGHT = 0.10;
const CYAN_IN_SHADE = 0.50;
/** About fourteen metres, which is the width of the bank the target shows. */
const SHADE_SCALE = 0.07;
/** Biased towards the light, so the realised share lands where it is measured. */
const SHADE_BIAS = 2.2;

// The pigments, and where each one comes from is in the note over FLOWER_PIGMENT.
const FLOWER_TINT = { min: 0.94, max: 1.06 };

const VERTEX = /* glsl */`
  attribute vec4 aOffset;   // world x, y, z, and the scale of the card
  attribute vec4 aParams;   // cos and sin of the yaw, cell of the sheet, tint
  attribute float aGrade;   // where this card sits in the sowing, nought to one

  varying vec2 vUv;
  varying vec3 vTint;
  varying float vFog;

  uniform sampler2D tLight;
  uniform vec2 uCentre;     // where the ring is centred, in world x and z
  uniform float uRadius;
  uniform float uFade;
  uniform float uCut;       // cards graded above this are not standing
  uniform float uBand;      // and this much below it is where they shrink away
  uniform vec2 uCellSize;   // one cell of the sheet, in texture units
  uniform float uColumns;

  ${SCENE_LIGHT_GLSL}
  // THE ONE PRODUCER OF THE PAIR, and what a pair is worth as light, from
  // src/world/face-light.js. This file used to write that arithmetic out for
  // itself and had already drifted from the seat: it multiplied the terms by
  // the exposure without passing them through the lift, so a sweep that moved
  // the lift moved the stone and the ground and left the grass where it was.
  ${faceLightGlsl()}
  // BILINEAR here and not the cubic, declared: this read is in the VERTEX
  // shader, once per card, and four taps a vertex would buy a card that covers
  // far more texels than it has vertices nothing at all. What it DOES need is
  // the unpacking — the sky term lives in alpha.
  ${BAKED_TERMS_GLSL}
  ${FOG_GLSL}

  void main() {
    vec3 base = aOffset.xyz;

    // The fade is worked out here rather than when the ring was filled, and
    // that is what makes the ring seamless: a cell that has just entered is at
    // the rim, where this is zero, so it grows in from nothing instead of
    // appearing. The walker never sees the moment a cell is added.
    float reach = length(base.xz - uCentre);
    float trim = 1.0 - smoothstep(uRadius - uFade, uRadius, reach);

    // And how much of the sowing is standing at all. The tier moves this
    // threshold and a card crosses it by shrinking over whatever width the
    // crossing asks for. At rest the width is nought and this is a plain
    // comparison, which is the sowing the ring was filled with and nothing else.
    float keep = clamp((uCut - aGrade) / max(uBand, 1e-5), 0.0, 1.0);

    float scale = aOffset.w * trim * trim * keep;

    vec3 local = position * scale;
    // Yaw only. A card leaning with the ground would need a normal nobody is
    // going to read, and there is no wind in the reference.
    vec3 world = base + vec3(
      local.x * aParams.x - local.z * aParams.y,
      local.y,
      local.x * aParams.y + local.z * aParams.x);

    // THE BRIDGE. One tap of the ground's own light, and the pair in it turned
    // into light by the seat that produces it. The tap is of FOUR TEXELS: a
    // card stands on the ground and the ground faces up, so the two terms are
    // the same everywhere on the disc and the map of them has nothing to vary
    // over. Read in the vertex shader and not the fragment one: a card is
    // eighteen vertices and covers far more texels than that.
    vec3 light = faceLightOf(bakedTerms(tLight, vec2(0.5)).xy);

    vec2 cell = vec2(mod(aParams.z, uColumns), floor(aParams.z / uColumns));
    vUv = (cell + uv) * uCellSize;
    vTint = light * aParams.w;
    vFog = fogAmount(length(cameraPosition - world), world.y);

    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const FRAGMENT = /* glsl */`
  precision highp float;

  varying vec2 vUv;
  varying vec3 vTint;
  varying float vFog;

  uniform sampler2D tAtlas;
  uniform vec3 uFogColour;
  uniform float uCutoff;

  void main() {
    vec4 sheet = texture2D(tAtlas, vUv);

    // The cut, widened to one pixel of screen space. The hardware turns the
    // value below into a coverage mask over the samples of the frame buffer, so
    // the rim of a blade is resolved by the multisampling that is already being
    // paid for rather than by a pass of its own. A hard step here makes every
    // blade in the ring crawl as the walker moves.
    float edge = (sheet.a - uCutoff) / max(fwidth(sheet.a), 1e-4) + 0.5;
    if (edge <= 0.0) discard;

    vec3 colour = mix(sheet.rgb * vTint, uFogColour, vFog);
    gl_FragColor = vec4(colour, clamp(edge, 0.0, 1.0));
  }
`;

// ------------------------------------------------------------- the bridge

/**
 * The ground's own light, as four texels, kept current with the one sun.
 *
 * WHY A MAP AT ALL, WHEN IT HOLDS ONE VALUE. Because it is a map of the GROUND
 * and that is a contract: src/world/contracts.js seats `groundLightAt` between
 * V1, which owns what the ground's light is, and this file, which eats it. What
 * this used to be handed was the delivered terrain light atlas -- 2048 by 2048,
 * 326 kB of it -- read through a function that undid the power law bending the
 * old ground's grid. That atlas is a bake of a ground this world no longer has,
 * and reading it lit the cards off Cycles while the cubes beside them were lit
 * analytically: the cards came out the brightest population in the frame.
 *
 * WHY FOUR TEXELS IS THE WHOLE OF IT TODAY. A card stands on the ground, the
 * ground of a voxel world is flat topped, and a flat face pointing up makes the
 * same two terms wherever it stands: the cosine the sun turns to the vertical,
 * and a whole hemisphere of sky. There is nothing for a map to vary over, so
 * the map is two by two and weighs sixteen bytes.
 *
 * AND IT IS NOT WRITTEN ONCE. The sun moves -- a preset change moves it, and
 * the night is a preset change. Baked at build time this would go on lighting
 * the grass at noon after the cubes beside it had gone dark, which is the same
 * defect as the atlas and harder to see.
 *
 * The pair itself is face-light's, for a face whose normal is (0, 1, 0): this
 * is the one place in the world it is written on the CPU, and it is written
 * here because a texture has to be filled by somebody.
 */
function groundLightBridge() {
  const side = 2;
  const data = new Uint8Array(side * side * 4);
  const texture = new DataTexture(data, side, side, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  let written = -1;

  function refresh() {
    // faceTerms(vec3(0, 1, 0)): the sun term is the cosine with the vertical,
    // and the sky term is 0.5 + 0.5 * 1 = one, a whole hemisphere.
    const sun = Math.max(SUN_DIRECTION.y, 0);
    if (sun === written) return;
    written = sun;
    // The sun term travels through the sRGB transfer a texture tagged sRGB is
    // decoded by, so it is encoded here the same way; the sky term travels in
    // alpha, which no transfer touches, as its own square root -- which is what
    // bakedTerms squares back up. A whole hemisphere is one, so alpha is full.
    const encoded = sun <= 0.0031308 ? sun * 12.92 : 1.055 * sun ** (1 / 2.4) - 0.055;
    const r = Math.round(Math.max(0, Math.min(1, encoded)) * 255);
    for (let i = 0; i < side * side; i++) {
      data[i * 4] = r;
      data[i * 4 + 1] = r;
      data[i * 4 + 2] = r;
      data[i * 4 + 3] = 255;
    }
    texture.needsUpdate = true;
  }

  refresh();
  return { texture, refresh };
}

/**
 * The card: quads crossed about the vertical, standing on the ground.
 *
 * Every quad carries the whole cell of the sheet and every other one is
 * mirrored, so the faces of one tuft are not copies of the same picture seen
 * from three sides.
 */
function cardGeometry(quads, width, height, lean = 0) {
  const positions = new Float32Array(quads * 4 * 3);
  const uvs = new Float32Array(quads * 4 * 2);
  const indices = new Uint16Array(quads * 6);

  for (let q = 0; q < quads; q++) {
    const angle = (q / quads) * Math.PI;
    const dx = Math.cos(angle) * width / 2;
    const dz = Math.sin(angle) * width / 2;
    const flip = q % 2 === 1;
    // Every quad leans the same way in the card's own frame, and the instance
    // then turns the whole tuft. Upright quads are invisible from directly
    // above except as the star their crossing makes; leaning them means a
    // walker looking at their own feet sees blades lying over, which is what
    // grass does.
    const corners = [
      [-dx, 0, -dz, flip ? 1 : 0, 1],
      [dx, 0, dz, flip ? 0 : 1, 1],
      [dx + lean, height, dz, flip ? 0 : 1, 0],
      [-dx + lean, height, -dz, flip ? 1 : 0, 0],
    ];
    for (let c = 0; c < 4; c++) {
      const o = (q * 4 + c) * 3;
      positions[o] = corners[c][0];
      positions[o + 1] = corners[c][1];
      positions[o + 2] = corners[c][2];
      const t = (q * 4 + c) * 2;
      uvs[t] = corners[c][3];
      uvs[t + 1] = corners[c][4];
    }
    const base = q * 4;
    const k = q * 6;
    indices[k] = base; indices[k + 1] = base + 1; indices[k + 2] = base + 2;
    indices[k + 3] = base; indices[k + 4] = base + 2; indices[k + 5] = base + 3;
  }

  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

// ------------------------------------------------------------------ density

const FOOTPRINTS = (() => {
  const list = [];
  // Everything below is worked out once. The ring is refilled several times a
  // second while the walker moves and it asks this question for every candidate
  // spray, so a cosine evaluated in that loop is a cosine evaluated many
  // thousands of times a second.
  for (const m of MONOLITHS) {
    const [w, , d] = m.size;
    list.push({
      x: m.position.x, z: m.position.z, rotation: m.rotationY * DEG,
      halfX: w / 2, halfZ: d / 2,
      // How far past the stone an accent is allowed to climb. Kept, and kept
      // generous, for the same reason it always was: the targets grow green
      // over the joint a block makes with the ground rather than stopping
      // politely at it. What has changed is who draws the mass of that green --
      // E-V4d gives the raised carpet to V1 -- and this only says that a spray
      // standing there is not deleted for standing there.
      skirt: 0.95,
    });
  }
  list.push({
    x: PLATFORM.x, z: PLATFORM.z, rotation: PLATFORM.rotationY * DEG,
    halfX: PLATFORM.width / 2, halfZ: PLATFORM.depth / 2, skirt: 0.5,
  });
  list.push({
    x: STAIRS.x, z: STAIRS.z + STAIRS.tread * STAIRS.steps / 2, rotation: 0,
    halfX: STAIRS.width / 2, halfZ: STAIRS.tread * STAIRS.steps / 2, skirt: 0.3,
  });
  for (const rock of ROCKS) {
    list.push({
      // Well inside the silhouette. A rock is round and this test is square, so
      // a footprint that reached the full radius would clear the grass away in
      // a ring the stone does not fill, and the reference has the tufts coming
      // right up under every boulder.
      x: rock.x, z: rock.z, rotation: 0,
      halfX: rock.radius * 0.58, halfZ: rock.radius * 0.58,
      skirt: Math.max(0.45, rock.radius * 0.9),
    });
  }
  for (const shape of list) {
    shape.cos = Math.cos(shape.rotation);
    shape.sin = Math.sin(shape.rotation);
    // Radius past which the shape cannot possibly matter: one comparison that
    // rejects almost every shape for almost every spray.
    shape.reach = Math.sqrt(shape.halfX * shape.halfX + shape.halfZ * shape.halfZ) + shape.skirt;
    shape.reachSquared = shape.reach * shape.reach;
  }
  return list;
})();

function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Value noise, the same shape as the one the ground is shaped and painted with. */
function noise2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

/**
 * How much vegetation stands at a point of the meadow, from nought to one.
 *
 * The path and the built stone take it to nought outright, and the edge of the
 * stone is a ramp rather than a line so an accent leans over the last slab
 * exactly as the ground's own green eats into it.
 */
function densityAt(x, z) {
  let density = 1;

  const run = pathRun(z);
  if (run > 0.001) {
    const d = Math.abs(pathCoord(x, z));
    density *= 1 - run * (1 - smoothstep(0.78, 1.08, d));
    if (density < 0.02) return 0;
  }

  for (let i = 0; i < FOOTPRINTS.length; i++) {
    const shape = FOOTPRINTS[i];
    const dx = x - shape.x;
    const dz = z - shape.z;
    if (dx * dx + dz * dz > shape.reachSquared) continue;
    const lx = Math.abs(dx * shape.cos - dz * shape.sin) - shape.halfX;
    const lz = Math.abs(dx * shape.sin + dz * shape.cos) - shape.halfZ;
    if (lx < 0 && lz < 0) return 0;
    const ox = lx > 0 ? lx : 0;
    const oz = lz > 0 ? lz : 0;
    const outside = Math.sqrt(ox * ox + oz * oz);
    if (outside < shape.skirt) {
      density *= 1 + 0.6 * (1 - outside / shape.skirt);
    }
  }

  // Broad thin and thick patches, so the sowing never reads as an even one.
  return clamp01(density * (0.60 + 0.75 * noise2(x * 0.085 + 31.7, z * 0.085 + 9.3)));
}

// ------------------------------------------------------------------- the ring

/**
 * The cells of the disc, in radial order.
 *
 * Filled outwards from the walker so the near cards are submitted first: with
 * the depth test in front of the shader, a fragment hidden behind a spray that
 * was already drawn is thrown away before it costs anything. Sorting instances
 * every frame would cost more than it saves; sorting the lattice once costs
 * nothing at all, because the ring is always centred on the walker and the
 * distance to a cell is therefore its distance from the centre.
 */
function ringOffsets(radius, cell) {
  const reach = Math.ceil(radius / cell) + 1;
  const offsets = [];
  for (let j = -reach; j <= reach; j++) {
    for (let i = -reach; i <= reach; i++) {
      const d = Math.hypot(i, j) * cell;
      if (d > radius + cell) continue;
      offsets.push({ i, j, d });
    }
  }
  offsets.sort((a, b) => a.d - b.d);
  return offsets;
}

function makeMaterial({ atlas, light, lightScale, columns, rows, radius, fade: band }) {
  return new ShaderMaterial({
    uniforms: {
      tAtlas: { value: atlas },
      tLight: { value: light },
      // The sun, the exposure and the two lifts, from the one seat that
      // produces the pair they act on -- and at the GROUND's exposure, because
      // what a card is lit by is the ground it stands on. Shared by reference
      // with the rest of the world: src/world/voxel/material.js asks for the
      // same line, so a cube and a spray at its foot cannot disagree.
      ...faceLightUniforms(lightScale * GROUND_EXPOSURE),
      ...SCENE_LIGHT_UNIFORMS,
      uCentre: { value: new Vector2() },
      uRadius: { value: radius },
      uFade: { value: band },
      uCut: { value: 1 },
      uBand: { value: 0 },
      uCellSize: { value: new Vector2(1 / columns, 1 / rows) },
      uColumns: { value: columns },
      uCutoff: { value: ALPHA_CUTOFF },
      ...fogUniforms(),
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    // Both faces: a card is a sheet with no inside, and culling one side would
    // make half the sprays of the ring disappear depending on where the walker
    // stands.
    side: DoubleSide,
    // Never transparent. The whole plan depends on these writing depth.
    transparent: false,
    alphaToCoverage: true,
    fog: false,
  });
}

function instanced(geometry, capacity) {
  const offsetData = new Float32Array(capacity * 4);
  const paramData = new Float32Array(capacity * 4);
  const gradeData = new Float32Array(capacity);
  const offsetAttribute = new InstancedBufferAttribute(offsetData, 4);
  const paramAttribute = new InstancedBufferAttribute(paramData, 4);
  const gradeAttribute = new InstancedBufferAttribute(gradeData, 1);
  offsetAttribute.setUsage(DynamicDrawUsage);
  paramAttribute.setUsage(DynamicDrawUsage);
  gradeAttribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute('aOffset', offsetAttribute);
  geometry.setAttribute('aParams', paramAttribute);
  geometry.setAttribute('aGrade', gradeAttribute);
  geometry.instanceCount = 0;
  return {
    offsetData, paramData, gradeData, offsetAttribute, paramAttribute, gradeAttribute,
  };
}

/** The moving ring of cards around the walker. */
function createRing({
  atlas, light, lightScale, geometry, columns, rows, cellFrom, cellCount,
  radius, maxRadius = radius, cellSize, perCell, scaleRange, height, density,
  seed, tint, sink, fade: fadeBand = RING_FADE,
}) {
  const offsets = ringOffsets(maxRadius, cellSize);
  const capacity = offsets.length * perCell;
  const buffers = instanced(geometry, capacity);
  // The ring follows the walker, so nothing is ever gained by testing it
  // against the frustum: the sphere exists only so three.js has one.
  geometry.boundingSphere = new Sphere(new Vector3(), maxRadius + 2);

  const material = makeMaterial({
    atlas, light, lightScale, columns, rows, radius, fade: fadeBand,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'grass-accent';
  mesh.frustumCulled = false;
  // After the ground and the stone, so the depth buffer is already full of
  // everything solid by the time the first card is shaded.
  mesh.renderOrder = 1;

  let lastCellX = null;
  let lastCellZ = null;
  let placed = 0;
  let rebuildMs = 0;
  // How far out the ring is filled, and how much of the sowing is asked for.
  // The lattice is laid down for the second of these and the shader decides
  // what stands: filling it for less would mean refilling it to grow.
  let reach = radius;
  let sown = 1;
  let shown = radius;

  function rebuild(cellX, cellZ) {
    const started = performance.now();
    const { offsetData, paramData, gradeData } = buffers;
    let n = 0;
    for (const offset of offsets) {
      if (offset.d > reach + cellSize) break;
      const gx = cellX + offset.i;
      const gz = cellZ + offset.j;
      for (let k = 0; k < perCell; k++) {
        const r1 = hash2(gx * 73856093 + k * 19349663, gz * 83492791 + seed);
        const r2 = hash2(gx * 19349663 + seed, gz * 73856093 + k * 83492791);
        const x = (gx + r1) * cellSize;
        const z = (gz + r2) * cellSize;

        // One draw of the dice per candidate against the density here, which
        // thins the sowing out smoothly instead of switching whole cells on and
        // off. The draw is kept, not only its verdict: it is what tells the
        // shader where this card stands in the sowing, so a tier that wants
        // less of it takes the same cards away every time and takes them away
        // by degrees.
        const roll = hash2(gx * 26699 + k * 7919, gz * 15485863 + seed * 31);
        const limit = density(x, z);
        if (limit <= 0 || roll > limit * sown) continue;

        const r3 = hash2(gx * 40503 + k * 65867, gz * 92083 + seed * 17);
        const r4 = hash2(gx * 92083 + seed * 13, gz * 40503 + k * 65867);
        const yaw = r3 * Math.PI * 2;
        const o = n * 4;
        offsetData[o] = x;
        offsetData[o + 1] = height(x, z) - sink;
        offsetData[o + 2] = z;
        offsetData[o + 3] = scaleRange.min + (scaleRange.max - scaleRange.min) * r4;
        paramData[o] = Math.cos(yaw);
        paramData[o + 1] = Math.sin(yaw);
        paramData[o + 2] = cellFrom + Math.floor(r1 * cellCount) % cellCount;
        // A card a little darker or lighter than its neighbour. Small on
        // purpose: a wide spread here reads as noise rather than as grass.
        paramData[o + 3] = tint.min + (tint.max - tint.min) * r2;
        gradeData[n] = roll / limit;
        n++;
        if (n >= capacity) break;
      }
      if (n >= capacity) break;
    }

    placed = n;
    geometry.instanceCount = n;
    buffers.offsetAttribute.needsUpdate = true;
    buffers.paramAttribute.needsUpdate = true;
    buffers.gradeAttribute.needsUpdate = true;
    rebuildMs = performance.now() - started;
  }

  return {
    mesh,
    update(position) {
      material.uniforms.uCentre.value.set(position.x, position.z);
      const cellX = Math.floor(position.x / cellSize);
      const cellZ = Math.floor(position.z / cellSize);
      if (cellX !== lastCellX || cellZ !== lastCellZ) {
        lastCellX = cellX;
        lastCellZ = cellZ;
        rebuild(cellX, cellZ);
      }
    },

    /**
     * The state of the ring, which the shader reads and the lattice follows.
     *
     * `sown` is how far the lattice is filled and `cut` is how much of what it
     * holds is standing; they are the same number at rest and part company only
     * while a tier change is being crossed, so that the cards on their way out
     * are still in the buffer to shrink.
     */
    setState({ cut, band, radius: wanted, sown: fill }) {
      material.uniforms.uCut.value = cut;
      material.uniforms.uBand.value = band;
      shown = wanted;
      material.uniforms.uRadius.value = Math.max(fadeBand + 0.5, shown);
      if (fill !== sown || wanted > reach) {
        sown = fill;
        reach = Math.max(reach, wanted);
        lastCellX = null;
      }
      // Cards are only ever dropped from the lattice once nothing is standing
      // out there, so shrinking the reach waits for the fade to have finished.
      if (band <= 0 && wanted < reach) {
        reach = wanted;
        lastCellX = null;
      }
    },

    stats: () => ({ capacity, placed, rebuildMs, triangles: placed * geometry.index.count / 3 }),
    setVisible(visible) { mesh.visible = visible; },
  };
}

// ------------------------------------------------------------------ flowers

/**
 * The pigments of a flower, from the SEAT and not from a tavolozza.
 *
 * assets-src/vegetation/palette.json is dead for this world and is not read
 * here or anywhere else any more: it is sampled off the photorealistic
 * reference through the light of a Cycles bake, and its blue is 3.7x out
 * (E-V4f.3). What replaces it is the same construction DEV1 used for the grass
 * sheet and DEV2 for the foliage -- except in one place, and the exception is
 * worth more than the rule.
 *
 * WHERE THE RATIO CONSTRUCTION STOPS WORKING, MEASURED. A crown is green and
 * the meadow is green, so a crown's pigment can be the meadow's times a ratio
 * read off the picture. A WHITE flower cannot: the meadow's pigment has its
 * blue at 0.045, which is as near nought as makes no difference, and dividing a
 * white flower's blue by it comes to 36x and hands back an "albedo" of 1.64.
 * That is not an albedo. The method that carried the foliage does not carry a
 * white, and it fails quietly -- it hands back a number rather than an error.
 *
 * SO WHAT IS TAKEN FROM THE PICTURE IS WHAT THE LIGHT CANNOT FALSIFY: ratios
 * between things standing in the SAME picture under the SAME light at levels
 * near enough that the tone curve is locally a straight line.
 *
 *   - the WARM face against the pale one, INSIDE one head: 0.747, 0.686, 0.355
 *     (n = 7 heads). Same material, same light, a few levels apart. That ratio
 *     is kept as a reading and is no longer used as a pigment: it carries the
 *     hue of the target's band AND three quarters of a stop of its own shading,
 *     and the shading was already the light's to do -- counted twice, the band
 *     came out a dark olive where the target draws a pistil. What is authored
 *     from it is PISTIL_HUE, which is its direction with the level taken out.
 *   - the LUMINANCE STEP from a head to the meadow immediately around it, which
 *     has the light in it twice and therefore not at all: white 3.61x (n = 23),
 *     cyan 2.21x (n = 7).
 *
 * AND THE LEVEL COMES OFF THE FRAME, which is how V1 fitted the meadow's own
 * pigment and is said in material.js in those words. Swept against the target
 * with v4-verde/dev3/livello.mjs and read back with the SAME code that read the
 * target -- what came of that sweep is written over PALE_STEP below, and it is
 * a ceiling rather than a fit.
 *
 * The pale is authored as a ratio to the SEAT so that the flower moves when V1
 * moves the meadow, exactly as the accent and the foliage do -- a white that
 * stayed put while the ground it stands on changed level would be the same
 * defect the delivered cards had.
 */
/**
 * WHAT THE FLOWER TAKES FROM THE SEAT IS ITS LEVEL AND NOT ITS HUE, and the
 * distinction is the whole of the design. A crown of leaves is green because
 * the meadow is green, so DEV2's foliage takes the meadow's pigment whole and
 * follows it in both. A WHITE flower is white whatever colour the grass turns:
 * if V1 warms the meadow tomorrow, the flower must not warm with it — but if V1
 * takes the meadow's LEVEL down, the flower has to come down with it or the
 * measured step between them stops being the step the target shows.
 *
 * So the level is a multiple of the seat's own luminance, and the hue is the
 * flower's own.
 */
// AND THIS IS ALREADY THE CEILING, WHICH IS THE FINDING. At this step the pale
// comes to 0.949 / 0.901 / 0.704 -- 0.95 in its brightest channel, which is as
// white as a pigment gets before it stops being one. Swept in the frame
// (v4-verde/dev3/livello.mjs, six steps from 0.6x to 1.75x of it), the head's
// step over the meadow beside it goes 1.23 -> 2.28 and NEVER REACHES the 4.11
// the same code reads off the target: at 1.75x the pigment would be 1.57, and
// even there it is short by nearly half.
//
// SO THE GAP IS NOT THE PIGMENT'S, AND IT IS MEASURED WHERE IT IS. Inside ONE
// head -- same geometry, same pigment, two faces -- the brightest fifth over the
// darkest reads 3.73x in the target and 8.51x here: OUR ORIENTATION LADDER IS
// 2.3 TIMES STEEPER. With the side faces that far down, the head's average
// cannot climb where the target's does however high the pigment is raised, and
// that is exactly why the sweep saturates.
//
// AND THAT IS THE HALF OF IT THIS SEAT CAN ANSWER, WHICH IS WHY HEAD_SHADE IS
// BELOW. src/world/face-light.js is not touched and uLift stays at one: the
// world's ladder is the coordinator's and a delivery never fudges it. What is
// answered here is narrower and it is a statement about the OBJECT rather than
// about the light -- how much of that ladder a head of petals takes at all.
const PALE_STEP = 2.5;

// HOW MUCH OF THIS WORLD'S ORIENTATION LADDER A FLOWER HEAD TAKES.
//
// Every flat face here is lit by the one producer in src/world/face-light.js: a
// sun term that is the cosine the face turns to the beam, and a sky term that
// is the share of the hemisphere the face can see. For a CUBE OF GROUND that is
// right and it is frozen. For eight centimetres of petal standing in the open
// it is too steep in both terms at once -- the side turned from the sun takes
// NO sun and half the sky, so it lands three quarters below the top of its own
// head, and at fourteen pixels the two average to the grey blob this campaign
// has been calling a floating cube.
//
// MEASURED, INSIDE ONE HEAD, WITH ONE INSTRUMENT ON BOTH PICTURES: the
// brightest fifth of a head's own box over the darkest fifth reads 1.68 in the
// target (n = 25, p25 1.48, p75 1.88). This is the seat that number is answered
// in, and answering it HERE is what the light's own seat provides for:
// faceLightOf() takes the PAIR precisely so that a material may bend what it
// was given -- the masonry already does it for its relief -- while faceTerms()
// stays the only producer of one.
//
// The bend is a mix towards the pair of the head's OWN TOP FACE, which is the
// one direction that cannot invent light: a petal that catches the open sky is
// the brightest a petal is at this hour, and no face of the head is taken past
// it. At nought the head is uniform -- which is what a voxel game does with a
// flower, and it is a real option that C-TEXTURE §3.6 found in the vanilla
// flower's own geometry ("shade": false) -- and at one it is a block of stone
// again.
const HEAD_SHADE = 0.34;

// WHERE THE PISTIL IS, AND IT IS A BAND AND NOT A FACE.
//
// C-TEXTURE §1.3 measured it on nine heads: the yellow is a VERTICAL BAND ON
// THE EDGE TURNED TO THE EYE plus a HORIZONTAL BAND UNDER THE TOP FACE -- an L
// or a T -- worth a fifth to two fifths of the head, and the cyan ones have
// none of it at all. What stood here was the whole of the two faces along z,
// with the approximation written down beside it: both target poses look along
// that axis, so a head presented its warm face to the camera and a walker who
// turned round saw a different flower.
//
// THIS IS THE SAME READING ON ALL FOUR SIDES INSTEAD OF TWO, and WHERE on a
// side it goes was settled between the two readings the dossiers hold, with the
// numbers of one of them. C-TEXTURE calls it the edge turned to the eye; the
// twenty-look reading this file already carried calls it "a WARM BAND down the
// middle of the face turned to the eye -- about a fifth of its width". The
// POSITIONS C published decide it: the yellow's centroid lands at 29, 34, 34,
// 49 and 60 per cent of the head's width on its five sunlit samples -- the
// MIDDLE of the silhouette, not its rim. Both readings agree there when a head
// is seen corner-on, because then the near edge IS the middle; they part when
// it is seen face-on, and at the poses this campaign judges, with a yaw of 1.8
// degrees off the lattice, every head in the frame is seen face-on. So: down
// the middle of each of the four sides, a fifth of the width, plus the band
// along the top of each. A T on the face that is turned to the walker, from
// every bearing, with no yaw and no billboard.
//
// AND IT IS DRAWN IN THE FRAGMENT OFF A FACE COORDINATE, WHICH IS THE POINT.
// Cut as geometry it would be sixteen quads a head instead of five, for two
// pixels of warm. Carried as a coordinate it costs no vertex and it hands the
// texture session the seat it needs: every side of the head arrives at the
// fragment with its own [0,1] square, so a 16x16 sheet with alpha drops onto
// exactly this without one vertex moving.
const BAND_SPINE = 0.20;
const BAND_TOP = 0.18;

/**
 * That seat, taken: the two widths above, rasterised at sixteen and delivered.
 *
 * WHAT MOVES AND WHAT DOES NOT. The shape and the share do not move -- the sheet
 * is drawn FROM these two constants by tools/materia/foglio.mjs, so its mean is
 * BAND_SPINE + BAND_TOP * (1 - BAND_SPINE) by construction and the far family's
 * own uniform is still the same arithmetic on the same pair. What moves is where
 * the shape LIVES: a rectangle in assets-src/materia/fogli.json rather than two
 * smoothsteps, which is what lets the next reading of the reference's pistil --
 * C 1.6 counts it at 22 to 40 per cent of a head on nine samples, and its edges
 * are not straight -- enter without a shader being edited.
 *
 * AND THE SOFTENING GETS BETTER FOR FREE. The two smoothsteps softened over one
 * screen pixel through an fwidth, which is the right width at exactly one
 * distance; a sheet softens over the FOOTPRINT, and a head receding towards the
 * exchange ring climbs its own mip chain until the last level returns the
 * sheet's mean -- which is the number the far family paints its single quad
 * with. The two halves of the meadow arrive at one colour by construction.
 *
 * @param {import('three').Texture} sheet the delivered 16x16, or nought
 */
function bandSheet(sheet) {
  // No sheet is no pistil, and that is a head this campaign has already shipped
  // rather than a broken one. A one texel picture of nought so the sampler is
  // never null: a null sampler is a different program on some drivers and the
  // same one on others.
  const texture = sheet || new DataTexture(new Uint8Array([0]), 1, 1, RedFormat);
  // CLAMPED, and not as a formality: each side of a head carries its own [0,1]
  // square, so a wrap would fetch the far edge of the band for the near edge of
  // a face.
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  // LINEAR in magnification, because a head is fourteen pixels across and a
  // sixteen texel sheet on it is about a texel a pixel: nearest would put a
  // staircase down the middle of every flower in the frame, and linear softens
  // by very nearly the single pixel the fwidth this replaces was softening by.
  texture.magFilter = LinearFilter;
  texture.minFilter = texture.mipmaps && texture.mipmaps.length > 1
    ? LinearMipmapLinearFilter : LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The pale's own hue, at unit luminance, from the target's heads.
 *
 * FITTED IN THE FRAME AND NOT SAMPLED OFF THE PICTURE, for the reason the whole
 * note above gives: what a pixel of a head reads is the pigment through the
 * light and through the tone curve, and the curve takes most of a pigment's
 * chroma out at this level. Six hues were swept with the two families' uniforms
 * driven from outside the page and read back with the code that reads the
 * target: the head's mask goes from croma 6.8 at the hue that stood here to
 * 18.3, and this one lands it at 13.9 against the target's 13.8.
 *
 * ITS TINT IS FOUR DEGREES OFF AND THE FOUR DEGREES DO NOT CLOSE. The target's
 * mask reads 119; every hue in the sweep that reaches croma 13 reads 115 to 110,
 * and the ones that read 119 are three points of croma short. The pair the
 * campaign is judged on is the croma, so the croma is the one that is landed.
 */
const PALE_HUE = new Vector3(1.000, 1.090, 0.500);
/**
 * The pistil's own hue, at the same unit luminance, and its level as a share of
 * the pale's.
 *
 * IT IS A HUE AND NOT A DARKENING, which is the correction. What stood here was
 * a RATIO to the pale of 0.747 / 0.686 / 0.355, read inside one head between
 * two faces -- and that ratio carries the warmth of the target's band AND three
 * quarters of a stop of its own shading, because the two faces it was read
 * between were lit differently. The shading is already the light's job here, so
 * it was being done twice, and the band came out a dark olive where the target
 * draws a pistil.
 *
 * WHAT IT IS INSTEAD WAS SWEPT IN THE FRAME, eight albedos from (1.00, 0.85,
 * 0.35) to (1.20, 0.80, 0.10), each read back with the same code that reads the
 * target's band. This is the most saturated yellow that is still a PIGMENT --
 * nothing over one in any channel -- and past it the sweep's own reading of R
 * minus B stops climbing.
 */
const PISTIL_HUE = new Vector3(1.472, 0.961, 0.031);
const PISTIL_OF_PALE = 0.679;
/**
 * The cyan's own hue, from its own pixels, at the level its luminance step asks
 * for. It is not a ratio to the meadow for the reason above -- and it cannot be
 * a ratio to the white either, because the census could not find one cyan head
 * standing on sunlit ground to compare with one: they are all in the bank. So
 * its hue is its own and its level is 2.21/3.61 of the white's, which are the
 * two things measured.
 */
const CYAN_HUE = new Vector3(0.34, 0.73, 1.00);
const CYAN_OF_PALE = 2.21 / 3.61;

/**
 * The four pigments, built from the seat at first ask.
 *
 * Read from the seat's own object rather than from a copy of its numbers: DEV1
 * read src/world/voxel/material.js as TEXT with a regex that throws unless the
 * albedo line is exactly one, because a build tool paints a sheet offline and
 * has no other way in. A flower has no sheet, so it can do better than a regex
 * -- it can hold the value itself, which cannot go stale and cannot be one line
 * out of date. What is kept from DEV1 is the part that mattered: if the seat
 * stops publishing a pigment, this THROWS rather than falling back to a default,
 * because a default here would be a second opinion about the meadow's colour
 * quietly painting flowers after V1 had moved the first.
 */
const luma = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;

function flowerPigments() {
  const meadow = voxelSettings().albedo;
  if (!meadow || !(meadow instanceof Vector3)) {
    throw new Error('vegetation: the pigment seat publishes no meadow albedo');
  }
  const level = luma(meadow) * PALE_STEP;
  const pale = PALE_HUE.clone().multiplyScalar(level / luma(PALE_HUE));
  return {
    pale,
    pistil: PISTIL_HUE.clone()
      .multiplyScalar(luma(pale) * PISTIL_OF_PALE / luma(PISTIL_HUE)),
    cyan: CYAN_HUE.clone().multiplyScalar(luma(pale) * CYAN_OF_PALE / luma(CYAN_HUE)),
    // THE STALK IS ITS OWN FAMILY NOW, AND IT IS THE COMMITTENTE'S OWN WORDS.
    //
    // The note that stood here said the stem was at most one pixel wide at the
    // judging range, so a colour measured on it would be a reading about
    // resampling and not about a stem. That was true at 1.5 cm; the stalk is 3 to
    // 4.5 cm now -- half its own head, E-ERBA-A 4 -- which is four to six pixels
    // in the near field, and that is a thing that can carry a colour.
    //
    // E-DECISIONI9.1: <<il colore degli STELI e' un verde piu' intenso,
    // leggermente piu' scuro, MAI MARRONE, che varia un poco di gradazione per
    // zona>>. The first three are the triple src/world/voxel/pigment.js publishes
    // as ALBEDO.stalk, derived from the meadow's own and standing beside it, so
    // the two can never part company.
    //
    // AND THE FOURTH IS NOT BUILT AND IS DECLARED. <<Varia un poco di gradazione
    // per zona>> is the pigment FIELD -- two octaves over the world's XZ, which
    // the ground's fragment rebuilds from a cube's own cell. A flower is an
    // INSTANCE and its fragment has no cell: giving it the field means either an
    // attribute per instance or the field's arithmetic compiled into a second
    // shader. It is a step, it is priced in the verbale of U-ERBA-1, and it is
    // not taken here.
    stalk: new Vector3(...ALBEDO.stalk),
  };
}

/**
 * How much of the meadow at a point stands in for the target's shade bank.
 *
 * @returns {number} nought in full light, one in the deepest of it
 */
function shadeAt(x, z) {
  return noise2(x * SHADE_SCALE + 61.4, z * SHADE_SCALE + 17.9) ** SHADE_BIAS;
}

/**
 * ONE FLOWER, OR NOTHING, FROM ONE CANDIDATE OF THE LATTICE.
 *
 * THIS IS THE ONLY PLACE A FLOWER IS DECIDED, and that is the whole point of it
 * being a function. The ring below draws the flowers near the walker and
 * flowerLightPoints() publishes every flower of the disc for V7 to hang lamps
 * in; if those two answered separately, a lamp would stand where no flower is
 * drawn and nobody would find out until the night was integrated. They call
 * this, with the same lattice and the same seed, and they cannot disagree.
 *
 * @param {number} gx,gz  the cell, in lattice steps
 * @param {number} k      which candidate of the cell
 * @param {Function} height  where the ground is
 */
function flowerAt(gx, gz, k, height) {
  // THE DICE BEFORE THE GROUND, and the order is the whole cost of a refill.
  // densityAt walks thirteen footprints and a noise; the draw against the
  // sowing rejects more than half the candidates on its own, and it cannot
  // reject one the ground would have kept because densityAt is capped at one --
  // so the share IS an upper bound on the limit and testing it first is exact,
  // not an approximation. It takes the ring's refill down by better than half.
  const roll = hash2(gx * 26699 + k * 7919, gz * 15485863 + FLOWER_SEED * 31);
  if (roll > FLOWER_SHARE) return null;

  const r1 = hash2(gx * 73856093 + k * 19349663, gz * 83492791 + FLOWER_SEED);
  const r2 = hash2(gx * 19349663 + FLOWER_SEED, gz * 73856093 + k * 83492791);
  const x = (gx + r1) * FLOWER_CELL;
  const z = (gz + r2) * FLOWER_CELL;

  // AND NOT PAST THE MEADOW, WHICH IS THE ONE THING THIS TEST DID NOT DO.
  // E-V1l reported heads standing over the water outside the disc and left it as
  // a note. It is this line: the two callers clipped separately -- flowerField
  // took a radius and the ring took none -- so a walker at the rim carried the
  // far family twenty metres out over ground that is not meadow but the shell on
  // its way down to the lake. Asked HERE, where a flower is decided, both halves
  // stop at the same edge and neither of them can be given a different one.
  const dist2 = x * x + z * z;
  if (dist2 > DISC_RADIUS * DISC_RADIUS) return null;

  const limit = densityAt(x, z) * FLOWER_SHARE;
  if (limit <= 0 || roll > limit) return null;

  // AND ON A CUBE, WHICH IS ASKED OF THE STORE AND NOT OF A RADIUS. There are
  // two places inside the disc where groundHeightAt answers with a height that
  // has no cube under it, and both of them had heads on them: the RAGGED RIM,
  // where the disc's own columns run out anywhere between 33.5 and 36 m because
  // the world does not end in a circle, and the FOOTPRINT OF THE BUILT STONE,
  // where the columns are cut away over a slightly wider figure than the one
  // densityAt clears the sowing over -- two heads, at (7.80, -2.77) and (7.91,
  // -2.69), against the flank of block 05. Both were standing on the plane the
  // masonry stands on rather than on the meadow. Asked of the column, neither
  // stands at all.
  //
  // IT IS ASKED LAST, AND THAT IS WHAT MAKES IT AFFORDABLE. A column costs 1.2
  // microseconds to work out and the ring asks about every candidate of its
  // lattice several times a second; asked first it would be most of a
  // millisecond a refill. Asked after the sowing and the density, it is asked
  // only of the candidates that were going to stand: 375 in a near refill and
  // 2,584 in a whole far sweep, which is 0.5 ms and 3.2 ms of the 38.8 and 211
  // those two already measure.
  if (columnTop(Math.floor(x / VOXEL), Math.floor(z / VOXEL)) === EMPTY) return null;

  const r3 = hash2(gx * 40503 + k * 65867, gz * 92083 + FLOWER_SEED * 17);
  let r4 = hash2(gx * 92083 + FLOWER_SEED * 13, gz * 40503 + k * 65867);
  // The companions of a big head, and see COMPANION for why it is this hash.
  if (k > 0) r4 *= 1 - COMPANION * hash2(gx * 92083 + FLOWER_SEED * 13, gz * 40503);
  const cyan = r3 < CYAN_IN_LIGHT + (CYAN_IN_SHADE - CYAN_IN_LIGHT) * shadeAt(x, z);
  const size = (HEAD_MIN + (HEAD_MAX - HEAD_MIN) * r4) * (cyan ? CYAN_SCALE : 1);
  const scale = size / HEAD_NOMINAL;
  return {
    x,
    // THE HEAD AND NOT THE GROUND UNDER IT, which is what the contract asks for
    // and what a lamp is hung at: the floor, the MAT, the stalk, and half a head.
    //
    // AND THE MAT IS UNDER IT NOW, WHICH IS THE READING OF THE TARGET. E-ERBA-A 4
    // measured two heads at 30 cm and at 15 cm above the plane and concluded <<i
    // fiori stanno su colonne d'erba di altezza diversa>>, which is
    // E-DECISIONI8.4's <<i fiori sono voxel d'erba + voxel bocciolo col
    // pistillo>> in centimetres. So a flower is seated on the top of the blade
    // beneath it and its stalk starts there; standing it on the terrain put a
    // head half buried in the grass, which is what the render before this showed.
    //
    // IT IS ASKED OF THE LAW AND NOT OF THE MESH. mantoAt is worldgen's own
    // statement of how tall the mat is at a point, the same one the store is
    // written from; asking the picture would be a second opinion, and asking the
    // walker's floor would be wrong on purpose -- groundHeightAt is the PLANE and
    // stays the plane, because the walker goes through the grass
    // (E-DECISIONI9.2) while the flower stands on it.
    y: height(x, z) + mantoAt(x, z) + STALK_TALL * scale + size / 2,
    z,
    size,
    kind: cyan ? 'ciano' : 'bianco',
    // Only the ring needs these two; they cost nothing and keep the two callers
    // reading one record.
    scale,
    tint: FLOWER_TINT.min + (FLOWER_TINT.max - FLOWER_TINT.min) * r1,
  };
}

/**
 * EVERY FLOWER OF THE DISC, deterministically, for whatever wants to read them.
 *
 * V4 publishes all of them and V7 lights a subset under a cap of its own -- the
 * night target burns 150 to 250 points where a meadow of this density offers
 * thousands. Filtering here would be this file deciding the night.
 *
 * @param {Function} height  where the ground is, from the seat that says so
 * @param {number} radius    the walkable disc
 */
export function flowerField(height, radius = 35) {
  const out = [];
  const reach = Math.ceil(radius / FLOWER_CELL);
  const r2 = radius * radius;
  // The corners of the square are not in the disc, and rejecting a cell costs
  // one comparison where rejecting its candidates costs a hash and a density
  // each. It is a fifth of the work of the whole sweep.
  const cellOut = (radius + FLOWER_CELL * 1.5) ** 2;
  for (let gz = -reach; gz <= reach; gz++) {
    for (let gx = -reach; gx <= reach; gx++) {
      const cx = (gx + 0.5) * FLOWER_CELL;
      const cz = (gz + 0.5) * FLOWER_CELL;
      if (cx * cx + cz * cz > cellOut) continue;
      for (let k = 0; k < FLOWER_PER_CELL; k++) {
        const flower = flowerAt(gx, gz, k, height);
        if (!flower) continue;
        if (flower.x * flower.x + flower.z * flower.z > r2) continue;
        out.push({ x: flower.x, y: flower.y, z: flower.z,
          size: flower.size, kind: flower.kind });
      }
    }
  }
  return out;
}

/**
 * EVERYTHING A GATE HAS TO KNOW ABOUT A FLOWER, FROM THE ONE PLACE THAT DECIDES
 * IT, and it exists so that no gate ever holds a second copy of these numbers.
 *
 * The lesson is DEV1's, taken one step further. That build tool read the
 * meadow's albedo out of a material file as TEXT, with an expression that threw
 * if the line was not exactly one -- which worked until the albedo stopped being
 * a line. A guard that read this file the same way would be a guard that stops
 * seeing the flower the day the flower gets a texture. So the flower publishes
 * itself, and what the guard checks is the published thing and not a regex over
 * a source it has to guess at.
 *
 * The pigments come from the SEAT, so this throws exactly where the drawing
 * would: a census that quietly fell back to a default would let a gate pass on
 * a meadow the world no longer paints.
 */
export function flowerCensus() {
  const pigments = flowerPigments();
  return {
    pigments,
    head: { min: HEAD_MIN, max: HEAD_MAX, nominal: HEAD_NOMINAL, cyanScale: CYAN_SCALE },
    stalk: { wide: STALK_WIDE, tall: STALK_TALL },
    // The pistil's band, and the share of ONE SIDE it covers -- the number the
    // far family carries, written once here and read there.
    band: { spine: BAND_SPINE, top: BAND_TOP,
      share: BAND_SPINE + BAND_TOP * (1 - BAND_SPINE) },
    headShade: HEAD_SHADE,
    paleStep: PALE_STEP,
    sowing: { perSquareMetre: FLOWER_PER_M2, cell: FLOWER_CELL,
      perCell: FLOWER_PER_CELL, share: FLOWER_SHARE, seed: FLOWER_SEED },
    cyan: { inLight: CYAN_IN_LIGHT, inShade: CYAN_IN_SHADE, reach: CYAN_REACH },
    reach: { ring: FLOWER_RADIUS, far: FAR_REACH, disc: DISC_RADIUS },
  };
}

// The vertex's own role, which picks its pigment AND how much of the world's
// orientation ladder it takes. It is a property of the FACE and not of anything
// per-flower: three values in the whole geometry.
//
// The lid and the sides are told apart for the band's sake and for nothing
// else: the target's horizontal band runs UNDER the top face, and the top face
// itself is pale.
const ROLE_LID = 0;
const ROLE_SIDE = 1;
const ROLE_STALK = 2;

/**
 * The flower: a cube head on a thin box of a stalk, in metres, at the nominal
 * size. Nine quads, eighteen triangles.
 *
 * THE HEAD HAS NO UNDERSIDE, and that is measured rather than assumed: it
 * stands seven centimetres over the ground and the eye stands at 1.58 m, so the
 * face pointing down is behind the head from every place a walker can put their
 * eye. The stalk has no lid and no foot either -- the head covers one and the
 * ground the other.
 *
 * WHY THE HEAD IS NOT TURNED. Every cube in this world is on the lattice, and
 * the target's flower heads are too: their faces run parallel to the meadow's.
 * A yaw per flower would be the one population in the frame that is not.
 *
 * AND EVERY QUAD CARRIES ITS OWN SQUARE, which is the whole of what the pistil
 * needed and the whole of what the texture session will need. The four corners
 * of every face are written in ONE order -- bottom-left, bottom-right,
 * top-right, top-left -- so aFace is the same four pairs for all nine of them
 * and a fragment always knows where on its own face it stands. The band above
 * is drawn from it; a 16x16 sheet with alpha would be sampled at it.
 */
function flowerGeometry() {
  const h = HEAD_NOMINAL / 2;
  const y0 = STALK_TALL;
  const y1 = STALK_TALL + HEAD_NOMINAL * HEAD_SQUAT;
  const s = STALK_WIDE / 2;
  // Buried a little, so a stalk on a slope never shows daylight under it.
  const foot = -0.03;
  const quads = [
    // the head: top, then the four sides
    [[-h, y1, -h], [-h, y1, h], [h, y1, h], [h, y1, -h], [0, 1, 0], ROLE_LID],
    [[h, y0, -h], [h, y0, h], [h, y1, h], [h, y1, -h], [1, 0, 0], ROLE_SIDE],
    [[-h, y0, h], [-h, y0, -h], [-h, y1, -h], [-h, y1, h], [-1, 0, 0], ROLE_SIDE],
    [[-h, y0, h], [h, y0, h], [h, y1, h], [-h, y1, h], [0, 0, 1], ROLE_SIDE],
    [[h, y0, -h], [-h, y0, -h], [-h, y1, -h], [h, y1, -h], [0, 0, -1], ROLE_SIDE],
    // the stalk: four sides, no lid and no foot
    [[s, foot, -s], [s, foot, s], [s, y0, s], [s, y0, -s], [1, 0, 0], ROLE_STALK],
    [[-s, foot, s], [-s, foot, -s], [-s, y0, -s], [-s, y0, s], [-1, 0, 0], ROLE_STALK],
    [[-s, foot, s], [s, foot, s], [s, y0, s], [-s, y0, s], [0, 0, 1], ROLE_STALK],
    [[s, foot, -s], [-s, foot, -s], [-s, y0, -s], [s, y0, -s], [0, 0, -1], ROLE_STALK],
  ];
  const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const positions = new Float32Array(quads.length * 4 * 3);
  const normals = new Float32Array(quads.length * 4 * 3);
  const roles = new Float32Array(quads.length * 4);
  const faces = new Float32Array(quads.length * 4 * 2);
  const indices = new Uint16Array(quads.length * 6);
  quads.forEach((quad, q) => {
    const normal = quad[4];
    for (let c = 0; c < 4; c++) {
      const o = (q * 4 + c) * 3;
      positions[o] = quad[c][0];
      positions[o + 1] = quad[c][1];
      positions[o + 2] = quad[c][2];
      normals[o] = normal[0];
      normals[o + 1] = normal[1];
      normals[o + 2] = normal[2];
      roles[q * 4 + c] = quad[5];
      faces[(q * 4 + c) * 2] = CORNERS[c][0];
      faces[(q * 4 + c) * 2 + 1] = CORNERS[c][1];
    }
    const b = q * 4;
    const i = q * 6;
    indices[i] = b; indices[i + 1] = b + 1; indices[i + 2] = b + 2;
    indices[i + 3] = b; indices[i + 4] = b + 2; indices[i + 5] = b + 3;
  });
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('aRole', new BufferAttribute(roles, 1));
  geometry.setAttribute('aFace', new BufferAttribute(faces, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

// THE HEAD'S OWN LIGHT, AND THERE IS ONE PRODUCER OF IT FOR BOTH FAMILIES.
// The seat's pair for this face, bent towards the pair of the head's top face
// by HEAD_SHADE. Written once and included twice, because a solid and the quad
// that replaces it at the exchange have to be the same flower: two copies of
// four lines is how a ring develops a seam that no gate reads a shader to find.
const HEAD_LIGHT_GLSL = /* glsl */`
  uniform float uHeadShade;

  vec3 headLight(vec3 n) {
    return faceLightOf(mix(faceTerms(vec3(0.0, 1.0, 0.0)), faceTerms(n), uHeadShade));
  }
`;

const FLOWER_VERTEX = /* glsl */`
  attribute float aRole;    // which pigment this face carries, and how it is lit
  attribute vec2 aFace;     // where on its own face this vertex stands, [0,1]^2
  attribute vec4 aFlower;   // world x, the foot of the stalk, z, and the scale
  attribute vec2 aLook;     // nought for white and one for cyan, and the tint

  varying vec3 vPale;
  varying vec3 vWarm;
  varying vec3 vFace;       // the face coordinate, and one on the head's sides
  varying float vFog;

  uniform vec3 uPale;
  uniform vec3 uPistil;
  uniform vec3 uCyan;
  uniform vec3 uStalk;
  uniform vec2 uCentre;
  uniform float uRadius;

  ${SCENE_LIGHT_GLSL}
  ${faceLightGlsl()}
  ${HEAD_LIGHT_GLSL}
  ${FOG_GLSL}

  void main() {
    // THE EXCHANGE RING, AND IT IS A HARD EDGE ON PURPOSE. This used to be a
    // shrink over the last metres, because past it there was nothing and a
    // flower that popped in at full size was the one thing a walker would
    // notice. There IS something past it now, and it is the same head: the far
    // family takes over at exactly this radius, off the same lattice and the
    // same record, and the swap is validated to be invisible at this range
    // rather than smoothed over. Fading here instead would be worse than a pop
    // -- the solid would shrink away over a metre and a half while its own quad
    // stood full size on top of it.
    //
    // The two families read the SAME uniform for this number, shared by
    // reference and not copied, so a gap or a double is not something that has
    // to be checked for.
    float reach = length(aFlower.xz - uCentre);
    float trim = 1.0 - step(uRadius, reach);
    vec3 world = aFlower.xyz + position * (aFlower.w * trim);

    // THE LIGHT IS THE SEAT'S, PER FACE, AND THE HEAD TAKES A SHARE OF THE
    // LADDER RATHER THAN THE WHOLE OF IT. A card taps the ground's own pair
    // because a card stands on the ground and has no normal worth reading; a
    // flower is a solid with six of them, and the pale side and the shaded side
    // of one head are the SAME pigment under two of these -- which is exactly
    // what the target shows and what this file would otherwise have had to
    // paint by hand. What the target does NOT show is the depth of the step
    // between them, and HEAD_SHADE is that reading: the head's own pair, bent
    // towards the pair its top face makes. The producer is untouched and so is
    // the stalk, which is a stalk and stands like one.
    float head = step(aRole, 1.5);
    vec3 light = mix(faceLight(normal), headLight(normal), head);

    vec3 pale = mix(uStalk, mix(uPale, uCyan, aLook.x), head);
    // A cyan head's warm pigment is its own pale: the band below then mixes
    // between two equal colours and disappears, which is the target's law
    // (C-TEXTURE §1.3: zero yellow pixels on five cyan heads) written as
    // arithmetic instead of as a branch nobody can see the other side of.
    vec3 warm = mix(uStalk, mix(uPistil, uCyan, aLook.x), head);
    vPale = pale * light * aLook.y;
    vWarm = warm * light * aLook.y;
    vFace = vec3(aFace, head * step(0.5, aRole));
    vFog = fogAmount(length(cameraPosition - world), world.y);

    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const FLOWER_FRAGMENT = /* glsl */`
  precision highp float;

  varying vec3 vPale;
  varying vec3 vWarm;
  varying vec3 vFace;
  varying float vFog;

  uniform vec3 uFogColour;
  uniform sampler2D tBand;   // the pistil, as a sixteen texel sheet with a mask

  void main() {
    // THE PISTIL, AND IT IS A SHEET NOW RATHER THAN TWO SMOOTHSTEPS.
    //
    // What it draws is the same shape and the same share: the spine down the
    // middle of the face and the lid under the top of it, at the two widths
    // U-PIG-2 fitted, rasterised at sixteen by tools/materia/foglio.mjs into
    // assets-src/materia/flower-band.png. The seat was already here -- every
    // side of the head arrives with its own [0,1] square in vFace.xy -- and it
    // was left ready for exactly this, with no vertex to move.
    //
    // WHAT THE SHEET BUYS, since the still is the same still. The shape becomes
    // DATA: the next reading of the reference's pistil enters as a rectangle in
    // fogli.json and not as an edit to a shader. And the softening at range
    // becomes the mip chain's instead of a fwidth's -- the fwidth softened over
    // one pixel at every distance, which is right at one distance; a mip level
    // softens over the footprint, and as a head shrinks towards the exchange
    // ring the last level it reaches is the sheet's own mean, which is the
    // share the far family paints its quad with. The two halves of the meadow
    // meet at the same colour by construction rather than by a number written
    // twice.
    float band = texture2D(tBand, vFace.xy).r * vFace.z;

    // No sheet, no cut-out and no alpha: a flower is a solid, so the one thing
    // it needs of the air is what is in front of it.
    gl_FragColor = vec4(mix(mix(vPale, vWarm, band), uFogColour, vFog), 1.0);
  }
`;

// ------------------------------------------------------------- the far half
//
// THE SECOND FAMILY, AND WHAT IT IS ANSWERING. The day target is dotted with
// heads out to eighteen metres; a ring of solids that reaches six and a half
// puts a band a metre and a third deep into the judged still, and the frame is
// otherwise bare. That was measured and escalated rather than split, and E-V4h
// ratified this shape for the answer: ONE camera-facing quad a head, from the
// exchange ring to the target's own reach, charged as a provisional debit
// against the campaign's margin and re-declared at V9.
//
// WHY A QUAD IS NOT THE CARD THIS SESSION JUST RETIRED, which is the objection
// that had to be answered before it was built. The card that went was a
// LEGIBLE object: two crossed quads carrying a painted sheet, standing in the
// near meadow where a walker looking down read them as white crosses lying
// flat. This is the opposite object at the opposite range -- one quad, no
// sheet, no crossing, under fourteen pixels, and never nearer than the ring. A
// crossing is what makes a cross, and there is nothing here to cross. Checked
// as well as argued: at the DoD look straight down, this family draws NOT ONE
// PIXEL (everything in that frame is inside the exchange), and the frame with
// it and the frame without it are bit-identical.
//
// WHERE THE RING IS, AND THE A/B DID NOT SAY WHAT THE HYPOTHESIS HOPED. E-V4h
// put the exchange at seven metres and made the A/B against solids the decider,
// in both directions. Run at 5, 6, 6.5, 7, 8 and 9 metres against the same
// heads drawn as solids (v4-verde/dev3b/ab.mjs, cucitura.py), what came back is
// that a quad is NOT indistinguishable from a solid at any affordable range,
// and the reason is not the quad:
//
//   a head in this world is a bright top face over two much darker sides -- our
//   orientation ladder is 8.51x where the target's is 3.73x, which is DEV3's
//   finding and D5's frontier -- and that top face is still a resolved 2.7 px
//   cap at seven metres. It goes under one pixel at about twelve metres, and
//   the stalk's width at about seventeen. A ONE-LEVEL stand-in cannot replace a
//   TWO-LEVEL object while both levels are resolved, however far away it is.
//
// So the number the A/B does decide is the SEAM: the step in flower ink across
// the exchange in the delivered frame, against an instrument whose own floor is
// five per cent. It reads -25% at a ring of 5 m, -20% at 6, -15% at 6.5, -12%
// at 7, -10% at 8, -5% at 9 -- reaching the floor only at nine metres, where
// the solids alone cost 13,392 triangles and V4 lands at 22,942 against a
// ceiling of ten to twelve thousand. That is a STOP, and it is not taken.
//
// THE RING IS THEREFORE THE SOLIDS' OWN RADIUS, and that is worth more than
// being the cheapest: it is the only choice that adds NOTHING to the near half.
// The exchange is where the ratified ring already stopped, so this family is
// purely additive and no delivered number moves. What it costs is the -15%
// step, which no eye found as a line in the frame and which a third of a metre
// of walking buries: the same two frames a step apart differ by 40 levels of
// parallax with or without the swap, and the swap adds -0.8 of that.
//
// WHAT IT CARRIES, AND IT IS THE TARGET'S READING AND NOT A SAVING. Whites all
// the way out, cyan as far as CYAN_REACH: past eight metres a cyan head stands
// on meadow three times darker than a white one does and at that size it is not
// in the picture, so drawing it out there would be putting in what the target
// does not show. The other half of that rule is the one this family was built
// without, and it was a declared cost rather than a hidden one: between the
// exchange and eight metres the census DOES resolve cyan -- three heads in the
// two near windows -- and a head the target shows and the frame does not is a
// difference somebody finds by looking. So it is drawn.
//
// AND THE EDGE IS HARD, LIKE THE EXCHANGE AND FOR A NEARER REASON. A cyan head
// crossing CYAN_REACH arrives at full size, which is a pop -- and it is the pop
// that was already there, moved OUTWARD: before this the same head first
// appeared at the exchange as a full-size SOLID, a metre and a half nearer and
// a quarter wider on the screen. Fading it in over the last metres instead
// would put the shrunk half of that band exactly where the census found its
// three heads, drawing at the wrong size the very heads this rule exists to
// draw at the right one.

/** The quad: four corners of a unit square about its own centre. */
function farGeometry() {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]), 3));
  geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  return geometry;
}

const FAR_VERTEX = /* glsl */`
  attribute vec4 aFlower;   // world x, y, z of the HEAD'S CENTRE, and its size
  attribute vec2 aLook;     // nought for white and one for cyan, and the tint

  varying vec3 vTint;
  varying float vFog;

  uniform vec3 uPale;
  uniform vec3 uPistil;
  uniform vec3 uCyan;
  uniform float uBandShare;  // how much of a SIDE the pistil's band covers
  uniform vec2 uCentre;
  uniform float uRing;      // the exchange ring: the solids' own radius
  uniform float uReach;
  uniform float uFade;

  ${SCENE_LIGHT_GLSL}
  ${faceLightGlsl()}
  ${HEAD_LIGHT_GLSL}
  ${FOG_GLSL}

  void main() {
    float reach = length(aFlower.xz - uCentre);
    // Inside the ring this head is drawn as a solid, by the family that reads
    // this same uniform for the opposite half of the comparison.
    float keep = step(uRing, reach);
    // And a cyan one stops sooner, because the census does. It is a THIRD trim
    // on the same live distance rather than a filter on the fill, for the reason
    // the other two are: the buffer holds a superset and every edge this family
    // has is worked out against where the walker IS, so a sweep that is a second
    // stale costs coverage and never correctness.
    keep *= 1.0 - aLook.x * step(${CYAN_REACH.toFixed(1)}, reach);
    // And at the rim there is nothing beyond, so the trim comes back: a quad
    // leaves by shrinking about its own centre over the last metres.
    float trim = 1.0 - smoothstep(uReach - uFade, uReach, reach);

    // THE HEAD THIS QUAD STANDS FOR, WORKED OUT RATHER THAN CHOSEN, and it is
    // what the A/B forced. Written the obvious way -- one face's worth of area
    // carrying the top face's light -- the quad measured TWICE the light of the
    // solid it replaces over the same band and covered a quarter fewer pixels,
    // at every range tried: not a defect of the distance but of the stand-in,
    // and no ring anywhere would have hidden it. Both halves of that come from
    // the same fact, which is that a walker at this range does not see the top
    // of a head. So both are taken from the head itself:
    //
    //   AREA. The silhouette of a box with edge s, seen along a unit vector v,
    //   is s * s * (|v.x| + |v.y| + |v.z|) whatever way it is turned. A quad
    //   squared to the view plane covers its side squared, so its side is the
    //   head's edge times the root of that sum, and the two footprints agree by
    //   arithmetic instead of by fitting.
    //
    //   COLOUR. Each of those three terms is one face of the head, and this
    //   world's faces are not interchangeable: a SIDE carries the pistil's band
    //   over the share of itself the band covers and the pale over the rest,
    //   the lid carries the pale whole, and each is lit by headLight() for ITS
    //   OWN normal -- the same four lines the solid uses. So the quad carries
    //   their average weighted by exactly the areas above: the head's own
    //   colour at this distance, from the one producer, with nothing added and
    //   no constant of its own. The band's share is arithmetic off BAND_SPINE
    //   and BAND_TOP and is not a second reading of the target.
    //
    // The head's underside is not in the sum and does not need to be: it is not
    // built (a head stands 7 cm up and the eye 1.58 m, so it is behind the head
    // from anywhere a walker can stand), and the same fact makes the y term
    // always the TOP face.
    vec3 toEye = normalize(cameraPosition - aFlower.xyz);
    vec3 share = abs(toEye);
    float area = share.x + share.y + share.z;
    vec3 alongX = vec3(toEye.x >= 0.0 ? 1.0 : -1.0, 0.0, 0.0);
    vec3 alongZ = vec3(0.0, 0.0, toEye.z >= 0.0 ? 1.0 : -1.0);
    // AND A CYAN HEAD IS THE SAME HEAD IN ANOTHER PIGMENT, which is exactly how
    // the solids have it: their one line reads mix(pale-or-pistil, cyan, flag),
    // and this is that line twice, once for each pigment the three faces are
    // drawn from. The weighting above is untouched, so a cyan quad is the cyan
    // CUBE'S own average and not a second recipe for the same flower -- and its
    // band disappears here for the same reason it disappears there, because the
    // two colours it mixes between are equal.
    vec3 pale = mix(uPale, uCyan, aLook.x);
    vec3 warm = mix(uPistil, uCyan, aLook.x);
    vec3 side = mix(pale, warm, uBandShare);
    vec3 head = (side * headLight(alongX) * share.x
      + pale * headLight(vec3(0.0, 1.0, 0.0)) * share.y
      + side * headLight(alongZ) * share.z) / area;

    float size = aFlower.w * sqrt(area) * keep * trim;

    // TURNED TO THE CAMERA IN VIEW SPACE, which is what makes it a stand-in for
    // a cube rather than for a card. A quad squared up to the view plane keeps
    // the head's footprint whatever the walker does -- including looking
    // straight down, where a yaw-only billboard would collapse to a line and
    // the far meadow would empty as the eye dropped. That is also the DoD voice
    // this session closed, from the other side: from above the sum above comes
    // to the top face alone, so these read as squares of exactly the colour a
    // cube head reads as from above.
    vec4 view = viewMatrix * vec4(aFlower.xyz, 1.0);
    view.xy += position.xy * size;

    // Nothing is added to it: no emissive term, no additive blend, no second
    // opinion about the hour.
    vTint = head * aLook.y;
    vFog = fogAmount(length(cameraPosition - aFlower.xyz), aFlower.y);

    gl_Position = projectionMatrix * view;
  }
`;

const FAR_FRAGMENT = /* glsl */`
  precision highp float;

  varying vec3 vTint;
  varying float vFog;

  uniform vec3 uFogColour;

  void main() {
    gl_FragColor = vec4(mix(vTint, uFogColour, vFog), 1.0);
  }
`;

/**
 * The far half of the meadow: one quad a head, from the ring to the reach.
 *
 * @param {object} ring  the SOLIDS' OWN radius uniform, shared by reference.
 *   Not a copy of the number and not a second setter: the exchange is one
 *   comparison written twice with opposite signs, so a gap between the two
 *   families or a head drawn by both is not a thing that can happen and then be
 *   noticed. It is the same discipline the contract's two doors are built on.
 */
function createFarFlowers({ height, lightScale, pigments, ring }) {
  const geometry = farGeometry();
  // Every candidate the two trims could ever ask for, out to the slack past the
  // rim. Sized for the top of the reach and never reallocated: growing a buffer
  // is a hitch on the one machine that can afford the extra meadow.
  const offsets = ringOffsets(FAR_REACH_MAX + FAR_SLACK, FLOWER_CELL);
  const capacity = Math.ceil(offsets.length * FLOWER_PER_CELL * FLOWER_SHARE * 1.35) + 128;
  const flowerData = new Float32Array(capacity * 4);
  // The same record the solids read, under the same name: which of the two
  // flowers this is, and its tint. Two families reading one record the same way
  // is the whole reason a cyan quad cannot end up a different colour from the
  // cyan cube it takes over from.
  const lookData = new Float32Array(capacity * 2);
  const flowerAttribute = new InstancedBufferAttribute(flowerData, 4);
  const lookAttribute = new InstancedBufferAttribute(lookData, 2);
  flowerAttribute.setUsage(DynamicDrawUsage);
  lookAttribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute('aFlower', flowerAttribute);
  geometry.setAttribute('aLook', lookAttribute);
  geometry.instanceCount = 0;
  geometry.boundingSphere = new Sphere(new Vector3(), FAR_REACH_MAX + FAR_SLACK + 1);

  const material = new ShaderMaterial({
    uniforms: {
      uPale: { value: pigments.pale },
      uPistil: { value: pigments.pistil },
      uCyan: { value: pigments.cyan },
      uHeadShade: { value: HEAD_SHADE },
      // The share of ONE SIDE the band covers, worked out from the two numbers
      // the solid's fragment draws it with rather than measured a second time:
      // the spine down the middle, and the lid's band over what is left of the
      // face on either side of it.
      uBandShare: { value: BAND_SPINE + BAND_TOP * (1 - BAND_SPINE) },
      ...faceLightUniforms(lightScale * GROUND_EXPOSURE),
      ...SCENE_LIGHT_UNIFORMS,
      uCentre: { value: new Vector2() },
      uRing: ring,
      uReach: { value: FAR_REACH },
      uFade: { value: FAR_FADE },
      ...fogUniforms(),
    },
    vertexShader: FAR_VERTEX,
    fragmentShader: FAR_FRAGMENT,
    // A quad turned to the view plane can only ever present one side, and this
    // one is wound to be that side. Nothing here blends: it is a solid patch of
    // meadow writing depth like the head it stands for, which is why the frame
    // it costs is a frame of pixels actually drawn.
    fog: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'flowers-far';
  mesh.frustumCulled = false;

  // The fill in progress, which is a whole sweep spread over frames. The shadow
  // is written and the live buffer is left alone until the sweep is complete,
  // so a frame never draws half a ring.
  const shadowFlower = new Float32Array(capacity * 4);
  const shadowLook = new Float32Array(capacity * 2);
  let lastStepX = null;
  let lastStepZ = null;
  let placed = 0;
  let cyan = 0;
  let sliceMs = 0;
  let sweepMs = 0;
  let cursor = -1;
  let sweepN = 0;
  let sweepCyan = 0;
  let sweepCellX = 0;
  let sweepCellZ = 0;
  let sweepStarted = 0;
  let sweepTo = 0;
  let sweepFrom = 0;
  // Where the ring the buffer currently holds was filled from, and how far out
  // it was filled to. What the shader is allowed to draw is worked out from
  // these and the walker's live position, every frame.
  let liveX = 0;
  let liveZ = 0;
  let liveTo = 0;
  let wantedReach = FAR_REACH;

  function beginSweep(centreX, centreZ) {
    sweepCellX = Math.floor(centreX / FLOWER_CELL);
    sweepCellZ = Math.floor(centreZ / FLOWER_CELL);
    sweepTo = wantedReach + FLOWER_CELL;
    sweepFrom = Math.max(0, ring.value - FAR_SLACK);
    cursor = 0;
    sweepN = 0;
    sweepCyan = 0;
    sweepStarted = performance.now();
  }

  function sweepSlice() {
    const started = performance.now();
    // Both edges are the ones this sweep STARTED with, so a tier change in the
    // middle of one cannot leave a ring filled to two different bounds.
    const from = sweepFrom;
    const to = sweepTo;
    let n = sweepN;
    let blue = sweepCyan;
    let i = cursor;
    const stop = Math.min(offsets.length, i + FAR_SLICE);
    for (; i < stop; i++) {
      const offset = offsets[i];
      if (offset.d > to) { i = offsets.length; break; }
      if (offset.d + FLOWER_CELL < from) continue;
      for (let k = 0; k < FLOWER_PER_CELL; k++) {
        const flower = flowerAt(sweepCellX + offset.i, sweepCellZ + offset.j, k, height);
        if (!flower) continue;
        // THE FILL'S HALF OF THE CYAN RULE, and it is the cheap half: a cyan
        // candidate this far out cannot come inside CYAN_REACH of the walker
        // before the next sweep lands, so it is never put in the buffer. The
        // edge itself is the shader's, at CYAN_REACH of the live position -- so
        // this cannot draw one too far out, only keep one out of the buffer
        // that was certain to collapse.
        const isCyan = flower.kind === 'ciano';
        if (isCyan && offset.d > CYAN_FILL) continue;
        const o = n * 4;
        // THE HEAD'S CENTRE, which is the point the contract publishes and the
        // point a lamp is hung at. The solids store the foot of the stalk
        // because their geometry stands on it; a quad is centred on its head.
        shadowFlower[o] = flower.x;
        shadowFlower[o + 1] = flower.y;
        shadowFlower[o + 2] = flower.z;
        // SIZE FROM THE CONTRACT: the head's own edge, so the quad covers what
        // the cube it replaces covers.
        shadowFlower[o + 3] = flower.size;
        shadowLook[n * 2] = isCyan ? 1 : 0;
        shadowLook[n * 2 + 1] = flower.tint;
        if (isCyan) blue++;
        n++;
        if (n >= capacity) break;
      }
      if (n >= capacity) { i = offsets.length; break; }
    }
    sweepN = n;
    sweepCyan = blue;
    cursor = i;
    sliceMs = performance.now() - started;
    if (cursor < offsets.length) return;
    // Done: publish the whole ring at once, and with it where it was filled
    // from, which is what the rim is then measured against.
    flowerData.set(shadowFlower.subarray(0, sweepN * 4));
    lookData.set(shadowLook.subarray(0, sweepN * 2));
    placed = sweepN;
    cyan = sweepCyan;
    geometry.instanceCount = sweepN;
    flowerAttribute.needsUpdate = true;
    lookAttribute.needsUpdate = true;
    liveX = (sweepCellX + 0.5) * FLOWER_CELL;
    liveZ = (sweepCellZ + 0.5) * FLOWER_CELL;
    liveTo = sweepTo;
    cursor = -1;
    sweepMs = performance.now() - sweepStarted;
  }

  return {
    mesh,
    update(position) {
      material.uniforms.uCentre.value.set(position.x, position.z);
      const stepX = Math.floor(position.x / FAR_STEP);
      const stepZ = Math.floor(position.z / FAR_STEP);
      const moved = stepX !== lastStepX || stepZ !== lastStepZ;
      // A SWEEP IS ALWAYS FINISHED, NEVER ABANDONED, and the first shape of
      // this was the other way round: restart on every cell crossed. At the
      // walk speed of layout.js the walker crosses a cell faster than a sweep
      // completes, so every sweep was thrown away at its tenth slice and the
      // buffer NEVER updated -- measured, and it looked exactly like a family
      // that was working. So the cell is only remembered here, and the next
      // sweep begins when the last one has landed.
      if (cursor < 0 && moved) {
        lastStepX = stepX;
        lastStepZ = stepZ;
        beginSweep((stepX + 0.5) * FAR_STEP, (stepZ + 0.5) * FAR_STEP);
      }
      if (cursor >= 0) sweepSlice();
      // AND THE RIM IS ONLY DRAWN AS FAR AS THE BUFFER IS KNOWN TO REACH. The
      // ring being drawn was filled around liveX/liveZ; every head within
      // liveTo of THAT point is in it, so every head within liveTo minus the
      // walker's distance from it is in it whatever the walker has done since.
      const drift = Math.hypot(position.x - liveX, position.z - liveZ);
      material.uniforms.uReach.value = placed > 0
        ? Math.max(FAR_FADE + 0.5, Math.min(wantedReach, liveTo - drift))
        : wantedReach;
    },
    /** How far the far half carries, which is the only thing a tier moves here. */
    setReach(wanted) {
      const next = Math.min(Math.max(wanted, FAR_FADE + 0.5), FAR_REACH_MAX);
      if (next === wantedReach) return;
      wantedReach = next;
      lastStepX = null;
    },
    /** Told when the exchange has moved, since the fill is bounded by it too. */
    ringMoved() { lastStepX = null; },
    setVisible(visible) { mesh.visible = visible; },
    stats: () => ({
      capacity,
      placed,
      // How many of them are cyan, published for the same reason the solids
      // publish theirs: the census of what this world renders is taken against
      // the census of the target, and the two-colour split is one of the things
      // it is taken on. It is a count of what is in the BUFFER, so it includes
      // the ones past CYAN_REACH that the shader collapses.
      cyan,
      // Both of them, because only one of them is what a frame pays: sliceMs is
      // the worst any single frame is asked for and sweepMs is what the whole
      // refill would have cost in one go.
      rebuildMs: sliceMs,
      sweepMs,
      ring: ring.value,
      reach: material.uniforms.uReach.value,
      triangles: placed * geometry.index.count / 3,
    }),
  };
}

/**
 * The moving ring of flowers around the walker: one draw, whatever it holds.
 *
 * It is a ring for the same reason the accent is one -- the disc carries some
 * thousands of these and the frame can afford a few hundred -- and it is filled
 * out of flowerAt() so that what is drawn is a subset of what the contract
 * publishes, never a second sowing beside it.
 */
function createFlowers({ height, lightScale, pigments, band }) {
  const geometry = flowerGeometry();
  const offsets = ringOffsets(FLOWER_RADIUS_MAX, FLOWER_CELL);
  const capacity = Math.ceil(offsets.length * FLOWER_PER_CELL * FLOWER_SHARE * 1.6) + 64;
  const flowerData = new Float32Array(capacity * 4);
  const lookData = new Float32Array(capacity * 2);
  const flowerAttribute = new InstancedBufferAttribute(flowerData, 4);
  const lookAttribute = new InstancedBufferAttribute(lookData, 2);
  flowerAttribute.setUsage(DynamicDrawUsage);
  lookAttribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute('aFlower', flowerAttribute);
  geometry.setAttribute('aLook', lookAttribute);
  geometry.instanceCount = 0;
  geometry.boundingSphere = new Sphere(new Vector3(), FLOWER_RADIUS_MAX + 1);

  // The exchange ring, and it is declared HERE because it is the solids' own
  // radius: this object is handed to the far family whole, so the two halves
  // of the meadow read one number.
  const ring = { value: FLOWER_RADIUS };
  const material = new ShaderMaterial({
    uniforms: {
      uPale: { value: pigments.pale },
      uPistil: { value: pigments.pistil },
      uCyan: { value: pigments.cyan },
      uStalk: { value: pigments.stalk },
      uHeadShade: { value: HEAD_SHADE },
      // The sheet, or nothing: a head with no sheet is a head with no pistil,
      // which is the flower that shipped before this one and not a black one.
      tBand: { value: band },
      // At the GROUND's exposure, because what a flower is lit by is the meadow
      // it stands in: the same line src/world/voxel/material.js asks for, so a
      // cube and the flower at its foot cannot disagree about the hour.
      ...faceLightUniforms(lightScale * GROUND_EXPOSURE),
      ...SCENE_LIGHT_UNIFORMS,
      uCentre: { value: new Vector2() },
      uRadius: ring,
      ...fogUniforms(),
    },
    vertexShader: FLOWER_VERTEX,
    fragmentShader: FLOWER_FRAGMENT,
    fog: false,
  });
  const mesh = new Mesh(geometry, material);
  // Named, because a harness that wants to price these on their own has to find
  // them in the SCENE: an import() inside the page hands back a second instance
  // of the layer whose handles turn nothing, and a measurement taken that way
  // reads as a family that costs nought. The lesson is DEV2bis's and it cost a
  // table.
  mesh.name = 'flowers';
  mesh.frustumCulled = false;

  let lastCellX = null;
  let lastCellZ = null;
  let placed = 0;
  let cyan = 0;
  let rebuildMs = 0;

  function rebuild(cellX, cellZ) {
    const started = performance.now();
    let n = 0;
    let blue = 0;
    for (const offset of offsets) {
      if (offset.d > ring.value + FLOWER_CELL) break;
      for (let k = 0; k < FLOWER_PER_CELL; k++) {
        const flower = flowerAt(cellX + offset.i, cellZ + offset.j, k, height);
        if (!flower) continue;
        const o = n * 4;
        flowerData[o] = flower.x;
        // The FOOT of the stalk and not the head: the geometry stands on it.
        flowerData[o + 1] = flower.y - STALK_TALL * flower.scale - flower.size / 2;
        flowerData[o + 2] = flower.z;
        flowerData[o + 3] = flower.scale;
        lookData[n * 2] = flower.kind === 'ciano' ? 1 : 0;
        lookData[n * 2 + 1] = flower.tint;
        if (flower.kind === 'ciano') blue++;
        n++;
        if (n >= capacity) break;
      }
      if (n >= capacity) break;
    }
    placed = n;
    cyan = blue;
    geometry.instanceCount = n;
    flowerAttribute.needsUpdate = true;
    lookAttribute.needsUpdate = true;
    rebuildMs = performance.now() - started;
  }

  return {
    mesh,
    update(position) {
      material.uniforms.uCentre.value.set(position.x, position.z);
      const cellX = Math.floor(position.x / FLOWER_CELL);
      const cellZ = Math.floor(position.z / FLOWER_CELL);
      if (cellX !== lastCellX || cellZ !== lastCellZ) {
        lastCellX = cellX;
        lastCellZ = cellZ;
        rebuild(cellX, cellZ);
      }
    },
    /**
     * How far the solids reach, which is where the exchange ring is and the
     * only thing a tier moves here.
     *
     * @returns {number} the radius actually taken, which is what the far family
     *   is filled against: the clamp is applied once, here, and never guessed
     *   at a second time by the caller.
     */
    setRadius(wanted) {
      const next = Math.min(Math.max(wanted, FLOWER_RADIUS_MIN), FLOWER_RADIUS_MAX);
      if (next === ring.value) return next;
      ring.value = next;
      lastCellX = null;
      return next;
    },
    /** The uniform itself, for the family that draws the other side of it. */
    ring,
    setVisible(visible) { mesh.visible = visible; },
    stats: () => ({
      capacity, placed, cyan, rebuildMs, radius: ring.value,
      triangles: placed * geometry.index.count / 3,
      perSquareMetre: placed / (Math.PI * ring.value * ring.value),
    }),
  };
}

/**
 * The meadow's own accents: the ring of sprays and the flowers, near the walker.
 *
 * @param {object} assets  the grass sheet, the height of the meadow under a
 *                         point, and the exposure the ground is lit at
 */
export function createVegetation({
  grassAtlas, flowerBand = null, height, lightScale = TERRAIN.lightScale,
}) {
  if (!grassAtlas || !height) {
    return {
      meshes: [], update() {}, setQuality() {}, setGrassVisible() {}, stats: () => null,
    };
  }

  // The card's own size in metres comes off the sheet, which is the file that
  // knows how many centimetres of blade a texel of it holds. See the note over
  // CARD in tools/vegetation/paint-grass.mjs: held in two places, the two drift
  // and the drift is a sheet of blades of the wrong width with nothing saying so.
  const card = GRASS.card;
  const bridge = groundLightBridge();

  const grass = createRing({
    atlas: grassAtlas,
    light: bridge.texture,
    lightScale,
    geometry: cardGeometry(QUADS, card.width, card.height, CARD_LEAN),
    columns: GRASS.columns,
    rows: GRASS.rows,
    cellFrom: 0,
    cellCount: GRASS.cells.length,
    radius: RING_RADIUS,
    maxRadius: RING_RADIUS_MAX,
    cellSize: CELL,
    perCell: PER_CELL,
    scaleRange: CARD_SCALE,
    height,
    density: (x, z) => densityAt(x, z) * ACCENT,
    seed: 7,
    tint: { min: 0.86, max: 1.14 },
    // Bedded a couple of centimetres into the ground, so a card standing on a
    // slope never shows daylight under its root.
    sink: 0.03,
  });

  // THE FLOWERS ARE NOT A RING OF CARDS ANY MORE, and that is the DoD voice
  // this session was given. What stood here was two crossed quads off the props
  // sheet, and from a walker looking straight down they read as WHITE CROSSES
  // lying flat on the meadow -- the last "card/pattern" in the frame once DEV1
  // had taken the grass carpet out. A cube head has no reading from above other
  // than a cube, which is what the target shows from above.
  // ONE READING OF THE SEAT FOR BOTH FAMILIES. Built here rather than inside
  // either of them: a white measured twice is a white that can be two whites,
  // and the near half and the far half of one meadow have to be the same
  // flower seen at two ranges.
  const pigments = flowerPigments();
  // THE PISTIL'S SHEET, DRESSED ONCE FOR THE ONE MATERIAL THAT READS IT.
  //
  // CLAMPED, and it is not a formality: each side of a head gets its own [0,1]
  // square, so a wrap would fetch the far edge of the band for the near edge of
  // a face. LINEAR in magnification because a head is fourteen pixels wide and
  // a sixteen texel sheet on it is about one texel a pixel -- which is where a
  // nearest filter would put a staircase down the middle of every flower in the
  // frame, and where the linear one softens by very nearly the single pixel the
  // fwidth this replaces was softening by.
  const band = bandSheet(flowerBand);
  const flowers = createFlowers({ height, lightScale, pigments, band });
  // And the far half, which starts where the solids stop. It is handed the
  // solids' own radius uniform, so the exchange is one number and not two.
  const far = createFarFlowers({ height, lightScale, pigments, ring: flowers.ring });
  const meshes = [grass.mesh, flowers.mesh, far.mesh];

  // Where the sowing is being taken, and where it has got to. The pair is what
  // the crossing is made of: the cut walks from one to the other over a second
  // while the band opens and closes around it, and the lattice is filled for
  // whichever of the two asks for more.
  let from = { density: 1, radius: RING_RADIUS };
  let to = { density: 1, radius: RING_RADIUS };
  let crossing = 0;

  function push() {
    const t = crossing <= 0 ? 1 : 1 - crossing / DENSITY_FADE_SECONDS;
    const ease = t * t * (3 - 2 * t);
    const cut = from.density + (to.density - from.density) * ease;
    const radius = from.radius + (to.radius - from.radius) * ease;
    // Nought at both ends of the crossing: at rest the threshold is exact.
    const band = crossing <= 0 ? 0 : DENSITY_FADE_BAND * Math.sin(Math.PI * t);
    grass.setState({ cut, band, radius, sown: Math.max(from.density, to.density) });
  }
  push();

  return {
    meshes,
    update(position, delta = 0) {
      // The sun, every frame, into four texels. It writes only when the sun has
      // actually moved, so a day that stands still costs one comparison.
      bridge.refresh();
      if (crossing > 0) {
        crossing = Math.max(0, crossing - delta);
        // The moment the crossing is over, where the sowing came from stops
        // being a fact about it. Until this happens the lattice is still filled
        // for the denser of the two tiers, so a ring that has thinned is still
        // carrying the cards it thinned away — standing at scale nought, which
        // costs no fill but is a vertex each all the same.
        if (crossing === 0) from = { ...to };
        push();
      }
      grass.update(position);
      flowers.update(position);
      far.update(position);
    },

    /**
     * How much meadow the machine can afford: a share of the sowing and how far
     * the ring reaches, both crossed over a second.
     *
     * IT IS KEPT THOUGH IT NO LONGER BUYS MILLISECONDS, and that is worth
     * saying. The tiers in src/core/quality.js hand this file a density and a
     * radius, and at a carpet's sowing they were worth two thirds of a
     * millisecond. At an accent's they are worth a few dozen triangles. What
     * they still buy is the RADIUS, which is where the sprays stop, and the
     * lever stays where the quality system already knows to find it.
     */
    setQuality({ density = 1, radius = RING_RADIUS } = {}) {
      if (density === to.density && radius === to.radius) return;
      const t = crossing <= 0 ? 1 : 1 - crossing / DENSITY_FADE_SECONDS;
      const ease = t * t * (3 - 2 * t);
      from = {
        density: from.density + (to.density - from.density) * ease,
        radius: from.radius + (to.radius - from.radius) * ease,
      };
      to = { density, radius: Math.min(radius, RING_RADIUS_MAX) };
      // AND THE FLOWERS FOLLOW THE SAME LEVER, AS A RADIUS AND NEVER AS A
      // DENSITY. A tier that thins the accent is a machine that cannot afford
      // the near meadow, and the flowers are by far the more expensive half of
      // it -- eighteen triangles each against the accent's six, seven thousand
      // against a hundred and ninety. But how many heads stand on a square
      // metre is a fact about the MEADOW, measured off the target, and a
      // machine does not get a sparser meadow: it gets the same meadow ending
      // sooner. So the tier's whole grass budget -- its density AND its reach,
      // which is what its cost is made of -- is carried across as the one thing
      // that may honestly move.
      const share = Math.sqrt(density) * (radius / RING_RADIUS);
      flowers.setRadius(FLOWER_RADIUS * share);
      // AND THE FAR HALF FOLLOWS THE SAME LEVER, AS ITS REACH. The exchange
      // comes in with the solids -- it IS the solids' radius -- and the rim
      // comes in with it, so a machine that cannot afford the near meadow gets
      // the same meadow ending sooner at both of its edges rather than a
      // cheaper meadow. Told separately that the ring has moved, because the
      // far buffer is bounded by it at the near end as well as at the rim.
      far.ringMoved();
      far.setReach(FAR_REACH * share);
      crossing = DENSITY_FADE_SECONDS;
      push();
    },
    /** Development handle: the accents alone, so their cost can be measured. */
    setGrassVisible(visible) {
      grass.setVisible(visible);
    },
    /** And the flowers alone, which is the only way to price them apart. */
    setFlowersVisible(visible) {
      flowers.setVisible(visible);
      far.setVisible(visible);
    },
    /**
     * The two halves apart, which is what the A/B of the exchange is made of:
     * the same heads drawn as solids past the ring, or as quads inside it.
     */
    setNearFlowersVisible(visible) {
      flowers.setVisible(visible);
    },
    setFarFlowersVisible(visible) {
      far.setVisible(visible);
    },
    stats: () => ({
      grass: grass.stats(),
      flowers: flowers.stats(),
      far: far.stats(),
      density: to.density,
      radius: to.radius,
      // What the ring is actually sowing, per square metre of the disc it
      // covers, so the reading the accent was set from can be checked in the
      // running frame instead of trusted.
      perSquareMetre: grass.stats().placed / (Math.PI * to.radius * to.radius),
    }),
  };
}
