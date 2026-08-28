import { join } from 'node:path';
import sharp from 'sharp';
import { MONOLITHS, PLATFORM } from '../../src/world/layout.js';
import { worldToUv } from '../../src/world/terrain-field.js';
import { readSun, REPO_ROOT } from './sun.mjs';

// WHICH SUN A GROUND BAKE WAS LIT BY, read back off the light map.
//
//   node tools/lighting/shadow-bearing.mjs <terrain-light-bake.png> [more...]
//   node tools/lighting/shadow-bearing.mjs --against 52,61 <map.png>
//
// A bake cannot argue about where its shadows fell. A block five metres tall
// throws its shadow away from the sun, as far as its height over the tangent of
// the sun's elevation, and the light map carries that darkening whether or not
// anybody looked. So the map is asked which sun it was lit by, and the answer
// is compared with the seat every other consumer reads (tools/lighting/sun.mjs).
//
// HOW IT ASKS. Not by finding an edge — these bakes use a forty degree sun disc
// and there is no edge to find, which is the whole reason a fifty-two degree
// error survived a campaign. Instead the shadow a CANDIDATE sun predicts is laid
// over the map as a strip behind each block, and the light under it is divided
// by the mean over the whole ring at the same radii, so a block standing in a
// generally darker corner of the meadow cannot out-vote the others. A candidate
// that scores below one is a candidate the map's darkness agrees with.
//
// WHAT IT CANNOT DO, said out loud: it reads the sum of everything that lights
// the meadow. The sky in these bakes is an environment map with its own bright
// side, so a map lit by a lamp pointing one way and a sky leaning another gives
// a shallow, split reading rather than a wrong one — which is exactly what the
// two-sun bake gives, and is itself the finding.

const DEG = Math.PI / 180;

async function readMap(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Light at a world position, as the map stores it: the mean of the three channels. */
function lightAt(map, x, z) {
  const { u, v } = worldToUv(x, z);
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  // Nearest texel. The map is a smooth field at this scale and every reading
  // below averages hundreds of samples, so interpolating would only cost time.
  const px = Math.min(map.width - 1, Math.max(0, Math.round(u * (map.width - 1))));
  const py = Math.min(map.height - 1, Math.max(0, Math.round(v * (map.height - 1))));
  const o = (py * map.width + px) * map.channels;
  return (map.data[o] + map.data[o + 1] + map.data[o + 2]) / 3;
}

// What is not meadow. A sample that lands on a block, on the platform or on the
// stair is not ground the shadow could have fallen on, and the map there is
// either black or a different surface: either way it would be read as darkness
// and credited to whichever candidate happened to point at it.
const KEEP_OUT = [
  ...MONOLITHS.map((m) => ({
    x: m.position.x, z: m.position.z, radius: Math.hypot(m.size[0], m.size[2]) / 2 + 0.8,
  })),
  { x: PLATFORM.x, z: PLATFORM.z, radius: Math.hypot(PLATFORM.width, PLATFORM.depth) / 2 + 1.0 },
];

const isMeadow = (x, z, self) => !KEEP_OUT.some((k, i) => i !== self
  && Math.hypot(x - k.x, z - k.z) < k.radius);

/** Mean light under the shadow one candidate sun predicts behind one block. */
function stripMean(map, block, index, azimuth, elevation) {
  const { x, z } = block.position;
  const [width, height, depth] = block.size;
  const reach = (height + (block.baseY || 0)) / Math.tan(elevation * DEG);
  // Start outside the block's own footprint: inside it the map carries the
  // stone, not the shadow the stone throws.
  const inner = Math.hypot(width, depth) / 2 + 0.4;
  if (reach <= inner + 0.5) return null;
  // Away from the sun, in runtime axes: north is -Z, bearing turns east.
  const away = (azimuth + 180) * DEG;
  const ax = Math.sin(away);
  const az = -Math.cos(away);
  const half = Math.min(width, depth) / 2;

  let sum = 0;
  let count = 0;
  for (let t = inner; t <= reach; t += 0.2) {
    for (let s = -half; s <= half; s += 0.2) {
      const px = x + ax * t - az * s;
      const pz = z + az * t + ax * s;
      if (!isMeadow(px, pz, index)) continue;
      const value = lightAt(map, px, pz);
      if (value !== null) { sum += value; count++; }
    }
  }
  // Too little meadow left to say anything: a block hemmed in by its neighbours
  // reports nothing rather than reporting the neighbours.
  return count >= 40 ? { mean: sum / count, count } : null;
}

/** The same radii all the way round: what the strip is compared against. */
function ringMean(map, block, index, elevation) {
  const { x, z } = block.position;
  const [width, height, depth] = block.size;
  const reach = (height + (block.baseY || 0)) / Math.tan(elevation * DEG);
  const inner = Math.hypot(width, depth) / 2 + 0.4;
  let sum = 0;
  let count = 0;
  for (let b = 0; b < 360; b += 1) {
    const bx = Math.sin(b * DEG);
    const bz = -Math.cos(b * DEG);
    for (let t = inner; t <= reach; t += 0.2) {
      const px = x + bx * t;
      const pz = z + bz * t;
      if (!isMeadow(px, pz, index)) continue;
      const value = lightAt(map, px, pz);
      if (value !== null) { sum += value; count++; }
    }
  }
  return count ? sum / count : null;
}

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/**
 * How dark the meadow is under the shadows a candidate sun predicts, per block.
 *
 * The aggregate is a MEDIAN, not a mean, and the per block numbers are printed:
 * block 06 stands nineteen metres south of the spawn where the meadow is a
 * third darker than it is round the other five, and a mean lets one such block
 * decide the reading. The lesson is S1's — when a number and the eye disagree,
 * take the number apart before chasing it.
 */
function score(map, azimuth, elevation, rings) {
  const per = [];
  MONOLITHS.forEach((block, i) => {
    const strip = stripMean(map, block, i, azimuth, elevation);
    const ring = rings[i];
    if (!strip || !ring) { per.push({ id: block.id, value: null }); return; }
    per.push({ id: block.id, value: strip.mean / ring, samples: strip.count });
  });
  const values = per.filter((p) => p.value !== null).map((p) => p.value);
  return { per, value: median(values), blocks: values.length };
}

const wrap = (d) => {
  let x = d % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return x;
};

const argv = process.argv.slice(2);
const against = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--against') {
    const [el, az] = argv[++i].split(',').map(Number);
    against.push({ elevation: el, azimuth: az, name: `elevation ${el}, azimuth ${az}` });
  }
}
const paths = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--against');
if (!paths.length) {
  console.error('usage: node tools/lighting/shadow-bearing.mjs [--against el,az] <map.png> [more...]');
  process.exit(2);
}

const seat = readSun();
const candidates = [
  { elevation: seat.elevation, azimuth: seat.azimuth, name: 'THE SEAT (assets-src/sky/sky.json day.sun)' },
  ...against,
];
console.log('candidate suns:');
for (const c of candidates) {
  console.log(`  elevation ${c.elevation}, azimuth ${c.azimuth} `
    + `-> shadows towards bearing ${wrap(c.azimuth + 180).toFixed(1)}, `
    + `a 5 m block reaches ${(5 / Math.tan(c.elevation * DEG)).toFixed(2)} m  — ${c.name}`);
}

for (const path of paths) {
  const map = await readMap(join(REPO_ROOT, path));
  console.log(`\n${path}  (${map.width}x${map.height})`);

  for (const c of candidates) {
    const rings = MONOLITHS.map((b, i) => ringMean(map, b, i, c.elevation));
    const got = score(map, c.azimuth, c.elevation, rings);
    const opposite = score(map, wrap(c.azimuth + 180), c.elevation, rings);
    console.log(`\n  candidate elevation ${c.elevation}, azimuth ${c.azimuth}  — ${c.name}`);
    console.log('    block   under its shadow   the same strip turned round');
    got.per.forEach((p, i) => {
      const o = opposite.per[i];
      console.log(`      ${p.id}   ${p.value === null ? '     -' : p.value.toFixed(3).padStart(6)}`
        + `             ${o.value === null ? '     -' : o.value.toFixed(3).padStart(6)}`
        + `   (${p.samples || 0} samples)`);
    });
    // A gap under two per cent is not a reading. A forty degree sun disc at a
    // high elevation leaves a shadow shorter than the block is wide and softer
    // than the meadow's own variation, and calling that a direction is how a
    // wrong sun goes unnoticed for a campaign.
    const gap = opposite.value - got.value;
    console.log(`    MEDIAN  ${got.value.toFixed(3).padStart(6)}             `
      + `${opposite.value.toFixed(3).padStart(6)}   -> gap ${(gap * 100).toFixed(1)}%: `
      + `${gap < 0.02 ? 'NO READING, the map does not lean this way'
        : 'the map is darker exactly where this sun says it should be'}`);
  }

  // And a scan, so the reading can be seen rather than taken on trust.
  const rings = MONOLITHS.map((b, i) => ringMean(map, b, i, seat.elevation));
  const profile = [];
  for (let az = -180; az < 180; az += 3) {
    const got = score(map, az, seat.elevation, rings);
    if (got.value !== null) profile.push({ az, value: got.value });
  }
  const lo = Math.min(...profile.map((p) => p.value));
  const hi = Math.max(...profile.map((p) => p.value));
  const trough = profile.reduce((a, b) => (b.value < a.value ? b : a));
  const bars = profile.map((p) => ' .:-=+*#'[Math.min(7, Math.floor((1 - (p.value - lo) / (hi - lo)) * 8))]);
  console.log(`  scan at elevation ${seat.elevation}, azimuth -180 .. +177 in threes `
    + `(# darkest ${lo.toFixed(3)}, blank lightest ${hi.toFixed(3)}):`);
  console.log(`    ${bars.join('')}`);
  console.log(`    ${' '.repeat(30)}^ azimuth 0`);
  console.log(`  darkest at azimuth ${trough.az}, `
    + `${Math.abs(wrap(trough.az - seat.azimuth)).toFixed(1)} degrees from the seat`);
}
