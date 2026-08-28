// Single source of the written material. Every panel, engraving and room reads
// from content/*.json and nothing else, so a correction to the CV never has to
// be chased through the scene code.
//
// Section file shape:
//   id            two digit number, matches the monolith
//   chiave        stable key, used by layout.js and by the routes
//   titolo        display name
//   icona         icon key engraved above the title
//   copertura     fraction of the section already covered by the sources
//   incisione     { titolo, parolechiave[], ... } text carved on the monolith
//   timeline[]    { id, titolo, periodo, sottotitolo, riassunto, dettaglio,
//                   tecnologie[] } dettaglio is markdown; periodo is null when
//                   the entry is not dated
//   stanza        { chiave, ancoraMonolite, presentazione, elementi[] }
//
// Any node may carry "stato": entries waiting on the owner of the content are
// marked "in_attesa_committente" with a "nota" saying exactly what is missing,
// and the provisional text always names its "fonte". Nothing here is invented.

const PATHS = {
  personalita: '01-personalita.json',
  progetti: '02-progetti.json',
  carriera: '03-carriera.json',
  skills: '04-skills.json',
  obiettivi: '05-obiettivi.json',
  contatti: '06-contatti.json',
};

export const SECTIONS = Object.keys(PATHS);

export const PENDING = 'in_attesa_committente';

const cache = new Map();
const inflight = new Map();

let base = './';

// Sections are fetched one at a time, when the player walks up to a monolith:
// the written material never delays the first frame.
export function setContentBase(value) {
  base = value.endsWith('/') ? value : `${value}/`;
}

export function loadSection(key) {
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (inflight.has(key)) return inflight.get(key);

  const path = PATHS[key];
  if (!path) return Promise.reject(new Error(`unknown content section "${key}"`));

  const promise = fetch(`${base}content/${path}`)
    .then((response) => {
      if (!response.ok) throw new Error(`content unavailable: ${path} (${response.status})`);
      return response.json();
    })
    .then((section) => {
      cache.set(key, section);
      inflight.delete(key);
      return section;
    });

  // A fetch that failed must not stay remembered as one still in flight, or
  // every later attempt is handed the same rejection and the section can never
  // be asked for again. Attaching this here also keeps a failure that nobody is
  // waiting on from surfacing as an unhandled rejection; the caller still gets
  // the rejection from the promise returned below.
  promise.catch(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

export function getSection(key) {
  return cache.get(key) || null;
}

export function loadAllSections() {
  return Promise.all(SECTIONS.map(loadSection));
}

// Every node still waiting on the owner of the content, flattened. It is what
// the questionnaire is built from, and what keeps placeholders from silently
// shipping as if they were final text.
export function pendingEntries(section) {
  const found = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (node.stato === PENDING) {
      found.push({ path, id: node.id || null, nota: node.nota || null });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'stato' && key !== 'nota') walk(value, path ? `${path}.${key}` : key);
    }
  };
  walk(section, '');
  return found;
}
