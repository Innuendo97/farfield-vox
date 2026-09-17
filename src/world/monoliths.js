import {
  AdditiveBlending, Box3, BufferAttribute, BufferGeometry, DoubleSide,
  DynamicDrawUsage, Mesh, ShaderMaterial, Sphere, Vector3,
} from 'three';
import { SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS } from '../core/sky.js';
import { FOG_GLSL, fogUniforms } from './air.js';
import { faceLightGlsl, faceLightUniforms } from './face-light.js';
import { MONOLITHS } from './layout.js';
import { groundHeightAt } from './contracts.js';
import {
  INK_CORE, INK_GAIN, INK_HALO, STONE_ALBEDO, STONE_EXPOSURE, STONE_LIGHT_SCALE,
} from './voxel/masonry.js';

// The six blocks: what hangs AROUND them.
//
// THE STONE ITSELF IS NOT HERE ANY MORE, and this file is what is left when it
// goes. It used to carry a painted albedo, a Cycles bake of the light on it and
// the mesh the two were unwrapped for; the six are courses of masonry now,
// generated from the plan and from the measurement of the two targets, and the
// material that draws them is the engine's. What was left behind when the bake
// was retired is everything that is NOT stone: the rhombus that hangs in front
// of every block, the globe at the fifth, how they breathe, and what a block
// does when a walker comes within reach of its face.
//
// A block's stone is handed back in through attach() as the worker cuts it, so
// that the writing and the focus can still be sent to it by name. Which is the
// whole of what this file needs to know about what a block is made of.

const DEG = Math.PI / 180;

// THE FIVE NUMBERS OF THE STONE ARE NOT HERE ANY MORE either, and where they
// went is worth writing down. The reflectance, the grazing gain, its power, how
// blurred the sky is in it and how much of the relief reaches the shading were
// all FITTED against five baked flanks, on a curved-lit surface, for a material
// that no longer exists. The stone of this world is a wall of flat faces now
// and its material is src/world/voxel/masonry.js, which carries them at their
// delivered values and owns the refit. Two copies of a fitted number is how a
// world ends up lit twice.

// The engraved cyan of the reference is read from the material that draws it
// and not declared a second time here. The rhombus and the globe are the same
// light as the writing on the stone behind them — that is why they are cyan at
// all — so a copy of the three numbers here would be two answers about one
// colour, which is exactly the defect this session spent its first paragraph on.

// THE STRIP UNDER THE STAIR NOSINGS IS NOT HERE ANY MORE, and it is worth
// saying what it was and why it went. It was a gain — STAIR_GLOW = 0.30, pushed
// to 0.54 when the third block took focus — lighting six quads built dark by
// src/world/stairs.js, and its comment justified itself by what "the reference"
// lights. That reference was the PHOTOREAL scene this world superseded. The two
// voxel targets this session measured against draw no such strip: the treads
// read B/G 1.02, which is grey stone under a blue sky and no emission at all
// (v2-pietra/an/scalinata.mjs; FASE 0 and Deviazione 1 of the session verbale).
// So the strip is gone rather than turned down, because a mesh drawn at zero is
// still a mesh somebody has to keep switching off.
//
// WHAT DOES GLOW ON THIS STRUCTURE IS BELOW AND STAYS: the rhombus at the foot
// of every block and the globe at the fifth are things the targets DO show, and
// they are content, not decoration.

// WHAT HANGS AT THE FOOT OF THE BLOCKS IS EIGHT THINGS AND ONE DRAW.
//
// The marker at the foot of every block is a small cyan rhombus that hangs in
// front of the stone and breathes, and at the fifth there is a holographic
// globe on a pool of light as well. All of them are quads with their shape cut
// out of them in the shader rather than sprites, because a rhombus is one
// absolute value and a texture for it would be a download.
//
// THEY USED TO BE SEVEN MESHES WITH SEVEN ShaderMaterials, and the gate counted
// what that cost: SEVEN DRAW CALLS FOR FOURTEEN TRIANGLES, submitted at every
// pose in the world because each of them carried `frustumCulled = false`. They
// are one mesh now — one geometry of eight quads, one material, one call — and
// what used to be a uniform per mesh is an attribute per quad:
//
//   aCentre  where this quad hangs, in world metres. The billboarding needs a
//            centre per quad and nothing else changes, so the whole turn to the
//            eye still happens in the vertex shader.
//   aShape   which of the three figures to cut, and — for the pool — whether
//            the quad stands up to the eye or lies down on the meadow.
//   aPulse   (size in metres, intensity), the two things that breathe. They are
//            written into the buffer every frame instead of into eight uniform
//            blocks -- 64 floats, against eight material binds.
//
// FUSING THEM CANNOT CHANGE THE PICTURE, and the reason is worth stating rather
// than hoping: the arithmetic of each figure below is the arithmetic it had,
// and the blending is ADDITIVE with depth writes off, so the order the quads
// are drawn in cannot matter. Seven meshes sorted back to front and one mesh
// drawn in index order composite to the same colour.
//
// AND THE CULLING IS REAL NOW rather than switched off. Each of the seven had
// to disable it, because a billboard built in the vertex shader has nothing to
// do with the bounds three.js would compute from its unit quad -- so all seven
// went to the GPU wherever the walker stood, including with their backs to the
// hub. One mesh can afford a bound that is actually true: the sphere is set by
// hand below, over the centres the quads hang at and the largest each can
// breathe to.

// ------------------------------------------- what the fifth block stands over
//
// THE GLOBE AT THE FIFTH, AS THE DAY TARGET DRAWS IT. Where the hoop used to be
// the reference has a body: a holographic globe of cubes over a lit pool, and
// every number below was read off farfield-day-voxel-target.png at the pose it
// was fitted to (v2-pietra/dev5/sfera.mjs, whose projector is validated in both
// directions by v2-pietra/dev5/ancora.mjs -- the block's own silhouette lands on
// the target's stone to 0.040 m, and the same reader with the camera turned
// three degrees fails).
//
// THE METRES DO NOT DEPEND ON KNOWING HOW FAR AWAY IT IS, which is the whole
// reason to trust them: the plane it stands on was swept from 0.4 to 2.5 m in
// front of the block's face and every length below moved by under 3%.
const ORB_DIAMETER = 0.565;
// How high its middle floats over the ground UNDER IT -- not over the block's
// base, and not over anything else. Over the ground, because that is what the
// picture actually shows and because the meadow is another session's to move.
const ORB_HEIGHT = 0.556;
// The globe is a body of CUBES and not a striped ball: the columns inside it
// repeat every 6.5 px, which at that distance is this, against the world's own
// 0.10 m pitch. The "latitude bands" of a first look are the rows of the cubes.
const ORB_CUBE = 0.085;
// The pool: how wide the lit water reads, and how far its surface stands over
// the grass around it.
const POOL_DIAMETER = 1.221;
const POOL_LIFT = 0.20;

// And the two quads that carry them. Each is wider than its figure because the
// halo has to fit inside the quad it is drawn in: the target's glow is still at
// 47% of the body's level at 1.73 radii and 34% at 2.45, so a quad cut close to
// the globe would end the light with a straight edge.
const ORB_SIZE = 1.50;
const POOL_SIZE = 1.60;

const SHAPE_RHOMBUS = 0;
const SHAPE_ORB = 1;
const SHAPE_POOL = 2;

// The figures in the shader work in a square that runs -1 to 1, so every metre
// above becomes a fraction of the quad's half side HERE and nowhere else. Two
// copies of one length is how a globe ends up half a size.
const ORB_HALF = ORB_SIZE / 2;
const G = {
  orbR: (ORB_DIAMETER / 2 / ORB_HALF).toFixed(5),
  orbCell: (ORB_CUBE / ORB_HALF).toFixed(5),
  ground: (-ORB_HEIGHT / ORB_HALF).toFixed(5),
  water: (-(ORB_HEIGHT - POOL_LIFT) / ORB_HALF).toFixed(5),
  stemTop: (0.06 / ORB_HALF).toFixed(5),
  stemFoot: (0.15 / ORB_HALF).toFixed(5),
  poolR: (POOL_DIAMETER / 2 / (POOL_SIZE / 2)).toFixed(5),
};

const MARKER_VERTEX = /* glsl */`
  attribute vec3 aCentre;
  attribute float aShape;
  attribute vec2 aPulse;
  varying vec2 vUv;
  varying float vShape;
  varying float vIntensity;

  void main() {
    vUv = uv;
    vShape = aShape;
    vIntensity = aPulse.y;
    vec3 world;
    if (aShape > 1.5) {
      // THE POOL LIES DOWN. It is water on a meadow, and a disc of water seen
      // from a walker's height is an ellipse that gets rounder as he walks up
      // to it. Billboarding it would hold that ellipse fixed, which is the
      // trick this campaign has already measured as false the moment anyone
      // moves -- so the pool is planted in the world and lets the projection
      // foreshorten it.
      world = aCentre + vec3(position.x, 0.0, -position.y) * aPulse.x;
    } else {
      // Billboarded about the vertical only: the marker is a thing standing in
      // the world, not a decal on the lens, and rolling it with the camera pitch
      // makes it read as interface.
      vec3 toEye = cameraPosition - aCentre;
      vec3 right = normalize(vec3(-toEye.z, 0.0, toEye.x));
      world = aCentre + right * (position.x * aPulse.x) + vec3(0.0, position.y * aPulse.x, 0.0);
    }
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

// The three figures, in the one shader that draws them all.
//
// THE RHOMBUS: an outlined diamond with a filled heart and a soft field around
// it, because the reference draws all three.
//
// THE GLOBE AT THE FIFTH: the reference puts a body there and nowhere else --
// a holographic globe standing over a lit pool, which is the section about where
// the walker is going. It is CUT AS A LATTICE and not shaded as a ball: the
// target's globe is made of cubes on the world's own pitch, so what reads as
// latitude in it is the rows of those cubes and what reads as a rim is the
// column of them that stands edge on. Billboarded, because a lattice of cubes
// turned to the eye is what the picture shows and turning it with the walker
// would need a mesh nobody is paying for.
//
// THE POOL: the lit water under the globe, a disc lying on the meadow with a
// bright edge, and the stem between the two is drawn in the globe's own quad
// because it is one figure of light and not two.
const MARKER_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  varying float vShape;
  varying float vIntensity;
  uniform vec3 uCore;
  uniform vec3 uHalo;

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float amount;
    if (vShape > 1.5) {
      float d = length(p);
      float water = smoothstep(${G.poolR}, ${G.poolR} - 0.30, d) * 0.42;
      float brim = smoothstep(0.10, 0.0, abs(d - ${G.poolR})) * 0.85;
      float spill = smoothstep(1.0, ${G.poolR}, d) * 0.20;
      amount = (water + brim + spill) * vIntensity;
    } else if (vShape > 0.5) {
      float d = length(p);
      // The cubes. Distance to the nearer of the two cell walls a fragment sits
      // between, in cells, so the lattice is one width everywhere instead of
      // thinning towards the middle.
      vec2 cell = abs(fract(p / ${G.orbCell}) - 0.5) * 2.0;
      float lattice = max(cell.x, cell.y);
      float body = smoothstep(${G.orbR}, ${G.orbR} - 0.035, d);
      float rows = body * smoothstep(0.62, 0.98, lattice);
      float rim = smoothstep(0.055, 0.0, abs(d - ${G.orbR} + 0.02));
      // The stem, from under the globe down to the water, flaring as it lands.
      float run = clamp((${G.water} - p.y) / (${G.water} - ${G.ground}), 0.0, 1.0);
      float wide = mix(${G.stemTop}, ${G.stemFoot}, 1.0 - run);
      float span = step(${G.water}, p.y) * step(p.y, -${G.orbR} * 0.55);
      float stem = smoothstep(wide, wide * 0.35, abs(p.x)) * span;
      // The halo, fitted to the target's own fall: half the body's level at
      // 1.73 radii, a third of it at 2.45.
      float halo = smoothstep(${G.orbR} * 2.75, ${G.orbR}, d) * 0.46;
      amount = (body * 0.30 + rows * 0.62 + rim * 0.85 + stem * 0.70 + halo) * vIntensity;
    } else {
      float d = abs(p.x) + abs(p.y);
      float ring = smoothstep(0.045, 0.0, abs(d - 0.76));
      float core = smoothstep(0.44, 0.16, d);
      float glow = smoothstep(1.0, 0.30, d) * 0.34;
      amount = (ring + core * 0.85 + glow) * vIntensity;
    }
    gl_FragColor = vec4(mix(uHalo, uCore, clamp(amount, 0.0, 1.0)) * amount, 1.0);
  }
`;

/**
 * The eight quads, as one geometry, with a bound that is true.
 *
 * The quads are unit squares centred on the origin; the vertex shader turns
 * each one to the eye and gives it its size in metres from `aPulse`. Which
 * means the positions in this buffer say NOTHING about where the mesh is in the
 * world, and the sphere three.js would compute from them would cull the whole
 * hub's markers the moment the origin left the frustum. So it is set here, over
 * the centres the quads actually hang at and the largest each can breathe to.
 *
 * @param {{centre: Vector3, shape: number, size: number}[]} quads
 */
function markersGeometry(quads) {
  const geometry = new BufferGeometry();
  const position = new Float32Array(quads.length * 12);
  const uv = new Float32Array(quads.length * 8);
  const centre = new Float32Array(quads.length * 12);
  const shape = new Float32Array(quads.length * 4);
  const pulse = new Float32Array(quads.length * 8);
  const index = [];

  quads.forEach((q, i) => {
    position.set([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], i * 12);
    uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
    for (let c = 0; c < 4; c++) {
      centre.set([q.centre.x, q.centre.y, q.centre.z], i * 12 + c * 3);
      shape[i * 4 + c] = q.shape;
      pulse.set([q.size, 0], i * 8 + c * 2);
    }
    const base = i * 4;
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });

  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setAttribute('aCentre', new BufferAttribute(centre, 3));
  geometry.setAttribute('aShape', new BufferAttribute(shape, 1));
  const breathing = new BufferAttribute(pulse, 2);
  breathing.setUsage(DynamicDrawUsage);
  geometry.setAttribute('aPulse', breathing);
  geometry.setIndex(index);

  // The bound, over where the quads hang and how large they can get. A quad of
  // side s billboarded about the vertical reaches s/2 sideways and s/2 up, so
  // its far corner is s/sqrt(2) from its centre; FOCUS_SIZE is how much wider
  // than its resting size a lit one breathes.
  const box = new Box3();
  for (const q of quads) box.expandByPoint(q.centre);
  const middle = box.getCenter(new Vector3());
  let radius = 0;
  for (const q of quads) {
    radius = Math.max(radius,
      middle.distanceTo(q.centre) + q.size * (1 + FOCUS_SIZE) * Math.SQRT1_2);
  }
  geometry.boundingSphere = new Sphere(middle, radius);
  return geometry;
}

// Where the marker hangs, as a fraction of the block: just clear of the grass,
// on the middle of the engraved face and a little in front of it.
const MARKER_HEIGHT = 0.15;
const MARKER_STANDOFF = 0.18;
const MARKER_SIZE = 0.75;
const MARKER_PULSE = { period: 4.2, depth: 0.22 };
// Held under one so the rhombus keeps its cyan: past that the tone curve rolls
// every channel together and the reference's blue outline comes out white.
const MARKER_GAIN = 0.72;

// What a block does when the walker comes within reach of its face. The
// engraving is what carries the answer — it more than doubles the light it
// gives off — and the rhombus breathes wider and a little larger, so the change
// reads from the corner of the eye as well as head on. The gain is held where
// the cyan still survives the tone curve, for the same reason MARKER_GAIN is.
const FOCUS_INK = 1.15;
const FOCUS_MARKER = 0.38;
const FOCUS_PULSE = 0.30;
const FOCUS_SIZE = 0.12;

// And what it does once the face has actually opened. The writing steps most of
// the way back: what it announced is now standing in front of it, and a block
// burning at twice its resting light behind a panel is read through the panel.
const FOCUS_OPEN_DIM = 0.85;

// ------------------------------------------------- THE WRITING, AS BODIES
//
// The letters of the six blocks are STONE STANDING OFF THE STONE, and this is
// where they are hung.
//
// WHY THEY ARE NOT PAINTED ANY MORE. The committente's reading of the delivered
// hub was that «il testo e i simboli dei monoliti soffrono le linee scure dove
// i cubi si separano, e questo rende complicata la lettura», and it was an
// exact description of a projection: the engraving was laid on the wall in
// metres of stone, and the day the wall became BOXES that projection started
// landing on the reveals and the soffits of every block as readily as on their
// fronts. Every course line and every upright joint went through a glyph, and a
// glyph in two halves with a black bar between them is a glyph somebody has to
// work to read. Neither of the first two answers survived the committente
// (E-DECISIONI24: «no [...] rendili STACCATI dai monoliti, come se fossero
// SOLIDI, e non proiettati sulla pietra»), and the third one is this.
//
// AND IT IS ONE MESH AND ONE DRAW FOR ALL SIX. src/world/engraving.js hands
// every face back in WORLD METRES for exactly this reason: six bodies in six
// block frames would be six matrices and six calls, and the whole of what this
// file has learned about the rhombi and the globe is that a handful of quads
// scattered over six materials is the most expensive cheap thing in a scene.
// Concatenated, the writing of the whole hub is ONE geometry, ONE material and
// ONE call — and the draw count of the world moves by exactly that one.
//
// WHAT IS PER BLOCK IS TWO NUMBERS AND NEITHER IS A UNIFORM BLOCK. The FOCUS —
// how lit a block is as the walker comes up to it — is the only thing about a
// letter that changes at run time, and it is carried as a small array of gains
// indexed IN THE VERTEX SHADER off a per-vertex block number. A varying costs
// one interpolator; a material per block would cost five more draws.

// How much brighter the writing burns when a walker comes up to its block, and
// how far it steps back once the face has opened. Carried here rather than
// beside FOCUS_INK because they are one pair of numbers with one reader, and
// the two above are the seat the ink used to be handed to the wall through.
const WRITING_VERTEX = /* glsl */`
  attribute float aTone;
  attribute float aBlock;

  uniform float uGain[${MONOLITHS.length}];

  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vDistance;
  varying float vTone;
  varying float vGain;

  void main() {
    // THE POSITIONS ARE ALREADY THE WORLD'S. This mesh stands at the origin
    // with no turn of its own -- six blocks at six bearings cannot share one --
    // so the vertex is the world point and the normal is the world normal, and
    // there is no normalMatrix in this program to disagree with either.
    vNormal = normal;
    vWorld = position;
    vTone = aTone;
    // Dynamic indexing of a uniform array is allowed in the VERTEX stage of
    // GLSL ES 1.00 and not reliably in the fragment one, which is the whole
    // reason the focus is resolved here and carried across as a varying.
    vGain = uGain[int(aBlock)];
    vDistance = length(cameraPosition - position);
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`;

const WRITING_FRAGMENT = /* glsl */`
  precision highp float;

  uniform vec3 uAlbedo;
  uniform vec3 uCore;

  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vDistance;
  varying float vTone;
  varying float vGain;

  ${SCENE_LIGHT_GLSL}
  ${faceLightGlsl()}
  ${FOG_GLSL}

  void main() {
    vec3 n = normalize(vNormal);

    // A LETTER IS CUT FROM THE SAME STONE THE WALL IS, and that is what gives
    // it its own shadow without a shadow map. Its front looks where the wall
    // looks and takes the wall's light; its flanks look along the wall, so the
    // one the sun rakes is pale and the one turned from it is dark, by the same
    // two terms every other face in this world is lit by. Nothing here is a
    // bevel painted on a card.
    vec3 colour = uAlbedo * faceLightOf(faceTerms(n));

    // And what it gives off. The core of E-PIETRA2, at the gain it was
    // delivered at, on the FRONT; a third of it on the flanks and almost none
    // on the back. The reader is looking at the front, and a flank that burned
    // as brightly would read as a second letter beside the first rather than as
    // the thickness of the first.
    colour += uCore * vTone * vGain;

    colour = throughAir(colour, vDistance, vWorld.y);
    gl_FragColor = vec4(colour, 1.0);
  }
`;

// Where the globe stands on the meadow in front of the fifth block. Far enough
// out that the pool clears the stone -- the water is 1.22 m across, so its edge
// would touch the face at anything under 0.61 -- and set sideways so that the
// gap between it and the rhombus is the one the target draws: 57.3 px at the
// fitted pose, which is 1.549 rhombus widths and does not care how far away
// either of them is.
const ORB_FORWARD = 0.85;
const ORB_LEFT = 0.40;
const ORB_GAIN = 0.86;
const POOL_GAIN = 0.62;

// AND THE BASIN OF PALE STONE THE WHOLE THING STANDS IN, which is a thing this
// file does not draw and has to say where anyway.
//
// The target holds the water inside a ring of dressed stone 1.61 m across
// (R5 SS1.10, on the same reading the globe's own metres came off). That ring is
// stone, so it belongs to the loose stone -- src/world/loose-stone.js cuts it
// there, in the one mesh that also carries the turf on the heads -- and it is a
// CIRCLE ROUND THE POOL, so where it goes cannot be a second opinion about
// where the pool is. What is exported below is the one answer: the foot both of
// them stand on and the two diameters, derived here where the three constants
// above already live.
const BASIN_DIAMETER = 1.61;

/**
 * The foot of the fountain of the fifth, and the two circles that stand on it.
 *
 * Null if the fifth is not in the plan, which is the same guard createMonoliths
 * takes below: this hub's blocks are read from a layout file and a file that
 * assumed one of them exists is a file that breaks the day somebody drops one.
 */
export const FOUNTAIN = (() => {
  const spec = MONOLITHS.find((block) => block.id === '05');
  if (!spec) return null;
  const angle = spec.rotationY * DEG;
  const front = { x: Math.sin(angle), z: Math.cos(angle) };
  const right = { x: Math.cos(angle), z: -Math.sin(angle) };
  const reach = spec.size[2] / 2 + MARKER_STANDOFF + ORB_FORWARD;
  return {
    x: spec.position.x + front.x * reach - right.x * ORB_LEFT,
    z: spec.position.z + front.z * reach - right.z * ORB_LEFT,
    poolDiameter: POOL_DIAMETER,
    basinDiameter: BASIN_DIAMETER,
    orbHeight: ORB_HEIGHT,
  };
})();

/**
 * What hangs in front of the six blocks, and the seat their stone reports to.
 *
 * IT NEEDS NO ASSET AND WAITS FOR NOTHING. A rhombus is one absolute value in a
 * shader and a globe of cubes is a lattice in one, so the markers stand in the
 * first walkable frame with the blockers — where they hang comes off the plan
 * and off the ground contract, which are both known before anything has been
 * downloaded or cut.
 */
export function createMonoliths() {
  const meshes = [];
  const blocks = new Map();
  const pulses = [];
  // How lit each block is, nought to one. It is written from outside, ramped
  // there, and read back every frame by the pulse below.
  const focus = new Map();
  // AND WHAT IS WRITTEN ON EACH ONE, held by the same rule and for the same
  // reason. Both are things the outside says about a block BEFORE the block
  // necessarily exists, and a seat that remembers one of them and forgets the
  // other is the defect below.
  const engravings = new Map();

  // -------------------------------------------------- where the six rhombi hang
  const quads = [];
  const placed = new Map();
  for (const spec of MONOLITHS) {
    const angle = spec.rotationY * DEG;
    const centre = new Vector3(
      spec.position.x, spec.baseY + spec.size[1] / 2, spec.position.z,
    );
    placed.set(spec.id, { spec, centre, angle });
    const front = new Vector3(Math.sin(angle), 0, Math.cos(angle));
    const at = new Vector3(
      centre.x + front.x * (spec.size[2] / 2 + MARKER_STANDOFF),
      spec.baseY + spec.size[1] * MARKER_HEIGHT,
      centre.z + front.z * (spec.size[2] / 2 + MARKER_STANDOFF),
    );
    quads.push({ centre: at, shape: SHAPE_RHOMBUS, size: MARKER_SIZE });
    // Each one breathes on its own clock, so five markers in one frame never
    // pulse as a single blinking row.
    pulses.push({
      id: spec.id, slot: quads.length - 1, phase: Number(spec.id) * 1.13,
      base: MARKER_GAIN, size: MARKER_SIZE,
    });
  }

  // ------------------------------------------------------- the globe at 05
  //
  // ITS HEIGHT COMES OFF THE GROUND AND NOT OFF THE BLOCK, which is the one
  // decision in this paragraph worth defending. The target draws the globe
  // 0.556 m over the grass it stands on; our meadow at the foot of the fifth
  // block runs about half a metre higher than the target's, and at the plane
  // the fountain stands on the two are 1.0 to 1.3 m apart. Writing the height
  // the picture shows would bury the globe in today's grass -- which is exactly
  // what the hoop it replaces was doing -- and writing an absolute height would
  // bake today's meadow into this file, so that curing the meadow would break
  // the globe. The ground contract is the only answer that is right in both
  // worlds: when the meadow is cut down to what the target shows, the globe
  // goes down with it and lands where the picture puts it.
  // AND WHERE IT STANDS IS ASKED OF FOUNTAIN ABOVE rather than worked out again
  // here, because the basin of stone that holds this pool is cut in another file
  // off the same answer, and a fountain whose water and whose rim are computed
  // twice is a fountain that comes apart the day either sum is edited.
  const foot = FOUNTAIN;
  if (foot) {
    const ground = groundHeightAt(foot.x, foot.z);
    quads.push({
      centre: new Vector3(foot.x, ground + ORB_HEIGHT, foot.z),
      shape: SHAPE_ORB,
      size: ORB_SIZE,
    });
    pulses.push({
      id: '05', slot: quads.length - 1, phase: 2.5, depth: 0.14,
      base: ORB_GAIN, size: ORB_SIZE,
    });
    quads.push({
      centre: new Vector3(foot.x, ground + POOL_LIFT, foot.z),
      shape: SHAPE_POOL,
      size: POOL_SIZE,
    });
    // The pool breathes with the globe over it and not on a clock of its own:
    // water lit from above answers to the thing lighting it.
    pulses.push({
      id: '05', slot: quads.length - 1, phase: 2.5, depth: 0.14,
      base: POOL_GAIN, size: POOL_SIZE,
    });
  }

  // ------------------------------------------------------- and the one mesh
  const geometry = markersGeometry(quads);
  const breath = geometry.getAttribute('aPulse');
  const markers = new Mesh(geometry, new ShaderMaterial({
    uniforms: {
      uCore: { value: new Vector3(...INK_CORE) },
      uHalo: { value: new Vector3(...INK_HALO) },
    },
    vertexShader: MARKER_VERTEX,
    fragmentShader: MARKER_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
  }));
  markers.name = 'markers';
  meshes.push(markers);

  // ---------------------------------------------------- and the writing on them
  //
  // ONE MESH FOR THE SIX, held empty until the first face is cut. The faces
  // arrive one per frame from engraveAll() and in order of distance from the
  // reference pose, so this is rebuilt six times over the first second or so of
  // the world and never again — against a draw call a block, for ever.
  const written = new Map();
  const slotOf = new Map(MONOLITHS.map((block, i) => [block.id, i]));
  const gains = MONOLITHS.map(() => INK_GAIN);

  const writing = new Mesh(new BufferGeometry(), new ShaderMaterial({
    uniforms: {
      // The letters are cut from the stone of the wall they stand on, so they
      // take its pigment by reference to the seat that states it rather than
      // carrying a grey of their own. There is no tile on them: the mottling of
      // this stone opens at a tenth of a metre and a stem is a fiftieth, so a
      // tile here would be one shade over a whole letter.
      uAlbedo: { value: new Vector3(...STONE_ALBEDO) },
      uCore: { value: new Vector3(...INK_CORE) },
      uGain: { value: gains },
      ...faceLightUniforms(STONE_LIGHT_SCALE * STONE_EXPOSURE),
      ...SCENE_LIGHT_UNIFORMS,
      ...fogUniforms(),
    },
    vertexShader: WRITING_VERTEX,
    fragmentShader: WRITING_FRAGMENT,
    fog: false,
  }));
  writing.name = 'writing';
  meshes.push(writing);

  /**
   * The bodies of every face that has been cut, as one geometry.
   *
   * Concatenated and not merged: src/world/engraving.js already handed each
   * face back in WORLD metres and already greedy-meshed it, so there is nothing
   * left to fuse between two blocks eight metres apart. What this adds is the
   * one thing a shared mesh needs and a lone one does not — WHICH BLOCK each
   * vertex belongs to, so the focus can still reach a single face.
   */
  function layWriting() {
    let quads = 0;
    for (const [, cut] of written) quads += cut.quads;
    const position = new Float32Array(quads * 12);
    const normal = new Float32Array(quads * 12);
    const tone = new Float32Array(quads * 4);
    const block = new Float32Array(quads * 4);
    const index = new Uint32Array(quads * 6);
    let v = 0;
    let t = 0;
    let i = 0;
    for (const [id, cut] of written) {
      position.set(cut.positions, v);
      normal.set(cut.normals, v);
      tone.set(cut.tones, t);
      block.fill(slotOf.get(id) || 0, t, t + cut.quads * 4);
      for (let k = 0; k < cut.indices.length; k++) index[i + k] = cut.indices[k] + t;
      v += cut.quads * 12;
      t += cut.quads * 4;
      i += cut.quads * 6;
    }
    const laid = new BufferGeometry();
    laid.setAttribute('position', new BufferAttribute(position, 3));
    laid.setAttribute('normal', new BufferAttribute(normal, 3));
    laid.setAttribute('aTone', new BufferAttribute(tone, 1));
    laid.setAttribute('aBlock', new BufferAttribute(block, 1));
    laid.setIndex(new BufferAttribute(index, 1));
    laid.computeBoundingSphere();
    writing.geometry.dispose();
    writing.geometry = laid;
  }

  // AND IT IS LAID EMPTY BEFORE THE FIRST FRAME, WHICH IS NOT A FORMALITY.
  // three.js keys a program on what the OBJECT needs as well as on the shader,
  // and an empty BufferGeometry needs nothing: the first frame compiled this
  // material once for a mesh with no `normal` attribute and again, minutes
  // later, for the same mesh once a face had landed and given it one. Two live
  // programs for one material, which guard-programmi counted and reported. So
  // the attribute SHAPE is fixed here, at zero length, and never changes again.
  layWriting();

  return {
    meshes,

    /** What the writing of the hub is made of, for the panel and the guard. */
    get writingCensus() {
      const per = [];
      let triangles = 0;
      for (const [, cut] of written) {
        per.push(cut.census);
        triangles += cut.census.triangles;
      }
      return { faces: per.length, triangles, per };
    },

    /**
     * A block's stone, as soon as the worker has cut it.
     *
     * ANYTHING ALREADY SAID ABOUT THIS BLOCK IS APPLIED HERE RATHER THAN LOST,
     * and that is the whole contract of this seat: TWO asynchronous deliveries
     * meet at it and neither can be told to wait for the other. The stone
     * arrives from the engine's worker, one piece per message; the writing
     * arrives from engraveAll(), one face per frame, in order of distance from
     * the reference pose. Nothing keeps those two queues in step.
     *
     * IT USED TO REMEMBER THE FOCUS AND FORGET THE WRITING, and the asymmetry
     * cost four faces out of six. Measured at the seat before it was touched
     * (v2-pietra/dev3/inkbind.mjs, which wraps this door and the scene and
     * writes down which walls existed at each knock): the writing for 06, 05,
     * 01 and 04 was handed in between 5.5 and 8.2 seconds, with NOT ONE wall
     * yet standing, and was dropped on the floor by a `if (block)` that had
     * nothing to put it on; 02 at 9.9 s and 03 at 16.5 s found all eight
     * standing and were kept. That is exactly the three faces the verbale
     * reported as `tInk` null — 01, 04, 05 — plus the one nobody could see
     * because it is out of the reference framing.
     *
     * So both are held, and both are applied here.
     */
    attach(id, stone) {
      blocks.set(id, stone);
      const held = focus.get(id);
      if (held) {
        stone.material.uniforms.uInk.value = INK_GAIN
          * (1 + FOCUS_INK * held.value * (1 - FOCUS_OPEN_DIM * held.out));
      }
      const written = engravings.get(id);
      if (written) stone.setEngraving(written);
    },

    /**
     * Lays the engraving of one section onto its block.
     *
     * HELD WHETHER OR NOT THE STONE IS THERE. A block whose courses have not
     * landed yet is the ordinary case and not the exception — see attach() —
     * so the texture is remembered first and applied second.
     */
    setEngraving(id, delivery) {
      engravings.set(id, delivery);
      // THE BODIES DO NOT WAIT FOR THE STONE and never could: they are hung on
      // the WORLD, off the plan, and the plan is known before anything has been
      // cut. Only the halo has to wait for a wall to land on, which is what the
      // seat above exists for.
      if (delivery && delivery.solids) {
        written.set(id, delivery.solids);
        layWriting();
      }
      const block = blocks.get(id);
      if (block) block.setEngraving(delivery);
    },

    /** Distance from the reference camera, which is what sizes the engraving. */
    faceCentre(id) {
      const block = placed.get(id);
      return block ? block.centre.clone() : null;
    },

    /**
     * How lit one block is, nought to one, and how far its face has opened.
     *
     * Nought on both is the state the reference framing shows, so a hub nobody
     * is standing in front of is exactly the picture it was fitted against.
     */
    setFocus(id, amount, opened = 0) {
      const value = Math.max(0, Math.min(1, amount));
      const out = Math.max(0, Math.min(1, opened));
      const held = focus.get(id);
      if (held && held.value === value && held.out === out) return;
      focus.set(id, { value, out });
      // ONE ARITHMETIC AND TWO READERS, which is what the writing coming off
      // the wall costs this seat. The halo on the stone and the body standing
      // off it are one light: they brighten together, they step back together
      // when the face opens, and the gain is worked out ONCE here rather than
      // twice by two files that would drift.
      const gain = INK_GAIN * (1 + FOCUS_INK * value * (1 - FOCUS_OPEN_DIM * out));
      const slot = slotOf.get(id);
      if (slot !== undefined) gains[slot] = gain;
      const block = blocks.get(id);
      if (block) block.material.uniforms.uInk.value = gain;
    },

    /**
     * The breathing, written into the one buffer the eight quads share.
     *
     * The arithmetic is untouched from when each quad had a material to write
     * it into; what changed is where it lands. A quad's four corners all carry
     * its own (size, intensity), so one upload of 64 floats replaces eight
     * uniform writes and the eight binds that went with them.
     */
    update(elapsed) {
      const values = breath.array;
      for (const pulse of pulses) {
        const lit = focus.get(pulse.id)?.value || 0;
        const depth = (pulse.depth === undefined ? MARKER_PULSE.depth : pulse.depth)
          + FOCUS_PULSE * lit;
        const intensity = pulse.base * (1 + FOCUS_MARKER * lit)
          * (1 + depth * Math.sin(elapsed * (Math.PI * 2 / MARKER_PULSE.period) + pulse.phase));
        const size = pulse.size * (1 + FOCUS_SIZE * lit);
        for (let c = 0; c < 4; c++) {
          values[pulse.slot * 8 + c * 2] = size;
          values[pulse.slot * 8 + c * 2 + 1] = intensity;
        }
      }
      breath.needsUpdate = true;
    },
  };
}
