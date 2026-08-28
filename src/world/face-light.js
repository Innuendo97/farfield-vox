import { Vector2 } from 'three';
import { SKY_UNIFORMS } from '../core/sky.js';

// THE TWO TERMS OF A FLAT FACE, AND THERE IS ONE PRODUCER OF THEM.
//
// FROZEN IN THE FOUNDATION. Not a style, not a tunable: this is the arithmetic
// the whole pivot rests on, and every surface of the voxel world reads its
// light through it — the meadow, the built stone, and everything the sessions
// add after them.
//
// WHY IT IS FOUR LINES. A flat face under a fixed sun and an isotropic sky IS
// four lines. The sun term is the cosine the face turns to the beam; the sky
// term is the share of the hemisphere the face can see, which for a plane is
// exactly half of one plus its own vertical. Those are the two numbers a bake
// would have stored, computed instead of fetched — and computed EXACTLY rather
// than sampled, which is why the reference's faces measure flat to three per
// cent across and an atlas's do not.
//
// WHY IT IS ONE SEAT AND NOT ONE COPY PER MATERIAL. Because it was two, and two
// is how a block and the grass at its foot end up disagreeing about the hour.
// The meadow's material and the masonry's each wrote this pair out in full, and
// they had already drifted: one of them put the lift below through the terms and
// the other did not. Eight sessions are about to add materials to this world. If
// each writes its own pair, the picture stops being one picture, and no gate
// reads a shader to find out — it reads a frame, where the disagreement looks
// like a fitting error and gets fitted against.
//
// WHAT IS DOWNSTREAM AND STAYS DOWNSTREAM. bakedLight() in src/core/sky.js says
// what a pair MEANS, in four lines that are the campaign's oldest contract and
// are not touched here. This says how a FACE produces one. A material may bend
// the sun term between the two — the masonry does, for its own relief — and
// that is why faceLightOf() takes the pair rather than the normal: bending it
// is a material's business, producing it is not.

// THE TWO KNOBS THAT ARE NOT THE VOXEL'S, and they live here so that the miss
// they answer can be SEEN in one place instead of argued in six.
//
// The reference's own shading implies a sun higher and weaker than the one this
// world is sealed to, so the orientation ladder cannot land while the light
// stays where it is. Both are ONE at rest, which is the honest reading, and one
// is what ships: moving either is a refit of scene-light.json, which moves the
// paving and the stone with it and belongs to the coordinator. Never a
// per-material fudge in a delivery.
//
// A guard that holds the shipped value at one is coming; until it does, this
// constant is the single place a reader can check.
export const NEUTRAL_LIFT = [1, 1];

// WHY THE SUN IS AN OPTION AND NOTHING ELSE IS. A uniform may be declared once
// per program, and SKY_GLSL in src/core/sky.js already declares uSunDir for
// every material that also draws the sky in itself — the built stone does.
// Those materials ask for the chunk without the line; they still get the same
// sun, because both names resolve to the one object SKY_UNIFORMS carries.
//
// @param {boolean} sunDeclared  true if the program already declares uSunDir
export function faceLightGlsl({ sunDeclared = false } = {}) {
  return /* glsl */`
${sunDeclared ? '' : '  uniform vec3 uSunDir;'}
  uniform float uLightScale;
  uniform vec2 uLift;

  // THE producer. Nothing else in this world may write this pair.
  vec2 faceTerms(vec3 n) {
    return vec2(max(dot(n, uSunDir), 0.0), 0.5 + 0.5 * n.y);
  }

  // What a pair is worth as light. Separate from the line above so a material
  // that has to bend the sun term -- a relief on stone, a hollow -- bends the
  // pair it was GIVEN rather than writing a second opinion about where the sun
  // is.
  vec3 faceLightOf(vec2 terms) {
    return bakedLight(vec3(terms * uLift, 0.0)) * uLightScale;
  }

  // The two together, for the materials that need no bend.
  vec3 faceLight(vec3 n) {
    return faceLightOf(faceTerms(n));
  }
`;
}

/** The chunk for a program that does not draw the sky in itself. */
export const FACE_LIGHT_GLSL = faceLightGlsl();

/**
 * The three uniforms the chunk above declares.
 *
 * The sun is shared BY REFERENCE with src/core/sky.js and never copied: there
 * is one sun in this world, and a material holding its own vector is a material
 * that keeps drawing noon after the preset has moved.
 *
 * @param {number} lightScale  what this surface's own exposure comes to
 * @param {number[]} lift      [sun, sky], and it is [1, 1] in a delivery
 */
export function faceLightUniforms(lightScale, lift = NEUTRAL_LIFT) {
  return {
    uSunDir: SKY_UNIFORMS.uSunDir,
    uLightScale: { value: lightScale },
    uLift: { value: new Vector2(lift[0], lift[1]) },
  };
}
