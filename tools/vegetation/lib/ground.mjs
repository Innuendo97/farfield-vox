import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../grade/lib/framing.mjs';
import { srgbToLinear } from '../../grade/lib/color.mjs';
import { worldToUv } from '../../../src/world/terrain-field.js';

// What the meadow does with light, for the tools that have to stand on it.
//
// The grass cards are drawn as their own pigment times the ground's own light,
// so anything that authors them has to reach the same number the ground
// material reaches. It is read out of the runtime rather than restated, for the
// reason framing.mjs parses the reference pose instead of copying it: a second
// copy of an exposure is a second exposure, and the two drift on the first
// change.

/**
 * The light the bake puts on a point of the meadow, in the units the frame is
 * drawn in: the stored map, times the scale it was divided by to fit in eight
 * bits, times the exposure the ground material declares.
 */
export function sampleGroundLight(ground, x, z) {
  const { u, v } = worldToUv(x, z);
  // Red is how much of the sun the meadow sees here, green how much of the sky;
  // the two colours that turn them back into light come out of the same seat
  // the runtime reads, for the same reason this file reads the exposure out of
  // the material instead of restating it.
  const map = ground.light.packed || ground.light;
  const { width, height, data } = map;
  const px = Math.min(width - 1, Math.max(0, Math.round(u * width - 0.5)));
  const py = Math.min(height - 1, Math.max(0, Math.round(v * height - 0.5)));
  const o = (py * width + px) * 3;
  const sun = srgbToLinear(data[o] / 255);
  const sky = srgbToLinear(data[o + 1] / 255);
  return [0, 1, 2].map((c) => (sun * ground.sunLight[c] + sky * ground.skyLight[c])
    * ground.lightScale);
}

/** Exposure the ground material declares, on top of the stored light. */
export function groundExposure() {
  const source = readFileSync(join(REPO_ROOT, 'src', 'world', 'terrain.js'), 'utf8');
  const found = /export const GROUND_EXPOSURE = ([0-9.]+);/.exec(source);
  if (!found) throw new Error('GROUND_EXPOSURE not found in src/world/terrain.js');
  return Number(found[1]);
}

/** What the bake divided the light by so it would fit in eight bits. */
export function lightScale() {
  const path = join(REPO_ROOT, 'assets-src', 'terrain', 'terrain.json');
  return JSON.parse(readFileSync(path, 'utf8')).lightScale;
}
