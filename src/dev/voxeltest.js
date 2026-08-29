import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DataTexture, DoubleSide, Mesh,
  PerspectiveCamera, RGBAFormat, SRGBColorSpace, Scene, ShaderMaterial, Sphere,
  UnsignedByteType, Vector2, Vector3,
} from 'three';
import { Renderer } from '../core/renderer.js';
import { Loop } from '../core/loop.js';
import { Input } from '../core/input.js';
import { Player } from '../core/player.js';
import { Assets } from '../core/assets.js';
import { loadSection, setContentBase } from '../core/content.js';
import { loadLut } from '../core/post.js';
import { createQuality } from '../core/quality.js';
import { DEFAULT_FOV, POSE_TARGET } from '../core/poses.js';
import {
  SCENE_LIGHT_UNIFORMS, SKY_UNIFORMS, applySky, setSceneLight, setSkyPreset,
} from '../core/sky.js';
import { setAir } from '../world/air.js';
import { createTerrain } from '../world/terrain.js';
import { createVegetation } from '../world/vegetation.js';
import { engrave, loadEngravingFont } from '../world/engraving.js';
import { AREA_CENTER, MONOLITHS } from '../world/layout.js';
import { heightAt } from '../world/terrain-field.js';
import { createDevHud } from '../ui/devhud.js';
// THE ENGINE THROUGH ITS OWN DOOR. This bench used to reach into three files
// of it by name; the engine is now src/world/voxel/ and everything comes
// through the one surface that is frozen in the foundation, which is what makes
// this bench a test OF that surface rather than a second user of the insides.
import {
  CHUNK, DISC_RADIUS, NO_COLUMN, VOXEL,
  createMasonry, runInWorker, stoneTile, voxelMaterial, voxelSettings,
} from '../world/voxel/index.js';
import SKY from '../../assets-src/sky/sky.json' with { type: 'json' };
import SCENE_LIGHT from '../../assets-src/sky/scene-light.json' with { type: 'json' };
import TERRAIN from '../../assets-src/terrain/terrain.json' with { type: 'json' };

// THE MINI-DEMO: one corner of the hub, built the way the recommended lane
// would build the whole world.
//
// It is a GATE and not an appetiser. Everything in it that could fail is in it:
// the pose nobody has measured, the pose the committente has to decide the
// first person from, the block with the delivered engraving on it, the paving
// that must survive untouched, and the ten numbers declared before anything was
// measured rather than after.
//
// WHAT IS IN THE CORNER, and why each piece is there:
//
//   the paving      TEXTURED AND NOT VOXEL. The forensics are flat: the
//                   reference's path has no vertical faces at all — its "step"
//                   of 8.3 cm is the size of a texel. So it is drawn by the
//                   delivered ground material, unmodified, and the meadow grows
//                   up to both banks of it. That is also the proof S3's paving
//                   survives the pivot instead of a promise that it would.
//   the meadow      voxel, one step of ten centimetres, on a disc of fourteen
//                   metres, with the tuft correlated at thirty.
//   the grass       src/world/vegetation.js UNCHANGED, planted on the cube
//                   tops. It is exactly in the close first person that the
//                   question is whether cards rescue a bare cube, so the cards
//                   have to be there and have to be the delivered ones.
//   the block       monolith 05, generated as courses of masonry, carrying the
//                   engraving src/world/engraving.js draws with not one line
//                   changed.
//   the sky         applySky() as it is. No asset, no change, no second sky.
//   one cloud       a plate with a silhouette of cubes, because the parallax
//                   across the walkable disc is under three degrees and a real
//                   cube would be indistinguishable from a picture of one.

const canvas = document.getElementById('stage');
const ui = document.getElementById('ui');
const query = new URLSearchParams(window.location.search);

// How far this bench lays the disc, in metres.
//
// THE BENCH ASKS FOR IT RATHER THAN INHERITING IT, because it is a bench: it
// has no quality tier to read and its whole job is to price a shape before the
// world is asked to hold it. The engine's own default answers when nobody says.
const RADIUS = Number(query.get('raggio')) > 0
  ? Number(query.get('raggio')) : DISC_RADIUS;

const renderer = new Renderer().init(canvas);
const camera = new PerspectiveCamera(DEFAULT_FOV, window.innerWidth / window.innerHeight, 0.1, 1400);
const scene = new Scene();
applySky(scene);

// ---------------------------------------------------------------- the field
//
// STARTED BEFORE ANYTHING ELSE IS ASKED FOR, and that is the whole point of it
// being a worker. The disc is fifty five thousand columns and one height costs
// 926 ns, so this is tens of milliseconds of arithmetic that must not be on the
// thread the walker is on. It goes out now so it runs down the same wire time
// the textures are using.

const settings = voxelSettings();
const material = voxelMaterial(VOXEL, settings);

// What the worker cuts besides the disc, and how long each of the three took
// where it now runs. They are timed one by one because the eight millisecond
// gate is about what holds the main thread, and a long task nobody has split up
// is an argument rather than a measurement: the tile alone was 93.6 ms here
// before it moved, and nothing in a profile said so until it was timed apart
// from the load around it.
const boot = { tileMs: 0, masonryMs: 0 };
let stone = null;
let masonry = null;
const chunks = [];
// Every chunk's own height map, by its chunk key: what the walker stands on and
// what the grass is planted on.
const tops = new Map();
const build = {
  planned: 0,
  landed: 0,
  quads: 0,
  columns: 0,
  rim: 0,
  quadsPerColumn: 0,
  insidePerColumn: 0,
  workerMs: 0,
  // The main thread's own share, which is what the eight millisecond gate is
  // about: the longest single task this page ran while the disc was arriving.
  worstTaskMs: 0,
  worstTaskKind: '',
  // The disc's own answer, kept apart from the one-off handovers of the tile
  // and the block. The eight millisecond gate was declared about the
  // VOXELISATION — fifty five thousand columns of field at 926 ns each — and
  // mixing a boot task into it would answer a question nobody asked with a
  // number about something else.
  worstChunkMs: 0,
  uploadMs: 0,
  bytes: 0,
  startedAt: performance.now(),
  finishedAt: 0,
};

const chunkKey = (cx, cz) => `${cx},${cz}`;

/**
 * Height of the cube tops under a point, or the field itself where there is no
 * cube — on the paving, inside the block's footprint, and off the disc.
 *
 * The walker stands on THIS and not on the field, which is the only honest
 * answer once the ground is cubes: a body walking on the smooth field would
 * sink into every tuft and float over every hollow, and the first thing the
 * committente would feel is a floor that disagrees with the picture.
 */
function voxelHeightAt(x, z) {
  const ix = Math.floor(x / VOXEL);
  const iz = Math.floor(z / VOXEL);
  const cx = Math.floor(ix / CHUNK);
  const cz = Math.floor(iz / CHUNK);
  const map = tops.get(chunkKey(cx, cz));
  if (map) {
    const top = map[(iz - cz * CHUNK) * CHUNK + (ix - cx * CHUNK)];
    if (top !== NO_COLUMN) return (top + 1) * VOXEL;
  }
  return heightAt(x, z);
}

function addChunk(chunk) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(chunk.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(chunk.normals, 3, true));
  geometry.setIndex(new BufferAttribute(chunk.indices, 1));
  // The box comes from the worker rather than being walked again here. It has
  // to exist — it is what lets the frustum throw a chunk away, and the whole
  // draw-call argument for chunking is that a wedge of seventy degrees only
  // asks for a few of them — but walking twenty thousand vertices for it was
  // the single longest thing this thread did while the disc arrived.
  geometry.boundingSphere = new Sphere(
    new Vector3(chunk.sphere.x, chunk.sphere.y, chunk.sphere.z), chunk.sphere.radius,
  );
  // AND THE JAVASCRIPT COPY GOES. three.js keeps the array beside the buffer
  // for ever unless it is told not to, which on this disc is a second copy of
  // every vertex sitting in the heap doing nothing. No corridor of the dossier
  // costed it; it is two lines.
  for (const name of ['position', 'normal']) {
    geometry.attributes[name].onUpload(function drop() { this.array = null; });
  }
  geometry.index.onUpload(function drop() { this.array = null; });

  const mesh = new Mesh(geometry, material);
  mesh.name = `voxel-${chunk.cx},${chunk.cz}`;
  // Where the chunk stands, as a whole number of voxels. The material reads it
  // straight off this matrix, which is why nothing per chunk has to be a
  // uniform and why one material can serve the whole disc.
  mesh.position.set(chunk.cx * CHUNK * VOXEL, 0, chunk.cz * CHUNK * VOXEL);
  scene.add(mesh);
  chunks.push(mesh);
  tops.set(chunkKey(chunk.cx, chunk.cz), chunk.tops);
  build.bytes += chunk.positions.byteLength + chunk.normals.byteLength
    + chunk.indices.byteLength;
}

// The engine's own arithmetic, off the thread the walker is on, through the
// one seat that knows where the worker file is.
runInWorker({ tuft: query.get('ciuffo') !== '0', radius: RADIUS }, (message) => {
  // Timed from the first statement, because this handler IS the main thread's
  // share of the work and the gate is about how long it holds the frame.
  const started = performance.now();
  if (message.kind === 'tile') {
    stone = stoneTile(message.data, message.side);
    boot.tileMs = message.elapsedMs;
    if (masonry) masonry.material.uniforms.tStone.value = stone;
  } else if (message.kind === 'masonry') {
    boot.masonryMs = message.elapsedMs;
    masonry = createMasonry(message.id, stone, message.built);
    scene.add(masonry.mesh);
    engraveBlock();
  } else if (message.kind === 'plan') {
    build.planned = message.chunks;
  } else if (message.kind === 'chunk') {
    addChunk(message.chunk);
    build.landed++;
  } else if (message.kind === 'done') {
    Object.assign(build, {
      quads: message.quads,
      columns: message.columns,
      rim: message.rim,
      quadsPerColumn: message.quadsPerColumn,
      insidePerColumn: message.insidePerColumn,
      workerMs: message.elapsedMs,
      finishedAt: performance.now(),
    });
    plantWhenReady();
  }
  const spent = performance.now() - started;
  if (spent > build.worstTaskMs) {
    build.worstTaskMs = spent;
    build.worstTaskKind = message.kind;
  }
  if (message.kind === 'chunk' && spent > build.worstChunkMs) build.worstChunkMs = spent;
});

// -------------------------------------------------------------- the walker

const blockers = [];
for (const m of MONOLITHS) {
  if (m.id !== '05') continue;
  const [w, , d] = m.size;
  blockers.push({
    x: m.position.x,
    z: m.position.z,
    halfWidth: w / 2,
    halfDepth: d / 2,
    rotationY: m.rotationY * Math.PI / 180,
  });
}

const player = new Player().setGroundSampler(voxelHeightAt).setBlockers(blockers);
player.setPose(POSE_TARGET);
const input = new Input().attach(canvas);

// One cloud, as a plate with a silhouette of cubes.
//
// THE PARALLAX IS THE ARGUMENT. Across the whole walkable disc a bank at this
// height turns by under three degrees, so a plate and a real body of cubes are
// the same picture — and the reference's clouds are the ONE place in the whole
// frame where a face is not flat, which a cube would get wrong in the other
// direction. So the cubes are in the alpha and the geometry is a quad.
// Where the bank stands, and how big. Placed so it is IN the frame the campaign
// judges on rather than over the top edge of it: a piece the delivery crop does
// not contain is a piece nobody can decide about.
const CLOUD_HEIGHT = 118;
const CLOUD_SIZE = 340;

const CLOUD_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uColour;
  uniform float uLevel;
  uniform float uSeed;

  float cellHash(vec2 c) {
    return fract(sin(dot(c + uSeed, vec2(12.9898, 78.233))) * 43758.5453);
  }

  // A soft body, sampled at the CENTRE of a cell rather than at the fragment.
  // That is the whole trick and the reason this reads as cubes: the shape is
  // continuous, the sampling is not, so the silhouette comes out cut to the
  // grid exactly the way the reference's banks are — and the grid is the
  // cloud's own, not the screen's, so it holds still as the eye moves.
  float lobe(vec2 p, vec2 c, vec2 r) {
    return max(0.0, 1.0 - length((p - c) / r));
  }

  void main() {
    // How many cubes across the bank. The reference stacks them a good deal
    // finer than a plate of six boxes, which is what this was before and what
    // read as a white bar rather than as weather.
    vec2 grid = vec2(38.0, 15.0);
    vec2 cell = floor(vUv * grid);
    vec2 q = (cell + 0.5) / grid * 2.0 - 1.0;

    float body =
        lobe(q, vec2(-0.34, -0.30), vec2(0.62, 0.72)) * 1.00
      + lobe(q, vec2(0.06, -0.10), vec2(0.46, 0.86)) * 1.06
      + lobe(q, vec2(0.40, -0.34), vec2(0.40, 0.62)) * 0.94
      + lobe(q, vec2(-0.62, -0.52), vec2(0.30, 0.44)) * 0.86
      + lobe(q, vec2(0.66, -0.50), vec2(0.26, 0.40)) * 0.80
      + lobe(q, vec2(-0.10, 0.16), vec2(0.24, 0.40)) * 0.72;
    // A ragged rim rather than an ellipse of cubes: a cumulus is lumpy at its
    // edge and regular nowhere.
    body += (cellHash(cell) - 0.5) * 0.30;
    if (body < 0.62) discard;

    // Lit from above and behind, which is where this world's sun is: the crowns
    // take the light and the flat bottoms keep it off. Plus a little per-cube
    // spread, for the same reason the meadow has one.
    float lift = 0.56 + 0.44 * smoothstep(-0.75, 0.45, q.y)
      + 0.10 * (cellHash(cell + 17.0) - 0.5);
    // And the deepest cells sit back into the body of the bank.
    lift *= 0.80 + 0.20 * smoothstep(0.62, 1.25, body);
    gl_FragColor = vec4(uColour * uLevel * lift, 1.0);
  }
`;

const CLOUD_VERTEX = /* glsl */`
  varying vec2 vUv;
  uniform vec3 uCentre;
  uniform vec2 uSize;
  void main() {
    vUv = uv;
    vec3 toEye = cameraPosition - uCentre;
    vec3 right = normalize(vec3(-toEye.z, 0.0, toEye.x));
    vec3 world = uCentre + right * (position.x * uSize.x)
      + vec3(0.0, position.y * uSize.y, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

function plateGeometry() {
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

function cloudPlate(at, size, level) {
  const material = new ShaderMaterial({
    uniforms: {
      uCentre: { value: at },
      uSize: { value: new Vector2(size, size * 0.40) },
      uColour: { value: new Vector3(1.0, 1.02, 1.06) },
      uLevel: { value: level },
      uSeed: { value: at.x * 0.017 + at.z * 0.023 },
    },
    vertexShader: CLOUD_VERTEX,
    fragmentShader: CLOUD_FRAGMENT,
    transparent: true,
    depthWrite: false,
    // BOTH SIDES, and it is not a formality. The billboard builds its own basis
    // from the vector to the eye, so which way the quad's fixed winding ends up
    // facing depends on which side of the camera the body stands — and a
    // single-sided plate that lands back-facing is culled AFTER its draw call
    // has been issued. It cost nothing visible and every millisecond of the
    // blending it was being measured for. The delivered marker in
    // src/world/monoliths.js declares DoubleSide for exactly this reason.
    side: DoubleSide,
    fog: false,
  });
  material.userData.day = level;
  const mesh = new Mesh(plateGeometry(), material);
  mesh.name = 'cloud-plate';
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  scene.add(mesh);
  return { mesh, material };
}

// Two of them rather than one, and it is the same piece twice: what the pair
// shows is that the technique carries a SKY and not a prop. Both are plates,
// because a bank at this height turns by under three degrees across the whole
// walkable disc — a real body of cubes and a picture of one are the same
// picture, and the weather is the one place in this reference where a face is
// NOT flat, which a cube would get wrong in the other direction.
const clouds = [
  cloudPlate(new Vector3(-150, CLOUD_HEIGHT, -430), CLOUD_SIZE, 1.35),
  cloudPlate(new Vector3(210, CLOUD_HEIGHT * 1.25, -520), CLOUD_SIZE * 1.15, 1.28),
];
const cloud = clouds[0].mesh;

// ----------------------------------------------------------------- the night
//
// DERIVED, NOT DELIVERED. There is one preset in assets-src/sky/sky.json and
// one entry in scene-light.json, and both say `day`. So a night here is the
// same shape of preset with the sun under the horizon, more haze and a lower,
// bluer exposure — which is exactly the hook src/core/sky.js was built with,
// and it moves the dome, the ground, the stone and the air together because
// they all read the same two uniforms.
//
// THE ONE DISCIPLINE, AND IT IS NOT NEGOTIABLE: the engraving's own emissive
// does NOT move. The night reference measures the writing at 0.520x its own
// daylight — it dominates the night frame only because everything around it has
// collapsed, and a trigger that turned it up would be inventing the effect it
// is supposed to be reproducing. uInk is never touched below.
const NIGHT_ELEVATION = -8;
const NIGHT_AZIMUTH = SKY.day.sun.azimuth;

function presetAt(elevation, azimuth) {
  const e = elevation * Math.PI / 180;
  const a = azimuth * Math.PI / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
}

const NIGHT_SKY = {
  ...SKY.day,
  sun: { elevation: NIGHT_ELEVATION, azimuth: NIGHT_AZIMUTH,
    vector: presetAt(NIGHT_ELEVATION, NIGHT_AZIMUTH) },
  // More haze and a great deal less light, kept bluer than the day by taking
  // red down hardest: what is left after sunset is the sky's own scattering.
  tauMie: SKY.day.tauMie.map((v) => v * 1.7),
  exposure: [
    SKY.day.exposure[0] * 0.020,
    SKY.day.exposure[1] * 0.028,
    SKY.day.exposure[2] * 0.044,
  ],
  // Not a black night. The night reference is a MOONLIT blue with the ground
  // still legible under it, which is what an isotropic term is for: at nought
  // the world went to a silhouette and the only thing left in the frame was the
  // writing, which is precisely the reading the discipline forbids buying.
  ambient: 0.075,
  disc: { ...SKY.day.disc, level: 0 },
};

const NIGHT_SCENE_LIGHT = {
  ...SCENE_LIGHT.day,
  sunStrength: 0,
  skyStrength: SCENE_LIGHT.day.skyStrength * 0.145,
};

let night = false;

// THE LAMPS ARE OFF UNTIL ASKED FOR, AND THAT IS THE DISCIPLINE AND NOT A TASTE.
//
// The night was given a budget of +0.8 ms at its worst pose and the instruction
// that if it went over it came out and the reason was declared. Measured:
//
//   the preset alone (sun under the horizon, more haze, less exposure)  +0.45 ms
//   the preset plus this cluster of 192 additive quads               +13 to +28 ms
//
// So the half that passes stays on and the half that fails comes off. Both
// causes are measured rather than guessed: shrinking the halos to a seventh of
// their side takes +13.5 down to +1.8, which is the AREA, and the +1.4 that
// will not shrink away is 192 separate materials being bound one at a time —
// the naive shape. A lamp field belongs in ONE draw, the way the weather field
// in src/world/clouds.js already is. The demo did not build that, so it reports
// the number it has instead of the number it might have had.
let lampsWanted = false;

// The lamps, as the additive quads the recommendation said to price rather than
// assume. They are the only thing a night adds to the frame's fill, and they
// are put where the worst pose can stand in front of the whole cluster at once.
const LAMPS = [];
for (let i = 0; i < 24; i++) {
  const t = i / 24;
  const z = 11.5 - t * 17;
  const side = i % 2 === 0 ? 1 : -1;
  // At the height of a lamp's head and not at the height of its foot. At half a
  // metre the halos sat inside the grass and were invisible while still costing
  // every millisecond of blending they cost now — which would have been the
  // worst of both readings: a budget spent on something nobody can see.
  LAMPS.push(new Vector3(side * (1.9 + 0.35 * Math.sin(i * 2.1)), 1.45 + 0.12 * Math.sin(i), z));
}

const HALO_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uCore;
  uniform vec3 uHalo;
  uniform float uIntensity;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float d = length(p);
    float core = smoothstep(0.30, 0.0, d);
    float wash = smoothstep(1.0, 0.05, d);
    float amount = (core * 1.4 + wash * 0.5) * uIntensity;
    gl_FragColor = vec4(mix(uHalo, uCore, clamp(amount, 0.0, 1.0)) * amount, 1.0);
  }
`;

const haloMeshes = [];
{
  const geometry = plateGeometry();
  for (const at of LAMPS) {
    // Several quads a lamp on purpose: the reserve the dossier's adversary
    // raised is that overlapping additive halos are real blending bandwidth on
    // a float buffer with multisampling, and one quad a lamp would price a
    // cluster at a quarter of what it costs.
    for (let k = 0; k < 8; k++) {
      const material = new ShaderMaterial({
        uniforms: {
          uCentre: { value: at.clone().add(new Vector3(0, k * 0.06, 0)) },
          uSize: { value: new Vector2(1.5 + k * 0.42, 1.5 + k * 0.42) },
          // Warm, not cyan. The cyan of this world belongs to the ENGRAVING,
          // and the night reference lights its meadow with amber lamps against
          // it: making the lamps cyan too would erase the one contrast the
          // night frame is built on.
          uCore: { value: new Vector3(1.00, 0.72, 0.38) },
          uHalo: { value: new Vector3(0.70, 0.36, 0.12) },
          uIntensity: { value: 0.85 / (1 + k * 0.5) },
        },
        vertexShader: CLOUD_VERTEX,
        fragmentShader: HALO_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        // See the note over the cloud plate: a billboard is two-sided or it is
        // sometimes nothing at all.
        side: DoubleSide,
        fog: false,
      });
      const halo = new Mesh(geometry, material);
      halo.frustumCulled = false;
      halo.renderOrder = 8;
      halo.visible = false;
      scene.add(halo);
      haloMeshes.push(halo);
    }
  }
}

function setNight(on) {
  night = on;
  setSkyPreset(on ? NIGHT_SKY : SKY.day);
  setSceneLight(on ? NIGHT_SCENE_LIGHT : SCENE_LIGHT.day);
  for (const halo of haloMeshes) {
    halo.visible = on && lampsWanted && halo.userData.allowed !== false;
  }
  for (const c of clouds) c.material.uniforms.uLevel.value = on ? 0.05 : c.material.userData.day;
  // AND THE WRITING IS LEFT ALONE. See the note over NIGHT_ELEVATION: the only
  // way the engraving is allowed to dominate a night frame is by everything
  // else going dark, which is what the reference measures.
}

// ---------------------------------------------------------------- the pieces

let terrain = null;
let vegetation = null;
let engraved = false;
const wantedGrass = { grass: null };

const hub = {
  scene,
  setGrassQuality(grass) {
    wantedGrass.grass = grass;
    if (vegetation) vegetation.setQuality(grass);
  },
  setGrassVisible(visible) { if (vegetation) vegetation.setGrassVisible(visible); },
  setCloudsVisible(visible) { for (const c of clouds) c.mesh.visible = visible; },
  vegetationStats: () => (vegetation ? vegetation.stats() : null),
  update(elapsed, eye, delta = 0, pitchDegrees = 4.5) {
    if (eye) setAir(eye.y);
    if (vegetation && eye) vegetation.update(eye, delta, pitchDegrees);
  },
};

const quality = createQuality({ renderer, hub });
quality.start();
renderer.setTiming(true);

setContentBase(import.meta.env.BASE_URL);
const assets = new Assets(import.meta.env.BASE_URL).setRenderer(renderer);

// Only the pieces this corner actually draws, asked for by name. The demo adds
// NOTHING to the manifest: every id below is already in the delivery and
// already counted, so criticalBytes cannot move whatever this page does.
const WANTED = [
  'terrain-albedo', 'terrain-light', 'terrain-detail', 'terrain-path',
  'grass-atlas',
];

Promise.all(WANTED.map((id) => assets.load(id).catch((error) => {
  console.warn(`${id} not delivered: ${error.message}`);
  return null;
})))
  .then(() => {
    // The delivered ground, unmodified, and it is here for the paving.
    //
    // It also does the second job the recommendation gives it: beyond the disc
    // it IS the shell — one draw call over two hundred metres, already bent to
    // spend its resolution where the eye is, already carrying the air. No lane
    // proposed it and it is the cheapest piece of the whole plan.
    terrain = createTerrain({
      albedo: assets.get('terrain-albedo'),
      light: assets.get('terrain-light'),
      detail: assets.get('terrain-detail'),
      strip: assets.get('terrain-path'),
      lightScale: TERRAIN.lightScale,
      radius: RADIUS,
    });
    for (const mesh of terrain.meshes) scene.add(mesh);
    plantWhenReady();
  })
  .catch((error) => console.warn('corner not dressed:', error.message));

/**
 * The light the cards are handed, as the same producer the cubes are lit by.
 *
 * THE BRIDGE, AND IT IS THE CONTRACT AND NOT A CHANGE TO IT.
 * src/world/vegetation.js reads the ground's light at the foot of every card
 * through bakedTerms(), which is R for the sun and the square of alpha for the
 * sky. Handed the DELIVERED atlas it lights the grass off a Cycles bake while
 * the cubes beside it are lit analytically, and the two disagree by enough that
 * the cards were the brightest population in the frame — pale blades standing
 * on dark cubes, which is a defect of the seam and not of either technique.
 *
 * A card stands on the ground and the ground faces up, so the two terms are the
 * same everywhere: the cosine the sun makes with the vertical, and a whole
 * hemisphere of sky. Which means the bridge is FOUR TEXELS. Not one line of
 * vegetation.js moves; what changes is what it is handed, exactly as the plan
 * said it would be.
 */
function groundLight() {
  const sun = Math.max(SKY_UNIFORMS.uSunDir.value.y, 0);
  // The sun term travels through the sRGB transfer the gateway puts on a
  // delivered light map, so it is encoded here the same way; the sky term
  // travels in alpha, which no transfer touches, as its own square root.
  const encoded = sun <= 0.0031308 ? sun * 12.92 : 1.055 * sun ** (1 / 2.4) - 0.055;
  const r = Math.round(Math.max(0, Math.min(1, encoded)) * 255);
  const side = 2;
  const data = new Uint8Array(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = r;
    data[i * 4 + 2] = r;
    data[i * 4 + 3] = 255;
  }
  const texture = new DataTexture(data, side, side, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** The grass, once both its sheet and the cubes it stands on are here. */
function plantWhenReady() {
  if (vegetation || !build.finishedAt || !assets.get('grass-atlas')) return;
  vegetation = createVegetation({
    grassAtlas: assets.get('grass-atlas'),
    // The bridge, not the delivered atlas: see groundLight() above.
    light: groundLight(),
    // PLANTED ON THE CUBES AND NOT ON THE FIELD, which is the whole question
    // this piece is here to answer: whether the delivered cards rescue a bare
    // cube in the close first person. Cards standing on the smooth field would
    // float over half the tufts and be buried by the other half, and the answer
    // would be about a bug instead of about the technique.
    height: voxelHeightAt,
    lightScale: TERRAIN.lightScale,
  });
  for (const mesh of vegetation.meshes) scene.add(mesh);
  if (wantedGrass.grass) vegetation.setQuality(wantedGrass.grass);
}

/** The writing, drawn by the delivered module and laid on generated masonry. */
function engraveBlock() {
  if (!masonry) return;
  loadEngravingFont(import.meta.env.BASE_URL)
    .then(() => loadSection(masonry.spec.key))
    .then((section) => {
      const distance = Math.hypot(
        masonry.spec.position.x - POSE_TARGET.position.x,
        masonry.spec.position.z - POSE_TARGET.position.z,
      );
      // engrave() is called with exactly what src/main.js calls it with: the
      // section, the entry from the plan, and how far the block stands from the
      // reference camera. Nothing about the surface it is going onto is passed,
      // and nothing about it needs to be.
      masonry.setEngraving(engrave(section, masonry.spec, distance));
      engraved = true;
    })
    .catch((error) => console.warn('engraving not cut:', error.message));
}

loadLut(`${import.meta.env.BASE_URL}assets/grade-lut.png`)
  .then((lut) => renderer.post.setLut(lut))
  .catch((error) => console.warn('grade not applied:', error.message));

// ------------------------------------------------------- what held the frame
//
// The gate is "no block of the main thread over eight milliseconds", and the
// browser's own long-task observer will not answer it: it reports at fifty. So
// the block is measured where it happens — every worker message is timed from
// its first statement — and the observer is kept as well, because a fifty
// millisecond entry during the build would mean something the direct timing
// missed. Both are reported.
const longTasks = [];
if (typeof PerformanceObserver !== 'undefined') {
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({ start: Math.round(entry.startTime), ms: Math.round(entry.duration) });
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* a browser without the entry type answers by not having one */ }
}

// And the frames themselves while the disc lands, which is the reading a walker
// would actually feel.
const frameGaps = [];
let lastFrame = 0;

// --------------------------------------------------------------- the levers

let voxelVisible = true;
let grassVisible = true;

function setVoxelVisible(on) {
  voxelVisible = on;
  for (const mesh of chunks) mesh.visible = on;
}

const dev = createDevHud(ui);
const note = document.createElement('div');
// Carries the campaign's own panel class as well as its own, so the driver
// every session has measured through — which hides '.dev-panel' before it
// shoots — puts this away without being taught a new selector.
note.className = 'dev-panel vox-note';
ui.appendChild(note);

function repaintNote() {
  const done = build.finishedAt
    ? `${(build.finishedAt - build.startedAt).toFixed(0)} ms` : 'in corso';
  note.innerHTML = `<b>PROVA VOXEL</b> — un angolo dell'hub
disco ${RADIUS} m a ${VOXEL * 100} cm · ${build.columns} colonne · ${build.quads} quad
fusione ${build.quadsPerColumn.toFixed(3)} quad/colonna (dentro ${build.insidePerColumn.toFixed(3)})
muratura 05: ${masonry ? masonry.blocks : '--'} blocchi, ${masonry ? masonry.courses : '--'} corsi
disco pronto in ${done} · blocco peggiore ${build.worstTaskMs.toFixed(1)} ms
[V] cubi ${voxelVisible ? 'ON' : 'OFF'}  [E] erba ${grassVisible ? 'ON' : 'OFF'}  [N] notte ${night ? 'ON' : 'OFF'}  [L] lampade ${lampsWanted ? 'ON — fuori budget' : 'OFF'}
[P] posa-P  [1] mano 1,5 m  [2] picco -85  [3] bordo indietro`;
}

input.onKey((code) => {
  if (code === 'KeyV') { setVoxelVisible(!voxelVisible); repaintNote(); }
  if (code === 'KeyE') {
    grassVisible = !grassVisible;
    hub.setGrassVisible(grassVisible);
    repaintNote();
  }
  if (code === 'KeyN') { setNight(!night); repaintNote(); }
  // The cluster that failed its budget, so it can still be LOOKED at.
  if (code === 'KeyL') { lampsWanted = !lampsWanted; setNight(night); repaintNote(); }
  if (code === 'KeyP') place(POSE_TARGET.position.x, POSE_TARGET.position.z, 0, 4.5, 45);
  if (code === 'Digit1') place(2.5, 8, 0, -48.6, 45);
  if (code === 'Digit2') place(2.5, 8, 0, -85, 45);
  if (code === 'Digit3') place(0, -12.5, 180, -6, 45);
});

function place(x, z, yaw, pitch, fov) {
  player.setPose({
    position: { x, y: 1.70, z }, yaw, pitch,
  });
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

if (query.has('notte')) setNight(true);

// --------------------------------------------------------------- the harness
//
// The same surface src/main.js exposes behind ?dev, so the campaign's own
// driver — s2-gate/shoot.mjs, which every session since has measured through —
// opens this page without knowing it is a different page. A second harness
// would be a second definition of what a pose is.
window.farfield = {
  scene,
  camera,
  player,
  renderer,
  assets,
  hub,
  quality,
  input,
  // The calibration does not run here and never should: the demo is measured at
  // a tier that is ASKED for, not at one a benchmark chose while nobody was
  // looking. The handle exists because the driver reaches for it.
  bench: { active: false, stop() {} },
};

window.vox = {
  build,
  boot,
  settings,
  /**
   * Whether every piece of the corner is standing.
   *
   * The campaign's dressed-frame guard asks whether the frame is bright and
   * varied, and a disc of lit cubes answers yes on its own — so a measurement
   * begun on that guard alone can be taken before the paving and the grass have
   * arrived, which is exactly what happened the first time. Nothing here is
   * measured until this is true.
   */
  ready: () => Boolean(build.finishedAt && terrain && vegetation && masonry && engraved),
  longTasks,
  frameGaps,
  chunks: () => chunks.length,
  visible: () => chunks.filter((m) => m.visible).length,
  setVoxel: setVoxelVisible,
  setNight,
  isNight: () => night,
  /**
   * How many of the additive halos are allowed to stand.
   *
   * It exists because the night failed its budget by twenty five times the
   * moment the plates actually rasterised, and a failure with no number beside
   * it is not useful to anybody: this is what turns "the night is too dear"
   * into "the night is affordable at N halos of this size".
   */
  setLamps(count) {
    lampsWanted = count > 0;
    for (let i = 0; i < haloMeshes.length; i++) {
      haloMeshes[i].userData.allowed = i < count;
      haloMeshes[i].visible = night && lampsWanted && i < count;
    }
    return haloMeshes.length;
  },
  lamps: () => haloMeshes.length,
  masonry: () => (masonry ? {
    blocks: masonry.blocks, courses: masonry.courses, rise: masonry.rise, quads: masonry.quads,
  } : null),
  /** Pushes a swept setting onto the frame without rebuilding anything. */
  apply(patch) {
    Object.assign(settings, patch);
    if (patch.albedo) settings.albedo = new Vector3(...patch.albedo);
    material.userData.refresh();
  },
  /** What the engraving is burning at, so the night discipline can be checked. */
  inkGain: () => (masonry ? masonry.material.uniforms.uInk.value : null),
  /** The two light colours as the frame currently has them. */
  light: () => ({
    sun: SCENE_LIGHT_UNIFORMS.uSunLight.value.toArray(),
    sky: SCENE_LIGHT_UNIFORMS.uSkyLight.value.toArray(),
    sunDir: SKY_UNIFORMS.uSunDir.value.toArray(),
  }),
  geometryBytes: () => build.bytes,
};

// ------------------------------------------------------------------ the loop

function resize() {
  const { aspect } = renderer.resize();
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let costMs = 0;
let stages = null;

new Loop()
  .add((delta, now) => {
    const started = performance.now();
    if (lastFrame && !build.finishedAt) frameGaps.push(now - lastFrame);
    lastFrame = now;

    player.update(delta, input);
    player.applyTo(camera);
    hub.update(now / 1000, player.position, delta, player.pitchDegrees);
    renderer.render(scene, camera);

    const timings = renderer.timings();
    const fresh = renderer.hasGpuClock ? (timings ? timings.total : 0) : delta * 1000;
    if (fresh > 0) costMs = fresh;
    if (timings) stages = timings;
    quality.sample(fresh, { lookRate: player.lookRate, speed: player.speed });

    dev.update(delta, now, renderer.stats(), {
      cpuMs: performance.now() - started,
      position: `${player.position.x.toFixed(1)} ${player.position.z.toFixed(1)}`,
      speed: `${player.speed.toFixed(2)} m/s`,
      gpuMs: costMs,
      quality,
      renderer,
      stages,
      grass: hub.vegetationStats(),
    });
    if (now % 8 < 1) repaintNote();
  })
  .start();

repaintNote();
