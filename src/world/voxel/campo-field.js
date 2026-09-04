import {
  Box2, DataTexture, Group, LinearSRGBColorSpace, NearestFilter, RGBAFormat,
  UnsignedByteType, Vector2,
} from 'three';
import { BLADE, BLADES_PER_VOXEL, CHUNK, VOXEL } from './columns.js';
import { CENTRE, DISC_RADIUS } from './worldgen.js';
import { CAMPO, CAMPO_ATLAS, CAMPO_BYTES, CAMPO_TILE, CAMPO_TILE_BYTES } from './campo.js';
import { campoBox, campoMaterial } from './campo-material.js';

// THE WINDOW THAT FOLLOWS THE WALKER, AND THE ONE CALL THAT MOVES IT.
//
// ===========================================================================
// THE SHAPE OF THE THING, AND WHY IT HAS NO EDGE.
//
// Losasso & Hoppe's geometry clipmap (2004) is a grid centred on the observer
// and updated TOROIDALLY: the picture never scrolls, the ADDRESS wraps, so
// walking out of the window on one side walks back into it on the other and the
// only work a step costs is regenerating the strip that just fell off the back.
// That is the whole of why this replaces a disc rather than enlarging one.
//
//   * there is no rim, so there is nothing for the shell to overlap and no
//     flicker where two surfaces claim one plane (§1.4 of the performance
//     dossier: OVERLAP = 0.6 m of coplanar z-fighting, which is the thing the
//     committente saw);
//   * there is no ring of detail anchored to the spawn, so «i fili restano a un
//     raggio di tot metri dalla posa iniziale» stops being true by construction
//     rather than by a bigger radius;
//   * and nothing is re-meshed. A chunk that comes into the window is one
//     texSubImage2D of its own square. There is no geometry to cut, no seam to
//     stitch and no upload to dose.
//
// THE WINDOW IS A WHOLE NUMBER OF CHUNKS AND THAT IS LOAD-BEARING. Eight chunks
// a side, a chunk 128 texels, the picture 1024: a chunk therefore lands on a
// multiple of its own size at every level of the pyramid and can never straddle
// the wrap. Seven writes a chunk, no clipping, no case analysis. A window that
// was not a whole number of chunks would need four writes a level and the
// arithmetic to decide them.
//
// ===========================================================================
// WHAT THE MAIN THREAD DOES, AND THE GATE IT IS UNDER.
//
// Nothing but the copy. Every byte is generated in the worker out of the same
// chunkColumns()/layMat() the greedy mesher reads (see ./campo.js), and what
// arrives here is a typed array that is MOVED and not copied. The gate is the
// one src/world/ground-voxel.js has carried since the disc: nothing over eight
// milliseconds on the thread the walker is on. A chunk costs seven
// sub-rectangle writes of 87 kB in total, and the run of them is timed here
// rather than asserted -- `stats.worstUploadMs` is what a report quotes.
//
// AND THE WORKER STAYS ALIVE, which is the one habit of the disc that could not
// survive. The disc's worker is a one-shot: it cuts, it posts, it is terminated
// at `done`. A window that follows a walker asks for a chunk every few seconds
// for as long as the walker walks, and a thread started per chunk would pay its
// own module graph -- measured at 159 to 284 ms -- every time.
// ===========================================================================

/** How many chunks the window is across. */
const CHUNKS = CAMPO.side / CAMPO.tile;

/** Blade columns to a chunk. */
const TILE = CHUNK * BLADES_PER_VOXEL;

const wrap = (v, n) => ((v % n) + n) % n;

/**
 * The clipmap, its box and the worker that fills it.
 *
 * @param {object} options
 * @param {number} options.radius  how far the ground reaches, the layer's own
 * @param {object} options.sheets  the delivered strip of grey squares
 * @param {boolean} options.depth  write gl_FragDepth; false prices the early
 *                                 depth test this draw gives up
 * @param {Function} options.worker  a factory for the engine's worker, handed
 *                                 in so this file imports no page machinery
 */
export function createCampo({
  radius = DISC_RADIUS, sheets = null, depth = true, worker: makeWorker = null,
} = {}) {
  const group = new Group();
  group.name = 'campo';

  // THE PICTURE. One RGBA8 image carrying every level of the pyramid side by
  // side; see CAMPO_ATLAS in ./campo.js for why they are not a mip chain.
  const data = new Uint8Array(CAMPO_ATLAS.width * CAMPO_ATLAS.height * 4);
  const texture = new DataTexture(
    data, CAMPO_ATLAS.width, CAMPO_ATLAS.height, RGBAFormat, UnsignedByteType,
  );
  // NEAREST IN BOTH DIRECTIONS AND NO MIPS, and that is the faithful answer as
  // well as the cheap one. Every read is a texelFetch at a whole texel the
  // traversal has already decided on; a filter across two texels would return a
  // height that belongs to neither column and the ray would stop in the air
  // between two blades.
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  // The bytes are numbers and not a colour: a transfer function on them would
  // move every height in the world by the sRGB curve.
  texture.colorSpace = LinearSRGBColorSpace;
  texture.needsUpdate = true;

  // The one source rectangle every copy is made from, reused so that a chunk
  // costs no allocation. It is deliberately never given to a material: three
  // takes the direct texSubImage2D path only while the source has no GL
  // texture of its own, and a source that had been bound once would fall back
  // to a framebuffer blit for ever after.
  const tileData = new Uint8Array(CAMPO_TILE_BYTES);
  const tile = new DataTexture(
    tileData, CAMPO_TILE.width, CAMPO_TILE.height, RGBAFormat, UnsignedByteType,
  );
  tile.flipY = false;
  tile.colorSpace = LinearSRGBColorSpace;

  const material = campoMaterial({ texture, sheets, depth });
  // THE RENDERER ARRIVES WITH THE FIRST DRAW AND NOT FROM A LAYER. Nothing in
  // src/world/layers is handed one, and reaching for the page's own would put a
  // piece of the engine somewhere it could not run. The copy still may NOT
  // happen here -- this is called inside a render pass, and binding a
  // framebuffer in the middle of one is how a frame gets a hole in it -- so the
  // renderer is only REMEMBERED, and the tiles are laid on the next update().
  const mesh = campoBox(material, (webgl) => {
    if (renderer) return;
    renderer = webgl;
    renderer.initTexture(texture);
  });
  group.add(mesh);

  const stats = {
    tiles: 0,
    tilesAsked: 0,
    workerMs: 0,
    worstWorkerMs: 0,
    uploadMs: 0,
    worstUploadMs: 0,
    bytes: CAMPO_BYTES,
    tileBytes: CAMPO_TILE_BYTES,
    levels: CAMPO.levels,
    side: CAMPO.side,
    cell: CAMPO.cell,
    moves: 0,
    tallest: 0,
    radius,
  };

  // Which chunk each slot of the window is holding, so that a walk that comes
  // back to where it started asks for nothing.
  const held = new Map();
  const asked = new Set();
  const pending = [];
  const arrived = [];
  let renderer = null;
  let centre = null;

  const srcRegion = new Box2(new Vector2(), new Vector2());
  const dstPosition = new Vector2();

  /** Lays one chunk's tile into the picture: seven writes, no clipping. */
  function place(bx, bz) {
    if (!renderer) return 0;
    const started = performance.now();
    for (let level = 0; level < CAMPO.levels; level += 1) {
      const size = TILE >> level;
      const src = CAMPO_TILE.origins[level];
      const atlas = CAMPO_ATLAS.origins[level];
      srcRegion.min.set(src.x, src.y);
      srcRegion.max.set(src.x + size, src.y + size);
      dstPosition.set(
        atlas.x + wrap(bx >> level, CAMPO.side >> level),
        atlas.y + wrap(bz >> level, CAMPO.side >> level),
      );
      renderer.copyTextureToTexture(tile, texture, srcRegion, dstPosition);
    }
    const ms = performance.now() - started;
    stats.uploadMs += ms;
    if (ms > stats.worstUploadMs) stats.worstUploadMs = ms;
    return ms;
  }

  function receive(message) {
    if (message.kind !== 'campo') return;
    arrived.push(message);
    stats.workerMs += message.ms;
    if (message.ms > stats.worstWorkerMs) stats.worstWorkerMs = message.ms;
  }

  /**
   * Lays what has arrived, and NOT ALL OF IT: the upload is dosed.
   *
   * The lesson is voxel-tools' and it is about the thread and not the card --
   * «typically only one mesh» a frame, because what a walker feels is a long
   * task and not a byte. A window that has just been opened has sixty four
   * chunks to lay; a walker who takes a step has one. Two a frame is what makes
   * the first case invisible without making the second late.
   */
  function flush(budget) {
    if (!renderer) return;
    let laid = 0;
    while (arrived.length && laid < budget) {
      const message = arrived.shift();
      tileData.set(message.data);
      place(message.bx, message.bz);
      held.set(`${message.cx},${message.cz}`, true);
      asked.delete(`${message.cx},${message.cz}`);
      stats.tiles += 1;
      laid += 1;
      if (message.tallest > stats.tallest) {
        stats.tallest = message.tallest;
        // The box has to contain the tallest thing the window holds and not a
        // metre more: every metre of box is depth the ray crosses before it
        // reaches anything.
          const height = material.uniforms.uHeight.value;
        height.y = Math.max(0.5, message.tallest * CAMPO.unit + CAMPO.cell);
        // AND THE BOX ITSELF FOLLOWS IT. The traversal solves its own entry
        // against these two heights, but a fragment has to EXIST before it can
        // solve anything: a box shorter than the field would have no pixel
        // over the tallest blade, and one taller would be depth the ray
        // crosses to reach nothing.
        mesh.scale.y = height.y - height.x;
        mesh.position.y = (height.y + height.x) / 2;
      }
    }
  }

  let thread = null;

  function ask(list) {
    if (!list.length) return;
    for (const c of list) asked.add(`${c.cx},${c.cz}`);
    stats.tilesAsked += list.length;
    if (thread) thread.postMessage({ job: 'campo', radius, chunks: list });
    else pending.push(...list);
  }

  /**
   * Where the window stands, in chunks, for a walker at this point.
   *
   * Half a chunk either side of the middle: the window is eight chunks and the
   * walker is in one of them, so it reaches between 22.4 and 28.8 metres in
   * every direction depending where in their own chunk they stand. Snapping to
   * the chunk is what keeps every write aligned.
   */
  function windowAt(x, z) {
    return {
      cx: Math.floor(Math.floor(x / BLADE) / TILE) - CHUNKS / 2 + 1,
      cz: Math.floor(Math.floor(z / BLADE) / TILE) - CHUNKS / 2 + 1,
    };
  }

  function moveTo(x, z) {
    const w = windowAt(x, z);
    if (centre && centre.cx === w.cx && centre.cz === w.cz) return;
    centre = w;
    stats.moves += 1;
    const wanted = [];
    const keep = new Set();
    for (let j = 0; j < CHUNKS; j += 1) {
      for (let i = 0; i < CHUNKS; i += 1) {
        const cx = w.cx + i;
        const cz = w.cz + j;
        const key = `${cx},${cz}`;
        keep.add(key);
        if (!held.has(key) && !asked.has(key)) wanted.push({ cx, cz });
      }
    }
    // A slot's old tenant is forgotten the moment its own square is claimed by
    // somebody else: there is nothing to unload, because the new chunk writes
    // over exactly the texels the old one owned.
    for (const key of [...held.keys()]) if (!keep.has(key)) held.delete(key);
    const lo = { x: w.cx * TILE * BLADE, z: w.cz * TILE * BLADE };
    const hi = { x: (w.cx + CHUNKS) * TILE * BLADE, z: (w.cz + CHUNKS) * TILE * BLADE };
    material.uniforms.uBounds.value.set(lo.x, lo.z, hi.x, hi.z);
    const height = material.uniforms.uHeight.value;
    mesh.position.set((lo.x + hi.x) / 2, (height.y + height.x) / 2, (lo.z + hi.z) / 2);
    ask(wanted);
  }

  return {
    group,
    mesh,
    material,
    texture,
    stats,

    /**
     * The renderer, which this needs for one thing only: the copy.
     *
     * It is handed over rather than imported because a picture that reached for
     * the page's renderer would be a piece of the engine that cannot run
     * anywhere else, and every other file behind ./index.js can.
     */
    attach(webglRenderer) {
      renderer = webglRenderer;
      // Allocated before the first copy: copyTextureToTexture writes INTO a
      // texture and cannot create one.
      renderer.initTexture(texture);
    },

    /** Starts the worker and asks for the first window. */
    start(x, z) {
      if (makeWorker && !thread) {
        thread = makeWorker({ job: 'campo', radius }, receive);
      }
      moveTo(x, z);
      if (thread && pending.length) {
        thread.postMessage({ job: 'campo', radius, chunks: pending.splice(0) });
      }
    },

    /** One frame: where the walker stands decides where the window stands. */
    update(eye, budget = 2) {
      // The picture is laid FIRST, so that a chunk that arrived while the last
      // frame was drawn is on the card before the window is asked to move
      // again: the other order leaves a slot claimed by a chunk whose bytes are
      // still in a queue, and the ray reads whatever the last tenant left.
      flush(centre === null ? Infinity : budget);
      if (!eye) return;
      moveTo(eye.x, eye.z);
    },

    /** Lays everything that has arrived, whatever it costs: for a bench. */
    settle() {
      flush(Infinity);
    },

    /** Every chunk of the window is in the picture. */
    ready() {
      return centre !== null && asked.size === 0 && arrived.length === 0 && stats.tiles > 0;
    },

    /**
     * WHERE THE LINE BETWEEN THE FIELD AND THE CUBES RUNS, in the world's XZ.
     *
     * One seat, handed to both programs: see CAMPO_CUT_GLSL in ./campo.js. The
     * plane is (nx, nz, d) and the field owns the half-space where
     * nx*x + nz*z + d is not negative.
     */
    setCut(nx, nz, d, on = 1) {
      material.uniforms.uCut.value = [nx, nz, d, on];
      material.uniforms.uCutDisc.value = [CENTRE.x, CENTRE.z, radius + VOXEL, 0];
      return {
        cut: material.uniforms.uCut.value,
        disc: material.uniforms.uCutDisc.value,
      };
    },

    dispose() {
      if (thread) thread.terminate();
      thread = null;
      texture.dispose();
      tile.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}
