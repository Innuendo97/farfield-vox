// Hub layout, in metres.
//
// Coordinate system: origin is the centre of the hub, +Y is up, north is -Z.
// The player spawns south of the ring, on the path, looking north.
//
// The monolith placements below are not free choices: they are the least
// squares reconstruction of the reference framing (silhouette corners measured
// on the reference image, camera pinned at eye height, boxes forced to stay
// rectangular). Changing one value without redoing that fit will break the
// reference pose.

export const EYE_HEIGHT = 1.7;

export const SPAWN = { x: 0, z: 14, yaw: 0 }; // yaw 0 == looking north

// Walkable area. There is no wall: the player is slowed radially past SOFT and
// stopped by damping at HARD, so the boundary is never perceived as a barrier.
// The centre sits south of the origin because the ring is open to the south and
// the sixth monolith stands behind the spawn.
export const AREA_CENTER = { x: 0, z: 1.5 };
export const AREA_SOFT_RADIUS = 19;
export const AREA_HARD_RADIUS = 21;

export const WALK_SPEED = 3.0;
export const RUN_SPEED = 4.5;

// GROUND_SIZE = 400 STOOD HERE AND HAD NO READER, checked over the whole tree by
// name and by import when E-V1f.4 named it and again at this step. It described
// a four hundred metre plane that this branch never had: what reaches is the
// disc of cubes at the tier's radius and the sheet at a hundred metres, and the
// second of those is E-V5h's own number, and the ground that reaches it is
// the far window of src/world/voxel/campo-field.js.

// There was a COLORS table and a FOG pair here — a ground green, a path grey,
// a stone slate, a sky blue, a fog blue, and a near and far distance for a
// linear fog. Not one of them had a reader left: every surface in this world
// takes its colour from a painted albedo and every one of them fades into the
// air that src/world/air.js keeps. They were the last of the placeholder
// palette, and a placeholder colour that still compiles is a colour somebody
// will eventually reach for.

// Raised base of the central monolith; it shares the monolith orientation so
// the two read as one structure.
//
// Its height is measured, not chosen: the stair run in the reference framing is
// a hundred and sixty five pixels across and fifty seven tall, and the run is
// exactly as tall as this. It was a little over half a metre and drew a stair
// twenty three pixels high, which read as a kerb. Raising it moves the foot of
// the central block, never its head — the block loses the height the platform
// gains, so its top edge and its two side edges stay on the pixels the
// reference fit put them on. The footprint came in with the height for the same
// reason: a slab this tall at the old width would stand either side of the
// stair as a wall the reference does not have.
export const PLATFORM = {
  width: 6.2,
  depth: 3.0,
  height: 1.30,
  x: 0.05,
  z: -16.68,
  rotationY: 18.0,
};

// The stair run is aligned with the path, not with the platform: it is the way
// in, and in the reference framing it faces the walker squarely. Its width is
// measured off that framing the same way its height was.
export const STAIRS = {
  steps: 6,
  width: 3.9,
  tread: 0.36,
  x: 0.25,
  z: -14.3,
};

// size = [width, height, depth]; position is the box centre on the ground
// plane; rotationY in degrees, positive turns the engraved face toward east.
export const MONOLITHS = [
  {
    id: '01',
    key: 'personalita',
    label: 'Personalità',
    position: { x: -9.32, z: -4.81 },
    rotationY: 65.0,
    size: [3.44, 5.44, 1.48],
    baseY: 0,
  },
  {
    id: '02',
    key: 'progetti',
    label: 'Progetti',
    position: { x: -5.29, z: -10.77 },
    rotationY: 29.4,
    size: [3.46, 7.03, 1.10],
    baseY: 0,
  },
  {
    id: '03',
    key: 'carriera',
    label: 'Carriera',
    position: { x: 0.05, z: -16.68 },
    rotationY: 18.0,
    // Its head is at 13.14 m and that is the number the fit produced: the
    // height here is whatever is left once the platform has taken its share.
    size: [5.60, 13.14 - PLATFORM.height, 1.10],
    baseY: PLATFORM.height,
  },
  {
    id: '04',
    key: 'skills',
    label: 'Skills',
    position: { x: 5.01, z: -7.53 },
    rotationY: -37.5,
    size: [2.99, 6.24, 2.07],
    baseY: 0,
  },
  {
    id: '05',
    key: 'obiettivi',
    label: 'Obiettivi',
    position: { x: 8.19, z: -3.69 },
    rotationY: -48.5,
    size: [2.90, 4.84, 1.66],
    baseY: 0,
  },
  {
    id: '06',
    key: 'contatti',
    label: 'Contatti',
    // Behind the spawn on purpose: it must stay outside the reference framing.
    position: { x: 0, z: 19.0 },
    // And turned to face it. A block's engraved face looks along +Z at nought
    // degrees, which is south — right for the five that stand north of the
    // spawn and exactly wrong for the one that stands south of it, which was
    // showing its blank back to everybody who turned round. Half a turn puts
    // the writing towards the path; the five degrees are kept, because no two
    // blocks in this hub are parallel.
    rotationY: 185,
    size: [3.2, 5.2, 1.6],
    baseY: 0,
  },
];

// Placeholder path: a straight strip from the spawn to the foot of the stairs.
export const PATH = {
  width: 1.8,
  fromZ: 16.5,
  toZ: -12.2,
  x: 0.25,
};

// ---------------------------------------------------------------- the rocks
//
// THEY ARE NOT SEATED HERE ANY MORE, AND THAT IS THE WHOLE OF THE ENTRY.
//
// What stood here was `rockSeats()` and `ROCK_SQUARE`: the rock plan filtered at
// 0.45 m, which src/world/contracts.js turned into the camera's boxes using the
// plan's own `y` and `meshHeight`. It was written as one source with two
// readers, and it had stopped being one: those two fields are the SMOOTH ROCK
// MESH V8 used to draw, sampled against a meadow that has been rewritten twice,
// and what this branch actually cuts is voxel PILES on the ground contract
// (src/world/rock-piles.js). Measured against the stone as cut, the boxes this
// file was handing out missed it by up to 627 mm and in one case -- rock-w1, box
// 0.541 .. 1.027 m over stone that runs 0.000 .. 0.400 -- did not overlap it at
// all, while four of the ten piles had no box because the 0.45 m line is the
// WALKER's rule about what he may step over.
//
// A LAYOUT MAY NOT HOLD A SECOND OPINION ABOUT A MESH. Where a rock stands is
// the plan's (assets-src/rocks/rocks.json), and how much room it takes up is a
// question only the file that cuts it can answer -- so both readers now ask
// there: `pileSolids()` for the lens, `ROCK_BLOCKERS` for the body, off one
// plan, in one file. Nothing in this world imports a rock seat from the layout
// any more, which is why the name is gone rather than deprecated.

