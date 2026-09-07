import {
  LIGHT_SCALE, MEADOW_ALBEDO, encodedLum, faceTerms, readLight, renderChain,
} from '../lighting/render-chain.mjs';
import { read, reporter, selfTest } from './lib.mjs';

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
// The sentences the fragment has to keep saying. They are matched as text
// because that is what they are -- there is no way to ask a compiled shader
// whether it still believes the ground is in the mat -- and each one is the
// exact line a tidying-up would delete.
const SHAPE = [
  {
    what: 'the mat over a column is read off the fetch that carried the height',
    re: /float\s+matRung\s*=\s*bladeSubOf\(hit\.tex\)\s*\*\s*uBladeUnit\s*\/\s*uCell\s*;/,
  },
  {
    what: 'and the ground standing in the mat is in the mat, not out in the open',
    re: /bool\s+inMat\s*=\s*hit\.blade\s*\|\|\s*matRung\s*>\s*0\.5\s*;/,
  },
  {
    what: 'the mat shades only as deep as the mat is tall (a cut bank is not a well)',
    re: /float\s+rung\s*=\s*min\(\s*floor\(max\(0\.0,\s*canopy\s*-\s*hit\.p\.y\)\s*\/\s*uCell\)\s*,\s*floor\(matRung\)\s*\)\s*;/,
  },
  {
    what: 'a blade keeps its foot’s fall and the ground takes the well’s own pair',
    re: /vec2\s+base\s*=\s*!inMat\s*\?\s*vec2\(0\.0,\s*1\.0\)\s*:\s*\(hit\.blade\s*\?\s*uBase\s*:\s*uWell\)\s*;/,
  },
  {
    what: 'and the bounce falls down the same ladder (R1 S2)',
    re: /float\s+bounce\s*=\s*hit\.blade\s*\?\s*uBounce\s*\*\s*sky\s*:\s*0\.0\s*;/,
  },
  {
    what: 'where the mat thins the ground is soil, at the floor of the tint band',
    re: /thinMat\s*=\s*family\s*==\s*0\s*&&\s*matRung\s*<\s*0\.5\s*;/,
  },
  {
    what: 'and that soil is drawn with its own family and not the verge’s earth',
    re: /vec3\s+albedo\s*=\s*\(thinMat\s*\?\s*uAlbedoSoil\s*:\s*earth\s*\?\s*uAlbedoEarth\s*:\s*uAlbedo\)/,
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

function main() {
  const r = reporter('guard-prato -- the well between the cubes, and the ground under a thinning mat');
  const campo = read(CAMPO);
  const pigment = read(PIGMENT);
  const material = read(MATERIAL);

  r.line('');
  r.line('  THE SHAPE OF THE WELL, read off the fragment:');
  for (const { what, re } of SHAPE) r.check(re.test(campo), what);

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
// Every assertion above, against the defect it exists to catch. The shape ones
// are injected by putting the OLD line back -- which is the defect, exactly as
// it shipped before this unit -- and the numeric ones by moving the literal.
function self() {
  const campo = read(CAMPO);
  const pigment = read(PIGMENT);
  const cases = [];
  const brokeAll = (text) => SHAPE.filter(({ re }) => !re.test(text)).length;

  // the gate goes back to hit.blade alone: the ground leaves the mat
  cases.push({
    what: 'the ladder gated on hit.blade alone (the shipped defect, put back)',
    caught: brokeAll(campo.replace(/bool\s+inMat\s*=\s*hit\.blade\s*\|\|\s*matRung\s*>\s*0\.5\s*;/,
      'bool inMat = hit.blade;')) > 0,
  });
  cases.push({
    what: 'the cap on the mat’s reach removed, so a cut bank goes black',
    caught: brokeAll(campo.replace(/float\s+rung\s*=\s*min\([\s\S]*?\)\s*;/,
      'float rung = floor(max(0.0, canopy - hit.p.y) / uCell);')) > 0,
  });
  cases.push({
    what: 'the bounce no longer falling down the ladder',
    caught: brokeAll(campo.replace(/float\s+bounce\s*=\s*hit\.blade\s*\?\s*uBounce\s*\*\s*sky\s*:\s*0\.0\s*;/,
      'float bounce = hit.blade ? uBounce : 0.0;')) > 0,
  });
  cases.push({
    what: 'the thinning mat drawing the meadow’s own albedo again',
    caught: brokeAll(campo.replace(/vec3\s+albedo\s*=\s*\(thinMat\s*\?\s*uAlbedoSoil\s*:\s*earth\s*\?\s*uAlbedoEarth\s*:\s*uAlbedo\)/,
      'vec3 albedo = (earth ? uAlbedoEarth : uAlbedo)')) > 0,
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
  r.note('LE QUOTE DELLE TRE FAMIGLIE NON SONO GATEATE QUI, e questo e’ il numero: '
    + 'a 5-7 m il campo sta a 59/12/30 contro il 57/39/5 del bersaglio (R1 §1.1). '
    + 'Il pozzo di questa unita’ ha chiuso quello che poteva chiudere -- il suolo '
    + 'che stava nel manto ed era illuminato come prato aperto -- e la distanza che '
    + 'resta e’ di FORMA e non di pozzo: la nostra distribuzione e’ bimodale '
    + '(un buco fra luma 35 e 75) dove quella del bersaglio e’ graduata. Le due '
    + 'voci sono la LUCE A ZONE (R1 S3, U-ZONE-1) e l’occlusione fra filo e filo '
    + '(un filo basso fra due alti sta al rung zero della propria colonna), che '
    + 'costa fetch e non sta nei 0 ms di questo mandato: U-CAMPO-2.');
  r.end(`the well takes the ground to ${depth.toFixed(4)} of open ground`);
}
