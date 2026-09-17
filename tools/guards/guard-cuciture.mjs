import { TIERS } from '../../src/core/quality.js';
import { PLATEAU } from '../../src/world/voxel/confine.js';
import { CAMPO_MATERIAL, campoMaterialCode } from '../../src/world/voxel/campo.js';
import {
  CHUNK, MATERIAL, NO_COLUMN, VOXEL,
} from '../../src/world/voxel/columns.js';
import { chunkList } from '../../src/world/voxel/mesher.js';
import { CENTRE, CORRIDOR_BOX, columnSpec } from '../../src/world/voxel/worldgen.js';
// THE ONE PROJECTOR THIS CAMPAIGN HAS. Leg 3 has to turn a PIXEL into a place
// on the plateau, and U-GRADE-1 made tools/grade/lib/framing.mjs the single
// seat for exactly that arithmetic -- a guard carrying its own copy of a camera
// is the drift that unit spent itself closing. Checked against the live camera
// on this tip at the pose leg 3 walks: five pixels, corners and centre, 0.00000
// degrees apart.
import { makeRay } from '../grade/lib/framing.mjs';
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
// AND THE SECOND INCIDENT, WHICH THIS FILE'S OWN RESIDUE ANNOUNCED
// (E-DECISIONI23, U-SUOLO-3).
//
// «Linee di cuciture azzurre ancora visibili quando cammino.» The strip was
// gone and something else was not. Leg 2 below had said so in writing: at pitch
// -26 the same sweep found patches of up to 43 px at eight to nine metres, in
// meadow the aerial says is solid, and leg 2 could not see them because its
// frame reaches seven metres. Nor could any leg here turn: the visitor cannot
// be turned under pointer lock by a driver, and legs 1 to 3 photograph three
// bearings between them.
//
// WHAT THEY WERE. The field marches a ray per pixel and the ray is given a
// CEILING on its crossings (uSteps, ninety six). A grazing ray -- the flattest
// in the frame, the top rows at pitch -26 -- crosses the meadow a cell at a
// time for twenty five metres, and there are not always ninety six cells' worth
// of ceiling under it. A ray that ran out reported NO HIT, and no hit is the
// sky. They stand in thin lines because a line of the picture is a line of
// bearings and what a march costs is a property of the bearing; they are seen
// walking because they are a property of WHERE THE EYE IS, and a walker sweeps
// every position while a pose sits on one.
//
// Proved one source at a time, on pinned poses, with the arms in
// src/world/voxel/campo-material.js: not the horizon gates (650 magenta, zero
// black), not the recomposition (the native frame reads MORE: 4924 against
// 2712), not the second ray, not the band, not the walk's direction -- and
// monotone in uSteps alone: 96 -> 2712 px, 128 -> 202, 192 -> 0.
//
// THE CURE IS NOT A BIGGER CEILING, because the number of cells a grazing ray
// crosses has no bound a uniform can be set to and any ceiling leaves a pose
// that shows the sky through the grass. It is that a ray which ran out inside
// the world answers with the ground it was standing over: THE TRAVERSAL THAT
// RAN OUT, at the foot of march(). LEG 3 is what holds it, and it holds it
// where the committente was standing: walking, turning, at three pitches.
//
// ===========================================================================
// WHAT THIS GUARD ASKS, IN FOUR LEGS, AND WHY FOUR.
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
//      is leg 1's or leg 4's to catch and not this one's. The residue this leg
//      declared on the tip before -- 43 px at eight to nine metres at pitch -26
//      -- was real, it was the exhausted traversal above, and leg 4 is what
//      now stands where it stood.
//
//   3. THE WALK WITH THE ROTATION (U-SUOLO-3). Thirty metres down the corridor
//      and thirty across the meadow, stopping every 2.5 m, and at every station
//      FOUR bearings and one of the three pitches the committente walks at --
//      so the twelve bearings and the three pitches are all taken, several
//      times each, over the two walks. The frame is shallow now, so sky belongs
//      in it and a count of undrawn pixels would be a count of the sky: the
//      question is asked of each undrawn pixel instead, through the campaign's
//      own projector, and it is the question the unit was given. Does this
//      pixel's ray point UNDER the horizontal, and -- marched against the LAW,
//      the same `columnSpec` seat leg 1 reads and campoTile writes its bytes
//      out of -- does it go under the world's own surface within sixty metres.
//      Masonry's footprint leaves by the same door it leaves leg 1 by: a column
//      with no top and stone under it is not the field's and owes nothing. What
//      is left is sky under the horizon where the ground is, and the assertion
//      is zero of it. No threshold, for the reason leg 2 gives.
//
//   4. THE VISITOR'S PAGE. Legs 1 to 3 measure `?dev`, and E-SUOLO-VIS1 is the
//      standing lesson of this repository about what that is worth: the
//      committente's own page is a different machine, in the THIRD person, with
//      no tier asked for by hand and no pose imposed. So the last leg opens the
//      page as it is delivered, walks it with the keyboard, and reads the one
//      thing a page with no handles can be asked: how much of the ground band
//      is the sky's own colour (bandSky, whose margins were measured in
//      E-SUOLO-VIS1). It is the leg with a floor on it, and it is the leg that
//      photographs the world the defect was reported from.
//
//   --fast  legs 2, 3 and 4 are skipped; leg 1 always runs.
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
// LEG 3 -- THE WALK WITH THE ROTATION (U-SUOLO-3).

/** The three pitches the committente walks at. */
const WALK_PITCHES = [-15, -26, -35];
/** Where the eye stands while walking: the walker's own, not the pose's. */
const WALK_EYE = 1.7;

/**
 * THE TWO WALKS, AND WHY THE STATIONS TURN.
 *
 * Thirty metres of corridor and thirty of open meadow, a station every 2.5 m.
 * Twelve bearings at three pitches at every one of twenty six stations is nine
 * hundred plates and a guard nobody runs; four bearings at one pitch is a
 * hundred and four, and because the base bearing steps 30 degrees and the pitch
 * steps one place at every station, ALL TWELVE bearings and all three pitches
 * are taken, several times each and at several places, over the two walks.
 *
 * The defect is a coincidence of WHERE the eye is and WHICH WAY it looks -- a
 * pose reproduces it exactly and a neighbouring pose does not -- so what a
 * sweep needs is breadth over that product and not depth at one point of it.
 */
function walkStations(id, from, along) {
  const out = [];
  for (let k = 0; k * 2.5 <= 30; k += 1) {
    const step = k * 2.5;
    const x = from.x + along.x * step;
    const z = from.z + along.z * step;
    for (let q = 0; q < 4; q += 1) {
      out.push({
        id: `${id} ${step.toFixed(1)} m`,
        x,
        z,
        yaw: (k * 30 + q * 90) % 360,
        pitch: WALK_PITCHES[k % WALK_PITCHES.length],
      });
    }
  }
  return out;
}

const WALK_ROT = [
  ...walkStations('sentiero', { x: 0.25, z: 0 }, { x: 0, z: 1 }),
  ...walkStations('prato', { x: -15, z: 8 }, { x: 1, z: 0 }),
];
/** What the two walks actually cover, counted rather than claimed. */
const WALK_COVER = {
  yaws: new Set(WALK_ROT.map((s) => s.yaw)).size,
  pitches: [...new Set(WALK_ROT.map((s) => s.pitch))].sort((a, b) => b - a),
};

/**
 * HOW FAR THIS LEG WILL VOUCH FOR A PIXEL, AND WHY IT IS A MARCH AND NOT A
 * PLANE.
 *
 * The first draft of this predicate met the ray with the plateau's own level
 * and asked whether the meeting point was inside the rim. It was wrong, and
 * wrong in the direction that hides the defect: the poses this unit pinned look
 * OUTWARD, and the sky they carried lay at forty metres, on the first terraces
 * past PLATEAU where y = 0 is not the ground at all and the plane's answer is a
 * place the world is not. So the ray is marched against the LAW -- columnSpec,
 * the same seat leg 1 reads and the same seat campoTile writes its bytes out of
 * -- and what is asked is the honest question: walking out from the eye, does
 * this ray go under the world's own surface before REACH_M.
 *
 * AND THE REACH IS TWO HUNDRED METRES, WHICH IS MEASURED AND NOT CHOSEN. The
 * rays this unit is about are the FLATTEST in the frame, and a flat ray over
 * ground that is itself falling away runs a long way before it meets anything:
 * from the pinned pose A, at pitch -3.9 degrees, the law puts the meeting at
 * 97 m -- past the rim, past the terraces, out where the basin levels. Sixty
 * metres was tried first and answered «no ground owed» for exactly the pixels
 * the defect is made of, which is the shape of a predicate that excuses what it
 * is supposed to catch. Two hundred is inside the far window the field draws
 * (409.6 m, centred on the world), so everything inside it is this engine's.
 *
 * THE STEP IS HALF A METRE, and what that can miss is a terrace crossed and
 * recrossed inside one sample. A riser is one cube (0.10 m) and a ray this flat
 * changes height by 3.5 cm over half a metre, so a crossing missed here is a
 * FAULT NOT COUNTED and never a fault invented: the leg errs towards letting a
 * pixel through, which is the only direction a guard may err in.
 */
const REACH_M = 200;
const MARCH_M = 0.5;

/** The surface the law puts at a point, in metres, or null where it puts none. */
function lawY(gx, gz) {
  const spec = columnSpec(Math.floor(gx / VOXEL), Math.floor(gz / VOXEL), true, PLATEAU, true);
  if (spec.top === NO_COLUMN) {
    // Masonry stands on this column: the ground under a block is nobody's, and
    // the frame this leg reads has the monoliths taken out of it, so a pixel
    // that lands here is not owed anything. It is the same door leg 1 leaves by.
    return spec.mat === MATERIAL.STONE ? 'pietra' : null;
  }
  // campoGroundByte's own inverse, in metres: what the field's texel says.
  return (spec.top + 1) * VOXEL;
}

/**
 * THE LAW, CUT ONCE INTO A GRID, BECAUSE A MARCH PER PIXEL IS NOT AFFORDABLE.
 *
 * Most of what leg 3 marches is NOT a hole: at pitch -15 the band between the
 * field's own skyline and the horizontal is sky, undrawn (the hills are out of
 * this frame) and pointing down, so every pixel of it pays a full march to be
 * told there is nothing owed. Asked of columnSpec that is four hundred calls a
 * pixel and minutes a plate. Asked of a grid cut once it is four hundred array
 * reads, and the grid is the SAME function, sampled: no second law.
 *
 * Half a metre a cell over the whole far window, 641 601 columns, cut on first
 * use and kept. NaN is «no column here», and the stone flag is its own byte.
 */
const GRID_M = 0.5;
const GRID_N = Math.round((REACH_M * 2) / GRID_M) + 1;
let gridY = null;
let gridStone = null;

function cutGrid() {
  gridY = new Float32Array(GRID_N * GRID_N);
  gridStone = new Uint8Array(GRID_N * GRID_N);
  for (let j = 0; j < GRID_N; j += 1) {
    const gz = -REACH_M + j * GRID_M;
    for (let i = 0; i < GRID_N; i += 1) {
      const y = lawY(-REACH_M + i * GRID_M, gz);
      if (y === 'pietra') { gridStone[j * GRID_N + i] = 1; gridY[j * GRID_N + i] = NaN; } else {
        gridY[j * GRID_N + i] = y === null ? NaN : y;
      }
    }
  }
}

/**
 * HOW FAR UNDER THE SURFACE A RAY MUST GO BEFORE THE LAW WILL SWEAR TO IT.
 *
 * ONE VOXEL, and it is a tolerance in METRES OF WORLD and not a budget of
 * PIXELS -- which is the whole difference, and the reason leg 2's «no
 * threshold» is not contradicted here. The law answers in exact real numbers;
 * the picture it is compared against does not. Out where these rays are, the
 * field reads a texel forty centimetres across whose ground is a byte quantised
 * to one cube and whose blade is a second byte over it. Where a ray passes
 * closer to the surface than the picture's own quantum, «ground» and «air» are
 * the same answer and the pixel is legitimately either.
 *
 * IT IS NOT A GUESS, it is the one case that survived this unit's cure and it
 * was measured. From the station prato 17.5 m at bearing 210, pitch -26, the
 * top CORNER ray meets the law's surface at 29.80 m -- and the closest it had
 * come before that, at 29.75 m, is ONE POINT THREE MILLIMETRES above it. A leg
 * that calls that a hole is not measuring the world: it is splitting a
 * millimetre at thirty metres against a picture built in decimetres, and it
 * does it intermittently, which is how it was recognised (two runs of the same
 * tip, same station: 2 px and 0 px).
 */
const GRAZE_M = VOXEL;

/** The march itself, against whichever reading of the law it is handed. */
function walkRay(eye, d, height) {
  for (let t = 0.4; t <= REACH_M; t += MARCH_M) {
    const gx = eye.x + d[0] * t;
    const gz = eye.z + d[2] * t;
    // Past the far window the ground is the skyline's and not the field's.
    if (Math.abs(gx) > REACH_M || Math.abs(gz) > REACH_M) return null;
    const y = height(gx, gz);
    if (y === 'pietra') return null;
    if (y === null || Number.isNaN(y)) continue;
    if (eye.y + d[1] * t <= y - GRAZE_M) return { t, gx, gz };
  }
  return null;
}

/**
 * Where a ray meets the world the LAW describes, or null within this leg's
 * reach.
 *
 * TWO MARCHES, AND THE GRID IS ONLY THE SIEVE. The grid is the law SAMPLED at
 * half a metre, which is the right instrument for throwing away the great
 * majority of pixels -- the sky over the field's own skyline -- for four hundred
 * array reads instead of four hundred calls. It is the wrong instrument for
 * DECIDING, and it was measured being wrong: at the rim, where the terraces
 * begin and a ray crosses the ground within a decimetre of it, a sample rounded
 * to the nearest grid point says «ground here» where the law at the exact point
 * says the ray is still in the air. That is four pixels out of a hundred and
 * four plates, always on a rim crossing, and it is the GUARD being wrong about
 * the world rather than the world being wrong.
 *
 * So a candidate is re-marched against columnSpec itself, exactly, at the very
 * points the ray passes through. Candidates are rare by construction, so the
 * cost of the second march is nothing, and what the leg asserts is the law and
 * not a picture of it.
 *
 * @returns {{t: number, gx: number, gz: number}|null}
 */
function meetsGround(eye, d) {
  if (!gridY) cutGrid();
  const sieve = walkRay(eye, d, (gx, gz) => {
    const k = Math.round((gz + REACH_M) / GRID_M) * GRID_N
      + Math.round((gx + REACH_M) / GRID_M);
    return gridStone[k] ? 'pietra' : gridY[k];
  });
  if (!sieve) return null;
  return walkRay(eye, d, lawY);
}

/**
 * Sky under the horizon where the ground is, counted, at one pose.
 *
 * @param {object} plate  the raw frame
 * @param {object} read   the six numbers the CAMERA read back, not the six asked
 * @returns {{n: number, far: number[], box: object|null}}
 */
function skyOnGround(plate, read) {
  const {
    data, width, height, channels,
  } = plate;
  const ray = makeRay({ width, height, pose: read });
  const eye = read.position;
  let n = 0;
  let box = null;
  const far = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      if (data[i] + data[i + 1] + data[i + 2] > 6) continue;
      const d = ray(x, y);
      // Over the horizontal there is sky by arithmetic, and it belongs there.
      if (d[1] >= -1e-4) continue;
      const met = meetsGround(eye, d);
      if (!met) continue;
      n += 1;
      far.push(met.t);
      box = box ? {
        x0: Math.min(box.x0, x), x1: Math.max(box.x1, x),
        y0: Math.min(box.y0, y), y1: Math.max(box.y1, y),
      } : {
        x0: x, x1: x, y0: y, y1: y,
      };
    }
  }
  far.sort((a, b) => a - b);
  return { n, far, box };
}

/**
 * One plate at one aimed pose, with the six numbers the camera actually read.
 *
 * The pose is ASKED and the camera is READ: setDevPose normalises a bearing and
 * hands back what it settled on, and a projector fed the number that was asked
 * for rather than the number that landed is the drift U-GRADE-1 closed.
 *
 * AND IT WAITS FOR THE PICTURE, WHICH IS NOT THE SAME AS WAITING A WHILE.
 * A walker moves two and a half metres in a second and the clipmap keeps up; a
 * guard PUTS the camera two and a half metres on and photographs it, which is a
 * teleport, and a frame taken while a tile is still in a queue is a frame of an
 * ARRIVAL and not of a walk. Measured: on a fixed pause of 700 ms this leg read
 * four pixels over a hundred and four plates on one run and ZERO on the next,
 * at the same stations, with the same predicate -- which is the signature of a
 * picture still landing and not of a traversal. `hub.groundReady()` is the
 * field's own «every tile of both windows is in its picture» (campo.ready), the
 * same sentence the arrival veil lifts on, so the leg asks THAT and then gives
 * the frame its settle.
 */
async function aimedPlate(world, sharp, pose, { settle = 400 } = {}) {
  const read = await world.page.evaluate(({ p, on }) => {
    for (const child of window.farfield.scene.children) {
      const name = child.name || '';
      if (name.startsWith('v8-avatar')) continue;
      child.visible = on.includes(name);
    }
    return window.setDevPose(p);
  }, {
    p: {
      x: pose.x, y: WALK_EYE, z: pose.z, yaw: pose.yaw, pitch: pose.pitch, fov: FOV,
    },
    on: GROUND,
  });
  await world.page.waitForFunction(
    () => window.farfield.hub.groundReady(), null, { timeout: 30000, polling: 100 },
  );
  await world.page.waitForTimeout(settle);
  const png = await world.page.screenshot({ type: 'png' });
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return {
    plate: {
      data, channels: info.channels, width: info.width, height: info.height,
    },
    read: {
      position: { x: read.x, y: read.y, z: read.z },
      yaw: read.yaw,
      pitch: read.pitch,
      fov: read.fov,
    },
  };
}

/**
 * THE INJECTION, AND IT IS THE CURE ITSELF TAKEN BACK OUT.
 *
 * One program and a uniform, which is tools/bench/bench-sky.mjs's own lesson:
 * two materials are two pipelines and two runs are two noise floors, so the
 * arm and the null have to be one compile with a branch between them. The seam
 * cut here is the line THE TRAVERSAL THAT RAN OUT stands on, so `uClose` at
 * nought is the tip before U-SUOLO-3, to the line -- and a leg that cannot be
 * made to fail by putting the defect back is not holding anything.
 *
 * @returns {string} 'ok', or why the seam could not be cut
 */
async function closure(world, on) {
  return world.page.evaluate((flag) => {
    const mesh = window.farfield.scene.getObjectByName('ground-campo');
    if (!mesh) return 'la maglia del campo non c\'e\'';
    const u = mesh.material.uniforms;
    if (!u.uClose) {
      const before = mesh.material.fragmentShader;
      u.uClose = { value: 1 };
      mesh.material.fragmentShader = before
        .replace('uniform int uSteps;', 'uniform int uSteps;\n  uniform float uClose;')
        .replace('if (!escaped && !hit.found) {', 'if (uClose > 0.5 && !escaped && !hit.found) {');
      if (mesh.material.fragmentShader === before) return 'la cucitura da tagliare non c\'e\' piu\'';
      mesh.material.needsUpdate = true;
    }
    u.uClose.value = flag ? 1 : 0;
    return 'ok';
  }, on);
}

// ===========================================================================
// LEG 4 -- THE VISITOR'S PAGE.
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

  // LEG 3'S OWN PREDICATE, OFFLINE, AGAINST THE LAW IT IS WRITTEN ON. A ray
  // dropped at the middle of the meadow has to meet the ground; the same ray
  // turned upwards must not; and a ray dropped where the 06 stands must come
  // back with nothing owed, because the block is what stands on that column.
  const eyeHere = { x: 8, y: 1.7, z: 4 };
  cases.push({
    what: 'un raggio che scende nel prato incontra la terra della legge',
    caught: Boolean(meetsGround(eyeHere, [0.5, -0.5, 0.707])),
  });
  cases.push({
    what: 'e lo stesso raggio rovesciato in su non incontra niente',
    caught: meetsGround(eyeHere, [0.5, 0.5, 0.707]) === null,
  });
  // A COLUMN THE MASONRY STANDS ON, read off the law rather than guessed at:
  // the frame leg 3 photographs has the monoliths hidden, so a pixel that lands
  // on one of these would read as a hole on every plate that passed one.
  cases.push({
    what: 'un raggio che scende sulla pianta di un monolite non chiede terra a nessuno',
    caught: lawY(7.85, -5.35) === 'pietra'
      && meetsGround({ x: 7.85, y: 1.7, z: -7.35 }, [0, -0.6, 0.8]) === null,
  });
  // AND THE GRAZE, BY THE RAY IT WAS MEASURED ON. The top corner of the station
  // prato 17.5 m at bearing 210: it comes within 1.3 mm of the law's surface at
  // 29.75 m and crosses it at 29.80, which is a place the picture cannot tell
  // apart from air. The same eye a degree steeper is a metre under and is.
  cases.push({
    what: "un raggio che sfiora la legge per un millimetro non e' un buco",
    caught: meetsGround({ x: 2.5, y: 1.7, z: 8 }, [-0.0665, -0.0571, 0.9962]) === null,
  });
  cases.push({
    what: 'e lo stesso occhio un grado piu ripido ha la sua terra',
    caught: Boolean(meetsGround({ x: 2.5, y: 1.7, z: 8 }, [-0.0664, -0.0745, 0.9950])),
  });
  // AND THE TERRACES PAST THE RIM, which is where the poses this unit pinned
  // were looking and where a predicate written on the plateau's own plane said
  // there was nothing to answer for. At pitch -3.9 the meeting is at 97 m.
  cases.push({
    what: `oltre l'orlo (${PLATEAU} m) la legge ha ancora terra sotto un raggio radente`,
    caught: (() => {
      const met = meetsGround({ x: 16.7, y: 1.7, z: 4 }, [
        Math.cos(3.9 * Math.PI / 180), -Math.sin(3.9 * Math.PI / 180), 0,
      ]);
      return Boolean(met) && met.t > PLATEAU;
    })(),
  });

  if (!missing.length && !FAST) {
    // AND THE INJECTIONS THAT GO THROUGH THE PAGE.
    const server = await serveRepo(REUSE);
    const world = await openWorld({ chromium, port: server.port, width: 960, height: 540 });
    const pose = POSES[1];
    const whole = await groundPlate(world, sharp, pose, { settle: 1600 });
    const cut = await groundPlate(world, sharp, pose, { hide: ['ground-voxel'], settle: 900 });
    cases.push({
      what: `il quadro dietro il 06 come sta e' intero (${undrawn(whole).n} px vuoti)`,
      caught: undrawn(whole).n === 0,
    });
    cases.push({
      what: `e senza il magazzino del selciato e' bucato (${undrawn(cut).n} px vuoti)`,
      caught: undrawn(cut).n > 0,
    });

    // LEG 3'S OWN, AND IT IS THE CURE TAKEN BACK OUT. The four stations U-SUOLO-3
    // pinned the defect at, read with the closure on and with it off, in ONE
    // opening and ONE program. Measured on this tip: 0 px against 2712.
    const PINNED = [
      { id: 'A', x: 16.7, z: 4, yaw: 270, pitch: -26 },
      { id: 'B', x: 15.5, z: 4, yaw: 270, pitch: -26 },
      { id: 'C', x: 8, z: 14.45, yaw: 180, pitch: -26 },
      { id: 'D', x: -2.313, z: 20.423, yaw: 90, pitch: -26 },
    ];
    const sweep = async () => {
      let n = 0;
      for (const station of PINNED) {
        // eslint-disable-next-line no-await-in-loop
        const { plate, read } = await aimedPlate(world, sharp, station, { settle: 700 });
        n += skyOnGround(plate, read).n;
      }
      return n;
    };
    const armed = await closure(world, true);
    const withClosure = armed === 'ok' ? await sweep() : -1;
    await closure(world, false);
    const withoutClosure = armed === 'ok' ? await sweep() : -1;
    await closure(world, true);
    await world.close();
    await server.stop();
    cases.push({
      what: armed === 'ok'
        ? `le quattro pose di U-SUOLO-3 con la traversata chiusa: ${withClosure} px`
        : `la cucitura non si e' potuta tagliare: ${armed}`,
      caught: armed === 'ok' && withClosure === 0,
    });
    cases.push({
      what: `e con la chiusura tolta, che e' il tip di prima: ${withoutClosure} px`,
      caught: withoutClosure > 0,
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

if (missing.length) report.skip(`manca ${missing.join(' e ')}: le gambe 2, 3 e 4 non si possono fotografare`);
if (FAST) {
  report.note('--fast: le gambe 2, 3 e 4 non sono state corse, quindi un buco che la legge non vede passa');
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

  // -------------------------------------------------------------- LEG 3
  report.line(`  3. IL CAMMINO CON LA ROTAZIONE -- ${WALK_ROT.length} lastre,`
    + ` ${WALK_COVER.yaws} imbardate, pitch ${WALK_COVER.pitches.join('/')}, 30 m su sentiero e prato,`
    + ` cielo sotto l'orizzonte dove la legge da' terra entro ${REACH_M} m`);
  let rot = { n: -1 };
  let holed = 0;
  let total = 0;
  for (const station of WALK_ROT) {
    // eslint-disable-next-line no-await-in-loop
    const { plate, read } = await aimedPlate(world, sharp, station);
    const found = skyOnGround(plate, read);
    total += found.n;
    if (found.n) holed += 1;
    if (found.n > rot.n) {
      rot = { ...found, id: `${station.id} imbardata ${station.yaw} pitch ${station.pitch}` };
    }
  }
  report.check(holed === 0, `${WALK_ROT.length} stazioni: nessun pixel di cielo sopra la terra`,
    holed ? `${holed} lastre bucate, ${total} px in tutto, la peggiore ${rot.id}`
      + ` con ${rot.n} px a ${rot.far[0].toFixed(1)}..${rot.far[rot.far.length - 1].toFixed(1)} m`
      + ` in [${rot.box.x0}-${rot.box.x1}, ${rot.box.y0}-${rot.box.y1}]`
      : 'zero px su zero lastre');
  await world.close();
  world = null;

  // -------------------------------------------------------------- LEG 4
  visitor = await openVisitor({ chromium, port: server.port, width: VISITOR.width, height: VISITOR.height });
  const person = await visitor.person();
  report.line(`  4. IL VISITATORE -- ${VISITOR.width}x${VISITOR.height}, ${person} persona`
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

report.end(`${RADII.length} raggi, `
  + `${POSES.length + WALK_SN.length + WALK_WE.length + WALK_ROT.length} lastre`);
