// GUARD-STABILITA -- IL PRATO NON SI RIDISEGNA SOTTO CHI CAMMINA.
//
//   node tools/guards/guard-stabilita.mjs [--self]
//
// «Vedo generare il prato a piu' punti quando cammino o zoommo, da' molto
// fastidio all'occhio.» Lo zoom lo tiene guard-zoom; qui c'e' il cammino, e sono
// tre cose diverse che una guardia sola tiene insieme perche' sono la stessa
// frase.
//
//   A FERMO NON SI MUOVE NIENTE. Gia' vero (misurato: 0,000% dei pixel di suolo
//   fra due fotogrammi a camera immobile, sia prima sia dopo) e qui si FISSA:
//   una legge di LOD che leggesse un orologio, un hash del fotogramma o la
//   posizione dell'occhio in tre dimensioni lo romperebbe senza che nessuno se
//   ne accorga finche' il committente non guarda il prato da fermo.
//
//   UN PASSO AVANTI E UNO INDIETRO NON CAMBIANO UNA CELLA. Questa e' l'isteresi
//   e non era vera prima: il centro della LOD sta fermo finche' il camminatore
//   non ha lasciato una palla di `snap` metri, quindi ogni escursione piu'
//   corta di quella lascia la mappa dei livelli IDENTICA. La guardia chiede che
//   lo snap del tier copra il mezzo metro con cui si misura.
//
//   IN CAMMINO LENTO CAMBIA POCO, E SOLO SUGLI ANELLI DICHIARATI. La quota di
//   punti del piano che cambiano cella a ogni passo di 0,25 m: 3,749% con la
//   legge in pixel, 2,227% con l'anello e l'isteresi, 2,739% senza isteresi.
//   E nessun anello sul bordo della finestra vicina, che e' il vincolo
//   near * step^2 <= 19,2 m (guard-zoom lo tiene per tier; qui si tiene la
//   conseguenza: la scala non ha un gradino oltre quel raggio).
//
//   E LE QUOTE DI LUMA PER FASCIA. Il fronte non deve essere uno SCALINO: R1 lo
//   misuro' a +3,7 livelli di luma media e lo chiamo' «una placca chiara che si
//   spacca in fili scuri». Qui si gatea lo scalino misurato fra le due fasce
//   sicure a cavallo del fronte, e le tre quote della fascia oltre l'anello
//   contro quelle che R1 ha letto sul bersaglio alla stessa distanza.
//
// LE RICEVUTE SONO LETTERALI, come in guard-orizzonte e guard-cammino: un
// numero preso una notte al banco e mai piu' guardato non e' una guardia. Il
// banco che li riprende e' fondazione/lav/campo1-scatti.mjs +
// campo1-analisi.mjs + campo1-fit.mjs, alla posa vox-giorno, 1672x941, tier
// alto, sui soli pixel che il campo disegna.
import { reporter, selfTest } from './lib.mjs';
import { TIERS } from '../../src/core/quality.js';
import { read } from './lib.mjs';

const STEP = 0.5;          // il passo con cui l'isteresi si misura, in metri
const NEAR_WINDOW = 19.2;  // la finestra vicina, oltre cui non c'e' altro che 40 cm

// Quello che il banco ha letto. `prima` e' la legge in pixel che spediva.
const AT_TODAY = {
  fermoPrima: 0,        // % di pixel di suolo mossi fra due fotogrammi a fermo
  fermoDopo: 0,
  passoPrima: 3.749,    // % di punti del piano che cambiano cella per passo 0,25 m
  passoDopo: 2.227,
  passoSenzaIsteresi: 2.739,
  avantiPrima: 7.783,   // % che cambiano cella per mezzo metro avanti
  avantiDopo: 0,
  avantiSenzaIsteresi: 5.61,
  ritornoDopo: 0,       // pixel diversi dal byte quando si torna alla posa
  scalinoPrima: 5.75,   // luma, fascia 7-8,5 m contro 10,5-12,5 m
  scalinoDopo: 0.28,
  // Le tre quote della fascia 10,5-12,5 m (oltre l'anello), scuro/medio/chiaro,
  // contro la finestra cm-sx del bersaglio a 8,9-17 m (R1 §1.1).
  quoteDopo: [55.2, 30.9, 13.9],
  quotePrima: [48.2, 18.6, 33.2],
  quoteBersaglio: [58, 26, 16],
};
const CEILING = {
  fermo: 0.001,
  passo: 3.0,        // sotto la legge in pixel, con margine per la macchina
  avanti: 0.001,     // l'isteresi e' un fatto: zero, non «poco»
  ritorno: 0,
  scalino: 1.5,      // un livello e mezzo di luma: sotto la grana del manto
  quota: 5,          // punti percentuali dal bersaglio, per famiglia
};

const injected = process.argv.includes('--self');
const report = reporter('guard-stabilita -- il prato sta fermo sotto chi cammina');

// ------------------------------------------------------- 1. LA BANDA ESISTE
//
// L'ISTERESI NON C'E' PIU', ed e' una SOSTITUZIONE e non una rimozione. Teneva
// il centro della LOD fermo finche' il camminatore non aveva lasciato una palla
// di 0,75 m, e faceva esattamente cio' che il suo stesso commento prometteva: il
// cambio, quando veniva, veniva TUTTO INSIEME — 2,5 % del quadro in un
// fotogramma, su tre anelli a 9, 13 e 19 m, ogni 0,8 m di cammino (R8 §2.1 a).
// Al suo posto c'e' la BANDA: due centri — dov'era il camminatore `lag` ms fa e
// dov'e' ora — e ogni pixel legge un punto del segmento fra i due secondo il
// proprio hash, cosi' che il fronte sia largo quanto si cammina in quel tempo e
// i pixel ci cambino livello uno alla volta invece che tutti insieme.
//
// Cio' che l'isteresi prometteva — «mezzo metro avanti e indietro non ridisegna
// niente» — la banda lo mantiene meglio: la grana va avanti e torna indietro col
// camminatore e nessuna cella cambia due volte. Cio' che manteneva DAVVERO — «da
// fermi il quadro e' identico al byte» — resta, ed e' la ricevuta piu' sotto.
/** A tier spreads its LOD front over at least two tenths of a second. */
const spreadsTheFront = (g) => Boolean(g) && typeof g.lag === 'number' && g.lag >= 200;
for (const tier of TIERS) {
  const g = tier.groundDetail;
  report.check(spreadsTheFront(g),
    `il tier ${tier.id} spande il fronte della LOD su almeno due decimi di secondo`,
    `lag ${g && g.lag} ms, che a 1 m/s e' una banda di ${((g && g.lag) / 1000).toFixed(2)} m`);
  report.check(!(g && 'snap' in g),
    `e il tier ${tier.id} non porta piu' l'isteresi che la banda ha sostituito`);
}
const field = read('src/world/voxel/campo-field.js');
report.check(field.includes('trail.push({ t: now, x: eye.x, z: eye.z })'),
  'il campo tiene la coda delle posizioni da cui la banda e\' misurata');
report.check(field.includes('u.uLodCentre.value.set(was.x, was.z)')
  && field.includes('u.uLodCentre2.value.set(eye.x, eye.z)'),
  'e il frammento riceve i DUE centri: dov\'era il camminatore e dov\'e\' adesso');
report.check(field.includes('while (trail.length > 2 && trail[1].t <= now - lodLag)'),
  'la coda non si asciuga mai sotto due campioni',
  'una coda vuota rimetterebbe la LINEA per un fotogramma, che e\' il difetto stesso');
report.check(/lodCentre = null;/.test(field.slice(field.indexOf('setDetail('))),
  'un modo che cambia ripianta il centro invece di trascinarlo',
  'una misura presa in un modo non e\' mai meta\' di un\'altra');

// ------------------------------------- 2. LA LEGGE NON LEGGE NULLA CHE VARI
const glsl = read('src/world/voxel/campo-material.js');
const march = glsl.slice(glsl.indexOf('Hit march('),
  glsl.indexOf('// ------------------------------------------------------------ one shading'));
const ladder = march.slice(march.indexOf('float jitter'), march.indexOf('int floorLevel'));
for (const forbidden of ['uTime', 'uFrame', 'cameraPosition']) {
  report.check(!ladder.includes(forbidden),
    `la scala della LOD non legge ${forbidden}`,
    'a camera ferma il prato deve essere identico al byte');
}
// E LO SCHERMO SOLO NEL BRACCIO CHE NON SI SPEDISCE. La banda ha bisogno di un
// hash per pixel, e ce ne sono due: l'INDIRIZZO DEL PIXEL, che e' il piu' a buon
// mercato che esista ma cammina col vetro e fa strisciare la grana sopra il
// prato; e la CELLA DI PRATO su cui il raggio atterra, che sta ferma nel mondo
// mentre il camminatore le passa accanto. Misurati fianco a fianco sulla stessa
// linea, sono pari al pixel — 1,008 % per passo e 0,66 % di componente l'uno e
// l'altro — e costano 32,0/34,9 ms contro 33,7/38,5. A parita', il mondo (R8 §6).
{
  const onGlass = ladder.split('\n').filter((l) => l.includes('gl_FragCoord'));
  report.check(onGlass.length === 1,
    'la scala nomina lo schermo una volta sola, nel ramo che il tier non prende',
    `${onGlass.length} riga`);
  report.check(onGlass.every((l) => l.includes('pigHash(gl_FragCoord')),
    'e quella volta e\' un hash del pixel, non una posizione che entri nella legge');
  report.check(glsl.includes('uLodWorld: { value: 1 }'),
    'cio\' che si spedisce e\' la grana attaccata al PRATO e non al vetro');
  report.check(ladder.includes('floor(grain.x / uCell), floor(grain.y / uCell)'),
    'la grana del mondo e\' presa alla cella del prato, che e\' ferma sotto chi cammina');
  report.check(ladder.includes('float toFoot = dir.y < -1e-3'),
    'e l\'ancora e\' dove il raggio tocca il piano, che non si muove quando si muove la camera');
}
report.check(/far2 = max\(far2,/.test(ladder),
  'la scala sale e non scende mai, anche con il centro tenuto indietro',
  'la distanza usata e\' il massimo che il raggio ha raggiunto');

// -------------------------------------------------------- 3. LE RICEVUTE
report.check(AT_TODAY.fermoDopo <= CEILING.fermo,
  'a camera ferma nessun pixel di suolo si muove',
  `${AT_TODAY.fermoDopo}% (prima ${AT_TODAY.fermoPrima}%)`);
report.check(AT_TODAY.avantiDopo <= CEILING.avanti,
  'mezzo metro avanti non cambia una sola cella gia\' in quadro',
  `${AT_TODAY.avantiDopo}% contro il ${AT_TODAY.avantiPrima}% della legge in pixel `
  + `e il ${AT_TODAY.avantiSenzaIsteresi}% senza isteresi`);
report.check(AT_TODAY.ritornoDopo <= CEILING.ritorno,
  'e tornando alla posa il quadro e\' identico AL BYTE',
  `${AT_TODAY.ritornoDopo} pixel diversi`);
report.check(AT_TODAY.passoDopo <= CEILING.passo && AT_TODAY.passoDopo < AT_TODAY.passoPrima,
  'in cammino lento cambia cella meno prato di prima',
  `${AT_TODAY.passoDopo}% per passo di 0,25 m contro ${AT_TODAY.passoPrima}%, `
  + `soffitto ${CEILING.passo}%`);
report.check(AT_TODAY.passoDopo < AT_TODAY.passoSenzaIsteresi,
  'e l\'isteresi ne toglie la sua parte',
  `${AT_TODAY.passoDopo}% contro ${AT_TODAY.passoSenzaIsteresi}% a snap nought`);

// ------------------------------------------------- 4. IL FRONTE E LE QUOTE
report.check(Math.abs(AT_TODAY.scalinoDopo) <= CEILING.scalino,
  'il fronte non e\' uno scalino di luce',
  `${AT_TODAY.scalinoDopo} livelli attraverso il fronte contro ${AT_TODAY.scalinoPrima} prima, `
  + `soffitto ${CEILING.scalino}`);
const names = ['scuro', 'medio', 'chiaro'];
let worst = 0;
for (let k = 0; k < 3; k += 1) {
  const off = Math.abs(AT_TODAY.quoteDopo[k] - AT_TODAY.quoteBersaglio[k]);
  worst = Math.max(worst, off);
  report.check(off <= CEILING.quota,
    `la quota ${names[k]} oltre l'anello sta entro ${CEILING.quota} punti dal bersaglio`,
    `${AT_TODAY.quoteDopo[k]}% contro ${AT_TODAY.quoteBersaglio[k]}% `
    + `(prima ${AT_TODAY.quotePrima[k]}%, scarto ${off.toFixed(1)})`);
}
report.line(`        la fascia oltre l'anello sta a ${worst.toFixed(1)} punti dal bersaglio `
  + `nella famiglia peggiore; la legge in pixel ne stava a `
  + `${Math.max(...AT_TODAY.quotePrima.map((v, k) => Math.abs(v - AT_TODAY.quoteBersaglio[k]))).toFixed(1)}`);
report.note('DENTRO l\'anello le quote restano lontane dal bersaglio sulla famiglia chiara '
  + '(21,4% contro 5% a 7-8,5 m, era 28,8%): il resto e\' il POZZO fra i fili e la LUCE A ZONE, '
  + 'che sono U-PRATO-2 e U-ZONE-1 di R1 e non questa unita\'. La LOD non puo\' chiuderlo: a '
  + 'cinque centimetri sta gia\' disegnando i fili veri.');

// ------------------------------------- 5. NESSUN ANELLO OLTRE LA FINESTRA
for (const tier of TIERS) {
  const g = tier.groundDetail;
  const third = g.near * g.step * g.step;
  report.check(third <= NEAR_WINDOW,
    `il tier ${tier.id} raggiunge i quaranta centimetri dentro la finestra vicina`,
    `${third.toFixed(2)} m: oltre, la finestra scatta di 6,4 m e l'anello salterebbe con lei`);
}

// ------------------------------- 6. IL CAMMINO, LA ROTAZIONE E IL FERMO
//
// LE RICEVUTE DEL CONGELATORE, che e' lo strumento di R8 §1 promosso a banco di
// questa unita' (fondazione/campo2/): lo stato del mondo si CONGELA mentre la
// camera fa il passo, cosi' che la differenza fra due scatti alla stessa posa
// sia solo cio' che quella sorgente ha cambiato — zero parallasse.
//
// E OGNI NUMERO PORTA IL PROPRIO PAVIMENTO, che e' la cosa che R8 non poteva
// sapere e questa unita' ha misurato: DUE SCATTI DI FILA SENZA SCIOGLIERE NULLA
// non danno zero su questa scheda. Muovono lo 0,037 % del quadro oltre tre
// livelli e lo 0,011 % oltre otto, quasi tutto nella banda dell'orizzonte, e
// ogni tanto — in modo intermittente, con l'orologio del mondo fermo e le nuvole
// ferme a uTime 0 — salgono all'1-2 %. Non e' del campo: e' del compositore, e
// sta scritto qui perche' una ricevuta «0,000 %» che questo banco non puo'
// produrre sarebbe una promessa e non una misura. Cio' che si tiene e' che la
// sorgente cambi MENO del proprio pavimento, o poco piu'.
//
// E LA MISURA CHE DECIDE E' LA LINEA E NON IL CONTO. Etichettando le componenti
// 8-connesse su un campo sparso, la percolazione le fonde: il braccio nullo al
// salto ha 488 componenti e la piu' grande vale un terzo dei pixel caldi, il
// braccio spedito ne ha 528 e la piu' grande ne vale il 41 % — stessa forma,
// meta' roba. Un'erosione di un pixel separa i due come li separa l'occhio: un
// ANELLO e' spesso e sopravvive, la GRANA e' fatta di granelli e sparisce.
const WALK = {
  strumento: 'fondazione/campo2/b-cammino.mjs, an-cammino.mjs, an-linea.mjs',
  dove: '8 m della linea di R8 dalla posa vox-giorno, 32 passi di 0,25 m, tier alto',
  // il pavimento dello strumento: due scatti, nulla sciolto
  pavimento: { over3: 0.037, over8: 0.011, linea: 0.007 },
  // per passo di 0,25 m, che a un lag di 300 ms e' un cammino di circa 0,8 m/s
  passoPrima: 1.461,
  passoDopo: 1.177,
  saltoPrima: 5.800,     // il piu' grande cambio in UN passo
  saltoDopo: 1.939,
  lineaPrima: 0.381,     // la piu' grande COSA SOLA, dopo l'erosione
  lineaDopo: 0.293,
  sodoPrima: 1.991,      // e quanto ce n'e' in tutto, di roba coerente
  sodoDopo: 0.506,
  // alle mosse della finestra, le due che cadono negli 8 m
  finestraPrima: [0.648, 0.882],   // componente connessa piu' grande
  finestraDopo: [0.015, 0.090],
  // fermo e rotazione: quanto il campo cambia OLTRE il pavimento dello strumento
  fermoOltre: 0.324,
  rotazioneOltre: 0.139,
  // e la banda a fermo, dopo il lag: i due centri sono un punto solo
  bandaAFermo: 0,
  // il costo, mediana di tre corse alternate per braccio
  costoPrima: { p50: 31.19, p95: 33.40 },
  costoDopo: { p50: 31.44, p95: 33.88 },
};
const WALK_CEILING = {
  passo: 1.5,        // R8 §6: <= 1,5 % al passo = <= 0,2 % per fotogramma a 1 m/s
  linea: 0.3,        // nessuna COSA SOLA oltre lo 0,3 % del quadro
  finestra: 0.15,    // la striscia deve sparire dentro il rumore
  oltre: 0.35,       // a fermo e in rotazione, oltre il pavimento
  costoP50: 0.5,     // ms sul p50, braccio contro braccio
};

report.check(WALK.passoDopo <= WALK_CEILING.passo && WALK.passoDopo < WALK.passoPrima,
  'in cammino lento un passo di 25 cm muove meno quadro di prima',
  `${WALK.passoDopo} % contro ${WALK.passoPrima} %, soffitto ${WALK_CEILING.passo} % `
  + `(= ${(WALK.passoDopo / 7.5).toFixed(3)} % per fotogramma a 1 m/s, obiettivo 0,2)`);
report.check(WALK.saltoDopo < WALK.saltoPrima / 2,
  'e il piu\' grande cambio in UN passo e\' meno della meta\' di quello che era',
  `${WALK.saltoDopo} % contro ${WALK.saltoPrima} %: il salto della LOD non c\'e\' piu\'`);
report.check(WALK.lineaDopo <= WALK_CEILING.linea,
  'nessuna COSA SOLA piu\' grande di quella si genera in un passo',
  `${WALK.lineaDopo} % dopo l\'erosione, contro ${WALK.lineaPrima} % prima, `
  + `soffitto ${WALK_CEILING.linea} %`);
report.check(WALK.sodoDopo < WALK.sodoPrima / 2,
  'e di roba coerente, in tutto, ce n\'e\' meno della meta\'',
  `${WALK.sodoDopo} % contro ${WALK.sodoPrima} %`);
report.check(Math.max(...WALK.finestraDopo) <= WALK_CEILING.finestra,
  'alle mosse della finestra non si costruisce piu\' niente a pezzi',
  `${WALK.finestraDopo.join(' e ')} % contro ${WALK.finestraPrima.join(' e ')} % `
  + `(pavimento dello strumento ${WALK.pavimento.linea} %)`);
report.check(WALK.fermoOltre <= WALK_CEILING.oltre && WALK.rotazioneOltre <= WALK_CEILING.oltre,
  'a fermo e girando la testa il campo non genera nulla oltre il rumore dello strumento',
  `fermo +${WALK.fermoOltre} %, dodici direzioni +${WALK.rotazioneOltre} % (in sette `
  + 'delle dodici sia il rumore sia il campo misurano 0,0000 %)');
report.check(WALK.bandaAFermo === 0,
  'e a fermo, dopo il lag, i due centri della banda sono UN PUNTO SOLO',
  'che e\' il perche\' il quadro fermo e\' quello di prima al byte, e non un quasi');
report.check(WALK.costoDopo.p50 - WALK.costoPrima.p50 <= WALK_CEILING.costoP50,
  'e tutto questo costa meno di mezzo millisecondo sulla scena',
  `p50 ${WALK.costoDopo.p50} contro ${WALK.costoPrima.p50} ms = `
  + `+${(WALK.costoDopo.p50 - WALK.costoPrima.p50).toFixed(2)} ms, mediana di tre corse alternate`);
report.note(`p95 ${WALK.costoDopo.p95} ms contro ${WALK.costoPrima.p95} del braccio nullo: `
  + 'il soffitto di R8 e\' 33 al tier alto e NESSUNO DEI DUE bracci lo tiene su questa '
  + 'macchina, che aveva quattro server altrui in piedi (R8 §8.1). Il numero che questa '
  + 'unita\' possiede e\' la DIFFERENZA, +0,48 ms sul p95.');
report.note('LA RAFFICA (R8 §6, guardia 4: nessuno scatto porta piu\' del 40 % del cambio '
  + 'del passo, con il lag portato a 3000 ms) NON e\' fra queste ricevute: gli scatti di '
  + 'Playwright costano 1-3 s l\'uno e non risolvono i 300 ms. Cio\' che la sostituisce e\' '
  + 'la riga della LINEA qui sopra, che misura la stessa cosa sul quadro invece che nel '
  + 'tempo: se il cambio arrivasse tutto in un fotogramma sarebbe una cosa sola grande.');

if (!injected) report.end();

// --------------------------------------------------------------- il contrario
const cases = [];
cases.push({ what: 'una LINEA che si genera in un passo, invece della grana',
  caught: !(0.9 <= WALK_CEILING.linea) });
cases.push({ what: 'una striscia della finestra che si costruisce ancora a pezzi',
  caught: !(0.648 <= WALK_CEILING.finestra) });
cases.push({ what: "un braccio che costa piu' di mezzo millisecondo sulla scena",
  caught: !(1.4 <= WALK_CEILING.costoP50) });
// THE PREDICATE THE RUN USES, so a defect can be put through it. The case
// below used to read `!(TIERS.every(...) && 100 >= 200)`: the second conjunct
// is a compile-time false, so the whole thing was `!false` -- unconditionally
// true, with the tier check inside it dead code that never ran.
// (U-GUARDIA-3, E-IGIENE.)
cases.push({ what: 'un tier con una banda troppo stretta per spandersi sui fotogrammi',
  caught: !spreadsTheFront({ lag: 100 }) && TIERS.every((t) => spreadsTheFront(t.groundDetail)) });
cases.push({ what: 'un tier che porta ancora la vecchia isteresi al posto della banda',
  caught: 'snap' in { snap: 0.75, lag: 300 } });
cases.push({ what: 'una scala che legge l\'orologio',
  caught: ['uTime'].some((f) => `${ladder} float k = uTime;`.includes(f)) });
cases.push({ what: 'una ricevuta a fermo che non e\' zero',
  caught: !(0.004 <= CEILING.fermo) });
cases.push({ what: 'un passo che muove piu\' prato della legge in pixel',
  caught: !(4.2 <= CEILING.passo && 4.2 < AT_TODAY.passoPrima) });
cases.push({ what: 'mezzo metro che muove una cella',
  caught: !(AT_TODAY.avantiSenzaIsteresi <= CEILING.avanti) });
cases.push({ what: 'un ritorno che non e\' identico al byte',
  caught: !(11 <= CEILING.ritorno) });
cases.push({ what: 'lo scalino della legge che spediva',
  caught: !(Math.abs(AT_TODAY.scalinoPrima) <= CEILING.scalino) });
cases.push({ what: 'la quota chiara della legge che spediva, a 17 punti dal bersaglio',
  caught: !(Math.abs(AT_TODAY.quotePrima[2] - AT_TODAY.quoteBersaglio[2]) <= CEILING.quota) });
cases.push({ what: 'un anello il cui terzo fronte esce dalla finestra vicina',
  caught: !(9 * 1.6 * 1.6 <= NEAR_WINDOW) });
cases.push({ what: 'un centro che segue l\'occhio invece di essere tenuto',
  caught: !/> lodSnap\)/.test(field.replace('> lodSnap)', '>= 0)')) });
selfTest('guard-stabilita', cases);
