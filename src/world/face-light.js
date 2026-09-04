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

// THE THIRD TERM: THE GROUND COMES BACK, and it is the only amendment this
// file has ever taken.
//
// WHY IT IS HERE AT ALL. Two terms describe a face under a sun and a dome and
// nothing else, and a face that the sun does not reach is then lit by the sky
// ALONE — which under the seal this world now ships is 0.133 / 0.478 / 1, a
// colour with almost no red in it. Measured against the day target that is not
// a small error and it is not a matter of degree. Four families say the same
// thing in four quantities that have nothing to do with each other, and all
// four are short in the SAME direction:
//
//     the meadow's ladder, bottom rung        0.2348   target 0.3495 and 0.327
//     a face at the sky alone, hue             242.8   target 208.3
//     the blades, flank over top                0.461  target 0.617
//     the grass family, sun over shade          5.30x  target 3.68x
//
// That direction is the light a real ground throws back up at what stands on
// it, and the reference has it because the reference stands on a meadow.
//
// WHAT IT IS, IN ONE LINE. The ground of this world, lit by the same two terms
// on its own upward normal, seen again by a face through the share of the
// hemisphere BELOW that face. That share is exactly one minus the sky term,
// because the sky term IS the share above; nothing new is measured, sampled or
// stored to get it, and no attribute is added to a vertex.
//
// AND ITS COLOUR IS THE MEADOW'S, WHICH IS A MEASUREMENT AND NOT A TASTE. Four
// candidate grounds were solved against the whole table of families at once,
// each at its OWN best strength, judged on the LARGEST relative error: this
// world's meadow 4.20 per cent, meadow and earth mixed four to one 5.02, the
// bare earth 8.62, neutral grey 17.56. A grey bounce is four times worse than a
// green one, and the target is what says so — the shadows of the reference are
// not blue because the sky is blue, they are the colour of the grass under
// them. That solve is not repeated here: what moved between it and this seal is
// the STRENGTH of the light, not the colour of the ground.
//
// THE STRENGTH IS THE WORLD'S CROWDING, AND IT IS FITTED UNDER THIS SEAL. One
// would be the whole of an unoccluded plane of that albedo; 0.235 is what
// lands, and it lands because a flank in this world sees cubes, blades and its
// own neighbours where the ideal plane sees ground. It is the minimax and the
// minimax is well conditioned: at 0.235 two readings of the ladder taken on
// different parts of the target go to par with each other and with the hue, at
// 3.1, 3.5 and 1.3 per cent —
//
//     k        0.200   0.225   0.235   0.245   0.260
//     ladder   0.3248  0.3347  0.3385  0.3423  0.3479
//     hue       211.4   207.3   205.7   204.1   201.7
//
// and the whole band from 0.22 to 0.26 is inside five per cent, so nothing here
// rests on the third digit.
//
// WHY IT IS NOT THE 0.215 THE SAME SOLVE FOUND BEFORE. That was fitted under
// the old seal; this world re-baked its sky irradiance against the ramp the
// renderer actually draws (R −75.85%, G −48.93%, B −28.12%), which took the sky
// term down and the shadows with it. A bounce is a FRACTION OF THE LIGHT, so
// when the light moves the fraction is refitted or it is a number describing a
// day nobody ships — which is exactly what happened the first time this term
// was carried across a seal instead of refitted under it.
//
// IT IS A LITERAL AND IT DOES NOT FOLLOW THE PIGMENT. The triple is the meadow
// albedo AS MEASURED THE DAY THIS WAS FITTED — src/world/voxel/pigment.js still
// reads the same three characters — copied deliberately and not referenced: the
// pigment is a FIELD now, two octaves over the world's own XZ, and a light that
// moved by itself when a material was refitted would be a light nobody could
// fit against. If the meadow's albedo moves, this is refitted on purpose,
// against the target, by whoever owns the light.
export const BOUNCE_SHARE = 0.235;
export const BOUNCE_GROUND = [0.272, 0.452, 0.000];
export const GROUND_BOUNCE = BOUNCE_GROUND.map((v) => v * BOUNCE_SHARE);

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

  // The ground's own colour, as a constant and NOT a uniform: it is fitted
  // arithmetic of the foundation, not a knob, and a uniform is a thing a
  // material can be handed a different value of. Stated once above in JS and
  // written in here, so there is one number and one place it is read from.
  const vec3 kGroundBounce = vec3(${GROUND_BOUNCE.map((v) => v.toFixed(6)).join(', ')});

  // THE producer. Nothing else in this world may write this pair.
  vec2 faceTerms(vec3 n) {
    return vec2(max(dot(n, uSunDir), 0.0), 0.5 + 0.5 * n.y);
  }

  // What a pair is worth as light. Separate from the line above so a material
  // that has to bend the sun term -- a relief on stone, a hollow -- bends the
  // pair it was GIVEN rather than writing a second opinion about where the sun
  // is.
  //
  // THE GROUND'S RETURN IS ADDED HERE AND NOT IN bakedLight(). bakedLight()
  // says what a PAIR means and is the campaign's oldest contract; this says
  // what a FACE gets, which is the pair plus what the ground under it throws
  // back. So every material that reads its light through this seat takes the
  // third term by construction, and the four lines in src/core/sky.js stay the
  // four lines they have always been.
  //
  // THE SHARE COMES OFF THE RAW PAIR AND NOT THE LIFTED ONE. One minus the sky
  // term is a piece of GEOMETRY -- how much of the hemisphere below the face
  // the face can see -- and a lift is a knob on the light. At the shipped lift
  // of one the two readings are the same number; keeping them apart is what
  // stops a lift from quietly bending a solid angle.
  //
  // AND A MATERIAL THAT BENDS THE PAIR GETS LESS OF IT, BY CONSTRUCTION AND NOT
  // BY A SECOND RULE. The mat of grass raises its own sky term for its flanks
  // (uBounce in ./voxel/material.js): one minus that term is then SMALLER, so
  // the ground's return into a blade is smaller by exactly the share of the
  // hemisphere the blade has already claimed as sky. The two cannot be counted
  // twice, and the reason is arithmetic rather than discipline.
  vec3 faceLightOf(vec2 terms) {
    vec3 ground = bakedLight(vec3(max(uSunDir.y, 0.0), 1.0, 0.0));
    return (bakedLight(vec3(terms * uLift, 0.0))
      + kGroundBounce * (1.0 - terms.y) * ground) * uLightScale;
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
