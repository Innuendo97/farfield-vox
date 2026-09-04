import {
  ALBEDO, PIGMENT, PIGMENT_GLSL, PIGMENT_SEEDS, pigTint, pigmentCensus, pigmentOf,
} from '../../src/world/voxel/pure.js';
import { read, reporter, selfTest } from './lib.mjs';

// THE MEADOW'S PIGMENT IS A FIELD AND NOT A DRAW, AND THIS IS WHAT SAYS SO.
//
// WHAT IT IS GUARDING AGAINST, in the two numbers that condemned what shipped
// before it. Blur a window of meadow at three cubes and ask how much of the
// light and dark survives: the day target keeps 0.516 of its variance, this
// render kept 0.151, and the TARGET WITH ITS OWN CUBES SHUFFLED -- the absolute
// floor of having no organisation at all -- keeps 0.066. We were nearer the
// shuffle than the picture. And between the palest and the darkest cube of ONE
// material under ONE light, the multiplier covered 0.10 to 6.18: sixty two to
// one, drawn independently for every cube. Those two facts are the same fact,
// and the committente sees it as a chequerboard.
//
// THE GATE RUNS WITHOUT A BROWSER, which is the whole reason the pigment became
// a pure function. A guard that could only ask this question of a screenshot
// would be asked once a session; this one is asked at every commit, because
// src/world/voxel/pigment.js answers under plain node. That is residuo 1 of
// E-FOND-PIANO11 spent on the thing it was opened for.
//
// TWO LEGS AND THEY ASK DIFFERENT QUESTIONS. The first is the FIELD's own --
// how much of the pigment's variance lives above three cubes, and how wide the
// band it is allowed is -- and it is always armed. The second is the PICTURE's,
// the measure the research published, and it needs a frame: pass one with
// --frame=<png> and it runs; without one it says so and does not pretend.
//
// WHY THE FIELD'S OWN SHARE IS THE ONE THAT IS GATED. The picture's share is a
// ratio whose denominator is the whole frame -- the orientation ladder, the
// relief, how much flank the eye sees -- and none of that is this file's. The
// unit that fitted this pigment measured the frame with the pigment switched OFF
// and read 0.259: two thirds of what the picture scores is the world's own, and
// a gate on the picture would be a gate on the mesher wearing this guard's name.
// The field's share is the pigment's alone.

const CUBI_DI_SFOCATURA = 3;
const LATO = 192;

// WHAT THE SHIPPED FIELD READS, and it is a reading and not a round number: the
// tune in pigment.js, walked over 36 864 columns, puts 0.540 of its own variance
// above three cubes. The floor is that reading less a tenth -- wider than
// anything a re-tuning inside the fitted family moves it by, and nowhere near
// the defect it exists for: with the slow octave taken out and its amplitude
// handed to the per-cube residue instead, the same measure reads 0.010.
const QUOTA_MINIMA = 0.45;

// AND THE BAND. What shipped covered 62 to 1; the target never lets a face fall
// below 0.365 of a cube top. This is not the picture's rung -- the pigment is
// only one of its terms -- it is the pigment's OWN spread, and it is held at a
// ceiling the fitted band clears with room: the fit landed on 2.39.
const BANDA_MASSIMA = 3.0;

/** Media mobile gaussiana separabile su una griglia quadrata. */
function sfoca(v, lato, sigma) {
  const r = Math.ceil(3 * sigma);
  const peso = [];
  let somma = 0;
  for (let d = -r; d <= r; d++) { const w = Math.exp(-d * d / (2 * sigma * sigma)); peso.push(w); somma += w; }
  const k = peso.map((w) => w / somma);
  const a = new Float64Array(lato * lato);
  const b = new Float64Array(lato * lato);
  for (let y = 0; y < lato; y++) {
    for (let x = 0; x < lato; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += v[y * lato + Math.min(lato - 1, Math.max(0, x + d))] * k[d + r];
      a[y * lato + x] = s;
    }
  }
  for (let y = 0; y < lato; y++) {
    for (let x = 0; x < lato; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += a[Math.min(lato - 1, Math.max(0, y + d)) * lato + x] * k[d + r];
      b[y * lato + x] = s;
    }
  }
  return b;
}

const varianza = (a) => {
  const mu = a.reduce((s, v) => s + v, 0) / a.length;
  return a.reduce((s, v) => s + (v - mu) ** 2, 0) / a.length;
};

/**
 * La quota del campo che sopravvive a una sfocatura di tre cubi.
 *
 * Il campo e' campionato per COLONNA, che e' l'unita' in cui e' definito, quindi
 * un cubo e' un campione e la sfocatura ha sigma tre.
 */
export function quotaDelCampo(tune = PIGMENT, lato = LATO) {
  const v = new Float64Array(lato * lato);
  for (let z = 0; z < lato; z++) for (let x = 0; x < lato; x++) v[z * lato + x] = pigTint(x, z, tune);
  const tot = varianza(v);
  if (tot <= 0) return 0;
  return varianza(sfoca(v, lato, CUBI_DI_SFOCATURA)) / tot;
}

/** Quanto e' larga la banda: il piu' chiaro sul piu' scuro che il campo consente. */
export const bandaDelCampo = (tune = PIGMENT) => tune.tintCeil / tune.tintFloor;

// IL FRAMMENTO DEL PRATO E NON IL FILE, che ne contiene due: il selciato legge
// tre mappe cotte dal pittore e i suoi sampler sono suoi. Una guardia che
// cercasse «sampler2D» in tutto il file accuserebbe il corridoio di una regola
// che non e' la sua, e -- peggio -- diventerebbe verde il giorno che qualcuno
// togliesse le mappe al selciato per farla tacere.
const sorgente = read('src/world/voxel/material.js');
const fragment = sorgente.slice(sorgente.indexOf('const FRAGMENT ='),
  sorgente.indexOf('// THE PAVING: THE MATERIAL OF A CORRIDOR'));

/** Il pigmento e' una funzione della COLONNA: la chiamata non porta la quota. */
// LA DOMANDA NON E' CAMBIATA, LO E' LA FORMA DELLA RISPOSTA. Quel che questa
// guardia difende e' che il pigmento sia una funzione della COLONNA e mai
// dell'altezza del cubo: una cima e il fianco sotto di lei portano una tinta
// sola, che e' quel che rende compatta la famiglia chiara e riporta il gradino
// piu' basso a essere la sola scala d'orientamento.
//
// PERCHE' IL LETTERALE SI E' MOSSO. U-ERBA-1 ha messo nel mondo una quarta
// famiglia disegnata a META' PASSO -- il manto di fili da 5 cm -- e per lei
// `cell` non e' piu' la colonna del mondo, e' il cubo da cinque centimetri. Il
// frammento risolve la colonna a parte (`column`, che e' `cell.xz` per il
// rapporto fra il passo del materiale e quello del magazzino: uno per il suolo,
// un mezzo per il manto) e chiede il pigmento a QUELLA. E' la stessa domanda
// posta bene: al passo del suolo `column` e' `cell.xz` esatta, e il manto
// disegna il campo del mondo invece di uno suo alla frequenza doppia.
//
// Quel che la riga rifiuta e' invariato: l'altezza non entra, in nessuna forma.
// Il letterale e' PROPOSTO da U-ERBA-1 (verbale, sezione U-ERBA-1).
export const perColonna = (testo) => /pigmentOf\(column\.x,\s*column\.y\)/.test(testo)
  && /vec2 column = floor\(cell\.xz \* uCellRatio\)/.test(testo)
  && !/pigmentOf\([^)]*cell\.y/.test(testo)
  && !/column\s*[*+]=?\s*cell\.y/.test(testo);

/** I semi stanno in un posto solo: il GLSL li porta dall'oggetto, non a mano. */
export const semiCondivisi = (glsl, seeds) => Object.values(seeds)
  .every((pair) => pair.every((v) => glsl.includes(String(v))));

if (process.argv.includes('--self')) {
  const senzaLento = { ...PIGMENT, slow: 0, mid: 0.5, grain: 0.5 };
  const soloCubo = { ...PIGMENT, slow: 0, mid: 0, grain: 1.0 };
  selfTest('guard-campo-lento', [
    {
      what: 'a field with the slow octave taken out is caught',
      caught: quotaDelCampo(senzaLento) < QUOTA_MINIMA,
    },
    {
      what: 'and one that is a draw per cube and nothing else is caught',
      caught: quotaDelCampo(soloCubo) < QUOTA_MINIMA,
    },
    {
      what: 'the band that shipped before this pass -- 0.10 to 6.18, sixty two to one -- is caught',
      caught: bandaDelCampo({ tintFloor: 0.10, tintCeil: 6.18 }) > BANDA_MASSIMA,
    },
    {
      what: 'a floor let down to a tenth is caught even at the shipped ceiling',
      caught: bandaDelCampo({ ...PIGMENT, tintFloor: 0.10 }) > BANDA_MASSIMA,
    },
    {
      what: 'a pigment call that takes the cube\'s height back is caught',
      caught: !perColonna('vec3 albedo = pigmentOf(cell.x, cell.y, cell.z);'),
    },
    {
      what: 'and one that reaches the height beside the column is caught',
      caught: !perColonna('vec2 column = floor(cell.xz * uCellRatio);\n'
        + 'vec3 albedo = pigmentOf(column.x, column.y) * f(cell.y);\n pigmentOf(cell.x + cell.y, cell.z)'),
    },
    {
      what: 'a shader carrying its own copy of a seed is caught',
      caught: !semiCondivisi(PIGMENT_GLSL.replace(String(PIGMENT_SEEDS.mid[0]), '21.4'), PIGMENT_SEEDS),
    },
    {
      what: 'the null: the same tune read twice gives the same share to the last digit',
      caught: quotaDelCampo(PIGMENT) === quotaDelCampo(PIGMENT),
    },
  ]);
}

const report = reporter('guard-campo-lento -- the pigment is a field in the world, not a draw per cube');

const quota = quotaDelCampo();
const banda = bandaDelCampo();
const censo = pigmentCensus('meadow');

report.line(`  the field: zones ${PIGMENT.slowCubes} cubes, cube octave ${PIGMENT.midCubes}, `
  + `amplitudes ${PIGMENT.slow} / ${PIGMENT.mid} / ${PIGMENT.grain}`);
report.line(`  the band:  ${PIGMENT.tintFloor} to ${PIGMENT.tintCeil}   `
  + `median ${censo.p50}, sd ${censo.sd}, ${(censo.atFloor * 100).toFixed(1)}% on the floor, `
  + `${(censo.atCeil * 100).toFixed(1)}% on the ceiling`);
report.line('');

report.check(quota >= QUOTA_MINIMA,
  `${(CUBI_DI_SFOCATURA)} cubes of blur leave at least ${QUOTA_MINIMA} of the pigment's own variance`,
  `${quota.toFixed(3)} over ${LATO * LATO} columns `
  + `(a draw per cube and nothing else reads ${quotaDelCampo({ ...PIGMENT, slow: 0, mid: 0, grain: 1 }).toFixed(3)})`);

report.check(banda <= BANDA_MASSIMA,
  `the palest column stands no more than ${BANDA_MASSIMA} times the darkest`,
  `${banda.toFixed(3)} to one  (what shipped before this pass: 62 to one)`);

report.check(perColonna(fragment),
  'the meadow asks the pigment for a column and not for a cube',
  'a top face and the flank under it carry one tint, which is what makes the bright family '
  + 'compact and what puts the deepest rung back to being the orientation ladder alone');

report.check(semiCondivisi(PIGMENT_GLSL, PIGMENT_SEEDS),
  'the shader reads its lattice seeds from the twin and does not keep its own',
  Object.entries(PIGMENT_SEEDS).map(([k, v]) => `${k} ${v.join('/')}`).join(', '));

report.check(!/sampler2D/.test(fragment),
  'and it still costs no texture read: the meadow declares no sampler at all',
  'the field is rebuilt in the fragment from the cube\'s own integer cell, so the greedy '
  + 'fusion keeps the 2.3-3.3x it is worth');

// ------------------------------------------------------- la gamba del quadro
const frame = process.argv.find((a) => a.startsWith('--frame='));
if (!frame) {
  report.note('the picture\'s own share was not asked: pass --frame=<png> to measure a frame. '
    + 'The field\'s share above is the pigment\'s alone and is what this guard gates.');
} else {
  const file = frame.slice('--frame='.length);
  const sharp = (await import('sharp')).default;
  // La finestra e il sigma sono quelli su cui la ricerca ha pubblicato i propri
  // numeri: 940,700,400x230 e dodici pixel sul target. Il sigma sale col cubo,
  // e il nostro cubo sta a 1,833 volte il suo, misurato con un righello solo sui
  // due quadri.
  const BOX = { left: 940, top: 700, width: 400, height: 230 };
  // Il sigma e' un LETTERALE e non una misura per fotogramma, perche' una
  // guardia il cui righello si rimisura a ogni scatto non ha un letterale da
  // difendere: 12 px sul target per 1,833, che e' il rapporto fra i due passi
  // del cubo letto con un solo stimatore sui due quadri alla posa che giudica.
  const SIGMA = 22;
  const lum = async (pipe) => {
    const { data, info } = await pipe.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const out = new Float64Array(info.width * info.height);
    for (let i = 0; i < out.length; i++) {
      out[i] = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
    }
    return out;
  };
  const piatto = await lum(sharp(file).extract(BOX));
  const lento = await lum(sharp(file).extract(BOX).blur(SIGMA));
  const share = varianza(lento) / varianza(piatto);
  report.line('');
  report.line(`  the picture, ${file}:`);
  report.line(`    ${share.toFixed(3)} of its variance survives a blur of ${SIGMA} px`);
  report.line('    the day target reads 0.516 at the same window and 12 px; the target with its');
  report.line('    own cubes shuffled reads 0.066, which is the floor of no organisation at all');
  report.note(`the picture's share at ${file} is ${share.toFixed(3)}: printed, not gated -- its `
    + 'denominator is the whole frame, and the relief in it is not this file\'s');
}

report.end(`the meadow's median column is ${ALBEDO.meadow.map((c, i) => (c * censo.p50).toFixed(4))
  .join(', ')}, the bare earth's ${pigmentOf('earth', 0, 0).map((v) => v.toFixed(4)).join(', ')} at the origin`);
