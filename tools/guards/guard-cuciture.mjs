import { TIERS } from '../../src/core/quality.js';
import { PLATEAU } from '../../src/world/voxel/confine.js';
import { CAMPO_MATERIAL, campoMaterialCode } from '../../src/world/voxel/campo.js';
import {
  CHUNK, MATERIAL, NO_COLUMN, VOXEL,
} from '../../src/world/voxel/columns.js';
import { chunkList } from '../../src/world/voxel/mesher.js';
import { CENTRE, CORRIDOR_BOX, columnSpec } from '../../src/world/voxel/worldgen.js';
import { reporter, selfTest } from './lib.mjs';
import {
  VISITOR, bandSky, openVisitor, openWorld, serveRepo, toolsPresent,
} from './lib/quadro.mjs';

// GUARD-CUCITURE -- NO SKY UNDER THE HORIZON WHERE THE GROUND IS.
//
// ===========================================================================
// THE INCIDENT THIS FILE IS THE ANSWER TO (E-DECISIONI22, U-SUOLO-2).
//
// The committente walked behind the CONTATTI block, pressed Esc, and took a
// photograph of the SKY LYING IN THE GRASS: a rectangular strip of ground about
// a metre wide and tens of metres long that nothing had drawn, with a second
// stretch of it at a right angle. He called it «texture mancante sotto al
// monolite nascosto».
//
// WHAT IT WAS, AND IT WAS NOT A TEXTURE. This world draws its ground with TWO
// engines and they divide the work by MATERIAL. The field (src/world/voxel/
// campo-field.js) ray-marches the meadow and the boundary; the greedy disc
// (src/world/ground-voxel.js) lays the CORRIDOR's stone, and only that, since
// E-SENT4. The field knows about the division -- it marks the corridor's
// columns PATH and its fragment returns nought alpha on them, `family == 2` in
// campo-material.js, so the paving is not painted over -- and until U-SUOLO-2
// it did NOT know how far the other engine had been asked to reach. That reach
// is a TIER's dial about the meadow (`voxelDiscRadius`, 14 m on three tiers and
// 12 on the lowest); the corridor's own run is a property of the world and
// carries to z = 30. Fourteen metres from the middle of the hub is z = 15.5.
//
// Between the two there were 1765 columns -- 1.2 m wide, 14.5 m long, 17.7 m^2,
// from z = 15.55 to z = 29.95 -- that the field would not draw and the greedy
// was never asked for. The CONTATTI block stands at z = 19, in the middle of
// them. The «right angle» is the far end of the run meeting the side of it.
//
// ===========================================================================
// WHAT THIS GUARD ASKS, IN THREE LEGS, AND WHY THREE.
//
//   1. THE LAW. Every column this world's FIELD stands aside on is a column the
//      greedy is both ASKED FOR (chunkList) and LAYS (columnSpec). Offline, no
//      browser, every tier's radius, zero tolerance. This is the leg that would
//      have caught the defect the day the corridor's run was extended past the
//      disc, and it is the one that stays true when somebody moves a tier.
//
//   2. THE PICTURE. The law can be right and the frame still have a hole in it
//      -- a window that has not landed, a box that does not contain the ground,
//      a fragment that discards. So the frame is photographed with ONLY the two
//      engines that draw ground visible, and not one pixel of it may be
//      undrawn. The poses are steep on purpose: at pitch -35 with the fitted
//      lens the top of the frame is 12.9 degrees UNDER the horizon, so the whole
//      picture is ground between 1.0 m and 6.9 m from the eye. There is no
//      horizon in it, no far rim of the far window and no crest -- every one of
//      which is sky that belongs in a frame, and every one of which would have
//      to be tolerated by a THRESHOLD if this leg could see it. A threshold is
//      exactly what lets a metre-wide strip through, so this leg has none: the
//      assertion is zero pixels, and it was measured at zero over 156 plates.
//
//      WHAT THAT GIVES UP, AND IT IS DECLARED. Seven metres is the walker's own
//      ground and not the meadow at the horizon, so a hole further out than that
//      is leg 1's to catch and not this one's. There is one such residue on this
//      tip and it is NOT a hole in the data: at pitch -26 the same sweep found
//      patches of up to 43 px at eight to nine metres, in open meadow that the
//      aerial says is solid -- the traversal missing at a grazing angle, which
//      is the scintillation family (D-C3-3, U-PERF-6) and not this unit's.
//
//   3. THE VISITOR'S PAGE. Legs 1 and 2 measure `?dev`, and E-SUOLO-VIS1 is the
//      standing lesson of this repository about what that is worth: the
//      committente's own page is a different machine, in the THIRD person, with
//      no tier asked for by hand and no pose imposed. So the last leg opens the
//      page as it is delivered, walks it with the keyboard, and reads the one
//      thing a page with no handles can be asked: how much of the ground band
//      is the sky's own colour (bandSky, whose margins were measured in
//      E-SUOLO-VIS1). It is the leg with a floor on it, and it is the leg that
//      photographs the world the defect was reported from.
//
//   --fast  legs 2 and 3 are skipped; leg 1 always runs.
//   --port=N  reuse a development server already up on N.

const flags = process.argv.slice(2);
const FAST = flags.includes('--fast');
const PORT_FLAG = flags.find((f) => f.startsWith('--port='));
const REUSE = PORT_FLAG ? Number(PORT_FLAG.slice(7)) : null;

// ===========================================================================
// LEG 1 -- THE LAW.

/** Every radius a tier can ask the greedy for, plus the plateau itself. */
const RADII = [...new Set(TIERS.map((t) => t.voxelDiscRadius).concat([PLATEAU]))]
  .filter((r) => Number.isFinite(r) && r > 0)
  .sort((a, b) => a - b);

/** The box the sweep walks, in metres: the corridor and the widest disc. */
const REACH = Math.max(PLATEAU, Math.abs(CORRIDOR_BOX.z1), Math.abs(CORRIDOR_BOX.z0)) + 2;

/**
 * Where this world's ground has no drawer at all, at one reach of the greedy.
 *
 * THE PREDICATE IS THE TWO ENGINES' OWN CONTRACT AND NOTHING ELSE. The field is
 * asked what it would write into a texel -- `columnSpec` at the PLATEAU with
 * `beyond`, which is exactly the call campoTile makes -- and a column whose
 * material the field does not draw is then asked of the greedy, at the radius
 * the tier gave it, through BOTH of the greedy's gates: the chunk it would have
 * to be in, and the column the law would lay there. A column that fails either
 * is a column with the sky under it.
 *
 * @param {number} radius   metres of ten centimetre ground the tier asked for
 * @param {Function} cut    which chunks the disc asks for, injectable
 * @returns {{n: number, box: object|null, why: Map<string, number>}}
 */
function unmanned(radius, cut = chunkList) {
  const asked = new Set();
  for (const { cx, cz } of cut(radius)) asked.add(`${cx},${cz}`);
  const first = Math.floor(-REACH / VOXEL);
  const last = Math.ceil(REACH / VOXEL);
  const why = new Map();
  let n = 0;
  let box = null;
  for (let iz = first; iz <= last; iz += 1) {
    for (let ix = first; ix <= last; ix += 1) {
      const field = columnSpec(ix, iz, true, PLATEAU, true);
      // What the FIELD draws, said the way campoTile says it.
      if (field.top !== NO_COLUMN && campoMaterialCode(field.mat) >= 0
        && campoMaterialCode(field.mat) !== CAMPO_MATERIAL.PATH) continue;
      // Under a block there is no ground and no sky: the masonry stands on it.
      if (field.top === NO_COLUMN && field.mat === MATERIAL.STONE) continue;
      const inChunk = asked.has(`${Math.floor(ix / CHUNK)},${Math.floor(iz / CHUNK)}`);
      const laid = inChunk && columnSpec(ix, iz, true, radius, false).top !== NO_COLUMN;
      if (laid) continue;
      const key = inChunk ? "la colonna non e' posata" : "il pezzo non e' chiesto";
      why.set(key, (why.get(key) || 0) + 1);
      n += 1;
      const x = (ix + 0.5) * VOXEL;
      const z = (iz + 0.5) * VOXEL;
      box = box ? {
        x0: Math.min(box.x0, x), x1: Math.max(box.x1, x),
        z0: Math.min(box.z0, z), z1: Math.max(box.z1, z),
      } : { x0: x, x1: x, z0: z, z1: z };
    }
  }
  return { n, box, why };
}

/**
 * And the other direction: the cure must not have bought a metre of meadow.
 *
 * A rim that let everything through would close leg 1 and put a second ground
 * over the field's own, which is the defect E-SUOLO-VIS1 is about seen from the
 * other side. So every column the greedy lays outside its radius has to be the
 * corridor, and nothing else.
 */
function extras(radius) {
  const first = Math.floor(-REACH / VOXEL);
  const last = Math.ceil(REACH / VOXEL);
  let n = 0;
  for (let iz = first; iz <= last; iz += 1) {
    for (let ix = first; ix <= last; ix += 1) {
      const x = (ix + 0.5) * VOXEL;
      const z = (iz + 0.5) * VOXEL;
      if (Math.hypot(x - CENTRE.x, z - CENTRE.z) <= radius) continue;
      const spec = columnSpec(ix, iz, true, radius, false);
      if (spec.top === NO_COLUMN) continue;
      if (spec.mat === MATERIAL.PATH || spec.mat === MATERIAL.EARTH) continue;
      n += 1;
    }
  }
  return n;
}

/** The whole run of the corridor, read off the law, for the box to contain. */
function runOfCorridor() {
  const first = Math.floor(-REACH / VOXEL);
  const last = Math.ceil(REACH / VOXEL);
  let out = 0;
  let box = null;
  for (let iz = first; iz <= last; iz += 1) {
    for (let ix = first; ix <= last; ix += 1) {
      const spec = columnSpec(ix, iz, true, PLATEAU, true);
      if (spec.mat !== MATERIAL.PATH) continue;
      const x = (ix + 0.5) * VOXEL;
      const z = (iz + 0.5) * VOXEL;
      box = box ? {
        x0: Math.min(box.x0, x), x1: Math.max(box.x1, x),
        z0: Math.min(box.z0, z), z1: Math.max(box.z1, z),
      } : { x0: x, x1: x, z0: z, z1: z };
      if (x < CORRIDOR_BOX.x0 || x > CORRIDOR_BOX.x1
        || z < CORRIDOR_BOX.z0 || z > CORRIDOR_BOX.z1) out += 1;
    }
  }
  return { out, box };
}

// ===========================================================================
// LEG 2 -- THE PICTURE.

/**
 * THE POSES, AND WHY THEY POINT AT THE GROUND.
 *
 * pitch -35 with the fitted lens puts the top of the frame 12.9 degrees under
 * the horizon and the bottom 57.1 under it: the whole picture is ground between
 * 1.0 m and 6.9 m from the eye, which is where a walker's own feet and the strip
 * beside the CONTATTI block both are. Nothing in that frame is allowed to be
 * sky, so the assertion is a count of undrawn pixels and not a share.
 */
const PITCH = -35;
const EYE = 1.583;
const FOV = 44.199;

/** The three poses of E-DECISIONI22, by name, in the walker's own frame. */
const POSES = [
  { id: 'posa fittata', x: 0.599, z: 14.215, yaw: 1.818 },
  { id: 'dietro il 06', x: 0.25, z: 24.0, yaw: 0 },
  { id: 'orlo', x: 0, z: -12.5, yaw: 180 },
];

/** Thirty metres south to north, and thirty west to east, in two metre steps. */
const WALK_SN = [];
for (let z = 0; z <= 30; z += 2) WALK_SN.push({ id: `S-N z=${z}`, x: 0.25, z, yaw: 180 });
const WALK_WE = [];
for (let x = -15; x <= 15; x += 2) WALK_WE.push({ id: `W-E x=${x}`, x, z: 8, yaw: 90 });

/** Which children of the scene are the GROUND of this world, and they are two. */
const GROUND = ['campo', 'ground-voxel'];

/** How many pixels of a plate nothing drew. */
function undrawn(plate) {
  const { data, width, height, channels } = plate;
  let n = 0;
  const box = { x0: width, x1: 0, y0: height, y1: 0 };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      if (data[i] + data[i + 1] + data[i + 2] > 6) continue;
      n += 1;
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
    }
  }
  return { n, box, share: n / (width * height) };
}

/**
 * One plate of the ground alone, at one pose.
 *
 * `hide` is the injection: a family taken out of the frame is the tile taken
 * away, and a guard that cannot be made to fail is not measuring anything.
 */
async function groundPlate(world, sharp, pose, { hide = [], settle = 900 } = {}) {
  await world.page.evaluate(({ on, off }) => {
    for (const child of window.farfield.scene.children) {
      const name = child.name || '';
      if (name.startsWith('v8-avatar')) continue;
      child.visible = on.includes(name) && !off.includes(name);
    }
  }, { on: GROUND, off: hide });
  await world.page.evaluate((p) => {
    window.farfield.player.placePerson('prima');
    window.setDevPose(p);
  }, { x: pose.x, y: EYE, z: pose.z, yaw: pose.yaw, pitch: PITCH, fov: FOV });
  await world.page.waitForTimeout(settle);
  const png = await world.page.screenshot({ type: 'png' });
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return { data, channels: info.channels, width: info.width, height: info.height };
}

// ===========================================================================
// LEG 3 -- THE VISITOR'S PAGE.
//
// THE BAND AND THE FLOOR ARE E-SUOLO-VIS1'S OWN. The bottom fifth of the
// committente's window, read by hue: with the meadow drawn it is 0.1% sky and
// with the meadow missing 88.0%, and the floor sits between two distributions
// and not inside either. What is new here is only WHERE the walker stands when
// it is read, which is the one thing the defect needed.

const SUOLO_VIS = [0.80, 1.00];
const VISITOR_FLOOR = 0.02;

// AND THE WALK IS A RUN, GOING BACKWARDS, WHICH IS NOT A FLOURISH.
//
// A visitor's page publishes no pose and no camera: the walker arrives facing
// the hub and the only way to turn is a mouse under pointer lock, whose deltas
// a driver does not synthesise -- measured, on this desk: forty mouse moves and
// the compass still reads N. So the strip cannot be walked TOWARDS. What can be
// done is what the committente did: back away from the hub, down the corridor,
// until the ground he is standing on is in the bottom of his own frame -- and
// the THIRD person is what makes that work, the camera standing three metres
// behind the walker and over the very ground he has just crossed.
//
// EIGHT STEPS AT A RUN, AND THE FIRST FOUR READ NOTHING. Measured at 3020af5,
// the tip the defect was reported on: 0.06, 0.06, 0.05, 0.20 -- and then 9.89,
// 10.22, 10.28, 10.39 per cent of the band, which is the strip arriving under
// the camera. With the corridor carried the same eight steps read 0.06, 0.06,
// 0.05, 0.13, 0.03, 0.04, 0.05, 0.06. The floor at two per cent sits between
// two readings that are two hundred times apart.
const RUN = 'ShiftLeft';
const STEPS = 8;

/** A walk on the visitor's page: keys held, and nothing else touched. */
async function step(visitor, key, ms) {
  await visitor.page.keyboard.down(key);
  await visitor.page.waitForTimeout(ms);
  await visitor.page.keyboard.up(key);
  await visitor.page.waitForTimeout(400);
}

async function visitorRead(visitor, sharp) {
  const png = await visitor.page.screenshot({ type: 'png' });
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return bandSky({
    data, channels: info.channels, width: info.width, height: info.height,
  }, SUOLO_VIS);
}

// ===========================================================================

const { chromium, sharp, missing } = toolsPresent();

const law = {
  radii: RADII.map((radius) => ({ radius, ...unmanned(radius) })),
  extra: RADII.map((radius) => ({ radius, n: extras(radius) })),
  run: runOfCorridor(),
};

if (flags.includes('--self')) {
  const cases = [];

  cases.push({
    what: 'la legge come sta non lascia una colonna senza chi la disegni',
    caught: law.radii.every((r) => r.n === 0),
  });

  // THE TILE TAKEN AWAY. One chunk of the corridor's own tail dropped from the
  // list the disc asks for -- which is exactly the shape of the defect, a piece
  // of ground nobody was asked to draw -- and leg 1 has to name it.
  const victim = chunkList(RADII[RADII.length - 1])
    .find((c) => c.cz * CHUNK * VOXEL >= CORRIDOR_BOX.z1 - CHUNK * VOXEL
      && c.cx * CHUNK * VOXEL <= CORRIDOR_BOX.x1
      && (c.cx + 1) * CHUNK * VOXEL >= CORRIDOR_BOX.x0);
  cases.push({
    what: victim
      ? `una tessera tolta al magazzino (${victim.cx},${victim.cz}) e' presa`
      : 'nessuna tessera del corridoio da togliere: niente da iniettare',
    caught: Boolean(victim) && RADII.every((radius) => unmanned(radius,
      (r) => chunkList(r).filter((c) => c.cx !== victim.cx || c.cz !== victim.cz)).n > 0),
  });

  // AND THE DEFECT ITSELF, PUT BACK. The rim gate as it stood before U-SUOLO-2:
  // the radius decides the corridor too. Run against the tier that shipped it.
  const before = (radius) => {
    const first = Math.floor(-REACH / VOXEL);
    const last = Math.ceil(REACH / VOXEL);
    let n = 0;
    for (let iz = first; iz <= last; iz += 1) {
      for (let ix = first; ix <= last; ix += 1) {
        const field = columnSpec(ix, iz, true, PLATEAU, true);
        if (field.mat !== MATERIAL.PATH) continue;
        const x = (ix + 0.5) * VOXEL;
        const z = (iz + 0.5) * VOXEL;
        if (Math.hypot(x - CENTRE.x, z - CENTRE.z) > radius) n += 1;
      }
    }
    return n;
  };
  cases.push({
    what: `il difetto di E-DECISIONI22 rimesso (raggio ${RADII[0]} m) e' preso`,
    caught: before(RADII[0]) > 0 && law.radii.find((r) => r.radius === RADII[0]).n === 0,
  });

  cases.push({
    what: 'la scatola del corridoio contiene tutta la sua corsa',
    caught: law.run.out === 0,
  });
  cases.push({
    what: "una scatola del corridoio accorciata di dieci metri e' presa",
    caught: (() => {
      const short = { ...CORRIDOR_BOX, z1: CORRIDOR_BOX.z1 - 10 };
      return law.run.box.z1 > short.z1;
    })(),
  });

  // THE PICTURE'S OWN INJECTION: a plate with a rectangle of nothing in it.
  cases.push({
    what: "una finestra vuota dipinta in una lastra piena e' presa",
    caught: (() => {
      const width = 64;
      const height = 32;
      const data = Buffer.alloc(width * height * 3, 200);
      for (let y = 8; y < 16; y += 1) {
        for (let x = 10; x < 30; x += 1) data.fill(0, (y * width + x) * 3, (y * width + x) * 3 + 3);
      }
      return undrawn({ data, width, height, channels: 3 }).n === 8 * 20;
    })(),
  });
  cases.push({
    what: "e una lastra piena non e' presa",
    caught: undrawn({
      data: Buffer.alloc(64 * 32 * 3, 200), width: 64, height: 32, channels: 3,
    }).n === 0,
  });

  // AND LEG 3'S FLOOR, AGAINST A BAND OF SKY AND A BAND OF MEADOW.
  const band = (rgb) => {
    const width = 40;
    const height = 20;
    const data = Buffer.alloc(width * height * 3);
    for (let k = 0; k < width * height; k += 1) {
      data[k * 3] = rgb[0]; data[k * 3 + 1] = rgb[1]; data[k * 3 + 2] = rgb[2];
    }
    return { data, width, height, channels: 3 };
  };
  cases.push({
    what: `una fascia di cielo (132,177,201) supera il pavimento ${VISITOR_FLOOR}`,
    caught: bandSky(band([132, 177, 201]), [0, 1]) > VISITOR_FLOOR,
  });
  cases.push({
    what: 'una fascia di prato (51,80,28) non lo supera',
    caught: bandSky(band([51, 80, 28]), [0, 1]) <= VISITOR_FLOOR,
  });

  if (!missing.length && !FAST) {
    // AND THE ONE INJECTION THAT GOES THROUGH THE PAGE: the engine that draws
    // the corridor taken out of the frame, at the pose the defect was found at.
    const server = await serveRepo(REUSE);
    const world = await openWorld({ chromium, port: server.port, width: 960, height: 540 });
    const pose = POSES[1];
    const whole = await groundPlate(world, sharp, pose, { settle: 1600 });
    const cut = await groundPlate(world, sharp, pose, { hide: ['ground-voxel'], settle: 900 });
    await world.close();
    await server.stop();
    cases.push({
      what: `il quadro dietro il 06 come sta e' intero (${undrawn(whole).n} px vuoti)`,
      caught: undrawn(whole).n === 0,
    });
    cases.push({
      what: `e senza il magazzino del selciato e' bucato (${undrawn(cut).n} px vuoti)`,
      caught: undrawn(cut).n > 0,
    });
  }

  selfTest('guard-cuciture', cases);
}

const report = reporter('guard-cuciture -- nessun pixel di cielo sotto l\'orizzonte dove il campo ha terra');

// ---------------------------------------------------------------- LEG 1
report.line(`  1. LA LEGGE -- i due motori del suolo, colonna per colonna, su ${RADII.length} raggi`);
report.check(law.run.out === 0,
  'CORRIDOR_BOX contiene tutta la corsa del corridoio',
  law.run.box
    ? `x ${law.run.box.x0.toFixed(2)}..${law.run.box.x1.toFixed(2)}, `
      + `z ${law.run.box.z0.toFixed(2)}..${law.run.box.z1.toFixed(2)}`
    : 'nessuna colonna di corridoio trovata');
for (const r of law.radii) {
  report.check(r.n === 0,
    `raggio ${String(r.radius).padStart(4)} m: ogni colonna che il campo cede ha chi la disegna`,
    r.n ? `${r.n} colonne senza nessuno: x ${r.box.x0.toFixed(2)}..${r.box.x1.toFixed(2)}, `
      + `z ${r.box.z0.toFixed(2)}..${r.box.z1.toFixed(2)} `
      + `[${[...r.why].map(([k, v]) => `${k} ${v}`).join(', ')}]`
      : '');
}
for (const e of law.extra) {
  report.check(e.n === 0,
    `raggio ${String(e.radius).padStart(4)} m: e il disco non posa un metro di prato oltre il suo raggio`,
    e.n ? `${e.n} colonne di troppo` : '');
}

if (missing.length) report.skip(`manca ${missing.join(' e ')}: le gambe 2 e 3 non si possono fotografare`);
if (FAST) {
  report.note('--fast: le gambe 2 e 3 non sono state corse, quindi un buco che la legge non vede passa');
  report.end();
}

let server = null;
let world = null;
let visitor = null;
try {
  server = await serveRepo(REUSE);

  // -------------------------------------------------------------- LEG 2
  world = await openWorld({ chromium, port: server.port, width: 960, height: 540 });
  report.line(`  2. IL QUADRO -- solo ${GROUND.join(' e ')}, pitch ${PITCH}, zero tolleranza`
    + ` -- driver ${world.driver}`);
  let worst = { n: -1 };
  const legs = [
    ['le tre pose', POSES, 1500],
    ['il cammino sud-nord di 30 m', WALK_SN, 800],
    ['il cammino ovest-est di 30 m', WALK_WE, 800],
  ];
  for (const [what, list, settle] of legs) {
    let bad = 0;
    for (const pose of list) {
      // eslint-disable-next-line no-await-in-loop
      const read = undrawn(await groundPlate(world, sharp, pose, { settle }));
      if (read.n > worst.n) worst = { ...read, id: pose.id };
      if (read.n) bad += 1;
    }
    report.check(bad === 0, `${what} (${list.length} lastre)`,
      bad ? `${bad} lastre bucate` : 'nessun pixel vuoto');
  }
  report.line(`     la peggiore: ${worst.id}, ${worst.n} px`
    + (worst.n ? ` in [${worst.box.x0}-${worst.box.x1}, ${worst.box.y0}-${worst.box.y1}]` : ''));
  await world.close();
  world = null;

  // -------------------------------------------------------------- LEG 3
  visitor = await openVisitor({ chromium, port: server.port, width: VISITOR.width, height: VISITOR.height });
  const person = await visitor.person();
  report.line(`  3. IL VISITATORE -- ${VISITOR.width}x${VISITOR.height}, ${person} persona`
    + `, fascia ${SUOLO_VIS[0]}..${SUOLO_VIS[1]}, pavimento ${VISITOR_FLOOR}`);
  report.check(person === 'terza', 'la pagina consegnata arriva in terza persona', person);
  const walk = [];
  walk.push({ id: 'arrivo', sky: await visitorRead(visitor, sharp) });
  await visitor.page.keyboard.down(RUN);
  // SOUTH, WHICH IS THE WAY THE DEFECT IS. The page arrives facing the hub, so
  // `back` walks the corridor's tail -- the very ground the photograph was of.
  for (let i = 0; i < STEPS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await step(visitor, 'KeyS', 1500);
    // eslint-disable-next-line no-await-in-loop
    walk.push({ id: `S-N ${i + 1}`, sky: await visitorRead(visitor, sharp) });
  }
  // AND WEST TO EAST, WHICH ON A PAGE THAT CANNOT TURN IS A STRAFE. It crosses
  // the corridor's two kerbs and the meadow either side of them, which is where
  // a seam between the two engines would be.
  for (let i = 0; i < STEPS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await step(visitor, 'KeyD', 1500);
    // eslint-disable-next-line no-await-in-loop
    walk.push({ id: `W-E ${i + 1}`, sky: await visitorRead(visitor, sharp) });
  }
  await visitor.page.keyboard.up(RUN);
  const over = walk.filter((w) => w.sky > VISITOR_FLOOR);
  report.check(over.length === 0,
    `${walk.length} letture lungo i due cammini, nessuna sopra il pavimento`,
    over.length
      ? over.map((w) => `${w.id} ${(w.sky * 100).toFixed(1)}%`).join(', ')
      : `la peggiore ${(Math.max(...walk.map((w) => w.sky)) * 100).toFixed(2)}%`);
  report.check(visitor.noise.length === 0, 'e la pagina del visitatore non ha detto niente',
    visitor.noise.slice(0, 2).join(' | '));
  await visitor.close();
  visitor = null;
} catch (error) {
  report.check(false, 'il mondo si apre e si lascia fotografare', error.message);
} finally {
  if (world) await world.close().catch(() => {});
  if (visitor) await visitor.close().catch(() => {});
  if (server) await server.stop().catch(() => {});
}

report.end(`${RADII.length} raggi, ${POSES.length + WALK_SN.length + WALK_WE.length} lastre`);
