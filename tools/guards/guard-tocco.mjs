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
report.check(/input\.touch = touchWanted\(\);/.test(main),
  'quale mano cammina si decide una volta sola, e nessuno la ricalcola');
report.check(/if \(asked === '1'\) return true;/.test(touch) && /if \(asked === '0'\) return false;/.test(touch),
  'le maniglie ?tocco=1 e ?tocco=0 esistono, e l\'indirizzo vince in tutti e due i versi');

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
      what: 'una regola di foglio della modalita\' che tocca anche la scrivania',
      caught: straysThen.length > 0,
    },
  ]);
}

report.end(`raggio ${TOUCH.radiusPx} px, zona morta ${TOUCH.deadZone}, orlo `
  + `${TOUCH.runAt}, scala del dito ${TOUCH.lookScale}; tocco secco sotto `
  + `${TOUCH.tapPx} px e ${TOUCH.tapMs} ms; ${(quarter / DEG).toFixed(1)} gradi `
  + 'per mezzo schermo');
