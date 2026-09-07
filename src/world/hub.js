import { Scene } from 'three';
import { applySky } from '../core/sky.js';
import { setAir } from './air.js';
import { builtHeightAt, cameraSolids, groundHeightAt as meadowHeightAt } from './contracts.js';
import { ROCK_BLOCKERS } from './rocks.js';
import { MONOLITHS, PLATFORM } from './layout.js';
import { LAYERS, layer, layersAt } from './layers/registry.js';

const DEG = Math.PI / 180;

// THE HUB, WHICH NO LONGER KNOWS WHAT THE WORLD IS MADE OF.
//
// It used to name every piece twice: once to build it and once to hang it, with
// the asset each piece eats spelled out beside the call. Eight sessions are
// about to work on eight pieces at the same time, and a file that names all
// eight is a file all eight have to edit.
//
// So what is left here is only what belongs to nobody: the scene, the sky above
// it, what a body may walk through, and the two arrivals. The pieces come from
// src/world/layers/registry.js, and each of them states its own needs beside the
// code that eats them.

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

  // WHAT A LENS CANNOT PASS THROUGH, which is the same stone with its height on
  // it. A footprint is enough for a body, which is always on the floor; a third
  // person camera is on a five metre arm at head height and has to know that a
  // rock is knee high and a block is not. It is not assembled here: two lists
  // built in two places is two opinions, so it comes from the one seat that
  // publishes what this world is made of -- see cameraSolids in contracts.js.
  const solids = cameraSolids();

  const arrived = { dress: false, plant: false };
  // What the quality tier has asked for. It is held here rather than pushed
  // straight through because the tier is chosen before the meadow exists, and a
  // lever set on nothing has to survive until there is something to set it on.
  const wanted = { grass: null };

  /**
   * Builds every layer that has something to build at this arrival and hangs
   * what it built.
   *
   * The two things no delivery can carry travel in the same bag as the assets:
   * where the ground is, and what a body may walk through. Both are known here
   * and nowhere else, and a layer that wants either asks for it by name the way
   * it asks for a texture.
   */
  function raise(arrival, assets) {
    if (arrived[arrival]) return;
    arrived[arrival] = true;
    const bag = { ...assets, height: meadowHeightAt, blockers };
    for (const l of layersAt(arrival)) {
      l[arrival].build(bag);
      for (const mesh of l.meshes) if (!mesh.parent) scene.add(mesh);
    }
  }

  const green = layer('v4-verde');
  const stone = layer('v2-pietra');
  const weather = layer('v6-cielo-nuvole');

  return {
    scene,
    blockers,
    solids,
    groundHeightAt,

    /**
     * Hangs the ground, the built stone and the distances on the scene, once
     * their textures have arrived. Called at most once; before it the world is
     * the blocks and the sky, which is already walkable.
     */
    dress(assets) { raise('dress', assets); },

    /**
     * The rocks, the vegetation and the weather, once their sheets are down.
     *
     * Kept apart from dress() because they are not part of the first walkable
     * frame: the ground, the sky and the blocks are what the walker must see
     * before moving, and the meadow's own grass can arrive a second later
     * without anybody waiting on it.
     */
    plant(assets) {
      raise('plant', assets);
      if (wanted.grass) green.setQuality(wanted.grass);
    },

    /** How much meadow the machine can afford. */
    setGrassQuality(grass) {
      wanted.grass = grass;
      green.setQuality(grass);
    },

    /** Development handle: the grass alone, so its cost can be measured. */
    setGrassVisible(visible) { green.setVisible(visible); },

    /** And the same for the weather, which is the other thing that fills. */
    setCloudsVisible(visible) { weather.setVisible(visible); },

    /** And one layer of it at a time, because the whole field is one draw. */
    setCloudLayers(kinds) { weather.setLayers(kinds); },

    /** The air in front of the weather, for the fit and for a day and night. */
    setCloudAerial(...values) { return weather.setAerial(...values); },

    /** How much of that air this delivery has not already got baked into it. */
    setCloudAerialOwed(owed) { return weather.setAerialOwed(owed); },

    /** The level the weather is read at, for the sweep that settles the gain. */
    setCloudLevel(scale) { return weather.setLevel(scale); },

    /** What the vegetation is currently costing, for the development panel. */
    vegetationStats() {
      const stats = green.stats();
      return stats ? { ...stats, rockTriangles: stone.rockTriangles } : null;
    },

    /** The engraving of one section, once its text has been drawn. */
    setEngraving(id, texture) { stone.setEngraving(id, texture); },

    /**
     * Intensity of the strip on the risers, in light units.
     *
     * Built dark. The emissive pass that lights it belongs with the monoliths,
     * and this is the handle it will pull.
     */
    setStairGlow(intensity) { stone.setStairGlow(intensity); },

    /** How lit one block is, nought to one, as the walker comes and goes. */
    setMonolithFocus(id, amount, opened = 0) { stone.setFocus(id, amount, opened); },

    /** Development handle: what the weather's own clock reads, in seconds. */
    cloudSeconds() { return weather.seconds(); },

    update(elapsed, eye, delta = 0, pitchDegrees) {
      // The air, before anything that stands in it is drawn: where the eye is,
      // which the height integral of the fog needs and which used to be the
      // literal 1.70 whatever the walker was standing on, and what colour the
      // sky is making it this hour. It is not a layer — it is what the layers
      // stand in — so it is done here and first.
      if (eye) setAir(eye.y);
      // Every layer, once, in the register's own order. Not "those that built
      // at this arrival": a layer with a foot in both arrivals would be updated
      // twice, and a layer that builds nothing may still have a frame's worth of
      // work to do.
      const frame = { elapsed, eye, delta, pitchDegrees };
      for (const l of LAYERS) l.update(frame);
    },
  };
}
