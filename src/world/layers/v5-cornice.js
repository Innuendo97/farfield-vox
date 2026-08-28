import { createDistance } from '../distant.js';

// THE FRAME BEYOND A HUNDRED METRES. Owned by V5.
//
// The ridges, the standing water and the ruins. It costs no delivery at all --
// three rings of arithmetic in the same air as the meadow -- which is why it has
// needs of nothing and still belongs to the first walkable frame: a frame with
// the ground in it and no distance behind it reads wrong, so the two are dressed
// together.
//
// WHAT V5 REPLACES IT WITH: crests reprofiled as corbels a voxel deep, and the
// ruins. The water stays verbatim -- the target has no voxel water in it -- and
// so does the join, which is the one thing this layer cannot get wrong: the
// meadow has to arrive at the horizon as the identical colour the distance
// carries, or the seam between them is a line. That colour is FOG_RADIANCE in
// src/world/air.js and neither session owns it.
const layer = {
  id: 'v5-cornice',

  meshes: [],

  distance: null,

  dress: {
    needs: [],

    build() {
      layer.distance = createDistance();
      layer.meshes = layer.distance.meshes;
      return layer.distance;
    },
  },

  update() {},
};

export default layer;
