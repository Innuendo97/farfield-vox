import { createHash } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import { MONOLITHS } from '../../src/world/layout.js';
import { ZONE } from '../../src/world/voxel/campo.js';
import {
  LUMA_FLOOR, SEATS, blockDistance, blockTerm, lawAt, paintZone, readResidual, residualAt,
} from '../zone/paint-zone.mjs';
import { read, reporter, selfTest, REPO_ROOT } from './lib.mjs';
import { bandDiff, openWorld, plate, serveRepo, toolsPresent } from './lib/quadro.mjs';

// GUARD-ZONE -- THE LIGHT BY PLACE, AND THE DARK AT THE FOOT OF THE BLOCKS.
//
// ===========================================================================
// WHAT THIS GUARD IS FOR, IN ONE SENTENCE: this world's meadow varies by PLACE
// now, and it does so through exactly one picture, read by every program that
// draws the ground or stands on it -- the day any of them stops reading it, a
// band of shade has flowers standing in it at open-meadow brightness, and
// nothing else in the campaign would notice.
//
// THE THREE THINGS IT HOLDS.
//
//   THE TERM. That every program which HOLDS the map actually READS it, and
//     that the map is on the tint and never on a lamp. Both are measured, not
//     matched: one family's zone is made blind on the running page and the
//     pixels that move are counted, and the compiled programs are asked which
//     varyings the term reached. See «the term» below for the seven regular
//     expressions this replaced and what they could not see.
//
//   THE MAP. The delivered picture is repainted from its own sources -- the
//     seats of the world, the residual measured off the reference, and the
//     light chain that carries a luma into a light -- and compared BYTE FOR
//     BYTE against what ships. That is what makes the asset a function of the
//     world rather than a file somebody once made: move a block, move the seal,
//     move the grade cube, and this goes red instead of the meadow going
//     quietly wrong.
//
//   THE FOOT. Per block, on the map itself: how deep the dark at the foot goes
//     and how far it reaches, against R1 §1.7's own three to five metres.
//
// AND WHAT IT DELIBERATELY DOES NOT GATE is the decile of the frame, which is
// the campaign's headline reading of this meadow and is NOT this unit's alone
// to close. It is printed every run, with its number and its owners, for the
// reason guard-prato states at its own head: a gate on a number a session
// cannot move is a gate that gets disabled.
//
// THE MAP, THE FOOT AND THE RESIDUAL RUN UNDER PLAIN NODE, like guard-prato and
// guard-scala, because they have to be askable at every commit on any machine.
// THE TERM needs a frame and a driver, so it is asked last and it SKIPs, out
// loud, on a machine with no browser -- with --fast, or with no playwright, the
// run says in a NOTE that a program which stopped reading the map would go
// through. `--port=N` lends it a development server that is already up.

const SHIPPED = join(REPO_ROOT, 'assets-src', 'materia', 'zone-shade.png');

// --fast   the map, the foot and the residual only: no browser, no frame.
// --port=N reuse a development server already up on N instead of starting one.
const flags = process.argv.slice(2);
const FAST = flags.includes('--fast');
const PORT_FLAG = flags.find((f) => f.startsWith('--port='));
const PORT = PORT_FLAG ? Number(PORT_FLAG.slice(7)) : null;

// ============================================================== the term
//
// U-GUARDIA-3: WHY THIS HALF WAS THROWN AWAY AND REWRITTEN.
//
// The term used to be seven REGULAR EXPRESSIONS over the text of campo-
// material.js and vegetation.js, each matching one exact statement --
// `vTint = head * aLook.y * zoneAt(aFlower.xz);` and `vEmit = halo;` among
// them -- and the head of this file argued for it: «they are matched as text
// because there is no way to ask a compiled shader whether it still believes
// the ground has weather».
//
// THAT ARGUMENT WAS ALREADY WRONG WHEN IT WAS WRITTEN, and E-FIORI8 collected
// the bill: the first rewrite of the flower vertex moved the lines and the
// guard came down on correct work. Worse than the false alarm is what the
// shape could never see. It knew about FOUR programs because four statements
// had been written down here; the page actually hands this map to EIGHT
// materials -- the field, the paving, the sprays, both flower beds, the far
// rim, the tree crowns and the trunks -- and a ninth could arrive tomorrow
// with nothing here to notice. And when U-FIORI-8 gave the far family a
// SECOND tint varying (`vLid`), no regex here was watching it: the far heads
// could have kept their lids at open-meadow brightness inside a band of shade
// and every assertion in this file would have stayed green.
//
// SO THE TERM IS MEASURED NOW, IN TWO WAYS, AND NEITHER IS A LITERAL.
//
//   ON THE FRAME, BY INJECTION. Every material that carries the map has its
//   OWN copy of the pair -- zoneUniforms() builds a fresh one per program --
//   so ONE family can be made blind while every other keeps its weather:
//   uZone.z to nought sends every fetch to the clamped rim, which the painter
//   guarantees is open meadow. Take the frame; take it again with one family
//   blind; the pixels that MOVED are the pixels that family was reading the
//   weather for. A program that has stopped reading it moves nothing. And
//   there is no list here it could fail to be added to: the families are
//   whatever the scene is carrying when the guard looks.
//
//   ON THE COMPILED PROGRAM, AS DATAFLOW. «The zone is on the tint and never
//   on the lamp» cannot be had off the frame: the bloom, the grade and the
//   tone curve are non-linear, so the same lamp under a brighter tint lands
//   on a different pixel. Measured, the near bed's lamp reads 50.98 with the
//   zone as it is and 42.37 with it neutralised, and the FAR bed moves the
//   OTHER way, 44.53 to 46.11 -- neither is a lamp being dimmed by weather,
//   both are the curve. So it is asked of the source the driver was actually
//   handed, through lib/quadro.mjs's reader, and asked as a question about
//   DATAFLOW: of every statement that writes a varying, which ones mentioned
//   zoneAt. The rule is about the KIND of varying and not about a line of
//   code -- one whose name says it carries light of its own may not be
//   multiplied by the weather -- so no rewrite of the expression can break it
//   and a NEW emissive varying is covered the day it is declared.

/**
 * THE FAMILIES THE ARGUMENT REQUIRES, by the name of their child of the scene,
 * which is the coarsest handle there is and the same one guard-programmi uses.
 *
 * These five must be present and must read the map. Anything ELSE carrying the
 * map is measured in exactly the same way and reported, but not demanded: the
 * paving and the trees read it because E-LUCE5 put them in the weather, and a
 * session that legitimately takes a family out of the world should not have to
 * come here first. What may never happen quietly is one of these five going
 * missing, or ANY family that is in the scene holding the map and not reading
 * it.
 */
const ROSTER = [
  { id: 'campo', what: 'the meadow field, raymarched' },
  { id: 'grass-accent', what: 'the sprays and the tufts of the carpet' },
  { id: 'flowers-bianchi', what: 'the white bed' },
  { id: 'flowers-blu', what: 'the blue bed' },
  { id: 'flowers-far', what: 'the far flower rim' },
];

// WHAT EACH FAMILY MOVED ON THE DAY, as a percentage of the whole frame at the
// fitted pose, 960x540, tier alto, when its own zone was blinded. It is a
// READING and not a threshold.
//
// THE GATE IS A QUARTER OF IT, and the quarter rather than the half is measured
// rather than timid: the far rim is seeded against a meadow that streams (see
// its own line below). What is asked
// here is not «did this picture change» -- guard-prato and guard-fiori ask
// that, in levels -- it is «did this program read the map AT ALL», and between
// reading it and not reading it there is a factor of infinity. A quarter clears
// the noise of a streaming family by a wide margin and still fires the instant
// a program goes to nought.
const AT_TODAY = {
  'ground-voxel': 2.673,
  campo: 18.525,
  'grass-accent': 0.892,
  'flowers-bianchi': 1.104,
  'flowers-blu': 0.583,
  // THE ONE THAT IS NOT STEADY, and it is written at its WORST rather than at
  // its best: three runs of the same tip read 0.532, 0.323 and 0.157. The far
  // rim is seeded against a meadow that is still streaming, so how much of it
  // is standing when the plate is taken is not the same twice. The quarter
  // below is therefore a quarter of 0.157 and not of 0.532 -- 0.039% of the
  // frame, which is still three hundred pixels away from a program that has
  // stopped reading the map altogether.
  'flowers-far': 0.157,
  'trees-crowns': 1.132,
  'trees-trunks': 0.939,
};
// And what a family this file has never seen has to move before it counts as
// reading the map at all. Well under the smallest of the eight above.
const FLOOR_NEW = 0.08;
const floorFor = (id) => (AT_TODAY[id] === undefined ? FLOOR_NEW : AT_TODAY[id] / 4);

// How far apart, in summed channel steps out of 765, two pixels have to stand
// before they count as different. Two, and not the twelve a smoke uses: this is
// not asking whether a family is ON THE SCREEN -- guard-programmi asks that --
// it is asking whether a factor between 0.43 and 1.00 reached its arithmetic,
// and at the pale end of the map that is worth a couple of levels.
const MOVED_FLOOR = 2;

// A varying whose name says it carries light of its OWN. The weather is a
// factor on what a surface REFLECTS; a lamp is a source, and stands in its own
// light inside a shaded band exactly as it does in the open.
const EMISSIVE = /emit|halo|glow|lamp/i;

/**
 * THE VERDICT OF THE INJECTION, over what every family moved.
 *
 * A pure function of the readings, so the self test can put a defect through
 * the very predicate the run uses with no browser in the way.
 */
export function readsTheMap(readings) {
  const fails = [];
  for (const r of readings) {
    if (r.moved * 100 < floorFor(r.id)) {
      fails.push(`${r.id}: blinding its own zone moved ${(r.moved * 100).toFixed(3)}% of the `
        + `frame, floor ${floorFor(r.id).toFixed(3)}% -- this program is not reading the map`);
    }
  }
  for (const owed of ROSTER) {
    if (!readings.some((r) => r.id === owed.id)) {
      fails.push(`${owed.id}: ${owed.what} carries no zone map at all`);
    }
  }
  return fails;
}

/** The delivery: every program that asked holds the painted map, not the stand-in. */
export function deliveryVerdict(families, side) {
  return families.filter((f) => f.map !== side)
    .map((f) => `${f.id} holds a map ${f.map} wide where the delivery is ${side}: it never got `
      + 'the picture, or it is still on the one white texel a program is built with');
}

/** The lamp: no varying that carries its own light is multiplied by the weather. */
export function lampVerdict(programs) {
  const fails = [];
  for (const p of programs) {
    if (!p.uniforms.includes('tZone')) continue;
    const emissive = p.varyings.filter((v) => EMISSIVE.test(v));
    for (const w of p.writes) {
      if (w.uses && emissive.includes(w.lhs)) {
        fails.push(`program ${p.index}: ${w.lhs} ${w.op} ... zoneAt -- `
          + 'a lamp dimmed by the day’s weather');
      }
    }
  }
  return fails;
}

/** And the same reader the other way round: which varyings DO carry the term. */
export const tintedBy = (programs) => programs
  .filter((p) => p.uniforms.includes('tZone'))
  .map((p) => ({
    index: p.index,
    on: [...new Set(p.writes.filter((w) => w.uses).map((w) => w.lhs))],
    lamps: p.varyings.filter((v) => EMISSIVE.test(v)),
  }));

// THE HANDLE, INSTALLED ON THE PAGE, AND IT LIVES HERE ON PURPOSE.
// lib/quadro.mjs states at its own head that it never touches a material -- it
// hides whole children of the scene and puts them back -- and that restraint is
// what lets every other guard trust it. Reaching into one program's uniforms is
// THIS guard's business, so this guard carries it.
const INSTALL = () => {
  const by = new Map();
  const seen = new Set();
  window.farfield.scene.traverse((node) => {
    const mats = Array.isArray(node.material) ? node.material
      : (node.material ? [node.material] : []);
    for (const m of mats) {
      if (!m || !m.uniforms || !m.uniforms.tZone || seen.has(m.uuid)) continue;
      seen.add(m.uuid);
      let top = node;
      while (top.parent && top.parent !== window.farfield.scene) top = top.parent;
      const id = top.name || '(anon)';
      if (!by.has(id)) by.set(id, []);
      by.get(id).push(m);
    }
  });
  window.__zone = {
    by,
    kept: [],
    families() {
      return [...by.entries()].map(([id, mats]) => ({
        id,
        materials: mats.length,
        map: mats[0].uniforms.tZone.value && mats[0].uniforms.tZone.value.image
          ? mats[0].uniforms.tZone.value.image.width : 0,
      }));
    },
    // Blind ONE family: every fetch of its own lands on the clamped rim of the
    // map, which the painter guarantees is open meadow. Nothing else moves.
    blind(id) {
      window.__zone.kept = (by.get(id) || []).map((m) => ({ m, z: m.uniforms.uZone.value.z }));
      for (const k of window.__zone.kept) k.m.uniforms.uZone.value.z = 0;
      return window.__zone.kept.length;
    },
    restore() {
      for (const k of window.__zone.kept) k.m.uniforms.uZone.value.z = k.z;
      window.__zone.kept = [];
    },
  };
  return window.__zone.families();
};

/**
 * THE WHOLE OF THE TERM, on a page: the census, the delivery, what each family
 * moved when its own weather was taken away, and what the compiled programs put
 * the term on.
 */
async function measureTerm(port) {
  // --fast is answered BEFORE a browser is launched and not after it: the whole
  // point of the flag is not to pay for one.
  if (FAST) return { fast: true };
  const { chromium, sharp: decoder, missing } = toolsPresent();
  if (missing.length) return { missing };
  const server = await serveRepo(port);
  let world = null;
  try {
    world = await openWorld({ chromium, port: server.port });
    // THE HANDLE IS PUT BACK IF THE PAGE GOES AWAY, AND THE FACT IS CARRIED OUT
    // OF HERE RATHER THAN SWALLOWED.
    //
    // This measurement takes a couple of dozen plates and a minute of wall
    // clock, and the development server reloads the page whenever a file it
    // watches moves. On this desk some of those files are SHARED -- node_modules
    // is one directory for eight worktrees, tools/bin is a junction into a ninth
    // -- so somebody else's build can reload the page between two plates. The
    // recorder survives that, being an init script; `window.__zone` does not,
    // and this guard died once with «cannot read properties of undefined»
    // instead of saying what had happened.
    //
    // So the handle is re-installed when it is not there, and every plate is
    // taken against a base from the SAME load: if the world came back, the base
    // is taken again, because a difference between two plates of two different
    // loads is not a measurement of anything.
    const install = async () => world.page.evaluate(INSTALL);
    let families = await install();
    const programs = await world.writes('zoneAt');
    let base = await plate(world, decoder);
    let seen = world.loads();
    let reloads = 0;
    const readings = [];
    for (const f of families) {
      // eslint-disable-next-line no-await-in-loop
      if (world.loads() !== seen) {
        reloads += 1;
        seen = world.loads();
        // eslint-disable-next-line no-await-in-loop
        families = await install();
        // eslint-disable-next-line no-await-in-loop
        base = await plate(world, decoder);
      }
      // eslint-disable-next-line no-await-in-loop
      await world.page.evaluate((id) => window.__zone.blind(id), f.id);
      // eslint-disable-next-line no-await-in-loop
      const blind = await plate(world, decoder);
      // eslint-disable-next-line no-await-in-loop
      await world.page.evaluate(() => window.__zone.restore());
      readings.push({ ...f, moved: bandDiff(base, blind, [0, 1], MOVED_FLOOR) });
    }
    return { families, programs, readings, reloads, driver: world.driver };
  } finally {
    if (world) await world.close().catch(() => {});
    await server.stop().catch(() => {});
  }
}

// ------------------------------------------------------------- the foot
//
// WHAT R1 §1.7 MEASURED AND WHAT IS GATED HERE. On the reference, at the fitted
// pose, the meadow is dark for THREE TO FIVE METRES round the foot of a block
// and equally dark on all three sides of it. Read on the plane the same field
// stands at 0.65 of its own far meadow two metres out and is home by five and a
// half. So the two numbers a block owes the ground are how DEEP it goes and how
// FAR it reaches, and both are read off the delivered map rather than off the
// literals -- a strength that survived and a residual that undid it is a foot
// that is not there.
const FOOT_DEPTH = [0.55, 0.80];        // the factor the law draws at contact
const FOOT_REACH = [3.0, 5.0];          // metres, R1 §1.7's own three to five
const FOOT_TOLERANCE = 0.5;             // and the ±0,5 m the mandate carries
// AND WHAT THE DELIVERED MAP HAS TO SHOW AT A FOOT, absolutely: the two metres
// round a footprint stand at most this share of open meadow.
//
// It is a gate on the DELIVERY and not on the law. A residual cannot undo the
// law -- the map is clamped at one, so a knot of any size leaves a foot at
// whatever the law drew -- but a floor, a clamp or a frame that had drifted
// would leave every literal above exactly where it is and still ship a foot
// that is not there. 0.88 is just under what the law alone draws at the
// shallowest of the six (0.87 at block 01, where the reference's own weather
// is already pale).
const FOOT_ON_MAP = 0.88;

/**
 * ONE BLOCK'S OWN TERM, walked OUT from its footprint: how deep at contact and
 * where it is home.
 *
 * The walk is in the distance to the FOOTPRINT and not to the centre, because a
 * block is a rectangle and a ring at a fixed radius from its middle stands two
 * metres off one face and half a metre off another. And it is the BLOCK'S term
 * and not the whole law, because a tree or a boulder on the same bearing would
 * come back inside the reading as if the block had drawn it.
 */
function footProfile(block) {
  const a = (block.rotationY + 90) * Math.PI / 180;      // out along one face
  let contact = 1;
  let reach = 0;
  let nearest = Infinity;
  for (let step = 0; step <= 400; step++) {
    const r = step * 0.05;
    const x = block.position.x + Math.cos(a) * r;
    const z = block.position.z + Math.sin(a) * r;
    const d = blockDistance(x, z, block);
    const v = blockTerm(x, z, block);
    if (d < nearest) { nearest = d; contact = v; }
    if (v < 0.98) reach = Math.max(reach, d);
  }
  return { contact, reach };
}

/**
 * AND THE MAP AT A FOOT AGAINST THE MAP AWAY FROM IT, per bearing.
 *
 * This is the delivered picture and not the law, and it is the reading that
 * catches the failure the law alone cannot: a residual that quietly undid the
 * foot, so that the literals still say 0.32 over 5.4 m and the ground under a
 * block is open meadow.
 *
 * READ ABSOLUTELY AND NOT AGAINST A FAR RING. The first cut of this compared
 * the two metres at a foot against the meadow six to nine metres out, which is
 * exactly the reading that fails on block 06: it stands behind the spawn, where
 * the reference never looked and the residual is one, while its own far ring
 * reaches back into ground the residual does darken. The far meadow of a block
 * is not a constant, so the gate is the near ring itself.
 *
 * FOUR SECTORS AND NOT ONE, and the sun is the reason. R1 §1.7 is explicit that
 * the reference is EQUALLY dark on all sides of a block -- west 35, front 39,
 * east 30 at block 01 -- where the seal's own sun (azimuth 280, 47 degrees up)
 * would have laid a five metre shadow to the east and nothing at all to the
 * west. So the spread between the four is printed and gated wide: weather may
 * lean over a foot, a cast shadow may not fall on one side of it.
 */
function footOnMap(block, res) {
  const sectors = [0, 90, 180, 270].map(() => ({ near: [], far: [] }));
  for (let deg = 0; deg < 360; deg += 5) {
    const a = deg * Math.PI / 180;
    const s = sectors[Math.floor(((deg + 45) % 360) / 90)];
    for (let step = 0; step <= 240; step++) {
      const r = step * 0.05;
      const x = block.position.x + Math.cos(a) * r;
      const z = block.position.z + Math.sin(a) * r;
      const d = blockDistance(x, z, block);
      const v = Math.max(LUMA_FLOOR, Math.min(1, lawAt(x, z) * residualAt(res, x, z)));
      if (d > 0.2 && d < 2.5) s.near.push(v);
    }
  }
  const mean = (v) => (v.length ? v.reduce((t, x) => t + x, 0) / v.length : NaN);
  const per = sectors.map((s) => mean(s.near)).filter(Number.isFinite);
  return {
    mean: per.reduce((t, x) => t + x, 0) / per.length,
    lo: Math.min(...per),
    hi: Math.max(...per),
  };
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

async function main() {
  const r = reporter('guard-zone -- the light by place, and the dark at the foot of the blocks');

  // --------------------------------------------------------------- the map
  r.line('');
  r.line('  THE MAP IS THE PAINTER’S, repainted here and compared byte for byte:');
  const { map, lo, hi, lumaLo } = await paintZone();
  const shipped = await sha1OfShipped();
  const painted = sha(Buffer.from(map));
  r.check(shipped !== null, 'the delivered picture is there to be compared',
    shipped === null ? `${SHIPPED} is missing` : '');
  if (shipped !== null) {
    r.check(shipped === painted,
      'and it is exactly what these sources paint',
      `delivered ${shipped}, painted ${painted}`);
  }
  r.line(`    in light it runs ${lo.toFixed(3)} to ${hi.toFixed(3)}; `
    + `in luma, through the chain, ${lumaLo.toFixed(3)} to 1.000`);

  // THE RIM, and it is the one failure that would be invisible: everything
  // outside the square reads the edge, so a rim off one dims four hundred
  // metres of boundary and nothing in this world would say so.
  let rim = 255;
  for (let k = 0; k < ZONE.side; k++) {
    rim = Math.min(rim, map[k], map[(ZONE.side - 1) * ZONE.side + k],
      map[k * ZONE.side], map[k * ZONE.side + ZONE.side - 1]);
  }
  r.check(rim >= 250, 'the rim of the square is open meadow, so the world outside it is',
    `${rim} of 255`);

  // AND IT HAS TO DO SOMETHING. A picture of solid 255 passes every other gate
  // in this campaign, because a term that multiplies by one breaks nothing.
  const dark = map.reduce((t, v) => t + (v < 230 ? 1 : 0), 0) / (ZONE.side * ZONE.side);
  r.check(dark > 0.05, 'and some of the plateau actually stands in a zone',
    `${(dark * 100).toFixed(1)}% under 0.90 of open meadow`);

  // ------------------------------------------------------------- the foot
  const res = readResidual();

  r.line('');
  r.line('  THE DARK AT THE FOOT, per block, read off the law and off the map:');
  for (const block of MONOLITHS) {
    const { contact, reach } = footProfile(block);
    const ok = reach >= FOOT_REACH[0] - FOOT_TOLERANCE
      && reach <= FOOT_REACH[1] + FOOT_TOLERANCE
      && contact >= FOOT_DEPTH[0] && contact <= FOOT_DEPTH[1];
    r.check(ok, `block ${block.id} stands in its own dark`,
      `${contact.toFixed(2)} at contact, home by ${reach.toFixed(1)} m`);
    const { mean: sMean, lo: sLo, hi: sHi } = footOnMap(block, res);
    r.check(sMean <= FOOT_ON_MAP && sHi / sLo < 1.6,
      `and the delivered map still has it, on every side of ${block.id}`,
      `the near two metres stand at ${sMean.toFixed(2)} of open meadow, `
      + `${sLo.toFixed(2)} to ${sHi.toFixed(2)} by sector`);
  }

  // AND THE LAW CANNOT KNOW WHERE THE SUN IS, which is the whole of B-6 and of
  // E-SINTESI-DIVARIO D5/D6 made into an assertion. A directional term would
  // pass every reading above -- it would be dark at the foot and three to five
  // metres wide -- and would put a five metre tongue to the east of every block
  // that the reference does not have.
  const painterCode = read('tools/zone/paint-zone.mjs')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  r.check(!/sun|azimuth|elevation|SunDir/i.test(painterCode),
    'and the law is blind to the sun: there is no cast shadow anywhere in it');

  // ---------------------------------------------------------- the residual
  r.line('');
  r.line('  THE RESIDUAL, which is a measurement and has to say where it came from:');
  r.check(Boolean(res.fitted && res.fitted.on),
    'it says what it was fitted on', res.fitted ? res.fitted.on : 'nothing stated');
  r.check(res.cell <= 2 && res.cell >= 1,
    'and its knots stand at the scale a zone has structure at (R1 §1.6)',
    `${res.cell} m`);
  const knots = res.knots.filter((v) => v < 0.999);
  r.check(knots.length > 200 && Math.min(...knots) < 0.6,
    'and it carries the reference’s own dark places and not a flat sheet',
    `${knots.length} knots under one, deepest ${Math.min(...knots).toFixed(3)}`);
  r.check(res.knots.every((v) => v >= LUMA_FLOOR - 1e-9 && v <= 1.35 + 1e-9),
    'and no knot is outside the range the fit is allowed',
    `${Math.min(...res.knots).toFixed(3)} to ${Math.max(...res.knots).toFixed(3)}`);

  // -------------------------------------------------------------- the term
  //
  // Last, because it is the only leg that needs a browser and everything above
  // has to be askable at every commit whatever this machine has on it.
  r.line('');
  r.line('  THE TERM, injected into every program that carries the map:');
  const term = await measureTerm(PORT);
  if (term.missing) {
    r.note(`IL TERMINE NON E' STATO MISURATO su questa macchina: manca `
      + `${term.missing.join(' e ')}. Le gambe della mappa, del piede e del residuo qui sopra `
      + 'sono girate lo stesso (girano sotto node nudo); il termine chiede un fotogramma e il '
      + 'programma compilato, e senza browser non e\' una domanda che si possa porre. Il gate '
      + 'del termine sta nel banco di sessione.');
  } else if (FAST) {
    r.note('--fast: il termine non e\' stato misurato, quindi un programma che ha smesso di '
      + 'leggere la mappa delle zone passa.');
  } else {
    r.line(`    driver ${term.driver}`);
    if (term.reloads) {
      r.note(`il server ha RICARICATO la pagina ${term.reloads} volt${term.reloads === 1 ? 'a' : 'e'} `
        + 'mentre questo termine si misurava, e la misura e\' stata ripresa da capo (base e '
        + 'famiglie) dopo ognuna. Non e\' un difetto di questo mondo: e\' un file guardato dal '
        + 'server che si e\' mosso, e su questa scrivania alcuni di quei file sono CONDIVISI '
        + '(node_modules e\' una cartella sola per otto alberi, tools/bin e\' una giunzione '
        + 'verso un nono). Dichiarato perche\' un termine ripreso e\' un termine che ha '
        + 'aspettato, non uno che ha sbagliato.');
    }
    for (const reading of term.readings) {
      const was = AT_TODAY[reading.id];
      r.line(`    ${reading.id.padEnd(18)} mappa ${reading.map} px, accecata muove `
        + `${(reading.moved * 100).toFixed(3)}% del quadro`
        + `${was === undefined ? '  (NUOVA)' : ` (${was.toFixed(3)} il giorno della misura)`}`
        + `, soglia ${floorFor(reading.id).toFixed(3)}%`);
    }
    const short = readsTheMap(term.readings);
    r.check(short.length === 0,
      `all ${term.readings.length} the programs that hold the map actually read it`,
      short.join(' | '));
    const undelivered = deliveryVerdict(term.families, ZONE.side);
    r.check(undelivered.length === 0,
      'and the delivery reached every one of them: one seat, no order of layers',
      undelivered.join(' | '));
    const lamps = lampVerdict(term.programs);
    r.check(lamps.length === 0,
      'and the term is on the tint and never on a lamp, which is a source',
      lamps.join(' | '));
    for (const p of tintedBy(term.programs)) {
      r.line(`    program ${String(p.index).padStart(2)} carries the term on `
        + `${p.on.length ? p.on.join(', ') : '(nothing in its vertex)'}`
        + `${p.lamps.length ? `; its lamps are ${p.lamps.join(', ')}` : ''}`);
    }
    const withLamps = tintedBy(term.programs).filter((p) => p.lamps.length).length;
    if (!withLamps) {
      r.note('nessun programma che porta la mappa dichiara un varying di luce propria: '
        + 'la gamba della lampada e\' armata e non ha nulla su cui mordere.');
    }
  }

  // ------------------------------------------------------- and the witness
  r.line('');
  r.line('  WITNESS, not gated -- the factor of the frame at the fitted pose:');
  r.line('    the reference’s zone decile (R1 §1.6)      0.31');
  r.line('    ours before this unit                       0.56');
  r.line('    ours after                                  0.43');
  r.line('    cells under half the bright: reference 17%, before 2%, after 10%');
  r.line('    semivariance at four metres: reference 0.073, before 0.025, after 0.042');
  return r;
}

async function sha1OfShipped() {
  try {
    // ONE BAND OUT, and it has to be asked for: sharp promotes a grey PNG to
    // three identical channels on the raw path, and a hash of that is a hash of
    // a picture nobody delivered.
    const { data, info } = await sharp(SHIPPED).toColourspace('b-w').raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 1 || info.width !== ZONE.side) return `shape ${info.width}x${info.channels}`;
    return sha(data);
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- self-test
//
// THE SEVEN CASES THAT USED TO STAND HERE WERE NOT INJECTIONS. Each one took a
// regular expression out of SHAPE, ran `.replace()` with that same expression
// over the source, and asked SHAPE whether it still matched. The moment a
// statement in the source drifted, the replace matched nothing, the "defect"
// was never injected, and the case went on passing -- a self test that stops
// testing exactly when the thing it guards has started to move. They are gone
// with the shape they were made of.
//
// What stands in their place is the same three properties asked of the running
// world, and every one of them is put through the predicate the RUN uses:
// readsTheMap, deliveryVerdict and lampVerdict. Two are fed readings a browser
// took and then bent; one is fed the compiled source of the real programs with
// a defect spliced into it.
async function self() {
  const cases = [];

  cases.push(
    {
      // THE MAP AND ITS SOURCES, injected the only way that matters: move a
      // block and see whether the delivered picture is still the painter's.
      what: 'a block moved with the map left where it was',
      caught: (() => {
        const kept = { ...MONOLITHS[0].position };
        MONOLITHS[0].position.x += 4;
        const moved = sha(Buffer.from(paintSync()));
        MONOLITHS[0].position.x = kept.x;
        return moved !== sha(Buffer.from(paintSync()));
      })(),
    },
    {
      what: 'the residual flattened to a sheet of ones',
      caught: (() => {
        const flat = readResidual().knots.map(() => 1).filter((v) => v < 0.999);
        return !(flat.length > 200 && Math.min(...flat, 1) < 0.6);
      })(),
    },
    {
      // AND THE ONE A RESIDUAL CAN STILL DO, which is to run past the range the
      // fit is allowed. It cannot undo the law -- the map is clamped at one, so
      // a knot of any size leaves the foot at whatever the law drew -- but a
      // knot outside the range is a fit that was not a fit.
      what: 'the residual run past the ceiling the fit allows',
      caught: (() => {
        const knots = readResidual().knots.map((v) => v * 2);
        return !knots.every((v) => v >= LUMA_FLOOR - 1e-9 && v <= 1.35 + 1e-9);
      })(),
    },
    {
      what: 'the law of the blocks turned off',
      caught: (() => {
        const kept = SEATS.block.strength;
        SEATS.block.strength = 0;
        const { contact } = footProfile(MONOLITHS[0]);
        SEATS.block.strength = kept;
        return !(contact >= FOOT_DEPTH[0] && contact <= FOOT_DEPTH[1]);
      })(),
    },
    {
      what: 'and its reach stretched past what R1 measured',
      caught: (() => {
        const kept = SEATS.block.reach;
        SEATS.block.reach = 12;
        const { reach } = footProfile(MONOLITHS[0]);
        SEATS.block.reach = kept;
        return reach > FOOT_REACH[1] + FOOT_TOLERANCE;
      })(),
    },
  );

  // ------------------------------------------------------------- the term
  //
  // Every one of these goes through the SAME predicate the run uses. The ones
  // that can be settled with arithmetic are; the ones that need the world take
  // the world, once, and bend what it hands back.
  const term = await measureTerm(PORT);
  if (term.missing) {
    process.stdout.write(`SKIP  no ${term.missing.join(' and ')} on this machine: `
      + 'the term is measured on a frame and on the compiled programs\n');
  } else if (FAST) {
    process.stdout.write('SKIP  --fast: the term was not measured\n');
  } else {
    cases.push(
      {
        what: 'the world as it stands: every program that holds the map reads it',
        caught: readsTheMap(term.readings).length === 0
          && deliveryVerdict(term.families, ZONE.side).length === 0
          && lampVerdict(term.programs).length === 0,
      },
      {
        // THE DEFECT THIS GUARD EXISTS FOR, one family at a time, and the
        // families are taken from the world rather than written down here:
        // whatever the scene is carrying, each in turn is made to move nothing.
        what: 'a program that has stopped reading the map moves no pixel when its zone goes',
        caught: term.readings.every((r) => readsTheMap(
          term.readings.map((x) => (x.id === r.id ? { ...x, moved: 0 } : x)),
        ).some((line) => line.startsWith(`${r.id}:`))),
      },
      {
        what: 'a family of the roster gone out of the scene altogether',
        caught: ROSTER.every((owed) => readsTheMap(term.readings.filter((r) => r.id !== owed.id))
          .some((line) => line.includes('carries no zone map at all'))),
      },
      {
        // E-LUCE5's shape in this guard's own terms: a program built before the
        // picture arrived and never handed it, so it goes on drawing the world
        // that shipped before the weather existed -- one white texel, a factor
        // of one everywhere, and nothing else in the campaign would say so.
        what: 'one program left holding the single white texel a program is built with',
        caught: term.families.every((f) => deliveryVerdict(
          term.families.map((x) => (x.id === f.id ? { ...x, map: 1 } : x)), ZONE.side,
        ).length === 1),
      },
      {
        what: 'the delivery reaching nobody at all',
        caught: deliveryVerdict(term.families.map((f) => ({ ...f, map: 1 })), ZONE.side)
          .length === term.families.length,
      },
      {
        // THE LAMP, injected into the COMPILED SOURCE of the real programs: the
        // varying is the one the driver was actually handed, so a rewrite of
        // the flower vertex cannot quietly turn this into a no-op the way the
        // seven regular expressions it replaces could.
        what: 'a lamp of a real program multiplied by the day’s weather',
        caught: (() => {
          const lit = term.programs.filter((p) => p.uniforms.includes('tZone')
            && p.varyings.some((v) => EMISSIVE.test(v)));
          if (!lit.length) return false;
          return lit.every((p) => {
            const lamp = p.varyings.find((v) => EMISSIVE.test(v));
            const bent = term.programs.map((q) => (q.index === p.index
              ? { ...q, writes: [...q.writes, { lhs: lamp, op: '*=', uses: true }] } : q));
            return lampVerdict(bent).some((line) => line.includes(`${lamp} *=`));
          });
        })(),
      },
      {
        what: 'and a TINT multiplied by it is not a defect, which is the whole point',
        caught: (() => {
          const p = term.programs.find((q) => q.uniforms.includes('tZone')
            && q.varyings.some((v) => !EMISSIVE.test(v)));
          if (!p) return false;
          const tint = p.varyings.find((v) => !EMISSIVE.test(v));
          const bent = term.programs.map((q) => (q.index === p.index
            ? { ...q, writes: [...q.writes, { lhs: tint, op: '*=', uses: true }] } : q));
          return lampVerdict(bent).length === lampVerdict(term.programs).length;
        })(),
      },
      {
        // AND THE READER ITSELF HAS TO HAVE READ SOMETHING. quadro's writes()
        // cuts a compiled shader into statements; if that ever came back empty,
        // every leg above would be true of nothing -- which is precisely the
        // failure guard-orizzonte shipped for three sessions.
        what: 'the reader of the compiled programs came back with statements at all',
        caught: term.programs.filter((p) => p.uniforms.includes('tZone'))
          .every((p) => p.writes.length > 0 && p.varyings.length > 0)
          && tintedBy(term.programs).some((p) => p.on.length > 0),
      },
    );
  }

  selfTest('guard-zone', cases);
}

/** The law and the residual only, for an injection that must not touch the chain. */
function paintSync() {
  const res = readResidual();
  const out = new Uint8Array(ZONE.side * ZONE.side);
  const span = ZONE.side * ZONE.cell;
  for (let j = 0; j < ZONE.side; j++) {
    const z = ZONE.centre.z - span / 2 + (j + 0.5) * ZONE.cell;
    for (let i = 0; i < ZONE.side; i++) {
      const x = ZONE.centre.x - span / 2 + (i + 0.5) * ZONE.cell;
      out[j * ZONE.side + i] = Math.round(
        Math.max(LUMA_FLOOR, Math.min(1, lawAt(x, z) * residualAt(res, x, z))) * 255,
      );
    }
  }
  return out;
}

if (process.argv.includes('--self')) {
  await self();
} else {
  const r = await main();
  r.note('IL FATTORE AL DECILE DEL FOTOGRAMMA NON E’ GATEATO QUI, e questo e’ il '
    + 'numero: alla posa fittata il campo sta a 0,43 contro lo 0,31 del bersaglio '
    + '(era 0,56). Le zone hanno chiuso quello che una mappa lenta puo’ chiudere -- '
    + 'misurato alla SCALA DELLA ZONA (la mappa sfocata a un metro e mezzo, sul '
    + 'supporto che i due quadri hanno in comune) il decile va da 0,551 a 0,520 '
    + 'contro lo 0,449 del bersaglio -- e cio’ che resta e’ di CONTRASTO e non di '
    + 'zona: il bersaglio crudo sta a 0,314 dove il proprio campo lento sta a 0,449, '
    + 'cioe’ un terzo del suo divario vive SOTTO il metro e mezzo, dove nessuna '
    + 'mappa di zone arriva. Quella voce e’ l’occlusione fra filo e filo (U-CAMPO-2) '
    + 'e la prospettiva aerea sul campo lontano (R6). Proprietari: U-CAMPO-2 e il '
    + 'coordinatore.');
  r.end('the map is the painter’s, and every program that holds it reads it');
}
