import { BufferGeometry, Float32BufferAttribute, Mesh, Vector3 } from 'three';
import { VOXEL, voxelMaterial, voxelSettings } from './voxel/index.js';
import { materialAt } from './contracts.js';
import { AREA_CENTER, MONOLITHS } from './layout.js';

// THE HUB'S TREES. Owned by V4.
//
// They are ALBERELLI and not trees: the tallest of the three the day target
// shows stands a metre and a half, the other two under a metre, and their
// crowns are four to ten cubes across. Anything here that reads as a forest
// tree is wrong before it is drawn.
//
// WHERE THE THREE MEASURED ONES COME FROM. Their crowns were flood filled off
// the day target as the island of not-water that holds each one -- two of the
// three stand against the lake and one against the sky, and water is the one
// class a crown can never be mistaken for -- and their trunks and base rows
// read off the same picture one character per pixel. The pixels were then
// carried into metres through THE POSES AS THEY STAND NOW: the earlier
// inventory went through the camera in ricetta.json, which stands 1.15 m higher
// and sees seven degrees more of this world, and every metre it produced is a
// metre about that camera. Nothing from it survives here.
//
// AND THE FLOOR THEY ARE DERIVED ON IS y = 0, WHICH IS MEASURED. Put the five
// blocks' feet on the plane and on the delivered height field and compare both
// with the picture: the plane lands at 17.1 px rms, the field at 37.0 px and
// biased 31 px the wrong way. The mounds that field carries under the meadow
// are not in this picture. They are V1's, so the derivation stays on the plane
// and the PLANTING follows the floor -- a tree that stands anywhere else than
// on the ground is a worse fault than a tree a few pixels high.

/**
 * The step of the world, and everything here is a whole number of them.
 *
 * Not a preference: the material rebuilds the joint and the lightened arris out
 * of `fract(position / VOXEL)`, so a cube whose faces are not on the lattice
 * gets a joint drawn across its middle. Every position below is snapped.
 */
const V = VOXEL;

// ---------------------------------------------------------------- the pigments
//
// FROM THE SEAT, LIKE THE GRASS SHEET, AND FOR THE SAME REASON. What is
// measured off the target is a RATIO -- the crowns' sunlit top faces against
// the open meadow's sunlit top faces, in one picture under one sun -- and the
// ratio is applied to the meadow's own pigment. So when V1 moves the meadow,
// the foliage moves with it instead of standing at a colour that was right
// against a different green. assets-src/vegetation/palette.json is not used and
// must not be: it is sampled off the photorealistic reference through the light
// of a bake, and its blue is 3.7x out.
//
// crown: linear ratio to the meadow 0.592 / 1.027 / 0.549, on 519 top-face
//        pixels of the three crowns against 15.950 of the eight meadow windows.
//        Saturation 0.653 against the meadow's 0.512 -- foliage in this picture
//        is not darker grass, it is greener grass.
// bark:  a trunk one voxel across at sixteen metres shows two side faces and no
//        top at all, so its level cannot be divided by a top face without
//        charging the light's own top-against-side difference to the pigment.
//        Its HUE is its own pixels; its LEVEL is the bark's side faces against
//        the crowns' side faces -- same orientation, same trees, same sun --
//        which comes to 0.538 of the crown's luminance.
const CROWN_ALBEDO = new Vector3(0.1836, 0.4160, 0.0247);
const BARK_ALBEDO = new Vector3(0.2675, 0.1702, 0.0468);

// ------------------------------------------------------------------ the shape
//
// THE CROWN IS NOT AN ELLIPSOID AND THE PICTURE SAYS SO. Each of the three
// crowns reads as three tiers on the flood fill, and all three agree: full
// width from the bottom to about two thirds of the way up, then a taper to
// about 0.44 of the width at nine tenths, then nothing. Measured, as width over
// the widest row against height over the crown:
//
//   T2 0.24 -> 1.00   T3 0.24 -> 1.00
//   T1 0.50 -> 0.81   T3 0.63 -> 1.00   T2 0.64 -> 0.81   T1 0.66 -> 1.00
//   T3 0.88 -> 0.50   T2 0.90 -> 0.39   T1 0.90 -> 0.43
//
// The 0.81 readings at two thirds are the fringe and not a waist -- they are one
// tier of one tree each, against a full width tier above and below.
const TAPER_FROM = 0.65;
const TAPER_POWER = 0.7;

/** Half width of the crown at a height fraction, one at its widest. */
function profile(u) {
  const taper = u <= TAPER_FROM ? 1 : ((1 - u) / (1 - TAPER_FROM)) ** TAPER_POWER;
  // And it closes a little under itself, where the trunk comes through. The
  // picture cannot see this -- the meadow is in front of it in all three -- so
  // it is the mildest thing that is not a flat disc sitting on a stick.
  const foot = u >= 0.15 ? 1 : 0.78 + 0.22 * (u / 0.15);
  return taper * foot;
}

// How much of the outer shell is bitten away, and from where inwards. A full
// ellipsoid of cubes reads as a ball and the target's crowns read as clumps:
// the edge is ragged at the scale of a single cube, which is the only scale a
// crown four cubes across has.
// Only the OUTERMOST ring is bitten, and that is a triangle count as much as a
// look: a bite taken deeper leaves holes with their own walls, and every hole
// is four quads the greedy merge cannot join to anything. At 0.62 the crowns
// came to 1.06 quads a cell against the 0.77 of a smooth one; here they do not.
const FRINGE_FROM = 0.70;
const FRINGE_BITE = 0.38;

/**
 * Two decorrelated draws from three whole numbers, without a transcendental.
 *
 * The same shape as the pair the material dithers a cube's tint with. It is
 * hashed on the CELL, so a tree is the same tree every run and on every
 * machine: nothing in this world may look different on a second load.
 */
function cellHash(x, y, z) {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * The cells of one crown, in world voxel coordinates.
 *
 * @param {number} cx,cz  the trunk's own column, in voxels
 * @param {number} y0     the crown's lowest row, in voxels
 * @param {number} width  crown width, in voxels
 * @param {number} tall   crown height, in voxels
 */
function crownCells(cx, cz, y0, width, tall, into) {
  // A crown an EVEN number of cubes across cannot be centred on a cell, so its
  // axis sits on the boundary half a cube to one side and it comes out the
  // width it was measured at. Centring it on the trunk instead would round four
  // cubes to three or to five, which on a crown this small is a quarter of it.
  const off = width % 2 === 1 ? 0 : -0.5;
  const r = (width - 1) / 2;
  const reach = Math.ceil(r + 1);
  for (let j = 0; j < tall; j++) {
    const u = (j + 0.5) / tall;
    const half = r * profile(u);
    for (let i = -reach; i <= reach; i++) {
      for (let k = -reach; k <= reach; k++) {
        const d = Math.hypot(i - off, k - off) / Math.max(half, 1e-6);
        if (d > 1.0001) continue;
        if (d > FRINGE_FROM && cellHash(cx + i, y0 + j, cz + k) < FRINGE_BITE) continue;
        into.add(`${cx + i},${y0 + j},${cz + k}`);
      }
    }
  }
}

/** The cells of one trunk: one column of one voxel, which is what is drawn. */
function trunkCells(cx, cz, from, to, into) {
  for (let j = from; j < to; j++) into.add(`${cx},${j},${cz}`);
}

// ------------------------------------------------------------- the three read
//
// x and z in metres on the plane the target stands its blocks on; height, crown
// and trunk in VOXELS, because that is what they were counted in. The pixel
// evidence for each is written beside it so a reader can go back to the picture
// without the tool.
export const MEASURED = [
  {
    id: 'T1',
    // crown x 407..443 rows 602..648, trunk x 419..423 rows 657..673,
    // base row 674 +/- 4 -> range 16.36 m (15.84..16.92)
    x: -5.35, z: -1.03, crown: 5, crownTall: 6, trunkTall: 4,
  },
  {
    id: 'T2',
    // crown x 702..737 rows 556..592, trunk x 714..717 rows 594..611,
    // base row 611 +/- 4 -> range 32.38 m (30.28..34.79). The big one.
    x: -3.74, z: -17.87, crown: 10, crownTall: 10, trunkTall: 5,
  },
  {
    id: 'T3',
    // crown x 1227..1252 rows 599..638; no bark resolvable, its trunk falls in
    // the shaded band, so the base row is 658 +/- 8 read off where the sunlit
    // meadow starts under the crown -> range 18.80 m (17.47..20.35). The band
    // is twice the others' and that is why.
    x: 6.17, z: -3.74, crown: 4, crownTall: 6, trunkTall: 3,
  },
];

// --------------------------------------------------- and the ones out of frame
//
// The two pictures cannot show what stands beside or behind the camera, and a
// hub with trees only where a picture happened to look is a hub that falls apart
// the moment the walker turns round. So the rest of the population is SOWN, out
// of the sizes of the three that were measured and nothing else -- no shape, no
// spacing and no colour is invented here that the picture did not already say.
//
// WHERE THEY MAY STAND, AND WHY IT IS A WEDGE. Both target eyes stand within a
// metre and a half of (-0.58, 14.57) looking very nearly north, and the frame is
// 35.8 degrees wide either side of that. So a point the pictures CANNOT see is
// one whose bearing off north, taken from that stand, is wider than the frame
// plus a margin -- or one behind the stand altogether. Every sown tree is
// checked against the two poses off line and none lands inside either frame.
const STAND = { x: -0.58, z: 14.57 };
/** Half the frame, 35.8 degrees, and four more so a crown cannot lean in. */
const HIDDEN_BEYOND = Math.tan(40 * Math.PI / 180);
/** How far out they are sown, in metres from the walkable centre. */
const SOWN_RADIUS = 20;
/** One candidate every this many metres, jittered inside its own cell. */
const SOWN_STEP = 3.2;
/**
 * And how many of those candidates actually carry a tree.
 *
 * SET BY THE TRIANGLE ALLOCATION AND NOT BY TASTE, because the picture has
 * nothing to say about ground it cannot see: the three measured trees come to
 * about a quarter of the four thousand triangles this session allocated to
 * trees, and this is how many more fit in the rest. It is one number, so moving
 * it is one line.
 */
const SOWN_TAKE = 0.15;
/** Clearance from a block's footprint, in metres. */
const BLOCK_CLEAR = 1.4;

function insideFrame(x, z) {
  const ahead = STAND.z - z;
  if (ahead <= 0) return false;              // behind the stand: never in frame
  return Math.abs(x - STAND.x) < HIDDEN_BEYOND * ahead;
}

function nearBlock(x, z) {
  for (const m of MONOLITHS) {
    const [w, , d] = m.size;
    const a = m.rotationY * Math.PI / 180;
    const dx = x - m.position.x;
    const dz = z - m.position.z;
    const lx = Math.abs(dx * Math.cos(a) - dz * Math.sin(a));
    const lz = Math.abs(dx * Math.sin(a) + dz * Math.cos(a));
    if (lx <= w / 2 + BLOCK_CLEAR && lz <= d / 2 + BLOCK_CLEAR) return true;
  }
  return false;
}

/** The sown population: same material, sizes drawn from the three measured. */
export function sownTrees() {
  const out = [];
  const steps = Math.ceil(SOWN_RADIUS / SOWN_STEP);
  for (let iz = -steps; iz <= steps; iz++) {
    for (let ix = -steps; ix <= steps; ix++) {
      const h = cellHash(ix, 7, iz);
      if (h >= SOWN_TAKE) continue;
      const x = AREA_CENTER.x + (ix + cellHash(ix, 11, iz) - 0.5) * SOWN_STEP;
      const z = AREA_CENTER.z + (iz + cellHash(ix, 13, iz) - 0.5) * SOWN_STEP;
      if (Math.hypot(x - AREA_CENTER.x, z - AREA_CENTER.z) > SOWN_RADIUS) continue;
      if (insideFrame(x, z)) continue;
      if (materialAt(x, z) !== 'erba') continue;
      if (nearBlock(x, z)) continue;
      const kind = MEASURED[Math.floor(cellHash(ix, 17, iz) * MEASURED.length)];
      out.push({ id: `S${out.length + 1}`, x, z, crown: kind.crown,
        crownTall: kind.crownTall, trunkTall: kind.trunkTall });
    }
  }
  return out;
}

// ---------------------------------------------------------------- the geometry
//
// ROAD D, AND WHAT IS DIFFERENT ABOUT IT. The road the analysis unit priced is
// the right one: hidden faces dropped, then coplanar faces greedily merged, so
// a crown costs a fifth of what it costs as instanced boxes, and every crown of
// the hub in ONE draw. What could not survive the page is the container. Its
// prototype put the merged geometry in an InstancedMesh, and three.js applies
// `instanceMatrix` inside its OWN vertex chunks -- project_vertex and
// worldpos_vertex -- which a raw ShaderMaterial does not have. voxelMaterial()
// is a raw ShaderMaterial that multiplies by modelMatrix and stops, so the
// attribute is declared by the prefix and then nobody reads it: every instance
// draws at the mesh's origin. Photographed, three crowns twelve metres apart
// against the same three as plain meshes.
//
// Reaching into that file to add the multiply was not on: it is the engine's,
// frozen in the foundation, and a string patched into it from a session's layer
// is a second opinion about the world's vertex shader that fails silently the
// day the first one moves.
//
// So the crowns are merged into ONE geometry instead of one geometry instanced
// many times. It keeps both numbers road D was chosen for -- the dropped faces
// and the single draw -- and it hands back the one thing instancing would have
// cost: the per-voxel tint is hashed on the CELL, so instanced crowns would all
// have been the same crown twice over, in shape AND in tint, and merged ones
// are not. What it spends is vertex memory, which is quoted with the triangles.
//
// AND THE MESH STANDS AT THE ORIGIN, UNROTATED. The material reads the cube a
// fragment belongs to out of `floor(position / VOXEL)` plus the chunk the model
// matrix says it is in, so geometry built in world coordinates under an identity
// transform lands on the same lattice as V1's own columns -- the tint of a
// crown and the tint of the grass under it come out of one hash of one grid.
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * Exposed faces of one set of cells, hidden against the WHOLE solid.
 *
 * The two sets -- foliage and bark -- are meshed separately because they are
 * two pigments and the material carries one, but they are occluded together:
 * where the trunk comes up inside the crown, neither draws the face they share.
 * Meshing them apart would leave two coincident quads at every such join, which
 * is a z-fight in the one place a tree is thinnest.
 */
function facesOf(cells, solid) {
  const faces = [];
  for (const key of cells) {
    const [x, y, z] = key.split(',').map(Number);
    for (let d = 0; d < 6; d++) {
      const [dx, dy, dz] = DIRS[d];
      if (!solid.has(`${x + dx},${y + dy},${z + dz}`)) faces.push([x, y, z, d]);
    }
  }
  return faces;
}

/** Coplanar faces of one bearing, greedily grown into rectangles. */
function mergeFaces(faces) {
  const planes = new Map();
  for (const [x, y, z, d] of faces) {
    const axis = d >> 1;
    const slab = axis === 0 ? x : axis === 1 ? y : z;
    // (u, v) is the cyclic pair after the axis -- (y, z), (z, x), (x, y) -- so
    // a rectangle grown in (u, v) winds the way its normal says. Reading (x, z)
    // for the Y planes handed every top and bottom face to the back-face cull:
    // a third of every crown and trunk was never drawn.
    const u = axis === 0 ? y : axis === 1 ? z : x;
    const v = axis === 0 ? z : axis === 1 ? x : y;
    const key = `${d}|${slab}`;
    if (!planes.has(key)) planes.set(key, { d, slab, axis, cells: new Set() });
    planes.get(key).cells.add(`${u},${v}`);
  }
  const quads = [];
  for (const p of planes.values()) {
    const live = new Set(p.cells);
    const coords = [...p.cells].map((c) => c.split(',').map(Number))
      .sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
    for (const [u0, v0] of coords) {
      if (!live.has(`${u0},${v0}`)) continue;
      let w = 1;
      while (live.has(`${u0 + w},${v0}`)) w += 1;
      let h = 1;
      grow: for (;;) {
        for (let k = 0; k < w; k++) if (!live.has(`${u0 + k},${v0 + h}`)) break grow;
        h += 1;
      }
      for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) live.delete(`${u0 + k},${v0 + j}`);
      quads.push({ ...p, u0, v0, w, h });
    }
  }
  return quads;
}

/** The quads of one pigment, as a buffer geometry in world metres. */
function geometryOf(quads) {
  const pos = [];
  const nor = [];
  const idx = [];
  for (const q of quads) {
    const { axis, slab, d, u0, v0, w, h } = q;
    const plane = (d % 2 === 0) ? slab + 1 : slab;
    const n = DIRS[d];
    const corner = (du, dv) => {
      const u = u0 + du;
      const v = v0 + dv;
      if (axis === 0) return [plane, u, v];
      if (axis === 1) return [v, plane, u];
      return [u, v, plane];
    };
    const b = pos.length / 3;
    for (const [du, dv] of [[0, 0], [w, 0], [w, h], [0, h]]) {
      const c = corner(du, dv);
      pos.push(c[0] * V, c[1] * V, c[2] * V);
      nor.push(n[0], n[1], n[2]);
    }
    if (d % 2 === 0) idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    else idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** How deep a trunk is pushed under the floor so no gap can open under it. */
const BURY = 2;

/**
 * The hub's trees: two meshes, one draw each, and nothing to update.
 *
 * WHY TWO AND NOT ONE. The trunk is brown in the target -- it is how the trunks
 * were found at all -- and the material carries one albedo. A second colour
 * inside one draw would have to be a per-voxel property in a vertex attribute,
 * which `guard-vertice` forbids and which the campaign priced at 3.0x. Two
 * draws for every tree in the hub, at any count, is the cheap answer.
 *
 * NOTHING HERE IS REBUILT AS THE WALKER MOVES. A ring that re-sows itself is
 * what the cards need because they face the eye; a tree is a solid standing in
 * one place, so it is built once and never touched again -- which is also why
 * there is no pop to look for in a walk.
 *
 * @param {object} options
 * @param {Function} options.height  where the ground is, from the hub's bag
 */
export function createTrees({ height }) {
  const trees = [...MEASURED, ...sownTrees()];
  const solid = new Set();
  const crowns = new Set();
  const trunks = new Set();

  for (const t of trees) {
    // Snapped to the lattice, or the joint and the arris the material draws out
    // of fract(position / VOXEL) would be drawn across the middle of a face.
    const cx = Math.round(t.x / V);
    const cz = Math.round(t.z / V);
    const floor = Math.round(height((cx + 0.5) * V, (cz + 0.5) * V) / V);
    crownCells(cx, cz, floor + t.trunkTall, t.crown, t.crownTall, crowns);
    trunkCells(cx, cz, floor - BURY, floor + t.trunkTall + 1, trunks);
  }
  for (const key of crowns) solid.add(key);
  for (const key of trunks) solid.add(key);

  // AND THE TWO SETS ARE MADE DISJOINT BEFORE EITHER IS MESHED.
  //
  // They overlap by construction: a crown starts at floor + trunkTall and a
  // trunk runs up to floor + trunkTall inclusive, so the trunk's top cube is a
  // member of both. Occluding them against the union is not enough to make that
  // safe -- it only hides the faces the two sets bury in each other. A face of
  // that shared cube which is exposed to the AIR is emitted by both families,
  // once brown and once green on the same plane, and two coplanar quads a
  // fragment apart is a z-fight that flickers as the eye moves.
  //
  // It is not hypothetical and it is not everywhere: a crown an EVEN number of
  // cubes across has its axis half a cube to one side, so its bottom row covers
  // the trunk's column but not the column's +x and +z neighbours, and those two
  // faces stand open. Measured on the population as it stands, four crowns of
  // four cubes leave eight such faces -- 0.08 m2 drawn twice.
  //
  // The crown keeps them, because a cube level with the foliage reads as
  // foliage. `solid` is already the union above, so nothing about what is
  // hidden changes: this only settles which family draws what is not.
  for (const key of crowns) trunks.delete(key);

  const meshes = [];
  const census = { trees: trees.length, cells: solid.size, quads: 0, triangles: 0, by: {} };
  for (const [name, cells, albedo] of [['trees-crowns', crowns, CROWN_ALBEDO],
    ['trees-trunks', trunks, BARK_ALBEDO]]) {
    const quads = mergeFaces(facesOf(cells, solid));
    const settings = voxelSettings();
    settings.albedo = albedo;
    const mesh = new Mesh(geometryOf(quads), voxelMaterial(V, settings));
    mesh.name = name;
    meshes.push(mesh);
    census.quads += quads.length;
    census.triangles += quads.length * 2;
    census.by[name] = { cells: cells.size, quads: quads.length, triangles: quads.length * 2,
      vertices: quads.length * 4 };
  }

  return {
    meshes,

    /** Development handle: the trees alone, so their cost can be measured. */
    setVisible(visible) {
      for (const mesh of meshes) mesh.visible = visible;
    },

    /** What they came to, for the development panel and for a verbale. */
    stats() {
      return { ...census, sown: trees.length - MEASURED.length };
    },
  };
}
