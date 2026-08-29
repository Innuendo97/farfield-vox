import {
  BufferAttribute, BufferGeometry, Color, Group, Mesh, ShaderMaterial,
} from 'three';
import { createMonoliths, STAIR_GLOW } from '../monoliths.js';
import { createRocks } from '../rocks.js';
import { glowMesh } from '../stairs.js';
import { createMasonry, runInWorker, stoneTile } from '../voxel/index.js';
import { stairSpecs, stoneSpecs } from '../stone.js';
import MASONRY_SPEC from '../../../assets-src/monoliths/masonry-spec.json';

// THE BUILT STONE. Owned by V2.
//
// The six blocks, the stair, the platform and the rocks — and as of this
// delivery not one of them is a download. The blocks used to arrive as a glTF
// scene with a painted albedo and a Cycles bake of the light on it, and the
// stair as a second mesh with a second atlas; they are courses of masonry now,
// cut from src/world/layout.js and from the measurement of the two targets that
// assets-src/monoliths/masonry-spec.json carries. What that buys is not weight:
// it is that the shape of this world can be argued with in a text file instead
// of in a renderer nobody has any more.
//
// IT ASKS FOR NOTHING AT THIS ARRIVAL, which is why `needs` is empty. The stone
// is arithmetic and the arithmetic is off the thread the walker is on, so the
// first walkable frame no longer waits on four textures and a model.
//
// AND IT ARRIVES ONE BLOCK AT A TIME. The stone is cut in the engine's worker
// and posted a block per message — cutting all eight in one and handing them
// over together would put eight geometries, eight materials and eight shader
// compilations into a single task on exactly the thread the work was moved off.
// So the layer hangs a GROUP at dress and fills it as the messages land: the
// first wall is standing while the last is still being cut.
//
// THE STAIR AND THE BLOCKS ARE ONE STRUCTURE, which is why the glow of the
// risers lives in this file beside the blocks and not in the hub. Lighting the
// writing on block 03 while leaving the risers where they were would split one
// structure into two, and the hub is not the place that knows they are one.

// Colour of the under glow on the risers, from the engraved cyan of the
// reference. It lives here rather than in layout.js because it is a property of
// this surface, not of the plan of the hub.
const GLOW_COLOUR = 0x7fd4f5;

// How much brighter the risers burn with a walker at the foot of the stair.
// Held well under the engraving's own answer: the reference lights the strip
// very gently, and what has to read at the top of the ramp is still a line
// under each nosing rather than a lit staircase.
const STAIR_FOCUS = 0.8;

// The strip on the risers. It carries a flat colour and an intensity, and it
// is drawn at intensity zero: the geometry is here so that lighting it later is
// a uniform rather than a change of scene.
const GLOW_VERTEX = /* glsl */`
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GLOW_FRAGMENT = /* glsl */`
  precision highp float;
  uniform vec3 uColour;
  uniform float uIntensity;
  void main() {
    gl_FragColor = vec4(uColour * uIntensity, 1.0);
  }
`;

/** The dark strips under the nosings, ready for the emissive pass to light them. */
function buildGlow() {
  const material = new ShaderMaterial({
    uniforms: {
      uColour: { value: new Color(GLOW_COLOUR).convertSRGBToLinear() },
      uIntensity: { value: 0 },
    },
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    fog: false,
  });
  const built = glowMesh();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(built.positions, 3));
  geometry.setIndex(new BufferAttribute(built.indices, 1));
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, material);
  mesh.name = 'stair-glow';
  return { mesh, setGlow(intensity) { material.uniforms.uIntensity.value = intensity; } };
}

const layer = {
  id: 'v2-pietra',

  meshes: [],

  monoliths: null,
  stone: null,
  glow: null,
  rocks: null,
  worker: null,

  /** Every wall that has landed, by the id of the piece it belongs to. */
  built: new Map(),

  dress: {
    // NOTHING. Every byte the six blocks and the stair used to cost — a glTF
    // scene, three stone sheets and two stair atlases — is arithmetic now.
    needs: [],

    build() {
      layer.stone = new Group();
      layer.stone.name = 'stone';
      layer.monoliths = createMonoliths();
      layer.glow = buildGlow();
      layer.meshes = [layer.stone, layer.glow.mesh, ...layer.monoliths.meshes];
      layer.glow.setGlow(STAIR_GLOW);

      const pieces = [...stoneSpecs(MASONRY_SPEC), ...stairSpecs(MASONRY_SPEC)];
      const engraved = new Set(stoneSpecs(MASONRY_SPEC).map((s) => s.id));
      let tile = null;
      // The disc is not asked for: the meadow is V1's and does not come from
      // here, and a worker that cut it anyway would spend tens of milliseconds
      // and post twenty megabytes nobody in this world reads.
      layer.worker = runInWorker({ blocks: pieces, disc: false }, (message) => {
        if (message.kind === 'tile') {
          tile = stoneTile(message.data, message.side);
          for (const [, piece] of layer.built) {
            piece.material.uniforms.tStone.value = tile;
          }
          return;
        }
        if (message.kind !== 'masonry') return;
        const spec = pieces.find((p) => p.id === message.id);
        const piece = createMasonry(spec, tile, message.built, engraved.has(spec.id));
        layer.stone.add(piece.mesh);
        layer.built.set(spec.id, piece);
        if (engraved.has(spec.id)) layer.monoliths.attach(spec.id, piece);
      });
      return layer.monoliths;
    },
  },

  plant: {
    needs: ['rocks-scene', 'rock-light'],

    build(assets) {
      layer.rocks = createRocks({
        rocks: assets['rocks-scene'],
        rockLight: assets['rock-light'],
      });
      layer.meshes = [...layer.meshes, ...layer.rocks.meshes];
      return layer.rocks;
    },
  },

  /** The engraving of one section, once its text has been drawn. */
  setEngraving(id, texture) {
    if (layer.monoliths) layer.monoliths.setEngraving(id, texture);
  },

  /**
   * Intensity of the strip on the risers, in light units.
   *
   * Built dark. The emissive pass that lights it belongs with the monoliths,
   * and this is the handle it will pull.
   */
  setStairGlow(intensity) {
    if (layer.glow) layer.glow.setGlow(intensity);
  },

  /**
   * How lit one block is, nought to one, as the walker comes and goes.
   *
   * The stair answers with the third block because it is part of it: it is the
   * way up onto its platform and nothing else in the hub uses it, so lighting
   * the writing while leaving the risers where they were would split one
   * structure into two.
   */
  setFocus(id, amount, opened = 0) {
    if (!layer.monoliths) return;
    layer.monoliths.setFocus(id, amount, opened);
    if (id === '03' && layer.glow) layer.glow.setGlow(STAIR_GLOW * (1 + STAIR_FOCUS * amount));
  },

  /** What the rocks are costing, for the development panel. */
  get rockTriangles() {
    return layer.rocks ? layer.rocks.triangles : 0;
  },

  /** What the built stone is costing, for the development panel and the gate. */
  get stoneTriangles() {
    let quads = 0;
    for (const [, piece] of layer.built) quads += piece.quads;
    return quads * 2;
  },

  update({ elapsed }) {
    if (layer.monoliths) layer.monoliths.update(elapsed);
  },
};

export default layer;
