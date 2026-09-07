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
// AND ITS COLOUR IS THE GROUND'S, WHICH IS A MEASUREMENT AND NOT A TASTE — AND
// THE GROUND OF THIS WORLD IS NOT PURE GRASS.
//
// The solve is the same one the first fit ran and it is run again here, because
// the seal it was run under has moved and because the target now publishes
// something it did not publish then: the level, the chroma and the HUE of its
// own shadowed faces, face by face — the nine projected faces of the six blocks
// in assets-src/monoliths/masonry-spec.json `palette`, and the dark faces of its
// foreground rocks. Four candidate grounds, each at its OWN best strength,
// judged on the largest error in units of each reading's own error bar:
//
//     ground                        albedo                 strength   worst
//     this world's meadow           0.2632 0.4374 0.0000     0.203     2.22
//     meadow and earth, four to one 0.3453 0.4318 0.0230     0.217     1.62
//     meadow and earth, two to one  0.4000 0.4281 0.0384     0.229     1.78
//     the bare earth                0.6736 0.4094 0.1152     0.207     3.19
//     neutral grey                  0.3500 0.3500 0.3500     0.349     7.19
//
// THE PURE MEADOW WON THE FIRST TIME AND LOSES NOW, and the reason is a defect
// this file used to have BY CONSTRUCTION. The meadow's pigment carries a blue of
// EXACTLY NOUGHT — that is what src/world/voxel/pigment.js measures, and it is
// honest there, because the tone curve mixes channels and supplies the blue a
// green pixel needs. But a BOUNCE is not a pixel: it is light, and a ground that
// returns no blue at all leaves every face the sun does not reach lit by a blue
// sky plus a return with no blue in it, which comes out GREEN whatever anybody
// fits afterwards. U-PIETRA-2 measured exactly that on the flanks of the loose
// stones — L* 16.6 at chroma 14.3, where the target reads a near neutral
// [31 · 37 · 33] — and named this constant. With the four to one mix the same
// flank comes back at chroma 8.8, and nothing else moves more than a bar.
//
// The mix is not a preference either. The ground a flank in this world actually
// sees is meadow AND the earth under a thin mat: U-PRATO-2 put `SOIL_LEVEL`
// under the sparse mantle and separated the soil family, and the earth is where
// the blue comes from — 0.1152 of it, measured by the same census, in
// src/world/voxel/pigment.js.
//
// THE STRENGTH IS THE WORLD'S CROWDING, AND IT BARELY MOVED. One would be the
// whole of an unoccluded plane of that albedo; what lands is a flat basin,
// because a flank in this world sees cubes, blades and its own neighbours where
// the ideal plane sees ground. The worst error in error bars, against the
// shadowed faces of the target:
//
//     k       0.217  0.225  0.230  0.235  0.240  0.245  0.250  0.260
//     worst    1.62   1.71   1.76   1.82   1.90   1.99   2.09   2.29
//
// The free minimum is at 0.217 and the whole band to 0.245 is inside two bars,
// so nothing here rests on the third digit — and what picks 0.240 inside that
// band is a GATE and not a preference: the wall's own sun over shadow on block
// 01, which the target reads at 4.4 and guard-pietra holds between 4.0 and 4.8.
// That ratio is the one reading a shadowed face and a lit face share, so it is
// the tightest thing this constant touches: 4.92 at 0.217, 4.60 at 0.240, 4.36
// at 0.260. The choice is the leximin INSIDE the gate, and the gate is the
// target's.
//
// WHY THE 0.235 THE SAME SOLVE FOUND BEFORE IS NO LONGER THE SAME NUMBER. That
// was fitted under the previous seal, against a pure meadow with no blue in it.
// U-LUCE-4 moved the sun (azimuth 280 to 274, elevation 47 to 51), both
// strengths with it, and the colour above. A bounce is a FRACTION OF THE LIGHT,
// so when the light moves the fraction is refitted or it is a number describing
// a day nobody ships — which is what happened the first time this term was
// carried across a seal instead of refitted under it. That it lands two per
// cent from where it was is the answer and not the assumption: the fit was run
// again, and this is where it came out.
//
// IT IS A LITERAL AND IT DOES NOT FOLLOW THE PIGMENT. The triple is the mix AS
// MEASURED THE DAY THIS WAS FITTED — src/world/voxel/pigment.js still hands back
// the two ends of it — copied deliberately and not referenced: the pigment is a
// FIELD now, two octaves over the world's own XZ, and a light that moved by
// itself when a material was refitted would be a light nobody could fit against.
// If either albedo moves, this is refitted on purpose, against the target, by
// whoever owns the light.
export const BOUNCE_SHARE = 0.240;
export const BOUNCE_GROUND = [0.3453, 0.4318, 0.0230];
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
