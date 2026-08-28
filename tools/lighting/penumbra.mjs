import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { srgbToLinear } from '../grade/lib/color.mjs';
import { MONOLITHS, PLATFORM, STAIRS } from '../../src/world/layout.js';
import { GRID, uvToWorld, heightAt } from '../../src/world/terrain-field.js';
import { readSun, sunVector, bakeSunAngle, REPO_ROOT } from './sun.mjs';

// HOW WIDE THE EDGE OF A BAKED SHADOW IS, in texels and in centimetres.
//
// The client's words were «shadows of PESSIMA QUALITÀ and PIXELLATE, they look
// fake». Pixellate is not a figure of speech here, it is a measurement anybody
// can repeat, and this is the ruler that takes it.
//
// A shadow edge is soft because the source is not a point. A source of angular
// diameter t, seen from a receiver a distance d away from the edge that casts,
// spreads the transition over t*d MEASURED ACROSS THE BEAM. That width has to
// land on some number of texels of the light map, and the eye reads the larger
// of the two: if the physics gives four centimetres and a texel is six, the map
// stores a step, the filter smears that step over exactly one texel, and what
// arrives on screen is a staircase whose stairs are the texel grid. That is
// what "pixellate" means and it is why a wider bake, not a blurrier read, is
// the cure — a blur softens the contact of a foot with the ground by the same
// amount as the tip of a shadow eight metres long, and the eye knows.
//
// So this reports three numbers side by side at every edge it finds:
//
//   d       the distance from the receiving point to the edge that casts it,
//           marched along the sun's own ray, so it is geometry and not a guess
//   t*d     what the sun in the seat says the penumbra should be
//   10-90   what the baked map actually holds, read across the gradient
//
// and the texel size at that point, which is the number that decides whether
// the second and the third can ever agree.
//
//   node tools/lighting/penumbra.mjs                     the ground
//   node tools/lighting/penumbra.mjs monoliths rocks     the stone
//   node tools/lighting/penumbra.mjs --map <png> --density <texels/m>

const DEG = Math.PI / 180;

const FAMILIES = {
  terrain: { dir: ['assets-src', 'terrain'], stem: 'terrain-light', ground: true },
  stairs: { dir: ['assets-src', 'terrain'], stem: 'stairs-light', manifest: null, density: null },
  monoliths: { dir: ['assets-src', 'monoliths'], stem: 'monolith-light', manifest: ['assets-src', 'monoliths', 'monoliths.json'] },
  rocks: { dir: ['assets-src', 'rocks'], stem: 'rock-light', manifest: ['assets-src', 'rocks', 'rocks-bake.json'] },
};

/** The boxes that cast, with the distance to them, not merely whether. */
function casters() {
  const list = MONOLITHS.map((m) => ({
    x: m.position.x, z: m.position.z,
    y0: m.baseY || 0, y1: (m.baseY || 0) + m.size[1],
    hw: m.size[0] / 2, hd: m.size[2] / 2, rotationY: m.rotationY,
  }));
  list.push({
    x: PLATFORM.x, z: PLATFORM.z, y0: 0, y1: PLATFORM.height,
    hw: PLATFORM.width / 2, hd: PLATFORM.depth / 2, rotationY: PLATFORM.rotationY,
  });
  for (let k = 0; k < STAIRS.steps; k++) {
    list.push({
      x: STAIRS.x, z: STAIRS.z + STAIRS.tread * (k + 0.5), y0: 0,
      y1: PLATFORM.height * (STAIRS.steps - k) / STAIRS.steps,
      hw: STAIRS.width / 2, hd: STAIRS.tread / 2, rotationY: 0,
    });
  }
  return list.map((b) => {
    const a = -b.rotationY * DEG;
    return { ...b, cos: Math.cos(a), sin: Math.sin(a) };
  });
}

/**
 * How far along the sun's ray the first body stands, or Infinity.
 * The point of returning the DISTANCE and not a yes/no: at a shadow edge the
 * ray grazes the very edge that casts it, so this is the lever arm of the
 * penumbra, measured rather than attributed to a nominal height.
 */
export function occluderDistance(L, boxes, x, y, z) {
  let best = Infinity;
  for (const b of boxes) {
    const dx = x - b.x;
    const dz = z - b.z;
    const lx = dx * b.cos + dz * b.sin;
    const lz = -dx * b.sin + dz * b.cos;
    const dirX = L[0] * b.cos + L[2] * b.sin;
    const dirZ = -L[0] * b.sin + L[2] * b.cos;
    let t0 = 0;
    let t1 = 1e9;
    const slab = (o, d, lo, hi) => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let a = (lo - o) / d;
      let c = (hi - o) / d;
      if (a > c) { const s = a; a = c; c = s; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
      return t1 >= t0;
    };
    if (!slab(lx, dirX, -b.hw, b.hw)) continue;
    if (!slab(lz, dirZ, -b.hd, b.hd)) continue;
    if (!slab(y, L[1], b.y0, b.y1)) continue;
    if (t1 > 0 && t0 < best) best = Math.max(t0, 0);
  }
  return best;
}

/** Metres per texel of the ground atlas along u, at grid coordinate t in -1..1. */
function groundTexelMetres(t, size) {
  // r = |t|^bend * half, so dr/dt = bend * |t|^(bend-1) * half, and one texel
  // is two grid units over the side.
  const a = Math.max(Math.abs(t), 1 / size);
  return GRID.bend * (a ** (GRID.bend - 1)) * GRID.half * (2 / size);
}

/** The 10-90 width of the overlap of two discs, as a fraction of the diameter. */
export function discTenNinety(steps = 20001) {
  // A point on a shadow edge sees the source disc cut by a straight silhouette.
  // The visible fraction as the cut sweeps across is the circular segment area,
  // and its 10 and 90 per cent crossings are what a measured 10-90 compares to.
  const area = (s) => {
    // s in -1..1, the signed offset of the cut from the centre in radii.
    const c = Math.min(Math.max(s, -1), 1);
    return (Math.acos(c) - c * Math.sqrt(1 - c * c)) / Math.PI;
  };
  // area() falls from one to nought as the cut sweeps, so the 90 per cent
  // crossing comes FIRST and the 10 per cent last.
  let s90 = null; let s10 = null;
  for (let i = 0; i <= steps; i++) {
    const s = -1 + (2 * i) / steps;
    const f = area(s);
    if (s90 === null && f < 0.9) s90 = s;
    if (f >= 0.1) s10 = s;
  }
  return (s10 - s90) / 2; // radii to diameters
}

function sample(lin, W, H, u, v) {
  // Bilinear, in linear light, on texel centres.
  const x = Math.min(Math.max(u * W - 0.5, 0), W - 1.001);
  const y = Math.min(Math.max(v * H - 0.5, 0), H - 1.001);
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const fx = x - x0; const fy = y - y0;
  const at = (a, b) => lin[b * W + a];
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy)
    + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

/**
 * The 10-90 crossing of a profile, in texels, walked along a direction.
 * Returns null when the window does not hold a clean single edge.
 */
function crossing(lin, W, H, px, py, dx, dy, reach = 12, step = 0.25) {
  const values = [];
  for (let s = -reach; s <= reach + 1e-9; s += step) {
    values.push(sample(lin, W, H, (px + 0.5 + dx * s) / W, (py + 0.5 + dy * s) / H));
  }
  const first = values[0];
  const last = values[values.length - 1];
  const lo = Math.min(first, last);
  const hi = Math.max(first, last);
  if (hi - lo < 0.06) return null;
  const rising = last > first;
  const at = (frac) => {
    const target = lo + (hi - lo) * frac;
    for (let i = 1; i < values.length; i++) {
      const a = values[i - 1]; const b = values[i];
      if ((rising && a < target && b >= target) || (!rising && a > target && b <= target)) {
        const f = (target - a) / (b - a);
        return -reach + (i - 1 + f) * step;
      }
    }
    return null;
  };
  const p10 = at(rising ? 0.1 : 0.9);
  const p90 = at(rising ? 0.9 : 0.1);
  if (p10 === null || p90 === null) return null;
  return { texels: Math.abs(p90 - p10), contrast: hi - lo, lo, hi };
}

function quantiles(list, qs) {
  const s = [...list].sort((a, b) => a - b);
  return qs.map((q) => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]);
}

async function readLinear(path) {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lin = new Float32Array(info.width * info.height);
  for (let i = 0; i < lin.length; i++) lin[i] = srgbToLinear(data[i * 3] / 255);
  return { lin, W: info.width, H: info.height };
}

/**
 * The two terms weighed and summed exactly as bakedLight() does at draw time.
 *
 * The sun term alone says how hard the bake is; this says what the eye gets,
 * because the sky term does not go dark where the sun does and its share is a
 * floor under every shadow. Both are worth having: one is the cause, the other
 * is the complaint.
 */
async function readCombined(root, base) {
  const path = `${base}.png`;
  if (!existsSync(path)) throw new Error(`missing ${path}: run pack-light.mjs first`);
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const light = JSON.parse(readFileSync(join(root, 'assets-src', 'sky', 'scene-light.json'), 'utf8')).day;
  const sun = light.sunBeam.map((c) => c * light.sunStrength);
  const sky = light.skyBalance.map((c) => c * light.skyStrength);
  // Luminance of the sum, which is what an edge is read on.
  const wl = [0.2126, 0.7152, 0.0722];
  const ks = wl.reduce((a, w, k) => a + w * sun[k], 0);
  const kk = wl.reduce((a, w, k) => a + w * sky[k], 0);
  const lin = new Float32Array(info.width * info.height);
  for (let i = 0; i < lin.length; i++) {
    lin[i] = srgbToLinear(data[i * 3] / 255) * ks + srgbToLinear(data[i * 3 + 1] / 255) * kk;
  }
  // Back to a nought-to-one scale so the contrast gates mean the same thing.
  let peak = 1e-6;
  for (let i = 0; i < lin.length; i++) if (lin[i] > peak) peak = lin[i];
  for (let i = 0; i < lin.length; i++) lin[i] /= peak;
  return { lin, W: info.width, H: info.height };
}

async function ground(root, stem, out, combined, against) {
  const base = join(root, 'assets-src', 'terrain', stem);
  const { lin, W, H } = combined
    ? await readCombined(root, base)
    : await readLinear(`${base}-sun-bake.png`);
  // THE SAME TEXELS IN BOTH MAPS, and it has to be said why this exists. A
  // median taken over "every edge this map holds" is a median over a
  // POPULATION, and softening the map changes which texels pass the gradient
  // gate — so the two medians answer two different questions and their ratio is
  // not a change. --against finds the edges ONCE, on the map named, and reads
  // both maps at those places along those directions.
  const other = against
    ? (combined ? await readCombined(root, against) : await readLinear(`${against}-sun-bake.png`))
    : null;
  if (other && (other.W !== W || other.H !== H)) throw new Error('the two maps are different sizes');
  const seat = readSun(root);
  const L = sunVector(seat.elevation, seat.azimuth);
  const boxes = casters();
  const theta = bakeSunAngle(root);
  const share = discTenNinety();

  const rows = [];
  for (let py = 2; py < H - 2; py++) {
    for (let px = 2; px < W - 2; px++) {
      const i = py * W + px;
      const gx = lin[i + 1] - lin[i - 1];
      const gy = lin[i + W] - lin[i - W];
      const g = Math.hypot(gx, gy);
      if (g < 0.06) continue;
      const dx = gx / g; const dy = gy / g;
      const cross = crossing(lin, W, H, px, py, dx, dy);
      if (!cross || cross.contrast < 0.15) continue;

      const u = (px + 0.5) / W; const v = (py + 0.5) / H;
      const { x, z } = uvToWorld(u, v);
      if (Math.hypot(x - GRID.centreX, z - GRID.centreZ) > 24) continue;
      const y = heightAt(x, z);
      // Slide half a texel to the lit side and march: at the edge itself the
      // ray grazes and the hit is numerically undecided.
      const lit = cross.hi === cross.lo ? 0 : (lin[i] < (cross.lo + cross.hi) / 2 ? 1 : -1);
      const su = (px + 0.5 + dx * 1.5 * lit * (cross.hi > cross.lo ? 1 : -1)) / W;
      const sv = (py + 0.5 + dy * 1.5 * lit * (cross.hi > cross.lo ? 1 : -1)) / H;
      const near = uvToWorld(su, sv);
      const d = Math.min(
        occluderDistance(L, boxes, x, y + 0.03, z),
        occluderDistance(L, boxes, near.x, heightAt(near.x, near.z) + 0.03, near.z),
      );

      // The texel is a rectangle on a bent grid: its size along the gradient.
      const tu = u * 2 - 1; const tv = v * 2 - 1;
      const mu = groundTexelMetres(tu, W);
      const mv = groundTexelMetres(tv, H);
      const metresPerTexel = Math.hypot(dx * mu, dy * mv);
      const widthM = cross.texels * metresPerTexel;

      // Across the beam: the gradient runs on the ground, the penumbra is
      // measured perpendicular to the ray that draws it.
      const ex = dx * mu / metresPerTexel;
      const ez = dy * mv / metresPerTexel;
      const along = ex * L[0] + ez * L[2];
      const foreshorten = Math.sqrt(Math.max(1e-6, 1 - along * along));

      const twin = other
        ? crossing(other.lin, W, H, px, py, dx, dy) : null;
      rows.push({
        px, py, x, z, d, texels: cross.texels, widthM,
        perpM: widthM * foreshorten, metresPerTexel,
        twinM: twin ? twin.texels * metresPerTexel * foreshorten : NaN,
        twinTexels: twin ? twin.texels : NaN,
        predictM: Number.isFinite(d) ? theta * d * share : NaN,
      });
    }
  }
  report(out, `terrain ground, ${combined ? 'THE TWO TERMS SUMMED as the frame sums them' : 'the SUN term alone'}`, rows, theta, share, W);
  return rows;
}

async function island(root, family, out) {
  const spec = FAMILIES[family];
  const { lin, W, H } = await readLinear(join(root, ...spec.dir, `${spec.stem}-sun-bake.png`));
  const seat = readSun(root);
  const theta = bakeSunAngle(root);
  const share = discTenNinety();
  let density = spec.density;
  if (!density && spec.manifest && existsSync(join(root, ...spec.manifest))) {
    const m = JSON.parse(await import('node:fs').then((fs) => fs.promises.readFile(join(root, ...spec.manifest), 'utf8')));
    density = m.atlasDensity || m.density || null;
  }
  // THE CONTROL, and without it this measurement means nothing on a packed
  // atlas. Every face of every block is its own island, and two islands that
  // touch hold two unrelated faces: the step between them is a UV seam, not a
  // shadow, and it is exactly one texel wide because a seam always is. Counting
  // seams as shadows would say the stone is pixellated whatever the sun does.
  //
  // So the SKY term is measured with the same ruler. It carries no cast shadow
  // at all — it is how much of the dome a point can see, and the dome does not
  // go out — so every edge it holds is a seam or a crease. What is left after
  // the two are compared is what the sun put there.
  const sky = await readLinear(join(root, ...spec.dir, `${spec.stem}-sky-bake.png`));

  const scan = (src) => {
    const rows = [];
    for (let py = 2; py < H - 2; py++) {
      for (let px = 2; px < W - 2; px++) {
        const i = py * W + px;
        if (src[i] <= 0.0005) continue;
        const gx = src[i + 1] - src[i - 1];
        const gy = src[i + W] - src[i - W];
        const g = Math.hypot(gx, gy);
        if (g < 0.06) continue;
        const cross = crossing(src, W, H, px, py, gx / g, gy / g, 8);
        if (!cross || cross.contrast < 0.15) continue;
        // Both sides have to be lit surface. A profile that runs into the bleed
        // round an island has one plateau near nought and is a seam.
        if (cross.lo < 0.01) continue;
        rows.push({
          px, py, texels: cross.texels,
          metresPerTexel: density ? 1 / density : NaN,
          widthM: density ? cross.texels / density : NaN,
          d: NaN, perpM: NaN, predictM: NaN,
        });
      }
    }
    return rows;
  };

  const rows = scan(lin);
  const control = scan(sky.lin);
  report(out, `${family} atlas${density ? ` (${density.toFixed(2)} texels/m)` : ''}, the SUN term`, rows, theta, share, W);
  report(out, `${family} atlas, the SKY term — THE CONTROL: it has no cast shadow, so what it reads is seams and creases`, control, theta, share, W);
  return rows;
}

function report(out, title, rows, theta, share, size) {
  out(`\n== ${title} — ${rows.length} shadow edges found`);
  if (!rows.length) return;
  const t = quantiles(rows.map((r) => r.texels), [0.1, 0.5, 0.9]);
  out(`   10-90 edge width, in TEXELS:      p10 ${t[0].toFixed(2)}   median ${t[1].toFixed(2)}   p90 ${t[2].toFixed(2)}`);
  const cm = rows.filter((r) => Number.isFinite(r.widthM)).map((r) => r.widthM * 100);
  if (cm.length) {
    const c = quantiles(cm, [0.1, 0.5, 0.9]);
    out(`   10-90 edge width, in CM:          p10 ${c[0].toFixed(1)}   median ${c[1].toFixed(1)}   p90 ${c[2].toFixed(1)}`);
  }
  const px = quantiles(rows.filter((r) => Number.isFinite(r.metresPerTexel)).map((r) => r.metresPerTexel * 100), [0.1, 0.5, 0.9]);
  if (px.length && Number.isFinite(px[1])) {
    out(`   one texel, in CM:                 p10 ${px[0].toFixed(1)}   median ${px[1].toFixed(1)}   p90 ${px[2].toFixed(1)}`);
  }
  const withD = rows.filter((r) => Number.isFinite(r.d) && r.d > 0.05 && r.d < 40);
  if (withD.length) {
    out(`   the sun in the seat is ${(theta / DEG).toFixed(3)} deg across; a 10-90 is ${share.toFixed(3)} of that times the throw`);
    out('   throw d      edges   the seat asks   the map holds     texel    held/texel   held/asked');
    const bands = [[0, 1], [1, 2], [2, 4], [4, 8], [8, 16], [16, 40]];
    for (const [a, b] of bands) {
      const band = withD.filter((r) => r.d >= a && r.d < b);
      if (band.length < 20) continue;
      const p = quantiles(band.map((r) => r.predictM * 100), [0.5])[0];
      const m = quantiles(band.map((r) => r.perpM * 100), [0.5])[0];
      const tx = quantiles(band.map((r) => r.metresPerTexel * 100), [0.5])[0];
      const n = quantiles(band.map((r) => r.perpM / r.metresPerTexel), [0.5])[0];
      const q = quantiles(band.map((r) => r.perpM / r.predictM), [0.5])[0];
      out(`   ${String(a).padStart(3)}-${String(b).padEnd(3)} m  ${String(band.length).padStart(7)}   ${p.toFixed(2).padStart(8)} cm   ${m.toFixed(2).padStart(9)} cm   ${tx.toFixed(2).padStart(5)} cm   ${n.toFixed(2).padStart(8)}   ${q.toFixed(2).padStart(8)}`);
    }
  }
  const hard = rows.filter((r) => r.texels <= 1.5).length;
  out(`   edges resolved by ONE TEXEL OR LESS: ${hard} of ${rows.length} (${(100 * hard / rows.length).toFixed(1)}%)`);
  const twinned = rows.filter((r) => Number.isFinite(r.twinTexels));
  if (twinned.length) {
    const t2 = quantiles(twinned.map((r) => r.twinTexels), [0.1, 0.5, 0.9]);
    const hard2 = twinned.filter((r) => r.twinTexels <= 1.5).length;
    out(`   the SAME ${twinned.length} places in the other map:`);
    out(`     10-90 in TEXELS                 p10 ${t2[0].toFixed(2)}   median ${t2[1].toFixed(2)}   p90 ${t2[2].toFixed(2)}`);
    out(`     of those, one texel or less:    ${hard2} (${(100 * hard2 / twinned.length).toFixed(1)}%)`);
    const ratio = quantiles(twinned.map((r) => r.texels / r.twinTexels), [0.1, 0.5, 0.9]);
    out(`     this map over that one, per place: p10 x${ratio[0].toFixed(2)}  median x${ratio[1].toFixed(2)}  p90 x${ratio[2].toFixed(2)}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const wanted = args.filter((a) => !a.startsWith('--'));
  const out = (s) => process.stdout.write(`${s}\n`);
  const combined = args.includes('--combined');
  const flag = args.find((a) => a.startsWith('--against='));
  const against = flag ? flag.slice('--against='.length) : null;
  for (const family of wanted.length ? wanted : ['terrain']) {
    if (family === 'terrain') await ground(REPO_ROOT, 'terrain-light', out, combined, against);
    else await island(REPO_ROOT, family, out);
  }
  out('');
}

if (process.argv[1] && process.argv[1].endsWith('penumbra.mjs')) await main();
