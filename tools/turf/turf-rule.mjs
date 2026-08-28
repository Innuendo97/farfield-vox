import {
  AREA_CENTER, MONOLITHS, PLATFORM, STAIRS,
} from '../../src/world/layout.js';
import {
  APPROACH, GRID, gridToOffset, offsetToGrid, pathCentreX, pathEdge, pathRun,
  smoothstep, VERGE_OFFSET,
} from '../../src/world/terrain-field.js';

// THE RULE OF THE TURF: how, when and where the ground rises into a hummock and
// the grass stands long.
//
// This is the single seat of that rule. It is read by tools/turf/build-turf.mjs
// and by nothing else: everything downstream reads the FIELD the build writes,
// never this file, so S2's shading, S3's micro relief and S4's grass cannot end
// up with three different opinions about where a hummock is. That was the
// committente's condition when he named the cause.
//
// TWO FIELDS, NOT ONE, and the reason is a measurement. The analysis
// (s2-regola-erba/RAPPORTO.md 2.4.2) found the longest blades in the frame at
// the edge of the path, where the ground does not rise at all, and the tallest
// ground in the two corners, where the blades are ordinary. Rise and length do
// not travel together, so they are not one scalar with two transfer functions:
// R is the ground, G is the canopy, and they are computed apart. The single
// generator is what keeps them honest, not a single number.
//
// WHERE THE PHOTOGRAPH SPOKE, THE FIELD IS THE PHOTOGRAPH. Inside the measured
// band the two channels are the measured tables, interpolated, not the law. The
// law only has to carry the same statistics out of the frame, where nothing was
// ever seen, and it is deliberately the least storytelling of the three
// candidates: the committente chose C, "hummocks scattered on uneven ground".

// ------------------------------------------------------------------ the field

export const FIELD = {
  centreX: AREA_CENTER.x,
  centreZ: AREA_CENTER.z,
  size: 72,
  texels: 288,
  metresPerTexel: 72 / 288,
  // Beyond this the world settles onto the far plane (terrain-field.js), so the
  // turf has to be gone before it, or a hummock would ride the ramp.
  rimFrom: 20,
  rimTo: 28,
};

export const TRANSFER = {
  RISE_MAX: 0.60,
  LEN_BARE: 0.19,
  LEN_FULL: 0.36,
  DEN_BARE: 0.85,
  DEN_FULL: 1.30,
  CARD_HEIGHT_TODAY: 0.21,
  // How much of the dome a full canopy keeps off the soil under it.
  //
  // Cycles cannot answer this: the grass in this world is painted albedo with
  // cards standing on it, not geometry, so the bake hands back soil that sees
  // the whole sky wherever the blades are longest. The reference plainly does
  // not. So the sky term is multiplied by (1 - k * G) when the light map is
  // packed (tools/lighting/pack-light.mjs), and k is fitted against the
  // reference at the edges of the path, which is the one place in the frame
  // where the canopy changes and the distance, the air and the material do not.
  //
  // Seated here rather than in the packer because it is a property of the
  // canopy, and S4 will want the same number when it sows the blades.
  //
  // MEASURED, tools/terrain/fit-canopy.mjs, 33 391 samples of open grass from 5
  // to 20 m with the belt the reference contradicts left out: the coefficient on
  // G is -1.057 +- 0.037, which is k = 0.625, and all four distance bins agree on
  // the sign (they read 0.59, 0.89, 0.84, 0.38 on their own). It is a fitted
  // number with a wide bin spread, so it is a parameter and not a constant of
  // nature: raise it for a meadow that swallows more light between its blades,
  // lower it for a thinner one.
  SKY_OCCLUSION_K: 0.625,
};

export const GATES = {
  turfFromPath: 0.35,
  riseFromPath: 1.10,
  turfFromBuilt: 0.30,
  riseFromBuilt: 1.20,
  skirt: { value: 0.78, from: 0.90, to: 1.90 },
};

export const GRAIN = {
  step: 6.4,
  jitter: 0.42,
  radiusMin: 1.15,
  radiusMax: 2.05,
  strengthMin: 0.34,
  strengthMax: 1.00,
  // The tallest hummock the law is allowed to raise where nobody has ever
  // looked. RISE_MAX is 0.60 because the ceiling of the channel should not sit
  // exactly on the measurement, but the tallest hummock the photograph actually
  // shows is 0.54, and "the same statistics outside" is taken literally: out of
  // frame nothing out-tops what is in it. RAPPORTO 6.2 leaves this open to the
  // committente -- raise it for a more dramatic meadow, lower it to calm one --
  // so it is a parameter with the measurement's own value in it, not a constant.
  peak: 0.54,
};

export const TIDE = { scale: 0.055, base: 0.42, amplitude: 0.95 };

export const SEED = 20260819;

// The south flank of a hummock is the only part of it the reference actually
// measures the brightness of, and it is what makes the corner shadow the
// committente asked for. RAPPORTO 2.3 requires it between 25 and 32 degrees;
// the centre of that is 30, and the linear radiance of the two measured flanks
// (0.137 and 0.141 of their own crowns, s2-dev3/probe/contrasto.mjs) asks for
// about the same. So the depth of a hummock in z is not chosen: it is whatever
// puts its south flank at 30 degrees.
//
// A quartic cap h = H(1 - d^2)^2 has greatest slope 1.54 H / R, so R = 1.54 H /
// tan(30). A floor keeps a nearly flat column from becoming a razor.
const FLANK_DEGREES = 30;
const FLANK_K = 1.54 / Math.tan(FLANK_DEGREES * Math.PI / 180);
const DEPTH_FLOOR = 0.90;

// ------------------------------------------------------------- the measurement

// Read off target.png by s2-regola-erba (RAPPORTO 2.1 and 2.2) and carried here
// rather than referenced, because that scratch is not tracked and a delivery may
// not depend on a file nobody else has. They are the measurement itself, so they
// are also written into turf.json: the field can be regenerated identically, and
// argued with, without opening the PNG.
//
// The crest a photograph shows is the top of whatever stands there, ground plus
// what grows on it. These are the two halves separated: the blades were followed
// from tip to root on enlarged crops, and the ground is what the crest has left
// over once they are taken off it.
export const BAND = { z: 4.6, halfDepth: 1.7 };

/** Metres of ground above the meadow, by easting, along the crest line. */
export const MEASURED_RISE = [
  [-6.60, 0.00], [-5.92, 0.43], [-5.58, 0.33], [-5.25, 0.21], [-4.91, 0.07],
  [-4.57, 0.00], [-4.08, 0.00], [-3.67, 0.00], [-3.18, 0.00], [-2.60, 0.02],
  [-1.94, 0.03], [1.19, 0.04], [1.85, 0.11], [2.51, 0.10], [3.17, 0.06],
  [3.76, 0.49], [4.26, 0.52], [4.67, 0.54], [5.17, 0.52], [5.66, 0.41],
  [6.31, 0.34], [7.10, 0.00],
];

/** Metres of blade, by easting, read on enlarged crops. */
export const MEASURED_BLADE = [
  [-8.0, 0.30], [-3.0, 0.34], [-1.9, 0.34], [1.2, 0.28], [2.4, 0.29],
  [5.3, 0.29], [8.0, 0.29],
];

/**
 * Read of a measured table of [x, value], flat outside its ends.
 *
 * Monotone cubic (Fritsch-Carlson), not linear. Linear between columns half a
 * metre apart puts a crease at every reading, and a crease in a height field is
 * a straight line of shadow across a meadow -- visible, and an artefact of the
 * sampling rather than of the ground. Monotone rather than plain cubic because a
 * spline through a reading that goes 0.06, 0.49, 0.52 will overshoot and invent
 * a dip in front of the hummock that nobody measured.
 */
function tangents(table) {
  const n = table.length;
  const secant = [];
  for (let i = 0; i < n - 1; i++) {
    secant.push((table[i + 1][1] - table[i][1]) / (table[i + 1][0] - table[i][0]));
  }
  const m = new Array(n);
  m[0] = secant[0];
  m[n - 1] = secant[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = secant[i - 1] * secant[i] <= 0 ? 0 : (secant[i - 1] + secant[i]) / 2;
  }
  // Fritsch-Carlson: pull the tangents in until no segment can overshoot.
  for (let i = 0; i < n - 1; i++) {
    if (secant[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / secant[i];
    const b = m[i + 1] / secant[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * secant[i];
      m[i + 1] = t * b * secant[i];
    }
  }
  return m;
}

// The steepest the ground is allowed to be anywhere, in any direction. The
// reference constrains only the SOUTH flank of a hummock, because that is the
// only face whose brightness it shows, and asks 25 to 32 degrees for it. But the
// crest reading, taken at columns half a metre apart, steps from 0.06 to 0.49 m
// across a single gap at the west toe of the right hand hummock, and a curve
// through that reads 46 degrees: a grass scarp, which the photograph has nowhere.
//
// So the profile is slope limited in x at the same 32 degrees. It is done by
// WIDENING the toe rather than by lowering the crown, so every measured height
// survives untouched; the cost is that the foot of a hummock moves out by up to
// ten centimetres, which is well inside the half metre the columns were read at.
export const MAX_SLOPE = Math.tan(32 * Math.PI / 180);
const LIMIT_STEP = 0.02;

/**
 * Cone dilation: R'(x) = max over the profile of R(xi) - slope * |x - xi|.
 *
 * Two running passes. It can only raise a value, never lower one, so a peak is
 * a fixed point of it and the measurement is preserved where it was taken.
 */
function slopeLimited(table) {
  const x0 = table[0][0] - 2;
  const x1 = table[table.length - 1][0] + 2;
  const n = Math.ceil((x1 - x0) / LIMIT_STEP) + 1;
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) values[i] = rawTable(table, x0 + i * LIMIT_STEP);
  const drop = MAX_SLOPE * LIMIT_STEP;
  for (let i = 1; i < n; i++) values[i] = Math.max(values[i], values[i - 1] - drop);
  for (let i = n - 2; i >= 0; i--) values[i] = Math.max(values[i], values[i + 1] - drop);
  return { x0, x1, values };
}

const LIMITED = new WeakMap();
function readLimited(table, x) {
  if (!LIMITED.has(table)) LIMITED.set(table, slopeLimited(table));
  const { x0, x1, values } = LIMITED.get(table);
  if (x <= x0 || x >= x1) return 0;
  const f = (x - x0) / LIMIT_STEP;
  const i = Math.floor(f);
  const t = f - i;
  return values[i] * (1 - t) + values[Math.min(values.length - 1, i + 1)] * t;
}

const TANGENTS = new WeakMap();
function rawTable(table, x) {
  if (x <= table[0][0]) return table[0][1];
  if (x >= table[table.length - 1][0]) return table[table.length - 1][1];
  if (!TANGENTS.has(table)) TANGENTS.set(table, tangents(table));
  const m = TANGENTS.get(table);
  for (let i = 1; i < table.length; i++) {
    const [x1, v1] = table[i];
    if (x <= x1) {
      const [x0, v0] = table[i - 1];
      const h = x1 - x0;
      const t = (x - x0) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * m[i - 1]
        + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * m[i];
    }
  }
  return 0;
}

// How far the two readings reach either side. They are not the same number: the
// crest was read out to 7.1 m, the blades out to 8.0, and pretending otherwise
// would either throw away a measurement or invent one.
const MEASURED_X = 6.6;
const MEASURED_X_BLADE = 8.0;
/** How far past the last measured column the measurement fades into the law. */
const MEASURED_FADE = 1.6;

/** How much of this point is the photograph's own word, 1 inside the band. */
export function measuredWeight(x, z, span = MEASURED_X) {
  const across = 1 - smoothstep(span, span + MEASURED_FADE, Math.abs(x));
  // In z the measurement is a crest line, and it is carried by the flank depth
  // rather than by the band's half depth: the band is how far the reading was
  // trusted, the flank is how far the ground actually falls away.
  const rise = readLimited(MEASURED_RISE, x);
  const depth = Math.max(DEPTH_FLOOR, FLANK_K * rise);
  const u = Math.abs(z - BAND.z) / (depth + MEASURED_FADE);
  return across * (1 - smoothstep(0.7, 1.0, u));
}

/** Rise in metres the photograph measured at this point. */
export function measuredRise(x, z) {
  const rise = readLimited(MEASURED_RISE, x);
  if (rise <= 0) return 0;
  const depth = Math.max(DEPTH_FLOOR, FLANK_K * rise);
  const u = Math.abs(z - BAND.z) / depth;
  if (u >= 1) return 0;
  const t = 1 - u * u;
  return rise * t * t;
}

/** Canopy T the photograph measured at this point, as the 0..1 the field holds. */
export function measuredTurf(x) {
  const metres = rawTable(MEASURED_BLADE, x);
  return (metres - TRANSFER.LEN_BARE) / (TRANSFER.LEN_FULL - TRANSFER.LEN_BARE);
}

// ------------------------------------------------------------------ the gates

// The footprint of every built thing, as the ORIENTED RECTANGLE it actually is.
// A circle round the diagonal was the obvious thing and it is wrong twice over:
// it holds the grass off a block by the better part of two metres on the narrow
// side, where the reference shows the turf biting the stone, and it does it in a
// circle, which is a shape nothing here has.
const BUILT = [
  ...MONOLITHS.map((m) => ({
    x: m.position.x, z: m.position.z, hw: m.size[0] / 2, hd: m.size[2] / 2,
    angle: -m.rotationY * Math.PI / 180,
  })),
  {
    x: PLATFORM.x, z: PLATFORM.z, hw: PLATFORM.width / 2, hd: PLATFORM.depth / 2,
    angle: -PLATFORM.rotationY * Math.PI / 180,
  },
  {
    x: STAIRS.x, z: STAIRS.z, hw: STAIRS.width / 2, hd: STAIRS.steps * STAIRS.tread / 2,
    angle: 0,
  },
].map((b) => ({ ...b, cos: Math.cos(b.angle), sin: Math.sin(b.angle) }));

/** Distance from a point to an oriented rectangle; 0 on it, negative inside. */
function distanceToBox(b, x, z) {
  const dx = x - b.x;
  const dz = z - b.z;
  const lx = Math.abs(dx * b.cos + dz * b.sin) - b.hw;
  const lz = Math.abs(-dx * b.sin + dz * b.cos) - b.hd;
  if (lx <= 0 && lz <= 0) return Math.max(lx, lz);
  return Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
}

/** Distance outside the path's stone, in metres; negative on the stone. */
export function distanceFromPath(x, z) {
  const run = pathRun(z);
  if (run <= 0.02) return 99;
  const s = x - pathCentreX(z);
  return (Math.abs(s) - pathEdge(z, s)) / Math.max(0.2, run);
}

/** Distance outside the nearest built thing, in metres. */
export function distanceFromBuilt(x, z) {
  let best = 99;
  for (const b of BUILT) best = Math.min(best, distanceToBox(b, x, z));
  return best;
}

/**
 * Distance from the axis the path's verges are measured about, in metres.
 *
 * The path's centreline, shifted by VERGE_OFFSET — see the note over that
 * constant in src/world/terrain-field.js for why it sits a third of a metre off
 * centre and why that third of a metre is not moving. This used to be called
 * `distanceFromWater` and to be described as the thread of water down the path.
 * There is no water: the committente ruled on 2026-08-20 that the pale stretch
 * is light on stone. The line, the offset and every number downstream of it are
 * unchanged — only the name and the reason are.
 */
export function distanceFromVerge(x, z) {
  const run = pathRun(z);
  if (run <= 0.02) return 99;
  return Math.abs(x - pathCentreX(z) - VERGE_OFFSET);
}

/** How much a hummock is allowed here: nothing on the path, nothing on a base. */
export function riseGate(x, z) {
  const path = smoothstep(0, GATES.riseFromPath, distanceFromPath(x, z));
  const built = smoothstep(0, GATES.riseFromBuilt, distanceFromBuilt(x, z));
  const radius = Math.hypot(x - FIELD.centreX, z - FIELD.centreZ);
  // And the ground the stair run stands on. terrain-field.js levels a nine metre
  // apron there so all six steps stay legible, and a gate that only kept clear
  // of the stair's own footprint let a 0.27 m hummock stand in the middle of it:
  // the levelling would have flattened the meadow and the field raised it again.
  // The two must not disagree about the same ground, so the field gives way.
  const approach = smoothstep(APPROACH.inner, APPROACH.outer,
    Math.hypot(x - APPROACH.x, z - APPROACH.z));
  return path * built * approach * (1 - smoothstep(FIELD.rimFrom, FIELD.rimTo, radius));
}

/** How much canopy is allowed here. Grass bites every base, so its gate is tight. */
export function turfGate(x, z) {
  const path = smoothstep(0, GATES.turfFromPath, distanceFromPath(x, z));
  const built = smoothstep(0, GATES.turfFromBuilt, distanceFromBuilt(x, z));
  const radius = Math.hypot(x - FIELD.centreX, z - FIELD.centreZ);
  return path * built * (1 - smoothstep(FIELD.rimFrom, FIELD.rimTo, radius));
}

// ------------------------------------------------------------------- the grain

function hash2(ix, iz, salt) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(salt, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

function noise2(x, z, salt) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash2(ix, iz, salt);
  const b = hash2(ix + 1, iz, salt);
  const c = hash2(ix, iz + 1, salt);
  const d = hash2(ix + 1, iz + 1, salt);
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

/**
 * The step of the ground mesh at this distance from its centre, in metres.
 *
 * Read off the real grid rather than from a formula, because the formula is the
 * thing that would drift. A hummock narrower than a couple of cells does not
 * read as a swell: it reads as a triangular tent, which is what RAPPORTO 4.4
 * warns about at the rim.
 */
export function meshStep(radius) {
  const t = offsetToGrid(Math.min(radius, GRID.half * 0.99));
  const d = 2 / (GRID.samples - 1);
  return Math.abs(gridToOffset(Math.min(1, t + d)) - gridToOffset(t));
}

/** The smallest hummock the mesh can carry here without faceting it. */
export function radiusFloor(radius) {
  return 2.2 * meshStep(radius);
}

/**
 * Every hummock whose reach covers this point.
 *
 * A jittered lattice, so the spacing is the measured one -- two inside the
 * twelve metres the frame covers, that is one every six or seven -- without the
 * lattice ever being legible as a lattice.
 */
export function lawRise(x, z) {
  const { step, jitter } = GRAIN;
  const gx = Math.floor((x - FIELD.centreX) / step);
  const gz = Math.floor((z - FIELD.centreZ) / step);
  let top = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = gx + i;
      const cz = gz + j;
      const ox = (hash2(cx, cz, SEED) - 0.5) * 2 * jitter * step;
      const oz = (hash2(cx, cz, SEED + 1) - 0.5) * 2 * jitter * step;
      const sx = FIELD.centreX + (cx + 0.5) * step + ox;
      const sz = FIELD.centreZ + (cz + 0.5) * step + oz;

      const radius = Math.hypot(sx - FIELD.centreX, sz - FIELD.centreZ);
      // The tide: one long swell that gathers the hummocks here and thins them
      // there, so they are scattered rather than tiled. Candidate C, and the
      // whole of it.
      const tide = TIDE.base + TIDE.amplitude
        * (noise2(sx * TIDE.scale + 31.7, sz * TIDE.scale + 9.3, SEED + 2) - 0.5);
      if (tide <= 0) continue;

      const roll = hash2(cx, cz, SEED + 3);
      const strength = GRAIN.strengthMin + (GRAIN.strengthMax - GRAIN.strengthMin)
        * hash2(cx, cz, SEED + 4);
      if (roll > tide) continue;

      // Wide enough for the mesh under it, never narrower than measured, and
      // never steeper than the ground is allowed to be: a quartic cap of height
      // H has greatest slope 1.54 H / R, so a tall hummock on the smallest
      // permitted radius would be a 36 degree scarp.
      const wanted = GRAIN.radiusMin + (GRAIN.radiusMax - GRAIN.radiusMin)
        * hash2(cx, cz, SEED + 5);
      const height = GRAIN.peak * strength;
      const r = Math.max(wanted, radiusFloor(radius), 1.54 * height / MAX_SLOPE);
      const d = Math.hypot(x - sx, z - sz) / r;
      if (d >= 1) continue;
      const t = 1 - d * d;
      top = Math.max(top, height * t * t);
    }
  }
  return top;
}

/**
 * Canopy where the photograph never looked.
 *
 * Long at the lip of the path and broadly along its verges, ordinary across the
 * open meadow, with a broad mottle so it is never one value. The lip is where
 * the measurement puts the longest blades in the whole frame; the broad band
 * under it is that same measurement carried out into the meadow, and both are
 * read off the reference rather than argued for.
 */
export function lawTurf(x, z) {
  const open = 0.38 + 0.34 * (noise2(x * 0.075 + 5.1, z * 0.075 + 17.9, SEED + 6) - 0.5)
    + 0.14 * (noise2(x * 0.31 + 2.3, z * 0.31 + 4.4, SEED + 7) - 0.5);

  // The lip: full length against the last slab, easing out over a couple of
  // metres into the open meadow.
  const lip = 0.50 * (1 - smoothstep(0.2, 2.4, Math.max(0, distanceFromPath(x, z))));
  // And the verges under it, which is the lip's own falloff carried further: a
  // broad band about the path's axis, several times wider than the stone, so the
  // long grass at the edge does not stop dead where the slabs stop.
  const bank = 0.22 * (1 - smoothstep(1.2, 6.5, distanceFromVerge(x, z)));

  return Math.max(0, Math.min(1, open + lip + bank));
}

/**
 * The floor the skirts of src/world/vegetation.js already stand on.
 *
 * Taken rather than argued with: the grass around every base is already at full
 * length there, so the field says so instead of contradicting it.
 */
export function skirtFloor(x, z) {
  let best = 0;
  for (const b of BUILT) {
    const d = distanceToBox(b, x, z);
    if (d < 0 || d > GATES.skirt.to + 0.6) continue;
    // Eased at both ends. A floor with square shoulders stamps a ring of long
    // grass round every base, and a ring is a shape the reference does not have.
    const rise = smoothstep(GATES.skirt.from - 0.5, GATES.skirt.from, d);
    const fall = 1 - smoothstep(GATES.skirt.to, GATES.skirt.to + 0.6, d);
    best = Math.max(best, GATES.skirt.value * rise * fall);
  }
  return best;
}

// ------------------------------------------------------------------ the field

/** Rise in metres at a world point: the measurement where there is one. */
export function riseAt(x, z) {
  const w = measuredWeight(x, z);
  const metres = w * measuredRise(x, z) + (1 - w) * lawRise(x, z);
  return Math.min(TRANSFER.RISE_MAX, metres * riseGate(x, z));
}

/** Canopy T at a world point, 0..1. */
export function turfAt(x, z) {
  const w = measuredWeight(x, z, MEASURED_X_BLADE);
  const t = w * measuredTurf(x) + (1 - w) * lawTurf(x, z);
  return Math.min(1, Math.max(skirtFloor(x, z) * turfGate(x, z), t * turfGate(x, z)));
}
