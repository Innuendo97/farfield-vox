import {
  BufferAttribute, BufferGeometry, Color, Mesh, ShaderMaterial,
} from 'three';
import { createBakedMaterial } from '../air.js';
import { createMonoliths, STAIR_GLOW } from '../monoliths.js';
import { createRocks } from '../rocks.js';
import { glowMesh, stairMesh } from '../stairs.js';
import TERRAIN from '../../../assets-src/terrain/terrain.json';

// THE BUILT STONE. Owned by V2.
//
// The blocks, the stair, the platform and the rocks. It has a foot in both
// arrivals and that is why the register indexes needs by arrival: the blocks
// and the stair are part of the first walkable frame, and the rocks are not.
//
// WHAT V2 REPLACES IT WITH: masonry in courses generated from layout.js, the
// stair rebuilt as blocks, the rocks generated rather than delivered, a tile
// atlas of real stone, and the refit of the grazing terms on flat faces. The
// factory the stair borrows from src/world/air.js goes with that rewrite.
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

/**
 * The stair, the platform and the dark strips on the risers.
 *
 * Hung with the ground rather than with the blocks, because it is the same kind
 * of surface: painted albedo times baked light, in the same air. Before the
 * textures arrive there is no stair, exactly as there is no meadow.
 */
function buildStairs({ stairsAlbedo, stairsLight, lightScale = TERRAIN.lightScale }) {
  const meshes = [];
  const glowMaterial = new ShaderMaterial({
    uniforms: {
      uColour: { value: new Color(GLOW_COLOUR).convertSRGBToLinear() },
      uIntensity: { value: 0 },
    },
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    fog: false,
  });

  if (stairsAlbedo && stairsLight) {
    const built = stairMesh();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(built.positions, 3));
    geometry.setAttribute('uv', new BufferAttribute(built.uvs, 2));
    geometry.setIndex(new BufferAttribute(built.indices, 1));
    geometry.computeBoundingSphere();

    const mesh = new Mesh(geometry, createBakedMaterial({
      albedo: stairsAlbedo, light: stairsLight, lightScale,
    }));
    mesh.name = 'stairs';
    meshes.push(mesh);

    const glow = glowMesh();
    const glowGeometry = new BufferGeometry();
    glowGeometry.setAttribute('position', new BufferAttribute(glow.positions, 3));
    glowGeometry.setIndex(new BufferAttribute(glow.indices, 1));
    glowGeometry.computeBoundingSphere();
    const strips = new Mesh(glowGeometry, glowMaterial);
    strips.name = 'stair-glow';
    meshes.push(strips);
  }

  return {
    meshes,
    setGlow(intensity) { glowMaterial.uniforms.uIntensity.value = intensity; },
  };
}

const layer = {
  id: 'v2-pietra',

  meshes: [],

  monoliths: null,
  stairs: null,
  rocks: null,

  dress: {
    needs: [
      'monoliths-scene', 'monolith-albedo', 'monolith-relief', 'monolith-light',
      'stairs-albedo', 'stairs-light',
    ],

    build(assets) {
      layer.monoliths = createMonoliths({
        scene: assets['monoliths-scene'],
        stone: assets['monolith-albedo'],
        relief: assets['monolith-relief'],
        stoneLight: assets['monolith-light'],
      });
      layer.stairs = buildStairs({
        stairsAlbedo: assets['stairs-albedo'],
        stairsLight: assets['stairs-light'],
      });
      layer.meshes = [...layer.monoliths.meshes, ...layer.stairs.meshes];
      layer.stairs.setGlow(STAIR_GLOW);
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
    if (layer.stairs) layer.stairs.setGlow(intensity);
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
    if (id === '03') layer.stairs.setGlow(STAIR_GLOW * (1 + STAIR_FOCUS * amount));
  },

  /** What the rocks are costing, for the development panel. */
  get rockTriangles() {
    return layer.rocks ? layer.rocks.triangles : 0;
  },

  update({ elapsed }) {
    if (layer.monoliths) layer.monoliths.update(elapsed);
  },
};

export default layer;
