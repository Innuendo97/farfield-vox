// THE LAW OF THE HILLS BEYOND THE WATER, AS ARITHMETIC AND NOTHING ELSE.
//
// No `three` here, on purpose and by the same rule the cornice has always been
// written under: four things ask this question and they must get one answer.
// The frame (src/world/distant.js) turns it into cubes, the fitter
// (./fit-cornice.mjs) solves the tables in ./cornice.json against the
// reference's own traced skyline, the guard (tools/guards/guard-cornice.mjs)
// re-derives every claim from here without opening a browser, and the walker
// never sees any of them. A second copy of the height of a hill is how those
// four stop describing the same world.
//
// ===========================================================================
// WHAT THIS FILE REPLACES, AND WHY THE OLD ONE WAS A WALL AND A CITY.
//
// Two systems owned the same ground. `confine.js` closed the horizon with ONE
// smooth hump at ninety-six metres -- one material, risers all the same, no
// rock, no beds, no shadow -- and `distant.js` drew three painted rings behind
// it at a hundred and fifty, two hundred and sixty and four hundred and twenty,
// of which the walker could only ever see the spires that stuck out over the
// wall. R6 measured what that reads as: a row of grey pinnacles over a
// blue-grey wall, at five to seven degrees on eighty-five bearings out of a
// hundred and eight. The reference has no wall and no line: it has HILLS, three
// and four planes of them behind each other, from three point seven to nine
// point five degrees at the sides, and in the gap it does not close at all --
// water to the far shore and then hills at two to seven.
//
// So there is one law now and it is this one, and the wall is gone
// (CONFINE.crest.height = 0, and guard-confine says so out loud).
//
// ===========================================================================
// THE FOUR THINGS THE REFERENCE ACTUALLY FIXES, WHICH ARE THE FOUR DIALS HERE.
//
// 1. WHERE THE SKYLINE IS, PER DIRECTION. Traced by hand off the target at
//    three-quarters of a degree of bearing (R6-03; the automatic tracer climbs
//    onto the clouds, because in this picture cloud and pale hill do not
//    separate by colour at all). That trace is the ONLY thing the height of a
//    hill is fitted to, and it is fitted per direction rather than by a curve:
//    see `profile` below.
//
// 2. HOW BIG A CUBE IS, WHICH IS THE SAME ANGLE ON EVERY PLANE. Five to eight
//    pixels, 0.25 to 0.40 degrees, on the near flank, on the middle crest and
//    on the palest ridge alike. That is not four measurements that happen to
//    agree, it is a law: a cube grows with its distance, s(D) = D * tan(0.30)
//    = D / 190. One metre at 185, two at 400, four at 820, eight at 1550 --
//    which is exactly the ladder of rings below, and the reason the cubes are
//    powers of two rather than the 1/2/5/10 the prototype ran: 5 m at 535 m is
//    0.54 degrees, half again over the band, and R6 said so itself.
//
// 3. THAT THE HILLS STAND IN THE WATER. The far shore reads at -2.3 degrees,
//    which with the surface at -4.74 m puts it at about 160 m; there is no
//    beach and no plinth under any of them. So the foot of every hill is
//    `basinProfile`, the campaign's one fitted fall, and the shore is found by
//    the depth buffer where the terraces come up through the level -- never
//    drawn. That is E-CONF1's shore, extended past the plateau.
//
// 4. THAT THERE IS NO LINE. Not because anything is blurred -- E-DECISIONI13
//    forbids that and R6 measured the target's own sky-to-hill edge at ONE
//    pixel, sharper than ours -- but because there is never a row of sky over
//    a single plane: the skyline climbs and drops in steps and behind every
//    plane there is another. An absence is defended by a guard rather than by
//    a sentence, and guard-cornice has one.
//
// ===========================================================================
// WHAT IS NOT DECIDED HERE.
//
// THE FINE MATTER IS U-CORNICE-2's. This file carries TWO classes -- rock and
// grass -- with the palette R6 inverted out of the picture's own chain, and the
// rock line and the slope that separate them. The patches, the spires as real
// cubes, the cube trees on the treads and the lamp seats are the next unit's,
// and the seats they will stand on are already here (`ridgeLampSeats`) because
// the contract that names them is V7's and may not change its name.
//
// THE AIR IS THE COORDINATOR'S. src/world/air.js is a frozen seat and this file
// does not own a fog. What it carries is the DISTANCE the air will be asked
// about and the shape R6 measured it to have, in `air` below, so that the frame
// can hand a per-channel term to the same function the meadow uses the moment
// air.js publishes one. Until then the fallback is written where it can be
// read, in src/world/distant.js, and it is marked as a fallback.

// THROUGH `pure.js` AND NOT THROUGH THE FILES THAT DEFINE THEM, which is the
// house's own rule and is written over that file: it is the seat that carries
// the engine's arithmetic with nothing a browser owns in it, so a guard can ask
// this law the same question the page asks and get the same answer under plain
// node. `CENTRE` comes with them for the reason the fall does: the hills stand
// in the basin and the basin is a function of the radius from the middle of the
// world -- two centres would put the water's edge at one radius and the hills'
// feet at another, and the difference between them is a ring of ground standing
// over its own lake.
import { CENTRE, basinProfile, waterLevel } from '../../src/world/voxel/pure.js';

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export { CENTRE };

/**
 * The height of the standing water, from the boundary's own seat.
 *
 * Re-exported under a name of this file's so that the fitter and the guard ask
 * the law rather than reaching past it into `confine.js`: one door, and the
 * surface of the lake stays a level in the basin and never a literal.
 */
export function waterLine() {
  return waterLevel();
}

// ---------------------------------------------------------------- the noise
//
// AN INTEGER BIT-MIX AND NOT THE SINE HASH, and that is arithmetic and not
// taste. `sin(k * 127.1) * 43758` is the hash the painted cornice uses and it
// is right there, because it is keyed on a bed index that never exceeds a few
// hundred. Here the key is a LATTICE POINT out to two thousand metres: at a
// cube of one metre that is four thousand steps across, the product runs past
// what a float can hold exactly, and the same hill would come out different on
// two machines. The mix below is the one src/world/path.js already uses for the
// paving's grain, for the same reason and with the same constants.

/** A deterministic value in [0,1) from a lattice point. */
export function hash2(ix, iz) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** A deterministic value in [0,1) from a whole number, V5's own seat. */
export function hash1(k, salt) {
  const s = Math.sin(k * 127.1 + salt * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise on the unit lattice, quintic fade so the gradient is continuous. */
export function vnoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

/**
 * Fractal value noise in [-0.5, 0.5], normalised so the amplitude in the spec
 * means what it says whatever the octave count.
 */
export function fbm(x, z, octaves = 3, lacunarity = 2.07, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let px = x;
  let pz = z;
  for (let k = 0; k < octaves; k++) {
    sum += amp * (vnoise(px, pz) - 0.5);
    norm += amp;
    amp *= gain;
    px = px * lacunarity + 7.3;
    pz = pz * lacunarity + 3.1;
  }
  return sum / norm;
}

/**
 * The sum of the spec's waves at one bearing, in [-1, 1].
 *
 * THREE TURNS THAT SHARE NO FACTOR -- three, seven and thirteen -- which is the
 * device `confine.js` uses on its own crest and for the same stated reason: a
 * ridge of one radius is a circumference whatever it is made of, and
 * «NESSUNA circonferenza visibile» is the whole of the boundary's brief. Here
 * they move the RADIUS of each ridge only; the height is the fitted table.
 *
 * @param {number} bearing  radians, nought is north
 * @param {{turns:number,phase:number,weight:number}[]} waves
 * @param {number} seed  radians of extra phase, one per ridge
 */
export function sway(bearing, waves, seed = 0) {
  let sum = 0;
  let weight = 0;
  for (const w of waves) {
    sum += w.weight * Math.sin(bearing * w.turns + w.phase + seed);
    weight += w.weight;
  }
  return sum / weight;
}

// ------------------------------------------------------------------ the table
//
// TWELVE SINES A CELL, AND THERE ARE SEVEN HUNDRED THOUSAND CELLS.
//
// Every ridge asks `sway` twice -- once for the radius its crown stands at and
// once, at another seed, for the frontier of its ring -- and every `sway` is
// three sines. Measured, the whole cut took four and eight tenths of a second
// in the worker against R6 §7's budget of one and a half, and the sines were
// most of it.
//
// A sum of three sines of the bearing is PERIODIC and SMOOTH: sampled every
// twentieth of a degree it is reproduced by linear interpolation to about one
// part in ten million, which is nanometres of hillside at fifteen hundred
// metres and nothing the eye or a guard can reach. So it is sampled once per
// seed, at module load, and read.
//
// THE SAME TABLE ANSWERS THE FRAME, THE FITTER AND THE GUARD, which is the only
// reason it is allowed: an approximation used by one of the three and not the
// others would be exactly the second opinion this file exists to prevent.

const SWAY_STEPS = 7200;
const SWAY_SCALE = SWAY_STEPS / (Math.PI * 2);

// KEYED BY THE SEED, WHICH IS A NUMBER, and that is not a detail. The first
// draft keyed the cache on a string built out of the waves at every call --
// eight times a cell, seven hundred thousand cells -- and the tables made the
// cut SLOWER than the sines they replaced, five and seven tenths of a second
// against three. A table read has to cost a table read.
//
// One set of waves per spec, so the seed alone identifies a curve; the waves
// are carried alongside and checked once, when the table is cut, so a second
// set could never quietly read the first one's answers.
const swayTables = new Map();
let swayWaves = null;

function swayTable(waves, seed) {
  if (swayWaves !== waves) { swayTables.clear(); swayWaves = waves; }
  let table = swayTables.get(seed);
  if (table) return table;
  table = new Float64Array(SWAY_STEPS + 1);
  for (let k = 0; k <= SWAY_STEPS; k++) {
    table[k] = sway((k / SWAY_STEPS) * Math.PI * 2, waves, seed);
  }
  swayTables.set(seed, table);
  return table;
}

/** `sway`, read from its own table: the same curve, without the sines. */
export function swayAt(bearing, waves, seed = 0) {
  const table = swayTable(waves, seed);
  let turn = bearing * SWAY_SCALE;
  turn -= Math.floor(turn / SWAY_STEPS) * SWAY_STEPS;
  const k = turn | 0;
  return table[k] + (table[k + 1] - table[k]) * (turn - k);
}

// ------------------------------------------------------- the per-direction fit
//
// THE HEIGHT OF A RIDGE IS A TABLE AND NOT A CURVE, AND THAT IS THE WHOLE
// DIFFERENCE BETWEEN THIS AND THE PROTOTYPE.
//
// R6's prototype fitted the near ridge's crown to the traced skyline and let
// three waves carry the rest. Measured afterwards, its own skyline missed the
// trace by 0.5 to 3.7 degrees, and it missed for two reasons that a curve
// cannot answer: (1) the silhouette is the MAXIMUM along a ray, so the
// roughness that makes a hill a hill lifts it above whatever its crown was set
// to, and (2) at half the bearings the silhouette is not the ridge that was
// fitted at all -- it is a ridge eight hundred metres behind it, standing over
// the near one's shoulder.
//
// Both are answered by fitting the OUTPUT instead of the input: a table of
// heights per direction, per ridge, solved by ./fit-cornice.mjs so that the
// skyline this file computes lands on the trace. The waves are still here and
// still move the radius, so nothing is a circle; what they no longer do is
// decide a height nobody checked.
//
// AND EACH RIDGE CARRIES AS MANY KNOTS AS ITS OWN READINGS ASK FOR, which is
// four hundred and eighty on the near flank -- three quarters of a degree, the
// grid the trace itself was read on -- and a hundred and twenty on the two
// ridges that were read once each. A uniform table would either miss the near
// flank's curvature or carry three hundred and sixty numbers nothing measured.
// Measured: at a knot every degree and a half the left flank cannot be met at
// all, because five readings spanning one point seven degrees of elevation fall
// inside ONE knot interval and a straight line between two numbers is the most
// the table can say there. The worst miss goes 0.84 degrees to under a tenth.
//
// It costs 960 numbers of source, which is seven kilobytes of law and nought
// bytes of delivered asset. It buys the one property the unit was ordered for
// -- «IDENTICO al target», at half a degree, in a guard.

/**
 * One ridge's height at one bearing, in metres over the plateau's own floor,
 * from its fitted table.
 *
 * Linear between knots and periodic over the compass: the table is dense
 * enough (five degrees) that a smoother interpolant would only invent
 * curvature between two numbers that were both measured.
 *
 * @param {number[]} profile  heights, one per knot, the first at bearing nought
 * @param {number} bearingDeg  degrees from north
 */
export function profileAt(profile, bearingDeg) {
  const n = profile.length;
  const step = 360 / n;
  const a = (((bearingDeg % 360) + 360) % 360) / step;
  const i = Math.floor(a);
  const t = a - i;
  const lo = profile[i % n];
  const hi = profile[(i + 1) % n];
  return lo + (hi - lo) * t;
}

/**
 * How far out one ridge's crown stands at one bearing, in metres.
 *
 * @param {object} ridge  one entry of spec.ridges
 * @param {number} bearing  radians from north
 * @param {object[]} waves
 */
export function reachAt(ridge, bearing, waves) {
  return ridge.radius * (1 + ridge.reach * swayAt(bearing, waves, ridge.seed + 0.7));
}

// ------------------------------------------------------------------ the cubes
//
// WHICH CUBE A PLACE IS BUILT OF, AND WHY THE FRONTIERS WAVE.
//
// The band the reference holds -- 0.22 to 0.45 degrees of apparent cube on
// every plane -- is a ratio of a little over two to one, so a cube may serve a
// ring whose outer radius is at most 2.046 times its inner one before it reads
// too small at the back or too coarse at the front. Doubling the cube at every
// doubling of the radius is the only ladder that fills that band exactly, and
// it happens to be the ladder the four crests already stand on: 1 m at 185,
// 2 at 400, 4 at 820, 8 at 1550. The rings below are that ladder with the
// frontiers put between the crests rather than on them.
//
// AND THE FRONTIERS WAVE, by four per cent of their radius, so that the change
// of cube is never a circle either. Four and not the prototype's six because a
// frontier pushed inward is a bigger cube seen closer: at six per cent the
// second ring's cube reads 0.46 degrees at its own edge, which is outside the
// band the guard holds.

/**
 * The edge of a ring at one bearing, in metres.
 *
 * @param {object} spec
 * @param {number} radius  the ring's nominal frontier
 * @param {number} bearing  radians
 */
export function frontierAt(spec, radius, bearing) {
  return radius * (1 + spec.rings.jitter * swayAt(bearing, spec.waves, spec.rings.jitterSeed));
}

/**
 * The cube a place is built of, in metres.
 *
 * @param {object} spec
 * @param {number} r  metres from the middle of the world
 * @param {number} bearing  radians
 */
export function cubeAt(spec, r, bearing = 0) {
  const { frontiers, cubes } = spec.rings;
  for (let k = 0; k < cubes.length; k++) {
    if (r < frontierAt(spec, frontiers[k + 1], bearing)) return cubes[k];
  }
  return cubes[cubes.length - 1];
}

/**
 * Which ring a place belongs to, or -1 past the last one.
 *
 * @param {object} spec
 * @param {number} r  metres
 * @param {number} bearing  radians
 */
export function ringOf(spec, r, bearing = 0) {
  const { frontiers, cubes } = spec.rings;
  if (r < frontierAt(spec, frontiers[0], bearing)) return -1;
  for (let k = 0; k < cubes.length; k++) {
    if (r < frontierAt(spec, frontiers[k + 1], bearing)) return k;
  }
  return -1;
}

// ------------------------------------------------------------------- the beds
//
// THE TERRACES ARE A LADDER OF IRREGULAR RUNGS, AND THE MACHINE IS V5's.
//
// The painted cornice already owned exactly the arithmetic these hills need and
// spent it on a tone painted across a flat quad: `bedCourses`, a weighted draw
// keyed on the bed's own index, which makes a stack of beds of one course, two
// courses, three, in a proportion nobody can read a period out of. R6's
// prototype threw it away and quantised each COLUMN to its own bed height
// instead, and the result is in R6-05 under its own name: bricks. Rows.
//
// The difference is which axis the irregularity lives on. A bed height drawn
// per column gives every column a different tread and the same skyline; a
// LADDER gives the whole ring the same terrace planes at unequal spacings,
// which is what a terraced hill is and what the target's risers measure --
// p10/p50/p90 of two, five and eleven pixels on a cube of five to seven, that
// is one cube mostly and two or three sometimes, never a uniform staircase.
//
// So the ladder is carried here, unchanged in shape, with the weights widened
// from V5's [2, 1] over one and two courses to three courses, which is R6's
// «letti 1-3 cubi». The weights are a dial and the fitter sweeps them.
//
// ONE LADDER PER RING AND ANCHORED AT THE WATER, not at each ridge's own datum.
// The rungs are what the eye counts across the whole distance at once, and two
// ladders that started at two data would cross somewhere and put a half-height
// step through a hillside. Anchored at the surface of the lake, every terrace
// in the world stands at the same level as its neighbour on either side of a
// ring frontier, and the feet all meet the water on one plane.

/**
 * The thickness of each bed of a ring, in cubes, from the bottom up.
 *
 * @param {object} spec
 * @param {number} ring
 * @param {number} rungs  how many beds to draw
 * @returns {number[]} thicknesses in cubes, each at least one
 */
export function bedCourses(spec, ring, rungs) {
  const { weights, seed } = spec.beds;
  const total = weights.reduce((a, b) => a + b, 0);
  const out = [];
  for (let k = 0; k < rungs; k++) {
    const u = hash1(k, ring * 7 + 13 + seed * 101) * total;
    let acc = 0;
    let courses = weights.length;
    for (let i = 0; i < weights.length; i++) {
      acc += weights[i];
      if (u < acc) { courses = i + 1; break; }
    }
    out.push(courses);
  }
  return out;
}

/**
 * The heights of a ring's terrace planes over the water, in metres, ascending.
 *
 * @param {object} spec
 * @param {number} ring
 * @param {number} top  metres of ladder to build
 */
export function bedLadder(spec, ring, top) {
  const cube = spec.rings.cubes[ring];
  const rungs = Math.max(2, Math.ceil(top / cube) + 2);
  const heights = [0];
  let h = 0;
  for (const courses of bedCourses(spec, ring, rungs)) {
    h += courses * cube;
    heights.push(h);
    if (h > top + cube) break;
  }
  return heights;
}

/**
 * The rung at or below a height, and its index.
 *
 * FLOOR AND NOT NEAREST, which V5's painted crest could afford and cubes
 * cannot: rounding up puts ground where the smooth law says there is none, and
 * the one thing the silhouette must not do is stand above what was fitted.
 *
 * @param {number[]} ladder
 * @param {number} above  metres over the ladder's datum
 */
export function bedIndex(ladder, above) {
  if (above <= 0) return 0;
  let lo = 0;
  let hi = ladder.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ladder[mid] <= above) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// --------------------------------------------------------------- the surface

/**
 * How much of the coarse grain a ridge carries at one bearing, in [quietShare, 1].
 *
 * WHERE THE PICTURE SPEAKS, THE SHAPE IS THE PICTURE'S AND NOT THE NOISE'S.
 *
 * This is a limit that was measured rather than a preference. The coarse grain
 * is forty-two per cent of the local height, which is what stops a hump being a
 * dome -- and on a ridge twenty-six metres tall at a hundred and eighty-five
 * metres, forty-two per cent is eleven metres, which is THREE AND A HALF
 * DEGREES of silhouette. A fit asked to land the skyline inside half a degree
 * cannot do it through noise seven times that size: run against the traced
 * flank, the solve stalls with the dip at -32 degrees a fifth of the way down
 * and the shoulder before it three quarters of a degree short, because what the
 * eye is actually seeing there is whichever rough peak happens to stand tallest
 * along the ray and not the crown the fit is moving.
 *
 * R6 said this in its own prototype and then did not carry it: «la vicina è
 * FITTATA per direzione ... e NON ONDEGGIA dove il target la mostra». So the
 * grain is turned down over the bearings a reading covers and comes back over
 * two degrees on either side. Nothing goes smooth: the profile itself carries a
 * knot every three quarters of a degree -- two and a half metres of arc at that
 * distance, finer than the cube -- and the fine grain and the bed ladder are
 * untouched. What stops is the one term that was drowning the fit.
 *
 * @param {object} spec
 * @param {number} ridge  which of spec.ridges owns the place
 * @param {number} bearingDeg
 */
export function quietAt(spec, ridge, bearingDeg) {
  const windows = spec.ridges[ridge] && spec.ridges[ridge].quiet;
  if (!windows || !windows.length) return 1;
  const bd = ((bearingDeg + 540) % 360) - 180;
  const taper = spec.noise.quietTaper;
  let quiet = 0;
  for (const w of windows) {
    const t = Math.min((bd - (w[0] - taper)) / taper, ((w[1] + taper) - bd) / taper);
    const eased = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
    if (eased > quiet) quiet = eased;
  }
  return 1 - quiet * (1 - spec.noise.quietShare);
}

/**
 * Everything the world's shape says about one place, before the cubes.
 *
 * The four ridges each contribute a hump of their own -- `exp(-2.2 t^2)` over
 * the distance from their crown -- and the tallest of the four wins the place.
 * A SUM would build a cone out of the four and close the gap the lake is seen
 * through; a maximum lets a near ridge stand in front of a far one with sky
 * between them, which is the thing the reference does on every bearing and the
 * old wall could not do at all.
 *
 * @param {object} spec
 * @param {number} x  metres, world
 * @param {number} z  metres, world
 */
export function hillAt(spec, x, z) {
  const dx = x - CENTRE.x;
  const dz = z - CENTRE.z;
  const r = Math.hypot(dx, dz);
  const bearing = Math.atan2(dx, -dz);
  const bearingDeg = bearing / DEG;
  let rise = 0;
  let local = 0;
  let ridge = -1;
  for (let k = 0; k < spec.ridges.length; k++) {
    const entry = spec.ridges[k];
    const crown = reachAt(entry, bearing, spec.waves);
    // NARROW IN FRONT AND WIDE BEHIND, WHICH IS WHERE THE LAKE COMES FROM.
    //
    // A hump of one width is a hill with the same slope on both sides, and with
    // the near crest at 185 m and a width of sixty it reaches the surface of
    // the water at a HUNDRED AND TWELVE metres -- two metres beyond the meadow's
    // own shore at 110.2. Measured, that is the lake: a strip of water two to
    // six metres wide all the way round, where the reference reads its far
    // shore at minus two point three degrees, which with the surface at -4.741
    // is a HUNDRED AND SIXTY. R6 §1 says so in as many words and its own
    // prototype did not carry it.
    //
    // And the same width is what closes the gap. The reference's water runs
    // from +0.59 to -3.6 degrees (R6 §2.5): the near shore at a hundred metres
    // and the far edge of it at the horizon -- so where the monoliths part, the
    // lake goes out of sight rather than stopping at a bank. It can only do
    // that if there is water BETWEEN the planes, and there can only be water
    // between them if each of them meets the surface before the next begins.
    //
    // So the front of a ridge is steep and its back is long, which is also what
    // a ridge standing in a lake looks like from the shore.
    const t = (r - crown) / (r < crown ? entry.widthIn : entry.width);
    const hump = Math.exp(-2.2 * t * t);
    const amp = profileAt(entry.profile, bearingDeg);
    const v = amp * hump;
    if (v > rise) { rise = v; local = amp; ridge = k; }
  }
  // THE COARSE GRAIN, which is what stops a hump being a dome, and the FINE
  // one, which is what stops a hillside being a plane. Both are continuous in
  // the radius: the prototype scaled the fine width by the ring's own cube,
  // which made the same point answer two different heights depending on which
  // ring's pass asked, and that is a seam waiting at every frontier. Here the
  // width follows the same D/190 the cube follows, smoothly, so a frontier is
  // a change of cube and never a change of ground.
  const coarse = spec.noise.coarse;
  const wide = coarse.metres + r * coarse.growth;
  const n1 = fbm(x / wide, z / wide, 3);
  const fine = spec.noise.fine;
  const narrow = fine.courses * Math.max(1, r / spec.cubePerMetre);
  const n2 = fbm(x / narrow + 100, z / narrow + 50, 2);
  const roughAmp = coarse.amplitude
    * (r < spec.noise.nearRadius ? coarse.nearShare : 1)
    * (ridge < 0 ? 1 : quietAt(spec, ridge, bearingDeg));
  // BOTH GRAINS RIDE THE LOCAL RISE, AND THE FINE ONE DID NOT.
  //
  // It was scaled by `local` -- the height of the ridge's CROWN at that bearing
  // -- so it kept its full amplitude out where the hump had died to nothing:
  // six per cent of a thirty-metre crown is a metre and eight either way, laid
  // flat across the lake bed. Measured, that is what was holding the ground out
  // of the water: the hills' shore came out at 120 to 126 metres on every
  // bearing, made of grain rather than of hill, where the reference reads it at
  // a hundred and sixty at the sides and at the horizon down the gap. Riding
  // the rise, the grain is on the hills and the water is water.
  const shaped = rise * (1 + roughAmp * 2 * n1 + fine.amplitude * 2 * n2);
  // THE FEET ARE IN THE WATER. `basinProfile` past 130 m is an extrapolation
  // nobody measured (it is declared as one in confine.js), so it is held at the
  // last radius the two arms of water actually fix -- and held rather than
  // continued because a cone run to two kilometres says -107 m, which would put
  // every hill in the world on a plinth of its own making.
  const base = basinProfile(Math.min(r, spec.basinHold));
  return {
    r, bearing, bearingDeg, ridge, local,
    base,
    y: base + Math.max(0, shaped),
  };
}

/**
 * The top face of the topmost cube at one place, in metres, or null where the
 * ground never comes up through the water.
 *
 * @param {object} spec
 * @param {number} x
 * @param {number} z
 * @param {object} ladders  one bed ladder per ring, from `ladders(spec)`
 */
export function groundTop(spec, x, z, ladders) {
  const h = hillAt(spec, x, z);
  const ring = ringOf(spec, h.r, h.bearing);
  if (ring < 0) return null;
  const water = waterLevel();
  // DROWNED GROUND IS NOT DRAWN, AND THE TEST IS ON THE GROUND AND NOT ON ITS
  // RUNG. The ladder is anchored at the surface, so `bedIndex` answers rung
  // nought for everything under it -- which seats every drowned cell EXACTLY at
  // the water and then draws it one cube proud. Measured, that is a metre of
  // cubes standing over the whole lake bed, and it put the hills' shore at 120
  // to 126 metres on every bearing where the reference reads it at a hundred
  // and sixty and, down the gap, at the horizon. What decides whether there is
  // a cube here is where the GROUND is.
  if (h.y <= water) return null;
  const cube = spec.rings.cubes[ring];
  const ladder = ladders[ring];
  return water + ladder[bedIndex(ladder, h.y - water)] + cube;
}

/**
 * The tallest a ridge is allowed to stand, in metres over the plateau.
 *
 * A CEILING AND NOT A TASTE, and it is here rather than in the fitter because
 * anything that writes a profile has to respect it. The reference's own highest
 * land is nine and a half degrees; a ridge that stood at fifteen from the
 * fitted eye would be outside every band this world is held in, and the only
 * thing that ever asks for one is a solver that has begun to oscillate. Written
 * as an angle from the fitted camera and turned into metres by each ridge's own
 * radius, so it means the same thing at 185 m and at 1550.
 */
export const CEILING_DEGREES = 15;

/** How tall one ridge may stand, in metres over the plateau. */
export function ridgeCeiling(spec, ridge) {
  const entry = spec.ridges[ridge];
  return Math.tan(CEILING_DEGREES * DEG) * entry.radius * (1 + entry.reach) + 4;
}

/** One bed ladder per ring, tall enough for the tallest ridge and no taller. */
export function ladders(spec) {
  let tallest = 0;
  for (let k = 0; k < spec.ridges.length; k++) {
    const ceiling = ridgeCeiling(spec, k);
    for (const v of spec.ridges[k].profile) {
      if (!Number.isFinite(v) || v < 0 || v > ceiling) {
        throw new Error(`cornice: ridge ${k} carries a height of ${v} m, outside [0, ${ceiling.toFixed(1)}]`);
      }
      if (v > tallest) tallest = v;
    }
  }
  const top = tallest * (1 + spec.noise.coarse.amplitude) - waterLevel() + 20;
  return spec.rings.cubes.map((_, ring) => bedLadder(spec, ring, top));
}

// ------------------------------------------------------------- the two classes
//
// ROCK ABOVE AND ON THE STEEP, GRASS ON THE LOW TREADS. R6 counted it in the
// target's own windows: of the near right hill, forty-nine per cent rock in
// shadow, twenty lit rock, fifteen grass -- and split top from bottom, a third
// lit rock and one per cent grass in the upper window against a quarter grass
// and eight per cent lit rock in the lower one. So rock is high and steep and
// grass is low, which is one line and one slope and not a texture.
//
// The quotas themselves are U-CORNICE-2's to hit. What is here is the geometry
// that decides which of two colours a face carries, and it is here rather than
// there because the mesher needs it to choose a face colour and the guard needs
// it to count one.

/**
 * Whether a place is rock (true) or grass (false).
 *
 * @param {object} spec
 * @param {number} x
 * @param {number} z
 */
export function grainAt(spec, x, z) {
  return fbm(x / spec.matter.grain + 300, z / spec.matter.grain + 300, 2);
}

/**
 * Whether a place is rock, given how steep it is and how high it stands.
 *
 * SPLIT IN TWO SO THE MESHER PAYS ONCE. The slope of a cell is already in the
 * height field the mesher just built -- asking the law for four more heights to
 * find it costs five evaluations of the whole ridge stack per cell, which on
 * seven hundred thousand cells is the difference between a second and eight.
 * The mesher hands in the slope it has; `isRock` below asks for it the honest
 * slow way, for a guard or a tool that has no field.
 *
 * @param {object} spec
 * @param {number} slope
 * @param {number} relative  how high the place stands as a share of its ridge
 * @param {number} grain
 */
export function isRockAt(spec, slope, relative, grain) {
  return slope > spec.matter.rockSlope
    || relative + spec.matter.grainShare * grain > spec.matter.rockLine;
}

export function isRock(spec, x, z) {
  const h = hillAt(spec, x, z);
  const step = Math.max(1, cubeAt(spec, h.r, h.bearing));
  const gx = (hillAt(spec, x + step, z).y - hillAt(spec, x - step, z).y) / (2 * step);
  const gz = (hillAt(spec, x, z + step).y - hillAt(spec, x, z - step).y) / (2 * step);
  return isRockAt(spec, Math.hypot(gx, gz), (h.y - h.base) / Math.max(1, h.local),
    grainAt(spec, x, z));
}

// ---------------------------------------------------------------- the skyline
//
// WHAT A GUARD ASKS THIS FILE, AND THE ONE THING IT MAY NOT ASK A PICTURE.
//
// The elevation of the highest ground along a bearing is arithmetic: march the
// ray, quantise every step the way the mesher will, keep the largest angle. It
// needs no browser, no render and no screenshot, so it can be run at every one
// of three hundred and sixty bearings from four eyes in under a second -- which
// is what makes «the horizon per direction» a gate and not a picture somebody
// looked at.

/**
 * The elevation of the skyline at one bearing, in degrees over the horizontal.
 *
 * @param {object} spec
 * @param {{x:number,y:number,z:number}} eye
 * @param {number} bearingDeg  degrees from north
 * @param {object} ladders
 * @param {number} step  metres between samples
 */
export function skylineAt(spec, eye, bearingDeg, lads, step = 2) {
  const ux = Math.sin(bearingDeg * DEG);
  const uz = -Math.cos(bearingDeg * DEG);
  const from = spec.rings.frontiers[0];
  const to = spec.rings.frontiers[spec.rings.frontiers.length - 1];
  let best = -90;
  let at = 0;
  for (let d = from; d <= to; d += step) {
    const top = groundTop(spec, eye.x + ux * d, eye.z + uz * d, lads);
    if (top === null) continue;
    const e = Math.atan2(top - eye.y, d) / DEG;
    if (e > best) { best = e; at = d; }
  }
  return { elevation: best, at };
}

/**
 * The elevation of ONE ridge's own edge at one bearing, in degrees -- the plane
 * behind or in front of the others, rather than the highest of them.
 *
 * THIS IS WHAT «TRE-QUATTRO PIANI SOVRAPPOSTI» IS MEASURED AS, and it is the
 * difference between a horizon and a wall. At -34 degrees the reference shows
 * the near hill's edge at 8.1 AND a farther crest at nine to ten above it; at
 * +31.6 it shows the near hill at 4.6 with a middle plane at 6.2 standing over
 * it. A skyline alone cannot be fitted to either reading, because on one
 * bearing the near plane is the skyline and on the next it is not. Asked per
 * ridge, both readings are one question with one answer.
 *
 * @param {object} spec
 * @param {{x:number,y:number,z:number}} eye
 * @param {number} bearingDeg
 * @param {number} ridge  which of spec.ridges
 * @param {object} lads
 * @param {number} step  metres between samples
 */
export function planeAt(spec, eye, bearingDeg, ridge, lads, step = 2) {
  const ux = Math.sin(bearingDeg * DEG);
  const uz = -Math.cos(bearingDeg * DEG);
  const from = spec.rings.frontiers[0];
  const to = spec.rings.frontiers[spec.rings.frontiers.length - 1];
  let best = -90;
  let at = 0;
  for (let d = from; d <= to; d += step) {
    const x = eye.x + ux * d;
    const z = eye.z + uz * d;
    if (hillAt(spec, x, z).ridge !== ridge) continue;
    const top = groundTop(spec, x, z, lads);
    if (top === null) continue;
    const e = Math.atan2(top - eye.y, d) / DEG;
    if (e > best) { best = e; at = d; }
  }
  return { elevation: best, at };
}

/**
 * The apparent size of the cube the skyline is built of at one bearing, in
 * degrees -- the number the reference reads as five to eight pixels on every
 * plane at once.
 *
 * @param {object} spec
 * @param {{x:number,y:number,z:number}} eye
 * @param {number} bearingDeg
 * @param {object} lads
 */
export function skylineCube(spec, eye, bearingDeg, lads) {
  const { at } = skylineAt(spec, eye, bearingDeg, lads);
  if (!at) return null;
  const ux = Math.sin(bearingDeg * DEG);
  const uz = -Math.cos(bearingDeg * DEG);
  const h = hillAt(spec, eye.x + ux * at, eye.z + uz * at);
  return { degrees: Math.atan2(cubeAt(spec, h.r, h.bearing), at) / DEG, at };
}

// ------------------------------------------------------------- the lamp seats
//
// THE CONTRACT V7 WAS PROMISED, ON REAL TREADS AT LAST.
//
// `ridgeLampSeats` is V5's name and V7's dependency: the places a lamp COULD
// stand along the distant ridges, offered by whoever builds the ridges and
// chosen by whoever owns the night. It is re-exported from
// src/world/contracts.js and it may not change its name or the shape of what it
// returns, so it does not: the same {x, y, z, size, kind} it always returned.
//
// What changes is that a seat is now the tread of a real terrace rather than a
// height on a painted quad -- «una panca, non un punto nell'aria», which is
// what the seat was reaching for when there was nothing out there to sit on.
// Below the rock line, on the near ridge, one candidate every few metres of
// arc. The census that fixed the ceiling stands: fifty-seven warm points on two
// flanks in the night target, every one of them under the green line.

/**
 * Where a lamp could stand on the near ridge: candidates, not lit.
 *
 * @param {object} spec
 * @param {object} lads
 * @returns {{x:number,y:number,z:number,size:number,kind:string}[]}
 */
export function ridgeLampSeats(spec, lads) {
  const ring = 0;
  const cube = spec.rings.cubes[ring];
  const entry = spec.ridges[0];
  const water = waterLevel();
  const seats = [];
  const every = spec.seats.everyDegrees;
  for (let deg = 0; deg < 360; deg += every) {
    const bearing = deg * DEG;
    const amp = profileAt(entry.profile, deg);
    if (amp <= 0) continue;
    const reach = reachAt(entry, bearing, spec.waves) - cube;
    const x = Math.sin(bearing) * reach;
    const z = CENTRE.z - Math.cos(bearing) * reach;
    const top = groundTop(spec, x, z, lads);
    if (top === null) continue;
    // Under the rock line, which is where every lamp the night target shows
    // stands, and on the tread that is actually there rather than a fraction of
    // the way up a slope.
    const ceiling = water + (top - water) * spec.matter.rockLine;
    const ladder = lads[ring];
    const drawn = water + (ceiling - water) * hash1(Math.round(deg), 23);
    const seated = water + ladder[bedIndex(ladder, drawn - water)] + cube;
    if (seated > ceiling || seated <= water) continue;
    seats.push({ x, y: seated, z, size: cube, kind: 'ledge' });
  }
  return seats;
}

// ------------------------------------------------------------------- the weld

/**
 * That this file and the contract agree about the fall, to the millimetre.
 *
 * Called before a single vertex is written, and it THROWS. The hills stand in
 * the basin and the water is a level in it: a disagreement here is not a wrong
 * colour, it is the lake and the shore at two different heights, and a warning
 * would be read after the picture.
 *
 * @param {object} spec
 */
export function checkSpec(spec) {
  const { frontiers, cubes } = spec.rings;
  if (frontiers.length !== cubes.length + 1) {
    throw new Error('cornice: one frontier more than cubes, always');
  }
  for (let k = 0; k < cubes.length; k++) {
    if (frontiers[k + 1] <= frontiers[k]) throw new Error('cornice: frontiers ascend');
  }
  for (const entry of spec.ridges) {
    if (entry.profile.length !== entry.knots) {
      throw new Error(`cornice: ridge at ${entry.radius} m has ${entry.profile.length} knots and declares ${entry.knots}`);
    }
    if (!(entry.widthIn > 0) || entry.widthIn > entry.width) {
      throw new Error(`cornice: ridge at ${entry.radius} m has an inner width of ${entry.widthIn}, which is not narrower than its back`);
    }
    if (!(entry.knots >= 8) || 360 % (360 / entry.knots) !== 0) {
      throw new Error(`cornice: ridge at ${entry.radius} m has ${entry.knots} knots, which do not close the compass`);
    }
  }
  if (waterLevel() >= 0) throw new Error('cornice: the water is below the plateau');
  return true;
}
