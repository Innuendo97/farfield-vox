import { luminance } from './plate.mjs';

// LIFTING THE CLOUD OFF THE SKY IT WAS PHOTOGRAPHED AGAINST.
//
// The model is the only one there is: a texel of the plate is a mixture of the
// sky behind it and the cloud in front of it, in linear light,
//
//   C = a·F + (1 − a)·S
//
// with S known (see sky-field.mjs) and both a and F unknown. Three numbers
// observed, four wanted — so one thing has to be assumed, and WHICH thing is
// the whole design.
//
// What is assumed here is the cloud's CHROMATICITY, not its brightness. Write
// F = f·m with m a fixed unit colour and f free per texel, and the model
// becomes linear in two unknowns:
//
//   C = (a·f)·m + (1 − a)·S
//
// Three equations, two unknowns, solved in least squares at every texel. The
// assumption costs the fringe nothing, because what varies most across a
// backlit cumulus is exactly the free unknown — a rim is the same white as a
// belly, twenty times brighter — while what is held fixed is the part that
// barely moves. Assuming the brightness instead, which is what a threshold on
// luminance does, throws away the drama and keeps the error.
//
// WHY THE SOLVE IS WEIGHTED BY THE SKY. Dividing each channel by the sky's own
// value there turns the system into a straight line fit: with p = m/S and
// q = (C − S)/S the model is q = f·p − a, so the cloud's brightness is a slope
// and its COVERAGE IS AN INTERCEPT. Every channel then carries the same share
// of the argument regardless of how blue the sky is, which is what stops the
// blue channel — the largest number in a sky — from owning the answer.
//
// AND WHY A PLATE IS SMOOTHED FIRST. An intercept read from three points that
// nearly line up amplifies what it is read from: measured on these plates, the
// grain of the photograph arrives in the coverage at about one and eight tenths
// its own size. Coverage is the one quantity in this chain worth spending
// resolution on, and it is cheap to buy — a plate samples a twentieth of a
// degree and a cloud has nothing in it at that scale — so a blur of one texel
// costs the fringe nothing and takes three quarters of the amplified grain out.
//
// WHAT COLOUR CANNOT ANSWER, AND WHO ANSWERS IT INSTEAD. A cumulus belly is
// lit by the sky and by nothing else, so it is BLUE, and blue of very nearly
// the sky's own chromaticity: by colour alone an opaque belly and a hole with
// sky behind it are the same measurement. No matting arithmetic can separate
// them, and one that pretends to returns half coverage through the middle of a
// solid body — a cumulus you can see the dome through. The separation is
// TOPOLOGICAL: a region enclosed by cloud on every side is behind cloud. So
// what is certainly cloud is masked, its holes are filled, the result is eroded
// well inside its own rim, and everything that survives is held opaque — with
// the hold ramped over the erosion so that nothing anywhere has an edge.
//
// AND ONE BOUND THAT NEEDS NO ASSUMPTION AT ALL. A cloud emits no negative
// light, so from C = a·F + (1 − a)·S and F ≥ 0 it follows in every channel that
//
//   a  ≥  1 − C_c / S_c
//
// which is worth stating because a backlit tower's belly is DARKER than the sky
// beside it — that is what backlit means — and the darker it is the tighter the
// bound. It costs a division, it is exact rather than fitted, and it holds
// whatever the material is doing: on the tower plate it is what takes the body
// from a third of coverage to two thirds before any topology is consulted, and
// from there the mask closes over the rest.
//
// AND THE COLOUR IS THE EXACT UNPREMULTIPLY. Not the least squares projection:
// once the coverage is known, C − (1 − a)·S is the cloud's own premultiplied
// colour with the sky's share taken out and nothing else touched, so a belly
// stays the blue-grey it is and a rim stays the warm white it is. It is also
// the one expression that puts the plate back exactly when composited over the
// sky it came from, which is what makes contamination measurable rather than
// arguable.

/** A separable Gaussian, in place of a full convolution, on an interleaved image. */
export function blur(src, width, height, channels, sigma) {
  if (sigma <= 0) return src;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp(-0.5 * ((i / sigma) ** 2));
    sum += kernel[i + radius];
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const pass = (from, to, along) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < channels; c++) {
          let v = 0;
          for (let k = -radius; k <= radius; k++) {
            const sx = along ? Math.min(width - 1, Math.max(0, x + k)) : x;
            const sy = along ? y : Math.min(height - 1, Math.max(0, y + k));
            v += kernel[k + radius] * from[(sy * width + sx) * channels + c];
          }
          to[(y * width + x) * channels + c] = v;
        }
      }
    }
  };
  const mid = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  pass(src, mid, true);
  pass(mid, out, false);
  return out;
}

/**
 * The two unknowns at one texel: how bright the cloud is and how much of it
 * there is.
 *
 * @returns {[number, number]} slope f and intercept a, unclamped
 */
function solveAt(observed, s, m) {
  // The weight of each channel, and why it is not simply one over the sky.
  //
  // Dividing by the sky is what makes the three channels comparable, and taken
  // literally it hands the whole answer to whichever channel the sky is
  // faintest in — the red of a deep zenith is a fiftieth of its blue, so a
  // hundredth of an error there is half the sky, and the coverage inherits all
  // of it. The pedestal is a quarter of the sky's own luminance: large enough
  // that no channel can run away, small enough that the normalisation still
  // does its job in a sky whose channels are within a factor of three.
  const pedestal = 0.25 * (0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]);
  let a11 = 0; let a12 = 0; let a22 = 0; let b1 = 0; let b2 = 0;
  for (let c = 0; c < 3; c++) {
    const sc = Math.max(1e-6, s[c]);
    const w = 1 / Math.max(1e-6, sc + pedestal);
    const u = m[c] * w;
    const v = -sc * w;
    const d = (observed[c] - sc) * w;
    a11 += u * u; a12 += u * v; a22 += v * v;
    b1 += u * d; b2 += v * d;
  }
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-12) return [0, 0];
  return [(a22 * b1 - a12 * b2) / det, (a11 * b2 - a12 * b1) / det];
}

/** The whole plate's coverage against one material, before anything is held. */
function rawCover(lin, width, height, sky, m, out) {
  const s = [0, 0, 0];
  const observed = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      sky.at(x + 0.5, y + 0.5, s);
      for (let c = 0; c < 3; c++) observed[c] = lin[i * 3 + c];
      out[i] = solveAt(observed, s, m)[1];
    }
  }
  return out;
}

/** A chamfer distance to the nearest texel the mask does not hold. */
function distanceOut(mask, width, height) {
  const N = width * height;
  const dist = new Float32Array(N);
  for (let i = 0; i < N; i++) dist[i] = mask[i] ? Infinity : 0;
  const relax = (i, j, d) => { if (dist[j] + d < dist[i]) dist[i] = dist[j] + d; };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x > 0) relax(i, i - 1, 1);
      if (y > 0) relax(i, i - width, 1);
      if (x > 0 && y > 0) relax(i, i - width - 1, Math.SQRT2);
      if (x < width - 1 && y > 0) relax(i, i - width + 1, Math.SQRT2);
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (x < width - 1) relax(i, i + 1, 1);
      if (y < height - 1) relax(i, i + width, 1);
      if (x < width - 1 && y < height - 1) relax(i, i + width + 1, Math.SQRT2);
      if (x > 0 && y < height - 1) relax(i, i + width - 1, Math.SQRT2);
    }
  }
  // A texel outside the frame is not sky and not cloud; a body that runs off
  // the edge must not be eroded from a border that is not its own edge.
  return dist;
}

/**
 * What is behind cloud on topological grounds, and how far inside it each texel
 * is.
 *
 * @returns {{filled: Uint8Array, dist: Float32Array, count: number}}
 */
export function interiorOf(cover, width, height, { level = 0.6 } = {}) {
  const N = width * height;
  const solid = new Uint8Array(N);
  for (let i = 0; i < N; i++) solid[i] = cover[i] >= level ? 1 : 0;

  // A belly is a HOLE in that mask, not a piece of sky: it is enclosed by rim
  // on every side. Flooding the outside and keeping what the flood never
  // reached is what tells the two apart, and it needs no coverage it does not
  // already trust.
  const outside = new Uint8Array(N);
  const stack = new Int32Array(N);
  let top = 0;
  const push = (i) => { if (!solid[i] && !outside[i]) { outside[i] = 1; stack[top++] = i; } };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  while (top > 0) {
    const i = stack[--top];
    const x = i % width; const y = (i - x) / width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (y > 0) push(i - width);
    if (y < height - 1) push(i + width);
  }
  const filled = new Uint8Array(N);
  let count = 0;
  for (let i = 0; i < N; i++) { filled[i] = outside[i] ? 0 : 1; count += filled[i]; }
  return { filled, dist: distanceOut(filled, width, height), count };
}

/**
 * The matte: coverage, and the cloud's own colour with no sky left in it.
 *
 * @param {Float32Array} lin  linear rgb of the plate, row major
 * @param {{at: Function}} sky  the background field
 * @param {object} options
 *   floor — the soft knee applied to the coverage, in units of the coverage
 *     noise the plate itself leaves. NOT a threshold: a knee that reaches zero
 *     smoothly and returns 1 at 1, so the fringe is attenuated where it is
 *     indistinguishable from the plate's own grain and untouched everywhere
 *     else. A hard cut here is what turned the old sprites into silhouettes.
 *   erode — how far inside its own rim a region has to be before it is held
 *     opaque, in texels. It is also the width of the ramp, so the hold has no
 *     edge of its own anywhere.
 * @returns {{alpha, rgb, material, residual, noise, knee, interior, held}}
 *   rgb is PREMULTIPLIED — the colour already scaled by the coverage carrying
 *   it, which is what the atlas stores and what keeps a filtered edge the
 *   colour it was.
 */
export function solveMatte(lin, width, height, sky, { floor = 1.5, erode = 12, hold = true } = {}) {
  const N = width * height;
  const s = [0, 0, 0];
  const observed = [0, 0, 0];

  // The material, from a first matte solved against plain white. Weighted by
  // luminance, so it is the colour of the material that carries the picture —
  // the lit body and its rim — rather than a mean of rim and belly that is
  // neither. A belly's own blue is not wanted here and must not be: it is very
  // nearly the sky's chromaticity, and a material that near the background is a
  // system with no answer in it.
  const first = rawCover(lin, width, height, sky, [1, 1, 1], new Float32Array(N));
  const seed = interiorOf(first, width, height);
  let m = [1, 1, 1];
  if (seed.count) {
    const sum = [0, 0, 0];
    let mass = 0;
    for (let i = 0; i < N; i++) {
      if (seed.dist[i] <= erode) continue;
      const w = luminance(lin[i * 3], lin[i * 3 + 1], lin[i * 3 + 2]) ** 2;
      for (let c = 0; c < 3; c++) sum[c] += w * lin[i * 3 + c];
      mass += w;
    }
    if (mass > 0) {
      const total = (sum[0] + sum[1] + sum[2]) / 3;
      m = sum.map((v) => v / total);
    }
  }

  const raw = new Float32Array(N);
  const bound = new Float32Array(N);
  let residual = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      sky.at(x + 0.5, y + 0.5, s);
      for (let c = 0; c < 3; c++) observed[c] = lin[i * 3 + c];
      const [f, a] = solveAt(observed, s, m);
      raw[i] = a;
      let least = 0;
      for (let c = 0; c < 3; c++) {
        least = Math.max(least, 1 - observed[c] / Math.max(1e-6, s[c]));
      }
      bound[i] = least;
      for (let c = 0; c < 3; c++) {
        const sc = Math.max(1e-6, s[c]);
        const r = (observed[c] - (f * m[c] + (1 - a) * sc)) / sc;
        residual += r * r;
      }
    }
  }

  // The coverage this plate's own grain produces where there is no cloud, read
  // as the spread of the NEGATIVE half of the distribution — the one half no
  // cloud can be in, since coverage runs from nought upwards. So it is the
  // noise of the whole field with not one cloud texel in it.
  // And read as a MEDIAN rather than as a root mean square. The negative half
  // holds the grain, and it also holds the few places the background estimate
  // is genuinely wrong — under the middle of a bank, where the field is an
  // interpolation and not a measurement. Those are a fraction of a per cent of
  // the frame and they are ten times the size of the grain, so a mean square
  // reports them and not the noise: measured on the first real plate, 11/255
  // against the 1.5/255 the clear corners of that same plate actually carry.
  // A median cannot see them.
  const below = [];
  for (let i = 0; i < N; i++) if (raw[i] < 0) below.push(-raw[i]);
  below.sort((a, b) => a - b);
  const noise = below.length ? below[below.length >> 1] / 0.6745 : 0;
  const knee = floor * noise;

  // The bound taken up, with three sigma of margin. It is a MAXIMUM over three
  // noisy ratios, so on empty sky it sits above nought by about a sigma of its
  // own and would lay a wash of coverage over the whole plate; the margin costs
  // nothing where the bound is worth having, which is where it is large.
  for (let i = 0; i < N; i++) raw[i] = Math.max(raw[i], bound[i] - 3 * noise);

  const inside = interiorOf(raw, width, height);
  const alpha = new Float32Array(N);
  const rgb = new Float32Array(N * 3);
  let held = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const a = Math.min(1, Math.max(0, raw[i]));
      // a²(1+k)/(a+k): nought at nought, one at one, monotone, and with no
      // corner anywhere. Below the knee it falls away quadratically, which is
      // what the plate's own grain deserves; a tenth of coverage at a knee of a
      // hundredth keeps nine tenths of itself.
      const soft = knee > 0 ? a * a * (1 + knee) / (a + knee) : a;
      const t = hold ? Math.min(1, inside.dist[i] / Math.max(1e-6, erode)) : 0;
      const opaque = t * t * (3 - 2 * t);
      const final = Math.max(soft, opaque);
      if (final > soft + 1e-4) held++;
      alpha[i] = final;
      sky.at(x + 0.5, y + 0.5, s);
      for (let c = 0; c < 3; c++) {
        rgb[i * 3 + c] = Math.max(0, lin[i * 3 + c] - (1 - final) * s[c]);
      }
    }
  }

  return {
    alpha,
    rgb,
    material: m,
    residual: Math.sqrt(residual / (N * 3)),
    noise,
    knee,
    interior: inside.count,
    held,
  };
}

/**
 * THE SHOULDER A HARD MATTE CUT OFF, PUT BACK FROM THE COLOUR THAT KEPT IT.
 *
 * WHAT THESE SOURCES ARE. Every plate of the alpha roster is two different
 * things in one file. The three colour channels are a cloud drawn OVER BLACK —
 * walk a row outwards from a bank and the luminance falls away smoothly, 175,
 * 144, 118, 94, 74, 58, 42, 30, 22, 17, 11, 10, 8, 7, and only then to nothing.
 * The fourth channel is a HARD MATTE laid over that image, and it is already
 * nought two hundred texels before the colour is: measured over the fifteen,
 * between 27 and 74 per cent of the frame stands at coverage exactly nought
 * while still carrying light, at a mean linear colour of 0.06 to 0.22. In the
 * fringe proper the colour stands over the coverage on 58 to 90 per cent of the
 * texels, by a factor of 2.7 to 7.9 on average.
 *
 * WHAT THAT COST. `premultiplicationOf` asks the only question the pixels can
 * answer on their own — does the colour ever stand above the coverage — and on
 * these it answers no, correctly, for the convention it is asking about. So the
 * colour was multiplied by the matte a second time: in the body, where the
 * matte is one, that is exact; in the fringe, where the matte is nought and the
 * colour is not, it multiplies the whole shoulder by zero. The delivered
 * material was therefore a body at coverage 0.98 and up with a rim two texels
 * wide, the frame's thickness histogram read NOTHING at all in the bins from a
 * tenth to four tenths where the reference reads 5 to 6 per cent each, and two
 * gates in a row said the same sentence: the cloud ends in a line where the
 * reference ends in air. No composition can put back what the material does not
 * have, and this is where it stopped having it.
 *
 * THE MODEL, AND IT IS THE ONLY ONE THERE IS. A premultiplied texel is a·C: one
 * observation, two unknowns, and what separates them has to come from
 * somewhere. What a cloud gives is that C — the material's own colour — is a
 * property of the CLOUD and not of the texel, so it varies over a body at the
 * scale of the body's own shading and not at the scale of its fringe. So C is
 * estimated where the matte is certain, carried outwards, and the coverage
 * falls out of the division:
 *
 *   a = L(a·C) / L(C)   with L(C) read off the texels the matte holds.
 *
 * The reference is LOCAL, not one number per plate, and that is the difference
 * between a shoulder and a halo: a fringe hanging off a shaded base divided by
 * the luminance of a sunlit crown comes back at a fifth of the coverage it has,
 * which is a hard edge again with a stain round it. It is carried by a blur of
 * the held texels over their own mask, which is the cheapest form of "the
 * material nearest here" and needs no segmentation to be right.
 *
 * WHAT IT CANNOT DO, SAID PLAINLY. Inside the body the division reads a shaded
 * belly as thin, and a belly is not thin — it is dark. So the given matte is
 * kept wherever it is larger, and the reconstruction can only ADD coverage
 * where the matte had none. A cumulus stays opaque; only the air round it comes
 * back.
 *
 * AND THE KNEE. The tail of a premultiplied plate runs out into the plate's own
 * grain, one and two display levels of it, and a wash of a hundredth of coverage
 * over half a frame is a wash. The knee is the same curve the matting branch of
 * this file uses — a²(1+k)/(a+k), nought at nought, one at one, monotone, no
 * corner anywhere — and it is set in COVERAGE, at the step the delivered frame
 * would make: this material stands fifty to ninety display levels off its own
 * sky, so a knee of three parts in 255 is where the shoulder's own step reaches
 * one level and stops being visible at all.
 *
 * AND THE REACH, WHICH IS THE ONE NUMBER THAT HAD TO BE MEASURED TWICE.
 *
 * Taken at its own word the division above answers a shoulder four and a half
 * degrees deep on the hero, and the delivered frame said what that is: coverage
 * 36.1 per cent against the reference's 21.8, every band from six degrees to
 * twenty two half under cloud, and the sky between the towers turned to haze.
 * The reference's own shoulder is not that. Its veil is 28.5 per cent of a
 * coverage of 21.8, which is 6.2 per cent of the sky standing round masses
 * whose outline runs about a hundred and twenty degrees — a band under a degree
 * wide — and its border profile crosses from nine tenths to one tenth in 2.17
 * degrees.
 *
 * So the reconstruction is given a REACH: how far out of the plate's own matte
 * it is taken, in degrees of that plate's sky, tapered to nothing by a
 * smoothstep so that it ends without an edge. It is the honest form of the
 * limit, and the reason it is a distance and not another power is that the
 * quantity that was wrong is a WIDTH. A power thins the near shoulder — the
 * texels at a third of coverage that the reference's own thickness histogram
 * counts — to reach the far tail, and measured on the frame it took the veil
 * share down with it: at a power of 3.5 the histogram's bin from a tenth to a
 * fifth came back at nought again, which is the defect this whole function
 * exists to close. A reach leaves the near shoulder exactly as the material has
 * it and stops the wash.
 *
 * @param {Float32Array} lin     the plate, premultiplied, linear, rgb interleaved
 * @param {Float32Array} alpha   the matte as given
 * @param {number} width
 * @param {number} height
 * @param {{knee?: number, gamma?: number, core?: number, sigma?: number,
 *          reach?: number}} opt  reach is in TEXELS
 * @returns {{alpha: Float32Array, added: number, ref: number, outside: number}}
 */
export function reconstructShoulder(lin, alpha, width, height, opt = {}) {
  const N = width * height;
  const core = opt.core ?? 0.9;
  const knee = opt.knee ?? 3 / 255;
  const gamma = opt.gamma ?? 1;
  const reach = opt.reach ?? Infinity;
  // How far the material's own colour is carried outwards, in texels. Wide
  // enough that no fringe is left without a reference, narrow enough that a
  // sunlit crown does not become the reference for a shaded base a third of a
  // plate away: a fiftieth of the plate's width is about a degree of sky on
  // this roster, which is the scale a cumulus shades at.
  const sigma = opt.sigma ?? Math.max(3, Math.round(width / 50));

  const num = new Float32Array(N);
  const den = new Float32Array(N);
  const lum = new Float32Array(N);
  const held = [];
  for (let i = 0; i < N; i++) {
    lum[i] = luminance(lin[i * 3], lin[i * 3 + 1], lin[i * 3 + 2]);
    if (alpha[i] >= core) { num[i] = lum[i]; den[i] = 1; held.push(lum[i]); }
  }
  // A plate with no certain core at all — a sheet of cirrus whose matte never
  // reaches one — still gets a reference, and it is that plate's own bright
  // material rather than nothing: the ninetieth percentile of what light there
  // is. Stated rather than defaulted, because a reference of nought would
  // return a plate of solid coverage.
  let fallback;
  if (held.length > 64) {
    held.sort((a, b) => a - b);
    fallback = held[held.length >> 1];
  } else {
    const any = Array.from(lum).filter((v) => v > 1e-4).sort((a, b) => a - b);
    fallback = any.length ? any[Math.floor(any.length * 0.9)] : 1;
  }
  const nb = blur(num, width, height, 1, sigma);
  const db = blur(den, width, height, 1, sigma);

  // How far each texel stands outside the plate's own silhouette, by two
  // chamfer sweeps. The silhouette is taken at half coverage, which is the line
  // the reference's veil share is drawn at and the same line the composition
  // states a piece's width on.
  const dist = new Float32Array(N).fill(Infinity);
  if (Number.isFinite(reach)) {
    for (let i = 0; i < N; i++) if (alpha[i] >= 0.5) dist[i] = 0;
    const relax = (order) => {
      const ys = order > 0 ? 0 : height - 1;
      for (let k = 0; k < height; k++) {
        const y = order > 0 ? ys + k : ys - k;
        for (let m = 0; m < width; m++) {
          const x = order > 0 ? m : width - 1 - m;
          const i = y * width + x;
          let d = dist[i];
          for (const [dx, dy, w] of [[-order, 0, 1], [0, -order, 1],
            [-order, -order, Math.SQRT2], [order, -order, Math.SQRT2]]) {
            const xx = x + dx; const yy = y + dy;
            if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
            d = Math.min(d, dist[yy * width + xx] + w);
          }
          dist[i] = d;
        }
      }
    };
    relax(1);
    relax(-1);
  }

  const out = new Float32Array(N);
  let added = 0;
  let refSum = 0;
  let outside = 0;
  for (let i = 0; i < N; i++) {
    // Where almost none of the neighbourhood is held the carried mean is the
    // ratio of two nearly empty sums and says nothing; the plate's own median
    // takes over, and the two are crossfaded so that nothing has a seam.
    const w = Math.min(1, db[i] / 0.02);
    const ref = Math.max(1e-5, w * (db[i] > 1e-6 ? nb[i] / db[i] : fallback) + (1 - w) * fallback);
    refSum += ref;
    const raw = Math.min(1, lum[i] / ref);
    const soft = knee > 0 ? raw * raw * (1 + knee) / (raw + knee) : raw;
    let rec = gamma === 1 ? soft : soft ** gamma;
    if (Number.isFinite(reach)) {
      const t = Math.max(0, Math.min(1, 1 - dist[i] / reach));
      rec *= t * t * (3 - 2 * t);
    }
    const final = Math.max(alpha[i], rec);
    if (final > alpha[i] + 1e-4) { added += final - alpha[i]; if (alpha[i] <= 0) outside++; }
    out[i] = final;
  }
  return {
    alpha: out, added: added / N, ref: refSum / N, outside: outside / N,
  };
}

/**
 * What share of the cloud is thinner than half its own thickness.
 *
 * The reference's own figure is 28.5 per cent and the generated sprites' was
 * eight: the difference between weather that ends in air and weather that ends
 * in a line. Measured on the texels that carry anything at all, because a
 * window is mostly empty and counting its emptiness would report the size of
 * the window.
 */
export function veilShare(alpha, { live = 3 / 255, half = 0.5 } = {}) {
  let veil = 0;
  let body = 0;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] <= live) continue;
    body++;
    if (alpha[i] < half) veil++;
  }
  return { share: body ? veil / body : 0, body };
}
