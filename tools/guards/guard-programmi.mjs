import { POSE_TARGET } from '../../src/core/poses.js';
import { reporter, selfTest } from './lib.mjs';
import {
  chunkUniforms, duplicateUniforms, refsIn, sourcesOfWorld, templates,
} from './lib/glsl-doppie.mjs';
import {
  POSE_P, VISITOR, bandDiff, bandLuma, bandSky, openVisitor, openWorld, plate,
  serveRepo, toolsPresent, visitorPlate,
} from './lib/quadro.mjs';

// GUARD-PROGRAMMI -- EVERY PROGRAM OF THIS WORLD COMPILES, LINKS, AND DRAWS.
//
// ===========================================================================
// THE INCIDENT THIS FILE IS THE ANSWER TO.
//
// E-LUCE5. The merge of cornice-1 onto the line U-LUCE-4 had built put two
// declarations of uAirBeta and uAirPale into one program: FOG_GLSL had grown
// them when the air went per channel, and distant.js declares them itself in
// the fallback it holds until air.js publishes a distant air of its own. GLSL
// calls that a redefinition. The hill and the lake programs stopped LINKING and
// nothing of the distant frame was drawn at all -- no crest, no water, two
// hundred metres of picture simply absent -- and the tip was green. Thirty
// seven guards out of thirty seven, all satisfied, because not one of them
// compiles GLSL.
//
// That is not a gap in a guard. It is a gap in the KIND of guard this
// repository had: forty one instruments that read source, and none that ran a
// frame. Source is the right instrument for a contract, a count, a winding or a
// constant, and it is structurally unable to answer the two questions that
// incident asked -- does it compile, and is it on the screen.
//
// ===========================================================================
// WHAT IT ASKS, AND WHY EACH LEG IS THERE.
//
//   0. AND THE HALF OF IT THAT IS FREE (D-C2-3). The defect above is a NAME
//      DECLARED TWICE IN ONE PROGRAM, and that much is visible in the sources
//      that MAKE the program -- no browser, no GPU, a tenth of a second. So it
//      is asked FIRST, before the world is even opened; it is asked under
//      --fast; and it is asked on a machine with no playwright on it, where
//      everything below this line SKIPs. The arithmetic is in
//      lib/glsl-doppie.mjs, and run over src/world/distant.js as it stood at
//      0a39c3f^ it names both broken programs, both uniforms and both chunks
//      that collided.
//      It does NOT replace the compiler: a driver catches redefinitions this
//      cannot see -- a name built by string arithmetic, a chunk reached through
//      a function this does not follow. And the compiler does not replace it
//      either, because this one answers before the browser is up, on a laptop
//      with no GPU, in the second after the merge instead of the minute.
//
//   1. EVERY PROGRAM THE PAGE LINKS, LINKED. The recorder in lib/quadro.mjs is
//      installed before three.js has a context, so no program can be built
//      without being seen -- there is no list here that a new material could
//      fail to be added to. LINK_STATUS and COMPILE_STATUS are read for all of
//      them at the end, and a failure brings the DRIVER'S OWN LOG back into
//      this report. E-LUCE5 dies here.
//
//   2. EVERY FAMILY OF THE WORLD IS AMONG THEM. A program that links is not the
//      same thing as a program that EXISTS: a family whose material was never
//      built, or whose mesh never entered the frame, links nothing and fails
//      nothing. So the families are named below with the count each one is
//      owed, matched by uniform names that only that family declares, and a
//      family that comes up short is a failure with its name on it.
//
//   3. AND THE PICTURE HAS THE FAMILY IN IT. A program can link and draw
//      nothing -- culled, transparent, behind the eye, black. So at the pose the
//      campaign judges this world on, and at three more bearings, the guard
//      counts pixels: the ground band must not be sky and must not be black,
//      the horizon band must not be sky, and the distant frame must be worth a
//      measurable share of the horizon band IN EVERY DIRECTION. That last one
//      is E-LUCE5 caught a second time, from the other end, by a leg that would
//      have failed even if the program had linked and returned black.
//
//   4. AND THE VISITOR'S PAGE HAS IT TOO, WHICH IS NOT THE SAME QUESTION.
//      E-SUOLO1, and it is the second incident this file is the answer to.
//
//      The committente opened http://localhost:4329 with no `?dev`, in his own
//      window, in the third person this world arrives in, and there was SKY
//      where the meadow is. This guard was 45 out of 45 on that tip -- and it
//      was not wrong, it was somewhere else: legs 1 to 3 measure `?dev`, and
//      the first three things openWorld does there are ask for a TIER BY HAND,
//      place the walker in FIRST person, and stand him on the fitted pose.
//
//      THE FIRST OF THOSE DOES NOT MERELY DIFFER FROM THE VISITOR'S PAGE. IT
//      REPAIRS IT. The tier's fraction of the ground was settled at
//      src/main.js:373 and the field it governs is built at :642, so the number
//      reached a world with no field in it and nothing carried it across; the
//      post chain took the field's own buffer on the strength of that answer
//      and dropped the ground out of the world's pass, and the mesh that was to
//      put it back stayed invisible. Asking for another tier settles the lever
//      a SECOND time, on a world that now has a field -- so the defect went
//      away in the act of being measured, and every plate this guard took was
//      of a world it had just healed.
//
//      So this leg opens the page the visitor is DELIVERED and touches nothing
//      in it: no `?dev`, no window.farfield, no pose, no person, no tier. It
//      passes «Clicca per esplorare» the way a visitor does, with a click, and
//      counts how much of the bottom of the frame is sky. It is the only leg
//      here whose measurement takes ONE plate, because the two-plate trick the
//      others stand on needs a handle into the scene that this page must never
//      be given -- see bandSky in lib/quadro.mjs.
//
// ===========================================================================
// WHAT IT COSTS AND WHAT --fast BUYS.
//
// Measured on this desk, tier alto, 960x540, against a server already up: the
// world is walkable at ~9 s, the census is read at ~12 s, the twelve plates of
// the smoke land at ~21 s, and LEG 4's single plate of the visitor's page --
// its own browser, its own load, the meadow waited for and a click -- lands at
// ~40 s. The smoke is still ON by default: E-SUOLO1 is the second incident in
// this file's short life where a green suite shipped a world with a family
// missing from it, and both times what was missing was missing from the page
// nobody was photographing. Twenty seconds is what that costs.
//
//   --fast   drops the plates and keeps leg 0 and the compiler. The census is
//            the leg that cannot be got any other way; the picture can also be
//            read off a bench plate by a human. If a machine is ever too slow
//            for the whole thing, this is the half to keep. Leg 0 is not part
//            of the trade: it costs a tenth of a second and always runs.
//   --port=N reuse a development server that is already up on N instead of
//            starting one. Nothing else in this guard has a port in it.

const flags = process.argv.slice(2);
const FAST = flags.includes('--fast');
const PORT_FLAG = flags.find((f) => f.startsWith('--port='));
const REUSE = PORT_FLAG ? Number(PORT_FLAG.slice(7)) : null;

// ---------------------------------------------------------------- the families
//
// EACH ONE IS NAMED BY UNIFORMS AND NOT BY A FILE, and the reason is that a
// guard cannot see a file from inside a driver. What comes back from the page is
// a program: its link status, its logs, and the names it declares. The names are
// the only handle there is, and they are a good one -- `uPebMix` is the paving's
// and nobody else's, `uWater` is the lake's -- so the table below is a table of
// FINGERPRINTS, each one checked to match exactly one program and no other.
//
// `lacks` exists for the two families whose own names are all shared. The sky is
// the only lit thing in this world that is not in the air, so it declares the
// sky ramp and no fog; the loose stones are the only pigmented arris with no
// joint. Both are stated rather than hinted at, because a fingerprint that
// happens to be unique today and is not SAID to be unique is a fingerprint that
// silently starts matching two programs the day somebody adds a third.
//
// COUNTS ARE WHAT THE PAGE ACTUALLY BUILDS at the pose, measured, not what the
// mandate guessed. Two flower programs because the white and the blue beds are
// two materials; two avatars because the world carries both bodies; two blurs
// because the halo is taken down and put back up.
const FAMILIES = [
  { id: 'cielo', what: 'the sky dome', has: ['uSkyRamp', 'uSunDisc'], lacks: ['uFogColour'], owed: 1 },
  { id: 'campo', what: 'the meadow field, raymarched', has: ['tField', 'tFar'], owed: 1 },
  { id: 'selciato', what: 'the paving of the hub', has: ['uPebMix'], owed: 1 },
  { id: 'cubi', what: 'the greedy cubes (today: the trees)', has: ['uShadeMap'], owed: 1 },
  { id: 'monoliti', what: 'the masonry of the five blocks', has: ['tInk'], owed: 1 },
  { id: 'monoliti-segno', what: 'the marker at the foot of each block', has: ['uCore', 'uHalo'], lacks: ['uFogColour'], owed: 1 },
  { id: 'rocce', what: 'the rocks and the slabs', has: ['uSlabFalloff'], owed: 1 },
  { id: 'pietre-sciolte', what: 'the loose stones', has: ['uArrisPigment'], lacks: ['uJoint'], owed: 1 },
  { id: 'colline', what: 'the hills of the cornice', has: ['uPalette', 'uAirPale'], owed: 1 },
  { id: 'campo-ricomposto', what: 'the earth brought back to full resolution', has: ['tCampo', 'tCampoDepth'], owed: 1 },
  { id: 'lago', what: 'the water of the cornice', has: ['uWater'], owed: 1 },
  { id: 'nuvole', what: 'the weather, cumuli of cubes', has: ['uCloudSun', 'uCloudTerms'], owed: 1 },
  { id: 'manto', what: 'the carpet and the tufts', has: ['tAtlas', 'uCutoff'], owed: 1 },
  { id: 'fiori', what: 'the flower beds, white and blue', has: ['uStalk', 'uHoleOpen'], owed: 2 },
  { id: 'fiori-lontani', what: 'the far flower rim', has: ['uHeadAlpha', 'uRing'], owed: 1 },
  { id: 'avatar', what: 'the two bodies', has: ['uPose', 'uOverhangCells'], owed: 2 },
  { id: 'post-soglia', what: 'the bright pass of the bloom', has: ['uThreshold', 'uKnee'], owed: 1 },
  { id: 'post-sfocatura', what: 'the bloom taken down and put back up', has: ['uHalfPixel'], owed: 2 },
  { id: 'post-composito', what: 'the composite, the grade and the eye', has: ['tLut', 'uLutSize'], owed: 1 },
];

// THE ONE FAMILY THE POSE CANNOT BUILD, DECLARED RATHER THAN OMITTED.
//
// A panel is made the first time a walker stands in front of a face and presses
// E: createPanels() builds nothing, makePanel() runs on show(). From a camera
// placed by setDevPose there is no walker and no keypress, so at pose P this
// program does not exist -- and a guard that demanded it would be red on a
// correct world for ever. It is registered here so that it is CHECKED if it
// ever does turn up in the census, and NOTEd when it does not, which is the
// honest shape of a leg that is armed and has nothing to bite on. Bringing it
// under leg 1 needs a harness that can walk the body to a face; that is written
// down as this unit's residue and not smuggled in as a pass.
const LAZY = [
  { id: 'pannelli', what: 'a face of a monolith, opened', has: ['uScroll', 'uSelect'], owed: 0 },
];

// ------------------------------------------------------------------ the bands
//
// WHERE THE PICTURE IS CUT, IN FRACTIONS OF ITS OWN HEIGHT, read off the frame
// rather than derived from the projection. At pose P, per row, the share of the
// frame that is not sky runs: nought down to y=0.11 (open sky), 0.125 from 0.13
// to 0.28 (the blocks standing into it), then the climb through the crest and
// the meadow's edge from 0.33, reaching one at 0.556 and holding it to the
// bottom. So:
//
//   ORIZZONTE 0.33..0.65 is the band the distant frame lives in. The hills and
//   the lake move pixels across all of it and nowhere below it -- measured, the
//   fondale's contribution is nought at row 0.667 and after.
//   SUOLO 0.75..1.00 is ground and only ground at every bearing.
const ORIZZONTE = [0.33, 0.65];
const SUOLO = [0.75, 1.00];

// AND THE BAND LEG 4 READS, WHICH IS ITS OWN BECAUSE THE FRAMING IS ITS OWN.
// The visitor is not on pose P: he is where the page puts him, in third person,
// with his own body in the middle of the lower frame. 0.80..1.00 is ground and
// body at that framing and never horizon, in a window of 845 rows -- and the
// body is dark cloth and stone, which is not sky by any reading.
const SUOLO_VIS = [0.80, 1.00];

// THE FOUR DIRECTIONS, as turns off the fitted bearing. The fit is one camera
// looking one way and the cornice is a RING; a horizon that closes in front of
// the visitor and opens a hole behind him is not a horizon. Four is what fits
// in the budget and it is enough to catch a family that is not being drawn at
// all, which is what a smoke is for -- the skyline itself, per bearing and to
// half a degree, is guard-cornice's job and is measured off the geometry.
const BEARINGS = [0, 90, 180, 270];

// ----------------------------------------------------------------- the floors
//
// EVERY FLOOR IS ROUGHLY HALF OF THE WORST READING TAKEN TODAY, and that ratio
// is the whole design of a smoke. This instrument is not here to notice that
// the hills moved a metre -- guard-cornice reads the skyline to half a degree
// and would say so first. It is here to notice that a family is NOT ON THE
// SCREEN, and between "drawn" and "not drawn" there is a factor of infinity, so
// a floor at half the worst reading never fires on a picture that changed and
// always fires on a picture that lost something.
const FLOORS = {
  // The ground band is not sky, in every direction.
  suolo: 0.97,
  // And it is not black either. A program that links and returns zero would
  // pass the leg above -- black is not sky -- and dies here.
  suoloLuma: 12,
  // The horizon band is not sky either: something stands in it.
  orizzonte: 0.50,
  // And a measurable share of what stands in it is the DISTANT frame. This is
  // E-LUCE5's own leg: with the hills and the lake gone, this many pixels of
  // the band go back to being sky.
  fondale: 0.15,
};

// AND LEG 4's ONE FLOOR, on the same rule and with the same arithmetic behind
// it: the share of the visitor's ground band that is NOT sky. Measured on this
// desk at the committente's own window -- 99.9% with the meadow drawn, 12.0%
// with it missing -- so half of the worst reading is a floor that cannot fire
// on a picture that merely changed and cannot fail to fire on E-SUOLO1.
const VISITOR_FLOOR = { suolo: 0.50 };

// AT_TODAY, taken at the tip this file was written on (b672f45 + this commit),
// tier alto, 960x540, ANGLE/D3D11 on AMD Radeon integrated. Per bearing: the
// share of the horizon band that is not sky, the share of it the fondale is
// worth, the share of the ground band that is not sky, and what the ground band
// is worth in light out of 255.
//
// It is a READING and not a threshold. The floors above are what fails; this is
// what the picture measured on the day, so that a run which passes with half
// the margin it had says so in a NOTE instead of going quietly green.
const AT_TODAY = {
  programs: 21,
  0: { orizzonte: 0.862, fondale: 0.292, suolo: 1.000, luma: 56.9 },
  90: { orizzonte: 0.775, fondale: 0.769, suolo: 1.000, luma: 38.8 },
  180: { orizzonte: 0.915, fondale: 0.381, suolo: 1.000, luma: 49.4 },
  270: { orizzonte: 0.719, fondale: 0.711, suolo: 1.000, luma: 54.1 },
  // Leg 4's own reading, taken the day E-SUOLO1 was closed: the visitor's page
  // at 1892x845, third person, cured. The same plate before the cure read
  // 0.120, which is the number this leg exists to refuse.
  visitatore: { suolo: 0.999 },
};

// The children of the scene that are the distant frame, by name. Two names and
// not a group, because that is what the scene actually carries.
const FONDALE = ['colline', 'lago'];

// ===========================================================================
// THE VERDICTS. Both are pure functions of a reading, so the self test can put
// a defect through them without a browser, and so that nothing that decides a
// colour is written twice.

/**
 * The census of one page's programs, against the table of families.
 *
 * @param {object[]} programs what the recorder handed back
 * @param {object[]} families the table, plus any lazily built ones
 */
export function census(programs, families) {
  const broken = [];
  for (const program of programs) {
    const why = [];
    if (!program.alive) why.push('the program was deleted before it could be read');
    else if (!program.linked) why.push(`LINK failed: ${(program.log || '(no log)').trim()}`);
    for (const stage of program.stages) {
      if (stage.compiled === false) {
        why.push(`${stage.stage} COMPILE failed: ${(stage.log || '(no log)').trim()}`);
      }
    }
    if (why.length) broken.push({ index: program.index, why });
  }

  const named = new Map(families.map((f) => [f.id, []]));
  const unknown = [];
  const ambiguous = [];
  for (const program of programs) {
    const names = new Set(program.stages.flatMap((s) => s.uniforms));
    const hits = families.filter((f) => f.has.every((u) => names.has(u))
      && !(f.lacks || []).some((u) => names.has(u)));
    if (hits.length === 0) unknown.push({ index: program.index, names: [...names] });
    else if (hits.length > 1) ambiguous.push({ index: program.index, ids: hits.map((f) => f.id) });
    else named.get(hits[0].id).push(program.index);
  }

  const short = families.filter((f) => named.get(f.id).length < f.owed);
  const over = families.filter((f) => named.get(f.id).length > f.owed);
  return { broken, named, unknown, ambiguous, short, over };
}

/**
 * The verdict of the smoke, over the readings taken at every bearing.
 *
 * @param {object[]} readings {turn, orizzonte, fondale, suolo, luma}
 * @param {object} floors
 */
export function smokeVerdict(readings, floors) {
  const fails = [];
  for (const r of readings) {
    if (r.suolo < floors.suolo) {
      fails.push(`${r.turn}: the ground band is ${(r.suolo * 100).toFixed(1)}% world, floor ${floors.suolo * 100}%`);
    }
    if (r.luma < floors.suoloLuma) {
      fails.push(`${r.turn}: the ground band is worth ${r.luma.toFixed(1)} in light, floor ${floors.suoloLuma}`);
    }
    if (r.orizzonte < floors.orizzonte) {
      fails.push(`${r.turn}: the horizon band is ${(r.orizzonte * 100).toFixed(1)}% world, floor ${floors.orizzonte * 100}%`);
    }
    if (r.fondale < floors.fondale) {
      fails.push(`${r.turn}: the distant frame is worth ${(r.fondale * 100).toFixed(1)}% of the horizon band, floor ${floors.fondale * 100}%`);
    }
  }
  return fails;
}

/**
 * The verdict of leg 4, over the one reading the visitor's page gives up.
 *
 * Pure, like the two above, so the self test can put E-SUOLO1's own numbers
 * through it with no browser in the room.
 *
 * @param {object} reading {suolo, persona}
 * @param {object} floors
 */
export function visitorVerdict(reading, floors) {
  const fails = [];
  if (reading.suolo < floors.suolo) {
    fails.push(`the visitor's ground band is ${(reading.suolo * 100).toFixed(1)}% world,`
      + ` floor ${floors.suolo * 100}% -- the page a visitor is handed has sky where the meadow is`);
  }
  // THE PERSON IS PART OF THE READING AND NOT A SEPARATE LEG. What was reported
  // was the THIRD person view, and a page that quietly arrived in first person
  // would be photographing a framing nobody is delivered -- green, and about
  // the wrong picture.
  if (reading.persona !== 'terza') {
    fails.push(`the visitor's page arrived in ${reading.persona} person: this world arrives in third`);
  }
  return fails;
}

// ===========================================================================

const started = Date.now();
const { chromium, sharp, missing } = toolsPresent();
const SELF = flags.includes('--self');

// THE STATIC LEG IS ASKED BEFORE ANYTHING ELSE AND OUTSIDE EVERY CONDITION.
// It needs no browser, no server and no GPU, so a machine that cannot run the
// census still gets it -- and a run that is going to SKIP still reports it.
const doubles = SELF ? [] : duplicateUniforms(sourcesOfWorld());

if (missing.length && !SELF) {
  const report = reporter('guard-programmi -- every program compiles, links and draws');
  report.check(doubles.length === 0,
    '0. nessuna uniform dichiarata due volte fra i sorgenti concatenati',
    doubles.length ? `${doubles.length} programmi` : 'letto senza driver, su tutti i sorgenti di src/');
  for (const bad of doubles) {
    report.line(`        ${bad.file}:${bad.line} [${bad.program}] ${bad.clashes.join(', ')}`);
  }
  if (doubles.length) report.end();
  report.skip(`no ${missing.join(' and ')} on this machine: the census needs a browser and the smoke needs a decoder`);
}
if (missing.length && SELF) {
  process.stdout.write(`SKIP  no ${missing.join(' and ')} on this machine\n`);
  process.exit(0);
}

let server = null;
let world = null;
let visitor = null;

/**
 * Leg 4, whole: the visitor's page, opened, walked into, and read once.
 *
 * IT IS ITS OWN BROWSER AND THAT IS DELIBERATE. The world above has had a tier
 * asked of it by hand, a person placed and a pose imposed, and every one of
 * those is the thing this leg exists NOT to have done. A second context in the
 * same browser would still be a second page, but the separation is worth saying
 * out loud in a file whose whole subject is a measurement that healed what it
 * measured.
 *
 * @returns {object} {suolo, persona, campo, driver} -- and campo is REPORTED and
 *   never judged: it is the world's own half of E-SUOLO1's lever, carried into
 *   the failure message so that a red run names the state instead of the pixel.
 */
async function measureVisitor(port) {
  visitor = await openVisitor({ chromium, port });
  const seen = await visitorPlate(visitor, sharp);
  return {
    suolo: 1 - bandSky(seen, SUOLO_VIS),
    persona: await visitor.person(),
    campo: await visitor.campo(),
    driver: visitor.driver,
  };
}

/** Everything the page can tell us, taken once and used by both modes. */
async function measure({ smoke }) {
  server = await serveRepo(REUSE);
  world = await openWorld({ chromium, port: server.port });
  const programs = await world.programs();
  const stats = await world.stats();
  const tier = await world.tierId();
  if (!smoke) return { programs, stats, tier, readings: [], plates: null };

  // TWELVE PLATES, IN THREE SWEEPS AND NOT TWELVE. Visibility is set once per
  // sweep and the camera is turned inside it, because every change of what is
  // drawn costs a settle and every turn costs one frame.
  const full = {};
  const bare = {};
  const skies = {};
  await world.show([]);
  for (const turn of BEARINGS) full[turn] = await plate(world, sharp, { turnDeg: turn });
  await world.show(FONDALE);
  for (const turn of BEARINGS) bare[turn] = await plate(world, sharp, { turnDeg: turn });
  await world.show([], ['sky', 'clouds']);
  for (const turn of BEARINGS) skies[turn] = await plate(world, sharp, { turnDeg: turn });
  await world.show([]);

  const readings = BEARINGS.map((turn) => ({
    turn,
    orizzonte: bandDiff(full[turn], skies[turn], ORIZZONTE),
    fondale: bandDiff(full[turn], bare[turn], ORIZZONTE),
    suolo: bandDiff(full[turn], skies[turn], SUOLO),
    luma: bandLuma(full[turn], SUOLO).mean,
  }));
  return { programs, stats, tier, readings, plates: { full, bare, skies } };
}

if (SELF) {
  // THE TWO DEFECTS, INJECTED FOR REAL AND NOT DESCRIBED.
  //
  // The first is E-LUCE5 itself, compiled: a throwaway program on a throwaway
  // context declaring uAirPale twice. It goes through the same recorder, the
  // same driver and the same census as everything else, so what is being tested
  // is the instrument and not a story about it. The second switches the hills
  // and the lake off and puts the frame back through the smoke.
  const cases = [];

  // ---- LEG 0's own injections, into the REAL sources and not an imitation.
  //
  // The defect is put where it actually shipped: inside a template literal that
  // already splices a chunk, declaring by hand a name that chunk declares. The
  // literal and the name are FOUND rather than written down, so no rewrite of
  // any shader in this tree can turn these into no-ops -- which is how a self
  // test quietly stops testing anything.
  const clean = sourcesOfWorld();
  cases.push({
    what: 'i sorgenti come stanno non dichiarano nessuna uniform due volte',
    caught: duplicateUniforms(clean).length === 0,
  });

  const spot = (() => {
    for (const [file, text] of clean) {
      for (const t of templates(text)) {
        for (const ref of refsIn(t.body)) {
          const declares = chunkUniforms(clean, ref);
          if (declares.length) return { file, text, at: t.at, ref, name: declares[0] };
        }
      }
    }
    return null;
  })();

  cases.push({
    what: spot
      ? `una uniform del pezzo ${spot.ref} ridichiarata a mano nel programma che lo innesta `
        + `(${spot.file.split('/').pop()}, ${spot.name})`
      : 'nessun programma di questo albero innesta un pezzo con uniform: niente da iniettare',
    caught: Boolean(spot) && (() => {
      const dirty = new Map(clean);
      dirty.set(spot.file, `${spot.text.slice(0, spot.at + 1)}\n  uniform float ${spot.name};\n`
        + `${spot.text.slice(spot.at + 1)}`);
      // Not «exactly one finding»: the literal the defect is put in may itself
      // be a chunk that several programs splice, and then every one of them is
      // broken. What is asserted is that this file and this name come back.
      return duplicateUniforms(dirty).some((f) => f.file === spot.file
        && f.clashes.some((c) => c.startsWith(`${spot.name} `)));
    })(),
  });

  cases.push({
    what: 'lo stesso pezzo innestato due volte nello stesso programma',
    caught: Boolean(spot) && (() => {
      const dirty = new Map(clean);
      dirty.set(spot.file, `${spot.text.slice(0, spot.at + 1)}\n  \${${spot.ref}}\n`
        + `${spot.text.slice(spot.at + 1)}`);
      return duplicateUniforms(dirty).some((f) => f.file === spot.file);
    })(),
  });

  cases.push({
    what: 'e due PROGRAMMI DIVERSI che dichiarano lo stesso nome non sono un difetto',
    caught: Boolean(spot) && (() => {
      const dirty = new Map(clean);
      dirty.set('src/__banco-due-programmi.js', `const A = /* glsl */\`\n  uniform float ${spot.name};\n`
        + `  \${${spot.ref}}\n\`;\nconst B = /* glsl */\`\n  uniform float ${spot.name};\n\`;\n`);
      // the first literal DOES clash (it splices the chunk); the second does
      // not, because nothing is spliced into it. One finding, not two.
      const found = duplicateUniforms(dirty).filter((f) => f.file === 'src/__banco-due-programmi.js');
      return found.length === 1 && found[0].program === 'A';
    })(),
  });

  const taken = await measure({ smoke: !FAST });

  cases.push({
    what: 'a clean page has no broken program and no family short',
    caught: census(taken.programs, [...FAMILIES, ...LAZY]).broken.length === 0
      && census(taken.programs, [...FAMILIES, ...LAZY]).short.length === 0,
  });

  await world.inject(true);
  const after = await world.programs();
  const dirty = census(after, [...FAMILIES, ...LAZY]);
  cases.push({
    what: 'a uniform declared twice in a program of its own is caught, with the compiler\'s log',
    caught: dirty.broken.length === 1
      && dirty.broken[0].why.some((line) => /COMPILE failed/.test(line) && line.length > 20),
  });

  if (!FAST) {
    cases.push({
      what: 'the picture as it stands passes the smoke',
      caught: smokeVerdict(taken.readings, FLOORS).length === 0,
    });
    await world.show(FONDALE);
    const off = {};
    for (const turn of BEARINGS) off[turn] = await plate(world, sharp, { turnDeg: turn });
    const blind = BEARINGS.map((turn) => ({
      turn,
      orizzonte: bandDiff(off[turn], taken.plates.skies[turn], ORIZZONTE),
      fondale: bandDiff(off[turn], taken.plates.bare[turn], ORIZZONTE),
      suolo: bandDiff(off[turn], taken.plates.skies[turn], SUOLO),
      luma: bandLuma(off[turn], SUOLO).mean,
    }));
    cases.push({
      what: 'the distant frame switched off is caught in every direction',
      caught: BEARINGS.every((turn) => smokeVerdict(blind.filter((r) => r.turn === turn), FLOORS)
        .some((line) => line.includes('distant frame'))),
    });
    cases.push({
      what: 'a ground band gone black is caught',
      caught: smokeVerdict([{ turn: 0, orizzonte: 1, fondale: 1, suolo: 1, luma: 0 }], FLOORS)
        .some((line) => line.includes('in light')),
    });
    cases.push({
      what: 'a ground band gone to sky is caught',
      caught: smokeVerdict([{ turn: 0, orizzonte: 1, fondale: 1, suolo: 0, luma: 60 }], FLOORS)
        .some((line) => line.includes('ground band')),
    });

    // ---- LEG 4's verdict, put through E-SUOLO1's OWN NUMBERS.
    //
    // Not an imitation of them: 0.120 and 0.999 are the two readings this desk
    // took off the visitor's page at 1892x845, before the cure and after it,
    // and they are what the floor has to separate. A self test written against
    // rounder numbers would be a test of the arithmetic and not of the choice.
    cases.push({
      what: 'the visitor\'s page as measured after the cure passes leg 4 (0.999)',
      caught: visitorVerdict({ suolo: 0.999, persona: 'terza' }, VISITOR_FLOOR).length === 0,
    });
    cases.push({
      what: 'E-SUOLO1 as it was actually measured is caught (0.120 of the band is world)',
      caught: visitorVerdict({ suolo: 0.120, persona: 'terza' }, VISITOR_FLOOR)
        .some((line) => line.includes('sky where the meadow is')),
    });
    cases.push({
      what: 'and a visitor\'s page that quietly arrived in first person is caught too',
      caught: visitorVerdict({ suolo: 0.999, persona: 'prima' }, VISITOR_FLOOR)
        .some((line) => line.includes('third')),
    });
    // AND E-SUOLO1 ITSELF, PHOTOGRAPHED RATHER THAN DESCRIBED. The sweep above
    // already took a plate of this world with everything but the sky and the
    // weather switched off, which is precisely the frame the committente was
    // handed: a ground band with no ground in it. So the leg's own measure and
    // the leg's own floor are run over TWO REAL FRAMES, one with the meadow and
    // one without, and what is asserted is that they come out on opposite sides
    // of the floor. There is no constant in this case to get wrong.
    const withGround = 1 - bandSky(taken.plates.full[0], SUOLO_VIS);
    const without = 1 - bandSky(taken.plates.skies[0], SUOLO_VIS);
    cases.push({
      what: `a real frame whose ground is switched off fails leg 4 (${(without * 100).toFixed(1)}% world)`,
      caught: visitorVerdict({ suolo: without, persona: 'terza' }, VISITOR_FLOOR)
        .some((line) => line.includes('sky where the meadow is')),
    });
    cases.push({
      what: `and the same frame with its ground passes it (${(withGround * 100).toFixed(1)}% world)`,
      caught: visitorVerdict({ suolo: withGround, persona: 'terza' }, VISITOR_FLOOR).length === 0,
    });
  }

  await world.close();
  await server.stop();
  selfTest('guard-programmi', cases);
}

const report = reporter('guard-programmi -- every program compiles, links and draws');

// LEG 0 -- the free half, read off the sources with no driver in it. It is
// printed BEFORE the world is opened, so a tip whose world will not even load
// still hands back the one answer that cost nothing.
report.check(doubles.length === 0,
  '0. nessuna uniform dichiarata due volte fra i sorgenti concatenati',
  doubles.length ? `${doubles.length} programmi` : 'su tutti i sorgenti di src/, senza driver');
for (const bad of doubles) {
  report.line(`        ${bad.file}:${bad.line} [${bad.program}] ${bad.clashes.join(', ')}`);
}

let taken;
try {
  taken = await measure({ smoke: !FAST });
} catch (error) {
  if (world) await world.close().catch(() => {});
  if (server) await server.stop().catch(() => {});
  report.check(false, 'the world loads at all', error.message);
  report.end();
}

const { programs, stats, tier, readings } = taken;
report.line(`  driver ${world.driver}`);
report.line(`  tier ${tier}, ${stats.drawCalls} draws, ${stats.triangles} triangles`);

// LEG 1 -- the compiler's own answer for every program the page built.
const seen = census(programs, [...FAMILIES, ...LAZY]);
report.check(programs.length > 0, 'the page linked programs at all', `${programs.length} recorded`);
report.check(seen.broken.length === 0,
  `all ${programs.length} programs link, and every shader of them compiles`,
  seen.broken.length ? `${seen.broken.length} broken` : '');
for (const bad of seen.broken) {
  for (const line of bad.why) report.line(`        program ${bad.index}: ${line}`);
}
report.check(programs.every((p) => p.stages.length >= 2),
  'every program carries a vertex stage and a fragment stage');

// LEG 2 -- and every family of this world is among them.
for (const family of FAMILIES) {
  const found = seen.named.get(family.id);
  report.check(found.length >= family.owed, `${family.id.padEnd(16)} ${family.what}`,
    `${found.length}/${family.owed}${found.length ? ` [${found.join(' ')}]` : ''}`);
}
for (const family of LAZY) {
  const found = seen.named.get(family.id);
  if (found.length) report.line(`  ok    ${family.id.padEnd(16)} ${family.what}  [${found.join(' ')}]`);
  else report.note(`${family.id}: ${family.what} is built on a keypress, so pose P never has one -- not checked`);
}
report.check(seen.ambiguous.length === 0, 'no fingerprint matches two families',
  seen.ambiguous.map((a) => `${a.index} -> ${a.ids.join('+')}`).join(' | '));
for (const odd of seen.unknown) {
  report.note(`program ${odd.index} matches no family; name it in FAMILIES -- it declares ${odd.names.filter((n) => /^[ut][A-Z]/.test(n)).slice(0, 8).join(' ')}`);
}
for (const family of seen.over) {
  if (family.owed === 0) continue;   // a lazily built family has already had its line
  report.note(`${family.id} came back ${seen.named.get(family.id).length} times and is owed ${family.owed}`);
}
report.check(programs.length >= AT_TODAY.programs,
  `the census is at least the ${AT_TODAY.programs} programs this file was written against`,
  `${programs.length} today`);

// The pose is the campaign's, and it is checked against the module rather than
// trusted, because a copy of six numbers is where two names stop meaning one
// camera.
report.check(POSE_P.x === POSE_TARGET.position.x && POSE_P.y === POSE_TARGET.position.y
  && POSE_P.z === POSE_TARGET.position.z && POSE_P.yaw === POSE_TARGET.yaw
  && POSE_P.pitch === POSE_TARGET.pitch && POSE_P.fov === POSE_TARGET.fov,
'the pose the frame was taken at is POSE_TARGET of src/core/poses.js');

// LEG 3 -- and the picture has them in it.
if (FAST) {
  report.note('--fast: the smoke was not run, so a program that links and draws nothing goes through');
} else {
  const fails = smokeVerdict(readings, FLOORS);
  for (const r of readings) {
    const at = AT_TODAY[r.turn];
    report.line(`  P+${String(r.turn).padStart(3)}  horizon ${(r.orizzonte * 100).toFixed(1)}% world`
      + ` (${(at.orizzonte * 100).toFixed(1)} today), fondale ${(r.fondale * 100).toFixed(1)}%`
      + ` (${(at.fondale * 100).toFixed(1)}), ground ${(r.suolo * 100).toFixed(1)}%`
      + ` (${(at.suolo * 100).toFixed(1)}) at ${r.luma.toFixed(1)}/255 (${at.luma.toFixed(1)})`);
  }
  report.check(fails.length === 0,
    `the ground, the horizon and the distant frame are on the screen at ${BEARINGS.length} bearings`,
    fails.join(' | '));
  for (const r of readings) {
    const at = AT_TODAY[r.turn];
    if (r.fondale < at.fondale * 0.6) {
      report.note(`P+${r.turn}: the fondale is worth ${(r.fondale * 100).toFixed(1)}% of the horizon band`
        + ` against ${(at.fondale * 100).toFixed(1)}% when this file was written -- above the floor, and drifting`);
    }
  }
}

if (world.noise.length) {
  report.note(`the page logged ${world.noise.length} error(s): ${world.noise.slice(0, 2).join(' | ')}`);
}
if (!/D3D11|Metal|OpenGL/i.test(world.driver) || /SwiftShader/i.test(world.driver)) {
  report.note(`the frame was drawn by ${world.driver}: the floors were measured on a real driver`);
}

// THE DEVELOPMENT PAGE IS SHUT BEFORE THE VISITOR'S IS OPENED. Two headless
// contexts holding the same GPU is a measurement about a busy machine, and the
// one thing this leg must not be is another reading of how loaded the desk is.
await world.close();

// LEG 4 -- and the page the VISITOR is handed has the ground in it.
if (FAST) {
  report.note('--fast: the visitor\'s page was not opened either, so E-SUOLO1 goes through');
} else {
  let vis = null;
  try {
    vis = await measureVisitor(server.port);
  } catch (error) {
    report.check(false, 'the visitor\'s page loads and its meadow arrives', error.message);
  }
  if (vis) {
    const at = AT_TODAY.visitatore;
    const held = vis.campo
      ? `campo a ${vis.campo.scale} di lato, ricomposizione ${vis.campo.resolve ? 'visibile' : 'nascosta'}`
      : 'nessun window.voxcampo sulla pagina';
    report.line(`  visitatore ${VISITOR.width}x${VISITOR.height}, ${vis.persona} persona,`
      + ` ground ${(vis.suolo * 100).toFixed(1)}% world (${(at.suolo * 100).toFixed(1)} today) -- ${held}`);
    const fails = visitorVerdict(vis, VISITOR_FLOOR);
    report.check(fails.length === 0,
      'the page a visitor is delivered has the meadow on the screen, with no handle touched',
      fails.join(' | '));
    if (visitor.noise.length) {
      report.note(`the visitor's page logged ${visitor.noise.length} error(s): ${visitor.noise.slice(0, 2).join(' | ')}`);
    }
  }
  if (visitor) await visitor.close().catch(() => {});
}

await server.stop();

report.end(`${((Date.now() - started) / 1000).toFixed(1)} s, server ${server.borrowed ? `borrowed on ${server.port}` : `started on ${server.port}`}`);
