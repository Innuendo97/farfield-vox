import v1 from './v1-suolo.js';
import v2 from './v2-pietra.js';
import v3 from './v3-sentiero.js';
import v4 from './v4-verde.js';
import v5 from './v5-cornice.js';
import v6 from './v6-cielo-nuvole.js';
import v7 from './v7-notte.js';
import v8 from './v8-avatar.js';

// THE REGISTER OF LAYERS, and the one list of what this world is made of.
//
// WHAT IT REPLACES. The names of the assets the world asks for were written out
// four times: once in the hub's dressing, once in the hub's planting, and twice
// in src/main.js, which had to know both which ids to fetch AND what each of
// them is called inside the module that eats it. Four copies of one list is
// four places to forget, and the failure it produces is silent — a layer that
// asks for a texture nobody fetched draws nothing at all and says nothing.
//
// Now a layer states what it needs, next to the code that uses it, and everyone
// else asks here.
//
// A LAYER IS A MODULE WITH FIVE THINGS IN IT:
//
//   id       what the session that owns it is called
//   needs    the asset ids it asks for, per arrival
//   build    what it hangs on the scene, given those assets
//   meshes   what it hung, for the hub to add and for anyone counting
//   update   what it does with a frame, or nothing
//
// AND `needs` AND `build` ARE INDEXED BY ARRIVAL, which is the one place this
// shape departs from the plan's four fields. This world already has two
// arrivals and they are not a convenience: `dress` is the first walkable frame
// -- the ground, the built stone and the distance, which the walker has to see
// before moving -- and `plant` is everything that can land a second later
// without anybody waiting on a sky. A layer can have a foot in each: the stone
// session owns the blocks, which are dressed, AND the rocks, which are planted.
// One flat list would have forced that session into two layers, and the map of
// ownership would then have stopped matching the register.
//
// THE ORDER IS THE SESSIONS' OWN and it is deliberate. Nothing here depends on
// what another layer did earlier in the same frame -- the one cross-layer write
// there is, the drift the weather hands to everything that reflects the sky, is
// a uniform read at draw time and not during the update. So this order can be
// the order a reader expects rather than an order the frame requires.
export const LAYERS = [v1, v2, v3, v4, v5, v6, v7, v8];

const BY_ID = new Map(LAYERS.map((layer) => [layer.id, layer]));

export const ARRIVALS = ['dress', 'plant'];

/** One layer, by the name of the session that owns it. */
export function layer(id) {
  const found = BY_ID.get(id);
  // Loud rather than silent. A typo in an id is a handle that quietly does
  // nothing for the rest of the run, which is the class of defect this register
  // exists to remove rather than to add.
  if (!found) throw new Error(`no layer "${id}" in the register`);
  return found;
}

/** The layers that have something to build at this arrival, in order. */
export function layersAt(arrival) {
  return LAYERS.filter((l) => l[arrival] && typeof l[arrival].build === 'function');
}

/**
 * Every asset id wanted at this arrival, once each, in the order the layers ask.
 *
 * Deduplicated because two layers legitimately want the same sheet: the
 * vegetation reads the ground's light at the foot of every card, which is the
 * ground's asset and the vegetation's need at the same time.
 */
export function needsAt(arrival) {
  const seen = [];
  for (const l of LAYERS) {
    for (const id of (l[arrival] && l[arrival].needs) || []) {
      if (!seen.includes(id)) seen.push(id);
    }
  }
  return seen;
}

/** Everything the world asks for, at every arrival. */
export function allNeeds() {
  const seen = [];
  for (const arrival of ARRIVALS) {
    for (const id of needsAt(arrival)) if (!seen.includes(id)) seen.push(id);
  }
  return seen;
}
