// THE FIGURE'S SURFACE, MERGED. Pure arithmetic: no three.js, no browser.
//
// WHAT IT PRODUCES, AND WHY THAT IS ALL IT PRODUCES. Three buffers — positions,
// normals, indices — and nothing else, which is the same three the meadow's
// chunks upload. The rule behind that is the recipe's first architectural line
// and it was measured: a per-voxel property carried in a vertex costs three
// times the geometry, because a vertex that has to be told which cell it belongs
// to cannot be shared between cells and the merge below stops happening.
//
// SO THE MERGE IGNORES COLOUR, and that is the whole trick rather than a
// shortcut. A rectangle here may run from the jacket across the seam onto the
// pack, because the fragment works out its own cell and asks the plan what
// colour that cell is. Split the merge at every palette change and the figure's
// quads roughly double for a picture nobody could tell apart.
//
// THE ALGORITHM is the ordinary two pass greedy sweep, once per bearing: a slice
// perpendicular to each axis carries a mask of cells that are solid and whose
// neighbour in that bearing is not, the mask is grown along one in-plane axis
// and then along the other while the whole row still matches, and each rectangle
// leaves as one quad. Nothing is welded afterwards: a quad brings its own four
// corners, so triangles are twice the quads and vertices four times them, and
// there is no shared-vertex pass to go wrong.
import { BODY_M, CELLS, paletteAt } from './plan.js';

/**
 * The occupancy lattice, one byte a cell, with the palette in it.
 *
 * The palette rides along because it costs nothing here and because a caller
 * that wants to know what the figure is made of — a count, a proof, a
 * personalisation — should not have to walk the box list a second time and risk
 * walking it differently. Empty is -1.
 */
export function fill(bounds, body = BODY_M) {
  const nx = bounds.x1 - bounds.x0 + 1;
  const ny = bounds.y1 - bounds.y0 + 1;
  const nz = bounds.z1 - bounds.z0 + 1;
  const cells = new Int8Array(nx * ny * nz).fill(-1);
  for (const b of body) {
    if (!b.solid) continue;
    for (let j = b.y0; j <= b.y1; j++) {
      for (let k = b.z0; k <= b.z1; k++) {
        for (let i = b.x0; i <= b.x1; i++) {
          const p = ((j - bounds.y0) * nz + (k - bounds.z0)) * nx + (i - bounds.x0);
          cells[p] = b.palette;
        }
      }
    }
  }
  // The palette a cell ends up with is the LAST box that covers it, which the
  // loop above already gives — but only for solid boxes. Anything that colours
  // without filling is applied here, over cells that already exist, so that the
  // one answer in the plan stays the one answer.
  for (const b of body) {
    if (b.solid) continue;
    for (let j = b.y0; j <= b.y1; j++) {
      for (let k = b.z0; k <= b.z1; k++) {
        for (let i = b.x0; i <= b.x1; i++) {
          const p = ((j - bounds.y0) * nz + (k - bounds.z0)) * nx + (i - bounds.x0);
          if (cells[p] >= 0) cells[p] = b.palette;
        }
      }
    }
  }
  return {
    cells, nx, ny, nz, bounds,
  };
}

/** How many cells are filled, and how many of those have a face in the open. */
export function census(grid) {
  const {
    cells, nx, ny, nz,
  } = grid;
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz
    ? -1 : cells[(j * nz + k) * nx + i]);
  let filled = 0;
  let shell = 0;
  for (let j = 0; j < ny; j++) {
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        if (at(i, j, k) < 0) continue;
        filled++;
        if (at(i - 1, j, k) < 0 || at(i + 1, j, k) < 0
          || at(i, j - 1, k) < 0 || at(i, j + 1, k) < 0
          || at(i, j, k - 1) < 0 || at(i, j, k + 1) < 0) shell++;
      }
    }
  }
  return { filled, shell };
}

/**
 * The merged surface of a filled lattice.
 *
 * @param {object} grid  from {@link fill}
 * @param {number} cell  the size of one cell, in metres
 * @returns {{positions: Float32Array, normals: Int8Array, indices: Uint16Array,
 *            quads: number, triangles: number, sphere: object}}
 */
export function surface(grid, cell) {
  const {
    cells, nx, ny, nz, bounds,
  } = grid;
  const size = [nx, ny, nz];
  const origin = [bounds.x0, bounds.y0, bounds.z0];
  const at = (c) => (c[0] < 0 || c[1] < 0 || c[2] < 0
    || c[0] >= nx || c[1] >= ny || c[2] >= nz
    ? -1 : cells[(c[1] * nz + c[2]) * nx + c[0]]);

  const quads = [];
  const here = [0, 0, 0];
  const there = [0, 0, 0];

  for (let axis = 0; axis < 3; axis++) {
    // (axis, u, v) is a cyclic permutation of (x, y, z), so it is right handed
    // and a loop that goes along u and then along v has its normal on +axis.
    // That is what decides the winding below, and it is the reason u and v are
    // taken in this order rather than sorted.
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const mask = new Uint8Array(size[u] * size[v]);

    for (let dir = -1; dir <= 1; dir += 2) {
      for (let slice = 0; slice < size[axis]; slice++) {
        mask.fill(0);
        for (let b = 0; b < size[v]; b++) {
          for (let a = 0; a < size[u]; a++) {
            here[axis] = slice; here[u] = a; here[v] = b;
            if (at(here) < 0) continue;
            there[axis] = slice + dir; there[u] = a; there[v] = b;
            // A face exists where a solid cell looks out at nothing. Outside
            // the lattice counts as nothing, which is what puts a skin on the
            // figure's own edges.
            if (at(there) < 0) mask[b * size[u] + a] = 1;
          }
        }

        // Grow along u, then along v while the whole row still matches.
        for (let b = 0; b < size[v]; b++) {
          for (let a = 0; a < size[u];) {
            if (!mask[b * size[u] + a]) { a++; continue; }
            let w = 1;
            while (a + w < size[u] && mask[b * size[u] + a + w]) w++;
            let h = 1;
            grow: while (b + h < size[v]) {
              for (let d = 0; d < w; d++) {
                if (!mask[(b + h) * size[u] + a + d]) break grow;
              }
              h++;
            }
            for (let db = 0; db < h; db++) {
              for (let d = 0; d < w; d++) mask[(b + db) * size[u] + a + d] = 0;
            }
            quads.push({
              axis,
              u,
              v,
              dir,
              // The plane the face lies in: the far side of the cell when
              // looking along +axis, the near side when looking back.
              plane: origin[axis] + slice + (dir > 0 ? 1 : 0),
              u0: origin[u] + a,
              u1: origin[u] + a + w,
              v0: origin[v] + b,
              v1: origin[v] + b + h,
            });
            a += w;
          }
        }
      }
    }
  }

  const count = quads.length;
  const positions = new Float32Array(count * 12);
  const normals = new Int8Array(count * 12);
  const indices = new (count * 4 > 65535 ? Uint32Array : Uint16Array)(count * 6);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];

  const corner = (q, a, b, out) => {
    out[q.axis] = q.plane * cell;
    out[q.u] = a * cell;
    out[q.v] = b * cell;
  };
  const point = [0, 0, 0];

  for (let n = 0; n < count; n++) {
    const q = quads[n];
    const ab = [[q.u0, q.v0], [q.u1, q.v0], [q.u1, q.v1], [q.u0, q.v1]];
    for (let c = 0; c < 4; c++) {
      corner(q, ab[c][0], ab[c][1], point);
      const o = (n * 4 + c) * 3;
      for (let d = 0; d < 3; d++) {
        positions[o + d] = point[d];
        normals[o + d] = d === q.axis ? q.dir * 127 : 0;
        if (point[d] < lo[d]) lo[d] = point[d];
        if (point[d] > hi[d]) hi[d] = point[d];
      }
    }
    const base = n * 4;
    const o = n * 6;
    if (q.dir > 0) {
      indices[o] = base; indices[o + 1] = base + 1; indices[o + 2] = base + 2;
      indices[o + 3] = base; indices[o + 4] = base + 2; indices[o + 5] = base + 3;
    } else {
      indices[o] = base; indices[o + 1] = base + 3; indices[o + 2] = base + 2;
      indices[o + 3] = base; indices[o + 4] = base + 2; indices[o + 5] = base + 1;
    }
  }

  const centre = [0, 1, 2].map((d) => (lo[d] + hi[d]) / 2);
  const radius = Math.hypot(hi[0] - centre[0], hi[1] - centre[1], hi[2] - centre[2]);

  return {
    positions,
    normals,
    indices,
    quads: count,
    triangles: count * 2,
    vertices: count * 4,
    sphere: {
      x: centre[0], y: centre[1], z: centre[2], radius,
    },
  };
}

/** Everything about the figure that can be known without a browser. */
export function build(cell, body = BODY_M) {
  const b = (() => {
    const out = {
      x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity,
    };
    for (const part of body) {
      out.x0 = Math.min(out.x0, part.x0); out.x1 = Math.max(out.x1, part.x1);
      out.y0 = Math.min(out.y0, part.y0); out.y1 = Math.max(out.y1, part.y1);
      out.z0 = Math.min(out.z0, part.z0); out.z1 = Math.max(out.z1, part.z1);
    }
    return out;
  })();
  const grid = fill(b, body);
  return { grid, census: census(grid), ...surface(grid, cell) };
}

export { CELLS, paletteAt };
