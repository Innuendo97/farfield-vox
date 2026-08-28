// Filling a hole with the material around it, rather than with an average of it.
//
// The monoliths take four hundred columns of sky out of the reference, and the
// sector has to be carried outwards past the edge of the framing before anything
// invented is allowed to touch it. Both are the same question: continue this
// material into that region. Blurring answers it with a pale wall, and a pull
// push pyramid answers it with a rectangle exactly the shape of what was
// removed — the ghosts the sky carries today.
//
// This answers it by looking for the piece of sky that already continues the
// same neighbourhood, which is the only answer that puts cloud where cloud
// belongs. The search is the one from PatchMatch: a random guess per texel, then
// alternate propagation of whatever worked for the neighbours with a shrinking
// random probe, run over a pyramid so a patch found at a coarse scale carries
// the fine detail of the same place up with it.

/** Box downsample by two, carrying a weight so partial coverage survives. */
function shrink(data, weight, width, height, channels) {
  const w = Math.max(1, width >> 1);
  const h = Math.max(1, height >> 1);
  const out = new Float32Array(w * h * channels);
  const ow = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      const acc = new Float64Array(channels);
      for (let dy = 0; dy < 2; dy++) {
        const sy = Math.min(height - 1, y * 2 + dy);
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(width - 1, x * 2 + dx);
          const o = sy * width + sx;
          const ww = weight[o];
          if (ww <= 0) continue;
          for (let c = 0; c < channels; c++) acc[c] += data[o * channels + c] * ww;
          sum += ww;
        }
      }
      const o = y * w + x;
      ow[o] = sum / 4;
      if (sum > 0) for (let c = 0; c < channels; c++) out[o * channels + c] = acc[c] / sum;
    }
  }
  return { data: out, weight: ow, width: w, height: h };
}

/**
 * Seeds the coarsest level: every unknown texel takes the nearest known colour,
 * and the result is then smoothed over the unknown region.
 *
 * The smoothing is not a finish, it is the whole point. A nearest neighbour fill
 * of a strip with known material at both ends is a Voronoi: two floods meeting
 * along a ridge, in columns as wide as whatever staircase the mask boundary
 * happens to have. The search that follows measures its candidates against this
 * field, so a ridge in it is a ridge in the first thing every patch is compared
 * to, and the search converges to a fill that keeps it — a slab with a
 * crenellated top and straight sides, which is exactly what the ribbon along the
 * top of the reference framing was carrying. Smoothed, there is no ridge to
 * converge onto, and the search is free to answer with material.
 */
function seed(data, known, width, height, channels, smoothPasses = 3) {
  const value = new Float32Array(data);
  const have = Uint8Array.from(known);
  const queue = [];
  for (let i = 0; i < width * height; i++) if (have[i]) queue.push(i);
  let head = 0;
  while (head < queue.length) {
    const p = queue[head++];
    const x = p % width;
    const y = (p - x) / width;
    const visit = (q) => {
      if (q < 0 || q >= width * height || have[q]) return;
      have[q] = 1;
      for (let c = 0; c < channels; c++) value[q * channels + c] = value[p * channels + c];
      queue.push(q);
    };
    if (x > 0) visit(p - 1);
    if (x < width - 1) visit(p + 1);
    if (y > 0) visit(p - width);
    if (y < height - 1) visit(p + width);
  }

  const swap = new Float32Array(value);
  for (let pass = 0; pass < smoothPasses; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (known[p]) continue;
        let n = 0;
        const acc = new Float64Array(channels);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy < 0 || yy >= height || xx < 0 || xx >= width) continue;
            const q = yy * width + xx;
            for (let c = 0; c < channels; c++) acc[c] += value[q * channels + c];
            n++;
          }
        }
        for (let c = 0; c < channels; c++) swap[p * channels + c] = acc[c] / n;
      }
    }
    value.set(swap);
  }
  return value;
}

/**
 * Seeds a level from the one above it, which has already been solved.
 *
 * Without this every level starts from its own nearest neighbour fill and the
 * work done at the coarse scales reaches the fine ones only through the offset
 * field. That is enough to place the material and not enough to shape it: the
 * finest level, where the patch is smallest and the mask boundary roughest,
 * re-derives its own answer from its own Voronoi. Carrying the coarse solution
 * down means the fine search starts from a field that is already the right sky
 * at the wrong resolution, and has nothing to do but sharpen it.
 */
function lift(coarse, level, channels) {
  const { width, height, known } = level;
  const value = new Float32Array(level.data);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(coarse.height - 1.001, Math.max(0, (y - 0.5) / 2));
    const y0 = fy | 0;
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (known[p]) continue;
      const fx = Math.min(coarse.width - 1.001, Math.max(0, (x - 0.5) / 2));
      const x0 = fx | 0;
      const tx = fx - x0;
      for (let c = 0; c < channels; c++) {
        const a = coarse.data[(y0 * coarse.width + x0) * channels + c];
        const b = coarse.data[(y0 * coarse.width + x0 + 1) * channels + c];
        const d = coarse.data[((y0 + 1) * coarse.width + x0) * channels + c];
        const e = coarse.data[((y0 + 1) * coarse.width + x0 + 1) * channels + c];
        value[p * channels + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
    }
  }
  return value;
}

function makeRandom(seedValue) {
  let s = seedValue >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * @param {object} level  { data, known, source, width, height }
 * @param {Int32Array} nnf  two entries per texel: the top left of its source patch
 */
function searchAndVote(level, nnf, {
  channels, radius, iterations, random, propagateOnly = false,
}) {
  const {
    data, known, source, width, height,
  } = level;
  const span = radius * 2 + 1;
  const legal = (x, y) => x >= radius && y >= radius && x < width - radius && y < height - radius;

  // A patch may be taken only where every texel of it is source material.
  const sourceOk = new Uint8Array(width * height);
  {
    const rowRun = new Int32Array(width * height);
    for (let y = 0; y < height; y++) {
      let run = 0;
      for (let x = 0; x < width; x++) {
        run = source[y * width + x] ? run + 1 : 0;
        rowRun[y * width + x] = run;
      }
    }
    for (let y = radius; y < height - radius; y++) {
      for (let x = radius; x < width - radius; x++) {
        let ok = true;
        for (let dy = -radius; dy <= radius && ok; dy++) {
          if (rowRun[(y + dy) * width + x + radius] < span) ok = false;
        }
        if (ok) sourceOk[y * width + x] = 1;
      }
    }
  }
  const pool = [];
  for (let i = 0; i < width * height; i++) if (sourceOk[i]) pool.push(i);
  if (pool.length === 0) return data;

  const targets = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!known[y * width + x] && legal(x, y)) targets.push(y * width + x);
    }
  }
  if (targets.length === 0) return data;

  const distance = (tx, ty, sx, sy, cut) => {
    let d = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const to = ((ty + dy) * width + tx - radius) * channels;
      const so = ((sy + dy) * width + sx - radius) * channels;
      for (let k = 0; k < span * channels; k++) {
        const diff = data[to + k] - data[so + k];
        d += diff * diff;
      }
      if (d > cut) return d;
    }
    return d;
  };

  // A field handed down from the level above has been doubled and may now point
  // at a texel that is not source at all. Left unchecked it is still taken as
  // the incumbent, and since the distance to a region of zeros is small for any
  // patch that is itself near zero — which clear sky is — the incumbent wins and
  // is never replaced.
  for (const p of targets) {
    const sx = nnf[p * 2];
    const sy = nnf[p * 2 + 1];
    if (sx >= 0 && sy >= 0 && sourceOk[sy * width + sx]) continue;
    const q = pool[Math.floor(random() * pool.length)];
    nnf[p * 2] = q % width;
    nnf[p * 2 + 1] = (q - (q % width)) / width;
  }

  for (let it = 0; it < iterations; it++) {
    const forward = it % 2 === 0;
    const order = forward ? targets : [...targets].reverse();
    for (const p of order) {
      const tx = p % width;
      const ty = (p - tx) / width;
      let bx = nnf[p * 2];
      let by = nnf[p * 2 + 1];
      let best = distance(tx, ty, bx, by, Infinity);

      const tryAt = (sx, sy) => {
        if (sx < radius || sy < radius || sx >= width - radius || sy >= height - radius) return;
        if (!sourceOk[sy * width + sx]) return;
        const d = distance(tx, ty, sx, sy, best);
        if (d < best) { best = d; bx = sx; by = sy; }
      };

      const step = forward ? -1 : 1;
      const nx = p + step;
      if (nx >= 0 && nx < width * height && nnf[nx * 2] >= 0) tryAt(nnf[nx * 2] - step, nnf[nx * 2 + 1]);
      const ny = p + step * width;
      if (ny >= 0 && ny < width * height && nnf[ny * 2] >= 0) tryAt(nnf[ny * 2], nnf[ny * 2 + 1] - step);

      if (!propagateOnly) {
        let range = Math.max(width, height);
        while (range > 1) {
          tryAt(
            bx + Math.round((random() * 2 - 1) * range),
            by + Math.round((random() * 2 - 1) * range),
          );
          range = Math.floor(range / 2);
        }
      }
      nnf[p * 2] = bx;
      nnf[p * 2 + 1] = by;
    }

    // Vote: every unknown texel is the mean of the patches that cover it,
    // which is what stops a synthesised region breaking into visible tiles.
    const acc = new Float64Array(width * height * channels);
    const wsum = new Float64Array(width * height);
    for (const p of targets) {
      const tx = p % width;
      const ty = (p - tx) / width;
      const sx = nnf[p * 2];
      const sy = nnf[p * 2 + 1];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const to = (ty + dy) * width + tx + dx;
          if (known[to]) continue;
          const so = (sy + dy) * width + sx + dx;
          for (let c = 0; c < channels; c++) acc[to * channels + c] += data[so * channels + c];
          wsum[to] += 1;
        }
      }
    }
    for (let i = 0; i < width * height; i++) {
      if (known[i] || wsum[i] <= 0) continue;
      for (let c = 0; c < channels; c++) data[i * channels + c] = acc[i * channels + c] / wsum[i];
    }
  }
  return data;
}

/**
 * Completes every texel where `known` is zero, using only texels where
 * `source` is one.
 *
 * @param {Float32Array} data      width*height*channels
 * @param {Uint8Array}   known     1 where the value must be preserved
 * @param {Uint8Array}   source    1 where patches may be taken from
 */
export function completeByExemplar({
  data, known, source, width, height, channels,
  radius = 3, levels = 5, iterations = 5, seed: seedValue = 0x5eed,
  settle = null,
}) {
  const random = makeRandom(seedValue);

  // Pyramid of the problem. `known` shrinks conservatively: a coarse texel is
  // known only if it was fully covered, so nothing invented is ever mistaken
  // for measurement one level up.
  const pyramid = [{
    data: Float32Array.from(data),
    known: Uint8Array.from(known),
    source: Uint8Array.from(source),
    width,
    height,
  }];
  for (let l = 1; l < levels; l++) {
    const prev = pyramid[l - 1];
    if (prev.width < 32 || prev.height < 32) break;
    const known01 = Float32Array.from(prev.known);
    const src01 = Float32Array.from(prev.source);
    const s = shrink(prev.data, known01, prev.width, prev.height, channels);
    const sk = shrink(known01, new Float32Array(prev.width * prev.height).fill(1), prev.width, prev.height, 1);
    const ss = shrink(src01, new Float32Array(prev.width * prev.height).fill(1), prev.width, prev.height, 1);
    pyramid.push({
      data: s.data,
      known: Uint8Array.from(sk.data, (v) => (v > 0.99 ? 1 : 0)),
      source: Uint8Array.from(ss.data, (v) => (v > 0.99 ? 1 : 0)),
      width: s.width,
      height: s.height,
    });
  }

  let nnf = null;
  for (let l = pyramid.length - 1; l >= 0; l--) {
    const level = pyramid[l];
    level.data = l === pyramid.length - 1
      ? seed(level.data, level.known, level.width, level.height, channels)
      : lift(pyramid[l + 1], level, channels);
    const next = new Int32Array(level.width * level.height * 2).fill(-1);
    if (nnf) {
      const coarse = pyramid[l + 1];
      for (let y = 0; y < level.height; y++) {
        for (let x = 0; x < level.width; x++) {
          const cx = Math.min(coarse.width - 1, x >> 1);
          const cy = Math.min(coarse.height - 1, y >> 1);
          const o = (cy * coarse.width + cx) * 2;
          if (nnf[o] < 0) continue;
          next[(y * level.width + x) * 2] = Math.min(level.width - 1 - radius, Math.max(radius, nnf[o] * 2 + (x & 1)));
          next[(y * level.width + x) * 2 + 1] = Math.min(level.height - 1 - radius, Math.max(radius, nnf[o + 1] * 2 + (y & 1)));
        }
      }
    }
    searchAndVote(level, next, {
      channels,
      radius,
      iterations,
      random,
    });
    nnf = next;
  }

  const top = pyramid[0];
  for (let i = 0; i < width * height; i++) {
    if (known[i]) continue;
    for (let c = 0; c < channels; c++) data[i * channels + c] = top.data[i * channels + c];
  }
  // What a completed texel is allowed to be, and what it has to meet, settled
  // together rather than one after the other.
  //
  // Saying it once before the seam is closed is not enough: the harmonic
  // correction moves the channels by whatever each of them is out by at the rim,
  // and four numbers that describe one cloud between them do not stay describing
  // one cloud when they are moved separately. What came back was coverage
  // carrying no light — sky with a third of a cloud in front of it and nothing
  // of the cloud's own brightness, which composites as a bruise, and in the
  // worst places a colour the sky cannot have at all.
  //
  // So the two are alternated, and the closure still has the last word — that
  // part of the original ordering was right and anything after it opens the seam
  // again. What the second round buys is that the fill the closure is working on
  // is already a cloud, so the correction it has to carry is small enough that
  // the field it diffuses inwards stays inside the sky. One round was what left
  // the ribbon along the top of the framing carrying coverage with no light in
  // it, which composites as a bruise with the red driven out of it.
  for (let round = 0; round < 4; round++) {
    if (settle) for (let i = 0; i < width * height; i++) if (!known[i]) settle(i, data);
    closeTheSeam(data, known, width, height, channels);
  }
  return data;
}

/**
 * Makes the fill meet the measurement exactly, whatever the search found.
 *
 * A patch search matches neighbourhoods, not values, so the first synthesised
 * texel can sit a long way from the measured one beside it — and a step at that
 * particular boundary is a step drawn along the top edge of the reference
 * framing, which is the one place in this whole sky where a step must not be.
 *
 * So the difference is measured along the boundary and diffused into the fill as
 * a harmonic field: exactly the mismatch at the rim, falling smoothly away from
 * it, zero far inside. It moves the level of the invented sky and leaves its
 * structure alone, which is the right way round — the structure was the part
 * worth searching for.
 */
function closeTheSeam(data, known, width, height, channels) {
  const size = width * height;
  const correction = new Float32Array(size * channels);
  const fixed = new Uint8Array(size);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (known[p]) continue;
      let n = 0;
      const sum = new Float64Array(channels);
      const look = (q) => {
        if (q < 0 || q >= size || !known[q]) return;
        for (let c = 0; c < channels; c++) sum[c] += data[q * channels + c];
        n++;
      };
      if (x > 0) look(p - 1);
      if (x < width - 1) look(p + 1);
      if (y > 0) look(p - width);
      if (y < height - 1) look(p + width);
      if (n === 0) continue;
      fixed[p] = 1;
      for (let c = 0; c < channels; c++) {
        correction[p * channels + c] = sum[c] / n - data[p * channels + c];
      }
    }
  }

  // Solved on a coarse grid and then refined.
  //
  // The correction is harmonic, so it has no detail to lose by being solved
  // eight times smaller, and it has to travel: relaxation carries information
  // about one texel per sweep, and a ribbon seventy texels across therefore
  // needs thousands of sweeps at full resolution to hear its own far side. On a
  // grid eight times coarser it needs sixty, and what comes back up is already
  // the answer everywhere but the rim.
  const relax = (values, solve, w, h, sweeps) => {
    const OMEGA = 1.9;
    for (let sweep = 0; sweep < sweeps; sweep++) {
      for (let parity = 0; parity < 2; parity++) {
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1 + ((y + parity) & 1); x < w - 1; x += 2) {
            const p = y * w + x;
            if (!solve[p]) continue;
            for (let c = 0; c < channels; c++) {
              const mean = 0.25 * (
                values[(p - 1) * channels + c] + values[(p + 1) * channels + c]
                + values[(p - w) * channels + c] + values[(p + w) * channels + c]
              );
              values[p * channels + c] += OMEGA * (mean - values[p * channels + c]);
            }
          }
        }
      }
    }
  };

  const STEP = 8;
  const cw = Math.max(3, Math.ceil(width / STEP));
  const ch = Math.max(3, Math.ceil(height / STEP));
  const coarse = new Float32Array(cw * ch * channels);
  const coarseSolve = new Uint8Array(cw * ch);
  {
    const anchorSum = new Float64Array(cw * ch * channels);
    const anchorCount = new Float64Array(cw * ch);
    const freeCount = new Float64Array(cw * ch);
    for (let y = 0; y < height; y++) {
      const cy = Math.min(ch - 1, (y / STEP) | 0);
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const q = cy * cw + Math.min(cw - 1, (x / STEP) | 0);
        if (fixed[p]) {
          for (let c = 0; c < channels; c++) anchorSum[q * channels + c] += correction[p * channels + c];
          anchorCount[q]++;
        } else if (!known[p]) freeCount[q]++;
      }
    }
    for (let q = 0; q < cw * ch; q++) {
      if (anchorCount[q] > 0) {
        for (let c = 0; c < channels; c++) coarse[q * channels + c] = anchorSum[q * channels + c] / anchorCount[q];
      } else if (freeCount[q] > 0) coarseSolve[q] = 1;
    }
    relax(coarse, coarseSolve, cw, ch, 900);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (known[p] || fixed[p]) continue;
        const fx = Math.min(cw - 1.001, Math.max(0, x / STEP - 0.5));
        const fy = Math.min(ch - 1.001, Math.max(0, y / STEP - 0.5));
        const x0 = fx | 0; const y0 = fy | 0;
        const tx = fx - x0; const ty = fy - y0;
        for (let c = 0; c < channels; c++) {
          const a = coarse[(y0 * cw + x0) * channels + c];
          const b = coarse[(y0 * cw + x0 + 1) * channels + c];
          const d = coarse[((y0 + 1) * cw + x0) * channels + c];
          const e = coarse[((y0 + 1) * cw + x0 + 1) * channels + c];
          correction[p * channels + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
        }
      }
    }
  }
  const solve = new Uint8Array(size);
  for (let i = 0; i < size; i++) solve[i] = (!known[i] && !fixed[i]) ? 1 : 0;
  relax(correction, solve, width, height, 60);

  for (let i = 0; i < size; i++) {
    if (known[i]) continue;
    for (let c = 0; c < channels; c++) data[i * channels + c] += correction[i * channels + c];
  }
}
