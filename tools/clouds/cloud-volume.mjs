// Offline cumulus volumes: the field, the light transport, and the march.
//
// WHY THIS EXISTS. The sky's clouds used to be cut out of the reference
// photograph, and in that photograph the monoliths cover part of the sky. Those
// pixels do not exist, so every bank carried a monolith-shaped bite that is
// invisible from one pose and obvious from every other. A photograph gives a
// frame, not a world. So a cloud is GROWN here instead: a volume whose
// silhouette is whole by construction — the field is driven to nothing by a
// smooth wall inside every window face — and whose light is not baked into its
// colour, so the same piece can be lit from any sun direction at run time.
//
// WHAT IT PRODUCES. Per piece, per delivered texel: coverage, a surface normal,
// a sky-visibility term, and one transported-sun-energy channel per sun plane.
// Colour is not among them, on purpose; see cloud-tone.mjs for how light
// becomes picture, and bake-volumes.mjs for the writer.
//
// This file is NOT wired into any build script. It is run by hand, offline,
// and its output is committed as an asset.

import { writeFileSync, mkdirSync } from 'node:fs';

// ---------------------------------------------------------------- the volume

function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NT = 64; const NT2 = NT * NT; const NTM = NT - 1;
const TAB = (() => {
  const r = mulberry32(0x5f3759df);
  const a = new Float32Array(NT * NT * NT);
  for (let i = 0; i < a.length; i++) a[i] = r();
  return a;
})();

function n3(x, y, z) {
  const ix = Math.floor(x); const iy = Math.floor(y); const iz = Math.floor(z);
  let fx = x - ix; let fy = y - iy; let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const x0 = ix & NTM; const y0 = (iy & NTM) * NT; const z0 = (iz & NTM) * NT2;
  const x1 = (ix + 1) & NTM; const y1 = ((iy + 1) & NTM) * NT; const z1 = ((iz + 1) & NTM) * NT2;
  const a00 = TAB[z0 + y0 + x0] + (TAB[z0 + y0 + x1] - TAB[z0 + y0 + x0]) * fx;
  const a01 = TAB[z0 + y1 + x0] + (TAB[z0 + y1 + x1] - TAB[z0 + y1 + x0]) * fx;
  const b00 = TAB[z1 + y0 + x0] + (TAB[z1 + y0 + x1] - TAB[z1 + y0 + x0]) * fx;
  const b01 = TAB[z1 + y1 + x0] + (TAB[z1 + y1 + x1] - TAB[z1 + y1 + x0]) * fx;
  const c0 = a00 + (a01 - a00) * fy;
  const c1 = b00 + (b01 - b00) * fy;
  return c0 + (c1 - c0) * fz;
}

function fbm(x, y, z, oct) {
  let v = 0; let a = 0.5; let f = 1; let n = 0;
  for (let i = 0; i < oct; i++) { v += a * n3(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.07; }
  return v / n;
}

function ridged(x, y, z, oct) {
  let v = 0; let a = 0.5; let f = 1; let n = 0;
  for (let i = 0; i < oct; i++) {
    const t = n3(x * f, y * f, z * f);
    v += a * (1 - Math.abs(t * 2 - 1)); n += a; a *= 0.5; f *= 2.11;
  }
  return v / n;
}

function buildPuffs(cfg, rng) {
  const puffs = [];
  const grow = (p, gen) => {
    if (gen >= cfg.gens) return;
    for (let k = 0; k < cfg.childCount[gen]; k++) {
      const th = rng() * Math.PI * 2;
      const dy = -0.38 + 1.38 * (rng() ** cfg.upBias);
      const rr = Math.sqrt(Math.max(0, 1 - dy * dy));
      let dx = Math.cos(th) * rr; let dz = Math.sin(th) * rr * cfg.flatZ; let ey = dy;
      const len = Math.hypot(dx, ey, dz) || 1;
      dx /= len; ey /= len; dz /= len;
      const cr = p.r * cfg.childRatio * (0.72 + 0.55 * rng());
      const d = p.r * (0.55 + 0.36 * rng()) + cr * 0.28;
      const c = { x: p.x + dx * d, y: p.y + ey * d, z: p.z + dz * d, r: cr };
      if (Math.abs(c.x) > cfg.ex - cr * 0.25) continue;
      if (Math.abs(c.z) > cfg.ez - cr * 0.25) continue;
      if (c.y > cfg.ey - cr * 0.25) continue;
      if (c.y < cfg.baseY - cr * 0.85) continue;
      puffs.push(c);
      grow(c, gen + 1);
    }
  };
  for (const sh of cfg.shelves || []) puffs.push({ ...sh, ky: sh.ky === undefined ? 0.38 : sh.ky });
  for (const sp of cfg.spines) {
    for (let i = 0; i < sp.nodes; i++) {
      const u = sp.nodes === 1 ? 0 : i / (sp.nodes - 1);
      const r = sp.r0 * (1 - sp.taper * u) * (0.86 + 0.30 * rng());
      const node = {
        x: sp.x + sp.lean * u + (rng() - 0.5) * sp.jitter,
        y: sp.y0 + (sp.y1 - sp.y0) * u,
        z: (sp.z || 0) + (rng() - 0.5) * sp.jitter,
        r,
      };
      puffs.push(node);
      grow(node, 0);
    }
  }
  return puffs;
}

const smax = (a, b, k) => {
  const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (a - b) / k));
  return b + (a - b) * h + k * h * (1 - h);
};

// The union constant is per-sphere, and it has to be.
//
// `smax` merges a sphere into the accumulated field over a band of `K` in FIELD
// units, and a sphere's field has a gradient of 1/r, so one constant is a fillet
// whose WORLD width shrinks with the sphere. At 0.085 two billows 76 px across
// meet over about three pixels — the shallow crease a cumulus is scalloped by,
// which is exactly what it is for — and a 30 px lobe laid on one of them meets
// it over barely one. A lobe with a one-pixel seam round it does not read as a
// swelling of the mass; it reads as a separate ball stuck to it, and no shading
// afterwards can argue otherwise.
//
// So a sphere may carry its own `blend`. The composition's own billows keep
// 0.085 and their crease; the sub-billow tiers arrive with a wider one and melt
// into the face they sit on.
function buildBase(puffs, cfg, vpu) {
  const y0 = cfg.baseY - 0.08; const y1 = cfg.ey + 0.02;
  const nx = Math.round(2 * cfg.ex * vpu);
  const ny = Math.round((y1 - y0) * vpu);
  const nz = Math.round(2 * cfg.ez * vpu);
  const g = new Float32Array(nx * ny * nz).fill(-1);
  const sx = (nx - 1) / (2 * cfg.ex); const ox = (nx - 1) * 0.5;
  const sy = (ny - 1) / (y1 - y0);
  const sz = (nz - 1) / (2 * cfg.ez); const oz = (nz - 1) * 0.5;
  const K0 = cfg.mergeK === undefined ? 0.085 : cfg.mergeK;
  for (const p of puffs) {
    const K = p.blend === undefined ? K0 : p.blend;
    const R = p.r * 1.45;
    const ky = p.ky === undefined ? 1 : p.ky;
    const kyInv = 1 / ky;
    const i0 = Math.max(0, Math.ceil((p.x - R) * sx + ox));
    const i1 = Math.min(nx - 1, Math.floor((p.x + R) * sx + ox));
    const j0 = Math.max(0, Math.ceil((p.y - R * ky - y0) * sy));
    const j1 = Math.min(ny - 1, Math.floor((p.y + R * ky - y0) * sy));
    const k0 = Math.max(0, Math.ceil((p.z - R) * sz + oz));
    const k1 = Math.min(nz - 1, Math.floor((p.z + R) * sz + oz));
    const inv = 1 / p.r;
    for (let k = k0; k <= k1; k++) {
      const wz = (k - oz) / sz - p.z; const dz2 = wz * wz;
      const ko = k * nx * ny;
      for (let j = j0; j <= j1; j++) {
        const wy = (j / sy + y0 - p.y) * kyInv; const dy2 = wy * wy;
        const jo = ko + j * nx;
        for (let i = i0; i <= i1; i++) {
          const wx = (i - ox) / sx - p.x;
          const d = 1 - Math.sqrt(wx * wx + dy2 + dz2) * inv;
          if (d < -0.45) continue;
          const idx = jo + i;
          const cur = g[idx];
          g[idx] = cur > d ? smax(cur, d, K) : smax(d, cur, K);
        }
      }
    }
  }
  return { g, nx, ny, nz, y0, y1, sx, ox, sy, sz, oz };
}

// --------------------------------------------------------------- the fringe
//
// HOW MUCH WATER A PLACE HOLDS, as a field of its own, and why the silhouette
// could not have a fringe without it.
//
// The base field above is a distance to a union of spheres, and the density is
// a ramp on it. That makes the outline of a mass geometric: the eye's optical
// depth through a sphere of radius R at an impact parameter p goes as
// sqrt(R - p), so it crosses from nothing to opaque within a couple of texels
// whatever the ramp does. Measured on the delivered atlas: 83 per cent of the
// texels that carry any cloud at all carry an alpha above 0.9. The silhouettes
// are BINARY, and no term at run time can widen an edge that has no fringe in
// it — the shipped aerial perspective can only fade a whole edge, not soften
// its profile.
//
// A real cumulus does not end where its geometry ends. Its liquid water content
// falls off through an entrainment zone at the boundary, and away from the
// rising cores it thins into veil, sheet and leeward tails that are cloud in
// shape and almost nothing in opacity. That is a property of the MEDIUM, not of
// the shape, so it is carried here as a second field: a weight, multiplying the
// density that the geometry asks for.
//
// Two things use it:
//
//   - every sphere's own outer shell, where the weight ramps to nothing over a
//     band whose width is stated in MODEL UNITS and not as a fraction of the
//     radius. Entrainment has a physical depth; it is not proportional to the
//     size of the lump it is eating. The band is capped at a fraction of the
//     radius all the same, or the smallest sub-billows would dissolve before
//     they were ever seen — a 15 px lobe with an 18 px fringe is not a lobe.
//   - the VEIL bodies, spheres whose weight is a few hundredths and which fall
//     to nothing over their whole radius. They are what spreads a bank past its
//     masses and lets its edge meet the sky instead of cutting against it.
//
// The grid is COARSE on purpose. A weight that varies over a couple of texels
// would be a second erosion; what is wanted is the slow variation of water
// content over tens of texels, and at 96 voxels per unit one voxel is 2.4
// delivered pixels — finer than anything this field is asked to carry, and 17 MB
// instead of the base field's 274.
function buildWeight(puffs, cfg, vpu, seed) {
  const y0 = cfg.baseY - 0.08; const y1 = cfg.ey + 0.02;
  const nx = Math.max(2, Math.round(2 * cfg.ex * vpu));
  const ny = Math.max(2, Math.round((y1 - y0) * vpu));
  const nz = Math.max(2, Math.round(2 * cfg.ez * vpu));
  const g = new Float32Array(nx * ny * nz);
  const sx = (nx - 1) / (2 * cfg.ex); const ox = (nx - 1) * 0.5;
  const sy = (ny - 1) / (y1 - y0);
  const sz = (nz - 1) / (2 * cfg.ez); const oz = (nz - 1) * 0.5;
  // The fringe band, in model units, and the fraction of a radius it may not
  // exceed. 0.077 is 18 delivered pixels across at the shipped window.
  const BAND = cfg.wSoft === undefined ? 0.077 : cfg.wSoft;
  const BAND_FRAC = cfg.wSoftFrac === undefined ? 0.34 : cfg.wSoftFrac;
  // The veil's own structure. A veil of one weight is a disc; what the eye reads
  // as veil is patchy, and stretched along the wind. So the weight of the thin
  // bodies is modulated by a field whose vertical frequency is a little over
  // twice its horizontal one — streaks, not blobs.
  const NF = cfg.wNoiseF === undefined ? 2.6 : cfg.wNoiseF;
  const NA = cfg.wNoiseA === undefined ? 1.05 : cfg.wNoiseA;
  const NB = cfg.wNoiseBase === undefined ? 0.72 : cfg.wNoiseBase;
  for (const p of puffs) {
    const w = p.w === undefined ? 1 : p.w;
    if (w <= 0) continue;
    const thin = w < 1;
    const ky = p.ky === undefined ? 1 : p.ky;
    // A solid sphere keeps its weight a little past its own radius, so the
    // fillet where two of them meet and the fraying that reaches beyond the
    // surface are not thinned along with the outline.
    const R = thin ? p.r : p.r * 1.14;
    const band = thin ? p.r * (p.wBand === undefined ? 0.94 : p.wBand)
      : Math.min(BAND, p.r * BAND_FRAC);
    const inner = Math.max(0, R - band);
    const i0 = Math.max(0, Math.ceil((p.x - R) * sx + ox));
    const i1 = Math.min(nx - 1, Math.floor((p.x + R) * sx + ox));
    const j0 = Math.max(0, Math.ceil((p.y - R * ky - y0) * sy));
    const j1 = Math.min(ny - 1, Math.floor((p.y + R * ky - y0) * sy));
    const k0 = Math.max(0, Math.ceil((p.z - R) * sz + oz));
    const k1 = Math.min(nz - 1, Math.floor((p.z + R) * sz + oz));
    const kyInv = 1 / ky;
    for (let k = k0; k <= k1; k++) {
      const wz = (k - oz) / sz - p.z; const dz2 = wz * wz;
      const z = (k - oz) / sz;
      const ko = k * nx * ny;
      for (let j = j0; j <= j1; j++) {
        const wy = (j / sy + y0 - p.y) * kyInv; const dy2 = wy * wy;
        const y = j / sy + y0;
        const jo = ko + j * nx;
        for (let i = i0; i <= i1; i++) {
          const wx = (i - ox) / sx - p.x;
          const dist = Math.sqrt(wx * wx + dy2 + dz2);
          if (dist >= R) continue;
          let v = dist <= inner ? w : w * (R - dist) / band;
          if (thin) {
            const x = (i - ox) / sx;
            const n = fbm(x * NF + seed * 3.7, y * NF * 2.3 + 11.4, z * NF + seed * 1.9, 3);
            v *= Math.max(0, NB + NA * (n - 0.5));
          }
          const idx = jo + i;
          if (g[idx] < v) g[idx] = v;
        }
      }
    }
  }
  return { g, nx, ny, nz, y0, y1, sx, ox, sy, sz, oz };
}
export { buildWeight };

function makeSampler(G) {
  const { g, nx, ny, nz, y0, sx, ox, sy, sz, oz } = G;
  const nxy = nx * ny;
  return function sample(x, y, z) {
    const fx = x * sx + ox; const fy = (y - y0) * sy; const fz = z * sz + oz;
    if (fx < 0 || fy < 0 || fz < 0 || fx > nx - 1 || fy > ny - 1 || fz > nz - 1) return -1;
    const i = fx | 0; const j = fy | 0; const k = fz | 0;
    const i1 = i + 1 < nx ? i + 1 : i; const j1 = j + 1 < ny ? j + 1 : j;
    const k1 = k + 1 < nz ? k + 1 : k;
    const tx = fx - i; const ty = fy - j; const tz = fz - k;
    const ko = k * nxy; const k1o = k1 * nxy; const jo = j * nx; const j1o = j1 * nx;
    const a0 = g[ko + jo + i] + (g[ko + jo + i1] - g[ko + jo + i]) * tx;
    const a1 = g[ko + j1o + i] + (g[ko + j1o + i1] - g[ko + j1o + i]) * tx;
    const b0 = g[k1o + jo + i] + (g[k1o + jo + i1] - g[k1o + jo + i]) * tx;
    const b1 = g[k1o + j1o + i] + (g[k1o + j1o + i1] - g[k1o + j1o + i]) * tx;
    const c0 = a0 + (a1 - a0) * ty; const c1 = b0 + (b1 - b0) * ty;
    return c0 + (c1 - c0) * tz;
  };
}

/**
 * Eroded density, 0..1.
 *
 * The silhouette is WHOLE by construction and that is the point of the whole
 * prototype: the field is driven to nothing by a smooth wall over the outer
 * slice of every half extent and by a wobbled flat base, so the mass ends
 * inside its own window on all six sides. No pixel of it is a cut.
 */
function makeDensity(sampleBase, cfg, seed, sampleWeight) {
  const {
    warpScale: wS, warpAmp: wA, f0, a0, f1, a1, f2, a2, f3, a3, thr, dens, ex, ez, ey, baseY,
  } = cfg;
  const MICRO_F = cfg.microF || 0; const MICRO_A = cfg.microA || 0;
  const MICRO_P = cfg.microPivot === undefined ? 0.5 : cfg.microPivot;
  const DCAP = cfg.dCap === undefined ? 1 : cfg.dCap;
  const F4 = cfg.f4 || 0; const A4 = cfg.a4 || 0;
  const KNEE = cfg.knee || 0;
  const BCUT = cfg.bCut === undefined ? -0.52 : cfg.bCut;
  const TATTER_W = cfg.tatterW; const TATTER_F = cfg.tatterF;
  const TATTER_A = cfg.tatterA; const TATTER_Z = cfg.tatterZ;
  const TATTER_PIVOT = 0.745; const TATTER_CAP = 0.10;
  const EDGE_SOFT = 0.86;
  // Where the fraying is allowed to act, and why it now needs saying.
  //
  // The tatter was gated on the CONDENSATION THRESHOLD alone: wherever the
  // eroded field crosses `thr` it is perturbed. On a cascade of small puffs that
  // band was the outline and nothing else, because the field there was a thin
  // skin over a lattice of pockets. On a composition of large masses with smooth
  // interiors the same band is the whole visible SURFACE of the body — the front
  // face included — so a ridged noise laid across it does not fray a silhouette,
  // it engraves the body, and that engraving is the wire mesh.
  //
  // Fraying is an entrainment effect at the boundary between cloud and clear
  // air; what makes it VISIBLE as a ragged outline is that the eye is looking
  // along the boundary. So the gate is the geometry the camera sees: the angle
  // between the view ray and the surface of the mass. `c` is the cosine between
  // the base field's gradient and the view direction, so |c| is 1 where the
  // surface faces the camera and 0 where it turns away at the silhouette. On a
  // sphere (1 - c^2)^K is the outer eighth of the projected radius at K = 4,
  // which is a fringe of a few pixels on a billow and nothing at all on its
  // face. The amplitude is NOT reduced — the outline has to stay ragged.
  //
  // The gradient is read off the BASE field, not the eroded one. The eroded
  // field's gradient at these scales IS the erosion noise, so gating on it would
  // hand the mesh straight back through the gate.
  const TAT_RIM = cfg.tatterRim === undefined ? 0 : cfg.tatterRim;
  const TAT_RIM_K = cfg.tatterRimK === undefined ? 4 : cfg.tatterRimK;
  const RE = cfg.tatterRimEps === undefined ? 0.012 : cfg.tatterRimEps;
  const VE = (cfg.viewElDeg || 0) * Math.PI / 180;
  const VX = 0; const VY = Math.sin(VE); const VZ = Math.cos(VE);
  return function density(x, y, z, oct) {
    if (x < -ex || x > ex || z < -ez || z > ez || y > ey || y < baseY - 0.06) return 0;
    const wx = n3(x * wS + 13.1, y * wS + 2.7, z * wS + 5.3) - 0.5;
    const wy = n3(x * wS + 41.7, y * wS + 9.1, z * wS + 22.4) - 0.5;
    const wz = n3(x * wS + 7.9, y * wS + 31.3, z * wS + 18.6) - 0.5;
    const px = x + wx * wA; const py = y + wy * wA; const pz = z + wz * wA;
    let b = sampleBase(px, py, pz);
    if (b < BCUT) return 0;
    // The weight is read at the WARPED point, the same one the geometry is read
    // at, or the fringe would sit a domain warp away from the surface it is the
    // fringe of. Read early: where there is no water there is nothing to erode,
    // and the octaves below are the expensive part of this function.
    let wgt = 1;
    if (sampleWeight) {
      wgt = sampleWeight(px, py, pz);
      if (!(wgt > 0)) return 0;
    }
    b -= (n3(px * f0 + seed, py * f0, pz * f0) - 0.42) * a0;
    b += (ridged(px * f1 + seed * 1.7, py * f1, pz * f1, oct) - 0.52) * a1;
    b += (fbm(px * f2 + seed * 2.3, py * f2, pz * f2, oct >= 3 ? 2 : 1) - 0.5) * a2;
    // A fourth scale, and the reason it is here rather than folded into f2.
    // The photographed material carries structure right down to the texel; a
    // three-scale field read at 0.048 deg per pixel is visibly smoother than it
    // in the body of the mass, which is the one thing the committente said may
    // not happen. This octave lives at twice the grain frequency and is only
    // taken at full quality, so it costs nothing in the grids.
    if (oct >= 3 && a3 > 0) b += (ridged(px * f3 + seed * 5.1, py * f3, pz * f3, 2) - 0.745) * a3;
    const bwob = cfg.baseWobble === undefined ? 1 : cfg.baseWobble;
    const bw = baseY + (n3(x * 0.85 + seed, 4.2, z * 0.85) - 0.5) * 0.17 * bwob
      + (n3(x * 2.6 + seed, 8.1, z * 2.6) - 0.5) * 0.055 * bwob;
    if (y < bw) b -= (bw - y) * 14;
    const q = Math.max(Math.abs(x) / ex, Math.abs(z) / ez, y > 0 ? y / ey : 0);
    if (q > EDGE_SOFT) b -= ((q - EDGE_SOFT) / (1 - EDGE_SOFT)) * 0.9;
    const u = (b - thr) / TATTER_W;
    if (u > -3 && u < 3) {
      // …and NOT on the shelf. The entrainment that frays a cumulus works on
      // its flanks and its crown; its base is a condensation level, a plane
      // where the air stops being able to hold its water, and it is the one
      // part of the silhouette that is straight. Fraying it too produced a
      // lace of holes and islands along the bottom of the mass that reads as
      // coral, not as weather — the single worst thing in the first bake.
      const hAbove = (y - baseY) / Math.max(1e-3, ey - baseY);
      let gate = hAbove <= 0 ? 0 : hAbove >= cfg.tatterFloor ? 1 : hAbove / cfg.tatterFloor;
      if (TAT_RIM && gate > 0) {
        const gx = sampleBase(px + RE, py, pz) - sampleBase(px - RE, py, pz);
        const gy = sampleBase(px, py + RE, pz) - sampleBase(px, py - RE, pz);
        const gz = sampleBase(px, py, pz + RE) - sampleBase(px, py, pz - RE);
        const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (gl < 1e-9) gate = 0;
        else {
          const c = (gx * VX + gy * VY + gz * VZ) / gl;
          const q = 1 - c * c;
          gate *= q <= 0 ? 0 : q ** TAT_RIM_K;
        }
      }
      if (gate > 0) {
        const t = (ridged(px * TATTER_F + seed * 3.1, py * TATTER_F, pz * TATTER_F / TATTER_Z, 1)
          - TATTER_PIVOT) * TATTER_A * Math.exp(-u * u) * gate;
        b += t > TATTER_CAP ? TATTER_CAP : t;
      }
    }
    let d;
    if (KNEE > 0) {
      // A softplus knee instead of a hard cut. Below the condensation threshold
      // the hard version returns nothing, so the mass ends within about four
      // texels and the silhouette is three times crisper than the photograph's
      // — a cumulus does not end that way. It frays through an entrainment zone
      // where the drops are thinning out but have not gone, and that zone is
      // over a hundred metres deep, which at this scale is a dozen pixels.
      // Softplus is that zone: linear well inside, an exponential tail outside
      // whose decay length is KNEE/dens in field units, and it collapses back
      // to the hard cut as KNEE goes to zero.
      const u = (b - thr) * dens / KNEE;
      if (u < -5) return 0;
      d = KNEE * (u > 30 ? u : Math.log1p(Math.exp(u)));
    } else {
      if (b < thr) return 0;
      d = (b - thr) * dens;
    }
    // The density CEILING, and why it is no longer 1.
    //
    // Clipping d at 1 makes the interior of the mass exactly uniform: past a
    // few texels inside the surface every additive octave stops existing, so
    // the optical depth toward the sun through the body is a pure function of
    // how far the ray travels and of nothing else. That is the flat interior,
    // and no amount of detail in the field can cure it while the cap is there.
    // A cumulus is not uniform inside; its liquid water content varies by
    // several times over a few tens of metres. Letting d run to DCAP and taking
    // `sigma` down to keep the same mean opacity trades nothing and gives the
    // sun integral something to read everywhere.
    if (d > DCAP) d = DCAP;
    // A fifth scale, at the pixel. f3 at 55 has a wavelength of 8.5 texels and
    // microF at 70 one of 6.6, so the field had NOTHING below six pixels while
    // the photograph carries structure to two. Gated to full quality, so the
    // light grid and the coarse marches never pay for it.
    if (oct >= 3 && A4 > 0) {
      d += (ridged(px * F4 + seed * 11.3, py * F4, pz * F4, 2) - 0.70) * A4 * Math.min(1, d);
      if (d < 0) d = 0;
    }
    // The body of the mass is CLIPPED here: everywhere more than a few texels
    // inside the surface `b` clears the saturation knee and every additive
    // octave above stops existing. That is why the interior of the first bake
    // reads as a smooth blob while its edge is over-detailed — the fine scales
    // only ever survived where the field was still on the ramp, which is the
    // rim. A multiplicative term is not clipped: it modulates the extinction
    // that is already there, so it lives in the body, and it fades out on its
    // own at the silhouette where `d` is near zero.
    if (oct >= 3 && MICRO_A > 0) {
      const m = fbm(px * MICRO_F + seed * 7.3, py * MICRO_F, pz * MICRO_F, 2) - MICRO_P;
      d *= 1 + MICRO_A * m;
      if (d < 0) d = 0; else if (d > DCAP) d = DCAP;
    }
    // The water, last. Everything above is the SHAPE the mass has; this is how
    // much of it is actually there, and it is applied to the finished density
    // rather than to the field so that a veil is a thin cloud and not a small
    // one: scaling the field instead moves the threshold crossing inward and
    // hands the erosion, whose amplitudes are ten times a veil's weight, a body
    // it can tear into lace.
    return wgt === 1 ? d : d * wgt;
  };
}

// ------------------------------------------------------------ light transport

let SIGMA = 28.0;
let SIGMA_L = 19.0;

/** Coarse density grid, shared by every sun direction. */
function buildDensityGrid(density, cfg, vpu, gridOct = 2) {
  const y0 = cfg.baseY - 0.08; const y1 = cfg.ey + 0.02;
  const nx = Math.round(2 * cfg.ex * vpu);
  const ny = Math.round((y1 - y0) * vpu);
  const nz = Math.round(2 * cfg.ez * vpu);
  const sx = (nx - 1) / (2 * cfg.ex); const ox = (nx - 1) * 0.5;
  const sy = (ny - 1) / (y1 - y0);
  const sz = (nz - 1) / (2 * cfg.ez); const oz = (nz - 1) * 0.5;
  const geom = { nx, ny, nz, y0, y1, sx, ox, sy, sz, oz };
  const dg = new Float32Array(nx * ny * nz);
  const nxy = nx * ny;
  for (let k = 0; k < nz; k++) {
    const z = (k - oz) / sz; const ko = k * nxy;
    for (let j = 0; j < ny; j++) {
      const y = j / sy + y0; const jo = ko + j * nx;
      for (let i = 0; i < nx; i++) dg[jo + i] = density((i - ox) / sx, y, z, gridOct);
    }
  }
  return { dg, geom };
}

/**
 * Optical depth toward an ARBITRARY sun direction, by an ordered sweep along
 * whichever axis the direction is most aligned with.
 *
 * The precedent swept in y only, which works while the sun is well above the
 * horizon and fails at the two things this session has to deliver: a sun near
 * the horizon and a sun below it. Sweeping along the dominant axis is the same
 * recurrence with the same guarantee — the source point is always one step
 * further along that axis, so it is already written — and it holds for every
 * direction on the sphere.
 *
 * Stored as SHORTS over 0..TAU_MAX. N2 used bytes over 0..12, which was sized
 * for a medium whose sun extinction was 41.8 per unit; once that is put back to
 * the value the eye sees, a cumulus reaches an optical depth of a couple of
 * hundred toward the sun and 12 clips the whole shaded side to one value. The
 * ceiling has to clear the range where the scattering tail still moves — its
 * slowest lobe decays at 0.10, so E is still falling at tau 30 — and the step
 * has to be small next to the contrast being measured. Shorts over 0..32 give a
 * step of 0.0005 and cost 79 MB a plane, which three planes can afford.
 */
const TAU_MAX = 32;
const TAU_Q = 65535;
function sweepTau(dg, geom, dgSampler, L, vpu) {
  const { nx, ny, nz, y0, sx, ox, sy, sz, oz } = geom;
  const nxy = nx * ny;
  const tau = new Uint16Array(nx * ny * nz);
  const scale = [sx, sy, sz];
  const counts = [nx, ny, nz];
  let axis = 0;
  for (let a = 1; a < 3; a++) if (Math.abs(L[a]) > Math.abs(L[axis])) axis = a;
  // Model-space length of one step: the ray advances 1.06 voxels along `axis`,
  // and a voxel of that axis is 1/scale[axis] of model space. More than one
  // voxel is what makes the source point land in already-written planes.
  const hStep = (1.06 / scale[axis]) / Math.abs(L[axis]);
  const outer = counts[axis];
  const forward = L[axis] > 0; // source lies at a HIGHER index of `axis`
  const idxOf = (i, j, k) => k * nxy + j * nx + i;
  const posOf = (i, j, k) => [(i - ox) / sx, j / sy + y0, (k - oz) / sz];
  const tauSampler = (x, y, z) => {
    const fx = x * sx + ox; const fy = (y - y0) * sy; const fz = z * sz + oz;
    if (fx < 0 || fy < 0 || fz < 0 || fx > nx - 1 || fy > ny - 1 || fz > nz - 1) return -1;
    const i = fx | 0; const j = fy | 0; const k = fz | 0;
    const i1 = Math.min(nx - 1, i + 1); const j1 = Math.min(ny - 1, j + 1);
    const k1 = Math.min(nz - 1, k + 1);
    const tx = fx - i; const ty = fy - j; const tz = fz - k;
    const g = tau;
    const q = (a, b, c) => g[c * nxy + b * nx + a];
    const a0 = q(i, j, k) + (q(i1, j, k) - q(i, j, k)) * tx;
    const a1 = q(i, j1, k) + (q(i1, j1, k) - q(i, j1, k)) * tx;
    const b0 = q(i, j, k1) + (q(i1, j, k1) - q(i, j, k1)) * tx;
    const b1 = q(i, j1, k1) + (q(i1, j1, k1) - q(i, j1, k1)) * tx;
    const c0 = a0 + (a1 - a0) * ty; const c1 = b0 + (b1 - b0) * ty;
    return (c0 + (c1 - c0) * tz) * (TAU_MAX / TAU_Q);
  };
  const order = [];
  if (forward) for (let a = outer - 1; a >= 0; a--) order.push(a);
  else for (let a = 0; a < outer; a++) order.push(a);
  const put = (i, j, k, value) => {
    const v = Math.round(Math.min(TAU_MAX, Math.max(0, value)) * (TAU_Q / TAU_MAX));
    tau[idxOf(i, j, k)] = v;
  };
  for (const a of order) {
    for (let b = 0; b < counts[(axis + 1) % 3]; b++) {
      for (let c = 0; c < counts[(axis + 2) % 3]; c++) {
        const ijk = [0, 0, 0];
        ijk[axis] = a; ijk[(axis + 1) % 3] = b; ijk[(axis + 2) % 3] = c;
        const [i, j, k] = ijk;
        const dHere = dg[idxOf(i, j, k)];
        const p = posOf(i, j, k);
        const xs = p[0] + L[0] * hStep;
        const ys = p[1] + L[1] * hStep;
        const zs = p[2] + L[2] * hStep;
        const tPrev = tauSampler(xs, ys, zs);
        if (tPrev < 0) { put(i, j, k, dHere * hStep * SIGMA_L * 0.5); continue; }
        const dPrev = dgSampler(xs, ys, zs);
        put(i, j, k, tPrev + 0.5 * (dHere + (dPrev < 0 ? 0 : dPrev)) * hStep * SIGMA_L);
      }
    }
  }
  void vpu;
  return { data: tau, sample: tauSampler };
}

/** Sky occlusion straight up: a column recurrence, exact, sun independent. */
function sweepSky(dg, geom, vpu) {
  const { nx, ny, nz } = geom;
  const nxy = nx * ny;
  const sky = new Float32Array(nx * ny * nz);
  const hy = 1 / vpu;
  for (let k = 0; k < nz; k++) {
    const ko = k * nxy;
    for (let i = 0; i < nx; i++) {
      let acc = 0; let prev = dg[ko + (ny - 1) * nx + i];
      for (let j = ny - 2; j >= 0; j--) {
        const cur = dg[ko + j * nx + i];
        acc += 0.5 * (cur + prev) * hy * SIGMA_L;
        sky[ko + j * nx + i] = acc;
        prev = cur;
      }
    }
  }
  return sky;
}

// ------------------------------------------------------------------- the bake

/** Multiple scattering, three lobes: without it the interior is a paper cutout. */
let MS = { A: 0.35, a: 0.26, B: 0.13, b: 0.07 };
let MS_NORM = 1.48;
/**
 * Multiple scattering, three lobes: without it the interior is a paper cutout.
 *
 * The weights are not decoration. Under backlight — which is how the reference
 * tile is lit, by its own recorded sunSource — the luminance IS the
 * transmission, so how fast this falls with optical depth is exactly how much
 * contrast a turret shows against the one behind it. The default long lobe,
 * 0.13 at a decay of 0.07, barely falls at all over the range a cumulus spans,
 * and it flattens the billow-scale modelling that the photograph plainly has.
 */
const energyOf = (t) => (Math.exp(-t) + MS.A * Math.exp(-t * MS.a) + MS.B * Math.exp(-t * MS.b)) / MS_NORM;

export {
  buildPuffs, buildBase, makeSampler, makeDensity, buildDensityGrid, sweepTau, energyOf,
};

/** The two globals the transport reads, so a diagnostic can set them too. */
export function setSigmas(cfg) {
  SIGMA = cfg.sigma === undefined ? 28.0 : cfg.sigma;
  SIGMA_L = cfg.sigmaL === undefined ? 19.0 : cfg.sigmaL;
  MS = cfg.ms === undefined ? { A: 0.35, a: 0.26, B: 0.13, b: 0.07 } : cfg.ms;
  MS_NORM = 1 + MS.A + MS.B;
  return { SIGMA, SIGMA_L };
}

/**
 * Optical depth toward the sun, EXACT over the near field.
 *
 *   tau(p) = sigmaL * INTEGRAL[0..S] d(p + L s) ds  +  tauGrid(p + L S)
 *
 * which is an identity, not an approximation, as long as the far term is read
 * at the point the near integral ends. That is the whole change. The swept grid
 * is kept for the far field, where it belongs — transport over half a cloud is
 * genuinely smooth — and the near field, which is where one turret shadows the
 * next, is integrated at the resolution of the density field itself.
 *
 * N2's `crisp` probes read tauGrid at p and then tried to correct it, which
 * double counts the near field: the grid already carries it, badly, and three
 * taps of a coarse quadrature do not cancel what they are meant to cancel. That
 * is why the delta form LOST contrast (acut-in 3.12 -> 1.76) instead of gaining
 * it. Evaluating the far term further along the ray needs no cancellation.
 */
function tauSplit(density, tauGrid, x, y, z, L, S, T, sigmaL) {
  const h = S / T;
  // Midpoint rule: T evaluations, no endpoint that the far term also owns.
  let acc = 0;
  for (let q = 0; q < T; q++) {
    const s = (q + 0.5) * h;
    const d = density(x + L[0] * s, y + L[1] * s, z + L[2] * s, 3);
    acc += d;
    // Past this the sun is gone and the remaining taps cannot change the answer
    // by as much as the byte the far term is stored in.
    if (acc * h * sigmaL > 9) return acc * h * sigmaL;
  }
  const far = tauGrid(x + L[0] * S, y + L[1] * S, z + L[2] * S);
  return acc * h * sigmaL + (far < 0 ? 0 : far);
}
export { tauSplit };

export function generate(cfg, suns, { ss = 2, out = 512, log = () => {} } = {}) {
  const t0 = Date.now();
  SIGMA = cfg.sigma === undefined ? 28.0 : cfg.sigma;
  SIGMA_L = cfg.sigmaL === undefined ? 19.0 : cfg.sigmaL;
  MS = cfg.ms === undefined ? { A: 0.35, a: 0.26, B: 0.13, b: 0.07 } : cfg.ms;
  MS_NORM = 1 + MS.A + MS.B;
  const rng = mulberry32(cfg.seed);
  const puffs = buildPuffs(cfg, rng);
  const base = buildBase(puffs, cfg, cfg.vpuBase);
  const sampleBase = makeSampler(base);
  const weight = cfg.wVpu ? buildWeight(puffs, cfg, cfg.wVpu, cfg.seed * 0.011) : null;
  const density = makeDensity(sampleBase, cfg, cfg.seed * 0.017, weight && makeSampler(weight));
  const tPuffs = Date.now();

  const { dg, geom } = buildDensityGrid(density, cfg, cfg.vpuLight, cfg.gridOct === undefined ? 2 : cfg.gridOct);
  const dgSampler = makeSampler({ g: dg, ...geom });
  const tGrid = Date.now();
  log(`  puffs ${puffs.length} (${((tPuffs - t0) / 1000).toFixed(1)}s), `
    + `grid ${geom.nx}x${geom.ny}x${geom.nz} (${((tGrid - tPuffs) / 1000).toFixed(1)}s)`);

  const skyGrid = sweepSky(dg, geom, cfg.vpuLight);
  const skySampler = makeSampler({ g: skyGrid, ...geom });

  const taus = [];
  for (const s of suns) {
    const st = Date.now();
    taus.push(sweepTau(dg, geom, dgSampler, s.L, cfg.vpuLight));
    log(`  sweep ${s.name} (${((Date.now() - st) / 1000).toFixed(1)}s)`);
  }
  const tSweep = Date.now();

  // Gradient of the coarse density, which is the surface a billow actually has.
  // The surface a billow actually has. Read off the COARSE grid it is the
  // surface the light grid has, which is the same thing that made the fine
  // octaves invisible; read off the field itself at a couple of texels it is
  // the surface the eye is looking at.
  const FINE_N = !!cfg.fineNormal;
  const FE = cfg.fineEps === undefined ? 0.0045 : cfg.fineEps;
  const gradAt = FINE_N
    ? (x, y, z, o) => {
      o[0] = density(x + FE, y, z, 3) - density(x - FE, y, z, 3);
      o[1] = density(x, y + FE, z, 3) - density(x, y - FE, z, 3);
      o[2] = density(x, y, z + FE, 3) - density(x, y, z - FE, 3);
    }
    : (x, y, z, o) => {
      const e = 1.6 / cfg.vpuLight;
      o[0] = dgSampler(x + e, y, z) - dgSampler(x - e, y, z);
      o[1] = dgSampler(x, y + e, z) - dgSampler(x, y - e, z);
      o[2] = dgSampler(x, y, z + e) - dgSampler(x, y, z - e);
    };

  const W = out * ss; const H = out * ss;
  const pad = cfg.pad;
  // The window is stated, not derived, so three pieces of different size are
  // all written at the SAME angular scale and their readings compare.
  const winW = cfg.winW === undefined ? cfg.ex * pad : cfg.winW;
  const winH = cfg.winH === undefined ? cfg.ey * pad : cfg.winH;
  const yMid = cfg.yMid === undefined ? (cfg.ey + cfg.baseY) * 0.5 : cfg.yMid;
  const e = cfg.viewElDeg * Math.PI / 180;
  const v = [0, Math.sin(e), Math.cos(e)];
  const up = [0, Math.cos(e), -Math.sin(e)];
  const tMax = 2.0 + 2 * cfg.ez;
  const STEP_COARSE = 0.032; const STEP_FINE = 0.0125;
  // Where the medium is thin enough that the eye can see through it, and the
  // step the march takes there.
  //
  // A veil adds half a model unit of marchable medium in front of every mass,
  // and at the fine step with the exact near-field sun integral that is forty
  // more steps of five hundred density evaluations each — it would triple the
  // cost of a piece to shade a region that is almost transparent. Below this
  // density the optical depth over a step is a few hundredths, so the picture
  // cannot tell the difference; and a place the EYE can see through is a place
  // the SUN can see through, so the near-field integral, which exists to put one
  // billow's shadow on the next, has nothing there to resolve and the swept grid
  // answers it. Both are the same statement about the same medium.
  const THIN_D = cfg.thinD === undefined ? 0.04 : cfg.thinD;
  const STEP_THIN = cfg.thinStep === undefined ? 0.028 : cfg.thinStep;
  const K = suns.length;

  // The near field of the sun transport, in model units, and how many taps it
  // is integrated with. sunNear is sized on a billow: at winW 1.10 over 512
  // texels, 0.11 model units is 26 texels, which is about the width of the
  // lobes the photograph shows shadowing each other.
  const SUN_SPLIT = !!cfg.sunSplit;
  const SUN_S = cfg.sunNear === undefined ? 0.11 : cfg.sunNear;
  const SUN_T = cfg.sunTaps === undefined ? 12 : cfg.sunTaps;
  // The surface term: how much, over how short a path, in how many taps. The
  // path is SHORT on purpose — a few texels — because the whole point is the
  // structure a long path averages away.
  const SURF = cfg.surf || 0;
  const SURF_S = cfg.surfNear === undefined ? 0.020 : cfg.surfNear;
  const SURF_T = cfg.surfTaps === undefined ? 5 : cfg.surfTaps;

  const BSKIP = cfg.bSkip === undefined ? -0.55 : cfg.bSkip;
  const CRISP_TAPS = cfg.crispTaps || [[0.028, 1.55], [0.070, 1.15]];
  const CRISP_D = Float64Array.from(CRISP_TAPS, (t) => t[0]);
  const CRISP_W = Float64Array.from(CRISP_TAPS, (t) => t[1]);
  const CRISP_N = CRISP_TAPS.length;
  const CRISP_OCT = cfg.crispOct === undefined ? 2 : cfg.crispOct;
  const CRISP_FLOOR = cfg.crispFloor === undefined ? 0.22 : cfg.crispFloor;
  const CRISP_DELTA = cfg.crispMode === 'delta';
  const CRISP_SCALE = cfg.crispScale === undefined ? 1 : cfg.crispScale;

  // Two surface terms, stored SEPARATELY from the transported energy so the
  // amount of each can be chosen after the bake instead of during it. They
  // differ in the only thing that turned out to matter: the scale the normal is
  // read at. `A` reads the gradient of the full field over two texels — which
  // is what the first attempt did, and it produced frost, because the gradient
  // of a field whose finest octave IS two texels is not a surface, it is noise.
  // `B` reads it over seven texels with the fine octaves gated off, which is
  // the scale a billow actually has a face at.
  const SURF_BAKE = !!cfg.surfBake;
  const EPS_A = cfg.epsA === undefined ? 0.0045 : cfg.epsA;
  const EPS_B = cfg.epsB === undefined ? 0.016 : cfg.epsB;
  const surfAB = SURF_BAKE ? new Float32Array(W * H * K) : null;
  const surfBB = SURF_BAKE ? new Float32Array(W * H * K) : null;
  const gA = [0, 0, 0]; const gB = [0, 0, 0];

  const alphaB = new Float32Array(W * H);
  const normB = new Float32Array(W * H * 3);
  const aoB = new Float32Array(W * H);
  const tauVB = new Float32Array(W * H);
  const litB = new Float32Array(W * H * K);
  const g = [0, 0, 0];

  for (let py = 0; py < H; py++) {
    const sy = (0.5 - (py + 0.5) / H) * 2 * winH + yMid;
    for (let px = 0; px < W; px++) {
      const sxp = ((px + 0.5) / W - 0.5) * 2 * winW;
      const ox = sxp + up[0] * sy - v[0];
      const oy = up[1] * sy - v[1];
      const oz = up[2] * sy - v[2];
      let t = 0; let trans = 1;
      let nx = 0; let ny = 0; let nz = 0; let ao = 0; let tauV = 0;
      const lit = new Float64Array(K);
      const surfA = SURF_BAKE ? new Float64Array(K) : null;
      const surfB = SURF_BAKE ? new Float64Array(K) : null;
      while (t < tMax) {
        const x = ox + v[0] * t; const y = oy + v[1] * t; const z = oz + v[2] * t;
        if (sampleBase(x, y, z) < BSKIP) { t += STEP_COARSE; continue; }
        const d = density(x, y, z, 3);
        if (d <= 0.002) { t += STEP_FINE; continue; }
        if (d < THIN_D) {
          const stepT = Math.exp(-d * STEP_THIN * SIGMA);
          const w = trans * (1 - stepT);
          tauV += d * STEP_THIN * SIGMA;
          const st = skySampler(x, y, z);
          ao += Math.exp(-(st < 0 ? 0 : st) * 1.15) * w;
          // No normal and no surface term: a veil has no faces. Leaving them out
          // is not a saving taken against the picture, it is the picture — a
          // surface term on a transparent place would light a face that is not
          // there, and the averaged normal it fed would tilt the ambient of the
          // texels that DO have a face behind it.
          for (let k = 0; k < K; k++) {
            const tp = taus[k].sample(x, y, z);
            lit[k] += energyOf(tp < 0 ? 0 : tp) * w;
          }
          trans *= stepT;
          if (trans < 0.012) break;
          t += STEP_THIN;
          continue;
        }
        const stepT = Math.exp(-d * STEP_FINE * SIGMA);
        const w = trans * (1 - stepT);
        tauV += d * STEP_FINE * SIGMA;
        gradAt(x, y, z, g);
        const gl = Math.hypot(g[0], g[1], g[2]);
        if (gl > 1e-6) { nx -= g[0] / gl * w; ny -= g[1] / gl * w; nz -= g[2] / gl * w; }
        const st = skySampler(x, y, z);
        ao += Math.exp(-(st < 0 ? 0 : st) * 1.15) * w;
        if (SURF_BAKE) {
          gA[0] = density(x + EPS_A, y, z, 3) - density(x - EPS_A, y, z, 3);
          gA[1] = density(x, y + EPS_A, z, 3) - density(x, y - EPS_A, z, 3);
          gA[2] = density(x, y, z + EPS_A, 3) - density(x, y, z - EPS_A, 3);
          gB[0] = density(x + EPS_B, y, z, 2) - density(x - EPS_B, y, z, 2);
          gB[1] = density(x, y + EPS_B, z, 2) - density(x, y - EPS_B, z, 2);
          gB[2] = density(x, y, z + EPS_B, 2) - density(x, y, z - EPS_B, 2);
          const lA = Math.hypot(gA[0], gA[1], gA[2]);
          const lB = Math.hypot(gB[0], gB[1], gB[2]);
          const iA = lA > 1e-9 ? 1 / lA : 0; const iB = lB > 1e-9 ? 1 / lB : 0;
          for (let k = 0; k < K; k++) {
            const L = suns[k].L;
            const tt = tauSplit(density, taus[k].sample, x, y, z, L, SUN_S, SUN_T, SIGMA_L);
            lit[k] += energyOf(tt) * w;
            const nA = -(gA[0] * L[0] + gA[1] * L[1] + gA[2] * L[2]) * iA;
            const nB = -(gB[0] * L[0] + gB[1] * L[1] + gB[2] * L[2]) * iB;
            if (nA > 0 || nB > 0) {
              let sh = 0;
              const hs = SURF_S / SURF_T;
              for (let q = 0; q < SURF_T; q++) {
                const s = (q + 0.5) * hs;
                sh += density(x + L[0] * s, y + L[1] * s, z + L[2] * s, 3);
              }
              const T = Math.exp(-sh * hs * SIGMA_L);
              if (nA > 0) surfA[k] += nA * T * w;
              if (nB > 0) surfB[k] += nB * T * w;
            }
          }
          trans *= stepT;
          if (trans < 0.012) break;
          t += STEP_FINE;
          continue;
        }
        if (SUN_SPLIT) {
          const inv = gl > 1e-9 ? 1 / gl : 0;
          for (let k = 0; k < K; k++) {
            const L = suns[k].L;
            const tt = tauSplit(density, taus[k].sample, x, y, z, L, SUN_S, SUN_T, SIGMA_L);
            let v = energyOf(tt);
            if (SURF > 0 && inv) {
              // The single-scattering surface term, and why nothing else could
              // stand in for it.
              //
              // Everything the picture had until here is a LONG-PATH integral:
              // optical depth toward the sun over half a cloud, averaged again
              // along the view ray. A zero-mean octave integrated over thirty of
              // its own wavelengths contributes nothing — that is not a
              // resolution failure, it is what an integral does — so no amount
              // of fine structure in the density can reach the shading through
              // it. Measured: an octave at a 3.3-texel wavelength moved acut-in
              // by 0.001 and hfRMS by 0.002.
              //
              // What a photographed cumulus shows at the pixel is the FIRST
              // optical depth: how the local surface leans into the sun, and
              // whether the lobe next to it is in the way. That is a term of
              // its own, it depends on the gradient of the field at the scale
              // the eye reads, and this architecture never had one.
              const ndl = -(g[0] * L[0] + g[1] * L[1] + g[2] * L[2]) * inv;
              if (ndl > 0) {
                let sh = 0;
                const hs = SURF_S / SURF_T;
                for (let q = 0; q < SURF_T; q++) {
                  const s = (q + 0.5) * hs;
                  sh += density(x + L[0] * s, y + L[1] * s, z + L[2] * s, 3);
                }
                v += SURF * ndl * Math.exp(-sh * hs * SIGMA_L);
              }
            }
            lit[k] += v * w;
          }
          trans *= stepT;
          if (trans < 0.012) break;
          t += STEP_FINE;
          continue;
        }
        for (let k = 0; k < K; k++) {
          const tp = taus[k].sample(x, y, z);
          let E = energyOf(tp < 0 ? 0 : tp);
          if (cfg.crisp) {
            // Short probes toward the sun at FULL resolution. The grid averages
            // the terminator of a billow over a voxel, and a voxel is wider
            // than a texel at any resolution that fits in memory: without this
            // the mass keeps its shape and loses the hard little shadows
            // between its lobes, which is most of what the eye reads as
            // material rather than as a smooth blob.
            //
            // The octave matters as much as the resolution. Probing at oct 2
            // asks the fine scales nothing — they are gated above it — so the
            // shading answered at the scale of a lobe while the coverage
            // carried detail down to the texel. The two disagreed, and the eye
            // read the disagreement as a smooth body with a brittle edge.
            const L = suns[k].L;
            if (CRISP_DELTA) {
              // What the light grid MISSED, added back as optical depth.
              //
              // The grid is built from the field at oct 2, so its finest
              // content is f2 — about eight pixels here — and the sweep then
              // trilinerly smooths even that. The interior of the mass is
              // nothing but sun transport, so it inherits that limit exactly:
              // no amount of detail in the coverage can put structure into a
              // body whose shading has none.
              //
              // The correction is the difference between the field at full
              // resolution and the same field as the grid sees it, integrated
              // over a short distance toward the sun. It is zero-mean where the
              // grid is right and non-zero exactly at the scales the grid lost,
              // and unlike a multiplier it does not saturate.
              let tf = 0;
              for (let q = 0; q < CRISP_N; q++) {
                const t2 = CRISP_D[q];
                const xs = x + L[0] * t2; const ys = y + L[1] * t2; const zs = z + L[2] * t2;
                const dc = dgSampler(xs, ys, zs);
                tf += CRISP_W[q] * (density(xs, ys, zs, 3) - (dc < 0 ? 0 : dc));
              }
              const tt = tp + tf * SIGMA_L * CRISP_SCALE;
              E = energyOf(tt < 0 ? 0 : tt);
            } else {
              let sh = 0;
              for (let q = 0; q < CRISP_N; q++) {
                const t2 = CRISP_D[q];
                sh += CRISP_W[q] * density(x + L[0] * t2, y + L[1] * t2, z + L[2] * t2, CRISP_OCT);
              }
              E *= CRISP_FLOOR + (1 - CRISP_FLOOR) * Math.exp(-sh);
            }
          }
          lit[k] += E * w;
        }
        trans *= stepT;
        if (trans < 0.012) break;
        t += STEP_FINE;
      }
      const alpha = 1 - trans;
      const i = py * W + px;
      alphaB[i] = alpha;
      tauVB[i] = tauV;
      if (alpha > 1e-4) {
        const inv = 1 / alpha;
        const l = Math.hypot(nx, ny, nz);
        if (l > 1e-9) { normB[i * 3] = nx / l; normB[i * 3 + 1] = ny / l; normB[i * 3 + 2] = nz / l; }
        aoB[i] = ao * inv;
        for (let k = 0; k < K; k++) litB[i * K + k] = lit[k] * inv;
        if (SURF_BAKE) {
          for (let k = 0; k < K; k++) {
            surfAB[i * K + k] = surfA[k] * inv;
            surfBB[i * K + k] = surfB[k] * inv;
          }
        }
      }
    }
    if (py % 256 === 0) log(`  march row ${py}/${H} (${((Date.now() - tSweep) / 1000).toFixed(0)}s)`);
  }
  const tMarch = Date.now();

  // Downsample the supersampled buffers to the delivered size.
  const box = (src, ch) => {
    const dst = new Float32Array(out * out * ch);
    for (let j = 0; j < out; j++) {
      for (let i = 0; i < out; i++) {
        for (let c = 0; c < ch; c++) {
          let s = 0;
          for (let b = 0; b < ss; b++) {
            for (let a = 0; a < ss; a++) s += src[((j * ss + b) * W + i * ss + a) * ch + c];
          }
          dst[(j * out + i) * ch + c] = s / (ss * ss);
        }
      }
    }
    return dst;
  };
  // Coverage-weighted for the per-texel quantities: the mean of a channel over
  // four sub-texels of which three are sky is not the channel.
  const boxWeighted = (src, ch) => {
    const dst = new Float32Array(out * out * ch);
    for (let j = 0; j < out; j++) {
      for (let i = 0; i < out; i++) {
        let wsum = 0;
        const acc = new Float64Array(ch);
        for (let b = 0; b < ss; b++) {
          for (let a = 0; a < ss; a++) {
            const o = (j * ss + b) * W + i * ss + a;
            const w = alphaB[o];
            wsum += w;
            for (let c = 0; c < ch; c++) acc[c] += src[o * ch + c] * w;
          }
        }
        if (wsum > 1e-6) for (let c = 0; c < ch; c++) dst[(j * out + i) * ch + c] = acc[c] / wsum;
      }
    }
    return dst;
  };

  const result = {
    width: out,
    height: out,
    alpha: box(alphaB, 1),
    normal: boxWeighted(normB, 3),
    ao: boxWeighted(aoB, 1),
    tauView: box(tauVB, 1),
    lit: boxWeighted(litB, K),
    surfA: SURF_BAKE ? boxWeighted(surfAB, K) : null,
    surfB: SURF_BAKE ? boxWeighted(surfBB, K) : null,
    suns,
    cfg,
    puffs: puffs.length,
    timings: {
      puffs: (tPuffs - t0) / 1000,
      grid: (tGrid - tPuffs) / 1000,
      sweeps: (tSweep - tGrid) / 1000,
      march: (tMarch - tSweep) / 1000,
      total: (tMarch - t0) / 1000,
    },
  };
  // Renormalise the averaged normals, which a weighted box does not preserve.
  for (let i = 0; i < out * out; i++) {
    const n = result.normal;
    const l = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
    if (l > 1e-9) { n[i * 3] /= l; n[i * 3 + 1] /= l; n[i * 3 + 2] /= l; }
  }
  return result;
}

// ------------------------------------------------------------------- the suns

const DEG = Math.PI / 180;
/** Sprite frame: +x right, +y up, +z away from the viewer (sun behind the mass). */
export function sunVec(azDeg, elDeg) {
  const a = azDeg * DEG; const e = elDeg * DEG;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
}

export const SUNS = [
  { name: 'ref-34-0', az: 0, el: 34 },
  { name: 'back-34-30', az: 30, el: 34 },
  { name: 'side-34-90', az: 90, el: 34 },
  { name: 'side-34-m90', az: -90, el: 34 },
  { name: 'front-34-180', az: 180, el: 34 },
  { name: 'front-34-140', az: 140, el: 34 },
  { name: 'high-70-45', az: 45, el: 70 },
  { name: 'low-8-0', az: 0, el: 8 },
  { name: 'low-8-90', az: 90, el: 8 },
  { name: 'low-8-180', az: 180, el: 8 },
  { name: 'set-m6-150', az: 150, el: -6 },
  { name: 'back-34-m45', az: -45, el: 34 },
].map((s) => ({ ...s, L: sunVec(s.az, s.el) }));

