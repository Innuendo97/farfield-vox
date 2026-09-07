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
for (const tier of TIERS) {
  const g = tier.groundDetail;
  report.check(g && typeof g.lag === 'number' && g.lag >= 200,
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

if (!injected) report.end();

// --------------------------------------------------------------- il contrario
const cases = [];
cases.push({ what: 'un tier con una banda troppo stretta per spandersi sui fotogrammi',
  caught: !(TIERS.every((t) => t.groundDetail.lag >= 200) && 100 >= 200) });
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
