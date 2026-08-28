import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// THE BOOKKEEPING EVERY GUARD DOES, AND NOTHING TWO GUARDS HAVE TO AGREE ON.
//
// WHY THE GUARDS ARE FOUND BY GLOB. Eight sessions run at once and each of them
// will want a guard of its own. If the set of guards were a list in a file, that
// file would be the one thing every session had to edit, on every branch, at the
// same time -- a merge conflict scheduled eight times over, in the one place
// where a bad resolution silently REMOVES a check. So a guard is a FILE:
// tools/guards/guard-*.mjs. Dropping one in arms it; nothing central is touched.
//
// THE PROTOCOL, stated here because tools/guards/all.mjs is what reads it:
//
//   exit 0        the guard is satisfied
//   exit 1        it is not, and the lines above say which assertion failed
//   "NOTE  ..."   a declared observation that is not a failure: a target missed,
//                 a leg that is armed but has nothing to bite on yet
//   "SKIP  ..."   the guard did not run, and why -- for the ones that need a
//                 browser and will run in the session gates instead
//   --self        the guard runs against a defect it injects into itself and
//                 asserts it catches it. A guard nobody has seen fail is a guard
//                 nobody has any reason to believe, so every guard that can
//                 inject its own defect carries this.

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');
export const readJson = (rel) => JSON.parse(read(rel));

/** Every file under a directory matching a test, as repository-relative paths. */
export function walk(rel, keep, out = []) {
  let entries;
  try {
    entries = readdirSync(join(REPO_ROOT, rel));
  } catch {
    return out;
  }
  for (const entry of entries) {
    const child = `${rel}/${entry}`;
    if (statSync(join(REPO_ROOT, child)).isDirectory()) walk(child, keep, out);
    else if (keep(child)) out.push(child);
  }
  return out;
}

/**
 * The extent of the object or block literal that opens at an index.
 *
 * Several guards have to ask what is INSIDE one construction -- the fields of
 * one material, the body of one function -- and the answer cannot come from a
 * line window: two materials forty lines apart read as one, and a guard that
 * mixes them either misses a defect or invents one.
 *
 * @param {string} text the source
 * @param {number} open index of the opening brace
 * @returns {string} the text between that brace and the one that matches it
 */
export function braceBody(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

/** Which line of a text an index falls on, counting from one. */
export const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** A reporter with the protocol above already in it. */
export function reporter(title) {
  let failed = 0;
  const out = (line) => process.stdout.write(`${line}\n`);
  out(title);
  return {
    line: out,
    check(ok, what, detail = '') {
      out(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`);
      if (!ok) failed++;
      return ok;
    },
    note(text) { out(`NOTE  ${text}`); },
    skip(reason) { out(`SKIP  ${reason}`); process.exit(0); },
    end(summary = '') {
      if (summary) out(`  ${summary}`);
      out(failed ? `  ${failed} assertion${failed === 1 ? '' : 's'} failed` : '');
      process.exit(failed ? 1 : 0);
    },
  };
}

/**
 * The other direction, which is the half a guard is usually missing.
 *
 * @param {string} title
 * @param {{what: string, caught: boolean}[]} cases each defect, and whether the
 *        guard's own predicate said no to it
 */
export function selfTest(title, cases) {
  const out = (line) => process.stdout.write(`${line}\n`);
  out(`${title} -- against defects injected into itself`);
  let missed = 0;
  for (const { what, caught } of cases) {
    out(`  ${caught ? 'ok  ' : 'MISS'}  ${what}`);
    if (!caught) missed++;
  }
  out(missed ? `  ${missed} defect${missed === 1 ? '' : 's'} went through` : '');
  process.exit(missed ? 1 : 0);
}
