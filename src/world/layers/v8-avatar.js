// THE AVATAR AND THE THIRD PERSON. Owned by V8.
//
// IT BUILDS NOTHING TODAY. The walker is a camera: src/core/player.js moves a
// body that has no body, and src/core/presence.js gives it a gait the eye can
// feel without anything being drawn. There is nothing in the scene to wrap.
//
// WHAT V8 BUILDS: two avatars, the light personalisation, and the switch
// between the third person and the first -- both from the first day, because the
// framing already approved IS the third person one.
//
// IT IS NOT A BUDGET QUESTION, which is worth writing down because it looks like
// one. An avatar in voxels is about five hundred and sixty six filled cells and
// two hundred and fifty five of shell: less than a square metre of this meadow.
//
// WHAT IT READS RATHER THAN OWNS: where the ground is and what is standing on
// it, through src/world/contracts.js. A camera behind a body needs the same
// height the body needs, and it must be the same answer -- a third person camera
// that sank into a stair while the walker stood on it would be two opinions
// about one floor.
const layer = {
  id: 'v8-avatar',

  meshes: [],

  update() {},
};

export default layer;
