import { blueness } from './plate.mjs';

// THE SKY A PLATE WAS SHOT AGAINST, AS A SMOOTH FIELD.
//
// Everything the matte does rests on knowing what was behind the cloud, and on
// a real plate that is not a colour: a clear sky darkens with elevation and
// brightens towards the sun, so across a frame sixty degrees wide the
// background moves by tens of display levels. Subtracting a constant leaves
// that ramp inside the alpha — a wash of false veil down one side of every
// piece and a bite out of the other.
//
// So the background is estimated as a LOW ORDER POLYNOMIAL of position, fitted
// robustly to the parts of the frame that are sky. Low order is the whole
// safety argument: the field has to be able to reach across a bank that fills
// the middle of the plate without following it, and a surface with six free
// numbers cannot bend into a cumulus however hard the fit is pulled. Raising
// the degree is available and is a decision, not a default.
//
// AND IT IS FITTED IN THE LOG. A sky is a positive quantity whose channels
// differ by more than an order of magnitude — the red of a deep zenith is a
// fiftieth of its blue — and a surface fitted to the values themselves has
// nothing stopping it going NEGATIVE in the channel that is nearly nought.
// Measured on the first real plate: red at the top corners came back at minus
// two hundredths against six thousandths observed, the blueness of that
// nonsense then failed the robustness test, the block was rejected as cloud,
// and the correction below never got the chance to put it right. In the log the
// surface is positive by construction and a gradient is a straight line rather
// than a curve, so the same six numbers fit a great deal better.
//
// WHAT TELLS SKY FROM CLOUD HERE. Not brightness — a grey belly seen against a
// bright horizon is darker than the sky beside it, and a backlit rim is
// brighter than anything. Chromaticity: the sky is blue everywhere in the
// frame, and the only thing that makes a cloud texel blue is sky still showing
// through it. So contamination has a SIGN — cloud can only make a patch less
// blue, never more — and the robust weight is one-sided, which is what lets it
// reject a block that is entirely cloud instead of averaging it in.

/**
 * The monomials the surface is built from.
 *
 * Everything up to the stated degree, and then a few more in the VERTICAL
 * ALONE. The asymmetry is the sky's own: what a clear sky does is a function of
 * elevation — deep at the zenith, pale and hazy near the horizon, and the
 * paling is far from quadratic — while across the frame at one height it is
 * nearly flat apart from the sun's halo. Terms in x of high order are what
 * makes a fit explode where it has to reach across a bank; terms in y of high
 * order are fitted on the margins, which run the whole height of every plate,
 * and are safe there. Measured: with two orders of extra height the tower
 * plate's low haze is followed and its bottom corner stops reporting coverage
 * the plate does not have.
 */
function terms(degree, vertical = 2) {
  const out = [];
  for (let total = 0; total <= degree; total++) {
    for (let i = 0; i <= total; i++) out.push([total - i, i]);
  }
  for (let k = 1; k <= vertical; k++) out.push([0, degree + k]);
  return out;
}

/** Solves a small symmetric system by Gauss-Jordan with partial pivoting. */
function solve(A, b, n) {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * The blocks the fit is done on, and the most sky-like colour of each.
 *
 * A block rather than a pixel because the fit wants one observation per
 * neighbourhood and not a million correlated ones, and the most sky-like
 * quarter of a block rather than its mean because a block on the edge of a
 * cumulus is half cloud and its mean is half wrong.
 */
function blocks(lin, width, height, side) {
  const cols = Math.max(2, Math.round(width / side));
  const rows = Math.max(2, Math.round(height / side));
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * width / cols); const x1 = Math.floor((c + 1) * width / cols);
      const y0 = Math.floor(r * height / rows); const y1 = Math.floor((r + 1) * height / rows);
      const samples = [];
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * width + x) * 3;
          samples.push([blueness(lin[o], lin[o + 1], lin[o + 2]), o]);
        }
      }
      if (!samples.length) continue;
      samples.sort((a, b) => b[0] - a[0]);
      const take = Math.max(1, Math.round(samples.length * 0.25));
      const colour = [0, 0, 0];
      let blue = 0;
      for (let i = 0; i < take; i++) {
        const o = samples[i][1];
        colour[0] += lin[o]; colour[1] += lin[o + 1]; colour[2] += lin[o + 2];
        blue += samples[i][0];
      }
      // And the block's plain mean, which is what the correction below is
      // built from. The quartile above exists to tell a half-covered block from
      // a clear one; taken as a value it is the bluest quarter of a
      // distribution and therefore biased, and a background biased blue is a
      // coverage that starts at something instead of at nothing.
      const mean = [0, 0, 0];
      for (const [, o] of samples) {
        mean[0] += lin[o]; mean[1] += lin[o + 1]; mean[2] += lin[o + 2];
      }
      const FLOOR = 1e-5;
      out.push({
        row: r,
        column: c,
        mean: mean.map((v) => Math.log(Math.max(FLOOR, v / samples.length))),
        // Normalised to [-1, 1] both ways, so the polynomial's coefficients are
        // the same size whatever the plate's pixel dimensions are.
        x: ((x0 + x1) / 2) / width * 2 - 1,
        y: ((y0 + y1) / 2) / height * 2 - 1,
        colour: colour.map((v) => Math.log(Math.max(FLOOR, v / take))),
        blue: blue / take,
        weight: 1,
      });
    }
  }
  return { list: out, cols, rows };
}

const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

/**
 * The background of a plate.
 *
 * @param {Float32Array} lin linear rgb, row major
 * @param {object} options
 *   degree — order of the surface; 2 is a gradient with a broad brightening in
 *     it, which is what a clear sky with the sun behind the subject looks like.
 *   block — side of a fit block in pixels.
 *   passes — reweighting rounds.
 * @returns {{at: Function, coefficients: number[][], sigma: number[],
 *            blueSigma: number, skyBlocks: number, blocks: number}}
 */
export function fitSkyField(lin, width, height, {
  degree = 2, block = 24, passes = 6, relax = 2000,
} = {}) {
  const basis = terms(degree);
  const n = basis.length;
  const { list: grid, cols, rows } = blocks(lin, width, height, block);
  const design = grid.map((b) => basis.map(([i, j]) => (b.x ** i) * (b.y ** j)));

  // The first round is fitted to the bluest half of EACH ROW of blocks.
  //
  // Half the plate rather than all of it, because starting from all of it puts
  // a cloud-covered plate's own cloud into the first surface and the
  // reweighting then has to argue its way back out. Row by row rather than
  // over the whole frame, because a sky pales towards the horizon: the bluest
  // half of a WHOLE plate is its top half, so a global rule throws away every
  // block at the height where the haze lives and never takes one back — the
  // reweighting only ever removes. Measured on the tower plate: the bottom
  // fifth was seeded away, the surface extrapolated down there to a fifth of
  // the blue the plate plainly has, and the coverage came back saturated over a
  // corner of clear sky.
  const byRow = new Map();
  for (const k of grid.keys()) {
    if (!byRow.has(grid[k].row)) byRow.set(grid[k].row, []);
    byRow.get(grid[k].row).push(k);
  }
  for (const row of byRow.values()) {
    row.sort((a, b) => grid[b].blue - grid[a].blue);
    for (const k of row.slice(Math.ceil(row.length * 0.5))) grid[k].weight = 0;
  }

  let coefficients = null;
  let blueSigma = 0;
  for (let pass = 0; pass < passes; pass++) {
    coefficients = [];
    for (let c = 0; c < 3; c++) {
      const A = Array.from({ length: n }, () => new Array(n).fill(0));
      const b = new Array(n).fill(0);
      for (let k = 0; k < grid.length; k++) {
        const w = grid[k].weight;
        if (w <= 0) continue;
        const d = design[k];
        for (let i = 0; i < n; i++) {
          b[i] += w * d[i] * grid[k].colour[c];
          for (let j = i; j < n; j++) A[i][j] += w * d[i] * d[j];
        }
      }
      for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) A[i][j] = A[j][i];
      const x = solve(A, b, n);
      if (!x) throw new Error('the sky fit is singular: too few sky blocks for this degree');
      coefficients.push(x);
    }
    // Reweighted on TWO residuals, and it takes both to see a cloud.
    //
    // Blueness, one-sided: a patch of frame can only be less blue than the sky
    // behind it, so a block below the surface has cloud in it and a block above
    // it is noise. That is what finds a lit cumulus, which is white.
    //
    // And brightness, TWO-sided, because the first real tower plate proved the
    // blueness test blind on its own. A cumulus seen against the light has a
    // belly lit by the sky and by nothing else, so it is the sky's own
    // chromaticity almost exactly — measured on that plate, the body's channels
    // sat at 0.95, 0.94 and 0.93 of the background, which is no change of
    // blueness at all. The test accepted the body as sky, the correction
    // followed it down, and the background estimate ate the cloud it was
    // supposed to stand behind. What that body IS is a fifth darker than the
    // sky around it at the same height, and a two-sided test on the log of the
    // brightness sees it at once.
    const blueOff = grid.map((g, k) => {
      const d = design[k];
      const s = coefficients.map((cc) => Math.exp(cc.reduce((t, v, i) => t + v * d[i], 0)));
      return g.blue - blueness(s[0], s[1], s[2]);
    });
    const levelOff = grid.map((g, k) => {
      const d = design[k];
      let e = 0;
      for (let c = 0; c < 3; c++) {
        e += g.colour[c] - coefficients[c].reduce((t, v, i) => t + v * d[i], 0);
      }
      return e / 3;
    });
    const scale = Math.max(1e-4, 1.4826 * median(blueOff.map(Math.abs)));
    // The brightness scale is floored well above the grain: a sky is smooth and
    // its blocks agree to a fraction of a per cent, so an unfloored robust
    // scale would call a two per cent gradient the fit cannot follow a cloud.
    const levelScale = Math.max(0.02, 1.4826 * median(levelOff.map(Math.abs)));
    blueSigma = scale;
    for (let k = 0; k < grid.length; k++) {
      const zb = Math.min(0, blueOff[k]) / scale;
      const zl = levelOff[k] / levelScale;
      grid[k].weight = Math.exp(-0.5 * (zb * zb + zl * zl));
    }
  }

  const poly = (u, v, out) => {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += coefficients[c][i] * (u ** basis[i][0]) * (v ** basis[i][1]);
      out[c] = s;
    }
    return out;
  };

  // ------------------------------------------------------ and what it missed
  //
  // A surface of six numbers is the right shape for a clear sky and it is not
  // the exact shape of one: the halo round the sun falls off as an exponential
  // and not as a parabola, and the couple of display levels between the two are
  // enough to put a wash of false coverage down one side of every piece. So
  // what the polynomial leaves is measured on the blocks that are certainly
  // sky, and carried across the ones that are not.
  //
  // Carried by DIFFUSION rather than by a wide blur, and the difference
  // matters. A blur asks what the sky is behind a bank by averaging what is
  // near it, and near a bank two hundred texels wide there is nothing; a
  // harmonic fill asks the same question and answers it with the smoothest
  // surface that agrees with the whole margin, which is the answer a sky
  // actually has. It cannot follow a cloud because it never sees one: only
  // blocks the robust weight accepted, and only those whose neighbours were
  // accepted too, are ever read.
  const solid = new Uint8Array(cols * rows);
  const index = new Int32Array(cols * rows).fill(-1);
  for (let k = 0; k < grid.length; k++) index[grid[k].row * cols + grid[k].column] = k;
  for (let k = 0; k < grid.length; k++) {
    if (grid[k].weight < 0.8) continue;
    let clean = 1;
    for (let dy = -1; dy <= 1 && clean; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const r = grid[k].row + dy; const c = grid[k].column + dx;
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
        const j = index[r * cols + c];
        // A block beside a cloud has the cloud's own skirt in its mean, and the
        // skirt is exactly what must not be subtracted from itself.
        if (j < 0 || grid[j].weight < 0.5) { clean = 0; break; }
      }
    }
    solid[grid[k].row * cols + grid[k].column] = clean;
  }

  const correction = [0, 1, 2].map(() => new Float32Array(cols * rows));
  const tmp = [0, 0, 0];
  for (let k = 0; k < grid.length; k++) {
    if (!solid[grid[k].row * cols + grid[k].column]) continue;
    poly(grid[k].x, grid[k].y, tmp);
    for (let c = 0; c < 3; c++) {
      correction[c][grid[k].row * cols + grid[k].column] = grid[k].mean[c] - tmp[c];
    }
  }
  for (let c = 0; c < 3; c++) {
    const field = correction[c];
    const next = new Float32Array(field);
    for (let pass = 0; pass < relax; pass++) {
      for (let r = 0; r < rows; r++) {
        for (let q = 0; q < cols; q++) {
          const o = r * cols + q;
          if (solid[o]) { next[o] = field[o]; continue; }
          let sum = 0; let count = 0;
          if (q > 0) { sum += field[o - 1]; count++; }
          if (q < cols - 1) { sum += field[o + 1]; count++; }
          if (r > 0) { sum += field[o - cols]; count++; }
          if (r < rows - 1) { sum += field[o + cols]; count++; }
          next[o] = count ? sum / count : 0;
        }
      }
      field.set(next);
    }
  }

  const at = (x, y, out) => {
    poly((x / width) * 2 - 1, (y / height) * 2 - 1, out);
    // Everything above is a logarithm; what comes out of this is a colour.
    // Bilinear in the block grid, because a correction that stepped from block
    // to block would be a grid of seams in the coverage.
    const bx = Math.min(cols - 1.001, Math.max(0, (x / width) * cols - 0.5));
    const by = Math.min(rows - 1.001, Math.max(0, (y / height) * rows - 0.5));
    const x0 = Math.floor(bx); const y0 = Math.floor(by);
    const fx = bx - x0; const fy = by - y0;
    for (let c = 0; c < 3; c++) {
      const f = correction[c];
      out[c] = Math.exp(out[c]
        + (f[y0 * cols + x0] * (1 - fx) + f[y0 * cols + x0 + 1] * fx) * (1 - fy)
        + (f[(y0 + 1) * cols + x0] * (1 - fx) + f[(y0 + 1) * cols + x0 + 1] * fx) * fy);
    }
    return out;
  };

  // What the field does not explain where it is certainly sky: the floor under
  // everything the matte can claim to resolve, this plate's own.
  const sigma = [0, 0, 0];
  let mass = 0;
  for (let k = 0; k < grid.length; k++) {
    if (!solid[grid[k].row * cols + grid[k].column]) continue;
    at((grid[k].x + 1) / 2 * width, (grid[k].y + 1) / 2 * height, tmp);
    for (let c = 0; c < 3; c++) sigma[c] += (grid[k].mean[c] - Math.log(Math.max(1e-5, tmp[c]))) ** 2;
    mass++;
  }
  for (let c = 0; c < 3; c++) sigma[c] = Math.sqrt(sigma[c] / Math.max(1, mass));

  return {
    at,
    coefficients,
    sigma,
    blueSigma,
    skyBlocks: mass,
    blocks: grid.length,
  };
}
