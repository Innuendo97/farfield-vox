import { createGroundVoxel } from '../ground-voxel.js';
import { createGroundShell } from '../ground-shell.js';
import { DISC_RADIUS } from '../voxel/index.js';
import { setGroundDiscRadius } from '../contracts.js';

// THE SOIL. Owned by V1.
//
// THE CUBES ARE THE WORLD NOW, AND THE BENT GRID IS GONE WITH THE LAST THING IT
// DREW.
//
// There were two grounds, then one and a remnant: the meadow became cubes to the
// tier's radius and a sheet from there to a hundred metres, and what was left of
// src/world/terrain.js was the corridor and the few square metres under a
// block's own footprint. The corridor became COLUMNS of this disc at step 4, and
// on the day it did, the remnant had nothing left to draw -- 6 145 quads laid
// under cubes that cover them, and it had already had to drop its own corridor
// band to stop fighting the paving for the same millimetre. It is deleted rather
// than cut down a second time.
//
// HOW THE TWO THAT ARE LEFT STAND TOGETHER, WHICH IS DECLARED AND NOT INCIDENTAL:
//
//   inside the disc   ten centimetre cubes, carrying the carpet the committente
//                     chose (E-DECISIONI.1) -- the grain, the piles against the
//                     stone and the piles in the open meadow -- and the corridor
//                     as one of the families of their tops.
//   under the blocks  a block's own footprint has no cubes in it; what is under
//                     it is the plane the meadow around it stands on, answered
//                     by groundHeightAt and drawn by nothing, because a block
//                     covers it and a body is kept out of it.
//   beyond the disc   the SHEET, src/world/ground-shell.js, one draw out to a
//                     hundred metres, on the same step and at the same level as
//                     the cubes' own tops, wearing their material by reference.
//   past a hundred    V5's, and nothing of V1's reaches there any more.
//   the grass         is still planted on the FIELD and not on the cubes, so a
//                     card can sit a quarter of a metre out over the same range.
//   the walker        stands on the STORE now (step 6), which is the one seat
//                     that answers for the world's floor: groundHeightAt in
//                     src/world/contracts.js.
//
// AND THE PILES ARE THE OPEN QUESTION UNDER THAT LAST LINE, for the grass and
// not for the walker any more: the carpet stands two to four voxels proud of the
// field in the open meadow, so a card planted on the field can sit that far
// under the cubes it grows out of. It is priced, it is the committente's choice,
// and the seat that would close it is V4's.
//
// AND THE GROUND'S FOUR ATLASES ARE NOT ASKED FOR HERE ANY MORE. They were
// declared because the grid ate them; nothing eats them now -- the meadow's
// colour is arithmetic in src/world/voxel/material.js and the paving's is its
// own three maps -- so the need goes with the mesh, which is the rule this file
// already kept. THE DELIVERY IS NOT TOUCHED: terrain-albedo, terrain-light,
// terrain-detail and terrain-path are still declared critical in
// assets-src/assets.d/v1-suolo.json and still downloaded, because retiring them
// is E-V4f.4's joint act of V1, V3 and V4 through the coordinator and not a
// layer's to take alone. What has changed is the fact that condition was waiting
// on: the atlas has NO reader at all now, where it had 16.85% of one.


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

  /** The voxel disc. */
  voxel: null,

  /** The sheet beyond it. */
  shell: null,

  dress: {
    // AND THE PAVING'S THREE MAPS ARE THIS LAYER'S ONLY NEED NOW.
    //
    // They were declared by the layer that hung the corridor's own surface, and
    // that surface is gone: the corridor is columns of THIS disc and its tops
    // are one of the three families this layer's engine draws. An asset is
    // needed where it is eaten -- which is also why the ground's own four have
    // left this list: see the head of the file.
    // AND THE SHEETS OF THE SOIL, which is this layer's own and not a guest.
    // 1 247 bytes of grey squares delivered, one to a family and orientation,
    // cut out of
    // the day target: the grain INSIDE a face, which research C measured to be
    // two to five times short on every material of the ground and which no
    // arithmetic on a cell can produce, because it is a picture of what a face
    // is made of rather than a field of where the face stands.
    needs: ['path-joint', 'path-tone', 'path-grain', 'soil-sheets'],

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
        // Nought is a world with no grain inside its faces, which is the world
        // that shipped yesterday rather than a broken one: the engine builds a
        // neutral array of its own and the gain goes to nought with it.
        sheets: assets['soil-sheets'] || null,
      });
      // ONE GROUP AND NOT TWENTY SIX MESHES, because the hub hangs what a
      // layer built at the moment it built it and the chunks are still being
      // cut in a worker at that moment. A group is on the scene from the
      // start and the chunks arrive into it, which is also what keeps every
      // one of them separately visible to the frustum.
      layer.meshes = [layer.voxel.group];

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

      // The handle the measurements are taken through, and it carries both
      // grounds: what the disc came to and what the sheet came to.
      window.voxsuolo = layer.voxel;
      window.voxsuolo.shell = layer.shell.built;

      return layer.voxel;
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
