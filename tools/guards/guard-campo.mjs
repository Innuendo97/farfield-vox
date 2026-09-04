import {
  BLADE, BLADES_PER_VOXEL, CHUNK, MANTO, MATERIAL, NO_COLUMN, PIGMENT, SUB, VOXEL,
  CAMPO, CAMPO_ATLAS, CAMPO_MATERIAL, CAMPO_PRESENT, CAMPO_RUNG, CAMPO_TILE,
  campoDecode, campoSlimCode, campoSlimEighths, campoSlot, campoTile,
  campoTintByte, campoTintOf, campoTopStep, chunkColumns, pigTint,
} from '../../src/world/voxel/pure.js';
import { TIERS } from '../../src/core/quality.js';
import { reporter, selfTest } from './lib.mjs';

// GUARD-CAMPO -- THE PICTURE REPRODUCES THE STORE, IN BOTH DIRECTIONS.
//
// ===========================================================================
// WHAT THIS GUARD IS FOR, IN ONE SENTENCE: the ray-marched field is a SECOND
// WAY TO DRAW THE SAME GROUND, and the whole of the campaign's case for it
// rests on the word SAME. The moment a texel says something the block store
// does not, the world has two answers about where the floor is -- which is
// exactly the defect the pivot to a block store was made to remove, arriving by
// the back door in a texture.
//
// So the assertions are not "does the picture look right". They are:
//
//   1. EVERY texel of a chunk equals the column under it. Not a sample: every
//      one, over chunks chosen to carry every feature this world has -- the
//      open meadow, the corridor and its verge of earth, the masses, and the
//      rim of the disc where the columns stop.
//   2. AND BACK: every column is findable in the picture at the address the
//      shader computes, through campoSlot's own toroidal wrap. A guard that
//      only walked the texels would pass a picture that was right where it was
//      written and wrote it in the wrong place.
//   3. THE PYRAMID IS A PYRAMID OF MAXIMA. The traversal skips a cell when its
//      maximum is under the ray, so a level that under-reported by one unit
//      would cut the tops off blades at a distance -- and nobody would see that
//      as a DEFECT, it would read as level of detail.
//   4. THE TINT IS THE PIGMENT'S OWN PURE TWIN, at the integer column the
//      fragment of material.js samples it at, to the byte it is stored in.
//   5. THE PACKING HOLDS THE LAW. Two bits for a width the law draws in
//      eighths, one for presence: the day MANTO.slim widens, this fails HERE
//      rather than silently drawing every wide blade as a narrow one.
//   6. THE UNIT DIVIDES THE WORLD. A voxel has to be a whole number of the
//      height unit or every ground in the picture is quantised twice.
//   7. THE ATLAS DOES NOT OVERLAP ITSELF, and a chunk's toroidal address never
//      straddles the wrap -- which is the property the seven writes of the
//      update rest on, and the only reason the window has no case analysis.
// ===========================================================================

const report = reporter('guard-campo -- the picture reproduces the store');

// The disc that ships, for the reason guard-fusione gives: the ground that
// exists is the ground the tiers lay, and the field is a window over it.
const RADIUS = Math.max(...TIERS.map((t) => t.voxelDiscRadius));

// FOUR CHUNKS, AND EACH IS CHOSEN FOR A FEATURE AND NOT FOR COVERAGE.
//   0,0   the middle of the hub: the corridor, its stone, its verge of earth
//   0,1   the open meadow north of the spawn -- the pose the campaign judges on
//  -1,0   the meadow west, where the masses stand
//   0,2   the RIM: half its columns are outside the disc and must read absent
const CHUNKS = [{ cx: 0, cz: 0 }, { cx: 0, cz: 1 }, { cx: -1, cz: 0 }, { cx: 0, cz: 2 }];

/** The store a chunk's tile was cut from, cut again here so nothing is shared. */
function storeOf(cx, cz) {
  return chunkColumns(cx, cz, CHUNK, true, RADIUS, {
    x: 0, z: 0, detail: Infinity, block: MANTO.block,
  });
}

const MAT_OF = {
  [MATERIAL.GRASS]: CAMPO_MATERIAL.GRASS,
  [MATERIAL.EARTH]: CAMPO_MATERIAL.EARTH,
  [MATERIAL.PATH]: CAMPO_MATERIAL.PATH,
};

const injected = process.argv.includes('--inject');

// --------------------------------------------------------------------------
// 1 and 2. THE TEXEL AND THE COLUMN, BOTH WAYS.
// --------------------------------------------------------------------------
let walked = 0;
let present = 0;
let blades = 0;
let narrow = 0;
const wrong = {
  presence: 0, ground: 0, top: 0, mat: 0, slim: 0, tint: 0, address: 0,
};
let firstWrong = '';
const note = (what) => { if (!firstWrong) firstWrong = what; };

for (const { cx, cz } of CHUNKS) {
  const tile = campoTile(cx, cz, RADIUS);
  // The self test's own hand on the answer: one texel raised by a single unit,
  // which is 1.25 cm and is exactly the size of defect a picture can carry
  // without looking wrong.
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
      // THE GROUND, ASKED BACK IN THE UNIT THE WORLD IS KEPT IN. The texel is
      // read back as a voxel top and compared with the store's own Int16, so a
      // unit that did not divide would show here as a rounding rather than pass.
      if (campoTopStep(texel) !== top) {
        wrong.ground += 1;
        note(`ground at ${cx},${cz} texel ${i},${j}: ${campoTopStep(texel)} against ${top}`);
      }
      if (texel.mat !== family) {
        wrong.mat += 1;
        note(`material at ${cx},${cz} texel ${i},${j}`);
      }
      // THE BLADE. The corridor's stone carries none -- the tiles are not this
      // family's -- and everything else carries what layMat laid, to the unit.
      const blade = family === CAMPO_MATERIAL.PATH ? 0 : store.blade[k];
      const height = Math.min(255, (top + 1) * CAMPO_RUNG + blade);
      if (texel.top !== height) {
        wrong.top += 1;
        note(`blade at ${cx},${cz} texel ${i},${j}: ${texel.top} against ${height}`);
      }
      if (texel.top > texel.ground) blades += 1;
      if (texel.slim !== store.slim[k]) {
        wrong.slim += 1;
        note(`width at ${cx},${cz} texel ${i},${j}: ${texel.slim} against ${store.slim[k]}`);
      }
      if (texel.slim) narrow += 1;
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
  'every texel of four chunks was walked, not a sample of them', `${walked}`);
report.check(present > 0 && blades > 0 && narrow > 0,
  'and those four carry columns, blades and narrow blades',
  `${present} columns, ${blades} with a blade, ${narrow} narrow`);
report.check(wrong.presence === 0, 'a texel is there exactly where a column is',
  wrong.presence ? `${wrong.presence} disagree` : '');
report.check(wrong.ground === 0, 'the ground of a texel is the top of its column',
  wrong.ground ? `${wrong.ground} disagree` : '');
report.check(wrong.top === 0, 'its top is that ground plus the blade layMat laid',
  wrong.top ? `${wrong.top} disagree` : '');
report.check(wrong.mat === 0, 'its material is the material of its column',
  wrong.mat ? `${wrong.mat} disagree` : '');
report.check(wrong.slim === 0, 'its width is the width the mat gave that blade',
  wrong.slim ? `${wrong.slim} disagree` : '');
report.check(wrong.tint === 0, 'its tint is pigTint at its own column of the world',
  wrong.tint ? `${wrong.tint} disagree` : '');
report.check(wrong.address === 0,
  'and the address the shader computes lands on the texel that was written',
  wrong.address ? `${wrong.address} disagree` : '');
if (firstWrong) report.line(`        first disagreement: ${firstWrong}`);

// --------------------------------------------------------------------------
// 3. THE PYRAMID IS A PYRAMID OF MAXIMA.
// --------------------------------------------------------------------------
let pyramidBad = 0;
let pyramidCarried = 0;
{
  const tile = campoTile(0, 1, RADIUS);
  if (injected) {
    // The FIRST coarse cell that reaches above the plane, lowered by one unit.
    // A cell chosen by its coordinates would land on bare ground as often as
    // not, and lowering a maximum of nought is not a defect -- a self test that
    // injected one would pass while proving nothing.
    const dst = CAMPO_TILE.origins[1];
    const size = CAMPO.tile >> 1;
    for (let j = 0; j < size; j += 1) {
      let done = false;
      for (let i = 0; i < size && !done; i += 1) {
        const o = ((dst.y + j) * CAMPO_TILE.width + (dst.x + i)) * 4;
        if (tile.data[o] > 0) { tile.data[o] -= 1; done = true; }
      }
      if (done) break;
    }
  }
  for (let level = 1; level < CAMPO.levels; level += 1) {
    const size = CAMPO.tile >> level;
    const src = CAMPO_TILE.origins[level - 1];
    const dst = CAMPO_TILE.origins[level];
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        let r = 0;
        let g = 0;
        let best = -1;
        let childB = 0;
        let childA = 0;
        for (let dj = 0; dj < 2; dj += 1) {
          for (let di = 0; di < 2; di += 1) {
            const s = ((src.y + j * 2 + dj) * CAMPO_TILE.width + (src.x + i * 2 + di)) * 4;
            if (tile.data[s] > r) r = tile.data[s];
            if (tile.data[s + 1] > g) g = tile.data[s + 1];
            const rank = tile.data[s + 2] ? tile.data[s] * 2 + 1 : -1;
            if (rank > best) {
              best = rank;
              childB = tile.data[s + 2];
              childA = tile.data[s + 3];
            }
          }
        }
        const o = ((dst.y + j) * CAMPO_TILE.width + (dst.x + i)) * 4;
        if (tile.data[o] !== r || tile.data[o + 1] !== g) pyramidBad += 1;
        else if (tile.data[o + 2] !== childB || tile.data[o + 3] !== childA) pyramidCarried += 1;
      }
    }
  }
}
report.check(pyramidBad === 0, 'every coarse cell is the maximum of the four under it',
  pyramidBad ? `${pyramidBad} are not` : '');
report.check(pyramidCarried === 0,
  'and its material and its tint are the tallest of those four',
  pyramidCarried ? `${pyramidCarried} are not` : '');

// --------------------------------------------------------------------------
// 4 to 7. THE PACKING, THE UNIT, THE ATLAS AND THE WRAP.
// --------------------------------------------------------------------------
const widths = [0];
for (let w = MANTO.slim.low; w < MANTO.slim.high; w += 1) widths.push(w);
report.check(widths.map(campoSlimCode).every((c) => c >= 0 && c < 4),
  'two bits hold every width the law draws', `eighths ${widths.join(', ')}`);
report.check(widths.every((w) => campoSlimEighths(campoSlimCode(w)) === w),
  'and every one of them comes back out unchanged');
report.check(CAMPO_PRESENT > ((3 << 2) | 3),
  'the bit of presence stands above the two fields packed under it', `${CAMPO_PRESENT}`);

report.check(Number.isInteger(VOXEL / CAMPO.unit) && CAMPO.unit === BLADE / SUB,
  'a voxel is a whole number of height units, and the unit is the mat own',
  `${VOXEL / CAMPO.unit} to a voxel, ${(CAMPO.unit * 100).toFixed(2)} cm each, `
  + `one byte spans ${(255 * CAMPO.unit).toFixed(4)} m`);
report.check(CAMPO.side % CAMPO.tile === 0 && CAMPO.tile === CHUNK * BLADES_PER_VOXEL,
  'the window is a whole number of chunks, and a chunk is the engine own',
  `${CAMPO.side / CAMPO.tile} chunks a side of ${CAMPO.tile} texels`);
report.check((CAMPO.tile >> (CAMPO.levels - 1)) >= 1,
  'no level of the pyramid has a cell wider than the chunk that writes it',
  `level ${CAMPO.levels - 1} is ${CAMPO.tile >> (CAMPO.levels - 1)} texels of a tile`);

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

let overlap = 0;
for (let a = 0; a < CAMPO.levels; a += 1) {
  for (let b = a + 1; b < CAMPO.levels; b += 1) {
    const A = { ...CAMPO_ATLAS.origins[a], s: CAMPO.side >> a };
    const B = { ...CAMPO_ATLAS.origins[b], s: CAMPO.side >> b };
    if (A.x < B.x + B.s && B.x < A.x + A.s && A.y < B.y + B.s && B.y < A.y + A.s) overlap += 1;
  }
}
report.check(overlap === 0, 'no two levels of the atlas claim one texel',
  `${CAMPO_ATLAS.width} x ${CAMPO_ATLAS.height}`);
report.check(CAMPO_ATLAS.origins.every((o, l) => o.x + (CAMPO.side >> l) <= CAMPO_ATLAS.width
  && o.y + (CAMPO.side >> l) <= CAMPO_ATLAS.height),
'and every level of it stands inside the picture');

let straddle = 0;
for (let c = -9; c <= 9; c += 1) {
  for (let level = 0; level < CAMPO.levels; level += 1) {
    const slot = campoSlot(c * CAMPO.tile, c * CAMPO.tile, level);
    if (slot.x % slot.size !== 0 || slot.y % slot.size !== 0
      || slot.x + slot.size > (CAMPO.side >> level)
      || slot.y + slot.size > (CAMPO.side >> level)) straddle += 1;
  }
}
report.check(straddle === 0,
  'a chunk square is aligned at every level and never straddles the wrap',
  straddle ? `${straddle} do` : '');

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
      what: 'a coarse cell told a maximum its children do not reach',
      caught: injected ? pyramidBad > 0 : true,
    },
  ]);
}

report.end(`${walked} texels over ${CHUNKS.length} chunks; the picture is `
  + `${(CAMPO_ATLAS.width * CAMPO_ATLAS.height * 4 / 1048576).toFixed(2)} MB on the card `
  + `and a chunk ${(CAMPO_TILE.width * CAMPO_TILE.height * 4 / 1024).toFixed(0)} kB on the wire`);
