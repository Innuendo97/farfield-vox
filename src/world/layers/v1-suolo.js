import { createTerrain } from '../terrain.js';

// THE SOIL. Owned by V1.
//
// WHAT IS HERE TODAY is a wrapper and nothing more: it hangs the ground exactly
// as the hub used to hang it, so the world draws the picture it drew before the
// register existed. That is the whole point of writing the eight stubs in the
// foundation rather than leaving the sessions to invent them — the shape is
// settled while the picture is known good, and each session then fills its own
// stub without touching anybody else's file.
//
// WHAT V1 REPLACES IT WITH: the voxel disc at ten centimetres out to r=35, the
// quantised shell from there to a hundred metres, the earth material and the
// tuft. The mesh below and the bent grid under it go with the rewrite.
//
// THE ASSETS BELOW GO WITH IT TOO, all four of them, and two of them are worth
// naming: `terrain-detail` is the material of the paving under the walker's own
// feet and `terrain-path` is where the joints of that paving are. Both belong
// to the run of the path rather than to the meadow, so they are V3's to claim
// when the path becomes geometry of its own. They are declared here because
// today they are handed to the ground's material, and a need is stated where it
// is eaten.
const layer = {
  id: 'v1-suolo',

  meshes: [],

  /** What the ground came to, for the hub's own handles. */
  built: null,

  dress: {
    needs: ['terrain-albedo', 'terrain-light', 'terrain-detail', 'terrain-path'],

    /**
     * @param {object} assets  keyed by asset id, plus what the hub knows
     */
    build(assets) {
      layer.built = createTerrain({
        albedo: assets['terrain-albedo'],
        light: assets['terrain-light'],
        // The material the bent atlas cannot hold at that size, and where the
        // joints of it are: see DETAIL and STRIP in src/world/air.js. Both go
        // to the ground alone and not to the stair.
        detail: assets['terrain-detail'],
        strip: assets['terrain-path'],
      });
      layer.meshes = layer.built.meshes;
      return layer.built;
    },
  },

  update() {},
};

export default layer;
