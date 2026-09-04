import { join } from 'node:path';
import { run, TOOLS_DIR } from '../toolchain.mjs';

// What is left of the ground chain, which is the STAIR'S ATLAS and nothing else.
//
// This used to build a world: a turf field, a bent grid of a hundred and ninety
// two vertices a side laid on it, an albedo and a light map painted over that
// bend, and a strip that measured where the joints of the paving fell. Every one
// of those steps painted or measured the ATLAS OF THE GROUND, and the ground has
// no atlas any more -- the meadow is cubes to the tier's radius and a sheet from
// there to a hundred metres, both taking their colour from arithmetic in
// src/world/voxel/material.js, and the corridor is columns of that same disc
// wearing the three maps tools/path/paint-path.mjs writes. The four atlases left
// the delivery at step 8 and their painters went with them, because a painter
// without a picture to paint is not a tool, it is a file.
//
// So what remains here is the one surface in this folder that is still worn: the
// stair and the platform, which are a few square metres of worked stone with an
// atlas of their own at a fixed side. It does not scale with the meadow's and it
// never did.

// The world is lit by one sun and the guard says so before anything is built
// under it. See tools/lighting/check-suns.mjs.
run(process.execPath, [join(TOOLS_DIR, 'lighting', 'check-suns.mjs'), '--sources']);

run(process.execPath, [join(TOOLS_DIR, 'terrain', 'paint-stairs.mjs')]);
