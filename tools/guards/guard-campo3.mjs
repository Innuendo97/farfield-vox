import { Matrix4 } from 'three';
import { read, readJson, reporter, selfTest } from './lib.mjs';
import { TIERS } from '../../src/core/quality.js';
import { campoBox, campoMaterial } from '../../src/world/voxel/campo-material.js';

// IL CAMPO A META' RISOLUZIONE, RICOMPOSTO A PIENA: LE DUE MAGLIE, IL CANCELLO E
// IL NULLO.
//
// COSA IMPEDISCE. E-PERF5 ha pesato il fotogramma disegno per disegno e ha
// trovato UNA voce che ne porta due terzi: la terra ray-marchata, 16,62 ms su
// 25,61 alla posa che il committente giudica. Non e' cara perche' ce n'e' tanta
// -- e' una scatola, dodici triangoli, un disegno -- e' cara PER PIXEL DI TERRA,
// e lo sweep della leva risoluzione l'ha dimostrato alla seconda cifra: a 0,75
// il fotogramma disegna il 56,3% dei pixel e il campo costa il 55,2% di quello
// che costava. La leva pero' non poteva essere quella del FOTOGRAMMA, perche' a
// 0,85 il prato regge e LA SCRITTA DEL MONOLITE si ammorbidisce con lui, e la
// scritta e' il portfolio. Quindi il pixel si toglie alla terra e a nient'altro.
//
// E TOGLIERLO ALLA TERRA SI PUO' FARE IN QUATTRO MODI SBAGLIATI, che sono
// esattamente le quattro sezioni di questa guardia.
//
//   1. DISEGNANDO LA TERRA DUE VOLTE, O NESSUNA. Le maglie sono due -- il
//      marciatore e la ricomposizione -- e ne deve disegnare esattamente una.
//      Chi lo decide e' il TELAIO, con un livello sulla camera, e non una
//      bandiera tenuta nel mondo: due bandiere sono due posti dove la stessa
//      decisione e' scritta, e prima o poi dicono cose diverse.
//   2. PERDENDO LA COPERTURA. Il quarto canale del bersaglio ridotto e' la
//      frazione del pixel che ha trovato terra, e tre porte gliela tolgono in
//      silenzio: un formato senza alfa, un azzeramento ad alfa UNO (che e' cio'
//      che three fa di suo quando la tela e' opaca -- misurato: il primo
//      fotogramma che questo passaggio abbia mai disegnato aveva tutto il cielo
//      nero), e un materiale «transparent: false» in fusione NORMALE, che three
//      converte in NESSUNA fusione.
//   3. SPALMANDO I BORDI. Quattro texel intorno a un pixel, letti bilineari,
//      danno su uno spigolo una profondita' che non sta su NESSUNA delle due
//      superfici -- un posto per aria fra il cubo e il prato dietro -- e un
//      fiore ai piedi di quel cubo non taglia piu' niente. Il cancello sulla
//      profondita' e' quello che lo impedisce, e la sezione 3 lo rifa' qui in
//      aritmetica invece di crederci.
//   4. MUOVENDO IL PIXEL DOVE NON DOVEVA. Il campo cambia; la scritta, la
//      pietra, i fiori e il cielo no. La sezione 4 tiene il nullo: a scala uno
//      il seggio dice «nessun campo», la ricomposizione scarta alla prima riga e
//      il marciatore torna nel passaggio del mondo.

const POST = read('src/core/post.js');
const MATERIAL = read('src/world/voxel/campo-material.js');
const FIELD = read('src/world/voxel/campo-field.js');
const QUALITY = read('src/core/quality.js');
const THREE = read('node_modules/three/build/three.module.js');
const THREE_VERSION = readJson('node_modules/three/package.json').version;

const report = reporter('guard-campo3 -- il campo a meta risoluzione, ricomposto a piena');

// ==========================================================================
// I LETTORI, E PERCHE' NON APPUNTANO PIU' UNA RIGA.
//
// U-GUARDIA-3 ha censito questa guardia come la piu' fragile della cartella,
// per due ragioni diverse. La prima: DUE GAMBE APPUNTANO IL SORGENTE DI UNA
// DIPENDENZA -- due statement di `node_modules/three/build/three.module.js`,
// battuta per battuta, spazi dentro le parentesi compresi -- quindi un
// aggiornamento CORRETTO di three le manda rosse senza che una riga di questo
// deposito sia cambiata, ed e' il modo piu' sicuro che esista di insegnare a
// una campagna che il rosso di una guardia non vuol dire niente. La seconda:
// altre gambe appuntano uno statement INTERO di `src/`, e una delle due lo
// dichiara pure («non e' stata toccata di un carattere»), cosi' che mettere le
// graffe a un `if` o infilare una riga in mezzo a due altre e' rosso.
//
// Quello che le due gambe su three vogliono sapere non e' come three e'
// scritto: e' se LA REGOLA c'e' ancora, perche' e' la regola che rende
// necessario il rimedio che questa guardia tiene una riga piu' su. Quindi si
// chiedono per FORMA -- l'assegnamento a `clearAlpha` che nasce da `alpha`, e
// il ramo di `setMaterial` che spegne la fusione di un opaco in fusione
// normale -- senza spazi, senza a capo e senza l'ordine dei termini, e il
// --self prova le due direzioni CHE CONTANO: una regola davvero cambiata va
// rossa, e la stessa regola RIFORMATTATA (minificata, reindentata, con i
// termini scambiati) resta verde. La versione letta e' stampata a ogni corsa,
// cosi' un aggiornamento maggiore e' una dichiarazione e non una sorpresa.
//
// Lo stesso rimedio, e lo stesso --self a tre casi, per gli statement di
// `src/`: la delivery passa, il difetto vero e' preso, e la stessa cosa
// riscritta come la riscriverebbe un lettore attento passa lo stesso.
// ==========================================================================

/** Un sorgente senza commenti, senza a capo e senza spazi: la sua FORMA. */
const shape = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
  .replace(/\s+/g, ' ')
  .replace(/ ?([^\w$ ]) ?/g, '$1')
  .trim();

/**
 * three azzera ad alfa UNO quando la tela e' opaca.
 *
 * Chiesto come dataflow e non come riga: c'e' un assegnamento a `clearAlpha`
 * il cui lato destro nasce da `alpha` e sceglie fra zero e uno. Comunque three
 * scriva quel ternario -- `alpha===true?0:1`, `alpha?0:1`, `!alpha?1:0` -- la
 * regola e' quella, ed e' la regola che rende necessario il rimedio qui sotto.
 */
export const clearsOpaqueToOne = (text) => {
  const s = shape(text);
  return /clearAlpha=(!?)alpha(===(true|false))?\?(0:1|1:0)/.test(s)
    || /clearAlpha=(!?)alpha(===(true|false))?\?(0\.0:1\.0|1\.0:0\.0)/.test(s);
};

/**
 * three spegne la fusione di ogni materiale «transparent: false» in fusione
 * NORMALE, che e' precisamente perche' l'alfa del campo non e' mai stata spesa.
 *
 * Chiesto come forma: i due termini della condizione e la chiamata che ne
 * segue, senza spazi e nei due ordini in cui una condizione di due termini si
 * puo' scrivere.
 */
export const killsBlendingOnOpaqueNormal = (text) => {
  const s = shape(text);
  const a = 'material.blending===NormalBlending';
  const b = 'material.transparent===false';
  return (s.includes(`(${a}&&${b})?setBlending(NoBlending)`)
    || s.includes(`(${b}&&${a})?setBlending(NoBlending)`)
    || s.includes(`${a}&&${b}){setBlending(NoBlending)`)
    || s.includes(`${b}&&${a}){setBlending(NoBlending)`));
};

/**
 * Il telaio toglie il livello al mondo quando il passaggio c'e' e GLIELO
 * RIMETTE quando non c'e'.
 *
 * Un solo ramo -- «togli» senza «rimetti» -- e' come un livello si perde: il
 * giorno che il tier torna a uno, la terra non la disegna piu' nessuno e non
 * ci sarebbe niente di rosso da nessuna parte. Chiesto come forma perche' la
 * stessa cosa si scrive con le graffe, con l'`else if`, o con i due rami
 * scambiati e la condizione negata, e tutte e tre sono giuste.
 */
export const givesTheLayerBack = (text) => {
  const s = shape(text);
  const off = 'worldCamera.layers.disable(CAMPO_LAYER)';
  const on = 'worldCamera.layers.enable(CAMPO_LAYER)';
  if (!s.includes(off) || !s.includes(on)) return false;
  // I due rami dello STESSO bivio, nei due versi in cui il bivio si scrive.
  return /if\(campoing\)\{?worldCamera\.layers\.disable\(CAMPO_LAYER\);?\}? ?else ?\{? ?worldCamera\.layers\.enable\(CAMPO_LAYER\)/.test(s)
    || /if\(!campoing\)\{?worldCamera\.layers\.enable\(CAMPO_LAYER\);?\}? ?else ?\{? ?worldCamera\.layers\.disable\(CAMPO_LAYER\)/.test(s);
};

/**
 * L'azzeramento del bersaglio, chiesto all'ORDINE e non alla riga sotto.
 *
 * Le due gambe che stavano qui volevano tre statement ADIACENTI, con i loro a
 * capo: un commento scritto fra l'azzeramento e il legame -- che e' la modifica
 * piu' probabile che ci sia, in un punto del telaio che chiede di essere
 * spiegato -- le mandava rosse su un fotogramma intatto. La proprieta' non e'
 * l'adiacenza: e' che l'ULTIMO azzeramento scritto PRIMA che il bersaglio sia
 * legato dica zero. Fra i due si puo' scrivere quel che si vuole.
 *
 * (U-GUARDIA-4 ha tolto la stessa adiacenza da guard-buffer; il predicato e'
 * ricopiato invece che condiviso perche' lib.mjs e' l'unico file che otto rami
 * modificano insieme, e un aiuto messo li' e' un conflitto programmato otto
 * volte.)
 */
export function clearedToNothing(text, target) {
  const bind = text.indexOf(`setRenderTarget(${target})`);
  if (bind < 0) return false;
  const before = text.slice(0, bind);
  const clears = [...before.matchAll(/setClearAlpha\(\s*([^)]*?)\s*\)/g)];
  if (!clears.length) return false;
  return Number(clears.at(-1)[1]) === 0;
}

/** E cio' che era stato messo da parte si rimette, dopo il disegno del mondo. */
export function putBackAfterTheWorld(text) {
  const kept = /(\w+)\s*=\s*gl\.getClearAlpha\(\)/.exec(text);
  if (!kept) return false;
  const drawn = text.indexOf('render(worldScene, worldCamera)');
  if (drawn < 0) return false;
  return new RegExp(`setClearAlpha\\(\\s*${kept[1]}\\s*\\)`).test(text.slice(drawn));
}

/** Il passaggio esiste solo sotto a uno E con dei posti da marciare. */
export const passOnlyUnderOne = (text) => /const campoing=campoScale<1&&campoSeats>0/
  .test(shape(text));

// ------------------------ LA SCALA DEL SOTTO-CAMPIONAMENTO, CHIESTA AL VALORE
//
// QUESTA NON SI LEGGE PIU' COME TESTO AFFATTO, ed e' il caso che mostra la
// differenza. Le due gambe che stavano qui appuntavano tre righe di
// `campo-material.js` una per una, e la seconda lo diceva a voce alta: «la riga
// che guard-zoom tiene appuntata non e' stata toccata di un carattere». Una
// gamba che chiede a un file di non cambiare non sta sorvegliando una
// proprieta': sta sorvegliando una battitura.
//
// La proprieta' e' che il pixel su cui il campo filtra e' quello del BERSAGLIO
// LEGATO e non quello della tela, e si puo' chiedere al valore: `campoBox` monta
// un `onBeforeRender` che scrive `uPixelScale`, e sotto node basta un disegnatore
// finto -- due metodi, quelli che quella funzione chiama -- per farglielo
// scrivere davvero. Un bersaglio di mezzo lato deve raddoppiare il numero;
// nessun bersaglio legato deve dare quello della tela. Cosi' e' il CODICE che
// risponde, e qualunque riscrittura che tenga la promessa passa.
const SCREEN = { width: 1920, height: 1080 };
const drawer = (bound) => ({
  getRenderTarget: () => bound,
  getDrawingBufferSize: (v) => v.set(SCREEN.width, SCREEN.height),
});
const eye = { fov: 44.199, projectionMatrix: new Matrix4(), matrixWorldInverse: new Matrix4() };

/** Il pixel che il campo filtra, con quel bersaglio legato addosso. */
export function pixelScaleWith(bound) {
  const material = campoMaterial({ texture: null });
  const box = campoBox(material);
  box.onBeforeRender(drawer(bound), null, eye);
  return material.uniforms.uPixelScale.value;
}

// ================================================== 1. LE DUE MAGLIE, UNA SOLA
const layerOf = (name) => {
  const m = new RegExp(`export const ${name} = (\\d+);`).exec(POST);
  return m ? Number(m[1]) : null;
};
const campoLayer = layerOf('CAMPO_LAYER');
const softLayer = layerOf('SOFT_DEPTH_LAYER');
report.check(campoLayer !== null && softLayer !== null && campoLayer !== softLayer
  && campoLayer !== 0,
  'il campo ha un livello suo, e non e quello del servizio della profondita',
  `campo ${campoLayer}, profondita ${softLayer}`);

report.check(/mesh\.layers\.set\(CAMPO_LAYER\);/.test(MATERIAL),
  'il marciatore sta SEMPRE sul suo livello, comunque vada il tier',
  'campoBox in campo-material.js');

// E IL TELAIO DECIDE, IN TUTTI E DUE I VERSI. Un solo ramo -- «togli il livello
// quando il passaggio c'e'» senza «rimettilo quando non c'e'» -- e' come un
// livello si perde: il giorno che il tier torna a uno, la terra non la disegna
// piu' nessuno, e non ci sarebbe niente di rosso da nessuna parte.
report.check(givesTheLayerBack(POST),
  'e il telaio lo toglie al mondo quando il passaggio c e, e glielo rimette quando non c e');

report.check(/resolve\.visible = fieldScale < 1;/.test(FIELD),
  'la ricomposizione si vede solo sotto a uno');

// LO STESSO POSTO NELL'ORDINE. Il campo spedisce a renderOrder 10 -- ultimo
// degli opachi, dietro il cielo e lo skyline, davanti ai fiori trasparenti -- e
// ognuna di quelle relazioni porta peso: la copertura si fonde contro un cielo
// che c'e' gia', e la profondita' di tutta la prateria entra nel buffer prima
// che i fiori ci passino sopra. Le due maglie devono stare nello stesso posto o
// non sono due versioni di una cosa.
const orders = [...MATERIAL.matchAll(/mesh\.renderOrder = (\d+);/g)].map((m) => Number(m[1]));
report.check(orders.length === 2 && orders[0] === orders[1],
  'le due maglie stanno nello STESSO posto nell ordine degli opachi',
  `renderOrder ${orders.join(' e ')}`);

// ================================================= 2. LA COPERTURA, TRE PORTE
//
// (a) IL FORMATO. Il bersaglio della scena e' un float impacchettato SENZA
// ALFA -- e' la decisione di U-PERF-4 e non si tocca -- quindi la copertura che
// il campo calcola da sempre non ha dove stare e viene buttata nel momento in
// cui si scrive. Il bersaglio ridotto ha quattro canali apposta.
const found = /function allocateCampo\(\)[\s\S]*?\n  \}/.exec(POST);
const alloc = found ? found[0] : '';
report.check(/format: RGBAFormat/.test(alloc) && /type: HalfFloatType/.test(alloc),
  'il bersaglio della terra ha quattro canali, che e dove la copertura vive',
  'RGBA16F, otto byte su un quarto dei pixel');
report.check(/minFilter: NearestFilter/.test(alloc) && /magFilter: NearestFilter/.test(alloc),
  'e si campiona al texel: la ricomposizione fa la sua pesatura e un bilineare '
  + 'sotto sarebbe un secondo filtro che nessuno ha chiesto');
report.check(/name: 'R11F_G11F_B10F',[\s\S]{0,400}?format: RGBFormat/.test(POST),
  'e il bersaglio della scena continua a non averne, che e la ragione del sopra',
  'tre canali, e la copertura del campo non ha mai avuto dove stare');

// (b) L'AZZERAMENTO. three azzera ad alfa UNO ogni volta che la tela e' opaca,
// e un bersaglio lasciato al suo default arriva con ogni texel che dichiara di
// essere terra.
report.check(clearedToNothing(POST, 'campoTarget'),
  'il bersaglio della terra si azzera a NIENTE prima del disegno',
  'l ULTIMO azzeramento scritto prima di legarlo, comunque siano spaziate le righe');
report.check(putBackAfterTheWorld(POST),
  'e l azzeramento del resto del mondo si rimette a posto subito dopo');
report.check(clearsOpaqueToOne(THREE),
  'e la regola di three che lo rende necessario e ancora quella',
  `WebGLBackground, three ${THREE_VERSION}, chiesta per forma e non per riga`);

// (c) LA FUSIONE. three spegne la fusione di ogni materiale «transparent:
// false» in fusione NORMALE, che e' precisamente perche' l'alfa del campo non
// e' mai stata spesa. Chiesta per nome sopravvive, e «transparent» resta false,
// che e' cio' che tiene questo disegno nel passaggio OPACO dov'e' sempre stato.
report.check(killsBlendingOnOpaqueNormal(THREE),
  'e la regola di three che spegne la fusione degli opachi e ancora quella',
  `WebGLState.setMaterial, three ${THREE_VERSION}, chiesta per forma e non per riga`);
const cut = /export function campoResolve\(seat\) \{[\s\S]*?\n\}/.exec(MATERIAL);
const body = cut ? cut[0] : '';
report.check(/blending: CustomBlending/.test(body) && /blendSrc: SrcAlphaFactor/.test(body)
  && /blendDst: OneMinusSrcAlphaFactor/.test(body) && /transparent: false/.test(body),
  'quindi la ricomposizione chiede la fusione PER NOME e resta un opaco');
report.check(/depthWrite: true/.test(body) && /depthTest: true/.test(body),
  'e scrive la profondita, che e cio che fa tagliare i fiori nella prateria');

// E IL BORDO CONTRO I MONOLITI NON LO TIENE NITIDO UN FILTRO: lo tiene il buffer
// del fotogramma, con dentro un pixel INTERO di muratura, che dice di no.
report.check(/gl_FragDepth = depth;/.test(MATERIAL),
  'la ricomposizione scrive gl_FragDepth, cosi il bordo contro i monoliti '
  + 'lo decide un pixel intero di monolite e non un mezzo pixel di prato');

// ============================================ 3. IL CANCELLO, IN ARITMETICA
//
// LA PROPRIETA' SU CUI E' COSTRUITO. La profondita' di finestra e' AFFINE nello
// schermo su qualunque PIANO -- e' la proprieta' su cui e' costruito
// l'interpolatore dell'hardware -- quindi quattro texel di un prato visto di
// sbieco possono discordare moltissimo ed essere tutti sulla stessa superficie,
// mentre quattro texel a cavallo di uno spigolo discordano piu' di quanto un
// piano qualunque possa spiegare.
//
// DA CUI IL TEOREMA CHE QUESTA SEZIONE VERIFICA: su un piano d = a x + b y + c
// gli scarti dei quattro texel dal texel di riferimento valgono al massimo
// |a| + |b|, e la tolleranza vale uEdge (|a| + |b|). Quindi con uEdge >= 1 il
// cancello non puo' scartare un texel su un piano, QUALUNQUE sia la pendenza --
// e con uEdge < 1 comincia a scartarne, cioe' il prato si mette a leggere il
// texel piu' vicino e ricomincia a scintillare.
const edge = Number(/uEdge: \{ value: ([\d.]+) \}/.exec(MATERIAL)[1]);
const floor = Number(/uEdgeFloor: \{ value: ([\de.+-]+) \}/.exec(MATERIAL)[1]);

/** Il cancello, rifatto: quali dei quattro texel sopravvivono. */
export function gate(d, f, uEdge, uEdgeFloor) {
  const gx = Math.min(Math.abs(d[1] - d[0]), Math.abs(d[3] - d[2]));
  const gy = Math.min(Math.abs(d[2] - d[0]), Math.abs(d[3] - d[1]));
  const tol = uEdge * (gx + gy) + uEdgeFloor;
  const ref = (f[0] >= 0.5 ? 1 : 0) + (f[1] >= 0.5 ? 2 : 0);
  return d.map((v) => Math.abs(v - d[ref]) <= tol);
}

/** E la profondita che ne esce, contro quella che un bilineare nudo darebbe. */
export function depthOf(d, f, keep) {
  const w = [(1 - f[0]) * (1 - f[1]), f[0] * (1 - f[1]), (1 - f[0]) * f[1], f[0] * f[1]];
  let mass = 0;
  let sum = 0;
  for (let i = 0; i < 4; i += 1) if (keep[i]) { mass += w[i]; sum += w[i] * d[i]; }
  return mass > 0 ? sum / mass : null;
}
export const bilinear = (d, f) => depthOf(d, f, [true, true, true, true]);

const CORNERS = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.5]];
const SLOPES = [];
for (let i = 0; i < 24; i += 1) {
  // Da un prato quasi frontale a uno cosi' di sbieco che un texel copre piu'
  // profondita' di quanta ne stia fra un cubo e il prato che ha dietro.
  const a = 1e-7 * (10 ** (i / 4));
  SLOPES.push([a, a * 0.37], [a * 0.11, a], [a, -a * 0.8]);
}
let planeDropped = 0;
let planeWorst = 0;
for (const [a, b] of SLOPES) {
  const d = [0.97, 0.97 + a, 0.97 + b, 0.97 + a + b];
  for (const f of CORNERS) {
    const keep = gate(d, f, edge, floor);
    if (keep.some((k) => !k)) planeDropped += 1;
    planeWorst = Math.max(planeWorst, Math.abs(bilinear(d, f) - depthOf(d, f, keep)));
  }
}
report.check(edge >= 1,
  'la tolleranza vale almeno UNO scarto locale, che e la condizione del teorema',
  `uEdge ${edge}`);
report.check(planeDropped === 0,
  'e su un PIANO il cancello non scarta un texel a nessuna pendenza',
  `${SLOPES.length} pendenze su sette decadi, ${SLOPES.length * CORNERS.length} pixel`);
report.check(planeWorst === 0,
  'quindi su un piano la ricomposizione E il bilineare, alla cifra',
  `scarto massimo ${planeWorst}`);

// E SU UNO SPIGOLO IL CANCELLO TAGLIA, e cio' che taglia via e' esattamente il
// posto per aria fra le due superfici. Lo spigolo di prova e' un ANGOLO -- un
// texel dei quattro sull'altra superficie -- che e' la forma che ha lo spigolo
// di un cubo dentro un quadratino di due per due: la sagoma del campo e' fatta
// di cubi e le sue rotture attraversano il quadratino di sbieco.
const a0 = 3e-5;
const salto = 0.004;
const step = [0.97, 0.97 + a0, 0.97 + a0 * 0.4, 0.97 + a0 * 1.4 + salto];
let edgeDropped = 0;
let liar = 0;
for (const f of CORNERS) {
  const keep = gate(step, f, edge, floor);
  if (keep.some((k) => !k)) edgeDropped += 1;
  const nude = bilinear(step, f);
  liar = Math.max(liar, Math.min(...step.map((v) => Math.abs(nude - v))));
}
report.check(edgeDropped === CORNERS.length,
  'su uno SPIGOLO invece taglia, a ogni pixel del texel',
  `${edgeDropped}/${CORNERS.length}`);
report.check(liar > floor * 10,
  'e cio che taglia e il posto per aria: il bilineare nudo ci mette una '
  + 'profondita che non sta su nessuna delle due superfici',
  `fino a ${(liar * 1e3).toFixed(3)} millesimi di profondita da tutte e due`);

// E IL PUNTO CIECO, DICHIARATO INVECE CHE NASCOSTO.
//
// Uno spigolo che attraversa il quadratino DA PARTE A PARTE, dritto e allineato
// agli assi, il cancello non lo vede -- e non e' una svista, e' una cosa che
// quattro texel non possono sapere. Le due differenze parallele all'asse che lo
// taglia lo attraversano tutte e due, quindi il minimo fra loro E' il salto, la
// tolleranza se lo mangia e i quattro texel restano. Ci vorrebbe una terza riga
// di texel -- nove prese di profondita' invece di quattro, che sul banco di
// questa unita' e' circa un decimo del risparmio -- e non e' stata pagata,
// perche' cio' che il mandato chiede sono i BORDI CONTRO I MONOLITI, i fiori,
// gli alberi e il camminatore, e quelli non li tiene questo cancello: li tiene
// il test di profondita' a piena risoluzione, con dentro un pixel INTERO di
// muratura. Cio' che resta al cancello e' la sagoma interna del prato, dove uno
// spigolo dritto da parte a parte fra due altezze e' il caso raro e uno spigolo
// di sbieco -- provato qui sopra -- e' la regola.
const attraverso = [0.97, 0.97 + a0, 0.97 + salto, 0.97 + a0 + salto];
const visto = CORNERS.filter((f) => gate(attraverso, f, edge, floor).some((k) => !k)).length;
report.check(visto === 0,
  'e lo spigolo che attraversa il quadratino da parte a parte NON lo vede, '
  + 'che e cio che quattro texel non possono sapere',
  'dichiarato qui perche una guardia che nasconde il proprio punto cieco '
  + 'e una guardia che nessuno puo credere');
if (visto === 0) {
  report.note('il cancello non separa uno spigolo dritto allineato agli assi che '
    + 'attraversa tutto il quadratino: ci vorrebbe una terza riga di texel (nove '
    + 'prese invece di quattro, circa un decimo del risparmio). Non pagata: i bordi '
    + 'del mandato -- contro monoliti, fiori, alberi, camminatore -- li tiene il test '
    + 'di profondita a PIENA risoluzione, non questo cancello.');
}

// ==================================================================== 4. IL NULLO
report.check(/if \(uCampoOn < 0\.5\) discard;/.test(MATERIAL),
  'a scala uno la ricomposizione scarta alla PRIMA riga',
  'nessun texel letto, nessun cancello, nessuna fusione');
report.check(passOnlyUnderOne(POST),
  'e il passaggio non esiste: ne bersaglio, ne disegno, ne stadio');
report.check(/'prepass', 'campo', 'scene'/.test(POST),
  'lo stadio del campo sta ACCANTO a scene e non dentro',
  'un costo ripiegato nel passaggio accanto non e un costo che qualcuno possa citare');

// E IL PIXEL DEL SOTTO-CAMPIONAMENTO SEGUE IL BERSAGLIO, che e' l'unica riga di
// campo-material.js che questa unita' abbia dovuto muovere. La LOD non si muove
// -- e' una distanza in metri dal camminatore e non nomina un pixel, che e'
// l'affermazione di guard-zoom -- ma il prefiltro della lama, il giunto e lo
// spigolo sono in PIXEL e DEVONO esserlo (U-CAMPO-1 §9, RESTA: «ogni termine in
// pixel ... sono la scala del sotto-campionamento e devono esserlo»), e un campo
// che marcia in un buffer di mezzo lato filtrando come se ne avesse uno intero
// aliaserebbe per costruzione.
const onScreen = pixelScaleWith(null);
const onHalf = pixelScaleWith({ width: SCREEN.width / 2, height: SCREEN.height / 2 });
report.check(onScreen > 0 && Math.abs(onHalf / onScreen - 2) < 1e-9,
  'la scala del sotto-campionamento la da il bersaglio LEGATO, non la tela',
  `${onScreen.toExponential(4)} sulla tela ${SCREEN.width}x${SCREEN.height}, `
  + `${onHalf.toExponential(4)} su un bersaglio di mezzo lato: esattamente il doppio`);
report.check(Math.abs(onScreen - 2 * Math.tan((eye.fov * Math.PI / 180) / 2) / SCREEN.height) < 1e-12,
  'ed e la finestra a un metro divisa per i pixel in cui e disegnata, che e cio '
  + 'che un fwidth avrebbe letto',
  'chiesto al VALORE che il disegno scrive, e non alla riga che lo scrive');

// ======================================================================= I TIER
for (const tier of TIERS) {
  report.check(typeof tier.campoScale === 'number' && tier.campoScale > 0
    && tier.campoScale <= 1,
    `il tier ${tier.id} dichiara il pixel della terra`, `campoScale ${tier.campoScale}`);
}
report.check(/renderer\.setCampoScale\(hub\.setCampoScale\(tier\.campoScale \?\? 1\)\);/.test(QUALITY),
  'e il governatore muove le due meta della leva con UN numero',
  'quello su cui il mondo si e posato, non quello che il tier voleva');

// =================================================================== LE RICEVUTE
//
// AT_TODAY, 2026-09-08 (U-PERF-6). La scheda per passata alla posa FITTATA, tier
// alto, 1920x869, prima persona, velo tolto, tre giri da 90 letture, SCRIVANIA
// SCARICA -- e alla scala che il tier alto spedisce davvero, che e' TRE QUARTI
// (D-C3-1) e non il mezzo su cui U-CAMPO-3 aveva scritto questa riga.
//
// I numeri di prima erano 26,51 -> 8,08 + 1,72 = 37%, presi a MEZZO lato su una
// macchina CARICA (sette server altrui e due dozzine di Chrome). Erano giusti
// per quello che erano e sbagliati come ricevuta del mondo: il mondo a mezzo
// lato lo disegna solo il tier basso.
const AT_TODAY = { scala: 0.75, prima: 21.902, dopo: 9.480, ricomposizione: 1.114 };
const quota = (AT_TODAY.dopo + AT_TODAY.ricomposizione) / AT_TODAY.prima;
// IL TETTO E' UNA LEGGE DELLA SCALA E NON UN NUMERO, la stessa che tiene
// guard-cammino: un bersaglio a frazione `s` di lato porta `s*s` dei pixel e
// non puo' costarne piu' di `s*s` piu' un decimo. A tre quarti fa 0,66 contro i
// 0,48 letti. Un numero fisso a 0,45 -- tarato sul mezzo lato -- avrebbe
// dichiarato DIFETTO la scala che si spedisce, che e' il modo in cui una
// guardia stantia costringe a spegnerla invece che a crederle.
const CEILING = AT_TODAY.scala * AT_TODAY.scala + 0.10;
report.check(quota <= CEILING,
  `e cio che il banco ha letto: la terra a ${AT_TODAY.scala} di lato costa al piu' `
  + `${CEILING.toFixed(2)} del disegno nativo`,
  `${AT_TODAY.prima} -> ${AT_TODAY.dopo} + ${AT_TODAY.ricomposizione} di `
  + `ricomposizione = ${(100 * quota).toFixed(0)}% del disegno di prima`);

if (process.argv.includes('--self')) {
  const casi = [];
  // LA RICEVUTA E' UN PREDICATO CON UN NOME, non un letterale scritto una volta
  // e riletto per anni (E-GUARDIA4): il --self la chiama sulle stesse letture
  // piegate nei due versi, cosi' che il giorno in cui la scala si muove la riga
  // si muova con lei invece di restare vera per un mondo che non c'e' piu'.
  const quotaDi = (card) => (card.dopo + card.ricomposizione) / card.prima;
  const passa = (card) => quotaDi(card) <= card.scala * card.scala + 0.10;
  casi.push({ what: 'la scheda di oggi, che NON deve essere chiamata difetto',
    caught: passa(AT_TODAY) });
  casi.push({ what: 'la terra rimessa a piena risoluzione dentro il bersaglio ridotto',
    caught: !passa({ ...AT_TODAY, dopo: AT_TODAY.prima - AT_TODAY.ricomposizione }) });
  casi.push({ what: 'la stessa quota letta su una scheda a MEZZO lato, dove e un difetto',
    caught: !passa({ ...AT_TODAY, scala: 0.5 }) });
  casi.push({ what: 'e una ricomposizione che da sola mangia il risparmio',
    caught: !passa({ ...AT_TODAY, ricomposizione: 6.0 }) });
  let stretto = 0;
  for (const [a, b] of SLOPES) {
    const d = [0.97, 0.97 + a, 0.97 + b, 0.97 + a + b];
    for (const f of CORNERS) if (gate(d, f, 0.5, floor).some((k) => !k)) stretto += 1;
  }
  casi.push({ what: 'una tolleranza sotto lo scarto del piano (uEdge 0,5): il prato '
    + 'di sbieco torna al vicino piu prossimo e riscintilla', caught: stretto > 0 });
  casi.push({ what: 'un cancello spalancato (uEdge 1e6), che non taglia piu lo spigolo',
    caught: CORNERS.every((f) => gate(step, f, 1e6, floor).every((k) => k)) });
  casi.push({ what: 'il bersaglio della terra senza il quarto canale',
    caught: !/format: RGBAFormat/.test(alloc.replace('format: RGBAFormat', 'format: RGBFormat')) });
  casi.push({ what: 'l azzeramento lasciato al default di three',
    caught: !clearedToNothing(
      'gl.setRenderTarget(campoTarget);\ngl.render(s, c);', 'campoTarget') });
  casi.push({ what: 'e uno che azzera a UNO, che e il default travestito da scelta',
    caught: !clearedToNothing(
      'gl.setClearAlpha(1);\ngl.setRenderTarget(campoTarget);', 'campoTarget') });
  casi.push({ what: 'e uno rimesso a uno DOPO l azzeramento e prima del legame',
    caught: !clearedToNothing(
      'gl.setClearAlpha(0);\ngl.setClearAlpha(1);\ngl.setRenderTarget(campoTarget);',
      'campoTarget') });
  casi.push({ what: 'e un COMMENTO scritto fra l azzeramento e il legame non e un difetto',
    caught: clearedToNothing(POST.replace('gl.setRenderTarget(campoTarget);',
      '// perche\' il bersaglio arriva vuoto e non pieno di terra\n'
      + '      gl.setRenderTarget(campoTarget);'), 'campoTarget') });
  casi.push({ what: 'e l azzeramento del mondo mai rimesso dopo il disegno',
    caught: !putBackAfterTheWorld(
      'const keptAlpha = gl.getClearAlpha();\ngl.render(worldScene, worldCamera);') });
  casi.push({ what: 'la ricomposizione rimessa in fusione NORMALE',
    caught: !/blending: CustomBlending/.test(body.replace('blending: CustomBlending', 'blending: NormalBlending')) });
  casi.push({ what: 'le due maglie in due posti diversi dell ordine',
    caught: (() => {
      const o = [10, 11];
      return !(o.length === 2 && o[0] === o[1]);
    })() });
  casi.push({ what: 'un tier che non dichiara il pixel della terra',
    caught: [{ id: 'x' }].some((t) => typeof t.campoScale !== 'number') });

  // =====================================================================
  // I LETTORI, NEI TRE VERSI CHE CONTANO.
  //
  // Ogni lettore di questa guardia che deve ancora guardare un SORGENTE viene
  // provato tre volte: la consegna passa, il difetto vero e' preso, e LA STESSA
  // COSA RISCRITTA passa lo stesso. Il terzo caso e' quello nuovo ed e' quello
  // che conta: e' il caso che sarebbe andato rosso prima, con tutto il deposito
  // in ordine e nessuno in errore, ed e' la ragione per cui questa cartella
  // aveva una guardia che si rompeva su `npm update`.
  // =====================================================================

  // (a) LA REGOLA DI three CHE AZZERA AD ALFA UNO.
  casi.push({ what: 'three che smette di azzerare ad alfa uno: allora il rimedio non serve piu',
    caught: !clearsOpaqueToOne(THREE.replace(/clearAlpha = alpha === true \? 0 : 1/,
      'clearAlpha = 0')) });
  casi.push({ what: 'e la STESSA regola minificata, che e cio che un aggiornamento corretto fa',
    caught: clearsOpaqueToOne('let clearAlpha=alpha?0:1;') });
  casi.push({ what: 'e riscritta col verso opposto e le due costanti scambiate',
    caught: clearsOpaqueToOne('\tlet   clearAlpha = !alpha ? 1 : 0 ;\n') });
  casi.push({ what: 'e la three che sta in questo albero la porta',
    caught: clearsOpaqueToOne(THREE) });

  // (b) LA REGOLA DI three CHE SPEGNE LA FUSIONE DEGLI OPACHI.
  const OPAQUE = '( material.blending === NormalBlending && material.transparent === false )\n'
    + '\t\t\t? setBlending( NoBlending )';
  casi.push({ what: 'three che smette di spegnere la fusione degli opachi',
    caught: !killsBlendingOnOpaqueNormal(THREE.replace(OPAQUE, '? setBlending( NoBlending )')) });
  casi.push({ what: 'e la stessa regola coi due termini scambiati e le graffe al posto del ternario',
    caught: killsBlendingOnOpaqueNormal(
      'if ( material.transparent === false && material.blending === NormalBlending ) '
      + '{ setBlending( NoBlending ); } else { setBlending( material.blending ); }') });
  casi.push({ what: 'e minificata, senza uno spazio dentro le parentesi',
    caught: killsBlendingOnOpaqueNormal(
      '(material.blending===NormalBlending&&material.transparent===false)?setBlending(NoBlending):s(m)') });
  casi.push({ what: 'e la three che sta in questo albero la porta',
    caught: killsBlendingOnOpaqueNormal(THREE) });

  // (c) IL LIVELLO RIMESSO AL MONDO.
  casi.push({ what: 'il livello tolto al mondo e mai rimesso',
    caught: !givesTheLayerBack(POST.replace(
      'else worldCamera.layers.enable(CAMPO_LAYER);', '')) });
  casi.push({ what: 'e rimesso da un altro bivio, che non e lo stesso bivio',
    caught: !givesTheLayerBack(
      'if (campoing) worldCamera.layers.disable(CAMPO_LAYER);\n'
      + 'if (tier.id === "basso") worldCamera.layers.enable(CAMPO_LAYER);') });
  casi.push({ what: 'e lo STESSO bivio con le graffe, che e come lo si riscrive',
    caught: givesTheLayerBack(
      'if (campoing) {\n  worldCamera.layers.disable(CAMPO_LAYER);\n} else {\n'
      + '  worldCamera.layers.enable(CAMPO_LAYER);\n}') });
  casi.push({ what: 'e con la condizione negata e i due rami scambiati',
    caught: givesTheLayerBack(
      'if (!campoing) worldCamera.layers.enable(CAMPO_LAYER);\n'
      + 'else worldCamera.layers.disable(CAMPO_LAYER);') });

  // (d) IL PASSAGGIO CHE ESISTE SOLO SOTTO A UNO.
  casi.push({ what: 'un passaggio che esiste anche a scala uno',
    caught: !passOnlyUnderOne('const campoing = campoSeats > 0;') });
  casi.push({ what: 'e la stessa condizione senza uno spazio e con le parentesi',
    caught: passOnlyUnderOne('const campoing=(campoScale<1)&&(campoSeats>0);')
      || passOnlyUnderOne('const campoing=campoScale<1&&campoSeats>0;') });

  // (e) IL PIXEL DEL SOTTO-CAMPIONAMENTO, CHIESTO AL VALORE.
  //
  // Non c'e' un sorgente da piegare qui: si piega il BERSAGLIO, che e' cio' che
  // il disegno legge. Un campo che filtrasse come se avesse la tela intera
  // mentre marcia in un buffer di mezzo lato darebbe lo STESSO numero nei due
  // casi, ed e' esattamente la cosa che alias per costruzione.
  casi.push({ what: 'un pixel che non segue il bersaglio: mezzo lato e la tela danno lo stesso numero',
    caught: !(Math.abs(pixelScaleWith({ width: SCREEN.width, height: SCREEN.height })
      / pixelScaleWith(null) - 2) < 1e-9) });
  casi.push({ what: 'e un bersaglio senza altezza non lascia il campo con una scala di zero',
    caught: pixelScaleWith({ width: 0, height: 0 }) > 0 });
  casi.push({ what: 'e il bersaglio di mezzo lato raddoppia il pixel, che e la promessa',
    caught: Math.abs(pixelScaleWith({ width: SCREEN.width / 2, height: SCREEN.height / 2 })
      / pixelScaleWith(null) - 2) < 1e-9 });

  selfTest('guard-campo3', casi);
}

report.end();
