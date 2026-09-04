import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import { shellHeightAt } from './contracts.js';
import { AREA_CENTER } from './layout.js';

// THE SHELL: THE GROUND FROM THE RIM OF THE DISC OUT TO THE END OF V1'S WORLD.
//
// The disc is ten centimetre cubes and it is the only ground the hand can
// reach. Beyond it the same meadow has to keep going to the edge of what this
// session owns, and it cannot keep going as cubes: at thirty five metres a disc
// of them is three hundred and twenty thousand triangles before a single one of
// them is more than a pixel wide. So past the rim the meadow is a SHEET, and
// what makes it the same meadow is that it starts at the floor the cubes DRAW,
// on the same step, wearing the same material by reference.
//
// WHERE IT STOPS, AND WHOSE DECISION THAT IS. A hundred metres, and it is
// E-V5h's: V1's world ends there and V5's frame begins. The bent grid this
// replaces reached a hundred metres on its axes and a hundred and forty one at
// its corners, and the terraces of the frame are drawn in that overrun -- a
// gate would have failed V5 for a plane of V1's. A circle and not a square is
// most of the fix on its own.
//
// WHAT IT IS SHAPED ON, AND WHERE THAT SHAPE LIVES. `shellHeightAt` in
// src/world/contracts.js -- the seat where the two sessions already agreed how
// far the ground beyond the disc has fallen, and where the height a walker
// standing on this sheet is answered from. It is read and not reproduced: this
// file used to carry its own copy of that arithmetic and the contract carried
// another, and by this step the two were a voxel apart with nothing pinning
// them together. One statement, two readers, and the mesh below is one of them.
//
// AND IT IS LAID ON THE FLOOR THE DISC DRAWS, WHICH IS NOT THE FIELD, AND THAT
// ONE VOXEL WAS THE SEAM.
//
// The sheet used to be laid on `heightAt` -- the walkable field, which is a
// voxel BELOW nought so that the top face of a base column lands exactly on
// nought (see BASE_LEVEL in ./terrain-field.js). But the eye is never given the
// field: it is given the face above it. So the cubes ended at nought, the sheet
// began at minus a tenth, and the ground stepped down ten centimetres all the
// way round the rim -- measured at 100 mm on 164 of 360 bearings, and it is the
// residue E-FOND-PIANO2 carried to this step.
//
// Laid on the floor the disc DRAWS, there is nothing to step down: inside
// thirty five metres the basin is nought, so out to there the sheet is the same
// plane as the meadow's own tops, which is why it welds onto the cubes at ANY
// radius the tier hands it and not only at thirty five. What still stands over
// it at the rim is the grain -- the one voxel the meadow's own sods stand on the
// floor, everywhere inside the disc as well as at its edge -- and the corridor's
// own trench, one voxel under, which is the measurement A 1.3 takes along the
// whole run. Neither is a seam: they are the meadow, arriving at the rim as
// itself.
//
// AND THE BASIN IS MEASURED FROM NOUGHT, WHICH IS WHAT ITS OWN SEAT SAYS. The
// two arms of standing water were fitted against a ground plane at nought
// (A 1.1); the sheet that carried them was a voxel under it. Past thirty five
// the water is now where the contract puts it and not a step below.

/** How far V1's own world reaches, in metres. E-V5h. */
export const SHELL_REACH = 100;

/**
 * How far the sheet reaches back UNDER the cubes, in metres.
 *
 * AN OVERLAP AND NOT A JOIN, because a join is a thing that can be got wrong by
 * a centimetre and an overlap cannot. The rim of the disc is not a circle: it
 * is whichever columns fell inside the radius, so it is a staircase of ten
 * centimetre steps, and a sheet cut to meet it exactly would have to reproduce
 * that staircase. Instead the sheet runs under it and the cubes stand on top,
 * which they do by construction -- a cube's top is the field plus the carpet
 * plus its own height, and the sheet is the field.
 */
const OVERLAP = 0.6;

/**
 * Rings and spokes.
 *
 * THE RESOLUTION IS SPENT WHERE THE EYE IS, the way the grid this replaces
 * spent it, and for the same reason: the far half of a sheet like this is
 * extinguished by the air long before it is short of vertices. The rings are
 * laid on a power law from the seam outwards, so the first of them is eleven
 * centimetres past the rim and the last is nine metres wide.
 *
 * THE COUNTS ARE WHAT THEY COST. Twenty eight by a hundred and twenty eight is
 * 3 584 quads, 7 168 triangles, one draw -- against the 36 481 quads and 72 962
 * triangles of the bent grid it retires, drawn every frame with the culling
 * switched off. The trade is measured in the verbale, not assumed here.
 */
const RINGS = 28;
const SPOKES = 128;
const BEND = 2.0;

/** Where a ring stands, in metres from the middle of the world. */
function ringRadius(i, inner) {
  const t = (i / RINGS) ** BEND;
  return inner + (SHELL_REACH - inner) * t;
}

/**
 * The sheet, as one indexed mesh.
 *
 * @param {number} radius  where the disc of cubes ends, in metres
 * @returns {object} the geometry and what it came to
 */
function buildShell(radius) {
  const inner = Math.max(0, radius - OVERLAP);
  const vertices = (RINGS + 1) * SPOKES;
  const positions = new Float32Array(vertices * 3);
  // Straight up, on every one of them. The material's light is analytic on the
  // normal and the meadow's own top faces are the family it belongs to: a sheet
  // that shaded itself by its slope would be a second opinion about what colour
  // flat ground is, thirty five metres from ground that already answered.
  const normals = new Int8Array(vertices * 3);

  for (let i = 0; i <= RINGS; i++) {
    const r = ringRadius(i, inner);
    for (let s = 0; s < SPOKES; s++) {
      const a = (s / SPOKES) * Math.PI * 2;
      const x = AREA_CENTER.x + Math.cos(a) * r;
      const z = AREA_CENTER.z + Math.sin(a) * r;
      const o = (i * SPOKES + s) * 3;
      // In the mesh's own frame, which stands at the middle of the world: the
      // material rebuilds the cell out of the fragment's position, and a
      // hundred metres of it either side of nought is the smallest range this
      // shape can be written in.
      positions[o] = x - AREA_CENTER.x;
      positions[o + 1] = shellHeightAt(r);
      positions[o + 2] = z - AREA_CENTER.z;
      normals[o + 1] = 127;
    }
  }

  const indices = vertices > 65535 ? new Uint32Array(RINGS * SPOKES * 6)
    : new Uint16Array(RINGS * SPOKES * 6);
  let k = 0;
  let quads = 0;
  for (let i = 0; i < RINGS; i++) {
    for (let s = 0; s < SPOKES; s++) {
      const s1 = (s + 1) % SPOKES;
      // THE SHEET NO LONGER STANDS ASIDE FOR THE PAVING, and the quads it used
      // to drop are back.
      //
      // It dropped them because the corridor was a surface of its own, laid
      // over a hole and reaching to z = 31 -- well past the rim of the disc --
      // so out there the sheet and the paving would have covered the same
      // ground. The corridor is columns now and it ends where the disc's
      // columns end. A sheet that kept standing aside would be leaving a band
      // of nothing along the passage from the rim outwards, which is a hole in
      // the ground and not a saving.
      const a = i * SPOKES + s;
      const b = i * SPOKES + s1;
      const c = (i + 1) * SPOKES + s1;
      const d = (i + 1) * SPOKES + s;
      // Wound so the face looks up, the way the mesher winds a top.
      indices[k++] = a; indices[k++] = d; indices[k++] = c;
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      quads++;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3, true));
  geometry.setIndex(new BufferAttribute(indices.subarray(0, k), 1));
  geometry.computeBoundingSphere();
  return {
    geometry, quads, vertices, triangles: quads * 2, inner,
  };
}

/**
 * The ground beyond the cubes, as one mesh and one draw.
 *
 * @param {object} options
 * @param {number} options.radius  where the disc ends, in metres. The tier's.
 * @param {object} options.material  the disc's own, shared BY REFERENCE so a
 *                 sweep that moves the meadow moves the shell with it and the
 *                 seam can never be a difference between two settings objects.
 * @returns {object} the mesh to hang and what it came to
 */
export function createGroundShell({ radius, material }) {
  const built = buildShell(radius);
  const mesh = new Mesh(built.geometry, material);
  mesh.name = 'ground-shell';
  mesh.position.set(AREA_CENTER.x, 0, AREA_CENTER.z);
  // ONE DRAW AND NOTHING TO CULL. The sheet is two hundred metres across and
  // the eye is inside it: it is in frame at every pose there is, so a frustum
  // test on it is a test whose answer is known. The disc is chunked because a
  // wedge of forty four degrees asks for a fraction of it; this is the opposite
  // shape and gets the opposite treatment.
  mesh.frustumCulled = false;
  return {
    mesh,
    built: {
      radius: built.inner,
      reach: SHELL_REACH,
      rings: RINGS,
      spokes: SPOKES,
      vertices: built.vertices,
      quads: built.quads,
      triangles: built.triangles,
    },
  };
}
