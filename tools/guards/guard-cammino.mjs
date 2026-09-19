import {
  BASE_STEP, CENTRE, NO_COLUMN, PLATEAU, VOXEL, columnSpec, columnTop,
} from '../../src/world/voxel/pure.js';
import { groundHeightAt, storeCost } from '../../src/world/contracts.js';
import { flowerField } from '../../src/world/vegetation.js';
import { readFileSync } from 'node:fs';
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
// 3. E L'ARRIVO NON SINGHIOZZA. Il passo e' meta' della domanda del
//    committente; l'altra meta' e' il primo minuto, ed e' quella che ogni
//    visitatore paga una volta sola e non dimentica. La gamba dell'arrivo legge
//    una traccia presa dalla pagina (fondazione/lav/p4-arrivo.mjs) e chiede due
//    cose di ogni fotogramma DOPO il primo quadro visibile: quanto e' costato
//    al filo, e quanto tempo e' passato prima che arrivasse il successivo. Il
//    primo quadro sta fuori dal conto per definizione -- prima di lui non c'e'
//    un arrivo da rovinare, e quel costo e' l'apertura della pagina.
//
//    E SI LEGGE L'INTERVALLO E NON SOLO LA CPU, che e' la lezione di U-CONF-1.
//    La misura di E-PERF4 contava solo il tempo DENTRO la callback di
//    requestAnimationFrame e riporto' tre singhiozzi da 414, 977 e 488 ms. Il
//    grosso non era li': erano otto secondi di getImageData su tele filtrate
//    dentro engrave(), che gira nella continuazione di un
//    `await requestAnimationFrame` e cade nel BUCO fra due fotogrammi invece
//    che dentro uno. Sedici secondi di filo bloccato su ventuno, invisibili a
//    chi guardava solo la CPU.
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

// --------------------------------------------------------------------------
// L'ARRIVO: QUANTO COSTA UN FOTOGRAMMA DOPO IL PRIMO QUADRO VISIBILE.
//
// I MILLISECONDI SI GATEANO QUI E ALTROVE NO, ed e' una differenza di natura e
// non un'eccezione. Il costo di un fiore e' un CONTEGGIO e vale su qualunque
// macchina a qualunque carico; l'arrivo e' fatto di cose che solo un orologio
// vede -- un driver che compila, una tela che si rilegge -- e non esiste un
// conteggio che le rappresenti. Quindi qui si gatea il millisecondo, ma di una
// TRACCIA PRESA e consegnata sulla riga di comando, mai di una corsa fatta
// dentro la guardia: la guardia e' lo strumento e la soglia, la macchina e' di
// chi misura, e senza tracce questa gamba dichiara di non avere niente da
// mordere invece di inventarsi un numero (E-V5j).
//
//   node tools/guards/guard-cammino.mjs fondazione/lav/c1-arr-warm-1.json
//
// AT_TODAY, tier alto, tre corse di questa scrivania (U-CONF-1):
//
//   prima  fotogramma peggiore 1627-2247 ms, buco peggiore 5119-5251 ms,
//          filo bloccato 16,0-16,8 s su un arrivo di 21,0-21,5 s
//   oggi   fotogramma peggiore   254-290 ms, buco peggiore   921-1193 ms,
//          filo bloccato  7,8- 8,3 s su un arrivo di 14,1-14,6 s
//
// I TETTI STANNO UN TERZO SOPRA L'OGGI E MOLTO SOTTO IL DIFETTO, che e' l'unico
// posto in cui un tetto significhi qualcosa. L'OBIETTIVO DEL MANDATO -- nessun
// fotogramma sopra i 50 ms -- NON E' PRESO, e il tetto non finge che lo sia:
// quel che resta e' scritto nel verbale (il residuo di engrave e i programmi
// che il preriscaldamento non copre), e il giorno che qualcuno lo prende questi
// due numeri scendono con lui.
//
// 2026-09-08 (U-PERF-6), tre corse a scrivania scarica, e IL NUMERO E'
// PEGGIORATO -- va detto qui e non solo in un verbale:
//
//   oggi   fotogramma peggiore   545-699 ms, buco peggiore   583-750 ms,
//          filo occupato 2,85-2,98 s in totale, primo callback a 0,91-1,02 s
//
// Due blocchi soli sopra i 50 ms: il PRIMO QUADRO (407-543 ms, che questa gamba
// non gatea perche' e' l'apertura della pagina) e UNO NUOVO a 3,2-4,9 s da
// 545-699 ms, che E-CONF1 non aveva. Non e' una texture, non e' un messaggio di
// lavoratore e non e' una tela 2D: una sonda che cronometra `texImage2D`,
// `bufferData`, `linkProgram`, `getImageData` e ogni `onmessage` gli attribuisce
// 11 ms su 640. E' JS sul filo dentro una callback di rAF, ed e' arrivato con
// gli strati che E-CONF1 non aveva davanti (colline, lago, nuvole voxel, fiori
// alla taglia, avatar).
//
// IL TETTO NON SI ALZA PER FARLO PASSARE. Alzare un tetto perche' la misura lo
// ha superato e' il modo esatto in cui una guardia smette di essere una
// guardia: 400 ms resta, la traccia di oggi lo sfora, e questo e' il residuo
// che porta il nome del suo proprietario nel verbale invece di sparire.
// --------------------------------------------------------------------------
const ARRIVAL_FRAME_MS = 400;
const ARRIVAL_GAP_MS = 1600;

/**
 * What an arrival trace says about the frames AFTER the first visible one.
 *
 * @param {object} trace   what fondazione/lav/p4-arrivo.mjs wrote
 * @param {number} addMs   a defect added to the worst frame, for the self test
 * @param {number} addGap  the same, for the worst interval
 */
export function arrivalCost(trace, addMs = 0, addGap = 0) {
  const frames = trace.frames || [];
  if (frames.length < 2) return null;
  // The first frame is the page opening, and it is not a hiccup in anybody's
  // arrival: what is gated is what happens to somebody already looking.
  const after = frames.slice(1);
  const worstFrame = Math.max(...after.map((f) => f.cpu)) + addMs;
  const worstGap = Math.max(...after.map((f) => f.dt)) + addGap;
  return {
    frames: frames.length,
    firstMs: frames[0].t,
    worstFrame,
    worstGap,
    // How long the thread was handing out no frames at all, over the trace.
    blockedS: after.reduce((sum, f) => sum + Math.max(0, f.dt - 17), 0) / 1000,
    spanS: frames[frames.length - 1].t / 1000,
    ok: worstFrame <= ARRIVAL_FRAME_MS && worstGap <= ARRIVAL_GAP_MS,
  };
}

// La traccia sintetica del self test: il primo quadro caro come oggi, e poi il
// peggior fotogramma e il peggior buco che le tre corse di oggi hanno reso.
const TODAY = {
  frames: [
    { t: 1100, dt: 0, cpu: 880 },
    { t: 4000, dt: 60, cpu: 290 },
    { t: 5500, dt: 1193, cpu: 100 },
    { t: 6000, dt: 17, cpu: 8 },
  ],
};

// LE SCHEDE DELLA TERRA NON SONO TRACCE DELL'ARRIVO, e la riga di comando le
// porta tutte e due. Si scelgono per NOME e non per estensione: due gambe che
// leggono ogni .json che passa si contendono la stessa riga di comando e la
// seconda dichiara rossa la consegna della prima.
const traces = process.argv.slice(2).filter((a) => a.endsWith('.json') && !/(c3|p6)-/.test(a));
if (traces.length === 0) {
  process.stdout.write("  NOTE  nessuna traccia dell'arrivo consegnata, quindi si e' chiesto solo lo "
    + 'strumento. Prendine con fondazione/lav/p4-arrivo.mjs e passale qui.\n');
} else {
  for (const path of traces) {
    const seen = arrivalCost(JSON.parse(readFileSync(path, 'utf8')));
    const name = path.split(/[\\/]/).pop();
    report.check(seen !== null && seen.ok,
      `l'arrivo di ${name} non porta un fotogramma sopra ${ARRIVAL_FRAME_MS} ms `
      + `ne' un buco sopra ${ARRIVAL_GAP_MS}`,
      seen === null ? 'la traccia non ha fotogrammi'
        : `peggiore ${seen.worstFrame.toFixed(0)} ms, buco ${seen.worstGap.toFixed(0)} ms, filo `
          + `bloccato ${seen.blockedS.toFixed(1)} s su ${seen.spanS.toFixed(1)}, primo quadro a `
          + `${(seen.firstMs / 1000).toFixed(2)} s, ${seen.frames} fotogrammi`);
  }
}

// --------------------------------------------------------------------------
// E QUANTO COSTA LA TERRA, PER POSA, PRIMA E DOPO (U-CAMPO-3).
//
// STESSO PATTO DELLA TRACCIA DELL'ARRIVO QUI SOPRA: la guardia e' lo strumento
// e la soglia, la macchina e' di chi misura, e senza schede questa gamba
// dichiara di non avere niente da mordere invece di inventarsi un numero
// (E-V5j). Le schede si prendono con fondazione/campo3/scheda.mjs.
//
//   node tools/guards/guard-cammino.mjs fondazione/campo3/out/c3-ferma1-alta-0054.json
//
// IL TETTO E' SUL RAPPORTO E NON SUL MILLISECONDO, e la ragione sta nella
// scheda stessa. Questa scrivania porta sette server altrui e due dozzine di
// Chrome: alla posa P il fotogramma nativo si e' letto 33,57 ms dove E-PERF5
// ne aveva letti 25,61 sulla sua, cioe' un terzo in piu' che non e' di questo
// codice. Un tetto in millisecondi misurerebbe il carico della macchina; un
// tetto sul RAPPORTO fra due bracci presi di seguito nella STESSA apertura,
// con l'ordine rimescolato dal seme e il nullo dichiarato accanto, misura la
// cosa. Il p95 si LEGGE e si scrive accanto, perche' e' il numero del mandato,
// ma non e' lui a gatear e la ragione e' scritta qui invece che sottintesa.
//
// AT_TODAY, 2026-09-08 (U-PERF-6), SCRIVANIA SCARICA e non piu' carica: tier
// alto, 1920x869, prima persona, velo tolto, TRE giri da 90 letture per posa,
// il PRIMA, il DOPO e il NULLO dentro la stessa apertura con l'ordine
// rimescolato dal seme. Il disegno della terra per passata, nativo -> quello
// che si spedisce (tre quarti di lato in alto, mezzo in basso):
//
//   posa fittata         21,902 -> 9,480 + 1,114 di ricomposizione   48 %
//   bordo-indietro       29,974 -> 12,466 + 1,322                    46 %
//   peggiore (-4,16)     34,020 -> 14,268 + 1,466                    46 %
//   cammino 1            25,650 -> 10,847 + 1,178                    47 %
//   cammino 2            29,684 -> 12,491 + 1,232                    46 %
//   cammino 3            26,278 -> 11,032 + 1,224                    47 %
//   posa fittata, basso  11,115 ->  2,310 + 0,490                    25 %
//
// I NUMERI PRECEDENTI ERANO A MEZZO LATO E SU UNA MACCHINA CARICA (U-CAMPO-3,
// 23-36 %). Il tier alto spedisce TRE QUARTI (D-C3-1), e la quota di un tre
// quarti non e' quella di un mezzo: un tetto fisso a 0,55 tarato sul mezzo
// lasciava al tre quarti che si spedisce sette punti di margine su
// quarantotto, cioe' gateava una scala che il mondo non disegna piu'.
//
// E DAL 2026-09-19 IL MEZZO LATO NON LO DISEGNA PIU' NESSUNO (E-CAMPO6-B, poi
// E-DECISIONI28): il tier basso spedisce 0,75 e il tier medio 0,65, e la riga
// «posa fittata, basso» qui sopra resta la ricevuta di com'era e NON e' piu' la
// ricevuta di cio' che si spedisce. La legge del tetto non cambia di una riga
// proprio perche' e' una legge della SCALA e non un numero: la scheda porta la
// sua frazione, `earthCeiling` la legge da li', e a 0,65 il tetto vale 0,52
// senza che nessuno lo scriva. E' la stessa ragione per cui un tetto fisso a
// 0,55 fu tolto: una guardia stantia costringe a spegnerla invece che a
// crederle.
//
// E IL TETTO ORA E' UNA LEGGE DELLA SCALA E NON UN NUMERO: un bersaglio a
// frazione `s` di lato porta `s*s` dei pixel, quindi non puo' costare piu' di
// `s*s` del disegno nativo piu' un decimo -- per la ricomposizione, e per il
// fatto che una marcia non si paga solo per pixel. A tre quarti fa 0,66 contro
// i 0,48 misurati, a mezzo 0,35 contro 0,25: margine dichiarato di diciotto e
// dieci punti, e tutti e due molto sotto l'uno, che e' dove va a finire il
// difetto vero -- qualcuno rimette la terra a piena risoluzione DENTRO il
// bersaglio ridotto e la pagina continua a disegnare lo stesso quadro a prezzo
// pieno senza che nulla sia rosso da nessuna parte.
// --------------------------------------------------------------------------
const EARTH_MARGIN = 0.10;
const earthCeiling = (scale) => (scale || 1) * (scale || 1) + EARTH_MARGIN;

// ==========================================================================
// IL P95, CHE E' IL REQUISITO -- E LA CODA DELLA SCRIVANIA, CHE NON E' NOSTRA.
//
// E-DECISIONI12, parole del committente: «minimo 30 fps STABILI con dettagli
// alti sulla mia macchina», cioe' p95 <= 33,3 ms al tier alto. E-GUARDIA4 ha
// posto la regola: il tempo resta NOTE tranne il p95, che si gatea con un
// margine dichiarato su almeno tre corse. Questa e' quella gamba.
//
// MA IL P95 CRUDO DI QUESTA SCRIVANIA NON E' TUTTO NOSTRO, ed e' misurato.
// U-PERF-6 ha preso novecento fotogrammi consecutivi alla posa fittata e ha
// trovato che il p95 sta otto o nove millisecondi sopra il p50 SU OGNI
// BRACCIO, IL NULLO COMPRESO -- un fotogramma che disegna il minimo legge p50
// 9 e p95 17. Quella coda:
//
//   * arriva ogni 233-249 ms DI PARETE su ogni braccio (undici fotogrammi
//     quando il fotogramma e' 21 ms, quindici quando e' 16,7): e' costante nel
//     TEMPO e non nei fotogrammi, che e' la firma di un lavoro periodico
//     esterno e non di un ciclo di disegno;
//   * cade sullo stadio `scene` (+7,4/+7,7 ms) e NON sul campo (+0,04/+0,19),
//     cioe' su qualunque stadio sia aperto quando arriva;
//   * sopravvive alla rimozione dei pannelli, delle nuvole, dei fiori, degli
//     alberi, della copia delle tessere e del campo intero (nullo spogliato:
//     p50 8,5, p95 17,0).
//
// Quindi si gatea il p95 NETTO -- quello del mondo meno la coda che il NULLO
// porta nella stessa apertura -- e si LEGGE accanto quello crudo, con le pose
// che lo sforano nominate. Sottrarre e' onesto solo se la sottrazione e'
// sorvegliata: percio' la coda stessa ha un tetto, e una scheda presa su una
// scrivania piu' rumorosa di cosi' viene RIFIUTATA invece che corretta.
const P95_GATE_MS = 33.3;
const TAIL_CEILING_MS = 12.0;

/**
 * Cosa una scheda dice della terra: il nativo, il ridotto, e il loro rapporto.
 *
 * @param {object} card  quello che fondazione/campo3/scheda.mjs ha scritto
 * @param {number} add   un difetto aggiunto al ridotto, per il self test
 */
export function earthCost(card, add = 0, tail = 0) {
  const arms = card.arms || {};
  const before = arms['mondo-campores1'];
  // IL BRACCIO CHE SI SPEDISCE SI CHIAMA `mondo` e non porta la scala nel nome,
  // perche' la scala e' quella del TIER: un banco che chiedesse `campores0.5`
  // al tier alto misurerebbe un fotogramma che quel tier non disegna mai
  // (E-CAMPO3 §6). I due nomi espliciti restano per le schede gia' scritte.
  const after = arms.mondo || arms['mondo-campores0.5'] || arms['mondo-campores0.75'];
  const nulla = arms.nullo;
  if (!before || !after || !before.disegni || !after.disegni) return null;
  const nativo = before.disegni.campo ? before.disegni.campo.p50 : 0;
  const marcia = after.disegni.campo ? after.disegni.campo.p50 : 0;
  const ricomposizione = after.disegni.ricomposizione
    ? after.disegni.ricomposizione.p50 : 0;
  const ridotto = marcia + ricomposizione + add;
  if (nativo <= 0) return null;
  const scala = card.tier && card.tier.campo ? card.tier.campo.scale : null;
  const soffitto = earthCeiling(scala);
  // LA CODA DELLA SCRIVANIA, misurata dentro QUESTA apertura e non ereditata:
  // quanto un fotogramma che disegna il minimo paga lo stesso al novantacinque.
  const coda = nulla && nulla.stadi
    ? nulla.stadi.total.p95 - nulla.stadi.total.p50 + tail : null;
  const p95 = after.stadi ? after.stadi.total.p95 : null;
  const netto = p95 !== null && coda !== null ? p95 - coda : null;
  return {
    pose: card.pose,
    tier: card.tier ? card.tier.id : '?',
    scala,
    soffitto,
    nativo,
    marcia,
    ricomposizione,
    ridotto,
    quota: ridotto / nativo,
    p95Prima: before.stadi ? before.stadi.total.p95 : null,
    p95Dopo: p95,
    p50Dopo: after.stadi ? after.stadi.total.p50 : null,
    coda,
    netto,
    // La scheda e' USABILE solo se la scrivania stava abbastanza zitta: sotto
    // questo tetto la sottrazione e' una correzione, sopra e' una scusa.
    codaOk: coda !== null && coda <= TAIL_CEILING_MS,
    p95Ok: netto !== null && netto <= P95_GATE_MS,
    p95CrudoOk: p95 !== null && p95 <= P95_GATE_MS,
    ok: ridotto / nativo <= soffitto,
  };
}

// La scheda sintetica del self test: la posa fittata di oggi, tier alto, tre
// quarti di lato, scrivania scarica (U-PERF-6, 2026-09-08).
const EARTH_TODAY = {
  pose: 'target',
  tier: { id: 'alto', campo: { scale: 0.75 } },
  arms: {
    'mondo-campores1': {
      disegni: { campo: { p50: 21.902 } },
      stadi: { total: { p50: 31.65, p95: 36.36 } },
    },
    mondo: {
      disegni: { campo: { p50: 9.480 }, ricomposizione: { p50: 1.114 } },
      stadi: { total: { p50: 19.50, p95: 27.92 } },
    },
    nullo: { disegni: {}, stadi: { total: { p50: 8.74, p95: 16.82 } } },
  },
};

const cards = process.argv.slice(2).filter((a) => a.endsWith('.json') && /(c3|p6)-/.test(a));
if (cards.length === 0) {
  process.stdout.write('  NOTE  nessuna scheda della terra consegnata, quindi si e\' chiesto '
    + 'solo lo strumento. Prendine con fondazione/p6/scheda.mjs e passale qui.\n');
} else {
  const sforano = [];
  for (const path of cards) {
    const seen = earthCost(JSON.parse(readFileSync(path, 'utf8')));
    const name = path.split(/[\\/]/).pop();
    if (!seen) {
      report.check(false, `${name} porta i due bracci della terra`, 'nessuno dei due');
      continue;
    }
    report.check(seen.ok,
      `${name}: la terra a ${seen.scala} di lato costa al piu' `
      + `${seen.soffitto.toFixed(2)} del disegno nativo`,
      `${(100 * seen.quota).toFixed(0)} % -- ${seen.nativo.toFixed(2)} -> `
      + `${seen.marcia.toFixed(2)} + ${seen.ricomposizione.toFixed(2)} di ricomposizione, `
      + `posa ${seen.pose}, tier ${seen.tier}`);
    // LA SCRIVANIA PRIMA DEL MONDO: una scheda presa mentre la macchina
    // strozzava non si corregge, si rifiuta. Senza nullo nella stessa apertura
    // non c'e' nessun numero da cui togliere la coda, e la gamba lo dice.
    report.check(seen.codaOk,
      `${name}: la scrivania era abbastanza zitta da misurarci sopra `
      + `(coda del nullo <= ${TAIL_CEILING_MS} ms)`,
      seen.coda === null ? 'nessun braccio `nullo` in questa apertura'
        : `${seen.coda.toFixed(2)} ms fra il p50 e il p95 del nullo`);
    if (seen.codaOk) {
      report.check(seen.p95Ok,
        `${name}: il p95 NETTO della coda della scrivania sta sotto i `
        + `${P95_GATE_MS} ms del committente`,
        `${seen.netto === null ? '?' : seen.netto.toFixed(2)} = `
        + `${seen.p95Dopo.toFixed(2)} crudo meno ${seen.coda.toFixed(2)} di coda`);
    }
    if (!seen.p95CrudoOk) sforano.push(`${seen.pose} (${seen.p95Dopo.toFixed(1)})`);
    report.line(`        NOTE p50 ${seen.p50Dopo === null ? '?' : seen.p50Dopo.toFixed(2)}, `
      + `p95 crudo ${seen.p95Prima === null ? '?' : seen.p95Prima.toFixed(2)} -> `
      + `${seen.p95Dopo === null ? '?' : seen.p95Dopo.toFixed(2)}, `
      + `netto ${seen.netto === null ? '?' : seen.netto.toFixed(2)} ms su questa macchina`);
  }
  if (sforano.length) {
    report.line(`  NOTE  il p95 CRUDO passa i ${P95_GATE_MS} ms a ${sforano.length} pose su `
      + `${cards.length}: ${sforano.join(', ')} -- e la coda della scrivania, non il mondo, `
      + 'ma il committente il fotogramma lo vede intero.');
  }
}

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
    // L'ARRIVO, contro una traccia sintetica: i fotogrammi buoni sono quelli di
    // oggi, i difetti sono quelli misurati prima della cura.
    {
      what: 'l\'arrivo di oggi, che NON deve essere chiamato difetto',
      caught: arrivalCost(TODAY).ok,
    },
    {
      what: 'il fotogramma da 2247 ms che pagava la compilazione dei programmi',
      caught: !arrivalCost(TODAY, 2247 - 290).ok,
    },
    {
      what: 'il buco da 5251 ms che pagava getImageData su una tela filtrata',
      caught: !arrivalCost(TODAY, 0, 5251 - 1193).ok,
    },
    {
      what: 'e un primo quadro caro, che e\' l\'apertura della pagina e non un singhiozzo',
      caught: arrivalCost({ frames: [{ t: 1100, dt: 0, cpu: 1900 }, ...TODAY.frames.slice(1)] }).ok,
    },
    // LA TERRA, contro la scheda di oggi e contro i modi di perderla.
    {
      what: 'la terra di oggi, che NON deve essere chiamata difetto',
      caught: earthCost(EARTH_TODAY).ok,
    },
    {
      // IL DIFETTO CHE QUESTA GAMBA ESISTE PER MORDERE: qualcuno rimette la
      // terra a piena risoluzione dentro il bersaglio ridotto -- una scala
      // dimenticata, un tier che non dichiara piu' il suo pixel -- e la pagina
      // continua a disegnare esattamente lo stesso quadro, a prezzo pieno,
      // senza che nulla sia rosso da nessuna parte.
      what: 'la terra rimessa a piena risoluzione dentro il bersaglio ridotto',
      caught: !earthCost(EARTH_TODAY, 21.902 - 10.594).ok,
    },
    {
      // E il tetto non e' largo a piacere: gia' a meta' strada fra l'oggi e il
      // nativo il cancello morde.
      what: 'e una ricomposizione che costa meta strada verso il nativo',
      caught: !earthCost(EARTH_TODAY, (21.902 - 10.594) / 2).ok,
    },
    {
      // IL TETTO E' UNA LEGGE DELLA SCALA: la stessa quota che a tre quarti e'
      // sana, a mezzo lato e' un difetto, perche' un bersaglio con un quarto
      // dei pixel che ne costa la meta' ha perso la meta' del risparmio.
      what: 'la quota del tre quarti letta su una scheda a MEZZO lato',
      caught: !earthCost({
        ...EARTH_TODAY, tier: { id: 'alto', campo: { scale: 0.5 } },
      }).ok,
    },
    {
      what: 'una scheda senza i due bracci non viene creduta',
      caught: earthCost({ pose: 'x', arms: { nullo: { disegni: {} } } }) === null,
    },
    // IL P95, CHE E' IL REQUISITO, E LA CODA, CHE E' LA SCRIVANIA.
    {
      what: 'il p95 netto di oggi, che NON deve essere chiamato difetto',
      caught: earthCost(EARTH_TODAY).p95Ok,
    },
    {
      // Il fotogramma che il committente vede a 27 fps: p95 netto sopra 33,3.
      what: 'un p95 netto sopra i 33,3 ms del committente',
      caught: !earthCost({
        ...EARTH_TODAY,
        arms: {
          ...EARTH_TODAY.arms,
          mondo: {
            ...EARTH_TODAY.arms.mondo,
            stadi: { total: { p50: 19.50, p95: 27.92 + 14 } },
          },
        },
      }).p95Ok,
    },
    {
      // E LA SOTTRAZIONE NON PUO' SALVARE TUTTO: una scrivania che strozza piu'
      // di dodici millisecondi rende la scheda inservibile, e la gamba lo dice
      // invece di togliere un numero sempre piu' grande da uno sempre piu'
      // grande. Senza questo caso il p95 netto passerebbe sempre.
      what: 'una scrivania troppo rumorosa: la scheda si rifiuta, non si corregge',
      caught: !earthCost(EARTH_TODAY, 0, 6).codaOk,
    },
    {
      what: 'una scheda senza nullo non ha una coda da togliere e lo dichiara',
      caught: earthCost({
        ...EARTH_TODAY,
        arms: {
          'mondo-campores1': EARTH_TODAY.arms['mondo-campores1'],
          mondo: EARTH_TODAY.arms.mondo,
        },
      }).codaOk === false,
    },
  ]);
}

report.end(`${legs.map((l) => `${l.radius} m: ${l.per.toFixed(2)} col/fiore`).join('   ')}`
  + `   |   arrivo: tetti ${ARRIVAL_FRAME_MS} ms per fotogramma e ${ARRIVAL_GAP_MS} per buco, `
  + `su ${traces.length} tracce lette`
  + `   |   terra: tetto s*s+${EARTH_MARGIN} del disegno nativo e p95 netto <= ${P95_GATE_MS} ms `
  + `(coda del nullo <= ${TAIL_CEILING_MS}), su ${cards.length} schede lette`);
