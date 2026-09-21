import { decideFraming } from '../../src/core/bench.js';
import {
  ASPECT_CEILING, askedFraction, bufferPixels, FRACTION_FLOOR, FRACTIONS, frameOf,
  MODEL, PIXEL_CEILING, predictMs, windowPixels,
} from '../../src/core/inquadratura.js';
import { braceBody, read, reporter, selfTest } from './lib.mjs';

// THE FRAMING: A FRACTION OF THE WINDOW, TWO CEILINGS, A FLOOR, AND NOBODY
// MOVING IT AFTERWARDS.
//
// WHAT THIS GUARD IS FOR. src/core/inquadratura.js buys milliseconds with AREA
// instead of with SOFTNESS -- a smaller picture at the screen's own pixel
// rather than the whole window at a coarser one -- and the whole argument rests
// on four rules that are easy to state and easy to lose in a merge:
//
//   1. ONE IS NOT A FRACTION. At `?inquadratura=1` the page is the page this
//      campaign has measured, to the byte: no ceiling, no centred rectangle, no
//      night. Every plate and every other guard in this repository is taken
//      through that door, so a defect that made it merely ALMOST today's page
//      would quietly move the ground under forty other checks.
//   2. THE TWO CEILINGS HOLD. Sixteen by nine on the shape, and 1 700 000
//      pixels of buffer absolutely -- the number that contains a 4K panel while
//      leaving the reference window untouched.
//   3. THE FLOOR HOLDS. A machine too slow for six tenths of its window is not
//      given a smaller picture; it is given six tenths and the tier ladder, as
//      it always was.
//   4. THE GOVERNOR NEVER TOUCHES IT. The framing is decided once and held for
//      the whole visit, because a picture that changed SIZE under a walker is
//      the one thing in all of this that cannot be missed.
//
// AND IT RUNS UNDER PLAIN NODE FOR ALL OF THAT. The arithmetic is a pure module
// and the policy is a pure function, so the four rules above are answered at
// every commit rather than at every screenshot. The last leg needs a browser
// and SKIPs without one, which is the protocol in tools/guards/lib.mjs.

const report = reporter('inquadratura -- una frazione della finestra, due tetti, un pavimento');

// The windows this is asked about. The reference is the committente's own; the
// rest are the ones that break things: a shape past the proportion ceiling, a
// panel past the pixel ceiling, a screen whose device ratio multiplies both,
// and a telephone.
const WINDOWS = [
  { name: 'riferimento      ', width: 1892, height: 845, ratio: 1 },
  { name: 'riferimento dpr15', width: 1892, height: 845, ratio: 1.5 },
  { name: 'ultralarga 21:9  ', width: 3440, height: 1440, ratio: 1 },
  { name: '4K               ', width: 3840, height: 2160, ratio: 1 },
  { name: '4K dpr 1.5       ', width: 3840, height: 2160, ratio: 1.5 },
  { name: 'finestrina 4:3   ', width: 1024, height: 768, ratio: 1 },
  { name: 'telefono         ', width: 390, height: 844, ratio: 1.5 },
];

const FRAMED = FRACTIONS.filter((f) => f < 1);

// ===========================================================================
// THE PREDICATES, WRITTEN AS FUNCTIONS SO THAT --self CAN FEED THEM A DEFECT.
//
// A guard nobody has seen fail is a guard nobody has any reason to believe, and
// the only way to see this one fail is to hand it a framing rule that is
// genuinely wrong rather than to edit an expectation. Each of the four below
// takes the thing it judges as an argument.

/** Does every framing this rule produces stay under the absolute ceiling? */
function ceilingHolds(frame_, windows = WINDOWS) {
  for (const w of windows) {
    for (const f of FRAMED) {
      const frame = frame_(f, w.width, w.height, w.ratio);
      if (bufferPixels(frame, w.ratio, 1) > PIXEL_CEILING) return false;
    }
  }
  return true;
}

/** Does the bench ever answer with less than the floor? */
function floorHolds(decide) {
  // From a machine that draws the reference window in four milliseconds to one
  // that takes a quarter of a second over it.
  for (const ms of [4, 9, 13, 18, 25, 40, 80, 160, 250]) {
    const out = decide({ medianMs: ms, source: 'gpu' },
      { width: 1892, height: 845, ratio: 1, benchPixels: 1154544 });
    if (!out || out.fraction < FRACTION_FLOOR) return false;
  }
  return true;
}

/** The body of a named function or method, whatever it is declared as. */
function bodyOf(source, name) {
  const at = source.search(new RegExp(`(function\\s+)?\\b${name}\\s*\\(`));
  if (at === -1) return null;
  const open = source.indexOf('{', source.indexOf(')', at));
  return open === -1 ? null : braceBody(source, open);
}

/**
 * Is the framing written anywhere in the governor?
 *
 * THE RULE IS NAMED BY THE SEATS IT FORBIDS, not by the one it allows, because
 * that is the sentence this guard actually means: the size of the picture is
 * decided once, by the bench, and the governor moves the scale, the grass and
 * the halo INSIDE it for the rest of the visit. Every name below is a place
 * where a tier changes — the two halves of applying one, the settle that
 * announces it, the frame of evidence that drops it, and the walker's own menu
 * — and not one of them may assign the framing.
 */
const GOVERNOR_SEATS = ['applySoft', 'applyHard', 'settle', 'sample', 'setChoice'];

function tierNeverMovesIt(source) {
  let seen = 0;
  for (const seat of GOVERNOR_SEATS) {
    const body = bodyOf(source, seat);
    if (body === null) continue;
    seen += 1;
    if (/\bfraction\s*=(?!=)/.test(body)) return false;
  }
  // And the rule is worthless if the seats were renamed out from under it: a
  // predicate that found none of them would pass anything at all.
  return seen === GOVERNOR_SEATS.length;
}

/** Is the night taken away wherever the picture is the whole window? */
function nightOnlyWhenFramed(source) {
  const at = source.indexOf('function applyNight(');
  if (at === -1) return false;
  const body = source.slice(at, source.indexOf('\n}', at));
  // It must refuse on a whole window BEFORE it builds anything, and what it
  // does on refusing must be to take down whatever is up.
  const refuses = /if\s*\(\s*!framed[\s\S]{0,80}?\)\s*\{[\s\S]{0,200}?dispose\(\)/.test(body);
  const builds = body.indexOf('createNight');
  return refuses && builds > body.indexOf('!framed');
}

// ===========================================================================
// A. LA GEOMETRIA

report.line('');
report.line('A. LA GEOMETRIA — la frazione, i due tetti, il pavimento');
report.line('');
report.line('   finestra            f=1 intatta   tetto 16:9   tetto ai pixel   Mpx max');

let geometryOk = true;
for (const w of WINDOWS) {
  const whole = frameOf(1, w.width, w.height, w.ratio);
  const untouched = whole.width === w.width && whole.height === w.height && whole.framed === false;

  let aspectOk = true;
  let ceilingOk = true;
  let fractionOk = true;
  let worst = 0;
  for (const f of FRAMED) {
    const frame = frameOf(f, w.width, w.height, w.ratio);
    const pixels = bufferPixels(frame, w.ratio, 1);
    worst = Math.max(worst, pixels);
    if (pixels > PIXEL_CEILING) ceilingOk = false;
    // A hundredth of slack: the sides are whole pixels and 16/9 of an integer
    // is not one.
    if (frame.width / frame.height > ASPECT_CEILING + 0.01) aspectOk = false;
    // AND WHERE NEITHER CEILING BIT, THE FRACTION IS THE FRACTION. Half a pixel
    // of slack for the rounding of the side, which is where the only error is.
    if (frame.held === 'frazione' && Math.abs(frame.height - w.height * f) > 0.5) fractionOk = false;
  }
  if (!untouched || !aspectOk || !ceilingOk || !fractionOk) geometryOk = false;
  report.line(`   ${w.name}   ${untouched ? 'ok        ' : 'NO        '}   `
    + `${aspectOk ? 'ok        ' : 'NO        '}   ${ceilingOk ? 'ok            ' : 'NO            '}   `
    + `${(worst / 1e6).toFixed(3)}${fractionOk ? '' : '   FRAZIONE NO'}`);
}
report.line('');
report.check(geometryOk, 'ogni finestra: f=1 e\' la finestra intera, e sotto l\'uno i due tetti tengono');
report.check(ceilingHolds(frameOf), `nessuna inquadratura passa ${PIXEL_CEILING.toLocaleString('it-IT')} pixel di buffer`);

// THE ONE WINDOW THAT MUST NOT MOVE AT ALL, which is the property every number
// already measured in this repository stands on.
const reference = frameOf(1, 1892, 845, 1);
report.check(
  reference.width === 1892 && reference.height === 845
    && bufferPixels(reference, 1, 1) <= PIXEL_CEILING,
  'la finestra di riferimento a inquadratura piena non e\' toccata da nessun tetto',
  `${bufferPixels(reference, 1, 1).toLocaleString('it-IT')} px contro un tetto di ${PIXEL_CEILING.toLocaleString('it-IT')}`,
);

// LA FRAZIONE TENUTA AL RIDIMENSIONAMENTO. Not the pixels: a walker who drags
// the window wider gets a wider picture in the same proportion of glass.
const HELD = [[1892, 845], [1600, 900], [1200, 800], [900, 900], [1400, 700]];
let heldOk = true;
const heldSays = [];
for (const f of [0.9, 0.8, 0.7, 0.6]) {
  for (const [w, h] of HELD) {
    const frame = frameOf(f, w, h, 1);
    if (frame.held === 'pixel') continue;
    if (Math.abs(frame.fraction - f) > 1.5 / h) { heldOk = false; heldSays.push(`f=${f} su ${w}x${h} -> ${frame.fraction.toFixed(4)}`); }
  }
}
report.check(heldOk, 'la frazione e\' tenuta al ridimensionamento, non i pixel', heldSays.join(', '));

// ===========================================================================
// B. LA MANIGLIA

report.line('');
report.line('B. LA MANIGLIA `?inquadratura=`');
report.check(askedFraction('') === null && askedFraction('?dev') === null,
  'senza maniglia non decide niente');
report.check(askedFraction('?inquadratura=1') === 1,
  '?inquadratura=1 e\' l\'uno esatto, che e\' la porta di ogni lastra e di ogni guardia');
report.check(askedFraction('?inquadratura=0.7') === 0.7, '?inquadratura=0.7 passa');
report.check(askedFraction('?inquadratura=0.2') === FRACTION_FLOOR
  && askedFraction('?inquadratura=3') === 1,
  `fuori scala si stringe fra ${FRACTION_FLOOR} e 1`);
report.check(askedFraction('?inquadratura=poco') === null, 'un valore che non e\' un numero non decide niente');

// ===========================================================================
// C. IL MODELLO E LA POLITICA DEL BANCO

report.line('');
report.line('C. IL BANCO — il modello misurato, la politica, il pavimento');
report.line('');
report.line(`   costo = ${MODEL.fixedMs} ms + ${MODEL.msPerMegapixel} ms per megapixel`);
report.line('   (misurato sulla macchina di riferimento al tier medio, posa d\'arrivo,');
report.line('    stadi spenti, tre giri: vedi la nota sopra MODEL)');
report.line('');
report.line('   il banco legge   ->   f      tier      previsto   perche\'');

const LADDER = [4, 8, 11, 15, 17.5, 22, 30, 45, 90];
let monotone = true;
let previous = 1.01;
for (const ms of LADDER) {
  const out = decideFraming({ medianMs: ms, source: 'gpu' },
    { width: 1892, height: 845, ratio: 1, benchPixels: 1154544 });
  if (out.fraction > previous) monotone = false;
  previous = out.fraction;
  report.line(`   ${String(ms).padStart(6)} ms        ->   ${String(out.fraction).padEnd(6)} ${out.tier.padEnd(9)} `
    + `${out.predictedMs.toFixed(2).padStart(6)}     ${out.reason}`);
}
report.line('');
report.check(monotone, 'una macchina piu\' lenta non riceve mai un\'inquadratura piu\' grande');
report.check(floorHolds(decideFraming),
  `il banco non scende mai sotto il pavimento di ${FRACTION_FLOOR}`);

// IL TETTO BATTE LA SCALA, e questo e' il posto in cui un 4K viene contenuto:
// la macchina piu' veloce immaginabile chiede l'uno, e su un pannello grande
// l'uno non e' un gradino che questo banco puo' rispondere.
let bigOk = true;
const bigSays = [];
for (const w of WINDOWS) {
  const out = decideFraming({ medianMs: 0.5, source: 'gpu' },
    { width: w.width, height: w.height, ratio: w.ratio, benchPixels: 1154544 });
  const pixels = bufferPixels(out.frame, w.ratio, 1);
  if (pixels > PIXEL_CEILING) { bigOk = false; bigSays.push(`${w.name.trim()} -> ${pixels}`); }
}
report.check(bigOk,
  'nemmeno la macchina piu\' veloce riceve un\'inquadratura sopra il tetto ai pixel',
  bigSays.join(', '));

// E IL RAMO SENZA OROLOGIO, che e' il portatile del committente (E-LINUX1):
// la lettura e' un INTERVALLO e non dei millisecondi, e il rapporto di due
// valori del modello e' adimensionale, quindi la stessa aritmetica risponde.
const lag = decideFraming(
  { medianMs: 42.5, source: 'interval', intervalMs: 16.7 },
  { width: 1892, height: 845, ratio: 1, benchPixels: 1154544 },
);
report.check(lag !== null && lag.fraction >= FRACTION_FLOOR && lag.fraction < 1,
  'il ramo senza orologio del driver decide un\'inquadratura e non si rompe',
  lag ? `f ${lag.fraction}, tier ${lag.tier}, ${lag.predictedMs.toFixed(1)} ms previsti su 16,7 di intervallo` : 'niente');

// E IL MODELLO E' UN RAPPORTO: la stessa macchina, letta a due inquadrature
// diverse, deve prevedere lo stesso costo per una terza.
const viaWhole = predictMs(17.82, 1154544, 450000);
const viaSmall = predictMs(7.96, 449982, 450000);
report.check(Math.abs(viaWhole - viaSmall) < 0.35,
  'il modello e\' un rapporto: due letture della stessa macchina prevedono lo stesso costo',
  `${viaWhole.toFixed(2)} contro ${viaSmall.toFixed(2)} ms`);

// ===========================================================================
// D. QUEL CHE LA SORGENTE DEVE DIRE

const quality = read('src/core/quality.js');
const main = read('src/main.js');
const intro = read('src/ui/intro.js');
const notte = read('src/ui/notte.js');
const quadro = read('tools/guards/lib/quadro.mjs');

report.line('');
report.line('D. LA SORGENTE — il deposito, il governatore, la scena, il quadro');

report.check(tierNeverMovesIt(quality),
  'in src/core/quality.js l\'inquadratura e\' scritta SOLO da setBenchmark, mai dal governatore');
report.check(/inquadratura:\s*fraction/.test(quality) && /notte,/.test(quality),
  'il deposito porta l\'inquadratura e la notte accanto al tier');
report.check(/const STORAGE_VERSION = 2;/.test(quality) && /stored\.v !== STORAGE_VERSION/.test(quality),
  'il deposito e\' numerato: `pixels` ha cambiato significato e un record vecchio non vale');
report.check(/needsBenchmark\(windowPixels\(\)\)/.test(main),
  'PIXEL_TOLERANCE e\' riletta contro i pixel della FINESTRA e non del buffer');
report.check(nightOnlyWhenFramed(main),
  'a inquadratura piena la notte non e\' montata, e quella che c\'era viene tolta');

// LA SCENA D'APERTURA NON E' CAMBIATA, e il modo di dirlo in una guardia e' che
// non ne esiste una SECONDA COPIA: ogni manopola del cielo sta in notte.js e
// src/ui/intro.js la importa invece di ridichiararla. Due copie non restano
// uguali oltre il primo che ne gira una.
const KNOBS = ['POLE_Y', 'TRAILS', 'TRAIL_PEAK_ALPHA', 'TRAIL_FLOOR_ALPHA', 'SPIN_MS',
  'DUST', 'CAP_PX', 'SPARK_KEEP_OUT', 'RHO_FULL_IN', 'ARC_MIN_DEG'];
const redeclared = KNOBS.filter((k) => new RegExp(`^\\s*const ${k}\\s*=`, 'm').test(intro));
report.check(redeclared.length === 0,
  'la scena d\'apertura non ridichiara nessuna manopola del cielo',
  redeclared.length ? `ancora in intro.js: ${redeclared.join(', ')}` : '');
report.check(KNOBS.every((k) => new RegExp(`^export const ${k}\\s*=`, 'm').test(notte)),
  'e src/ui/notte.js le dichiara tutte, una volta sola');
report.check(/from '\.\/notte\.js'/.test(intro) && /NOTTE_paintField\(field, geom\)/.test(intro),
  'la scena disegna il cielo attraverso notte.js');

// IL QUADRO FOTOGRAFA IL MONDO E NON LA DECISIONE DEL BANCO.
report.check(/\?dev&t0&intro=0&inquadratura=1/.test(quadro),
  'openWorld inchioda ?inquadratura=1: le guardie fotografano il mondo, non un verdetto');

// ===========================================================================

// ===========================================================================
// E. LA PAGINA — che l'aritmetica ci arrivi davvero
//
// Tutto quel che sta sopra e' aritmetica e sorgente, e l'aritmetica giusta che
// non raggiunge la tela e' il difetto che E-LUCE5 ha spedito con trentasette
// guardie verdi. Questa gamba apre il mondo due volte e guarda: a inquadratura
// piena non ci dev'essere nulla di nuovo sulla pagina, e sotto l'uno la tela
// dev'essere il rettangolo che frameOf() ha calcolato, centrato, con la notte
// DIETRO e l'obiettivo che ne ha preso la forma.

if (!process.argv.includes('--self')) {
  const { serveRepo, toolsPresent } = await import('./lib/quadro.mjs');
  const { chromium, missing } = toolsPresent();
  if (missing.length) {
    report.line('');
    report.note(`la gamba della pagina non e' stata corsa: manca ${missing.join(', ')}`);
  } else {
    report.line('');
    report.line("E. LA PAGINA - la tela, l'obiettivo, la notte");
    const server = await serveRepo();
    const browser = await chromium.launch({
      headless: true,
      args: ['--use-angle=d3d11', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'],
    });
    const WIN = { width: 1892, height: 845 };
    const look = async (fraction, stored = null) => {
      const page = await browser.newPage({ viewport: WIN, deviceScaleFactor: 1 });
      try {
        // UN VISITATORE DI RITORNO, che e' uno STATO e non una maniglia: e'
        // esattamente quel che il deposito contiene dopo una prima visita, e
        // openVisitor in lib/quadro.mjs si regge sulla stessa idea.
        if (stored) await page.addInitScript((record) => {
          try {
            window.localStorage.setItem('farfield.quality', JSON.stringify(record));
          } catch { /* un browser che rifiuta di ricordare ri-calibra */ }
        }, stored);
        const pin = fraction === null ? '' : `&inquadratura=${fraction}`;
        await page.goto(`http://127.0.0.1:${server.port}/?dev&t0&intro=0${pin}`,
          { waitUntil: 'load' });
        await page.waitForFunction(
          () => window.farfield && window.farfield.hub && window.farfield.hub.groundReady(),
          null, { timeout: 180000, polling: 250 },
        );
        // La notte arriva per import dinamico: le si da' il tempo di atterrare,
        // o la si troverebbe assente per una ragione che non e' un difetto.
        await page.waitForTimeout(1500);
        // AWAITED, not merely returned: a `finally` runs the moment a `return`
        // is evaluated, so handing back the unawaited promise closes the page
        // out from under the very call it is waiting on.
        return await page.evaluate(() => {
          const box = document.getElementById('stage').getBoundingClientRect();
          const kids = [...document.body.children].map((c) => c.id || c.className || '');
          return {
            width: Math.round(box.width),
            height: Math.round(box.height),
            left: Math.round(box.left),
            top: Math.round(box.top),
            window: { width: window.innerWidth, height: window.innerHeight },
            aspect: window.farfield.camera.aspect,
            buffer: window.farfield.renderer.drawingBuffer(),
            framed: document.body.classList.contains('is-inquadrata'),
            nights: document.querySelectorAll('.notte').length,
            // L'ORDINE NELL'ALBERO E' L'ORDINE DI DISEGNO: entrambi sono fissi
            // e senza z-index, quindi quel che viene prima sta sotto. La notte
            // dev'essere PRIMA della tela.
            nightBeforeStage: kids.indexOf('notte') !== -1
              && kids.indexOf('notte') < kids.indexOf('stage'),
            stored: window.localStorage.getItem('farfield.quality'),
            benched: window.farfield.bench.active,
          };
        });
      } finally {
        await page.close().catch(() => {});
      }
    };

    try {
      const whole = await look(1);
      report.check(
        whole.width === whole.window.width && whole.height === whole.window.height
          && whole.left === 0 && whole.top === 0,
        "a ?inquadratura=1 la tela e' la finestra intera, all'origine",
        `${whole.width}x${whole.height} a ${whole.left},${whole.top}`,
      );
      report.check(whole.nights === 0 && whole.framed === false,
        "a ?inquadratura=1 non c'e' nessuna notte montata e nessuna classe sul corpo");

      const want = frameOf(0.7, WIN.width, WIN.height, 1);
      const small = await look(0.7);
      report.check(small.width === want.width && small.height === want.height,
        "a ?inquadratura=0.7 la tela e' il rettangolo che l'aritmetica ha calcolato",
        `voluto ${want.width}x${want.height}, trovato ${small.width}x${small.height}`);
      report.check(
        Math.abs(small.left - (WIN.width - want.width) / 2) <= 1
          && Math.abs(small.top - (WIN.height - want.height) / 2) <= 1,
        "ed e' centrata nella finestra",
        `a ${small.left},${small.top}`,
      );
      report.check(Math.abs(small.aspect - want.width / want.height) < 0.002,
        "l'obiettivo ha preso la forma dell'inquadratura e non quella della finestra",
        `${small.aspect.toFixed(4)} contro ${(want.width / want.height).toFixed(4)}`);
      report.check(small.nights === 1 && small.nightBeforeStage,
        "la notte c'e', una sola, e sta DIETRO la tela");
      report.check(
        small.buffer.width * small.buffer.height <= PIXEL_CEILING,
        'e il buffer che ne esce sta sotto il tetto ai pixel',
        `${(small.buffer.width * small.buffer.height).toLocaleString('it-IT')} px`,
      );

      // IL RICORDO. Un visitatore di ritorno non ripaga i tre secondi e non
      // vede il quadro cambiare grandezza dietro la scena: l'inquadratura che
      // il banco gli diede la volta scorsa e' quella del primo fotogramma.
      const record = {
        v: 2,
        tier: 'medio',
        choice: 'auto',
        benchMs: 17.5,
        pixels: WIN.width * WIN.height,
        inquadratura: 0.75,
        notte: 'ferma',
      };
      const remembered = frameOf(0.75, WIN.width, WIN.height, 1);
      const back = await look(null, record);
      report.check(
        back.width === remembered.width && back.height === remembered.height,
        "un visitatore di ritorno trova l'inquadratura che il deposito ricorda",
        `voluto ${remembered.width}x${remembered.height}, trovato ${back.width}x${back.height}`,
      );
      report.check(
        JSON.parse(back.stored).inquadratura === 0.75,
        "e il deposito non e' stato riscritto: il banco non ha rigirato",
      );

      // LA NOTTE NON SI RIFA' A OGNI RIDIMENSIONAMENTO, E QUESTA RIGA E' QUI
      // PERCHE' IL DIFETTO C'E' STATO.
      //
      // La notte si ricostruisce quando il verdetto del banco cambia sotto di
      // lei, il che capita una volta per visita. Ma «gira» e «le e' stato detto
      // di girare» sono due domande diverse: un visitatore che ha chiesto alla
      // propria macchina NESSUN MOVIMENTO ha un cielo fermo qualunque cosa il
      // banco abbia trovato, quindi un chiamante che confrontasse il verdetto
      // con quel che la notte FA troverebbe, per quei visitatori soli, un
      // disaccordo permanente -- e butterebbe giu' il cielo per ricostruirlo
      // identico a ogni ridimensionamento, cioe' un ciclo per pixel su un
      // milione e mezzo di pixel a ogni trascinamento del bordo.
      //
      // Si guarda dal di fuori, marchiando l'elemento e ridimensionando due
      // volte: se e' ancora marchiato, e' ancora lui.
      const reduced = await browser.newPage({
        viewport: WIN, deviceScaleFactor: 1, reducedMotion: 'reduce',
      });
      try {
        await reduced.goto(
          `http://127.0.0.1:${server.port}/?dev&t0&intro=0&inquadratura=0.7&notte=animata`,
          { waitUntil: 'load' },
        );
        await reduced.waitForSelector('.notte', { timeout: 120000 });
        await reduced.evaluate(() => { document.querySelector('.notte').dataset.visto = '1'; });
        for (const [w, h] of [[1600, 900], [1400, 800], [1892, 845]]) {
          // eslint-disable-next-line no-await-in-loop
          await reduced.setViewportSize({ width: w, height: h });
          // eslint-disable-next-line no-await-in-loop
          await reduced.waitForTimeout(500);
        }
        const survived = await reduced.evaluate(() => {
          const n = document.querySelector('.notte');
          return {
            same: !!n && n.dataset.visto === '1',
            count: document.querySelectorAll('.notte').length,
          };
        });
        report.check(survived.same && survived.count === 1,
          'con «nessun movimento» chiesto alla macchina, la notte non si rifa\' a ogni ridimensionamento',
          survived.same ? `${survived.count} elemento` : 'e\' stata ricostruita');
      } finally {
        await reduced.close().catch(() => {});
      }
    } finally {
      await browser.close().catch(() => {});
      await server.stop();
    }
  }
}

if (process.argv.includes('--self')) {
  // A ceiling that does not contain a 4K: the same geometry with the absolute
  // ceiling five times too high, which is exactly the defect "il tetto non
  // contiene un 4K".
  const looseFrame = (f, w, h, r) => {
    const out = frameOf(f, w, h, r);
    if (out.held !== 'pixel') return out;
    // Undo the pixel ceiling: the framing the fraction asked for, ceiling free.
    const height = h * f;
    const width = Math.min(w * f, height * ASPECT_CEILING);
    return {
      width: Math.round(width), height: Math.round(height), fraction: f, framed: true, held: 'frazione',
    };
  };
  // A bench that spends the floor: a machine slow enough and it keeps shrinking.
  const sinkingFloor = (verdict, where) => {
    const out = decideFraming(verdict, where);
    if (!out) return out;
    return verdict.medianMs > 60 ? { ...out, fraction: 0.4 } : out;
  };
  // The defect in the seat it would really be written in: a governor that
  // shrinks the picture the moment the frame runs hot, which is precisely the
  // thing a walker would see happen under them.
  const governorWrites = quality.replace(
    '      hot = gpuMs > CEILING_MS ? hot + 1 : 0;',
    '      fraction = 0.8;\n      hot = gpuMs > CEILING_MS ? hot + 1 : 0;',
  );
  const nightAlways = main.replace(
    /function applyNight\(framed\) \{\n  if \(!framed[\s\S]*?\n  \}\n/,
    'function applyNight(framed) {\n',
  );

  selfTest('inquadratura', [
    {
      what: 'un tetto ai pixel che non contiene un 4K',
      caught: !ceilingHolds(looseFrame),
    },
    {
      what: 'un pavimento sfondato: il banco che risponde 0,4 a una macchina lenta',
      caught: !floorHolds(sinkingFloor),
    },
    {
      what: 'un\'inquadratura che cambia col tier: il governatore che la riscrive',
      caught: !tierNeverMovesIt(governorWrites),
    },
    {
      what: 'la notte montata anche a inquadratura piena',
      caught: !nightOnlyWhenFramed(nightAlways),
    },
    {
      what: 'la guardia riconosce comunque la sorgente buona',
      caught: ceilingHolds(frameOf) && floorHolds(decideFraming)
        && tierNeverMovesIt(quality) && nightOnlyWhenFramed(main),
    },
  ]);
}

report.line('');
report.line(`   la finestra di riferimento vale ${windowPixels(1892, 845, 1).toLocaleString('it-IT')} pixel; `
  + `il tetto e\' ${PIXEL_CEILING.toLocaleString('it-IT')}`);
report.end();
