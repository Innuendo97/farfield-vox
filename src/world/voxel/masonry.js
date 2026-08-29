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
const STONE_ALBEDO = [0.276, 0.321, 0.230];
const STONE_GAIN = 0.62;

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
const STONE_F0 = 0.0057;
const STONE_RIM = 0.125;
const STONE_RIM_POWER = 4.0;
const SKY_BLUR = 3.0;

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
const STONE_TINT = 1.4;

// The joint between blocks, as the campaign's own estimator reads it on stone:
// 0.949 to 0.959 of the face beside it, over two or three pixels. It is the
// same six per cent over the same one or two pixels the meadow carries, which
// is the finding — the joint fitted on grass holds on stone without a change.
const STONE_JOINT = 0.046;
const STONE_JOINT_PIXELS = 1.6;

// And the dressed edge, at the 1.072 to 1.091 four windows of stone measure —
// the same brightness as the recipe's on grass and a different colour, about
// twice the blue. Both come out of the facet rather than being painted: what is
// set here is only how wide the vertical one is allowed to be on screen, since
// the horizontal one is real geometry and has no width to set.
const STONE_ARRIS = 1.0;
const STONE_ARRIS_PIXELS = 2.2;

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
const STONE_ARRIS_PIGMENT = 0.70;

// HOW MUCH PALER THE TOP COURSE OF A WALL IS THAN THE STONE UNDER IT, and over
// how many courses it comes back.
//
// A weathering fact and a reading, not a taste: assets-src/monoliths/
// masonry-spec.json carries head.paleTopCourse, which is the top course against
// the courses three down ON THE SAME FACE, over six faces — 1.072, 1.157,
// 1.303, 1.192, 2.370 and 1.002. The median of those six is what is used, and
// the band [1.00, 2.37] is declared rather than averaged away: 04 is nearly
// two and a half times and 05 is flat, and one law over one wall cannot be both.
// The fade is the measurement's own baseline and not a shape chosen to look
// right — the reading compares the top course TO THE COURSES THREE DOWN, so
// three courses is where it has to be back to one.
//
// AND THE SPEC'S OWN BAND IS RE-READ HERE WITHOUT BEING RE-CUT, because the
// spec is V2-AN's seat and not this file's. Run again with the same line but
// the band taken under the stone the picture actually DRAWS rather than under
// the box layout.js declares — the two differ by up to 0.435 m, and the spec
// prints both numbers itself — the six come back 1.051, 1.161, 1.119, 1.103,
// 1.096 and 1.008, median 1.103. The 2.370 on 04 was a band 0.35 m above where
// that block's stone stops, so a third of it was sky. The value below stays the
// published median; the re-reading is in the verbale for whoever owns the spec,
// and the difference between the two is 7% of an effect this estimator cannot
// separate from face to face at the seat anyway (the render moves 0.028 over
// the whole sweep against a face-to-face scatter of 0.15).
const STONE_PALE_TOP = 1.175;
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
const MOSS_LIT = 5.5;
// How far a corner reaches, in courses, and the floor that makes the corner
// stand nine times the centre rather than a hundred: measured 4.6% within one
// course of a vertical edge against 0.5% five courses in.
const MOSS_EDGE_REACH = 0.5;
const MOSS_EDGE_FLOOR = 0.033;
const MOSS_EDGE_MEAN = 0.35;
// Wet at the foot, weathered at the head, thin in the belly: 2.7 / 0.8 / 2.6
// per cent up a face, which is an end-to-belly ratio near three.
const MOSS_BELLY = 0.55;
const MOSS_ENDS = 1.60;
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
const MOSS_COVER = 0.33;
const MOSS_SCALE = 0.42;
// The spread of the patch field about its own middle, sampled two hundred
// thousand times off the same hash the fragment draws it with. It is here so
// that a coverage asked for is a coverage got: see the cut in the fragment.
const MOSS_SPREAD = 0.2144;
// And what it does to the pigment. Green against the two either side of it,
// which is the axis the detector itself is written on: min(g-r, g-b) over six
// codes.
const MOSS_TINT = [0.62, 1.30, 0.58];

// The engraved cyan of the reference, from the core of a stroke out to the halo
// around it, and the light it gives off.
//
// EXPORTED, because the rhombus that hangs in front of a block and the hoop at
// the fifth are the same light as the writing cut into it — that is why they are
// cyan at all — and src/world/monoliths.js used to carry its own copy of all
// three. One colour, one seat.
export const INK_CORE = [0.44, 0.80, 0.99];
export const INK_HALO = [0.16, 0.48, 0.72];
export const INK_GAIN = 0.78;

const STONE_EXPOSURE = 1.25;

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
const STONE_LIGHT_SCALE = 1.5;

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
  uniform float uMossLit;
  uniform float uMossReach;
  uniform float uMossFloor;
  uniform float uMossEdgeMean;
  uniform float uMossBelly;
  uniform float uMossEnds;
  uniform float uMossSpread;
  uniform vec3 uMossTint;
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
      float weight = mix(1.0 / uMossLit, 1.0, lit)
        * (uMossFloor + exp(-edge * uMossReach)) / uMossEdgeMean
        * mix(uMossBelly, uMossEnds, smoothstep(0.22, 0.46, abs(upFrac - 0.5)));
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
      uMossLit: { value: MOSS_LIT },
      uMossReach: { value: MOSS_EDGE_REACH },
      uMossFloor: { value: MOSS_EDGE_FLOOR },
      uMossEdgeMean: { value: MOSS_EDGE_MEAN },
      uMossBelly: { value: MOSS_BELLY },
      uMossEnds: { value: MOSS_ENDS },
      uMossSpread: { value: MOSS_SPREAD },
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
