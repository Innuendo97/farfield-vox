import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, braceBody, lineOf, read, readJson, reporter, selfTest, walk } from './lib.mjs';

// THE LIGHT OF THIS WORLD HAS ONE SEAL AND ONE DOOR.
//
// ===========================================================================
// THE SEAL. assets-src/sky/scene-light.json and the sun of assets-src/sky/
// sky.json are the refit V0c measured off the two targets: the elevation and
// the azimuth the targets' own lit faces imply, and the split between sun and
// sky that puts seventy per cent of a top face's light in the beam. Moving any
// of it moves EVERY surface in the world at once -- the meadow, the paving, the
// stone, the rocks and the weather -- so it is the coordinator's, and it is the
// one change in this repository that cannot be judged from inside the session
// that makes it.
//
// The mechanism is the one tools/grade/grade-sky.mjs already uses over the S1
// sky: a sealed copy, a comparison against it, and a refusal that names exactly
// which fields would move. What is NOT being claimed is that the sealed numbers
// are right and the new ones wrong. It says the two disagree, that the
// disagreement is a decision belonging to whoever owns the seal, and that a
// decision is not something a session gets to take in passing.
//
// --coordinator is the way to take it deliberately. It re-seals, and it says so.
//
// ===========================================================================
// THE DOOR (D12). setSkyPreset() in src/core/sky.js is the ONLY place the six
// sky uniforms are written. That is what lets V6 own the dome's OPTICS and V7
// own the VALUES of a night preset without either holding the other's pen: a
// preset is a set of numbers handed through one function, and the arithmetic
// that turns them into a sky lives entirely on the other side of it.
//
// The failure this prevents is two hands on one uniform. The moment a second
// place writes uSunDir or uSkyExposure, the dome and everything that reflects it
// stop being able to agree about the hour, and the disagreement shows up in a
// frame as a halo or a wrong blue -- never as an error. Reading these uniforms
// is nobody's business but their own; WRITING them is the door's alone.

const SEAL = 'tools/lighting/sun-seal.json';

// What is under the seal, by file and by path within it. `sun` carries
// elevationRange and azimuthSpread as well as the two angles: those describe the
// window the dome's optics were fitted inside, and rewriting them without
// redoing that fit would falsify the record of it.
const SEALED = {
  'assets-src/sky/sky.json': ['sun', 'day.sun'],
  'assets-src/sky/scene-light.json': ['day'],
};

const DOOR_FILE = 'src/core/sky.js';
const DOOR = 'setSkyPreset';

const pick = (value, path) => path.split('.').reduce((v, key) => (v ?? {})[key], value);

/** Every leaf of a value, as `a.b.c` -> the text of it. */
export function leaves(value, prefix = '', out = new Map()) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      leaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.set(prefix, JSON.stringify(value));
  }
  return out;
}

/** The fields under the seal, as they stand on disk right now. */
export function current() {
  const out = {};
  for (const [file, paths] of Object.entries(SEALED)) {
    const value = readJson(file);
    out[file] = Object.fromEntries(paths.map((path) => [path, pick(value, path)]));
  }
  return out;
}

/** What moved, between a sealed copy and what is on disk. */
export function drift(sealed, now) {
  const was = leaves(sealed);
  const is = leaves(now);
  const moved = [];
  for (const [key, value] of is) {
    const before = was.get(key);
    if (before === undefined) moved.push(`+ ${key} = ${value}   (new field)`);
    else if (before !== value) moved.push(`~ ${key}: ${before}  ->  ${value}`);
  }
  for (const key of was.keys()) if (!is.has(key)) moved.push(`- ${key}   (would be dropped)`);
  return moved;
}

/** Every place outside the door that WRITES one of the sky's own uniforms. */
export function writesOutsideTheDoor(files) {
  const door = (() => {
    const text = files.find((f) => f.path === DOOR_FILE)?.text ?? '';
    const at = text.indexOf(`function ${DOOR}(`);
    return at < 0 ? '' : braceBody(text, text.indexOf('{', at));
  })();
  const found = [];
  // Two shapes, because the two names can only be written in different ways.
  // The uniform holds an object, so it is written either by mutating that object
  // or by replacing it; SUN_DIRECTION IS the object, exported as a const, so the
  // only way to write it is to mutate it -- and `export const SUN_DIRECTION =`
  // is the seat being declared, not a second hand on it.
  const patterns = [
    /SKY_UNIFORMS\.\w+\.value\s*(?:\.(?:set|copy|fromArray)\(|=(?!=))/g,
    /SUN_DIRECTION\s*\.(?:set|copy|fromArray|add|sub|multiply\w*|normalize)\(/g,
  ];
  for (const { path, text } of files) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
        const statement = m[0].replace(/\s+/g, ' ').trim();
        if (path === DOOR_FILE && door.includes(m[0])) continue;
        found.push({ path, line: lineOf(text, m.index), statement });
      }
    }
  }
  return found;
}

if (process.argv.includes('--self')) {
  const now = current();
  const bent = JSON.parse(JSON.stringify(now));
  bent['assets-src/sky/scene-light.json'].day.sunStrength = 0.3;
  const dropped = JSON.parse(JSON.stringify(now));
  delete dropped['assets-src/sky/sky.json']['day.sun'].vector;
  const sources = walk('src', (path) => path.endsWith('.js')).map((path) => ({ path, text: read(path) }));
  selfTest('guard-luce-sigillo', [
    { what: 'a moved sunStrength is caught', caught: drift(now, bent).some((d) => d.includes('sunStrength')) },
    { what: 'a dropped sun vector is caught', caught: drift(now, dropped).some((d) => d.startsWith('-')) },
    { what: 'an unmoved seal reports nothing', caught: drift(now, now).length === 0 },
    {
      what: 'a second hand on uSunDir outside the door is caught',
      caught: writesOutsideTheDoor([
        ...sources,
        { path: 'injected', text: 'SKY_UNIFORMS.uSunDir.value.set(0.0, 1.0, 0.0);' },
      ]).some((w) => w.path === 'injected'),
    },
    {
      what: 'a second hand on the exported sun direction is caught too',
      caught: writesOutsideTheDoor([
        ...sources,
        { path: 'injected', text: 'SUN_DIRECTION.copy(mine);' },
      ]).some((w) => w.path === 'injected'),
    },
    {
      what: 'reading the sun is nobody\'s business but their own',
      caught: !writesOutsideTheDoor([{ path: 'injected', text: 'const up = SKY_UNIFORMS.uSunDir.value.y;' }]).length,
    },
    { what: 'the door itself is not reported as a second hand', caught: !writesOutsideTheDoor(sources).length },
  ]);
}

const coordinator = process.argv.includes('--coordinator');
const report = reporter('guard-luce-sigillo -- the light has one seal and one door');

// ------------------------------------------------------------------ the seal
const now = current();

if (!existsSync(join(REPO_ROOT, SEAL))) {
  if (!coordinator) {
    report.check(false, `${SEAL} is on disk`,
      'there is no seal; the coordinator writes one with --coordinator');
    report.end();
  }
  writeFileSync(join(REPO_ROOT, SEAL), `${JSON.stringify({ sealed: now }, null, 2)}\n`);
  report.check(true, `${SEAL} was not on disk; written, and it is the seal now`);
} else {
  const sealed = readJson(SEAL).sealed;
  const moved = drift(sealed, now);
  report.line(`  under seal: ${Object.entries(SEALED)
    .map(([file, paths]) => `${file} (${paths.join(', ')})`).join('; ')}`);

  if (!moved.length) {
    report.check(true, 'the sealed light reproduces field for field; nothing moved');
  } else if (coordinator) {
    writeFileSync(join(REPO_ROOT, SEAL), `${JSON.stringify({
      ...readJson(SEAL), sealed: now,
    }, null, 2)}\n`);
    report.line('');
    report.line('  --coordinator: THE SEAL HAS BEEN MOVED. What changed:');
    for (const line of moved) report.line(`    ${line}`);
    report.line('');
    report.line('  Every surface in this world is lit by what just moved. Put the re-seal in a');
    report.line('  commit of its own, so the walk that approves the new light has one change to');
    report.line('  look at.');
    report.check(true, 'the seal was moved deliberately');
  } else {
    report.check(false, 'the light on disk is the light under seal');
    for (const line of moved) report.line(`        ${line}`);
    report.line('');
    report.line('  scene-light.day and the sun of sky.json move EVERY surface at once: the');
    report.line('  meadow, the paving, the stone, the rocks and the weather. That is a decision');
    report.line('  for the coordinator and not for a session. If this run is the coordinator:');
    report.line('');
    report.line('      npm run guard:all -- --coordinator');
  }
}

// ------------------------------------------------------------------ the door
report.line('');
const sources = walk('src', (path) => path.endsWith('.js')).map((path) => ({ path, text: read(path) }));
const hands = writesOutsideTheDoor(sources);
report.check(hands.length === 0,
  `${DOOR}() in ${DOOR_FILE} is the only hand that writes the sky's uniforms`,
  hands.length ? hands.map((h) => `${h.path}:${h.line} ${h.statement}`).join(' | ') : '');

report.end();
