import {
  BufferAttribute, BufferGeometry, Group, Mesh, Sphere, Vector3,
} from 'three';
import {
  BLADE, CHUNK, DISC_RADIUS, NO_COLUMN, VOXEL,
  bladeSettings, earthSettings, pavingMaterial as makePaving, pavingSettings, runInWorker,
  voxelMaterial, voxelSettings,
} from './voxel/index.js';
import { sheetArray } from './voxel/sheet.js';

// THE MEADOW AS CUBES, STANDING IN THE WORLD RATHER THAN ON A BENCH.
//
// The engine cuts the disc and this hangs it: one chunk of sixty four columns is
// one mesh, all of them share one material, and every buffer is cut off the
// thread the walker is on and handed over instead of copied.
//
// WHAT A BENCH DOES NOT HAVE TO ANSWER FOR, AND THIS DOES: somebody is standing
// in this world while the disc arrives. The whole cost of arriving therefore has
// to fall somewhere they cannot feel, and every one of the four things below is a
// number taken where it happens rather than an intention.
//
// 1. NOTHING OVER EIGHT MILLISECONDS ON THE THREAD THE WALKER IS ON. The disc is
//    fifty five thousand columns and one height costs 926 ns, so the field is
//    sampled in the worker. What is left here is the handover, and it is timed
//    from the first statement of the handler and again across the upload,
//    because the browser's own long-task observer does not report under fifty
//    milliseconds and the gate is eight. The observer is kept as well: an entry
//    from it during the build would mean something the fine clock missed.
//
// 2. THE BOX COMES BACK FROM THE WORKER. It has to exist -- it is what lets the
//    frustum throw a chunk away, and the whole draw-call argument for chunking
//    is that a wedge of seventy degrees only asks for a few of them -- and
//    walking twenty thousand vertices for it a second time is main-thread work
//    the worker has already done. Passing `boundingFromWorker: false` walks them
//    anyway, which is how the saving is priced rather than asserted.
//
// 3. THE JAVASCRIPT COPY GOES AT THE UPLOAD. three.js keeps the array beside the
//    buffer for ever unless it is told not to, which on this disc is a second
//    copy of every vertex sitting in the heap doing nothing.
//
// 4. THE FIELD IS NOT SAMPLED UNTIL THE WORLD IS STANDING. The worker is asked
//    for the disc a frame after the ground was dressed, not during it: the two
//    are the same few cores, and a worker set going inside the dressing competes
//    for them with the one piece of the load the walker is actually waiting on.
//    Behind the opening scene this is still deep inside the orbit, so nothing is
//    delayed that anybody sees.
//
// WHERE THE DISC STOPS, AND WHOSE NUMBER THAT IS. It is the QUALITY TIER's, and
// it reaches this file as an argument (E-V1a, E-V1d): the walker's machine says
// how much ten centimetre ground it can hold, and the one place that answer is
// written down is src/core/quality.js. `DISC_RADIUS` is the engine's default and
// is used HERE only as the answer to "nobody said" — a radius decided in this
// file would be a second opinion about the size of the world, which is exactly
// what the constant existed to prevent. What is beyond the disc is the shell,
// src/world/ground-shell.js, which draws from the rim out to a hundred metres.

/**
 * How many frames the world is given to itself before the field is sampled.
 *
 * One, and one is what it has to be: the layer is built during the dressing and
 * the frame after it is the first frame the walker has actually been shown. See
 * the fourth note above for why the worker waits for it.
 */
const FRAMES_BEFORE_SAMPLING = 1;

const chunkKey = (cx, cz) => `${cx},${cz}`;

/**
 * The voxel meadow, as chunks the frustum can throw away one at a time.
 *
 * @param {object}  options
 * @param {boolean} options.dispose  drop the JavaScript copy of every buffer at
 *                                   the upload. False prices what it saves.
 * @param {boolean} options.boundingFromWorker  take the box the worker already
 *                                   computed. False walks the vertices here,
 *                                   which is what it costs to not do this.
 * @param {number}  options.radius   how far the ten centimetre ground reaches,
 *                                   in metres. The tier's, never this file's.
 * @param {object}  options.sheets   the delivered strip of grey squares, one to
 *                                   a family: the grain inside a face. Nought
 *                                   draws the world that shipped without one.
 * @returns {object} the group to hang, the floor the cubes make, and the numbers
 */
export function createGroundVoxel({
  dispose = true,
  boundingFromWorker = true,
  radius = DISC_RADIUS,
  paving = null,
  sheets = null,
  focus = null,
} = {}) {
  const group = new Group();
  group.name = 'ground-voxel';
  // EVERY CHUNK IS DRAWN THE MOMENT IT LANDS, and the alternative was measured
  // rather than assumed. Holding the disc back until it is whole would look
  // tidier and would fail the one gate this file has: a hidden subtree uploads
  // nothing, so the frame it is shown on carries every buffer of the disc at
  // once, where letting the chunks stand as they arrive spreads the same
  // uploads over the frames they arrive on AND lets the frustum keep the ones
  // behind the walker off the card entirely.
  //
  // What it costs is that the meadow grows in squares, in the order the engine's
  // chunk list is written. Behind the opening scene nobody is looking at the
  // world while that happens.

  // THE GRAIN'S ARRAY, CUT ONCE AND SHARED BY THE THREE FAMILIES. It is one
  // upload of 1 024 bytes for the whole world, and it is sliced here rather
  // than in each material for the reason every shared thing in this file is
  // shared: three copies of one texture is three uploads and three sampler
  // bindings for one picture that never changes.
  const sheetArrayTexture = sheetArray(sheets);
  const settings = { ...voxelSettings(), sheet: sheetArrayTexture };
  // ONE material for the whole disc and not one per chunk, which is what keeps
  // it a run of draws through a single program instead of a program switch a
  // chunk. Where each chunk stands is already in its own model matrix.
  const material = voxelMaterial(VOXEL, settings);

  // AND ONE MORE FOR THE BARE EARTH -- one for the WHOLE DISC and not one a
  // chunk, which is the whole reason the earth is gathered instead of hung as
  // it arrives. Twenty six chunks each hanging a second mesh would be twenty
  // six more draws against a budget of twenty two; one mesh carrying every bare
  // face in the world is ONE, and it is small enough that the frustum has
  // nothing to gain by cutting it up (v1-suolo/forma/f1/f2-campo.json: the bare
  // family is 6.5% of the faces).
  const earthTune = { ...earthSettings(), sheet: sheetArrayTexture };
  const earthMaterial = voxelMaterial(VOXEL, earthTune);

  // AND A THIRD FOR THE CORRIDOR, gathered the same way and for the same
  // reasons. The paving is the one family of this disc whose colour comes off a
  // map rather than out of a hash, so it is the one that can be absent: without
  // the three the painter bakes there is nothing to read, and the corridor's
  // rectangles are simply not hung. That is a picture with no paving in it and
  // it is the honest failure -- the alternative is grass drawn over the stone,
  // which is a wrong picture rather than a missing one.
  const pavingTune = paving ? { ...pavingSettings(), sheet: sheetArrayTexture } : null;
  const pavingMaterial = paving ? makePaving(VOXEL, pavingTune, paving) : null;

  // AND A FOURTH FOR THE MAT OF GRASS -- one for the whole disc, like the other
  // three, and its pieces hung a CHUNK AT A TIME, which is the one place this
  // family parts company with the earth and the paving.
  //
  // THE REASON IS THE SIZE AND IT IS MEASURED. The bare earth is 6.5% of the
  // faces of this disc and the paving is fifty two rectangles: gathering either
  // into one mesh costs a draw and saves twenty five, and the frustum had
  // nothing to gain on either. The mat is the biggest family in the world by an
  // order of magnitude, and the pose the campaign judges on stands at the
  // southern rim looking north -- so nearly half of it is behind the walker on
  // any frame. Hung as one mesh the card draws all of it every frame; hung a
  // chunk at a time the renderer's own sphere test throws away the half that is
  // not there, and what it costs is one draw a chunk.
  // AND IT IS BUILT AT THE BLADE'S OWN STEP AND NOT THE WORLD'S, which is a
  // measurement and not a tidy-up: everything the fragment rebuilds out of a
  // cube -- the joint at its edges, the lightened arris along its upper one,
  // which slice of the grain is laid on it -- has to be the size of the cube
  // being drawn. Built at the world's step the mat drew a joint straight through
  // the middle of every blade, and E-ERBA-A's own estimator read our blade at
  // 0.20 of a cube where the truth is 0.50, because it was counting those false
  // edges. The pigment stays on the world's column all the same: see uCellRatio
  // in ./material.js.
  const bladeTune = { ...bladeSettings(), sheet: sheetArrayTexture };
  const bladeMaterial = voxelMaterial(BLADE, bladeTune);
  // The bare faces as they arrive, chunk by chunk, in the chunk's own frame:
  // they are moved into the world's when the last one has landed.
  const soil = [];

  // Every chunk's own height map, by its chunk key: what the cubes make of the
  // floor, kept because the mesher already has the answer and asking the field
  // again costs 926 ns a point.
  const tops = new Map();

  const build = {
    planned: 0,
    landed: 0,
    quads: 0,
    // How many of the faces of the disc are the bare earth of the mounds, which
    // is the second family and the one extra draw.
    earthQuads: 0,
    // And how many are the mat of grass, which is the fourth and the one that
    // can move the price of this disc by an order of magnitude.
    matQuads: 0,
    columns: 0,
    rim: 0,
    quadsPerColumn: 0,
    insidePerColumn: 0,
    // The disc's own meshing, as the worker clocked it. Kept apart from the
    // wall clock below because the engine's worker cuts two other things first
    // and this ground asks for neither of them.
    workerMs: 0,
    // And what the worker spent BEFORE the disc, on its own clock: its module
    // graph and the two jobs this ground did not ask for. The pair splits the
    // whole run in two at the plan, which is the seam the verbale reports.
    startupMs: 0,
    // The radius the disc was actually laid at, said back by the thread that
    // laid it. Asked for and answered, so the two can be compared.
    radius: 0,
    startedAt: 0,
    // When the worker said what it was about to cut. Between this and startedAt
    // sits everything before the disc: the worker's own module graph, and the
    // two jobs the engine's worker does first that this ground did not ask for.
    // Kept because a build time that folded them in would be reported as the
    // cost of the disc and is not.
    plannedAt: 0,
    finishedAt: 0,
    // What is on the card, which is also what the heap gives back at the upload.
    bytes: 0,
    // ------------------------------------------------- what held the frame
    // The worst single message, whatever it carried, and the worst that carried
    // a chunk. Both from the first statement of the handler: what the gate is
    // about is how long this thread was held, and a handler timed from anywhere
    // else is timing something adjacent to the answer.
    worstMessageMs: 0,
    worstMessageKind: '',
    worstChunkMs: 0,
    // AND EVERY CHUNK'S OWN, not only the worst of them. Twenty six numbers, and
    // they are kept because a maximum on a machine running eight other things is
    // a reading about the machine: what says whether this ground holds the
    // thread is the shape of the whole set beside its worst.
    chunkMs: [],
    // The worst contiguous run of buffers going up inside one render, how many
    // buffers were in it, and how far apart they landed. See noteUpload() for
    // what this can and cannot say.
    worstUploadRunMs: 0,
    worstUploadRunBuffers: 0,
    uploadGaps: [],
    uploadsSeen: 0,
    // The box: what taking the worker's costs, or what walking the vertices does.
    boundingMs: 0,
    worstBoundingMs: 0,
  };

  // The browser's own observer, kept beside the fine clocks rather than instead
  // of them: it does not report under fifty milliseconds and the gate is eight,
  // so what it is here for is the opposite case -- an entry during the build
  // would mean a block the clocks above were not watching the right place for.
  const longTasks = [];
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({ start: Math.round(entry.startTime), ms: Math.round(entry.duration) });
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* a browser without the entry type answers by not having one */ }
  }

  // How far apart two buffers have to land before they are counted as two
  // separate runs of uploading. A run is contiguous inside one render and its
  // buffers land microseconds apart; two runs are a whole frame apart at least,
  // so anything in between would have to be a stall to be ambiguous.
  const RUN_GAP_MS = 4;

  let lastUploadAt = 0;
  let runOpenedAt = 0;
  let runBuffers = 0;

  /**
   * What a run of uploads cost the frame it happened in.
   *
   * WHERE THREE.JS ACTUALLY DOES THIS, because the obvious place is the wrong
   * one. A buffer does not go up when its mesh is drawn: the renderer walks the
   * scene first and hands EVERY visible geometry to the card during that walk,
   * before it has drawn anything at all. A clock opened on the hook that fires
   * before a mesh's own draw therefore reads the whole traversal and calls it
   * the upload, and reads it as seconds rather than as microseconds.
   *
   * What is left is the run itself, from its first buffer to its last. It is a
   * floor and not the whole cost -- the very first bufferData of a run has no
   * earlier stamp to be measured from -- so the gaps between buffers are kept
   * beside it, and the size of the blind spot is one of those rather than a
   * guess. The frame the run happened in is timed from outside, where a whole
   * task can be seen; this is what says how much of that frame was the disc.
   *
   * A BUFFER THAT NEVER COMES HERE IS A BUFFER THAT NEVER REACHED THE CARD, and
   * that is not a fault: the renderer skips the traversal of a chunk the frustum
   * has already thrown away, so the disc goes up as the walker turns rather than
   * all at once. It is why uploadsSeen can sit under the number of chunks.
   */
  function noteUpload() {
    const now = performance.now();
    if (now - lastUploadAt > RUN_GAP_MS) {
      runOpenedAt = now;
      runBuffers = 1;
    } else {
      runBuffers++;
      build.uploadGaps.push(now - lastUploadAt);
      const span = now - runOpenedAt;
      if (span > build.worstUploadRunMs) {
        build.worstUploadRunMs = span;
        build.worstUploadRunBuffers = runBuffers;
      }
    }
    lastUploadAt = now;
  }

  /**
   * Hangs one chunk, and times what doing so costs the thread it happens on.
   */
  /**
   * The whole disc's bare earth, hung as one mesh once the last chunk is in.
   *
   * IN THE WORLD'S OWN FRAME, and that is not a detail: the material rebuilds a
   * cube's tint out of `floor(position / voxel) + chunk`, so a mesh standing at
   * the origin with world coordinates in it lands on exactly the cell indices
   * the grass meshes land on. The two families therefore draw the SAME hash for
   * the same cube, and the joint between them cannot show a seam.
   */
  function landFamily(pieces, key, use, name) {
    let quads = 0;
    for (const piece of pieces) quads += piece[key].quads;
    if (!quads) return 0;
    const positions = new Float32Array(quads * 12);
    const normals = new Int8Array(quads * 12);
    const indices = quads * 4 > 65535
      ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
    let v = 0;
    let q = 0;
    for (const piece of pieces) {
      const ox = piece.cx * CHUNK * VOXEL;
      const oz = piece.cz * CHUNK * VOXEL;
      const family = piece[key];
      for (let k = 0; k < family.quads * 4; k++) {
        positions[(v + k) * 3] = family.positions[k * 3] + ox;
        positions[(v + k) * 3 + 1] = family.positions[k * 3 + 1];
        positions[(v + k) * 3 + 2] = family.positions[k * 3 + 2] + oz;
        normals[(v + k) * 3] = family.normals[k * 3];
        normals[(v + k) * 3 + 1] = family.normals[k * 3 + 1];
        normals[(v + k) * 3 + 2] = family.normals[k * 3 + 2];
      }
      for (let k = 0; k < family.quads * 6; k++) indices[q + k] = family.indices[k] + v;
      v += family.quads * 4;
      q += family.quads * 6;
    }
    const chunk = {
      cx: 0, cz: 0, positions, normals, indices, sphere: null, tops: null,
    };
    land(chunk, use, name);
    build.bytes += positions.byteLength + normals.byteLength + indices.byteLength;
    return quads;
  }

  /**
   * The two gathered families, hung once the last chunk is in.
   *
   * THE PAVING GOES UP THE SAME WAY THE BARE EARTH DOES, and for the same two
   * reasons: twenty six chunks each hanging a mesh of their own would be twenty
   * six draws against a budget of twenty two, and the corridor is one long thin
   * thing whose pieces are never seen apart. What it costs the frame is ONE
   * draw -- exactly the one the corridor's own surface used to cost -- and what
   * it saves is the surface.
   */
  function landGathered() {
    build.earthQuads = landFamily(soil, 'earth', earthMaterial, 'ground-earth');
    if (pavingMaterial) {
      build.pavingQuads = landFamily(soil, 'paving', pavingMaterial, 'ground-paving');
    }
    soil.length = 0;
  }

  function land(chunk, use = material, name = null) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(chunk.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(chunk.normals, 3, true));
    geometry.setIndex(new BufferAttribute(chunk.indices, 1));

    // THE BOX, AND IT IS THE WHOLE OF THE SWEEP. There is no second culler here
    // and there must not be one: the renderer already tests every mesh's sphere
    // against the frustum, which is what turns twenty six chunks into the
    // seventeen the reference pose draws, and a ring test written beside it
    // would be a second opinion about what is on screen.
    const boundingStarted = performance.now();
    if (boundingFromWorker && chunk.sphere) {
      geometry.boundingSphere = new Sphere(
        new Vector3(chunk.sphere.x, chunk.sphere.y, chunk.sphere.z), chunk.sphere.radius,
      );
    } else {
      geometry.computeBoundingSphere();
    }
    const boundingMs = performance.now() - boundingStarted;
    build.boundingMs += boundingMs;
    if (boundingMs > build.worstBoundingMs) build.worstBoundingMs = boundingMs;

    const mesh = new Mesh(geometry, use);
    mesh.name = name || `ground-voxel-${chunk.cx},${chunk.cz}`;
    // Where the chunk stands, as a whole number of voxels. The material reads it
    // straight off this matrix, which is why nothing per chunk has to be a
    // uniform and why one material can serve the whole disc.
    mesh.position.set(chunk.cx * CHUNK * VOXEL, 0, chunk.cz * CHUNK * VOXEL);

    // AND THE JAVASCRIPT COPY GOES AT THE UPLOAD. Every one of the three, because
    // every one of the three is a whole copy of the geometry: leaving the index
    // behind because it is the smallest is still a third of the saving thrown
    // away for nothing.
    //
    // AND THE UPLOAD IS TIMED FROM INSIDE THE SAME CALLBACK, which is the only
    // seat there is. See noteUpload() for where three.js actually does it and
    // what that leaves this able to say.
    let owed = 3;
    for (const attribute of [geometry.attributes.position, geometry.attributes.normal,
      geometry.index]) {
      attribute.onUpload(function drop() {
        noteUpload();
        if (--owed === 0) build.uploadsSeen++;
        if (dispose) this.array = null;
      });
    }

    group.add(mesh);
    if (chunk.tops) tops.set(chunkKey(chunk.cx, chunk.cz), chunk.tops);
    build.bytes += chunk.positions.byteLength + chunk.normals.byteLength
      + chunk.indices.byteLength;
    build.landed++;
  }

  function receive(message) {
    // Timed from the first statement, because this handler IS the main thread's
    // share of the work and the gate is about how long it holds the frame.
    const started = performance.now();
    if (message.kind === 'chunk') {
      if (message.chunk.quads) land(message.chunk);
      if (message.chunk.mat && message.chunk.mat.quads) {
        const { cx, cz } = message.chunk;
        build.matQuads += message.chunk.mat.quads;
        land({ cx, cz, ...message.chunk.mat }, bladeMaterial, `ground-mat-${cx},${cz}`);
      }
      // The bare faces and the paving are KEPT rather than hung: see
      // landGathered.
      if ((message.chunk.earth && message.chunk.earth.quads)
        || (message.chunk.paving && message.chunk.paving.quads)) {
        soil.push({
          cx: message.chunk.cx,
          cz: message.chunk.cz,
          earth: message.chunk.earth,
          paving: message.chunk.paving,
        });
      }
    } else if (message.kind === 'plan') {
      build.planned = message.chunks;
      build.plannedAt = started;
      // The worker's own clock on everything before the disc. See the note in
      // mesher-worker.js: a busy main thread makes plannedAt - startedAt a
      // reading about the main thread's backlog, not about the worker's boot.
      build.startupMs = message.startupMs;
      build.radius = message.radius;
    } else if (message.kind === 'done') {
      landGathered();
      Object.assign(build, {
        quads: message.quads,
        columns: message.columns,
        rim: message.rim,
        quadsPerColumn: message.quadsPerColumn,
        insidePerColumn: message.insidePerColumn,
        workerMs: message.elapsedMs,
        finishedAt: performance.now(),
      });
      // AND THE WORKER GOES. The engine's own seat hands back the worker so the
      // caller can end it: the disc is cut once and a thread kept alive after it
      // is a thread the rest of the run pays for.
      stop();
    }
    // The two the engine's worker cuts before the disc -- the stone tile and the
    // block's courses -- are not this ground's and are dropped where they land.
    // They are still TIMED, because a message dropped on the main thread is a
    // message that held it, and the gate is about the thread and not about what
    // was on it.
    const spent = performance.now() - started;
    if (spent > build.worstMessageMs) {
      build.worstMessageMs = spent;
      build.worstMessageKind = message.kind;
    }
    if (message.kind === 'chunk') {
      build.chunkMs.push(spent);
      if (spent > build.worstChunkMs) build.worstChunkMs = spent;
    }
  }

  let worker = null;
  let owedFrames = FRAMES_BEFORE_SAMPLING;

  function stop() {
    if (!worker) return;
    worker.terminate();
    worker = null;
  }

  /** Sets the engine's own arithmetic going, off the thread the walker is on. */
  function start() {
    if (worker || build.startedAt) return;
    build.startedAt = performance.now();
    // The grain is asked for by name rather than left to the default: it is the
    // condition every fusion number of this campaign was measured under, and a
    // measurement whose conditions are a default somewhere else is a measurement
    // that changes when somebody edits that default. The radius is named for
    // the same reason and with more force: the disc the TIER asked for is the
    // disc the page has to lay, and a page that let the engine's default answer
    // would draw a world nobody chose the moment the two parted company. The
    // corridor rides along for the same reason and with the same force: the
    // thread that cuts the disc is the one that has to know where the ground is
    // not its own, and it cannot ask.
    worker = runInWorker({ grain: true, radius, focus }, receive);
  }

  return {
    group,
    settings,
    material,
    earthMaterial,
    bladeMaterial,
    pavingMaterial,
    pavingTune,
    build,
    longTasks,

    /**
     * Height of the cube tops under a point, or null where the disc lays none.
     *
     * NULL AND NOT THE FIELD, because this file cannot honestly answer for the
     * ground it does not draw: off the disc, on the paving and inside a block's
     * own footprint the surface underneath belongs to somebody else. The seat
     * that has to give one answer for the whole world is groundHeightAt in
     * src/world/contracts.js, and this is what it will read inside the disc.
     */
    topAt(x, z) {
      const ix = Math.floor(x / VOXEL);
      const iz = Math.floor(z / VOXEL);
      const cx = Math.floor(ix / CHUNK);
      const cz = Math.floor(iz / CHUNK);
      const map = tops.get(chunkKey(cx, cz));
      if (!map) return null;
      const top = map[(iz - cz * CHUNK) * CHUNK + (ix - cx * CHUNK)];
      return top === NO_COLUMN ? null : (top + 1) * VOXEL;
    },

    /**
     * How far the ten centimetre ground reaches, for anyone drawing up to it.
     *
     * THE SHELL READS THIS AND NOT THE CONSTANT, which is the whole of why it
     * is published: the two surfaces meet at one radius, and a shell that took
     * the engine's default while the disc took the tier's would leave a ring of
     * nothing between them exactly as wide as the tier moved.
     */
    radius,

    /** Whether the whole disc is standing. */
    ready: () => Boolean(build.finishedAt),

    /** What is actually being drawn this frame, for the development panel. */
    drawn: () => group.children.filter((mesh) => mesh.visible).length,

    /**
     * The frame the field is allowed to be sampled on.
     *
     * Called every frame by the layer, and it does nothing at all after the
     * worker has been set going: the counter is the whole of it.
     */
    update() {
      if (build.startedAt) return;
      if (owedFrames > 0) { owedFrames--; return; }
      start();
    },

    dispose: stop,
  };
}
