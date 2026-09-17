import { pendingEntries, PENDING, SECTIONS } from '../../src/core/content.js';
import { MONOLITHS } from '../../src/world/layout.js';
import { read, readJson, reporter, selfTest } from './lib.mjs';
import { serveRepo, toolsPresent } from './lib/quadro.mjs';

// WHETHER THE SIX FILES OF content/ ARE A PORTFOLIO OR A QUESTIONNAIRE.
//
//   node tools/guards/guard-contenuti.mjs
//   node tools/guards/guard-contenuti.mjs --self
//
// WHAT IT IS FOR. The written material of this world was first laid down from
// the CV with a great many holes in it, and every hole was marked honestly:
// `"stato": "in_attesa_committente"` with a `nota` saying what was missing. The
// committente then said «rendi le informazioni del mio portfolio reali,
// prendendo il tutto dal mio CV», and the holes were filled. The danger from
// that day on is the opposite of the one the markers were for: a placeholder
// that survives a rewrite ships as if it were final text, and a sentence that
// nobody can trace back to a line of the CV ships as if it were true.
//
// So this guard is four questions, and none of them is about how the writing
// LOOKS:
//
//   (1) is anything still waiting on the owner of the content;
//   (2) can every voice name the source it came from, and is that source one of
//       the three this campaign is allowed to quote;
//   (3) is the committente's telephone number anywhere in the six files -- it
//       was excluded by an explicit decision and a public site is forever;
//   (4) does the writing cut into the six stones still FIT the field it is cut
//       into, which is the one question that cannot be answered by reading a
//       file, because the answer is a measurement of type.
//
// WHY (4) NEEDS A BROWSER, AND WHY IT IS NOT A LITERAL. The composition in
// src/world/engraving.js sets its keyword list at a cap height in metres of
// stone and then SQUEEZES any line that would run past the right margin, down
// to a floor of 0.55. A squeezed line is not a red: it is still inside the
// field. But it is set narrower than everything above it, which reads as a
// second typeface on the same face, and the squeeze is chosen to make the line
// land EXACTLY on the margin -- so a composition whose widest ink stops short
// of the margin is a composition in which nothing was squeezed at all. That is
// the predicate here, and it is measured on the real DataTexture that engrave()
// hands the stone, with the real font, at the real distance each block stands
// from the reference pose. Nothing about the type is copied into this file: the
// only number read out of engraving.js is the margin itself, by name, and the
// read is asserted so a rename goes red instead of quiet.
//
// WHAT IT DELIBERATELY DOES NOT CHECK. Whether the words are the RIGHT words.
// That is the committente's veto and a guard that held a copy of the five
// traits would be a second, staler place for the coordinator's decisions to
// live -- E-METODO1's whole lesson about orders that fall out of a rewrite.

const CONTENT = 'content';

// The three sources this campaign is allowed to quote, and nothing else. Two
// documents on the committente's desk, and the coordinator's own decisions in
// the ledger for what neither document contains.
const SOURCES = [
  'Curriculum Vitae.tex',
  'LinkedIn - Profilo Ottimizzato.md',
  'E-DECISIONI25',
];

// Where a voice has to carry its source. A "voice" is anything that puts words
// on a stone, a sheet or a page; a `stanza` carries no prose and is exempt.
const VOICED = ['incisione', 'profilo', 'privacy', 'certificazioni'];

// The six files, named off the stones rather than off a list of their own: a
// section nobody cut into a monolith is a section nobody can read.
const files = () => MONOLITHS.map((m) => ({ id: m.id, key: m.key, name: `${m.id}-${m.key}.json` }));

function loadAll() {
  const out = new Map();
  for (const { key, name } of files()) {
    out.set(key, { name, section: readJson(`${CONTENT}/${name}`), raw: read(`${CONTENT}/${name}`) });
  }
  return out;
}

// --------------------------------------------------------------- the predicates
//
// Each one is a named function with no reach into anything, so --self can hand
// it a defect and read the answer. E-GUARDIA4's rule: a cancello that cannot be
// called twice is a cancello nobody has proved.

/** Every node still marked as waiting, by the reader the world itself uses. */
export function stillWaiting(section) {
  return pendingEntries(section);
}

/** Every voice of a section, as { path, node }. */
export function voices(section) {
  const out = [];
  for (const key of VOICED) if (section[key]) out.push({ path: key, node: section[key] });
  for (const [i, entry] of (section.timeline || []).entries()) {
    out.push({ path: `timeline[${i}] ${entry.id || '?'}`, node: entry });
  }
  for (const [i, p] of (section.chiSono?.paragrafi || []).entries()) {
    out.push({ path: `chiSono.paragrafi[${i}]`, node: p });
  }
  return out;
}

/** Whether a fonte is there at all, and whether it names a source we may quote. */
export function sourceOf(node) {
  const fonte = typeof node.fonte === 'string' ? node.fonte.trim() : '';
  if (!fonte) return { ok: false, why: 'no fonte' };
  const named = SOURCES.filter((s) => fonte.includes(s));
  if (!named.length) return { ok: false, why: 'fonte names no admitted source' };
  return { ok: true, named };
}

// A TELEPHONE NUMBER, AND WHAT IS NOT ONE.
//
// The committente's number is not written down here and must not be: this file
// lives in the same repository as the ones it guards, and a guard that carries
// the secret it is protecting has published it. So the question asked is the
// SHAPE of a telephone number rather than the identity of one -- a run of nine
// to fifteen digits held together by nothing but spaces, dots, hyphens and
// brackets, with an optional international plus in front.
//
// What that deliberately does not reach: anything a slash separates, which is
// every date (05/2021), every grade (93/110), every version (Java 8/21) and the
// two articles of the GDPR line (2016/679, 196/2003); and anything a letter
// touches, which is the LinkedIn handle (daniele-galasso-21b599225).
const PHONE = /(?<![\w/])\+?\d[\d\s().-]{7,18}\d(?![\w/])/g;

export function phoneLike(text) {
  const found = [];
  for (const match of String(text).matchAll(PHONE)) {
    const digits = match[0].replace(/\D/g, '').length;
    if (digits >= 9 && digits <= 15) found.push(match[0].trim());
  }
  return found;
}

/** Whether the certificates add up, group by group and in total. */
export function certificatesAddUp(section) {
  const block = section.certificazioni;
  if (!block) return { applies: false };
  const problems = [];
  let sum = 0;
  for (const group of block.gruppi || []) {
    sum += group.conteggio;
    const entry = (section.timeline || []).find((e) => e.id === group.voce);
    if (!entry) {
      problems.push(`${group.id}: no timeline entry "${group.voce}"`);
      continue;
    }
    const bullets = String(entry.dettaglio || '').split('\n')
      .filter((line) => /^\s*[-*]\s+\S/.test(line)).length;
    if (bullets !== group.conteggio) {
      problems.push(`${group.id}: ${bullets} names listed, ${group.conteggio} declared`);
    }
  }
  if (sum !== block.totale) problems.push(`groups sum to ${sum}, total says ${block.totale}`);
  return { applies: true, problems, sum };
}

/**
 * Whether a composition was set at its own width or squeezed to fit.
 *
 * `maxInk` is the rightmost cell of the whole engraving that carries any ink at
 * all; `limit` is where paint() stops a line. A line that had to be squeezed
 * lands ON the limit, by construction, so ink short of the limit is a face on
 * which nothing was condensed.
 */
export function insideField({ maxInk, limit }) {
  return maxInk < limit;
}

/** The right margin of the composition, read out of engraving.js by its name. */
export function marginRight(source) {
  const found = /^const MARGIN_RIGHT = ([\d.]+);$/m.exec(source);
  const left = /^const MARGIN_LEFT = ([\d.]+);$/m.exec(source);
  if (!found || !left) return null;
  const right = Number(found[1]);
  const start = Number(left[1]);
  if (!(start > 0 && start < right && right <= 1)) return null;
  return { right, left: start };
}

// ------------------------------------------------------------------ the browser
//
// The lightest page that can answer the question: the repository served, one
// tab, and the engraving module imported straight out of it. The world boots in
// the background of that tab and is never waited for -- what is being measured
// is a canvas, not a frame, and groundReady would cost a minute for nothing.
async function measureField(chromium, port) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    await page.goto(`http://127.0.0.1:${port}/?dev&t0&intro=0`, { waitUntil: 'domcontentloaded' });
    return await page.evaluate(async (names) => {
      const [{ engrave, loadEngravingFont }, { MONOLITHS: blocks }, { POSE_TARGET }] =
        await Promise.all([
          import('/src/world/engraving.js'),
          import('/src/world/layout.js'),
          import('/src/core/poses.js'),
        ]);
      const face = await loadEngravingFont('/');
      const out = [];
      for (const block of blocks) {
        const answer = await fetch(`/content/${names[block.id]}`);
        const section = await answer.json();
        const distance = Math.hypot(
          block.position.x - POSE_TARGET.position.x,
          block.position.z - POSE_TARGET.position.z,
        );
        const { texture } = engrave(section, block, distance);
        const { width, height, data } = texture.image;
        let maxInk = -1;
        for (let y = 0; y < height; y++) {
          for (let x = width - 1; x > maxInk; x--) {
            if (data[(y * width + x) * 2 + 1] > 0) { maxInk = x; break; }
          }
        }
        out.push({ id: block.id, key: block.key, width, maxInk, distance });
      }
      return { face, out };
    }, Object.fromEntries(files().map((f) => [f.id, f.name])));
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------- --self

if (process.argv.includes('--self')) {
  const carriera = readJson(`${CONTENT}/03-carriera.json`);
  const skills = readJson(`${CONTENT}/04-skills.json`);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const planted = clone(carriera);
  planted.timeline[2].stato = PENDING;

  const noSource = clone(carriera);
  delete noSource.timeline[1].fonte;

  const wrongSource = clone(carriera);
  wrongSource.timeline[1].fonte = 'appunti di una riunione';

  const shortList = clone(skills);
  const anthropic = shortList.timeline.find((e) => e.id === 'cert-anthropic');
  anthropic.dettaglio = anthropic.dettaglio.split('\n').slice(0, -1).join('\n');

  const wrongTotal = clone(skills);
  wrongTotal.certificazioni.totale = 27;

  const lostEntry = clone(skills);
  lostEntry.certificazioni.gruppi[0].voce = 'cert-che-non-ce';

  // The same file RESTRUCTURED: every object rebuilt with its keys in the
  // opposite order, all the way down, and not one character of text changed.
  // E-GUARDIA4's third verse -- a guard that reads shape rather than layout has
  // to stay green through this.
  const reverseKeys = (node) => {
    if (Array.isArray(node)) return node.map(reverseKeys);
    if (!node || typeof node !== 'object') return node;
    const out = {};
    for (const key of Object.keys(node).reverse()) out[key] = reverseKeys(node[key]);
    return out;
  };
  const reshuffled = reverseKeys(carriera);

  // A telephone in four of the shapes one is written in, and the five things in
  // these files that look like one and are not.
  const phones = ['(+39) 331 5450463', '+39 331 545 0463', '331 5450463', '3315450463'];
  const notPhones = [
    'Autorizzo il trattamento dei miei dati personali ai sensi del Reg. UE 2016/679'
    + ' (GDPR) e del D.Lgs. 196/2003.',
    'linkedin.com/in/daniele-galasso-21b599225/',
    'maggio 2023 — oggi · 05/2021 — 02/2022 · 2011 — 2016',
    'Java 8/21, Spring Boot 3.4, AZ-900, AZ-204, voto 93/110',
    'coordinamento di emergenze marittime via radio e linea 1530',
  ];

  const source = read('src/world/engraving.js');

  selfTest('guard-contenuti', [
    {
      what: 'a voice still marked in_attesa_committente is found where it is buried',
      caught: stillWaiting(planted).length === 1,
    },
    {
      what: 'the six delivered files carry no such marker',
      caught: [...loadAll().values()].every(({ section }) => stillWaiting(section).length === 0),
    },
    {
      what: 'a timeline entry with no fonte is refused',
      caught: !sourceOf(noSource.timeline[1]).ok,
    },
    {
      what: 'a fonte that names no admitted source is refused',
      caught: !sourceOf(wrongSource.timeline[1]).ok,
    },
    {
      what: 'the fonte of every delivered voice is accepted',
      caught: [...loadAll().values()]
        .every(({ section }) => voices(section).every((v) => sourceOf(v.node).ok)),
    },
    ...phones.map((text) => ({
      what: `a telephone written "${text}" is found`,
      caught: phoneLike(`sottotitolo: ${text}`).length === 1,
    })),
    ...notPhones.map((text) => ({
      what: `not a telephone: ${text.slice(0, 46)}…`,
      caught: phoneLike(text).length === 0,
    })),
    {
      what: 'a certificate dropped out of a list is caught against its own count',
      caught: certificatesAddUp(shortList).problems.length === 1,
    },
    {
      what: 'a total that does not match the groups is caught',
      caught: certificatesAddUp(wrongTotal).problems.length === 1,
    },
    {
      what: 'a group pointing at a timeline entry that is not there is caught',
      caught: certificatesAddUp(lostEntry).problems.length === 1,
    },
    {
      what: 'the delivered certificates add up',
      caught: certificatesAddUp(skills).problems.length === 0,
    },
    {
      what: 'ink that reaches the margin is a line that was squeezed to fit',
      caught: !insideField({ maxInk: 517, limit: 517 })
        && !insideField({ maxInk: 600, limit: 517 })
        && insideField({ maxInk: 456, limit: 517 }),
    },
    {
      what: 'the margin is read out of engraving.js by name, not remembered',
      caught: marginRight(source)?.right > 0
        && marginRight(source.replace('const MARGIN_RIGHT', 'const MARGIN_R')) === null
        && marginRight(source.replace(/const MARGIN_RIGHT = [\d.]+;/, 'const MARGIN_RIGHT = 1.4;'))
          === null,
    },
    {
      what: 'the same file written out in another order still passes every leg',
      caught: stillWaiting(reshuffled).length === 0
        && voices(reshuffled).every((v) => sourceOf(v.node).ok)
        && phoneLike(JSON.stringify(reshuffled)).length === 0,
    },
  ]);
}

// ------------------------------------------------------------------- the run

const report = reporter('guard-contenuti -- the six files of content/, and the field they are cut into');

const loaded = loadAll();

report.check(
  loaded.size === SECTIONS.length && SECTIONS.every((key) => loaded.has(key)),
  'the six sections src/core/content.js asks for are the six files on disk',
  `${loaded.size} of ${SECTIONS.length}`,
);

for (const [key, { name, section, raw }] of loaded) {
  const waiting = stillWaiting(section);
  report.check(waiting.length === 0, `${name}: nothing waiting on the committente`,
    waiting.length ? waiting.map((w) => w.path).join(', ') : '');

  report.check(section.copertura === 1, `${name}: copertura is 1`, `${section.copertura}`);

  const shape = ['id', 'chiave', 'titolo', 'icona', 'copertura', 'incisione', 'timeline', 'stanza']
    .filter((field) => section[field] === undefined);
  report.check(shape.length === 0, `${name}: the shape content.js documents is whole`,
    shape.length ? `missing ${shape.join(', ')}` : '');

  report.check(section.chiave === key && section.stanza.ancoraMonolite === section.id,
    `${name}: the file, its key and the stone it is cut into agree`);

  const said = voices(section);
  const unsourced = said.filter((v) => !sourceOf(v.node).ok);
  report.check(unsourced.length === 0, `${name}: all ${said.length} voices name their source`,
    unsourced.length ? unsourced.map((v) => `${v.path} (${sourceOf(v.node).why})`).join('; ') : '');

  const entries = section.timeline || [];
  const malformed = entries.filter((e) => !e.id || !e.titolo || !Array.isArray(e.tecnologie));
  report.check(malformed.length === 0, `${name}: ${entries.length} timeline entries, all formed`,
    malformed.map((e) => e.id || '(no id)').join(', '));

  const numbers = phoneLike(raw);
  report.check(numbers.length === 0, `${name}: no telephone number`, numbers.join(', '));

  const certs = certificatesAddUp(section);
  if (certs.applies) {
    report.check(certs.problems.length === 0,
      `${name}: ${certs.sum} certificates, named one by one and counted`,
      certs.problems.join('; '));
  }
}

// ------------------------------------------------- and whether the type fits

const margin = marginRight(read('src/world/engraving.js'));
report.check(margin !== null,
  'the composition margins are readable in src/world/engraving.js',
  margin ? `left ${margin.left}, right ${margin.right}` : 'MARGIN_LEFT/MARGIN_RIGHT not found');

const { chromium, missing } = toolsPresent();
if (!margin) {
  report.note('the field is not measured: the margin could not be read');
} else if (!chromium) {
  report.note(`the field is not measured on this machine: ${missing.join(', ')} not installed`);
} else {
  const server = await serveRepo();
  try {
    const { face, out } = await measureField(chromium, server.port);
    report.check(face === true, 'the engraving face came down', face ? '' : 'the fallback was used');
    for (const { id, key, width, maxInk, distance } of out) {
      const limit = width * margin.right;
      report.check(insideField({ maxInk, limit }),
        `${id} ${key}: the writing is set at its own width, not squeezed into the field`,
        `ink to ${maxInk} px of ${limit.toFixed(0)}, ${(limit - maxInk).toFixed(0)} px spare`
        + ` (face ${width} px, ${distance.toFixed(1)} m)`);
    }
  } finally {
    await server.stop();
  }
}

report.end();
