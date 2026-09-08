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
import { braceBody, read, reporter, selfTest } from './lib.mjs';
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
//
// ==========================================================================
// E IL SORGENTE SI LEGGE PER DATAFLOW, NON A FETTE DI TESTO. QUESTO E' IL
// DEBITO CHE U-GUARDIA-3 HA CENSITO SU QUESTO FILE.
//
// Cio' che stava qui tagliava il sorgente su due segnalibri di PROSA -- una
// riga di banner con il suo numero esatto di trattini, «one shading», e due
// nomi di variabile -- e poi cercava `uPixelScale` dentro la fetta. Tre modi di
// rompersi, tutti e tre con una modifica CORRETTA del materiale: ribattezzare
// il banner (e allora `indexOf` torna -1, la fetta diventa tutt'altro e il
// verdetto e' un caso), spostare le due righe che facevano da estremi, o
// semplicemente rientrare il blocco.
//
// La domanda vera non e' «in quel tratto di testo compare questo nome»: e' «la
// SCALA della LOD e' calcolata a partire dal riquadro». Cioe' e' una domanda di
// DATAFLOW, ed e' la stessa forma con cui U-GUARDIA-3 ha rifatto guard-zone sul
// programma compilato: per ogni statement che SCRIVE un nome, il suo lato
// destro nomina questo termine? Cosi' posta sopravvive a qualunque
// riformattazione, e per giunta e' PIU' larga di prima -- prende uPixelScale
// che entri nella scala da qualunque punto di march(), non solo fra i due
// segnalibri.
// ==========================================================================
const glsl = read('src/world/voxel/campo-material.js');

/** Il corpo di una funzione, presa per nome e chiusa dalle sue graffe. */
function bodyOf(text, signature) {
  const at = text.indexOf(signature);
  if (at < 0) return null;
  const open = text.indexOf('{', text.indexOf(')', at));
  return open < 0 ? null : braceBody(text, open);
}

/**
 * Ogni statement che scrive un nome, e cio' che il suo lato destro nomina.
 *
 * La stessa lettura che `lib/quadro.mjs` fa sul programma COMPILATO, qui sul
 * sorgente: i commenti escono per primi, cosi' che una spiegazione non passi
 * mai per un uso.
 */
export function writesIn(text) {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const out = [];
  for (const statement of bare.split(';')) {
    const m = /(?:^|[\s{}()])([A-Za-z_]\w*)\s*(\*=|\+=|-=|\/=|=)(?!=)([\s\S]*)$/.exec(statement);
    if (m) out.push({ lhs: m[1], op: m[2], rhs: m[3] });
  }
  return out;
}

// I NOMI CHE SONO LA SCALA, che e' cio' che questo file possiede davvero. Un
// nome e' una parola sola: ribattezzarne uno e' una riga di questa lista, dove
// prima bastava rientrare un blocco per perdere il verdetto.
const LADDER_TERMS = ['jitter', 'lodRung', 'lodRung2', 'step2', 'lodFloor', 'far2',
  'floorLevel', 'level', 'lodSel', 'lodC'];

/** Gli statement della scala della LOD che nominano un termine, per dataflow. */
const ladderReading = (text, token) => writesIn(text)
  .filter((w) => LADDER_TERMS.includes(w.lhs) && w.rhs.includes(token));
/** E quanti statement della scala il lettore ha trovato in tutto. */
const ladderWrites = (text) => writesIn(text).filter((w) => LADDER_TERMS.includes(w.lhs));

const march = bodyOf(glsl, 'Hit march(');
report.check(march !== null && ladderWrites(march).length >= 8,
  'la scala della LOD si trova per i nomi che scrive, non per un segnalibro di prosa',
  march === null ? 'march() non trovata: il lettore non ha morso niente'
    : `${ladderWrites(march).length} statement scrivono i ${LADDER_TERMS.length} nomi della scala, `
    + `su ${writesIn(march).length} di march()`);
report.check(march !== null && ladderReading(march, 'uPixelScale').length === 0,
  'e nessuno di essi nomina uPixelScale: la scala non e in pixel',
  ladderReading(march || '', 'uPixelScale').map((w) => `${w.lhs} <- ${w.rhs.trim()}`).join(' | ')
    || `${writesIn(march || '').filter((w) => w.rhs.includes('uPixelScale')).length} statement `
    + 'di march() lo nominano, e nessuno e della scala');
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
// perche' quella e' la scala a cui il sotto-campionamento vive -- ma ogni suo
// uso vivo deve essere uno di quelli.
//
// ==========================================================================
// E LA LISTA E' DI RUOLI, NON DI RIGHE. IL SECONDO DEBITO DI QUESTO FILE.
//
// Cio' che stava qui teneva CINQUE RIGHE DI SORGENTE confrontate per uguaglianza
// esatta dopo un `trim()`. Una rientratura la passava -- il trim c'era apposta
// -- ma tutto il resto no: spezzare una riga lunga in due, scrivere `max(1e-6,
// x)` invece di `max(x, 1e-6)`, scrivere `0.000001` invece di `1e-6`,
// ribattezzare `span` in `width`, aggiungere uno spazio. Cinque modi di
// mandare in rosso una modifica corretta, e per una guardia che va in rosso a
// vuoto c'e' un solo esito: qualcuno la spegne.
//
// Cio' che questo file possiede non e' il testo di cinque righe: e' che
// uPixelScale abbia solo QUATTRO RUOLI, e ognuno dei quattro si riconosce dalla
// forma dello statement e non dai suoi caratteri.
//
//   * la DICHIARAZIONE della uniform;
//   * il suo SEGGIO nella tavola delle uniform del materiale;
//   * la DERIVAZIONE, l'unico posto dove il valore viene calcolato, dal
//     bersaglio legato (che e' quello che guard-campo3 tiene dall'altra parte);
//   * una MISURA: uno statement che scrive uno dei termini in pixel dichiarati
//     qui sotto per nome.
//
// Gli statement si tagliano sul punto e virgola dopo aver tolto i commenti,
// quindi una riga spezzata in tre resta uno statement solo e una riga inserita
// in mezzo non sposta niente. Cio' che resta appuntato sono DUE PAROLE -- i
// nomi dei due termini in pixel -- e un nome ribattezzato e' una riga di questa
// lista da aggiornare, con il verdetto che lo dice.
// ==========================================================================

/**
 * I termini in PIXEL, per nome, e cos'e' ciascuno.
 *
 * U-CAMPO-1 §9 (RESTA): «ogni termine in pixel ... sono la scala del
 * sotto-campionamento e devono esserlo». Sono questi due e nessun altro.
 */
const PIXEL_TERMS = [
  { name: 'thin', what: 'il prefiltro della lama: quanti pixel e larga una lama' },
  { name: 'pixel', what: 'il giunto e lo spigolo: quanti metri copre un pixel alla marcia' },
];

/** Gli statement vivi che nominano un termine, uno per punto e virgola. */
const statementsNaming = (text, token) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.includes(token));

/** Il nome che uno statement scrive, se ne scrive uno. */
const lhsOf = (statement) => {
  const m = /(?:^|[\s{}()])([A-Za-z_]\w*)\s*(?:\*=|\+=|-=|\/=|=)(?!=)/.exec(statement);
  return m ? m[1] : null;
};

/** I quattro ruoli, per forma. */
const ROLES = [
  { role: 'dichiarazione', is: (s) => /\buniform\s+\w+\s+uPixelScale\b/.test(s) },
  { role: 'seggio', is: (s) => /\buPixelScale\s*:/.test(s) },
  { role: 'derivazione', is: (s) => /\buPixelScale\s*\.\s*value\s*=/.test(s) },
  { role: 'misura', is: (s) => PIXEL_TERMS.some((t) => lhsOf(s) === t.name) },
];

/** Quali usi vivi di uPixelScale non stanno in nessuno dei quattro ruoli. */
const strayIn = (text) => statementsNaming(text, 'uPixelScale')
  .filter((s) => !ROLES.some((r) => r.is(s)))
  .map((s) => s.replace(/\s+/g, ' ').slice(0, 90));

/** E quali ruoli il lettore ha effettivamente trovato: un ruolo vuoto e un buco. */
const rolesIn = (text) => {
  const statements = statementsNaming(text, 'uPixelScale');
  return ROLES.filter((r) => statements.some((s) => r.is(s))).map((r) => r.role);
};

const stray = strayIn(glsl);
const roles = rolesIn(glsl);
report.check(roles.length === ROLES.length,
  'i quattro ruoli di uPixelScale sono tutti e quattro in piedi',
  `${roles.join(', ')} -- e i termini in pixel sono ${PIXEL_TERMS.map((t) => t.name).join(' e ')}`);
report.check(stray.length === 0,
  'e ogni altro uso vivo di uPixelScale misura un pixel e non una distanza',
  stray.length ? stray.join(' | ')
    : `${statementsNaming(glsl, 'uPixelScale').length} statement, tutti in uno dei quattro ruoli`);

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
  // (c) LA SCALA CHE SI RIMETTE IL RIQUADRO DENTRO, chiesta al lettore vero.
  //
  // Quello che stava qui tagliava una fetta di testo, ci sostituiva un nome
  // dentro e poi cercava `uPixelScale` nella fetta: non passava mai dal
  // predicato del run, quindi il giorno che il lettore sbagliava il caso
  // andava verde lo stesso. Adesso il difetto si scrive in march() e la
  // risposta torna da `ladderReading`, che e' esattamente cio' che il run
  // chiama.
  const bentMarch = march.replace('float lodRung = uLodNear * jitter',
    'float lodRung = uLodNear * jitter * uPixelScale');
  cases.push({ what: 'la scala che si rimette uPixelScale dentro',
    caught: ladderReading(bentMarch, 'uPixelScale').length === 1
      && ladderReading(march, 'uPixelScale').length === 0 });
  // E LA LAMA CHE RESTA IN PIXEL NON E' UN DIFETTO, che e' l'altra meta': il
  // lettore separa i due, e march() ne contiene uno di ciascun tipo.
  cases.push({ what: 'ma il prefiltro della lama, che in pixel ci sta di diritto, non e scambiato per la scala',
    caught: writesIn(march).some((w) => w.rhs.includes('uPixelScale'))
      && ladderReading(march, 'uPixelScale').length === 0 });
  // E UN SEGNALIBRO CHE SPARISCE NON E' UN VERDETTO. Con la fetta di testo,
  // ribattezzare il banner faceva tornare -1 a `indexOf` e il verdetto
  // diventava un caso; adesso una march() che non si trova e' un rosso che lo
  // dice.
  cases.push({ what: 'un march() che non si trova piu, che prima diventava una fetta a caso',
    caught: bodyOf(glsl, 'Hit marciare(') === null && bodyOf(glsl, 'Hit march(') !== null });

  // (d) UN USO NUOVO CHE LEGGE uPixelScale COME UNA DISTANZA.
  //
  // Quello che stava qui chiedeva se l'array ALLOWED di QUESTO file contenesse
  // una stringa che non conteneva: una costante vera che non toccava ne' il
  // sorgente ne' il predicato (U-GUARDIA-3, E-IGIENE). Adesso la riga entra nel
  // sorgente vero e la risposta torna dal predicato vero.
  const withStray = glsl.replace('uniform float uPixelScale;',
    'uniform float uPixelScale;\n  float far = uPixelScale * 24.0;');
  cases.push({ what: 'una riga nuova che legge uPixelScale come una distanza',
    caught: strayIn(withStray).length === 1 && strayIn(glsl).length === 0 });
  // E LA STESSA RIGA SCRITTA DENTRO UN TERMINE IN PIXEL non e' un difetto:
  // e' esattamente cio' che i due nomi dichiarati esistono per permettere.
  const withMeasure = glsl.replace('uniform float uPixelScale;',
    'uniform float uPixelScale;\n  float pixel = uPixelScale * 24.0;');
  cases.push({ what: 'mentre la stessa riga che scrive un termine in pixel passa',
    caught: strayIn(withMeasure).length === 0 });

  // (e) E QUESTA E' LA PROVA CHE LO SPILLO E' TOLTO: i quattro usi che
  // spediscono, RIFORMATTATI nei cinque modi che la lista di righe non
  // sopravviveva -- la riga lunga spezzata in tre, gli argomenti di `max`
  // scambiati, `1e-6` scritto per esteso, un nome locale ribattezzato, una
  // riga inserita in mezzo al seggio -- e nessuno dei quattro diventa un
  // intruso.
  const reformatted = glsl
    .replace('float thin = span / max(distance(p, eye) * uPixelScale, 1e-6);',
      'float thin =\n            span\n            / max(0.000001, distance(p, eye) * uPixelScale);')
    .replace('float pixel = max(travelled * uPixelScale / lean, 1e-6);',
      'float pixel = max(\n      0.000001,\n      travelled * uPixelScale / lean\n    );')
    .replace('uPixelScale: { value: 0.002 },',
      '// il seggio, con una riga di spiegazione in mezzo\n      uPixelScale: {\n        value: 0.002,\n      },')
    .replace('u.uPixelScale.value = size.y > 0 ? 2 * Math.tan(fov / 2) / size.y : 0.002;',
      'u.uPixelScale.value = side > 0\n      ? 2 * Math.tan(fov / 2) / side\n      : 0.002;')
    .replace('uniform float uPixelScale;', 'uniform   float   uPixelScale;');
  // E LA RIFORMATTAZIONE DEVE ESSERE AVVENUTA DAVVERO, altrimenti il caso e'
  // verde per non aver fatto niente: nessuna delle cinque righe di prima
  // sopravvive, e questa e' precisamente la lista che il predicato di prima
  // confrontava carattere per carattere.
  const WERE_PINNED = [
    'uniform float uPixelScale;',
    'float thin = span / max(distance(p, eye) * uPixelScale, 1e-6);',
    'float pixel = max(travelled * uPixelScale / lean, 1e-6);',
    'uPixelScale: { value: 0.002 },',
    'u.uPixelScale.value = size.y > 0 ? 2 * Math.tan(fov / 2) / size.y : 0.002;',
  ];
  cases.push({ what: 'e i quattro usi che spediscono, riformattati in cinque modi, restano quattro ruoli e nessun intruso',
    caught: WERE_PINNED.every((l) => glsl.includes(l) && !reformatted.includes(l))
      && strayIn(reformatted).length === 0 && rolesIn(reformatted).length === 4 });
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
