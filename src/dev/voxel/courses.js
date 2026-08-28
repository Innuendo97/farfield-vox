import { MONOLITHS } from '../../world/layout.js';

// The masonry and the stone tile, as arithmetic.
//
// Pure arrays and no three.js, for the same reason the mesher is: this is where
// the block count and the tile come from, and both have to be checkable under
// plain node instead of only through a browser. src/core/sky.js cannot be
// imported outside the bundler — it reads its preset out of a bare JSON import
// — so anything that has to answer offline has to stand clear of it.

const DEG = Math.PI / 180;

/** Height of one course, in metres. */
export const COURSE = 0.22;

/** The three lengths a block is cut to, in metres. */
export const LENGTHS = [0.22, 0.44, 0.66];

// The chamfer, in metres, and it is REAL GEOMETRY and not a painted edge.
//
// At the distance the reference is drawn from a baked highlight would do; at
// the distance a walker stands from a block it would not, and the whole
// argument about the near ground is that geometry reads BETTER than a bake
// there rather than worse. Three centimetres is what a dressed edge on a block
// this size actually takes.
export const CHAMFER = 0.028;

/** How many metres of wall one repeat of the stone tile covers. */
export const STONE_METRES = 1.6;

export function hash(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** One octave of value noise on a lattice that wraps at `cells`. */
function wrapValue(u, v, cells, seed) {
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  const fu = smooth(u - iu);
  const fv = smooth(v - iv);
  const at = (a, b) => hash(((a % cells) + cells) % cells, ((b % cells) + cells) % cells, seed);
  const a = at(iu, iv);
  const b = at(iu + 1, iv);
  const c = at(iu, iv + 1);
  const d = at(iu + 1, iv + 1);
  return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
}

// A handful of hairlines, laid as straight chords across the tile and wrapped,
// because a crack in stone is a straight thing at this scale and one drawn out
// of noise curves and reads as a smear.
const CRACKS = [];
for (let i = 0; i < 9; i++) {
  const a = hash(i, 3, 91) * Math.PI;
  CRACKS.push({
    nx: Math.cos(a),
    ny: Math.sin(a),
    d: hash(i, 7, 17),
    width: 0.0016 + 0.0022 * hash(i, 11, 29),
  });
}

function crackAt(u, v) {
  let most = 0;
  for (const c of CRACKS) {
    // Wrapped: the distance to the nearest COPY of the line, so a crack that
    // leaves one side of the tile comes back in on the other and the wall it
    // is repeated over has no seam to hide.
    let t = u * c.nx + v * c.ny - c.d;
    t -= Math.round(t);
    const bite = Math.max(0, 1 - Math.abs(t) / c.width);
    if (bite > most) most = bite;
  }
  return most * most;
}

/**
 * The stone tile: mottling in red, the same surface as a HEIGHT in green.
 *
 * THE ONE PLACE "EVERY VOXEL HAS A TEXTURE" IS TRUE. On grass and foliage the
 * reference has flat colour with a strong spread of tint and no texture at all;
 * on rock and stone every face carries a real albedo. So the atlas is spent
 * here and nowhere else, which is both the faithful reading and the cheap one.
 *
 * Two channels and not three, for the reason src/world/terrain.js gives over
 * DETAIL.relief: a height read twice a step apart IS a slope, so the little
 * shade on a chip costs one more fetch of a texture already in hand and not one
 * stored normal.
 *
 * GENERATED, NOT DELIVERED. It costs no manifest entry, no encode and no byte
 * of the first frame — a stronger answer to the weight question than a
 * dev-scoped asset would have been, and one that needs no exclusion to hold.
 */
export function stoneTileData(side = 512) {
  const data = new Uint8Array(side * side * 2);
  const octaves = [
    { cells: 4, gain: 0.42 },
    { cells: 11, gain: 0.26 },
    { cells: 27, gain: 0.17 },
    { cells: 64, gain: 0.10 },
  ];
  let weight = 0;
  for (const o of octaves) weight += o.gain;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      let mottle = 0;
      for (let o = 0; o < octaves.length; o++) {
        const { cells, gain } = octaves[o];
        mottle += gain * wrapValue((x / side) * cells, (y / side) * cells, cells, o * 37 + 5);
      }
      mottle /= weight;
      const crack = crackAt(x / side, y / side);
      const level = Math.max(0, Math.min(1, mottle * (1 - 0.55 * crack)));
      const o2 = (y * side + x) * 2;
      data[o2] = Math.round(level * 255);
      // The height is the same surface: on this stone the pale grain stands
      // proud and the crack is the hollow, which is what a photograph of it
      // shows and what makes one field able to answer both questions.
      data[o2 + 1] = Math.round(level * 255);
    }
  }
  return data;
}

/**
 * The skin of one block, course by course, as flat arrays.
 *
 * Skin and not solid: nothing inside a wall is ever seen, and a generator that
 * filled it would pay for a hundred times the blocks to draw the same picture.
 *
 * @param {object} spec an entry of src/world/layout.js
 */
export function buildMasonry(spec) {
  const [width, height, depth] = spec.size;
  const courses = Math.max(1, Math.round(height / COURSE));
  const rise = height / courses;

  const positions = [];
  const normals = [];
  const block = [];   // where in its own block a fragment stands, nought to one
  const stone = [];   // and where on the wall, in metres, for the tile
  const indices = [];
  let blocks = 0;

  const quad = (n, corners, uv, metres) => {
    const base = positions.length / 3;
    for (let i = 0; i < 4; i++) {
      positions.push(corners[i][0], corners[i][1], corners[i][2]);
      normals.push(n[0], n[1], n[2]);
      block.push(uv[i][0], uv[i][1]);
      stone.push(metres[i][0], metres[i][1]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  // The four walls, each with the axis it runs along and the outward normal.
  const walls = [
    { n: [0, 0, 1], span: width, at: depth / 2, axis: 'x' },
    { n: [0, 0, -1], span: width, at: -depth / 2, axis: 'x' },
    { n: [1, 0, 0], span: depth, at: width / 2, axis: 'z' },
    { n: [-1, 0, 0], span: depth, at: -width / 2, axis: 'z' },
  ];

  for (let c = 0; c < courses; c++) {
    const y0 = c * rise;
    const y1 = y0 + rise;
    const yFace = y1 - CHAMFER;
    for (let w = 0; w < walls.length; w++) {
      const wall = walls[w];
      const half = wall.span / 2;
      // The stagger, which is what makes this masonry rather than a grid: a
      // course starts part of a block along from the one under it, so no
      // vertical joint runs up more than a course or two.
      let t = -LENGTHS[0] * (0.35 + 0.55 * hash(c, w, 5));
      while (t < wall.span) {
        const pick = LENGTHS[Math.floor(
          hash(c * 97 + w, Math.round(t * 100), 13) * LENGTHS.length,
        )];
        const a = Math.max(0, t);
        const b = Math.min(wall.span, t + pick);
        t += pick;
        if (b - a < 0.02) continue;
        blocks++;
        const p = (u, y, inset) => {
          // A point on this wall: `u` along its own axis from the near corner,
          // `inset` how far back from the outer plane the chamfer has pulled it.
          const out = wall.at - Math.sign(wall.at) * inset;
          const along = u - half;
          return wall.axis === 'x' ? [along, y, out] : [out, y, along];
        };
        // The face of the block, stopped short of the top by the chamfer. The
        // two ends are wound so the outward normal is the one above.
        const flip = wall.at < 0;
        const f0 = flip ? b : a;
        const f1 = flip ? a : b;
        quad(wall.n,
          [p(f0, y0, 0), p(f1, y0, 0), p(f1, yFace, 0), p(f0, yFace, 0)],
          [[0, 0], [1, 0], [1, 1], [0, 1]],
          [[a, y0], [b, y0], [b, yFace], [a, yFace]]);
        // And the dressed edge over it, leaning up and out: it is lit as the
        // facet it is, which is where the reference's bright arris comes from
        // with nothing fitted to make its brightness and its blue agree.
        const lean = [wall.n[0] * 0.7071, 0.7071, wall.n[2] * 0.7071];
        quad(lean,
          [p(f0, yFace, 0), p(f1, yFace, 0), p(f1, y1, CHAMFER), p(f0, y1, CHAMFER)],
          [[0, 0.86], [1, 0.86], [1, 1], [0, 1]],
          [[a, yFace], [b, yFace], [b, y1], [a, y1]]);
      }
    }
  }

  // The cap, inset all round by the same dressed edge, and the four facets that
  // run to it. Without them the head of the block is a sharp arris against the
  // sky, which is the one edge in the whole frame the eye finds first.
  const hx = width / 2 - CHAMFER;
  const hz = depth / 2 - CHAMFER;
  const top = height;
  quad([0, 1, 0],
    [[-hx, top, -hz], [-hx, top, hz], [hx, top, hz], [hx, top, -hz]],
    [[0, 0], [0, 1], [1, 1], [1, 0]],
    [[0, 0], [0, depth], [width, depth], [width, 0]]);
  const brim = top - CHAMFER;
  const rim = [
    { n: [0, 0.7071, 0.7071], a: [-width / 2, brim, depth / 2], b: [width / 2, brim, depth / 2], c: [hx, top, hz], d: [-hx, top, hz] },
    { n: [0, 0.7071, -0.7071], a: [width / 2, brim, -depth / 2], b: [-width / 2, brim, -depth / 2], c: [-hx, top, -hz], d: [hx, top, -hz] },
    { n: [0.7071, 0.7071, 0], a: [width / 2, brim, depth / 2], b: [width / 2, brim, -depth / 2], c: [hx, top, -hz], d: [hx, top, hz] },
    { n: [-0.7071, 0.7071, 0], a: [-width / 2, brim, -depth / 2], b: [-width / 2, brim, depth / 2], c: [-hx, top, hz], d: [-hx, top, -hz] },
  ];
  for (const r of rim) {
    quad(r.n, [r.a, r.b, r.c, r.d], [[0, 0.86], [1, 0.86], [1, 1], [0, 1]],
      [[0, brim], [1, brim], [1, top], [0, top]]);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    block: new Float32Array(block),
    stone: new Float32Array(stone),
    indices: indices.length > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
    blocks,
    courses,
    rise,
    quads: indices.length / 6,
    vertices: positions.length / 3,
    angle: spec.rotationY * DEG,
  };
}

/** Every block of the hub, for the estimate the demo's one block scales to. */
export function masonryCensus() {
  return MONOLITHS.map((spec) => {
    const built = buildMasonry(spec);
    return {
      id: spec.id, blocks: built.blocks, courses: built.courses, quads: built.quads,
    };
  });
}
