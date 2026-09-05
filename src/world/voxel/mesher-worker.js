import {
  DISC_RADIUS, chunkList, meshChunk,
} from './mesher.js';
import { buildMasonry, stoneTileData } from './courses.js';
import { MONOLITHS } from '../layout.js';
import { campoFarTile, campoTile } from './campo.js';

// Everything this demo builds by arithmetic, built off the thread the walker is
// on. Three jobs, in the order the picture wants them.
//
// THE DISC IS THE REASON THE WORKER EXISTS. The height of one point costs 926
// ns, measured, and the disc asks for it once per column: tens of milliseconds
// of arithmetic with no way to make it cheaper, because it IS the shared
// definition of where the ground is and a second, faster copy of it would be a
// second opinion about the floor the walker stands on.
//
// THE OTHER TWO ARE HERE BECAUSE THEY WERE MEASURED, NOT BECAUSE THEY LOOKED
// EXPENSIVE. Generating the stone tile took 93.6 ms on the main thread and the
// block's courses 8.1 ms — both over the eight millisecond gate on their own,
// and both invisible until they were timed separately from the load around
// them. They are pure arithmetic over typed arrays, so moving them costs
// nothing and buys the whole boot.
//
// One message a piece, never the finished world in one: a single message
// carrying everything would land as one long task on the very thread it was
// moved off, and the gate would be failed by the delivery instead of by the
// work.

// THE ENTRY CARRIES THE DISC NOW, AND THE DOOR DID NOT MOVE (E-V1d.2).
//
// `runInWorker(options)` hands its first message straight through, so a radius
// asked for by the tier arrives here as DATA and not as a new argument
// anywhere: the same widening E-V2e gave the spec of a block. What the caller
// does not say, the engine's own default answers.
//
// AND THE DISC IS ALL THIS THREAD CUTS OF THE GROUND. The shell from the rim of
// the disc out to a hundred metres is NOT here and must not come here: it is a
// few hundred vertices of bent grid built in a millisecond on the main thread,
// and moving it onto this one would buy nothing and cost the one thing this
// thread is for — the disc's own arithmetic arriving as early as it can.
//
// AND THE CORRIDOR NO LONGER HAS TO ARRIVE AT ALL, which is a message field and
// a seat this thread has stopped needing. It used to be told where the ground
// was cut away, because the paving was a surface somebody else drew over a hole
// and the answer lived in a contract -- a function, which cannot be posted
// across a thread. The corridor is COLUMNS now, written by the same pipeline
// that writes the meadow out of pathRun and pathCoord, which this thread has
// always imported. There is nothing left to tell it.
// AND A FOURTH JOB, WHICH IS THE FIRST ONE THIS THREAD IS ASKED FOR MORE THAN
// ONCE.
//
// The three above are a BOOT: they are asked for together, they are answered
// once, and the thread is terminated at `done`. The field's window is not a
// boot -- it follows the walker, so it asks for the chunk that just came into
// range and then, a few seconds later, for the next one. A thread started per
// chunk would pay its own module graph every time (measured at 159 to 284 ms
// for this one), so the message is answered and the thread STAYS.
//
// It is a branch at the top and not a second worker file for the reason the
// door in ./index.js exists at all: the field is built out of the same
// chunkColumns() and layMat() the greedy mesher is built out of, and two
// threads that each imported half of that would be two module graphs of the
// same arithmetic in one page.
self.onmessage = (event) => {
  const message = event.data || {};
  if (message.job === 'campo' || message.job === 'campo-far') {
    // TWO WINDOWS AND ONE BRANCH. The near tile is cut out of a STORE and the
    // far one out of the law at its own stride (see ./campo.js): what arrives
    // here is the same shape of message either way -- a square of bytes, where
    // it goes, and what it cost -- so the window on the other side does not
    // have to know which picture it is filling.
    const far = message.job === 'campo-far';
    const { chunks = [], radius: reach = DISC_RADIUS } = message;
    for (const { cx, cz } of chunks) {
      const built = far ? campoFarTile(cx, cz, reach) : campoTile(cx, cz, reach);
      self.postMessage({
        kind: message.job,
        cx,
        cz,
        bx: built.bx,
        bz: built.bz,
        tallest: built.tallest,
        lowest: built.lowest,
        ms: built.ms,
        data: built.data,
        coarse: built.coarse,
      }, [built.data.buffer, built.coarse.buffer]);
    }
    return;
  }

  const woke = performance.now();
  const {
    grain = true, tile = 512, block = '05', radius = DISC_RADIUS, focus = null,
  } = event.data || {};

  const tileStarted = performance.now();
  const data = stoneTileData(tile);
  self.postMessage({
    kind: 'tile', side: tile, data, elapsedMs: performance.now() - tileStarted,
  }, [data.buffer]);

  const spec = MONOLITHS.find((m) => m.id === block);
  const masonryStarted = performance.now();
  const built = buildMasonry(spec);
  self.postMessage({
    kind: 'masonry', id: block, built, elapsedMs: performance.now() - masonryStarted,
  }, [
    built.positions.buffer, built.normals.buffer,
    built.block.buffer, built.stone.buffer, built.indices.buffer,
  ]);

  // THE PLAN IS ANNOUNCED BEFORE A SINGLE HEIGHT IS SAMPLED, and that is the
  // seam the ground times against: everything before this message is startup —
  // this thread's own module graph and the two jobs above that the ground did
  // not ask for — and everything after it is the disc. A build time that folded
  // the two together would be reported as the cost of the disc and is not.
  //
  // AND THE SPLIT IS CLOCKED HERE, ON THIS THREAD, WHICH IS THE ONLY PLACE IT
  // IS TRUE. A main thread that is busy while this one works receives every
  // message of the run in one burst when it comes free, so a start-to-plan
  // measured over there reads the main thread's own backlog and calls it the
  // worker's startup — 4.5 seconds against 240 milliseconds, measured, on the
  // very first run of this. The receiver's stamps still say what the HANDOVER
  // cost; these say what the WORK cost.
  const list = chunkList(radius);
  self.postMessage({
    kind: 'plan', chunks: list.length, radius, startupMs: performance.now() - woke,
  });

  const started = performance.now();
  let quads = 0;
  let matQuads = 0;
  let columns = 0;
  let blades = 0;
  let rim = 0;
  for (const { cx, cz } of list) {
    // WHERE THE MAT IS DRAWN BLADE BY BLADE ARRIVES AS DATA, exactly the way the
    // radius does, so the door does not move for it either: what the caller does
    // not say, the engine's own default answers (the middle of the disc).
    const chunk = meshChunk(cx, cz, grain, radius, focus || undefined);
    if (chunk.quads === 0 && chunk.mat.quads === 0) continue;
    quads += chunk.quads;
    matQuads += chunk.mat.quads;
    columns += chunk.columns;
    blades += chunk.blades;
    rim += chunk.rim;
    // The other two families' three buffers travel with the chunk's own and are
    // handed over the same way: they are the same three things -- corners, an
    // orientation, an index -- for the faces of the bare earth and of the
    // paving.
    self.postMessage({ kind: 'chunk', chunk }, [
      chunk.positions.buffer, chunk.normals.buffer, chunk.faces.buffer,
      chunk.indices.buffer, chunk.tops.buffer,
      chunk.earth.positions.buffer, chunk.earth.normals.buffer,
      chunk.earth.indices.buffer,
      chunk.paving.positions.buffer, chunk.paving.normals.buffer,
      chunk.paving.indices.buffer,
      chunk.mat.positions.buffer, chunk.mat.normals.buffer,
      chunk.mat.indices.buffer,
      // AND THE MAT'S SHADOW, the one buffer of this handover that is not
      // geometry: a byte a blade column saying where the sun stops reaching it,
      // marched at worldgen along the bearing the seal carries. It is moved and
      // not copied like everything else here, and the page lays it into one
      // texture over the whole disc.
      chunk.shade.data.buffer,
    ]);
  }
  self.postMessage({
    kind: 'done',
    radius,
    quads,
    matQuads,
    columns,
    blades,
    rim,
    quadsPerBlade: blades ? matQuads / blades : 0,
    quadsPerColumn: columns ? quads / columns : 0,
    insidePerColumn: columns ? (quads - rim) / columns : 0,
    elapsedMs: performance.now() - started,
  });
};
