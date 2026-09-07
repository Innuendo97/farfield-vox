import { STANDING } from '../../core/avatar.js';
import { buildAvatar } from '../avatar/index.js';
import { CYCLE, LIFT, STRIDE_METRES, SUBDIVISION } from '../avatar/plan.js';
import { VOXEL } from '../voxel/pure.js';
import { CORPI, LOOK, albedos } from '../avatar/look.js';

// THE AVATAR AND THE THIRD PERSON. Owned by V8.
//
// WHAT IS HERE NOW: two bodies, in voxels a third of the world's step, one mesh
// and one draw each, standing wherever the walker is standing; and the light
// personalisation over them. The camera that exists because they do is next door
// in src/core/avatar.js, and the walker who moves them all is src/core/player.js.
//
// AND THE GAIT, WHICH IS SPENT IN METRES. Four frames of a stride, carried by
// three lattices (the two passings are the same shape), chosen by how far the
// walker has actually travelled rather than by a clock: a walk and a run put the
// same foot on the same patch of ground, and a body whose feet move at a rate of
// their own is a body skating. One draw, one material, one mesh -- what changes
// between frames is a buffer. The rise at the passings is a mesh offset, so not
// one cell of his palette or his tint moves with it.
//
// STILL TO COME: the head that follows the look, which cannot be done with one
// mesh and is not worth a second draw; and the sway of the shoulders.
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

  /** How far along the stride he is, 0 to 1, and which frame that lands on. */
  phase: 0,
  frame: 1,
  /** And how many cells he stands up by in it, which is nought when he is not walking. */
  lift: 0,

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
      /** The most a single frame of the step ever draws, which is the contacts'. */
      peak: drawn.peak,
      frame: layer.frame,
      lift: layer.lift,
      resident: {
        corpi: all.length,
        pose: CYCLE.length,
        quads: sum((b) => b.resident.quads),
        triangles: sum((b) => b.resident.triangles),
        vertices: sum((b) => b.vertices),
        celle: sum((b) => b.census.filled),
      },
    };
  },

  update(frame = {}) {
    if (!layer.bodies) return;

    // ------------------------------------------------------------- the step
    //
    // THE PHASE IS METRES WALKED AND NOT SECONDS ELAPSED. Divide the distance
    // covered by the stride and the cadence comes out on its own: 2.1 cycles a
    // second at the walk, 3.2 at the run, with no second number to keep in step
    // with the first. Below a crawl he stands: a figure marking time on the spot
    // is the one thing a phase driven by speed can still get wrong, and the
    // guard against it is one comparison.
    const speed = STANDING.speed || 0;
    if (speed < 0.15) {
      // STANDING IS THE PASSING LATTICE WITHOUT THE RISE, and the two have to be
      // said separately. The passing frame is the right SHAPE for a body at rest
      // -- feet together, arms down -- but it is a frame of a walk, and a walk
      // rises through it. Spending it whole leaves him hovering a cell above the
      // ground for as long as he stands still.
      layer.phase = 0;
      layer.frame = 1;
      layer.lift = 0;
    } else {
      layer.phase = (layer.phase + (speed * (frame.delta || 0)) / STRIDE_METRES) % 1;
      layer.frame = Math.min(CYCLE.length - 1, Math.floor(layer.phase * CYCLE.length));
      layer.lift = LIFT[layer.frame];
    }

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
      // AND HOW MUCH OF HIM, over the metre either side of the switch. One float
      // a frame into the one material he has; the dither is in his own fragment,
      // so nothing here sorts, blends or adds a pass. See STANDING.fade.
      body.material.uniforms.uFade.value = STANDING.fade;
      // The origin is the middle of the plane the soles stand on, which is what
      // the plan means by y = 0. So the stance goes straight in: no offset, and
      // nothing to get wrong the day the ground changes shape.
      // WHICH LATTICE, AND HOW HIGH HE STANDS IN IT. Both are the step's, and
      // both are one assignment: the geometry is a buffer swap on a mesh that
      // keeps its material, and the rise is the mesh's own y. The feet never go
      // BELOW the ground -- the passing frames lift and the contacts do not --
      // which is what keeps the boots out of the paving they are standing on.
      body.mesh.geometry = body.steps[CYCLE[layer.frame]];
      // AND THE FRAGMENT IS TOLD WHICH ONE, because the palette is generated for
      // all three at once and stamped: see PAINT_ALL in plan.js. A geometry that
      // did not say which pose it was would be painted by whichever frame's boxes
      // happened to be last in the list.
      body.material.uniforms.uPose.value = CYCLE[layer.frame];
      body.mesh.position.set(
        STANDING.x,
        STANDING.y + layer.lift * (VOXEL / SUBDIVISION),
        STANDING.z,
      );
      body.mesh.rotation.y = STANDING.yaw;
    }
  },
};

export default layer;
