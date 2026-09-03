import { createTerrain } from '../terrain.js';
import { createGroundVoxel } from '../ground-voxel.js';
import { createGroundShell } from '../ground-shell.js';
import { DISC_RADIUS } from '../voxel/index.js';
import { setGroundDiscRadius } from '../contracts.js';

// THE SOIL. Owned by V1.
//
// THE CUBES ARE THE WORLD NOW, AND THE SWITCH THAT SAID OTHERWISE IS GONE.
//
// It stood behind `?voxsuolo=1` for as long as there were two grounds and the
// campaign still had to be able to walk on the old one. There are not two any
// more: the meadow is cubes to the tier's radius, a snapped sheet from there to
// a hundred metres, and the bent grid is cut down to the paving it still draws.
// A switch between them would now be a switch between a world and a hole.
//
// HOW THE THREE STAND TOGETHER, WHICH IS DECLARED AND NOT INCIDENTAL:
//
//   inside the disc   ten centimetre cubes, carrying the carpet the committente
//                     chose (E-DECISIONI.1) -- the grain, the piles against the
//                     stone and the piles in the open meadow.
//   on the paving     the disc lays no column at all and the sheet stands aside
//                     from it too, so what is drawn there is the delivered
//                     ground, untouched, which is the whole point of the paving
//                     surviving the pivot. It is why the bent grid is cut down
//                     rather than deleted, and why the four assets below stay.
//                     AND "THE PAVING" IS THE CORRIDOR'S OWN ANSWER NOW, not the
//                     engine's ruler: see the injection below.
//   under the blocks  the same: a block's own footprint has no cubes in it.
//   beyond the disc   the SHEET, src/world/ground-shell.js, one draw out to a
//                     hundred metres, snapped to the same step and wearing the
//                     disc's own material by reference.
//   past a hundred    V5's, and nothing of V1's reaches there any more.
//   the grass         is still planted on the FIELD and not on the cubes, so a
//                     card can sit a quarter of a metre out over the same range.
//   the walker        stands on the FIELD too, for the same reason and out by
//                     the same amount. Neither is fixed here and both are D4's:
//                     the one seat that answers for the world's floor is
//                     groundHeightAt in src/world/contracts.js.
//
// AND THE PILES ARE THE OPEN QUESTION UNDER THAT LAST LINE. The carpet now
// stands three to six voxels proud of the field in the open meadow, so where
// the old tuft put the walker at most a voxel out, a pile puts them up to sixty
// centimetres under the cubes they can see. It is priced, it is the committente's
// choice, and it is the strongest argument yet for pointing groundHeightAt at
// topAt below -- which is D4's act and not this file's.
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
 * THE TWO THAT ARE LEFT ARE NOT CONVENIENCES: they are the only way the two
 * disciplines the disc is accountable for can be priced instead of asserted. A
 * page that only ever runs with the saving on can say the saving is there; it
 * cannot say what it is worth.
 *
 *   voxdispose=0   keep the JavaScript copy of every buffer after the upload
 *   voxbound=walk  walk the vertices for the box instead of taking the worker's
 *   voxradius=N    lay the disc at N metres instead of at the tier's, so a
 *                  radius can be MEASURED on the page before it is written into
 *                  a tier. It is a measuring handle and never a preference: the
 *                  answer that ships is src/core/quality.js's.
 */
function asked() {
  const query = new URLSearchParams(window.location.search);
  const asAsked = Number(query.get('voxradius'));
  return {
    dispose: query.get('voxdispose') !== '0',
    boundingFromWorker: query.get('voxbound') !== 'walk',
    radius: Number.isFinite(asAsked) && asAsked > 0 ? asAsked : null,
  };
}

const layer = {
  id: 'v1-suolo',

  meshes: [],

  /** What the ground came to, for the hub's own handles. */
  built: null,

  /** The voxel disc. */
  voxel: null,

  /** The sheet beyond it. */
  shell: null,

  dress: {
    // AND THE PAVING'S THREE MAPS ARE THIS LAYER'S NEED NOW.
    //
    // They were declared by the layer that hung the corridor's own surface, and
    // that surface is gone: the corridor is columns of THIS disc and its tops
    // are one of the three families this layer's engine draws. An asset is
    // needed where it is eaten, so the need moved with the mesh that eats it.
    needs: ['terrain-albedo', 'terrain-light', 'terrain-detail', 'terrain-path',
      'path-joint', 'path-tone', 'path-grain'],

    /**
     * @param {object} assets  keyed by asset id, plus what the hub knows
     */
    build(assets) {
      const wanted = asked();
      // WHERE THE RADIUS COMES FROM, IN ONE PLACE AND IN THIS ORDER: what the
      // address asked for, so a radius can be measured before it is chosen;
      // then the TIER, which is the answer that ships; then the engine's own
      // default, which only ever answers "nobody said". A number written in
      // this file instead would be a fourth opinion about the size of the world.
      const radius = wanted.radius ?? assets.voxelDiscRadius ?? DISC_RADIUS;
      // AND THE CONTRACT IS TOLD, HERE AND NOWHERE ELSE. groundHeightAt has to
      // answer cubes inside the disc and sheet beyond it, so it has to know
      // where the disc ends -- and the only way that is one answer instead of
      // two is for the seat that DECIDES the radius to hand it over, rather
      // than for the contract to work it out again from the tier.
      setGroundDiscRadius(radius);
      // AND NOTHING IS TOLD WHERE THE GROUND IS NOT ITS OWN ANY MORE. The disc
      // used to be handed the corridor's footprint twice -- a function here for
      // the walker's floor, two numbers to the worker for the cut -- because the
      // paving was a surface laid over a hole. The corridor is columns of the
      // disc now and the engine writes it out of the same field this layer
      // reads, so there is nothing to inject and no pair of answers that could
      // drift apart.

      layer.built = createTerrain({
        albedo: assets['terrain-albedo'],
        light: assets['terrain-light'],
        // The material the bent atlas cannot hold at that size, and where the
        // joints of it are: see DETAIL and STRIP in src/world/air.js. Both go
        // to the ground alone and not to the stair.
        detail: assets['terrain-detail'],
        strip: assets['terrain-path'],
        radius,
      });
      layer.meshes = layer.built.meshes;

      layer.voxel = createGroundVoxel({
        ...wanted,
        radius,
        // Nought if any of the three is missing, which is what the engine reads
        // as "hang no paving": three maps are one material and two of them
        // would be a corridor painted out of a ruler with no level.
        paving: assets['path-joint'] && assets['path-tone'] && assets['path-grain']
          ? {
            joint: assets['path-joint'],
            tone: assets['path-tone'],
            grain: assets['path-grain'],
          }
          : null,
      });
      // ONE GROUP AND NOT TWENTY SIX MESHES, because the hub hangs what a
      // layer built at the moment it built it and the chunks are still being
      // cut in a worker at that moment. A group is on the scene from the
      // start and the chunks arrive into it, which is also what keeps every
      // one of them separately visible to the frustum.
      layer.meshes = [...layer.meshes, layer.voxel.group];

      // AND THE SHEET, BUILT HERE AND NOT IN THE WORKER (E-V1d.2). It is a few
      // thousand vertices of arithmetic on a field that is already in the
      // bundle: a millisecond on the thread the walker is on, against a whole
      // second message and a whole second handover to move it off. The worker
      // exists for the disc, whose columns cost 926 ns each and number hundreds
      // of thousands; this is not that shape of problem.
      //
      // THE DISC'S OWN RADIUS AND NOT THE ONE ASKED FOR: the two surfaces meet
      // at a radius, so both read the same one, from the seat that laid it.
      layer.shell = createGroundShell({
        radius: layer.voxel.radius,
        // BY REFERENCE, which is the whole seam: one material means one albedo,
        // one tint arithmetic, one light and one air, so the sheet cannot drift
        // from the cubes it joins even under a sweep that moves them both.
        material: layer.voxel.material,
      });
      layer.meshes = [...layer.meshes, layer.shell.mesh];

      // The handle the measurements are taken through, and it now carries all
      // three grounds: what the disc came to, what the sheet came to, and what
      // is left of the grid.
      window.voxsuolo = layer.voxel;
      window.voxsuolo.shell = layer.shell.built;
      window.voxsuolo.legacy = layer.built.built;

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
