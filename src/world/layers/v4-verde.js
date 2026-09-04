import { createVegetation } from '../vegetation.js';
import { createTrees } from '../trees.js';

// THE GREEN. Owned by V4.
//
// The accents of the meadow: the rare sprays of blades sown on a ring around
// the walker, the loose flowers, and the hub's trees.
//
// WHAT V4 REPLACED. The cards used to be the meadow and they are not any more:
// the mass of the meadow is the ground's own cubes, ratified on the census of
// both targets (E-V4a), and what stays here is the accent the night target
// shows inside the pool of a lamp. The far ring, the skirts around the blocks
// and the three bushes went with the mass they were drawing -- the green that
// climbs a block's base is the ground's own tuft standing higher against built
// stone, which E-V4d gives to V1.
//
// IT NO LONGER ASKS FOR THE GROUND'S LIGHT MAP, AND THAT IS THE HALF OF THE
// COLLISION THIS SESSION COULD CLEAR. `terrain-light` belongs to the soil and
// was eaten here: 2048 by 2048 of a Cycles bake, read through a function that
// undid the power law bending the old ground's grid, to light a card standing
// on cubes. It is now four texels of the pair src/world/face-light.js produces
// for a face that points up, built inside vegetation.js and kept current with
// the one sun. The asset stays critical because V1 still draws with it; what is
// gone is V4 as a reason for it to exist.
const layer = {
  id: 'v4-verde',

  meshes: [],

  vegetation: null,

  trees: null,

  plant: {
    // The trees ask for nothing: no atlas, no sheet, no byte on the wire. Their
    // colour is a pigment measured off the target as a ratio to the meadow's
    // own, and their shape is arithmetic -- so they arrive with the bundle and
    // wait for no download.
    // ONE SHEET NOW, AND THE SECOND ONE IS OFF THE WIRE. `props-atlas` carried
    // two bushes and two cells of crossed flower cards. E-V4d gave the bush to
    // V1 -- what bites the stone in the targets is the ground's own carpet
    // standing higher, not an object -- and the flower is a cube head with no
    // texture on it at all, for the same reason no cube in this world has one.
    // Nothing reads that sheet any more, so it stops being downloaded: the
    // fragment below no longer declares it and the tool that painted it is
    // gone, which is also how assets-src/vegetation/palette.json loses its last
    // consumer instead of being patched (E-V4f.3).
    // AND ONE MORE, WHICH IS A HUNDRED AND FIFTY BYTES AND IS NOT A SHEET OF
    // BLADES. The flower's pistil was two smoothsteps in the fragment; it is
    // now the same shape delivered as a sixteen texel mask, so what the
    // reference says about where the yellow sits can enter as a rectangle in
    // assets-src/materia/fogli.json instead of as a shader edit. The head is
    // still a cube with no picture ON it: this is a mask of WHERE the second
    // pigment goes, which is a different thing and costs a hundred and fifty
    // bytes to say exactly.
    needs: ['grass-atlas', 'flower-band'],

    build(assets) {
      layer.vegetation = createVegetation({
        grassAtlas: assets['grass-atlas'],
        flowerBand: assets['flower-band'] || null,
        // Where the ground is, which the hub knows and no delivery carries.
        height: assets.height,
      });
      layer.trees = createTrees({ height: assets.height });
      layer.meshes = [...layer.vegetation.meshes, ...layer.trees.meshes];
      return layer.vegetation;
    },
  },

  /** How much meadow the machine can afford. */
  setQuality(grass) {
    if (layer.vegetation) layer.vegetation.setQuality(grass);
  },

  /** Development handle: the whole of the green, so its cost can be measured. */
  setVisible(visible) {
    if (layer.vegetation) {
      layer.vegetation.setGrassVisible(visible);
      layer.vegetation.setFlowersVisible(visible);
    }
    if (layer.trees) layer.trees.setVisible(visible);
  },

  /** And the trees on their own, which is the only way to price them apart. */
  setTreesVisible(visible) {
    if (layer.trees) layer.trees.setVisible(visible);
  },

  /** And the flowers on their own, for the same reason. */
  setFlowersVisible(visible) {
    if (layer.vegetation) layer.vegetation.setFlowersVisible(visible);
  },

  /** What the layer is currently costing, for the development panel. */
  stats() {
    if (!layer.vegetation) return null;
    return { ...layer.vegetation.stats(), trees: layer.trees ? layer.trees.stats() : null };
  },

  update({ eye, delta }) {
    if (layer.vegetation && eye) layer.vegetation.update(eye, delta);
  },
};

export default layer;
