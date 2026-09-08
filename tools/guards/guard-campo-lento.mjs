import {
  ALBEDO, PIGMENT, PIGMENT_GLSL, PIGMENT_SEEDS, pigTint, pigmentCensus, pigmentOf,
} from '../../src/world/voxel/pure.js';
import { read, reporter, selfTest } from './lib.mjs';

// THE MEADOW'S PIGMENT IS A FIELD AND NOT A DRAW, AND THIS IS WHAT SAYS SO.
//
// WHAT IT IS GUARDING AGAINST, in the two numbers that condemned what shipped
// before it. Blur a window of meadow at three cubes and ask how much of the
// light and dark survives: the day target keeps 0.516 of its variance, this
// render kept 0.151, and the TARGET WITH ITS OWN CUBES SHUFFLED -- the absolute
// floor of having no organisation at all -- keeps 0.066. We were nearer the
// shuffle than the picture. And between the palest and the darkest cube of ONE
// material under ONE light, the multiplier covered 0.10 to 6.18: sixty two to
// one, drawn independently for every cube. Those two facts are the same fact,
// and the committente sees it as a chequerboard.
//
// THE GATE RUNS WITHOUT A BROWSER, which is the whole reason the pigment became
// a pure function. A guard that could only ask this question of a screenshot
// would be asked once a session; this one is asked at every commit, because
// src/world/voxel/pigment.js answers under plain node. That is residuo 1 of
// E-FOND-PIANO11 spent on the thing it was opened for.
//
// TWO LEGS AND THEY ASK DIFFERENT QUESTIONS. The first is the FIELD's own --
// how much of the pigment's variance lives above three cubes, and how wide the
// band it is allowed is -- and it is always armed. The second is the PICTURE's,
// the measure the research published, and it needs a frame: pass one with
// --frame=<png> and it runs; without one it says so and does not pretend.
//
// WHY THE FIELD'S OWN SHARE IS THE ONE THAT IS GATED. The picture's share is a
// ratio whose denominator is the whole frame -- the orientation ladder, the
// relief, how much flank the eye sees -- and none of that is this file's. The
// unit that fitted this pigment measured the frame with the pigment switched OFF
// and read 0.259: two thirds of what the picture scores is the world's own, and
// a gate on the picture would be a gate on the mesher wearing this guard's name.
// The field's share is the pigment's alone.

const CUBI_DI_SFOCATURA = 3;
const LATO = 192;

// WHAT THE SHIPPED FIELD READS, and it is a reading and not a round number: the
// tune in pigment.js, walked over 36 864 columns, puts 0.540 of its own variance
// above three cubes. The floor is that reading less a tenth -- wider than
// anything a re-tuning inside the fitted family moves it by, and nowhere near
// the defect it exists for: with the slow octave taken out and its amplitude
// handed to the per-cube residue instead, the same measure reads 0.010.
const QUOTA_MINIMA = 0.45;

// AND THE BAND. What shipped covered 62 to 1; the target never lets a face fall
// below 0.365 of a cube top. This is not the picture's rung -- the pigment is
// only one of its terms -- it is the pigment's OWN spread, and it is held at a
// ceiling the fitted band clears with room: the fit landed on 2.39.
const BANDA_MASSIMA = 3.0;

/** Media mobile gaussiana separabile su una griglia quadrata. */
function sfoca(v, lato, sigma) {
  const r = Math.ceil(3 * sigma);
  const peso = [];
  let somma = 0;
  for (let d = -r; d <= r; d++) { const w = Math.exp(-d * d / (2 * sigma * sigma)); peso.push(w); somma += w; }
  const k = peso.map((w) => w / somma);
  const a = new Float64Array(lato * lato);
  const b = new Float64Array(lato * lato);
  for (let y = 0; y < lato; y++) {
    for (let x = 0; x < lato; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += v[y * lato + Math.min(lato - 1, Math.max(0, x + d))] * k[d + r];
      a[y * lato + x] = s;
    }
  }
  for (let y = 0; y < lato; y++) {
    for (let x = 0; x < lato; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += a[Math.min(lato - 1, Math.max(0, y + d)) * lato + x] * k[d + r];
      b[y * lato + x] = s;
    }
  }
  return b;
}

const varianza = (a) => {
  const mu = a.reduce((s, v) => s + v, 0) / a.length;
  return a.reduce((s, v) => s + (v - mu) ** 2, 0) / a.length;
};

/**
 * La quota del campo che sopravvive a una sfocatura di tre cubi.
 *
 * Il campo e' campionato per COLONNA, che e' l'unita' in cui e' definito, quindi
 * un cubo e' un campione e la sfocatura ha sigma tre.
 */
export function quotaDelCampo(tune = PIGMENT, lato = LATO) {
  const v = new Float64Array(lato * lato);
  for (let z = 0; z < lato; z++) for (let x = 0; x < lato; x++) v[z * lato + x] = pigTint(x, z, tune);
  const tot = varianza(v);
  if (tot <= 0) return 0;
  return varianza(sfoca(v, lato, CUBI_DI_SFOCATURA)) / tot;
}

/** Quanto e' larga la banda: il piu' chiaro sul piu' scuro che il campo consente. */
export const bandaDelCampo = (tune = PIGMENT) => tune.tintCeil / tune.tintFloor;

// IL FRAMMENTO DEL PRATO E NON IL FILE, che ne contiene due: il selciato legge
// tre mappe cotte dal pittore e i suoi sampler sono suoi. Una guardia che
// cercasse «sampler2D» in tutto il file accuserebbe il corridoio di una regola
// che non e' la sua, e -- peggio -- diventerebbe verde il giorno che qualcuno
// togliesse le mappe al selciato per farla tacere.
const sorgente = read('src/world/voxel/material.js');

/**
 * Il corpo del modello che si apre a un nome, dal suo apice al suo compagno.
 *
 * IL TAGLIO NON SI PRENDE PIU' SU UNA FRASE DI COMMENTO. Quel che stava qui
 * finiva il frammento all'indice di «// THE PAVING: THE MATERIAL OF A CORRIDOR»,
 * cioe' su una riga di PROSA in un file che non e' di questa guardia: chi
 * riscrive quel commento -- una cosa che nessuno considera un cambiamento --
 * fa saltare il taglio, e nel modo peggiore possibile, perche' `indexOf`
 * risponde -1 e `slice(a, -1)` NON e' vuoto: e' quasi tutto il file. La guardia
 * non diventa rossa, comincia a leggere anche il selciato e a rispondere di
 * un'altra famiglia.
 *
 * Quindi il taglio si prende sul modello stesso, contando gli apici e le
 * interpolazioni che ci stanno dentro. Una riga di commento riscritta, un
 * blocco spostato o un secondo materiale aggiunto in fondo al file non lo
 * muovono, e un modello che non c'e' torna vuoto invece che intero.
 */
export function modelloDi(testo, nome) {
  const apre = testo.indexOf(nome);
  if (apre < 0) return '';
  const primo = testo.indexOf('`', apre);
  if (primo < 0) return '';
  let annidato = 0;
  for (let i = primo + 1; i < testo.length; i++) {
    if (testo[i] === '\\') { i += 1; continue; }
    if (testo[i] === '$' && testo[i + 1] === '{') { annidato += 1; i += 1; continue; }
    if (testo[i] === '}' && annidato > 0) { annidato -= 1; continue; }
    if (testo[i] === '`' && annidato === 0) return testo.slice(primo + 1, i);
  }
  return '';
}

const fragment = modelloDi(sorgente, 'const FRAGMENT');

// =========================================================================
// COME SI CHIEDE, ADESSO, CHE IL PIGMENTO SIA UNA FUNZIONE DELLA COLONNA.
//
// LA DOMANDA NON E' CAMBIATA. Quel che questa guardia difende e' che il
// pigmento sia una funzione della COLONNA e mai dell'altezza del cubo: una cima
// e il fianco sotto di lei portano una tinta sola, che e' quel che rende
// compatta la famiglia chiara e riporta il gradino piu' basso a essere la sola
// scala d'orientamento.
//
// E' LA RISPOSTA CHE ERA SCRITTA MALE. Erano due statement GLSL interi appuntati
// alla lettera -- `pigmentOf(column.x, column.y)` e `vec2 column = floor(cell.xz
// * uCellRatio)` -- e ognuno dei due si rompe su una riscrittura CORRETTA del
// frammento: la variabile rinominata, i due fattori scambiati (`uCellRatio *
// cell.xz` e' la stessa moltiplicazione), la chiamata spezzata su due righe, uno
// spazio in piu' dentro le parentesi. Una guardia che va rossa quando il
// frammento viene riscritto bene insegna a riscriverlo male, ed e' il difetto
// che U-GUARDIA-3 ha censito qui (residuo 3).
//
// Quel che si chiede adesso e' il FLUSSO e non il testo, in quattro passi che
// non nominano nessun identificatore del frammento:
//
//   1. il pigmento e' chiesto UNA volta sola, con DUE argomenti;
//   2. nessuno dei due argomenti raggiunge l'altezza della cella -- e
//      «raggiunge» vuol dire che una swizzle di `cell` contiene una y, quindi
//      `cell.xz` passa e `cell.xyz`, `cell.y` e `cell.zy` no;
//   3. i due argomenti sono due componenti di UN SOLO nome, e quel nome nasce
//      da una swizzle di `cell` che non contiene la y: e' la colonna, comunque
//      la si chiami e comunque sia scritta l'espressione che la fa;
//   4. ne' lo statement che riceve il pigmento ne' nessuna riassegnazione di
//      quel nome rimette l'altezza dentro per la porta di servizio.
//
// Il passo 3 e' quello che sostituisce i due letterali: al passo del suolo la
// colonna e' `cell.xz` esatta, al passo del manto e' `cell.xz` per il rapporto
// fra i due passi (U-ERBA-1), e tutte e due passano perche' quel che si guarda
// e' da dove viene, non come e' scritta.
// =========================================================================

/** Il GLSL senza i suoi commenti, che non sono codice e non decidono niente. */
const senzaCommenti = (glsl) => glsl.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/** Le swizzle di `cell` che un'espressione nomina. */
const swizzleDiCella = (expr) => [...expr.matchAll(/\bcell\s*\.\s*([xyzwrgba]+)/g)].map((m) => m[1]);

/** Un'espressione raggiunge la QUOTA: una swizzle di cella che porta la y. */
const portaLaQuota = (expr) => swizzleDiCella(expr).some((s) => s.includes('y'))
  || /\bcell\s*\[\s*1\s*\]/.test(expr);

/** Le chiamate a una funzione, con la lista di argomenti bilanciata. */
function chiamate(glsl, nome) {
  const trovate = [];
  const re = new RegExp(`\\b${nome}\\s*\\(`, 'g');
  let m = re.exec(glsl);
  while (m) {
    let profondita = 1;
    let i = re.lastIndex;
    while (i < glsl.length && profondita > 0) {
      if (glsl[i] === '(') profondita += 1;
      else if (glsl[i] === ')') profondita -= 1;
      i += 1;
    }
    trovate.push({ argomenti: glsl.slice(re.lastIndex, i - 1), da: m.index, a: i });
    re.lastIndex = i;
    m = re.exec(glsl);
  }
  return trovate;
}

/** Gli argomenti di primo livello di una lista, che le virgole annidate non tagliano. */
function argomenti(lista) {
  const fuori = [];
  let profondita = 0;
  let inizio = 0;
  for (let i = 0; i < lista.length; i++) {
    const c = lista[i];
    if (c === '(' || c === '[') profondita += 1;
    else if (c === ')' || c === ']') profondita -= 1;
    else if (c === ',' && profondita === 0) { fuori.push(lista.slice(inizio, i)); inizio = i + 1; }
  }
  fuori.push(lista.slice(inizio));
  return fuori.map((v) => v.trim()).filter((v) => v.length > 0);
}

/** Lo statement in cui un indice cade: fra il separatore prima e il punto e virgola dopo. */
function statementIntorno(glsl, da, a) {
  let inizio = da;
  while (inizio > 0 && !';{}'.includes(glsl[inizio - 1])) inizio -= 1;
  let fine = a;
  while (fine < glsl.length && glsl[fine] !== ';') fine += 1;
  return glsl.slice(inizio, fine);
}

/** Da che cosa nasce un nome: la parte destra della sua dichiarazione. */
function nasceDa(glsl, nome) {
  const re = new RegExp(`\\b(?:vec2|vec3|vec4|ivec2|ivec3|ivec4|float|int)\\s+${nome}\\s*=([^;]*);`);
  const m = re.exec(glsl);
  return m ? m[1] : null;
}

/** Ogni riassegnazione di un nome, come parte destra. */
function riassegnazioniDi(glsl, nome) {
  const re = new RegExp(`(?:^|[;{}\\n])\\s*${nome}(?:\\s*\\.\\s*[xyzwrgba]+)?\\s*(?:\\*|\\+|-|/)?=([^;]*);`, 'g');
  return [...glsl.matchAll(re)].map((m) => m[1]);
}

/** Il pigmento e' una funzione della COLONNA: la chiamata non porta la quota. */
export function perColonna(testo) {
  const glsl = senzaCommenti(testo);
  const chieste = chiamate(glsl, 'pigmentOf');
  // 1. una chiamata sola, e due argomenti: un terzo argomento e' la quota che
  //    torna dentro sotto un altro nome.
  if (chieste.length !== 1) return false;
  const args = argomenti(chieste[0].argomenti);
  if (args.length !== 2) return false;
  // 2. nessuno dei due raggiunge l'altezza.
  if (args.some(portaLaQuota)) return false;
  // 3. i due sono due componenti di UN nome, e quel nome nasce dalla cella
  //    senza la sua y.
  const basi = args.map((a) => (/^([A-Za-z_]\w*)\s*\.\s*[xyzwrgba]$/.exec(a) || [])[1]);
  if (!basi[0] || basi[0] !== basi[1]) return false;
  const nascita = nasceDa(glsl, basi[0]);
  if (nascita === null || portaLaQuota(nascita)) return false;
  if (swizzleDiCella(nascita).length === 0) return false;
  if (riassegnazioniDi(glsl, basi[0]).some(portaLaQuota)) return false;
  // 4. e lo statement che riceve il pigmento non se la rimette accanto.
  return !portaLaQuota(statementIntorno(glsl, chieste[0].da, chieste[0].a));
}

/** I semi stanno in un posto solo: il GLSL li porta dall'oggetto, non a mano. */
export const semiCondivisi = (glsl, seeds) => Object.values(seeds)
  .every((pair) => pair.every((v) => glsl.includes(String(v))));

if (process.argv.includes('--self')) {
  const senzaLento = { ...PIGMENT, slow: 0, mid: 0.5, grain: 0.5 };
  const soloCubo = { ...PIGMENT, slow: 0, mid: 0, grain: 1.0 };
  selfTest('guard-campo-lento', [
    {
      what: 'a field with the slow octave taken out is caught',
      caught: quotaDelCampo(senzaLento) < QUOTA_MINIMA,
    },
    {
      what: 'and one that is a draw per cube and nothing else is caught',
      caught: quotaDelCampo(soloCubo) < QUOTA_MINIMA,
    },
    {
      what: 'the band that shipped before this pass -- 0.10 to 6.18, sixty two to one -- is caught',
      caught: bandaDelCampo({ tintFloor: 0.10, tintCeil: 6.18 }) > BANDA_MASSIMA,
    },
    {
      what: 'a floor let down to a tenth is caught even at the shipped ceiling',
      caught: bandaDelCampo({ ...PIGMENT, tintFloor: 0.10 }) > BANDA_MASSIMA,
    },
    {
      what: 'a pigment call that takes the cube\'s height back is caught',
      caught: !perColonna('vec3 albedo = pigmentOf(cell.x, cell.y, cell.z);'),
    },
    {
      what: 'and one that reaches the height beside the column is caught',
      caught: !perColonna('vec2 column = floor(cell.xz * uCellRatio);\n'
        + 'vec3 albedo = pigmentOf(column.x, column.y) * f(cell.y);'),
    },
    {
      what: 'and a column BUILT out of the height, which is the same defect one line up',
      caught: !perColonna('vec2 column = floor(cell.xz * uCellRatio) + cell.y;\n'
        + 'vec3 albedo = pigmentOf(column.x, column.y);'),
    },
    {
      what: 'and one that gets it back by a later assignment to the column itself',
      caught: !perColonna('vec2 column = floor(cell.xz * uCellRatio);\n'
        + 'column += cell.y;\n vec3 albedo = pigmentOf(column.x, column.y);'),
    },
    {
      what: 'and a second call, which is the field drawn twice at two frequencies',
      caught: !perColonna('vec2 column = floor(cell.xz * uCellRatio);\n'
        + 'vec3 albedo = pigmentOf(column.x, column.y);\n'
        + 'vec3 other = pigmentOf(column.y, column.x);'),
    },
    {
      what: 'and a column whose two components come from two different names',
      caught: !perColonna('vec2 column = floor(cell.xz * uCellRatio);\n'
        + 'vec2 other = floor(cell.zx);\n'
        + 'vec3 albedo = pigmentOf(column.x, other.y);'),
    },
    {
      // ------------------------------------------------------------------
      // E QUESTA E' LA GAMBA PER CUI IL LETTORE E' STATO RISCRITTO: il
      // frammento riscritto BENE deve continuare a passare. Ognuna di queste
      // quattro e' una riscrittura che un'unita' potrebbe fare domani senza
      // toccare la proprieta' -- e ognuna delle quattro faceva rossa la
      // guardia di ieri, che appuntava i due statement alla lettera.
      what: 'and a fragment REWRITTEN and not broken still passes: renamed, reordered, wrapped, spaced',
      caught: perColonna('vec2 xz = floor(cell.xz * uCellRatio);\n'
          + 'vec3 albedo = pigmentOf(xz.x, xz.y);')
        && perColonna('vec2 column = floor(uCellRatio * cell.xz);\n'
          + 'vec3 albedo = pigmentOf(column.x, column.y);')
        && perColonna('vec2 column = floor(cell.xz * uCellRatio);\n'
          + 'vec3 albedo = pigmentOf(\n    column.x,\n    column.y\n  );')
        && perColonna('vec2  column  =  floor( cell.xz  *  uCellRatio ) ;\n'
          + 'vec3  albedo  =  pigmentOf( column . x , column . y ) ;'),
    },
    {
      what: 'and the comment that used to end the fragment can be rewritten without moving the cut',
      caught: modelloDi('const FRAGMENT = () => `A ${x} B`;\n// ANY PROSE AT ALL\n'
        + 'const PAVING = () => `C`;', 'const FRAGMENT') === 'A ${x} B'
        && modelloDi('const OTHER = 1;', 'const FRAGMENT') === '',
    },
    {
      what: 'a shader carrying its own copy of a seed is caught',
      caught: !semiCondivisi(PIGMENT_GLSL.replace(String(PIGMENT_SEEDS.mid[0]), '21.4'), PIGMENT_SEEDS),
    },
    {
      what: 'the null: the same tune read twice gives the same share to the last digit',
      caught: quotaDelCampo(PIGMENT) === quotaDelCampo(PIGMENT),
    },
  ]);
}

const report = reporter('guard-campo-lento -- the pigment is a field in the world, not a draw per cube');

const quota = quotaDelCampo();
const banda = bandaDelCampo();
const censo = pigmentCensus('meadow');

report.line(`  the field: zones ${PIGMENT.slowCubes} cubes, cube octave ${PIGMENT.midCubes}, `
  + `amplitudes ${PIGMENT.slow} / ${PIGMENT.mid} / ${PIGMENT.grain}`);
report.line(`  the band:  ${PIGMENT.tintFloor} to ${PIGMENT.tintCeil}   `
  + `median ${censo.p50}, sd ${censo.sd}, ${(censo.atFloor * 100).toFixed(1)}% on the floor, `
  + `${(censo.atCeil * 100).toFixed(1)}% on the ceiling`);
report.line('');

report.check(quota >= QUOTA_MINIMA,
  `${(CUBI_DI_SFOCATURA)} cubes of blur leave at least ${QUOTA_MINIMA} of the pigment's own variance`,
  `${quota.toFixed(3)} over ${LATO * LATO} columns `
  + `(a draw per cube and nothing else reads ${quotaDelCampo({ ...PIGMENT, slow: 0, mid: 0, grain: 1 }).toFixed(3)})`);

report.check(banda <= BANDA_MASSIMA,
  `the palest column stands no more than ${BANDA_MASSIMA} times the darkest`,
  `${banda.toFixed(3)} to one  (what shipped before this pass: 62 to one)`);

report.check(perColonna(fragment),
  'the meadow asks the pigment for a column and not for a cube',
  'a top face and the flank under it carry one tint, which is what makes the bright family '
  + 'compact and what puts the deepest rung back to being the orientation ladder alone');

report.check(semiCondivisi(PIGMENT_GLSL, PIGMENT_SEEDS),
  'the shader reads its lattice seeds from the twin and does not keep its own',
  Object.entries(PIGMENT_SEEDS).map(([k, v]) => `${k} ${v.join('/')}`).join(', '));

// IL PIGMENTO NON SI LEGGE DA UNA TEXTURE, ED E' QUESTA LA FRASE -- non «il
// frammento non dichiara nessun sampler».
//
// La riga diceva la seconda perche' finche' il prato non ne aveva nessuno le due
// erano la stessa cosa. Non lo sono piu': U-ERBA-2 ha costruito quel che
// E-DECISIONI9.3 chiede -- «ombre vere che seguono il sole» -- come una mappa
// cotta al worldgen e letta in XZ, e il mandato di quell'unita' la nomina alla
// lettera: «la mappa e' una texture letta in XZ, non un attributo». Quel che
// questa guardia difende non lo tocca: la mappa non porta un colore, non entra
// in pigmentOf, e -- la ragione vera del divieto -- non e' un ATTRIBUTO, quindi
// la fusione greedy non perde un rettangolo.
//
// Quindi la gamba si stringe a quel che protegge, con l'elenco di quel che il
// prato puo' leggere SCRITTO qui e non dedotto: la grana di E-TEX1 e l'ombra
// del manto. Un sampler che non sia uno di quei due e' rosso come prima.
const SAMPLER_AMMESSI = ['tSheets', 'tShade'];
const sampler = [...fragment.matchAll(/uniform\s+sampler\w*\s+(\w+)/g)].map((m) => m[1]);
const estranei = sampler.filter((n) => !SAMPLER_AMMESSI.includes(n));
// E FIN DOVE ARRIVA QUESTO CENSIMENTO, detto invece che sottinteso. Il modello
// del prato interpola otto pezzi di GLSL che vivono altrove, e il taglio ne
// porta il NOME e non il corpo -- come faceva anche il taglio di prima, che
// arrivava fino al selciato passando sopra gli stessi otto marcatori. Un
// sampler nascosto dentro uno di quei pezzi non lo vede ne' l'uno ne' l'altro.
// Ognuno degli otto e' di un'altra sede e ha la sua guardia; quel che manca e'
// la domanda posta sul GLSL COMPOSTO, che si fa sul programma compilato e non
// qui sotto node nudo.
// I pezzi sono le interpolazioni che portano GLSL: un'interpolazione dentro una
// riga di commento e' un numero stampato nella prosa e non un pezzo di codice.
const PEZZI = [...new Set(senzaCommenti(fragment).matchAll(/\$\{\s*(\w+)/g))]
  .map((m) => m[1]);
report.check(estranei.length === 0,
  'and the only maps the meadow reads are the grain and the mat\'s own shadow',
  estranei.length ? `it also declares ${estranei.join(', ')}`
    : `${sampler.join(', ') || 'none'} -- the field itself is still rebuilt in the fragment `
      + 'from the cube\'s own integer cell, so the greedy fusion keeps the 2.3-3.3x it is worth');
report.note(`il censimento dei sampler legge il MODELLO del prato e non i ${PEZZI.length} pezzi `
  + `che interpola (${PEZZI.join(', ')}): quelli portano il nome e non il corpo, come nel taglio `
  + 'di prima. Un sampler nascosto dentro uno di loro non lo vede questa gamba; si vedrebbe sul '
  + 'GLSL COMPOSTO, cioe\' sul programma compilato, che non e\' una domanda da node nudo. '
  + 'Proprietari: le sedi degli otto pezzi, e guard-programmi per il composto.');

// ------------------------------------------------------- la gamba del quadro
const frame = process.argv.find((a) => a.startsWith('--frame='));
if (!frame) {
  report.note('the picture\'s own share was not asked: pass --frame=<png> to measure a frame. '
    + 'The field\'s share above is the pigment\'s alone and is what this guard gates.');
} else {
  const file = frame.slice('--frame='.length);
  const sharp = (await import('sharp')).default;
  // La finestra e il sigma sono quelli su cui la ricerca ha pubblicato i propri
  // numeri: 940,700,400x230 e dodici pixel sul target. Il sigma sale col cubo,
  // e il nostro cubo sta a 1,833 volte il suo, misurato con un righello solo sui
  // due quadri.
  const BOX = { left: 940, top: 700, width: 400, height: 230 };
  // Il sigma e' un LETTERALE e non una misura per fotogramma, perche' una
  // guardia il cui righello si rimisura a ogni scatto non ha un letterale da
  // difendere: 12 px sul target per 1,833, che e' il rapporto fra i due passi
  // del cubo letto con un solo stimatore sui due quadri alla posa che giudica.
  const SIGMA = 22;
  const lum = async (pipe) => {
    const { data, info } = await pipe.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const out = new Float64Array(info.width * info.height);
    for (let i = 0; i < out.length; i++) {
      out[i] = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
    }
    return out;
  };
  const piatto = await lum(sharp(file).extract(BOX));
  const lento = await lum(sharp(file).extract(BOX).blur(SIGMA));
  const share = varianza(lento) / varianza(piatto);
  report.line('');
  report.line(`  the picture, ${file}:`);
  report.line(`    ${share.toFixed(3)} of its variance survives a blur of ${SIGMA} px`);
  report.line('    the day target reads 0.516 at the same window and 12 px; the target with its');
  report.line('    own cubes shuffled reads 0.066, which is the floor of no organisation at all');
  report.note(`the picture's share at ${file} is ${share.toFixed(3)}: printed, not gated -- its `
    + 'denominator is the whole frame, and the relief in it is not this file\'s');
}

report.end(`the meadow's median column is ${ALBEDO.meadow.map((c, i) => (c * censo.p50).toFixed(4))
  .join(', ')}, the bare earth's ${pigmentOf('earth', 0, 0).map((v) => v.toFixed(4)).join(', ')} at the origin`);
