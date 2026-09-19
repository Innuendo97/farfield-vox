// IL CRONOMETRO DEL GIRO, per passo.
//
// Il riquadro di sviluppo ha sempre avuto UNA riga per la CPU:
// `performance.now() - started` sull'intero passo del ciclo. Quel numero dice
// che il fotogramma costa sedici millisecondi di filo principale sul portatile
// del committente (E-LINUX1) e non dice di CHI siano. Su una macchina dove la
// GPU e' il collo quella riga si perde nel rumore; su una dove non lo e' --
// Firefox su X11, che non ha glthread e paga ogni chiamata GL qui -- e' meta'
// del difetto, e per tagliarla bisogna prima saperla leggere.
//
// COME. Il giro chiama `mark(nome)` fra una sezione e l'altra: ogni marca
// chiude il passo precedente e apre il seguente. Non ci sono parentesi da
// chiudere e non c'e' una funzione per passo, perche' una funzione per passo
// sarebbe una closure per passo e questo file esiste per CONTARE le
// allocazioni, non per farne.
//
// E SPENTO NON COSTA UNA MISURA, COSTA UNA CHIAMATA. `mark` fuori da `?dev`
// legge un booleano e torna: nessun `performance.now()`, nessuna scrittura,
// nessun oggetto. Quel che resta -- una dozzina di chiamate vuote per
// fotogramma -- e' misurato e scritto nel verbale accanto al costo dello
// strumento acceso, perche' uno strumento che non dichiara il proprio peso
// misura se stesso.
//
// NIENTE SI ALLOCA PER FOTOGRAMMA. I nomi entrano in una tabella la prima volta
// che si vedono e non piu'; le letture vivono in un anello di Float32Array
// dimensionato una volta; `read()` -- che lo chiama il riquadro ogni duecento
// millisecondi e il banco quando vuole -- e' l'unica cosa qui che alloca, e non
// sta nel percorso caldo.

// Quante letture tiene l'anello. Tre secondi a sessanta fotogrammi, sei a
// trenta: abbastanza perche' un p95 sia un p95 e non il peggiore di venti.
const WINDOW = 180;

// Quanti passi distinti l'anello ha posto per. Il giro ne dichiara una dozzina
// e i layer del mondo un'altra; trentadue lascia margine senza che la tabella
// smetta di stare in una riga di cache.
const MAX = 32;

const names = [];
const slots = new Map();
const ring = new Float32Array(MAX * WINDOW);
const frame = new Float32Array(MAX);
const scratch = new Float32Array(WINDOW);

let on = false;
let cursor = 0;
let filled = 0;
let last = 0;
let current = -1;
let opened = 0;

function slotOf(name) {
  const found = slots.get(name);
  if (found !== undefined) return found;
  if (names.length >= MAX) return -1;
  const slot = names.length;
  names.push(name);
  slots.set(name, slot);
  return slot;
}

/**
 * Accende o spegne il cronometro.
 *
 * Chiamato una volta, dove il flag `?dev` e' letto. Spegnerlo azzera l'anello:
 * letture prese con lo strumento acceso e letture prese con lo strumento spento
 * non sono la stessa grandezza e non stanno nella stessa finestra.
 */
export function armSteps(enabled) {
  on = !!enabled;
  cursor = 0;
  filled = 0;
  current = -1;
  return on;
}

export function stepsArmed() {
  return on;
}

/** L'inizio del giro. Tutto quel che viene prima non e' di nessun passo. */
export function beginFrame(now) {
  if (!on) return;
  frame.fill(0);
  last = typeof now === 'number' ? now : performance.now();
  opened = last;
  current = -1;
}

/**
 * Chiude il passo aperto e ne apre un altro.
 *
 * @param {string} name  il nome del passo che COMINCIA qui
 */
export function mark(name) {
  if (!on) return;
  const now = performance.now();
  if (current >= 0) frame[current] += now - last;
  last = now;
  current = slotOf(name);
}

/** La fine del giro: l'ultimo passo si chiude e la riga entra nell'anello. */
export function endFrame() {
  if (!on) return 0;
  const now = performance.now();
  if (current >= 0) frame[current] += now - last;
  current = -1;
  const base = cursor * MAX;
  for (let i = 0; i < MAX; i += 1) ring[base + i] = frame[i];
  cursor = (cursor + 1) % WINDOW;
  if (filled < WINDOW) filled += 1;
  return now - opened;
}

function percentile(slot, fraction) {
  for (let i = 0; i < filled; i += 1) scratch[i] = ring[i * MAX + slot];
  const view = scratch.subarray(0, filled);
  view.sort();
  return view[Math.min(filled - 1, Math.floor(filled * fraction))];
}

/**
 * Che cosa e' costato ogni passo, in millisecondi.
 *
 * IL SEGGIO CHE IL BANCO LEGGE. Torna null a strumento spento, cosi' che un
 * chiamante non possa scambiare «nessuna misura» per «nessun costo».
 *
 * @returns {{frames:number, passi:Array, somma:object}|null}
 */
export function readSteps() {
  if (!on || filled === 0) return null;
  const passi = [];
  let p50 = 0;
  let p95 = 0;
  for (let slot = 0; slot < names.length; slot += 1) {
    const a = percentile(slot, 0.5);
    const b = percentile(slot, 0.95);
    let sum = 0;
    for (let i = 0; i < filled; i += 1) sum += ring[i * MAX + slot];
    passi.push({
      nome: names[slot], p50: a, p95: b, media: sum / filled,
    });
    p50 += a;
    p95 += b;
  }
  // La somma dei p50 non e' il p50 della somma e non pretende di esserlo: e' il
  // bilancio di dove va il millisecondo, che e' la domanda che questo strumento
  // esiste per rispondere. Il p50 del fotogramma intero e' `totale` qui sotto,
  // preso sulla riga e non sui pezzi.
  const totals = new Float32Array(filled);
  for (let i = 0; i < filled; i += 1) {
    let sum = 0;
    for (let slot = 0; slot < names.length; slot += 1) sum += ring[i * MAX + slot];
    totals[i] = sum;
  }
  totals.sort();
  return {
    frames: filled,
    passi,
    somma: {
      p50, p95, totale50: totals[filled >> 1], totale95: totals[Math.min(filled - 1, Math.floor(filled * 0.95))],
    },
  };
}
