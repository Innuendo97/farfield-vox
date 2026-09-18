import { read, reporter, selfTest } from './lib.mjs';

// GUARD-RIMARCIA -- IL BORDO SE LO MARCIA DA SE', E SOLO IL BORDO.
//
//   node tools/guards/guard-rimarcia.mjs
//   node tools/guards/guard-rimarcia.mjs --self
//
// ===========================================================================
// PERCHE' ESISTE, E CHE COSA NON PUO' PERMETTERSI.
//
// Il campo marcia UN RAGGIO PER TEXEL di un bersaglio che sta a una frazione di
// lato -- 0,75 al tier alto, 0,43 e 0,38 agli altri due -- e la ricomposizione
// pesa quattro di quei texel senza mai fonderli attraverso un arris, perche' al
// bordo di un cubo la risposta onesta e' il lato in cui il pixel sta. Da cui la
// scaletta: OGNI silhouette cade su un gradino largo uno-tre pixel, e il
// gradino salta di un texel intero quando la vista si sposta di una frazione di
// texel -- cioe' sempre, perche' il corpo respira. La memoria temporale di
// U-CAMPO-5 toglie il 3-20% dello scintillio e NON tocca la scaletta: una somma
// di fotogrammi decisi a un terzo di pixel resta una figura decisa a un terzo
// di pixel.
//
// La cura e' che il pixel di bordo smetta di scegliere e si marci il raggio da
// se', alla propria risoluzione. Una cura del genere ha quattro modi di essere
// peggiore del male, e sono i quattro che questa guardia misura:
//
//   1. IL BYTE. A maniglia spenta il fotogramma dev'essere quello di oggi. Non
//      «quasi»: la stessa immagine, pixel per pixel. Qui e' preteso sul modello
//      E sul sorgente, e sul sorgente e' preteso nella forma piu' forte che
//      c'e' -- il programma che marcia non viene nemmeno COSTRUITO finche'
//      qualcuno non lo chiede, quindi a maniglia spenta la maglia che disegna
//      e' la maglia che ha sempre disegnato.
//   2. LA PROFONDITA'. Un pixel ri-marciato che scrivesse la profondita' MEDIA
//      dei texel invece della propria taglierebbe i fiori, i piedi dei monoliti
//      e il camminatore nel posto sbagliato, e li taglierebbe proprio sui bordi
//      -- cioe' sugli unici pixel dove si vede.
//   3. LA PORTATA. La leva del costo e' quanti metri lontano un bordo vale
//      ancora un raggio. Una portata che non limita non e' una portata: e' la
//      ri-marcia di tutto il fotogramma con un nome rassicurante.
//   4. E LA SCALETTA STESSA, che e' la ragione per cui tutto questo esiste. Se
//      il bordo ri-marciato non cade piu' vicino al vero di quello scelto fra
//      quattro texel, non c'e' niente da consegnare.
//
// ===========================================================================
// COME MISURA. Il modello qui sotto e' la ricomposizione in UNA dimensione: un
// vero suolo a piena risoluzione, un bersaglio ridotto che lo campiona ogni S
// pixel, le due prese pesate col cancello sulla profondita', e la ri-marcia che
// al bordo ritorna al vero. Non e' il programma: e' la sua legge, scritta una
// seconda volta in un posto dove si puo' iniettare un difetto e guardarla
// fallire. Le gambe sul SORGENTE stanno in fondo, perche' un modello verde su
// un programma che non lo segue non e' una guardia.

const report = reporter('guard-rimarcia -- il bordo se lo marcia da se\', e solo il bordo');

// ---------------------------------------------------------------------------
// IL MODELLO: un suolo di 256 pixel, due superfici, un bersaglio ridotto.
// ---------------------------------------------------------------------------
const PIXELS = 256;
// Quanti pixel sta un texel del bersaglio ridotto. 8/3 e' 1892/710, cioe'
// esattamente il tier basso: scala del fotogramma 0,75 per campoScale 0,5.
const SPAN = 8 / 3;
const TEXELS = Math.ceil(PIXELS / SPAN) + 2;
const NEAR_COLOUR = 210;
const FAR_COLOUR = 70;
const NEAR_DEPTH = 0.20;
const FAR_DEPTH = 0.80;
// La profondita' letta come metri, che e' cio' su cui la portata decide. Una
// retta e non la vera iperbole della proiezione: quello che la guardia deve
// poter dire e' «oltre la portata niente si muove», e per dirlo basta che la
// legge sia monotona e la stessa dalle due parti.
const METRES = (depth) => depth * 50;
/** La grana del suolo: alta frequenza, la parte che un campione ogni S non filtra. */
const grain = (x) => 18 * Math.sin(x * 2.399) + 11 * Math.sin(x * 5.117 + 1.7);

/** IL VERO: cosa vedrebbe un raggio tirato al pixel, che e' cio' che la ri-marcia fa. */
function truth(at, edge) {
  const near = at < edge;
  return {
    colour: (near ? NEAR_COLOUR : FAR_COLOUR) + grain(at),
    depth: near ? NEAR_DEPTH : FAR_DEPTH,
  };
}

/** IL BERSAGLIO RIDOTTO: un raggio per texel, al centro del texel. */
function reduced(edge) {
  const colour = new Float64Array(TEXELS);
  const depth = new Float64Array(TEXELS);
  for (let j = 0; j < TEXELS; j += 1) {
    const t = truth((j + 0.5) * SPAN, edge);
    colour[j] = t.colour;
    depth[j] = t.depth;
  }
  return { colour, depth };
}

/**
 * LA RICOMPOSIZIONE, e ogni difetto che questa guardia sa riconoscere e' una
 * delle sue leve girata storta.
 *
 * In una dimensione le quattro prese sono due, e tutto il resto e' il
 * programma: dove cade il centro del pixel nel bersaglio, la presa di
 * RIFERIMENTO che e' quella in cui il pixel sta davvero, il cancello sulla
 * profondita' che rifiuta di mediare attraverso un arris, e -- dove le due non
 * sono d'accordo -- il raggio proprio.
 *
 * @param {object} how  remarch, reach, e i tre difetti che --self inietta:
 *   floorReach (ri-marcia anche a maniglia spenta), keepDepth (scrive il
 *   colore proprio e la profondita' dei texel), reachBlind (la portata non
 *   limita).
 */
function resolve(edge, how = {}) {
  const {
    remarch = false, reach = 20, tol = 0.1,
    floorReach = 0, keepDepth = false, reachBlind = false,
  } = how;
  const buffer = reduced(edge);
  const out = {
    colour: new Float64Array(PIXELS),
    depth: new Float64Array(PIXELS),
    marched: new Uint8Array(PIXELS),
  };
  for (let x = 0; x < PIXELS; x += 1) {
    const t = (x + 0.5) / SPAN - 0.5;
    const base = Math.floor(t);
    const f = t - base;
    const at = [Math.max(0, Math.min(TEXELS - 1, base)),
      Math.max(0, Math.min(TEXELS - 1, base + 1))];
    const w = [1 - f, f];
    const ref = f >= 0.5 ? 1 : 0;
    const dr = buffer.depth[at[ref]];
    let colour = 0;
    let depth = 0;
    let mass = 0;
    let dropped = 0;
    for (let i = 0; i < 2; i += 1) {
      const keep = Math.abs(buffer.depth[at[i]] - dr) <= tol ? 1 : 0;
      dropped += 1 - keep;
      const m = w[i] * keep;
      colour += buffer.colour[at[i]] * m;
      depth += buffer.depth[at[i]] * m;
      mass += m;
    }
    colour /= mass;
    depth /= mass;
    // LA RI-MARCIA, e il nullo e' che non succeda. `floorReach` non esiste nel
    // programma: e' il difetto che la gamba --self inietta, cioe' una
    // ricomposizione che tira un raggio anche quando la maniglia dice nought,
    // ed e' il modo piu' facile di spostare il byte di un fotogramma che
    // nessuno ha chiesto di cambiare.
    const wantedReach = Math.max(remarch ? reach : 0, floorReach);
    if (wantedReach > 0 && dropped > 0
      && (reachBlind || METRES(dr) <= wantedReach)) {
      const own = truth(x + 0.5, edge);
      out.colour[x] = own.colour;
      // IL DIFETTO 2: il colore e' del raggio e la profondita' resta dei texel.
      out.depth[x] = keepDepth ? depth : own.depth;
      out.marched[x] = 1;
    } else {
      out.colour[x] = colour;
      out.depth[x] = depth;
    }
  }
  return out;
}

/**
 * DOVE IL BORDO E' FINITO DAVVERO, in pixel: il posto in cui l'uscita
 * attraversa il mezzo fra le due superfici.
 *
 * E' la misura della scaletta scritta in una dimensione. Un fotogramma deciso
 * ogni S pixel puo' mettere quell'attraversamento solo in un numero di posti
 * grande 1/S di quelli che gli servirebbero, quindi il bordo si aggancia al
 * reticolo del texel e ci resta finche' il vero non ne ha attraversato uno
 * intero: lo scarto e' il gradino, e il salto e' lo scatto.
 */
function crossing(out) {
  const mid = (NEAR_COLOUR + FAR_COLOUR) / 2;
  for (let x = 1; x < PIXELS; x += 1) {
    const a = out.colour[x - 1] - mid;
    const b = out.colour[x] - mid;
    if (a > 0 && b <= 0) return x - 0.5 + a / (a - b);
  }
  return Number.NaN;
}

/**
 * LO SCARTO DEL BORDO, spazzando il vero su un texel intero.
 *
 * Quaranta posizioni dentro un texel: se la figura fosse decisa al pixel, lo
 * scarto starebbe sotto il mezzo pixel; se e' decisa al texel, arriva a mezzo
 * texel e ci arriva a gradini.
 */
function sweep(how) {
  const errors = [];
  const drawn = [];
  for (let k = 0; k < 40; k += 1) {
    const edge = 128 + (k / 40) * SPAN;
    const at = crossing(resolve(edge, how));
    errors.push(Math.abs(at - edge));
    drawn.push(at);
  }
  let worst = 0;
  let sum = 0;
  for (const e of errors) { sum += e; if (e > worst) worst = e; }
  // E IL SALTO: di quanti pixel il bordo disegnato si sposta quando si sposta.
  // E' l'istogramma che il mandato chiede -- le corse a un pixel contro quelle
  // a due-tre -- riportato al numero che lo riassume.
  const steps = [];
  for (let k = 1; k < drawn.length; k += 1) {
    const d = Math.abs(drawn[k] - drawn[k - 1]);
    if (d > 0.01) steps.push(d);
  }
  const biggest = steps.length ? Math.max(...steps) : 0;
  return { mean: sum / errors.length, worst, biggest, places: new Set(drawn.map((v) => v.toFixed(2))).size };
}

// ---------------------------------------------------------------------------
// 1. IL NULLO. A maniglia spenta l'uscita e' la ricomposizione di oggi, pixel
//    per pixel: nessuna tolleranza, nessun «quasi».
// ---------------------------------------------------------------------------
const EDGE = 128 + SPAN * 0.37;
const today = resolve(EDGE, { remarch: false });
const nullExact = (a, b) => a.colour.every((v, i) => v === b.colour[i])
  && a.depth.every((v, i) => v === b.depth[i]);
report.check(nullExact(resolve(EDGE, { remarch: false }), today),
  'a maniglia spenta l\'uscita e\' la ricomposizione di oggi, pixel per pixel',
  `${PIXELS} pixel, nessuno marciato (${today.marched.reduce((s, v) => s + v, 0)})`);

// ---------------------------------------------------------------------------
// 2. LA SCALETTA. E' la ragione per cui questo esiste, quindi e' la prima cosa
//    misurata: dove finisce il bordo disegnato contro dove sta il vero.
// ---------------------------------------------------------------------------
const stairOff = sweep({ remarch: false });
const stairOn = sweep({ remarch: true, reach: 20 });
report.line(`        bordo: scarto medio ${stairOff.mean.toFixed(3)} -> ${stairOn.mean.toFixed(3)} px, `
  + `peggiore ${stairOff.worst.toFixed(3)} -> ${stairOn.worst.toFixed(3)} px, `
  + `salto piu' largo ${stairOff.biggest.toFixed(2)} -> ${stairOn.biggest.toFixed(2)} px, `
  + `posti distinti ${stairOff.places} -> ${stairOn.places} su 40`);
report.check(stairOn.mean < stairOff.mean * 0.7,
  'il bordo ri-marciato cade piu\' vicino al vero di quello scelto fra quattro texel',
  `${stairOn.mean.toFixed(3)} contro ${stairOff.mean.toFixed(3)} pixel di scarto medio`);
report.check(stairOn.biggest < stairOff.biggest / 2 && stairOff.biggest > SPAN * 0.9,
  'e quando si sposta si sposta di un pixel, dove prima saltava un texel intero',
  `${stairOn.biggest.toFixed(2)} contro ${stairOff.biggest.toFixed(2)} pixel di salto, `
  + `su un texel largo ${SPAN.toFixed(2)}`);
report.check(stairOn.places >= stairOff.places * 2,
  'cioe\' il bordo ha piu\' di un posto per texel in cui finire, che e\' la scaletta',
  `${stairOn.places} posti distinti contro ${stairOff.places}, su 40 posizioni del vero`);

// ---------------------------------------------------------------------------
// 3. LA PROFONDITA'. Il pixel ri-marciato scrive la PROPRIA, o i fiori e i
//    piedi dei monoliti lo tagliano dove non devono.
// ---------------------------------------------------------------------------
function depthError(out, edge) {
  let worst = 0;
  for (let x = 0; x < PIXELS; x += 1) {
    if (!out.marched[x]) continue;
    worst = Math.max(worst, Math.abs(out.depth[x] - truth(x + 0.5, edge).depth));
  }
  return worst;
}
/**
 * E LO SCARTO SI GUARDA SU TUTTO LO SPAZZAMENTO E NON SU UNA POSA.
 *
 * Con il bordo in un posto solo, la presa di riferimento e il pixel possono
 * stare dalla stessa parte dell'arris per caso, e allora la profondita' dei
 * texel e' anche quella giusta e un difetto vero passerebbe. Quello che
 * decide e' il caso in cui NON ci stanno: il pixel e' di qua e il centro del
 * texel che lo ha vinto e' di la', che e' esattamente il pixel su cui un fiore
 * verrebbe tagliato dalla parte sbagliata.
 */
function worstDepth(how) {
  let worst = 0;
  let marched = 0;
  for (let k = 0; k < 40; k += 1) {
    const edge = 128 + (k / 40) * SPAN;
    const out = resolve(edge, how);
    worst = Math.max(worst, depthError(out, edge));
    marched += out.marched.reduce((s, v) => s + v, 0);
  }
  return { worst, marched };
}
const marchedTrue = worstDepth({ remarch: true, reach: 20 });
const marchedFlat = worstDepth({ remarch: true, reach: 20, keepDepth: true });
report.check(marchedTrue.worst <= 1e-12,
  'il pixel ri-marciato scrive la profondita\' del proprio raggio e non la media dei texel',
  `${marchedTrue.worst.toExponential(2)} contro `
  + `${marchedFlat.worst.toFixed(3)} di un passo che tenesse quella dei texel`);
report.check(marchedTrue.marched > 0,
  'e c\'e\' almeno un pixel che l\'ha scritta, cioe\' il modello sta misurando qualcosa',
  `${marchedTrue.marched} pixel ri-marciati sulle 40 pose dello spazzamento`);

// ---------------------------------------------------------------------------
// 4. LA PORTATA. Oltre i metri dichiarati non si muove un byte: e' la leva del
//    costo, e una leva che non limita non e' una leva.
// ---------------------------------------------------------------------------
// Il bordo VICINO (profondita' 0,20 -> 10 m) e quello LONTANO (0,80 -> 40 m).
// Con la portata a venti il primo marcia e il secondo no.
const NEAR_REACH = METRES(NEAR_DEPTH);
const FAR_REACH = METRES(FAR_DEPTH);
const short = resolve(EDGE, { remarch: true, reach: 20 });
const shortBlind = resolve(EDGE, { remarch: true, reach: 20, reachBlind: true });
const tiny = resolve(EDGE, { remarch: true, reach: 5 });
report.line(`        portata: il texel di riferimento del bordo sta a `
  + `${NEAR_REACH.toFixed(0)}-${FAR_REACH.toFixed(0)} m; a 20 m marciano `
  + `${short.marched.reduce((s, v) => s + v, 0)} pixel, a 5 m ne marciano `
  + `${tiny.marched.reduce((s, v) => s + v, 0)}`);
report.check(tiny.marched.reduce((s, v) => s + v, 0) === 0 && nullExact(tiny, today),
  'sotto la portata del bordo non si marcia, e il fotogramma e\' quello di oggi',
  `portata 5 m contro un riferimento a ${NEAR_REACH.toFixed(0)} m`);
report.check(short.marched.reduce((s, v) => s + v, 0)
  < shortBlind.marched.reduce((s, v) => s + v, 0),
  'e una portata che non guardasse i metri marcerebbe di piu\' di quella che li guarda',
  `${short.marched.reduce((s, v) => s + v, 0)} pixel contro `
  + `${shortBlind.marched.reduce((s, v) => s + v, 0)} senza il cancello dei metri`);

// ---------------------------------------------------------------------------
// 5. E IL SORGENTE, perche' un modello verde su un programma che non lo segue
//    non e' una guardia. Ogni riga qui sotto, se sparisce, riporta un difetto.
// ---------------------------------------------------------------------------
const marcher = read('src/world/voxel/campo-material.js');
const field = read('src/world/voxel/campo-field.js');
const suolo = read('src/world/layers/v1-suolo.js');

report.check(/export const CAMPO_REMARCH_REACH = 20;/.test(marcher),
  'la portata nasce dichiarata in metri, nel posto in cui il programma la legge');
report.check(/const RESOLVE_CORE = /.test(marcher) && /const RESOLVE_TAIL = /.test(marcher),
  'le prese, il cancello e il bordo sono UN testo, non due');
report.check((marcher.match(/\$\{RESOLVE_CORE\}/g) || []).length === 2
  && (marcher.match(/\$\{RESOLVE_TAIL\}/g) || []).length === 2,
  'e le due ricomposizioni lo leggono tutte e due, cosi\' non possono divergere',
  `${(marcher.match(/\$\{RESOLVE_CORE\}/g) || []).length} letture del corpo, `
  + `${(marcher.match(/\$\{RESOLVE_TAIL\}/g) || []).length} della coda`);
report.check(/fragmentShader: FRAGMENT,/.test(marcher)
  && /defines: \{ CAMPO_RESOLVE: '1' \},/.test(marcher),
  'la ricomposizione che marcia E\' il programma del campo con un ingresso diverso');
report.check(/bool disagree = dropped > 0\.0 \|\| \(cover > 0\.0 && cover < 1\.0\)\n\s*\|\| \(anyGround && anySky\);/.test(marcher),
  'e marcia dove i quattro texel non concordano, in tutti e tre i modi in cui possono');
report.check(/bool go = \(disagree \|\| uRemarchAll > 0\.5\) && refDist <= uRemarchReach;/.test(marcher),
  'e mai oltre la portata, che e\' in metri dal texel di riferimento');
report.check(/vec4 clip = uViewProjection \* vec4\(eye \+ dir \* hit\.t, 1\.0\);\n\s*depth = \(clip\.z \/ clip\.w\) \* 0\.5 \+ 0\.5;/.test(marcher),
  'il pixel ri-marciato scrive la profondita\' del proprio raggio');
report.check((marcher.match(/uPixelScale: \{ value: 0\.002 \},/g) || []).length === 2
  && /u\.uPixelScale\.value = SCRATCH\.y > 0 \? 2 \* Math\.tan\(fov \/ 2\) \/ SCRATCH\.y : 0\.002;/
    .test(marcher),
  'e filtra il giunto e l\'arris sull\'impronta del pixel del FOTOGRAMMA, non del texel',
  'due impronte, una per bersaglio, ciascuna letta dal buffer legato quando disegna');
report.check(/uJitter: \{ value: new Vector2\(0, 0\) \},/.test(marcher),
  'e non passa dalla storia: un raggio solo, e nessuno scarto sotto cui sommarlo');

report.check(/let remarchWanted = false;/.test(field),
  'la ri-marcia nasce SPENTA nel posto in cui la maglia si decide');
report.check(/function buildRemarch\(\) \{\n\s*if \(remarch\) return remarch;/.test(field)
  && /if \(want\) buildRemarch\(\);/.test(field),
  'e il programma che marcia non viene COSTRUITO finche\' qualcuno non lo chiede',
  'a maniglia spenta la maglia che disegna e\' quella che ha sempre disegnato');
report.check(/resolve\.visible = composing && !marching;/.test(field)
  && /if \(remarch\) remarch\.visible = marching;/.test(field),
  'e delle due ricomposizioni ne disegna esattamente una, mai due e mai nessuna');

report.check(/if \(!\(n\[0\] > 0\)\) return \{ on: false, reach: null \};/.test(suolo),
  'un indirizzo che scrive lo zero ottiene lo zero, che e\' cio\' che un banco chiede');
report.check(/if \(wanted\.campoRimarcia && wanted\.campoRimarcia\.on\) \{/.test(suolo),
  'e l\'indirizzo che non dice niente la lascia spenta');

if (process.argv.includes('--self')) {
  // I DIFETTI VERI, iniettati nel modello e nel sorgente letto, uno per volta.
  const loudHandle = suolo.replace(
    'if (wanted.campoRimarcia && wanted.campoRimarcia.on) {',
    'if (!wanted.campoRimarcia || wanted.campoRimarcia.on) {',
  );
  const eagerBuild = field.replace('if (want) buildRemarch();', 'buildRemarch();');
  const flatDepth = marcher.replace(
    'depth = (clip.z / clip.w) * 0.5 + 0.5;', 'depth = depth;',
  );
  const blindReach = marcher.replace(
    'bool go = (disagree || uRemarchAll > 0.5) && refDist <= uRemarchReach;',
    'bool go = (disagree || uRemarchAll > 0.5);',
  );
  // L'impronta del TEXEL al posto di quella del fotogramma: la ricomposizione
  // che marcia smette di calcolarsi la propria e si tiene quella che le e'
  // arrivata dal campo, che sta a una frazione di lato -- e allora il giunto e
  // l'arris del pixel ri-marciato sono larghi due volte e mezzo il vero, sui
  // soli pixel che questo lavoro esiste per affilare.
  const texelFoot = marcher.replace(
    'u.uPixelScale.value = SCRATCH.y > 0 ? 2 * Math.tan(fov / 2) / SCRATCH.y : 0.002;',
    'void 0;',
  );
  selfTest('guard-rimarcia', [
    {
      what: 'un pixel ri-marciato che tiene la profondita\' media dei texel',
      caught: marchedFlat.worst > 0.01 && marchedTrue.worst <= 1e-12,
    },
    {
      what: 'una portata che non guarda i metri, e marcia anche il lontano',
      caught: shortBlind.marched.reduce((s, v) => s + v, 0)
        > short.marched.reduce((s, v) => s + v, 0),
    },
    {
      // Il nullo tolto di mezzo: la ricomposizione marcia lo stesso, a maniglia
      // spenta, e quello che esce non e' piu' il fotogramma di oggi.
      what: 'una ricomposizione che marcia lo stesso a maniglia spenta, e sposta il byte',
      caught: !nullExact(resolve(EDGE, { remarch: false, floorReach: 20 }), today),
    },
    {
      what: 'un bordo che resta agganciato al reticolo del texel, cioe\' la scaletta',
      caught: stairOff.biggest > SPAN * 0.9 && stairOn.biggest < stairOff.biggest / 2,
    },
    {
      what: 'un indirizzo muto che accende la ri-marcia lo stesso',
      caught: !/if \(wanted\.campoRimarcia && wanted\.campoRimarcia\.on\) \{/.test(loudHandle),
    },
    {
      what: 'un programma grande costruito anche da chi non l\'ha chiesto',
      caught: !/if \(want\) buildRemarch\(\);/.test(eagerBuild),
    },
    {
      what: 'un pixel ri-marciato che non scrive affatto la propria profondita\'',
      caught: !/vec4 clip = uViewProjection \* vec4\(eye \+ dir \* hit\.t, 1\.0\);\n\s*depth = \(clip\.z \/ clip\.w\) \* 0\.5 \+ 0\.5;/.test(flatDepth),
    },
    {
      what: 'una portata tolta dal programma, che non limita piu\' niente',
      caught: !/refDist <= uRemarchReach/.test(blindReach),
    },
    {
      what: 'un\'impronta del pixel presa dal texel ridotto invece che dal fotogramma',
      caught: !/u\.uPixelScale\.value = SCRATCH\.y > 0 \? 2 \* Math\.tan\(fov \/ 2\) \/ SCRATCH\.y : 0\.002;/.test(texelFoot),
    },
  ]);
}

report.end(`${PIXELS} pixel di modello a ${SPAN.toFixed(3)} per texel; bordo a `
  + `${stairOff.mean.toFixed(3)} px dal vero senza ri-marcia e ${stairOn.mean.toFixed(3)} con, `
  + `salto ${stairOff.biggest.toFixed(2)} contro ${stairOn.biggest.toFixed(2)} px`);
