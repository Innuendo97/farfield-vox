// THE NIGHT. Owned by V7.
//
// IT BUILDS NOTHING TODAY because there is no night in this world yet. The
// second target is a night, so this is the one layer that is new work rather
// than a rewrite, and its stub is here for the same reason the path's is: an
// eighth of the world with no seat in the register is an eighth that gets added
// by editing the register, and the register is everybody's file.
//
// WHAT V7 BUILDS: the preset, the field of lamps, the stars and their trails.
//
// TWO THINGS ARE ALREADY DECIDED ABOUT IT, from measurement rather than taste.
//
// NEVER REAL LIGHTS. Every surface in this world carries its own shading and a
// lamp in the scene would be a second sun nobody asked for. A night is the two
// terms of src/world/face-light.js moving, through the same bakedLight() the day
// goes through -- so nothing else in the world has to know it happened.
//
// AND THE LAMPS ARE ONE DRAW. Measured on the demo, a cluster of halos in front
// of the eye cost sixteen to thirty-five times its budget when each lamp was
// left to draw itself. Roughly two hundred additive quads on a half-float buffer
// with multisampling is real blending bandwidth, and the worst pose for it is
// standing in front of the whole cluster with every halo overlapping every other
// one. That is the pose this layer is measured at, not an average one.
const layer = {
  id: 'v7-notte',

  meshes: [],

  update() {},
};

export default layer;
