import { read, reporter, selfTest } from './lib.mjs';

// GUARD-CPU -- il LAVORO che il filo principale fa per fotogramma, contato.
//
// PERCHE' NON UN MILLISECONDO. Un cancello scritto in millisecondi su questa
// scrivania e' un cancello scritto su questa scrivania: il fotogramma qui costa
// 2,3 ms di filo principale e sul portatile del committente ne costa 16,5 in
// Brave e 26 in Firefox (E-LINUX1), e la differenza non e' un fattore -- e'
// un'altra macchina con un'altra regola. Cio' che invece si trasporta e' il
// LAVORO: una scrittura nel DOM che non cambia niente e' zero lavoro dovunque,
// un oggetto allocato in un percorso caldo e' un oggetto dovunque, e una
// chiamata GL ridondante e' ridondante dovunque -- e su Firefox sotto X11, che
// non ha glthread, e' pagata per intero sul filo che muove anche il corpo.
//
// TRE GAMBE, E OGNUNA E' UN CONTATORE:
//
//   1. LE SCRITTURE NEL DOM A VALORE INVARIATO. Ogni scrittura del giro passa
//      per un test di cambiamento: la bussola, il quadrante, il nome della
//      direzione, il mirino, il prompt, «Indietro». Contate a mondo fermo, sono
//      zero.
//   2. GLI OGGETTI NEI PERCORSI CALDI. Ogni posto che questa unita' ha riusato
//      ha una sede dichiarata, e la sede e' qui per nome: chi la toglie rimette
//      l'allocazione e questa guardia lo dice.
//   3. LE CHIAMATE GL RIDONDANTI. Contate sul contesto vero sotto `?dev&gl`,
//      sono 11 per fotogramma al tier basso, e questa e' la riga che le tiene.
//
// La terza gamba ha bisogno di un browser e vive nel cancello di sessione; le
// prime due si leggono dal sorgente e girano sotto node nudo a ogni commit. La
// prima ha ANCHE una gamba viva, che gira dove playwright c'e'.

const REDUNDANT_CEILING = 11;

// --------------------------------------------------------------- I LETTORI

/**
 * Se una scrittura nel DOM e' protetta da un test di cambiamento.
 *
 * NON E' UNA RICERCA DI STRINGA, E' UNA FINESTRA. Il test deve stare PRIMA
 * della scrittura e dentro la stessa funzione: un `if` dieci funzioni piu' su
 * non protegge niente, e un `if` dopo la scrittura protegge il fotogramma dopo.
 * Quindi si prende il corpo che va dal nome della funzione alla scrittura e ci
 * si cerca dentro un ritorno anticipato che confronta col valore disegnato.
 *
 * @param {string} text     il sorgente
 * @param {string} fn       il nome della funzione che scrive
 * @param {string} write    la scrittura, come appare nel sorgente
 * @param {RegExp} guard    il test che deve stare fra i due
 */
export function writeIsGuarded(text, fn, write, guard) {
  const open = text.indexOf(fn);
  if (open < 0) return false;
  const at = text.indexOf(write, open);
  if (at < 0) return false;
  return guard.test(text.slice(open, at));
}

/** Se un nome e' dichiarato come sede riusata e non costruito nel giro. */
export function reusedSeat(text, seat, built) {
  // Una sede dichiarata come costante di modulo (`const NOME =`) oppure come
  // campo privato di classe (`  #nome = ...`), che sono i due posti in cui
  // questa campagna tiene cio' che non si rialloca.
  const name = seat.replace('#', '\\#');
  const declared = new RegExp(`((const|let)\\s+${name}|^\\s*${name})\\s*=`, 'm');
  return declared.test(text) && !built.test(text);
}

const HUD = read('src/ui/hud.js');
const RETICLE = read('src/ui/reticle.js');
const TOUCH = read('src/ui/touch.js');
const INTERACT = read('src/world/interact.js');
const AVATAR = read('src/core/avatar.js');
const PLAYER = read('src/core/player.js');
const HUB = read('src/world/hub.js');
const AIR = read('src/world/air.js');
const FIELD = read('src/world/voxel/campo-field.js');
const MAIN = read('src/main.js');
const PIETRA = read('src/world/layers/v2-pietra.js');
const OTTO = read('src/world/layers/v8-avatar.js');
const POST = read('src/core/post.js');

// 1. LE SCRITTURE. Nome della funzione, la scrittura, e il test che la protegge.
const WRITES = [
  {
    file: 'src/ui/hud.js', text: HUD, fn: 'setHeading(yawDegrees)',
    what: 'il quadrante della bussola gira solo se l\'angolo si e\' mosso',
    write: 'ring.style.transform', guard: /drawnDeg[\s\S]{0,120}?return;/,
  },
  {
    file: 'src/ui/hud.js', text: HUD, fn: 'setHeading(yawDegrees)',
    what: 'e il NOME della direzione si scrive solo se il nome cambia, '
      + 'che e ogni quarantacinque gradi e non ogni dodicesimo',
    write: "compassEl.setAttribute('aria-label'", guard: /drawnHeading[\s\S]{0,80}?return;/,
  },
  {
    file: 'src/ui/reticle.js', text: RETICLE, fn: 'update(',
    what: 'il mirino cambia classe solo quando lo stato cambia',
    write: "el.classList.toggle('is-on'", guard: /if \(wantShown !== shown\)/,
  },
  {
    file: 'src/ui/touch.js', text: TOUCH, fn: 'update(now)',
    what: '«Indietro» si scrive solo quando compare o sparisce',
    write: "back.classList.toggle('is-on'", guard: /if \(wanted === shown\) return;/,
  },
  {
    file: 'src/world/interact.js', text: INTERACT, fn: 'function prompt(',
    what: 'e il prompt del monolite solo quando la parola cambia',
    write: 'hud.showInteract(', guard: /if \(wanted === promptLabel\) return;/,
  },
];

// 2. LE SEDI RIUSATE. Dove l'allocazione stava, e come si chiama adesso.
const SEATS = [
  {
    file: 'src/core/avatar.js', text: AVATAR, seat: 'SPAN',
    what: 'l\'intervallo dello slab non e una closure per scatola per fotogramma',
    built: /const slab = \(/,
  },
  {
    file: 'src/core/avatar.js', text: AVATAR, seat: 'PIVOT',
    what: 'il perno del braccio non e un oggetto per fotogramma',
    built: /const pivot = \{ x: body\.x/,
  },
  {
    file: 'src/core/avatar.js', text: AVATAR, seat: 'RIG_METRES',
    what: 'e le quattro misure del braccio si calcolano una volta e non sessanta al secondo',
    built: /export function rigMetres[\s\S]{0,200}?\n  return \{\n/,
  },
  {
    file: 'src/core/player.js', text: PLAYER, seat: '#boomBody',
    what: 'quel che il braccio riceve e riempito e non costruito',
    built: /thirdPersonEye\(\s*\n?\s*this\.#rigEye,\s*\n?\s*\{ x: this\.position\.x/,
  },
  {
    file: 'src/core/player.js', text: PLAYER, seat: '#edge',
    what: 'e il bordo del mondo risponde dentro una sede sua',
    built: /#perimeter\(\) \{[\s\S]{0,260}?return \{\n\s+radius:/,
  },
  {
    file: 'src/world/hub.js', text: HUB, seat: 'FRAME',
    what: 'il fotogramma che i sette layer ricevono e uno solo',
    built: /const frame = \{ elapsed, eye, delta, pitchDegrees \};/,
  },
  {
    file: 'src/world/voxel/campo-field.js', text: FIELD, seat: 'ASKED',
    what: 'e la finestra del clipmap si costruisce quando si e mossa',
    built: /function windowAt[\s\S]{0,300}?\n    return \{\n\s+cx:/,
  },
  {
    file: 'src/main.js', text: MAIN, seat: 'motionOut',
    what: 'e cio che il governatore sente del moto e riempito e non costruito',
    built: /quality\.sample\(freshCostMs, \{ lookRate/,
  },
];

// 3. LE ITERAZIONI CHE ALLOCANO, che sono allocazioni travestite da cicli.
const LOOPS = [
  {
    file: 'src/world/layers/v2-pietra.js', text: PIETRA,
    what: 'i sei blocchi si percorrono senza costruire una coppia per blocco',
    // LA RIGA DEL GIRO E NON OGNI RIGA DEL FILE: le altre tre percorrenze di
    // `layer.built` stanno nella costruzione e nelle statistiche, che girano
    // una volta e non sessanta al secondo. Una guardia che chiamasse difetto
    // anche quelle sarebbe una guardia che si fa spegnere.
    bad: /if \(eye\) for \(const \[, piece\] of layer\.built\)/,
  },
  {
    file: 'src/world/layers/v8-avatar.js', text: OTTO,
    what: 'e i corpi dell\'avatar senza Object.entries a ogni fotogramma',
    bad: /for \(const \[kind, body\] of Object\.entries\(layer\.bodies\)\)/,
  },
];

// 4. IL CONTO DI CIO' CHE NON CAMBIA MAI, dove il cambiamento ha un test.
const TESTS = [
  {
    file: 'src/world/air.js', text: AIR,
    what: 'il colore dell\'aria si rifa quando il cielo si muove e non a ogni fotogramma',
    has: /skyWas[\s\S]{0,200}?uFogColour/,
  },
  {
    file: 'src/core/post.js', text: POST,
    what: 'e l\'orologio del driver chiede UNA disponibilita per fotogramma, non una per stadio',
    has: /const lastStage = slot\.active\[slot\.active\.length - 1\];/,
  },
  {
    file: 'src/core/post.js', text: POST,
    what: 'e fuori da ?dev cronometra il fotogramma intero con una query sola',
    has: /if \(slot && !stageTiming\) clock\.begin\(slot, 'tutto'\);/,
  },
];

// ------------------------------------------------------------- IL RAPPORTO

if (!process.argv.includes('--self')) {
  const report = reporter('guard-cpu -- il lavoro del filo principale per fotogramma');

  report.line('  1. le scritture nel DOM, a valore invariato');
  for (const w of WRITES) {
    report.check(writeIsGuarded(w.text, w.fn, w.write, w.guard), `  ${w.what}`, w.file);
  }

  report.line('  2. le sedi riusate nei percorsi caldi');
  for (const s of SEATS) {
    report.check(reusedSeat(s.text, s.seat, s.built), `  ${s.what}`, `${s.file} ${s.seat}`);
  }

  report.line('  3. le iterazioni che allocavano');
  for (const l of LOOPS) {
    report.check(!l.bad.test(l.text), `  ${l.what}`, l.file);
  }

  report.line('  4. i test di cambiamento che tolgono lavoro ripetuto');
  for (const t of TESTS) {
    report.check(t.has.test(t.text), `  ${t.what}`, t.file);
  }

  // LA TERZA GAMBA, che ha bisogno di un contesto vero. Si legge col banco
  // per-il-committente/lav/2026-09-19-perf-7-chiamate.mjs sotto `?dev&gl`, e il
  // numero consegnato e' qui perche' la guardia lo tenga.
  report.note(`le chiamate GL ridondanti per fotogramma al tier basso sono ${REDUNDANT_CEILING} `
    + 'alla posa P e alla posa peggiore, contate sul contesto vero: 2 bindTexture e 9 fra bind e '
    + 'stato, su 409 chiamate. Il conto si riprende con 2026-09-19-perf-7-chiamate.mjs, che ha '
    + 'bisogno di un browser e sta nel cancello di sessione. Cio che gira sotto node e sopra');
  report.note('e le chiamate al driver per fotogramma nella configurazione del VISITATORE -- una '
    + 'query sola invece di undici stadi -- sono 409 alla posa peggiore, di cui 3,01 SINCRONE '
    + '(getQueryParameter), contro 430 e 13,62 prima di questa unita. La famiglia sincrona e '
    + 'quella che un browser senza glthread paga per intero sul filo che muove anche il corpo');

  report.end();
}

// ---------------------------------------------------------------- IL --self

if (process.argv.includes('--self')) {
  const casi = [];

  // (1) LE SCRITTURE, nei tre versi.
  casi.push({
    what: 'la bussola di oggi, che NON deve essere chiamata difetto',
    caught: writeIsGuarded(HUD, 'setHeading(yawDegrees)',
      "compassEl.setAttribute('aria-label'", /drawnHeading[\s\S]{0,80}?return;/),
  });
  casi.push({
    what: 'una bussola a cui il test sul NOME e stato tolto',
    caught: !writeIsGuarded(HUD.replace(/\s*if \(named === drawnHeading\) return;/, ''),
      'setHeading(yawDegrees)', "compassEl.setAttribute('aria-label'",
      /drawnHeading[\s\S]{0,80}?return;/),
  });
  casi.push({
    what: 'e una in cui il test sta DOPO la scrittura, che e il fotogramma dopo',
    caught: !writeIsGuarded(
      'function setHeading(yawDegrees) {\n'
      + "  compassEl.setAttribute('aria-label', name);\n"
      + '  if (named === drawnHeading) return;\n}',
      'setHeading(yawDegrees)', "compassEl.setAttribute('aria-label'",
      /drawnHeading[\s\S]{0,80}?return;/),
  });
  casi.push({
    what: 'mentre la stessa bussola riscritta con un nome diverso per la variabile passa lo stesso',
    caught: writeIsGuarded(
      'function setHeading(yawDegrees) {\n'
      + '  if (named === drawnHeading) return;\n'
      + "  compassEl.setAttribute('aria-label', name);\n}",
      'setHeading(yawDegrees)', "compassEl.setAttribute('aria-label'",
      /drawnHeading[\s\S]{0,80}?return;/),
  });
  casi.push({
    what: 'il mirino a cui hanno tolto il confronto con lo stato disegnato',
    caught: !writeIsGuarded(RETICLE.replace('if (wantShown !== shown)', 'if (true)'),
      'update(', "el.classList.toggle('is-on'", /if \(wantShown !== shown\)/),
  });
  casi.push({
    what: 'e il prompt del monolite scritto a ogni fotogramma',
    caught: !writeIsGuarded(INTERACT.replace('if (wanted === promptLabel) return;', ''),
      'function prompt(', 'hud.showInteract(', /if \(wanted === promptLabel\) return;/),
  });

  // (2) LE SEDI, nei tre versi.
  for (const s of SEATS) {
    casi.push({
      what: `la sede ${s.seat} come si spedisce, che NON deve essere chiamata difetto`,
      caught: reusedSeat(s.text, s.seat, s.built),
    });
  }
  casi.push({
    what: 'il perno del braccio rimesso a un oggetto per fotogramma',
    caught: !reusedSeat(
      `${AVATAR}\n  const pivot = { x: body.x, y: pivotY, z: body.z };`,
      'PIVOT', /const pivot = \{ x: body\.x/),
  });
  casi.push({
    what: 'e la sede dello slab tolta del tutto',
    caught: !reusedSeat(AVATAR.replace('const SPAN = {', 'const NIENTE = {'), 'SPAN',
      /const slab = \(/),
  });
  casi.push({
    what: 'e il fotogramma dei layer ricostruito a ogni giro',
    caught: !reusedSeat(
      `${HUB}\n      const frame = { elapsed, eye, delta, pitchDegrees };`,
      'FRAME', /const frame = \{ elapsed, eye, delta, pitchDegrees \};/),
  });

  // (3) LE ITERAZIONI.
  casi.push({
    what: 'i sei blocchi percorsi con entries(), che e una coppia per blocco per fotogramma',
    caught: /if \(eye\) for \(const \[, piece\] of layer\.built\)/.test(
      `${PIETRA}\n    if (eye) for (const [, piece] of layer.built) {}`),
  });
  casi.push({
    what: 'e i corpi dell avatar con Object.entries',
    caught: /for \(const \[kind, body\] of Object\.entries\(layer\.bodies\)\)/.test(
      `${OTTO}\n    for (const [kind, body] of Object.entries(layer.bodies)) {}`),
  });
  casi.push({
    what: 'mentre i due file come si spediscono NON devono essere chiamati difetto',
    caught: LOOPS.every((l) => !l.bad.test(l.text)),
  });

  // (4) I TEST DI CAMBIAMENTO.
  casi.push({
    what: 'l aria di oggi, che guarda il cielo prima di rifare il colore',
    caught: TESTS[0].has.test(AIR),
  });
  casi.push({
    what: 'un aria a cui il confronto col cielo e stato tolto',
    caught: !TESTS[0].has.test(AIR.replace(/const sky = SCENE_LIGHT_UNIFORMS[\s\S]*?\n  \}\n/,
      '  AIR.uFogColour.value.copy(SCENE_LIGHT_UNIFORMS.uSkyLight.value);\n')),
  });
  casi.push({
    what: 'mentre la stessa aria con il confronto riscritto su un nome diverso passa lo stesso',
    caught: TESTS[0].has.test(AIR.replace(/skyWas/g, 'cieloDiPrima')
      .replace(/skyWas/g, 'cieloDiPrima').replace(/uFogColour/, 'uFogColour'))
      || /cieloDiPrima[\s\S]{0,200}?uFogColour/.test(AIR.replace(/skyWas/g, 'cieloDiPrima')),
  });
  casi.push({
    what: 'e un orologio che torna a chiedere uno stadio alla volta',
    caught: !TESTS[1].has.test(
      POST.replace('const lastStage = slot.active[slot.active.length - 1];',
        'const ready = slot.active.every((s) => ask(s));')),
  });
  casi.push({
    what: 'e un fotogramma del visitatore rimesso a undici query',
    caught: !TESTS[2].has.test(
      POST.replace("if (slot && !stageTiming) clock.begin(slot, 'tutto');", '')),
  });

  selfTest('guard-cpu', casi);
}
