// THE WINDING OF A FACE, THE HOLES OF A SHELL, AND THE RAYS THAT GET INSIDE.
//
// TWO DEFECTS OF THE SAME FAMILY HAVE SHIPPED ON THIS WORLD, and both were found
// by LOOKING and never by a check: the sheet beyond the disc, 7.168 triangles
// wound clockwise under a FrontSide material, delivered as sky for two hundred
// metres (E-FOND-PIANO10); and four of the flower's nine quads, wound inward, of
// which the rasterizer drew five (E-FIORI3). In both, the numbers anybody would
// have taken -- one draw, so many triangles, normals pointing up -- were CORRECT
// and the surface was not on the screen. Nothing in the repository read a
// winding, so nothing could have said so.
//
// This is what reads one. It is deliberately NOT a renderer: it takes the
// positions and the indices a builder writes and answers three questions that
// are properties of the numbers alone, so the answer does not depend on a
// camera, a material, a driver or a frame.
//
//   windingCensus   for every triangle, does its right-handed normal agree with
//                   the normal the geometry DECLARES? A triangle that disagrees
//                   is the one the rasterizer throws away. Also the degenerate
//                   ones -- zero area draws nothing and costs the same.
//   shellCensus     for a mesh meant to be CLOSED: the edges carried by a single
//                   triangle (a hole), the edges whose two triangles are wound
//                   AGAINST each other (a flip, which needs no declared normal
//                   to be seen), and the signed volume, whose sign says whether
//                   the whole thing is inside out.
//   rayBench        eight bearings by three elevations of parallel rays through
//                   the silhouette, counting the rays whose NEAREST hit is a
//                   back face. That is what a hole looks like from outside, and
//                   it is the only one of the three that catches a face which is
//                   simply MISSING -- a face nobody wrote has no winding to read.
//
// WHY ALL THREE AND NOT ONE. Each is blind where another sees. windingCensus
// needs a declared normal and most hand-written geometry declares none.
// shellCensus needs the mesh to be closed and a billboard never is. rayBench
// needs no declaration and no closure but cannot name the triangle. Run
// together they have no common blind spot, and that is the point.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const n = len(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

/**
 * The positions, indices and normals of anything a builder hands over.
 *
 * A builder on this world returns one of three shapes -- a THREE BufferGeometry,
 * the plain arrays a worker posts back, or a list of quads written by hand --
 * and a bench that only understood one of them would be a bench nobody could
 * point at the geometry that actually shipped.
 *
 * @param {object} source BufferGeometry-shaped, {positions,indices,normals}, or
 *        {faces:[{corners:[points], normal?}]}
 * @returns {{positions: Float64Array, indices: Uint32Array, normals: Float64Array|null}}
 */
export function readMesh(source) {
  if (!source) throw new Error('readMesh: nothing to read');
  if (source.__mesh) return source;
  if (Array.isArray(source.faces)) return fromFaces(source.faces);
  if (Array.isArray(source) && source.length && source[0] && source[0].corners) {
    return fromFaces(source);
  }
  const attr = source.attributes;
  const posSrc = attr ? attr.position && attr.position.array : source.positions;
  if (!posSrc) throw new Error('readMesh: no positions');
  const normSrc = attr
    ? (attr.normal ? attr.normal.array : null)
    : (source.normals || null);
  let idxSrc = attr
    ? (source.index ? source.index.array : null)
    : (source.indices || null);
  const positions = Float64Array.from(posSrc);
  const normals = normSrc ? Float64Array.from(normSrc) : null;
  if (!idxSrc) {
    // A non-indexed buffer is still a triangle list; the bench works on indices
    // so that one code path answers for both.
    idxSrc = new Uint32Array(positions.length / 3);
    for (let i = 0; i < idxSrc.length; i++) idxSrc[i] = i;
  }
  return { __mesh: true, positions, indices: Uint32Array.from(idxSrc), normals };
}

/** A list of quads or triangles with an optional declared normal, as a mesh. */
function fromFaces(faces) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (const face of faces) {
    const c = face.corners;
    const base = positions.length / 3;
    for (const p of c) {
      positions.push(p[0], p[1], p[2]);
      const n = face.normal || null;
      normals.push(n ? n[0] : 0, n ? n[1] : 0, n ? n[2] : 0);
    }
    // The fan is the index buffer every hand-written quad on this world uses.
    for (let k = 2; k < c.length; k++) indices.push(base, base + k - 1, base + k);
  }
  const declared = faces.some((f) => f.normal);
  return {
    __mesh: true,
    positions: Float64Array.from(positions),
    indices: Uint32Array.from(indices),
    normals: declared ? Float64Array.from(normals) : null,
  };
}

const corner = (positions, i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];

/**
 * Every triangle's own normal against the one the geometry declares.
 *
 * The declared normal is averaged over the triangle's three vertices rather than
 * taken from the first, because a builder that smooths its normals gives three
 * different ones and any single pick would report a flip that is not there.
 *
 * @param {object} source anything readMesh accepts
 * @returns {{faces:number, reversed:number, degenerate:number, undeclared:number,
 *            worst:{tri:number, cosine:number}|null, samples:number[]}}
 */
export function windingCensus(source) {
  const { positions, indices, normals } = readMesh(source);
  const triangles = indices.length / 3;
  let reversed = 0;
  let degenerate = 0;
  let undeclared = 0;
  let worst = null;
  const samples = [];
  for (let t = 0; t < triangles; t++) {
    const ia = indices[t * 3];
    const ib = indices[t * 3 + 1];
    const ic = indices[t * 3 + 2];
    const a = corner(positions, ia);
    const b = corner(positions, ib);
    const c = corner(positions, ic);
    const g = cross(sub(b, a), sub(c, a));
    const area = len(g);
    // Degeneracy is judged against the triangle's OWN size: an absolute epsilon
    // calls every millimetre-wide flower petal degenerate and every kilometre of
    // sheet sound.
    const reach = Math.max(len(sub(b, a)), len(sub(c, a)), len(sub(c, b)));
    if (area <= reach * reach * 1e-9) { degenerate++; continue; }
    if (!normals) { undeclared++; continue; }
    const d = [0, 1, 2].map((k) => (normals[ia * 3 + k] + normals[ib * 3 + k]
      + normals[ic * 3 + k]) / 3);
    if (len(d) < 1e-9) { undeclared++; continue; }
    const cosine = dot(norm(g), norm(d));
    if (cosine < 0) {
      reversed++;
      if (samples.length < 12) samples.push(t);
    }
    if (!worst || cosine < worst.cosine) worst = { tri: t, cosine };
  }
  return { faces: triangles, reversed, degenerate, undeclared, worst, samples };
}

/**
 * What a mesh meant to be CLOSED is missing, and whether it is inside out.
 *
 * Edges are keyed by POSITION and not by index. Every builder on this world
 * writes four fresh vertices per quad, so two triangles that share an edge share
 * no index at all: keyed by index, a sound cube would report twelve holes.
 *
 * @param {object} source anything readMesh accepts
 * @param {{weld?: number}} [opts] the distance under which two corners are one
 * @returns {{faces:number, boundary:number, inconsistent:number, nonManifold:number,
 *            volume:number, closed:boolean}}
 */
export function shellCensus(source, opts = {}) {
  const { positions, indices } = readMesh(source);
  const weld = opts.weld ?? 1e-6;
  const key = new Map();
  const id = new Uint32Array(positions.length / 3);
  for (let v = 0; v < id.length; v++) {
    const k = [0, 1, 2].map((c) => Math.round(positions[v * 3 + c] / weld)).join(',');
    let got = key.get(k);
    if (got === undefined) { got = key.size; key.set(k, got); }
    id[v] = got;
  }
  const edges = new Map();
  const triangles = indices.length / 3;
  let volume = 0;
  for (let t = 0; t < triangles; t++) {
    const v = [id[indices[t * 3]], id[indices[t * 3 + 1]], id[indices[t * 3 + 2]]];
    const a = corner(positions, indices[t * 3]);
    const b = corner(positions, indices[t * 3 + 1]);
    const c = corner(positions, indices[t * 3 + 2]);
    volume += dot(a, cross(b, c)) / 6;
    for (let e = 0; e < 3; e++) {
      const from = v[e];
      const to = v[(e + 1) % 3];
      if (from === to) continue;
      const k = from < to ? `${from}:${to}` : `${to}:${from}`;
      let slot = edges.get(k);
      if (!slot) { slot = { forward: 0, backward: 0 }; edges.set(k, slot); }
      if (from < to) slot.forward++; else slot.backward++;
    }
  }
  let boundary = 0;
  let inconsistent = 0;
  let nonManifold = 0;
  for (const slot of edges.values()) {
    const uses = slot.forward + slot.backward;
    if (uses === 1) { boundary++; continue; }
    if (uses > 2) { nonManifold++; continue; }
    // Two triangles of one surface traverse their shared edge in OPPOSITE
    // directions. Both the same way is a flip, and it is visible without any
    // declared normal at all -- which is the only handle on geometry that
    // computes its normals instead of writing them.
    if (slot.forward === 2 || slot.backward === 2) inconsistent++;
  }
  return {
    faces: triangles,
    boundary,
    inconsistent,
    nonManifold,
    volume,
    closed: boundary === 0 && nonManifold === 0,
  };
}

/**
 * EIGHT BEARINGS BY THREE ELEVATIONS OF RAYS, AND THE ONES THAT GET INSIDE.
 *
 * This is U-FIORI-3's bench made general. A ray is fired at the thing from
 * outside; if the nearest surface it meets is turned AWAY from it, the eye is
 * standing inside the object, which is exactly what a face that was culled or
 * never written looks like from the outside. It is the only one of the three
 * counts that needs no declaration and no closure, and the only one that catches
 * a face that is simply absent.
 *
 * The sheet is orthographic on purpose: the count is then a property of the
 * geometry and not of a focal length, so two builds are comparable.
 *
 * THE VERDICT IS TAKEN ON THE WINDING AND NOT ON THE DECLARED NORMAL, and the
 * distinction is the whole defect. What the rasterizer culls is the sign of the
 * triangle's area in screen space -- its WINDING. The normal attribute never
 * reaches that decision: it only shades what survived it. A quad wound backwards
 * under a normal that still points out is therefore invisible while every normal
 * in the buffer says the surface is there, which is exactly how seven thousand
 * triangles of ground shipped as sky. A bench that asked the normal would have
 * called that ground sound.
 *
 * @param {object} source anything readMesh accepts
 * @param {{grid?:number, bearings?:number, elevations?:number[], margin?:number,
 *          side?:'front'|'back'|'double'}} [opts] side is the material's, because
 *        a DoubleSide material culls nothing and cannot have this defect
 * THE COUNT IS SPLIT IN TWO, AND THE SPLIT IS THE WHOLE USEFULNESS OF IT. The
 * objects of this world are not closed solids standing in a void: a chunk is a
 * CROP of a bigger surface, a block of masonry has no underside because it sits
 * on the ground, the shell is an annulus open at both rims. Every one of those
 * lets a ray in, and none of them is a defect. A single number would therefore
 * report a hole in every population and be worth nothing.
 *
 * So each ray that gets in is asked WHY, and the geometry itself answers:
 *
 *   holesFlipped  the nearest surface is turned away from the eye by its
 *                 WINDING while the normal it DECLARES is turned towards it.
 *                 The builder meant this face to be seen and the rasterizer
 *                 throws it away. This is the defect, and this is the number
 *                 that must be zero.
 *   holesOpen     the nearest surface is turned away by both. Nothing was ever
 *                 written where the eye is looking, which is what an honest crop
 *                 or a face resting on the ground looks like.
 *
 * Where no normal is declared the two cannot be told apart and the rays land in
 * holesUndeclared, which is reported as such and never quietly as zero.
 *
 * @returns {{sweeps:number, rays:number, struck:number, holes:number,
 *            holesFlipped:number, holesOpen:number, holesUndeclared:number,
 *            worst:{holes:number, bearing:number, elevation:number}, seen:number}}
 */
export function rayBench(source, opts = {}) {
  const { positions, indices, normals } = readMesh(source);
  const grid = opts.grid ?? 96;
  const bearings = opts.bearings ?? 8;
  const elevations = opts.elevations ?? [-8, 12, 40];
  const margin = opts.margin ?? 1.35;
  const side = opts.side ?? 'front';
  const triangles = indices.length / 3;
  if (!triangles) throw new Error('rayBench: no triangles');

  const facing = new Float64Array(triangles * 3);
  const claimed = normals ? new Float64Array(triangles * 3) : null;
  for (let t = 0; t < triangles; t++) {
    const flip = side === 'back' ? -1 : 1;
    const ia = indices[t * 3];
    const ib = indices[t * 3 + 1];
    const ic = indices[t * 3 + 2];
    const g = norm(cross(sub(corner(positions, ib), corner(positions, ia)),
      sub(corner(positions, ic), corner(positions, ia))));
    facing[t * 3] = g[0] * flip;
    facing[t * 3 + 1] = g[1] * flip;
    facing[t * 3 + 2] = g[2] * flip;
    if (!claimed) continue;
    const d = [0, 1, 2].map((k) => (normals[ia * 3 + k] + normals[ib * 3 + k]
      + normals[ic * 3 + k]) / 3);
    const n = len(d) > 1e-9 ? norm(d) : null;
    claimed[t * 3] = n ? n[0] : 0;
    claimed[t * 3 + 1] = n ? n[1] : 0;
    claimed[t * 3 + 2] = n ? n[2] : 0;
  }

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < positions.length / 3; v++) {
    for (let k = 0; k < 3; k++) {
      const p = positions[v * 3 + k];
      if (p < lo[k]) lo[k] = p;
      if (p > hi[k]) hi[k] = p;
    }
  }
  const mid = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
  const span = Math.max(...[0, 1, 2].map((k) => hi[k] - lo[k])) || 1;
  const stand = span * 1.2;

  let rays = 0;
  let struck = 0;
  let holes = 0;
  let holesFlipped = 0;
  let holesOpen = 0;
  let holesUndeclared = 0;
  let worst = { holes: 0, bearing: 0, elevation: elevations[0] };
  const seen = new Set();
  const DEG = Math.PI / 180;
  for (let b = 0; b < bearings; b++) {
    const az = (b / bearings) * Math.PI * 2;
    for (const el of elevations) {
      const e = el * DEG;
      const away = [Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e)];
      const eye = [mid[0] + away[0] * stand, mid[1] + away[1] * stand,
        mid[2] + away[2] * stand];
      const dir = norm(sub(mid, eye));
      const right = norm(cross(Math.abs(dir[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0], dir));
      const up = cross(dir, right);
      const sheet = span * margin;

      // A screen-space bin per triangle, so a chunk of fifty thousand faces is
      // measurable at all: without it every ray would test every triangle and
      // the bench would only ever run on a flower.
      const bins = new Map();
      const project = (p) => {
        const d = sub(p, eye);
        return [dot(d, right), dot(d, up)];
      };
      const toCell = (s) => Math.floor(((s / sheet) + 0.5) * grid);
      for (let t = 0; t < triangles; t++) {
        const p0 = project(corner(positions, indices[t * 3]));
        const p1 = project(corner(positions, indices[t * 3 + 1]));
        const p2 = project(corner(positions, indices[t * 3 + 2]));
        const x0 = Math.max(0, toCell(Math.min(p0[0], p1[0], p2[0])));
        const x1 = Math.min(grid - 1, toCell(Math.max(p0[0], p1[0], p2[0])));
        const y0 = Math.max(0, toCell(Math.min(p0[1], p1[1], p2[1])));
        const y1 = Math.min(grid - 1, toCell(Math.max(p0[1], p1[1], p2[1])));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const k = y * grid + x;
            let slot = bins.get(k);
            if (!slot) { slot = []; bins.set(k, slot); }
            slot.push(t);
          }
        }
      }

      let here = 0;
      for (let iy = 0; iy < grid; iy++) {
        for (let ix = 0; ix < grid; ix++) {
          const sx = ((ix + 0.5) / grid - 0.5) * sheet;
          const sy = ((iy + 0.5) / grid - 0.5) * sheet;
          const from = [eye[0] + right[0] * sx + up[0] * sy,
            eye[1] + right[1] * sx + up[1] * sy,
            eye[2] + right[2] * sx + up[2] * sy];
          rays++;
          const slot = bins.get(iy * grid + ix);
          if (!slot) continue;
          let best = Infinity;
          let bestTri = -1;
          for (const t of slot) {
            const s = hitTriangle(positions, indices, t, from, dir);
            if (s !== null && s < best) { best = s; bestTri = t; }
          }
          if (bestTri < 0) continue;
          struck++;
          seen.add(bestTri);
          // A DoubleSide material draws the back of a face, so the eye never
          // looks THROUGH one: the count is nil by construction and saying so is
          // more honest than reporting a zero that was never measured.
          if (side === 'double') continue;
          const away = dot([facing[bestTri * 3], facing[bestTri * 3 + 1],
            facing[bestTri * 3 + 2]], dir) >= 0;
          if (!away) continue;
          holes++;
          here++;
          if (!claimed) { holesUndeclared++; continue; }
          const towards = dot([claimed[bestTri * 3], claimed[bestTri * 3 + 1],
            claimed[bestTri * 3 + 2]], dir) < 0;
          if (towards) holesFlipped++; else holesOpen++;
        }
      }
      if (here > worst.holes) worst = { holes: here, bearing: b, elevation: el };
    }
  }
  return {
    sweeps: bearings * elevations.length,
    rays, struck, holes, holesFlipped, holesOpen, holesUndeclared,
    worst, seen: seen.size,
  };
}

/** Moller-Trumbore, two-sided: the bench decides what to do with a back face. */
function hitTriangle(positions, indices, t, eye, dir) {
  const a = corner(positions, indices[t * 3]);
  const b = corner(positions, indices[t * 3 + 1]);
  const c = corner(positions, indices[t * 3 + 2]);
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const p = cross(dir, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  const tv = sub(eye, a);
  const u = dot(tv, p) * inv;
  if (u < 0 || u > 1) return null;
  const q = cross(tv, e1);
  const v = dot(dir, q) * inv;
  if (v < 0 || u + v > 1) return null;
  const s = dot(e2, q) * inv;
  return s > 1e-9 ? s : null;
}

/**
 * The three counts of one population in one call.
 *
 * @param {string} name what it is, for the report
 * @param {object} source anything readMesh accepts
 * @param {{closed?:boolean, rays?:object|false}} [opts] closed says whether the
 *        holes and the volume are meaningful -- a billboard is not a shell and a
 *        boundary edge on one is not a defect.
 */
export function census(name, source, opts = {}) {
  const mesh = readMesh(source);
  const winding = windingCensus(mesh);
  const shell = shellCensus(mesh);
  const rays = opts.rays === false ? null : rayBench(mesh, opts.rays || {});
  return { name, closed: opts.closed ?? false, winding, shell, rays };
}

/** One line per population, in the columns the census table wants. */
export function line(result) {
  const w = result.winding;
  const s = result.shell;
  const r = result.rays;
  return `${result.name.padEnd(26)} ${String(w.faces).padStart(7)}`
    + ` ${String(w.reversed).padStart(9)} ${String(w.degenerate).padStart(6)}`
    + ` ${String(s.boundary).padStart(9)} ${String(s.inconsistent).padStart(7)}`
    + ` ${r ? String(r.holesFlipped).padStart(8) : '       -'}`
    + ` ${r ? String(r.holesOpen + r.holesUndeclared).padStart(8) : '       -'}`;
}

export const HEADER = `${'population'.padEnd(26)} ${'written'.padStart(7)}`
  + ` ${'reversed'.padStart(9)} ${'degen'.padStart(6)} ${'open-edge'.padStart(9)}`
  + ` ${'flipped'.padStart(7)} ${'ray-cull'.padStart(8)} ${'ray-open'.padStart(8)}`;

/**
 * A closed box, written the way this world writes one, for validating the bench.
 *
 * The bench is a measuring instrument and lesson 5 of the method says an
 * instrument is validated before it is believed. This is the specimen it is
 * validated on: sound in one direction, and defective in the other once a caller
 * flips or removes a face.
 */
export function referenceBox(size = 1) {
  const h = size / 2;
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  return dirs.map((n) => {
    // The two tangents are chosen so that (u, v, n) is right-handed by
    // construction, which is the whole trick: a face derived from its normal
    // cannot be wound against it by a typing mistake.
    const up = Math.abs(n[1]) > 0.5 ? [0, 0, 1] : [0, 1, 0];
    const u = norm(cross(up, n));
    const v = cross(n, u);
    const c = (su, sv) => [0, 1, 2].map((k) => n[k] * h + u[k] * su * h + v[k] * sv * h);
    return { normal: n, corners: [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)] };
  });
}

/** The same box with one face wound backwards -- the defect of E-FOND-PIANO10. */
export function flipFace(faces, which = 0) {
  return faces.map((f, i) => (i === which
    ? { normal: f.normal, corners: [...f.corners].reverse() }
    : f));
}

/** The same box with one face never written -- the defect of E-FIORI3's stalk. */
export function dropFace(faces, which = 0) {
  return faces.filter((_, i) => i !== which);
}
