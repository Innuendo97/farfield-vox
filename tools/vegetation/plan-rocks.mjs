import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../grade/lib/framing.mjs';
import { heightAt } from '../../src/world/terrain-field.js';

// Where the rocks stand, and how big each one is.
//
// The two groups in the foreground are not scattered: in the reference they
// frame the picture. A dark mass fills the bottom left corner and a group of
// rounded boulders fills the bottom right, and between them they close the
// composition at the near edge. Their positions were solved rather than chosen:
// the pixels they occupy in the reference framing were traced back through the
// reference camera onto the meadow, which is what tools/vegetation/probe does
// for every measured patch, and the widths below are the widths those pixel
// spans subtend at the distance the trace returned.
//
// The width a pixel span subtends is not quite the width of the rock that
// subtends it: a round body is seen slightly from the side, and its silhouette
// is wider than a flat card of the same width would be. The near four are
// therefore projected forward again once placed and their radii corrected
// against the pixel columns the reference gives them, which is a fifth off the
// first reading.
//
// The four in the foreground are measured twice over: the pixel where a rock
// meets the grass is traced onto the meadow, which gives where it stands and how
// far away it is, and the pixel of its crown is then read at that distance,
// which gives how tall it is. The width is what its pixel span subtends there.
// Nothing about the near group is a guess.
//
// Everything downstream reads this file: the Blender scene that sculpts and
// lights them, the runtime that draws them, and the vegetation, which has to
// know where not to grow and where to grow thicker.

const OUT_DIR = join(REPO_ROOT, 'assets-src', 'rocks');

// Sculpting budget. The two hero rocks are within nine metres of the eye in the
// reference framing and carry the near corners of the frame, so they are given
// a real silhouette; everything else is seen small and gets a quarter of it.
const HERO = { subdivisions: 5, decimate: 0.55 };
const MID = { subdivisions: 4, decimate: 0.55 };
const MINOR = { subdivisions: 4, decimate: 0.28 };

// How much of the meadow's cloud shadow each rock is under.
//
// The meadow's own multiplier is not the answer for a body that stands out of
// it, and it is not one answer for all of them either. The break in the cloud
// is off to the east: the group in the bottom right corner of the reference
// catches it on its crowns, which are the palest stone in the lower half of
// that frame at #535d4d, while the mass in the bottom left sits on the far side
// of the path in the deepest of the shade and is left almost as a silhouette,
// at #0c1711. Taking the meadow's rate everywhere put the right hand crest
// forty eight levels down; taking the eastern rate everywhere put the left hand
// mass thirty eight levels up.
const SHADOW = { under: 0.88, catching: 0.30 };

const ROCKS = [
  // --------------------------------------------------------------- the heroes
  // Bottom left of the framing, columns 0 to 260: the reference leaves it
  // almost in silhouette, half of it outside the frame.
  {
    name: 'rock-sw', role: 'hero', x: -3.75, z: 7.88,
    radius: 0.62, height: 0.56, tilt: -9, yaw: 34, seed: 11, ...HERO,
  },
  // Bottom right, columns 1150 to 1550: the big angular boulder,
  {
    name: 'rock-se-big', role: 'hero', x: 3.45, z: 6.75,
    radius: 0.52, height: 0.56, tilt: 7, yaw: -22, seed: 23,
    take: SHADOW.catching, ...HERO,
  },
  // the rounded one that sits in front of it,
  {
    name: 'rock-se-round', role: 'hero', x: 3.30, z: 8.00,
    radius: 0.36, height: 0.32, tilt: 4, yaw: 71, seed: 37,
    take: SHADOW.catching, ...MID,
  },
  // and the small one at the left edge of the group.
  {
    name: 'rock-se-small', role: 'minor', x: 2.22, z: 6.46,
    radius: 0.22, height: 0.19, tilt: -6, yaw: 12, seed: 41,
    take: SHADOW.catching, ...MID,
  },

  // --------------------------------------------------------------- the strays
  // Between the blocks and out towards the water, where the reference shows
  // stone breaking the meadow without ever making a group of it.
  { name: 'rock-w1', role: 'minor', x: -7.60, z: -1.90, radius: 0.46, height: 0.34, tilt: 8, yaw: 55, seed: 53, ...MINOR },
  { name: 'rock-w2', role: 'minor', x: -12.10, z: 1.60, radius: 0.52, height: 0.40, tilt: -5, yaw: 128, seed: 59, ...MINOR },
  { name: 'rock-e1', role: 'minor', x: 10.60, z: -1.30, radius: 0.58, height: 0.44, tilt: 6, yaw: -70, seed: 67, ...MINOR },
  { name: 'rock-e2', role: 'minor', x: 12.65, z: -6.10, radius: 0.64, height: 0.48, tilt: -9, yaw: 21, seed: 71, ...MINOR },
  { name: 'rock-n1', role: 'minor', x: 7.15, z: -10.60, radius: 0.40, height: 0.30, tilt: 3, yaw: 96, seed: 79, ...MINOR },
  { name: 'rock-n2', role: 'minor', x: -5.05, z: -13.20, radius: 0.36, height: 0.27, tilt: -11, yaw: 143, seed: 83, ...MINOR },
];

// How far a rock is bedded into the ground, as a fraction of the shape's total
// height. "height" in the table above is what the reference shows standing
// above the grass, so the shape itself has to be taller than that by exactly
// this fraction, or every rock would come out short by a fifth.
//
// It is not a detail. The bake gives a rock the soft darkening where it meets
// the grass, but nothing bakes a shadow onto the meadow around it — the ground
// atlas was lit before these existed — so a rock resting exactly on the surface
// reads as a rock lying on a photograph of grass. Sinking it, and letting the
// tufts close over the joint, is what puts it in the ground instead.
const BEDDING = 0.30;

function main() {
  const rocks = ROCKS.map((rock) => {
    const ground = heightAt(rock.x, rock.z);
    const meshHeight = rock.height / (1 - BEDDING);
    return {
      ...rock,
      meshHeight: Number(meshHeight.toFixed(4)),
      y: Number((ground - meshHeight * BEDDING).toFixed(4)),
      ground: Number(ground.toFixed(4)),
    };
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const plan = { bedding: BEDDING, rocks };
  writeFileSync(join(OUT_DIR, 'rocks.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

  process.stdout.write(`  ${'rock'.padEnd(16)}${'role'.padEnd(7)}`
    + `${'x'.padStart(8)}${'z'.padStart(8)}${'ground'.padStart(9)}`
    + `${'radius'.padStart(8)}${'height'.padStart(8)}\n`);
  for (const rock of rocks) {
    process.stdout.write(`  ${rock.name.padEnd(16)}${rock.role.padEnd(7)}`
      + `${rock.x.toFixed(2).padStart(8)}${rock.z.toFixed(2).padStart(8)}`
      + `${rock.ground.toFixed(2).padStart(9)}`
      + `${rock.radius.toFixed(2).padStart(8)}${rock.height.toFixed(2).padStart(8)}\n`);
  }
  process.stdout.write(`\n${rocks.length} rocks: ${join(OUT_DIR, 'rocks.json')}\n`);
}

main();
