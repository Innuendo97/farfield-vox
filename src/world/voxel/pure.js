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
  BASE_STEP,
  MOUND,
  EARTH,
  FRAMED,
  BLADE,
  BLADES_PER_VOXEL,
  SUB,
  MANTO,
  // The sun's march through the mat and the skirt it costs a store, so the
  // guard that gates the shadow map reads the same bearing the bake used
  // instead of deriving a second one from the seal.
  SUN_SKIRT,
  SUN_STEPS,
  MATERIAL,
  CHUNK,
  DISC_RADIUS,
  PATH,
  CENTRE,
  FACE,
  NO_COLUMN,
  bareRaisedAt,
  bladeAtColumn,
  bladeCentre,
  bladeHeightAt,
  chunkColumns,
  chunkList,
  columnCentre,
  columnSpec,
  columnTop,
  earthFacing,
  framedTally,
  meadowMoundAt,
  moundBankAt,
  moundCutAt,
  meshChunk,
  meshDisc,
  moundAt,
  onPaving,
  pathDrop,
  pathVerge,
  mantoAt,
  mantoIntensity,
  mantoVerge,
} from './mesher.js';

// AND THE STORE ITSELF, because a guard that asserts the world is a plane has
// to be able to READ the world rather than a mesh of it. The engine's door is
// the mesher; the store is the thing behind it the mesher is a function of, and
// leaving it unreachable offline would put the one assertion the rebuilding
// rests on -- that the block store reproduces the plane -- behind a screenshot.
export {
  cellMaterialAt,
  clearColumn,
  columnCount,
  columnIndex,
  createColumns,
  depthAt,
  matAt,
  paintTop,
  raise,
  setFlank,
  setTop,
  storeBytes,
  topAt,
  underAt,
} from './columns.js';

// AND THE PIGMENT, which is the reason this door had to widen. The offline
// chain that carries a material through the light, the tone curve and the grade
// to a pixel used to lift the meadow's albedo out of material.js as TEXT,
// because it was one triple and a regular expression could reach it. It is a
// FIELD now -- a colour that depends on where the cube stands -- and no regular
// expression reaches a field. So the field is a pure function, it lives beside
// the shader that reproduces it, and it comes out through here: the chain and
// the guards import the arithmetic the page draws with rather than a model of
// it. That is residuo 1 of E-FOND-PIANO11, and it is the same argument as the
// one over meshChunk above -- an offline tool that has to open a browser to ask
// the question stops being able to ask it.
export {
  ALBEDO,
  FAMILY,
  PIGMENT,
  PIGMENT_GLSL,
  PIGMENT_SEEDS,
  pigField,
  pigHash,
  pigNoise,
  pigTint,
  pigmentCensus,
  pigmentOf,
  pigmentUniforms,
  refreshPigment,
} from './pigment.js';

export {
  COURSE,
  LENGTHS,
  CHAMFER,
  STONE_METRES,
  buildMasonry,
  masonryCensus,
  stoneTileData,
} from './courses.js';
