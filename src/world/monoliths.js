import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Mesh,
  ShaderMaterial, Vector2, Vector3,
} from 'three';
import {
  SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS, SKY_GLSL, SKY_REFLECTION,
  SKY_REFLECTION_GLSL, SKY_UNIFORMS,
} from '../core/sky.js';
import { BAKED_TERMS_GLSL, FOG_GLSL, fogUniforms, LOW_SKY } from './air.js';
import { MONOLITHS } from './layout.js';
import MONOLITH_BAKE from '../../assets-src/monoliths/monoliths.json' with { type: 'json' };

// The six blocks.
//
// Same contract as the ground: a painted albedo, a Cycles bake of the light on
// it, one multiply, one fog. Two things are added that the meadow does not
// need, and both come straight off the reference image.
//
// The first is a sky reflection weighted by Fresnel. The stone of the reference
// is dark and slightly polished: the faces turned towards the walker sit at a
// twentieth of the light they receive, but the flanks seen almost edge on are
// near white, and the narrower the sliver the brighter it is. That is not a
// light falling on them, it is the sky in them, and its strength across the
// five blocks follows the grazing angle to within a few per cent. So it is
// drawn as what it is: one sample of the sky already hanging behind the scene.
//
// The second is the engraving, which arrives as a two channel texture from
// src/world/engraving.js and is laid on the face in the block's own
// coordinates, so the writing is placed in metres of stone and not in texture
// space that a change of mesh could shift.

const DEG = Math.PI / 180;

// Exposure of the stone, on top of the light the bake stored.
//
// Declared here rather than folded into the bake for the same reason the ground
// declares its own: the bake is a physical render and the reference is an
// illustration with lifted midtones, and the difference has to be a number
// somebody can see and change.
export const STONE_EXPOSURE = 1.25;

// Reflectance of the stone face on. It is far under the 0.04 of a smooth
// dielectric, and it is fitted rather than physical: what has to be reproduced
// is the reference's ratio between a face turned towards the walker and a flank
// seen almost edge on, which is better than twenty to one. Schlick carries the
// whole of that ratio from this one number, so the dark faces and the bright
// flanks cannot be tuned against each other.
const STONE_F0 = 0.006;

// And how much of the sky the grazing term is allowed to carry. Schlick sends a
// dielectric to a perfect mirror at ninety degrees; nothing in this framing is
// seen closer to that than about seventy seven, and at seventy seven Schlick
// alone leaves the flank of the tallest block at a third of the brightness the
// reference shows. The gain is fitted against the five flanks at once.
const STONE_RIM = 5.9;

// And how sharply that gain is confined to the very edge. Schlick's fifth power
// is too broad: raised to it, the gain that brings the flank of the tallest
// block up to the reference also brightens flanks seen at seventy degrees,
// which the reference leaves dark. The eighth power separates seventy seven
// degrees from seventy by a factor of four, which is what the five flanks
// measure.
const STONE_RIM_POWER = 8.0;

// How blurred the sky is in the stone.
//
// A weathered rock is not a mirror. Sampling a coarse level of the sky rather
// than its surface is the cheapest honest way to say so — one texture fetch,
// no second buffer — and it is also what stops the relief map from tearing the
// reflection into vertical streaks, because a blurred reflection barely notices
// which way a millimetre of surface is leaning.
const SKY_BLUR = 3.0;

// How much of the relief map reaches the shading. It is the high frequency part
// of the direct light, which the light atlas is far too coarse to hold: at
// thirty seven texels to the metre a hairline crack is a third of a texel.
const RELIEF_STRENGTH = 0.50;

// The engraved cyan of the reference, from the core of a stroke out to the halo
// around it, and the light it gives off.
const INK_CORE = [0.44, 0.80, 0.99];
const INK_HALO = [0.16, 0.48, 0.72];
const INK_GAIN = 0.78;

// The strip of light under the nosing of every stair riser. It is built dark by
// src/world/stairs.js and lit from here, because it is the same light as the
// engraving and has to move with it. The reference lights it very gently:
// what reads is a thin line under each nosing, not a lit staircase.
export const STAIR_GLOW = 0.30;

const VERTEX = /* glsl */`
  attribute vec2 aLight;
  attribute vec2 aStone;

  varying vec2 vLight;
  varying vec2 vStone;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDistance;

  void main() {
    vLight = aLight;
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

  varying vec2 vLight;
  varying vec2 vStone;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDistance;

  uniform sampler2D tAlbedo;
  uniform sampler2D tRelief;
  uniform sampler2D tLight;
  uniform sampler2D tInk;

  uniform float uLightScale;
  uniform float uSkyBlur;
  uniform float uF0;
  uniform float uRim;
  uniform float uRimPower;
  uniform float uRelief;
  uniform vec3 uLowSky;

  uniform vec3 uCentre;
  uniform vec3 uRight;
  uniform vec3 uFront;
  uniform vec2 uFace;
  uniform float uInk;
  uniform vec3 uInkCore;
  uniform vec3 uInkHalo;

  ${SCENE_LIGHT_GLSL}
  ${BAKED_TERMS_GLSL}
  ${SKY_GLSL}
  ${SKY_REFLECTION_GLSL}
  ${FOG_GLSL}

  // Tangent frame from the derivatives of the position and of the texture
  // coordinates. The stone is mapped face by face in metres, so a frame could
  // be derived from the normal alone, but this one is right for the chamfers
  // too, where there is no dominant axis to derive it from.
  mat3 cotangentFrame(vec3 n, vec3 p, vec2 uv) {
    vec3 dp1 = dFdx(p);
    vec3 dp2 = dFdy(p);
    vec2 duv1 = dFdx(uv);
    vec2 duv2 = dFdy(uv);
    vec3 dp2perp = cross(dp2, n);
    vec3 dp1perp = cross(n, dp1);
    vec3 t = dp2perp * duv1.x + dp1perp * duv2.x;
    vec3 b = dp2perp * duv1.y + dp1perp * duv2.y;
    float scale = inversesqrt(max(dot(t, t), dot(b, b)));
    return mat3(t * scale, b * scale, n);
  }

  void main() {
    vec3 geometric = normalize(vNormal);
    vec3 relief = texture2D(tRelief, vStone).xyz * 2.0 - 1.0;
    vec3 normal = normalize(cotangentFrame(geometric, vWorld, vStone) * relief);

    vec3 albedo = texture2D(tAlbedo, vStone).rgb;
    // Red is how much of the sun this texel sees, green how much of the sky.
    vec3 light = bakedLight(bakedTerms(tLight, vLight)) * uLightScale;

    // The part of the direct light the atlas cannot resolve: the ratio of what
    // the perturbed surface catches to what the flat one does. The bias keeps
    // a face that is already in shadow from being multiplied by a ratio of two
    // numbers that are both nearly zero.
    // Against uSunDir, the uniform the dome is drawn from, rather than against
    // a direction rebuilt here out of the bake's own report: the relief has to
    // turn with the light when an evening turns it, and a second copy of where
    // the sun is is the defect this session began by removing.
    float flat0 = max(dot(geometric, uSunDir), 0.0);
    float bumped = max(dot(normal, uSunDir), 0.0);
    float detail = mix(1.0, (bumped + 0.30) / (flat0 + 0.30), uRelief);

    // ------------------------------------------------------------ engraving
    vec3 offset = vWorld - uCentre;
    vec2 ink = vec2(
      dot(offset, uRight) / uFace.x + 0.5,
      0.5 - offset.y / uFace.y);
    float facing = smoothstep(0.55, 0.90, dot(geometric, uFront));
    float inside = step(0.0, ink.x) * step(ink.x, 1.0) * step(0.0, ink.y) * step(ink.y, 1.0);
    vec2 cut = texture2D(tInk, ink).rg * (facing * inside);
    // Nothing is cut where nothing is drawn, so the groove term has to fall
    // back to one rather than to the half grey the map stores.
    float groove = mix(1.0, 0.42 + 1.16 * cut.g, facing * inside);

    vec3 colour = albedo * light * detail * groove;

    // ---------------------------------------------------------- the sky in it
    //
    // Off the shape of the block, not off its surface: the reflection belongs
    // to the face, and letting a hairline crack steer it drags a smear of sky
    // the height of the stone behind every one of them.
    vec3 view = normalize(vWorld - cameraPosition);
    vec3 mirrored = reflect(view, geometric);
    vec3 sky = skyReflection(mirrored, uSkyBlur);
    // A face seen edge on reflects almost exactly along the horizon, which is
    // where the brightest flanks of the reference come from, and below this
    // elevation it is handed the one pale air of the reference instead. The
    // grazing gain above was fitted against the five flanks with that colour
    // behind it, so the two belong to the same solve and move together.
    sky = mix(uLowSky, sky, smoothstep(0.12, 0.38, mirrored.y));

    float fresnel = uF0 + uRim
      * pow(1.0 - clamp(dot(-view, geometric), 0.0, 1.0), uRimPower);
    colour += sky * fresnel;

    // ------------------------------------------------------------- the light
    colour += mix(uInkHalo, uInkCore, cut.r) * cut.r * uInk;

    colour = mix(colour, uFogColour, fogAmount(vDistance, vWorld.y));
    gl_FragColor = vec4(colour, 1.0);
  }
`;

// The marker at the foot of every block: a small cyan rhombus that hangs in
// front of the stone and breathes. Drawn as a quad with the shape cut out of it
// in the shader rather than as a sprite, because a rhombus is one absolute
// value and a texture for it would be a download.
const MARKER_VERTEX = /* glsl */`
  varying vec2 vUv;
  uniform vec3 uCentre;
  uniform vec2 uSize;

  void main() {
    vUv = uv;
    // Billboarded about the vertical only: the marker is a thing standing in
    // the world, not a decal on the lens, and rolling it with the camera pitch
    // makes it read as interface.
    vec3 toEye = cameraPosition - uCentre;
    vec3 right = normalize(vec3(-toEye.z, 0.0, toEye.x));
    vec3 world = uCentre + right * (position.x * uSize.x) + vec3(0.0, position.y * uSize.y, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const MARKER_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uCore;
  uniform vec3 uHalo;
  uniform float uIntensity;

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float d = abs(p.x) + abs(p.y);
    // An outlined rhombus with a filled heart, and a soft field around it: the
    // reference draws all three.
    float ring = smoothstep(0.045, 0.0, abs(d - 0.76));
    float core = smoothstep(0.44, 0.16, d);
    float glow = smoothstep(1.0, 0.30, d) * 0.34;
    float amount = (ring + core * 0.85 + glow) * uIntensity;
    gl_FragColor = vec4(mix(uHalo, uCore, clamp(amount, 0.0, 1.0)) * amount, 1.0);
  }
`;

// The ring at the foot of the fifth block. The reference puts a lit circle
// there and nowhere else, which is the section about where the walker is going:
// a hoop of light standing on the meadow, with a star burning in the middle of
// it. It is billboarded like the rhombus, because in the reference it is a
// circle seen face on while everything around it is seen in perspective, which
// a hoop lying on the ground could never be.
const RING_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uCore;
  uniform vec3 uHalo;
  uniform float uIntensity;

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float d = length(p);
    float hoop = smoothstep(0.09, 0.0, abs(d - 0.72));
    float star = smoothstep(0.34, 0.0, d);
    // Four spokes out of the middle, which is what a point of light does when
    // it is drawn rather than photographed.
    float spokes = max(
      smoothstep(0.055, 0.0, abs(p.x)) * smoothstep(0.95, 0.1, abs(p.y)),
      smoothstep(0.055, 0.0, abs(p.y)) * smoothstep(0.95, 0.1, abs(p.x)));
    float wash = smoothstep(1.0, 0.0, d) * 0.22;
    float amount = (hoop + star * 1.5 + spokes * 0.55 + wash) * uIntensity;
    gl_FragColor = vec4(mix(uHalo, uCore, clamp(amount, 0.0, 1.0)) * amount, 1.0);
  }
`;

/**
 * Renames the coordinate sets the exporter delivered.
 *
 * The bake writes the light on the first set and the tiling stone on the
 * second, which is the order Blender lists them in. Their names in the runtime
 * would then depend on how the loader chose to number them; renaming them once,
 * here, means the shader asks for the light by its name and cannot be pointed
 * at the wrong sheet by a change of exporter.
 */
function nameAttributes(geometry) {
  const light = geometry.attributes.uv;
  const stone = geometry.attributes.uv1 || geometry.attributes.uv2 || light;
  geometry.setAttribute('aLight', light);
  geometry.setAttribute('aStone', stone);
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('uv1');
  geometry.deleteAttribute('uv2');
  return geometry;
}

function emissiveMaterial(fragmentShader, vertexShader, uniforms) {
  return new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
  });
}

function markerGeometry() {
  // A unit quad centred on the origin; the vertex shader turns it to the eye
  // and gives it its size in metres.
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 1,
  ]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeBoundingSphere();
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
 * Hangs the six blocks, their markers and the ring on the scene.
 *
 * @param {object} assets  the loaded glTF scene, the stone sheets, the light
 *                         atlas and the sky
 */
export function createMonoliths({
  scene: loaded, stone: albedo, relief, stoneLight: light,
  lightScale = MONOLITH_BAKE.lightScale,
}) {
  const meshes = [];
  const blocks = new Map();
  const pulses = [];
  // How lit each block is, nought to one. It is written from outside, ramped
  // there, and read back every frame by the pulse below.
  const focus = new Map();

  if (loaded && albedo && relief && light) {
    for (const spec of MONOLITHS) {
      const found = loaded.getObjectByName(`monolith-${spec.id}`);
      if (!found) continue;
      const angle = spec.rotationY * DEG;
      const centre = new Vector3(
        spec.position.x, spec.baseY + spec.size[1] / 2, spec.position.z,
      );
      const material = new ShaderMaterial({
        uniforms: {
          tAlbedo: { value: albedo },
          tRelief: { value: relief },
          tLight: { value: light },
          tInk: { value: null },
          uLightScale: { value: lightScale * STONE_EXPOSURE },
              ...SCENE_LIGHT_UNIFORMS,
          ...SKY_UNIFORMS,
          ...SKY_REFLECTION,
          uSkyBlur: { value: SKY_BLUR },
          uF0: { value: STONE_F0 },
          uRim: { value: STONE_RIM },
          uRimPower: { value: STONE_RIM_POWER },
          uRelief: { value: RELIEF_STRENGTH },
          uLowSky: { value: new Vector3(...LOW_SKY) },
          uCentre: { value: centre.clone() },
          uRight: { value: new Vector3(Math.cos(angle), 0, -Math.sin(angle)) },
          uFront: { value: new Vector3(Math.sin(angle), 0, Math.cos(angle)) },
          uFace: { value: new Vector2(spec.size[0], spec.size[1]) },
          uInk: { value: INK_GAIN },
          uInkCore: { value: new Vector3(...INK_CORE) },
          uInkHalo: { value: new Vector3(...INK_HALO) },
          ...fogUniforms(),
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        fog: false,
      });

      const mesh = new Mesh(nameAttributes(found.geometry), material);
      mesh.name = `monolith-${spec.id}`;
      mesh.position.copy(found.position);
      mesh.quaternion.copy(found.quaternion);
      mesh.scale.copy(found.scale);
      meshes.push(mesh);
      blocks.set(spec.id, { spec, mesh, material, centre, angle });
    }
  }

  // ------------------------------------------------------------- the markers
  const quad = markerGeometry();
  for (const [, block] of blocks) {
    const { spec, centre, angle } = block;
    const front = new Vector3(Math.sin(angle), 0, Math.cos(angle));
    const at = new Vector3(
      centre.x + front.x * (spec.size[2] / 2 + MARKER_STANDOFF),
      spec.baseY + spec.size[1] * MARKER_HEIGHT,
      centre.z + front.z * (spec.size[2] / 2 + MARKER_STANDOFF),
    );
    const material = emissiveMaterial(MARKER_FRAGMENT, MARKER_VERTEX, {
      uCentre: { value: at },
      uSize: { value: new Vector2(MARKER_SIZE, MARKER_SIZE) },
      uCore: { value: new Vector3(...INK_CORE) },
      uHalo: { value: new Vector3(...INK_HALO) },
      uIntensity: { value: MARKER_GAIN },
    });
    const marker = new Mesh(quad, material);
    marker.name = `marker-${spec.id}`;
    marker.frustumCulled = false;
    meshes.push(marker);
    // Each one breathes on its own clock, so five markers in one frame never
    // pulse as a single blinking row.
    pulses.push({
      id: spec.id, material, phase: Number(spec.id) * 1.13, base: MARKER_GAIN,
      size: MARKER_SIZE,
    });
  }

  // ----------------------------------------------------------- the ring at 05
  const target = blocks.get('05');
  if (target) {
    const { spec, centre, angle } = target;
    const front = new Vector3(Math.sin(angle), 0, Math.cos(angle));
    const right = new Vector3(Math.cos(angle), 0, -Math.sin(angle));
    const at = new Vector3(
      centre.x + front.x * (spec.size[2] / 2 + MARKER_STANDOFF + RING_FORWARD) - right.x * RING_LEFT,
      spec.baseY + spec.size[1] * MARKER_HEIGHT - RING_DROP,
      centre.z + front.z * (spec.size[2] / 2 + MARKER_STANDOFF + RING_FORWARD) - right.z * RING_LEFT,
    );
    const material = emissiveMaterial(RING_FRAGMENT, MARKER_VERTEX, {
      uCentre: { value: at },
      uSize: { value: new Vector2(RING_SIZE, RING_SIZE) },
      uCore: { value: new Vector3(...INK_CORE) },
      uHalo: { value: new Vector3(...INK_HALO) },
      uIntensity: { value: RING_GAIN },
    });
    const ring = new Mesh(quad, material);
    ring.frustumCulled = false;
    ring.name = 'marker-ring-05';
    meshes.push(ring);
    pulses.push({
      id: '05', material, phase: 2.5, depth: 0.14, base: RING_GAIN, size: RING_SIZE,
    });
  }

  return {
    meshes,

    /** Lays the engraving of one section onto its block. */
    setEngraving(id, texture) {
      const block = blocks.get(id);
      if (block) block.material.uniforms.tInk.value = texture;
    },

    /** Distance from the reference camera, which is what sizes the engraving. */
    faceCentre(id) {
      const block = blocks.get(id);
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

    update(elapsed) {
      for (const pulse of pulses) {
        const lit = focus.get(pulse.id)?.value || 0;
        const depth = (pulse.depth === undefined ? MARKER_PULSE.depth : pulse.depth)
          + FOCUS_PULSE * lit;
        pulse.material.uniforms.uIntensity.value = pulse.base * (1 + FOCUS_MARKER * lit)
          * (1 + depth * Math.sin(elapsed * (Math.PI * 2 / MARKER_PULSE.period) + pulse.phase));
        const size = pulse.size * (1 + FOCUS_SIZE * lit);
        pulse.material.uniforms.uSize.value.set(size, size);
      }
    },
  };
}
