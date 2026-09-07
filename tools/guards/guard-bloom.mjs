import { createRequire } from 'node:module';
import { POSES } from '../../src/core/poses.js';
import { lineOf, read, readJson, reporter, selfTest } from './lib.mjs';

// DOES THE HALO STAY ON WHAT GLOWS, INSTEAD OF SPILLING OFF THE SKY?
//
//   node tools/guards/guard-bloom.mjs
//   node tools/guards/guard-bloom.mjs --self
//   node tools/guards/guard-bloom.mjs --pietra=acceso.png,spento.png
//                                     --lettura=acceso.png,spento.png
//
// WHY THIS EXISTS. The bloom of this world takes its source from the scene
// buffer by a threshold, and in that buffer the SKY is over the threshold
// across half the frame. What the chain then does with it is not a core with a
// skirt: the up pass OVERWRITES the level below it instead of adding to it, so
// the halo is ONE blur and `levels` is its width. A sky that is over the
// threshold therefore lays its own light that far into every silhouette
// standing against it -- and the silhouettes of this picture are the monoliths,
// whose faces in shadow are the tightest reading the campaign has.
//
// Measured, at the fitted camera, with the arrival veil divided out of both
// pictures: at a reach of thirty-two pixels the four shadowed faces of
// masonry-spec `palette` stood +1.5 to +4.9 L* over the offline bench that
// guard-pietra and guard-scala are weighed on. At eight they stand +0.0 to +1.8.
// That is what this guard holds.
//
// AND IT HOLDS THE OTHER SIDE OF IT TOO, which is the half a naive fix would
// lose. The engraved cyan of the panels is a source of the halo by the same
// threshold, and it is a SEPARATE reading, taken standing three metres and a
// half in front of a written face where a stroke is twenty pixels tall instead
// of three. There, the bloom adds one and a half to two levels to the stone one
// to three pixels out from a stroke, and the reach that ships adds MORE of that
// than the reach that shipped before -- a narrower blur puts a thin source's
// light back where the source is. A bloom simply turned down until the stone was
// clean would take it with it, and the panels are the one thing in this world
// that exists to glow.
//
// THE THRESHOLD IS NOT THE HANDLE AND THIS FILE GATES THAT TOO. Swept in the
// engine from 0.72 to 6.0, the sky's bleed on the stone and the ink's halo on
// the panel die TOGETHER and over the same span -- both half gone by 2.0, both
// entirely gone by 3.0. In this world's units the drawn sky and the engraved
// cyan sit in the same band of radiance, so no number on brightness alone keeps
// one and drops the other. Only the REACH tells them apart, and it tells them
// apart because a stroke is thin and a sky is not.

const POST = 'src/core/post.js';

/** The tiers as the file declares them, with the reach each one works out to. */
export function tiers(source) {
  const at = source.indexOf('const BLOOM_TIERS = {');
  if (at < 0) return null;
  const body = source.slice(at, source.indexOf('};', at));
  const out = {};
  const re = /'?([A-Za-z-]+)'?\s*:\s*\{\s*first:\s*([0-9]+)\s*,\s*levels:\s*([0-9]+)\s*\}/g;
  let hit;
  while ((hit = re.exec(body))) {
    const first = Number(hit[2]);
    const levels = Number(hit[3]);
    out[hit[1]] = { first, levels, reach: first * (2 ** (levels - 1)) };
  }
  return out;
}

/** The three numbers of the source, as the shipped `params` declares them. */
export function knobs(source) {
  const pick = (name) => {
    const hit = new RegExp(`${name}:\\s*([0-9.]+)`).exec(source);
    return hit ? Number(hit[1]) : null;
  };
  return {
    threshold: pick('bloomThreshold'),
    knee: pick('bloomKnee'),
    strength: pick('bloomStrength'),
  };
}

/**
 * Whether the up pass replaces the level below it instead of adding to it.
 *
 * THIS IS THE PROPERTY THE WHOLE FIT RESTS ON and it is worth one check of its
 * own, because it is invisible: a chain that ACCUMULATED would have a narrow
 * bright core with a wide dim skirt, and cutting `levels` would then take the
 * skirt off and leave the core -- a different picture from the one measured
 * here, and one where a sky's edge lift would not fall at all. The chain
 * overwrites: every pass is built with NoBlending and the up loop draws level i
 * into level i-1. If either of those changes, the reach above stops meaning
 * what this file says it means.
 */
export function overwrites(source) {
  const noBlend = /blending:\s*NoBlending/.test(source);
  const upWrites = /draw\(up,\s*bloomTargets\[i - 1\]\)/.test(source);
  return noBlend && upWrites;
}

// -------------------------------------------------------------- il righello
//
// The instrument is this file's own, as every guard's is: what it reads is a
// PNG and the seats the world publishes, and it may not reach into a working
// folder for either.
const require = createRequire(import.meta.url);
const DEG = Math.PI / 180;
const P = POSES['vox-giorno'];

const LAYOUT = {
  '01': { x: -9.32, z: -4.81, rot: 65.0, w: 3.44, d: 1.48, base: 0 },
  '02': { x: -5.29, z: -10.77, rot: 29.4, w: 3.46, d: 1.10, base: 0 },
  '03': { x: 0.05, z: -16.68, rot: 18.0, w: 5.60, d: 1.10, base: 1.30 },
  '04': { x: 5.01, z: -7.53, rot: -37.5, w: 2.99, d: 2.07, base: 0 },
  '05': { x: 8.19, z: -3.69, rot: -48.5, w: 2.90, d: 1.66, base: 0 },
};

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** L* of a triple of bytes. */
export function star(rgb) {
  const y = 0.2126 * toLinear(rgb[0] / 255) + 0.7152 * toLinear(rgb[1] / 255)
    + 0.0722 * toLinear(rgb[2] / 255);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}
const isInk = (r, g, b) => (b > 1.5 * r + 8 && g > 90 && b > 120);
const isGreen = (r, g, b) => Math.min(g - r, g - b) > 6;
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

async function frame(png) {
  const sharp = require('sharp');
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels } = info;
  const at = (x, y) => {
    const o = (y * W + x) * channels;
    return [data[o], data[o + 1], data[o + 2]];
  };
  const F = (H / 2) / Math.tan((P.fov / 2) * DEG);
  const cy = Math.cos(P.yaw * DEG); const sy = Math.sin(P.yaw * DEG);
  const cp = Math.cos(P.pitch * DEG); const sp = Math.sin(P.pitch * DEG);
  const project = (x, y, z) => {
    const dx = x - P.position.x; const dy = y - P.position.y; const dz = z - P.position.z;
    const rx = cy * dx - sy * dz;
    const rz = sy * dx + cy * dz;
    const ry = cp * dy + sp * rz;
    const rz2 = -sp * dy + cp * rz;
    if (rz2 >= -1e-6) return null;
    return [W / 2 + F * (rx / -rz2), H / 2 - F * (ry / -rz2)];
  };
  return { at, project, W, H };
}

/** The screen box of one face, eroded, without the tenth at its foot. */
export function faceBox(f, heads, id, name) {
  const b = LAYOUT[id];
  const a = b.rot * DEG;
  const right = [Math.cos(a), 0, -Math.sin(a)];
  const front = [Math.sin(a), 0, Math.cos(a)];
  const n = name === 'front' ? front : (name === 'left' ? right.map((v) => -v) : right);
  const along = name === 'front' ? right : front;
  const off = name === 'front' ? b.d / 2 : b.w / 2;
  const span = name === 'front' ? b.w : b.d;
  const pts = [];
  for (const t of [-0.42, 0.42]) {
    for (const u of [0.18, 0.92]) {
      const p = f.project(
        b.x + n[0] * off + along[0] * span * t,
        b.base + heads[id] * u,
        b.z + n[2] * off + along[2] * span * t,
      );
      if (p) pts.push(p);
    }
  }
  if (pts.length < 4) return null;
  return [Math.min(...pts.map((p) => p[0])) + 2, Math.min(...pts.map((p) => p[1])) + 2,
    Math.max(...pts.map((p) => p[0])) - 2, Math.max(...pts.map((p) => p[1])) - 2];
}

/** The median L* of the stone inside a box, ink and moss taken out. */
export function faceStar(f, box) {
  const px = [];
  for (let y = Math.max(0, Math.round(box[1])); y < Math.min(f.H, Math.round(box[3])); y++) {
    for (let x = Math.max(0, Math.round(box[0])); x < Math.min(f.W, Math.round(box[2])); x++) {
      const c = f.at(x, y);
      if (isInk(...c) || isGreen(...c)) continue;
      px.push(c);
    }
  }
  if (px.length < 20) return null;
  const med = [0, 1, 2].map((k) => {
    const v = px.map((p) => p[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  });
  return star(med);
}

/**
 * How much the stone one, two and three pixels out from an engraved stroke
 * stands over the stone that is more than twenty pixels from any of them.
 *
 * Read on the WHOLE frame rather than in a window, because the reading pose is
 * a pose of the bench and not of this file: what the guard needs is a picture
 * with writing large in it, and the two it is handed are one picture with the
 * halo and one without.
 */
export async function inkRing(png) {
  const f = await frame(png);
  const D = new Float32Array(f.W * f.H).fill(1e9);
  for (let y = 0; y < f.H; y++) {
    for (let x = 0; x < f.W; x++) if (isInk(...f.at(x, y))) D[y * f.W + x] = 0;
  }
  const put = (i, v) => { if (v < D[i]) D[i] = v; };
  for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) {
    const i = y * f.W + x;
    if (y > 0) put(i, D[i - f.W] + 3);
    if (x > 0) put(i, D[i - 1] + 3);
    if (y > 0 && x > 0) put(i, D[i - f.W - 1] + 4);
    if (y > 0 && x < f.W - 1) put(i, D[i - f.W + 1] + 4);
  }
  for (let y = f.H - 1; y >= 0; y--) for (let x = f.W - 1; x >= 0; x--) {
    const i = y * f.W + x;
    if (y < f.H - 1) put(i, D[i + f.W] + 3);
    if (x < f.W - 1) put(i, D[i + 1] + 3);
    if (y < f.H - 1 && x < f.W - 1) put(i, D[i + f.W + 1] + 4);
    if (y < f.H - 1 && x > 0) put(i, D[i + f.W - 1] + 4);
  }
  const near = [];
  const far = [];
  for (let y = 0; y < f.H; y++) {
    for (let x = 0; x < f.W; x++) {
      const i = y * f.W + x;
      const c = f.at(x, y);
      const v = luma(c);
      if (isInk(...c) || isGreen(...c) || v > 110) continue;
      const d = D[i] / 3;
      if (d >= 1 && d < 4) near.push(v);
      else if (d >= 20 && d < 40) far.push(v);
    }
  }
  const med = (a) => { a.sort((x, y) => x - y); return a.length > 100 ? a[Math.floor(a.length / 2)] : null; };
  const n = med(near); const g = med(far);
  return n === null || g === null ? null : n - g;
}

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).split(',') : null;
};

// ------------------------------------------------------------------- i limiti
//
// THE REACH IS THE FITTED NUMBER and the band round it is the sweep's own: at
// four the panels lose their halo (the bloom adds 0.4 levels two pixels out from
// a stroke, against 1.8 at eight), at sixteen the stone doubles its distance
// from the bench. Eight is where the two meet and there is no third number
// between them, so the gate is the number and not a range.
const REACH = 8;
// A shadowed face may not stand more than this over the same face with the halo
// switched off. Two, because the fit lands at 1.8 on the worst of the four and
// the instrument's own null between two shots of the same code is 0.0.
const FACE_SPILL = 2.0;
// And the panel's halo may not fall under this. The reading is a CONTRAST and
// not a level -- the stone one to three pixels out from a stroke, over the stone
// twenty to forty pixels from any of them, at a pose where the writing is large
// -- and the difference the halo makes to it is what is gated. A contrast is
// what the gate needs, because it falls on BOTH ways of losing the halo and a
// level falls on only one:
//
//   reach   threshold   what the halo adds to that contrast
//     4        0.72        3.00     <- too tight: it no longer reaches the ring
//     8        0.72        5.82     <- what ships
//    12        0.72        7.59
//    16        0.72        7.32
//    32        0.72        3.09     <- what shipped before: so wide it lifts the
//                                      reference as much as the ring
//     8        2.00        2.74     <- the strokes have stopped being a source
//
// Four is the floor, and it is the middle of a gap and not a taste: everything
// that keeps the halo is over five and a half, everything that has lost it one
// way or the other is under three and a fifth.
const INK_FLOOR = 4.0;
// The threshold may not rise into the band the engraved cyan lives in. Measured
// by sweep: at 2.0 the panels have lost half their halo and at 3.0 all of it.
const THRESHOLD_CEILING = 2.0;

if (process.argv.includes('--self')) {
  const source = read(POST);
  selfTest('guard-bloom', [
    {
      what: 'a halo widened back to where the sky spilled off it is caught',
      caught: tiers("const BLOOM_TIERS = {\n  half: { first: 2, levels: 5 },\n};").half.reach !== REACH,
    },
    {
      what: 'a cheaper tier reaching further than the tier above it is caught',
      caught: (() => {
        const t = tiers('const BLOOM_TIERS = {\n'
          + "  half: { first: 2, levels: 3 },\n  quarter: { first: 4, levels: 3 },\n};");
        return t.quarter.reach > t.half.reach;
      })(),
    },
    {
      what: 'a threshold raised into the band the engraved cyan lives in is caught',
      caught: knobs('bloomThreshold: 3.00,').threshold > THRESHOLD_CEILING,
    },
    {
      what: 'an up pass that added instead of replacing is caught',
      caught: !overwrites('blending: NormalBlending,\ndraw(up, bloomTargets[i - 1]);'),
    },
    {
      what: 'and one that wrote into the wrong level is caught',
      caught: !overwrites('blending: NoBlending,\ndraw(up, bloomTargets[i]);'),
    },
    {
      what: 'a face lifted three levels by the halo is caught',
      caught: Math.abs(18.5 - 15.5) > FACE_SPILL,
    },
    {
      what: 'a panel whose halo has been switched off with the spill is caught',
      caught: !(2.74 >= INK_FLOOR),
    },
    {
      what: 'and one whose halo has been spread so wide it is no longer a halo is caught',
      caught: !(3.09 >= INK_FLOOR),
    },
    {
      what: 'the delivered chain is none of those',
      caught: tiers(source).half.reach === REACH
        && knobs(source).threshold <= THRESHOLD_CEILING
        && overwrites(source),
    },
  ]);
}

const report = reporter('guard-bloom -- the halo stays on what glows');
const source = read(POST);
const shape = tiers(source);
const knob = knobs(source);

report.check(shape !== null && shape.half, 'the chain declares its tiers where this guard reads them');
report.check(shape.half.reach === REACH,
  `the halo reaches ${REACH} pixels, which is the number the stone in shadow was fitted on`,
  `first ${shape.half.first} x 2^${shape.half.levels - 1} = ${shape.half.reach} px`);
for (const [name, t] of Object.entries(shape)) {
  if (name === 'half') continue;
  report.check(t.reach <= shape.half.reach,
    `the ${name} tier reaches no further than the one above it: a cheaper tier is a cheaper picture, never a different one`,
    `${t.reach} px against ${shape.half.reach}`);
}
report.check(knob.threshold !== null && knob.threshold <= THRESHOLD_CEILING,
  'the threshold stays under the band the engraved cyan lives in, so the panels are still a source of the halo',
  `${knob.threshold} against a ceiling of ${THRESHOLD_CEILING}`);
report.check(overwrites(source),
  'the up pass REPLACES the level below it, which is what makes the reach the width of the whole halo',
  `NoBlending at line ${lineOf(source, source.indexOf('blending: NoBlending'))}`);

// ------------------------------------------------------- what a frame says
report.line('');
const pietra = arg('pietra');
const lettura = arg('lettura');
const SPEC = readJson('assets-src/monoliths/masonry-spec.json');
const HEADS = Object.fromEntries(
  Object.entries(SPEC.heads.perBlock).map(([k, v]) => [k, v.builtHead]),
);
// THE FACES IN SHADOW ARE THE TARGET'S OWN CHOICE AND NOT THIS FILE'S: what
// masonry-spec `palette` publishes under L* 20 is what E-PIETRA1-bis calls the
// shadow band, and they are the faces a sky spills onto because they are the
// dark side of a silhouette.
const SHADOW = Object.entries(SPEC.palette.perFace)
  .filter(([, v]) => v.L < 20).map(([k]) => k);

if (pietra && pietra.length === 2) {
  const [on, off] = await Promise.all(pietra.map(frame));
  const rows = [];
  for (const key of SHADOW) {
    const [id, name] = key.split('-');
    const box = faceBox(on, HEADS, id, name);
    if (!box) continue;
    const a = faceStar(on, box);
    const b = faceStar(off, faceBox(off, HEADS, id, name));
    if (a === null || b === null) continue;
    rows.push({ key, spill: a - b, on: a, off: b });
  }
  report.check(rows.length >= 3, 'the shadowed faces of the palette are readable in both frames',
    `${rows.length} of ${SHADOW.length}`);
  const worst = rows.reduce((w, r) => (Math.abs(r.spill) > Math.abs(w.spill) ? r : w), rows[0]);
  report.check(rows.every((r) => Math.abs(r.spill) <= FACE_SPILL),
    `no face in shadow is lifted more than ${FACE_SPILL} L* by the halo`,
    rows.map((r) => `${r.key} ${r.spill >= 0 ? '+' : ''}${r.spill.toFixed(2)}`).join('  '));
  report.note(`the worst of them is ${worst.key} at ${worst.spill.toFixed(2)} L* `
    + `(${worst.on.toFixed(1)} with the halo, ${worst.off.toFixed(1)} without)`);
} else {
  report.note('the stone was not asked: pass --pietra=<acceso.png>,<spento.png>, two shots of one '
    + 'sitting at the fitted pose with the arrival veil off, to weigh the spill on the faces');
}

if (lettura && lettura.length === 2) {
  const [on, off] = await Promise.all(lettura.map(inkRing));
  report.check(on !== null && off !== null,
    'the engraved strokes are readable in both frames of the reading pose');
  const kept = on - off;
  report.check(kept >= INK_FLOOR,
    `the panels keep their halo: the bloom still adds at least ${INK_FLOOR} levels one to three `
    + 'pixels out from a stroke',
    `${kept.toFixed(2)} levels`);
} else {
  report.note('the panels were not asked: pass --lettura=<acceso.png>,<spento.png>, two shots of '
    + 'one sitting standing in front of a written face, to weigh the halo that has to survive');
}

report.end();
