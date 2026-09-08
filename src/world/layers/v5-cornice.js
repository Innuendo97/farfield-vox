import { createDistance } from '../distant.js';

// THE FRAME BEYOND THE WATER. Owned by V5, rebuilt on the foundation.
//
// WHAT IT USED TO HANG. Three painted rings, a floor, six giants and three
// rectangles of standing water -- and, in front of all of it, the smooth green
// crest src/world/voxel/confine.js put at ninety-six metres. What the walker
// saw of the cornice was the spires that stuck out over that crest.
//
// WHAT IT HANGS NOW (E-DECISIONI21, D7 = A). Hills of real cubes beyond the
// water, four planes of them, fitted per direction against the skyline R6
// traced off the reference, with broken rock on their crests where the picture
// shows it, and a RING of water at the level the boundary states, cut into the
// same wedges the hills are. The crest is at nought and the giants are gone.
//
// IT STILL COSTS NO DELIVERY AT ALL -- the hills are a law and a solved table
// of numbers in the source, not a mesh and not a texture -- which is why this
// still belongs to the first walkable frame: a frame with the ground in it and
// no distance behind it reads wrong, so the two are dressed together.
//
// AND THE JOIN IS STILL THE ONE THING THIS LAYER CANNOT GET WRONG: the meadow
// has to arrive at the horizon as the identical colour the distance carries, or
// the seam between them is a line. That colour is uFogColour in
// src/world/air.js, it is read live from there by both, and neither session
// owns it.
const layer = {
  id: 'v5-cornice',

  meshes: [],

  distance: null,

  dress: {
    needs: [],

    build() {
      layer.distance = createDistance();
      layer.meshes = layer.distance.meshes;
      // A HANDLE FOR THE BENCH, AND ONLY FOR IT. What the hills cost -- quads,
      // triangles, card bytes, the milliseconds they took to build and how many
      // wedges the lens is being handed right now -- is a measurement somebody
      // has to be able to take from outside the page, and taking it by counting
      // geometries in the scene graph would be a second opinion about the same
      // numbers this file already has. `import.meta.env.DEV` folds to false in
      // the product build, so neither the branch nor the handle ships.
      if (import.meta.env && import.meta.env.DEV) {
        globalThis.cornice = layer.distance.api;
      }
      return layer.distance;
    },
  },

  update() {},
};

export default layer;
