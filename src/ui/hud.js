// The head-up display of the hub: the greeting, the interaction prompt, the
// compass and the command line. It is plain DOM on top of the canvas, which
// costs the GPU nothing and is the only version of this text a reader without
// WebGL will ever get.

import { isClockFrozen } from './devhud.js';
import { createMenu } from './menu.js';

// Below this the ring would be turning by less than the width of its own
// stroke, so redrawing it is work nobody can see.
const HEADING_EPSILON = 0.12;

function keycap(label) {
  const el = document.createElement('kbd');
  el.className = 'keycap';
  el.textContent = label;
  return el;
}

function hintRow(keys, label) {
  const row = document.createElement('li');
  row.className = 'hud-hint';
  const caps = document.createElement('span');
  caps.className = 'hud-hint-keys';
  for (const key of keys) caps.appendChild(keycap(key));
  const text = document.createElement('span');
  text.className = 'hud-hint-label';
  text.textContent = label;
  row.append(caps, text);
  return row;
}

/**
 * A row of the greeting for a hand that has no keys.
 *
 * The caps are the only thing that changes: the gesture stands where the keys
 * stood, in the same box, at the same pitch, so the block keeps the shape the
 * reference framing drew for it.
 */
function gestureRow(gesture, label) {
  const row = document.createElement('li');
  row.className = 'hud-hint';
  const said = document.createElement('span');
  said.className = 'hud-hint-gesture';
  said.textContent = gesture;
  const text = document.createElement('span');
  text.className = 'hud-hint-label';
  text.textContent = label;
  row.append(said, text);
  return row;
}

function welcome(touch) {
  const el = document.createElement('aside');
  el.className = 'hud-welcome';
  el.setAttribute('aria-label', 'Introduzione');
  // Set in lower case and capitalised by the sheet: read aloud, "Benvenuto" is
  // a word and "BENVENUTO" is nine letters.
  el.innerHTML = `
    <h1 class="hud-title">Benvenuto</h1>
    <span class="hud-rule" aria-hidden="true"></span>
    <p class="hud-lead">Ogni monolite rappresenta<br />una parte di me.<br />Esplora, scopri, interagisci.</p>
    <span class="hud-diamond" aria-hidden="true"></span>
    <ul class="hud-hints"></ul>
  `;
  const hints = el.querySelector('.hud-hints');
  if (touch) {
    hints.append(
      gestureRow('Pollice a sinistra', 'per camminare'),
      gestureRow('Trascina a destra', 'per guardarti intorno'),
      gestureRow('Tocca', 'per interagire'),
    );
  } else {
    hints.append(hintRow(['W', 'A', 'S', 'D'], 'per muoverti'), hintRow(['E'], 'per interagire'));
  }
  return el;
}

/**
 * The offer at the foot of the frame.
 *
 * WITH A MOUSE IT IS A NOTICE: the cap says E, and what acts is the keyboard.
 * WITH FINGERS IT IS THE BUTTON ITSELF (E-DECISIONI27) — there is no E to
 * press, so the notice has to be the thing you press. It becomes a real button
 * with the rhombus of the world's own markers where the cap was, and it keeps
 * the position, the wording and the fade it always had.
 */
function interact(touch) {
  const el = document.createElement(touch ? 'button' : 'div');
  el.className = 'hud-interact';
  if (touch) {
    el.type = 'button';
    el.classList.add('is-touch');
    // A button is announced as one; what changes inside it still has to be read
    // out, and `status` is not a thing you can also press.
    el.setAttribute('aria-live', 'polite');
  } else {
    el.setAttribute('role', 'status');
  }
  const sign = touch ? document.createElement('span') : keycap('E');
  if (touch) {
    sign.className = 'hud-interact-mark';
    sign.setAttribute('aria-hidden', 'true');
  }
  const label = document.createElement('span');
  label.className = 'hud-interact-label';
  label.textContent = 'Interagisci';
  el.append(sign, label);
  return { el, label };
}

// The ring, the letter and the outer arc all belong to the bezel and turn
// together; the wedge and the arrow are the walker and never move. Splitting
// them this way means a change of heading is one transform on one element.
const COMPASS_SVG = `
  <svg class="hud-compass-fixed" viewBox="0 0 192 192" aria-hidden="true" focusable="false">
    <defs>
      <!-- Anchored to the centre of the dial, not to the box of the wedge:
           the light has to come from where the walker is standing. -->
      <radialGradient id="ff-cone" gradientUnits="userSpaceOnUse" cx="96" cy="96" r="85">
        <stop offset="0%" stop-color="#dff2ff" stop-opacity="0.22" />
        <stop offset="30%" stop-color="#cfe9fb" stop-opacity="0.10" />
        <stop offset="70%" stop-color="#cfe9fb" stop-opacity="0.035" />
        <stop offset="100%" stop-color="#cfe9fb" stop-opacity="0" />
      </radialGradient>
    </defs>
    <path class="hud-compass-cone" d="M96 96 L53.5 22.4 A85 85 0 0 1 138.5 22.4 Z" fill="url(#ff-cone)" />
    <path class="hud-compass-needle" d="M96 87.5 L102 101.5 L96 97 L90 101.5 Z" />
  </svg>
  <div class="hud-compass-ring">
    <svg viewBox="0 0 192 192" aria-hidden="true" focusable="false">
      <circle class="hud-compass-rim" cx="96" cy="96" r="85" />
      <path class="hud-compass-arc" d="M6.06 92.86 A90 90 0 0 1 60.83 13.15" />
      <g class="hud-compass-ticks">
        <path d="M181 96 h-5" /><path d="M96 181 v-5" /><path d="M11 96 h5" />
      </g>
    </svg>
    <span class="hud-compass-n">N</span>
  </div>
`;

function compass() {
  const el = document.createElement('div');
  el.className = 'hud-compass';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Bussola: nord');
  el.innerHTML = COMPASS_SVG;
  return el;
}

function commandButton(label, key) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hud-command';
  const text = document.createElement('span');
  text.className = 'hud-command-label';
  text.textContent = label;
  button.append(keycap(key), text);
  return button;
}

const HEADINGS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ovest', 'ovest', 'nord-ovest'];

export function createHud(root, options = {}) {
  const touch = Boolean(options.touch);
  const welcomeEl = welcome(touch);
  const prompt = interact(touch);
  if (touch) prompt.el.addEventListener('click', () => options.onInteract?.());
  const compassEl = compass();
  const ring = compassEl.querySelector('.hud-compass-ring');

  const footer = document.createElement('nav');
  footer.className = 'hud-footer';
  footer.setAttribute('aria-label', 'Comandi');
  const menuButton = commandButton('Menu', 'TAB');
  const mapButton = commandButton('Mappa', 'M');
  // The map is not built yet. The key is shown because the reference shows it,
  // and the button says so rather than doing nothing silently.
  mapButton.disabled = true;
  mapButton.title = 'La mappa arriva più avanti';
  footer.append(menuButton, mapButton);

  const menu = createMenu(root, options);
  menuButton.addEventListener('click', () => menu.toggle());

  root.append(welcomeEl, prompt.el, compassEl, footer);

  // AND THEN THEY ARRIVE.
  //
  // The greeting, the dial and the command line used to be stamped onto the
  // first frame at full strength. They come up instead, over the same curve and
  // in the same second as the way in, so that what a walker meets is one thing
  // beginning rather than three appearing. The sheet holds the length; all this
  // does is let the browser see the transparent state first, with a layout read
  // rather than a frame's wait, because during an arrival a frame can be two
  // seconds long.
  //
  // A HELD CLOCK IS A HELD ARRIVAL, exactly as in src/ui/veil.js: with ?dev&t0
  // the one instant the reference was measured at has to be photographable as
  // many times as a comparison needs, and an interface that is still fading in
  // is a reading of it that depends on when the shutter opened. So under a held
  // clock the interface is simply there.
  // AND WHEN "THEN" IS, IS NOT ALWAYS NOW.
  //
  // On an ordinary visit the display arrives with the world, one flush after it
  // is in the page, and that is what every line above is about. But when the
  // opening scene is up, the world behind it is already standing long before
  // anybody has seen it: the greeting would come up, finish arriving and sit
  // there fully lit under a night sky, so that the instant the eyes opened it
  // would be STAMPED on the first frame — the very thing this fade exists to
  // avoid, moved somewhere it cannot be seen happening.
  //
  // So `defer` holds it, and only `defer`: nothing about the frozen clock or
  // about an ordinary visit is touched, because with the scene off — which is
  // every measured session and all of ?dev — this option is never passed and
  // the two branches below are the two branches that were always here. Whoever
  // asks for it owes the display an arrive() (src/main.js, at the end of the
  // waking), and the scene's own failure path owes it one too.
  const raise = () => {
    for (const el of [welcomeEl, compassEl, footer]) el.classList.add('is-up');
  };
  if (isClockFrozen()) {
    for (const el of [welcomeEl, compassEl, footer]) el.style.transition = 'none';
    raise();
  } else if (!options.defer) {
    void welcomeEl.offsetWidth;
    raise();
  }

  let headingDeg = 0;
  let drawnDeg = null;
  // Quale degli otto nomi la bussola dice adesso: vedi setHeading.
  let drawnHeading = null;

  return {
    menu,

    /**
     * Lets the display come up, for a caller that asked to hold it back.
     *
     * Idempotent and harmless without `defer`: on an ordinary visit the class
     * is already on and adding it again changes nothing. The flush is the same
     * one the constructor makes — the browser has to have seen the transparent
     * state, and a read is a synchronous look where waiting for a frame is not,
     * which during an arrival is the difference between a fade and a stamp.
     */
    arrive() {
      void welcomeEl.offsetWidth;
      raise();
    },

    /**
     * Turns the bezel so that N sits where north actually is.
     *
     * Yaw is measured from north and grows anticlockwise seen from above, which
     * is the same sense a compass rose has to turn on screen, so the rotation is
     * the yaw itself.
     */
    setHeading(yawDegrees) {
      headingDeg = yawDegrees;
      if (drawnDeg !== null && Math.abs(headingDeg - drawnDeg) < HEADING_EPSILON) return;
      drawnDeg = headingDeg;
      ring.style.transform = `rotate(${headingDeg.toFixed(2)}deg)`;
      // E IL NOME DELLA DIREZIONE SI SCRIVE QUANDO IL NOME CAMBIA, CHE NON E'
      // QUANDO CAMBIA L'ANGOLO (U-PERF-7, E-LINUX1).
      //
      // Il quadrante gira a ogni dodicesimo di grado, che e' la soglia sopra --
      // giusta, perche' e' un `transform` e lo muove il compositore. Il nome ne
      // ha otto in tutto il giro e cambia ogni quarantacinque gradi: scritto
      // sulla stessa soglia, `setAttribute` partiva TRECENTOSETTANTACINQUE
      // volte per ogni volta che aveva qualcosa di nuovo da dire, e non e' una
      // scrittura da compositore -- e' l'albero di accessibilita' che si
      // invalida, su un elemento con un `role`. Piu' la stringa che si costruiva
      // per arrivarci.
      const bearing = ((-headingDeg % 360) + 360) % 360;
      const named = Math.round(bearing / 45) % 8;
      if (named === drawnHeading) return;
      drawnHeading = named;
      compassEl.setAttribute('aria-label', `Bussola: ${HEADINGS[named]}`);
    },

    /** Shows or hides the prompt that says the key in front of you does something. */
    showInteract(visible, label = 'Interagisci') {
      prompt.label.textContent = label;
      prompt.el.classList.toggle('is-on', visible !== false);
    },

    /** Hides the whole display, so a captured frame carries only the world. */
    setVisible(visible) {
      root.classList.toggle('is-hidden', !visible);
    },
  };
}
