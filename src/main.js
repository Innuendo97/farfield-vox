import { PerspectiveCamera } from 'three';
import { Renderer } from './core/renderer.js';
import { Loop } from './core/loop.js';
import { Input } from './core/input.js';
import { Player } from './core/player.js';
import { createPresence } from './core/presence.js';
import { createEye } from './core/eye.js';
import { createAudio } from './core/audio.js';
import { Assets } from './core/assets.js';
import {
  loadAllSections, loadSection, pendingEntries, setContentBase,
} from './core/content.js';
import { engrave, loadEngravingFont } from './world/engraving.js';
import { createInteraction } from './world/interact.js';
import { MONOLITHS } from './world/layout.js';
import {
  DEFAULT_FOV, POSE_SPAWN, POSE_TARGET,
} from './core/poses.js';
import { RIG, SWITCH } from './core/avatar.js';
import { loadLut } from './core/post.js';
import {
  createQuality, forgetStored, needsBenchmark, readStored,
} from './core/quality.js';
import {
  askedFraction, deviceRatio, frameOf, windowPixels,
} from './core/inquadratura.js';
import {
  createBenchmark, decideFraming, decideNight, tierOf,
} from './core/bench.js';
import { buildHub } from './world/hub.js';
import { needsAt } from './world/layers/registry.js';
import { createStartOverlay } from './ui/overlay.js';
import { createTouchControls, touchWanted } from './ui/touch.js';
import { createSkyVeil } from './ui/veil.js';
import { createDevPose } from './dev/pose.js';
import { createHud } from './ui/hud.js';
import { createReticle } from './ui/reticle.js';
import { LOOK, choose } from './world/avatar/look.js';
import {
  createDevHud, createGradePanel, isClockFrozen, isDevMode,
} from './ui/devhud.js';
import {
  armSteps, beginFrame, endFrame, mark, readSteps,
} from './core/steps.js';

const canvas = document.getElementById('stage');
const ui = document.getElementById('ui');

// ------------------------------------------------- machines that cannot walk

// Where the readable edition lives, at the anchor that makes it say why the
// reader was sent to it. The page needs no script to answer that fragment.
const CV_URL = `${import.meta.env.BASE_URL}cv/`;
const CV_FALLBACK_URL = `${CV_URL}#edizione-testuale`;
const LEAVE_MS = 2600;

const AWAY = {
  webgl: 'Questo browser non riesce a disegnare il mondo in 3D: gli manca WebGL2. '
    + 'Tutto quello che il mondo contiene è però scritto anche in una pagina da leggere.',
};

/**
 * Why this machine is not going to be given the world, or null if it is.
 *
 * THERE USED TO BE A SECOND REASON HERE, AND IT WAS THE SCREEN ITSELF: a coarse
 * pointer with no fine one anywhere was read as a machine this world could not
 * be walked on, and a telephone was shown the courtesy note — «l'edizione
 * esplorabile da mobile arriverà più avanti» — and sent to the readable
 * edition. That sentence is what this session answers. The commands are on the
 * glass now (src/ui/touch.js), so a screen with no keyboard walks, and the one
 * thing left that this world genuinely cannot be built without is WebGL2: every
 * surface here is a baked texture drawn through one composite pass, and there
 * is no version of that without it.
 */
function whyNotWalkable() {
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) return 'webgl';
    // The real renderer wants a context of its own; this one has done its job.
    probe.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return 'webgl';
  }
  return null;
}

/** The courtesy note, and then the readable edition. */
function leaveForReadableEdition(reason) {
  canvas.remove();
  const note = document.createElement('div');
  note.className = 'away';
  note.setAttribute('role', 'status');
  const title = document.createElement('h1');
  title.textContent = 'Farfield';
  const text = document.createElement('p');
  text.textContent = AWAY[reason];
  const link = document.createElement('a');
  link.href = CV_FALLBACK_URL;
  link.textContent = 'Vai all’edizione testuale';
  note.append(title, text, link);
  document.body.appendChild(note);
  setTimeout(() => window.location.replace(CV_FALLBACK_URL), LEAVE_MS);
}

const away = whyNotWalkable();
if (away) {
  leaveForReadableEdition(away);
  // Nothing below this line ever runs on such a machine. The wait is never
  // settled on purpose: it is what stops the module here, so a phone spends
  // nothing building a world it is about to leave.
  await new Promise(() => {});
}

// ------------------------------------------------- the scene before the world

/**
 * Whether this visit gets the opening scene.
 *
 * ON at the address and OFF in every measured session. ?dev is the flag every
 * comparison of this campaign is taken behind — the poses, the seals, the byte
 * diffs — and a page with a loading scene over it is not the page those numbers
 * are about. So development never gets it by accident: it has to be asked for,
 * ?dev&intro=1, and the scene is built and looked at through that. ?intro=0
 * turns it off from anywhere, which is the switch a visitor who wants the world
 * and not the ceremony can use.
 */
function wantsIntro() {
  const query = new URLSearchParams(window.location.search);
  if (query.get('intro') === '0') return false;
  if (isDevMode()) return query.get('intro') === '1';
  return true;
}

const INTRO = wantsIntro();

// THE COVER, AND WHY IT IS HERE AND NOT IN THE SCENE'S OWN SHEET.
//
// The scene arrives as a chunk of its own, on the network, which is the whole
// point of it costing nothing when it is switched off. A chunk takes a round
// trip, and the world's first frames do not wait for it: without something
// opaque on the page from the very first task, the visitor's first sight of
// this world is the sky appearing in pieces behind nothing — the exact thing
// the scene exists to spare them. So the cover is four lines of inline style
// laid down before the renderer is even built, and the scene adopts it.
const introCover = INTRO ? document.createElement('div') : null;
if (introCover) {
  introCover.id = 'intro-cover';
  introCover.setAttribute('style', 'position:fixed;inset:0;z-index:30;background:#050b13;');
  document.body.appendChild(introCover);
}

// WHAT THE SCENE IS TOLD, AND THE ONE PROPERTY IT HAS: it only ever goes up.
//
// The phases below report into this and nothing else; the scene reads whatever
// has accumulated when it mounts and is called for every report after that. The
// max is what makes the progress honest without anybody having to be careful:
// a phase cannot take back ground it has already covered, so a bar built on
// this cannot run backwards however the loads interleave.
const introBus = INTRO ? {
  fractions: {
    critical: 0, dress: 0, plant: 0, engrave: 0, bench: 0,
  },
  sink: null,
  report(phase, fraction) {
    this.fractions[phase] = Math.max(this.fractions[phase], fraction);
    this.sink?.();
  },
} : null;

// Handed to the gateway, or not handed at all: with the scene off this stays
// undefined and the critical load is the load it has always been.
const onCriticalByte = introBus
  ? (loaded, total) => introBus.report('critical', total ? loaded / total : 1)
  : undefined;

// HOW LONG THE VEIL WILL WAIT FOR THE GROUND BEFORE IT LIFTS ANYWAY.
//
// The veil holds the arrival for two seconds and dissolves over two and a half,
// and it used to start that stopwatch on the frame the ground FIRST arrived --
// which, on a machine streaming a hundred and twenty eight tiles at sixty to a
// hundred milliseconds apiece in a worker, is four to six seconds before the
// ground is all there. R8 watched it happen: «il suolo si costruisce a vista,
// tessera per tessera e per righe dal fondo». A curtain that goes up on a set
// still being carried in is worse than a longer curtain.
//
// So it waits for hub.groundReady(). The ceiling is what keeps that from being
// a promise the page cannot keep: a machine slow enough, or a worker wedged
// badly enough, must still get its world -- late and building itself, which is
// what happened every time before, rather than never. Six seconds is the wait
// measured on the machine the campaign judges on, and the verbale records which
// of the two the delivery took on each visit.
//
// NINE SECONDS, AND IT IS A MEASUREMENT AND NOT A ROUND NUMBER. R8 proposed six.
// Measured here with a 50 ms register from the first byte -- four servers up, a
// second bench running -- the whole ground stands at 7.1 s on a return visit and
// 10.0 s on a first one, so six seconds put the curtain up with a second of
// floor still arriving and the wait bought nothing at all. Nine covers the
// return visit, which is the one a walker has twice, and leaves the first visit
// on the ceiling with the horizon already there.
const VEIL_GROUND_CAP_MS = 9000;

/**
 * Lifts the veil when the ground is all there, or when the ceiling says so.
 *
 * Safe to call more than once: the second caller finds the first already
 * waiting, and veil.begin() is itself safe to call twice.
 */
let veilWaiting = false;
function beginVeilWhenGround() {
  if (veilWaiting) return;
  veilWaiting = true;
  const from = performance.now();
  const look = () => {
    const late = performance.now() - from >= VEIL_GROUND_CAP_MS;
    if (!hub.groundReady() && !late) { requestAnimationFrame(look); return; }
    veil.begin(late ? 'a tempo' : 'col suolo intero');
  };
  look();
}

// Who raises the arrival veil. With no scene it goes up where it always went
// up, on the frame the ground arrives; with the scene it is the scene that
// raises it, at the end of the waking. The flag is what covers the third case:
// a scene that never arrived, on a page whose world is already standing.
let introAlive = INTRO;
let worldStanding = false;

function raiseVeil() {
  worldStanding = true;
  if (!introAlive) beginVeilWhenGround();
}

// NOT AWAITED, AND ASKED FOR BEFORE THE RENDERER EXISTS. The world's own load
// starts a few lines down and must never queue behind a chunk of interface;
// this only has to be in flight early, so that it lands during the round trip
// for the manifest rather than after it. Whatever it brings back finds the
// ledger already carrying everything that arrived while it was on the wire.
//
// The handles it is given are declared further down and initialised before any
// microtask of this promise can run: the body of this module has no await left
// on the walkable path, so it finishes first.
let intro = null;
if (INTRO) {
  import('./ui/intro.js')
    .then(({ createIntro }) => {
      intro = createIntro({
        root: ui,
        cover: introCover,
        bus: introBus,
        // THE GESTURE, AND THE THREE THINGS IT IS.
        //
        // Run synchronously inside the visitor's own event, because two of the
        // three need the activation that only lives for the length of that
        // task: the pointer lock, and the audio context.
        //
        // 1. ENGAGED. src/core/player.js reads the axis only when this is set,
        //    so without it the walker is handed a world they cannot move in.
        //    It is now its own handle rather than a synthetic click through the
        //    canvas, which is what the stub had to do before it existed.
        // 2. THE POINTER, ASKED FOR AND ALLOWED TO BE REFUSED. A lock requested
        //    from a key press is one a browser may say no to. The refusal is
        //    caught in both shapes it arrives in — a throw on the old browsers,
        //    a rejected promise on the new — because the walk goes on without
        //    the mouse and an uncaught rejection would be a line in a console
        //    this campaign keeps clean. At the handover the classic prompt
        //    comes back for exactly this case (see onAwake).
        // 3. THE HEARING, opened muffled and uncovered over the length of the
        //    blinks. The scene passes the number; this file does not know it,
        //    and should not — the timeline belongs to the scene.
        onGesture: (durationMs) => {
          input.engage();
          try {
            Promise.resolve(input.requestLock()).catch(() => {});
          } catch { /* a browser that refuses by throwing */ }
          audio.wake(durationMs);
        },
        onAwake: () => {
          beginVeilWhenGround();
          // AND THE DISPLAY ARRIVES NOW, not four seconds ago behind a night.
          //
          // The greeting, the dial and the command line fade up over the same
          // curve as the veil they are lit against — which is what they were
          // written to do — but with the scene up, the world they belong to has
          // been standing since long before anyone saw it, so a display that
          // arrived with the world would have finished arriving in the dark and
          // been STAMPED on the first frame the eyes opened onto. Held back at
          // construction (`defer`), and let go here: the last thing to come is
          // the interface, over eyes that have just finished opening.
          hud.arrive();
          // And the way back in, for a lock the browser refused: the walker
          // must never be left with a world and no way to take the mouse. With
          // fingers there is no mouse to take and the lock was never asked for,
          // so «senza blocco» does not mean «senza mondo» any more.
          if (!input.locked && !input.touch) overlay.setVisible(true);
        },
      });
    })
    .catch((error) => {
      // A scene that did not arrive must not be a page that never starts. The
      // cover comes off, the veil is raised if the world is already standing,
      // and the arrival is the arrival this world had before any of this.
      console.warn('opening scene not shown:', error.message);
      introAlive = false;
      introCover?.remove();
      overlay.setVisible(true);
      // The display was held for a scene that never came. It is owed its
      // arrival by whoever asked for the hold, and this is that debt paid.
      hud.arrive();
      if (worldStanding) beginVeilWhenGround();
    });
}

// ------------------------------------------------- how much of the window

// WHAT FRACTION OF THE WINDOW THE WORLD IS DRAWN INTO, AND WHO DECIDES IT.
//
// It is the bench's answer, taken once in the load and remembered with the rest
// of the calibration, and the governor never touches it afterwards: see
// src/core/inquadratura.js for why it is an area and not a scale, and
// calibrate() below for how the answer is reached.
//
// WHAT IT STARTS AT, AND WHY A RETURNING WALKER NEVER SEES IT MOVE.
//
// The handle outranks everything: `?inquadratura=<f>` pins the framing and the
// bench never decides one, which is how every plate and every guard of this
// session photographs a world instead of a verdict.
//
// Then the deposit. A machine that was measured on a previous visit already has
// its answer, and needsBenchmark() below says so, so the bench does not run at
// all and the picture is the size it was last time from the very first frame.
//
// And with neither, ONE: the whole window, which is what this page has always
// drawn, until the bench says otherwise behind the opening scene.
const PINNED = askedFraction();
let fraction = PINNED ?? readStored()?.fraction ?? 1;

// ------------------------------------------------------- the night around it

/**
 * Whether the night turns, and it is the BENCH's answer — not a preference.
 *
 * `?notte=animata|ferma|no` pins it, the way `?inquadratura=` pins the framing:
 * for the plates, for the guards, and for anybody who wants to put a number on
 * their own screen. `no` is the null every measurement of its cost is taken
 * against, and it is the one value a visitor never gets by any other route.
 */
const NIGHT_CHOICE = (() => {
  const raw = new URLSearchParams(window.location.search).get('notte');
  return raw === 'animata' || raw === 'ferma' || raw === 'no' ? raw : null;
})();

// The night around the picture, mounted only where there is a picture smaller
// than the window to put it around. It is null at a whole window and STAYS
// null, and the module it comes from is never even fetched there: see
// applyNight() below and src/ui/notte.js.
let night = null;
// AND IT DOES NOT TURN UNTIL SOMETHING SAYS IT MAY. The handle first, then what
// the last visit was told, and with neither the still sky -- which is the
// measured answer on the reference machine and the safe one on a machine
// nobody has measured yet. See decideNight() in src/core/bench.js.
let nightTurning = NIGHT_CHOICE
  ? NIGHT_CHOICE === 'animata'
  : readStored()?.notte === 'animata';
let nightComing = false;

/**
 * Hangs the night behind the picture, or takes it away.
 *
 * THE CHUNK IS ASKED FOR ONLY WHERE IT IS WANTED. At a whole window nothing
 * here runs at all — no import, no element, no canvas, not one byte on the
 * wire — which is the same economy the opening scene has and the thing the byte
 * comparison at `?inquadratura=1` stands on.
 */
function applyNight(framed) {
  if (!framed || NIGHT_CHOICE === 'no') {
    if (night) { night.dispose(); night = null; }
    return;
  }
  if (night) {
    // WHAT WAS ASKED OF IT AND NOT WHAT IT DOES: a visitor who asked their
    // machine for no motion has a still sky whatever the bench found, and
    // comparing the verdict against THAT would tear the night down and build
    // the identical thing again on every resize, for exactly those visitors.
    if (night.asked === nightTurning) { night.relayout(); return; }
    // The verdict changed under it, which happens once: the bench answers while
    // the night is already up. A turn is a property the element is built with,
    // so it is rebuilt -- behind the opening scene, where there is nothing to
    // see it.
    night.dispose();
    night = null;
  }
  if (nightComing) return;
  nightComing = true;
  import('./ui/notte.js')
    .then(({ createNight }) => {
      nightComing = false;
      // The framing may have gone away while the chunk was on the wire.
      if (!document.body.classList.contains('is-inquadrata')) return;
      night = createNight({ animated: nightTurning }).start();
      if (import.meta.env.DEV && window.farfield) window.farfield.night = night;
    })
    .catch((error) => {
      // A night that did not arrive is a picture on the page's own ground,
      // which is already the night's colour (body.is-inquadrata in
      // src/ui/style.css). Nothing about the world is lost.
      nightComing = false;
      console.warn('night not shown:', error.message);
    });
}

/**
 * Puts the framing on the page: the canvas becomes a centred rectangle and the
 * night, if there is one, is told the new shape.
 *
 * NOTHING AT ALL HAPPENS AT ONE. No class, no custom property, no night — the
 * page is the page it has always been, which is what `?inquadratura=1` is worth
 * to a guard and what the byte comparison stands on.
 */
function applyFraming() {
  const frame = frameOf(fraction, window.innerWidth, window.innerHeight);
  if (frame.framed) {
    document.body.style.setProperty('--inquadratura-w', `${frame.width}px`);
    document.body.style.setProperty('--inquadratura-h', `${frame.height}px`);
    document.body.classList.add('is-inquadrata');
  } else {
    document.body.classList.remove('is-inquadrata');
    document.body.style.removeProperty('--inquadratura-w');
    document.body.style.removeProperty('--inquadratura-h');
  }
  return frame;
}

/**
 * The framing changes, once, when the bench has spoken.
 *
 * It is a reallocation of every buffer the frame is drawn into, so it happens
 * exactly once per visit and behind the opening scene, where there is nothing
 * to see it. With the scene off — which is every measured session, every guard
 * and every plate — it is visible, and that is correct: those pages are opened
 * at a pinned framing and this is never called on them at all.
 */
function setFraction(next) {
  if (next === fraction) return;
  fraction = next;
  resize();
}

const renderer = new Renderer().init(canvas, applyFraming());
// The far plane has to clear the furthest thing in the world, and the furthest
// thing is not the meadow. The band of air sits at seven hundred metres and the
// largest of the giants at five hundred and twenty: at four hundred both were
// clipped away outright, which is why the ridge line ended in a wash of the
// green the sky bake fills its lower half with. Depth precision is set by the
// near plane, not by this, so moving it out costs nothing.
// THE LENS TAKES THE FRAMING'S SHAPE AND NOT THE WINDOW'S, which is the whole
// of what a smaller picture does to the world: the same field of view over a
// smaller rectangle is the same world seen from the same place, and nothing in
// front of the camera knows anything happened. resize() below keeps the two
// together for the rest of the visit.
const camera = new PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 1400);

const hub = buildHub();
const { scene, blockers, solids, groundHeightAt } = hub;

const player = new Player()
  .setGroundSampler(groundHeightAt)
  .setBlockers(blockers)
  // What the boom cannot swing through. The walker's own footprints are not
  // enough for it: a camera on a five metre arm meets things a body never does.
  .setSolids(solids);
// The body under the eye. A held clock is a held body: ?dev&t0 is the flag that
// says every frame taken from here is the same instant, and a breathing body
// would be the one thing in that instant that could not be photographed twice.
const presence = createPresence({ frozen: isClockFrozen() });
// And the optics in front of it: focus, adaptation, glare, drops. It reads the
// body's own state and gives the composite six numbers, all of them at rest
// wherever the walker was placed rather than walked.
const eye = createEye();
// Filled by the walker each frame and never replaced.
const motion = {};
// And what the governor is told about that motion, same rule.
const motionOut = { lookRate: 0, speed: 0 };
const input = new Input().attach(canvas);
// WHICH HAND IS WALKING, DECIDED ONCE AND BEFORE ANYTHING READS IT.
//
// Everything below branches on input.touch and nothing recomputes it: the
// opening scene's gesture, the prompt, the menu and the body all have to agree
// about which page this is, and a second reading of the machine is a second
// opinion. Outside the mode nothing on this page changes at all — no listener
// is registered, no element is built, no handle is published — which is what
// the desk's byte comparison stands on.
input.touch = touchWanted();
if (input.touch) document.body.classList.add('is-touch');
const overlay = createStartOverlay(ui, { touch: input.touch });
// Behind the opening scene there is nothing to click into: the scene takes the
// gesture itself and hands the world over when it is finished. The prompt is
// put away before it has been painted once, and comes back at the end of the
// waking only if the lock was refused.
if (INTRO) overlay.setVisible(false);
const veil = createSkyVeil(ui);
// The prompt to click back in belongs to a walker who has been left holding
// nothing. While a panel of the interface is up the mouse is theirs by design,
// and saying "click to explore" underneath it would be an instruction to undo
// what they just asked for.
let interaction = null;
input.onLockChange((locked) => {
  if (!menuOpen() && !interaction?.holdsPointer) overlay.setVisible(!locked);
});
// AND WITH FINGERS THERE IS NO LOCK TO CHANGE, so the prompt is taken down by
// the thing that actually happened. It is the one signal in the mode: the lock
// is never asked for, so pointerlockchange never fires, so without this the
// world would be walked from behind «Tocca per esplorare» for ever. Nothing
// below ever puts it back up in the mode — see onAwake and recapturePointer.
if (input.touch) input.onEngage(() => overlay.setVisible(false));

/**
 * Hands the mouse to the menu and takes it back afterwards.
 *
 * The panel has to be clickable, and it cannot be while the canvas holds the
 * pointer. Taking the capture back is a request a browser can refuse — it will
 * not grant a fresh one for a moment after one has been dropped — so when it
 * does, the way back in is the same prompt the walker used the first time.
 */
function releasePointer() {
  overlay.setVisible(false);
  // There is nothing to hand over with fingers: the panels of this interface
  // take their own taps whether or not the world is being walked, and exiting a
  // lock that was never taken is a call with nothing on the other end of it.
  if (!input.touch) document.exitPointerLock();
}

function recapturePointer() {
  // AND NOTHING TO TAKE BACK EITHER. This used to be the one place a refused
  // lock put the way-in prompt back up, which on a telephone was every time:
  // the walker closed a panel and was handed «Clicca per esplorare» over a
  // world they were already standing in.
  if (input.touch) return;
  if (!input.engaged) { overlay.setVisible(true); return; }
  const granted = canvas.requestPointerLock();
  if (granted && typeof granted.catch === 'function') granted.catch(() => overlay.setVisible(true));
}

// What this machine can afford, and the three seconds that find out.
//
// The tier is on the frame before anything else touches it: a walker who
// arrives on a slow machine should never see one frame of the world at a cost
// it cannot hold, and the levers are cheap to set on an empty scene.
const quality = createQuality({ renderer, hub });
quality.start();
// The clock the governor is steered by, and the eleven stages ONLY where a
// panel reads them: see setTiming in src/core/renderer.js.
renderer.setTiming(true, isDevMode());
const bench = createBenchmark({ renderer, pose: POSE_SPAWN, ui });

// What the world sounds like. It listens for the first gesture itself and takes
// nothing — no context, no bytes — until one arrives. Never in development: the
// poses this campaign is judged on are frames, and a frame time measured with
// an audio thread running is not the number the gates hold.
//
// AND NEVER UNDER THE OPENING SCENE EITHER, for a different reason: the scene
// swallows every click while the world is loading, so a visitor who taps the
// glass early would otherwise open an audio context minutes before the world
// they are meant to hear. The first gesture that counts is the one the scene
// hands on, and until then this takes nothing.
const audio = createAudio({ base: import.meta.env.BASE_URL, auto: !isDevMode() && !INTRO });

const hud = createHud(ui, {
  contentUrl: CV_URL,
  // The interface says the gestures instead of the keys, and the prompt at the
  // foot of the frame becomes the button it has always looked like. The menu is
  // handed it too, for its own list of commands and for a way out that is a
  // thing on the screen rather than the name of a key.
  touch: input.touch,
  onInteract: () => input.command('KeyE'),
  // Held back only under the opening scene, and let go at the end of the
  // waking (see onAwake above). With the scene off this is false and the
  // display arrives exactly where it always arrived.
  defer: INTRO,
  onOpen: releasePointer,
  onClose: recapturePointer,
  quality: {
    choice: quality.choice,
    onChoose: (next) => quality.setChoice(next),
  },
  motion: {
    onChoose: (next) => hud.menu.setMotion(next, presence.setChoice(next)),
  },
  sound: {
    onChoose: (next) => hud.menu.setSound(audio.setWorld(next), audio.available),
  },
  music: {
    onChoose: (next) => hud.menu.setMusic(audio.setMusic(next), audio.available),
  },
  // THE FIGURE. Two things behind one row, because to a walker they are one
  // question: who is standing there, and what are they wearing.
  //
  // THE VIEW GOES THROUGH V8a's OWN DOOR AND NOT ROUND IT. `player.setPerson` is
  // the single entrance the third person was delivered with, and it stays the
  // single entrance: this row calls it and nothing here knows what a boom is.
  // Until now nothing on the page called it at all — the door existed and had no
  // handle — so a walker could not see the body the row below dresses.
  //
  // THE PERSONALISATION GOES THROUGH look.js AND THE LAYER READS IT. Nothing is
  // rebuilt, nothing is downloaded and no draw is added; see
  // src/world/layers/v8-avatar.js.
  figura: {
    onChoose: (what, id) => {
      if (what === 'vista') setPerson(id);
      else choose(what, id);
      hud.menu.setFigura(LOOK, player.person);
    },
  },
});
/**
 * The person, and the field of view that belongs to it.
 *
 * THE RULE NAMES AN FOV AND SOMETHING HAS TO APPLY IT. RIG.fov is the fitted
 * framing's own, measured with the rest of the rule; DEFAULT_FOV is the first
 * person's. On a tree where the two are the same number this changes nothing,
 * which is the point: it is written where the person changes so that it cannot
 * be forgotten the next time one of them is refitted.
 *
 * ONE DOOR FOR BOTH HANDLES. The menu row and the V key both come through here,
 * so a walker who uses one and then the other never finds them disagreeing.
 */
function setPerson(which) {
  player.setPerson(which);
  camera.fov = player.person === 'terza' ? RIG.fov : DEFAULT_FOV;
  camera.updateProjectionMatrix();
}
setPerson(player.person);

const reticle = createReticle(ui);
hud.menu.setSound(audio.worldChoice, audio.available);
hud.menu.setMusic(audio.musicChoice, audio.available);
quality.onChange((tier, choice) => hud.menu.setQuality(choice, tier.label));
hud.menu.setQuality(quality.choice, quality.tier.label);
hud.menu.setMotion(presence.choice, presence.reduced);
hud.menu.setFigura(LOOK, player.person);
const menuOpen = () => hud.menu.isOpen;

// The whole cycle of the concept: coming close, the face lighting, the panels
// opening on it, the room of one entry. It owns the panels and the room, so the
// hub only ever hears about how lit each block should be.
interaction = createInteraction({
  scene,
  ui,
  hud,
  setFocus: (id, amount, opened) => hub.setMonolithFocus(id, amount, opened),
  releasePointer,
  recapturePointer,
});

// AND THE FINGERS, WHICH EXIST ONLY IN THE MODE.
//
// Built after the interaction because the stick has to be able to ask which of
// the four states the walker is in — a tap means E within reach of a stone and
// nothing at all in the middle of a meadow — and it asks through a function
// rather than holding the handle, so this file stays the only place that knows
// how the two are joined.
const touch = input.touch
  ? createTouchControls({
    root: ui,
    surface: canvas,
    input,
    state: () => interaction.state,
    // Where the walker is, for the proofs of this mode and nothing else: the
    // page a telephone gets has no ?dev and therefore no window.farfield, and a
    // walk of one metre has to be readable as a number rather than guessed at
    // from a photograph. See src/ui/touch.js, which publishes it.
    probe: () => ({
      x: player.position.x, z: player.position.z, yaw: player.yawDegrees,
    }),
  })
  : null;

// While the menu is up the world holds still: the keys belong to the panel, and
// a player walking behind an open menu is a player who arrives somewhere they
// did not choose.
const IDLE_INPUT = {
  locked: false, engaged: false, running: false, touch: false,
  axis: () => ({ x: 0, z: 0 }),
  drainLook: () => ({ x: 0, y: 0 }),
};

input.onKey((code, event) => {
  // The interaction gets first refusal: E and Esc mean something different
  // standing in front of an open face than they do in the middle of a meadow.
  if (!menuOpen() && interaction.handleKey(code, event)) return;
  if (code === 'Tab') {
    event.preventDefault();
    hud.menu.toggle();
  } else if (code === 'Escape' && menuOpen()) {
    hud.menu.setOpen(false);
  } else if (code === 'KeyV' && !menuOpen()) {
    // THE ONE KEY THE MENU HAS ALWAYS PROMISED. The row in the controls has read
    // "V -- passare dalla prima alla terza persona" since the menu was written,
    // and until now nothing was listening: the door existed, the handle was in
    // the menu, and the key was not wired to either. It goes through the same
    // door the menu row goes through, so the two can never disagree about which
    // person the frame is in.
    setPerson(player.person === 'terza' ? 'prima' : 'terza');
    hud.menu.setFigura(LOOK, player.person);
  }
});

let grassVisible = true;
let cloudsVisible = true;
// Il conto delle chiamate GL, quando qualcuno l'ha chiesto. Vedi piu' sotto.
let glCounter = null;
// What the last frame cost, and what the driver has answered for since the
// last time anybody looked. The two are only different while a query is still
// in the queue.
let lastCostMs = 0;
let freshCostMs = 0;
let lastTimings = null;

const dev = isDevMode() ? createDevHud(ui) : null;
const grade = isDevMode() ? createGradePanel(ui, renderer.post) : null;
// IL CRONOMETRO PER PASSO, acceso solo dove il riquadro lo e'. `?dev&passi=0`
// lo spegne lasciando acceso tutto il resto, che e' l'unico modo di misurare
// quanto costa lo strumento stesso: due aperture della stessa pagina, una con
// e una senza, tutto il resto identico. Vedi src/core/steps.js.
armSteps(isDevMode() && new URLSearchParams(window.location.search).get('passi') !== '0');
if (dev) {
  // THE ONE SEAT A POSE IS IMPOSED THROUGH, built where the walker, the lens and
  // the arrival veil are all in scope, and only where a pose can be imposed at
  // all: both of the things that reach it -- the handle below and the P key --
  // are behind this flag, so a visitor's page has no reason to build it.
  const devPose = createDevPose({ player, camera, veil });
  // WHERE TO STAND, FROM OUTSIDE THE PAGE, and only ever in development.
  //
  // Every session of this campaign is judged on pairs of frames taken at the
  // same pose before and after a change, and a pose reached by hand is not the
  // same pose twice: a pixel of mouse is a twentieth of a degree, and the sky is
  // being argued over in tenths. The keyboard already has the reference pose on
  // P; this is the rest of them — the laterals, the wide look, the bearings of a
  // panorama — reachable by a driver that takes the shot as well.
  //
  // It is behind isDevMode, so a visitor's page never defines it.
  //
  // AND IT IS NOT WRITTEN HERE. The P key below and this handle used to be two
  // placements with one name between them -- this one moved the eye and left the
  // person alone, P asked which person the walker was in and placed the FIGURE
  // when he was in third, five metres in front of the lens -- so a bench and a
  // session were photographing two different cameras (E-LUCE5). Both now go
  // through src/dev/pose.js, which is the single seat: first person, the fitted
  // camera, the arrival veil off the frame, and the six numbers the camera
  // actually reads handed back so that a caller can check rather than trust.
  window.setDevPose = (asked) => devPose.place(asked);
  // AND THE SWITCH, SLOWED, FOR THE ONE THING A CAMERA CANNOT PHOTOGRAPH.
  //
  // The run from one person to the other lasts 0.35 s and a screenshot costs
  // longer than that, so every attempt to photograph it catches the end. This
  // stretches the SAME law over as long as it takes to take a picture of it --
  // the profile, the monotonicity and the arithmetic are untouched, only the
  // clock is -- so a plate can show the body dissolving while the arm comes out.
  // It is a bench handle beside window.setDevPose and it lives behind the same
  // flag: what it must never become is a tuning knob, because the duration is a
  // decision and guard-avatar reads it from the seat.
  window.setDevSwitch = (seconds) => {
    SWITCH.seconds = seconds > 0 ? seconds : 0.35;
    return SWITCH.seconds;
  };

  input.onKey((code) => {
    // THE REFERENCE FRAMING, AND THERE IS ONLY ONE OF IT. P used to place the
    // FIGURE when the walker was in third person and leave the camera on the end
    // of the boom, which meant the committente was shown one camera and the
    // campaign measured another (E-LUCE5, D-L5-1 = A). It goes through the same
    // seat window.setDevPose goes through, so the two cannot come apart again.
    if (code === 'KeyP') devPose.place(POSE_TARGET);
    if (code === 'KeyG') grade.cycleStage();
    // The calibration again, from nothing: the stored answer is thrown away
    // first, so what runs is exactly what a machine sees on its first visit.
    if (code === 'KeyB') {
      forgetStored();
      calibrate(true);
    }
    // The grass is the only thing in this world drawn in real time, so it is
    // the only thing whose cost has to be measurable on its own. ON H AND NO
    // LONGER ON V: V is the walker's own key, promised by the menu since it was
    // written, and a development lever does not get to keep a letter a visitor
    // has been told is theirs.
    if (code === 'KeyH') {
      grassVisible = !grassVisible;
      hub.setGrassVisible(grassVisible);
    }
    // And the weather, which is the other thing in this frame whose cost is
    // fill rather than geometry, and the only way to read it on its own.
    if (code === 'KeyC') {
      cloudsVisible = !cloudsVisible;
      hub.setCloudsVisible(cloudsVisible);
    }
    // The rain on the glass, which is a preview of what S8 will switch on for
    // real. Behind the development flag and nowhere else; ?dev&pioggia starts
    // it already on, for a shot that has to be taken without pressing anything.
    if (code === 'KeyR') eye.toggleRain();
  });
}

let worldSeconds = 0;

/**
 * Everything one arrival asks for, under the ids it asked for them by.
 *
 * The register is the seat for WHICH assets an arrival wants; this only fetches
 * what it named. An asset that has not landed comes back undefined, which is
 * what every layer already checks for.
 */
/**
 * Compiles what an arrival has just built, before any of it is hung.
 *
 * Handed to the hub rather than called here because only the hub knows what an
 * arrival made; see raise() in src/world/hub.js for why the group is compiled
 * against the scene instead of in it. Whatever happens it resolves: a stall in
 * a driver may cost the world a few frames of lateness, never the world.
 */
function warm(group) {
  return renderer.warm(group, camera, hub.scene);
}

function bagFor(arrival) {
  const bag = {};
  for (const id of needsAt(arrival)) bag[id] = assets.get(id);
  return bag;
}

setContentBase(import.meta.env.BASE_URL);

const assets = new Assets(import.meta.env.BASE_URL).setRenderer(renderer);
// The walkable frame comes first; everything else arrives while the player is
// already moving, so a slow line delays detail and never the walk itself.
assets.loadCritical(onCriticalByte)
  .then(() => {
    // The dome is already up — it is arithmetic, not a delivery — so what this
    // waits for is the ground under it. The arrival shading is counted from
    // here: it holds the composition the reference drew, and until the world is
    // standing there is no composition to hold.
    raiseVeil();
    // MARKED BEFORE THE CALL AND NOT AFTER IT. Dressing the ground is tens of
    // milliseconds of synchronous work on the main thread, and a bar told about
    // it afterwards would be told at the far side of the stall — it would stand
    // still through the one moment of the load that most needs something to be
    // moving. Told first, the transition is already in flight and the
    // compositor carries it across.
    introBus?.report('dress', 1);
    // The ground and the distances are dressed together: they share the fog and
    // the sky reflection, and a frame with one but not the other reads wrong.
    // WHAT TO HAND OVER IS THE REGISTER'S ANSWER AND NOT THIS FILE'S. It used
    // to be a list here, and a second list of what each texture is called
    // inside the module that eats it — so this file knew both which assets the
    // world wants and what every layer means by them. Now every id the register
    // asks for is handed over under its own name, and the layer that eats it
    // does its own naming beside the code that does the eating.
    hub.dress({ ...bagFor('dress'), warm });
    engraveAll();
    plantWhenReady();
    return assets.stream();
  })
  .catch((error) => console.warn('asset streaming stopped:', error.message));

/**
 * The rocks and the grass, as soon as their sheets are down.
 *
 * They are asked for by name rather than waited for at the end of the stream:
 * they are the first thing after the walkable frame that changes what the world
 * looks like, and the walker should not have to wait for everything else to
 * arrive before the meadow grows.
 */
function plantWhenReady() {
  // What this arrival has to WAIT for, which is not the same as what it eats.
  // A layer planted late may still read a sheet the first walkable frame
  // already brought down — the grass reads the ground's own light at the foot
  // of every card — and waiting for it a second time would put weight the
  // walker has already paid for into the bar that measures what is left.
  const dressed = needsAt('dress');
  const wanted = needsAt('plant').filter((id) => !dressed.includes(id));
  // WHAT WAS BETWEEN HERE AND THE LINE BELOW: the switch between two weathers.
  //
  // `cloud-relit` was a generated table asked for by name and allowed not to be
  // there, and whether the delivery carried it decided whether the sky was
  // relit volumes or the plates cut out of the reference's own photograph. Both
  // fields are gone -- the weather is a roster of density in
  // assets-src/sky/sky.json and a mesh of cubes built at load -- so there is
  // nothing left to switch between and nothing left to fetch. The layer asks
  // for no asset at all.
  // The seven pieces by weight, for anything watching the load. Three megabytes
  // that are not seven equal thirds — the cloud sheets alone are more than half
  // of it — so a fraction counted in files would move in steps the wrong size.
  // With no scene up there is no closure between the ask and the answer.
  const plantBytes = wanted.reduce((sum, id) => sum + assets.bytesOf(id), 0);
  let plantLanded = 0;
  const landed = (id) => {
    plantLanded += assets.bytesOf(id);
    if (introBus) introBus.report('plant', plantBytes ? plantLanded / plantBytes : 1);
  };
  // AND AN ID THIS DELIVERY DOES NOT CARRY IS NOT A REASON TO PLANT NOTHING.
  //
  // bagFor() states the contract twenty lines up: "An asset that has not landed
  // comes back undefined, which is what every layer already checks for". A
  // Promise.all over the asks made that sentence FALSE -- one id the manifest
  // does not have and the whole arrival was skipped, so a tree whose assets had
  // not been built came up with no meadow, no flowers and no trees for the sake
  // of a sheet of five hundred bytes. Measured, on exactly that tree.
  //
  // So a miss is reported by name and turned into the null the layers already
  // read, and everything that DID land is planted. It is reported and not
  // swallowed: a delivery that disagrees with the register is a real defect and
  // the console is where it has to say so.
  const ask = (id) => assets.load(id)
    .then((value) => { landed(id); return value; })
    .catch((error) => {
      console.warn(`[plant] "${id}" is not in this delivery (${error.message}): `
        + 'the layers that read it draw without it');
      landed(id);
      return null;
    });
  Promise.all(wanted.map(ask))
    .then(() => hub.plant({
      ...bagFor('plant'),
      frozen: isClockFrozen(),
      warm,
    }))
    .then(() => calibrate())
    .catch((error) => {
      // A meadow that did not arrive is not a reason to seal the visitor behind
      // the loading scene. Nothing further is coming down this chain — the
      // calibration at the end of it least of all — so the phases waiting on it
      // are closed and the way in can still be offered.
      introBus?.report('plant', 1);
      introBus?.report('bench', 1);
      console.warn('meadow not planted:', error.message);
    });
}

/**
 * Asks the machine what it can do, once, on the first visit.
 *
 * It waits for the meadow because the meadow is the measurement: everything
 * else in this world is baked and costs what it costs, and the one thing that
 * can be turned down is the one thing that would not be in the frame yet.
 */
function calibrate(force = false) {
  if (bench.active) return;
  // THE WAY OUT IS MARKED TOO, AND THAT IS THE POINT OF MARKING THIS AT ALL. A
  // machine that answered this question on a previous visit, or one small
  // enough never to be asked, never runs the three seconds — and a bar waiting
  // for a phase that is not going to happen would stop short of the end for
  // ever, on exactly the visits that are fastest.
  if (!force && !needsBenchmark(windowPixels())) {
    introBus?.report('bench', 1);
    return;
  }
  introBus?.report('bench', 0);
  bench.run().then((verdict) => {
    introBus?.report('bench', 1);
    const tier = tierOf(verdict);
    if (!tier) return;
    // WHAT THE BENCH READ, AND WHERE IT READ IT. The buffer is asked for AFTER
    // the three seconds and not before: nothing moves it during them — the
    // walker has no world yet and the governor is held — but a number taken on
    // the other side of a wait is a number that can be argued with, and this
    // one is the denominator of every prediction below.
    const read = renderer.drawingBuffer();
    // THE SECOND HALF OF THE VERDICT, and the handle outranks it: a page opened
    // at a pinned framing is a page whose framing nobody may decide, so what is
    // stored is the tier alone and the pin is not written into the deposit
    // (`?inquadratura=0.6` must not be what a visitor finds on their next visit
    // through the front door).
    const framing = PINNED === null
      ? decideFraming(verdict, {
        width: window.innerWidth,
        height: window.innerHeight,
        ratio: deviceRatio(),
        benchPixels: read.width * read.height,
      })
      : null;
    // AND WHETHER THE SKY AROUND IT TURNS, on the same one reading. The handle
    // outranks this too: a page opened at `?notte=` is a page whose night
    // nobody may decide.
    const turning = NIGHT_CHOICE === null
      ? decideNight(verdict, read.width * read.height)
      : null;
    if (turning !== null) nightTurning = turning === 'animata';
    if (framing) setFraction(framing.fraction);
    // The framing may not have moved -- a machine fast enough keeps the whole
    // window -- and the night's verdict still has to reach whatever is up.
    applyNight(document.body.classList.contains('is-inquadrata'));
    quality.setBenchmark(framing ? framing.tier : tier, verdict.medianMs, {
      // THE WINDOW AND NOT THE BUFFER: see the note over PIXEL_TOLERANCE in
      // src/core/quality.js. It is read after the framing has been applied on
      // purpose — the window is the one thing the framing did not change.
      pixels: windowPixels(),
      fraction: framing ? framing.fraction : null,
      notte: turning,
    });
    if (import.meta.env.DEV) {
      console.info(`calibrazione: ${framing ? framing.tier : tier}, `
        + `${verdict.medianMs.toFixed(2)} ms mediana su ${verdict.frames} frame (${verdict.source})`
        + (framing
          ? `, inquadratura ${framing.fraction} (${framing.frame.width}x${framing.frame.height}, `
            + `${framing.predictedMs.toFixed(2)} ms previsti, ${framing.reason})`
          : `, inquadratura inchiodata a ${fraction}`)
        + `, notte ${turning ?? NIGHT_CHOICE}`);
    }
  });
}

/**
 * Cuts the writing into the six faces.
 *
 * It happens after the first walkable frame and one block at a time, with the
 * frame given back in between: laying out six faces of type is tens of
 * milliseconds of work on the main thread, and the walker is already moving.
 *
 * The section files are asked for one at a time rather than all at once, and
 * nearest block first. The writing is part of the reference framing and cannot
 * wait for somebody to walk up to a stone, but six requests fired together on a
 * slow line delay the one face the walker is looking at.
 */
function engraveAll() {
  const distanceFrom = (m) => Math.hypot(
    m.position.x - POSE_TARGET.position.x, m.position.z - POSE_TARGET.position.z,
  );
  const order = [...MONOLITHS].sort((a, b) => distanceFrom(a) - distanceFrom(b));
  loadEngravingFont(import.meta.env.BASE_URL)
    .then(async () => {
      let cut = 0;
      for (const monolith of order) {
        const section = await loadSection(monolith.key).catch(() => null);
        if (section) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          hub.setEngraving(monolith.id, engrave(section, monolith, distanceFrom(monolith)));
        }
        // Six notches, whether or not the file answered. What is being counted
        // is faces gone past: a section that is not there is a face this queue
        // is finished with, and a notch withheld would be a bar that never
        // closes because one of six texts is missing.
        introBus?.report('engrave', ++cut / order.length);
      }
    })
    .catch((error) => {
      // Same reasoning as the notches themselves: a font that did not come down
      // means no face is going to be cut, and a phase that cannot finish must
      // not be the thing holding the way into the world shut.
      introBus?.report('engrave', 1);
      console.warn('engraving not cut:', error.message);
    });
}

// The grade is a few tens of kilobytes and only changes how the frame looks, so
// it is never allowed to hold up the first frame.
loadLut(`${import.meta.env.BASE_URL}assets/grade-lut.png`)
  .then((lut) => renderer.post.setLut(lut))
  .catch((error) => console.warn('grade not applied:', error.message));

// Dev only, and stripped from the product build: import.meta.env.DEV folds to
// false there, so the branch and the module it pulls never reach the bundle.
if (import.meta.env.DEV && isDevMode()) {
  // Handle for the comparison harness: it has to place the camera on a named
  // pose exactly, and read back what the frame was actually built from.
  window.farfield = {
    scene, camera, player, renderer, assets, hub, hud, overlay, interaction,
    quality, bench, calibrate, presence, veil, input, audio, reticle, eye,
    // IL SEGGIO DEL CRONOMETRO, che e' come il banco legge la tabella dei passi
    // senza passare per il riquadro. La funzione e non la lettura, per la stessa
    // ragione scritta dove il riquadro la riceve.
    steps: readSteps,
  };

  loadAllSections().then((sections) => {
    for (const section of sections) {
      const pending = pendingEntries(section);
      console.info(`${section.id} ${section.chiave}: ${Math.round(section.copertura * 100)}% coperto, ${pending.length} voci in attesa`);
    }
  });

  // IL CONTO DELLE CHIAMATE AL DRIVER, dietro una maniglia sua (`?dev&gl`) e
  // non dentro `?dev`. L'avvolgimento del contesto costa, e una misura del
  // TEMPO presa con questo acceso misurerebbe l'avvolgimento; quel che si legge
  // di qui sono numeri di chiamate, che sono gli stessi con o senza. Il
  // contesto si riprende dalla tela e non dal renderer perche' `getContext` con
  // lo stesso nome torna quello che c'e' gia': e' lo stesso oggetto che three
  // sta usando, non un secondo.
  import('./dev/glcount.js').then(({ countGlCalls, isGlCountEnabled }) => {
    if (!isGlCountEnabled()) return;
    glCounter = countGlCalls(canvas.getContext('webgl2'));
    window.farfield.gl = glCounter;
  });

  import('./dev/baketest.js').then(async ({ isBakeTestEnabled, mountBakeTest }) => {
    if (!isBakeTestEnabled()) return;
    const test = await mountBakeTest(scene, assets);
    console.info(`bake test: ${test.lightMaps} lightmap(s) in ${test.elapsedMs.toFixed(0)} ms`);
  });
}

// What counts as having taken the first step, in metres a second. Not the key
// going down: a walker who taps a key and thinks better of it has not left, and
// the body takes a tenth of a second to get to here anyway, which is exactly the
// moment the walk is real.
const FIRST_STEP_SPEED = 0.3;

/**
 * The window changed shape, and the framing keeps its FRACTION of it.
 *
 * Not its pixels: a walker who drags the window wider gets a wider picture in
 * the same proportion of glass, which is what a fraction of the side means and
 * what keeps the night around it the same band it was. The two ceilings and the
 * floor are re-read on the new window, so an ultrawide dragged out past sixteen
 * ninths, or a window thrown onto a 4K panel, is contained the moment it
 * happens rather than at the next visit.
 */
function resize() {
  const frame = applyFraming();
  const { aspect } = renderer.resize(frame.width, frame.height);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  applyNight(frame.framed);
}
window.addEventListener('resize', resize);
resize();

new Loop()
  .add((delta, now) => {
    const started = performance.now();
    // OGNI SEZIONE DEL GIRO SI DICHIARA, e fuori da `?dev` ogni `mark` e' un
    // ritorno su un booleano: vedi src/core/steps.js.
    beginFrame(started);
    mark('banco');
    // The calibration turns the eye itself and the walker has not been given
    // the world yet, so for those three seconds the body takes no orders.
    if (bench.active) {
      if (input.engaged) bench.stop();
      else bench.step(delta, freshCostMs, player);
    }
    mark('corpo');
    // A room being read is a walker standing still: the world behind it stays
    // visible, and a body drifting off under an open page is a body that
    // arrives somewhere nobody chose.
    const held = menuOpen() || interaction.holdsPointer || bench.active;
    // The lean of the lens, and what it costs the mouse. It is asked for here
    // rather than read inside the body because only here is it known whether
    // the walker is in a meadow or in front of an open page: inside a panel or
    // a room the ask is withdrawn, and the same curve takes the frame back out.
    presence.setZoom(input.zooming && !held && input.locked
      && (interaction.state === 'mondo' || interaction.state === 'vicino'));
    presence.setInteraction(interaction.state);
    player.setLookScale(presence.lookScale);
    player.update(delta, held ? IDLE_INPUT : input);
    player.applyTo(camera);
    // The arrival composition is over the moment the walker walks out of it.
    if (player.speed > FIRST_STEP_SPEED) veil.firstStep();
    mark('concetto');
    // After the body, never instead of it: the lean towards an opened face is a
    // move of the eye, and the walker keeps every key while it is held.
    interaction.update(delta, player.position);
    interaction.applyCamera(camera);
    mark('presenza');
    // And the body itself last of all, on top of wherever the eye ended up:
    // nothing downstream of here has to know that the point it is drawing from
    // belongs to somebody standing.
    presence.update(delta, player.motionInto(motion));
    presence.applyTo(camera);
    mark('occhio');
    // And the eye over the body, once the camera has stopped moving for this
    // frame. What it accommodates to is read out of the depth buffer on the
    // GPU; what it takes from here is the face the interaction is offering —
    // how far it is AND where it is, because the eye has to be able to ask
    // whether the walker is looking at it or merely standing beside it.
    eye.update(delta, presence.state, interaction.targetMetres, camera,
      interaction.targetPoint);
    eye.applyTo(renderer.post);
    // And, for three and a half seconds of one visit in a life, the eyes the
    // walker is opening. A separate channel from the eye above and written by
    // nobody else: the scene turns itself off at the end of its own timeline
    // and puts the frame back to exactly what it was.
    if (intro) intro.drive(renderer.post, now);
    // And after the body, what the body can hear: the feet it just reported,
    // and nothing else that depends on where it is standing. There was water
    // here once, with a level set by the distance to it and a side set by the
    // way the head was pointing; the committente ruled on 2026-08-20 that the
    // pale stretch down the path is light on stone, and the whole bus went out
    // with it. The camera and the position are passed and no longer read — see
    // the note over update() in src/core/audio.js for why the signature is left
    // as wide as it is rather than narrowed from this side.
    mark('audio');
    audio.update(delta, presence.state, camera, player.position);
    mark('interfaccia');
    hud.setHeading(player.yawDegrees);
    // The mark in the middle of the frame, told what is within reach and
    // whether anything else has the mouse. It reads the motion the body was
    // just given, which is where the placed poses it has to stay out of are.
    reticle.update(motion, interaction.state, menuOpen() || overlay.visible);
    // And «Indietro», which is the Esc of a hand with no keys. One string
    // compared against the last one, and nothing at all outside the mode.
    touch?.update(interaction.state);
    worldSeconds = now / 1000;
    mark('mondo');
    hub.update(worldSeconds, player.position, delta, player.pitchDegrees);
    mark('consegna');
    renderer.render(scene, camera);

    mark('governatore');
    // What that frame cost, by the driver's clock where there is one and by the
    // interval between callbacks where there is not.
    const timings = renderer.timings();
    // A reading the driver has not answered yet is not a reading: counting the
    // last one twice would weight whatever the queue happened to be doing.
    freshCostMs = renderer.hasGpuClock ? (timings ? timings.total : 0) : delta * 1000;
    if (freshCostMs > 0) lastCostMs = freshCostMs;
    if (timings) lastTimings = timings;
    // Riempito e non costruito, per la ragione scritta sopra FRAME in
    // src/world/hub.js: il governatore lo legge e lo lascia cadere.
    motionOut.lookRate = player.lookRate;
    motionOut.speed = player.speed;
    quality.sample(freshCostMs, motionOut);

    // IL PASSO DELLA CPU SI CHIUDE QUI, PRIMA DEL RIQUADRO. Quel che il
    // riquadro costa e' un costo dello sviluppo e non del mondo, e sommarlo
    // sarebbe misurare lo strumento insieme alla cosa.
    const cpuMs = performance.now() - started;
    if (dev) {
      mark('riquadro');
      const buffer = renderer.post.quality;
      dev.update(delta, now, renderer.stats(), {
        cpuMs,
        // La funzione e non la lettura: il riquadro si ridipinge cinque volte
        // al secondo e chiamarla a ogni fotogramma sarebbe allocare cinquanta
        // volte per ogni volta che qualcuno guarda.
        passi: readSteps,
        position: `${player.position.x.toFixed(1)} ${player.position.z.toFixed(1)}`,
        speed: `${player.speed.toFixed(2)} m/s`,
        buffer: buffer ? `${buffer.format} x${buffer.samples}` : '',
        gpuMs: lastCostMs,
        quality,
        renderer,
        stages: lastTimings,
        grass: hub.vegetationStats(),
      });
      if (glCounter) glCounter.frame();
    }
    endFrame();
  })
  .start();
