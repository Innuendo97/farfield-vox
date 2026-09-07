import { read } from './lib.mjs';
import { reporter, selfTest } from './lib.mjs';

// GUARD-ARRIVO -- NIENTE SI COSTRUISCE A VISTA, E L'OCCHIO E' DEL VISITATORE.
//
// ===========================================================================
// L'arrivo e' la sequenza di discontinuita' piu' lunga del cammino, e succede
// una volta: chi apre la pagina la prima volta vede QUESTA. R8 l'ha guardata
// con un registro a 50 ms e ha trovato tre cose, tutte e tre di questa unita':
//
//   1. IL SUOLO SI COSTRUIVA A VISTA. Il velo era un cronometro fatto partire
//      sul primo fotogramma che aveva del suolo dentro -- non su quello che
//      aveva TUTTO il suolo -- e teneva 2 s piu' 2,5 di dissolvenza. Le tessere
//      sono centoventotto, una per fotogramma, sessanta-cento ms l'una nel
//      worker: il velo se n'era andato da un pezzo mentre il pavimento si
//      posava ancora, per righe, dal fondo verso i piedi.
//   2. TUTTO IL VERDE ARRIVAVA IN UN FOTOGRAMMA. Manto, ciuffi, fiori vicini e
//      lontani, nuvole, alberi e selciato sono appesi insieme dopo `warm`.
//   3. LA CALIBRAZIONE PRENDEVA L'OCCHIO. Tre secondi piu' riscaldamento in cui
//      il banco gira la camera di mezzo giro per misurare piu' superfici --
//      misurati 8,3 gradi in 7,3 s -- proprio nei secondi in cui il mondo sta
//      ancora arrivando. «Tre secondi di sguardo che gira che nessuno ha
//      chiesto».
//
// Questa guardia tiene i tre rimedi: il velo che aspetta il suolo INTERO con un
// tetto dichiarato, l'ordine in cui le tessere sono chieste, e il banco che
// misura senza girare la testa a nessuno (D-R8-1, opzione B del committente).
//
// COM'E' FATTA. Le prime tre gambe leggono il CODICE, perche' sono invarianti e
// un invariante si tiene dove sta scritto. L'ultima porta le RICEVUTE del banco
// fondazione/campo2/g-arrivo.mjs, che apre il mondo per davvero con un registro
// a 50 ms: quelle non si possono leggere da un sorgente e si rifanno con lo
// strumento, che e' nominato qui sotto perche' una ricevuta senza il suo
// strumento e' un numero che nessuno puo' contestare.
// ===========================================================================

/** Il tetto dell'attesa, in ms: oltre questo il velo si alza comunque. */
const CAP_MAX_MS = 12000;

// LE RICEVUTE, dal banco, 1672x941, tier alto, macchina carica (quattro server
// altrui in piedi), Chrome/ANGLE d3d11, ?dev&intro=0, orologio VIVO.
// Si rifanno con:  node fondazione/campo2/g-arrivo.mjs 4360 <dir> 2
const RECEIPT = {
  strumento: 'fondazione/campo2/g-arrivo.mjs',
  // (a) quando il suolo e' intero, e quando il velo si e' alzato, per visita
  prontoA: [7.58, 7.41],
  veloA: [7.58, 7.41],
  perche: ['col suolo intero', 'col suolo intero'],
  // prima di M5, sulla stessa macchina: il velo se ne andava a 6,89-7,80 s
  // «a tempo» con il suolo intero solo a 8,11-9,01 s
  primaVeloA: [7.80, 6.89],
  primaProntoA: [9.01, 8.11],
  // (b) dal velo COMPLETAMENTE sparito (2 s di tenuta + 2,5 di dissolvenza) in
  // poi, a camera ferma: la piu' grande COSA SOLA che compare fra due scatti a
  // 0,2 s, dopo l'erosione che separa una linea dalla grana
  lineaDopoVelo: [0.129, 0.0301],
  // (d) di quanti gradi il banco di calibrazione gira l'occhio del visitatore
  imbardataBanco: 0,
  campioniBanco: 132,
  primaImbardataBanco: 8.3,
};

/** Il verdetto, a parte dal mondo, cosi' che un difetto ci si possa iniettare. */
export function arrived({ pronto, velo, perche, linea, imbardata }) {
  return {
    aspetta: perche === 'col suolo intero' ? velo >= pronto - 0.05 : velo > 0,
    dichiarato: perche === 'col suolo intero' || perche === 'a tempo',
    quieto: linea <= 0.3,
    fermo: imbardata === 0,
  };
}

if (process.argv.includes('--self')) {
  const buono = { pronto: 7.4, velo: 7.4, perche: 'col suolo intero', linea: 0.03, imbardata: 0 };
  selfTest('guard-arrivo', [
    {
      what: 'un velo che si alza prima che il suolo sia intero e dice di averlo aspettato',
      caught: !arrived({ ...buono, velo: 5.0 }).aspetta,
    },
    {
      what: 'una ragione che il velo non sa dire',
      caught: !arrived({ ...buono, perche: null }).dichiarato,
    },
    {
      what: 'una famiglia che entra tutta in un fotogramma dopo il velo',
      caught: !arrived({ ...buono, linea: 1.4 }).quieto,
    },
    {
      what: 'un banco che gira l\'occhio del visitatore',
      caught: !arrived({ ...buono, imbardata: 8.3 }).fermo,
    },
    {
      what: 'e un arrivo intero che passa',
      caught: Object.values(arrived(buono)).every(Boolean),
    },
  ]);
}

const report = reporter('guard-arrivo -- niente si costruisce a vista, e l\'occhio e\' del visitatore');

// ------------------------------------------- 1. IL VELO ASPETTA IL SUOLO
const main = read('src/main.js');
report.check(/hub\.groundReady\(\)/.test(main),
  'il velo chiede al mondo se il suolo e\' INTERO, invece di contare i secondi');
report.check(/beginVeilWhenGround\(\)/.test(main)
  && !/^\s*veil\.begin\(\);\s*$/m.test(main),
  'e nessuno alza piu\' il velo per conto proprio',
  'tre porte d\'arrivo (il suolo, la scena, la scena che non arriva) e una sola attesa');
const cap = Number((main.match(/const VEIL_GROUND_CAP_MS = (\d+);/) || [])[1]);
report.check(Number.isFinite(cap) && cap > 0 && cap <= CAP_MAX_MS,
  'sotto l\'attesa c\'e\' un tetto, perche' + '\' una pagina non puo\' promettere per sempre',
  `${cap} ms, massimo ammesso ${CAP_MAX_MS}`);

const hub = read('src/world/hub.js');
report.check(/groundReady\(\)\s*\{/.test(hub) && /field\.ready\(\)/.test(hub),
  'e la domanda arriva alla finestra che sa la risposta',
  'hub.groundReady() -> campo.ready(): entrambe le finestre piene');

const veil = read('src/ui/veil.js');
report.check(/get raisedFor\(\)/.test(veil),
  'il velo dice per quale delle due ragioni si e\' alzato',
  'una misura deve poter distinguere «col suolo intero» da «a tempo»');

// -------------------------------------- 2. LE TESSERE, NELL'ORDINE GIUSTO
const field = read('src/world/voxel/campo-field.js');
report.check(/wanted\.sort\(/.test(field) && /ax \* ax \+ az \* az/.test(field),
  'le tessere sono chieste dalla piu\' VICINA, non per righe',
  'se qualcosa si vede sotto il velo, si vede dai piedi in fuori e non a strisce');

// ------------------------------------ 3. LA CALIBRAZIONE NON PRENDE L'OCCHIO
const bench = read('src/core/bench.js');
const sweep = Number((bench.match(/const SWEEP_DEGREES = (-?\d+(?:\.\d+)?);/) || [])[1]);
report.check(sweep === 0,
  'il banco misura con l\'occhio FERMO sull\'inquadratura d\'arrivo (D-R8-1, B)',
  `${sweep} gradi, contro i 180 che spediva`);
report.check(/D-R8-1/.test(bench) && /verbale/.test(bench),
  'e cio\' che quella scelta costa in superfici misurate e\' dichiarato dove sta la scelta');

// ------------------------------------------------------------ 4. LE RICEVUTE
for (let v = 0; v < RECEIPT.prontoA.length; v += 1) {
  const verdict = arrived({
    pronto: RECEIPT.prontoA[v],
    velo: RECEIPT.veloA[v],
    perche: RECEIPT.perche[v],
    linea: RECEIPT.lineaDopoVelo[v],
    imbardata: RECEIPT.imbardataBanco,
  });
  report.check(verdict.aspetta && verdict.dichiarato,
    `visita ${v + 1}: il velo si e\' alzato quando il suolo era intero`,
    `suolo a ${RECEIPT.prontoA[v]} s, velo a ${RECEIPT.veloA[v]} s «${RECEIPT.perche[v]}» `
    + `(prima: velo a ${RECEIPT.primaVeloA[v]} s «a tempo», suolo intero solo a `
    + `${RECEIPT.primaProntoA[v]} s)`);
  report.check(verdict.quieto,
    `visita ${v + 1}: dopo il velo nessuna COSA SOLA compare fra due scatti a 0,2 s`,
    `${RECEIPT.lineaDopoVelo[v]}% del quadro, soffitto 0,3%`);
}
report.check(RECEIPT.imbardataBanco === 0,
  'e la calibrazione non ha girato l\'occhio di un grado',
  `${RECEIPT.imbardataBanco} gradi su ${RECEIPT.campioniBanco} letture, `
  + `contro gli ${RECEIPT.primaImbardataBanco} che girava`);

report.note('L\'ORDINE DI PRIMA COMPARSA e\' nel verbale e non e\' gateato qui: '
  + 'cielo, poi suolo e pietra, poi manto/fiori/nuvole/alberi -- e da M5 tutte e tre '
  + 'le tappe stanno SOTTO il velo (le famiglie a 2,4-3,4 s, il velo si alza a 7,4-7,6). '
  + 'La dissolvenza per famiglia (uBirth, R8 M5.3) resta a U-CAMPO-2-bis: serve solo '
  + 'sulla macchina in cui il TETTO scatta, e su questa non scatta piu\'.');

report.end(`ricevute dal banco ${RECEIPT.strumento}, due visite, macchina carica`);
