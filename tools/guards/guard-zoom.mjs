// GUARD-ZOOM -- IL FRONTE DELLA LOD NON SI MUOVE CON L'OBIETTIVO.
//
//   node tools/guards/guard-zoom.mjs [--self]
//
// «Vedo generare il prato a piu' punti quando cammino o ZOOMMO»: la meta' dello
// zoom di quella frase ha una causa sola e questo file la tiene chiusa. La
// regola che spediva metteva il fronte dove una cella copriva N PIXEL --
// `travelled * uPixelScale * uLodGain / uCell` -- e uPixelScale e' 2 tan(fov/2)
// diviso l'altezza del riquadro: stringere l'obiettivo da 44,2 a 25 gradi
// spostava ogni fronte di 1,83 volte, e lo stesso prato dallo stesso punto si
// ridisegnava con un'altra taglia di cella. Misurato (R2 §1.2): a fov 25 il
// livello 1 passava da 202.000 a 99.000 pixel.
//
// La regola che spedisce e' una DISTANZA IN METRI DAL CAMMINATORE. Non c'e' un
// fov dentro, e questa guardia lo afferma in tre modi diversi, perche' un
// commento che dice «non dipende dal fov» e una scala che lo contiene si
// scrivono con la stessa facilita'.
//
//   1. NEL SORGENTE: la scala di march() non nomina ne' uPixelScale ne' il
//      riquadro, e il frammento non ha piu' un uLodGain da guardare.
//   2. NELL'ARITMETICA: la scala rifatta qui, con i numeri del tier, da' gli
//      stessi fronti a ogni fov -- e la scala vecchia, rifatta accanto, non lo
//      fa, cosi' la guardia dimostra di saper vedere la differenza.
//   3. NELLA RICEVUTA: quello che il banco ha letto in pagina alla posa P,
//      scritto qui come AT_TODAY perche' un numero misurato una notte e mai
//      piu' guardato non e' una guardia.
import { read, reporter, selfTest } from './lib.mjs';
import { CAMPO, CAMPO_FAR_SHIFT } from '../../src/world/voxel/pure.js';
import { TIERS } from '../../src/core/quality.js';

// LA FINESTRA VICINA, in metri, che e' il vincolo dell'anello: oltre non esiste
// texel piu' fine di quaranta centimetri (campo-field.js: otto tessere da 6,4 m
// per lato e il camminatore nella tessera di mezzo).
const NEAR_WINDOW = 19.2;
// Quello che il banco di questa unita' ha letto alla posa fittata, sui punti
// del piano che il quadro mostra, a fov 44,199 contro fov 25.
const AT_TODAY = {
  primaCelleDiverse: 85.649,   // la legge in pixel: l'85% del prato cambia cella
  dopoCelleDiverse: 0,         // la legge in metri, a isteresi tolta
  primaDelta: 15.462,          // |delta| contro l'ingrandimento del quadro largo
  dopoDelta: 7.331,
};
const CEILING = { celleDiverse: 0.001, delta: 12 };

/** La scala in metri, esattamente come march() la sale. */
function ladderMetres({ near, step }, d, topLevel = 9) {
  let rung = near;
  let level = 0;
  while (d >= rung && level < topLevel) {
    level += 1;
    rung *= level < CAMPO_FAR_SHIFT ? step : 2;
  }
  return level;
}

/** E la scala in pixel, che e' quella che si sta togliendo. */
function ladderPixels({ gain, fov, height }, d, topLevel = 9) {
  const pixelScale = 2 * Math.tan((fov * Math.PI / 180) / 2) / height;
  let rung = Math.SQRT2 * CAMPO.cell / (pixelScale * gain);
  let level = 0;
  while (d >= rung && level < topLevel) { level += 1; rung *= 2; }
  return level;
}

const SAMPLES = [];
for (let d = 0.5; d <= 60; d += 0.5) SAMPLES.push(d);

/** Quanti punti cambiano livello fra due fov, sotto una legge. */
function movedByFov(law, a, b) {
  let moved = 0;
  for (const d of SAMPLES) if (law(a, d) !== law(b, d)) moved += 1;
  return moved;
}

const injected = process.argv.includes('--self');
const report = reporter('guard-zoom -- il fronte non insegue l\'obiettivo');

// ------------------------------------------------------------ 1. IL SORGENTE
const glsl = read('src/world/voxel/campo-material.js');
const march = glsl.slice(glsl.indexOf('Hit march('), glsl.indexOf('// ------------------------------------------------------------ one shading'));
const ladderText = march.slice(march.indexOf('float jitter'), march.indexOf('int floorLevel'));
report.check(!/uPixelScale/.test(ladderText),
  'la scala della LOD non nomina uPixelScale', `${ladderText.split('\n').length} righe`);
report.check(!/uLodGain/.test(glsl.replace(/\/\/[^\n]*/g, '')),
  'e il frammento non ha piu\' un guadagno in pixel da guardare');
report.check(/uniform float uLodNear;/.test(glsl) && /uniform float uLodStep;/.test(glsl)
  && /uniform vec2 uLodCentre;/.test(glsl),
  'i tre seggi della legge in metri sono dichiarati', 'uLodNear, uLodStep, uLodCentre');
report.check(/vec2 fromWalker = p\.xz - lodC;/.test(glsl)
  && /mix\(uLodCentre, uLodCentre2, lodSel \* uLodFade\)/.test(glsl),
  "e la distanza e' presa dal CAMMINATORE sul piano, non dall'occhio",
  "lodC e' un punto del segmento fra dov'era il camminatore e dov'e' ora: due sedute "
  + "del camminatore (U-CAMPO-2, la banda), nessuna della camera");
// E IL RIQUADRO NON ENTRA DALLA PORTA DI SERVIZIO. uPixelScale resta -- il
// prefiltro della lama, il giunto e lo spigolo sono in PIXEL e devono esserlo,
// perche' quella e' la scala a cui il sotto-campionamento vive -- ma ogni sua
// riga viva deve essere una di quelle, e il conto si fa sul codice senza i
// commenti, cosi' che una spiegazione non passi per un uso.
const live = glsl.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const sites = live.split('\n').map((l, i) => [i + 1, l.trim()])
  .filter(([, l]) => l.includes('uPixelScale'));
const ALLOWED = [
  'uniform float uPixelScale;',
  'float thin = span / max(distance(p, eye) * uPixelScale, 1e-6);',
  'float pixel = max(travelled * uPixelScale / lean, 1e-6);',
  'uPixelScale: { value: 0.002 },',
  'u.uPixelScale.value = size.y > 0 ? 2 * Math.tan(fov / 2) / size.y : 0.002;',
];
const stray = sites.filter(([, l]) => !ALLOWED.includes(l));
report.check(stray.length === 0,
  'ogni riga viva che nomina uPixelScale misura un pixel e non una distanza',
  stray.length ? stray.map(([n, l]) => `${n}: ${l}`).join(' | ')
    : `${sites.length} righe, tutte fra le cinque dichiarate`);

// --------------------------------------------------------- 2. L'ARITMETICA
for (const tier of TIERS) {
  const g = tier.groundDetail;
  report.check(typeof g === 'object' && g.near > 0 && g.step > 1,
    `il tier ${tier.id} dichiara un anello in metri`, JSON.stringify(g));
  const third = g.near * g.step * g.step;
  report.check(third <= NEAR_WINDOW,
    `e il terzo fronte del tier ${tier.id} cade dentro la finestra vicina`,
    `${third.toFixed(2)} m contro ${NEAR_WINDOW}`);
  const law = (fov, d) => ladderMetres(g, d);
  report.check(movedByFov(law, 44.199, 25) === 0,
    `nessun punto del prato cambia cella fra fov 44,2 e 25 al tier ${tier.id}`,
    `${SAMPLES.length} distanze da 0,5 a 60 m`);
}
// E LA GUARDIA SA VEDERE LA DIFFERENZA, che e' l'altra meta' di un'asserzione.
const pixelLaw = (fov, d) => ladderPixels({ gain: 24, fov, height: 941 }, d);
const wouldMove = movedByFov(pixelLaw, 44.199, 25);
report.check(wouldMove > SAMPLES.length * 0.3,
  'la legge in pixel, rifatta qui accanto, muove il fronte con l\'obiettivo',
  `${wouldMove} distanze su ${SAMPLES.length} cambiano cella`);

// ----------------------------------------------------------- 3. LA RICEVUTA
report.check(AT_TODAY.dopoCelleDiverse <= CEILING.celleDiverse,
  'in pagina, alla posa fittata, lo zoom non muove una cella',
  `${AT_TODAY.dopoCelleDiverse}% contro il ${AT_TODAY.primaCelleDiverse}% della legge in pixel`);
report.check(AT_TODAY.dopoDelta <= CEILING.delta,
  'e il quadro stretto e\' l\'ingrandimento di quello largo, non un altro disegno',
  `|delta| ${AT_TODAY.dopoDelta} contro ${AT_TODAY.primaDelta} prima, soglia ${CEILING.delta}`);
report.note('la ricevuta e\' del banco fondazione/lav/campo1-analisi.mjs alla posa vox-giorno, '
  + '1672x941, tier alto; il numero in pagina si riprende con quel banco.');

if (!injected) report.end();

// --------------------------------------------------------------- il contrario
const cases = [];
{
  // (a) la scala in metri che si lascia entrare il fov
  const bent = (fov, d) => ladderMetres(
    { near: 9 * (2 * Math.tan((fov * Math.PI / 180) / 2) / 941) / (2 * Math.tan((44.199 * Math.PI / 180) / 2) / 941),
      step: 1.45 }, d,
  );
  cases.push({ what: 'un anello che si allarga con l\'obiettivo',
    caught: movedByFov(bent, 44.199, 25) > 0 });
}
{
  // (b) un tier il cui terzo fronte esce dalla finestra vicina
  const g = { near: 9, step: 1.6 };
  cases.push({ what: 'un tier il cui terzo fronte cade oltre i 19,2 m',
    caught: g.near * g.step * g.step > NEAR_WINDOW });
}
{
  // (c) una scala che torna a chiamare uPixelScale, e una riga di uPixelScale
  // che non e' nessuna delle cinque dichiarate
  const bentText = ladderText.replace('uLodNear', 'uLodNear * uPixelScale');
  cases.push({ what: 'la scala che si rimette uPixelScale dentro',
    caught: /uPixelScale/.test(bentText) });
  cases.push({ what: 'una riga nuova che legge uPixelScale come una distanza',
    caught: !ALLOWED.includes('float far = uPixelScale * 24.0;') });
}
{
  // (d) una ricevuta che dice zero dove il banco ha letto l'85%
  cases.push({ what: 'una ricevuta sopra il soffitto',
    caught: !(AT_TODAY.primaCelleDiverse <= CEILING.celleDiverse) });
}
{
  // (e) e una legge in metri che, senza il ginocchio a FAR_SHIFT, non arriva
  // mai in fondo al mondo: quattrocento metri con passo 1,45 e nove livelli
  // fermano la scala a 9 * 1,45^8 = 197 m, e il raggio non esce dal riquadro.
  let rung = 9;
  for (let k = 1; k < 9; k += 1) rung *= 1.45;
  cases.push({ what: 'una scala senza ginocchio, che non copre il mondo',
    caught: rung < 400 });
}
selfTest('guard-zoom', cases);
