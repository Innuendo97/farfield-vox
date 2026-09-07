import { MONOLITHS, PLATFORM, STAIRS } from './layout.js';
// The PURE half of the engine's door and not the page's: this file has to
// answer under plain node for the two measuring tools, and the page's door
// reaches three.js.
import { CHAMFER, masonryDecks } from './voxel/pure.js';

// WHAT THE STONE OF THIS WORLD IS MADE OF — V2's seat, and the only one.
//
// src/world/voxel/ knows HOW a wall is cut: a rise, a lattice of cells, how
// often a cell boundary is a block edge, how far a course strays. It does not
// know what any of those numbers ARE for this world, and it must not: it is the
// engine all eight sessions build on, and a measurement of one picture has no
// business being frozen into it.
//
// So the numbers are read HERE, out of assets-src/monoliths/masonry-spec.json,
// which is V2-AN's reading of the two targets — and every one of them is
// DERIVED from a measurement in that file rather than copied out of a taste.
// The derivations are written beside the lines that do them, because a spec
// whose numbers arrive by hand is a spec nobody can re-derive when the reading
// changes.
//
// AND THE SPEC ARRIVES AS AN ARGUMENT, not as an import. This file has to
// answer under plain node — tools/monoliths/underfoot.mjs and spec.mjs both walk
// it — and a bare JSON import is a thing only a bundler can resolve. Whoever
// calls reads the file the way their own world reads files, and the arithmetic
// is in one place.

const DEG = Math.PI / 180;

/**
 * The head of a block, as runs along its own width with a course count each.
 *
 * THE ORDER OF THE RAW LEVELS IS SPATIAL AND THAT IS WHY THE HEAD CAN BE BUILT
 * AT ALL. v2-pietra/an/muschio.mjs walks the columns of a face from left to
 * right and prints (metres, how many columns) in the order it finds them, so
 * the list in the spec is a RUN-LENGTH ENCODING of the head and not a bag of
 * levels. Nothing here invents where a step falls; it is read.
 *
 * Three passes and each is a rule the spec already states:
 *
 *   1. fuse neighbours closer than the merge distance, which is derived — three
 *      times the p90 wander of a course, half a course — because a step of one
 *      course has to be told apart from a course that strays;
 *   2. quantise to whole courses, because a course is what a head is built of,
 *      and fuse again what lands on the same one;
 *   3. fuse away anything narrower than the spec's OWN keep-wider-than into the
 *      wider run beside it.
 *
 * AND THE THIRD FILTER IS THE SPEC'S AND NOT ONE OF ITS OWN, which is a
 * correction. It used to drop runs narrower than one CELL — a defensible-
 * sounding rule (a block is the narrowest thing a head can step by) that is
 * nowhere in the reading, and on a 3.44 m face one cell is 5% of the width
 * against the tenth the spec states. Built that way the five heads came out at
 * three to seven levels with steps up to nine courses, against the one to four
 * and 0.9 to 6.5 the same spec derives from the same columns — the generator
 * and the measurement disagreeing about the same head, which
 * tools/monoliths/spec.mjs is there to catch and did.
 */
export function headRunsOf(spec, id, rise, cell, width) {
  const raw = spec.head.levels[`${id}-front`];
  if (!raw) return null;
  const merge = 3 * spec.course.wanderP90;

  let runs = [];
  for (const [metres, columns] of raw.metresUp) {
    const last = runs[runs.length - 1];
    if (last && Math.abs(last.at - metres) < merge) {
      last.at = (last.at * last.columns + metres * columns) / (last.columns + columns);
      last.columns += columns;
    } else runs.push({ at: metres, columns });
  }

  runs = runs.map((r) => ({ courses: Math.round(r.at / rise), columns: r.columns }));
  const fuse = () => {
    const out = [];
    for (const run of runs) {
      const last = out[out.length - 1];
      if (last && last.courses === run.courses) last.columns += run.columns;
      else out.push({ ...run });
    }
    runs = out;
  };
  fuse();

  // A run narrower than the spec's own keep-wider-than is not a level of this
  // head, so it joins the wider of the two beside it and takes that height.
  const keep = spec.head.keepWiderThan;
  const total = () => runs.reduce((s, r) => s + r.columns, 0);
  const narrowest = () => runs.reduce(
    (a, b, i) => (i > 0 && b.columns < runs[a].columns ? i : a), 0,
  );
  for (let guard = 0; guard < 64 && runs.length > 1; guard++) {
    const i = narrowest();
    if (runs[i].columns / total() >= keep) break;
    const before = i > 0 ? runs[i - 1] : null;
    const after = i + 1 < runs.length ? runs[i + 1] : null;
    const into = !before ? after : !after ? before
      : (before.columns >= after.columns ? before : after);
    into.columns += runs[i].columns;
    runs.splice(i, 1);
    fuse();
  }

  const columns = total();
  let at = 0;
  return runs.map((run, i) => {
    at += run.columns / columns;
    return { to: i === runs.length - 1 ? 1 : at, courses: run.courses };
  });
}

/**
 * The head of the block nobody could measure, from the law the other five give.
 *
 * 06 stands behind the spawn and is out of both framings on purpose, so there
 * is no picture of its head and there never will be. Giving it a flat lid would
 * make the one block a walker meets by turning round the one block in the hub
 * that is not built like its brothers — which is a decision about the world
 * taken by the absence of a measurement. So it is drawn from the five: the same
 * count of levels, the same widest fraction, the same depth of step, with a
 * deterministic draw standing in for the reading nobody can take. DECLARED, and
 * marked as such in the spec beside quoins.
 */
function inventedHead(courses, draw) {
  const levels = 3;
  const shares = [0.22, 0.46, 0.32];
  const drops = [Math.round(1 + 5 * draw(1)), 0, Math.round(1 + 3 * draw(2))];
  let at = 0;
  return shares.map((share, i) => {
    at += share;
    return { to: i === shares.length - 1 ? 1 : at, courses: courses - drops[i] };
  }).slice(0, levels);
}

/**
 * The law of the wall of the two targets, as the door wants it.
 *
 * Every field is derived here and the derivation is the comment above it. What
 * is NOT derivable from a reading is stated as not derivable.
 *
 * @param {object} spec assets-src/monoliths/masonry-spec.json, parsed
 */
export function measuredLaw(spec) {
  // The rise the heads were quantised on, which is the one the spec uses for
  // every height it states.
  const rise = spec.heads.rise;

  // ONE CELL IS ONE BLOCK OF THIS WALL. The mean width over the window the
  // course was pooled on, which is the same window the 0.92 : 1 aspect was
  // formed in — 0.1888 against 0.2053 is 0.92 exactly. Taking the aspect times
  // the head rise instead would mix two windows and read 5% wide.
  const cell = spec.block.meanWidth.inWindow;

  // HOW OFTEN A CELL BOUNDARY IS A BLOCK EDGE, and it is not fitted: it is read
  // straight off the doubles. If boundaries are kept independently at rate q,
  // the length of a block in cells is geometric, so the fraction of blocks
  // wider than one cell is 1 - q. The targets say 17% of blocks are wider than
  // 0.30 m, so q = 0.83 — and the SAME q then predicts 2.9% wider than two
  // cells against the 3.1% measured, which is a reading the rate was not fitted
  // to and is the reason to believe the law.
  const runCut = 1 - spec.block.doubles.fraction;

  // HOW FAR A CELL BOUNDARY STRAYS, in cells. Half a cell, and it is a declared
  // bound rather than a fit: the pooled spread of the widths is 60 to 67% of
  // the median, of which the geometric run law already supplies 50%, and
  // closing the rest would take a jitter of 0.95 cells — blocks a centimetre
  // wide. Half a cell puts the quartiles of a single block on the measured
  // 0.135 and 0.240 and leaves the rest of the spread where it belongs, with
  // the detector that doubled some of its detections.
  const jitter = 0.5;

  // HOW FAR A COURSE STRAYS FROM LEVEL, and one amplitude carries two readings.
  // A course wanders 30 mm across a face and the spacing between two courses
  // scatters by 44 mm, and those are the same fact: two lines that stray
  // independently by s open a gap that strays by s*sqrt(2). The field below has
  // a spread of 0.1791 of its own amplitude, so 30 mm asks for 0.168 — which
  // then predicts a spacing scatter of 43 mm against the 44 measured, with
  // nothing fitted to make it.
  const wander = spec.course.wanderMedian / 0.1791;

  return { rise, cell, runCut, jitter, wander, wanderSpan: 1.2 };
}

/**
 * The six blocks of the hub, with the measured wall on each of them.
 *
 * The plan is READ and not copied: where a block stands, how wide and how deep
 * and which way it is turned all come from src/world/layout.js, which is the
 * least squares reconstruction of the reference framing. What this adds is what
 * the stone between those corners is made of.
 *
 * ONE THING THE PLAN SAYS IS OVERRULED AND IT IS SAID OUT LOUD: how TALL a
 * block is. layout.js declares a box height; the targets draw a head, and the
 * two differ by up to 0.35 m on 04. The courses stop where the target's widest
 * head level is, which costs 05 the 9.5 cm its box was already right by and
 * buys 04 the 35 it was wrong by. The box is not edited — it is still what the
 * blocker, the panel and the silhouette guard read.
 */
export function stoneSpecs(spec, plan = MONOLITHS) {
  const law = measuredLaw(spec);
  return plan.map((block) => {
    const head = spec.heads.perBlock[block.id];
    const courses = head ? head.courses : Math.round(block.size[1] / law.rise);
    const runs = headRunsOf(spec, block.id, law.rise, law.cell, block.size[0])
      || inventedHead(courses, (k) => ((block.id.charCodeAt(1) * 37 + k * 13) % 97) / 97);
    // The one socket the targets show: a block left out of the west flank of
    // 01, three columns wide at 5.16 m up. Read as a course and a place along
    // that wall, because that is what the generator can be told.
    const recesses = spec.head.missingBlock.block === block.id
      ? [{
        wall: 'left',
        course: Math.round(spec.head.levels['01-left'].metresUp.at(-1)[0] / law.rise),
        at: 0,
      }]
      : [];
    return { ...block, masonry: { ...law, courses, head: runs, recesses } };
  });
}

/**
 * The stair run and the platform, as one masonry each, from the same door.
 *
 * THE STAIR IS A BLOCK WITH A STAIRCASE FOR A HEAD, which is why it needs no
 * second generator and why the refusal to write one could be honoured the day
 * the door was widened. Six steps of one course each: the platform is 1.30 m
 * tall and the run climbs it in six, so a course here is 0.21667 m — which is
 * the rise the targets measure on the run itself, confirmed and not chosen.
 *
 * IT IS TURNED A QUARTER TURN so that its head steps along its own width, the
 * only axis a head can step along. Local +x then points north, which is up the
 * run, so the run of one course stands at the south end and the run of six at
 * the north, tucked under the platform.
 *
 * AND ITS COURSES ARE LAID LEVEL, which is the one place in this world where a
 * course does not stray. Everywhere else the wander is what the targets say a
 * course does; here a course is WALKED ON, and a tread that strays by 30 mm is
 * a tread no contract can answer a height for — src/world/contracts.js says
 * outright that nothing in it may quietly become a different answer from the
 * one the frame draws. So the run is ruled, and it is ruled for a reason that
 * is written down rather than because nobody measured it.
 */
export function stairSpecs(spec) {
  const law = { ...measuredLaw(spec), wander: 0 };
  const rise = PLATFORM.height / STAIRS.steps;
  const tuck = 1.1;
  const run = STAIRS.tread * STAIRS.steps + tuck;

  // The head, walked from the south end (one course) to the north end (six).
  // The top run reaches under the platform and is set a centimetre below it, so
  // the two are never coplanar where one runs under the other.
  const head = [];
  let at = 0;
  for (let k = STAIRS.steps - 1; k >= 0; k--) {
    const width = k === 0 ? STAIRS.tread + tuck : STAIRS.tread;
    at += width / run;
    head.push({
      to: k === 0 ? 1 : at,
      courses: STAIRS.steps - k,
      drop: k === 0 ? TOP_STEP_DROP : 0,
    });
  }

  return [
    {
      id: 'scalinata',
      position: { x: STAIRS.x, z: STAIRS.z + (STAIRS.tread * STAIRS.steps - tuck) / 2 },
      rotationY: 90,
      size: [run, PLATFORM.height, STAIRS.width],
      baseY: 0,
      masonry: {
        ...law, rise, courses: STAIRS.steps, head,
      },
    },
    {
      id: 'piattaforma',
      position: { x: PLATFORM.x, z: PLATFORM.z },
      rotationY: PLATFORM.rotationY,
      size: [PLATFORM.width, PLATFORM.height, PLATFORM.depth],
      baseY: 0,
      masonry: {
        ...law, rise, courses: STAIRS.steps, head: null,
      },
    },
  ];
}

// How far the top tread is set below the platform it runs under. Two coplanar
// surfaces in the same place is a fight the depth buffer settles differently
// from one frame to the next; a centimetre is under a tenth of a course and
// nobody feels it.
export const TOP_STEP_DROP = 0.012;

// ------------------------------------------------------- what is underfoot

/**
 * Height of the stone of one built block under a world point, or -Infinity.
 *
 * IT CARRIES THE CHAMFER, and that is the whole difference between this and a
 * flat box. Every course of this world is dressed at its top edge — it is real
 * geometry and the reference's brightest single signal comes off it — so the
 * last 28 mm before the edge of a deck is a facet leaning up, and the stone
 * there is lower than the deck by as much as the chamfer itself. A contract
 * that answered the deck height right up to the edge would stand a walker 28 mm
 * over the stone the frame draws, on exactly the strip of a tread a foot lands
 * on. src/world/contracts.js says nothing in it may quietly become a different
 * answer from the one the frame draws; this is what that costs.
 *
 * @param {object[]} specs blocks with a `masonry` on them
 */
export function builtStoneAt(specs, x, z) {
  let best = -Infinity;
  for (const spec of specs) {
    const angle = spec.rotationY * DEG;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const dx = x - spec.position.x;
    const dz = z - spec.position.z;
    // Back into the block's own frame, which is the inverse of the turn the
    // mesh is hung with: world = (lx*c + lz*s, -lx*s + lz*c).
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    for (const deck of masonryDecks(spec)) {
      if (lx < deck.x0 || lx > deck.x1 || lz < deck.z0 || lz > deck.z1) continue;
      const chamfer = deck.chamfer ?? CHAMFER;
      const inside = Math.min(
        deck.dressed.x0 ? lx - deck.x0 : Infinity,
        deck.dressed.x1 ? deck.x1 - lx : Infinity,
        deck.dressed.z0 ? lz - deck.z0 : Infinity,
        deck.dressed.z1 ? deck.z1 - lz : Infinity,
      );
      const y = spec.baseY + deck.y - Math.max(0, chamfer - inside);
      if (y > best) best = y;
    }
  }
  return best;
}
