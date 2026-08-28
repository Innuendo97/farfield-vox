import { Vector3 } from 'three';
import { MONOLITHS, SPAWN } from './layout.js';
import { getSection, loadSection, PENDING } from '../core/content.js';
import { createPanels } from './panels.js';
import { createRoom } from '../ui/room.js';

// What happens when the walker gets close to a block.
//
// One machine with four states, and the walker moves between them in one
// direction with E and back out with Esc:
//
//   mondo     nothing near; the blocks are dark and the prompt is down
//   vicino    inside the reach of a face; that block lights and the prompt is up
//   pannelli  the face has opened: the stack stands in front of it in the world
//   stanza    one entry is being read, over the world rather than instead of it
//
// The world never stops. In "pannelli" the walker still has the keys and the
// mouse: the stack is a thing standing in front of a stone, not a modal, and
// walking away from it closes it. Only "stanza" takes the mouse, because it is
// a page and a page has to be clickable.

const DEG = Math.PI / 180;

// Reach of a face, in metres, measured to the face and not to the centre of the
// block: a block two metres deep would otherwise answer from inside itself.
const FOCUS_RADIUS = 4.2;
// And the distance at which it lets go. The gap is what keeps a walker standing
// on the edge of the reach from switching a monolith on and off.
const RELEASE_RADIUS = 5.0;
// Far enough out that the written material is on the machine well before it can
// be asked for, and close enough that walking to one block never fetches six.
const PREFETCH_RADIUS = 8.0;
// An open stack the walker has walked out of is a stack nobody is reading.
const ABANDON_RADIUS = 6.0;

// Sideways counts for more than straight out. Standing beside a block on the
// way to another one is not addressing it, and without this the path to the
// third block runs through the reach of the second and the fourth.
const LATERAL_WEIGHT = 1.9;

const RAMP_SECONDS = 0.4;

// How long the prefetch waits before asking again for a section whose file did
// not answer.
const RETRY_COOLDOWN = 5000;

// The step the camera takes towards a face that has just opened, and how long
// it takes. It moves the eye and not the body: the walker keeps every key.
const DOLLY = 0.5;
const DOLLY_TAU = 0.16;
// And the distance inside which it does not happen at all. A lean is worth half
// a metre to somebody standing four metres off; to somebody already with their
// nose against the stone it is a shove.
const DOLLY_MIN_GAP = 2.6;

const PROMPT_WORLD = 'Interagisci';
const PROMPT_PANELS = 'Apri la voce';

// The prompt stands at the foot of the frame from the first moment, as the
// reference framing shows it, and there is nothing within reach of the spawn:
// somebody who has just arrived is told the key exists before it has anything
// to open. It gives way to proximity as soon as they walk off the ground they
// arrived on, and it never comes back once a face has been opened — by then the
// key has introduced itself.
const SPAWN_PROMPT_RADIUS = 6.0;

const isPending = (entry) => Boolean(entry) && entry.stato === PENDING;

/** One step of a value moving towards where it should be, at a fixed rate. */
function ramp(now, want, step) {
  if (now === want) return want;
  return want > now ? Math.min(want, now + step) : Math.max(want, now - step);
}

/**
 * The face of every block, in the terms the distance below is measured in.
 *
 * `front` is the outward normal of the engraved face and `right` runs across
 * it; `centre` sits on the face itself rather than at the middle of the block.
 */
function faces() {
  return MONOLITHS.map((spec) => {
    const angle = spec.rotationY * DEG;
    const front = new Vector3(Math.sin(angle), 0, Math.cos(angle));
    const right = new Vector3(Math.cos(angle), 0, -Math.sin(angle));
    return {
      spec,
      front,
      right,
      centre: new Vector3(
        spec.position.x + front.x * spec.size[2] / 2,
        spec.baseY,
        spec.position.z + front.z * spec.size[2] / 2,
      ),
      half: spec.size[0] / 2,
    };
  });
}

/**
 * How far a walker is from a face, in the plane.
 *
 * Height is left out on purpose: the face of the third block is thirteen metres
 * tall and its middle is five metres over the walker's head, so a distance
 * taken in three dimensions would never let anybody reach it.
 */
function faceDistance(face, at) {
  const dx = at.x - face.centre.x;
  const dz = at.z - face.centre.z;
  const out = dx * face.front.x + dz * face.front.z;
  // Behind the stone there is nothing to read.
  if (out < 0) return Infinity;
  const along = dx * face.right.x + dz * face.right.z;
  const lateral = Math.max(0, Math.abs(along) - face.half) * LATERAL_WEIGHT;
  return Math.hypot(lateral, out);
}

/**
 * Builds the interaction and returns its handle.
 *
 * @param {object}   options.scene       the scene the stack is hung on
 * @param {Element}  options.ui          where the room is mounted
 * @param {object}   options.hud         needs showInteract(visible, label)
 * @param {function} options.setFocus    (id, lit 0..1, opened 0..1) — how lit a
 *                                       block is and how far its face has opened
 * @param {function} options.releasePointer  hands the mouse to the room
 * @param {function} options.recapturePointer takes it back
 */
export function createInteraction({
  scene, ui, hud, setFocus, releasePointer, recapturePointer,
}) {
  const list = faces();
  const focus = new Map(list.map((face) => [face.spec.id, { lit: 0, out: 0 }]));
  const requested = new Set();
  const failedAt = new Map();

  let everOpened = false;
  let promptLabel = null;

  /** The prompt, told only when what it says changes. */
  function prompt(visible, label = PROMPT_WORLD) {
    const wanted = visible ? label : null;
    if (wanted === promptLabel) return;
    promptLabel = wanted;
    hud.showInteract(visible, label);
  }

  /** Whether the walker is still standing where the world put them. */
  function atSpawn(at) {
    if (everOpened) return false;
    return Math.hypot(at.x - SPAWN.x, at.z - SPAWN.z) <= SPAWN_PROMPT_RADIUS;
  }

  const panels = createPanels({ scene, pending: isPending });
  const room = createRoom(ui, {
    onClose(index) {
      panels.select(index);
      state = 'pannelli';
      prompt(true, PROMPT_PANELS);
      recapturePointer?.();
    },
  });

  let state = 'mondo';
  let active = null;
  let dolly = 0;
  // Where the reader's eye was when the face opened, which is the height the
  // stack hangs at. A walker on the stair of the third block reads it from a
  // metre and a half above a walker standing at the foot of it.
  let eye = 1.7;
  // How far the face being addressed is, in the terms faceDistance measures in.
  // Kept because src/core/eye.js needs a focal plane and this is the machine
  // that already decided which face the walker is addressing: a second reading
  // of the same thing could disagree with this one about which block that is,
  // and then the picture would be focused on a face the prompt is not offering.
  let nearMetres = Infinity;
  // And WHERE it is, in the plane, for the same reader and for the same reason.
  // src/core/eye.js has to be able to ask whether the walker is LOOKING at the
  // face it is within reach of — the committente walked past a block without
  // looking at it and the picture went soft anyway — and that question is
  // dot(gaze, direction to the face), which needs a point rather than a length.
  //
  // Held here rather than worked out again from MONOLITHS: a second derivation
  // of the same geometry is a second opinion about WHICH face is being
  // addressed, and then the eye could be gating on one block while the prompt
  // offers another.
  //
  // IN THE PLANE, and y is left at nought on purpose — the same purpose
  // faceDistance leaves it out for. The face of the third block is thirteen
  // metres tall and its middle is five metres over the walker's head, so a
  // direction taken in three dimensions would say "you are not looking at it"
  // to somebody standing right in front of it with their head tipped back.
  const aim = new Vector3();
  const reach = new Vector3();

  /**
   * Asks for the written material of one section.
   *
   * A section that failed is allowed to be asked for again, but not at once: a
   * walker standing inside the reach of a block whose file is unreachable would
   * otherwise send one request per frame. E is the immediate retry, and the
   * courtesy panel says so.
   */
  function request(face, swapIn = false) {
    const key = face.spec.key;
    requested.add(key);
    failedAt.delete(key);
    return loadSection(key)
      .then((section) => {
        if (swapIn && state === 'pannelli' && active === face) {
          panels.show(section, face.spec, 0, eye);
        }
        return section;
      })
      .catch((error) => {
        failedAt.set(key, performance.now());
        console.warn(`content not fetched for ${key}:`, error.message);
        return null;
      });
  }

  /** Whether the prefetch may ask for a section it has already asked for. */
  function mayAsk(key) {
    if (!requested.has(key)) return true;
    const failed = failedAt.get(key);
    return failed !== undefined && performance.now() - failed > RETRY_COOLDOWN;
  }

  function openPanels(face, index = 0) {
    active = face;
    state = 'pannelli';
    everOpened = true;
    const section = getSection(face.spec.key);
    if (section) panels.show(section, face.spec, index, eye);
    else {
      panels.show(null, face.spec, 0, eye);
      request(face, true);
    }
    prompt(true, PROMPT_PANELS);
  }

  function closePanels() {
    panels.hide();
    state = active ? 'vicino' : 'mondo';
    prompt(state === 'vicino', PROMPT_WORLD);
  }

  function openRoom() {
    const section = getSection(active.spec.key);
    if (!section) return;
    state = 'stanza';
    prompt(false);
    releasePointer?.();
    room.open(section, panels.selected);
  }

  const api = {
    get state() { return state; },
    /** True while the room is up: the body stands still and the mouse is free. */
    get holdsPointer() { return state === 'stanza'; },
    /** How far the face being addressed is, in metres, or Infinity for none. */
    get targetMetres() { return nearMetres; },
    /**
     * The nearest point of that face, in the plane, or null for none.
     *
     * The vector is the live one rather than a copy: it is read once a frame by
     * src/core/eye.js and a fresh Vector3 sixty times a second is a collection
     * a minute for nothing.
     */
    get targetPoint() { return active ? aim : null; },

    /**
     * Proximity, the lamps, the prefetch and the animations, once a frame.
     */
    update(dt, at) {
      eye = at.y;
      let nearest = null;
      let best = Infinity;
      for (const face of list) {
        const distance = faceDistance(face, at);
        if (distance < best) { best = distance; nearest = face; }
        // The prefetch is measured from the block and not from its face: a
        // walker coming round the side is just as close to needing the text.
        if (mayAsk(face.spec.key)) {
          const dx = at.x - face.spec.position.x;
          const dz = at.z - face.spec.position.z;
          if (Math.hypot(dx, dz) < PREFETCH_RADIUS) request(face);
        }
      }

      if (state === 'mondo' || state === 'vicino') {
        const held = active && faceDistance(active, at) <= RELEASE_RADIUS;
        if (nearest && best <= FOCUS_RADIUS) active = nearest;
        else if (!held) active = null;
        state = active ? 'vicino' : 'mondo';
        prompt(state === 'vicino' || atSpawn(at), PROMPT_WORLD);
      } else if (state === 'pannelli' && faceDistance(active, at) > ABANDON_RADIUS) {
        // Walked out of it. Nothing was chosen, so nothing is remembered.
        active = null;
        closePanels();
      }

      // The lamps. Every block ramps towards where it should be rather than
      // switching, and the ramp is the same on the way down as on the way up.
      // The second number is how far the face has opened, which the writing
      // reads to step back behind whatever came out of it.
      nearMetres = active ? faceDistance(active, at) : Infinity;
      // The point on that face the walker is nearest to: the face is a finite
      // panel, so the aim is the walker projected onto it and then held inside
      // its own width. Standing off to one side of a wide face, what you turn
      // towards is its near edge and not its middle.
      if (active) {
        const dx = at.x - active.centre.x;
        const dz = at.z - active.centre.z;
        const along = Math.max(-active.half,
          Math.min(active.half, dx * active.right.x + dz * active.right.z));
        aim.set(
          active.centre.x + active.right.x * along,
          0,
          active.centre.z + active.right.z * along,
        );
      }

      const step = dt / RAMP_SECONDS;
      const showing = state === 'pannelli' || state === 'stanza';
      for (const face of list) {
        const id = face.spec.id;
        const held = focus.get(id);
        held.lit = ramp(held.lit, face === active ? 1 : 0, step);
        held.out = ramp(held.out, face === active && showing ? 1 : 0, step);
        setFocus?.(id, held.lit, held.out);
      }

      const wantDolly = state === 'pannelli' || state === 'stanza' ? DOLLY : 0;
      if (Math.abs(dolly - wantDolly) > 1e-4) {
        dolly += (wantDolly - dolly) * (1 - Math.exp(-dt / DOLLY_TAU));
      } else {
        dolly = wantDolly;
      }

      panels.update(dt);
    },

    /**
     * The lean towards an opened face, applied to the camera after the body has
     * been placed.
     *
     * It is deliberately not a move of the player: the walker keeps walking,
     * and an eye that leaned in by moving the body would fight every key press.
     */
    applyCamera(camera) {
      const anchor = panels.anchor;
      if (dolly < 1e-4 || !anchor) return;
      reach.set(anchor.x - camera.position.x, 0, anchor.z - camera.position.z);
      const gap = reach.length();
      if (gap < 1e-3) return;
      reach.divideScalar(gap);
      camera.position.addScaledVector(reach, Math.min(dolly, Math.max(0, gap - DOLLY_MIN_GAP)));
    },

    /**
     * First refusal on the keyboard.
     *
     * Only E and Esc are taken: the keys that move the list are the keys that
     * walk, and they are deliberately left to do both. A walker who holds S to
     * step out of the panels steps down the list once and then walks, which is
     * exactly the way out the concept asks for. Repeats are ignored, so holding
     * a key never runs down a timeline.
     *
     * @returns {boolean} whether the key was consumed
     */
    handleKey(code, event) {
      if (state === 'stanza') return true;   // the room reads its own keys
      if (event?.repeat) return false;

      if (state === 'pannelli') {
        if (code === 'KeyW' || code === 'ArrowUp') { panels.step(-1); return false; }
        if (code === 'KeyS' || code === 'ArrowDown') { panels.step(1); return false; }
        if (code === 'KeyE') {
          if (panels.count) openRoom();
          else openPanels(active);   // the courtesy panel; E is the retry
          return true;
        }
        if (code === 'Escape') { closePanels(); return true; }
        return false;
      }

      if (state === 'vicino' && code === 'KeyE') {
        openPanels(active);
        return true;
      }
      return false;
    },
  };

  return api;
}
