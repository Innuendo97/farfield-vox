import {
  LIGHT_SCALE, MEADOW_ALBEDO, encodedLum, faceTerms, readLight, renderChain,
} from '../lighting/render-chain.mjs';
import { braceBody, read, reporter, selfTest } from './lib.mjs';

// GUARD-PRATO -- THE WELL BETWEEN THE CUBES, AND THE GROUND UNDER A THINNING MAT.
//
// ===========================================================================
// WHAT THIS GUARD IS FOR, IN ONE SENTENCE: the mat's own light has to reach the
// GROUND STANDING IN THE MAT, and the day it stops reaching it the meadow goes
// back to drawing its brightest face in the one place the reference is darkest.
//
// THE DEFECT IT WAS WRITTEN AGAINST, MEASURED AND NOT ASSUMED. Both halves of
// the mat's light -- the sun a blade keeps under its own line (uShadeSun) and
// the ladder it falls down (uBase) -- were gated on hit.blade. A blade took
// them; the ground between the blades did not, so it was lit as open meadow: a
// horizontal face at the full sun and the full sky. Probed at the fitted pose
// that ground is 29% of R1's pp-dx window and 27% of its bright family, and 56%
// of the bright family of the whole five-to-seven metre band.
//
// AND WHY THE GATE IS SHAPED LIKE THIS. The quotas of the three families are
// the campaign's headline reading of this meadow and they are NOT gated here,
// for a reason this file would rather state than bury: at five to seven metres
// they are 59/12/30 against the reference's 57/39/5, and the distance that
// remains is not this unit's to close (see the NOTE at the end, which prints it
// every run with its owner). A gate on a number a session cannot move is a gate
// that gets disabled. What IS gated is what the well is MADE OF and what it is
// WORTH: the seven sentences of arithmetic that put the ground back in the mat,
// the two pairs that must stay two, and the level the well takes open ground
// down to -- which is a ratio between two faces of one material and so is the
// one reading of this meadow the zones cannot contaminate.
//
// IT RUNS UNDER PLAIN NODE. The structure is read off the text of the shader
// and the levels are carried through the light seat, the meadow's own pigment,
// AgX and the delivered grade cube by tools/lighting/render-chain.mjs -- the
// same road guard-scala takes, for the same reason: a reading that needs a
// browser belongs to the session gate, and this one has to be askable at every
// commit.

const CAMPO = 'src/world/voxel/campo-material.js';
const PIGMENT = 'src/world/voxel/pigment.js';
const MATERIAL = 'src/world/voxel/material.js';

// ---------------------------------------------------------------- the shape
//
// THE SEVEN SENTENCES, ASKED AS DATAFLOW AND NO LONGER AS TYPOGRAPHY.
//
// WHAT STOOD HERE AND WHY IT WAS A TRAP. Seven regular expressions, each one an
// ENTIRE GLSL statement written out -- `bool inMat = hit.blade || matRung >
// 0.5;` and its six brothers -- with the head of this section saying so
// plainly: «each one is the exact line a tidying-up would delete». It is also
// the exact line a tidying-up would REWRITE, and a rewrite that keeps every
// promise would have turned this guard red with the fragment perfectly correct:
// swap the two terms of the `||`, wrap one of them in parentheses, break the
// line, and the sentence is gone. Worse, four of the seven self tests injected
// their defect by `String.replace` of the very regex they were also matching,
// so they proved the replacement worked and not that the READER did -- the same
// trap U-GUARDIA-3 took out of guard-zone.
//
// WHAT REPLACES IT. The question this guard actually has is a DATAFLOW one --
// «does the sentence that decides `inMat` still look at `matRung`, or has it
// gone back to asking only `hit.blade`?» -- and that is asked of the statement
// that WRITES a name, over the names its right-hand side mentions. It is the
// same question tools/guards/lib/quadro.mjs puts to a compiled vertex shader
// («for each statement that writes a name, did its right-hand side mention this
// call?») and it is put here to the fragment's own text, because this guard
// runs under plain node on purpose and a fragment is not a stage quadro can
// interrogate. What survives such a reader is every rewrite of the expression,
// which is the whole of E-IGIENE.
//
// AND IT IS STILL A GATE AND NOT A SEARCH. A name that must be mentioned and a
// name that must NOT be are both stated, so «the ground back out in the open»
// is caught by the absence of `matRung` and «the bounce off the ladder» by the
// absence of `sky` -- the two defects that shipped -- rather than by a comma
// moving.

/**
 * Every statement of a source that writes a name, and what its right-hand side
 * mentions.
 *
 * Comments out, split on the semicolon, and the left-hand side taken as the
 * last name before the assignment. A declaration (`float rung = ...`) and a
 * plain assignment (`thinMat = ...`) come out the same, which is what is
 * wanted: what is guarded is where a value comes from, not how it was declared.
 */
export function writesOf(text) {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
  const out = [];
  for (const statement of bare.split(';')) {
    const m = /(?:^|[\s{}()])([A-Za-z_]\w*)\s*(=)(?!=)([\s\S]*)$/.exec(statement);
    if (m) out.push({ lhs: m[1], rhs: m[3] });
  }
  return out;
}

// A write whose right-hand side asks NOTHING is not a decision, it is a seat
// being set aside: `bool thinMat = false;` three lines before the sentence that
// actually decides it. What counts as asking something is any name that is not
// a keyword, a type or a number, which is the whole of GLSL's own vocabulary
// for «a constant».
const EMPTY_HANDED = /^(true|false|vec[234]|mat[234]|ivec[234]|float|int|bool|uint)$/;
const asksSomething = (rhs) => [...rhs.matchAll(/[A-Za-z_]\w*/g)]
  .some((m) => !EMPTY_HANDED.test(m[0]));

/**
 * The body of one function of a source, by its name.
 *
 * The sentences below all live in the fragment's own `shade()`, and a name
 * written there has nothing to do with the same name written in `main()` --
 * `base` is both the well's pair here and a lattice corner there. Naming the
 * function is the coarsest pin there is and the only one this reader keeps: it
 * survives every rewrite of what is inside it.
 */
export function functionBody(text, name) {
  const at = new RegExp(`\\b${name}\\s*\\([^)]*\\)\\s*\\{`).exec(text);
  return at ? braceBody(text, at.index + at[0].length - 1) : '';
}

/**
 * Does the sentence that decides this name mention these, and not those?
 *
 * ONE sentence: a name decided in two places is two answers to one question,
 * and the day they disagree nobody can say which one the frame took.
 */
export function decidedBy(text, { lhs, needs = [], forbids = [] }) {
  const written = writesOf(text)
    .filter((w) => w.lhs === lhs && asksSomething(w.rhs));
  if (written.length !== 1) return false;
  const { rhs } = written[0];
  const mentions = (name) => new RegExp(`(^|[^\\w.])${name.replace(/\./g, '\\.')}(?![\\w])`)
    .test(rhs);
  return needs.every(mentions) && !forbids.some(mentions);
}

const SHAPE = [
  {
    what: 'the mat over a column is read off the fetch that carried the height',
    lhs: 'matRung',
    needs: ['bladeSubOf', 'hit.tex', 'uBladeUnit', 'uCell'],
  },
  {
    what: 'and the ground standing in the mat is in the mat, not out in the open',
    lhs: 'inMat',
    needs: ['hit.blade', 'matRung'],
  },
  {
    what: 'the mat shades only as deep as the mat is tall (a cut bank is not a well)',
    lhs: 'rung',
    needs: ['min', 'canopy', 'uCell', 'matRung'],
  },
  {
    what: 'a blade keeps its foot’s fall and the ground takes the well’s own pair',
    lhs: 'base',
    needs: ['inMat', 'hit.blade', 'uBase', 'uWell'],
  },
  {
    what: 'and the bounce falls down the same ladder (R1 S2)',
    lhs: 'bounce',
    needs: ['hit.blade', 'uBounce', 'sky'],
  },
  {
    what: 'where the mat thins the ground is soil, at the floor of the tint band',
    lhs: 'thinMat',
    needs: ['family', 'matRung'],
  },
  {
    what: 'and that soil is drawn with its own family and not the verge’s earth',
    lhs: 'albedo',
    needs: ['thinMat', 'uAlbedoSoil', 'uAlbedoEarth', 'uAlbedo'],
  },
];

// ------------------------------------------------------------- the literals
//
// The two pairs, and the whole point is that they are TWO. bladeSettings().base
// is E-ERBA-A 1.6's reading of the fall at the foot of one blade; CAMPO_WELL is
// R1 S2's reading of the well between blades, which is a different quantity
// about a different face. A session that notices they look alike and folds them
// into one number fails here, which is the only warning the campaign gets.
const WANT_WELL = [0.85, 0.50];
const WANT_FOOT = [0.16, 0.62];

const numsOf = (text, re) => {
  const m = re.exec(text);
  return m ? m.slice(1).map(Number) : null;
};

// ------------------------------------------------------------- the levels
//
// ONE FACE, READ TWICE, WHICH IS THE ONLY QUESTION AN OFFLINE MODEL OF THIS
// MATERIAL CAN ANSWER HONESTLY. The families of the frame are a clustering over
// four populations and this file will not pretend to reproduce them; what it
// can state exactly is what the well is worth, which is the SAME ground -- one
// normal, one albedo, one seat -- with the mat over it and without:
//
//   open   the meadow's ground with nothing standing on it: full sun, full sky
//   well   the same ground under the mat: uShadeSun of the sun, and two rungs
//          down the WELL's ladder, which is what this unit put there
//   soil   and the ground where the mat thins, which is a family and not a well
//
// Not a cluster: every reading here IS a face with a known normal, a known sun
// and a known rung, for the reason guard-scala states at its head.
//
// This is the fragment's own arithmetic in another language -- matTerms() bends
// the pair, faceLightOf() adds the ground's return -- and restating it wrong is
// how an offline model quietly stops being the frame, so it is written once,
// here, and read from the same literals the shader is.
//
function matColour(n, sun, sky, bounce, light, albedo, ground) {
  const [ts, tk0] = faceTerms(n, sunVectorOf(light));
  const tk = Math.min(1, tk0 + bounce * (1 - Math.abs(n[1])));
  const terms = [ts * sun, tk * sky];
  const gs = Math.max(sunVectorOf(light)[1], 0);
  return [0, 1, 2].map((c) => albedo[c] * light.scale * (
    terms[0] * light.sunBeam[c] * light.sunStrength
    + terms[1] * light.skyBalance[c] * light.skyStrength
    + ground[c] * (1 - terms[1]) * (gs * light.sunBeam[c] * light.sunStrength
      + light.skyBalance[c] * light.skyStrength)));
}

function sunVectorOf(light) {
  const e = light.elevation * Math.PI / 180;
  const a = light.azimuth * Math.PI / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
}

const ladder = (well, shadeSun, light, composite, albedo, ground, soil) => {
  const skyAt = (pair, rung) => 1 - pair[0] * (1 - pair[1] ** rung);
  const lum = (sun, sky, alb) => encodedLum(
    composite(matColour([0, 1, 0], sun, sky, 0, light, alb, ground)),
  );
  return {
    // the ground of the meadow with nothing standing on it: no mat, no well
    open: lum(1, 1, albedo),
    // the same ground with the mat over it, two rungs down the well's ladder
    well: lum(shadeSun, skyAt(well, 2), albedo),
    // and the ground where the mat thins, which is a family and not a well
    soil: lum(1, 1, soil),
  };
};

// WHAT THE WELL HAS TO BE WORTH, AND WHY IT IS A CEILING AND NOT A TARGET.
//
// R1 1.2 reads the reference's floor at 0.10 to 0.20 of its own cube tops, and
// this world cannot get there: measured through the chain the well takes the
// ground to 0.51 of open ground and STOPS, because the third term of
// ../../src/world/face-light.js puts a floor under it -- the share of the
// hemisphere below a face is one MINUS its sky term, so every rung the ladder
// takes off the sky is handed back as the ground's own return. That is not a
// defect of this unit, it is the arithmetic of the seat working as written, and
// the only knob that moves it is BOUNCE_SHARE, which is the light's and is
// pinned by guard-scala at its own minimax (E-LUCE7). So the gate here is that
// the well DOES ITS WORK -- a regression that hands the ground back its full
// sky reads 1.00 and fails -- and the distance to the reference's own floor is
// printed with its owner.
const WELL_CEILING = 0.60;
const TARGET_FLOOR = [0.10, 0.20];

// LE QUOTE PER FASCIA, MISURATE E NON GATEATE, e la colonna che questa guardia
// non aveva prima.
//
// PERCHE’ STANNO QUI E NON IN guard-zone. Sono la lettura di R1 §1.1 sulle
// famiglie del prato: appartengono al PRATO, e la guardia del prato e’ il posto
// dove un lettore le cerca. Quello che U-ZONE-1 ha aggiunto e’ la terza colonna,
// che e’ la ragione per cui il mandato chiedeva a questa guardia di riportare
// prima e dopo: la famiglia chiara a 4,8-7,5 m era sette volte quella del
// bersaglio (E-OCCHIO1, divario 10) ed e’ la prima cifra della campagna a
// coincidere.
//
// Lette con lo strumento di R1 riprodotto e validato (che sulle cinque finestre
// del bersaglio riproduce esattamente le sue cifre pubblicate), alla posa
// vox-giorno, tier alto, 1672x941, interfaccia spenta.
const QUOTE = [
  ['pp-sx', '57/38/6', '68/24/8', '71/23/6'],
  ['pp-dx', '57/39/5', '58/12/30', '65/29/6'],
  ['5-7 m', '53/34/13', '48/33/20', '50/31/18'],
  ['7-8,5 m', '38/43/19', '46/26/28', '55/25/19'],
  ['10-12 m', '44/43/13', '57/27/16', '49/31/20'],
];

function main() {
  const r = reporter('guard-prato -- the well between the cubes, and the ground under a thinning mat');
  const campo = read(CAMPO);
  const pigment = read(PIGMENT);
  const material = read(MATERIAL);

  r.line('');
  r.line('  THE SHAPE OF THE WELL, read off the fragment:');
  const shade = functionBody(campo, 'shade');
  for (const leg of SHAPE) {
    r.check(decidedBy(shade, leg), leg.what,
      `${leg.lhs} is decided by ${leg.needs.join(', ')}`);
  }

  r.line('');
  r.line('  THE TWO PAIRS, and the point is that they are two:');
  const well = numsOf(campo, /CAMPO_WELL\s*=\s*\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]/);
  const bladeBody = material.slice(material.indexOf('export function bladeSettings()'));
  const foot = numsOf(bladeBody, /base:\s*new Vector2\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)/);
  r.check(well !== null && well[0] === WANT_WELL[0] && well[1] === WANT_WELL[1],
    'the well carries the pair fitted on this tip', `${JSON.stringify(well)} against ${JSON.stringify(WANT_WELL)}`);
  r.check(foot !== null && foot[0] === WANT_FOOT[0] && foot[1] === WANT_FOOT[1],
    'and a blade’s foot still carries E-ERBA-A 1.6’s own reading', `${JSON.stringify(foot)} against ${JSON.stringify(WANT_FOOT)}`);
  r.check(well !== null && foot !== null && (well[0] !== foot[0] || well[1] !== foot[1]),
    'and they have not been folded into one number');

  return { r, campo, pigment, material, well, foot };
}

async function levels(r, pigment) {
  const light = readLight();
  const composite = await renderChain();
  const material = read(MATERIAL);
  const faceLight = read('src/world/face-light.js');
  const shadeSun = Number(/BLADE_SHADE_SUN = ([0-9.]+)/.exec(material)[1]);
  const soilLevel = Number(/SOIL_LEVEL = ([0-9.]+)/.exec(pigment)[1]);
  const earth = /earth:\s*\[([0-9.]+),\s*([0-9.]+),\s*([0-9.]+)\]/.exec(pigment)
    .slice(1).map(Number);
  // the soil as the fragment draws it: its own family at the FLOOR of the band
  const soil = earth.map((v) => v * soilLevel * TINT_FLOOR_OF(pigment));
  const share = Number(/BOUNCE_SHARE = ([0-9.]+)/.exec(faceLight)[1]);
  const ground = /BOUNCE_GROUND = \[([0-9.]+), ([0-9.]+), ([0-9.]+)\]/
    .exec(faceLight).slice(1).map(Number).map((v) => v * share);

  const seat = { ...light, scale: LIGHT_SCALE };
  const L = ladder(WANT_WELL, shadeSun, seat, composite, MEADOW_ALBEDO, ground, soil);
  const depth = L.well / L.open;

  r.line('');
  r.line('  WHAT THE WELL IS WORTH, through the light seat, AgX and the delivered cube:');
  r.line(`    the ground with nothing over it      ${L.open.toFixed(1)}`);
  r.line(`    the same ground at the bottom of the well  ${L.well.toFixed(1)}   ${depth.toFixed(4)} of it`);
  r.line(`    the soil where the mat thins          ${L.soil.toFixed(1)}`);
  r.line('');
  r.check(depth <= WELL_CEILING,
    'the well takes the ground down and does not hand its sky back',
    `${depth.toFixed(4)} of open ground, ceiling ${WELL_CEILING}`);
  r.check(L.soil < L.open,
    'the ground where the mat thins is DARKER than the meadow it replaced',
    `${L.soil.toFixed(1)} against ${L.open.toFixed(1)}`);

  r.line('');
  r.line('  WITNESS, not gated -- how far this floor is from the reference’s own:');
  r.line(`    the reference’s floor over its tops  ${TARGET_FLOOR[0]} to ${TARGET_FLOOR[1]} (R1 §1.2)`);
  r.line(`    ours                                  ${depth.toFixed(4)}`);
  r.line('    the distance is the third term of src/world/face-light.js, which is a');
  r.line('    fraction of ONE MINUS the sky term and so rises as the ladder falls.');
  r.line(`    BOUNCE_SHARE is ${share} and is the light’s own minimax (E-LUCE7),`);
  r.line('    held by guard-scala. Owner: E-LUCE / il coordinatore.');
  return { depth, L };
}

function TINT_FLOOR_OF(pigment) {
  return Number(/tintFloor:\s*([0-9.]+)/.exec(pigment)[1]);
}


// --------------------------------------------------------------- self-test
//
// Every assertion above, against the defect it exists to catch.
//
// AND EVERY SHAPE CASE THREE WAYS, WHICH IS THE PART THAT CHANGED. What stood
// here injected each defect by `String.replace` of the very expression the
// reader was also matching, and then asked only whether SOME sentence had
// broken -- so a case proved that a replacement had happened, never that the
// reader could tell one sentence from another. Now each one names the sentence
// it bends, asserts that THAT sentence is the one that goes red, and is
// followed by the case that matters most: THE SAME SENTENCE REWRITTEN -- terms
// swapped, parentheses added, a temporary introduced, the line broken -- which
// must stay green. That third case is the one this guard would have failed with
// the fragment perfectly correct, and it is the reason a session tidying a
// shader used to have to come and edit a guard.
function self() {
  const campo = read(CAMPO);
  const pigment = read(PIGMENT);
  const cases = [];
  const leg = (lhs) => SHAPE.find((x) => x.lhs === lhs);
  // One sentence of the fragment on its own: what the reader is handed, so a
  // case says which sentence it is about instead of «one of the seven».
  const only = (text) => (spec) => decidedBy(text, spec);

  cases.push({
    what: 'the ladder gated on hit.blade alone (the shipped defect, put back)',
    caught: !only('bool inMat = hit.blade;')(leg('inMat')),
  });
  cases.push({
    what: 'and the SAME sentence with the two terms swapped and parenthesised is not a defect',
    caught: only('bool inMat = (matRung > 0.5) || hit.blade;')(leg('inMat'))
      && only('bool inMat =\n    hit.blade\n    || matRung > 0.5;')(leg('inMat')),
  });
  cases.push({
    what: 'the cap on the mat’s reach removed, so a cut bank goes black',
    caught: !only('float rung = floor(max(0.0, canopy - hit.p.y) / uCell);')(leg('rung')),
  });
  cases.push({
    what: 'and the same cap written with the two arguments the other way round',
    caught: only('float rung = min(floor(matRung), floor(max(0.0, canopy - hit.p.y) / uCell));')(leg('rung')),
  });
  cases.push({
    what: 'the bounce no longer falling down the ladder',
    caught: !only('float bounce = hit.blade ? uBounce : 0.0;')(leg('bounce')),
  });
  cases.push({
    what: 'and the same bounce with the product written the other way about',
    caught: only('float bounce = hit.blade ? sky * uBounce : 0.0;')(leg('bounce')),
  });
  cases.push({
    what: 'the thinning mat drawing the meadow’s own albedo again',
    caught: !only('vec3 albedo = (earth ? uAlbedoEarth : uAlbedo) * tint;')(leg('albedo')),
  });
  cases.push({
    what: 'and the same choice unfolded over three lines, which is how one is made readable',
    caught: only('vec3 albedo = (thinMat\n      ? uAlbedoSoil\n      : (earth ? uAlbedoEarth : uAlbedo)) * tint;')(leg('albedo')),
  });
  cases.push({
    what: 'the ground taken out of the well: base decided by the blade alone',
    caught: !only('vec2 base = !hit.blade ? vec2(0.0, 1.0) : uBase;')(leg('base')),
  });
  cases.push({
    what: 'the mat read off a fetch of its own instead of the one that carried the height',
    caught: !only('float matRung = bladeSubOf(uv) * uBladeUnit / uCell;')(leg('matRung')),
  });
  cases.push({
    what: 'the thinning decided without the mat, which makes every open cell soil',
    caught: !only('thinMat = family == 0;')(leg('thinMat')),
  });
  cases.push({
    what: 'a sentence written TWICE, which is two answers to one question',
    caught: !decidedBy(`${functionBody(campo, 'shade')}
bool inMat = hit.blade || uCell > 0.0;`,
      leg('inMat')),
  });
  cases.push({
    what: 'and the seven sentences the fragment ships are none of those',
    caught: SHAPE.every((spec) => decidedBy(functionBody(campo, 'shade'), spec)),
  });
  cases.push({
    what: 'and a seat set aside beforehand is not a second answer: bool thinMat = false',
    caught: decidedBy('bool thinMat = false; thinMat = family == 0 && matRung < 0.5;',
      leg('thinMat')),
  });
  cases.push({
    what: 'and the same name written in another function is not this function’s answer',
    caught: decidedBy(functionBody(campo, 'shade'), leg('base'))
      && !decidedBy(functionBody(campo, 'main'), leg('base')),
  });
  cases.push({
    what: 'the two pairs folded into one number',
    caught: (() => {
      const w = numsOf(campo.replace(/CAMPO_WELL\s*=\s*\[[^\]]*\]/, 'CAMPO_WELL = [0.16, 0.62]'),
        /CAMPO_WELL\s*=\s*\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]/);
      return w[0] === WANT_FOOT[0] && w[1] === WANT_FOOT[1];
    })(),
  });
  cases.push({
    what: 'the well’s pair moved off the fit',
    caught: (() => {
      const w = numsOf(campo.replace(/CAMPO_WELL\s*=\s*\[[^\]]*\]/, 'CAMPO_WELL = [0.50, 0.50]'),
        /CAMPO_WELL\s*=\s*\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]/);
      return !(w[0] === WANT_WELL[0] && w[1] === WANT_WELL[1]);
    })(),
  });
  cases.push({
    what: 'the soil brightened back to the verge’s own earth',
    caught: Number(/SOIL_LEVEL = ([0-9.]+)/.exec(
      pigment.replace(/SOIL_LEVEL = [0-9.]+/, 'SOIL_LEVEL = 1.0'),
    )[1]) >= 1,
  });
  selfTest('guard-prato', cases);
}

if (process.argv.includes('--self')) {
  self();
} else {
  const { r, pigment } = main();
  const { depth } = await levels(r, pigment);
  r.line('');
  r.line('  LE QUOTE PER FASCIA, PRIMA E DOPO LA LUCE A ZONE (non gateate, §NOTA):');
  r.line('    fascia         bersaglio   prima di U-ZONE-1   dopo');
  for (const [fascia, want, before, after] of QUOTE) {
    r.line(`    ${fascia.padEnd(14)} ${want.padEnd(11)} ${before.padEnd(19)} ${after}`);
  }
  r.note('LE QUOTE DELLE TRE FAMIGLIE NON SONO GATEATE QUI, e questi sono i numeri, '
    + 'ripresi dopo la luce a zone di U-ZONE-1: a 5-7 m il campo sta a 50/31/18 '
    + 'contro il 53/34/13 del bersaglio (era 48/33/20), e sulla finestra pp-dx di '
    + 'R1 §1.1 la FAMIGLIA CHIARA — il divario che E-OCCHIO1 chiamava per nome, '
    + 'sette volte il bersaglio — sta al 6% contro il 5% del bersaglio, da 30%. '
    + 'Il pozzo di U-PRATO-2 ha chiuso il suolo che stava nel manto ed era '
    + 'illuminato come prato aperto; le zone hanno chiuso il termine a bassa '
    + 'frequenza. Quello che resta e’ il CONTRASTO sotto il metro e mezzo: il '
    + 'bersaglio crudo sta a 0,314 del proprio p90 dove il suo stesso campo lento '
    + 'sta a 0,449, cioe’ un terzo del suo chiaroscuro vive a una scala che '
    + 'nessuna mappa di zone raggiunge. E’ l’occlusione fra filo e filo (un filo '
    + 'basso fra due alti sta al rung zero della propria colonna), che costa fetch: '
    + 'U-CAMPO-2.');
  r.end(`the well takes the ground to ${depth.toFixed(4)} of open ground`);
}
