// The readable edition of the material, built from the same six files the world
// reads.
//
// It exists because the world is not the only way in: a machine without WebGL2,
// a phone with no keys to walk with, a reader with scripting off, a search
// engine, a screen reader — all of them get the whole of the content here, as
// one static page with no script in it at all. The one thing it must never be
// is a second copy of the text: everything below is either read out of
// content/*.json or is chrome (a heading, a label, the badge on a line still to
// be settled), and nothing is authored here.
//
// Run directly it writes the page; imported it hands back the string, which is
// how the Vite plugin serves it in development and emits it into the build.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, renderInline, renderMarkdown } from './markdown.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const PENDING = 'in_attesa_committente';
const BADGE = 'in aggiornamento';
const EMPTY = 'Contenuto in aggiornamento.';

const FILES = {
  personalita: '01-personalita.json',
  progetti: '02-progetti.json',
  carriera: '03-carriera.json',
  skills: '04-skills.json',
  obiettivi: '05-obiettivi.json',
  contatti: '06-contatti.json',
};

// Reading order, which is not the order of the monoliths: who he is and where
// he has worked comes first, then what he built, then what he knows, and the
// two sections still waiting on their owner sit after the material that stands
// on its own.
const ORDER = ['carriera', 'progetti', 'skills', 'personalita', 'obiettivi', 'contatti'];

const TITLE = 'Daniele Galasso — Curriculum';
const DESCRIPTION = 'Curriculum di Daniele Galasso, Software Engineer full stack: carriera, '
  + 'progetti, competenze, certificazioni e contatti. Edizione testuale, leggibile senza JavaScript.';

const NOTICE_ID = 'edizione-testuale';
const NOTICE = 'Su questo dispositivo l’edizione esplorabile in 3D non è disponibile: '
  + 'qui sotto c’è tutto il materiale, in una pagina da leggere. '
  + 'La versione navigabile da mobile arriverà più avanti.';

const isPending = (node) => Boolean(node) && node.stato === PENDING;
const badge = () => `<span class="cv-badge">${BADGE}</span>`;

function readSections() {
  const sections = {};
  for (const [key, file] of Object.entries(FILES)) {
    sections[key] = JSON.parse(readFileSync(resolve(ROOT, 'content', file), 'utf8'));
  }
  return sections;
}

// ------------------------------------------------------------------- pieces

function metaLine(entry) {
  return [entry.periodo, entry.sottotitolo].filter(Boolean).join(' · ');
}

function chips(list) {
  if (!Array.isArray(list) || !list.length) return '';
  const items = list.map((name) => `<li>${escapeHtml(name)}</li>`).join('');
  return `<ul class="cv-chips" aria-label="Tecnologie">${items}</ul>`;
}

/**
 * One entry of a timeline.
 *
 * An entry whose owner has still to settle it is shown exactly as it stands,
 * marked, and nothing is written in its place: where there is no text at all
 * the page says so rather than covering the gap with a sentence nobody wrote.
 */
function renderEntry(entry) {
  const pending = isPending(entry);
  const parts = [];

  parts.push(`<h3 class="cv-entry-title">${escapeHtml(entry.titolo || '')}`
    + `${pending ? badge() : ''}</h3>`);

  // An entry that is a link carries its address in the subtitle, and the link
  // at the foot spells the same address out: printing both is saying it twice.
  const meta = entry.url && !entry.periodo ? '' : metaLine(entry);
  if (meta) parts.push(`<p class="cv-meta">${escapeHtml(meta)}</p>`);

  let written = false;
  if (entry.riassunto) {
    parts.push(`<p class="cv-lead">${renderInline(entry.riassunto)}</p>`);
    written = true;
  }
  if (entry.dettaglio) {
    parts.push(`<div class="cv-prose">${renderMarkdown(entry.dettaglio)}</div>`);
    written = true;
  }
  const tech = chips(entry.tecnologie);
  if (tech) { parts.push(tech); written = true; }
  if (entry.url) {
    parts.push(`<a class="cv-entry-link" href="${escapeHtml(entry.url)}" rel="noreferrer">`
      + `${escapeHtml(entry.sottotitolo || entry.url)}</a>`);
    written = true;
  }
  if (!written) parts.push(`<p class="cv-empty">${EMPTY}</p>`);

  return `<li class="cv-entry${pending ? ' is-pending' : ''}">${parts.join('')}</li>`;
}

function renderTimeline(section) {
  const entries = Array.isArray(section.timeline) ? section.timeline : [];
  if (!entries.length) return '';
  return `<ol class="cv-entries">${entries.map(renderEntry).join('')}</ol>`;
}

/** The opening paragraphs of the third section, ahead of its timeline. */
function renderAbout(section) {
  const about = section.chiSono;
  if (!about || !Array.isArray(about.paragrafi)) return '';
  const paragraphs = about.paragrafi.map((p) => `<p>${renderInline(p.testo)}`
    + `${isPending(p) ? badge() : ''}</p>`).join('');
  return `<h3 class="cv-entry-title">${escapeHtml(about.titolo || '')}</h3>`
    + `<div class="cv-about">${paragraphs}</div>`;
}

/**
 * The certificates, as a list per issuer.
 *
 * A group the content file leaves unnamed is left unnamed here too, with its
 * count and the badge: the page publishes what has been settled and says where
 * something is still open, and it never fills either gap in.
 */
function renderCertificates(section) {
  const certs = section.certificazioni;
  if (!certs || !Array.isArray(certs.gruppi)) return '';

  const rows = certs.gruppi.map((group) => {
    const name = group.ente || 'Academy';
    const items = (group.voci || []).map((v) => `<li>${escapeHtml(v)}</li>`);
    if (group.conteggio && !items.length) {
      items.push(`<li class="is-pending">${group.conteggio} certificati${badge()}</li>`);
    } else if (group.vociOmesse) {
      items.push(`<li class="is-pending">altri ${group.vociOmesse} titoli${badge()}</li>`);
    }
    return `<dt>${escapeHtml(name)}</dt><dd><ul>${items.join('')}</ul></dd>`;
  }).join('');

  const total = certs.totale
    ? `<p class="cv-meta">${escapeHtml(String(certs.totale))} in totale`
      + `${isPending(certs) ? badge() : ''}</p>`
    : '';

  return '<div class="cv-certs">'
    + '<h3 class="cv-certs-title">Certificazioni</h3>'
    + `${total}<dl>${rows}</dl></div>`;
}

function renderSection(section) {
  const extra = section.chiave === 'carriera' ? renderAbout(section)
    : section.chiave === 'skills' ? renderCertificates(section) : '';
  const body = section.chiave === 'skills'
    ? renderTimeline(section) + extra
    : extra + renderTimeline(section);

  return `<section class="cv-section" id="${escapeHtml(section.chiave)}" `
    + `aria-labelledby="titolo-${escapeHtml(section.chiave)}">`
    + `<h2 class="cv-section-title" id="titolo-${escapeHtml(section.chiave)}">`
    + `<span class="cv-num">${escapeHtml(section.id)}</span>`
    + `<span>${escapeHtml(section.titolo)}</span></h2>`
    + `${body}</section>`;
}

// --------------------------------------------------------------------- head

function renderContacts(section) {
  const entries = (section.timeline || []).filter((entry) => entry.url);
  if (!entries.length) return '';
  const items = entries.map((entry) => {
    const label = escapeHtml(entry.sottotitolo || entry.titolo);
    return '<li>'
      + `<span class="cv-kind">${escapeHtml(entry.titolo)}</span>`
      + `<a href="${escapeHtml(entry.url)}" rel="noreferrer">${label}</a>`
      + `${isPending(entry) ? badge() : ''}</li>`;
  }).join('');
  return `<ul class="cv-contacts">${items}</ul>`;
}

function renderHead(sections) {
  const profile = sections.carriera.profilo || {};
  return '<header class="cv-head">'
    + '<p class="cv-eyebrow">Farfield · edizione testuale</p>'
    + `<h1 class="cv-name">${escapeHtml(profile.nome || '')}</h1>`
    + `<p class="cv-role">${escapeHtml(profile.ruolo || '')}</p>`
    + `<p class="cv-place">${escapeHtml(profile.citta || '')}</p>`
    + renderContacts(sections.contatti)
    + `<p class="cv-summary">${renderInline(profile.sintesi || '')}</p>`
    + '</header>';
}

function renderIndex(ordered) {
  const items = ordered.map((section) => '<li>'
    + `<a href="#${escapeHtml(section.chiave)}">`
    + `<span class="cv-num">${escapeHtml(section.id)}</span>`
    + `${escapeHtml(section.titolo)}</a></li>`).join('');
  return `<nav class="cv-index" aria-label="Sezioni"><ol>${items}</ol></nav>`;
}

function renderFoot(sections) {
  const privacy = sections.contatti.privacy || {};
  const gdpr = privacy.gdpr ? `<p>${escapeHtml(privacy.gdpr)}</p>` : '';
  return '<footer class="cv-foot">'
    + '<p class="cv-back"><a href="../">Torna al mondo 3D</a></p>'
    + gdpr
    + '</footer>';
}

// --------------------------------------------------------------------- page

/** The whole page, as a string. */
export function renderCvPage() {
  const sections = readSections();
  const ordered = ORDER.map((key) => sections[key]);
  const css = readFileSync(resolve(ROOT, 'src/ui/cv.css'), 'utf8');

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(TITLE)}</title>
<meta name="description" content="${escapeHtml(DESCRIPTION)}">
<meta name="author" content="${escapeHtml(sections.carriera.profilo?.nome || '')}">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="#0f1720">
<meta property="og:type" content="profile">
<meta property="og:locale" content="it_IT">
<meta property="og:site_name" content="Farfield">
<meta property="og:title" content="${escapeHtml(TITLE)}">
<meta property="og:description" content="${escapeHtml(DESCRIPTION)}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230f1720'/%3E%3Cpath d='M16 5.5 26.5 16 16 26.5 5.5 16Z' fill='none' stroke='%237fd4f5' stroke-width='1.6'/%3E%3Cpath d='M16 11 21 16 16 21 11 16Z' fill='%239eecf9'/%3E%3C/svg%3E">
<link rel="preload" href="../fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<style>
${css}</style>
</head>
<body>
<aside class="cv-notice" id="${NOTICE_ID}" role="note">${escapeHtml(NOTICE)}</aside>
<div class="cv-wrap">
${renderHead(sections)}
${renderIndex(ordered)}
<main>
${ordered.map(renderSection).join('\n')}
</main>
${renderFoot(sections)}
</div>
</body>
</html>
`;
}

/** Where the world sends a reader it cannot carry. */
export const NOTICE_HASH = `#${NOTICE_ID}`;

export function writeCvPage(target) {
  const file = resolve(ROOT, target || 'dist/cv/index.html');
  mkdirSync(dirname(file), { recursive: true });
  const html = renderCvPage();
  writeFileSync(file, html, 'utf8');
  return { file, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const written = writeCvPage(process.argv[2]);
  process.stdout.write(`${written.file} — ${(written.bytes / 1024).toFixed(1)} kB\n`);
}
