import {
  BufferAttribute, DataTexture, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute,
  InstancedBufferGeometry, Mesh, RGBAFormat, ShaderMaterial, Sphere, SRGBColorSpace,
  UnsignedByteType, Vector2, Vector3,
} from 'three';
import { SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS, SUN_DIRECTION } from '../core/sky.js';
import { BAKED_TERMS_GLSL, FOG_GLSL, fogUniforms, GROUND_EXPOSURE } from './air.js';
import { faceLightGlsl, faceLightUniforms } from './face-light.js';
import {
  clamp01, pathCoord, pathRun, smoothstep,
} from './terrain-field.js';
import { MONOLITHS, PLATFORM, STAIRS } from './layout.js';
import { ROCKS } from './rocks.js';
import { voxelSettings } from './voxel/index.js';
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

/** The head, in metres. Drawn per flower between the two, uniformly. */
const HEAD_MIN = 0.065;
const HEAD_MAX = 0.100;
/** The size everything below is authored at; a flower scales from it. */
const HEAD_NOMINAL = (HEAD_MIN + HEAD_MAX) / 2;
/** And the cyan head is a tenth smaller: 7.3 cm measured against 8.2. */
const CYAN_SCALE = 0.90;

// The stalk. It is the one thing in this meadow a cube face cannot draw -- two
// centimetres against a lattice of ten -- and it is declared as what it is: a
// thin box, not a card and not a voxel. Its width is at the floor of what the
// target can resolve (one pixel where a 10 cm face reads sixteen), so the number
// is an upper bound and is written as one.
const STALK_WIDE = 0.015;
const STALK_TALL = 0.070;

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

// HOW FAR THE FLOWERS REACH, AND IT IS THE TRIANGLE ALLOCATION THAT SETS IT
// RATHER THAN TASTE -- WHICH LEAVES A GAP, AND THE GAP IS DECLARED HERE RATHER
// THAN ANYWHERE ELSE.
//
// A flower is EIGHTEEN triangles: five faces of a head and four of a stalk. At
// three heads a square metre that is 54 triangles of meadow per square metre,
// and the cost of a ring grows with the SQUARE of its reach. E-V4c leaves V4
// ten to twelve thousand triangles and the hub's trees have taken 3,808, so:
//
//   6.5 m   392 heads   7,056 tri   <- delivered, and V4 lands at 11,266
//   8.0 m   570 heads  10,260 tri
//  10.0 m   925 heads  16,650 tri   <- where the top tier's lever reaches
//    18 m  ~2,600 heads ~47,000 tri <- what the target's own reach would cost
//
// The first three are MEASURED in the running frame at these radii
// (v4-verde/dev3/portata.mjs), not extrapolated; the last is the same law
// carried out to where the target's census still counts heads.
//
// THE TARGET SHOWS HEADS OUT TO EIGHTEEN METRES AND WE DRAW THEM TO SIX AND A
// HALF. That is not a visibility limit -- an 8 cm head still reads nine pixels
// at eighteen metres and the census counts them there -- it is the allocation,
// and doubling the reach costs four times. At POSE_VOX_DAY the frame's bottom
// row lands on ground 5.2 m away, so what this ring puts in the judged picture
// is a band a metre and a third deep: the walk and the look downwards are right
// and the judged still is thin. It is measured, it is priced above, and it goes
// to the coordinator as a number rather than being quietly split the difference.
//
// What keeps the rim from reading as an edge is the same trim the accent ring
// uses: a flower leaves by shrinking, over the last metres, and never by
// appearing.
const FLOWER_RADIUS = 6.5;
const FLOWER_RADIUS_MAX = 10.0;
const FLOWER_FADE = 1.6;

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
 *   - the CREAM face against the pale one, INSIDE one head: 0.747, 0.686, 0.355
 *     (n = 7 heads). Same material, same light, a few levels apart.
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
// SO THE GAP IS NOT THE FLOWER'S, AND IT IS MEASURED WHERE IT IS. Inside ONE
// head -- same geometry, same pigment, two faces -- the brightest fifth over the
// darkest reads 3.73x in the target and 8.51x here: OUR ORIENTATION LADDER IS
// 2.3 TIMES STEEPER. With the side faces that far down, the head's average
// cannot climb where the target's does however high the pigment is raised, and
// that is exactly why the sweep saturates. src/world/face-light.js says the same
// thing in its own words and calls it what it is -- "the reference's own shading
// implies a sun higher and weaker than the one this world is sealed to, so the
// orientation ladder cannot land while the light stays where it is" -- and moving
// it is a refit of scene-light.json, which moves the paving and the stone with
// it and belongs to the coordinator. Never a per-material fudge in a delivery,
// and a flower painted brighter than an albedo to chase it would be one.
const PALE_STEP = 2.5;
/**
 * The pale's own hue, at unit luminance, from the target's heads. Nearly
 * neutral with a little warmth in it, which is what a white reads as under this
 * sun.
 */
const PALE_HUE = new Vector3(1.058, 1.004, 0.785);
const CREAM_OF_PALE = new Vector3(0.747, 0.686, 0.355);
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
    cream: new Vector3(pale.x * CREAM_OF_PALE.x, pale.y * CREAM_OF_PALE.y,
      pale.z * CREAM_OF_PALE.z),
    cyan: CYAN_HUE.clone().multiplyScalar(luma(pale) * CYAN_OF_PALE / luma(CYAN_HUE)),
    // The stalk is the meadow's own pigment, unchanged. Not a shortcut: at a
    // centimetre and a half it is at most one pixel wide in the target at the
    // range the campaign judges, so a colour measured on it would be a reading
    // about resampling and not about a stem. The honest pigment for a stem is
    // the plant's, and the seat publishes it.
    stalk: meadow.clone(),
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

  const limit = densityAt(x, z) * FLOWER_SHARE;
  if (limit <= 0 || roll > limit) return null;

  const r3 = hash2(gx * 40503 + k * 65867, gz * 92083 + FLOWER_SEED * 17);
  const r4 = hash2(gx * 92083 + FLOWER_SEED * 13, gz * 40503 + k * 65867);
  const cyan = r3 < CYAN_IN_LIGHT + (CYAN_IN_SHADE - CYAN_IN_LIGHT) * shadeAt(x, z);
  const size = (HEAD_MIN + (HEAD_MAX - HEAD_MIN) * r4) * (cyan ? CYAN_SCALE : 1);
  const scale = size / HEAD_NOMINAL;
  return {
    x,
    // THE HEAD AND NOT THE GROUND UNDER IT, which is what the contract asks for
    // and what a lamp is hung at: the floor, the stalk, and half a head.
    y: height(x, z) + STALK_TALL * scale + size / 2,
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

// The vertex's own role, which picks its pigment. It is a property of the FACE
// and not of anything per-flower: five values in the whole geometry.
const ROLE_PALE = 0;
const ROLE_CREAM = 1;
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
 * AND WHY THE CREAM IS TWO FACES AND NOT ONE. Looked at twenty times, the
 * target's head is a pale cube with a WARM BAND down the middle of the face
 * turned to the eye -- about a fifth of its width -- and a lit side to one
 * side of it and a shaded side to the other. The pale and the shaded are ONE
 * pigment under two lights, which this world's face-light reproduces for free;
 * the warm band is a second pigment, and at eight centimetres it is sub-voxel
 * structure this campaign does not spend geometry on. So it becomes a FACE, and
 * it becomes the two faces along z: both target poses look along that axis, so
 * every head presents its warm face exactly as both pictures show, and a walker
 * who turns round sees the same flower rather than a different one. It is an
 * approximation and it is written down as one.
 */
function flowerGeometry() {
  const h = HEAD_NOMINAL / 2;
  const y0 = STALK_TALL;
  const y1 = STALK_TALL + HEAD_NOMINAL;
  const s = STALK_WIDE / 2;
  // Buried a little, so a stalk on a slope never shows daylight under it.
  const foot = -0.03;
  const quads = [
    // the head: top, then the four sides
    [[-h, y1, -h], [-h, y1, h], [h, y1, h], [h, y1, -h], [0, 1, 0], ROLE_PALE],
    [[h, y0, -h], [h, y0, h], [h, y1, h], [h, y1, -h], [1, 0, 0], ROLE_PALE],
    [[-h, y0, h], [-h, y0, -h], [-h, y1, -h], [-h, y1, h], [-1, 0, 0], ROLE_PALE],
    [[-h, y0, h], [h, y0, h], [h, y1, h], [-h, y1, h], [0, 0, 1], ROLE_CREAM],
    [[h, y0, -h], [-h, y0, -h], [-h, y1, -h], [h, y1, -h], [0, 0, -1], ROLE_CREAM],
    // the stalk: four sides, no lid and no foot
    [[s, foot, -s], [s, foot, s], [s, y0, s], [s, y0, -s], [1, 0, 0], ROLE_STALK],
    [[-s, foot, s], [-s, foot, -s], [-s, y0, -s], [-s, y0, s], [-1, 0, 0], ROLE_STALK],
    [[-s, foot, s], [s, foot, s], [s, y0, s], [-s, y0, s], [0, 0, 1], ROLE_STALK],
    [[s, foot, -s], [-s, foot, -s], [-s, y0, -s], [s, y0, -s], [0, 0, -1], ROLE_STALK],
  ];
  const positions = new Float32Array(quads.length * 4 * 3);
  const normals = new Float32Array(quads.length * 4 * 3);
  const roles = new Float32Array(quads.length * 4);
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
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

const FLOWER_VERTEX = /* glsl */`
  attribute float aRole;    // which pigment this face carries
  attribute vec4 aFlower;   // world x, the foot of the stalk, z, and the scale
  attribute vec2 aLook;     // nought for white and one for cyan, and the tint

  varying vec3 vTint;
  varying float vFog;

  uniform vec3 uPale;
  uniform vec3 uCream;
  uniform vec3 uCyan;
  uniform vec3 uStalk;
  uniform vec2 uCentre;
  uniform float uRadius;
  uniform float uFade;

  ${SCENE_LIGHT_GLSL}
  ${faceLightGlsl()}
  ${FOG_GLSL}

  void main() {
    // A flower leaves the ring by shrinking, over the last metres and towards
    // its own foot, so a cell that has just come in grows out of the ground
    // instead of appearing. The walker never sees the moment one is added.
    float reach = length(aFlower.xz - uCentre);
    float trim = 1.0 - smoothstep(uRadius - uFade, uRadius, reach);
    vec3 world = aFlower.xyz + position * (aFlower.w * trim);

    // THE LIGHT IS THE SEAT'S, PER FACE. A card taps the ground's own pair
    // because a card stands on the ground and has no normal worth reading; a
    // flower is a solid with six of them, and the pale side and the shaded side
    // of one head are the SAME pigment under two of these -- which is exactly
    // what the target shows and what this file would otherwise have had to
    // paint by hand.
    vec3 light = faceLight(normal);

    vec3 pigment = uStalk;
    if (aRole < 1.5) pigment = mix(aRole < 0.5 ? uPale : uCream, uCyan, aLook.x);
    vTint = pigment * light * aLook.y;
    vFog = fogAmount(length(cameraPosition - world), world.y);

    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const FLOWER_FRAGMENT = /* glsl */`
  precision highp float;

  varying vec3 vTint;
  varying float vFog;

  uniform vec3 uFogColour;

  void main() {
    // No sheet, no cut-out and no alpha: a flower is a solid, so the one thing
    // it needs of a fragment is the air in front of it.
    gl_FragColor = vec4(mix(vTint, uFogColour, vFog), 1.0);
  }
`;

/**
 * The moving ring of flowers around the walker: one draw, whatever it holds.
 *
 * It is a ring for the same reason the accent is one -- the disc carries some
 * thousands of these and the frame can afford a few hundred -- and it is filled
 * out of flowerAt() so that what is drawn is a subset of what the contract
 * publishes, never a second sowing beside it.
 */
function createFlowers({ height, lightScale }) {
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

  const pigments = flowerPigments();
  const material = new ShaderMaterial({
    uniforms: {
      uPale: { value: pigments.pale },
      uCream: { value: pigments.cream },
      uCyan: { value: pigments.cyan },
      uStalk: { value: pigments.stalk },
      // At the GROUND's exposure, because what a flower is lit by is the meadow
      // it stands in: the same line src/world/voxel/material.js asks for, so a
      // cube and the flower at its foot cannot disagree about the hour.
      ...faceLightUniforms(lightScale * GROUND_EXPOSURE),
      ...SCENE_LIGHT_UNIFORMS,
      uCentre: { value: new Vector2() },
      uRadius: { value: FLOWER_RADIUS },
      uFade: { value: FLOWER_FADE },
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
  let radius = FLOWER_RADIUS;

  function rebuild(cellX, cellZ) {
    const started = performance.now();
    let n = 0;
    let blue = 0;
    for (const offset of offsets) {
      if (offset.d > radius + FLOWER_CELL) break;
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
    /** How far the flowers reach, which is the only thing a tier moves here. */
    setRadius(wanted) {
      const next = Math.min(Math.max(wanted, FLOWER_FADE + 0.5), FLOWER_RADIUS_MAX);
      if (next === radius) return;
      radius = next;
      material.uniforms.uRadius.value = next;
      lastCellX = null;
    },
    setVisible(visible) { mesh.visible = visible; },
    stats: () => ({
      capacity, placed, cyan, rebuildMs, radius,
      triangles: placed * geometry.index.count / 3,
      perSquareMetre: placed / (Math.PI * radius * radius),
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
  const flowers = createFlowers({ height, lightScale });
  const meshes = [grass.mesh, flowers.mesh];

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
      flowers.setRadius(FLOWER_RADIUS * Math.sqrt(density) * (radius / RING_RADIUS));
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
    },
    stats: () => ({
      grass: grass.stats(),
      flowers: flowers.stats(),
      density: to.density,
      radius: to.radius,
      // What the ring is actually sowing, per square metre of the disc it
      // covers, so the reading the accent was set from can be checked in the
      // running frame instead of trusted.
      perSquareMetre: grass.stats().placed / (Math.PI * to.radius * to.radius),
    }),
  };
}
