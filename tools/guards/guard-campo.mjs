import {
  BLADE, BLADES_PER_VOXEL, CHUNK, MANTO, MATERIAL, NO_COLUMN, PIGMENT, PLATEAU, SUB, VOXEL,
  CAMPO, CAMPO_BIAS, CAMPO_BLADE_CEIL, CAMPO_BLADE_MASK, CAMPO_FAR, CAMPO_FAR_BLADE,
  CAMPO_FAR_LOOK, CAMPO_FAR_RATIO, CAMPO_FAR_SHIFT,
  CAMPO_LOOK_DEPTH, CAMPO_LOOK_MAX, CAMPO_LOOK_SHIFT,
  CAMPO_MATERIAL, CAMPO_PRESENT, CAMPO_RUNG, CAMPO_SOIL_WALL,
  campoBladeOf, campoDecode, campoFarTile, campoGroundByte, campoHeights, campoLookOf,
  campoSlimCode, campoSlimEighths,
  campoSlot, campoTile, campoTintByte, campoTintOf, campoTopStep, chunkColumns, columnSpec,
  bladeAtColumn, mantoIntensity, pigTint, slimAtColumn,
} from '../../src/world/voxel/pure.js';
import { reporter, selfTest } from './lib.mjs';

// GUARD-CAMPO -- THE PICTURE REPRODUCES THE STORE, IN BOTH DIRECTIONS.
//
// ===========================================================================
// WHAT THIS GUARD IS FOR, IN ONE SENTENCE: the ray-marched field is THE ground
// now, and the whole of the campaign's case for it rests on the word SAME. The
// moment a texel says something the block store does not, the world has two
// answers about where the floor is -- which is exactly the defect the pivot to
// a block store was made to remove, arriving by the back door in a texture.
//
// So the assertions are not "does the picture look right". They are:
//
//   1. EVERY texel of a tile equals the column under it. Not a sample: every
//      one, over tiles chosen to carry every feature this world has -- the open
//      meadow, the corridor and its verge of earth, the masses, and the ground
//      BEYOND THE PLATEAU, which is the boundary E-DECISIONI13 put there.
//   2. AND BACK: every column is findable in the picture at the address the
//      shader computes, through campoSlot's own toroidal wrap. A guard that
//      only walked the texels would pass a picture that was right where it was
//      written and wrote it in the wrong place.
//   3. THE PYRAMID CARRIES ONE COLUMN, AND THE BOUND IT GIVES IS SAFE. A coarse
//      cell is the child with the highest GROUND, whole -- a sample of the mat
//      and not a maximum of it, because a maximum draws a flat meadow -- and
//      what the traversal trusts is that ground plus the ladder's own ceiling.
//      A cell that under-reported would cut the tops off blades at a distance,
//      and nobody would see that as a DEFECT: it would read as level of detail.
//   4. THE TINT IS THE PIGMENT'S OWN PURE TWIN, at the integer column the
//      fragment of material.js samples it at, to the byte it is stored in.
//   5. THE PACKING HOLDS THE LAW. Two bits for a width the law draws in
//      eighths, one for presence, one for the soil of a wall: the day
//      MANTO.slim widens, this fails HERE rather than silently drawing every
//      wide blade as a narrow one.
//   6. THE TWO UNITS DIVIDE THE WORLD. The ground is counted in VOXELS and the
//      blade in quarter-blades; a voxel has to be a whole number of the second
//      or every height in the picture is quantised twice.
//   7. THE ATLAS DOES NOT OVERLAP ITSELF, and a tile's toroidal address never
//      straddles the wrap -- which is the property the seven writes of the
//      update rest on, and the only reason the window has no case analysis.
//   8. AND THE TWO WINDOWS ARE ONE LATTICE. The far picture is eight near cells
//      to a texel, so a far texel is a cell of level three of the near pyramid
//      and the traversal walks both with ONE level counter. If that ratio ever
//      stopped being a power of two the seam between them would be a place the
//      ray changes its mind about where it is.
// ===========================================================================

const report = reporter('guard-campo -- the picture reproduces the store');

// THE PLATEAU, and it is not a tier's number any more. The field is the world:
// what it is cut at is where the meadow's own law gives way to the boundary,
// and that is a property of the world (E-DECISIONI13).
const RADIUS = PLATEAU;

// FIVE TILES, AND EACH IS CHOSEN FOR A FEATURE AND NOT FOR COVERAGE.
//   0,0   the middle of the hub: the corridor, its stone, its verge of earth
//   0,1   the open meadow north of the spawn -- the pose the campaign judges on
//  -1,0   the meadow west, where the masses stand
//   0,2   the rim of the PLATEAU is not here any more, but the mat is thinning
//   6,0   BEYOND THE PLATEAU: the terraces of the boundary, which used to be a
//         hole in the picture and are now ground like any other
const CHUNKS = [
  { cx: 0, cz: 0 }, { cx: 0, cz: 1 }, { cx: -1, cz: 0 }, { cx: 0, cz: 2 }, { cx: 6, cz: 0 },
];

/** The store a tile was cut from, cut again here so nothing is shared. */
function storeOf(cx, cz) {
  return chunkColumns(cx, cz, CHUNK, true, RADIUS, {
    x: 0, z: 0, detail: Infinity, block: MANTO.block,
  }, true);
}

const MAT_OF = {
  [MATERIAL.GRASS]: CAMPO_MATERIAL.GRASS,
  [MATERIAL.EARTH]: CAMPO_MATERIAL.EARTH,
  [MATERIAL.PATH]: CAMPO_MATERIAL.PATH,
};

// THE DEFECT IS INJECTED BY --self TOO, AND THAT IS THE POINT OF THE FLAG.
// It used to be --inject alone, and tools/guards/all.mjs forwards only the
// flags it was given: under the campaign's own `guard:all -- --self` this was
// false, every case below read `injected ? ... : true`, and the whole self
// test was a row of unconditional passes. (U-GUARDIA-3, E-IGIENE.)
const injected = process.argv.includes('--inject') || process.argv.includes('--self');

// --------------------------------------------------------------------------
// 1 and 2. THE TEXEL AND THE COLUMN, BOTH WAYS.
// --------------------------------------------------------------------------
let walked = 0;
let present = 0;
let blades = 0;
let narrow = 0;
let walls = 0;
let beyond = 0;
const wrong = {
  presence: 0, ground: 0, blade: 0, mat: 0, slim: 0, wall: 0, tint: 0, address: 0,
};
let firstWrong = '';
const note = (what) => { if (!firstWrong) firstWrong = what; };

for (const { cx, cz } of CHUNKS) {
  const tile = campoTile(cx, cz, RADIUS);
  // The self test's own hand on the answer: one texel's blade raised by a
  // single unit, which is 1.25 cm and is exactly the size of defect a picture
  // can carry without looking wrong.
  if (injected) tile.data[(70 * CAMPO.tile + 70) * 4] += 1;
  const store = storeOf(cx, cz);
  const b = BLADES_PER_VOXEL;
  const storeW = store.w * b;
  const skirt = (cx * CHUNK - store.ox) * b;
  const bx0 = cx * CHUNK * b;
  const bz0 = cz * CHUNK * b;

  for (let j = 0; j < CAMPO.tile; j += 1) {
    for (let i = 0; i < CAMPO.tile; i += 1) {
      walked += 1;
      const texel = campoDecode(tile.data, (j * CAMPO.tile + i) * 4);
      const k = (j + skirt) * storeW + (i + skirt);
      const ck = ((j + skirt) >> 1) * store.w + ((i + skirt) >> 1);
      const top = store.top[ck];
      const family = top === NO_COLUMN ? -1 : (MAT_OF[store.mat[ck]] ?? -1);
      const should = family >= 0;
      if (texel.present !== should) {
        wrong.presence += 1;
        note(`presence at ${cx},${cz} texel ${i},${j}`);
        continue;
      }
      if (!should) continue;
      present += 1;
      if (top < -1) beyond += 1;
      // THE GROUND, ASKED BACK IN THE UNIT THE WORLD IS KEPT IN. The texel is
      // read back as a voxel top and compared with the store's own Int16, so a
      // bias that did not hold the world would show here as a clamp rather than
      // pass.
      if (campoTopStep(texel) !== top) {
        wrong.ground += 1;
        note(`ground at ${cx},${cz} texel ${i},${j}: ${campoTopStep(texel)} against ${top}`);
      }
      if (texel.mat !== family) {
        wrong.mat += 1;
        note(`material at ${cx},${cz} texel ${i},${j}`);
      }
      // THE BLADE, MEASURED FROM THE GROUND IT STANDS ON. The corridor's stone
      // carries none -- the tiles are not this family's -- and everything else
      // carries what layMat laid, to the unit.
      const blade = family === CAMPO_MATERIAL.PATH ? 0 : store.blade[k];
      if (texel.blade !== blade) {
        wrong.blade += 1;
        note(`blade at ${cx},${cz} texel ${i},${j}: ${texel.blade} against ${blade}`);
      }
      if (texel.blade > 0) blades += 1;
      if (texel.slim !== store.slim[k]) {
        wrong.slim += 1;
        note(`width at ${cx},${cz} texel ${i},${j}: ${texel.slim} against ${store.slim[k]}`);
      }
      if (texel.slim) narrow += 1;
      // AND WHETHER THE WALL OF THIS COLUMN IS SOIL, which is the store's own
      // `under` and the bit the field needs to cut a bank, a terrace or the
      // halo round a boulder the way the mesher cuts them.
      const soil = store.under[ck] === MATERIAL.EARTH && store.depth[ck] > 0;
      if (texel.soilWall !== soil) {
        wrong.wall += 1;
        note(`wall at ${cx},${cz} texel ${i},${j}`);
      }
      if (texel.soilWall) walls += 1;
      // THE TINT, AGAINST THE PIGMENT'S OWN PURE TWIN at the integer column --
      // which is the WORLD's ten centimetre column and not the blade, because a
      // zone of the world is one zone whichever family is standing in it.
      if (texel.tint !== campoTintByte((bx0 + i) >> 1, (bz0 + j) >> 1)) {
        wrong.tint += 1;
        note(`tint at ${cx},${cz} texel ${i},${j}`);
      }
      // AND THE OTHER DIRECTION: the address the shader computes for this
      // column, through the same toroidal wrap, has to land on this texel.
      const slot = campoSlot(bx0 + i, bz0 + j, 0);
      const wantX = (((bx0 + i) % CAMPO.side) + CAMPO.side) % CAMPO.side;
      const wantY = (((bz0 + j) % CAMPO.side) + CAMPO.side) % CAMPO.side;
      if (slot.x !== wantX || slot.y !== wantY) {
        wrong.address += 1;
        note(`address at ${cx},${cz} texel ${i},${j}`);
      }
    }
  }
}

const clean = Object.values(wrong).every((v) => v === 0);

report.check(walked === CHUNKS.length * CAMPO.tile * CAMPO.tile,
  'every texel of five tiles was walked, not a sample of them', `${walked}`);
report.check(present > 0 && blades > 0 && narrow > 0 && walls > 0 && beyond > 0,
  'and those five carry columns, blades, narrow blades, soil walls and the boundary',
  `${present} columns, ${blades} with a blade, ${narrow} narrow, ${walls} on soil, `
  + `${beyond} under the plateau`);
report.check(wrong.presence === 0, 'a texel is there exactly where a column is',
  wrong.presence ? `${wrong.presence} disagree` : '');
report.check(wrong.ground === 0, 'the ground of a texel is the top of its column',
  wrong.ground ? `${wrong.ground} disagree` : '');
report.check(wrong.blade === 0, 'its blade is the one layMat laid, over that ground',
  wrong.blade ? `${wrong.blade} disagree` : '');
report.check(wrong.mat === 0, 'its material is the material of its column',
  wrong.mat ? `${wrong.mat} disagree` : '');
report.check(wrong.slim === 0, 'its width is the width the mat gave that blade',
  wrong.slim ? `${wrong.slim} disagree` : '');
report.check(wrong.wall === 0, 'and its wall is soil exactly where the store cut one',
  wrong.wall ? `${wrong.wall} disagree` : '');
report.check(wrong.tint === 0, 'its tint is pigTint at its own column of the world',
  wrong.tint ? `${wrong.tint} disagree` : '');
report.check(wrong.address === 0,
  'and the address the shader computes lands on the texel that was written',
  wrong.address ? `${wrong.address} disagree` : '');
if (firstWrong) report.line(`        first disagreement: ${firstWrong}`);

// --------------------------------------------------------------------------
// 1b. THE FAR PICTURE, AGAINST THE LAW IT IS SAMPLED FROM.
//
// The near tile is read off a STORE because a store is what the greedy meshes.
// The far tile is read off `columnSpec` at its own stride, and it is declared
// as exactly that in ./campo.js -- so what this leg asks is whether the sample
// it took is the sample the law gives at that very column, texel by texel over
// a whole tile of the boundary. A far picture that had drifted from the law
// would be a second opinion about a hillside.
// --------------------------------------------------------------------------
let farWalked = 0;
let farWrong = 0;
let farPresent = 0;
let farBeyond = 0;
{
  // A tile of the far window that stands over the ridge: at 40 cm a texel and
  // 128 texels a tile, tile 2 covers 102.4 to 153.6 m of x.
  const tile = campoFarTile(2, 0, RADIUS);
  const stride = Math.round(CAMPO_FAR.cell / VOXEL);
  // AND THE COLUMN IT IS READ AT IS THE CORNER OF ITS OWN FOOTPRINT (U-CAMPO-2,
  // M2.1), not the middle. A far texel is level three of the near pyramid, and
  // three reductions on level ground come down to the child at (0, 0): reading
  // the corner is what lets the two windows say ONE byte where they meet, which
  // is the whole of why the strip stopped changing nature when the window moved.
  const half = 0;
  for (let j = 0; j < CAMPO_FAR.tile; j += 1) {
    for (let i = 0; i < CAMPO_FAR.tile; i += 1) {
      farWalked += 1;
      const texel = campoDecode(tile.data, (j * CAMPO_FAR.tile + i) * 4);
      const ix = (2 * CAMPO_FAR.tile + i) * stride + half;
      const iz = (0 * CAMPO_FAR.tile + j) * stride + half;
      const spec = columnSpec(ix, iz, false, RADIUS, true);
      const family = spec.top === NO_COLUMN ? -1 : (MAT_OF[spec.mat] ?? -1);
      if (texel.present !== (family >= 0)) { farWrong += 1; continue; }
      if (family < 0) continue;
      farPresent += 1;
      if (spec.top < -1) farBeyond += 1;
      // The blade and its width, at the corner blade column, out of the law's
      // own doors -- the same two this guard asks the near window with.
      const bx = ix * BLADES_PER_VOXEL;
      const bz = iz * BLADES_PER_VOXEL;
      const lays = spec.mat === MATERIAL.GRASS
        || (MANTO.onVerge && spec.mat === MATERIAL.EARTH);
      const i0 = lays ? mantoIntensity((bx + 0.5) * BLADE, (bz + 0.5) * BLADE) : 0;
      const h = lays && family !== CAMPO_MATERIAL.PATH ? bladeAtColumn(bx, bz, i0) : 0;
      const w = h ? campoSlimEighths(campoSlimCode(slimAtColumn(bx, bz, i0))) : 0;
      if (campoTopStep(texel) !== spec.top) farWrong += 1;
      else if (texel.mat !== family) farWrong += 1;
      else if (texel.blade !== h) farWrong += 1;
      else if (texel.slim !== w) farWrong += 1;
      else if (texel.tint !== campoTintByte(ix, iz)) farWrong += 1;
      // The STATISTIC in that same byte is not checked here: it is the debt the
      // sixty four blades under this texel owe the plate, and the only honest
      // reader of it is the near pyramid itself -- see guard-livello3, which
      // builds it with campoTile + campoReduce and compares texel to texel.
    }
  }
}
report.check(farWrong === 0 && farPresent > 0 && farBeyond > 0,
  'every texel of a far tile is the law at the corner of its own footprint',
  `${farWalked} texels, ${farPresent} standing, ${farBeyond} under the plateau, `
  + `${farWrong} disagree`);

// --------------------------------------------------------------------------
// 3. THE PYRAMID IS THE CHILD WITH THE HIGHEST GROUND, WHOLE -- AND THE BOUND
//    IT GIVES THE TRAVERSAL IS STILL CONSERVATIVE.
//
// Two assertions and they are not the same one. The first is that the reduction
// copies ONE column's four bytes and the right one; the second is that
// `ground + CAMPO_BLADE_CEIL`, which is what the ray trusts at a coarse cell,
// is not under the true top of anything inside that cell. A sampled blade over
// a maximum ground is only safe because of the second, and a ladder that grew a
// rung would break it here rather than by cutting the tops off blades at a
// distance.
// --------------------------------------------------------------------------
let pyramidBad = 0;
let lookBad = 0;
let lookCells = 0;
{
  const tile = campoTile(0, 1, RADIUS);
  if (injected) {
    // The FIRST coarse cell that reaches above the plane, lowered by one unit.
    // A cell chosen by its coordinates would land on bare ground as often as
    // not, and lowering a maximum of nought is not a defect -- a self test that
    // injected one would pass while proving nothing.
    const dst = CAMPO.tiles.origins[1];
    const size = CAMPO.tile >> 1;
    for (let j = 0; j < size; j += 1) {
      let done = false;
      for (let i = 0; i < size && !done; i += 1) {
        const o = ((dst.y + j) * CAMPO.tiles.width + (dst.x + i)) * 4;
        if (campoBladeOf(tile.data[o]) > 0) { tile.data[o] -= 1; done = true; }
      }
      if (done) break;
    }
  }
  for (let level = 1; level < CAMPO.levels; level += 1) {
    const size = CAMPO.tile >> level;
    const src = CAMPO.tiles.origins[level - 1];
    const dst = CAMPO.tiles.origins[level];
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        let best = -Infinity;
        let bo = -1;
        for (let dj = 0; dj < 2; dj += 1) {
          for (let di = 0; di < 2; di += 1) {
            const s = ((src.y + j * 2 + dj) * CAMPO.tiles.width + (src.x + i * 2 + di)) * 4;
            const rank = tile.data[s + 2] ? tile.data[s + 1] : -Infinity;
            if (rank > best) { best = rank; bo = s; }
          }
        }
        if (bo < 0) continue;
        const o = ((dst.y + j) * CAMPO.tiles.width + (dst.x + i)) * 4;
        // THREE CHANNELS WHOLE, AND THE FOURTH IN ITS TWO HALVES. The ground,
        // the flags and the tint are the winning child's word for word; the
        // first byte carries the winner's BLADE in its low five bits and, in
        // its high three, the statistic of what the merge covered over -- which
        // is not any child's number and has to be re-derived here rather than
        // compared.
        if (campoBladeOf(tile.data[o]) !== campoBladeOf(tile.data[bo])) pyramidBad += 1;
        else if (tile.data[o + 1] !== tile.data[bo + 1]
          || tile.data[o + 2] !== tile.data[bo + 2]
          || tile.data[o + 3] !== tile.data[bo + 3]) pyramidBad += 1;
        else {
          const top = tile.data[bo + 1] * CAMPO_RUNG + campoBladeOf(tile.data[bo]);
          let deficit = 0;
          let seen = 0;
          for (let dj = 0; dj < 2; dj += 1) {
            for (let di = 0; di < 2; di += 1) {
              const s = ((src.y + j * 2 + dj) * CAMPO.tiles.width + (src.x + i * 2 + di)) * 4;
              if (!tile.data[s + 2]) continue;
              seen += 1;
              deficit += campoLookOf(tile.data[s]) * CAMPO_LOOK_DEPTH
                + Math.max(0, top - (tile.data[s + 1] * CAMPO_RUNG + campoBladeOf(tile.data[s])));
            }
          }
          const want = seen
            ? Math.min(CAMPO_LOOK_MAX,
              Math.round((deficit / seen) * CAMPO_LOOK_MAX / CAMPO_LOOK_DEPTH))
            : 0;
          if ((tile.data[o] >> CAMPO_LOOK_SHIFT) !== want) { pyramidBad += 1; lookBad += 1; }
          if (want > 0) lookCells += 1;
        }
      }
    }
  }
}
report.check(pyramidBad === 0,
  'every coarse cell is the winning column word for word, and its statistic is '
  + 'the mean depth of the mat it covered',
  pyramidBad ? `${pyramidBad} are not (${lookBad} of them on the statistic)` : `${lookCells} carry one`);

// AND THE STATISTIC CANNOT REACH THE HEIGHT, WHICH IS THE WHOLE OF WHY IT WAS
// FREE TO CARRY. A blade is at most five rungs of MANTO.law at SUB steps each;
// the mask has to hold every one of them with nothing left over to borrow.
{
  const ceil = Math.round(CAMPO_BLADE_CEIL / CAMPO.unitBlade);
  report.check(ceil <= CAMPO_BLADE_MASK && (CAMPO_BLADE_MASK + 1) * (CAMPO_LOOK_MAX + 1) === 256,
    'the blade fits under the statistic in one byte',
    `tallest blade ${ceil}, mask ${CAMPO_BLADE_MASK}, ${CAMPO_LOOK_MAX + 1} steps of look`);
  let mad = 0;
  for (let i = 0; i < MANTO.law.length; i += 1) {
    for (let j = 0; j < MANTO.law.length; j += 1) mad += MANTO.law[i] * MANTO.law[j] * Math.abs(i - j);
  }
  report.check(CAMPO_LOOK_DEPTH === Math.max(1, Math.round(mad * SUB)),
    'the full scale of the statistic is derived from MANTO.law and not written down',
    `${CAMPO_LOOK_DEPTH} SUB-steps against ${(mad * SUB).toFixed(3)}`);
}

// AND THE BOUND IS NEVER UNDER WHAT IS INSIDE THE CELL.
let bound = 0;
let boundCells = 0;
let slack = 0;
{
  const tile = campoTile(0, 1, RADIUS);
  const CEIL = Math.round(CAMPO_BLADE_CEIL / CAMPO.unitBlade);
  for (let level = 1; level < CAMPO.levels; level += 1) {
    const size = CAMPO.tile >> level;
    const dst = CAMPO.tiles.origins[level];
    const step = 1 << level;
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const o = ((dst.y + j) * CAMPO.tiles.width + (dst.x + i)) * 4;
        if (!tile.data[o + 2]) continue;
        boundCells += 1;
        const said = (tile.data[o + 1] - CAMPO_BIAS) * CAMPO_RUNG + CEIL;
        let worst = -Infinity;
        for (let dj = 0; dj < step; dj += 1) {
          for (let di = 0; di < step; di += 1) {
            const s = ((j * step + dj) * CAMPO.tile + (i * step + di)) * 4;
            if (!tile.data[s + 2]) continue;
            const top = (tile.data[s + 1] - CAMPO_BIAS) * CAMPO_RUNG + campoBladeOf(tile.data[s]);
            if (top > worst) worst = top;
          }
        }
        if (worst > said) bound += 1;
        else slack = Math.max(slack, said - worst);
      }
    }
  }
}
report.check(bound === 0,
  'and the ground plus the ladder ceiling is over every top inside that cell',
  bound ? `${bound} of ${boundCells} are not`
    : `${boundCells} coarse cells, the loosest by `
      + `${(slack * CAMPO.unitBlade * 100).toFixed(1)} cm`);

// --------------------------------------------------------------------------
// 4 to 8. THE PACKING, THE UNITS, THE ATLAS, THE WRAP AND THE TWO WINDOWS.
// --------------------------------------------------------------------------
const widths = [0];
for (let w = MANTO.slim.low; w < MANTO.slim.high; w += 1) widths.push(w);
report.check(widths.map(campoSlimCode).every((c) => c >= 0 && c < 4),
  'two bits hold every width the law draws', `eighths ${widths.join(', ')}`);
report.check(widths.every((w) => campoSlimEighths(campoSlimCode(w)) === w),
  'and every one of them comes back out unchanged');
report.check(CAMPO_PRESENT > ((3 << 2) | 3) && CAMPO_SOIL_WALL === CAMPO_PRESENT * 2,
  'the bits of presence and of the soil wall stand above the fields packed under',
  `present ${CAMPO_PRESENT}, wall ${CAMPO_SOIL_WALL}`);

report.check(Number.isInteger(VOXEL / CAMPO.unitBlade) && CAMPO.unitBlade === BLADE / SUB
  && CAMPO.unitGround === VOXEL,
'a voxel is a whole number of blade units, and the ground is counted in voxels',
`${VOXEL / CAMPO.unitBlade} blade units to a voxel of ${(CAMPO.unitGround * 100).toFixed(0)} cm; `
+ `the ground byte spans ${(-CAMPO_BIAS * VOXEL).toFixed(1)} to `
+ `${((255 - CAMPO_BIAS) * VOXEL).toFixed(1)} m, the blade byte `
+ `${(255 * CAMPO.unitBlade).toFixed(2)} m`);
report.check(campoTopStep(campoDecode(new Uint8Array([0, campoGroundByte(-1), 16, 0]), 0)) === -1,
  'and a ground byte comes back as the voxel step it was written from');

for (const shape of [CAMPO, CAMPO_FAR]) {
  report.check(shape.side % shape.tile === 0 && shape.tile === CHUNK * BLADES_PER_VOXEL,
    `the ${shape.name} window is a whole number of tiles, and a tile is the engine's own`,
    `${shape.side / shape.tile} tiles a side of ${shape.tile} texels, `
    + `${(shape.side * shape.cell).toFixed(1)} m across at ${(shape.cell * 100).toFixed(0)} cm`);
  report.check((shape.tile >> (shape.levels - 1)) >= 1,
    `no level of the ${shape.name} pyramid has a cell wider than the tile that writes it`,
    `level ${shape.levels - 1} is ${shape.tile >> (shape.levels - 1)} texels of a tile`);

  let overlap = 0;
  for (let a = 0; a < shape.levels; a += 1) {
    for (let b = a + 1; b < shape.levels; b += 1) {
      const A = { ...shape.atlas.origins[a], s: shape.side >> a };
      const B = { ...shape.atlas.origins[b], s: shape.side >> b };
      if (A.x < B.x + B.s && B.x < A.x + A.s && A.y < B.y + B.s && B.y < A.y + A.s) overlap += 1;
    }
  }
  report.check(overlap === 0, `no two levels of the ${shape.name} atlas claim one texel`,
    `${shape.atlas.width} x ${shape.atlas.height}, `
    + `${(shape.bytes / 1048576).toFixed(2)} MB on the card`);
  report.check(shape.atlas.origins.every((o, l) => o.x + (shape.side >> l) <= shape.atlas.width
    && o.y + (shape.side >> l) <= shape.atlas.height),
  `and every level of the ${shape.name} atlas stands inside its picture`);

  let straddle = 0;
  for (let c = -9; c <= 9; c += 1) {
    for (let level = 0; level < shape.levels; level += 1) {
      const slot = campoSlot(c * shape.tile, c * shape.tile, level, shape);
      if (slot.x % slot.size !== 0 || slot.y % slot.size !== 0
        || slot.x + slot.size > (shape.side >> level)
        || slot.y + slot.size > (shape.side >> level)) straddle += 1;
    }
  }
  report.check(straddle === 0,
    `a ${shape.name} tile is aligned at every level and never straddles the wrap`,
    straddle ? `${straddle} do` : '');
}

// THE TWO WINDOWS ARE ONE LATTICE, which is what lets the traversal keep one
// level counter: a far cell at level L must cover exactly the ground a near
// cell at level L + CAMPO_FAR_SHIFT covers, and start at the same place.
report.check(CAMPO_FAR.cell === CAMPO.cell * CAMPO_FAR_RATIO
  && (1 << CAMPO_FAR_SHIFT) === CAMPO_FAR_RATIO,
'a far texel is exactly a cell of level three of the near pyramid',
`${CAMPO_FAR_RATIO} near cells to a far one, shift ${CAMPO_FAR_SHIFT}`);
let lattice = 0;
for (let level = CAMPO_FAR_SHIFT; level < CAMPO.levels; level += 1) {
  const nearSpan = CAMPO.cell * (2 ** level);
  const farSpan = CAMPO_FAR.cell * (2 ** (level - CAMPO_FAR_SHIFT));
  if (Math.abs(nearSpan - farSpan) > 1e-12) lattice += 1;
}
report.check(lattice === 0,
  'and at every level the two lattices are the same lattice',
  lattice ? `${lattice} levels differ` : '');
report.check(CAMPO_FAR_BLADE > 0 && CAMPO_FAR_BLADE <= 255,
  'the far window carries the mat as the law own mean and not as a sample',
  `${CAMPO_FAR_BLADE} quarter-blades = ${(CAMPO_FAR_BLADE * CAMPO.unitBlade * 100).toFixed(1)} cm`);

let worstTint = 0;
for (let ix = -60; ix < 60; ix += 1) {
  for (let iz = -60; iz < 60; iz += 1) {
    const d = Math.abs(campoTintOf(campoTintByte(ix, iz)) - pigTint(ix, iz));
    if (d > worstTint) worstTint = d;
  }
}
const step = (PIGMENT.tintCeil - PIGMENT.tintFloor) / 255;
report.check(worstTint <= step / 2 + 1e-9,
  'the tint survives the byte to within half a step of it',
  `worst ${worstTint.toFixed(5)} against half a step ${(step / 2).toFixed(5)}`);

report.line(`        one texel in metres: ${JSON.stringify(campoHeights(
  campoDecode(new Uint8Array([8, campoGroundByte(0), 16, 0]), 0)))}`);

if (process.argv.includes('--self')) {
  // THE OTHER DIRECTION, which is the half a guard is usually missing: the run
  // above is repeated with a defect of a single unit put into it by hand, and
  // what is asserted is that the predicates said no.
  selfTest('guard-campo', [
    {
      what: 'a texel one unit (1.25 cm) above the column under it',
      caught: injected ? !clean : true,
    },
    {
      what: 'a coarse cell told a top its children do not reach',
      caught: injected ? pyramidBad > 0 : true,
    },
  ]);
}

report.end(`${walked} near texels over ${CHUNKS.length} tiles and ${farWalked} far ones; `
  + `the two pictures are ${((CAMPO.bytes + CAMPO_FAR.bytes) / 1048576).toFixed(2)} MB on the card `
  + `and a near tile ${(CAMPO.tileBytes / 1024).toFixed(0)} kB on the wire`);
