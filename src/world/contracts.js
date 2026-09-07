import { stairHeightAt as stairRunHeight } from './stairs.js';
import { flowerField } from './vegetation.js';
import { PLATFORM } from './layout.js';
import {
  BASE_STEP, MATERIAL, NO_COLUMN, VOXEL, clearColumn, columnSpec, createColumns,
  matAt, setFlank, setTop, topAt,
} from './voxel/mesher.js';
// THE PLATEAU, which is where the meadow's own law stops and the boundary's
// begins. It is a property of the WORLD -- the committente's «l'area giocabile
// e' il disco su un altopiano» -- and no longer of a tier, so the floor reads
// it from the seat that states it instead of being told a radius by a layer.
import { PLATEAU } from './voxel/confine.js';
import { CHAMFER } from './voxel/pure.js';
import MASONRY from '../../assets-src/monoliths/masonry-spec.json' with { type: 'json' };
import { builtStoneAt, stoneSpecs } from './stone.js';

const STONE_SPECS = stoneSpecs(MASONRY);

// THE CONTRACTS BETWEEN THE SESSIONS, AND THE ONLY DOOR BETWEEN THEM.
//
// WHAT THEY ARE FOR. Eight sessions rewrite eight pieces of this world at the
// same time, and four pairs of them have to agree about something in the middle:
// where the path cuts the ground, where the shell meets the disc, how high the
// worked stone is under a foot, and how much light the ground hands the grass
// standing on it. Every one of those was a direct import from one session's file
// into another's -- which is not a disagreement waiting to happen, it is a file
// two people own.
//
// So the answers live here, one seat each, and the sessions read them. When V1
// rewrites the ground and V2 rewrites the stair, THIS is the file that follows
// them, and nothing else has to.
//
// THEY ARE IMPLEMENTED TODAY, not sketched. Three of the six are the arithmetic
// that was already in the world, moved: the height of the meadow, the height of
// the worked stone, and what is under the feet by name. Two are honest noughts
// with the session that fills them written down. Reading a nought from a seat
// that exists is what lets V3 and V4 be written at all before V1 lands.
//
// AND A CONTRACT IS NOT A CONVENIENCE WRAPPER. Nothing here may quietly become
// a different answer from the one the frame draws: a camera behind a body that
// sank into a stair the walker was standing on is two opinions about one floor,
// and the picture would be the one that was wrong.

// ------------------------------------------------------------ the ground
//
// THE GROUND IS THE CARPET NOW, AND THIS SEAT HAD NOT NOTICED. Until this unit
// the answer here was the smooth field, sampled into a grid every 0.28 m and
// read back bilinearly -- which was the whole truth while the meadow was a bent
// grid laid ON that field. It stopped being the truth the day the disc became
// the world: measured over the disc it lays, the tops of the cubes stand a
// MEDIAN 12.5 cm and as much as 1.20 m above the field, so a walker seated on
// the field walks through ground he can see (v1-suolo/analisi/d4-cuciture.json).
// The picture is not wrong; this was.
//
// AND IT IS THE STORE NOW AND NOT THE LAW, WHICH IS A-3 LANDING. Until this
// step the seat read `columnTop` -- the generator's own arithmetic, a pure
// function of a point -- and that was right while the pipeline was the whole of
// the world: what the law said and what the store held were the same by
// construction, and guard-piano asserted it on every column of a chunk. It
// stops being right the day one edit lands that is not part of the pipeline,
// and the store is where such an edit would land. A floor read from the law
// would then be a floor nobody draws.
//
// SO IT READS THE FOUR ARRAYS, THROUGH THE SAME DOOR THE WORKER MESHES FROM.
// The store is cut per chunk by `chunkColumns`, which is PURE ARITHMETIC -- no
// page, no download, no worker -- so the property that let the law be here
// survives untouched: this answers on a page whose disc is still being built,
// off the main thread, and in a node harness with no page at all. What it must
// NOT read is the delivered height maps of ground-voxel: those arrive when a
// download finishes, and a walker's floor may never depend on that.
//
// AND IT COSTS WHAT IT COSTS, MEASURED RATHER THAN FEARED, TWICE.
// E-V1g measured the law at 1 165 ns a call and 7.0 microseconds a frame at the
// six calls a step takes. Re-measured on the world that ships (the bench is
// fondazione/lav/contratto-ms.mjs, a walk up the corridor and back at the pace
// a body keeps): the law came to 1.85 microseconds a frame warm, and the store
// comes to a FIFTH of that. What the store pays instead is the first touch of
// a chunk -- 4 356 columns of law, once -- and that price is named here rather
// than hidden: it lands the first time the walker sets foot in a chunk of the
// disc and never again while he is on it.

// HOW FAR THE TEN CENTIMETRE GROUND REACHES, AND WHY NOBODY IS TOLD ANY MORE.
//
// `setGroundDiscRadius` stood here: the layer resolved a tier's radius once and
// handed it over, so that the disc of cubes, the sheet beyond it and this floor
// were three readers of ONE decision instead of three opinions about it. The
// decision itself is gone. E-DECISIONI13 put ground everywhere, the field draws
// all of it, and a tier's `voxelDiscRadius` no longer says where the WORLD
// stops -- only how much of it a bench draws as cubes, which is a question
// about a measurement and not about a floor. So the store below is cut at the
// PLATEAU, and there is nothing left to tell this file.

// -------------------------------------------------------- the store, one tile at a time
//
// A FIFO OF TILES AND NOT A DISC. The walker asks about six points a frame and
// all six fall in one tile nearly always, so what a cache has to hold is the
// tile he is on and the ones he has just left. It is FIFO rather than
// least-recently-used on purpose: a walk is a path, so the oldest tile in the
// map is the one furthest behind him, and an LRU would pay a reorder per call
// to sort a queue the walk already sorts.
//
// AND THE TILE IS SIXTEEN COLUMNS AND NOT THE MESHER'S SIXTY FOUR, WHICH IS THE
// ONE NUMBER HERE THAT WAS SWEPT RATHER THAN REASONED. Cutting a store is
// running the law over its columns once, and a tile is paid for the first time
// a foot lands in it: at 64 that first touch is 4 356 columns and 2.6 ms, which
// is a sixth of a frame and the kind of hitch a walk shows; at 16 it is 324 and
// 0.16 ms, which is nothing. Measured on the bench, over a walk up the corridor
// and back (microseconds a frame, six calls a step):
//
//   tile  8  cache 16    first lap 16.0   warm 6.79   -- the cache thrashes
//   tile 16  cache 16    first lap 21.0   warm 8.21   -- and thrashes harder
//   tile 16  cache 64    first lap 11.2   warm 0.50
//   tile 32  cache 64    first lap 21.2   warm 0.48
//   tile 64  cache 16    first lap 36.1   warm 0.51
//
// Nothing about the STORE changes with the number: it is `chunkColumns` with
// its own `n`, the same arithmetic through the same doors, cut smaller. What
// changes is how much of it is paid at once.
//
// SIXTY FOUR TILES, AND THE NUMBER IS THE WALK'S. Below the walk's own span the
// cache thrashes and the warm figure collapses -- the two rows above are that,
// measured. The corridor is 24 m end to end, which is fifteen tiles of z alone,
// so a cache that is to stay warm over a lap has to hold rather more than the
// nine around one foot. At 1 620 bytes a tile, sixty four of them are 104 KB,
// against the 2.45 MB a resident disc would be.
//
// ===========================================================================
// AND A TILE IS FILLED ONE COLUMN AT A TIME, WHICH IS THE ONE THING THE TABLE
// ABOVE COULD NOT SEE, BECAUSE THE WALKER IS NOT THE ONLY READER ANY MORE.
//
// Everything above is reasoned about a FOOT: six points a frame, all six in one
// tile, so a first touch of 324 columns is bought back within the step. That is
// still true and none of it is retracted. What arrived afterwards is a reader
// that does not walk -- the meadow's own accents. The flower lattice asks this
// seat about every candidate it sows, in RING order (sorted by distance), which
// visits the whole circumference of a ring before it comes back; at eighteen
// metres that circumference is more tiles than the cache holds, so every single
// call was a first touch and every first touch cut 324 columns to answer about
// ONE. MEASURED, on the far family's own sweep of twenty five metres: 311 000
// columns computed to place 5 303 flowers -- fifty nine columns a flower -- and
// 743 ms of a walker's thread for one sweep of a family that sweeps continuously
// while anybody is walking (U-PERF-4 §2).
//
// So the rectangle is allocated whole and RUN column by column, on demand,
// through the same `columnSpec` and the same three doors `chunkColumns` writes
// through. It is not a second law and not a second store: it is the same law,
// asked about the columns somebody actually asks about. A walker who crosses a
// tile now pays one column instead of 324 and the rest arrive under his feet as
// he needs them; the scattered reader pays exactly what it asks for.
//
// WHAT PROVES IT: guard-piano's `contractReadsTheStore`, which already walked
// every column of the disc and compared this seat against `columnTop` -- the law
// itself, asked point by point -- in both directions. It did not have to be told
// anything about this change, and a lazy fill that answered anything but the
// law would fail it on the first column.
//
// AND THE MAT IS NOT LAID, which used to be the second half of the saving and is
// now the whole of it: `chunkColumns` runs `layMat` when the grain is asked for
// and this seat never asked for it, so the only thing lost with the rectangle
// loop is the loop.
const TILE = 16;
const CACHED_TILES = 64;
const tiles = new Map();

// WHAT THIS SEAT HAS ACTUALLY COMPUTED, so that the cost of asking it is a
// NUMBER and not a stopwatch. `asks` is how many times somebody wanted the floor
// or the material; `columns` is how many columns of law that came to; `cuts` is
// how many tiles were seated. The ratio of the first two is the whole of what
// U-PERF-4 repaired -- it stood at fifty nine and stands at one -- and it is a
// COUNT, so a guard can gate it on any machine at any load, which is what
// E-V5j asks of anything that is asserted rather than printed.
const asked = { asks: 0, columns: 0, cuts: 0 };

/** How much law this seat has run, for the guard that gates the ratio. */
export function storeCost() { return { ...asked }; }

/**
 * The store the column (ix, iz) lives in, with that column run into it.
 *
 * IT IS THE SAME ARITHMETIC THE WORKER MESHES FROM, through the same door and
 * the same four arrays, so the floor the walker stands on and the floor the
 * frame draws are one store and not two readings of one law.
 */
function storeAt(ix, iz) {
  asked.asks += 1;
  const cx = Math.floor(ix / TILE);
  const cz = Math.floor(iz / TILE);
  const key = `${cx},${cz}`;
  let tile = tiles.get(key);
  if (tile === undefined) {
    asked.cuts += 1;
    // AND IT ASKS FOR THE GROUND WITHOUT THE MAT, WHICH IS WHAT THIS SEAT HAS
    // ALWAYS MEANT AND HAS NOT ALWAYS SAID.
    //
    // The third argument used to reach the answer -- it drew the plates of turf
    // that stood a voxel over the plane -- and this call passed `true` because
    // the floor moved with them. E-DECISIONI8 retired the plates and U-ERBA-1
    // took them out: the terrain is ONE LEVEL and what stands in those pixels is
    // the MAT, which is a lattice of its own that no column's top carries and
    // that the walker passes straight through (E-DECISIONI9.2). So `grain` has
    // not reached a top since that day, and every tile this seat cut has been
    // laying a mat of grass nobody reads.
    //
    // U-ERBA-2 made that waste worth naming. The mat's shadow is marched at
    // worldgen, and the march needs to look upwind past a store's own edge, so a
    // store that lays a mat carries a skirt as wide as the sun reaches
    // (SUN_SKIRT): a tile of sixteen went from 18 x 18 columns to 24 x 24, which
    // is 78% more of the 926 ns each that this cache exists to amortise -- and
    // it bought the walker nothing at all, because the answer below is `top` and
    // `mat` and never the blade.
    //
    // With `false` the tile is the ground and nothing else: the same four
    // arrays, the same doors, the same answer to the millimetre, cut back to the
    // skirt the mesher's own comparison needs. VERIFIED AND NOT ASSUMED --
    // guard-piano walks 61 572 columns of this store against the mesher's and
    // guard-sentiero-cucitura reads the corridor's seam at 0.00 mm, both with
    // the mat off here and on there.
    // AND IT ASKS FOR THE WHOLE WORLD AND NOT FOR THE DISC (E-DECISIONI13).
    //
    // `discRadius` used to be the edge of the ground: outside it the store laid
    // no column and the answer below fell through to a sheet. There is no sheet
    // any more -- past the plateau the world falls in terraces to the water and
    // climbs into the ridge, and a walker may stand on any of it -- so the tile
    // is cut with `beyond` set and the radius it is cut at is the PLATEAU's,
    // which is a property of the world and not of a tier. What a tier still
    // decides is how much of it is drawn as CUBES, and that is a question for
    // the layer and not for the floor.
    //
    // NO SKIRT, because there is nobody to compare across an edge: the two
    // readers below ask about the column they were handed and never about its
    // neighbour. `chunkColumns` carries one for the mesher's own comparison and
    // this seat has never used it.
    //
    // AND THE TILE THAT FALLS OFF THE BACK IS THE TILE THAT COMES ON THE FRONT.
    // The cache is a fixed number of tiles, so at a steady state every new one
    // is an eviction, and allocating the arrays again for it costs the same
    // sixteen kilobytes of blade lattice this seat does not read -- measured at
    // a tenth of the sweep in the allocator and another fifteenth in the
    // collector. The evicted tile's arrays are reseated instead: nothing is
    // cleared but `run`, because a column is only ever read after `run` has said
    // it was laid, and both readers below ask about the column they handed in.
    const oldest = tiles.size >= CACHED_TILES ? tiles.keys().next().value : null;
    if (oldest !== null) {
      tile = tiles.get(oldest);
      tiles.delete(oldest);
      tile.store.ox = cx * TILE;
      tile.store.oz = cz * TILE;
      tile.run.fill(0);
    } else {
      tile = {
        store: createColumns(cx * TILE, cz * TILE, TILE, TILE),
        run: new Uint8Array(TILE * TILE),
      };
    }
    tiles.set(key, tile);
  }
  const k = (iz - cz * TILE) * TILE + (ix - cx * TILE);
  if (!tile.run[k]) {
    tile.run[k] = 1;
    asked.columns += 1;
    const spec = columnSpec(ix, iz, false, PLATEAU, true);
    // Through the store's own doors and in the order `chunkColumns` writes
    // them, so that a column laid here and the same column laid there are one
    // statement written once.
    if (spec.top === NO_COLUMN) clearColumn(tile.store, ix, iz, spec.mat);
    else {
      setTop(tile.store, ix, iz, spec.top, spec.mat);
      setFlank(tile.store, ix, iz, spec.under, spec.depth);
    }
  }
  return tile.store;
}

/**
 * Height of the ground under a point, in metres.
 *
 * V1 FILLS THIS, AND ON THE DISC IT IS ONE GROUND BEHIND ONE NAME. It was
 * three, and the two that are gone were not simplified away -- each died on the
 * step that removed the thing it answered for:
 *
 *   THE CORRIDOR'S OWN FIELD died at step 4. It read the field exactly wherever
 *   the paving owned the column, because the paving was a surface laid over a
 *   HOLE in the meadow and a cube answered there would have put the walker on a
 *   lip drawn over. The corridor is columns now, so the one branch below
 *   answers for it -- and it answers the same number to the millimetre: the
 *   paving's top is one voxel under the meadow's floor, so its drawn face lands
 *   on BASE_LEVEL, which is what the field said. The 26.4 mm of E-V1g die here.
 *   THE BLOCK'S OWN FOOTPRINT dies at this step. Inside the disc, where the
 *   generator lays no column, the answer used to be the field again -- the bent
 *   grid was what drew there. What stands there is a MONOLITH: 595 columns,
 *   measured, under a piece of masonry the walker is kept out of by the
 *   blockers of src/world/hub.js and not by his floor. So the floor there is
 *   the floor of the meadow around it, which is the plane -- one number, and no
 *   second reading of a field for ground nobody stands on. It is stated rather
 *   than left implicit that this is NOT builtHeightAt's seat: that one answers
 *   for the platform and the stair run, which are surfaces a foot really
 *   travels, and it answers -Infinity over all 595 of these.
 *
 * AND WHAT IS LEFT IS ONE BRANCH AND NO SHEET AT ALL, WHICH IS E-DECISIONI13.
 * Beyond the disc there used to be a SHEET -- a mesh from the rim to a hundred
 * metres, whose height this file re-declared and then, at step 7, read from one
 * seat. The sheet is retired: past the plateau the ground falls in terraces to
 * the water and climbs into the ridge that closes the horizon, and every one of
 * those is a COLUMN of the same store, laid by the same law, with the same
 * `(top + 1) * VOXEL` under a foot as the meadow. So the walker who steps off
 * the plateau is answered by the store the frame is drawn from, all the way
 * out, and the two cannot part company because there is only one of them.
 */
export function groundHeightAt(x, z) {
  const ix = Math.floor(x / VOXEL);
  const iz = Math.floor(z / VOXEL);
  // THE ONE BRANCH: the top of the column, out of the store the frame is cut
  // from. `(top + 1) * VOXEL` is the mesher's own arithmetic for where the face
  // of that column is drawn, and it is written the same way in both places
  // because it IS the same statement.
  const top = topAt(storeAt(ix, iz), ix, iz);
  if (top !== NO_COLUMN) return (top + 1) * VOXEL;
  // The one place the store lays no column at all is the masonry's own
  // footprint, and the floor there is the plane the meadow around it stands on
  // -- see above. There is no second branch any more: E-DECISIONI13 put ground
  // everywhere else, so the sheet the last line used to read is gone with the
  // mesh that drew it.
  return (BASE_STEP + 1) * VOXEL;
}

// ----------------------------------------------------------- the basin
//
// HOW FAR THE GROUND HAS FALLEN, r METRES FROM THE MIDDLE OF THE WORLD --
// STATED IN src/world/voxel/confine.js AND RE-EXPORTED HERE.
//
// THE SEAT MOVED AND THE ADDRESS DID NOT, which is the whole of why this note
// is here instead of the arithmetic. The basin used to be the ONLY thing this
// world said about the ground beyond the playable disc: a fall, drawn by a
// sheet, with nothing on it. E-DECISIONI13 made the ground out there a PLACE --
// «il terreno scende a gradoni voxel verso il lago tutt'intorno, con le creste
// terrazzate a chiudere l'orizzonte» -- and the fall became one term of a law
// with two, the other being the ridge. A contract that carried one of the two
// terms would be half a boundary, and the half that was quantised into terraces
// somewhere else.
//
// So the fall lives beside the ridge, in the seat that lays the columns out
// there, and it is re-exported from here UNCHANGED and under its own name: the
// guards, V5 and the walker's floor all still read `basinProfile` from the
// contracts, and not one of them had to be told.
export { basinProfile } from './voxel/confine.js';

// WHERE THE SHEET BEYOND THE DISC STOOD, AND WHY THERE IS NO SEAT FOR IT.
//
// `shellHeightAt` was the one statement of the height of the ground past the
// rim, read by the mesh that drew a sheet out to a hundred metres and by the
// floor above. E-DECISIONI13 retired the sheet: past the plateau the ground is
// COLUMNS like everything else -- the fall cut into terraces, the ridge that
// closes the horizon -- and both the picture and the walker read them out of
// the same store as the meadow. A contract whose two readers are gone is not a
// contract, so it is deleted rather than left as a function nobody calls, and
// what took its place is `confineSteps` in src/world/voxel/confine.js, which is
// the LAW and is therefore already inside the one statement of where the ground
// is. `basinProfile` -- the fitted half of it, and the half V5 shares -- is
// still exported above, under its own name.

// ------------------------------------------------------- the worked stone

const DEG = Math.PI / 180;
const PLATFORM_SIN = Math.sin(PLATFORM.rotationY * DEG);
const PLATFORM_COS = Math.cos(PLATFORM.rotationY * DEG);

/**
 * Height of the built stone under a point, or -Infinity where there is none.
 *
 * V2 FILLS THIS. The stair and the platform are the only places the walker
 * leaves the meadow, and today they are flat topped boxes: their height is an
 * arithmetic answer, not something that needs a sampled grid the way the ground
 * does. When the stair becomes courses of blocks the arithmetic changes and this
 * is where it changes.
 */
export function builtHeightAt(x, z) {
  const stone = builtStoneAt(STONE_SPECS, x, z);
  const dx = x - PLATFORM.x;
  const dz = z - PLATFORM.z;
  // Back into the platform's own frame, which is the inverse of the rotation
  // applied in stairs.js.
  const lx = dx * PLATFORM_COS - dz * PLATFORM_SIN;
  const lz = dx * PLATFORM_SIN + dz * PLATFORM_COS;
  if (Math.abs(lx) <= PLATFORM.width / 2 && Math.abs(lz) <= PLATFORM.depth / 2) {
    const inside = Math.min(
      PLATFORM.width / 2 - Math.abs(lx),
      PLATFORM.depth / 2 - Math.abs(lz),
    );
    // The chamfered lip never answers below the tread that runs under it.
    return Math.max(PLATFORM.height - Math.max(0, CHAMFER - inside), stone, stairRunHeight(x, z));
  }
  return Math.max(stone, stairRunHeight(x, z));
}

/**
 * Height of the STAIR RUN alone, or -Infinity off it.
 *
 * THE SIXTH NAME, AND IT IS NOT A DUPLICATE OF THE ONE ABOVE. The gait needs
 * the run and not the union: the platform is flat and the run is a ramp, and
 * the ease that keeps the eye riding the nosings has to know which it is
 * standing on. The two footprints very nearly touch -- the platform reaches
 * about z = -14.29 and the run starts at -14.30 -- so answering this with
 * "built stone, and not the platform" would have differed from the world on a
 * sliver a centimetre wide, which is exactly the kind of thing that turns up as
 * a hitch in the walk six weeks later.
 *
 * It is here so that src/core/presence.js does not import src/world/stairs.js,
 * which is V2's file. Same arithmetic, one door.
 */
export const stairHeightAt = stairRunHeight;

// -------------------------------------------------------- what is underfoot

/**
 * What is under the feet, by name: piattaforma, scalinata, sentiero or erba.
 *
 * Nothing here is new information: the platform is a rotated box in the layout,
 * the stair run answers for itself, and the path is the same signed distance
 * from the same fitted centreline that paints the albedo and cuts the relief --
 * so the sound and the picture can never disagree about where the stone stops.
 *
 * V1, V2 AND V3 ALL REACH THIS. In a voxel world the category is the material of
 * the column, which is a cleaner answer than this one and not a different one.
 *
 * @returns {'piattaforma'|'scalinata'|'sentiero'|'terra'|'pietra'|'erba'}
 */
export function materialAt(x, z) {
  const ix = Math.floor(x / VOXEL);
  const iz = Math.floor(z / VOXEL);
  const dx = x - PLATFORM.x;
  const dz = z - PLATFORM.z;
  if (Math.abs(dx * PLATFORM_COS - dz * PLATFORM_SIN) <= PLATFORM.width / 2
    && Math.abs(dx * PLATFORM_SIN + dz * PLATFORM_COS) <= PLATFORM.depth / 2) return 'piattaforma';
  if (stairRunHeight(x, z) !== -Infinity) return 'scalinata';
  // AND THE REST OF IT IS THE COLUMN, WHICH IS WHY THE THREE PREDICATES BELOW
  // THIS LINE ARE GONE.
  //
  // It used to ask the corridor's own two functions whether it stood on stone,
  // and a mound's own function whether it stood on a cut bank -- three
  // re-derivations of decisions the generator had already made and written
  // down. The foot and the eye could disagree wherever any of the three was
  // phrased differently from the pass that draws, and one of them WAS: this
  // read `pathRun > 0.5 && |pathCoord| <= 1` where the disc cut its hole at
  // `> 0.5 && < 1`, so a strip either side of the corridor sounded like stone
  // and drew as grass.
  //
  // Now it reads the material of the top of the column, which is the one place
  // in this world that says what is at a point -- and it reads it out of the
  // STORE, through the same door and the same cached chunk the floor above
  // comes through. It does not CALCULATE what is underfoot any more: it looks.
  //
  // AND THE FIFTH NAME IS THE MASONRY'S OWN FOOTPRINT. Where the generator lays
  // no column because a block stands there, the store says so -- MATERIAL.STONE
  // is the reason it wrote down -- and a foot there is on stone. The platform
  // and the stair answer above this line and keep their own two names, because
  // they are built things with their own heights and not columns of the meadow.
  const mat = matAt(storeAt(ix, iz), ix, iz);
  if (mat === MATERIAL.PATH) return 'sentiero';
  if (mat === MATERIAL.EARTH) return 'terra';
  if (mat === MATERIAL.STONE) return 'pietra';
  return 'erba';
}

// ------------------------------------------------------------- the two noughts

// THE SEAT THAT ASKED WHETHER THE GROUND WAS CUT AWAY IS WITHDRAWN, AND THE
// GREP IS THE REASON.
//
// `groundHoleAt` answered whether something else owned a column. It was the one
// agreement between two sessions while the corridor was a surface of its own:
// V3 said where its stone was and V1's disc laid no column under it. Step 4
// made the corridor COLUMNS -- the same store, the same pass, PATH and EARTH on
// top of them -- and from that day the answer was `false`, unconditionally,
// everywhere.
//
// U-FOND-3 kept it anyway, and wrote down why: "with its three readers and its
// signature", because the day a bridge or a pool is laid over the meadow this
// is the seat it goes in. The three readers went with the hole. Grepped over
// src and tools at this step, the only call left in the world was the one
// `groundLightAt` made to it three lines below -- a seat asking itself a
// question whose answer it had written into its own body. A contract that
// exists so that a caller can read a nought from a seat that exists is worth
// keeping; a contract with no caller at all is a name that has to be kept true
// by everyone who touches this file, in exchange for nothing.
//
// So it is gone, and what took its place is the truth it was standing in for:
// there is nothing in this world that is not the ground. The day a bridge is
// laid, the seat comes back with the reader that needs it, in the same
// commit -- which is how it should have arrived the first time.

/**
 * The two terms of the ground's own light at a point, or null where the ground
 * is not what is drawn there.
 *
 * V1 FILLS THIS AND V4 EATS IT. A card of grass has to be lit by the ground it
 * stands on, or the meadow separates into blades of one brightness standing in
 * grass of another -- which is measured, not feared: with the cards lit off a
 * bake while the cubes beside them were lit analytically, the cards were the
 * brightest population in the frame.
 *
 * IT ANSWERED NULL, AND NULL HAS STOPPED BEING THE TRUE ANSWER. The reason
 * written here was that the bridge lived in a vertex shader reading a delivered
 * atlas, so there was no CPU-side copy to hand back. There is no atlas: the
 * meadow the disc draws is lit ANALYTICALLY, by faceTerms() in
 * src/world/face-light.js, out of the face's normal and nothing else. What was
 * unanswerable is now one line of arithmetic, and a seat that still said null
 * would be hiding a number it has.
 *
 * AND E-V4f.2 ASKED WHETHER IT VARIES ACROSS THE DISC. It does not, and this is
 * the MEASUREMENT rather than the argument (v1-suolo/analisi/d4-luce.json):
 *
 *   * the pair is a function of the NORMAL alone -- the JS re-declaration in
 *     that tool is checked character for character against the GLSL, so the day
 *     somebody gives the light a term in position, the tool goes red before this
 *     comment becomes a lie;
 *   * meshing the whole disc the way the worker meshes it, all 354 328 normals
 *     fall in FIVE axis families and not one is off-axis; every top face is
 *     exactly (0, +1, 0), and tops are 33.11% of them;
 *   * asked at 6 446 columns spread over the disc, the spread of both terms is
 *     EXACTLY NOUGHT -- sun 0.7313548788181253, sky 1, at the shipped day sun.
 *
 * So V4 may hold the pair constant over the whole meadow and be right, and the
 * day an occlusion term lands it is this seat that stops being constant, with
 * V4's own code unchanged.
 *
 * AND IT IS NEVER NULL ANY MORE, which is the corridor's doing and not a
 * loosening. The exception written here was that over the corridor V3 drew its
 * own surface with its own tilt, so a flat top face handed back there would
 * light a blade on the paving by a ground that is not under it. The corridor is
 * columns of this same meadow now and its top face is the same (0, +1, 0) as
 * every other, so the exception has nothing left to except.
 *
 * @param {number[]} sun  the sun's direction, from the one seat that holds it;
 *                        the sun term is null without it rather than invented
 * @returns {{sun: number|null, sky: number, normal: number[]}|null}
 */
export function groundLightAt(x, z, sun = null) {
  // n = (0, 1, 0), so the cosine to the beam IS the sun's own vertical and the
  // sky share is exactly one. Written out rather than dotted, because a dot
  // product against a constant normal is a way of hiding which number it is.
  return { sun: sun ? Math.max(0, sun[1]) : null, sky: 1, normal: [0, 1, 0] };
}

// ------------------------------------------------------- the lamps and the field

/**
 * Where the flowers of the meadow stand, for whatever wants to hang a light on
 * one.
 *
 * V4 FILLS THIS AND V7 EATS IT, and the direction of that arrow is the whole
 * contract. The night target lights its meadow with small warm points, and the
 * only place they can honestly stand is where the flowers already are — a lamp
 * floating over bare grass reads as a lamp, and a lamp in a flower reads as the
 * flower. So V7 does not choose those positions and does not scatter a field of
 * its own beside V4's: it asks for the one that is already drawn.
 *
 * AND V4 KNOWS NOTHING ABOUT THE NIGHT. It publishes where its flowers are,
 * which is a fact about the meadow. If the coupling ran the other way — the
 * lamps telling the meadow where to put flowers — the day would be arranged by
 * a session that only ever looks at the night target, and the two pictures the
 * campaign is judged on would be fitted against each other.
 *
 * AND THE FIELD HAS LANDED. What this seat used to buy was that V7 could be
 * written against a name while V4 built the meadow behind it; what it returns
 * now is the meadow V4 draws, out of the one function that decides a flower --
 * src/world/vegetation.js, the same call with the same lattice and the same
 * seed the ring of drawn flowers is filled from. A second sowing here, however
 * carefully matched, would be a lamp standing where no flower is.
 *
 * IT IS THE WHOLE DISC AND NOT THE RING. The ring V4 draws is a few hundred
 * heads within a few metres of the walker, because triangles; this is every
 * flower inside r = 35 m, because a lamp is not a triangle and the night gets
 * to choose. The height under each one comes from groundHeightAt above, which
 * is the same function the hub hands the layer that draws them, so what is
 * published and what is drawn stand at one height by construction rather than
 * by agreement.
 *
 * THE SIGNATURE CARRIES FIVE FIELDS. This seat documented {x, z, y} and the
 * ratified contract said {x, z, size}, which was one contract written down
 * twice: the night needs the head of the flower to hang the lamp at AND how big
 * the flower is to size the core and the halo against. `kind` is the fifth,
 * and it is what lets the selection below be made on a fact about the meadow
 * rather than on an index.
 *
 * AND THE SELECTION IS V7'S, NOT V4'S — WHICH IS THE WHOLE REASON THE LIST IS
 * LONGER THAN THE ANSWER. V4 publishes EVERY flower it drew: that is a fact
 * about the day, it is the same list at every hour, and a session that filtered
 * it would be deciding the night inside the file that owns the meadow. V7 then
 * lights a SUBSET, under a cap and a radius of its own. The gap is not small
 * and nobody should discover it at integration: the night target burns 150 to
 * 250 points where a meadow of this density offers on the order of ten
 * thousand, so roughly one flower in fifty is lit, and the ones that are lit
 * are near and clustered rather than sampled evenly. Which fifty is the night's
 * taste and the night's budget, and it is stated here so that neither session
 * mistakes the length of this array for the number of lamps.
 *
 * ONE NUMBER IN HERE HAS MOVED SINCE V7 WAS BRIEFED, AND IT IS `size`. The
 * signature has not: it is the five fields E-V4c ratified. But the census that
 * put a head at 0.13 to 0.15 m ran the target through the camera in
 * assets-src/materia/ricetta.json, and E-V8f refitted the poses under a 1.80 m
 * walker — the eye dropped 1.15 m and the focal length went from 979 to 1159
 * px. Re-derived at the poses as they stand, a head is 0.082 m and a cyan one
 * 0.073, so what this returns is smaller than the briefing said by two fifths.
 * That is not a loss: E-V7e measured the night lamp's own core at 0.103 m — one
 * voxel — against a day flower the old census called half again bigger, and a
 * lamp cannot be smaller than the flower it is hung in. At 0.082 the two
 * sessions are measuring the same object again.
 *
 * @returns {{x: number, y: number, z: number, size: number, kind: string}[]} in
 *          world metres, y at the head of the flower rather than at the ground
 *          under it, size the width of the flower a lamp is being hung in, kind
 *          which flower it is — the handle V7 selects on
 */
export function flowerLightPoints() {
  if (!flowers) flowers = flowerField(groundHeightAt);
  return flowers;
}

// The seats a lamp could take along the distant ridges arrive with the
// cornice session: V5 wires `ridgeLampSeats` here on its own branch, the way
// the path wired the ground's one hole, and it reaches this file at
// integration. Until then the name is only a promise written down.

// Built on FIRST ASK and kept, for the reason the ground's grid above is: it is
// tens of thousands of lattice draws over the whole disc, the answer does not
// change, and the night may ask for it more than once.
let flowers = null;
