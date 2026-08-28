// The bodies: how a cumulus is composed, and the recipe the pieces are cut with.
//
// A cumulus is NOT a recursive spray of puffs. An earlier build grew one that
// way — every spine node spawning four children, each of those three, each of
// those two — and three generations from a radius of 0.34 is 480 spheres whose
// last two generations are 43 and 22 px across at the delivered scale. That is
// foam, and the octave table agreed: it put a third more energy at 16-32 px
// than the photograph carries.
//
// What the photograph shows is a few large rising masses, each a stack of
// billows 60 to 150 px across, with smooth interiors, a frayed crown, and a
// flat condensation base. So a body is composed EXPLICITLY here, as a short
// list of large spheres, and handed to the generator through the one door it
// has for them. Sizes are quoted in delivered pixels because that is what the
// eye and the octave table both work in: at a window of 1.10 model units over
// 512 texels, one model unit is 232.7 px.
//
// That list is the FIRST scale and not the only one. A body of large spheres and
// nothing else reads as a snowman — a pile of smooth balls — because the
// photograph carries lobes at 76 px AND at 30 AND at 15, and the middle range
// was empty. Two explicit tiers of sub-billows are laid on the composition
// further down, in `scallop`; they are a tier, not a cascade, and the difference
// between the two is the whole argument in the note there.
export const PX = 232.7;
export const px = (d) => d / (2 * PX); // billow diameter in px -> model radius

export function mulberry32(a) {
  return function next() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * One rising mass: a stack of billows from `d0` px wide at the base to `d1` at
 * the crown, plus billows on the flanks and a fringe on the shoulders.
 *
 * The stack is what gives the tower a smooth interior. Consecutive spheres
 * overlap by `merge` of their radius, so the union is one body with a shallow
 * crease where two billows meet — the scalloping a cumulus reads by — instead
 * of a lumpy surface made of many small unions.
 */
function tower(t, rng, out) {
  const n = t.n;
  const jitter = t.jitter === undefined ? 0.035 : t.jitter;
  const merge = t.merge === undefined ? 0.62 : t.merge;
  const J = () => (rng() - 0.5) * 2 * jitter;

  // Walk up the axis placing each billow a fraction of the running radius above
  // the previous one, so the spacing shrinks with the tower instead of being a
  // constant that leaves gaps at the top and mush at the bottom.
  let y = t.y0;
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1);
    const r = px(t.d0 + (t.d1 - t.d0) * u) * (0.92 + 0.16 * rng());
    const x = t.x + (t.lean || 0) * u + J();
    const z = (t.z || 0) + (t.leanZ || 0) * u + J() * 0.7;
    nodes.push({ x, y, z, r, ky: t.ky === undefined ? 1 : t.ky });
    out.push(nodes[i]);
    const rNext = px(t.d0 + (t.d1 - t.d0) * ((i + 1) / (n - 1)));
    y += (r + rNext) * merge;
  }

  // Flank billows, on the sunward and shadow shoulders of the stack. These are
  // the faces that catch the light and cast onto the billow below, so they are
  // NOT small: two thirds of the trunk they hang off.
  for (const f of t.flanks || []) {
    const a = nodes[Math.min(nodes.length - 1, f.at)];
    const r = a.r * (f.k === undefined ? 0.66 : f.k) * (0.9 + 0.2 * rng());
    const th = f.th * Math.PI / 180;
    const reach = (a.r + r) * (f.reach === undefined ? 0.72 : f.reach);
    out.push({
      x: a.x + Math.cos(th) * reach,
      y: a.y + (f.dy === undefined ? 0 : f.dy) * a.r + J() * 0.5,
      z: a.z + Math.sin(th) * reach * 0.8,
      r,
      ky: 1,
    });
  }

  // The crown fringe, and the ONLY place small spheres are allowed. Entrainment
  // frays the top of a cumulus into puffs a few tens of pixels across; the same
  // puffs spread through the body are the foam. They live here and on the
  // shoulders, never as the tissue of the mass.
  const top = nodes[nodes.length - 1];
  for (let i = 0; i < (t.fringe || 0); i++) {
    const th = rng() * Math.PI * 2;
    const rr = px(t.fringeD || 34) * (0.7 + 0.6 * rng());
    const s = top.r * (0.45 + 0.45 * rng());
    out.push({
      x: top.x + Math.cos(th) * s,
      y: top.y + top.r * (0.42 + 0.42 * rng()),
      z: top.z + Math.sin(th) * s * 0.8,
      r: rr,
      ky: 0.85,
    });
  }
  return nodes;
}

/**
 * The shelf. A cumulus base is a condensation level: a plane, not a fray. It is
 * built as a few wide, very flat spheres so the bottom of the mass is one
 * coherent ledge that the towers sit ON, and so the deep shadow under it is a
 * single large-scale event — which is most of what the photograph's energy
 * above 64 px actually is.
 */
function shelf(s, rng, out) {
  const n = s.n === undefined ? 3 : s.n;
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0.5 : i / (n - 1);
    out.push({
      x: s.x0 + (s.x1 - s.x0) * u + (rng() - 0.5) * 0.03,
      y: s.y + (rng() - 0.5) * 0.02,
      z: (s.z || 0) + (rng() - 0.5) * 0.05,
      r: px(s.d) * (0.9 + 0.2 * rng()),
      ky: s.ky === undefined ? 0.24 : s.ky,
    });
  }
}

/**
 * A run of VEIL bodies: cloud in shape, almost nothing in opacity.
 *
 * These are not spheres that happen to be faint. They carry `w`, the weight the
 * volume multiplies its finished density by, and it is under a tenth — a body
 * half a model unit deep at an effective 0.02 reaches an alpha near a half,
 * which is a place the sky is visible THROUGH rather than a place cloud ends. Their
 * weight also falls to nothing over their own radius, so a veil has no rim of
 * its own: it thins out, which is the whole reason for it. The numbers below
 * are peaks: the weight field modulates them by a noise whose mean is under a
 * half, so what a ray actually meets in the middle of a sheet is nearer 0.08.
 *
 * Why the shipped pieces needed them. The committente's verdict on the target
 * was that the cloud is immense, soft, and that in places its border almost
 * mixes with the colour of the sky; the measurement behind that is that 28.5
 * per cent of the target's cloud sits under half thickness against 4.3 per cent
 * of ours. A union of spheres cannot produce that number. Its optical depth at
 * an impact parameter p goes as sqrt(R - p), so the crossing from nothing to
 * opaque is a couple of texels wide however the density ramps, and the fraction
 * of a MASS that is thin is the fraction of it that is within a couple of texels
 * of the outline — a few per cent, no matter what. What is thin in a real bank
 * is not the edge of the turrets. It is the sheet they stand in.
 */
function veils(list, rng, out) {
  for (const v of list) {
    const n = v.n === undefined ? 3 : v.n;
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0.5 : i / (n - 1);
      out.push({
        x: (v.x0 + (v.x1 - v.x0) * u) + (rng() - 0.5) * 0.05,
        y: (v.y0 === undefined ? v.y : v.y0 + (v.y1 - v.y0) * u) + (rng() - 0.5) * 0.05,
        z: (v.z || 0) + (rng() - 0.5) * (v.zJit === undefined ? 0.16 : v.zJit),
        r: px(v.d) * (0.86 + 0.28 * rng()),
        ky: v.ky === undefined ? 0.55 : v.ky,
        w: v.w * (0.75 + 0.5 * rng()),
        wBand: v.wBand,
      });
    }
  }
}

// ------------------------------------------------------------ the sub-billows
//
// The tiers between the billows and the noise, and why a body without them reads
// as a snowman.
//
// The composition above is a handful of billows with a median diameter of 76 px,
// and the erosion below it lives at 7 px and under. Between the two there was
// NOTHING, and a photographed cumulus is not built that way: it carries lobes at
// 76 px AND at 30 AND at 15, each with a lit crown and a shaded underside, and
// it is that middle range — not the amount of noise — that makes it read as
// cauliflower rather than as a stack of balls. Turning the erosion amplitudes up
// to fill the range was tried and produces an even isotropic speckle over smooth
// spheres: crust, because the octave table counts how much energy sits at each
// scale and cannot see whether it is ORGANISED, and the photograph's is. So the
// range is filled with lobes, in the field, where they get their own light.
//
// Three things decide whether a lobe reads as a swelling of the mass or as a
// ball stuck to it, and all three had to be got right together:
//
//   - its SIZE is absolute, not a fraction of its parent. A fraction puts 67 px
//     lobes on the 183 px masses and 27 px on the 76 px ones, which is a second
//     helping of billows at one end and grain at the other. The eddies that fold
//     a cloud surface are sized by the air, not by the lump underneath.
//   - it stands proud of its parent by `emerge` of its OWN radius, and that
//     number is small. At 1.30 the lobes on the outline are circles against the
//     sky — a ball however wide the fillet is. 0.70 is as far as it goes.
//   - it is merged with a fillet of its own; see the note in cloud-volume.mjs.
//
// Where they go is not free either. A cumulus is scalloped where it GROWS —
// crowns and upper flanks — and smooth underneath, where the air is descending
// and the base is a condensation plane. That is also why the placement is biased
// by height and NOT by the sun: the geometry is baked once and lit thirteen
// times, so a distribution fitted to the production sun would be that sun cooked
// into the shape, and the day/night cycle is the whole reason this bake exists.
// Up-ness gives the same picture — a lit crown and a shaded underside — under
// every sun above the horizon, and keeps it under all of them.

const DEG = Math.PI / 180;

/**
 * One tier of sub-billows on the visible, growing faces of the masses composed.
 *
 * `dLobe`  lobe diameter in delivered pixels
 * `spread` half-width of the size draw, as a fraction of `dLobe`
 * `cover`  fraction of the parent's camera-facing hemisphere the footprints
 *          cover; this is what decides whether a crown is scalloped or knobbly
 * `ratio`  smallest parent-to-lobe diameter ratio worth scalloping; below it a
 *          billow is already a lobe itself
 * `emerge` how far a lobe stands proud of its parent, in its own radii
 * `blend`  the merge constant this tier is unioned with
 * `crown`  exponent on the elevation draw; below 1 it crowds the top
 * `elMin`  lowest elevation on the parent a lobe may sit at, in degrees
 * `zBias`  how much of the placement is thrown toward the camera
 */
export function scallop(puffs, seed, {
  dLobe = 30, spread = 0.26, cover = 0.45, ratio = 2.2,
  emerge = 0.70, blend = 0.34, crown = 0.55, elMin = -12, zBias = 0.75, tag = 1,
} = {}) {
  const rng = mulberry32(seed ^ (0x5bf03635 + tag * 0x9e3779b1));
  const out = puffs.slice();
  const sMin = Math.sin(elMin * DEG);
  const rL = px(dLobe);
  for (const p of puffs) {
    const ky = p.ky === undefined ? 1 : p.ky;
    // A flattened sphere is the shelf: a condensation level is a plane, and the
    // one part of a cumulus silhouette that is straight. It is not scalloped.
    if (ky < 0.6 || 2 * p.r * PX < ratio * dLobe) continue;
    // Nor is a veil. A lobe is a swelling of a growing surface, and a body the
    // sky is visible through has no surface to swell; scalloping one puts solid
    // warts through a sheet, because a lobe added here would carry the default
    // weight and be opaque where its parent is not.
    if (p.w !== undefined && p.w < 1) continue;
    // Footprints over a hemisphere: a lobe standing proud by half its radius
    // meets its parent on a circle about 0.9 of that radius wide, so the count
    // that covers a fraction `cover` of 2*pi*R^2 is 2.47 * cover * (R/r)^2.
    const cnt = Math.max(1, Math.round(2.47 * cover * (p.r / rL) ** 2));
    for (let i = 0; i < cnt; i++) {
      // Elevation first, biased to the crown; azimuth over the half turn the
      // camera sees, because a lobe on the far side costs a march and shows
      // nothing.
      const sph = sMin + (1 - sMin) * rng() ** crown;
      const cph = Math.sqrt(Math.max(0, 1 - sph * sph));
      const th = (rng() * 1.5 - 0.25) * Math.PI;
      const r = rL * (1 - spread + 2 * spread * rng());
      const d = p.r + (emerge - 1) * r;
      out.push({
        x: p.x + Math.cos(th) * cph * d,
        y: p.y + sph * d * ky,
        z: p.z - Math.abs(Math.sin(th)) * cph * d * zBias,
        r,
        ky: 1,
        blend,
      });
    }
  }
  return out;
}

/**
 * The largest uniform scale at which the whole composition still clears the
 * window walls, so a piece can be written to FILL its frame instead of floating
 * in it. Hand-tuning thirty spheres against three inequalities is how the first
 * pass ended up with a mass covering three fifths of its window, which wastes
 * texels and, worse, makes the paired crop compare a small cloud against a
 * large one.
 *
 * x and z scale about the axis; y scales about the CONDENSATION PLANE, because
 * that is the one height in the model that is physically fixed — a cumulus
 * grows upward from its base, it does not grow about its middle.
 */
export function fitScale(puffs, cfg) {
  const qx = 0.86 * cfg.ex; const qz = 0.86 * cfg.ez; const qy = 0.86 * cfg.ey;
  let s = Infinity;
  for (const p of puffs) {
    const ky = p.ky === undefined ? 1 : p.ky;
    s = Math.min(s, qx / (Math.abs(p.x) + p.r), qz / (Math.abs(p.z) + p.r));
    const h = (p.y - cfg.baseY) + p.r * ky;
    if (h > 0) s = Math.min(s, (qy - cfg.baseY) / h);
  }
  return s;
}

export function scale(puffs, s, cfg) {
  return puffs.map((p) => ({
    ...p, x: p.x * s, z: p.z * s, y: cfg.baseY + (p.y - cfg.baseY) * s, r: p.r * s,
  }));
}

export function compose(spec, seed) {
  const rng = mulberry32(seed);
  const out = [];
  if (spec.shelf) shelf(spec.shelf, rng, out);
  for (const t of spec.towers) tower(t, rng, out);
  if (spec.veils) veils(spec.veils, rng, out);
  return out;
}

/**
 * Does every sphere sit inside the window with its silhouette intact?
 *
 * Sides and top are hard limits: `EDGE_SOFT` in the density starts eating the
 * field at 0.86 of each half extent, so a sphere that reaches past it is a mass
 * cut by the window wall — the one defect this whole prototype exists to make
 * impossible.
 *
 * The BOTTOM is not a limit and must not be checked as one. The base billow of
 * a tower is supposed to sink through the condensation plane: the plane slices
 * it flat, and that slice IS the shelf. Only a sphere that has sunk entirely
 * below the plane is an error, because it contributes nothing but cost.
 */
export function fits(puffs, cfg) {
  const bad = [];
  const qx = 0.86 * cfg.ex; const qz = 0.86 * cfg.ez; const qy = 0.86 * cfg.ey;
  for (const p of puffs) {
    const ky = p.ky === undefined ? 1 : p.ky;
    if (Math.abs(p.x) + p.r > qx) bad.push(['x', p]);
    else if (Math.abs(p.z) + p.r > qz) bad.push(['z', p]);
    else if (p.y + p.r * ky > qy) bad.push(['y+', p]);
    else if (p.y + p.r * ky < cfg.baseY) bad.push(['sunk', p]);
  }
  return bad;
}

/** Diameters in delivered pixels, so the histogram can be eyeballed. */
export function sizes(puffs) {
  const d = puffs.map((p) => 2 * p.r * PX).sort((a, b) => a - b);
  const q = (f) => d[Math.min(d.length - 1, Math.floor(f * d.length))];
  return {
    n: d.length, min: d[0], p25: q(0.25), med: q(0.5), p75: q(0.75), max: d[d.length - 1],
  };
}

// ------------------------------------------------------------------ the shapes
//
// Three builds of different size and character, all written into the same
// window at the same angular scale, so their readings compare with each other
// and with the photograph.
//
// All three are staggered THROUGH DEPTH, and that is the thing that separates
// them from every flat version before them. What makes photographed material
// read as a stack of solid bodies rather than as foam is that its billows
// OCCLUDE one another: a near billow cuts a crisp curved edge across the one
// behind it, hard silhouette on one side and shaded flank on the other. No
// blend of overlapping spheres can produce that edge while the spheres are
// coplanar, so one tower stands forward of its ledge, another well behind it,
// and flank billows are thrown toward the viewer as well as sideways.

export const SPECS = {
  // A wide bank: one dominant tower a little left of centre, a shorter mass on
  // the right, a low one on the far left, all standing on one ledge.
  grande: {
    shelf: { x0: -0.40, x1: 0.40, y: -0.62, z: 0.02, d: 160, ky: 0.22, n: 5 },
    towers: [
      {
        x: -0.16, z: -0.18, y0: -0.52, d0: 152, d1: 80, n: 4, lean: 0.05, merge: 0.58, jitter: 0.05,
        flanks: [
          { at: 1, th: 200, k: 0.62, dy: -0.10 },
          { at: 1, th: 300, k: 0.56, dy: 0.05, reach: 0.62 },
          { at: 2, th: 150, k: 0.55, dy: 0.10 },
        ],
        fringe: 4, fringeD: 36,
      },
      {
        x: 0.30, z: 0.26, y0: -0.55, d0: 126, d1: 72, n: 3, lean: -0.04, merge: 0.60, jitter: 0.045,
        flanks: [
          { at: 0, th: 340, k: 0.60, dy: 0.08 },
          { at: 1, th: 170, k: 0.50, dy: -0.05 },
        ],
        fringe: 3, fringeD: 30,
      },
      {
        x: -0.52, z: 0.02, y0: -0.56, d0: 110, d1: 70, n: 2, lean: 0.04, merge: 0.58,
        flanks: [{ at: 0, th: 190, k: 0.50, reach: 0.5, dy: 0.05 }],
        fringe: 2, fringeD: 28,
      },
    ],
  },

  // One medium mass with a smaller companion set well behind it. This is the
  // one that has to prove a mass does not need a crowd to read as weather.
  medio: {
    shelf: { x0: -0.22, x1: 0.22, y: -0.62, z: 0.02, d: 145, ky: 0.24, n: 4 },
    towers: [
      {
        x: -0.04, z: -0.14, y0: -0.50, d0: 148, d1: 86, n: 4, lean: 0.05, merge: 0.60, jitter: 0.045,
        flanks: [
          { at: 0, th: 195, k: 0.60, dy: 0.05 },
          { at: 1, th: 320, k: 0.62, dy: 0.00, reach: 0.62 },
          { at: 2, th: 160, k: 0.55, dy: 0.12 },
        ],
        fringe: 4, fringeD: 34,
      },
      {
        x: 0.40, z: 0.22, y0: -0.56, d0: 96, d1: 64, n: 2, lean: -0.03, merge: 0.58,
        flanks: [{ at: 0, th: 20, k: 0.55, dy: 0.08 }],
        fringe: 2, fringeD: 26,
      },
    ],
  },

  // A tall narrow tower whose stack leans through depth as well as across, so
  // its own billows occlude each other on the way up.
  torre: {
    shelf: { x0: -0.16, x1: 0.16, y: -0.63, z: 0.02, d: 120, ky: 0.20, n: 3 },
    towers: [
      {
        x: -0.02, z: -0.06, y0: -0.54, d0: 134, d1: 68, n: 5, lean: 0.10, leanZ: -0.10, merge: 0.56, jitter: 0.05,
        flanks: [
          { at: 1, th: 200, k: 0.58, dy: -0.05 },
          { at: 2, th: 330, k: 0.60, dy: 0.05, reach: 0.62 },
          { at: 3, th: 170, k: 0.52, dy: 0.10 },
        ],
        fringe: 5, fringeD: 32,
      },
    ],
  },
};

// -------------------------------------------------------------------- the bank
//
// A fourth character, and the one the sky is actually made of.
//
// The three above are all the same animal seen from three distances: a rising
// mass on a ledge, with the mass reaching between two thirds and one and a half
// times the width of the ledge it stands on. Baked twenty four times they read
// as a row of cumulus, and the committente's verdict on them was that they grow
// upward, that they nearly all look the same, and that they are too crisp; of
// the target he said the clouds are immense, that they run right across the
// frame and past the mountains, that they are softer, and that in places their
// border almost mixes with the colour of the sky.
//
// Those are three different statements and they need three different answers.
//
//   WIDE is geometry. `fitScale` blows every piece up until it touches its
//   window, so the delivered aspect is the aspect of the composition and nothing
//   else. A bank is a raft two model units across carrying mounds three quarters
//   of a unit tall, which lands between 1.9 and 2.3 — the target's own 1.93.
//
//   NOT ALL ALIKE is the crown line. One tower with flank billows has one
//   summit, and eight of them are eight of the same silhouette however the seed
//   jitters it. A bank has four or five summits of DIFFERENT heights standing at
//   different depths, and what varies between two banks is which of them is the
//   tallest and how far apart they stand — a profile, not a jitter.
//
//   SOFT is not geometry at all, and this is where the earlier sessions could
//   not have got there from where they were standing. See the note on the weight
//   field in cloud-volume.mjs: the fringe is water, not shape.
//
// The mounds are TWO billows and not four. A stack of four is a turret whatever
// it is called; the difference between a bank and a row of cumulus is that its
// masses are wider than they are tall, and a mound of d0 150 px under a d1 of
// 120 is 0.77 model units above its base against the 1.9 of the raft it sits on.

/**
 * The two numbers each bank is trimmed by, and why they are written down rather
 * than derived.
 *
 * Everything else in this archetype is a draw. Two of its readings are not free
 * to be draws, because they are what the piece was commissioned for: the aspect
 * has to land between 1.9 and 2.3, and at least a quarter of the coverage has to
 * sit under half. Both are read off a BAKE — the aspect from the spans that hold
 * ninety per cent of the mass, the fringe from the coverage histogram — and
 * neither can be computed from the spheres, because both depend on where the
 * mass ends up and not on where the geometry reaches. The box the spheres fill
 * predicts the mass aspect only to about a quarter, which is the whole of the
 * range.
 *
 * So each bank carries a raft length (`span`) and a veil strength, and each pair
 * was found by stepping on a quarter-side bake — ten seconds a try — until the
 * two readings landed. They are a CALIBRATION, not a taste: the sweep that found
 * them recomputes them, and a change to the recipe above invalidates them and
 * has to.
 *
 * The aspect knob is the raft's LENGTH and not the height of its mounds, and
 * that is a measured decision rather than a preference. Both bring the aspect
 * down, but a taller mound is more solid: pulling one bank from 2.53 to 2.25 by
 * growing its summits took its fringe share from 31 per cent to 20. Shortening
 * the raft takes the veil with it in the same proportion, so the share of the
 * piece that is thin barely moves — `fitScale` then blows what is left back up
 * to the window, and nothing is lost but the width.
 *
 * The veil knob does NOT run the way it looks either. Above about its nominal
 * weight a heavier veil REDUCES the thin share, because it pushes the middle of
 * the sheet over half coverage faster than it recruits new texels at the rim.
 */
export const BANCO_TUNE = [
  { span: 1.000, veil: 1.000 }, // the archetype, untrimmed
  { span: 0.895, veil: 1.042 },
  { span: 1.000, veil: 1.000 },
  { span: 0.837, veil: 1.055 },
  { span: 1.000, veil: 1.000 },
  { span: 1.000, veil: 1.000 },
  { span: 0.922, veil: 1.010 },
  { span: 1.000, veil: 1.000 },
  // The eighth is the one that would not come: its five summits stand close
  // enough that the sheet has little of the window left to itself, and its thin
  // share sits at 21 whatever the veil weight is asked for — 20.6 at 0.85, 20.6
  // at 2.1. It is kept because a roster of eight banks that are all equally soft
  // is the complaint this archetype answers, and because the batch it belongs to
  // reads 28 per cent.
  { span: 0.912, veil: 1.300 },
];

/**
 * One bank. `k` is which of them: 0 is the archetype, and the variations move
 * the crown line, the depth stagger and the reach of the veil.
 */
export function bancoSpec(seed, k = 0, tune = BANCO_TUNE[k] || BANCO_TUNE[0]) {
  const span = tune.span === undefined ? 1 : tune.span;
  const rng = mulberry32((seed ^ (0x2545f491 + k * 0x9e3779b1)) >>> 0);
  for (let i = 0; i < 5; i++) rng();
  const U = (a, b) => a + (b - a) * rng();
  const half = (k === 0 ? 0.61 : U(0.55, 0.67)) * span;
  const dShelf = k === 0 ? 158 : U(142, 172);
  const nM = k === 0 ? 5 : 4 + Math.round(rng());
  // Which summit is the tallest, and how much taller. A crown line that peaks in
  // the middle every time is a pyramid, and eight pyramids are the complaint
  // this archetype exists to answer.
  const peak = Math.floor(rng() * nM);
  const towers = [];
  for (let i = 0; i < nM; i++) {
    const u = nM === 1 ? 0.5 : i / (nM - 1);
    // The prominence of this summit: 1 at the peak, falling away from it, with
    // enough draw left that the fall is not a tidy triangle either.
    const away = Math.abs(i - peak) / Math.max(1, nM - 1);
    const prom = (1 - 0.34 * away) * U(0.90, 1.06);
    const d0 = Math.max(104, Math.min(168, (k === 0 ? 148 : U(132, 160)) * prom));
    towers.push({
      x: (u * 2 - 1) * half * U(0.94, 1.04) + U(-0.05, 0.05),
      // Alternating through depth, so the summits occlude one another instead of
      // standing in one plane like a paper cutout.
      z: (i % 2 ? 1 : -1) * U(0.08, 0.26),
      y0: -0.60 + U(-0.03, 0.03),
      d0,
      // A MOUND: the crown is three quarters of the base, not two fifths. Below
      // about 0.62 the stack starts to spire and the piece stops being a bank.
      d1: d0 * U(0.68, 0.84),
      n: 2,
      lean: U(-0.05, 0.05),
      merge: U(0.58, 0.64),
      jitter: 0.045,
      flanks: [
        { at: 0, th: U(150, 210), k: U(0.52, 0.66), dy: U(0.02, 0.14) },
        ...(rng() < 0.55 ? [{ at: 1, th: U(300, 360), k: U(0.48, 0.62), dy: U(-0.06, 0.06), reach: 0.64 }] : []),
      ],
      fringe: 2 + Math.round(rng() * 2),
      fringeD: U(28, 38),
    });
  }
  const top = -0.60 + 0.77;
  return {
    // One raft under the whole thing, and it runs the full width. A bank whose
    // base is a row of separate ledges reads as separate clouds however close
    // they stand.
    shelf: {
      x0: -half * 1.06, x1: half * 1.06, y: -0.62, z: U(-0.04, 0.04), d: dShelf, ky: U(0.18, 0.24), n: 6 + Math.round(rng()),
    },
    veils: [
      // THE SHEET the mounds stand in, and it has to be BIGGER than they are or
      // it is not a fringe of anything: a veil hidden inside the raft's own
      // footprint adds no thin texels at all, which is measurable and was
      // measured. It reaches a quarter of a raft past both ends and half a raft
      // over the shoulders of the mounds, so what the eye meets first, coming in
      // from the sky, is a thing whose opacity is a third and falling.
      {
        x0: -half * 1.24, x1: half * 1.24, y: -0.44, d: k === 0 ? 208 : U(192, 224), ky: 0.74,
        w: (k === 0 ? 0.176 : U(0.147, 0.205)) * tune.veil, n: 6, z: U(-0.08, 0.08), zJit: 0.26,
      },
      // The apron: the low band, wider than everything and thinner than the
      // sheet. The target carries 30 per cent coverage under 6 degrees of
      // elevation and its Weber contrast there is 0.22 against 0.58 at 22 — the
      // bottom of that sky is not the bottom of a cumulus, it is haze with
      // structure in it.
      {
        x0: -half * 1.34, x1: half * 1.34, y: -0.62, d: U(176, 200), ky: 0.44,
        w: U(0.083, 0.122) * tune.veil, n: 5, z: U(-0.10, 0.10), zJit: 0.22,
      },
      // The leeward tail. One end of a bank always trails: a run that leaves the
      // raft at the height of the sheet, thinner than it, and ends in nothing.
      // Which end is drawn, so the eight are not eight of one shape.
      {
        x0: (rng() < 0.5 ? -1 : 1) * half * 0.6, x1: (rng() < 0.5 ? -1 : 1) * half * 1.42,
        y0: -0.54, y1: -0.36, d: U(150, 182), ky: 0.52, w: U(0.064, 0.102) * tune.veil, n: 3, z: U(-0.16, 0.16), zJit: 0.26,
      },
      // And the crown veil, which is what lets a summit end in the sky instead
      // of against it. Kept just under the tops on purpose: a veil that stands
      // well over the crowns adds two degrees of height to the window and takes
      // the aspect straight back out of the range the archetype exists for.
      {
        x0: -half * 0.86, x1: half * 0.86, y: top - 0.20, d: U(150, 178), ky: 0.60,
        w: U(0.051, 0.090) * tune.veil, n: 4, z: U(-0.12, 0.12), zJit: 0.22,
      },
    ],
    towers,
  };
}

// The archetype of the fourth character, built by the function above it so that
// the eight delivered banks and the one that is looked at are the same recipe.
SPECS.banco = bancoSpec(4409, 0);

// ------------------------------------------------------------------ the recipe
//
// Every scalar the generator reads, stated in one place because a recipe
// assembled by spreading six partial objects over each other is a recipe nobody
// can audit. Each group carries the reason it holds the value it does.
export const RECIPE = {
  seed: 1117,

  // The window. Stated rather than derived, so pieces of different size are all
  // written at the same angular scale and their readings compare.
  ex: 1.00, ey: 0.88, ez: 0.72, baseY: -0.74, pad: 1.10,
  winW: 1.10, winH: 0.968, yMid: 0.07, viewElDeg: 13,

  // The body is the explicit composition below, so the recursive cascade that
  // used to grow it is switched off. This is the whole of the «foam» cure.
  gens: 0, spines: [], childCount: [4, 3, 2], childRatio: 0.52, upBias: 0.72, flatZ: 0.85,

  // The erosion, in delivered pixels: one model unit is 232.7 px, so a lattice
  // frequency f has a wavelength of 232.7/f.
  //   f0 1.35 -> 172 px   f1 3.6 -> 65 px   f2 34 -> 6.8 px
  //   f3 58 -> 4.0 px     micro 70 -> 3.3 px   f4 140 -> 1.7 px
  //
  // f1 sits at 65 px, LONGER than a billow, where it undulates the mass instead
  // of pitting it. An earlier build had its largest erosion amplitude at 22 px,
  // dead centre of the band the photograph is emptiest in, which is most of what
  // made the body read as foam.
  warpScale: 1.15, warpAmp: 0.12,
  f0: 1.35, a0: 0.14,
  f1: 3.6, a1: 0.130,
  f2: 34, a2: 0.055,
  f3: 58, a3: 0.045,
  microF: 70, microA: 0.18,
  f4: 140, a4: 0.022,

  // The core of a cumulus is OPAQUE. `a0` and the domain warp between them used
  // to carve the inside of a tower into soft grey channels — dirty glass rather
  // than water — so both are held low: erosion belongs near the surface, where
  // entrainment actually happens.

  // The fraying of the outline, and the gate that keeps it there. `tatterRim`
  // multiplies the fraying by (1 - cos^2)^K between the base field's gradient
  // and the view direction: unity where the surface turns away from the camera,
  // zero where it faces it. Without it the same noise lies across the whole
  // visible surface of a solid mass and engraves the body with bright filaments
  // that read as wire. The amplitude is deliberately NOT reduced — dropping it
  // does clear the filaments but costs the ragged outline with them.
  tatterW: 0.045, tatterF: 19.0, tatterA: 0.95, tatterZ: 5.5, tatterFloor: 0.28,
  tatterRim: 1, tatterRimK: 4, tatterRimEps: 0.012,
  baseWobble: 1.0,

  // The medium. `dens` low with `sigma` high leaves an UNSATURATED skin for the
  // fine scales to live in; `knee` is the entrainment tail, sized so the
  // coverage crossing 0.12 to 0.85 lands near the photograph's 13.7 px — a
  // cumulus does not end within four texels.
  thr: 0.035, dens: 2.2, sigma: 62, knee: 0.095,

  // The extinction the SUN sees, and the single most consequential number here.
  // It defaults to 19 against a `sigma` of 62, which makes the mass three and a
  // third times more transparent to the sun than to the eye: a body that thin
  // casts nothing on itself, has no shaded side, and looks identical from every
  // sun direction. It is 62 because it is the same medium.
  sigmaL: 62,

  // The near field of the sun transport, integrated exactly rather than read off
  // the grid. 0.11 model units is 26 texels, about the width of the lobes the
  // photograph shows shadowing each other.
  sunSplit: true, sunNear: 0.11, sunTaps: 12,

  // The two surface terms, baked as separate channels so their weights are
  // chosen after the bake instead of during it. They differ only in the scale
  // the normal is read at: A over two texels, which on a field whose finest
  // octave IS two texels is noise and reads as frost, and B over seven, which is
  // the scale a billow actually has a face at.
  surfBake: true, epsA: 0.0045, epsB: 0.016,

  // Multiple scattering: the tail that carries light from the lit side round to
  // the shaded one. Shortened from the default, whose slowest lobe barely fell
  // over the range a cumulus spans, so the billows washed out.
  ms: { A: 0.30, a: 0.30, B: 0.07, b: 0.10 },

  // THE FRINGE: how much water the place holds, on a grid of its own. The
  // argument is in cloud-volume.mjs, under `buildWeight`; these are the numbers.
  //
  // `wSoft` is the entrainment band in model units — 0.077 is 18 delivered
  // pixels — and it is stated absolutely because entrainment has a depth of its
  // own and does not scale with the lump it is eating. `wSoftFrac` stops it
  // eating the smallest sub-billows: a 15 px lobe with an 18 px fringe is not a
  // lobe, so no sphere loses more than a third of its radius to the band.
  //
  // `wVpu` at 96 is one voxel per 2.4 delivered pixels. It is COARSE against the
  // base field's 240 and that is the point: a weight that varied at the texel
  // would be a second erosion, and the erosion is already at the texel.
  wVpu: 128, wSoft: 0.110, wSoftFrac: 0.55,
  wNoiseF: 4.5, wNoiseA: 2.2, wNoiseBase: 0.45,

  // Where the medium stops being worth marching finely; see the note in
  // cloud-volume.mjs. At 0.04 a step of 0.028 carries an optical depth of 0.07,
  // which is under a level of the eight bits the coverage ships in.
  thinD: 0.04, thinStep: 0.028,

  // The base field's resolution, and it is 240 because of the finest tier and
  // for no other reason. At 150 one voxel is 3.1 delivered pixels, so a 15 px
  // lobe is under five voxels across and trilinear sampling of the union erases
  // it before the march ever sees it. It is worth saying what the finer grid
  // does NOT do: baked with the 30 px tier alone at 150 and at 240, the octave
  // table reads 0.87/0.83/1.62/3.31/5.13 and 0.88/0.84/1.62/3.31/5.13. Nothing.
  // The grid is here to carry the third tier, not to sharpen the second.
  gridOct: 3, vpuBase: 240, vpuLight: 200,
};

/**
 * How much of each surface channel the delivered look carries.
 *
 * B and not A: the fine normal produces frost.
 *
 * It was 0.80, and it comes down because the job it was doing has been taken
 * over by something real. The surface term shades the faces the mass ALREADY
 * has, and it was pushed this hard on a body that had no middle tier in it —
 * where it was the only thing that could carry the interior acutance from 1.2 to
 * the photograph's 1.7. With the lobes in the field the same body reads 1.73 at
 * cB ZERO, so 0.80 is now a second helping of modelling on top of modelling that
 * exists, and the octave table says so: it puts 1-2 px at 1.11 against a
 * photographic 0.76. At 0.45 the three bands the reference can actually support
 * land within 12 per cent of BOTH references — 0.84/0.80/1.51 against the
 * photograph's 0.76/0.79/1.35 and the target's 0.92/0.90/1.56 — and the interior
 * acutance at 1.99 sits within two per cent of the target's 2.03.
 */
export const SURF_MIX = { cA: 0, cB: 0.45 };

/**
 * The sub-billow tiers every delivered piece carries.
 *
 * Two, at 30 and 15 delivered pixels, which are the second and third scales the
 * photograph shows under its 76 px billows. `cover` is 0.45 on both and it is
 * not lower on purpose: taking the fine tier down to 0.32 made the crown worse,
 * not calmer — 1.10/1.00/1.89/3.44/4.93 against 1.11/1.00/1.81/3.08/4.37 —
 * because sparse lobes read as isolated warts on a smooth face while dense ones
 * tile it into cauliflower. Sparser is not calmer.
 */
export const TIERS = [
  { dLobe: 30, cover: 0.45, emerge: 0.70, blend: 0.34, crown: 0.55, elMin: -12 },
  {
    dLobe: 15, cover: 0.45, emerge: 0.60, blend: 0.34, ratio: 2.0, crown: 0.60, elMin: -8,
  },
];

/** The sun plane the world is lit by at the reference pose. */
export const PROD_SUN = { name: 'prod', az: -9.5, el: 34 };

/**
 * One delivered piece: the recipe, the composed body with its sub-billow tiers
 * on it scaled to fill its window, and the sun planes it is baked for.
 *
 * `fill` is the fraction of the largest scale that still clears the window, so
 * a piece is written to FILL its frame rather than float in it — which also
 * stops a paired crop comparing a small cloud against a large one.
 *
 * The tiers go on the raw composition and the fit happens ONCE, at the end. A
 * lobe that pokes through the window wall is a cut silhouette, which is the
 * defect this whole approach exists to make impossible, so the fit has to see
 * the lobes; and fitting twice — once for the body, again for the body with
 * lobes — shrinks the piece against its own predecessor and hands every paired
 * crop a smaller cloud, which is a difference nobody asked for.
 */
export function piece(spec, seed, suns, fill = 0.97) {
  return pieceFrom(spec, SPECS[spec], seed, suns, fill);
}

/**
 * The same, from a body given explicitly rather than looked up by name.
 *
 * A sky needs two dozen pieces and there are three archetypes, so the pieces
 * that are not the archetypes are VARIATIONS of them — the same three characters
 * with their masses standing elsewhere. The seed cannot do that job: it jitters
 * radii by a twelfth and moves nothing an eye reads, which is measured rather
 * than assumed. So the composition arrives as a value, and everything that
 * follows it — the tiers, the fit to the window, the recipe — is identical.
 */
export function pieceFrom(name, body, seed, suns, fill = 0.97) {
  let puffs = compose(body, seed);
  for (let i = 0; i < TIERS.length; i++) puffs = scallop(puffs, seed, { ...TIERS[i], tag: i + 1 });
  return {
    ...RECIPE,
    name,
    shelves: scale(puffs, fill * fitScale(puffs, RECIPE), RECIPE),
    suns,
  };
}
