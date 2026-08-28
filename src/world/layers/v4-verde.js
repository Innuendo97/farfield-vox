import { createVegetation } from '../vegetation.js';

// THE GREEN. Owned by V4.
//
// The grass cards, the props, and the radial ring they are sown on.
//
// WHAT V4 REPLACES IT WITH: the cards stay -- the target has blades of grass and
// a card is what draws one -- and what changes is how a card takes its light.
// Today it reads the ground's baked atlas at its own foot; tomorrow the ground
// under it is cubes with no atlas at all, and the bridge is `groundLightAt` in
// src/world/contracts.js. Voxel trees and flowers arrive with the same session.
//
// IT ASKS FOR THE GROUND'S OWN LIGHT MAP, and that is a collision written down
// rather than discovered: `terrain-light` belongs to the soil and is eaten here.
// It is the four texels the plan names as the V4/V1 pair to watch. Stating the
// need here is what makes the coupling visible in the register instead of in a
// stack trace.
const layer = {
  id: 'v4-verde',

  meshes: [],

  vegetation: null,

  plant: {
    needs: ['grass-atlas', 'props-atlas', 'terrain-light'],

    build(assets) {
      layer.vegetation = createVegetation({
        grassAtlas: assets['grass-atlas'],
        propsAtlas: assets['props-atlas'],
        light: assets['terrain-light'],
        // Where the ground is, which the hub knows and no delivery carries.
        height: assets.height,
      });
      layer.meshes = layer.vegetation.meshes;
      return layer.vegetation;
    },
  },

  /** How much meadow the machine can afford. */
  setQuality(grass) {
    if (layer.vegetation) layer.vegetation.setQuality(grass);
  },

  /** Development handle: the grass alone, so its cost can be measured. */
  setVisible(visible) {
    if (layer.vegetation) layer.vegetation.setGrassVisible(visible);
  },

  /** What the vegetation is currently costing, for the development panel. */
  stats() {
    return layer.vegetation ? layer.vegetation.stats() : null;
  },

  update({ eye, delta, pitchDegrees }) {
    if (layer.vegetation && eye) layer.vegetation.update(eye, delta, pitchDegrees);
  },
};

export default layer;
