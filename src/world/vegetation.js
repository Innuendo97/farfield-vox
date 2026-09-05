import {
  BufferAttribute, DataTexture, DoubleSide, DynamicDrawUsage,
  InstancedBufferAttribute, InstancedBufferGeometry, Mesh, RGBAFormat,
  ShaderMaterial, Sphere, SRGBColorSpace, UnsignedByteType, Vector2, Vector3,
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
import { FAMILY, PIGMENT, pigTint } from './voxel/pigment.js';
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
// follow the head's own draw, exactly and for nothing.
//
// AND THE COMMITTENTE HAS MOVED THE BAND, WHICH IS THE ONLY NEW THING THIS LINE
// SAYS. He walked the delivered meadow and asked to <<diminuire il range di
// larghezza dello stelo dei fiori>> (E-DECISIONI15.1); the coordinator fixed the
// new band at a FIFTH to THREE TENTHS of a cube -- 2.0 to 3.0 cm against the 3.0
// to 4.5 that shipped -- and left the correlation exactly where it was. A THIRD
// of the head is that band and nothing else in the file has to move:
//
//     head 6.0 cm (scale 0.80)   stalk 2.0 cm wide, 6.0 cm tall   1/5 of a cube
//     head 7.5 cm (scale 1.00)   stalk 2.5 cm wide, 7.5 cm tall   1/4 of a cube
//     head 9.0 cm (scale 1.20)   stalk 3.0 cm wide, 9.0 cm tall   3/10 of a cube
//
// A READING IS BEING OVERRULED AND IT IS SAID SO. E-ERBA-A 4 read the target's
// own stalk at <<circa META' della larghezza della testa>>, by hand, on two
// exemplars, and the three lines above used to be that reading. The man the
// picture is for has walked the render and asked for thinner; a hand reading on
// two exemplars does not outrank him, and the correlation he asked for in
// E-DECISIONI9.1 is untouched -- only the band it runs over has narrowed.
const STALK_WIDE = HEAD_NOMINAL / 3;
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

// THE FLOWER IS A LANTERN NOW, AND THIS IS THE WHOLE OF WHAT THAT MEANS.
//
// WHAT IT REPLACES. Four proposals for a pistil were mocked up and put in front
// of the committente (E-FIORI4a); what came back was not one of them
// (E-DECISIONI15): <<Mi convincono A e B ma ho un'idea per unirli>>. The idea is
// a flower that CLOSES AROUND ITS OWN LAMP:
//
//   1. the stalk gets thinner -- answered at STALK_WIDE above;
//   2. BOTH flowers get slightly transparent petals, and the pistil EMITS LIGHT
//      even by day, very faintly: <<basta un alone che simuli il pistillo
//      illuminato, che si intraveda attraverso i petali leggermente
//      trasparenti>>, and strongly at night;
//   3. BY DAY the flowers are shut or barely open, <<in un range molto vicino
//      alla chiusura>>, with the pistils INSIDE the head, covered by the petals
//      but visible through them. BY NIGHT they bloom and the pistils come out;
//   4. the WHITES are type A: one central pistil, standing out by a quarter to
//      two quarters of the head at night, according to the flower's size;
//   5. the BLUES are type B: three or four pistils, standing out by a quarter to
//      three quarters.
//
// AND THE TARGET'S OWN YELLOW BAND FALLS WITH IT, DECLARED. C-TEXTURE §1.6
// measured the day target's pistil as a fifth to two fifths of the head's pixels
// in a vertical band on the edge turned to the eye, and every number in the file
// under here used to be fitted to that corridor. The committente has seen the
// corridor drawn four different ways and chosen a flower that does not have a
// band at all -- the yellow is INSIDE the bud, seen through the petals -- so the
// 22-40 per cent corridor is retired by his word and not by a measurement, and
// the gate that held it goes with it. What is NOT retired is everything the
// corridor was measured beside: the head's size, its squat, its pigment, the
// step over the meadow, HEAD_SHADE, the sowing. None of those moves here.
//
// THE NIGHT IS NOT BUILT (E-DECISIONI2: only the day is), so what is built is
// the flower PARAMETRIC IN ITS OWN HOUR. One uniform, uBloom, runs from nought
// to one; the day is delivered at nought and V7 will drive it without this file
// being opened again. Everything below is a function of it.

/**
 * THE HOLE IN THE LID, WHICH IS WHAT THE APERTURE OPENS NOW.
 *
 * E-DECISIONI16.1, and it retires the petals that turned: <<niente petali che
 * ruotano. La testa resta un CUBO CHIUSO; sul coperchio c'e' un FORO: bianco =
 * un foro centrale, piu' o meno stretto di giorno e piu' o meno largo di notte;
 * blu = 4 fori piu' piccoli, stretti di giorno e larghi di notte. Dai fori
 * escono i pistilli di notte.>>
 *
 * SO THE HEAD IS A CLOSED BOX AGAIN and the only thing the hour moves in the
 * shell is the WIDTH of a hole in its lid. The two numbers a kind carries are
 * that width at nought and at one, as a share of the head's own side; the day
 * delivers apertures in [0, DAY_OPEN], so a day hole is the SHUT width and a
 * tenth of the way to the open one -- <<piu' o meno stretto>>, a seed per
 * flower, and no two lids in the meadow the same.
 *
 * THE OPEN WIDTH IS NOT A TASTE, IT IS A CLEARANCE. What has to go through the
 * hole at full bloom is the lamp, so the open width is the lamp's own side plus
 * room either side of it: a white lamp is a third of the head and its hole is
 * two fifths, a blue stamen a quarter and its hole 28 hundredths. Under that the
 * lamp would climb into its own lid.
 *
 * AND THE SHUT WIDTH IS A READING. At one metre -- the range the committente
 * walks the meadow at -- a centimetre of flower is 15 pixels of the delivered
 * frame, so a hole of 0.14 of a 7.5 cm head is 16 px across and a blue one of
 * 0.09 is 10 px: a hole a walker can SEE is the whole point of putting one
 * there, and a hole a couple of pixels wide would be a dark speck rather than an
 * opening. Both are gated off the boxes and printed in the verbale's sweep.
 */
const HOLE_WHITE = { shut: 0.14, open: 0.40 };
const HOLE_CYAN = { shut: 0.09, open: 0.28 };

/**
 * THE RIM THE LID KEEPS OUTSIDE ITS WIDEST HOLE, as a share of the head.
 *
 * IT IS WHAT PLACES THE BLUE STAMENS, and that is the correction this session
 * makes to a number U-FIORI-4 chose for another reason. That session stood a
 * stamen at eleven twelfths of the room between the cup's centre and its wall,
 * to keep it off a coplanar face; there was no hole over it then. There is now,
 * and a hole has to have LID on both sides of it -- so the offset is DERIVED
 * from the widest hole instead of chosen: half a head, less this rim, less half
 * the open hole. At the nominal size that is 2.33 cm, which leaves 4.9 mm of
 * clearance to the wall (nearly twice what the old fraction gave) and 3.75 mm of
 * lid outside the hole at full bloom.
 */
const LID_RIM = 0.05;

/**
 * HOW DEEP THE WALLS OF THE HOLE GO, as a share of the head's own height.
 *
 * <<I fori sono geometria vera: coperchio forato con le pareti interne del foro
 * disegnate>>. A hole cut in a lid of no thickness is a hole a walker sees the
 * inside of the head through and nothing else -- what makes it read as an
 * OPENING is a throat: four inward-facing panels hanging under the rim, which
 * catch the light on their own normals and put a lip of shadow round the hole.
 *
 * A FIFTH OF THE HEAD'S HEIGHT, and the ceiling on it is arithmetic: the throat
 * must not reach the lamp under it, or the two would intersect and the lamp
 * would be drawn through its own chimney. The white lamp's top stands 2.51 cm
 * under the lid at the nominal size and the throat comes down 1.27, so it stops
 * 1.24 cm short; the blue stamens stand lower still. guard-fiori reads that
 * clearance off the boxes.
 */
const THROAT = 0.22;

/**
 * THE DAY'S OWN CEILING ON THE APERTURE, and it is a gate as much as a number.
 *
 * <<Di giorno i fiori sono chiusi o appena aperti, in un range molto vicino alla
 * chiusura>>. A tenth of the way to the open hole is 1.9 mm of extra width on a
 * white lid and 1.4 on a blue one: every day flower's hole is a NARROW hole, and
 * no two of them are the same width, which is what a meadow of hand-made lids
 * looks like and what a meadow of identical cubes never does.
 *
 * AND IT IS WHAT MAKES <<I PISTILLI STANNO DENTRO>> TRUE BY CONSTRUCTION rather
 * than by a second number that could drift away from this one. The protrusion
 * below is scaled by (aperture - this) over (1 - this), floored at nought, so
 * every flower whose aperture is at or under this ceiling has its pistil exactly
 * inside its head -- and guard-fiori reads that off the boxes rather than off
 * this sentence.
 */
const DAY_OPEN = 0.10;

/**
 * HOW THICK A WALL OF THE HEAD IS: nothing, and that is the design and not a
 * saving.
 *
 * The committente's word for the head's translucent walls is <<petali>> and it
 * is kept here, but since E-DECISIONI16 they do not move: the head is a CLOSED
 * BOX -- four sides, a floor, and a lid with a hole in it -- and each of its
 * faces is a PANEL, one quad drawn on both sides, so the inside of the shell is
 * there to be seen through the outside of it and through the hole. The
 * alternative is a slab, six quads instead of one, and it buys an edge that is
 * under a tenth of a pixel at the range a walker inspects a flower from.
 *
 * AND THE RULE OF E-FIORI3 IS NOT BEING BENT. That session's law is <<a face
 * comes off only when another face covers it, never when an argument says nobody
 * will look>>, and it was written about a solid that had four of its nine quads
 * wound the wrong way and culled. A double-sided panel has no back face to lose:
 * it cannot be wound the wrong way, and guard-avvolgimento reads `side` off the
 * material object (E-GUARDIA1) rather than trusting a comment. The ray bench in
 * guard-fiori still asks the question that matters -- can a walker at any
 * bearing see INTO a head through a gap in its shell -- and it is asked of the
 * SIDES, because the lid's hole is an opening this session was TOLD to cut and a
 * gate that called it a defect would be gating against the mandate.
 */
const PETAL_SIDES = DoubleSide;

/**
 * HOW MUCH OF WHAT IS BEHIND A PETAL COMES THROUGH IT.
 *
 * <<Petali leggermente trasparenti>>, and the two words pull opposite ways: far
 * enough through that the lit pistil reads as a glow inside a bud, not so far
 * that the head stops being the solid white or blue block the target draws. The
 * second is the harder constraint and it is the one that fixes the number, at
 * four metres, on the delivered frame -- see the verbale's sweep of four values
 * against the head's own read.
 *
 * WHAT THE NUMBER MEANS IN THE FRAME, and it is not what one wall passes. A
 * head presents TWO panels along any line of sight -- the near one and the far
 * one, both drawn -- so what a head passes is (1 - this) squared, which is ONE
 * AND A HALF per cent at this value: a head is 98.6 per cent opaque and the
 * meadow behind it is not visible through it at all.
 *
 * AND IT MOVED THIS SESSION, FROM 0.80, BECAUSE THE HALO TOOK OVER ITS JOB.
 * U-FIORI-4 had to buy the lume with transparency -- the lamp was the only thing
 * that glowed, so the only way to see it was through the wall -- and 0.80 was
 * the least transparency that let it through. The coordinator's eye on that
 * delivery was <<una scatola di vetro con una macchia gialla dentro>>, which is
 * what a head bought that way looks like. With HALO_DAY the WALL glows, so the
 * lume no longer has to be seen through anything, and the sweep says the two
 * are nearly independent: at the delivered halo the white head's warmest pixel
 * reads R-B 44 at this alpha against 49 at 0.80 -- five levels of lume given up
 * -- while what the head passes falls from 4.0 per cent to 1.4, which is the
 * head going from translucent to solid. On the BLUE the trade is better still:
 * the head keeps twenty-one levels of its own blue over the red instead of
 * fourteen. E-DECISIONI15's <<leggermente trasparenti>> is still what this is;
 * <<leggermente>> is where it has moved to.
 */
const PETAL_ALPHA = 0.88;

/**
 * THE WHITE FLOWER'S PISTIL: one cube in the middle of the head.
 *
 * <<I BIANCHI = tipo A: un pistillo centrale (cubetto giallo caldo)>>, and the
 * coordinator's mandate sizes it at about a third of the head. A third of 7.5 cm
 * is 2.5 cm, which is the same 2.5 cm the stalk is wide: the flower has one
 * width for the thing that feeds it and the thing that lights it, which is not a
 * coincidence worth hiding.
 */
const CORE_SIDE = 1 / 3;

/**
 * AND HOW FAR IT COMES OUT WHEN THE FLOWER BLOOMS, as a share of the head.
 *
 * <<Di notte sporge da 1/4 a 2/4 della testa secondo la taglia del fiore>>: the
 * smallest head in the draw stands its lamp out by a quarter of itself and the
 * largest by a half, and everything between is linear in the size the flower was
 * drawn at. It is a share of the HEAD and not of the pistil, so a big flower
 * carries a lamp further out of itself as well as a bigger one -- which is the
 * reading E-DECISIONI9 asked the night for, <<luci calde di intensita' e
 * dimensione diverse>>, arriving as geometry rather than as a second law.
 */
const CORE_REACH = { min: 0.25, max: 0.50 };

/**
 * THE BLUE FLOWER'S PISTILS: three or four, at the corners, on very short stems.
 *
 * <<I BLU/AZZURRI = tipo B: 3 o 4 pistilli (numero variabile per fiore); di
 * notte sporgono da 1/4 a 3/4 secondo la taglia>>. A quarter of the bud is the
 * mandate's own size for one of them, and the stem under it is the shortest
 * thing in this file -- a tenth of the head, which is 7.5 mm -- because what it
 * has to do is lift a stamen clear of the cup's floor and nothing else.
 *
 * HOW MANY: FOUR, ALWAYS. E-DECISIONI15 left the count variable and U-FIORI-4
 * settled it on the cheap side -- three stamens, and a fourth on three flowers
 * in ten. E-DECISIONI16.2 closes it: <<non voglio piu' quelli da 3>>. So the
 * collapsible fourth is gone, with the per-instance flag that carried it and the
 * branch in the shader that read it: a blue flower is four stamens under four
 * holes, and the hole in the lid is what says where each of them stands.
 */
const STAMEN_SIDE = 1 / 4;
const STAMEN_STEM = 0.10;
const STAMEN_REACH = { min: 0.25, max: 0.75 };
const STAMEN_COUNT = 4;

/**
 * HOW HARD THE PISTIL BURNS BY DAY, as a multiple of its own pigment.
 *
 * <<Il pistillo EMETTE LUCE anche di giorno, molto fioca>>, and the ceiling on
 * "faintly" is not taste, it is the post chain: src/core/post.js takes the bloom
 * from the scene buffer at a threshold of 0.72 with a knee of 0.30, so anything
 * whose brightness passes 0.42 starts to halo and anything past 1.02 is taken
 * whole. A day pistil has to land INSIDE that shoulder -- over the knee, so
 * there is a halo to see through the petals, and well under the top of it, so
 * the halo does not go white and lose the colour that is the point of it.
 *
 * SO THE CEILING IS ARITHMETIC AND THE FLOOR IS A MEASUREMENT. The brightest
 * lamp this meadow can draw is the white pistil's own pigment at its worst
 * channel, 0.9499, times this, times the 1.25 a big flower's own multiplier can
 * reach: at 0.75 that comes to 0.89, which is inside the shoulder and UNDER the
 * top of it, so a lamp seen straight through a parted petal haloes and does not
 * go white. Under it, the sweep in the verbale reads what a walker actually
 * gets: at one metre and through a petal, the head's warmest pixel goes from
 * R-B 29 with the lamp out to 42 at this value, with NOT ONE pixel over 235 of
 * 255 anywhere on the plant at any value up to 1.3.
 *
 * The emission is a multiple of the pistil's PIGMENT and not a colour of its
 * own, so a blue flower's lamp is warm in the same relation to its head that a
 * white one's is -- the same discipline cyanPistil is built with.
 *
 * AND THE NIGHT IS DECLARED AND NOT DELIVERED. GLOW_NIGHT is what the bench
 * drives uGlow to for the affiancati at full bloom; nothing on this branch sets
 * it, because the night is V7's and E-DECISIONI2 says only the day is built.
 */
const GLOW_DAY = 0.75;
const GLOW_NIGHT = 3.0;

/**
 * THE HALO, WHICH IS THE THING E-FIORI4 SHIPPED WITHOUT AND THE COMMITTENTE
 * ASKED FOR TWICE.
 *
 * <<Basta un alone che simuli il pistillo illuminato, che si intraveda
 * attraverso i petali>> (E-DECISIONI15), and the coordinator's eye on the first
 * delivery: <<di giorno la testa legge come una scatola di vetro con una macchia
 * gialla dentro: manca l'ALONE>>. He was right, and the reason is that a lamp
 * inside a box lights the box, and nothing in the first flower did: the lamp
 * carried an emission and the shell carried none, so what the eye got through
 * the petals was the lamp's own pixels at a fifth and a cold white shell round
 * them. A lit lantern is the other way about -- the SHELL is what glows.
 *
 * SO THE SHELL CARRIES A RADIAL TERM CENTRED ON THE LAMP, and it is the lamp's
 * own pigment times a fall with the square of the distance from it:
 *
 *     halo(p) = r^2 / (r^2 + |p - lamp|^2)
 *
 * with r the lamp's own half-side, so the term is one AT the lamp and goes as
 * one over distance squared away from it -- the fall a point source has, written
 * so that it does not divide by nought at the source. It is evaluated PER PIXEL
 * on the head's own walls, its lid, the walls of its hole and the floor of its
 * cup, so what a walker sees is a head that is brightest where the lamp is
 * behind it and cool at the corners: a solid head with a light in it, which is
 * the reading asked for, and not a pane of glass with a mark behind it.
 *
 * AND WHAT THE NUMBER IS, IS THE MEAN AND NOT THE STRENGTH. What is written
 * here is how much warm the halo adds over a head's own skin ON AVERAGE, as a
 * multiple of the lamp's own pigment at that flower's own burn; what each kind's
 * material is given is this divided by what the term averages over ITS skin
 * (haloMean). Two reasons, and the second is the one that decides it:
 *
 *   A BLUE HEAD CARRIES FOUR LAMPS AND A WHITE ONE. The term is a sum over the
 *   lamps, so at one strength a blue head takes two and a half times the light a
 *   white one does, on a head a tenth smaller. Measured in the frame: at the
 *   strength that merely warms a white head, a blue head has stopped being blue
 *   -- R and B meet and the cyan reads as a white lantern. The committente's
 *   reading is <<una testa bianca/blu SOLIDA con un lume dentro>>, and a blue
 *   head that is not blue has failed it before any other number is looked at.
 *
 *   AND THE FAR FAMILY THEN NEEDS NO NUMBER OF ITS OWN. Past the exchange ring a
 *   head is one quad carrying the MEAN of this term over the skin it stands in
 *   for -- and normalised, that mean IS this constant, for either kind. The seam
 *   the ring was ratified on closes by construction instead of by two uniforms
 *   agreeing.
 *
 * THE NUMBER ITSELF IS A MEASUREMENT AND IS SWEPT IN THE FRAME, like GLOW_DAY
 * before it, against two ends that are both defects: too little and the head is
 * the glass box again, too much and the head loses its own colour (and, further
 * up, passes the top of the post chain's bloom shoulder and goes white). The
 * verbale carries the sweep. It multiplies uGlow, so the night moves it without
 * a second number.
 */
const HALO_DAY = 0.22;

/**
 * THE FLOWERS THAT ARE OPEN, AND THE HALF OF E-DECISIONI9.1 THAT WAS OWED.
 *
 * <<Il bocciolo e' un cubo che varia di scala (i fiorellini piccoli) ma puo'
 * variare anche SOLO IN ALTEZZA (non piu' un cubo: i fiori piu' aperti)>>. The
 * scale half has been built since U-ERBA-1 and is HEAD_MIN to HEAD_MAX drawn per
 * flower; the height half was carried as a residual, because it needs a SECOND
 * per-instance attribute and because the census of nineteen heads publishes a
 * median height and no spread for it (E-ERBA-A §4: width p25/p50/p75 at 7.6, 8.2
 * and 9.0 cm, height p50 at 6.3 and nothing either side of it).
 *
 * THE ATTRIBUTE IS CHEAP AND THE SPREAD IS DECLARED. The attribute is one float
 * on a record that already carries two, and no draw. The two numbers below are
 * NOT measured and are not offered as measured: the census cannot resolve them.
 * What they are is the committente's sentence turned into arithmetic -- the
 * closed bud is the census median and stays squat, a minority of heads are open,
 * and an open one is not a cube any more because it is TALLER than it is wide.
 * One in four, and the tallest of them stands at 1.075 of its own width against
 * the bud's 0.768.
 */
const OPEN_SHARE = 0.25;
const OPEN_STRETCH = 0.40;

/**
 * HOW MUCH PALER THE TOP OF A STALK IS THAN ITS FOOT, AND IN HOW MANY STEPS.
 *
 * E-DECISIONI10: <<gli steli hanno una gradazione dalla base alla cima>>. In
 * steps and not as a ramp, because everything else in this world is a lattice
 * and a stalk that faded smoothly would be the one column in the frame that does
 * not step. How many: the mat's blade is 5 cm (columns.js BLADE) and a nominal
 * stalk is 7.5, so a stalk is taller than one blade and takes the two the rule
 * asks for.
 *
 * The DEPTH is a choice and is declared as one: the reference's own stalk is a
 * hand reading on two exemplars and E-ERBA-A §8.9 says so itself, so there is no
 * gradient to fit. Eighteen per cent between foot and tip, hung about the
 * measured pigment so the stalk's MEAN colour is exactly the one U-ERBA-1 fitted
 * and the gradation costs the family nothing.
 */
const STALK_STEPS = 2;
const STALK_GRADE = 0.18;

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

/**
 * THE SETTINGS THE STALK'S OWN ZONE IS SAMPLED WITH, which are the meadow's with
 * the stalk family's override laid over them -- the same pair src/world/voxel/
 * pigment.js hands its own fragment. Built here once rather than per flower, and
 * built from that module's exports rather than from a copy of its numbers.
 */
const STALK_FIELD = { ...PIGMENT, ...FAMILY.stalk };

function flowerPigments() {
  const meadow = voxelSettings().albedo;
  if (!meadow || !(meadow instanceof Vector3)) {
    throw new Error('vegetation: the pigment seat publishes no meadow albedo');
  }
  const level = luma(meadow) * PALE_STEP;
  const pale = PALE_HUE.clone().multiplyScalar(level / luma(PALE_HUE));
  const cyan = CYAN_HUE.clone().multiplyScalar(luma(pale) * CYAN_OF_PALE / luma(CYAN_HUE));
  // One producer of a pistil, asked twice: the head it stands in, at the share of
  // that head's luminance the target's own band is worth. A white flower and a
  // blue one differ in which head is handed in and in nothing else.
  const pistilIn = (head) => PISTIL_HUE.clone()
    .multiplyScalar(luma(head) * PISTIL_OF_PALE / luma(PISTIL_HUE));
  return {
    pale,
    pistil: pistilIn(pale),
    cyan,
    // THE BLUE'S OWN PISTIL, AND WHERE ITS COLOUR COMES FROM.
    //
    // The reference has none to measure: C-TEXTURE §1.6 cut five cyan heads at
    // 22x and found ZERO yellow pixels on all five, and E-DECISIONI9 wrote that
    // down as a law. E-DECISIONI11 overturns it -- <<anche i blu devono avere i
    // pistilli>> -- so a colour has to come from somewhere the reference DOES
    // show, and the nearest such thing is the only pistil in the picture, the
    // white flower's.
    //
    // WHAT IS CARRIED OVER IS THE LAW AND NOT THE TRIPLE. Copying the white's
    // pistil onto a blue head would put a pigment fitted against an L* 84 head
    // onto an L* 81 one and call the result measured. What is measured is the
    // RELATION: PISTIL_HUE, which is the hue the target's band has with its level
    // taken out, at PISTIL_OF_PALE of its own head's luminance. Applied to the
    // cyan seat instead of the pale one, that puts a blue head's pistil in the
    // same relation to its head as a white head's is to its. It comes to
    // (0.582, 0.380, 0.012) -- L* 69.2, croma 67.5, hue 90 degrees against a head
    // at 80.9 and 241 -- which is a legal pigment in every channel and 151
    // degrees of hue away from the head it stands in.
    cyanPistil: pistilIn(cyan),
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
  // HOW FAR OPEN THIS ONE IS DRAWN, on a hash of its own and not on its size:
  // E-DECISIONI9.1 puts the two apart -- a head varies in scale AND, separately,
  // in height alone -- so a small flower is as likely to be open as a large one.
  // One in OPEN_SHARE of them, and an open one is drawn anywhere up to
  // OPEN_STRETCH taller than the bud the census measured.
  const r5 = hash2(gx * 65867 + k * 40503, gz * 17389 + FLOWER_SEED * 23);
  const open = 1 + (r5 < OPEN_SHARE ? OPEN_STRETCH * (1 - r5 / OPEN_SHARE) : 0);
  // AND HOW FAR THIS ONE'S PETALS ARE PARTED BY DAY, on a hash of its own.
  //
  // <<Di giorno i fiori sono chiusi o appena aperti, in un range molto vicino
  // alla chiusura>>: a seed per flower over [0, DAY_OPEN], which is nought to
  // 6.2 degrees of swing. It is a fourth hash rather than a reuse of one of the
  // three above because it must not correlate with the size, the colour or the
  // stretch -- a meadow where every big flower is the one that is ajar is a
  // meadow with a rule in it, and this one has none.
  const r6 = hash2(gx * 17389 + k * 92083, gz * 65867 + FLOWER_SEED * 29);
  const dayOpen = DAY_OPEN * r6;
  // HOW FAR ITS LAMP COMES OUT WHEN IT BLOOMS, and it is the SIZE that decides:
  // <<sporge da 1/4 a 2/4>> for a white and <<da 1/4 a 3/4>> for a blue,
  // <<secondo la taglia del fiore>>. The draw a size came from is r4, taken
  // before the cyan scale is applied, so a blue flower's reach runs over its own
  // whole band instead of over the top nine tenths of the white's.
  const band = cyan ? STAMEN_REACH : CORE_REACH;
  const lampReach = band.min + (band.max - band.min) * r4;
  // AND HOW MANY LAMPS IT CARRIES, which is no longer a draw. E-DECISIONI15
  // left it at <<3 o 4 pistilli (numero variabile per fiore)>> and E-DECISIONI16.2
  // closed it: <<non voglio piu' quelli da 3>>. So a blue flower is four and a
  // white one is one, and the hash that used to decide it is gone rather than
  // drawn and thrown away -- the sowing is a sequence of draws and a dead one in
  // the middle of it is a trap for whoever adds the next.
  const stems = cyan ? STAMEN_COUNT : 1;
  // The stalk's own zone, sampled where the flower stands. The pigment field is
  // asked on the COLUMN under it, which is the cell the ground beside it reads,
  // so a stalk and the cube at its foot are never in two different zones.
  const zone = pigTint(Math.floor(x / VOXEL), Math.floor(z / VOXEL), STALK_FIELD);
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
    // AND IT IS THE HEAD THIS FLOWER ACTUALLY HAS, WHICH MOVED TWICE HERE.
    //
    // What stood was `STALK_TALL * scale + size / 2`, and it read the head as a
    // CUBE of side `size`. The head has been squat by HEAD_SQUAT since U-ERBA-1
    // -- 6.3 cm tall on 8.2 across, the census of nineteen -- so the centre this
    // published stood 8.7 mm over the centre the meadow draws, on every flower
    // in the disc. That is the first move and it is a defect being paid off.
    //
    // The second is the open flowers: a head drawn OPEN_STRETCH taller has its
    // centre higher by half of what it grew, up to 11 mm more. Both are one line
    // because both are the same sentence -- half of the head that is there --
    // and V7 hangs its lamp core at this y, so a head that grew and a y that did
    // not would put the lamp in the bottom of the bud.
    y: height(x, z) + mantoAt(x, z)
      + STALK_TALL * scale + size * HEAD_SQUAT * open / 2,
    z,
    size,
    kind: cyan ? 'ciano' : 'bianco',
    // Only the ring needs these; they cost nothing and keep the callers reading
    // ONE record -- which is the whole reason this function exists, because a
    // lamp hung by V7 where no flower is drawn is a defect nobody finds until
    // the night is integrated.
    scale,
    open,
    zone,
    tint: FLOWER_TINT.min + (FLOWER_TINT.max - FLOWER_TINT.min) * r1,
    // THE LANTERN'S OWN FOUR, and they are published to the CONTRACT as well as
    // to the ring: the night hangs its lamp on the pistil, so how far that pistil
    // travels out of its bud and how hard it burns are facts about the flower and
    // not about the hour. `glow` is a multiple on top of the world's own uGlow --
    // E-DECISIONI9's <<luci calde di intensita' e dimensione diverse>> as a
    // number rather than as a second law, and it is the SIZE again, because a
    // bigger bud carries a bigger lamp.
    dayOpen,
    lampReach,
    stems,
    glow: 0.75 + 0.5 * r4,
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
    head: { min: HEAD_MIN, max: HEAD_MAX, nominal: HEAD_NOMINAL, cyanScale: CYAN_SCALE,
      squat: HEAD_SQUAT, openShare: OPEN_SHARE, openStretch: OPEN_STRETCH },
    stalk: { wide: STALK_WIDE, tall: STALK_TALL, steps: STALK_STEPS, grade: STALK_GRADE,
      foot: STALK_FOOT },
    // THE LANTERN, AND EVERY NUMBER OF IT FROM THE ONE PLACE THAT HAS IT: the
    // ceiling on the day's aperture, how far a petal swings, what a petal passes,
    // how hard a lamp burns -- and, per kind, the lamp's own size, how far it
    // reaches at full bloom and the share of a shut head it fills. A gate reads
    // these; it never reads this file as text and never holds a second copy.
    lantern: {
      dayOpen: DAY_OPEN, alpha: PETAL_ALPHA, throat: THROAT, lidRim: LID_RIM,
      glowDay: GLOW_DAY, glowNight: GLOW_NIGHT, halo: HALO_DAY,
      bianco: {
        side: CORE_SIDE, reach: { ...CORE_REACH }, stems: 1, stem: STAMEN_STEM,
        hole: { ...HOLE_WHITE, shutHalf: holeHalf('bianco', 0), openHalf: holeHalf('bianco', 1) },
        seat: lampSeats('bianco'),
        share: pistilShare('bianco'), gap: lampGap('bianco'), haloMean: haloMean('bianco'),
      },
      ciano: {
        side: STAMEN_SIDE, reach: { ...STAMEN_REACH }, stems: STAMEN_COUNT,
        stem: STAMEN_STEM, offset: STAMEN_OFFSET,
        hole: { ...HOLE_CYAN, shutHalf: holeHalf('ciano', 0), openHalf: holeHalf('ciano', 1) },
        seat: lampSeats('ciano'),
        share: pistilShare('ciano'), gap: lampGap('ciano'), haloMean: haloMean('ciano'),
      },
    },
    // THE FACES AT ANY HOUR, because the hole is the one part of this shell that
    // an hour moves and a gate that could only see it shut could not measure it
    // at all. One producer, asked twice, instead of a gate that rebuilds a rim.
    facesAt: (kind, aperture) => flowerBoxes(kind, aperture),
    // What the buffer actually holds, one kind at a time, so a gate can count
    // faces without owning a second copy of the geometry -- and what the roles in
    // it MEAN, so it does not have to guess that from an integer either.
    faces: { bianco: flowerFaces('bianco'), ciano: flowerFaces('ciano') },
    roles: { petal: ROLE_PETAL, floor: ROLE_FLOOR, pistil: ROLE_PISTIL, stalk: ROLE_STALK },
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
// per-flower: four values in the whole geometry.
//
// WHAT THE FOUR MEAN NOW. The PETAL is the shell -- the four sides and the four
// tips that shut over them -- and it is the only role that is drawn through. The
// FLOOR is the bottom of the cup, which is a petal that does not move and does
// not have to: nothing opens downward. The PISTIL is the lamp, which carries the
// warm pigment AND the emission, and is the only role that rises. The STALK is
// the stalk, unchanged: it is not the head, it is not lit by the head's own pair
// and it is not painted out of the two flower pigments.
const ROLE_PETAL = 0;
const ROLE_FLOOR = 1;
const ROLE_PISTIL = 2;
const ROLE_STALK = 3;

// The six outward normals of a box, and the up each face measures its own square
// against. A side stands its [0,1] square on world +Y; a lid and a floor have no
// up of their own and take +Z, which is a choice made once here rather than
// several times below.
const BOX_FACES = [
  { n: [1, 0, 0], v: [0, 1, 0] },
  { n: [-1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 0, -1], v: [0, 1, 0] },
  { n: [0, 1, 0], v: [0, 0, 1] },
  { n: [0, -1, 0], v: [0, 0, 1] },
];

/**
 * ONE CLOSED BOX, WOUND FROM ITS OWN NORMALS.
 *
 * THIS FUNCTION IS U-FIORI-3'S FIX AND IT IS KEPT WHOLE. The defect it retired
 * is worth leaving written down because it survived four sessions of
 * measurement: the nine quads of the flower were written out by hand as lists of
 * four corners and four of the nine were listed the wrong way round, so a
 * ShaderMaterial culling back faces drew five of them. <<Girandoci attorno
 * MANCANO DELLE FACCE, sia ai fiori che allo stelo>>, and no gate saw it because
 * every gate the flower had was arithmetic over the FIELD.
 *
 * HOW IT CANNOT GO WRONG. Every face is built from its outward normal n and an
 * up v, with the in-plane right worked out as u = v x n. Then u, v, n are a
 * right-handed triple by construction, the four corners are emitted at
 * (-u,-v), (+u,-v), (+u,+v), (-u,+v), and the first triangle's own normal is
 * (2u) x (2u + 2v) = 4 (u x v) = 4n -- outward, always, for any n this table
 * holds.
 *
 * @param {number[]} centre  the box's own centre, in metres
 * @param {number[]} half  its half-extents along x, y, z
 * @param {number|Function} role  the role of every face, or one per normal
 * @param {object} [extra]  what every face of this box carries besides its role:
 *   `rise` how much of the pistil's protrusion it takes, `extra` whether it is
 *   the fourth stamen, `petal` the outward direction it hinges towards
 * @param {number[][]} [skip]  normals not to emit, for a face another box covers
 * @returns {object[]} one entry a face: its corners, its normal, its role
 */
function boxFaces(centre, half, role, extra = {}, skip = []) {
  const out = [];
  const ext = (a) => Math.abs(a[0]) * half[0] + Math.abs(a[1]) * half[1] + Math.abs(a[2]) * half[2];
  for (const { n, v } of BOX_FACES) {
    if (skip.some((s) => s[0] === n[0] && s[1] === n[1] && s[2] === n[2])) continue;
    const u = [v[1] * n[2] - v[2] * n[1], v[2] * n[0] - v[0] * n[2], v[0] * n[1] - v[1] * n[0]];
    const du = ext(u);
    const dv = ext(v);
    const mid = [centre[0] + n[0] * ext(n), centre[1] + n[1] * ext(n), centre[2] + n[2] * ext(n)];
    const corner = (su, sv) => [
      mid[0] + u[0] * su * du + v[0] * sv * dv,
      mid[1] + u[1] * su * du + v[1] * sv * dv,
      mid[2] + u[2] * su * du + v[2] * sv * dv,
    ];
    out.push({
      corners: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
      normal: n,
      role: typeof role === 'function' ? role(n) : role,
      ...extra,
    });
  }
  return out;
}

/**
 * ONE PANEL: a face given by its corners, in the order that winds it outward.
 *
 * A petal is not a box and cannot be built out of one -- it is a single face,
 * drawn on both sides -- so it is written here, once, with the same discipline
 * boxFaces() has: the caller hands the corners anticlockwise seen from the
 * outward side and the normal is COMPUTED from them rather than declared beside
 * them, so a panel whose corners were listed the wrong way round would come back
 * with an inward normal and guard-fiori would say so. Under DoubleSide it would
 * still be drawn either way, which is exactly why the normal has to be checked
 * arithmetically instead of by looking at the frame.
 *
 * Three corners are as legal as four: the tips that shut over the top of a bud
 * are triangles, and a triangle emitted as a quad with a doubled corner would be
 * a degenerate triangle in every frame the flower is ever drawn in.
 *
 * @param {number[][]} corners  three or four points, anticlockwise from outside
 * @param {number} role
 * @param {object} [extra]
 */
function panelFace(corners, role, extra = {}) {
  const [a, b, c] = corners;
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return { corners, normal: [n[0] / len, n[1] / len, n[2] / len], role, ...extra };
}

/** Where the foot of a stalk is buried, so a slope never shows daylight under it. */
const STALK_FOOT = -0.03;

/**
 * ONE FACE WHOSE CORNERS CAN MOVE WITH THE HOUR, which is what a hole needs.
 *
 * A corner of the lid's frame or of the hole's throat is not a fixed point: it
 * is the hole's own CENTRE plus its half-width in a direction. The buffer
 * therefore cannot hold the corner -- it holds the centre and the direction, and
 * the vertex shader puts the two together with the half-width the hour asks for,
 * which is the one number the aperture moves in the whole shell now.
 *
 * So a rigged face carries three parallel lists: the corners AT the aperture it
 * was built for, which is what a ray bench and a winding test need; the BASE of
 * each corner, which is what goes in the position buffer; and the RIM sign of
 * each, which is what goes in the attribute beside it. A corner that does not
 * move has itself as its base and a sign of nought, so one writer serves both.
 *
 * @param {{p: number[], base: number[], rim: number[]}[]} recs  three or four
 *   corners, anticlockwise seen from the outward side
 */
function riggedFace(recs, role, extra = {}) {
  const face = panelFace(recs.map((r) => r.p), role, extra);
  face.base = recs.map((r) => r.base);
  face.rim = recs.map((r) => r.rim);
  return face;
}

/**
 * THE HALF-WIDTH OF A KIND'S HOLE AT AN APERTURE, in metres at the nominal size.
 *
 * The one producer of it: the geometry builds its rim with it, the shader is
 * handed its two ends as uniforms and interpolates between them on exactly this
 * law, and guard-fiori measures the hole it gets off the boxes rather than off
 * this line. <<Piu' o meno stretto di giorno e piu' o meno largo di notte>> is
 * this function and nothing else.
 */
function holeHalf(kind, aperture) {
  const band = kind === 'ciano' ? HOLE_CYAN : HOLE_WHITE;
  return HEAD_NOMINAL * (band.shut + (band.open - band.shut) * aperture) / 2;
}

/**
 * WHERE A BLUE FLOWER'S STAMENS STAND, DERIVED FROM THE HOLE OVER THEM.
 *
 * Half a head, less the rim the lid keeps, less half the widest hole: the hole
 * is placed first because the hole is the thing that has to have lid on both
 * sides of it, and the stamen goes under the hole because a stamen that came out
 * anywhere else would come out through the lid. See LID_RIM.
 */
const STAMEN_OFFSET = HEAD_NOMINAL * (0.5 - LID_RIM - HOLE_CYAN.open / 2);

/**
 * WHERE A KIND'S LAMPS STAND AND HOW BIG THEY ARE, in the head's own frame.
 *
 * One producer for the three things that need it: the boxes below hang the lamps
 * here, the fragment centres its halo here, and the far family's mean halo is
 * integrated against these. A second copy of these four coordinates is exactly
 * how a halo ends up centred somewhere the lamp is not.
 */
function lampSeats(kind) {
  const stem = HEAD_NOMINAL * STAMEN_STEM;
  if (kind === 'ciano') {
    const b = HEAD_NOMINAL * STAMEN_SIDE / 2;
    const off = STAMEN_OFFSET;
    return {
      half: b,
      y: STALK_TALL + stem + b,
      xz: [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz]) => [sx * off, sz * off]),
    };
  }
  const c = HEAD_NOMINAL * CORE_SIDE / 2;
  return { half: c, y: STALK_TALL + stem + c, xz: [[0, 0]] };
}

/**
 * THE FLOWER, AT THE NOMINAL SIZE, in metres.
 *
 * WHAT STANDS THERE, from the bottom up, and it is one plant of two kinds:
 *
 *   THE STALK, a closed box on four sides with its foot buried. Its lid is
 *   covered by the cup's own floor and its foot is built -- U-FIORI-3's ray
 *   bench found 198 rays entering an open bottom from eight degrees below the
 *   plant, which is a walker on the low side of a step, and the rule that
 *   session left behind is that a face comes off only when another face covers
 *   it. Unchanged.
 *
 *   THE FLOOR OF THE CUP, one panel at the top of the stalk. It is what the lamp
 *   stands on and what stops a walker seeing up into the head from below -- and
 *   it is what a walker looking DOWN the hole sees behind the lamp, which is why
 *   it is opaque and why it carries the halo.
 *
 *   THE FOUR SIDES, the four faces of the target's own cube. They do not move
 *   any more: E-DECISIONI16 retired the petals that turned, and the head is the
 *   closed box E-FIORI3 built, at the silhouette that shipped.
 *
 *   THE LID, WITH A HOLE IN IT. One hole on a white flower, in the middle; four
 *   on a blue one, one over each stamen. A lid with a rectangular hole in it is
 *   four trapezoids -- the mitre a picture frame is cut with -- and a blue lid
 *   is that four times, once per quadrant, because each quadrant holds exactly
 *   one hole. The hole's own width is the APERTURE: narrow by day, wide at full
 *   bloom, and the rim of it is the only part of this shell the hour moves.
 *
 *   THE THROAT, four inward-facing panels hanging under each hole's rim. This is
 *   <<le pareti interne del foro disegnate>>: what makes the hole an opening
 *   with depth rather than a square drawn on a lid.
 *
 *   AND THE LAMP:
 *
 *     BIANCO (type A) -- one cube of a third of the head, in the middle, on a
 *     short column that STRETCHES as the flower blooms. Shut, the cube sits on
 *     the floor of the cup under a narrow hole. Open, it rises through it.
 *
 *     BLU (type B) -- FOUR cubes of a quarter of the head, each on its own short
 *     column, each under its own hole (E-DECISIONI16.2: the three-stamen flower
 *     is gone).
 *
 * THE SIDES ARE SHUT FROM EVERY BEARING, which is the leg of E-FIORI3 this
 * session inherits: four sides, a floor and a lid make a closed box, and the one
 * opening in it is the one the mandate asked to cut. guard-fiori sweeps rays at
 * the sides to say the first and measures the hole to say the second.
 *
 * WHY THE HEAD IS NOT TURNED, unchanged: every cube in this world is on the
 * lattice and the target's heads are too, so a yaw per flower would be the one
 * population in the frame that is not.
 *
 * @param {'bianco'|'ciano'} kind  which lamp the plant carries
 * @param {number} [aperture]  how far its hole is open, nought to one
 */
function flowerBoxes(kind, aperture = 0) {
  const h = HEAD_NOMINAL / 2;
  const y0 = STALK_TALL;
  const tall = HEAD_NOMINAL * HEAD_SQUAT;
  const y1 = y0 + tall;
  const s = STALK_WIDE / 2;
  const q = holeHalf(kind, aperture);
  const out = [];

  // THE STALK: four sides and a foot. Its lid is not built because the cup's
  // floor is wider than it and covers the whole of it, at the same height,
  // always -- an occlusion that is a fact about two solids and not about where a
  // walker can stand.
  out.push(...boxFaces([0, (STALK_FOOT + y0) / 2, 0], [s, (y0 - STALK_FOOT) / 2, s],
    ROLE_STALK, {}, [[0, 1, 0]]));

  // THE FLOOR OF THE CUP: one panel, wound to face DOWN, which is the side of it
  // a walker outside the plant can be on. Opaque, and it is the one part of the
  // shell that is: it is the bottom a lamp stands on rather than a wall, and a
  // translucent one would show the hollow of the stalk under it. Drawn on both
  // sides like everything else here, so what a walker sees down the hole behind
  // the lamp is this floor and never the inside of the stalk.
  out.push(panelFace([[-h, y0, -h], [h, y0, -h], [h, y0, h], [-h, y0, h]], ROLE_FLOOR));

  // AND THE LAMPS, WHICH COME BEFORE THE SHELL AND HAVE TO.
  //
  // THIS IS AN ORDER AND NOT A LIST, and it was found by measuring instead of by
  // reading. With the shell emitted first, the near wall wrote depth and the
  // lamp behind it was rejected by the depth test: the white flower's glow was
  // not dim, it was ABSENT, and the sweep read the same pixel at every value of
  // uGlow including nought -- which is what a thing that is not drawn reads
  // like. The opaque core is emitted first so that it writes depth first; the
  // shell then blends OVER it at (1 - alpha) of the lamp, which is exactly what
  // <<che si intraveda attraverso i petali>> asks for.
  const seat = lampSeats(kind);
  const stem = HEAD_NOMINAL * STAMEN_STEM;
  const b = seat.half;
  for (const [cx, cz] of seat.xz) {
    // The column: four sides. Its top is covered by the lamp and its foot stands
    // on the cup's floor, which is the panel it would otherwise show through.
    // Its top corners carry the rise and its foot does not, so it STRETCHES as
    // the lamp climbs -- and the same number fades the emission down it, which
    // is E-DECISIONI16.4: <<la fonte luminosa e' il NUCLEO, non lo stelo; lo
    // stelo e' luminoso solo sotto il nucleo e sfuma verso il basso>>.
    out.push(...boxFaces([cx, y0 + stem / 2, cz],
      [b * (kind === 'ciano' ? 0.28 : 0.30), stem / 2, b * (kind === 'ciano' ? 0.28 : 0.30)],
      ROLE_PISTIL, { riseTop: 1 }, [[0, 1, 0], [0, -1, 0]]));
    out.push(...boxFaces([cx, seat.y, cz], [b, b, b], ROLE_PISTIL, { rise: 1 }));
  }

  // THE FOUR SIDES OF THE HEAD, which are the four sides of the target's cube.
  out.push(...boxFaces([0, (y0 + y1) / 2, 0], [h, tall / 2, h], ROLE_PETAL, {},
    [[0, 1, 0], [0, -1, 0]]));

  // THE LID AND ITS HOLES. A white lid is one frame round one hole; a blue lid
  // is four quadrant frames, each round the hole over its own stamen -- which is
  // the decomposition that works because each hole sits wholly inside its own
  // quadrant, and the offset above is derived to keep it there.
  const panes = seat.xz.map(([cx, cz]) => ({
    cx,
    cz,
    x0: seat.xz.length === 1 ? -h : Math.min(0, Math.sign(cx) * h),
    x1: seat.xz.length === 1 ? h : Math.max(0, Math.sign(cx) * h),
    z0: seat.xz.length === 1 ? -h : Math.min(0, Math.sign(cz) * h),
    z1: seat.xz.length === 1 ? h : Math.max(0, Math.sign(cz) * h),
  }));
  const throatLow = y1 - tall * THROAT;
  for (const pane of panes) {
    const { cx, cz, x0, x1, z0, z1 } = pane;
    // An OUTER corner of the frame, which does not move with the hour.
    const O = (x, z) => ({ p: [x, y1, z], base: [x, y1, z], rim: [0, 0] });
    // An INNER one, which is the hole's centre plus its half-width in a
    // direction: the base is the centre and the sign is what the shader adds to.
    const R = (sx, sz, y) => ({
      p: [cx + sx * q, y, cz + sz * q], base: [cx, y, cz], rim: [sx, sz],
    });
    const I = (sx, sz) => R(sx, sz, y1);
    // The four trapezoids of the mitre, each wound so its own normal is +Y --
    // and panelFace() computes that normal from the corners, so a band listed
    // the wrong way round comes back pointing into the head and guard-fiori
    // says so instead of the frame looking slightly wrong.
    out.push(riggedFace([O(x1, z0), O(x0, z0), I(-1, -1), I(1, -1)], ROLE_PETAL));
    out.push(riggedFace([O(x0, z1), O(x1, z1), I(1, 1), I(-1, 1)], ROLE_PETAL));
    out.push(riggedFace([O(x0, z0), O(x0, z1), I(-1, 1), I(-1, -1)], ROLE_PETAL));
    out.push(riggedFace([O(x1, z1), O(x1, z0), I(1, -1), I(1, 1)], ROLE_PETAL));
    // AND THE THROAT: four panels hanging under the rim, each facing INTO the
    // hole, so the walls of the opening are lit on the side a walker looking
    // down at it sees. They are rigged on the same rim, so a hole that widens
    // widens its own walls with it.
    out.push(riggedFace([R(-1, 1, throatLow), R(-1, -1, throatLow),
      R(-1, -1, y1), R(-1, 1, y1)], ROLE_PETAL));
    out.push(riggedFace([R(1, -1, throatLow), R(1, 1, throatLow),
      R(1, 1, y1), R(1, -1, y1)], ROLE_PETAL));
    out.push(riggedFace([R(-1, -1, throatLow), R(1, -1, throatLow),
      R(1, -1, y1), R(-1, -1, y1)], ROLE_PETAL));
    out.push(riggedFace([R(1, 1, throatLow), R(-1, 1, throatLow),
      R(-1, 1, y1), R(1, 1, y1)], ROLE_PETAL));
  }

  return out;
}

/**
 * THE FACES THE BUFFER HOLDS, published so a gate can count them.
 *
 * The census carries this because of what went wrong once: the flower's gates
 * were arithmetic over the FIELD and none of them ever read a triangle, so four
 * quads wound the wrong way lived through every one of them. A gate that wants
 * to ask "can a walker standing there see into a shut bud" needs the faces, and
 * it must not hold a second copy of them.
 *
 * @param {'bianco'|'ciano'} kind
 * @returns {{normal: number[], role: number, corners: number[][]}[]}
 */
function flowerFaces(kind) {
  return flowerBoxes(kind);
}

/**
 * WHAT A VERTEX CARRIES BESIDES ITS PLACE, packed into one vec3.
 *
 *   x, y  WHICH CORNER OF ITS OWN HOLE this vertex is, as a sign pair in
 *         {-1, 0, +1}: the shader puts it back where it belongs by adding the
 *         hour's half-width times this to the hole's centre, which is what the
 *         position buffer holds for it. Nought for every vertex that is not on a
 *         rim, and those hold their own place in the position buffer.
 *   z     how much of the pistil's protrusion this vertex takes -- one at the
 *         top of the lamp's column and over the whole of the lamp, nought at the
 *         foot of the column, so the column STRETCHES instead of flying. AND it
 *         is the same number the emission is faded by, which is not a reuse but
 *         the same fact twice: <<lo stelo e' luminoso solo sotto il nucleo e
 *         sfuma verso il basso>>, and the foot of the column is the end that
 *         neither moves nor burns.
 *
 * It was a vec4 and the fourth was the collapsible stamen; E-DECISIONI16.2 took
 * that away, so the fourth is gone rather than left carrying nought.
 */
function packLook(face, corner, index, mid) {
  const rim = face.rim ? face.rim[index] : null;
  let rise = face.rise ? 1 : 0;
  // A column's TOP takes the protrusion and its foot does not: that is the whole
  // of the stretch, and it is read off the corner's own height rather than
  // declared per face, because a box hands its four sides as four faces and the
  // top two corners of each of them are the ones that have to move.
  if (face.riseTop) rise = corner[1] > mid ? 1 : 0;
  return [rim ? rim[0] : 0, rim ? rim[1] : 0, rise];
}

function flowerGeometry(kind) {
  const faces = flowerBoxes(kind);
  const verts = faces.reduce((n, f) => n + f.corners.length, 0);
  const tris = faces.reduce((n, f) => n + (f.corners.length - 2), 0);
  const positions = new Float32Array(verts * 3);
  const normals = new Float32Array(verts * 3);
  const roles = new Float32Array(verts);
  const look = new Float32Array(verts * 3);
  const indices = new Uint16Array(tris * 3);
  let v = 0;
  let i = 0;
  for (const face of faces) {
    const base = v;
    const mid = face.corners.reduce((a, c) => a + c[1], 0) / face.corners.length;
    for (let c = 0; c < face.corners.length; c += 1) {
      const corner = face.corners[c];
      // THE BASE AND NOT THE CORNER, for the vertices a hole moves: what the
      // buffer holds is where the corner would be if the hole had no width, and
      // the shader adds the hour's own half-width to it. For every other vertex
      // the base IS the corner, so there is one writer and no branch in the
      // frame.
      const seat = face.base ? face.base[c] : corner;
      positions[v * 3] = seat[0];
      positions[v * 3 + 1] = seat[1];
      positions[v * 3 + 2] = seat[2];
      normals[v * 3] = face.normal[0];
      normals[v * 3 + 1] = face.normal[1];
      normals[v * 3 + 2] = face.normal[2];
      roles[v] = face.role;
      const packed = packLook(face, corner, c, mid);
      look[v * 3] = packed[0];
      look[v * 3 + 1] = packed[1];
      look[v * 3 + 2] = packed[2];
      v += 1;
    }
    for (let t = 0; t < face.corners.length - 2; t += 1) {
      indices[i] = base;
      indices[i + 1] = base + t + 1;
      indices[i + 2] = base + t + 2;
      i += 3;
    }
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('aRole', new BufferAttribute(roles, 1));
  geometry.setAttribute('aPart', new BufferAttribute(look, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

/**
 * WHAT SHARE OF A SHUT HEAD'S SILHOUETTE THE LAMP FILLS, COMPUTED OFF THE BOXES.
 *
 * Seen square on, a shut head is a rectangle as wide as the target's bud and as
 * tall as its squat, and what is warm inside it is the lamp: for a white flower
 * one cube in the middle, for a blue one the two stamens on the near corners --
 * the far two stand exactly behind them and add nothing to a silhouette.
 *
 * IT IS THE ONE PRODUCER OF THAT NUMBER: the census publishes it, the far
 * family's quad paints its glow with it, and guard-fiori checks it against the
 * boxes rather than against this sentence. It is NOT the retired 22-40 per cent
 * corridor of C-TEXTURE §1.6 and is not gated against it -- E-DECISIONI15 put
 * the yellow inside the bud, so a share of the SURFACE is no longer a thing this
 * flower has.
 *
 * @param {'bianco'|'ciano'} kind
 * @returns {number} the share, between nought and one
 */
function pistilShare(kind) {
  const rects = flowerBoxes(kind)
    .filter((f) => f.role === ROLE_PISTIL)
    .map((f) => ({
      x0: Math.min(...f.corners.map((c) => c[0])),
      x1: Math.max(...f.corners.map((c) => c[0])),
      y0: Math.min(...f.corners.map((c) => c[1])),
      y1: Math.max(...f.corners.map((c) => c[1])),
    }))
    .filter((r) => r.x1 > r.x0 && r.y1 > r.y0);
  // The union, by coordinate compression: every distinct x edge cuts the plane
  // into slabs, and inside one slab the covered y is a union of intervals that
  // sorting settles. Exact, and no grid to choose a resolution for -- the gate
  // rasterises the same shape at four hundred by four hundred and the two land
  // on the same number, which is what makes that gate worth having.
  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const mid = (xs[i] + xs[i + 1]) / 2;
    const spans = rects.filter((r) => r.x0 <= mid && mid <= r.x1)
      .map((r) => [r.y0, r.y1]).sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let at = -Infinity;
    for (const [lo, hi] of spans) {
      const from = Math.max(lo, at);
      if (hi > from) covered += hi - from;
      at = Math.max(at, hi);
    }
    area += covered * (xs[i + 1] - xs[i]);
  }
  return area / (HEAD_NOMINAL * HEAD_NOMINAL * HEAD_SQUAT);
}

/**
 * HOW FAR A LAMP HAS TO CLIMB BEFORE IT IS OUT OF ITS OWN BUD, in metres at the
 * nominal size, and it is a fact about the boxes rather than a number to choose.
 *
 * <<Di notte sporge da 1/4 a 2/4 della testa>> means the lamp stands that far
 * ABOVE the head, and a lamp that only travelled the reach would still be inside
 * a bud it started at the bottom of. So the rise is this gap plus the reach, and
 * this is the gap: the head's own height less how much of it the lamp already
 * fills. A white lamp is bigger and starts nearer the lid, so it has less to
 * climb -- which is why this is per kind and comes off flowerBoxes().
 *
 * @param {'bianco'|'ciano'} kind
 */
function lampGap(kind) {
  const top = Math.max(...flowerBoxes(kind)
    .filter((f) => f.role === ROLE_PISTIL)
    .flatMap((f) => f.corners.map((c) => c[1])));
  return HEAD_NOMINAL * HEAD_SQUAT - (top - STALK_TALL);
}

/**
 * THE HALO AT A POINT OF THE SHELL, which is the fragment's own law written once
 * in JavaScript so that the far family and the gate read the SAME one.
 *
 * One at a lamp's own centre and falling with the square of the distance from
 * it, with the lamp's half-side as the radius that keeps it finite there. There
 * is one of these per lamp and a blue head has four, so they ADD -- four lamps
 * light the inside of a bud brighter than one does, and pretending otherwise
 * would be a second opinion about what four lamps are.
 *
 * @param {object} seat  from lampSeats()
 * @param {number[]} p  a point in the head's own frame
 */
function haloAt(seat, p) {
  const r2 = seat.half * seat.half;
  let sum = 0;
  for (const [cx, cz] of seat.xz) {
    const dx = p[0] - cx;
    const dy = p[1] - seat.y;
    const dz = p[2] - cz;
    sum += r2 / (r2 + dx * dx + dy * dy + dz * dz);
  }
  return sum;
}

/**
 * WHAT THE HALO AVERAGES OVER A SHUT HEAD'S OWN SKIN, per kind, off the boxes.
 *
 * THE FAR FAMILY NEEDS IT AND CANNOT COMPUTE IT. Past the exchange ring a head
 * is one quad with no shell to evaluate a radial term over, so what that quad
 * has to carry is the MEAN of the term over the skin the solid would have shown
 * -- and if the two disagreed there would be a step in warmth at exactly the
 * ring the far family was ratified on. Integrated here, once, by sampling every
 * shell and floor panel on its own grid and weighting by area: the same
 * discipline pistilShare() is built with, and the gate checks it lands between
 * the least and the most the term reaches anywhere on that skin.
 *
 * @param {'bianco'|'ciano'} kind
 */
function haloMean(kind) {
  const seat = lampSeats(kind);
  const N = 24;
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  let sum = 0;
  let area = 0;
  for (const f of flowerBoxes(kind)) {
    if (f.role !== ROLE_PETAL && f.role !== ROLE_FLOOR) continue;
    const c = f.corners;
    // A quad is sampled bilinearly over its own four corners and a triangle
    // barycentrically over its three; the weight is the face's own area, so a
    // wide side counts for more than a narrow band of lid.
    let A = 0;
    for (let t = 0; t + 2 < c.length; t += 1) {
      A += Math.hypot(...cross(sub(c[t + 1], c[0]), sub(c[t + 2], c[0]))) / 2;
    }
    let acc = 0;
    let n = 0;
    for (let iy = 0; iy < N; iy += 1) {
      for (let ix = 0; ix < N; ix += 1) {
        const u = (ix + 0.5) / N;
        const v = (iy + 0.5) / N;
        let p;
        if (c.length === 3) {
          if (u + v > 1) continue;
          p = [0, 1, 2].map((k) => c[0][k] + (c[1][k] - c[0][k]) * u + (c[2][k] - c[0][k]) * v);
        } else {
          p = [0, 1, 2].map((k) => (c[0][k] * (1 - u) + c[1][k] * u) * (1 - v)
            + (c[3][k] * (1 - u) + c[2][k] * u) * v);
        }
        acc += haloAt(seat, p);
        n += 1;
      }
    }
    sum += (acc / n) * A;
    area += A;
  }
  return sum / area;
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

// THE HOUR, AND IT IS THE WHOLE OF WHAT V7 WILL NEED TO TOUCH.
//
// uBloom runs nought to one and is the world's own hour: at nought every flower
// is at its own day aperture, which its seed drew somewhere in [0, DAY_OPEN]; at
// one every flower is wide open and every lamp is out at its own reach. uGlow is
// how hard the lamps burn. Two uniforms, shared by the two near families and
// read by the far one, and nothing else in this file knows what time it is.
const BLOOM_GLSL = /* glsl */`
  uniform float uBloom;
  uniform float uGlow;

  // THIS FLOWER'S APERTURE: its own by day, one at full bloom.
  float apertureOf(float dayOpen) {
    return mix(dayOpen, 1.0, uBloom);
  }

  // AND HOW FAR ALONG THE BLOOM ITS LAMP IS, nought to one.
  //
  // Nought at or under the day's ceiling, and that is a construction and not a
  // tolerance: <<di giorno i pistilli stanno DENTRO la testa>>, and every flower
  // the day delivers has an aperture at or under DAY_OPEN, so every flower the
  // day delivers has its lamp exactly inside. Past the ceiling it opens linearly
  // and is fully out at one.
  float protrusionOf(float dayOpen) {
    float a = apertureOf(dayOpen);
    return clamp((a - ${DAY_OPEN.toFixed(4)}) / (1.0 - ${DAY_OPEN.toFixed(4)}), 0.0, 1.0);
  }
`;

/**
 * THE HALO, WRITTEN FOR ONE KIND'S LAMPS, and it is generated rather than
 * uniformed because a blue flower has four seats and a white one has one: a loop
 * over a uniform array would cost the branch on every pixel of every head in the
 * meadow to serve a number that is fixed the moment the mesh is built. The seats
 * come from lampSeats(), which is the same producer the boxes hang the lamps
 * from, so the halo cannot be centred anywhere the lamp is not.
 */
function haloGlsl(kind) {
  const seat = lampSeats(kind);
  const r2 = (seat.half * seat.half).toExponential(8);
  const terms = seat.xz.map(([cx, cz]) => `  h += R2 / (R2 + dot(p - vec3(${cx
    .toFixed(6)}, 0.0, ${cz.toFixed(6)}), p - vec3(${cx.toFixed(6)}, 0.0, ${cz
    .toFixed(6)})));`).join('\n');
  return /* glsl */`
  // ONE OVER THE SQUARE OF THE DISTANCE FROM THE LAMP, kept finite at the lamp
  // itself by its own half-side. p is the point in the head's own frame with the
  // lamp's HEIGHT already taken out of it, which is the one part of a seat that
  // moves: the lamp climbs at full bloom and the halo climbs with it.
  const float R2 = ${r2};
  float haloOf(vec3 p) {
    float h = 0.0;
${terms}
    return h;
  }`;
}

function flowerVertex(kind) {
  return /* glsl */`
  attribute float aRole;    // which pigment this face carries, and how it is lit
  attribute vec3 aPart;     // its corner of the hole, and the lamp's own rise
  attribute vec4 aFlower;   // world x, the foot of the stalk, z, and the scale
  // WHICH FLOWER THIS IS: nought for white and one for cyan; the tint; how far
  // the head is stretched in height (E-DECISIONI9.1, ratified at E-DECISIONI14.3
  // as one in four up to 1.075); and the pigment field under this flower's own
  // column, which is how a stalk carries the meadow's zones without its fragment
  // having a cell to rebuild them from.
  attribute vec4 aLook;
  // AND WHAT ITS OWN HOUR DOES TO IT: the aperture it is drawn at by day, how far
  // its lamp reaches at full bloom, and how hard its own lamp burns. Three
  // numbers a flower, drawn where the flower is decided, so that the night is a
  // uniform and not a second sowing. It was four and the fourth said whether the
  // blue carried a fourth stamen; E-DECISIONI16.2 settled that at always.
  attribute vec3 aBloom;

  varying vec3 vTint;
  varying vec3 vEmit;
  varying vec3 vHalo;
  varying vec3 vSeat;
  varying float vAlpha;
  varying float vFog;

  uniform vec3 uPale;
  uniform vec3 uPistil;
  uniform vec3 uCyan;
  uniform vec3 uCyanPistil;
  uniform vec3 uStalk;
  uniform vec2 uCentre;
  uniform float uRadius;
  uniform float uPetalAlpha;
  uniform float uHalo;
  // The half-width of this kind's hole at the two ends of the hour, in metres at
  // the nominal size. Two numbers instead of a law, because the law is
  // holeHalf() and it is linear: a shader that carried the shares and the head's
  // own side would be a second copy of it.
  uniform float uHoleShut;
  uniform float uHoleOpen;
  // Where this kind's lamp sits in its own head, in height, before the hour
  // moves it: what the halo is centred on.
  uniform float uLampY;
  // How much of its own bud this kind's lamp has still to climb: the head's
  // height less what the lamp already fills, off the boxes and per kind.
  uniform float uLampGap;

  ${SCENE_LIGHT_GLSL}
  ${faceLightGlsl()}
  ${HEAD_LIGHT_GLSL}
  ${BLOOM_GLSL}
  ${FOG_GLSL}

  void main() {
    // THE EXCHANGE RING, AND IT IS A HARD EDGE ON PURPOSE: the far family takes
    // over at exactly this radius, off the same lattice and the same record, and
    // the two families read the SAME uniform for it, shared by reference and not
    // copied, so a gap or a double is not something that has to be checked for.
    float reach = length(aFlower.xz - uCentre);
    float trim = 1.0 - step(uRadius, reach);

    float petal = step(aRole, 0.5);
    float pistil = step(1.5, aRole) * step(aRole, 2.5);
    float head = step(aRole, 2.5);
    // The shell and the floor of the cup: everything of the head that is not the
    // lamp, which is everything the halo is painted on.
    float skin = head * (1.0 - pistil);

    float aperture = apertureOf(aBloom.x);

    // THE HOLE OPENS, AND IT IS THE ONLY THING THE HOUR MOVES IN THIS SHELL.
    // A vertex on a rim carries its hole's CENTRE in the position buffer and the
    // corner it is, as a sign pair, beside it; everything else carries its own
    // place and a sign of nought, so this one line serves the whole plant with
    // no branch. <<Il foro e' piu' o meno stretto di giorno e piu' o meno largo
    // di notte>>, as arithmetic.
    float hole = mix(uHoleShut, uHoleOpen, aperture);
    vec3 local = position + vec3(aPart.x, 0.0, aPart.y) * hole;
    vec3 n = normal;

    // AND THE HEAD STRETCHES IN HEIGHT OFF ITS OWN FLOOR, which is the half of
    // E-DECISIONI9.1 the committente ratified at E-DECISIONI14.3: one in four
    // heads drawn up to 1.075 of its own width. Pivoted where the stalk hands
    // over, so a stretched head stands in the same place as the bud it would
    // otherwise be and the contract's published y is the head's own centre.
    local.y = mix(local.y,
      ${STALK_TALL.toFixed(6)} + (local.y - ${STALK_TALL.toFixed(6)}) * aLook.z, head);

    // AND THE LAMP RISES, only past the day's ceiling, by two terms that are two
    // different things. The first is the GAP -- how much of its own bud the lamp
    // has still to climb before it is out of it at all -- and it rides the head's
    // stretch, because a head drawn taller is a taller bud to get out of. The
    // second is the REACH, which is what <<sporge da 1/4 a 2/4 della testa>>
    // actually says: how far the lamp stands ABOVE the bud once it is out, as a
    // share of the head's own width. The column under the lamp stretches instead
    // of flying because its foot carries a rise of nought and its top a rise of
    // one -- and it comes out THROUGH the hole, which has widened above by
    // exactly the same aperture.
    float climb = protrusionOf(aBloom.x)
      * (uLampGap * aLook.z + aBloom.y * ${HEAD_NOMINAL.toFixed(6)});
    local.y += climb * aPart.z * pistil;

    vec3 world = aFlower.xyz + local * (aFlower.w * trim);

    // THE LIGHT IS THE SEAT'S, PER FACE, AND THE HEAD TAKES A SHARE OF THE
    // LADDER RATHER THAN THE WHOLE OF IT -- HEAD_SHADE, unchanged, measured
    // inside one head of the target at 1.68 against our own 8.51.
    //
    // AND A PANEL IS LIT BY ITS OUTWARD NORMAL ON BOTH OF ITS SIDES, which is a
    // choice and is declared. A wall of this head is a sheet with no thickness,
    // so its inner face has no light of its own to be given; lighting it as its
    // outer face is what a thin translucent wall does -- the light that reaches
    // the far side of it is the light that fell on the near side. The throat of
    // the hole is the one place this is visibly a choice, and it is the right
    // one: its panels declare their normals INTO the hole, so the walls of the
    // opening are lit on the side a walker looking down at it sees.
    vec3 light = mix(faceLight(n), headLight(n), head);

    // THE STALK'S OWN GRADATION, IN STEPS, AND ITS ZONE. E-DECISIONI10 asks for a
    // gradation from foot to crown and E-DECISIONI9.1 for a green that <<varia un
    // poco di gradazione per zona>>. The rung comes off the vertex's own height
    // between the buried foot and the cup, which is what the retired aFace.y was
    // carrying, and the zone comes off the instance.
    float up = clamp((position.y - ${STALK_FOOT.toFixed(6)})
      / ${(STALK_TALL - STALK_FOOT).toFixed(6)}, 0.0, 1.0);
    float rung = min(floor(up * ${STALK_STEPS}.0), ${STALK_STEPS}.0 - 1.0)
      / (${STALK_STEPS}.0 - 1.0);
    float grade = 1.0 + ${STALK_GRADE.toFixed(3)} * (rung - 0.5);
    vec3 stalk = uStalk * aLook.w * grade;

    // AND THE BLUES CARRY A PISTIL TOO, WHICH IS THE COMMITTENTE OVERRULING THE
    // TARGET AND IS MARKED AS THAT. C-TEXTURE §1.6 found zero yellow pixels on
    // five cyan heads; E-DECISIONI11 answered <<anche i blu devono avere i
    // pistilli>>, and a reading of the picture does not outrank the man the
    // picture is for. What is carried over is the LAW and not the triple:
    // PISTIL_HUE at PISTIL_OF_PALE of its own head's luminance, applied to the
    // cyan seat instead of the pale one.
    vec3 pale = mix(stalk, mix(uPale, uCyan, aLook.x), head);
    vec3 warm = mix(stalk, mix(uPistil, uCyanPistil, aLook.x), head);
    vec3 pigment = mix(pale, warm, pistil);
    vTint = pigment * light * aLook.y;

    // AND THE LAMP'S OWN LIGHT, WHICH IS THE HALF OF E-DECISIONI15 THAT IS NOT
    // GEOMETRY. It is a multiple of the lamp's own PIGMENT rather than a colour
    // of its own, so a blue flower's lamp stands in the same relation to its head
    // that a white one's does -- and so that nothing here can quietly become a
    // second opinion about what colour a pistil is.
    //
    // AND IT IS THE NUCLEUS THAT BURNS AND NOT THE STEM UNDER IT. E-DECISIONI16.4:
    // <<la fonte luminosa e' il NUCLEO del pistillo, non lo stelo sottile: lo
    // stelo e' luminoso solo SOTTO il nucleo e sfuma verso il suo colore naturale
    // in basso>>. aPart.z is one over the whole of the nucleus and one at the top
    // of the column falling to nought at its foot, so multiplying by it IS that
    // sentence: a gradient down the stem, read from the attribute, with no second
    // material and no second pigment. At full bloom the column is 7 cm long and
    // the fade runs the whole of it.
    vEmit = warm * uGlow * aBloom.z * pistil * aPart.z;

    // AND THE SHELL CARRIES THE HALO, which is the term E-FIORI4 did not have.
    // What goes to the fragment is the COLOUR of it -- the lamp's warm at this
    // flower's own burn, times the strength -- and the point of the shell in the
    // head's own frame with the lamp's height taken out. The fragment does the
    // fall with distance, because a radial term evaluated at four corners of a
    // wall and interpolated across it is a gradient across a quad and not a halo
    // round a lamp.
    vHalo = warm * uGlow * aBloom.z * uHalo * skin;
    vSeat = local - vec3(0.0, ${STALK_TALL.toFixed(6)}
      + (uLampY - ${STALK_TALL.toFixed(6)}) * aLook.z + climb, 0.0);

    // WHAT IS DRAWN THROUGH AND WHAT IS NOT, and it is only the shell. The
    // stalk is a stalk, the lamp is a lamp -- a lamp seen through its own glass
    // would be a fifth of the glow the committente asked to see -- and the floor
    // of the cup is the bottom a lamp stands on rather than a wall.
    vAlpha = mix(1.0, uPetalAlpha, petal);
    vFog = fogAmount(length(cameraPosition - world), world.y);

    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;
}

function flowerFragment(kind) {
  return /* glsl */`
  precision highp float;

  varying vec3 vTint;
  varying vec3 vEmit;
  varying vec3 vHalo;
  varying vec3 vSeat;
  varying float vAlpha;
  varying float vFog;

  uniform vec3 uFogColour;

  ${haloGlsl(kind)}

  void main() {
    // THE AIR TAKES THE PIGMENT AND NOT THE LAMP, which is the one thing about
    // this line worth saying: fog is what stands between the eye and a surface,
    // and a light source seen through it is dimmed by the same air rather than
    // washed towards its colour. At the range a lamp is resolved the two are the
    // same number to three places; the reason it is written this way is the
    // night, when they will not be.
    //
    // AND THE HALO IS AIR OF THE SAME KIND: it is light that left the lamp and
    // came out through the wall, so it is dimmed with the lamp and not washed
    // with the ground.
    vec3 col = mix(vTint, uFogColour, vFog)
      + (vEmit + vHalo * haloOf(vSeat)) * (1.0 - vFog);
    gl_FragColor = vec4(col, vAlpha);
  }
`;
}

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
  varying vec3 vEmit;
  varying float vFog;

  uniform vec3 uPale;
  uniform vec3 uPistil;
  uniform vec3 uCyanPistil;
  uniform vec3 uCyan;
  // WHAT SHARE OF A SHUT HEAD ITS OWN LAMP FILLS, one per kind, off the boxes.
  uniform float uShareWhite;
  uniform float uShareCyan;
  uniform float uHalo;
  uniform float uPetalAlpha;
  uniform vec2 uCentre;
  uniform float uRing;      // the exchange ring: the solids' own radius
  uniform float uReach;
  uniform float uFade;

  ${SCENE_LIGHT_GLSL}
  ${faceLightGlsl()}
  ${HEAD_LIGHT_GLSL}
  ${BLOOM_GLSL}
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
    //   world's faces are not interchangeable: a SIDE and the lid are lit by
    //   headLight() for THEIR OWN normals -- the same four lines the solid uses
    //   -- so the quad carries their average weighted by exactly the areas
    //   above: the head's own colour at this distance, from the one producer,
    //   with nothing added and no constant of its own.
    //
    //   AND THE THREE FACES ARE ALL PALE NOW, which is E-DECISIONI15 arriving
    //   here. The head used to carry the pistil's band ON its sides and this
    //   family painted that band into the average; the lamp is INSIDE the bud
    //   now, so a side is pale all the way across and what the eye gets of the
    //   lamp is the GLOW through the petals. That is baked in below rather than
    //   dropped, because the seam at the exchange is the one number this family
    //   was ratified on: a head that glowed as a solid and stopped glowing
    //   crossing the ring would be a step in colour on exactly the object the
    //   ring was measured with.
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
    vec3 warm = mix(uPistil, uCyanPistil, aLook.x);
    vec3 head = (pale * headLight(alongX) * share.x
      + pale * headLight(vec3(0.0, 1.0, 0.0)) * share.y
      + pale * headLight(alongZ) * share.z) / area;

    // AND THE HALO IS COOKED INTO THIS QUAD'S OWN COLOUR, which is the half of
    // this family E-DECISIONI15 adds. A shut head at this range is a lamp behind
    // one petal: what the eye gets is the lamp's emission times what a petal
    // passes, over the share of the head's silhouette the lamp fills -- the same
    // three numbers the solid on the other side of the ring is made of, read off
    // the boxes rather than fitted. A blue head fills a different share from a
    // white one because it carries four smaller lamps instead of one big one, so
    // the share comes in per kind on the flag this family already carries.
    float lampShare = mix(uShareWhite, uShareCyan, aLook.x);
    // AND THE SECOND HALF OF IT IS THE HALO THE SHELL ITSELF CARRIES, which is
    // what E-DECISIONI16 adds to this quad. On the near side of the ring a head's
    // walls glow round the lamp inside them; a quad has no walls to evaluate that
    // over, so it carries the MEAN of that term over the skin the solid would
    // have shown -- integrated off the same boxes, once, in haloMean(). Without
    // it a head would go warm crossing the ring inward, which is a step in colour
    // on exactly the object this family was ratified on.
    vec3 halo = warm * uGlow * (lampShare * (1.0 - uPetalAlpha) + uHalo);

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

    // NO ADDITIVE BLEND AND NO SECOND OPINION ABOUT THE HOUR: the halo above is
    // the SAME uniform the near family reads, times the same alpha, and it is
    // added to the surface rather than drawn as a second pass.
    vTint = head * aLook.y;
    vEmit = halo;
    vFog = fogAmount(length(cameraPosition - aFlower.xyz), aFlower.y);

    gl_Position = projectionMatrix * view;
  }
`;

const FAR_FRAGMENT = /* glsl */`
  precision highp float;

  varying vec3 vTint;
  varying vec3 vEmit;
  varying float vFog;

  uniform vec3 uFogColour;
  uniform float uHeadAlpha;

  void main() {
    // AND THIS QUAD PASSES WHAT A HEAD PASSES, which is what keeps the exchange
    // one flower. A shut head presents TWO panels along any line of sight, so it
    // passes (1 - alpha) squared -- four hundredths at the delivered alpha -- and
    // this family is given exactly that rather than being left opaque: a solid
    // quad where the solids are 96 per cent opaque is a step in the frame at the
    // ring, and the ring is the one number this family was ratified on.
    vec3 col = mix(vTint, uFogColour, vFog) + vEmit * (1.0 - vFog);
    gl_FragColor = vec4(col, uHeadAlpha);
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
function createFarFlowers({ height, lightScale, pigments, ring, hour }) {
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
      uCyanPistil: { value: pigments.cyanPistil },
      uHeadShade: { value: HEAD_SHADE },
      // WHAT SHARE OF A SHUT HEAD THE LAMP FILLS, per kind, and it is the
      // SOLIDS' OWN: pistilShare() reads the boxes the other family is built
      // from, so this quad's halo is exactly the halo of the head it takes over
      // from and neither number can drift away from the other.
      uShareWhite: { value: pistilShare('bianco') },
      uShareCyan: { value: pistilShare('ciano') },
      // AND WHAT THE HALO AVERAGES OVER THAT HEAD'S OWN SKIN, per kind, off the
      // same boxes: the term the near family evaluates per pixel, integrated
      // where a quad cannot evaluate it.
      uHalo: { value: HALO_DAY },
      uPetalAlpha: { value: PETAL_ALPHA },
      // A head passes what TWO panels pass, which is what this quad has to pass
      // if the exchange is to stay invisible. Derived from the one alpha rather
      // than fitted beside it.
      uHeadAlpha: { value: 1 - (1 - PETAL_ALPHA) ** 2 },
      // THE HOUR, SHARED BY REFERENCE with both near families: one object, three
      // materials, so V7 moves the world's bloom and its glow in one place and
      // the far half of the meadow cannot be at a different time of day from the
      // near half.
      uBloom: hour.bloom,
      uGlow: hour.glow,
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
    // one is wound to be that side.
    //
    // AND IT BLENDS NOW, WHICH IT DID NOT. The heads it stands for are petals
    // with light through them, so a quad that stayed opaque would be the one
    // place in the meadow where a flower is solid -- a step in the frame at
    // exactly the ring this family was ratified on. Depth is still WRITTEN: a
    // quad that blends without writing depth would let the flower behind it draw
    // over it, and at four per cent of transmission there is nothing to see
    // through it anyway. See the note over the near family's own material, which
    // makes the same choice for the same reason.
    transparent: true,
    depthWrite: true,
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
 * The moving ring of flowers around the walker: ONE sweep, TWO draws.
 *
 * It is a ring for the same reason the accent is one -- the disc carries some
 * thousands of these and the frame can afford a few hundred -- and it is filled
 * out of flowerAt() so that what is drawn is a subset of what the contract
 * publishes, never a second sowing beside it.
 *
 * AND IT IS TWO MESHES NOW, WHICH IS A BUDGET DECISION AND IS SHOWN AS ONE.
 * E-DECISIONI15 gives the two flowers different lamps -- one cube in the middle
 * of a white, four at the corners of a blue -- and there are exactly two ways to
 * draw that from one buffer: hold BOTH lamps in every flower and collapse the
 * one it does not have, or split the family. Held together, a plant carries 34
 * quads of lamp where it uses at most 20 of them, and the ring at the high tier
 * lands over the 40,000 triangle ceiling of E-FIORI3. Split, a white flower is
 * 22 quads and a blue one is 54, the ceiling is kept with room to spare, and the
 * price is ONE draw against a budget of six. The numbers are in the verbale.
 *
 * The two share everything that could drift: one sweep of the lattice, one
 * exchange radius, one hour, one set of pigments, one shader. What differs is
 * the geometry each of them was built with and nothing else.
 */
function createFlowers({ height, lightScale, pigments, hour }) {
  const offsets = ringOffsets(FLOWER_RADIUS_MAX, FLOWER_CELL);
  // EACH KIND IS SIZED FOR ALL OF THEM, and that is deliberate rather than
  // wasteful: the cyan share of a meadow runs from a tenth in the light to a
  // half in the deepest shade (CYAN_IN_LIGHT, CYAN_IN_SHADE), so a buffer sized
  // for the average would overflow in the bank and drop heads with nothing
  // saying so. Two full buffers are 26 kB.
  const capacity = Math.ceil(offsets.length * FLOWER_PER_CELL * FLOWER_SHARE * 1.6) + 64;

  // The exchange ring, and it is declared HERE because it is the solids' own
  // radius: this object is handed to the far family whole, so the two halves
  // of the meadow read one number.
  const ring = { value: FLOWER_RADIUS };

  /** One kind: its geometry, its buffers, its mesh. */
  function family(kind) {
    const geometry = flowerGeometry(kind);
    const flowerData = new Float32Array(capacity * 4);
    // FOUR WIDE: which flower, its tint, how far its head is stretched in height,
    // and the pigment field under its own column. The last two are the two halves
    // of E-DECISIONI9.1 the file was carrying as residuals, and both are answered
    // the same way -- as a number worked out where the flower is decided and
    // handed to the shader, rather than as arithmetic the shader has no cell to
    // run.
    const lookData = new Float32Array(capacity * 4);
    // AND THREE MORE, WHICH ARE THE LANTERN'S: the aperture this one is drawn
    // at by day -- which is how wide its own hole is -- how far its lamp reaches
    // at full bloom, and how hard that lamp burns. Per instance and not per
    // uniform, because <<secondo la taglia del fiore>> is a fact about ONE
    // flower. It was four wide and the fourth said whether a blue carried a
    // fourth stamen; E-DECISIONI16.2 settled that at always, so the field is gone
    // rather than left writing a one into every record.
    const bloomData = new Float32Array(capacity * 3);
    const flowerAttribute = new InstancedBufferAttribute(flowerData, 4);
    const lookAttribute = new InstancedBufferAttribute(lookData, 4);
    const bloomAttribute = new InstancedBufferAttribute(bloomData, 3);
    flowerAttribute.setUsage(DynamicDrawUsage);
    lookAttribute.setUsage(DynamicDrawUsage);
    bloomAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aFlower', flowerAttribute);
    geometry.setAttribute('aLook', lookAttribute);
    geometry.setAttribute('aBloom', bloomAttribute);
    geometry.instanceCount = 0;
    // The tallest thing a flower can be, which is an OPEN head with its lamp out
    // on the biggest draw: the bound has to hold both or a frustum test will cull
    // a plant that is still on the screen.
    geometry.boundingSphere = new Sphere(new Vector3(), FLOWER_RADIUS_MAX + 1);

    const material = new ShaderMaterial({
      uniforms: {
        uPale: { value: pigments.pale },
        uPistil: { value: pigments.pistil },
        uCyan: { value: pigments.cyan },
        uCyanPistil: { value: pigments.cyanPistil },
        uStalk: { value: pigments.stalk },
        uHeadShade: { value: HEAD_SHADE },
        uPetalAlpha: { value: PETAL_ALPHA },
        // THE STRENGTH IS PER KIND AND IS DERIVED, NOT CHOSEN TWICE: the number
        // above is the MEAN the halo is to add over a head's own skin, and this
        // divides it by what the term itself averages there. A blue head carries
        // FOUR lamps to a white head's one and the term is a sum over them, so
        // undivided it lands two and a half times as much light on a smaller
        // head -- measured, that turns a blue head white at a strength the white
        // head merely warms. The committente's reading is the judge and his
        // reading is <<una testa bianca/blu SOLIDA con un lume dentro>>: a blue
        // head that has stopped being blue has failed it. Divided, both kinds
        // carry the same light through their walls and each keeps its own
        // colour -- and the far family's quad, which carries the MEAN, needs no
        // per-kind number at all, because the mean is this constant by
        // construction.
        uHalo: { value: HALO_DAY / haloMean(kind) },
        // The two ends of this kind's hole, in metres at the nominal size, off the
        // one function that knows the law.
        uHoleShut: { value: holeHalf(kind, 0) },
        uHoleOpen: { value: holeHalf(kind, 1) },
        uLampY: { value: lampSeats(kind).y },
        uLampGap: { value: lampGap(kind) },
        // The hour, shared BY REFERENCE with the other kind and with the far
        // family: three materials, one object, so V7 moves the world's bloom in
        // one place and no half of the meadow can be at another time of day.
        uBloom: hour.bloom,
        uGlow: hour.glow,
        // At the GROUND's exposure, because what a flower is lit by is the meadow
        // it stands in: the same line src/world/voxel/material.js asks for, so a
        // cube and the flower at its foot cannot disagree about the hour.
        ...faceLightUniforms(lightScale * GROUND_EXPOSURE),
        ...SCENE_LIGHT_UNIFORMS,
        uCentre: { value: new Vector2() },
        uRadius: ring,
        ...fogUniforms(),
      },
      vertexShader: flowerVertex(kind),
      fragmentShader: flowerFragment(kind),
      // A PETAL IS A SHEET AND IS DRAWN ON BOTH SIDES. That is what makes the
      // inside of a shut bud a thing the eye can find through the outside of it,
      // which is what <<che si intraveda attraverso i petali>> asks for, and it
      // is also why no face of this plant can be lost to a winding: there is no
      // back face to cull. guard-avvolgimento reads this line off the material
      // object rather than trusting the comment (E-GUARDIA1).
      side: PETAL_SIDES,
      // AND IT BLENDS WHILE STILL WRITING DEPTH, which is the whole ordering
      // question of E-DECISIONI15 answered in two lines rather than in a sorted
      // pass. What `transparent` buys is the ORDER between families: three.js
      // draws the opaque world first and these after it, so a petal blends over
      // the ground rather than over whatever the frame started with.
      //
      // WHAT DEPTH-WRITING BUYS IS CORRECTNESS WITHOUT A SORT, and it is worth
      // stating because the obvious reading is that it costs some. Within one
      // plant the index buffer runs stalk, lamp, floor, petals, so the opaque
      // core writes depth first and the petals blend over it: the lamp shows
      // through the near petal at (1 - alpha) and the far petal behind the lamp
      // is rejected, which is exactly the reading asked for. BETWEEN plants the
      // depth test does the sorting: a near flower drawn first rejects the far
      // one where it covers it, and a far flower drawn first is blended over by
      // the near one -- either order lands on the same frame. What is given up
      // is seeing a distant flower THROUGH a nearer one's petal, at four per
      // cent of transmission, and what is bought is that no buffer has to be
      // re-sorted as the walker turns.
      transparent: true,
      depthWrite: true,
      fog: false,
    });
    const mesh = new Mesh(geometry, material);
    // Named, because a harness that wants to price these on their own has to find
    // them in the SCENE: an import() inside the page hands back a second instance
    // of the layer whose handles turn nothing, and a measurement taken that way
    // reads as a family that costs nought. The lesson is DEV2bis's and it cost a
    // table.
    mesh.name = kind === 'ciano' ? 'flowers-blu' : 'flowers-bianchi';
    mesh.frustumCulled = false;
    return {
      kind, geometry, material, mesh, flowerData, lookData, bloomData,
      flowerAttribute, lookAttribute, bloomAttribute, placed: 0,
    };
  }

  const kinds = { bianco: family('bianco'), ciano: family('ciano') };
  const all = [kinds.bianco, kinds.ciano];

  let lastCellX = null;
  let lastCellZ = null;
  let rebuildMs = 0;

  function rebuild(cellX, cellZ) {
    const started = performance.now();
    for (const f of all) f.placed = 0;
    for (const offset of offsets) {
      if (offset.d > ring.value + FLOWER_CELL) break;
      for (let k = 0; k < FLOWER_PER_CELL; k++) {
        const flower = flowerAt(cellX + offset.i, cellZ + offset.j, k, height);
        if (!flower) continue;
        const f = kinds[flower.kind];
        const n = f.placed;
        if (n >= capacity) continue;
        const o = n * 4;
        f.flowerData[o] = flower.x;
        // The FOOT of the stalk and not the head: the geometry stands on it, so
        // this undoes exactly what flowerAt() put on top of the ground -- the
        // stalk, and half of the head the flower actually has, stretched or not.
        f.flowerData[o + 1] = flower.y - STALK_TALL * flower.scale
          - flower.size * HEAD_SQUAT * flower.open / 2;
        f.flowerData[o + 2] = flower.z;
        f.flowerData[o + 3] = flower.scale;
        f.lookData[o] = flower.kind === 'ciano' ? 1 : 0;
        f.lookData[o + 1] = flower.tint;
        f.lookData[o + 2] = flower.open;
        f.lookData[o + 3] = flower.zone;
        const t = n * 3;
        f.bloomData[t] = flower.dayOpen;
        f.bloomData[t + 1] = flower.lampReach;
        f.bloomData[t + 2] = flower.glow;
        f.placed = n + 1;
      }
    }
    for (const f of all) {
      f.geometry.instanceCount = f.placed;
      f.flowerAttribute.needsUpdate = true;
      f.lookAttribute.needsUpdate = true;
      f.bloomAttribute.needsUpdate = true;
    }
    rebuildMs = performance.now() - started;
  }

  const triangles = (f) => f.placed * f.geometry.index.count / 3;

  return {
    meshes: all.map((f) => f.mesh),
    update(position) {
      for (const f of all) f.material.uniforms.uCentre.value.set(position.x, position.z);
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
    setVisible(visible) { for (const f of all) f.mesh.visible = visible; },
    stats: () => ({
      capacity,
      placed: kinds.bianco.placed + kinds.ciano.placed,
      cyan: kinds.ciano.placed,
      rebuildMs,
      radius: ring.value,
      triangles: triangles(kinds.bianco) + triangles(kinds.ciano),
      // And apart, because the whole reason the family is split is a budget and a
      // budget that cannot be read per kind is a budget nobody can check.
      bianco: {
        placed: kinds.bianco.placed,
        perFlower: kinds.bianco.geometry.index.count / 3,
        triangles: triangles(kinds.bianco),
      },
      ciano: {
        placed: kinds.ciano.placed,
        perFlower: kinds.ciano.geometry.index.count / 3,
        triangles: triangles(kinds.ciano),
      },
      perSquareMetre: (kinds.bianco.placed + kinds.ciano.placed)
        / (Math.PI * ring.value * ring.value),
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
  grassAtlas, height, lightScale = TERRAIN.lightScale,
}) {
  if (!grassAtlas || !height) {
    return {
      meshes: [],
      update() {},
      setQuality() {},
      setGrassVisible() {},
      setFlowersVisible() {},
      setNearFlowersVisible() {},
      setFarFlowersVisible() {},
      setHour() {},
      stats: () => null,
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
  // THE HOUR, AND IT IS ONE OBJECT FOR THE WHOLE MEADOW.
  //
  // E-DECISIONI15 asks for a flower that shuts by day and blooms by night, and
  // E-DECISIONI2 says the night is not built on this branch. What is built is
  // therefore the flower PARAMETRIC in its hour and the day at nought: uBloom
  // runs nought to one, uGlow is how hard the lamps burn, and the three
  // materials that draw a flower are handed these two BY REFERENCE. V7 will move
  // setHour() and nothing in this file will have to be opened.
  const hour = { bloom: { value: 0 }, glow: { value: GLOW_DAY } };
  const flowers = createFlowers({ height, lightScale, pigments, hour });
  // And the far half, which starts where the solids stop. It is handed the
  // solids' own radius uniform, so the exchange is one number and not two.
  const far = createFarFlowers({ height, lightScale, pigments, ring: flowers.ring, hour });
  const meshes = [grass.mesh, ...flowers.meshes, far.mesh];

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
    /**
     * THE HOUR OF THE MEADOW, AND IT IS THE WHOLE OF WHAT V7 HAS TO TOUCH.
     *
     * <<Di giorno i fiori sono chiusi o appena aperti... di notte sbocciano e i
     * pistilli escono>> (E-DECISIONI15.3). The day is delivered at (0, GLOW_DAY)
     * and nothing on this branch calls this with anything else -- the night is
     * not built here (E-DECISIONI2) and a day that quietly moved would be this
     * file deciding an hour that is not its own.
     *
     * @param {number} [bloom]  nought shut, one open. Every flower carries its
     *   own day aperture in [0, DAY_OPEN] and its own reach, so one number here
     *   opens a meadow of flowers that are not all the same flower.
     * @param {number} [glow]  how hard the lamps burn, as a multiple of the
     *   pistil's own pigment. GLOW_NIGHT is the value the affiancati are taken
     *   at and is published in the census; it is not set from here.
     */
    setHour({ bloom = hour.bloom.value, glow = hour.glow.value } = {}) {
      hour.bloom.value = Math.min(Math.max(bloom, 0), 1);
      hour.glow.value = Math.max(glow, 0);
    },
    stats: () => ({
      grass: grass.stats(),
      flowers: flowers.stats(),
      far: far.stats(),
      hour: { bloom: hour.bloom.value, glow: hour.glow.value },
      density: to.density,
      radius: to.radius,
      // What the ring is actually sowing, per square metre of the disc it
      // covers, so the reading the accent was set from can be checked in the
      // running frame instead of trusted.
      perSquareMetre: grass.stats().placed / (Math.PI * to.radius * to.radius),
    }),
  };
}
