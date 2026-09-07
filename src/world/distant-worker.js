import { buildHills } from './distant-mesh.js';

// THE HILLS, OFF THE THREAD THE WALKER IS ON.
//
// Three and a half seconds, measured. On the main thread that is not a slow
// frame -- the tab was killed outright the first time a harness tried to
// photograph it -- and E-CONF1 spent a whole unit bringing the first frame down
// to about 1.1 s by moving exactly this class of work here. One message out and
// one message back, with the buffers TRANSFERRED rather than copied, so the
// answer does not arrive as a second three-second task on the thread it was
// moved off.
//
// It says nothing and waits for nothing: the door in src/world/distant.js
// starts it, it answers once, and it is terminated. There is nothing to ask it
// twice -- the hills do not follow the walker, they are the world.
const { wedges, stats } = buildHills();

const transfer = [];
for (const wedge of wedges) {
  if (!wedge) continue;
  transfer.push(wedge.position.buffer, wedge.shade.buffer, wedge.index.buffer);
}
postMessage({ wedges, stats }, transfer);
