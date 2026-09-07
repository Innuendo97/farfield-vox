import { PLATFORM, STAIRS } from './layout.js';
// The dressed edge, from the engine that cuts it. Out of the PURE door, because
// this file has to answer under plain node for tools/monoliths/underfoot.mjs
// and the page's door reaches three.js.
import { CHAMFER } from './voxel/pure.js';

// The way up to the central block.
//
// This is the one built thing on the ground, and in the reference it is the
// only place where worked stone meets the meadow: six shallow treads of pale
// worn rock, the width of the path, climbing to the platform the tallest
// monolith stands on. It has to be a mesh, and it has to carry the same kind of
// surface the ground does — a painted albedo and a Cycles bake — because the
// scene has no light at draw time to give it a shape otherwise.
//
// The geometry is described once, here, as a list of world space quads with a
// rectangle of the atlas assigned to each. The runtime builds its buffers from
// that list, tools/terrain/paint-stairs.mjs paints into those rectangles, and
// tools/terrain/build-mesh.mjs hands the same vertices to Blender. Three
// consumers, one definition: a face cannot be lit where it is not painted.

// Side of the square atlas the albedo and the light share.
export const ATLAS = 512;

// Texels per metre of surface, and the smallest island either side may be.
//
// The minimum is not a nicety. A riser is nine centimetres tall, which at this
// density is three texels, and Cycles will not reliably rasterise an island
// that thin: the first bake of this stair came back with every riser black and
// only the bleed margin around them carrying anything. Twelve texels is enough
// for the bake to find the face, and stretching a lightmap across a strip that
// small costs nothing because the light on it barely varies.
const DENSITY = 34;
const MIN_ISLAND = 12;

// Padding around each rectangle, in texels. The bake bleeds into it and the
// bilinear filter reads into it, so without it every face would show the face
// packed next to it along its rim.
const PAD = 3;

// The top step reaches this far under the platform. The platform is turned
// eighteen degrees and the stair run is not, so their edges cross at an angle:
// without the tuck the two would part company on the eastern side and leave a
// notch across the head of the run.
const TOP_STEP_TUCK = 1.1;

// And it is set a centimetre below the platform while it does so. The tuck runs
// under the platform at exactly the platform's own height, which put two
// coplanar surfaces in the same place: the one that won was the tucked tread,
// and its share of the lightmap is black because in the bake it is under the
// platform. That was the black wedge across the head of the run.
const TOP_STEP_DROP = 0.012;

// THE STRIP THAT LIT THE RISERS IS GONE, geometry and all. It was six quads
// inset into the risers, sized as a fraction of one, and it existed because the
// PHOTOREAL reference this world superseded drew a line under each nosing. The
// two voxel targets do not: measured on the treads themselves the run reads
// B/G 1.02, grey stone under a blue sky, with no emission on it in either the
// day or the night frame. Deviazione 1 of the session verbale is that reading;
// this is it carried out.

const DEG = Math.PI / 180;

/** Height of the tread of step k above the meadow. */
export function stepHeight(k) {
  return PLATFORM.height * (STAIRS.steps - k) / STAIRS.steps;
}

/**
 * Height of the worked stone under a point, or -Infinity where there is none.
 *
 * The run is walked and not only looked at, and the two have to agree. The top
 * tread is drawn more than a metre north of where the run nominally begins,
 * because it tucks under the platform; a collision that stopped at the nominal
 * beginning left that last strip of stone with nothing under it, and a walker
 * reaching the head of the run dropped the whole height of the platform into
 * the meadow before its footprint pushed them back out. This answers for
 * exactly the stone the treads cover, tuck included.
 *
 * AND IT CARRIES THE TOP STEP'S DROP, which it did not until it was measured.
 * The top tread is drawn a centimetre below the platform so that the two are
 * not coplanar where one runs under the other, and this answered the undropped
 * height: over eleven thousand sampled points of the head of the run the walker
 * stood 12.0 mm above the stone the frame draws. Twelve millimetres is not felt
 * on a step, which is exactly why it would have stayed -- and the contract this
 * feeds says in its own words that nothing in it may quietly become a different
 * answer from the one the frame draws. tools/monoliths/underfoot.mjs is where
 * that is now asked rather than assumed.
 */
export function stairHeightAt(x, z) {
  if (Math.abs(x - STAIRS.x) > STAIRS.width / 2) return -Infinity;
  if (z < STAIRS.z - TOP_STEP_TUCK) return -Infinity;
  if (z > STAIRS.z + STAIRS.tread * STAIRS.steps) return -Infinity;
  const k = Math.min(STAIRS.steps - 1, Math.max(0, Math.floor((z - STAIRS.z) / STAIRS.tread)));
  const tread = stepHeight(k) - (k === 0 ? TOP_STEP_DROP : 0);

  // AND IT CARRIES THE DRESSED EDGE, which the run did not have to have while
  // it was a delivered mesh with square arrises and has to have now that it is
  // masonry. Every course of this world is chamfered at its top edge -- real
  // geometry, and the reference's brightest single signal comes off it -- so
  // the last 28 mm before the rim of a tread is a facet leaning up, and the
  // stone there stands lower than the tread by as much as the chamfer. Asked
  // against the masonry the world now draws, the undressed answer stood the
  // walker 28.0 mm over the stone on 3,937 sampled points, all of them on the
  // strip of a tread a foot actually lands on.
  //
  // WHICH THREE EDGES ARE DRESSED IS NOT A CHOICE HERE EITHER: they are the two
  // long sides of the run, and the NOSING -- the rim a tread overhangs the one
  // below it by. The edge where the next tread rises is not an edge at all;
  // the stone carries on up, and there is nothing there to dress.
  const inside = Math.min(
    STAIRS.width / 2 - Math.abs(x - STAIRS.x),
    STAIRS.z + STAIRS.tread * (k + 1) - z,
    k === 0 ? z - (STAIRS.z - TOP_STEP_TUCK) : Infinity,
  );
  return tread - Math.max(0, CHAMFER - inside);
}

function quad(a, b, c, d, kind) {
  return { corners: [a, b, c, d], kind };
}

/**
 * Every visible face of the run and the platform, as world space quads.
 *
 * The north face of a step is never emitted: it is buried in the step below it,
 * and emitting it would put two coincident faces at the same depth for the
 * whole width of the run.
 */
export function stairFaces() {
  const faces = [];
  const x0 = STAIRS.x - STAIRS.width / 2;
  const x1 = STAIRS.x + STAIRS.width / 2;

  for (let k = 0; k < STAIRS.steps; k++) {
    const h = stepHeight(k);
    const tread = k === 0 ? h - TOP_STEP_DROP : h;
    const zNorth = STAIRS.z + STAIRS.tread * k - (k === 0 ? TOP_STEP_TUCK : 0);
    const zSouth = STAIRS.z + STAIRS.tread * (k + 1);

    faces.push(quad(
      [x0, tread, zNorth], [x1, tread, zNorth], [x1, tread, zSouth], [x0, tread, zSouth], 'tread',
    ));
    // The riser, from this tread down to the one below it and no further. It
    // used to be carried to the ground, with everything under the next step
    // buried inside it: harmless to look at, but nine tenths of its share of
    // the atlas was mapping stone that is inside the solid, so the bake wrote
    // black over the part that is actually seen. The overlap is a centimetre,
    // enough that the join with the tread below never opens.
    const below = k + 1 < STAIRS.steps ? stepHeight(k + 1) - 0.01 : 0;
    faces.push(quad(
      [x0, h, zSouth], [x1, h, zSouth], [x1, below, zSouth], [x0, below, zSouth], 'riser',
    ));
    faces.push(quad(
      [x1, h, zSouth], [x1, h, zNorth], [x1, 0, zNorth], [x1, 0, zSouth], 'cheek',
    ));
    faces.push(quad(
      [x0, h, zNorth], [x0, h, zSouth], [x0, 0, zSouth], [x0, 0, zNorth], 'cheek',
    ));
  }

  const c = Math.cos(PLATFORM.rotationY * DEG);
  const s = Math.sin(PLATFORM.rotationY * DEG);
  const corner = (lx, lz, y) => [
    PLATFORM.x + lx * c + lz * s,
    y,
    PLATFORM.z - lx * s + lz * c,
  ];
  const hw = PLATFORM.width / 2;
  const hd = PLATFORM.depth / 2;
  const H = PLATFORM.height;

  faces.push(quad(
    corner(-hw, -hd, H), corner(hw, -hd, H), corner(hw, hd, H), corner(-hw, hd, H), 'platform',
  ));
  // Skirt, walked round clockwise seen from above so every side faces out.
  const ring = [[-hw, hd], [hw, hd], [hw, -hd], [-hw, -hd]];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % 4];
    faces.push(quad(
      corner(ax, az, H), corner(bx, bz, H), corner(bx, bz, 0), corner(ax, az, 0), 'platform-side',
    ));
  }
  return faces;
}

function faceSize(face) {
  const [a, b, , d] = face.corners;
  const width = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const height = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
  return { width, height };
}

/**
 * Shelf packing of the faces into the atlas.
 *
 * Rectangles are laid out tallest first along rows. It is the simplest packer
 * that does not waste half the sheet, and the set it has to place is thirty
 * quads that never change, so nothing more clever would ever earn its keep.
 */
export function packAtlas(faces) {
  const boxes = faces.map((face, index) => {
    const { width, height } = faceSize(face);
    return {
      index,
      w: Math.max(MIN_ISLAND, Math.ceil(width * DENSITY)) + PAD * 2,
      h: Math.max(MIN_ISLAND, Math.ceil(height * DENSITY)) + PAD * 2,
    };
  });

  const order = [...boxes].sort((a, b) => b.h - a.h || b.w - a.w);
  const placed = new Array(boxes.length);
  let shelfY = 0;
  let shelfH = 0;
  let cursor = 0;

  for (const box of order) {
    if (cursor + box.w > ATLAS) {
      shelfY += shelfH;
      shelfH = 0;
      cursor = 0;
    }
    if (shelfY + box.h > ATLAS) throw new Error('stair atlas overflow: lower DENSITY');
    placed[box.index] = {
      x0: (cursor + PAD) / ATLAS,
      y0: (shelfY + PAD) / ATLAS,
      x1: (cursor + box.w - PAD) / ATLAS,
      y1: (shelfY + box.h - PAD) / ATLAS,
      // Kept in texels as well, because the painter fills whole texels and the
      // bake needs a margin measured the same way.
      px: { x0: cursor + PAD, y0: shelfY + PAD, x1: cursor + box.w - PAD, y1: shelfY + box.h - PAD },
    };
    cursor += box.w;
    shelfH = Math.max(shelfH, box.h);
  }
  return placed;
}

/**
 * Positions, texture coordinates and indices of the whole run.
 * @param {Array} faces quads to build, defaulting to the stone
 */
export function stairMesh(faces = stairFaces()) {
  const rects = packAtlas(faces);
  const positions = new Float32Array(faces.length * 12);
  const uvs = new Float32Array(faces.length * 8);
  const indices = new Uint16Array(faces.length * 6);

  faces.forEach((face, f) => {
    const rect = rects[f];
    // Corner order is top left, top right, bottom right, bottom left, so the
    // rectangle maps on without a flip and the painter can walk it in rows.
    const corners = [
      [rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x1, rect.y1], [rect.x0, rect.y1],
    ];
    for (let c = 0; c < 4; c++) {
      const o = (f * 4 + c) * 3;
      positions[o] = face.corners[c][0];
      positions[o + 1] = face.corners[c][1];
      positions[o + 2] = face.corners[c][2];
      const t = (f * 4 + c) * 2;
      uvs[t] = corners[c][0];
      uvs[t + 1] = corners[c][1];
    }
    const base = f * 4;
    const k = f * 6;
    indices[k] = base; indices[k + 1] = base + 2; indices[k + 2] = base + 1;
    indices[k + 3] = base; indices[k + 4] = base + 3; indices[k + 5] = base + 2;
  });

  return { positions, uvs, indices, faces, rects };
}
