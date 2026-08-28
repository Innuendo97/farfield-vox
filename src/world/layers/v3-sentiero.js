// THE PATH. Owned by V3.
//
// IT BUILDS NOTHING TODAY, AND THAT IS THE HONEST STATE RATHER THAN AN OVERSIGHT.
// The path is not separate geometry in this world: it is painted into the
// ground's albedo, cut into the height field, and given its grain and its
// joints by two maps the ground's own material eats. There is no path module to
// wrap, so this stub wraps nothing and says why.
//
// The two assets that are really the path's -- `terrain-detail`, the material
// under the walker's feet, and `terrain-path`, where the joints of the paving
// are -- are declared in v1-suolo.js today, because a need belongs beside the
// code that eats it and today that code is the ground's material. They move
// here when the corridor becomes geometry.
//
// WHAT V3 BUILDS: the textured corridor, the paving carried over from the
// campaign that painted it, and the verge. It cuts its own hole in the ground
// through `groundHoleAt` in src/world/contracts.js rather than by agreement with
// V1 -- that contract is the whole reason the two sessions can run at the same
// time.
//
// THE STUB IS HERE AND EMPTY ON PURPOSE. An eighth of the world with no seat in
// the register is an eighth that gets added by editing the register, and the
// register is everybody's file.
const layer = {
  id: 'v3-sentiero',

  meshes: [],

  update() {},
};

export default layer;
