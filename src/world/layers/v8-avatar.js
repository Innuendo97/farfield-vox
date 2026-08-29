import { STANDING } from '../../core/avatar.js';
import { buildAvatar } from '../avatar/index.js';
import { CORPI, LOOK, albedos } from '../avatar/look.js';

// THE AVATAR AND THE THIRD PERSON. Owned by V8.
//
// WHAT IS HERE NOW: two bodies, in voxels a third of the world's step, one mesh
// and one draw each, standing wherever the walker is standing; and the light
// personalisation over them. The camera that exists because they do is next door
// in src/core/avatar.js, and the walker who moves them all is src/core/player.js.
//
// WHAT IS STILL TO COME: the gait — stride, sway, the head that follows the look.
// They stand still on purpose today: a body that walks is contracts re-derived on
// builtHeightAt and groundHeightAt, and those belong to the unit after next.
//
// BOTH ARE BUILT AND ONE IS DRAWN. Building the second body at the moment a
// walker picks it would put a mesher, a lattice of seven thousand cells and a
// shader compile on the frame after a click — which is exactly the frame that
// must not stutter, the same reasoning that already made the first/third person
// switch a flag instead of an add and a remove. So both are built once, at plant,
// and the choice is `visible`. What holding the unlooked-at one costs is its
// buffers and its program; what DRAWING costs is one body. The two numbers are
// reported separately in stats() rather than added into a single figure that
// would answer neither question.
//
// THEY COST NOTHING TO HAVE. A hundred and fifty six quads for him and a hundred
// and sixty five for her — three hundred and twelve triangles and three hundred
// and thirty — against a budget of fifteen hundred for the layer with both inside
// it, and a world that already draws a hundred and thirteen thousand. Each is ONE
// draw, because the palette lives in the fragment: see
// src/world/avatar/material.js for why that is the recipe's rule and not a
// saving. The earliest note in this seat guessed five hundred and sixty six
// filled cells and two hundred and fifty five of shell — that was a figure at the
// WORLD's step; at a third of it he is seven thousand one hundred and forty eight
// filled with two thousand seven hundred and twelve of shell, and she is six
// thousand six hundred and sixteen with two thousand five hundred and eighty.
// Neither number is what they cost. What they cost is the merged surface, and the
// merge does not care how many cells stand behind it.
//
// NONE OF THOSE SIX NUMBERS IS TYPED FROM MEMORY, and the reason to say so is
// that this seat has already had to correct a set of them once: the note here
// used to declare 135 quads where the mesher made 139, and a comment that is
// wrong about the thing it describes is worse than no comment.
// v8-avatar/dev-c/conti-due.txt counts them a second time by a road that shares
// no code with the mesher — the lattice walked again for BOTH bodies, the open
// faces counted one at a time, and the merged rectangles checked to cover exactly
// their area, which is the one thing a merge that had dropped or doubled a face
// could not do. It is one command, and they move whenever the plan moves.
//
// THE PERSONALISATION IS A FLAG AND EIGHT VECTORS. Which body is a `visible`;
// which variant is the palette uniform, recomputed from src/world/avatar/look.js
// only when the choice actually changed — LOOK.revision is what says whether it
// did, so an unchanged frame costs one integer comparison. Nothing here rebuilds
// geometry, asks for a byte, or adds a draw.
//
// WHAT IT READS RATHER THAN OWNS: where the feet are and which way they face,
// through STANDING in src/core/avatar.js, which the walker fills in the same call
// that puts the camera in the scene. The ground under those feet is the hub's
// `groundHeightAt`, already inside the stance they are handed — so the body and
// the third person camera stand on one floor by construction rather than by
// agreement.
//
// NOTHING IS DELIVERED FOR EITHER OF THEM. No atlas, no sheet, no byte on the
// wire: they are the same five things the meadow is made of, rebuilt in their own
// fragment. That is why `needs` is empty, and it is why a second body and a
// personalisation arrive without a second download.
const layer = {
  id: 'v8-avatar',

  meshes: [],

  /** Both of them, under the names look.js calls them by. */
  bodies: null,

  /** Which revision of the personalisation the palettes were last written for. */
  painted: -1,

  plant: {
    needs: [],

    build() {
      layer.bodies = Object.fromEntries(CORPI.map((c) => [c.id, buildAvatar(c.id)]));
      layer.meshes = CORPI.map((c) => layer.bodies[c.id].mesh);
      layer.painted = -1;
      return layer.bodies;
    },
  },

  /**
   * What they cost when they were built, for the development panel and the gates.
   *
   * TWO ANSWERS TO TWO QUESTIONS, kept apart on purpose. `quads`, `triangles` and
   * `draws` are what a FRAME pays: one body, because only one is ever visible.
   * `resident` is what the LAYER holds, which is both of them, and that is the
   * number the chapter's budget is written against.
   */
  stats() {
    if (!layer.bodies) return null;
    const drawn = layer.bodies[LOOK.corpo] ?? layer.bodies.m;
    const all = Object.values(layer.bodies);
    const sum = (pick) => all.reduce((s, b) => s + pick(b), 0);
    return {
      quads: drawn.quads,
      triangles: drawn.triangles,
      vertices: drawn.vertices,
      census: drawn.census,
      voxel: drawn.voxel,
      draws: 1,
      corpo: drawn.kind,
      resident: {
        corpi: all.length,
        quads: sum((b) => b.quads),
        triangles: sum((b) => b.triangles),
        vertices: sum((b) => b.vertices),
        celle: sum((b) => b.census.filled),
      },
    };
  },

  update() {
    if (!layer.bodies) return;

    // THE PALETTE, ONLY WHEN IT MOVED. Writing eight vectors into two materials
    // every frame would be nearly free and would still be wrong: it would put the
    // personalisation on the frame's critical path for nothing, and it would hide
    // the day something started changing the choice per frame. The revision is
    // what says whether anybody asked.
    if (layer.painted !== LOOK.revision) {
      const colours = albedos();
      for (const body of Object.values(layer.bodies)) {
        colours.forEach((rgb, i) => {
          // The fourth channel is that garment's GRAIN and belongs to the plan,
          // not to the walker: it is read back off the slot rather than rewritten,
          // so a personalisation can never quietly change how much a garment
          // varies from voxel to voxel.
          const slot = body.settings.palette[i];
          slot.set(rgb[0], rgb[1], rgb[2], slot.w);
        });
        body.material.userData.refresh();
      }
      layer.painted = LOOK.revision;
    }

    for (const [kind, body] of Object.entries(layer.bodies)) {
      // ONE FLAG AND NOT AN ADD AND A REMOVE. They are out of the frame for the
      // whole of the first person, which is most of the time, and taking a mesh
      // out of a scene costs the renderer a re-sort — on a key press, which is
      // exactly when a frame must not stutter. The body nobody chose is hidden the
      // same way and for the same reason.
      body.mesh.visible = STANDING.drawn && kind === LOOK.corpo;
      if (!body.mesh.visible) continue;
      // The origin is the middle of the plane the soles stand on, which is what
      // the plan means by y = 0. So the stance goes straight in: no offset, and
      // nothing to get wrong the day the ground changes shape.
      body.mesh.position.set(STANDING.x, STANDING.y, STANDING.z);
      body.mesh.rotation.y = STANDING.yaw;
    }
  },
};

export default layer;
