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
import TERRAIN from '../../assets-src/terrain/terrain.json' with { type: 'json' };
import GRASS from '../../assets-src/vegetation/grass.json' with { type: 'json' };
import PROPS from '../../assets-src/vegetation/props.json' with { type: 'json' };

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
// What that leaves is the near ring, which is the accent, and the loose flowers,
// which belong to the session that is rebuilding a flower as a cube head on a
// sub-voxel stalk. Two draws where there were five.
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

// Flowers scattered on their own, over and above the ones the sheet used to
// carry. They exist for the first few metres, where the eye starts asking where
// the white specks went.
//
// THEY ARE THE OLD FLOWERS AND THEY ARE NOT THE ANSWER. Both targets draw a
// flower as a CUBE head on a sub-voxel stalk, 13 to 15 cm across; these are
// crossed cards off the props sheet. They are left standing, at their own
// draw, so the meadow is not bare of white while the session that owns the
// flower builds the real one against the census.
const FLOWER_RADIUS = 5.0;
const FLOWER_CELL = 0.55;
const FLOWER_SIZE = 0.10;

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

/**
 * The meadow's own accents: the ring of sprays and the loose flowers near the
 * walker.
 *
 * @param {object} assets  the two sheets, the height of the meadow under a
 *                         point, and the exposure the ground is lit at
 */
export function createVegetation({
  grassAtlas, propsAtlas, height, lightScale = TERRAIN.lightScale,
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

  const meshes = [grass.mesh];
  let flowers = null;

  // The loose flowers are an addition and they are the old ones: without the
  // props sheet the meadow simply has no white in it until the session that
  // owns the flower lands its cube heads.
  if (propsAtlas) {
    flowers = createRing({
      atlas: propsAtlas,
      light: bridge.texture,
      lightScale,
      geometry: cardGeometry(2, FLOWER_SIZE * 2, FLOWER_SIZE * 2),
      columns: PROPS.columns,
      rows: PROPS.rows,
      cellFrom: PROPS.flowerFrom,
      cellCount: PROPS.flowerCount,
      radius: FLOWER_RADIUS,
      cellSize: FLOWER_CELL,
      perCell: 1,
      scaleRange: { min: 0.75, max: 1.5 },
      height,
      // A fraction of the density of the ground: these are the few heads that
      // stand clear, not a second meadow. They are NOT thinned to the accent's
      // sowing -- a flower is not a spray of grass, and the census that made
      // the sprays rare counted two heads to the square metre.
      density: (x, z) => densityAt(x, z) * 0.80,
      seed: 23,
      tint: { min: 0.92, max: 1.08 },
      sink: 0.0,
    });
    meshes.push(flowers.mesh);
  }

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
      if (flowers) flowers.update(position);
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
      crossing = DENSITY_FADE_SECONDS;
      push();
    },
    /** Development handle: the accents alone, so their cost can be measured. */
    setGrassVisible(visible) {
      grass.setVisible(visible);
      if (flowers) flowers.setVisible(visible);
    },
    stats: () => ({
      grass: grass.stats(),
      flowers: flowers ? flowers.stats() : null,
      density: to.density,
      radius: to.radius,
      // What the ring is actually sowing, per square metre of the disc it
      // covers, so the reading the accent was set from can be checked in the
      // running frame instead of trusted.
      perSquareMetre: grass.stats().placed / (Math.PI * to.radius * to.radius),
    }),
  };
}
