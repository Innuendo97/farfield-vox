import { join } from 'node:path';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { srgbToLinear } from '../grade/lib/color.mjs';
import { worldToUv, heightAt } from '../../src/world/terrain-field.js';
import { castShadowTest } from './cast-shadow.mjs';
import { REPO_ROOT } from './sun.mjs';

// THE STAIRCASE, MEASURED. Not how WIDE a shadow edge is — the ruler that read
// that width has gone with the bake it was reading — but how STRAIGHT it is.
//
// This is the number the complaint was actually about. A shadow boundary in
// this world is a straight line on the ground; the atlas samples it on a square
// grid, and a reconstruction filter has to put the line back. Bilinear cannot:
// between two texel centres it is a straight ramp, so the half-light contour it
// rebuilds is pulled towards the grid, and walking ALONG the edge the contour
// zig-zags with a period of one texel and an amplitude of a fraction of one.
// That zig-zag is what "pixellate" names, and it is invisible to any measure of
// edge width, which is why widening the edge alone never fixed it.
//
// So: walk along a shadow boundary, and at each step find where the half-light
// contour crosses, in texels, measured across the edge. Subtract the straight
// line that best fits those crossings. What is left is the WOBBLE, and its
// root mean square, in texels, is the height of the stairs.
//
//   node tools/lighting/staircase.mjs
//   node tools/lighting/staircase.mjs --map assets-src/terrain/terrain-light.png

const FILTERS = ['bilinear', 'smooth', 'bicubic'];

function w0(a) { return (1 / 6) * (a * (a * (-a + 3) - 3) + 1); }
function w1(a) { return (1 / 6) * (a * a * (3 * a - 6) + 4); }
function w2(a) { return (1 / 6) * (a * (a * (-3 * a + 3) + 3) + 1); }
function w3(a) { return (1 / 6) * (a * a * a); }

/** The three reconstructions, on the same data, so they cannot differ by anything else. */
function reader(lin, W, H, kind) {
  const texel = (x, y) => lin[Math.min(Math.max(y, 0), H - 1) * W + Math.min(Math.max(x, 0), W - 1)];
  const bilinear = (u, v) => {
    const x = u * W - 0.5; const y = v * H - 0.5;
    const x0 = Math.floor(x); const y0 = Math.floor(y);
    const fx = x - x0; const fy = y - y0;
    return (texel(x0, y0) * (1 - fx) + texel(x0 + 1, y0) * fx) * (1 - fy)
      + (texel(x0, y0 + 1) * (1 - fx) + texel(x0 + 1, y0 + 1) * fx) * fy;
  };
  if (kind === 'bilinear') return bilinear;
  if (kind === 'smooth') {
    return (u, v) => {
      const x = u * W - 0.5; const y = v * H - 0.5;
      const ix = Math.floor(x); const iy = Math.floor(y);
      let fx = x - ix; let fy = y - iy;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      return bilinear((ix + fx + 0.5) / W, (iy + fy + 0.5) / H);
    };
  }
  // The four tap cubic B-spline, the same arithmetic src/world/light-filter.js
  // compiles into the ground material, written here in the language the ruler
  // is written in so the two can be held to each other.
  return (u, v) => {
    const tx = u * W + 0.5; const tyy = v * H + 0.5;
    const ix = Math.floor(tx); const iy = Math.floor(tyy);
    const fx = tx - ix; const fy = tyy - iy;
    const g0x = w0(fx) + w1(fx); const g1x = w2(fx) + w3(fx);
    const g0y = w0(fy) + w1(fy); const g1y = w2(fy) + w3(fy);
    const h0x = -1 + w1(fx) / g0x; const h1x = 1 + w3(fx) / g1x;
    const h0y = -1 + w1(fy) / g0y; const h1y = 1 + w3(fy) / g1y;
    return g0y * (g0x * bilinear((ix + h0x - 0.5) / W, (iy + h0y - 0.5) / H)
      + g1x * bilinear((ix + h1x - 0.5) / W, (iy + h0y - 0.5) / H))
      + g1y * (g0x * bilinear((ix + h0x - 0.5) / W, (iy + h1y - 0.5) / H)
        + g1x * bilinear((ix + h1x - 0.5) / W, (iy + h1y - 0.5) / H));
  };
}

async function main() {
  const flag = process.argv.find((a) => a.startsWith('--map='));
  const path = join(REPO_ROOT, flag ? flag.slice('--map='.length)
    : 'assets-src/terrain/terrain-light.png');
  const { data, info } = await sharp(path).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width; const H = info.height;
  const light = JSON.parse(readFileSync(join(REPO_ROOT, 'assets-src/sky/scene-light.json'), 'utf8')).day;
  const wl = [0.2126, 0.7152, 0.0722];
  const ks = wl.reduce((a, w, k) => a + w * light.sunBeam[k] * light.sunStrength, 0);
  const kk = wl.reduce((a, w, k) => a + w * light.skyBalance[k] * light.skyStrength, 0);
  const lin = new Float32Array(W * H);
  for (let i = 0; i < lin.length; i++) {
    lin[i] = srgbToLinear(data[i * 3] / 255) * ks + srgbToLinear(data[i * 3 + 1] / 255) * kk;
  }
  const occluded = castShadowTest({ withBuilt: true });
  const shadowed = (x, z) => occluded(x, heightAt(x, z) + 0.01, z);

  // Walk the boundary of every cast shadow, in world metres, and hold the walk
  // to the geometry rather than to the picture: the line the eye expects to see
  // is the one the sun draws, so the wobble is measured against THAT.
  const readers = Object.fromEntries(FILTERS.map((k) => [k, reader(lin, W, H, k)]));
  const stats = Object.fromEntries(FILTERS.map((k) => [k, []]));
  let walks = 0;

  const STEP = 0.05;      // metres along the edge
  const RUN = 40;         // steps per walk: two metres of edge
  const ACROSS = 0.60;    // metres either side, for the crossing search
  const CUTS = 121;

  for (let x = -16; x <= 16; x += 0.5) {
    for (let z = -17; z <= 12; z += 0.5) {
      if (!shadowed(x, z)) continue;
      // The local normal of the geometric boundary.
      const r = 0.25;
      const sh = (a, b) => (shadowed(a, b) ? 1 : 0);
      const gx = sh(x + r, z) - sh(x - r, z);
      const gz = sh(x, z + r) - sh(x, z - r);
      const g = Math.hypot(gx, gz);
      if (g < 1e-9) continue;
      const nx = gx / g; const nz = gz / g;
      if (!shadowed(x + nx * 0.5, z + nz * 0.5) || shadowed(x - nx * 0.5, z - nz * 0.5)) continue;
      const tx = -nz; const tz = nx;

      for (const kind of FILTERS) {
        const read = readers[kind];
        const cross = [];
        for (let s = 0; s < RUN; s++) {
          const ox = x + tx * (s - RUN / 2) * STEP;
          const oz = z + tz * (s - RUN / 2) * STEP;
          // The half-light crossing across the edge, in metres.
          const vals = [];
          for (let i = 0; i < CUTS; i++) {
            const t = (i / (CUTS - 1) - 0.5) * 2 * ACROSS;
            const uv = worldToUv(ox + nx * t, oz + nz * t);
            vals.push(read(uv.u, uv.v));
          }
          const lo = Math.min(vals[0], vals[CUTS - 1]);
          const hi = Math.max(vals[0], vals[CUTS - 1]);
          if (hi - lo < 0.02) { cross.length = 0; break; }
          const half = (lo + hi) / 2;
          let at = null;
          for (let i = 1; i < CUTS; i++) {
            const a = vals[i - 1]; const b = vals[i];
            if ((a < half && b >= half) || (a > half && b <= half)) {
              at = ((i - 1 + (half - a) / (b - a)) / (CUTS - 1) - 0.5) * 2 * ACROSS;
              break;
            }
          }
          if (at === null) { cross.length = 0; break; }
          cross.push(at);
        }
        if (cross.length !== RUN) continue;
        // Take out the straight line: what is left is the wobble.
        let sx = 0; let sy = 0; let sxy = 0; let sxx = 0;
        for (let i = 0; i < RUN; i++) { sx += i; sy += cross[i]; sxy += i * cross[i]; sxx += i * i; }
        const slope = (RUN * sxy - sx * sy) / (RUN * sxx - sx * sx);
        const inter = (sy - slope * sx) / RUN;
        let sum = 0;
        for (let i = 0; i < RUN; i++) {
          const d = cross[i] - (inter + slope * i);
          sum += d * d;
        }
        stats[kind].push(Math.sqrt(sum / RUN));
        if (kind === FILTERS[0]) walks++;
      }
    }
  }

  const q = (l, p) => [...l].sort((a, b) => a - b)[Math.round(p * (l.length - 1))];
  process.stdout.write(`\nTHE STAIRCASE ON ${path.replace(REPO_ROOT, '.')}\n`);
  process.stdout.write(`${walks} walks of two metres along a cast shadow boundary, `
    + `the half-light contour found every 5 cm and the straight line taken out\n\n`);
  process.stdout.write('  reconstruction   walks    wobble RMS across the edge (cm)\n');
  for (const kind of FILTERS) {
    const l = stats[kind];
    if (!l.length) continue;
    process.stdout.write(`  ${kind.padEnd(16)}${String(l.length).padStart(5)}    `
      + `p10 ${(100 * q(l, 0.1)).toFixed(2).padStart(5)}   median ${(100 * q(l, 0.5)).toFixed(2).padStart(5)}   `
      + `p90 ${(100 * q(l, 0.9)).toFixed(2).padStart(5)}\n`);
  }
  const b = stats.bilinear; const c = stats.bicubic;
  if (b.length && c.length) {
    process.stdout.write(`\n  bicubic over bilinear, at the median: `
      + `x${(q(c, 0.5) / q(b, 0.5)).toFixed(3)}\n`);
  }
  process.stdout.write('\n');
}

if (process.argv[1] && process.argv[1].endsWith('staircase.mjs')) await main();
