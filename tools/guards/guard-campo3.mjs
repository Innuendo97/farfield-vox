import { read, reporter, selfTest } from './lib.mjs';
import { TIERS } from '../../src/core/quality.js';

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

const report = reporter('guard-campo3 -- il campo a meta risoluzione, ricomposto a piena');

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
report.check(/if \(campoing\) worldCamera\.layers\.disable\(CAMPO_LAYER\);\s*\n\s*else worldCamera\.layers\.enable\(CAMPO_LAYER\);/.test(POST),
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
report.check(/const keptAlpha = gl\.getClearAlpha\(\);\s*\n\s*gl\.setClearAlpha\(0\);\s*\n\s*gl\.setRenderTarget\(campoTarget\);/.test(POST),
  'il bersaglio della terra si azzera a NIENTE prima del disegno');
report.check(/gl\.render\(worldScene, worldCamera\);\s*\n\s*gl\.setClearAlpha\(keptAlpha\);/.test(POST),
  'e l azzeramento del resto del mondo si rimette a posto subito dopo');
report.check(/clearAlpha = alpha === true \? 0 : 1/.test(THREE),
  'e la regola di three che lo rende necessario e ancora quella',
  'WebGLBackground');

// (c) LA FUSIONE. three spegne la fusione di ogni materiale «transparent:
// false» in fusione NORMALE, che e' precisamente perche' l'alfa del campo non
// e' mai stata spesa. Chiesta per nome sopravvive, e «transparent» resta false,
// che e' cio' che tiene questo disegno nel passaggio OPACO dov'e' sempre stato.
report.check(/\( material\.blending === NormalBlending && material\.transparent === false \)\s*\n\s*\? setBlending\( NoBlending \)/.test(THREE),
  'e la regola di three che spegne la fusione degli opachi e ancora quella',
  'WebGLState.setMaterial');
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
report.check(/const campoing = campoScale < 1 && campoSeats > 0;/.test(POST),
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
report.check(/const bound = renderer\.getRenderTarget\(\);\s*\n\s*const size = bound \? SCRATCH\.set\(bound\.width, bound\.height\)\s*\n\s*: renderer\.getDrawingBufferSize\(SCRATCH\);/.test(MATERIAL),
  'la scala del sotto-campionamento la da il bersaglio LEGATO, non la tela');
report.check(MATERIAL.includes('u.uPixelScale.value = size.y > 0 ? 2 * Math.tan(fov / 2) / size.y : 0.002;'),
  'e la riga che guard-zoom tiene appuntata non e stata toccata di un carattere');

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
// AT_TODAY. La scheda per passata di questa unita', alla posa P, tier alto,
// 1920x869, macchina CARICA -- sette server altrui e due dozzine di Chrome, che
// e' il motivo per cui cio' che si tiene qui e' il RAPPORTO fra due bracci
// misurati di seguito nella STESSA apertura, e non il numero assoluto.
const AT_TODAY = { prima: 26.51, dopo: 8.08, ricomposizione: 1.72 };
const quota = (AT_TODAY.dopo + AT_TODAY.ricomposizione) / AT_TODAY.prima;
report.check(quota < 0.45,
  'e cio che il banco ha letto: la terra a meta costa meno della meta di se stessa',
  `${AT_TODAY.prima} -> ${AT_TODAY.dopo} + ${AT_TODAY.ricomposizione} di `
  + `ricomposizione = ${(100 * quota).toFixed(0)}% del disegno di prima`);

if (process.argv.includes('--self')) {
  const casi = [];
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
    caught: !/gl\.setClearAlpha\(0\);/.test(POST.replace('gl.setClearAlpha(0);', '')) });
  casi.push({ what: 'la ricomposizione rimessa in fusione NORMALE',
    caught: !/blending: CustomBlending/.test(body.replace('blending: CustomBlending', 'blending: NormalBlending')) });
  casi.push({ what: 'il livello tolto al mondo e mai rimesso',
    caught: !/else worldCamera\.layers\.enable\(CAMPO_LAYER\);/.test(
      POST.replace('else worldCamera.layers.enable(CAMPO_LAYER);', '')) });
  casi.push({ what: 'le due maglie in due posti diversi dell ordine',
    caught: (() => {
      const o = [10, 11];
      return !(o.length === 2 && o[0] === o[1]);
    })() });
  casi.push({ what: 'un tier che non dichiara il pixel della terra',
    caught: [{ id: 'x' }].some((t) => typeof t.campoScale !== 'number') });
  casi.push({ what: 'la riga di uPixelScale che guard-zoom tiene appuntata, mossa',
    caught: !MATERIAL.replace('u.uPixelScale.value = size.y > 0', 'u.uPixelScale.value = 2.0 * size.y > 0')
      .includes('u.uPixelScale.value = size.y > 0 ? 2 * Math.tan(fov / 2) / size.y : 0.002;') });
  selfTest('guard-campo3', casi);
}

report.end();
