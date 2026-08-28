import { join } from 'node:path';
import { run, TOOLS_DIR } from '../toolchain.mjs';

// Entry point of the ground chain: the turf field, the mesh built on it, and
// the two things painted straight onto it that are not the albedo atlas.
//
// It used to end in a Cycles bake, and that half is gone: the light of this
// world is no longer rendered offline, so the steps that painted the atlas for
// a path tracer to light, ran Blender, packed its two terms and then asked
// whether the packed map had come out the right way up all went with it. What
// is left is the arithmetic half, which every downstream reader still needs and
// which runs in seconds without a binary tool. The atlases those retired steps
// wrote are in the repository as delivered files, so nothing here has to be
// re-run to have a world.
//
// "--size" is the side of the albedo atlas the strip has to register against.
// It is no longer produced here, so it is stated rather than inferred, and the
// default is the side the atlas on disk was painted at.

const passthrough = process.argv.slice(2);
const sizeArg = passthrough.find((a) => a.startsWith('--size'));
const size = sizeArg
  ? Number(sizeArg.includes('=') ? sizeArg.split('=')[1] : passthrough[passthrough.indexOf(sizeArg) + 1])
  : 2048;

// The world is lit by one sun and the guard says so before anything is built
// under it. See tools/lighting/check-suns.mjs.
run(process.execPath, [join(TOOLS_DIR, 'lighting', 'check-suns.mjs'), '--sources']);

// The turf field first, and before the mesh, because the ground is built ON the
// field: the hummocks are in the height the walker walks on, so a mesh built
// before the field would be a mesh of a different world. One generator, one
// sheet, and everything downstream reads the sheet. See
// tools/turf/build-turf.mjs.
run(process.execPath, [join(TOOLS_DIR, 'turf', 'build-turf.mjs')]);

run(process.execPath, [join(TOOLS_DIR, 'terrain', 'build-mesh.mjs'), '--no-preview']);

// Where the joints of the paving are, as a distance rather than as a picture of
// them. It takes the atlas's side rather than a draft flag, because what it has
// to reproduce is the band limit the ATLAS was painted with, and the gate below
// refuses the delivery if the two ever stop agreeing.
run(process.execPath, [join(TOOLS_DIR, 'terrain', 'paint-path-strip.mjs'), `--atlas=${size}`]);
run(process.execPath, [join(TOOLS_DIR, 'terrain', 'check-strip-register.mjs')]);

// The stair carries its own atlas at a fixed side: it is a few square metres of
// worked stone and it does not scale with the meadow's.
run(process.execPath, [join(TOOLS_DIR, 'terrain', 'paint-stairs.mjs')]);
