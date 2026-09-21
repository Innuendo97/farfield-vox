import { read, reporter, selfTest } from './lib.mjs';
import { TOUCH, dragKind, joystickAxis } from '../../src/ui/touch.js';

// GUARD-TOCCO -- IL POLLICE DICE UNA COSA SOLA, E IL MONDO LA FA.
//
//   node tools/guards/guard-tocco.mjs
//   node tools/guards/guard-tocco.mjs --self
//
// ===========================================================================
// PERCHE' ESISTE.
//
// Fino a ieri questo mondo si camminava con quattro tasti e un mouse preso in
// prestito dal sistema, e su un telefono non si camminava affatto: il blocco
// del puntatore viene rifiutato, «Clicca per esplorare» torna su e resta, e
// nessun pezzo della pagina aveva mai sentito parlare di un dito. I comandi a
// schermo sono la seconda mano, e una seconda mano ha quattro modi di essere
// peggiore di nessuna mano. Sono i quattro che questa guardia misura.
//
//   1. LA LEVETTA CHE CAMMINA DA SOLA. Un pollice appoggiato sul vetro non sta
//      mai fermo. Senza zona morta il camminatore parte per conto suo, e un
//      mondo che si muove quando nessuno ha chiesto niente e' rotto in un modo
//      che nessuna fotografia mostra.
//   2. IL TOCCO LETTO COME TRASCINAMENTO. Aprire una pietra e guardarsi intorno
//      sono lo stesso gesto a meno di dodici pixel: se la soglia sbaglia, o si
//      apre una pietra ogni volta che si gira la testa, o non si apre mai.
//   3. LA SCRITTA CHE TORNA. E' il difetto originale, e il modo piu' facile di
//      rimetterlo dentro e' una riga che dice «senza blocco -> mostra la
//      scritta» senza dire «e non siamo col dito». Il visitatore si trova la
//      porta davanti al mondo in cui e' gia' entrato.
//   4. LA SCRIVANIA CHE SE NE ACCORGE. Fuori dalla modalita' tocco non cambia
//      NIENTE: nessun gestore in piu', nessuna maniglia, nessuna regola di
//      foglio che possa toccare un pixel del fotogramma su cui l'intera
//      campagna e' misurata.
//
// ===========================================================================
// COME MISURA. La legge della levetta e quella del trascinamento sono importate
// da src/ui/touch.js e misurate DIRETTAMENTE: joystickAxis() e dragKind() sono
// aritmetica su numeri e non toccano il documento, quindi questa guardia prova
// il programma e non una seconda copia di esso scritta qui. Il resto -- la
// scritta, il puntatore, la scrivania -- e' nel sorgente, e si legge nel
// sorgente.

const report = reporter('guard-tocco -- il pollice dice una cosa sola, e il mondo la fa');

const player = read('src/core/player.js');
const input = read('src/core/input.js');
const main = read('src/main.js');
const touch = read('src/ui/touch.js');
const sheet = read('src/ui/style.css');
const hud = read('src/ui/hud.js');

const DEG = Math.PI / 180;
// La sensibilita' del mouse, riscritta qui e non importata: una prova che si fa
// dare il numero da cio' che misura non misura niente.
const LOOK_SENSITIVITY = 0.0022;
// Mezzo schermo di un telefono tenuto di traverso.
const HALF_SCREEN_PX = 915 / 2;

// ---------------------------------------------------------------------------
// 1. LA LEVETTA, che e' la legge importata e non una sua descrizione.
// ---------------------------------------------------------------------------
report.line('');
report.line('  la levetta');

// UN POLLICE FERMO. Nought esatto, e non «quasi»: qualunque numero diverso da
// zero qui e' un camminatore che parte da solo, e il float che lo porta non ha
// importanza.
const still = joystickAxis(0, 0);
const drifting = joystickAxis(TOUCH.radiusPx * TOUCH.deadZone * 0.6, 0);
const stillDead = still.x === 0 && still.z === 0
  && drifting.x === 0 && drifting.z === 0 && drifting.push === 0;
report.check(stillDead, 'un pollice dentro la zona morta non muove niente',
  `deriva di ${(TOUCH.deadZone * 0.6 * 100).toFixed(0)}% del raggio -> spinta ${drifting.push}`);

// E SUBITO FUORI RIPARTE DA NOUGHT, che e' l'altra meta' della stessa cosa: una
// zona morta TOLTA lascia un gradino al suo orlo, e il primo passo di ogni
// camminata sarebbe un salto.
const atEdge = joystickAxis(TOUCH.radiusPx * (TOUCH.deadZone + 1e-4), 0);
const justPast = joystickAxis(TOUCH.radiusPx * (TOUCH.deadZone + 0.02), 0);
report.check(atEdge.push < 0.002 && justPast.push > atEdge.push && justPast.push < 0.05,
  'e appena fuori riparte da nought invece di scattare',
  `${atEdge.push.toFixed(4)} sull'orlo, ${justPast.push.toFixed(4)} due centesimi oltre`);

// LA DIREZIONE E' L'ANGOLO. Otto rilevamenti, e ognuno esce dov'e' entrato.
let worstAngle = 0;
for (let k = 0; k < 16; k += 1) {
  const a = (k / 16) * Math.PI * 2;
  const dx = Math.cos(a) * TOUCH.radiusPx * 0.7;
  const dy = Math.sin(a) * TOUCH.radiusPx * 0.7;
  const axis = joystickAxis(dx, dy);
  const back = Math.atan2(axis.z, axis.x);
  let gap = Math.abs(back - Math.atan2(dy, dx));
  if (gap > Math.PI) gap = Math.PI * 2 - gap;
  worstAngle = Math.max(worstAngle, gap);
}
report.check(worstAngle < 1e-9, 'la direzione e\' l\'angolo del pollice, su tutto il giro',
  `scarto peggiore ${(worstAngle / DEG).toExponential(2)} gradi`);

// L'INTENSITA' E' LA DISTANZA, con la zona morta rimossa e il resto ristirato.
const halfway = joystickAxis(TOUCH.radiusPx * 0.5, 0);
const wantHalf = (0.5 - TOUCH.deadZone) / (1 - TOUCH.deadZone);
report.check(Math.abs(halfway.push - wantHalf) < 1e-12,
  'l\'intensita\' e\' la distanza dal centro, ristirata oltre la zona morta',
  `a mezzo raggio ${halfway.push.toFixed(4)}, atteso ${wantHalf.toFixed(4)}`);

// E NON PIU' DI UNO. Un pollice che ha lasciato l'anello ha detto tutto quello
// che poteva dire; oltre, la spinta e' ferma a uno e il camminatore non accelera.
const far = joystickAxis(TOUCH.radiusPx * 4, TOUCH.radiusPx * 4);
report.check(Math.abs(far.push - 1) < 1e-12 && Math.hypot(far.x, far.z) <= 1 + 1e-12,
  'e oltre l\'anello la spinta resta una e non cresce',
  `quattro raggi fuori -> ${far.push.toFixed(4)}`);

// AVANTI E' -Z, come per la tastiera: il corpo legge un asse solo.
const forward = joystickAxis(0, -TOUCH.radiusPx);
report.check(forward.z < 0 && Math.abs(forward.x) < 1e-12,
  'spingere in su e\' camminare avanti, nello stesso asse della tastiera',
  `z = ${forward.z.toFixed(3)}`);

// L'ORLO E' LA CORSA (E-DECISIONI27), e non un pixel prima.
const under = joystickAxis(0, -TOUCH.radiusPx * (TOUCH.runAt - 0.02));
const over = joystickAxis(0, -TOUCH.radiusPx * (TOUCH.runAt + 0.02));
report.check(under.running === false && over.running === true,
  'oltre l\'orlo si corre, e sotto no, senza nessun bottone in piu\'',
  `orlo a ${TOUCH.runAt} del raggio`);
report.check(joystickAxis(0, 0).running === false,
  'e un pollice fermo non corre');

// E L'ANELLO DISEGNATO E' L'ANELLO CHE IL CAMMINO MISURA.
//
// La levetta ha una proprieta' che nessuna delle righe qui sopra puo' vedere:
// il cerchio contro cui l'OCCHIO valuta quanto sta spingendo e' un numero nel
// foglio, e il raggio contro cui il CAMMINO lo valuta e' un numero in touch.js.
// Se i due si separano, un pollice sull'orlo del cerchio disegnato non corre —
// o corre molto prima di arrivarci — e nessuna prova di aritmetica se ne
// accorge, perche' l'aritmetica e' giusta: sbagliato e' il disegno. Il raggio
// e' gia' cambiato una volta (54 -> 40, E-DECISIONI29), che e' esattamente il
// momento in cui due numeri in due file si perdono di vista.
const ring = sheet.slice(sheet.indexOf('.touch-stick {'));
const ringWidth = Number((/width: (\d+)px;/.exec(ring) || [])[1]);
const ringMargin = Number((/margin: -(\d+)px 0 0 -\d+px;/.exec(ring) || [])[1]);
report.check(ringWidth === TOUCH.radiusPx * 2 && ringMargin === TOUCH.radiusPx,
  'l\'anello disegnato e\' largo due raggi, e sta centrato sul dito',
  `${ringWidth} px e margine ${ringMargin} px contro un raggio di ${TOUCH.radiusPx}`);

// ---------------------------------------------------------------------------
// 2. IL TRASCINAMENTO: che cos'e' un tocco, e quanto gira un dito.
// ---------------------------------------------------------------------------
report.line('');
report.line('  il trascinamento');

const tap = dragKind(3, 4, 120);
const slid = dragKind(TOUCH.tapPx + 6, 0, 120);
const lingered = dragKind(2, 2, TOUCH.tapMs + 200);
report.check(tap === 'tocco', 'corto e piccolo e\' un tocco secco',
  `${TOUCH.tapPx} px e ${TOUCH.tapMs} ms`);
report.check(slid === 'trascinamento', 'un dito che scorre non e\' un tocco');
report.check(lingered === 'trascinamento', 'e nemmeno un dito che si attarda');

const quarter = HALF_SCREEN_PX * LOOK_SENSITIVITY * TOUCH.lookScale;
const offBy = Math.abs(quarter - Math.PI / 2) / (Math.PI / 2);
report.check(offBy <= 0.10, 'mezzo schermo di trascinamento e\' un quarto di giro',
  `${(quarter / DEG).toFixed(1)} gradi su ${HALF_SCREEN_PX} px, scarto ${(offBy * 100).toFixed(1)}%`);

// ---------------------------------------------------------------------------
// 3. IL PUNTATORE, che in modalita' tocco non si chiede MAI.
// ---------------------------------------------------------------------------
report.line('');
report.line('  il puntatore, e la scritta che non deve tornare');

const locksInTouch = /if \(this\.#touch \|\| this\.#locked\) return undefined;/.test(input);
report.check(locksInTouch, 'requestLock rifiuta da solo quando si cammina col dito');
report.check(/click: \(\) => \{ this\.engage\(\); if \(!this\.#touch\) this\.requestLock\(\); \},/.test(input),
  'e il click sulla tela non lo chiede nemmeno');
report.check(/if \(input\.touch\) return;/.test(main),
  'recapturePointer non riprende un puntatore che non e\' mai stato preso');
report.check(/if \(!input\.touch\) document\.exitPointerLock\(\);/.test(main),
  'e releasePointer non lascia andare quello che non tiene');
report.check(/if \(!input\.locked && !input\.touch\) overlay\.setVisible\(true\);/.test(main),
  'la scritta d\'ingresso torna solo fuori dalla modalita\' tocco');
report.check(/if \(input\.touch\) input\.onEngage\(\(\) => overlay\.setVisible\(false\)\);/.test(main),
  'e col dito e\' l\'ingresso stesso a mandarla via, non il blocco');
// IL TOCCO CHE FA ENTRARE NON E' UN COMANDO. Il mondo consegna il camminatore
// a 4,19 m dalla faccia del sesto blocco e la portata di E e' 4,20: la pietra
// e' gia' a portata quando si arriva, e senza questa riga il tocco che toglie
// «Tocca per esplorare» apre anche i pannelli. Misurato sulla lastra verticale.
report.check(/const opening = !input\.engaged;/.test(touch)
  && /!held\.opening && state\(\) === 'vicino'/.test(touch),
  'il tocco che fa entrare non apre anche la pietra davanti a cui si arriva');
// QUALE MANO CAMMINA SI LEGGE UNA VOLTA SOLA, E ADESSO LA REGOLA E' CONTATA
// INVECE CHE CITATA.
//
// Questa riga cercava la stringa `input.touch = touchWanted();`. La proprieta'
// che difende non e' quella stringa: e' che la domanda si faccia UNA VOLTA e
// che tutto il resto della pagina legga quell'unica risposta -- perche' una
// seconda lettura e' un secondo parere su quale pagina si sta costruendo, e la
// scena d'apertura, il prompt, il menu e il corpo devono essere d'accordo.
//
// E-DECISIONI33 ha spostato la lettura in cima al file senza toccare la
// proprieta': l'inquadratura e' inchiodata a uno in modalita' tocco (src/ui/
// touch.js ascolta i pointer sulla TELA, quindi un quadro piu' piccolo della
// finestra lascerebbe le dita sul nulla), e l'inquadratura e' la prima cosa
// della pagina che deve saperlo -- prima che `input` esista. Cosi' la chiamata
// e' diventata `const TOUCH = touchWanted();` e `input.touch = TOUCH;`.
//
// Quindi la gamba adesso CONTA le letture invece di riconoscerne una, che e'
// piu' forte di prima: la versione a stringa passava anche con tre chiamate in
// giro per il file, purche' una fosse scritta cosi'.
const readings = (main.match(/touchWanted\(\)/g) || []).length;
report.check(
  readings === 1
    && /const TOUCH = touchWanted\(\);/.test(main)
    && /input\.touch = TOUCH;/.test(main),
  'quale mano cammina si decide una volta sola, e nessuno la ricalcola',
  `${readings} lettura/e di touchWanted() in src/main.js`,
);
report.check(/if \(asked === '1'\) return true;/.test(touch) && /if \(asked === '0'\) return false;/.test(touch),
  'le maniglie ?tocco=1 e ?tocco=0 esistono, e l\'indirizzo vince in tutti e due i versi');
// E LA MODALITA' LA DECIDE IL PUNTATORE PRIMARIO, E NIENT'ALTRO (E-DECISIONI29,
// B). «Questa macchina riporta dei tocchi» e «questa macchina si usa col dito»
// sono due domande diverse: alla prima un portatile con schermo touch risponde
// di si' pur avendo mouse e tastiera, e si ritroverebbe i comandi a schermo e
// il puntatore non piu' chiesto, cioe' perderebbe i comandi che aveva gia' in
// mano. La riga da non far rientrare e' proprio quella.
const wanted = touch.slice(touch.indexOf('export function touchWanted'));
const wantedBody = wanted.slice(0, wanted.indexOf('\n}\n') + 2);
report.check(/media\('\(pointer: coarse\)'\)/.test(wantedBody),
  'la modalita\' si accende sul puntatore PRIMARIO grossolano');
report.check(!/maxTouchPoints|ontouchstart|any-pointer/.test(wantedBody),
  'e non su «la macchina riporta dei tocchi», che e\' un\'altra domanda',
  'un portatile con schermo touch tiene mouse e tastiera');

report.check(/if \(input\.locked \|\| input\.touch\) this\.look\(input\.drainLook\(\)\);/.test(player),
  'il corpo guarda anche senza blocco quando la mano e\' un dito');
// E IL CORPO NON IMPARA ALTRO. Una sola riga di player.js ha il diritto di
// sapere che un dito esiste; se ne compare una seconda, lo stato ha cominciato
// a uscire da src/core/input.js.
const touchesInPlayer = (player.match(/input\.touch/g) || []).length;
report.check(touchesInPlayer === 1, 'e non impara nient\'altro sul dito',
  `${touchesInPlayer} citazione nel corpo`);

// ---------------------------------------------------------------------------
// 4. L'INTERFACCIA PICCOLA: touch.js parla con Input e con nessun altro.
// ---------------------------------------------------------------------------
report.line('');
report.line('  l\'interfaccia fra il dito e il mondo');

for (const said of ['input.setTouchAxis(', 'input.addTouchLook(', 'input.command(']) {
  report.check(touch.includes(said), `touch.js dice «${said.replace('input.', '').replace('(', '')}»`);
}
report.check(!/\bplayer\b/.test(touch.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')),
  'e non conosce il camminatore');
report.check(/#touchX = 0;/.test(input) && /#touchRunning = false;/.test(input),
  'tutto lo stato del dito vive in Input, accanto a quello della tastiera');
report.check(/return \{ x: this\.#touchX, z: this\.#touchZ \};/.test(input),
  'e esce dalla stessa porta da cui escono i tasti');
report.check(/this\.#touchRunning\s*\n?\s*\|\| this\.#pressed\.has\('ShiftLeft'\)/.test(input),
  'la corsa e\' una domanda sola con due mani che rispondono');

// ---------------------------------------------------------------------------
// 5. LA SCRIVANIA, che non deve essersi accorta di niente.
// ---------------------------------------------------------------------------
report.line('');
report.line('  la scrivania');

// Ogni regola nuova del foglio o e' dietro body.is-touch, o e' su una classe
// che nasce con la modalita' e che una pagina da scrivania non costruisce mai.
// I commenti si tolgono PRIMA di tagliare, o il taglio cade dentro uno di essi
// e mezzo commento resta a farsi leggere come una regola.
const bare = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
const block = bare.slice(bare.indexOf('body.is-touch'));
const selectors = block
  .split('}')
  .map((chunk) => chunk.split('{')[0].trim())
  .filter(Boolean)
  .flatMap((list) => list.split(',').map((s) => s.trim()))
  .filter((s) => s && !s.startsWith('@') && !s.startsWith('/*'));
const strays = selectors.filter((s) => !/body\.is-touch|\.touch-|\.hud-interact\.is-touch|\.hud-hint-gesture|\.menu-gesture|\.hud-interact-mark/.test(s));
report.check(strays.length === 0,
  'ogni regola nuova del foglio e\' dietro body.is-touch o su una classe della modalita\'',
  strays.length ? strays.slice(0, 3).join(' | ') : `${selectors.length} selettori letti`);
report.check(/if \(input\.touch\) document\.body\.classList\.add\('is-touch'\);/.test(main),
  'e la classe si mette solo quando la modalita\' e\' accesa');
// LA BUSSOLA ESCE DALL'ANGOLO DEL POLLICE, E SOLO LI'. Sulla scrivania resta
// dove il riferimento la disegna, che e' cio' su cui sta in piedi il byte di
// questo ramo.
const dial = sheet.slice(sheet.indexOf('body.is-touch .hud-compass'));
const dialBody = dial.slice(dial.indexOf('{'), dial.indexOf('}') + 1);
report.check(/right:/.test(dialBody) && /top:/.test(dialBody)
  && /left: auto/.test(dialBody) && /bottom: auto/.test(dialBody),
  'in modalita\' tocco la bussola sta in alto a destra, fuori dalla mano che cammina');
report.check(/\.hud-compass \{\n  position: absolute;\n  left: 1\.59rem;/.test(sheet),
  'e sulla scrivania e\' esattamente dove il riferimento la disegna');
report.check(/const touch = input\.touch\s*\n\s*\? createTouchControls\(\{/.test(main),
  'i comandi a schermo non si costruiscono affatto sulla scrivania');
report.check(/touch\?\.update\(interaction\.state\);/.test(main),
  'e il fotogramma li chiama attraverso un nulla quando non ci sono');

// IL COSTO PER FOTOGRAMMA. L'unico lavoro che la modalita' aggiunge al giro e'
// update(), e update() ha il diritto di fare un confronto fra due stringhe e
// nient'altro: una classe scritta col valore che ha gia' e' comunque un
// invalidamento che il browser percorre, ed e' la stessa regola che
// src/ui/reticle.js tiene.
const updateBody = touch.slice(touch.indexOf('    update(now) {'));
const updateOnly = updateBody.slice(0, updateBody.indexOf('\n    },'));
report.check(/if \(wanted === shown\) return;/.test(updateOnly),
  'il giro del fotogramma esce subito quando non e\' cambiato niente');
report.check(!/querySelector|getBoundingClientRect|style\./.test(updateOnly),
  'e non legge ne\' scrive il documento quando non serve');

// L'INGRESSO DELLA SCRIVANIA E' QUELLO DI SEMPRE, parola per parola.
report.check(/<p>Clicca per esplorare<\/p>/.test(read('src/ui/overlay.js')),
  'la scritta d\'ingresso della scrivania e\' quella di sempre');
report.check(/hintRow\(\['W', 'A', 'S', 'D'\], 'per muoverti'\), hintRow\(\['E'\], 'per interagire'\)/.test(hud),
  'e i suggerimenti della scrivania sono i due tasti di sempre');

// ---------------------------------------------------------------------------
// IL BYTE DELLA SCRIVANIA, che si misura fuori di qui: e' un fotogramma vero
// contro un fotogramma vero, con due server e due aperture della pagina, e non
// e' una cosa che una guardia di sorgente possa fare. Vedi
// per-il-committente/lav/2026-09-19-tocco-1-byte.mjs, sul modello di U-CAMPO-7.
// ---------------------------------------------------------------------------
report.note('il byte della scrivania si misura con 2026-09-19-tocco-1-byte.mjs: '
  + 'main contro tocco-1 alla posa P con ?t0, quattro bande, controllo main contro main');

if (process.argv.includes('--self')) {
  // I DIFETTI VERI, uno per volta. Le due leggi sono riscritte con una leva
  // spenta -- che e' esattamente il modo in cui una sarebbe sbagliata -- e il
  // sorgente e' riscritto togliendo la riga che regge la regola.

  /** La levetta senza zona morta: un pollice appoggiato cammina da solo. */
  const noDeadZone = (dx, dy) => {
    const length = Math.hypot(dx, dy);
    if (length <= 0) return { x: 0, z: 0, push: 0, running: false };
    const reach = Math.min(1, length / TOUCH.radiusPx);
    return {
      x: (dx / length) * reach,
      z: (dy / length) * reach,
      push: reach,
      running: reach >= TOUCH.runAt,
    };
  };
  const drift = noDeadZone(TOUCH.radiusPx * TOUCH.deadZone * 0.6, 0);

  /** La zona morta ritagliata invece che tolta: un gradino sul suo orlo. */
  const cutOut = (dx, dy) => {
    const length = Math.hypot(dx, dy);
    const reach = Math.min(1, length / TOUCH.radiusPx);
    const push = reach <= TOUCH.deadZone ? 0 : reach;
    return { push };
  };

  /** Un orlo che non corre mai. */
  const neverRuns = (dy) => {
    const reach = Math.min(1, Math.abs(dy) / TOUCH.radiusPx);
    return { running: reach >= 1.01 };
  };

  /** Un tocco secco letto come trascinamento. */
  const noTaps = (dx, dy, ms) => (Math.hypot(dx, dy) <= 0 && ms <= TOUCH.tapMs
    ? 'tocco' : 'trascinamento');
  /** E un trascinamento letto come tocco, che apre una pietra a ogni sguardo. */
  const allTaps = (dx, dy, ms) => (Math.hypot(dx, dy) <= 400 && ms <= 4000
    ? 'tocco' : 'trascinamento');

  // La scritta che torna: la riga di main.js senza la meta' che la tiene giu'.
  const overlayBack = main.replace(
    'if (!input.locked && !input.touch) overlay.setVisible(true);',
    'if (!input.locked) overlay.setVisible(true);',
  );
  // Il blocco chiesto lo stesso, che e' il rifiuto, la riga in console e la
  // scritta rimessa su sopra un mondo in cui si e' gia' entrati.
  const lockAsked = input.replace(
    'if (this.#touch || this.#locked) return undefined;',
    'if (this.#locked) return undefined;',
  );
  // Il tocco d'ingresso che vale anche come comando, cioe' un visitatore a cui
  // il mondo si apre con una pila di pannelli che non ha chiesto.
  const entryActs = touch.replace("!held.opening && state() === 'vicino'", "state() === 'vicino'");
  // La domanda sbagliata sul rilevamento, rimessa dentro: un portatile con
  // schermo touch che perde il mouse.
  const touchyLaptop = wantedBody.replace(
    "return Boolean(media && media('(pointer: coarse)').matches);",
    "if (media && media('(pointer: coarse)').matches) return true;\n"
    + "  return (navigator.maxTouchPoints || 0) > 0;",
  );
  // E l'anello staccato dal raggio: il cerchio dice una spinta e il cammino ne
  // fa un'altra, e l'orlo non e' piu' dove si vede.
  const looseRing = ring.replace('width: 80px;', 'width: 108px;');
  const looseWidth = Number((/width: (\d+)px;/.exec(looseRing) || [])[1]);
  // E la bussola che si sposta anche sulla scrivania.
  const dialMoved = sheet.replace('.hud-compass {\n  position: absolute;\n  left: 1.59rem;',
    '.hud-compass {\n  position: absolute;\n  right: 1.59rem;');
  // E una regola di foglio che si applica anche alla scrivania.
  const deskTouched = `${block}\n.hud-footer { bottom: 1rem; }\n`;
  const straysThen = deskTouched
    .split('}')
    .map((chunk) => chunk.split('{')[0].trim())
    .filter(Boolean)
    .flatMap((list) => list.split(',').map((s) => s.trim()))
    .filter((s) => s && !s.startsWith('@'))
    .filter((s) => !/body\.is-touch|\.touch-|\.hud-interact\.is-touch|\.hud-hint-gesture|\.menu-gesture|\.hud-interact-mark/.test(s));

  selfTest('guard-tocco', [
    {
      what: 'una zona morta che manda avanti a dito fermo',
      caught: !(drift.x === 0 && drift.z === 0 && drift.push === 0),
    },
    {
      what: 'una zona morta ritagliata invece che tolta, che scatta sul suo orlo',
      caught: !(cutOut(TOUCH.radiusPx * (TOUCH.deadZone + 1e-4), 0).push < 0.002),
    },
    {
      what: 'un orlo a cui non si corre mai',
      caught: neverRuns(TOUCH.radiusPx * (TOUCH.runAt + 0.02)).running !== true,
    },
    {
      what: 'un tocco secco letto come trascinamento, che non apre mai una pietra',
      caught: noTaps(3, 4, 120) !== 'tocco',
    },
    {
      what: 'un trascinamento letto come tocco, che apre una pietra a ogni sguardo',
      caught: allTaps(TOUCH.tapPx + 6, 0, 120) !== 'trascinamento',
    },
    {
      what: 'una scritta d\'ingresso che torna sopra un mondo gia\' aperto',
      caught: !/if \(!input\.locked && !input\.touch\) overlay\.setVisible\(true\);/.test(overlayBack),
    },
    {
      what: 'un blocco del puntatore chiesto lo stesso al dito',
      caught: !/if \(this\.#touch \|\| this\.#locked\) return undefined;/.test(lockAsked),
    },
    {
      what: 'un tocco d\'ingresso che apre anche la pietra a cui si arriva',
      caught: !/!held\.opening && state\(\) === 'vicino'/.test(entryActs),
    },
    {
      what: 'un portatile con schermo touch a cui la modalita\' porta via il mouse',
      caught: /maxTouchPoints|ontouchstart|any-pointer/.test(touchyLaptop),
    },
    {
      what: 'un anello disegnato piu\' largo del raggio che il cammino misura',
      caught: looseWidth !== TOUCH.radiusPx * 2,
    },
    {
      what: 'una bussola che si sposta anche sulla scrivania',
      caught: !/\.hud-compass \{\n  position: absolute;\n  left: 1\.59rem;/.test(dialMoved),
    },
    {
      what: 'una regola di foglio della modalita\' che tocca anche la scrivania',
      caught: straysThen.length > 0,
    },
  ]);
}

report.end(`raggio ${TOUCH.radiusPx} px, zona morta ${TOUCH.deadZone}, orlo `
  + `${TOUCH.runAt}, scala del dito ${TOUCH.lookScale}; tocco secco sotto `
  + `${TOUCH.tapPx} px e ${TOUCH.tapMs} ms; ${(quarter / DEG).toFixed(1)} gradi `
  + 'per mezzo schermo');
