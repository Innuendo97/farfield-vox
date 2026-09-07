import {
  Box2, DataTexture, Group, LinearSRGBColorSpace, NearestFilter, RGBAFormat,
  UnsignedByteType, Vector2,
} from 'three';
import { VOXEL } from './columns.js';
import { CENTRE, DISC_RADIUS } from './worldgen.js';
import {
  CAMPO, CAMPO_BEARINGS, CAMPO_BIAS, CAMPO_BLADE_CEIL, CAMPO_FAR, CAMPO_HORIZON_REACH,
  campoCoarseSpan, campoFarOrigin, campoHorizon,
} from './campo.js';
import { campoBox, campoMaterial } from './campo-material.js';

// THE TWO WINDOWS THE GROUND IS KEPT IN, AND THE ONE CALL THAT MOVES THEM.
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
//   * there is no rim, so there is nothing for a shell to overlap and no
//     flicker where two surfaces claim one plane (§1.4 of the performance
//     dossier: OVERLAP = 0.6 m of coplanar z-fighting, which is the thing the
//     committente saw);
//   * there is no ring of detail anchored to the spawn, so «i fili restano a un
//     raggio di tot metri dalla posa iniziale» stops being true by construction
//     rather than by a bigger radius;
//   * and nothing is re-meshed. A tile that comes into the window is one
//     texSubImage2D of its own square. There is no geometry to cut, no seam to
//     stitch and no upload to dose.
//
// THE WINDOW IS A WHOLE NUMBER OF TILES AND THAT IS LOAD-BEARING. Eight tiles a
// side, a tile 128 texels, the picture 1024: a tile therefore lands on a
// multiple of its own size at every level of the pyramid and can never straddle
// the wrap. Seven writes a tile, no clipping, no case analysis.
//
// ===========================================================================
// AND THERE ARE TWO OF THEM NOW (phase two, E-DECISIONI13).
//
//   THE NEAR WINDOW  5 cm a texel, 51.2 m across, FOLLOWING THE EYE. It is the
//                    meadow blade by blade and it is the one that streams.
//   THE FAR WINDOW   40 cm a texel, 409.6 m across, STANDING STILL over the
//                    middle of the world. It is the boundary: the terraces down
//                    to the water, the ridge that closes the horizon, and the
//                    same meadow read eight times coarser.
//
// THE FAR ONE IS BUILT ONCE AND NEVER MOVED, and that is a measurement and not
// a convenience: the walker cannot leave the plateau, which is thirty five
// metres of a four hundred metre picture, so a window centred on the WORLD is
// in front of them from every pose there is. Sixty four tiles at boot, and then
// nothing at all for the rest of the run -- against a moving far window, which
// would pay a toroidal update for a view that has not changed.
//
// ===========================================================================
// WHAT THE MAIN THREAD DOES, AND THE GATE IT IS UNDER.
//
// Nothing but the copy. Every byte is generated in the worker out of the same
// chunkColumns()/layMat()/columnSpec the greedy mesher reads (see ./campo.js),
// and what arrives here is a typed array that is MOVED and not copied. The gate
// is the one src/world/ground-voxel.js has carried since the disc: nothing over
// eight milliseconds on the thread the walker is on. A tile costs seven
// sub-rectangle writes of 87 kB in total, and the run of them is timed here
// rather than asserted -- `stats.worstUploadMs` is what a report quotes.
//
// AND THE WORKER STAYS ALIVE, which is the one habit of the disc that could not
// survive. The disc's worker is a one-shot: it cuts, it posts, it is terminated
// at `done`. A window that follows a walker asks for a tile every few seconds
// for as long as the walker walks, and a thread started per tile would pay its
// own module graph -- measured at 159 to 284 ms -- every time.
// ===========================================================================

const wrap = (v, n) => ((v % n) + n) % n;

/**
 * One picture: its texture, the source rectangle every copy is made from, and
 * the book-keeping of which tile is in which slot.
 *
 * The two windows differ in three numbers -- how big a texel is, whether the
 * window follows the eye, and which job the worker is asked for -- and in
 * nothing else, so they are one function called twice rather than two files
 * that would drift.
 */
function makeWindow(shape, job) {
  const data = new Uint8Array(shape.atlas.width * shape.atlas.height * 4);
  const texture = new DataTexture(
    data, shape.atlas.width, shape.atlas.height, RGBAFormat, UnsignedByteType,
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

  // The one source rectangle every copy is made from, reused so that a tile
  // costs no allocation. It is deliberately never given to a material: three
  // takes the direct texSubImage2D path only while the source has no GL texture
  // of its own, and a source that had been bound once would fall back to a
  // framebuffer blit for ever after.
  const tileData = new Uint8Array(shape.tileBytes);
  const tile = new DataTexture(
    tileData, shape.tiles.width, shape.tiles.height, RGBAFormat, UnsignedByteType,
  );
  tile.flipY = false;
  tile.colorSpace = LinearSRGBColorSpace;

  return {
    shape,
    job,
    data,
    texture,
    tile,
    tileData,
    /** Which tile each slot of the window holds, so a walk that comes back asks
     * for nothing. */
    held: new Map(),
    asked: new Set(),
    pending: [],
    arrived: [],
    centre: null,
    tiles: 0,
    tilesAsked: 0,
    workerMs: 0,
    worstWorkerMs: 0,
    uploadMs: 0,
    worstUploadMs: 0,
    tallest: 0,
    lowest: 255,
    /** The tallest ground each SIX METRE piece of each tile holds, by the
     * tile's key: the sky's own bound. See skySlope. */
    coarse: new Map(),
  };
}

/**
 * The two clipmaps, the box they are drawn on, and the worker that fills them.
 *
 * @param {object} options
 * @param {number} options.radius  how far the PLATEAU reaches, the layer's own
 * @param {object} options.sheets  the delivered strip of grey squares
 * @param {boolean} options.depth  write gl_FragDepth; false prices the early
 *                                 depth test this draw gives up
 * @param {number} options.rays    sub-pixel samples a fragment marches
 * @param {Function} options.worker  a factory for the engine's worker, handed
 *                                 in so this file imports no page machinery
 */
export function createCampo({
  radius = DISC_RADIUS, sheets = null, depth = true, rays = 1, worker: makeWorker = null,
} = {}) {
  const group = new Group();
  group.name = 'campo';

  const near = makeWindow(CAMPO, 'campo');
  const far = makeWindow(CAMPO_FAR, 'campo-far');
  const windows = [near, far];

  const material = campoMaterial({
    texture: near.texture, far: far.texture, sheets, depth, rays,
  });
  // THE RENDERER ARRIVES WITH THE FIRST DRAW AND NOT FROM A LAYER. Nothing in
  // src/world/layers is handed one, and reaching for the page's own would put a
  // piece of the engine somewhere it could not run. The copy still may NOT
  // happen here -- this is called inside a render pass, and binding a
  // framebuffer in the middle of one is how a frame gets a hole in it -- so the
  // renderer is only REMEMBERED, and the tiles are laid on the next update().
  const mesh = campoBox(material, (webgl) => {
    if (renderer) return;
    renderer = webgl;
    for (const w of windows) renderer.initTexture(w.texture);
  });
  group.add(mesh);

  const stats = {
    tiles: 0,
    tilesAsked: 0,
    farTiles: 0,
    workerMs: 0,
    worstWorkerMs: 0,
    uploadMs: 0,
    worstUploadMs: 0,
    bytes: CAMPO.bytes + CAMPO_FAR.bytes,
    tileBytes: CAMPO.tileBytes,
    farTileBytes: CAMPO_FAR.tileBytes,
    levels: CAMPO.levels,
    side: CAMPO.side,
    cell: CAMPO.cell,
    farCell: CAMPO_FAR.cell,
    farSpan: CAMPO_FAR.side * CAMPO_FAR.cell,
    moves: 0,
    lowest: 255,
    tallest: 0,
    radius,
  };

  let renderer = null;
  // Where the sky's bound was last taken, and whether a tile has landed since.
  let slopeAt = null;
  let dirty = true;
  // ---------------------------------------------------------------------------
  // WHERE THE LEVEL OF DETAIL IS CENTRED, AND WHY IT IS NOT SIMPLY THE EYE.
  //
  // The law is in metres from the WALKER (see march() in ./campo-material.js),
  // and the walker's place on the plane is what this seat hands the fragment.
  // Two things are decided here and nowhere else.
  //
  // IT IS THE WALKER AND NOT THE CAMERA'S DIRECTION. A head that turns and a
  // lens that zooms leave this number alone, which is the whole of the answer
  // to «il prato si ridisegna quando zoommo».
  //
  // AND IT IS HELD BACK, WHICH IS THE HYSTERESIS. A front is a place where a
  // cell changes size, and a front that follows a continuous position changes a
  // ring of cells on EVERY frame -- a step of half a metre taken and taken
  // straight back refines a ring and coarsens it again, which the eye reads as
  // the meadow being redrawn under it. So the centre stays where it is until
  // the walker has left a ball of `snap` metres around it: inside that ball
  // NOTHING changes level, and a half metre there and back is identical to the
  // byte. What it costs is that the change, when it comes, comes at once -- the
  // crossfade that spreads it over a few frames is R2's S3 and belongs to
  // U-CAMPO-2, not here -- so `snap` is a handle and the tier sets it.
  let lodCentre = null;
  let lodSnap = 0.75;
  // The ring of bearings, and the vec4s the fragment reads it through: the
  // uniform is allocated once and written in place, because this is rewritten
  // four times a second on the thread the walker is on.
  const horizon = new Float32Array(CAMPO_BEARINGS);
  const horizonPacked = material.uniforms.uSkyRing.value;

  const srcRegion = new Box2(new Vector2(), new Vector2());
  const dstPosition = new Vector2();

  /** Lays one tile into its picture: seven writes, no clipping. */
  function place(w, bx, bz) {
    if (!renderer) return 0;
    const started = performance.now();
    for (let level = 0; level < w.shape.levels; level += 1) {
      const size = w.shape.tile >> level;
      const src = w.shape.tiles.origins[level];
      const atlas = w.shape.atlas.origins[level];
      srcRegion.min.set(src.x, src.y);
      srcRegion.max.set(src.x + size, src.y + size);
      dstPosition.set(
        atlas.x + wrap(bx >> level, w.shape.side >> level),
        atlas.y + wrap(bz >> level, w.shape.side >> level),
      );
      renderer.copyTextureToTexture(w.tile, w.texture, srcRegion, dstPosition);
    }
    const ms = performance.now() - started;
    w.uploadMs += ms;
    stats.uploadMs += ms;
    if (ms > w.worstUploadMs) w.worstUploadMs = ms;
    if (ms > stats.worstUploadMs) stats.worstUploadMs = ms;
    return ms;
  }

  /**
   * THE STEEPEST ANYTHING IN THE WORLD STANDS OVER THE EYE, as a slope.
   *
   * A ray that leaves the eye steeper than this cannot reach ground, whichever
   * way it is pointing, so the fragment that carries it discards before it has
   * marched a cell -- and that is most of the sky, which the box of phase two
   * put back into the frame when it grew to the size of the world.
   *
   * WHY IT IS ASKED OF SIX METRE PIECES AND NOT OF TILES. It is a MAXIMUM over
   * the world of (how tall a thing is over the eye) / (how far away it is), and
   * a far tile is 51.2 m across: one of them holds both the level plateau the
   * walker stands on and the crown of the ridge, so its single maximum answers
   * "fourteen metres, right here" and the bound comes out at sixty degrees --
   * true, and useless. Level four of each tile's own pyramid is a cell of 6.4 m
   * and the reduction has already taken the highest ground in each, so the
   * crown is measured at the distance the crown actually stands at. Measured at
   * the judging pose that is the difference between 63 degrees and 12.
   *
   * It is a BOUND and not a guess: the ground is a maximum, the mat over it is
   * the ladder's own ceiling, and the distance is to the NEAREST corner of the
   * cell, floored at a metre so a cell the walker is standing in cannot make it
   * infinite. Four thousand cells, a few operations each, and only when the eye
   * has moved a quarter of a metre.
   */
  function skySlope(eye) {
    let worst = -1e9;
    for (const w of windows) {
      const span = w.shape.span;
      const cell = campoCoarseSpan(w.shape);
      const n = Math.round(span / cell);
      for (const [key, coarse] of w.coarse) {
        const [cx, cz] = key.split(',').map(Number);
        const x0 = cx * span;
        const z0 = cz * span;
        for (let j = 0; j < n; j += 1) {
          const az = z0 + j * cell;
          const dz = Math.max(az - eye.z, 0, eye.z - (az + cell));
          for (let i = 0; i < n; i += 1) {
            const top = coarse[j * n + i];
            if (!top) continue;
            const ax = x0 + i * cell;
            const dx = Math.max(ax - eye.x, 0, eye.x - (ax + cell));
            const y = (top - CAMPO_BIAS) * VOXEL + CAMPO_BLADE_CEIL;
            if (y <= eye.y) continue;
            const d = Math.max(1, Math.hypot(dx, dz));
            const slope = (y - eye.y) / d;
            if (slope > worst) worst = slope;
          }
        }
      }
    }
    // A hand of margin, and a floor of nought: a walker who is above every
    // scrap of ground in the world still sees the ground under their feet.
    return Math.max(0, worst) + 0.02;
  }

  /**
   * THE SAME QUESTION, ASKED PER DIRECTION -- and it is the same four thousand
   * cells, walked once, at the same moments.
   *
   * What the single bound above gives away is measured in ./campo.js at the
   * head of campoHorizon: at the pose the campaign judges on the world's
   * steepest bearing presents 0.166 and the median 0.133, and the band between
   * them is 15.0% of the whole frame -- a quarter of every pixel that marches.
   * The ring is that band handed back, and the arithmetic that keeps it honest
   * is campoHorizon's, in the file a guard can run offline.
   *
   * The tiles are handed over as a lazy walk rather than copied into an array:
   * a tile's coarse square is already the shape campoHorizon wants, and this is
   * called four times a second on the thread the walker is on.
   */
  function* coarsePatches() {
    for (const w of windows) {
      const span = w.shape.span;
      const cell = campoCoarseSpan(w.shape);
      const n = Math.round(span / cell);
      for (const [key, coarse] of w.coarse) {
        const [cx, cz] = key.split(',').map(Number);
        yield { x0: cx * span, z0: cz * span, cell, n, top: coarse };
      }
    }
  }

  function receive(message) {
    const w = message.kind === 'campo' ? near : message.kind === 'campo-far' ? far : null;
    if (!w) return;
    w.arrived.push(message);
    w.workerMs += message.ms;
    stats.workerMs += message.ms;
    if (message.ms > w.worstWorkerMs) w.worstWorkerMs = message.ms;
    if (message.ms > stats.worstWorkerMs) stats.worstWorkerMs = message.ms;
  }

  /**
   * How tall and how deep the box has to be, out of what the tiles have said.
   *
   * THE BOX HAS TO CONTAIN EVERY HEIGHT THE TWO PICTURES HOLD AND NOT A METRE
   * MORE: every metre of box is depth the ray crosses before it reaches
   * anything, and every metre missing is ground with no fragment over it. The
   * two ends come from the tiles themselves -- the lowest and the tallest
   * GROUND byte either window has seen -- so the boundary can be re-dialled
   * without anybody remembering to widen a box.
   */
  function fitBox() {
    let lowest = 255;
    let tallest = 0;
    for (const w of windows) {
      if (w.tiles === 0) continue;
      lowest = Math.min(lowest, w.lowest);
      tallest = Math.max(tallest, w.tallest);
    }
    if (tallest === 0) return;
    stats.lowest = lowest;
    stats.tallest = tallest;
    const height = material.uniforms.uHeight.value;
    // One cell of margin either way, and the blade over the tallest ground.
    height.x = (lowest - CAMPO_BIAS - 1) * VOXEL - CAMPO.cell;
    height.y = (tallest - CAMPO_BIAS) * VOXEL + 1.0;
    mesh.scale.y = height.y - height.x;
    mesh.position.y = (height.y + height.x) / 2;
  }

  /**
   * Lays what has arrived, and NOT ALL OF IT: the upload is dosed.
   *
   * The lesson is voxel-tools' and it is about the thread and not the card --
   * «typically only one mesh» a frame, because what a walker feels is a long
   * task and not a byte. A window that has just been opened has sixty four
   * tiles to lay; a walker who takes a step has one. Two a frame is what makes
   * the first case invisible without making the second late.
   */
  function flush(budget) {
    if (!renderer) return;
    let laid = 0;
    let moved = false;
    for (const w of windows) {
      while (w.arrived.length && laid < budget) {
        const message = w.arrived.shift();
        w.tileData.set(message.data);
        place(w, message.bx, message.bz);
        w.held.set(`${message.cx},${message.cz}`, true);
        if (message.coarse) w.coarse.set(`${message.cx},${message.cz}`, message.coarse);
        w.asked.delete(`${message.cx},${message.cz}`);
        w.tiles += 1;
        stats.tiles += 1;
        if (w === far) stats.farTiles += 1;
        laid += 1;
        dirty = true;
        if (message.tallest > w.tallest) { w.tallest = message.tallest; moved = true; }
        if (message.lowest < w.lowest) { w.lowest = message.lowest; moved = true; }
      }
    }
    if (moved) fitBox();
  }

  let thread = null;

  function ask(w, list) {
    if (!list.length) return;
    for (const c of list) w.asked.add(`${c.cx},${c.cz}`);
    w.tilesAsked += list.length;
    stats.tilesAsked += list.length;
    if (thread) thread.postMessage({ job: w.job, radius, chunks: list });
    else w.pending.push(...list);
  }

  /**
   * Where a window stands, in tiles, for a walker at this point.
   *
   * Half a tile either side of the middle: the window is eight tiles and the
   * walker is in one of them, so it reaches between three eighths and half of
   * its own span in every direction depending where in their own tile they
   * stand. Snapping to the tile is what keeps every write aligned.
   *
   * A STILL WINDOW ANSWERS THE WORLD AND NOT THE WALKER: see campoFarOrigin.
   */
  function windowAt(w, x, z) {
    if (w.shape.still) return campoFarOrigin(w.shape);
    const tiles = w.shape.side / w.shape.tile;
    return {
      cx: Math.floor(Math.floor(x / w.shape.cell) / w.shape.tile) - tiles / 2 + 1,
      cz: Math.floor(Math.floor(z / w.shape.cell) / w.shape.tile) - tiles / 2 + 1,
    };
  }

  function moveTo(w, x, z) {
    const p = windowAt(w, x, z);
    if (w.centre && w.centre.cx === p.cx && w.centre.cz === p.cz) return;
    w.centre = p;
    if (!w.shape.still) stats.moves += 1;
    const tiles = w.shape.side / w.shape.tile;
    const wanted = [];
    const keep = new Set();
    for (let j = 0; j < tiles; j += 1) {
      for (let i = 0; i < tiles; i += 1) {
        const cx = p.cx + i;
        const cz = p.cz + j;
        const key = `${cx},${cz}`;
        keep.add(key);
        if (!w.held.has(key) && !w.asked.has(key)) wanted.push({ cx, cz });
      }
    }
    // A slot's old tenant is forgotten the moment its own square is claimed by
    // somebody else: there is nothing to unload, because the new tile writes
    // over exactly the texels the old one owned.
    for (const key of [...w.held.keys()]) if (!keep.has(key)) w.held.delete(key);
    const lo = { x: p.cx * w.shape.span, z: p.cz * w.shape.span };
    const hi = { x: (p.cx + tiles) * w.shape.span, z: (p.cz + tiles) * w.shape.span };
    const uniform = w === near ? material.uniforms.uBounds : material.uniforms.uFarBounds;
    uniform.value.set(lo.x, lo.z, hi.x, hi.z);
    if (w === far) mesh.position.set((lo.x + hi.x) / 2, mesh.position.y, (lo.z + hi.z) / 2);
    // THE NEAR TILES FIRST, ALWAYS. A walker who has just been put down is
    // looking at their own feet before they are looking at the ridge, and the
    // worker answers in the order it was asked.
    ask(w, wanted);
  }

  return {
    group,
    mesh,
    material,
    texture: near.texture,
    farTexture: far.texture,
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
      for (const w of windows) renderer.initTexture(w.texture);
    },

    /** Starts the worker and asks for the first of both windows. */
    start(x, z) {
      if (makeWorker && !thread) {
        thread = makeWorker({ job: 'campo', radius }, receive);
      }
      for (const w of windows) moveTo(w, x, z);
      if (!thread) return;
      for (const w of windows) {
        if (w.pending.length) {
          thread.postMessage({ job: w.job, radius, chunks: w.pending.splice(0) });
        }
      }
    },

    /** One frame: where the walker stands decides where the near window is. */
    update(eye, budget = 2) {
      // The pictures are laid FIRST, so that a tile that arrived while the last
      // frame was drawn is on the card before the window is asked to move
      // again: the other order leaves a slot claimed by a tile whose bytes are
      // still in a queue, and the ray reads whatever the last tenant left.
      flush(near.centre === null ? Infinity : budget);
      if (!eye) return;
      moveTo(near, eye.x, eye.z);
      // AND THE CENTRE OF THE DETAIL, WHICH ONLY MOVES WHEN IT HAS TO. See the
      // note over lodCentre: the first frame plants it, and after that it stays
      // until the walker is more than `lodSnap` metres from it. At snap nought
      // it is simply the walker, which is the arm the hysteresis is measured
      // against.
      if (!lodCentre) lodCentre = { x: eye.x, z: eye.z };
      else if (Math.hypot(eye.x - lodCentre.x, eye.z - lodCentre.z) > lodSnap) {
        lodCentre.x = eye.x;
        lodCentre.z = eye.z;
      }
      material.uniforms.uLodCentre.value.set(lodCentre.x, lodCentre.z);
      // AND THE SKY'S OWN BOUND, WHEN THE EYE HAS MOVED ENOUGH TO CHANGE IT.
      // It is four thousand cells of arithmetic; at a quarter of a metre it is
      // asked about four times a second at walking pace, and what it can be
      // wrong by in between is a quarter of a metre of parallax on a ridge
      // sixty metres away, which the margin above covers many times over.
      if (!slopeAt || Math.hypot(eye.x - slopeAt.x, eye.z - slopeAt.z) > 0.25
        || Math.abs(eye.y - slopeAt.y) > 0.25 || dirty) {
        slopeAt = { x: eye.x, y: eye.y, z: eye.z };
        dirty = false;
        const bound = skySlope(eye);
        material.uniforms.uSkySlope.value = bound;
        // AND THE RING, WHICH IS WHAT THE FRAGMENT ACTUALLY READS. The single
        // bound above is kept and still uploaded: it is the ring's own ceiling,
        // it is the cheap compare the fragment takes first, and it is the
        // number the bench of U-PERF-3 was written on.
        campoHorizon(horizon, coarsePatches(), eye, CAMPO_HORIZON_REACH, bound);
        for (let b = 0; b < CAMPO_BEARINGS; b += 1) {
          horizonPacked[b >> 2].setComponent(b & 3, horizon[b]);
        }
      }
    },

    /** Lays everything that has arrived, whatever it costs: for a bench. */
    settle() {
      flush(Infinity);
    },

    /**
     * THE RING, ITS RUNGS AND ITS HYSTERESIS, AS ONE SEAT.
     *
     * The tier decides them (quality.js groundDetail) and the layer hands them
     * over; nothing else may write the three uniforms. A snap that changes
     * plants the centre again on the next frame rather than dragging it, so a
     * measurement taken at one snap is never half of another.
     */
    setDetail({ near: ringNear, step, snap } = {}) {
      const u = material.uniforms;
      if (ringNear > 0) u.uLodNear.value = ringNear;
      if (step > 1) u.uLodStep.value = step;
      if (snap !== undefined && snap !== null && snap >= 0) {
        lodSnap = snap;
        lodCentre = null;
      }
      return { near: u.uLodNear.value, step: u.uLodStep.value, snap: lodSnap };
    },

    /** Every tile of both windows is in its picture. */
    ready() {
      for (const w of windows) {
        if (w.centre === null || w.asked.size > 0 || w.arrived.length > 0 || w.tiles === 0) {
          return false;
        }
      }
      return true;
    },

    /**
     * WHERE THE LINE BETWEEN THE FIELD AND THE CUBES RUNS, in the world's XZ.
     *
     * One seat, handed to both programs: see CAMPO_CUT_GLSL in ./campo.js. The
     * plane is (nx, nz, d) and the field owns the half-space where
     * nx*x + nz*z + d is not negative. It is a MEASURING handle in phase two:
     * the world that ships is the field, whole, at `on` nought.
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
      for (const w of windows) {
        w.texture.dispose();
        w.tile.dispose();
      }
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}
