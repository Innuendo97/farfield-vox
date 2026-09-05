import { REPO_ROOT, reporter, selfTest } from './lib.mjs';
import {
  census, dropFace, flipFace, referenceBox, shellCensus, windingCensus,
} from './lib/avvolgimento.mjs';
import { drawsFromEitherSide, isAdditive, populations } from './lib/popolazioni.mjs';

// NO TRIANGLE OF THIS WORLD IS WOUND AGAINST THE NORMAL IT DECLARES, AND NO
// SURFACE THE CAMERA TURNS TO IS DRAWN ON ONE SIDE ONLY.
//
// WHY THIS GUARD EXISTS. Twice a surface has been delivered that was not on the
// screen while every number said it was: the sheet beyond the disc, seven
// thousand triangles wound clockwise under a FrontSide material and shipped as
// sky (E-FOND-PIANO10), and four of the flower's nine quads, wound inward, of
// which the rasterizer drew five (E-FIORI3). One was found by looking and one by
// the committente walking. E-FIORI3 closes with the sentence this file answers:
// no other population had been looked at for the same defect, because nothing in
// the repository read a winding.
//
// WHAT IT READS. Not the source. It CALLS the builders the world calls and reads
// the buffer that comes back, and it asks each material for its own side rather
// than parsing the text that made it. That is what shuts the two holes declared
// against guard-additiva in E-V7g -- a blending written as a constant instead of
// a literal, and a side assigned after the construction -- because an object has
// no syntax to hide behind.
//
// THE THREE COUNTS, and why the gate is on two of them. `reversed` and the
// conflicting edges are EXACT: a triangle either agrees with its declared normal
// or it does not, and two triangles either cross their shared edge in opposite
// directions or they do not. Neither depends on a viewpoint, so both are gated
// at zero. The rays are the third leg and they are gated nowhere: they are the
// only one that catches a face nobody ever WROTE, but an honest crop looks the
// same to them as a hole -- a chunk is a piece of a bigger surface, a block of
// masonry has no underside because it stands on the ground -- so their number is
// reported and never gated. The bench splits it anyway, and the split is printed.
//
// THE REGISTER, and why a guard may carry a defect it does not fail on. The
// populations of this world belong to eight sessions and this one owns none of
// them but the foundation's. A defect in somebody else's geometry is DECLARED
// with its owner, its line and its exact count -- and the count is the gate in
// BOTH directions. It cannot grow, which is what a baseline is for; and it
// cannot shrink either, so the day the owner cures it this guard goes red and
// the entry has to come out. A register that could quietly absorb a cure would
// be a place for defects to go and be forgotten, which is the opposite of what
// E-FIORI3 asked for.

const flags = process.argv.slice(2);
const SELF = flags.includes('--self');

/**
 * The defects this world is known to carry, each with the owner who can cure it.
 *
 * The counts are the ones measured over the whole world on the cammino
 * (b9589f4) and they are reproduced on this branch by the same builder.
 */
const REGISTER = [
  {
    what: 'alberi chiome e tronchi', owner: 'V4',
    where: 'src/world/trees.js:315-316',
    why: 'l\'accoppiata (u,v) per asse non e\' una permutazione ciclica: per '
      + 'axis 1 vale (x,z) dove la terna destrorsa vuole (z,x), e ogni faccia '
      + '+Y e -Y esce avvolta contro la normale che dichiara',
    reversed: 1206, inconsistent: 1473,
  },
  {
    what: 'alberi secondo pigmento', owner: 'V4',
    where: 'src/world/trees.js:315-316',
    why: 'la stessa riga, sul secondo pigmento',
    reversed: 24, inconsistent: 48,
  },
  {
    what: 'nuvole 0', owner: 'V6',
    where: 'src/world/clouds.js: il materiale non dichiara side',
    why: 'le lastre stanno in aria con un orientamento ciascuna e non si voltano '
      + 'verso nessuno: a faccia singola, quelle che danno il rovescio al '
      + 'camminatore costano la loro parte della draw e non disegnano niente '
      + '(lezione 5, E-V6c). SUL CAMMINO LA CURA ESISTE GIA: V6 dichiara '
      + 'side: DoubleSide -- e la cura arriva qui con la prossima fusione: '
      + 'quel giorno questa riga diventa rossa e va tolta',
    reversed: 0, inconsistent: 0, side: 'FrontSide',
  },
];

const registered = (name) => REGISTER.find((entry) => entry.what === name);

if (SELF) {
  // THE OTHER DIRECTION. A bench nobody has seen fail is a bench nobody has any
  // reason to believe, and this one is a measuring instrument before it is a
  // gate: every leg is shown catching the defect it exists for, and the two
  // defects that actually shipped on this world are among them.
  const box = referenceBox(1);
  const flipped = flipFace(box, 2);
  const dropped = dropFace(box, 3);
  const bare = box.map((f) => ({ corners: f.corners }));
  const bareFlipped = flipFace(bare, 2).map((f) => ({ corners: f.corners }));
  const inside = box.map((f) => ({ normal: f.normal, corners: [...f.corners].reverse() }));
  const squashed = [{
    normal: [0, 1, 0],
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 0], [0, 0, 0]],
  }];

  const sound = census('sana', { faces: box }, { closed: true, rays: { grid: 48 } });
  const one = census('una girata', { faces: flipped }, { closed: true, rays: { grid: 48 } });
  const gone = census('una tolta', { faces: dropped }, { closed: true, rays: { grid: 48 } });

  selfTest('guard-avvolgimento', [
    { what: 'la scatola sana non e\' accusata di niente',
      caught: sound.winding.reversed === 0 && sound.shell.boundary === 0
        && sound.shell.inconsistent === 0 && sound.rays.holes === 0 },
    { what: 'una faccia avvolta al contrario (il difetto di E-FOND-PIANO10)',
      caught: one.winding.reversed === 2 },
    { what: '... e i suoi quattro spigoli in conflitto, senza leggere una normale',
      caught: one.shell.inconsistent === 4 },
    { what: '... e i raggi che entrano dove il rasterizzatore la scarta',
      caught: one.rays.holesFlipped > 0 && one.rays.holesOpen === 0 },
    { what: 'una faccia mai scritta (il fondo aperto dello stelo, E-FIORI3)',
      caught: gone.shell.boundary === 4 && gone.rays.holesOpen > 0 },
    { what: '... e non viene scambiata per una faccia cullata',
      caught: gone.rays.holesFlipped === 0 && gone.winding.reversed === 0 },
    { what: 'un solido rovesciato per intero da' + ' un volume negativo',
      caught: shellCensus({ faces: inside }).volume < 0 },
    { what: 'una geometria senza normali dichiarate: lo spigolo in conflitto la trova lo stesso',
      caught: shellCensus({ faces: bareFlipped }).inconsistent === 4
        && shellCensus({ faces: bare }).inconsistent === 0 },
    { what: '... e la gamba delle normali dichiara di non poter rispondere',
      caught: windingCensus({ faces: bareFlipped }).undeclared === 12
        && windingCensus({ faces: bareFlipped }).reversed === 0 },
    { what: 'un triangolo degenere, che costa la draw e disegna nulla',
      caught: windingCensus({ faces: squashed }).degenerate === 2 },
    { what: 'un additivo a faccia singola (lezione 5: costa e disegna nulla)',
      caught: !drawsFromEitherSide({ side: 0, blending: 2 })
        && isAdditive({ side: 0, blending: 2 }) },
    { what: '... anche quando il side gli e\' stato assegnato dopo (buco E-V7g)',
      caught: drawsFromEitherSide(Object.assign({ blending: 2 }, { side: 2 })) },
    { what: 'il registro morde nei due versi: un conto diverso e\' rosso',
      caught: registered('alberi chiome e tronchi').reversed !== 0
        && registered('alberi chiome e tronchi').reversed !== 1205 },
  ]);
}

const out = reporter('guard-avvolgimento -- avvolgimenti, buchi e side di ogni popolazione');

const rows = [];
const absent = [];
for (const pop of populations(REPO_ROOT)) {
  let built;
  try {
    built = await pop.build();
  } catch (error) {
    absent.push({ pop, why: String(error.message).slice(0, 110) });
    continue;
  }
  // The rays are the slow leg and they say nothing the exact counts do not once
  // a normal is declared, so on the disc they run on a spread and not on all of
  // it. The exact counts run on every last chunk.
  const spread = pop.rays === 'sample'
    ? new Set([0, 1, 2, 3, 4, 5, 6, 7].map((k) => Math.floor((k * built.length) / 8)))
    : null;
  for (const [i, item] of built.entries()) {
    const name = item.suffix ? `${pop.name} ${item.suffix}` : pop.name;
    const result = census(name, item.mesh, {
      closed: item.closed ?? pop.closed ?? false,
      rays: spread && !spread.has(i) ? false
        : { grid: item.grid ?? pop.grid ?? 64, side: item.side === 'DoubleSide' ? 'double' : 'front' },
    });
    result.owner = pop.owner;
    result.where = pop.where;
    result.side = item.side;
    result.material = item.material || null;
    result.billboard = item.billboard || pop.billboard || false;
    result.family = item.family ? `${pop.name} ${item.family}` : name;
    rows.push(result);
  }
}

// The disc is hundreds of chunks of one mesher; the gate is on the sum and on
// every chunk, and the report is on the sum.
const families = new Map();
for (const row of rows) {
  let pot = families.get(row.family);
  if (!pot) {
    pot = {
      name: row.family, owner: row.owner, where: row.where, side: row.side,
      parts: 0, faces: 0, reversed: 0, degenerate: 0, undeclared: 0,
      boundary: 0, inconsistent: 0, nonManifold: 0,
      holesFlipped: 0, holesOpen: 0, holesUndeclared: 0, struck: 0, rayed: 0,
    };
    families.set(row.family, pot);
  }
  pot.parts++;
  pot.faces += row.winding.faces;
  pot.reversed += row.winding.reversed;
  pot.degenerate += row.winding.degenerate;
  pot.undeclared += row.winding.undeclared;
  pot.boundary += row.shell.boundary;
  pot.inconsistent += row.shell.inconsistent;
  pot.nonManifold += row.shell.nonManifold;
  if (row.rays) {
    pot.rayed++;
    pot.struck += row.rays.struck;
    pot.holesFlipped += row.rays.holesFlipped;
    pot.holesOpen += row.rays.holesOpen;
    pot.holesUndeclared += row.rays.holesUndeclared;
  }
}

out.line('  popolazione                 facce  contro   degen  spigoli-conflitto      side');
for (const pot of families.values()) {
  out.line(`  ${pot.name.padEnd(26)} ${String(pot.faces).padStart(7)}`
    + ` ${String(pot.reversed).padStart(7)} ${String(pot.degenerate).padStart(7)}`
    + ` ${String(pot.inconsistent).padStart(18)}  ${String(pot.side).padStart(11)}`);
}

let counted = 0;
for (const pot of families.values()) {
  const entry = registered(pot.name);
  counted++;
  if (entry) {
    // The register is a ratchet and not a carpet: the count is the gate in both
    // directions, so a cure makes this red and takes the entry out with it.
    out.check(pot.reversed === entry.reversed && pot.inconsistent === entry.inconsistent,
      `${pot.name}: il difetto dichiarato e' ancora esattamente quello`,
      `contro ${pot.reversed}/${entry.reversed}, conflitti ${pot.inconsistent}/${entry.inconsistent}`);
    // A register entry about a material has no reversed faces to report, and a
    // note that said "0 faces, never drawn" would be a sentence with no meaning
    // in it. The side leg below says what there is to say about that one.
    if (pot.reversed) {
      out.note(`${pot.name.toUpperCase()} PORTA UN DIFETTO DI ${entry.owner}: `
        + `${pot.reversed} facce su ${pot.faces} avvolte contro la normale che `
        + `dichiarano (${(100 * pot.reversed / pot.faces).toFixed(1)}%), mai disegnate. `
        + `${entry.where} -- ${entry.why}`);
    }
    continue;
  }
  out.check(pot.reversed === 0, `${pot.name}: nessuna faccia contro la sua normale`,
    pot.reversed ? `${pot.reversed} su ${pot.faces} (${pot.where})` : `${pot.faces} facce`);
  out.check(pot.inconsistent === 0, `${pot.name}: nessuno spigolo fra due facce discordi`,
    pot.inconsistent ? `${pot.inconsistent} spigoli (${pot.where})` : '');
  out.check(pot.degenerate === 0, `${pot.name}: nessun triangolo degenere`,
    pot.degenerate ? `${pot.degenerate} a area nulla` : '');
}

// The materials, asked of the objects. A surface the camera turns to must draw
// from either side: a single-sided one costs its draw call and puts nothing on
// the screen, and the night was once measured a hundredfold wrong because of it.
for (const row of rows) {
  if (!row.material) continue;
  if (isAdditive(row.material)) {
    out.check(drawsFromEitherSide(row.material),
      `${row.name}: additivo, quindi a due facce`, `side ${row.side}`);
  }
  if (row.billboard) {
    const entry = registered(row.name);
    // A sheet of plates standing in the air has a front and a back and no say in
    // which one the walker arrives from, so it must draw from either. The one
    // known to be single sided is registered, and registered with the side it
    // has: the day it gains the other one this goes red and the entry comes out.
    out.check(drawsFromEitherSide(row.material) || (entry && entry.side === row.side),
      `${row.name}: foglio in aria, quindi a due facce`,
      `side ${row.side}${entry ? ` (difetto dichiarato di ${entry.owner})` : ''}`);
    if (entry && entry.side === row.side) {
      out.note(`${row.name.toUpperCase()} PORTA UN DIFETTO DI ${entry.owner}: `
        + `${entry.where} -- ${entry.why}`);
    }
  }
}

for (const { pop, why } of absent) {
  // Not measured is not the same as measured and sound, and the difference is
  // the whole reason this line exists rather than a silent absence.
  out.note(`${pop.name} (${pop.owner}) NON MISURATA su questo ramo: ${why}`);
}

const holes = rows.reduce((sum, r) => sum + (r.rays ? r.rays.holesFlipped : 0), 0);
const open = rows.reduce((sum, r) => sum + (r.rays ? r.rays.holesOpen + r.rays.holesUndeclared : 0), 0);
out.note(`raggi: ${holes} su una faccia cullata, ${open} dove non c'e' faccia `
  + '(crop di chunk, appoggi a terra, fogli senza rovescio: misurati, non gateati)');

out.end(`${counted} popolazioni su ${rows.length} costruzioni, `
  + `${absent.length} non su questo ramo`);
