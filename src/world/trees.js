import { BufferGeometry, Float32BufferAttribute, Mesh, Vector3 } from 'three';
import { VOXEL, voxelMaterial, voxelSettings } from './voxel/index.js';
import { POSE_VOX_DAY } from '../core/poses.js';
import { bearingGap, bearingOf, bearingOfYaw } from './compass.js';
import { materialAt } from './contracts.js';
import { AREA_CENTER, MONOLITHS } from './layout.js';

// THE HUB'S TREES. Owned by V4.
//
// They are ALBERELLI and not trees: the tallest of the four the day target
// shows stands a metre and a half, the other three under a metre, and their
// crowns are three to seven cubes across. Anything here that reads as a forest
// tree is wrong before it is drawn.
//
// WHERE THE FOUR MEASURED ONES COME FROM. Their crowns were read off the day
// target as the island of not-water that holds each one -- three of the four
// stand against the lake and one against the sky, and water is the one class a
// crown can never be mistaken for -- and their trunks and base rows read off the
// same picture one character per pixel. The pixels were then carried into metres
// through THE POSES AS THEY STAND NOW: the earlier inventory went through the
// camera in ricetta.json, which stands 1.15 m higher and sees seven degrees more
// of this world, and every metre it produced is a metre about that camera.
// Nothing from it survives here.
//
// AND THE FLOOR THEY ARE DERIVED ON IS y = 0, WHICH IS MEASURED. Put the five
// blocks' feet on the plane and on the delivered height field and compare both
// with the picture: the plane lands at 17.1 px rms, the field at 37.0 px and
// biased 31 px the wrong way. The mounds that field carries under the meadow
// are not in this picture. They are V1's, so the derivation stays on the plane
// and the PLANTING follows the floor -- a tree that stands anywhere else than
// on the ground is a worse fault than a tree a few pixels high.

/**
 * The step of the world. Everything about WHERE a tree stands is a number of
 * these; nothing about what a tree is MADE of is.
 */
const V = VOXEL;

// -------------------------------------------------------- THE CUBE OF A CROWN
//
// AND IT IS NOT THE CELL OF THE WORLD, WHICH IS THE WHOLE OF WHY THESE TREES
// WERE READ AS ABSENT.
//
// The trees have stood at the target's own seats since the foundation cured
// their winding, and switching them off at the fitted pose moves five thousand
// pixels exactly where the target draws them. What the eye of the campaign saw
// was not an empty seat: it was a GRAIN. A crown built of the world's own
// 0.10 m cells is five to ten cubes across at seven pixels each, and at sixteen
// metres a seven pixel cube inside a thirty six pixel crown is not a cube, it is
// a speckle -- so the shape has no edges to read and the whole thing reads as a
// smear of the meadow's own green.
//
// THE TARGET'S CUBE, MEASURED ON FOUR TREES. Each silhouette was stepped off
// against the lake at eight and twelve times, and the steps are the cubes:
//
//                 distance   px/m    crown px      crown m      cube px
//   T1  (fra 01/02)  16.4 m   70.6   38 x 45   0.54 x 0.64      9-10
//   T2  (sul lago)   32.7 m   35.5   35 x 36   0.99 x 1.01      8-10
//   T3  (dietro 04)  18.9 m   61.4   25 x 39   0.41 x 0.64      6-9
//   T4  (margine dx) 16.0 m   72.5   34 x 46   0.47 x 0.63     10-11
//
// Nine to eleven pixels at sixteen metres is 0.13 to 0.16 m, and R7's own count
// at six times -- three to four cubes across T1, T3 and T4, four to five across
// T2 -- puts the same number on it from the other side: 0.54/3.5 = 0.154.
// 0.15 m, which is a cube and a half of the world, is what they agree on and it
// is what is built here.
//
// WHAT THIS NUMBER CANNOT DO, DECLARED RATHER THAN AVERAGED AWAY. T2 stands at
// thirty two metres and ITS cubes read 8 to 10 px -- 0.22 to 0.28 m, nearly
// twice T1's. The target's cube is very nearly constant in PIXELS whatever the
// distance, which is the same finding R4 published for the clouds and R6 for the
// hills, and no single world-space size can be that. A size in metres is what a
// solid standing in a world the walker moves through can have; the price is that
// T2 comes out finer grained than the target draws it (5.3 px against 8-10), and
// the alternative -- a cube per tree of width/4, so the big ones are built of
// big cubes -- is D-R7-4 with the committente and costs a draw per size class
// against a budget of two. Measured, said, and left where the choice belongs.
const CROWN_CUBE = 0.15;

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
//
// AND THE CHROMA OF THE SUNLIT TOPS IS NOT REACHABLE FROM HERE. The target's
// lit crowns read C* 44 to 52; ours read 25 to 37, and a sweep of this albedo to
// 1.7x on the page moved it by 3.4. What compresses it is the chain -- the air
// at sixteen metres, the blue ramp, the grade, the meadow's own well -- and
// R1/R4/R6 own every one of those. When they land, this triple is refitted as
// the same ratio to the meadow that is here now: one line, and it is not this
// unit's to write (R7 S3).
const CROWN_ALBEDO = new Vector3(0.1836, 0.4160, 0.0247);
const BARK_ALBEDO = new Vector3(0.2675, 0.1702, 0.0468);

// ------------------------------------------------------------------ the shape
//
// THE CROWN IS A SOLID IN TIERS WITH A POINT ON IT, AND NOT AN ELLIPSOID.
//
// Read at eight and twelve times against the water, all four crowns say the same
// thing from the top down: ONE cube at the point, then a tier about twice that,
// then the full width for the body of it, and a foot that closes back in a
// little where the trunk comes through. T1, in pixels of its own silhouette:
//
//   rows 603-613   x 419..434   15 px   the point, and it is ONE cube
//   rows 613-625   x 407..445   38 px
//   rows 625-638   x 402..453   51 px
//   rows 638-649   x 403..456   53 px   the widest, and it is the bottom
//
// A cube of 0.15 m at that seat projects a box of 15.9 x 11.9 px through the
// fitted camera. The point measures 15 x 10. Nothing else in this file is as
// direct as that.
//
// What an ellipsoid does instead is put its widest row in the MIDDLE and close
// symmetrically above and below it, which reads as a ball on a stick at any size
// and is what shipped. The profile below is the reading: full at the body,
// closing to a point over the top tier, and a foot that gives the trunk
// somewhere to come out of.
//
// THE UNITS ARE TIERS AND NOT A CONTINUUM, because a crown four cubes tall has
// four values of this function in it and a curve fitted through four points is
// four points with a curve drawn on them.
//
// AND THE WIDEST TIER IS THE BOTTOM ONE, WHICH IS THE HALF AN ELLIPSOID GETS
// WRONG BY CONSTRUCTION: on all four trees the silhouette grows monotonically
// downward until the foot closes a little round the trunk.
const PROFILE = [
  // up to this fraction of the crown's height, this much of its half width
  { upTo: 0.22, half: 0.86 }, // the foot, closed a little round the trunk
  { upTo: 0.62, half: 1.00 }, // the body, at full width
  { upTo: 1.01, half: 0.72 }, // and the tier under the point
];

/** Half width of a crown at a height fraction, one at its widest. */
function profile(u) {
  for (const tier of PROFILE) if (u < tier.upTo) return tier.half;
  return PROFILE[PROFILE.length - 1].half;
}

// AND THERE IS NO LOTTERY IN THE SHAPE, WHICH IS A FINDING AND NOT A SAVING.
//
// The first cut of this law bit cubes out of the outer ring and stood others one
// step proud of it, on a hash, because a crown whose edge follows a circle
// exactly reads as a machined object. Measured through the fitted camera, that
// is not what these crowns can afford: they are THREE TO FIVE cubes across, so
// EVERY cell is on the outer ring, and one cell added or removed at the rim
// moves the silhouette by a whole cube -- 17 to 32 per cent of the box the
// target draws. A shape gated at five per cent cannot be drawn by a draw.
//
// And the target does not ask for it. Read at eight and twelve times, all four
// crowns are SOLID clumps: what makes their edges ragged is the tier steps and
// the staircase a disc of cubes makes of its own rim, both of which are here by
// construction. T3 at eight times is the plainest -- four whole tiers and a
// point, no hole in any of them.
//
// What makes one tree different from another is therefore its SIZE, of which
// the target measured four, and the sown population draws from those four.

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
 * The cells of one crown, in the tree lattice.
 *
 * @param {number} cx  the trunk's own column in x, in crown cubes
 * @param {number} cz  the trunk's own column in z, in crown cubes
 * @param {number} y0  the crown's lowest row, in crown cubes
 * @param {number} width  crown width, in crown cubes
 * @param {number} tall  crown height BELOW the point, in crown cubes
 * @param {Set} into  the cells, as "x,y,z"
 */
function crownCells(cx, cz, y0, width, tall, into) {
  // A crown an EVEN number of cubes across cannot be centred on a cell, so its
  // axis sits on the boundary half a cube to one side and it comes out the
  // width it was measured at. Centring it on the trunk instead would round four
  // cubes to three or to five, which on a crown this small is a quarter of it.
  const off = width % 2 === 1 ? 0 : -0.5;
  const r = width / 2;
  const reach = Math.ceil(r + 1);
  for (let j = 0; j < tall; j++) {
    const u = (j + 0.5) / tall;
    const half = r * profile(u);
    for (let i = -reach; i <= reach; i++) {
      for (let k = -reach; k <= reach; k++) {
        // A disc and not a square, because a square of cubes turned to the
        // camera shows its diagonal and reads a third wider than it is: T1's
        // crown is three cubes across the axis and would be four and a half
        // across the corner.
        if (Math.hypot(i - off, k - off) > half + 0.05) continue;
        into.add(`${cx + i},${y0 + j},${cz + k}`);
      }
    }
  }
  // AND THE POINT: one cube, on the axis, over the whole of it. The target shows
  // it on T1, T2 and T4 as a single step ten to eleven pixels wide standing
  // clear of the tier below, and it is the one feature that makes a crown of
  // three cubes read as a tree rather than as a bush.
  into.add(`${cx},${y0 + tall},${cz}`);
}

/** The cells of one trunk: one column of one cube, which is what is drawn. */
function trunkCells(cx, cz, from, to, into) {
  for (let j = from; j < to; j++) into.add(`${cx},${j},${cz}`);
}

// -------------------------------------------------------------- the four read
//
// x and z in metres on the plane the target stands its blocks on; crown width,
// crown height and trunk in CROWN CUBES of 0.15 m, because that is the unit they
// were counted in. The pixel evidence for each is written beside it so a reader
// can go back to the picture without the tool.
//
// `crown` is the width; `crownTall` is the number of tiers UNDER the point, so a
// crown occupies crownTall + 1 rows; `trunkTall` is how many rows of trunk stand
// between the floor and the crown's lowest row.
export const MEASURED = [
  {
    id: 'T1',
    // Silhouette against the lake x 402..456 rows 603..656; bark (hue 62..90)
    // x 418..428 rows 656..673; base row 674 +/- 4. Its point is ONE cube whose
    // box measures 15 x 10 px at twelve times, against the 15.9 x 11.9 a cube of
    // 0.15 m projects at this seat: that single reading is the whole case for
    // the cube. Foot of the crown in the deepest shade of the four (0.54 of the
    // meadow beside it), which is why the last tier cannot be counted.
    x: -5.35, z: -1.03, crown: 4, crownTall: 3, trunkTall: 2,
  },
  {
    id: 'T2',
    // Silhouette x 702..730 rows 555..594, trunk x 712..719 rows 594..611, base
    // row 611 +/- 4. Tall and narrow -- five cubes across against seven of
    // height -- and the only one whose trunk is three cubes. Its own cubes read
    // 8 to 10 px where 0.15 m projects 6.2: see the note over CROWN_CUBE.
    x: -3.74, z: -17.87, crown: 5, crownTall: 6, trunkTall: 3,
  },
  {
    id: 'T3',
    // Silhouette x 1219..1259 rows 599..637; no bark resolvable, its trunk falls
    // in the shaded band, so the base row is 658 +/- 8 read off where the sunlit
    // meadow starts under the crown. THE PLAINEST OF THE FOUR at eight times:
    // four whole tiers of nine to ten pixels each and a point of one cube on
    // top, no hole in any of them -- it is what settled the shape.
    x: 6.17, z: -3.74, crown: 3, crownTall: 3, trunkTall: 2,
  },
  {
    id: 'T4',
    // THE ONE NO INVENTORY CARRIED. R7 found it at the right margin and left it
    // to be measured; this is the measurement. Crown against open water on three
    // sides -- the cleanest silhouette of the four -- trunk (L* 3 to 8, too dark to carry a hue) x 1577..1587 rows 675..691,
    // base row 692 +/- 4. Through the fitted camera on the plane that is
    // (8.76, 0.47), 16.0 m out. Silhouette x 1550..1612 rows 629..675, a point
    // of one cube 11 x 10 px on top. It stands 4.2 m south of block 05, and
    // contracts.js says the ground there is meadow at y = 0.
    //
    // R7 put it at (10.1, -0.85) off an eyeballed base row of 680 at u 0.975;
    // the trunk is at u 0.946 and its foot at 692, and the difference between
    // those two readings is 1.3 m of ground. This one is off the pixels.
    x: 8.76, z: 0.47, crown: 3, crownTall: 2, trunkTall: 2,
  },
];

/**
 * WHERE THE TREES STAND, AS A CONTRACT AND NOT AS A COMMENT.
 *
 * The zone map of R1-S3 owes each of these seats a disc of shade -- the target
 * puts the meadow under T1 at 0.53 of the meadow beside it and under T3 at 0.62
 * -- and a second list of four seats written into that map is a second list to
 * keep in step. So the seats are published from the one place that decides them,
 * with the crown's own radius in metres, and U-ALBERI-2 reads this rather than
 * copying it. E-V1h asked for exactly this reconciliation under the heading of
 * the alberelli.
 *
 * @returns {{id:string, x:number, z:number, radius:number, height:number}[]}
 */
export function treeSeats() {
  return MEASURED.map((t) => ({
    id: t.id,
    x: t.x,
    z: t.z,
    radius: (t.crown / 2) * CROWN_CUBE,
    height: (t.trunkTall + t.crownTall + 1) * CROWN_CUBE,
  }));
}

// --------------------------------------------------- and the ones out of frame
//
// The two pictures cannot show what stands beside or behind the camera, and a
// hub with trees only where a picture happened to look is a hub that falls apart
// the moment the walker turns round. So the rest of the population is SOWN, out
// of the sizes of the four that were measured and nothing else -- no shape, no
// spacing and no colour is invented here that the picture did not already say.
//
// WHERE THEY MAY STAND, AND WHY IT IS A WEDGE. Both target eyes stand within a
// metre and a half of (-0.58, 14.57), and the frame is 35.8 degrees wide either
// side of the axis they look along. So a point the pictures CANNOT see is one
// whose bearing off that AXIS, taken from that stand, is wider than the frame
// plus a margin -- or one behind the stand altogether. Every sown tree is
// checked against the two poses off line and none lands inside either frame.
//
// AND THE WEDGE IS ON THE AXIS NOW, NOT ON DUE NORTH, WHICH IS NOT THE SAME
// THING. It used to be `|x - STAND.x| < tan(40) * ahead` -- symmetric about the
// world's north -- and the pose does not look north: it looks along the bearing
// its engine yaw of 1.818 degrees negates, which is 1.818 degrees WEST of it.
// The wedge was therefore 1.8 degrees off the picture it is meant to describe,
// tight on the east flank and slack on the west, and the four degrees of margin
// were the only reason that never showed. It is arithmetic that reads a
// direction, so it reads it at the world's own seat (src/world/contracts.js).
//
// MEASURED, AND IT MOVES NOBODY: the nearest of the nine sown trees stands
// 48.63 degrees off north and 46.81 off the axis, against a wedge of 40. The
// delivered population is the same nine before and after -- which is the point.
// A cull that is right for the wrong reason falls over the first time somebody
// trims the margin.
const STAND = { x: -0.58, z: 14.57 };
/** The bearing the two target eyes look along: the engine's yaw, negated. */
const FRAME_AXIS = bearingOfYaw(POSE_VOX_DAY.yaw);
/** Half the frame, 35.8 degrees, and four more so a crown cannot lean in. */
const HIDDEN_BEYOND_DEG = 40;
/** How far out they are sown, in metres from the walkable centre. */
const SOWN_RADIUS = 20;
/** One candidate every this many metres, jittered inside its own cell. */
const SOWN_STEP = 3.2;
/**
 * And how many of those candidates actually carry a tree.
 *
 * SET BY THE TRIANGLE ALLOCATION AND NOT BY TASTE, because the picture has
 * nothing to say about ground it cannot see: the four measured trees come to
 * about a quarter of the four thousand triangles this session allocated to
 * trees, and this is how many more fit in the rest. It is one number, so moving
 * it is one line -- which is what D-R7-4 C would move.
 */
const SOWN_TAKE = 0.15;
/** Clearance from a block's footprint, in metres. */
const BLOCK_CLEAR = 1.4;

function insideFrame(x, z) {
  if (STAND.z - z <= 0) return false;        // behind the stand: never in frame
  const off = bearingGap(bearingOf(x - STAND.x, z - STAND.z), FRAME_AXIS);
  return Math.abs(off) < HIDDEN_BEYOND_DEG;
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

/** The sown population: same material, sizes drawn from the four measured. */
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
// fragment belongs to out of `floor(position / cube)` plus the chunk the model
// matrix says it is in, so geometry built in world coordinates under an identity
// transform lands on the lattice the material is TOLD about -- which for these
// two meshes is the tree's 0.15 m lattice and not the world's 0.10 m one. That
// is the point of the whole unit: the joint and the lightened arris the material
// draws are then the edges of the cube a reader counts on the target, and drawn
// on the world's step they would fall a cube and a half inside every one of them.
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
    // a third of every crown and trunk was never drawn (E-GUARDIA1).
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
function geometryOf(quads, step) {
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
      pos.push(c[0] * step, c[1] * step, c[2] * step);
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
 * The cells of the whole population, as the two families and their union.
 *
 * SEPARATE FROM THE MESHING BECAUSE A GUARD MUST BE ABLE TO ASK. What
 * guard-alberi gates is a silhouette in pixels at the fitted pose, and a
 * silhouette is a set of cubes projected through a camera -- not a buffer. Every
 * number this file claims about the shape is claimed about THESE cells, and the
 * meshes below are made out of the same call, so the guard and the frame cannot
 * be measuring two different worlds.
 *
 * @param {Function} height  where the ground is, from the hub's bag
 * @returns {{trees:object[], crowns:Set, trunks:Set, solid:Set, cube:number}}
 */
export function treeCells(height) {
  const trees = [...MEASURED, ...sownTrees()];
  const solid = new Set();
  const crowns = new Set();
  const trunks = new Set();

  for (const t of trees) {
    // Snapped to the tree lattice, or the joint and the arris the material draws
    // out of fract(position / cube) would be drawn across the middle of a face.
    const cx = Math.round(t.x / CROWN_CUBE);
    const cz = Math.round(t.z / CROWN_CUBE);
    const floor = Math.round(height((cx + 0.5) * CROWN_CUBE, (cz + 0.5) * CROWN_CUBE) / CROWN_CUBE);
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
  // faces stand open.
  //
  // The crown keeps them, because a cube level with the foliage reads as
  // foliage. `solid` is already the union above, so nothing about what is
  // hidden changes: this only settles which family draws what is not.
  for (const key of crowns) trunks.delete(key);

  return { trees, crowns, trunks, solid, cube: CROWN_CUBE };
}

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
  const { trees, crowns, trunks, solid } = treeCells(height);

  const meshes = [];
  const census = {
    trees: trees.length, cells: solid.size, quads: 0, triangles: 0, by: {},
    cube: CROWN_CUBE, worldVoxel: V,
  };
  for (const [name, cells, albedo] of [['trees-crowns', crowns, CROWN_ALBEDO],
    ['trees-trunks', trunks, BARK_ALBEDO]]) {
    const quads = mergeFaces(facesOf(cells, solid));
    const settings = voxelSettings();
    settings.albedo = albedo;
    // THE MATERIAL IS TOLD THE TREE'S CUBE AND NOT THE WORLD'S. One argument,
    // and it is what puts the joint, the lightened arris and the per-cube tint
    // on the edges a reader can count on the target.
    const mesh = new Mesh(geometryOf(quads, CROWN_CUBE), voxelMaterial(CROWN_CUBE, settings));
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
