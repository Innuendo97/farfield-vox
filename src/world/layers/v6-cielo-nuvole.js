import { createVoxelClouds } from '../voxel-clouds.js';

// THE SKY AND THE WEATHER. Owned by V6.
//
// The dome itself is not here: it is arithmetic in src/core/sky.js and it goes
// up with the scene, before any delivery, so that the walker's first frame has a
// finished sky in it rather than a clear colour standing in for one. What is
// here is the weather -- bodies standing in FRONT of that dome -- which can be
// hung a moment later without anybody ever waiting on a sky.
//
// AND IT NEEDS NOTHING NOW. `needs` was three textures and 2.24 MB of KTX2 --
// the plates, their coverage, and the equirect the water reflected them through
// -- and it is empty, because a cumulus of cubes is a field of density and a
// roster of forty-three rows inside assets-src/sky/sky.json. The weather still
// lands at PLANT rather than at DRESS: the field is built on the main thread
// and costs a few milliseconds, and the first walkable frame is the ground, the
// blocks and the sky behind them.
//
// WHAT REPLACED THE PLATES, AND WHY NO PARAMETER OF THEM COULD HAVE: the long
// note at the head of src/world/voxel-clouds.js. In one line -- a photograph of
// cubes cut at one scale and stood at eight is a photograph of eight different
// cubes.
//
// AND WHAT WENT WITH THEM, DECLARED HERE BECAUSE THIS IS WHERE IT WAS HUNG: the
// weather no longer reaches the surfaces that REFLECT the sky. setCloudSky()
// took `cloud-equirect` -- a photograph of the plate composition laid down once
// against direction -- and the water and the wet stone composited it over the
// dome. That picture was of a field that no longer exists, so it left with it,
// and until the equirect is re-made from the voxel field the lake reflects a
// sky with no weather in it. It is R4 §S7, it is a residual of this unit, and
// it is written down rather than left to be noticed.
const layer = {
  id: 'v6-cielo-nuvole',

  meshes: [],

  clouds: null,

  plant: {
    needs: [],

    build(assets) {
      // ?t0 FERMA ANCHE IL TEMPO. Ogni misura di questa campagna si prende
      // dietro quel flag, e un cielo che deriva di tre metri al secondo mentre
      // il resto del mondo sta fermo renderebbe due scatti della stessa posa
      // due scatti diversi -- che e' esattamente cio' che E-V5j vieta. A t0 il
      // roster e' la composizione del target, esatta.
      layer.clouds = createVoxelClouds({ frozen: !!(assets && assets.frozen) });
      layer.meshes = [layer.clouds.mesh];
      return layer.clouds;
    },
  },

  /** Development handle: the weather alone, which is the other thing that fills. */
  setVisible(visible) {
    if (layer.clouds) layer.clouds.setVisible(visible);
  },

  /** Development handle: what the weather's own clock reads, in seconds. */
  seconds() {
    return layer.clouds ? layer.clouds.seconds() : 0;
  },

  /**
   * Where the weather's shadow falls on the meadow (E-DECISIONI21 D5 = A).
   *
   * THE SEAT AND NOT THE TERM. What is published here is WHERE the shadow is;
   * what reads it is the ground's own fragment, and
   * src/world/voxel/campo-material.js is not this session's to write.
   */
  cloudShadowAt(x, z) {
    return layer.clouds ? layer.clouds.cloudShadowAt(x, z) : 0;
  },

  update() {
    // Nothing a frame. The drift is one uniform, read at draw time, and the
    // field's own clock is advanced in onBeforeRender so a frame that is never
    // drawn never moves the weather.
  },
};

export default layer;
