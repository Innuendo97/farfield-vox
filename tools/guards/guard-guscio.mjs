import { createGroundShell, SHELL_REACH } from '../../src/world/ground-shell.js';
import { shellHeightAt } from '../../src/world/contracts.js';
import {
  BASE_STEP, CENTRE, VOXEL, columnTop,
} from '../../src/world/voxel/pure.js';
import { TIERS } from '../../src/core/quality.js';
import { reporter, selfTest } from './lib.mjs';

// IS THE GROUND BEYOND THE CUBES THERE, AT THE LEVEL THE CUBES ARE AT?
//
//   node tools/guards/guard-guscio.mjs
//   node tools/guards/guard-guscio.mjs --self
//
// WHY IT EXISTS, AND IT IS NOT A TIDY-UP. The sheet from the rim of the disc to
// a hundred metres was built at E-V1f, measured at 7 168 triangles in one draw,
// and it was NOT DRAWN for the whole of the campaign that followed. Its two
// triangles a quad were wound clockwise seen from above, the material of the
// meadow is FrontSide, and the whole of it was culled: two hundred metres of
// ground delivered as sky, with a strip a few pixels tall surviving at the
// horizon where a projected triangle is so nearly degenerate that the sign of
// its area is noise. Every number about it was right. Nobody looked from a pose
// where the difference showed, and no gate could look at all.
//
// So this asks the four things a sheet has to be, and the first of them is the
// one nothing else in this world can ask:
//
//   * THE FACES LOOK UP. The geometric normal of every triangle -- the cross
//     product of its own two edges, not the attribute beside it, which said UP
//     the whole time it was wrong.
//   * IT IS THE SAME MEADOW. Inside thirty five metres the basin is nought, so
//     the sheet is a plane, and that plane is the floor the disc DRAWS:
//     (BASE_STEP + 1) * VOXEL, not the walkable field a voxel under it. Asked
//     at the rim, on every bearing, against the columns the disc really lays.
//   * NOTHING SHOWS UNDER THE RIM. The mesher hangs a skirt off the edge of the
//     disc; if it ended above the sheet there would be daylight under the piece.
//   * AND IT IS ONE DRAW. Section 2.9 allocates the shell 75 000 triangles and
//     one draw; it costs 7 168 and one.
//
// AND THE HEIGHT IS ONE STATEMENT. `shellHeightAt` in src/world/contracts.js is
// read both by the mesh that draws the sheet and by the floor a walker stands
// on out there; the last leg walks every vertex against it, so the two can never
// be two answers again.

/** The largest disc any tier lays, as guard-fusione and guard-piano read it. */
const SHIPPED_RADIUS = Math.max(...TIERS.map((t) => t.voxelDiscRadius));

/** Section 2.9's allocation for the shell. */
const BUDGET = { triangles: 75000, draws: 1 };

/** How far the mesher's rim wall drops, in voxels: mesher.js's own SKIRT. */
const SKIRT = 2;

const NO = -1e7;

/**
 * Which way each triangle of the sheet faces, from its own two edges.
 *
 * THE ATTRIBUTE IS NOT ASKED, deliberately: the normal buffer said up while the
 * winding said down, and reading it would have reproduced the defect instead of
 * catching it. Only the y of the cross product matters -- the sheet is a
 * surface of a height field and a face of it that pointed sideways would be a
 * different defect.
 */
export function facing(geometry) {
  const idx = geometry.getIndex();
  const p = geometry.getAttribute('position');
  let up = 0;
  let down = 0;
  let flat = 0;
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t);
    const i1 = idx.getX(t + 1);
    const i2 = idx.getX(t + 2);
    const ax = p.getX(i1) - p.getX(i0);
    const az = p.getZ(i1) - p.getZ(i0);
    const bx = p.getX(i2) - p.getX(i0);
    const bz = p.getZ(i2) - p.getZ(i0);
    const ny = az * bx - ax * bz;
    if (ny > 1e-9) up++;
    else if (ny < -1e-9) down++;
    else flat++;
  }
  return { up, down, flat, triangles: idx.count / 3 };
}

/** The outermost column of the disc along a bearing, and its drawn top. */
function rimAlong(radius, dx, dz) {
  for (let r = radius + 1; r > radius - 3; r -= VOXEL / 4) {
    const ix = Math.round((CENTRE.x + dx * r) / VOXEL - 0.5);
    const iz = Math.round((CENTRE.z + dz * r) / VOXEL - 0.5);
    const top = columnTop(ix, iz, true, radius);
    if (top > NO) return { ix, iz, top };
  }
  return null;
}

/**
 * The seam, all the way round: the drawn top of the rim against the sheet.
 *
 * ON THE FLOOR AND ON EVERYTHING, SEPARATELY, because they are two different
 * questions. A rim column carrying a sod or a mass stands a voxel or four over
 * the floor, and that is the meadow arriving at its own edge as itself; what
 * would be a seam is the FLOOR of the meadow meeting the sheet at a different
 * level, which is what a whole campaign of renders had.
 */
export function seam(radius, sheetY, bearings = 360) {
  let floors = 0;
  let floorWorst = 0;
  let allWorst = 0;
  let daylight = -Infinity;
  let worstAt = null;
  for (let k = 0; k < bearings; k++) {
    const a = (k / bearings) * Math.PI * 2;
    const rim = rimAlong(radius, Math.sin(a), -Math.cos(a));
    if (!rim) continue;
    const step = (rim.top + 1) * VOXEL - sheetY;
    if (Math.abs(step) > Math.abs(allWorst)) allWorst = step;
    if (rim.top === BASE_STEP) {
      floors++;
      if (Math.abs(step) > Math.abs(floorWorst)) {
        floorWorst = step;
        worstAt = rim;
      }
    }
    // The skirt is measured from the plane, so its foot is the same for every
    // column that is not standing on something taller than two voxels.
    const low = (Math.min(rim.top - SKIRT, BASE_STEP - SKIRT) + 1) * VOXEL - sheetY;
    if (low > daylight) daylight = low;
  }
  return { bearings, floors, floorWorst, allWorst, daylight, worstAt };
}

const shell = createGroundShell({ radius: SHIPPED_RADIUS, material: null });
const face = facing(shell.mesh.geometry);
const position = shell.mesh.geometry.getAttribute('position');

// The sheet's own level on its first ring, read vertex by vertex: inside thirty
// five metres the basin is nought, so every one of them has to be the same.
let low = Infinity;
let high = -Infinity;
for (let s = 0; s < shell.built.spokes; s++) {
  const y = position.getY(s);
  if (y < low) low = y;
  if (y > high) high = y;
}

// And every vertex against the seat both readers share.
let apart = 0;
for (let i = 0; i < position.count; i++) {
  const r = Math.hypot(position.getX(i), position.getZ(i));
  const d = Math.abs(position.getY(i) - shellHeightAt(r));
  if (d > apart) apart = d;
}
// A vertex is a Float32 and the seat answers in double, so the two agree to the
// buffer's own precision and not exactly. A tenth of a millimetre is four orders
// under the voxel and three over the rounding.
const APART = 1e-4;

const stitch = seam(SHIPPED_RADIUS, high);

if (process.argv.includes('--self')) {
  selfTest('guard-guscio', [
    {
      what: 'a sheet wound the way it shipped -- clockwise from above, culled everywhere',
      caught: face.up === face.triangles && face.down === 0,
    },
    {
      what: 'a normal attribute that says up over a winding that says down',
      caught: face.down === 0,
    },
    {
      what: 'a sheet laid on the walkable field, a voxel under the cubes it meets',
      caught: Math.abs(high - (BASE_STEP + 1) * VOXEL) < 1e-9,
    },
    {
      what: 'a step at the rim on the floor of the meadow',
      caught: stitch.floorWorst === 0 && stitch.floors > 0,
    },
    {
      what: 'a rim wall that ends over the sheet, with daylight under the piece',
      caught: stitch.daylight < 0,
    },
    {
      what: 'a second copy of the sheet\'s height, drifting from the contract',
      caught: apart <= APART,
    },
    {
      what: 'a sheet over the allocation of section 2.9',
      caught: shell.built.triangles <= BUDGET.triangles,
    },
  ]);
}

const report = reporter('guard-guscio -- the ground beyond the cubes is drawn, and it is their floor');

report.line(`  the sheet reaches ${SHELL_REACH} m from a disc of ${SHIPPED_RADIUS} m, `
  + `${shell.built.rings} rings by ${shell.built.spokes} spokes, starting at `
  + `${shell.built.radius.toFixed(2)} m`);

// ------------------------------------------------------------------- 1
report.check(face.up === face.triangles && face.down === 0 && face.flat === 0,
  'every triangle of the sheet faces up, by its own two edges and not by the attribute',
  `${face.up} up, ${face.down} down, ${face.flat} degenerate, of ${face.triangles}`);

// ------------------------------------------------------------------- 2
report.line('');
report.check(low === high,
  'inside the basin\'s own nought the sheet is one level',
  `${low.toFixed(4)} to ${high.toFixed(4)} m on the first ring`);
report.check(Math.abs(high - (BASE_STEP + 1) * VOXEL) < 1e-9,
  `and that level is the floor the disc DRAWS, ${((BASE_STEP + 1) * VOXEL).toFixed(3)} m`,
  `the sheet stands at ${high.toFixed(3)} m`);
report.check(stitch.floorWorst === 0,
  `so the seam is nought on all ${stitch.floors} bearings of ${stitch.bearings} where the rim `
  + 'column is plain floor',
  stitch.worstAt ? `${(stitch.floorWorst * 1000).toFixed(0)} mm at column `
    + `${stitch.worstAt.ix},${stitch.worstAt.iz}` : 'every one of them');
report.line(`  what stands over it elsewhere is the meadow's own: the worst rim column is `
  + `${(stitch.allWorst * 1000).toFixed(0)} mm over the sheet, which is a mass on the edge `
  + 'of the piece');

// ------------------------------------------------------------------- 3
report.line('');
report.check(stitch.daylight < 0,
  'no rim wall of the disc ends above the sheet, so there is no daylight under the piece',
  `the worst ends ${(stitch.daylight * 1000).toFixed(0)} mm under it`);

// ------------------------------------------------------------------- 4
report.line('');
report.check(shell.built.triangles <= BUDGET.triangles,
  `the sheet is ${shell.built.triangles} triangles against the ${BUDGET.triangles} of section 2.9`,
  `${shell.built.triangles} triangles`);
report.line(`  and one mesh, one material, one draw: it is two hundred metres across with the `
  + 'eye inside it, so it is in frame at every pose and carries no frustum test');

// ------------------------------------------------------------------- 5
report.line('');
report.check(apart <= APART,
  'the mesh and the contract answer the same height on every vertex of the sheet',
  `worst ${apart.toExponential(2)} m over ${position.count} vertices`);
report.line('  -- one statement, shellHeightAt in src/world/contracts.js, read by the mesh that '
  + 'draws the ground and by the floor a walker stands on out there');

report.end();
