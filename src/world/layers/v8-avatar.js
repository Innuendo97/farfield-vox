import { STANDING } from '../../core/avatar.js';
import { buildAvatar } from '../avatar/index.js';

// THE AVATAR AND THE THIRD PERSON. Owned by V8.
//
// WHAT IS HERE NOW: the male body, in voxels a third of the world's step, one
// mesh and one draw, standing wherever the walker is standing. The camera that
// exists because he does is next door in src/core/avatar.js, and the walker who
// moves them both is src/core/player.js.
//
// WHAT IS STILL TO COME: the female body and the light personalisation, and then
// the gait — stride, sway, the head that follows the look. He stands still on
// purpose today: a body that walks is contracts re-derived on builtHeightAt and
// groundHeightAt, and those belong to the unit after next.
//
// HE COSTS NOTHING TO HAVE. A hundred and thirty nine quads, which is two
// hundred and seventy eight triangles: a four hundredth of the hundred and
// thirteen thousand the world already draws, in the one draw call his single
// material buys. The earlier note in this seat guessed five hundred and sixty
// six filled cells and two hundred and fifty five of shell — that was a figure
// at the WORLD's step; at a third of it he is seven thousand two hundred and
// eighty filled and three thousand and fifty of shell, and neither number is
// what he costs. What he costs is the merged surface, and the merge does not
// care how many cells are behind it: three thousand eight hundred and forty
// eight open faces leave as a hundred and thirty nine rectangles, twenty eight
// faces to a rectangle.
//
// EVERY ONE OF THOSE NUMBERS IS COUNTED IN v8-avatar/dev-b/corpo-conti.txt, a
// second time and by a road that shares no code with the mesher's own: the
// lattice is walked again, the open faces are counted one at a time, and the
// merged rectangles are checked to cover exactly their area — which is the one
// thing a merge that dropped or doubled a face could not do.
//
// WHAT IT READS RATHER THAN OWNS: where his feet are and which way he faces,
// through STANDING in src/core/avatar.js, which the walker fills in the same
// call that puts the camera in the scene. The ground under those feet is the
// hub's `groundHeightAt`, already inside the stance he is handed — so the body
// and the third person camera stand on one floor by construction rather than by
// agreement.
//
// NOTHING IS DELIVERED FOR HIM. No atlas, no sheet, no byte on the wire: he is
// the same five things the meadow is made of, rebuilt in his own fragment. That
// is why `needs` is empty, and it is the reason the chapter can promise a second
// body and a personalisation without a second download.
const layer = {
  id: 'v8-avatar',

  meshes: [],

  avatar: null,

  plant: {
    needs: [],

    build() {
      layer.avatar = buildAvatar();
      layer.meshes = [layer.avatar.mesh];
      return layer.avatar;
    },
  },

  /** What he cost when he was built, for the development panel and the gates. */
  stats() {
    if (!layer.avatar) return null;
    const { quads, triangles, vertices, census, voxel } = layer.avatar;
    return {
      quads, triangles, vertices, census, voxel, draws: 1,
    };
  },

  update() {
    const body = layer.avatar;
    if (!body) return;
    // ONE FLAG AND NOT AN ADD AND A REMOVE. He is out of the frame for the whole
    // of the first person, which is most of the time, and taking a mesh out of a
    // scene costs the renderer a re-sort — on a key press, which is exactly when
    // a frame must not stutter.
    body.mesh.visible = STANDING.drawn;
    if (!STANDING.drawn) return;
    // His origin is the middle of the plane his soles stand on, which is what
    // the plan means by y = 0. So the stance goes straight in: no offset, and
    // nothing to get wrong the day the ground changes shape.
    body.mesh.position.set(STANDING.x, STANDING.y, STANDING.z);
    body.mesh.rotation.y = STANDING.yaw;
  },
};

export default layer;
