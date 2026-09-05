import {
  BASE_STEP, CENTRE, NO_COLUMN, PLATEAU, VOXEL, columnSpec, columnTop,
} from '../../src/world/voxel/pure.js';
import { groundHeightAt, storeCost } from '../../src/world/contracts.js';
import { flowerField } from '../../src/world/vegetation.js';
import { reporter, selfTest } from './lib.mjs';

// GUARD-CAMMINO -- QUELLO CHE UN PASSO COSTA AL FILO DEL CAMMINATORE.
//
// ===========================================================================
// PERCHE' ESISTE, E CHE COSA HA VISTO ACCADERE.
//
// E-DECISIONI12 chiede «minimo 30 fps stabili», e la parola che pesa e' la
// seconda. U-PERF-3 rese PIATTO il costo del mondo sulla scheda -- 14,6-17,8 ms
// da ogni posa -- e lascio' scritto che la camminata di dieci secondi NON era
// fluida lo stesso: p50 26,6 ms, punte a 84, identiche per i cubi e per il
// campo, col nullo piatto. U-PERF-4 le ha cacciate e NON ERANO SULLA SCHEDA:
// erano sul FILO, e la loro sorgente era una sola.
//
// IL DIFETTO, IN UNA FRASE. Il pavimento del camminatore
// (src/world/contracts.js) tiene il mondo in tessere di sedici colonne e le
// tagliava INTERE: 324 colonne di legge alla prima domanda su una tessera. E'
// il conto giusto per un PIEDE -- sei domande a fotogramma, tutte nella stessa
// tessera, e il taglio si ripaga dentro il passo. Non e' il conto giusto per il
// reticolo dei FIORI, che dal giorno in cui e' nato interroga quello stesso
// sedile su ogni candidato che semina, in ordine di RAGGIO: a diciotto metri
// una circonferenza tocca piu' tessere di quante la cache ne tenga, quindi ogni
// domanda era una prima domanda e ogni prima domanda tagliava 324 colonne per
// risponderne UNA.
//
// MISURATO, sulla spazzata da venticinque metri della famiglia lontana:
// 311.000 colonne di legge calcolate per posare 5.303 fiori -- CINQUANTANOVE
// COLONNE A FIORE -- e 743 ms di filo del camminatore per una spazzata, di una
// famiglia che spazza in continuazione finche' qualcuno cammina. Nella
// camminata di dieci secondi era il 76-80% di tutto il tempo speso.
//
// LA CURA: la tessera si riempie UNA COLONNA ALLA VOLTA, su domanda, per la
// stessa `columnSpec` e le stesse tre porte con cui `chunkColumns` scrive le
// proprie. Il piede paga una colonna invece di 324 e le altre gli arrivano
// sotto man mano; il lettore sparso paga esattamente quello che chiede.
//
// ===========================================================================
// COSA GATEA QUESTA GUARDIA, E PERCHE' PROPRIO QUESTO.
//
// 1. LA SEDE RIUSATA RISPONDE ANCORA LA LEGGE, NELL'ORDINE CHE LA SFRATTA.
//    La cura porta un rischio nuovo e uno solo: la tessera che esce dalla cache
//    viene RISEDUTA -- gli stessi array, un'origine nuova, e nulla azzerato
//    tranne il registro di quali colonne sono state corse. Se quel registro
//    sbagliasse, il pavimento risponderebbe la colonna del vecchio inquilino.
//    guard-piano gia' cammina tutte le 61.572 colonne del disco, ma le cammina
//    a scansione, dove gli sfratti sono pochi; questa le chiede in ordine di
//    RAGGIO, che e' l'ordine che sfratta, e confronta ogni risposta con la
//    legge.
//
// 2. E IL COSTO E' UN CONTEGGIO E NON UN CRONOMETRO. Quante colonne di legge
//    costa un fiore posato: e' il numero che e' regredito (59) ed e' il numero
//    che una riscrittura futura farebbe regredire di nuovo. Un conteggio si
//    gatea su qualsiasi macchina a qualsiasi carico, che e' quello che E-V5j
//    chiede a tutto cio' che si ASSERISCE invece di stamparlo. I millisecondi
//    di questa macchina si stampano e non si gateano.
// ===========================================================================

const report = reporter('guard-cammino -- il filo del camminatore, per un passo e per un fiore');

// --------------------------------------------------------------------------
// L'ORDINE CHE SFRATTA: gli stessi anelli del reticolo dei fiori, ordinati per
// distanza, che e' l'ordine in cui la famiglia lontana interroga il sedile.
// Un passo di mezzo metro su venticinque metri di raggio tocca quasi ottomila
// punti sparsi su piu' di novecento tessere, contro una cache che ne tiene
// sessantaquattro: la tessera media viene seduta e sfrattata piu' volte, che e'
// esattamente la condizione da provare.
// --------------------------------------------------------------------------
const STEP = 0.5;
const REACH = 25;
const ring = [];
for (let j = -Math.ceil(REACH / STEP); j <= Math.ceil(REACH / STEP); j += 1) {
  for (let i = -Math.ceil(REACH / STEP); i <= Math.ceil(REACH / STEP); i += 1) {
    const d = Math.hypot(i, j) * STEP;
    if (d > REACH) continue;
    ring.push({ x: CENTRE.x + i * STEP + 0.05, z: CENTRE.z + j * STEP + 0.05, d });
  }
}
ring.sort((a, b) => a.d - b.d);

/** What the law says the floor is, at the column a point stands on. */
function lawAt(x, z, shift = 0) {
  const top = columnTop(Math.floor(x / VOXEL) + shift, Math.floor(z / VOXEL), true, PLATEAU, true);
  return top === NO_COLUMN || top < -1e8 ? (BASE_STEP + 1) * VOXEL : (top + 1) * VOXEL;
}

/**
 * The floor against the law, over the whole ring, in the order that evicts.
 *
 * @param {number} step   a voxel added to what the seat answers: the drift of a
 *        floor that has come off the store by the smallest thing there is
 * @param {number} stale  a whole tile of shift on the column the law is asked
 *        about: what a reseated tile answering its old tenant would look like
 */
function floorFollowsTheLaw(step = 0, stale = 0) {
  for (const p of ring) {
    const said = groundHeightAt(p.x, p.z) + step * VOXEL;
    if (Math.abs(said - lawAt(p.x, p.z, stale)) > 1e-9) {
      return { off: p, said, want: lawAt(p.x, p.z, stale) };
    }
  }
  return null;
}

const strayed = floorFollowsTheLaw();
report.check(strayed === null,
  'la sede riusata risponde la legge su ogni punto, nell\'ordine che la sfratta',
  strayed ? `a ${strayed.off.x.toFixed(2)},${strayed.off.z.toFixed(2)} dice `
    + `${strayed.said.toFixed(3)} contro ${strayed.want.toFixed(3)}`
    : `${ring.length} punti su ${REACH} m di raggio, per distanza crescente`);

// --------------------------------------------------------------------------
// E LA TESSERA SFRATTATA NON SI PORTA DIETRO IL PROPRIO INQUILINO: le stesse
// domande, una seconda volta, dopo che ognuna ha sfrattato tutte le altre.
// --------------------------------------------------------------------------
let drift = 0;
for (let n = ring.length - 1; n >= 0; n -= 7) {
  const p = ring[n];
  if (Math.abs(groundHeightAt(p.x, p.z) - lawAt(p.x, p.z)) > 1e-9) drift += 1;
}
report.check(drift === 0,
  'e la stessa domanda, ripetuta dopo che ogni tessera e\' stata sfrattata, risponde uguale',
  drift ? `${drift} risposte sono cambiate` : `${Math.ceil(ring.length / 7)} punti ripresi a ritroso`);

// --------------------------------------------------------------------------
// QUANTO COSTA UN FIORE, IN COLONNE DI LEGGE.
//
// AT_TODAY. Il reticolo dei fiori e' il lettore sparso di questo sedile e il
// rapporto e' quello che U-PERF-4 ha riportato da 59 a 1: una colonna a fiore,
// che e' il minimo che si possa pagare, perche' un fiore sta su una colonna.
// Il tetto sta a 1,30 -- un quarto sopra l'oggi -- perche' sotto quel margine
// non c'e' nessuna riscrittura ragionevole, e sopra c'e' solo il ritorno del
// taglio intero, che vale cinquantanove.
// --------------------------------------------------------------------------
const CEILING = 1.30;
const AT_TODAY = { 7.05: 1.018, 25: 1.063, 35: 0.993 };

flowerField(groundHeightAt, 3);

/** Columns of law the lattice of one radius costs, and the flowers it placed. */
function latticeCost(radius) {
  const before = storeCost();
  const started = process.hrtime.bigint();
  const flowers = flowerField(groundHeightAt, radius);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const columns = storeCost().columns - before.columns;
  return {
    radius, flowers: flowers.length, columns, ms, per: columns / flowers.length,
  };
}

/**
 * The same reading with a defect added to it, in columns.
 *
 * The injection is applied to a MEASUREMENT and not to a second run of the
 * lattice: a second run would find the cache warm and would be reading the
 * warm case rather than the one the gate is about.
 */
const inflated = (leg, extra) => (leg.columns + extra) / leg.flowers;

const legs = [7.05, REACH, PLATEAU].map((r) => latticeCost(r));
for (const leg of legs) {
  report.check(leg.per <= CEILING,
    `il reticolo a ${String(leg.radius).padStart(5)} m costa al piu' ${CEILING} colonne di legge a fiore`,
    `${leg.per.toFixed(3)} (AT_TODAY ${AT_TODAY[leg.radius].toFixed(3)}), `
    + `${leg.columns} colonne per ${leg.flowers} fiori, ${leg.ms.toFixed(0)} ms su questa macchina`);
}

// --------------------------------------------------------------------------
// E IL PIEDE NON HA PERSO NULLA. Un passo e' sei domande vicine, e la tessera
// che le raccoglie va corsa una colonna alla volta senza mai correrne una due
// volte: la cura non deve aver comprato il lettore sparso col camminatore.
// --------------------------------------------------------------------------
const foot = storeCost();
let steps = 0;
for (let z = -10; z <= 10; z += 0.2) {
  for (const dx of [-0.25, 0, 0.25]) {
    groundHeightAt(CENTRE.x + dx, CENTRE.z + z);
    steps += 1;
  }
}
const perAsk = (storeCost().columns - foot.columns) / steps;
report.check(perAsk <= 1,
  'e un piede che cammina non corre mai una colonna due volte',
  `${(perAsk * steps).toFixed(0)} colonne per ${steps} domande (${perAsk.toFixed(3)} a domanda)`);

// --------------------------------------------------------------------------
// LA LEGGE E' UNA SOLA: la colonna che questo sedile posa e quella che il
// mesher posa sono la stessa dichiarazione, e la prova sta in guard-piano su
// tutte le 61.572 colonne del disco. Qui si ripete solo il perno -- che il
// sedile non abbia cominciato a rispondere di un mondo diverso da quello a cui
// e' tagliato: l'altopiano, col confine oltre.
// --------------------------------------------------------------------------
const beyond = columnSpec(Math.round(90 / VOXEL), Math.round(CENTRE.z / VOXEL), false, PLATEAU, true);
const outside = groundHeightAt(90, CENTRE.z);
report.check(Math.abs(outside - (beyond.top + 1) * VOXEL) < 1e-9,
  'e risponde del MONDO e non del disco: oltre l\'altopiano il pavimento e\' il confine',
  `a 90 m: ${outside.toFixed(2)} m`);

if (process.argv.includes('--self')) {
  // Ogni difetto e' iniettato QUI e non da una maniglia della riga di comando:
  // una guardia che si prova solo quando qualcuno si ricorda il flag giusto e'
  // una guardia che nessuno ha visto fallire.
  selfTest('guard-cammino', [
    {
      what: 'un pavimento scostato di un voxel dalla legge',
      caught: floorFollowsTheLaw(1, 0) !== null,
    },
    {
      what: 'una tessera riseduta che risponde l\'inquilino di prima',
      caught: floorFollowsTheLaw(0, 16) !== null,
    },
    {
      // Il difetto vero, riportato sulla misura appena presa: 323 colonne in
      // piu' a domanda sono il taglio intero della tessera meno la colonna che
      // serviva davvero.
      what: 'il ritorno del taglio intero (una tessera per domanda)',
      caught: inflated(legs[0], 323 * legs[0].flowers) > CEILING,
    },
    {
      // E il tetto non e' largo a piacere: mezza colonna in piu' a fiore -- un
      // centoventesimo del difetto -- e' gia' fuori. Un tetto che lasciasse
      // passare questo non gaterebbe nulla.
      what: 'e mezza colonna in piu\' a fiore, che e\' un centoventesimo del difetto',
      caught: inflated(legs[0], Math.ceil(0.5 * legs[0].flowers)) > CEILING,
    },
  ]);
}

report.end(legs.map((l) => `${l.radius} m: ${l.per.toFixed(2)} col/fiore in ${l.ms.toFixed(0)} ms`).join('   '));
