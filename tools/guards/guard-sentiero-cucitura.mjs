import {
  GRID, gridToOffset, heightAt, offsetToGrid, pathCentreX, pathCoord, pathRun,
} from '../../src/world/terrain-field.js';
import { groundHeightAt } from '../../src/world/contracts.js';
import {
  FOOT, PATH_SKIN, drawnGroundAt, floorGapAt, pathCoverAt, pathMesh,
} from '../../src/world/path.js';
import { reporter, selfTest } from './lib.mjs';

// DOES THE CORRIDOR MEET THE MEADOW WITHOUT A STEP AND WITHOUT A GAP?
//
//   node tools/guards/guard-sentiero-cucitura.mjs
//   node tools/guards/guard-sentiero-cucitura.mjs --self
//
// WHY THERE HAS TO BE A GUARD AT ALL. The path stopped being painted into the
// ground and became a surface of its own, and two surfaces over one height field
// are two CHORDS of the same arc. The meadow's grid is bent to crowd its
// vertices near the walker, which leaves it 0.62 m a row along the run out where
// the paving is read; the corridor's is 0.40 m. The finer mesh follows the field
// more closely, so the coarser one stands ABOVE it wherever the ground is
// concave -- and where the meadow stands above the corridor, the meadow is drawn
// THROUGH the paving, in a ragged line that moves with the walker.
//
// The cure is a lift, and a lift is a step: a centimetre of stone standing proud
// of the grass all the way down the run is a kerb nobody asked for. So the lift
// is tapered to nothing at the corridor's own edge, and the two failures are at
// opposite ends of one number. This measures both, on the arithmetic, without a
// render -- which is the only way to measure them everywhere rather than at the
// three poses somebody thought to shoot.
//
// AND IT ASKS A THIRD THING, which is where the paving is allowed to be at all:
// the stone dies at z = -9.1 because the night target measured it there, and a
// corridor drawn past that northing would be putting stone where the meadow
// covers the join to the stair.

// How much of the corridor has to be standing before the crossing is judged. Out
// past this the surface is nearly transparent and what shows through it is
// meadow either way.
const LIVE = 0.20;
// How far the corridor may sink below the meadow's own triangles, in metres, in
// the stretch where it is live. NOUGHT: any crossing at all is the meadow drawn
// through the stone.
const SINK = 0;
// And how far its own LIFT may still be standing where the surface has begun to
// let go, in metres. One millimetre: the lift and the cover are tied to the same
// edge, so by the time anything can be seen through the corridor the lift is
// spent, and this is what says so rather than assuming it.
const STEP = 0.001;
// How far the paving may stand above the ground AS DRAWN, in metres, anywhere it
// is solid. It is the lift and a whisker: the surface is laid on the higher of
// the two answers about where the ground is, so what is left over the drawn
// meadow is the lift itself. Six millimetres is a finger's width less than the
// turf of the reference stands proud of its slabs, which is the right side of
// the reading to be on.
const PROUD = 0.006;
// Where the stone has to be out, in metres of northing, and how much may be
// left. The field extinguishes pathRun between -9.1 and -6.3.
const DEAD_Z = -9.1;
const DEAD = 0.001;

/**
 * The height of the MEADOW'S OWN TRIANGLES at a point -- not of the field they
 * were sampled from.
 *
 * That difference is the whole subject of this guard. The field is smooth and
 * both meshes sample it; what the frame draws is the flat triangle between three
 * samples, and it is the triangle that can stand above the corridor. So the quad
 * is found the way src/world/terrain.js indexes it and split the way it splits
 * it, and the point is interpolated over whichever of the two triangles it falls
 * in.
 */
function meadowAt(x, z) {
  const n = GRID.samples;
  const u = (offsetToGrid(x - GRID.centreX) + 1) / 2;
  const v = (offsetToGrid(z - GRID.centreZ) + 1) / 2;
  const fi = Math.min(n - 2, Math.max(0, Math.floor(u * (n - 1))));
  const fj = Math.min(n - 2, Math.max(0, Math.floor(v * (n - 1))));
  const at = (i, j) => {
    const gx = GRID.centreX + gridToOffset((i / (n - 1)) * 2 - 1);
    const gz = GRID.centreZ + gridToOffset((j / (n - 1)) * 2 - 1);
    return { gx, gz, y: heightAt(gx, gz) };
  };
  const a = at(fi, fj);
  const b = at(fi + 1, fj);
  const c = at(fi, fj + 1);
  const d = at(fi + 1, fj + 1);
  const s = (x - a.gx) / (b.gx - a.gx);
  const t = (z - a.gz) / (c.gz - a.gz);
  // The mesh lays a, a+n, a+n+1 and then a, a+n+1, a+1 -- so the diagonal runs
  // from a to d, and which side of it the point falls on decides the triangle.
  if (s <= t) {
    // a, c, d
    return a.y + (d.y - c.y) * s + (c.y - a.y) * t;
  }
  // a, d, b
  return a.y + (b.y - a.y) * s + (d.y - b.y) * t;
}

/**
 * How far the corridor's own lift has been spent, at a place across the strip.
 *
 * Separated from the survey because it is the one thing here that is a property
 * of a PROFILE and not of a place: the lift is a function of how far across the
 * paving a point stands and of nothing else, so asking it at the strip's outer
 * edge answers for the whole run at once, exactly, rather than for the forty
 * thousand points somebody chose to sample.
 */
export function liftAt(d, { lift = FOOT.lift, taper = FOOT.taper } = {}) {
  if (taper === null) return lift;
  const t = Math.min(1, Math.max(0, (d - taper) / (FOOT.edge - taper)));
  return lift * (1 - t * t * (3 - 2 * t));
}

/** The worst crossing and the worst standing-proud, over the whole live run. */
export function survey({ lift = FOOT.lift, taper = FOOT.taper, onContract = false } = {}) {
  let sink = 0;
  let sinkAt = null;
  let proud = 0;
  let proudAt = null;
  let floor = 0;
  let floorAt = null;
  let deadest = 0;
  let deadAt = null;
  let live = 0;
  for (let z = PATH_SKIN.z0; z <= PATH_SKIN.z1; z += 0.05) {
    const centre = pathCentreX(z);
    for (let k = 0; k <= 40; k++) {
      const x = centre + (k / 40 - 0.5) * 2 * PATH_SKIN.half;
      const d = Math.abs(pathCoord(x, z));
      const cover = pathCoverAt(d, z);
      // The lift is re-derived here rather than taken from pathHeightAt, so the
      // injection below can move it without the seat moving.
      // Re-derived rather than taken from pathHeightAt, so the injections below
      // can lay the corridor somewhere else without the seat moving.
      const raise = liftAt(d, { lift, taper });
      const mine = (onContract ? groundHeightAt(x, z) : drawnGroundAt(x, z)) + raise;
      const meadow = meadowAt(x, z);
      if (cover >= LIVE) {
        live++;
        const below = meadow - mine;
        if (below > sink) { sink = below; sinkAt = [x, z, d]; }
        const over = mine - meadow;
        if (over > proud) { proud = over; proudAt = [x, z, d]; }
      }
      // What is asked out here is the corridor's OWN contribution and not the
      // difference between two surfaces: past the solid edge the meadow and the
      // contract still disagree by as much as they disagree anywhere, and that
      // is the ground's business. What must be nought is the lift, because the
      // lift is the only step this session put there.
      if (cover > 0.001) {
        const apart = Math.abs(floorGapAt(x, z));
        if (apart > floor) { floor = apart; floorAt = [x, z]; }
      }
      if (z < DEAD_Z && cover > deadest) { deadest = cover; deadAt = [x, z]; }
    }
  }
  return {
    sink, sinkAt, proud, proudAt, floor, floorAt, deadest, deadAt, live,
  };
}

if (process.argv.includes('--self')) {
  // The two ways this can be wrong, injected: a corridor laid AT the field, and
  // one whose lift never lets go.
  const flat = survey({ lift: 0, onContract: true });
  const tall = survey({ lift: 0.035 });
  const real = survey();
  selfTest('guard-sentiero-cucitura', [
    {
      what: 'a corridor laid on the walker\'s contract alone is pierced by the meadow'
        + ` (${(flat.sink * 1000).toFixed(1)} mm)`,
      caught: flat.sink > SINK,
    },
    {
      what: `a lift that never tapers is still standing at the edge (${(liftAt(FOOT.edge, { taper: null }) * 1000).toFixed(1)} mm)`,
      caught: liftAt(FOOT.edge, { taper: null }) > STEP,
    },
    {
      what: `a lift of an inch would be a kerb (${(tall.proud * 1000).toFixed(1)} mm proud of the meadow)`,
      caught: tall.proud > PROUD,
    },
    {
      what: `the delivered corridor is pierced nowhere (${(real.sink * 1000).toFixed(2)} mm)`,
      caught: real.sink <= SINK,
    },
    {
      what: 'the meadow really is being read as triangles and not as the field',
      caught: Math.abs(meadowAt(0.37, 7.13) - heightAt(0.37, 7.13)) > 1e-6,
    },
  ]);
}

const report = reporter('guard-sentiero-cucitura -- the corridor meets the meadow, and dies where the stone dies');

const seen = survey();
const built = pathMesh();
report.line(`  ${seen.live} sampled points carry a corridor; `
  + `${built.triangles} triangles over ${PATH_SKIN.z1 - PATH_SKIN.z0} m of run`);

report.check(seen.sink <= SINK,
  'the meadow is nowhere drawn through the paving',
  seen.sinkAt
    ? `worst ${(seen.sink * 1000).toFixed(2)} mm at x ${seen.sinkAt[0].toFixed(2)} z ${seen.sinkAt[1].toFixed(2)}`
    : 'nothing above it anywhere');
report.check(liftAt(FOOT.edge) <= STEP,
  'the corridor has spent its lift by the time its surface runs out',
  `${(liftAt(FOOT.solid) * 1000).toFixed(2)} mm still standing where it is last solid, `
  + `${(liftAt(FOOT.edge) * 1000).toFixed(3)} mm of ${(STEP * 1000).toFixed(0)} at the edge`);
report.check(seen.proud <= PROUD,
  'the paving is bedded in the meadow and does not stand on it',
  seen.proudAt
    ? `worst ${(seen.proud * 1000).toFixed(2)} mm of ${(PROUD * 1000).toFixed(0)} at `
      + `x ${seen.proudAt[0].toFixed(2)} z ${seen.proudAt[1].toFixed(2)}`
    : '');
// AND THE ONE NUMBER THAT IS NOT THIS SESSION'S, printed rather than judged.
//
// The walker's floor and the ground as it is drawn are two samplings of one
// field and they do not agree: over this footprint they stand this far apart,
// and they stand that far apart under the meadow as well, where nothing has ever
// had to notice. The corridor is laid on the picture, so the picture is right;
// what is left is a walker whose feet are a little above or below the ground
// they are drawn on, everywhere in this world and not only here.
report.note('the walker\'s contract and the ground as drawn stand '
  + `${(seen.floor * 1000).toFixed(1)} mm apart at worst over the corridor`
  + (seen.floorAt ? `, at x ${seen.floorAt[0].toFixed(2)} z ${seen.floorAt[1].toFixed(2)}` : '')
  + ' -- the ground session owns that, not the path');

report.check(seen.deadest <= DEAD,
  `no paving is drawn south of z = ${DEAD_Z}, where the night target puts the last stone`,
  seen.deadAt ? `most ${seen.deadest.toFixed(4)} at z ${seen.deadAt[1].toFixed(2)}` : '');
report.check(pathRun(PATH_SKIN.z0) < DEAD && pathRun(PATH_SKIN.z1) < DEAD,
  'both ends of the strip stand on ground with no paving on them',
  `run ${pathRun(PATH_SKIN.z0).toFixed(4)} at z ${PATH_SKIN.z0}, `
  + `${pathRun(PATH_SKIN.z1).toFixed(4)} at z ${PATH_SKIN.z1}`);

report.end();
