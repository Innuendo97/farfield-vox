import {
  BufferAttribute, BufferGeometry, Mesh, RepeatWrapping, ShaderMaterial,
  ClampToEdgeWrapping, Vector2, Vector3,
} from 'three';
import { SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS } from '../../core/sky.js';
import { FACE_LIGHT_GLSL, faceLightUniforms } from '../face-light.js';
import { FOG_GLSL, GROUND_EXPOSURE, fogUniforms } from '../air.js';
import TERRAIN from '../../../assets-src/terrain/terrain.json';
import {
  APRON, EARTH, FOOT, GRAIN, JOINT_DARK, JOINT_LIP, JOINT_SOFT, PATH_BUDGET,
  PEB_EDGE, PEB_LEVEL, PEB_MIX, SKIN_REACH, STONE, STONE_PALE, TUNING,
  GRAIN_GAIN, holeReport, pathMesh,
} from '../path.js';

// THE PATH. Owned by V3.
//
// IT IS GEOMETRY NOW, and that is the whole of what this chapter did. The path
// used to be painted into the ground's albedo and lit by the ground's baked
// atlas; it is a surface of its own, with maps of its own, lit by the two terms
// of a flat face and reading no atlas at all. src/world/path.js is where the
// corridor IS -- the strip, the paving, the pigment, the footprint -- and it
// holds none of three, the sky or the air on purpose, so that the painter and
// the guards can read the same seat the frame reads without a browser. This file
// is the other half of that split: it hangs the surface on the scene and it
// carries the fragment.
//
// WHY THE FRAGMENT IS HERE AND NOT THERE. It is the one piece of the corridor
// that cannot be shared with a Node script, because GLSL cannot call JavaScript.
// So the arithmetic of the pigment is written ONCE, in pathPigment() in
// src/world/path.js, and mirrored below line for line -- and the two are held
// together at the far end rather than at the near one: the plan patch the coat
// of paint is chosen on comes out of the seat, and the VERDICT is a real render
// at PLAN_POSE through this fragment. The gap between them is measured and
// written down rather than assumed to be nought.
//
// WHAT IT COSTS: one mesh, one material, one draw, 3 638 triangles of a budget
// of four thousand, and three maps that between them are lighter than the two
// the ground still carries for the paving and which this displaces.

const PATH_VERTEX = /* glsl */`
  attribute vec2 skin;
  attribute vec2 ground;
  attribute vec2 verge;
  varying vec2 vSkin;
  varying vec2 vGround;
  varying vec2 vVerge;
  varying vec3 vNormal;
  varying float vDistance;
  varying float vHeight;
  varying float vNorthing;

  void main() {
    vSkin = skin;
    vGround = ground;
    vVerge = verge;
    // The normal is the SURFACE's, solved on the CPU off the one seat for the
    // height of the ground and carried. It is what face-light turns into a pair
    // of terms, and there is no atlas anywhere in that sentence.
    vNormal = normalize(normalMatrix * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vHeight = world.y;
    vNorthing = world.z;
    vDistance = length(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const PATH_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vSkin;
  varying vec2 vGround;
  varying vec2 vVerge;
  varying vec3 vNormal;
  varying float vDistance;
  varying float vHeight;
  varying float vNorthing;

  uniform sampler2D tJoint;
  uniform sampler2D tTone;
  uniform sampler2D tGrain;
  uniform vec3 uEarth;
  uniform vec3 uStone;
  uniform vec3 uStonePale;
  uniform vec2 uJointDark;
  uniform vec2 uJointLip;
  uniform float uJointSoft;
  uniform float uSkinReach;
  uniform float uApronWarm;
  uniform vec2 uApron;
  uniform vec2 uJointFade;
  uniform vec2 uGrainFade;
  uniform float uGrainGain;
  uniform float uOutlier;
  uniform vec2 uPebEdge;
  uniform vec2 uPebLevel;
  uniform float uPebMix;

  ${SCENE_LIGHT_GLSL}
  ${FACE_LIGHT_GLSL}
  ${FOG_GLSL}

  void main() {
    // TWO FETCHES OFF ONE COORDINATE, and they are two textures because they
    // want two pitches. The first is how deep inside the nearest slot this point
    // stands: a RULER and not a picture, because eight bits of distance
    // interpolate to a POSITION, so the edge of the joint -- where it crosses
    // nought -- lands where the interpolation puts it and not where a texel
    // does, and the frame draws it finer than the texel that told it where it
    // was. The second is the level of the piece under the point, which is
    // piecewise constant on pieces a hand across and needs a quarter of the
    // pitch to say so.
    float depth = texture2D(tJoint, vSkin).r * uSkinReach;
    float tone = texture2D(tTone, vSkin).r;

    // How much of the apron's tuning applies here. Solved in the frame off the
    // northing the vertex already carries, because it is a smooth function of
    // one number and a second map for it would be a second opinion about where
    // the two tunings meet.
    float apron = smoothstep(uApron.x, uApron.y, vNorthing);

    // THE PIGMENT. One ramp, earth to pale stone, walked by the piece's tone.
    // Below the knee it is the soil between and over the pieces and above it the
    // slab, and the crossing is the eroded lip where the two meet -- which is
    // also what a texel interpolated across a piece boundary lands on, so the
    // one place the map cannot be piecewise constant is the one place a middle
    // value is right.
    vec3 albedo = tone < 0.5
      ? mix(uEarth, uStone, tone * 2.0)
      : mix(uStone, uStonePale, (tone - 0.5) * 2.0);

    // The warm of the apron, and it is a CHROMATICITY and not a level: what was
    // measured between the two stretches is +0.135 of (r-b)/(r+b) inside one
    // band of the frame, where the picture's own corner shading divides out.
    float warm = uApronWarm * apron;
    albedo *= vec3(1.0 + warm, 1.0, 1.0 - warm);

    // The small stones and the grain, from a tile repeated over the WORLD and
    // turned, because 2.8 cm written into a strip 8 mm a texel comes back a
    // stroke down the run. The turn is what costs the repeat its period along
    // the walk: stepping down the run by d moves the tile coordinate by
    // d*sin(19) across and d*cos(19) along, and the pattern only returns when
    // both are whole repeats, which for a ratio that is not a fraction never
    // happens at all.
    vec2 turned = vec2(
      vGround.x * ${Math.cos(GRAIN.turn * Math.PI / 180).toFixed(6)}
    + vGround.y * ${Math.sin(GRAIN.turn * Math.PI / 180).toFixed(6)},
      vGround.y * ${Math.cos(GRAIN.turn * Math.PI / 180).toFixed(6)}
    - vGround.x * ${Math.sin(GRAIN.turn * Math.PI / 180).toFixed(6)});
    vec2 grain = texture2D(tGrain,
      turned * ${(1 / GRAIN.metresPerRepeat).toFixed(6)}).rg;
    float near = 1.0 - smoothstep(uGrainFade.x, uGrainFade.y, vDistance);

    // The grain of the stone itself, which has mean a half by construction, so
    // it adds material without moving the level -- and the level is the fitted
    // pigment. It is what carries the variation INSIDE a piece, and the
    // reference wants more of that than there is between one piece and the next:
    // the spread between slabs is 0.78 of the spread within one.
    albedo *= 1.0 + near * uGrainGain * (grain.g - 0.5);

    // The stone lying on the ground, drawn from its own field so its rim is as
    // round as the frame likes rather than as round as the tile is: what is
    // stored is a half AT the rim, so the crossing is a position and it
    // interpolates.
    float inStone = smoothstep(uPebEdge.x, uPebEdge.y, grain.r) * near * uPebMix;
    albedo = mix(albedo, uStonePale * (uPebLevel.x + uPebLevel.y * grain.g), inStone);

    // THE SLOT, ACROSS ITS OWN WIDTH. The depth is nought over all the stone and
    // grows into the joint, so this needs no width of its own: where the joint
    // ENDS is where the depth returns to nought, which is the paving's answer
    // and not the frame's, and how deep into it a fragment stands is what says
    // whether it is on the broken lip of the two pieces or in the soil between
    // them.
    float far = 1.0 - smoothstep(uJointFade.x, uJointFade.y, vDistance);
    float inSlot = smoothstep(0.0, uJointSoft, depth) * far;
    float trough = smoothstep(uJointLip.x, uJointLip.y, depth);
    albedo *= 1.0 - inSlot * (uJointDark.x + (uJointDark.y - uJointDark.x) * trough);

    // THE LIGHT, AND THERE IS NO ATLAS IN IT. Two terms of a flat face from the
    // one producer in src/world/face-light.js, on the normal of the surface this
    // fragment stands on. A cosine has no texel grid to show through and nothing
    // to reconstruct between samples, which is the whole of why the corridor
    // stopped reading the ground's bake.
    vec3 light = faceLight(normalize(vNormal));

    // WHERE THE SURFACE IS. Solid over the paving, and out past the verge only
    // where there is a piece of stone: the slabs that surface in the meadow are
    // a fiftieth of that band by area and they stand proud of it, so they are
    // drawn and the earth around them is not.
    float outlying = smoothstep(uOutlier, 1.0, tone);
    float alpha = clamp(vVerge.y + (1.0 - vVerge.y) * outlying, 0.0, 1.0);

    vec3 colour = albedo * light;
    colour = mix(colour, uFogColour, fogAmount(vDistance, vHeight));
    gl_FragColor = vec4(colour, alpha);
  }
`;

// Where the joints stop being drawn, in metres from the eye. Past about twenty
// metres a joint of three centimetres is under a pixel, so the tail buys no
// definition and costs fill. A ramp of six metres and not a step, because a step
// is a ring on the ground standing at a fixed distance from the eye, which is
// what guard-sentiero-bande refuses.
export const JOINT_FADE = [19, 26];
// And where the tile of grain and small stones stops. Nearer, because what it
// carries is a centimetre band: it is gone from the picture by ten metres.
export const GRAIN_FADE = [12, 18];
// Above what tone a piece is drawn where the surface has already let go. The
// slabs that surface in the grass are the palest pieces and nothing else out
// there is stone.
export const OUTLIER_TONE = 0.74;

function buildCorridor({ joint, tone, grain }) {
  for (const map of [joint, tone]) {
    // CLAMPED, and it is not a formality: these do NOT repeat. They are laid
    // once along the run, so a wrap would fetch the far end of the paving for
    // ground just off the near end of it.
    map.wrapS = ClampToEdgeWrapping;
    map.wrapT = ClampToEdgeWrapping;
    // FOUR. What anisotropy buys is resolution along the long axis of a
    // footprint, and these textures' long axis is the run; four covers the ratio
    // the strip is seen at over the metres it is alive, and the taps it does not
    // take are fill on the busiest fragments in the frame.
    map.anisotropy = 4;
    map.needsUpdate = true;
  }

  // EIGHT for the tile, and for the reason the ground's own near material gets
  // eight: where this is alive the paving is seen from close to and steeply
  // foreshortened, so a pixel covers a few millimetres across the frame and
  // several times that down it. An isotropic filter is forced by the larger of
  // those and would average away everything the tile carries.
  grain.wrapS = RepeatWrapping;
  grain.wrapT = RepeatWrapping;
  grain.anisotropy = 8;
  grain.needsUpdate = true;

  const built = pathMesh();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(built.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(built.normals, 3));
  geometry.setAttribute('skin', new BufferAttribute(built.skin, 2));
  geometry.setAttribute('ground', new BufferAttribute(built.ground, 2));
  geometry.setAttribute('verge', new BufferAttribute(built.verge, 2));
  geometry.setIndex(new BufferAttribute(built.indices, 1));
  geometry.computeBoundingSphere();

  const material = new ShaderMaterial({
    uniforms: {
      tJoint: { value: joint },
      tTone: { value: tone },
      tGrain: { value: grain },
      uEarth: { value: new Vector3(...EARTH) },
      uStone: { value: new Vector3(...STONE) },
      uStonePale: { value: new Vector3(...STONE_PALE) },
      uJointDark: { value: new Vector2(...JOINT_DARK) },
      uJointLip: { value: new Vector2(...JOINT_LIP) },
      uJointSoft: { value: JOINT_SOFT },
      uSkinReach: { value: SKIN_REACH },
      uApronWarm: { value: TUNING.apron.warm },
      uApron: { value: new Vector2(...APRON) },
      uJointFade: { value: new Vector2(...JOINT_FADE) },
      uGrainFade: { value: new Vector2(...GRAIN_FADE) },
      uGrainGain: { value: GRAIN_GAIN },
      uOutlier: { value: OUTLIER_TONE },
      uPebEdge: { value: new Vector2(...PEB_EDGE) },
      uPebLevel: { value: new Vector2(...PEB_LEVEL) },
      uPebMix: { value: PEB_MIX },
      // THE EXPOSURE IS THE GROUND'S, TO THE FACTOR, and it is not a copy of a
      // taste. The corridor stands in the ground's air and is read against the
      // grass beside it: the two readings this chapter is gated on -- stone
      // against grass, 1.70 near and 3.41 far -- are RATIOS between this surface
      // and that one, so a second exposure here would move them both without
      // moving anything anybody can see, and the gate would be measuring this
      // number instead of the paving.
      //
      // BOTH FACTORS, AND THE SECOND ONE WAS MISSED ONCE. The ground develops
      // its light at TERRAIN.lightScale * GROUND_EXPOSURE and this had only the
      // second of them, which put the corridor at two thirds of the level of the
      // meadow it is bedded in -- measured on the page, 1.25 against the
      // ground's 1.875. It is read out of the two seats rather than written down
      // as one number, so a refit of either follows the paving without anybody
      // remembering that it has to.
      ...faceLightUniforms(TERRAIN.lightScale * GROUND_EXPOSURE),
      ...SCENE_LIGHT_UNIFORMS,
      ...fogUniforms(),
    },
    vertexShader: PATH_VERTEX,
    fragmentShader: PATH_FRAGMENT,
    // The surface is opaque over the paving and lets go only in the last quarter
    // of a metre, where nothing but meadow is under it. Depth is written,
    // because this IS the floor there and anything standing on it has to be
    // sorted against it.
    transparent: true,
    depthWrite: true,
    fog: false,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'path';
  // Drawn after the meadow it is laid on, and never culled: the corridor is one
  // long thin surface whose bounding sphere covers a good part of the world, so
  // a cull test on it costs more than it can ever save.
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return { mesh, triangles: built.triangles };
}

const layer = {
  id: 'v3-sentiero',

  meshes: [],
  built: null,

  dress: {
    // THE THREE MAPS ARE THE PATH'S OWN, and they are the first assets this
    // session has ever declared. They displace the two maps of the paving that
    // are declared in V1's fragment with a note saying they are the path's to
    // claim when the path becomes geometry of its own -- which is now. They are
    // not moved here, because that fragment is not this session's file; what is
    // reported instead is that the corridor reads neither of them, so the day
    // the ground stops painting a path under this one they can go, and the first
    // frame gets 731 kB back.
    //
    // THREE AND NOT ONE, and every split is a measurement. The ruler and the
    // level of the piece want different pitches and compress in opposite ways --
    // carried in one two-channel texture they cost 1 407 kB, apart they cost 731
    // -- and the field of small stones is over the WORLD and not along the run,
    // so it could not have shared a coordinate with either of them at any price.
    needs: ['path-joint', 'path-tone', 'path-grain'],

    build(assets) {
      const joint = assets['path-joint'];
      const tone = assets['path-tone'];
      const grain = assets['path-grain'];
      if (!joint || !tone || !grain) return null;
      layer.built = buildCorridor({ joint, tone, grain });
      layer.meshes = [layer.built.mesh];
      return layer.built;
    },
  },

  /** What the corridor is costing, for the development panel. */
  get triangles() {
    return layer.built ? layer.built.triangles : 0;
  },

  /**
   * What the ground contract says about the corridor's footprint, for whoever
   * has to close the gap.
   *
   * It is a handle rather than a side effect: asking it walks the run, which is
   * not something to do while a frame is being drawn.
   */
  hole: holeReport,

  /** Where the corridor stops being the floor, for anyone who has to know. */
  foot: FOOT,

  update() {},
};

export default layer;
export { PATH_BUDGET };
