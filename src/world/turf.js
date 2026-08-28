import { CANOPY, META, RISE } from '../../assets-src/turf/turf-field.js';

// THE TURF FIELD, as the world reads it.
//
// One sheet, written by tools/turf/build-turf.mjs, describing two things about
// every quarter metre of the meadow: how far the ground rises into a hummock,
// and how long and how thick the grass stands. This module is the ONLY door to
// it. S2's baked shading, S3's micro relief and S4's grass all come through
// here, which is what the committente asked for when he said the rule must not
// be read three different ways.
//
// The constants are not repeated here. They are read out of the generated
// module, beside the field they describe, so that changing a blade length is one
// edit in one place and not a hunt through three consumers.
//
// The field is BUNDLED, not downloaded, and that is a requirement rather than a
// convenience: hub.js builds the walker's floor before any texture exists, so a
// hummock that arrived with a fetch would be a hummock the walker falls through.
// It is also why this reads a .js module and not a .json: terrain-field.js asks
// this file for the rise, and terrain-field.js runs under plain node inside
// build-mesh.mjs, probe.mjs and plan-rocks.mjs, where a bare JSON import is a
// syntax error.

export const {
  field: FIELD, transfer: TRANSFER, gates: GATES, seed: SEED, law: LAW,
} = META;

/** Metres of blade where the canopy reads g. */
export function bladeLength(g) {
  return TRANSFER.LEN_BARE + g * (TRANSFER.LEN_FULL - TRANSFER.LEN_BARE);
}

/** How much thicker to sow where the canopy reads g. */
export function bladeDensity(g) {
  return TRANSFER.DEN_BARE + g * (TRANSFER.DEN_FULL - TRANSFER.DEN_BARE);
}

/**
 * Scale for a grass card of the height vegetation.js builds today.
 *
 * Kept here rather than in the sowing loop so that the one place that knows how
 * tall a card is, is the same place that knows how long a blade should be.
 */
export function bladeScale(g) {
  return bladeLength(g) / TRANSFER.CARD_HEIGHT_TODAY;
}

// ------------------------------------------------------------------ the sheet
//
// Held as two planes of bytes rather than as an image, because every consumer
// wants to ask about a point in metres and none of them wants a texture: the
// walker asks on the CPU, the mesh builder asks once per vertex while it is
// being built, and the sowing loop asks a few times a second. Nothing samples
// this in a shader.

const ORIGIN_X = FIELD.centre.x - FIELD.size / 2;
const ORIGIN_Z = FIELD.centre.z - FIELD.size / 2;

/** Bilinear read of one plane at a world position, 0..1. */
function sample(plane, x, z) {
  const n = FIELD.texels;
  const fx = (x - ORIGIN_X) / FIELD.metresPerTexel - 0.5;
  const fz = (z - ORIGIN_Z) / FIELD.metresPerTexel - 0.5;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  // Outside the sheet there is no turf, and the field is built to be zero at its
  // own edge, so clamping here would smear the last row across the far meadow.
  if (ix < -1 || iz < -1 || ix >= n || iz >= n) return 0;
  const tx = fx - ix;
  const tz = fz - iz;
  const at = (a, b) => (a < 0 || b < 0 || a >= n || b >= n ? 0 : plane[b * n + a] / 255);
  return (at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx) * (1 - tz)
    + (at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx) * tz;
}

/** Metres the ground rises into a hummock here. */
export function turfRise(x, z) {
  return sample(RISE, x, z) * TRANSFER.RISE_MAX;
}

/** The canopy here, 0..1: feed it to bladeLength, bladeDensity or bladeScale. */
export function turfCanopy(x, z) {
  return sample(CANOPY, x, z);
}
