import { join } from 'node:path';
import { run, TOOLS_DIR } from '../toolchain.mjs';

// Entry point of the stone chain: plans where the blocks stand and paints the
// stone they are made of, in that order because the painter reads the plan.
//
// It used to go on to model and light them in Blender, and that half is gone
// with the rest of the offline chain: the modelling pass and the packing pass
// that turned its two raw terms into the one map the runtime reads are both
// retired. What they delivered — the mesh, the atlas, the packed light — is in
// the repository as files, so the world still has its stone; what is left here
// is the arithmetic that decides its shape and its colour.

// The world is lit by one sun and the guard says so before anything is built
// under it. See tools/lighting/check-suns.mjs.
run(process.execPath, [join(TOOLS_DIR, 'lighting', 'check-suns.mjs'), '--sources']);

run(process.execPath, [join(TOOLS_DIR, 'monoliths', 'plan.mjs')]);
run(process.execPath, [join(TOOLS_DIR, 'monoliths', 'paint-stone.mjs')]);
