import { join } from 'node:path';
import { run, TOOLS_DIR } from '../toolchain.mjs';

// Entry point of the green chain: reads the colours off the reference, paints
// the two sheets, then works out where the rocks stand. In that order, because
// each step reads what the one before wrote.
//
// It used to end by sculpting and lighting those rocks in Blender, and that
// half is gone with the rest of the offline chain, packing pass included. The
// rock mesh and its light map are in the repository as delivered files, so
// nothing here has to be re-run to have rocks.

// The world is lit by one sun and the guard says so before anything is built
// under it. See tools/lighting/check-suns.mjs.
run(process.execPath, [join(TOOLS_DIR, 'lighting', 'check-suns.mjs'), '--sources']);

run(process.execPath, [join(TOOLS_DIR, 'vegetation', 'sample-plants.mjs')]);
run(process.execPath, [join(TOOLS_DIR, 'vegetation', 'paint-grass.mjs')]);
run(process.execPath, [join(TOOLS_DIR, 'vegetation', 'paint-props.mjs')]);
run(process.execPath, [join(TOOLS_DIR, 'vegetation', 'plan-rocks.mjs')]);
