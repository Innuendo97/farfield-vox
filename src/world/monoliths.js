import {
  AdditiveBlending, Box3, BufferAttribute, BufferGeometry, DoubleSide,
  DynamicDrawUsage, Mesh, ShaderMaterial, Sphere, Vector3,
} from 'three';
import { MONOLITHS } from './layout.js';
import { INK_CORE, INK_GAIN, INK_HALO } from './voxel/masonry.js';

// The six blocks: what hangs AROUND them.
//
// THE STONE ITSELF IS NOT HERE ANY MORE, and this file is what is left when it
// goes. It used to carry a painted albedo, a Cycles bake of the light on it and
// the mesh the two were unwrapped for; the six are courses of masonry now,
// generated from the plan and from the measurement of the two targets, and the
// material that draws them is the engine's. What was left behind when the bake
// was retired is everything that is NOT stone: the rhombus that hangs in front
// of every block, the hoop at the fifth, how they breathe, and what a block
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
// and not declared a second time here. The rhombus and the hoop are the same
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
// of every block and the hoop at the fifth are things the targets DO show, and
// they are content, not decoration.

// WHAT HANGS AT THE FOOT OF THE BLOCKS IS SEVEN THINGS AND ONE DRAW.
//
// The marker at the foot of every block is a small cyan rhombus that hangs in
// front of the stone and breathes, and at the fifth there is a hoop as well.
// Both are quads with their shape cut out of them in the shader rather than
// sprites, because a rhombus is one absolute value and a texture for it would
// be a download.
//
// THEY USED TO BE SEVEN MESHES WITH SEVEN ShaderMaterials, and the gate counted
// what that cost: SEVEN DRAW CALLS FOR FOURTEEN TRIANGLES, submitted at every
// pose in the world because each of them carried `frustumCulled = false`. They
// are one mesh now — one geometry of seven quads, one material, one call — and
// what used to be a uniform per mesh is an attribute per quad:
//
//   aCentre  where this quad hangs, in world metres. The billboarding needs a
//            centre per quad and nothing else changes, so the whole turn to the
//            eye still happens in the vertex shader.
//   aShape   which of the two figures to cut: the rhombus or the hoop.
//   aPulse   (size in metres, intensity), the two things that breathe. They are
//            written into the buffer every frame instead of into seven uniform
//            blocks -- 56 floats, against seven material binds.
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
// hand below, over the seven centres and the largest a quad can breathe to.
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
    // Billboarded about the vertical only: the marker is a thing standing in
    // the world, not a decal on the lens, and rolling it with the camera pitch
    // makes it read as interface.
    vec3 toEye = cameraPosition - aCentre;
    vec3 right = normalize(vec3(-toEye.z, 0.0, toEye.x));
    vec3 world = aCentre + right * (position.x * aPulse.x) + vec3(0.0, position.y * aPulse.x, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

// The two figures, in the one shader that draws them both.
//
// THE RHOMBUS: an outlined diamond with a filled heart and a soft field around
// it, because the reference draws all three.
//
// THE HOOP AT THE FIFTH: the reference puts a lit circle there and nowhere
// else, which is the section about where the walker is going -- a hoop of light
// standing on the meadow with a star burning in the middle of it. It is
// billboarded like the rhombus because in the reference it is a circle seen
// face on while everything around it is seen in perspective, which a hoop lying
// on the ground could never be.
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
    if (vShape > 0.5) {
      float d = length(p);
      float hoop = smoothstep(0.09, 0.0, abs(d - 0.72));
      float star = smoothstep(0.34, 0.0, d);
      // Four spokes out of the middle, which is what a point of light does when
      // it is drawn rather than photographed.
      float spokes = max(
        smoothstep(0.055, 0.0, abs(p.x)) * smoothstep(0.95, 0.1, abs(p.y)),
        smoothstep(0.055, 0.0, abs(p.y)) * smoothstep(0.95, 0.1, abs(p.x)));
      float wash = smoothstep(1.0, 0.0, d) * 0.22;
      amount = (hoop + star * 1.5 + spokes * 0.55 + wash) * vIntensity;
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

const SHAPE_RHOMBUS = 0;
const SHAPE_HOOP = 1;

/**
 * The seven quads, as one geometry, with a bound that is true.
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

// The hoop at the fifth block: how big it is, where it stands relative to the
// rhombus above it, and how hard it burns.
const RING_SIZE = 1.10;
const RING_LEFT = 0.50;
// And a step further out than the rhombus: it is a hoop wide enough to reach
// behind the near corner of the block, which cuts it in half.
const RING_FORWARD = 1.05;
const RING_DROP = 0.30;
const RING_GAIN = 0.95;

/**
 * What hangs in front of the six blocks, and the seat their stone reports to.
 *
 * IT NEEDS NO ASSET AND WAITS FOR NOTHING. A rhombus is one absolute value in a
 * shader and a hoop is two, so the markers stand in the first walkable frame
 * with the blockers — where they hang comes off the plan, which is known before
 * anything has been downloaded or cut.
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

  // ------------------------------------------------- where the seven quads hang
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

  // ----------------------------------------------------------- the ring at 05
  const target = placed.get('05');
  if (target) {
    const { spec, centre, angle } = target;
    const front = new Vector3(Math.sin(angle), 0, Math.cos(angle));
    const right = new Vector3(Math.cos(angle), 0, -Math.sin(angle));
    const at = new Vector3(
      centre.x + front.x * (spec.size[2] / 2 + MARKER_STANDOFF + RING_FORWARD) - right.x * RING_LEFT,
      spec.baseY + spec.size[1] * MARKER_HEIGHT - RING_DROP,
      centre.z + front.z * (spec.size[2] / 2 + MARKER_STANDOFF + RING_FORWARD) - right.z * RING_LEFT,
    );
    quads.push({ centre: at, shape: SHAPE_HOOP, size: RING_SIZE });
    pulses.push({
      id: '05', slot: quads.length - 1, phase: 2.5, depth: 0.14,
      base: RING_GAIN, size: RING_SIZE,
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

  return {
    meshes,

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
    setEngraving(id, texture) {
      engravings.set(id, texture);
      const block = blocks.get(id);
      if (block) block.setEngraving(texture);
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
      const block = blocks.get(id);
      if (block) {
        block.material.uniforms.uInk.value = INK_GAIN
          * (1 + FOCUS_INK * value * (1 - FOCUS_OPEN_DIM * out));
      }
    },

    /**
     * The breathing, written into the one buffer the seven quads share.
     *
     * The arithmetic is untouched from when each quad had a material to write
     * it into; what changed is where it lands. A quad's four corners all carry
     * its own (size, intensity), so one upload of 56 floats replaces seven
     * uniform writes and the seven binds that went with them.
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
