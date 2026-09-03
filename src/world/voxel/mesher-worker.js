import {
  DISC_RADIUS, chunkList, meshChunk, setGroundHole,
} from './mesher.js';
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
// AND THE CORRIDOR ARRIVES THE SAME WAY THE RADIUS DOES, WHICH IS THE ONLY WAY
// IT CAN. Where the ground is cut away is the CONTRACT's answer, and a contract
// is a function: it cannot be posted across a thread, and importing it here
// would pull the corridor's whole file into the one module graph in this world
// that is kept to arithmetic on purpose. So what crosses is the corridor's two
// numbers, and the engine's own seat rebuilds the predicate out of the field it
// already reads -- see setGroundHole in ./mesher.js, and the measurement that
// pins the rebuild to the contract digit for digit. This file learns no import
// it did not already have: setGroundHole comes from the mesher, and the mesher
// was always here.
//
// A MESSAGE THAT SAYS NOTHING LAYS YESTERDAY'S DISC, deliberately: the engine's
// bench in src/dev/voxeltest.js draws the engine's own answer with no corridor
// anywhere near it, and it should keep drawing exactly that.
self.onmessage = (event) => {
  const woke = performance.now();
  const {
    grain = true, tile = 512, block = '05', radius = DISC_RADIUS, hole = null,
  } = event.data || {};
  if (hole) setGroundHole(hole);

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
  let columns = 0;
  let rim = 0;
  for (const { cx, cz } of list) {
    const chunk = meshChunk(cx, cz, grain, radius);
    if (chunk.quads === 0) continue;
    quads += chunk.quads;
    columns += chunk.columns;
    rim += chunk.rim;
    // The bare earth's three buffers travel with the chunk's own and are
    // handed over the same way: they are the same three things -- corners, an
    // orientation, an index -- for the faces of the second family.
    self.postMessage({ kind: 'chunk', chunk }, [
      chunk.positions.buffer, chunk.normals.buffer, chunk.faces.buffer,
      chunk.indices.buffer, chunk.tops.buffer,
      chunk.earth.positions.buffer, chunk.earth.normals.buffer,
      chunk.earth.indices.buffer,
    ]);
  }
  self.postMessage({
    kind: 'done',
    radius,
    quads,
    columns,
    rim,
    quadsPerColumn: columns ? quads / columns : 0,
    insidePerColumn: columns ? (quads - rim) / columns : 0,
    elapsedMs: performance.now() - started,
  });
};
