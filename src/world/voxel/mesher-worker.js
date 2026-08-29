import { chunkList, meshChunk } from './mesher.js';
import { buildMasonry, stoneTileData } from './courses.js';
import { MONOLITHS } from '../layout.js';

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

self.onmessage = (event) => {
  const {
    tuft = true, tile = 512, blocks = MONOLITHS, disc = true,
  } = event.data || {};

  const tileStarted = performance.now();
  const data = stoneTileData(tile);
  self.postMessage({
    kind: 'tile', side: tile, data, elapsedMs: performance.now() - tileStarted,
  }, [data.buffer]);

  // THE SIX, ONE BLOCK PER MESSAGE, and the second half of that is not a
  // formality. Cutting all six is 47 ms of arithmetic here and nothing on the
  // thread the walker is on; handing them over in ONE message would put the
  // whole of the receiving side — six geometries, six materials, six programs
  // — into a single task on exactly the thread the work was moved off, and the
  // eight millisecond gate would be failed by the delivery instead of by the
  // work. So each block is posted the moment it is cut, and the wall the walker
  // sees first is standing before the last one is started.
  //
  // The specs come down the message and are not read out of the plan here. What
  // a wall of this world is MADE of is a measurement V2 owns and carries in
  // spec.masonry; the engine's job is to cut what it is handed. Given nothing,
  // it cuts the six of the plan at the constants above, which is the wall this
  // file has always cut.
  for (const spec of blocks) {
    const masonryStarted = performance.now();
    const built = buildMasonry(spec);
    self.postMessage({
      kind: 'masonry', id: spec.id, built, elapsedMs: performance.now() - masonryStarted,
    }, [built.positions.buffer, built.normals.buffer, built.indices.buffer]);
  }

  // The disc, if it was asked for. A caller that only wants stone — the hub
  // does, because its meadow is still the delivered ground — would otherwise
  // pay tens of milliseconds of field arithmetic and post twenty megabytes of
  // buffers to a main thread with no reader for them. Left on by default: the
  // disc is why this worker exists, and a switch that is off unless asked for
  // is a switch nobody notices is off.
  if (!disc) return;

  const list = chunkList();
  self.postMessage({ kind: 'plan', chunks: list.length });

  const started = performance.now();
  let quads = 0;
  let columns = 0;
  let rim = 0;
  for (const { cx, cz } of list) {
    const chunk = meshChunk(cx, cz, tuft);
    if (chunk.quads === 0) continue;
    quads += chunk.quads;
    columns += chunk.columns;
    rim += chunk.rim;
    self.postMessage({ kind: 'chunk', chunk }, [
      chunk.positions.buffer, chunk.normals.buffer, chunk.faces.buffer,
      chunk.indices.buffer, chunk.tops.buffer,
    ]);
  }
  self.postMessage({
    kind: 'done',
    quads,
    columns,
    rim,
    quadsPerColumn: columns ? quads / columns : 0,
    insidePerColumn: columns ? (quads - rim) / columns : 0,
    elapsedMs: performance.now() - started,
  });
};
