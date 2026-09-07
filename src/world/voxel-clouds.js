import {
  BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector2, Vector3,
} from 'three';
import SKY from '../../assets-src/sky/sky.json' with { type: 'json' };
import { SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS, SKY_UNIFORMS } from '../core/sky.js';
import { FOG_GLSL, fogUniforms } from './air.js';
import {
  CUBE_DEG, SHAPE, beyondRoster, buildCloudField, cloudShadowMask, shadowAt,
} from './cloud-field.js';

// THE WEATHER, AS BODIES OF CUBES.
//
// ===========================================================================
// WHAT STOOD HERE, AND WHY NONE OF IT COULD BE AMENDED.
//
// src/world/clouds.js drew a hundred and twenty-three QUADS, each carrying a
// piece of the reference's own photograph cut in the tangent plane of its own
// bearing. It was a careful thing and it is gone, because R4 measured three
// defects in it that are all the same defect:
//
//   1. EVERY PLATE STOOD ON ONE SPHERE, at nine hundred metres (`DISTANCE`).
//      So there was no depth: the great mass and the wisp over the crest were
//      the same distance away, plates near in bearing lay on one plane and the
//      premultiplied blend fused them, and twenty-three plates in the frame
//      drew THREE connected masses where the reference has ten.
//   2. THE CUBE IN THE PICTURE WAS NOT ONE CUBE. A tile cut at 0.05 degrees a
//      texel and stood at scales from 0.62 to 2.43 carries a cube of 0.21 to
//      0.60 degrees; measured in the frame, 41 to 45 px across and 13 to 15
//      down against the reference's 12.3 to 13.5 in both. A photograph of
//      cubes cut at one scale and stood at eight is a photograph of eight
//      different cubes.
//   3. A PHOTOGRAPH CARRIES ITS OWN LIGHT IN ITS PIXELS. Half the placements
//      were mirrored, so the reference's masses -- brighter on their west
//      flanks, every one of them -- came out lit from the left on one side of
//      the frame and from the right on the other. Relighting a plate was tried
//      and turned off in the file that did it, with a measurement: it scrapes
//      creases, it does not move a light.
//
// None of the three is a parameter. They are what a plate IS, and the cure for
// all three is the same: draw the cloud as bodies, with normals, at their own
// distances.
//
// ===========================================================================
// WHAT THIS IS.
//
// A field of density per mass -- a flat base with a crown of heads, eroded by
// three octaves of noise -- thresholded onto a grid of cubes whose SIDE GROWS
// WITH THE DISTANCE, s = D * tan(0.64 degrees), so that the cube subtends the
// reference's own angle at every distance; greedy-meshed into ONE geometry and
// ONE draw; and lit by the seal's own sun on the faces' own normals, with the
// air of src/world/air.js in front of it. The arithmetic is all in
// src/world/cloud-field.js, which knows nothing of three.js, so a guard can lay
// the same sky offline and count the same pixels.
//
// It costs NO BYTES. The roster is forty-three rows of JSON inside
// assets-src/sky/sky.json and the field is built at load; the plates cost
// 2.24 MB of KTX2, which left the delivery with them.
//
// ===========================================================================
// AND IT DOES NOT WRITE DEPTH, WHICH IS NOT A CHOICE.
//
// The composite pass tells the sky from the world by the depth buffer: what
// stands at the far plane is sky and gets the sky's LUT, everything else gets
// the scene's grade. An opaque cloud that writes depth is therefore graded as
// STONE -- measured on the prototype, and the way it shows is that more sun
// makes the cloud DARKER. So the weather is drawn exactly as the plates were:
// after the dome, transparent, depth test on, depth WRITE off. What that costs
// and what pays it is the note over the painter's order in cloud-field.js.

const DEG = Math.PI / 180;

/** The weather's own section of the sky preset. */
export const CLOUDS = SKY.clouds;

/** The eye the roster was read from: the fitted pose, as the file states it. */
const READ_EYE = CLOUDS.read.eye;

// HOW FAST, AND IN METRES A SECOND (E-DECISIONI21 D9 = A).
//
// The plates turned: 0.07 degrees a second of rigid rotation about the
// vertical, the whole field together, with the excursion held by a tanh so it
// could never wander away from the composition it was cut for. A field with
// real distances in it does not need any of that. Three metres a second from
// the west is 0.29 degrees a minute at six hundred metres and 0.18 at nine
// hundred and fifty, which is the PARALLAX OF THE WIND for nothing: the near
// masses cross the frame faster than the far ones, which is what weather does
// and what one rotation cannot say at any rate.
//
// The roster is the state at t nought, so ?t0 -- which every measurement of
// this campaign is taken behind -- is the reference's own composition, exact.
export const WIND = new Vector3(...CLOUDS.wind);

/**
 * Every mass in the sky: the reference's own, and the rest of the compass.
 *
 * @param {object} [opts] `beyond` false leaves the bearings the reference never
 *   showed empty, which is a development view and never the world.
 */
export function roster({ beyond = true } = {}) {
  const seen = CLOUDS.masses;
  return beyond ? [...seen, ...beyondRoster(seen, CLOUDS.beyond)] : [...seen];
}

// ---------------------------------------------------------------- the light
//
// THE SAME LAW THE WORLD'S FACES ARE LIT BY, on a normal the geometry carries:
// the sun's cosine, the sky's share of the hemisphere, and one term for the
// light that has been inside the cloud -- which is what makes a cloud a cloud
// and not a white rock. `uSunLight` and `uSkyLight` are the seal's own pair,
// shared BY REFERENCE with the ground and the stone, so an evening moves the
// weather with the meadow and there is no second sun to forget.
//
// THE TERMS ARE LARGE (see `terms` in sky.json) and that is physics, not a
// fudge. The scene's light is fitted for grass at albedo 0.27 to 0.45 under an
// exposure of 1.25; a cloud at the sun is two and a half to five times brighter
// than lit grass, and has to reach a radiance of three to four to develop to
// L* 87 through AgX. The plates did the same thing with `uLevel` 4.50.
const CLOUD_VERTEX = /* glsl */`
  attribute float aCube;
  uniform float uTime;
  uniform vec3 uWind;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vCube;
  varying float vDistance;
  varying float vHeight;
  void main() {
    vec3 world = position + uWind * uTime;
    vNormal = normal;
    vWorld = world;
    vCube = aCube;
    vHeight = world.y;
    vDistance = length(cameraPosition - world);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const CLOUD_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vCube;
  varying float vDistance;
  varying float vHeight;
  uniform vec3 uCloudSun;
  uniform vec3 uCloudTerms;
  uniform vec2 uOcc;
  uniform float uAlbedo;
  uniform float uGrain;
  uniform float uEdge;
  uniform float uTime;
  uniform vec3 uWind;
  ${SCENE_LIGHT_GLSL}
  ${FOG_GLSL}

  float cloudHash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 n = normalize(vNormal);
    float sun = max(dot(n, uCloudSun), 0.0);
    float up = 0.5 + 0.5 * n.y;
    // How much sky a face sees, with a FLOOR: the underside of a cumulus is lit
    // by the sky at the sides and by what comes back off the ground, and a
    // hemisphere term alone takes it to nothing.
    float sky = uOcc.y + (1.0 - uOcc.y) * up;
    // And the mass's own shadow on itself: the base is the thick part.
    float occ = uOcc.x + (1.0 - uOcc.x) * up;
    vec3 light = (uSunLight * (sun * uCloudTerms.x + uCloudTerms.z)
      + uSkyLight * (sky * uCloudTerms.y)) * occ;

    // THE CUBE, INSIDE THE FACE. The mesher fuses coplanar faces into one
    // rectangle -- which is the whole of why this is one draw -- and a fused
    // face has no cube in it, while in the reference every cube reads (R4
    // §1.4). So the cube comes back here: a hash per cell for the grain, and
    // one darker row where a fused face crosses from one cube to the next,
    // taken to the width of a pixel by fwidth so it neither aliases nor
    // thickens as the mass comes closer.
    vec3 q = (vWorld - uWind * uTime) / vCube;
    vec3 cell = floor(q - n * 0.5);
    float grain = (cloudHash(cell) - 0.5) * 2.0 * uGrain;
    vec3 fr = abs(fract(q) - 0.5);
    vec3 inPlane = vec3(1.0) - abs(n);
    float toEdge = 0.5 - max(max(fr.x * inPlane.x, fr.y * inPlane.y), fr.z * inPlane.z);
    float px = fwidth(q.x + q.y + q.z);
    float edge = 1.0 - uEdge * (1.0 - smoothstep(0.0, max(0.04, px * 1.5), toEdge));

    vec3 colour = vec3(uAlbedo) * (1.0 + grain) * edge * light;
    // AND THE SAME AIR AS EVERY OTHER DISTANT THING. Not a veil of its own:
    // src/world/air.js is the seat, its two terms are fitted per channel
    // against the reference's own hills, and a cloud at six hundred metres is
    // exactly the kind of distance those terms were solved on.
    colour = throughAir(colour, vDistance, vHeight);
    gl_FragColor = vec4(colour, 1.0);
  }
`;

/**
 * Hangs the weather.
 *
 * @param {object} [opts] `beyond` fills the compass the reference never showed;
 *   `wind` overrides the drift for a bench.
 */
export function createVoxelClouds({ beyond = true, wind = null, frozen = false } = {}) {
  const built = performance.now();
  const masses = roster({ beyond });
  const shape = { ...SHAPE, ...(CLOUDS.shape || {}) };
  const field = buildCloudField(masses, {
    cubeDeg: CLOUDS.cubeDeg ?? CUBE_DEG, shape, eye: READ_EYE,
  });
  const buildMs = performance.now() - built;

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(field.positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(field.normals), 3));
  geometry.setAttribute('aCube', new BufferAttribute(new Float32Array(field.cube), 1));
  geometry.setIndex(new BufferAttribute(field.index, 1));
  geometry.computeBoundingSphere();

  const terms = CLOUDS.material;
  const material = new ShaderMaterial({
    uniforms: {
      ...SCENE_LIGHT_UNIFORMS,
      ...fogUniforms(),
      uTime: { value: 0 },
      uWind: { value: (wind ? new Vector3(...wind) : WIND.clone()) },
      uCloudSun: { value: new Vector3().copy(SKY_UNIFORMS.uSunDir.value).normalize() },
      uCloudTerms: { value: new Vector3(...terms.terms) },
      uOcc: { value: new Vector2(...terms.occlusion) },
      uAlbedo: { value: terms.albedo },
      uGrain: { value: terms.grain },
      uEdge: { value: terms.edge },
    },
    vertexShader: CLOUD_VERTEX,
    fragmentShader: CLOUD_FRAGMENT,
    fog: false,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'voxel-clouds';
  // Drawn where the plates were drawn: first of the transparent things, which
  // is after every opaque one, the dome included.
  mesh.renderOrder = -1;
  // One draw, and never nought: the field surrounds the walker, so its bounding
  // sphere contains the camera and a frustum test on it answers nothing useful.
  mesh.frustumCulled = false;

  let seconds = 0;
  let still = frozen;
  const t0 = performance.now();
  mesh.onBeforeRender = () => {
    if (!still) seconds = (performance.now() - t0) / 1000;
    material.uniforms.uTime.value = seconds;
  };

  // THE SEAT FOR THE SHADOW ON THE MEADOW (E-DECISIONI21 D5 = A), and only the
  // seat: the term that reads it belongs to the ground's own fragment, which is
  // not this unit's to write. See SHADOW in cloud-field.js for the geometry.
  let mask = null;
  const remask = () => {
    const drift = material.uniforms.uWind.value;
    const t = material.uniforms.uTime.value;
    const moved = {
      ...field,
      positions: field.positions.map((v, i) => (i % 3 === 0 ? v + drift.x * t
        : i % 3 === 1 ? v + drift.y * t : v + drift.z * t)),
    };
    mask = cloudShadowMask(moved, SKY_UNIFORMS.uSunDir.value.toArray(), CLOUDS.shadow);
    return mask;
  };

  const api = {
    mesh,
    material,
    masses: masses.length,
    quads: field.quads,
    triangles: field.triangles,
    cubes: field.cubes,
    buildMs: +buildMs.toFixed(1),
    draws: 1,
    bytes: 0,

    /** Where the weather is at, in seconds since it was hung. */
    seconds() { return seconds; },
    /** Development handle: put the weather at a stated second and hold it. */
    setSeconds(value) { seconds = value; still = true; material.uniforms.uTime.value = value; return value; },
    freeze(value) { still = value; if (value) { seconds = 0; material.uniforms.uTime.value = 0; } },
    setVisible(value) { mesh.visible = value; },
    setWind(x, y, z) { material.uniforms.uWind.value.set(x, y, z); mask = null; },
    setTerms(x, y, z) { material.uniforms.uCloudTerms.value.set(x, y, z); },
    setOcc(a, b) { material.uniforms.uOcc.value.set(a, b); },
    setAlbedo(a) { material.uniforms.uAlbedo.value = a; },
    setGrain(g) { material.uniforms.uGrain.value = g; },
    setEdge(e) { material.uniforms.uEdge.value = e; },
    /**
     * Turns the weather's own sun off the seal's by a stated bearing.
     *
     * D-R4-2 is open: the seal stands at 274 and the reference's masses are lit
     * on their FRONTS, which wants something nearer 255. Until the committente
     * answers, this is a handle and nought is what ships.
     */
    setSunAz(deltaDeg) {
      const s = SKY_UNIFORMS.uSunDir.value;
      const a = deltaDeg * DEG;
      material.uniforms.uCloudSun.value.set(
        s.x * Math.cos(a) - s.z * Math.sin(a), s.y, s.x * Math.sin(a) + s.z * Math.cos(a),
      ).normalize();
      return material.uniforms.uCloudSun.value.toArray();
    },

    /** The cloud shadow on the ground, as a mask, for whoever reads it. */
    shadowMask() { return mask || remask(); },
    /** How much cloud shadow stands over a point of the meadow, 0 to 1. */
    cloudShadowAt(x, z) { return shadowAt(mask || remask(), x, z); },
    /** Recomputes the mask where the wind has taken the field. */
    updateShadow() { return remask(); },

    update() {},
  };
  if (typeof window !== 'undefined') window.vclouds = api;
  return api;
}
