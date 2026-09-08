import { lineOf, read, walk } from '../lib.mjs';

// THE SAME UNIFORM DECLARED TWICE, FOUND WITHOUT A DRIVER.
//
// This is leg 0 of guard-programmi, in a file of its own for one reason: a
// guard is a SCRIPT -- importing guard-programmi.mjs opens a browser and spends
// forty seconds -- and a predicate nobody can import is a predicate nobody can
// put a defect through. Everything below is a pure function of a Map of
// sources, so the defect can be injected into the REAL sources of this tree.
//
// D-C2-3, and it is the cheap half of the incident guard-programmi answers.
// E-LUCE5: the merge of cornice-1 onto U-LUCE-4's line put two declarations of
// uAirBeta and uAirPale into one program, GLSL calls that a redefinition, the
// hills and the lake stopped linking, nothing of the distant frame was drawn --
// and thirty seven guards out of thirty seven were green. E-CORNICE2 found the
// same shape again a month later.
//
// WHY IT EARNS ITS PLACE BESIDE A REAL COMPILER. guard-programmi's census and
// smoke need a browser, a GPU and forty seconds. The defect they were built for
// is a NAME DECLARED TWICE IN ONE PROGRAM, and that much is visible in the
// sources that MAKE the program, for nothing, in a tenth of a second, with no
// driver at all. So in guard-programmi this runs FIRST, it runs under --fast,
// and it runs on a machine that has no playwright at all, where the rest of
// that guard SKIPs: a check that can be had for free should never stand behind
// one that costs a minute.
//
// It does not replace the compiler and is not allowed to pretend to. A driver
// catches every redefinition, including the ones this cannot see -- a name
// built by string arithmetic, a chunk pulled in through a function this does
// not follow. What this catches is the shape the campaign has actually shipped
// twice (E-LUCE5, and E-CORNICE2 found it again), which is a shared chunk and a
// local fallback declaring the same names into one shader.
//
// HOW IT READS A SHADER WITHOUT RUNNING ONE. A program in this repository is a
// template literal with other template literals spliced into it, so:
//
//   1. every template literal in src/ that declares a uniform or splices
//      something is collected, together with the name it is bound to;
//   2. `${NAME}` and `${NAME(...)}` inside one are its CHUNKS, resolved
//      through aliases (`const A = b(...)`) and through the file they were
//      written in -- there is no import graph here and there does not need to
//      be one: a chunk's name is unique in this tree and the guard says so;
//   3. a chunk chosen by a TERNARY -- `const A = cond ? SEAT : FALLBACK` -- is
//      expanded into BOTH branches and each is checked on its own. That is not
//      a detail: it is exactly how E-LUCE5 shipped. A union of the two branches
//      would have hidden it, because a fallback is SUPPOSED to declare the same
//      names as the seat it stands in for. What is a defect is a fallback
//      declaring them ALONGSIDE the seat's chunk in one program.
//
// VERIFIED AGAINST THE REAL DEFECT rather than against a story about it: run
// over src/world/distant.js as it stood at 0a39c3f^, this says
//   distant.js:169 [HILL_FRAGMENT] uAirBeta (FOG_GLSL + FALLBACK_AIR_GLSL),
//                                  uAirPale (FOG_GLSL + FALLBACK_AIR_GLSL)
// and the same for LAKE_FRAGMENT -- the two programs that stopped linking, the
// two names, and the two chunks that collided. On this tip it finds none.

/** The body of the template literal that opens at `start`, and where it ends. */
function readTemplate(text, start) {
  let i = start + 1;
  let body = '';
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { body += c + text[i + 1]; i += 2; continue; }
    if (c === '`') { i += 1; break; }
    if (c === '$' && text[i + 1] === '{') {
      // The expression is kept as text -- `${FOG_GLSL}` is the whole point --
      // and a template nested inside it is skipped rather than flattened.
      let depth = 1;
      let expr = '';
      i += 2;
      while (i < text.length && depth > 0) {
        const d = text[i];
        if (d === '`') { const r = readTemplate(text, i); expr += '`'; i = r.end; continue; }
        if (d === '{') depth += 1;
        else if (d === '}') { depth -= 1; if (!depth) { i += 1; break; } }
        expr += d;
        i += 1;
      }
      body += `\${${expr}}`;
      continue;
    }
    body += c;
    i += 1;
  }
  return { body, end: i };
}

/** Every template literal of a source, with the index it starts at. */
export function templates(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i += 1; continue; }
    if (c === '/' && text[i + 1] === '*') { const j = text.indexOf('*/', i + 2); if (j < 0) break; i = j + 2; continue; }
    if (c === '"' || c === "'") {
      const q = c;
      i += 1;
      while (i < text.length && text[i] !== q) { if (text[i] === '\\') i += 1; i += 1; }
      i += 1;
      continue;
    }
    if (c === '`') { const r = readTemplate(text, i); out.push({ body: r.body, at: i }); i = r.end; continue; }
    i += 1;
  }
  return out;
}

const UNIFORM = /^[ \t]*uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?\w+\s+(\w+)\s*(?:\[[^\]]*\])?\s*;/gm;
const REFS = /\$\{\s*([A-Za-z_$][\w$.]*)\s*(?:\(|\})/g;
const DECL = /(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)\s*[=(]/g;

export const uniformsIn = (glsl) => [...glsl.matchAll(UNIFORM)].map((m) => m[1]);
// NOT DEDUPED, DELIBERATELY. Splicing the same chunk into one program twice is
// itself a redefinition -- the driver says so -- so the second occurrence has
// to survive as far as the clash check. A Set here would have made that defect
// invisible, and the self test found exactly that.
export const refsIn = (glsl) => [...glsl.matchAll(REFS)].map((m) => m[1].split('.').pop());

/** The name a literal is bound to: the nearest declaration in front of it. */
function nameBefore(text, at) {
  const before = text.slice(Math.max(0, at - 600), at);
  let last = null;
  let m;
  DECL.lastIndex = 0;
  while ((m = DECL.exec(before))) last = m[1];
  return last;
}

// How many alternative readings of one program the expansion will carry before
// it stops multiplying them out. Nothing in this tree comes near it; the cap is
// there so that a file which one day chains ten ternaries cannot turn a tenth
// of a second into a minute.
const COMBINATIONS = 64;

/**
 * THE SOURCES, INDEXED: which chunk declares what, what stands in for what, and
 * every template literal that is or composes a shader.
 *
 * @param {Map<string, string>} sources  path -> text. Taken as an argument and
 *        not read from disk, so the self test can inject a defect into the REAL
 *        sources instead of into a hand-written imitation of them.
 */
export function indexSources(sources) {
  const chunks = new Map();
  const alias = new Map();
  const branch = new Map();
  const programs = [];

  for (const [file, text] of sources) {
    for (const t of templates(text)) {
      const own = uniformsIn(t.body);
      const refs = refsIn(t.body);
      if (!own.length && !refs.length) continue;
      const name = nameBefore(text, t.at);
      if (name && !chunks.has(name)) chunks.set(name, { uniforms: own, refs });
      programs.push({ file, at: t.at, own, refs, name: name || '(anonimo)' });
    }
    // const NAME = cond ? SEAT : FALLBACK -- both branches are reachable.
    const tern = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*[^=;`]{0,120}?\?\s*([A-Za-z_$][\w$.]*)\s*:\s*([A-Za-z_$][\w$.]*)\s*;/g;
    let b;
    while ((b = tern.exec(text))) {
      if (!branch.has(b[1])) branch.set(b[1], [b[2].split('.').pop(), b[3].split('.').pop()]);
    }
    const aliasRe = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\(\)\s*=>\s*\(?[\w$]+\s*\?\?=\s*)?([A-Za-z_$][\w$.]*)\s*\(/g;
    let a;
    while ((a = aliasRe.exec(text))) if (!alias.has(a[1])) alias.set(a[1], a[2].split('.').pop());
  }

  /** Every reading of what a name contributes: one per branch it can take. */
  function expand(name, seen = new Set()) {
    if (seen.has(name)) return [[]];
    const next = new Set(seen);
    next.add(name);
    if (branch.has(name)) return branch.get(name).flatMap((b) => expand(b, next));
    if (chunks.has(name)) {
      const c = chunks.get(name);
      let combos = [c.uniforms.map((u) => ({ name: u, from: name }))];
      for (const r of c.refs) combos = cross(combos, expand(r, next));
      return combos;
    }
    if (alias.has(name)) return expand(alias.get(name), next);
    return [[]];
  }

  function cross(combos, alts) {
    const live = alts.filter((x) => x.length);
    if (!live.length) return combos;
    const out = [];
    for (const combo of combos) for (const alt of live) out.push([...combo, ...alt]);
    return out.length > COMBINATIONS ? combos : out;
  }

  return { programs, expand, cross };
}

/** What a chunk contributes, by name, on any one of its branches. */
export function chunkUniforms(sources, name) {
  const { expand } = indexSources(sources);
  return [...new Set(expand(name).flat().map((u) => u.name))];
}

/**
 * EVERY UNIFORM DECLARED TWICE IN ONE PROGRAM, over a set of sources.
 *
 * @param {Map<string, string>} sources  path -> text
 * @returns {{file: string, line: number, program: string, clashes: string[]}[]}
 */
export function duplicateUniforms(sources) {
  const { programs, expand, cross } = indexSources(sources);
  const found = [];
  for (const p of programs) {
    let combos = [p.own.map((u) => ({ name: u, from: '(qui)' }))];
    let spliced = false;
    for (const r of p.refs) {
      const alts = expand(r).filter((x) => x.length);
      if (!alts.length) continue;
      spliced = true;
      combos = cross(combos, alts);
    }
    if (!spliced) continue;
    const clashes = new Set();
    for (const combo of combos) {
      const seen = new Map();
      for (const { name, from } of combo) {
        if (seen.has(name)) clashes.add(`${name} (${seen.get(name)} + ${from})`);
        else seen.set(name, from);
      }
    }
    if (clashes.size) {
      found.push({
        file: p.file,
        line: lineOf(sources.get(p.file), p.at),
        program: p.name,
        clashes: [...clashes],
      });
    }
  }
  return found;
}

/** Every source of the world, as the static leg reads them. */
export function sourcesOfWorld() {
  const out = new Map();
  for (const rel of walk('src', (f) => f.endsWith('.js'))) out.set(rel, read(rel));
  return out;
}

