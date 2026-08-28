import './room.css';
import { PENDING } from '../core/content.js';

// The room of one entry.
//
// It is a page laid over the world rather than a place the camera travels to:
// the hub stays visible and softly out of focus behind it, so the walker never
// loses where they were standing. Everything on it is real DOM — it reads with
// a screen reader, it works from the keyboard alone, and it costs the GPU
// nothing while the frame behind it keeps drawing.
//
// The written material comes from content/*.json and is never composed here.
// An entry the owner of the content has still to settle carries "stato":
// "in_attesa_committente"; its provisional text is shown as it stands, marked,
// and nothing is written in its place.

const CLOSE_MS = 250;
const BADGE = 'in aggiornamento';
const EMPTY = 'Contenuto in aggiornamento.';

// ------------------------------------------------------------------ markdown

// Bold, italic, and code, in one pass. The alternatives are ordered so the two
// star forms cannot be confused: the double one has to be tried first.
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;

/**
 * Writes one line of markdown into an element.
 *
 * Every piece is appended as a text node inside an element built by hand, so
 * there is no path by which a string out of a content file can become markup.
 */
function inline(source, parent) {
  for (const piece of String(source).split(INLINE)) {
    if (!piece) continue;
    if (piece.startsWith('**') && piece.endsWith('**')) {
      const el = document.createElement('strong');
      el.textContent = piece.slice(2, -2);
      parent.appendChild(el);
    } else if (piece.startsWith('__') && piece.endsWith('__')) {
      const el = document.createElement('strong');
      el.textContent = piece.slice(2, -2);
      parent.appendChild(el);
    } else if ((piece.startsWith('*') && piece.endsWith('*'))
      || (piece.startsWith('_') && piece.endsWith('_'))) {
      const el = document.createElement('em');
      el.textContent = piece.slice(1, -1);
      parent.appendChild(el);
    } else if (piece.startsWith('`') && piece.endsWith('`')) {
      const el = document.createElement('code');
      el.textContent = piece.slice(1, -1);
      parent.appendChild(el);
    } else {
      parent.appendChild(document.createTextNode(piece));
    }
  }
  return parent;
}

/**
 * Headings, paragraphs, lists and the inline forms above. Nothing else.
 *
 * The detail fields in the content files are written in that much markdown and
 * no more, and a reader small enough to keep in one's head is worth more here
 * than a dependency that can render anything.
 */
export function renderMarkdown(source) {
  const fragment = document.createDocumentFragment();
  const lines = String(source ?? '').split('\n');
  let paragraph = [];
  let list = null;

  const closeParagraph = () => {
    if (!paragraph.length) return;
    inline(paragraph.join(' '), fragment.appendChild(document.createElement('p')));
    paragraph = [];
  };
  const closeList = () => { list = null; };

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      closeParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      inline(heading[2], fragment.appendChild(
        document.createElement(`h${heading[1].length + 3}`),
      ));
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      closeParagraph();
      const wanted = bullet ? 'UL' : 'OL';
      if (!list || list.tagName !== wanted) {
        list = fragment.appendChild(document.createElement(wanted.toLowerCase()));
      }
      inline((bullet || numbered)[1], list.appendChild(document.createElement('li')));
      continue;
    }

    closeList();
    paragraph.push(line);
  }

  closeParagraph();
  return fragment;
}

// ---------------------------------------------------------------------- room

const isPending = (entry) => entry && entry.stato === PENDING;

function metaLine(entry) {
  return [entry.periodo, entry.sottotitolo].filter(Boolean).join(' · ');
}

function badge() {
  const el = document.createElement('span');
  el.className = 'room-badge';
  el.textContent = BADGE;
  return el;
}

function chips(list) {
  const ul = document.createElement('ul');
  ul.className = 'room-chips';
  ul.setAttribute('aria-label', 'Tecnologie');
  for (const name of list) {
    const li = document.createElement('li');
    li.textContent = name;
    ul.appendChild(li);
  }
  return ul;
}

/**
 * Builds the room and returns its handle.
 *
 * `onClose` is where the caller takes the mouse back and returns to the panels;
 * it is handed the entry the walker was reading, so walking out of the room
 * leaves the list on the same line it was left on.
 */
export function createRoom(root, { onClose } = {}) {
  const el = document.createElement('div');
  el.className = 'room';
  el.hidden = true;

  const shell = document.createElement('div');
  shell.className = 'room-shell';
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-modal', 'true');
  shell.setAttribute('aria-labelledby', 'room-title');

  const head = document.createElement('header');
  head.className = 'room-head';
  const index = document.createElement('span');
  index.className = 'room-index';
  const title = document.createElement('h2');
  title.className = 'room-title';
  title.id = 'room-title';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'room-close';
  close.setAttribute('aria-label', 'Chiudi e torna ai pannelli');
  close.innerHTML = '<kbd class="keycap">Esc</kbd><span>Chiudi</span>';
  head.append(index, title, close);

  const body = document.createElement('div');
  body.className = 'room-body';

  const list = document.createElement('div');
  list.className = 'room-list';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-orientation', 'vertical');
  list.setAttribute('aria-label', 'Voci della sezione');

  const detail = document.createElement('article');
  detail.className = 'room-detail';
  detail.id = 'room-detail';
  detail.setAttribute('role', 'tabpanel');
  detail.tabIndex = 0;

  body.append(list, detail);
  shell.append(head, body);
  el.appendChild(shell);
  root.appendChild(el);

  let entries = [];
  let selected = 0;
  let open = false;
  let restore = null;
  let closing = null;

  function tabs() {
    return Array.from(list.querySelectorAll('.room-entry'));
  }

  function paintDetail() {
    const entry = entries[selected];
    detail.replaceChildren();
    detail.scrollTop = 0;
    if (!entry) return;

    const heading = document.createElement('h3');
    heading.className = 'room-detail-title';
    heading.textContent = entry.titolo || '';
    detail.appendChild(heading);

    const meta = metaLine(entry);
    if (meta || isPending(entry)) {
      const line = document.createElement('p');
      line.className = 'room-detail-meta';
      if (meta) line.appendChild(document.createTextNode(meta));
      if (isPending(entry)) line.appendChild(badge());
      detail.appendChild(line);
    }

    let written = false;
    if (entry.riassunto) {
      const lead = document.createElement('p');
      lead.className = 'room-lead';
      lead.textContent = entry.riassunto;
      detail.appendChild(lead);
      written = true;
    }
    if (entry.dettaglio) {
      const prose = document.createElement('div');
      prose.className = 'room-prose';
      prose.appendChild(renderMarkdown(entry.dettaglio));
      detail.appendChild(prose);
      written = true;
    }
    if (Array.isArray(entry.tecnologie) && entry.tecnologie.length) {
      detail.appendChild(chips(entry.tecnologie));
      written = true;
    }
    if (entry.url) {
      const link = document.createElement('a');
      link.className = 'room-link';
      link.href = entry.url;
      link.textContent = entry.sottotitolo || entry.url;
      link.rel = 'noreferrer';
      detail.appendChild(link);
      written = true;
    }
    if (!written) {
      // The entry is one the owner of the content has still to fill in. Saying
      // so is the only thing that may be written here: inventing a paragraph to
      // cover the gap is exactly what the content rule forbids.
      const empty = document.createElement('p');
      empty.className = 'room-empty';
      empty.textContent = EMPTY;
      detail.appendChild(empty);
    }

    const id = tabs()[selected]?.id;
    if (id) detail.setAttribute('aria-labelledby', id);
  }

  function mark(next, moveFocus) {
    const all = tabs();
    if (!all.length) return;
    selected = Math.max(0, Math.min(all.length - 1, next));
    for (let i = 0; i < all.length; i++) {
      const on = i === selected;
      all[i].setAttribute('aria-selected', String(on));
      all[i].tabIndex = on ? 0 : -1;
      all[i].classList.toggle('is-selected', on);
    }
    paintDetail();
    if (moveFocus) all[selected].focus();
    all[selected].scrollIntoView({ block: 'nearest' });
  }

  function fill(section) {
    entries = Array.isArray(section.timeline) ? section.timeline : [];
    index.textContent = section.id || '';
    title.textContent = section.titolo || '';
    list.replaceChildren();

    entries.forEach((entry, i) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'room-entry';
      tab.id = `room-entry-${section.id}-${entry.id || i}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', 'room-detail');
      tab.tabIndex = -1;

      const name = document.createElement('span');
      name.className = 'room-entry-title';
      name.textContent = entry.titolo || '';
      tab.appendChild(name);

      const meta = metaLine(entry);
      if (meta) {
        const line = document.createElement('span');
        line.className = 'room-entry-meta';
        line.textContent = meta;
        tab.appendChild(line);
      }
      if (isPending(entry)) tab.appendChild(badge());

      tab.addEventListener('click', () => mark(i, true));
      list.appendChild(tab);
    });
  }

  function onKey(event) {
    if (!open) return;
    // The world listens on the document and must not hear any of this: a room
    // being read is not a walker pressing keys.
    event.stopPropagation();

    const code = event.code;
    if (code === 'Escape') {
      event.preventDefault();
      api.close();
      return;
    }
    if (code === 'ArrowDown' || code === 'KeyS') {
      event.preventDefault();
      mark(selected + 1, true);
      return;
    }
    if (code === 'ArrowUp' || code === 'KeyW') {
      event.preventDefault();
      mark(selected - 1, true);
      return;
    }
    if (code === 'Home') {
      event.preventDefault();
      mark(0, true);
      return;
    }
    if (code === 'End') {
      event.preventDefault();
      mark(entries.length - 1, true);
      return;
    }
    if (code === 'Tab') {
      // Kept inside the dialog: behind it there is a canvas that captures the
      // mouse, and a focus ring nobody can see is a dead end for a keyboard.
      const stops = [tabs()[selected], detail, close].filter(Boolean);
      const at = stops.indexOf(document.activeElement);
      event.preventDefault();
      const step = event.shiftKey ? -1 : 1;
      const next = at < 0 ? 0 : (at + step + stops.length) % stops.length;
      stops[next].focus();
    }
  }

  close.addEventListener('click', () => api.close());
  el.addEventListener('mousedown', (event) => {
    if (event.target === el) api.close();
  });

  const api = {
    get isOpen() { return open; },
    get selected() { return selected; },

    open(section, at = 0) {
      if (closing) { clearTimeout(closing); closing = null; }
      fill(section);
      el.hidden = false;
      open = true;
      restore = document.activeElement;
      document.addEventListener('keydown', onKey, true);
      mark(at, false);
      // One frame between being laid out and being told to appear, or the
      // transition has nothing to run from.
      requestAnimationFrame(() => el.classList.add('is-open'));
      requestAnimationFrame(() => tabs()[selected]?.focus());
      return this;
    },

    close() {
      if (!open) return this;
      open = false;
      el.classList.remove('is-open');
      document.removeEventListener('keydown', onKey, true);
      closing = setTimeout(() => { el.hidden = true; closing = null; }, CLOSE_MS);
      if (restore instanceof HTMLElement && document.contains(restore)) restore.focus();
      restore = null;
      onClose?.(selected);
      return this;
    },
  };

  return api;
}
