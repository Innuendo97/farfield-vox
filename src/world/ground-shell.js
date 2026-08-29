import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import { basinProfile } from './contracts.js';
import { heightAt } from './terrain-field.js';
import { AREA_CENTER } from './layout.js';
import { VOXEL, onPaving } from './voxel/index.js';

// THE SHELL: THE GROUND FROM THE RIM OF THE DISC OUT TO THE END OF V1'S WORLD.
//
// The disc is ten centimetre cubes and it is the only ground the hand can
// reach. Beyond it the same meadow has to keep going to the edge of what this
// session owns, and it cannot keep going as cubes: at thirty five metres a disc
// of them is three hundred and twenty thousand triangles before a single one of
// them is more than a pixel wide. So past the rim the meadow is a SHEET, and
// what makes it the same meadow is that its heights are the same field snapped
// to the same step and its material is the same material, by reference.
//
// WHERE IT STOPS, AND WHOSE DECISION THAT IS. A hundred metres, and it is
// E-V5h's: V1's world ends there and V5's frame begins. The bent grid this
// replaces reached a hundred metres on its axes and a hundred and forty one at
// its corners, and the terraces of the frame are drawn in that overrun -- a
// gate would have failed V5 for a plane of V1's. A circle and not a square is
// most of the fix on its own.
//
// WHAT IT IS SHAPED ON. `basinProfile` in src/world/contracts.js, which is the
// seat where the two sessions already agreed how far the ground beyond the disc
// has fallen: nought inside thirty five metres with a level tangent, a fitted
// cone of 0.1239 m per metre past sixty, and the tamest curve anybody could
// write between them. It is read and not reproduced -- a second copy of that
// shape here would be the exact defect contracts.js exists to prevent.
//
// AND IT IS ADDED TO THE FIELD, NOT SUBSTITUTED FOR IT. Inside thirty five
// metres the basin is nought, so out to there the shell is the walkable field
// itself, snapped to the step -- which is why it welds onto the cubes at ANY
// radius the tier hands it and not only at thirty five. Past thirty five the
// basin takes it away from the field and down, and nobody walks there.

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
 * The height of the sheet at a point, snapped to the voxel step.
 *
 * SNAPPED, AND THAT IS THE WHOLE OF WHAT MAKES IT THE SAME MEADOW. An unsnapped
 * sheet meeting a snapped disc reads as two materials: the cubes terrace and the
 * ground beyond them does not, and the eye finds the line in one frame. Rounded
 * rather than floored for the same reason columnTop is -- so the sheet straddles
 * the field instead of sitting half a step under it.
 */
function shellHeight(x, z) {
  const r = Math.hypot(x - AREA_CENTER.x, z - AREA_CENTER.z);
  return Math.round((heightAt(x, z) + basinProfile(r)) / VOXEL) * VOXEL;
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
      positions[o + 1] = shellHeight(x, z);
      positions[o + 2] = z - AREA_CENTER.z;
      normals[o + 1] = 127;
    }
  }

  const indices = vertices > 65535 ? new Uint32Array(RINGS * SPOKES * 6)
    : new Uint16Array(RINGS * SPOKES * 6);
  let k = 0;
  let quads = 0;
  let onPath = 0;
  for (let i = 0; i < RINGS; i++) {
    for (let s = 0; s < SPOKES; s++) {
      const s1 = (s + 1) % SPOKES;
      // THE PAVING IS NOT THIS SHEET'S, and where it runs out under the rim the
      // sheet stands aside rather than fighting the ground that draws it. It is
      // the same rule the disc lays no column under: onPaving is the engine's
      // and there is one of it.
      const rMid = (ringRadius(i, inner) + ringRadius(i + 1, inner)) / 2;
      const aMid = ((s + 0.5) / SPOKES) * Math.PI * 2;
      if (onPaving(AREA_CENTER.x + Math.cos(aMid) * rMid,
        AREA_CENTER.z + Math.sin(aMid) * rMid)) { onPath++; continue; }
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
    geometry, quads, onPath, vertices, triangles: quads * 2, inner,
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
      droppedOnPaving: built.onPath,
    },
  };
}
