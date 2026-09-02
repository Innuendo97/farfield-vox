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
  MOUND,
  EARTH,
  CHUNK,
  DISC_RADIUS,
  CENTRE,
  FACE,
  NO_COLUMN,
  bareRaisedAt,
  chunkList,
  columnCentre,
  columnTop,
  earthFacing,
  meadowMoundAt,
  meshChunk,
  meshDisc,
  moundAt,
  onPaving,
  setGroundHole,
  tuftAt,
} from './mesher.js';

export {
  COURSE,
  LENGTHS,
  CHAMFER,
  STONE_METRES,
  buildMasonry,
  masonryCensus,
  stoneTileData,
} from './courses.js';
