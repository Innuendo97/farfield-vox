import { join } from 'node:path';
import { run, TOOLS_DIR } from '../toolchain.mjs';

// Entry point of the green chain: reads the colours off the reference, paints
// the grass sheet, then works out where the rocks stand. In that order, because
// each step reads what the one before wrote.
//
// It used to end by sculpting and lighting those rocks in Blender, and that
// half is gone with the rest of the offline chain, packing pass included. The
// rock mesh and its light map are in the repository as delivered files, so
// nothing here has to be re-run to have rocks.
//
// AND IT USED TO PAINT A SECOND SHEET. paint-props.mjs drew two bushes and two
// cells of crossed flower cards; the bush belongs to V1 (E-V4d: what bites the
// stone in the targets is the ground's own carpet standing higher, not an
// object) and the flower is now a cube head with no texture on it, so nothing
// read that sheet any longer. It is gone rather than left painting an unread
// file — which is also how sample-plants' palette.json lost its last consumer
// on this side of the chain (E-V4f.3: it is sampled off the photorealistic
// reference through the light of a bake and its blue is 3.7x out). What still
// reads the palette is src/world/rocks.js, which is not the green's.

// The world is lit by one sun and the guard says so before anything is built
// under it. See tools/lighting/check-suns.mjs.
run(process.execPath, [join(TOOLS_DIR, 'lighting', 'check-suns.mjs'), '--sources']);

run(process.execPath, [join(TOOLS_DIR, 'vegetation', 'sample-plants.mjs')]);
run(process.execPath, [join(TOOLS_DIR, 'vegetation', 'paint-grass.mjs')]);
run(process.execPath, [join(TOOLS_DIR, 'vegetation', 'plan-rocks.mjs')]);
