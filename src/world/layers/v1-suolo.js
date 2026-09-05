import { createGroundVoxel } from '../ground-voxel.js';
import { CENTRE, PLATEAU, createCampo, runInWorker } from '../voxel/index.js';
import { SPAWN } from '../layout.js';

// THE SOIL. Owned by V1.
//
// THE GROUND IS A PICTURE NOW, AND IT IS THE WHOLE WORLD.
//
// There were two grounds, then one and a remnant, then a disc and a sheet. What
// ships from this step is ONE: a ray-marched field (E-DECISIONI14, «il campo
// ray-marchato sostituisce i cubi del prato su tutto il mondo»), drawn on one
// box, in one draw, over two clipmaps that between them carry the meadow blade
// by blade round the walker and the whole boundary of the world out to four
// hundred metres. Nothing about the ground is triangles any more except the
// corridor's paving, which belongs to V3.
//
// WHAT DIED WITH IT, AND EACH ONE DIED OF THE SAME SENTENCE:
//
//   THE GREEDY MEADOW. Twenty six meshes of mat, one of bare earth and one of
//     meadow tops, 172 608 triangles of blade whose every edge multisampling
//     charged for. The field draws the same meadow with an overdraw of one.
//   THE SHEET (src/world/ground-shell.js). It ran from the rim of the disc to a
//     hundred metres and it was the whole of what this world said about the
//     ground out there: a plane, with a fitted basin under it and nothing on
//     it. E-DECISIONI13 replaced it with GROUND -- terraces down to the water,
//     a ridge that closes the horizon -- and ground is columns, so it is the
//     field that draws it.
//   THE OVERLAP AND THE FLICKER WITH IT. The sheet reached 0.6 m back under the
//     cubes because the rim of the disc is a staircase; two coplanar surfaces
//     with two materials on them is a state neither can win, and the
//     committente saw it. There is no rim to overlap.
//   THE CIRCUMFERENCE. «i fili restano a un raggio di tot metri dalla posa
//     iniziale» stops being true by construction and not by a bigger radius:
//     the near window follows the eye.
//
// AND HOW THE PIECES THAT ARE LEFT STAND TOGETHER:
//
//   the ground       ONE box, one draw, two pictures. src/world/voxel/campo-
//                    field.js, and the arithmetic behind it is the same
//                    columnSpec/layMat the cubes were cut from.
//   the corridor     still the greedy's, and still three baked maps and a law
//                    of slabs: the field carries the PATH material and stands
//                    aside on it, so the family that owns the stone draws it.
//   under the blocks a block's own footprint has no column in it; what is under
//                    it is the plane the meadow around it stands on, answered
//                    by groundHeightAt and drawn by nothing.
//   the grass        is still planted on the FIELD and not on the picture.
//   the walker       stands on the STORE, which now reaches the whole world:
//                    groundHeightAt in src/world/contracts.js.
//
// AND THE GROUND'S FOUR ATLASES ARE STILL NOT ASKED FOR HERE. See the delivery
// note in assets-src/assets.d/v1-suolo.json: retiring them is E-V4f.4's joint
// act of V1, V3 and V4 through the coordinator and not a layer's to take alone.

/**
 * What the address asks this layer for.
 *
 * EVERY ONE OF THEM IS A MEASURING HANDLE AND NONE OF THEM IS A PREFERENCE. A
 * page that only ever runs with the answer that ships can say the answer is
 * there; it cannot say what it is worth.
 *
 *   suolo=cubi     ALSO build the greedy disc, and hand the field the line that
 *                  makes it stand aside over it. This is the one way the two
 *                  representations can be priced against each other inside a
 *                  SINGLE opening of the page, which is the only condition
 *                  under which a before-and-after is a reading about the change
 *                  and not about the machine (E-V7k). Without it the greedy is
 *                  not built at all and its worker cuts the corridor alone.
 *   voxradius=N    lay that disc at N metres instead of at the tier's.
 *   voxdispose=0   keep the JavaScript copy of every buffer after the upload
 *   voxbound=walk  walk the vertices for the box instead of taking the worker's
 *   voxdetail=N    how far the mat is drawn blade by blade, for the disc
 *   voxblock=N     and the block it is sampled in beyond that
 *   camporaggi=N   sub-pixel rays a fragment marches: the dial the
 *                  scintillation is fought on, and the one E-DECISIONI14 spends
 *                  the multisampling's own 1.4 ms into
 *   campopassi=N   the ceiling on the steps of one ray
 *   campotop=N     the level of the pyramid the traversal starts at
 *   campolod=N     how many pixels a cell must cover before a ray may stop at it
 *   campoombra=0   the sun's own march off, to price it
 *   campodepth=0   gl_FragDepth off, to price the early test it costs
 *   campodebug=2   magenta where a ray ran out without finding anything
 */
function asked() {
  const query = new URLSearchParams(window.location.search);
  const asAsked = Number(query.get('voxradius'));
  const raw = query.get('voxdetail');
  const askedDetail = raw === null ? Number.NaN : Number(raw);
  const rawBlock = query.get('voxblock');
  const askedBlock = rawBlock === null ? Number.NaN : Number(rawBlock);
  return {
    dispose: query.get('voxdispose') !== '0',
    boundingFromWorker: query.get('voxbound') !== 'walk',
    radius: Number.isFinite(asAsked) && asAsked > 0 ? asAsked : null,
    detail: Number.isFinite(askedDetail) && askedDetail >= 0 ? askedDetail : null,
    block: Number.isFinite(askedBlock) && askedBlock >= 1 ? askedBlock : null,
    cubes: query.get('suolo') === 'cubi',
    campoRays: Number(query.get('camporaggi')) > 0 ? Number(query.get('camporaggi')) : null,
    campoSteps: Number(query.get('campopassi')) > 0 ? Number(query.get('campopassi')) : null,
    campoTop: query.get('campotop') === null ? null : Number(query.get('campotop')),
    campoLod: Number(query.get('campolod')) > 0 ? Number(query.get('campolod')) : null,
    campoShadow: query.get('campoombra') !== '0',
    campoDepth: query.get('campodepth') !== '0',
    campoDebug: Number(query.get('campodebug')) || 0,
  };
}

const layer = {
  id: 'v1-suolo',

  meshes: [],

  /** The corridor's own stone, and the greedy disc when a bench asks for it. */
  voxel: null,

  /** The ground: two clipmaps, one box, one draw. */
  campo: null,

  dress: {
    // THE PAVING'S THREE MAPS AND THE SHEETS OF THE SOIL. The corridor is
    // columns of the greedy and its colour comes off three baked maps; the
    // grain inside a face is 1 247 bytes of grey squares, one to a family, cut
    // out of the day target -- research C measured it two to five times short
    // on every material of the ground, and no arithmetic on a cell can produce
    // it, because it is a picture of what a face is MADE OF rather than a field
    // of where the face stands. The field reads the same array by reference.
    needs: ['path-joint', 'path-tone', 'path-grain', 'soil-sheets'],

    /**
     * @param {object} assets  keyed by asset id, plus what the hub knows
     */
    build(assets) {
      const wanted = asked();
      // WHERE THE RADIUS COMES FROM, AND WHAT IT STILL DECIDES. It is no longer
      // the size of the WORLD -- the field draws every metre of that, and the
      // plateau where the meadow's law gives way to the boundary is
      // src/world/voxel/confine.js's -- so what a tier's `voxelDiscRadius`
      // governs now is how far the greedy is asked to cut, which matters for
      // the corridor it carries and for the bench arm that prices it.
      const radius = wanted.radius ?? assets.voxelDiscRadius ?? PLATEAU;

      // ------------------------------------------------- THE CORRIDOR'S STONE
      // AND THE GREEDY IS STILL BUILT, FOR ONE FAMILY AND NOT FOR THE MEADOW.
      // The paving is three baked maps and a law of slabs (E-SENT4) and it is
      // V3's, not this step's: the field carries the PATH material so a ray
      // stops on the stone at the right height and stands aside, and what draws
      // it is the same gathered mesh it has always been. The mat is NOT cut --
      // `grain` false -- so the disc costs the ground's own 0.65 quads a column
      // instead of the mat's 4.2, and the twenty six meshes of blade are not
      // built at all.
      layer.voxel = createGroundVoxel({
        ...wanted,
        radius,
        grain: wanted.cubes,
        families: wanted.cubes ? null : ['paving'],
        paving: assets['path-joint'] && assets['path-tone'] && assets['path-grain']
          ? {
            joint: assets['path-joint'],
            tone: assets['path-tone'],
            grain: assets['path-grain'],
          }
          : null,
        sheets: assets['soil-sheets'] || null,
        focus: {
          x: SPAWN.x,
          z: SPAWN.z,
          detail: wanted.detail ?? undefined,
          block: wanted.block ?? undefined,
        },
      });

      // ------------------------------------------------------------ THE GROUND
      // BUILT AFTER THE STONE, for one reason: the grain. The strip of grey
      // squares is cut into an array texture ONCE, by the engine that hangs the
      // corridor, and the field is handed that very object -- one upload, one
      // binding, and one grain that cannot be two.
      layer.campo = createCampo({
        // THE PLATEAU AND NOT THE TIER'S DISC: the field is the world, and
        // where the meadow's law stops is a property of the world.
        radius: PLATEAU,
        sheets: layer.voxel.settings.sheet,
        depth: wanted.campoDepth,
        rays: wanted.campoRays ?? 2,
        // The engine's own worker seat, handed in rather than imported, so that
        // the window holds no opinion about how a thread is started.
        worker: runInWorker,
      });

      // ONE GROUP AND NOT TWENTY SIX MESHES, because the hub hangs what a layer
      // built at the moment it built it and the chunks are still being cut in a
      // worker at that moment.
      layer.meshes = [layer.voxel.group, layer.campo.group];

      const u = layer.campo.material.uniforms;
      if (wanted.campoSteps) u.uSteps.value = wanted.campoSteps;
      if (wanted.campoTop !== null) u.uTopLevel.value = wanted.campoTop;
      if (wanted.campoLod) u.uLodGain.value = wanted.campoLod;
      u.uHorizon.value = wanted.campoShadow ? 1 : 0;
      u.uDebug.value = wanted.campoDebug;
      layer.campo.start(SPAWN.x, SPAWN.z);

      // ---------------------------------------------------------- THE BENCH
      // ONE LINE, BOTH PROGRAMS. With `suolo=cubi` the field stands aside over
      // the whole disc and the greedy draws it, so the two can be priced in one
      // opening of the page. Without it uCut.w is nought, which is a comparison
      // of a uniform on a branch neither program ever takes.
      if (wanted.cubes) {
        const line = layer.campo.setCut(0, 0, -1, 1);
        for (const family of [
          layer.voxel.material, layer.voxel.earthMaterial, layer.voxel.bladeMaterial,
        ]) {
          if (!family || !family.uniforms.uCut) continue;
          family.uniforms.uCut.value = line.cut;
          family.uniforms.uCutDisc.value = line.disc;
        }
      }

      // The handles the measurements are taken through.
      window.voxsuolo = layer.voxel;
      window.voxcampo = layer.campo;

      return layer.voxel;
    },
  },

  /**
   * Height of the cube tops under a point, or null where the disc lays none.
   *
   * Published rather than wired: the one seat that has to answer for the whole
   * world's floor is groundHeightAt in src/world/contracts.js.
   */
  topAt(x, z) {
    return layer.voxel ? layer.voxel.topAt(x, z) : null;
  },

  update(frame) {
    if (layer.voxel) layer.voxel.update();
    // AND THE WINDOW FOLLOWS THE EYE, which is the whole of what the committente
    // asked for when he wrote «i fili restano a un raggio di tot metri dalla
    // posa iniziale». The hub already hands every layer where the eye is, so
    // nothing new had to be told to anybody.
    if (layer.campo) layer.campo.update(frame && frame.eye);
  },
};

export default layer;
