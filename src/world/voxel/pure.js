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
  slimAtColumn,
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

// AND THE FIELD'S OWN TEXEL, for the same reason the store itself is here: the
// guard that asserts the picture reproduces the block store has to be able to
// LAY a texel and READ one without opening a browser, and a guard that had to
// import three.js to ask whether the field agrees with the cubes would stop
// being able to ask at all. The material that draws it is the page's half of
// the door (./index.js); this is the arithmetic.
export {
  CAMPO,
  CAMPO_BEARINGS,
  CAMPO_BIAS,
  CAMPO_BLADE_CEIL,
  CAMPO_BLADE_MASK,
  CAMPO_FAR,
  CAMPO_FAR_BLADE,
  CAMPO_FAR_LOOK,
  CAMPO_FAR_RATIO,
  CAMPO_FAR_SHIFT,
  CAMPO_HORIZON_MARGIN,
  CAMPO_HORIZON_REACH,
  CAMPO_LOOK_BITS,
  CAMPO_LOOK_DEPTH,
  CAMPO_LOOK_MAX,
  CAMPO_LOOK_SHIFT,
  CAMPO_MATERIAL,
  CAMPO_PRESENT,
  CAMPO_RUNG,
  CAMPO_SOIL_WALL,
  campoBearingOf,
  campoBladeOf,
  campoCoarse,
  campoCoarseSpan,
  campoColumnOf,
  campoDecode,
  campoFarOrigin,
  campoFarMeets,
  campoFarTile,
  campoGroundByte,
  campoHeights,
  campoHorizon,
  campoHorizonCost,
  campoLookOf,
  campoMaterialCode,
  campoReduce,
  campoShape,
  campoSlimCode,
  campoSlimEighths,
  campoSlot,
  campoTile,
  campoTintByte,
  campoTintOf,
  campoTopStep,
} from './campo.js';

// AND THE EDGE OF THE WORLD (E-DECISIONI13), which is ground and therefore
// arithmetic: the plateau, the fall cut into terraces, the ridge that closes the
// horizon, and the fitted basin all four sessions read. A guard has to be able
// to sweep it -- how tall the ridge gets, how steep a riser a body meets, and
// whether the two of them still fit in the byte the picture holds them in --
// without opening a browser.
export {
  CONFINE,
  PLATEAU,
  basinProfile,
  confineRisers,
  confineSteps,
  confineSurface,
  crestRise,
  waterLevel,
} from './confine.js';
