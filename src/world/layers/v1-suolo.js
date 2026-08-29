import { createTerrain } from '../terrain.js';
import { createGroundVoxel } from '../ground-voxel.js';

// THE SOIL. Owned by V1.
//
// WHAT IS HERE TODAY IS TWO GROUNDS, AND ONLY ONE OF THEM IS THE WORLD'S.
//
// The delivered ground is hung exactly as the hub used to hang it, so a page
// opened without asking for anything draws the picture it drew before this
// session existed. Behind `?voxsuolo=1` the voxel disc is hung as well, standing
// in the meadow where the bent grid used to be the meadow.
//
// WHY A SWITCH AND NOT A REPLACEMENT. Eight sessions are branching off one
// foundation and they are merged together, unbuilt, at every alignment walk. A
// branch that swapped the ground the day the disc first stood would hand the
// other seven a world that is only as finished as this one's newest commit — so
// the default stays the ground the campaign is currently able to walk on, and
// the swap is one deliberate act at the end rather than a state every commit
// leaves behind. Retiring the bent grid, and with it the four assets below,
// belongs to the unit that also writes the shell.
//
// HOW THE TWO STAND TOGETHER, WHICH IS DECLARED AND NOT INCIDENTAL:
//
//   inside the disc   the cube tops straddle the field the grid is drawn at,
//                     from five centimetres under it to twenty five over, and
//                     they stand a mean of ten centimetres proud of it. So the
//                     grid is under the cubes on 91.6% of the disc's columns and
//                     up to five centimetres over them on the other 8.4%, which
//                     is where the tuft dropped a column by a whole voxel. What
//                     keeps that from being visible is the walls of the
//                     neighbouring cubes, which are taller still.
//   on the paving     the disc lays no column at all, so what is drawn there is
//                     the delivered ground, untouched, which is the whole point
//                     of the paving surviving the pivot.
//   beyond the disc   the same grid is the shell, one draw over two hundred
//                     metres, already bent to spend its resolution where the eye
//                     is and already carrying the air.
//   the grass         is still planted on the FIELD and not on the cubes, so a
//                     card can sit a quarter of a metre out over the same range.
//   the walker        stands on the FIELD too, for the same reason and out by
//                     the same amount, which is the whole of why this is a
//                     switch and not the world.
//
// NEITHER OF THOSE LAST TWO IS FIXED HERE, and that is a boundary and not an
// omission: the height every other piece of the world reads is groundHeightAt in
// src/world/contracts.js, there is exactly one of it, and pointing it at the
// cubes is a change to that file. What this publishes instead is topAt below,
// which is the answer that seat will read.
//
// THE ASSETS BELOW GO WITH THE GRID, all four of them, and two of them are worth
// naming: `terrain-detail` is the material of the paving under the walker's own
// feet and `terrain-path` is where the joints of that paving are. Both belong to
// the run of the path rather than to the meadow, so they are V3's to claim when
// the path becomes geometry of its own. They are declared here because today
// they are handed to the ground's material, and a need is stated where it is
// eaten.

/**
 * What the address asks this layer for.
 *
 * THREE SWITCHES AND NOT ONE, and the two beyond the first are not conveniences:
 * they are the only way the two disciplines the disc is accountable for can be
 * priced instead of asserted. A page that only ever runs with the saving on can
 * say the saving is there; it cannot say what it is worth.
 *
 *   voxsuolo=1     hang the voxel disc
 *   voxdispose=0   keep the JavaScript copy of every buffer after the upload
 *   voxbound=walk  walk the vertices for the box instead of taking the worker's
 */
function asked() {
  const query = new URLSearchParams(window.location.search);
  return {
    voxel: query.get('voxsuolo') === '1',
    dispose: query.get('voxdispose') !== '0',
    boundingFromWorker: query.get('voxbound') !== 'walk',
  };
}

const layer = {
  id: 'v1-suolo',

  meshes: [],

  /** What the ground came to, for the hub's own handles. */
  built: null,

  /** The voxel disc, or null on a page that did not ask for it. */
  voxel: null,

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

      const wanted = asked();
      if (wanted.voxel) {
        layer.voxel = createGroundVoxel(wanted);
        // ONE GROUP AND NOT TWENTY SIX MESHES, because the hub hangs what a
        // layer built at the moment it built it and the chunks are still being
        // cut in a worker at that moment. A group is on the scene from the
        // start and the chunks arrive into it, which is also what keeps every
        // one of them separately visible to the frustum.
        layer.meshes = [...layer.meshes, layer.voxel.group];
        // The handle the measurements are taken through. It exists only on a
        // page that asked for the disc, which is never a visitor's.
        window.voxsuolo = layer.voxel;
      }

      return layer.built;
    },
  },

  /**
   * Height of the cube tops under a point, or null where the disc lays none.
   *
   * Published rather than wired: the one seat that has to answer for the whole
   * world's floor is groundHeightAt in src/world/contracts.js, and this is what
   * it reads inside the disc when the disc becomes the ground.
   */
  topAt(x, z) {
    return layer.voxel ? layer.voxel.topAt(x, z) : null;
  },

  update() {
    if (layer.voxel) layer.voxel.update();
  },
};

export default layer;
