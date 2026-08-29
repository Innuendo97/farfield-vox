import {
  BufferAttribute, BufferGeometry, Matrix3, Matrix4, Mesh, ShaderMaterial, Vector3,
} from 'three';
import {
  SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS, SKY_GLSL, SKY_REFLECTION,
  SKY_REFLECTION_GLSL, SKY_UNIFORMS,
} from '../core/sky.js';
import {
  BAKED_TERMS_GLSL, FOG_GLSL, fogUniforms, GROUND_EXPOSURE, LOW_SKY,
} from './air.js';
import PLAN from '../../assets-src/rocks/rocks.json' with { type: 'json' };
import BAKE from '../../assets-src/rocks/rocks-bake.json' with { type: 'json' };
import PALETTE from '../../assets-src/vegetation/palette.json' with { type: 'json' };

// The rocks.
//
// Two of them do a job nothing else in the scene does: in the reference a dark
// mass fills the bottom left corner and a group of boulders fills the bottom
// right, and between them they close the composition at the near edge. Their
// positions are not a matter of taste — the pixels they occupy were traced back
// through the reference camera onto the meadow by tools/vegetation/plan-rocks.
//
// Same contract as everything else that stands on this ground: a reflectance, a
// Cycles bake of the light on it, one multiply and one fog. What is different
// is where the reflectance comes from. There is no albedo sheet for the rocks,
// because a rock has no seams and no writing on it and its colour is decided by
// two things the shape already knows: which way a piece of surface is facing,
// and how close to the grass it is. Moss grows on what looks up and low down;
// bare stone is what is left. That is one procedure instead of a megabyte of
// texture, and it also means the moss can be moved without a re-bake.

/** Where the rocks stand, for whoever needs to know: the vegetation, the walker. */
export const ROCKS = PLAN.rocks.map((rock) => ({
  name: rock.name,
  role: rock.role,
  x: rock.x,
  z: rock.z,
  y: rock.y,
  radius: rock.radius,
  height: rock.height,
}));

/** The ones solid enough that walking through them would be a hole in the world. */
export const ROCK_BLOCKERS = ROCKS
  .filter((rock) => rock.radius >= 0.45)
  .map((rock) => ({
    x: rock.x,
    z: rock.z,
    // A square inside the round: a blocker is a box, and one that reached the
    // full radius would stop the walker in the air beside the stone.
    halfWidth: rock.radius * 0.72,
    halfDepth: rock.radius * 0.72,
    rotationY: 0,
  }));

function albedoOf(id) {
  const found = PALETTE.patches.find((patch) => patch.id === id);
  if (!found) throw new Error(`vegetation palette has no patch "${id}"`);
  return found.albedo;
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Measured off the reference: the lit crown of the big boulder in the bottom
// right corner, and the olive rim beside it. The moss is pulled a little
// towards the meadow's own green, because the one patch of it the reference
// leaves out of shadow is a thin lichen film over stone rather than the deeper
// moss the shoulders of these rocks carry.
// The pale weathered crust that catches the light on the upper faces, and the
// darker, cooler body under it. The reference draws both on the same boulder,
// and drawing only one of them is what makes a rock read as a lump of clay:
// with a single reflectance the bake's own shading is all the contrast there
// is, and under a sun this soft that is almost none.
const CRUST = albedoOf('rock-lit-crown');
const STONE = [CRUST[0] * 0.58, CRUST[1] * 0.61, CRUST[2] * 0.70];
const MOSS = mix(albedoOf('rock-moss-rim'), albedoOf('grass-lit-band'), 0.45);

// How much of the sky a rock carries. Far under the blocks': the stone of the
// reference is polished and these are not, and what this has to produce is only
// the cool cast the shaded side of a boulder takes from an open sky.
const ROCK_F0 = 0.008;
const ROCK_RIM = 0.26;
const SKY_BLUR = 4.0;

const VERTEX = /* glsl */`
  attribute float aFoot;      // world height of the ground this rock stands on

  varying vec2 vLight;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vFoot;
  varying float vDistance;

  void main() {
    vLight = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vFoot = aFoot;
    vDistance = length(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */`
  precision highp float;

  varying vec2 vLight;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vFoot;
  varying float vDistance;

  uniform sampler2D tLight;
  uniform float uLightScale;
  uniform float uSkyBlur;
  uniform float uF0;
  uniform float uRim;
  uniform vec3 uStone;
  uniform vec3 uCrust;
  uniform vec3 uMoss;
  uniform vec3 uLowSky;

  ${SCENE_LIGHT_GLSL}
  ${BAKED_TERMS_GLSL}
  ${SKY_GLSL}
  ${SKY_REFLECTION_GLSL}
  ${FOG_GLSL}

  // Value noise on an integer lattice, the same shape as the one the ground is
  // shaped with. Written out here rather than sampled from a texture: two
  // octaves of this are a few dozen instructions on a surface that covers a
  // twentieth of the frame, and a texture would be a download, a bind and a set
  // of texture coordinates a rock has no natural way to carry.
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i + vec3(0, 0, 0)), hash3(i + vec3(1, 0, 0)), f.x),
          mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
          mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }

  void main() {
    vec3 normal = normalize(vNormal);
    float coarse = noise3(vWorld * 3.20);
    float fine = noise3(vWorld * 15.0);

    // Moss takes what looks up, and takes more of it near the grass. The noise
    // goes into the test rather than onto the result, so the edge of a patch
    // wanders across the stone instead of fading out of it.
    float up = clamp(normal.y, 0.0, 1.0);
    float low = 1.0 - smoothstep(0.05, 0.55, vWorld.y - vFoot);
    float moss = smoothstep(0.74, 1.16, up * (0.62 + 0.76 * coarse) + low * 0.20);
    moss *= 0.40 + 0.38 * fine;

    // The grain of the stone itself, which the facets alone are too coarse to
    // carry.
    float grain = 0.86 + 0.26 * fine + 0.20 * (coarse - 0.5);

    // The weathered crust. It takes the faces that stand out into the weather —
    // upward and outward — and it is broken along the same noise the moss uses,
    // so the two never share an edge.
    // A wide ramp on purpose. Narrow, it cuts the crust into patches with hard
    // rims and the rock comes out looking painted with camouflage; the
    // reference has one continuous fall from a pale crown to a dark flank.
    float crust = smoothstep(0.10, 1.05, up * 0.60 + 0.42 + 0.7 * (coarse - 0.5));
    vec3 albedo = mix(uStone, uCrust, crust) * grain;
    albedo = mix(albedo, uMoss * (0.86 + 0.28 * fine), moss);

    // Red is how much of the sun this texel sees, green how much of the sky.
    // What used to stand here was a per rock multiplier carrying the cloud
    // shadow the meadow was under, because the bake lit these under an open sky
    // while a painted cloud darkened the ground around them. Both halves of
    // that are gone: the cloud was never over this hub — the sky in the sun's
    // direction is 0.000 covered — and the ground no longer carries it either.
    vec3 light = bakedLight(bakedTerms(tLight, vLight)) * uLightScale;
    vec3 colour = albedo * light;

    // The sky in it. One blurred tap, weighted towards the grazing angles, and
    // the pale air of the horizon below the elevation where a rock reflects
    // along it — the same pair of numbers the blocks were fitted with.
    vec3 view = normalize(vWorld - cameraPosition);
    vec3 mirrored = reflect(view, normal);
    vec3 sky = skyReflection(mirrored, uSkyBlur);
    sky = mix(uLowSky, sky, smoothstep(0.12, 0.38, mirrored.y));
    float fresnel = uF0 + uRim * pow(1.0 - clamp(dot(-view, normal), 0.0, 1.0), 5.0);
    colour += sky * fresnel * (1.0 - moss * 0.6);

    colour = mix(colour, uFogColour, fogAmount(vDistance, vWorld.y));
    gl_FragColor = vec4(colour, 1.0);
  }
`;

/**
 * Every rock as one mesh.
 *
 * They arrive from the exporter as ten objects with ten transforms, and drawn
 * that way they would be ten draw calls for nine thousand triangles that share
 * one material and one light atlas. So the transforms are folded into the
 * vertices here and the lot is welded into a single buffer. The height of the
 * ground under each one rides along as a vertex attribute, because that is what
 * the moss is measured from and it is the only thing that differs between them.
 */
function mergeRocks(loaded) {
  const parts = [];
  for (const rock of PLAN.rocks) {
    const found = loaded.getObjectByName(rock.name);
    if (!found || !found.geometry || !found.geometry.index) continue;
    found.updateWorldMatrix(true, false);
    parts.push({ object: found, foot: rock.ground });
  }
  if (parts.length === 0) return null;

  let vertexCount = 0;
  let indexCount = 0;
  for (const part of parts) {
    vertexCount += part.object.geometry.attributes.position.count;
    indexCount += part.object.geometry.index.count;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const feet = new Float32Array(vertexCount);
  const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

  const point = new Vector3();
  const matrix = new Matrix4();
  const normalMatrix = new Matrix3();
  let vertexAt = 0;
  let indexAt = 0;

  for (const part of parts) {
    const geometry = part.object.geometry;
    const { position, normal, uv } = geometry.attributes;
    const index = geometry.index;
    matrix.copy(part.object.matrixWorld);
    normalMatrix.getNormalMatrix(matrix);

    // Read through the accessors rather than off the raw buffers. The transport
    // format quantises what it can — positions into shorts, normals into bytes,
    // all of it interleaved — so the underlying arrays are neither floats nor
    // laid out three to a vertex, and copying them wholesale is how this ended
    // up reading past the end of one.
    for (let i = 0; i < position.count; i++) {
      point.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(matrix);
      positions[(vertexAt + i) * 3] = point.x;
      positions[(vertexAt + i) * 3 + 1] = point.y;
      positions[(vertexAt + i) * 3 + 2] = point.z;

      point.set(normal.getX(i), normal.getY(i), normal.getZ(i))
        .applyMatrix3(normalMatrix).normalize();
      normals[(vertexAt + i) * 3] = point.x;
      normals[(vertexAt + i) * 3 + 1] = point.y;
      normals[(vertexAt + i) * 3 + 2] = point.z;

      uvs[(vertexAt + i) * 2] = uv.getX(i);
      uvs[(vertexAt + i) * 2 + 1] = uv.getY(i);
      feet[vertexAt + i] = part.foot;
    }
    for (let i = 0; i < index.count; i++) indices[indexAt + i] = index.getX(i) + vertexAt;
    vertexAt += position.count;
    indexAt += index.count;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('aFoot', new BufferAttribute(feet, 1));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

// What a world with no rocks in it answers to. It has to answer to everything
// the built one does, or a caller that reaches the scene before the sheets do
// has to know which of the two it is holding.
function noRocks() {
  return { meshes: [], triangles: 0 };
}

/**
 * The rocks, as one mesh with one material.
 *
 * @param {object} assets  the loaded glTF scene, the rock light atlas, the sky
 */
export function createRocks({
  rocks: loaded, rockLight: light, lightScale = BAKE.lightScale,
}) {
  if (!loaded || !light) return noRocks();

  const geometry = mergeRocks(loaded);
  if (!geometry) return noRocks();

  const material = new ShaderMaterial({
    uniforms: {
      tLight: { value: light },
      uLightScale: { value: lightScale * GROUND_EXPOSURE },
      ...SCENE_LIGHT_UNIFORMS,
      ...SKY_UNIFORMS,
      ...SKY_REFLECTION,
      uSkyBlur: { value: SKY_BLUR },
      uF0: { value: ROCK_F0 },
      uRim: { value: ROCK_RIM },
      uStone: { value: new Vector3(...STONE) },
      uCrust: { value: new Vector3(...CRUST) },
      uMoss: { value: new Vector3(...MOSS) },
      uLowSky: { value: new Vector3(...LOW_SKY) },
      ...fogUniforms(),
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: false,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'rocks';
  return {
    meshes: [mesh],
    triangles: geometry.index.count / 3,
  };
}
