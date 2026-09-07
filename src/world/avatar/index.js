import { BufferAttribute, BufferGeometry, Mesh, Sphere, Vector3 } from 'three';
import { VOXEL } from '../voxel/pure.js';
import { build } from './mesher.js';
import { avatarMaterial, avatarSettings } from './material.js';
import { BODIES, SUBDIVISION } from './plan.js';

// THE DOOR. Everything above this line is arithmetic that runs under plain node;
// this is the one file that knows there is a scene to put him in.
//
// It is the shape src/world/voxel/index.js has, for the same reason: the mesher
// and the plan are imported by measuring tools that have no browser, and a
// three.js import anywhere below here would take that away.

/** His cell: a quarter of the world's own step, exactly. 25 mm. */
export const AVATAR_VOXEL = VOXEL / SUBDIVISION;

/**
 * The figure, built once.
 *
 * ONE MESH AND ONE MATERIAL, WHICH IS ONE DRAW. The palette lives in the
 * fragment, so nothing about him needs a second program or a second buffer —
 * see src/world/avatar/material.js for why that is the recipe's rule and not a
 * saving.
 *
 * The mesh is NOT parented to anything and does not move itself: where he stands
 * is the walker's business, published through src/core/avatar.js and applied by
 * the layer. This returns the body and the numbers that were true of it when it
 * was built, so that a budget can be quoted from the same object the frame draws.
 */
export function buildAvatar(kind = 'm') {
  const plan = BODIES[kind];
  if (!plan) throw new Error(`no such body: ${kind}`);
  const settings = avatarSettings();
  const body = build(AVATAR_VOXEL, plan);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(body.positions, 3));
  // Three bytes rather than twelve: a normal has six values in this whole world
  // and the frame is shorter on vertex fetch than on anything else.
  geometry.setAttribute('normal', new BufferAttribute(body.normals, 3, true));
  geometry.setIndex(new BufferAttribute(body.indices, 1));
  geometry.boundingSphere = new Sphere(
    new Vector3(body.sphere.x, body.sphere.y, body.sphere.z), body.sphere.radius,
  );

  const material = avatarMaterial(AVATAR_VOXEL, settings, plan);
  const mesh = new Mesh(geometry, material);
  mesh.name = `v8-avatar-${kind}`;
  mesh.frustumCulled = true;
  // He is never in the first person's frame, and the switch is a flag rather
  // than an add and a remove: taking a mesh out of a scene and putting it back
  // costs a re-sort, and this happens on a key press.
  mesh.visible = false;

  return {
    kind,
    mesh,
    material,
    settings,
    quads: body.quads,
    triangles: body.triangles,
    vertices: body.vertices,
    census: body.census,
    voxel: AVATAR_VOXEL,
  };
}

export { avatarSettings, avatarMaterial };
