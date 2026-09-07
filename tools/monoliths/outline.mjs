import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { MONOLITHS, PLATFORM } from '../../src/world/layout.js';
import { POSES } from '../../src/core/poses.js';
import { poseNote, resolvePose } from './lib/pose.mjs';

// WHERE THE BLOCKS END, AND WHAT THAT IS MEASURED AGAINST.
//
// THE REFERENCE IS THE TARGET NOW, AND THE OLD ONE IS DEAD ON PURPOSE. This
// tool used to project the boxes of src/world/layout.js and ask how far a
// render's outline sat from them. That question had an answer while a block was
// a box: the box WAS the shape. It stops having one the moment the heads are
// built as the targets draw them -- stepped, two to four levels dropping up to
// six courses over part of the width -- because then the render is SUPPOSED to
// disagree with the box, by as much as 0.35 m on 04, and a guard that called
// that a defect would be defending the plan against the picture.
//
// So the reference is the silhouette the target itself draws, reduced to the
// world and written down: assets-src/monoliths/silhouette-target.json. The
// comparison with the boxes survives in the print as a column, because it is
// still the fastest way to see that a block has been MOVED rather than reshaped
// -- but it is no longer what passes or fails.
//
// AND THE RESIDUAL IS CARRIED IN METRES, NOT IN PIXELS. The target was framed
// by one camera and a render is made at another: after E-V8f the two vox poses
// moved by 66 to 74 px of horizon, and a tool that compared pixel columns
// across two framings would have reported that as stone moving. An offset
// divided by the pixels per metre at the corner that made it is a fact about
// the wall, and it is the same fact from either seat.
//
//   node tools/monoliths/outline.mjs --measure <day-target.png>   write the reference
//   node tools/monoliths/outline.mjs <render.png> [pose]          judge a render
//
// The target is the committente's own material and is never carried into this
// repository, so --measure names it by path; what IS carried is the measurement
// taken from it, which is ours.

const DEG = Math.PI / 180;
const REFERENCE = new URL('../../assets-src/monoliths/silhouette-target.json', import.meta.url);
const RECIPE = JSON.parse(readFileSync(new URL(
  '../../assets-src/materia/ricetta.json', import.meta.url), 'utf8'));

// How far either side of the projected edge the reader looks, and the step in
// luminance that counts as an outline.
//
// THE PAIR IS FITTED AGAINST THE FIT AND NOT CHOSEN. An outermost-step reader
// with a wide window walks out into the cloud and the grass and finds a step
// there: at 26 px it reported every one of the twelve edges standing 13 to 26
// px OUTSIDE its box and 21.8 px rms, which is a picture of the background and
// not of the stone. Swept against the residual the recipe's own fit published
// -- 7.8 px rms, 4.5 median over 92 points -- this pair lands at 7.2 and 7.2
// over 94, and it is the widest window that does. Widening it further buys
// reach for a block that has moved and pays for it in background.
const SEARCH = 10;
const STEP = 12;
// Rows across a block's own projected height. Eight of them on each of two
// sides of six shapes is the ninety-six points the camera was fitted on.
const ROWS = [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85];

// ------------------------------------------------------------------ geometry

/**
 * The projection of one camera, in the convention of tools/grade/lib/framing.mjs
 * makeRay() inverted: pitch about X, then yaw about Y.
 */
function projector(cam, frame) {
  const tanV = Math.tan(cam.fov * DEG / 2);
  const tanH = tanV * (frame.width / frame.height);
  const cp = Math.cos(cam.pitch * DEG);
  const sp = Math.sin(cam.pitch * DEG);
  const cy = Math.cos(cam.yaw * DEG);
  const sy = Math.sin(cam.yaw * DEG);

  const project = (wx, wy, wz) => {
    const dx = wx - cam.position.x;
    const dy = wy - cam.position.y;
    const dz = wz - cam.position.z;
    const x = dx * cy - dz * sy;
    const z1 = dx * sy + dz * cy;
    const y = dy * cp + z1 * sp;
    const z = -dy * sp + z1 * cp;
    if (z > -0.01) return null;
    return {
      px: ((x / -z / tanH) * 0.5 + 0.5) * frame.width - 0.5,
      py: (0.5 - (y / -z / tanV) * 0.5) * frame.height - 0.5,
    };
  };

  /**
   * Pixels per metre ACROSS the line of sight at a world point.
   *
   * Across and not along: the silhouette moves sideways, so the only rate that
   * turns an offset in columns into an offset in stone is the one measured
   * along the horizontal direction perpendicular to the view.
   */
  const acrossRate = (wx, wy, wz) => {
    const vx = wx - cam.position.x;
    const vz = wz - cam.position.z;
    const len = Math.hypot(vx, vz) || 1;
    const px = -vz / len;
    const pz = vx / len;
    const h = 0.01;
    const a = project(wx, wy, wz);
    const b = project(wx + px * h, wy, wz + pz * h);
    if (!a || !b) return null;
    return Math.hypot(b.px - a.px, b.py - a.py) / h;
  };

  return { project, acrossRate };
}

/** The four upright corner lines of a box, as world x/z pairs. */
function uprights(box) {
  const c = Math.cos(box.rotationY * DEG);
  const s = Math.sin(box.rotationY * DEG);
  const out = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const lx = sx * box.w / 2;
      const lz = sz * box.d / 2;
      out.push({ x: box.x + lx * c + lz * s, z: box.z - lx * s + lz * c });
    }
  }
  return out;
}

function boxes() {
  const list = MONOLITHS.filter((m) => m.id !== '06').map((m) => ({
    id: m.id, x: m.position.x, z: m.position.z, rotationY: m.rotationY,
    w: m.size[0], h: m.size[1], d: m.size[2], y0: m.baseY,
  }));
  list.push({
    id: 'platform', x: PLATFORM.x, z: PLATFORM.z, rotationY: PLATFORM.rotationY,
    w: PLATFORM.width, h: PLATFORM.height, d: PLATFORM.depth, y0: 0,
  });
  return list;
}

// -------------------------------------------------------------------- reading

async function read(path, frame) {
  const { data, info } = await sharp(path).removeAlpha()
    .resize(frame.width, frame.height, { fit: 'fill' }).raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

const luma = (img, x, y) => {
  const o = (y * img.width + x) * 3;
  return 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2];
};

/**
 * The OUTERMOST column near `expected` where the frame steps.
 *
 * Outermost and not strongest, and the difference is a measurement rather than
 * a preference: a lit block has a hard step down its own arris where the flank
 * meets the engraved face, and that step is stronger than the one at the
 * outline. Read for the strongest, giving the stone its material looks like
 * moving it seven pixels.
 */
function findOutline(img, expected, row, side) {
  const centre = Math.round(expected);
  const from = side === 'left' ? centre - SEARCH : centre + SEARCH;
  const to = side === 'left' ? centre + SEARCH : centre - SEARCH;
  const direction = side === 'left' ? 1 : -1;
  for (let x = from; x !== to + direction; x += direction) {
    if (x < 2 || x >= img.width - 2 || row < 2 || row >= img.height - 2) continue;
    if (Math.abs(luma(img, x + 1, row) - luma(img, x - 1, row)) >= STEP) return x;
  }
  return null;
}

/**
 * Every silhouette point of one image, reduced to metres of stone.
 *
 * The offset is (where the picture puts the edge) minus (where the plan puts
 * it), signed OUTWARD, divided by the pixels per metre at the upright corner
 * that made that edge. A positive number is stone standing wider than the box.
 */
async function reduce(path, cam, frame) {
  const { project, acrossRate } = projector(cam, frame);
  const img = await read(path, frame);
  const points = [];
  for (const box of boxes()) {
    const posts = uprights(box).map((p) => ({
      ...p,
      foot: project(p.x, box.y0, p.z),
      head: project(p.x, box.y0 + box.h, p.z),
    })).filter((p) => p.foot && p.head);
    if (posts.length < 4) continue;
    const top = Math.min(...posts.map((p) => p.head.py));
    const bottom = Math.max(...posts.map((p) => p.foot.py));
    for (const fraction of ROWS) {
      const row = Math.round(top + (bottom - top) * fraction);
      // Where each upright crosses this row, and which of them is the extreme.
      const crossings = posts.map((p) => {
        const t = (row - p.head.py) / (p.foot.py - p.head.py);
        const y = box.y0 + box.h * (1 - Math.max(0, Math.min(1, t)));
        const at = project(p.x, y, p.z);
        return at ? { px: at.px, x: p.x, y, z: p.z } : null;
      }).filter(Boolean);
      if (crossings.length < 2) continue;
      for (const side of ['left', 'right']) {
        const post = side === 'left'
          ? crossings.reduce((a, b) => (b.px < a.px ? b : a))
          : crossings.reduce((a, b) => (b.px > a.px ? b : a));
        if (post.px < SEARCH + 3 || post.px > frame.width - SEARCH - 3) continue;
        const found = findOutline(img, post.px, row, side);
        if (found === null) continue;
        const rate = acrossRate(post.x, post.y, post.z);
        if (!rate) continue;
        const outward = side === 'left' ? post.px - found : found - post.px;
        points.push({
          id: box.id, side, fraction, row,
          plan: post.px, found, offsetPx: outward, offset: outward / rate, rate,
        });
      }
    }
  }
  return points;
}

// ------------------------------------------------------------------ statistics

const mean = (v) => v.reduce((a, x) => a + x, 0) / v.length;
const sd = (v) => {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1));
};
const key = (p) => `${p.id}-${p.side}`;

function byEdge(points) {
  const map = new Map();
  for (const p of points) {
    if (!map.has(key(p))) map.set(key(p), []);
    map.get(key(p)).push(p);
  }
  return map;
}

// ---------------------------------------------------------------- the two modes

const argv = process.argv.slice(2);
const measuring = argv[0] === '--measure';
const out = (text = '') => process.stdout.write(`${text}\n`);

if (measuring) {
  const path = argv[1];
  if (!path) {
    out('  --measure needs the path of the day target. It is not in this');
    out('  repository and never will be: it is the committente\'s own picture.');
    process.exit(2);
  }
  const cam = RECIPE.measuredBy.camera;
  const frame = RECIPE.measuredBy.frame;
  const { project, acrossRate } = projector(cam, frame);

  out('SILHOUETTE -- measuring the reference off the day target\n');

  // FORWARD: the projection against the only published number that can catch a
  // sign error in it. The recipe states what a metre of +X and of +Z read at
  // rocce-est, and a mirrored camera fails this while still looking plausible.
  const box = RECIPE.windows['rocce-est'].box;
  const centre = (() => {
    const tanV = Math.tan(cam.fov * DEG / 2);
    const tanH = tanV * (frame.width / frame.height);
    const px = box.left + box.width / 2;
    const py = box.top + box.height / 2;
    const ndcX = (px + 0.5) / frame.width * 2 - 1;
    const ndcY = 1 - (py + 0.5) / frame.height * 2;
    const x = ndcX * tanH;
    const y = ndcY * tanV;
    const z = -1;
    const cp = Math.cos(cam.pitch * DEG);
    const sp = Math.sin(cam.pitch * DEG);
    const cy = Math.cos(cam.yaw * DEG);
    const sy = Math.sin(cam.yaw * DEG);
    const y1 = y * cp - z * sp;
    const z1 = y * sp + z * cp;
    const x2 = x * cy + z1 * sy;
    const z2 = -x * sy + z1 * cy;
    const t = -cam.position.y / y1;
    return { x: cam.position.x + x2 * t, z: cam.position.z + z2 * t };
  })();
  const rate = (dir) => {
    const a = project(centre.x, 0, centre.z);
    const b = project(centre.x + dir[0] * 0.01, 0, centre.z + dir[2] * 0.01);
    return [(b.px - a.px) / 0.01, (b.py - a.py) / 0.01];
  };
  const gx = rate([1, 0, 0]);
  const gz = rate([0, 0, 1]);
  const want = { x: [117.6, 1.6], z: [63.7, 41.3] };
  const off = Math.max(
    Math.abs(gx[0] - want.x[0]), Math.abs(gx[1] - want.x[1]),
    Math.abs(gz[0] - want.z[0]), Math.abs(gz[1] - want.z[1]));
  out(`  forward   +X reads ${gx.map((v) => v.toFixed(1)).join(', ')} against the recipe's `
    + `${want.x.join(', ')}`);
  out(`            +Z reads ${gz.map((v) => v.toFixed(1)).join(', ')} against the recipe's `
    + `${want.z.join(', ')}`);
  out(`            worst disagreement ${off.toFixed(2)} px/m`);
  if (off > 8) {
    out('\n  the projection does not reproduce the recipe: nothing else here is worth reading.');
    process.exit(1);
  }

  const points = await reduce(path, cam, frame, acrossRate);
  const edges = byEdge(points);

  // BACKWARD: the fit's own residual. If reading the target this way lands near
  // what the fit reported, this is reading the silhouette the fit was made on.
  const px = points.map((p) => p.offsetPx);
  const rms = Math.sqrt(mean(px.map((v) => v * v)));
  const median = [...px].map(Math.abs).sort((a, b) => a - b)[Math.floor(px.length / 2)];
  out(`\n  backward  ${points.length} points, ${rms.toFixed(1)} px rms, `
    + `${median.toFixed(1)} px median against the plan`);
  out(`            the recipe's own fit reports ${cam.residual}`);

  // THE TOLERANCE IS DERIVED HERE AND NOWHERE ELSE. An edge read at eight rows
  // gives eight answers, and their spread is how far the reference agrees with
  // itself. Three times the pooled spread is the bar, by the same rule the
  // campaign derives every other one -- and a bar tighter than that would be a
  // gate on the reading rather than on the stone.
  const spreads = [...edges.values()].filter((e) => e.length >= 3).map((e) => sd(e.map((p) => p.offset)));
  const pooled = Math.sqrt(mean(spreads.map((v) => v * v)));
  const tolerance = 3 * pooled;

  out(`\n  ${'edge'.padEnd(14)}${'rows'.padStart(5)}${'plan px'.padStart(10)}`
    + `${'target px'.padStart(11)}${'offset px'.padStart(11)}${'offset m'.padStart(10)}${'spread m'.padStart(10)}`);
  const reference = {};
  for (const [name, edge] of [...edges].sort()) {
    const offsets = edge.map((p) => p.offset);
    reference[name] = {
      offset: Number(mean(offsets).toFixed(4)),
      spread: Number(sd(offsets).toFixed(4)),
      rows: edge.length,
    };
    out(`  ${name.padEnd(14)}${String(edge.length).padStart(5)}`
      + `${mean(edge.map((p) => p.plan)).toFixed(1).padStart(10)}`
      + `${mean(edge.map((p) => p.found)).toFixed(1).padStart(11)}`
      + `${mean(edge.map((p) => p.offsetPx)).toFixed(1).padStart(11)}`
      + `${mean(offsets).toFixed(3).padStart(10)}${sd(offsets).toFixed(3).padStart(10)}`);
  }

  out(`\n  pooled spread of the reference against itself ${pooled.toFixed(3)} m`);
  out(`  TOLERANCE = 3x that = ${tolerance.toFixed(3)} m`);

  writeFileSync(REFERENCE, `${JSON.stringify({
    why: [
      'WHERE THE TWO TARGETS PUT THE EDGES OF THE STONE, IN METRES.',
      '',
      'Measured off the day target through the camera the recipe fitted on it,',
      'and written down because the target itself is never carried into this',
      'repository. offset is how far the picture stands outside the box',
      'src/world/layout.js declares, signed outward, at the upright corner that',
      'made that edge; spread is how far the eight rows of one edge disagree',
      'among themselves, which is what the tolerance is derived from.',
      '',
      'THIS REPLACES THE BOXES AS THE REFERENCE. A head built as the targets',
      'draw it steps down by up to six courses over part of its width, so a',
      'render is MEANT to disagree with its box; what it may not do is disagree',
      'with the picture. Remeasure with --measure if the camera or the plan',
      'moves, never by hand.',
    ],
    measuredFrom: path.split(/[\\/]/).at(-1),
    camera: 'assets-src/materia/ricetta.json, measuredBy.camera',
    reader: `outermost luminance step of ${STEP} within ${SEARCH} px, ${ROWS.length} rows a side`,
    points: points.length,
    pooledSpread: Number(pooled.toFixed(4)),
    tolerance: Number(tolerance.toFixed(4)),
    edges: reference,
  }, null, 2)}\n`);
  out(`\n  written to assets-src/monoliths/silhouette-target.json`);
  process.exit(0);
}

// ----------------------------------------------------------- judging a render

const path = argv[0];
if (!path) {
  out('  node tools/monoliths/outline.mjs --measure <day-target.png>');
  out('  node tools/monoliths/outline.mjs <render.png> [pose]');
  process.exit(2);
}

let reference = null;
try {
  reference = JSON.parse(readFileSync(REFERENCE, 'utf8'));
} catch {
  out('  no reference yet: run --measure against the day target first.');
  process.exit(2);
}

const poseName = argv[1] || 'vox-giorno';
const named = POSES[poseName];
if (!named) {
  out(`  no pose named ${poseName}. Known: ${Object.keys(POSES).join(', ')}`);
  process.exit(2);
}
// THE SENTINEL, RESOLVED THE WAY THE PAGE RESOLVES IT (E-V8i). This tool used
// to hand a pose object straight to the projector, which put the eye at
// EYE_HEIGHT itself whenever a pose wrote the sentinel -- 1.70 against the
// 1.5158 the walker actually stands the eye at, at `target`. The default pose
// here carries an absolute y and was never affected, which is why it survived:
// the poses that were wrong are the ones nobody defaulted to.
const pose = resolvePose(named);
const frame = RECIPE.measuredBy.frame;
const points = await reduce(path, pose, frame);
const edges = byEdge(points);

out(`SILHOUETTE -- ${path} at pose ${poseName}\n`);
out(`  camera     ${pose.position.x.toFixed(3)}, ${pose.position.y.toFixed(4)}, `
  + `${pose.position.z.toFixed(3)}   ${poseNote(named)}`);
out(`  reference  assets-src/monoliths/silhouette-target.json, `
  + `${reference.points} points off ${reference.measuredFrom}`);
out(`  tolerance  ${reference.tolerance.toFixed(3)} m, `
  + `3x the reference's own spread of ${reference.pooledSpread.toFixed(3)} m\n`);

out(`  ${'edge'.padEnd(14)}${'rows'.padStart(6)}${'render m'.padStart(11)}`
  + `${'target m'.padStart(10)}${'apart m'.padStart(10)}${'vs box m'.padStart(10)}   verdict`);
let worst = 0;
let failed = 0;
let lost = 0;
for (const [name, edge] of [...edges].sort()) {
  const want = reference.edges[name];
  const got = mean(edge.map((p) => p.offset));
  if (!want) {
    out(`  ${name.padEnd(14)}${`${edge.length}/${ROWS.length}`.padStart(6)}${got.toFixed(3).padStart(11)}`
      + `${'--'.padStart(10)}${'--'.padStart(10)}${got.toFixed(3).padStart(10)}   not in the reference`);
    continue;
  }
  const apart = Math.abs(got - want.offset);
  worst = Math.max(worst, apart);
  // A ROW THE READER COULD NOT FIND IS NOT A ROW THAT AGREES. The window is
  // ten pixels, so an edge that has moved further than that reports nothing at
  // all -- and a mean taken over the rows that survived would quietly average
  // the failure away. Losing more than half an edge fails on its own.
  const kept = edge.length / ROWS.length;
  const ok = apart <= reference.tolerance && kept > 0.5;
  if (!ok) failed++;
  if (kept < 1) lost += ROWS.length - edge.length;
  out(`  ${name.padEnd(14)}${`${edge.length}/${ROWS.length}`.padStart(6)}${got.toFixed(3).padStart(11)}`
    + `${want.offset.toFixed(3).padStart(10)}${apart.toFixed(3).padStart(10)}`
    + `${got.toFixed(3).padStart(10)}   ${ok ? 'ok' : (kept > 0.5 ? 'OUT' : 'LOST')}`);
}

out(`\n  worst edge ${worst.toFixed(3)} m against a tolerance of ${reference.tolerance.toFixed(3)} m`);
out(`  the "vs box" column is the old question and no longer the gate: a stepped`);
out('  head is meant to stand inside its box, and only a MOVED block shows there');
out('  as a whole edge shifting together.');
process.exit(failed === 0 ? 0 : 1);
