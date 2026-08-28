import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// WHERE THE SUN IS. ONE SEAT, AND THIS MODULE IS THE ONLY DOOR TO IT.
//
// The seat is assets-src/sky/sky.json, field `day.sun`: the preset the renderer
// already hands to the dome (src/core/sky.js setSkyPreset), so the light the
// world is baked under and the light the sky draws cannot be two different
// afternoons. It is a seat rather than a copy on purpose — every consumer reads
// this, nobody restates it.
//
// The reason this file exists is a measured defect. The world used to be baked
// under elevation 52, bearing 61, declared three times over in three bake
// scripts, while the sky drew elevation 34, azimuth -9.5: fifty-two degrees of
// separation, so every cast shadow on the meadow pointed seventy degrees away
// from where the sky says the sun is, and no rim correction could ever recover
// a face lit from the wrong side. It went unseen for months because the bakes
// used a forty degree sun disc, and a shadow with no edge has no readable
// direction.
//
// It also blocks the night. A day-to-night cursor moves uSunDir; if the baked
// light answers to a second sun, moving uSunDir turns the sky and leaves the
// world's shadows where they were.

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');

/** The seat, as a repo relative path, for anything that has to name it. */
export const SUN_SEAT = 'assets-src/sky/sky.json';
export const SUN_SEAT_FIELD = 'day.sun';

const DEG = Math.PI / 180;

/**
 * Direction to the sun, in runtime axes: Y up, north is -Z, bearing measured
 * from north turning east. Stated once here; the bake scripts get it from
 * tools/lighting/sun.py, which states the same arithmetic for Python and is
 * checked against this one by tools/lighting/check-suns.mjs.
 *
 * @param {number} elevation degrees above the horizon
 * @param {number} azimuth degrees from north, turning east
 */
export function sunVector(elevation, azimuth) {
  const e = elevation * DEG;
  const a = azimuth * DEG;
  return [
    Math.cos(e) * Math.sin(a),
    Math.sin(e),
    -Math.cos(e) * Math.cos(a),
  ];
}

/** Angle between two directions, in degrees. */
export function angleBetween(a, b) {
  const na = Math.hypot(...a);
  const nb = Math.hypot(...b);
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb);
  return Math.acos(Math.max(-1, Math.min(1, dot))) / DEG;
}

/**
 * How wide the sun is FOR A BAKE, in radians of full angle.
 *
 * The Python door (tools/lighting/sun.py sun_disc_angle) states the same thing
 * for the scripts that run inside Blender, and check-suns.mjs holds the two to
 * each other. Read that one for why the number is what it is.
 *
 * @param {string} root repository root
 */
export function bakeSunAngle(root = REPO_ROOT) {
  const sky = JSON.parse(readFileSync(join(root, SUN_SEAT), 'utf8'));
  const disc = sky.day && sky.day.disc;
  if (!disc) throw new Error(`${SUN_SEAT} carries no day.disc`);
  if (typeof disc.bakeAngleDeg === 'number') return disc.bakeAngleDeg * DEG;
  return 2 * disc.radiusDeg * DEG;
}

/**
 * The sun of this world.
 *
 * @param {string} root repository root, for a check that wants another tree
 * @returns {{elevation: number, azimuth: number, vector: number[]}}
 */
export function readSun(root = REPO_ROOT) {
  const path = join(root, SUN_SEAT);
  const sky = JSON.parse(readFileSync(path, 'utf8'));
  const day = sky.day;
  if (!day || !day.sun) throw new Error(`${SUN_SEAT} carries no ${SUN_SEAT_FIELD}`);
  const { elevation, azimuth, vector } = day.sun;
  if (typeof elevation !== 'number' || typeof azimuth !== 'number') {
    throw new Error(`${SUN_SEAT} ${SUN_SEAT_FIELD} has no elevation and azimuth`);
  }
  // The vector is what the runtime uniform is set from, so it is returned as
  // written rather than recomputed: a disagreement between it and the two
  // angles is a defect for the guard to report, not something to paper over
  // here.
  return {
    elevation,
    azimuth,
    vector: Array.isArray(vector) ? vector.slice() : sunVector(elevation, azimuth),
  };
}
