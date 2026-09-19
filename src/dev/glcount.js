// QUANTE VOLTE PER FOTOGRAMMA SI PARLA AL DRIVER, e quante di quelle volte non
// si dice niente di nuovo.
//
// PERCHE' IL NUMERO CONTA, E NON CONTA DOVUNQUE (E-LINUX1). Su Chrome e su
// Firefox sotto Wayland le chiamate WebGL sono accodate e riprodotte da un
// filo che non e' quello del giro: costano poco qui e si pagano la'. Su Firefox
// sotto X11 non c'e' glthread, e ogni `uniform*`, ogni `bindTexture`, ogni
// `drawElements` si paga per intero sul filo che sta anche aggiornando il corpo,
// la presenza e il mondo. Il committente legge 26 ms di CPU per fotogramma in
// Firefox contro 16,5 in Brave sulla stessa macchina e sulla stessa scena, e
// quei dieci millisecondi sono questo conto.
//
// COME. Il contesto vero viene avvolto una volta sola, prima che la pagina abbia
// disegnato alcunche', e ogni funzione diventa una funzione che conta e poi
// chiama. E' caro -- e' la ragione per cui sta dietro una maniglia propria,
// `?dev&gl`, e non dentro `?dev`: una misura del TEMPO presa con questo acceso
// misurerebbe l'avvolgimento. Quel che si legge di qui sono NUMERI DI CHIAMATE,
// che sono gli stessi con o senza.
//
// E QUELLE CHE NON DICONO NIENTE DI NUOVO si riconoscono da sole: per le
// funzioni di STATO -- quelle il cui effetto e' interamente descritto dai loro
// argomenti -- si tiene l'ultimo giro di argomenti e si confronta. Una chiamata
// che ripete parola per parola quel che il driver ha gia' e' una chiamata
// ridondante, e su un filo senza glthread e' un costo senza un pixel.
//
// Vive sotto src/dev/ e nient'altro la importa: `import.meta.env.DEV` la piega
// via dal fascio che si spedisce, esattamente come src/dev/pose.js.

// Le famiglie che si contano a parte, perche' sono le tre domande che si fanno
// a una scheda lenta: quanti disegni, quanti stati, quanti caricamenti.
const DRAWS = new Set([
  'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced',
  'drawRangeElements', 'clear',
]);

// Le funzioni il cui effetto e' interamente nei loro argomenti: se gli stessi
// argomenti arrivano due volte di seguito, la seconda non cambia niente. Le
// `uniform*` NON sono in questa lista per famiglia ma per SEDE: la stessa
// `uniform1f` su due locazioni diverse non e' una ripetizione, quindi la chiave
// porta dentro la locazione (vedi `keyOf`).
const STATEFUL = /^(bind|enable|disable|useProgram|activeTexture|blend|depth|cull|frontFace|colorMask|polygonOffset|stencil|viewport|scissor|pixelStorei|uniform|vertexAttrib)/;

// Quel che non si conta mai fra le ridondanti, perche' ripeterlo E' il lavoro.
const NEVER_REDUNDANT = new Set([
  'bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D', 'texImage3D',
  'readPixels', 'drawBuffers',
]);

export function isGlCountEnabled() {
  const query = new URLSearchParams(window.location.search);
  return query.has('dev') && query.has('gl');
}

/**
 * Avvolge il contesto e comincia a contare.
 *
 * @param {WebGL2RenderingContext} gl  il contesto vero
 * @returns {object} il seggio da cui si legge il conto
 */
export function countGlCalls(gl) {
  const total = new Map();
  const redundant = new Map();
  const lastArgs = new Map();
  let frames = 0;
  let draws = 0;
  let calls = 0;
  let redundantCalls = 0;
  const perFrame = [];

  // ---------------------------------------------------------------------
  // CHE COSA E' UNA RIPETIZIONE, E LE DUE VOLTE IN CUI QUESTO FILE SE LO E'
  // CHIESTO MALE.
  //
  // Una chiamata e' ridondante quando LO STATO CHE SCRIVE e' gia' quello che il
  // driver ha. Quindi servono due cose: la SEDE dello stato (la chiave) e il
  // VALORE scritto in quella sede. Sbagliare l'una o l'altro non fa sbagliare
  // il conto di poco, lo fa sbagliare per intero:
  //
  //   * `activeTexture(unit)` ha UNA sede -- qual e' l'unita' attiva -- e il
  //     valore e' l'unita'. Scritta `activeTexture|unit`, la chiave mette ogni
  //     unita' in una sede sua e ogni chiamata diventa la ripetizione di se
  //     stessa: il primo giro di questo banco ha letto 39 activeTexture per
  //     fotogramma e le ha chiamate TUTTE ridondanti. Erano zero.
  //   * `enable(cap)` e `disable(cap)` scrivono la STESSA sede -- se `cap` e'
  //     acceso -- con due valori diversi. Tenute per chiave separate, una
  //     alternanza accendi/spegni legge come due sequenze di ripetizioni.
  //   * `uniformMatrix4fv(loc, false, elements)` riceve da three SEMPRE LO
  //     STESSO Float32Array, mutato sul posto. Un confronto che si ferma
  //     all'identita' dell'oggetto dice «uguale» a ogni fotogramma: il primo
  //     giro ha letto 27 matrici per fotogramma e le ha chiamate tutte
  //     ridondanti mentre cambiavano tutte. Un array-like si confronta SEMPRE
  //     elemento per elemento, e si CONSERVA per copia.
  //
  // Le tre letture sbagliate facevano 77 delle 106 «ridondanti» per fotogramma
  // del primo giro. Sono scritte qui perche' un conto sbagliato che nessuno
  // sbugiarda e' il modo in cui una campagna taglia la cosa sbagliata.
  // ---------------------------------------------------------------------

  /** La SEDE dello stato che una chiamata scrive. */
  const keyOf = (name, args) => {
    // Il primo argomento e' la WebGLUniformLocation, che e' un oggetto: si usa
    // come chiave di una Map, che e' esattamente quel che una Map sa fare.
    if (name.startsWith('uniform')) return args[0];
    // Un `cap` e' una sede sola con due valori, non due sedi.
    if (name === 'enable' || name === 'disable') return `cap|${args[0]}`;
    // `bindTexture(target, tex)`, `bindBuffer(target, buf)`,
    // `bindFramebuffer(target, fb)`: la sede e' il bersaglio.
    if (name === 'bindTexture' || name === 'bindBuffer' || name === 'bindBufferBase'
      || name === 'bindFramebuffer' || name === 'bindRenderbuffer') {
      return `${name}|${args[0]}`;
    }
    // `bindVertexArray(vao)`, `useProgram(p)`, `activeTexture(unit)`: una sede
    // sola, e il valore e' l'argomento.
    return name;
  };

  /** Il VALORE che quella chiamata scrive in quella sede. */
  const valueOf = (name, args) => {
    if (name === 'enable' || name === 'disable') return [name];
    if (name.startsWith('uniform')) return args.slice(1);
    if (name === 'bindTexture' || name === 'bindBuffer' || name === 'bindBufferBase'
      || name === 'bindFramebuffer' || name === 'bindRenderbuffer') {
      return args.slice(1);
    }
    return args;
  };

  /** Una copia che sopravvive a chi la muta sul posto. */
  const keep = (values) => values.map(
    (v) => (v && typeof v.length === 'number' && typeof v !== 'string' ? Array.from(v) : v),
  );

  const sameArgs = (a, b) => {
    if (!a || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      const x = a[i];
      const y = b[i];
      // MAI L'IDENTITA' PER UN ARRAY, per la ragione scritta sopra: three passa
      // lo stesso Float32Array a ogni fotogramma e ne cambia il contenuto.
      if (x && y && typeof x.length === 'number' && typeof x !== 'string'
        && typeof y.length === 'number' && typeof y !== 'string') {
        if (x.length !== y.length) return false;
        for (let k = 0; k < x.length; k += 1) if (x[k] !== y[k]) return false;
        continue;
      }
      if (x !== y) return false;
    }
    return true;
  };

  const bump = (map, name) => map.set(name, (map.get(name) || 0) + 1);

  for (const name of Object.keys(Object.getPrototypeOf(gl))) {
    const value = gl[name];
    if (typeof value !== 'function') continue;
    const bound = value.bind(gl);
    const stateful = STATEFUL.test(name) && !NEVER_REDUNDANT.has(name);
    const drawing = DRAWS.has(name);
    gl[name] = (...args) => {
      calls += 1;
      bump(total, name);
      if (drawing) draws += 1;
      if (stateful) {
        const key = keyOf(name, args);
        const value = valueOf(name, args);
        const before = lastArgs.get(key);
        if (sameArgs(before, value)) {
          redundantCalls += 1;
          bump(redundant, name);
        } else {
          lastArgs.set(key, keep(value));
        }
      }
      return bound(...args);
    };
  }

  return {
    /** Chiude il fotogramma e mette la riga nel registro. */
    frame() {
      frames += 1;
      perFrame.push({ calls, draws, redundant: redundantCalls });
      calls = 0;
      draws = 0;
      redundantCalls = 0;
      // LO STATO NON SI AZZERA FRA UN FOTOGRAMMA E L'ALTRO, ed e' il punto: il
      // driver non dimentica quel che gli e' stato detto ieri, e una chiamata
      // che ripete a inizio fotogramma quel che era vero alla fine di quello
      // prima e' ridondante esattamente come le altre.
      return frames;
    },

    /** Che cosa si e' detto al driver, e quanto di quello era gia' detto. */
    read() {
      const rows = [...total.entries()]
        .map(([name, n]) => ({ nome: name, n, ridondanti: redundant.get(name) || 0 }))
        .sort((a, b) => b.n - a.n);
      const counted = perFrame.slice(1);   // il primo fotogramma compila
      const mid = (pick) => {
        if (!counted.length) return null;
        const xs = counted.map(pick).sort((a, b) => a - b);
        return xs[xs.length >> 1];
      };
      return {
        fotogrammi: counted.length,
        perFotogramma: {
          chiamate: mid((f) => f.calls),
          disegni: mid((f) => f.draws),
          ridondanti: mid((f) => f.redundant),
        },
        funzioni: rows.slice(0, 30),
      };
    },

    /** Da capo, per misurare una posa invece di una pagina. */
    reset() {
      total.clear();
      redundant.clear();
      perFrame.length = 0;
      frames = 0;
      calls = 0;
      draws = 0;
      redundantCalls = 0;
    },
  };
}
