import {
  askedCornice, corniceOf, coverAt, distanceTo, FEATHER, MARGIN, MARGIN_WHOLE, OFF, RADIUS,
} from '../../src/core/cornice.js';
import { frameOf } from '../../src/core/inquadratura.js';
import { read, reporter, selfTest } from './lib.mjs';

// GUARD-CORNICE-VIVA -- IL QUADRO E' UN RICORDO: ANGOLI TONDI, BORDO SFUMATO,
// ALONE VIVO, E UNA NASCITA CHE NON SALTA.
//
// (NON e' guard-cornice, che esiste da un pezzo ed e' delle COLLINE: quella
// guarda che l'orizzonte non finisca dentro il quadro. Questa guarda il bordo
// del quadro stesso.)
//
// ===========================================================================
// Il committente ha guardato sito-4 e ha detto quattro cose (E-DECISIONI35).
// Tre di esse hanno una forma che si puo' perdere in una fusione e che nessuno
// si accorgerebbe di aver perso finche' non riapre la pagina:
//
//   1. LA NOTTE FERMA E' UN CIELO DI SOLE STELLE. «In caso di notte ferma non
//      devono esserci gli star trails (le strisce ferme sono sgradevoli
//      esteticamente)». Una scia e' un'ESPOSIZIONE: ferma non dice piu'
//      niente e disegna un pettine di graffi. La tela delle scie non deve
//      essere ne' dipinta ne' appesa quando il cielo non gira.
//   2. LE PALPEBRE SI APRONO DENTRO IL QUADRO. «L'occhio si apre lungo tutto lo
//      schermo e non solo nella finestra di esplorazione, questa cosa stona.»
//      La scatola delle palpebre e' il QUADRO, con la sua curvatura, e la notte
//      attorno non batte.
//   3. IL BORDO E' UN RICORDO. Angoli arrotondati, l'intero bordo sfumato, e
//      l'alone della copia sfocata del bloom in un margine attorno. Cioe': un
//      raggio maggiore di zero, una sfumatura maggiore di zero, e una tela piu'
//      grande del quadro -- mai piu' grande della finestra.
//   4. LA NASCITA NON SALTA. «Comparira' la forma della finestra esplorabile
//      all'improvviso, e questo non lo vorrei.» Il cerchio del caricamento
//      cresce fino al quadro, e SOLO DOPO l'occhio si apre.
//
// E UNA QUINTA COSA CHE NON E' SUA MA DI QUESTA CAMPAGNA: `?cornice=0` e' il
// bordo netto di sito-4, alla lettera. Su quella porta passano la prova del
// byte e tutte le guardie che fotografano il MONDO, quindi un difetto che la
// lasciasse merely QUASI netta sposterebbe in silenzio il terreno sotto
// quarantacinque altri controlli.
//
// COM'E' FATTA. L'aritmetica del bordo e' un modulo puro (src/core/cornice.js),
// quindi le regole di forma si rispondono a ogni commit e non a ogni
// screenshot. Poi il SORGENTE, per le tre proprieta' che vivono in tre file
// diversi e non in un numero. Poi la PAGINA, perche' un'aritmetica giusta che
// non arriva alla tela e' il difetto che E-LUCE5 ha spedito con trentasette
// guardie verdi -- e la pagina qui e' guardata anche in FOTOGRAFIA, sull'unico
// punto che lo merita: l'angolo del quadro dev'essere notte mentre il mezzo del
// suo lato e' mondo, che e' un angolo tondo e non si puo' dedurre da un
// sorgente.
// ===========================================================================

const WIN = { width: 1892, height: 845 };

/** Che forma ha il bordo, a parte dalla pagina, cosi' che un difetto ci si
 *  possa iniettare. Ogni campo e' una delle quattro cose qui sopra. */
export function bordo({
  finestra, tela, quadro, raggio, sfumatura,
}) {
  return {
    // La tela non esce mai dal vetro: un margine che sfora e' una barra di
    // scorrimento su una pagina che non scorre.
    dentro: tela.width <= finestra.width && tela.height <= finestra.height,
    // E il quadro sta dentro la tela con dello spazio attorno, che e' il
    // margine in cui vive l'alone.
    respiro: quadro.width < tela.width && quadro.height < tela.height,
    // Gli angoli sono tondi, e il raggio non mangia piu' di meta' del lato
    // corto -- oltre quello non e' piu' un rettangolo, e' una losanga.
    tondo: raggio > 0 && raggio <= Math.min(quadro.width, quadro.height) / 2,
    // E il bordo e' INTERAMENTE sfumato.
    sfumato: sfumatura > 0,
  };
}

/** La notte ferma, e la sola domanda che la riguarda. */
export function cielo({ gira, scie }) {
  return { senzaScie: gira ? scie === 1 : scie === 0 };
}

/** Le palpebre: dove sono e che forma hanno.
 *
 *  LA FORMA E' UN TAGLIO E NON UN RAGGIO, perche' durante la nascita le
 *  palpebre sono tagliate sulla forma che il quadro ha IN QUEL MOMENTO — un
 *  cerchio all'inizio, il rettangolo arrotondato alla fine. Il raggio che si
 *  legge e' quindi quello del taglio, e ha senso chiederlo solo a nascita
 *  finita. */
export function occhio({ scatola, quadro, raggio }) {
  return {
    sulQuadro: Math.abs(scatola.width - quadro.width) <= 1
      && Math.abs(scatola.height - quadro.height) <= 1,
    curvo: raggio > 0,
  };
}

/** La nascita, letta come la SUCCESSIONE di quanto il quadro e' cresciuto,
 *  fotogramma per fotogramma, piu' l'indice del fotogramma in cui le palpebre
 *  hanno cominciato. */
export function nascita({ passi, palpebreA }) {
  const salti = passi.slice(1).map((v, i) => v - passi[i]);
  return {
    // Parte dal cerchio e non dal quadro.
    dalCerchio: passi.length > 2 && passi[0] <= 0.05,
    // E ci arriva.
    alQuadro: passi[passi.length - 1] >= 0.999,
    // Senza mai tornare indietro.
    monotona: salti.every((d) => d >= -1e-6),
    // E senza mai saltare: nessun fotogramma copre piu' di un ottavo del
    // percorso. Con un limite di velocita' di 60 ms su 1500 (src/ui/intro.js,
    // BIRTH_STEP_CAP_MS) il passo massimo per costruzione e' un venticinquesimo,
    // quindi c'e' un fattore tre di margine su una pausa qualsiasi.
    morbida: salti.length > 0 && Math.max(...salti) <= 0.125,
    // E l'occhio si apre DOPO, che e' l'ordine che il committente ha chiesto.
    primaIlBordo: palpebreA >= 0 && passi[palpebreA] >= 0.999,
  };
}

if (process.argv.includes('--self')) {
  const buonoBordo = {
    finestra: WIN,
    tela: { width: 1616, height: 778 },
    quadro: { width: 1514, height: 676 },
    raggio: 30.4,
    sfumatura: 20.3,
  };
  const buoniPassi = Array.from({ length: 40 }, (unused, i) => Math.min(1, i / 30));
  selfTest('guard-cornice-viva', [
    {
      what: 'una notte ferma con le scie ancora appese',
      caught: !cielo({ gira: false, scie: 1 }).senzaScie,
    },
    {
      what: 'le palpebre sulla finestra invece che sul quadro, a inquadratura ridotta',
      caught: !occhio({
        scatola: { width: WIN.width, height: WIN.height },
        quadro: buonoBordo.quadro,
        raggio: 30.4,
      }).sulQuadro,
    },
    {
      what: 'una nascita che salta: dal cerchio al quadro in un fotogramma',
      caught: !nascita({ passi: [0, 0, 1, 1], palpebreA: 3 }).morbida,
    },
    {
      what: 'una maschera senza sfumatura: il bordo tondo ma netto',
      caught: !bordo({ ...buonoBordo, sfumatura: 0 }).sfumato,
    },
    {
      what: 'un margine che esce dal vetro',
      caught: !bordo({ ...buonoBordo, tela: { width: 2000, height: 900 } }).dentro,
    },
    {
      what: 'e l\'occhio che si apre mentre il bordo sta ancora crescendo',
      caught: !nascita({ passi: buoniPassi, palpebreA: 10 }).primaIlBordo,
    },
    {
      what: 'e la cornice buona passa tutte e quattro',
      caught: Object.values(bordo(buonoBordo)).every(Boolean)
        && Object.values(cielo({ gira: true, scie: 1 })).every(Boolean)
        && Object.values(occhio({
          scatola: buonoBordo.quadro, quadro: buonoBordo.quadro, raggio: 30.4,
        })).every(Boolean)
        && Object.values(nascita({ passi: buoniPassi, palpebreA: 31 })).every(Boolean),
    },
  ]);
}

const report = reporter('cornice viva -- il quadro e\' un ricordo: tondo, sfumato, vivo, e nasce');

// ===========================================================================
// A. L'ARITMETICA -- la forma, su sei finestre e cinque inquadrature
// ===========================================================================
report.line('');
report.line('A. L\'ARITMETICA - la tela, il quadro, il raggio, la sfumatura');

const FINESTRE = [
  ['riferimento', WIN],
  ['ultralarga', { width: 3440, height: 1440 }],
  ['4K', { width: 3840, height: 2160 }],
  ['finestrina', { width: 900, height: 700 }],
  ['telefono', { width: 390, height: 844 }],
  ['telefono sdraiato', { width: 844, height: 390 }],
];
const FRAZIONI = [1, 0.95, 0.9, 0.8, 0.7, 0.6];
const knobs = askedCornice('');

let tutte = true;
let peggioreMargine = Infinity;
for (const [nome, finestra] of FINESTRE) {
  for (const f of FRAZIONI) {
    const frame = frameOf(f, finestra.width, finestra.height);
    const shape = corniceOf(frame, knobs, finestra.width, finestra.height);
    const verdict = bordo({
      finestra,
      tela: shape.tela,
      quadro: shape.quadro,
      raggio: shape.radius,
      sfumatura: shape.feather,
    });
    const ok = Object.values(verdict).every(Boolean)
      // E il quadro non e' mai piu' grande di quel che l'inquadratura ha
      // deciso: la cornice puo' togliere spazio al mondo, mai dargliene.
      && shape.quadro.width <= frame.width && shape.quadro.height <= frame.height;
    if (!ok) {
      tutte = false;
      report.check(false, `${nome} a f=${f}`,
        `tela ${shape.tela.width}x${shape.tela.height}, quadro ${shape.quadro.width}x`
        + `${shape.quadro.height}, r ${shape.radius.toFixed(1)}, s ${shape.feather.toFixed(1)}`);
    }
    peggioreMargine = Math.min(peggioreMargine, shape.marginX, shape.marginY);
  }
}
report.check(tutte,
  'su sei finestre e sei inquadrature la tela sta nel vetro, il quadro sta nella tela '
  + 'con del margine, gli angoli sono tondi e il bordo e\' sfumato',
  `trentasei forme, margine piu\' sottile ${peggioreMargine.toFixed(1)} px`);

// IL CASO CHE IL MANDATO CHIAMA «margine sottile»: a finestra intera non c'e'
// dove METTERE un margine, quindi si toglie dal quadro, e si toglie POCO.
{
  const frame = frameOf(1, WIN.width, WIN.height);
  const shape = corniceOf(frame, knobs, WIN.width, WIN.height);
  const thin = Math.round(MARGIN_WHOLE * Math.min(frame.width, frame.height));
  report.check(
    shape.tela.width === WIN.width && shape.tela.height === WIN.height
      && shape.quadro.width === WIN.width - 2 * thin
      && shape.quadro.height === WIN.height - 2 * thin,
    'a quadro intero la tela resta la finestra e il margine sottile si toglie dal quadro',
    `${shape.quadro.width}x${shape.quadro.height} dentro ${shape.tela.width}x${shape.tela.height}, `
    + `${thin} px per lato`);
  report.check(2 * thin <= 0.06 * Math.min(WIN.width, WIN.height),
    'e «sottile» vuol dire sottile: meno di un sedicesimo del lato corto in tutto',
    `${2 * thin} px su ${Math.min(WIN.width, WIN.height)}`);
}

// LA MANIGLIA.
{
  const off = askedCornice('?cornice=0');
  report.check(off.on === false && off.radius === 0 && off.feather === 0 && off.margin === 0,
    '?cornice=0 e\' il bordo netto di sito-4: niente raggio, niente sfumatura, niente margine');
  const shape = corniceOf(frameOf(0.8, WIN.width, WIN.height), off, WIN.width, WIN.height);
  const want = frameOf(0.8, WIN.width, WIN.height);
  report.check(shape.on === false
    && shape.tela.width === want.width && shape.tela.height === want.height
    && shape.quadro.width === want.width && shape.quadro.height === want.height,
    'e a ?cornice=0 la tela E\' il quadro E\' il rettangolo che frameOf ha calcolato',
    `${shape.tela.width}x${shape.tela.height}`);
  const tuned = askedCornice('?cornice=0.08,0.05,0.12,1.6');
  report.check(tuned.radius === 0.08 && tuned.feather === 0.05
    && tuned.margin === 0.12 && tuned.halo === 1.6,
    '?cornice=r,s,m,a gira tutte e quattro le manopole');
  const partial = askedCornice('?cornice=0.08');
  report.check(partial.radius === 0.08 && partial.feather === FEATHER
    && partial.margin === MARGIN,
    'e una lista corta lascia il resto com\'era');
  report.check(askedCornice('').radius === RADIUS && askedCornice('?cornice=zuppa').on === true,
    'senza maniglia, e con una maniglia che non e\' un numero, valgono i valori di casa');
  report.check(OFF.on === false, 'e il «niente» e\' dichiarato una volta sola, come costante');
}

// LA MASCHERA, LETTA DALLA FUNZIONE CHE LA PAGINA USA DAVVERO.
{
  const shape = corniceOf(frameOf(0.8, WIN.width, WIN.height), knobs, WIN.width, WIN.height);
  const hx = shape.quadro.width / 2;
  const hy = shape.quadro.height / 2;
  report.check(coverAt(0, 0, shape) === 1, 'in mezzo al quadro il mondo e\' tutto li\'');
  report.check(coverAt(hx, 0, shape) <= 0.001 && coverAt(0, hy, shape) <= 0.001,
    'sul bordo non c\'e\' piu\'');
  // L'ANGOLO E' TONDO, e si dimostra confrontando due punti alla STESSA
  // distanza dal centro in ciascun asse: quello in diagonale e' fuori, quello
  // sul lato e' dentro. Un angolo netto li avrebbe tutti e due dentro.
  const dentroLato = coverAt(hx - shape.radius - 2, 0, shape);
  const fuoriAngolo = coverAt(hx - shape.radius + shape.radius * 0.9,
    hy - shape.radius + shape.radius * 0.9, shape);
  report.check(dentroLato > 0.99 && fuoriAngolo <= 0.001,
    'e l\'angolo e\' TONDO: in diagonale si e\' gia\' fuori dove sul lato si e\' ancora dentro',
    `lato ${dentroLato.toFixed(3)}, angolo ${fuoriAngolo.toFixed(3)}`);
  // La rampa e' monotona e non ha gradini: un bordo «sfumato» che saltasse
  // sarebbe un bordo netto con un alone.
  let last = 1;
  let monotona = true;
  let passo = 0;
  for (let i = 0; i <= 40; i += 1) {
    const x = hx - shape.feather + (shape.feather * 2 * i) / 40;
    const v = coverAt(x, 0, shape);
    if (v > last + 1e-6) monotona = false;
    passo = Math.max(passo, last - v);
    last = v;
  }
  report.check(monotona && passo < 0.12,
    'e la sfumatura scende senza gradini e senza mai risalire',
    `passo piu\' grande ${passo.toFixed(3)} su quaranta campioni`);
  report.check(distanceTo(0, 0, shape) < 0 && distanceTo(hx + 10, 0, shape) > 0,
    'la distanza firmata ha il segno giusto dai due lati del bordo');
}

// ===========================================================================
// B. IL SORGENTE -- le tre proprieta' che non sono un numero
// ===========================================================================
report.line('');
report.line('B. IL SORGENTE - la notte senza scie, le palpebre nel quadro, la maschera nel composito');

const notte = read('src/ui/notte.js');
const intro = read('src/ui/intro.js');
const introCss = read('src/ui/intro.css');
const post = read('src/core/post.js');
const style = read('src/ui/style.css');
const main = read('src/main.js');

// 1. LA NOTTE FERMA NON HA SCIE.
report.check(/const turning = animated && !still;/.test(notte),
  'la notte decide UNA VOLTA se gira, prima di costruire qualunque cosa');
report.check(/\(turning \? '<canvas class="notte-trails"><\/canvas>' : ''\)/.test(notte),
  'e se non gira la tela delle scie non viene nemmeno creata',
  'non appesa e poi ferma: proprio assente');
report.check(/if \(trails\) paintTrails\(trails, geom, TRAILS_RESOLUTION\);/.test(notte),
  'e non viene dipinta: cinquecentoventi archi che nessuno vedrebbe non si disegnano');
report.check(/export const TRAILS_RESOLUTION = 0\.5;/.test(notte),
  'la notte attorno disegna le scie a meta\' risoluzione');
report.check(!/paintTrails\([^)]*,\s*[A-Z_]*RESOLUTION/.test(intro)
  && /NOTTE_paintTrails\(trails, geom\);/.test(intro),
  'e la SCENA d\'apertura le disegna al pixel del dispositivo, come sempre',
  'la tela economica e\' della notte attorno, non della scena');
report.check(/export function twinkle\(spark, glints, soft = false\)/.test(notte)
  && /export const GLINT_STILL_SWING/.test(notte),
  'e il respiro del cielo fermo e\' piu\' morbido di quello del cielo che gira');

// 2. LE PALPEBRE SONO DEL QUADRO.
report.check(/function layoutLids\(\)/.test(intro) && /quadro = null/.test(intro),
  'la scena d\'apertura chiede a chi lo sa dov\'e\' il quadro');
report.check(/lids\.style\.left = `\$\{box\.left\}px`;/.test(intro)
  && /function lidShape\(g\)/.test(intro)
  && /lids\.style\.clipPath = clip;/.test(intro)
  && /lids\.style\.webkitClipPath = clip;/.test(intro),
  'e mette sulle palpebre la scatola del quadro E la forma che il quadro ha in quel momento',
  'un taglio e non una scatola: muovere la scatola per fotogramma ridipingerebbe due '
  + 'gradienti grandi come il quadro; il taglio invece e\' del compositore');
report.check(/translateY\(\$\{y\.toFixed\(3\)\}%\)/.test(intro)
  && !/translateY\([^)]*vh\)/.test(intro),
  'e il movimento della palpebra e\' una frazione di SE STESSA e non del vetro',
  'una palpebra misurata in vh dentro un quadro piu\' piccolo e\' una palpebra piu\' alta dell\'occhio');
report.check(/--lid-h, 80%/.test(introCss) && !/--lid-h, 80vh/.test(introCss),
  'e il foglio dice la stessa cosa');
report.check(/quadro: quadroRect/.test(main) && /intro\?\.relayout\(\);/.test(main),
  'e quando il banco cambia il quadro dietro la scena, le palpebre lo seguono');

// 3. LA MASCHERA E' NEL COMPOSITO E NON NEL FOGLIO.
report.check(/float roundBox\(vec2 q, vec2 box, float radius\)/.test(post)
  && /float frameDistance\(vec2 q\)/.test(post),
  'il bordo e\' una distanza firmata dentro il frammento del composito');
report.check(/vec4 aura\(vec2 uv, float d\)/.test(post) && /texture2D\(tBloom, clamp\(gu/.test(post),
  'e l\'alone e\' la copia sfocata del bloom, ingrandita verso l\'esterno');
report.check(!/#stage[^{]*\{[^}]*(-webkit-)?mask|#stage[^{]*\{[^}]*border-radius/.test(style),
  'e sulla TELA non c\'e\' ne\' una maschera ne\' un raggio del foglio',
  'un livello grande quanto il quadro ricomposto a ogni fotogramma costa 1,44 ms '
  + 'dell\'orologio del driver (U-INQUADRATURA-1, B.3)');
report.check(/alpha: true/.test(read('src/core/renderer.js'))
  && /premultipliedAlpha: true/.test(read('src/core/renderer.js')),
  'la tela porta l\'alpha, e premoltiplicata, come il composito la scrive');
report.check(/const CORNICE = askedCornice\(\);/.test(main)
  && main.indexOf('const CORNICE = askedCornice();')
    < main.indexOf('new Renderer().init(canvas'),
  'e la cornice e\' letta PRIMA che il contesto esista, perche\' un contesto non si rifa\'');

// 4. LA NASCITA.
report.check(/const BIRTH_MS = 1500;/.test(intro) && /const BIRTH_STEP_CAP_MS = 60;/.test(intro),
  'la crescita ha una durata e un limite di VELOCITA\'',
  'con un limite di velocita\' una pausa allunga la nascita invece di farla saltare');
report.check(/post\.setNascita\(grown\(borning\), 1, 1\);/.test(intro)
  && /paintBorn\(grown\(borning\), 1\);/.test(intro)
  && /lidShape\(grown\(borning\)\);/.test(intro),
  'e la maschera del mondo, il bordo disegnato e il taglio delle palpebre si scrivono '
  + 'dallo STESSO fotogramma e dagli STESSI tre numeri');
report.check(!/lids\.classList\.add\('is-waking'\);/.test(intro.slice(0, intro.indexOf('function drive')))
  || /if \(borning < 1\) return;/.test(intro),
  'e l\'occhio non comincia finche\' il bordo non e\' arrivato');
report.check(/const BIRTH_PLAIN_MS = 450;/.test(main),
  'con la scena spenta la nascita e\' una dissolvenza breve e non un salto');
report.check(/lastPost\?\.setNascita\(1, 0, 1\);/.test(intro),
  'e una scena che se ne va rimette il quadro intero, qualunque cosa sia successa');

// 5. LE PORTE DELLE ALTRE GUARDIE.
const quadro = read('tools/guards/lib/quadro.mjs');
report.check(/\?dev&t0&intro=0&inquadratura=1&cornice=0/.test(quadro),
  'openWorld inchioda ?cornice=0 accanto a ?inquadratura=1',
  'un angolo tondo e un bordo che si dissolve non sono fatti sul prato');

// ===========================================================================
// C. LA PAGINA -- che tutto questo ci arrivi davvero
// ===========================================================================

if (!process.argv.includes('--self')) {
  const { serveRepo, toolsPresent } = await import('./lib/quadro.mjs');
  const { chromium, sharp, missing } = toolsPresent();
  if (missing.length) {
    report.line('');
    report.note(`la gamba della pagina non e' stata corsa: manca ${missing.join(', ')}`);
  } else {
    report.line('');
    report.line('C. LA PAGINA - la tela, il quadro, l\'angolo tondo, la notte, la nascita');
    const server = await serveRepo();
    const browser = await chromium.launch({
      headless: true,
      args: ['--use-angle=d3d11', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'],
    });

    /** Una pagina ferma sul mondo, e quel che si legge dal suo albero. */
    const look = async (query) => {
      const page = await browser.newPage({ viewport: WIN, deviceScaleFactor: 1 });
      try {
        await page.goto(`http://127.0.0.1:${server.port}/?dev&t0&intro=0&${query}`,
          { waitUntil: 'load' });
        await page.waitForFunction(
          () => window.farfield && window.farfield.hub && window.farfield.hub.groundReady(),
          null, { timeout: 180000, polling: 250 },
        );
        // La notte arriva per import dinamico.
        await page.waitForTimeout(1800);
        await page.evaluate(() => {
          for (const sel of ['#ui', '.dev-hud', '.dev-panel', '.overlay-start']) {
            for (const n of document.querySelectorAll(sel)) n.style.display = 'none';
          }
        });
        await page.waitForTimeout(500);
        const state = await page.evaluate(() => {
          const box = document.getElementById('stage').getBoundingClientRect();
          const scie = document.querySelector('.notte-trails');
          return {
            tela: {
              width: Math.round(box.width),
              height: Math.round(box.height),
              left: Math.round(box.left),
              top: Math.round(box.top),
            },
            quadro: {
              width: parseFloat(getComputedStyle(document.body)
                .getPropertyValue('--quadro-w')) || 0,
              height: parseFloat(getComputedStyle(document.body)
                .getPropertyValue('--quadro-h')) || 0,
            },
            incorniciata: document.body.classList.contains('is-incorniciata'),
            notti: document.querySelectorAll('.notte').length,
            scie: document.querySelectorAll('.notte-trails').length,
            gira: scie && typeof scie.getAnimations === 'function'
              ? scie.getAnimations().length : 0,
            grana: scie ? scie.width / parseFloat(scie.style.width) : null,
          };
        });
        const shot = await page.screenshot({ type: 'png' });
        const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
        state.pixel = (x, y) => {
          const o = (Math.round(y) * info.width + Math.round(x)) * info.channels;
          return (data[o] + data[o + 1] + data[o + 2]) / 3;
        };
        return state;
      } finally {
        await page.close().catch(() => {});
      }
    };

    try {
      const want = frameOf(0.8, WIN.width, WIN.height);
      const shape = corniceOf(want, knobs, WIN.width, WIN.height);

      const viva = await look('inquadratura=0.8');
      report.check(
        viva.tela.width === shape.tela.width && viva.tela.height === shape.tela.height,
        'a f=0,8 la tela e\' il quadro PIU\' il margine',
        `voluta ${shape.tela.width}x${shape.tela.height}, trovata ${viva.tela.width}x${viva.tela.height}`);
      report.check(viva.incorniciata
        && viva.quadro.width === shape.quadro.width && viva.quadro.height === shape.quadro.height,
        'e il quadro dentro di lei e\' quello che l\'aritmetica ha calcolato',
        `${viva.quadro.width}x${viva.quadro.height}`);

      // L'ANGOLO TONDO, IN FOTOGRAFIA, e i due punti sono scelti e non trovati.
      //
      // L'angolo del QUADRO dev'essere NOTTE, perche' il raggio lo ha tagliato
      // via; il mezzo del suo lato alto dev'essere MONDO, cioe' cielo. E il
      // secondo si legge una sfumatura piu' dentro e non sul filo: sul filo il
      // mondo e' gia' quasi finito PER COSTRUZIONE — e' quel che «bordo
      // interamente sfumato» vuol dire — quindi un campione li' misurerebbe la
      // sfumatura e chiamerebbe notte anche un angolo vivo.
      const qx = viva.tela.left + shape.marginX;
      const qy = viva.tela.top + shape.marginY;
      const dentro = Math.round(shape.feather) + 6;
      const angolo = viva.pixel(qx + 3, qy + 3);
      const lato = viva.pixel(viva.tela.left + viva.tela.width / 2, qy + dentro);
      report.check(angolo < 45 && lato > angolo + 60,
        'e l\'angolo del quadro e\' notte mentre il mezzo del suo lato e\' mondo: e\' TONDO',
        `angolo ${angolo.toFixed(0)}, lato ${lato.toFixed(0)} su 255, a ${dentro} px dal filo`);

      const netta = await look('inquadratura=0.8&cornice=0');
      report.check(
        netta.tela.width === want.width && netta.tela.height === want.height
          && netta.incorniciata === false,
        '?cornice=0 e\' il bordo netto di sito-4: la tela E\' l\'inquadratura',
        `${netta.tela.width}x${netta.tela.height}`);
      const angoloNetto = netta.pixel(netta.tela.left + 3, netta.tela.top + 3);
      report.check(angoloNetto > 40,
        'e il suo angolo e\' mondo e non notte: nessun raggio, nessuna sfumatura',
        `${angoloNetto.toFixed(0)} su 255`);

      // LA NOTTE, NEI DUE VERSI.
      const ferma = await look('inquadratura=0.7&notte=ferma');
      report.check(ferma.notti === 1 && Object.values(cielo({
        gira: false, scie: ferma.scie,
      })).every(Boolean),
        'la notte ferma e\' un cielo di sole stelle: nessuna tela delle scie sulla pagina',
        `${ferma.scie} tele`);
      const animata = await look('inquadratura=0.7&notte=animata');
      report.check(animata.scie === 1 && animata.gira === 1,
        'la notte animata ce l\'ha, e gira');
      report.check(animata.grana !== null && Math.abs(animata.grana - 0.5) < 0.02,
        'e la disegna a meta\' risoluzione del bitmap',
        `${animata.grana === null ? '(assente)' : animata.grana.toFixed(3)} texel per pixel`);

      // LA NASCITA, CON LA SCENA VIVA.
      const scena = await browser.newPage({ viewport: WIN, deviceScaleFactor: 1 });
      try {
        await scena.goto(`http://127.0.0.1:${server.port}/?dev&intro=1&inquadratura=0.8`,
          { waitUntil: 'load' });
        await scena.waitForFunction(() => document.querySelector('.intro.is-ready') !== null,
          null, { timeout: 240000, polling: 200 });
        // IL CROCHET SULLA SORGENTE DEL MOVIMENTO, non su uno screenshot: quel
        // che si vuole sapere e' la SUCCESSIONE di quanto il quadro e'
        // cresciuto, fotogramma per fotogramma, e quella non e' in nessuna
        // fotografia. Messo prima del gesto e tolto da solo con la pagina.
        await scena.evaluate(() => {
          const p = window.farfield.renderer.post;
          const was = p.setNascita.bind(p);
          window.__passi = [];
          window.__palpebreA = -1;
          p.setNascita = (g, c, z) => {
            window.__passi.push(g);
            if (window.__palpebreA < 0
              && document.querySelector('.intro-lids.is-waking')) {
              window.__palpebreA = window.__passi.length - 1;
            }
            return was(g, c, z);
          };
        });
        await scena.mouse.click(WIN.width / 2, WIN.height * 0.75);
        await scena.waitForTimeout(4000);
        const film = await scena.evaluate(() => ({
          passi: window.__passi, palpebreA: window.__palpebreA,
        }));
        // LE PALPEBRE SI GUARDANO A NASCITA FINITA e non prima, perche' prima
        // sono tagliate sulla forma che il quadro ha IN QUEL MOMENTO — al gesto
        // un cerchio — e chiedere il raggio del quadro a un cerchio vorrebbe
        // dire misurare la nascita e chiamarla palpebra.
        const palpebre = await scena.evaluate(() => {
          const lids = document.querySelector('.intro-lids');
          if (!lids) return null;
          const r = lids.getBoundingClientRect();
          const clip = getComputedStyle(lids).clipPath || '';
          const round = /round\s+([\d.]+)px/.exec(clip);
          return {
            width: Math.round(r.width),
            height: Math.round(r.height),
            taglio: clip,
            raggio: round ? Number(round[1]) : 0,
          };
        });
        const occhioVerdict = palpebre
          ? occhio({ scatola: palpebre, quadro: shape.quadro, raggio: palpebre.raggio })
          : { sulQuadro: false, curvo: false };
        report.check(occhioVerdict.sulQuadro && occhioVerdict.curvo,
          'le palpebre sono grandi come il quadro e hanno il suo angolo',
          palpebre
            ? `${palpebre.width}x${palpebre.height}, taglio «${palpebre.taglio}» contro quadro `
              + `${shape.quadro.width}x${shape.quadro.height} raggio ${shape.radius.toFixed(1)}`
            : '(nessuna palpebra sulla pagina)');
        const verdict = nascita(film);
        const salti = film.passi.slice(1).map((v, i) => v - film.passi[i]);
        report.check(verdict.dalCerchio && verdict.alQuadro,
          'la nascita parte dal cerchio del caricamento e arriva al quadro',
          `${film.passi.length} fotogrammi, da ${(film.passi[0] || 0).toFixed(3)} a `
          + `${(film.passi[film.passi.length - 1] || 0).toFixed(3)}`);
        report.check(verdict.monotona && verdict.morbida,
          'e non salta e non torna indietro',
          `passo piu\' grande ${(salti.length ? Math.max(...salti) : 1).toFixed(4)} del percorso, `
          + 'soffitto 0,1250');
        report.check(verdict.primaIlBordo,
          'e l\'occhio comincia ad aprirsi DOPO che il bordo e\' arrivato (E-DECISIONI35, 4)',
          `palpebre al fotogramma ${film.palpebreA}, dove il bordo era a `
          + `${(film.passi[film.palpebreA] ?? 0).toFixed(3)}`);
      } finally {
        await scena.close().catch(() => {});
      }
    } finally {
      await browser.close().catch(() => {});
      await server.stop();
    }
  }
}

report.end('E-DECISIONI35, punti 1, 2, 3 e 4 -- la forma, il sorgente e la pagina');
