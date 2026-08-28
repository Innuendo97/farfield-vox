import { lineOf, read, reporter, selfTest, walk } from './lib.mjs';

// THE TWO KNOBS THAT ARE NOT THE VOXEL'S, HELD AT ONE IN ANYTHING THAT SHIPS.
//
// The lift is a pair of multipliers on the two terms of a face, and it exists
// because the targets' own shading and the light this world is sealed to did not
// agree while the orientation ladder was being fitted. Both are ONE at rest,
// which is the honest reading, and one is what ships. Moving either is a refit
// of assets-src/sky/scene-light.json -- which moves the paving, the stone and
// the rocks with it -- and belongs to the coordinator.
//
// WHAT THIS PREVENTS IS NOT A MISTAKE, IT IS A SHORTCUT. A session whose surface
// reads a little dark against its crop can put a 1.2 in its own material and the
// crop goes right. Nothing goes red, nothing looks wrong in that session, and
// the world quietly gains a second opinion about the hour -- which the next gate
// reads as a fitting error somewhere else entirely and fits AGAINST. That is the
// defect this campaign spent a session removing from the light and must not let
// back in one material at a time.
//
// THE SEAT AND THE USE SITES, BOTH. NEUTRAL_LIFT in src/world/face-light.js is
// where the pair is stated; faceLightUniforms() is the one door it goes through;
// and voxelSettings() carries a copy of it for the dev sweeps to reach. All
// three are read, because holding the seat at one while a material passes its
// own pair would be the seat kept and the rule broken.
//
// READ AS TEXT AND NOT IMPORTED, and that is not laziness: the modules that hold
// these numbers reach three.js and a JSON import, so a guard that imported them
// would need a browser's worth of module graph to ask a question about two
// characters. The seat is a literal, and a literal can be read.
//
// SCOPE IS WHAT SHIPS. src/dev/ is the bench, where the two knobs are sliders on
// purpose -- sweeping them on a page is what they are reachable for. What may
// not carry a lift is the world.

const SEAT = 'src/world/face-light.js';
const SHIPPED = (path) => path.endsWith('.js') && !path.startsWith('src/dev/');

/** The pair as the seat states it. */
export function seatValue(text) {
  const found = /export const NEUTRAL_LIFT = \[([^\]]*)\]/.exec(text);
  return found ? found[1].split(',').map((v) => Number(v.trim())) : null;
}

/** Whether the door's own default is the seat and not a second copy of it. */
export const doorDefaultsToSeat = (text) => /faceLightUniforms\([^)]*lift = NEUTRAL_LIFT\)/.test(text);

/** Every lift written down in a source, whatever it is called. */
export function liftLiterals(path, text) {
  const found = [];
  const named = /\b(sunLift|skyLift):\s*([\d.]+)/g;
  for (let m = named.exec(text); m; m = named.exec(text)) {
    found.push({ path, line: lineOf(text, m.index), what: m[1], value: Number(m[2]) });
  }
  // And the pair handed to the door positionally, which is the same shortcut
  // wearing a different shape.
  const passed = /faceLightUniforms\([^,)]+,\s*\[([\d.]+),\s*([\d.]+)\]/g;
  for (let m = passed.exec(text); m; m = passed.exec(text)) {
    found.push({ path, line: lineOf(text, m.index), what: 'lift passed to faceLightUniforms', value: Number(m[1]) });
    found.push({ path, line: lineOf(text, m.index), what: 'lift passed to faceLightUniforms', value: Number(m[2]) });
  }
  return found;
}

export const neutral = (value) => value === 1;

if (process.argv.includes('--self')) {
  const text = read(SEAT);
  selfTest('guard-lift', [
    { what: 'a seat moved to [1.2, 1] is caught', caught: !seatValue('export const NEUTRAL_LIFT = [1.2, 1];').every(neutral) },
    { what: 'a seat moved in the sky term is caught', caught: !seatValue('export const NEUTRAL_LIFT = [1, 0.9];').every(neutral) },
    { what: 'the seat as it stands is neutral', caught: seatValue(text).every(neutral) },
    {
      what: 'a material carrying its own sunLift: 1.35 is caught',
      caught: liftLiterals('injected', 'sunLift: 1.35,\n    skyLift: 1,').some((l) => !neutral(l.value)),
    },
    {
      what: 'a lift smuggled through the door positionally is caught',
      caught: liftLiterals('injected', '...faceLightUniforms(scale, [1.18, 1.0]),').some((l) => !neutral(l.value)),
    },
    {
      what: 'the door still defaults to the seat rather than to a copy of it',
      caught: doorDefaultsToSeat(text) && !doorDefaultsToSeat('function faceLightUniforms(scale, lift = [1, 1])'),
    },
  ]);
}

const report = reporter('guard-lift -- the shipped world lifts neither term');

const seatText = read(SEAT);
const seat = seatValue(seatText);

report.check(Array.isArray(seat) && seat.length === 2, `${SEAT} states NEUTRAL_LIFT`,
  seat ? `[${seat.join(', ')}]` : 'not found');
report.check(Boolean(seat) && seat.every(neutral), 'both terms of the seat are one',
  seat ? `[${seat.join(', ')}]` : '');
report.check(doorDefaultsToSeat(seatText),
  'faceLightUniforms() defaults to the seat and not to a copy of its value');

const literals = walk('src', SHIPPED).flatMap((path) => liftLiterals(path, read(path)));
report.line(`  ${literals.length} lift${literals.length === 1 ? '' : 's'} written down `
  + 'in what ships (src/dev/ is the bench and is not asked)');
for (const literal of literals) {
  report.check(neutral(literal.value), `${literal.path}:${literal.line} ${literal.what}`,
    `${literal.value}`);
}

report.end();
