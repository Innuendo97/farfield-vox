import { Group } from 'three';
import { createLooseStone } from '../loose-stone.js';
import { createMonoliths } from '../monoliths.js';
import { createRocks } from '../rocks.js';
import { createMasonry, runInWorker, stoneTile } from '../voxel/index.js';
import { stairSpecs, stoneSpecs } from '../stone.js';
import MASONRY_SPEC from '../../../assets-src/monoliths/masonry-spec.json';

// THE BUILT STONE. Owned by V2.
//
// The six blocks, the stair, the platform and the rocks — and as of this
// delivery not one of them is a download. The blocks used to arrive as a glTF
// scene with a painted albedo and a Cycles bake of the light on it, and the
// stair as a second mesh with a second atlas; they are courses of masonry now,
// cut from src/world/layout.js and from the measurement of the two targets that
// assets-src/monoliths/masonry-spec.json carries. What that buys is not weight:
// it is that the shape of this world can be argued with in a text file instead
// of in a renderer nobody has any more.
//
// AND THE ROCKS WENT THE SAME WAY, which is what empties the last phase out of
// this layer. They were the last two assets in it — a glTF scene of decimated
// spheres and a Cycles bake of the light on them — and they are piles of cubes
// on the world's own lattice now, generated from the plan the reference camera
// traced. So `plant` is gone entirely rather than emptied: a phase that asks
// for nothing and builds nothing is a hook somebody has to keep reading.
//
// IT ASKS FOR NOTHING AT THIS ARRIVAL, which is why `needs` is empty. The stone
// is arithmetic and the arithmetic is off the thread the walker is on, so the
// first walkable frame no longer waits on four textures and a model.
//
// AND IT ARRIVES ONE BLOCK AT A TIME. The stone is cut in the engine's worker
// and posted a block per message — cutting all eight in one and handing them
// over together would put eight geometries, eight materials and eight shader
// compilations into a single task on exactly the thread the work was moved off.
// So the layer hangs a GROUP at dress and fills it as the messages land: the
// first wall is standing while the last is still being cut.
//
// AND THE STAIR NO LONGER GLOWS, which is the one thing this file lost rather
// than gained. It used to build six emissive quads inset into the risers and
// light them at 0.30, pushed to 0.54 with the third block, on the authority of
// a PHOTOREAL reference this world has superseded. The two voxel targets draw
// no strip: the treads measure B/G 1.02 — grey stone under a blue sky, no
// emission — in the day frame and in the night one (Deviazione 1 of the session
// verbale, measured in v2-pietra/an/scalinata.mjs). What the targets DO show at
// the foot of the blocks — the rhombus and the hoop at the fifth — is built by
// src/world/monoliths.js and is untouched: they are content, and the strip was
// a signature this world was never asked for.

const layer = {
  id: 'v2-pietra',

  meshes: [],

  monoliths: null,
  stone: null,
  rocks: null,
  loose: null,
  worker: null,

  /** Every wall that has landed, by the id of the piece it belongs to. */
  built: new Map(),

  dress: {
    // NOTHING. Every byte the six blocks and the stair used to cost — a glTF
    // scene, three stone sheets and two stair atlases — is arithmetic now.
    needs: [],

    build() {
      layer.stone = new Group();
      layer.stone.name = 'stone';
      layer.monoliths = createMonoliths();

      // THE ROCKS ARE BUILT HERE NOW AND NOT AT `plant`, which is the whole of
      // what their pivot costs this file. They used to be a glTF scene and a
      // light atlas — two downloads, a phase to wait for them in, and a
      // `needs` list — and they are arithmetic on the same lattice as the
      // stone now, so they stand with it in the first walkable frame.
      layer.rocks = createRocks();

      const pieces = [...stoneSpecs(MASONRY_SPEC), ...stairSpecs(MASONRY_SPEC)];
      const engraved = new Set(stoneSpecs(MASONRY_SPEC).map((s) => s.id));

      // AND THE LOOSE STONE, which is arithmetic like the rest and so stands in
      // the first walkable frame beside them. It is cut on THIS thread and not
      // in the worker, and the reason is its size: two hundred and some cubes is
      // under a millisecond of one task, where posting it would cost a message
      // and a second geometry upload for a mesh smaller than any one wall.
      //
      // It reads the specs the worker is being handed, so the turf on a head is
      // laid over the head the worker is about to cut -- one description of what
      // a head is, cut twice.
      layer.loose = createLooseStone(stoneSpecs(MASONRY_SPEC));
      let tile = null;
      // The disc is not asked for: the meadow is V1's and does not come from
      // here, and a worker that cut it anyway would spend tens of milliseconds
      // and post twenty megabytes nobody in this world reads.
      layer.worker = runInWorker({ blocks: pieces, disc: false }, (message) => {
        if (message.kind === 'tile') {
          tile = stoneTile(message.data, message.side);
          for (const [, piece] of layer.built) {
            piece.material.uniforms.tStone.value = tile;
          }
          // ONE TILE FOR THE WALL AND THE ROCKS, handed to both. They are the
          // same stone at two scales — how often it repeats is each material's
          // own number and the grain is not — so a second 512 square of noise
          // for the rocks would be a tenth of a second of held frame and a
          // second opinion about what this stone looks like.
          layer.rocks.setTile(tile);
          return;
        }
        if (message.kind !== 'masonry') return;
        const spec = pieces.find((p) => p.id === message.id);
        const piece = createMasonry(spec, tile, message.built, engraved.has(spec.id));
        layer.stone.add(piece.mesh);
        layer.built.set(spec.id, piece);
        if (engraved.has(spec.id)) layer.monoliths.attach(spec.id, piece);
      });

      // WHAT THIS LIST IS FOR, BEYOND HANGING IT. The hub adds these to the
      // scene; they are also the only true statement of what this layer costs,
      // and the gate's budget is counted off them by object identity rather
      // than off a pattern of names — a second, hand-written rule for what
      // belongs to V2 is how seven meshes went uncounted once already.
      layer.meshes = [layer.stone, ...layer.rocks.meshes, ...layer.monoliths.meshes,
        layer.loose.mesh];
      return layer.monoliths;
    },
  },

  /** The engraving of one section, once its text has been drawn. */
  setEngraving(id, texture) {
    if (layer.monoliths) layer.monoliths.setEngraving(id, texture);
  },

  /**
   * How lit one block is, nought to one, as the walker comes and goes.
   *
   * IT USED TO ANSWER FOR THE STAIR AS WELL — the third block's focus pushed
   * the riser strip from 0.30 to 0.54 — and the stair is indeed part of that
   * block. But the strip itself is not in the targets, so what focus reaches on
   * this structure is the writing and the rhombus, and nothing on the run.
   */
  setFocus(id, amount, opened = 0) {
    if (!layer.monoliths) return;
    layer.monoliths.setFocus(id, amount, opened);
  },

  /** What the rocks are costing, for the development panel. */
  get rockTriangles() {
    return layer.rocks ? layer.rocks.triangles : 0;
  },

  /** And what the loose stone is costing, counted the same way. */
  get looseTriangles() {
    return layer.loose ? layer.loose.triangles : 0;
  },

  /** What the built stone is costing, for the development panel and the gate. */
  get stoneTriangles() {
    let triangles = 0;
    for (const [, piece] of layer.built) {
      // READ OFF THE BUFFER THAT IS ACTUALLY BOUND and not off the cut this
      // piece was born with: since the wall has two of them, `piece.quads` is
      // the near one's count and would report the whole hub's stone at its
      // worst from anywhere in the world.
      const index = piece.mesh.geometry.getIndex();
      triangles += index ? index.count / 3 : piece.quads * 2;
    }
    return triangles;
  },

  /** How many of the six are laid as volumes right now, for the panel. */
  get nearBlocks() {
    let near = 0;
    for (const [, piece] of layer.built) if (piece.lod && piece.lod() === 'near') near += 1;
    return near;
  },

  update({ elapsed, eye }) {
    if (layer.monoliths) layer.monoliths.update(elapsed);
    // WHICH OF THE SIX ARE WORTH THEIR VOLUMES. Asked every frame and answered
    // by a distance, because it costs two subtractions a block and the swap
    // itself only happens when the answer changes. See createMasonry's atRange:
    // the near wall is sixteen times the triangles of the far one, and past
    // NEAR_METRES it buys a fifth of a pixel of relief.
    // `.values()` e non `.entries()`: la chiave non serve, e ogni voce di
    // `entries()` e' un array di due elementi costruito per essere buttato.
    if (eye) for (const piece of layer.built.values()) if (piece.atRange) piece.atRange(eye);
  },
};

export default layer;
