import { read, reporter, selfTest } from './lib.mjs';

// GUARD-MEMORIA -- IL SUOLO SI RICORDA DI SE', E SOLO DI SE'.
//
//   node tools/guards/guard-memoria.mjs
//   node tools/guards/guard-memoria.mjs --self
//
// ===========================================================================
// PERCHE' ESISTE, E CHE COSA NON PUO' PERMETTERSI.
//
// Il campo marcia UN RAGGIO PER TEXEL di un bersaglio che sta a una frazione
// di lato, quindi ogni spigolo di cubo cade su un gradino largo uno-tre pixel;
// e il corpo respira sempre, di nove millesimi di texel per fotogramma al tier
// basso, che basta a far cambiare sponda ai texel di bordo. La cura e' la
// memoria temporale: il campo somma i propri fotogrammi precedenti,
// riproiettati dalla propria profondita', mentre il raggio si sposta di meno di
// un texel dentro il texel.
//
// Una cura del genere ha tre modi di essere peggiore del male, e sono i tre che
// questa guardia misura:
//
//   1. LA SCIA. Una fusione che accetta il passato senza chiedergli DOVE stava
//      si porta dietro il suolo che c'era prima dietro un bordo: il visitatore
//      cammina e il prato lo segue. Il cancello in metri e' cio' che lo
//      impedisce, e qui si misura su un modello di disocclusione vero.
//   2. LO SFARFALLIO. Lo scarto sub-texel SENZA la somma non e' mezzo rimedio:
//      e' lo stesso scintillio spostato di posto, un fotogramma alla volta,
//      ed e' MISURABILMENTE peggio del niente.
//   3. IL BYTE. A maniglia spenta il fotogramma dev'essere quello di oggi. Non
//      «quasi»: la stessa immagine. Un nought sommato a uno scarto e' lo stesso
//      float, un passo che non viene disegnato non sposta niente, e questa
//      guardia lo pretende sia sul modello sia sul sorgente.
//
// ===========================================================================
// COME MISURA. Il modello qui sotto e' il passo di memoria in una dimensione:
// un suolo con un bordo, una camera che scorre, la parallasse che fa muovere il
// piano vicino piu' in fretta di quello lontano, e la stessa aritmetica del
// programma -- riproiezione, cancello sulla profondita', stretta nel vicinato,
// fusione. Non e' il programma: e' la sua legge, scritta una seconda volta in
// un posto dove si puo' iniettare un difetto e guardarla fallire.

const report = reporter('guard-memoria -- il suolo si ricorda di se\', e solo di se\'');

// ---------------------------------------------------------------------------
// IL MODELLO: un suolo di 256 texel, due superfici, una camera che scorre.
// ---------------------------------------------------------------------------
const TEXELS = 256;
const NEAR_COLOUR = 210;
const FAR_COLOUR = 70;
const NEAR_DEPTH = 0.20;
const FAR_DEPTH = 0.80;
// Dove sta il bordo fra le due superfici quando la camera e' a zero, e quanto
// piu' in fretta il piano vicino scorre: e' la parallasse, ed e' cio' che apre
// una disocclusione sotto il bordo mentre la camera si muove.
const EDGE0 = 128;
const NEAR_PARALLAX = 2;
const FAR_PARALLAX = 1;

/** La grana del suolo: alta frequenza, la parte che un raggio per texel non filtra. */
function grain(x) {
  return 18 * Math.sin(x * 2.399) + 11 * Math.sin(x * 5.117 + 1.7);
}

/** Il fotogramma marciato: colore e profondita', con lo scarto sub-texel dato. */
function march(pan, jitter) {
  const colour = new Float64Array(TEXELS);
  const depth = new Float64Array(TEXELS);
  const edge = EDGE0 + NEAR_PARALLAX * pan;
  for (let i = 0; i < TEXELS; i += 1) {
    const at = i + 0.5 + jitter;
    const near = at < edge;
    const world = near ? at - NEAR_PARALLAX * pan : at - FAR_PARALLAX * pan;
    colour[i] = (near ? NEAR_COLOUR : FAR_COLOUR) + grain(world);
    depth[i] = near ? NEAR_DEPTH : FAR_DEPTH;
  }
  return { colour, depth };
}

/** Una presa bilineare, che e' come il passo legge la storia. */
function tap(buffer, x) {
  const c = Math.max(0, Math.min(TEXELS - 1.0001, x));
  const i = Math.floor(c);
  const f = c - i;
  return buffer[i] * (1 - f) + buffer[Math.min(TEXELS - 1, i + 1)] * f;
}

/**
 * IL PASSO DI MEMORIA, e ogni difetto che questa guardia sa riconoscere e' una
 * delle sue tre leve spenta.
 *
 * @param {object} how  weight, e i tre interruttori: gate, clamp, accumulate
 */
function remember(raw, past, pan, prevPan, how) {
  const { weight, gate = true, clamp = true, floorWeight = 0 } = how;
  // IL PESO CHE IL PASSO USA DAVVERO. `floorWeight` non esiste nel programma:
  // e' il difetto che la gamba --self inietta, cioe' un passo che fonde un
  // filo anche quando la maniglia dice nought, ed e' il modo piu' facile di
  // spostare il byte di un fotogramma che nessuno ha chiesto di cambiare.
  const w = Math.max(weight, floorWeight);
  const out = { colour: new Float64Array(TEXELS), depth: raw.depth };
  if (!past || w <= 0) {
    // IL NULLO, ED E' UNA COPIA E NON UN'APPROSSIMAZIONE.
    out.colour.set(raw.colour);
    return out;
  }
  for (let i = 0; i < TEXELS; i += 1) {
    const parallax = raw.depth[i] === NEAR_DEPTH ? NEAR_PARALLAX : FAR_PARALLAX;
    // Dove questo texel stava nel fotogramma prima: e' la riproiezione, e per
    // un mondo fermo la sa la profondita' da sola.
    const was = i - parallax * (pan - prevPan);
    if (was < 0 || was > TEXELS - 1) { out.colour[i] = raw.colour[i]; continue; }
    // IL CANCELLO: la storia dev'essere la STESSA superficie. Fuori, la
    // disocclusione entra e diventa una scia.
    if (gate && Math.abs(tap(past.depth, was) - raw.depth[i]) > 0.1) {
      out.colour[i] = raw.colour[i];
      continue;
    }
    let kept = tap(past.colour, was);
    if (clamp) {
      let lo = raw.colour[i];
      let hi = raw.colour[i];
      for (let k = -1; k <= 1; k += 1) {
        const n = raw.colour[Math.max(0, Math.min(TEXELS - 1, i + k))];
        lo = Math.min(lo, n); hi = Math.max(hi, n);
      }
      kept = Math.max(lo, Math.min(hi, kept));
    }
    out.colour[i] = raw.colour[i] * (1 - w) + kept * w;
  }
  return out;
}

const HALTON = Array.from({ length: 8 }, (_, k) => {
  let f = 1; let r = 0; let i = k + 1;
  while (i > 0) { f /= 2; r += f * (i % 2); i = Math.floor(i / 2); }
  return r - 0.5;
});

/**
 * Un giro di fotogrammi, e cosa se ne legge.
 *
 * @returns {object} lo scarto medio fra fotogrammi consecutivi in uscita, e
 *   l'ultimo fotogramma, per chi vuole guardare cosa ci e' rimasto dentro.
 */
function run({ frames, weight, jitter, gate = true, clamp = true, pan = () => 0 }) {
  let past = null;
  let prevPan = pan(0);
  let previous = null;
  let change = 0;
  let counted = 0;
  let last = null;
  for (let n = 0; n < frames; n += 1) {
    const p = pan(n);
    const raw = march(p, jitter ? HALTON[n % HALTON.length] : 0);
    const out = remember(raw, past, p, prevPan, { weight, gate, clamp });
    if (previous) {
      let sum = 0;
      for (let i = 0; i < TEXELS; i += 1) sum += Math.abs(out.colour[i] - previous[i]);
      change += sum / TEXELS;
      counted += 1;
    }
    previous = Float64Array.from(out.colour);
    past = { colour: previous, depth: out.depth };
    prevPan = p;
    last = { out, raw };
  }
  return { change: change / Math.max(1, counted), last };
}

// ---------------------------------------------------------------------------
// 1. IL NULLO. A peso nought l'uscita e' il fotogramma marciato, texel per
//    texel: nessuna tolleranza, nessun «quasi».
// ---------------------------------------------------------------------------
const rawOnly = march(3, 0);
const nulled = remember(rawOnly, { colour: march(0, 0).colour, depth: march(0, 0).depth },
  3, 2, { weight: 0 });
const nullExact = (out, raw) => out.colour.every((v, i) => v === raw.colour[i]);
report.check(nullExact(nulled, rawOnly),
  'a peso nought l\'uscita e\' il fotogramma marciato, texel per texel',
  `${TEXELS} texel, differenza massima ${Math.max(...nulled.colour.map((v, i) => Math.abs(v - rawOnly.colour[i])))}`);

// ---------------------------------------------------------------------------
// 2. LO SFARFALLIO. Lo scarto senza la somma e' peggio del niente; con la somma
//    e' meglio. Camera che scorre piano, come un corpo che respira.
// ---------------------------------------------------------------------------
const CREEP = (n) => n * 0.02;
const still = run({ frames: 48, weight: 0, jitter: false, pan: CREEP }).change;
const shakenOnly = run({ frames: 48, weight: 0, jitter: true, pan: CREEP }).change;
const remembered = run({ frames: 48, weight: 0.95, jitter: true, pan: CREEP }).change;

report.check(shakenOnly > still * 2,
  'lo scarto sub-texel SENZA la somma sfarfalla piu\' del suolo che non ce l\'ha',
  `${shakenOnly.toFixed(3)} contro ${still.toFixed(3)} livelli`);
report.check(remembered < shakenOnly,
  'e con la somma torna sotto: e\' la somma che compra, non lo scarto da solo',
  `${remembered.toFixed(3)} contro ${shakenOnly.toFixed(3)}`);

// ---------------------------------------------------------------------------
// 3. LA SCIA. La camera scorre e poi si ferma; il bordo ha scoperto del suolo
//    che prima non si vedeva. Dieci fotogrammi dopo l'arresto si guarda quanto
//    del piano VICINO e' rimasto appiccicato sul piano lontano -- che e'
//    esattamente cosa vuol dire «il prato mi segue».
// ---------------------------------------------------------------------------
const STOP = 24;
// A SINISTRA, ED E' L'UNICO VERSO CHE APRE UNA DISOCCLUSIONE: il piano
// vicino si RITIRA e scopre del lontano che un fotogramma fa non c'era.
const SWEEP = (n) => -Math.min(n, STOP) * 0.6;

/**
 * QUANTO DEL PASSATO E' RIMASTO ATTACCATO, e sono due domande.
 *
 * `fuori` e' quanto l'uscita esce dal vicinato di cio' che questo fotogramma ha
 * davvero marciato: e' roba che nel presente non c'e', ed e' la stretta nel
 * vicinato a doverla togliere. `deriva' e' quanto l'uscita si discosta dal
 * marciato NELLA FASCIA DEL BORDO, dove la disocclusione ha lavorato, contro
 * quanto se ne discosta LONTANO dal bordo, dove non c'e' disocclusione e la
 * differenza e' solo la somma che fa il suo mestiere. E' il rapporto fra le
 * due che dice se il cancello sta lavorando.
 */
function around(edge, lo, hi) {
  const from = Math.max(1, Math.floor(edge + lo));
  const to = Math.min(TEXELS - 1, Math.ceil(edge + hi));
  return { from, to };
}
function outside({ out, raw }, window) {
  let worst = 0;
  for (let i = window.from; i < window.to; i += 1) {
    let lo = raw.colour[i]; let hi = raw.colour[i];
    for (let k = -1; k <= 1; k += 1) {
      const n = raw.colour[Math.max(0, Math.min(TEXELS - 1, i + k))];
      lo = Math.min(lo, n); hi = Math.max(hi, n);
    }
    worst = Math.max(worst, out.colour[i] - hi, lo - out.colour[i]);
  }
  return worst;
}
function drift({ out, raw }, window) {
  let sum = 0;
  for (let i = window.from; i < window.to; i += 1) sum += Math.abs(out.colour[i] - raw.colour[i]);
  return sum / Math.max(1, window.to - window.from);
}
const EDGE_AT_STOP = EDGE0 + NEAR_PARALLAX * SWEEP(STOP);
const AT_EDGE = around(EDGE_AT_STOP, 2, 26);
const AWAY = around(EDGE_AT_STOP, 60, 90);

const gated = run({ frames: STOP + 3, weight: 0.95, jitter: false, pan: SWEEP });
const ungated = run({ frames: STOP + 3, weight: 0.95, jitter: false, gate: false, pan: SWEEP });
const unclamped = run({
  frames: STOP + 3, weight: 0.95, jitter: false, gate: false, clamp: false, pan: SWEEP,
});
// E le due meta' da sole, perche' «due cinture» e' una risposta e «una cintura
// che non si sa quale sia» non lo e'.
const gateOnly = run({
  frames: STOP + 3, weight: 0.95, jitter: false, gate: true, clamp: false, pan: SWEEP,
});

report.line(`        fascia del bordo  fuori ${outside(gated.last, AT_EDGE).toFixed(2)} / `
  + `${outside(ungated.last, AT_EDGE).toFixed(2)} / ${outside(unclamped.last, AT_EDGE).toFixed(2)}`
  + `  deriva ${drift(gated.last, AT_EDGE).toFixed(2)} / ${drift(ungated.last, AT_EDGE).toFixed(2)}`
  + ` / ${drift(unclamped.last, AT_EDGE).toFixed(2)}  (col cancello / senza / senza niente)`);
report.line(`        lontano dal bordo deriva ${drift(gated.last, AWAY).toFixed(2)} / `
  + `${drift(ungated.last, AWAY).toFixed(2)} / ${drift(unclamped.last, AWAY).toFixed(2)}`);

report.check(outside(gated.last, AT_EDGE) <= 1e-9,
  'col cancello e la stretta, dopo la disocclusione non resta niente che il presente non abbia',
  `${outside(gated.last, AT_EDGE).toFixed(3)} livelli fuori dal vicinato del marciato`);
report.check(outside(unclamped.last, AT_EDGE) > 10,
  'e senza cancello ne stretta, la disocclusione lascia attaccato quello che era li prima',
  `${outside(unclamped.last, AT_EDGE).toFixed(2)} livelli fuori dal vicinato del marciato`);
report.check(drift(gated.last, AT_EDGE) < drift(unclamped.last, AT_EDGE),
  'e il cancello e quello che tiene la fascia del bordo vicina al marciato',
  `${drift(gated.last, AT_EDGE).toFixed(2)} contro ${drift(unclamped.last, AT_EDGE).toFixed(2)} livelli`);
report.check(outside(gateOnly.last, AT_EDGE) < 2,
  'e il cancello da solo quasi basta: la stretta nel vicinato e la seconda cintura',
  `${outside(gateOnly.last, AT_EDGE).toFixed(3)} livelli senza nessuna stretta, contro `
  + `${outside(unclamped.last, AT_EDGE).toFixed(1)} senza nessuna delle due`);
report.check(drift(gated.last, AT_EDGE) < drift(gated.last, AWAY) * 3,
  'e la fascia del bordo non e peggio del suolo che nessuna disocclusione ha toccato',
  `${drift(gated.last, AT_EDGE).toFixed(2)} contro ${drift(gated.last, AWAY).toFixed(2)} livelli`);

// ---------------------------------------------------------------------------
// 4. E IL SORGENTE, perche' un modello verde su un programma che non lo segue
//    non e' una guardia. Quattro contratti, e ognuno e' una riga che se sparisce
//    riporta il difetto.
// ---------------------------------------------------------------------------
const post = read('src/core/post.js');
const suolo = read('src/world/layers/v1-suolo.js');
const marcher = read('src/world/voxel/campo-material.js');

report.check(/const CAMPO_MEMORY = \{ weight: 0, jitter: false \}/.test(post),
  'la memoria nasce SPENTA nel posto in cui il fotogramma la legge');
report.check(/wanted\.campoMemoria \? wanted\.campoMemoria\.weight : 0,/.test(suolo),
  'e l\'indirizzo che non dice niente la lascia spenta');
report.check(/CAMPO_JITTER\.value\.set\(0, 0\);/.test(post)
  && post.match(/CAMPO_JITTER\.value\.set\(0, 0\);/g).length >= 2,
  'lo scarto torna a nought su OGNI strada che non sta accumulando',
  `${(post.match(/CAMPO_JITTER\.value\.set\(0, 0\);/g) || []).length} ritorni a nought`);
report.check(/off \+= uJitter;/.test(marcher),
  'il marciatore somma lo scarto alla griglia ruotata e non fa altro con esso');
report.check(/uniform vec2 uJitter;/.test(marcher) && /uJitter: CAMPO_JITTER/.test(marcher),
  'e lo prende per riferimento dal fotogramma, non per copia');
report.check(/gl_FragDepth = d;/.test(post),
  'il passo porta attraverso la profondita\' marciata invece di fonderla');
report.check(/if \(length\(was - here\) > uGate \* foot\) return;/.test(post),
  'il cancello e\' in metri sul suolo, e rifiuta prima di fondere');
report.check(/fragColour = mix\(raw, clamp\(past, lo, hi\), uWeight\);/.test(post),
  'e cio' + '\' che passa il cancello viene stretto nel vicinato del marciato');
report.check(/const remembering = campoing && CAMPO_MEMORY\.weight > 0;/.test(post),
  'a peso nought non viene disegnato nessun passo');

if (process.argv.includes('--self')) {
  // I DIFETTI VERI, iniettati nel modello e nel sorgente letto, uno per volta.
  const shutSource = post.replace('const CAMPO_MEMORY = { weight: 0, jitter: false }',
    'const CAMPO_MEMORY = { weight: 0.9, jitter: true }');
  const loudHandle = suolo.replace('wanted.campoMemoria ? wanted.campoMemoria.weight : 0,',
    'wanted.campoMemoria ? wanted.campoMemoria.weight : 0.9,');
  const leakyJitter = post.replace(/CAMPO_JITTER\.value\.set\(0, 0\);/g, 'void 0;');
  selfTest('guard-memoria', [
    {
      what: 'una fusione senza cancello di profondita\', che scia',
      caught: outside(unclamped.last, AT_EDGE) > 10,
    },
    {
      what: 'e la scia si vede dove il modello dice che deve vedersi',
      caught: outside(unclamped.last, AT_EDGE) > 10 && outside(gated.last, AT_EDGE) <= 1e-9,
    },
    {
      what: 'uno scarto sub-texel senza memoria, che sfarfalla',
      caught: shakenOnly > still * 2,
    },
    {
      what: 'una memoria accesa di sua iniziativa nel posto che il fotogramma legge',
      caught: !/const CAMPO_MEMORY = \{ weight: 0, jitter: false \}/.test(shutSource),
    },
    {
      what: 'un indirizzo muto che accende la memoria lo stesso',
      caught: !/wanted\.campoMemoria \? wanted\.campoMemoria\.weight : 0,/.test(loudHandle),
    },
    {
      what: 'uno scarto lasciato sul raggio mentre nulla lo somma, che sposta il byte',
      caught: !(/CAMPO_JITTER\.value\.set\(0, 0\);/.test(leakyJitter)),
    },
    {
      // Il nullo tolto di mezzo: il passo fonde lo stesso, a peso nought, e
      // quello che esce non e' piu' il fotogramma marciato. E' il difetto che
      // «a maniglia spenta il byte e' quello di oggi» proibisce.
      what: 'un passo che fonde lo stesso a peso nought, e sposta il byte',
      caught: !nullExact(
        remember(rawOnly, march(0, 0), 3, 2, { weight: 0, floorWeight: 0.05 }), rawOnly,
      ),
    },
  ]);
}

report.end(`${TEXELS} texel di modello, due superfici e una parallasse di `
  + `${NEAR_PARALLAX}:${FAR_PARALLAX}; fermo ${still.toFixed(3)}, solo scarto `
  + `${shakenOnly.toFixed(3)}, scarto e somma ${remembered.toFixed(3)} livelli`);
