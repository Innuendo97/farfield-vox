import { read, reporter, selfTest } from './lib.mjs';
import { BENCH_THRESHOLDS, CHOICES, TIERS } from '../../src/core/quality.js';
import { tierForGpuMs, tierForLag } from '../../src/core/bench.js';

// GUARD-MINIMO -- il tier sotto il basso esiste, si raggiunge, si sceglie e si
// lascia.
//
// PERCHE' UNA GUARDIA E NON UNA RIGA DI VERBALE. Un tier e' quattro cose in
// quattro file che devono essere d'accordo, e nessuna delle quattro rompe
// niente quando smette di esserlo:
//
//   1. la TABELLA (src/core/quality.js) -- il tier c'e', ed e' l'ultimo;
//   2. il BANCO (src/core/bench.js) -- una macchina lenta ci viene mandata;
//   3. il GOVERNATORE (src/core/quality.js) -- ci scende da solo e ne risale;
//   4. il MENU (src/ui/menu.js) -- il camminatore puo' chiederlo e lasciarlo.
//
// Un tier che manca nel menu e' un tier che un visitatore su una macchina lenta
// non puo' chiedere; un banco che si ferma al basso e' un tier che nessuno
// raggiunge mai; un governatore che non ci sale piu' fuori e' una macchina che
// resta nel mondo spoglio per sempre dopo un minuto storto. Sono quattro difetti
// silenziosi e nessuno di loro fa cadere una pagina.
//
// DA DOVE VIENE IL TIER (E-LINUX1, E-DECISIONI30). Il portatile del committente
// -- Intel HD Graphics 620, Mesa iris su X11 -- legge 29,8 ms di GPU al tier
// BASSO col suo orologio vero, dove la macchina di riferimento ne legge 14,1:
// 2,11 volte piu' lenta. Il bersaglio sono 30 fotogrammi al secondo stabili la',
// cioe' 20 ms di GPU e 12 di CPU.

const QUALITY = read('src/core/quality.js');
const BENCH = read('src/core/bench.js');
const MENU = read('src/ui/menu.js');

// ============================================================ I LETTORI
//
// Ognuno guarda un SORGENTE e ognuno e' provato nei tre versi che contano nel
// --self in fondo: la consegna passa, il difetto vero e' preso, e la stessa
// cosa riscritta passa lo stesso.

/** L'ultimo tier della tabella, che e' quello in cui il governatore finisce. */
export const lastTier = (tiers) => tiers[tiers.length - 1];

/** Se il governatore puo' scendere fino all'ultimo gradino della tabella. */
export const descendsToLast = (text) => /index\s*<\s*TIERS\.length\s*-\s*1\b/.test(text);

/** Se la risalita e' tenuta al tier che il banco ha misurato e non piu' su. */
export const risesNoHigherThanBenched = (text) => /const ceiling = tierIndex\(benched[\s\S]{0,200}?index > ceiling/
  .test(text);

/** Le voci che il menu offre, nell'ordine in cui le offre. */
export function menuChoices(text) {
  const open = text.indexOf('const QUALITY_CHOICES = [');
  if (open < 0) return [];
  const close = text.indexOf('];', open);
  const body = text.slice(open, close);
  return [...body.matchAll(/\[\s*'([a-z]+)'\s*,\s*'([^']+)'\s*\]/g)].map((m) => ({
    id: m[1], label: m[2],
  }));
}

/** Come il file mappa una scelta del camminatore su un tier. */
export function choiceTiers(text) {
  const open = text.indexOf('const CHOICE_TIER = {');
  if (open < 0) return {};
  const body = text.slice(open, text.indexOf('};', open));
  const found = {};
  for (const m of body.matchAll(/(\w+)\s*:\s*'([a-z]+)'/g)) found[m[1]] = m[2];
  return found;
}

// ============================================================ IL GOVERNATORE
//
// LA PROVA VERA E NON UNA LETTURA DEL TESTO: si costruisce il governatore con
// un renderer e un mondo finti, gli si danno fotogrammi cari finche' non scende
// e fotogrammi a buon mercato finche' non risale, e si guarda dove finisce.
//
// L'OROLOGIO E' NOSTRO. `HOLD_MS` tiene fermo il tier per venti secondi dopo
// ogni cambio, ed e' giusto che lo faccia: e' l'unica parte di tutto questo che
// il visitatore VEDE. Una guardia che aspettasse davvero quei venti secondi per
// ogni gradino costerebbe un minuto a ogni commit, quindi `performance.now` e'
// sostituito da un contatore che si muove quando lo diciamo noi. La legge sotto
// prova e' la stessa: e' il tempo a essere finto, non il governatore.
export async function driveGovernor({ drop = 60, rise = 400, stop = 'minimo' } = {}) {
  const real = globalThis.performance;
  let clock = 0;
  globalThis.performance = { now: () => clock };
  try {
    const seen = { grass: [], radius: [], detail: [], bloom: [], scale: [], samples: [] };
    const renderer = {
      setBloomTier: (t) => seen.bloom.push(t),
      setSamples: (n) => seen.samples.push(n),
      setRenderScale: (s) => seen.scale.push(s),
      setCampoScale: () => {},
      drawingBuffer: () => ({ width: 1892, height: 845 }),
      post: { setSceneFormat: () => {} },
    };
    const hub = {
      setGrassQuality: (g) => seen.grass.push(g),
      setVoxelDiscRadius: (r) => seen.radius.push(r),
      setGroundDetail: (d) => seen.detail.push(d),
      setCampoScale: (s) => s,
    };
    const { createQuality } = await import('../../src/core/quality.js');
    const quality = createQuality({ renderer, hub });
    quality.start();
    // Il banco ha detto «basso»: e' il tetto della risalita, e il punto da cui
    // una macchina che poi va a pezzi deve poter scendere.
    quality.setBenchmark('basso', 15);
    const still = { lookRate: 0, speed: 0 };
    const feed = (ms, frames) => {
      for (let i = 0; i < frames; i += 1) {
        clock += 16.7;
        quality.sample(ms, still);
      }
    };
    // Venti secondi di pace perche' il fermo del cambio scada.
    feed(15, 1400);
    const from = quality.tier.id;
    feed(30, drop);          // sopra CEILING_MS: la macchina non tiene
    const dropped = quality.tier.id;
    clock += 21000;
    feed(4, rise);           // sotto FLOOR_MS: la macchina respira
    const raised = quality.tier.id;
    return {
      from, dropped, raised, stop, seen, reached: dropped === stop,
    };
  } finally {
    globalThis.performance = real;
  }
}

// ============================================================ IL RAPPORTO

if (!process.argv.includes('--self')) {
  const report = reporter('guard-minimo -- il tier sotto il basso, dalla tabella al menu');

  // ------------------------------------------------------------- 1. la tabella
  const minimo = TIERS.find((t) => t.id === 'minimo');
  report.check(Boolean(minimo), 'src/core/quality.js dichiara il tier minimo');
  report.check(lastTier(TIERS).id === 'minimo',
    'ed e\' l\'ULTIMO della tabella, che e\' dove il governatore finisce',
    TIERS.map((t) => t.id).join(' > '));
  if (minimo) {
    report.check(minimo.label === 'Minima', 'e si chiama «Minima»', minimo.label);
    const basso = TIERS.find((t) => t.id === 'basso');
    // OGNI LEVA STRETTA E NESSUNA ALLARGATA. Un tier sotto il basso che spendesse
    // PIU' di quello su una qualunque delle leve non sarebbe un tier piu' basso:
    // sarebbe un tier diverso, e il camminatore che lo sceglie per tenere i
    // fotogrammi ne perderebbe.
    report.check(minimo.scale <= basso.scale,
      'disegna su non piu\' pixel del basso', `${minimo.scale} contro ${basso.scale}`);
    report.check(minimo.samples <= basso.samples,
      'con non piu\' campioni', `${minimo.samples} contro ${basso.samples}`);
    report.check(minimo.grass.density <= basso.grass.density
      && minimo.grass.radius <= basso.grass.radius,
      'con non piu\' erba',
      `${minimo.grass.density}/${minimo.grass.radius} m contro ${basso.grass.density}/${basso.grass.radius} m`);
    report.check(minimo.voxelDiscRadius <= basso.voxelDiscRadius,
      'con non piu\' terra a dieci centimetri',
      `${minimo.voxelDiscRadius} m contro ${basso.voxelDiscRadius} m`);
    report.check(minimo.groundDetail.near <= basso.groundDetail.near,
      'con l\'anello del dettaglio non piu\' largo',
      `${minimo.groundDetail.near} m contro ${basso.groundDetail.near} m`);
    // E LA BANDA, CHE VA NELL'ALTRO VERSO ED E' L'UNICA. La banda si spalma sui
    // fotogrammi che ci cascano dentro: una macchina che ne consegna meno
    // ricompra la grana con una banda piu' larga. Vedi la nota al tier oltre.
    report.check(minimo.groundDetail.lag >= basso.groundDetail.lag,
      'e la banda del dettaglio PIU\' larga, che e\' l\'unica leva che va nell\'altro verso',
      `${minimo.groundDetail.lag} ms contro ${basso.groundDetail.lag} ms`);
    report.check(minimo.sceneFormat === basso.sceneFormat,
      'e il pixel del buffer di scena e\' lo stesso: l\'intervallo della luce non e\' di un tier',
      minimo.sceneFormat);
    // IL VINCOLO DELLA FINESTRA VICINA, che e' una legge del ring e non di questo
    // tier: oltre 19,2 m non c'e' quadro piu' fine di quaranta centimetri.
    report.check(minimo.groundDetail.near * minimo.groundDetail.step ** 2 <= 19.2,
      'e il terzo fronte del dettaglio resta dentro la finestra vicina',
      `${(minimo.groundDetail.near * minimo.groundDetail.step ** 2).toFixed(1)} m di 19,2`);
  }

  // ---------------------------------------------------------------- 2. il banco
  report.check(typeof BENCH_THRESHOLDS.low === 'number',
    'il banco ha una soglia sotto cui assegna il minimo', `${BENCH_THRESHOLDS.low} ms`);
  report.check(tierForGpuMs(BENCH_THRESHOLDS.low + 0.1) === 'minimo',
    'e una macchina sopra quella soglia ci viene mandata',
    `${(BENCH_THRESHOLDS.low + 0.1).toFixed(1)} ms -> ${tierForGpuMs(BENCH_THRESHOLDS.low + 0.1)}`);
  report.check(tierForGpuMs(BENCH_THRESHOLDS.low - 0.1) === 'basso',
    'e una appena sotto no, che e\' il verso in cui una soglia si sbaglia',
    `${(BENCH_THRESHOLDS.low - 0.1).toFixed(1)} ms -> ${tierForGpuMs(BENCH_THRESHOLDS.low - 0.1)}`);
  // LA LETTURA VERA DELLA MACCHINA DEL COMMITTENTE, che e' la ragione per cui
  // questa soglia sta dove sta e non un numero tondo.
  report.check(tierForGpuMs(29.8) === 'minimo',
    'e i 29,8 ms che l\'HD 620 legge al tier basso col suo orologio finiscono qui',
    `29,8 ms -> ${tierForGpuMs(29.8)}`);
  report.check(tierForLag(2.54) === 'minimo',
    'e i 2,54 di ritardo che Firefox su X11 legge sulla stessa macchina anche',
    `2,54 -> ${tierForLag(2.54)}`);
  report.check(tierForLag(2.2) === 'basso',
    'mentre i 2,2 di Brave sulla stessa scheda restano al basso',
    `2,2 -> ${tierForLag(2.2)}`);

  // ----------------------------------------------------------- 3. il governatore
  report.check(descendsToLast(QUALITY),
    'il governatore puo\' scendere fino all\'ultimo gradino della tabella');
  report.check(risesNoHigherThanBenched(QUALITY),
    'e non risale mai sopra quello che il banco ha misurato');
  const run = await driveGovernor();
  report.check(run.from === 'basso',
    'la prova parte dal tier che il banco ha assegnato', run.from);
  report.check(run.dropped === 'minimo',
    'e una macchina che non tiene il fotogramma ci finisce DA SOLA',
    `${run.from} -> ${run.dropped}`);
  report.check(run.raised === 'basso',
    'e quando respira di nuovo ne RIESCE, fino al tier che il banco aveva misurato',
    `${run.dropped} -> ${run.raised}`);
  // LE LEVE LETTE DALLA TABELLA E NON SCRITTE QUI: una guardia che porta dentro
  // una copia dei numeri del tier e' una guardia che diventa falsa il giorno in
  // cui il tier si tara, cioe' il giorno in cui serve.
  report.check(run.seen.scale.includes(minimo.scale)
    && run.seen.samples.includes(minimo.samples)
    && run.seen.radius.includes(minimo.voxelDiscRadius),
    'e scendendo ha davvero mosso le leve del minimo sul fotogramma e sul mondo',
    `scala ${run.seen.scale.join(' ')}  campioni ${run.seen.samples.join(' ')}`
    + `  disco ${run.seen.radius.join(' ')}`);

  // ----------------------------------------------------------------- 4. il menu
  const choices = menuChoices(MENU);
  report.check(choices.some((c) => c.id === 'minima' && c.label === 'Minima'),
    'il menu offre «Minima» come una riga e non come una nota',
    choices.map((c) => c.label).join(' / '));
  report.check(CHOICES.includes('minima'),
    'e src/core/quality.js accetta quella scelta', CHOICES.join(', '));
  report.check(choiceTiers(QUALITY).minima === 'minimo',
    'e la mappa dalla scelta al tier la porta dove deve');
  // OGNI VOCE DEL MENU E' UNA SCELTA CHE IL GOVERNATORE ACCETTA, che e' la
  // simmetria per cui una riga aggiunta a meta' e' un pulsante che non fa niente.
  report.check(choices.every((c) => c.id === 'auto' || CHOICES.includes(c.id)),
    'e ogni riga del menu e\' una scelta che il governatore conosce');
  report.check(choices.every((c) => c.id === 'auto' || choiceTiers(QUALITY)[c.id]),
    'e ognuna arriva su un tier che esiste',
    choices.filter((c) => c.id !== 'auto')
      .map((c) => `${c.id}->${choiceTiers(QUALITY)[c.id]}`).join(' '));

  report.end();
}

// ============================================================ IL --self

if (process.argv.includes('--self')) {
  const casi = [];
  const senzaMinimo = TIERS.filter((t) => t.id !== 'minimo');

  casi.push({
    what: 'la tabella come si spedisce, che NON deve essere chiamata difetto',
    caught: lastTier(TIERS).id === 'minimo',
  });
  casi.push({
    what: 'una tabella da cui il minimo e\' stato tolto',
    caught: lastTier(senzaMinimo).id !== 'minimo',
  });
  casi.push({
    what: 'e una in cui il minimo c\'e\' ma non e\' l\'ultimo, cioe\' il governatore si ferma prima',
    caught: lastTier([...senzaMinimo.slice(0, 3),
      TIERS.find((t) => t.id === 'minimo'), senzaMinimo[3]]).id !== 'minimo',
  });

  // La ladder del banco, piegata nei due versi su un predicato con un nome.
  const mandaAlMinimo = (ladder, ms) => {
    if (ms < ladder.discrete) return 'oltre';
    if (ms < ladder.high) return 'alto';
    if (ms < ladder.medium) return 'medio';
    if (ms < ladder.low) return 'basso';
    return 'minimo';
  };
  casi.push({
    what: 'la scala del banco di oggi, che manda i 29,8 ms dell\'HD 620 al minimo',
    caught: mandaAlMinimo(BENCH_THRESHOLDS, 29.8) === 'minimo'
      && tierForGpuMs(29.8) === 'minimo',
  });
  casi.push({
    what: 'una scala senza l\'ultimo gradino, che ferma ogni macchina lenta al basso',
    caught: mandaAlMinimo({ ...BENCH_THRESHOLDS, low: Infinity }, 29.8) !== 'minimo',
  });
  casi.push({
    what: 'e una soglia alzata a trentacinque, che lascia fuori proprio la macchina per cui il tier esiste',
    caught: mandaAlMinimo({ ...BENCH_THRESHOLDS, low: 35 }, 29.8) !== 'minimo',
  });
  casi.push({
    what: 'il ramo a intervallo di oggi, che manda i 2,54 di Firefox su X11 al minimo',
    caught: tierForLag(2.54) === 'minimo' && tierForLag(2.2) === 'basso',
  });

  casi.push({
    what: 'il governatore di oggi, che NON deve essere chiamato difetto',
    caught: descendsToLast(QUALITY),
  });
  casi.push({
    what: 'un governatore che si ferma un gradino prima dell\'ultimo',
    caught: !descendsToLast(QUALITY.replace('index < TIERS.length - 1', 'index < TIERS.length - 2')),
  });
  casi.push({
    what: 'e uno che non risale piu\', perche\' il tetto della risalita e\' sparito',
    caught: !risesNoHigherThanBenched(
      QUALITY.replace('const ceiling = tierIndex(benched ?? DEFAULT_TIER);', 'const ceiling = 0;'),
    ),
  });
  casi.push({
    what: 'mentre lo stesso governatore con gli spazi rifatti passa lo stesso',
    caught: descendsToLast(QUALITY.replace('index < TIERS.length - 1', 'index<TIERS.length-1')),
  });

  // LA PROVA VERA, piegata nei due versi: il governatore con la tabella che si
  // spedisce arriva al minimo e ne riesce.
  const run = await driveGovernor();
  casi.push({
    what: 'la prova del governatore sulla tabella vera: scende al minimo e ne riesce',
    caught: run.dropped === 'minimo' && run.raised === 'basso',
  });
  casi.push({
    what: 'e non ci scende per caso al primo fotogramma caro: quarantacinque di fila, non uno',
    caught: (await driveGovernor({ drop: 10 })).dropped === 'basso',
  });

  casi.push({
    what: 'il menu di oggi, che offre «Minima»',
    caught: menuChoices(MENU).some((c) => c.id === 'minima'),
  });
  casi.push({
    what: 'un menu da cui la riga e\' stata tolta',
    caught: !menuChoices(MENU.replace(/\n\s*\['minima', 'Minima'\],/, '')).some((c) => c.id === 'minima'),
  });
  casi.push({
    what: 'e una riga nel menu che il governatore non accetterebbe, cioe\' un pulsante che non fa niente',
    caught: !['auto', 'minima', 'infima'].every((id) => id === 'auto' || CHOICES.includes(id)),
  });
  casi.push({
    what: 'mentre lo stesso menu riscritto con le virgolette doppie si legge uguale',
    caught: menuChoices(MENU.replace(/\['minima', 'Minima'\]/, "[ 'minima' , 'Minima' ]"))
      .some((c) => c.id === 'minima'),
  });

  selfTest('guard-minimo', casi);
}
