import {
  BufferAttribute, BufferGeometry, DataTexture, LinearMipmapLinearFilter, Mesh,
  RGFormat, RepeatWrapping, ShaderMaterial, UnsignedByteType, Vector2, Vector3,
} from 'three';
import {
  SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS, SKY_GLSL, SKY_REFLECTION,
  SKY_REFLECTION_GLSL, SKY_UNIFORMS,
} from '../../core/sky.js';
import { FOG_GLSL, LOW_SKY, fogUniforms } from '../../world/terrain.js';
import { MONOLITHS } from '../../world/layout.js';
import { STONE_METRES, buildMasonry } from './courses.js';
import MONOLITH_BAKE from '../../../assets-src/monoliths/monoliths.json';

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
// AND THE RULE ABOUT VERTICES DOES NOT BIND HERE, which is worth writing down
// rather than leaving to be noticed. Nothing in this mesh is merged: a block is
// placed and it is its own two rectangles. So a per-block coordinate in a
// vertex costs no merge, because there is no merge to lose. The rule protects
// the meadow's greedy mesh, where a stored per-voxel property is three times
// the geometry of the world; it is not a style to be applied where it buys
// nothing.

const DEG = Math.PI / 180;

// The stone's own colour and how hard the tile bites it, both fitted on the
// render against the target's own block.
//
// It came up by three and a half times from where it started, and the reason is
// worth recording: at a very dark albedo the FRESNEL dominates what a face hands
// back, so the stone was not merely dark, it was BLUE — a lit face read
// 34,58,71 against the target's 70,84,83, which is a picture of sky in stone
// rather than stone. Raising the pigment puts the grazing term back in its
// place as a rim instead of as the body of the material.
const STONE_ALBEDO = [0.185, 0.200, 0.190];
const STONE_GAIN = 0.62;

// Reflectance of the stone face on, how much of the sky the grazing term
// carries, and how sharply it is confined to the very edge.
//
// THE THREE ARE RE-DECLARED HERE AND NOT INHERITED, and both halves of that
// matter. They live private inside src/world/monoliths.js, a file this demo
// does not touch — and, more to the point, they were FITTED against five baked
// flanks whose grazing angle sweeps across a curved-lit surface. A wall of flat
// faces presents an angle that is CONSTANT over a whole face, so the same
// numbers do not mean the same thing here. They are carried at their delivered
// values so the difference can be seen rather than hidden, and the refit is
// named as work the pivot owes rather than folded in quietly.
const STONE_F0 = 0.006;
const STONE_RIM = 5.9;
const STONE_RIM_POWER = 8.0;
const SKY_BLUR = 3.0;

// The engraved cyan and the light it gives off, at the delivered values and
// re-declared for the same reason as the three above.
const INK_CORE = [0.44, 0.80, 0.99];
const INK_HALO = [0.16, 0.48, 0.72];
const INK_GAIN = 0.78;

const STONE_EXPOSURE = 1.25;

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
  attribute vec2 aBlock;
  attribute vec2 aStone;

  varying vec2 vBlock;
  varying vec2 vStone;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDistance;

  void main() {
    vBlock = aBlock;
    vStone = aStone;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vDistance = length(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */`
  precision highp float;

  varying vec2 vBlock;
  varying vec2 vStone;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDistance;

  uniform sampler2D tStone;
  uniform sampler2D tInk;
  uniform vec3 uAlbedo;
  uniform float uGain;
  uniform float uTile;
  uniform float uLightScale;
  uniform float uJoint;
  uniform float uF0;
  uniform float uRim;
  uniform float uRimPower;
  uniform float uSkyBlur;
  uniform vec3 uLowSky;
  uniform float uRelief;

  uniform vec3 uCentre;
  uniform vec3 uRight;
  uniform vec3 uFront;
  uniform vec2 uFace;
  uniform float uInk;
  uniform vec3 uInkCore;
  uniform vec3 uInkHalo;

  ${SCENE_LIGHT_GLSL}
  ${SKY_GLSL}
  ${SKY_REFLECTION_GLSL}
  ${FOG_GLSL}

  void main() {
    vec3 n = normalize(vNormal);

    // THE TILE, and the one shade taken off it. The tile is a height as well as
    // a shade, so a second fetch a step up-sun differs from the first by the
    // slope along the only direction a sun cares about: one more read of a map
    // already in hand, and not one byte of a stored normal.
    vec2 tile = vStone * uTile;
    vec2 pair = texture2D(tStone, tile).rg;
    vec3 albedo = uAlbedo * (1.0 + uGain * (pair.r - 0.5));
    vec2 upSun = normalize(vec2(uSunDir.x, uSunDir.z) + 1e-5) * (0.012 * uTile);
    float above = texture2D(tStone, tile + upSun).g;

    // The same two analytic terms as the meadow, on the same contract: a flat
    // face under a fixed sun and an isotropic sky, handed to the same
    // bakedLight() the delivered world consumes. One producer for the whole
    // scene, so a block and the grass at its foot cannot disagree about the
    // hour.
    vec2 terms = vec2(max(dot(n, uSunDir), 0.0), 0.5 + 0.5 * n.y);
    terms.x *= clamp(1.0 - uRelief * (above - pair.g), 0.45, 1.9);
    vec3 light = bakedLight(vec3(terms, 0.0)) * uLightScale;

    // The joint between blocks: the same six per cent over the same one or two
    // pixels as the meadow's, because it is the same thing seen on stone. Held
    // in pixels off the block's own coordinate, so it is a line at every
    // distance and never a band.
    vec2 edge = min(vBlock, 1.0 - vBlock);
    float border = min(edge.x, edge.y);
    float px = max(length(fwidth(vBlock)), 1e-6);
    albedo *= 1.0 - uJoint * (1.0 - smoothstep(0.0, 1.6 * px, border));

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
    float facing = smoothstep(0.55, 0.90, dot(n, uFront));
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
 * @param {string}  id    which entry of src/world/layout.js to build
 * @param {Texture} tile  the stone atlas
 * @param {object}  ready the courses, if the worker has already cut them
 */
export function createMasonry(id, tile, ready = null) {
  const spec = MONOLITHS.find((m) => m.id === id);
  const built = ready || buildMasonry(spec);
  const angle = spec.rotationY * DEG;
  const centre = new Vector3(spec.position.x, spec.baseY + spec.size[1] / 2, spec.position.z);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(built.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(built.normals, 3));
  geometry.setAttribute('aBlock', new BufferAttribute(built.block, 2));
  geometry.setAttribute('aStone', new BufferAttribute(built.stone, 2));
  geometry.setIndex(new BufferAttribute(built.indices, 1));
  geometry.computeBoundingSphere();

  const material = new ShaderMaterial({
    uniforms: {
      tStone: { value: tile },
      tInk: { value: null },
      uAlbedo: { value: new Vector3(...STONE_ALBEDO) },
      uGain: { value: STONE_GAIN },
      uTile: { value: 1 / STONE_METRES },
      uLightScale: { value: MONOLITH_BAKE.lightScale * STONE_EXPOSURE },
      uJoint: { value: 0.10 },
      uRelief: { value: 2.2 },
      uF0: { value: STONE_F0 },
      uRim: { value: STONE_RIM },
      uRimPower: { value: STONE_RIM_POWER },
      uSkyBlur: { value: SKY_BLUR },
      uLowSky: { value: new Vector3(...LOW_SKY) },
      uCentre: { value: centre.clone() },
      uRight: { value: new Vector3(Math.cos(angle), 0, -Math.sin(angle)) },
      uFront: { value: new Vector3(Math.sin(angle), 0, Math.cos(angle)) },
      uFace: { value: new Vector2(spec.size[0], spec.size[1]) },
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
  mesh.name = `masonry-${id}`;
  mesh.position.set(spec.position.x, spec.baseY, spec.position.z);
  mesh.rotation.y = angle;

  return {
    mesh,
    spec,
    material,
    blocks: built.blocks,
    courses: built.courses,
    rise: built.rise,
    quads: built.quads,
    vertices: built.vertices,
    setEngraving(texture) { material.uniforms.tInk.value = texture; },
  };
}
