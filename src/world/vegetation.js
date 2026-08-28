import {
  BufferAttribute, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute,
  InstancedBufferGeometry, Mesh, ShaderMaterial, Sphere, Vector2, Vector3,
} from 'three';
import { SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS } from '../core/sky.js';
import { LIGHT_FILTER, lightFilterGlsl, lightFilterUniforms } from './light-filter.js';
import { FOG_GLSL, fogUniforms, GROUND_EXPOSURE } from './terrain.js';
import {
  clamp01, GRID, pathCoord, pathRun, smoothstep,
} from './terrain-field.js';
import { MONOLITHS, PLATFORM, STAIRS } from './layout.js';
import { ROCKS } from './rocks.js';
import TERRAIN from '../../assets-src/terrain/terrain.json';
import GRASS from '../../assets-src/vegetation/grass.json';
import PROPS from '../../assets-src/vegetation/props.json';

// The grass, the flowers and the bushes.
//
// This is the only thing in the world that is not baked, and it is the one
// place the frame can be lost: a card is cheap to submit and expensive to fill,
// and a meadow of them seen from eye height is a stack of transparent quads
// over the bottom third of the screen. Everything below is arranged around that
// single fact.
//
//  - Alpha test, never blending. A blended card has to be sorted against every
//    other card and cannot write depth, so nothing behind it is ever rejected.
//    The test costs a discard and buys back the depth buffer.
//  - Multisample coverage instead of a hard cut, which keeps the rim of a blade
//    from crawling as the walker moves. It is free: the frame is already drawn
//    into a multisampled buffer.
//  - The ring is filled from the walker outwards, so the near cards are
//    submitted first and the depth test throws away the fill of the far ones
//    before their fragments are ever shaded. That is the whole reason the
//    lattice is kept in radial order.
//  - A card fades by shrinking, not by going transparent. A card that fades its
//    alpha keeps its fill cost right up to the moment it disappears, and it
//    fights the alpha test the whole way down.
//
// The colour of a card is the ground's colour: the light is read out of the
// terrain light atlas at the foot of the instance, in the vertex shader, so a
// tuft standing under a cloud shadow darkens with the grass around it. Nothing
// here carries a light of its own.

const DEG = Math.PI / 180;

// How far the ring reaches, and over how much of its outer edge the cards are
// shrunk away. Twelve metres is where a tuft stops being resolvable at this
// framing; the band is wide enough that a card is already under a pixel of
// height by the time it is dropped.
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

// The thinning that answers the one framing this meadow cannot afford.
//
// Seen from eye height with the eye level, the far half of the ring lies along
// the line of sight instead of across it: the same cards cover half again as
// much of the screen, stacked one behind another, and the ring goes from about
// one and two thirds of a millisecond at the reference framing to about two and
// a half. The budget is one and four fifths, so about three quarters of a
// millisecond has to come out of a picture nobody is allowed to notice changing.
//
// It comes out in two halves rather than one, because either of them alone
// would have to be pushed hard enough to see. Most of it is the sowing: beyond
// eight metres a share of the tufts shrinks away, ramped in from five so there
// is no line across the meadow where it starts. The rest is a metre and a fifth
// off the reach of the ring, which the radial fade already spends its last
// three metres shortening — so what that takes is cards that were down to a
// third of their height anyway. Measured at ten stations along the path with
// the eye level, the pair takes the ring from 2.15 ms to 1.48 ms, and the near
// field the walker actually reads the meadow in is not touched by either.
//
// Both are steered by the pitch of the eye and nothing else, and both are
// nought at the pitch of the reference framing. That is why the upper edge
// below is 4.5 and not a round number: it is the framing this whole world was
// fitted against, and this lever must be provably absent from it.
const HORIZON_PITCH = { from: 4.5, to: -2.0 };
const HORIZON_FAR = { from: 5.0, to: 12.0 };
const HORIZON_CUT = 1.15;
const HORIZON_REACH = 1.2;

// The lattice the tufts stand on. Cells are anchored in the world, so a tuft is
// always in the same place: the ring is the set of cells around whichever cell
// the walker is standing in, and it is refilled only when that cell changes.
const CELL = 0.72;
const PER_CELL = 4;

// The card, in metres.
//
// Low and wide on purpose: what a card costs is its area on the screen, and a
// tall card seen from eye height covers far more of the frame than the same
// amount of grass laid out flat. These three numbers are also the budget lever.
// Measured on the development machine at the reference framing, the ring cost
// 2.1 ms of a 12.6 ms frame at a third of a metre tall; the height and the
// spread of scales here are what bring it under the one and four fifths it is
// allowed, and the reference grass is short anyway.
const CARD_WIDTH = 0.58;
const CARD_HEIGHT = 0.21;
const CARD_SCALE = { min: 0.68, max: 1.15 };
// How far the top of a card is carried over from its root, in metres.
const CARD_LEAN = 0.09;

// Three quads at sixty degrees: eight triangles a card counting both faces.
// Three and not four because the fourth adds a third more fill for a silhouette
// the eye cannot separate from the other three, and not two because two crossed
// quads read as a cross when the walker looks straight down at them.
const QUADS = 3;

// Where the alpha channel is cut. Low, because the sheet is dilated under its
// transparent texels and the mip chain thins a blade with distance: a cut at a
// half erases the far half of the ring.
const ALPHA_CUTOFF = 0.34;

// How much the sowing is thinned out towards the rim of the ring.
//
// This is the second budget lever and the one that costs the least to look at.
// Three quarters of the cells of a disc lie in its outer half, and those are
// also the cards the eye sees stacked one behind another when it looks along
// the meadow rather than down at it — which is where the ring is dearest, not
// where it is nearest. Halving them out there takes a third off the count and
// most of the stacking, and at eight metres a tuft is a few pixels tall with
// the painted ground already carrying the texture underneath it.
const THINNING = { from: 5.5, to: 12.0, keep: 0.42 };

// And the sparse outer ring, from where the near one stops out to the blocks.
//
// The near ring cannot simply be made bigger: its lattice is sized for tufts
// the walker can look into, and stretching it to twenty metres would put nine
// thousand candidates through the placement loop every time the walker crosses
// a cell. So the far ground gets a lattice of its own, four times as coarse and
// thinned to a fifth, which is a few hundred cards standing between the ring
// and the stone. They are two pixels tall out there; what they have to do is
// stop the meadow ending in a line, and that is all.
const FAR_RING = {
  inner: 10.5,
  radius: 20.0,
  fade: 5.0,
  cell: 1.55,
  perCell: 2,
  thinning: { from: 11.0, to: 19.0, keep: 0.32 },
  scale: { min: 1.05, max: 1.72 },
};

// The skirt of tufts around every base. See createSkirts: the ring cannot
// reach the blocks, and the reference has grass cutting across all of them.
const SKIRT_PER_BASE = 84;
const SKIRT_REACH = 1.15;
const SKIRT_INSIDE = 0.18;
const SKIRT_SCALE = { min: 0.95, max: 1.70 };

// Flowers scattered on their own, over and above the ones painted into the
// sheet. They exist for the first few metres, where a tuft is large enough on
// the screen that the eye starts asking where the white specks went.
const FLOWER_RADIUS = 5.0;
const FLOWER_CELL = 0.55;
const FLOWER_SIZE = 0.10;

// The low bushes between the blocks. Placed by hand against the reference,
// which puts one dark mass behind the first block and another in the gap
// between the fourth and the fifth.
const BUSHES = [
  { x: -11.35, z: -6.35, size: 1.75, cell: 0 },
  { x: 6.95, z: -5.60, size: 1.55, cell: 1 },
  { x: -6.30, z: -12.05, size: 1.35, cell: 0 },
];
const BUSH_HEIGHT = 0.62;

const VERTEX = /* glsl */`
  attribute vec4 aOffset;   // world x, y, z, and the scale of the card
  attribute vec4 aParams;   // cos and sin of the yaw, cell of the sheet, tint
  attribute float aGrade;   // where this card sits in the sowing, nought to one

  varying vec2 vUv;
  varying vec3 vTint;
  varying float vFog;

  uniform sampler2D tLight;
  uniform float uLightScale;
  uniform vec2 uCentre;     // where the ring is centred, in world x and z
  uniform float uRadius;
  uniform float uFade;
  uniform float uCut;       // cards graded above this are not standing
  uniform float uBand;      // and this much below it is where they shrink away
  uniform float uHorizon;   // how level the eye is, nought to one
  uniform vec3 uHorizonCut; // how much the far cards give up, and over what range
  uniform vec2 uCellSize;   // one cell of the sheet, in texture units
  uniform float uColumns;
  uniform float uGridHalf;
  uniform float uGridBend;
  uniform vec2 uGridCentre;

  ${SCENE_LIGHT_GLSL}
  // BILINEAR here and not the cubic, declared: this read is in the VERTEX
  // shader, once per card, and four taps a vertex would buy a card that covers
  // far more texels than it has vertices nothing at all. What it DOES need is
  // the unpacking — the sky term lives in alpha now.
  ${lightFilterGlsl(LIGHT_FILTER.BILINEAR)}
  ${FOG_GLSL}

  // Where a world position lands in the ground atlas. The grid the meadow is
  // built on is bent by a power law so its vertices crowd towards the middle of
  // the hub, and the atlas is bent with it; reading the light at the foot of a
  // card means undoing exactly that bend, which is why the law arrives as
  // uniforms instead of being written out a second time.
  vec2 groundUv(vec2 world) {
    vec2 metres = world - uGridCentre;
    vec2 t = pow(min(abs(metres) / uGridHalf, vec2(1.0)), vec2(1.0 / uGridBend));
    return (sign(metres) * t + 1.0) * 0.5;
  }

  void main() {
    vec3 base = aOffset.xyz;

    // The fade is worked out here rather than when the ring was filled, and
    // that is what makes the ring seamless: a cell that has just entered is at
    // the rim, where this is zero, so it grows in from nothing instead of
    // appearing. The walker never sees the moment a cell is added.
    float reach = length(base.xz - uCentre);
    float trim = 1.0 - smoothstep(uRadius - uFade, uRadius, reach);

    // And how much of the sowing is standing at all. Both the tier and the
    // pitch of the eye move the same threshold, and a card crosses it by
    // shrinking over whatever width the wider of the two asks for. When neither
    // is moving the width is nought and this is a plain comparison, which is
    // the sowing the ring was filled with and nothing else.
    float drop = max(uBand, uHorizon * uHorizonCut.x
      * smoothstep(uHorizonCut.y, uHorizonCut.z, reach));
    float keep = clamp((uCut - aGrade) / max(drop, 1e-5), 0.0, 1.0);

    float scale = aOffset.w * trim * trim * keep;

    vec3 local = position * scale;
    // Yaw only. A card leaning with the ground would need a normal nobody is
    // going to read, and there is no wind in the reference.
    vec3 world = base + vec3(
      local.x * aParams.x - local.z * aParams.y,
      local.y,
      local.x * aParams.y + local.z * aParams.x);

    // One tap of the ground's own light, at the foot of the card, and the two
    // terms in it recomposed here. Taken in the vertex shader and not in the
    // fragment one: a card is eighteen vertices and covers far more texels
    // than that, so the whole two term world costs the grass nothing.
    vec3 light = bakedLight(lightTerms(tLight, groundUv(base.xz))) * uLightScale;

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
  // blade, so a cosine evaluated in that loop is a cosine evaluated a hundred
  // thousand times a second.
  for (const m of MONOLITHS) {
    const [w, , d] = m.size;
    list.push({
      x: m.position.x, z: m.position.z, rotation: m.rotationY * DEG,
      halfX: w / 2, halfZ: d / 2,
      // How far past the stone the grass is allowed to climb. The reference
      // shows the meadow biting into every base and covering the joint the
      // block makes with the ground, so the skirt is deliberately generous:
      // this strip is the one place a baked contact shadow cannot hide a seam,
      // and the reference does not hide it either — it grows grass over it.
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
    // rejects almost every shape for almost every blade.
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
 * How much grass stands at a point of the meadow, from nought to one.
 *
 * The path and the built stone take it to nought outright, and the
 * edge of the stone is a ramp rather than a line so the tufts lean over the
 * last slab exactly as the painted albedo lets the grass eat into it.
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

  // Broad thin and thick patches, so the ring never reads as an even sowing.
  return clamp01(density * (0.60 + 0.75 * noise2(x * 0.085 + 31.7, z * 0.085 + 9.3)));
}

// ------------------------------------------------------------------- the ring

/**
 * The cells of the disc, in radial order.
 *
 * Filled outwards from the walker so the near cards are submitted first: with
 * the depth test in front of the shader, a fragment hidden behind a tuft that
 * was already drawn is thrown away before it costs anything. Sorting instances
 * every frame would cost more than it saves; sorting the lattice once costs
 * nothing at all, because the ring is always centred on the walker and the
 * distance to a cell is therefore its distance from the centre.
 */
function ringOffsets(radius, cell, inner = 0) {
  const reach = Math.ceil(radius / cell) + 1;
  const offsets = [];
  for (let j = -reach; j <= reach; j++) {
    for (let i = -reach; i <= reach; i++) {
      const d = Math.hypot(i, j) * cell;
      if (d > radius + cell || d < inner - cell) continue;
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
      uLightScale: { value: lightScale * GROUND_EXPOSURE },
      ...lightFilterUniforms(light),
      ...SCENE_LIGHT_UNIFORMS,
      uCentre: { value: new Vector2() },
      uRadius: { value: radius },
      uFade: { value: band },
      uCut: { value: 1 },
      uBand: { value: 0 },
      uHorizon: { value: 0 },
      uHorizonCut: {
        value: new Vector3(HORIZON_CUT, HORIZON_FAR.from, HORIZON_FAR.to),
      },
      uCellSize: { value: new Vector2(1 / columns, 1 / rows) },
      uColumns: { value: columns },
      uGridHalf: { value: GRID.half },
      uGridBend: { value: GRID.bend },
      uGridCentre: { value: new Vector2(GRID.centreX, GRID.centreZ) },
      uCutoff: { value: ALPHA_CUTOFF },
      ...fogUniforms(),
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    // Both faces: a card is a sheet with no inside, and culling one side would
    // make half the tufts of the ring disappear depending on where the walker
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
  seed, tint, sink, thinning, inner = 0, fade: fadeBand = RING_FADE,
}) {
  const offsets = ringOffsets(maxRadius, cellSize, inner);
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
  // What the tier asks the ring to reach, and how much of that the pitch of the
  // eye is currently taking off it. They are kept apart because only the first
  // decides what the lattice holds.
  let shown = radius;
  let trim = 0;

  function pushRadius() {
    material.uniforms.uRadius.value = Math.max(fadeBand + 0.5, shown - trim);
  }

  function rebuild(cellX, cellZ) {
    const started = performance.now();
    const { offsetData, paramData, gradeData } = buffers;
    let n = 0;
    for (const offset of offsets) {
      if (offset.d > reach + cellSize) break;
      const gx = cellX + offset.i;
      const gz = cellZ + offset.j;
      const thin = thinning
        ? 1 - (1 - thinning.keep) * smoothstep(thinning.from, thinning.to, offset.d)
        : 1;
      for (let k = 0; k < perCell; k++) {
        const r1 = hash2(gx * 73856093 + k * 19349663, gz * 83492791 + seed);
        const r2 = hash2(gx * 19349663 + seed, gz * 73856093 + k * 83492791);
        const x = (gx + r1) * cellSize;
        const z = (gz + r2) * cellSize;

        // One draw of the dice per blade against the density here, which thins
        // the sowing out smoothly instead of switching whole cells on and off.
        // The draw is kept, not only its verdict: it is what tells the shader
        // where this card stands in the sowing, so a tier that wants less of it
        // takes the same cards away every time and takes them away by degrees.
        const roll = hash2(gx * 26699 + k * 7919, gz * 15485863 + seed * 31);
        const limit = density(x, z) * thin;
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
        // purpose: the light already varies across the ring, and a wide spread
        // here reads as noise rather than as grass.
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
      pushRadius();
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

    setHorizon(amount, reachTrim = 0) {
      material.uniforms.uHorizon.value = amount;
      trim = reachTrim * amount;
      pushRadius();
    },

    stats: () => ({ capacity, placed, rebuildMs, triangles: placed * geometry.index.count / 3 }),
    setVisible(visible) { mesh.visible = visible; },
  };
}

/**
 * The tufts standing at the foot of the blocks.
 *
 * They are not part of the ring and they must not be. The ring reaches twelve
 * metres because that is what the frame can afford; the blocks stand at
 * nineteen and twenty one, and in the reference framing the grass cuts across
 * every one of their bases and closes over the hoop at the foot of the fifth.
 * Left to the ring, none of that would ever be drawn — the walker would watch
 * the grass stop several metres short of the stone.
 *
 * So these are placed once, around each footprint, and always drawn. They cost
 * one draw call and a few hundred cards seen from twenty metres, where a tuft
 * is three pixels tall.
 */
function createSkirts({ atlas, light, lightScale, height }) {
  const shapes = [];
  for (const m of MONOLITHS) {
    const [w, , d] = m.size;
    shapes.push({
      x: m.position.x, z: m.position.z, rotation: m.rotationY * DEG,
      halfX: w / 2, halfZ: d / 2,
    });
  }
  shapes.push({
    x: PLATFORM.x, z: PLATFORM.z, rotation: PLATFORM.rotationY * DEG,
    halfX: PLATFORM.width / 2, halfZ: PLATFORM.depth / 2,
  });

  const geometry = cardGeometry(QUADS, CARD_WIDTH, CARD_HEIGHT, CARD_LEAN);
  const capacity = shapes.length * SKIRT_PER_BASE;
  const buffers = instanced(geometry, capacity);
  const { offsetData, paramData } = buffers;

  let n = 0;
  shapes.forEach((shape, index) => {
    const c = Math.cos(shape.rotation);
    const s = Math.sin(shape.rotation);
    for (let k = 0; k < SKIRT_PER_BASE; k++) {
      const r1 = hash2(index * 8191 + k * 131, 977);
      const r2 = hash2(index * 131 + k * 8191, 1553);
      const r3 = hash2(index * 6151 + k * 389, 2069);
      const r4 = hash2(index * 389 + k * 6151, 3079);

      // A point in the band around the footprint, taken along the perimeter so
      // the tufts follow the shape of the stone rather than filling a disc.
      const t = (k + r1) / SKIRT_PER_BASE * 4;
      const side = Math.floor(t);
      const along = (t - side) * 2 - 1;
      // From a little inside the stone to a little way out: the reference has
      // the grass biting into every base, not stopping politely at it.
      const out = -SKIRT_INSIDE + (SKIRT_REACH + SKIRT_INSIDE) * r2 * r2;
      const lx = side % 2 === 0 ? along * (shape.halfX + out) : (side === 1 ? 1 : -1) * (shape.halfX + out);
      const lz = side % 2 === 0 ? (side === 0 ? 1 : -1) * (shape.halfZ + out) : along * (shape.halfZ + out);

      const x = shape.x + lx * c + lz * s;
      const z = shape.z - lx * s + lz * c;
      const yaw = r3 * Math.PI * 2;
      const o = n * 4;
      offsetData[o] = x;
      offsetData[o + 1] = height(x, z) - 0.03;
      offsetData[o + 2] = z;
      offsetData[o + 3] = SKIRT_SCALE.min + (SKIRT_SCALE.max - SKIRT_SCALE.min) * r4;
      paramData[o] = Math.cos(yaw);
      paramData[o + 1] = Math.sin(yaw);
      paramData[o + 2] = Math.floor(r1 * GRASS.cells.length) % GRASS.cells.length;
      paramData[o + 3] = 0.88 + 0.24 * r2;
      n++;
    }
  });

  geometry.instanceCount = n;
  buffers.offsetAttribute.needsUpdate = true;
  buffers.paramAttribute.needsUpdate = true;
  geometry.computeBoundingSphere();

  const material = makeMaterial({
    atlas, light, lightScale, columns: GRASS.columns, rows: GRASS.rows,
    // Never faded: they belong to the blocks, not to the walker.
    radius: 1e6, fade: 1,
  });
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 1;
  return { mesh, count: n };
}

/** The bushes: a handful of fixed cards, placed against the reference. */
function createBushes({ atlas, light, lightScale, height }) {
  const geometry = cardGeometry(2, 1.0, BUSH_HEIGHT / 1.0);
  const buffers = instanced(geometry, BUSHES.length);
  const { offsetData, paramData } = buffers;

  BUSHES.forEach((bush, i) => {
    const o = i * 4;
    const yaw = hash2(i * 977, 31) * Math.PI;
    offsetData[o] = bush.x;
    offsetData[o + 1] = height(bush.x, bush.z) - 0.05;
    offsetData[o + 2] = bush.z;
    offsetData[o + 3] = bush.size;
    paramData[o] = Math.cos(yaw);
    paramData[o + 1] = Math.sin(yaw);
    paramData[o + 2] = PROPS.bushFrom + bush.cell;
    paramData[o + 3] = 0.94;
  });
  geometry.instanceCount = BUSHES.length;
  buffers.offsetAttribute.needsUpdate = true;
  buffers.paramAttribute.needsUpdate = true;
  geometry.computeBoundingSphere();

  const material = makeMaterial({
    atlas,
    light,
    lightScale,
    columns: PROPS.columns,
    rows: PROPS.rows,
    // They never fade: they are three fixed things standing between the blocks,
    // not a ring that follows anybody.
    radius: 1e6,
    fade: 1,
  });
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * The meadow's own vegetation: the ring of tufts, the loose flowers near the
 * walker, and the bushes standing between the blocks.
 *
 * @param {object} assets  the two sheets, the ground light atlas, and the
 *                         height of the meadow under a point
 */
export function createVegetation({
  grassAtlas, propsAtlas, light, height, lightScale = TERRAIN.lightScale,
}) {
  if (!grassAtlas || !light || !height) {
    return {
      meshes: [], update() {}, setQuality() {}, setGrassVisible() {}, stats: () => null,
    };
  }

  const grass = createRing({
    atlas: grassAtlas,
    light,
    lightScale,
    geometry: cardGeometry(QUADS, CARD_WIDTH, CARD_HEIGHT, CARD_LEAN),
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
    density: densityAt,
    seed: 7,
    tint: { min: 0.86, max: 1.14 },
    thinning: THINNING,
    // Bedded a couple of centimetres into the ground, so a card standing on a
    // slope never shows daylight under its root.
    sink: 0.03,
  });

  const far = createRing({
    atlas: grassAtlas,
    light,
    lightScale,
    geometry: cardGeometry(QUADS, CARD_WIDTH, CARD_HEIGHT, CARD_LEAN),
    columns: GRASS.columns,
    rows: GRASS.rows,
    cellFrom: 0,
    cellCount: GRASS.cells.length,
    inner: FAR_RING.inner,
    radius: FAR_RING.radius,
    fade: FAR_RING.fade,
    cellSize: FAR_RING.cell,
    perCell: FAR_RING.perCell,
    scaleRange: FAR_RING.scale,
    height,
    density: densityAt,
    seed: 61,
    tint: { min: 0.88, max: 1.12 },
    thinning: FAR_RING.thinning,
    sink: 0.03,
  });

  const skirts = createSkirts({
    atlas: grassAtlas, light, lightScale, height,
  });
  const meshes = [grass.mesh, far.mesh, skirts.mesh];
  let flowers = null;
  let bushes = null;

  // The loose flowers and the bushes are an addition: without the props sheet
  // the meadow still has the flowers painted into the tufts.
  if (propsAtlas) {
    flowers = createRing({
      atlas: propsAtlas,
      light,
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
      // A fraction of the density of the grass: these are the few heads that
      // stand clear of a tuft, not a second meadow.
      density: (x, z) => densityAt(x, z) * 0.80,
      seed: 23,
      tint: { min: 0.92, max: 1.08 },
      sink: 0.0,
    });
    meshes.push(flowers.mesh);
    bushes = createBushes({
      atlas: propsAtlas, light, lightScale, height,
    });
    meshes.push(bushes);
  }

  // The two rings below are the only ones any of this touches. The loose
  // flowers are left alone on purpose: a couple of hundred heads inside five
  // metres cost nothing measurable, and they are the white specks the reference
  // framing is read for — thinning them would buy no milliseconds and spend
  // identity, which is the wrong side of every trade here.

  // Where the meadow is being taken, and where it has got to. The pair is what
  // the crossing is made of: the cut walks from one to the other over a second
  // while the band opens and closes around it, and the lattice is filled for
  // whichever of the two asks for more.
  let from = { density: 1, radius: RING_RADIUS };
  let to = { density: 1, radius: RING_RADIUS };
  let crossing = 0;
  let horizon = 0;

  function push() {
    const t = crossing <= 0 ? 1 : 1 - crossing / DENSITY_FADE_SECONDS;
    const ease = t * t * (3 - 2 * t);
    const cut = from.density + (to.density - from.density) * ease;
    const radius = from.radius + (to.radius - from.radius) * ease;
    // Nought at both ends of the crossing: at rest the threshold is exact.
    const band = crossing <= 0 ? 0 : DENSITY_FADE_BAND * Math.sin(Math.PI * t);
    const sown = Math.max(from.density, to.density);
    grass.setState({ cut, band, radius, sown });
    far.setState({ cut, band, radius: FAR_RING.radius, sown });
  }
  push();

  return {
    meshes,
    update(position, delta = 0, pitchDegrees = HORIZON_PITCH.from) {
      if (crossing > 0) {
        crossing = Math.max(0, crossing - delta);
        // The moment the crossing is over, where the meadow came from stops
        // being a fact about it. Until this happens the lattice is still filled
        // for the denser of the two tiers, so a ring that has thinned is still
        // carrying the cards it thinned away — standing at scale nought, which
        // costs no fill but is a vertex each all the same.
        if (crossing === 0) from = { ...to };
        push();
      }
      // The eye's own contribution, which is not a tier and is never stored:
      // it follows the pitch continuously and is nought at the pitch of the
      // reference framing, so the framing the whole world is fitted against
      // never sees it.
      const next = clamp01(
        (HORIZON_PITCH.from - pitchDegrees) / (HORIZON_PITCH.from - HORIZON_PITCH.to),
      );
      if (next !== horizon) {
        horizon = next;
        // Only the near ring gives up reach: the far one is what the meadow
        // ends in, and pulling its rim inwards would move the line where the
        // grass stops rather than thin what is inside it.
        grass.setHorizon(horizon, HORIZON_REACH);
        far.setHorizon(horizon);
      }
      grass.update(position);
      far.update(position);
      if (flowers) flowers.update(position);
    },

    /**
     * How much meadow the machine can afford: a share of the sowing and how far
     * the near ring reaches, both crossed over a second.
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
    /** Development handle: the grass alone, so its cost can be measured. */
    setGrassVisible(visible) {
      grass.setVisible(visible);
      far.setVisible(visible);
      skirts.mesh.visible = visible;
      if (flowers) flowers.setVisible(visible);
      if (bushes) bushes.visible = visible;
    },
    stats: () => ({
      grass: grass.stats(),
      far: far.stats(),
      skirts: skirts.count,
      flowers: flowers ? flowers.stats() : null,
      bushes: BUSHES.length,
      density: to.density,
      radius: to.radius,
      horizon,
    }),
  };
}
