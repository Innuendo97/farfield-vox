// THE ENGINE'S ARITHMETIC, WITH NOTHING A BROWSER OWNS IN IT.
//
// No three.js, no DOM, no JSON import: everything reachable from here runs
// inside a worker, on the page, and under plain node, from one source.
//
// THAT IS NOT TIDINESS, IT IS THE BUDGET'S ONLY AUDIT. The number the whole
// pivot was argued on is quads per column -- how well the greedy mesher fuses
// the field -- and it is claimed by a running page, in a HUD, at one moment, on
// one machine. A guard that can lay the same disc offline and get the same
// number is what turns that claim into a measurement. The moment an offline
// tool has to import three.js to ask the question, it stops being able to ask
// it, and the claim goes back to being a screenshot.
//
// So: anything a guard needs is re-exported HERE, and this file must never gain
// an import that a browser is required for. src/world/voxel/index.js is the
// page's door and re-exports all of this, so there is one list of names.

export {
  VOXEL,
  TUFT_CORRELATION,
  TUFT_GATE,
  CHUNK,
  DISC_RADIUS,
  CENTRE,
  FACE,
  NO_COLUMN,
  chunkList,
  columnCentre,
  columnTop,
  meshChunk,
  meshDisc,
  onPaving,
  tuftAt,
} from './mesher.js';

// AND THE LAW OF A WALL, which is new and is the door being widened rather than
// moved. buildMasonry(spec) still takes one argument; what it now also reads is
// spec.masonry, and the four functions under the constants are the law that
// block is written in. They are exported because the wall is drawn TWICE — once
// as geometry here and once in the fragment, which is what a merged rectangle
// costs — and a guard that cannot walk the law offline cannot check that the
// two are the same wall.
export {
  COURSE,
  LENGTHS,
  CHAMFER,
  STONE_METRES,
  RUN_CUT,
  CELL_JITTER,
  WANDER,
  WANDER_SPAN,
  buildMasonry,
  masonryCensus,
  masonryDecks,
  masonryLaw,
  countBlocks,
  stoneHash,
  wanderAt,
  courseY,
  cellPhase,
  cellEdge,
  isCut,
  stoneTileData,
} from './courses.js';
