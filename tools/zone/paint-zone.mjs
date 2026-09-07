import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../grade/lib/framing.mjs';
import { writeCleanPng } from '../grade/lib/png.mjs';
import { MONOLITHS } from '../../src/world/layout.js';
import { treeSeats } from '../../src/world/trees.js';
import { ROCK_PILES } from '../../src/world/rock-piles.js';
import { smoothstep } from '../../src/world/terrain-field.js';
import { ZONE } from '../../src/world/voxel/campo.js';
import {
  GROUND_BOUNCE, LIGHT_SCALE, MEADOW_ALBEDO, encodedLum, faceColour, readLight, renderChain,
} from '../lighting/render-chain.mjs';

// Paints the ONE map the light of this meadow varies by place through.
//
//   node tools/zone/paint-zone.mjs
//   node tools/zone/paint-zone.mjs --side=160 --cell=0.5
//
// WHAT IT IS. A single-channel picture of the ground plane, half a metre to a
// texel, whose value is the factor the field multiplies a fragment's LIGHT by:
// one where the meadow stands open, and down to ZONE.floor where it does not.
// The fragment reads it once and multiplies once; there is no second opinion
// about it anywhere in the world, which is why the mat and the flowers read
// this same picture rather than carrying a term of their own.
//
// WHY A PICTURE AND NOT ARITHMETIC, which is the question every other field of
// this ground answers the other way. The reference varies by ZONES of three to
// eight metres with a factor of 0.31 at the low decile against our 0.56 (R1
// §1.6), and its semivariance is still RISING between two metres and four
// (0.059 to 0.073) where ours has stopped by two (0.027 to 0.025). A structure
// that big is not a function of a cell and cannot be hashed out of one: it is
// where the light of that afternoon happened to fall, and the only honest way
// to carry a fact of that kind is to write it down.
//
// AND IT IS TWO THINGS MULTIPLIED, WHICH IS THE WHOLE DESIGN.
//
//   THE LAW      what the world's own seats owe the ground under them: an
//                isotropic disc of contact shade at the foot of every block,
//                every tree and every pile of stones, each pair FITTED on the
//                reference's own profile by distance from that family's
//                footprints. It is arithmetic over the seats the world already
//                publishes, so it follows them wherever they move and it is
//                right in the whole disc -- including behind the walker, where
//                no picture of the reference has ever looked.
//
//   THE RESIDUAL what the law does not explain, which is the reference's own
//                slow field: the dark left foreground, the band in front of
//                blocks 01 and 02, the pale middle distance to the right. It
//                is a MEASUREMENT (assets-src/zone/residuo.json, a knot every
//                metre and a half, taken with the instrument of R1 §1.6) and
//                not a choice, and it is ONE everywhere the reference could
//                not see.
//
// WHY THE FOOT IS ISOTROPIC AND IS NOT A CAST SHADOW. Measured at the fitted
// pose the reference is dark for three to five metres round the foot of a block
// and EQUALLY dark on all three sides of it (R1 §1.7: west 35, front 39, east
// 30 at block 01). The seal's sun stands at azimuth 280 and 47 degrees up, so a
// cast shadow of that block would lie to the east, five metres long, and there
// would be none at all to the west. The reference does not show that, B-6 says
// the same of the whole frame, and E-SINTESI-DIVARIO D5/D6 settled it: what is
// drawn here is contact and zone, not the sun's own geometry.

const OUT_DIR = join(REPO_ROOT, 'assets-src', 'materia');
const RESIDUAL_PATH = join(REPO_ROOT, 'assets-src', 'zone', 'residuo.json');

const flag = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : dflt;
};

/**
 * THE DARKEST THE MAP MAY DRAW, as a share of open meadow READ IN THE FRAME.
 *
 * 0.25, AND IT IS A FLOOR UNDER A FIT AND NOT THE FIT. R1 §1.6 reads the
 * reference's own low decile of zone at 0.31 and single cells of it reach 0.24;
 * this stands just under the lowest of those, so a fit is never clipped where
 * the reference actually goes and a defect that drove the map to nought could
 * not black the meadow out.
 */
export const LUMA_FLOOR = 0.25;

// ---------------------------------------------------------------- THE LAW
//
// One shape for every seat, and the shape is the one the reference's own
// profile has: FULL at contact, gone by the reach, with the fall smooth at both
// ends so that no ring of it can read as an outline. `smoothstep` is the
// world's own (terrain-field.js), so this curve is the curve every other
// gradient in this hub is drawn with.
const fall = (d, reach) => 1 - smoothstep(0, reach, d);

/**
 * The seats, each with what it owes the ground and how far.
 *
 * EVERY NUMBER HERE IS FITTED AND NONE IS CHOSEN. The procedure is written in
 * the verbale of U-ZONE-1 §3: the reference's plane map is divided by its own
 * slow trend at eight metres, which leaves the CONTACT and removes the zone,
 * and the pair of each family is the least squares of that local field against
 * the distance from the family's own footprints.
 */
export const SEATS = {
  /**
   * THE BLOCKS. Read on the plane the reference stands at 0.87 of its own far
   * meadow at half a metre from a footprint, 0.75 at a metre, 0.65 at two, 0.66
   * at two and a half, and it is back at 1.03 by seven: a well three to five
   * metres wide, which is R1 §1.7's own width read the other way round.
   *
   * AND THE STRENGTH IS CAPPED BY THE DEEPEST BAND THE REFERENCE SHOWS, which
   * is why it is 0.32 and not the 0.45 a free least squares would take. The
   * difference between a short reach with a big strength and the right reach
   * lies at distance NOUGHT, where the plane carries no cell at all: a fit left
   * free there is extrapolating under its own data.
   */
  block: { strength: 0.32, reach: 5.4 },
  /**
   * THE TREES, and R7 asked for exactly this: the meadow under T1 at 0.53 of
   * the meadow beside it and under T3 at 0.62. Fitted here off treeSeats() --
   * the one seat that decides where they stand -- the band at a metre reads
   * 0.52 and the disc has closed by two and a half.
   */
  tree: { strength: 0.47, reach: 2.6 },
  /** The piles of stones: the same disc, scaled by how tall a pile stands. */
  rock: { strength: 0.47, reach: 2.6 },
};

// THE FLANK OF THE CORRIDOR IS NOT IN THIS LAW, AND THAT IS A MEASUREMENT.
//
// R3 read the earth of the near verge at L* 17 against our 29 and the obvious
// reading of it was a zone of shade beside the stone. Read on the plane the
// reference says the opposite: the meadow beside the paving stands at 1.23 of
// its own far meadow at half a metre out and 1.20 at a metre, and only falls
// below one past two metres, where it is the zone of the left foreground and
// not the corridor. What R3 measured dark is the corridor's own EARTH, which is
// V3's material and not this meadow's light, and darkening the grass beside the
// kerb to explain it would be putting a defect of one material into another.
// So the term was fitted, came back at the floor of its own range, and fell.

/** Distance from a point to the rectangle a block stands on, in metres. */
export function blockDistance(x, z, block) {
  const a = block.rotationY * Math.PI / 180;
  const [w, , d] = block.size;
  const dx = x - block.position.x;
  const dz = z - block.position.z;
  const lx = Math.abs(dx * Math.cos(a) - dz * Math.sin(a)) - w / 2;
  const lz = Math.abs(dx * Math.sin(a) + dz * Math.cos(a)) - d / 2;
  return Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
}

/**
 * THE LAW AT A POINT: what the seats of this world owe the ground under them.
 *
 * MULTIPLIED AND NOT ADDED, because two seats standing together take the light
 * twice and a sum of two halves would take it once and a half. It is also what
 * keeps the term bounded without a clamp: a product of factors under one is
 * under one.
 */
/**
 * WHAT ONE BLOCK OWES THE GROUND AT A POINT, on its own.
 *
 * Published rather than folded into the product below, because it is the one
 * shape a guard has to be able to read back: the depth at contact and the reach
 * are what R1 §1.7 measured, and read off the whole law they come back mixed
 * with whatever tree or boulder happens to stand on the same bearing.
 */
export function blockTerm(x, z, block) {
  return 1 - SEATS.block.strength * fall(blockDistance(x, z, block), SEATS.block.reach);
}

export function lawAt(x, z) {
  let f = 1;
  for (const block of MONOLITHS) f *= blockTerm(x, z, block);
  for (const tree of treeSeats()) {
    const d = Math.max(0, Math.hypot(x - tree.x, z - tree.z) - tree.radius);
    f *= 1 - SEATS.tree.strength * fall(d, SEATS.tree.reach);
  }
  for (const rock of ROCK_PILES) {
    const d = Math.max(0, Math.hypot(x - rock.x, z - rock.z) - rock.radius);
    // A pile a hand tall owes a hand of shade: the strength rides its own
    // height so a boulder and a pebble are not one seat.
    const share = Math.min(1, rock.height / 0.5);
    f *= 1 - SEATS.rock.strength * share * fall(d, SEATS.rock.reach);
  }
  return f;
}

// ------------------------------------------------------------ THE RESIDUAL
//
// A knot every two metres over the ground the reference could see, read
// bilinearly, and ONE outside it. Two metres is the finest a zone has any
// structure at (R1 §1.6: the semivariance at one metre is 0.044 and it is still
// climbing at four), so a knot finer than this would be recording the
// reference's own pixel noise as if it were weather.

/** @returns {{cell:number, x0:number, z0:number, nx:number, nz:number, k:number[]}} */
export function readResidual() {
  const raw = JSON.parse(readFileSync(RESIDUAL_PATH, 'utf8'));
  if (!(raw.cell > 0) || !Array.isArray(raw.knots)) {
    throw new Error('assets-src/zone/residuo.json is not a residual');
  }
  if (raw.knots.length !== raw.nx * raw.nz) {
    throw new Error(`residuo.json says ${raw.nx}x${raw.nz} and carries ${raw.knots.length} knots`);
  }
  return raw;
}

/** The residual at a point, one outside the ground the reference could see. */
export function residualAt(res, x, z) {
  const u = (x - res.x0) / res.cell;
  const v = (z - res.z0) / res.cell;
  if (u < 0 || v < 0 || u > res.nx - 1 || v > res.nz - 1) return 1;
  const i = Math.min(res.nx - 2, Math.floor(u));
  const j = Math.min(res.nz - 2, Math.floor(v));
  const fu = u - i;
  const fv = v - j;
  const at = (a, b) => res.knots[b * res.nx + a];
  return (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv)
    + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv;
}

// ------------------------------- THE ONE CONVERSION, AND WHY IT HAS TO BE HERE
//
// EVERYTHING FITTED ABOVE IS IN LUMA AND WHAT THE FRAGMENT MULTIPLIES IS LIGHT,
// AND THE CURVE BETWEEN THEM IS NEITHER A GAMMA NOR A LINE.
//
// R1 measured the reference the only way a reference can be measured -- in the
// pixels of a photograph -- so its factor of 0.31 at the low decile is a ratio
// of ENCODED luma. What this map multiplies is the LIGHT a face stands in,
// before AgX and before the delivered grade cube. Carried through that chain a
// light of 0.31 comes back at 0.55 of open meadow, which is most of the way to
// nothing having happened: the first cut of this map shipped in luma by mistake
// and moved the frame's own decile from 0.56 to 0.51 against a target of 0.31.
// Solved the other way round through the same chain, a LUMA of 0.31 wants a
// LIGHT of 0.135 -- a factor of two and a third between the two numbers, at the
// one end of the range where this whole term lives.
//
// SO THE MAP IS BAKED IN LIGHT AND THE FIT STAYS IN LUMA, and the curve between
// them is tools/lighting/render-chain.mjs: the same seat, the same tone curve
// and the same delivered cube guard-prato and guard-scala read their levels
// through, which is the same one the frame is drawn with.
//
// WHAT IT COUPLES, DECLARED. The delivered picture is now a function of the
// light seat and of the grade cube as well as of the seats and the residual, so
// a session that moves either of those and does not re-bake ships a map that is
// no longer the fit. THAT IS WHAT guard-zone'S HASH IS FOR: it repaints this
// map from these sources at every commit and compares, so the day the chain
// moves the guard goes red instead of the meadow going quietly wrong.

/**
 * The light that reads a given share of open meadow in the finished frame.
 *
 * Solved by bisection on the chain rather than inverted in closed form, because
 * the grade is a lookup and a lookup has no inverse to write down. Sixty
 * halvings, which is exact to the last bit of a double and is paid once.
 */
export async function lightForLuma() {
  const composite = await renderChain();
  const seat = { ...readLight(), scale: LIGHT_SCALE };
  // A TOP FACE OF OPEN MEADOW, which is the face R1's own ratio is a ratio of:
  // its zone map is the luma of the meadow's own lit surface, normalised to the
  // ninetieth percentile of that same surface.
  const base = faceColour([0, 1, 0], seat, MEADOW_ALBEDO, GROUND_BOUNCE);
  const at = (k) => encodedLum(composite(base.map((v) => v * k)));
  const open = at(1);
  return (want) => {
    if (want >= 1) return 1;
    let lo = 1e-5;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid) / open > want) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  };
}

/** THE MAP: the law times the residual, floored, and carried into light. */
export async function paintZone({ side = ZONE.side, cell = ZONE.cell } = {}) {
  const res = readResidual();
  const toLight = await lightForLuma();
  const floorLight = toLight(LUMA_FLOOR);
  const out = new Uint8Array(side * side);
  const span = side * cell;
  let lo = 1;
  let hi = 0;
  let sum = 0;
  let lumaLo = 1;
  for (let j = 0; j < side; j++) {
    const z = ZONE.centre.z - span / 2 + (j + 0.5) * cell;
    for (let i = 0; i < side; i++) {
      const x = ZONE.centre.x - span / 2 + (i + 0.5) * cell;
      const luma = Math.max(LUMA_FLOOR, Math.min(1, lawAt(x, z) * residualAt(res, x, z)));
      const v = Math.max(floorLight, Math.min(1, toLight(luma)));
      out[j * side + i] = Math.round(v * 255);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      lumaLo = Math.min(lumaLo, luma);
      sum += v;
    }
  }
  return {
    map: out, lo, hi, lumaLo, floorLight, mean: sum / (side * side), residual: res,
  };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`
  || process.argv[1].endsWith('paint-zone.mjs')) {
  const side = flag('side', ZONE.side);
  const cell = flag('cell', ZONE.cell);
  const {
    map, lo, hi, lumaLo, floorLight, mean, residual,
  } = await paintZone({ side, cell });

  process.stdout.write(`painted ${side}x${side} of zone over ${(side * cell).toFixed(0)} m `
    + `of ground (${(cell * 100).toFixed(0)} cm a texel)
`);
  process.stdout.write(`  in LIGHT the map runs ${lo.toFixed(3)} to ${hi.toFixed(3)}, `
    + `mean ${mean.toFixed(4)}
`);
  process.stdout.write(`  in LUMA, through the chain, that is ${lumaLo.toFixed(3)} to 1.000; `
    + `the floor ${LUMA_FLOOR} of luma is ${floorLight.toFixed(4)} of light
`);
  process.stdout.write(`  the residual is ${residual.nx}x${residual.nz} knots at `
    + `${residual.cell} m, fitted `
    + `${residual.fitted ? `on ${residual.fitted.on} by ${residual.fitted.by}` : 'nowhere stated'}
`);

  // THE FIRST THING THAT MUST BE TRUE: the rim of the map is open meadow. The
  // sampler clamps to the edge, so whatever stands on the border of this square
  // is what the whole world outside it is lit by -- and a border that had
  // drifted off one would dim four hundred metres of boundary silently.
  let rim = 255;
  for (let k = 0; k < side; k++) {
    rim = Math.min(rim, map[k], map[(side - 1) * side + k], map[k * side], map[k * side + side - 1]);
  }
  process.stdout.write(`  the rim of the map stands at ${rim} of 255 `
    + `(${(rim / 255).toFixed(3)} of open meadow)\n`);
  if (rim < 250) {
    throw new Error(`the rim of the map is ${rim} and not open meadow: `
      + 'everything outside the square would be drawn in shade');
  }

  // AND THE SECOND: it has to DO something. A map of solid 255 is the world
  // that shipped before this unit and it would pass every downstream guard,
  // because a term that multiplies by one breaks nothing.
  const dark = map.reduce((t, v) => t + (v < 230 ? 1 : 0), 0) / (side * side);
  process.stdout.write(`  ${(dark * 100).toFixed(1)}% of the plateau stands in some zone\n`);
  if (dark < 0.05) {
    throw new Error(`only ${(dark * 100).toFixed(2)}% of the map is shaded: the law and the `
      + 'residual are drawing nothing');
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, 'zone-shade.png');
  const bytes = await writeCleanPng(map, { width: side, height: side, channels: 1 }, path);
  process.stdout.write(`${path} (${(bytes / 1024).toFixed(1)} kB)\n`);
}
