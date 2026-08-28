import {
  BufferAttribute, BufferGeometry, Color, Mesh, Scene, ShaderMaterial,
} from 'three';
import {
  applySky, setCloudDrift, setCloudSky,
} from '../core/sky.js';
import {
  createBakedMaterial, createHeightSampler, createTerrain, setAir,
} from './terrain.js';
import { CLOUD_LEVEL, createClouds } from './clouds.js';
import { createDistance } from './distant.js';
import { createMonoliths, STAIR_GLOW } from './monoliths.js';
import { createRocks, ROCK_BLOCKERS } from './rocks.js';
import { createVegetation } from './vegetation.js';
import { glowMesh, stairHeightAt, stairMesh } from './stairs.js';
import { MONOLITHS, PLATFORM } from './layout.js';
import TERRAIN from '../../assets-src/terrain/terrain.json';

const DEG = Math.PI / 180;

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

/**
 * Height of the built stone under a point, or -Infinity where there is none.
 *
 * The stair and the platform are the only places the walker leaves the meadow,
 * and they are flat topped boxes: their height is an arithmetic answer, not
 * something that needs a sampled grid the way the ground does.
 */
function builtHeightAt(x, z) {
  const c = Math.cos(PLATFORM.rotationY * DEG);
  const s = Math.sin(PLATFORM.rotationY * DEG);
  const dx = x - PLATFORM.x;
  const dz = z - PLATFORM.z;
  // Back into the platform's own frame, which is the inverse of the rotation
  // applied in stairs.js.
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  if (Math.abs(lx) <= PLATFORM.width / 2 && Math.abs(lz) <= PLATFORM.depth / 2) {
    return PLATFORM.height;
  }
  return stairHeightAt(x, z);
}

export function buildHub() {
  const scene = new Scene();
  // The dome goes up with the scene rather than with a delivery. It costs no
  // asset and waits for nothing — it is a function of a dozen numbers already
  // folded into the bundle — so the walker's first frame has the finished sky
  // in it, and there is no clear colour standing in for one.
  applySky(scene);

  // No lights. Every surface in this world carries a baked map and does its own
  // shading, so a lamp in the scene would be a second sun nobody asked for.

  // The ground knows its own shape from the first frame, before any of its
  // textures have arrived: the walker has to stand on the right height
  // immediately, and the meshes can catch up.
  const meadowHeightAt = createHeightSampler();
  const groundHeightAt = (x, z) => Math.max(meadowHeightAt(x, z), builtHeightAt(x, z));

  // The blocks stop the walker from the first frame, whether or not their mesh
  // has arrived: what a body may walk through is a property of the plan, not of
  // whether a download has finished.
  const blockers = [];
  for (const m of MONOLITHS) {
    const [w, , d] = m.size;
    blockers.push({
      x: m.position.x, z: m.position.z,
      halfWidth: w / 2, halfDepth: d / 2,
      rotationY: m.rotationY * DEG,
    });
  }

  // The platform blocks too, otherwise the player walks through its side walls.
  blockers.push({
    x: PLATFORM.x, z: PLATFORM.z,
    halfWidth: PLATFORM.width / 2, halfDepth: PLATFORM.depth / 2,
    rotationY: PLATFORM.rotationY * DEG,
  });

  // And the larger rocks. They are known from the first frame for the same
  // reason the blocks are: what a body may walk through is a property of the
  // plan, not of whether a download has finished.
  blockers.push(...ROCK_BLOCKERS);

  let dressed = null;
  let planted = null;
  // What the quality tier has asked for. It is held here rather than pushed
  // straight through because the tier is chosen before the meadow exists, and a
  // lever set on nothing has to survive until there is something to set it on.
  const wanted = { grass: null };

  return {
    scene,
    blockers,
    groundHeightAt,

    /**
     * Hangs the baked ground and the distances on the scene, once their
     * textures have arrived. Called at most once; before it the world is the
     * blocks and the sky, which is already walkable.
     */
    dress(assets) {
      if (dressed) return dressed;
      const stairs = buildStairs(assets);
      dressed = {
        terrain: createTerrain(assets),
        distance: createDistance(assets),
        monoliths: createMonoliths(assets),
        stairs,
      };
      for (const mesh of [
        ...dressed.terrain.meshes, ...dressed.distance.meshes,
        ...dressed.monoliths.meshes, ...stairs.meshes,
      ]) {
        scene.add(mesh);
      }
      stairs.setGlow(STAIR_GLOW);
      return dressed;
    },

    /**
     * The rocks and the vegetation, once their sheets have arrived.
     *
     * Kept apart from dress() because they are not part of the first walkable
     * frame: the ground, the sky and the blocks are what the walker must see
     * before moving, and the meadow's own grass can arrive a second later
     * without anybody waiting on it.
     */
    plant(assets) {
      if (planted) return planted;
      planted = {
        rocks: createRocks(assets),
        vegetation: createVegetation({ ...assets, height: meadowHeightAt }),
        // The weather arrives with the meadow rather than with the sky: the
        // dome is what the first walkable frame needs behind it, and the cloud
        // is bodies standing in front of that dome, which can be hung a moment
        // later without the walker ever waiting on a sky.
        clouds: createClouds({ ...assets, blockers }),
      };
      for (const mesh of [
        ...planted.rocks.meshes, ...planted.vegetation.meshes, ...planted.clouds.meshes,
      ]) {
        scene.add(mesh);
      }
      // The same weather, for everything that reflects the sky rather than
      // stands in front of it. It arrives with the atlas because it is the
      // same bake, and until it does those surfaces reflect an empty sky.
      setCloudSky(assets.cloudSky, CLOUD_LEVEL);
      if (wanted.grass) planted.vegetation.setQuality(wanted.grass);
      return planted;
    },

    /** How much meadow the machine can afford. */
    setGrassQuality(grass) {
      wanted.grass = grass;
      if (planted) planted.vegetation.setQuality(grass);
    },

    /** Development handle: the grass alone, so its cost can be measured. */
    setGrassVisible(visible) {
      if (planted) planted.vegetation.setGrassVisible(visible);
    },

    /** And the same for the weather, which is the other thing that fills. */
    setCloudsVisible(visible) {
      if (planted) planted.clouds.setVisible(visible);
    },

    /** And one layer of it at a time, because the whole field is one draw. */
    setCloudLayers(kinds) {
      if (planted) planted.clouds.setLayers(kinds);
    },

    /** The air in front of the weather, for the fit and for a day and night. */
    setCloudAerial(...values) {
      return planted ? planted.clouds.setAerial(...values) : null;
    },

    /** How much of that air this delivery has not already got baked into it. */
    setCloudAerialOwed(owed) {
      return planted ? planted.clouds.setAerialOwed(owed) : null;
    },

    /** The level the weather is read at, for the sweep that settles the gain. */
    setCloudLevel(scale) {
      return planted ? planted.clouds.setLevel(scale) : null;
    },

    /** What the vegetation is currently costing, for the development panel. */
    vegetationStats() {
      return planted
        ? { ...planted.vegetation.stats(), rockTriangles: planted.rocks.triangles }
        : null;
    },

    /** The engraving of one section, once its text has been drawn. */
    setEngraving(id, texture) {
      if (dressed) dressed.monoliths.setEngraving(id, texture);
    },

    /**
     * Intensity of the strip on the risers, in light units.
     *
     * Built dark. The emissive pass that lights it belongs with the monoliths,
     * and this is the handle it will pull.
     */
    setStairGlow(intensity) {
      if (dressed) dressed.stairs.setGlow(intensity);
    },

    /**
     * How lit one block is, nought to one, as the walker comes and goes.
     *
     * The stair answers with the third block because it is part of it: it is
     * the way up onto its platform and nothing else in the hub uses it, so
     * lighting the writing while leaving the risers where they were would split
     * one structure into two.
     */
    setMonolithFocus(id, amount, opened = 0) {
      if (!dressed) return;
      dressed.monoliths.setFocus(id, amount, opened);
      if (id === '03') dressed.stairs.setGlow(STAIR_GLOW * (1 + STAIR_FOCUS * amount));
    },

    /** Development handle: what the weather's own clock reads, in seconds. */
    cloudSeconds() {
      return planted ? planted.clouds.seconds() : 0;
    },

    update(elapsed, eye, delta = 0, pitchDegrees) {
      // The air, before anything that stands in it is drawn: where the eye is,
      // which the height integral of the fog needs and which used to be the
      // literal 1.70 whatever the walker was standing on, and what colour the
      // sky is making it this hour.
      if (eye) setAir(eye.y);
      if (planted && eye) planted.vegetation.update(eye, delta, pitchDegrees);
      if (planted) {
        planted.clouds.update(elapsed);
        // The drift is a rigid turn of the whole field, so everything that
        // reflects the sky is handed the one number that describes it rather
        // than the field itself.
        setCloudDrift(planted.clouds.turns());
      }
      if (!dressed) return;
      dressed.monoliths.update(elapsed);
    },
  };
}
