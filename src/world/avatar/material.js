import { ShaderMaterial, Vector3 } from 'three';
import { SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS } from '../../core/sky.js';
import { FACE_LIGHT_GLSL, faceLightUniforms } from '../face-light.js';
import { FOG_GLSL, GROUND_EXPOSURE, fogUniforms } from '../air.js';
import TERRAIN from '../../../assets-src/terrain/terrain.json';
import { BODY, PALETTE } from './plan.js';

// THE FIGURE'S MATTER, AND IT IS THE WORLD'S.
//
// Same recipe, same five things, same producers: the tint of a cell against its
// neighbour, the joint as a line and not a well, the lightened upper arris done
// as a facet leaning up rather than as a paler colour, the analytic light
// through bakedLight(), and the air in front of it. None of that is restated
// here — src/world/face-light.js writes the light, src/core/sky.js owns the two
// colours it is made of, src/world/air.js owns the air, and all three arrive as
// shared uniform objects rather than as copies, because a copy would be a second
// answer to where the sun is.
//
// ---------------------------------------------------- the two things that differ
//
// 1. THE CELL IS THE BODY'S AND NOT THE WORLD'S, in both senses.
//
//    In SIZE: uVoxel is a third of the meadow's step. That is measured — the
//    figure's own step reads 6 px in the reference against the 15 px a world
//    cell spans at his distance — and it is not the banned "ring of scales"
//    either, because the size belongs to the BODY and not to how far away the
//    walker is standing.
//
//    In FRAME: the meadow's fragment adds where its chunk stands to the cell it
//    hashes, so that two chunks meeting cannot draw a seam. A body must NOT do
//    that. Its model matrix moves and turns, so a cell index taken through the
//    world would slide by one every 33 mm he walks and the tint of his whole
//    jacket would crawl as he went. Here the cell comes off the local position
//    alone, which welds the pattern to him: the same voxel keeps the same tint
//    from the first step to the last, which is what a garment does.
//
// 2. HE IS NOT ONE COLOUR. The meadow is a single albedo; a man is hair, jacket,
//    pack, jeans, boots and skin. The obvious way to carry that is a palette
//    index per vertex, and it is exactly the thing the recipe forbids and the
//    guard rejects — and rightly, because it would also stop the merge that
//    keeps him at a hundred and thirty nine quads.
//
//    So the palette is REBUILT IN THE FRAGMENT out of the same arithmetic the
//    tint already is: the fragment knows which cell it is in, and which garment
//    a cell belongs to is a property of the cell. The function below is
//    GENERATED FROM THE PLAN, walking the same boxes in the same order that the
//    mesher filled the lattice with, so the two cannot disagree about a cell —
//    there is one list, and this is a second reader of it rather than a second
//    copy of it.
//
//    What it costs is around twenty box tests on a figure that covers a
//    thirtieth of the frame. What it buys is one draw call and no attribute
//    beyond position and normal.

/** The tunables, live, so a sweep costs a redraw and not a rebuild. */
export function avatarSettings() {
  return {
    // Held at the meadow's measured values rather than re-swept: the recipe's
    // readings are of the reference PICTURE's material and the figure is drawn
    // in the same picture out of the same stuff. Where the figure would want
    // its own number, it is said here and nowhere else.
    //
    // 1.30 is the ceiling the recipe measured, not a preference.
    tint: 1.30,
    // Less hue spread than the meadow, and this one IS the figure's own. The
    // meadow's 0.22 varies green against the two either side of it because that
    // is the axis a meadow varies along; cloth varies in level far more than in
    // hue, and at 0.22 a navy jacket picks up a green cast the reference has
    // nowhere on it.
    hue: 0.09,
    // The joint, unchanged: six per cent over one or two pixels, a LINE and not
    // a well. On the figure it is the whole of the micro-occlusion the reference
    // shows — at the elbows and under the pack — and there is no broader
    // darkening anywhere in either picture to justify more.
    joint: 0.06,
    jointPixels: 1.6,
    // THE LIT UPPER ARRIS, AND THE ONE NUMBER ON THIS FIGURE THAT IS NOT THE
    // MEADOW'S. The meadow lifts it at 1.0 and this lifts it at 0.034, which
    // wants saying plainly rather than burying: he carries a thirtieth of the
    // world's lit edge, and it was measured, not preferred.
    //
    // WHY THE WORLD'S OWN NUMBER CANNOT COME HERE. The term has a fade and a
    // clamp, and a 33 mm cell falls in the gap between them.
    //   the fade   smoothstep(2.5, 5.0, onScreen) takes the arris out when a
    //              cell gets small on screen — which is what stops the meadow's
    //              far cubes from turning into corduroy.
    //   the clamp  the band is arrisPixels wide but never more than 0.30 of a
    //              cell, which is what stops a near cube's edge from swallowing
    //              its face.
    // At the two fitted framings one of his cells is 6.7 px. That is PAST the
    // fade — it gets the term at full strength — and 2.2 px of band is 33% of
    // it, so the clamp bites on EVERY cell he has. A third of every cube lit as
    // if it leaned into the sky, on every cube, is the horizontal banding
    // v8-avatar/dev-b/confronto-giorno-x2-g1.png shows down his whole back. The
    // meadow never lands there: its cells are 12 px and up at these distances,
    // where the band is 5-18% of a cell, and below 5 px the fade has already
    // taken the term away.
    //
    // WHERE 0.034 COMES FROM, AND WHICH PANEL IT IS READ ON.
    // v8-avatar/dev-b/bordo-taratura.txt sweeps it live at both fitted framings
    // against the reference, through an estimator proved in both directions
    // first (v8-avatar/dev-b/bordo-prova.txt: nothing on a flat panel, a floor
    // of 0.34% on noise, exact on a faint edge, and never inflating a strong
    // one). The reading is taken on THE BACK OF HIS LEG — thirty nine columns by
    // eleven cells of one garment, navy in both pictures column by column — and
    // it crosses the reference at 0.020 by day and 0.047 by night. 0.034 is
    // their mean, and the two targets sit 0.027 apart, which is the width of
    // the answer and not the sweep's uncertainty.
    //
    // NOT ON THE SLEEVE, and the correction is worth keeping written down
    // because the sleeve is what this seat was handed as the clean panel. It
    // cannot be cut both honestly and large. At the plan's own outer arm cells
    // it reads 49,68,34 in the day reference — R minus B of PLUS fourteen, which
    // is meadow, not navy. Cut back to the columns that are navy in both, it is
    // under five cells tall, and a fold that short aliases the strap running
    // down his shoulder into something with a cell period: it reported the
    // reference at 28% of lit edge where the picture, at ten times magnification
    // in v8-avatar/dev-b/zoom-spalla-target-x10.png, is flat navy with one
    // bright strap and no banding at all. The leg also has the two targets
    // agreeing eight times more closely than the sleeve does, which is the
    // second reason to believe it.
    //
    // AT FULL STRENGTH THE LEG READS 49% BY DAY AGAINST THE REFERENCE'S 1.3%.
    arris: 0.034,
    arrisPixels: 2.2,
    arrisLean: 1.0,
    palette: PALETTE.map((p) => new Vector3(...p.albedo)),
  };
}

// Two decorrelated draws from three whole numbers, without a transcendental.
// The same hash the meadow uses, on the same shape of input, so a cube of him
// and a cube of the ground beside him vary the same way.
const HASH_GLSL = /* glsl */`
  vec2 cellHash(vec3 cell) {
    vec3 p = fract(cell * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract(vec2((p.x + p.y) * p.z, (p.y + p.z) * p.x));
  }
`;

/**
 * The plan, as the fragment's own lookup.
 *
 * ONE UNIFORM PER GARMENT AND NO ARRAY INDEXING, deliberately: an array reached
 * with a computed index is the one thing the older shading language does not
 * promise in a fragment shader, and a figure that came out untinted on somebody
 * else's driver would be a defect nothing in this repository could reproduce.
 * Eight named uniforms cost nothing and are reachable by a live sweep, which is
 * how the pigments get fitted.
 */
function garmentGlsl() {
  const uniforms = PALETTE.map((p, i) => `  uniform vec3 uPal${i};   // ${p.id}`).join('\n');
  const tests = BODY.map((b) => {
    const lo = `vec3(${b.x0.toFixed(1)}, ${b.y0.toFixed(1)}, ${b.z0.toFixed(1)})`;
    const hi = `vec3(${b.x1.toFixed(1)}, ${b.y1.toFixed(1)}, ${b.z1.toFixed(1)})`;
    return `    if (all(greaterThanEqual(c, ${lo})) && all(lessThanEqual(c, ${hi}))) g = uPal${b.palette};`;
  }).join('\n');
  return `${uniforms}

  // Generated from src/world/avatar/plan.js, in the plan's own order: a cell
  // belongs to the LAST box that contains it, which is what lets the head be a
  // solid of hair with a face laid into the front of it.
  vec3 garmentOf(vec3 c) {
    vec3 g = uPal0;
${tests}
    return g;
  }
`;
}

const VERTEX = /* glsl */`
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vFacing;
  varying float vDistance;

  void main() {
    // The position stays in the BODY's own frame all the way to the fragment.
    // That is what welds the tint and the palette to him: both are read off
    // this, and this does not know he has moved.
    vLocal = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    // BOTH NORMALS TRAVEL, and they answer two different questions. The world
    // one is for the light, which is a fact about the world: he turns, and the
    // side of him the sun is on turns with him. The body one is for the
    // arithmetic that rebuilds a cube — which cell a face belongs to, where in
    // that face this pixel stands — and that is a fact about him. Carrying the
    // second is a varying and not an attribute: it is the same six values the
    // geometry already uploads, interpolated across a face that is flat, so it
    // arrives exactly.
    vNormal = normalize(mat3(modelMatrix) * normal);
    vFacing = normal;
    vDistance = length(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

function fragment() {
  return /* glsl */`
  precision highp float;

  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vFacing;
  varying float vDistance;

  uniform float uVoxel;
  uniform float uTint;
  uniform float uHue;
  uniform float uJoint;
  uniform float uJointPixels;
  uniform float uArris;
  uniform float uArrisPixels;
  uniform float uArrisLean;

  ${SCENE_LIGHT_GLSL}
  ${FACE_LIGHT_GLSL}
  ${HASH_GLSL}
  ${FOG_GLSL}
  ${garmentGlsl()}

  void main() {
    vec3 n = normalize(vNormal);
    vec3 local = normalize(vFacing);

    // WHICH CUBE THIS IS. Half a step back along the face's own normal, so a
    // face lands inside the solid it belongs to instead of on the boundary
    // between two — on the boundary the floor below would flicker between
    // neighbours and both the tint and the GARMENT of a whole panel would crawl
    // as the eye moved. In the body's frame, because that is the frame the
    // answer is a fact about.
    vec3 p = vLocal - local * (uVoxel * 0.5);
    vec3 cell = floor(p / uVoxel);

    float pixel = max(length(fwidth(p)), 1e-6);
    float onScreen = uVoxel / pixel;

    // ------------------------------------------------- which garment, and its tint
    vec3 base = garmentOf(cell);
    vec2 draw = cellHash(cell);
    float tint = 1.0 + uTint * (draw.x - 0.5);
    vec3 shift = vec3(1.0 - uHue * (draw.y - 0.5), 1.0,
                      1.0 + uHue * (draw.y - 0.5));
    vec3 albedo = base * tint * shift;

    // ------------------------------------------ where in the face we stand
    vec3 middle = abs(fract(p / uVoxel) - 0.5);
    vec3 across = mix(middle, vec3(0.5), abs(local));
    float border = (0.5 - max(across.x, max(across.y, across.z))) * uVoxel;

    // ----------------------------------------------------------- the joint
    float width = min(uJointPixels * pixel, uVoxel * 0.14);
    float joint = 1.0 - uJoint * (1.0 - smoothstep(0.0, width, border))
      * smoothstep(2.5, 5.0, onScreen);
    albedo *= joint;

    // ----------------------------------------------------------- the light
    vec3 light = faceLight(n);

    // ------------------------------------------------- the lightened arris
    // Upright is shared between the two frames, so the top edge of one of his
    // cubes is found exactly as the meadow finds one of its own.
    float up = fract(p.y / uVoxel);
    float band = min(uArrisPixels * pixel, uVoxel * 0.30) / uVoxel;
    float arris = smoothstep(1.0 - band, 1.0, up)
      * (1.0 - abs(local.y)) * uArris * smoothstep(2.5, 5.0, onScreen);
    if (arris > 0.0) {
      vec3 leaning = normalize(mix(n, normalize(n + vec3(0.0, 1.0, 0.0)), uArrisLean));
      light = mix(light, faceLight(leaning), arris);
    }

    vec3 colour = albedo * light;
    colour = mix(colour, uFogColour, fogAmount(vDistance, vWorld.y));
    gl_FragColor = vec4(colour, 1.0);
  }
`;
}

/**
 * The figure's material. One, shared by the whole body — one draw call.
 *
 * @param {number} voxel     his cell, in metres
 * @param {object} settings  from avatarSettings(), held by reference so a sweep
 *                           on the page moves the frame without a rebuild
 */
export function avatarMaterial(voxel, settings) {
  const uniforms = {
    uVoxel: { value: voxel },
    uTint: { value: settings.tint },
    uHue: { value: settings.hue },
    uJoint: { value: settings.joint },
    uJointPixels: { value: settings.jointPixels },
    uArris: { value: settings.arris },
    uArrisPixels: { value: settings.arrisPixels },
    uArrisLean: { value: settings.arrisLean },
    // The sun, the exposure and the lifts, from the one seat that produces the
    // pair they act on. THE EXPOSURE IS THE GROUND'S, INHERITED AND NOT FITTED:
    // he stands on that ground, in that air, under that sun, and the campaign
    // has measured an exposure for exactly those conditions. Giving the figure
    // one of his own would be a second answer to how bright this world is.
    ...faceLightUniforms(TERRAIN.lightScale * GROUND_EXPOSURE),
    ...SCENE_LIGHT_UNIFORMS,
    ...fogUniforms(),
  };
  settings.palette.forEach((colour, i) => { uniforms[`uPal${i}`] = { value: colour }; });

  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: fragment(),
    fog: false,
  });

  material.userData.refresh = () => {
    const u = material.uniforms;
    u.uTint.value = settings.tint;
    u.uHue.value = settings.hue;
    u.uJoint.value = settings.joint;
    u.uJointPixels.value = settings.jointPixels;
    u.uArris.value = settings.arris;
    u.uArrisPixels.value = settings.arrisPixels;
    u.uArrisLean.value = settings.arrisLean;
    settings.palette.forEach((colour, i) => { u[`uPal${i}`].value.copy(colour); });
  };

  return material;
}
