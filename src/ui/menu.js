// The panel behind TAB. It is deliberately thin: a way out to the readable
// edition of the same material, the list of keys, and the quality setting.

const ITEMS = [
  { id: 'contenuti', label: 'Contenuti (edizione testuale)', note: 'Tutto il materiale, in una pagina da leggere' },
  { id: 'comandi', label: 'Comandi', note: 'Tasti e movimento' },
  { id: 'qualita', label: 'Qualità', note: 'Regolata sulla macchina' },
  { id: 'movimento', label: 'Riduci movimento', note: 'Respiro e passo della camera' },
  { id: 'suono', label: 'Suoni del mondo', note: 'Passi e aria' },
  { id: 'musica', label: 'Musica', note: 'Rada, e presente' },
];

// Auto first and named as what it is. A walker who picks one of the other three
// is telling the world to stop deciding, and it stops: the governor only ever
// moves a tier nobody has asked for by hand.
const QUALITY_CHOICES = [
  ['auto', 'Auto'],
  ['alta', 'Alta'],
  ['media', 'Media'],
  ['bassa', 'Bassa'],
];

// The same three-way shape, for the same reason: a walker who has said anything
// at all has stopped the world deciding for them. Auto here is the machine's own
// accessibility setting, which is where the answer should come from when nobody
// has said otherwise.
const MOTION_CHOICES = [
  ['auto', 'Auto'],
  ['si', 'Sì'],
  ['no', 'No'],
];

// Loudness as a row of names rather than as a slider, so that the one control
// carries both questions the sound has — whether it is on, and how much of it
// there is — in the shape every other setting in this panel already has. The
// two rows are separate because the brief is that the melody can be sent away
// without taking the world's own sound with it.
const SOUND_CHOICES = [
  ['muto', 'Muto'],
  ['basso', 'Basso'],
  ['medio', 'Medio'],
  ['alto', 'Alto'],
];

const CHOICE_ROW_STYLE = 'display:flex;gap:0.375rem;padding:0 0 0.75rem 0.125rem;';
const CHOICE_STYLE = [
  'padding:0.3rem 0.75rem',
  'border:1px solid var(--ui-line)',
  'background:transparent',
  'font:inherit',
  'font-size:0.78rem',
  'letter-spacing:0.14em',
  'text-transform:uppercase',
  'color:var(--ui-ink-soft)',
  'cursor:pointer',
].join(';');

function choiceRow(list, onChoose) {
  const row = document.createElement('div');
  row.setAttribute('style', CHOICE_ROW_STYLE);
  const buttons = new Map();
  for (const [id, label] of list) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('style', CHOICE_STYLE);
    button.setAttribute('aria-pressed', 'false');
    button.textContent = label;
    button.addEventListener('click', () => onChoose?.(id));
    buttons.set(id, button);
    row.appendChild(button);
  }
  return { row, buttons };
}

/** Which of a row of choices is the one in force. */
function mark(buttons, choice) {
  for (const [id, button] of buttons) {
    const on = id === choice;
    button.setAttribute('aria-pressed', String(on));
    button.style.color = on ? 'var(--ui-mark)' : 'var(--ui-ink-soft)';
    button.style.borderColor = on ? 'var(--ui-line-strong)' : 'var(--ui-line)';
  }
}

const CONTROLS = [
  ['W A S D', 'muoversi'],
  ['Shift', 'correre'],
  ['Mouse', 'guardarsi intorno'],
  ['E', 'aprire il monolite vicino, poi la voce scelta'],
  ['W S', 'scorrere le voci a pannelli aperti'],
  ['Esc', 'tornare indietro di un passo'],
  ['TAB', 'aprire e chiudere questo menu'],
];

function controlList() {
  const list = document.createElement('dl');
  list.className = 'menu-controls';
  for (const [keys, what] of CONTROLS) {
    const term = document.createElement('dt');
    for (const key of keys.split(' ')) {
      const cap = document.createElement('kbd');
      cap.className = 'keycap';
      cap.textContent = key;
      term.appendChild(cap);
    }
    const desc = document.createElement('dd');
    desc.textContent = what;
    list.append(term, desc);
  }
  return list;
}

/**
 * Builds the menu and returns its handle.
 *
 * `onOpen` and `onClose` are where the caller hands the mouse back and takes it
 * again: the panel has to be clickable, and it cannot be while the pointer is
 * captured by the canvas.
 */
export function createMenu(root, {
  contentUrl = 'cv/', onOpen, onClose, quality = {}, motion = {}, sound = {}, music = {},
} = {}) {
  const el = document.createElement('div');
  el.className = 'menu';
  el.hidden = true;
  // How long the panel takes to arrive and to leave. Held here rather than left
  // to the sheet alone so that the clock which puts `hidden` back — and with it
  // the scrim and the blur over the whole world — cannot end before the fade
  // the walker is still watching. A machine that has asked for no motion gets
  // the same panel in a fifth of the time rather than in no time at all.
  const fadeMs = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 160 : 560;
  el.style.setProperty('--menu-fade', `${fadeMs}ms`);
  let putAway = null;

  const panel = document.createElement('div');
  panel.className = 'menu-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Menu');

  const title = document.createElement('h2');
  title.className = 'menu-title';
  title.textContent = 'Menu';
  panel.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'menu-items';
  let controls = null;
  let choices = null;
  let qualityLabel = null;
  let qualityNote = null;
  let motionChoices = null;
  let motionNote = null;
  let soundChoices = null;
  let soundNote = null;
  let musicChoices = null;
  let musicNote = null;

  for (const item of ITEMS) {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'menu-item-label';
    label.textContent = item.label;
    const note = document.createElement('span');
    note.className = 'menu-item-note';
    note.textContent = item.note;

    if (item.id === 'qualita') {
      qualityLabel = label;
      qualityNote = note;
      const head = document.createElement('div');
      head.className = 'menu-item';
      head.append(label, note);
      choices = choiceRow(QUALITY_CHOICES, quality.onChoose);
      row.append(head, choices.row);
      list.appendChild(row);
      continue;
    }

    if (item.id === 'movimento') {
      motionNote = note;
      const head = document.createElement('div');
      head.className = 'menu-item';
      head.append(label, note);
      motionChoices = choiceRow(MOTION_CHOICES, motion.onChoose);
      row.append(head, motionChoices.row);
      list.appendChild(row);
      continue;
    }

    if (item.id === 'suono' || item.id === 'musica') {
      const head = document.createElement('div');
      head.className = 'menu-item';
      head.append(label, note);
      const world = item.id === 'suono';
      const choice = choiceRow(SOUND_CHOICES, (world ? sound : music).onChoose);
      if (world) { soundChoices = choice; soundNote = note; } else { musicChoices = choice; musicNote = note; }
      row.append(head, choice.row);
      list.appendChild(row);
      continue;
    }

    if (item.id === 'contenuti') {
      const link = document.createElement('a');
      link.className = 'menu-item';
      link.href = contentUrl;
      link.append(label, note);
      row.appendChild(link);
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'menu-item';
      button.disabled = Boolean(item.disabled);
      button.append(label, note);
      if (item.id === 'comandi') {
        button.setAttribute('aria-expanded', 'false');
        button.addEventListener('click', () => {
          const open = button.getAttribute('aria-expanded') === 'true';
          button.setAttribute('aria-expanded', String(!open));
          controls.hidden = open;
        });
      }
      row.appendChild(button);
    }
    list.appendChild(row);

    if (item.id === 'comandi') {
      controls = controlList();
      controls.hidden = true;
      row.appendChild(controls);
    }
  }

  const hint = document.createElement('p');
  hint.className = 'menu-hint';
  hint.textContent = 'TAB o Esc per tornare al mondo';

  panel.append(list, hint);
  el.appendChild(panel);
  root.appendChild(el);

  let open = false;
  let restore = null;

  const api = {
    get isOpen() { return open; },

    /**
     * What quality is set to now, and what that actually amounts to.
     *
     * The two are not the same thing: on Auto the note is the tier the machine
     * was measured into, which is the only way the walker gets to see what the
     * calibration decided about them.
     */
    setQuality(choice, tierLabel) {
      if (!choices) return;
      mark(choices.buttons, choice);
      qualityLabel.textContent = choice === 'auto' ? `Qualità: Auto (${tierLabel})` : `Qualità: ${tierLabel}`;
      qualityNote.textContent = choice === 'auto'
        ? 'Regolata sulla macchina' : 'Scelta a mano';
    },

    /**
     * What the camera's own movement is set to, and what that amounts to.
     *
     * Same shape as the quality note above and for the same reason: on Auto the
     * walker gets to see what their machine asked for on their behalf.
     */
    setMotion(choice, reduced) {
      if (!motionChoices) return;
      mark(motionChoices.buttons, choice);
      if (choice === 'auto') {
        motionNote.textContent = reduced
          ? 'Dal sistema: movimento ridotto' : 'Dal sistema: movimento normale';
      } else {
        motionNote.textContent = reduced
          ? 'Respiro e passo al minimo' : 'Respiro e passo della camera';
      }
    },

    /**
     * How loud the world's own sound is, and what that amounts to.
     *
     * `available` is false where the machine cannot decode the package at all:
     * the row is then shown disabled rather than removed, because a control
     * that vanishes reads as a bug and one that says why does not.
     */
    setSound(choice, available = true) {
      if (!soundChoices) return;
      mark(soundChoices.buttons, choice);
      if (!available) {
        soundNote.textContent = 'Non disponibile su questo browser';
        for (const button of soundChoices.buttons.values()) button.disabled = true;
        return;
      }
      soundNote.textContent = choice === 'muto' ? 'Silenzio' : 'Passi e aria';
    },

    /** And the melody, which is asked for and turned away on its own. */
    setMusic(choice, available = true) {
      if (!musicChoices) return;
      mark(musicChoices.buttons, choice);
      if (!available) {
        musicNote.textContent = 'Non disponibile su questo browser';
        for (const button of musicChoices.buttons.values()) button.disabled = true;
        return;
      }
      musicNote.textContent = choice === 'muto' ? 'Silenzio' : 'Rada, e presente';
    },

    setOpen(next) {
      if (next === open) return;
      open = next;
      if (putAway) { clearTimeout(putAway); putAway = null; }
      if (open) {
        el.hidden = false;
        // The transparent state has to have been seen before the lit one is
        // asked for, or there is nothing to interpolate between and the panel
        // simply appears. A layout read flushes it synchronously, which a
        // frame's wait would not: a frame here can be a long time.
        void el.offsetWidth;
        el.classList.add('is-open');
        restore = document.activeElement;
        onOpen?.();
        panel.querySelector('.menu-item')?.focus();
      } else {
        el.classList.remove('is-open');
        // Out of the box tree once there is nothing left to see of it, and not
        // before: a panel that stops being generated stops fading.
        putAway = setTimeout(() => { el.hidden = true; putAway = null; }, fadeMs);
        onClose?.();
        if (restore instanceof HTMLElement) restore.focus();
        restore = null;
      }
    },

    toggle() { api.setOpen(!open); },
  };

  // Clicking away from the panel is the same as asking to go back to the world.
  el.addEventListener('mousedown', (event) => {
    if (event.target === el) api.setOpen(false);
  });

  return api;
}
