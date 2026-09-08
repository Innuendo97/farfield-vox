import SPEC from '../../assets-src/distant/cornice.json' with { type: 'json' };
import {
  CENTRE, checkSpec, crownAt, frontierAt, grainAt, hillAt, isRockAt, ladders,
} from '../../assets-src/distant/cornice.mjs';
import { directionOf, turnOf } from './compass.js';
import { waterLevel } from './voxel/confine.js';

// THE HILLS, CUT INTO CUBES. Arithmetic and typed arrays, and nothing a browser
// owns: no `three`, no DOM. That is what lets this run on a worker thread, and
// running on a worker thread is not a nicety.
//
// MEASURED: three and a half seconds. On the thread the walker is on, that is
// not a slow frame, it is a DEAD TAB -- the page was killed outright by the
// harness that took the first picture of it. And E-CONF1 bought the first frame
// down to about 1.1 s by moving exactly this class of work off the main thread;
// putting three and a half back would undo that four times over for a horizon
// nobody has walked up to yet.
//
// So the door is ./distant-worker.js, the seat is here, and src/world/distant.js
// turns what comes back into geometry. The same three files the disc already
// uses for the same reason (src/world/voxel/index.js, mesher-worker.js,
// mesher.js), and for the same stated one: the arithmetic IS the shared
// definition of where the ground is, and a second faster copy of it would be a
// second opinion about it.

checkSpec(SPEC);

const WATER = waterLevel();

// ------------------------------------------------------------ the two classes
//
// SIX COLOURS IN THE WHOLE RANGE OF HILLS, so a face carries an INDEX and not a
// colour. That is the difference between twelve bytes a vertex and one, which
// on ninety thousand quads is 3.9 MB of card -- the mesh went from 10.2 MB,
// over the budget this delivery is asking for, to 6.3 under it. And it is not a
// quantisation: six is exactly how many there are, so nothing is rounded and
// the palette stays a uniform the next unit can refit without rebuilding a
// single vertex.
//
// R6 §2.3 inverted these radiances out of the picture through the same chain
// the frame develops everything through. Which one a face carries is decided by
// the face: a top is a top, a flank is lit or shaded by its own normal against
// a sun at azimuth 255 and sixty degrees up, and a riser of two cubes or more
// is stone whatever else it would have been -- §2.4's own reading, that the
// rock stands high and on the steep and the grass lies on the low treads.
//
// The QUOTAS -- twenty per cent lit stone, forty-nine in shadow, fifteen grass
// on the near right hill -- are U-CORNICE-2's to hit, with the patches and the
// spires. What is here is two classes and six faces.

export const SHADE = {
  GRASS_TOP: 0, GRASS_LIT: 1, GRASS_SHADE: 2, ROCK_TOP: 3, ROCK_LIT: 4, ROCK_SHADE: 5,
};

/** The six radiances, in the order the index above names them. */
export function palette() {
  const p = SPEC.palette;
  // SIX ENTRIES AND NO LONGER FIVE AND A DERIVATION. The lit grass flank used
  // to be the top damped by a fifth, «one number rather than a seventh
  // measurement nobody took». It is now taken: it carries fourteen thousand
  // pixels of the two near flanks, where the top carries six hundred, so the
  // measured one is the flank and the DERIVED one is the top.
  return [p.grassTop, p.grassLit, p.grassShade, p.rockTop, p.rockLit, p.rockShade];
}

// THE SUN, ON THE WORLD'S OWN COMPASS AND NOT ON A SECOND COPY OF IT.
//
// `matter.sun.azimuth` is a BEARING -- nought at north, positive to the east --
// so the horizontal half of the vector is the compass's own `directionOf` and
// the elevation only shortens it. Written out with sines here, it was three
// lines that agreed with the compass by coincidence rather than by import.
const SUN = (() => {
  const el = SPEC.matter.sun.elevation * (Math.PI / 180);
  const [dx, , dz] = directionOf(SPEC.matter.sun.azimuth);
  const flat = Math.cos(el);
  return { x: dx * flat, y: Math.sin(el), z: dz * flat };
})();

const LIT = 0.15;

function shadeOf(rock, nx, ny, nz) {
  const lit = nx * SUN.x + ny * SUN.y + nz * SUN.z;
  if (ny > 0.5) return rock ? SHADE.ROCK_TOP : SHADE.GRASS_TOP;
  if (rock) return lit > LIT ? SHADE.ROCK_LIT : SHADE.ROCK_SHADE;
  return lit > LIT ? SHADE.GRASS_LIT : SHADE.GRASS_SHADE;
}

// ------------------------------------------------------------------ the mesher
//
// GREEDY, IN SIXTEEN WEDGES, AND THE WEDGES ARE THE DRAW CALLS.
//
// One mesh for the whole ring of hills would be one draw and would also be
// unculled: the frustum culls whole objects, so a walker looking north would
// pay for the hills behind him at every frame. Sixteen wedges cost sixteen
// bounding spheres and hand the card five of them through a forty-four degree
// lens -- which is where the draw count in the amended budget comes from and
// why it is eighteen and not six.

/** No walker's eye rises above this inside the plateau, so nothing higher is a top. */
const EYE_CEILING = 5;
/** Past this from the middle of the world, an outward flank has turned away for good. */
const RIM = 40;

/** The rung of a ladder at or below a height. */
function bedFloor(ladder, above) {
  if (above <= 0) return 0;
  let lo = 0;
  let hi = ladder.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ladder[mid] <= above) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Which ring owns a place, from a height the caller already asked for. */
function ringOfPoint(h) {
  const { frontiers, cubes } = SPEC.rings;
  if (h.r < frontierAt(SPEC, frontiers[0], h.bearing)) return -1;
  for (let k = 0; k < cubes.length; k++) {
    if (h.r < frontierAt(SPEC, frontiers[k + 1], h.bearing)) return k;
  }
  return -1;
}

/**
 * The height field and the material of one ring, on its own lattice.
 *
 * THE HEIGHTS ARE TAKEN ONCE AND THE SLOPE IS READ OFF THEM. Asking the law for
 * the four neighbours of every cell to find its gradient is five evaluations of
 * the whole ridge stack where the field already holds all of them, and on the
 * seven hundred thousand cells this builds that is the difference between three
 * seconds and fifteen. It is also the more honest slope: what the material sees
 * is the slope of the ground that is BUILT, not of a smooth surface nobody
 * draws.
 */
function ringField(ring, lads) {
  const cube = SPEC.rings.cubes[ring];
  const outer = SPEC.rings.frontiers[ring + 1];
  const jitter = SPEC.rings.jitter;
  const ladder = lads[ring];
  const n = Math.ceil((2 * outer * (1 + jitter + 0.02)) / cube);
  const x0 = CENTRE.x - (n * cube) / 2;
  const z0 = CENTRE.z - (n * cube) / 2;
  const span = n + 2;
  const at = (i, j) => (j + 1) * span + (i + 1);
  const H = new Float32Array(span * span);
  const M = new Uint8Array(span * span);
  const smooth = new Float32Array(span * span);
  const relative = new Float32Array(span * span);
  // A skirt of one cell all round, so a flank at the lattice's edge has
  // something to be a step from.
  // THE ANNULUS AND NOT THE SQUARE. The lattice is square because a greedy
  // mesher walks rows, but the ring is a ring: two cells in five of that square
  // are inside the hole or outside the rim, and asking the law for a height
  // there is asking a question whose answer is thrown away. The radius is two
  // subtractions and a hypotenuse against four ridges, two fractal noises and a
  // bed ladder, and skipping on it took a second off the cut.
  const inner = SPEC.rings.frontiers[ring] * (1 - jitter) - cube;
  const outerMost = outer * (1 + jitter) + cube;
  // ONE BOX FOR SEVEN HUNDRED THOUSAND ANSWERS. The law hands back a fresh
  // object per call unless it is given one to fill, and on a lattice this size
  // the allocations and the collections after them are a fifth of the cut.
  const h = {};
  for (let j = -1; j <= n; j++) {
    for (let i = -1; i <= n; i++) {
      const x = x0 + (i + 0.5) * cube;
      const z = z0 + (j + 0.5) * cube;
      const k = at(i, j);
      const rx = x - CENTRE.x;
      const rz = z - CENTRE.z;
      const radius = Math.sqrt(rx * rx + rz * rz);
      if (radius < inner || radius > outerMost) {
        H[k] = WATER - 2 * cube;
        M[k] = 0;
        continue;
      }
      hillAt(SPEC, x, z, h);
      smooth[k] = h.y;
      const rel = (h.y - h.base) / Math.max(1, h.local);
      relative[k] = rel;
      // DROWNED GROUND IS NOT BUILT, AND THE TEST IS ON THE GROUND AND NOT ON
      // ITS RUNG: the ladder starts at the surface, so a rung of nought is what
      // everything under the water gets, and seating it there draws a cube one
      // metre proud of the lake over the whole bed. See groundTop() in the law
      // for what that measured.
      if (h.y <= WATER) {
        // Below the lattice's own floor, so a neighbour reads a flank going
        // down to nothing rather than a step up to a hill that is not there.
        H[k] = WATER - 2 * cube;
        M[k] = 0;
        continue;
      }
      const own = ringOfPoint(h);
      if (own !== ring) {
        // ANOTHER RING'S GROUND IS STILL GROUND, AND IT IS QUANTISED HERE.
        //
        // It used to be dropped to the lattice's floor like drowned water, and
        // that is a wall of the WHOLE HILL standing at the frontier: two
        // hundred metres of riser on the pale ring's inner edge, hidden by the
        // ring in front of it everywhere except where the two ladders disagree
        // -- and there it showed through as a picket of tall, thin, pale
        // stripes across both gaps between the monoliths. It is the same defect
        // as the grey city and it was measured the same way, by looking.
        //
        // A neighbour that belongs to another ring is therefore given the SAME
        // ground on THIS ring's ladder and no material: it emits no face of its
        // own, and the riser between it and its neighbour here is the step
        // between two quantisations of one hillside -- at most a cube, which is
        // the frontier seam R6 §4.1 predicted and sized at four pixels.
        H[k] = own < 0 ? WATER - 2 * cube
          : WATER + ladder[bedFloor(ladder, h.y - WATER)];
        M[k] = 0;
        continue;
      }
      // AND THE BROKEN ROCK STANDS ON THE TERRACE. crownAt() in the law is what
      // gives the skyline the reference's own three-pixel treads; here it is a
      // few more cubes on a column, which the greedy pass turns into one taller
      // riser and no extra quad at all wherever two neighbours draw the same.
      H[k] = WATER + ladder[bedFloor(ladder, h.y - WATER)]
        + crownAt(SPEC, x, z, ring, rel) * cube;
      M[k] = 1;
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = at(i, j);
      if (!M[k]) continue;
      const gx = (smooth[at(i + 1, j)] - smooth[at(i - 1, j)]) / (2 * cube);
      const gz = (smooth[at(i, j + 1)] - smooth[at(i, j - 1)]) / (2 * cube);
      const grain = grainAt(SPEC, x0 + (i + 0.5) * cube, z0 + (j + 0.5) * cube);
      M[k] = isRockAt(SPEC, Math.hypot(gx, gz), relative[k], grain) ? 2 : 1;
    }
  }
  return { n, cube, x0, z0, H, M, at };
}

// A WEDGE WRITES INTO ITS OWN TYPED ARRAYS AND GROWS THEM BY DOUBLING.
//
// It used to push into three plain arrays and convert them at the end. On a
// hundred and thirty thousand quads that is two million eight hundred thousand
// pushes and then a copy of every one of them, and measured it was a third of
// the cut -- the same third the worker was over its own ceiling by. Written
// straight into the array that ships, there is no conversion at all: `trim`
// hands back a view of exactly what was written.
function writer() {
  return {
    position: new Float32Array(4096 * 3),
    shade: new Uint8Array(4096),
    index: new Uint16Array(8192),
    vertices: 0,
    indices: 0,
  };
}

/** Room for `more` vertices and the six indices each quad of them needs. */
function room(w, more) {
  if ((w.vertices + more) * 3 > w.position.length) {
    let size = w.position.length;
    while ((w.vertices + more) * 3 > size) size *= 2;
    const position = new Float32Array(size);
    position.set(w.position.subarray(0, w.vertices * 3));
    w.position = position;
    const shade = new Uint8Array(size / 3);
    shade.set(w.shade.subarray(0, w.vertices));
    w.shade = shade;
  }
  if (w.indices + 6 > w.index.length) {
    const index = new Uint16Array(w.index.length * 2);
    index.set(w.index.subarray(0, w.indices));
    w.index = index;
  }
}

/**
 * One ring, meshed greedily into the wedges its faces fall in.
 *
 * Three passes: the treads, fused along both axes; the risers across x, fused
 * along z; the risers across z, fused along x. Each pass drops what the eye
 * cannot reach BEFORE it writes a vertex, which is where the whole saving is
 * and why the culling is not a later optimisation of this loop but its shape.
 */
function meshRing(ring, lads, wedges, tally) {
  const { n, cube, x0, z0, H, M, at } = ringField(ring, lads);
  const count = SPEC.rings.sectors;

  const quad = (points, shade) => {
    const cx = (points[0][0] + points[2][0]) / 2 - CENTRE.x;
    const cz = (points[0][2] + points[2][2]) / 2 - CENTRE.z;
    const turn = turnOf(cx, cz);
    const w = wedges[((Math.floor(turn * count) % count) + count) % count];
    room(w, 4);
    const first = w.vertices;
    let o = first * 3;
    for (const p of points) {
      w.position[o] = p[0];
      w.position[o + 1] = p[1];
      w.position[o + 2] = p[2];
      o += 3;
    }
    for (let c = 0; c < 4; c++) w.shade[first + c] = shade;
    let k = w.indices;
    w.index[k] = first;
    w.index[k + 1] = first + 1;
    w.index[k + 2] = first + 2;
    w.index[k + 3] = first;
    w.index[k + 4] = first + 2;
    w.index[k + 5] = first + 3;
    w.indices = k + 6;
    w.vertices = first + 4;
    tally.quads += 1;
    // AND THE AREA OF IT, BY CLASS. R6 §2.4 counted the reference's matter as
    // AREA of the frame and not as number of faces, and a greedy mesher makes
    // faces of wildly different size: one fused tread can be forty cells of one
    // riser. Counting quads would call a hillside grass because its grass came
    // in fewer, larger pieces.
    const a = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1],
      points[1][2] - points[0][2]);
    const b = Math.hypot(points[2][0] - points[1][0], points[2][1] - points[1][1],
      points[2][2] - points[1][2]);
    tally.area[shade] += a * b;
  };

  // --- the treads
  const emitTop = (run) => {
    // A TREAD OVER THE EYE IS A BACK FACE, ALWAYS.
    if (run.y + cube > EYE_CEILING) return;
    const xa = x0 + run.i0 * cube;
    const xb = x0 + run.i1 * cube;
    const za = z0 + run.j0 * cube;
    const zb = z0 + run.j1 * cube;
    const y = run.y + cube;
    quad([[xa, y, za], [xa, y, zb], [xb, y, zb], [xb, y, za]], shadeOf(run.m === 2, 0, 1, 0));
  };
  let previous = new Map();
  for (let j = 0; j < n; j++) {
    const runs = new Map();
    let i = 0;
    while (i < n) {
      const k = at(i, j);
      const m = M[k];
      if (!m) { i += 1; continue; }
      const y = H[k];
      let end = i + 1;
      while (end < n && M[at(end, j)] === m && H[at(end, j)] === y) end += 1;
      const key = `${i},${end},${y},${m}`;
      const carried = previous.get(key);
      if (carried) { carried.j1 = j + 1; runs.set(key, carried); previous.delete(key); }
      else runs.set(key, { i0: i, i1: end, j0: j, j1: j + 1, y, m });
      i = end;
    }
    for (const run of previous.values()) emitTop(run);
    previous = runs;
  }
  for (const run of previous.values()) emitTop(run);

  // --- the risers
  const riserOf = (a, b) => {
    const ya = H[a];
    const yb = H[b];
    if (ya === yb || (!M[a] && !M[b])) return null;
    const high = ya > yb ? a : b;
    const face = {
      lo: Math.min(ya, yb) + cube,
      hi: Math.max(ya, yb) + cube,
      sign: ya > yb ? 1 : -1,
      m: M[high] || M[a] || M[b],
    };
    // A RISER OF TWO CUBES OR MORE IS STONE (R6 §4.5): the grass lies on the low
    // treads, and a step a body could not take is a face of rock.
    if (face.hi - face.lo >= 2 * cube) face.m = 2;
    return face;
  };

  for (let i = -1; i < n; i++) {
    const emitX = (f) => {
      const x = x0 + (i + 1) * cube;
      // A FLANK THAT FACES OUT OF THE WORLD IS NEVER SEEN FROM INSIDE IT.
      if ((f.sign > 0 && x > CENTRE.x + RIM) || (f.sign < 0 && x < CENTRE.x - RIM)) return;
      const za = z0 + f.j0 * cube;
      const zb = z0 + f.j1 * cube;
      const c = shadeOf(f.m === 2, f.sign, 0, 0);
      if (f.sign > 0) quad([[x, f.lo, za], [x, f.hi, za], [x, f.hi, zb], [x, f.lo, zb]], c);
      else quad([[x, f.lo, zb], [x, f.hi, zb], [x, f.hi, za], [x, f.lo, za]], c);
    };
    let open = null;
    for (let j = 0; j <= n; j++) {
      const face = j < n ? riserOf(at(i, j), at(i + 1, j)) : null;
      if (open && face && face.lo === open.lo && face.hi === open.hi
        && face.sign === open.sign && face.m === open.m) { open.j1 = j + 1; continue; }
      if (open) { emitX(open); open = null; }
      if (face) open = { ...face, j0: j, j1: j + 1 };
    }
    if (open) emitX(open);
  }

  for (let j = -1; j < n; j++) {
    const emitZ = (f) => {
      const z = z0 + (j + 1) * cube;
      if ((f.sign > 0 && z > CENTRE.z + RIM) || (f.sign < 0 && z < CENTRE.z - RIM)) return;
      const xa = x0 + f.i0 * cube;
      const xb = x0 + f.i1 * cube;
      const c = shadeOf(f.m === 2, 0, 0, f.sign);
      if (f.sign > 0) quad([[xa, f.lo, z], [xb, f.lo, z], [xb, f.hi, z], [xa, f.hi, z]], c);
      else quad([[xb, f.lo, z], [xa, f.lo, z], [xa, f.hi, z], [xb, f.hi, z]], c);
    };
    let open = null;
    for (let i = 0; i <= n; i++) {
      const face = i < n ? riserOf(at(i, j), at(i, j + 1)) : null;
      if (open && face && face.lo === open.lo && face.hi === open.hi
        && face.sign === open.sign && face.m === open.m) { open.i1 = i + 1; continue; }
      if (open) { emitZ(open); open = null; }
      if (face) open = { ...face, i0: i, i1: i + 1 };
    }
    if (open) emitZ(open);
  }
}

/**
 * Every wedge of the hills, as typed arrays ready to be handed to the card.
 *
 * THE INDICES ARE SIXTEEN BITS AND THAT IS AN ASSERTION, NOT A HOPE: a wedge
 * that overflowed one would draw garbage, silently, on some of the card's
 * hardware and not on the rest. Sixteen wedges of ninety thousand quads is
 * twenty-two thousand vertices each, a third of what the type holds, and the
 * one that does not fit is thrown rather than truncated.
 *
 * @returns {{wedges: object[], stats: object}}
 */
export function buildHills() {
  const started = Date.now();
  const lads = ladders(SPEC);
  const count = SPEC.rings.sectors;
  const wedges = Array.from({ length: count }, writer);
  const tally = { quads: 0, area: new Float64Array(6) };
  const perRing = [];
  for (let ring = 0; ring < SPEC.rings.cubes.length; ring++) {
    const before = tally.quads;
    const area = Float64Array.from(tally.area);
    meshRing(ring, lads, wedges, tally);
    perRing.push({
      inner: SPEC.rings.frontiers[ring],
      outer: SPEC.rings.frontiers[ring + 1],
      cube: SPEC.rings.cubes[ring],
      quads: tally.quads - before,
      // Square metres of face, by the class the face carries: what a guard
      // needs to hold R6's quotas against the ground that is actually built.
      area: Array.from(tally.area, (v, k) => +(v - area[k]).toFixed(1)),
    });
  }
  const packed = [];
  let bytes = 0;
  for (const wedge of wedges) {
    if (!wedge.indices) { packed.push(null); continue; }
    const { vertices } = wedge;
    if (vertices > 65535) {
      throw new Error(`cornice: a wedge carries ${vertices} vertices, past what a 16-bit index holds`);
    }
    const position = wedge.position.slice(0, vertices * 3);
    const shade = wedge.shade.slice(0, vertices);
    const index = wedge.index.slice(0, wedge.indices);
    bytes += position.byteLength + shade.byteLength + index.byteLength;
    packed.push({ position, shade, index });
  }
  return {
    wedges: packed,
    stats: {
      quads: tally.quads,
      triangles: tally.quads * 2,
      bytes,
      buildMs: Date.now() - started,
      perRing,
    },
  };
}
