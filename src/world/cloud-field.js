// THE WEATHER'S ARITHMETIC, WITH NOTHING A BROWSER OWNS IN IT.
//
// No three.js, no DOM, no JSON import: everything reachable from here runs on
// the page, under plain node, and inside a guard, from one source. It is the
// same rule src/world/voxel/pure.js states for the ground, and it is here for
// the same reason: the numbers this unit is judged on -- how much of each band
// of sky is cloud, how many separate masses stand in the frame, how wide a cube
// is in degrees -- are all silhouette, and a silhouette is arithmetic. A guard
// that can lay the same field offline and count the same pixels is what turns a
// screenshot into a measurement.
//
// WHAT A CUMULUS IS HERE. A field of density, thresholded onto a grid of cubes
// whose SIDE GROWS WITH THE DISTANCE, so that the cube subtends the same angle
// at six hundred metres as at three hundred. That one law is the whole of why
// this reads as the reference: R4 §1.4 measured the reference's own cloud and
// found the step of the cube constant at 12.3-13.5 px -- 0.61 to 0.67 degrees --
// from the largest mass to the smallest wisp over the crests, while our
// photographic plates carried it at 41-45 px across and 13-15 down, because a
// photograph of cubes cut at one scale and stood at eight is a photograph of
// eight different cubes.
//
// A cube of 0.64 degrees at six hundred metres is 6.7 m -- sixty voxels of the
// meadow. That is not an inconsistency, it is the scale the illustration chose
// so that a cube stays legible at every distance, and it can only be reproduced
// by a side that grows with the distance.

import { bearingOf, directionOf } from './compass.js';

export const DEG = Math.PI / 180;

// The apparent step of the cube, in degrees, read off the reference at the
// fitted pose (R4 §1.4). Everything about the size of the grids follows from
// it and from the angular size of a mass: a grid is 2*tan(w/2)/tan(CUBE_DEG)
// cells across whatever distance the mass stands at.
export const CUBE_DEG = 0.64;

// -------------------------------------------------------------- the camera
//
// One projection, shared by the page's sanity checks and by the guard, because
// two cameras is how a guard comes to pass a frame nobody is looking at.

/**
 * The fitted camera, as a projection and its inverse.
 *
 * @param {object} pose  position, yaw and pitch in degrees, fov in degrees
 * @param {number} width  frame width in pixels
 * @param {number} height frame height in pixels
 */
export function makeCamera(pose, width, height) {
  const yaw = pose.yaw * DEG;
  const pitch = pose.pitch * DEG;
  const cy = Math.cos(yaw); const sy = Math.sin(yaw);
  const cp = Math.cos(pitch); const sp = Math.sin(pitch);
  // The basis the world's own convention gives: yaw is measured as
  // atan2(-x, -z), so yaw nought looks along -Z and a positive pitch looks up.
  const right = [cy, 0, -sy];
  const up = [sp * sy, cp, sp * cy];
  const forward = [-cp * sy, sp, -cp * cy];
  const eye = [pose.position.x, pose.position.y, pose.position.z];
  const F = (height / 2) / Math.tan(pose.fov / 2 * DEG);
  const horizon = height / 2 + F * Math.tan(pitch);
  return {
    width, height, F, horizon, eye, right, up, forward,
    /** Where a world point lands, or null if it is behind the lens. */
    project(p) {
      const vx = p[0] - eye[0]; const vy = p[1] - eye[1]; const vz = p[2] - eye[2];
      const z = vx * forward[0] + vy * forward[1] + vz * forward[2];
      if (z <= 1e-3) return null;
      const x = vx * right[0] + vy * right[1] + vz * right[2];
      const y = vx * up[0] + vy * up[1] + vz * up[2];
      return [width / 2 + F * x / z, height / 2 - F * y / z, z];
    },
    /** The elevation a row of the frame stands at, in degrees. */
    elevOfRow(r) { return Math.atan((horizon - r) / F) / DEG; },
    rowOfElev(e) { return horizon - F * Math.tan(e * DEG); },
  };
}

/**
 * Where a mass stands in the world, from its bearing, elevation and distance.
 *
 * THE BEARING IS THE COMPASS BEARING, which is the one assets-src/sky/sky.json
 * already states the sun at -- atan2(x, -z), nought at north and positive to
 * the east. It is NOT the yaw of a pose, which is the opposite sign
 * (atan2(-x, -z)), and the two are worth naming out loud because a roster read
 * off a photograph through the wrong one is a sky that is right and mirrored.
 *
 * And it is measured from the EYE OF THE FITTED POSE, because the roster is a
 * reading of one photograph taken from one place: a bearing and an elevation
 * only mean a position once it is said where they were read from.
 */
export function placeMass(mass, eye) {
  const el = mass.el * DEG;
  const [dx, , dz] = directionOf(mass.az);
  const flat = Math.cos(el) * mass.D;
  return [eye[0] + dx * flat, eye[1] + Math.sin(el) * mass.D, eye[2] + dz * flat];
}

// ---------------------------------------------------------------- the noise
//
// Value noise on integers, three octaves. Deterministic and portable: the same
// integers give the same field on the page, in a guard and in a bake, which is
// what lets the guard count the frame's own cubes rather than a likeness.
function hash3(x, y, z, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)
    + Math.imul(z, 2147483647) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);

function valueNoise(x, y, z, seed) {
  const x0 = Math.floor(x); const y0 = Math.floor(y); const z0 = Math.floor(z);
  const fx = smooth(x - x0); const fy = smooth(y - y0); const fz = smooth(z - z0);
  let v = 0;
  for (let dz = 0; dz < 2; dz++) {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
        v += w * hash3(x0 + dx, y0 + dy, z0 + dz, seed);
      }
    }
  }
  return v;
}

function fbm(x, y, z, seed) {
  return 0.55 * valueNoise(x, y, z, seed)
    + 0.30 * valueNoise(x * 2.1 + 7, y * 2.1 + 3, z * 2.1 + 1, seed + 1)
    + 0.15 * valueNoise(x * 4.3 + 2, y * 4.3 + 9, z * 4.3 + 5, seed + 2);
}

// ------------------------------------------------------ the field of density
//
// A cumulus with a FLAT BASE and a crown of towers, eroded at the edges. The
// three pieces are the three things R4 read on the reference's own masses: no
// cloud in the reference dips below its own base; the crown is a cauliflower of
// many small heads rather than three wide ones; and the edge is loose cubes
// standing off the body, which is what a threshold on noise gives for free.
//
// THE TOWERS ARE MANY AND NARROW ON PURPOSE. R4 §S2 traced the one thing the
// prototype could not reach -- the depth of the reference's own shadow scale,
// p5/p95 61/91 against its 69/87 -- to shape and not to light: from the fitted
// pose the eye is UNDER the base of every mass, so what it sees are fronts and
// undersides, and the dark step of the reference comes from bases exposed
// between narrow towers. Wide towers have no gaps to be dark in.

/**
 * One mass, thresholded onto its own grid.
 *
 * @param {object} mass a roster entry: angular width and height, seed, towers
 * @param {object} [shape] the law's own numbers, shared by every mass
 * @returns {{cells: Uint8Array, nx: number, ny: number, nz: number, count: number}}
 */
export function voxelise(mass, shape = SHAPE) {
  // UNA NUVOLA NON PUO' ESSERE PIU' PICCOLA DI UN CUBO, e il minimo e' UNO e
  // non tre: le nuvolette che il target mostra sopra le creste misurano da
  // cinque a otto cubi in tutto, e un pavimento di tre per tre per tre ne fa
  // quattordici -- tre volte il vero, e abbastanza da saldare due masse che nel
  // target stanno separate.
  const nx = Math.max(1, Math.round(2 * Math.tan(mass.w / 2 * DEG) / Math.tan(CUBE_DEG * DEG)));
  const ny = Math.max(1, Math.round(2 * Math.tan(mass.h / 2 * DEG) / Math.tan(CUBE_DEG * DEG)));
  const nz = Math.max(1, Math.round(nx * (mass.depth ?? shape.depth)));
  const seed = mass.seed;
  const base = mass.base ?? shape.base;
  const erode = mass.erode ?? shape.erode;
  const fill = mass.fill ?? shape.fill;
  const slab = mass.slab ?? shape.slab;
  const threshold = mass.threshold ?? shape.threshold;
  // HOW MUCH OF ITS OWN RECTANGLE THE CROWN FILLS, per mass. See the note over
  // SHAPE for why this is the knob and neither the level nor the body is.
  const bulk = mass.bulk ?? shape.bulk;
  const cells = new Uint8Array(nx * ny * nz);
  const rx = nx / 2; const rz = nz / 2;
  const baseY = base * ny;
  const heads = [];
  const nt = Math.max(2, Math.round((mass.towers ?? 3) * shape.towerScale));
  for (let t = 0; t < nt; t++) {
    heads.push({
      x: rx + (hash3(t, 1, 2, seed) - 0.5) * nx * shape.towerSpread,
      z: rz + (hash3(t, 3, 4, seed) - 0.5) * nz * shape.towerSpread,
      r: bulk * (shape.towerRadius[0]
        + (shape.towerRadius[1] - shape.towerRadius[0]) * hash3(t, 5, 6, seed))
        * Math.min(nx, nz) + 1.0,
      // LA CIMA DELLA TESTA PIU' ALTA E' LA CIMA DEL RETTANGOLO, per
      // costruzione, e la prima testa ci arriva sempre. Cosi' la taglia scritta
      // nel roster E' la taglia che si vede, e il fit non deve inseguirla: un
      // primo giro la inseguiva -- griglia contro area, ognuna che disfaceva
      // il lavoro dell'altra -- e una massa alta diciassette gradi e' arrivata
      // a chiederne ventotto.
      h: (shape.towerHeight[0]
        + (shape.towerHeight[1] - shape.towerHeight[0]) * hash3(t, 7, 8, seed))
        * (ny - baseY),
    });
  }
  const scale = shape.grain / Math.max(nx, nz);
  // Il disco si assottiglia col corpo, ma non sotto un cubo: e' la base piatta
  // vista quasi di taglio da un occhio che sta sotto, e serve a TENERE INSIEME
  // le teste. Se non si assottigliasse sarebbe lui il pavimento dell'area, e
  // nessuna massa potrebbe scendere sotto il quaranta per cento del proprio
  // rettangolo -- che e' sopra la mediana del target.
  const slabHalf = Math.max(0.6, slab * ny / 2 * Math.min(1, bulk));
  const slabMid = baseY + slabHalf;
  let count = 0;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const px = x + 0.5; const py = y + 0.5; const pz = z + 0.5;
        // THE BASE SLAB: a flat disc of cloud lying on the mass's own base,
        // wide and thin. It is what holds the crown together -- the reference
        // shows one connected mass and not a bouquet -- and it is NOT scaled by
        // `bulk`, because a crown that thins out over a base that thins out
        // with it comes apart into the dozen wisps a first fit here produced.
        const ex = (px - rx) / rx; const ez = (pz - rz) / rz;
        const sy = (py - slabMid) / slabHalf;
        let d = 1 - Math.max(Math.sqrt(ex * ex + ez * ez) / fill, Math.abs(sy));
        for (const tp of heads) {
          const tx = (px - tp.x) / tp.r; const tz = (pz - tp.z) / tp.r;
          // A HEAD IS A CAPSULE AND NOT A BALL. Written as one three-norm --
          // which is what the prototype had -- a head narrowed to a third of
          // its radius becomes a small SPHERE at its own foot: every mass
          // collapses onto its base, and the frame that comes out carries the
          // reference's total of white with almost none of it above eighteen
          // degrees. Measured on the fit before this line: 3% of the top band
          // against the reference's 13, and 53% of the middle against its 42.
          // A capsule -- a column from the base to the top, domed over --
          // narrows and keeps every metre of its height, which is also the
          // shape R4 §S2 asks the next unit for: narrow heads with the base
          // left exposed between them.
          const ty = (py - baseY) / tp.h;
          const over = Math.max(0, ty - 1) * (tp.h / tp.r);
          const rad = Math.sqrt(tx * tx + tz * tz);
          d = Math.max(d, 1 - Math.sqrt(rad * rad + over * over));
        }
        // Nothing under the base: the base of a cumulus is flat, and every mass
        // in the reference stands on one.
        if (py < baseY) d -= 2;
        const n = fbm(px * scale, py * scale, pz * scale, seed) - 0.5;
        if (d + n * erode > threshold) { cells[(z * ny + y) * nx + x] = 1; count++; }
      }
    }
  }
  return { cells, count, nx, ny, nz };
}

/** The law's own numbers, one set for every mass in the sky. */
export const SHAPE = {
  // QUANTO E' PROFONDA UNA MASSA, in frazione della sua larghezza. Poco: la
  // silhouette di un ammasso di teste sparse in TRE dimensioni e' la loro
  // ombra, e teste sparpagliate in profondita' quanto in larghezza fanno
  // un'ombra piena. Il target mostra masse la cui sagoma copre dal 31 al 78 per
  // cento del proprio rettangolo, con baie di blu che entrano fin dentro: e'
  // una nuvola larga e piatta vista da sotto, non una palla.
  depth: 0.55,
  // La base sta in basso e le torri arrivano in cima: la massa riempie il
  // proprio rettangolo, cosi' la taglia scritta nel roster e' la taglia che
  // si vede e non una da moltiplicare per un fattore che nessuno ha scritto.
  base: 0.10,
  erode: 0.5,
  // Il disco della base: quanto e' largo, in frazione della mezza larghezza,
  // e quanto e' alto, in frazione dell'altezza.
  fill: 1.0,
  slab: 0.34,
  threshold: 0.05,
  bulk: 1,
  grain: 3.4,
  towerScale: 2.2,
  towerSpread: 0.85,
  towerRadius: [0.15, 0.30],
  towerHeight: [0.35, 1.0],
};

// ------------------------------------------------------------ the greedy mesh
//
// Six directions, one layer at a time, coplanar exposed faces fused into
// maximal rectangles. The key is the normal alone: the colour is worked out in
// the fragment from the normal and from which cube is behind it, so two faces
// never fail to fuse over a difference that is not geometry.
const AXES = [0, 1, 2];

function greedy(grid, emit) {
  const { cells, nx, ny, nz } = grid;
  const at = (x, y, z) => ((x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz)
    ? 0 : cells[(z * ny + y) * nx + x]);
  const dims = [nx, ny, nz];
  for (const d of AXES) {
    const u = (d + 1) % 3; const v = (d + 2) % 3;
    const x = [0, 0, 0]; const q = [0, 0, 0]; q[d] = 1;
    const mask = new Int8Array(dims[u] * dims[v]);
    for (x[d] = -1; x[d] < dims[d];) {
      let n = 0;
      for (x[v] = 0; x[v] < dims[v]; x[v]++) {
        for (x[u] = 0; x[u] < dims[u]; x[u]++) {
          const a = at(x[0], x[1], x[2]);
          const b = at(x[0] + q[0], x[1] + q[1], x[2] + q[2]);
          mask[n++] = a === b ? 0 : (a ? 1 : -1);
        }
      }
      x[d]++;
      n = 0;
      for (let j = 0; j < dims[v]; j++) {
        for (let i = 0; i < dims[u];) {
          const c = mask[n];
          if (!c) { i++; n++; continue; }
          let w = 1;
          while (i + w < dims[u] && mask[n + w] === c) w++;
          let h = 1;
          outer: for (; j + h < dims[v]; h++) {
            for (let k = 0; k < w; k++) if (mask[n + k + h * dims[u]] !== c) break outer;
          }
          x[u] = i; x[v] = j;
          const du = [0, 0, 0]; du[u] = w;
          const dv = [0, 0, 0]; dv[v] = h;
          const normal = [0, 0, 0]; normal[d] = c;
          const p0 = [x[0], x[1], x[2]];
          const p1 = [x[0] + du[0], x[1] + du[1], x[2] + du[2]];
          const p2 = [x[0] + du[0] + dv[0], x[1] + du[1] + dv[1], x[2] + du[2] + dv[2]];
          const p3 = [x[0] + dv[0], x[1] + dv[1], x[2] + dv[2]];
          emit(c > 0 ? [p0, p1, p2, p3] : [p0, p3, p2, p1], normal);
          for (let l = 0; l < h; l++) for (let k = 0; k < w; k++) mask[n + k + l * dims[u]] = 0;
          i += w; n += w;
        }
      }
    }
  }
}

// ---------------------------------------------------------------- the field
/**
 * Every mass of a roster, voxelised and meshed into one set of quads.
 *
 * The arrays come back flat and untyped by three.js so that a guard, a worker
 * and the page all build the same thing. `cube` carries the side of the cube
 * each vertex belongs to, in metres, which is what lets one fragment programme
 * draw a cube's own edges at every distance.
 *
 * @param {object[]} roster the masses, each with az, el, D, w, h, seed, towers
 * @param {object} [opts] cubeDeg and the shape's numbers
 */
export function buildCloudField(roster, { cubeDeg = CUBE_DEG, shape = SHAPE, eye } = {}) {
  const positions = []; const normals = []; const cube = []; const index = [];
  const masses = [];
  let quads = 0; let cubes = 0;
  const at = eye || [0, 0, 0];
  for (const mass of roster) {
    const grid = voxelise(mass, shape);
    cubes += grid.count;
    const s = mass.D * Math.tan(cubeDeg * DEG);
    const centre = placeMass(mass, at);
    const { nx, ny, nz } = grid;
    const first = quads;
    greedy(grid, (corners, normal) => {
      const base = positions.length / 3;
      for (const p of corners) {
        positions.push(
          centre[0] + (p[0] - nx / 2) * s,
          centre[1] + (p[1] - ny / 2) * s,
          centre[2] + (p[2] - nz / 2) * s,
        );
        normals.push(normal[0], normal[1], normal[2]);
        cube.push(s);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      quads++;
    });
    masses.push({
      id: mass.id ?? null, az: mass.az, el: mass.el, D: mass.D, side: s,
      cubes: grid.count, quads: quads - first, grid: [nx, ny, nz],
      centre,
    });
  }
  // THE ORDER THE QUADS ARE DRAWN IN, AND IT IS NOT FREE.
  //
  // The weather does not write depth -- see the note over the material for why
  // that is not a choice -- so inside the field there is nothing to sort the
  // faces but the order they are handed to the card in. Left as the mesher
  // emits them, that order is the order of the grids, and the far side of a
  // mass paints over its near side wherever the two are both front facing:
  // a tower behind another tower, drawn second, stands in front of it.
  //
  // Back face culling takes half of it and cannot take the rest, because both
  // faces of that pair face the eye. What takes the rest is the painter's own
  // answer -- far first -- worked out ONCE here, from the eye the roster was
  // read at. It stays right as the walker moves, because the meadow is fourteen
  // metres across and the nearest mass is three hundred away; and it stays
  // right as the wind blows, because the wind moves every mass by the same
  // vector and an equal translation does not reorder distances.
  const order = new Array(quads);
  for (let q = 0; q < quads; q++) {
    const i = q * 12;
    const cx = (positions[i] + positions[i + 3] + positions[i + 6] + positions[i + 9]) / 4;
    const cy = (positions[i + 1] + positions[i + 4] + positions[i + 7] + positions[i + 10]) / 4;
    const cz = (positions[i + 2] + positions[i + 5] + positions[i + 8] + positions[i + 11]) / 4;
    order[q] = [q, (cx - at[0]) ** 2 + (cy - at[1]) ** 2 + (cz - at[2]) ** 2];
  }
  order.sort((a, b) => b[1] - a[1]);
  const sorted = new Uint32Array(quads * 6);
  for (let k = 0; k < quads; k++) {
    const base = order[k][0] * 4;
    sorted[k * 6] = base; sorted[k * 6 + 1] = base + 1; sorted[k * 6 + 2] = base + 2;
    sorted[k * 6 + 3] = base; sorted[k * 6 + 4] = base + 2; sorted[k * 6 + 5] = base + 3;
  }
  return {
    positions, normals, cube, index: sorted, quads, cubes, triangles: quads * 2, masses,
  };
}

// ------------------------------------------------ the sky the frame never shows
//
// THE SAME LAW AT THE SAME DENSITY, ALL THE WAY ROUND (E-V6m's default A).
// The reference is one photograph of eighty degrees of compass; a world is
// three hundred and sixty of them, and a walker who turns round must not find
// the weather stop at the edge of a picture. So the bearings the reference
// never showed are filled by drawing from the distribution of the ones it did:
// the same range of angular sizes, the same range of elevations, the same law
// of distance. Nothing here is a reading of anything, and it says so.
//
// It is also what the shadow on the meadow is made of. See SHADOW below: the
// masses that darken the grass stand to the west-north-west, which is exactly
// where the reference's own frame does not look.
export function beyondRoster(seen, opts = {}) {
  const { seed = 907, bearings = [40, 320], per = 1 } = opts;
  if (!seen.length) return [];
  const span = bearings[1] - bearings[0];
  const n = Math.max(0, Math.round(seen.length * (span / 80) * per));
  const out = [];
  // THE ONES THAT ACTUALLY DARKEN THE GRASS, and there is a piece of geometry
  // behind them that is easy to get wrong. The sun stands at 51 degrees, so a
  // mass at height h throws its shadow 1/tan(51) = 0.81 h metres along the
  // ground away from it. For that shadow to land ON the meadow the mass has to
  // stand at a horizontal distance of about 0.81 h from the meadow -- which is
  // to say at an elevation of about 51 degrees, IN THE DIRECTION OF THE SUN.
  // Nothing in the reference's own frame is anywhere near: its masses top out
  // at 26 degrees and stand to the north, and their shadows land three hundred
  // metres east of the grass. Measured, before this block existed: the mask
  // came back with nought texels in it.
  //
  // So the weather that shadows the meadow is up and to the west-north-west,
  // where the reference's camera never looked -- which is also exactly what R1
  // read at the feet of the blocks, an isotropic darkness with no cloud over
  // it, and what R4 §S6 predicted.
  for (const m of (opts.sunward ? sunward(seen, opts.sunward, seed) : [])) out.push(m);
  for (let k = 0; k < n; k++) {
    const pick = seen[Math.floor(hash3(k, 3, 7, seed) * seen.length) % seen.length];
    out.push({
      ...pick,
      az: +(bearings[0] + hash3(k, 11, 5, seed) * span).toFixed(2),
      el: +(pick.el * (0.75 + 0.5 * hash3(k, 17, 2, seed))).toFixed(2),
      D: Math.round(pick.D * (0.8 + 0.45 * hash3(k, 23, 13, seed))),
      seed: 4000 + k,
      beyond: true,
    });
  }
  return out;
}

// ------------------------------------------------ the silhouette, offline
//
// What the frame would show of this field, as coverage and as a normal, without
// a browser. Coverage is what every band target in R4 §1.2 is stated in, and it
// is pure geometry: a quad is opaque, and the nearest one wins.

/**
 * Rasterises the field through a camera.
 *
 * @returns {{cover: Uint8Array, ny: Float32Array, depth: Float32Array}}
 *   cover is 1 where a face stands, `ny` the vertical component of that face's
 *   normal, and depth its distance along the lens axis.
 */
export function rasterise(field, camera) {
  const { width: W, height: H } = camera;
  const cover = new Uint8Array(W * H);
  const normalY = new Float32Array(W * H);
  const sunDot = new Float32Array(W * H);
  const depth = new Float32Array(W * H).fill(Infinity);
  const P = field.positions;
  const N = field.normals;
  const pts = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let q = 0; q < field.quads; q++) {
    const v0 = q * 4;
    let behind = false;
    for (let k = 0; k < 4; k++) {
      const i = (v0 + k) * 3;
      const p = camera.project([P[i], P[i + 1], P[i + 2]]);
      if (!p) { behind = true; break; }
      pts[k] = p;
    }
    if (behind) continue;
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const p of pts) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    const ix0 = Math.max(0, Math.ceil(x0 - 0.5)); const ix1 = Math.min(W - 1, Math.floor(x1 + 0.5));
    const iy0 = Math.max(0, Math.ceil(y0 - 0.5)); const iy1 = Math.min(H - 1, Math.floor(y1 + 0.5));
    if (ix1 < ix0 || iy1 < iy0) continue;
    const n = [N[v0 * 3], N[v0 * 3 + 1], N[v0 * 3 + 2]];
    const z = (pts[0][2] + pts[1][2] + pts[2][2] + pts[3][2]) / 4;
    for (let y = iy0; y <= iy1; y++) {
      for (let x = ix0; x <= ix1; x++) {
        if (!inQuad(pts, x + 0.5, y + 0.5)) continue;
        const i = y * W + x;
        if (z >= depth[i]) continue;
        depth[i] = z; cover[i] = 1; normalY[i] = n[1];
        sunDot[i] = n[0] * SUN_HINT[0] + n[1] * SUN_HINT[1] + n[2] * SUN_HINT[2];
      }
    }
  }
  return { cover, normalY, sunDot, depth };
}

// The seal's own sun, carried here as three numbers so that the offline
// silhouette can say which faces are lit without importing the sky -- which
// would drag a JSON import into a file that must not have one. It is asserted
// against assets-src/sky/sky.json by the guard, so it cannot drift.
export const SUN_HINT = [-0.627787398207, 0.777145961457, -0.043899171335];

function inQuad(pts, px, py) {
  // Two triangles, both wound the same way as the quad the mesher emitted; the
  // sign of the cross product is taken from the quad itself so a face seen from
  // behind is filled rather than dropped.
  return inTri(pts[0], pts[1], pts[2], px, py) || inTri(pts[0], pts[2], pts[3], px, py);
}
function inTri(a, b, c, px, py) {
  const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
  const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1]);
  const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1]);
  const neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(neg && pos);
}

// ---------------------------------------------------------- what is SKY here
//
// A BAND OF SKY IS NOT A BAND OF ROWS ANY MORE, AND THIS IS THE ONE PLACE THE
// FOUNDATION DEPARTS FROM R4's OWN ARITHMETIC.
//
// R4 read its bands straight off the rows because the cornice of the day was a
// painted ring that no class of pixel picked up. U-CORNICE-1 replaced it with
// hills of real cubes seen through seven hundred metres of air, and air that
// far out develops to L* 77 at chroma 19 -- pale, blue, unsaturated. Measured:
// those hills pass BOTH of R4 §1.1's classes. A band read without a horizon
// therefore counts a hillside as cloud, and the lowest band of this world,
// which is hill from edge to edge, comes back 48% white with nothing in the sky
// at all.
//
// So the denominator is the sky this world actually has: every row above the
// skyline at that column. The same mask is laid over the reference, so the two
// are still one measurement -- what it takes off the reference is the strip
// between ITS crests and OURS, which is sky the frame cannot show anyway.

/**
 * The row the world's own horizon stands at, column by column.
 *
 * @param {object} camera from makeCamera
 * @param {(bearingDeg: number) => number} elevationAt the skyline's elevation
 *   at a compass bearing, in degrees -- cornice.mjs's own answer, passed in
 *   rather than imported, so this file keeps no opinion about the hills
 */
export function skylineRows(camera, elevationAt) {
  const rows = new Float32Array(camera.width);
  for (let x = 0; x < camera.width; x++) {
    const dx = x + 0.5 - camera.width / 2;
    const d = [
      dx * camera.right[0] + camera.F * camera.forward[0],
      dx * camera.right[1] + camera.F * camera.forward[1],
      dx * camera.right[2] + camera.F * camera.forward[2],
    ];
    const bearing = bearingOf(d[0], d[2]);
    rows[x] = camera.rowOfElev(elevationAt(bearing));
  }
  return rows;
}

/**
 * How much of each band of sky a coverage buffer fills.
 *
 * @param {Uint8Array} cover  one byte a pixel, 1 where cloud stands
 * @param {object} camera
 * @param {Float32Array} skyline the row the horizon stands at, per column
 * @param {number[][]} bands  pairs of rows
 */
export function bandCoverage(cover, camera, skyline, bands) {
  const { width: W } = camera;
  return bands.map(([a, b]) => {
    let sky = 0; let cloud = 0;
    for (let y = a; y < b; y++) {
      for (let x = 0; x < W; x++) {
        if (y >= skyline[x]) continue;
        sky++;
        if (cover[y * W + x]) cloud++;
      }
    }
    return {
      rows: `${a}-${b}`,
      elev: [camera.elevOfRow(b), camera.elevOfRow(a)],
      sky,
      cloud,
      whiteOverSky: sky ? 100 * cloud / sky : 0,
    };
  });
}

// ------------------------------------------------- the shadow on the meadow
//
// THE SEAT, AND ONLY THE SEAT (E-DECISIONI21 D5 = A). What is built here is
// WHERE the cloud shadow falls; the term that reads it in the ground's own
// fragment is not this unit's to write, and src/world/voxel/campo-material.js
// is not this unit's to touch.
//
// The geometry, from R4 §S6: with the sun at 51 degrees a mass at height h
// throws its shadow 1/tan(51) = 0.81 h metres along the ground, away from the
// sun -- east-south-east, since the seal's sun stands at bearing 274. So the
// clouds that darken the meadow are NOT the ones in the reference's frame,
// which stand north: they are the ones out to the west-north-west, at two to
// four hundred metres and a hundred and fifty to three hundred of height. The
// reference shows none of them, and that is consistent with what R1 measured at
// the feet of the blocks -- an isotropic darkness with no cloud over it.
export const SHADOW = { size: 64, metres: 32 };

/**
 * The shadow the field throws on the ground plane, as a coverage mask.
 *
 * @param {object} field  the built field
 * @param {number[]} sun  the direction the light comes FROM, unit
 * @param {object} [opts] centre of the disc, its half width in metres, and the
 *   texels across it
 * @returns {{data: Uint8Array, size: number, metres: number, centre: number[]}}
 */
export function cloudShadowMask(field, sun = SUN_HINT, opts = {}) {
  const size = opts.size ?? SHADOW.size;
  const metres = opts.metres ?? SHADOW.metres;
  const centre = opts.centre ?? [0, 0];
  const data = new Uint8Array(size * size);
  // Along the shadow ray a point at height y lands y/sun.y further along -sun.
  const P = field.positions;
  const step = (2 * metres) / size;
  for (let q = 0; q < field.quads; q++) {
    // One sample per quad, at its centre: a quad is at most a few cubes wide
    // and the mask is half a metre a texel over a disc thirty metres across.
    let cx = 0; let cy = 0; let cz = 0;
    for (let k = 0; k < 4; k++) {
      const i = (q * 4 + k) * 3;
      cx += P[i]; cy += P[i + 1]; cz += P[i + 2];
    }
    cx /= 4; cy /= 4; cz /= 4;
    if (cy <= 0 || sun[1] <= 0) continue;
    const t = cy / sun[1];
    const gx = cx - sun[0] * t; const gz = cz - sun[2] * t;
    const u = Math.round((gx - centre[0] + metres) / step);
    const v = Math.round((gz - centre[1] + metres) / step);
    if (u < 0 || v < 0 || u >= size || v >= size) continue;
    data[v * size + u] = 255;
  }
  return { data, size, metres, centre };
}

/** How much shadow stands over one point of the ground, from a mask. */
export function shadowAt(mask, x, z) {
  const step = (2 * mask.metres) / mask.size;
  const u = Math.floor((x - mask.centre[0] + mask.metres) / step);
  const v = Math.floor((z - mask.centre[1] + mask.metres) / step);
  if (u < 0 || v < 0 || u >= mask.size || v >= mask.size) return 0;
  return mask.data[v * mask.size + u] / 255;
}

/** The masses that stand between the sun and the meadow, and only those. */
function sunward(seen, spec, seed) {
  const out = [];
  const big = seen.slice(0, Math.max(1, Math.round(seen.length / 4)));
  for (let k = 0; k < spec.count; k++) {
    const pick = big[k % big.length];
    const t = (k + 0.5) / spec.count;
    out.push({
      ...pick,
      az: +(spec.bearings[0] + t * (spec.bearings[1] - spec.bearings[0])).toFixed(2),
      el: +(spec.el[0] + hash3(k, 31, 3, seed) * (spec.el[1] - spec.el[0])).toFixed(2),
      D: Math.round(spec.D[0] + hash3(k, 37, 11, seed) * (spec.D[1] - spec.D[0])),
      seed: 6000 + k,
      beyond: true,
      sunward: true,
    });
  }
  return out;
}
