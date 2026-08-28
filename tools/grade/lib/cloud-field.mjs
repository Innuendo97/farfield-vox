import { clearSkyAt } from './sky-model.mjs';

// The other ninety five per cent of the sky.
//
// The reference shows a sector twenty five degrees tall and seventy five wide.
// Everything else has to be built, and it has to be built out of the same
// material or it will not match: the sky the walker turns towards must be the
// same weather as the sky in front of them, photographed at the same hour, and
// nothing about it may read as a copy of what is behind.
//
// So the clouds here are not drawn. They are the reference's own cloud,
// separated from the sky behind it into coverage and colour, cut into a library
// of pieces, and laid back down across the sphere.
//
// What they are laid down as is the part that had to change. Pieces scattered
// one by one over the sphere, each on its own, produce a sky made of confetti:
// a few hundred similar blobs, evenly spread, none of them belonging to any
// other. The reference has nothing of the sort. It has masses — banks tens of
// degrees across, with flat grey bases at one common height, towers rising out
// of them, edges lit from behind towards the sun — and between the masses a
// scattering of small fragments and a great deal of empty sky. So a mass here
// is composed rather than magnified: ten to twenty pieces at close to their own
// scale, packed into one system, is a bank; one piece stretched to the width of
// a bank is a smear.
//
// Relighting is what makes any of it legal. A piece of cloud carries the light
// it had where it was photographed; put down somewhere else it would carry the
// wrong light, and the eye reads wrong light long before it reads a repeated
// shape. The alpha field gives a surface normal, the sun gives a direction, and
// each piece is divided by the shading it came with and multiplied by the
// shading it should have. What survives that is the material — the texture, the
// grain, the way an edge frays — which is the only thing worth carrying over.

const DEG = Math.PI / 180;

/** Deterministic noise, so a bake is reproducible. */
function makeRandom(seedValue) {
  let s = seedValue >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Local frame of a direction: east, up and the direction itself. The sun in
 * this basis is what a piece of cloud in that direction is lit by.
 */
export function sunInLocalFrame(elevationDeg, azimuthDeg, sun) {
  const e = elevationDeg * DEG;
  const a = azimuthDeg * DEG;
  const d = [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
  const east = [Math.cos(a), 0, Math.sin(a)];
  // up is what is left of the vertical once the view direction is taken out
  const dy = d[1];
  const up = [-dy * d[0], 1 - dy * d[1], -dy * d[2]];
  const len = Math.hypot(up[0], up[1], up[2]) || 1;
  up[0] /= len; up[1] /= len; up[2] /= len;
  return [
    sun[0] * east[0] + sun[1] * east[1] + sun[2] * east[2],
    sun[0] * up[0] + sun[1] * up[1] + sun[2] * up[2],
    sun[0] * d[0] + sun[1] * d[1] + sun[2] * d[2],
  ];
}

// Shading of a piece of cloud, from the normal its own coverage implies.
// Ambient, a lambert term and a forward scattering term: a cumulus seen against
// the sun has a bright edge and a grey belly, and both come out of this.
// Coverage below this is read as clear sky rather than as thin cloud.
export const COVER_FLOOR = 0.16;

// Above this height the equirect grid stops being a grid: a row near the pole
// is a circle a few degrees across, and a piece of cloud laid across it smears
// round the whole texture. The layer is drawn towards its own average over the
// row there, which is the only thing a pole can carry.
//
// It starts a long way lower than it used to. The blend is smooth in its
// weight, but what it blends is not: pulling a cloud towards the mean of its
// own row rubs it out sideways, and a cloud half rubbed out at seventy nine
// degrees was a horizontal smear across the top of the sky. Started at sixty,
// where the reference has no cumulus left to lose, it has nothing to rub out.
const POLE_SMOOTH_FROM = 60;
const POLE_SMOOTH_TO = 89;

// Exported because the sprites carry this shading into the running frame rather
// than into a texture: tools/clouds/bake-sprites.mjs divides the reference's own
// cloud by it and writes the coefficients into the manifest the runtime shader
// multiplies them back with. Two copies of these four numbers would be two
// different clouds.
export const SHADE_AMBIENT = 0.42;
export const SHADE_DIFFUSE = 0.72;
export const SHADE_FORWARD = 0.55;
export const NORMAL_SLOPE = 5.0;

// Cloud is white, near enough. How far a channel of a piece may sit from the
// mean of its three once it has been renormalised and relit: enough for a
// shaded belly to stay blue and a lit top to stay warm, not enough for a piece
// to arrive brown, which is what the unbounded version kept doing at the thin
// edges where the division by the coverage runs away.
export const CLOUD_CHROMA = [0.72, 1.32];

/**
 * Forces a synthesised coverage and colour to describe a cloud.
 *
 * The patch search completes four numbers per texel — one coverage and three
 * colours — and nothing in it knows they belong together. Over a ribbon three
 * degrees wide that hardly matters. Over a hole ten degrees wide, where the
 * whole silhouette of a monolith has to be invented, it matters completely: the
 * harmonic correction that pins the fill to its rim moves the coverage and the
 * colour by different amounts, and a texel that comes back carrying half a
 * cloud and none of its light is not weather, it is a hole in the sky. Which is
 * exactly what it looked like — the silhouette of the monolith, in dark grey.
 *
 * So the pair is settled before it is used. The colour a cloud has is near
 * white and near the level the reference's own cloud has at that height; a pair
 * that cannot be read that way loses its coverage rather than gaining light,
 * and a texel with no light in it becomes clear sky, which is the only other
 * thing it can honestly be.
 *
 * @returns {number} the coverage that survives; the colour is written to `out`
 */
export function settleCloud(alphaIn, r, g, b, want, out) {
  let a = Math.min(1, Math.max(0, alphaIn));
  const luma = a > 1e-4 ? (0.2126 * r + 0.7152 * g + 0.0722 * b) / a : 0;
  if (a <= 0.02 || luma <= 1e-4) {
    out[0] = 0; out[1] = 0; out[2] = 0;
    return 0;
  }
  let scale = 1;
  const lo = 0.55 * want;
  const hi = 2.0 * want;
  if (luma < lo) { a *= smoothstep(0, lo, luma); scale = lo / luma; }
  else if (luma > hi) scale = hi / luma;
  const level = luma * scale;
  const unit = [r / alphaIn, g / alphaIn, b / alphaIn];
  for (let c = 0; c < 3; c++) {
    const ratio = Math.min(CLOUD_CHROMA[1], Math.max(CLOUD_CHROMA[0], unit[c] / luma));
    out[c] = level * ratio * a;
  }
  return a;
}

export function shadeAt(gx, gy, alpha, s) {
  // The coverage gradient points into the cloud, so the outward normal is its
  // negative in the plane; the third component is what faces the eye.
  let nx = -gx * NORMAL_SLOPE;
  let ny = -gy * NORMAL_SLOPE;
  let nz = 1;
  const len = Math.hypot(nx, ny, nz);
  nx /= len; ny /= len; nz /= len;
  const lambert = Math.max(0, nx * s[0] + ny * s[1] + nz * s[2]);
  const forward = Math.max(0, s[2]);
  const rim = (1 - Math.min(1, alpha)) ** 2;
  return SHADE_AMBIENT + SHADE_DIFFUSE * lambert + SHADE_FORWARD * forward * forward * (0.35 + rim);
}

/**
 * Splits the reference sky into the sky behind and the cloud in front.
 *
 * Exact by construction: colour is stored premultiplied and as the difference
 * from the clear sky, so recomposing over the same clear sky returns the
 * reference pixel unchanged, whatever the coverage estimate did. That is what
 * lets the extension of the sector meet the sector without a seam.
 */
export function separateCloud({
  radiance, covered, width, height, elevationOf, azimuthOf, model, modelPlain, sun, sunAngles,
}) {
  const alpha = new Float32Array(width * height);
  const colour = new Float32Array(width * height * 3);
  const clear = [0, 0, 0];
  const plain = [0, 0, 0];

  // What counts as fully covered at a given height: the sky between the clouds
  // is the bluest thing at that elevation, an opaque cloud the least blue.
  const rows = height;
  const blueClear = new Float32Array(rows);
  const blueCloud = new Float32Array(rows);
  for (let y = 0; y < rows; y++) {
    const list = [];
    for (let x = 0; x < width; x++) {
      if (!covered[y * width + x]) continue;
      const o = (y * width + x) * 3;
      const r = radiance[o]; const b = radiance[o + 2];
      if (r + b <= 1e-6) continue;
      list.push((b - r) / (b + r));
    }
    if (list.length < 16) { blueClear[y] = 0.5; blueCloud[y] = 0.1; continue; }
    list.sort((a, b) => a - b);
    blueCloud[y] = list[Math.floor(list.length * 0.03)];
    blueClear[y] = list[Math.floor(list.length * 0.97)];
  }

  for (let y = 0; y < height; y++) {
    const elevation = elevationOf(y);
    // A little smoothing down the rows: the two quantiles are noisy where the
    // reference only shows a sliver of sky.
    let bc = 0; let bk = 0; let n = 0;
    for (let k = -6; k <= 6; k++) {
      const yy = Math.min(height - 1, Math.max(0, y + k));
      bc += blueCloud[yy]; bk += blueClear[yy]; n++;
    }
    bc /= n; bk /= n;
    const span = Math.max(0.05, bk - bc);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = i * 3;
      // Outside the framing there is no measurement to separate, and a
      // separation run on nothing produces a coverage of nothing over a colour
      // of minus the sky, which is where the brown came from.
      if (!covered[i]) continue;
      const azimuth = azimuthOf(x);
      clearSkyAt(model, sunAngles, elevation, azimuth, clear);
      clearSkyAt(modelPlain || model, sunAngles, elevation, azimuth, plain);

      const r = radiance[o]; const g = radiance[o + 1]; const b = radiance[o + 2];
      const blue = (r + b) > 1e-6 ? (b - r) / (b + r) : 0.5;
      const yTarget = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      // Measured against the physical sky, deliberately, and not against the
      // one the local residual corrected. The residual's whole job is to make
      // the model agree with the reference wherever the reference reaches, and
      // it agrees with the dark grey corner of the reference too — after which
      // that corner is exactly as bright as the sky is supposed to be there,
      // the brightness test passes, the saturation test sees no blue in it, and
      // the darkest, emptiest sky in the whole reference is classified as solid
      // cloud. The library then carries it away as material and the far field
      // lays banks of it along the edge of the framing.
      const yClear = 0.2126 * plain[0] + 0.7152 * plain[1] + 0.0722 * plain[2];
      const lit = yTarget / Math.max(1e-4, yClear);
      // Loss of blue says cloud, but only where there is light to lose it in.
      // The reference darkens its own top corners, and darkened sky is also
      // desaturated sky: read on colour alone those corners came back as solid
      // cloud, and the far field then put cumulus across the whole of the sky
      // above twenty degrees, where the reference has deep blue.
      const bySaturation = Math.min(1, Math.max(0, (bk - blue) / span)) * smoothstep(0.55, 0.95, lit);
      const byBrightness = Math.min(1, Math.max(0, (lit - 1.05) / 1.6));
      // A floor under the estimate. Without it every texel of clear sky comes
      // back carrying a tenth of a cloud, and a tenth of a cloud has a colour:
      // the clear sky of the place it was cut from. Laid down elsewhere as a
      // thin veil that is a disc of the wrong blue, with an edge on it.
      const raw = Math.min(1, Math.max(bySaturation, byBrightness));
      const a = Math.max(0, (raw - COVER_FLOOR) / (1 - COVER_FLOOR));
      alpha[i] = a;
      for (let c = 0; c < 3; c++) colour[o + c] = radiance[o + c] - clear[c] * (1 - a);
    }
  }
  return { alpha, colour };
}

/**
 * How bright the reference's own cloud is at each height, as unit colour: the
 * level a piece has to arrive at when it is laid down somewhere else.
 *
 * Without it a piece cut from a sunlit top and put down low arrives as a sunlit
 * top, brighter than everything around it and lit from a direction the shading
 * has already accounted for twice.
 */
export function cloudLevelProfile({
  alpha, colour, covered, width, height, elevationOf, minSamples = 200,
}) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    let sum = 0; let n = 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!covered[i] || alpha[i] < 0.5) continue;
      const o = i * 3;
      sum += (0.2126 * colour[o] + 0.7152 * colour[o + 1] + 0.0722 * colour[o + 2]) / alpha[i];
      n++;
    }
    if (n < minSamples) continue;
    rows.push({ elevation: elevationOf(y), level: sum / n });
  }
  rows.sort((a, b) => a.elevation - b.elevation);
  if (!rows.length) return null;
  const span = Math.max(1, Math.round(rows.length * 6 / 60));
  const smooth = rows.map((r, i) => {
    let sum = 0; let n = 0;
    for (let k = -span; k <= span; k++) {
      const j = Math.min(rows.length - 1, Math.max(0, i + k));
      sum += rows[j].level; n++;
    }
    return { elevation: r.elevation, level: sum / n };
  });
  return (elevation) => {
    if (elevation <= smooth[0].elevation) return smooth[0].level;
    if (elevation >= smooth[smooth.length - 1].elevation) return smooth[smooth.length - 1].level;
    for (let i = 1; i < smooth.length; i++) {
      if (smooth[i].elevation < elevation) continue;
      const a = smooth[i - 1]; const b = smooth[i];
      const t = (elevation - a.elevation) / Math.max(1e-6, b.elevation - a.elevation);
      return a.level * (1 - t) + b.level * t;
    }
    return smooth[smooth.length - 1].level;
  };
}

/**
 * Cuts the separated cloud into pieces worth laying down elsewhere.
 *
 * A piece is kept when it carries cloud over most of its area, when its
 * coverage actually varies — which is what distinguishes a cumulus from a flat
 * haze — and, above all, when its coverage falls away at its own rim.
 *
 * That last one is new and it is the whole of the ring problem. A piece cut
 * through the middle of a solid cumulus has cloud right up to its edges; laid
 * down and faded out radially so its edges do not show, it becomes a disc with
 * a halo, and where the middle of it happened to be clear sky, a ring. A piece
 * whose rim is already sky has a shape of its own, and can be laid down with
 * its own coverage as its matte and no radial fade worth speaking of.
 */
export function buildPatchLibrary({
  alpha, colour, material, width, height, elevationOf, azimuthOf, sun, degPerTexel,
  sizes = [96, 150, 220, 320], stride = 0.42, minCover = 0.24, maxCover = 0.90,
  maxRim = 0.30, keep = 260,
}) {
  const bySize = new Map();
  for (const size of sizes) {
    const step = Math.max(8, Math.round(size * stride));
    const found = [];
    for (let y = 0; y + size <= height; y += step) {
      for (let x = 0; x + size <= width; x += step) {
        // Only whole pieces of the reference. The library is the one place the
        // material may come from, and material means photograph: a piece with
        // any synthesised texel in it would be laid down all over the sphere as
        // if it had been measured.
        let whole = true;
        for (let j = 0; j < size && whole; j += 2) {
          for (let i = 0; i < size; i += 2) {
            if (!material[(y + j) * width + x + i]) { whole = false; break; }
          }
        }
        if (!whole) continue;
        if (!material[(y + size - 1) * width + x + size - 1]) continue;

        const rimBand = Math.max(2, Math.round(size * 0.12));
        let sum = 0; let sum2 = 0; let n = 0;
        let rim = 0; let rimN = 0;
        let core = 0; let coreN = 0;
        let level = 0; let levelN = 0;
        for (let j = 0; j < size; j += 3) {
          for (let i = 0; i < size; i += 3) {
            const o = (y + j) * width + x + i;
            const a = alpha[o];
            sum += a; sum2 += a * a; n++;
            const edge = Math.min(i, j, size - 1 - i, size - 1 - j);
            if (edge < rimBand) { rim += a; rimN++; }
            else if (edge > size * 0.3) { core += a; coreN++; }
            if (a >= 0.5) {
              level += (0.2126 * colour[o * 3] + 0.7152 * colour[o * 3 + 1]
                + 0.0722 * colour[o * 3 + 2]) / a;
              levelN++;
            }
          }
        }
        const mean = sum / n;
        const variance = Math.max(0, sum2 / n - mean * mean);
        if (mean < minCover || mean > maxCover) continue;
        if (variance < 0.014) continue;
        const rimMean = rimN ? rim / rimN : 1;
        const coreMean = coreN ? core / coreN : 0;
        if (coreMean < 0.45) continue;
        const cy = elevationOf(y + size / 2);
        const cx = azimuthOf(x + size / 2);
        found.push({
          x, y, size, mean, variance, rim: rimMean, core: coreMean,
          level: levelN ? level / levelN : 0,
          elevation: cy,
          azimuth: cx,
          // Degrees of sky the piece covers, which is not its width in texels:
          // an equirect stretches a degree of azimuth by the secant of the
          // height it is at, and a piece cut high up is narrower than it looks.
          degreesX: size * degPerTexel * Math.cos(cy * DEG),
          degreesY: size * degPerTexel,
          sun: sunInLocalFrame(cy, cx, sun),
        });
      }
    }
    // Free rimmed pieces first, and only if a size class cannot fill itself
    // that way is the rim allowed to carry cloud. The largest pieces are the
    // ones that run out, because the reference does not contain many whole
    // cumuli twelve degrees across with sky all round them.
    let chosen = found.filter((p) => p.rim <= maxRim);
    if (chosen.length < 14) chosen = found.filter((p) => p.rim <= maxRim * 1.8);
    if (chosen.length < 8) chosen = found;
    chosen.sort((a, b) => b.variance - a.variance);
    bySize.set(size, chosen.slice(0, Math.max(10, Math.round(keep / sizes.length))));
  }
  const patches = [];
  for (const list of bySize.values()) patches.push(...list);
  return patches;
}

/**
 * Mean coverage of the reference against height, which is the statistic the
 * built sky has to reproduce: cumulus in a band, thinning upwards, and haze
 * along the horizon.
 */
export function coverageProfile({ alpha, material, width, height, elevationOf, minSamples = 120 }) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    let sum = 0; let n = 0;
    for (let x = 0; x < width; x++) {
      if (material && !material[y * width + x]) continue;
      sum += alpha[y * width + x]; n++;
    }
    if (n < minSamples) continue;
    rows.push({ elevation: elevationOf(y), cover: sum / n });
  }
  rows.sort((a, b) => a.elevation - b.elevation);
  // Smoothed over five degrees: the reference shows a narrow slice of sky at
  // its lowest rows and one cloud in it moves the whole row.
  const span = Math.max(1, Math.round(rows.length * 5 / 60));
  return rows.map((r, i) => {
    let sum = 0; let n = 0;
    for (let k = -span; k <= span; k++) {
      const j = Math.min(rows.length - 1, Math.max(0, i + k));
      sum += rows[j].cover; n++;
    }
    return { elevation: r.elevation, cover: sum / n };
  });
}

function azimuthToColumn(azimuth, width) {
  return Math.round(((azimuth / 360 + 0.25) % 1 + 1) % 1 * width);
}

/**
 * Lays the library across the whole sphere as weather rather than as confetti.
 *
 * @param {Array} anchors  places where a mass has to straddle the edge of the
 *   photographed sector, read off the cloud the reference itself has there
 * @returns {{alpha: Float32Array, colour: Float32Array}} premultiplied layer
 */
export function stampCloudField({
  width, height, rowStart, rowEnd, elevationOf, azimuthOf,
  library, alpha: srcAlpha, colour: srcColour, srcWidth, srcHeight,
  sun, sunAngles, model, profile, cloudLevel, anchors = [], forbid = [],
  seed = 0x51ce, maxSystems = 30, strays = 90, veils = 40,
}) {
  const random = makeRandom(seed);
  const rows = rowEnd - rowStart;
  const outAlpha = new Float32Array(width * rows);
  const outColour = new Float32Array(width * rows * 3);

  // Coverage the reference carries, as a function of height, smoothed and
  // extended: above what the framing shows the band thins into high veil.
  const coverAt = (elevation) => {
    if (!profile.length) return 0.3;
    let below = profile[0]; let above = profile[profile.length - 1];
    for (const p of profile) {
      if (p.elevation <= elevation && p.elevation >= below.elevation) below = p;
      if (p.elevation >= elevation && p.elevation <= above.elevation) above = p;
    }
    if (elevation <= profile[0].elevation) return profile[0].cover;
    if (elevation >= above.elevation && elevation > profile[profile.length - 1].elevation) {
      // Past the top of the framing the cumulus band closes and the sky opens,
      // then thin veil takes over towards the zenith.
      const top = profile[profile.length - 1];
      return top.cover * Math.exp(-(elevation - top.elevation) / 22);
    }
    const t = above.elevation > below.elevation
      ? (elevation - below.elevation) / (above.elevation - below.elevation) : 0;
    return below.cover * (1 - t) + above.cover * t;
  };

  const bySize = [...library].sort((a, b) => a.degreesY - b.degreesY);
  const pick = (lo, hi, rnd = random) => {
    const from = Math.floor(lo * bySize.length);
    const to = Math.max(from + 1, Math.floor(hi * bySize.length));
    return bySize[Math.min(bySize.length - 1, from + Math.floor(rnd() * (to - from)))];
  };
  const thin = library.filter((p) => p.mean >= 0.30 && p.mean < 0.72);
  if (!library.length) throw new Error('cloud library too small');

  const makeJob = (patch, {
    elevation, azimuth, scale = 1, opacity = 1, gain = 1, rotation = 0, flat = 1, veil = false,
  }) => ({
    elevation,
    azimuth,
    radiusX: Math.max(1.6, patch.degreesX * 0.5 * scale),
    radiusY: Math.max(1.4, patch.degreesY * 0.5 * scale * flat),
    patch,
    gain,
    opacity,
    rotation,
    veil,
  });

  // Places the reference says are empty, and the reach a piece needs to keep
  // away from them. Measured in degrees on the sphere, so a piece high up is
  // judged by the sky it covers and not by the texels it spans.
  const keepsClear = (job) => {
    if (job.veil) return true;
    for (const f of forbid) {
      let dAz = job.azimuth - f.azimuth;
      while (dAz > 180) dAz -= 360;
      while (dAz < -180) dAz += 360;
      dAz *= Math.cos(Math.min(80, Math.abs(f.elevation)) * DEG);
      const dEl = job.elevation - f.elevation;
      // The body of the piece, not its whole reach. A bank is allowed to fray
      // into a place the reference shows empty; what it may not do is sit on it.
      if (Math.abs(dAz) < job.radiusX * 0.8 + f.radius * 0.5
        && Math.abs(dEl) < job.radiusY * 0.8 + f.radius * 0.5) return false;
    }
    return true;
  };

  // ------------------------------------------------------------- the layout
  const jobs = [];

  // A bank of cumulus: one flat base at a common height, a row of turrets
  // standing on it at uneven heights, and a fringe that frays out at both ends.
  //
  // It is built by filling rather than by scattering, and that is the whole
  // difference between weather and confetti. Pieces dropped at random inside a
  // region thirty degrees across, at four to eight degrees each, land apart from
  // one another however many of them there are: what comes out is a spray of
  // separate blobs. Pieces laid on a grid at half their own width overlap by
  // construction, and what comes out is one mass with a torn edge — which is
  // what the reference has, and what a piece stretched to thirty degrees can
  // never be, because stretching it is the one thing that destroys the material.
  const planSystem = (centreAzimuth, options = {}, draw = random) => {
    const built = [];
    const base = options.base ?? (1.5 + draw() * 7.5);
    const depth = options.depth ?? (12 + draw() ** 1.1 * 26);
    // The grain of this bank: how big the pieces it is made of are, which is
    // what decides how close together the columns have to stand.
    //
    // A bank with somewhere it has to fit is told its grain instead of drawing
    // one. Left to itself the planner takes the widest pieces in the library and
    // may double them again, and four pieces ten degrees across are not a mass
    // with a torn edge — they are four blobs, spread over twice the bearing they
    // were asked for, and the first of them that falls inside a margin the
    // sector keeps clear takes a quarter of the bank away with it.
    const fine = options.piece ? Math.max(2.6, options.piece) : 0;
    const sample = fine ? pick(0, 0.5, draw) : pick(0.45, 1, draw);
    const grain = fine ? fine / Math.max(0.4, sample.degreesX) : 0.9 + draw() * 1.0;
    const pieceX = Math.max(2.6, sample.degreesX * grain);
    const pieceY = Math.max(2.4, sample.degreesY * grain);
    const colStep = pieceX * 0.5;
    const columns = options.spread
      ? Math.max(4, Math.min(15, Math.round(options.spread / colStep) + 1))
      : 5 + Math.round(draw() * 6);
    const spread = colStep * (columns - 1);
    // How high the bank stands at each column: two waves out of phase, times a
    // shoulder that brings both ends down. An even top reads as a lid.
    const p1 = draw() * Math.PI * 2;
    const p2 = draw() * Math.PI * 2;
    const k2 = 2 + Math.floor(draw() * 3);
    for (let ci = 0; ci < columns; ci++) {
      const s = columns > 1 ? ci / (columns - 1) : 0.5;
      const shoulder = 0.3 + 0.7 * Math.sin(Math.PI * s) ** 0.55;
      const wave = 0.5 + 0.32 * Math.sin(p1 + s * Math.PI * 2) + 0.18 * Math.sin(p2 + s * Math.PI * k2);
      const height = Math.max(pieceY * 0.55, depth * shoulder * (0.5 + 0.85 * wave));
      const u = (s - 0.5) * spread + (draw() * 2 - 1) * colStep * 0.3;
      const stack = Math.max(1, Math.round(height / (pieceY * 0.45)));
      for (let j = 0; j < stack; j++) {
        const t = stack > 1 ? j / (stack - 1) : 0;
        const elevation = base + height * (j + 0.35) / stack;
        // Big through the body, smaller at the top of a turret and at the ends.
        const taper = (1 - 0.42 * t) * (0.62 + 0.38 * shoulder);
        const patch = pick(Math.max(0, 0.9 * taper - 0.25), Math.min(1, 0.9 * taper + 0.25), draw);
        const scale = (pieceX / Math.max(0.4, patch.degreesX)) * taper * (0.86 + draw() * 0.32);
        // The base of a bank is a flat grey shelf, the top of it is where the
        // light is. The gain carries that; the shading carries the direction.
        const belly = smoothstep(0.30, 0, t) * smoothstep(pieceY, 0, elevation - base);
        built.push(makeJob(patch, {
          elevation,
          azimuth: centreAzimuth + (u + (draw() * 2 - 1) * colStep * 0.2)
            / Math.max(0.15, Math.cos(elevation * DEG)),
          scale,
          flat: 1 - 0.30 * belly,
          opacity: 0.86 + draw() * 0.34,
          gain: (0.95 + draw() * 0.14) * (1 - 0.17 * belly),
          rotation: (draw() * 2 - 1) * 8,
        }));
      }
    }
    // A tower: one column carrying half again the height of the bank it stands
    // on. The reference has them and they are what gives a sky a scale.
    const towers = options.towers ?? (draw() < 0.62 ? 1 : 0);
    for (let k = 0; k < towers; k++) {
      const u = (draw() * 2 - 1) * spread * 0.28;
      const top = depth * (1.2 + draw() * 0.7);
      const steps = 3 + Math.round(draw() * 2);
      for (let j = 0; j < steps; j++) {
        const t = (j + 0.5) / steps;
        const elevation = base + depth * 0.5 + (top - depth * 0.5) * t;
        const patch = pick(Math.max(0, 0.6 - t * 0.4), Math.max(0.25, 0.95 - t * 0.45), draw);
        const width = pieceX * (0.92 - 0.4 * t);
        built.push(makeJob(patch, {
          elevation,
          azimuth: centreAzimuth + (u + (draw() * 2 - 1) * colStep * 0.25)
            / Math.max(0.15, Math.cos(elevation * DEG)),
          scale: (width / Math.max(0.4, patch.degreesX)) * (0.88 + draw() * 0.3),
          opacity: 0.86 + draw() * 0.3,
          gain: 1.0 + draw() * 0.13,
          rotation: (draw() * 2 - 1) * 9,
        }));
      }
    }
    return built;
  };

  // Cloud the reference has along the edge of its own framing has to carry on
  // past it. These are laid first and are never rejected: whatever else the
  // sky ends up with, the material has to cross that line rather than stop
  // along it, or the edge of the sector is a line anybody can trace.
  for (const a of anchors) {
    // Each from a stream of its own, keyed to where it stands.
    //
    // Drawn from the shared one, an anchor that needs twenty pieces instead of
    // five moves every draw that comes after it, and the whole far field is
    // redrawn by a change meant to touch one bearing. What that costs is not the
    // layout — one layout is as good as another — it is the ability to measure
    // anything at all: two bakes either side of such a change differ everywhere,
    // and the reading that was supposed to say what the change did says what the
    // draw did instead.
    const built = planSystem(a.azimuth, {
      spread: a.spread ?? 22,
      base: a.base,
      depth: a.depth ?? 16,
      towers: a.towers ?? 0,
      piece: a.piece,
    }, makeRandom((seed ^ Math.imul(Math.round(a.azimuth * 8) + 4096, 0x9e3779b1)) >>> 0));
    jobs.push(...built.filter(keepsClear));
  }

  // What is already covered, kept on a coarse raster so a system can be offered
  // against the weather the reference actually carries at that height.
  const PW = 720;
  const PH = 360;
  const draft = new Float32Array(PW * PH);
  // The plan lays the piece down for real, on a grid half a degree across.
  //
  // Estimating instead — the mean coverage of the piece times a radial falloff
  // — is off by nearly a factor of two, because the matte is the piece's own
  // coverage with its thin tail cut off and not a smooth disc of its average.
  // The plan then believed it had filled the sky long before it had, and
  // stopped at six banks in a sky that wanted twenty.
  const paint = (job) => {
    const { patch } = job;
    const half = patch.size / 2;
    const cosRow = Math.cos(job.rotation * DEG);
    const sinRow = Math.sin(job.rotation * DEG);
    const texelsPerDegreeX = patch.size / (2 * job.radiusX);
    const texelsPerDegreeY = patch.size / (2 * job.radiusY);
    const reach = Math.max(job.radiusX, job.radiusY);
    const y0 = Math.max(0, Math.floor((90 - (job.elevation + job.radiusY)) / 180 * PH));
    const y1 = Math.min(PH - 1, Math.ceil((90 - (job.elevation - job.radiusY)) / 180 * PH));
    for (let y = y0; y <= y1; y++) {
      const elevation = 90 - (y + 0.5) / PH * 180;
      const secant = 1 / Math.max(0.10, Math.cos(Math.min(88, Math.abs(elevation)) * DEG));
      const span = Math.ceil(Math.min(180, reach * secant) / 360 * PW);
      const centre = Math.round(((job.azimuth / 360 + 0.25) % 1 + 1) % 1 * PW);
      for (let k = -span; k <= span; k++) {
        const x = ((centre + k) % PW + PW) % PW;
        let az = ((x + 0.5) / PW - 0.25) * 360 - job.azimuth;
        while (az > 180) az -= 360;
        while (az < -180) az += 360;
        const u = az / secant;
        const v = elevation - job.elevation;
        const ru = (u * cosRow + v * sinRow) / job.radiusX;
        const rv = (v * cosRow - u * sinRow) / job.radiusY;
        const r2 = ru * ru + rv * rv;
        if (r2 > 1) continue;
        const su = (u * cosRow + v * sinRow) * texelsPerDegreeX + half;
        const sv = half - (v * cosRow - u * sinRow) * texelsPerDegreeY;
        if (su < 1 || sv < 1 || su >= patch.size - 1 || sv >= patch.size - 1) continue;
        const src = srcAlpha[(patch.y + Math.round(sv)) * srcWidth + patch.x + Math.round(su)];
        if (src < 0.10) continue;
        const window = job.veil ? smoothstep(1.0, 0.5, Math.sqrt(r2))
          : smoothstep(1.0, 0.72, Math.sqrt(r2));
        const a = Math.min(1, Math.max(0, (src * job.opacity * window - 0.10) / 0.90));
        const o = y * PW + x;
        draft[o] = draft[o] * (1 - a) + a;
      }
    }
  };
  const bandCover = (lo, hi) => {
    const y0 = Math.max(0, Math.floor((90 - hi) / 180 * PH));
    const y1 = Math.min(PH - 1, Math.ceil((90 - lo) / 180 * PH));
    let sum = 0; let n = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = 0; x < PW; x++) { sum += draft[y * PW + x]; n++; }
    }
    return n ? sum / n : 0;
  };
  for (const job of jobs) paint(job);

  // How cloudy the reference is at each height, and the sky filled until it
  // carries the same at every one of them.
  //
  // Filled against the average over the whole band instead, it stops as soon as
  // the average is right, and the average is right long before the sky is: the
  // first banks all stand on the same low base, the bottom of the band fills to
  // twice what the reference carries there, the top of it stays at half, and
  // the arithmetic mean says the job is done. So the deficit is read band by
  // band, and each new bank is stood at whatever height is emptiest.
  const bands = [];
  for (let e = 2; e <= 30; e += 4) bands.push(e);
  const worstDeficit = () => bands
    .map((e) => ({ e, d: coverAt(e) - bandCover(e - 2, e + 2) }))
    .reduce((a, b) => (b.d > a.d ? b : a));
  const wantedCover = bands.reduce((t, e) => t + coverAt(e), 0) / bands.length;

  // Where the systems go. Not evenly: a sky with its banks at equal intervals
  // is as much of a machine as a sky with its blobs at equal intervals. The
  // bearing walks by a large irrational step, which spreads without repeating,
  // and is then knocked sideways by up to half a gap.
  let bearing = random() * 360;
  let placed = 0;
  for (let k = 0; k < maxSystems; k++) {
    const worst = worstDeficit();
    if (worst.d < 0.035) break;
    bearing += 137.507 + (random() * 2 - 1) * 26;
    const depth = 12 + random() ** 1.1 * 24;
    const base = Math.max(1, worst.e - depth * (0.22 + random() * 0.38));
    const built = planSystem(((bearing % 360) + 360) % 360 - 180, { base, depth })
      .filter(keepsClear);
    for (const job of built) { jobs.push(job); paint(job); }
    placed++;
  }

  // Fragments between the masses. Few, small, and drawn to the same band the
  // reference puts them in.
  const heights = [];
  {
    let total = 0;
    for (let e = -6; e <= 60; e += 1) {
      const w = coverAt(e) * Math.cos(Math.max(0, e) * DEG);
      heights.push({ e, w });
      total += w;
    }
    let acc = 0;
    for (const h of heights) { acc += h.w / total; h.cdf = acc; }
  }
  const drawElevation = () => {
    const u = random();
    for (const h of heights) if (u <= h.cdf) return h.e + random() - 0.5;
    return heights[heights.length - 1].e;
  };
  for (let k = 0; k < strays; k++) {
    const patch = pick(0, 0.5);
    const elevation = drawElevation();
    const job = makeJob(patch, {
      elevation,
      azimuth: random() * 360 - 180,
      scale: 0.45 + random() ** 1.5 * 0.75,
      opacity: 0.55 + random() * 0.5,
      gain: 0.92 + random() * 0.2,
      rotation: (random() * 2 - 1) * 12,
    });
    if (keepsClear(job)) jobs.push(job);
  }

  // High veil. Wide, faint, and kept well under the pole: a piece laid down at
  // eighty degrees is a piece laid across a circle a few degrees round, and
  // what the smoothing there does to it is a horizontal smear.
  for (let k = 0; k < veils; k++) {
    const patch = thin.length ? thin[Math.floor(random() * thin.length)] : pick(0.5, 1);
    jobs.push(makeJob(patch, {
      elevation: 24 + random() * 24,
      azimuth: random() * 360 - 180,
      scale: 1.8 + random() * 2.2,
      flat: 0.45,
      opacity: 0.05 + random() * 0.08,
      gain: 0.92 + random() * 0.18,
      rotation: (random() * 2 - 1) * 22,
      veil: true,
    }));
  }

  // Far first: a piece low in the sky is further away than a piece high in it,
  // so the high one goes over the top.
  jobs.sort((a, b) => a.elevation - b.elevation);

  // ------------------------------------------------------------ the stamping
  const gradient = (x, y) => {
    const x0 = Math.max(0, x - 1); const x1 = Math.min(srcWidth - 1, x + 1);
    const y0 = Math.max(0, y - 1); const y1 = Math.min(srcHeight - 1, y + 1);
    return [
      (srcAlpha[y * srcWidth + x1] - srcAlpha[y * srcWidth + x0]) * 0.5,
      -(srcAlpha[y1 * srcWidth + x] - srcAlpha[y0 * srcWidth + x]) * 0.5,
    ];
  };

  const clearDst = [0, 0, 0];
  const unit = [0, 0, 0];
  for (const job of jobs) {
    const { patch } = job;
    const half = patch.size / 2;
    const cosRow = Math.cos(job.rotation * DEG);
    const sinRow = Math.sin(job.rotation * DEG);
    // Source texels per degree of sky, one factor per axis, because the piece
    // was cut out of an equirect and is being laid back into one at a different
    // height.
    const texelsPerDegreeX = patch.size / (2 * job.radiusX);
    const texelsPerDegreeY = patch.size / (2 * job.radiusY);
    const reach = Math.max(job.radiusX, job.radiusY);
    // The level the piece has to arrive at, against the level it was cut with.
    const wantLevel = cloudLevel ? cloudLevel(job.elevation) : patch.level;
    const levelGain = patch.level > 1e-4
      ? Math.min(1.6, Math.max(0.62, wantLevel / patch.level)) : 1;

    const eLo = job.elevation - job.radiusY;
    const eHi = job.elevation + job.radiusY;
    for (let row = rowStart; row < rowEnd; row++) {
      const elevation = elevationOf(row);
      if (elevation < eLo || elevation > eHi) continue;
      const secant = 1 / Math.max(0.10, Math.cos(Math.min(88, Math.abs(elevation)) * DEG));
      const dAz = Math.min(180, reach * secant);
      const colCentre = azimuthToColumn(job.azimuth, width);
      const colSpan = Math.ceil(dAz / 360 * width);
      for (let k = -colSpan; k <= colSpan; k++) {
        const col = ((colCentre + k) % width + width) % width;
        let azimuth = azimuthOf(col) - job.azimuth;
        while (azimuth > 180) azimuth -= 360;
        while (azimuth < -180) azimuth += 360;
        // Local tangent plane: a degree across is a degree across, whatever
        // the equirect does to it.
        const u = azimuth / secant;
        const v = elevation - job.elevation;
        const ru = (u * cosRow + v * sinRow) / job.radiusX;
        const rv = (v * cosRow - u * sinRow) / job.radiusY;
        const r2 = ru * ru + rv * rv;
        if (r2 > 1) continue;
        const su = (u * cosRow + v * sinRow) * texelsPerDegreeX + half;
        const sv = half - (v * cosRow - u * sinRow) * texelsPerDegreeY;
        if (su < 1 || sv < 1 || su >= patch.size - 1 || sv >= patch.size - 1) continue;

        const sx = patch.x + su;
        const sy = patch.y + sv;
        const x0 = Math.floor(sx); const y0 = Math.floor(sy);
        const fx = sx - x0; const fy = sy - y0;
        const x1 = Math.min(srcWidth - 1, x0 + 1);
        const y1 = Math.min(srcHeight - 1, y0 + 1);
        const w00 = (1 - fx) * (1 - fy); const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy; const w11 = fx * fy;
        const a = srcAlpha[y0 * srcWidth + x0] * w00 + srcAlpha[y0 * srcWidth + x1] * w10
          + srcAlpha[y1 * srcWidth + x0] * w01 + srcAlpha[y1 * srcWidth + x1] * w11;
        // A thin tail of coverage is where the division below runs away and
        // where the sky of the place the piece was cut from is still in the
        // colour. Nothing is carried out of it.
        if (a < 0.10) continue;

        // The matte is the piece's own coverage, not a disc.
        //
        // A radial fade is what turned every instance into a disc with a halo,
        // and where the middle of one happened to be clear sky, into a ring.
        // The pieces are now chosen to have sky at their rims, so the coverage
        // already arrives at nothing there and the only thing left for the
        // window to do is guard the last few per cent of the rectangle against
        // a piece that does not.
        const window = job.veil ? smoothstep(1.0, 0.5, Math.sqrt(r2))
          : smoothstep(1.0, 0.72, Math.sqrt(r2));
        // The tail is cut rather than faded. What survives a fade is a skirt of
        // coverage a few per cent deep spread over the whole rectangle, and a
        // few per cent of coverage still carries colour: laid down often enough
        // it is a haze in the shape of an ellipse, with an edge where the fade
        // finally reaches nothing. Cut, there is no skirt and no edge.
        const alphaOut = Math.min(1, Math.max(0, (a * job.opacity * window - 0.10) / 0.90));
        if (alphaOut <= 0.004) continue;

        const [gx, gy] = gradient(Math.round(sx), Math.round(sy));
        const sourceShade = shadeAt(gx, gy, a, patch.sun);
        const localSun = sunInLocalFrame(elevation, azimuthOf(col), sun);
        const targetShade = shadeAt(
          gx * cosRow - gy * sinRow, gx * sinRow + gy * cosRow, a, localSun,
        );
        const relight = Math.min(2.1, Math.max(0.45, targetShade / Math.max(0.05, sourceShade)))
          * job.gain * levelGain;

        const o = (row - rowStart) * width + col;
        clearSkyAt(model, sunAngles, elevation, azimuthOf(col), clearDst);
        const so = (y0 * srcWidth + x0) * 3;
        const so1 = (y0 * srcWidth + x1) * 3;
        const so2 = (y1 * srcWidth + x0) * 3;
        const so3 = (y1 * srcWidth + x1) * 3;
        let luma = 0;
        for (let c = 0; c < 3; c++) {
          const colourSample = srcColour[so + c] * w00 + srcColour[so1 + c] * w10
            + srcColour[so2 + c] * w01 + srcColour[so3 + c] * w11;
          // The stored colour is premultiplied by the coverage it came with, so
          // it is renormalised before it is given the coverage it will have.
          // Never negative: a piece of cloud can only take the sky's place, it
          // cannot subtract light from it.
          unit[c] = Math.min(14, Math.max(0, colourSample / a));
        }
        luma = 0.2126 * unit[0] + 0.7152 * unit[1] + 0.0722 * unit[2];
        // Cloud is white with a blue shadow, and nothing else. Anything the
        // division above produced outside that is arithmetic, not weather:
        // unclamped it left brown patches wherever enough thin edges landed on
        // top of one another.
        if (luma > 1e-4) {
          for (let c = 0; c < 3; c++) {
            unit[c] = luma * Math.min(CLOUD_CHROMA[1], Math.max(CLOUD_CHROMA[0], unit[c] / luma));
          }
          // And green lies between red and blue. The bound above is per channel
          // and around the mean, so it lets red to the top of its range and
          // green to the bottom of its at the same time — which is magenta, a
          // colour that appears nowhere between this sky's clear blue and its
          // warm white, and which arrived as a dark speck with red in it on a
          // cumulus behind the second monolith.
          unit[1] = Math.min(Math.max(unit[1], Math.min(unit[0], unit[2])),
            Math.max(unit[0], unit[2]));
        }
        const keep = 1 - alphaOut;
        for (let c = 0; c < 3; c++) {
          outColour[o * 3 + c] = outColour[o * 3 + c] * keep + unit[c] * relight * alphaOut;
        }
        outAlpha[o] = outAlpha[o] * keep + alphaOut;
      }
    }
  }

  for (let row = rowStart; row < rowEnd; row++) {
    const elevation = elevationOf(row);
    const t = smoothstep(POLE_SMOOTH_FROM, POLE_SMOOTH_TO, elevation);
    if (t <= 0) continue;
    const base = (row - rowStart) * width;
    let meanA = 0;
    const meanC = [0, 0, 0];
    for (let col = 0; col < width; col++) {
      meanA += outAlpha[base + col];
      for (let c = 0; c < 3; c++) meanC[c] += outColour[(base + col) * 3 + c];
    }
    meanA /= width;
    for (let c = 0; c < 3; c++) meanC[c] /= width;
    for (let col = 0; col < width; col++) {
      outAlpha[base + col] += (meanA - outAlpha[base + col]) * t;
      for (let c = 0; c < 3; c++) {
        outColour[(base + col) * 3 + c] += (meanC[c] - outColour[(base + col) * 3 + c]) * t;
      }
    }
  }

  // What was actually laid down, band by band, so the plan can be read against
  // the weather it was asked to reproduce rather than believed.
  const delivered = [];
  for (let e = 2; e <= 30; e += 4) {
    let sum = 0; let n = 0;
    for (let row = rowStart; row < rowEnd; row++) {
      const elevation = elevationOf(row);
      if (Math.abs(elevation - e) > 2) continue;
      for (let col = 0; col < width; col++) { sum += outAlpha[(row - rowStart) * width + col]; n++; }
    }
    if (n) delivered.push({ elevation: e, cover: sum / n, wanted: coverAt(e) });
  }

  return {
    alpha: outAlpha,
    colour: outColour,
    instances: jobs.length,
    systems: placed,
    wantedCover,
    delivered,
  };
}
