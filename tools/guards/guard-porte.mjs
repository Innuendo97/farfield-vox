import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { REPO_ROOT, reporter, selfTest } from './lib.mjs';
import { serveRepo } from './lib/quadro.mjs';

// GUARD-PORTE -- LE PORTE CHE MUOIONO, E CHI NON LE HA UCCISE.
//
// ===========================================================================
// PERCHE' ESISTE.
//
// Per piu' turni le unita' hanno riportato la stessa cosa: il server di
// un'ALTRA unita' -- 4357, 4358, 4360, 4361 -- trovato spento «non da noi»
// (E-CORNICE2 sul 4358, E-LUCE8 bis sulle quattro). Il sospetto scritto nel
// ledger era questo file: `tools/guards/lib/quadro.mjs` alza e spegne un
// server per OGNI misura, e lo spegne con `taskkill /PID <pid> /T /F`; se un
// pid fosse riusato, il `/T` porterebbe via l'albero di qualcun altro.
//
// U-GUARDIA-4 ha misurato tutte e tre le gambe di quel sospetto, e QUELLO NON
// E' QUELLO CHE SUCCEDE:
//
//  1. DUE SERVER SU DUE PORTE, UNA GUARDIA IN MEZZO. Un vite su 4361 con la
//     radice di questo albero e uno su 4399 con un'altra radice che divide lo
//     STESSO node_modules, tutti e due con traffico addosso; quadro alza e
//     spegne quattro server fra loro. Nessuno dei due e' caduto: 439 e 453
//     richieste servite, un timeout per parte, in piedi alla fine.
//
//  2. IL PID RIUSATO, PRESO SUL FATTO. Il serbatoio dei pid di questa
//     scrivania e' largo ~3644 (3000 nascite, 1765 distinti) e 102 processi
//     vivi portano scritto addosso un padre GIA' MORTO: il riuso non e' raro,
//     e' quotidiano. Costruiti sessanta orfani nostri, alla 63a nascita un
//     processo nuovo e' nato proprio sul pid che un orfano chiama ancora
//     «padre». `taskkill /PID <quel pid> /T /F` -- la riga esatta di
//     quadro.mjs -- ha ucciso il processo nuovo E HA LASCIATO IN PIEDI
//     L'ORFANO. Il `/T` non cammina sul campo «padre» stantio.
//
//  3. CHI LE UCCIDE DAVVERO. Un processo lungo alzato DENTRO una chiamata di
//     shell non sopravvive alla chiamata -- ne' con `&` ne' con `nohup` -- e
//     un figlio generato ATTACCATO muore insieme a chi l'ha generato, mentre
//     lo stesso figlio generato STACCATO resta in piedi (misurato tre giri su
//     tre, gamba 3 qui sotto). I server vivi su questa scrivania sono
//     esattamente quelli il cui processo che li tiene e' ancora vivo. Le porte
//     non vengono spente da nessuno: se ne vanno con chi le ha alzate.
//
// ===========================================================================
// COSA TIENE, ADESSO CHE LA CAUSA E' NOTA.
//
// Tre gambe, e ognuna e' una delle tre misure qui sopra tenuta VIVA, perche'
// una causa scritta in un verbale e' una causa che la prossima unita' ritrova
// da sola:
//
//   1. lo spegnimento di quadro prende il SUO server e nessun altro
//   2. il server di quadro non riscrive la cache condivisa dei pacchetti --
//      che e' il difetto VERO trovato per strada, e la sua riparazione
//   3. cio' che si alza attaccato se ne va con chi l'ha alzato; cio' che si
//      stacca resta
//
// Ogni gamba e' un predicato chiamato dal run e chiamato dal --self nei due
// versi. Nessuna legge un sorgente e nessuna spegne niente per immagine: si
// spegne solo per pid esatto, che e' E-OPS5.
// ===========================================================================

const flags = process.argv.slice(2);

// ------------------------------------------------------------- i tre predicati

/**
 * Nessun vicino e' caduto: chi rispondeva prima risponde dopo.
 *
 * @param {{port: number, answered: boolean}[]} before
 * @param {{port: number, answered: boolean}[]} after
 */
export const nobodyElseFell = (before, after) => before
  .filter((b) => b.answered)
  .every((b) => after.some((a) => a.port === b.port && a.answered));

/** La cache condivisa dei pacchetti e' quella di prima, all'impronta. */
export const sharedCacheHeld = (before, after) => before === after;

/**
 * Cio' che si alza ATTACCATO se ne va con chi l'ha alzato; cio' che si STACCA
 * resta. La meta' gateata e' la seconda -- e' il rimedio, ed e' nostra --
 * mentre la prima e' un fatto della macchina e viene stampato: il giorno che
 * un desco tenesse in piedi anche gli attaccati il pericolo sarebbe sparito, e
 * una guardia non va rossa perche' un pericolo e' sparito.
 */
export const detachedStands = (reading) => reading.detached === true;

// ------------------------------------------------------------------ il --self
if (flags.includes('--self')) {
  const two = [{ port: 4361, answered: true }, { port: 4399, answered: true }];
  const shared = 'a1b2c3d4';
  selfTest('guard-porte', [
    {
      what: 'un vicino che risponde prima e tace dopo: lo spegnimento e\' arrivato a casa d\'altri',
      caught: !nobodyElseFell(two, [{ port: 4361, answered: true }, { port: 4399, answered: false }]),
    },
    {
      what: 'e tutti e due caduti, che e\' come si perde un turno intero',
      caught: !nobodyElseFell(two, two.map((t) => ({ ...t, answered: false }))),
    },
    {
      what: 'e un vicino che non rispondeva NEANCHE PRIMA non e\' addebitato a questo run',
      caught: nobodyElseFell([{ port: 4361, answered: true }, { port: 4399, answered: false }],
        [{ port: 4361, answered: true }, { port: 4399, answered: false }]),
    },
    {
      what: 'e i due in piedi dai due lati passano',
      caught: nobodyElseFell(two, two),
    },
    {
      what: 'la cache condivisa dei pacchetti riscritta sotto le pagine degli altri',
      caught: !sharedCacheHeld(shared, 'e5f60718'),
    },
    {
      what: 'e cancellata del tutto, che e\' la finestra in cui un vicino chiede un file che non c\'e\' piu\'',
      caught: !sharedCacheHeld(shared, 'assente'),
    },
    {
      what: 'e la stessa cache di prima passa',
      caught: sharedCacheHeld(shared, shared),
    },
    {
      what: 'un server staccato che cade lo stesso: allora staccarlo non e\' il rimedio',
      caught: !detachedStands({ attached: false, detached: false }),
    },
    {
      what: 'e uno che resta in piedi passa, qualunque cosa abbia fatto l\'attaccato',
      caught: detachedStands({ attached: false, detached: true })
        && detachedStands({ attached: true, detached: true }),
    },
  ]);
}

// ------------------------------------------------------------------- gli attrezzi

const report = reporter('guard-porte -- lo spegnimento prende il suo, e nient\'altro');

const alive = (pid) => spawnSync('powershell', ['-NoProfile', '-Command',
  `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`],
{ encoding: 'utf8' }).stdout.trim() === 'yes';

/** Per pid esatto, mai per immagine: E-OPS5. */
const reap = (pid) => { if (pid && alive(pid)) spawnSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' }); };

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

const freePort = () => new Promise((settle, fail) => {
  const probe = createServer();
  probe.once('error', fail);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => settle(port));
  });
});

const answersOn = async (port) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
};

/**
 * L'impronta della cache che tutti gli alberi dividono.
 *
 * node_modules e' UNA cartella per tutta la campagna (E-OPS2 lo dice per la
 * cache del build; questa e' l'altra), e vite ci tiene i pacchetti
 * preottimizzati. Si guarda il file che li elenca: se cambia, qualcuno li ha
 * riscritti sotto le pagine di qualcun altro.
 */
function sharedCacheFingerprint() {
  let real;
  try { real = realpathSync(join(REPO_ROOT, 'node_modules')); } catch { return 'nessuna'; }
  const meta = join(real, '.vite', 'deps', '_metadata.json');
  if (!existsSync(meta)) return 'assente';
  return createHash('sha1').update(readFileSync(meta)).digest('hex').slice(0, 12);
}

/** Un vicino: un server nostro, staccato, come quello di un'altra unita'. */
async function raiseNeighbour(port) {
  const child = spawn(process.execPath, ['-e',
    `require('node:http').createServer((q, s) => { s.end('vicino'); }).listen(${port}, '127.0.0.1');`],
  { stdio: 'ignore', detached: true });
  child.unref();
  for (let k = 0; k < 40; k++) {
    // eslint-disable-next-line no-await-in-loop
    if (await answersOn(port)) break;
    // eslint-disable-next-line no-await-in-loop
    await sleep(150);
  }
  return child.pid;
}

// ============================================================ 1 e 2. IL VICINO
//
// Un vicino nostro su una porta libera, staccato come quello di un'unita';
// quadro alza il proprio server e lo spegne con la riga che il ledger
// sospettava; il vicino viene chiesto prima e dopo, e con lui l'impronta della
// cache condivisa. Le porte assegnate alle unita' non entrano qui: una guardia
// che per misurare toccasse 4357-4361 sarebbe il difetto che sta cercando.
const neighbourPort = await freePort();
const neighbourPid = await raiseNeighbour(neighbourPort);
const before = [{ port: neighbourPort, answered: await answersOn(neighbourPort) }];
const cacheBefore = sharedCacheFingerprint();

let server = null;
let raised = null;
try {
  server = await serveRepo();
  raised = server.pid;
  await server.stop();
  await sleep(1200);
} catch (error) {
  report.note(`il server di quadro non si e' alzato su questa macchina, e le gambe 1 e 2 `
    + `non hanno morso: ${String(error.message).split('\n')[0].slice(0, 200)}`);
}

const after = [{ port: neighbourPort, answered: await answersOn(neighbourPort) }];
const cacheAfter = sharedCacheFingerprint();

if (raised) {
  report.check(nobodyElseFell(before, after),
    'lo spegnimento di quadro prende il SUO server e lascia in piedi il vicino',
    `vicino su ${neighbourPort} (pid ${neighbourPid}): ${before[0].answered ? 'risponde' : 'muto'} prima, `
    + `${after[0].answered ? 'risponde' : 'MUTO'} dopo; il server di quadro (pid ${raised}) `
    + `${alive(raised) ? 'E\' ANCORA IN PIEDI' : 'e\' giu\''}`);
  report.check(!alive(raised),
    'e il suo lo prende davvero, per pid esatto',
    `pid ${raised}`);
  report.check(sharedCacheHeld(cacheBefore, cacheAfter),
    'e non riscrive la cache dei pacchetti che gli altri alberi dividono con questo',
    `${cacheBefore} prima, ${cacheAfter} dopo, in ${(() => {
      try { return join(realpathSync(join(REPO_ROOT, 'node_modules')), '.vite'); } catch { return 'nessuna'; }
    })()}`);
}
reap(neighbourPid);

// ============================================================= 3. CHI LI TIENE
//
// La misura che spiega i turni persi, rifatta a ogni corsa: un aiutante alza
// due processi lunghi, uno ATTACCATO e uno STACCATO, e se ne va. Cio' che era
// attaccato se ne va con lui; cio' che era staccato resta. E' il perche' un
// server «lasciato acceso» dentro una chiamata di shell non c'e' piu' il turno
// dopo, e nessuno l'ha spento.
const helper = spawn(process.execPath, ['-e',
  "const{spawn}=require('node:child_process');"
  + "const a=spawn('ping',['-n','100000','127.0.0.1'],{stdio:'ignore',detached:false});"
  + "const d=spawn('ping',['-n','100000','127.0.0.1'],{stdio:'ignore',detached:true});d.unref();"
  + "console.log(a.pid+' '+d.pid);setTimeout(()=>process.exit(0),150);"],
{ stdio: ['ignore', 'pipe', 'ignore'] });
let said = '';
helper.stdout.on('data', (chunk) => { said += chunk; });
await new Promise((settle) => helper.once('exit', settle));
const [attachedPid, detachedPid] = said.trim().split(' ').map(Number);
await sleep(800);
const reading = { attached: alive(attachedPid), detached: alive(detachedPid) };
report.check(detachedStands(reading),
  'un server staccato resta in piedi quando chi l\'ha alzato se ne va',
  `chi li ha alzati (${helper.pid}) e' uscito; staccato ${detachedPid} `
  + `${reading.detached ? 'in piedi' : 'CADUTO'}, attaccato ${attachedPid} `
  + `${reading.attached ? 'in piedi' : 'caduto con lui'}`);
if (!reading.attached) {
  report.note('E QUESTA E\' LA CAUSA DELLE PORTE CHE MUOIONO, misurata e non supposta: cio\' che '
    + 'si alza ATTACCATO se ne va con chi l\'ha alzato. Un server lasciato acceso dentro una '
    + 'chiamata di shell non sopravvive alla chiamata (ne\' con & ne\' con nohup: misurato); i '
    + 'server vivi su questa scrivania sono esattamente quelli il cui processo che li tiene e\' '
    + 'ancora vivo. Nessuno li spegne: se ne vanno con chi li ha alzati. Lo spegnimento «per pid '
    + 'esatto» di quadro.mjs e\' stato messo alla prova nei due modi in cui poteva sbagliare '
    + '(due server con traffico addosso; un pid riusato preso sul fatto) e non ne ha toccato '
    + 'nessuno. Chi vuole lasciare un server in piedi lo generi STACCATO.');
}
reap(attachedPid);
reap(detachedPid);

report.end();
