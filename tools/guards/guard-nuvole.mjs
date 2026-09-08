import {
  CUBE_DEG, SHAPE, SUN_HINT, bandCoverage, beyondRoster, buildCloudField, makeCamera,
  rasterise, skylineRows,
} from '../../src/world/cloud-field.js';
import { ladders, skylineAt } from '../../assets-src/distant/cornice.mjs';
import { POSE_VOX_DAY } from '../../src/core/poses.js';
import { read, readJson, reporter, selfTest } from './lib.mjs';

// GUARD-NUVOLE -- THE WEATHER IS THE REFERENCE'S, MASS BY MASS AND BAND BY BAND.
//
// ===========================================================================
// WHY IT NEEDS NO BROWSER, WHICH IS THE WHOLE DESIGN.
//
// Everything R4 measured the sky on is SILHOUETTE: how much of each band of the
// frame is cloud, how many separate masses stand in it, how wide a cube is in
// degrees. A silhouette is arithmetic -- a roster, a density field, a mesher and
// a projection -- so src/world/cloud-field.js carries all of it with no three.js
// in it, and this lays the same sky down offline and counts the same pixels at
// every commit rather than at every screenshot. It is the shape guard-cornice
// already has for the horizon, and for the same reason.
//
// ===========================================================================
// THE BANDS ARE COUNTED AGAINST THE FRAME AND NOT AGAINST THE SKY, and that is
// a correction to R4's own arithmetic rather than a convenience.
//
// R4 §1.2 states the coverage as white over OPEN SKY -- white / (white + blue).
// That denominator is a reading of a photograph, and it is not the same
// denominator on the two sides any more. Measured, at the fitted pose, in the
// band from 7.6 to 13.3 degrees: the reference classifies 69.5% of that band as
// sky and this world classifies 90.8%, because what else stands in the band --
// crests, the far shore, the blocks -- is not the same in the two pictures. Two
// frames with the SAME cloud in them come out eleven points apart on that
// ratio.
//
// The NUMERATOR is free of all of it: a band is a fixed set of rows, and cloud
// pixels in it are cloud pixels. So the leg is stated there, on both sides, and
// the ratio is reported beside it as a reading rather than asserted.
//
// ===========================================================================
// WHAT IT DELIBERATELY DOES NOT ASSERT.
//
// THE COLOUR OF THE CLOUD. The scale of the self-shadow, its chroma and the
// level the lit faces reach are U-NUV-2's, on R4 §S2's own numbers, and a guard
// that pinned them here would pin the next unit's work to the first thing that
// happened to be measured. What IS asserted about the material is the two
// things that are this unit's: that it reads NO TEXTURE at all -- the plates
// read two per fragment -- and that it does not write depth, which is what
// keeps the composite grading it as sky and not as stone.
//
// THE BLUE BEHIND IT. The ramp is the coordinator's seat under E-V6l, D-R4-3 is
// open, and U-NUV-3 has it.

const report = reporter('guard-nuvole -- il tempo e\' quello del target, massa per massa');

const DEG = Math.PI / 180;
const W = 1672;
const H = 941;
const SKY_PATH = 'assets-src/sky/sky.json';
const SKY = readJson(SKY_PATH);
const injected = process.argv.includes('--inject');

const CLOUDS = injected
  // The self test's own hand: every mass pushed a third of the way up the sky.
  // It is the defect leg 1 exists for, and it is the shape of the one the plate
  // field actually had -- a composition that is not the reference's.
  ? { ...SKY.clouds, masses: SKY.clouds.masses.map((m) => ({ ...m, el: m.el * 1.35 })) }
  : SKY.clouds;

// --------------------------------------------------------------------------
// THE FRAME, AND WHAT IN IT IS SKY.
// --------------------------------------------------------------------------
const CAM = makeCamera(POSE_VOX_DAY, W, H);
const CORNICE = readJson('assets-src/distant/cornice.json');
const LADS = ladders(CORNICE);
const crest = new Map();
const crestAt = (bearing) => {
  const k = Math.round(bearing * 2) / 2;
  if (!crest.has(k)) {
    crest.set(k, skylineAt(CORNICE, {
      x: CAM.eye[0], y: CAM.eye[1], z: CAM.eye[2],
    }, k, LADS, 4).elevation);
  }
  return crest.get(k);
};
const SKYLINE = skylineRows(CAM, crestAt);

const BANDS = [[0, 100], [100, 200], [200, 280], [280, 400], [400, 480], [480, 554]];

// WHAT THE REFERENCE PUTS IN EACH BAND, as a percentage of the band's own rows.
//
// Read with fondazione/lav/n1-misura.mjs on farfield-day-voxel-target.png,
// divided by its own arrivalShading table (E-LUCE4: every measurement of this
// campaign is made with the corner shading taken off BOTH sides) and under the
// same skyline mask this file lays down, with R4 §1.1's own two classes.
//
// AND THE LAST BAND IS NOUGHT ON THIS WORLD, WHICH IS A FINDING AND NOT A
// TOLERANCE. Below 3.7 degrees there is no sky here at all: U-CORNICE-1's hills
// close the horizon between 3.9 and 9.9 degrees on every bearing of the frame,
// and the reference's own crests sit between 0 and 3.7. So the wisps the
// reference shows lowest cannot be shown at their own elevation by any roster,
// and the ones this world carries stand ON the crest of their bearing instead.
// It is written down in the roster, mass by mass, as `lifted`.
const TARGET_BANDS = [12.6, 27.0, 38.3, 28.6, 7.9, 0];
const BAND_TOLERANCE = 8;

// --------------------------------------------------------------------------
// THE FIELD, LAID DOWN OFFLINE.
// --------------------------------------------------------------------------
const shape = { ...SHAPE, ...(CLOUDS.shape || {}) };
const seen = CLOUDS.masses;
const all = [...seen, ...beyondRoster(seen, CLOUDS.beyond)];
const built = Date.now();
const field = buildCloudField(all, {
  cubeDeg: CLOUDS.cubeDeg ?? CUBE_DEG, shape, eye: CLOUDS.read.eye,
});
const buildMs = Date.now() - built;
const { cover } = rasterise(field, CAM);
const bands = bandCoverage(cover, CAM, SKYLINE, BANDS);

/** Cloud as a share of each band's own rows, which is what the legs are on. */
export function bandShare(coverage, width, bandRows) {
  return bandRows.map(([a, b]) => {
    let n = 0;
    for (let y = a; y < b; y++) {
      for (let x = 0; x < width; x++) if (coverage[y * width + x]) n++;
    }
    return 100 * n / ((b - a) * width);
  });
}
const share = bandShare(cover, W, BANDS);

// --------------------------------------------------------------------------
// 1. THE COVERAGE PER BAND IS THE REFERENCE'S.
// --------------------------------------------------------------------------
report.line('');
report.line('  1. la copertura per fascia');
let worst = 0;
for (let i = 0; i < BANDS.length; i++) {
  const off = Math.abs(share[i] - TARGET_BANDS[i]);
  if (off > worst) worst = off;
  const elev = `${CAM.elevOfRow(BANDS[i][1]).toFixed(1)}-${CAM.elevOfRow(BANDS[i][0]).toFixed(1)} deg`;
  report.check(off <= BAND_TOLERANCE, `${elev.padEnd(16)} nuvola sul quadro`,
    `${share[i].toFixed(1)}% contro ${TARGET_BANDS[i]}% del target `
    + `(scarto ${off.toFixed(1)}, tolleranza ${BAND_TOLERANCE})`
    + `   [nuvola sul cielo aperto ${bands[i].whiteOverSky.toFixed(0)}%]`);
}

// --------------------------------------------------------------------------
// 2. THE MASSES ARE SEPARATE, AND THERE ARE AT LEAST EIGHT OF THEM.
// --------------------------------------------------------------------------
/** Four-connected components of a coverage buffer, at half resolution. */
export function components(mask, width, height, until = 560) {
  const hw = width >> 1;
  const hh = Math.min(until, height) >> 1;
  const small = new Uint8Array(hw * hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) small[y * hw + x] = mask[(y * 2) * width + x * 2];
  }
  const label = new Int32Array(hw * hh);
  const queue = new Int32Array(hw * hh);
  const out = [];
  let n = 0;
  for (let s = 0; s < hw * hh; s++) {
    if (!small[s] || label[s]) continue;
    n++;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    label[s] = n;
    let area = 0;
    while (head < tail) {
      const p = queue[head++];
      area++;
      const x = p % hw;
      const y = (p / hw) | 0;
      const put = (q) => { if (small[q] && !label[q]) { label[q] = n; queue[tail++] = q; } };
      if (x > 0) put(p - 1);
      if (x < hw - 1) put(p + 1);
      if (y > 0) put(p - hw);
      if (y < hh - 1) put(p + hw);
    }
    // In pixels of the whole frame, as R4 §1.1 counts them.
    out.push(area * 4);
  }
  return out.sort((a, b) => b - a);
}
const masses = components(cover, W, H).filter((a) => a >= 2000);
report.line('');
report.line('  2. le masse');
report.check(masses.length >= 8, 'masse separate di almeno 2000 px',
  `${masses.length} (il target ne ha 10; la parete di placche ne aveva 3)`);

// --------------------------------------------------------------------------
// 3. THE CUBE IS THE SAME ANGLE AT EVERY DISTANCE.
// --------------------------------------------------------------------------
//
// This is the law the whole unit stands on, and it is checked on the FIELD and
// not on the constant: every mass states a distance, the mesher is handed a
// side, and what the frame shows is the angle that side subtends from the eye
// the roster was read at. R4 §1.4 read 0.61 to 0.67 degrees on the reference,
// constant from the largest mass to the smallest wisp; the plates carried 0.21
// to 0.60 in the tile and 1.0 to 3.0 in the frame.
report.line('');
report.line('  3. il cubo');
let cubeLo = Infinity;
let cubeHi = -Infinity;
for (const m of field.masses) {
  const d = Math.hypot(
    m.centre[0] - CAM.eye[0], m.centre[1] - CAM.eye[1], m.centre[2] - CAM.eye[2],
  );
  const deg = 2 * Math.atan(m.side / 2 / d) / DEG;
  if (deg < cubeLo) cubeLo = deg;
  if (deg > cubeHi) cubeHi = deg;
}
report.check(cubeLo >= 0.55 && cubeHi <= 0.75,
  'il cubo apparente sta fra 0,55 e 0,75 gradi su OGNI massa',
  `${cubeLo.toFixed(3)} - ${cubeHi.toFixed(3)} (il target: 0,61-0,67)`);
report.check(Math.abs((CLOUDS.cubeDeg ?? CUBE_DEG) - 0.64) < 1e-9,
  'e la legge dichiarata e\' quella misurata sul target',
  `s = D * tan(${CLOUDS.cubeDeg} gradi)`);

// --------------------------------------------------------------------------
// 4. THE BLUE OVER THE BLOCKS.
// --------------------------------------------------------------------------
//
// R4 §1.7 read the band of forty rows over each block's head: the reference
// shows 03 entirely against blue, and 04 and 05 with blue and cloud both. The
// plate field showed 97% over 03 and NOUGHT over 04 and 05 -- the wall covered
// them to the roof, which is E-OCCHIO1's own complaint about the sky.
report.line('');
report.line('  4. il blu sopra i monoliti');
// The blocks stand between -25 and +25 degrees of bearing and reach 6 to 25
// degrees of elevation. The per-block silhouettes belong to V2 and are not in
// any seat this file may read, so what is asked here is the weaker -- and true
// -- version of R4's own question: that the sky straight ahead, in the band the
// five heads stand against, is not a LID. It is the shape of the complaint
// E-OCCHIO1 made and the shape of what the plates did: 71% of that window was
// plate, and 04 and 05 stood against it to the roof.
const AHEAD = { x0: Math.round(W * 0.3), x1: Math.round(W * 0.7), y0: 180, y1: 300 };
let lid = 0;
let lidAll = 0;
for (let y = AHEAD.y0; y < AHEAD.y1; y++) {
  for (let x = AHEAD.x0; x < AHEAD.x1; x++) { lidAll++; if (cover[y * W + x]) lid++; }
}
report.check(100 * lid / lidAll <= 60,
  'sopra le teste dei monoliti il cielo non e\' un coperchio',
  `${(100 * lid / lidAll).toFixed(0)}% di nuvola fra 13 e 21 gradi al centro `
  + '(le placche: 71%)');

// --------------------------------------------------------------------------
// 5. WHAT IT COSTS, AND WHAT IT NO LONGER COSTS.
// --------------------------------------------------------------------------
report.line('');
report.line('  5. il conto');
const BUDGET = { draws: 4, triangles: 18000, bytes: 0, ms: 1.2 };
report.check(field.triangles <= BUDGET.triangles,
  `non piu' di ${BUDGET.triangles} triangoli`,
  `${field.triangles} (${field.cubes} cubi, ${all.length} masse su tutta la bussola)`);
const source = read('src/world/voxel-clouds.js');
const draws = (source.match(/new Mesh\(/g) || []).length;
report.check(draws === 1 && draws <= BUDGET.draws,
  `una draw sola, e non piu' di ${BUDGET.draws}`, `${draws} mesh`);
const fragment = source.slice(source.indexOf('const CLOUD_FRAGMENT'),
  source.indexOf('export function createVoxelClouds'));
report.check(!/\btexture2D\b|\bsampler2D\b|\btexture\s*\(/.test(fragment),
  'il frammento non legge nessuna texture', 'zero campionatori (la placca ne aveva due)');
const fragmentJson = readJson('assets-src/assets.d/v6-cielo-nuvole.json');
/** The weather asks for no asset at all: the plates and the atlas are gone. */
const asksNoAsset = (json) => json.assets.length === 0;
report.check(asksNoAsset(fragmentJson),
  'e il tempo non chiede nessun asset', `${fragmentJson.assets.length} asset dichiarati `
  + '(le placche: cloud-sprites, cloud-cover, cloud-equirect, 2,24 MB di ktx2)');

// --------------------------------------------------------------------------
// 6. HOW IT IS DRAWN, WHICH IS WHERE THE PLATES' ONE GOOD IDEA SURVIVES.
// --------------------------------------------------------------------------
report.line('');
report.line('  6. come e\' disegnato');
report.check(/depthWrite:\s*false/.test(source) && /depthTest:\s*true/.test(source),
  'non scrive la profondita\', e la prova',
  'una nuvola opaca che la scrive viene gradata come pietra: piu\' sole, piu\' scura');
report.check(/renderOrder = -1/.test(source),
  'ed e\' disegnata dopo la cupola', 'renderOrder -1, come le placche');
report.check(/throughAir\(/.test(source),
  'la prospettiva aerea viene dalla sede', 'src/world/air.js, non un velo suo');
report.check(/uSunDir/.test(source) && !/uCloudSun:\s*\{\s*value:\s*new Vector3\(\s*[-0-9]/.test(source),
  'il sole e\' quello del sigillo e non una copia',
  'SKY_UNIFORMS.uSunDir, condiviso per riferimento');
const seal = SKY.day.sun.vector;
const drift = Math.acos(Math.min(1, Math.max(-1,
  seal[0] * SUN_HINT[0] + seal[1] * SUN_HINT[1] + seal[2] * SUN_HINT[2]))) / DEG;
report.check(drift < 0.01,
  'e la copia che l\'aritmetica offline porta non e\' scivolata via dal sigillo',
  `${drift.toFixed(4)} gradi fra SUN_HINT e sky.json day.sun.vector`);

// --------------------------------------------------------------------------
// 7. THE WIND, AND WHERE THE SHADOW FALLS.
// --------------------------------------------------------------------------
report.line('');
report.line('  7. il vento e la sede dell\'ombra');
const speed = Math.hypot(...CLOUDS.wind);
report.check(speed > 0.5 && speed < 12, 'il vento e\' in metri al secondo',
  `${speed.toFixed(1)} m/s da ovest (D9 = A); a t0 il roster e' la composizione del target`);
report.check(/cloudShadowAt/.test(read('src/world/layers/v6-cielo-nuvole.js')),
  'la sede dell\'ombra sul prato e\' pubblicata (D5 = A)',
  'cloudShadowAt(x, z) sul layer del cielo; il termine nel campo e\' di U-NUV-3');

report.line('');
report.line(`  campo costruito offline in ${buildMs} ms; `
  + `peggior scarto di fascia ${worst.toFixed(1)} punti`);

// --------------------------------------------------------------------------
// THE OTHER DIRECTION.
// --------------------------------------------------------------------------
if (process.argv.includes('--self')) {
  const lay = (masses_) => {
    const f = buildCloudField(masses_, {
      cubeDeg: CLOUDS.cubeDeg, shape, eye: CLOUDS.read.eye,
    });
    const c = rasterise(f, CAM).cover;
    const sh = BANDS.map(([a, b]) => {
      let n = 0;
      for (let y = a; y < b; y++) for (let x = 0; x < W; x++) if (c[y * W + x]) n++;
      return 100 * n / ((b - a) * W);
    });
    return { f, c, sh, worst: Math.max(...sh.map((v, i) => Math.abs(v - TARGET_BANDS[i]))) };
  };
  const sound = lay(all);
  const lifted = lay(all.map((m) => ({ ...m, el: m.el * 1.35 })));
  const wall = lay([{
    az: -2, el: 12, D: 900, w: 70, h: 26, seed: 1, towers: 6, bulk: 1.6,
  }]);
  const fat = lay(all.map((m) => ({ ...m, w: m.w * 1.6, h: m.h * 1.6 })));
  const coarse = buildCloudField(all, { cubeDeg: 1.6, shape, eye: CLOUDS.read.eye });
  let coarseHi = 0;
  for (const m of coarse.masses) {
    const d = Math.hypot(
      m.centre[0] - CAM.eye[0], m.centre[1] - CAM.eye[1], m.centre[2] - CAM.eye[2],
    );
    coarseHi = Math.max(coarseHi, 2 * Math.atan(m.side / 2 / d) / DEG);
  }
  const lidOf = (c) => {
    let a = 0; let b = 0;
    for (let y = AHEAD.y0; y < AHEAD.y1; y++) {
      for (let x = AHEAD.x0; x < AHEAD.x1; x++) { b++; if (c[y * W + x]) a++; }
    }
    return 100 * a / b;
  };
  selfTest('guard-nuvole', [
    { what: 'il cielo com\'e\' non e\' accusato di niente',
      caught: sound.worst <= BAND_TOLERANCE && components(sound.c, W, H).filter((x) => x >= 2000).length >= 8 },
    { what: 'ogni massa spinta un terzo piu\' in alto (una composizione che non e\' quella del target)',
      caught: lifted.worst > BAND_TOLERANCE },
    { what: 'la parete: una lastra sola da settanta gradi, che e\' il difetto delle placche',
      caught: wall.worst > BAND_TOLERANCE
        && components(wall.c, W, H).filter((x) => x >= 2000).length < 8 },
    { what: '... e che sopra le teste dei monoliti fa un coperchio',
      caught: lidOf(wall.c) > 60 && lidOf(sound.c) <= 60 },
    { what: 'ogni massa gonfiata di tre quinti',
      caught: fat.worst > BAND_TOLERANCE },
    { what: 'il cubo cotto a una taglia sola invece che per distanza',
      caught: coarseHi > 0.75 },
    // USED TO BE `[{ id: 'cloud-sprites' }].length !== 0`, a hand-written array
    // measured against zero: a constant true that never called the predicate.
    // (U-GUARDIA-3, E-IGIENE.)
    { what: 'un asset dichiarato di nuovo nel frammento del cielo',
      caught: !asksNoAsset({ ...fragmentJson, assets: [{ id: 'cloud-sprites' }] })
        && asksNoAsset(fragmentJson) },
  ]);
}

report.end();
