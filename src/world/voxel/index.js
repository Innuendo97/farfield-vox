// THE ENGINE, AND THE FOUR SIGNATURES EVERYTHING GOES THROUGH.
//
// This is the door. Nothing outside src/world/voxel/ reaches past it into the
// files behind, and that is the whole reason it exists: the engine is the one
// piece of this world that ALL EIGHT sessions build on, so it is the one piece
// where a change nobody agreed to reaches everybody at once.
//
//   meshChunk(cx, cz, tuft)      the field and the greedy mesher over it, as
//                                pure arithmetic -- no three.js, no DOM, so the
//                                same file runs in a worker, on the page and
//                                under plain node, and the fusion number can be
//                                checked offline against the one the render
//                                reports. Two implementations of this would be
//                                two answers to the question the pivot rests on.
//   voxelMaterial(voxel, tune)   the material of a cube: the two terms from
//                                face-light.js, the air from air.js, and
//                                bakedLight() from sky.js. It composes those
//                                three and adds no fourth opinion.
//   buildMasonry(spec)           a block of layout.js as courses of stone.
//   runInWorker(options)         the same arithmetic, off the thread the walker
//                                is on.
//
// AND THE CONSTANTS, exported and not copied. Every one of them is a number some
// measurement was taken against, so a second copy of any of them silently
// invalidates a reading in a verbale rather than breaking a build.
//
// THE DOOR HAS TWO HALVES AND THE SPLIT IS LOAD-BEARING. This file is the
// PAGE's door: it reaches three.js, because voxelMaterial and createMasonry
// build one. ./pure.js is the arithmetic on its own, and a guard or a measuring
// script running under plain node imports THAT -- because the moment an offline
// tool has to pull three.js in to ask how many quads a column comes to, it stops
// being able to ask at all, and the fusion number stops being checkable outside
// a browser. That checkability is the property the whole pivot's budget rests
// on, so it is a structure here and not a habit.
//
// This file re-exports the pure half, so there is still ONE list of names.
//
// WHAT MAY CHANGE HERE AND WHAT MAY NOT. The bodies behind these names belong to
// the sessions that own the surfaces they draw. The names, their arguments and
// the constants are the foundation's, and moving one is a change to every
// session at once: it goes through the coordinator, not through a branch.

export * from './pure.js';

export { earthSettings, voxelMaterial, voxelSettings } from './material.js';
export { createMasonry, stoneTile } from './masonry.js';

/**
 * The engine's own arithmetic, off the thread the walker is on.
 *
 * THE DISC IS WHY THIS EXISTS. The height of one point costs 926 ns, measured,
 * and the disc asks for it once per column -- tens of milliseconds with no way
 * to make it cheaper, because it IS the shared definition of where the ground
 * is and a second, faster copy of it would be a second opinion about the floor
 * the walker stands on.
 *
 * A FACTORY AND NOT A `new Worker` AT EVERY CALL SITE, because the URL is the
 * part that is easy to get wrong and impossible to notice: `new URL(...,
 * import.meta.url)` resolved against the caller's own file is how a bundler is
 * told to emit the worker as a chunk, and a path written from the wrong
 * directory fails at run time and only in a build. One seat, resolved here,
 * beside the file it names.
 *
 * @param {object} options  handed straight to the worker as its first message
 * @param {Function} onMessage  called with each message's data
 * @returns {Worker} so the caller can terminate it
 */
export function runInWorker(options = {}, onMessage = null) {
  const worker = new Worker(new URL('./mesher-worker.js', import.meta.url), { type: 'module' });
  if (onMessage) worker.onmessage = (event) => onMessage(event.data);
  worker.postMessage(options);
  return worker;
}
