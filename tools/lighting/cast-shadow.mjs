import { MONOLITHS, PLATFORM, STAIRS } from '../../src/world/layout.js';
import { readSun, sunVector } from './sun.mjs';

// WHERE THE SEALED SUN THROWS A SHADOW, as arithmetic.
//
// Three tools needed this same answer and were each about to work it out for
// themselves: the guard that asked which way up a light map is, the fit of the
// canopy (tools/terrain/fit-canopy.mjs, retired at step 8), and the mask of the
// reference does not contradict. Three copies of one geometry is how this
// project ended up with three suns, so there is one here instead.
//
// The first of the three has gone with the bake it guarded — there is no atlas
// of ground light left to be wound the wrong way round, because the voxel
// engine writes both terms in the fragment. The seat stays: the geometry is
// about where the sealed sun throws, which is a fact about the world and not
// about how the world was baked.
//
// It needs no bake: the bodies that cast are boxes, the sun is a direction, and
// a ray-box against each box in its own frame is the whole calculation. That is
// also what makes it usable as a check ON a bake — it is an independent opinion
// about where the dark should be.

const DEG = Math.PI / 180;

/** The boxes the bake stands in the scene, in the frame each one is rotated to. */
function boxes({ withBuilt }) {
  const list = MONOLITHS.map((m) => ({
    x: m.position.x,
    z: m.position.z,
    y0: m.baseY || 0,
    y1: (m.baseY || 0) + m.size[1],
    hw: m.size[0] / 2,
    hd: m.size[2] / 2,
    rotationY: m.rotationY,
  }));
  if (withBuilt) {
    list.push({
      x: PLATFORM.x,
      z: PLATFORM.z,
      y0: 0,
      y1: PLATFORM.height,
      hw: PLATFORM.width / 2,
      hd: PLATFORM.depth / 2,
      rotationY: PLATFORM.rotationY,
    });
    for (let k = 0; k < STAIRS.steps; k++) {
      list.push({
        x: STAIRS.x,
        z: STAIRS.z + STAIRS.tread * (k + 0.5),
        y0: 0,
        y1: PLATFORM.height * (STAIRS.steps - k) / STAIRS.steps,
        hw: STAIRS.width / 2,
        hd: STAIRS.tread / 2,
        rotationY: 0,
      });
    }
  }
  return list.map((b) => {
    // Yaw about the runtime's vertical axis, with the sign the layout uses.
    const a = -b.rotationY * DEG;
    return { ...b, cos: Math.cos(a), sin: Math.sin(a) };
  });
}

/**
 * A predicate: does a ray from a point on the ground towards the sun meet a body?
 *
 * @param {object} options
 * @param {boolean} options.withBuilt whether the platform and the steps cast too.
 *   The blocks alone are what a wound-ness check wants — they are the only
 *   shadows big enough to read on a 2048 atlas — while a mask of the meadow
 *   wants everything that darkens it.
 * @returns {(x: number, y: number, z: number) => boolean}
 */
export function castShadowTest({ withBuilt = false, root } = {}) {
  const seat = readSun(root);
  const L = sunVector(seat.elevation, seat.azimuth);
  const list = boxes({ withBuilt });

  return function occluded(x, y, z) {
    for (const b of list) {
      // Into the box's own frame, where it is axis aligned.
      const dx = x - b.x;
      const dz = z - b.z;
      const lx = dx * b.cos + dz * b.sin;
      const lz = -dx * b.sin + dz * b.cos;
      const dirX = L[0] * b.cos + L[2] * b.sin;
      const dirZ = -L[0] * b.sin + L[2] * b.cos;
      let t0 = 0;
      let t1 = 1e9;
      const slab = (o, d, lo, hi) => {
        if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
        let a = (lo - o) / d;
        let c = (hi - o) / d;
        if (a > c) { const s = a; a = c; c = s; }
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, c);
        return t1 >= t0;
      };
      if (!slab(lx, dirX, -b.hw, b.hw)) continue;
      if (!slab(lz, dirZ, -b.hd, b.hd)) continue;
      if (!slab(y, L[1], b.y0, b.y1)) continue;
      if (t1 > 0) return true;
    }
    return false;
  };
}
